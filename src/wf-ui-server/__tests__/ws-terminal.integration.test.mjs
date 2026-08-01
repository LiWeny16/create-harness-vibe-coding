import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';

import { startServer, stopServer } from '../server.mjs';
import { attachTerminalWs } from '../ws-terminal.mjs';
import { SessionRegistry } from '../session-registry.mjs';

// ── Minimal WebSocket frame helpers ──

/**
 * Parse a single unfragmented text frame from server->client data.
 * Server frames are unmasked. Returns null if incomplete.
 */
function tryParseFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  // For testing we only handle unmasked server frames
  if (masked) return null;
  if (buf.length < offset + payloadLen) return null;

  return {
    opcode,
    payload: buf.slice(offset, offset + payloadLen).toString('utf8'),
    totalLen: offset + payloadLen,
  };
}

/**
 * Build a masked WebSocket text frame (client -> server).
 */
function sendMaskedFrame(sock, text) {
  const data = Buffer.from(text, 'utf8');
  const maskKey = crypto.randomBytes(4);
  const masked = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) {
    masked[i] = data[i] ^ maskKey[i % 4];
  }
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x81; // FIN + text
    header[1] = 0x80 | len; // masked
    maskKey.copy(header, 2);
    sock.write(Buffer.concat([header, masked]));
  } else if (len < 65536) {
    header = Buffer.alloc(8);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    maskKey.copy(header, 4);
    sock.write(Buffer.concat([header, masked]));
  }
}

/**
 * Send a WebSocket close frame (client -> server) to gracefully close.
 */
function sendWsClose(sock) {
  const maskKey = crypto.randomBytes(4);
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(1000, 0);
  const masked = Buffer.allocUnsafe(2);
  for (let i = 0; i < 2; i++) {
    masked[i] = payload[i] ^ maskKey[i % 4];
  }
  const header = Buffer.alloc(6);
  header[0] = 0x88;
  header[1] = 0x80 | 2;
  maskKey.copy(header, 2);
  sock.write(Buffer.concat([header, masked]));
}

/**
 * Connect to /ws/terminal/:sessionId using raw TCP.
 * Returns { sock, readMessage, close } for 101 upgrade,
 * or { status, body } for non-101 responses.
 */
async function wsConnectTerminal(port, sessionId, tokenValue) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      const wsKey = 'dGhlIHNhbXBsZSBub25jZQ==';
      const q = tokenValue !== undefined && tokenValue !== null
        ? 'token=' + encodeURIComponent(tokenValue) : '';
      sock.write(
        `GET /ws/terminal/${sessionId}?${q} HTTP/1.1\r\n` +
        'Host: 127.0.0.1\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + wsKey + '\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });

    let resolved = false;
    const resolveOnce = (v) => { if (!resolved) { resolved = true; resolve(v); } };

    const timeout = setTimeout(() => {
      sock.destroy();
      resolveOnce({ status: 0, body: 'timeout' });
    }, 10000);

    let frameBuf = Buffer.alloc(0);
    let httpHeaderDone = false;

    sock.on('data', (chunk) => {
      if (!httpHeaderDone) {
        frameBuf = Buffer.concat([frameBuf, chunk]);
        const headerEnd = frameBuf.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        const header = frameBuf.slice(0, headerEnd).toString();
        const rest = frameBuf.slice(headerEnd + 4);
        const statusCode = parseInt(header.split(' ')[1] || '0', 10);

        clearTimeout(timeout);

        if (statusCode === 101) {
          httpHeaderDone = true;
          frameBuf = rest;

          const conn = { sock, close() { sendWsClose(sock); } };

          conn.readMessage = (ms = 10000) => new Promise((res, rej) => {
            function consumeBuffer() {
              const frame = tryParseFrame(frameBuf);
              if (frame) {
                if (frame.opcode === 0x8) {
                  sock.destroy();
                  return rej(new Error('Connection closed'));
                }
                if (frame.opcode === 0x1) {
                  frameBuf = frameBuf.slice(frame.totalLen);
                  try { res(JSON.parse(frame.payload)); } catch (e) { rej(e); }
                  return true;
                }
                frameBuf = frameBuf.slice(frame.totalLen);
                return false;
              }
              return false;
            }

            if (consumeBuffer()) return;

            const tid = setTimeout(() => rej(new Error('timeout')), ms);
            const onData = () => consumeBuffer() && cleanup();
            const onClose = () => { cleanup(); rej(new Error('Connection closed')); };
            const cleanup = () => {
              clearTimeout(tid);
              sock.off('data', onData);
              sock.off('close', onClose);
            };
            sock.on('data', onData);
            sock.on('close', onClose);
          });

          resolveOnce(conn);
        } else {
          sock.destroy();
          resolveOnce({ status: statusCode, body: rest.toString() });
        }
      } else {
        frameBuf = Buffer.concat([frameBuf, chunk]);
      }
    });

    sock.on('close', () => {
      clearTimeout(timeout);
      resolveOnce({ status: 0, body: 'closed' });
    });
    sock.on('error', () => {});
  });
}

// ── Fixture setup ──

let server;
let token;
let port;
let registry;
let wsHandle;
let tempRoot;
let sessionA;
let sessionB;

before(async () => {
  tempRoot = makeHarnessTempRoot('wf-ui-term-');
  const tasksDir = path.join(tempRoot, 'Harness', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

  const r = await startServer({ projectRoot: tempRoot, host: '127.0.0.1', port: 0 });
  server = r.server;
  token = r.token;
  port = r.port;

  registry = new SessionRegistry();
  sessionA = registry.create({ taskId: 'task-a', runtime: 'claude', cols: 120, rows: 32 });
  sessionB = registry.create({ taskId: 'task-b', runtime: 'codex', cols: 120, rows: 32 });

  const origLog = console.log;
  console.log = () => {};

  wsHandle = attachTerminalWs(server, token, registry);

  console.log = origLog;
});

after(async () => {
  if (wsHandle) await wsHandle.close();
  if (server) await stopServer(server);
  if (tempRoot) {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
});

// ── Tests ──

test('connects with valid token, receives session:state', async () => {
  const conn = await wsConnectTerminal(port, sessionA.sessionId, token);
  assert.ok(conn.sock, 'Should establish WS connection');
  assert.ok(conn.sock.writable, 'Socket should be writable');
  assert.ok(typeof conn.readMessage === 'function');

  const msg = await conn.readMessage(3000);
  assert.equal(msg.type, 'session:state');
  assert.equal(msg.sessionId, sessionA.sessionId);
  assert.equal(msg.state, 'starting');

  conn.close();
});

test('connection with invalid token gets rejected', async () => {
  const conn = await wsConnectTerminal(port, sessionA.sessionId, 'bad-token-1234567890abcdef');
  assert.equal(conn.status, 401, 'Invalid token should get 401');
});

test('connection to nonexistent sessionId gets rejected', async () => {
  const conn = await wsConnectTerminal(port, 'nonexistent-session-id', token);
  assert.equal(conn.status, 404, 'Nonexistent session should get 404');
});

test('connection with no token gets rejected', async () => {
  const conn = await wsConnectTerminal(port, sessionA.sessionId, undefined);
  assert.equal(conn.status, 401, 'No token should get 401');
});

test('output isolation between sessions', async () => {
  const connA = await wsConnectTerminal(port, sessionA.sessionId, token);
  const handshakeA = await connA.readMessage(3000);
  assert.equal(handshakeA.type, 'session:state');

  const connB = await wsConnectTerminal(port, sessionB.sessionId, token);
  const handshakeB = await connB.readMessage(3000);
  assert.equal(handshakeB.type, 'session:state');

  // Broadcast only to session A
  wsHandle.broadcastToSession(sessionA.sessionId, {
    type: 'pty:data',
    sessionId: sessionA.sessionId,
    data: 'hello-A',
  });

  // Session B should NOT receive the message
  await assert.rejects(
    () => connB.readMessage(2000),
    { message: 'timeout' },
    'Session B should not receive pty:data from session A',
  );

  // Session A should receive it
  const msgA = await connA.readMessage(3000);
  assert.equal(msgA.type, 'pty:data');
  assert.equal(msgA.sessionId, sessionA.sessionId);

  connA.close();
  connB.close();
});

test('pty:resize updates session cols/rows in registry', async () => {
  const conn = await wsConnectTerminal(port, sessionA.sessionId, token);
  await conn.readMessage(3000); // drain handshake

  sendMaskedFrame(conn.sock, JSON.stringify({ type: 'pty:resize', cols: 100, rows: 40 }));

  await new Promise(r => setTimeout(r, 200));

  const updated = registry.get(sessionA.sessionId);
  assert.equal(updated.cols, 100);
  assert.equal(updated.rows, 40);

  conn.close();
});

test('watch mode: pty:input returns error message, data NOT forwarded', async () => {
  const conn = await wsConnectTerminal(port, sessionA.sessionId, token);
  await conn.readMessage(3000); // drain

  sendMaskedFrame(conn.sock, JSON.stringify({ type: 'pty:input', data: 'echo hello' }));

  const msg = await conn.readMessage(3000);
  assert.equal(msg.type, 'session:error');
  assert.ok(msg.message.includes('watch mode'), `message should mention watch mode, got: ${msg.message}`);

  conn.close();
});

test('attach mode toggle: after session.attachMode = true, pty:input returns confirmation', async () => {
  registry.update(sessionA.sessionId, { attachMode: true });

  const conn = await wsConnectTerminal(port, sessionA.sessionId, token);
  await conn.readMessage(3000); // drain

  sendMaskedFrame(conn.sock, JSON.stringify({ type: 'pty:input', data: 'echo hello' }));

  const msg = await conn.readMessage(3000);
  // Either pty:data confirmation (if a PTY is attached) or session:error about no PTY (if not)
  assert.ok(msg.type === 'pty:data' || (msg.type === 'session:error' && msg.message.includes('PTY')),
    `Expected pty:data or session:error about PTY, got type=${msg.type} message=${msg.message}`);

  conn.close();
});

test('pty:resize on session A does not affect session B cols/rows', async () => {
  const connA = await wsConnectTerminal(port, sessionA.sessionId, token);
  await connA.readMessage(3000);

  const connB = await wsConnectTerminal(port, sessionB.sessionId, token);
  await connB.readMessage(3000);

  sendMaskedFrame(connA.sock, JSON.stringify({ type: 'pty:resize', cols: 80, rows: 24 }));

  await new Promise(r => setTimeout(r, 200));

  const updatedA = registry.get(sessionA.sessionId);
  assert.equal(updatedA.cols, 80);
  assert.equal(updatedA.rows, 24);

  const updatedB = registry.get(sessionB.sessionId);
  assert.equal(updatedB.cols, 120);
  assert.equal(updatedB.rows, 32);

  connA.close();
  connB.close();
});

test('disconnect decrements wsClientCount', async () => {
  // Use a session that has had no prior WS connections in this test suite
  const freshSession = registry.create({ taskId: 'task-disconnect', runtime: 'claude', cols: 120, rows: 32 });

  const initial = freshSession.wsClientCount;
  assert.equal(initial, 0, 'fresh session should start with wsClientCount=0');

  const conn = await wsConnectTerminal(port, freshSession.sessionId, token);
  await conn.readMessage(3000);

  const afterConnect = registry.get(freshSession.sessionId).wsClientCount;
  assert.equal(afterConnect, 1, 'wsClientCount should be 1 after connect');

  conn.close();
  await new Promise(r => setTimeout(r, 500));

  const afterClose = registry.get(freshSession.sessionId).wsClientCount;
  assert.equal(afterClose, 0, 'wsClientCount should return to 0 after disconnect');
});
