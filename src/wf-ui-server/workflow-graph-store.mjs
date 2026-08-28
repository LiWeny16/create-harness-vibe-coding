import {
  assertUniqueWorkflowEdgePairs,
  loadWorkflowGraphMap,
  normalizeWorkflowGraphEdge,
  restoreWorkflowGraphNode,
  workflowEdgePairKey,
  writeWorkflowGraphMap,
} from './a2a-store.mjs';
import { deleteComponentNode, listLiveComponentNodes, restoreComponentNode } from './component-node-store.mjs';
import { deleteCapabilityNode, listCapabilityNodes, restoreCapabilityNode } from './workflow-capability-node-store.mjs';
import { deleteEventNode, listEventNodes, restoreEventNode } from './workflow-event-node-store.mjs';
import { listGoalNodes } from './workflow-goal-node-store.mjs';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function graphMapError(message, { statusCode = 400, code = 'BAD_REQUEST', details } = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

function requiredId(value, label) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw graphMapError(`workflow-graph-store: ${label} is required`, {
      statusCode: 400,
      code: 'INVALID_ID',
      details: { field: label },
    });
  }
  return text;
}

function deletedNodeIds(graph) {
  return new Set((Array.isArray(graph?.deletedNodes) ? graph.deletedNodes : [])
    .map(node => String(node?.nodeId || '').trim())
    .filter(Boolean));
}

// Resolve node ids across component ids, graph node ids, and session ids.
export function resolveWorkflowNodeId(projectRoot, graph, key) {
  const id = requiredId(key, 'nodeId');
  const componentNodes = listLiveComponentNodes(projectRoot);
  const componentIds = new Set(componentNodes.map(node => node.nodeId));
  if (componentIds.has(id)) return id;
  const eventIds = new Set(listEventNodes(projectRoot).map(node => node.nodeId));
  if (eventIds.has(id)) return id;
  const capabilityIds = new Set(listCapabilityNodes(projectRoot).map(node => node.nodeId));
  if (capabilityIds.has(id)) return id;
  const deletedIds = deletedNodeIds(graph);
  const goalIds = new Set(listGoalNodes(projectRoot).map(node => node.nodeId).filter(nodeId => !deletedIds.has(nodeId)));
  if (goalIds.has(id)) return id;
  const graphNode = (graph.nodes || []).find(node => (
    (node.nodeId || node.id) === id
    || node.sessionId === id
  ));
  if (graphNode) return graphNode.nodeId || graphNode.id;
  throw graphMapError(`Workflow node not found: ${id}`, {
    statusCode: 404,
    code: 'ENDPOINT_NOT_FOUND',
    details: { nodeId: id },
  });
}

// Verify both edge endpoints resolve to known canonical node ids.
function validateEndpoints(projectRoot, graph, fromId, toId) {
  try {
    return {
      fromId: resolveWorkflowNodeId(projectRoot, graph, fromId),
      toId: resolveWorkflowNodeId(projectRoot, graph, toId),
    };
  } catch (error) {
    if (error?.code === 'ENDPOINT_NOT_FOUND') {
      throw error;
    }
    throw graphMapError(error?.message || 'Invalid workflow edge endpoint', {
      statusCode: error?.statusCode || 400,
      code: error?.code || 'INVALID_ENDPOINT',
    });
  }
}

function normalizeEdgeDirection(value) {
  return String(value || '').trim() === 'source-to-target' ? 'source-to-target' : 'bidirectional';
}

function isAgentNodeId(graph, nodeId) {
  return (Array.isArray(graph.nodes) ? graph.nodes : []).some(node => (
    (node.nodeId || node.id) === nodeId
    && node.sessionId
  ));
}

function isGoalRelationAlias(value) {
  const relation = String(value || '').trim();
  return relation === 'goal' || relation.endsWith('/goal');
}

function normalizeEdgeRelation(projectRoot, graph, fromId, toId, relation) {
  const raw = String(relation || '').trim();
  const deletedIds = deletedNodeIds(graph);
  const goalIds = new Set(listGoalNodes(projectRoot).map(node => node.nodeId).filter(nodeId => !deletedIds.has(nodeId)));
  const touchesGoal = goalIds.has(fromId) || goalIds.has(toId);
  if (touchesGoal && (!raw || isGoalRelationAlias(raw))) return 'goal';
  if (!raw && isAgentNodeId(graph, fromId) && isAgentNodeId(graph, toId)) return 'delegation';
  return raw || 'wf-bridge';
}

// ── Graph undo/redo history (P5; Harness/tasks/task-agent-control-parity/UNDO-DESIGN.md) ──
// Slice-snapshot inverse: every graph mutation records an op whose `inverse`
// slice captures the affected elements BEFORE the mutation (the slice itself
// is the undo) and whose `forward` slice captures the AFTER state (the redo).
// Elements that did not exist before a create-type mutation are recorded with
// a `_removed: true` marker so undo removes them again. History persists in
// workflow-map.json undoStack/redoStack (server-side owned, cap GRAPH_HISTORY_LIMIT).
export const GRAPH_HISTORY_LIMIT = 50;

const HISTORY_ACTION_DEFAULT = {
  moveNode: 'agent.moveNode',
  connectNodes: 'agent.connectNodes',
  disconnectNodes: 'agent.disconnectNodes',
  updateEdge: 'agent.updateEdge',
  deleteNode: 'agent.deleteNode',
  createNode: 'agent.createNode',
};

function graphHistoryActor(actor = {}) {
  return {
    kind: actor?.kind === 'agent' ? 'agent' : 'human',
    nodeId: String(actor?.nodeId || ''),
    sessionId: String(actor?.sessionId || ''),
  };
}

function graphHistorySliceEmpty(slice = {}) {
  return (
    Object.keys(slice.positions || {}).length === 0
    && (slice.edges || []).length === 0
    && (slice.dockLinks || []).length === 0
    && (slice.nodes || []).length === 0
  );
}

// Compute the recorded stacks for one graph mutation op. Does NOT write; the
// caller merges `undoStack`/`redoStack` into its own mutation write so the op
// and the mutation land in a single version-bumped write. Returns null when
// neither slice carries content (a no-op mutation has nothing to undo).
export function recordGraphOp(projectRoot, { action = '', actor = {}, inverse = {}, forward = {} } = {}) {
  const graph = loadWorkflowGraphMap(projectRoot);
  const inverseSlice = {
    positions: inverse.positions || {},
    edges: inverse.edges || [],
    dockLinks: inverse.dockLinks || [],
    nodes: inverse.nodes || [],
  };
  const forwardSlice = {
    positions: forward.positions || {},
    edges: forward.edges || [],
    dockLinks: forward.dockLinks || [],
    nodes: forward.nodes || [],
  };
  if (graphHistorySliceEmpty(inverseSlice) && graphHistorySliceEmpty(forwardSlice)) return null;
  const op = {
    opId: `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ts: new Date().toISOString(),
    actor: graphHistoryActor(actor),
    action,
    inverse: inverseSlice,
    forward: forwardSlice,
  };
  return {
    op,
    undoStack: [...(graph.undoStack || []), op].slice(-GRAPH_HISTORY_LIMIT),
    redoStack: [],
  };
}

function graphHistoryEdgeTouches(edge, nodeId, sessionId = '') {
  const from = String(edge?.from || edge?.source || '').trim();
  const to = String(edge?.to || edge?.target || '').trim();
  return from === nodeId || to === nodeId || Boolean(sessionId && (from === sessionId || to === sessionId));
}

function stripHistoryNodeMarkers(record) {
  if (!record || typeof record !== 'object') return record;
  const { _removed, componentState, eventState, capabilityState, ...rest } = record;
  return rest;
}

function restoreNodeStateForUndo(projectRoot, node) {
  const nodeId = String(node?.nodeId || node?.id || '').trim();
  if (!nodeId) return;
  const record = { ...node, nodeId: node.nodeId || node.id };
  try {
    if (node.componentState !== undefined) {
      restoreComponentNode(projectRoot, { node: record, state: node.componentState });
    } else if (node.eventState !== undefined) {
      restoreEventNode(projectRoot, { node: record, state: node.eventState });
    } else if (node.capabilityState !== undefined) {
      restoreCapabilityNode(projectRoot, { node: record, state: node.capabilityState });
    }
  } catch {
    // State already restored or unavailable; the graph-map re-add below still applies.
  }
  try {
    restoreWorkflowGraphNode(projectRoot, nodeId);
  } catch {
    // Deleted-node record missing; applyGraphHistorySlice re-adds from the op slice.
  }
}

function removeNodeStateForUndo(projectRoot, node) {
  const nodeId = String(node?.nodeId || node?.id || '').trim();
  if (!nodeId) return;
  try { deleteComponentNode(projectRoot, nodeId); } catch { /* not a component node */ }
  try { deleteEventNode(projectRoot, nodeId); } catch { /* not an event node */ }
  try { deleteCapabilityNode(projectRoot, nodeId); } catch { /* not a capability node */ }
}

// Apply one history slice (inverse for undo, forward for redo) and persist the
// graph plus the moved stacks in a single version-guarded write.
function applyGraphHistorySlice(projectRoot, slice = {}, { undoStack, redoStack, expectedVersion } = {}) {
  // 1) Node state restores/removals live outside the graph map (component /
  //    event / capability stores); run them first so the graph-map write below
  //    loads their effect.
  for (const node of slice.nodes || []) {
    if (node?._removed) removeNodeStateForUndo(projectRoot, node);
    else restoreNodeStateForUndo(projectRoot, node);
  }

  // 2) Graph map write.
  const graph = loadWorkflowGraphMap(projectRoot);
  let nodes = graph.nodes;
  let deletedNodes = graph.deletedNodes;
  let edges = graph.edges;
  let capsuleDockLinks = graph.capsuleDockLinks;
  const positions = { ...(graph.positions || {}) };

  for (const node of slice.nodes || []) {
    const nodeId = String(node?.nodeId || node?.id || '').trim();
    if (!nodeId) continue;
    if (node._removed) {
      nodes = nodes.filter(item => String(item.nodeId || item.id || '').trim() !== nodeId);
      edges = edges.filter(edge => !graphHistoryEdgeTouches(edge, nodeId, node.sessionId));
      capsuleDockLinks = capsuleDockLinks.filter(link => !(link.nodeIds || []).includes(nodeId));
      delete positions[nodeId];
      deletedNodes = deletedNodes.filter(entry => entry.nodeId !== nodeId);
    } else if (!nodes.some(item => String(item.nodeId || item.id || '').trim() === nodeId)) {
      const record = stripHistoryNodeMarkers(node);
      nodes = [...nodes, { ...record, nodeId: record.nodeId || nodeId }];
      if (node.position && Number.isFinite(Number(node.position.x))) {
        positions[nodeId] = { x: Number(node.position.x), y: Number(node.position.y) };
      }
      deletedNodes = deletedNodes.filter(entry => entry.nodeId !== nodeId);
    }
  }

  for (const edge of slice.edges || []) {
    const edgeId = String(edge?.id || '').trim();
    if (edge?._removed) {
      if (edgeId) {
        edges = edges.filter(item => String(item.id || '').trim() !== edgeId);
      } else {
        const from = String(edge.from || edge.source || '');
        const to = String(edge.to || edge.target || '');
        edges = edges.filter(item => !(
          String(item.from || item.source || '') === from && String(item.to || item.target || '') === to
        ));
      }
    } else {
      const record = { ...edge };
      delete record._removed;
      if (edgeId && edges.some(item => String(item.id || '').trim() === edgeId)) {
        edges = edges.map(item => (String(item.id || '').trim() === edgeId ? record : item));
      } else if (edgeId) {
        edges = [...edges, record];
      }
    }
  }

  for (const link of slice.dockLinks || []) {
    const linkId = String(link?.id || '').trim();
    if (!linkId) continue;
    if (link._removed) {
      capsuleDockLinks = capsuleDockLinks.filter(item => String(item.id || '').trim() !== linkId);
    } else if (capsuleDockLinks.some(item => String(item.id || '').trim() === linkId)) {
      const record = { ...link };
      delete record._removed;
      capsuleDockLinks = capsuleDockLinks.map(item => (String(item.id || '').trim() === linkId ? record : item));
    } else {
      const record = { ...link };
      delete record._removed;
      capsuleDockLinks = [...capsuleDockLinks, record];
    }
  }

  for (const [nodeId, position] of Object.entries(slice.positions || {})) {
    if (position && Number.isFinite(Number(position.x))) positions[nodeId] = position;
  }

  const written = writeWorkflowGraphMap(projectRoot, {
    ...graph,
    version: graph.version + 1,
    nodes,
    edges,
    capsuleDockLinks,
    positions,
    deletedNodes,
    undoStack: undoStack !== undefined ? undoStack : graph.undoStack,
    redoStack: redoStack !== undefined ? redoStack : graph.redoStack,
  }, {
    expectedVersion,
    overrideHistory: true,
  });

  return {
    positions: written.positions || positions,
    edges: written.edges || edges,
    dockLinks: written.capsuleDockLinks || capsuleDockLinks,
    nodes: written.nodes || nodes,
    version: written.version,
  };
}

// Undo the most recent graph op: pop undoStack, replay the inverse slice,
// push the op onto redoStack. Empty stack is idempotent ({ok:true, applied:null}).
export function undoGraphOp(projectRoot, { expectedVersion } = {}) {
  const graph = loadWorkflowGraphMap(projectRoot);
  const stack = Array.isArray(graph.undoStack) ? graph.undoStack : [];
  if (stack.length === 0) return { ok: true, applied: null };
  const op = stack[stack.length - 1];
  const applied = applyGraphHistorySlice(projectRoot, op.inverse, {
    undoStack: stack.slice(0, -1),
    redoStack: [...(Array.isArray(graph.redoStack) ? graph.redoStack : []), op],
    expectedVersion,
  });
  return { ok: true, opId: op.opId, applied, version: applied.version };
}

// Redo the most recently undone op: pop redoStack, replay the forward slice,
// push the op back onto undoStack.
export function redoGraphOp(projectRoot, { expectedVersion } = {}) {
  const graph = loadWorkflowGraphMap(projectRoot);
  const stack = Array.isArray(graph.redoStack) ? graph.redoStack : [];
  if (stack.length === 0) return { ok: true, applied: null };
  const op = stack[stack.length - 1];
  const applied = applyGraphHistorySlice(projectRoot, op.forward, {
    undoStack: [...(Array.isArray(graph.undoStack) ? graph.undoStack : []), op].slice(-GRAPH_HISTORY_LIMIT),
    redoStack: stack.slice(0, -1),
    expectedVersion,
  });
  return { ok: true, opId: op.opId, applied, version: applied.version };
}

// Semantic connect: add an edge between two nodes with optional handle/relation metadata
export function connectNodes(projectRoot, { from, to, relation, sourceHandle, targetHandle, direction }, history = {}) {
  const graph = loadWorkflowGraphMap(projectRoot);
  const { fromId, toId } = validateEndpoints(projectRoot, graph, from, to);
  const id = `${fromId}->${toId}`;
  const normalizedDirection = normalizeEdgeDirection(direction);
  const normalizedRelation = normalizeEdgeRelation(projectRoot, graph, fromId, toId, relation);
  const pairKey = workflowEdgePairKey({ from: fromId, to: toId, direction: normalizedDirection });
  if (pairKey && graph.edges.some(edge => workflowEdgePairKey(edge) === pairKey)) {
    throw graphMapError(`Edge ${id} already exists`, {
      statusCode: 409,
      code: 'DUPLICATE_EDGE',
      details: { edgeId: id, from: fromId, to: toId, direction: normalizedDirection },
    });
  }
  const edge = {
    id,
    from: fromId,
    to: toId,
    relation: normalizedRelation,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
    direction: normalizedDirection,
  };
  const normalizedEdge = normalizeWorkflowGraphEdge(projectRoot, edge, graph.nodes);
  const recorded = recordGraphOp(projectRoot, {
    action: history.action || HISTORY_ACTION_DEFAULT.connectNodes,
    actor: history.actor,
    inverse: { edges: [{ ...normalizedEdge, _removed: true }] },
    forward: { edges: [normalizedEdge] },
  });
  writeWorkflowGraphMap(projectRoot, {
    ...graph,
    version: graph.version + 1,
    edges: [...graph.edges, normalizedEdge],
    ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
  }, { overrideHistory: Boolean(recorded) });
  return { ok: true, edge: normalizedEdge };
}

// Semantic disconnect: remove edge by id
export function disconnectNodes(projectRoot, edgeId, history = {}) {
  const graph = loadWorkflowGraphMap(projectRoot);
  const id = requiredId(edgeId, 'edgeId');
  const existing = graph.edges.find(edge => edge.id === id);
  if (!existing) {
    throw graphMapError(`Edge ${id} not found`, {
      statusCode: 404,
      code: 'EDGE_NOT_FOUND',
      details: { edgeId: id },
    });
  }
  const recorded = recordGraphOp(projectRoot, {
    action: history.action || HISTORY_ACTION_DEFAULT.disconnectNodes,
    actor: history.actor,
    inverse: { edges: [existing] },
    forward: { edges: [{ ...existing, _removed: true }] },
  });
  writeWorkflowGraphMap(projectRoot, {
    ...graph,
    version: graph.version + 1,
    edges: graph.edges.filter(edge => edge.id !== id),
    ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
  }, { overrideHistory: Boolean(recorded) });
  return { ok: true, removed: id };
}

// Read all connections for a specific node
export function readConnections(projectRoot, nodeId) {
  const graph = loadWorkflowGraphMap(projectRoot);
  const id = resolveWorkflowNodeId(projectRoot, graph, nodeId);
  const connections = graph.edges
    .map((edge) => {
      const from = edge.from || edge.source;
      const to = edge.to || edge.target;
      const isSource = from === id;
      const isTarget = to === id;
      if (!isSource && !isTarget) return null;
      return {
        edgeId: edge.id || `${from}->${to}`,
        peerNodeId: isSource ? to : from,
        endpointRole: isSource ? 'source' : 'target',
        localHandle: isSource ? edge.sourceHandle || null : edge.targetHandle || null,
        peerHandle: isSource ? edge.targetHandle || null : edge.sourceHandle || null,
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
        relation: edge.relation || 'wf-bridge',
        direction: normalizeEdgeDirection(edge.direction),
      };
    })
    .filter(Boolean);
  return { nodeId: id, connections };
}

// Update edge metadata
export function updateEdge(projectRoot, edgeId, patch, history = {}) {
  const graph = loadWorkflowGraphMap(projectRoot);
  const id = requiredId(edgeId, 'edgeId');
  if (!isPlainObject(patch)) {
    throw graphMapError('updateEdge: patch must be a plain object', {
      statusCode: 400,
      code: 'INVALID_PATCH',
      details: { edgeId: id },
    });
  }
  const existing = graph.edges.find(edge => edge.id === id);
  if (!existing) {
    throw graphMapError(`Edge ${id} not found`, {
      statusCode: 404,
      code: 'EDGE_NOT_FOUND',
      details: { edgeId: id },
    });
  }
  if (Object.keys(patch).length === 0) {
    throw graphMapError('updateEdge: at least one edge field is required', {
      statusCode: 400,
      code: 'EMPTY_UPDATE',
      details: { edgeId: id },
    });
  }
  if (patch.from !== undefined || patch.to !== undefined) {
    const resolved = validateEndpoints(
      projectRoot,
      graph,
      patch.from !== undefined ? requiredId(patch.from, 'from') : existing.from,
      patch.to !== undefined ? requiredId(patch.to, 'to') : existing.to
    );
    patch = { ...patch, from: resolved.fromId, to: resolved.toId };
  }
  const edge = normalizeWorkflowGraphEdge(projectRoot, { ...existing, ...patch, id }, graph.nodes);
  assertUniqueWorkflowEdgePairs(graph.edges.map(item => (item.id === id ? edge : item)));
  const recorded = recordGraphOp(projectRoot, {
    action: history.action || HISTORY_ACTION_DEFAULT.updateEdge,
    actor: history.actor,
    inverse: { edges: [existing] },
    forward: { edges: [edge] },
  });
  writeWorkflowGraphMap(projectRoot, {
    ...graph,
    version: graph.version + 1,
    edges: graph.edges.map(item => (item.id === id ? edge : item)),
    ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
  }, { overrideHistory: Boolean(recorded) });
  return { ok: true, edge };
}

export function moveNode(projectRoot, nodeId, position, history = {}) {
  const graph = loadWorkflowGraphMap(projectRoot);
  const id = resolveWorkflowNodeId(projectRoot, graph, nodeId);
  if (!isPlainObject(position)) {
    throw graphMapError('moveNode: position must be a plain object', {
      statusCode: 400,
      code: 'INVALID_POSITION',
      details: { nodeId: id },
    });
  }
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw graphMapError('moveNode: finite x and y are required', {
      statusCode: 400,
      code: 'INVALID_POSITION',
      details: { nodeId: id },
    });
  }
  const nextPosition = { x, y };
  const oldPosition = graph.positions?.[id] || null;
  const recorded = recordGraphOp(projectRoot, {
    action: history.action || HISTORY_ACTION_DEFAULT.moveNode,
    actor: history.actor,
    inverse: { positions: oldPosition ? { [id]: oldPosition } : {} },
    forward: { positions: { [id]: nextPosition } },
  });
  const nodes = (graph.nodes || []).map(node => (
    (node.nodeId || node.id) === id
      ? { ...node, nodeId: node.nodeId || node.id, position: nextPosition }
      : node
  ));
  const written = writeWorkflowGraphMap(projectRoot, {
    ...graph,
    version: graph.version + 1,
    nodes,
    positions: {
      ...(graph.positions || {}),
      [id]: nextPosition,
    },
    ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
  }, { overrideHistory: Boolean(recorded) });
  return { ok: true, nodeId: id, position: nextPosition, revision: written.version };
}

// Get full graph snapshot (delegates to loadWorkflowGraphMap)
export function getGraphSnapshot(projectRoot) {
  return loadWorkflowGraphMap(projectRoot);
}
