import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Helpers (mirror workflow-node-runtime.test.mjs) ──
function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), '.tmp-magnetic-test-' + id);
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({ schemaVersion: 1, version: 1, nodes: [], edges: [], positions: {}, undoStack: [], redoStack: [], deletedNodes: [] }));
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function seedAgentGraphNode(root, nodeId = 'session-mag-agent-01', overrides = {}) {
  const graph = runtime.loadWorkflowGraphMap(root);
  const sessionId = overrides.sessionId || `${nodeId}-pty`;
  runtime.writeWorkflowGraphMap(root, {
    ...graph,
    version: graph.version + 1,
    nodes: [
      ...(graph.nodes || []),
      {
        nodeId,
        sessionId,
        agentKind: overrides.agentKind || 'main',
        runtime: overrides.runtime || 'codex',
        status: overrides.status || 'stopped',
        label: overrides.label || 'Magnetic Agent',
        cwd: root,
        taskId: null,
        role: overrides.role || overrides.agentKind || 'main',
      },
    ],
    positions: {
      ...(graph.positions || {}),
      [nodeId]: { x: 100, y: 120 },
    },
  });
  return nodeId;
}

function dockLink(a, b, connections = null) {
  const pair = [a, b].sort();
  const conns = connections || [
    {
      source: a,
      target: b,
      relation: 'wf-bridge',
      direction: 'source-to-target',
      sourceHandle: 'dock',
      targetHandle: 'dock',
    },
  ];
  return {
    id: `dock:${pair[0]}::${pair[1]}`,
    nodeIds: pair,
    anchorId: pair[0],
    draggedId: pair[1],
    side: 'top',
    edges: [],
    connections: conns,
  };
}

let store;
let runtime;

before(async () => {
  store = await import('../a2a-store.mjs');
  runtime = await import('../workflow-node-runtime.mjs');
});

// ── Pure function tests ──
describe('computeMagneticTopology (pure function)', () => {
  it('returns empty groups for empty input', () => {
    const topo = store.computeMagneticTopology([]);
    assert.deepEqual(topo.groups, []);
    assert.deepEqual(topo.byNode, {});
  });

  it('returns empty groups for missing/null input', () => {
    assert.deepEqual(store.computeMagneticTopology(undefined).groups, []);
    assert.deepEqual(store.computeMagneticTopology(null).groups, []);
  });

  it('links A-B and B-C into one magnetic group (transitive)', () => {
    const links = [
      { nodeIds: ['A', 'B'] },
      { nodeIds: ['B', 'C'] },
    ];
    const topo = store.computeMagneticTopology(links);
    assert.equal(topo.groups.length, 1);
    const groupId = topo.byNode.A.magneticGroupId;
    assert.equal(topo.byNode.B.magneticGroupId, groupId);
    assert.equal(topo.byNode.C.magneticGroupId, groupId);
    assert.deepEqual(topo.groups[0].nodeIds.sort(), ['A', 'B', 'C']);
  });

  it('reports directMagneticNeighbors and transitive magneticReachableNodes', () => {
    const links = [
      { nodeIds: ['A', 'B'] },
      { nodeIds: ['B', 'C'] },
    ];
    const { byNode } = store.computeMagneticTopology(links);
    // A is docked only to B directly
    assert.deepEqual(byNode.A.directMagneticNeighbors, ['B']);
    // A can reach C transitively, and never reaches itself
    assert.ok(byNode.A.magneticReachableNodes.includes('C'), 'A should reach C transitively');
    assert.ok(!byNode.A.magneticReachableNodes.includes('A'), 'A must not list itself as reachable');
    // C is docked only to B directly
    assert.deepEqual(byNode.C.directMagneticNeighbors, ['B']);
    // B is docked to both A and C directly
    assert.deepEqual(byNode.B.directMagneticNeighbors.sort(), ['A', 'C']);
  });

  it('forms a separate group for an isolated D-E dock', () => {
    const links = [
      { nodeIds: ['A', 'B'] },
      { nodeIds: ['B', 'C'] },
      { nodeIds: ['D', 'E'] },
    ];
    const topo = store.computeMagneticTopology(links);
    assert.equal(topo.groups.length, 2);
    const aGroup = topo.byNode.A.magneticGroupId;
    const dGroup = topo.byNode.D.magneticGroupId;
    assert.notEqual(aGroup, dGroup);
    // D-E pair: each directly neighbors the other
    assert.deepEqual(topo.byNode.D.directMagneticNeighbors, ['E']);
    assert.deepEqual(topo.byNode.E.directMagneticNeighbors, ['D']);
    assert.deepEqual(topo.byNode.D.magneticReachableNodes, ['E']);
    // The D-E group contains exactly D and E
    const deGroup = topo.groups.find(group => group.nodeIds.includes('D'));
    assert.deepEqual(deGroup.nodeIds.sort(), ['D', 'E']);
  });

  it('is deterministic: identical input yields identical output (no Date.now/Math.random)', () => {
    const links = [
      { nodeIds: ['A', 'B'] },
      { nodeIds: ['B', 'C'] },
      { nodeIds: ['D', 'E'] },
    ];
    const first = store.computeMagneticTopology(links);
    const second = store.computeMagneticTopology(links);
    assert.deepEqual(second, first);
  });

  it('ignores malformed links gracefully', () => {
    const links = [
      { nodeIds: ['A', 'B'] },
      null,
      { nodeIds: ['X'] }, // single endpoint, no edge
      { notNodeIds: true },
    ];
    const topo = store.computeMagneticTopology(links);
    // A-B is the only valid dock link
    assert.equal(topo.groups.filter(group => group.nodeIds.length > 1).length, 1);
    assert.deepEqual(topo.byNode.A.directMagneticNeighbors, ['B']);
  });
});

// ── Context integration test ──
describe('Workflow magnetic topology context', () => {
  it('exposes magneticTopology in agent node context with shared magneticGroupId', async () => {
    const root = tempProjectRoot();
    try {
      const aId = seedAgentGraphNode(root, 'session-mag-a');
      const bId = seedAgentGraphNode(root, 'session-mag-b');
      const cId = seedAgentGraphNode(root, 'session-mag-c');
      const graph = runtime.loadWorkflowGraphMap(root);
      runtime.writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [
          dockLink(aId, bId),
          dockLink(bId, cId),
        ],
      });

      const aContext = await runtime.getNodeContext(root, aId);
      assert.ok(aContext.context.magneticTopology, 'agent context must expose magneticTopology');
      assert.ok(Array.isArray(aContext.context.magneticTopology.groups));
      assert.equal(aContext.context.magneticTopology.groupCount, 1);
      assert.equal(aContext.context.magneticTopology.dockLinkCount, 2);
      // Per-node fields are present
      assert.ok('magneticGroupId' in aContext.context, 'magneticGroupId must be present');
      assert.ok(Array.isArray(aContext.context.directMagneticNeighbors));
      assert.ok(Array.isArray(aContext.context.magneticReachableNodes));
      // A is docked directly only to B
      assert.deepEqual(aContext.context.directMagneticNeighbors, [bId]);
      // A reaches C transitively
      assert.ok(aContext.context.magneticReachableNodes.includes(cId));
      assert.ok(!aContext.context.magneticReachableNodes.includes(aId));

      const bContext = await runtime.getNodeContext(root, bId);
      const cContext = await runtime.getNodeContext(root, cId);
      // All three share the same magneticGroupId
      assert.equal(
        aContext.context.magneticGroupId,
        bContext.context.magneticGroupId,
        'A and B must share magneticGroupId',
      );
      assert.equal(
        aContext.context.magneticGroupId,
        cContext.context.magneticGroupId,
        'A and C must share magneticGroupId',
      );
      // C is docked directly only to B
      assert.deepEqual(cContext.context.directMagneticNeighbors, [bId]);
    } finally {
      cleanup(root);
    }
  });
});
