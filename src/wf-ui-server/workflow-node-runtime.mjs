import {
  ComponentNodeError,
  createComponentNode,
  deleteComponentNode,
  getComponentNode,
  listComponentNodes,
  componentStateRefs,
  updateComponentNode,
} from './component-node-store.mjs'
import { loadWorkflowGraphMap, removeWorkflowGraphNode, writeWorkflowGraphMap } from './a2a-store.mjs'
import { getWorkspaceMeta, workspaceMimeForPath } from './workspace-store.mjs'
import {
  deleteNodeSettings,
  getSettingsSchema,
  initNodeSettings,
  readNodeSettings,
  writeNodeSettings,
} from './workflow-node-settings-store.mjs'
import * as MarkdownNode from './workflow-node-types/markdown-node.mjs'
import * as ExcalidrawNode from './workflow-node-types/excalidraw-node.mjs'
import * as FileNode from './workflow-node-types/file-node.mjs'
import * as AgentNode from './workflow-node-types/agent-node.mjs'

export {
  ComponentNodeError,
  createComponentNode,
  deleteComponentNode,
  getComponentNode,
  listComponentNodes,
  componentStateRefs,
  updateComponentNode,
} from './component-node-store.mjs'
export { loadWorkflowGraphMap, writeWorkflowGraphMap } from './a2a-store.mjs'
export {
  deleteNodeSettings,
  getSettingsSchema,
  readNodeSettings,
  writeNodeSettings,
} from './workflow-node-settings-store.mjs'

// Action routing: "<type>.<suffix>" dispatches to the matching adapter module
// (markdown.*, excalidraw.*, file.*). Adapter handlers must export the action
// suffix as a function and are called as handler(projectRoot, nodeId, payload).
const ACTION_ADAPTERS = {
  markdown: MarkdownNode,
  excalidraw: ExcalidrawNode,
  file: FileNode,
  agent: AgentNode,
}

function normalizeSettings(type, settings) {
  const source = settings && typeof settings === 'object' ? settings : {}
  return {
    schemaId: `${type}-settings`,
    values: source.values && typeof source.values === 'object' && !Array.isArray(source.values) ? source.values : {},
    revision: Number(source.revision || 0),
  }
}

function fileMetadata(projectRoot, file = {}) {
  try {
    const meta = getWorkspaceMeta(projectRoot, file.path || '')
    return {
      exists: Boolean(meta.exists),
      stale: !meta.exists,
      needsRefresh: !meta.exists,
      staleUnknown: false,
      etag: meta.etag ?? null,
      mtime: meta.mtime ?? null,
      size: Number(meta.size || 0),
      mime: meta.mime || file.mime || workspaceMimeForPath(file.path || ''),
    }
  } catch {
    return {
      exists: null,
      stale: null,
      needsRefresh: true,
      staleUnknown: true,
      etag: null,
      mtime: null,
      size: Number(file.size || 0),
      mime: file.mime || workspaceMimeForPath(file.path || ''),
    }
  }
}

function fileSupportsText(file = {}) {
  const mime = String(file.mime || workspaceMimeForPath(file.path || '')).split(';')[0].trim().toLowerCase()
  return mime.startsWith('text/')
    || ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml'].includes(mime)
    || /\.(md|markdown|txt|csv|json|yaml|yml|log|js|mjs|jsx|ts|tsx|css|html)$/i.test(String(file.path || ''))
}

function handlesFor(type) {
  if (type === 'file') return { inputs: ['file'], outputs: ['file', 'path'] }
  if (type === 'markdown') return { inputs: ['markdown'], outputs: ['markdown', 'plainText'] }
  if (type === 'excalidraw') return { inputs: ['scene'], outputs: ['scene', 'image'] }
  return { inputs: [], outputs: [] }
}

function buildContentRef(node, state, metadata = null) {
  if (node.type === 'file') {
    const file = state.file || {}
    return {
      kind: file.source === 'user-file' ? 'user-file' : 'workspace-file',
      source: file.source || 'workspace',
      path: file.path || '',
      mime: file.mime || metadata?.mime || workspaceMimeForPath(file.path || ''),
      size: metadata && metadata.exists ? Number(metadata.size || 0) : Number(file.size || 0),
      etag: metadata?.etag ?? null,
      endpoints: {
        meta: '/api/workspace/meta',
        bytes: '/api/workspace/file',
        text: '/api/workspace/text',
      },
    }
  }
  if (node.type === 'markdown') {
    return {
      kind: 'component-state',
      statePath: node.statePath,
      revision: node.revision,
      field: 'markdown',
      mime: 'text/markdown',
    }
  }
  if (node.type === 'excalidraw') {
    return {
      kind: 'component-state',
      statePath: node.statePath,
      revision: node.revision,
      field: 'scene',
      mime: 'application/vnd.excalidraw+json',
    }
  }
  return {
    kind: 'component-state',
    statePath: node.statePath,
    revision: node.revision,
  }
}

function buildCapabilities(type, state) {
  if (type === 'file') {
    const file = state.file || {}
    return ['meta:read', 'bytes:read', ...(fileSupportsText(file) ? ['text:read'] : [])]
  }
  if (type === 'markdown') return ['state:read', 'state:update', 'markdown:append', 'markdown:replace']
  if (type === 'excalidraw') return ['state:read', 'state:update', 'excalidraw:read', 'excalidraw:update']
  return ['state:read']
}

function contentRefForResource(type, ref = {}, metadata = null) {
  if (type === 'file') {
    const file = ref.file || {}
    return {
      kind: file.source === 'user-file' ? 'user-file' : 'workspace-file',
      source: file.source || 'workspace',
      path: file.path || '',
      mime: file.mime || metadata?.mime || workspaceMimeForPath(file.path || ''),
      size: metadata && metadata.exists ? Number(metadata.size || 0) : Number(file.size || 0),
      etag: metadata?.etag ?? null,
      endpoints: {
        meta: '/api/workspace/meta',
        bytes: '/api/workspace/file',
        text: '/api/workspace/text',
      },
    }
  }
  if (type === 'markdown') {
    return {
      kind: 'component-state',
      statePath: ref.statePath,
      revision: Number(ref.revision || 0),
      field: 'markdown',
      mime: 'text/markdown',
    }
  }
  if (type === 'excalidraw') {
    return {
      kind: 'component-state',
      statePath: ref.statePath,
      revision: Number(ref.revision || 0),
      field: 'scene',
      mime: 'application/vnd.excalidraw+json',
    }
  }
  return {
    kind: 'component-state',
    statePath: ref.statePath,
    revision: Number(ref.revision || 0),
  }
}

function compareResourceRefs(componentOrder) {
  return (a, b) => {
    const created = String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    if (created !== 0) return created
    const order = (componentOrder.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER) - (componentOrder.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER)
    if (order !== 0) return order
    return String(a.nodeId).localeCompare(String(b.nodeId))
  }
}

function agentNodeId(graphNode) {
  return graphNode.nodeId || graphNode.id || `session-${graphNode.sessionId}`
}

function agentSettings(projectRoot, graphNode) {
  const nodeId = agentNodeId(graphNode)
  const stored = readNodeSettings(projectRoot, nodeId, 'agent')
  const graphRouting = graphNode.config?.outputRouting || graphNode.nodeConfig?.outputRouting || graphNode.outputRouting
  if (stored.revision === 0 && graphRouting && typeof graphRouting === 'object' && !Array.isArray(graphRouting)) {
    return {
      ...stored,
      values: {
        ...stored.values,
        outputRouting: {
          ...stored.values.outputRouting,
          ...graphRouting,
        },
      },
    }
  }
  return stored
}

function buildConnectedResourceRefs(projectRoot, nodeId, graph) {
  const refs = componentStateRefs(projectRoot)
  const componentOrder = new Map(listComponentNodes(projectRoot).map((node, index) => [node.nodeId, index]))
  return buildConnections(nodeId, graph)
    .map((connection) => {
      const ref = refs[connection.peerNodeId]
      if (!ref) return null
      const type = ref.type
      const metadata = type === 'file' ? fileMetadata(projectRoot, ref.file || {}) : null
      const fileForCapabilities = metadata ? { ...(ref.file || {}), mime: metadata.mime } : (ref.file || {})
      const resourceConnection = {
        edgeId: connection.edgeId,
        endpointRole: connection.endpointRole,
        localHandle: connection.localHandle,
        peerHandle: connection.peerHandle,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        relation: connection.relation,
        direction: connection.direction,
      }
      return {
        nodeId: connection.peerNodeId,
        kind: 'component-node',
        type,
        title: ref.title || connection.peerNodeId,
        createdAt: ref.createdAt || null,
        direction: 'bidirectional',
        endpointRole: connection.endpointRole,
        relation: connection.relation,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        connection: resourceConnection,
        connections: [resourceConnection],
        stateRef: {
          path: ref.statePath,
          revision: Number(ref.revision || 0),
        },
        contentRef: contentRefForResource(type, ref, metadata),
        capabilities: buildCapabilities(type, { file: fileForCapabilities }),
        handles: handlesFor(type),
        ...(metadata ? { metadata } : {}),
        ...(ref.file ? { file: ref.file } : {}),
      }
    })
    .filter(Boolean)
    .sort(compareResourceRefs(componentOrder))
}

function outputRoutingFor(settings, connectedResourceRefs) {
  const routing = settings?.values?.outputRouting || {}
  const enabled = Boolean(routing.markdownDefaultEnabled)
  const explicitTargetNodeId = String(routing.markdownTargetNodeId || '').trim()
  let resolvedTargetNodeId = ''
  let resolution = enabled ? 'none' : 'disabled'
  if (enabled && explicitTargetNodeId) {
    resolvedTargetNodeId = explicitTargetNodeId
    resolution = 'explicit-target'
  } else if (enabled && routing.fallback !== false) {
    const oldest = connectedResourceRefs.filter(ref => ref.type === 'markdown')[0]
    if (oldest) {
      resolvedTargetNodeId = oldest.nodeId
      resolution = 'oldest-connected-markdown'
    }
  }
  return {
    markdownDefault: {
      enabled,
      explicitTargetNodeId,
      resolvedTargetNodeId,
      resolution,
    },
  }
}

// Canonical node shape builder
function buildNodeSnapshot(node, state, settings) {
  return {
    nodeId: node.nodeId,
    kind: node.type, // markdown | excalidraw | file
    version: node.revision,
    lifecycle: 'ready',
    status: { state: 'ready', updatedAt: new Date().toISOString() },
    graph: {
      position: node.position,
      handles: (state.inputs || []).map(h => ({ id: h.id, role: 'input', type: h.type, label: h.label })),
      connections: [], // filled by getNodeContext
    },
    stateRef: { path: node.statePath, revision: node.revision },
    contentRef: buildContentRef(node, state),
    settings: normalizeSettings(node.type, settings),
    capabilities: buildCapabilities(node.type, state),
    ui: {
      previewKind: node.type,
      settingsPanel: `${node.type}-settings`,
      testId: `workflow-${node.type}-node`,
      labels: { title: node.title },
    },
  }
}

function initSettings(projectRoot, nodeId, type) {
  initNodeSettings(projectRoot, nodeId, type)
}

function asComponentNodeError(error) {
  if (error instanceof ComponentNodeError) return error
  return new ComponentNodeError(
    error && error.message ? error.message : 'Workflow node runtime error',
    { statusCode: 500, code: 'NODE_RUNTIME_ERROR' }
  )
}

function buildConnections(nodeId, graph) {
  return (Array.isArray(graph.edges) ? graph.edges : [])
    .map(edge => connectionForEdge(edge, nodeId))
    .filter(Boolean)
}

function connectionForEdge(edge, nodeId) {
  const from = edge.from || edge.source
  const to = edge.to || edge.target
  const isSource = from === nodeId
  const isTarget = to === nodeId
  if (!isSource && !isTarget) return null
  return {
    edgeId: edge.id || `${from}->${to}`,
    peerNodeId: isSource ? to : from,
    endpointRole: isSource ? 'source' : 'target',
    localHandle: isSource ? edge.sourceHandle || null : edge.targetHandle || null,
    peerHandle: isSource ? edge.targetHandle || null : edge.sourceHandle || null,
    sourceHandle: edge.sourceHandle || null,
    targetHandle: edge.targetHandle || null,
    relation: edge.relation || 'wf-bridge',
    direction: 'bidirectional',
  }
}

function buildAgentSnapshot(projectRoot, graphNode, graph) {
  const nodeId = agentNodeId(graphNode)
  const settings = agentSettings(projectRoot, graphNode)
  return {
    nodeId,
    kind: 'agent',
    version: graph.version || 1,
    lifecycle: graphNode.status === 'running' || graphNode.status === 'starting' ? 'live' : 'stopped',
    status: { state: graphNode.status || 'unknown', updatedAt: graphNode.updatedAt || new Date().toISOString() },
    sessionId: graphNode.sessionId || null,
    graph: {
      position: graph.positions?.[nodeId] || graphNode.position || { x: 0, y: 0 },
      handles: [],
      connections: buildConnections(nodeId, graph),
    },
    stateRef: { path: `Harness/a2a/nodes/${graphNode.sessionId || nodeId}`, revision: 0 },
    settings: {
      schemaId: 'agent-settings',
      values: {
        runtime: graphNode.runtime,
        agentKind: graphNode.agentKind,
        ...settings.values,
      },
      revision: settings.revision,
    },
    capabilities: ['agent.sendInput', 'agent.readOutput', 'agent.readTranscript', 'agent.start', 'agent.stop', 'agent.restart', 'agent.delete', 'agent.readContext'],
    ui: {
      previewKind: 'agent',
      settingsPanel: 'agent-settings',
      testId: 'workflow-agent-node',
      labels: { title: graphNode.label || graphNode.runtime || 'Agent' },
    },
  }
}

function findAgentGraphNode(graph, key) {
  const id = String(key || '')
  return (graph.nodes || []).find(n => (
    n.sessionId
    && (
      (n.nodeId || n.id) === id
      || n.sessionId === id
    )
  )) || null
}

function buildAgentContext(projectRoot, graphNode, graph) {
  const nodeId = agentNodeId(graphNode)
  const sessionId = graphNode.sessionId || null
  const connections = buildConnections(nodeId, graph)
  const refs = componentStateRefs(projectRoot)
  const connectedResourceRefs = buildConnectedResourceRefs(projectRoot, nodeId, graph)
  const settings = agentSettings(projectRoot, graphNode)
  const connectedPeers = connections.map(connection => {
    const ref = refs[connection.peerNodeId]
    return ref
      ? {
          nodeId: connection.peerNodeId,
          type: ref.type,
          title: ref.title,
          stateRef: { path: ref.statePath, revision: ref.revision },
          ...(ref.file ? { file: ref.file } : {}),
        }
      : { nodeId: connection.peerNodeId }
  })
  return {
    ok: true,
    node: buildAgentSnapshot(projectRoot, graphNode, graph),
    context: {
      nodeId,
      sessionId,
      graphVersion: Number(graph.version || 1),
      connectedPeers,
      componentStateRefs: refs,
      connectedResourceRefs,
      outputRouting: outputRoutingFor(settings, connectedResourceRefs),
      availableActions: [
        'agent.sendInput',
        'agent.readOutput',
        'agent.readTranscript',
        'agent.start',
        'agent.stop',
        'agent.restart',
        'agent.delete',
        'agent.readContext',
      ],
    },
  }
}

export async function listNodes(projectRoot) {
  try {
    const graph = loadWorkflowGraphMap(projectRoot)
    // Component nodes
    const componentNodes = listComponentNodes(projectRoot).map((node) => {
      const current = getComponentNode(projectRoot, node.nodeId)
      const settings = readNodeSettings(projectRoot, node.nodeId)
      const snapshot = buildNodeSnapshot(current.node, current.state, settings)
      snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
      return snapshot
    })
    // Agent nodes from graph-map
    const agentNodes = (graph.nodes || [])
      .filter(n => n.sessionId && n.kind !== 'component-node')
      .map(n => buildAgentSnapshot(projectRoot, n, graph))
    return { ok: true, nodes: [...componentNodes, ...agentNodes] }
  } catch (error) {
    throw asComponentNodeError(error)
  }
}

export async function getNode(projectRoot, nodeId) {
  try {
    // Try component node first
    try {
      const current = getComponentNode(projectRoot, nodeId)
      const settings = readNodeSettings(projectRoot, current.node.nodeId)
      const snapshot = buildNodeSnapshot(current.node, current.state, settings)
      const graph = loadWorkflowGraphMap(projectRoot)
      snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
      return { ok: true, node: snapshot, state: current.state, revision: current.revision }
    } catch (e) {
      if (e.code === 'NOT_FOUND' || e.code === 'BAD_REQUEST') {
        // Try agent node in graph-map (agent ids are not component-* ids)
        const graph = loadWorkflowGraphMap(projectRoot)
        const graphNode = findAgentGraphNode(graph, nodeId)
        if (graphNode) {
          return { ok: true, node: buildAgentSnapshot(projectRoot, graphNode, graph), revision: graph.version }
        }
      }
      throw e
    }
  } catch (error) {
    throw asComponentNodeError(error)
  }
}

export async function createNode(projectRoot, payload = {}) {
  try {
    const created = createComponentNode(projectRoot, payload)
    initSettings(projectRoot, created.node.nodeId, created.node.type)
    const settings = readNodeSettings(projectRoot, created.node.nodeId)
    const snapshot = buildNodeSnapshot(created.node, created.state, settings)
    const graph = loadWorkflowGraphMap(projectRoot)
    snapshot.graph.connections = buildConnections(created.node.nodeId, graph)
    return { ok: true, node: snapshot, state: created.state, revision: created.revision }
  } catch (error) {
    throw asComponentNodeError(error)
  }
}

export async function updateNodeState(projectRoot, nodeId, payload = {}) {
  try {
    const updated = updateComponentNode(projectRoot, nodeId, payload)
    const settings = readNodeSettings(projectRoot, updated.node.nodeId)
    const snapshot = buildNodeSnapshot(updated.node, updated.state, settings)
    const graph = loadWorkflowGraphMap(projectRoot)
    snapshot.graph.connections = buildConnections(updated.node.nodeId, graph)
    return { ok: true, node: snapshot, state: updated.state, revision: updated.revision }
  } catch (error) {
    throw asComponentNodeError(error)
  }
}

export async function updateNodeSettings(projectRoot, nodeId, payload = {}) {
  try {
    const graph = loadWorkflowGraphMap(projectRoot)
    const graphNode = findAgentGraphNode(graph, nodeId)
    if (graphNode) {
      const settingsNodeId = agentNodeId(graphNode)
      writeNodeSettings(projectRoot, settingsNodeId, payload, 'agent')
      const freshGraph = loadWorkflowGraphMap(projectRoot)
      const freshGraphNode = findAgentGraphNode(freshGraph, settingsNodeId) || graphNode
      const snapshot = buildAgentSnapshot(projectRoot, freshGraphNode, freshGraph)
      return { ok: true, node: snapshot, settings: snapshot.settings }
    }
    writeNodeSettings(projectRoot, nodeId, payload)
    const current = getComponentNode(projectRoot, nodeId)
    const settings = readNodeSettings(projectRoot, current.node.nodeId)
    const snapshot = buildNodeSnapshot(current.node, current.state, settings)
    snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
    return { ok: true, node: snapshot, settings }
  } catch (error) {
    throw asComponentNodeError(error)
  }
}

export async function executeNodeAction(projectRoot, nodeId, action, payload = {}) {
  try {
    const actionName = String(action || '').trim()
    if (actionName === 'node.delete') {
      return deleteNode(projectRoot, nodeId)
    }
    const separator = actionName.indexOf('.')
    const prefix = separator === -1 ? actionName : actionName.slice(0, separator)
    const suffix = separator === -1 ? '' : actionName.slice(separator + 1)
    const adapter = ACTION_ADAPTERS[prefix]
    const handler = adapter && typeof adapter[suffix] === 'function' ? adapter[suffix] : null
    if (!handler) {
      throw new ComponentNodeError(`Unknown workflow node action: ${actionName}`, {
        statusCode: 404,
        code: 'UNKNOWN_ACTION',
      })
    }

    // CHECK: is this a component node or agent node?
    const isAgentAction = prefix === 'agent'
    let nodeIdForHandler = nodeId

    if (isAgentAction) {
      // Agent nodes live in the graph-map. The handler gets (nodeId, projectRoot, payload).
      const result = await handler(nodeId, projectRoot, payload)
      // Build agent snapshot
      const graph = loadWorkflowGraphMap(projectRoot)
      const graphNode = findAgentGraphNode(graph, nodeId)
      const snapshot = graphNode ? buildAgentSnapshot(projectRoot, graphNode, graph) : null
      return { ok: true, action: actionName, node: snapshot, result }
    }

    // Component node path (existing logic)
    const current = getComponentNode(projectRoot, nodeId)
    const result = await handler(current.node.nodeId, projectRoot, payload)
    const fresh = getComponentNode(projectRoot, current.node.nodeId)
    const settings = readNodeSettings(projectRoot, current.node.nodeId)
    const snapshot = buildNodeSnapshot(fresh.node, fresh.state, settings)
    const graph = loadWorkflowGraphMap(projectRoot)
    snapshot.graph.connections = buildConnections(fresh.node.nodeId, graph)
    return { ok: true, action: actionName, node: snapshot, result }
  } catch (error) {
    throw asComponentNodeError(error)
  }
}

export async function deleteNode(projectRoot, nodeId) {
  try {
    const removed = deleteComponentNode(projectRoot, nodeId)
    deleteNodeSettings(projectRoot, nodeId)
    removeWorkflowGraphNode(projectRoot, nodeId)
    return { ok: true, nodeId: removed.nodeId, removed: removed.removed }
  } catch (error) {
    throw asComponentNodeError(error)
  }
}

export async function getNodeContext(projectRoot, nodeId) {
  try {
    let current
    try {
      current = getComponentNode(projectRoot, nodeId)
    } catch (error) {
      if (error?.code === 'NOT_FOUND' || error?.code === 'BAD_REQUEST') {
        const graph = loadWorkflowGraphMap(projectRoot)
        const graphNode = findAgentGraphNode(graph, nodeId)
        if (graphNode) return buildAgentContext(projectRoot, graphNode, graph)
      }
      throw error
    }
    const settings = readNodeSettings(projectRoot, current.node.nodeId)
    const snapshot = buildNodeSnapshot(current.node, current.state, settings)
    const graph = loadWorkflowGraphMap(projectRoot)
    const connections = buildConnections(current.node.nodeId, graph)
    const peerIds = connections.map(connection => connection.peerNodeId)
    snapshot.graph.connections = connections
    const refs = componentStateRefs(projectRoot)
    const connectedPeers = [...new Set(peerIds)].map((peerNodeId) => {
      const ref = refs[peerNodeId]
      return ref
        ? {
            nodeId: peerNodeId,
            type: ref.type,
            title: ref.title,
            stateRef: { path: ref.statePath, revision: ref.revision },
            ...(ref.file ? { file: ref.file } : {}),
          }
        : { nodeId: peerNodeId }
    })
    return {
      ok: true,
      node: snapshot,
      context: {
        nodeId: current.node.nodeId,
        graphVersion: Number(graph.version || 1),
        connectedPeers,
        componentStateRefs: refs,
      },
    }
  } catch (error) {
    throw asComponentNodeError(error)
  }
}
