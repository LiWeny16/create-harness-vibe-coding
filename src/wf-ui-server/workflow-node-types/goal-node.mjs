import fs from 'node:fs'
import path from 'node:path'
import { GoalNodeError, getGoalNode, updateGoalNodeSidecar } from '../workflow-goal-node-store.mjs'

function rethrow(error) {
  if (error instanceof GoalNodeError) throw error
  throw new GoalNodeError(error.message, {
    statusCode: error.statusCode,
    code: error.code,
  })
}

function safeString(value, maxLength = 400) {
  return String(value || '').trim().slice(0, maxLength)
}

function uniqueStrings(value, maxItems = 50) {
  const seen = new Set()
  const result = []
  for (const item of Array.isArray(value) ? value : []) {
    const text = safeString(item, 240)
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
    if (result.length >= maxItems) break
  }
  return result
}

function normalizeAcceptance(value) {
  if (!Array.isArray(value)) return undefined
  return value.slice(0, 100).map((item, index) => {
    if (typeof item === 'string') {
      return { id: `AC-${String(index + 1).padStart(3, '0')}`, text: safeString(item, 1000), status: 'tracked' }
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return {
        id: safeString(item.id || `AC-${String(index + 1).padStart(3, '0')}`, 120),
        text: safeString(item.text || item.title || item.id || `Acceptance ${index + 1}`, 1000),
        status: safeString(item.status || 'tracked', 80),
      }
    }
    return { id: `AC-${String(index + 1).padStart(3, '0')}`, text: safeString(item, 1000), status: 'tracked' }
  })
}

function normalizePlanItems(value) {
  if (!Array.isArray(value)) return undefined
  return value.slice(0, 100).map((item, index) => {
    if (typeof item === 'string') {
      return { id: `P-${String(index + 1).padStart(3, '0')}`, text: safeString(item, 1000), status: 'todo' }
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return {
        id: safeString(item.id || `P-${String(index + 1).padStart(3, '0')}`, 120),
        text: safeString(item.text || item.title || item.id || `Plan item ${index + 1}`, 1000),
        status: safeString(item.status || 'todo', 80),
        updatedBy: safeString(item.updatedBy, 120),
        updatedAt: safeString(item.updatedAt, 120),
      }
    }
    return { id: `P-${String(index + 1).padStart(3, '0')}`, text: safeString(item, 1000), status: 'todo' }
  })
}

function normalizeWdt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return {
    enabled: value.enabled !== undefined ? Boolean(value.enabled) : undefined,
    state: safeString(value.state, 80),
    timerNodeId: safeString(value.timerNodeId, 120),
    lastAckAt: safeString(value.lastAckAt, 120),
  }
}

export function read(nodeId, projectRoot) {
  try {
    return getGoalNode(projectRoot, nodeId).state
  } catch (error) {
    rethrow(error)
  }
}

export function update(nodeId, projectRoot, payload = {}) {
  try {
    const acceptance = normalizeAcceptance(payload.acceptance)
    const planItems = normalizePlanItems(payload.planItems)
    const wdt = normalizeWdt(payload.wdt)
    const patch = {
      ...(payload.title !== undefined ? { title: safeString(payload.title, 400) } : {}),
      ...(payload.objective !== undefined ? { objective: safeString(payload.objective, 2000) } : {}),
      ...(payload.nextAction !== undefined ? { nextAction: safeString(payload.nextAction, 1000) } : {}),
      ...(acceptance ? { acceptance } : {}),
      ...(planItems ? { planItems } : {}),
      ...(wdt ? { wdt } : {}),
    }
    const updated = updateGoalNodeSidecar(projectRoot, nodeId, patch)
    return { state: updated.state, revision: updated.revision }
  } catch (error) {
    rethrow(error)
  }
}

export function requestCompletion(nodeId, projectRoot, payload = {}) {
  try {
    const actorNodeId = safeString(payload.actorNodeId, 120)
    const proposedAt = payload.now && Number.isFinite(Date.parse(payload.now))
      ? new Date(Date.parse(payload.now)).toISOString()
      : new Date().toISOString()
    const updated = updateGoalNodeSidecar(projectRoot, nodeId, {
      status: 'proposed-complete',
      confirmation: {
        state: 'proposed',
        proposedBy: actorNodeId,
        proposedAt,
        evidenceRefs: uniqueStrings(payload.evidenceRefs),
        note: safeString(payload.note, 1000),
      },
    })
    return {
      state: updated.state,
      revision: updated.revision,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function returnToWork(nodeId, projectRoot, payload = {}) {
  try {
    const updated = updateGoalNodeSidecar(projectRoot, nodeId, {
      status: 'active',
      confirmation: {
        state: 'returned',
        proposedBy: safeString(payload.actorNodeId, 120),
        proposedAt: payload.now && Number.isFinite(Date.parse(payload.now))
          ? new Date(Date.parse(payload.now)).toISOString()
          : new Date().toISOString(),
        evidenceRefs: uniqueStrings(payload.evidenceRefs),
        note: safeString(payload.note, 1000),
      },
    })
    return { state: updated.state, revision: updated.revision }
  } catch (error) {
    rethrow(error)
  }
}

function nowIso(payload = {}) {
  return payload.now && Number.isFinite(Date.parse(payload.now))
    ? new Date(Date.parse(payload.now)).toISOString()
    : new Date().toISOString()
}

function nextItemId(items, prefix) {
  const re = new RegExp(`^${prefix}-(\\d+)$`)
  let max = 0
  for (const item of items) {
    const match = String(item.id || '').match(re)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}

export function add(nodeId, projectRoot, payload = {}) {
  try {
    const current = getGoalNode(projectRoot, nodeId)
    const patch = {}
    if (Array.isArray(payload.planItems) && payload.planItems.length) {
      const items = (current.state.planItems || []).slice()
      for (const raw of payload.planItems.slice(0, 100)) {
        const text = safeString(typeof raw === 'object' && raw && !Array.isArray(raw) ? (raw.text || raw.title) : raw, 1000)
        if (!text) continue
        items.push({
          id: nextItemId(items, 'P'),
          text,
          status: safeString(typeof raw === 'object' && raw && !Array.isArray(raw) ? raw.status : '', 80) || 'todo',
        })
      }
      patch.planItems = items
    }
    if (Array.isArray(payload.acceptance) && payload.acceptance.length) {
      const items = (current.state.acceptance || []).slice()
      for (const raw of payload.acceptance.slice(0, 100)) {
        const text = safeString(typeof raw === 'object' && raw && !Array.isArray(raw) ? (raw.text || raw.title) : raw, 1000)
        if (!text) continue
        items.push({
          id: nextItemId(items, 'AC'),
          text,
          status: safeString(typeof raw === 'object' && raw && !Array.isArray(raw) ? raw.status : '', 80) || 'tracked',
        })
      }
      patch.acceptance = items
    }
    const updated = updateGoalNodeSidecar(projectRoot, nodeId, patch)
    return { state: updated.state, revision: updated.revision }
  } catch (error) {
    rethrow(error)
  }
}

function removeItems(nodeId, projectRoot, payload = {}) {
  try {
    const current = getGoalNode(projectRoot, nodeId)
    const patch = {}
    const skipped = []
    const planItemIds = new Set(uniqueStrings(payload.planItemIds))
    if (planItemIds.size) {
      const items = (current.state.planItems || []).slice()
      patch.planItems = items.filter(item => !planItemIds.has(item.id))
      for (const id of planItemIds) {
        if (!items.some(item => item.id === id)) skipped.push(id)
      }
    }
    const acceptanceIds = new Set(uniqueStrings(payload.acceptanceIds))
    if (acceptanceIds.size) {
      const items = (current.state.acceptance || []).slice()
      patch.acceptance = items.filter(item => !acceptanceIds.has(item.id))
      for (const id of acceptanceIds) {
        if (!items.some(item => item.id === id)) skipped.push(id)
      }
    }
    const updated = updateGoalNodeSidecar(projectRoot, nodeId, patch)
    return { state: updated.state, revision: updated.revision, skipped }
  } catch (error) {
    rethrow(error)
  }
}

export { removeItems as delete }

export function replace(nodeId, projectRoot, payload = {}) {
  try {
    const current = getGoalNode(projectRoot, nodeId)
    const patch = {}
    if (Array.isArray(payload.planItems)) {
      const items = []
      for (const raw of payload.planItems.slice(0, 100)) {
        if (typeof raw === 'string') {
          const text = safeString(raw, 1000)
          if (!text) continue
          items.push({ id: nextItemId(items, 'P'), text, status: 'todo' })
        } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const text = safeString(raw.text || raw.title || '', 1000)
          if (!text) continue
          items.push({
            id: safeString(raw.id, 120) || nextItemId(items, 'P'),
            text,
            status: safeString(raw.status || 'todo', 80),
            updatedBy: safeString(raw.updatedBy, 120),
            updatedAt: safeString(raw.updatedAt, 120),
          })
        }
      }
      patch.planItems = items
    }
    if (Array.isArray(payload.acceptance)) {
      const items = []
      for (const raw of payload.acceptance.slice(0, 100)) {
        if (typeof raw === 'string') {
          const text = safeString(raw, 1000)
          if (!text) continue
          items.push({ id: nextItemId(items, 'AC'), text, status: 'tracked' })
        } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const text = safeString(raw.text || raw.title || '', 1000)
          if (!text) continue
          items.push({
            id: safeString(raw.id, 120) || nextItemId(items, 'AC'),
            text,
            status: safeString(raw.status || 'tracked', 80),
          })
        }
      }
      patch.acceptance = items
    }
    const updated = updateGoalNodeSidecar(projectRoot, nodeId, patch)
    return { state: updated.state, revision: updated.revision }
  } catch (error) {
    rethrow(error)
  }
}

export function check(nodeId, projectRoot, payload = {}) {
  try {
    const current = getGoalNode(projectRoot, nodeId)
    const ids = new Set(uniqueStrings(payload.planItemIds))
    const planItems = (current.state.planItems || []).map(item => (
      ids.has(item.id)
        ? {
            ...item,
            status: 'done',
            updatedBy: safeString(payload.actorNodeId, 120),
            updatedAt: nowIso(payload),
          }
        : item
    ))
    const updated = updateGoalNodeSidecar(projectRoot, nodeId, { planItems })
    return { state: updated.state, revision: updated.revision }
  } catch (error) {
    rethrow(error)
  }
}

export function uncheck(nodeId, projectRoot, payload = {}) {
  try {
    const current = getGoalNode(projectRoot, nodeId)
    const ids = new Set(uniqueStrings(payload.planItemIds))
    const planItems = (current.state.planItems || []).map(item => (
      ids.has(item.id)
        ? {
            ...item,
            status: 'todo',
            updatedBy: safeString(payload.actorNodeId, 120),
            updatedAt: nowIso(payload),
          }
        : item
    ))
    const updated = updateGoalNodeSidecar(projectRoot, nodeId, { planItems })
    return { state: updated.state, revision: updated.revision }
  } catch (error) {
    rethrow(error)
  }
}

const DONE_STATUSES = new Set(['done', 'complete', 'completed', 'pass', 'passed', 'verified'])

// ── Bound task capsule auto-close (goal.complete / goal.reopen) ──
// Goal nodes are bound to a task capsule via taskId. When the Goal completes,
// the backend mechanically closes the capsule (phase -> 'completed', keeping
// status 'active' so the Goal stays resolvable; archiving stays a separate
// protocol step). Capsule problems are non-fatal: the Goal action still
// succeeds and the outcome is reported through taskUpdate.
const TASK_UPDATE_COMPLETED = 'completed'
const TASK_UPDATE_REOPENED = 'reopened'
const TASK_UPDATE_NO_CAPSULE = 'no-capsule'
const TASK_UPDATE_NO_TASK_BINDING = 'no-task-binding'

function capsuleTaskDir(projectRoot, taskId) {
  return path.join(projectRoot, 'Harness', 'tasks', taskId)
}

function readCapsuleState(taskDir) {
  const statePath = path.join(taskDir, 'STATE.json')
  if (!fs.existsSync(statePath)) return null
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}

function writeCapsuleState(taskDir, state) {
  fs.writeFileSync(path.join(taskDir, 'STATE.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function appendCapsuleNote(taskDir, section) {
  const progressPath = path.join(taskDir, 'PROGRESS.md')
  let content = ''
  if (fs.existsSync(progressPath)) {
    content = fs.readFileSync(progressPath, 'utf8')
  }
  const body = content
    ? `${content}${content.endsWith('\n') ? '' : '\n'}${section}`
    : section.replace(/^\n+/, '')
  fs.writeFileSync(progressPath, body, 'utf8')
}

export function updateTaskCapsuleOnComplete(projectRoot, taskId, goalNodeId, at, itemCount) {
  try {
    const id = safeString(taskId, 200)
    if (!id) return TASK_UPDATE_NO_TASK_BINDING
    const taskDir = capsuleTaskDir(projectRoot, id)
    const state = readCapsuleState(taskDir)
    if (!state) return TASK_UPDATE_NO_CAPSULE
    const previousPhase = state.preCompletePhase
      || (typeof state.phase === 'string' && state.phase ? state.phase : 'implementation')
    state.phase = 'completed'
    state.closedBy = 'goal-complete'
    state.preCompletePhase = previousPhase
    state.updatedAt = at
    writeCapsuleState(taskDir, state)
    appendCapsuleNote(taskDir, `\n## Goal Completed\n\n- at: ${at}\n- goalNodeId: ${goalNodeId}\n- items: ${itemCount}\n`)
    return TASK_UPDATE_COMPLETED
  } catch {
    return TASK_UPDATE_NO_CAPSULE
  }
}

export function updateTaskCapsuleOnReopen(projectRoot, taskId, goalNodeId, at) {
  try {
    const id = safeString(taskId, 200)
    if (!id) return TASK_UPDATE_NO_TASK_BINDING
    const taskDir = capsuleTaskDir(projectRoot, id)
    const state = readCapsuleState(taskDir)
    if (!state) return TASK_UPDATE_NO_CAPSULE
    state.phase = typeof state.preCompletePhase === 'string' && state.preCompletePhase
      ? state.preCompletePhase
      : 'implementation'
    delete state.preCompletePhase
    delete state.closedBy
    state.updatedAt = at
    writeCapsuleState(taskDir, state)
    appendCapsuleNote(taskDir, `\n## Goal Reopened\n\n- at: ${at}\n- goalNodeId: ${goalNodeId}\n`)
    return TASK_UPDATE_REOPENED
  } catch {
    return TASK_UPDATE_NO_CAPSULE
  }
}

export function complete(nodeId, projectRoot, payload = {}) {
  try {
    const current = getGoalNode(projectRoot, nodeId)
    const remaining = (current.state.planItems || [])
      .filter(item => !DONE_STATUSES.has(String(item.status || '').toLowerCase()))
      .map(item => item.id)
    if (remaining.length) {
      const error = new GoalNodeError('Complete all plan items before completing the Goal.', {
        statusCode: 409,
        code: 'goal_items_pending',
      })
      error.remaining = remaining
      throw error
    }
    const at = nowIso(payload)
    const updated = updateGoalNodeSidecar(projectRoot, nodeId, {
      status: 'proposed-complete',
      confirmation: {
        state: 'proposed',
        proposedBy: safeString(payload.actorNodeId, 120),
        proposedAt: at,
        evidenceRefs: uniqueStrings(payload.evidenceRefs),
        note: safeString(payload.note, 1000),
      },
    })
    const taskUpdate = updateTaskCapsuleOnComplete(
      projectRoot,
      safeString(current.state.taskId, 200),
      current.node.nodeId,
      at,
      (current.state.planItems || []).length,
    )
    return { state: updated.state, revision: updated.revision, taskUpdate }
  } catch (error) {
    rethrow(error)
  }
}

export function reopen(nodeId, projectRoot, payload = {}) {
  try {
    const current = getGoalNode(projectRoot, nodeId)
    const at = nowIso(payload)
    const updated = updateGoalNodeSidecar(projectRoot, nodeId, {
      status: 'active',
      confirmation: {
        state: 'returned',
        proposedBy: safeString(payload.actorNodeId, 120),
        proposedAt: at,
        evidenceRefs: uniqueStrings(payload.evidenceRefs),
        note: safeString(payload.note, 1000),
      },
    })
    const taskUpdate = updateTaskCapsuleOnReopen(
      projectRoot,
      safeString(current.state.taskId, 200),
      current.node.nodeId,
      at,
    )
    return { state: updated.state, revision: updated.revision, taskUpdate }
  } catch (error) {
    rethrow(error)
  }
}

export function ackWatchdog(nodeId, projectRoot, payload = {}) {
  try {
    const at = payload.now && Number.isFinite(Date.parse(payload.now))
      ? new Date(Date.parse(payload.now)).toISOString()
      : new Date().toISOString()
    const updated = updateGoalNodeSidecar(projectRoot, nodeId, {
      wdt: {
        enabled: true,
        state: 'ok',
        timerNodeId: safeString(payload.timerNodeId, 120),
        lastAckAt: at,
      },
    })
    return { state: updated.state, revision: updated.revision }
  } catch (error) {
    rethrow(error)
  }
}
