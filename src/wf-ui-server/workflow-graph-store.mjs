import { loadWorkflowGraphMap, writeWorkflowGraphMap } from './a2a-store.mjs';
import { listComponentNodes } from './component-node-store.mjs';

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

// Resolve node ids across component ids, graph node ids, and session ids.
export function resolveWorkflowNodeId(projectRoot, graph, key) {
  const id = requiredId(key, 'nodeId');
  const componentNodes = listComponentNodes(projectRoot);
  const componentIds = new Set(componentNodes.map(node => node.nodeId));
  if (componentIds.has(id)) return id;
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

// Semantic connect: add an edge between two nodes with optional handle/relation metadata
export function connectNodes(projectRoot, { from, to, relation, sourceHandle, targetHandle }) {
  const graph = loadWorkflowGraphMap(projectRoot);
  const { fromId, toId } = validateEndpoints(projectRoot, graph, from, to);
  const id = `${fromId}->${toId}`;
  const duplicate = graph.edges.some(edge => {
    const edgeFrom = edge.from || edge.source;
    const edgeTo = edge.to || edge.target;
    return edge.id === id
      || (edgeFrom === fromId && edgeTo === toId)
      || (edgeFrom === toId && edgeTo === fromId);
  });
  if (duplicate) {
    throw graphMapError(`Edge ${id} already exists`, {
      statusCode: 409,
      code: 'DUPLICATE_EDGE',
      details: { edgeId: id, from: fromId, to: toId },
    });
  }
  const edge = {
    id,
    from: fromId,
    to: toId,
    relation: relation || 'wf-bridge',
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
  };
  writeWorkflowGraphMap(projectRoot, {
    ...graph,
    version: graph.version + 1,
    edges: [...graph.edges, edge],
  });
  return { ok: true, edge };
}

// Semantic disconnect: remove edge by id
export function disconnectNodes(projectRoot, edgeId) {
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
  writeWorkflowGraphMap(projectRoot, {
    ...graph,
    version: graph.version + 1,
    edges: graph.edges.filter(edge => edge.id !== id),
  });
  return { ok: true, removed: id };
}

// Read all connections for a specific node
export function readConnections(projectRoot, nodeId) {
  const graph = loadWorkflowGraphMap(projectRoot);
  const id = resolveWorkflowNodeId(projectRoot, graph, nodeId);
  const connections = graph.edges.filter(edge => (edge.from || edge.source) === id || (edge.to || edge.target) === id);
  return { nodeId: id, connections };
}

// Update edge metadata
export function updateEdge(projectRoot, edgeId, patch) {
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
  if (patch.from !== undefined || patch.to !== undefined) {
    const resolved = validateEndpoints(
      projectRoot,
      graph,
      patch.from !== undefined ? requiredId(patch.from, 'from') : existing.from,
      patch.to !== undefined ? requiredId(patch.to, 'to') : existing.to
    );
    patch = { ...patch, from: resolved.fromId, to: resolved.toId };
  }
  const edge = { ...existing, ...patch, id };
  writeWorkflowGraphMap(projectRoot, {
    ...graph,
    version: graph.version + 1,
    edges: graph.edges.map(item => (item.id === id ? edge : item)),
  });
  return { ok: true, edge };
}

// Get full graph snapshot (delegates to loadWorkflowGraphMap)
export function getGraphSnapshot(projectRoot) {
  return loadWorkflowGraphMap(projectRoot);
}
