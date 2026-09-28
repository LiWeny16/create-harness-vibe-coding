import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) {
    const item = cleanup.pop();
    if (item.server) await stopServer(item.server);
    if (item.root) fs.rmSync(item.root, { recursive: true, force: true });
  }
});

async function makeServer() {
  const root = makeHarnessTempRoot('wf-agent-billboard-');
  const taskRoot = path.join(root, 'Harness', 'tasks', 'task-agent-billboard-context');
  fs.mkdirSync(taskRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'PROGRESS.md'), '# Progress\n\n## Active Task\n\n- task-agent-billboard-context\n');
  fs.writeFileSync(path.join(taskRoot, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId: 'task-agent-billboard-context',
    status: 'active',
    mode: 'wf',
    phase: 'red',
    acceptance: [],
    links: { dependsOn: [], blocks: [] },
  }, null, 2));

  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  cleanup.push({ root, server: started.server });
  return { root, registry, baseUrl: `http://127.0.0.1:${started.port}`, token: started.token };
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

function postJson(baseUrl, token, route, payload) {
  return requestJson(baseUrl, token, 'POST', route, payload);
}

function putJson(baseUrl, token, route, payload) {
  return requestJson(baseUrl, token, 'PUT', route, payload);
}

async function createMarkdownResource(server, { title, markdown = '', presentation }) {
  return postJson(server.baseUrl, server.token, '/api/a2a/component-nodes', {
    type: 'markdown',
    ...(presentation ? { presentation } : {}),
    title,
    position: { x: 160, y: 120 },
    markdown,
  });
}

function markdownAction(server, nodeId, action, payload = {}) {
  return postJson(
    server.baseUrl,
    server.token,
    `/api/workflow/nodes/${encodeURIComponent(nodeId)}/actions/${action}`,
    payload,
  );
}

function agentGraphNode(session, position) {
  return {
    nodeId: session.graphNodeId,
    sessionId: session.sessionId,
    kind: 'terminal-session',
    agentKind: session.agentKind,
    runtime: session.runtime,
    status: 'running',
    role: session.role,
    cwd: session.cwd,
    position,
  };
}

test('AC-001 Billboard is a Markdown resource using the normal Markdown state, revisions, locks, and actions', async () => {
  const server = await makeServer();
  const normal = await createMarkdownResource(server, { title: 'Normal notes', markdown: 'normal seed\n' });
  const billboard = await createMarkdownResource(server, {
    title: 'Team Billboard',
    markdown: 'billboard seed\n',
    presentation: 'billboard',
  });

  assert.equal(normal.status, 201, JSON.stringify(normal.body));
  assert.equal(billboard.status, 201, JSON.stringify(billboard.body));
  assert.equal(normal.body.node.type, 'markdown');
  assert.equal(billboard.body.node.type, 'markdown');
  assert.equal(billboard.body.node.presentation, 'billboard');
  assert.equal(billboard.body.state.type, 'markdown');
  assert.equal(billboard.body.state.markdown, 'billboard seed\n');
  assert.match(billboard.body.node.statePath.replace(/\\/g, '/'), /^Harness\/a2a\/component-nodes\/[^/]+\/state\.json$/);
  assert.deepEqual(billboard.body.node.config, {
    componentType: 'markdown',
    editable: true,
    backendSourceOfTruth: true,
  });

  const normalRead = await markdownAction(server, normal.body.node.nodeId, 'markdown.read');
  const billboardRead = await markdownAction(server, billboard.body.node.nodeId, 'markdown.read');
  for (const read of [normalRead, billboardRead]) {
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.equal(read.body.action, 'markdown.read');
    assert.equal(typeof read.body.result.markdown, 'string');
    assert.equal(read.body.result.title, read === normalRead ? 'Normal notes' : 'Team Billboard');
    assert.equal(read.body.result.revision, 1);
  }

  const append = await markdownAction(server, billboard.body.node.nodeId, 'markdown.append', {
    markdown: '- agent-a/Agent A tried markdown.append; result: append succeeded. avoid: replacing the shared board. recommend: use the append action.\n',
    expectedRevision: billboardRead.body.result.revision,
  });
  assert.equal(append.status, 200, JSON.stringify(append.body));
  assert.equal(append.body.action, 'markdown.append');
  assert.equal(append.body.result.revision, 2);
  assert.match(append.body.result.markdown, /agent-a\/Agent A tried markdown\.append; result: append succeeded/);

  const stale = await markdownAction(server, billboard.body.node.nodeId, 'markdown.append', {
    markdown: '- stale write\n',
    expectedRevision: 1,
  });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.error.code, 'markdown_conflict');
  assert.equal(stale.body.currentRevision, 2);
  assert.equal(stale.body.expectedRevision, 1);

  const normalLock = await markdownAction(server, normal.body.node.nodeId, 'markdown.acquireLock', {
    lockOwner: 'agent-lock-holder',
    ttlSeconds: 30,
  });
  const billboardLock = await markdownAction(server, billboard.body.node.nodeId, 'markdown.acquireLock', {
    lockOwner: 'agent-lock-holder',
    ttlSeconds: 30,
  });
  for (const lock of [normalLock, billboardLock]) {
    assert.equal(lock.status, 200, JSON.stringify(lock.body));
    assert.ok(lock.body.result.lockId);
  }

  const normalLockedWrite = await markdownAction(server, normal.body.node.nodeId, 'markdown.append', {
    markdown: 'foreign write\n',
    lockOwner: 'agent-foreign-writer',
  });
  const billboardLockedWrite = await markdownAction(server, billboard.body.node.nodeId, 'markdown.append', {
    markdown: 'foreign write\n',
    lockOwner: 'agent-foreign-writer',
  });
  for (const locked of [normalLockedWrite, billboardLockedWrite]) {
    assert.equal(locked.status, 409, JSON.stringify(locked.body));
    assert.equal(locked.body.error.code, 'markdown_locked');
    assert.equal(locked.body.holder, 'agent-lock-holder');
  }

  const billboardOnlyAction = await markdownAction(server, billboard.body.node.nodeId, 'billboard.append', {
    markdown: '- must use markdown.append\n',
  });
  assert.notEqual(billboardOnlyAction.status, 200, 'there must be no Billboard-only action endpoint');
});

test('AC-002 shared-context Agents receive the same latest 20 Billboard lines and unconnected Agents receive none', async () => {
  const server = await makeServer();
  const billboard = await createMarkdownResource(server, {
    title: 'Shared findings',
    presentation: 'billboard',
  });
  assert.equal(billboard.status, 201, JSON.stringify(billboard.body));
  const nodeId = billboard.body.node.nodeId;

  const agents = ['agent-a', 'agent-b', 'agent-c'].map((graphNodeId, index) => {
    const session = server.registry.create({
      runtime: 'codex',
      agentKind: index === 0 ? 'main' : 'subagent',
      role: `Agent ${String.fromCharCode(65 + index)}`,
      graphNodeId,
    });
    server.registry.update(session.sessionId, { status: 'running' });
    return { ...session, graphNodeId, agentKind: index === 0 ? 'main' : 'subagent', role: `Agent ${String.fromCharCode(65 + index)}`, runtime: 'codex' };
  });

  const graphUpdate = await putJson(server.baseUrl, server.token, '/api/a2a/graph-map', {
    nodes: agents.map((agent, index) => agentGraphNode(agent, { x: 40 + (index * 220), y: 80 })),
    edges: [
      { id: 'edge-agent-a-billboard', from: 'agent-a', to: nodeId, relation: 'shared-context', direction: 'bidirectional', sourceHandle: 'context', targetHandle: 'markdown' },
      { id: 'edge-agent-b-billboard', from: 'agent-b', to: nodeId, relation: 'shared-context', direction: 'bidirectional', sourceHandle: 'context', targetHandle: 'markdown' },
    ],
  });
  assert.equal(graphUpdate.status, 200, JSON.stringify(graphUpdate.body));

  const sourceLines = Array.from({ length: 25 }, (_, index) => `finding-${String(index + 1).padStart(2, '0')}`);
  const appended = await markdownAction(server, nodeId, 'markdown.append', {
    markdown: `${sourceLines.slice(0, 5).join('\n')}\n\n${sourceLines.slice(5).join('\n')}\n`,
  });
  assert.equal(appended.status, 200, JSON.stringify(appended.body));

  const readContext = async agentId => getJson(
    server.baseUrl,
    server.token,
    `/api/workflow/context/${encodeURIComponent(agentId)}`,
  );
  const [contextA, contextB, contextC] = await Promise.all([
    readContext('agent-a'),
    readContext('agent-b'),
    readContext('agent-c'),
  ]);
  for (const response of [contextA, contextB, contextC]) {
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }

  const expectedProjection = {
    nodeId,
    title: 'Shared findings',
    revision: appended.body.result.revision,
    entries: sourceLines.slice(-20),
  };
  assert.deepEqual(contextA.body.context.sharedBillboards, [expectedProjection]);
  assert.deepEqual(contextB.body.context.sharedBillboards, [expectedProjection]);
  assert.deepEqual(contextA.body.context.sharedBillboards, contextB.body.context.sharedBillboards);
  assert.deepEqual(contextC.body.context.sharedBillboards, []);

  const nextNote = '- agent-b/Agent B tried a fresh reproduction; result: the failure is repeatable. recommend: keep the reproduction steps short.\n';
  const nextAppend = await markdownAction(server, nodeId, 'markdown.append', {
    markdown: nextNote,
    expectedRevision: appended.body.result.revision,
  });
  assert.equal(nextAppend.status, 200, JSON.stringify(nextAppend.body));
  const nextContext = await readContext('agent-a');
  assert.equal(nextContext.status, 200, JSON.stringify(nextContext.body));
  assert.deepEqual(nextContext.body.context.sharedBillboards, [{
    ...expectedProjection,
    revision: nextAppend.body.result.revision,
    entries: [...sourceLines.slice(-19), nextNote.trim()],
  }]);
});
