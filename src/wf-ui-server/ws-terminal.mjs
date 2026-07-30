import crypto from 'node:crypto';
import { validateToken } from './token.mjs';

const KEEPALIVE_INTERVAL = 15000;
const PING_TIMEOUT = 5000;
const TICK_MS = Math.min(KEEPALIVE_INTERVAL, PING_TIMEOUT) / 2;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ── PTY process registry ──
// Maps sessionId to ptyProcess for writing input, resizing, or killing.
/** @type {Map<string, object>} */
const ptyRegistry = new Map();

/**
 * Register a PTY process for a session so ws-terminal can write/resize/kill it.
 * @param {string} sessionId
 * @param {object} ptyProcess
 */
export function registerPtyProcess(sessionId, ptyProcess) {
  ptyRegistry.set(sessionId, ptyProcess);
}

/**
 * Unregister a PTY process when the session ends.
 * @param {string} sessionId
 */
export function unregisterPtyProcess(sessionId) {
  ptyRegistry.delete(sessionId);
}

export function writePtyInput(sessionId, data) {
  const ptyProcess = ptyRegistry.get(sessionId);
  if (!ptyProcess || typeof ptyProcess.write !== 'function') return false;
  ptyProcess.write(data || '');
  return true;
}

export function killPtyProcess(sessionId) {
  const ptyProcess = ptyRegistry.get(sessionId);
  if (!ptyProcess || typeof ptyProcess.kill !== 'function') return false;
  ptyProcess.kill();
  unregisterPtyProcess(sessionId);
  return true;
}

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
  header[0] = 0x88;
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
  let code;
  if (statusCode === 401) code = 'UNAUTHORIZED';
  else if (statusCode === 404) code = 'NOT_FOUND';
  else code = 'ERROR';
  const body = JSON.stringify({ error: { code, message } });
  const reason = statusCode === 401 ? 'Unauthorized' : statusCode === 404 ? 'Not Found' : 'Error';
  sock.write(
    `HTTP/1.1 ${statusCode} ${reason}\r\n` +
    'Content-Type: application/json\r\n' +
    `Content-Length: ${body.length}\r\n` +
    'Connection: close\r\n\r\n' + body
  );
  sock.end();
}

// ── Public API ──

/**
 * Attach a WebSocket /ws/terminal/:sessionId endpoint to an existing http.Server.
 *
 * On upgrade: validates `?token=` query param, validates sessionId exists in
 * registry, performs WS upgrade, sends `session:state` handshake, and
 * broadcasts PTY data to all WS clients for that session.
 *
 * Default mode is watch (read-only). pty:input is rejected unless
 * session.attachMode === true.
 *
 * @param {import('http').Server} httpServer
 * @param {string} expectedToken - The token clients must present.
 * @param {import('./session-registry.mjs').SessionRegistry} sessionRegistry
 * @param {{ keepaliveInterval?: number, pingTimeout?: number }} [options]
 * @returns {{ close: () => Promise<void>, broadcastToSession: (sessionId: string, msg: object) => void }}
 */
export function attachTerminalWs(httpServer, expectedToken, sessionRegistry, options = {}) {
  const keepaliveInterval = options.keepaliveInterval || KEEPALIVE_INTERVAL;
  const pingTimeoutMs = options.pingTimeout || PING_TIMEOUT;
  const tickMs = Math.min(keepaliveInterval, pingTimeoutMs) / 2;

  /**
   * Map<sessionId, Set<{ socket, connectionId, lastActivity, waitingPong, pingSentAt }>>
   */
  const sessionClients = new Map();
  let keepaliveTimer = null;

  // ── wire upgrade handler ──
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    // Match /ws/terminal/:sessionId
    const match = url.pathname.match(/^\/ws\/terminal\/([^/]+)$/);
    if (!match) {
      // Not a terminal path — let another handler process it
      return;
    }

    const sessionId = match[1];

    if (!validateToken(url.searchParams.get('token'), expectedToken)) {
      sendHttpError(socket, 401, 'Invalid or missing token');
      return;
    }

    // Validate session exists
    const session = sessionRegistry.get(sessionId);
    if (!session) {
      sendHttpError(socket, 404, `Session "${sessionId}" not found`);
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

    // Add to session's client set
    if (!sessionClients.has(sessionId)) {
      sessionClients.set(sessionId, new Set());
    }
    sessionClients.get(sessionId).add(client);

    // Increment wsClientCount
    sessionRegistry.update(sessionId, { wsClientCount: (session.wsClientCount || 0) + 1 });

    // Send session:state handshake
    sendFrame(socket, JSON.stringify({
      type: 'session:state',
      sessionId,
      state: session.status || 'starting',
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
          // Pong received
          client.waitingPong = false;
        } else if (frame.opcode === 0x8) {
          // Close frame — echo back
          sendCloseFrame(socket, 1000);
          cleanupClient(sessionId, client);
          socket.end();
          return;
        } else if (frame.opcode === 0x1) {
          // Text frame — parse as JSON
          try {
            const msg = JSON.parse(frame.payload.toString('utf8'));
            handleMessage(sessionId, msg, socket);
          } catch {
            // Ignore malformed JSON
          }
        }
      }
    });

    socket.on('close', () => {
      cleanupClient(sessionId, client);
    });

    socket.on('end', () => {
      cleanupClient(sessionId, client);
    });

    socket.on('error', () => {
      cleanupClient(sessionId, client);
    });
  });

  /**
   * Handle a parsed message frame for a session.
   * @param {string} sessionId
   * @param {object} msg
   * @param {import('net').Socket} socket
   */
  function handleMessage(sessionId, msg, socket) {
    const session = sessionRegistry.get(sessionId);
    if (!session) return;

    switch (msg.type) {
      case 'pty:resize': {
        const cols = typeof msg.cols === 'number' ? msg.cols : session.cols;
        const rows = typeof msg.rows === 'number' ? msg.rows : session.rows;
        if (cols === session.cols && rows === session.rows) break;
        sessionRegistry.update(sessionId, { cols, rows });

        // If a real PTY process exists, resize it
        const ptyProcess = ptyRegistry.get(sessionId);
        if (ptyProcess && typeof ptyProcess.resize === 'function') {
          ptyProcess.resize(cols, rows);
        }
        break;
      }

      case 'pty:input': {
        if (!session.attachMode) {
          sendFrame(socket, JSON.stringify({
            type: 'session:error',
            sessionId,
            message: 'Input rejected: session is in watch mode. Enable attach mode to send input.',
          }));
          return;
        }

        const ptyProcess = ptyRegistry.get(sessionId);
        if (ptyProcess && typeof ptyProcess.write === 'function') {
          // Write input to the real PTY process
          ptyProcess.write(msg.data || '');
          if (typeof options.onTerminalInput === 'function') {
            options.onTerminalInput(session, msg.data || '');
          }
          sendFrame(socket, JSON.stringify({
            type: 'pty:input-accepted',
            sessionId,
          }));
        } else {
          // No PTY attached — inform the client
          sendFrame(socket, JSON.stringify({
            type: 'session:error',
            sessionId,
            message: 'No PTY process attached to this session. Cannot send input.',
          }));
        }
        break;
      }

      case 'control:attach-mode': {
        const attachMode = Boolean(msg.attachMode);
        sessionRegistry.update(sessionId, { attachMode });
        if (typeof options.onAttachModeChange === 'function') {
          options.onAttachModeChange(sessionRegistry.get(sessionId), attachMode);
        }
        sendFrame(socket, JSON.stringify({
          type: 'session:state',
          sessionId,
          state: session.status || 'running',
          attachMode,
        }));
        break;
      }

      case 'control:stop': {
        killPtyProcess(sessionId);

        sendFrame(socket, JSON.stringify({
          type: 'session:state',
          sessionId,
          state: 'exited',
        }));
        sessionRegistry.update(sessionId, { status: 'exited' });
        if (typeof options.onSessionState === 'function') {
          options.onSessionState(sessionRegistry.get(sessionId), 'exited');
        }
        break;
      }

      default:
        // Unknown frame type — ignore
        break;
    }
  }

  /**
   * Remove a client from a session's client set and decrement wsClientCount.
   * @param {string} sessionId
   * @param {object} client
   */
  function cleanupClient(sessionId, client) {
    // Guard against double-cleanup when both 'error' and 'close' fire
    if (client._cleanedUp) return;
    client._cleanedUp = true;

    const clients = sessionClients.get(sessionId);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        sessionClients.delete(sessionId);
      }
    }

    const session = sessionRegistry.get(sessionId);
    if (session) {
      const count = Math.max(0, (session.wsClientCount || 1) - 1);
      sessionRegistry.update(sessionId, { wsClientCount: count });
    }
  }

  /**
   * Broadcast a message to all WS clients for a specific session.
   * @param {string} sessionId
   * @param {object} msg - Plain object to JSON-serialize and send.
   */
  function broadcastToSession(sessionId, msg) {
    const clients = sessionClients.get(sessionId);
    if (!clients || clients.size === 0) return;

    const payload = JSON.stringify(msg);
    for (const c of clients) {
      try {
        sendFrame(c.socket, payload);
      } catch {
        /* ignore disconnected */
      }
    }
  }

  // ── keepalive timer ──
  keepaliveTimer = setInterval(() => {
    const now = Date.now();
    for (const [, clients] of sessionClients) {
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
    }
  }, Math.max(tickMs, 100));

  // ── close ──
  function close() {
    return new Promise((resolve) => {
      if (keepaliveTimer) clearInterval(keepaliveTimer);
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
