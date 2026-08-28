import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import {
  buildAgentContext,
  buildAgentSnapshot,
  buildConnections,
  buildConnectedAgentRefs,
  buildConnectedCapabilityRefs,
  buildConnectedEventRefs,
  buildConnectedGoalRefs,
  buildConnectedResourceRefs,
  effectiveSkillGroupsFor,
  findAgentGraphNode,
  outputRoutingFor,
  skillTriggersFor,
} from '../workflow-agent-context.mjs';
import { buildWorkflowSnapshot, loadWorkflowGraphMap, writeWorkflowGraphMap } from '../a2a-store.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import * as runtime from '../workflow-node-runtime.mjs';

// W40-C1-CONTEXT-UNIFY golden test: the API path (/api/workflow/context/:id via
// buildAgentContext) and the snapshot path (/api/a2a/snapshot per-node context
// via buildWorkflowSnapshot -> buildSessionGraph) MUST produce the same Agent
// context shape and values. The snapshot path may only add the session-
// enumeration extras (agentKind, parentAgentId, connectedPeerIds,
// outboundPeerIds, inboundPeerIds).
const SNAPSHOT_ONLY_KEYS = ['agentKind', 'connectedPeerIds', 'inboundPeerIds', 'outboundPeerIds', 'parentAgentId'];

const DRIFT_FIELDS = [
  'defaultSkills',
  'defaultCapabilityRefs',
  'ontology',
  'affordances',
  'availableActions',
  'magneticTopology',
  'outputRouting',
  'directMagneticNeighbors',
  'magneticReachableNodes',
  'magneticGroupId',
  'identity',
  'workspace',
  'connectedPeers',
  'connectedAgentRefs',
  'skillTriggers',
  'availableOnDemandCapabilityRefs',
  'graphVersion',
];

function makeProject() {
  const projectRoot = makeHarnessTempRoot('wf-agent-context-');
  const taskRoot = path.join(projectRoot, 'Harness', 'tasks', 'task-context-unify');
  fs.mkdirSync(taskRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'Harness', 'PROGRESS.md'), '## Active Task\n\n- task-context-unify\n');
  fs.writeFileSync(path.join(taskRoot, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId: 'task-context-unify',
    status: 'active',
    mode: 'wf',
    phase: 'implementation',
    gate: 'AC-GATE',
    links: { dependsOn: [], blocks: [] },
    acceptance: [{ id: 'AC-CONTEXT', text: 'unified context', status: 'pending' }],
  }, null, 2));
  fs.writeFileSync(path.join(taskRoot, 'PLAN.md'), '# Plan\n');
  fs.writeFileSync(path.join(taskRoot, 'PROGRESS.md'), '# Progress\n');
  return projectRoot;
}

async function seedGraphFixture(root) {
  // One agent, one timer (event + control edges), one markdown resource,
  // one goal, one capability (skill-group), one capsule dock (magnetic group).
  const agentNodeId = 'session-context-unify';
  const registry = new SessionRegistry();
  const session = registry.create({
    runtime: 'codex',
    agentKind: 'main',
    role: 'Main Agent',
    graphNodeId: agentNodeId,
  });
  const sessionId = session.sessionId;
  registry.update(sessionId, { status: 'running' });
  const subagent = registry.create({
    runtime: 'claude',
    agentKind: 'subagent',
    role: 'Subagent',
    parentAgentId: sessionId,
    graphNodeId: 'session-context-sub',
  });
  const subSessionId = subagent.sessionId;
  registry.update(subSessionId, { status: 'running' });

  const markdown = await runtime.createNode(root, { type: 'markdown', title: 'Agent Notes', markdown: '# Notes' });
  const timer = await runtime.createNode(root, {
    type: 'timer',
    title: 'Heartbeat Timer',
    schedule: { mode: 'loop', intervalSeconds: 30 },
  });
  const pack = await runtime.createNode(root, {
    type: 'skill-group',
    title: 'Agent Skill Pack',
    sourceGroup: { id: 'source:workflow', label: 'Workflow', kind: 'source' },
    skills: [
      { id: 'skill:wf-ui', name: 'wf-ui', title: 'WF-UI Adapter', source: 'project' },
      { id: 'skill:browser-lab', name: 'browser-lab', title: 'Browser Lab', source: 'project' },
    ],
  });
  const goalNodeId = 'goal-task-context-unify';

  writeWorkflowGraphMap(root, {
    schemaVersion: 1,
    version: 7,
    nodes: [{
      nodeId: agentNodeId,
      sessionId,
      kind: 'terminal-session',
      agentKind: 'main',
      runtime: 'codex',
      status: 'running',
      role: 'Main Agent',
      label: 'Main Agent',
      cwd: root,
      taskId: null,
    }],
    edges: [
      { id: 'edge-agent-timer', from: agentNodeId, to: timer.node.nodeId, relation: 'event', direction: 'source-to-target', sourceHandle: 'context', targetHandle: 'event' },
      { id: 'edge-agent-timer-control', from: agentNodeId, to: timer.node.nodeId, relation: 'control', direction: 'source-to-target', sourceHandle: 'context', targetHandle: 'config' },
      { id: 'edge-agent-markdown', from: agentNodeId, to: markdown.node.nodeId, relation: 'default-output', direction: 'bidirectional', sourceHandle: 'output', targetHandle: 'markdown' },
      { id: 'edge-agent-goal', from: agentNodeId, to: goalNodeId, relation: 'goal', direction: 'bidirectional', sourceHandle: 'context', targetHandle: 'goal' },
      { id: 'edge-agent-pack', from: agentNodeId, to: pack.node.nodeId, relation: 'capability', direction: 'bidirectional', sourceHandle: 'right', targetHandle: 'capability:left' },
    ],
    capsuleDockLinks: [{
      id: 'dock-context',
      nodeIds: [agentNodeId, markdown.node.nodeId],
      anchorId: agentNodeId,
      draggedId: markdown.node.nodeId,
      connections: [
        { id: 'dock-context-1', from: agentNodeId, to: markdown.node.nodeId, relation: 'wf-bridge', direction: 'bidirectional' },
      ],
    }],
    positions: {
      [agentNodeId]: { x: 100, y: 100 },
    },
  });
  return { registry, sessionId, subSessionId, agentNodeId, markdown: markdown.node.nodeId, timer: timer.node.nodeId, pack: pack.node.nodeId, goalNodeId };
}

function assertRefsCarryW38e(refs, label) {
  assert.ok(Array.isArray(refs), `${label} must be an array`);
  for (const ref of refs) {
    assert.equal(typeof ref.nodeId, 'string', `${label} ref nodeId`);
    assert.equal(typeof ref.title, 'string', `${label} ref title (${ref.nodeId})`);
    assert.equal(typeof ref.shortId, 'string', `${label} ref shortId (${ref.nodeId})`);
    assert.ok(ref.shortId.length > 0, `${label} ref shortId non-empty (${ref.nodeId})`);
    assert.equal(typeof ref.displayName, 'string', `${label} ref displayName (${ref.nodeId})`);
    assert.ok(ref.displayName.length > 0, `${label} ref displayName non-empty (${ref.nodeId})`);
  }
}

test('API path and snapshot path produce identical Agent context fields and values', async () => {
  const root = makeProject();
  try {
    const fixture = await seedGraphFixture(root);
    const graph = loadWorkflowGraphMap(root);
    const graphNode = findAgentGraphNode(graph, fixture.agentNodeId);
    assert.ok(graphNode, 'agent node must be present in the workflow graph');

    const api = buildAgentContext(root, graphNode, graph);
    assert.equal(api.ok, true);
    assert.equal(api.node.kind, 'agent');
    const apiContext = api.context;

    const workflow = buildWorkflowSnapshot(root, fixture.registry);
    const snapContext = workflow.graphContextBySessionId[fixture.sessionId];
    assert.ok(snapContext, 'snapshot must expose per-session graph context');

    // 1. Field parity: every API field exists in the snapshot path...
    const apiKeys = Object.keys(apiContext);
    const snapKeys = Object.keys(snapContext);
    for (const key of apiKeys) {
      assert.ok(Object.hasOwn(snapContext, key), `snapshot context is missing API field: ${key}`);
    }
    // ...and the snapshot path only adds its session-enumeration extras.
    const extras = snapKeys.filter(key => !apiKeys.includes(key)).sort();
    assert.deepEqual(extras, SNAPSHOT_ONLY_KEYS, `snapshot extras leaked: ${extras.join(',')}`);

    // 2. Value parity: every shared field has identical values.
    for (const key of apiKeys) {
      assert.deepEqual(apiContext[key], snapContext[key], `value drift on context field: ${key}`);
    }

    // 3. The W39 drift fields are present in BOTH paths.
    for (const key of DRIFT_FIELDS) {
      assert.ok(Object.hasOwn(apiContext, key), `API context missing drift field: ${key}`);
      assert.ok(Object.hasOwn(snapContext, key), `snapshot context missing drift field: ${key}`);
    }

    // 4. The snapshot extras keep their contract values (session enumeration;
    // edges to non-session nodes contribute null session ids, as before W40-C1).
    assert.equal(snapContext.agentKind, 'main');
    assert.equal(snapContext.parentAgentId, null);
    assert.ok(snapContext.connectedPeerIds.includes(fixture.subSessionId), 'connectedPeerIds must include the subagent session');
    assert.ok(snapContext.outboundPeerIds.includes(fixture.subSessionId), 'outboundPeerIds must include the subagent session');
    assert.ok(!snapContext.inboundPeerIds.includes(fixture.subSessionId), 'main agent has no inbound session edges');
    const subContext = workflow.graphContextBySessionId[fixture.subSessionId];
    assert.ok(subContext, 'snapshot must expose subagent context');
    assert.equal(subContext.parentAgentId, fixture.sessionId, 'subagent parentAgentId must resolve to the main session');
    assert.ok(subContext.connectedPeerIds.includes(fixture.sessionId), 'subagent connectedPeerIds must include the main session');

    // 5. Specific drift-field content (both paths).
    for (const context of [apiContext, snapContext]) {
      assert.ok(context.defaultSkills.includes('workflow-ontology'), 'defaultSkills must include workflow-ontology');
      assert.equal(context.ontology.ontologyId, 'harness.workflow.ontology');
      assert.ok(Array.isArray(context.affordances), 'affordances must be an array');
      assert.ok(context.affordances.length > 0, 'affordances must be non-empty');
      assert.ok(context.availableActions.includes('agent.sendInput'), 'availableActions must include agent.sendInput');
      assert.ok(context.availableActions.includes('agent.createNode'), 'availableActions must include agent graph capabilities');
      assert.ok(context.skillTriggers['workflow-node-actions'].includes('draw flowchart'), 'skillTriggers must carry canonical triggers');
      assert.equal(context.skillPolicy, 'auto', 'skillPolicy must come from normalized node config');
      assert.deepEqual(context.outputRouting.markdownDefault, {
        enabled: false,
        explicitTargetNodeId: '',
        resolvedTargetNodeId: '',
        resolution: 'disabled',
      });
      assert.ok(context.magneticTopology.groupCount >= 1, 'magnetic topology must have a group');
      assert.equal(context.magneticTopology.dockLinkCount, 1);
      assert.equal(typeof context.magneticGroupId, 'string');
      assert.ok(context.magneticGroupId.length > 0, 'agent must belong to a magnetic group');
      assert.ok(context.directMagneticNeighbors.includes(fixture.markdown), 'markdown must be a direct magnetic neighbor');
      assert.ok(context.magneticReachableNodes.includes(fixture.markdown), 'markdown must be magnetically reachable');
      assert.equal(context.identity.isMainAgent, true);
      assert.equal(context.workspace.kind, 'agent-node-home');
      assert.equal(context.graphVersion, 7);
    }

    // 6. Connected refs carry shortId + displayName + title (W38e) in both paths.
    for (const context of [apiContext, snapContext]) {
      assertRefsCarryW38e(context.connectedResourceRefs, 'connectedResourceRefs');
      assertRefsCarryW38e(context.connectedEventRefs, 'connectedEventRefs');
      assertRefsCarryW38e(context.connectedCapabilityRefs, 'connectedCapabilityRefs');
      assertRefsCarryW38e(context.connectedGoalRefs, 'connectedGoalRefs');
      assertRefsCarryW38e(context.connectedCapabilityNodeRefs, 'connectedCapabilityNodeRefs');
    }

    // 7. Timer control affordance resolves through the control edge (both paths).
    for (const context of [apiContext, snapContext]) {
      const timerRef = context.connectedEventRefs.find(ref => ref.type === 'timer');
      assert.ok(timerRef, 'timer event ref must be connected');
      assert.equal(timerRef.canControl, true, 'control edge must grant timer control');
      assert.ok(timerRef.allowedActions.includes('timer.configure'), 'timer control actions must be allowed');
      assert.equal(timerRef.connection.relation, 'event');
    }

    // 8. Goal and capability refs resolve (both paths).
    for (const context of [apiContext, snapContext]) {
      assert.ok(context.connectedGoalRefs.some(ref => ref.nodeId === fixture.goalNodeId && ref.type === 'goal'), 'goal ref must resolve');
      assert.ok(context.connectedCapabilityNodeRefs.some(ref => ref.nodeId === fixture.pack && ref.capabilityKind === 'skill-group'), 'skill-group ref must resolve');
    }

    // 9. effectiveSkillGroups carry skillRefs with enabled (W38-BE-FOLLOWUP, both paths).
    for (const context of [apiContext, snapContext]) {
      assert.equal(context.effectiveSkillGroups.length, 1);
      const group = context.effectiveSkillGroups[0];
      assert.equal(group.nodeId, fixture.pack);
      assert.equal(group.label, 'Workflow');
      assert.deepEqual(group.skillNames, ['wf-ui', 'browser-lab']);
      for (const skillRef of group.skillRefs) {
        assert.equal(skillRef.enabled, true, `skill ${skillRef.name} must default to enabled:true`);
        assert.deepEqual(Object.keys(skillRef).sort(), ['enabled', 'id', 'name', 'source', 'state', 'title']);
      }
      assert.ok(context.effectiveSkills.includes('wf-ui'), 'connected skill names must feed effectiveSkills');
      assert.ok(context.effectiveSkills.includes('browser-lab'), 'connected skill names must feed effectiveSkills');
    }

    // 10. connectedPeers enumerates every non-agent peer in both paths
    // (timer appears once per event/control edge; the capsule dock duplicates
    // the markdown edge — dedupe by node id for the peer-set assertion).
    for (const context of [apiContext, snapContext]) {
      const peerIds = [...new Set(context.connectedPeers.map(peer => peer.nodeId))].sort();
      assert.deepEqual(peerIds, [fixture.goalNodeId, fixture.markdown, fixture.pack, fixture.timer].sort());
      const goalPeer = context.connectedPeers.find(peer => peer.nodeId === fixture.goalNodeId);
      assert.equal(goalPeer.type, 'goal');
      assert.equal(typeof goalPeer.shortId, 'string');
      assert.equal(typeof goalPeer.displayName, 'string');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sub-builders are independently importable and produce the canonical shapes', async () => {
  const root = makeProject();
  try {
    const fixture = await seedGraphFixture(root);
    const graph = loadWorkflowGraphMap(root);
    const graphNode = findAgentGraphNode(graph, fixture.agentNodeId);
    const nodeId = fixture.agentNodeId;

    const resourceRefs = buildConnectedResourceRefs(root, nodeId, graph);
    assert.ok(resourceRefs.some(ref => ref.nodeId === fixture.markdown));
    const eventRefs = buildConnectedEventRefs(root, nodeId, graph);
    assert.ok(eventRefs.some(ref => ref.nodeId === fixture.timer));
    const capabilityRefs = buildConnectedCapabilityRefs(root, nodeId, graph);
    assert.ok(capabilityRefs.some(ref => ref.nodeId === fixture.pack));
    const goalRefs = buildConnectedGoalRefs(root, nodeId, graph);
    assert.ok(goalRefs.some(ref => ref.nodeId === fixture.goalNodeId));
    const agentRefs = buildConnectedAgentRefs(root, nodeId, graph, { isMainAgent: true });
    assert.deepEqual(agentRefs, []);
    const connections = buildConnections(nodeId, graph);
    assert.equal(connections.length, 6); // 5 edges + 1 capsule-dock connection
    assert.ok(effectiveSkillGroupsFor(capabilityRefs).length >= 1);
    assert.ok(Object.keys(skillTriggersFor(['workflow-ontology'])).includes('workflow-ontology'));
    assert.deepEqual(outputRoutingFor({ values: {} }, resourceRefs).markdownDefault.resolution, 'disabled');
    const snapshot = buildAgentSnapshot(root, graphNode, graph);
    assert.equal(snapshot.kind, 'agent');
    assert.equal(snapshot.sessionId, fixture.sessionId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
