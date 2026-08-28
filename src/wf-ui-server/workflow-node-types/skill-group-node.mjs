import { CapabilityNodeError, getCapabilityNode, updateCapabilityNode, setSkillEnabled as setSkillEnabledInStore } from '../workflow-capability-node-store.mjs'

function rethrow(error) {
  if (error instanceof CapabilityNodeError) throw error
  throw new CapabilityNodeError(error.message, {
    statusCode: error.statusCode,
    code: error.code,
  })
}

function requireSkillGroupNode(current) {
  if (current.state.type !== 'skill-group') {
    throw new CapabilityNodeError(`Node is not a skill-group node: ${current.node.nodeId}`, {
      statusCode: 409,
      code: 'TYPE_MISMATCH',
    })
  }
  return current.state
}

export function read(nodeId, projectRoot) {
  try {
    const current = getCapabilityNode(projectRoot, nodeId)
    const state = requireSkillGroupNode(current)
    return {
      title: current.node.title,
      revision: current.node.revision,
      description: state.description || '',
      prompt: state.prompt || '',
      sourceGroup: state.sourceGroup || null,
      skills: state.skills || [],
      skillNames: state.skillNames || [],
      skillCount: Number(state.skillCount || 0),
      nodeSemantics: state.nodeSemantics,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function setSkillEnabled(nodeId, projectRoot, payload = {}) {
  try {
    const current = getCapabilityNode(projectRoot, nodeId)
    requireSkillGroupNode(current)
    const rawSkillId = payload && Object.hasOwn(payload, 'skillId') ? payload.skillId : payload.skill
    const enabled = payload ? payload.enabled : undefined
    const skillId = String(rawSkillId || '').trim()
    if (!skillId) {
      throw new CapabilityNodeError('skillId is required for skill-group.setSkillEnabled', {
        statusCode: 400,
        code: 'SKILL_ID_REQUIRED',
      })
    }
    if (enabled !== true && enabled !== false) {
      throw new CapabilityNodeError('enabled must be a boolean for skill-group.setSkillEnabled', {
        statusCode: 400,
        code: 'INVALID_ENABLED',
      })
    }
    const result = setSkillEnabledInStore(projectRoot, nodeId, skillId, enabled)
    return {
      revision: result.revision,
      skillId: result.skillId,
      enabled: result.enabled,
      skills: result.skills,
      skillNames: result.skillNames,
      skillCount: result.skillCount,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function configure(nodeId, projectRoot, payload = {}) {
  try {
    const current = getCapabilityNode(projectRoot, nodeId)
    requireSkillGroupNode(current)
    const updated = updateCapabilityNode(projectRoot, nodeId, {
      revision: current.node.revision,
      title: payload.title,
      description: payload.description,
      prompt: payload.prompt,
      sourceGroup: payload.sourceGroup,
      skills: payload.skills,
    })
    return {
      revision: updated.node.revision,
      description: updated.state.description || '',
      prompt: updated.state.prompt || '',
      sourceGroup: updated.state.sourceGroup || null,
      skills: updated.state.skills || [],
      skillNames: updated.state.skillNames || [],
      skillCount: Number(updated.state.skillCount || 0),
    }
  } catch (error) {
    rethrow(error)
  }
}
