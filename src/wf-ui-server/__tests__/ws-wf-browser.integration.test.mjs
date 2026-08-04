import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';
import { attachWfBrowserWs } from '../ws-wf-browser.mjs';

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) {
    const item = cleanup.pop();
    if (item.wsHandle) await item.wsHandle.close();
    if (item.server) await stopServer(item.server);
    if (item.root) fs.rmSync(item.root, { recursive: true, force: true });
  }
});

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
  if (masked) return null;
  if (buf.length < offset + payloadLen) return null;
  return {
    opcode,
    payload: buf.slice(offset, offset + payloadLen).toString('utf8'),
    totalLen: offset + payloadLen,
  };
}

function sendMaskedText(sock, value) {
  const data = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  const maskKey = crypto.randomBytes(4);
  const masked = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i += 1) masked[i] = data[i] ^ maskKey[i % 4];
  let header;
  if (data.length < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x81;
    header[1] = 0x80 | data.length;
    maskKey.copy(header, 2);
  } else {
    header = Buffer.alloc(8);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
    maskKey.copy(header, 4);
  }
  sock.write(Buffer.concat([header, masked]));
}

async function wsConnect(port, tokenValue) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      const wsKey = 'dGhlIHNhbXBsZSBub25jZQ==';
      const q = tokenValue !== undefined && tokenValue !== null
        ? `token=${encodeURIComponent(tokenValue)}` : '';
      sock.write(
        `GET /ws/wf-browser?${q} HTTP/1.1\r\n` +
        'Host: 127.0.0.1\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${wsKey}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });

    let resolved = false;
    let frameBuf = Buffer.alloc(0);
    let httpHeaderDone = false;
    const resolveOnce = (value) => {
      if (!resolved) {
        resolved = true;
        resolve(value);
      }
    };
    const timeout = setTimeout(() => {
      sock.destroy();
      resolveOnce({ status: 0, body: 'timeout' });
    }, 10000);

    sock.on('data', (chunk) => {
      if (!httpHeaderDone) {
        frameBuf = Buffer.concat([frameBuf, chunk]);
        const headerEnd = frameBuf.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = frameBuf.slice(0, headerEnd).toString();
        const rest = frameBuf.slice(headerEnd + 4);
        const statusCode = parseInt(header.split(' ')[1] || '0', 10);
        clearTimeout(timeout);
        if (statusCode !== 101) {
          sock.destroy();
          resolveOnce({ status: statusCode, body: rest.toString() });
          return;
        }
        httpHeaderDone = true;
        frameBuf = rest;
        const conn = {
          sock,
          close() { sock.destroy(); },
          send(value) { sendMaskedText(sock, value); },
          readMessage(ms = 10000) {
            return new Promise((res, rej) => {
              function consumeBuffer() {
                const frame = tryParseFrame(frameBuf);
                if (!frame) return false;
                frameBuf = frameBuf.slice(frame.totalLen);
                if (frame.opcode === 0x8) {
                  sock.destroy();
                  rej(new Error('Connection closed'));
                  return true;
                }
                if (frame.opcode !== 0x1) return false;
                try { res(JSON.parse(frame.payload)); } catch (e) { rej(e); }
                return true;
              }
              if (consumeBuffer()) return;
              const tid = setTimeout(() => rej(new Error('timeout')), ms);
              const onData = () => consumeBuffer() && cleanupRead();
              const onClose = () => { cleanupRead(); rej(new Error('Connection closed')); };
              const cleanupRead = () => {
                clearTimeout(tid);
                sock.off('data', onData);
                sock.off('close', onClose);
              };
              sock.on('data', onData);
              sock.on('close', onClose);
            });
          },
        };
        resolveOnce(conn);
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

function requestJson(baseUrl, token, method, route, payload) {
  const url = new URL(route, baseUrl);
  const body = payload === undefined ? null : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(responseBody) }); }
        catch { resolve({ status: res.statusCode, body: responseBody }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function getJson(baseUrl, token, route) {
  return requestJson(baseUrl, token, 'GET', route);
}

function postJson(baseUrl, token, route, payload) {
  return requestJson(baseUrl, token, 'POST', route, payload);
}

function runNode(args, { cwd, env, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${args.join(' ')}`));
    }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: code, signal, stdout, stderr });
    });
  });
}

async function makeServer() {
  const root = makeHarnessTempRoot('wf-browser-ws-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const wfBrowserHub = {};
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, wfBrowserHub });
  const wsHandle = attachWfBrowserWs(started.server, started.token, root, {
    keepaliveInterval: 2000,
    pingTimeout: 3000,
  });
  Object.assign(wfBrowserHub, wsHandle);
  cleanup.push({ root, server: started.server, wsHandle });
  return { ...started, root, baseUrl: `http://127.0.0.1:${started.port}` };
}

async function createRunWindowLease(baseUrl, token, leaseType = 'control') {
  const run = await postJson(baseUrl, token, '/api/wf-browser/runs', {
    mode: 'runtime',
    agentId: 'agent-a',
    route: '/workflow',
  });
  assert.equal(run.status, 201);
  const win = await postJson(baseUrl, token, `/api/wf-browser/runs/${run.body.run.runId}/windows`, {
    agentId: 'agent-a',
    route: '/workflow',
  });
  assert.equal(win.status, 201);
  const lease = await postJson(baseUrl, token, `/api/wf-browser/runs/${run.body.run.runId}/windows/${win.body.window.windowId}/lease`, {
    type: leaseType,
    agentId: 'agent-a',
    ttlMs: 60_000,
  });
  assert.equal(lease.status, 201);
  return { run: run.body.run, window: win.body.window, lease: lease.body.lease };
}

test('wf-browser websocket registers a frontend and dispatches observe command results through HTTP API', async () => {
  const { root, baseUrl, token, port } = await makeServer();
  const { run, window, lease } = await createRunWindowLease(baseUrl, token);
  const conn = await wsConnect(port, token);
  assert.ok(conn.sock);
  const connected = await conn.readMessage();
  assert.equal(connected.type, 'wf-browser.connected');

  conn.send({
    type: 'hello',
    role: 'frontend',
    runId: run.runId,
    windowId: window.windowId,
    agentId: 'agent-a',
    route: { pathname: '/workflow' },
    capabilities: [{ id: 'route.workflow', kind: 'route', label: 'Workflow' }],
  });
  const helloAck = await conn.readMessage();
  assert.equal(helloAck.type, 'hello.ack');
  assert.equal(helloAck.status, 'registered');

  const connections = await getJson(baseUrl, token, '/api/wf-browser/connections');
  assert.equal(connections.status, 200);
  assert.equal(connections.body.connections.length, 1);
  assert.equal(connections.body.connections[0].windowId, window.windowId);

  const apiResultPromise = postJson(baseUrl, token, `/api/wf-browser/runs/${run.runId}/windows/${window.windowId}/commands`, {
    primitive: 'observe.route',
    agentId: 'agent-a',
    leaseId: lease.leaseId,
  });
  const command = await conn.readMessage();
  assert.equal(command.type, 'command');
  assert.equal(command.primitive, 'observe.route');
  conn.send({ type: 'ack', commandId: command.commandId, status: 'accepted' });
  conn.send({
    type: 'result',
    commandId: command.commandId,
    status: 'ok',
    result: { pathname: '/workflow', title: 'Workflow' },
  });

  const apiResult = await apiResultPromise;
  assert.equal(apiResult.status, 200);
  assert.equal(apiResult.body.command.status, 'ok');
  assert.equal(apiResult.body.command.result.pathname, '/workflow');
  assert.ok(apiResult.body.artifact.path.endsWith(`${command.commandId}.json`));
  assert.equal(fs.existsSync(path.join(root, apiResult.body.artifact.path)), true);

  const replayResultPromise = postJson(baseUrl, token, `/api/wf-browser/runs/${run.runId}/windows/${window.windowId}/commands`, {
    primitive: 'observe.replay',
    agentId: 'agent-a',
    leaseId: lease.leaseId,
  });
  const replayCommand = await conn.readMessage();
  assert.equal(replayCommand.type, 'command');
  assert.equal(replayCommand.primitive, 'observe.replay');
  conn.send({ type: 'ack', commandId: replayCommand.commandId, status: 'accepted' });
  conn.send({
    type: 'result',
    commandId: replayCommand.commandId,
    status: 'ok',
    result: { entries: [{ primitive: 'observe.route', status: 'ok' }] },
  });

  const replayResult = await replayResultPromise;
  assert.equal(replayResult.status, 200);
  assert.equal(replayResult.body.command.status, 'ok');
  assert.match(replayResult.body.artifact.path, /\/replay\//);
  assert.ok(replayResult.body.artifact.path.endsWith(`${replayCommand.commandId}.json`));
  assert.equal(fs.existsSync(path.join(root, replayResult.body.artifact.path)), true);

  conn.close();
});

test('wf-browser command API enforces lease type and connected window requirements', async () => {
  const { baseUrl, token } = await makeServer();
  const observe = await createRunWindowLease(baseUrl, token, 'observe');
  const actWithObserveLease = await postJson(baseUrl, token, `/api/wf-browser/runs/${observe.run.runId}/windows/${observe.window.windowId}/commands`, {
    primitive: 'act.click',
    agentId: 'agent-a',
    leaseId: observe.lease.leaseId,
    payload: { target: { testId: 'save' } },
  });
  assert.equal(actWithObserveLease.status, 403);
  assert.equal(actWithObserveLease.body.error.code, 'CONTROL_LEASE_REQUIRED');

  const control = await createRunWindowLease(baseUrl, token, 'control');
  const noFrontend = await postJson(baseUrl, token, `/api/wf-browser/runs/${control.run.runId}/windows/${control.window.windowId}/commands`, {
    primitive: 'observe.route',
    agentId: 'agent-a',
    leaseId: control.lease.leaseId,
  });
  assert.equal(noFrontend.status, 409);
  assert.equal(noFrontend.body.error.code, 'WINDOW_NOT_CONNECTED');
});

test('wf-ui-control browser-snapshot captures connected window observations through the bridge', async () => {
  const { root, baseUrl, token, port } = await makeServer();
  const { run, window, lease } = await createRunWindowLease(baseUrl, token);
  const conn = await wsConnect(port, token);
  assert.ok(conn.sock);
  await conn.readMessage();

  conn.send({
    type: 'hello',
    role: 'frontend',
    runId: run.runId,
    windowId: window.windowId,
    agentId: 'agent-a',
    route: { pathname: '/workflow' },
    capabilities: [{ id: 'route.workflow', kind: 'route', label: 'Workflow' }],
  });
  await conn.readMessage();

  const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
  const snapshotPromise = runNode([
    script,
    'browser-snapshot',
    '--project',
    root,
    '--run',
    run.runId,
    '--window',
    window.windowId,
    '--lease',
    lease.leaseId,
    '--agent',
    'agent-a',
    '--primitives',
    'observe.route,observe.uiTree,observe.diff',
  ], {
    cwd: root,
    env: {
      ...process.env,
      HARNESS_WF_UI_URL: baseUrl,
      HARNESS_WF_UI_TOKEN: token,
      HARNESS_PEER_SESSION_ID: 'agent-a',
    },
  });

  const expected = ['observe.route', 'observe.uiTree', 'observe.diff'];
  for (const primitive of expected) {
    const command = await conn.readMessage();
    assert.equal(command.type, 'command');
    assert.equal(command.primitive, primitive);
    conn.send({ type: 'ack', commandId: command.commandId, status: 'accepted' });
    conn.send({
      type: 'result',
      commandId: command.commandId,
      status: 'ok',
      result: { primitive, pathname: '/workflow' },
    });
  }

  const snapshot = await snapshotPromise;
  assert.equal(snapshot.status, 0, snapshot.stderr || snapshot.stdout);
  const body = JSON.parse(snapshot.stdout);
  assert.equal(body.ok, true);
  assert.deepEqual(body.primitives, expected);
  assert.equal(body.results.length, expected.length);
  assert.equal(body.artifacts.length, expected.length);
  assert.equal(body.connection.windowId, window.windowId);
  for (const artifact of body.artifacts) {
    assert.equal(fs.existsSync(path.join(root, artifact.path)), true);
  }
  assert.match(body.artifacts.at(-1).path, /\/analysis\//);

  conn.close();
});

test('wf-ui-control browser-wait returns after a delayed frontend registration', async () => {
  const { root, baseUrl, token, port } = await makeServer();
  const { run, window, lease } = await createRunWindowLease(baseUrl, token);
  const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
  const waitPromise = runNode([
    script,
    'browser-wait',
    '--project',
    root,
    '--run',
    run.runId,
    '--window',
    window.windowId,
    '--agent',
    'agent-a',
    '--timeout',
    '5000',
    '--interval',
    '50',
  ], {
    cwd: root,
    env: {
      ...process.env,
      HARNESS_WF_UI_URL: baseUrl,
      HARNESS_WF_UI_TOKEN: token,
      HARNESS_PEER_SESSION_ID: 'agent-a',
    },
  });

  await new Promise(resolve => setTimeout(resolve, 120));
  const conn = await wsConnect(port, token);
  assert.ok(conn.sock);
  await conn.readMessage();
  conn.send({
    type: 'hello',
    role: 'frontend',
    runId: run.runId,
    windowId: window.windowId,
    agentId: 'agent-a',
    route: { pathname: '/workflow' },
    capabilities: [{ id: 'route.workflow', kind: 'route', label: 'Workflow' }],
  });
  await conn.readMessage();

  const waited = await waitPromise;
  assert.equal(waited.status, 0, waited.stderr || waited.stdout);
  const body = JSON.parse(waited.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.runId, run.runId);
  assert.equal(body.windowId, window.windowId);
  assert.equal(body.connection.agentId, 'agent-a');
  assert.equal(body.connection.windowId, window.windowId);
  assert.equal(lease.type, 'control');

  conn.close();
});
