import { ComponentNodeError } from '../component-node-store.mjs'
import { loadWorkflowGraphMap, removeWorkflowGraphNode } from '../a2a-store.mjs'

async function getWsTerminal() {
  return import('../ws-terminal.mjs')
}

function rethrow(error) {
  if (error instanceof ComponentNodeError) throw error
  throw new ComponentNodeError(error.message, {
    statusCode: error.statusCode,
    code: error.code,
  })
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Resolve a graph node by graph node id or session id
function findGraphNode(projectRoot, key) {
  const graph = loadWorkflowGraphMap(projectRoot)
  return (graph.nodes || []).find(node =>
    (node.nodeId || node.id) === key || node.sessionId === key
  ) || null
}

function rangeOptions(payload = {}, defaultTail) {
  const opts = isPlainObject(payload) ? payload : {}
  const fromSeq = Number(opts.fromSeq)
  const toSeq = Number(opts.toSeq)
  const tail = Number(opts.tail)
  return {
    fromSeq: Number.isFinite(fromSeq) ? fromSeq : undefined,
    toSeq: Number.isFinite(toSeq) ? toSeq : undefined,
    tail: Number.isFinite(tail) && tail > 0 ? tail : defaultTail,
  }
}

// Read latest terminal output for an agent node's session
export async function readOutput(nodeId, projectRoot, payload = {}) {
  try {
    const node = findGraphNode(projectRoot, nodeId)
    const sessionId = node?.sessionId || nodeId
    const { readTerminalRange } = await import('../terminal-store.mjs')
    const result = readTerminalRange(projectRoot, {
      sessionId,
      ...rangeOptions(payload, 50),
    })
    return { sessionId, entries: result.entries || [], ...result }
  } catch (error) {
    rethrow(error)
  }
}

// Send input to the agent's terminal
export async function sendInput(nodeId, projectRoot, payload = {}) {
  try {
    const node = findGraphNode(projectRoot, nodeId)
    const sessionId = node?.sessionId || nodeId
    const text = String(payload?.text ?? payload?.input ?? payload?.data ?? '')
    const { writePtyInput } = await getWsTerminal()
    const sent = writePtyInput(sessionId, text)
    if (!sent) {
      throw new ComponentNodeError('No PTY process attached to this session', {
        statusCode: 409,
        code: 'NO_PTY',
      })
    }
    return { ok: true, sessionId, sent }
  } catch (error) {
    rethrow(error)
  }
}

// Read the agent's transcript from disk
export async function readTranscript(nodeId, projectRoot, payload = {}) {
  try {
    const node = findGraphNode(projectRoot, nodeId)
    const sessionId = node?.sessionId || nodeId
    const { readTerminalRange } = await import('../terminal-store.mjs')
    const result = readTerminalRange(projectRoot, {
      sessionId,
      ...rangeOptions(payload, 200),
    })
    return { sessionId, entries: result.entries || [], ...result }
  } catch (error) {
    rethrow(error)
  }
}

// Start an agent node; the server control plane owns PTY spawning
export function start(nodeId, projectRoot, payload = {}) {
  throw new ComponentNodeError(
    'agent.start is delegated to the server control plane. Use POST /api/a2a/nodes/:id/start',
    { statusCode: 400, code: 'USE_A2A_START' }
  )
}

// Stop an agent node's session and kill its PTY
export async function stop(nodeId, projectRoot, payload = {}) {
  try {
    const node = findGraphNode(projectRoot, nodeId)
    const sessionId = node?.sessionId || nodeId
    const { killPtyProcess } = await getWsTerminal()
    killPtyProcess(sessionId)
    return { ok: true, sessionId, stopped: true }
  } catch (error) {
    rethrow(error)
  }
}

// Restart an agent node; the server control plane owns PTY respawning
export function restart(nodeId, projectRoot, payload = {}) {
  throw new ComponentNodeError(
    'agent.restart is delegated to the server control plane. Use POST /api/a2a/nodes/:id/restart',
    { statusCode: 400, code: 'USE_A2A_START' }
  )
}

// Delete an agent node from the workflow graph (must be stopped first)
export function deleteAgentNode(nodeId, projectRoot, payload = {}) {
  try {
    const node = findGraphNode(projectRoot, nodeId)
    if (!node) {
      throw new ComponentNodeError('Agent node not found in graph', { statusCode: 404, code: 'NOT_FOUND' })
    }
    if (node.status === 'running' || node.status === 'starting') {
      throw new ComponentNodeError('Stop the agent before deleting', { statusCode: 409, code: 'NODE_LIVE' })
    }
    const removed = removeWorkflowGraphNode(projectRoot, nodeId)
    return { ok: true, removed: removed.removed }
  } catch (error) {
    rethrow(error)
  }
}

// Build context for an agent node (connected peers, available actions)
export function readContext(nodeId, projectRoot, payload = {}) {
  try {
    const node = findGraphNode(projectRoot, nodeId)
    if (!node) {
      throw new ComponentNodeError('Agent node not found', { statusCode: 404, code: 'NOT_FOUND' })
    }
    const graph = loadWorkflowGraphMap(projectRoot)
    const nodeKey = node.nodeId || node.id
    const sessionKey = node.sessionId
    const connections = (graph.edges || [])
      .filter(edge =>
        (edge.from === nodeKey || edge.to === nodeKey)
        || (edge.source === nodeKey || edge.target === nodeKey)
        || (sessionKey && (edge.fromSessionId === sessionKey || edge.toSessionId === sessionKey))
      )
      .map(edge => {
        const isSource = edge.from === nodeKey || edge.source === nodeKey || edge.fromSessionId === sessionKey
        return {
          edgeId: edge.id || `${edge.from}->${edge.to}`,
          peerNodeId: isSource ? (edge.to || edge.toSessionId) : (edge.from || edge.fromSessionId),
          endpointRole: isSource ? 'source' : 'target',
          localHandle: isSource ? edge.sourceHandle || null : edge.targetHandle || null,
          peerHandle: isSource ? edge.targetHandle || null : edge.sourceHandle || null,
          sourceHandle: edge.sourceHandle || null,
          targetHandle: edge.targetHandle || null,
          relation: edge.relation || 'wf-bridge',
          direction: 'bidirectional',
        }
      })
    const live = node.status === 'running' || node.status === 'starting'
    return {
      node,
      connections,
      availableActions: live
        ? ['sendInput', 'readOutput', 'readTranscript', 'stop']
        : ['start', 'delete'],
    }
  } catch (error) {
    rethrow(error)
  }
}

// The workflow-node-runtime routes "agent.delete" to the "delete" adapter suffix
export { deleteAgentNode as delete }
