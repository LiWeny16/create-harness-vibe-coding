// graph-layout.mjs
//
// Occupancy-aware auto-layout for the workflow graph. Two entry points:
// - autoPlaceNode(): a free slot for ONE new node — placed near its parent
//   (row below, columns scanning outward) or on the root row when parentless.
//   Guarantees a new auto-placed node never overlaps ANY existing node,
//   including manually dragged ones.
// - layeredTreePositions(): full-graph relayout — layered tree with subtree
//   widths (children centered under their parent), roots side by side on the
//   top row, every subtree in its own column block. Deterministic: same
//   input always yields the same output.

export const GRAPH_SLOT_W = 280;
export const GRAPH_SLOT_H = 180;
export const GRAPH_ORIGIN = { x: 120, y: 120 };
const MAX_SCAN_COLS = 16;
const MAX_SCAN_ROWS = 24;
const MIN_CLEARANCE = 16;

// Per-kind visual sizes (HIGH-1): clearance is computed against the REAL
// rendered extents, not the 280x180 layout slot. Agent nodes render at
// 560x358 (client TERMINAL_NODE_W/H); every other kind uses the slot size.
// Keyed by graph node kind; a node's agentKind marks an agent node.
export const NODE_KIND_SIZES = Object.freeze({
  'terminal-session': { w: 560, h: 358 },
  agent: { w: 560, h: 358 },
});

export function nodeVisualSize(node = {}) {
  const kind = String(node?.kind || '').toLowerCase();
  const agentKind = String(node?.agentKind || '').toLowerCase();
  const sized = NODE_KIND_SIZES[kind]
    || ((agentKind === 'main' || agentKind === 'subagent') ? NODE_KIND_SIZES.agent : null);
  return sized || { w: GRAPH_SLOT_W, h: GRAPH_SLOT_H };
}

function slotX(col) {
  return GRAPH_ORIGIN.x + col * GRAPH_SLOT_W;
}
function slotY(row) {
  return GRAPH_ORIGIN.y + row * GRAPH_SLOT_H;
}

// True when a rect at (x, y) sized w x h keeps >= `gap` clearance from every
// existing rect in `rects` (AABB separation along x or y).
function rectsClearAt(x, y, w, h, rects, gap) {
  for (const rect of rects || []) {
    if (!rect || !Number.isFinite(Number(rect.x)) || !Number.isFinite(Number(rect.y))) continue;
    const rw = Number.isFinite(Number(rect.w)) ? Number(rect.w) : GRAPH_SLOT_W;
    const rh = Number.isFinite(Number(rect.h)) ? Number(rect.h) : GRAPH_SLOT_H;
    if (
      x - gap < Number(rect.x) + rw
      && x + w + gap > Number(rect.x)
      && y - gap < Number(rect.y) + rh
      && y + h + gap > Number(rect.y)
    ) return false;
  }
  return true;
}

// A cell is occupied when any existing node center lands inside the cell's
// rectangle. Auto-placed nodes sit exactly on cells, so two auto nodes can
// never share a cell; a dragged node is honored when its center intersects.
function cellOccupied(row, col, existingPositions) {
  const cx = slotX(col);
  const cy = slotY(row);
  for (const pos of Object.values(existingPositions || {})) {
    if (!pos || !Number.isFinite(Number(pos.x)) || !Number.isFinite(Number(pos.y))) continue;
    if (Math.abs(Number(pos.x) - cx) < GRAPH_SLOT_W / 2 && Math.abs(Number(pos.y) - cy) < GRAPH_SLOT_H / 2) {
      return true;
    }
  }
  return false;
}

function firstFreeOnRow(row, startCol, existingPositions) {
  // Scan from startCol outward (startCol, startCol-1, startCol+1, ...) so
  // siblings cluster around the parent's column.
  for (let span = 0; span < MAX_SCAN_COLS; span += 1) {
    const cols = span === 0 ? [startCol] : [startCol - span, startCol + span];
    for (const col of cols) {
      if (col < 0) continue;
      if (!cellOccupied(row, col, existingPositions)) return col;
    }
  }
  return null;
}

// Finds the first free slot for a new node. With a parent position, prefers
// the row directly below the parent (scanned outward around the parent's
// column), then falls back to row-by-row scanning. Parentless nodes take the
// first free root row slot. Deterministic; never returns an occupied cell.
//
// Size-aware mode (HIGH-1): when `selfSize` and `existingRects` are supplied
// (real node extents per kind), the scan tests rect clearance instead of cell
// occupancy, so a 560x358 agent can never land at the 280px slot pitch that
// would overlap an existing agent. Without them the classic cell scan runs
// unchanged.
export function autoPlaceNode(existingPositions, { parent = null, selfSize = null, existingRects = null } = {}) {
  const positions = existingPositions || {};
  const rects = Array.isArray(existingRects) ? existingRects : null;
  if (rects) {
    const w = selfSize && Number.isFinite(Number(selfSize.w)) ? Number(selfSize.w) : GRAPH_SLOT_W;
    const h = selfSize && Number.isFinite(Number(selfSize.h)) ? Number(selfSize.h) : GRAPH_SLOT_H;
    const firstClearXOnRow = (row, startCol) => {
      for (let span = 0; span < MAX_SCAN_COLS; span += 1) {
        const cols = span === 0 ? [startCol] : [startCol - span, startCol + span];
        for (const col of cols) {
          if (col < 0) continue;
          if (rectsClearAt(slotX(col), slotY(row), w, h, rects, MIN_CLEARANCE)) return slotX(col);
        }
      }
      return null;
    };
    if (parent && Number.isFinite(Number(parent.x)) && Number.isFinite(Number(parent.y))) {
      const parentRow = Math.round((Number(parent.y) - GRAPH_ORIGIN.y) / GRAPH_SLOT_H);
      const parentCol = Math.round((Number(parent.x) - GRAPH_ORIGIN.x) / GRAPH_SLOT_W);
      const rows = [parentRow + 1, parentRow + 2, parentRow, parentRow - 1];
      for (const row of rows) {
        if (row < 0) continue;
        const x = firstClearXOnRow(row, parentCol);
        if (x !== null) return { x, y: slotY(row) };
      }
      for (let row = 0; row < MAX_SCAN_ROWS; row += 1) {
        const x = firstClearXOnRow(row, parentCol);
        if (x !== null) return { x, y: slotY(row) };
      }
      return { x: slotX(0), y: slotY(MAX_SCAN_ROWS) };
    }
    for (let row = 0; row < MAX_SCAN_ROWS; row += 1) {
      const x = firstClearXOnRow(row, 0);
      if (x !== null) return { x, y: slotY(row) };
    }
    return { x: GRAPH_ORIGIN.x, y: slotY(MAX_SCAN_ROWS) };
  }
  if (parent && Number.isFinite(Number(parent.x)) && Number.isFinite(Number(parent.y))) {
    const parentRow = Math.round((Number(parent.y) - GRAPH_ORIGIN.y) / GRAPH_SLOT_H);
    const parentCol = Math.round((Number(parent.x) - GRAPH_ORIGIN.x) / GRAPH_SLOT_W);
    const rows = [parentRow + 1, parentRow + 2, parentRow, parentRow - 1];
    for (const row of rows) {
      if (row < 0) continue;
      const col = firstFreeOnRow(row, parentCol, positions);
      if (col !== null) return { x: slotX(col), y: slotY(row) };
    }
    // Extreme fallback: absolute scan.
    for (let row = 0; row < MAX_SCAN_ROWS; row += 1) {
      const col = firstFreeOnRow(row, parentCol, positions);
      if (col !== null) return { x: slotX(col), y: slotY(row) };
    }
    return { x: slotX(0), y: slotY(MAX_SCAN_ROWS) };
  }
  for (let row = 0; row < MAX_SCAN_ROWS; row += 1) {
    const col = firstFreeOnRow(row, 0, positions);
    if (col !== null) return { x: slotX(col), y: slotY(row) };
  }
  return { x: GRAPH_ORIGIN.x, y: slotY(MAX_SCAN_ROWS) };
}

// Outward square spiral around `requested` (HIGH-1): returns the first
// top-left corner whose rect keeps >= `gap` clearance from every existing
// rect. Deterministic; bounded so the fallback always terminates.
export function findClearPosition({ requested = null, selfSize = null, existingRects = [], gap = MIN_CLEARANCE } = {}) {
  const w = selfSize && Number.isFinite(Number(selfSize.w)) ? Number(selfSize.w) : GRAPH_SLOT_W;
  const h = selfSize && Number.isFinite(Number(selfSize.h)) ? Number(selfSize.h) : GRAPH_SLOT_H;
  const rects = Array.isArray(existingRects) ? existingRects : [];
  const originX = requested && Number.isFinite(Number(requested.x)) ? Number(requested.x) : GRAPH_ORIGIN.x;
  const originY = requested && Number.isFinite(Number(requested.y)) ? Number(requested.y) : GRAPH_ORIGIN.y;
  const step = Math.max(gap, 1);
  if (rectsClearAt(originX, originY, w, h, rects, gap)) return { x: originX, y: originY };
  const MAX_RINGS = 64;
  for (let ring = 1; ring <= MAX_RINGS; ring += 1) {
    for (let k = 0; k < 2 * ring; k += 1) {
      const candidates = [
        [-ring + k, -ring], // top edge, left -> right
        [ring, -ring + k],  // right edge, top -> bottom
        [ring - k, ring],   // bottom edge, right -> left
        [-ring, ring - k],  // left edge, bottom -> top
      ];
      for (const [dx, dy] of candidates) {
        const x = originX + dx * step;
        const y = originY + dy * step;
        if (rectsClearAt(x, y, w, h, rects, gap)) return { x, y };
      }
    }
  }
  return { x: originX + (MAX_RINGS + 1) * step, y: originY + (MAX_RINGS + 1) * step };
}

function nodeIdOf(node) {
  return node.nodeId || node.id || '';
}

function parentIdOf(node, nodesById) {
  const parentNodeId = String(node.parentNodeId || '');
  const parentAgentId = String(node.parentAgentId || '');
  if (parentNodeId && nodesById.has(parentNodeId)) return parentNodeId;
  if (parentNodeId && nodesById.has(parentNodeId.replace(/^session-/, ''))) {
    // graph ids may be session-<id> while parentNodeId carries the bare id
    return parentNodeId.replace(/^session-/, '');
  }
  if (parentAgentId) {
    const bySession = nodesById.get(parentAgentId);
    if (bySession) return bySession.nodeId;
    // parentAgentId may be the bare session id while the node id is session-<id>
    const bySessionPrefixed = nodesById.get(`session-${parentAgentId}`);
    if (bySessionPrefixed) return bySessionPrefixed.nodeId;
  }
  return '';
}

// Full-graph layered tree relayout. Roots side by side on row 0; each child
// row is depth+1; every subtree occupies its own column block sized by its
// leaf count, so sibling subtrees never collide.
export function layeredTreePositions(nodes, { originX = GRAPH_ORIGIN.x, originY = GRAPH_ORIGIN.y } = {}) {
  const nodesById = new Map();
  for (const node of nodes) nodesById.set(nodeIdOf(node), { nodeId: nodeIdOf(node), node });
  const childrenOf = new Map();
  const roots = [];
  for (const node of nodes) {
    const parentId = parentIdOf(node, nodesById);
    if (!parentId) {
      roots.push(node);
      continue;
    }
    const children = childrenOf.get(parentId) || [];
    children.push(node);
    childrenOf.set(parentId, children);
  }

  const leafCount = (id) => {
    const children = childrenOf.get(id) || [];
    if (!children.length) return 1;
    return children.reduce((sum, child) => sum + leafCount(nodeIdOf(child)), 0);
  };

  const positions = {};
  let nextRootX = originX;
  const place = (node, x, depth) => {
    const id = nodeIdOf(node);
    positions[id] = { x, y: originY + depth * GRAPH_SLOT_H };
    const children = childrenOf.get(id) || [];
    const totalLeaves = children.reduce((sum, child) => sum + leafCount(nodeIdOf(child)), 0) || 1;
    // Center the children block under the parent: walk the block's left edge
    // and place each child at the center of its own sub-block.
    let childX = x - (totalLeaves * GRAPH_SLOT_W) / 2;
    for (const child of children) {
      const leaves = leafCount(nodeIdOf(child));
      place(child, childX + (leaves * GRAPH_SLOT_W) / 2, depth + 1);
      childX += leaves * GRAPH_SLOT_W;
    }
  };

  for (const root of roots) {
    place(root, nextRootX, 0);
    const leaves = leafCount(nodeIdOf(root));
    nextRootX += Math.max(leaves, 1) * GRAPH_SLOT_W;
    nextRootX += GRAPH_SLOT_W; // inter-tree gutter
  }
  return positions;
}

// Shared dock-chain machinery (extracted from tidyPositions, MED-4). Chains
// are walked into ONE glued group per anchor (anchor = first member, each
// slave = anchor + accumulated offset), so a slave that is itself another
// pair's anchor still glues exactly. Dock CYCLES (a backward walk revisits an
// id) are detected with a visited set; cycle members are laid out as SEPARATE
// units with normal clearance — never stacked on one point. The unit bbox
// covers the FULL union extents, including negative (upward / leftward)
// offsets, so row advance and column stacking reserve space.
function dockChainUnits(ids, dockedPairs, sizeOf) {
  const linkOf = new Map(); // anchorId -> { slaveId, offX, offY } (first link per anchor)
  for (const pair of dockedPairs) {
    const aId = String(pair?.aId ?? '');
    const bId = String(pair?.bId ?? '');
    if (!aId || !bId || aId === bId) continue;
    if (!sizeOf.has(aId) || !sizeOf.has(bId)) continue;
    if (linkOf.has(aId)) continue;
    linkOf.set(aId, {
      slaveId: bId,
      offX: Number.isFinite(Number(pair?.offset?.x)) ? Number(pair.offset.x) : 0,
      offY: Number.isFinite(Number(pair?.offset?.y)) ? Number(pair.offset.y) : 0,
    });
  }
  const anchorOf = new Map(); // slaveId -> anchorId
  for (const [aId, link] of linkOf) anchorOf.set(link.slaveId, aId);
  const headOf = new Map(); // chain member id -> chain head id
  const cycleIds = new Set();
  for (const id of ids) {
    if (headOf.has(id) || cycleIds.has(id)) continue;
    const seen = new Set([id]);
    let cur = id;
    while (anchorOf.has(cur)) {
      const next = anchorOf.get(cur);
      if (seen.has(next)) {
        for (const member of seen) cycleIds.add(member);
        break;
      }
      seen.add(next);
      cur = next;
    }
    if (!cycleIds.has(id)) {
      for (const member of seen) headOf.set(member, cur);
    }
  }
  const isGluedMember = (id) => headOf.has(id) && headOf.get(id) !== id && !cycleIds.has(id);

  // Chain resolution: walk forward from each head accumulating offsets.
  const chainMembersOf = new Map(); // headId -> [{ id, offX, offY }]
  const chainExtentOf = new Map(); // headId -> { up, down, left, right }
  for (const id of ids) {
    if (headOf.get(id) !== id) continue;
    const members = [{ id, offX: 0, offY: 0 }];
    const walked = new Set([id]);
    let cur = id;
    while (linkOf.has(cur)) {
      const link = linkOf.get(cur);
      if (walked.has(link.slaveId)) break; // back link inside a resolvable chain
      const previous = members[members.length - 1];
      members.push({
        id: link.slaveId,
        offX: previous.offX + link.offX,
        offY: previous.offY + link.offY,
      });
      walked.add(link.slaveId);
      cur = link.slaveId;
    }
    chainMembersOf.set(id, members);
    const anchorSize = sizeOf.get(id);
    let up = 0;
    let down = anchorSize.h;
    let left = 0;
    let right = anchorSize.w;
    for (const member of members) {
      const size = sizeOf.get(member.id);
      up = Math.min(up, member.offY);
      down = Math.max(down, member.offY + size.h);
      left = Math.min(left, member.offX);
      right = Math.max(right, member.offX + size.w);
    }
    chainExtentOf.set(id, { up, down, left, right });
  }
  const unitExtent = (id) => chainExtentOf.get(id) || null;
  return {
    isGluedMember,
    chainMembersOf,
    unitExtent,
    unitUp: (id) => (unitExtent(id) ? unitExtent(id).up : 0),
    unitDown: (id) => (unitExtent(id) ? unitExtent(id).down : sizeOf.get(id).h),
    unitLeft: (id) => (unitExtent(id) ? unitExtent(id).left : 0),
    unitRight: (id) => (unitExtent(id) ? unitExtent(id).right : sizeOf.get(id).w),
    unitWidth: (id) => unitExtent(id) ? (unitExtent(id).right - unitExtent(id).left) : sizeOf.get(id).w,
  };
}

// ── Tidy: hierarchical edge-direction relayout ──────────────────────────────
//
// tidyPositions(): full-graph relayout driven by EDGE DIRECTION: source-to-
// target edges point downward (layer(to) = layer(from) + 1), bidirectional
// edges impose no layer order (both endpoints stay on the same row). Layers
// come from longest-path relaxation over the acyclic skeleton (DFS back-edge
// exclusion), so cyclic graphs still place every node exactly once.
// Deterministic: same input always yields the same output.
//
// Rows advance by max(gapY, tallest unit on the row above + 16px clearance);
// within a row, units stack left-to-right with gapX spacing. A docked pair
// {aId, bId, offset} is a single unit: the anchor is laid out normally and
// the slave is placed EXACTLY at anchor + offset; the pair's bounding box
// drives row height and column width, so glued pairs never collide with
// anything else.

const TIDY_DEFAULT_ORIGIN = { x: 260, y: 220 };
const TIDY_DEFAULT_GAP = { x: 420, y: 140 };
const TIDY_MIN_CLEARANCE = 16;

function tidyNodeSize(node) {
  const width = Number(node?.width);
  const height = Number(node?.height);
  return {
    w: Number.isFinite(width) && width > 0 ? width : GRAPH_SLOT_W,
    h: Number.isFinite(height) && height > 0 ? height : GRAPH_SLOT_H,
  };
}

export function tidyPositions(nodes, edges = [], opts = {}) {
  const origin = (opts && typeof opts === 'object' && opts.origin) || {};
  const originX = Number.isFinite(Number(origin.x)) ? Number(origin.x) : TIDY_DEFAULT_ORIGIN.x;
  const originY = Number.isFinite(Number(origin.y)) ? Number(origin.y) : TIDY_DEFAULT_ORIGIN.y;
  // LOW-9: explicit gaps below the 16px minimum clearance are clamped up.
  const gapX = Math.max(TIDY_MIN_CLEARANCE, Number.isFinite(Number(opts?.gapX)) ? Number(opts.gapX) : TIDY_DEFAULT_GAP.x);
  const gapY = Math.max(TIDY_MIN_CLEARANCE, Number.isFinite(Number(opts?.gapY)) ? Number(opts.gapY) : TIDY_DEFAULT_GAP.y);
  const dockedPairs = Array.isArray(opts?.dockedPairs) ? opts.dockedPairs : [];
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const edgeList = Array.isArray(edges) ? edges : [];

  const ids = [];
  const sizeOf = new Map();
  for (const node of nodeList) {
    const id = String(node?.id ?? '');
    if (!id || sizeOf.has(id)) continue;
    ids.push(id);
    sizeOf.set(id, tidyNodeSize(node));
  }

  // Only source-to-target edges constrain layering.
  const dagEdges = [];
  for (const edge of edgeList) {
    const from = String(edge?.from ?? '');
    const to = String(edge?.to ?? '');
    const direction = String(edge?.direction || 'source-to-target');
    if (!from || !to || direction === 'bidirectional') continue;
    if (!sizeOf.has(from) || !sizeOf.has(to)) continue;
    dagEdges.push({ from, to });
  }

  // Docked pairs (MED-4): shared chain machinery — glued groups, cycle
  // detection, and per-unit bbox extents all live in dockChainUnits.
  const dock = dockChainUnits(ids, dockedPairs, sizeOf);
  const isGluedMember = dock.isGluedMember;

  // Longest-path layering: DFS over the input-ordered skeleton, excluding
  // back edges so cycles cannot inflate layers or drop nodes.
  const adjacency = new Map(ids.map((id) => [id, []]));
  for (const edge of dagEdges) adjacency.get(edge.from).push(edge.to);
  const color = new Map(ids.map((id) => [id, 0])); // 0 unvisited, 1 in stack, 2 done
  const backEdges = new Set();
  const finishOrder = [];
  const visit = (id) => {
    color.set(id, 1);
    for (const next of adjacency.get(id)) {
      if (color.get(next) === 1) {
        backEdges.add(`${id}\x00${next}`);
        continue;
      }
      if (color.get(next) === 2) continue;
      visit(next);
    }
    color.set(id, 2);
    finishOrder.push(id);
  };
  for (const id of ids) {
    if (color.get(id) === 0) visit(id);
  }
  const forwardFrom = new Map(ids.map((id) => [id, []]));
  for (const edge of dagEdges) {
    if (backEdges.has(`${edge.from}\x00${edge.to}`)) continue;
    forwardFrom.get(edge.from).push(edge.to);
  }
  const layerOf = new Map(ids.map((id) => [id, 0]));
  for (let i = finishOrder.length - 1; i >= 0; i -= 1) {
    const id = finishOrder[i];
    for (const next of forwardFrom.get(id)) {
      const candidate = layerOf.get(id) + 1;
      if (candidate > layerOf.get(next)) layerOf.set(next, candidate);
    }
  }

  // Rows: input order per layer; glued chain members are excluded (placed
  // with their anchor). Cycle members are ordinary units.
  const rows = [];
  for (const id of ids) {
    if (isGluedMember(id)) continue;
    const layer = layerOf.get(id);
    if (!Array.isArray(rows[layer])) rows[layer] = [];
    rows[layer].push(id);
  }
  for (let layer = 0; layer < rows.length; layer += 1) {
    if (!Array.isArray(rows[layer])) rows[layer] = [];
  }

  const { chainMembersOf, unitUp, unitDown, unitLeft, unitRight, unitWidth } = dock;

  // Row advance (MED-3): each row clears the row above by >= 16px even when a
  // unit on the current row extends ABOVE its anchor y (negative dock
  // offsets), and the gapY floor is preserved.
  const rowY = [originY];
  for (let layer = 1; layer < rows.length; layer += 1) {
    let prevBottom = 0;
    for (const id of rows[layer - 1]) prevBottom = Math.max(prevBottom, unitDown(id));
    let upward = 0;
    for (const id of rows[layer]) upward = Math.max(upward, -unitUp(id));
    rowY[layer] = Math.max(
      rowY[layer - 1] + gapY,
      rowY[layer - 1] + prevBottom + TIDY_MIN_CLEARANCE + upward,
    );
  }

  const positions = {};
  for (let layer = 0; layer < rows.length; layer += 1) {
    let cursor = originX;
    let rowRight = -Infinity;
    for (const id of rows[layer]) {
      // A unit whose union extends LEFT of its anchor x must still clear the
      // previous unit's right edge by >= gapX.
      const x = Math.max(cursor, rowRight + gapX - unitLeft(id));
      positions[id] = { x, y: rowY[layer] };
      rowRight = Math.max(rowRight, x + unitRight(id));
      cursor = x + unitWidth(id) + gapX;
    }
  }

  // Glue: positions[slave] = positions[anchor] + offset, exactly, along the
  // whole chain (MED-4).
  for (const [headId, members] of chainMembersOf) {
    const headPosition = positions[headId];
    if (!headPosition) continue;
    for (const member of members) {
      if (member.id === headId) continue;
      positions[member.id] = { x: headPosition.x + member.offX, y: headPosition.y + member.offY };
    }
  }
  // Defensive: every input node must be placed exactly once.
  for (const id of ids) {
    if (positions[id]) continue;
    positions[id] = { x: originX, y: originY + rows.length * gapY };
  }
  return positions;
}

// ── Agent-tree compact layout (task-agent-tree-layout, round 2) ─────────────
//
// agentTreePositions(): agent-centric auto-layout:
//   - main agent = core anchor, centered (origin.x is its CENTER x; origin.y
//     is the TOP of its asset band);
//   - subagents form an agent TREE below main (parenting: explicit
//     parentAgentId > first edge to another agent > main; cycle-guarded so
//     loops degrade to the root row);
//   - non-agent ("scattered") nodes form a compact MATRIX band ABOVE their
//     owner (band per owner; unowned nodes band above main; matrix columns =
//     clamp(ceil(sqrt(n)), 1, 6), row-major by id);
//   - layout NEVER creates or modifies edges — positions only;
//   - docked pairs glued exactly via the shared dock-chain machinery;
//   - deterministic; every input node placed exactly once; >= 16px clearance.
//
// No main agent -> flat fallback: all agents one root row centered on the
// origin, all unowned assets one matrix band above, centered.

const AGENT_TREE_DEFAULT_ORIGIN = { x: 260, y: 220 };
const AGENT_TREE_DEFAULT_GAP = { x: 64, y: 48 };
const AGENT_TREE_MIN_CLEARANCE = 16;

function agentNodeShape(node) {
  const kind = String(node?.agentKind || '').toLowerCase();
  return kind === 'main' || kind === 'subagent';
}

export function agentTreePositions(nodes, edges = [], opts = {}) {
  const origin = (opts && typeof opts === 'object' && opts.origin) || {};
  const originX = Number.isFinite(Number(origin.x)) ? Number(origin.x) : AGENT_TREE_DEFAULT_ORIGIN.x;
  const originY = Number.isFinite(Number(origin.y)) ? Number(origin.y) : AGENT_TREE_DEFAULT_ORIGIN.y;
  const gapX = Math.max(AGENT_TREE_MIN_CLEARANCE, Number.isFinite(Number(opts?.gapX)) ? Number(opts.gapX) : AGENT_TREE_DEFAULT_GAP.x);
  const gapY = Math.max(AGENT_TREE_MIN_CLEARANCE, Number.isFinite(Number(opts?.gapY)) ? Number(opts.gapY) : AGENT_TREE_DEFAULT_GAP.y);
  const dockedPairs = Array.isArray(opts?.dockedPairs) ? opts.dockedPairs : [];
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const edgeList = Array.isArray(edges) ? edges : [];

  const ids = [];
  const sizeOf = new Map();
  const nodeOf = new Map();
  for (const node of nodeList) {
    const id = String(node?.id ?? '');
    if (!id || sizeOf.has(id)) continue;
    ids.push(id);
    sizeOf.set(id, tidyNodeSize(node));
    nodeOf.set(id, node);
  }

  const dock = dockChainUnits(ids, dockedPairs, sizeOf);
  const gluedSlave = new Set();
  for (const id of ids) if (dock.isGluedMember(id)) gluedSlave.add(id);

  // Agents + the main anchor (first main by input order).
  const agentIds = ids.filter((id) => agentNodeShape(nodeOf.get(id)));
  const mainId = agentIds.find((id) => String(nodeOf.get(id)?.agentKind || '').toLowerCase() === 'main') || '';

  // Edge adjacency (both directions) — parenting/ownership only.
  const neighborsOf = new Map(ids.map((id) => [id, []]));
  for (const edge of edgeList) {
    const from = String(edge?.from ?? '');
    const to = String(edge?.to ?? '');
    if (!from || !to || !sizeOf.has(from) || !sizeOf.has(to)) continue;
    neighborsOf.get(from).push(to);
    neighborsOf.get(to).push(from);
  }

  // Raw agent parent: explicit parentAgentId > first agent neighbor > main.
  const rawParentOf = new Map();
  for (const id of agentIds) {
    if (id === mainId) { rawParentOf.set(id, ''); continue; }
    const pid = String(nodeOf.get(id)?.parentAgentId || '');
    if (pid && pid !== id && agentIds.includes(pid)) { rawParentOf.set(id, pid); continue; }
    const neighbor = (neighborsOf.get(id) || []).find((n) => n !== id && agentIds.includes(n));
    if (neighbor) { rawParentOf.set(id, neighbor); continue; }
    rawParentOf.set(id, mainId);
  }
  // Cycle guard: following the parent chain must never revisit an id; loops
  // degrade to the root row.
  const parentOf = new Map();
  for (const id of agentIds) {
    const direct = rawParentOf.get(id) || '';
    if (!direct) { parentOf.set(id, ''); continue; }
    const seen = new Set([id]);
    let cur = direct;
    let cycle = false;
    while (cur && sizeOf.has(cur)) {
      if (seen.has(cur)) { cycle = true; break; }
      seen.add(cur);
      cur = rawParentOf.get(cur) || '';
    }
    parentOf.set(id, cycle ? '' : direct);
  }

  // Asset owner: parentAgentId > parentNodeId chain > first agent neighbor >
  // main; unowned (no main) assets share the flat top band.
  const ownerOf = new Map();
  for (const id of ids) {
    if (agentIds.includes(id) || gluedSlave.has(id)) continue;
    let owner = '';
    const pid = String(nodeOf.get(id)?.parentAgentId || '');
    if (pid && pid !== id && agentIds.includes(pid)) owner = pid;
    if (!owner) {
      const seen = new Set([id]);
      let cur = String(nodeOf.get(id)?.parentNodeId || '');
      while (cur && sizeOf.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        if (agentIds.includes(cur)) { owner = cur; break; }
        cur = String(nodeOf.get(cur)?.parentNodeId || '');
      }
    }
    if (!owner) {
      const neighbor = (neighborsOf.get(id) || []).find((n) => agentIds.includes(n));
      if (neighbor) owner = neighbor;
    }
    ownerOf.set(id, owner || mainId);
  }

  // Matrix bands: compact grid per owner, rows centered on the owner's x.
  const buildBand = (items) => {
    const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!sorted.length) return { w: 0, h: 0, rows: [] };
    const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(sorted.length))));
    const rows = [];
    for (let i = 0; i < sorted.length; i += cols) rows.push(sorted.slice(i, i + cols));
    const rowGeom = rows.map((rowItems) => {
      const w = rowItems.reduce((sum, it) => sum + it.w, 0) + gapX * (rowItems.length - 1);
      const h = rowItems.reduce((max, it) => Math.max(max, it.h), 0);
      return { items: rowItems, w, h };
    });
    return {
      w: rowGeom.reduce((max, r) => Math.max(max, r.w), 0),
      h: rowGeom.reduce((sum, r) => sum + r.h, 0) + gapY * (rowGeom.length - 1),
      rows: rowGeom,
    };
  };
  const bandOf = new Map(); // ownerId -> band
  const bandItemsOf = new Map();
  for (const id of ids) {
    const owner = ownerOf.get(id);
    if (!owner) continue;
    const list = bandItemsOf.get(owner) || [];
    list.push({ id, w: sizeOf.get(id).w, h: sizeOf.get(id).h });
    bandItemsOf.set(owner, list);
  }
  for (const [owner, list] of bandItemsOf) bandOf.set(owner, buildBand(list));
  const bandSize = (id) => bandOf.get(id) || { w: 0, h: 0, rows: [] };

  // Agent tree children (sorted by id), docked slaves excluded.
  const childrenOf = new Map();
  for (const id of agentIds) childrenOf.set(id, []);
  for (const id of agentIds) {
    if (gluedSlave.has(id)) continue;
    const parent = parentOf.get(id) || '';
    if (parent && childrenOf.has(parent)) childrenOf.get(parent).push(id);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const unitW = (id) => Math.max(sizeOf.get(id).w, bandSize(id).w, dock.unitWidth(id));
  const unitDown = (id) => Math.max(sizeOf.get(id).h, dock.unitDown(id));

  // Subtree widths (bottom-up): each subtree occupies its own column block.
  const subtreeW = new Map();
  const computeSubtree = (id) => {
    if (subtreeW.has(id)) return subtreeW.get(id);
    const children = childrenOf.get(id) || [];
    const childrenW = children.length
      ? children.reduce((sum, child) => sum + computeSubtree(child), 0) + gapX * (children.length - 1)
      : 0;
    const w = Math.max(unitW(id), childrenW);
    subtreeW.set(id, w);
    return w;
  };
  for (const id of agentIds) computeSubtree(id);

  const positions = {};

  // Emitted positions are TOP-LEFT corners (the graph-map/UI convention):
  // centers are used for all centering math, then shifted by -w/2 at write.
  const placeBandRows = (band, cx, bandTop) => {
    let rowY = bandTop;
    for (const row of band.rows) {
      let itemX = cx - row.w / 2;
      for (const item of row.items) {
        positions[item.id] = { x: itemX, y: rowY };
        itemX += item.w + gapX;
      }
      rowY += row.h + gapY;
    }
  };

  const placeAgent = (id, cx, bandTop, rowY = null) => {
    const band = bandSize(id);
    const y = rowY !== null ? rowY : bandTop + band.h + (band.h > 0 ? gapY : 0);
    positions[id] = { x: cx - sizeOf.get(id).w / 2, y };
    placeBandRows(band, cx, bandTop);
    const children = childrenOf.get(id) || [];
    if (!children.length) return;
    const total = children.reduce((sum, child) => sum + subtreeW.get(child), 0) + gapX * (children.length - 1);
    const childBandTop = y + unitDown(id) + gapY;
    const rowBandH = children.reduce((max, child) => Math.max(max, bandSize(child).h), 0);
    let cursor = cx - total / 2;
    for (const child of children) {
      const childCx = cursor + subtreeW.get(child) / 2;
      placeAgent(child, childCx, childBandTop, childBandTop + rowBandH + (rowBandH > 0 ? gapY : 0));
      cursor += subtreeW.get(child) + gapX;
    }
  };

  if (mainId) {
    const rootRow = [mainId, ...agentIds.filter((a) => a !== mainId && !(parentOf.get(a) || '') && !gluedSlave.has(a)).sort()];
    const rowBandH = rootRow.reduce((max, a) => Math.max(max, bandSize(a).h), 0);
    const y = originY + rowBandH + (rowBandH > 0 ? gapY : 0);
    const total = rootRow.reduce((sum, a) => sum + subtreeW.get(a), 0) + gapX * (rootRow.length - 1);
    let cursor = originX - total / 2;
    for (const agent of rootRow) {
      const agentCx = cursor + subtreeW.get(agent) / 2;
      placeAgent(agent, agentCx, originY, y);
      cursor += subtreeW.get(agent) + gapX;
    }
  } else {
    // Flat fallback (no main): all agents one root row, unowned assets one
    // matrix band above, both centered on the origin.
    const flatItems = ids
      .filter((id) => !agentIds.includes(id) && !gluedSlave.has(id) && !ownerOf.get(id))
      .map((id) => ({ id, w: sizeOf.get(id).w, h: sizeOf.get(id).h }));
    const flatBand = buildBand(flatItems);
    placeBandRows(flatBand, originX, originY);
    const y = originY + flatBand.h + (flatBand.h > 0 ? gapY : 0);
    const rootRow = agentIds.filter((a) => !gluedSlave.has(a)).sort();
    const total = rootRow.reduce((sum, a) => sum + subtreeW.get(a), 0) + gapX * (rootRow.length - 1);
    let cursor = originX - total / 2;
    for (const agent of rootRow) {
      const agentCx = cursor + subtreeW.get(agent) / 2;
      placeAgent(agent, agentCx, originY, y);
      cursor += subtreeW.get(agent) + gapX;
    }
  }

  // Glue: positions[slave] = positions[anchor] + offset, exactly (MED-4).
  for (const [headId, members] of dock.chainMembersOf) {
    const headPosition = positions[headId];
    if (!headPosition) continue;
    for (const member of members) {
      if (member.id === headId) continue;
      positions[member.id] = { x: headPosition.x + member.offX, y: headPosition.y + member.offY };
    }
  }

  // Defensive: every input node must be placed exactly once.
  let fallbackIndex = 0;
  for (const id of ids) {
    if (positions[id]) continue;
    positions[id] = {
      x: originX + (fallbackIndex % 4) * (GRAPH_SLOT_W + gapX),
      y: originY + Math.floor(fallbackIndex / 4) * (GRAPH_SLOT_H + gapY),
    };
    fallbackIndex += 1;
  }
  return positions;
}
