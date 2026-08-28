// workflow-depth-resume-dock.test.mjs
//
// W2 combined suite: depth-gated canvas-agent spawning (P1), resume wiring
// (P2), dock typed actions (P3), and the updateEdge HTTP route (P4).
//
//   P1 — Depth gate: POST /api/sessions rejects 403 DEPTH_LIMIT when the
//     ACTING agent (payload.parentAgentId / parentNodeId / actor headers) is
//     itself a canvas subagent (graph node carrying parentAgentId) and the
//     payload creates an agent node (agentKind set). Root actors and
//     anonymous / unresolvable actors stay allowed.
//   P2 — Resume: agent.start on a node with a persisted previous agent
//     session carries resume args (runtime-specific) into the spawn; restart
//     defaults to resume=true; payload resume:false opts out; fresh/never-run
//     sessions do not resume. The spawn threading is proven through a
//     pty-adapter fixture (registerHooks redirect, same pattern as
//     workflow-terminal-control.test.mjs) plus a helper server subprocess so
//     the agent.start path reaches the real spawn branch (the test runner
//     process auto-defers PTY spawns).
//   P3 — Dock: agent.attachDock creates the graph.capsuleDockLinks entry
//     (edges/connections derived from the existing edge between the pair),
//     re-attach is idempotent (updates side), agent.setDockSide updates the
//     side (404 DOCK_NOT_FOUND when missing), agent.detachDock removes
//     (idempotent removed:false).
//   P4 — agent.updateEdge: relation/direction/handle patch through the
//     graph-actions route; empty patch 400 EMPTY_UPDATE; unknown edge 404
//     EDGE_NOT_FOUND.
//   CLI — node-map --action attachDock/detachDock/setDockSide payload shapes
//     and workflow-node-action --resume (real subprocess vs recording server).
//
// Pattern: in-process node:test + HTTP server on port 0, temp roots, fake
// PTYs via a pty-adapter.mjs fixture (registerHooks), and a stub `codex`
// executable prepended to PATH so POST /api/sessions reaches the spawn
// branch (mirrors workflow-terminal-control.test.mjs).
import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { SessionRegistry } from '../session-registry.mjs';
import { registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';
import { persistSession } from '../terminal-store.mjs';
import { connectNodes, updateEdge } from '../workflow-graph-store.mjs';
import { loadWorkflowGraphMap, writeWorkflowGraphMap } from '../a2a-store.mjs';

// ── pty-adapter fixture (deterministic spawn path) ──────────────────────────
// Replaces pty-adapter.mjs for this process AND for the helper server
// subprocess (R5): spawnPty records the spawn opts in memory and appends a
// JSON line to WF_TEST_SPAWN_LOG when set, so a child process can expose the
// command args it was spawned with.
const FIXTURE_SOURCE = [
  '// Test fixture replacing pty-adapter.mjs (workflow-depth-resume-dock.test.mjs).',
  'import fs from "node:fs";',
  'const recorder = {',
  '  spawnOpts: [],',
  '  reset() { this.spawnOpts.length = 0; },',
  '};',
  'export async function spawnPty(opts) {',
  '  recorder.spawnOpts.push(opts);',
  '  const logPath = process.env.WF_TEST_SPAWN_LOG || "";',
  '  if (logPath) {',
  '    fs.appendFileSync(logPath, JSON.stringify({ sessionId: opts.sessionId, runtime: opts.runtime, command: opts.command, commandArgs: opts.commandArgs || [] }) + "\\n");',
  '  }',
  '  const ptyProcess = {',
  '    pid: 43000 + recorder.spawnOpts.length,',
  '    write() {},',
  '    kill() {},',
  '    onData() {},',
  '    onExit() {},',
  '  };',
  '  return { sessionId: opts.sessionId, pid: ptyProcess.pid, ptyProcess, ptyProvider: "test-fixture" };',
  '}',
  'export { recorder };',
].join('\n');

const fixtureDir = makeHarnessTempRoot('wf-depth-resume-dock-fixture-');
const fixturePath = path.join(fixtureDir, 'pty-adapter.mjs');
fs.writeFileSync(fixturePath, FIXTURE_SOURCE, 'utf8');
const fixtureUrl = pathToFileURL(fixturePath).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './pty-adapter.mjs' && String(context.parentURL || '').endsWith('/src/wf-ui-server/server.mjs')) {
      return { url: fixtureUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { startServer, stopServer } = await import('../server.mjs');
const { recorder } = await import(fixtureUrl);

// ── runtime stub ────────────────────────────────────────────────────────────
// A stub `codex` on PATH makes createRuntimeSession take the spawn branch
// (runtimeInfo.path + launchable) so spawnPty runs for real (through the
// fixture) in the in-process tests and in the helper server subprocess.
const ORIGINAL_PATH = process.env.PATH || '';
let runtimeStubDir = '';

before(() => {
  runtimeStubDir = makeHarnessTempRoot('wf-depth-resume-dock-runtime-');
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(runtimeStubDir, 'codex.cmd'), '@echo off\r\nrem wf-ui depth/resume/dock test stub\r\n');
  } else {
    const stub = path.join(runtimeStubDir, 'codex');
    fs.writeFileSync(stub, '#!/bin/sh\n');
    fs.chmodSync(stub, 0o755);
  }
  process.env.PATH = `${runtimeStubDir}${path.delimiter}${ORIGINAL_PATH}`;
});

after(() => {
  process.env.PATH = ORIGINAL_PATH;
  for (const dir of [runtimeStubDir, fixtureDir]) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
  }
});

// ── HTTP helper ──
function jsonRequest(baseUrl, route, { method = 'GET', body, token = '', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Project seeding helpers ──
function seedRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

function seedGraph(root, nodes, edges = []) {
  writeWorkflowGraphMap(root, {
    schemaVersion: 1,
    version: 1,
    nodes,
    edges,
    capsuleDockLinks: [],
    positions: Object.fromEntries(nodes.map(node => [node.nodeId, { x: 0, y: 0 }])),
  });
}

function seedAgent(root, { nodeId, sessionId, agentKind = 'subagent', role = 'Agent', runtime = 'claude', status = 'running', parentAgentId = null, parentNodeId = null }) {
  const graph = loadWorkflowGraphMap(root);
  seedGraph(root, [
    ...(graph.nodes || []).filter(node => (node.nodeId || node.id) !== nodeId),
    {
      nodeId,
      sessionId,
      kind: 'terminal-session',
      runtime,
      agentKind,
      role,
      label: role,
      status,
      ...(parentAgentId ? { parentAgentId } : {}),
      ...(parentNodeId ? { parentNodeId } : {}),
    },
  ]);
  persistSession(root, {
    sessionId,
    graphNodeId: nodeId,
    runtime,
    agentKind,
    role,
    status,
    attachMode: true,
    taskId: null,
    ...(parentAgentId ? { parentAgentId } : {}),
    ...(parentNodeId ? { parentNodeId } : {}),
  });
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

function spawnLogEntries(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

// ── Suite ──
describe('W2: depth gate, resume wiring, dock actions, updateEdge route', () => {
  let root;
  let registry;
  let server;
  let baseUrl;
  const registeredPties = [];

  beforeEach(async () => {
    recorder.reset();
    root = seedRoot('wf-drd-');
    registry = new SessionRegistry();
    const started = await startServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      sessionRegistry: registry,
      eventsWs: false,
    });
    server = started.server;
    baseUrl = `http://127.0.0.1:${started.port}`;
  });

  afterEach(async () => {
    for (const sessionId of registeredPties.splice(0)) {
      unregisterPtyProcess(sessionId);
    }
    if (server) {
      await stopServer(server);
      server = null;
    }
    if (root) {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      root = null;
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // P1 — Depth-gated canvas-agent spawning
  // ══════════════════════════════════════════════════════════════════
  describe('P1 depth-gated canvas-agent spawning (POST /api/sessions)', () => {
    it('D1 - a root actor (no parentAgentId) may spawn a canvas agent', async () => {
      seedAgent(root, { nodeId: 'd-main', sessionId: 'session-d-main', agentKind: 'main', role: 'Main Agent' });
      const res = await jsonRequest(baseUrl, '/api/sessions', {
        method: 'POST',
        body: {
          runtime: 'claude',
          agentKind: 'subagent',
          role: 'Subagent',
          parentAgentId: 'session-d-main',
          parentNodeId: 'd-main',
          deferPtySpawn: true,
          attachGraphNode: true,
        },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.ok(res.body.sessionId, 'session must be created');
    });

    it('D2 - a depth-1 actor (has parentAgentId) is rejected with 403 DEPTH_LIMIT', async () => {
      seedAgent(root, { nodeId: 'd-main', sessionId: 'session-d-main', agentKind: 'main', role: 'Main Agent' });
      seedAgent(root, {
        nodeId: 'd-sub',
        sessionId: 'session-d-sub',
        agentKind: 'subagent',
        role: 'Subagent',
        parentAgentId: 'session-d-main',
      });
      const res = await jsonRequest(baseUrl, '/api/sessions', {
        method: 'POST',
        body: {
          runtime: 'claude',
          agentKind: 'subagent',
          role: 'Subagent',
          parentAgentId: 'session-d-sub',
          parentNodeId: 'd-sub',
          deferPtySpawn: true,
          attachGraphNode: true,
        },
      });
      assert.equal(res.status, 403, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'DEPTH_LIMIT');
      assert.match(res.body.error.message, /Only the root agent can spawn canvas agents/);
      // No session must have been created.
      assert.equal(registry.getAll().length, 0, 'rejected spawn must not create a session');
    });

    it('D3 - anonymous create (no actor identity) stays allowed', async () => {
      const res = await jsonRequest(baseUrl, '/api/sessions', {
        method: 'POST',
        body: {
          runtime: 'claude',
          agentKind: 'subagent',
          role: 'Subagent',
          deferPtySpawn: true,
          attachGraphNode: true,
        },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.ok(res.body.sessionId, 'anonymous session must be created');
    });

    it('D4 - a depth-1 actor identified via headers is rejected the same way', async () => {
      seedAgent(root, { nodeId: 'd-main', sessionId: 'session-d-main', agentKind: 'main', role: 'Main Agent' });
      seedAgent(root, {
        nodeId: 'd-sub',
        sessionId: 'session-d-sub',
        agentKind: 'subagent',
        role: 'Subagent',
        parentAgentId: 'session-d-main',
      });
      const res = await jsonRequest(baseUrl, '/api/sessions', {
        method: 'POST',
        body: { runtime: 'claude', agentKind: 'subagent', deferPtySpawn: true, attachGraphNode: true },
        headers: {
          'x-harness-session-id': 'session-d-sub',
          'x-harness-workflow-node-id': 'd-sub',
        },
      });
      assert.equal(res.status, 403, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'DEPTH_LIMIT');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // P2 — Resume wiring (agent.start / agent.restart)
  // ══════════════════════════════════════════════════════════════════
  describe('P2 resume wiring (agent.start / agent.restart)', () => {
    async function startNode(nodeId, body = {}) {
      return jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(nodeId)}/actions/agent.start`, {
        method: 'POST',
        body: { deferPtySpawn: true, ...body },
      });
    }

    it('R1 - start with a persisted previous session defaults to resume with the runtime args', async () => {
      seedAgent(root, { nodeId: 'r1-main', sessionId: 'r1-s1', runtime: 'claude', agentKind: 'main', role: 'Main Agent', status: 'exited' });
      const res = await startNode('r1-main');
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.result.alreadyRunning, false);
      assert.equal(res.body.result.resumeUsed, true);
      assert.deepEqual(res.body.result.resumeArgs, ['--resume', 'r1-s1'], 'claude resume args must target the previous session');
    });

    it('R2 - resume:false opts out of resume args', async () => {
      seedAgent(root, { nodeId: 'r2-main', sessionId: 'r2-s1', runtime: 'claude', agentKind: 'main', role: 'Main Agent', status: 'exited' });
      const res = await startNode('r2-main', { resume: false });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.result.resumeUsed, false);
      assert.deepEqual(res.body.result.resumeArgs, []);
    });

    it('R3 - a node whose bound session never ran does not resume by default', async () => {
      seedAgent(root, { nodeId: 'r3-main', sessionId: 'r3-s1', runtime: 'claude', agentKind: 'main', role: 'Main Agent', status: 'blocked' });
      const res = await startNode('r3-main');
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.result.resumeUsed, false);
      assert.deepEqual(res.body.result.resumeArgs, []);
    });

    it('R4 - restart defaults to resume=true and carries the replaced session id', async () => {
      seedAgent(root, { nodeId: 'r4-main', sessionId: 'r4-s1', runtime: 'claude', agentKind: 'main', role: 'Main Agent', status: 'running' });
      const res = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent('r4-main')}/actions/agent.restart`, {
        method: 'POST',
        body: { deferPtySpawn: true },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.result.resumeUsed, true);
      assert.deepEqual(res.body.result.resumeArgs, ['--resume', 'r4-s1']);
      assert.equal(res.body.result.previousSessionId, 'r4-s1');
    });

    it('R5 - end-to-end: agent.start spawn receives the resume args (helper server subprocess)', async () => {
      const helperRoot = seedRoot('wf-drd-r5-');
      seedAgent(helperRoot, { nodeId: 'r5-main', sessionId: 'r5-s1', runtime: 'codex', agentKind: 'main', role: 'Main Agent', status: 'exited' });
      const spawnLog = path.join(helperRoot, 'spawn.log');
      const helperPath = path.join(helperRoot, 'helper-server.mjs');
      const helperSource = [
        '// Helper server subprocess: real server.mjs with the pty fixture, so',
        '// the agent.start spawn branch runs (the node --test runner process',
        '// auto-defers PTY spawns).',
        'import { registerHooks } from "node:module";',
        'import { pathToFileURL } from "node:url";',
        'registerHooks({',
        '  resolve(specifier, context, nextResolve) {',
        '    if (specifier === "./pty-adapter.mjs" && String(context.parentURL || "").endsWith("/src/wf-ui-server/server.mjs")) {',
        '      return { url: pathToFileURL(process.env.WF_TEST_FIXTURE_PATH).href, shortCircuit: true };',
        '    }',
        '    return nextResolve(specifier, context);',
        '  },',
        '});',
        'const { startServer } = await import(process.env.WF_TEST_SERVER_URL);',
        'const { SessionRegistry } = await import(process.env.WF_TEST_REGISTRY_URL);',
        'const started = await startServer({',
        '  projectRoot: process.env.WF_TEST_PROJECT_ROOT,',
        '  host: "127.0.0.1",',
        '  port: 0,',
        '  sessionRegistry: new SessionRegistry(),',
        '  eventsWs: false,',
        '});',
        'process.stdout.write(JSON.stringify({ port: started.port }) + "\\n");',
        'setInterval(() => {}, 1000);',
      ].join('\n');
      fs.writeFileSync(helperPath, helperSource, 'utf8');

      const child = spawn(process.execPath, [helperPath], {
        cwd: helperRoot,
        env: {
          ...process.env,
          WF_TEST_FIXTURE_PATH: fixturePath,
          WF_TEST_SERVER_URL: pathToFileURL(path.join(process.cwd(), 'src', 'wf-ui-server', 'server.mjs')).href,
          WF_TEST_REGISTRY_URL: pathToFileURL(path.join(process.cwd(), 'src', 'wf-ui-server', 'session-registry.mjs')).href,
          WF_TEST_PROJECT_ROOT: helperRoot,
          WF_TEST_SPAWN_LOG: spawnLog,
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      let helperBaseUrl = null;
      try {
        helperBaseUrl = await waitFor(async () => {
          const line = String(stdout).split(/\r?\n/).find(text => text.startsWith('{'));
          if (!line) return null;
          const parsed = JSON.parse(line);
          return `http://127.0.0.1:${parsed.port}`;
        }, { timeout: 10000 });
      } catch (e) {
        child.kill();
        throw new Error(`helper server failed to start: ${e.message}; stderr=${stderr}`);
      }

      try {
        const res = await jsonRequest(helperBaseUrl, `/api/workflow/nodes/${encodeURIComponent('r5-main')}/actions/agent.start`, {
          method: 'POST',
          body: {},
        });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.result.resumeUsed, true);
        assert.deepEqual(res.body.result.resumeArgs, ['resume', 'r5-s1'], 'codex resume args must target the previous session');

        // The real spawn branch must have received the same args.
        const entries = await waitFor(() => {
          const rows = spawnLogEntries(spawnLog);
          return rows.length > 0 ? rows : null;
        });
        assert.equal(entries.length, 1, `exactly one spawn expected: ${JSON.stringify(entries)}`);
        assert.equal(entries[0].sessionId, res.body.result.sessionId);
        assert.equal(entries[0].runtime, 'codex');
        assert.deepEqual(entries[0].commandArgs, ['resume', 'r5-s1'], 'spawnPty commandArgs must carry the resume args');
      } finally {
        child.kill();
        await new Promise(resolve => child.once('close', resolve));
        try {
          fs.rmSync(helperRoot, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
        } catch (e) {
          // Windows may briefly hold session files after server close; the
          // temp root lives under Harness/.temp and is reaped on demand.
          if (process.platform === 'win32' && ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(e?.code)) return;
          throw e;
        }
      }
    });

    it('R6 - createRuntimeSession threads resumeArgs into spawnPty commandArgs (default empty)', async () => {
      // With resumeArgs in the payload, the spawn receives exactly those args.
      const withArgs = await jsonRequest(baseUrl, '/api/sessions', {
        method: 'POST',
        body: { runtime: 'codex', agentKind: 'subagent', attachGraphNode: false, resumeArgs: ['resume', 'sess-abc'] },
      });
      assert.equal(withArgs.status, 201, JSON.stringify(withArgs.body));
      const spawned = recorder.spawnOpts.find(entry => entry.sessionId === withArgs.body.sessionId);
      assert.ok(spawned, 'spawnPty must have been reached');
      assert.deepEqual(spawned.commandArgs, ['resume', 'sess-abc']);

      // Without resumeArgs the default is empty (unchanged behavior).
      recorder.reset();
      const noArgs = await jsonRequest(baseUrl, '/api/sessions', {
        method: 'POST',
        body: { runtime: 'codex', agentKind: 'subagent', attachGraphNode: false },
      });
      assert.equal(noArgs.status, 201, JSON.stringify(noArgs.body));
      const plain = recorder.spawnOpts.find(entry => entry.sessionId === noArgs.body.sessionId);
      assert.ok(plain, 'spawnPty must have been reached');
      assert.deepEqual(plain.commandArgs, []);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // P3 — Dock typed actions
  // ══════════════════════════════════════════════════════════════════
  describe('P3 dock typed actions (agent.attachDock / setDockSide / detachDock)', () => {
    function seedDockGraph() {
      seedAgent(root, { nodeId: 'k-main', sessionId: 'session-k-main', agentKind: 'main', role: 'Main Agent' });
      seedAgent(root, { nodeId: 'k-b', sessionId: 'session-k-b', agentKind: 'subagent', role: 'Agent B' });
      seedAgent(root, { nodeId: 'k-c', sessionId: 'session-k-c', agentKind: 'subagent', role: 'Agent C' });
      const connected = connectNodes(root, { from: 'k-main', to: 'k-b', sourceHandle: 'right', targetHandle: 'left' });
      return connected.edge;
    }

    function dockAction(action, body) {
      return jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent('k-main')}/actions/agent.${action}`, {
        method: 'POST',
        body: { actorNodeId: 'k-main', ...body },
      });
    }

    function dockLinks() {
      return loadWorkflowGraphMap(root).capsuleDockLinks || [];
    }

    it('DOCK1 - attachDock creates the capsuleDockLinks entry derived from the existing edge', async () => {
      const edge = seedDockGraph();
      const res = await dockAction('attachDock', { anchorId: 'k-main', draggedId: 'k-b', side: 'top' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.ok, true);
      assert.equal(res.body.replaced, false);
      const link = res.body.dockLink;
      assert.equal(link.anchorId, 'k-main');
      assert.equal(link.draggedId, 'k-b');
      assert.equal(link.side, 'top');
      assert.deepEqual(link.nodeIds, ['k-b', 'k-main']);
      assert.deepEqual(link.edges, [{ edgeId: edge.id, retention: 'keep' }]);
      assert.equal(link.connections.length, 1, 'connection must be derived from the edge');
      assert.equal(link.connections[0].source, 'k-main');
      assert.equal(link.connections[0].target, 'k-b');

      const persisted = dockLinks();
      assert.equal(persisted.length, 1, 'exactly one dock link must persist');
      assert.equal(persisted[0].side, 'top');
      assert.equal(persisted[0].anchorId, 'k-main');
    });

    it('DOCK2 - re-attaching the same pair is idempotent and updates the side', async () => {
      seedDockGraph();
      await dockAction('attachDock', { anchorId: 'k-main', draggedId: 'k-b', side: 'top' });
      const again = await dockAction('attachDock', { anchorId: 'k-b', draggedId: 'k-main', side: 'left' });
      assert.equal(again.status, 200, JSON.stringify(again.body));
      assert.equal(again.body.replaced, true, 're-attach must replace the existing entry');
      assert.equal(again.body.dockLink.side, 'left');
      const persisted = dockLinks();
      assert.equal(persisted.length, 1, 're-attach must not duplicate the entry');
      assert.equal(persisted[0].side, 'left');
    });

    it('DOCK3 - setDockSide updates the side of an existing dock link', async () => {
      seedDockGraph();
      await dockAction('attachDock', { anchorId: 'k-main', draggedId: 'k-b', side: 'top' });
      const res = await dockAction('setDockSide', { anchorId: 'k-main', draggedId: 'k-b', side: 'bottom' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.dockLink.side, 'bottom');
      assert.equal(dockLinks()[0].side, 'bottom');
    });

    it('DOCK4 - setDockSide on a missing pair returns 404 DOCK_NOT_FOUND', async () => {
      seedDockGraph();
      const res = await dockAction('setDockSide', { anchorId: 'k-main', draggedId: 'k-c', side: 'right' });
      assert.equal(res.status, 404, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'DOCK_NOT_FOUND');
    });

    it('DOCK5 - detachDock removes the entry and is idempotent (removed:false)', async () => {
      seedDockGraph();
      await dockAction('attachDock', { anchorId: 'k-main', draggedId: 'k-b', side: 'top' });
      assert.equal(dockLinks().length, 1);

      const detached = await dockAction('detachDock', { anchorId: 'k-main', draggedId: 'k-b' });
      assert.equal(detached.status, 200, JSON.stringify(detached.body));
      assert.equal(detached.body.removed, true);
      assert.equal(dockLinks().length, 0, 'detach must remove the entry');

      const again = await dockAction('detachDock', { anchorId: 'k-main', draggedId: 'k-b' });
      assert.equal(again.status, 200, JSON.stringify(again.body));
      assert.equal(again.body.removed, false, 'missing entry must be idempotent');

      // By dock id too.
      await dockAction('attachDock', { anchorId: 'k-main', draggedId: 'k-b', side: 'right' });
      const link = dockLinks()[0];
      const byId = await dockAction('detachDock', { dockId: link.id });
      assert.equal(byId.status, 200, JSON.stringify(byId.body));
      assert.equal(byId.body.removed, true);
      assert.equal(dockLinks().length, 0);
    });

    it('DOCK6 - attachDock without an existing edge writes empty edges/connections', async () => {
      seedDockGraph();
      const res = await dockAction('attachDock', { anchorId: 'k-main', draggedId: 'k-c', side: 'right' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.dockLink.edges, []);
      assert.deepEqual(res.body.dockLink.connections, []);
      assert.equal(res.body.dockLink.side, 'right');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // P4 — updateEdge HTTP route (agent.updateEdge)
  // ══════════════════════════════════════════════════════════════════
  describe('P4 updateEdge HTTP route (agent.updateEdge)', () => {
    function seedEdgeGraph() {
      seedAgent(root, { nodeId: 'u-main', sessionId: 'session-u-main', agentKind: 'main', role: 'Main Agent' });
      seedAgent(root, { nodeId: 'u-b', sessionId: 'session-u-b', agentKind: 'subagent', role: 'Agent B' });
      const connected = connectNodes(root, { from: 'u-main', to: 'u-b', sourceHandle: 'bottom', targetHandle: 'top' });
      return connected.edge;
    }

    function edgeAction(body) {
      return jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent('u-main')}/actions/agent.updateEdge`, {
        method: 'POST',
        body: { actorNodeId: 'u-main', ...body },
      });
    }

    it('U1 - updates relation/handles through the route and persists the patch', async () => {
      const edge = seedEdgeGraph();
      const res = await edgeAction({ edgeId: edge.id, relation: 'reports', sourceHandle: 'right' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.ok, true);
      assert.equal(res.body.edge.id, edge.id);
      assert.equal(res.body.edge.relation, 'reports');
      assert.equal(res.body.edge.sourceHandle, 'right');
      assert.equal(res.body.edge.targetHandle, 'top', 'fields outside the patch must stay untouched');

      const persisted = loadWorkflowGraphMap(root).edges.find(item => item.id === edge.id);
      assert.equal(persisted.relation, 'reports');
      assert.equal(persisted.sourceHandle, 'right');
    });

    it('U2 - an empty patch is rejected with 400 EMPTY_UPDATE', async () => {
      const edge = seedEdgeGraph();
      const res = await edgeAction({ edgeId: edge.id });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'EMPTY_UPDATE');
    });

    it('U3 - an unknown edge returns 404 EDGE_NOT_FOUND', async () => {
      seedEdgeGraph();
      const res = await edgeAction({ edgeId: 'edge-unknown', relation: 'reports' });
      assert.equal(res.status, 404, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'EDGE_NOT_FOUND');
      assert.match(res.body.error.message, /edge-unknown/);
    });
  });
});

// ── CLI mapping tests (real subprocess vs recording server) ─────────────────
describe('W2 CLI mapping (node-map dock actions, workflow-node-action --resume)', () => {
  function runCli(cwd, args) {
    return new Promise((resolve, reject) => {
      const script = path.join(cwd, 'Harness', 'scripts', 'wf-ui-control.mjs');
      const child = spawn(process.execPath, [script, ...args], {
        cwd,
        env: { ...process.env, HARNESS_AGENT_KIND: 'main' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`wf-ui-control timeout: ${args.join(' ')}`));
      }, 15000);
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (status) => {
        clearTimeout(timer);
        let parsed = stdout.trim();
        try { parsed = JSON.parse(parsed); } catch { /* raw text */ }
        resolve({ status, stdout: parsed, stderr });
      });
    });
  }

  async function withRecordingServer(fn) {
    const root = makeHarnessTempRoot('wf-drd-cli-');
    const dest = path.join(root, 'Harness', 'scripts', 'wf-ui-control.mjs');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs'), dest);

    const requests = [];
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, body: data ? JSON.parse(data) : null });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, captured: true }));
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}`;
    const baseArgs = ['node-map', '--actor', 'main-node', '--url', url, '--token', 'test-token', '--project', root];
    try {
      await fn({ root, baseArgs, requests, run: (args) => runCli(root, args) });
    } finally {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }

  it('C1 - node-map attachDock sends {actorNodeId, anchorId, draggedId, side} to the graph-actions endpoint', async () => {
    await withRecordingServer(async ({ baseArgs, requests, run }) => {
      const result = await run([
        ...baseArgs,
        '--action', 'attachDock',
        '--anchor', 'main-node',
        '--dragged', 'worker-node',
        '--side', 'top',
      ]);
      assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
      assert.equal(requests.length, 1);
      const captured = requests[0];
      assert.equal(captured.method, 'POST');
      assert.match(captured.url, /\/api\/workflow\/nodes\/main-node\/actions\/agent\.attachDock$/);
      assert.equal(captured.body.actorNodeId, 'main-node');
      assert.equal(captured.body.anchorId, 'main-node');
      assert.equal(captured.body.draggedId, 'worker-node');
      assert.equal(captured.body.side, 'top');
    });
  });

  it('C2 - node-map setDockSide and detachDock map their payloads; missing --anchor fails client-side', async () => {
    await withRecordingServer(async ({ baseArgs, requests, run }) => {
      const setSide = await run([
        ...baseArgs,
        '--action', 'setDockSide',
        '--anchor', 'main-node',
        '--dragged', 'worker-node',
        '--side', 'left',
      ]);
      assert.equal(setSide.status, 0, `CLI failed: ${setSide.stderr}`);
      assert.match(requests[0].url, /agent\.setDockSide$/);
      assert.equal(requests[0].body.anchorId, 'main-node');
      assert.equal(requests[0].body.draggedId, 'worker-node');
      assert.equal(requests[0].body.side, 'left');

      const detach = await run([
        ...baseArgs,
        '--action', 'detachDock',
        '--anchor', 'main-node',
        '--dragged', 'worker-node',
      ]);
      assert.equal(detach.status, 0, `CLI failed: ${detach.stderr}`);
      assert.match(requests[1].url, /agent\.detachDock$/);
      assert.equal(requests[1].body.anchorId, 'main-node');
      assert.equal(requests[1].body.draggedId, 'worker-node');

      // Missing anchor/dragged must fail client-side without a request.
      const missing = await run([...baseArgs, '--action', 'attachDock']);
      assert.notEqual(missing.status, 0, 'missing anchor must exit non-zero');
      assert.match(String(missing.stderr), /--anchor/);
      assert.equal(requests.length, 2, 'failed mapping must not reach the server');

      // setDockSide without --side must fail client-side.
      const noSide = await run([
        ...baseArgs,
        '--action', 'setDockSide',
        '--anchor', 'main-node',
        '--dragged', 'worker-node',
      ]);
      assert.notEqual(noSide.status, 0, 'missing side must exit non-zero');
      assert.match(String(noSide.stderr), /--side/);
      assert.equal(requests.length, 2);
    });
  });

  it('C3 - workflow-node-action --resume lands the resume boolean on agent.start/agent.restart', async () => {
    const root = makeHarnessTempRoot('wf-drd-cli-resume-');
    const dest = path.join(root, 'Harness', 'scripts', 'wf-ui-control.mjs');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs'), dest);

    const requests = [];
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, body: data ? JSON.parse(data) : null });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, captured: true }));
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}`;
    const baseArgs = ['--url', url, '--token', 'test-token', '--project', root];

    try {
      const withResume = await runCli(root, [
        'workflow-node-action',
        ...baseArgs,
        '--node', 'n1',
        '--action', 'agent.start',
        '--resume', 'true',
      ]);
      assert.equal(withResume.status, 0, `CLI failed: ${withResume.stderr}`);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].body.resume, true);

      const withoutResume = await runCli(root, [
        'workflow-node-action',
        ...baseArgs,
        '--node', 'n1',
        '--action', 'agent.restart',
      ]);
      assert.equal(withoutResume.status, 0, `CLI failed: ${withoutResume.stderr}`);
      assert.equal(requests[1].body.resume, undefined, 'no --resume flag must leave the payload untouched');

      const resumeOff = await runCli(root, [
        'workflow-node-action',
        ...baseArgs,
        '--node', 'n1',
        '--action', 'agent.start',
        '--resume', 'false',
      ]);
      assert.equal(resumeOff.status, 0, `CLI failed: ${resumeOff.stderr}`);
      assert.equal(requests[2].body.resume, false);
    } finally {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
