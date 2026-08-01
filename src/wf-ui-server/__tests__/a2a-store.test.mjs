import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import {
  buildWorkflowSnapshot,
  ensureA2aDefaults,
  loadA2aSkills,
  loadBuiltInWorkflows,
  loadWorkflowGraphMap,
  removeWorkflowGraphNode,
  writeWorkflowGraphMap,
} from '../a2a-store.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import { persistSession } from '../terminal-store.mjs';

function makeProject() {
  const projectRoot = makeHarnessTempRoot('a2a-store-');
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

test('buildWorkflowSnapshot returns role hierarchy separately from visible canvas nodes', () => {
  const projectRoot = makeProject();
  try {
    const registry = new SessionRegistry();
    const session = registry.create({ taskId: 'task-alpha', runtime: 'codex' });
    registry.update(session.sessionId, { status: 'blocked', blockedReason: 'pty-adapter-missing' });
    const workflow = buildWorkflowSnapshot(projectRoot, registry);
    assert.equal(workflow.rootAgentId, 'ceo');
    assert.equal(workflow.nodes.some(node => node.id === 'ceo'), false);
    assert.equal(workflow.nodes.some(node => node.id === 'terminal-controller'), false);
    assert.ok(workflow.roles.nodes.some(node => node.id === 'ceo'));
    assert.ok(workflow.availableWorkflows.some(item => item.command === '/wf'));
    assert.ok(workflow.subagentModes.some(item => item.id === 'wf-subagents'));
    const terminalNode = workflow.nodes.find(node => node.id === `session-${session.sessionId}`);
    assert.ok(terminalNode);
    assert.equal(terminalNode.control.canStart, true);
    assert.equal(workflow.edges.length, 0);
    assert.ok(workflow.roles.edges.some(edge => edge.from === 'ceo' && edge.to === 'terminal-controller'));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('buildWorkflowSnapshot maps a workflow CEO to a real terminal node', () => {
  const projectRoot = makeProject();
  try {
    const registry = new SessionRegistry();
    const session = registry.create({
      taskId: 'task-alpha',
      runtime: 'claude',
      role: 'CEO',
      objective: 'WF Standard CEO terminal',
      workflowMode: 'wf',
    });
    registry.update(session.sessionId, { status: 'running' });
    const workflow = buildWorkflowSnapshot(projectRoot, registry);
    const node = workflow.nodes.find(item => item.id === `session-${session.sessionId}`);
    assert.equal(node.sessionId, session.sessionId);
    assert.equal(node.kind, 'terminal-session');
    assert.equal(node.role, 'CEO');
    assert.match(node.label, /WF CEO/);
    assert.equal(node.control.canStart, false);
    assert.equal(node.control.canStop, true);
    assert.equal(workflow.edges.length, 0);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('buildWorkflowSnapshot includes live unbound Harness/a2a terminal sessions', () => {
  const projectRoot = makeProject();
  try {
    const registry = new SessionRegistry();
    const session = registry.create({
      taskId: null,
      runtime: 'opencode',
      role: 'wf-subagent',
    });
    registry.update(session.sessionId, { status: 'running' });
    const workflow = buildWorkflowSnapshot(projectRoot, registry);
    const node = workflow.nodes.find(item => item.id === `session-${session.sessionId}`);
    assert.equal(node.runtime, 'opencode');
    assert.equal(node.taskId, null);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('buildWorkflowSnapshot downgrades orphaned disk running sessions to stopped', () => {
  const projectRoot = makeProject();
  try {
    persistSession(projectRoot, {
      taskId: null,
      sessionId: 'session-orphan',
      runtime: 'claude',
      role: 'wf-subagent',
      status: 'running',
      updatedAt: '2026-07-30T00:00:00.000Z',
    });
    writeWorkflowGraphMap(projectRoot, {
      nodes: [{ nodeId: 'session-session-orphan', sessionId: 'session-orphan', runtime: 'claude', status: 'running' }],
      positions: { 'session-session-orphan': { x: 120, y: 80 } },
    });
    const workflow = buildWorkflowSnapshot(projectRoot, new SessionRegistry());
    const node = workflow.nodes.find(item => item.id === 'session-session-orphan');
    assert.equal(node.status, 'stopped');
    assert.equal(node.blockedReason, 'not-managed-by-current-wf-ui');
    assert.equal(node.control.canStart, true);
    assert.deepEqual(workflow.graph.positions['session-session-orphan'], { x: 120, y: 80 });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('buildWorkflowSnapshot restores project graph positions from legacy undo stack', () => {
  const projectRoot = makeProject();
  try {
    persistSession(projectRoot, {
      taskId: null,
      sessionId: 'session-legacy-position',
      runtime: 'claude',
      role: 'wf-subagent',
      status: 'running',
      updatedAt: '2026-07-30T00:00:00.000Z',
    });
    writeWorkflowGraphMap(projectRoot, {
      nodes: [{ nodeId: 'session-session-legacy-position', sessionId: 'session-legacy-position', runtime: 'claude', status: 'running' }],
      undoStack: [
        { positions: { 'session-session-legacy-position': { x: 10, y: 20 } }, edges: [] },
        { positions: { 'session-session-legacy-position': { x: 260, y: 310 } }, edges: [] },
      ],
    });
    const workflow = buildWorkflowSnapshot(projectRoot, new SessionRegistry());
    assert.deepEqual(workflow.graph.positions['session-session-legacy-position'], { x: 260, y: 310 });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('buildWorkflowSnapshot keeps non-graph stopped sessions out of the visible canvas', () => {
  const projectRoot = makeProject();
  try {
    persistSession(projectRoot, {
      taskId: null,
      sessionId: 'session-hidden-history',
      runtime: 'claude',
      role: 'wf-subagent',
      status: 'saved',
      updatedAt: '2026-07-30T00:00:00.000Z',
    });
    const workflow = buildWorkflowSnapshot(projectRoot, new SessionRegistry());
    assert.equal(workflow.nodes.some(item => item.id === 'session-session-hidden-history'), false);
    assert.ok(workflow.sessions.some(item => item.sessionId === 'session-hidden-history'), 'Agents history still has access to stopped sessions');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('loadWorkflowGraphMap normalizes legacy saved node status to stopped', () => {
  const projectRoot = makeProject();
  try {
    writeWorkflowGraphMap(projectRoot, {
      nodes: [{ nodeId: 'session-legacy-saved', sessionId: 'legacy-saved', runtime: 'claude', status: 'saved' }],
    });
    const graph = loadWorkflowGraphMap(projectRoot);
    assert.equal(graph.nodes[0].status, 'stopped');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('buildWorkflowSnapshot hides graph-replaced transcript sessions and dedupes graph nodes', () => {
  const projectRoot = makeProject();
  try {
    persistSession(projectRoot, {
      taskId: null,
      sessionId: 'session-old-main',
      runtime: 'codex',
      role: 'Main Agent',
      agentKind: 'main',
      status: 'stopped',
      graphNodeId: '',
      graphReplacedBySessionId: 'session-new-main',
      updatedAt: '2026-07-30T00:00:00.000Z',
    });
    persistSession(projectRoot, {
      taskId: null,
      sessionId: 'session-new-main',
      runtime: 'codex',
      role: 'Main Agent',
      agentKind: 'main',
      status: 'running',
      graphNodeId: 'session-old-main',
      updatedAt: '2026-07-31T00:00:00.000Z',
    });
    writeWorkflowGraphMap(projectRoot, {
      nodes: [
        { nodeId: 'session-old-main', sessionId: 'session-new-main', runtime: 'codex', status: 'running' },
        { nodeId: 'session-old-main', sessionId: 'session-old-main', runtime: 'codex', status: 'stopped' },
      ],
    });

    const graph = loadWorkflowGraphMap(projectRoot);
    const workflow = buildWorkflowSnapshot(projectRoot, new SessionRegistry());
    assert.equal(graph.nodes.filter(node => node.nodeId === 'session-old-main').length, 1);
    assert.equal(graph.nodes[0].sessionId, 'session-new-main');
    assert.equal(graph.nodes[0].status, 'running');
    assert.equal(workflow.nodes.some(node => node.sessionId === 'session-old-main'), false);
    assert.equal(workflow.nodes.some(node => node.sessionId === 'session-new-main'), true);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-004 removed graph nodes stay tombstoned when stale browser state is written back', () => {
  const projectRoot = makeProject();
  try {
    persistSession(projectRoot, {
      taskId: null,
      sessionId: 'session-pruned',
      runtime: 'claude',
      role: 'Subagent',
      status: 'saved',
      updatedAt: '2026-07-30T00:00:00.000Z',
    });
    writeWorkflowGraphMap(projectRoot, {
      nodes: [{ nodeId: 'session-session-pruned', sessionId: 'session-pruned', runtime: 'claude', status: 'saved' }],
      edges: [{ id: 'edge-pruned', from: 'session-session-pruned', to: 'session-session-pruned' }],
      positions: { 'session-session-pruned': { x: 10, y: 20 } },
    });

    removeWorkflowGraphNode(projectRoot, 'session-session-pruned');
    writeWorkflowGraphMap(projectRoot, {
      version: 999,
      nodes: [{ nodeId: 'session-session-pruned', sessionId: 'session-pruned', runtime: 'claude', status: 'saved' }],
      edges: [{ id: 'edge-pruned', from: 'session-session-pruned', to: 'session-session-pruned' }],
      positions: { 'session-session-pruned': { x: 99, y: 99 } },
    });

    const graph = loadWorkflowGraphMap(projectRoot);
    const workflow = buildWorkflowSnapshot(projectRoot, new SessionRegistry());
    assert.equal(graph.nodes.some(node => node.sessionId === 'session-pruned'), false);
    assert.equal(graph.edges.some(edge => edge.id === 'edge-pruned'), false);
    assert.equal(graph.positions['session-session-pruned'], undefined);
    assert.ok(graph.deletedNodes.some(node => node.sessionId === 'session-pruned'));
    assert.equal(workflow.nodes.some(node => node.sessionId === 'session-pruned'), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-005 AC-006 buildWorkflowSnapshot exposes a versioned communication graph contract', () => {
  const projectRoot = makeProject();
  try {
    const registry = new SessionRegistry();
    const main = registry.create({
      runtime: 'codex',
      role: 'Main Agent',
      agentKind: 'main',
      workflowMode: 'wf',
      graphNodeId: 'agent-main-1',
    });
    const subagent = registry.create({
      runtime: 'claude',
      role: 'Subagent',
      agentKind: 'subagent',
      parentAgentId: main.sessionId,
      graphNodeId: 'agent-subagent-1',
    });
    registry.update(main.sessionId, { status: 'running' });
    registry.update(subagent.sessionId, { status: 'running' });

    const workflow = buildWorkflowSnapshot(projectRoot, registry);

    assert.ok(workflow.graph, 'snapshot should include durable workflow graph state');
    assert.equal(workflow.graph.schemaVersion, 1);
    assert.equal(typeof workflow.graph.version, 'number');
    assert.ok(Array.isArray(workflow.graph.nodes), 'graph nodes should be explicit');
    assert.ok(Array.isArray(workflow.graph.edges), 'graph edges should be explicit communication permissions');
    assert.ok(Array.isArray(workflow.graph.undoStack), 'graph mutations should be undoable');
    assert.ok(workflow.graph.nodes.some(node => node.agentKind === 'main' && node.sessionId === main.sessionId));
    assert.ok(workflow.graph.nodes.some(node => node.agentKind === 'subagent' && node.sessionId === subagent.sessionId));
    assert.ok(workflow.graph.edges.some(edge => (
      edge.kind === 'communication-permission'
      && edge.fromSessionId === main.sessionId
      && edge.toSessionId === subagent.sessionId
    )));
    assert.ok(workflow.graphContextBySessionId?.[main.sessionId]?.connectedPeerIds.includes(subagent.sessionId));
    assert.ok(workflow.graphContextBySessionId?.[subagent.sessionId]?.parentAgentId === main.sessionId);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
