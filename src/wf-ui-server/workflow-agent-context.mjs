// workflow-agent-context.mjs — SINGLE source of truth for the Agent-readable
// workflow context shape (architecture.md §3.9 / W39 audit).
//
// Both context-producing paths delegate here:
//   - API path:   workflow-node-runtime.mjs getNodeContext() -> buildAgentContext()
//   - Snapshot:   a2a-store.mjs buildSessionGraph() per-node context -> buildAgentContext()
//
// Every builder in this module is a pure function of
// (projectRoot, graphNode, graph, options?).  `graphNode` is the Agent graph
// node (either a persisted graph-map node or a live session node); `graph` is
// the normalized workflow graph map (loadWorkflowGraphMap).  Nothing here reads
// runtime-private state — the module owns the full context shape: identity,
// workspace, connected refs, effective skill groups, ontology, affordances,
// output routing, available actions, and magnetic topology.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadActionRegistry, actionsForNodeType } from './action-registry.mjs'
import { componentStateRefs, listLiveComponentNodes } from './component-node-store.mjs'
import { eventStateRefs } from './workflow-event-node-store.mjs'
import { capabilityStateRefs } from './workflow-capability-node-store.mjs'
import { goalStateRefs } from './workflow-goal-node-store.mjs'
import { getWorkspaceMeta, workspaceMimeForPath } from './workspace-store.mjs'
import { normalizeNodeConfig } from './node-config-store.mjs'
import { readNodeSettings } from './workflow-node-settings-store.mjs'
import { listTerminalSessions } from './terminal-store.mjs'
import { buildAgentOntologyContext } from './workflow-ontology.mjs'
import { readRoleProfile } from './workflow-node-types/role-profile-store.mjs'
// NOTE: computeMagneticTopology comes from a2a-store.mjs, which imports this
// module.  ESM circular imports are safe here because the binding is only used
// at call time, never at module-evaluation time.
import { computeMagneticTopology } from './a2a-store.mjs'
import { timerControlActionsForState } from './workflow-node-types/timer-node.mjs'

export const DEFAULT_AGENT_WORKFLOW_SKILLS = [
  'workflow-ontology',
  'workflow-node-map',
  'workflow-context',
  'workflow-node-actions',
  'terminal-control',
]
export const ON_DEMAND_AGENT_NODE_SKILLS = [
  'workflow-timer-node',
  'workflow-goal-node',
  'workflow-agent-node',
  'workflow-resource-node',
  'workflow-markdown-node',
  'workflow-diagram-node',
  'workflow-file-node',
  'workflow-skill-group-node',
  'workflow-mcp-connector-node',
]
const DEFAULT_AGENT_WORKFLOW_SKILL_TRIGGERS = {
  'workflow-ontology': [
    'workflow semantics',
    'node ontology',
    'node classes',
    'relation semantics',
    'action affordances',
    'choose capability',
    'choose connected node',
    'before acting',
    'semantics',
  ],
  'workflow-context': [
    'read context',
    'connected nodes',
    'connected resources',
    'connected agents',
    'goal refs',
    'timer refs',
    'effective skills',
    'observe before acting',
  ],
  'workflow-node-actions': [
    'node action',
    'write markdown',
    'append markdown',
    'draw diagram',
    'draw flowchart',
    'update excalidraw',
    'read timer',
    'configure timer',
    'timer interval',
    'start timer',
    'stop timer',
    'update goal',
    'send agent message',
    'broadcast agent message',
    'reply agent',
    'read bridge messages',
    'shared markdown context',
    'agent direct message',
    'agent group message',
    '发送消息',
    '群发消息',
    '回复 Agent',
    '共享上下文',
    '共享 Markdown',
    'delegate agent',
    'read agent output',
  ],
  'workflow-timer-node': [
    'timer node',
    'timer control',
    'timer interval',
    'configure timer',
    'start timer',
    'stop timer',
    'timer countdown',
    'health check timer',
  ],
  'workflow-goal-node': [
    'goal node',
    'goal update',
    'acceptance',
    'request completion',
    'return to work',
    'goal watchdog',
  ],
  'workflow-agent-node': [
    'agent node',
    'delegate agent',
    'send agent message',
    'broadcast agent message',
    'reply agent',
    'read bridge messages',
    'shared context',
    'agent direct message',
    'agent group message',
    '发送消息',
    '群发消息',
    '回复 Agent',
    '共享上下文',
    '共享 Markdown',
    'read agent output',
    'read transcript',
    'start agent',
    'stop agent',
  ],
  'workflow-resource-node': [
    'resource node',
    'markdown node',
    'file node',
    'diagram node',
    'excalidraw node',
    'connected output',
  ],
  'workflow-markdown-node': [
    'markdown node',
    'write notes',
    'append markdown',
    'replace markdown',
    'connected markdown',
    'durable text output',
  ],
  'workflow-diagram-node': [
    'diagram node',
    'excalidraw node',
    'draw diagram',
    'draw flowchart',
    'save scene',
    'connected diagram',
    'visual output',
  ],
  'workflow-file-node': [
    'file node',
    'read file',
    'file metadata',
    'workspace file',
    'uploaded file',
    'connected file',
  ],
  'workflow-skill-group-node': [
    'skill group node',
    'skill bundle',
    'capability pack',
    'connected skill group',
    'attached skills',
  ],
  'workflow-mcp-connector-node': [
    'mcp connector node',
    'mcp node',
    'mcp tools',
    'mcp resources',
    'connected mcp',
    'capability provider',
  ],
  'workflow-node-map': [
    'read graph',
    'create node',
    'connect nodes',
    'disconnect nodes',
    'move node',
    'delete node',
    'spawn agent node',
    'delegate worker',
    'control canvas',
    'arrange workflow',
  ],
  'terminal-control': [
    'terminal input',
    'read terminal',
    'send input',
    'transcript',
  ],
}

// ── action-registry-derived affordance lists ───────────────────────────────
//
// The Agent-readable action lists (availableActions, agent snapshot
// capabilities, and per-node-type capabilities) are derived from
// Harness/a2a/action-registry.json instead of hand-maintained literals
// (W39 audit). Two adapters keep the derived output identical to the legacy
// output for every pre-existing case:
//   - REGISTRY_ID_TO_CAPABILITY_KEY maps registry ids to the legacy capability
//     key names (e.g. 'file.readMeta' -> 'meta:read'); registry ids without an
//     entry are not exposed.
//   - SYNTHETIC_CAPABILITY_KEYS re-emits legacy keys that have no registry id
//     ('state:read', 'state:update', 'event:emit', 'capability:read',
//     'mcp:metadata:read').
// The visible changes are exactly the W39 audit fixes: availableActions gains
// agent.setModel / node.delete / node.restore, file capabilities gain
// file.writeText / file.preview, and skill-group capabilities gain
// skill-group.setSkillEnabled.
//
// The registry is resolved per call with a warning-free fallback chain:
// explicit projectRoot, then process.cwd(), then the repo root of this module
// (two levels above src/wf-ui-server/). The legacy literal lists below are
// used ONLY when no candidate root has a registry (non-scaffold projects).

// Repo root of this module: <root>/src/wf-ui-server/workflow-agent-context.mjs
const MODULE_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let fallbackRegistry = null

function resolveActionRegistry(projectRoot = '') {
  if (projectRoot) {
    try {
      return loadActionRegistry(projectRoot)
    } catch {
      // no registry at the explicit project root — try the default roots
    }
  }
  if (fallbackRegistry) return fallbackRegistry
  for (const root of [process.cwd(), MODULE_PROJECT_ROOT]) {
    try {
      fallbackRegistry = loadActionRegistry(root)
      if (fallbackRegistry) return fallbackRegistry
    } catch {
      // missing/invalid registry at this root — try the next
    }
  }
  return null
}

const REGISTRY_ID_TO_CAPABILITY_KEY = {
  // markdown
  'markdown.read': 'state:read',
  'markdown.patch': 'state:update',
  'markdown.append': 'markdown:append',
  'markdown.replace': 'markdown:replace',
  'markdown.find': 'markdown.find',
  'markdown.acquireLock': 'markdown.acquireLock',
  'markdown.releaseLock': 'markdown.releaseLock',
  // excalidraw
  'excalidraw.readScene': 'excalidraw:read',
  'excalidraw.patchScene': 'excalidraw:update',
  // file
  'file.readMeta': 'meta:read',
  'file.readBytes': 'bytes:read',
  'file.readText': 'text:read',
  'file.writeText': 'file.writeText',
  'file.preview': 'file.preview',
  // timer (timer.dispatchWakeup stays unexposed: scheduler-internal)
  'timer.read': 'timer.read',
  'timer.configure': 'timer.configure',
  'timer.fire': 'timer.fire',
  'timer.enable': 'timer.enable',
  'timer.disable': 'timer.disable',
  'timer.setInterval': 'timer.setInterval',
  'timer.setMode': 'timer.setMode',
  'timer.ackWatchdog': 'timer.ackWatchdog',
  'timer.resetWatchdog': 'timer.resetWatchdog',
  'timer.tick': 'timer.tick',
  // github-trigger
  'github-trigger.read': 'github-trigger.read',
  'github-trigger.receive': 'github-trigger.receive',
  'github-trigger.configure': 'github-trigger.configure',
  // skill-group
  'skill-group.read': 'skill-group.read',
  'skill-group.configure': 'skill-group.configure',
  'skill-group.setSkillEnabled': 'skill-group.setSkillEnabled',
  // mcp-connector
  'mcp-connector.read': 'mcp-connector.read',
  'mcp-connector.configure': 'mcp-connector.configure',
  // goal
  'goal.read': 'goal.read',
  'goal.update': 'goal.update',
  'goal.requestCompletion': 'goal.requestCompletion',
  'goal.returnToWork': 'goal.returnToWork',
  'goal.add': 'goal.add',
  'goal.delete': 'goal.delete',
  'goal.replace': 'goal.replace',
  'goal.check': 'goal.check',
  'goal.uncheck': 'goal.uncheck',
  'goal.complete': 'goal.complete',
  'goal.reopen': 'goal.reopen',
  'goal.ackWatchdog': 'goal.ackWatchdog',
}

const SYNTHETIC_CAPABILITY_KEYS = {
  excalidraw: ['state:read', 'state:update'],
  timer: ['state:read', 'state:update', 'event:emit'],
  'github-trigger': ['state:read', 'state:update', 'event:emit'],
  'skill-group': ['state:read', 'state:update', 'capability:read'],
  'mcp-connector': ['state:read', 'state:update', 'capability:read', 'mcp:metadata:read'],
  goal: ['state:read'],
}
const DEFAULT_CAPABILITY_KEYS = ['state:read']

// Pre-registry literal lists, used only when the action registry cannot be
// resolved from any candidate root (normally unreachable: every generated
// Harness project ships Harness/a2a/action-registry.json).
const LEGACY_CAPABILITY_LISTS = {
  file: ['meta:read', 'bytes:read', 'text:read'],
  markdown: ['state:read', 'state:update', 'markdown:append', 'markdown:replace', 'markdown.find', 'markdown.acquireLock', 'markdown.releaseLock'],
  excalidraw: ['state:read', 'state:update', 'excalidraw:read', 'excalidraw:update'],
  timer: ['state:read', 'state:update', 'timer.read', 'timer.configure', 'timer.fire', 'timer.enable', 'timer.disable', 'timer.setInterval', 'timer.setMode', 'timer.ackWatchdog', 'timer.resetWatchdog', 'timer.tick', 'event:emit'],
  'github-trigger': ['state:read', 'state:update', 'github-trigger.read', 'github-trigger.configure', 'github-trigger.receive', 'event:emit'],
  'skill-group': ['state:read', 'state:update', 'skill-group.read', 'skill-group.configure', 'capability:read'],
  'mcp-connector': ['state:read', 'state:update', 'mcp-connector.read', 'mcp-connector.configure', 'capability:read', 'mcp:metadata:read'],
  goal: ['state:read', 'goal.read', 'goal.update', 'goal.requestCompletion', 'goal.returnToWork', 'goal.ackWatchdog', 'goal.add', 'goal.delete', 'goal.replace', 'goal.check', 'goal.uncheck', 'goal.complete', 'goal.reopen'],
}

function capabilityKeysForType(registry, type) {
  if (!registry) {
    const legacy = LEGACY_CAPABILITY_LISTS[type]
    return legacy ? [...legacy] : [...DEFAULT_CAPABILITY_KEYS]
  }
  const synthetic = SYNTHETIC_CAPABILITY_KEYS[type] || []
  const derived = actionsForNodeType(registry, type)
    .map(action => REGISTRY_ID_TO_CAPABILITY_KEY[action.id])
    .filter(key => key !== undefined)
  if (synthetic.length > 0 || derived.length > 0) return [...synthetic, ...derived]
  return [...DEFAULT_CAPABILITY_KEYS]
}

// Agent-facing action ids exposed in availableActions and the agent snapshot
// capabilities. Kept as an explicit set so registry actions that are not
// agent-callable surface candidates (agent.deleteAgentNode alias, agent.layout
// Main-Agent-only layout, timer dispatchWakeup) stay unexposed.
const AGENT_EXPOSED_ACTION_IDS = new Set([
  // agent nodeType
  'agent.readOutput',
  'agent.sendInput',
  'agent.sendMessage',
  'agent.broadcastMessage',
  'agent.readMessages',
  'agent.readTranscript',
  'agent.start',
  'agent.stop',
  'agent.restart',
  'agent.delete',
  'agent.readContext',
  'agent.setModel',
  // graph nodeType
  'agent.createNode',
  'agent.connectNodes',
  'agent.disconnectNodes',
  'agent.moveNode',
  'agent.deleteNode',
  'agent.deleteNodes',
  'agent.readGraph',
  // node nodeType
  'node.delete',
  'node.restore',
])

const LEGACY_AGENT_ACTIONS = [
  'agent.sendInput',
  'agent.readOutput',
  'agent.readTranscript',
  'agent.start',
  'agent.stop',
  'agent.restart',
  'agent.delete',
  'agent.readContext',
  'agent.sendMessage',
  'agent.broadcastMessage',
  'agent.readMessages',
  'agent.createNode',
  'agent.connectNodes',
  'agent.disconnectNodes',
  'agent.moveNode',
  'agent.deleteNode',
  'agent.deleteNodes',
  'agent.readGraph',
]

function agentAvailableActions(projectRoot = '') {
  const registry = resolveActionRegistry(projectRoot)
  if (!registry) return [...LEGACY_AGENT_ACTIONS]
  const ids = []
  for (const nodeType of ['agent', 'graph', 'node']) {
    for (const action of actionsForNodeType(registry, nodeType)) {
      if (AGENT_EXPOSED_ACTION_IDS.has(action.id)) ids.push(action.id)
    }
  }
  return ids
}

const AGENT_PEER_READ_ACTIONS = ['agent.readContext', 'agent.readOutput', 'agent.readTranscript']
const AGENT_PEER_MESSAGE_ACTIONS = ['agent.sendMessage', 'agent.readMessages']
const AGENT_PEER_CONTROL_ACTIONS = ['agent.sendInput', 'agent.start', 'agent.stop', 'agent.restart']
const EVENT_NODE_TYPES = new Set(['timer', 'github-trigger'])

// Connected node type -> manual skill id under Harness/a2a/skills/ (spec §9.4,
// AC-021 manual injection). The mapping is built DYNAMICALLY from the skills
// directory (F16/D13): every workflow-<type>-node.json file maps its node type
// to its manual id, so node manuals added later are injected without code
// changes. The excalidraw node type uses the diagram manual
// (workflow-diagram-node.json). Missing manual files degrade gracefully (no
// injection for that type).
const EXCALIDRAW_MANUAL_ALIAS = { excalidraw: 'diagram' }

function discoverNodeManualIds(projectRoot) {
  const manualIds = new Map()
  try {
    const dir = path.join(projectRoot, 'Harness', 'a2a', 'skills')
    for (const file of fs.readdirSync(dir)) {
      const match = String(file).match(/^workflow-([a-z0-9-]+)-node\.json$/)
      if (!match) continue
      const manualId = `workflow-${match[1]}-node`
      manualIds.set(match[1], manualId)
    }
  } catch {
    // skills dir missing — no manual injection
  }
  return manualIds
}

// Team-organization decision flow (agent-team-cooperation-spec §2 steps 1-10,
// AC-024 partial). Injected into the agent context as plain-language guidance;
// user-facing reporting stays jargon-free (ask-user gate per §4.4 / T13).
export const TEAM_ORGANIZATION_GUIDANCE = `Team Organization Guidance
When the user asks for work that needs a team:
1. Understand the task from the user request.
2. Decide whether team collaboration is needed — simple requests are handled directly, no team.
3. Choose the required roles from the canonical role vocabulary: ceo, manager, implementer, reviewer, verifier, planner, terminal-controller (or a free-form role such as architect).
4. Find existing agents by role, runtime, provider, capability, or name.
5. Exactly one unambiguous match -> connect that agent.
6. No match and the task target is clear -> create an agent with a role profile (displayName, roleTitle, responsibility, capabilities).
7. Multiple matches or an unclear target -> ask the user; never blindly create or connect an agent.
8. Share durable context through Markdown nodes, referenced by nodeId only.
9. Send structured requests, wait for replies, and aggregate them.
10. Tick Goal items and complete the Goal when all items are checked; report to the user in plain language.`

function readNodeManualText(projectRoot, manualId) {
  const filePath = path.join(projectRoot, 'Harness', 'a2a', 'skills', `${manualId}.json`)
  let manual
  try {
    manual = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
  const parts = []
  const summary = String(manual.summary || manual.description || '').trim()
  if (summary) parts.push(summary)
  const denied = Array.isArray(manual.policy?.denied) ? manual.policy.denied : []
  if (Array.isArray(manual.prohibitions)) denied.push(...manual.prohibitions)
  for (const item of denied) {
    const text = String(item || '').trim()
    if (text) parts.push(text)
  }
  // Command tables are registry-generated (W39 audit): after the manual's
  // prose sections, append the invocable action surface for the manual's own
  // nodeType from Harness/a2a/action-registry.json. The diagram manual
  // declares nodeType 'excalidraw', which is the registry nodeType for its
  // actions (the EXCALIDRAW_MANUAL_ALIAS above only maps the peer type to the
  // diagram manual id). When no registry is reachable (temp roots,
  // non-scaffold projects), fall back to the manual's own legacy commands key
  // when one is still present — a prose-only manual with no registry yields
  // no commands section, never a throw.
  const registry = resolveActionRegistry(projectRoot)
  if (registry) {
    const manualNodeType = String(manual.nodeType || '').trim()
    const actions = manualNodeType ? actionsForNodeType(registry, manualNodeType) : []
    if (actions.length > 0) {
      const lines = ['Commands:']
      for (const action of actions) {
        const id = String(action.id || '').trim()
        const actionSummary = String(action.summary || '').trim()
        if (!id && !actionSummary) continue
        lines.push(`- ${id} — ${actionSummary}`)
        const example = String(action.example || '').trim()
        if (example) lines.push(`  Example: ${example}`)
      }
      parts.push(lines.join('\n'))
    }
  } else if (Array.isArray(manual.commands)) {
    for (const command of manual.commands) {
      const name = String(command?.name || '').trim()
      const cmd = String(command?.command || '').trim()
      const desc = String(command?.description || '').trim()
      if (!name && !cmd) continue
      parts.push(`${name ? `${name}: ` : ''}${cmd}${desc ? ` — ${desc}` : ''}`)
    }
  }
  return parts.filter(Boolean).join('\n')
}

export function buildConnectedNodeManuals(projectRoot, connectedPeers = []) {
  const manualIds = discoverNodeManualIds(projectRoot)
  const seen = new Set()
  const manuals = []
  for (const peer of connectedPeers) {
    const nodeType = String(peer?.type || '').trim()
    const typeKey = EXCALIDRAW_MANUAL_ALIAS[nodeType] || nodeType
    const manualId = manualIds.get(typeKey)
    if (!manualId || seen.has(manualId)) continue
    seen.add(manualId)
    const text = readNodeManualText(projectRoot, manualId)
    if (!text) continue
    manuals.push({
      nodeType,
      nodeId: peer.nodeId,
      skillId: manualId,
      text,
    })
  }
  return manuals
}

// ── identity / workspace helpers ──

export function agentNodeId(graphNode) {
  return graphNode.nodeId || graphNode.id || `session-${graphNode.sessionId}`
}

export function uniqueStrings(values) {
  const seen = new Set()
  const result = []
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

export function shortNodeId(nodeId) {
  const id = String(nodeId || '').trim()
  if (!id) return ''
  const sessionMatch = id.match(/^session-([0-9a-f]{8})/i)
  if (sessionMatch) return sessionMatch[1]
  const parts = id.split('-').filter(Boolean)
  if (parts.length >= 2) return parts[parts.length - 1]
  return id.slice(-8)
}

export function nodeDisplayName(title, nodeId, storedDisplayName = '') {
  const label = String(storedDisplayName || title || '').trim()
  return label ? `${label} [${shortNodeId(nodeId)}]` : shortNodeId(nodeId)
}

export function isMainAgentGraphNode(graphNode) {
  if (!graphNode) return false
  if (graphNode.agentKind === 'main') return true
  if (String(graphNode.role || '').toLowerCase() === 'main') return true
  if (String(graphNode.role || '').toLowerCase().includes('ceo')) return true
  return false
}

export function isLiveAgentGraphNode(node) {
  if (!node?.sessionId) return false
  const status = String(node.status || '').toLowerCase()
  return status === 'running' || status === 'starting'
}

function persistedAgentSession(projectRoot, graphNode) {
  const sessionId = graphNode?.sessionId
  if (!sessionId) return null
  return listTerminalSessions(projectRoot).find(session => session.sessionId === sessionId) || null
}

function agentConfig(projectRoot, graphNode) {
  const session = {
    ...(graphNode || {}),
    ...(persistedAgentSession(projectRoot, graphNode) || {}),
    sessionId: graphNode?.sessionId,
    graphNodeId: agentNodeId(graphNode),
  }
  return normalizeNodeConfig(session.nodeConfig || session.config || graphNode?.config || {}, session)
}

function agentSettings(projectRoot, graphNode) {
  const nodeId = agentNodeId(graphNode)
  const stored = readNodeSettings(projectRoot, nodeId, 'agent')
  const config = agentConfig(projectRoot, graphNode)
  const graphRouting = config.outputRouting || graphNode.config?.outputRouting || graphNode.nodeConfig?.outputRouting || graphNode.outputRouting
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

function agentNodeHomeRel(ref = {}) {
  if (ref.nodeHomeRel) return ref.nodeHomeRel
  if (ref.sessionId) return `Harness/a2a/nodes/${ref.sessionId}`
  return ''
}

function agentNodeInitRel(ref = {}) {
  if (ref.nodeInitRel) return ref.nodeInitRel
  const homeRel = agentNodeHomeRel(ref)
  return homeRel ? `${homeRel}/init.md` : ''
}

export function buildAgentIdentityContext(graphNode, nodeId, sessionId) {
  return {
    nodeId,
    sessionId,
    agentKind: graphNode.agentKind || '',
    role: graphNode.role || '',
    runtime: graphNode.runtime || '',
    status: graphNode.status || 'unknown',
    lifecycle: isLiveAgentGraphNode(graphNode) ? 'live' : 'stopped',
    isMainAgent: isMainAgentGraphNode(graphNode),
    taskId: graphNode.taskId || null,
    parentAgentId: graphNode.parentAgentId || null,
    parentNodeId: graphNode.parentNodeId || null,
  }
}

export function buildAgentWorkspaceContext(projectRoot, graphNode, nodeId, sessionId) {
  const homeRel = agentNodeHomeRel(graphNode)
  const initRel = agentNodeInitRel(graphNode)
  return {
    kind: 'agent-node-home',
    projectRoot,
    cwd: graphNode.cwd || projectRoot,
    nodeHomeRel: homeRel,
    nodeInitRel: initRel,
    graphContextPath: graphNode.graphContextPath || 'Harness/a2a/workflow-map.json',
    stateRef: {
      path: homeRel,
      initPath: initRel,
      sessionId,
      nodeId,
    },
    boundaries: {
      nodeHome: 'agent-local-run-state',
      workspace: 'project-bounded-workspace-api',
      workflowMap: 'backend-owned-read-only-diagnostic',
      nodeState: 'backend-owned-node-action-only',
    },
    api: {
      selfContext: `/api/workflow/context/${encodeURIComponent(nodeId)}`,
      nodeAction: `/api/workflow/nodes/${encodeURIComponent(nodeId)}/actions/:action`,
      graphAction: `/api/workflow/nodes/${encodeURIComponent(nodeId)}/actions/agent.*`,
    },
  }
}

// ── connections ──

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

export function buildConnections(nodeId, graph) {
  return workflowRuntimeEdges(graph)
    .map(edge => connectionForEdge(edge, nodeId))
    .filter(Boolean)
}

export function findAgentGraphNode(graph, key) {
  const id = String(key || '')
  return (graph.nodes || []).find(n => (
    n.sessionId
    && (
      (n.nodeId || n.id) === id
      || n.sessionId === id
    )
  )) || null
}

function canonicalAgentActorNodeId(graph, actorNodeId) {
  const value = String(actorNodeId || '').trim()
  if (!value) return ''
  const graphNode = findAgentGraphNode(graph, value)
  return graphNode ? agentNodeId(graphNode) : ''
}

// ── ref-building primitives (shared by every connected-ref builder) ──

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

export function handlesFor(type) {
  if (type === 'file') return {
    inputs: [],
    outputs: [],
    bidirectional: ['file'],
    ports: ['file'],
    physical: ['file:left', 'file:right', 'file:top', 'file:bottom'],
  }
  if (type === 'goal') return {
    inputs: [],
    outputs: [],
    bidirectional: ['goal'],
    ports: ['goal'],
    physical: ['goal:left', 'goal:right', 'goal:top', 'goal:bottom'],
    directions: {
      goal: 'bidirectional',
    },
  }
  if (EVENT_NODE_TYPES.has(type)) return {
    inputs: ['config'],
    outputs: ['event'],
    bidirectional: ['status'],
    ports: ['event', 'config', 'status'],
    physical: ['config:left', 'event:right', 'event:top', 'event:bottom'],
    directions: {
      event: 'source-to-target',
      config: 'target-only',
      status: 'bidirectional',
    },
  }
  if (type === 'skill-group' || type === 'mcp-connector') return {
    inputs: [],
    outputs: [],
    bidirectional: ['capability'],
    ports: ['capability'],
    physical: ['capability:left', 'capability:right', 'capability:top', 'capability:bottom'],
    directions: {
      capability: 'bidirectional',
    },
  }
  if (type === 'markdown') return {
    inputs: [],
    outputs: [],
    bidirectional: ['markdown'],
    ports: ['markdown'],
    physical: ['markdown:left', 'markdown:right', 'markdown:top', 'markdown:bottom'],
  }
  if (type === 'excalidraw') return {
    inputs: [],
    outputs: [],
    bidirectional: ['scene'],
    ports: ['scene'],
    physical: ['scene:left', 'scene:right', 'scene:top', 'scene:bottom'],
  }
  return { inputs: [], outputs: [] }
}

// Registry-derived per-node-type capabilities (W39 audit). The optional
// projectRoot parameter lets callers that hold a project root resolve the
// registry against it; callers without one (workflow-node-runtime.mjs
// snapshots) fall back to cwd / module repo root.
export function buildCapabilities(type, state, projectRoot = '') {
  const keys = capabilityKeysForType(resolveActionRegistry(projectRoot), type)
  if (type === 'file') {
    const file = state.file || {}
    return keys.filter(key => key !== 'text:read' || fileSupportsText(file))
  }
  return keys
}

// Canonical resource content-ref shape.  NOTE: file content refs intentionally
// omit `etag` — the snapshot-path contract pins this exact shape
// (component-node-api AC-004) and `metadata.etag` carries the etag for files.
export function contentRefForResource(type, ref = {}) {
  if (type === 'file') {
    const file = ref.file || {}
    return {
      kind: file.source === 'user-file' ? 'user-file' : 'workspace-file',
      source: file.source || 'workspace',
      path: file.path || '',
      mime: file.mime || workspaceMimeForPath(file.path || ''),
      size: Number(file.size || 0),
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

export function compareResourceRefs(componentOrder) {
  return (a, b) => {
    const created = String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    if (created !== 0) return created
    const order = (componentOrder.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER) - (componentOrder.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER)
    if (order !== 0) return order
    return String(a.nodeId).localeCompare(String(b.nodeId))
  }
}

export function mergeConnectedRefsByNodeId(refs = [], preferredRelation = '') {
  const byNodeId = new Map()
  for (const ref of refs) {
    const nodeId = String(ref?.nodeId || '').trim()
    if (!nodeId) continue
    const existing = byNodeId.get(nodeId)
    if (!existing) {
      byNodeId.set(nodeId, {
        ...ref,
        connections: Array.isArray(ref.connections) ? [...ref.connections] : (ref.connection ? [ref.connection] : []),
      })
      continue
    }
    const connections = Array.isArray(existing.connections) ? existing.connections : []
    for (const connection of Array.isArray(ref.connections) ? ref.connections : (ref.connection ? [ref.connection] : [])) {
      const key = [
        connection.edgeId || '',
        connection.relation || '',
        connection.direction || '',
        connection.sourceHandle || '',
        connection.targetHandle || '',
      ].join('|')
      const exists = connections.some(item => [
        item.edgeId || '',
        item.relation || '',
        item.direction || '',
        item.sourceHandle || '',
        item.targetHandle || '',
      ].join('|') === key)
      if (!exists) connections.push(connection)
    }
    if (preferredRelation && existing.relation !== preferredRelation && ref.relation === preferredRelation) {
      byNodeId.set(nodeId, {
        ...ref,
        connections,
      })
    } else {
      existing.connections = connections
    }
  }
  return [...byNodeId.values()]
}

// ── timer control affordance ──

export function hasTimerControlEdge(graph, actorNodeId, timerNodeId) {
  const actor = canonicalAgentActorNodeId(graph, actorNodeId)
  if (!actor || !timerNodeId) return false
  return workflowRuntimeEdges(graph).some((edge) => {
    const from = edge.from || edge.source
    const to = edge.to || edge.target
    return from === actor
      && to === timerNodeId
      && normalizeEdgeDirection(edge.direction) === 'source-to-target'
      && String(edge.relation || '').trim() === 'control'
  })
}

function allowedTimerActionsForAgent(ref, actorNodeId, graph) {
  if ((ref.type || ref.eventKind) !== 'timer') return []
  if (!hasTimerControlEdge(graph, actorNodeId, ref.nodeId || '')) return []
  return typeof timerControlActionsForState === 'function'
    ? timerControlActionsForState(ref)
    : []
}

function timerControlAffordanceForAgent(ref, actorNodeId, graph) {
  if ((ref.type || ref.eventKind) !== 'timer') {
    return {
      canControl: false,
      controlRequired: false,
      controlEdgeRequired: false,
      allowedActions: [],
      deniedActions: [],
      controlReason: '',
    }
  }
  const policyActions = typeof timerControlActionsForState === 'function'
    ? timerControlActionsForState(ref)
    : []
  const hasControlEdge = hasTimerControlEdge(graph, actorNodeId, ref.nodeId || '')
  const allowedActions = hasControlEdge ? policyActions : []
  return {
    canControl: allowedActions.length > 0,
    controlRequired: true,
    controlEdgeRequired: !hasControlEdge,
    requiredRelation: 'control',
    requiredDirection: 'source-to-target',
    requiredEdge: {
      from: actorNodeId,
      to: ref.nodeId || '',
      relation: 'control',
      direction: 'source-to-target',
      sourceHandle: 'context',
      targetHandle: 'config',
    },
    allowedActions,
    deniedActions: hasControlEdge ? [] : policyActions,
    controlReason: hasControlEdge
      ? 'Agent has an Agent -> Timer control connection; Timer typed actions may be used through workflow-node-action.'
      : 'Timer event delivery is not Timer control. To control this Timer, connect Agent -> Timer with relation control, then use workflow-node-action; never edit Harness/a2a/event-nodes/**/state.json.',
  }
}

// ── connected ref builders ──

export function buildConnectedResourceRefs(projectRoot, nodeId, graph) {
  const refs = componentStateRefs(projectRoot)
  const componentOrder = new Map(listLiveComponentNodes(projectRoot).map((node, index) => [node.nodeId, index]))
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
        shortId: shortNodeId(connection.peerNodeId),
        displayName: nodeDisplayName(ref.title || connection.peerNodeId, connection.peerNodeId),
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
        contentRef: contentRefForResource(type, ref),
        capabilities: buildCapabilities(type, { file: fileForCapabilities }, projectRoot),
        handles: handlesFor(type),
        ...(metadata ? { metadata } : {}),
        ...(ref.file ? { file: ref.file } : {}),
      }
    })
    .filter(Boolean)
    .sort(compareResourceRefs(componentOrder))
}

export function buildConnectedEventRefs(projectRoot, nodeId, graph) {
  const refs = eventStateRefs(projectRoot)
  const connectedRefs = buildConnections(nodeId, graph)
    .map((connection) => {
      const ref = refs[connection.peerNodeId]
      if (!ref) return null
      const eventConnection = {
        edgeId: connection.edgeId,
        endpointRole: connection.endpointRole,
        localHandle: connection.localHandle,
        peerHandle: connection.peerHandle,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        relation: connection.relation,
        direction: connection.direction,
      }
      const type = ref.type || ref.eventKind || 'event'
      const controlAffordance = timerControlAffordanceForAgent({ ...ref, nodeId: connection.peerNodeId }, nodeId, graph)
      return {
        nodeId: connection.peerNodeId,
        kind: 'event-node',
        type,
        eventKind: ref.eventKind || type,
        title: ref.title || connection.peerNodeId,
        shortId: shortNodeId(connection.peerNodeId),
        displayName: nodeDisplayName(ref.title || connection.peerNodeId, connection.peerNodeId),
        direction: connection.direction,
        endpointRole: connection.endpointRole,
        relation: connection.relation,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        connection: eventConnection,
        connections: [eventConnection],
        stateRef: {
          path: ref.statePath,
          revision: Number(ref.revision || 0),
        },
        contentRef: {
          kind: 'event-node-state',
          statePath: ref.statePath,
          revision: Number(ref.revision || 0),
          eventKind: ref.eventKind || type,
        },
        capabilities: buildCapabilities(type, ref, projectRoot),
        handles: handlesFor(type),
        schedule: ref.schedule || null,
        heartbeat: ref.heartbeat || null,
        loop: ref.loop || null,
        whileGuard: ref.whileGuard || null,
        taskBinding: ref.taskBinding || null,
        controlPolicy: ref.controlPolicy || null,
        allowedActions: controlAffordance.allowedActions,
        deniedActions: controlAffordance.deniedActions,
        canControl: controlAffordance.canControl,
        controlRequired: controlAffordance.controlRequired,
        controlEdgeRequired: controlAffordance.controlEdgeRequired,
        requiredRelation: controlAffordance.requiredRelation,
        requiredDirection: controlAffordance.requiredDirection,
        requiredEdge: controlAffordance.requiredEdge,
        controlReason: controlAffordance.controlReason,
        repository: ref.repository || null,
        eventFilters: ref.eventFilters || null,
        dedupeKeys: Array.isArray(ref.dedupeKeys) ? ref.dedupeKeys : [],
        deliveryCount: Number(ref.deliveryCount || ref.eventCount || 0),
        lastEvent: ref.lastEvent || null,
        lastFiredAt: ref.lastFiredAt || '',
        lastReceivedAt: ref.lastReceivedAt || '',
        lastDeliveryId: ref.lastDeliveryId || '',
        eventCount: Number(ref.eventCount || 0),
      }
    })
    .filter(Boolean)
  return mergeConnectedRefsByNodeId(connectedRefs, 'event')
}

export function buildConnectedCapabilityRefs(projectRoot, nodeId, graph) {
  const refs = capabilityStateRefs(projectRoot)
  return buildConnections(nodeId, graph)
    .map((connection) => {
      const ref = refs[connection.peerNodeId]
      if (!ref) return null
      const capabilityConnection = {
        edgeId: connection.edgeId,
        endpointRole: connection.endpointRole,
        localHandle: connection.localHandle,
        peerHandle: connection.peerHandle,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        relation: connection.relation,
        direction: connection.direction,
      }
      const type = ref.type || ref.capabilityKind || 'capability'
      return {
        nodeId: connection.peerNodeId,
        kind: 'capability-node',
        type,
        capabilityKind: ref.capabilityKind || type,
        title: ref.title || connection.peerNodeId,
        shortId: shortNodeId(connection.peerNodeId),
        displayName: nodeDisplayName(ref.title || connection.peerNodeId, connection.peerNodeId),
        direction: connection.direction,
        endpointRole: connection.endpointRole,
        relation: connection.relation,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        connection: capabilityConnection,
        connections: [capabilityConnection],
        stateRef: {
          path: ref.statePath,
          revision: Number(ref.revision || 0),
        },
        contentRef: {
          kind: 'capability-node-state',
          statePath: ref.statePath,
          revision: Number(ref.revision || 0),
          capabilityKind: ref.capabilityKind || type,
        },
        capabilities: buildCapabilities(type, ref, projectRoot),
        handles: handlesFor(type),
        nodeSemantics: ref.nodeSemantics,
        sourceGroup: ref.sourceGroup || null,
        category: ref.category || '',
        tags: Array.isArray(ref.tags) ? ref.tags : [],
        installSource: ref.installSource || null,
        lockRef: ref.lockRef || '',
        loadStrategy: ref.loadStrategy || 'group-summary',
        prompt: ref.prompt || '',
        skills: Array.isArray(ref.skills) ? ref.skills : [],
        skillNames: Array.isArray(ref.skillNames) ? ref.skillNames : [],
        skillCount: Number(ref.skillCount || 0),
        servers: Array.isArray(ref.servers) ? ref.servers : [],
        serverNames: Array.isArray(ref.serverNames) ? ref.serverNames : [],
        serverCount: Number(ref.serverCount || 0),
        transports: Array.isArray(ref.transports) ? ref.transports : [],
        envKeyNames: Array.isArray(ref.envKeyNames) ? ref.envKeyNames : [],
        envKeyCount: Number(ref.envKeyCount || 0),
        redactedFieldCount: Number(ref.redactedFieldCount || 0),
        state: 'connected',
        executor: 'agent',
      }
    })
    .filter(Boolean)
}

export function effectiveSkillGroupsFor(connectedCapabilityNodeRefs = []) {
  return connectedCapabilityNodeRefs
    .filter(ref => String(ref?.capabilityKind || ref?.type || '') === 'skill-group')
    .map(ref => {
      const names = (Array.isArray(ref.skillNames) ? ref.skillNames : []).filter(Boolean);
      const promptText = (ref.prompt && String(ref.prompt).trim())
        ? String(ref.prompt).trim()
        : (names.length ? `You have these skills available in this pack: ${names.join(', ')}. Use them when the task needs them.` : '');
      return {
        nodeId: ref.nodeId,
        kind: 'effective-skill-group',
        capabilityKind: 'skill-group',
        title: ref.title || ref.nodeId,
        groupId: ref.sourceGroup?.id || '',
        label: ref.sourceGroup?.label || ref.title || ref.nodeId,
        category: ref.category || ref.sourceGroup?.kind || 'skills',
        tags: Array.isArray(ref.tags) ? ref.tags : [],
        skillCount: Number(ref.skillCount || 0),
        skillNames: Array.isArray(ref.skillNames) ? ref.skillNames : [],
        skillRefs: (Array.isArray(ref.skills) ? ref.skills : [])
          .map(skill => ({
            id: String(skill.id || `skill:${skill.name || ''}`).trim(),
            name: String(skill.name || skill.id || '').trim(),
            title: String(skill.title || skill.name || skill.id || '').trim(),
            source: String(skill.source || '').trim(),
            state: String(skill.state || '').trim(),
            enabled: skill.enabled === false ? false : true,
          }))
          .filter(skill => skill.name || skill.id),
        loadStrategy: ref.loadStrategy || 'group-summary',
        prompt: ref.prompt || '',
        promptText,
        lockRef: ref.lockRef || '',
        installSource: ref.installSource ? {
          provider: ref.installSource.provider || '',
          providerLabel: ref.installSource.providerLabel || '',
          packSlug: ref.installSource.packSlug || '',
          packName: ref.installSource.packName || '',
          version: ref.installSource.version || '',
          targetScope: ref.installSource.targetScope || '',
          targetRuntime: ref.installSource.targetRuntime || '',
          installedAt: ref.installSource.installedAt || '',
          signature: ref.installSource.signature || { present: false, verified: false },
          lockfileSignature: ref.installSource.lockfileSignature || { present: false, verified: false },
        } : null,
        relation: ref.relation || 'capability',
        direction: ref.direction || 'bidirectional',
        endpointRole: ref.endpointRole || '',
        connection: ref.connection || null,
        executor: 'agent',
      };
    })
}

function deletedGraphNodeSets(graph) {
  const deletedNodes = Array.isArray(graph?.deletedNodes) ? graph.deletedNodes : []
  return {
    nodeIds: new Set(deletedNodes.map(node => String(node?.nodeId || '').trim()).filter(Boolean)),
    sessionIds: new Set(deletedNodes.map(node => String(node?.sessionId || '').trim()).filter(Boolean)),
  }
}

export function isDeletedGraphNode(graph, nodeIdOrSessionId) {
  const key = String(nodeIdOrSessionId || '').trim()
  if (!key) return false
  const { nodeIds, sessionIds } = deletedGraphNodeSets(graph)
  if (nodeIds.has(key) || sessionIds.has(key)) return true
  if (key.startsWith('session-') && sessionIds.has(key.slice('session-'.length))) return true
  return false
}

function filterRefRecordForGraph(record, graph) {
  return Object.fromEntries(
    Object.entries(record || {})
      .filter(([nodeId, ref]) => !isDeletedGraphNode(graph, nodeId) && !isDeletedGraphNode(graph, ref?.nodeId)),
  )
}

export function goalStateRefsForGraph(projectRoot, graph) {
  return filterRefRecordForGraph(goalStateRefs(projectRoot), graph)
}

export function buildConnectedGoalRefs(projectRoot, nodeId, graph) {
  const refs = goalStateRefsForGraph(projectRoot, graph)
  return buildConnections(nodeId, graph)
    .map((connection) => {
      const ref = refs[connection.peerNodeId]
      if (!ref) return null
      const goalConnection = {
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
        kind: 'goal-node',
        type: 'goal',
        title: ref.title || connection.peerNodeId,
        shortId: shortNodeId(connection.peerNodeId),
        displayName: nodeDisplayName(ref.title || connection.peerNodeId, connection.peerNodeId),
        taskId: ref.taskId,
        status: ref.status,
        phase: ref.phase,
        gate: ref.gate,
        direction: connection.direction,
        endpointRole: connection.endpointRole,
        relation: connection.relation,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        connection: goalConnection,
        connections: [goalConnection],
        stateRef: {
          path: ref.statePath,
          revision: Number(ref.revision || 0),
        },
        contentRef: ref.contentRef,
        capabilities: buildCapabilities('goal', ref, projectRoot),
        handles: handlesFor('goal'),
        acceptance: Array.isArray(ref.acceptance) ? ref.acceptance : [],
        planItems: Array.isArray(ref.planItems) ? ref.planItems : [],
        progress: ref.progress || { verified: 0, total: 0 },
        confirmation: ref.confirmation || null,
        wdt: ref.wdt || null,
      }
    })
    .filter(Boolean)
}

export function buildConnectedAgentRefs(projectRoot, nodeId, graph, { isMainAgent = false } = {}) {
  const agentNodesById = new Map((Array.isArray(graph.nodes) ? graph.nodes : [])
    .filter(node => node && node.sessionId)
    .map(node => [agentNodeId(node), node]))
  return buildConnections(nodeId, graph)
    .map((connection) => {
      const ref = agentNodesById.get(connection.peerNodeId)
      if (!ref) return null
      const peerNodeId = agentNodeId(ref)
      const status = ref.status || 'unknown'
      const live = status === 'running' || status === 'starting'
      const connectionRef = {
        edgeId: connection.edgeId,
        endpointRole: connection.endpointRole,
        localHandle: connection.localHandle,
        peerHandle: connection.peerHandle,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        relation: connection.relation,
        direction: connection.direction,
      }
      const writableActions = isMainAgent ? AGENT_PEER_CONTROL_ACTIONS : []
      const storedDisplayName = String(ref.displayName || '').trim() || String(ref.roleTitle || '').trim()
      return {
        nodeId: peerNodeId,
        kind: 'agent-node',
        type: 'agent',
        title: storedDisplayName || ref.label || ref.role || ref.runtime || peerNodeId,
        shortId: shortNodeId(peerNodeId),
        displayName: nodeDisplayName(storedDisplayName || ref.label || ref.role || ref.runtime || peerNodeId, peerNodeId),
        sessionId: ref.sessionId,
        agentKind: ref.agentKind || '',
        role: ref.role || '',
        runtime: ref.runtime || '',
        status,
        lifecycle: live ? 'live' : 'stopped',
        direction: connection.direction,
        endpointRole: connection.endpointRole,
        relation: connection.relation,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        connection: connectionRef,
        connections: [connectionRef],
        stateRef: {
          path: agentNodeHomeRel(ref),
          revision: Number(ref.configRevision || 0),
        },
        workspaceRef: {
          kind: 'agent-node-home',
          path: agentNodeHomeRel(ref),
          initPath: agentNodeInitRel(ref),
          cwd: ref.cwd || '',
        },
        delegation: {
          canDelegate: Boolean(isMainAgent && live),
          canMessage: live,
          canReadOutput: true,
          canReadContext: true,
          state: live ? 'ready' : 'stopped',
          sendAction: 'agent.sendInput',
          messageAction: 'agent.sendMessage',
          broadcastAction: 'agent.broadcastMessage',
          readMessagesAction: 'agent.readMessages',
          readActions: AGENT_PEER_READ_ACTIONS,
        },
        allowedActions: uniqueStrings([...AGENT_PEER_READ_ACTIONS, ...AGENT_PEER_MESSAGE_ACTIONS, ...writableActions]),
        deniedActions: isMainAgent ? [] : AGENT_PEER_CONTROL_ACTIONS,
      }
    })
    .filter(Boolean)
}

// ── skill projections ──

export function capabilityRefsForSkills(skills) {
  return uniqueStrings(skills).map(name => ({
    kind: 'skill',
    capabilityKind: 'skill',
    skillId: `skill:${name}`,
    name,
    title: name,
    triggers: DEFAULT_AGENT_WORKFLOW_SKILL_TRIGGERS[name] || [],
    source: 'agent-config',
    attachment: 'agent-config',
    state: 'attached',
    nodeSemantics: 'agent-attached-capability-provider',
    relation: 'capability',
    direction: 'bidirectional',
    executor: 'agent',
  }))
}

export function skillTriggersFor(skills) {
  return Object.fromEntries(uniqueStrings(skills).map(name => [
    name,
    DEFAULT_AGENT_WORKFLOW_SKILL_TRIGGERS[name] || [],
  ]))
}

// ── output routing ──

export function outputRoutingFor(settings, connectedResourceRefs) {
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

// ── agent node snapshot (the `node` half of the API context response) ──

export function buildAgentSnapshot(projectRoot, graphNode, graph) {
  const nodeId = agentNodeId(graphNode)
  const settings = agentSettings(projectRoot, graphNode)
  const config = agentConfig(projectRoot, graphNode)
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
        skills: config.skills,
        skillPolicy: config.skillPolicy,
        contextSources: config.contextSources,
        capabilities: config.capabilities,
        ...settings.values,
      },
      revision: settings.revision,
    },
    capabilities: agentAvailableActions(projectRoot),
    ui: {
      previewKind: 'agent',
      settingsPanel: 'agent-settings',
      testId: 'workflow-agent-node',
      labels: { title: graphNode.label || graphNode.runtime || 'Agent' },
    },
  }
}

// ── canonical Agent context ──

export function buildAgentContext(projectRoot, graphNode, graph, options = {}) {
  const nodeId = agentNodeId(graphNode)
  const sessionId = graphNode.sessionId || null
  // Backward compat: legacy 'wf-subagents' graph nodes resolve to the
  // canonical 'wf-node-subagents' id; unspecified defaults to built-in.
  const rawSubagentMode = String(graphNode.subagentMode || 'built-in-subagents')
  const subagentMode = rawSubagentMode === 'wf-subagents' ? 'wf-node-subagents' : rawSubagentMode
  const isMainAgent = options.isMainAgent !== undefined ? Boolean(options.isMainAgent) : isMainAgentGraphNode(graphNode)
  const roleProfile = readRoleProfile(nodeId, projectRoot)
  const connections = buildConnections(nodeId, graph)
  const refs = componentStateRefs(projectRoot)
  const eventRefs = eventStateRefs(projectRoot)
  const capabilityRefs = capabilityStateRefs(projectRoot)
  const goalRefs = goalStateRefsForGraph(projectRoot, graph)
  const connectedResourceRefs = buildConnectedResourceRefs(projectRoot, nodeId, graph)
  const connectedAgentRefs = buildConnectedAgentRefs(projectRoot, nodeId, graph, {
    isMainAgent,
  })
  const connectedEventRefs = buildConnectedEventRefs(projectRoot, nodeId, graph)
  const connectedCapabilityNodeRefs = buildConnectedCapabilityRefs(projectRoot, nodeId, graph)
  const connectedGoalRefs = buildConnectedGoalRefs(projectRoot, nodeId, graph)
  const settings = agentSettings(projectRoot, graphNode)
  const config = agentConfig(projectRoot, graphNode)
  const defaultSkills = DEFAULT_AGENT_WORKFLOW_SKILLS
  const availableOnDemandSkills = ON_DEMAND_AGENT_NODE_SKILLS
  const configuredSkills = uniqueStrings(config.skills)
  const connectedSkillNames = uniqueStrings(connectedCapabilityNodeRefs.flatMap(ref => ref.skillNames || []))
  const effectiveSkills = uniqueStrings([...defaultSkills, ...configuredSkills, ...connectedSkillNames])
  const effectiveSkillGroups = effectiveSkillGroupsFor(connectedCapabilityNodeRefs)
  const connectedCapabilityRefs = [
    ...capabilityRefsForSkills(configuredSkills),
    ...connectedCapabilityNodeRefs,
  ]
  const defaultCapabilityRefs = capabilityRefsForSkills(defaultSkills).map(ref => ({
    ...ref,
    source: 'agent-default',
    attachment: 'agent-default',
    state: 'default',
  }))
  const availableOnDemandCapabilityRefs = capabilityRefsForSkills(availableOnDemandSkills).map(ref => ({
    ...ref,
    source: 'agent-on-demand',
    attachment: 'on-demand',
    state: 'available',
  }))
  const ontology = buildAgentOntologyContext({
    nodeId,
    sessionId,
    agentKind: graphNode.agentKind || '',
    role: graphNode.role || '',
    connections,
    connectedResourceRefs,
    connectedAgentRefs,
    connectedEventRefs,
    connectedCapabilityRefs: [...defaultCapabilityRefs, ...availableOnDemandCapabilityRefs, ...connectedCapabilityRefs],
    connectedCapabilityNodeRefs,
    effectiveSkillGroups,
    connectedGoalRefs,
    effectiveSkills,
    isMainAgent,
  })
  const connectedPeers = connections.map(connection => {
    const ref = refs[connection.peerNodeId]
    const agentRef = connectedAgentRefs.find(item => item.nodeId === connection.peerNodeId)
    const eventRef = eventRefs[connection.peerNodeId]
    const capabilityRef = capabilityRefs[connection.peerNodeId]
    const goalRef = goalRefs[connection.peerNodeId]
    return agentRef
      ? {
          nodeId: agentRef.nodeId,
          type: 'agent',
          title: agentRef.title,
          shortId: shortNodeId(agentRef.nodeId),
          displayName: nodeDisplayName(agentRef.title, agentRef.nodeId),
          sessionId: agentRef.sessionId,
          agentKind: agentRef.agentKind,
          status: agentRef.status,
          stateRef: agentRef.stateRef,
        }
      : (ref
      ? {
          nodeId: connection.peerNodeId,
          type: ref.type,
          title: ref.title,
          shortId: shortNodeId(connection.peerNodeId),
          displayName: nodeDisplayName(ref.title, connection.peerNodeId),
          stateRef: { path: ref.statePath, revision: ref.revision },
          ...(ref.file ? { file: ref.file } : {}),
        }
      : (eventRef
          ? {
              nodeId: connection.peerNodeId,
              type: eventRef.type,
              eventKind: eventRef.eventKind,
              title: eventRef.title,
              shortId: shortNodeId(connection.peerNodeId),
              displayName: nodeDisplayName(eventRef.title, connection.peerNodeId),
              stateRef: { path: eventRef.statePath, revision: eventRef.revision },
            }
          : (capabilityRef
              ? {
                  nodeId: connection.peerNodeId,
                  type: capabilityRef.type,
                  capabilityKind: capabilityRef.capabilityKind,
                  title: capabilityRef.title,
                  shortId: shortNodeId(connection.peerNodeId),
                  displayName: nodeDisplayName(capabilityRef.title, connection.peerNodeId),
                  stateRef: { path: capabilityRef.statePath, revision: capabilityRef.revision },
                }
              : (goalRef
                  ? {
                      nodeId: connection.peerNodeId,
                      type: 'goal',
                      taskId: goalRef.taskId,
                      title: goalRef.title,
                      shortId: shortNodeId(connection.peerNodeId),
                      displayName: nodeDisplayName(goalRef.title, connection.peerNodeId),
                      stateRef: { path: goalRef.statePath, revision: goalRef.revision },
                    }
                  : {
                      nodeId: connection.peerNodeId,
                      shortId: shortNodeId(connection.peerNodeId),
                      displayName: nodeDisplayName('', connection.peerNodeId),
                    }))))
  })
  const graphNodeIds = (Array.isArray(graph.nodes) ? graph.nodes : [])
    .map(node => node.nodeId || node.id)
    .filter(Boolean)
  const dockLinks = Array.isArray(graph.capsuleDockLinks) ? graph.capsuleDockLinks : []
  const magneticTopology = computeMagneticTopology(dockLinks, { nodeIds: graphNodeIds })
  const nodeMagnetic = magneticTopology.byNode[nodeId] || {
    magneticGroupId: null,
    directMagneticNeighbors: [],
    magneticReachableNodes: [],
  }
  const connectedNodeManuals = buildConnectedNodeManuals(projectRoot, connectedPeers)
  return {
    ok: true,
    node: buildAgentSnapshot(projectRoot, graphNode, graph),
    context: {
      nodeId,
      sessionId,
      identity: {
        ...buildAgentIdentityContext(graphNode, nodeId, sessionId),
        // Role profile identity (spec §3.3/3.4, AC-002): the agent's own
        // profile wins; graph-node fields fall back for legacy sessions.
        displayName: roleProfile?.displayName || String(graphNode.displayName || graphNode.role || '').trim(),
        roleTitle: roleProfile?.roleTitle || String(graphNode.roleTitle || graphNode.role || '').trim(),
        responsibility: roleProfile?.responsibility || String(graphNode.responsibility || '').trim(),
        capabilities: roleProfile?.capabilities || (Array.isArray(graphNode.capabilities) ? graphNode.capabilities : []),
        roleProfileRef: roleProfile?.roleProfileRef || graphNode.roleProfileRef || null,
      },
      roleProfile,
      connectedNodeManuals,
      teamGuidance: TEAM_ORGANIZATION_GUIDANCE,
      workspace: buildAgentWorkspaceContext(projectRoot, graphNode, nodeId, sessionId),
      graphVersion: Number(graph.version || 1),
      subagentMode,
      connectedPeers,
      componentStateRefs: refs,
      eventStateRefs: eventRefs,
      capabilityStateRefs: capabilityRefs,
      goalStateRefs: goalRefs,
      connectedResourceRefs,
      connectedAgentRefs,
      connectedEventRefs,
      connectedCapabilityRefs,
      connectedCapabilityNodeRefs,
      effectiveSkillGroups,
      connectedGoalRefs,
      defaultSkills,
      defaultCapabilityRefs,
      availableOnDemandSkills,
      availableOnDemandCapabilityRefs,
      effectiveSkills,
      skillTriggers: skillTriggersFor([...effectiveSkills, ...availableOnDemandSkills]),
      ontology,
      affordances: ontology.affordances,
      skillPolicy: config.skillPolicy,
      outputRouting: outputRoutingFor(settings, connectedResourceRefs),
      availableActions: agentAvailableActions(projectRoot),
      magneticGroupId: nodeMagnetic.magneticGroupId,
      directMagneticNeighbors: nodeMagnetic.directMagneticNeighbors,
      magneticReachableNodes: nodeMagnetic.magneticReachableNodes,
      magneticTopology: {
        groups: magneticTopology.groups,
        groupCount: magneticTopology.groups.length,
        dockLinkCount: dockLinks.length,
      },
    },
  }
}
