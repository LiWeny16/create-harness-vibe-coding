import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Helpers ──
function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), '.tmp-runtime-test-' + id);
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({ schemaVersion: 1, version: 1, nodes: [], edges: [], positions: {}, undoStack: [], redoStack: [], deletedNodes: [] }));
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

let runtime;
let graphStore;

before(async () => {
  runtime = await import('../workflow-node-runtime.mjs');
  graphStore = await import('../workflow-graph-store.mjs');
});

// ── Node CRUD ──
describe('Workflow Node Runtime', () => {
  let root;
  before(() => { root = tempProjectRoot(); });
  after(() => cleanup(root));

  it('creates a markdown node with settings', async () => {
    const result = await runtime.createNode(root, { type: 'markdown', title: 'Test MD' });
    assert.ok(result.ok);
    assert.equal(result.node.kind, 'markdown');
    assert.ok(result.state);
    assert.equal(result.state.type, 'markdown');
    assert.equal(result.node.ui.labels.title, 'Test MD');
  });

  it('creates an excalidraw node', async () => {
    const result = await runtime.createNode(root, { type: 'excalidraw', title: 'Test Draw' });
    assert.ok(result.ok);
    assert.equal(result.node.kind, 'excalidraw');
    assert.ok(result.state.scene);
    assert.ok(Array.isArray(result.state.scene.elements));
  });

  it('creates a file node', async () => {
    const result = await runtime.createNode(root, { type: 'file', title: 'Test File', file: { source: 'workspace', path: 'README.md', name: 'README.md', mime: 'text/markdown', size: 100 } });
    assert.ok(result.ok);
    assert.equal(result.node.kind, 'file');
    assert.equal(result.state.file.name, 'README.md');
  });

  it('lists created nodes', async () => {
    const result = await runtime.listNodes(root);
    assert.ok(Array.isArray(result.nodes));
    assert.ok(result.nodes.length >= 3, `expected >=3, got ${result.nodes.length}`);
  });

  it('reads a single node snapshot', async () => {
    const all = await runtime.listNodes(root);
    const nodeId = all.nodes[0].nodeId;
    const result = await runtime.getNode(root, nodeId);
    assert.ok(result.node);
    assert.equal(result.node.nodeId, nodeId);
    assert.ok(result.state);
  });

  it('updates node state with revision guard', async () => {
    const all = await runtime.listNodes(root);
    const md = all.nodes.find(n => n.kind === 'markdown');
    assert.ok(md, 'markdown node not found');
    const result = await runtime.updateNodeState(root, md.nodeId, { revision: md.version, markdown: '# Hello World' });
    assert.ok(result.ok);
    assert.ok(result.state.markdown.includes('Hello World'));
    assert.ok(result.revision > md.version);
  });

  it('rejects stale revision update', async () => {
    const all = await runtime.listNodes(root);
    const md = all.nodes.find(n => n.kind === 'markdown');
    await assert.rejects(
      () => runtime.updateNodeState(root, md.nodeId, { revision: 0, markdown: 'stale' }),
    );
  });

  it('updates node settings', async () => {
    const all = await runtime.listNodes(root);
    const md = all.nodes.find(n => n.kind === 'markdown');
    const result = await runtime.updateNodeSettings(root, md.nodeId, { editorMode: 'source', autoSave: true });
    assert.ok(result.settings);
    assert.ok(result.settings.values);
    assert.equal(result.settings.values.editorMode, 'source');
    assert.equal(result.settings.values.autoSave, true);
    assert.ok(result.settings.revision >= 1);
  });

  it('executes markdown.read action', async () => {
    const all = await runtime.listNodes(root);
    const md = all.nodes.find(n => n.kind === 'markdown');
    const result = await runtime.executeNodeAction(root, md.nodeId, 'markdown.read', {});
    assert.ok(result.ok);
    assert.equal(result.action, 'markdown.read');
    assert.ok(typeof result.result.markdown === 'string');
  });

  it('executes excalidraw.saveScene and revision increases', async () => {
    const all = await runtime.listNodes(root);
    const draw = all.nodes.find(n => n.kind === 'excalidraw');
    const scene = { elements: [{ id: 'e1', type: 'rectangle', x: 10, y: 20, width: 100, height: 80, strokeColor: '#6965DB', backgroundColor: '#e8e7ff' }], appState: { viewBackgroundColor: '#ffffff' }, files: {} };
    const result = await runtime.executeNodeAction(root, draw.nodeId, 'excalidraw.saveScene', { scene });
    assert.ok(result.ok);
    assert.ok(result.result.revision > draw.version);
    assert.ok(result.result.scene.elements.length > 0);
  });

  it('executes excalidraw.renderPreview returns non-empty', async () => {
    const all = await runtime.listNodes(root);
    const draw = all.nodes.find(n => n.kind === 'excalidraw');
    const result = await runtime.executeNodeAction(root, draw.nodeId, 'excalidraw.renderPreview', {});
    assert.ok(result.ok);
    assert.ok(Array.isArray(result.result.preview.elements));
    assert.ok(result.result.preview.hasContent);
  });

  it('executes file.readMeta', async () => {
    const all = await runtime.listNodes(root);
    const fileNode = all.nodes.find(n => n.kind === 'file');
    const result = await runtime.executeNodeAction(root, fileNode.nodeId, 'file.readMeta', {});
    assert.ok(result.ok);
    assert.equal(result.result.file.name, 'README.md');
  });

  it('rejects unknown action', async () => {
    const all = await runtime.listNodes(root);
    const md = all.nodes.find(n => n.kind === 'markdown');
    await assert.rejects(
      () => runtime.executeNodeAction(root, md.nodeId, 'markdown.flyToMoon', {}),
    );
  });

  it('deletes a node and cleans up', async () => {
    const all = await runtime.listNodes(root);
    const fileNode = all.nodes.find(n => n.kind === 'file');
    const result = await runtime.deleteNode(root, fileNode.nodeId);
    assert.ok(result.ok);
    const after = await runtime.listNodes(root);
    assert.ok(!after.nodes.some(n => n.nodeId === fileNode.nodeId));
  });

  it('returns node context with connected peers', async () => {
    const all = await runtime.listNodes(root);
    const md = all.nodes.find(n => n.kind === 'markdown');
    const ctx = await runtime.getNodeContext(root, md.nodeId);
    assert.ok(ctx.node);
    assert.ok(ctx.context);
    assert.ok(Array.isArray(ctx.node.graph.connections));
  });

  it('AC-007 exposes workflow links as bidirectional runtime connections with endpoint roles', async () => {
    const localRoot = tempProjectRoot();
    try {
      const source = await runtime.createNode(localRoot, { type: 'markdown', title: 'Source Notes' });
      const target = await runtime.createNode(localRoot, { type: 'excalidraw', title: 'Target Sketch' });
      graphStore.connectNodes(localRoot, {
        from: source.node.nodeId,
        to: target.node.nodeId,
        relation: 'context',
        sourceHandle: 'markdown',
        targetHandle: 'scene',
      });

      const sourceContext = await runtime.getNodeContext(localRoot, source.node.nodeId);
      const targetContext = await runtime.getNodeContext(localRoot, target.node.nodeId);
      const sourceConnection = sourceContext.node.graph.connections.find(item => item.peerNodeId === target.node.nodeId);
      const targetConnection = targetContext.node.graph.connections.find(item => item.peerNodeId === source.node.nodeId);

      assert.deepEqual(sourceConnection, {
        edgeId: `${source.node.nodeId}->${target.node.nodeId}`,
        peerNodeId: target.node.nodeId,
        endpointRole: 'source',
        localHandle: 'markdown',
        peerHandle: 'scene',
        sourceHandle: 'markdown',
        targetHandle: 'scene',
        relation: 'context',
        direction: 'bidirectional',
      });
      assert.deepEqual(targetConnection, {
        edgeId: `${source.node.nodeId}->${target.node.nodeId}`,
        peerNodeId: source.node.nodeId,
        endpointRole: 'target',
        localHandle: 'scene',
        peerHandle: 'markdown',
        sourceHandle: 'markdown',
        targetHandle: 'scene',
        relation: 'context',
        direction: 'bidirectional',
      });
    } finally {
      cleanup(localRoot);
    }
  });
});

// ── Graph Store ──
describe('Workflow Graph Store', () => {
  let root;
  let nodeA;
  let nodeB;
  before(async () => {
    root = tempProjectRoot();
    // Create real component nodes so endpoint validation passes
    const a = await runtime.createNode(root, { type: 'markdown', title: 'Graph Test A' });
    const b = await runtime.createNode(root, { type: 'excalidraw', title: 'Graph Test B' });
    nodeA = a.node.nodeId;
    nodeB = b.node.nodeId;
  });
  after(() => cleanup(root));

  it('connects two nodes semantically', () => {
    const result = graphStore.connectNodes(root, { from: nodeA, to: nodeB, relation: 'wf-bridge' });
    assert.ok(result.ok);
    assert.ok(result.edge);
    assert.equal(result.edge.from, nodeA);
    assert.equal(result.edge.to, nodeB);
  });

  it('prevents duplicate edge', () => {
    assert.throws(() => {
      graphStore.connectNodes(root, { from: nodeA, to: nodeB });
    }, /duplicate|exists|already/i);
  });

  it('AC-007 prevents reverse duplicate edges for bidirectional links', async () => {
    const localRoot = tempProjectRoot();
    try {
      const a = await runtime.createNode(localRoot, { type: 'markdown', title: 'Reverse A' });
      const b = await runtime.createNode(localRoot, { type: 'markdown', title: 'Reverse B' });
      graphStore.connectNodes(localRoot, { from: a.node.nodeId, to: b.node.nodeId, sourceHandle: 'markdown', targetHandle: 'markdown' });
      assert.throws(() => {
        graphStore.connectNodes(localRoot, { from: b.node.nodeId, to: a.node.nodeId, sourceHandle: 'markdown', targetHandle: 'markdown' });
      }, /duplicate|exists|already/i);
    } finally {
      cleanup(localRoot);
    }
  });

  it('reads connections for a node', () => {
    const result = graphStore.readConnections(root, nodeA);
    assert.equal(result.nodeId, nodeA);
    assert.ok(result.connections.length >= 1);
  });

  it('disconnects by edge id', () => {
    const before = graphStore.getGraphSnapshot(root);
    const edge = before.edges[0];
    const result = graphStore.disconnectNodes(root, edge.id);
    assert.ok(result.ok);
    const after = graphStore.getGraphSnapshot(root);
    assert.equal(after.edges.length, before.edges.length - 1);
  });

  it('rejects disconnect of nonexistent edge', () => {
    assert.throws(() => {
      graphStore.disconnectNodes(root, 'nonexistent-edge');
    }, /not found|NOT_FOUND|EDGE_NOT_FOUND/i);
  });

  it('rejects connect with nonexistent endpoint', () => {
    assert.throws(() => {
      graphStore.connectNodes(root, { from: nodeA, to: 'component-nonexistent-ffffffff' });
    }, /not found|ENDPOINT_NOT_FOUND/i);
  });

  it('getGraphSnapshot returns complete state', () => {
    const snapshot = graphStore.getGraphSnapshot(root);
    assert.ok(snapshot.nodes);
    assert.ok(snapshot.edges);
    assert.ok(snapshot.version >= 1);
  });
});
