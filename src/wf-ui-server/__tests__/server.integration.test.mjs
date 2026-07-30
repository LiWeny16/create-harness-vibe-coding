import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';

function fetchJson(baseUrl, token, route) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    if (token !== undefined) url.searchParams.set('token', token);
    http.get(url.toString(), (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, body }); }
      });
    }).on('error', reject);
  });
}

function authGet(baseUrl, token, route) {
  const url = new URL(route, baseUrl);
  return new Promise((resolve, reject) => {
    http.get({ hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    }).on('error', reject);
  });
}

function postJson(baseUrl, token, route, payload = {}) {
  const url = new URL(route, baseUrl);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let responseBody = '';
      res.on('data', c => responseBody += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(responseBody) }); }
        catch { resolve({ status: res.statusCode, body: responseBody }); }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

let server, baseUrl, token, tempRoot;

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-ui-test-'));
  const tasksDir = path.join(tempRoot, 'Harness', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  const ta = path.join(tasksDir, 'task-alpha');
  fs.mkdirSync(ta);
  fs.writeFileSync(path.join(ta, 'STATE.json'), JSON.stringify({
    schemaVersion: 1, taskId: 'task-alpha', status: 'active', phase: 'intake',
    updatedAt: '2026-07-29T10:00:00.000Z',
    acceptance: [{ id: 'AC-001', text: 'Alpha', status: 'pending' }],
    links: { dependsOn: [], blocks: [] }
  }));
  fs.writeFileSync(path.join(ta, 'PLAN.md'), '# Plan');
  fs.writeFileSync(path.join(ta, 'PROGRESS.md'), '# Progress');

  const tb = path.join(tasksDir, 'task-beta');
  fs.mkdirSync(tb);
  fs.writeFileSync(path.join(tb, 'STATE.json'), JSON.stringify({
    schemaVersion: 1, taskId: 'task-beta', status: 'active', phase: 'implementation',
    updatedAt: '2026-07-29T09:00:00.000Z',
    acceptance: [{ id: 'AC-002', text: 'Beta', status: 'passed' }],
    links: { dependsOn: ['task-alpha'], blocks: [] }
  }));

  const hd = path.join(tempRoot, 'Harness');
  fs.writeFileSync(path.join(hd, 'settings.json'), JSON.stringify({ ui: { language: 'zh' } }));
  fs.writeFileSync(path.join(hd, '.harness-version'), JSON.stringify({ version: '0.8.19' }));

  const r = await startServer({ projectRoot: tempRoot, host: '127.0.0.1', port: 0 });
  server = r.server; token = r.token; baseUrl = `http://127.0.0.1:${r.port}`;
});

after(async () => {
  if (server) await stopServer(server);
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('binds to 127.0.0.1', () => { const a = server.address(); assert.equal(a.address, '127.0.0.1'); });
test('port > 0 with port=0', () => { assert.ok(server.address().port > 0); });
test('health returns 200', async () => { const { status, body } = await fetchJson(baseUrl, token, '/api/health'); assert.equal(status, 200); assert.equal(body.status, 'ok'); });
test('health auth via Bearer', async () => { const { status, body } = await authGet(baseUrl, token, '/api/health'); assert.equal(status, 200); assert.equal(body.status, 'ok'); });
test('no token -> 401', async () => { const { status, body } = await fetchJson(baseUrl, undefined, '/api/tasks'); assert.equal(status, 401); assert.equal(body.error.code, 'UNAUTHORIZED'); });
test('bad token -> 403', async () => { const { status } = await fetchJson(baseUrl, 'bad-token-1234567890abcdef', '/api/tasks'); assert.equal(status, 403); });
test('project returns root + version', async () => { const { status, body } = await fetchJson(baseUrl, token, '/api/project'); assert.equal(status, 200); assert.equal(body.root, tempRoot); assert.equal(body.version, '0.8.19'); });
test('tasks returns array sorted desc', async () => { const { status, body } = await fetchJson(baseUrl, token, '/api/tasks'); assert.equal(status, 200); assert.ok(body.length >= 2); assert.equal(body[0].taskId, 'task-alpha'); });
test('tasks/:id returns single', async () => { const { status, body } = await fetchJson(baseUrl, token, '/api/tasks/task-beta'); assert.equal(status, 200); assert.equal(body.taskId, 'task-beta'); });
test('tasks/:id missing -> 404', async () => { const { status } = await fetchJson(baseUrl, token, '/api/tasks/task-nonexist'); assert.equal(status, 404); });
test('tasks with invalid chars -> 400', async () => { const { status } = await fetchJson(baseUrl, token, '/api/tasks/task%00inject'); assert.equal(status, 400); });
test('settings merged', async () => { const { status, body } = await fetchJson(baseUrl, token, '/api/settings'); assert.equal(status, 200); assert.equal(body.server.host, '127.0.0.1'); assert.equal(body.ui.language, 'zh'); });
test('sessions empty when no registry', async () => { const { status, body } = await fetchJson(baseUrl, token, '/api/sessions'); assert.equal(status, 200); assert.ok(Array.isArray(body)); assert.equal(body.length, 0); });
test('error envelope format', async () => { const { status, body } = await fetchJson(baseUrl, undefined, '/api/tasks'); assert.equal(status, 401); assert.ok(body.error.code); assert.ok(body.error.message); });
test('content-type json', async () => { const { status, headers } = await fetchJson(baseUrl, token, '/api/health'); assert.equal(status, 200); assert.match(headers['content-type'], /application\/json/); });
test('unknown route 404', async () => { const { status } = await fetchJson(baseUrl, token, '/api/nope'); assert.equal(status, 404); });

test('session stop is idempotent and removes session from live list', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-ui-stop-test-'));
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  try {
    const session = registry.create({ runtime: 'claude' });
    registry.update(session.sessionId, { status: 'running' });

    const first = await postJson(localBaseUrl, started.token, `/api/sessions/${session.sessionId}/stop`);
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.saved.status, 'saved');

    const live = await fetchJson(localBaseUrl, started.token, '/api/sessions');
    assert.equal(live.status, 200);
    assert.deepEqual(live.body, []);

    const second = await postJson(localBaseUrl, started.token, `/api/sessions/${session.sessionId}/stop`);
    assert.equal(second.status, 200);
    assert.equal(second.body.ok, true);
    assert.equal(second.body.alreadyStopped, true);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
