import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import { registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) {
    const item = cleanup.pop();
    if (item.sessionIds) {
      for (const sessionId of item.sessionIds) unregisterPtyProcess(sessionId);
    }
    if (item.server) await stopServer(item.server);
    if (item.root) fs.rmSync(item.root, { recursive: true, force: true });
  }
});

async function makeServer() {
  const root = makeHarnessTempRoot('wf-node-config-api-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks', 'task-alpha'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'PROGRESS.md'), '## Active Task\n\n- task-alpha\n');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', 'task-alpha', 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId: 'task-alpha',
    status: 'active',
    mode: 'wf-max',
    phase: 'implementation',
    acceptance: [{ id: 'AC-005', text: 'node settings', status: 'pending' }],
    links: { dependsOn: [], blocks: [] },
  }, null, 2));

  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  cleanup.push({ root, server: started.server, sessionIds: [] });
  return { ...started, root, registry, baseUrl: `http://127.0.0.1:${started.port}` };
}

function requestJson(baseUrl, token, method, route, payload) {
  const url = new URL(route, baseUrl);
  const body = payload === undefined ? null : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(responseBody) }); }
        catch { resolve({ status: res.statusCode, body: responseBody }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function getJson(baseUrl, token, route) {
  return requestJson(baseUrl, token, 'GET', route);
}

function patchJson(baseUrl, token, route, payload) {
  return requestJson(baseUrl, token, 'PATCH', route, payload);
}

function postJson(baseUrl, token, route, payload) {
  return requestJson(baseUrl, token, 'POST', route, payload);
}

function createTerminalNode(registry, root, overrides = {}) {
  const nodeConfig = overrides.nodeConfig || {
    role: 'main',
    customRole: '',
    prompt: 'Coordinate the workflow map.',
    model: 'gpt-5-default',
    provider: 'openai',
    cwd: root,
    env: {},
    permissions: { sandboxMode: 'workspace-write' },
    launchPolicy: { restart: 'manual' },
    skills: [],
    skillPolicy: 'auto',
    contextSources: ['workflow-map'],
    capabilities: ['terminal'],
  };
  const session = registry.create({
    runtime: overrides.runtime || 'codex',
    agentKind: overrides.agentKind || 'main',
    role: nodeConfig.role,
    prompt: nodeConfig.prompt,
    model: nodeConfig.model,
    provider: nodeConfig.provider,
    cwd: nodeConfig.cwd,
    env: nodeConfig.env,
    permissions: nodeConfig.permissions,
    launchPolicy: nodeConfig.launchPolicy,
    taskId: 'task-alpha',
    projectRoot: root,
    nodeConfig,
    restartRequired: false,
    restartRequiredFields: [],
  });
  registry.update(session.sessionId, {
    status: overrides.status || 'running',
    ptySessionId: session.sessionId,
  });
  cleanup.at(-1).sessionIds.push(session.sessionId);
  registerPtyProcess(session.sessionId, { write: () => {} });
  return { session: registry.get(session.sessionId), nodeId: `session-${session.sessionId}` };
}

function assertIncludesAll(actual, expected, label) {
  assert.ok(Array.isArray(actual), `${label} should be an array`);
  for (const item of expected) {
    assert.ok(actual.includes(item), `${label} should include ${item}`);
  }
}

function assertNodeConfig(node, expected) {
  assert.ok(node.config, 'terminal-session node should expose config');
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(node.config[key], value, `node.config.${key}`);
  }
}

test('AC-005 PATCH /api/a2a/nodes/:nodeId/config persists launch config and snapshot restart metadata', async () => {
  const { baseUrl, token, root, registry } = await makeServer();
  const { nodeId, session } = createTerminalNode(registry, root);
  const patch = {
    role: 'frontend-worker',
    customRole: 'React workflow specialist',
    prompt: 'Implement the workflow node settings UI from AC-005.',
    model: 'gpt-5-node-settings',
    provider: 'openai',
    cwd: 'src/ui',
    env: { NODE_ENV: 'development', WF_UI: '1' },
    permissions: { fileSystem: 'workspace-write', network: 'enabled' },
    launchPolicy: { restart: 'manual', approvalPolicy: 'never' },
    skills: ['tdd', 'wf-browser'],
    skillPolicy: 'manual',
    contextSources: ['workflow-map', 'selected-files', 'terminal-transcript'],
    capabilities: ['terminal', 'file-ops', 'browser'],
  };

  const result = await patchJson(baseUrl, token, `/api/a2a/nodes/${nodeId}/config`, patch);

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.node.id, nodeId);
  assert.equal(result.body.node.sessionId, session.sessionId);
  assertNodeConfig(result.body.node, patch);
  assert.equal(result.body.restartRequired, true);
  assert.equal(result.body.node.restartRequired, true);
  assertIncludesAll(result.body.restartRequiredFields, [
    'role',
    'prompt',
    'model',
    'provider',
    'cwd',
    'env',
    'permissions',
    'launchPolicy',
  ], 'restartRequiredFields');
  assert.ok(!result.body.restartRequiredFields.includes('skills'));
  assert.equal(typeof result.body.revision, 'number');

  const snapshot = await getJson(baseUrl, token, '/api/a2a/snapshot?fresh=1');
  assert.equal(snapshot.status, 200);
  const snapshotNode = snapshot.body.nodes.find(node => node.id === nodeId);
  assert.ok(snapshotNode, 'snapshot should include edited terminal node');
  assertNodeConfig(snapshotNode, patch);
  assert.equal(snapshotNode.restartRequired, true);
  assertIncludesAll(snapshotNode.restartRequiredFields, result.body.restartRequiredFields, 'snapshot restartRequiredFields');
});

test('AC-005 non-launch metadata hot edit updates snapshot without requiring restart', async () => {
  const { baseUrl, token, root, registry } = await makeServer();
  const { nodeId } = createTerminalNode(registry, root, {
    nodeConfig: {
      role: 'backend-worker',
      customRole: '',
      prompt: 'Implement backend APIs.',
      model: 'gpt-5-backend',
      provider: 'openai',
      cwd: root,
      env: { NODE_ENV: 'test' },
      permissions: { fileSystem: 'workspace-write' },
      launchPolicy: { restart: 'manual' },
      skills: ['tdd'],
      skillPolicy: 'manual',
      contextSources: ['workflow-map'],
      capabilities: ['terminal'],
    },
  });
  const patch = {
    customRole: 'Temporary label for the UI only',
    skills: ['tdd', 'wf-review'],
    skillPolicy: 'manual',
    contextSources: ['workflow-map', 'terminal-transcript', 'selected-files'],
    capabilities: ['terminal', 'review-only'],
  };

  const result = await patchJson(baseUrl, token, `/api/a2a/nodes/${nodeId}/config`, patch);

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.restartRequired, false);
  assert.deepEqual(result.body.restartRequiredFields, []);
  assertNodeConfig(result.body.node, patch);

  const snapshot = await getJson(baseUrl, token, '/api/a2a/snapshot?fresh=1');
  assert.equal(snapshot.status, 200);
  const snapshotNode = snapshot.body.nodes.find(node => node.id === nodeId);
  assertNodeConfig(snapshotNode, patch);
  assert.equal(snapshotNode.restartRequired, false);
  assert.deepEqual(snapshotNode.restartRequiredFields, []);
});

test('AC-004 node config persists Markdown default output routing without requiring restart', async () => {
  const { baseUrl, token, root, registry } = await makeServer();
  const { nodeId } = createTerminalNode(registry, root);

  const result = await patchJson(baseUrl, token, `/api/a2a/nodes/${nodeId}/config`, {
    outputRouting: {
      markdownDefaultEnabled: true,
      markdownTargetNodeId: 'component-notes-earliest',
      fallback: 'oldest-connected-markdown',
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.restartRequired, false);
  assert.deepEqual(result.body.restartRequiredFields, []);
  assert.deepEqual(result.body.node.config.outputRouting, {
    markdownDefaultEnabled: true,
    markdownTargetNodeId: 'component-notes-earliest',
    fallback: 'oldest-connected-markdown',
  });

  const snapshot = await getJson(baseUrl, token, '/api/a2a/snapshot?fresh=1');
  assert.equal(snapshot.status, 200);
  const snapshotNode = snapshot.body.nodes.find(node => node.id === nodeId);
  assert.deepEqual(snapshotNode.config.outputRouting, result.body.node.config.outputRouting);
});

test('AC-005 skillPolicy auto/manual/locked recommends, preserves, and blocks automatic overwrite', async () => {
  const { baseUrl, token, root, registry } = await makeServer();
  const { nodeId: autoNodeId } = createTerminalNode(registry, root);
  const { nodeId: manualNodeId } = createTerminalNode(registry, root);
  const { nodeId: lockedNodeId } = createTerminalNode(registry, root);

  const auto = await patchJson(baseUrl, token, `/api/a2a/nodes/${autoNodeId}/config`, {
    role: 'backend-worker',
    prompt: 'Write M2 RED backend tests for node settings.',
    skillPolicy: 'auto',
  });

  assert.equal(auto.status, 200);
  assert.equal(auto.body.node.config.skillPolicy, 'auto');
  assertIncludesAll(auto.body.node.config.skills, ['tdd'], 'auto skills');
  assertIncludesAll(auto.body.recommendedSkills, ['tdd'], 'recommendedSkills');
  assert.ok(auto.body.recommendationReason);

  const manual = await patchJson(baseUrl, token, `/api/a2a/nodes/${manualNodeId}/config`, {
    skillPolicy: 'manual',
    skills: ['wf-review'],
  });

  assert.equal(manual.status, 200);
  assert.equal(manual.body.node.config.skillPolicy, 'manual');
  assert.deepEqual(manual.body.node.config.skills, ['wf-review']);
  assert.equal(manual.body.restartRequired, false);

  const locked = await patchJson(baseUrl, token, `/api/a2a/nodes/${lockedNodeId}/config`, {
    skillPolicy: 'locked',
    skills: ['wf-review', 'tdd'],
  });

  assert.equal(locked.status, 200);
  assert.deepEqual(locked.body.node.config.skills, ['wf-review', 'tdd']);
  assert.equal(locked.body.node.config.skillPolicy, 'locked');

  const rejectedAuto = await patchJson(baseUrl, token, `/api/a2a/nodes/${lockedNodeId}/config`, {
    skillPolicy: 'auto',
  });

  assert.equal(rejectedAuto.status, 409);
  assert.equal(rejectedAuto.body.error.code, 'LOCKED_CONFIG');

  const snapshot = await getJson(baseUrl, token, '/api/a2a/snapshot?fresh=1');
  assert.equal(snapshot.status, 200);
  const snapshotNode = snapshot.body.nodes.find(node => node.id === lockedNodeId);
  assert.equal(snapshotNode.config.skillPolicy, 'locked');
  assert.deepEqual(snapshotNode.config.skills, ['wf-review', 'tdd']);
});

test('AC-005 POST /api/a2a/nodes/:nodeId/restart uses latest config and preserves graph node id', async () => {
  const { baseUrl, token, root, registry } = await makeServer();
  const { nodeId, session } = createTerminalNode(registry, root);
  const patch = {
    role: 'verifier',
    prompt: 'Run the CDP full-regression matrix before final acceptance.',
    model: 'gpt-5-verifier',
    provider: 'openai',
    cwd: root,
    env: { WF_VERIFY: '1' },
    permissions: { browser: 'enabled', fileSystem: 'read-only' },
    launchPolicy: { restart: 'manual', approvalPolicy: 'never' },
    skillPolicy: 'auto',
  };

  const edited = await patchJson(baseUrl, token, `/api/a2a/nodes/${nodeId}/config`, patch);
  assert.equal(edited.status, 200);
  assert.equal(edited.body.restartRequired, true);

  const restarted = await postJson(baseUrl, token, `/api/a2a/nodes/${nodeId}/restart`, {});

  assert.equal(restarted.status, 200);
  assert.equal(restarted.body.ok, true);
  assert.equal(restarted.body.previousSessionId, session.sessionId);
  assert.equal(restarted.body.node.id, nodeId);
  assert.equal(restarted.body.node.sessionId, restarted.body.sessionId);
  assert.notEqual(restarted.body.sessionId, session.sessionId);
  assertNodeConfig(restarted.body.node, patch);
  assertIncludesAll(restarted.body.node.config.skills, ['wf-browser'], 'verifier auto skills');
  assert.equal(restarted.body.node.restartRequired, false);
  assert.deepEqual(restarted.body.node.restartRequiredFields, []);
  assert.ok(['starting', 'running', 'blocked'].includes(restarted.body.node.status));

  const snapshot = await getJson(baseUrl, token, '/api/a2a/snapshot?fresh=1');
  assert.equal(snapshot.status, 200);
  const nodesWithId = snapshot.body.nodes.filter(node => node.id === nodeId);
  assert.equal(nodesWithId.length, 1, 'restart should preserve one graph node id');
  assert.equal(nodesWithId[0].sessionId, restarted.body.sessionId);
  assert.equal(nodesWithId[0].restartRequired, false);
});

test('AC-005 existing node start path keeps working with persisted latest config', async () => {
  const { baseUrl, token, root, registry } = await makeServer();
  const { nodeId, session } = createTerminalNode(registry, root, { status: 'stopped' });
  const patch = {
    role: 'reviewer',
    prompt: 'Review the M2 implementation against AC-005.',
    model: 'gpt-5-reviewer',
    provider: 'openai',
    cwd: root,
    env: { WF_REVIEW: '1' },
    permissions: { fileSystem: 'read-only' },
    launchPolicy: { restart: 'manual' },
    skills: ['wf-review'],
    skillPolicy: 'manual',
    contextSources: ['workflow-map'],
    capabilities: ['review-only'],
  };
  const edited = await patchJson(baseUrl, token, `/api/a2a/nodes/${nodeId}/config`, patch);
  assert.equal(edited.status, 200);

  const started = await postJson(baseUrl, token, `/api/a2a/nodes/${nodeId}/start`, {});

  assert.equal(started.status, 200);
  assert.equal(started.body.ok, true);
  assert.equal(started.body.node.id, nodeId);
  assert.notEqual(started.body.started.sessionId, session.sessionId);
  assertNodeConfig(started.body.node, patch);
  assert.equal(started.body.node.restartRequired, false);
  assert.ok(['starting', 'running', 'blocked'].includes(started.body.node.status));
});
