import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// ── Helpers (mirror workflow-magnetic-topology.test.mjs) ──
function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex')
  const dir = path.join(process.cwd(), '.tmp-timer-wakeup-' + id)
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'component-nodes'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }))
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({
    schemaVersion: 1,
    version: 1,
    nodes: [],
    edges: [],
    capsuleDockLinks: [],
    positions: {},
    undoStack: [],
    redoStack: [],
    deletedNodes: [],
  }))
  return dir
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function seedAgentGraphNode(root, nodeId, overrides = {}) {
  const graph = runtime.loadWorkflowGraphMap(root)
  const sessionId = overrides.sessionId || `${nodeId}-pty`
  runtime.writeWorkflowGraphMap(root, {
    ...graph,
    version: graph.version + 1,
    nodes: [
      ...(graph.nodes || []),
      {
        nodeId,
        sessionId,
        kind: 'terminal-session',
        agentKind: overrides.agentKind || 'subagent',
        runtime: overrides.runtime || 'claude',
        status: overrides.status || 'stopped',
        label: overrides.label || 'Wakeup Agent',
        cwd: root,
        taskId: null,
        role: 'implementer',
      },
    ],
    positions: {
      ...(graph.positions || {}),
      [nodeId]: { x: 100, y: 120 },
    },
  })
  return { nodeId, sessionId }
}

function dockLink(a, b) {
  const pair = [a, b].sort()
  return {
    id: `dock:${pair[0]}::${pair[1]}`,
    nodeIds: pair,
    anchorId: pair[0],
    draggedId: pair[1],
    side: 'top',
    edges: [],
    connections: [
      {
        source: a,
        target: b,
        relation: 'wf-bridge',
        direction: 'source-to-target',
        sourceHandle: 'dock',
        targetHandle: 'dock',
      },
    ],
  }
}

function seedGoalNode(root, taskId) {
  fs.mkdirSync(path.join(root, 'Harness', 'tasks', taskId), { recursive: true })
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    phase: 'execution',
    updatedAt: new Date().toISOString(),
    acceptance: [],
    links: { dependsOn: [], blocks: [], related: [] },
  }))
  fs.writeFileSync(path.join(root, 'Harness', 'PROGRESS.md'), `# Progress\n\n## Active Task\n- ${taskId}\n`)
  return `goal-${taskId}`
}

function dueTimerPayload() {
  return {
    type: 'timer',
    title: 'Wakeup Loop',
    enabled: true,
    schedule: { mode: 'interval', intervalSeconds: 60 },
    heartbeat: {
      base: { enabled: true, intervalSeconds: 60, nextDueAt: new Date(Date.now() - 1000).toISOString() },
    },
  }
}

function wakeupFrom(timerNodeId) {
  return `wakeup-${timerNodeId}`
}

async function waitFor(fn, { timeout = 4000, step = 25 } = {}) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = fn()
    if (last) return last
    await new Promise(resolve => setTimeout(resolve, step))
  }
  throw new Error(`waitFor timed out; last=${JSON.stringify(last)}`)
}

let store
let runtime
let bridge
let ontology
let scheduler

before(async () => {
  store = await import('../workflow-event-node-store.mjs')
  runtime = await import('../workflow-node-runtime.mjs')
  bridge = await import('../bridge-store.mjs')
  ontology = await import('../workflow-ontology.mjs')
  scheduler = await import('../timer-wakeup-scheduler.mjs')
})

after(() => {
  scheduler?.stopTimerScheduler()
})

describe('AC-011 / T10 — bounded timer wakeup scheduler dispatches to magnetic-group agents', () => {
  it('one tick dispatches wakeup messages to BOTH connected agents and none to unconnected agents', async () => {
    const root = tempProjectRoot()
    try {
      const timer = await store.createEventNode(root, dueTimerPayload())
      const timerNodeId = timer.node.nodeId
      const agentA = seedAgentGraphNode(root, 'session-wake-a')
      const agentB = seedAgentGraphNode(root, 'session-wake-b')
      const agentC = seedAgentGraphNode(root, 'session-wake-c') // unconnected: no dock link
      const graph = runtime.loadWorkflowGraphMap(root)
      runtime.writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [
          dockLink(agentA.nodeId, timerNodeId),
          dockLink(agentB.nodeId, timerNodeId),
        ],
      })

      await scheduler.syncTimerScheduler(root, { intervalMs: 20 })

      const messagesFor = async (sessionId) => waitFor(() => {
        const result = bridge.listBridgeMessages(root, {
          fromSessionId: wakeupFrom(timerNodeId),
          toSessionId: sessionId,
        })
        return result.entries.length ? result.entries : null
      })

      const entriesA = await messagesFor(agentA.sessionId)
      const entriesB = await messagesFor(agentB.sessionId)

      assert.equal(entriesA.length, 1)
      assert.equal(entriesB.length, 1)

      for (const entry of [entriesA[0], entriesB[0]]) {
        assert.equal(entry.deliveryMode, 'wakeup', 'bridge entry must be recorded with deliveryMode wakeup')
        assert.equal(entry.source, 'timer.wakeup', 'bridge entry must be recorded with source timer.wakeup')
        assert.equal(entry.fromNodeId, timerNodeId)
        assert.ok(entry.toNodeId === agentA.nodeId || entry.toNodeId === agentB.nodeId)
        const envelope = JSON.parse(entry.data)
        assert.equal(envelope.type, 'wakeup')
        assert.equal(envelope.timerNodeId, timerNodeId)
        assert.equal(envelope.goalNodeId, null, 'no Goal node in group → goalNodeId null')
        assert.ok(Number.isFinite(Date.parse(envelope.scheduledAt)), 'scheduledAt must be an ISO timestamp')
        assert.ok(Number.isFinite(Date.parse(envelope.firedAt)), 'firedAt must be an ISO timestamp')
        assert.equal(envelope.intervalSeconds, 60)
        assert.match(envelope.messageId, /^wake-/, 'messageId must use the wake- prefix')
      }

      // Unconnected agent gets no wakeup
      const cResult = bridge.listBridgeMessages(root, {
        fromSessionId: wakeupFrom(timerNodeId),
        toSessionId: agentC.sessionId,
      })
      assert.equal(cResult.entries.length, 0, 'unconnected agents must receive no wakeup')

      // timer.fire ran exactly once and the next due time advanced
      const after = store.getEventNode(root, timerNodeId)
      assert.equal(after.state.eventCount, 1, 'scheduler must invoke timer.fire once')
      assert.ok(after.state.lastFiredAt)
      assert.ok(Date.parse(after.state.heartbeat.base.nextDueAt) > Date.now(), 'nextDueAt must advance after firing')
    } finally {
      scheduler.stopTimerScheduler()
      cleanup(root)
    }
  })

  it('stops cleanly: no pending interval handle and no dispatches after stop', async () => {
    const root = tempProjectRoot()
    try {
      const timer = await store.createEventNode(root, dueTimerPayload())
      const timerNodeId = timer.node.nodeId
      const agent = seedAgentGraphNode(root, 'session-wake-stop')
      const graph = runtime.loadWorkflowGraphMap(root)
      runtime.writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [dockLink(agent.nodeId, timerNodeId)],
      })

      await scheduler.syncTimerScheduler(root, { intervalMs: 20 })
      assert.equal(scheduler.isTimerSchedulerActive(), true, 'scheduler must be active while an enabled timer exists')

      const entries = await waitFor(() => {
        const result = bridge.listBridgeMessages(root, {
          fromSessionId: wakeupFrom(timerNodeId),
          toSessionId: agent.sessionId,
        })
        return result.entries.length ? result.entries : null
      })
      assert.equal(entries.length, 1)

      const stop = scheduler.stopTimerScheduler()
      assert.equal(stop.wasActive, true, 'stopTimerScheduler must report an active handle was stopped')
      assert.equal(scheduler.isTimerSchedulerActive(), false, 'no interval handle may remain after stop')

      // No further dispatches once stopped
      await new Promise(resolve => setTimeout(resolve, 150))
      const after = bridge.listBridgeMessages(root, {
        fromSessionId: wakeupFrom(timerNodeId),
        toSessionId: agent.sessionId,
      })
      assert.equal(after.entries.length, 1, 'no wakeup may be dispatched after stopTimerScheduler')
    } finally {
      scheduler.stopTimerScheduler()
      cleanup(root)
    }
  })
})

describe('AC-012 / T11 — wakeup envelope carries the magnetic group goal node id', () => {
  it('sets goalNodeId when the group contains a single goal node', async () => {
    const root = tempProjectRoot()
    try {
      const goalNodeId = seedGoalNode(root, 'wakeup-goal-t')
      const timer = await store.createEventNode(root, dueTimerPayload())
      const timerNodeId = timer.node.nodeId
      const agent = seedAgentGraphNode(root, 'session-wake-goal')
      const graph = runtime.loadWorkflowGraphMap(root)
      runtime.writeWorkflowGraphMap(root, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [
          dockLink(agent.nodeId, timerNodeId),
          dockLink(timerNodeId, goalNodeId),
        ],
      })

      await scheduler.syncTimerScheduler(root, { intervalMs: 20 })

      const entries = await waitFor(() => {
        const result = bridge.listBridgeMessages(root, {
          fromSessionId: wakeupFrom(timerNodeId),
          toSessionId: agent.sessionId,
        })
        return result.entries.length ? result.entries : null
      })

      const envelope = JSON.parse(entries[0].data)
      assert.equal(envelope.type, 'wakeup')
      assert.equal(envelope.timerNodeId, timerNodeId)
      assert.equal(envelope.goalNodeId, goalNodeId, 'wakeup must carry the group goal node id')
      assert.equal(envelope.intervalSeconds, 60)
    } finally {
      scheduler.stopTimerScheduler()
      cleanup(root)
    }
  })

  it('keeps timer.dispatchWakeup backend-internal in the agent ontology', () => {
    const context = ontology.buildAgentOntologyContext({
      nodeId: 'agent-wake-a',
      connectedEventRefs: [
        {
          nodeId: 'event-wake-t1',
          kind: 'event-node',
          type: 'timer',
          connections: [
            { edgeId: 'e1', relation: 'event', direction: 'source-to-target', endpointRole: 'source' },
          ],
          allowedActions: [],
        },
      ],
    })
    const timerRef = context.affordances.find(item => item.type === 'timer')
    assert.ok(timerRef, 'timer affordance must be present')
    assert.ok(timerRef.deniedActions.includes('timer.dispatchWakeup'), 'agents must not self-wake: dispatchWakeup denied')
    assert.ok(timerRef.deniedActions.includes('timer.fire'))
    assert.ok(timerRef.deniedActions.includes('timer.tick'))
    assert.ok(!timerRef.allowedActions.includes('timer.dispatchWakeup'))
  })
})
