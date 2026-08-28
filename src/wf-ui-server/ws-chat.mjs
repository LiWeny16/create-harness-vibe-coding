import crypto from 'node:crypto';
import { readStoredEnvelopes } from './chat-store.mjs';
import { sendTo, interrupt, approve, setChatEventBroadcaster } from './chat-driver.mjs';

// ── Chat WebSocket channel (/ws/chat/:sessionId) ──
// Mirrors the ws-terminal.mjs hub architecture (frame helpers, per-session
// client sets, keepalive ping/pong, disk revive) for chat-mode sessions.
// Server→client: canonical envelopes + {type:'chat:state'}; client→server:
// JSON frames chat:send / chat:steer / chat:interrupt / chat:approve.

const KEEPALIVE_INTERVAL = 15000;
const PING_TIMEOUT = 5000;
const TICK_MS = Math.min(KEEPALIVE_INTERVAL, PING_TIMEOUT) / 2;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function sendFrame(socket, text, opcode = 0x1) {
  const data = Buffer.from(text, 'utf8');
  const len = data.length;
  let frame;
  if (len < 126) {
    frame = Buffer.alloc(2 + len);
    frame[0] = 0x80 | opcode;
    frame[1] = len;
    data.copy(frame, 2);
  } else if (len < 65536) {
    frame = Buffer.alloc(4 + len);
    frame[0] = 0x80 | opcode;
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
    data.copy(frame, 4);
  } else {
    frame = Buffer.alloc(10 + len);
    frame[0] = 0x80 | opcode;
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
    data.copy(frame, 10);
  }
  socket.write(frame);
}

function sendCloseFrame(socket, code = 1000) {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  const header = Buffer.alloc(2);
  header[0] = 0x88;
  header[1] = 2;
  socket.write(Buffer.concat([header, payload]));
}

function parseFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b1 = buffer[offset];
    const opcode = b1 & 0x0F;
    const b2 = buffer[offset + 1];
    const masked = (b2 & 0x80) !== 0;
    let payloadLen = b2 & 0x7F;
    let headerLen = 2;
    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (offset + headerLen + maskLen + payloadLen > buffer.length) break;
    offset += headerLen;
    let payload;
    if (masked) {
      const mask = buffer.slice(offset, offset + 4);
      offset += 4;
      payload = Buffer.allocUnsafe(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = buffer[offset + i] ^ mask[i % 4];
      }
    } else {
      payload = buffer.slice(offset, offset + payloadLen);
    }
    offset += payloadLen;
    frames.push({ opcode, payload });
  }
  return { frames, remainder: buffer.slice(offset) };
}

function sendHttpError(sock, statusCode, message) {
  const code = statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 404 ? 'NOT_FOUND' : 'ERROR';
  const reason = statusCode === 401 ? 'Unauthorized' : statusCode === 404 ? 'Not Found' : 'Error';
  const body = JSON.stringify({ error: { code, message } });
  sock.write(
    `HTTP/1.1 ${statusCode} ${reason}\r\n` +
    'Content-Type: application/json\r\n' +
    `Content-Length: ${body.length}\r\n` +
    'Connection: close\r\n\r\n' + body
  );
  sock.end();
}

/**
 * Attach the /ws/chat/:sessionId endpoint to an existing http.Server and wire
 * it as the live-envelope broadcaster for chat drivers.
 *
 * @param {import('http').Server} httpServer
 * @param {string} expectedToken - Compatibility parameter; no token validation is performed.
 * @param {import('./session-registry.mjs').SessionRegistry} sessionRegistry
 * @param {{ projectRoot?: string, keepaliveInterval?: number, pingTimeout?: number, reviveSession?: (sessionId: string) => object|null }} [options]
 * @returns {{ close: () => Promise<void>, broadcastToSession: (sessionId: string, msg: object) => void }}
 */
export function attachChatWs(httpServer, expectedToken, sessionRegistry, options = {}) {
  const keepaliveInterval = options.keepaliveInterval || KEEPALIVE_INTERVAL;
  const pingTimeoutMs = options.pingTimeout || PING_TIMEOUT;
  const tickMs = Math.min(keepaliveInterval, pingTimeoutMs) / 2;

  /** Map<sessionId, Set<{ socket, connectionId, lastActivity, waitingPong, pingSentAt }>> */
  const sessionClients = new Map();
  const revivedSessions = new Map();
  let keepaliveTimer = null;

  setChatEventBroadcaster((sessionId, msg) => broadcastToSession(sessionId, msg));

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const match = url.pathname.match(/^\/ws\/chat\/([^/]+)$/);
    if (!match) return; // not a chat path — another handler owns it

    const sessionId = match[1];
    let session = sessionRegistry?.get?.(sessionId);
    if (!session) session = reviveDiskSession(sessionId);
    if (!session) {
      sendHttpError(socket, 404, `Session "${sessionId}" not found`);
      return;
    }

    const key = req.headers['sec-websocket-key'];
    const digest = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + digest + '\r\n\r\n'
    );

    const client = {
      socket,
      connectionId: crypto.randomBytes(16).toString('hex'),
      lastActivity: Date.now(),
      waitingPong: false,
      pingSentAt: 0,
    };
    if (!sessionClients.has(sessionId)) sessionClients.set(sessionId, new Set());
    sessionClients.get(sessionId).add(client);

    // Handshake state, then replay every stored envelope so a (re)connecting
    // client rebuilds the transcript before live events flow.
    sendFrame(socket, JSON.stringify({
      type: 'chat:state',
      sessionId,
      state: session.status || 'starting',
      uiMode: 'chat',
      providerSessionId: session.providerSessionId || null,
    }));
    try {
      if (options.projectRoot) {
        for (const envelope of readStoredEnvelopes(options.projectRoot, { sessionId })) {
          sendFrame(socket, JSON.stringify(envelope));
        }
      }
    } catch { /* replay is best-effort; live events still flow */ }

    let buffer = Buffer.alloc(0);
    if (head && head.length > 0) buffer = Buffer.concat([buffer, head]);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      client.lastActivity = Date.now();
      const result = parseFrames(buffer);
      buffer = result.remainder;
      for (const frame of result.frames) {
        if (frame.opcode === 0x9) {
          sendFrame(socket, '', 0xA);
        } else if (frame.opcode === 0xA) {
          client.waitingPong = false;
        } else if (frame.opcode === 0x8) {
          sendCloseFrame(socket, 1000);
          cleanupClient(sessionId, client);
          socket.end();
          return;
        } else if (frame.opcode === 0x1) {
          try {
            handleMessage(sessionId, JSON.parse(frame.payload.toString('utf8')));
          } catch { /* ignore malformed JSON */ }
        }
      }
    });

    socket.on('close', () => cleanupClient(sessionId, client));
    socket.on('end', () => cleanupClient(sessionId, client));
    socket.on('error', () => cleanupClient(sessionId, client));
  });

  function handleMessage(sessionId, msg) {
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'chat:send':
        sendTo(sessionId, String(msg.text ?? ''), { steer: false });
        break;
      case 'chat:steer':
        sendTo(sessionId, String(msg.text ?? ''), { steer: true });
        break;
      case 'chat:interrupt':
        void interrupt(sessionId);
        break;
      case 'chat:approve':
        void approve(sessionId, msg.requestId, msg.result);
        break;
      default:
        // Unknown frame type — ignore
        break;
    }
  }

  function cleanupClient(sessionId, client) {
    if (client._cleanedUp) return;
    client._cleanedUp = true;
    const clients = sessionClients.get(sessionId);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) sessionClients.delete(sessionId);
    }
  }

  function reviveDiskSession(sessionId) {
    const cached = revivedSessions.get(sessionId);
    if (cached) return cached;
    const revive = (typeof options.reviveSession === 'function' && options.reviveSession)
      || (typeof sessionRegistry?.reviveSession === 'function' && sessionRegistry.reviveSession.bind(sessionRegistry));
    if (typeof revive !== 'function') return null;
    let record = null;
    try { record = revive(sessionId); } catch { record = null; }
    if (!record || !record.sessionId || record.status === 'exited') return null;
    record = { ...record, status: record.status || 'starting' };
    revivedSessions.set(sessionId, record);
    return record;
  }

  function broadcastToSession(sessionId, msg) {
    const clients = sessionClients.get(sessionId);
    if (!clients || clients.size === 0) return;
    const payload = JSON.stringify(msg);
    for (const c of [...clients]) {
      try {
        sendFrame(c.socket, payload);
      } catch { /* ignore disconnected */ }
    }
  }

  keepaliveTimer = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, clients] of sessionClients) {
      for (const c of [...clients]) {
        try {
          if (c.waitingPong) {
            if (now - c.pingSentAt >= pingTimeoutMs) {
              sendCloseFrame(c.socket, 1001);
              c.socket.end();
              cleanupClient(sessionId, c);
            }
          } else if (now - c.lastActivity >= keepaliveInterval) {
            sendFrame(c.socket, '', 0x9);
            c.waitingPong = true;
            c.pingSentAt = now;
          }
        } catch {
          cleanupClient(sessionId, c);
        }
      }
    }
  }, Math.max(tickMs, 100));

  function close() {
    return new Promise((resolve) => {
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      keepaliveTimer = null;
      setChatEventBroadcaster(null);
      for (const [, clients] of sessionClients) {
        for (const c of [...clients]) {
          try { sendCloseFrame(c.socket, 1001); c.socket.end(); } catch { /* ignore */ }
        }
      }
      sessionClients.clear();
      resolve();
    });
  }

  return { close, broadcastToSession };
}
