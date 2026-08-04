import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), '.tmp-p3-test-' + id);
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  // Seed graph-map with an agent/terminal-session node
  const graphMap = {
    schemaVersion: 1, version: 1,
    nodes: [
      { nodeId: 'session-test-agent-01', sessionId: 'test-agent-session-01', agentKind: 'main', runtime: 'claude', status: 'stopped', label: 'Test Agent', cwd: dir, taskId: null },
    ],
    edges: [],
    positions: { 'session-test-agent-01': { x: 100, y: 100 } },
    undoStack: [], redoStack: [], deletedNodes: [],
  };
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify(graphMap));
  // Create terminal session on disk if possible
  try {
    fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'sessions'), { recursive: true });
    const sessionState = {
      sessionId: 'test-agent-session-01', status: 'stopped', runtime: 'claude',
      agentKind: 'main', role: 'test', cwd: dir, projectRoot: dir,
      graphNodeId: 'session-test-agent-01', nodeHomeRel: 'Harness/a2a/nodes/test-agent-session-01',
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'sessions', 'test-agent-session-01.json'), JSON.stringify(sessionState));
  } catch {}
  // Settings
  try { fs.mkdirSync(path.join(dir, 'Harness'), { recursive: true }); } catch {}
  try { fs.writeFileSync(path.join(dir, 'Harness', 'settings.json'), '{}'); } catch {}
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function jsonRequest(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { 'content-type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let root, server, baseUrl;

describe('Phase 3 — Unified Node Snapshot + Agent Adapter', () => {
  before(async () => {
    root = tempProjectRoot();
    const mod = await import('../server.mjs');
    const sessionMock = { getAll: () => [], get: () => null, create: () => {}, stop: () => null, update: () => {}, remove: () => {}, withLock: (_k, fn) => Promise.resolve().then(fn) };
    const raw = mod.createServer({ projectRoot: root, sessionRegistry: sessionMock, token: '' });
    await new Promise(r => raw.listen(0, () => r()));
    baseUrl = `http://127.0.0.1:${raw.address().port}`;
    server = raw;
  });
  after(() => { if (server) server.close(); cleanup(root); });

  // ── P3-001: listNodes includes agent graph nodes ──
  it('P3-001 GET /api/workflow/nodes includes agent graph-map nodes alongside component nodes', async () => {
    // Create a component node first
    await jsonRequest(`${baseUrl}/api/workflow/nodes`, { method: 'POST', body: { type: 'markdown', title: 'P3 Test MD' } });
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.nodes), 'nodes must be an array');
    // Should have at least 2 nodes: 1 component + 1 agent from seeded graph-map
    const agentNodes = res.body.nodes.filter(n => n.kind === 'agent' || n.sessionId);
    const componentNodes = res.body.nodes.filter(n => n.kind === 'markdown' || n.kind === 'excalidraw' || n.kind === 'file');
    assert.ok(agentNodes.length >= 1, `P3-001 RED: no agent nodes in list. Total: ${res.body.nodes.length}, kinds: ${res.body.nodes.map(n => n.kind).join(', ')}`);
    assert.ok(componentNodes.length >= 1, 'should have at least one component node');
  });

  // ── P3-002: agent.readContext returns 200 ──
  it('P3-002 POST /api/workflow/nodes/<agentId>/actions/agent.readContext returns context', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/session-test-agent-01/actions/agent.readContext`, {
      method: 'POST', body: {},
    });
    // Currently expected RED — agent not in component index
    assert.ok(res.status < 500, `P3-002 RED: expected 2xx/4xx, got ${res.status}: ${JSON.stringify(res.body)}`);
    if (res.status === 200) {
      assert.ok(res.body.ok);
      assert.ok(res.body.result || res.body.context, 'must have result or context');
    }
  });

  // ── P3-003: agent.readOutput returns terminal output ──
  it('P3-003 POST /api/workflow/nodes/<agentId>/actions/agent.readOutput returns output', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/session-test-agent-01/actions/agent.readOutput`, {
      method: 'POST', body: { tail: 20 },
    });
    assert.ok(res.status < 500, `P3-003 RED: got ${res.status}: ${JSON.stringify(res.body)}`);
    if (res.status === 200) {
      assert.ok(res.body.ok);
    }
  });

  // ── P3-004: agent.stop returns success ──
  it('P3-004 POST /api/workflow/nodes/<agentId>/actions/agent.stop returns ok', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/session-test-agent-01/actions/agent.stop`, {
      method: 'POST', body: {},
    });
    assert.ok(res.status < 500, `P3-004 RED: got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  // ── P3-005: agent.delete cleans graph-map ──
  it('P3-005 DELETE agent node removes from graph-map', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/session-test-agent-01/actions/agent.delete`, {
      method: 'POST', body: {},
    });
    assert.ok(res.status < 500, `P3-005 RED: got ${res.status}: ${JSON.stringify(res.body)}`);
    if (res.status === 200) {
      // Verify graph-map no longer has the node
      const graphRes = await jsonRequest(`${baseUrl}/api/a2a/graph-map`);
      const nodeIds = (graphRes.body.nodes || []).map(n => n.nodeId || n.id);
      assert.ok(!nodeIds.includes('session-test-agent-01'), 'agent node should be removed from graph-map');
    }
  });
});

describe('Phase 3 — Snapshot Completeness', () => {
  let root2, server2, baseUrl2;

  before(async () => {
    root2 = tempProjectRoot();
    const mod = await import('../server.mjs');
    const sessionMock = { getAll: () => [], get: () => null, create: () => {}, stop: () => null, update: () => {}, remove: () => {}, withLock: (_k, fn) => Promise.resolve().then(fn) };
    const raw = mod.createServer({ projectRoot: root2, sessionRegistry: sessionMock, token: '' });
    await new Promise(r => raw.listen(0, () => r()));
    baseUrl2 = `http://127.0.0.1:${raw.address().port}`;
    server2 = raw;
  });
  after(() => { if (server2) server2.close(); cleanup(root2); });

  // ── P3-006: executeNodeAction response has graph.connections ──
  it('P3-006 executeNodeAction response includes graph.connections on node snapshot', async () => {
    // Create two nodes and connect them
    const a = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'markdown', title: 'A' } });
    const b = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'excalidraw', title: 'B' } });
    await jsonRequest(`${baseUrl2}/api/workflow/edges`, { method: 'POST', body: { from: a.body.node.nodeId, to: b.body.node.nodeId } });

    // Execute action on one of them
    const res = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${a.body.node.nodeId}/actions/markdown.read`, {
      method: 'POST', body: {},
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
    // P3-006 check
    const node = res.body.node;
    assert.ok(node.graph, 'node must have graph');
    assert.ok(Array.isArray(node.graph.connections), 'graph.connections must be array');
    assert.ok(node.graph.connections.length > 0, `P3-006 RED: node.graph.connections is empty after edge creation. connections=${JSON.stringify(node.graph.connections)}`);
  });

  // ── P3-007: updateNodeSettings response has graph.connections ──
  it('P3-007 updateNodeSettings response includes graph.connections', async () => {
    const a = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'markdown', title: 'SettingsTest' } });
    const b = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'file', title: 'FileTest', file: { source: 'workspace', path: 'x.txt', name: 'x.txt', mime: 'text/plain', size: 0 } } });
    await jsonRequest(`${baseUrl2}/api/workflow/edges`, { method: 'POST', body: { from: a.body.node.nodeId, to: b.body.node.nodeId } });

    const res = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${a.body.node.nodeId}/settings`, {
      method: 'PATCH', body: { editorMode: 'source' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.node);
    assert.ok(res.body.node.graph);
    assert.ok(res.body.node.graph.connections.length > 0, `P3-007 RED: updateNodeSettings response lacks connections. got ${res.body.node.graph.connections.length}`);
  });

  // ── P3-008: Excalidraw far-away elements produce non-empty preview ──
  it('AC-004 AC-005 GET workflow context exposes canonical connected resource refs and Markdown output routing', async () => {
    fs.mkdirSync(path.join(root2, 'src'), { recursive: true });
    const fileBody = '# Canonical Context\n\nReadable file.\n';
    fs.writeFileSync(path.join(root2, 'src', 'canonical-context.md'), fileBody);

    const fileNode = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        nodeId: 'component-canonical-context-file',
        type: 'file',
        title: 'canonical-context.md',
        file: {
          source: 'workspace',
          path: 'src/canonical-context.md',
          name: 'canonical-context.md',
          mime: 'text/markdown',
          size: Buffer.byteLength(fileBody),
        },
      },
    });
    const missingFileNode = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        nodeId: 'component-canonical-missing-file',
        type: 'file',
        title: 'missing-context.md',
        file: {
          source: 'workspace',
          path: 'src/missing-context.md',
          name: 'missing-context.md',
          mime: 'text/markdown',
          size: 99,
        },
      },
    });
    const olderMarkdown = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        nodeId: 'component-canonical-alpha-notes',
        type: 'markdown',
        title: 'Alpha Notes',
        markdown: '# Alpha\n',
      },
    });
    const newerMarkdown = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        nodeId: 'component-canonical-zeta-notes',
        type: 'markdown',
        title: 'Zeta Notes',
        markdown: '# Zeta\n',
      },
    });
    const diagramNode = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        nodeId: 'component-canonical-diagram',
        type: 'excalidraw',
        title: 'Sketch',
        scene: { elements: [], appState: {}, files: {} },
      },
    });
    for (const result of [fileNode, missingFileNode, olderMarkdown, newerMarkdown, diagramNode]) {
      assert.equal(result.status, 201, JSON.stringify(result.body));
    }

    const settings = await jsonRequest(`${baseUrl2}/api/workflow/nodes/session-test-agent-01/settings`, {
      method: 'PATCH',
      body: {
        outputRouting: {
          markdownDefaultEnabled: true,
          markdownTargetNodeId: '',
          fallback: 'oldest-connected-markdown',
        },
      },
    });
    assert.equal(settings.status, 200, JSON.stringify(settings.body));
    assert.equal(settings.body.node.kind, 'agent');
    assert.equal(settings.body.settings.values.outputRouting.markdownDefaultEnabled, true);

    const edges = [
      { from: fileNode.body.node.nodeId, to: 'session-test-agent-01', relation: 'context', sourceHandle: 'file', targetHandle: 'context' },
      { from: missingFileNode.body.node.nodeId, to: 'session-test-agent-01', relation: 'context', sourceHandle: 'file', targetHandle: 'context' },
      { from: 'session-test-agent-01', to: newerMarkdown.body.node.nodeId, relation: 'default-output', sourceHandle: 'output', targetHandle: 'markdown' },
      { from: 'session-test-agent-01', to: olderMarkdown.body.node.nodeId, relation: 'default-output', sourceHandle: 'output', targetHandle: 'markdown' },
      { from: diagramNode.body.node.nodeId, to: 'session-test-agent-01', relation: 'context', sourceHandle: 'scene', targetHandle: 'context' },
    ];
    for (const edge of edges) {
      const res = await jsonRequest(`${baseUrl2}/api/workflow/edges`, { method: 'POST', body: edge });
      assert.equal(res.status, 201, JSON.stringify(res.body));
    }

    const contextRes = await jsonRequest(`${baseUrl2}/api/workflow/context/session-test-agent-01`);
    assert.equal(contextRes.status, 200);
    const context = contextRes.body.context;
    assert.ok(Array.isArray(context.connectedResourceRefs), 'canonical context must expose connectedResourceRefs');
    const refsByNodeId = new Map(context.connectedResourceRefs.map(ref => [ref.nodeId, ref]));

    const fileRef = refsByNodeId.get(fileNode.body.node.nodeId);
    assert.equal(fileRef.direction, 'bidirectional');
    assert.equal(fileRef.endpointRole, 'target');
    assert.deepEqual(fileRef.stateRef, {
      path: fileNode.body.node.stateRef.path,
      revision: fileNode.body.node.stateRef.revision,
    });
    assert.equal(fileRef.contentRef.kind, 'workspace-file');
    assert.equal(fileRef.contentRef.path, 'src/canonical-context.md');
    assert.equal(fileRef.contentRef.mime, 'text/markdown');
    assert.equal(fileRef.contentRef.size, Buffer.byteLength(fileBody));
    assert.equal(fileRef.contentRef.endpoints.text, '/api/workspace/text');
    assert.deepEqual(fileRef.handles, { inputs: ['file'], outputs: ['file', 'path'] });
    assert.ok(fileRef.capabilities.includes('text:read'));
    assert.deepEqual(fileRef.connection, {
      edgeId: `${fileNode.body.node.nodeId}->session-test-agent-01`,
      localHandle: 'context',
      peerHandle: 'file',
      sourceHandle: 'file',
      targetHandle: 'context',
      relation: 'context',
      direction: 'bidirectional',
      endpointRole: 'target',
    });
    assert.equal(fileRef.metadata.exists, true);
    assert.equal(fileRef.metadata.stale, false);
    assert.equal(typeof fileRef.metadata.etag, 'string');

    const missingRef = refsByNodeId.get(missingFileNode.body.node.nodeId);
    assert.equal(missingRef.metadata.exists, false);
    assert.equal(missingRef.metadata.stale, true);
    assert.equal(missingRef.metadata.needsRefresh, true);
    assert.equal(missingRef.metadata.etag, null);

    const markdownRef = refsByNodeId.get(olderMarkdown.body.node.nodeId);
    assert.equal(markdownRef.direction, 'bidirectional');
    assert.equal(markdownRef.endpointRole, 'source');
    assert.deepEqual(markdownRef.contentRef, {
      kind: 'component-state',
      statePath: olderMarkdown.body.node.stateRef.path,
      revision: olderMarkdown.body.node.stateRef.revision,
      field: 'markdown',
      mime: 'text/markdown',
    });
    assert.deepEqual(markdownRef.handles, { inputs: ['markdown'], outputs: ['markdown', 'plainText'] });

    const diagramRef = refsByNodeId.get(diagramNode.body.node.nodeId);
    assert.equal(diagramRef.type, 'excalidraw');
    assert.ok(diagramRef.capabilities.includes('excalidraw:read'));
    assert.deepEqual(diagramRef.handles, { inputs: ['scene'], outputs: ['scene', 'image'] });

    assert.deepEqual(context.outputRouting.markdownDefault, {
      enabled: true,
      explicitTargetNodeId: '',
      resolvedTargetNodeId: olderMarkdown.body.node.nodeId,
      resolution: 'oldest-connected-markdown',
    });
  });

  it('AC-005 PATCH workflow agent settings supports explicit Markdown output target', async () => {
    const markdown = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        nodeId: 'component-canonical-explicit-notes',
        type: 'markdown',
        title: 'Explicit Notes',
        markdown: '# Explicit\n',
      },
    });
    assert.equal(markdown.status, 201, JSON.stringify(markdown.body));

    const edge = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: {
        from: 'session-test-agent-01',
        to: markdown.body.node.nodeId,
        relation: 'default-output',
        sourceHandle: 'output',
        targetHandle: 'markdown',
      },
    });
    assert.equal(edge.status, 201, JSON.stringify(edge.body));

    const settings = await jsonRequest(`${baseUrl2}/api/workflow/nodes/session-test-agent-01/settings`, {
      method: 'PATCH',
      body: {
        outputRouting: {
          markdownDefaultEnabled: true,
          markdownTargetNodeId: markdown.body.node.nodeId,
          fallback: 'oldest-connected-markdown',
        },
      },
    });
    assert.equal(settings.status, 200, JSON.stringify(settings.body));
    assert.equal(settings.body.settings.schemaId, 'agent-settings');
    assert.deepEqual(settings.body.settings.values.outputRouting, {
      markdownDefaultEnabled: true,
      markdownTargetNodeId: markdown.body.node.nodeId,
      fallback: 'oldest-connected-markdown',
    });

    const contextRes = await jsonRequest(`${baseUrl2}/api/workflow/context/session-test-agent-01`);
    assert.equal(contextRes.status, 200);
    assert.deepEqual(contextRes.body.context.outputRouting.markdownDefault, {
      enabled: true,
      explicitTargetNodeId: markdown.body.node.nodeId,
      resolvedTargetNodeId: markdown.body.node.nodeId,
      resolution: 'explicit-target',
    });
  });

  it('AC-005 PATCH workflow agent settings rejects traversal ids', async () => {
    const res = await jsonRequest(`${baseUrl2}/api/workflow/nodes/..%2Fescape/settings`, {
      method: 'PATCH',
      body: {
        outputRouting: {
          markdownDefaultEnabled: true,
          markdownTargetNodeId: '',
          fallback: 'oldest-connected-markdown',
        },
      },
    });
    assert.ok(res.status >= 400, `expected traversal id rejection, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(fs.existsSync(path.join(root2, 'Harness', 'a2a', 'escape', 'settings.json')), false);
  });

  it('P3-008 Excalidraw renderPreview with far-away elements returns normalized non-empty preview', async () => {
    const draw = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'excalidraw', title: 'FarDraw' } });
    // Save scene with elements at extreme coordinates
    await jsonRequest(`${baseUrl2}/api/workflow/nodes/${draw.body.node.nodeId}/actions/excalidraw.saveScene`, {
      method: 'POST',
      body: {
        scene: {
          elements: [
            { id: 'e1', type: 'rectangle', x: 5000, y: 3000, width: 200, height: 100, strokeColor: '#6965DB', backgroundColor: '#e8e7ff' },
            { id: 'e2', type: 'ellipse', x: -100, y: -50, width: 80, height: 80, strokeColor: '#ff0000', backgroundColor: '#ffe0e0' },
          ],
          appState: { viewBackgroundColor: '#ffffff' },
          files: {},
        },
      },
    });
    const res = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${draw.body.node.nodeId}/actions/excalidraw.renderPreview`, {
      method: 'POST', body: {},
    });
    assert.equal(res.status, 200);
    const preview = res.body.result?.preview || res.body.result;
    assert.ok(preview.hasContent, `P3-008 RED: preview hasContent is false for far-away elements`);
    assert.ok(preview.elements.length === 2, `P3-008 RED: expected 2 elements, got ${preview.elements.length}`);
    // All elements must be within the viewport bounds (0-300 x 0-240 with 16px padding)
    for (const el of preview.elements) {
      assert.ok(el.x >= 0 && el.x <= 300, `P3-008 RED: element x=${el.x} outside viewport`);
      assert.ok(el.y >= 0 && el.y <= 240, `P3-008 RED: element y=${el.y} outside viewport`);
    }
  });
});

console.log('OK: workflow-api-phase3.test.mjs');
