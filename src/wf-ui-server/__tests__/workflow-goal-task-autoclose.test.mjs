import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Helpers ──
function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), '.tmp-goal-autoclose-test-' + id);
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({ schemaVersion: 1, version: 1, nodes: [], edges: [], positions: {}, undoStack: [], redoStack: [], deletedNodes: [] }));
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function seedAgentGraphNode(root, nodeId = 'goal-autoclose-agent-01') {
  const graph = runtime.loadWorkflowGraphMap(root);
  runtime.writeWorkflowGraphMap(root, {
    ...graph,
    version: graph.version + 1,
    nodes: [
      ...(graph.nodes || []),
      {
        nodeId,
        sessionId: `${nodeId}-pty`,
        agentKind: 'main',
        runtime: 'codex',
        status: 'stopped',
        label: 'Goal Autoclose Agent',
        cwd: root,
        taskId: null,
        role: 'main',
      },
    ],
    positions: {
      ...(graph.positions || {}),
      [nodeId]: { x: 100, y: 120 },
    },
  });
  return nodeId;
}

function seedActiveTask(root, taskId = 'task-goal-autoclose') {
  fs.mkdirSync(path.join(root, 'Harness', 'tasks', taskId), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'PROGRESS.md'), `# PROGRESS.md\n\n## Active Task\n\n- ${taskId}\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    mode: 'direct',
    tier: 'WF-Standard',
    phase: 'implement',
    gate: 'TEST-GATE',
    updatedAt: '2026-08-12T00:00:00.000Z',
    activeQuestion: null,
    nextAction: 'Implement the autoclose path.',
    acceptance: [
      { id: 'AC-AUTOCLOSE', status: 'tracked', text: 'Capsule closes when the Goal completes.' },
    ],
    links: { dependsOn: [], blocks: [], related: [] },
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'PLAN.md'), '# Autoclose plan\n', 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'PROGRESS.md'), '# Autoclose progress\n', 'utf8');
  return `goal-${taskId}`;
}

function connectGoal(localRoot, goalNodeId, agentNodeId) {
  graphStore.connectNodes(localRoot, {
    from: goalNodeId,
    to: agentNodeId,
    relation: 'goal',
    direction: 'bidirectional',
    sourceHandle: 'goal:right',
    targetHandle: 'context',
  });
}

function capsuleState(root, taskId) {
  return JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'tasks', taskId, 'STATE.json'), 'utf8'));
}

let runtime;
let graphStore;
let goalNodeModule;

before(async () => {
  runtime = await import('../workflow-node-runtime.mjs');
  graphStore = await import('../workflow-graph-store.mjs');
  goalNodeModule = await import('../workflow-node-types/goal-node.mjs');
});

describe('Workflow Goal Task Autoclose', () => {
  it('C1: goal.complete with all items checked closes the bound capsule (phase completed + closedBy + PROGRESS note)', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'goal-autoclose-agent-01');
      connectGoal(localRoot, goalNodeId, agentNodeId);

      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.add', {
        actorNodeId: agentNodeId,
        planItems: [{ text: 'Close capsule A' }, { text: 'Close capsule B' }],
      });
      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.check', {
        actorNodeId: agentNodeId,
        planItemIds: ['P-001', 'P-002'],
        now: '2026-08-13T07:00:00.000Z',
      });

      const completed = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.complete', {
        actorNodeId: agentNodeId,
        note: 'All plan items verified.',
        now: '2026-08-13T08:00:00.000Z',
      });
      assert.equal(completed.result.taskUpdate, 'completed');
      assert.equal(completed.result.state.status, 'proposed-complete', 'Goal sidecar status unchanged');

      const state = capsuleState(localRoot, 'task-goal-autoclose');
      assert.equal(state.phase, 'completed');
      assert.equal(state.status, 'active', 'capsule status must stay active (archive is a separate step)');
      assert.equal(state.closedBy, 'goal-complete');
      assert.equal(state.preCompletePhase, 'implement');
      assert.equal(state.updatedAt, '2026-08-13T08:00:00.000Z');
      assert.equal(state.taskId, 'task-goal-autoclose', 'unrelated capsule fields preserved');

      const progress = fs.readFileSync(path.join(localRoot, 'Harness', 'tasks', 'task-goal-autoclose', 'PROGRESS.md'), 'utf8');
      assert.ok(progress.startsWith('# Autoclose progress'), 'original PROGRESS content preserved');
      assert.ok(progress.includes('## Goal Completed'), progress);
      assert.ok(progress.includes('2026-08-13T08:00:00.000Z'), 'timestamp recorded');
      assert.ok(progress.includes(goalNodeId), 'goal node id recorded');
      assert.ok(progress.includes('- items: 2'), 'item count recorded');

      // The capsule stays resolvable so the Goal node keeps working.
      const after = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.read', {});
      assert.equal(after.result.status, 'proposed-complete');
    } finally {
      cleanup(localRoot);
    }
  });

  it('C2: goal.complete with unchecked items is still rejected and the capsule is untouched', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'goal-autoclose-agent-02');
      connectGoal(localRoot, goalNodeId, agentNodeId);

      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.add', {
        actorNodeId: agentNodeId,
        planItems: [{ text: 'Done one' }, { text: 'Open two' }],
      });
      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.check', {
        actorNodeId: agentNodeId,
        planItemIds: ['P-001'],
      });

      const beforeState = capsuleState(localRoot, 'task-goal-autoclose');
      const beforeProgress = fs.readFileSync(path.join(localRoot, 'Harness', 'tasks', 'task-goal-autoclose', 'PROGRESS.md'), 'utf8');

      await assert.rejects(
        () => runtime.executeNodeAction(localRoot, goalNodeId, 'goal.complete', {
          actorNodeId: agentNodeId,
          note: 'Completing early.',
        }),
        (error) => {
          assert.equal(error.code, 'goal_items_pending');
          assert.deepEqual(error.remaining, ['P-002']);
          return true;
        },
      );

      const afterState = capsuleState(localRoot, 'task-goal-autoclose');
      assert.deepEqual(afterState, beforeState, 'capsule STATE.json must be untouched after a rejected complete');
      const afterProgress = fs.readFileSync(path.join(localRoot, 'Harness', 'tasks', 'task-goal-autoclose', 'PROGRESS.md'), 'utf8');
      assert.equal(afterProgress, beforeProgress, 'capsule PROGRESS.md must be untouched after a rejected complete');
    } finally {
      cleanup(localRoot);
    }
  });

  it('C3: no task binding reports no-task-binding without an error', () => {
    const localRoot = tempProjectRoot();
    try {
      const at = '2026-08-13T09:00:00.000Z';
      assert.equal(goalNodeModule.updateTaskCapsuleOnComplete(localRoot, '', 'goal-x', at, 3), 'no-task-binding');
      assert.equal(goalNodeModule.updateTaskCapsuleOnReopen(localRoot, '', 'goal-x', at), 'no-task-binding');
      assert.equal(fs.existsSync(path.join(localRoot, 'Harness', 'tasks')), false, 'no capsule files created');
    } finally {
      cleanup(localRoot);
    }
  });

  it('C4: missing capsule dir is non-fatal and reports no-capsule', () => {
    const localRoot = tempProjectRoot();
    try {
      const at = '2026-08-13T09:05:00.000Z';
      assert.equal(goalNodeModule.updateTaskCapsuleOnComplete(localRoot, 'task-never-created', 'goal-x', at, 2), 'no-capsule');
      assert.equal(goalNodeModule.updateTaskCapsuleOnReopen(localRoot, 'task-never-created', 'goal-x', at), 'no-capsule');
    } finally {
      cleanup(localRoot);
    }
  });

  it('C5: goal.reopen restores the pre-complete phase and appends a Goal Reopened note', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'goal-autoclose-agent-03');
      connectGoal(localRoot, goalNodeId, agentNodeId);

      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.add', {
        actorNodeId: agentNodeId,
        planItems: [{ text: 'Solo item' }],
      });
      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.check', {
        actorNodeId: agentNodeId,
        planItemIds: ['P-001'],
      });
      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.complete', {
        actorNodeId: agentNodeId,
        note: 'Marking complete.',
        now: '2026-08-13T10:00:00.000Z',
      });
      assert.equal(capsuleState(localRoot, 'task-goal-autoclose').phase, 'completed');

      const reopened = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.reopen', {
        actorNodeId: agentNodeId,
        note: 'One more round of review.',
        now: '2026-08-13T11:00:00.000Z',
      });
      assert.equal(reopened.result.taskUpdate, 'reopened');
      assert.equal(reopened.result.state.status, 'active');

      const state = capsuleState(localRoot, 'task-goal-autoclose');
      assert.equal(state.phase, 'implement', 'phase restored from preCompletePhase');
      assert.equal(state.preCompletePhase, undefined, 'preCompletePhase cleared after restore');
      assert.equal(state.closedBy, undefined, 'closedBy cleared on reopen');
      assert.equal(state.status, 'active');
      assert.equal(state.updatedAt, '2026-08-13T11:00:00.000Z');

      const progress = fs.readFileSync(path.join(localRoot, 'Harness', 'tasks', 'task-goal-autoclose', 'PROGRESS.md'), 'utf8');
      assert.ok(progress.includes('## Goal Completed'), progress);
      assert.ok(progress.includes('## Goal Reopened'), progress);
      assert.ok(progress.includes('2026-08-13T11:00:00.000Z'), 'reopen timestamp recorded');
      assert.ok(progress.includes(goalNodeId), 'goal node id recorded');
    } finally {
      cleanup(localRoot);
    }
  });
});
