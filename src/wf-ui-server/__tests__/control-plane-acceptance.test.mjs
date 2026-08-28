// control-plane-acceptance.test.mjs
//
// Layer 1 backend in-process integration acceptance suite for the full
// control-plane matrix:
//   - Agent API matrix        (A1-A8): sessions, snapshots, edges, input,
//     output, 1-to-1 / 1-to-many messages, reply aggregation
//   - Timer-Agent matrix      (T1-T8): edge wakeup, magnetic-group wakeup,
//     multi-agent fan-out, Goal ref on wakeup, Goal does NOT wake, loop bound,
//     stop/disable cleanup, single-Goal-per-group rejection
//   - Functional Node matrix  (N1-N15): markdown find/read/lock/conflict,
//     file meta/text/refresh, excalidraw scene read/save/patch/invalid,
//     goal state machine, agent unified API, timer policy + internal actions
//   - Prompt / Manual matrix  (P1-P6): init.md identity, workflow context,
//     markdown/diagram/timer/goal manual injection, jargon-free language
//   - E2E chain               (E1): create/connect agents -> shared markdown
//     -> structured request -> replies -> timer wakeup -> goal check
//
// Pattern: node:test + assert/strict, in-process HTTP server on port 0,
// temp roots from makeHarnessTempRoot(), fake PTYs via registerPtyProcess.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import { registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';
import {
  persistSession,
  readTerminalRange,
  appendTerminalData,
} from '../terminal-store.mjs';
import {
  loadWorkflowGraphMap,
  writeWorkflowGraphMap,
} from '../a2a-store.mjs';
import { executeNodeAction } from '../workflow-node-runtime.mjs';
import { listBridgeMessages } from '../bridge-store.mjs';
import {
  isTimerSchedulerActive,
  stopTimerScheduler,
  syncTimerScheduler,
} from '../timer-wakeup-scheduler.mjs';

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

// ── Project seeding helpers ──
function seedRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

function seedAgentSession(root, nodeId, sessionId, overrides = {}) {
  persistSession(root, {
    sessionId,
    graphNodeId: nodeId,
    runtime: overrides.runtime || 'claude',
    agentKind: overrides.agentKind || 'subagent',
    role: overrides.role || 'Agent',
    roleTitle: overrides.roleTitle || '',
    displayName: overrides.displayName || overrides.roleTitle || '',
    status: 'running',
    attachMode: true,
    taskId: null,
    ...overrides,
  });
  const graph = loadWorkflowGraphMap(root);
  writeWorkflowGraphMap(root, {
    ...graph,
    version: graph.version + 1,
    nodes: [
      ...(graph.nodes || []).filter(n => (n.nodeId || n.id) !== nodeId),
      {
        nodeId,
        sessionId,
        kind: 'terminal-session',
        runtime: overrides.runtime || 'claude',
        agentKind: overrides.agentKind || 'subagent',
        role: overrides.role || 'Agent',
        label: overrides.label || overrides.displayName || overrides.role || 'Agent',
        status: 'running',
      },
    ],
  });
  return { nodeId, sessionId };
}

function writeGraphEdges(root, edges) {
  const graph = loadWorkflowGraphMap(root);
  writeWorkflowGraphMap(root, {
    ...graph,
    version: graph.version + 1,
    edges: [...(graph.edges || []), ...edges],
  });
}

function dockLink(a, b) {
  const pair = [a, b].sort();
  return {
    id: `dock:${pair[0]}::${pair[1]}`,
    nodeIds: pair,
    anchorId: pair[0],
    draggedId: pair[1],
    side: 'top',
    edges: [],
    connections: [
      {
        source: a,
        target: b,
        relation: 'wf-bridge',
        direction: 'source-to-target',
        sourceHandle: 'dock',
        targetHandle: 'dock',
      },
    ],
  };
}

function seedActiveTask(root, taskId = 'task-cp-acceptance') {
  fs.mkdirSync(path.join(root, 'Harness', 'tasks', taskId), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'PROGRESS.md'), `# PROGRESS.md\n\n## Active Task\n\n- ${taskId}\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    title: 'Control plane goal',
    nextAction: 'Complete the control plane matrix',
    phase: 'implement',
    acceptance: [],
    planItems: [],
    links: { dependsOn: [], blocks: [], related: [] },
  }));
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'PLAN.md'), '# Plan\n', 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'PROGRESS.md'), '# Progress\n', 'utf8');
  return `goal-${taskId}`;
}

function pastIso(seconds = 2) {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function futureIso(seconds = 3600) {
  return new Date(Date.now() + seconds * 1000).toISOString();
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

// ── Suite ──
describe('Layer 1 Control-Plane Acceptance', () => {
  let root;
  let registry;
  let server;
  let baseUrl;
  const registeredPties = [];

  beforeEach(async () => {
    root = seedRoot('cp-accept-');
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
    stopTimerScheduler();
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
  function registerPty(sessionId, writes) {
    registerPtyProcess(sessionId, { write: data => writes.push(String(data)) });
    registeredPties.push(sessionId);
  }

  async function createAgentViaApi(runtime = 'claude', agentKind = 'subagent', role = 'Subagent', roleTitle = 'implementer', extra = {}) {
    const res = await jsonRequest(baseUrl, '/api/sessions', {
      method: 'POST',
      body: {
        runtime,
        agentKind,
        role,
        roleTitle,
        displayName: roleTitle,
        responsibility: `${roleTitle} agent`,
        capabilities: ['terminal'],
        objective: 'Control plane acceptance agent',
        attachGraphNode: true,
        deferPtySpawn: true,
        ...extra,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { sessionId: res.body.sessionId, nodeId: `session-${res.body.sessionId}`, body: res.body };
  }

  async function createTimerViaApi(title, overrides = {}) {
    const res = await jsonRequest(baseUrl, '/api/workflow/nodes', {
      method: 'POST',
      body: {
        type: 'timer',
        title,
        enabled: true,
        schedule: { mode: 'interval', intervalSeconds: 60 },
        heartbeat: { base: { enabled: true, intervalSeconds: 60, nextDueAt: futureIso() } },
        ...overrides,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { nodeId: res.body.node.nodeId, body: res.body };
  }

  async function armTimer(timerNodeId, intervalSeconds) {
    const res = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(timerNodeId)}/actions/timer.configure`, {
      method: 'POST',
      body: { heartbeat: { base: { enabled: true, intervalSeconds, nextDueAt: pastIso() } } },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }

  async function timerState(timerNodeId) {
    const res = await executeNodeAction(root, timerNodeId, 'timer.read', {});
    return res.result;
  }

  function wakeupEntries(timerNodeId, sessionId) {
    return listBridgeMessages(root, { fromSessionId: `wakeup-${timerNodeId}`, toSessionId: sessionId }).entries;
  }

  // ══════════════════════════════════════════════════════════════════
  // Agent API Matrix (A1-A8)
  // ══════════════════════════════════════════════════════════════════
  describe('Agent API Matrix (A1-A8)', () => {
    it('A1 - POST /api/sessions creates an Agent node with identity and node card', async () => {
      const created = await jsonRequest(baseUrl, '/api/sessions', {
        method: 'POST',
        body: {
          runtime: 'claude',
          agentKind: 'main',
          role: 'Main Agent',
          roleTitle: 'ceo',
          displayName: 'Controller',
          responsibility: 'Coordinate the worker team.',
          capabilities: ['terminal-control', 'dispatch'],
          objective: 'Control plane coverage',
          attachGraphNode: true,
          deferPtySpawn: true,
        },
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const session = created.body;
      assert.ok(session.sessionId, 'session must carry a sessionId');
      const nodeId = `session-${session.sessionId}`;
      assert.equal(session.graphNodeId, nodeId, 'session must be bound to its graph node');
      assert.equal(session.displayName, 'Controller');
      assert.equal(session.roleTitle, 'ceo');
      assert.equal(session.roleProfileRef, `Harness/a2a/agent-roles/${nodeId}.md`);
      assert.equal(session.status, 'blocked', 'deferPtySpawn must keep the session blocked');

      const snapshot = await jsonRequest(baseUrl, '/api/workflow');
      assert.equal(snapshot.status, 200);
      const graphNode = (snapshot.body.nodes || []).find(n => n.sessionId === session.sessionId);
      assert.ok(graphNode, 'graph must contain the new Agent node');
      assert.equal(graphNode.kind, 'terminal-session');
      assert.equal(graphNode.graphNodeId, nodeId);

      const card = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(nodeId)}`);
      assert.equal(card.status, 200, JSON.stringify(card.body));
      assert.equal(card.body.node.kind, 'agent');
      assert.equal(card.body.node.nodeId, nodeId);
      assert.equal(card.body.node.sessionId, session.sessionId);
      assert.ok(card.body.node.status, 'node card must carry status metadata');
    });

    it('A2 - snapshot exposes nodes/edges/capsuleDockLinks and version advances on create/connect/delete', async () => {
      const v0 = (await jsonRequest(baseUrl, '/api/a2a/snapshot')).body.snapshotVersion;

      const a = await createAgentViaApi('claude', 'main', 'Main Agent', 'ceo');
      const b = await createAgentViaApi('claude', 'subagent', 'Subagent', 'implementer');
      const v1 = (await jsonRequest(baseUrl, '/api/a2a/snapshot')).body.snapshotVersion;
      assert.ok(v1 > v0, `creating an Agent node must advance the graph version (${v0} -> ${v1})`);

      const connected = await jsonRequest(baseUrl, '/api/workflow/edges', {
        method: 'POST',
        body: { from: a.nodeId, to: b.nodeId, relation: 'delegation', direction: 'bidirectional' },
      });
      assert.equal(connected.status, 201, JSON.stringify(connected.body));
      const v2 = (await jsonRequest(baseUrl, '/api/a2a/snapshot')).body.snapshotVersion;
      assert.ok(v2 > v1, `connecting nodes must advance the graph version (${v1} -> ${v2})`);

      const snapshot = (await jsonRequest(baseUrl, '/api/a2a/snapshot')).body;
      assert.ok(Array.isArray(snapshot.nodes), 'snapshot must expose nodes');
      assert.ok(snapshot.nodes.some(n => n.sessionId === a.sessionId), 'snapshot must contain Agent A');
      assert.ok(snapshot.nodes.some(n => n.sessionId === b.sessionId), 'snapshot must contain Agent B');
      assert.equal(snapshot.edges.length, 1);
      assert.equal(snapshot.edges[0].relation, 'delegation');
      assert.equal(snapshot.edges[0].direction, 'bidirectional');
      assert.ok(Array.isArray(snapshot.graph.capsuleDockLinks), 'snapshot graph must expose capsuleDockLinks');

      const deleted = await jsonRequest(baseUrl, `/api/a2a/graph-nodes/${encodeURIComponent(b.nodeId)}`, { method: 'DELETE' });
      assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
      const v3 = (await jsonRequest(baseUrl, '/api/a2a/snapshot')).body.snapshotVersion;
      assert.ok(v3 > v2, `deleting a node must advance the graph version (${v2} -> ${v3})`);
      const after = (await jsonRequest(baseUrl, '/api/a2a/snapshot')).body;
      assert.ok(!after.nodes.some(n => n.sessionId === b.sessionId), 'deleted node must leave the snapshot');
      assert.equal(after.edges.length, 0, 'edges referencing the deleted node must be cleaned up');
    });

    it('A3 - connecting two Agents exposes each side in the other workflow context', async () => {
      const a = await createAgentViaApi('claude', 'main', 'Main Agent', 'ceo');
      const b = await createAgentViaApi('claude', 'subagent', 'Subagent', 'implementer');
      const connected = await jsonRequest(baseUrl, '/api/workflow/edges', {
        method: 'POST',
        body: { from: a.nodeId, to: b.nodeId, relation: 'delegation', direction: 'bidirectional' },
      });
      assert.equal(connected.status, 201, JSON.stringify(connected.body));

      const ctxA = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent(a.nodeId)}`);
      assert.equal(ctxA.status, 200, JSON.stringify(ctxA.body));
      const peerA = (ctxA.body.context.connectedPeers || []).find(p => p.nodeId === b.nodeId);
      assert.ok(peerA, `A context must list B as a connected peer: ${JSON.stringify(ctxA.body.context.connectedPeers)}`);
      assert.equal(peerA.type, 'agent');
      assert.equal(peerA.sessionId, b.sessionId);

      const ctxB = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent(b.nodeId)}`);
      const peerB = (ctxB.body.context.connectedPeers || []).find(p => p.nodeId === a.nodeId);
      assert.ok(peerB, 'B context must list A as a connected peer');
      assert.equal(peerB.type, 'agent');
      assert.equal(peerB.sessionId, a.sessionId);
    });

    it('A4 - POST /api/sessions/:id/input forwards to the fake PTY and records stdin', async () => {
      const agent = await createAgentViaApi('claude', 'subagent', 'Subagent', 'implementer');
      const writes = [];
      registerPty(agent.sessionId, writes);

      const sent = await jsonRequest(baseUrl, `/api/sessions/${agent.sessionId}/input`, {
        method: 'POST',
        body: { data: 'echo hello' },
      });
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      assert.equal(sent.body.ok, true);
      assert.deepEqual(writes, ['echo hello'], 'fake PTY must receive the input');

      const range = readTerminalRange(root, { sessionId: agent.sessionId });
      const stdinEntry = (range.entries || []).find(e => e.stream === 'stdin');
      assert.ok(stdinEntry, 'terminal store must record the stdin write');
      assert.equal(stdinEntry.data, 'echo hello');
      assert.ok(stdinEntry.seq >= 1);

      const requestsPath = path.join(root, 'Harness', 'a2a', 'sessions', agent.sessionId, 'input-requests.jsonl');
      const lines = fs.readFileSync(requestsPath, 'utf8').split(/\r?\n/).filter(Boolean);
      const request = JSON.parse(lines[lines.length - 1]);
      assert.equal(request.type, 'terminal.input.requested');
      assert.equal(request.data, 'echo hello');
    });

    it('A5 - GET /api/terminals/:id/range returns written entries with tail/fromSeq/toSeq', async () => {
      const sessionId = 'session-a5-range';
      persistSession(root, {
        sessionId,
        graphNodeId: 'agent-a5',
        runtime: 'claude',
        agentKind: 'subagent',
        role: 'Subagent',
        status: 'running',
        attachMode: true,
        taskId: null,
      });
      appendTerminalData(root, { sessionId, runtime: 'claude' }, 'line-one', 'stdout');
      appendTerminalData(root, { sessionId, runtime: 'claude' }, 'line-two', 'stdout');
      appendTerminalData(root, { sessionId, runtime: 'claude' }, 'line-three', 'stdout');

      const tail = await jsonRequest(baseUrl, '/api/terminals/session-a5-range/range?tail=2');
      assert.equal(tail.status, 200);
      assert.equal(tail.body.entries.length, 2);
      assert.deepEqual(tail.body.entries.map(e => e.data), ['line-two', 'line-three']);

      const windowed = await jsonRequest(baseUrl, '/api/terminals/session-a5-range/range?fromSeq=2&toSeq=2');
      assert.equal(windowed.body.entries.length, 1);
      assert.equal(windowed.body.entries[0].seq, 2);
      assert.equal(windowed.body.entries[0].data, 'line-two');
    });

    it('A6 - agent.sendMessage delivers the harness-request prefix and records requestId/contextRefs/toRole', async () => {
      seedAgentSession(root, 'agent-a6-a', 'session-a6-a', { agentKind: 'main', role: 'Main Agent' });
      seedAgentSession(root, 'agent-a6-b', 'session-a6-b', {});
      writeGraphEdges(root, [
        { id: 'edge-a6-a-b', from: 'agent-a6-a', to: 'agent-a6-b', relation: 'delegation', direction: 'bidirectional' },
      ]);
      const writesB = [];
      registerPty('session-a6-b', writesB);

      const sent = await jsonRequest(baseUrl, '/api/workflow/nodes/agent-a6-a/actions/agent.sendMessage', {
        method: 'POST',
        body: {
          to: 'agent-a6-b',
          text: 'STRUCTURED_A6',
          requestId: 'req-a6-1',
          toRole: 'implementer',
          contextRefs: [{ nodeId: 'markdown-x1', relation: 'shared-context' }],
        },
      });
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      assert.equal(sent.body.result.mode, 'direct');
      assert.equal(sent.body.result.requestId, 'req-a6-1');
      const envelopeA6 = '[harness-request req-a6-1 to-role=implementer contextRefs=markdown-x1] STRUCTURED_A6';
      assert.ok(writesB.length >= 1, 'envelope typing must start immediately');
      assert.equal(writesB[0], '[', 'envelope typing must start with the first prefix char synchronously');
      await waitFor(() => (writesB.join('') === `${envelopeA6}\r` ? writesB : null), { timeout: 8000 });
      assert.equal(writesB.join(''), `${envelopeA6}\r`, 'the typed envelope must join to the exact prefix + text + \\r');
      assert.equal(writesB[writesB.length - 1], '\r', 'the delivered sequence must end with the single \\r');
      assert.equal(writesB.join('').includes('\n'), false, 'no \\n may be injected');
      assert.equal(writesB.filter(w => w === '\r').length, 1, 'exactly one \\r (0x0D) in the delivered sequence');

      const bridge = listBridgeMessages(root, { fromSessionId: 'session-a6-a', toSessionId: 'session-a6-b' });
      assert.equal(bridge.entries.length, 1);
      const entry = bridge.entries[0];
      assert.equal(entry.requestId, 'req-a6-1');
      assert.equal(entry.toRole, 'implementer');
      assert.deepEqual(entry.contextRefs, [{ nodeId: 'markdown-x1', relation: 'shared-context' }]);
      assert.equal(entry.deliveryMode, 'direct');
      assert.equal(entry.fromNodeId, 'agent-a6-a');
      assert.equal(entry.toNodeId, 'agent-a6-b');
      assert.equal(entry.data.replace(/\r$/, ''), 'STRUCTURED_A6', 'bridge data must stay the plain text body');
    });

    it('A7 - agent.broadcastMessage delivers independent per-recipient inputs with recipientIndex/recipientCount', async () => {
      seedAgentSession(root, 'agent-a7-a', 'session-a7-a', { agentKind: 'main', role: 'Main Agent' });
      seedAgentSession(root, 'agent-a7-b', 'session-a7-b', {});
      seedAgentSession(root, 'agent-a7-c', 'session-a7-c', {});
      seedAgentSession(root, 'agent-a7-d', 'session-a7-d', {});
      writeGraphEdges(root, [
        { id: 'e7-a-b', from: 'agent-a7-a', to: 'agent-a7-b', relation: 'delegation', direction: 'bidirectional' },
        { id: 'e7-a-c', from: 'agent-a7-a', to: 'agent-a7-c', relation: 'delegation', direction: 'bidirectional' },
        { id: 'e7-a-d', from: 'agent-a7-a', to: 'agent-a7-d', relation: 'delegation', direction: 'bidirectional' },
      ]);
      const writes = { b: [], c: [], d: [] };
      registerPty('session-a7-b', writes.b);
      registerPty('session-a7-c', writes.c);
      registerPty('session-a7-d', writes.d);

      const res = await jsonRequest(baseUrl, '/api/workflow/nodes/agent-a7-a/actions/agent.broadcastMessage', {
        method: 'POST',
        body: { to: ['agent-a7-b', 'agent-a7-c', 'agent-a7-d'], text: 'GROUP_A7', requestId: 'req-a7-1', toRole: 'worker' },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.result.deliveredCount, 3);
      assert.equal(res.body.result.failedCount, 0);
      assert.equal(res.body.result.requestId, 'req-a7-1');
      const envelopeA7 = '[harness-request req-a7-1 to-role=worker] GROUP_A7';
      for (const key of ['b', 'c', 'd']) {
        assert.ok(writes[key].length >= 1, `${key} must receive exactly one independent input`);
        assert.equal(writes[key][0], '[', `${key} must start typing the envelope prefix synchronously`);
      }
      for (const key of ['b', 'c', 'd']) {
        await waitFor(() => (writes[key].join('') === `${envelopeA7}\r` ? writes[key] : null), { timeout: 8000 });
        assert.equal(writes[key].join(''), `${envelopeA7}\r`, `${key} must submit the typed body with a single \\r`);
        assert.equal(writes[key][writes[key].length - 1], '\r', `${key} \\r must be the final write`);
      }

      const entries = ['b', 'c', 'd'].map((key, index) => {
        const bridge = listBridgeMessages(root, { fromSessionId: 'session-a7-a', toSessionId: `session-a7-${key}` });
        assert.equal(bridge.entries.length, 1);
        const entry = bridge.entries[0];
        assert.equal(entry.requestId, 'req-a7-1');
        assert.equal(entry.toRole, 'worker');
        assert.equal(entry.recipientIndex, index + 1, 'recipientIndex must be per-recipient');
        assert.equal(entry.recipientCount, 3, 'recipientCount must be the fan-out size');
        return entry;
      });
      assert.equal(new Set(entries.map(e => e.messageId)).size, 1, 'one broadcast shares one messageId');

      // The same requestId aggregates across recipients.
      const aggregated = await jsonRequest(baseUrl, '/api/workflow/nodes/agent-a7-a/actions/agent.readMessages', {
        method: 'POST',
        body: { requestId: 'req-a7-1' },
      });
      assert.equal(aggregated.status, 200);
      assert.equal(aggregated.body.result.entries.length, 3);
    });

    it('A8 - replies share the requestId and replyTo resolves to the originating message', async () => {
      seedAgentSession(root, 'agent-a8-a', 'session-a8-a', { agentKind: 'main', role: 'Main Agent' });
      seedAgentSession(root, 'agent-a8-b', 'session-a8-b', {});
      seedAgentSession(root, 'agent-a8-c', 'session-a8-c', {});
      writeGraphEdges(root, [
        { id: 'e8-a-b', from: 'agent-a8-a', to: 'agent-a8-b', relation: 'delegation', direction: 'bidirectional' },
        { id: 'e8-a-c', from: 'agent-a8-a', to: 'agent-a8-c', relation: 'delegation', direction: 'bidirectional' },
      ]);
      registerPty('session-a8-a', []);
      registerPty('session-a8-b', []);
      registerPty('session-a8-c', []);

      const broadcast = await jsonRequest(baseUrl, '/api/workflow/nodes/agent-a8-a/actions/agent.broadcastMessage', {
        method: 'POST',
        body: { to: ['agent-a8-b', 'agent-a8-c'], text: 'REQ_A8', requestId: 'req-a8-1', threadId: 'thread-a8' },
      });
      assert.equal(broadcast.status, 200, JSON.stringify(broadcast.body));
      const originMessageId = broadcast.body.result.messageId;
      assert.ok(originMessageId);

      for (const [sender, replyText] of [['agent-a8-b', 'REPLY_B8'], ['agent-a8-c', 'REPLY_C8']]) {
        const replied = await jsonRequest(baseUrl, `/api/workflow/nodes/${sender}/actions/agent.sendMessage`, {
          method: 'POST',
          body: { to: 'agent-a8-a', text: replyText, requestId: 'req-a8-1', threadId: 'thread-a8', replyTo: originMessageId },
        });
        assert.equal(replied.status, 200, JSON.stringify(replied.body));
        assert.equal(replied.body.result.requestId, 'req-a8-1');
      }

      const read = await jsonRequest(baseUrl, '/api/workflow/nodes/agent-a8-a/actions/agent.readMessages', {
        method: 'POST',
        body: { requestId: 'req-a8-1' },
      });
      assert.equal(read.status, 200, JSON.stringify(read.body));
      assert.equal(read.body.result.mode, 'request');
      assert.equal(read.body.result.entries.length, 4, '2 deliveries + 2 replies in one request thread');
      const replies = read.body.result.entries.filter(e => String(e.data).replace(/\r$/, '').startsWith('REPLY'));
      assert.equal(replies.length, 2);
      for (const reply of replies) {
        assert.equal(reply.requestId, 'req-a8-1');
        assert.equal(reply.replyTo, originMessageId, 'replies must reference the originating messageId');
      }

      const peerRead = await jsonRequest(baseUrl, '/api/workflow/nodes/agent-a8-a/actions/agent.readMessages', {
        method: 'POST',
        body: { peer: 'agent-a8-b' },
      });
      assert.equal(peerRead.status, 200);
      assert.equal(peerRead.body.result.entries.length, 2);
      assert.equal(peerRead.body.result.entries[1].replyTo, originMessageId);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Timer-Agent Matrix (T1-T8)
  // ══════════════════════════════════════════════════════════════════
  describe('Timer-Agent Matrix (T1-T8)', () => {
    it('T1 - Timer normal edge wakeup reaches the connected Agent message queue', async () => {
      const timer = await createTimerViaApi('T1 Edge Timer');
      const timerNodeId = timer.nodeId;
      seedAgentSession(root, 'agent-t1', 'session-t1', {});
      writeGraphEdges(root, [
        { id: 'e-t1', from: timerNodeId, to: 'agent-t1', relation: 'event', direction: 'source-to-target' },
      ]);
      await armTimer(timerNodeId, 60);
      await syncTimerScheduler(root, { intervalMs: 20 });

      const entries = await waitFor(() => {
        const result = wakeupEntries(timerNodeId, 'session-t1');
        return result.length ? result : null;
      });
      assert.equal(entries.length, 1);
      const entry = entries[0];
      assert.equal(entry.deliveryMode, 'wakeup');
      assert.equal(entry.source, 'timer.wakeup');
      assert.equal(entry.toNodeId, 'agent-t1');
      assert.equal(entry.fromNodeId, timerNodeId);
      const envelope = JSON.parse(entry.data);
      assert.equal(envelope.type, 'wakeup');
      assert.equal(envelope.timerNodeId, timerNodeId);
      assert.equal(envelope.goalNodeId, null, 'no Goal in the group -> goalNodeId null');
      assert.ok(Number.isFinite(Date.parse(envelope.firedAt)));
      assert.equal(envelope.intervalSeconds, 60);
    });

    it('T2 - magnetic group wakeup reaches group members only', async () => {
      const timer = await createTimerViaApi('T2 Group Timer');
      const timerNodeId = timer.nodeId;
      seedAgentSession(root, 'agent-t2-a', 'session-t2-a', {});
      seedAgentSession(root, 'agent-t2-b', 'session-t2-b', {});
      seedAgentSession(root, 'agent-t2-c', 'session-t2-c', {});
      const graph = loadWorkflowGraphMap(root);
      writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [
          dockLink('agent-t2-a', timerNodeId),
          dockLink('agent-t2-b', timerNodeId),
        ],
      });
      await armTimer(timerNodeId, 60);
      await syncTimerScheduler(root, { intervalMs: 20 });

      for (const member of ['session-t2-a', 'session-t2-b']) {
        await waitFor(() => {
          const result = wakeupEntries(timerNodeId, member);
          return result.length ? result : null;
        });
      }
      const aEntries = wakeupEntries(timerNodeId, 'session-t2-a');
      const bEntries = wakeupEntries(timerNodeId, 'session-t2-b');
      assert.equal(aEntries.length, 1);
      assert.equal(bEntries.length, 1);
      assert.equal(aEntries[0].messageId, bEntries[0].messageId, 'one fire dispatches one shared wakeup messageId');
      const cEntries = wakeupEntries(timerNodeId, 'session-t2-c');
      assert.equal(cEntries.length, 0, 'non-group member must receive no wakeup');
    });

    it('T3 - one Timer wakes all three docked Agents with no duplicates', async () => {
      const timer = await createTimerViaApi('T3 Fan-out Timer');
      const timerNodeId = timer.nodeId;
      seedAgentSession(root, 'agent-t3-b', 'session-t3-b', {});
      seedAgentSession(root, 'agent-t3-c', 'session-t3-c', {});
      seedAgentSession(root, 'agent-t3-d', 'session-t3-d', {});
      const graph = loadWorkflowGraphMap(root);
      writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [
          dockLink('agent-t3-b', timerNodeId),
          dockLink('agent-t3-c', timerNodeId),
          dockLink('agent-t3-d', timerNodeId),
        ],
      });
      await armTimer(timerNodeId, 60);
      await syncTimerScheduler(root, { intervalMs: 20 });

      const messageIds = new Set();
      for (const member of ['session-t3-b', 'session-t3-c', 'session-t3-d']) {
        const entries = await waitFor(() => {
          const result = wakeupEntries(timerNodeId, member);
          return result.length ? result : null;
        });
        assert.equal(entries.length, 1, `no duplicate wakeup for ${member}`);
        assert.equal(entries[0].deliveryMode, 'wakeup');
        messageIds.add(entries[0].messageId);
      }
      assert.equal(messageIds.size, 1, 'one fire must use one shared wakeup messageId');
    });

    it('T4 - wakeup envelope carries the magnetic group Goal node id', async () => {
      const goalNodeId = seedActiveTask(root, 'task-t4-goal');
      const timer = await createTimerViaApi('T4 Goal Timer');
      const timerNodeId = timer.nodeId;
      seedAgentSession(root, 'agent-t4', 'session-t4', {});
      const graph = loadWorkflowGraphMap(root);
      writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [
          dockLink('agent-t4', timerNodeId),
          dockLink(timerNodeId, goalNodeId),
        ],
      });
      await armTimer(timerNodeId, 60);
      await syncTimerScheduler(root, { intervalMs: 20 });

      const entries = await waitFor(() => {
        const result = wakeupEntries(timerNodeId, 'session-t4');
        return result.length ? result : null;
      });
      const envelope = JSON.parse(entries[0].data);
      assert.equal(envelope.type, 'wakeup');
      assert.equal(envelope.goalNodeId, goalNodeId, 'wakeup must carry the group goal node id');
    });

    it('T5 - changing Goal state never wakes the Agent and the Goal exposes no wakeup action', async () => {
      const goalNodeId = seedActiveTask(root, 'task-t5-goal');
      const timer = await createTimerViaApi('T5 Quiet Timer'); // armed far in the future
      const timerNodeId = timer.nodeId;
      seedAgentSession(root, 'agent-t5', 'session-t5', {});
      const graph = loadWorkflowGraphMap(root);
      writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [
          dockLink('agent-t5', timerNodeId),
          dockLink(timerNodeId, goalNodeId),
          dockLink('agent-t5', goalNodeId),
        ],
      });
      await syncTimerScheduler(root, { intervalMs: 20 });
      assert.equal(isTimerSchedulerActive(), true, 'scheduler runs while an enabled timer exists');

      const updated = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(goalNodeId)}/actions/goal.update`, {
        method: 'POST',
        body: { nextAction: 'T5 goal state change' },
      });
      assert.equal(updated.status, 200, JSON.stringify(updated.body));
      assert.equal(updated.body.result.state.nextAction, 'T5 goal state change');

      await new Promise(resolve => setTimeout(resolve, 300));
      assert.equal(wakeupEntries(timerNodeId, 'session-t5').length, 0, 'Goal state changes must not wake the Agent');
      const read = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(timerNodeId)}/actions/timer.read`, {
        method: 'POST',
        body: {},
      });
      assert.equal(read.body.result.eventCount, 0, 'the timer must not have fired from a Goal change');

      const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent('agent-t5')}`);
      const goalRef = (ctx.body.context.connectedGoalRefs || []).find(ref => ref.nodeId === goalNodeId);
      assert.ok(goalRef, 'agent context must expose the connected Goal ref');
      assert.ok(!JSON.stringify(goalRef.capabilities || []).match(/wake/i), 'Goal affordance exposes no wakeup action');
      const timerAffordance = (ctx.body.context.affordances || []).find(item => item.type === 'timer');
      assert.ok(timerAffordance, 'timer affordance must be present');
      assert.ok(timerAffordance.deniedActions.includes('timer.dispatchWakeup'), 'agents must not self-wake');
      assert.ok(timerAffordance.deniedActions.includes('timer.fire'));
      assert.ok(timerAffordance.deniedActions.includes('timer.tick'));
    });

    it('T6 - bounded loop maxIterations stops the Timer after the configured fire count', async () => {
      const timer = await createTimerViaApi('T6 Loop Timer', {
        schedule: { mode: 'interval', intervalSeconds: 1 },
        heartbeat: { base: { enabled: true, intervalSeconds: 1, nextDueAt: futureIso() } },
        loop: { enabled: true, maxIterations: 2, runCount: 0 },
      });
      const timerNodeId = timer.nodeId;
      seedAgentSession(root, 'agent-t6', 'session-t6', {});
      const graph = loadWorkflowGraphMap(root);
      writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [dockLink('agent-t6', timerNodeId)],
      });
      await armTimer(timerNodeId, 1);
      await syncTimerScheduler(root, { intervalMs: 20 });

      await waitFor(async () => {
        const state = await timerState(timerNodeId);
        return state.eventCount >= 2 ? state : null;
      }, { timeout: 7000 });

      const afterTwo = await timerState(timerNodeId);
      assert.equal(afterTwo.eventCount, 2, 'timer must fire exactly maxIterations times');
      assert.equal(afterTwo.loop.runCount, 2);
      assert.equal(afterTwo.loop.enabled, false, 'loop must mark itself complete after maxIterations');

      await new Promise(resolve => setTimeout(resolve, 1600));
      const final = await timerState(timerNodeId);
      assert.equal(final.eventCount, 2, 'a third fire must not advance past the loop bound');
      assert.equal(final.loop.runCount, 2);
    });

    it('T7 - timer.disable stops the scheduler and no further wakeups are dispatched', async () => {
      const timer = await createTimerViaApi('T7 Disable Timer', {
        controlPolicy: { agentCanDisable: true },
      });
      const timerNodeId = timer.nodeId;
      seedAgentSession(root, 'agent-t7', 'session-t7', {});
      const graph = loadWorkflowGraphMap(root);
      writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [dockLink('agent-t7', timerNodeId)],
      });
      await armTimer(timerNodeId, 60);
      await syncTimerScheduler(root, { intervalMs: 20 });

      await waitFor(() => {
        const result = wakeupEntries(timerNodeId, 'session-t7');
        return result.length ? result : null;
      });
      assert.equal(isTimerSchedulerActive(), true, 'scheduler must be active while an enabled timer exists');

      const disabled = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(timerNodeId)}/actions/timer.disable`, {
        method: 'POST',
        body: {},
      });
      assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
      assert.equal(disabled.body.result.state.enabled, false);
      assert.equal(disabled.body.result.state.heartbeat.base.enabled, false);
      assert.equal(isTimerSchedulerActive(), false, 'no enabled timers remain, so the scheduler must stop');

      await new Promise(resolve => setTimeout(resolve, 250));
      const after = wakeupEntries(timerNodeId, 'session-t7');
      assert.equal(after.length, 1, 'no wakeup may be dispatched after disable');
    });

    it('T8 - second Goal into a Timer+Agent group rejected by HTTP route and agent.connectNodes', async () => {
      const firstGoalNodeId = seedActiveTask(root, 'task-t8-goal');
      const created = await jsonRequest(baseUrl, '/api/workflow/nodes', {
        method: 'POST',
        body: { type: 'timer', title: 'T8 Timer', enabled: false, schedule: { mode: 'manual', intervalSeconds: 60 } },
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const timerNodeId = created.body.node.nodeId;
      seedAgentSession(root, 'agent-t8', 'session-t8', { agentKind: 'main', role: 'Main Agent' });
      let graph = loadWorkflowGraphMap(root);
      writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [
          dockLink('agent-t8', timerNodeId),
          dockLink(timerNodeId, firstGoalNodeId),
        ],
      });

      // Inject a second goal-shaped node into the same magnetic group.
      graph = loadWorkflowGraphMap(root);
      writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        nodes: [...(graph.nodes || []), { nodeId: 'goal-second', label: 'Second Goal' }],
        capsuleDockLinks: [...(graph.capsuleDockLinks || []), dockLink('agent-t8', 'goal-second')],
      });

      const viaHttp = await jsonRequest(baseUrl, '/api/workflow/edges', {
        method: 'POST',
        body: { from: 'agent-t8', to: 'goal-second', relation: 'goal' },
      });
      assert.equal(viaHttp.status, 409, JSON.stringify(viaHttp.body));
      assert.equal(viaHttp.body.error, 'goal_already_bound');
      assert.ok(String(viaHttp.body.message).includes('already has a Goal'), viaHttp.body.message);
      assert.equal(viaHttp.body.existingGoalNodeId, firstGoalNodeId);
      assert.equal(viaHttp.body.timerNodeId, timerNodeId);

      await assert.rejects(
        () => executeNodeAction(root, 'agent-t8', 'agent.connectNodes', {
          to: 'goal-second',
          relation: 'goal',
          actorNodeId: 'agent-t8',
        }),
        (error) => {
          assert.equal(error.code, 'goal_already_bound');
          assert.equal(error.existingGoalNodeId, firstGoalNodeId);
          assert.equal(error.timerNodeId, timerNodeId);
          return true;
        },
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Functional Node Control Matrix (N1-N15)
  // ══════════════════════════════════════════════════════════════════
  describe('Functional Node Control Matrix (N1-N15)', () => {
    function nodeAction(nodeId, action, body = {}) {
      return jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(nodeId)}/actions/${action}`, { method: 'POST', body });
    }

    async function createNode(type, body = {}) {
      const res = await jsonRequest(baseUrl, '/api/workflow/nodes', { method: 'POST', body: { type, ...body } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body.node.nodeId;
    }

    describe('Markdown (N1-N5)', () => {
      it('N1 - markdown.find returns metadata only, never content', async () => {
        const board = await createNode('markdown', { title: 'Sprint Board', markdown: '# Sprint\nsecret body' });
        const design = await createNode('markdown', { title: 'Design Notes', markdown: '# Design\nsecret body' });

        const byNodeId = await nodeAction(board, 'markdown.find', { nodeId: board });
        assert.equal(byNodeId.status, 200);
        assert.equal(byNodeId.body.result.count, 1);
        const match = byNodeId.body.result.matches[0];
        assert.equal(match.nodeId, board);
        assert.equal(match.title, 'Sprint Board');
        assert.equal(match.revision, 1);
        assert.ok(match.stateRef && match.stateRef.path, 'find must return the stateRef');
        assert.ok(!('markdown' in match), 'find must never return content');

        const byTitle = await nodeAction(board, 'markdown.find', { title: 'design' });
        assert.equal(byTitle.body.result.count, 1);
        assert.equal(byTitle.body.result.matches[0].nodeId, design);
        assert.ok(!('markdown' in byTitle.body.result.matches[0]), 'title search must never return content');

        const none = await nodeAction(board, 'markdown.find', { title: 'does-not-exist' });
        assert.equal(none.body.result.count, 0);
      });

      it('N2 - markdown.read returns content and revision', async () => {
        const nodeId = await createNode('markdown', { title: 'Read Me', markdown: '# Read\nbody' });
        const res = await nodeAction(nodeId, 'markdown.read');
        assert.equal(res.status, 200);
        assert.equal(res.body.result.markdown, '# Read\nbody');
        assert.equal(res.body.result.revision, 1);
        assert.equal(res.body.result.title, 'Read Me');
      });

      it('N3 - acquireLock -> append/patch -> releaseLock grows revision with correct content', async () => {
        const nodeId = await createNode('markdown', { title: 'Locked Write', markdown: 'v1' });
        const lock = await nodeAction(nodeId, 'markdown.acquireLock', { lockOwner: 'agent-n3' });
        assert.equal(lock.status, 200, JSON.stringify(lock.body));
        assert.ok(lock.body.result.lockId);
        assert.equal(lock.body.result.owner, 'agent-n3');
        assert.equal(lock.body.result.revision, 1);

        const appended = await nodeAction(nodeId, 'markdown.append', {
          markdown: '\nv2',
          lockId: lock.body.result.lockId,
          expectedRevision: 1,
        });
        assert.equal(appended.status, 200, JSON.stringify(appended.body));
        assert.equal(appended.body.result.revision, 2);

        const patched = await nodeAction(nodeId, 'markdown.patch', {
          diff: { op: 'insert', text: 'X', offset: 0 },
          lockId: lock.body.result.lockId,
          expectedRevision: 2,
        });
        assert.equal(patched.status, 200, JSON.stringify(patched.body));
        assert.equal(patched.body.result.revision, 3);

        const read = await nodeAction(nodeId, 'markdown.read');
        assert.equal(read.body.result.markdown, 'Xv1\nv2');

        const released = await nodeAction(nodeId, 'markdown.releaseLock', {
          lockOwner: 'agent-n3',
          lockId: lock.body.result.lockId,
        });
        assert.equal(released.status, 200);
        assert.equal(released.body.result.released, true);
        const after = await nodeAction(nodeId, 'markdown.read');
        assert.equal(after.body.result.revision, 3);
      });

      it('N4 - foreign writer while locked gets markdown_locked and content stays unchanged', async () => {
        const nodeId = await createNode('markdown', { title: 'Locked Notes', markdown: 'body' });
        const lock = await nodeAction(nodeId, 'markdown.acquireLock', { lockOwner: 'agent-n4' });
        assert.equal(lock.status, 200);

        const foreign = await nodeAction(nodeId, 'markdown.append', { markdown: '\nclobber' });
        assert.equal(foreign.status, 409, JSON.stringify(foreign.body));
        assert.equal(foreign.body.error.code, 'markdown_locked');
        assert.equal(foreign.body.holder, 'agent-n4');
        assert.ok(foreign.body.expiresAt, 'error must carry the lock expiry');

        const read = await nodeAction(nodeId, 'markdown.read');
        assert.equal(read.body.result.markdown, 'body', 'no write may land while a foreign lock is held');
        assert.equal(read.body.result.revision, 1);

        await nodeAction(nodeId, 'markdown.releaseLock', { lockOwner: 'agent-n4', lockId: lock.body.result.lockId });
      });

      it('N5 - stale expectedRevision returns markdown_conflict with currentRevision', async () => {
        const nodeId = await createNode('markdown', { title: 'Merge Notes', markdown: 'base' });
        await nodeAction(nodeId, 'markdown.append', { markdown: '\nA writes' }); // -> revision 2

        const stale = await nodeAction(nodeId, 'markdown.replace', { markdown: 'B overwrite', expectedRevision: 1 });
        assert.equal(stale.status, 409, JSON.stringify(stale.body));
        assert.equal(stale.body.error.code, 'markdown_conflict');
        assert.equal(stale.body.currentRevision, 2);
        assert.equal(stale.body.expectedRevision, 1);

        const read = await nodeAction(nodeId, 'markdown.read');
        assert.equal(read.body.result.revision, 2);
        assert.ok(read.body.result.markdown.includes('A writes'), 'conflict must not overwrite');
        assert.ok(!read.body.result.markdown.includes('B overwrite'), 'conflict must not write');

        const retried = await nodeAction(nodeId, 'markdown.replace', { markdown: 'merged', expectedRevision: 2 });
        assert.equal(retried.status, 200, JSON.stringify(retried.body));
        assert.equal(retried.body.result.revision, 3);
      });
    });

    describe('File (N6-N8)', () => {
      it('N6 - file.readMeta returns path/size/mime metadata', async () => {
        fs.writeFileSync(path.join(root, 'notes.txt'), 'hello world');
        const nodeId = await createNode('file', {
          title: 'Notes',
          file: { source: 'workspace', path: 'notes.txt', name: 'notes.txt', mime: 'text/plain' },
        });
        const res = await nodeAction(nodeId, 'file.readMeta');
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const file = res.body.result.file;
        assert.equal(file.path, 'notes.txt');
        assert.equal(file.size, 11);
        assert.ok(String(file.mime).startsWith('text/plain'), `expected text mime, got ${file.mime}`);
        assert.equal(file.exists, true);
        assert.equal(file.stale, false);
      });

      it('N7 - file.readText honors offset/limit and never exceeds bounds', async () => {
        fs.writeFileSync(path.join(root, 'data.txt'), '0123456789');
        const nodeId = await createNode('file', {
          title: 'Data',
          file: { source: 'workspace', path: 'data.txt', name: 'data.txt', mime: 'text/plain' },
        });
        const res = await nodeAction(nodeId, 'file.readText', { offset: 2, limit: 4 });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.result.text, '2345');
        assert.equal(res.body.result.bytesRead, 4);
        assert.equal(res.body.result.truncated, true, 'a partial read must report truncated');

        const beyond = await nodeAction(nodeId, 'file.readText', { offset: 20, limit: 4 });
        assert.equal(beyond.body.result.text, '');
        assert.equal(beyond.body.result.bytesRead, 0);
        assert.equal(beyond.body.result.truncated, false);
      });

      it('N8 - file.refresh updates state/meta after the file changes on disk', async () => {
        fs.writeFileSync(path.join(root, 'grow.txt'), 'a');
        const nodeId = await createNode('file', {
          title: 'Grow',
          file: { source: 'workspace', path: 'grow.txt', name: 'grow.txt', mime: 'text/plain' },
        });
        const before = await nodeAction(nodeId, 'file.readMeta');
        assert.equal(before.body.result.file.size, 1);

        fs.writeFileSync(path.join(root, 'grow.txt'), 'abcdef');
        const refreshed = await nodeAction(nodeId, 'file.refresh');
        assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
        assert.equal(refreshed.body.result.file.size, 6);
        assert.equal(refreshed.body.result.file.exists, true);
        assert.equal(refreshed.body.result.file.stale, false);

        const after = await nodeAction(nodeId, 'file.readMeta');
        assert.equal(after.body.result.file.size, 6);
      });
    });

    describe('Excalidraw (N9-N12)', () => {
      it('N9 - readScene returns scene elements/appState/files', async () => {
        const nodeId = await createNode('excalidraw', { title: 'Diagram' });
        const res = await nodeAction(nodeId, 'excalidraw.readScene');
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const scene = res.body.result.scene;
        assert.ok(Array.isArray(scene.elements), 'scene must carry elements');
        assert.ok(scene.appState && typeof scene.appState === 'object', 'scene must carry appState');
        assert.ok(scene.files && typeof scene.files === 'object', 'scene must carry files');
        assert.equal(res.body.result.revision, 1);
      });

      it('N10 - saveScene persists the complete scene and grows revision', async () => {
        const nodeId = await createNode('excalidraw', { title: 'Diagram' });
        const scene = {
          elements: [{ id: 'el-1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }],
          appState: { viewBackgroundColor: '#ffffff' },
          files: {},
        };
        const saved = await nodeAction(nodeId, 'excalidraw.saveScene', { scene });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.equal(saved.body.result.revision, 2);

        const read = await nodeAction(nodeId, 'excalidraw.readScene');
        assert.equal(read.body.result.scene.elements.length, 1);
        assert.equal(read.body.result.scene.elements[0].id, 'el-1');
        assert.equal(read.body.result.scene.appState.viewBackgroundColor, '#ffffff');
      });

      it('N11 - patchScene applies an incremental patch and preserves old elements', async () => {
        const nodeId = await createNode('excalidraw', { title: 'Diagram' });
        await nodeAction(nodeId, 'excalidraw.saveScene', {
          scene: { elements: [{ id: 'el-1', type: 'rectangle' }], appState: {}, files: {} },
        });
        const patched = await nodeAction(nodeId, 'excalidraw.patchScene', {
          patch: { appState: { viewBackgroundColor: '#fafafa' } },
        });
        assert.equal(patched.status, 200, JSON.stringify(patched.body));

        const read = await nodeAction(nodeId, 'excalidraw.readScene');
        assert.equal(read.body.result.scene.elements.length, 1, 'old elements must be preserved');
        assert.equal(read.body.result.scene.elements[0].id, 'el-1');
        assert.equal(read.body.result.scene.appState.viewBackgroundColor, '#fafafa');
      });

      it('N12 - invalid scene payload returns 4xx and leaves the old scene unchanged', async () => {
        const nodeId = await createNode('excalidraw', { title: 'Diagram' });
        const before = await nodeAction(nodeId, 'excalidraw.readScene');
        const invalid = await nodeAction(nodeId, 'excalidraw.saveScene', { scene: 'not-an-object' });
        assert.ok(invalid.status >= 400 && invalid.status < 500, `expected 4xx, got ${invalid.status}`);
        const after = await nodeAction(nodeId, 'excalidraw.readScene');
        assert.equal(after.body.result.revision, before.body.result.revision);
        assert.deepEqual(after.body.result.scene.elements, before.body.result.scene.elements);
      });
    });

    describe('Goal / Agent / Timer control (N13-N15)', () => {
      it('N13 - goal state machine: add/delete/replace/check/uncheck/complete/reopen', async () => {
        const goalNodeId = seedActiveTask(root, 'task-n13-goal');
        const goalAction = (action, body = {}) =>
          jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(goalNodeId)}/actions/goal.${action}`, { method: 'POST', body });

        const added = await goalAction('add', {
          planItems: [{ text: 'One' }, { text: 'Two' }],
          acceptance: [{ text: 'Accept N13' }],
        });
        assert.equal(added.status, 200, JSON.stringify(added.body));
        assert.equal(added.body.result.state.planItems.length, 2);
        assert.equal(added.body.result.state.planItems[0].id, 'P-001');
        assert.equal(added.body.result.state.planItems[1].id, 'P-002');
        assert.ok(added.body.result.revision > 0);

        const deleted = await goalAction('delete', { planItemIds: ['P-002', 'P-999'] });
        assert.equal(deleted.body.result.state.planItems.length, 1);
        assert.equal(deleted.body.result.state.planItems[0].id, 'P-001');
        assert.deepEqual(deleted.body.result.skipped, ['P-999']);

        const replaced = await goalAction('replace', {
          planItems: [{ id: 'P-001', text: 'One rewritten' }, { text: 'Fresh' }],
        });
        assert.equal(replaced.body.result.state.planItems.length, 2);
        assert.equal(replaced.body.result.state.planItems[0].id, 'P-001');
        assert.equal(replaced.body.result.state.planItems[0].text, 'One rewritten');
        assert.equal(replaced.body.result.state.planItems[1].id, 'P-002');
        assert.equal(replaced.body.result.state.planItems[1].text, 'Fresh');

        const checked = await goalAction('check', { planItemIds: ['P-001', 'P-002'] });
        assert.equal(checked.body.result.state.planItems.every(item => item.status === 'done'), true);
        assert.equal(checked.body.result.state.status, 'active', 'checking items must not complete the Goal');

        const completed = await goalAction('complete', { note: 'All done for N13', evidenceRefs: ['n13-tests'] });
        assert.equal(completed.status, 200, JSON.stringify(completed.body));
        assert.equal(completed.body.result.state.status, 'proposed-complete');
        assert.equal(completed.body.result.state.confirmation.state, 'proposed');
        assert.deepEqual(completed.body.result.state.confirmation.evidenceRefs, ['n13-tests']);

        const reopened = await goalAction('reopen', { note: 'One more pass' });
        assert.equal(reopened.body.result.state.status, 'active');
        assert.equal(reopened.body.result.state.confirmation.state, 'returned');

        const unchecked = await goalAction('uncheck', { planItemIds: ['P-001'] });
        assert.equal(unchecked.body.result.state.planItems[0].status, 'todo');
        assert.equal(unchecked.body.result.state.planItems[1].status, 'done');

        const read = await goalAction('read');
        assert.equal(read.body.result.status, 'active');
        assert.equal(read.body.result.planItems.length, 2);
        assert.equal(read.body.result.taskId, 'task-n13-goal');
      });

      it('N14 - agent unified API: readOutput/sendInput/sendMessage/readMessages via the same action route', async () => {
        // agent.sendInput is delegated to the server control plane, so the
        // acting session must live in the registry.
        const main = await createAgentViaApi('claude', 'main', 'Main Agent', 'ceo');
        const nodeId = main.nodeId;
        const sessionId = main.sessionId;
        seedAgentSession(root, 'agent-n14-b', 'session-n14-b', {});
        writeGraphEdges(root, [
          { id: 'e-n14', from: nodeId, to: 'agent-n14-b', relation: 'delegation', direction: 'bidirectional' },
        ]);
        const writes = { n14: [], b: [] };
        registerPty(sessionId, writes.n14);
        registerPty('session-n14-b', writes.b);
        const base = `/api/workflow/nodes/${nodeId}/actions/`;

        const output = await jsonRequest(baseUrl, `${base}agent.readOutput`, { method: 'POST', body: { tail: 10 } });
        assert.equal(output.status, 200, JSON.stringify(output.body));
        assert.equal(output.body.result.sessionId, sessionId);
        assert.ok(Array.isArray(output.body.result.entries));

        const input = await jsonRequest(baseUrl, `${base}agent.sendInput`, { method: 'POST', body: { data: 'input-n14' } });
        assert.equal(input.status, 200, JSON.stringify(input.body));
        assert.equal(input.body.result.ok, true);
        assert.deepEqual(writes.n14, ['input-n14']);

        const message = await jsonRequest(baseUrl, `${base}agent.sendMessage`, {
          method: 'POST',
          body: { to: 'agent-n14-b', text: 'MSG_N14' },
        });
        assert.equal(message.status, 200, JSON.stringify(message.body));
        assert.equal(message.body.result.mode, 'direct');
        assert.equal(message.body.result.deliveries.length, 1);
        assert.equal(message.body.result.deliveries[0].ok, true);
        assert.equal(writes.b[0], 'M', 'the first char of the submitted body must be written synchronously');
        await waitFor(() => (writes.b.join('') === 'MSG_N14\r' ? writes.b : null), { timeout: 5000 });
        assert.equal(writes.b.join(''), 'MSG_N14\r', 'the typed body must join to the exact text + \\r');
        assert.equal(writes.b[writes.b.length - 1], '\r', 'the submitted body must end with a single \\r');
        assert.equal(writes.b.join('').includes('\n'), false, 'no \\n may be injected');
        assert.equal(writes.b.filter(w => w === '\r').length, 1, 'exactly one \\r (0x0D)');

        const messages = await jsonRequest(baseUrl, `${base}agent.readMessages`, {
          method: 'POST',
          body: { peer: 'agent-n14-b' },
        });
        assert.equal(messages.status, 200);
        assert.equal(messages.body.result.entries.length, 1);
        assert.equal(messages.body.result.entries[0].data.replace(/\r$/, ''), 'MSG_N14');
      });

      it('N15 - timer policy: read/configure/setInterval/enable/disable work; fire/tick/dispatchWakeup stay internal', async () => {
        const created = await jsonRequest(baseUrl, '/api/workflow/nodes', {
          method: 'POST',
          body: { type: 'timer', title: 'N15 Policy Timer', enabled: false, schedule: { mode: 'interval', intervalSeconds: 60 } },
        });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const timerNodeId = created.body.node.nodeId;
        seedAgentSession(root, 'agent-n15', 'session-n15', {});
        const controlEdge = await jsonRequest(baseUrl, '/api/workflow/edges', {
          method: 'POST',
          body: { from: 'agent-n15', to: timerNodeId, relation: 'control', direction: 'source-to-target' },
        });
        assert.equal(controlEdge.status, 201, JSON.stringify(controlEdge.body));
        const action = (name, body = {}) =>
          jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(timerNodeId)}/actions/timer.${name}`, { method: 'POST', body });

        const read = await action('read');
        assert.equal(read.status, 200);
        assert.equal(read.body.result.enabled, false);
        assert.equal(read.body.result.schedule.intervalSeconds, 60);

        const configured = await action('configure', { schedule: { intervalSeconds: 120 } });
        assert.equal(configured.status, 200, JSON.stringify(configured.body));
        assert.equal(configured.body.result.schedule.intervalSeconds, 120);

        // Agent-authored control is gated by the control policy (defaults deny
        // disable and interval changes).
        const deniedInterval = await action('setInterval', { intervalSeconds: 30, actorNodeId: 'agent-n15' });
        assert.equal(deniedInterval.status, 403, JSON.stringify(deniedInterval.body));
        assert.equal(deniedInterval.body.error.code, 'CONTROL_DENIED');
        const deniedDisable = await action('disable', { actorNodeId: 'agent-n15' });
        assert.equal(deniedDisable.status, 403);
        assert.equal(deniedDisable.body.error.code, 'CONTROL_DENIED');

        const unchanged = await action('read');
        assert.equal(unchanged.body.result.schedule.intervalSeconds, 120, 'denied control must not mutate the timer');
        assert.equal(unchanged.body.result.enabled, false);

        // Internal runtime actions are never exposed to Agents over HTTP.
        const fire = await action('fire');
        assert.equal(fire.status, 403, JSON.stringify(fire.body));
        assert.equal(fire.body.error.code, 'TIMER_INTERNAL_ACTION_DENIED');
        const tick = await action('tick');
        assert.equal(tick.status, 403);
        assert.equal(tick.body.error.code, 'TIMER_INTERNAL_ACTION_DENIED');
        const dispatch = await action('dispatchWakeup');
        assert.equal(dispatch.status, 403);
        assert.equal(dispatch.body.error.code, 'TIMER_INTERNAL_ACTION_DENIED');

        // Backend/human control still works through the same route. The policy
        // gates timer.disable for every actor by default (agentCanDisable
        // false), so a plain configure is the non-Agent control path.
        const enabled = await action('enable');
        assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
        assert.equal(enabled.body.result.state.enabled, true);
        const disabled = await action('configure', { enabled: false });
        assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
        assert.equal(disabled.body.result.enabled, false);

        const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent('agent-n15')}`);
        const timerRef = (ctx.body.context.connectedEventRefs || []).find(ref => ref.nodeId === timerNodeId);
        assert.ok(timerRef, 'agent context must expose the connected timer');
        assert.equal(timerRef.canControl, true, 'control edge must grant Agent timer control');
        assert.ok(timerRef.allowedActions.includes('timer.configure'));
        assert.ok(timerRef.allowedActions.includes('timer.enable'));
        assert.ok(!timerRef.allowedActions.includes('timer.dispatchWakeup'));
        assert.ok(!timerRef.allowedActions.includes('timer.fire'));
        assert.ok(!timerRef.allowedActions.includes('timer.tick'));
        assert.ok(!timerRef.allowedActions.includes('timer.disable'), 'policy denies Agent disable');

        // The ontology affordance explicitly denies the backend-internal trio.
        const timerAffordance = (ctx.body.context.affordances || []).find(item => item.type === 'timer');
        assert.ok(timerAffordance, 'timer affordance must be present');
        assert.ok(timerAffordance.deniedActions.includes('timer.dispatchWakeup'));
        assert.ok(timerAffordance.deniedActions.includes('timer.fire'));
        assert.ok(timerAffordance.deniedActions.includes('timer.tick'));
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Prompt / Manual Matrix (P1-P6)
  // ══════════════════════════════════════════════════════════════════
  describe('Prompt / Manual Matrix (P1-P6)', () => {
    it('P1 - Agent startup init.md carries identity, role profile fields, and roleProfileRef', async () => {
      const agent = await createAgentViaApi('claude', 'subagent', 'Subagent', 'implementer', {
        displayName: 'Backend Worker',
        responsibility: 'Implement backend tests within the write set.',
        capabilities: ['api-backend', 'testing'],
      });
      const initPath = path.join(root, 'Harness', 'a2a', 'nodes', agent.sessionId, 'init.md');
      assert.ok(fs.existsSync(initPath), 'init.md must be written to the node home');
      const init = fs.readFileSync(initPath, 'utf8');
      assert.match(init, /- Display name: Backend Worker/);
      assert.match(init, /- Role title: implementer/);
      assert.match(init, /- Responsibility: Implement backend tests within the write set\./);
      assert.match(init, /- Capabilities: api-backend, testing/);
      assert.match(init, /- Role profile: Harness\/a2a\/agent-roles\/session-[0-9a-f-]+\.md — read this file; it is your identity and mandate\./);
      assert.match(init, /- Session: [0-9a-f-]+/);
    });

    it('P2 - workflow-context includes identity, connectedPeers, connectedNodeManuals, allowedActions', async () => {
      seedAgentSession(root, 'agent-p2', 'session-p2', { agentKind: 'main', role: 'Main Agent' });
      seedAgentSession(root, 'agent-p2-b', 'session-p2-b', {});
      writeGraphEdges(root, [
        { id: 'e-p2', from: 'agent-p2', to: 'agent-p2-b', relation: 'delegation', direction: 'bidirectional' },
      ]);
      const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent('agent-p2')}`);
      assert.equal(ctx.status, 200, JSON.stringify(ctx.body));
      const context = ctx.body.context;
      assert.equal(context.nodeId, 'agent-p2');
      assert.equal(context.sessionId, 'session-p2');
      assert.ok(context.identity, 'identity must be present');
      assert.equal(context.identity.nodeId, 'agent-p2');
      assert.ok(Array.isArray(context.connectedPeers), 'connectedPeers must be an array');
      assert.ok(
        context.connectedPeers.some(p => p.nodeId === 'agent-p2-b' && p.type === 'agent'),
        'connected peer must be listed',
      );
      assert.ok(Array.isArray(context.connectedNodeManuals), 'connectedNodeManuals must be an array');
      assert.ok(Array.isArray(context.availableActions), 'allowedActions must be exposed');
      assert.ok(context.availableActions.includes('agent.sendMessage'));
      assert.ok(context.availableActions.includes('agent.sendInput'));
      assert.ok(context.availableActions.includes('agent.readMessages'));
    });

    it('P3 - connecting a Markdown node injects the workflow-markdown-node manual', async () => {
      seedAgentSession(root, 'agent-p3', 'session-p3', {});
      const md = await jsonRequest(baseUrl, '/api/workflow/nodes', {
        method: 'POST',
        body: { type: 'markdown', title: 'P3 Board', markdown: '# board' },
      });
      assert.equal(md.status, 201, JSON.stringify(md.body));
      const mdNodeId = md.body.node.nodeId;
      const edge = await jsonRequest(baseUrl, '/api/workflow/edges', {
        method: 'POST',
        body: { from: 'agent-p3', to: mdNodeId, relation: 'wf-bridge' },
      });
      assert.equal(edge.status, 201, JSON.stringify(edge.body));

      const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent('agent-p3')}`);
      const manual = (ctx.body.context.connectedNodeManuals || []).find(m => m.nodeType === 'markdown');
      assert.ok(manual, `markdown manual must be injected: ${JSON.stringify(ctx.body.context.connectedNodeManuals)}`);
      assert.equal(manual.skillId, 'workflow-markdown-node');
      assert.equal(manual.nodeId, mdNodeId);
      assert.ok(manual.text && manual.text.length > 0, 'manual must carry agent-facing text');
    });

    it('P4 - connecting an Excalidraw node injects the workflow-diagram-node manual', async () => {
      seedAgentSession(root, 'agent-p4', 'session-p4', {});
      const draw = await jsonRequest(baseUrl, '/api/workflow/nodes', {
        method: 'POST',
        body: { type: 'excalidraw', title: 'P4 Draw' },
      });
      assert.equal(draw.status, 201, JSON.stringify(draw.body));
      const drawNodeId = draw.body.node.nodeId;
      const edge = await jsonRequest(baseUrl, '/api/workflow/edges', {
        method: 'POST',
        body: { from: 'agent-p4', to: drawNodeId, relation: 'wf-bridge' },
      });
      assert.equal(edge.status, 201, JSON.stringify(edge.body));

      const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent('agent-p4')}`);
      const manual = (ctx.body.context.connectedNodeManuals || []).find(m => m.nodeType === 'excalidraw');
      assert.ok(manual, 'excalidraw manual must be injected');
      assert.equal(manual.skillId, 'workflow-diagram-node');
      assert.equal(manual.nodeId, drawNodeId);
      assert.ok(manual.text && manual.text.length > 0);
    });

    it('P5 - Timer and Goal connections inject manuals; Timer wakes, Goal does not', async () => {
      const goalNodeId = seedActiveTask(root, 'task-p5-goal');
      const created = await jsonRequest(baseUrl, '/api/workflow/nodes', {
        method: 'POST',
        body: { type: 'timer', title: 'P5 Timer', enabled: false, schedule: { mode: 'manual', intervalSeconds: 60 } },
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const timerNodeId = created.body.node.nodeId;
      seedAgentSession(root, 'agent-p5', 'session-p5', {});
      const graph = loadWorkflowGraphMap(root);
      writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [
          dockLink('agent-p5', timerNodeId),
          dockLink(timerNodeId, goalNodeId),
          dockLink('agent-p5', goalNodeId),
        ],
      });

      const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent('agent-p5')}`);
      const context = ctx.body.context;

      const timerManual = (context.connectedNodeManuals || []).find(m => m.nodeType === 'timer');
      assert.ok(timerManual, 'timer manual must be injected');
      assert.equal(timerManual.skillId, 'workflow-timer-node');
      const goalManual = (context.connectedNodeManuals || []).find(m => m.nodeType === 'goal');
      assert.ok(goalManual, 'goal manual must be injected');
      assert.equal(goalManual.skillId, 'workflow-goal-node');

      const timerRef = (context.connectedEventRefs || []).find(ref => ref.nodeId === timerNodeId);
      assert.ok(timerRef, 'timer ref must be present');
      assert.equal(timerRef.type, 'timer');
      assert.equal(timerRef.canControl, false, 'no control edge -> timer cannot be controlled by the Agent');
      assert.ok(!timerRef.allowedActions.includes('timer.dispatchWakeup'), 'agents cannot invoke timer.dispatchWakeup');
      assert.ok(!timerRef.allowedActions.includes('timer.enable'), 'no control edge -> no timer control actions');
      assert.ok(timerRef.deniedActions.includes('timer.enable'));

      // The ontology affordance denies the backend-internal wakeup trio.
      const timerAffordance = (context.affordances || []).find(item => item.type === 'timer');
      assert.ok(timerAffordance, 'timer affordance must be present');
      assert.ok(timerAffordance.allowedActions.includes('timer.read'));
      assert.ok(timerAffordance.deniedActions.includes('timer.dispatchWakeup'));
      assert.ok(timerAffordance.deniedActions.includes('timer.fire'));
      assert.ok(timerAffordance.deniedActions.includes('timer.tick'));

      const goalRef = (context.connectedGoalRefs || []).find(ref => ref.nodeId === goalNodeId);
      assert.ok(goalRef, 'goal ref must be present');
      assert.equal(goalRef.type, 'goal');
      assert.ok(goalRef.capabilities.includes('goal.read'));
      assert.ok(!goalRef.capabilities.some(cap => /wake/i.test(cap)), 'Goal exposes no wakeup action');
      assert.ok(
        !context.availableActions.some(action => /wake/i.test(action)),
        'Agent has no wakeup action of its own',
      );
    });

    it('P6 - agent-facing guidance avoids A2A/broadcast/thread jargon and uses plain language', async () => {
      seedAgentSession(root, 'agent-p6', 'session-p6', {});
      const md = await jsonRequest(baseUrl, '/api/workflow/nodes', {
        method: 'POST',
        body: { type: 'markdown', title: 'P6 Board', markdown: '# board' },
      });
      const edge = await jsonRequest(baseUrl, '/api/workflow/edges', {
        method: 'POST',
        body: { from: 'agent-p6', to: md.body.node.nodeId, relation: 'wf-bridge' },
      });
      assert.equal(edge.status, 201, JSON.stringify(edge.body));

      const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent('agent-p6')}`);
      const context = ctx.body.context;
      const guidance = context.teamGuidance || '';
      assert.ok(guidance, 'team guidance must be injected into the agent context');
      assert.doesNotMatch(guidance, /\bA2A\b/, 'team guidance must avoid A2A terminology');
      assert.doesNotMatch(guidance, /\bbroadcast\b/i, 'team guidance must avoid broadcast terminology');
      assert.doesNotMatch(guidance, /\bthread\b/i, 'team guidance must avoid thread terminology');
      assert.match(guidance, /plain language/, 'team guidance must tell the agent to report in plain language');

      for (const manual of context.connectedNodeManuals || []) {
        assert.doesNotMatch(manual.text, /\bA2A\b/, `${manual.skillId} manual must avoid A2A terminology`);
        assert.doesNotMatch(manual.text, /\bbroadcast\b/i, `${manual.skillId} manual must avoid broadcast terminology`);
        assert.doesNotMatch(manual.text, /\bthread\b/i, `${manual.skillId} manual must avoid thread terminology`);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Node Map Lifecycle (E0)
  // ══════════════════════════════════════════════════════════════════
  describe('Node Map Lifecycle (E0)', () => {
    it('E0 - clear node map via agent.deleteNodes (all=true) and verify empty/version-tracked state', async () => {
      // Seed: create several nodes (agents, components) to prove the map is populated.
      const main = await createAgentViaApi('claude', 'main', 'Main Agent', 'ceo', { displayName: 'E0 Controller' });
      const workerB = await createAgentViaApi('claude', 'subagent', 'Subagent', 'implementer', { displayName: 'Worker B' });
      const workerC = await createAgentViaApi('claude', 'subagent', 'Subagent', 'reviewer', { displayName: 'Worker C' });
      const md = await jsonRequest(baseUrl, '/api/workflow/nodes', {
        method: 'POST',
        body: { type: 'markdown', title: 'E0 Board', markdown: '# E0' },
      });
      assert.equal(md.status, 201, JSON.stringify(md.body));
      const mdNodeId = md.body.node.nodeId;
      const draw = await jsonRequest(baseUrl, '/api/workflow/nodes', {
        method: 'POST',
        body: { type: 'excalidraw', title: 'E0 Diagram' },
      });
      assert.equal(draw.status, 201, JSON.stringify(draw.body));
      const drawNodeId = draw.body.node.nodeId;

      const graphBefore = loadWorkflowGraphMap(root);
      assert.ok(graphBefore.nodes.length >= 5, `graph must contain at least 5 nodes, got ${graphBefore.nodes.length}`);
      const vBefore = graphBefore.version;

      // Main Agent clears all deletable nodes via the API route.
      const cleared = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(main.nodeId)}/actions/agent.deleteNodes`, {
        method: 'POST',
        body: { all: true, actorNodeId: main.nodeId },
      });
      assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
      assert.equal(cleared.body.ok, true);
      assert.equal(cleared.body.action, 'agent.deleteNodes');
      // The actor itself must be skipped, not deleted.
      assert.ok(
        (cleared.body.result.skippedNodeIds || []).includes(main.nodeId),
        `actor node must be skipped: ${JSON.stringify(cleared.body.result)}`,
      );
      assert.ok(cleared.body.result.deletedNodeIds.length >= 3, `must delete at least 3 non-actor nodes: ${JSON.stringify(cleared.body.result)}`);

      // After clearing, the actor remains but other nodes are gone.
      const graphAfter = loadWorkflowGraphMap(root);
      const afterNodeIds = (graphAfter.nodes || []).map(n => n.nodeId || n.id);
      assert.ok(afterNodeIds.includes(main.nodeId), 'actor must survive the clear');
      assert.ok(!afterNodeIds.includes(workerB.nodeId), `worker B ${workerB.nodeId} must be gone`);
      assert.ok(!afterNodeIds.includes(workerC.nodeId), `worker C ${workerC.nodeId} must be gone`);
      assert.ok(!afterNodeIds.includes(mdNodeId), `markdown ${mdNodeId} must be gone`);
      assert.ok(!afterNodeIds.includes(drawNodeId), `excalidraw ${drawNodeId} must be gone`);
      assert.ok(graphAfter.version > vBefore, `version must advance: ${vBefore} -> ${graphAfter.version}`);

      // Edge cleanup: edges referencing deleted nodes are removed.
      assert.equal((graphAfter.edges || []).length, 0, 'no edges may remain after full clear');
      assert.equal((graphAfter.capsuleDockLinks || []).length, 0, 'no dock links may remain after full clear');
    });

    it('E0b - after clearing non-live nodes, snapshot returns a baseline state with only the surviving actor', async () => {
      // Seed: Main Agent (actor) + a non-live graph-only node (no session).
      // Live-agent nodes are skipped during bulk delete; this test proves
      // that non-live nodes are correctly removed.
      const main = await createAgentViaApi('claude', 'main', 'Main Agent', 'ceo', { displayName: 'E0b Lone Actor' });
      const md = await jsonRequest(baseUrl, '/api/workflow/nodes', {
        method: 'POST',
        body: { type: 'markdown', title: 'E0b Board', markdown: '# E0b' },
      });
      assert.equal(md.status, 201, JSON.stringify(md.body));
      const mdNodeId = md.body.node.nodeId;
      const draw = await jsonRequest(baseUrl, '/api/workflow/nodes', {
        method: 'POST',
        body: { type: 'excalidraw', title: 'E0b Diagram' },
      });
      assert.equal(draw.status, 201, JSON.stringify(draw.body));
      const drawNodeId = draw.body.node.nodeId;

      assert.ok((loadWorkflowGraphMap(root).nodes || []).length >= 3, 'at least 3 nodes before clear');

      await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(main.nodeId)}/actions/agent.deleteNodes`, {
        method: 'POST',
        body: { all: true, actorNodeId: main.nodeId },
      });

      // Snapshot via both public routes must be consistent — only the actor survives.
      const workflowSnapshot = await jsonRequest(baseUrl, '/api/workflow');
      assert.equal(workflowSnapshot.status, 200);
      const a2aSnapshot = await jsonRequest(baseUrl, '/api/a2a/snapshot');
      assert.equal(a2aSnapshot.status, 200);
      assert.ok(a2aSnapshot.body.snapshotVersion > 1, 'snapshot version must be trackable');

      for (const snapshot of [workflowSnapshot.body, a2aSnapshot.body]) {
        const nodeIds = (snapshot.nodes || []).map(n => n.nodeId || n.id);
        assert.ok(nodeIds.includes(main.nodeId), 'surviving actor must be present');
        assert.ok(!nodeIds.includes(mdNodeId), 'deleted markdown node must be absent');
        assert.ok(!nodeIds.includes(drawNodeId), 'deleted excalidraw node must be absent');
        // Edges are cleaned up when all deletable non-live nodes are removed.
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // $wf-max Fanout Semantics (E7)
  // ══════════════════════════════════════════════════════════════════
  describe('$wf-max Fanout Semantics (E7)', () => {
    it('E7 - Main Agent creates 3 role-distinct subagents, dispatches work, and aggregates replies', async () => {
      const ceo = await createAgentViaApi('claude', 'main', 'Main Agent', 'ceo', {
        displayName: 'CEO',
        responsibility: 'Coordinate fan-out.',
      });
      const roles = [
        { roleTitle: 'implementer', displayName: 'Implementer', responsibility: 'Write code.' },
        { roleTitle: 'reviewer', displayName: 'Reviewer', responsibility: 'Review code.' },
        { roleTitle: 'tester', displayName: 'Tester', responsibility: 'Test code.' },
      ];
      const workers = [];
      for (const role of roles) {
        const worker = await createAgentViaApi('claude', 'subagent', 'Subagent', role.roleTitle, {
          displayName: role.displayName,
          responsibility: role.responsibility,
          capabilities: ['terminal'],
        });
        workers.push(worker);
        // Connect CEO to each worker.
        const edge = await jsonRequest(baseUrl, '/api/workflow/edges', {
          method: 'POST',
          body: { from: ceo.nodeId, to: worker.nodeId, relation: 'delegation', direction: 'bidirectional' },
        });
        assert.equal(edge.status, 201, JSON.stringify(edge.body));
      }
      const writes = { ceo: [], workers: [] };
      registerPty(ceo.sessionId, writes.ceo);
      for (const w of workers) {
        const ww = [];
        registerPty(w.sessionId, ww);
        writes.workers.push(ww);
      }

      // CEO broadcasts the same request to all three workers (fan-out).
      const targets = workers.map(w => w.nodeId);
      const broadcast = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(ceo.nodeId)}/actions/agent.broadcastMessage`, {
        method: 'POST',
        body: {
          to: targets,
          text: 'wf-max task: implement, review, and test the login module.',
          requestId: 'wf-max-req-1',
          threadId: 'wf-max-thread',
          toRole: 'worker',
          contextRefs: [{ nodeId: 'plan-md', relation: 'shared-context' }],
        },
      });
      assert.equal(broadcast.status, 200, JSON.stringify(broadcast.body));
      assert.equal(broadcast.body.result.mode, 'broadcast');
      assert.equal(broadcast.body.result.deliveredCount, 3);
      assert.equal(broadcast.body.result.failedCount, 0);
      assert.equal(broadcast.body.result.requestId, 'wf-max-req-1');
      // Each worker received the envelope with the shared requestId, typed
      // char-by-char (first char synchronously, rest at 12ms gaps + \\r).
      const fanoutEnvelope = '[harness-request wf-max-req-1 to-role=worker contextRefs=plan-md] wf-max task: implement, review, and test the login module.';
      for (let i = 0; i < 3; i += 1) {
        assert.ok(writes.workers[i].length >= 1, `worker ${i} must receive the broadcast input`);
        assert.equal(writes.workers[i][0], '[', `worker ${i} must start typing the envelope prefix synchronously`);
      }
      for (let i = 0; i < 3; i += 1) {
        await waitFor(() => (writes.workers[i].join('') === `${fanoutEnvelope}\r` ? writes.workers[i] : null), { timeout: 8000 });
        assert.ok(writes.workers[i].join('').includes('wf-max-req-1'));
        assert.ok(writes.workers[i].join('').includes('wf-max task'));
        assert.equal(writes.workers[i][writes.workers[i].length - 1], '\r', `worker ${i} envelope must end with the submit enter`);
      }

      // Each worker replies with its own deliverable.
      const replyTexts = ['IMPLEMENTED: login module', 'REVIEWED: login module - LGTM', 'TESTED: login module - 3/3 pass'];
      for (let i = 0; i < 3; i += 1) {
        const reply = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(workers[i].nodeId)}/actions/agent.sendMessage`, {
          method: 'POST',
          body: { to: ceo.nodeId, text: replyTexts[i], requestId: 'wf-max-req-1', threadId: 'wf-max-thread' },
        });
        assert.equal(reply.status, 200, JSON.stringify(reply.body));
        assert.equal(reply.body.result.requestId, 'wf-max-req-1');
      }

      // CEO aggregates by requestId — all 6 entries (3 broadcasts + 3 replies).
      const aggregated = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(ceo.nodeId)}/actions/agent.readMessages`, {
        method: 'POST',
        body: { requestId: 'wf-max-req-1' },
      });
      assert.equal(aggregated.status, 200, JSON.stringify(aggregated.body));
      assert.equal(aggregated.body.result.entries.length, 6, '3 dispatches + 3 replies');
      assert.ok(aggregated.body.result.entries.every(e => e.requestId === 'wf-max-req-1'));
      const replyEntries = aggregated.body.result.entries.filter(e => String(e.data).replace(/\r$/, '').match(/^(IMPLEMENTED|REVIEWED|TESTED):/));
      assert.equal(replyEntries.length, 3, 'all 3 workers replied');
      const replyData = replyEntries.map(e => String(e.data).replace(/\r$/, '')).sort();
      assert.deepEqual(replyData, replyTexts.sort());

      // Every worker's role profile is preserved and distinct.
      for (const worker of workers) {
        const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent(worker.nodeId)}`);
        assert.ok(ctx.body.context.identity.displayName, `worker ${worker.nodeId} must have a displayName`);
        assert.ok(ctx.body.context.identity.roleTitle, `worker ${worker.nodeId} must have a roleTitle`);
      }
    });

    it('E7b - broadcasted requestId aggregates across senders for multi-recipient inbox', async () => {
      const ceo = await createAgentViaApi('claude', 'main', 'Main Agent', 'ceo', { displayName: 'CEO' });
      const w1 = await createAgentViaApi('claude', 'subagent', 'Subagent', 'implementer', { displayName: 'W1' });
      const w2 = await createAgentViaApi('claude', 'subagent', 'Subagent', 'reviewer', { displayName: 'W2' });
      for (const w of [w1, w2]) {
        const edge = await jsonRequest(baseUrl, '/api/workflow/edges', {
          method: 'POST',
          body: { from: ceo.nodeId, to: w.nodeId, relation: 'delegation', direction: 'bidirectional' },
        });
        assert.equal(edge.status, 201);
        registerPty(w.sessionId, []);
      }
      registerPty(ceo.sessionId, []);

      // Two independent senders use the same requestId — replies aggregate together.
      await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(ceo.nodeId)}/actions/agent.sendMessage`, {
        method: 'POST',
        body: { to: w1.nodeId, text: 'Task A', requestId: 'shared-req-1' },
      });
      await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(ceo.nodeId)}/actions/agent.sendMessage`, {
        method: 'POST',
        body: { to: w2.nodeId, text: 'Task B', requestId: 'shared-req-1' },
      });
      await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(w1.nodeId)}/actions/agent.sendMessage`, {
        method: 'POST',
        body: { to: ceo.nodeId, text: 'Result A', requestId: 'shared-req-1' },
      });
      await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(w2.nodeId)}/actions/agent.sendMessage`, {
        method: 'POST',
        body: { to: ceo.nodeId, text: 'Result B', requestId: 'shared-req-1' },
      });

      const aggregated = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(ceo.nodeId)}/actions/agent.readMessages`, {
        method: 'POST',
        body: { requestId: 'shared-req-1' },
      });
      assert.equal(aggregated.status, 200);
      const entryTexts = aggregated.body.result.entries.map(e => String(e.data).replace(/\r$/, '')).sort();
      assert.deepEqual(entryTexts, ['Result A', 'Result B', 'Task A', 'Task B']);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Final Evidence Summary (E18)
  // ══════════════════════════════════════════════════════════════════
  describe('Final Evidence Summary (E18)', () => {
    it('E18 - Main Agent reads mailbox, Markdown, Goal, and Timer evidence and produces a summary', async () => {
      const main = await createAgentViaApi('claude', 'main', 'Main Agent', 'ceo', { displayName: 'Main' });
      const worker = await createAgentViaApi('claude', 'subagent', 'Subagent', 'implementer', { displayName: 'Worker' });
      registerPty(main.sessionId, []);
      registerPty(worker.sessionId, []);

      const goalNodeId = seedActiveTask(root, 'task-e18-summary');
      const md = await jsonRequest(baseUrl, '/api/workflow/nodes', {
        method: 'POST',
        body: { type: 'markdown', title: 'E18 Shared Plan', markdown: '# E18 Plan\n- Step 1\n- Step 2' },
      });
      assert.equal(md.status, 201, JSON.stringify(md.body));
      const mdNodeId = md.body.node.nodeId;
      const timer = await createTimerViaApi('E18 Timer');
      const timerNodeId = timer.nodeId;

      // Connect everything.
      for (const [from, to, rel] of [
        [main.nodeId, worker.nodeId, 'delegation'],
        [main.nodeId, mdNodeId, 'wf-bridge'],
        [main.nodeId, goalNodeId, 'goal'],
      ]) {
        const edge = await jsonRequest(baseUrl, '/api/workflow/edges', { method: 'POST', body: { from, to, relation: rel } });
        assert.equal(edge.status, 201, JSON.stringify(edge.body));
      }
      // Magnetic group: main + timer + goal
      const graph = loadWorkflowGraphMap(root);
      writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        capsuleDockLinks: [
          dockLink(main.nodeId, timerNodeId),
          dockLink(timerNodeId, goalNodeId),
        ],
      });

      // Send structured requests and receive replies.
      await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(main.nodeId)}/actions/agent.sendMessage`, {
        method: 'POST',
        body: { to: worker.nodeId, text: 'Please implement Step 1', requestId: 'e18-req-1', contextRefs: [{ nodeId: mdNodeId, relation: 'shared-context' }] },
      });
      await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(worker.nodeId)}/actions/agent.sendMessage`, {
        method: 'POST',
        body: { to: main.nodeId, text: 'Step 1 done', requestId: 'e18-req-1' },
      });

      // Write shared markdown.
      await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(mdNodeId)}/actions/markdown.append`, {
        method: 'POST',
        body: { markdown: '\n- Step 1 completed by Worker' },
      });

      // Add and check Goal items.
      await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(goalNodeId)}/actions/goal.add`, {
        method: 'POST',
        body: { planItems: [{ text: 'Step 1' }, { text: 'Step 2' }] },
      });
      await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(goalNodeId)}/actions/goal.check`, {
        method: 'POST',
        body: { planItemIds: ['P-001'] },
      });

      // Arm the timer for a single wakeup.
      await armTimer(timerNodeId, 60);
      await syncTimerScheduler(root, { intervalMs: 20 });
      await waitFor(() => {
        const entries = wakeupEntries(timerNodeId, main.sessionId);
        return entries.length ? entries : null;
      });

      // ── Evidence aggregation: Main Agent reads every source ──
      const evidence = {};

      // 1. Mailbox evidence.
      const mailbox = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(main.nodeId)}/actions/agent.readMessages`, {
        method: 'POST',
        body: { requestId: 'e18-req-1' },
      });
      assert.equal(mailbox.status, 200);
      assert.ok(mailbox.body.result.entries.length >= 2, 'mailbox must have dispatch + reply');
      evidence.mailboxCount = mailbox.body.result.entries.length;

      // 2. Markdown evidence.
      const mdRead = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(mdNodeId)}/actions/markdown.read`, {
        method: 'POST',
        body: {},
      });
      assert.equal(mdRead.status, 200);
      assert.ok(mdRead.body.result.markdown.includes('Step 1 completed'), 'markdown must reflect progress');
      evidence.markdownRevision = mdRead.body.result.revision;

      // 3. Goal evidence.
      const goalRead = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(goalNodeId)}/actions/goal.read`, {
        method: 'POST',
        body: {},
      });
      assert.equal(goalRead.status, 200);
      assert.equal(goalRead.body.result.taskId, 'task-e18-summary');
      const doneItems = goalRead.body.result.planItems.filter(i => i.status === 'done');
      assert.ok(doneItems.length >= 1, 'at least one goal item must be done');
      evidence.goalDoneCount = doneItems.length;
      evidence.goalTotalCount = goalRead.body.result.planItems.length;

      // 4. Timer evidence.
      const timerRead = await executeNodeAction(root, timerNodeId, 'timer.read', {});
      assert.ok(timerRead.result.eventCount >= 1, 'timer must have fired');
      evidence.timerEventCount = timerRead.result.eventCount;

      // 5. Wakeup evidence.
      const wakeupEntriesForMain = wakeupEntries(timerNodeId, main.sessionId);
      assert.ok(wakeupEntriesForMain.length >= 1, 'main must have wakeup entries');
      const envelope = JSON.parse(wakeupEntriesForMain[0].data);
      assert.equal(envelope.type, 'wakeup');
      assert.equal(envelope.goalNodeId, goalNodeId);
      evidence.wakeupCount = wakeupEntriesForMain.length;

      // 6. Context evidence.
      const ctx = await jsonRequest(baseUrl, `/api/workflow/context/${encodeURIComponent(main.nodeId)}`);
      assert.equal(ctx.status, 200);
      const connectedTypes = (ctx.body.context.connectedPeers || []).map(p => p.type);
      assert.ok(connectedTypes.includes('agent'), 'must have agent peer');
      evidence.connectedPeerCount = ctx.body.context.connectedPeers.length;
      evidence.manualCount = (ctx.body.context.connectedNodeManuals || []).length;

      // ── Summary assertion: all evidence sources are non-empty and coherent ──
      assert.ok(evidence.mailboxCount >= 2, `mailbox: ${evidence.mailboxCount}`);
      // markdown starts at revision 1; one append → revision 2.
      assert.ok(evidence.markdownRevision >= 2, `markdown revision: ${evidence.markdownRevision}`);
      assert.ok(evidence.goalDoneCount >= 1, `goal done: ${evidence.goalDoneCount}`);
      assert.ok(evidence.goalTotalCount >= 2, `goal total: ${evidence.goalTotalCount}`);
      assert.ok(evidence.timerEventCount >= 1, `timer events: ${evidence.timerEventCount}`);
      assert.ok(evidence.wakeupCount >= 1, `wakeup count: ${evidence.wakeupCount}`);
      assert.ok(evidence.connectedPeerCount >= 1, `connected peers: ${evidence.connectedPeerCount}`);
      assert.ok(evidence.manualCount >= 1, `manuals: ${evidence.manualCount}`);

      // The summary can be assembled entirely from the backend-derived evidence above.
      const summary = {
        taskId: 'task-e18-summary',
        mailbox: { entries: evidence.mailboxCount },
        markdown: { revision: evidence.markdownRevision },
        goal: { done: evidence.goalDoneCount, total: evidence.goalTotalCount },
        timer: { events: evidence.timerEventCount, wakeups: evidence.wakeupCount },
        connections: { peers: evidence.connectedPeerCount, manuals: evidence.manualCount },
      };
      assert.ok(summary.mailbox.entries >= 2);
      assert.ok(summary.goal.done >= 1);
      assert.ok(summary.timer.events >= 1);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // E2E Chain (E1)
  // ══════════════════════════════════════════════════════════════════
  describe('E2E Chain (E1)', () => {
    it('E1 - full chain: create/connect agents, shared markdown, structured request, replies, timer wakeup, goal check', async () => {
      const main = await createAgentViaApi('claude', 'main', 'Main Agent', 'ceo', {
        displayName: 'Main',
        responsibility: 'Run the E1 chain.',
      });
      const workerB = await createAgentViaApi('claude', 'subagent', 'Subagent', 'implementer', { displayName: 'Worker B' });
      const workerC = await createAgentViaApi('claude', 'subagent', 'Subagent', 'reviewer', { displayName: 'Worker C' });
      const nodeA = main.nodeId;
      const nodeB = workerB.nodeId;
      const nodeC = workerC.nodeId;
      const writes = { a: [], b: [], c: [] };
      registerPty(main.sessionId, writes.a);
      registerPty(workerB.sessionId, writes.b);
      registerPty(workerC.sessionId, writes.c);

      const goalNodeId = seedActiveTask(root, 'task-e1-chain');
      const md = await jsonRequest(baseUrl, '/api/workflow/nodes', {
        method: 'POST',
        body: { type: 'markdown', title: 'Shared Plan', markdown: '# Shared Plan' },
      });
      assert.equal(md.status, 201, JSON.stringify(md.body));
      const mdNodeId = md.body.node.nodeId;
      const timer = await createTimerViaApi('E1 Timer');
      const timerNodeId = timer.nodeId;

      const edgeHelper = (from, to, relation, direction = 'bidirectional') =>
        jsonRequest(baseUrl, '/api/workflow/edges', { method: 'POST', body: { from, to, relation, direction } });
      assert.equal((await edgeHelper(nodeA, nodeB, 'delegation')).status, 201);
      assert.equal((await edgeHelper(nodeA, nodeC, 'delegation')).status, 201);
      assert.equal((await edgeHelper(nodeA, mdNodeId, 'wf-bridge')).status, 201);
      assert.equal((await edgeHelper(nodeA, goalNodeId, 'goal')).status, 201);

      // A writes the shared Markdown (durable shared context).
      const written = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(mdNodeId)}/actions/markdown.append`, {
        method: 'POST',
        body: { markdown: '\n- E1 plan item', actorNodeId: nodeA },
      });
      assert.equal(written.status, 200, JSON.stringify(written.body));
      const mdRead = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(mdNodeId)}/actions/markdown.read`, {
        method: 'POST',
        body: {},
      });
      assert.ok(mdRead.body.result.markdown.includes('- E1 plan item'));

      // A sends one structured request to B and broadcasts the same request to C.
      const request = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(nodeA)}/actions/agent.sendMessage`, {
        method: 'POST',
        body: {
          to: nodeB,
          text: 'DO_E1_B',
          requestId: 'req-e1-1',
          toRole: 'implementer',
          contextRefs: [{ nodeId: mdNodeId, relation: 'shared-context' }],
        },
      });
      assert.equal(request.status, 200, JSON.stringify(request.body));
      assert.equal(request.body.result.requestId, 'req-e1-1');
      const broadcast = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(nodeA)}/actions/agent.broadcastMessage`, {
        method: 'POST',
        body: { to: [nodeC], text: 'DO_E1_C', requestId: 'req-e1-1', toRole: 'reviewer' },
      });
      assert.equal(broadcast.status, 200, JSON.stringify(broadcast.body));
      const envelopeB = `[harness-request req-e1-1 to-role=implementer contextRefs=${mdNodeId}] DO_E1_B`;
      const envelopeC = '[harness-request req-e1-1 to-role=reviewer] DO_E1_C';
      assert.equal(writes.b[0], '[', 'B must start typing the envelope prefix synchronously');
      assert.equal(writes.c[0], '[', 'C must start typing the envelope prefix synchronously');
      await waitFor(() => (writes.b.join('') === `${envelopeB}\r` ? writes.b : null), { timeout: 8000 });
      await waitFor(() => (writes.c.join('') === `${envelopeC}\r` ? writes.c : null), { timeout: 8000 });
      assert.equal(writes.b.join(''), `${envelopeB}\r`, 'B envelope must join to the exact prefix + text + \\r');
      assert.equal(writes.c.join(''), `${envelopeC}\r`, 'C envelope must join to the exact prefix + text + \\r');
      assert.equal(writes.b[writes.b.length - 1], '\r', 'B sequence must end with the single \\r');
      assert.equal(writes.c[writes.c.length - 1], '\r', 'C sequence must end with the single \\r');
      assert.equal(writes.b.join('').includes('\n'), false, 'no \\n may be injected');
      assert.equal(writes.c.join('').includes('\n'), false, 'no \\n may be injected');
      assert.equal(writes.b.filter(w => w === '\r').length, 1, 'exactly one \\r (0x0D) on B');
      assert.equal(writes.c.filter(w => w === '\r').length, 1, 'exactly one \\r (0x0D) on C');

      // B and C receive and reply with the same requestId.
      const replyB = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(nodeB)}/actions/agent.sendMessage`, {
        method: 'POST',
        body: { to: nodeA, text: 'DONE_B', requestId: 'req-e1-1' },
      });
      const replyC = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(nodeC)}/actions/agent.sendMessage`, {
        method: 'POST',
        body: { to: nodeA, text: 'DONE_C', requestId: 'req-e1-1' },
      });
      assert.equal(replyB.status, 200, JSON.stringify(replyB.body));
      assert.equal(replyC.status, 200, JSON.stringify(replyC.body));

      // Timer wakes A through the magnetic group (dock links).
      const graph = loadWorkflowGraphMap(root);
      writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: graph.edges || [],
        capsuleDockLinks: [
          dockLink(nodeA, timerNodeId),
          dockLink(timerNodeId, goalNodeId),
        ],
      });
      await armTimer(timerNodeId, 60);
      await syncTimerScheduler(root, { intervalMs: 20 });
      const wakeupEntriesForA = await waitFor(() => {
        const result = wakeupEntries(timerNodeId, main.sessionId);
        return result.length ? result : null;
      });
      const envelope = JSON.parse(wakeupEntriesForA[0].data);
      assert.equal(envelope.type, 'wakeup');
      assert.equal(envelope.timerNodeId, timerNodeId);
      assert.equal(envelope.goalNodeId, goalNodeId);

      // A reads the Goal, aggregates replies, and checks the Goal item.
      const goalRead = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(goalNodeId)}/actions/goal.read`, {
        method: 'POST',
        body: {},
      });
      assert.equal(goalRead.status, 200, JSON.stringify(goalRead.body));
      assert.equal(goalRead.body.result.taskId, 'task-e1-chain');
      const goalAdd = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(goalNodeId)}/actions/goal.add`, {
        method: 'POST',
        body: { planItems: [{ text: 'E1 chain complete' }] },
      });
      assert.equal(goalAdd.status, 200, JSON.stringify(goalAdd.body));
      const checked = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(goalNodeId)}/actions/goal.check`, {
        method: 'POST',
        body: { planItemIds: ['P-001'] },
      });
      assert.equal(checked.status, 200, JSON.stringify(checked.body));
      assert.equal(checked.body.result.state.planItems[0].status, 'done');

      const aggregated = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(nodeA)}/actions/agent.readMessages`, {
        method: 'POST',
        body: { requestId: 'req-e1-1' },
      });
      assert.equal(aggregated.status, 200, JSON.stringify(aggregated.body));
      assert.equal(aggregated.body.result.entries.length, 4, '2 asks + 2 replies in one request thread');
      const texts = aggregated.body.result.entries.map(e => String(e.data).replace(/\r$/, '')).sort();
      assert.deepEqual(texts, ['DONE_B', 'DONE_C', 'DO_E1_B', 'DO_E1_C']);
      assert.ok(aggregated.body.result.entries.every(e => e.requestId === 'req-e1-1'));

      // The final graph snapshot contains every participant.
      const snapshot = await jsonRequest(baseUrl, '/api/workflow');
      const nodeIds = snapshot.body.nodes.map(n => n.nodeId || n.id);
      for (const expected of [nodeA, nodeB, nodeC, mdNodeId, timerNodeId, goalNodeId]) {
        assert.ok(nodeIds.includes(expected), `snapshot must contain ${expected}`);
      }
    });
  });
});
