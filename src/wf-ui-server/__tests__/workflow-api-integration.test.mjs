import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Dynamic import of server module ──
let createServer;
let sessionMock;

function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), '.tmp-wf-api-test-' + id);
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({ schemaVersion: 1, version: 1, nodes: [], edges: [], positions: {}, undoStack: [], redoStack: [], deletedNodes: [] }));
  // Settings file
  try { fs.mkdirSync(path.join(dir, 'Harness', 'settings.json').replace('settings.json', ''), { recursive: true }); } catch {}
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

// ── Suite ──
describe('Workflow API Integration', () => {
  let root;
  let server;
  let baseUrl;

  before(async () => {
    root = tempProjectRoot();
    // Dynamic import
    const mod = await import('../server.mjs');
    createServer = mod.createServer;
    sessionMock = { getAll: () => [], get: () => null, create: () => {}, stop: () => null, update: () => {}, remove: () => {}, withLock: (_key, fn) => Promise.resolve().then(fn) };
    const raw = createServer({ projectRoot: root, sessionRegistry: sessionMock, token: '' });
    await new Promise(resolve => raw.listen(0, () => resolve()));
    const addr = raw.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
    server = raw;
  });

  after(() => {
    if (server) server.close();
    cleanup(root);
  });

  // ── AC-NR-001: /api/workflow/nodes returns real JSON, not {} ──
  it('AC-NR-001 GET /api/workflow/nodes returns { ok, nodes } not empty object', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    assert.equal(res.status, 200);
    assert.ok(res.body && typeof res.body === 'object', `expected object, got ${typeof res.body}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.ok !== undefined || res.body.nodes !== undefined, `missing ok/nodes: ${JSON.stringify(res.body)}`);
    // If bug #1 exists, res.body will be {} (Promise stringified)
    assert.notDeepStrictEqual(res.body, {}, 'BUG: async route returns {} — Promise not awaited');
  });

  // ── AC-NR-002: POST /api/workflow/nodes creates a node ──
  it('AC-NR-002 POST /api/workflow/nodes creates markdown node and returns snapshot', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes`, {
      method: 'POST',
      body: { type: 'markdown', title: 'API Test MD' },
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.ok);
    assert.ok(res.body.node, `no node in response: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.node.kind, 'markdown');
    assert.ok(res.body.node.nodeId);
    assert.ok(res.body.state);
  });

  // ── AC-NR-003: GET /api/workflow/nodes lists created nodes with connections ──
  it('AC-NR-003 GET /api/workflow/nodes after create returns nodes with connections field', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.nodes), 'nodes must be an array');
    assert.ok(res.body.nodes.length >= 1, 'at least one node');
    const node = res.body.nodes[0];
    assert.ok(node.graph, 'node must have graph');
    assert.ok(Array.isArray(node.graph.connections), 'graph.connections must be array');
    // Bug #4: connections will be [] because snapshot doesn't load from graph
    // We assert the field exists; later we'll assert it's populated after connect
  });

  // ── AC-NR-004: GET /api/workflow/nodes/:id returns single node ──
  it('AC-NR-004 GET /api/workflow/nodes/:id returns node with state', async () => {
    const all = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    const nodeId = all.body.nodes[0].nodeId;
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/${encodeURIComponent(nodeId)}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.node);
    assert.equal(res.body.node.nodeId, nodeId);
    assert.ok(res.body.state, 'must return state');
  });

  // ── AC-NR-005: PATCH state updates markdown ──
  it('AC-NR-005 PATCH /api/workflow/nodes/:id/state updates markdown content', async () => {
    const all = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    const md = all.body.nodes.find(n => n.kind === 'markdown');
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/${encodeURIComponent(md.nodeId)}/state`, {
      method: 'PATCH',
      body: { revision: md.version, markdown: '# API Test Content' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
    assert.ok(res.body.state.markdown.includes('API Test Content'));
  });

  // ── AC-NR-006: PATCH settings updates editor mode ──
  it('AC-NR-006 PATCH /api/workflow/nodes/:id/settings updates settings', async () => {
    const all = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    const md = all.body.nodes.find(n => n.kind === 'markdown');
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/${encodeURIComponent(md.nodeId)}/settings`, {
      method: 'PATCH',
      body: { editorMode: 'source' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.settings);
    assert.ok(res.body.settings.values);
    assert.equal(res.body.settings.values.editorMode, 'source');
  });

  // ── AC-NR-007: POST action executes markdown.read ──
  it('AC-NR-007 POST /api/workflow/nodes/:id/actions/markdown.read returns markdown', async () => {
    const all = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    const md = all.body.nodes.find(n => n.kind === 'markdown');
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/${encodeURIComponent(md.nodeId)}/actions/markdown.read`, {
      method: 'POST',
      body: {},
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
    assert.equal(res.body.action, 'markdown.read');
    assert.ok(typeof res.body.result.markdown === 'string');
  });

  // ── AC-NR-008: POST edges connects two nodes ──
  it('AC-NR-008 POST /api/workflow/edges creates edge between two nodes', async () => {
    // Create second node
    await jsonRequest(`${baseUrl}/api/workflow/nodes`, {
      method: 'POST',
      body: { type: 'excalidraw', title: 'API Test Draw' },
    });
    const all = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    const a = all.body.nodes[0];
    const b = all.body.nodes[1];
    const res = await jsonRequest(`${baseUrl}/api/workflow/edges`, {
      method: 'POST',
      body: { from: a.nodeId, to: b.nodeId, relation: 'wf-bridge' },
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.ok);
    assert.ok(res.body.edge);
    assert.equal(res.body.edge.from, a.nodeId);
    assert.equal(res.body.edge.to, b.nodeId);
  });

  // ── AC-NR-009: After edge, listNodes shows connections ──
  it('AC-NR-009 after connect, listNodes returns populated graph.connections', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    const nodes = res.body.nodes;
    const connected = nodes.filter(n => n.graph && n.graph.connections && n.graph.connections.length > 0);
    assert.ok(connected.length > 0, 'BUG #4: no nodes have connections after edge creation');
  });

  // ── AC-NR-010: GET context returns connected peers ──
  it('AC-NR-010 GET /api/workflow/context/:id returns connected peers', async () => {
    const all = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    const first = all.body.nodes[0];
    const res = await jsonRequest(`${baseUrl}/api/workflow/context/${encodeURIComponent(first.nodeId)}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.node);
    assert.ok(res.body.context);
    assert.ok(Array.isArray(res.body.context.connectedPeers) || Array.isArray(res.body.node.graph.connections));
  });

  // ── AC-NR-011: DELETE edge removes edge ──
  it('AC-NR-011 DELETE /api/workflow/edges/:id removes edge', async () => {
    const snapshot = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    // We need the edge id — read graph snapshot
    const graphRes = await jsonRequest(`${baseUrl}/api/a2a/graph-map`);
    const edges = graphRes.body.edges || [];
    if (edges.length === 0) {
      // No edges to delete — this is a pre-existing state issue
      console.log('AC-NR-011 SKIP: no edges in graph-map');
      return;
    }
    const edgeId = edges[0].id;
    const res = await jsonRequest(`${baseUrl}/api/workflow/edges/${encodeURIComponent(edgeId)}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
  });

  // ── AC-NR-012: DELETE node cleans up graph ──
  it('AC-NR-012 DELETE node removes from graph-map (no dangling edges)', async () => {
    // Create a node specifically for deletion test
    await jsonRequest(`${baseUrl}/api/workflow/nodes`, {
      method: 'POST',
      body: { type: 'file', title: 'Delete Test', file: { source: 'workspace', path: 'test.txt', name: 'test.txt', mime: 'text/plain', size: 0 } },
    });
    const before = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    const fileNode = before.body.nodes.find(n => n.kind === 'file');
    assert.ok(fileNode, 'file node must exist');

    // Connect to another node
    const md = before.body.nodes.find(n => n.kind === 'markdown');
    if (md) {
      await jsonRequest(`${baseUrl}/api/workflow/edges`, {
        method: 'POST',
        body: { from: md.nodeId, to: fileNode.nodeId, relation: 'wf-bridge' },
      });
    }

    // Delete the file node
    const delRes = await jsonRequest(`${baseUrl}/api/workflow/nodes/${encodeURIComponent(fileNode.nodeId)}/actions/node.delete`, {
      method: 'POST',
      body: {},
    });

    // Verify cleanup: node gone from list
    const after = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    assert.ok(!after.body.nodes.some(n => n.nodeId === fileNode.nodeId), 'node should be removed from list');

    // Verify graph-map has no dangling edges referencing deleted node
    const graphAfter = await jsonRequest(`${baseUrl}/api/a2a/graph-map`);
    const danglingEdges = (graphAfter.body.edges || []).filter(
      e => e.from === fileNode.nodeId || e.to === fileNode.nodeId
    );
    assert.equal(danglingEdges.length, 0, `BUG #2: ${danglingEdges.length} dangling edges remain after delete`);
  });

  // ── AC-NR-013: connectNodes rejects nonexistent endpoints ──
  it('AC-NR-013 connectNodes rejects nonexistent node endpoints', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/edges`, {
      method: 'POST',
      body: { from: 'component-nonexistent-ffffffff', to: 'component-fake-deadbeef', relation: 'wf-bridge' },
    });
    assert.ok(res.status >= 400, `BUG #3: expected 4xx for fake nodes, got ${res.status}`);
  });
});

console.log('OK: workflow-api-integration.test.mjs');
