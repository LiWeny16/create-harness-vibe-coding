import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseTaskList } from './task-parser.mjs';
import { validateToken } from './token.mjs';

const KEEPALIVE_INTERVAL = 15000;
const PING_TIMEOUT = 5000;
const TICK_MS = Math.min(KEEPALIVE_INTERVAL, PING_TIMEOUT) / 2;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ── Frame helpers ──

/**
 * Write an unmasked text frame (opcode 0x1) to a socket.
 * @param {import('net').Socket} socket
 * @param {string} text
 * @param {number} [opcode=0x1]
 */
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

/**
 * Send a close frame with the given status code.
 * @param {import('net').Socket} socket
 * @param {number} [code=1000]
 */
function sendCloseFrame(socket, code = 1000) {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  const header = Buffer.alloc(2);
  header[0] = 0x88; // FIN + close
  header[1] = 2;
  socket.write(Buffer.concat([header, payload]));
}

/**
 * Parse incoming WebSocket frames from a buffer of raw bytes.
 * Handles masked client frames by unmasking the payload.
 * @param {Buffer} buffer
 * @returns {{ frames: Array<{ opcode: number, payload: Buffer }>, remainder: Buffer }}
 */
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

/**
 * Send a short HTTP error JSON response, then close the socket.
 * @param {import('net').Socket} sock
 * @param {number} statusCode
 * @param {string} message
 */
function sendHttpError(sock, statusCode, message) {
  const body = JSON.stringify({ error: { code: statusCode === 401 ? 'UNAUTHORIZED' : 'ERROR', message } });
  sock.write(
    `HTTP/1.1 ${statusCode} ${statusCode === 401 ? 'Unauthorized' : 'Error'}\r\n` +
    'Content-Type: application/json\r\n' +
    `Content-Length: ${body.length}\r\n` +
    'Connection: close\r\n\r\n' + body
  );
  sock.end();
}

// ── Public API ──

/**
 * Attach a WebSocket /ws/events endpoint to an existing http.Server.
 *
 * On upgrade: validates `?token=` query param, upgrades to WS, sends
 * `server.connected` handshake. Listens to `Harness/tasks/` for changes
 * and broadcasts `task.updated` to all connected clients. Sends `ping`
 * keepalive every 15s and force-closes clients that don't pong within 5s.
 *
 * @param {import('http').Server} httpServer
 * @param {string} expectedToken - The token clients must present.
 * @param {string} projectRoot - Absolute path to the project root.
 * @param {{ keepaliveInterval?: number, pingTimeout?: number }} [options]
 * @returns {{ wss: null, seq: number, close: () => Promise<void> }}
 */
export function attachEventsWs(httpServer, expectedToken, projectRoot, options = {}) {
  const keepaliveInterval = options.keepaliveInterval || KEEPALIVE_INTERVAL;
  const pingTimeoutMs = options.pingTimeout || PING_TIMEOUT;
  const tickMs = Math.min(keepaliveInterval, pingTimeoutMs) / 2;

  const clients = new Set();
  let seq = 0;
  let watcher = null;
  let watchTimeout = null;
  let keepaliveTimer = null;

  // ── wire upgrade handler ──
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname !== '/ws/events') {
      // Not an events path — let another handler process it
      return;
    }

    if (!validateToken(url.searchParams.get('token'), expectedToken)) {
      sendHttpError(socket, 401, 'Invalid or missing token');
      return;
    }

    // WS upgrade handshake
    const key = req.headers['sec-websocket-key'];
    const digest = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + digest + '\r\n\r\n'
    );

    const connectionId = crypto.randomBytes(16).toString('hex');
    const client = {
      socket,
      connectionId,
      lastActivity: Date.now(),
      waitingPong: false,
      pingSentAt: 0,
    };
    clients.add(client);

    // Send handshake
    seq = 0;
    sendFrame(socket, JSON.stringify({
      type: 'server.connected',
      seq: 0,
      ts: new Date().toISOString(),
      connectionId,
    }));

    // Read incoming WS frames
    let buffer = Buffer.alloc(0);
    if (head && head.length > 0) buffer = Buffer.concat([buffer, head]);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      client.lastActivity = Date.now();

      const result = parseFrames(buffer);
      buffer = result.remainder;
      for (const frame of result.frames) {
        if (frame.opcode === 0x9) {
          // Ping from client — respond with pong
          sendFrame(socket, '', 0xA);
        } else if (frame.opcode === 0xA) {
          // Pong received — clear waiting flag
          client.waitingPong = false;
        } else if (frame.opcode === 0x8) {
          // Close frame — echo back
          sendCloseFrame(socket, 1000);
          clients.delete(client);
          socket.end();
          return;
        }
      }
    });

    socket.on('close', () => {
      clients.delete(client);
    });

    socket.on('error', () => {
      clients.delete(client);
    });
  });

  // ── file watcher ──
  const tasksRoot = path.join(projectRoot, 'Harness', 'tasks');
  if (fs.existsSync(tasksRoot)) {
    try {
      watcher = fs.watch(tasksRoot, { recursive: true }, () => {
        if (watchTimeout) clearTimeout(watchTimeout);
        watchTimeout = setTimeout(() => {
          seq++;
          const payload = JSON.stringify({
            type: 'task.updated',
            seq,
            ts: new Date().toISOString(),
            taskId: null,
            payload: { taskCount: parseTaskList(tasksRoot).length },
          });
          for (const c of clients) {
            try { sendFrame(c.socket, payload); } catch { /* ignore */ }
          }
        }, 200);
      });
    } catch { /* watcher unavailable — degrade gracefully */ }
  }

  // ── keepalive timer ──
  keepaliveTimer = setInterval(() => {
    const now = Date.now();
    for (const c of [...clients]) {
      try {
        if (c.waitingPong) {
          if (now - c.pingSentAt >= pingTimeoutMs) {
            sendCloseFrame(c.socket, 1001);
            c.socket.end();
            clients.delete(c);
          }
        } else if (now - c.lastActivity >= keepaliveInterval) {
          sendFrame(c.socket, '', 0x9);
          c.waitingPong = true;
          c.pingSentAt = now;
        }
      } catch {
        clients.delete(c);
      }
    }
  }, Math.max(tickMs, 100));

  // ── close ──
  function close() {
    return new Promise((resolve) => {
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      if (watchTimeout) clearTimeout(watchTimeout);
      if (watcher) {
        try { watcher.close(); } catch { /* ignore */ }
      }
      for (const c of [...clients]) {
        try { sendCloseFrame(c.socket, 1001); c.socket.end(); } catch { /* ignore */ }
      }
      clients.clear();
      resolve();
    });
  }

  // ── public broadcast helpers (invoked externally) ──

  /**
   * Broadcast an arbitrary type+payload to all connected WebSocket clients.
   * @param {string} type - Event type name
   * @param {object} payload - Data fields (type and seq will be overridden)
   */
  function broadcastAll(type, payload) {
    seq++;
    const msg = JSON.stringify({ type, ...payload, seq, ts: new Date().toISOString() });
    for (const c of [...clients]) {
      try { sendFrame(c.socket, msg); } catch { /* ignore */ }
    }
  }

  /**
   * Broadcast a peer.started event to all connected WS clients.
   * @param {string} peerId
   * @param {string} runtime
   * @param {string} taskId
   */
  function broadcastPeerStartedFn(peerId, runtime, taskId) {
    broadcastAll('peer.started', { peerId, runtime, taskId });
  }

  /**
   * Broadcast a peer.blocked event to all connected WS clients.
   * @param {string} peerId
   * @param {string} reason
   */
  function broadcastPeerBlockedFn(peerId, reason) {
    broadcastAll('peer.blocked', { peerId, reason });
  }

  /**
   * Broadcast a session.state event to all connected WS clients.
   * @param {string} sessionId
   * @param {string} state
   */
  function broadcastSessionStateFn(sessionId, state) {
    broadcastAll('session.state', { sessionId, state });
  }

  /**
   * Get the current sequence number.
   * @returns {number}
   */
  function getSeq() { return seq; }

  /**
   * Increment the sequence number and return the new value.
   * @returns {number}
   */
  function incrementSeq() { return ++seq; }

  // ── return ──
  return {
    wss: null,
    get seq() { return seq; },
    close,
    broadcast: broadcastAll,
    broadcastPeerStarted: broadcastPeerStartedFn,
    broadcastPeerBlocked: broadcastPeerBlockedFn,
    broadcastSessionState: broadcastSessionStateFn,
    getSeq,
    incrementSeq,
  };
}
