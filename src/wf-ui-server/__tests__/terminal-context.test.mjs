import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import { registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) {
    const item = cleanup.pop();
    if (item.sessionIds) {
      for (const sessionId of item.sessionIds) unregisterPtyProcess(sessionId);
    }
    if (item.server) await stopServer(item.server);
    if (item.root) fs.rmSync(item.root, { recursive: true, force: true });
  }
});

async function makeServer() {
  const root = makeHarnessTempRoot('wf-terminal-context-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  cleanup.push({ root, server: started.server, sessionIds: [] });
  return { ...started, root, registry, baseUrl: `http://127.0.0.1:${started.port}` };
}

function postJson(baseUrl, token, route, payload) {
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
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(responseBody) }); }
        catch { resolve({ status: res.statusCode, body: responseBody }); }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('AC-003 AC-004 context-input inserts workspace file/folder tags and acquires active input owner', async () => {
  const { root, baseUrl, token, registry } = await makeServer();
  fs.mkdirSync(path.join(root, 'src', 'feature'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'feature', 'index.ts'), 'export const ok = true;\n');
  const session = registry.create({ runtime: 'codex', agentKind: 'main', projectRoot: root, cwd: root });
  registry.update(session.sessionId, { status: 'running' });
  cleanup.at(-1).sessionIds.push(session.sessionId);
  const written = [];
  registerPtyProcess(session.sessionId, { write: data => written.push(data) });

  const result = await postJson(baseUrl, token, `/api/sessions/${session.sessionId}/context-input`, {
    inputOwnerId: 'drawer-terminal',
    items: [
      { kind: 'workspace-file', path: 'src/feature/index.ts', format: 'tag' },
      { kind: 'workspace-folder', path: 'src/feature', format: 'tag' },
    ],
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.inputOwnerId, 'drawer-terminal');
  assert.equal(result.body.ptySessionId, session.sessionId);
  assert.equal(result.body.terminalInput, '@file(src/feature/index.ts) @folder(src/feature)');
  assert.deepEqual(written, ['@file(src/feature/index.ts) @folder(src/feature)']);
  assert.equal(registry.get(session.sessionId).inputOwnerId, 'drawer-terminal');
  assert.equal(registry.get(session.sessionId).ptySessionId, session.sessionId);
});

test('AC-003 AC-004 context-input supports Shift/absolute-path format for workspace and user files', async () => {
  const { root, baseUrl, token, registry } = await makeServer();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export {};\n');
  fs.mkdirSync(path.join(root, 'Harness', 'user-files', 'images'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'user-files', 'images', 'shot.png'), 'png');
  const session = registry.create({ runtime: 'claude', agentKind: 'subagent', projectRoot: root, cwd: root });
  registry.update(session.sessionId, { status: 'running' });
  cleanup.at(-1).sessionIds.push(session.sessionId);
  const written = [];
  registerPtyProcess(session.sessionId, { write: data => written.push(data) });

  const result = await postJson(baseUrl, token, `/api/sessions/${session.sessionId}/context-input`, {
    inputOwnerId: 'embedded-terminal',
    shiftKey: true,
    items: [
      { kind: 'workspace-file', path: 'src/a.ts' },
      { kind: 'user-file', path: 'Harness/user-files/images/shot.png' },
    ],
  });

  const expected = [
    path.join(root, 'src', 'a.ts'),
    path.join(root, 'Harness', 'user-files', 'images', 'shot.png'),
  ].join(' ');
  assert.equal(result.status, 200);
  assert.equal(result.body.terminalInput, expected);
  assert.deepEqual(written, [expected]);
  assert.equal(registry.get(session.sessionId).inputOwnerId, 'embedded-terminal');
});

test('AC-003 AC-004 context-input rejects paths escaping the workspace and missing files', async () => {
  const { root, baseUrl, token, registry } = await makeServer();
  const session = registry.create({ runtime: 'codex', agentKind: 'main', projectRoot: root, cwd: root });
  registry.update(session.sessionId, { status: 'running' });

  const traversal = await postJson(baseUrl, token, `/api/sessions/${session.sessionId}/context-input`, {
    inputOwnerId: 'drawer-terminal',
    items: [{ kind: 'workspace-file', path: '../secret.txt', format: 'tag' }],
  });
  const missing = await postJson(baseUrl, token, `/api/sessions/${session.sessionId}/context-input`, {
    inputOwnerId: 'drawer-terminal',
    items: [{ kind: 'workspace-file', path: 'src/missing.ts', format: 'tag' }],
  });

  assert.equal(traversal.status, 400);
  assert.equal(traversal.body.error.code, 'BAD_REQUEST');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('AC-004 multiple terminal views share one PTY session while focus changes the input owner', async () => {
  const { root, baseUrl, token, registry } = await makeServer();
  fs.writeFileSync(path.join(root, 'README.md'), '# readme\n');
  const session = registry.create({ runtime: 'opencode', agentKind: 'main', projectRoot: root, cwd: root });
  registry.update(session.sessionId, { status: 'running', ptySessionId: session.sessionId });
  cleanup.at(-1).sessionIds.push(session.sessionId);
  const written = [];
  registerPtyProcess(session.sessionId, { write: data => written.push(data) });

  const drawer = await postJson(baseUrl, token, `/api/sessions/${session.sessionId}/context-input`, {
    inputOwnerId: 'drawer-view',
    items: [{ kind: 'workspace-file', path: 'README.md', format: 'tag' }],
  });
  const embedded = await postJson(baseUrl, token, `/api/sessions/${session.sessionId}/context-input`, {
    inputOwnerId: 'embedded-view',
    items: [{ kind: 'workspace-file', path: 'README.md', format: 'relative-path' }],
  });

  assert.equal(drawer.status, 200);
  assert.equal(embedded.status, 200);
  assert.equal(drawer.body.ptySessionId, session.sessionId);
  assert.equal(embedded.body.ptySessionId, session.sessionId);
  assert.equal(registry.get(session.sessionId).inputOwnerId, 'embedded-view');
  assert.deepEqual(written, ['@file(README.md)', 'README.md']);
  assert.equal(registry.getAll().filter(item => item.sessionId === session.sessionId).length, 1);
});
