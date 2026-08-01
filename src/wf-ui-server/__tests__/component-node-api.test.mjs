import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
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
  const root = makeHarnessTempRoot('wf-component-node-api-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks', 'task-alpha'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'PROGRESS.md'), '## Active Task\n\n- task-alpha\n');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', 'task-alpha', 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId: 'task-alpha',
    status: 'active',
    mode: 'wf-max',
    phase: 'implementation',
    acceptance: [{ id: 'AC-006', text: 'trusted component nodes', status: 'pending' }],
    links: { dependsOn: [], blocks: [] },
  }, null, 2));

  const registry = new SessionRegistry();
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  cleanup.push({ root, server: started.server });
  return { ...started, root, registry, baseUrl: `http://127.0.0.1:${started.port}` };
}

function requestJson(baseUrl, token, method, route, payload, options = {}) {
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
        ...(options.headers || {}),
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

function putJsonWithHeaders(baseUrl, token, route, payload, headers) {
  return requestJson(baseUrl, token, 'PUT', route, payload, { headers });
}

function assertSameStrings(actual, expected, message) {
  assert.deepEqual([...(actual || [])].sort(), [...expected].sort(), message);
}

function assertComponentNodeResponse(root, result, expected) {
  assert.equal(result.status, expected.status || 201);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.node.kind, 'component-node');
  assert.equal(result.body.node.type, expected.type);
  assert.equal(result.body.node.title, expected.title);
  assert.equal(result.body.node.id, result.body.node.nodeId);
  assert.match(result.body.node.nodeId, /^component-[a-z0-9][a-z0-9-]*$/);
  assert.deepEqual(result.body.node.position, expected.position);
  assert.equal(result.body.node.revision, expected.revision || 1);
  assert.equal(path.isAbsolute(result.body.node.statePath), false);
  assert.match(result.body.node.statePath.replace(/\\/g, '/'), /^Harness\/a2a\/component-nodes\/[^/]+\/state\.json$/);
  assert.deepEqual(result.body.node.stateRef, {
    path: result.body.node.statePath,
    revision: result.body.node.revision,
  });
  assert.deepEqual(result.body.node.config, {
    componentType: expected.type,
    editable: true,
    backendSourceOfTruth: true,
  });
  assert.ok(fs.existsSync(path.join(root, result.body.node.statePath)), 'state file should exist on disk');
}

test('AC-006 POST /api/a2a/component-nodes creates markdown and excalidraw nodes with backend-owned state files', async () => {
  const { root, baseUrl, token } = await makeServer();
  const markdown = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'markdown',
    title: 'M3 Notes',
    position: { x: 120, y: 80 },
    markdown: '# M3\n\nBackend source of truth.\n',
  });
  const excalidrawScene = {
    elements: [{ id: 'box-1', type: 'rectangle', x: 10, y: 20, width: 100, height: 60, versionNonce: 1 }],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  };
  const excalidraw = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'excalidraw',
    title: 'M3 Diagram',
    position: { x: 420, y: 80 },
    scene: excalidrawScene,
  });

  assertComponentNodeResponse(root, markdown, {
    type: 'markdown',
    title: 'M3 Notes',
    position: { x: 120, y: 80 },
  });
  assert.equal(markdown.body.state.type, 'markdown');
  assert.equal(markdown.body.state.markdown, '# M3\n\nBackend source of truth.\n');
  assert.deepEqual(markdown.body.state.uiContract, {
    editor: 'markdown',
    modes: ['wysiwyg', 'source'],
    defaultMode: 'wysiwyg',
  });
  assert.ok(markdown.body.state.inputs.some(input => input.id === 'markdown' && input.type === 'markdown'));
  assert.ok(markdown.body.state.outputs.some(output => output.id === 'plainText' && output.type === 'text'));

  assertComponentNodeResponse(root, excalidraw, {
    type: 'excalidraw',
    title: 'M3 Diagram',
    position: { x: 420, y: 80 },
  });
  assert.equal(excalidraw.body.state.type, 'excalidraw');
  assert.deepEqual(excalidraw.body.state.scene, excalidrawScene);
  assert.deepEqual(excalidraw.body.state.uiContract, {
    editor: 'excalidraw',
    modes: ['canvas'],
    defaultMode: 'canvas',
  });
  assert.ok(excalidraw.body.state.inputs.some(input => input.id === 'scene' && input.type === 'excalidraw-scene'));
  assert.ok(excalidraw.body.state.outputs.some(output => output.id === 'image' && output.type === 'image'));
});

test('AC-002 POST /api/a2a/component-nodes creates workspace and uploaded File nodes as graph resources', async () => {
  const { root, baseUrl, token } = await makeServer();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'brief.pdf'), '%PDF');
  const workspaceFile = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'file',
    title: 'brief.pdf',
    position: { x: 140, y: 220 },
    file: {
      source: 'workspace',
      path: 'src/brief.pdf',
      name: 'brief.pdf',
      mime: 'application/pdf',
      size: 4,
    },
  });
  const uploadedFile = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'file',
    title: 'paste.png',
    position: { x: 420, y: 220 },
    file: {
      source: 'user-file',
      path: 'Harness/user-files/images/paste.png',
      name: 'paste.png',
      mime: 'image/png',
      size: 7,
    },
  });

  assertComponentNodeResponse(root, workspaceFile, {
    type: 'file',
    title: 'brief.pdf',
    position: { x: 140, y: 220 },
  });
  assertComponentNodeResponse(root, uploadedFile, {
    type: 'file',
    title: 'paste.png',
    position: { x: 420, y: 220 },
  });
  assert.deepEqual(workspaceFile.body.state.file, {
    source: 'workspace',
    kind: 'file',
    path: 'src/brief.pdf',
    name: 'brief.pdf',
    mime: 'application/pdf',
    size: 4,
  });
  assert.deepEqual(uploadedFile.body.state.file, {
    source: 'user-file',
    kind: 'file',
    path: 'Harness/user-files/images/paste.png',
    name: 'paste.png',
    mime: 'image/png',
    size: 7,
  });
  assert.ok(workspaceFile.body.state.outputs.some(output => output.id === 'file' && output.type === 'file-ref'));
});

test('AC-006 GET and PUT /api/a2a/component-nodes/:nodeId return state, enforce revision match, and reject stale mutation', async () => {
  const { root, baseUrl, token } = await makeServer();
  const created = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'markdown',
    title: 'Hot Editable',
    position: { x: 30, y: 40 },
    markdown: 'v1',
  });
  assert.equal(created.status, 201);

  const fetched = await getJson(baseUrl, token, `/api/a2a/component-nodes/${created.body.node.nodeId}`);
  assert.equal(fetched.status, 200);
  assert.deepEqual(fetched.body.node, created.body.node);
  assert.equal(fetched.body.state.markdown, 'v1');
  assert.equal(fetched.body.revision, 1);

  const updated = await putJson(baseUrl, token, `/api/a2a/component-nodes/${created.body.node.nodeId}`, {
    revision: fetched.body.revision,
    markdown: 'v2',
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.ok, true);
  assert.equal(updated.body.node.revision, 2);
  assert.equal(updated.body.state.markdown, 'v2');
  assert.equal(fs.readFileSync(path.join(root, updated.body.node.statePath), 'utf8').includes('"v2"'), true);

  const stale = await putJson(baseUrl, token, `/api/a2a/component-nodes/${created.body.node.nodeId}`, {
    revision: fetched.body.revision,
    markdown: 'stale overwrite',
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STALE_REVISION');

  const afterStale = await getJson(baseUrl, token, `/api/a2a/component-nodes/${created.body.node.nodeId}`);
  assert.equal(afterStale.status, 200);
  assert.equal(afterStale.body.revision, 2);
  assert.equal(afterStale.body.state.markdown, 'v2');
});

test('AC-006 PUT /api/a2a/component-nodes/:nodeId updates Excalidraw scene JSON only on matching revision', async () => {
  const { baseUrl, token } = await makeServer();
  const created = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'excalidraw',
    title: 'Scene',
    position: { x: 100, y: 100 },
    scene: { elements: [], appState: {}, files: {} },
  });
  assert.equal(created.status, 201);
  const nextScene = {
    elements: [{ id: 'arrow-1', type: 'arrow', x: 0, y: 0, points: [[0, 0], [80, 0]], versionNonce: 2 }],
    appState: { name: 'Updated', viewBackgroundColor: '#f8fafc' },
    files: { 'file-1': { id: 'file-1', mimeType: 'image/png', dataURL: 'data:image/png;base64,aW1hZ2U=' } },
  };

  const updated = await putJson(baseUrl, token, `/api/a2a/component-nodes/${created.body.node.nodeId}`, {
    revision: created.body.node.revision,
    scene: nextScene,
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.node.revision, 2);
  assert.deepEqual(updated.body.state.scene, nextScene);
});

test('AC-008 AC-012 PUT /api/a2a/graph-map rejects stale expectedVersion without mutating graph state', async () => {
  const { baseUrl, token } = await makeServer();
  const initial = await getJson(baseUrl, token, '/api/a2a/graph-map');
  assert.equal(initial.status, 200);

  const committed = await putJson(baseUrl, token, '/api/a2a/graph-map', {
    expectedVersion: initial.body.version,
    nodes: [{ nodeId: 'session-main-node', id: 'session-main-node', kind: 'terminal-session', sessionId: 'session-main' }],
    edges: [{ id: 'edge-main-notes', from: 'session-main-node', to: 'component-notes', relation: 'wf-bridge' }],
    positions: {
      'session-main-node': { x: 10, y: 20 },
      'component-notes': { x: 100, y: 120 },
    },
  });
  assert.equal(committed.status, 200);
  assert.equal(committed.body.version, initial.body.version + 1);
  assert.equal(Object.hasOwn(committed.body, 'expectedVersion'), false);
  assert.deepEqual(committed.body.undoStack, []);
  assert.deepEqual(committed.body.redoStack, []);

  const stale = await putJson(baseUrl, token, '/api/a2a/graph-map', {
    expectedVersion: initial.body.version,
    nodes: [{ nodeId: 'stale-node', id: 'stale-node', kind: 'terminal-session', sessionId: 'stale-session' }],
    edges: [{ id: 'stale-edge', from: 'stale-node', to: 'component-notes', relation: 'stale' }],
    positions: { 'stale-node': { x: 999, y: 999 } },
    undoStack: [{ positions: { 'stale-node': { x: 1, y: 1 } }, edges: [] }],
    redoStack: [{ positions: { 'stale-node': { x: 2, y: 2 } }, edges: [] }],
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STALE_GRAPH_VERSION');
  assert.match(stale.body.error.message, /expected version 1, current version 2/i);

  const afterStale = await getJson(baseUrl, token, '/api/a2a/graph-map');
  assert.equal(afterStale.status, 200);
  assert.equal(afterStale.body.version, committed.body.version);
  assert.deepEqual(afterStale.body.nodes, committed.body.nodes);
  assert.deepEqual(afterStale.body.edges, committed.body.edges);
  assert.deepEqual(afterStale.body.positions, committed.body.positions);
  assert.deepEqual(afterStale.body.undoStack, []);
  assert.deepEqual(afterStale.body.redoStack, []);
  assert.equal(afterStale.body.nodes.some(node => node.nodeId === 'stale-node'), false);
});

test('AC-008 AC-012 PUT /api/a2a/graph-map uses If-Match as an optional graph version guard', async () => {
  const { baseUrl, token } = await makeServer();
  const initial = await getJson(baseUrl, token, '/api/a2a/graph-map');
  assert.equal(initial.status, 200);

  const committed = await putJsonWithHeaders(baseUrl, token, '/api/a2a/graph-map', {
    positions: { guarded: { x: 12, y: 34 } },
  }, { 'If-Match': `"${initial.body.version}"` });
  assert.equal(committed.status, 200);
  assert.equal(committed.body.version, initial.body.version + 1);
  assert.deepEqual(committed.body.positions.guarded, { x: 12, y: 34 });

  const stale = await putJsonWithHeaders(baseUrl, token, '/api/a2a/graph-map', {
    positions: { guarded: { x: 90, y: 91 } },
  }, { 'If-Match': `"${initial.body.version}"` });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STALE_GRAPH_VERSION');

  const afterStale = await getJson(baseUrl, token, '/api/a2a/graph-map');
  assert.equal(afterStale.status, 200);
  assert.equal(afterStale.body.version, committed.body.version);
  assert.deepEqual(afterStale.body.positions.guarded, { x: 12, y: 34 });
});

test('AC-006 /api/a2a/snapshot includes component nodes as refs alongside terminal sessions and preserves graph edges/positions', async () => {
  const { baseUrl, token, registry } = await makeServer();
  const session = registry.create({
    runtime: 'codex',
    agentKind: 'main',
    role: 'Main Agent',
    graphNodeId: 'session-main-node',
  });
  registry.update(session.sessionId, { status: 'running' });
  const markdown = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'markdown',
    title: 'Agent Context',
    position: { x: 260, y: 140 },
    markdown: '# Agent-visible context\n',
  });
  assert.equal(markdown.status, 201);
  const componentNodeId = markdown.body.node.nodeId;

  const graphUpdate = await putJson(baseUrl, token, '/api/a2a/graph-map', {
    edges: [{ id: 'edge-main-to-markdown', from: 'session-main-node', to: componentNodeId, relation: 'observes' }],
    positions: {
      'session-main-node': { x: 20, y: 40 },
      [componentNodeId]: { x: 260, y: 140 },
    },
  });
  assert.equal(graphUpdate.status, 200);

  const snapshot = await getJson(baseUrl, token, '/api/a2a/snapshot?fresh=1');
  assert.equal(snapshot.status, 200);
  const terminalNode = snapshot.body.nodes.find(node => node.id === 'session-main-node');
  const componentNode = snapshot.body.nodes.find(node => node.id === componentNodeId);
  assert.ok(terminalNode, 'snapshot should retain terminal-session nodes');
  assert.ok(componentNode, 'snapshot should include component nodes');
  assert.equal(componentNode.kind, 'component-node');
  assert.equal(componentNode.type, 'markdown');
  assert.deepEqual(componentNode.config, {
    componentType: 'markdown',
    editable: true,
    backendSourceOfTruth: true,
  });
  assert.deepEqual(componentNode.stateRef, {
    path: componentNode.statePath,
    revision: componentNode.revision,
  });
  assert.equal(Object.hasOwn(componentNode, 'markdown'), false, 'snapshot should expose state refs, not frontend-local Markdown state');
  assert.equal(Object.hasOwn(componentNode, 'scene'), false, 'snapshot should expose state refs, not frontend-local Excalidraw state');
  assert.deepEqual(snapshot.body.graph.positions[componentNodeId], { x: 260, y: 140 });
  assert.ok(snapshot.body.graph.nodes.some(node => node.nodeId === componentNodeId && node.kind === 'component-node'));
  assert.ok(snapshot.body.graph.edges.some(edge => edge.id === 'edge-main-to-markdown' && edge.from === 'session-main-node' && edge.to === componentNodeId));
});

test('AC-006 agent-readable workflow map context references component node state refs only', async () => {
  const { baseUrl, token, registry } = await makeServer();
  const session = registry.create({
    runtime: 'claude',
    agentKind: 'subagent',
    role: 'Diagram-aware worker',
    graphNodeId: 'session-diagram-worker',
  });
  registry.update(session.sessionId, { status: 'running' });
  const diagram = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'excalidraw',
    title: 'Flow',
    position: { x: 500, y: 220 },
    scene: { elements: [], appState: {}, files: {} },
  });
  assert.equal(diagram.status, 201);

  const snapshot = await getJson(baseUrl, token, `/api/a2a/snapshot?fresh=1&actorSessionId=${session.sessionId}`);

  assert.equal(snapshot.status, 200);
  const stateRef = snapshot.body.graph.componentStateRefs?.[diagram.body.node.nodeId];
  assert.deepEqual(stateRef, {
    type: 'excalidraw',
    title: 'Flow',
    statePath: diagram.body.node.statePath,
    revision: diagram.body.node.revision,
  });
  assert.equal(snapshot.body.graphContextBySessionId[session.sessionId].componentStateRefs[diagram.body.node.nodeId].statePath, diagram.body.node.statePath);
  assert.equal(JSON.stringify(snapshot.body).includes('"frontendLocalState"'), false);
});

test('AC-003 graph context exposes connected File and Markdown resources for an agent session', async () => {
  const { baseUrl, token, registry } = await makeServer();
  const session = registry.create({
    runtime: 'codex',
    agentKind: 'main',
    role: 'Main Agent',
    graphNodeId: 'session-main-context',
  });
  registry.update(session.sessionId, { status: 'running' });
  const fileNode = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'file',
    title: 'context.md',
    position: { x: 120, y: 260 },
    file: {
      source: 'workspace',
      path: 'Harness/tasks/task-alpha/PLAN.md',
      name: 'PLAN.md',
      mime: 'text/markdown',
      size: 20,
    },
  });
  const markdownNode = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'markdown',
    title: 'Agent Notes',
    position: { x: 420, y: 260 },
    markdown: '# Notes',
  });

  const graphUpdate = await putJson(baseUrl, token, '/api/a2a/graph-map', {
    edges: [
      { id: 'edge-file-main', from: fileNode.body.node.nodeId, to: 'session-main-context', relation: 'context', sourceHandle: 'file', targetHandle: 'context' },
      { id: 'edge-main-md', from: 'session-main-context', to: markdownNode.body.node.nodeId, relation: 'default-output', sourceHandle: 'output', targetHandle: 'markdown' },
    ],
  });
  assert.equal(graphUpdate.status, 200);

  const snapshot = await getJson(baseUrl, token, '/api/a2a/snapshot?fresh=1');
  assert.equal(snapshot.status, 200);
  const context = snapshot.body.graphContextBySessionId[session.sessionId];
  assert.ok(context, 'session should have graph context');
  assert.deepEqual(context.connectedResourceRefs.map(item => item.nodeId).sort(), [
    fileNode.body.node.nodeId,
    markdownNode.body.node.nodeId,
  ].sort());
  const fileRef = context.connectedResourceRefs.find(item => item.type === 'file');
  assert.equal(fileRef.file.path, 'Harness/tasks/task-alpha/PLAN.md');
  assert.equal(fileRef.direction, 'inbound');
  const markdownRef = context.connectedResourceRefs.find(item => item.type === 'markdown');
  assert.equal(markdownRef.direction, 'outbound');
  assert.equal(markdownRef.stateRef.path, markdownNode.body.node.statePath);
});

test('AC-004 graph context exposes connected File Markdown and Diagram refs with content refs, capabilities, and handles', async () => {
  const { root, baseUrl, token, registry } = await makeServer();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  const fileBody = '# Context\n\nAgent-readable file.\n';
  fs.writeFileSync(path.join(root, 'src', 'context.md'), fileBody);
  const session = registry.create({
    runtime: 'codex',
    agentKind: 'main',
    role: 'Context Agent',
    graphNodeId: 'session-resource-context',
  });
  registry.update(session.sessionId, { status: 'running' });

  const fileNode = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'file',
    title: 'context.md',
    position: { x: 100, y: 100 },
    file: {
      source: 'workspace',
      path: 'src/context.md',
      name: 'context.md',
      mime: 'text/markdown',
      size: Buffer.byteLength(fileBody),
    },
  });
  const markdownNode = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'markdown',
    title: 'Draft',
    position: { x: 360, y: 100 },
    markdown: '# Draft\n',
  });
  const diagramNode = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'excalidraw',
    title: 'Sketch',
    position: { x: 620, y: 100 },
    scene: { elements: [], appState: {}, files: {} },
  });
  for (const result of [fileNode, markdownNode, diagramNode]) assert.equal(result.status, 201);

  const graphUpdate = await putJson(baseUrl, token, '/api/a2a/graph-map', {
    edges: [
      { id: 'edge-file-agent', from: fileNode.body.node.nodeId, to: 'session-resource-context', relation: 'context', sourceHandle: 'file', targetHandle: 'context' },
      { id: 'edge-agent-markdown', from: 'session-resource-context', to: markdownNode.body.node.nodeId, relation: 'default-output', sourceHandle: 'output', targetHandle: 'markdown' },
      { id: 'edge-diagram-agent', from: diagramNode.body.node.nodeId, to: 'session-resource-context', relation: 'context', sourceHandle: 'scene', targetHandle: 'context' },
    ],
  });
  assert.equal(graphUpdate.status, 200);

  const snapshot = await getJson(baseUrl, token, '/api/a2a/snapshot?fresh=1');
  assert.equal(snapshot.status, 200);
  const context = snapshot.body.graphContextBySessionId[session.sessionId];
  assert.ok(context, 'session should expose graph context');
  const refsByNodeId = new Map(context.connectedResourceRefs.map(ref => [ref.nodeId, ref]));

  const fileRef = refsByNodeId.get(fileNode.body.node.nodeId);
  assert.equal(fileRef.direction, 'inbound');
  assert.equal(fileRef.sourceHandle, 'file');
  assert.equal(fileRef.targetHandle, 'context');
  assert.deepEqual(fileRef.stateRef, {
    path: fileNode.body.node.statePath,
    revision: fileNode.body.node.revision,
  });
  assert.deepEqual(fileRef.contentRef, {
    kind: 'workspace-file',
    source: 'workspace',
    path: 'src/context.md',
    mime: 'text/markdown',
    size: Buffer.byteLength(fileBody),
    endpoints: {
      meta: '/api/workspace/meta',
      bytes: '/api/workspace/file',
      text: '/api/workspace/text',
    },
  });
  assertSameStrings(fileRef.capabilities, ['meta:read', 'bytes:read', 'text:read']);
  assert.deepEqual(fileRef.handles, {
    inputs: ['file'],
    outputs: ['file', 'path'],
  });

  const markdownRef = refsByNodeId.get(markdownNode.body.node.nodeId);
  assert.equal(markdownRef.direction, 'outbound');
  assert.equal(markdownRef.sourceHandle, 'output');
  assert.equal(markdownRef.targetHandle, 'markdown');
  assert.deepEqual(markdownRef.contentRef, {
    kind: 'component-state',
    statePath: markdownNode.body.node.statePath,
    revision: markdownNode.body.node.revision,
    field: 'markdown',
    mime: 'text/markdown',
  });
  assertSameStrings(markdownRef.capabilities, ['state:read', 'state:update', 'markdown:append', 'markdown:replace']);
  assert.deepEqual(markdownRef.handles, {
    inputs: ['markdown'],
    outputs: ['markdown', 'plainText'],
  });

  const diagramRef = refsByNodeId.get(diagramNode.body.node.nodeId);
  assert.equal(diagramRef.type, 'excalidraw');
  assert.equal(diagramRef.direction, 'inbound');
  assert.equal(diagramRef.sourceHandle, 'scene');
  assert.equal(diagramRef.targetHandle, 'context');
  assert.deepEqual(diagramRef.contentRef, {
    kind: 'component-state',
    statePath: diagramNode.body.node.statePath,
    revision: diagramNode.body.node.revision,
    field: 'scene',
    mime: 'application/vnd.excalidraw+json',
  });
  assertSameStrings(diagramRef.capabilities, ['state:read', 'state:update', 'excalidraw:read', 'excalidraw:update']);
  assert.deepEqual(diagramRef.handles, {
    inputs: ['scene'],
    outputs: ['scene', 'image'],
  });
});

test('AC-005 Markdown output routing falls back to earliest connected Markdown when enabled without explicit target', async () => {
  const { baseUrl, token, registry } = await makeServer();
  const session = registry.create({
    runtime: 'codex',
    agentKind: 'main',
    role: 'Markdown Output Agent',
    graphNodeId: 'session-markdown-output',
    nodeConfig: {
      outputRouting: {
        markdownDefaultEnabled: true,
        markdownTargetNodeId: '',
        fallback: 'oldest-connected-markdown',
      },
    },
  });
  registry.update(session.sessionId, { status: 'running' });
  const olderMarkdown = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    nodeId: 'component-alpha-notes',
    type: 'markdown',
    title: 'Alpha Notes',
    position: { x: 120, y: 120 },
    markdown: '# Alpha\n',
  });
  const newerMarkdown = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    nodeId: 'component-zeta-notes',
    type: 'markdown',
    title: 'Zeta Notes',
    position: { x: 420, y: 120 },
    markdown: '# Zeta\n',
  });
  assert.equal(olderMarkdown.status, 201);
  assert.equal(newerMarkdown.status, 201);

  const graphUpdate = await putJson(baseUrl, token, '/api/a2a/graph-map', {
    edges: [
      { id: 'edge-output-newer', from: 'session-markdown-output', to: newerMarkdown.body.node.nodeId, relation: 'default-output', sourceHandle: 'output', targetHandle: 'markdown' },
      { id: 'edge-output-older', from: 'session-markdown-output', to: olderMarkdown.body.node.nodeId, relation: 'default-output', sourceHandle: 'output', targetHandle: 'markdown' },
    ],
  });
  assert.equal(graphUpdate.status, 200);

  const snapshot = await getJson(baseUrl, token, '/api/a2a/snapshot?fresh=1');
  assert.equal(snapshot.status, 200);
  const context = snapshot.body.graphContextBySessionId[session.sessionId];
  assert.ok(context, 'session should expose graph context');
  assert.ok(context.outputRouting, 'session graph context should include resolved output routing');
  assert.deepEqual(context.outputRouting.markdownDefault, {
    enabled: true,
    explicitTargetNodeId: '',
    resolvedTargetNodeId: olderMarkdown.body.node.nodeId,
    resolution: 'oldest-connected-markdown',
  });
});

test('AC-006 component node API rejects traversal ids, bad types, mutable statePath injection, and stale revisions', async () => {
  const { baseUrl, token } = await makeServer();
  const badType = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'terminal',
    title: 'Invalid',
    position: { x: 0, y: 0 },
  });
  const badId = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    nodeId: '../escape',
    type: 'markdown',
    title: 'Escape',
    position: { x: 0, y: 0 },
    markdown: 'bad',
  });
  const created = await postJson(baseUrl, token, '/api/a2a/component-nodes', {
    type: 'markdown',
    title: 'Safe',
    position: { x: 0, y: 0 },
    markdown: 'safe',
  });
  assert.equal(created.status, 201);
  const badStatePath = await putJson(baseUrl, token, `/api/a2a/component-nodes/${created.body.node.nodeId}`, {
    revision: created.body.node.revision,
    markdown: 'mutated',
    statePath: '../outside/state.json',
  });
  const traversalGet = await getJson(baseUrl, token, '/api/a2a/component-nodes/..%2Fescape');

  assert.equal(badType.status, 400);
  assert.equal(badType.body.error.code, 'BAD_REQUEST');
  assert.equal(badId.status, 400);
  assert.equal(badId.body.error.code, 'BAD_REQUEST');
  assert.equal(badStatePath.status, 400);
  assert.equal(badStatePath.body.error.code, 'BAD_REQUEST');
  assert.equal(traversalGet.status, 400);
  assert.equal(traversalGet.body.error.code, 'BAD_REQUEST');
});
