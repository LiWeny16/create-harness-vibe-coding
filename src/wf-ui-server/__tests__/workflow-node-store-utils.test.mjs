import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { readJsonFile, writeJsonFileAtomic } from '../json-store-utils.mjs';
import { createComponentNode, getComponentNode, listLiveComponentNodes } from '../component-node-store.mjs';
import { createEventNode, getEventNode } from '../workflow-event-node-store.mjs';
import { createCapabilityNode, getCapabilityNode } from '../workflow-capability-node-store.mjs';
import { getGoalNode } from '../workflow-goal-node-store.mjs';

function makeProject(prefix = 'wf-node-store-utils-') {
  const projectRoot = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(projectRoot, 'Harness', 'tasks'), { recursive: true });
  return projectRoot;
}

function writeActiveTask(projectRoot, taskId = 'task-store-utils') {
  fs.mkdirSync(path.join(projectRoot, 'Harness', 'tasks', taskId), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'Harness', 'PROGRESS.md'), `# PROGRESS.md\n\n## Active Task\n\n- ${taskId}\n`, 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'Harness', 'tasks', taskId, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    phase: 'implement',
    gate: 'VERIFY',
    nextAction: 'Verify node store utilities.',
    acceptance: [{ id: 'AC-001', text: 'Strict JSON reads', status: 'tracked' }],
    links: { dependsOn: [], blocks: [] },
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'Harness', 'tasks', taskId, 'PLAN.md'), '# Plan\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'Harness', 'tasks', taskId, 'PROGRESS.md'), '# Progress\n', 'utf8');
  return `goal-${taskId}`;
}

test('W39-ATOMIC-WRITE writes pretty JSON through the shared atomic writer', () => {
  const projectRoot = makeProject();
  try {
    const target = path.join(projectRoot, 'Harness', 'a2a', 'store', 'state.json');
    writeJsonFileAtomic(target, { alpha: 1, nested: { beta: true } });

    const body = fs.readFileSync(target, 'utf8');
    assert.equal(body.endsWith('\n'), true);
    assert.match(body, /\n  "alpha": 1,/);
    assert.deepEqual(JSON.parse(body), { alpha: 1, nested: { beta: true } });
    const leftovers = fs.readdirSync(path.dirname(target)).filter(name => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('W39-STRICT-READ distinguishes missing fallback from corrupt JSON', () => {
  const projectRoot = makeProject();
  try {
    const missing = path.join(projectRoot, 'Harness', 'a2a', 'missing.json');
    assert.deepEqual(readJsonFile(missing, { fallback: true }), { fallback: true });

    const corrupt = path.join(projectRoot, 'Harness', 'a2a', 'corrupt.json');
    fs.mkdirSync(path.dirname(corrupt), { recursive: true });
    fs.writeFileSync(corrupt, '{', 'utf8');
    assert.throws(() => readJsonFile(corrupt, null), (error) => {
      assert.equal(error.code, 'CORRUPT_JSON');
      assert.match(error.message, /Corrupt JSON store file/);
      return true;
    });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('W39-STRICT-READ keeps direct component reads strict while stale live lists skip missing state refs', () => {
  const projectRoot = makeProject();
  try {
    const live = createComponentNode(projectRoot, {
      type: 'markdown',
      title: 'Live',
      markdown: 'live',
    });
    const stale = createComponentNode(projectRoot, {
      type: 'markdown',
      title: 'Stale',
      markdown: 'stale',
    });
    fs.rmSync(path.join(projectRoot, stale.node.statePath), { force: true });

    assert.throws(() => getComponentNode(projectRoot, stale.node.nodeId), /STATE_MISMATCH|missing|out of sync/i);
    assert.deepEqual(listLiveComponentNodes(projectRoot).map(node => node.nodeId), [live.node.nodeId]);

    fs.writeFileSync(path.join(projectRoot, live.node.statePath), '{', 'utf8');
    assert.throws(() => getComponentNode(projectRoot, live.node.nodeId), /Corrupt JSON store file/);
    assert.throws(() => listLiveComponentNodes(projectRoot), /Corrupt JSON store file/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('W39-STRICT-READ direct event, capability, and goal store reads reject corrupt JSON', () => {
  const projectRoot = makeProject();
  try {
    const event = createEventNode(projectRoot, {
      type: 'timer',
      title: 'Strict Timer',
    });
    fs.writeFileSync(path.join(projectRoot, event.node.statePath), '{', 'utf8');
    assert.throws(() => getEventNode(projectRoot, event.node.nodeId), /Corrupt JSON store file/);

    const capability = createCapabilityNode(projectRoot, {
      type: 'skill-group',
      title: 'Strict Skills',
      skills: [{ id: 'skill:wf-ui', name: 'wf-ui' }],
    });
    fs.writeFileSync(path.join(projectRoot, capability.node.statePath), '{', 'utf8');
    assert.throws(() => getCapabilityNode(projectRoot, capability.node.nodeId), /Corrupt JSON store file/);

    const goalNodeId = writeActiveTask(projectRoot);
    getGoalNode(projectRoot, goalNodeId);
    const sidecarPath = path.join(projectRoot, 'Harness', 'a2a', 'goal-nodes', goalNodeId, 'state.json');
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, '{', 'utf8');
    assert.throws(() => getGoalNode(projectRoot, goalNodeId), /Corrupt JSON store file/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
