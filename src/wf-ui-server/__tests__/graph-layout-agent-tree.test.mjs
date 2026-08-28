import test from 'node:test';
import assert from 'node:assert/strict';
import { agentTreePositions, GRAPH_SLOT_W, GRAPH_SLOT_H } from '../graph-layout.mjs';

// Agent-tree compact layout contract (task-agent-tree-layout W1 pins, RED first).
// Round-2 user requirements: main agent = core anchor centered; subagents one
// layer BELOW main arranged as an agent TREE (multi-level); non-agent nodes
// ("scattered") arranged as a compact MATRIX BAND ABOVE their owner agent;
// layout NEVER creates or modifies edges (pure positions).
//
// Pinned API:
//   agentTreePositions(nodes, edges, opts)
//     nodes: Array<{id, width?, height?, agentKind?, parentAgentId?, parentNodeId?}>
//       agentKind: 'main' | 'subagent'  (any other value or absent = non-agent)
//       width/height default to GRAPH_SLOT_W/H (280x180)
//     edges: Array<{from, to, direction?, relation?}>  — used ONLY for
//       agent-tree parenting (first edge to another agent); direction ignored.
//     opts: {
//       origin?: {x, y},   default {260, 220} — origin.x is the CENTER x of
//                          the main agent; origin.y is the TOP of its band.
//       gapX?: number,     default 64   (edge-to-edge horizontal spacing)
//       gapY?: number,     default 48   (edge-to-edge vertical spacing)
//       dockedPairs?: Array<{aId, bId, offset: {x,y}}>  — glued exactly:
//                          positions[b] = positions[a] + offset.
//     }
//   returns {[nodeId]: {x, y}} — every input node placed exactly once;
//   deterministic (same input -> deep-equal output).
//
// Geometry rules pinned below:
//   - emitted positions are TOP-LEFT corners (graph-map/UI convention);
//     opts.origin.x anchors the main agent's CENTER x, origin.y the band top.
//   - agent children sorted by id asc; subtree width = max(unit width,
//     sum(child subtree widths) + gapX*(n-1)); parent centered over children.
//   - asset matrix: cols = clamp(ceil(sqrt(n)), 1, 6), row-major by id asc,
//     row height = tallest unit + gapY, each row centered on owner center;
//     band sits ABOVE the owner (bandTop = parentRowBottom + gapY; owner y =
//     bandTop + bandH + (bandH > 0 ? gapY : 0)).
//   - clearance floor: no two rects closer than 16px (shared AC contract).

const ORIGIN = { x: 0, y: 0 };
const NODE = { width: 100, height: 50 };
const S = (id, extra = {}) => ({ id, ...NODE, ...extra });
const E = (from, to, direction = 'bidirectional') => ({ from, to, direction });
const AGENT = { agentKind: 'subagent' };

function minRectGap(positions, nodes) {
  const rects = nodes.map((node) => {
    const p = positions[node.id];
    assert.ok(p, `agentTreePositions must place ${node.id}`);
    assert.ok(Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)), `position for ${node.id} must be numeric`);
    return {
      id: node.id,
      x: Number(p.x),
      y: Number(p.y),
      w: Number.isFinite(Number(node.width)) ? Number(node.width) : GRAPH_SLOT_W,
      h: Number.isFinite(Number(node.height)) ? Number(node.height) : GRAPH_SLOT_H,
    };
  });
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

function assertNoOverlap16(positions, nodes) {
  const gap = minRectGap(positions, nodes);
  assert.ok(gap >= 16, `all rects must keep >= 16px clearance (min gap was ${gap})`);
}

test('A1: main centered; subagents one row below, centered under main, sorted by id', () => {
  const nodes = [
    S('M', { agentKind: 'main' }),
    S('S1', AGENT),
    S('S2', AGENT),
    S('S3', AGENT),
  ];
  const edges = [E('M', 'S1'), E('M', 'S2'), E('M', 'S3')];
  const positions = agentTreePositions(nodes, edges, { origin: ORIGIN });
  // Positions are TOP-LEFT; origin.x=0 anchors main's CENTER, so main's left
  // is -50 (width 100). Row width 3*100 + 2*64 = 428 centered on 0 ->
  // centers -164, 0, 164 -> lefts -214, -50, 114.
  assert.deepEqual(positions.M, { x: -50, y: 0 }, 'main center sits on origin.x');
  assert.ok(
    positions.S1.y === positions.S2.y && positions.S2.y === positions.S3.y,
    'subagents share ONE layer below main',
  );
  assert.ok(positions.S1.y > positions.M.y, 'subagent layer is BELOW main');
  assert.equal(positions.S2.x, positions.M.x, 'middle subagent centers under main');
  assert.equal(positions.S1.x, -214, 'first subagent left of center');
  assert.equal(positions.S3.x, 114, 'last subagent right of center');
  assertNoOverlap16(positions, nodes);
});

test('A2: scattered assets form a matrix band ABOVE main, centered, row-major', () => {
  const nodes = [S('M', { agentKind: 'main' }), S('a1'), S('a2'), S('a3')];
  const positions = agentTreePositions(nodes, [], { origin: ORIGIN });
  // cols = clamp(ceil(sqrt(3)), 1, 6) = 2 -> row1: a1,a2; row2: a3.
  // Band height = 50 + 48 + 50 = 148; M.y = bandTop(0) + 148 + 48 = 196.
  assert.ok(positions.a1.y < positions.M.y && positions.a2.y < positions.M.y && positions.a3.y < positions.M.y, 'assets ABOVE main');
  assert.equal(positions.a1.y, 0, 'first matrix row at band top');
  assert.equal(positions.a2.y, 0, 'second item on first matrix row');
  assert.equal(positions.a3.y, 98, 'third item wraps to the second matrix row');
  assert.equal(positions.M.x, -50, 'main center keeps the origin x (top-left -50)');
  assert.equal(positions.M.y, 196, 'main sits below its own band');
  // Row1 width = 2*100 + 64 = 264 centered on 0 -> lefts -132, 32.
  assert.equal(positions.a1.x, -132, 'row1 left item');
  assert.equal(positions.a2.x, 32, 'row1 right item');
  assert.equal(positions.a3.x, -50, 'row2 single item centered on main');
  assertNoOverlap16(positions, nodes);
});

test('A3: multi-level agent tree: nested subagent below its parent, siblings side by side', () => {
  const nodes = [
    S('M', { agentKind: 'main' }),
    S('S1', AGENT),
    S('S1b', AGENT),
    S('S2', AGENT),
  ];
  const edges = [E('M', 'S1'), E('S1', 'S1b'), E('M', 'S2')];
  const positions = agentTreePositions(nodes, edges, { origin: ORIGIN });
  assert.equal(positions.S1.y, 98, 'first agent row below main (50 + 48)');
  assert.equal(positions.S2.y, 98, 'sibling shares the first agent row');
  assert.equal(positions.S1b.y, 196, 'nested subagent one row deeper');
  assert.equal(positions.S1.x, -132, 'left sibling subtree (center -82 -> left -132)');
  assert.equal(positions.S2.x, 32, 'right sibling subtree (center 82 -> left 32)');
  assert.equal(positions.S1b.x, positions.S1.x, 'nested subagent centers under its parent');
  assertNoOverlap16(positions, nodes);
});

test('A4: explicit parentAgentId wins over bridge edges', () => {
  const nodes = [
    S('M', { agentKind: 'main' }),
    S('S1', AGENT),
    S('S2', { ...AGENT, parentAgentId: 'S1' }),
  ];
  const edges = [E('M', 'S1'), E('M', 'S2')];
  const positions = agentTreePositions(nodes, edges, { origin: ORIGIN });
  assert.equal(positions.S1.x, positions.M.x, 'S1 (only child) centers under M');
  assert.ok(positions.S2.y > positions.S1.y, 'S2 sits BELOW S1 despite bridging M');
  assert.equal(positions.S2.x, positions.S1.x, 'S2 centers under its declared parent');
  assertNoOverlap16(positions, nodes);
});

test('A5: asset with parentAgentId lands in the band ABOVE its owner subagent', () => {
  const nodes = [
    S('M', { agentKind: 'main' }),
    S('S1', AGENT),
    S('X', { parentAgentId: 'S1' }),
  ];
  const edges = [E('M', 'S1')];
  const positions = agentTreePositions(nodes, edges, { origin: ORIGIN });
  assert.ok(positions.X.y < positions.S1.y, 'asset band is ABOVE the owner agent');
  assert.ok(positions.X.y > positions.M.y, 'subagent band sits below main');
  assert.equal(positions.X.x, positions.S1.x, 'band centers on the owner');
  // X at bandTop 98, S1.y = 98 + 50 + 48 = 196.
  assert.equal(positions.X.y, 98, 'band top = main bottom + gapY');
  assert.equal(positions.S1.y, 196, 'owner below its own band');
  assertNoOverlap16(positions, nodes);
});

test('A5b: parentNodeId chain resolves ownership to an agent', () => {
  const nodes = [
    S('M', { agentKind: 'main' }),
    S('S1', AGENT),
    S('child', { parentNodeId: 'X' }),
    S('X', { parentNodeId: 'S1' }),
  ];
  const edges = [E('M', 'S1')];
  const positions = agentTreePositions(nodes, edges, { origin: ORIGIN });
  assert.ok(positions.X.y < positions.S1.y, 'chain tail asset above the owner agent');
  assert.ok(positions.child.y < positions.S1.y, 'chain head asset above the owner agent');
  assertNoOverlap16(positions, nodes);
});

test('A6: no main agent -> flat fallback: agents in one root row, assets band above, centered', () => {
  const nodes = [S('A', AGENT), S('B', AGENT), S('x1'), S('x2')];
  const edges = [E('A', 'B')];
  const positions = agentTreePositions(nodes, edges, { origin: ORIGIN });
  assert.equal(positions.A.y, positions.B.y, 'agents share one root row');
  assert.ok(positions.x1.y < positions.A.y && positions.x2.y < positions.A.y, 'assets above the agent row');
  assert.equal(positions.x1.y, 0, 'band top at origin');
  assert.equal(positions.A.y, 98, 'agent row below the band (50 + 48)');
  assert.equal(positions.A.x, -132, 'agents centered as a row (center -82 -> left -132)');
  assert.equal(positions.B.x, 32, 'agents centered as a row (center 82 -> left 32)');
  assert.equal(positions.x1.x, -132, 'asset matrix centered on the agent row');
  assert.equal(positions.x2.x, 32, 'asset matrix centered on the agent row');
  assertNoOverlap16(positions, nodes);
});

test('A7: docked pair glued exactly; child row clears the glued unit extent', () => {
  const nodes = [
    S('M', { agentKind: 'main' }),
    S('S1', AGENT),
    S('X'),
  ];
  const edges = [E('M', 'S1')];
  const dockedPairs = [{ aId: 'M', bId: 'X', offset: { x: 12, y: 196 } }];
  const positions = agentTreePositions(nodes, edges, { origin: ORIGIN, dockedPairs });
  assert.equal(positions.X.x, positions.M.x + 12, 'dock keeps its x offset exactly');
  assert.equal(positions.X.y, positions.M.y + 196, 'dock keeps its y offset exactly');
  // X extends M's unit down to y=246; S1 must clear 246 + 16.
  assert.ok(positions.S1.y >= positions.M.y + 246 + 16, 'child row clears the glued unit');
  assertNoOverlap16(positions, nodes);
});

test('A8: deterministic: same input -> deep-equal output', () => {
  const nodes = [
    S('M', { agentKind: 'main' }),
    S('S1', AGENT),
    S('S1b', AGENT),
    S('S2', AGENT),
    S('a1', { parentAgentId: 'S1' }),
    S('a2'),
  ];
  const edges = [E('M', 'S1'), E('S1', 'S1b'), E('M', 'S2')];
  const first = agentTreePositions(nodes, edges, { origin: ORIGIN });
  const second = agentTreePositions(nodes, edges, { origin: ORIGIN });
  assert.deepEqual(second, first);
  assertNoOverlap16(first, nodes);
});

test('A9: agent parenting cycle is safe: both agents placed on the root row', () => {
  const nodes = [
    S('A', { ...AGENT, parentAgentId: 'B' }),
    S('B', { ...AGENT, parentAgentId: 'A' }),
  ];
  const positions = agentTreePositions(nodes, [], { origin: ORIGIN });
  assert.equal(positions.A.y, positions.B.y, 'cycle members share the root row');
  assert.ok(positions.A.x !== positions.B.x, 'never stacked on one point');
  assertNoOverlap16(positions, nodes);
});

test('A10: compact: subagent row sits right below main (no slack gap)', () => {
  const nodes = [S('M', { agentKind: 'main' }), S('S1', AGENT)];
  const edges = [E('M', 'S1')];
  const positions = agentTreePositions(nodes, edges, { origin: ORIGIN });
  // main bottom 50 + gapY 48 = 98 — exactly one gap, nothing extra.
  assert.equal(positions.S1.y, 98, 'subagent row advances by main height + gapY only');
  assertNoOverlap16(positions, nodes);
});

test('A11: defaults pinned: origin {260,220} centers a lone main agent there', () => {
  const positions = agentTreePositions([S('M', { agentKind: 'main' })], [], {});
  // origin.x anchors the CENTER (width 100 -> top-left 210); origin.y is the
  // band top = the agent's top when no assets exist.
  assert.deepEqual(positions.M, { x: 210, y: 220 }, 'default origin centers main at {260,220}');
});
