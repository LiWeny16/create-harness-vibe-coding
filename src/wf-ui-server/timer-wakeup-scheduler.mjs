import { fire as fireTimer, dispatchWakeup as dispatchTimerWakeup } from './workflow-node-types/timer-node.mjs'
import { getEventNode, listEventNodes, updateEventNode } from './workflow-event-node-store.mjs'

// Bounded timer wakeup scheduler (D1, M5, AC-011/AC-012, T10/T11 backend part).
//
// The loop is bounded, never resident:
//  - it runs only while at least one enabled timer exists (syncTimerScheduler
//    starts/stops it from event-node mutations, and the tick self-stops when
//    getTimers() returns no enabled timers);
//  - the interval handle is unref'd, so it never keeps a closed server
//    process alive;
//  - stopTimerScheduler() clears the handle; server.mjs stopServer() invokes
//    it on server close, and tests call it directly on teardown.
//
// Each tick: for every enabled timer whose heartbeat.base.nextDueAt is due,
// run the timer.fire flow, then dispatch a wakeup envelope into the message
// queues of the connected/magnetic-group agent nodes (never PTY stdin).

const DEFAULT_INTERVAL_MS = 1000

let activeHandle = null

// Set while the scheduler itself performs a store update (nextDueAt advance),
// so event-node-store mutations made by the scheduler do not re-sync/re-arm
// the loop and clobber the caller-chosen intervalMs config.
let suppressingSync = false

function parseTime(value) {
  const time = Date.parse(String(value || ''))
  return Number.isFinite(time) ? time : 0
}

function clampInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.floor(number)))
}

// Builds the due-check data + bound fire flow for every enabled timer in the
// project. Read-only apart from the `fire` closure, which is invoked by the
// scheduler tick and advances the runtime clock after firing.
//
// Bounded loop semantics (F14/D11): a timer whose `loop.maxIterations` is set
// stops advancing once `loop.runCount` reaches it — the entry is skipped and
// the loop is marked complete (loop.enabled=false) through the event-node
// store API, never by mutating state files directly. `loop.stopOnFailure`
// marks the loop complete when a fire throws. Timers without a bounded loop
// keep the existing interval behavior.
function enabledTimerEntries(projectRoot) {
  const entries = []
  for (const node of listEventNodes(projectRoot)) {
    if (String(node.type || '') !== 'timer') continue
    const timerNodeId = node.nodeId
    const current = getEventNode(projectRoot, timerNodeId)
    const state = current.state
    if (!state.enabled) continue
    const loop = state.loop || {}
    const maxIterations = clampInteger(loop.maxIterations, { min: 0, fallback: 0 })
    const runCount = clampInteger(loop.runCount, { min: 0, fallback: 0 })
    if (maxIterations > 0 && runCount >= maxIterations) continue // loop exhausted — stop advancing (F14)
    const base = state.heartbeat?.base || {}
    const nextDueAt = String(base.nextDueAt || '')
    const dueAt = parseTime(nextDueAt)
    if (!dueAt) continue // base lane not armed (disabled or not running)
    const intervalSeconds = clampInteger(
      base.intervalSeconds ?? state.schedule?.intervalSeconds,
      { min: 1, fallback: 60 },
    )
    const mode = String(state.schedule?.mode || 'manual').toLowerCase()
    const stopOnFailure = loop.stopOnFailure !== false
    entries.push({
      timerNodeId,
      projectRoot,
      enabled: true,
      nextDueAt,
      dueAt,
      intervalSeconds,
      mode,
      fire: (firedAt) => {
        try {
          const fired = fireTimer(timerNodeId, projectRoot, {})
          const heartbeat = current.state.heartbeat || {}
          const nextRunCount = maxIterations > 0 ? runCount + 1 : runCount
          const loopComplete = maxIterations > 0 && nextRunCount >= maxIterations
          const advancePatch = {
            revision: fired.revision,
            heartbeat: {
              ...heartbeat,
              base: { ...(heartbeat.base || {}), nextDueAt: new Date(parseTime(firedAt) + intervalSeconds * 1000).toISOString() },
            },
          }
          if (maxIterations > 0) {
            advancePatch.loop = {
              ...loop,
              runCount: nextRunCount,
              // Loop-complete marker persisted through the store API (F14).
              enabled: loopComplete ? false : loop.enabled,
            }
          }
          if (mode === 'once') advancePatch.enabled = false
          suppressingSync = true
          try {
            updateEventNode(projectRoot, timerNodeId, advancePatch)
          } finally {
            suppressingSync = false
          }
          return fired
        } catch (error) {
          if (stopOnFailure && maxIterations > 0) {
            try {
              const failed = getEventNode(projectRoot, timerNodeId)
              suppressingSync = true
              try {
                updateEventNode(projectRoot, timerNodeId, {
                  revision: failed.node.revision,
                  loop: { ...(failed.state.loop || {}), enabled: false },
                })
              } finally {
                suppressingSync = false
              }
            } catch {
              // A failed loop-complete marker must never crash the server loop.
            }
          }
          throw error
        }
      },
    })
  }
  return entries
}

function runTick({ getTimers, dispatchWakeup }) {
  let timers
  try {
    timers = Array.isArray(getTimers()) ? getTimers() : []
  } catch {
    return
  }
  if (timers.length === 0) {
    stopTimerScheduler()
    return
  }
  const now = Date.now()
  for (const timer of timers) {
    if (!timer.enabled || !timer.dueAt || timer.dueAt > now) continue
    const firedAt = new Date().toISOString()
    const scheduledAt = timer.nextDueAt
    let fired = null
    try {
      if (typeof timer.fire === 'function') fired = timer.fire(firedAt)
    } catch {
      // A failed fire must never crash the server loop; the next tick retries.
      continue
    }
    if (!fired) continue
    try {
      dispatchWakeup({
        projectRoot: timer.projectRoot,
        timerNodeId: timer.timerNodeId,
        scheduledAt,
        firedAt,
        intervalSeconds: timer.intervalSeconds,
      })
    } catch {
      // Wakeup delivery must never crash the server loop.
    }
  }
}

export function startTimerScheduler({ getTimers, dispatchWakeup, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (typeof getTimers !== 'function' || typeof dispatchWakeup !== 'function') return null
  stopTimerScheduler()
  const interval = setInterval(() => runTick({ getTimers, dispatchWakeup }), Math.max(Number(intervalMs) || DEFAULT_INTERVAL_MS, 5))
  interval.unref?.()
  activeHandle = { interval, getTimers, dispatchWakeup, intervalMs: Math.max(Number(intervalMs) || DEFAULT_INTERVAL_MS, 5) }
  return activeHandle
}

export function stopTimerScheduler() {
  if (!activeHandle) return { stopped: true, wasActive: false }
  clearInterval(activeHandle.interval)
  activeHandle = null
  return { stopped: true, wasActive: true }
}

export function isTimerSchedulerActive() {
  return activeHandle !== null
}

export function isTimerSchedulerSyncSuppressed() {
  return suppressingSync
}

// Hook wired by workflow-event-node-store.mjs on event-node create/update/
// delete/restore. Starts the bounded loop when any enabled timer exists,
// stops it when none remain, and keeps the running configuration intact when
// nothing changed (so scheduler-internal store updates do not re-arm the loop).
export function syncTimerScheduler(projectRoot, opts = {}) {
  if (suppressingSync) return { active: isTimerSchedulerActive() }
  const intervalMs = Number(opts.intervalMs ?? DEFAULT_INTERVAL_MS)
  let timers = []
  try {
    timers = enabledTimerEntries(projectRoot)
  } catch {
    return { active: isTimerSchedulerActive() }
  }
  if (timers.length === 0) {
    stopTimerScheduler()
    return { active: false, timers: 0 }
  }
  if (
    activeHandle
    && activeHandle.projectRoot === projectRoot
    && Number(activeHandle.intervalMs) === intervalMs
  ) {
    return { active: true, timers: timers.length }
  }
  const handle = startTimerScheduler({
    getTimers: () => enabledTimerEntries(projectRoot),
    dispatchWakeup: (envelope) => dispatchTimerWakeup(envelope.timerNodeId, envelope.projectRoot, envelope),
    intervalMs,
  })
  if (handle) handle.projectRoot = projectRoot
  return { active: isTimerSchedulerActive(), timers: timers.length }
}
