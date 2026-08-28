import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadActionRegistry } from '../action-registry.mjs';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import {
  buildWorkflowSnapshot,
  ensureA2aDefaults,
  loadA2aSkills,
  loadBuiltInWorkflows,
  loadRoleGraph,
  loadWorkflowGraphMap,
  removeWorkflowGraphNode,
  writeWorkflowGraphMap,
} from '../a2a-store.mjs';
import { createComponentNode } from '../component-node-store.mjs';
import { createEventNode, getEventNode, listEventNodes } from '../workflow-event-node-store.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import { persistSession } from '../terminal-store.mjs';

// This test lives at src/wf-ui-server/__tests__/; the repo root is 3 levels up.
// The action registry is only guaranteed at the repo root — ensureA2aDefaults
// does not copy it into temp projects.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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

test('W20-WORKFLOW-SKILLS ensureA2aDefaults writes canonical Agent workflow skill manifests', () => {
  const projectRoot = makeProject();
  try {
    ensureA2aDefaults(projectRoot);
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'role-graph.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'workflows.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'terminal-control.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-node-map.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-ontology.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-context.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-node-actions.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-timer-node.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-goal-node.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-agent-node.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-resource-node.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-markdown-node.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-diagram-node.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-file-node.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-skill-group-node.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'workflow-mcp-connector-node.json')));
    assert.ok(fs.existsSync(path.join(projectRoot, 'Harness', 'a2a', 'skills', 'wf-ui-map.json')));
    const skills = loadA2aSkills(projectRoot);
    const skillIds = new Set(skills.map(skill => skill.skillId));
    assert.ok(skillIds.has('terminal-control'));
    assert.ok(skillIds.has('workflow-node-map'));
    assert.ok(skillIds.has('workflow-ontology'));
    assert.ok(skillIds.has('workflow-context'));
    assert.ok(skillIds.has('workflow-node-actions'));
    assert.ok(skillIds.has('workflow-timer-node'));
    assert.ok(skillIds.has('workflow-goal-node'));
    assert.ok(skillIds.has('workflow-agent-node'));
    assert.ok(skillIds.has('workflow-resource-node'));
    assert.ok(skillIds.has('workflow-markdown-node'));
    assert.ok(skillIds.has('workflow-diagram-node'));
    assert.ok(skillIds.has('workflow-file-node'));
    assert.ok(skillIds.has('workflow-skill-group-node'));
    assert.ok(skillIds.has('workflow-mcp-connector-node'));
    const roleGraph = loadRoleGraph(projectRoot);
    const ceo = roleGraph.agents.find(agent => agent.agentId === 'ceo');
    const backend = roleGraph.agents.find(agent => agent.agentId === 'backend-expert');
    const terminalController = roleGraph.agents.find(agent => agent.agentId === 'terminal-controller');
    assert.ok(ceo.skills.includes('workflow-ontology'));
    assert.ok(backend.skills.includes('workflow-ontology'));
    assert.ok(terminalController.skills.includes('workflow-ontology'));
    const workflowNodeMap = skills.find(skill => skill.skillId === 'workflow-node-map');
    const workflowContext = skills.find(skill => skill.skillId === 'workflow-context');
    const workflowOntology = skills.find(skill => skill.skillId === 'workflow-ontology');
    const workflowNodeActions = skills.find(skill => skill.skillId === 'workflow-node-actions');
    const workflowTimerNode = skills.find(skill => skill.skillId === 'workflow-timer-node');
    const workflowGoalNode = skills.find(skill => skill.skillId === 'workflow-goal-node');
    const workflowSkillGroupNode = skills.find(skill => skill.skillId === 'workflow-skill-group-node');
    const workflowMcpConnectorNode = skills.find(skill => skill.skillId === 'workflow-mcp-connector-node');
    const terminalControl = skills.find(skill => skill.skillId === 'terminal-control');
    assert.ok(terminalControl.triggers.includes('read terminal'));
    assert.ok(workflowNodeMap.triggers.includes('connect nodes'));
    assert.ok(workflowContext.triggers.includes('connected resources'));
    assert.ok(workflowOntology.triggers.includes('action affordances'));
    assert.ok(workflowNodeActions.triggers.includes('draw flowchart'));
    assert.ok(workflowTimerNode.triggers.includes('timer interval'));
    assert.ok(workflowTimerNode.policy.denied.includes('direct-event-node-state-file-edit'));
    assert.ok(workflowGoalNode.policy.denied.includes('direct-goal-node-state-file-edit'));
    assert.ok(workflowSkillGroupNode.policy.denied.includes('independent-skill-execution'));
    assert.ok(workflowMcpConnectorNode.policy.denied.includes('mcp-tool-invocation-without-permission'));
    // Node-type manuals are prose-only now: commands are merged at injection
    // time from Harness/a2a/action-registry.json, so the manual expectations
    // are asserted against the registry action ids instead.
    const registryActionIds = new Set(loadActionRegistry(REPO_ROOT).actions.map((action) => action.id));
    assert.ok(registryActionIds.has('timer.setInterval'));
    assert.ok(registryActionIds.has('agent.sendInput'), 'delegate-agent wraps the agent.sendInput action');
    assert.ok(registryActionIds.has('markdown.replace'));
    assert.ok(registryActionIds.has('markdown.append'));
    assert.ok(registryActionIds.has('excalidraw.saveScene'));
    assert.ok(registryActionIds.has('file.readText'));
    assert.equal(ceo.skills.includes('workflow-timer-node'), false, 'node-specific skills should stay on-demand, not default-loaded');
    const legacy = skills.find(skill => skill.skillId === 'wf-ui-map');
    assert.equal(legacy.compatibilityAliasFor, 'workflow-node-map');
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
    assert.ok(workflow.subagentModes.some(item => item.id === 'built-in-subagents'));
    assert.ok(workflow.subagentModes.some(item => item.id === 'wf-node-subagents'));
    assert.equal(workflow.subagentModes.some(item => item.id === 'wf-subagents'), false);
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
    assert.equal(node.status, 'running');
    assert.equal(node.blockedReason, 'not-managed-by-current-wf-ui');
    assert.equal(node.control.canStart, false);
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

test('deleted Goal anchors stay tombstoned in workflow snapshots and stale graph writes', () => {
  const projectRoot = makeProject();
  try {
    const goalNodeId = 'goal-task-alpha';
    const before = buildWorkflowSnapshot(projectRoot, new SessionRegistry());
    assert.equal(before.nodes.some(node => node.id === goalNodeId || node.nodeId === goalNodeId), true);
    assert.ok(before.goalNodes[goalNodeId]);
    assert.ok(before.graph.goalStateRefs[goalNodeId]);

    removeWorkflowGraphNode(projectRoot, goalNodeId);
    const afterDelete = buildWorkflowSnapshot(projectRoot, new SessionRegistry());
    assert.equal(afterDelete.nodes.some(node => node.id === goalNodeId || node.nodeId === goalNodeId), false);
    assert.equal(afterDelete.graph.nodes.some(node => node.nodeId === goalNodeId), false);
    assert.equal(afterDelete.graph.goalStateRefs[goalNodeId], undefined);
    assert.equal(afterDelete.goalNodes[goalNodeId], undefined);
    assert.ok(afterDelete.graph.deletedNodes.some(node => node.nodeId === goalNodeId));

    writeWorkflowGraphMap(projectRoot, {
      version: 999,
      nodes: [{ nodeId: goalNodeId, kind: 'goal-node', type: 'goal', title: 'Stale Goal' }],
      edges: [{ id: `${goalNodeId}->${goalNodeId}`, from: goalNodeId, to: goalNodeId, relation: 'goal' }],
      positions: { [goalNodeId]: { x: 99, y: 99 } },
    });

    const afterStaleWrite = buildWorkflowSnapshot(projectRoot, new SessionRegistry());
    assert.equal(afterStaleWrite.nodes.some(node => node.id === goalNodeId || node.nodeId === goalNodeId), false);
    assert.equal(afterStaleWrite.graph.nodes.some(node => node.nodeId === goalNodeId), false);
    assert.equal(afterStaleWrite.graph.edges.some(edge => edge.from === goalNodeId || edge.to === goalNodeId), false);
    assert.equal(afterStaleWrite.graph.positions[goalNodeId], undefined);
    assert.equal(afterStaleWrite.graph.goalStateRefs[goalNodeId], undefined);
    assert.equal(afterStaleWrite.goalNodes[goalNodeId], undefined);
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

test('buildWorkflowSnapshot skips stale component nodes and dangling edges when state files are missing', () => {
  const projectRoot = makeProject();
  try {
    const stale = createComponentNode(projectRoot, {
      type: 'markdown',
      title: 'Missing State',
      markdown: 'gone',
      position: { x: 10, y: 20 },
    });
    const live = createComponentNode(projectRoot, {
      type: 'markdown',
      title: 'Live State',
      markdown: 'here',
      position: { x: 200, y: 20 },
    });
    writeWorkflowGraphMap(projectRoot, {
      nodes: [stale.node, live.node],
      edges: [{ id: 'stale-live', from: stale.node.nodeId, to: live.node.nodeId, direction: 'bidirectional' }],
      positions: {
        [stale.node.nodeId]: { x: 10, y: 20 },
        [live.node.nodeId]: { x: 200, y: 20 },
      },
    });
    fs.rmSync(path.join(projectRoot, stale.node.statePath), { force: true });

    const workflow = buildWorkflowSnapshot(projectRoot, new SessionRegistry());

    assert.equal(workflow.nodes.some(node => node.nodeId === stale.node.nodeId), false);
    assert.equal(workflow.graph.nodes.some(node => node.nodeId === stale.node.nodeId), false);
    assert.equal(Object.hasOwn(workflow.componentNodes, stale.node.nodeId), false);
    assert.equal(workflow.nodes.some(node => node.nodeId === live.node.nodeId), true);
    assert.equal(Object.hasOwn(workflow.componentNodes, live.node.nodeId), true);
    assert.equal(workflow.graph.edges.some(edge => edge.from === stale.node.nodeId || edge.to === stale.node.nodeId), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('typed-node store cleanup: removeWorkflowGraphNode deletes event store state (no snapshot resurrection)', () => {
  const root = makeHarnessTempRoot('wfui-evt-del-');
  try {
    fs.mkdirSync(path.join(root, 'Harness', 'a2a', 'event-nodes'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
    const created = createEventNode(root, { nodeId: 'event-del-test', type: 'timer', schedule: { intervalSeconds: 60 } });
    assert.ok(created);
    assert.ok(getEventNode(root, 'event-del-test'), 'store record exists before delete');

    removeWorkflowGraphNode(root, 'event-del-test');
    let gone = false;
    try { getEventNode(root, 'event-del-test'); } catch { gone = true; }
    assert.ok(gone, 'store record must be removed with the graph node (getEventNode 404s)');
    assert.equal(listEventNodes(root).some(node => node.nodeId === 'event-del-test'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
