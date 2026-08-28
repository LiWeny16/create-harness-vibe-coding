import test from 'node:test';
import assert from 'node:assert/strict';
import { tidyPositions, GRAPH_SLOT_W, GRAPH_SLOT_H } from '../graph-layout.mjs';

// Tidy full-graph layout contract (AC-003): hierarchical re-layout driven by
// EDGE DIRECTION (not parentNodeId), deterministic, zero overlaps for cyclic /
// multi-component / isolated graphs, docked pairs glued.
//
// Pinned API (W1 synthesis; implementers add tidyPositions to graph-layout.mjs):
//   tidyPositions(nodes, edges, opts)
//     nodes: Array<{id, width?, height?}>   size fallback 280x180 (GRAPH_SLOT_W/H)
//     edges: Array<{from, to, direction?}>  'source-to-target' | 'bidirectional'
//                                           (default 'source-to-target')
//     opts: {
//       origin?: {x, y},        default {x: 260, y: 220}
//       gapX?: number,          default 420
//       gapY?: number,          default 140
//       parentNodeId?: string,  optional root anchor (unused by layer order)
//       dockedPairs?: Array<{aId, bId, offset: {x, y}}>
//         // b is docked to a; output must satisfy EXACTLY:
//         //   positions[b] = { x: positions[a].x + offset.x, y: positions[a].y + offset.y }
//     }
//   returns {[nodeId]: {x, y}} — every input node placed exactly once;
//   deterministic (same input -> deep-equal output).
//
// Rects use node width/height when given, else GRAPH_SLOT_W/GRAPH_SLOT_H.
// AC-003 minimum clearance between any two rects: 16px.

const DEFAULT_ORIGIN = { x: 260, y: 220 };
const DEFAULT_GAP = { x: 420, y: 140 };

// Minimum pairwise rect gap across all nodes; negative when any pair overlaps.
function minRectGap(positions, nodes) {
  const rects = nodes.map(node => {
    const p = positions[node.id];
    assert.ok(p, `tidyPositions must place ${node.id}`);
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
  assert.ok(
    gap >= 16,
    `AC-003: all rects must keep >= 16px clearance (min gap was ${gap})`,
  );
}

test('T1 (AC-003) chain A->B->C is layered by edge direction and deterministic', () => {
  const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  const edges = [
    { from: 'A', to: 'B', direction: 'source-to-target' },
    { from: 'B', to: 'C', direction: 'source-to-target' },
  ];
  const first = tidyPositions(nodes, edges, {});
  const second = tidyPositions(nodes, edges, {});
  assert.deepEqual(second, first, 'deterministic: same input -> same output');

  const ids = Object.keys(first).sort();
  assert.deepEqual(ids, ['A', 'B', 'C'], 'every node must be placed exactly once');
  assert.ok(
    first.A.y < first.B.y && first.B.y < first.C.y,
    `layers ordered by edge direction: A.y=${first.A.y} < B.y=${first.B.y} < C.y=${first.C.y}`,
  );
  assertNoOverlap16(first, nodes);
});

test('T2 (AC-003) bidirectional edge keeps both nodes on the same layer', () => {
  const nodes = [{ id: 'A' }, { id: 'B' }];
  const edges = [{ from: 'A', to: 'B', direction: 'bidirectional' }];
  const positions = tidyPositions(nodes, edges, {});
  assert.equal(
    positions.A.y,
    positions.B.y,
    'a bidirectional edge imposes no layer order, so both nodes share one layer',
  );
  assert.notEqual(positions.A.x, positions.B.x, 'same-layer nodes are side by side');
  assertNoOverlap16(positions, nodes);
});

test('T3 (AC-003) cyclic graph A->B->C->A: all nodes placed, no overlaps, deterministic', () => {
  const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  const edges = [
    { from: 'A', to: 'B' },
    { from: 'B', to: 'C' },
    { from: 'C', to: 'A' },
  ];
  const first = tidyPositions(nodes, edges, {});
  const second = tidyPositions(nodes, edges, {});
  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first).sort(), ['A', 'B', 'C'], 'cycle back-edges must not drop nodes');
  assertNoOverlap16(first, nodes);
});

test('T4 (AC-003) multi-component + isolated graphs: internal chain order kept, no overlaps', () => {
  const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }, { id: 'E' }];
  const edges = [
    { from: 'A', to: 'B' },
    { from: 'C', to: 'D' },
  ];
  const positions = tidyPositions(nodes, edges, {});
  assert.deepEqual(Object.keys(positions).sort(), ['A', 'B', 'C', 'D', 'E']);
  assert.ok(positions.A.y < positions.B.y, 'chain A->B keeps its layer order');
  assert.ok(positions.C.y < positions.D.y, 'chain C->D keeps its layer order');
  assertNoOverlap16(positions, nodes);
});

test('T5 (AC-003) size variance: a 560x358 node never overlaps a default-size neighbor', () => {
  const nodes = [
    { id: 'A', width: 560, height: 358 },
    { id: 'B' },
  ];
  const edges = [{ from: 'A', to: 'B' }];
  const positions = tidyPositions(nodes, edges, {});
  assert.ok(positions.A.y < positions.B.y, 'chain order kept with mixed sizes');
  assertNoOverlap16(positions, nodes);
});

test('T6 (AC-003) docked pairs are glued: relative offset preserved exactly', () => {
  const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  const edges = [{ from: 'A', to: 'C' }];
  // y-offset 196 = one node height (180) + 16px clearance, so the glued pair
  // itself also satisfies the min-gap rule (the no-overlap contract applies
  // between layout units; a docked pair is one unit).
  const dockedPairs = [{ aId: 'A', bId: 'B', offset: { x: 12, y: 196 } }];
  const positions = tidyPositions(nodes, edges, { dockedPairs });
  // Pinned dockedPairs shape: positions[b] = positions[a] + offset exactly.
  assert.equal(positions.B.x, positions.A.x + 12, 'docked pair keeps its x offset');
  assert.equal(positions.B.y, positions.A.y + 196, 'docked pair keeps its y offset');
  assertNoOverlap16(positions, nodes);
});

test('T7 (AC-003) defaults: opts optional, plain chain still ordered and clean', () => {
  const nodes = [{ id: 'X' }, { id: 'Y' }];
  const edges = [{ from: 'X', to: 'Y' }];
  const positions = tidyPositions(nodes, edges);
  assert.ok(positions.X.y < positions.Y.y, 'default origin/gap still order the chain');
  assertNoOverlap16(positions, nodes);
});

test('T8 (AC-003) opts.origin and opts.gapY are honored', () => {
  const nodes = [{ id: 'A' }, { id: 'B' }];
  const edges = [{ from: 'A', to: 'B' }];
  const opts = { origin: { x: 0, y: 0 }, gapX: 300, gapY: 400 };
  const positions = tidyPositions(nodes, edges, opts);
  assert.deepEqual(
    positions.A,
    { x: 0, y: 0 },
    'first layer starts at opts.origin',
  );
  assert.equal(
    positions.B.y,
    0 + 400,
    'layer rows advance by opts.gapY',
  );
  assertNoOverlap16(positions, nodes);
});

test('T9 (AC-003) defaults match the pinned constants', () => {
  // Locks the documented defaults so server.mjs GRAPH_LAYOUT_DEFAULTS stays in
  // sync with the unit API.
  const nodes = [{ id: 'A' }];
  const positions = tidyPositions(nodes, [], {});
  assert.deepEqual(positions.A, DEFAULT_ORIGIN, 'origin defaults to {260,220}');
  assert.ok(DEFAULT_GAP.x >= GRAPH_SLOT_W + 16 && DEFAULT_GAP.y >= 16, 'default gaps keep clearance');
});

// ── W5 review pins (task-optimize-graph-layout) ──────────────────────────────
// The four cases below pin W4 review findings MED-3 / MED-4 / LOW-9. All are
// RED against the current engine and must go GREEN with the W5 fix wave:
//   T10 (MED-3): a top-docked capsule (negative y offset) extends ABOVE its
//     anchor; the anchor row must advance enough that the glued pair's union
//     clears the row above.
//   T11 (MED-4a): chained docks (B is A's slave AND C's anchor) must be laid
//     out as one glued chain — every node placed, glue exact, no overlaps.
//   T12 (MED-4b): an A<->B dock cycle must place both nodes, never overlap,
//     and stay deterministic.
//   T13 (LOW-9): opts.gapX below the 16px minimum clearance must be clamped.

test('T10 (AC-003/MED-3) top-docked capsule (negative offset) never overlaps the row above', () => {
  // TALL (600 tall) on the row above; A anchors a capsule docked 600px UP
  // (offset y:-600). The pair's union bbox reaches from A.y-600 to A.y+180,
  // so the anchor row must advance for that upward extent: B must clear TALL
  // by >= 16px.
  const nodes = [
    { id: 'TALL', width: 280, height: 600 },
    { id: 'A' },
    { id: 'B' },
  ];
  const edges = [{ from: 'TALL', to: 'A', direction: 'source-to-target' }];
  const dockedPairs = [{ aId: 'A', bId: 'B', offset: { x: 0, y: -600 } }];
  const positions = tidyPositions(nodes, edges, { dockedPairs });
  assert.deepEqual(Object.keys(positions).sort(), ['A', 'B', 'TALL'], 'every node placed exactly once');
  assert.equal(positions.B.x, positions.A.x, 'docked pair keeps its x offset');
  assert.equal(positions.B.y, positions.A.y - 600, 'docked pair keeps its y offset');
  assertNoOverlap16(positions, nodes);
});

test('T11 (AC-003/MED-4a) chained docks (slave-as-anchor) place all nodes with no overlaps', () => {
  // Chain A -> B -> C: B is A's dock slave AND the anchor of C's pair.
  // The chain must behave as ONE glued unit (extent 196+196+180 tall), so a
  // node on the row below the anchor (X via edge A->X) never collides with C.
  const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'X' }];
  const edges = [{ from: 'A', to: 'X', direction: 'source-to-target' }];
  const dockedPairs = [
    { aId: 'A', bId: 'B', offset: { x: 0, y: 196 } },
    { aId: 'B', bId: 'C', offset: { x: 0, y: 196 } },
  ];
  const positions = tidyPositions(nodes, edges, { dockedPairs });
  assert.deepEqual(Object.keys(positions).sort(), ['A', 'B', 'C', 'X'], 'every node placed exactly once');
  // Glue relations stay exact wherever the chain is resolvable.
  assert.equal(positions.B.x, positions.A.x, 'chain link 1 keeps its x offset');
  assert.equal(positions.B.y, positions.A.y + 196, 'chain link 1 keeps its y offset');
  assert.equal(positions.C.x, positions.B.x, 'chain link 2 keeps its x offset');
  assert.equal(positions.C.y, positions.B.y + 196, 'chain link 2 keeps its y offset');
  assertNoOverlap16(positions, nodes);
});

test('T12 (AC-003/MED-4b) dock cycle A<->B: both placed, no overlap, deterministic', () => {
  // Two dock links that agree on the same geometry (B = A + (300,0) and
  // A = B + (-300,0)) must resolve deterministically instead of collapsing
  // both nodes onto one spot.
  const nodes = [{ id: 'A' }, { id: 'B' }];
  const dockedPairs = [
    { aId: 'A', bId: 'B', offset: { x: 300, y: 0 } },
    { aId: 'B', bId: 'A', offset: { x: -300, y: 0 } },
  ];
  const first = tidyPositions(nodes, [], { dockedPairs });
  const second = tidyPositions(nodes, [], { dockedPairs });
  assert.deepEqual(second, first, 'deterministic: same input -> same output');
  assert.deepEqual(Object.keys(first).sort(), ['A', 'B'], 'both nodes placed exactly once');
  assertNoOverlap16(first, nodes);
});

test('T13 (AC-003/LOW-9) gapX below the 16px minimum clearance is clamped', () => {
  // opts.gapX = 4 would let two same-row units sit only 4px apart; the engine
  // must clamp the effective clearance so minRectGap never drops below 16.
  const nodes = [{ id: 'A' }, { id: 'B' }];
  const edges = [{ from: 'A', to: 'B', direction: 'bidirectional' }];
  const positions = tidyPositions(nodes, edges, { gapX: 4 });
  assertNoOverlap16(positions, nodes);
});
