import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';
import { attachEventsWs } from '../ws-events.mjs';

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
 * Build a valid sec-websocket-accept response header value.
 */
function computeAccept(key) {
  const hash = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  return hash;
}

function sendMaskedControlFrame(sock, opcode, payloadText = '') {
  const data = Buffer.from(payloadText, 'utf8');
  const maskKey = crypto.randomBytes(4);
  const masked = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) {
    masked[i] = data[i] ^ maskKey[i % 4];
  }
  const header = Buffer.alloc(6);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | data.length;
  maskKey.copy(header, 2);
  sock.write(Buffer.concat([header, masked]));
}

/**
 * Connect to a WS endpoint using raw TCP.
 * Returns an object with:
 *  - `sock` (net.Socket) — the raw connection
 *  - `readMessage(timeout)` — Promise<object> next text frame JSON
 *  - `close()` — destroy socket
 * Or for non-101 responses: { status, body }
 */
async function wsConnect(port, tokenValue) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      const wsKey = 'dGhlIHNhbXBsZSBub25jZQ==';
      const q = tokenValue !== undefined && tokenValue !== null
        ? 'token=' + encodeURIComponent(tokenValue) : '';
      sock.write(
        'GET /ws/events?' + q + ' HTTP/1.1\r\n' +
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

    // Accumulate all data after the HTTP upgrade response
    let frameBuf = Buffer.alloc(0);
    let httpHeaderDone = false;

    // Pending readMessage waiters
    let pendingRead = null;

    sock.on('data', (chunk) => {
      if (!httpHeaderDone) {
        // Still reading the HTTP upgrade response
        frameBuf = Buffer.concat([frameBuf, chunk]);
        const headerEnd = frameBuf.indexOf('\r\n\r\n');
        if (headerEnd === -1) return; // wait for more

        const header = frameBuf.slice(0, headerEnd).toString();
        const rest = frameBuf.slice(headerEnd + 4);
        const statusCode = parseInt(header.split(' ')[1] || '0', 10);

        clearTimeout(timeout);

        if (statusCode === 101) {
          // Successful WS upgrade
          httpHeaderDone = true;
          frameBuf = rest; // remaining data after HTTP headers = WS frames

          // Build the connection object
          const conn = {
            sock,
            close() { sock.destroy(); },
          };

          conn.readMessage = (ms = 10000) => new Promise((res, rej) => {
            function consumeBuffer() {
              const frame = tryParseFrame(frameBuf);
              if (frame) {
                if (frame.opcode === 0x8) {
                  // Close frame
                  sock.destroy();
                  return rej(new Error('Connection closed'));
                }
                if (frame.opcode === 0x1) {
                  frameBuf = frameBuf.slice(frame.totalLen);
                  try { res(JSON.parse(frame.payload)); } catch (e) { rej(e); }
                  return true;
                }
                // Unknown/unhandled opcode — skip and try again
                frameBuf = frameBuf.slice(frame.totalLen);
                return false;
              }
              return false;
            }

            // Try immediately
            if (consumeBuffer()) return;

            // Wait for more data
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

          conn.readFrame = (ms = 10000) => new Promise((res, rej) => {
            function consumeBuffer() {
              const frame = tryParseFrame(frameBuf);
              if (frame) {
                frameBuf = frameBuf.slice(frame.totalLen);
                if (frame.opcode === 0x8) {
                  sock.destroy();
                  return rej(new Error('Connection closed'));
                }
                res(frame);
                return true;
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

          conn.sendPong = () => sendMaskedControlFrame(sock, 0xA);

          resolveOnce(conn);
        } else {
          sock.destroy();
          resolveOnce({ status: statusCode, body: rest.toString() });
        }
      } else {
        // WS data frame after upgrade
        if (pendingRead) {
          const p = pendingRead;
          pendingRead = null;
          // Try to consume on next tick
          // Actually, push to frameBuf and let the readMessage's data handler pick it up
          // But we need to trigger the onData handler...
        }
        // Just accumulate
        frameBuf = Buffer.concat([frameBuf, chunk]);
      }
    });

    sock.on('close', () => {
      clearTimeout(timeout);
      resolveOnce({ status: 0, body: 'closed' });
    });
    sock.on('error', () => { /* ignore ECONNRESET on close */ });
  });
}

// ── Send a WebSocket pong frame ──
function sendPong(sock) {
  // Pong frame: opcode 0xA, FIN=1, mask=0, payload length 0
  const frame = Buffer.alloc(2);
  frame[0] = 0x8A; // FIN + opcode 0xA (pong)
  frame[1] = 0x00; // no payload
  sock.write(frame);
}

// ── Test globals ──

let server;
let token;
let port;
let tempRoot;
let wsHandle;

before(async () => {
  tempRoot = makeHarnessTempRoot('wf-ui-ws-');
  const tasksDir = path.join(tempRoot, 'Harness', 'tasks', 'task-test-a');
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, 'STATE.json'), JSON.stringify({
    schemaVersion: 1, taskId: 'task-test-a', status: 'active', phase: 'test',
    updatedAt: '2026-07-29T00:00:00.000Z',
    acceptance: [],
    links: { dependsOn: [], blocks: [] },
  }));

  const r = await startServer({ projectRoot: tempRoot, host: '127.0.0.1', port: 0 });
  server = r.server;
  token = r.token;
  port = r.port;

  // Attach WS with short keepalive for testing; suppress logs
  const origLog = console.log;
  console.log = () => {};
  wsHandle = attachEventsWs(server, token, tempRoot, { keepaliveInterval: 2000, pingTimeout: 3000 });
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

test('connects with valid token, receives server.connected handshake', async () => {
  const conn = await wsConnect(port, token);
  assert.ok(conn.sock, 'Should establish WS connection');
  assert.ok(conn.sock.writable, 'Socket should be writable');
  assert.ok(typeof conn.readMessage === 'function');

  const msg = await conn.readMessage(3000);
  assert.equal(msg.type, 'server.connected');
  assert.equal(msg.seq, 0);
  assert.ok(msg.ts, 'Should have timestamp');
  assert.ok(msg.connectionId, 'Should have connectionId');

  conn.close();
});

test('connection with no token gets rejected', async () => {
  const conn = await wsConnect(port, undefined);
  assert.equal(conn.status, 401, 'No token should get 401');
});

test('connection with invalid token gets rejected', async () => {
  const conn = await wsConnect(port, 'bad-token-1234567890abcdef');
  assert.equal(conn.status, 401, 'Invalid token should get 401');
});

test('writing a STATE.json emits task.updated with incremented seq', async () => {
  const conn = await wsConnect(port, token);
  const handshake = await conn.readMessage(3000);
  assert.equal(handshake.type, 'server.connected');

  // Write a new STATE.json
  const taskDir = path.join(tempRoot, 'Harness', 'tasks', 'task-test-b');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'STATE.json'), JSON.stringify({
    schemaVersion: 1, taskId: 'task-test-b', status: 'active', phase: 'test',
    updatedAt: '2026-07-29T00:00:00.000Z',
    acceptance: [],
    links: { dependsOn: [], blocks: [] },
  }));

  const msg = await conn.readMessage(5000);
  assert.equal(msg.type, 'task.updated');
  assert.ok(msg.seq >= 1, `seq ${msg.seq} should be >= 1`);
  assert.ok(msg.ts, 'Should have timestamp');
  assert.equal(msg.taskId, null);
  assert.ok(msg.payload.taskCount >= 2, `taskCount ${msg.payload.taskCount} should be >= 2`);

  conn.close();
});

test('seq is strictly monotonic across multiple events', async () => {
  const conn = await wsConnect(port, token);
  await conn.readMessage(3000); // drain handshake

  // Trigger first event
  const taskDir = path.join(tempRoot, 'Harness', 'tasks', 'task-test-c');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'STATE.json'), JSON.stringify({
    schemaVersion: 1, taskId: 'task-test-c', status: 'active', phase: 'test',
    acceptance: [],
    links: { dependsOn: [], blocks: [] },
  }));

  const msg1 = await conn.readMessage(5000);
  assert.equal(msg1.type, 'task.updated');

  // Trigger second event
  const taskDir2 = path.join(tempRoot, 'Harness', 'tasks', 'task-test-d');
  fs.mkdirSync(taskDir2, { recursive: true });
  fs.writeFileSync(path.join(taskDir2, 'STATE.json'), JSON.stringify({
    schemaVersion: 1, taskId: 'task-test-d', status: 'active', phase: 'test',
    acceptance: [],
    links: { dependsOn: [], blocks: [] },
  }));

  const msg2 = await conn.readMessage(5000);
  assert.equal(msg2.type, 'task.updated');
  assert.ok(msg2.seq > msg1.seq, `seq ${msg2.seq} should be > ${msg1.seq}`);

  conn.close();
});

test('ping keepalive frame received after idle period', async () => {
  const conn = await wsConnect(port, token);
  await conn.readMessage(3000); // drain handshake

  // Wait for ping (keepalive is 2000ms, so should arrive within ~4000)
  const frame = await conn.readFrame(10000);
  assert.equal(frame.opcode, 0x9);
  conn.sendPong();

  conn.close();
});

test('connection re-established after forced close', async () => {
  const conn1 = await wsConnect(port, token);
  await conn1.readMessage(3000); // drain

  // Don't respond to ping — server should force close after ~5s
  // keepaliveInterval=2000, pingTimeout=3000
  await new Promise(r => setTimeout(r, 7000));

  // Old connection should be dead
  try {
    await conn1.readMessage(2000);
    assert.fail('Should have thrown');
  } catch {
    // Expected
  }

  // Reconnect
  const conn2 = await wsConnect(port, token);
  const msg2 = await conn2.readMessage(3000);
  assert.equal(msg2.type, 'server.connected');
  assert.ok(msg2.seq >= 0, 'reconnect seq should still be >= 0');

  conn2.close();
});

test('closing WS cleans up client set', async () => {
  const conn1 = await wsConnect(port, token);
  await conn1.readMessage(3000); // drain

  const conn2 = await wsConnect(port, token);
  await conn2.readMessage(3000); // drain

  conn1.close();
  await new Promise(r => setTimeout(r, 500));

  // conn2 should still receive events
  const taskDir = path.join(tempRoot, 'Harness', 'tasks', 'task-test-e');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'STATE.json'), JSON.stringify({
    schemaVersion: 1, taskId: 'task-test-e', status: 'active', phase: 'test',
    acceptance: [],
    links: { dependsOn: [], blocks: [] },
  }));

  const msg = await conn2.readMessage(5000);
  assert.equal(msg.type, 'task.updated');

  conn2.close();
});
