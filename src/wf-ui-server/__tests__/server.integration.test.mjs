import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { spawn } from 'node:child_process';
import { startServer, stopServer, terminalReadyForInitialInput } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import { createComponentNode } from '../component-node-store.mjs';
import { appendTerminalData, listTerminalSessions, persistSession } from '../terminal-store.mjs';
import { writeWorkflowGraphMap } from '../a2a-store.mjs';
import { registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';
import { CODEX_UPDATE_SKIP_SESSION_KEYS, CODEX_UPDATE_SKIP_UNTIL_NEXT_VERSION_KEYS } from '../codex-update-prompt.mjs';
import { graphReadToken } from '../control-plane-token.mjs';

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

function postJson(baseUrl, token, route, payload = {}, extraHeaders = {}) {
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
        ...extraHeaders,
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

function deleteJson(baseUrl, token, route) {
  const url = new URL(route, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let responseBody = '';
      res.on('data', c => responseBody += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(responseBody) }); }
        catch { resolve({ status: res.statusCode, body: responseBody }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function readJsonlFile(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeout = 5000, step = 25 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise(resolve => setTimeout(resolve, step));
  }
  throw new Error(`waitFor timed out; last=${JSON.stringify(last)}`);
}

function removeHarnessTempRoot(root) {
  const resolved = path.resolve(root);
  const tempRoot = path.resolve('Harness', '.temp') + path.sep;
  assert.ok(resolved.startsWith(tempRoot), `refusing to remove non-Harness temp root: ${root}`);
  try {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 });
  } catch (e) {
    if (process.platform === 'win32' && ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(e?.code)) return;
    throw e;
  }
}

function runNode(args, { cwd, env, timeout = 5000 } = {}) {
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

let server, baseUrl, token, tempRoot;

before(async () => {
  tempRoot = makeHarnessTempRoot('wf-ui-test-');
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
  fs.writeFileSync(path.join(hd, '.harness-version'), JSON.stringify({ version: '0.8.20' }));

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
test('no token can access local API', async () => { const { status, body } = await fetchJson(baseUrl, undefined, '/api/tasks'); assert.equal(status, 200); assert.ok(Array.isArray(body)); });
test('bad token is ignored for local API compatibility', async () => { const { status, body } = await fetchJson(baseUrl, 'bad-token-1234567890abcdef', '/api/tasks'); assert.equal(status, 200); assert.ok(Array.isArray(body)); });
test('project returns root + version', async () => { const { status, body } = await fetchJson(baseUrl, token, '/api/project'); assert.equal(status, 200); assert.equal(body.root, tempRoot); assert.equal(body.version, '0.8.20'); });
test('tasks returns array sorted desc', async () => { const { status, body } = await fetchJson(baseUrl, token, '/api/tasks'); assert.equal(status, 200); assert.ok(body.length >= 2); assert.equal(body[0].taskId, 'task-alpha'); });
test('tasks/:id returns single', async () => { const { status, body } = await fetchJson(baseUrl, token, '/api/tasks/task-beta'); assert.equal(status, 200); assert.equal(body.taskId, 'task-beta'); });
test('tasks/:id missing -> 404', async () => { const { status } = await fetchJson(baseUrl, token, '/api/tasks/task-nonexist'); assert.equal(status, 404); });
test('tasks with invalid chars -> 400', async () => { const { status } = await fetchJson(baseUrl, token, '/api/tasks/task%00inject'); assert.equal(status, 400); });
test('settings merged', async () => { const { status, body } = await fetchJson(baseUrl, token, '/api/settings'); assert.equal(status, 200); assert.equal(body.server.host, '127.0.0.1'); assert.equal(body.ui.language, 'zh'); });
test('settings POST preserves non-UI project settings while updating cleanup', async () => {
  const root = makeHarnessTempRoot('wf-ui-settings-save-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'settings.json'), JSON.stringify({
    schema: 'harness-settings@1',
    workflow: { defaultTier: 'auto', taskCapsuleCap: 5 },
    cleanup: { stoppedSessionRetentionDays: 14, detachedLogRetentionHours: 24 },
  }, null, 2));
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0 });
  try {
    const localBaseUrl = `http://127.0.0.1:${started.port}`;
    const result = await postJson(localBaseUrl, started.token, '/api/settings', {
      cleanup: { stoppedSessionRetentionDays: 3 },
    });
    assert.equal(result.status, 200);
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'settings.json'), 'utf8'));
    assert.equal(saved.schema, 'harness-settings@1');
    assert.equal(saved.workflow.taskCapsuleCap, 5);
    assert.equal(saved.cleanup.stoppedSessionRetentionDays, 3);
    assert.equal(saved.cleanup.detachedLogRetentionHours, 24);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
test('sessions empty when no registry', async () => { const { status, body } = await fetchJson(baseUrl, token, '/api/sessions'); assert.equal(status, 200); assert.ok(Array.isArray(body)); assert.equal(body.length, 0); });
test('error envelope format', async () => { const { status, body } = await fetchJson(baseUrl, undefined, '/api/nope'); assert.equal(status, 404); assert.ok(body.error.code); assert.ok(body.error.message); });
test('content-type json', async () => { const { status, headers } = await fetchJson(baseUrl, token, '/api/health'); assert.equal(status, 200); assert.match(headers['content-type'], /application\/json/); });
test('unknown route 404', async () => { const { status } = await fetchJson(baseUrl, token, '/api/nope'); assert.equal(status, 404); });

test('AC-002 /api/a2a/snapshot running status matches /api/sessions and downgrades stale disk sessions', async () => {
  const root = makeHarnessTempRoot('wf-ui-live-source-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  persistSession(root, {
    taskId: null,
    sessionId: 'session-stale-running',
    runtime: 'claude',
    role: 'Subagent',
    status: 'running',
    wsClientCount: 1,
    updatedAt: '2026-07-30T00:00:00.000Z',
  });
  writeWorkflowGraphMap(root, {
    version: 9,
    nodes: [{ nodeId: 'session-session-stale-running', sessionId: 'session-stale-running', runtime: 'claude', status: 'running' }],
    positions: { 'session-session-stale-running': { x: 320, y: 180 } },
  });

  const registry = new SessionRegistry();
  const liveSession = registry.create({
    runtime: 'codex',
    role: 'Main Agent',
    agentKind: 'main',
  });
  registry.update(liveSession.sessionId, { status: 'running' });

  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry, eventsWs: false });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  try {
    const sessions = await fetchJson(localBaseUrl, started.token, '/api/sessions');
    const allSessions = await fetchJson(localBaseUrl, started.token, '/api/sessions?all=1');
    const snapshot = await fetchJson(localBaseUrl, started.token, '/api/a2a/snapshot');

    assert.equal(sessions.status, 200);
    assert.equal(allSessions.status, 200);
    assert.equal(snapshot.status, 200);

    const liveRunningIds = sessions.body
      .filter(session => session.status === 'running')
      .map(session => session.sessionId)
      .sort();
    const live = sessions.body.find(session => session.sessionId === liveSession.sessionId);
    assert.ok(live.resourceUsage, 'live sessions should expose PTY resource details');
    assert.equal(live.resourceUsage.pid, liveSession.pid || null);
    assert.equal(live.resourceUsage.wsClientCount, live.wsClientCount || 0);
    assert.ok(Object.hasOwn(live.resourceUsage, 'memoryBytes'));
    assert.ok(Object.hasOwn(live.resourceUsage, 'ptyProvider'));
    assert.ok(Object.hasOwn(live.resourceUsage, 'cpuPercent'));
    const snapshotRunningIds = snapshot.body.nodes
      .filter(node => node.status === 'running')
      .map(node => node.sessionId)
      .sort();
    assert.deepEqual(snapshotRunningIds, liveRunningIds);

    const staleNode = snapshot.body.nodes.find(node => node.sessionId === 'session-stale-running');
    assert.ok(staleNode, 'stale project graph session should remain visible as stopped history');
    assert.equal(staleNode.status, 'stopped');
    assert.equal(staleNode.blockedReason, 'not-managed-by-current-wf-ui');
    assert.deepEqual(snapshot.body.graph.positions['session-session-stale-running'], { x: 320, y: 180 });
    const staleSession = allSessions.body.find(session => session.sessionId === 'session-stale-running');
    assert.equal(staleSession.status, 'stopped', 'orphaned live disk sessions are downgraded once at backend startup (P1b)');
    assert.equal(staleSession.blockedReason, 'not-managed-by-current-wf-ui');
    assert.equal(staleSession.attachMode, false, 'orphaned disk sessions are watch-only until reattached');
    assert.equal(staleSession.wsClientCount, 0);
    assert.equal(staleSession.resourceUsage.cpuPercent, null);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-002b snapshot incremental polling: ?since= fingerprint returns unchanged until state moves', async () => {
  const root = makeHarnessTempRoot('wf-ui-since-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry, eventsWs: false });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  try {
    const first = await fetchJson(localBaseUrl, started.token, '/api/a2a/snapshot');
    assert.equal(first.status, 200);
    assert.ok(first.body.fingerprint, 'snapshot carries a fingerprint');

    const unchanged = await fetchJson(localBaseUrl, started.token, `/api/a2a/snapshot?since=${encodeURIComponent(first.body.fingerprint)}`);
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.unchanged, true);
    assert.equal(unchanged.body.fingerprint, first.body.fingerprint);

    persistSession(root, { taskId: null, sessionId: 'session-since-move', runtime: 'codex', role: 'Subagent', status: 'stopped' });
    const changed = await fetchJson(localBaseUrl, started.token, `/api/a2a/snapshot?since=${encodeURIComponent(first.body.fingerprint)}`);
    assert.equal(changed.status, 200);
    assert.notEqual(changed.body.unchanged, true, 'state change must bust the fingerprint');
    assert.notEqual(changed.body.fingerprint, first.body.fingerprint);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-002c display node html serve route: default template until written, then agent html', async () => {
  const root = makeHarnessTempRoot('wf-ui-display-serve-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const created = createComponentNode(root, { type: 'display', title: 'Research Report' });
  const nodeId = created.node.nodeId;
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry, eventsWs: false });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  try {
    const empty = await fetchJson(localBaseUrl, started.token, `/api/a2a/component-nodes/${nodeId}/html`);
    assert.equal(empty.status, 200);
    assert.ok(String(empty.body).includes('<!DOCTYPE html>'), 'serves the default template before any write');
    assert.ok(String(empty.body).includes('#D97757'), 'theme accent present');
    assert.ok(String(empty.body).includes('Research Report'), 'title in the template');
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-008 workflow agent sessions write node-home init files and use quiet bootstrap metadata', async () => {
  const root = makeHarnessTempRoot('wf-ui-node-home-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  try {
    const session = registry.create({
      runtime: 'claude',
      agentKind: 'main',
      role: 'Main Agent',
      objective: 'Quiet bootstrap check',
      projectRoot: root,
      cwd: root,
    });
    const nodeHomeRel = `Harness/a2a/nodes/${session.sessionId}`;
    registry.update(session.sessionId, {
      nodeHomeRel,
      nodeHomePath: path.join(root, nodeHomeRel),
      nodeInitRel: `${nodeHomeRel}/init.md`,
      nodeInitPath: path.join(root, nodeHomeRel, 'init.md'),
    });
    const current = registry.get(session.sessionId);
    persistSession(root, current);

    fs.mkdirSync(current.nodeHomePath, { recursive: true });
    fs.writeFileSync(current.nodeInitPath, [
      '# Harness WF Node Init',
      '',
      '- Keep terminal startup quiet. Do not print this file unless the operator asks.',
      '- Read the workflow graph with `node Harness/scripts/wf-ui-control.mjs describe --project .` when you need topology.',
    ].join('\n'));

    assert.equal(fs.existsSync(current.nodeInitPath), true);
    const init = fs.readFileSync(current.nodeInitPath, 'utf8');
    assert.match(init, /Keep terminal startup quiet/);
    assert.match(init, /wf-ui-control\.mjs describe/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-004 session input API writes directly to the registered PTY process', async () => {
  const root = makeHarnessTempRoot('wf-ui-direct-pty-input-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  const written = [];
  try {
    const session = registry.create({ runtime: 'codex', agentKind: 'main' });
    registry.update(session.sessionId, { status: 'running' });
    registerPtyProcess(session.sessionId, { write: data => written.push(data) });

    const result = await postJson(localBaseUrl, started.token, `/api/sessions/${session.sessionId}/input`, {
      input: 'hello from attached terminal\r',
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.deepEqual(written, ['hello from attached terminal\r']);
  } finally {
    for (const session of registry.getAll()) unregisterPtyProcess(session.sessionId);
    await stopServer(started.server);
    removeHarnessTempRoot(root);
  }
});

test('AC-003 terminal file drop API stores uploaded files below the session drop directory', async () => {
  const session = persistSession(tempRoot, {
    sessionId: 'session-drop-test',
    runtime: 'codex',
    status: 'running',
    attachMode: true,
    taskId: null,
  });

  const { status, body } = await postJson(baseUrl, token, `/api/sessions/${session.sessionId}/drop-files`, {
    files: [
      {
        name: '..\\unsafe name.txt',
        contentBase64: Buffer.from('drop-file-body', 'utf8').toString('base64'),
      },
    ],
  });

  assert.equal(status, 200);
  assert.equal(body.files.length, 1);
  const dropped = body.files[0];
  const dropRoot = path.join(tempRoot, 'Harness', 'a2a', 'sessions', session.sessionId, 'drops');
  assert.ok(dropped.path.startsWith(dropRoot), `drop path should stay under ${dropRoot}`);
  assert.doesNotMatch(path.relative(dropRoot, dropped.path), /^\.\./, 'drop path must not traverse out of drop root');
  assert.equal(fs.readFileSync(dropped.path, 'utf8'), 'drop-file-body');
  assert.match(dropped.name, /unsafe name\.txt$/, 'basename should be preserved after path stripping');
  assert.match(dropped.terminalText, /^'.*'$/, 'terminal text should be safely quoted for paste/input');
  assert.equal(body.terminalInput, dropped.terminalText);
});

test('wf-bridge records cross-session input after PTY write succeeds', async () => {
  const root = makeHarnessTempRoot('wf-ui-bridge-input-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  const written = [];
  try {
    const from = registry.create({ runtime: 'claude', agentKind: 'main' });
    const to = registry.create({ runtime: 'codex', agentKind: 'main' });
    registry.update(from.sessionId, { status: 'running', graphNodeId: `session-${from.sessionId}` });
    registry.update(to.sessionId, { status: 'running', graphNodeId: `session-${to.sessionId}` });
    registerPtyProcess(to.sessionId, { write: data => written.push(data) });

    const result = await postJson(localBaseUrl, started.token, `/api/sessions/${to.sessionId}/input`, {
      data: 'reply over bridge\r',
      fromSessionId: from.sessionId,
      fromNodeId: `session-${from.sessionId}`,
    });

    assert.equal(result.status, 200);
    assert.deepEqual(written, ['reply over bridge\r']);
    assert.equal(result.body.bridgeMessage.fromSessionId, from.sessionId);
    assert.equal(result.body.bridgeMessage.toSessionId, to.sessionId);

    const messages = await fetchJson(localBaseUrl, started.token, `/api/a2a/bridge-messages?fromSessionId=${from.sessionId}&toSessionId=${to.sessionId}&limit=20`);
    assert.equal(messages.status, 200);
    assert.equal(messages.body.entries.length, 1);
    assert.equal(messages.body.entries[0].data, 'reply over bridge\r');
  } finally {
    for (const session of registry.getAll()) unregisterPtyProcess(session.sessionId);
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('session stop is idempotent and removes session from live list', async () => {
  const root = makeHarnessTempRoot('wf-ui-stop-test-');
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
    assert.equal(first.body.stopped.status, 'stopped');
    assert.equal(first.body.saved.status, 'stopped');

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

test('AC-003 stop updates workflow snapshot control and persisted graph state', async () => {
  const root = makeHarnessTempRoot('wf-ui-stop-snapshot-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  try {
    const session = registry.create({ runtime: 'codex', agentKind: 'main', role: 'Main Agent' });
    registry.update(session.sessionId, { status: 'running', graphNodeId: `session-${session.sessionId}` });
    persistSession(root, registry.get(session.sessionId));
    writeWorkflowGraphMap(root, {
      nodes: [{ nodeId: `session-${session.sessionId}`, sessionId: session.sessionId, runtime: 'codex', status: 'running' }],
      positions: { [`session-${session.sessionId}`]: { x: 20, y: 40 } },
    });

    const first = await postJson(localBaseUrl, started.token, `/api/sessions/${session.sessionId}/stop`);
    assert.equal(first.status, 200);
    assert.equal(first.body.stopped.status, 'stopped');
    assert.equal(first.body.saved.status, 'stopped');

    const live = await fetchJson(localBaseUrl, started.token, '/api/sessions');
    const snapshot = await fetchJson(localBaseUrl, started.token, '/api/a2a/snapshot?fresh=1');
    const graphMap = await fetchJson(localBaseUrl, started.token, '/api/a2a/graph-map');
    const node = snapshot.body.nodes.find(item => item.sessionId === session.sessionId);

    assert.equal(live.status, 200);
    assert.deepEqual(live.body, []);
    assert.ok(node, 'stopped graph-bound node should remain visible as stopped transcript history');
    assert.equal(node.status, 'stopped');
    assert.equal(node.lifecycle, 'stopped');
    assert.equal(node.control.canStart, true);
    assert.equal(node.control.canStop, false);
    assert.equal(node.control.canDelete, true);
    assert.equal(graphMap.body.nodes.find(item => item.sessionId === session.sessionId)?.status, 'stopped');
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-004 DELETE /api/a2a/nodes removes stopped not-managed graph node but preserves transcript history', async () => {
  const root = makeHarnessTempRoot('wf-ui-delete-node-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  persistSession(root, {
    taskId: null,
    sessionId: 'session-delete-me',
    runtime: 'claude',
    role: 'Subagent',
    status: 'running',
    terminalSeq: 0,
    updatedAt: '2026-07-30T00:00:00.000Z',
  });
  persistSession(root, {
    taskId: null,
    sessionId: 'session-keep-me',
    runtime: 'codex',
    role: 'Main Agent',
    status: 'saved',
    updatedAt: '2026-07-30T00:00:01.000Z',
  });
  const deleteState = listTerminalSessions(root).find(session => session.sessionId === 'session-delete-me');
  appendTerminalData(root, deleteState, 'saved transcript line\r\n');
  writeWorkflowGraphMap(root, {
    nodes: [
      { nodeId: 'session-session-delete-me', sessionId: 'session-delete-me', runtime: 'claude', status: 'running' },
      { nodeId: 'session-session-keep-me', sessionId: 'session-keep-me', runtime: 'codex', status: 'saved' },
    ],
    edges: [
      { id: 'edge-delete', from: 'session-session-keep-me', to: 'session-session-delete-me', relation: 'can-communicate' },
    ],
    positions: {
      'session-session-delete-me': { x: 120, y: 80 },
      'session-session-keep-me': { x: 20, y: 30 },
    },
  });

  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  try {
    const before = await fetchJson(localBaseUrl, started.token, '/api/a2a/snapshot?fresh=1');
    assert.equal(before.status, 200);
    assert.equal(before.body.nodes.find(node => node.sessionId === 'session-delete-me')?.blockedReason, 'not-managed-by-current-wf-ui');

    const removed = await deleteJson(localBaseUrl, started.token, '/api/a2a/nodes/session-session-delete-me');
    assert.equal(removed.status, 200);
    assert.equal(removed.body.ok, true);
    assert.equal(removed.body.removed.nodeId, 'session-session-delete-me');

    const after = await fetchJson(localBaseUrl, started.token, '/api/a2a/snapshot?fresh=1');
    const graphMap = await fetchJson(localBaseUrl, started.token, '/api/a2a/graph-map');
    const transcript = await fetchJson(localBaseUrl, started.token, '/api/terminals/session-delete-me/range?tail=10');

    assert.equal(after.body.nodes.some(node => node.sessionId === 'session-delete-me'), false);
    assert.equal(after.body.nodes.some(node => node.sessionId === 'session-keep-me'), true);
    assert.equal(after.body.graph.edges.some(edge => edge.toSessionId === 'session-delete-me'), false);
    assert.equal(graphMap.body.nodes.some(node => node.sessionId === 'session-delete-me'), false);
    assert.equal(graphMap.body.positions['session-session-delete-me'], undefined);
    assert.ok(graphMap.body.deletedNodes.some(node => node.sessionId === 'session-delete-me'));
    assert.equal(transcript.body.entries.some(entry => String(entry.data).includes('saved transcript line')), true);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-004 DELETE /api/a2a/nodes removes non-live registry sessions from snapshot', async () => {
  const root = makeHarnessTempRoot('wf-ui-delete-registry-saved-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const session = registry.create({
    runtime: 'opencode',
    agentKind: 'subagent',
    graphNodeId: 'session-registry-saved',
    projectRoot: root,
    cwd: root,
  });
  registry.update(session.sessionId, { status: 'saved' });
  persistSession(root, registry.get(session.sessionId));
  writeWorkflowGraphMap(root, {
    nodes: [
      { nodeId: 'session-registry-saved', sessionId: session.sessionId, runtime: 'opencode', status: 'saved' },
    ],
  });

  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  try {
    const removed = await deleteJson(localBaseUrl, started.token, '/api/a2a/nodes/session-registry-saved');
    assert.equal(removed.status, 200);
    assert.equal(registry.get(session.sessionId), undefined);

    const after = await fetchJson(localBaseUrl, started.token, '/api/a2a/snapshot?fresh=1');
    assert.equal(after.status, 200);
    assert.equal(after.body.nodes.some(node => node.sessionId === session.sessionId), false);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-001 wf-ui-control describe uses read-only snapshot token instead of stale local graph fallback', async () => {
  const root = makeHarnessTempRoot('wf-ui-read-token-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  writeWorkflowGraphMap(root, {
    nodes: [{ nodeId: 'session-local-only', sessionId: 'local-only', runtime: 'claude', status: 'saved' }],
  });

  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  try {
    const sessionId = 'session-reader';
    const result = await runNode([
      path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs'),
      'describe',
      '--project',
      root,
    ], {
      cwd: root,
      timeout: 5000,
      env: {
        ...process.env,
        HARNESS_PEER_SESSION_ID: sessionId,
        HARNESS_AGENT_KIND: 'subagent',
        HARNESS_WF_UI_URL: `http://127.0.0.1:${started.port}`,
        HARNESS_WF_UI_READ_TOKEN: graphReadToken(started.token, sessionId),
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const body = JSON.parse(result.stdout);
    assert.equal(body.counts.nodes, 0);
    assert.equal(body.nodes.some(node => node.sessionId === 'local-only'), false);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W21-ONTOLOGY exposes workflow ontology through full and graph read tokens', async () => {
  const root = makeHarnessTempRoot('wf-ui-ontology-api-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const sessionId = 'ontology-reader';
  writeWorkflowGraphMap(root, {
    nodes: [{ nodeId: 'session-ontology-reader', sessionId, runtime: 'codex', agentKind: 'subagent', status: 'running' }],
  });

  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: new SessionRegistry() });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  try {
    const full = await fetchJson(localBaseUrl, started.token, '/api/workflow/ontology');
    assert.equal(full.status, 200, JSON.stringify(full.body));
    assert.equal(full.body.ok, true);
    assert.equal(full.body.ontology.ontologyId, 'harness.workflow.ontology');
    assert.equal(full.body.ontology.nodeTypes.timer.controlRelation.relation, 'control');

    const readOnly = await fetchJson(
      localBaseUrl,
      graphReadToken(started.token, sessionId),
      `/api/workflow/ontology?actorSessionId=${sessionId}`,
    );
    assert.equal(readOnly.status, 200, JSON.stringify(readOnly.body));
    assert.equal(readOnly.body.ontology.nodeTypes.markdown.direction, 'bidirectional');

    const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
    const cli = await runNode([
      script,
      'workflow-ontology',
      '--project',
      root,
    ], {
      cwd: root,
      timeout: 5000,
      env: {
        ...process.env,
        HARNESS_PEER_SESSION_ID: sessionId,
        HARNESS_WORKFLOW_NODE_ID: 'session-ontology-reader',
        HARNESS_WF_UI_URL: localBaseUrl,
        HARNESS_WF_UI_TOKEN: '',
        HARNESS_WF_UI_READ_TOKEN: graphReadToken(started.token, sessionId),
      },
    });
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    const cliBody = JSON.parse(cli.stdout);
    assert.equal(cliBody.ontology.ontologyId, 'harness.workflow.ontology');
    assert.equal(cliBody.ontology.nodeTypes.goal.direction, 'bidirectional');

    const badToken = await fetchJson(localBaseUrl, 'not-a-token', '/api/workflow/ontology');
    assert.equal(badToken.status, 200);
    assert.equal(badToken.body.ontology.ontologyId, 'harness.workflow.ontology');
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W21-AUTH validates server-derived Agent actor session for timer control actions', async () => {
  const root = makeHarnessTempRoot('wf-ui-action-auth-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const agentNodeId = 'session-w21-auth-agent';
  const otherAgentNodeId = 'session-w21-auth-other';
  writeWorkflowGraphMap(root, {
    nodes: [
      { nodeId: agentNodeId, sessionId: 'w21-auth-agent-pty', runtime: 'codex', agentKind: 'main', status: 'running' },
      { nodeId: otherAgentNodeId, sessionId: 'w21-auth-other-pty', runtime: 'codex', agentKind: 'subagent', status: 'running' },
    ],
    positions: {
      [agentNodeId]: { x: 20, y: 40 },
      [otherAgentNodeId]: { x: 260, y: 40 },
    },
  });
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: new SessionRegistry() });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  try {
    const created = await postJson(localBaseUrl, started.token, '/api/workflow/nodes', {
      type: 'timer',
      title: 'W21 Auth Timer',
      enabled: true,
      schedule: { mode: 'interval', intervalSeconds: 60 },
      controlPolicy: { agentCanSetInterval: true, minIntervalSeconds: 10, maxIntervalSeconds: 3600 },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const timerNodeId = created.body.node.nodeId;

    const edge = await postJson(localBaseUrl, started.token, '/api/workflow/edges', {
      from: agentNodeId,
      to: timerNodeId,
      relation: 'control',
      direction: 'source-to-target',
      sourceHandle: 'control',
      targetHandle: 'config',
    });
    assert.equal(edge.status, 201, JSON.stringify(edge.body));

    const spoofed = await postJson(
      localBaseUrl,
      started.token,
      `/api/workflow/nodes/${timerNodeId}/actions/timer.setInterval`,
      { actorNodeId: agentNodeId, intervalSeconds: 120 },
      { 'X-Harness-Session-Id': 'w21-auth-other-pty' },
    );
    assert.equal(spoofed.status, 403, JSON.stringify(spoofed.body));
    assert.equal(spoofed.body.error?.code, 'AGENT_ACTOR_MISMATCH');

    const derived = await postJson(
      localBaseUrl,
      started.token,
      `/api/workflow/nodes/${timerNodeId}/actions/timer.setInterval`,
      { intervalSeconds: 180 },
      { 'X-Harness-Session-Id': 'w21-auth-agent-pty' },
    );
    assert.equal(derived.status, 200, JSON.stringify(derived.body));
    assert.equal(derived.body.result.state.schedule.intervalSeconds, 180);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W19-NODE-MAP-SKILL wf-ui-control node-map deleteNodes uses typed Agent graph API and skips live agents', async () => {
  const root = makeHarnessTempRoot('wf-ui-node-map-api-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const mainAgentId = 'session-w19-main-agent';
  const workerAgentId = 'session-w19-live-worker';
  writeWorkflowGraphMap(root, {
    nodes: [
      { nodeId: mainAgentId, sessionId: 'w19-main-agent', runtime: 'codex', agentKind: 'main', role: 'Main Agent', status: 'running' },
      { nodeId: workerAgentId, sessionId: 'w19-live-worker', runtime: 'codex', agentKind: 'subagent', role: 'Subagent', status: 'running' },
    ],
    positions: {
      [mainAgentId]: { x: 20, y: 40 },
      [workerAgentId]: { x: 260, y: 40 },
    },
  });
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: new SessionRegistry() });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  try {
    const created = await postJson(localBaseUrl, started.token, '/api/workflow/nodes', {
      type: 'markdown',
      title: 'W19 API Controlled Note',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const targetNodeId = created.body.node.nodeId;

    const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
    const read = await runNode([
      script,
      'node-map',
      '--action',
      'readGraph',
      '--project',
      root,
    ], {
      cwd: root,
      timeout: 5000,
      env: {
        ...process.env,
        HARNESS_AGENT_KIND: 'main',
        HARNESS_PEER_SESSION_ID: 'w19-main-agent',
        HARNESS_WORKFLOW_NODE_ID: mainAgentId,
        HARNESS_WF_UI_URL: localBaseUrl,
        HARNESS_WF_UI_TOKEN: started.token,
      },
    });
    assert.equal(read.status, 0, read.stderr || read.stdout);
    const readBody = JSON.parse(read.stdout);
    assert.equal(readBody.action, 'agent.readGraph');
    assert.ok(readBody.result?.graph?.nodes?.some(node => node.nodeId === targetNodeId), JSON.stringify(readBody));

    const result = await runNode([
      script,
      'node-map',
      '--action',
      'deleteNodes',
      '--all',
      'true',
      '--project',
      root,
    ], {
      cwd: root,
      timeout: 5000,
      env: {
        ...process.env,
        HARNESS_AGENT_KIND: 'main',
        HARNESS_PEER_SESSION_ID: 'w19-main-agent',
        HARNESS_WORKFLOW_NODE_ID: mainAgentId,
        HARNESS_WF_UI_URL: localBaseUrl,
        HARNESS_WF_UI_TOKEN: started.token,
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const body = JSON.parse(result.stdout);
    assert.equal(body.action, 'agent.deleteNodes');
    assert.equal(body.result?.operation?.kind, 'agent.deleteNodes');
    assert.ok(body.result?.deletedNodeIds?.includes(targetNodeId), JSON.stringify(body));
    assert.ok(body.result?.skippedNodeIds?.includes(mainAgentId), JSON.stringify(body));
    assert.ok(body.result?.skippedNodeIds?.includes(workerAgentId), JSON.stringify(body));

    const nodes = await fetchJson(localBaseUrl, started.token, '/api/workflow/nodes');
    assert.equal(nodes.status, 200);
    assert.equal(nodes.body.nodes.some(node => node.nodeId === targetNodeId), false);
    assert.equal(nodes.body.nodes.some(node => node.nodeId === mainAgentId), true);
    assert.equal(nodes.body.nodes.some(node => node.nodeId === workerAgentId), true);

    const workflow = await fetchJson(localBaseUrl, started.token, '/api/workflow');
    assert.equal(workflow.status, 200, JSON.stringify(workflow.body));
    assert.ok(workflow.body.workflow?.operations?.recent?.some(record => record.kind === 'agent.deleteNodes'));
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W19-NODE-MAP-SKILL wf-ui-control legacy connect and delete-node delegate to typed Agent graph API', async () => {
  const root = makeHarnessTempRoot('wf-ui-node-map-legacy-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const mainAgentId = 'session-w19-legacy-main';
  writeWorkflowGraphMap(root, {
    nodes: [
      { nodeId: mainAgentId, sessionId: 'w19-legacy-main', runtime: 'codex', agentKind: 'main', role: 'Main Agent', status: 'running' },
    ],
    positions: {
      [mainAgentId]: { x: 20, y: 40 },
    },
  });
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: new SessionRegistry() });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  const env = {
    ...process.env,
    HARNESS_AGENT_KIND: 'main',
    HARNESS_PEER_SESSION_ID: 'w19-legacy-main',
    HARNESS_WORKFLOW_NODE_ID: mainAgentId,
    HARNESS_WF_UI_URL: localBaseUrl,
    HARNESS_WF_UI_TOKEN: started.token,
  };
  try {
    const created = await postJson(localBaseUrl, started.token, '/api/workflow/nodes', {
      type: 'markdown',
      title: 'W19 Legacy Alias Note',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const targetNodeId = created.body.node.nodeId;
    const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');

    const connected = await runNode([
      script,
      'connect',
      '--from',
      mainAgentId,
      '--to',
      targetNodeId,
      '--relation',
      'context',
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(connected.status, 0, connected.stderr || connected.stdout);
    const connectBody = JSON.parse(connected.stdout);
    assert.equal(connectBody.action, 'agent.connectNodes');
    assert.equal(connectBody.result?.operation?.kind, 'agent.connectNodes');

    const removed = await runNode([
      script,
      'delete-node',
      '--node',
      targetNodeId,
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(removed.status, 0, removed.stderr || removed.stdout);
    const removeBody = JSON.parse(removed.stdout);
    assert.equal(removeBody.action, 'agent.deleteNode');
    assert.equal(removeBody.result?.operation?.kind, 'agent.deleteNode');
    assert.deepEqual(removeBody.result?.deletedNodeIds, [targetNodeId]);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W20-WORKFLOW-CLI wf-ui-control exposes canonical workflow context and typed node action wrappers', async () => {
  const root = makeHarnessTempRoot('wf-ui-workflow-cli-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const mainAgentId = 'session-w20-main-agent';
  writeWorkflowGraphMap(root, {
    nodes: [
      { nodeId: mainAgentId, sessionId: 'w20-main-agent', runtime: 'codex', agentKind: 'main', role: 'Main Agent', status: 'running' },
    ],
    positions: {
      [mainAgentId]: { x: 20, y: 40 },
    },
  });
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: new SessionRegistry() });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  const env = {
    ...process.env,
    HARNESS_AGENT_KIND: 'main',
    HARNESS_PEER_SESSION_ID: 'w20-main-agent',
    HARNESS_WORKFLOW_NODE_ID: mainAgentId,
    HARNESS_WF_UI_URL: localBaseUrl,
    HARNESS_WF_UI_TOKEN: started.token,
  };
  try {
    const created = await postJson(localBaseUrl, started.token, '/api/workflow/nodes', {
      type: 'markdown',
      title: 'W20 Canonical Note',
      markdown: 'W20 typed action body',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const targetNodeId = created.body.node.nodeId;

    const connected = await postJson(localBaseUrl, started.token, `/api/workflow/nodes/${mainAgentId}/actions/agent.connectNodes`, {
      actorNodeId: mainAgentId,
      from: mainAgentId,
      to: targetNodeId,
      relation: 'context',
      sourceHandle: 'context',
      targetHandle: 'markdown',
    });
    assert.equal(connected.status, 200, JSON.stringify(connected.body));

    const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
    const context = await runNode([
      script,
      'workflow-context',
      '--node',
      mainAgentId,
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(context.status, 0, context.stderr || context.stdout);
    const contextBody = JSON.parse(context.stdout);
    assert.equal(contextBody.context.nodeId, mainAgentId);
    assert.ok(contextBody.context.connectedResourceRefs.some(ref => ref.nodeId === targetNodeId && ref.type === 'markdown'), JSON.stringify(contextBody));

    const readOnlyContext = await runNode([
      script,
      'workflow-context',
      '--node',
      mainAgentId,
      '--project',
      root,
    ], {
      cwd: root,
      timeout: 5000,
      env: {
        ...process.env,
        HARNESS_AGENT_KIND: 'subagent',
        HARNESS_PEER_SESSION_ID: 'w20-main-agent',
        HARNESS_WORKFLOW_NODE_ID: mainAgentId,
        HARNESS_WF_UI_URL: localBaseUrl,
        HARNESS_WF_UI_TOKEN: '',
        HARNESS_WF_UI_READ_TOKEN: graphReadToken(started.token, 'w20-main-agent'),
      },
    });
    assert.equal(readOnlyContext.status, 0, readOnlyContext.stderr || readOnlyContext.stdout);
    const readOnlyContextBody = JSON.parse(readOnlyContext.stdout);
    assert.equal(readOnlyContextBody.context.nodeId, mainAgentId);

    const action = await runNode([
      script,
      'workflow-node-action',
      '--node',
      targetNodeId,
      '--action',
      'markdown.read',
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(action.status, 0, action.stderr || action.stdout);
    const actionBody = JSON.parse(action.stdout);
    assert.equal(actionBody.action, 'markdown.read');
    assert.equal(actionBody.result.markdown, 'W20 typed action body');

    const graph = await runNode([
      script,
      'workflow-node-map',
      '--action',
      'readGraph',
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(graph.status, 0, graph.stderr || graph.stdout);
    const graphBody = JSON.parse(graph.stdout);
    assert.equal(graphBody.action, 'agent.readGraph');
    assert.ok(graphBody.result?.graph?.nodes?.some(node => node.nodeId === targetNodeId), JSON.stringify(graphBody));
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W27-CLI-GATE wf-ui-control resolves main actor from backend without actor-kind and read-node returns canonical snapshots', async () => {
  const root = makeHarnessTempRoot('wf-ui-cli-gate-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const mainAgentId = 'session-w27-main-agent';
  const subagentId = 'session-w27-subagent';
  writeWorkflowGraphMap(root, {
    nodes: [
      { nodeId: mainAgentId, sessionId: 'w27-main-agent', runtime: 'codex', agentKind: 'main', role: 'Main Agent', status: 'running' },
      { nodeId: subagentId, sessionId: 'w27-subagent', runtime: 'codex', agentKind: 'subagent', role: 'Subagent', status: 'running' },
    ],
    positions: {
      [mainAgentId]: { x: 20, y: 40 },
      [subagentId]: { x: 260, y: 40 },
    },
  });
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: new SessionRegistry() });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
  const env = {
    ...process.env,
    HARNESS_PEER_SESSION_ID: 'w27-main-agent',
    HARNESS_WORKFLOW_NODE_ID: mainAgentId,
    HARNESS_WF_UI_URL: localBaseUrl,
    HARNESS_WF_UI_TOKEN: started.token,
  };
  delete env.HARNESS_AGENT_KIND;
  try {
    const created = await postJson(localBaseUrl, started.token, '/api/workflow/nodes', {
      type: 'markdown',
      title: 'W27 Gate Note',
      markdown: 'W27 read-node markdown body',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const markdownNodeId = created.body.node.nodeId;

    const timer = await postJson(localBaseUrl, started.token, '/api/workflow/nodes', {
      type: 'timer',
      title: 'W27 Gate Timer',
      enabled: true,
      schedule: { mode: 'interval', intervalSeconds: 60 },
      controlPolicy: { agentCanSetInterval: true, minIntervalSeconds: 10, maxIntervalSeconds: 3600 },
    });
    assert.equal(timer.status, 201, JSON.stringify(timer.body));
    const timerNodeId = timer.body.node.nodeId;

    const connected = await runNode([
      script,
      'connect',
      '--from',
      mainAgentId,
      '--to',
      markdownNodeId,
      '--relation',
      'context',
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(connected.status, 0, connected.stderr || connected.stdout);
    const connectBody = JSON.parse(connected.stdout);
    assert.equal(connectBody.action, 'agent.connectNodes');
    assert.equal(connectBody.result?.operation?.kind, 'agent.connectNodes');

    const eventRead = await runNode([
      script,
      'read-node',
      '--node',
      timerNodeId,
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(eventRead.status, 0, eventRead.stderr || eventRead.stdout);
    const eventBody = JSON.parse(eventRead.stdout);
    assert.equal(eventBody.ok, true);
    assert.equal(eventBody.node.nodeId, timerNodeId);
    assert.equal(eventBody.node.kind, 'timer');
    assert.equal(eventBody.node.lifecycle, 'event-source');

    const componentRead = await runNode([
      script,
      'readnode',
      '--node',
      markdownNodeId,
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(componentRead.status, 0, componentRead.stderr || componentRead.stdout);
    const componentBody = JSON.parse(componentRead.stdout);
    assert.equal(componentBody.node.nodeId, markdownNodeId);
    assert.equal(componentBody.node.kind, 'markdown');

    const agentRead = await runNode([
      script,
      'read-snapshot',
      '--node',
      'w27-main-agent',
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(agentRead.status, 0, agentRead.stderr || agentRead.stdout);
    const agentBody = JSON.parse(agentRead.stdout);
    assert.equal(agentBody.node.nodeId, mainAgentId);
    assert.equal(agentBody.node.kind, 'agent');
    assert.equal(agentBody.node.settings?.values?.agentKind, 'main');

    const subagentEnv = {
      ...env,
      HARNESS_WORKFLOW_NODE_ID: subagentId,
      HARNESS_PEER_SESSION_ID: 'w27-subagent',
    };
    const rejected = await runNode([
      script,
      'node-map',
      '--action',
      'readGraph',
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env: subagentEnv });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Main Agent/);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W24-WORKFLOW-CLI create-agent binds graph node and delegate/read-agent use graph identity', async () => {
  const root = makeHarnessTempRoot('wf-ui-agent-delegation-cli-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const mainAgentId = 'session-w24-main-agent';
  const mainSessionId = 'w24-main-agent';
  writeWorkflowGraphMap(root, {
    nodes: [
      {
        nodeId: mainAgentId,
        sessionId: mainSessionId,
        runtime: 'codex',
        agentKind: 'main',
        role: 'Main Agent',
        status: 'running',
      },
    ],
    positions: {
      [mainAgentId]: { x: 20, y: 40 },
    },
  });
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
  const env = {
    ...process.env,
    HARNESS_AGENT_KIND: 'main',
    HARNESS_PEER_SESSION_ID: mainSessionId,
    HARNESS_WORKFLOW_NODE_ID: mainAgentId,
    HARNESS_WF_UI_URL: localBaseUrl,
    HARNESS_WF_UI_TOKEN: started.token,
    HARNESS_PEER_RUNTIME: 'codex',
  };
  const written = [];
  try {
    const created = await runNode([
      script,
      'create-agent',
      '--runtime',
      'codex',
      '--role',
      'W24 Worker',
      '--objective',
      'W24 graph-bound worker',
      '--defer-pty-spawn',
      'true',
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(created.status, 0, created.stderr || created.stdout);
    const createdBody = JSON.parse(created.stdout);
    assert.ok(createdBody.graphNodeId, JSON.stringify(createdBody));
    assert.equal(createdBody.parentNodeId, mainAgentId);
    assert.equal(createdBody.parentAgentId, mainSessionId);

    const graphPath = path.join(root, 'Harness', 'a2a', 'workflow-map.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    const graphNode = (graph.nodes || []).find(node => node.nodeId === createdBody.graphNodeId);
    assert.ok(graphNode, 'create-agent should persist a graph node endpoint');
    assert.equal(graphNode.sessionId, createdBody.sessionId);
    assert.equal(graphNode.kind, 'terminal-session');

    registry.update(createdBody.sessionId, { status: 'running' });
    const workerSession = registry.get(createdBody.sessionId);
    registerPtyProcess(createdBody.sessionId, { write: data => written.push(String(data)) });

    const edge = await postJson(localBaseUrl, started.token, '/api/workflow/edges', {
      from: mainAgentId,
      to: createdBody.graphNodeId,
      relation: 'delegation',
    });
    assert.equal(edge.status, 201, JSON.stringify(edge.body));
    assert.equal(edge.body.edge.relation, 'delegation');

    const context = await runNode([
      script,
      'workflow-context',
      '--node',
      mainAgentId,
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(context.status, 0, context.stderr || context.stdout);
    const contextBody = JSON.parse(context.stdout);
    const workerRef = contextBody.context.connectedAgentRefs.find(ref => ref.nodeId === createdBody.graphNodeId);
    assert.ok(workerRef, JSON.stringify(contextBody.context.connectedAgentRefs));
    assert.equal(workerRef.relation, 'delegation');
    assert.equal(workerRef.delegation.sendAction, 'agent.sendInput');

    const delegated = await runNode([
      script,
      'delegate-agent',
      '--node',
      createdBody.graphNodeId,
      '--text',
      'W24_DELEGATE_PING',
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(delegated.status, 0, delegated.stderr || delegated.stdout);
    const delegateBody = JSON.parse(delegated.stdout);
    assert.equal(delegateBody.action, 'agent.sendInput');
    assert.equal(delegateBody.result.sessionId, createdBody.sessionId);
    assert.equal(written[0], 'W', 'the delegated body must start typing synchronously');
    await waitFor(() => (written.join('') === 'W24_DELEGATE_PING\r' ? written : null), { timeout: 8000 });
    assert.equal(written.join(''), 'W24_DELEGATE_PING\r', 'the typed body must join to the exact text + \\r');
    assert.equal(written[written.length - 1], '\r', 'the delegated submit must end with a single \\r');
    assert.equal(written.join('').includes('\n'), false, 'no \\n may be injected');
    assert.equal(written.filter(w => w === '\r').length, 1, 'exactly one \\r (0x0D)');

    appendTerminalData(root, workerSession, 'W24_WORKER_OK\n', 'stdout');
    const read = await runNode([
      script,
      'read-agent',
      '--node',
      createdBody.graphNodeId,
      '--action',
      'transcript',
      '--tail',
      '20',
      '--project',
      root,
    ], { cwd: root, timeout: 5000, env });
    assert.equal(read.status, 0, read.stderr || read.stdout);
    const readBody = JSON.parse(read.stdout);
    assert.equal(readBody.action, 'agent.readTranscript');
    assert.equal(readBody.result.sessionId, createdBody.sessionId);
    assert.ok(readBody.result.entries.some(entry => entry.stream === 'stdin' && entry.data.includes('W24_DELEGATE_PING')), JSON.stringify(readBody.result.entries));
    assert.ok(readBody.result.entries.some(entry => entry.stream === 'stdout' && entry.data.includes('W24_WORKER_OK')), JSON.stringify(readBody.result.entries));
  } finally {
    for (const session of registry.getAll()) unregisterPtyProcess(session.sessionId);
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W25-ENV-NODE-INIT graph start records env/node init only and preserves explicit initialInput', async () => {
  const root = makeHarnessTempRoot('wf-ui-env-node-init-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const graphNodeId = 'session-w25-bootstrap-agent';
  const explicitGraphNodeId = 'session-w25-explicit-agent';
  persistSession(root, {
    sessionId: 'w25-bootstrap-previous',
    runtime: 'codex',
    agentKind: 'subagent',
    role: 'W25 Bootstrap Agent',
    objective: 'Read connected graph context before acting',
    projectRoot: root,
    cwd: root,
    graphNodeId,
    status: 'stopped',
  });
  persistSession(root, {
    sessionId: 'w25-explicit-previous',
    runtime: 'codex',
    agentKind: 'subagent',
    role: 'W25 Explicit Agent',
    objective: 'Use explicit startup input',
    projectRoot: root,
    cwd: root,
    graphNodeId: explicitGraphNodeId,
    status: 'stopped',
  });
  writeWorkflowGraphMap(root, {
    nodes: [
      {
        nodeId: graphNodeId,
        sessionId: 'w25-bootstrap-previous',
        runtime: 'codex',
        agentKind: 'subagent',
        role: 'W25 Bootstrap Agent',
        objective: 'Read connected graph context before acting',
        status: 'stopped',
      },
      {
        nodeId: explicitGraphNodeId,
        sessionId: 'w25-explicit-previous',
        runtime: 'codex',
        agentKind: 'subagent',
        role: 'W25 Explicit Agent',
        objective: 'Use explicit startup input',
        status: 'stopped',
      },
    ],
    positions: {
      [graphNodeId]: { x: 80, y: 120 },
      [explicitGraphNodeId]: { x: 360, y: 120 },
    },
  });
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  try {
    const bootstrap = await postJson(localBaseUrl, started.token, `/api/a2a/nodes/${graphNodeId}/start`, {});
    assert.equal(bootstrap.status, 200, JSON.stringify(bootstrap.body));
    assert.equal(bootstrap.body.graphNodeId, graphNodeId);
    assert.equal(bootstrap.body.started.status, 'blocked');

    const bootstrapState = listTerminalSessions(root).find(session => session.sessionId === bootstrap.body.sessionId);
    assert.equal(bootstrapState.pendingInitialInputMode, undefined);
    assert.equal(bootstrapState.pendingInitialInputBytes, undefined);
    assert.equal(fs.existsSync(bootstrapState.nodeInitPath), true);
    const init = fs.readFileSync(bootstrapState.nodeInitPath, 'utf8');
    assert.match(init, /HARNESS_NODE_INIT/);
    assert.match(init, /workflow-ontology/);
    assert.match(init, /## Working Method — discovery first/);
    assert.match(init, /hydrate EVERY turn, mandatory/);
    assert.match(init, /workflow-context --project \./);
    assert.match(init, /## Invariant Rules/);
    assert.doesNotMatch(init, /short bootstrap prompt/i);

    const bootstrapEvents = readJsonlFile(path.join(root, 'Harness', 'a2a', 'sessions', bootstrap.body.sessionId, 'events.jsonl'));
    const pendingBootstrap = bootstrapEvents.find(event => event.type === 'terminal.input.pending');
    assert.equal(pendingBootstrap, undefined);

    const explicitInput = 'CUSTOM_INITIAL_INPUT\r';
    const explicit = await postJson(localBaseUrl, started.token, `/api/a2a/nodes/${explicitGraphNodeId}/start`, {
      initialInput: explicitInput,
    });
    assert.equal(explicit.status, 200, JSON.stringify(explicit.body));
    assert.equal(explicit.body.graphNodeId, explicitGraphNodeId);

    const explicitState = listTerminalSessions(root).find(session => session.sessionId === explicit.body.sessionId);
    assert.equal(explicitState.pendingInitialInputMode, 'explicit');
    assert.equal(explicitState.pendingInitialInputBytes, explicitInput.length);
    const explicitEvents = readJsonlFile(path.join(root, 'Harness', 'a2a', 'sessions', explicit.body.sessionId, 'events.jsonl'));
    const pendingExplicit = explicitEvents.find(event => event.type === 'terminal.input.pending');
    assert.equal(pendingExplicit.mode, 'explicit');
    assert.equal(pendingExplicit.bytes, explicitInput.length);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W26-INITIAL-INPUT waits for terminal ready output before injecting explicit initial input', () => {
  assert.equal(terminalReadyForInitialInput('\u001b[1t', 'claude'), false);
  assert.equal(
    terminalReadyForInitialInput('\u001b[HClaude Code v2.1.215\r\n❯ \r\n⏵⏵ bypass permissions on', 'claude'),
    true,
  );
  assert.equal(terminalReadyForInitialInput('Codex ready ›', 'codex'), true);
});

test('codex update prompt response writes selected menu input and clears pending request', async () => {
  const root = makeHarnessTempRoot('wf-ui-codex-update-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  const written = [];
  try {
    const session = registry.create({ runtime: 'codex' });
    registry.update(session.sessionId, {
      status: 'running',
      controlRequest: {
        requestId: 'codex-update-test',
        type: 'codex:update-prompt',
        status: 'pending',
        detectedAt: new Date().toISOString(),
      },
    });
    registerPtyProcess(session.sessionId, { write: (data) => written.push(data) });

    const first = await postJson(localBaseUrl, started.token, `/api/sessions/${session.sessionId}/codex-update-prompt`, { choice: 'skip-session' });
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(written.at(-1), CODEX_UPDATE_SKIP_SESSION_KEYS);
    assert.equal(registry.get(session.sessionId).controlRequest, null);

    registry.update(session.sessionId, {
      controlRequest: {
        requestId: 'codex-update-test-2',
        type: 'codex:update-prompt',
        status: 'pending',
        detectedAt: new Date().toISOString(),
      },
    });
    const second = await postJson(localBaseUrl, started.token, `/api/sessions/${session.sessionId}/codex-update-prompt`, { choice: 'skip-until-next-version' });
    assert.equal(second.status, 200);
    assert.equal(second.body.ok, true);
    assert.equal(written.at(-1), CODEX_UPDATE_SKIP_UNTIL_NEXT_VERSION_KEYS);
    assert.equal(registry.get(session.sessionId).controlRequest, null);
  } finally {
    for (const session of registry.getAll()) unregisterPtyProcess(session.sessionId);
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('codex update prompt response is single-use under concurrent requests', async () => {
  const root = makeHarnessTempRoot('wf-ui-codex-update-lock-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  const written = [];
  try {
    const session = registry.create({ runtime: 'codex' });
    registry.update(session.sessionId, {
      status: 'running',
      controlRequest: {
        requestId: 'codex-update-concurrent-test',
        type: 'codex:update-prompt',
        status: 'pending',
        detectedAt: new Date().toISOString(),
      },
    });
    registerPtyProcess(session.sessionId, { write: (data) => written.push(data) });

    const results = await Promise.all([
      postJson(localBaseUrl, started.token, `/api/sessions/${session.sessionId}/codex-update-prompt`, { choice: 'skip-session' }),
      postJson(localBaseUrl, started.token, `/api/sessions/${session.sessionId}/codex-update-prompt`, { choice: 'skip-session' }),
    ]);

    assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
    assert.deepEqual(written, [CODEX_UPDATE_SKIP_SESSION_KEYS]);
    assert.equal(registry.get(session.sessionId).controlRequest, null);
  } finally {
    for (const session of registry.getAll()) unregisterPtyProcess(session.sessionId);
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-CLEANUP-003 cleanup API previews and prunes eligible stopped sessions', async () => {
  const root = makeHarnessTempRoot('wf-ui-cleanup-api-test-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const localBaseUrl = `http://127.0.0.1:${started.port}`;
  const sessionDir = path.join(root, 'Harness', 'a2a', 'sessions', 'session-cleanup-old');
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'STATE.json'), JSON.stringify({
      sessionId: 'session-cleanup-old',
      runtime: 'codex',
      status: 'saved',
      updatedAt: '2026-01-01T00:00:00.000Z',
      terminalSeq: 1,
    }, null, 2));
    fs.writeFileSync(path.join(sessionDir, 'terminal.jsonl'), '{"seq":1,"data":"done"}\n');

    const summary = await fetchJson(localBaseUrl, started.token, '/api/cleanup/summary');
    assert.equal(summary.status, 200);
    assert.equal(Object.hasOwn(summary.body, '_internal'), false);
    assert.ok(summary.body.sessions.eligibleCount >= 1);
    assert.ok(summary.body.targets.sessions.some(target => target.sessionId === 'session-cleanup-old'));

    const result = await postJson(localBaseUrl, started.token, '/api/cleanup/prune', {
      apply: true,
      policy: {
        stoppedSessionRetentionDays: 1,
        keepStoppedSessions: 20,
        includeTaskSessions: false,
        detachedLogRetentionHours: 24,
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.applied, true);
    assert.equal(fs.existsSync(sessionDir), false);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
