import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Helpers ──
function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), '.tmp-goal-actions-test-' + id);
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({ schemaVersion: 1, version: 1, nodes: [], edges: [], positions: {}, undoStack: [], redoStack: [], deletedNodes: [] }));
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function seedAgentGraphNode(root, nodeId = 'goal-actions-agent-01') {
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
        label: 'Goal Actions Agent',
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

function seedActiveTask(root, taskId = 'task-goal-actions') {
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
    nextAction: 'Implement Goal item actions.',
    acceptance: [
      { id: 'AC-ITEM-ACTIONS', status: 'tracked', text: 'Goal item actions are callable.' },
      { id: 'AC-COMPLETE-GATE', status: 'tracked', text: 'Complete requires all plan items checked.' },
    ],
    links: { dependsOn: [], blocks: [], related: [] },
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'PLAN.md'), '# Goal plan\n', 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'PROGRESS.md'), '# Goal progress\n', 'utf8');
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

let runtime;
let graphStore;

before(async () => {
  runtime = await import('../workflow-node-runtime.mjs');
  graphStore = await import('../workflow-graph-store.mjs');
});

// ── Goal item actions (spec §7: AC-013, AC-014, T11 backend part) ──
describe('Workflow Goal Actions', () => {
  it('goal.add appends plan and acceptance items with new sequential ids', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'goal-actions-agent-01');
      connectGoal(localRoot, goalNodeId, agentNodeId);

      const added = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.add', {
        actorNodeId: agentNodeId,
        planItems: [{ text: 'Write backend tests', status: 'todo' }, { text: 'Run the suite' }],
        acceptance: [{ text: 'Actions are callable' }],
      });
      assert.equal(added.result.state.planItems.length, 2);
      assert.equal(added.result.state.planItems[0].id, 'P-001');
      assert.equal(added.result.state.planItems[0].text, 'Write backend tests');
      assert.equal(added.result.state.planItems[0].status, 'todo');
      assert.equal(added.result.state.planItems[1].id, 'P-002');
      assert.equal(added.result.state.acceptance.length, 3, 'task acceptance plus the appended item');
      const appendedAc = added.result.state.acceptance.find(item => item.id === 'AC-001');
      assert.ok(appendedAc, JSON.stringify(added.result.state.acceptance));
      assert.equal(appendedAc.text, 'Actions are callable');
      assert.equal(appendedAc.status, 'tracked');
      assert.ok(added.result.revision > 0);
      assert.equal(added.ok, true);

      const appended = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.add', {
        actorNodeId: agentNodeId,
        planItems: [{ text: 'Third item' }],
      });
      assert.equal(appended.result.state.planItems.length, 3);
      assert.equal(appended.result.state.planItems[2].id, 'P-003');
    } finally {
      cleanup(localRoot);
    }
  });

  it('goal.delete removes items and reports unknown ids as skipped', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'goal-actions-agent-02');
      connectGoal(localRoot, goalNodeId, agentNodeId);

      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.add', {
        actorNodeId: agentNodeId,
        planItems: [{ text: 'Keep me' }, { text: 'Drop me' }],
        acceptance: [{ text: 'Keep AC' }, { text: 'Drop AC' }],
      });

      const removed = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.delete', {
        actorNodeId: agentNodeId,
        planItemIds: ['P-002', 'P-999'],
        acceptanceIds: ['AC-002', 'AC-999'],
      });
      assert.equal(removed.result.state.planItems.length, 1);
      assert.equal(removed.result.state.planItems[0].id, 'P-001');
      assert.equal(removed.result.state.planItems[0].text, 'Keep me');
      assert.equal(removed.result.state.acceptance.length, 3, 'task acceptance plus the kept AC-001 item');
      assert.equal(removed.result.state.acceptance.some(item => item.id === 'AC-001' && item.text === 'Keep AC'), true);
      assert.equal(removed.result.state.acceptance.some(item => item.text === 'Drop AC'), false);
      assert.deepEqual(removed.result.skipped, ['P-999', 'AC-999']);
    } finally {
      cleanup(localRoot);
    }
  });

  it('goal.replace replaces the full list while preserving ids of kept items', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'goal-actions-agent-03');
      connectGoal(localRoot, goalNodeId, agentNodeId);

      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.add', {
        actorNodeId: agentNodeId,
        planItems: [{ text: 'Old A' }, { text: 'Old B' }],
      });

      const replaced = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.replace', {
        actorNodeId: agentNodeId,
        planItems: [{ id: 'P-001', text: 'Old A rewritten', status: 'todo' }, { text: 'Brand new' }],
      });
      assert.equal(replaced.result.state.planItems.length, 2);
      assert.equal(replaced.result.state.planItems[0].id, 'P-001', 'kept item id preserved');
      assert.equal(replaced.result.state.planItems[0].text, 'Old A rewritten');
      assert.equal(replaced.result.state.planItems[1].id, 'P-002', 'new item continues sequence');
      assert.equal(replaced.result.state.planItems[1].text, 'Brand new');
    } finally {
      cleanup(localRoot);
    }
  });

  it('goal.check sets status done and records updatedBy/updatedAt; goal.uncheck returns to todo', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'goal-actions-agent-04');
      connectGoal(localRoot, goalNodeId, agentNodeId);

      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.add', {
        actorNodeId: agentNodeId,
        planItems: [{ text: 'Task one' }, { text: 'Task two' }],
      });

      const checked = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.check', {
        actorNodeId: agentNodeId,
        planItemIds: ['P-001'],
        now: '2026-08-12T10:00:00.000Z',
      });
      assert.equal(checked.result.state.planItems[0].status, 'done');
      assert.equal(checked.result.state.planItems[0].updatedBy, agentNodeId);
      assert.equal(checked.result.state.planItems[0].updatedAt, '2026-08-12T10:00:00.000Z');
      assert.equal(checked.result.state.planItems[1].status, 'todo');
      assert.equal(checked.result.state.status, 'active', 'checking an item must not complete the Goal');

      const unchecked = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.uncheck', {
        actorNodeId: agentNodeId,
        planItemIds: ['P-001'],
        now: '2026-08-12T10:05:00.000Z',
      });
      assert.equal(unchecked.result.state.planItems[0].status, 'todo');
      assert.equal(unchecked.result.state.planItems[0].updatedBy, agentNodeId);
      assert.equal(unchecked.result.state.planItems[0].updatedAt, '2026-08-12T10:05:00.000Z');
    } finally {
      cleanup(localRoot);
    }
  });

  it('goal.complete with unchecked items rejects with goal_items_pending and remaining ids', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'goal-actions-agent-05');
      connectGoal(localRoot, goalNodeId, agentNodeId);

      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.add', {
        actorNodeId: agentNodeId,
        planItems: [{ text: 'Done one' }, { text: 'Open two' }, { text: 'Open three' }],
      });
      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.check', {
        actorNodeId: agentNodeId,
        planItemIds: ['P-001'],
      });

      await assert.rejects(
        () => runtime.executeNodeAction(localRoot, goalNodeId, 'goal.complete', {
          actorNodeId: agentNodeId,
          evidenceRefs: ['goal-actions-tests'],
          note: 'Completing early.',
        }),
        (error) => {
          assert.equal(error.code, 'goal_items_pending');
          assert.match(error.message, /Complete all plan items/);
          assert.deepEqual(error.remaining, ['P-002', 'P-003']);
          return true;
        },
      );

      const after = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.read', {});
      assert.equal(after.result.status, 'active', 'failed complete must not change Goal status');
    } finally {
      cleanup(localRoot);
    }
  });

  it('goal.complete after all items checked sets proposed-complete with audit fields', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'goal-actions-agent-06');
      connectGoal(localRoot, goalNodeId, agentNodeId);

      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.add', {
        actorNodeId: agentNodeId,
        planItems: [{ text: 'Done one' }, { text: 'Done two' }],
      });
      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.check', {
        actorNodeId: agentNodeId,
        planItemIds: ['P-001', 'P-002'],
        now: '2026-08-12T11:00:00.000Z',
      });

      const completed = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.complete', {
        actorNodeId: agentNodeId,
        evidenceRefs: ['goal-actions-tests'],
        note: 'All plan items verified.',
        now: '2026-08-12T11:05:00.000Z',
      });
      assert.equal(completed.result.state.status, 'proposed-complete');
      assert.equal(completed.result.state.confirmation.state, 'proposed');
      assert.equal(completed.result.state.confirmation.proposedBy, agentNodeId);
      assert.equal(completed.result.state.confirmation.proposedAt, '2026-08-12T11:05:00.000Z');
      assert.deepEqual(completed.result.state.confirmation.evidenceRefs, ['goal-actions-tests']);
      assert.equal(completed.result.state.confirmation.note, 'All plan items verified.');
    } finally {
      cleanup(localRoot);
    }
  });

  it('goal.reopen returns a proposed-complete Goal to active', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'goal-actions-agent-07');
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
      });

      const reopened = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.reopen', {
        actorNodeId: agentNodeId,
        note: 'One more round of review.',
        now: '2026-08-12T12:00:00.000Z',
      });
      assert.equal(reopened.result.state.status, 'active');
      assert.equal(reopened.result.state.confirmation.state, 'returned');
      assert.equal(reopened.result.state.confirmation.note, 'One more round of review.');
    } finally {
      cleanup(localRoot);
    }
  });

  it('legacy goal.update still replaces acceptance/planItems wholesale (T14-style compat)', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'goal-actions-agent-08');
      connectGoal(localRoot, goalNodeId, agentNodeId);

      await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.add', {
        actorNodeId: agentNodeId,
        planItems: [{ text: 'To be replaced' }],
        acceptance: [{ text: 'To be replaced AC' }],
      });

      const updated = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.update', {
        actorNodeId: agentNodeId,
        nextAction: 'Legacy wholesale replace.',
        acceptance: ['Fresh acceptance'],
        planItems: [{ id: 'P-010', text: 'Fresh plan', status: 'todo' }],
      });
      assert.equal(updated.result.state.nextAction, 'Legacy wholesale replace.');
      assert.equal(updated.result.state.planItems.length, 1);
      assert.equal(updated.result.state.planItems[0].id, 'P-010');
      assert.equal(updated.result.state.planItems[0].text, 'Fresh plan');
      assert.equal(updated.result.state.acceptance.length, 1);
      assert.equal(updated.result.state.acceptance[0].id, 'AC-001');
      assert.equal(updated.result.state.acceptance[0].text, 'Fresh acceptance');
    } finally {
      cleanup(localRoot);
    }
  });
});
