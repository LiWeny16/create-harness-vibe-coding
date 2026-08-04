import crypto from 'node:crypto';
import { validateToken } from './token.mjs';

const KEEPALIVE_INTERVAL = 15000;
const PING_TIMEOUT = 5000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_COMMAND_TIMEOUT_MS = 8000;
const MAX_COMMAND_TIMEOUT_MS = 30000;
const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;

export class WfBrowserWsError extends Error {
  constructor(message, { statusCode = 400, code = 'BAD_REQUEST' } = {}) {
    super(message);
    this.name = 'WfBrowserWsError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

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

function sendJsonFrame(socket, payload) {
  sendFrame(socket, JSON.stringify(payload));
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
      for (let i = 0; i < payloadLen; i += 1) {
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

function connectionKey(runId, windowId) {
  return `${runId || ''}:${windowId || ''}`;
}

function cleanString(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeCommand(payload = {}) {
  const command = payload.command && typeof payload.command === 'object' ? payload.command : {};
  const commandId = cleanString(payload.commandId || command.commandId, `command-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`);
  const primitive = cleanString(payload.primitive || command.primitive, '');
  if (!primitive) {
    throw new WfBrowserWsError('wf-browser command requires a primitive');
  }
  return {
    commandId,
    primitive,
    agentId: cleanString(payload.agentId || command.agentId, ''),
    sessionId: cleanString(payload.sessionId || command.sessionId, ''),
    runId: cleanString(payload.runId || command.runId, ''),
    windowId: cleanString(payload.windowId || command.windowId, ''),
    leaseId: cleanString(payload.leaseId || command.leaseId, ''),
    payload: payload.payload ?? command.payload ?? {},
    timeoutMs: Math.min(Math.max(Number(payload.timeoutMs || command.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS), 500), MAX_COMMAND_TIMEOUT_MS),
  };
}

export function attachWfBrowserWs(httpServer, expectedToken, projectRoot, options = {}) {
  const keepaliveInterval = options.keepaliveInterval || KEEPALIVE_INTERVAL;
  const pingTimeoutMs = options.pingTimeout || PING_TIMEOUT;
  const tickMs = Math.min(keepaliveInterval, pingTimeoutMs) / 2;
  const maxMessageBytes = options.maxMessageBytes || DEFAULT_MAX_MESSAGE_BYTES;
  const clients = new Set();
  const frontendByWindow = new Map();
  const pendingCommands = new Map();
  let keepaliveTimer = null;

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname !== '/ws/wf-browser') return;

    if (!validateToken(url.searchParams.get('token'), expectedToken)) {
      sendHttpError(socket, 401, 'Invalid or missing token');
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

    const connectionId = crypto.randomBytes(16).toString('hex');
    const client = {
      socket,
      connectionId,
      role: 'unknown',
      runId: '',
      windowId: '',
      agentId: '',
      route: '',
      capabilities: [],
      connectedAt: new Date().toISOString(),
      lastActivity: Date.now(),
      waitingPong: false,
      pingSentAt: 0,
    };
    clients.add(client);

    sendJsonFrame(socket, {
      type: 'wf-browser.connected',
      protocolVersion: 1,
      connectionId,
      projectRoot,
      maxMessageBytes,
      ts: new Date().toISOString(),
    });

    let buffer = Buffer.alloc(0);
    if (head && head.length > 0) buffer = Buffer.concat([buffer, head]);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      client.lastActivity = Date.now();
      const result = parseFrames(buffer);
      buffer = result.remainder;
      for (const frame of result.frames) {
        if (frame.payload.length > maxMessageBytes) {
          sendCloseFrame(socket, 1009);
          cleanupClient(client);
          socket.end();
          return;
        }
        if (frame.opcode === 0x9) {
          sendFrame(socket, '', 0xA);
        } else if (frame.opcode === 0xA) {
          client.waitingPong = false;
        } else if (frame.opcode === 0x8) {
          sendCloseFrame(socket, 1000);
          cleanupClient(client);
          socket.end();
          return;
        } else if (frame.opcode === 0x1) {
          try {
            handleMessage(client, JSON.parse(frame.payload.toString('utf8')));
          } catch (err) {
            sendJsonFrame(socket, {
              type: 'error',
              code: err?.code || 'BAD_MESSAGE',
              message: err?.message || 'Malformed wf-browser message',
            });
          }
        }
      }
    });

    socket.on('close', () => cleanupClient(client));
    socket.on('end', () => cleanupClient(client));
    socket.on('error', () => cleanupClient(client));
  });

  function handleMessage(client, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      registerClient(client, msg);
      return;
    }
    if (msg.type === 'heartbeat') {
      sendJsonFrame(client.socket, {
        type: 'heartbeat.ack',
        connectionId: client.connectionId,
        ts: new Date().toISOString(),
      });
      return;
    }
    if (msg.type === 'ack') {
      const pending = pendingCommands.get(msg.commandId);
      if (pending) pending.ack = { ...msg, receivedAt: new Date().toISOString() };
      return;
    }
    if (msg.type === 'result') {
      const pending = pendingCommands.get(msg.commandId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingCommands.delete(msg.commandId);
      pending.resolve({
        commandId: msg.commandId,
        status: msg.status || 'ok',
        result: msg.result ?? null,
        artifacts: Array.isArray(msg.artifacts) ? msg.artifacts : [],
        events: Array.isArray(msg.events) ? msg.events : [],
        error: msg.error || null,
        ack: pending.ack || null,
        receivedAt: new Date().toISOString(),
      });
    }
  }

  function registerClient(client, msg) {
    const previousKey = client.runId && client.windowId ? connectionKey(client.runId, client.windowId) : '';
    if (previousKey && frontendByWindow.get(previousKey) === client) frontendByWindow.delete(previousKey);
    client.role = cleanString(msg.role, 'frontend');
    client.runId = cleanString(msg.runId, '');
    client.windowId = cleanString(msg.windowId, '');
    client.agentId = cleanString(msg.agentId, '');
    client.route = cleanString(msg.route?.pathname || msg.route, '');
    client.capabilities = Array.isArray(msg.capabilities) ? msg.capabilities.slice(0, 500) : [];
    if (client.role === 'frontend' && client.runId && client.windowId) {
      frontendByWindow.set(connectionKey(client.runId, client.windowId), client);
    }
    sendJsonFrame(client.socket, {
      type: 'hello.ack',
      status: 'registered',
      connectionId: client.connectionId,
      role: client.role,
      runId: client.runId,
      windowId: client.windowId,
      capabilityCount: client.capabilities.length,
      ts: new Date().toISOString(),
    });
  }

  function cleanupClient(client) {
    if (client._cleanedUp) return;
    client._cleanedUp = true;
    clients.delete(client);
    const key = client.runId && client.windowId ? connectionKey(client.runId, client.windowId) : '';
    if (key && frontendByWindow.get(key) === client) frontendByWindow.delete(key);
    for (const [commandId, pending] of [...pendingCommands.entries()]) {
      if (pending.client === client) {
        clearTimeout(pending.timer);
        pendingCommands.delete(commandId);
        pending.reject(new WfBrowserWsError('wf-browser frontend disconnected before command completed', {
          statusCode: 409,
          code: 'WINDOW_DISCONNECTED',
        }));
      }
    }
  }

  function sendCommand(payload = {}) {
    const command = normalizeCommand(payload);
    const client = frontendByWindow.get(connectionKey(command.runId, command.windowId));
    if (!client || client.socket.destroyed) {
      throw new WfBrowserWsError(`wf-browser window is not connected: ${command.windowId}`, {
        statusCode: 409,
        code: 'WINDOW_NOT_CONNECTED',
      });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCommands.delete(command.commandId);
        reject(new WfBrowserWsError(`wf-browser command timed out: ${command.commandId}`, {
          statusCode: 504,
          code: 'COMMAND_TIMEOUT',
        }));
      }, command.timeoutMs);
      pendingCommands.set(command.commandId, {
        client,
        command,
        resolve,
        reject,
        timer,
        ack: null,
      });
      try {
        sendJsonFrame(client.socket, {
          type: 'command',
          protocolVersion: 1,
          commandId: command.commandId,
          primitive: command.primitive,
          runId: command.runId,
          windowId: command.windowId,
          leaseId: command.leaseId,
          agentId: command.agentId,
          sessionId: command.sessionId,
          payload: command.payload,
          ts: new Date().toISOString(),
        });
      } catch (err) {
        clearTimeout(timer);
        pendingCommands.delete(command.commandId);
        reject(err);
      }
    });
  }

  function listConnections() {
    return [...clients].map(client => ({
      connectionId: client.connectionId,
      role: client.role,
      runId: client.runId,
      windowId: client.windowId,
      agentId: client.agentId,
      route: client.route,
      capabilityCount: client.capabilities.length,
      connectedAt: client.connectedAt,
      lastActivityAt: new Date(client.lastActivity).toISOString(),
    }));
  }

  keepaliveTimer = setInterval(() => {
    const now = Date.now();
    for (const client of [...clients]) {
      try {
        if (client.waitingPong) {
          if (now - client.pingSentAt >= pingTimeoutMs) {
            sendCloseFrame(client.socket, 1001);
            client.socket.end();
            cleanupClient(client);
          }
        } else if (now - client.lastActivity >= keepaliveInterval) {
          sendFrame(client.socket, '', 0x9);
          client.waitingPong = true;
          client.pingSentAt = now;
        }
      } catch {
        cleanupClient(client);
      }
    }
  }, Math.max(tickMs, 100));

  function close() {
    return new Promise((resolve) => {
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      for (const client of [...clients]) {
        try { sendCloseFrame(client.socket, 1001); client.socket.end(); } catch { /* ignore */ }
      }
      clients.clear();
      frontendByWindow.clear();
      for (const [, pending] of pendingCommands) {
        clearTimeout(pending.timer);
        pending.reject(new WfBrowserWsError('wf-browser bridge closed', {
          statusCode: 409,
          code: 'BRIDGE_CLOSED',
        }));
      }
      pendingCommands.clear();
      resolve();
    });
  }

  return {
    close,
    sendCommand,
    listConnections,
  };
}
