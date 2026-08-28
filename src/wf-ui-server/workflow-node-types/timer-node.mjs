import { EventNodeError, getEventNode, updateEventNode } from '../workflow-event-node-store.mjs'
import { computeMagneticTopology, loadWorkflowGraphMap } from '../a2a-store.mjs'
import { listGoalNodes } from '../workflow-goal-node-store.mjs'
import { recordBridgeMessage } from '../bridge-store.mjs'

const TIMER_CONTROL_ACTIONS = new Set([
  'configure',
  'enable',
  'disable',
  'setInterval',
  'setMode',
  'ackWatchdog',
  'resetWatchdog',
])

function rethrow(error) {
  if (error instanceof EventNodeError) throw error
  throw new EventNodeError(error.message, {
    statusCode: error.statusCode,
    code: error.code,
  })
}

function requireTimerNode(current) {
  if (current.state.type !== 'timer') {
    throw new EventNodeError(`Node is not a timer node: ${current.node.nodeId}`, {
      statusCode: 409,
      code: 'TYPE_MISMATCH',
    })
  }
  return current.state
}

function clampInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.floor(number)))
}

function nowIso(payload = {}) {
  const explicit = String(payload.now || '').trim()
  if (explicit) {
    const time = Date.parse(explicit)
    if (Number.isFinite(time)) return new Date(time).toISOString()
  }
  return new Date().toISOString()
}

function parseTime(value) {
  const time = Date.parse(String(value || ''))
  return Number.isFinite(time) ? time : 0
}

function addSeconds(iso, seconds) {
  return new Date(parseTime(iso) + Number(seconds || 0) * 1000).toISOString()
}

function controlPolicy(state) {
  return state.controlPolicy || {
    agentCanDisable: false,
    agentCanSetInterval: false,
    agentCanSetMode: true,
    agentCanAckWatchdog: true,
    minIntervalSeconds: 5,
    maxIntervalSeconds: 86400,
  }
}

function assertPolicyAllowed(state, action) {
  const policy = controlPolicy(state)
  if (action === 'disable' && !policy.agentCanDisable) {
    throw new EventNodeError('Timer control policy does not allow agent disable', {
      statusCode: 403,
      code: 'CONTROL_DENIED',
    })
  }
  if (action === 'setInterval' && !policy.agentCanSetInterval) {
    throw new EventNodeError('Timer control policy does not allow agent interval changes', {
      statusCode: 403,
      code: 'CONTROL_DENIED',
    })
  }
  if (action === 'setMode' && policy.agentCanSetMode === false) {
    throw new EventNodeError('Timer control policy does not allow agent mode changes', {
      statusCode: 403,
      code: 'CONTROL_DENIED',
    })
  }
  if ((action === 'ackWatchdog' || action === 'resetWatchdog') && policy.agentCanAckWatchdog === false) {
    throw new EventNodeError('Timer control policy does not allow watchdog acknowledgement', {
      statusCode: 403,
      code: 'CONTROL_DENIED',
    })
  }
}

function updateTimer(projectRoot, nodeId, patchBuilder) {
  const current = getEventNode(projectRoot, nodeId)
  const state = requireTimerNode(current)
  const patch = patchBuilder(state, current.node) || {}
  const updated = updateEventNode(projectRoot, nodeId, {
    revision: current.node.revision,
    ...patch,
  })
  return {
    state: updated.state,
    revision: updated.node.revision,
  }
}

export function read(nodeId, projectRoot) {
  try {
    const current = getEventNode(projectRoot, nodeId)
    const state = requireTimerNode(current)
    return {
      title: current.node.title,
      revision: current.node.revision,
      enabled: state.enabled,
      schedule: state.schedule,
      heartbeat: state.heartbeat,
      loop: state.loop,
      whileGuard: state.whileGuard,
      taskBinding: state.taskBinding,
      controlPolicy: state.controlPolicy,
      payloadTemplate: state.payloadTemplate,
      eventCount: state.eventCount,
      lastFiredAt: state.lastFiredAt,
      lastEvent: state.lastEvent,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function fire(nodeId, projectRoot, { payload } = {}) {
  try {
    const current = getEventNode(projectRoot, nodeId)
    const state = requireTimerNode(current)
    const firedAt = new Date().toISOString()
    const event = {
      id: `${nodeId}:event:${Number(state.eventCount || 0) + 1}`,
      kind: 'timer.fire',
      sourceNodeId: nodeId,
      firedAt,
      payload: payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : state.payloadTemplate || {},
    }
    const updated = updateEventNode(projectRoot, nodeId, {
      revision: current.node.revision,
      eventCount: Number(state.eventCount || 0) + 1,
      lastFiredAt: firedAt,
      lastEvent: event,
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
    const state = requireTimerNode(current)
    const actorNodeId = String(payload.actorNodeId || '').trim()
    if (actorNodeId) {
      if (payload.enabled === false) assertPolicyAllowed(state, 'disable')
      if (payload.schedule && typeof payload.schedule === 'object' && !Array.isArray(payload.schedule)) {
        if (payload.schedule.intervalSeconds !== undefined && Number(payload.schedule.intervalSeconds) !== Number(state.schedule?.intervalSeconds)) {
          assertPolicyAllowed(state, 'setInterval')
        }
        if (payload.schedule.mode !== undefined && String(payload.schedule.mode || '').toLowerCase() !== String(state.schedule?.mode || '').toLowerCase()) {
          assertPolicyAllowed(state, 'setMode')
        }
      }
      if (payload.heartbeat && typeof payload.heartbeat === 'object' && !Array.isArray(payload.heartbeat) && payload.heartbeat.watchdog) {
        assertPolicyAllowed(state, 'ackWatchdog')
      }
      if (payload.controlPolicy !== undefined || payload.payloadTemplate !== undefined || payload.loop !== undefined || payload.whileGuard !== undefined || payload.taskBinding !== undefined) {
        throw new EventNodeError('Agent timer configure cannot mutate policy, templates, loop guards, or task bindings', {
          statusCode: 403,
          code: 'CONTROL_DENIED',
        })
      }
    }
    const updated = updateEventNode(projectRoot, nodeId, {
      revision: current.node.revision,
      title: payload.title,
      enabled: payload.enabled,
      schedule: payload.schedule,
      heartbeat: payload.heartbeat,
      ...(actorNodeId ? {} : {
        loop: payload.loop,
        whileGuard: payload.whileGuard,
        taskBinding: payload.taskBinding,
        controlPolicy: payload.controlPolicy,
        payloadTemplate: payload.payloadTemplate,
      }),
    })
    return {
      enabled: updated.state.enabled,
      schedule: updated.state.schedule,
      heartbeat: updated.state.heartbeat,
      loop: updated.state.loop,
      whileGuard: updated.state.whileGuard,
      taskBinding: updated.state.taskBinding,
      controlPolicy: updated.state.controlPolicy,
      payloadTemplate: updated.state.payloadTemplate,
      revision: updated.node.revision,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function enable(nodeId, projectRoot) {
  try {
    return updateTimer(projectRoot, nodeId, (state) => ({
      enabled: true,
      heartbeat: {
        ...state.heartbeat,
        base: {
          ...(state.heartbeat?.base || {}),
          enabled: true,
        },
      },
    }))
  } catch (error) {
    rethrow(error)
  }
}

export function disable(nodeId, projectRoot) {
  try {
    return updateTimer(projectRoot, nodeId, (state) => {
      assertPolicyAllowed(state, 'disable')
      return {
        enabled: false,
        heartbeat: {
          ...state.heartbeat,
          base: {
            ...(state.heartbeat?.base || {}),
            enabled: false,
          },
        },
      }
    })
  } catch (error) {
    rethrow(error)
  }
}

export function setInterval(nodeId, projectRoot, payload = {}) {
  try {
    return updateTimer(projectRoot, nodeId, (state) => {
      assertPolicyAllowed(state, 'setInterval')
      const policy = controlPolicy(state)
      const seconds = clampInteger(payload.intervalSeconds, {
        min: policy.minIntervalSeconds,
        max: policy.maxIntervalSeconds,
        fallback: state.schedule?.intervalSeconds || 60,
      })
      const lane = String(payload.lane || 'base').trim().toLowerCase()
      const heartbeat = {
        ...(state.heartbeat || {}),
        base: { ...(state.heartbeat?.base || {}) },
        watchdog: { ...(state.heartbeat?.watchdog || {}) },
      }
      if (lane === 'watchdog') heartbeat.watchdog.intervalSeconds = seconds
      else heartbeat.base.intervalSeconds = seconds
      return {
        schedule: {
          ...(state.schedule || {}),
          intervalSeconds: seconds,
        },
        heartbeat,
      }
    })
  } catch (error) {
    rethrow(error)
  }
}

export function setMode(nodeId, projectRoot, payload = {}) {
  try {
    return updateTimer(projectRoot, nodeId, (state) => {
      assertPolicyAllowed(state, 'setMode')
      const mode = ['manual', 'once', 'interval', 'cron', 'loop', 'adaptive', 'watchdog', 'while', 'task'].includes(String(payload.mode || '').toLowerCase())
        ? String(payload.mode).toLowerCase()
        : state.schedule?.mode || 'manual'
      return {
        schedule: {
          ...(state.schedule || {}),
          mode,
        },
      }
    })
  } catch (error) {
    rethrow(error)
  }
}

export function ackWatchdog(nodeId, projectRoot, payload = {}) {
  try {
    return updateTimer(projectRoot, nodeId, (state) => {
      assertPolicyAllowed(state, 'ackWatchdog')
      const at = nowIso(payload)
      return {
        heartbeat: {
          ...(state.heartbeat || {}),
          watchdog: {
            ...(state.heartbeat?.watchdog || {}),
            enabled: state.heartbeat?.watchdog?.enabled !== false,
            lastAckAt: at,
            state: 'ok',
          },
        },
      }
    })
  } catch (error) {
    rethrow(error)
  }
}

export function resetWatchdog(nodeId, projectRoot, payload = {}) {
  try {
    return updateTimer(projectRoot, nodeId, (state) => {
      assertPolicyAllowed(state, 'resetWatchdog')
      const at = nowIso(payload)
      return {
        heartbeat: {
          ...(state.heartbeat || {}),
          watchdog: {
            ...(state.heartbeat?.watchdog || {}),
            enabled: state.heartbeat?.watchdog?.enabled !== false,
            lastPingAt: '',
            lastAckAt: at,
            state: 'ok',
            missedCount: 0,
          },
        },
      }
    })
  } catch (error) {
    rethrow(error)
  }
}

// Backend-internal (spec §6): composes the wakeup envelope and appends it to
// the message queue of every agent in the timer's magnetic group via the
// bridge store. Never writes to PTY stdin — wakeups land in the message store
// only, and agents read them on their next turn. Agents must not invoke this
// action; the bounded scheduler is the only caller.
export function dispatchWakeup(nodeId, projectRoot, payload = {}) {
  try {
    const current = getEventNode(projectRoot, nodeId)
    const state = requireTimerNode(current)
    const timerNodeId = current.node.nodeId
    const firedAt = String(payload.firedAt || new Date().toISOString())
    const scheduledAt = String(payload.scheduledAt || firedAt)
    const intervalSeconds = payload.intervalSeconds !== undefined && payload.intervalSeconds !== null
      ? clampInteger(payload.intervalSeconds, { min: 1, fallback: 60 })
      : clampInteger(state.heartbeat?.base?.intervalSeconds ?? state.schedule?.intervalSeconds, { min: 1, fallback: 60 })
    const envelope = {
      type: 'wakeup',
      messageId: `wake-${timerNodeId}-${Number(state.eventCount || 0)}`,
      timerNodeId,
      goalNodeId: null,
      scheduledAt,
      firedAt,
      intervalSeconds,
    }
    const graph = loadWorkflowGraphMap(projectRoot)
    const { byNode } = computeMagneticTopology(Array.isArray(graph.capsuleDockLinks) ? graph.capsuleDockLinks : [])
    const nodeGroup = byNode[timerNodeId]
    const groupIds = new Set(
      nodeGroup
        ? [...(nodeGroup.directMagneticNeighbors || []), ...(nodeGroup.magneticReachableNodes || [])]
        : [],
    )
    // F13/D-union: the wakeup recipient set is the magnetic-group members
    // (capsuleDockLinks) UNION the ordinary graph-edge-connected members —
    // graph edges between the timer and another node with an event/control
    // relation ("连接/磁吸组内", spec §6.1). Both sets are deduped.
    const edgeMemberIds = (Array.isArray(graph.edges) ? graph.edges : [])
      .filter((edge) => {
        const from = String(edge?.from || edge?.source || '').trim()
        const to = String(edge?.to || edge?.target || '').trim()
        if (!from || !to) return false
        const relation = String(edge?.relation || 'wf-bridge').trim()
        if (relation !== 'event' && relation !== 'control') return false
        return from === timerNodeId || to === timerNodeId
      })
      .flatMap((edge) => {
        const from = String(edge?.from || edge?.source || '').trim()
        const to = String(edge?.to || edge?.target || '').trim()
        const peer = from === timerNodeId ? to : from
        return peer ? [peer] : []
      })
    for (const memberId of edgeMemberIds) groupIds.add(memberId)
    // Spec §6.1/6.2: the group holds at most one Goal node; when set, agents
    // must check the Goal state on wakeup.
    const goalNodeIds = new Set((listGoalNodes(projectRoot) || []).map(node => node.nodeId))
    for (const memberId of groupIds) {
      if (goalNodeIds.has(memberId)) {
        envelope.goalNodeId = memberId
        break
      }
    }
    const agents = (graph.nodes || []).filter(node => node?.sessionId && groupIds.has(node.nodeId || node.id))
    const deliveries = []
    for (const agent of agents) {
      const agentNodeId = agent.nodeId || agent.id
      const entry = recordBridgeMessage(projectRoot, {
        fromSessionId: `wakeup-${timerNodeId}`,
        toSessionId: agent.sessionId,
        fromNodeId: timerNodeId,
        toNodeId: agentNodeId,
        data: JSON.stringify(envelope),
        source: 'timer.wakeup',
        deliveryMode: 'wakeup',
        messageId: envelope.messageId,
      })
      if (entry) {
        deliveries.push({
          agentNodeId,
          sessionId: agent.sessionId,
          seq: entry.seq,
          messageId: entry.messageId,
          bridgeId: entry.bridgeId,
        })
      }
    }
    return {
      ok: true,
      envelope,
      groupId: nodeGroup?.magneticGroupId || null,
      goalNodeId: envelope.goalNodeId,
      agentCount: agents.length,
      deliveries,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function tick(nodeId, projectRoot, payload = {}) {
  try {
    const at = nowIso(payload)
    const current = getEventNode(projectRoot, nodeId)
    const state = requireTimerNode(current)
    const events = []
    const heartbeat = {
      ...(state.heartbeat || {}),
      base: { ...(state.heartbeat?.base || {}) },
      watchdog: { ...(state.heartbeat?.watchdog || {}) },
    }

    if (state.enabled && heartbeat.base.enabled && parseTime(heartbeat.base.nextDueAt) && parseTime(heartbeat.base.nextDueAt) <= parseTime(at)) {
      const event = {
        id: `${nodeId}:heartbeat:base:${Number(state.eventCount || 0) + events.length + 1}`,
        kind: 'timer.heartbeat.base',
        sourceNodeId: nodeId,
        firedAt: at,
        payload: state.payloadTemplate || {},
      }
      events.push(event)
      heartbeat.base.count = Number(heartbeat.base.count || 0) + 1
      heartbeat.base.lastAt = at
      heartbeat.base.nextDueAt = addSeconds(at, heartbeat.base.intervalSeconds || state.schedule?.intervalSeconds || 60)
    }

    const watchdogDue = state.enabled
      && heartbeat.watchdog.enabled
      && parseTime(heartbeat.watchdog.lastPingAt)
      && parseTime(at) - parseTime(heartbeat.watchdog.lastPingAt) >= Number(heartbeat.watchdog.timeoutSeconds || 0) * 1000
      && (!parseTime(heartbeat.watchdog.lastAckAt) || parseTime(heartbeat.watchdog.lastAckAt) < parseTime(heartbeat.watchdog.lastPingAt))
    if (watchdogDue) {
      const event = {
        id: `${nodeId}:heartbeat:watchdog:${Number(state.eventCount || 0) + events.length + 1}`,
        kind: 'timer.watchdog.timeout',
        sourceNodeId: nodeId,
        firedAt: at,
        payload: { missedCount: Number(heartbeat.watchdog.missedCount || 0) + 1 },
      }
      events.push(event)
      heartbeat.watchdog.state = 'missed'
      heartbeat.watchdog.missedCount = Number(heartbeat.watchdog.missedCount || 0) + 1
    }

    if (!events.length) return { events, state, revision: current.node.revision }
    const lastEvent = events[events.length - 1]
    const updated = updateEventNode(projectRoot, nodeId, {
      revision: current.node.revision,
      heartbeat,
      eventCount: Number(state.eventCount || 0) + events.length,
      lastFiredAt: at,
      lastEvent,
    })
    return {
      events,
      state: updated.state,
      revision: updated.node.revision,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function timerControlActionsForState(state) {
  const policy = controlPolicy(state || {})
  return [
    'timer.configure',
    'timer.enable',
    ...(policy.agentCanDisable ? ['timer.disable'] : []),
    ...(policy.agentCanSetInterval ? ['timer.setInterval'] : []),
    ...(policy.agentCanSetMode !== false ? ['timer.setMode'] : []),
    ...(policy.agentCanAckWatchdog !== false ? ['timer.ackWatchdog', 'timer.resetWatchdog'] : []),
  ]
}

export function isTimerControlAction(action) {
  return TIMER_CONTROL_ACTIONS.has(action)
}
