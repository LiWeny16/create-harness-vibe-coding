import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoPlaceNode,
  layeredTreePositions,
  GRAPH_SLOT_W,
  GRAPH_SLOT_H,
  GRAPH_ORIGIN,
} from '../graph-layout.mjs';

// Occupancy-aware auto-layout contract: new auto-placed nodes never overlap
// any existing node (auto or dragged); children sit below their parents; the
// full-graph relayout is a deterministic layered tree.

test('G1 sequential auto-placement never overlaps (20 nodes)', () => {
  const positions = {};
  const placed = [];
  for (let i = 0; i < 20; i++) {
    const pos = autoPlaceNode(positions, {});
    placed.push(pos);
    positions[`n-${i}`] = pos;
  }
  const seen = new Set();
  for (const { x, y } of placed) {
    const key = `${x},${y}`;
    assert.ok(!seen.has(key), `duplicate slot ${key}`);
    seen.add(key);
  }
});

test('G2 children land on the row below the parent, near the parent column', () => {
  const parent = { x: GRAPH_ORIGIN.x + 2 * GRAPH_SLOT_W, y: GRAPH_ORIGIN.y };
  const child1 = autoPlaceNode({ parent }, { parent });
  assert.equal(child1.y, GRAPH_ORIGIN.y + GRAPH_SLOT_H);
  assert.equal(child1.x, parent.x, 'first child takes the parent column');
  const child2 = autoPlaceNode({ parent, child1 }, { parent });
  assert.equal(child2.y, child1.y);
  assert.equal(Math.abs(child2.x - parent.x), GRAPH_SLOT_W, 'second child takes the adjacent column');
});

test('G3 a dragged node occupying a cell is avoided', () => {
  const dragged = { x: GRAPH_ORIGIN.x, y: GRAPH_ORIGIN.y };
  const pos = autoPlaceNode({ dragged }, {});
  assert.notDeepEqual(pos, dragged);
  // The first free root slot with col 0 taken is the next column.
  assert.equal(pos.x, GRAPH_ORIGIN.x + GRAPH_SLOT_W);
  assert.equal(pos.y, GRAPH_ORIGIN.y);
});

test('G4 layered tree: roots side by side, children below, no collisions', () => {
  const nodes = [
    { nodeId: 'root-a' },
    { nodeId: 'child-a1', parentNodeId: 'root-a' },
    { nodeId: 'child-a2', parentNodeId: 'root-a' },
    { nodeId: 'grand-a1', parentNodeId: 'child-a1' },
    { nodeId: 'root-b' },
    { nodeId: 'child-b1', parentNodeId: 'root-b' },
  ];
  const positions = layeredTreePositions(nodes, {});
  const seen = new Set();
  for (const [id, { x, y }] of Object.entries(positions)) {
    assert.ok(!seen.has(`${x},${y}`), `collision at ${x},${y} for ${id}`);
    seen.add(`${x},${y}`);
  }
  assert.equal(positions['root-a'].y, positions['root-b'].y, 'roots share row 0');
  assert.ok(positions['root-b'].x > positions['root-a'].x, 'roots side by side');
  assert.equal(positions['child-a1'].y, positions['root-a'].y + GRAPH_SLOT_H, 'children one row below');
  assert.equal(positions['child-a2'].y, positions['root-a'].y + GRAPH_SLOT_H);
  assert.equal(positions['grand-a1'].y, positions['root-a'].y + 2 * GRAPH_SLOT_H, 'grandchildren two rows below');
  // The two children are centered under the root's x.
  const midX = (positions['child-a1'].x + positions['child-a2'].x) / 2;
  assert.equal(midX, positions['root-a'].x, 'children block centered under parent');
});

test('G5 layered tree is deterministic', () => {
  const nodes = [
    { nodeId: 'd1' },
    { nodeId: 'd2', parentNodeId: 'd1' },
    { nodeId: 'd3', parentNodeId: 'd1' },
  ];
  const first = layeredTreePositions(nodes, {});
  const second = layeredTreePositions(nodes, {});
  assert.deepEqual(first, second);
});
