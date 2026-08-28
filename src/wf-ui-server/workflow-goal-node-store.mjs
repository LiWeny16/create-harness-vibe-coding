import fs from 'node:fs'
import path from 'node:path'
import { parseTaskCapsule, parseTaskList } from './task-parser.mjs'
import {
  nodeStatePath,
  nodeStateRelPath,
  readStoreJson,
  writeStoreJson,
} from './node-store-utils.mjs'

const GOAL_NODE_ID_RE = /^goal-[A-Za-z0-9][A-Za-z0-9_.-]*$/
const STORE_DIR = 'goal-nodes'

export class GoalNodeError extends Error {
  constructor(message, { statusCode = 400, code = 'BAD_REQUEST' } = {}) {
    super(message)
    this.name = 'GoalNodeError'
    this.statusCode = statusCode
    this.code = code
  }
}

function taskRoot(projectRoot) {
  return path.join(projectRoot, 'Harness', 'tasks')
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

function normalizeAcceptance(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback
  return source.slice(0, 100).map((item, index) => {
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

function normalizePlanItems(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback
  return source.slice(0, 100).map((item, index) => {
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

function assertGoalNodeId(nodeId) {
  const value = String(nodeId || '').trim()
  if (!GOAL_NODE_ID_RE.test(value)) {
    throw new GoalNodeError('Invalid goal node id; traversal and escaped ids are not allowed')
  }
  return value
}

function readActiveTaskId(projectRoot) {
  const progressPath = path.join(projectRoot, 'Harness', 'PROGRESS.md')
  try {
    const lines = fs.readFileSync(progressPath, 'utf8').split(/\r?\n/)
    const index = lines.findIndex(line => /^##\s+Active Task\s*$/.test(line.trim()))
    if (index === -1) return null
    for (const line of lines.slice(index + 1)) {
      const trimmed = line.trim()
      if (trimmed.startsWith('## ')) break
      const match = trimmed.match(/^-\s+([A-Za-z0-9_.-]+)/)
      if (match) return match[1]
    }
  } catch {
    return null
  }
  return null
}

function activeTask(projectRoot) {
  const activeTaskId = readActiveTaskId(projectRoot)
  if (activeTaskId) {
    const capsule = parseTaskCapsule(path.join(taskRoot(projectRoot), activeTaskId))
    if (capsule) return capsule
  }
  return parseTaskList(taskRoot(projectRoot)).find(task => task.status === 'active') || null
}

function taskPaths(taskId) {
  return {
    state: `Harness/tasks/${taskId}/STATE.json`,
    plan: `Harness/tasks/${taskId}/PLAN.md`,
    progress: `Harness/tasks/${taskId}/PROGRESS.md`,
  }
}

function sidecarPath(projectRoot, nodeId) {
  const id = assertGoalNodeId(nodeId)
  return nodeStatePath(projectRoot, {
    storeDir: STORE_DIR,
    statePath: nodeStateRelPath(STORE_DIR, id),
    nodeId: id,
    ErrorClass: GoalNodeError,
    label: 'goal node',
    rootLabel: 'goal',
  })
}

function defaultSidecar() {
  return {
    schemaVersion: 1,
    revision: 0,
    title: '',
    objective: '',
    nextAction: '',
    phase: '',
    gate: '',
    status: '',
    acceptance: [],
    planItems: [],
    confirmation: {
      state: 'none',
      proposedBy: '',
      proposedAt: '',
      evidenceRefs: [],
      note: '',
    },
    wdt: {
      enabled: false,
      state: 'unbound',
      timerNodeId: '',
      lastAckAt: '',
    },
  }
}

function sidecarFor(projectRoot, nodeId) {
  const raw = readStoreJson(sidecarPath(projectRoot, nodeId), null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultSidecar()
  const fallback = defaultSidecar()
  return {
    schemaVersion: 1,
    revision: Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
    title: safeString(raw.title, 400),
    objective: safeString(raw.objective, 2000),
    nextAction: safeString(raw.nextAction, 1000),
    phase: safeString(raw.phase, 120),
    gate: safeString(raw.gate, 120),
    status: safeString(raw.status, 80),
    acceptance: normalizeAcceptance(raw.acceptance),
    planItems: normalizePlanItems(raw.planItems),
    confirmation: {
      ...fallback.confirmation,
      ...(raw.confirmation && typeof raw.confirmation === 'object' && !Array.isArray(raw.confirmation) ? raw.confirmation : {}),
      evidenceRefs: uniqueStrings(raw.confirmation?.evidenceRefs),
    },
    wdt: {
      ...fallback.wdt,
      ...(raw.wdt && typeof raw.wdt === 'object' && !Array.isArray(raw.wdt) ? raw.wdt : {}),
    },
  }
}

function writeSidecar(projectRoot, nodeId, patch = {}) {
  const current = sidecarFor(projectRoot, nodeId)
  const next = {
    ...current,
    ...patch,
    revision: Number(current.revision || 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  writeStoreJson(sidecarPath(projectRoot, nodeId), next)
  return next
}

function stateFor(task, sidecar) {
  const paths = taskPaths(task.taskId)
  const taskAcceptance = Array.isArray(task.acceptance) ? task.acceptance : []
  const acceptance = sidecar.acceptance.length ? sidecar.acceptance : taskAcceptance
  const verified = acceptance.filter(item => ['done', 'pass', 'passed', 'verified', 'complete', 'completed'].includes(String(item.status || '').toLowerCase())).length
  const planItems = sidecar.planItems
  return {
    type: 'goal',
    taskId: task.taskId,
    title: sidecar.title || task.nextAction || task.taskId,
    objective: sidecar.objective || task.taskId,
    status: sidecar.status || task.status || 'active',
    phase: sidecar.phase || task.phase || null,
    gate: sidecar.gate || task.gate || null,
    mode: task.mode || null,
    acceptance,
    planItems,
    progress: {
      verified,
      total: acceptance.length,
    },
    nextAction: sidecar.nextAction || task.nextAction || '',
    confirmation: sidecar.confirmation,
    wdt: sidecar.wdt,
    stateRef: { path: paths.state, revision: 0 },
    contentRef: {
      kind: 'task-capsule',
      taskId: task.taskId,
      statePath: paths.state,
      planPath: paths.plan,
      progressPath: paths.progress,
    },
    statePath: `Harness/a2a/goal-nodes/goal-${task.taskId}/state.json`,
    revision: Number(sidecar.revision || 0),
  }
}

function nodeFor(task, state, position = null) {
  const nodeId = `goal-${task.taskId}`
  return {
    id: nodeId,
    nodeId,
    kind: 'goal-node',
    type: 'goal',
    title: `Goal: ${task.taskId}`,
    label: `Goal: ${task.taskId}`,
    level: 1,
    position: position || { x: 860, y: 160 },
    revision: state.revision,
    statePath: state.statePath,
    stateRef: { path: state.statePath, revision: state.revision },
    status: state.status,
    lifecycle: 'goal-anchor',
    runtimeState: state.status,
    config: {
      taskId: task.taskId,
      backendSourceOfTruth: true,
    },
  }
}

export function listGoalNodes(projectRoot) {
  const task = activeTask(projectRoot)
  if (!task) return []
  const nodeId = assertGoalNodeId(`goal-${task.taskId}`)
  const state = stateFor(task, sidecarFor(projectRoot, nodeId))
  return [nodeFor(task, state)]
}

export function getGoalNode(projectRoot, nodeId) {
  const key = assertGoalNodeId(decodeURIComponent(String(nodeId || '')))
  const task = activeTask(projectRoot)
  if (!task || `goal-${task.taskId}` !== key) {
    throw new GoalNodeError(`Goal node not found: ${key}`, {
      statusCode: 404,
      code: 'NOT_FOUND',
    })
  }
  const state = stateFor(task, sidecarFor(projectRoot, key))
  return { ok: true, node: nodeFor(task, state), state, revision: state.revision }
}

export function updateGoalNodeSidecar(projectRoot, nodeId, patch = {}) {
  const current = getGoalNode(projectRoot, nodeId)
  const sidecar = writeSidecar(projectRoot, current.node.nodeId, patch)
  return getGoalNode(projectRoot, current.node.nodeId, sidecar)
}

export function goalStateRefs(projectRoot) {
  const refs = {}
  for (const node of listGoalNodes(projectRoot)) {
    const current = getGoalNode(projectRoot, node.nodeId)
    refs[node.nodeId] = {
      type: 'goal',
      title: current.state.title || node.title,
      taskId: current.state.taskId,
      objective: current.state.objective,
      status: current.state.status,
      phase: current.state.phase,
      gate: current.state.gate,
      statePath: current.state.statePath,
      revision: current.state.revision,
      acceptance: current.state.acceptance,
      planItems: current.state.planItems,
      progress: current.state.progress,
      nextAction: current.state.nextAction,
      confirmation: current.state.confirmation,
      wdt: current.state.wdt,
      stateRef: current.state.stateRef,
      contentRef: current.state.contentRef,
    }
  }
  return refs
}

export function goalNodeStates(projectRoot) {
  const states = {}
  for (const node of listGoalNodes(projectRoot)) {
    const current = getGoalNode(projectRoot, node.nodeId)
    states[node.nodeId] = {
      nodeId: node.nodeId,
      title: node.title,
      ...current.state,
    }
  }
  return states
}
