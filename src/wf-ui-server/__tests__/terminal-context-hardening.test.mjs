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
    if (item.outsideRoot) fs.rmSync(item.outsideRoot, { recursive: true, force: true });
  }
});

async function makeServer() {
  const root = makeHarnessTempRoot('wf-terminal-context-hardening-');
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

function createRunningSession(root, registry, runtime = 'codex') {
  const session = registry.create({ runtime, agentKind: 'main', projectRoot: root, cwd: root });
  registry.update(session.sessionId, { status: 'running' });
  cleanup.at(-1).sessionIds.push(session.sessionId);
  return session;
}

function createEscapeDirectoryLink(t, projectRoot) {
  const outsideRoot = makeHarnessTempRoot('wf-terminal-context-outside-');
  fs.writeFileSync(path.join(outsideRoot, 'secret.txt'), 'outside-secret', 'utf8');
  const linkPath = path.join(projectRoot, 'linked-outside');
  try {
    fs.symlinkSync(outsideRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    fs.rmSync(outsideRoot, { recursive: true, force: true });
    t.skip(`Symlink/junction creation unavailable on this platform: ${err.message}`);
    return null;
  }
  cleanup.at(-1).outsideRoot = outsideRoot;
  return { outsideRoot, linkPath };
}

test('AC-004 hardening context-input API rejects symlink or junction escaped files before PTY write', async (t) => {
  const { root, baseUrl, token, registry } = await makeServer();
  const fixture = createEscapeDirectoryLink(t, root);
  if (!fixture) return;
  const session = createRunningSession(root, registry, 'codex');
  const written = [];
  registerPtyProcess(session.sessionId, { write: data => written.push(data) });

  const result = await postJson(baseUrl, token, `/api/sessions/${session.sessionId}/context-input`, {
    inputOwnerId: 'drawer-terminal',
    items: [{ kind: 'workspace-file', path: 'linked-outside/secret.txt', format: 'tag' }],
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'BAD_REQUEST');
  assert.match(result.body.error.message, /symlink|junction|outside workspace|escape/i);
  assert.deepEqual(written, []);
  assert.equal(registry.get(session.sessionId).inputOwnerId, '');
});

test('AC-004 hardening context-input persists owner and logs before PTY write on disk failure', async () => {
  const { root, baseUrl, token, registry } = await makeServer();
  fs.writeFileSync(path.join(root, 'README.md'), '# readme\n', 'utf8');
  const session = createRunningSession(root, registry, 'claude');
  const written = [];
  registerPtyProcess(session.sessionId, { write: data => written.push(data) });

  const sessionsRoot = path.join(root, 'Harness', 'a2a', 'sessions');
  fs.rmSync(sessionsRoot, { recursive: true, force: true });
  fs.writeFileSync(sessionsRoot, 'not-a-directory', 'utf8');

  const result = await postJson(baseUrl, token, `/api/sessions/${session.sessionId}/context-input`, {
    inputOwnerId: 'embedded-terminal',
    items: [{ kind: 'workspace-file', path: 'README.md', format: 'tag' }],
  });

  assert.ok(result.status >= 400, `expected persistence failure, got ${result.status}: ${JSON.stringify(result.body)}`);
  assert.deepEqual(written, [], 'PTY input must not be written if owner/session persistence fails');
  assert.equal(registry.get(session.sessionId).inputOwnerId, '', 'memory owner should not advance when durable state fails');
});
