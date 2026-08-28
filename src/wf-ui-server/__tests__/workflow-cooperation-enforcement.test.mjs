import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { loadWorkflowGraphMap, writeWorkflowGraphMap } from '../a2a-store.mjs';
import { createNode, executeNodeAction } from '../workflow-node-runtime.mjs';
import { createEventNode, getEventNode } from '../workflow-event-node-store.mjs';
import { listBridgeMessages } from '../bridge-store.mjs';
import { persistSession } from '../terminal-store.mjs';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import { createRoleProfile, nextAvailableRole, readRoleProfile } from '../workflow-node-types/role-profile-store.mjs';
import { dispatchWakeup } from '../workflow-node-types/timer-node.mjs';
import { isTimerSchedulerActive, stopTimerScheduler, syncTimerScheduler } from '../timer-wakeup-scheduler.mjs';

function waitForWakeups(root, timerNodeId, sessionId, count, { timeout = 5000, step = 50 } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const poll = () => {
      const entries = listBridgeMessages(root, { fromSessionId: `wakeup-${timerNodeId}`, toSessionId: sessionId }).entries;
      if (entries.length >= count) return resolve(entries);
      if (Date.now() >= deadline) return reject(new Error(`waitForWakeups timed out after ${timeout}ms; got ${entries.length}/${count}`));
      setTimeout(poll, step);
    };
    poll();
  });
}

// ── Helpers (mirror workflow-agent-routing.test.mjs) ──
function seedRoot(prefix = 'wf-coop-enforce-') {
  const root = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

function seedActiveTask(root, taskId = 'task-coop-goal') {
  fs.mkdirSync(path.join(root, 'Harness', 'tasks', taskId), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'PROGRESS.md'), `# PROGRESS.md\n\n## Active Task\n\n- ${taskId}\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    title: 'Coop goal',
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

function jsonRequest(baseUrl, route, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(url, {
      method,
      headers: payload ? { 'content-type': 'application/json' } : {},
    });
    req.on('response', (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

after(() => {
  stopTimerScheduler();
});

// ── F1/F11a: timer internal actions (fire/tick/dispatchWakeup) ──
describe('F1/F11a — timer internal actions are denied to agents and unknown actors via the HTTP surface', () => {
  it('POST timer.dispatchWakeup / timer.fire by an unknown actor or subagent → 403; main agent allowed', async () => {
    const root = seedRoot();
    const registry = new SessionRegistry();
    const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
    const base = `http://127.0.0.1:${started.port}`;
    try {
      const timer = await createNode(root, { type: 'timer', title: 'Gate Timer' });
      const timerNodeId = timer.node.nodeId;
      const actionUrl = `/api/workflow/nodes/${encodeURIComponent(timerNodeId)}/actions`;

      // Unknown actor (no actor fields at all) → 403 typed error
      const unknown = await jsonRequest(base, `${actionUrl}/timer.dispatchWakeup`, { method: 'POST', body: {} });
      assert.equal(unknown.status, 403, JSON.stringify(unknown.body));
      assert.equal(unknown.body.error.code, 'TIMER_INTERNAL_ACTION_DENIED');

      // Declared subagent actor (actorKind=subagent, no node) → 403
      const subagent = await jsonRequest(base, `${actionUrl}/timer.fire?actorKind=subagent`, { method: 'POST', body: {} });
      assert.equal(subagent.status, 403, JSON.stringify(subagent.body));
      assert.ok(['TIMER_INTERNAL_ACTION_DENIED', 'AGENT_ACTOR_REQUIRED'].includes(subagent.body.error.code), subagent.body.error.code);

      // Declared main/controller agent → allowed
      const main = await jsonRequest(base, `${actionUrl}/timer.fire?actorKind=main`, { method: 'POST', body: {} });
      assert.equal(main.status, 200, JSON.stringify(main.body));
      assert.equal(main.body.ok, true);

      // timer.tick also gated for unknown actors
      const tick = await jsonRequest(base, `${actionUrl}/timer.tick`, { method: 'POST', body: {} });
      assert.equal(tick.status, 403, JSON.stringify(tick.body));
      assert.equal(tick.body.error.code, 'TIMER_INTERNAL_ACTION_DENIED');

      // Legacy non-internal timer actions stay unchanged (no actor needed)
      const read = await jsonRequest(base, `${actionUrl}/timer.read`, { method: 'POST', body: {} });
      assert.equal(read.status, 200, JSON.stringify(read.body));
    } finally {
      await stopServer(started.server);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('direct executeNodeAction with actor options is gated; bare in-process invocation stays legacy', async () => {
    const root = seedRoot();
    try {
      const timer = await createNode(root, { type: 'timer', title: 'Gate Timer 2' });
      const timerNodeId = timer.node.nodeId;
      // Options-carrying invocation (the HTTP route always passes the actor
      // options object) with no resolvable actor → 403.
      await assert.rejects(
        () => executeNodeAction(root, timerNodeId, 'timer.dispatchWakeup', {}, { actorKind: '' }),
        error => error?.statusCode === 403 && error?.code === 'TIMER_INTERNAL_ACTION_DENIED',
      );
      // Explicit internal marker → allowed.
      const internal = await executeNodeAction(root, timerNodeId, 'timer.fire', {}, { internal: true });
      assert.equal(internal.ok, true);
      assert.equal(internal.result.event.kind, 'timer.fire');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('scheduler internal dispatch path still delivers wakeups (direct timer-node call)', async () => {
    const root = seedRoot();
    try {
      const timer = await createEventNode(root, { type: 'timer', title: 'Scheduler Timer', enabled: true, schedule: { mode: 'interval', intervalSeconds: 60 } });
      const timerNodeId = timer.node.nodeId;
      const agent = seedAgent(root, { nodeId: 'agent-wake', sessionId: 'session-wake', roleTitle: 'implementer', displayName: 'Wake Agent' });
      writeWorkflowGraphMap(root, {
        ...loadWorkflowGraphMap(root),
        version: loadWorkflowGraphMap(root).version + 1,
        capsuleDockLinks: [dockLink(agent, timerNodeId)],
      });

      const result = dispatchWakeup(timerNodeId, root, { firedAt: new Date().toISOString() });
      assert.equal(result.ok, true);
      assert.equal(result.agentCount, 1, 'wakeup must reach the docked agent');

      const entries = listBridgeMessages(root, { fromSessionId: `wakeup-${timerNodeId}`, toSessionId: 'session-wake' }).entries;
      assert.equal(entries.length, 1);
      assert.equal(entries[0].deliveryMode, 'wakeup');
      assert.equal(entries[0].source, 'timer.wakeup');
      const envelope = JSON.parse(entries[0].data);
      assert.equal(envelope.type, 'wakeup');
      assert.equal(envelope.timerNodeId, timerNodeId);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── F2/F11b: single-Goal candidate-inclusive count on connect ──
describe('F2/F11b — connecting a second Goal into a group with an existing Goal → goal_already_bound', () => {
  it('first Goal connect is allowed; second Goal connect into the same group → 409 spec shape', async () => {
    const root = seedRoot();
    const registry = new SessionRegistry();
    const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
    const base = `http://127.0.0.1:${started.port}`;
    try {
      const goalNodeId = seedActiveTask(root);
      const timer = await createNode(root, { type: 'timer', title: 'Goal Timer' });
      const timerNodeId = timer.node.nodeId;
      seedAgent(root, { nodeId: 'agent-1', sessionId: 'session-1', roleTitle: 'implementer', displayName: 'Worker' });

      writeWorkflowGraphMap(root, {
        ...loadWorkflowGraphMap(root),
        version: loadWorkflowGraphMap(root).version + 1,
        capsuleDockLinks: [
          dockLink(goalNodeId, timerNodeId),
          dockLink(timerNodeId, 'agent-1'),
        ],
      });

      // First Goal in the group connects fine
      const first = await jsonRequest(base, '/api/workflow/edges', {
        method: 'POST',
        body: { from: 'agent-1', to: goalNodeId, relation: 'goal' },
      });
      assert.equal(first.status, 201, JSON.stringify(first.body));

      // Inject a free-floating second goal node (NOT docked yet) and connect it
      // into the group — the candidate-inclusive count must reject it.
      writeWorkflowGraphMap(root, {
        ...loadWorkflowGraphMap(root),
        version: loadWorkflowGraphMap(root).version + 1,
        nodes: [
          ...(loadWorkflowGraphMap(root).nodes || []),
          { nodeId: 'goal-second', label: 'Second Goal' },
        ],
      });

      const second = await jsonRequest(base, '/api/workflow/edges', {
        method: 'POST',
        body: { from: 'agent-1', to: 'goal-second', relation: 'goal' },
      });
      assert.equal(second.status, 409, JSON.stringify(second.body));
      assert.equal(second.body.error, 'goal_already_bound');
      assert.ok(second.body.message.includes('already has a Goal'), second.body.message);
      assert.equal(second.body.existingGoalNodeId, goalNodeId);
      assert.equal(second.body.timerNodeId, timerNodeId);

      // The rejected edge must not exist
      const graph = loadWorkflowGraphMap(root);
      const created = (graph.edges || []).some(edge => (edge.from === 'agent-1' && edge.to === 'goal-second') || (edge.from === 'goal-second' && edge.to === 'agent-1'));
      assert.equal(created, false, 'the second goal edge must not be created');
    } finally {
      await stopServer(started.server);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── F6/F11c: AC-004 distinct roleTitle on subagent creates without roleTitle ──
describe('F6/F11c — AC-004 subagent creates without roleTitle get distinct auto-assigned roles', () => {
  it('two creates under the same parent → reviewer then implementer', async () => {
    const root = seedRoot();
    const registry = new SessionRegistry();
    const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
    const base = `http://127.0.0.1:${started.port}`;
    try {
      const create = async () => {
        const res = await jsonRequest(base, '/api/sessions', {
          method: 'POST',
          body: {
            runtime: 'codex',
            agentKind: 'subagent',
            deferPtySpawn: true,
            parentAgentId: 'session-ceo',
            capabilities: ['terminal'],
            objective: 'Distinct role test',
          },
        });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        return `session-${res.body.sessionId}`;
      };

      const firstNodeId = await create();
      const secondNodeId = await create();
      assert.notEqual(firstNodeId, secondNodeId, 'two creates must produce two sessions');

      const firstProfile = readRoleProfile(firstNodeId, root);
      const secondProfile = readRoleProfile(secondNodeId, root);
      assert.ok(firstProfile, 'first create must write a role profile');
      assert.ok(secondProfile, 'second create must write a role profile');
      assert.equal(firstProfile.roleTitle, 'reviewer');
      assert.equal(secondProfile.roleTitle, 'implementer');
      assert.notEqual(firstProfile.roleTitle, secondProfile.roleTitle, 'AC-004: distinct roleTitles');
      assert.equal(firstProfile.parentSessionId, 'session-ceo');
    } finally {
      await stopServer(started.server);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('nextAvailableRole cycles with a suffix once every canonical role is used', () => {
    const root = seedRoot();
    try {
      const used = ['reviewer', 'implementer', 'verifier', 'planner', 'manager'];
      for (const role of used) {
        createRoleProfile({ nodeId: `agent-${role}`, roleTitle: role, agentKind: 'subagent', runtime: 'claude', parentSessionId: 'session-parent' }, root);
      }
      const next = nextAvailableRole('session-parent', root);
      assert.equal(next, 'reviewer-2');
      // Unrelated parents are unaffected
      assert.equal(nextAvailableRole('session-other', root), 'reviewer');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── F5/F11d: findAgents connected via capsuleDockLinks; auto-connect dedupes ──
describe('F5/F11d — dock-connected agents report connected; auto-connect creates no duplicate edge', () => {
  it('dock-linked agent is connected=true and autoConnect adds no delegation edge', async () => {
    const root = seedRoot();
    const registry = new SessionRegistry();
    const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
    const base = `http://127.0.0.1:${started.port}`;
    try {
      seedAgent(root, { nodeId: 'agent-ceo', sessionId: 'session-ceo', roleTitle: 'ceo', displayName: 'CEO', agentKind: 'main', capabilities: ['terminal-control'] });
      seedAgent(root, { nodeId: 'agent-fe', sessionId: 'session-fe', roleTitle: 'implementer', displayName: 'Frontend Expert', capabilities: ['ui-control-plane'] });
      // Dock the two agents — magnetic connection WITHOUT any graph edge
      writeWorkflowGraphMap(root, {
        ...loadWorkflowGraphMap(root),
        version: loadWorkflowGraphMap(root).version + 1,
        capsuleDockLinks: [dockLink('agent-ceo', 'agent-fe')],
      });

      const found = await jsonRequest(base, '/api/workflow/agents/find?role=implementer');
      assert.equal(found.status, 200);
      assert.equal(found.body.count, 1);
      assert.equal(found.body.matches[0].connected, true, 'dock-connected agent must report connected=true');

      const auto = await jsonRequest(base, '/api/workflow/agents/find?role=implementer&from=agent-ceo&autoConnect=1');
      assert.equal(auto.body.decision, 'connect');
      assert.equal(auto.body.edge, null, 'no new edge may be created for an already-docked agent');

      const graph = loadWorkflowGraphMap(root);
      assert.equal(graph.edges.length, 0, 'auto-connect must not duplicate a delegation edge for dock-docked agents');
    } finally {
      await stopServer(started.server);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── F15/H3: role profile is created before the init prompt is assembled ──
describe('F15/H3 — role profile injected into the node init prompt (before init.md assembly)', () => {
  it('new agent init payload contains identity fields + roleProfileRef; legacy sessions keep the previous shape', async () => {
    const root = seedRoot();
    const registry = new SessionRegistry();
    const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
    const base = `http://127.0.0.1:${started.port}`;
    try {
      const res = await jsonRequest(base, '/api/sessions', {
        method: 'POST',
        body: {
          runtime: 'codex',
          agentKind: 'subagent',
          deferPtySpawn: true,
          displayName: 'Frontend Expert',
          roleTitle: 'implementer',
          responsibility: 'Implement UI changes inside the assigned write set.',
          capabilities: ['ui-control-plane', 'typescript'],
          objective: 'F15 init injection',
        },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const sessionId = res.body.sessionId;
      const graphNodeId = `session-${sessionId}`;
      const initPath = path.join(root, 'Harness', 'a2a', 'nodes', sessionId, 'init.md');
      assert.ok(fs.existsSync(initPath), 'node home init.md must exist');
      const init = fs.readFileSync(initPath, 'utf8');
      assert.match(init, /- Display name: Frontend Expert/);
      assert.match(init, /- Role title: implementer/);
      assert.match(init, /- Responsibility: Implement UI changes inside the assigned write set\./);
      assert.match(init, /- Capabilities: ui-control-plane, typescript/);
      assert.ok(init.includes(`- Role profile: Harness/a2a/agent-roles/${graphNodeId}.md`), init);

      // Legacy create without profile fields keeps the previous init shape.
      const legacy = await jsonRequest(base, '/api/sessions', {
        method: 'POST',
        body: { runtime: 'codex', agentKind: 'subagent', deferPtySpawn: true, objective: 'legacy' },
      });
      assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
      const legacyInitPath = path.join(root, 'Harness', 'a2a', 'nodes', legacy.body.sessionId, 'init.md');
      const legacyInit = fs.readFileSync(legacyInitPath, 'utf8');
      assert.ok(!legacyInit.includes('- Display name:'), 'legacy init must keep the previous shape');
      assert.ok(!legacyInit.includes('- Role profile:'), 'legacy init must not carry a profile ref');
    } finally {
      await stopServer(started.server);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── F12/H1: main-agent graph-action connect enforces the single-Goal rule ──
describe('F12/H1 — agent.connectNodes enforces the single-Goal rule like the HTTP edge route', () => {
  it('graph-action connect of a second Goal into a bound Timer+Agent group → goal_already_bound', async () => {
    const root = seedRoot();
    try {
      const goalNodeId = seedActiveTask(root);
      const timer = await createNode(root, { type: 'timer', title: 'Goal Timer F12' });
      const timerNodeId = timer.node.nodeId;
      seedAgent(root, { nodeId: 'agent-ceo', sessionId: 'session-ceo', roleTitle: 'ceo', displayName: 'CEO', agentKind: 'main' });
      writeWorkflowGraphMap(root, {
        ...loadWorkflowGraphMap(root),
        version: loadWorkflowGraphMap(root).version + 1,
        capsuleDockLinks: [
          dockLink(goalNodeId, timerNodeId),
          dockLink(timerNodeId, 'agent-ceo'),
        ],
      });

      // First Goal connect through the main-agent graph action is allowed.
      const first = await executeNodeAction(root, 'agent-ceo', 'agent.connectNodes', { to: goalNodeId, relation: 'goal' });
      assert.equal(first.ok, true, JSON.stringify(first));

      // A free-floating second Goal node connected into the same group is
      // rejected by the graph-action path (the guard mirrors server.mjs edges
      // route with the candidate-inclusive sim dock link).
      writeWorkflowGraphMap(root, {
        ...loadWorkflowGraphMap(root),
        version: loadWorkflowGraphMap(root).version + 1,
        nodes: [
          ...(loadWorkflowGraphMap(root).nodes || []),
          { nodeId: 'goal-second', label: 'Second Goal F12' },
        ],
      });

      await assert.rejects(
        () => executeNodeAction(root, 'agent-ceo', 'agent.connectNodes', { to: 'goal-second', relation: 'goal' }),
        (error) => {
          assert.equal(error.statusCode, 409, error.code);
          assert.equal(error.code, 'goal_already_bound');
          assert.equal(error.existingGoalNodeId, goalNodeId);
          assert.equal(error.timerNodeId, timerNodeId);
          return true;
        },
      );

      const graph = loadWorkflowGraphMap(root);
      const created = (graph.edges || []).some(edge => (edge.from === 'agent-ceo' && edge.to === 'goal-second') || (edge.from === 'goal-second' && edge.to === 'agent-ceo'));
      assert.equal(created, false, 'the rejected second-goal edge must not be created');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── F13/H2: wakeup recipients = magnetic group ∪ ordinary edge-connected agents ──
describe('F13/H2 — timer wakeup reaches magnetic-group AND ordinary edge-connected agents', () => {
  it('an agent connected by an ordinary event edge (no dock) receives the wakeup too', async () => {
    const root = seedRoot();
    try {
      const timer = await createNode(root, { type: 'timer', title: 'Edge Timer F13' });
      const timerNodeId = timer.node.nodeId;
      seedAgent(root, { nodeId: 'agent-docked', sessionId: 'session-docked', roleTitle: 'implementer', displayName: 'Docked' });
      seedAgent(root, { nodeId: 'agent-edged', sessionId: 'session-edged', roleTitle: 'reviewer', displayName: 'Edged' });
      seedAgent(root, { nodeId: 'agent-unrelated', sessionId: 'session-unrelated', roleTitle: 'planner', displayName: 'Unrelated' });
      writeWorkflowGraphMap(root, {
        ...loadWorkflowGraphMap(root),
        version: loadWorkflowGraphMap(root).version + 1,
        edges: [
          { id: `${timerNodeId}->agent-edged`, from: timerNodeId, to: 'agent-edged', relation: 'event', direction: 'source-to-target' },
          { id: `${timerNodeId}->agent-unrelated`, from: timerNodeId, to: 'agent-unrelated', relation: 'delegation', direction: 'bidirectional' },
        ],
        capsuleDockLinks: [dockLink('agent-docked', timerNodeId)],
      });

      const result = dispatchWakeup(timerNodeId, root, { firedAt: new Date().toISOString() });
      assert.equal(result.ok, true);
      assert.equal(result.agentCount, 2, 'docked + ordinary event-edge agent must both receive the wakeup');
      const delivered = new Set(result.deliveries.map(delivery => delivery.agentNodeId));
      assert.ok(delivered.has('agent-docked'), 'magnetic-group agent must receive the wakeup');
      assert.ok(delivered.has('agent-edged'), 'ordinary edge-connected agent must receive the wakeup');
      assert.ok(!delivered.has('agent-unrelated'), 'non event/control edges must not extend the recipient set');

      const edgedEntries = listBridgeMessages(root, { fromSessionId: `wakeup-${timerNodeId}`, toSessionId: 'session-edged' }).entries;
      assert.equal(edgedEntries.length, 1);
      assert.equal(edgedEntries[0].deliveryMode, 'wakeup');
      assert.equal(edgedEntries[0].source, 'timer.wakeup');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── F14/M3: scheduler honors loop.maxIterations — bounded interval advance ──
describe('F14/M3 — scheduler stops advancing a timer whose loop.maxIterations is reached', () => {
  it('timer with maxIterations=2 fires twice then stops advancing (no third fire)', async () => {
    const root = seedRoot();
    try {
      const timer = await createEventNode(root, {
        type: 'timer',
        title: 'Bounded Loop F14',
        enabled: true,
        schedule: { mode: 'interval', intervalSeconds: 1 },
        heartbeat: { base: { enabled: true, intervalSeconds: 1, nextDueAt: new Date(Date.now() - 2000).toISOString() } },
        loop: { enabled: true, maxIterations: 2 },
      });
      const timerNodeId = timer.node.nodeId;
      seedAgent(root, { nodeId: 'agent-wake-f14', sessionId: 'session-wake-f14', roleTitle: 'implementer', displayName: 'Wake F14' });
      writeWorkflowGraphMap(root, {
        ...loadWorkflowGraphMap(root),
        version: loadWorkflowGraphMap(root).version + 1,
        capsuleDockLinks: [dockLink('agent-wake-f14', timerNodeId)],
      });

      syncTimerScheduler(root, { intervalMs: 20 });
      assert.equal(isTimerSchedulerActive(), true, 'scheduler must run while the bounded timer exists');

      const wakeups = await waitForWakeups(root, timerNodeId, 'session-wake-f14', 2, { timeout: 6000 });
      assert.equal(wakeups.length, 2);
      assert.equal(wakeups[0].deliveryMode, 'wakeup');

      // Wait past one more full interval: the loop must NOT advance a third time.
      await new Promise(resolve => setTimeout(resolve, 1300));
      const after = getEventNode(root, timerNodeId);
      assert.equal(after.state.eventCount, 2, 'maxIterations=2 must stop further firing');
      assert.equal(after.state.loop.runCount, 2, 'runCount must track the fired runs');
      assert.equal(after.state.loop.enabled, false, 'the loop must be marked complete via the store API');

      const final = listBridgeMessages(root, { fromSessionId: `wakeup-${timerNodeId}`, toSessionId: 'session-wake-f14' }).entries;
      assert.equal(final.length, 2, 'no third wakeup may be dispatched after the loop completes');
    } finally {
      stopTimerScheduler();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
