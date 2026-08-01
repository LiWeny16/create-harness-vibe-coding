import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { spawn } from 'node:child_process';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';
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
test('no token -> 401', async () => { const { status, body } = await fetchJson(baseUrl, undefined, '/api/tasks'); assert.equal(status, 401); assert.equal(body.error.code, 'UNAUTHORIZED'); });
test('bad token -> 403', async () => { const { status } = await fetchJson(baseUrl, 'bad-token-1234567890abcdef', '/api/tasks'); assert.equal(status, 403); });
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
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('sessions empty when no registry', async () => { const { status, body } = await fetchJson(baseUrl, token, '/api/sessions'); assert.equal(status, 200); assert.ok(Array.isArray(body)); assert.equal(body.length, 0); });
test('error envelope format', async () => { const { status, body } = await fetchJson(baseUrl, undefined, '/api/tasks'); assert.equal(status, 401); assert.ok(body.error.code); assert.ok(body.error.message); });
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

  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
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
    assert.equal(staleSession.status, 'stopped');
    assert.equal(staleSession.wsClientCount, 0);
    assert.equal(staleSession.resourceUsage.cpuPercent, null);
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
    fs.rmSync(root, { recursive: true, force: true });
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
