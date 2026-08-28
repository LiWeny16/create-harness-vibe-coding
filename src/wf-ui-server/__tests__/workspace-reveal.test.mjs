import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';
import { planRevealWorkspacePath } from '../workspace-store.mjs';

// task-wf-ui-terminal-explorer-ux AC-009: /api/workspace/reveal must validate
// containment + existence before launching anything, and construct the right
// per-platform spawn plan. Plan-level tests never spawn; the HTTP-level test
// runs the route under WF_UI_REVEAL_DRY_RUN=1 so no OS window opens.

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) {
    const item = cleanup.pop();
    if (item.server) await stopServer(item.server);
    if (item.root) fs.rmSync(item.root, { recursive: true, force: true });
  }
});

function tempRoot() {
  const root = makeHarnessTempRoot('wf-workspace-reveal-');
  cleanup.push({ root });
  return root;
}

function requestJson(baseUrl, method, route, payload) {
  const url = new URL(route, baseUrl);
  const body = payload === undefined ? null : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { /* non-JSON body */ }
        resolve({ status: res.statusCode, data, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('planRevealWorkspacePath rejects paths escaping the workspace', () => {
  const root = tempRoot();
  assert.throws(
    () => planRevealWorkspacePath(root, '../outside-secret.txt'),
    (e) => e.statusCode === 400,
    'traversal must be rejected with a 400-class WorkspaceStoreError',
  );
  assert.throws(
    () => planRevealWorkspacePath(root, '..'),
    (e) => e.statusCode === 400,
    'bare parent traversal must be rejected',
  );
});

test('planRevealWorkspacePath rejects missing paths with 404', () => {
  const root = tempRoot();
  assert.throws(
    () => planRevealWorkspacePath(root, 'does-not-exist.md'),
    (e) => e.statusCode === 404 && e.code === 'NOT_FOUND',
    'missing paths must 404 before any spawn plan is built',
  );
});

test('planRevealWorkspacePath builds the per-platform plan for file and directory', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sub', 'note.md'), '# hi');

  const filePlan = planRevealWorkspacePath(root, 'sub/note.md');
  assert.equal(filePlan.path, 'sub/note.md');
  assert.equal(filePlan.isDirectory, false);
  assert.equal(filePlan.absolutePath, path.join(root, 'sub', 'note.md'));

  const dirPlan = planRevealWorkspacePath(root, 'sub');
  assert.equal(dirPlan.isDirectory, true);
  assert.equal(dirPlan.absolutePath, path.join(root, 'sub'));

  if (process.platform === 'win32') {
    assert.equal(filePlan.command, 'explorer.exe');
    assert.equal(filePlan.args[0], `/select,${filePlan.absolutePath}`);
    assert.deepEqual(dirPlan.args, [dirPlan.absolutePath]);
  } else if (process.platform === 'darwin') {
    assert.equal(filePlan.command, 'open');
    assert.deepEqual(filePlan.args, ['-R', filePlan.absolutePath]);
    assert.deepEqual(dirPlan.args, [dirPlan.absolutePath]);
  } else {
    assert.equal(filePlan.command, 'xdg-open');
    assert.deepEqual(filePlan.args, [path.dirname(filePlan.absolutePath)]);
    assert.deepEqual(dirPlan.args, [dirPlan.absolutePath]);
  }

  // Absolute paths inside the workspace are also accepted (File node framing).
  const absPlan = planRevealWorkspacePath(root, filePlan.absolutePath);
  assert.equal(absPlan.path, 'sub/note.md');
});

test('POST /api/workspace/reveal validates under dry-run and never spawns', async () => {
  const prev = process.env.WF_UI_REVEAL_DRY_RUN;
  process.env.WF_UI_REVEAL_DRY_RUN = '1';
  try {
    const root = makeHarnessTempRoot('wf-workspace-reveal-http-');
    fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'readme.md'), '# doc');
    const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0 });
    cleanup.push({ server: started.server, root });
    const baseUrl = `http://127.0.0.1:${started.port}`;

    const ok = await requestJson(baseUrl, 'POST', '/api/workspace/reveal', { path: 'docs/readme.md' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.ok, true);
    assert.equal(ok.data.dryRun, true);
    assert.equal(ok.data.path, 'docs/readme.md');

    const traversal = await requestJson(baseUrl, 'POST', '/api/workspace/reveal', { path: '../../etc/passwd' });
    assert.equal(traversal.status, 400);

    const missing = await requestJson(baseUrl, 'POST', '/api/workspace/reveal', { path: 'nope.txt' });
    assert.equal(missing.status, 404);
  } finally {
    process.env.WF_UI_REVEAL_DRY_RUN = prev;
  }
});