import { CapabilityNodeError, getCapabilityNode, updateCapabilityNode } from '../workflow-capability-node-store.mjs'

function rethrow(error) {
  if (error instanceof CapabilityNodeError) throw error
  throw new CapabilityNodeError(error.message, {
    statusCode: error.statusCode,
    code: error.code,
  })
}

function requireMcpConnectorNode(current) {
  if (current.state.type !== 'mcp-connector') {
    throw new CapabilityNodeError(`Node is not an mcp-connector node: ${current.node.nodeId}`, {
      statusCode: 409,
      code: 'TYPE_MISMATCH',
    })
  }
  return current.state
}

export function read(nodeId, projectRoot) {
  try {
    const current = getCapabilityNode(projectRoot, nodeId)
    const state = requireMcpConnectorNode(current)
    return {
      title: current.node.title,
      revision: current.node.revision,
      description: state.description || '',
      sourceGroup: state.sourceGroup || null,
      servers: state.servers || [],
      serverNames: state.serverNames || [],
      serverCount: Number(state.serverCount || 0),
      transports: state.transports || [],
      envKeyNames: state.envKeyNames || [],
      envKeyCount: Number(state.envKeyCount || 0),
      redactedFieldCount: Number(state.redactedFieldCount || 0),
      nodeSemantics: state.nodeSemantics,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function configure(nodeId, projectRoot, payload = {}) {
  try {
    const current = getCapabilityNode(projectRoot, nodeId)
    requireMcpConnectorNode(current)
    const updated = updateCapabilityNode(projectRoot, nodeId, {
      revision: current.node.revision,
      title: payload.title,
      description: payload.description,
      sourceGroup: payload.sourceGroup,
      servers: payload.servers,
      server: payload.server,
    })
    return {
      revision: updated.node.revision,
      description: updated.state.description || '',
      sourceGroup: updated.state.sourceGroup || null,
      servers: updated.state.servers || [],
      serverNames: updated.state.serverNames || [],
      serverCount: Number(updated.state.serverCount || 0),
      transports: updated.state.transports || [],
      envKeyNames: updated.state.envKeyNames || [],
      envKeyCount: Number(updated.state.envKeyCount || 0),
      redactedFieldCount: Number(updated.state.redactedFieldCount || 0),
    }
  } catch (error) {
    rethrow(error)
  }
}
