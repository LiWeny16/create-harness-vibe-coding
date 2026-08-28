// workflow-layout.test.mjs
//
// Smart default positions + layout graph action (agent.layout).
//
//   L1: new Main Agent on an empty graph gets the empty-graph default
//       (260, 220) persisted into the graph positions map.
//   L2: subagents with a parent land right of the parent; a second child of
//       the same parent stacks below the first.
//   L3: explicit positions are honored, never overridden by the smart default.
//   L4: layout grid mode gives every node a distinct slot and returns the
//       updated positions map.
//   L5: layout tree mode places children right of their parents.
//   L6: layout preserves capsuleDockLinks unchanged.
//
// Pattern mirrors control-plane-acceptance.test.mjs: in-process HTTP server on
// port 0, temp roots, real API calls (POST /api/sessions + the graph-node
// start route for L1-L3; POST /api/workflow/nodes/:actor/actions/agent.layout
// for L4-L6).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import { persistSession } from '../terminal-store.mjs';
import { writeWorkflowGraphMap, loadWorkflowGraphMap } from '../a2a-store.mjs';

// ── HTTP helper ──
function jsonRequest(baseUrl, route, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
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
    runtime: 'claude',
    agentKind: overrides.agentKind || 'subagent',
    role: overrides.role || 'Agent',
    roleTitle: overrides.roleTitle || '',
    displayName: overrides.displayName || '',
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
        runtime: 'claude',
        agentKind: overrides.agentKind || 'subagent',
        role: overrides.role || 'Agent',
        label: overrides.label || overrides.displayName || overrides.role || 'Agent',
        status: 'running',
        parentAgentId: overrides.parentAgentId || null,
        parentNodeId: overrides.parentNodeId || null,
      },
    ],
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

let root;
let serverHandle;
let baseUrl;
let registry;

beforeEach(async () => {
  root = seedRoot('wf-layout-');
  registry = new SessionRegistry();
  const started = await startServer({
    projectRoot: root,
    host: '127.0.0.1',
    port: 0,
    sessionRegistry: registry,
    eventsWs: false,
  });
  serverHandle = started.server;
  baseUrl = `http://127.0.0.1:${started.port}`;
});

afterEach(async () => {
  if (serverHandle) await stopServer(serverHandle);
  serverHandle = null;
  if (root) {
    const resolved = path.resolve(root);
    const tempRootDir = path.resolve('Harness', '.temp') + path.sep;
    assert.ok(resolved.startsWith(tempRootDir), `refusing to remove non-temp root: ${resolved}`);
    try {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 });
    } catch (e) {
      if (process.platform === 'win32' && ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(e?.code)) return;
      throw e;
    }
  }
  root = null;
});

// ── helpers ──
async function createSessionViaApi(overrides = {}) {
  const res = await jsonRequest(baseUrl, '/api/sessions', {
    method: 'POST',
    body: {
      runtime: 'claude',
      agentKind: 'subagent',
      role: 'Subagent',
      objective: 'workflow-layout test agent',
      attachGraphNode: false,
      deferPtySpawn: true,
      ...overrides,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function startGraphNodeViaApi(sessionId) {
  const res = await jsonRequest(baseUrl, `/api/a2a/nodes/${encodeURIComponent(sessionId)}/start`, {
    method: 'POST',
    body: { deferPtySpawn: true },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

async function runLayoutAction(actorNodeId, payload = {}) {
  const res = await jsonRequest(
    baseUrl,
    `/api/workflow/nodes/${encodeURIComponent(actorNodeId)}/actions/agent.layout`,
    { method: 'POST', body: { actorNodeId, ...payload } },
  );
  return res;
}

function graphPositions() {
  return loadWorkflowGraphMap(root).positions || {};
}

function graphNodes() {
  return loadWorkflowGraphMap(root).nodes || [];
}

// ── L1 ──────────────────────────────────────────────────────────────────────
describe('L1 - empty graph default position', () => {
  it('new Main Agent on an empty graph gets (260,220) persisted in the positions map', async () => {
    const session = await createSessionViaApi({ agentKind: 'main', role: 'Main Agent' });
    const graphNodeId = `session-${session.sessionId}`;

    // Empty graph: no nodes, no positions.
    assert.equal(graphNodes().length, 0);

    const started = await startGraphNodeViaApi(session.sessionId);
    assert.equal(started.ok, true);

    const positions = graphPositions();
    assert.ok(positions[graphNodeId], `positions must contain ${graphNodeId}: ${JSON.stringify(positions)}`);
    assert.deepEqual(positions[graphNodeId], { x: 260, y: 220 });

    // The pushed node carries the computed position too.
    const node = graphNodes().find(n => (n.nodeId || n.id) === graphNodeId);
    assert.ok(node, `graph must contain ${graphNodeId}`);
    assert.deepEqual(node.position, { x: 260, y: 220 });
  });

  it('second agent without a parent stacks below the first, not under the terminal', async () => {
    const first = await createSessionViaApi({ agentKind: 'main', role: 'Main Agent' });
    await startGraphNodeViaApi(first.sessionId);

    const second = await createSessionViaApi({ agentKind: 'main', role: 'Main Agent' });
    await startGraphNodeViaApi(second.sessionId);

    const firstNodeId = `session-${first.sessionId}`;
    const secondNodeId = `session-${second.sessionId}`;
    const positions = graphPositions();
    assert.deepEqual(positions[firstNodeId], { x: 260, y: 220 });
    // maxY = 220 + 120 = 340 → next y = 340 + 140 = 480.
    assert.deepEqual(positions[secondNodeId], { x: 260, y: 480 });
  });
});

// ── L2 ──────────────────────────────────────────────────────────────────────
describe('L2 - parent-anchored placement', () => {
  it('subagent with a parent is placed right of the parent; second child stacks below', async () => {
    // Main Agent first (empty graph → (260,220)).
    const main = await createSessionViaApi({ agentKind: 'main', role: 'Main Agent' });
    await startGraphNodeViaApi(main.sessionId);
    const mainNodeId = `session-${main.sessionId}`;
    assert.deepEqual(graphPositions()[mainNodeId], { x: 260, y: 220 });

    // First child: same parent → childIndex 0 → (260+420, 220+80*0) = (680,220).
    const child1 = await createSessionViaApi({
      parentNodeId: mainNodeId,
      parentAgentId: main.sessionId,
    });
    await startGraphNodeViaApi(child1.sessionId);
    const child1NodeId = `session-${child1.sessionId}`;

    // Second child: same parent → childIndex 1 → (680, 220+80) = (680,300).
    const child2 = await createSessionViaApi({
      parentNodeId: mainNodeId,
      parentAgentId: main.sessionId,
    });
    await startGraphNodeViaApi(child2.sessionId);
    const child2NodeId = `session-${child2.sessionId}`;

    const positions = graphPositions();
    assert.deepEqual(positions[child1NodeId], { x: 680, y: 220 }, 'first child right of parent');
    assert.deepEqual(positions[child2NodeId], { x: 680, y: 300 }, 'second child stacked below first');
  });
});

// ── L3 ──────────────────────────────────────────────────────────────────────
describe('L3 - explicit positions honored', () => {
  it('a pre-seeded positions entry wins over the smart default', async () => {
    const session = await createSessionViaApi({ agentKind: 'main', role: 'Main Agent' });
    const graphNodeId = `session-${session.sessionId}`;

    // Seed an explicit position for the target node id before starting.
    const graph = loadWorkflowGraphMap(root);
    writeWorkflowGraphMap(root, {
      ...graph,
      version: graph.version + 1,
      positions: { ...(graph.positions || {}), [graphNodeId]: { x: 333, y: 444 } },
    });

    await startGraphNodeViaApi(session.sessionId);

    const positions = graphPositions();
    assert.deepEqual(positions[graphNodeId], { x: 333, y: 444 }, 'explicit position must be honored, not overridden');
  });
});

// ── L4 ──────────────────────────────────────────────────────────────────────
describe('L4 - layout grid mode', () => {
  it('grid gives every node a distinct slot and returns the positions map', async () => {
    seedAgentSession(root, 'l4-main', 'session-l4-main', { agentKind: 'main', role: 'Main Agent' });
    seedAgentSession(root, 'l4-a', 'session-l4-a');
    seedAgentSession(root, 'l4-b', 'session-l4-b');
    seedAgentSession(root, 'l4-c', 'session-l4-c');

    const res = await runLayoutAction('l4-main', { mode: 'grid' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.action, 'layout');
    assert.ok(res.body.positions, 'response must return positions');

    const positions = res.body.positions;
    const expectedIds = ['l4-main', 'l4-a', 'l4-b', 'l4-c'];
    for (const nodeId of expectedIds) {
      assert.ok(positions[nodeId], `grid must place ${nodeId}`);
    }
    // No overlaps: every (x, y) pair is distinct.
    const seen = new Set();
    for (const nodeId of expectedIds) {
      const { x, y } = positions[nodeId];
      const key = `${x},${y}`;
      assert.ok(!seen.has(key), `duplicate slot ${key} for ${nodeId}`);
      seen.add(key);
    }
    // Grid order: main agent first at the origin.
    assert.deepEqual(positions['l4-main'], { x: 260, y: 220 });
  });
});

// ── L5 ──────────────────────────────────────────────────────────────────────
describe('L5 - layout tree mode', () => {
  it('children are centered below their parents (layered tree)', async () => {
    seedAgentSession(root, 'l5-main', 'session-l5-main', { agentKind: 'main', role: 'Main Agent' });
    seedAgentSession(root, 'l5-a', 'session-l5-a', {
      parentNodeId: 'l5-main',
      parentAgentId: 'session-l5-main',
    });
    seedAgentSession(root, 'l5-b', 'session-l5-b', {
      parentNodeId: 'l5-main',
      parentAgentId: 'session-l5-main',
    });

    const res = await runLayoutAction('l5-main', { mode: 'tree' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const positions = res.body.positions;

    // Root at origin.
    assert.deepEqual(positions['l5-main'], { x: 260, y: 220 });
    // Children on the row BELOW, centered under the parent: two 280-wide
    // slots centered on x=260 -> left slot center 120, right slot center 400.
    assert.deepEqual(positions['l5-a'], { x: 120, y: 400 });
    assert.deepEqual(positions['l5-b'], { x: 400, y: 400 });
  });
});

// ── L6 ──────────────────────────────────────────────────────────────────────
describe('L6 - capsuleDockLinks preserved', () => {
  it('layout keeps dock links unchanged', async () => {
    seedAgentSession(root, 'l6-main', 'session-l6-main', { agentKind: 'main', role: 'Main Agent' });
    seedAgentSession(root, 'l6-a', 'session-l6-a');
    seedAgentSession(root, 'l6-b', 'session-l6-b');

    const link = dockLink('l6-a', 'l6-b');
    const graph = loadWorkflowGraphMap(root);
    writeWorkflowGraphMap(root, {
      ...graph,
      version: graph.version + 1,
      capsuleDockLinks: [...(graph.capsuleDockLinks || []), link],
    });

    const before = loadWorkflowGraphMap(root).capsuleDockLinks;

    const res = await runLayoutAction('l6-main', { mode: 'grid' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const after = loadWorkflowGraphMap(root).capsuleDockLinks;
    assert.deepEqual(after, before, 'capsuleDockLinks must survive layout untouched');
  });
});

// ── L7 ──────────────────────────────────────────────────────────────────────
// L7: layout tidy mode (AC-002/AC-003). Same POST /actions/agent.layout
// endpoint as L4-L6 with payload {mode:'tidy', sizes?}: edge-direction
// layers, per-node size awareness, docked pairs glued, positions persisted
// (graph-map GET reflects them), undo op recorded.
//
// W1 pinned contract: response {ok:true, action:'layout', positions};
// sizes payload {[nodeId]:{w,h}} is optional (server falls back to the
// 280x180 slot); default sizes for the checks below are 280x180 and the
// minimum clearance between any two rects is 16px.

function writeGraphExtras(positions = {}, edges = [], dockLinks = []) {
  const graph = loadWorkflowGraphMap(root);
  writeWorkflowGraphMap(root, {
    ...graph,
    version: graph.version + 1,
    positions: { ...(graph.positions || {}), ...positions },
    edges: [...(graph.edges || []), ...edges],
    capsuleDockLinks: [...(graph.capsuleDockLinks || []), ...dockLinks],
  });
}

function minRectGap(positions, sizes = {}) {
  const rects = Object.entries(positions).map(([id, p]) => ({
    id,
    x: p.x,
    y: p.y,
    w: sizes[id]?.w ?? 280,
    h: sizes[id]?.h ?? 180,
  }));
  let minGap = Infinity;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const sepX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
      const sepY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
      minGap = Math.min(minGap, Math.max(sepX, sepY));
    }
  }
  return minGap;
}

describe('L7 - layout tidy mode', () => {
  it('tidy orders layers by edge direction, returns positions, persists to graph-map GET (AC-002)', async () => {
    seedAgentSession(root, 'l7-main', 'session-l7-main', { agentKind: 'main', role: 'Main Agent' });
    seedAgentSession(root, 'l7-a', 'session-l7-a');
    seedAgentSession(root, 'l7-b', 'session-l7-b');
    seedAgentSession(root, 'l7-c', 'session-l7-c');
    writeGraphExtras({}, [
      { id: 'edge-l7-main-a', from: 'l7-main', to: 'l7-a', relation: 'delegates', direction: 'source-to-target' },
      { id: 'edge-l7-a-b', from: 'l7-a', to: 'l7-b', relation: 'delegates', direction: 'source-to-target' },
    ]);

    const res = await runLayoutAction('l7-main', { mode: 'tidy' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.action, 'layout');
    const positions = res.body.positions;
    assert.ok(positions, 'response must return positions');
    for (const nodeId of ['l7-main', 'l7-a', 'l7-b', 'l7-c']) {
      assert.ok(positions[nodeId], `tidy must place ${nodeId}`);
    }
    // Edge-direction chain l7-main -> l7-a -> l7-b: strictly increasing rows.
    assert.ok(
      positions['l7-main'].y < positions['l7-a'].y && positions['l7-a'].y < positions['l7-b'].y,
      `layers ordered by edge direction: main.y=${positions['l7-main'].y}, a.y=${positions['l7-a'].y}, b.y=${positions['l7-b'].y}`,
    );
    assert.ok(minRectGap(positions) >= 16, 'no two rects overlap (min gap >= 16)');

    // Persistence: the graph-map GET reflects the tidy positions.
    const getRes = await jsonRequest(baseUrl, '/api/a2a/graph-map');
    assert.equal(getRes.status, 200);
    for (const nodeId of ['l7-main', 'l7-a', 'l7-b', 'l7-c']) {
      assert.deepEqual(getRes.body.positions[nodeId], positions[nodeId], `graph-map GET positions for ${nodeId}`);
      const node = getRes.body.nodes.find(n => (n.nodeId || n.id) === nodeId);
      assert.ok(node, `graph-map GET must contain node ${nodeId}`);
      assert.deepEqual(node.position, positions[nodeId], `node.position persisted for ${nodeId}`);
    }
  });

  it('tidy honors per-node sizes so a 560x358 agent never overlaps its child (AC-003)', async () => {
    seedAgentSession(root, 'l7-main', 'session-l7-main', { agentKind: 'main', role: 'Main Agent' });
    seedAgentSession(root, 'l7-s', 'session-l7-s');
    writeGraphExtras({}, [
      { id: 'edge-l7-main-s', from: 'l7-main', to: 'l7-s', relation: 'delegates', direction: 'source-to-target' },
    ]);

    const sizes = { 'l7-main': { w: 560, h: 358 } };
    const res = await runLayoutAction('l7-main', { mode: 'tidy', sizes });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const positions = res.body.positions;
    assert.ok(positions['l7-main'] && positions['l7-s']);
    assert.ok(
      minRectGap(positions, sizes) >= 16,
      'size-aware tidy keeps >= 16px clearance between the 560x358 node and its neighbor',
    );
  });

  it('docked pairs stay glued: relative offset preserved and no overlaps after tidy (AC-003)', async () => {
    seedAgentSession(root, 'l7-main', 'session-l7-main', { agentKind: 'main', role: 'Main Agent' });
    seedAgentSession(root, 'l7-a', 'session-l7-a');
    seedAgentSession(root, 'l7-d1', 'session-l7-d1');
    seedAgentSession(root, 'l7-d2', 'session-l7-d2');
    writeGraphExtras(
      { 'l7-d1': { x: 260, y: 220 }, 'l7-d2': { x: 340, y: 416 } },
      [
        { id: 'edge-l7-main-a', from: 'l7-main', to: 'l7-a', relation: 'delegates', direction: 'source-to-target' },
      ],
      [dockLink('l7-d1', 'l7-d2')],
    );
    // Seed delta {80, 196}: y = one node height (180) + 16px clearance, so the
    // glued pair itself also satisfies the >= 16px min-gap rule (a docked pair
    // is one layout unit; the no-overlap contract is between units).
    const delta = { x: 340 - 260, y: 416 - 220 };

    const res = await runLayoutAction('l7-main', { mode: 'tidy' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const positions = res.body.positions;
    assert.ok(positions['l7-d1'] && positions['l7-d2'], 'docked nodes must keep positions after tidy');
    assert.equal(
      positions['l7-d2'].x - positions['l7-d1'].x,
      delta.x,
      'docked pair keeps its relative x offset',
    );
    assert.equal(
      positions['l7-d2'].y - positions['l7-d1'].y,
      delta.y,
      'docked pair keeps its relative y offset',
    );
    assert.ok(minRectGap(positions) >= 16, 'docked pair must not overlap any node after tidy');

    const after = loadWorkflowGraphMap(root).capsuleDockLinks;
    assert.equal(after.length, 1, 'capsuleDockLinks must survive tidy untouched');
  });

  it('tidy records an undo op carrying the forward positions (contract)', async () => {
    seedAgentSession(root, 'l7-main', 'session-l7-main', { agentKind: 'main', role: 'Main Agent' });
    seedAgentSession(root, 'l7-a', 'session-l7-a');
    writeGraphExtras({}, [
      { id: 'edge-l7-main-a', from: 'l7-main', to: 'l7-a', relation: 'delegates', direction: 'source-to-target' },
    ]);

    const res = await runLayoutAction('l7-main', { mode: 'tidy' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const ops = loadWorkflowGraphMap(root).undoStack || [];
    assert.ok(ops.length >= 1, 'tidy must record an undo op');
    const last = ops[ops.length - 1];
    assert.equal(last.action, 'agent.layout');
    assert.deepEqual(last.forward.positions, res.body.positions, 'undo op forward positions match the response');
  });

  // W4 review finding MED-2: the tidy undo op must be able to restore a
  // docked pair. inverse.positions has to carry the PRE-tidy positions of the
  // pair members (anchor AND slave) — the current implementation snapshots
  // only the non-docked "movable" nodes, so undo would leave the docked pair
  // at its tidy position.
  it('tidy undo op inverse.positions includes docked pair pre-tidy positions (MED-2)', async () => {
    seedAgentSession(root, 'l7-main', 'session-l7-main', { agentKind: 'main', role: 'Main Agent' });
    seedAgentSession(root, 'l7-a', 'session-l7-a');
    seedAgentSession(root, 'l7-d1', 'session-l7-d1');
    seedAgentSession(root, 'l7-d2', 'session-l7-d2');
    const preTidy = {
      'l7-d1': { x: 260, y: 220 },
      'l7-d2': { x: 340, y: 416 },
    };
    writeGraphExtras(
      { ...preTidy, 'l7-main': { x: 260, y: 220 }, 'l7-a': { x: 680, y: 220 } },
      [
        { id: 'edge-l7-main-a', from: 'l7-main', to: 'l7-a', relation: 'delegates', direction: 'source-to-target' },
      ],
      [dockLink('l7-d1', 'l7-d2')],
    );

    const res = await runLayoutAction('l7-main', { mode: 'tidy' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const ops = loadWorkflowGraphMap(root).undoStack || [];
    assert.ok(ops.length >= 1, 'tidy must record an undo op');
    const last = ops[ops.length - 1];
    assert.equal(last.action, 'agent.layout');
    assert.ok(last.inverse && last.inverse.positions, 'undo op must carry inverse positions');
    assert.deepEqual(
      last.inverse.positions['l7-d1'],
      preTidy['l7-d1'],
      'undo inverse keeps the dock anchor pre-tidy position',
    );
    assert.deepEqual(
      last.inverse.positions['l7-d2'],
      preTidy['l7-d2'],
      'undo inverse keeps the dock slave pre-tidy position',
    );
    assert.ok(
      last.inverse.positions['l7-main'] && last.inverse.positions['l7-a'],
      'undo inverse still covers the non-docked nodes',
    );
  });
});

// ── L8 ──────────────────────────────────────────────────────────────────────
// L8: agent creation carries an optional client-computed position
// (W4 review finding HIGH-1, AC-001 for agent creation). POST /api/sessions
// accepts {position:{x,y}}; the server materializes the graph node AT that
// position and — size-aware (agent rects are 560x358, not the 280x180 slot) —
// never lets two adjacent agents overlap.
//
// W5 pinned contract: the session create body may carry
//   position: {x: number, y: number}
// The graph-map positions map (and node.position) must then reflect that
// position for the created node; when the requested spot is not clear of the
// real agent extents, the server moves the new node to a clear spot.

describe('L8 - agent create with client position (HIGH-1)', () => {
  it('a session created with a position materializes the graph node AT that position', async () => {
    const session = await createSessionViaApi({
      agentKind: 'main',
      role: 'Main Agent',
      attachGraphNode: true,
      position: { x: 333, y: 444 },
    });
    const graphNodeId = `session-${session.sessionId}`;

    // The graph node is materialized at CREATE time (attachGraphNode default
    // true) at the requested position — no start round-trip needed.
    const positions = graphPositions();
    assert.deepEqual(
      positions[graphNodeId],
      { x: 333, y: 444 },
      'server must materialize the node at the requested position',
    );

    const getRes = await jsonRequest(baseUrl, '/api/a2a/graph-map');
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.positions[graphNodeId], { x: 333, y: 444 }, 'graph-map GET agrees');
    const node = getRes.body.nodes.find(n => (n.nodeId || n.id) === graphNodeId);
    assert.ok(node, 'graph-map GET must contain the created node');
    assert.deepEqual(node.position, { x: 333, y: 444 }, 'node.position persisted');
  });

  it('two adjacent agent free spots stay non-overlapping at real agent size (560x358)', async () => {
    // A requested at (260,220); B requested at (620,240) — a spot that clears
    // a 280x180 slot but NOT a 560x358 agent at A. The server must be
    // size-aware: B's persisted position must clear A's real rect.
    const a = await createSessionViaApi({
      agentKind: 'main',
      role: 'Main Agent',
      attachGraphNode: true,
      position: { x: 260, y: 220 },
    });
    const b = await createSessionViaApi({
      agentKind: 'main',
      role: 'Main Agent',
      attachGraphNode: true,
      position: { x: 620, y: 240 },
    });
    const aNodeId = `session-${a.sessionId}`;
    const bNodeId = `session-${b.sessionId}`;

    const positions = graphPositions();
    assert.deepEqual(positions[aNodeId], { x: 260, y: 220 }, 'first agent keeps its requested spot');
    assert.ok(positions[bNodeId], `second agent must be placed: ${JSON.stringify(positions)}`);

    // Agent nodes render at 560x358; both rects must keep >= 16px clearance.
    const sizes = { [aNodeId]: { w: 560, h: 358 }, [bNodeId]: { w: 560, h: 358 } };
    assert.ok(
      minRectGap(positions, sizes) >= 16,
      `agents must not overlap at real size (min gap was ${minRectGap(positions, sizes)})`,
    );
  });
});

// ── L8 ──────────────────────────────────────────────────────────────────────
// L8: layout agent-tree mode (task-agent-tree-layout). Same POST /actions/
// agent.layout endpoint with payload {mode:'agent-tree', sizes?}: main agent
// centered anchor, subagents one layer below as an agent TREE, scattered
// nodes as matrix bands above owners, docked pairs glued, positions persisted,
// and — the round-2 contract — the action NEVER creates or modifies edges.

describe('L8 - layout agent-tree mode', () => {
  it('agent-tree centers main, stacks subagents one layer below, persists positions (AC-001)', async () => {
    seedAgentSession(root, 'l8-main', 'session-l8-main', { agentKind: 'main', role: 'Main Agent' });
    seedAgentSession(root, 'l8-s1', 'session-l8-s1');
    seedAgentSession(root, 'l8-s2', 'session-l8-s2');
    seedAgentSession(root, 'l8-s3', 'session-l8-s3');
    writeGraphExtras({}, [
      { id: 'edge-l8-1', from: 'l8-main', to: 'l8-s1', relation: 'wf-bridge', direction: 'bidirectional' },
      { id: 'edge-l8-2', from: 'l8-main', to: 'l8-s2', relation: 'wf-bridge', direction: 'bidirectional' },
      { id: 'edge-l8-3', from: 'l8-main', to: 'l8-s3', relation: 'wf-bridge', direction: 'bidirectional' },
    ]);

    const res = await runLayoutAction('l8-main', { mode: 'agent-tree' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.action, 'layout');
    const positions = res.body.positions;
    for (const nodeId of ['l8-main', 'l8-s1', 'l8-s2', 'l8-s3']) {
      assert.ok(positions[nodeId], `agent-tree must place ${nodeId}`);
    }
    // Main is CENTERED on the handler origin {260, 220}: default 280x180 slot
    // -> top-left (120, 220); the sub row centers under main's center x=260.
    assert.deepEqual(positions['l8-main'], { x: 120, y: 220 }, 'main centers on the origin (top-left 120)');
    // Subagents share ONE layer below main, sorted by id: s1 left, s2 center, s3 right.
    assert.ok(
      positions['l8-s1'].y === positions['l8-s2'].y && positions['l8-s2'].y === positions['l8-s3'].y,
      'subagents share one layer below main',
    );
    assert.ok(positions['l8-s1'].y > positions['l8-main'].y, 'subagent layer is BELOW main');
    assert.ok(
      positions['l8-s1'].x < positions['l8-s2'].x && positions['l8-s2'].x < positions['l8-s3'].x,
      'subagents ordered by id left to right',
    );
    assert.equal(positions['l8-s2'].x, positions['l8-main'].x, 'middle subagent centers under main');
    assert.ok(minRectGap(positions) >= 16, 'no two rects overlap (min gap >= 16)');

    // Persistence: the graph-map GET reflects the agent-tree positions.
    const getRes = await jsonRequest(baseUrl, '/api/a2a/graph-map');
    assert.equal(getRes.status, 200);
    for (const nodeId of ['l8-main', 'l8-s1', 'l8-s2', 'l8-s3']) {
      assert.deepEqual(getRes.body.positions[nodeId], positions[nodeId], `graph-map GET positions for ${nodeId}`);
    }
  });

  it('agent-tree never creates or modifies edges (AC-002)', async () => {
    seedAgentSession(root, 'l8-main', 'session-l8-main', { agentKind: 'main', role: 'Main Agent' });
    seedAgentSession(root, 'l8-s1', 'session-l8-s1');
    seedAgentSession(root, 'l8-s2', 'session-l8-s2');
    writeGraphExtras({}, [
      { id: 'edge-l8-a', from: 'l8-main', to: 'l8-s1', relation: 'wf-bridge', direction: 'bidirectional' },
      { id: 'edge-l8-b', from: 'l8-main', to: 'l8-s2', relation: 'wf-bridge', direction: 'bidirectional' },
    ]);
    const before = loadWorkflowGraphMap(root).edges;

    const res = await runLayoutAction('l8-main', { mode: 'agent-tree' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const after = loadWorkflowGraphMap(root).edges;
    assert.equal(after.length, before.length, 'agent-tree must not add or remove edges');
    assert.deepEqual(after, before, 'agent-tree must not modify edges');
  });

  it('subagent with explicit parentAgentId goes below its declared parent (tree depth)', async () => {
    seedAgentSession(root, 'l8-main', 'session-l8-main', { agentKind: 'main', role: 'Main Agent' });
    seedAgentSession(root, 'l8-s1', 'session-l8-s1');
    seedAgentSession(root, 'l8-s1b', 'session-l8-s1b', { parentAgentId: 'l8-s1' });
    writeGraphExtras({}, [
      { id: 'edge-l8-p1', from: 'l8-main', to: 'l8-s1', relation: 'wf-bridge', direction: 'bidirectional' },
      // l8-s1b also bridges main — parentAgentId must win.
      { id: 'edge-l8-p2', from: 'l8-main', to: 'l8-s1b', relation: 'wf-bridge', direction: 'bidirectional' },
    ]);

    const res = await runLayoutAction('l8-main', { mode: 'agent-tree' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const positions = res.body.positions;
    assert.ok(positions['l8-s1b'].y > positions['l8-s1'].y, 'declared child sits BELOW its parent agent');
    assert.ok(positions['l8-s1b'].y > positions['l8-main'].y, 'and below main');
    assert.ok(minRectGap(positions) >= 16, 'no two rects overlap (min gap >= 16)');
  });
});
