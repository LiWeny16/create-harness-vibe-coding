import path from 'node:path'
import { loadActionRegistry, actionsForNodeType } from './action-registry.mjs'

const ONTOLOGY_ID = 'harness.workflow.ontology'
const ONTOLOGY_VERSION = 1

// ── Static fallback catalog ────────────────────────────────────────────────
// The action arrays below are the pre-registry documentation-of-record
// fallback. They are used verbatim only when Harness/a2a/action-registry.json
// is missing or unreadable (e.g. throwaway temp roots in tests). The live
// catalog (buildOntologyCatalog) derives the same per-nodeType buckets from
// the action registry; prose fields (descriptions, classes, roles, relations)
// always come from this static base.
const STATIC_AGENT_GRAPH_ACTIONS = [
  'agent.createNode',
  'agent.connectNodes',
  'agent.disconnectNodes',
  'agent.moveNode',
  'agent.deleteNode',
  'agent.deleteNodes',
  'agent.readGraph',
]

const STATIC_TIMER_CONTROL_ACTIONS = [
  'timer.configure',
  'timer.enable',
  'timer.disable',
  'timer.setInterval',
  'timer.setMode',
  'timer.ackWatchdog',
  'timer.resetWatchdog',
]

const STATIC_ONTOLOGY = {
  ontologyId: ONTOLOGY_ID,
  version: ONTOLOGY_VERSION,
  description: 'Lightweight workflow ontology for agent-readable node map semantics.',
  nodeClasses: {
    agent: {
      role: 'executor-controller',
      description: 'Runs terminal work and may operate the graph through backend APIs.',
    },
    resource: {
      role: 'read-write-context',
      description: 'Human/agent editable context such as Markdown and Excalidraw.',
    },
    event: {
      role: 'trigger-source',
      description: 'Emits events and may expose a separate control relation.',
    },
    capability: {
      role: 'capability-provider',
      description: 'Adds skills or connector metadata to a connected Agent.',
    },
    goal: {
      role: 'objective-anchor',
      description: 'Stores task objective, Agent-filled plan items, acceptance, progress, and completion proposal state.',
    },
    graph: {
      role: 'node-map-control-plane',
      description: 'Workflow map mutation surface; canvas agent spawn is depth-gated to the root agent (spawnRule root-only).',
    },
    node: {
      role: 'node-lifecycle',
      description: 'Lifecycle actions (delete/restore) that apply to any workflow node by id.',
    },
  },
  nodeTypes: {
    agent: {
      class: 'agent',
      readableActions: ['agent.readContext', 'agent.readOutput', 'agent.readTranscript', 'agent.readMessages'],
      controlActions: ['agent.start', 'agent.stop', 'agent.restart', 'agent.sendInput', 'agent.sendMessage', 'agent.broadcastMessage', 'agent.deleteAgentNode', 'agent.delete', 'agent.setModel', 'agent.layout'],
    },
    markdown: {
      class: 'resource',
      relation: 'context',
      direction: 'bidirectional',
      readableActions: ['markdown.read', 'markdown.find'],
      writableActions: ['markdown.patch', 'markdown.replace', 'markdown.append', 'markdown.save', 'markdown.acquireLock', 'markdown.releaseLock'],
    },
    excalidraw: {
      class: 'resource',
      relation: 'context',
      direction: 'bidirectional',
      readableActions: ['excalidraw.readScene', 'excalidraw.renderPreview'],
      writableActions: ['excalidraw.patchScene', 'excalidraw.saveScene'],
    },
    file: {
      class: 'resource',
      relation: 'context',
      direction: 'bidirectional',
      readableActions: ['file.readMeta', 'file.readText', 'file.readBytes', 'file.refresh', 'file.preview'],
      writableActions: ['file.writeText'],
    },
    timer: {
      class: 'event',
      eventRelation: { relation: 'event', direction: 'source-to-target' },
      controlRelation: { relation: 'control', direction: 'source-to-target', from: 'agent', to: 'timer' },
      readableActions: ['timer.read'],
      controlActions: STATIC_TIMER_CONTROL_ACTIONS,
      runtimeActions: ['timer.fire', 'timer.tick', 'timer.dispatchWakeup'],
    },
    'github-trigger': {
      class: 'event',
      status: 'planned',
      experimentalOnly: true,
      createRequiresExperimental: true,
      eventRelation: { relation: 'event', direction: 'source-to-target' },
      readableActions: ['github-trigger.read'],
      controlActions: ['github-trigger.configure'],
      runtimeActions: ['github-trigger.receive'],
    },
    'skill-group': {
      class: 'capability',
      relation: 'capability',
      direction: 'bidirectional',
      readableActions: ['skill-group.read'],
      controlActions: ['skill-group.setSkillEnabled', 'skill-group.configure'],
    },
    'mcp-connector': {
      class: 'capability',
      relation: 'capability',
      direction: 'bidirectional',
      readableActions: ['mcp-connector.read'],
      controlActions: ['mcp-connector.configure'],
    },
    goal: {
      class: 'goal',
      relation: 'goal',
      direction: 'bidirectional',
      readableActions: ['goal.read'],
      writableActions: ['goal.update', 'goal.requestCompletion', 'goal.returnToWork', 'goal.ackWatchdog', 'goal.add', 'goal.delete', 'goal.replace', 'goal.check', 'goal.uncheck', 'goal.complete', 'goal.reopen'],
    },
    node: {
      class: 'node',
      relation: 'wf-bridge',
      direction: 'bidirectional',
      controlActions: ['node.delete', 'node.restore'],
    },
    'workflow-graph': {
      class: 'graph',
      readableActions: ['agent.readGraph'],
      controlActions: STATIC_AGENT_GRAPH_ACTIONS,
      spawnRules: [
        {
          actionId: 'agent.createNode',
          spawnRule: 'root-only',
          gate: 'root',
          description: 'Canvas agent spawn is depth-gated: only the root agent (no parentAgentId) may spawn canvas agent nodes; depth-1 agents may not. Runtime built-in subagents are unrestricted (inside the runtime, not the canvas).',
        },
      ],
    },
  },
  relations: {
    context: {
      defaultDirection: 'bidirectional',
      meaning: 'Connected context may be read by either side; resource nodes may also accept state writes.',
    },
    resource: {
      defaultDirection: 'bidirectional',
      meaning: 'Explicit read/write resource relation.',
    },
    event: {
      defaultDirection: 'source-to-target',
      meaning: 'Source emits event payloads to the target Agent.',
    },
    control: {
      defaultDirection: 'source-to-target',
      meaning: 'Source Agent may control target node actions that require authority.',
    },
    capability: {
      defaultDirection: 'bidirectional',
      meaning: 'Capability metadata is attached to the connected Agent context.',
    },
    goal: {
      defaultDirection: 'bidirectional',
      meaning: 'Connected Agent may read and update Goal node state through goal actions.',
    },
    'wf-bridge': {
      defaultDirection: 'bidirectional',
      meaning: 'Generic workflow bridge when a more specific semantic relation is not supplied.',
    },
    delegation: {
      defaultDirection: 'bidirectional',
      meaning: 'Connected Agent worker relation. All agents hold equal permissions (identity is a role label only); delegate by sending input and read worker context/output through typed agent actions.',
    },
  },
  operationLoop: ['observe', 'plan', 'act', 'verify', 'report'],
}

// ── Registry-driven catalog derivation ─────────────────────────────────────
// Per-nodeType action buckets come from Harness/a2a/action-registry.json at
// ontology-build time. The registry's nodeType field maps 1:1 to the ontology
// nodeTypes keys except 'workflow-graph', which is backed by registry nodeType
// 'graph' (the Main-Agent graph action surface).

const REGISTRY_NODE_TYPE = { 'workflow-graph': 'graph' }

// Read-side inference by action id suffix: read*/find/render*/preview/refresh.
const READ_ONLY_ACTION_SUFFIX = /^(read|find|render|preview|refresh)/

// Which buckets each ontology nodeType exposes. Bucket rules:
//   readable  = action ids whose suffix matches READ_ONLY_ACTION_SUFFIX
//   writable  = agent-authored actions that are not readable
//   runtime   = backend-internal actions (actor.agentAuthored === false)
//   control   = agent-authored actions that are not readable, except for the
//               'node'/'workflow-graph' lifecycle surfaces which expose every
//               registry action (agent.createNode … agent.readGraph, node.delete/restore)
const BUCKET_LAYOUTS = {
  agent: ['readable', 'control'],
  markdown: ['readable', 'writable'],
  excalidraw: ['readable', 'writable'],
  file: ['readable', 'writable'],
  timer: ['readable', 'control', 'runtime'],
  goal: ['readable', 'writable'],
  'skill-group': ['readable', 'control'],
  'mcp-connector': ['readable', 'control'],
  'github-trigger': ['readable', 'control', 'runtime'],
  node: ['control'],
  'workflow-graph': ['readable', 'control'],
}

function isReadOnlyActionId(actionId) {
  const suffix = String(actionId || '').split('.').pop() || ''
  return READ_ONLY_ACTION_SUFFIX.test(suffix)
}

// Depth rule derivation: registry actions whose actor.spawnGate === 'root'
// carry the root-only spawn rule in the catalog (equal permissions otherwise;
// only canvas agent spawn is depth-gated per decision D-C).
const SPAWN_RULE_DESCRIPTION = 'Canvas agent spawn is depth-gated: only the root agent (no parentAgentId) may spawn canvas agent nodes; depth-1 agents may not. Runtime built-in subagents are unrestricted (inside the runtime, not the canvas).'

function deriveSpawnRules(registry, registryType) {
  return actionsForNodeType(registry, registryType)
    .filter(action => action.actor?.spawnGate === 'root')
    .map(action => ({
      actionId: action.id,
      spawnRule: 'root-only',
      gate: 'root',
      description: SPAWN_RULE_DESCRIPTION,
    }))
}

function deriveNodeTypeEntry(registry, ontologyType, staticEntry = {}) {
  const layout = BUCKET_LAYOUTS[ontologyType]
  if (!layout) return staticEntry
  const registryType = REGISTRY_NODE_TYPE[ontologyType] || ontologyType
  const actions = actionsForNodeType(registry, registryType)
  const allIds = actions.map(action => action.id)
  const readableIds = actions.filter(action => isReadOnlyActionId(action.id)).map(action => action.id)
  const internalIds = actions.filter(action => action.actor?.agentAuthored === false).map(action => action.id)
  const authoredNonReadableIds = actions
    .filter(action => action.actor?.agentAuthored !== false && !isReadOnlyActionId(action.id))
    .map(action => action.id)
  const buckets = {}
  for (const bucket of layout) {
    if (bucket === 'readable') buckets.readableActions = readableIds
    if (bucket === 'writable') buckets.writableActions = authoredNonReadableIds
    if (bucket === 'runtime') buckets.runtimeActions = internalIds
    if (bucket === 'control') {
      buckets.controlActions = (ontologyType === 'node' || ontologyType === 'workflow-graph')
        ? allIds
        : authoredNonReadableIds
    }
  }
  const spawnRules = deriveSpawnRules(registry, registryType)
  return { ...staticEntry, ...buckets, ...(spawnRules.length > 0 ? { spawnRules } : {}) }
}

function mergeRegistryIntoOntology(registry) {
  const nodeTypes = {}
  for (const [ontologyType, staticEntry] of Object.entries(STATIC_ONTOLOGY.nodeTypes)) {
    nodeTypes[ontologyType] = deriveNodeTypeEntry(registry, ontologyType, staticEntry)
  }
  return { ...STATIC_ONTOLOGY, nodeTypes }
}

const catalogCache = new Map()

function buildOntologyCatalog(projectRoot = process.cwd()) {
  const cacheKey = path.resolve(projectRoot)
  const cached = catalogCache.get(cacheKey)
  if (cached) return cached
  let registry = null
  try {
    registry = loadActionRegistry(projectRoot)
  } catch {
    // Missing or unreadable registry (e.g. temp roots without Harness/a2a):
    // fall back to the static catalog so the ontology stays usable.
    registry = null
  }
  const catalog = registry ? mergeRegistryIntoOntology(registry) : STATIC_ONTOLOGY
  catalogCache.set(cacheKey, catalog)
  return catalog
}

// Module-default catalog: projectRoot resolution defaults to the process
// working directory, which is the repo root for the server and for tests.
const DEFAULT_CATALOG = buildOntologyCatalog(process.cwd())

// Constants referenced by the affordance logic. Their contents are
// registry-derived where ids match (identical to the static fallback while
// the registry is documentation-of-record), so affordance behavior stays
// driven by the same stable arrays.
const AGENT_GRAPH_ACTIONS = DEFAULT_CATALOG.nodeTypes['workflow-graph'].controlActions
const TIMER_CONTROL_ACTIONS = DEFAULT_CATALOG.nodeTypes.timer.controlActions

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function uniqueStrings(values) {
  const result = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

function relationOf(connection = {}) {
  return String(connection.relation || 'wf-bridge').trim() || 'wf-bridge'
}

function directionOf(connection = {}) {
  return String(connection.direction || '').trim() === 'source-to-target' ? 'source-to-target' : 'bidirectional'
}

function normalizedNodeType(ref = {}) {
  return String(ref.type || ref.eventKind || ref.capabilityKind || ref.kind || '').trim() || 'unknown'
}

function normalizeConnection(connection = {}) {
  return {
    edgeId: connection.edgeId || connection.id || '',
    endpointRole: connection.endpointRole || '',
    localHandle: connection.localHandle || null,
    peerHandle: connection.peerHandle || null,
    sourceHandle: connection.sourceHandle || null,
    targetHandle: connection.targetHandle || null,
    relation: relationOf(connection),
    direction: directionOf(connection),
  }
}

function refConnections(ref = {}) {
  const raw = Array.isArray(ref.connections)
    ? ref.connections
    : (ref.connection ? [ref.connection] : [])
  return raw.map(normalizeConnection)
}

function mergeConnectedRefs(refs = []) {
  const byNodeId = new Map()
  for (const ref of Array.isArray(refs) ? refs : []) {
    const nodeId = String(ref?.nodeId || ref?.skillId || '').trim()
    if (!nodeId) continue
    const existing = byNodeId.get(nodeId)
    if (!existing) {
      byNodeId.set(nodeId, {
        ...ref,
        nodeId,
        type: normalizedNodeType(ref),
        connections: refConnections(ref),
        allowedActions: uniqueStrings(ref.allowedActions),
      })
      continue
    }
    existing.connections = [...existing.connections, ...refConnections(ref)]
    existing.allowedActions = uniqueStrings([
      ...existing.allowedActions,
      ...uniqueStrings(ref.allowedActions),
    ])
  }
  return [...byNodeId.values()]
}

function hasControlEdgeFromAgent(ref = {}) {
  return refConnections(ref).some(connection => (
    relationOf(connection) === 'control'
    && directionOf(connection) === 'source-to-target'
    && connection.endpointRole === 'source'
  ))
}

function hasBidirectionalGoalEdge(ref = {}) {
  return refConnections(ref).some(connection => (
    isGoalRelation(connection)
    && directionOf(connection) === 'bidirectional'
  ))
}

function isGoalRelation(connection = {}) {
  const relation = relationOf(connection)
  return relation === 'goal' || relation.endsWith('/goal')
}

function connectionSummary(ref = {}) {
  const connections = refConnections(ref)
  return {
    relations: uniqueStrings(connections.map(connection => relationOf(connection))),
    directions: uniqueStrings(connections.map(connection => directionOf(connection))),
    endpointRoles: uniqueStrings(connections.map(connection => connection.endpointRole)),
    edgeIds: uniqueStrings(connections.map(connection => connection.edgeId)),
  }
}

function schemaForType(type, catalog = DEFAULT_CATALOG) {
  return catalog.nodeTypes[type] || {
    class: 'unknown',
    readableActions: [],
    writableActions: [],
    controlActions: [],
  }
}

function resourceAffordance(ref) {
  const type = normalizedNodeType(ref)
  const schema = schemaForType(type)
  const readActions = schema.readableActions || []
  const writeActions = schema.writableActions || []
  const canWrite = writeActions.length > 0
  const outputModality = type === 'excalidraw'
    ? 'diagram'
    : (type === 'markdown' ? 'text' : 'resource')
  return {
    nodeId: ref.nodeId,
    kind: ref.kind || 'component-node',
    type,
    nodeClass: 'resource',
    title: ref.title || ref.nodeId,
    relationship: 'connected-resource',
    relation: 'context',
    direction: 'bidirectional',
    priority: canWrite ? 'preferred-output-target' : 'read-context',
    outputModality,
    useWhen: canWrite
      ? (type === 'excalidraw'
          ? 'Prefer this connected Excalidraw node for diagrams, flowcharts, visual plans, and sketchable explanations.'
          : 'Prefer this connected Markdown node for long-form text, notes, plans, reports, and structured written output.')
      : 'Use this connected resource as read-only context.',
    preferredActions: canWrite ? writeActions : readActions,
    connection: connectionSummary(ref),
    canRead: readActions.length > 0,
    canWrite,
    canControl: false,
    allowedActions: uniqueStrings([...readActions, ...writeActions]),
    deniedActions: canWrite ? [] : ['state:update'],
    why: canWrite
      ? `${type} is a connected bidirectional resource, so the Agent can read and update its state through node actions.`
      : `${type} is readable context only; no write action is exposed by its adapter.`,
  }
}

function timerAffordance(ref) {
  const controlAllowed = hasControlEdgeFromAgent(ref)
  const policyAllowedActions = uniqueStrings(ref.allowedActions)
  const controlActions = policyAllowedActions.length > 0 ? policyAllowedActions : TIMER_CONTROL_ACTIONS
  const allowedActions = controlAllowed
    ? uniqueStrings(['timer.read', ...controlActions])
    : ['timer.read']
  return {
    nodeId: ref.nodeId,
    kind: ref.kind || 'event-node',
    type: 'timer',
    nodeClass: 'event',
    title: ref.title || ref.nodeId,
    relationship: controlAllowed ? 'connected-event-with-control' : 'connected-event',
    relation: controlAllowed ? 'event+control' : 'event',
    direction: 'source-to-target',
    connection: connectionSummary(ref),
    canRead: true,
    canWrite: false,
    canControl: controlAllowed,
    allowedActions,
    deniedActions: controlAllowed ? ['timer.fire', 'timer.tick', 'timer.dispatchWakeup'] : uniqueStrings([...TIMER_CONTROL_ACTIONS, 'timer.fire', 'timer.tick', 'timer.dispatchWakeup']),
    why: controlAllowed
      ? 'Timer has an Agent-to-Timer source-to-target control edge; timer control actions are available within timer policy.'
      : 'Timer is connected for event awareness only; add an Agent-to-Timer source-to-target control edge before configuring or feeding it.',
  }
}

function eventAffordance(ref) {
  const type = normalizedNodeType(ref)
  const schema = schemaForType(type)
  return {
    nodeId: ref.nodeId,
    kind: ref.kind || 'event-node',
    type,
    nodeClass: 'event',
    title: ref.title || ref.nodeId,
    relationship: 'connected-event',
    relation: 'event',
    direction: 'source-to-target',
    connection: connectionSummary(ref),
    canRead: true,
    canWrite: false,
    canControl: false,
    allowedActions: schema.readableActions || [],
    deniedActions: uniqueStrings([...(schema.controlActions || []), ...(schema.runtimeActions || [])]),
    why: `${type} is visible as an event source; control requires an explicit control relation when supported.`,
  }
}

function capabilityAffordance(ref) {
  const type = normalizedNodeType(ref)
  const schema = schemaForType(type)
  const readableActions = Array.isArray(schema.readableActions) && schema.readableActions.length > 0
    ? schema.readableActions
    : ['capability:read']
  return {
    nodeId: ref.nodeId,
    kind: ref.kind || 'capability-node',
    type,
    nodeClass: 'capability',
    title: ref.title || ref.name || ref.nodeId,
    relationship: ref.kind === 'skill' ? 'configured-capability' : 'connected-capability-provider',
    relation: 'capability',
    direction: 'bidirectional',
    connection: connectionSummary(ref),
    canRead: true,
    canWrite: false,
    canControl: false,
    allowedActions: readableActions,
    deniedActions: schema.controlActions || [],
    why: 'Capability nodes attach skills or connector metadata to the Agent context; they are not executor nodes.',
  }
}

function agentAffordance(ref) {
  const schema = schemaForType('agent')
  const readActions = schema.readableActions || []
  const controlActions = schema.controlActions || []
  const canDelegate = Boolean(ref.delegation?.canDelegate)
  return {
    nodeId: ref.nodeId,
    kind: ref.kind || 'agent-node',
    type: 'agent',
    nodeClass: 'agent',
    title: ref.title || ref.nodeId,
    relationship: canDelegate ? 'connected-agent-worker' : 'connected-agent-peer',
    relation: relationOf(ref.connection || ref),
    direction: directionOf(ref.connection || ref),
    connection: connectionSummary(ref),
    canRead: true,
    canWrite: false,
    canControl: canDelegate,
    canDelegate,
    allowedActions: uniqueStrings([...readActions, ...controlActions.filter(action => action !== 'agent.delete')]),
    deniedActions: ['agent.delete'],
    why: canDelegate
      ? 'This connected Agent is a live worker node. All agents share equal permissions (identity is a role label only); delegate with agent.sendInput and verify with agent.readOutput/readTranscript.'
      : 'Connected Agent nodes are peers with equal permissions. Read their output and control actions (agent.sendInput/start/stop/restart) are available to any connected agent.',
  }
}

function goalAffordance(ref) {
  const writeAllowed = hasBidirectionalGoalEdge(ref)
  const schema = schemaForType('goal')
  const writeActions = schema.writableActions || []
  return {
    nodeId: ref.nodeId,
    kind: ref.kind || 'goal-node',
    type: 'goal',
    nodeClass: 'goal',
    title: ref.title || ref.nodeId,
    relationship: writeAllowed ? 'connected-goal' : 'goal-visible-without-write-authority',
    relation: 'goal',
    direction: 'bidirectional',
    connection: connectionSummary(ref),
    canRead: true,
    canWrite: writeAllowed,
    canControl: writeAllowed,
    allowedActions: writeAllowed ? uniqueStrings([...(schema.readableActions || []), ...writeActions]) : (schema.readableActions || []),
    deniedActions: writeAllowed ? [] : writeActions,
    why: writeAllowed
      ? 'Goal has a bidirectional goal edge, so the Agent can read, update, and request completion through goal actions.'
      : 'Goal writes require a bidirectional goal edge from the Agent to the Goal node.',
  }
}

function graphAffordance() {
  return {
    nodeId: 'workflow-graph',
    kind: 'workflow-graph',
    type: 'workflow-graph',
    nodeClass: 'graph',
    title: 'Workflow Graph',
    relationship: 'control-plane',
    relation: 'control-plane',
    direction: 'self',
    connection: { relations: ['control-plane'], directions: ['self'], endpointRoles: ['actor'], edgeIds: [] },
    canRead: true,
    canWrite: true,
    canControl: true,
    allowedActions: AGENT_GRAPH_ACTIONS,
    deniedActions: [],
    why: 'All agents hold equal graph permissions (identity is a role label only). The only depth restriction is canvas agent spawn: the root agent (no parentAgentId) may spawn canvas agent nodes, depth-1 agents may not (spawnRule root-only on agent.createNode).',
  }
}

export function workflowOntology(projectRoot = process.cwd()) {
  return clone(buildOntologyCatalog(projectRoot))
}

export function buildNodeOntologyContext({ nodeId, nodeType, nodeClass = '', connections = [] } = {}) {
  const ontology = workflowOntology()
  const type = String(nodeType || '').trim() || 'unknown'
  const schema = schemaForType(type)
  return {
    ontologyId: ONTOLOGY_ID,
    version: ONTOLOGY_VERSION,
    self: {
      nodeId,
      type,
      nodeClass: nodeClass || schema.class || 'unknown',
      operationLoop: ontology.operationLoop,
    },
    schema,
    connections: (Array.isArray(connections) ? connections : []).map(normalizeConnection),
    affordances: [],
  }
}

export function buildAgentOntologyContext({
  nodeId,
  sessionId = null,
  agentKind = '',
  role = '',
  connections = [],
  connectedResourceRefs = [],
  connectedAgentRefs = [],
  connectedEventRefs = [],
  connectedCapabilityRefs = [],
  connectedCapabilityNodeRefs = [],
  connectedGoalRefs = [],
  effectiveSkills = [],
  isMainAgent = false,
} = {}) {
  const resourceAffordances = mergeConnectedRefs(connectedResourceRefs).map(resourceAffordance)
  const agentAffordances = mergeConnectedRefs(connectedAgentRefs).map(agentAffordance)
  const eventAffordances = mergeConnectedRefs(connectedEventRefs).map(ref => (
    normalizedNodeType(ref) === 'timer' ? timerAffordance(ref) : eventAffordance(ref)
  ))
  const capabilityAffordances = mergeConnectedRefs([
    ...connectedCapabilityRefs,
    ...connectedCapabilityNodeRefs,
  ]).map(capabilityAffordance)
  const goalAffordances = mergeConnectedRefs(connectedGoalRefs).map(goalAffordance)
  const affordances = [
    graphAffordance(),
    ...agentAffordances,
    ...resourceAffordances,
    ...eventAffordances,
    ...capabilityAffordances,
    ...goalAffordances,
  ]

  return {
    ontologyId: ONTOLOGY_ID,
    version: ONTOLOGY_VERSION,
    self: {
      nodeId,
      type: 'agent',
      nodeClass: 'agent',
      sessionId,
      agentKind,
      role,
      isMainAgent,
      operationLoop: DEFAULT_CATALOG.operationLoop,
    },
    nodeTypes: DEFAULT_CATALOG.nodeTypes,
    relations: DEFAULT_CATALOG.relations,
    effectiveSkills: uniqueStrings(effectiveSkills),
    connections: (Array.isArray(connections) ? connections : []).map(normalizeConnection),
    affordances,
  }
}
