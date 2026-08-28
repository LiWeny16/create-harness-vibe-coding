import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { autoConnectAgent, findAgents, loadWorkflowGraphMap, writeWorkflowGraphMap } from '../a2a-store.mjs';
import { executeNodeAction } from '../workflow-node-runtime.mjs';
import { createEventNode, getEventNode } from '../workflow-event-node-store.mjs';
import { listBridgeMessages } from '../bridge-store.mjs';
import { persistSession } from '../terminal-store.mjs';
import { createRoleProfile } from '../workflow-node-types/role-profile-store.mjs';
import { registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';
import { isTimerSchedulerActive, stopTimerScheduler, syncTimerScheduler } from '../timer-wakeup-scheduler.mjs';

// F19/D17 (T3 full-flow): one in-process integration test driving the whole
// agent-team cooperation chain WITHOUT real PTY sessions — test-registry agent
// sessions, role profiles, find -> auto-connect -> structured request ->
// aggregated replies -> timer wakeup with goalNodeId -> goal check/complete.
// Same infrastructure as the other wf-ui-server __tests__ (no HTTP server; the
// backend functions are invoked in-process, PTY input is captured via
// registerPtyProcess).

function seedRoot() {
  const root = makeHarnessTempRoot('wf-team-flow-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

function seedActiveTask(root, taskId = 'task-team-flow') {
  fs.mkdirSync(path.join(root, 'Harness', 'tasks', taskId), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'PROGRESS.md'), `# PROGRESS.md\n\n## Active Task\n\n- ${taskId}\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    title: 'Team flow goal',
    nextAction: 'Route agents',
    acceptance: [],
    planItems: [],
    phase: 'implement',
  }));
  return `goal-${taskId}`;
}

function seedAgent(root, { nodeId, sessionId, roleTitle, displayName, agentKind = 'subagent', role, runtime = 'claude', capabilities = [] }) {
  persistSession(root, {
    sessionId,
    graphNodeId: nodeId,
    runtime,
    agentKind,
    role: role || roleTitle || 'Subagent',
    roleTitle,
    displayName: displayName || roleTitle || '',
    status: 'running',
    attachMode: true,
    taskId: null,
    capabilities,
  });
  writeWorkflowGraphMap(root, {
    ...loadWorkflowGraphMap(root),
    version: loadWorkflowGraphMap(root).version + 1,
    nodes: [
      ...(loadWorkflowGraphMap(root).nodes || []).filter(node => (node.nodeId || node.id) !== nodeId),
      { nodeId, sessionId, kind: 'terminal-session', runtime, agentKind, role: role || roleTitle || 'Agent', label: displayName || roleTitle || 'Agent', status: 'running' },
    ],
  });
  if (roleTitle) {
    createRoleProfile({ nodeId, roleTitle, displayName: displayName || roleTitle, agentKind, runtime, capabilities }, root);
  }
  return nodeId;
}

function dockLink(a, b) {
  const pair = [a, b].sort();
  return {
    id: `dock:${pair[0]}::${pair[1]}`,
    nodeIds: pair,
    anchorId: pair[0],
    draggedId: pair[1],
    side: 'top',
    edges: [],
    connections: [
      { source: a, target: b, relation: 'wf-bridge', direction: 'source-to-target', sourceHandle: 'dock', targetHandle: 'dock' },
    ],
  };
}

function wakeupEntries(root, timerNodeId, sessionId) {
  return listBridgeMessages(root, { fromSessionId: `wakeup-${timerNodeId}`, toSessionId: sessionId }).entries;
}

// F17/D14 writes PTY input char-by-char (12ms gaps, single \r at the end), so
// a registered test PTY receives many small writes instead of one string.
// Aggregate a session's write log and wait until it settles (no new write for
// `settleMs` after at least one full typing duration has elapsed).
async function collectTypedInput(writes, { settleMs = 120, timeoutMs = 6000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let lastChange = Date.now();
  while (Date.now() < deadline) {
    if (writes.length !== lastCount) {
      lastCount = writes.length;
      lastChange = Date.now();
    } else if (writes.length > 0 && Date.now() - lastChange >= settleMs) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  // The trailing \r lands ~800ms after the last body char (enter delay);
  // tolerate callers asserting before it arrives by allowing a suffix-less
  // match, and keep polling out of the returned string.
  return writes.join('');
}

// Wait until the session's aggregated input ends with the submit \r (the
// enter rides a delayed timer after the char-by-char body).
async function awaitSubmitEnter(writes, { timeoutMs = 4000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (writes.length > 0 && writes[writes.length - 1] === '\r') return writes.join('');
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return writes.join('');
}

function waitForWakeups(root, timerNodeId, sessionId, count, { timeout = 6000, step = 50 } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const poll = () => {
      const entries = wakeupEntries(root, timerNodeId, sessionId);
      if (entries.length >= count) return resolve(entries);
      if (Date.now() >= deadline) return reject(new Error(`waitForWakeups timed out; got ${entries.length}/${count}`));
      setTimeout(poll, step);
    };
    poll();
  });
}

after(() => {
  stopTimerScheduler();
});

describe('T3/AC-024 full cooperation flow (F19/D17)', () => {
  it('create -> find -> auto-connect -> structured request -> aggregated replies -> wakeup with goalNodeId -> goal complete', async () => {
    const root = seedRoot();
    const writes = { ceo: [], fe: [], qa: [] };
    try {
      // (1) Main + sub agent sessions with role profiles (test registry).
      seedAgent(root, { nodeId: 'agent-ceo', sessionId: 'session-ceo', roleTitle: 'ceo', displayName: 'CEO', agentKind: 'main', capabilities: ['terminal-control'] });
      seedAgent(root, { nodeId: 'agent-fe', sessionId: 'session-fe', roleTitle: 'implementer', displayName: 'Frontend Expert', capabilities: ['ui-control-plane'] });
      seedAgent(root, { nodeId: 'agent-qa', sessionId: 'session-qa', roleTitle: 'reviewer', displayName: 'QA Reviewer', capabilities: ['playwright'] });
      registerPtyProcess('session-ceo', { write: data => writes.ceo.push(String(data)) });
      registerPtyProcess('session-fe', { write: data => writes.fe.push(String(data)) });
      registerPtyProcess('session-qa', { write: data => writes.qa.push(String(data)) });

      // (2) findAgents by role -> exactly one match.
      const found = await findAgents(root, { role: 'implementer' });
      assert.equal(found.count, 1, 'role=implementer must match exactly one agent');
      assert.equal(found.matches[0].nodeId, 'agent-fe');
      assert.equal(found.matches[0].connected, false, 'fresh agent starts unconnected');

      // (3) auto-connect -> delegation edge exists (bidirectional).
      const auto = autoConnectAgent(root, 'agent-ceo', 'agent-fe');
      assert.equal(auto.ok, true);
      const graphAfterConnect = loadWorkflowGraphMap(root);
      const edgeExists = (graphAfterConnect.edges || []).some(edge =>
        (edge.from === 'agent-ceo' && edge.to === 'agent-fe') || (edge.from === 'agent-fe' && edge.to === 'agent-ceo'));
      assert.equal(edgeExists, true, 'auto-connect must create the delegation edge');
      autoConnectAgent(root, 'agent-ceo', 'agent-qa');

      // (4) structured request -> target message queue has the envelope AND the
      // PTY input is composed with the [harness-request ...] prefix.
      const sent = await executeNodeAction(root, 'agent-ceo', 'agent.sendMessage', {
        to: 'agent-fe',
        text: 'REVIEW_UI_FLOW',
        requestId: 'req-t3-0001',
        toRole: 'implementer',
        contextRefs: [{ nodeId: 'markdown-ctx-1', relation: 'shared-context' }],
      });
      assert.equal(sent.ok, true);
      assert.equal(sent.result.requestId, 'req-t3-0001');
      const feInput = await awaitSubmitEnter(writes.fe, { timeoutMs: 4000 })
        || await collectTypedInput(writes.fe);
      assert.match(feInput, /^\[harness-request req-t3-0001 to-role=implementer contextRefs=markdown-ctx-1\] REVIEW_UI_FLOW\r$/);
      const queued = listBridgeMessages(root, { fromSessionId: 'session-ceo', toSessionId: 'session-fe' }).entries;
      assert.equal(queued.length, 1);
      assert.equal(queued[0].requestId, 'req-t3-0001');
      assert.equal(queued[0].deliveryMode, 'direct');
      assert.equal(queued[0].data.replace(/\r$/, ''), 'REVIEW_UI_FLOW');

      // (5) replies echo the requestId; readMessages aggregates by requestId.
      const replyFe = await executeNodeAction(root, 'agent-fe', 'agent.sendMessage', {
        to: 'agent-ceo',
        text: 'EVIDENCE_FE',
        requestId: 'req-t3-0001',
      });
      assert.equal(replyFe.ok, true);
      const replyQa = await executeNodeAction(root, 'agent-qa', 'agent.sendMessage', {
        to: 'agent-ceo',
        text: 'EVIDENCE_QA',
        requestId: 'req-t3-0001',
      });
      assert.equal(replyQa.ok, true);
      const aggregated = await executeNodeAction(root, 'agent-ceo', 'agent.readMessages', { requestId: 'req-t3-0001' });
      assert.equal(aggregated.ok, true);
      assert.equal(aggregated.result.entries.length, 3, 'request + 2 replies must aggregate under the requestId');
      const texts = aggregated.result.entries.map(entry => entry.data.replace(/\r$/, '')).sort();
      assert.deepEqual(texts, ['EVIDENCE_FE', 'EVIDENCE_QA', 'REVIEW_UI_FLOW']);

      // (6) timer with maxIterations=1 + group goal -> scheduler tick dispatches
      // a wakeup whose envelope carries the goalNodeId.
      const goalNodeId = seedActiveTask(root, 'task-team-flow');
      const timer = await createEventNode(root, {
        type: 'timer',
        title: 'T3 Wakeup Timer',
        enabled: true,
        schedule: { mode: 'interval', intervalSeconds: 1 },
        heartbeat: { base: { enabled: true, intervalSeconds: 1, nextDueAt: new Date(Date.now() - 2000).toISOString() } },
        loop: { enabled: true, maxIterations: 1 },
      });
      const timerNodeId = timer.node.nodeId;
      writeWorkflowGraphMap(root, {
        ...loadWorkflowGraphMap(root),
        version: loadWorkflowGraphMap(root).version + 1,
        edges: [
          ...(loadWorkflowGraphMap(root).edges || []),
          { id: `agent-ceo->${goalNodeId}`, from: 'agent-ceo', to: goalNodeId, relation: 'goal', direction: 'bidirectional' },
        ],
        capsuleDockLinks: [
          dockLink(goalNodeId, timerNodeId),
          dockLink(timerNodeId, 'agent-ceo'),
        ],
      });

      syncTimerScheduler(root, { intervalMs: 20 });
      assert.equal(isTimerSchedulerActive(), true);
      const wakeups = await waitForWakeups(root, timerNodeId, 'session-ceo', 1);
      const envelope = JSON.parse(wakeups[0].data);
      assert.equal(envelope.type, 'wakeup');
      assert.equal(envelope.timerNodeId, timerNodeId);
      assert.equal(envelope.goalNodeId, goalNodeId, 'wakeup must reference the group Goal node');
      const timerAfter = getEventNode(root, timerNodeId);
      assert.equal(timerAfter.state.loop.enabled, false, 'maxIterations=1 must complete the loop after one fire');
      stopTimerScheduler();

      // (7) goal.add -> goal.check all -> goal.complete -> proposed-complete.
      const added = await executeNodeAction(root, goalNodeId, 'goal.add', {
        planItems: [{ text: 'Review UI flow' }, { text: 'Fix findings' }],
      });
      assert.equal(added.ok, true);
      const planItemIds = added.result.state.planItems.map(item => item.id);
      assert.equal(planItemIds.length, 2);
      assert.ok(planItemIds.every(id => /^P-\d{3}$/.test(id)));

      const checked = await executeNodeAction(root, goalNodeId, 'goal.check', {
        planItemIds,
        actorNodeId: 'agent-ceo',
      });
      assert.equal(checked.ok, true);
      assert.ok(checked.result.state.planItems.every(item => item.status === 'done'));

      const completed = await executeNodeAction(root, goalNodeId, 'goal.complete', {
        actorNodeId: 'agent-ceo',
        evidenceRefs: ['wf-team-flow'],
      });
      assert.equal(completed.ok, true);
      assert.equal(completed.result.state.status, 'proposed-complete');
      assert.equal(completed.result.state.confirmation.state, 'proposed');
    } finally {
      stopTimerScheduler();
      unregisterPtyProcess('session-ceo');
      unregisterPtyProcess('session-fe');
      unregisterPtyProcess('session-qa');
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
