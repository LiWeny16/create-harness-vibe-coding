import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { SessionRegistry } from '../session-registry.mjs';
import {
  createRoleProfile,
  readRoleProfile,
  listRoleProfiles,
  roleProfileRefFor,
  profileSessionFields,
} from '../workflow-node-types/role-profile-store.mjs';
import { buildAgentContext, findAgentGraphNode } from '../workflow-agent-context.mjs';
import { loadWorkflowGraphMap, writeWorkflowGraphMap } from '../a2a-store.mjs';
import { createNode } from '../workflow-node-runtime.mjs';

const STATE_JSON_PROHIBITION = 'Never edit `Harness/a2a/**/state.json` directly — use typed actions.';

function makeProject() {
  const root = makeHarnessTempRoot('wf-role-profile-');
  fs.mkdirSync(path.join(root, 'Harness', 'a2a', 'skills'), { recursive: true });
  return root;
}

function seedAgentGraph(root, { nodeId, role = 'implementer' } = {}) {
  const registry = new SessionRegistry();
  const session = registry.create({
    runtime: 'claude',
    agentKind: 'subagent',
    role,
    graphNodeId: nodeId,
  });
  registry.update(session.sessionId, { status: 'running' });
  writeWorkflowGraphMap(root, {
    schemaVersion: 1,
    version: 1,
    nodes: [{
      nodeId,
      sessionId: session.sessionId,
      kind: 'terminal-session',
      agentKind: 'subagent',
      runtime: 'claude',
      role,
      label: role,
      status: 'running',
    }],
    edges: [],
    positions: {},
  });
  return { registry, session, nodeId };
}

// AC-001: create-agent writes role profile (ROLE-1). createRoleProfile writes
// the markdown profile file and returns the roleProfileRef; the session record
// carries displayName / roleTitle / responsibility / capabilities /
// roleProfileRef.
test('AC-001 createRoleProfile writes the .md profile and session record carries role identity', async () => {
  const root = makeProject();
  try {
    const nodeId = 'agent-role-1';
    const result = createRoleProfile({
      nodeId,
      roleTitle: 'implementer',
      displayName: 'Frontend Expert',
      responsibility: 'Implement UI changes inside the assigned write set; run typecheck and build; return evidence.',
      runtime: 'claude',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      capabilities: ['ui-control-plane', 'typescript', 'playwright'],
    }, root);

    assert.equal(result.roleProfileRef, roleProfileRefFor(nodeId), 'roleProfileRef must point at the markdown profile');
    assert.equal(result.profile.nodeId, nodeId);
    assert.equal(result.profile.roleTitle, 'implementer');
    assert.equal(result.profile.displayName, 'Frontend Expert');
    assert.equal(result.profile.roleProfileRef, result.roleProfileRef);
    assert.ok(Array.isArray(result.profile.capabilities), 'capabilities must be an array');

    const mdPath = path.join(root, 'Harness', 'a2a', 'agent-roles', `${nodeId}.md`);
    assert.ok(fs.existsSync(mdPath), '.md profile file must exist');
    const md = fs.readFileSync(mdPath, 'utf8');
    assert.ok(md.includes('# Role Profile'), '.md must be a markdown role profile');
    assert.ok(md.includes('Frontend Expert'), '.md must carry displayName');
    assert.ok(md.includes('implementer'), '.md must carry roleTitle');
    assert.ok(md.includes('Implement UI changes'), '.md must carry responsibility prose');

    const readBack = readRoleProfile(nodeId, root);
    assert.deepEqual(readBack, result.profile, 'readRoleProfile must return the stored profile');

    const listed = listRoleProfiles(root);
    assert.ok(listed.some(profile => profile.nodeId === nodeId), 'listRoleProfiles must include the profile');

    // Session record carries the role identity fields (create defaults first).
    const registry = new SessionRegistry();
    const session = registry.create({
      runtime: 'claude',
      agentKind: 'subagent',
      role: 'terminal-agent',
    });
    assert.equal(session.roleProfileRef, null, 'roleProfileRef must be null until a profile is written');
    assert.equal(session.responsibility, '', 'responsibility must default to empty');
    assert.equal(session.roleTitle, 'terminal-agent', 'legacy default roleTitle must remain terminal-agent');

    // Profile fields land on the session record through profileSessionFields.
    registry.update(session.sessionId, profileSessionFields(result.profile));
    const updated = registry.get(session.sessionId);
    assert.equal(updated.displayName, 'Frontend Expert');
    assert.equal(updated.roleTitle, 'implementer');
    assert.equal(updated.responsibility, result.profile.responsibility);
    assert.deepEqual(updated.capabilities, ['ui-control-plane', 'typescript', 'playwright']);
    assert.equal(updated.roleProfileRef, result.roleProfileRef);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// AC-002: agent init/context prompt strongly injects its own role profile
// (ROLE-2). buildAgentContext exposes the agent's own displayName, roleTitle,
// responsibility, capabilities and roleProfileRef path before any task text.
test('AC-002 agent context exposes its own role profile and roleProfileRef', async () => {
  const root = makeProject();
  try {
    const { nodeId } = seedAgentGraph(root, { nodeId: 'agent-role-2' });
    createRoleProfile({
      nodeId,
      roleTitle: 'reviewer',
      displayName: 'Code Reviewer',
      responsibility: 'Review the implementation and return evidence.',
      runtime: 'claude',
      provider: 'anthropic',
      capabilities: ['code-review'],
    }, root);

    const graph = loadWorkflowGraphMap(root);
    const graphNode = findAgentGraphNode(graph, nodeId);
    assert.ok(graphNode, 'agent node must be present in the workflow graph');

    const context = buildAgentContext(root, graphNode, graph).context;
    assert.equal(context.roleProfile.nodeId, nodeId);
    assert.equal(context.roleProfile.displayName, 'Code Reviewer');
    assert.equal(context.roleProfile.roleTitle, 'reviewer');
    assert.equal(context.roleProfile.responsibility, 'Review the implementation and return evidence.');
    assert.deepEqual(context.roleProfile.capabilities, ['code-review']);
    assert.equal(context.roleProfile.roleProfileRef, `Harness/a2a/agent-roles/${nodeId}.md`);
    assert.equal(context.identity.displayName, 'Code Reviewer');
    assert.equal(context.identity.roleTitle, 'reviewer');
    assert.equal(context.identity.responsibility, 'Review the implementation and return evidence.');
    assert.equal(context.identity.roleProfileRef, `Harness/a2a/agent-roles/${nodeId}.md`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// AC-021 (MANUAL-2): when an agent node is connected to a node, the connected
// node's manual is injected into the agent's context. AC-022 (MANUAL-3): the
// injected manual text carries the state.json prohibition verbatim.
test('AC-021/AC-022 connected node manual is injected into context with the state.json prohibition', async () => {
  const root = makeProject();
  try {
    const { nodeId } = seedAgentGraph(root, { nodeId: 'agent-role-3' });
    const markdown = await createNode(root, {
      type: 'markdown',
      title: 'Shared Notes',
      markdown: '# Notes',
    });
    const graphMap = loadWorkflowGraphMap(root);
    writeWorkflowGraphMap(root, {
      ...graphMap,
      edges: [
        { id: 'edge-role-md', from: nodeId, to: markdown.node.nodeId, relation: 'default-output', direction: 'bidirectional', sourceHandle: 'output', targetHandle: 'markdown' },
      ],
    });
    fs.writeFileSync(path.join(root, 'Harness', 'a2a', 'skills', 'workflow-markdown-node.json'), JSON.stringify({
      schemaVersion: 1,
      skillId: 'workflow-markdown-node',
      nodeType: 'markdown',
      description: 'Markdown node guide: shared durable notes between team agents.',
      commands: [
        {
          name: 'markdown-append',
          command: 'workflow-node-action --node <markdownNodeId> --action markdown.append --payload \'{"markdown":"..."}\'',
          description: 'Append text to the connected markdown node through typed actions.',
        },
      ],
      policy: { denied: ['direct-json-state-mutation'] },
      prohibitions: [STATE_JSON_PROHIBITION],
    }, null, 2));

    const graph = loadWorkflowGraphMap(root);
    const graphNode = findAgentGraphNode(graph, nodeId);
    const context = buildAgentContext(root, graphNode, graph).context;

    assert.ok(Array.isArray(context.connectedNodeManuals), 'connectedNodeManuals must be an array');
    const manual = context.connectedNodeManuals.find(item => item.nodeType === 'markdown');
    assert.ok(manual, 'connected markdown manual must be injected');
    assert.equal(manual.nodeId, markdown.node.nodeId);
    assert.equal(manual.skillId, 'workflow-markdown-node');
    assert.ok(manual.text.includes('Markdown node guide'), 'manual description must be injected');
    assert.ok(manual.text.includes('markdown.append'), 'manual commands must be injected');
    assert.ok(manual.text.includes(STATE_JSON_PROHIBITION), 'manual must carry the state.json prohibition verbatim (AC-022)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// AC-024 (partial) + T13/AC-008: the agent context carries the team-organization
// decision flow (steps 1-10) including the ask-user gate for ambiguous targets.
test('AC-024/T13 agent context carries team-organization guidance with the ask-user gate', async () => {
  const root = makeProject();
  try {
    const { nodeId } = seedAgentGraph(root, { nodeId: 'agent-role-4' });
    const graph = loadWorkflowGraphMap(root);
    const graphNode = findAgentGraphNode(graph, nodeId);
    const context = buildAgentContext(root, graphNode, graph).context;

    const guidance = context.teamGuidance;
    assert.ok(typeof guidance === 'string' && guidance.length > 0, 'teamGuidance must be a non-empty text block');
    // §2 step 1: understand the task.
    assert.ok(/understand the task/i.test(guidance), 'guidance must open with understanding the task');
    // §2 step 2: decide whether team collaboration is needed.
    assert.ok(/team collaboration is needed/i.test(guidance), 'guidance must include the team-needed decision (T1)');
    // §2 step 3: choose roles from the roleTitle vocabulary.
    assert.ok(/implementer/.test(guidance), 'guidance must name roles from the canonical vocabulary');
    // §2 step 7 / §4.4 (T13): ambiguous target -> ask the user, never blind create/connect.
    assert.ok(/ask the user/i.test(guidance), 'guidance must surface the ask-user gate for ambiguous targets (T13/AC-008)');
    assert.ok(/never blindly create or connect/i.test(guidance), 'guidance must forbid blind create/connect on ambiguity');
    // §2 steps 8-10: share context via Markdown, structured requests, Goal completion.
    assert.ok(/Markdown/i.test(guidance), 'guidance must mention Markdown node sharing');
    assert.ok(/Goal/i.test(guidance), 'guidance must mention Goal completion');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
