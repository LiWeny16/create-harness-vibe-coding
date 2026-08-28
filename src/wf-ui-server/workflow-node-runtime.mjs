import {
  ComponentNodeError,
  componentStateRefs,
  createComponentNode,
  deleteComponentNode,
  getComponentNode,
  listLiveComponentNodes,
  restoreComponentNode,
  updateComponentNode,
} from './component-node-store.mjs'
import {
  EventNodeError,
  createEventNode,
  deleteEventNode,
  eventStateRefs,
  getEventNode,
  listEventNodes,
  restoreEventNode,
  updateEventNode,
} from './workflow-event-node-store.mjs'
import {
  CapabilityNodeError,
  capabilityStateRefs,
  createCapabilityNode,
  deleteCapabilityNode,
  getCapabilityNode,
  listCapabilityNodes,
  restoreCapabilityNode,
  updateCapabilityNode,
} from './workflow-capability-node-store.mjs'
import {
  GoalNodeError,
  getGoalNode,
  listGoalNodes,
} from './workflow-goal-node-store.mjs'
import { assertSingleGoalPerGroup, loadWorkflowGraphMap, removeWorkflowGraphNode, restoreWorkflowGraphNode, writeWorkflowGraphMap } from './a2a-store.mjs'
import {
  connectNodes as connectWorkflowNodes,
  disconnectNodes as disconnectWorkflowNodes,
  getGraphSnapshot,
  moveNode as moveWorkflowNode,
  recordGraphOp,
  resolveWorkflowNodeId,
} from './workflow-graph-store.mjs'
import { appendWorkflowOperation } from './workflow-operation-store.mjs'
import { workspaceMimeForPath } from './workspace-store.mjs'
import {
  deleteNodeSettings,
  getSettingsSchema,
  initNodeSettings,
  readNodeSettings,
  writeNodeSettings,
} from './workflow-node-settings-store.mjs'
import * as MarkdownNode from './workflow-node-types/markdown-node.mjs'
import * as DisplayNode from './workflow-node-types/display-node.mjs'
import * as ExcalidrawNode from './workflow-node-types/excalidraw-node.mjs'
import * as FileNode from './workflow-node-types/file-node.mjs'
import * as AgentNode from './workflow-node-types/agent-node.mjs'
import * as TimerNode from './workflow-node-types/timer-node.mjs'
import * as GithubTriggerNode from './workflow-node-types/github-trigger-node.mjs'
import * as SkillGroupNode from './workflow-node-types/skill-group-node.mjs'
import * as McpConnectorNode from './workflow-node-types/mcp-connector-node.mjs'
import * as GoalNode from './workflow-node-types/goal-node.mjs'
import { listMcpHub } from './workflow-mcp-hub.mjs'
import { buildNodeOntologyContext } from './workflow-ontology.mjs'
import {
  agentNodeId,
  buildAgentContext,
  buildAgentSnapshot,
  buildCapabilities,
  findAgentGraphNode,
  goalStateRefsForGraph,
  handlesFor,
  hasTimerControlEdge,
  isDeletedGraphNode,
  isLiveAgentGraphNode,
  isMainAgentGraphNode,
} from './workflow-agent-context.mjs'

export {
  ComponentNodeError,
  createComponentNode,
  deleteComponentNode,
  getComponentNode,
  listComponentNodes,
  listLiveComponentNodes,
  componentStateRefs,
  restoreComponentNode,
  updateComponentNode,
} from './component-node-store.mjs'
export {
  EventNodeError,
  createEventNode,
  deleteEventNode,
  getEventNode,
  listEventNodes,
  restoreEventNode,
  updateEventNode,
} from './workflow-event-node-store.mjs'
export {
  CapabilityNodeError,
  createCapabilityNode,
  deleteCapabilityNode,
  getCapabilityNode,
  listCapabilityNodes,
  restoreCapabilityNode,
  updateCapabilityNode,
} from './workflow-capability-node-store.mjs'
export {
  GoalNodeError,
  getGoalNode,
  goalStateRefs,
  listGoalNodes,
} from './workflow-goal-node-store.mjs'
export { loadWorkflowGraphMap, restoreWorkflowGraphNode, writeWorkflowGraphMap } from './a2a-store.mjs'
export { workflowOntology } from './workflow-ontology.mjs'
export {
  deleteNodeSettings,
  getSettingsSchema,
  readNodeSettings,
  writeNodeSettings,
} from './workflow-node-settings-store.mjs'

// Action routing: "<type>.<suffix>" dispatches to the matching adapter module
// (markdown.*, excalidraw.*, file.*, display.*). Adapter handlers must export
// the action suffix as a function and are called as handler(projectRoot,
// nodeId, payload).
const ACTION_ADAPTERS = {
  markdown: MarkdownNode,
  excalidraw: ExcalidrawNode,
  file: FileNode,
  display: DisplayNode,
  agent: AgentNode,
  timer: TimerNode,
  'github-trigger': GithubTriggerNode,
  'skill-group': SkillGroupNode,
  'mcp-connector': McpConnectorNode,
  goal: GoalNode,
}

const EVENT_NODE_TYPES = new Set(['timer', 'github-trigger'])
const AGENT_GRAPH_ACTIONS = new Set(['createNode', 'connectNodes', 'disconnectNodes', 'moveNode', 'deleteNode', 'deleteNodes', 'readGraph'])
function normalizeSettings(type, settings) {
  const source = settings && typeof settings === 'object' ? settings : {}
  return {
    schemaId: `${type}-settings`,
    values: source.values && typeof source.values === 'object' && !Array.isArray(source.values) ? source.values : {},
    revision: Number(source.revision || 0),
  }
}

function buildContentRef(node, state, metadata = null) {
  if (node.type === 'goal') {
    return state.contentRef || {
      kind: 'task-capsule',
      taskId: node.config?.taskId || '',
    }
  }
  if (EVENT_NODE_TYPES.has(node.type)) {
    return {
      kind: 'event-node-state',
      statePath: node.statePath,
      revision: node.revision,
      eventKind: node.type,
    }
  }
  if (node.type === 'skill-group' || node.type === 'mcp-connector') {
    return {
      kind: 'capability-node-state',
      statePath: node.statePath,
      revision: node.revision,
      capabilityKind: node.type,
    }
  }
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

function canonicalAgentActorNodeId(graph, actorNodeId) {
  const value = String(actorNodeId || '').trim()
  if (!value) return ''
  const graphNode = findAgentGraphNode(graph, value)
  return graphNode ? agentNodeId(graphNode) : ''
}

function cleanActorString(value) {
  return String(value || '').trim()
}

function actorValue(...values) {
  for (const value of values) {
    const text = cleanActorString(value)
    if (text) return text
  }
  return ''
}

function agentLikeActorType(value) {
  const text = cleanActorString(value).toLowerCase()
  return text === 'agent'
    || text === 'main'
    || text === 'subagent'
    || text === 'ceo'
    || text.endsWith('-agent')
    || text.endsWith('_agent')
}

function resolveAgentActionActor(graph, payload = {}, options = {}, ErrorClass = ComponentNodeError) {
  const actorType = actorValue(payload.actorType, options.actorType)
  const actorKind = actorValue(payload.actorKind, options.actorKind)
  const actorNodeCandidate = actorValue(
    payload.actorNodeId,
    payload.fromNodeId,
    payload.sourceNodeId,
    options.actorNodeId,
  )
  const actorSessionCandidate = actorValue(
    payload.actorSessionId,
    payload.fromSessionId,
    payload.sourceSessionId,
    options.actorSessionId,
  )
  const agentAuthored = Boolean(actorNodeCandidate || actorSessionCandidate)
    || agentLikeActorType(actorType)
    || agentLikeActorType(actorKind)
  if (!agentAuthored) {
    return { agentAuthored: false, payload }
  }
  if (!actorNodeCandidate && !actorSessionCandidate) {
    throw new ErrorClass('Agent-authored node action requires actorNodeId or actorSessionId', {
      statusCode: 403,
      code: 'AGENT_ACTOR_REQUIRED',
    })
  }

  const byNode = actorNodeCandidate ? findAgentGraphNode(graph, actorNodeCandidate) : null
  const bySession = actorSessionCandidate ? findAgentGraphNode(graph, actorSessionCandidate) : null
  if (actorNodeCandidate && !byNode) {
    throw new ErrorClass('Agent action actor is not a workflow Agent node', {
      statusCode: 403,
      code: 'AGENT_ACTOR_NOT_FOUND',
    })
  }
  if (actorSessionCandidate && !bySession) {
    throw new ErrorClass('Agent action session is not bound to a workflow Agent node', {
      statusCode: 403,
      code: 'AGENT_ACTOR_NOT_FOUND',
    })
  }
  if (byNode && bySession && agentNodeId(byNode) !== agentNodeId(bySession)) {
    throw new ErrorClass('Agent action actor does not match actorSessionId', {
      statusCode: 403,
      code: 'AGENT_ACTOR_MISMATCH',
    })
  }

  const graphNode = byNode || bySession
  const canonicalActorNodeId = agentNodeId(graphNode)
  return {
    agentAuthored: true,
    graphNode,
    actorNodeId: canonicalActorNodeId,
    actorSessionId: graphNode.sessionId || actorSessionCandidate,
    payload: {
      ...payload,
      actorType: 'agent',
      actorNodeId: canonicalActorNodeId,
      actorSessionId: graphNode.sessionId || actorSessionCandidate,
    },
  }
}

// Timer internal actions (spec §6.1, M4): timer.fire / timer.tick /
// timer.dispatchWakeup are backend-internal. The bounded scheduler calls the
// timer-node functions directly (timer-wakeup-scheduler.mjs), never this
// HTTP-reachable surface. The HTTP action route always passes actor options,
// so any options-carrying invocation must prove a main/controller agent or
// the explicit internal scheduler marker; unknown actors are denied (F1/F3).
const TIMER_INTERNAL_ACTIONS = new Set(['fire', 'tick', 'dispatchWakeup'])

function isMainOrControllerActorKind(value) {
  const kind = cleanActorString(value).toLowerCase()
  return kind === 'main' || kind === 'controller' || kind === 'ceo' || kind === 'main-agent'
}

function assertTimerInternalActionAllowed(projectRoot, nodeId, suffix, payload, options) {
  if (!TIMER_INTERNAL_ACTIONS.has(String(suffix || '').trim())) return
  // Bare in-process invocations (no options, or the function-default empty
  // object) are trusted internal callers — the scheduler and unit tests call
  // the timer-node functions directly. Only the HTTP route produces actor
  // options (workflowActionActorOptions always returns the four actor keys),
  // so an options object with any key is HTTP-originated and must prove its
  // actor (F1).
  if (options === undefined || options === null) return
  if (options !== null && typeof options === 'object' && Object.keys(options).length === 0) return
  // Explicit internal marker: set only by backend-internal dispatch paths;
  // workflowActionActorOptions() never copies it from HTTP input (F1).
  if (options.internal === true) return
  const declaredKind = actorValue(payload?.actorKind, options?.actorKind)
  const nodeCandidate = actorValue(
    payload?.actorNodeId,
    payload?.fromNodeId,
    payload?.sourceNodeId,
    options?.actorNodeId,
  )
  const sessionCandidate = actorValue(
    payload?.actorSessionId,
    payload?.fromSessionId,
    payload?.sourceSessionId,
    options?.actorSessionId,
  )
  // Main/controller agent kind declared WITHOUT a node/session is accepted as
  // the scheduler-facing controller; with a node/session the node must resolve
  // below (a bogus main claim then fails AGENT_ACTOR_NOT_FOUND).
  if (isMainOrControllerActorKind(declaredKind) && !nodeCandidate && !sessionCandidate) return
  const graph = loadWorkflowGraphMap(projectRoot)
  const actor = resolveAgentActionActor(graph, payload || {}, options || {}, EventNodeError)
  if (actor.agentAuthored) {
    if (actor.graphNode && isMainAgentGraphNode(actor.graphNode)) return
    if (isMainOrControllerActorKind(actor.graphNode?.agentKind)) return
  }
  throw new EventNodeError(
    `Timer internal action ${nodeId} ${suffix} requires the main/controller agent or the internal scheduler`,
    {
      statusCode: 403,
      code: 'TIMER_INTERNAL_ACTION_DENIED',
    }
  )
}

function hasGoalActionEdge(graph, actorNodeId, goalNodeId) {
  const actor = canonicalAgentActorNodeId(graph, actorNodeId)
  if (!actor || !goalNodeId) return false
  return workflowRuntimeEdges(graph).some((edge) => {
    const from = edge.from || edge.source
    const to = edge.to || edge.target
    const endpointsMatch = (from === actor && to === goalNodeId) || (from === goalNodeId && to === actor)
    return endpointsMatch
      && normalizeEdgeDirection(edge.direction) === 'bidirectional'
      && isGoalRelation(edge.relation)
  })
}

function isGoalRelation(value) {
  const relation = String(value || '').trim()
  return relation === 'goal' || relation.endsWith('/goal')
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
      handles: handlesFor(node.type),
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

function buildEventNodeSnapshot(node, state, settings) {
  return {
    nodeId: node.nodeId,
    kind: node.type,
    version: node.revision,
    lifecycle: 'event-source',
    status: { state: 'ready', updatedAt: new Date().toISOString() },
    graph: {
      position: node.position,
      handles: handlesFor(node.type),
      connections: [],
    },
    stateRef: { path: node.statePath, revision: node.revision },
    contentRef: buildContentRef(node, state),
    settings: normalizeSettings(node.type, settings),
    capabilities: buildCapabilities(node.type, state),
    ui: {
      previewKind: node.type,
      settingsPanel: `${node.type}-settings`,
      testId: 'workflow-event-node',
      labels: { title: node.title },
    },
  }
}

function buildCapabilityNodeSnapshot(node, state, settings) {
  return {
    nodeId: node.nodeId,
    kind: node.type,
    version: node.revision,
    lifecycle: 'capability-provider',
    status: { state: 'ready', updatedAt: new Date().toISOString() },
    graph: {
      position: node.position,
      handles: handlesFor(node.type),
      connections: [],
    },
    stateRef: { path: node.statePath, revision: node.revision },
    contentRef: buildContentRef(node, state),
    settings: normalizeSettings(node.type, settings),
    capabilities: buildCapabilities(node.type, state),
    ui: {
      previewKind: node.type,
      settingsPanel: `${node.type}-settings`,
      testId: 'workflow-capability-node',
      labels: { title: node.title },
    },
  }
}

function buildGoalNodeSnapshot(node, state, settings) {
  const title = state.title || node.title
  return {
    nodeId: node.nodeId,
    kind: 'goal',
    version: node.revision,
    lifecycle: 'goal-anchor',
    status: { state: state.status || 'active', updatedAt: new Date().toISOString() },
    graph: {
      position: node.position,
      handles: handlesFor('goal'),
      connections: [],
    },
    stateRef: { path: node.statePath, revision: node.revision },
    contentRef: buildContentRef({ ...node, type: 'goal' }, state),
    settings: normalizeSettings('goal', settings),
    capabilities: buildCapabilities('goal', state),
    taskId: state.taskId,
    title,
    objective: state.objective,
    acceptance: state.acceptance,
    planItems: state.planItems,
    progress: state.progress,
    nextAction: state.nextAction,
    confirmation: state.confirmation,
    wdt: state.wdt,
    ui: {
      previewKind: 'goal',
      settingsPanel: 'goal-settings',
      testId: 'workflow-goal-node',
      labels: { title },
    },
  }
}

function initSettings(projectRoot, nodeId, type) {
  initNodeSettings(projectRoot, nodeId, type)
}

function asComponentNodeError(error) {
  if (error instanceof ComponentNodeError) return error
  if (error instanceof EventNodeError) return error
  if (error instanceof CapabilityNodeError) return error
  if (error instanceof GoalNodeError) return error
  return new ComponentNodeError(
    error && error.message ? error.message : 'Workflow node runtime error',
    { statusCode: 500, code: 'NODE_RUNTIME_ERROR' }
  )
}

function buildConnections(nodeId, graph) {
  return workflowRuntimeEdges(graph)
    .map(edge => connectionForEdge(edge, nodeId))
    .filter(Boolean)
}

function workflowRuntimeEdges(graph = {}) {
  const graphEdges = Array.isArray(graph.edges) ? graph.edges : []
  const dockEdges = (Array.isArray(graph.capsuleDockLinks) ? graph.capsuleDockLinks : [])
    .flatMap((link) => (
      Array.isArray(link?.connections) ? link.connections : []
    ).map((connection) => {
      const from = String(connection?.from || connection?.source || '').trim()
      const to = String(connection?.to || connection?.target || '').trim()
      if (!from || !to || from === to) return null
      return {
        id: String(connection.id || `dock:${link.id || 'capsule'}:${from}->${to}`).trim(),
        kind: 'capsule-dock-link',
        from,
        to,
        source: from,
        target: to,
        relation: String(connection.relation || 'wf-bridge').trim() || 'wf-bridge',
        direction: normalizeEdgeDirection(connection.direction),
        sourceHandle: connection.sourceHandle || null,
        targetHandle: connection.targetHandle || null,
        dockLinkId: link.id || '',
      }
    }).filter(Boolean))
  const seen = new Set()
  return [...graphEdges, ...dockEdges].filter((edge) => {
    const key = workflowRuntimeEdgeSemanticKey(edge)
      || String(edge.id || `${edge.from || edge.source}->${edge.to || edge.target}`).trim()
    if (!key) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeEdgeDirection(value) {
  return String(value || '').trim() === 'source-to-target' ? 'source-to-target' : 'bidirectional'
}

function workflowRuntimeEdgeSemanticKey(edge = {}) {
  const from = String(edge.from || edge.source || '').trim()
  const to = String(edge.to || edge.target || '').trim()
  if (!from || !to) return ''
  const relation = String(edge.relation || 'wf-bridge').trim() || 'wf-bridge'
  const direction = normalizeEdgeDirection(edge.direction)
  const sourceHandle = String(edge.sourceHandle || '').trim()
  const targetHandle = String(edge.targetHandle || '').trim()
  if (direction !== 'source-to-target') {
    return [
      direction,
      relation,
      ...[`${from}:${sourceHandle}`, `${to}:${targetHandle}`].sort(),
    ].join('|')
  }
  return [direction, from, sourceHandle, relation, to, targetHandle].join('|')
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
    direction: normalizeEdgeDirection(edge.direction),
  }
}

function graphNodeKey(node) {
  return node?.nodeId || node?.id || (node?.sessionId ? `session-${node.sessionId}` : '')
}

function resolveAgentDeleteTargetIds(projectRoot, graph, payload = {}) {
  if (payload?.all === true) {
    return (graph.nodes || [])
      .map(node => graphNodeKey(node))
      .filter(Boolean)
  }

  const rawTargets = []
  for (const value of [
    payload?.targetNodeIds,
    payload?.nodeIds,
    payload?.ids,
  ]) {
    if (Array.isArray(value)) rawTargets.push(...value)
  }
  for (const value of [
    payload?.targetNodeId,
    payload?.nodeId,
    payload?.target,
    payload?.id,
  ]) {
    if (value) rawTargets.push(value)
  }
  const unique = []
  const seen = new Set()
  for (const raw of rawTargets) {
    const resolved = resolveWorkflowNodeId(projectRoot, graph, raw)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    unique.push(resolved)
  }
  if (unique.length === 0) {
    throw new ComponentNodeError('Agent delete action requires targetNodeId, targetNodeIds, or all: true', {
      statusCode: 400,
      code: 'DELETE_TARGET_REQUIRED',
    })
  }
  return unique
}

function assertMainAgentGraphActor(projectRoot, key) {
  const graph = loadWorkflowGraphMap(projectRoot)
  const graphNode = findAgentGraphNode(graph, key)
  if (!graphNode) {
    throw new ComponentNodeError('Agent graph actor not found', {
      statusCode: 404,
      code: 'AGENT_GRAPH_ACTOR_NOT_FOUND',
    })
  }
  if (!isMainAgentGraphNode(graphNode)) {
    throw new ComponentNodeError('Agent graph control requires a Main Agent node', {
      statusCode: 403,
      code: 'MAIN_AGENT_REQUIRED',
    })
  }
  return { graph, graphNode, actorNodeId: agentNodeId(graphNode) }
}

// Typed detail fields forwarded from plain backend errors (e.g. the
// goal_already_bound shape thrown by assertSingleGoalPerGroup) so the HTTP
// surface returns the same spec shape as the direct edge route (F12).
const GRAPH_ACTION_TYPED_FIELDS = ['existingGoalNodeId', 'timerNodeId', 'remaining', 'currentRevision', 'expectedRevision', 'holder', 'expiresAt']

function graphActionError(error) {
  if (error instanceof ComponentNodeError) return error
  const wrapped = new ComponentNodeError(error?.message || 'Agent graph action failed', {
    statusCode: error?.statusCode || 400,
    code: error?.code || 'AGENT_GRAPH_ACTION_FAILED',
  })
  for (const field of GRAPH_ACTION_TYPED_FIELDS) {
    const value = error?.[field]
    if (value !== undefined && value !== null) wrapped[field] = value
  }
  return wrapped
}

function graphActionActor(graphNode, actorNodeId) {
  return {
    type: 'agent',
    nodeId: actorNodeId,
    sessionId: graphNode.sessionId || null,
    agentKind: graphNode.agentKind || null,
    label: graphNode.label || graphNode.runtime || 'Agent',
  }
}

function appendAgentGraphOperation(projectRoot, { actionName, graphNode, actorNodeId, targetNodeIds = [], edgeIds = [], summary, status = 'completed' }) {
  return appendWorkflowOperation(projectRoot, {
    kind: actionName,
    actor: graphActionActor(graphNode, actorNodeId),
    targetNodeIds,
    edgeIds,
    status,
    summary,
  })
}

async function executeAgentGraphAction(projectRoot, nodeId, actionName, suffix, payload = {}) {
  const { graphNode, actorNodeId } = assertMainAgentGraphActor(projectRoot, payload?.actorNodeId || nodeId)
  try {
    if (suffix === 'createNode') {
      const nodePayload = payload?.node && typeof payload.node === 'object' && !Array.isArray(payload.node)
        ? payload.node
        : payload
      const created = await createNode(projectRoot, nodePayload)
      const targetNodeId = created?.node?.nodeId || created?.node?.id || nodePayload.nodeId
      const operation = appendAgentGraphOperation(projectRoot, {
        actionName,
        graphNode,
        actorNodeId,
        targetNodeIds: targetNodeId ? [targetNodeId] : [],
        summary: `created ${targetNodeId || 'node'}`,
      })
      const graph = loadWorkflowGraphMap(projectRoot)
      const snapshot = buildAgentSnapshot(projectRoot, graphNode, graph)
      return { ok: true, action: actionName, node: snapshot, result: { ...created, operation }, operation }
    }

    if (suffix === 'connectNodes') {
      const from = payload?.from || payload?.source || payload?.sourceNodeId || actorNodeId
      const to = payload?.to || payload?.target || payload?.targetNodeId
      // Single-Goal rule (spec §6.2, AC-015, F12): the main-agent graph-action
      // connect path must enforce the same candidate-inclusive guard as the
      // HTTP edge route (server.mjs /api/workflow/edges), otherwise
      // agent.connectNodes could bind a second Goal into a Timer+Agent group
      // that already has one. Throws the goal_already_bound spec shape (409).
      const endpoints = [String(from || '').trim(), String(to || '').trim()]
      for (const endpoint of endpoints) {
        if (!endpoint || !/^goal-/.test(endpoint)) continue
        const peer = endpoints.find(candidate => candidate && candidate !== endpoint) || ''
        const extraDockLinks = peer
          ? [{ id: `sim:${endpoint}->${peer}`, nodeIds: [endpoint, peer] }]
          : []
        assertSingleGoalPerGroup(projectRoot, endpoint, { extraDockLinks })
      }
      const connected = connectWorkflowNodes(projectRoot, {
        from,
        to,
        relation: payload?.relation,
        sourceHandle: payload?.sourceHandle,
        targetHandle: payload?.targetHandle,
        direction: payload?.direction,
      }, { action: 'agent.connectNodes', actor: graphActionActor(graphNode, actorNodeId) })
      const operation = appendAgentGraphOperation(projectRoot, {
        actionName,
        graphNode,
        actorNodeId,
        targetNodeIds: [connected.edge.from || from, connected.edge.to || to],
        edgeIds: [connected.edge.id],
        summary: `connected ${connected.edge.from}->${connected.edge.to}`,
      })
      const graph = loadWorkflowGraphMap(projectRoot)
      const snapshot = buildAgentSnapshot(projectRoot, graphNode, graph)
      return { ok: true, action: actionName, node: snapshot, result: { ...connected, operation }, operation }
    }

    if (suffix === 'disconnectNodes') {
      const edgeId = payload?.edgeId || payload?.id
      const beforeGraph = loadWorkflowGraphMap(projectRoot)
      const existing = (beforeGraph.edges || []).find(edge => edge.id === edgeId)
      const disconnected = disconnectWorkflowNodes(projectRoot, edgeId, { action: 'agent.disconnectNodes', actor: graphActionActor(graphNode, actorNodeId) })
      const operation = appendAgentGraphOperation(projectRoot, {
        actionName,
        graphNode,
        actorNodeId,
        targetNodeIds: existing ? [existing.from || existing.source, existing.to || existing.target] : [],
        edgeIds: [edgeId],
        summary: `disconnected ${edgeId}`,
      })
      const graph = loadWorkflowGraphMap(projectRoot)
      const snapshot = buildAgentSnapshot(projectRoot, graphNode, graph)
      return { ok: true, action: actionName, node: snapshot, result: { ...disconnected, operation }, operation }
    }

    if (suffix === 'moveNode') {
      const graph = loadWorkflowGraphMap(projectRoot)
      const targetNodeId = resolveWorkflowNodeId(projectRoot, graph, payload?.targetNodeId || payload?.nodeId || payload?.id)
      const moved = moveWorkflowNode(projectRoot, targetNodeId, payload?.position || payload, { action: 'agent.moveNode', actor: graphActionActor(graphNode, actorNodeId) })
      const freshGraph = loadWorkflowGraphMap(projectRoot)
      const edgeIds = (freshGraph.edges || [])
        .filter(edge => {
          const from = edge.from || edge.source
          const to = edge.to || edge.target
          return (from === actorNodeId && to === targetNodeId) || (from === targetNodeId && to === actorNodeId)
        })
        .map(edge => edge.id || `${edge.from || edge.source}->${edge.to || edge.target}`)
      const operation = appendAgentGraphOperation(projectRoot, {
        actionName,
        graphNode,
        actorNodeId,
        targetNodeIds: [targetNodeId],
        edgeIds,
        summary: `moved ${targetNodeId}`,
      })
      const snapshot = buildAgentSnapshot(projectRoot, graphNode, freshGraph)
      return { ok: true, action: actionName, node: snapshot, result: { ...moved, operation }, operation }
    }

    if (suffix === 'deleteNode' || suffix === 'deleteNodes') {
      const beforeGraph = loadWorkflowGraphMap(projectRoot)
      const requestedTargetIds = resolveAgentDeleteTargetIds(projectRoot, beforeGraph, payload)
      const deletedNodeIds = []
      const skippedNodeIds = []
      const errors = []

      for (const targetNodeId of requestedTargetIds) {
        if (targetNodeId === actorNodeId) {
          if (payload?.all === true || suffix === 'deleteNodes') {
            skippedNodeIds.push(targetNodeId)
            continue
          }
          throw new ComponentNodeError('Agent cannot delete its own graph node while executing graph control', {
            statusCode: 400,
            code: 'CANNOT_DELETE_SELF',
          })
        }
        const currentGraph = loadWorkflowGraphMap(projectRoot)
        const targetGraphNode = (currentGraph.nodes || [])
          .find(node => graphNodeKey(node) === targetNodeId || node.sessionId === targetNodeId || (node.sessionId && `session-${node.sessionId}` === targetNodeId))
        if (!targetGraphNode || isDeletedGraphNode(currentGraph, targetNodeId)) {
          skippedNodeIds.push(targetNodeId)
          continue
        }
        if (isLiveAgentGraphNode(targetGraphNode) && payload?.allowLiveAgentDelete !== true && payload?.force !== true) {
          if (payload?.all === true || suffix === 'deleteNodes') {
            skippedNodeIds.push(targetNodeId)
            continue
          }
          throw new ComponentNodeError('Stop the target Agent before deleting its graph node', {
            statusCode: 409,
            code: 'LIVE_AGENT_DELETE_REQUIRES_STOP',
          })
        }
        try {
          await deleteNode(projectRoot, targetNodeId, { action: 'agent.deleteNode', actor: graphActionActor(graphNode, actorNodeId) })
          deletedNodeIds.push(targetNodeId)
        } catch (deleteError) {
          if (payload?.all === true || suffix === 'deleteNodes') {
            errors.push({
              nodeId: targetNodeId,
              code: deleteError?.code || 'DELETE_FAILED',
              message: deleteError?.message || 'Delete failed',
            })
            continue
          }
          throw deleteError
        }
      }

      const freshGraph = loadWorkflowGraphMap(projectRoot)
      const operation = appendAgentGraphOperation(projectRoot, {
        actionName,
        graphNode,
        actorNodeId,
        targetNodeIds: [...deletedNodeIds, ...skippedNodeIds],
        edgeIds: [],
        summary: `deleted ${deletedNodeIds.length} node(s), skipped ${skippedNodeIds.length}`,
        status: errors.length > 0 && deletedNodeIds.length === 0 ? 'failed' : 'completed',
      })
      const snapshot = buildAgentSnapshot(projectRoot, graphNode, freshGraph)
      return {
        ok: errors.length === 0,
        action: actionName,
        node: snapshot,
        result: { deletedNodeIds, skippedNodeIds, errors, operation },
        operation,
      }
    }

    if (suffix === 'readGraph') {
      const graph = getGraphSnapshot(projectRoot)
      const operation = appendAgentGraphOperation(projectRoot, {
        actionName,
        graphNode,
        actorNodeId,
        targetNodeIds: [],
        edgeIds: [],
        summary: 'read graph',
      })
      const snapshot = buildAgentSnapshot(projectRoot, graphNode, graph)
      return { ok: true, action: actionName, node: snapshot, result: { graph, operation }, operation }
    }

    throw new ComponentNodeError(`Unknown workflow node action: ${actionName}`, {
      statusCode: 404,
      code: 'UNKNOWN_ACTION',
    })
  } catch (error) {
    throw graphActionError(error)
  }
}

export async function listNodes(projectRoot) {
  try {
    const graph = loadWorkflowGraphMap(projectRoot)
    // Component nodes
    const componentNodes = listLiveComponentNodes(projectRoot).map((node) => {
      const current = getComponentNode(projectRoot, node.nodeId)
      const settings = readNodeSettings(projectRoot, node.nodeId)
      const snapshot = buildNodeSnapshot(current.node, current.state, settings)
      snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
      return snapshot
    })
    const eventNodes = listEventNodes(projectRoot).map((node) => {
      const current = getEventNode(projectRoot, node.nodeId)
      const settings = readNodeSettings(projectRoot, node.nodeId, node.type)
      const snapshot = buildEventNodeSnapshot(current.node, current.state, settings)
      snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
      return snapshot
    })
    const capabilityNodes = listCapabilityNodes(projectRoot).map((node) => {
      const current = getCapabilityNode(projectRoot, node.nodeId)
      const settings = readNodeSettings(projectRoot, node.nodeId, node.type)
      const snapshot = buildCapabilityNodeSnapshot(current.node, current.state, settings)
      snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
      return snapshot
    })
    const goalNodes = listGoalNodes(projectRoot).map((node) => {
      const current = getGoalNode(projectRoot, node.nodeId)
      const settings = readNodeSettings(projectRoot, node.nodeId, 'goal')
      const snapshot = buildGoalNodeSnapshot(current.node, current.state, settings)
      snapshot.graph.position = graph.positions?.[current.node.nodeId] || snapshot.graph.position
      snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
      return snapshot
    }).filter(node => !isDeletedGraphNode(graph, node.nodeId))
    // Agent nodes from graph-map
    const agentNodes = (graph.nodes || [])
      .filter(n => n.sessionId && n.kind !== 'component-node')
      .map(n => buildAgentSnapshot(projectRoot, n, graph))
    return { ok: true, nodes: [...componentNodes, ...eventNodes, ...capabilityNodes, ...goalNodes, ...agentNodes] }
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
        try {
          const current = getEventNode(projectRoot, nodeId)
          const settings = readNodeSettings(projectRoot, current.node.nodeId, current.node.type)
          const snapshot = buildEventNodeSnapshot(current.node, current.state, settings)
          const graph = loadWorkflowGraphMap(projectRoot)
          snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
          return { ok: true, node: snapshot, state: current.state, revision: current.revision }
        } catch (eventError) {
          if (!(eventError.code === 'NOT_FOUND' || eventError.code === 'BAD_REQUEST')) {
            throw eventError
          }
        }
        try {
          const current = getCapabilityNode(projectRoot, nodeId)
          const settings = readNodeSettings(projectRoot, current.node.nodeId, current.node.type)
          const snapshot = buildCapabilityNodeSnapshot(current.node, current.state, settings)
          const graph = loadWorkflowGraphMap(projectRoot)
          snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
          return { ok: true, node: snapshot, state: current.state, revision: current.revision }
        } catch (capabilityError) {
          if (!(capabilityError.code === 'NOT_FOUND' || capabilityError.code === 'BAD_REQUEST')) {
            throw capabilityError
          }
        }
        try {
          const current = getGoalNode(projectRoot, nodeId)
          const graph = loadWorkflowGraphMap(projectRoot)
          if (isDeletedGraphNode(graph, current.node.nodeId)) {
            throw new GoalNodeError(`Goal node not found: ${current.node.nodeId}`, {
              statusCode: 404,
              code: 'NOT_FOUND',
            })
          }
          const settings = readNodeSettings(projectRoot, current.node.nodeId, 'goal')
          const snapshot = buildGoalNodeSnapshot(current.node, current.state, settings)
          snapshot.graph.position = graph.positions?.[current.node.nodeId] || snapshot.graph.position
          snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
          return { ok: true, node: snapshot, state: current.state, revision: current.revision }
        } catch (goalError) {
          if (isDeletedGraphNode(loadWorkflowGraphMap(projectRoot), nodeId)) {
            throw goalError
          }
          if (!(goalError.code === 'NOT_FOUND' || goalError.code === 'BAD_REQUEST')) {
            throw goalError
          }
        }
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

// P5: record a createNode op AFTER the node exists (its record is the forward
// slice; the inverse carries a _removed marker so undo deletes the node again).
function recordCreatedNodeGraphOp(projectRoot, created, stateField, payload = {}) {
  if (!created?.node?.nodeId) return
  const actorNodeId = String(payload?.actorNodeId || '').trim()
  const record = {
    ...created.node,
    position: created.node.position,
    [stateField]: created.state,
  }
  const recorded = recordGraphOp(projectRoot, {
    action: 'agent.createNode',
    actor: actorNodeId
      ? { kind: 'agent', nodeId: actorNodeId, sessionId: String(payload?.actorSessionId || '') }
      : { kind: 'human', nodeId: '', sessionId: '' },
    inverse: { nodes: [{ ...record, _removed: true }] },
    forward: { nodes: [record] },
  })
  if (!recorded) return
  const fresh = loadWorkflowGraphMap(projectRoot)
  writeWorkflowGraphMap(projectRoot, {
    ...fresh,
    version: fresh.version + 1,
    undoStack: recorded.undoStack,
    redoStack: recorded.redoStack,
  }, { overrideHistory: true })
}

export async function createNode(projectRoot, payload = {}) {
  try {
    const eventType = String(payload.type || '').trim().toLowerCase()
    const nodeType = eventType
    const { experimental, ...stablePayload } = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    if (eventType === 'github-trigger' && experimental !== true) {
      throw new EventNodeError('github-trigger is planned and requires experimental: true to create', {
        statusCode: 409,
        code: 'PLANNED_NODE_REQUIRES_EXPERIMENTAL',
      })
    }
    if (EVENT_NODE_TYPES.has(eventType)) {
      const created = createEventNode(projectRoot, { ...stablePayload, type: eventType })
      initSettings(projectRoot, created.node.nodeId, created.node.type)
      recordCreatedNodeGraphOp(projectRoot, created, 'eventState', payload)
      const settings = readNodeSettings(projectRoot, created.node.nodeId, created.node.type)
      const snapshot = buildEventNodeSnapshot(created.node, created.state, settings)
      const graph = loadWorkflowGraphMap(projectRoot)
      snapshot.graph.connections = buildConnections(created.node.nodeId, graph)
      return { ok: true, node: snapshot, state: created.state, revision: created.revision }
    }
    if (String(payload.type || '').trim().toLowerCase() === 'skill-group') {
      const created = createCapabilityNode(projectRoot, { ...payload, type: 'skill-group' })
      initSettings(projectRoot, created.node.nodeId, created.node.type)
      recordCreatedNodeGraphOp(projectRoot, created, 'capabilityState', payload)
      const settings = readNodeSettings(projectRoot, created.node.nodeId, created.node.type)
      const snapshot = buildCapabilityNodeSnapshot(created.node, created.state, settings)
      const graph = loadWorkflowGraphMap(projectRoot)
      snapshot.graph.connections = buildConnections(created.node.nodeId, graph)
      return { ok: true, node: snapshot, state: created.state, revision: created.revision }
    }
    if (String(payload.type || '').trim().toLowerCase() === 'mcp-connector') {
      const mcpServerId = String(payload.mcpServerId || payload.serverId || '').trim()
      let server = payload.server
      if (mcpServerId) {
        const hub = listMcpHub(projectRoot, { scope: 'project' })
        server = hub.servers.find(item => item.id === mcpServerId)
        if (!server) {
          throw new CapabilityNodeError(`MCP server metadata not found: ${mcpServerId}`, {
            statusCode: 404,
            code: 'MCP_SERVER_NOT_FOUND',
          })
        }
      }
      const created = createCapabilityNode(projectRoot, {
        ...payload,
        type: 'mcp-connector',
        title: payload.title || (server ? `${server.title || server.name} MCP` : 'MCP Connector'),
        sourceGroup: payload.sourceGroup || (server?.sources?.[0]
          ? {
              id: `source:${server.sources[0].rootId || 'mcp'}`,
              label: server.sources[0].label || 'MCP config',
              kind: 'mcp-source',
            }
          : { id: 'mcp-hub', label: 'MCP Hub', kind: 'mcp-hub' }),
        servers: server ? [server] : payload.servers,
      })
      initSettings(projectRoot, created.node.nodeId, created.node.type)
      recordCreatedNodeGraphOp(projectRoot, created, 'capabilityState', payload)
      const settings = readNodeSettings(projectRoot, created.node.nodeId, created.node.type)
      const snapshot = buildCapabilityNodeSnapshot(created.node, created.state, settings)
      const graph = loadWorkflowGraphMap(projectRoot)
      snapshot.graph.connections = buildConnections(created.node.nodeId, graph)
      return { ok: true, node: snapshot, state: created.state, revision: created.revision }
    }
    if (nodeType === 'goal') {
      const goal = listGoalNodes(projectRoot)[0]
      if (!goal) {
        throw new GoalNodeError('Goal node creation requires an active task capsule', {
          statusCode: 409,
          code: 'NO_ACTIVE_GOAL_TASK',
        })
      }
      const graph = loadWorkflowGraphMap(projectRoot)
      if (isDeletedGraphNode(graph, goal.nodeId)) {
        restoreWorkflowGraphNode(projectRoot, goal.nodeId)
      }
      if (stablePayload.position && typeof stablePayload.position === 'object' && !Array.isArray(stablePayload.position)) {
        moveWorkflowNode(projectRoot, goal.nodeId, stablePayload.position)
      }
      initSettings(projectRoot, goal.nodeId, 'goal')
      const current = getGoalNode(projectRoot, goal.nodeId)
      const settings = readNodeSettings(projectRoot, current.node.nodeId, 'goal')
      const snapshot = buildGoalNodeSnapshot(current.node, current.state, settings)
      const freshGraph = loadWorkflowGraphMap(projectRoot)
      snapshot.graph.position = freshGraph.positions?.[current.node.nodeId] || snapshot.graph.position
      snapshot.graph.connections = buildConnections(current.node.nodeId, freshGraph)
      return { ok: true, node: snapshot, state: current.state, revision: current.revision }
    }
    const created = createComponentNode(projectRoot, payload)
    initSettings(projectRoot, created.node.nodeId, created.node.type)
    recordCreatedNodeGraphOp(projectRoot, created, 'componentState', payload)
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
    try {
      const updated = updateComponentNode(projectRoot, nodeId, payload)
      const settings = readNodeSettings(projectRoot, updated.node.nodeId)
      const snapshot = buildNodeSnapshot(updated.node, updated.state, settings)
      const graph = loadWorkflowGraphMap(projectRoot)
      snapshot.graph.connections = buildConnections(updated.node.nodeId, graph)
      return { ok: true, node: snapshot, state: updated.state, revision: updated.revision }
    } catch (e) {
      if (!(e.code === 'NOT_FOUND' || e.code === 'BAD_REQUEST')) throw e
      try {
        const updated = updateEventNode(projectRoot, nodeId, payload)
        const settings = readNodeSettings(projectRoot, updated.node.nodeId, updated.node.type)
        const snapshot = buildEventNodeSnapshot(updated.node, updated.state, settings)
        const graph = loadWorkflowGraphMap(projectRoot)
        snapshot.graph.connections = buildConnections(updated.node.nodeId, graph)
        return { ok: true, node: snapshot, state: updated.state, revision: updated.revision }
      } catch (eventError) {
        if (!(eventError.code === 'NOT_FOUND' || eventError.code === 'BAD_REQUEST')) throw eventError
        const updated = updateCapabilityNode(projectRoot, nodeId, payload)
        const settings = readNodeSettings(projectRoot, updated.node.nodeId, updated.node.type)
        const snapshot = buildCapabilityNodeSnapshot(updated.node, updated.state, settings)
        const graph = loadWorkflowGraphMap(projectRoot)
        snapshot.graph.connections = buildConnections(updated.node.nodeId, graph)
        return { ok: true, node: snapshot, state: updated.state, revision: updated.revision }
      }
    }
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
    try {
      const current = getEventNode(projectRoot, nodeId)
      writeNodeSettings(projectRoot, current.node.nodeId, payload, current.node.type)
      const settings = readNodeSettings(projectRoot, current.node.nodeId, current.node.type)
      const snapshot = buildEventNodeSnapshot(current.node, current.state, settings)
      snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
      return { ok: true, node: snapshot, settings }
    } catch (eventError) {
      if (!(eventError.code === 'NOT_FOUND' || eventError.code === 'BAD_REQUEST')) {
        throw eventError
      }
    }
    try {
      const current = getCapabilityNode(projectRoot, nodeId)
      writeNodeSettings(projectRoot, current.node.nodeId, payload, current.node.type)
      const settings = readNodeSettings(projectRoot, current.node.nodeId, current.node.type)
      const snapshot = buildCapabilityNodeSnapshot(current.node, current.state, settings)
      snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
      return { ok: true, node: snapshot, settings }
    } catch (capabilityError) {
      if (!(capabilityError.code === 'NOT_FOUND' || capabilityError.code === 'BAD_REQUEST')) {
        throw capabilityError
      }
    }
    try {
      const current = getGoalNode(projectRoot, nodeId)
      if (isDeletedGraphNode(graph, current.node.nodeId)) {
        throw new GoalNodeError(`Goal node not found: ${current.node.nodeId}`, {
          statusCode: 404,
          code: 'NOT_FOUND',
        })
      }
      writeNodeSettings(projectRoot, current.node.nodeId, payload, 'goal')
      const settings = readNodeSettings(projectRoot, current.node.nodeId, 'goal')
      const snapshot = buildGoalNodeSnapshot(current.node, current.state, settings)
      snapshot.graph.position = graph.positions?.[current.node.nodeId] || snapshot.graph.position
      snapshot.graph.connections = buildConnections(current.node.nodeId, graph)
      return { ok: true, node: snapshot, settings }
    } catch (goalError) {
      if (isDeletedGraphNode(graph, nodeId)) {
        throw goalError
      }
      if (!(goalError.code === 'NOT_FOUND' || goalError.code === 'BAD_REQUEST')) {
        throw goalError
      }
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

export async function executeNodeAction(projectRoot, nodeId, action, payload = {}, options = {}) {
  try {
    const actionName = String(action || '').trim()
    if (actionName === 'node.delete') {
      return deleteNode(projectRoot, nodeId, { action: 'node.delete', actor: { kind: 'human', nodeId: '', sessionId: '' } })
    }
    if (actionName === 'node.restore') {
      return restoreNode(projectRoot, nodeId, payload)
    }
    const separator = actionName.indexOf('.')
    const prefix = separator === -1 ? actionName : actionName.slice(0, separator)
    const suffix = separator === -1 ? '' : actionName.slice(separator + 1)
    if (prefix === 'agent' && AGENT_GRAPH_ACTIONS.has(suffix)) {
      return executeAgentGraphAction(projectRoot, nodeId, actionName, suffix, payload)
    }
    if (prefix === 'agent' && suffix === 'readContext') {
      const canonical = await getNodeContext(projectRoot, nodeId)
      return {
        ok: true,
        action: actionName,
        node: canonical.node,
        result: canonical.context,
        context: canonical.context,
      }
    }
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

    if (isAgentAction) {
      // Agent nodes live in the graph-map. The handler gets (nodeId, projectRoot, payload).
      const result = await handler(nodeId, projectRoot, payload)
      // Build agent snapshot
      const graph = loadWorkflowGraphMap(projectRoot)
      const graphNode = findAgentGraphNode(graph, nodeId)
      const snapshot = graphNode ? buildAgentSnapshot(projectRoot, graphNode, graph) : null
      return { ok: result?.ok === false ? false : true, action: actionName, node: snapshot, result }
    }

    if (EVENT_NODE_TYPES.has(prefix)) {
      const current = getEventNode(projectRoot, nodeId)
      let actionPayload = payload
      if (current.node.type === 'timer') {
        // F1/F3: timer.fire / timer.tick / timer.dispatchWakeup stay
        // backend-internal — the HTTP surface denies every actor except the
        // main/controller agent and the internal scheduler marker.
        assertTimerInternalActionAllowed(projectRoot, nodeId, suffix, payload, options)
        if (typeof TimerNode.isTimerControlAction === 'function' && TimerNode.isTimerControlAction(suffix)) {
          const graph = loadWorkflowGraphMap(projectRoot)
          const actor = resolveAgentActionActor(graph, payload, options, EventNodeError)
          actionPayload = actor.payload
          if (actor.agentAuthored && !hasTimerControlEdge(graph, actor.actorNodeId, current.node.nodeId)) {
            throw new EventNodeError('Timer control action requires a source-to-target control edge from actor to timer', {
              statusCode: 403,
              code: 'CONTROL_EDGE_REQUIRED',
            })
          }
        }
      }
      const result = await handler(current.node.nodeId, projectRoot, actionPayload)
      const fresh = getEventNode(projectRoot, current.node.nodeId)
      const settings = readNodeSettings(projectRoot, current.node.nodeId, current.node.type)
      const snapshot = buildEventNodeSnapshot(fresh.node, fresh.state, settings)
      const graph = loadWorkflowGraphMap(projectRoot)
      snapshot.graph.connections = buildConnections(fresh.node.nodeId, graph)
      // Top-level `state` carries the full updated event-node state (heartbeat.base.nextDueAt etc.)
      // so the frontend can reconcile instantly from the action response, per the
      // WorkflowRuntimeNodeResponse contract. `result` remains the raw adapter result.
      return { ok: true, action: actionName, node: snapshot, state: fresh.state, revision: fresh.node.revision, result }
    }

    if (prefix === 'goal') {
      const current = getGoalNode(projectRoot, nodeId)
      const graph = loadWorkflowGraphMap(projectRoot)
      if (isDeletedGraphNode(graph, current.node.nodeId)) {
        throw new GoalNodeError(`Goal node not found: ${current.node.nodeId}`, {
          statusCode: 404,
          code: 'NOT_FOUND',
        })
      }
      const actor = suffix === 'read'
        ? { agentAuthored: false, payload }
        : resolveAgentActionActor(graph, payload, options, GoalNodeError)
      if (actor.agentAuthored && !hasGoalActionEdge(graph, actor.actorNodeId, current.node.nodeId)) {
        throw new GoalNodeError('Goal action requires a bidirectional goal edge from actor to goal', {
          statusCode: 403,
          code: 'GOAL_EDGE_REQUIRED',
        })
      }
      const result = await handler(current.node.nodeId, projectRoot, actor.payload)
      const fresh = getGoalNode(projectRoot, current.node.nodeId)
      const settings = readNodeSettings(projectRoot, current.node.nodeId, 'goal')
      const snapshot = buildGoalNodeSnapshot(fresh.node, fresh.state, settings)
      const freshGraph = loadWorkflowGraphMap(projectRoot)
      snapshot.graph.position = freshGraph.positions?.[fresh.node.nodeId] || snapshot.graph.position
      snapshot.graph.connections = buildConnections(fresh.node.nodeId, freshGraph)
      return { ok: true, action: actionName, node: snapshot, result }
    }

    if (prefix === 'skill-group' || prefix === 'mcp-connector') {
      const current = getCapabilityNode(projectRoot, nodeId)
      const result = await handler(current.node.nodeId, projectRoot, payload)
      const fresh = getCapabilityNode(projectRoot, current.node.nodeId)
      const settings = readNodeSettings(projectRoot, current.node.nodeId, current.node.type)
      const snapshot = buildCapabilityNodeSnapshot(fresh.node, fresh.state, settings)
      const graph = loadWorkflowGraphMap(projectRoot)
      snapshot.graph.connections = buildConnections(fresh.node.nodeId, graph)
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

// P5: capture the delete-op slice (full node record + state + affected edges)
// BEFORE the graph node is removed so undo can restore the node and its edges.
function recordDeleteNodeGraphOp(projectRoot, { node, state = null, stateField = null, graph, action, actor }) {
  const nodeId = String(node?.nodeId || node?.id || '').trim()
  if (!nodeId) return null
  const record = {
    ...node,
    position: graph?.positions?.[nodeId] || node?.position,
  }
  if (stateField && state !== undefined && state !== null) record[stateField] = state
  const affectedEdges = (Array.isArray(graph?.edges) ? graph.edges : []).filter(edge => {
    const from = String(edge?.from || edge?.source || '')
    const to = String(edge?.to || edge?.target || '')
    return from === nodeId || to === nodeId
      || Boolean(node?.sessionId && (from === node.sessionId || to === node.sessionId))
  })
  return recordGraphOp(projectRoot, {
    action: action || 'agent.deleteNode',
    actor,
    inverse: { nodes: [record], edges: affectedEdges },
    forward: { nodes: [{ ...record, _removed: true }], edges: affectedEdges.map(edge => ({ ...edge, _removed: true })) },
  })
}

export async function deleteNode(projectRoot, nodeId, historyOptions = {}) {
  try {
    const historyAction = historyOptions.action || 'deleteNode'
    const historyActor = historyOptions.actor || { kind: 'human', nodeId: '', sessionId: '' }
    try {
      let current = null
      try {
        current = getComponentNode(projectRoot, nodeId)
      } catch (error) {
        if (!(error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST' || error.code === 'STATE_MISMATCH')) throw error
      }
      const graphBeforeDelete = loadWorkflowGraphMap(projectRoot)
      const removed = deleteComponentNode(projectRoot, nodeId)
      deleteNodeSettings(projectRoot, nodeId)
      const recorded = recordDeleteNodeGraphOp(projectRoot, {
        node: current?.node || removed.removed,
        state: current?.state || null,
        stateField: 'componentState',
        graph: graphBeforeDelete,
        action: historyAction,
        actor: historyActor,
      })
      const graphResult = removeWorkflowGraphNode(projectRoot, nodeId, {
        node: current?.node || removed.removed,
        edges: graphBeforeDelete.edges,
        ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
      })
      return { ok: true, nodeId: removed.nodeId, removed: removed.removed, recovery: { node: current?.node || removed.removed, state: current?.state || null, graph: graphResult.removed } }
    } catch (e) {
        if (!(e.code === 'NOT_FOUND' || e.code === 'BAD_REQUEST')) throw e
        try {
          const current = getEventNode(projectRoot, nodeId)
          const graphBeforeDelete = loadWorkflowGraphMap(projectRoot)
          const removed = deleteEventNode(projectRoot, nodeId)
          deleteNodeSettings(projectRoot, nodeId, removed.removed?.type || 'timer')
          const recorded = recordDeleteNodeGraphOp(projectRoot, {
            node: current.node,
            state: current.state,
            stateField: 'eventState',
            graph: graphBeforeDelete,
            action: historyAction,
            actor: historyActor,
          })
          const graphResult = removeWorkflowGraphNode(projectRoot, nodeId, {
            node: current.node,
            edges: graphBeforeDelete.edges,
            ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
          })
        return { ok: true, nodeId: removed.nodeId, removed: removed.removed, recovery: { node: current.node, state: current.state, graph: graphResult.removed } }
      } catch (eventError) {
          if (!(eventError.code === 'NOT_FOUND' || eventError.code === 'BAD_REQUEST')) throw eventError
          try {
            const current = getCapabilityNode(projectRoot, nodeId)
            const graphBeforeDelete = loadWorkflowGraphMap(projectRoot)
            const removed = deleteCapabilityNode(projectRoot, nodeId)
            deleteNodeSettings(projectRoot, nodeId, removed.removed?.type || 'skill-group')
            const recorded = recordDeleteNodeGraphOp(projectRoot, {
              node: current.node,
              state: current.state,
              stateField: 'capabilityState',
              graph: graphBeforeDelete,
              action: historyAction,
              actor: historyActor,
            })
            const graphResult = removeWorkflowGraphNode(projectRoot, nodeId, {
              node: current.node,
              edges: graphBeforeDelete.edges,
              ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
            })
          return { ok: true, nodeId: removed.nodeId, removed: removed.removed, recovery: { node: current.node, state: current.state, graph: graphResult.removed } }
        } catch (capabilityError) {
          if (!(capabilityError.code === 'NOT_FOUND' || capabilityError.code === 'BAD_REQUEST')) throw capabilityError
          try {
            const current = getGoalNode(projectRoot, nodeId)
            deleteNodeSettings(projectRoot, current.node.nodeId, 'goal')
            const recorded = recordDeleteNodeGraphOp(projectRoot, {
              node: current.node,
              graph: loadWorkflowGraphMap(projectRoot),
              action: historyAction,
              actor: historyActor,
            })
            const graphResult = removeWorkflowGraphNode(projectRoot, current.node.nodeId, {
              node: current.node,
              ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
            })
            return { ok: true, nodeId: current.node.nodeId, removed: current.node, graph: graphResult.graph, recovery: { node: current.node, state: current.state, graph: graphResult.removed } }
          } catch (goalError) {
            if (!(goalError.code === 'NOT_FOUND' || goalError.code === 'BAD_REQUEST')) throw goalError
            const graph = loadWorkflowGraphMap(projectRoot)
            const agentNode = findAgentGraphNode(graph, nodeId)
            if (!agentNode) throw capabilityError
            if (isLiveAgentGraphNode(agentNode)) {
              throw new ComponentNodeError('Stop the target Agent before deleting its graph node', {
                statusCode: 409,
                code: 'LIVE_AGENT_DELETE_REQUIRES_STOP',
              })
            }
            const recorded = recordDeleteNodeGraphOp(projectRoot, {
              node: agentNode,
              graph,
              action: historyAction,
              actor: historyActor,
            })
            const graphResult = removeWorkflowGraphNode(projectRoot, nodeId, {
              node: agentNode,
              ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
            })
            return { ok: true, nodeId: graphNodeKey(agentNode), removed: agentNode, graph: graphResult.graph, recovery: { node: agentNode, graph: graphResult.removed } }
          }
        }
      }
    }
  } catch (error) {
    throw asComponentNodeError(error)
  }
}

export async function restoreNode(projectRoot, nodeId, payload = {}) {
  try {
    const recovery = payload?.recovery && typeof payload.recovery === 'object'
      ? payload.recovery
      : payload;
    const snapshot = recovery?.node || recovery;
    const graphId = String(recovery?.graphId || snapshot?.graphNodeId || snapshot?.nodeId || nodeId || '').trim();
    const nodeKind = String(snapshot?.type || snapshot?.componentType || snapshot?.kind || '').trim().toLowerCase();
    if (nodeKind === 'markdown' || nodeKind === 'excalidraw' || nodeKind === 'file') {
      restoreComponentNode(projectRoot, { node: { ...snapshot, nodeId: snapshot.nodeId || nodeId, type: nodeKind }, state: snapshot.componentState });
    } else if (nodeKind === 'timer' || nodeKind === 'github-trigger') {
      restoreEventNode(projectRoot, { node: { ...snapshot, nodeId: snapshot.nodeId || nodeId, type: nodeKind }, state: snapshot.eventState });
    } else if (nodeKind === 'skill-group' || nodeKind === 'mcp-connector') {
      restoreCapabilityNode(projectRoot, { node: { ...snapshot, nodeId: snapshot.nodeId || nodeId, type: nodeKind }, state: snapshot.capabilityState });
    }
    restoreWorkflowGraphNode(projectRoot, graphId);
    const restored = await getNode(projectRoot, graphId);
    return { ok: true, action: 'node.restore', node: restored.node, result: restored };
  } catch (error) {
    throw asComponentNodeError(error);
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
        try {
          const eventNode = getEventNode(projectRoot, nodeId)
          const settings = readNodeSettings(projectRoot, eventNode.node.nodeId, eventNode.node.type)
          const snapshot = buildEventNodeSnapshot(eventNode.node, eventNode.state, settings)
          const connections = buildConnections(eventNode.node.nodeId, graph)
          const ontology = buildNodeOntologyContext({
            nodeId: eventNode.node.nodeId,
            nodeType: eventNode.node.type,
            connections,
          })
          snapshot.graph.connections = connections
          return {
            ok: true,
            node: snapshot,
            context: {
              nodeId: eventNode.node.nodeId,
              graphVersion: Number(graph.version || 1),
              connectedPeers: connections.map(connection => ({ nodeId: connection.peerNodeId })),
              eventStateRefs: eventStateRefs(projectRoot),
              ontology,
              affordances: ontology.affordances,
            },
          }
        } catch (eventError) {
          if (!(eventError.code === 'NOT_FOUND' || eventError.code === 'BAD_REQUEST')) {
            throw eventError
          }
        }
        try {
          const capabilityNode = getCapabilityNode(projectRoot, nodeId)
          const settings = readNodeSettings(projectRoot, capabilityNode.node.nodeId, capabilityNode.node.type)
          const snapshot = buildCapabilityNodeSnapshot(capabilityNode.node, capabilityNode.state, settings)
          const connections = buildConnections(capabilityNode.node.nodeId, graph)
          const ontology = buildNodeOntologyContext({
            nodeId: capabilityNode.node.nodeId,
            nodeType: capabilityNode.node.type,
            connections,
          })
          snapshot.graph.connections = connections
          return {
            ok: true,
            node: snapshot,
            context: {
              nodeId: capabilityNode.node.nodeId,
              graphVersion: Number(graph.version || 1),
              connectedPeers: connections.map(connection => ({ nodeId: connection.peerNodeId })),
              capabilityStateRefs: capabilityStateRefs(projectRoot),
              ontology,
              affordances: ontology.affordances,
            },
          }
        } catch (capabilityError) {
          if (!(capabilityError.code === 'NOT_FOUND' || capabilityError.code === 'BAD_REQUEST')) {
            throw capabilityError
          }
        }
        try {
          const goalNode = getGoalNode(projectRoot, nodeId)
          if (isDeletedGraphNode(graph, goalNode.node.nodeId)) {
            throw new GoalNodeError(`Goal node not found: ${goalNode.node.nodeId}`, {
              statusCode: 404,
              code: 'NOT_FOUND',
            })
          }
          const settings = readNodeSettings(projectRoot, goalNode.node.nodeId, 'goal')
          const snapshot = buildGoalNodeSnapshot(goalNode.node, goalNode.state, settings)
          const connections = buildConnections(goalNode.node.nodeId, graph)
          const ontology = buildNodeOntologyContext({
            nodeId: goalNode.node.nodeId,
            nodeType: 'goal',
            connections,
          })
          snapshot.graph.position = graph.positions?.[goalNode.node.nodeId] || snapshot.graph.position
          snapshot.graph.connections = connections
          return {
            ok: true,
            node: snapshot,
            context: {
              nodeId: goalNode.node.nodeId,
              graphVersion: Number(graph.version || 1),
              connectedPeers: connections.map(connection => ({ nodeId: connection.peerNodeId })),
              goalStateRefs: goalStateRefsForGraph(projectRoot, graph),
              ontology,
              affordances: ontology.affordances,
            },
          }
        } catch (goalError) {
          if (isDeletedGraphNode(graph, nodeId)) {
            throw goalError
          }
          if (!(goalError.code === 'NOT_FOUND' || goalError.code === 'BAD_REQUEST')) {
            throw goalError
          }
        }
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
    const ontology = buildNodeOntologyContext({
      nodeId: current.node.nodeId,
      nodeType: current.node.type,
      connections,
    })
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
        ontology,
        affordances: ontology.affordances,
      },
    }
  } catch (error) {
    throw asComponentNodeError(error)
  }
}
