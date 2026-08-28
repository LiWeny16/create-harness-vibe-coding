import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { loadWorkflowGraphMap, writeWorkflowGraphMap } from '../a2a-store.mjs';
import { createNode } from '../workflow-node-runtime.mjs';
import { persistSession } from '../terminal-store.mjs';
import { registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import { createRoleProfile } from '../workflow-node-types/role-profile-store.mjs';

// ── Helpers ──
function seedRoot() {
  const root = makeHarnessTempRoot('wf-agent-routing-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

function seedActiveTask(root, taskId = 'task-routing-goal') {
  fs.mkdirSync(path.join(root, 'Harness', 'tasks', taskId), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'PROGRESS.md'), `# PROGRESS.md\n\n## Active Task\n\n- ${taskId}\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    title: 'Routing goal',
    nextAction: 'Route agents',
    acceptance: [],
    planItems: [],
    phase: 'implement',
  }));
  return `goal-${taskId}`;
}

function agentNode(nodeId, sessionId, agentKind = 'subagent', role = 'Agent', runtime = 'claude') {
  return {
    nodeId,
    sessionId,
    kind: 'terminal-session',
    runtime,
    agentKind,
    role,
    label: role,
    status: 'running',
  };
}

function persistAgentSession(root, session) {
  persistSession(root, {
    sessionId: session.sessionId,
    graphNodeId: session.nodeId,
    runtime: session.runtime || 'claude',
    agentKind: session.agentKind || 'subagent',
    role: session.role || session.roleTitle || 'Subagent',
    status: 'running',
    attachMode: true,
    taskId: null,
    ...(session.capabilities ? { capabilities: session.capabilities } : {}),
    ...(session.displayName ? { displayName: session.displayName } : {}),
    ...(session.roleTitle ? { roleTitle: session.roleTitle } : {}),
  });
}

function seedAgent(root, { nodeId, sessionId, roleTitle, displayName, agentKind = 'subagent', role, runtime = 'claude', provider = 'anthropic', capabilities = [] }) {
  const session = { nodeId, sessionId, roleTitle, displayName, agentKind, role: role || roleTitle, runtime, provider, capabilities };
  persistAgentSession(root, session);
  writeWorkflowGraphMap(root, {
    ...loadWorkflowGraphMap(root),
    version: loadWorkflowGraphMap(root).version + 1,
    nodes: [
      ...(loadWorkflowGraphMap(root).nodes || []).filter(node => (node.nodeId || node.id) !== nodeId),
      agentNode(nodeId, sessionId, agentKind, session.role, runtime),
    ],
  });
  createRoleProfile({
    nodeId,
    roleTitle,
    displayName: displayName || roleTitle,
    responsibility: `${roleTitle} agent for routing tests`,
    agentKind,
    runtime,
    provider,
    capabilities,
  }, root);
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
    const req = httpRequest(baseUrl, route, { method, body });
    req.on('response', (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

import http from 'node:http';
function httpRequest(baseUrl, route, { method = 'GET', body } = {}) {
  const url = new URL(route, baseUrl);
  const payload = body === undefined ? null : JSON.stringify(body);
  const req = http.request(url, {
    method,
    headers: payload ? { 'content-type': 'application/json' } : {},
  });
  return req;
}

function runNode(args, { cwd, env, timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${args.join(' ')}`));
    }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', status => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

// ── AC-005: find by role / runtime / provider / capability / title ──
test('AC-005 find-agent filters by role, runtime, provider, capability, title', async () => {
  const root = seedRoot();
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const base = `http://127.0.0.1:${started.port}`;
  try {
    seedAgent(root, { nodeId: 'agent-fe', sessionId: 'session-fe', roleTitle: 'implementer', displayName: 'Frontend Expert', capabilities: ['ui-control-plane', 'typescript'] });
    seedAgent(root, { nodeId: 'agent-rv', sessionId: 'session-rv', roleTitle: 'reviewer', displayName: 'Code Reviewer', runtime: 'codex', provider: 'openai', capabilities: ['test-runner'] });
    seedAgent(root, { nodeId: 'agent-ceo', sessionId: 'session-ceo', roleTitle: 'ceo', displayName: 'CEO', agentKind: 'main', capabilities: ['terminal-control'] });

    const byRole = await jsonRequest(base, '/api/workflow/agents/find?role=implementer');
    assert.equal(byRole.status, 200);
    assert.equal(byRole.body.count, 1);
    assert.equal(byRole.body.matches[0].nodeId, 'agent-fe');
    assert.equal(byRole.body.matches[0].roleTitle, 'implementer');
    assert.equal(byRole.body.matches[0].displayName, 'Frontend Expert');

    const byRuntime = await jsonRequest(base, '/api/workflow/agents/find?runtime=codex');
    assert.equal(byRuntime.body.count, 1);
    assert.equal(byRuntime.body.matches[0].nodeId, 'agent-rv');

    const byProvider = await jsonRequest(base, '/api/workflow/agents/find?provider=anthropic');
    assert.equal(byProvider.body.count, 2);
    assert.deepEqual(byProvider.body.matches.map(m => m.nodeId).sort(), ['agent-ceo', 'agent-fe']);

    const byCapability = await jsonRequest(base, '/api/workflow/agents/find?capability=typescript');
    assert.equal(byCapability.body.count, 1);
    assert.equal(byCapability.body.matches[0].nodeId, 'agent-fe');

    const byTitle = await jsonRequest(base, '/api/workflow/agents/find?title=reviewer');
    assert.equal(byTitle.body.count, 1);
    assert.equal(byTitle.body.matches[0].nodeId, 'agent-rv');

    // Canonical roleTitle match via synonym vocabulary
    const byCanonicalRole = await jsonRequest(base, '/api/workflow/agents/find?role=reviewer');
    assert.equal(byCanonicalRole.body.count, 1);
    assert.equal(byCanonicalRole.body.matches[0].nodeId, 'agent-rv');

    // Match shape per spec §4.1
    const match = byRole.body.matches[0];
    assert.ok(Array.isArray(match.capabilities));
    assert.ok(typeof match.connected === 'boolean');
    assert.ok(match.status);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC-006: single-match auto-connect creates a bidirectional edge ──
test('AC-006 auto-connect: exactly one match with from + autoConnect creates edge; no duplicate on repeat', async () => {
  const root = seedRoot();
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const base = `http://127.0.0.1:${started.port}`;
  try {
    seedAgent(root, { nodeId: 'agent-ceo', sessionId: 'session-ceo', roleTitle: 'ceo', displayName: 'CEO', agentKind: 'main', capabilities: ['terminal-control'] });
    seedAgent(root, { nodeId: 'agent-fe', sessionId: 'session-fe', roleTitle: 'implementer', displayName: 'Frontend Expert', capabilities: ['ui-control-plane'] });

    const connected = await jsonRequest(base, '/api/workflow/agents/find?role=implementer&from=agent-ceo&autoConnect=1');
    assert.equal(connected.status, 200);
    assert.equal(connected.body.decision, 'connect');
    assert.equal(connected.body.nodeId, 'agent-fe');
    assert.ok(connected.body.edge, 'auto-connect must return the created edge');

    const graph = loadWorkflowGraphMap(root);
    const edge = (graph.edges || []).find(e => (e.from === 'agent-ceo' && e.to === 'agent-fe') || (e.from === 'agent-fe' && e.to === 'agent-ceo'));
    assert.ok(edge, 'auto-connect must create the edge in the graph map');
    assert.equal(edge.relation, 'delegation');
    assert.equal(edge.direction, 'bidirectional');

    const again = await jsonRequest(base, '/api/workflow/agents/find?role=implementer&from=agent-ceo&autoConnect=1');
    assert.equal(again.body.decision, 'connect');
    assert.equal(again.body.nodeId, 'agent-fe');
    assert.ok(again.body.edge === null || again.body.edge === undefined, 'repeat auto-connect must not create a duplicate edge');
    const edgeCount = (loadWorkflowGraphMap(root).edges || []).filter(e => e.from === 'agent-ceo' || e.to === 'agent-ceo').length;
    assert.equal(edgeCount, 1);

    // Without from/autoConnect the find stays read-only
    const plain = await jsonRequest(base, '/api/workflow/agents/find?role=implementer');
    assert.equal(plain.body.decision, undefined);
    assert.equal(plain.body.matches[0].connected, true);
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC-007: no-match + clear task -> create-agent writes role profile ──
test('AC-007 create-agent writes role profile: session fields + markdown file; legacy create writes none', async () => {
  const root = seedRoot();
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const base = `http://127.0.0.1:${started.port}`;
  try {
    const created = await jsonRequest(base, '/api/sessions', {
      method: 'POST',
      body: {
        runtime: 'codex',
        agentKind: 'subagent',
        role: 'Subagent',
        roleTitle: 'data-expert',
        displayName: 'Data Expert',
        responsibility: 'Analyze the dataset inside the assigned write set.',
        capabilities: ['csv', 'sql'],
        objective: 'Data analysis task',
        deferPtySpawn: true,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const sessionId = created.body.sessionId;
    const nodeId = `session-${sessionId}`;

    const profileRes = await jsonRequest(base, `/api/workflow/agents/profile?nodeId=${encodeURIComponent(nodeId)}`);
    assert.equal(profileRes.status, 200);
    assert.ok(profileRes.body.profile, 'profile must be readable after create-agent');
    assert.equal(profileRes.body.profile.roleTitle, 'data-expert');
    assert.equal(profileRes.body.profile.displayName, 'Data Expert');
    assert.equal(profileRes.body.profile.agentKind, 'subagent');
    assert.deepEqual(profileRes.body.profile.capabilities, ['csv', 'sql']);
    assert.equal(profileRes.body.profile.roleProfileRef, `Harness/a2a/agent-roles/${nodeId}.md`);

    const mdPath = path.join(root, 'Harness', 'a2a', 'agent-roles', `${nodeId}.md`);
    assert.ok(fs.existsSync(mdPath), 'role profile markdown file must exist');

    // The created agent becomes findable by its free-form roleTitle
    const found = await jsonRequest(base, `/api/workflow/agents/find?role=data-expert`);
    assert.equal(found.body.count, 1);
    assert.equal(found.body.matches[0].nodeId, nodeId);
    assert.equal(found.body.matches[0].displayName, 'Data Expert');

    // Legacy create (no profile fields) must not write a profile file
    const legacy = await jsonRequest(base, '/api/sessions', {
      method: 'POST',
      body: { runtime: 'codex', agentKind: 'subagent', role: 'Subagent', objective: 'Legacy create', deferPtySpawn: true },
    });
    assert.equal(legacy.status, 201);
    const legacyNodeId = `session-${legacy.body.sessionId}`;
    assert.ok(!fs.existsSync(path.join(root, 'Harness', 'a2a', 'agent-roles', `${legacyNodeId}.md`)), 'legacy create must not write a role profile');
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC-015/T12: single-Goal-per-magnetic-group (backend) ──
test('AC-015/T12 second Goal in Timer+Agent magnetic group rejected with goal_already_bound; first Goal allowed', async () => {
  const root = seedRoot();
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const base = `http://127.0.0.1:${started.port}`;
  try {
    const goalNodeId = seedActiveTask(root);
    const timer = await createNode(root, { type: 'timer', title: 'Routing Timer' });
    const timerNodeId = timer.node.nodeId;
    seedAgent(root, { nodeId: 'agent-1', sessionId: 'session-1', roleTitle: 'implementer', displayName: 'Worker', capabilities: ['terminal'] });

    // Dock goal + timer + agent into one magnetic group
    writeWorkflowGraphMap(root, {
      ...loadWorkflowGraphMap(root),
      version: loadWorkflowGraphMap(root).version + 1,
      capsuleDockLinks: [
        dockLink(goalNodeId, timerNodeId),
        dockLink(timerNodeId, 'agent-1'),
      ],
    });

    // First Goal in the group is allowed
    const first = await jsonRequest(base, '/api/workflow/nodes', { method: 'POST', body: { type: 'goal' } });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.node.kind, 'goal');

    // Inject a second goal node into the same magnetic group
    writeWorkflowGraphMap(root, {
      ...loadWorkflowGraphMap(root),
      version: loadWorkflowGraphMap(root).version + 1,
      nodes: [
        ...(loadWorkflowGraphMap(root).nodes || []),
        { nodeId: 'goal-second', label: 'Second Goal' },
      ],
      capsuleDockLinks: [
        ...(loadWorkflowGraphMap(root).capsuleDockLinks || []),
        dockLink('agent-1', 'goal-second'),
      ],
    });

    // Creating a second Goal into the group is rejected with the spec §6.2 shape
    const second = await jsonRequest(base, '/api/workflow/nodes', { method: 'POST', body: { type: 'goal' } });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'goal_already_bound');
    assert.ok(second.body.message.includes('already has a Goal'), second.body.message);
    assert.equal(second.body.existingGoalNodeId, 'goal-second');
    assert.equal(second.body.timerNodeId, timerNodeId);

    // Connecting a Goal into the already-bound group is rejected too
    const connectGoal = await jsonRequest(base, '/api/workflow/edges', {
      method: 'POST',
      body: { from: 'agent-1', to: goalNodeId, relation: 'goal' },
    });
    assert.equal(connectGoal.status, 409);
    assert.equal(connectGoal.body.error, 'goal_already_bound');
  } finally {
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── CLI smoke: find-agent / agent-role-profile / send-agent-message --request-id ──
test('CLI find-agent, agent-role-profile, and send-agent-message --request-id wrap the routing API', async () => {
  const root = seedRoot();
  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
  const env = {
    ...process.env,
    HARNESS_PEER_SESSION_ID: 'session-ceo',
    HARNESS_WORKFLOW_NODE_ID: 'agent-ceo',
    HARNESS_AGENT_KIND: 'main',
    HARNESS_WF_UI_URL: `http://127.0.0.1:${started.port}`,
    HARNESS_WF_UI_TOKEN: started.token,
  };
  try {
    seedAgent(root, { nodeId: 'agent-ceo', sessionId: 'session-ceo', roleTitle: 'ceo', displayName: 'CEO', agentKind: 'main', capabilities: ['terminal-control'] });
    seedAgent(root, { nodeId: 'agent-fe', sessionId: 'session-fe', roleTitle: 'implementer', displayName: 'Frontend Expert', capabilities: ['ui-control-plane'] });
    writeWorkflowGraphMap(root, {
      ...loadWorkflowGraphMap(root),
      version: loadWorkflowGraphMap(root).version + 1,
      edges: [
        { id: 'edge-ceo-fe', from: 'agent-ceo', to: 'agent-fe', relation: 'delegation', direction: 'bidirectional' },
      ],
    });
    registerPtyProcess('session-fe', { write: () => {} });

    const find = await runNode([script, 'find-agent', '--role', 'implementer', '--project', root], { cwd: root, env });
    assert.equal(find.status, 0, find.stderr || find.stdout);
    const findBody = JSON.parse(find.stdout);
    assert.equal(findBody.count, 1);
    assert.equal(findBody.matches[0].nodeId, 'agent-fe');

    const profile = await runNode([script, 'agent-role-profile', '--node', 'agent-fe', '--project', root], { cwd: root, env });
    assert.equal(profile.status, 0, profile.stderr || profile.stdout);
    const profileBody = JSON.parse(profile.stdout);
    assert.equal(profileBody.profile.roleTitle, 'implementer');
    assert.equal(profileBody.profile.roleProfileRef, 'Harness/a2a/agent-roles/agent-fe.md');

    const msg = await runNode([
      script,
      'send-agent-message',
      '--to', 'agent-fe',
      '--text', 'ROUTING_REQ_1',
      '--request-id', 'req-routing-0001',
      '--thread-id', 'thread-routing-7',
      '--reply-to', 'msg-000',
      '--project', root,
    ], { cwd: root, env });
    assert.equal(msg.status, 0, msg.stderr || msg.stdout);
    const msgBody = JSON.parse(msg.stdout);
    assert.equal(msgBody.result.requestId, 'req-routing-0001');
    assert.equal(msgBody.result.threadId, 'thread-routing-7');
  } finally {
    unregisterPtyProcess('session-fe');
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
