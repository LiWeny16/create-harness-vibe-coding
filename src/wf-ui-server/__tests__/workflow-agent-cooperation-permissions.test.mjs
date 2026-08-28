import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { loadWorkflowGraphMap, writeWorkflowGraphMap, loadA2aSkills } from '../a2a-store.mjs';
import { workflowOntology } from '../workflow-ontology.mjs';
import { createNode } from '../workflow-node-runtime.mjs';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';

// ── Helpers ──
function seedRoot() {
  const root = makeHarnessTempRoot('wf-agent-coop-permissions-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

function seedActiveTask(root, taskId = 'task-coop-permissions') {
  fs.mkdirSync(path.join(root, 'Harness', 'tasks', taskId), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'PROGRESS.md'), `# PROGRESS.md\n\n## Active Task\n\n- ${taskId}\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    nextAction: 'Close cooperation permission gates',
    acceptance: [],
    planItems: [],
    phase: 'implement',
  }));
  return `goal-${taskId}`;
}

async function seedGoalItems(base, goalNodeId, agentNodeId, count) {
  const added = await jsonRequest(base, `/api/workflow/nodes/${goalNodeId}/actions/goal.add`, {
    method: 'POST',
    body: { actorNodeId: agentNodeId, planItems: Array.from({ length: count }, (_, index) => ({ text: `Open item ${index + 1}` })) },
  });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  return added;
}

function seedAgentGraphNode(root, nodeId, sessionId = `${nodeId}-pty`) {
  writeWorkflowGraphMap(root, {
    ...loadWorkflowGraphMap(root),
    version: loadWorkflowGraphMap(root).version + 1,
    nodes: [
      ...(loadWorkflowGraphMap(root).nodes || []),
      { nodeId, sessionId, kind: 'terminal-session', runtime: 'claude', agentKind: 'subagent', role: 'Agent', label: 'Agent', status: 'stopped' },
    ],
  });
  return nodeId;
}

function connectGoal(root, goalNodeId, agentNodeId) {
  writeWorkflowGraphMap(root, {
    ...loadWorkflowGraphMap(root),
    version: loadWorkflowGraphMap(root).version + 1,
    edges: [
      ...(loadWorkflowGraphMap(root).edges || []),
      { id: `edge-${goalNodeId}-${agentNodeId}`, from: goalNodeId, to: agentNodeId, relation: 'goal', direction: 'bidirectional' },
    ],
  });
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
      {
        source: a,
        target: b,
        relation: 'wf-bridge',
        direction: 'source-to-target',
        sourceHandle: 'dock',
        targetHandle: 'dock',
      },
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

async function startTestServer(root) {
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  return { base: `http://127.0.0.1:${started.port}`, stop: () => stopServer(started.server) };
}

// ── Agent-visible allowed action set (spec §7/§8: agents tick goals and use the
//    markdown blackboard with locks; timer.dispatchWakeup stays denied) ──
test('AC-013/AC-016/AC-017 (a): agent allowed set includes goal item + markdown lock actions; dispatchWakeup denied', () => {
  const root = seedRoot();
  try {
    // Backend skill manuals carry the agent-visible allowed lists (a2a-store defaults)
    const skills = loadA2aSkills(root);
    const goalSkill = skills.find(s => s.skillId === 'workflow-goal-node');
    assert.ok(goalSkill, 'workflow-goal-node skill must be present');
    for (const action of ['goal.add', 'goal.delete', 'goal.replace', 'goal.check', 'goal.uncheck', 'goal.complete', 'goal.reopen']) {
      assert.ok(goalSkill.policy.allowed.includes(action), `goal skill allowed set must include ${action}`);
    }
    const markdownSkill = skills.find(s => s.skillId === 'workflow-markdown-node');
    assert.ok(markdownSkill, 'workflow-markdown-node skill must be present');
    for (const action of ['markdown.find', 'markdown.acquireLock', 'markdown.releaseLock']) {
      assert.ok(markdownSkill.policy.allowed.includes(action), `markdown skill allowed set must include ${action}`);
    }
    const resourceSkill = skills.find(s => s.skillId === 'workflow-resource-node');
    assert.ok(resourceSkill, 'workflow-resource-node skill must be present');
    for (const action of ['markdown.find', 'markdown.acquireLock', 'markdown.releaseLock']) {
      assert.ok(resourceSkill.policy.allowed.includes(action), `resource skill allowed set must include ${action}`);
    }

    // timer.dispatchWakeup stays denied to agents everywhere in the skill layer
    for (const skill of skills) {
      for (const list of [skill.policy?.allowed, skill.policy?.subagent, skill.policy?.mainAgent]) {
        if (Array.isArray(list)) {
          assert.ok(!list.includes('timer.dispatchWakeup'), `timer.dispatchWakeup must not appear in ${skill.skillId} allowed lists`);
        }
      }
    }

    // Ontology affordances: goal/markdown schema expose the new actions to agents
    const ontology = workflowOntology();
    const goalSchema = ontology.nodeTypes.goal;
    for (const action of ['goal.add', 'goal.delete', 'goal.replace', 'goal.check', 'goal.uncheck', 'goal.complete', 'goal.reopen']) {
      assert.ok(goalSchema.writableActions.includes(action), `goal ontology writableActions must include ${action}`);
    }
    const markdownSchema = ontology.nodeTypes.markdown;
    assert.ok(markdownSchema.readableActions.includes('markdown.find'), 'markdown ontology must expose markdown.find as a read action');
    assert.ok(markdownSchema.writableActions.includes('markdown.acquireLock'), 'markdown ontology writableActions must include markdown.acquireLock');
    assert.ok(markdownSchema.writableActions.includes('markdown.releaseLock'), 'markdown ontology writableActions must include markdown.releaseLock');

    // timer.dispatchWakeup remains a runtime action, denied to agents
    assert.ok(ontology.nodeTypes.timer.runtimeActions.includes('timer.dispatchWakeup'), 'timer.dispatchWakeup must stay a runtime action');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── Live HTTP dispatch: an agent CAN invoke goal.check and markdown.acquireLock ──
test('AC-013/AC-017 (a): agent invokes goal.check and markdown.acquireLock through the node-action route', async () => {
  const root = seedRoot();
  const goalNodeId = seedActiveTask(root);
  const agentNodeId = seedAgentGraphNode(root, 'agent-coop-1');
  connectGoal(root, goalNodeId, agentNodeId);
  const markdown = await createNode(root, { type: 'markdown', title: 'Team Blackboard' });
  const markdownNodeId = markdown.node.nodeId;
  const server = await startTestServer(root);
  try {
    await seedGoalItems(server.base, goalNodeId, agentNodeId, 1);
    const goalCheck = await jsonRequest(server.base, `/api/workflow/nodes/${goalNodeId}/actions/goal.check`, {
      method: 'POST',
      body: { planItemIds: ['P-001'], actorNodeId: agentNodeId },
    });
    assert.equal(goalCheck.status, 200, JSON.stringify(goalCheck.body));
    assert.equal(goalCheck.body.ok, true);
    assert.equal(goalCheck.body.action, 'goal.check');
    assert.equal(goalCheck.body.result.state.planItems[0].status, 'done', 'goal.check must tick the item');

    const acquire = await jsonRequest(server.base, `/api/workflow/nodes/${markdownNodeId}/actions/markdown.acquireLock`, {
      method: 'POST',
      body: { lockOwner: agentNodeId, ttlSeconds: 30 },
    });
    assert.equal(acquire.status, 200, JSON.stringify(acquire.body));
    assert.ok(acquire.body.result.lockId, 'acquireLock must return a lockId');
    assert.equal(acquire.body.result.owner, agentNodeId);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── HTTP error body detail fields (spec §7 goal_items_pending) ──
test('AC-014 (c): HTTP goal.complete rejection carries remaining ids in the body', async () => {
  const root = seedRoot();
  const goalNodeId = seedActiveTask(root);
  const agentNodeId = seedAgentGraphNode(root, 'agent-coop-2');
  connectGoal(root, goalNodeId, agentNodeId);
  const server = await startTestServer(root);
  try {
    await seedGoalItems(server.base, goalNodeId, agentNodeId, 2);
    const complete = await jsonRequest(server.base, `/api/workflow/nodes/${goalNodeId}/actions/goal.complete`, {
      method: 'POST',
      body: { evidenceRefs: [], actorNodeId: agentNodeId },
    });
    assert.equal(complete.status, 409, JSON.stringify(complete.body));
    assert.equal(complete.body.error.code, 'goal_items_pending');
    assert.equal(complete.body.error.message, 'Complete all plan items before completing the Goal.');
    assert.deepEqual(complete.body.remaining, ['P-001', 'P-002'], 'HTTP body must carry the typed remaining field');
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── HTTP error body detail fields (spec §8.3 markdown_conflict) ──
test('AC-018 (d): HTTP markdown_conflict carries currentRevision + expectedRevision', async () => {
  const root = seedRoot();
  const markdown = await createNode(root, { type: 'markdown', title: 'Blackboard' });
  const markdownNodeId = markdown.node.nodeId;
  const server = await startTestServer(root);
  try {
    const v1 = await jsonRequest(server.base, `/api/workflow/nodes/${markdownNodeId}/actions/markdown.append`, {
      method: 'POST',
      body: { markdown: '# v1' },
    });
    assert.equal(v1.status, 200, JSON.stringify(v1.body));
    const v2 = await jsonRequest(server.base, `/api/workflow/nodes/${markdownNodeId}/actions/markdown.append`, {
      method: 'POST',
      body: { markdown: '# v2' },
    });
    assert.equal(v2.status, 200, JSON.stringify(v2.body));
    const currentRevision = v2.body.result.revision;

    const stale = await jsonRequest(server.base, `/api/workflow/nodes/${markdownNodeId}/actions/markdown.append`, {
      method: 'POST',
      body: { markdown: '# stale', expectedRevision: 1 },
    });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.error.code, 'markdown_conflict');
    assert.equal(stale.body.currentRevision, currentRevision, 'HTTP body must carry currentRevision');
    assert.equal(stale.body.expectedRevision, 1, 'HTTP body must carry expectedRevision');

    // Lock conflict (spec §8.2/8.3, F18/D15): write by a non-holder is refused
    // with markdown_locked — mandatory exclusion while the lock is held, even
    // without expectedRevision — carrying the holder and lease expiry so the
    // UI can surface them.
    const lock = await jsonRequest(server.base, `/api/workflow/nodes/${markdownNodeId}/actions/markdown.acquireLock`, {
      method: 'POST',
      body: { lockOwner: 'agent-a', ttlSeconds: 30 },
    });
    assert.equal(lock.status, 200, JSON.stringify(lock.body));
    const locked = await jsonRequest(server.base, `/api/workflow/nodes/${markdownNodeId}/actions/markdown.append`, {
      method: 'POST',
      body: { markdown: '# blocked', lockOwner: 'agent-b' },
    });
    assert.equal(locked.status, 409, JSON.stringify(locked.body));
    assert.equal(locked.body.error.code, 'markdown_locked');
    assert.equal(locked.body.holder, 'agent-a', 'HTTP body must carry the lock holder');
    assert.ok(locked.body.expiresAt > Date.now(), 'HTTP body must carry the lock expiresAt');
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── HTTP error body detail fields (spec §6.2 goal_already_bound, AC-015/T12) ──
test('AC-015 (e): HTTP goal_already_bound carries existingGoalNodeId + timerNodeId (409)', async () => {
  const root = seedRoot();
  const goalNodeId = seedActiveTask(root);
  const timer = await createNode(root, { type: 'timer', title: 'Coop Timer' });
  const timerNodeId = timer.node.nodeId;
  const agentNodeId = seedAgentGraphNode(root, 'agent-coop-3');
  writeWorkflowGraphMap(root, {
    ...loadWorkflowGraphMap(root),
    version: loadWorkflowGraphMap(root).version + 1,
    capsuleDockLinks: [
      dockLink(goalNodeId, timerNodeId),
      dockLink(timerNodeId, agentNodeId),
    ],
  });
  const server = await startTestServer(root);
  try {
    const first = await jsonRequest(server.base, '/api/workflow/nodes', { method: 'POST', body: { type: 'goal' } });
    assert.equal(first.status, 201, JSON.stringify(first.body));

    // Inject a second goal into the same magnetic group
    writeWorkflowGraphMap(root, {
      ...loadWorkflowGraphMap(root),
      version: loadWorkflowGraphMap(root).version + 1,
      nodes: [
        ...(loadWorkflowGraphMap(root).nodes || []),
        { nodeId: 'goal-second', label: 'Second Goal' },
      ],
      capsuleDockLinks: [
        ...(loadWorkflowGraphMap(root).capsuleDockLinks || []),
        dockLink(agentNodeId, 'goal-second'),
      ],
    });

    const second = await jsonRequest(server.base, '/api/workflow/nodes', { method: 'POST', body: { type: 'goal' } });
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.error, 'goal_already_bound');
    assert.equal(second.body.existingGoalNodeId, 'goal-second');
    assert.equal(second.body.timerNodeId, timerNodeId);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
