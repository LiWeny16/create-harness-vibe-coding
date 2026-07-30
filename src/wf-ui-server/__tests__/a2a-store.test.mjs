import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildWorkflowSnapshot, ensureA2aDefaults, loadA2aSkills, loadBuiltInWorkflows } from '../a2a-store.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import { persistSession } from '../terminal-store.mjs';

function makeProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-store-'));
  const taskRoot = path.join(projectRoot, 'Harness', 'tasks', 'task-alpha');
  fs.mkdirSync(taskRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'Harness', 'PROGRESS.md'), '## Active Task\n\n- task-alpha\n');
  fs.writeFileSync(path.join(taskRoot, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId: 'task-alpha',
    status: 'active',
    mode: 'wf',
    phase: 'implementation',
    gate: 'AC-GATE',
    links: { dependsOn: [], blocks: [] },
    acceptance: [{ id: 'AC-015', text: 'workflow', status: 'pending' }]
  }));
  return projectRoot;
}

test('ensureA2aDefaults writes role graph and terminal skill manifest', () => {
  const projectRoot = makeProject();
  try {
    ensureA2aDefaults(projectRoot);
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'role-graph.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'workflows.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'terminal-control.json')));
    assert.equal(loadA2aSkills(projectRoot)[0].skillId, 'terminal-control');
    assert.ok(loadBuiltInWorkflows(projectRoot).some(workflow => workflow.command === '/wf'));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('buildWorkflowSnapshot returns CEO hierarchy and session-linked node', () => {
  const projectRoot = makeProject();
  try {
    const registry = new SessionRegistry();
    const session = registry.create({ taskId: 'task-alpha', runtime: 'codex' });
    registry.update(session.sessionId, { status: 'blocked', blockedReason: 'pty-adapter-missing' });
    const workflow = buildWorkflowSnapshot(projectRoot, registry);
    assert.equal(workflow.rootAgentId, 'ceo');
    assert.ok(workflow.nodes.some(node => node.id === 'ceo' && node.label === 'CEO Leader'));
    assert.ok(workflow.roles.nodes.some(node => node.id === 'ceo'));
    assert.ok(workflow.availableWorkflows.some(item => item.command === '/wf'));
    assert.ok(workflow.subagentModes.some(item => item.id === 'wf-subagents'));
    assert.ok(workflow.nodes.some(node => node.id === `session-${session.sessionId}`));
    assert.ok(workflow.edges.some(edge => edge.from === 'terminal-controller' && edge.to === `session-${session.sessionId}`));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('buildWorkflowSnapshot includes unbound Harness/a2a terminal sessions', () => {
  const projectRoot = makeProject();
  try {
    persistSession(projectRoot, {
      taskId: null,
      sessionId: 'session-unbound',
      runtime: 'opencode',
      role: 'wf-subagent',
      status: 'running',
      updatedAt: '2026-07-30T00:00:00.000Z',
    });
    const workflow = buildWorkflowSnapshot(projectRoot, new SessionRegistry());
    const node = workflow.nodes.find(item => item.id === 'session-session-unbound');
    assert.equal(node.runtime, 'opencode');
    assert.equal(node.taskId, null);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
