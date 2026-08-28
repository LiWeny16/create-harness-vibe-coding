// workflow-subagent-strategy-matrix.test.mjs
//
// 2x2 subagent strategy matrix for the wf-ui control plane backend:
//   - Default & Value Propagation (A1-A7): default subagentMode, explicit
//     wf-node-subagents, legacy wf-subagents normalization, graph node
//     serialization, snapshot catalog + per-node values, legacy snapshot exposure
//   - Init Prompt & Context       (B1-B4): init.md Subagent Strategy section,
//     HARNESS_SUBAGENT_MODE spawn record, workflow-context subagentMode field
//   - Mode Selection              (C1-C4): create with each mode, empty-input
//     defaulting, agent.start settings update
//   - Backward Compat             (D1-D2): legacy id absent from the catalog,
//     legacy input round-trips through create, context, and snapshot
//   - Codex Runtime Scenarios     (E1-E5): Codex default mode, Codex init
//     prompt guidance for both modes (AC-MATRIX-003/004), Codex main creating
//     a Claude Code worker through the typed API, and the runtime-detector
//     capability status plus degradation documentation
//   - NL Routing / Prompt Detect  (F1-F3): init prompt NL trigger phrases for
//     both modes and the unspecified default (AC-NL-001/002/003)
//
// Pattern: node:test + assert/strict, in-process HTTP server on port 0, temp
// roots from makeHarnessTempRoot(). Every behavior is exercised through the
// typed HTTP API surface (POST /api/sessions, GET /api/workflow/context/:node,
// GET /api/a2a/snapshot, GET /api/a2a/graph-map, agent.start action) plus the
// durable artifacts the backend writes for spawned nodes (init.md, events.jsonl),
// mirroring control-plane-acceptance.test.mjs.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';

// ── HTTP helper ──
function jsonRequest(baseUrl, route, { method = 'GET', body, token = '' } = {}) {
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

function seedRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

// ── Suite ──
describe('Subagent Strategy Matrix (2x2)', () => {
  let root;
  let registry;
  let server;
  let baseUrl;

  beforeEach(async () => {
    root = seedRoot('subagent-matrix-');
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
    if (server) {
      await stopServer(server);
      server = null;
    }
    if (root) {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      root = null;
    }
  });

  // ── Suite-local helpers ──
  async function createSessionViaApi(extra = {}) {
    const res = await jsonRequest(baseUrl, '/api/sessions', {
      method: 'POST',
      body: {
        runtime: 'claude',
        agentKind: 'subagent',
        role: 'Subagent',
        roleTitle: 'implementer',
        displayName: 'Strategy Worker',
        responsibility: 'Subagent strategy matrix worker',
        capabilities: ['terminal'],
        objective: 'Subagent strategy matrix',
        attachGraphNode: true,
        deferPtySpawn: true,
        ...extra,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  }

  function snapshotNode(snapshotBody, sessionId) {
    return (snapshotBody.nodes || []).find(n => n.sessionId === sessionId);
  }

  function graphMapNode(graphBody, sessionId) {
    return (graphBody.nodes || []).find(n => n.sessionId === sessionId);
  }

  // ══════════════════════════════════════════════════════════════════
  // Group A: Default & Value Propagation (A1-A7)
  // ══════════════════════════════════════════════════════════════════
  describe('Default & Value Propagation (A1-A7)', () => {
    it('A1 - sessions created without subagentMode default to built-in-subagents', async () => {
      const session = await createSessionViaApi();
      assert.equal(session.subagentMode, 'built-in-subagents');
    });

    it('A2 - sessions created with explicit wf-node-subagents store it unchanged', async () => {
      const session = await createSessionViaApi({ subagentMode: 'wf-node-subagents' });
      assert.equal(session.subagentMode, 'wf-node-subagents');
    });

    it('A3 - legacy wf-subagents input is normalized to wf-node-subagents at create', async () => {
      const session = await createSessionViaApi({ subagentMode: 'wf-subagents' });
      assert.equal(session.subagentMode, 'wf-node-subagents');
    });

    it('A4 - graph node serialization carries subagentMode in the graph map and snapshot', async () => {
      const session = await createSessionViaApi({ subagentMode: 'wf-node-subagents' });
      const graph = await jsonRequest(baseUrl, '/api/a2a/graph-map');
      assert.equal(graph.status, 200, JSON.stringify(graph.body));
      const node = graphMapNode(graph.body, session.sessionId);
      assert.ok(node, `graph map must contain the created node: ${JSON.stringify(graph.body.nodes)}`);
      assert.equal(node.subagentMode, 'wf-node-subagents');

      const snapshot = await jsonRequest(baseUrl, '/api/a2a/snapshot');
      assert.equal(snapshot.status, 200);
      const snapshotEntry = snapshotNode(snapshot.body, session.sessionId);
      assert.ok(snapshotEntry, 'snapshot must contain the created node');
      assert.equal(snapshotEntry.subagentMode, 'wf-node-subagents');
    });

    it('A5 - snapshot subagentModes catalog lists both modes with canonical labels', async () => {
      const snapshot = await jsonRequest(baseUrl, '/api/a2a/snapshot');
      assert.equal(snapshot.status, 200);
      assert.deepEqual(snapshot.body.subagentModes, [
        { id: 'built-in-subagents', label: 'Built-in Subagents' },
        { id: 'wf-node-subagents', label: 'WF Node Subagents' },
      ]);
    });

    it('A6 - snapshot per-node subagentMode uses the stored normalized value', async () => {
      const defaultSession = await createSessionViaApi();
      const nodeSession = await createSessionViaApi({ subagentMode: 'wf-node-subagents' });
      const snapshot = await jsonRequest(baseUrl, '/api/a2a/snapshot');
      assert.equal(snapshot.status, 200);
      const defaultEntry = snapshotNode(snapshot.body, defaultSession.sessionId);
      const nodeEntry = snapshotNode(snapshot.body, nodeSession.sessionId);
      assert.ok(defaultEntry && nodeEntry, 'both sessions must appear in the snapshot');
      assert.equal(defaultEntry.subagentMode, 'built-in-subagents');
      assert.equal(nodeEntry.subagentMode, 'wf-node-subagents');
    });

    it('A7 - legacy wf-subagents sessions surface as wf-node-subagents in the snapshot', async () => {
      const session = await createSessionViaApi({ subagentMode: 'wf-subagents' });
      const snapshot = await jsonRequest(baseUrl, '/api/a2a/snapshot');
      assert.equal(snapshot.status, 200);
      const entry = snapshotNode(snapshot.body, session.sessionId);
      assert.ok(entry, 'legacy session must appear in the snapshot');
      assert.equal(entry.subagentMode, 'wf-node-subagents');
      assert.equal(
        (snapshot.body.nodes || []).filter(n => n.subagentMode === 'wf-subagents').length,
        0,
        'no snapshot node may expose the legacy wf-subagents id',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Group B: Init Prompt & Context (B1-B4)
  // ══════════════════════════════════════════════════════════════════
  describe('Init Prompt & Context (B1-B4)', () => {
    it('B1 - agent init.md includes the Subagent Strategy section with both modes', async () => {
      const session = await createSessionViaApi();
      const initPath = path.join(root, 'Harness', 'a2a', 'nodes', session.sessionId, 'init.md');
      assert.ok(fs.existsSync(initPath), 'init.md must be written to the node home');
      const init = fs.readFileSync(initPath, 'utf8');
      assert.match(init, /## Subagent Strategy/);
      assert.match(init, /- subagentMode: <built-in-subagents\|wf-node-subagents>/);
      assert.match(init, /- When subagentMode is `built-in-subagents`:/);
      assert.match(init, /- When subagentMode is `wf-node-subagents`:/);
      assert.match(init, /- Default when unspecified: built-in-subagents/);
    });

    it('B2 - the spawn record and init prompt carry the HARNESS_SUBAGENT_MODE value for PTY spawn', async () => {
      const session = await createSessionViaApi({ subagentMode: 'wf-node-subagents' });
      // The backend maps session.subagentMode to HARNESS_SUBAGENT_MODE in the
      // PTY process env at spawn time (pty-adapter.mjs). In this environment
      // node-pty is not installed, so the literal spawn env is not observable;
      // the durable artifacts the backend writes when preparing a session for
      // spawn pin the same value: the session.created event (the exact value
      // passed to spawnPty) and the init.md env line (what the spawned agent
      // reads back).
      const eventsPath = path.join(root, 'Harness', 'a2a', 'sessions', session.sessionId, 'events.jsonl');
      assert.ok(fs.existsSync(eventsPath), 'events.jsonl must be recorded for the session');
      const events = fs.readFileSync(eventsPath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line));
      const createdEvent = events.find(event => event.type === 'session.created');
      assert.ok(createdEvent, `session.created event must exist: ${JSON.stringify(events)}`);
      assert.equal(createdEvent.subagentMode, 'wf-node-subagents');

      const initPath = path.join(root, 'Harness', 'a2a', 'nodes', session.sessionId, 'init.md');
      const init = fs.readFileSync(initPath, 'utf8');
      assert.match(init, /- Env subagent mode: HARNESS_SUBAGENT_MODE=wf-node-subagents/);
    });

    it('B3 - workflow-context includes subagentMode normalized from legacy input', async () => {
      const session = await createSessionViaApi({ subagentMode: 'wf-subagents' });
      const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent(`session-${session.sessionId}`)}`);
      assert.equal(ctx.status, 200, JSON.stringify(ctx.body));
      assert.equal(ctx.body.context.subagentMode, 'wf-node-subagents');
    });

    it('B4 - workflow-context returns built-in-subagents for default sessions', async () => {
      const session = await createSessionViaApi();
      const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent(`session-${session.sessionId}`)}`);
      assert.equal(ctx.status, 200, JSON.stringify(ctx.body));
      assert.equal(ctx.body.context.subagentMode, 'built-in-subagents');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Group C: Mode Selection (C1-C4)
  // ══════════════════════════════════════════════════════════════════
  describe('Mode Selection (C1-C4)', () => {
    it('C1 - creating an agent with built-in-subagents stores it in the response and graph', async () => {
      const session = await createSessionViaApi({ subagentMode: 'built-in-subagents' });
      assert.equal(session.subagentMode, 'built-in-subagents');
      const graph = await jsonRequest(baseUrl, '/api/a2a/graph-map');
      const node = graphMapNode(graph.body, session.sessionId);
      assert.ok(node, 'graph map must contain the created node');
      assert.equal(node.subagentMode, 'built-in-subagents');
    });

    it('C2 - creating an agent with wf-node-subagents stores it in the response and graph', async () => {
      const session = await createSessionViaApi({ subagentMode: 'wf-node-subagents' });
      assert.equal(session.subagentMode, 'wf-node-subagents');
      const graph = await jsonRequest(baseUrl, '/api/a2a/graph-map');
      const node = graphMapNode(graph.body, session.sessionId);
      assert.ok(node, 'graph map must contain the created node');
      assert.equal(node.subagentMode, 'wf-node-subagents');
    });

    it('C3 - an empty subagentMode input is defaulted to built-in-subagents, not rejected', async () => {
      const session = await createSessionViaApi({ subagentMode: '' });
      assert.equal(session.subagentMode, 'built-in-subagents');
      const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent(`session-${session.sessionId}`)}`);
      assert.equal(ctx.status, 200, JSON.stringify(ctx.body));
      assert.equal(ctx.body.context.subagentMode, 'built-in-subagents');
    });

    it('C4 - agent.start with a new subagentMode restarts the node with the new mode', async () => {
      const session = await createSessionViaApi({ subagentMode: 'built-in-subagents' });
      const nodeId = `session-${session.sessionId}`;

      const started = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(nodeId)}/actions/agent.start`, {
        method: 'POST',
        body: { subagentMode: 'wf-node-subagents', deferPtySpawn: true },
      });
      assert.equal(started.status, 200, JSON.stringify(started.body));
      assert.equal(started.body.ok, true);
      assert.equal(started.body.action, 'agent.start');
      assert.equal(started.body.result.alreadyRunning, false);
      assert.equal(started.body.result.started.subagentMode, 'wf-node-subagents');

      // The typed snapshot derives per-node mode from the live session, so the
      // restarted node exposes the new mode.
      const snapshot = await jsonRequest(baseUrl, '/api/a2a/snapshot');
      assert.equal(snapshot.status, 200);
      const newEntry = snapshotNode(snapshot.body, started.body.result.started.sessionId);
      assert.ok(newEntry, 'restarted session must appear in the snapshot');
      assert.equal(newEntry.subagentMode, 'wf-node-subagents');
      assert.equal(newEntry.graphNodeId, nodeId, 'node id must survive the restart');
      assert.equal(
        (snapshot.body.nodes || []).some(n => n.sessionId === session.sessionId),
        false,
        'the old session must leave the snapshot after the restart',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Group D: Backward Compat (D1-D2)
  // ══════════════════════════════════════════════════════════════════
  describe('Backward Compat (D1-D2)', () => {
    it('D1 - the legacy wf-subagents id is absent from the snapshot catalog', async () => {
      const snapshot = await jsonRequest(baseUrl, '/api/a2a/snapshot');
      assert.equal(snapshot.status, 200);
      assert.equal(snapshot.body.subagentModes.some(mode => mode.id === 'wf-subagents'), false);
    });

    it('D2 - a legacy wf-subagents session survives the round-trip normalized everywhere', async () => {
      const session = await createSessionViaApi({ subagentMode: 'wf-subagents' });
      assert.equal(session.subagentMode, 'wf-node-subagents', 'create response is normalized');

      const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent(`session-${session.sessionId}`)}`);
      assert.equal(ctx.status, 200, JSON.stringify(ctx.body));
      assert.equal(ctx.body.context.subagentMode, 'wf-node-subagents', 'context is normalized');

      const snapshot = await jsonRequest(baseUrl, '/api/a2a/snapshot');
      const entry = snapshotNode(snapshot.body, session.sessionId);
      assert.ok(entry, 'session must appear in the snapshot');
      assert.equal(entry.subagentMode, 'wf-node-subagents', 'snapshot is normalized');

      const graph = await jsonRequest(baseUrl, '/api/a2a/graph-map');
      const node = graphMapNode(graph.body, session.sessionId);
      assert.ok(node, 'session must appear in the graph map');
      assert.equal(node.subagentMode, 'wf-node-subagents', 'graph node is normalized');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Group E: Codex Runtime Scenarios (E1-E5)
  //   AC-MATRIX-003: Codex main + built-in-subagents — native
  //     subagent/tool/role path OR clear degradation evidence
  //   AC-MATRIX-004: Codex main + wf-node-subagents — create/connect
  //     Claude Code implementer, send task, reply, aggregate
  // ══════════════════════════════════════════════════════════════════
  describe('Codex Runtime Scenarios (E1-E5)', () => {
    function readInit(sessionId) {
      const initPath = path.join(root, 'Harness', 'a2a', 'nodes', sessionId, 'init.md');
      assert.ok(fs.existsSync(initPath), `init.md must be written to the node home for ${sessionId}`);
      return fs.readFileSync(initPath, 'utf8');
    }

    it('E1 - Codex sessions without an explicit subagentMode default to built-in-subagents (AC-NL-003)', async () => {
      const session = await createSessionViaApi({
        runtime: 'codex',
        agentKind: 'main',
        role: 'Main Agent',
        roleTitle: 'ceo',
      });
      assert.equal(session.runtime, 'codex');
      assert.equal(session.subagentMode, 'built-in-subagents');
    });

    it('E2 - Codex + built-in-subagents init prompt guides the native tool/role path and never instructs WF canvas node creation (AC-MATRIX-003)', async () => {
      const session = await createSessionViaApi({
        runtime: 'codex',
        agentKind: 'main',
        role: 'Main Agent',
        roleTitle: 'ceo',
        subagentMode: 'built-in-subagents',
      });
      const init = readInit(session.sessionId);
      // The built-in guidance must describe the Codex-native subagent path
      // (codex_implement / tool-role path), not only Claude Code's Agent tool.
      assert.match(init, /codex_implement|tool\/role path/i,
        'built-in guidance must name the Codex native subagent/tool/role path');
      // For a built-in session the init prompt must not instruct the agent to
      // create WF canvas worker nodes.
      assert.doesNotMatch(init, /wf-ui-control\.mjs create-agent/,
        'built-in init prompt must not instruct creating WF canvas nodes');
    });

    it('E3 - Codex + wf-node-subagents init prompt guides WF Agent nodes, Claude Code implementer workers, and mailbox flow (AC-MATRIX-004)', async () => {
      const session = await createSessionViaApi({
        runtime: 'codex',
        agentKind: 'main',
        role: 'Main Agent',
        roleTitle: 'ceo',
        subagentMode: 'wf-node-subagents',
      });
      const init = readInit(session.sessionId);
      assert.match(init, /create-agent/, 'init prompt must instruct creating/connecting WF Agent nodes');
      assert.match(init, /create\/connect WF Agent nodes/i,
        'init prompt must describe the create/connect flow for WF Agent nodes');
      assert.match(init, /Claude Code implementer/i,
        'Codex main must be told that a Claude Code implementer is the valid worker target');
      assert.match(init, /sendMessage/, 'init prompt must mention sendMessage mailbox communication');
      assert.match(init, /readMessages/, 'init prompt must mention readMessages mailbox aggregation');
    });

    it('E4 - Codex main creates a Claude Code worker through the typed API: runtime/agentKind, snapshot, and edge (AC-MATRIX-004)', async () => {
      const main = await createSessionViaApi({
        runtime: 'codex',
        agentKind: 'main',
        role: 'Main Agent',
        roleTitle: 'ceo',
        subagentMode: 'wf-node-subagents',
      });
      assert.equal(main.runtime, 'codex');
      assert.equal(main.agentKind, 'main');
      assert.equal(main.subagentMode, 'wf-node-subagents');

      const worker = await createSessionViaApi({
        runtime: 'claude',
        agentKind: 'subagent',
        role: 'Subagent',
        roleTitle: 'implementer',
        parentAgentId: main.sessionId,
      });
      assert.equal(worker.runtime, 'claude');
      assert.equal(worker.agentKind, 'subagent');

      const mainNodeId = `session-${main.sessionId}`;
      const workerNodeId = `session-${worker.sessionId}`;
      const connected = await jsonRequest(baseUrl, '/api/workflow/edges', {
        method: 'POST',
        body: { from: mainNodeId, to: workerNodeId, relation: 'delegation', direction: 'bidirectional' },
      });
      assert.equal(connected.status, 201, JSON.stringify(connected.body));

      const snapshot = await jsonRequest(baseUrl, '/api/a2a/snapshot');
      assert.equal(snapshot.status, 200);
      const mainEntry = snapshotNode(snapshot.body, main.sessionId);
      const workerEntry = snapshotNode(snapshot.body, worker.sessionId);
      assert.ok(mainEntry && workerEntry, 'snapshot must contain both the Codex main and the Claude Code worker');
      assert.equal(mainEntry.runtime, 'codex');
      assert.equal(workerEntry.runtime, 'claude');
      assert.equal(workerEntry.agentKind, 'subagent');
      assert.equal(workerEntry.parentAgentId, main.sessionId, 'worker must record its Codex main parent');

      const graph = await jsonRequest(baseUrl, '/api/a2a/graph-map');
      assert.equal(graph.status, 200);
      const edges = graph.body.edges || [];
      assert.ok(
        edges.some(edge => edge.from === mainNodeId && edge.to === workerNodeId),
        `an edge from the Codex main to the Claude Code worker must exist: ${JSON.stringify(edges)}`,
      );
    });

    it('E5 - Codex built-in-subagents capability status is reported and the degradation path is documented (AC-MATRIX-003)', async () => {
      // The runtime detector reports Codex's built-in-subagents capability
      // status through the typed runtimes endpoint; includeMissing lists the
      // definition even when the binary is not installed.
      const runtimes = await jsonRequest(baseUrl, '/api/runtimes?all=1');
      assert.equal(runtimes.status, 200, JSON.stringify(runtimes.body));
      const codex = (runtimes.body || []).find(entry => entry.id === 'codex');
      assert.ok(codex, 'the runtime detector must report the codex definition');
      assert.ok(Array.isArray(codex.capabilities), 'the codex definition must expose a capabilities list');
      const builtInStatus = codex.capabilities.includes('built-in-subagents');
      assert.equal(typeof builtInStatus, 'boolean',
        `built-in-subagents capability status must be a boolean (currently: ${builtInStatus})`);

      // Whatever the probe reports, the init prompt must tell a Codex
      // built-in session what to do when native subagents are unavailable.
      const session = await createSessionViaApi({
        runtime: 'codex',
        agentKind: 'main',
        role: 'Main Agent',
        roleTitle: 'ceo',
        subagentMode: 'built-in-subagents',
      });
      const init = readInit(session.sessionId);
      assert.match(init, /degrad/i,
        'init prompt must document the degradation path when Codex native subagents are unavailable');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Group F: NL Routing / Prompt Detection (F1-F3)
  //   AC-NL-001: NL phrases '内部助手/内置子代理' route to built-in-subagents
  //   AC-NL-002: NL phrases '画布节点/WF node协作' route to wf-node-subagents
  //   AC-NL-003: Unspecified defaults to built-in-subagents
  // ══════════════════════════════════════════════════════════════════
  describe('NL Routing / Prompt Detection (F1-F3)', () => {
    function readInit(sessionId) {
      const initPath = path.join(root, 'Harness', 'a2a', 'nodes', sessionId, 'init.md');
      assert.ok(fs.existsSync(initPath), `init.md must be written to the node home for ${sessionId}`);
      return fs.readFileSync(initPath, 'utf8');
    }

    it('F1 - init prompt carries built-in-subagents NL trigger phrases regardless of session mode (AC-NL-001)', async () => {
      // Created in wf-node mode on purpose: the routing table must stay
      // present so the agent can route an override request back to built-in.
      const session = await createSessionViaApi({ subagentMode: 'wf-node-subagents' });
      const init = readInit(session.sessionId);
      for (const phrase of ['内部助手', '内置子代理', 'native subagent', 'built-in']) {
        assert.ok(init.includes(phrase), `init.md must contain NL trigger phrase: ${phrase}`);
      }
      const mappingLine = init.split(/\r?\n/).find(line => line.includes('内部助手'));
      assert.ok(mappingLine && mappingLine.includes('built-in-subagents'),
        `trigger phrases must map to built-in-subagents: ${mappingLine}`);
    });

    it('F2 - init prompt carries wf-node-subagents NL trigger phrases regardless of session mode (AC-NL-002)', async () => {
      const session = await createSessionViaApi({ subagentMode: 'built-in-subagents' });
      const init = readInit(session.sessionId);
      for (const phrase of ['画布Agent节点', 'WF node协作', 'canvas worker']) {
        assert.ok(init.includes(phrase), `init.md must contain NL trigger phrase: ${phrase}`);
      }
      const mappingLine = init.split(/\r?\n/).find(line => line.includes('画布Agent节点'));
      assert.ok(mappingLine && mappingLine.includes('wf-node-subagents'),
        `trigger phrases must map to wf-node-subagents: ${mappingLine}`);
    });

    it('F3 - init prompt states that an unspecified mode defaults to built-in-subagents (AC-NL-003)', async () => {
      const session = await createSessionViaApi();
      const init = readInit(session.sessionId);
      assert.match(init, /Default when unspecified: built-in-subagents/);
    });
  });
});
