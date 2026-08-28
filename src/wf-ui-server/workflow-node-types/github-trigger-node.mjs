import { EventNodeError, getEventNode, updateEventNode } from '../workflow-event-node-store.mjs'

function rethrow(error) {
  if (error instanceof EventNodeError) throw error
  throw new EventNodeError(error.message, {
    statusCode: error.statusCode,
    code: error.code,
  })
}

function requireGithubTriggerNode(current) {
  if (current.state.type !== 'github-trigger') {
    throw new EventNodeError(`Node is not a github-trigger node: ${current.node.nodeId}`, {
      statusCode: 409,
      code: 'TYPE_MISMATCH',
    })
  }
  return current.state
}

function safeString(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength)
}

function safeGithubName(value, maxLength = 100) {
  return safeString(value, maxLength).replace(/[^A-Za-z0-9_.-]/g, '')
}

function normalizeRepository(value, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const fallbackSource = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {}
  const fullName = safeString(source.fullName || source.full_name || fallbackSource.fullName || '', 220)
  const [fullOwner, fullRepo] = fullName.includes('/') ? fullName.split('/', 2) : ['', '']
  const owner = safeGithubName(source.owner || fallbackSource.owner || fullOwner)
  const name = safeGithubName(source.name || source.repo || fallbackSource.name || fullRepo)
  return {
    owner,
    name,
    fullName: owner && name ? `${owner}/${name}` : '',
  }
}

function safeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizePullRequest(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const number = safeNumber(source.number)
  const result = {
    number,
    title: safeString(source.title, 240),
    url: safeString(source.url || source.htmlUrl || source.html_url, 300),
  }
  return number || result.title || result.url ? result : null
}

function normalizeIssue(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const number = safeNumber(source.number)
  const result = {
    number,
    title: safeString(source.title, 240),
    url: safeString(source.url || source.htmlUrl || source.html_url, 300),
  }
  return number || result.title || result.url ? result : null
}

function normalizeRelease(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const result = {
    tagName: safeString(source.tagName || source.tag_name, 120),
    name: safeString(source.name, 180),
    url: safeString(source.url || source.htmlUrl || source.html_url, 300),
  }
  return result.tagName || result.name || result.url ? result : null
}

function normalizeWorkflowRun(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const id = safeNumber(source.id)
  const result = {
    id,
    name: safeString(source.name, 180),
    status: safeString(source.status, 80),
    conclusion: safeString(source.conclusion, 80),
    url: safeString(source.url || source.htmlUrl || source.html_url, 300),
  }
  return id || result.name || result.status || result.conclusion || result.url ? result : null
}

function boundedDeliveryEvent(nodeId, state, payload = {}) {
  const eventName = safeString(payload.event || payload.githubEvent || payload.name || 'event', 80) || 'event'
  const action = safeString(payload.action, 80)
  const repository = normalizeRepository(payload.repository, state.repository)
  const deliveryId = safeString(payload.deliveryId || payload.deliveryID || payload.id, 120)
  const receivedAt = new Date().toISOString()
  const nextCount = Number(state.eventCount || 0) + 1
  const pullRequest = normalizePullRequest(payload.pullRequest || payload.pull_request)
  const issue = normalizeIssue(payload.issue)
  const release = normalizeRelease(payload.release)
  const workflowRun = normalizeWorkflowRun(payload.workflowRun || payload.workflow_run)
  const ref = safeString(payload.ref, 220)
  const sender = typeof payload.sender === 'string'
    ? safeString(payload.sender, 120)
    : safeString(payload.sender?.login || payload.sender?.name, 120)
  const dedupeKey = safeString(
    payload.dedupeKey
      || deliveryId
      || `${eventName}:${action}:${repository.fullName}:${ref}:${pullRequest?.number || issue?.number || release?.tagName || workflowRun?.id || nextCount}`,
    180,
  )
  return {
    id: `${nodeId}:event:${nextCount}`,
    kind: `github.${eventName}`,
    sourceNodeId: nodeId,
    receivedAt,
    firedAt: receivedAt,
    event: eventName,
    action,
    deliveryId,
    dedupeKey,
    repository,
    ref,
    sender,
    ...(pullRequest ? { pullRequest } : {}),
    ...(issue ? { issue } : {}),
    ...(release ? { release } : {}),
    ...(workflowRun ? { workflowRun } : {}),
  }
}

export function read(nodeId, projectRoot) {
  try {
    const current = getEventNode(projectRoot, nodeId)
    const state = requireGithubTriggerNode(current)
    return {
      title: current.node.title,
      revision: current.node.revision,
      enabled: state.enabled,
      repository: state.repository,
      eventFilters: state.eventFilters,
      payloadTemplate: state.payloadTemplate,
      eventCount: state.eventCount,
      deliveryCount: state.deliveryCount,
      lastReceivedAt: state.lastReceivedAt,
      lastDeliveryId: state.lastDeliveryId,
      lastEvent: state.lastEvent,
      dedupeKeys: state.dedupeKeys,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function receive(nodeId, projectRoot, payload = {}) {
  try {
    const current = getEventNode(projectRoot, nodeId)
    const state = requireGithubTriggerNode(current)
    const event = boundedDeliveryEvent(nodeId, state, payload)
    const dedupeKeys = [event.dedupeKey, ...(Array.isArray(state.dedupeKeys) ? state.dedupeKeys : [])]
      .filter(Boolean)
      .slice(0, 50)
    const updated = updateEventNode(projectRoot, nodeId, {
      revision: current.node.revision,
      repository: event.repository,
      eventCount: Number(state.eventCount || 0) + 1,
      lastFiredAt: event.firedAt,
      lastReceivedAt: event.receivedAt,
      lastDeliveryId: event.deliveryId,
      lastEvent: event,
      dedupeKeys,
    })
    return {
      event,
      state: updated.state,
      revision: updated.node.revision,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function configure(nodeId, projectRoot, payload = {}) {
  try {
    const current = getEventNode(projectRoot, nodeId)
    requireGithubTriggerNode(current)
    const updated = updateEventNode(projectRoot, nodeId, {
      revision: current.node.revision,
      title: payload.title,
      enabled: payload.enabled,
      repository: payload.repository,
      eventFilters: payload.eventFilters,
      payloadTemplate: payload.payloadTemplate,
    })
    return {
      enabled: updated.state.enabled,
      repository: updated.state.repository,
      eventFilters: updated.state.eventFilters,
      payloadTemplate: updated.state.payloadTemplate,
      revision: updated.node.revision,
    }
  } catch (error) {
    rethrow(error)
  }
}
