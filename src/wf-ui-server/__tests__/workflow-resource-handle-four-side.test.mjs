import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Helpers (mirror workflow-node-runtime.test.mjs / workflow-magnetic-topology.test.mjs) ──
function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), '.tmp-fourside-test-' + id);
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({ schemaVersion: 1, version: 1, nodes: [], edges: [], positions: {}, undoStack: [], redoStack: [], deletedNodes: [] }));
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

let store;
let runtime;

before(async () => {
  store = await import('../a2a-store.mjs');
  runtime = await import('../workflow-node-runtime.mjs');
});

// Node index passed to normalizeWorkflowGraphEdge so the normalizer can resolve
// each endpoint's semantic type without persisting component-node state.
const TYPED_NODES = [
  { nodeId: 'md1', type: 'markdown' },
  { nodeId: 'md2', type: 'markdown' },
  { nodeId: 'ex1', type: 'excalidraw' },
  { nodeId: 'fi1', type: 'file' },
];

function typedNodeIdFor(type) {
  if (type === 'markdown') return 'md1';
  if (type === 'excalidraw') return 'ex1';
  if (type === 'file') return 'fi1';
  throw new Error(`unknown typed node for ${type}`);
}

// Normalize a single handle on a typed resource node from a given endpoint role.
function normalizeResourceHandle(root, type, handle, role) {
  const typedId = typedNodeIdFor(type);
  const edge = role === 'source'
    ? { id: 'e1', from: typedId, to: 'md2', sourceHandle: handle, relation: 'wf-bridge' }
    : { id: 'e1', from: 'md2', to: typedId, targetHandle: handle, relation: 'wf-bridge' };
  const out = store.normalizeWorkflowGraphEdge(root, edge, TYPED_NODES);
  return role === 'source' ? out.sourceHandle : out.targetHandle;
}

// ── Edge handle normalization (a2a-store) ──
describe('Resource four-side handle normalization (a2a-store)', () => {
  let root;
  before(() => { root = tempProjectRoot(); });
  after(() => cleanup(root));

  it('accepts markdown:top and markdown:bottom as physical sides (source + target)', () => {
    // Newly added top/bottom sides must be preserved verbatim.
    assert.equal(normalizeResourceHandle(root, 'markdown', 'markdown:top', 'source'), 'markdown:top');
    assert.equal(normalizeResourceHandle(root, 'markdown', 'markdown:top', 'target'), 'markdown:top');
    assert.equal(normalizeResourceHandle(root, 'markdown', 'markdown:bottom', 'source'), 'markdown:bottom');
    assert.equal(normalizeResourceHandle(root, 'markdown', 'markdown:bottom', 'target'), 'markdown:bottom');
  });

  it('still accepts markdown:left and markdown:right (no regression)', () => {
    assert.equal(normalizeResourceHandle(root, 'markdown', 'markdown:left', 'source'), 'markdown:left');
    assert.equal(normalizeResourceHandle(root, 'markdown', 'markdown:right', 'target'), 'markdown:right');
  });

  it('accepts scene:top and scene:bottom as physical sides', () => {
    assert.equal(normalizeResourceHandle(root, 'excalidraw', 'scene:top', 'source'), 'scene:top');
    assert.equal(normalizeResourceHandle(root, 'excalidraw', 'scene:top', 'target'), 'scene:top');
    assert.equal(normalizeResourceHandle(root, 'excalidraw', 'scene:bottom', 'source'), 'scene:bottom');
    assert.equal(normalizeResourceHandle(root, 'excalidraw', 'scene:bottom', 'target'), 'scene:bottom');
  });

  it('accepts file:top and file:bottom as physical sides', () => {
    assert.equal(normalizeResourceHandle(root, 'file', 'file:top', 'source'), 'file:top');
    assert.equal(normalizeResourceHandle(root, 'file', 'file:top', 'target'), 'file:top');
    assert.equal(normalizeResourceHandle(root, 'file', 'file:bottom', 'source'), 'file:bottom');
    assert.equal(normalizeResourceHandle(root, 'file', 'file:bottom', 'target'), 'file:bottom');
  });

  it('treats file:left and file:right as bidirectional (role-independent, no input/output split)', () => {
    // W6 + file input/output removal: the same physical side must be returned
    // regardless of whether the file node is the source or target endpoint.
    // Previously left=input / right=output; now both are plain bidirectional sides.
    assert.equal(normalizeResourceHandle(root, 'file', 'file:left', 'source'), 'file:left');
    assert.equal(normalizeResourceHandle(root, 'file', 'file:left', 'target'), 'file:left');
    assert.equal(normalizeResourceHandle(root, 'file', 'file:right', 'source'), 'file:right');
    assert.equal(normalizeResourceHandle(root, 'file', 'file:right', 'target'), 'file:right');
    // A semantic alias like "file" still resolves, but to a physical side (not an input/output).
    assert.equal(normalizeResourceHandle(root, 'file', 'file', 'source'), 'file:right');
    assert.equal(normalizeResourceHandle(root, 'file', 'file', 'target'), 'file:left');
  });

  it('keeps bare top/right/bottom/left aliases as physical sides before semantic fallback (W10)', () => {
    // Bare side strings must map to the primary semantic port on that physical
    // side, for ALL four sides, across all three resource kinds.
    assert.equal(normalizeResourceHandle(root, 'markdown', 'top', 'source'), 'markdown:top');
    assert.equal(normalizeResourceHandle(root, 'markdown', 'bottom', 'target'), 'markdown:bottom');
    assert.equal(normalizeResourceHandle(root, 'markdown', 'left', 'source'), 'markdown:left');
    assert.equal(normalizeResourceHandle(root, 'markdown', 'right', 'target'), 'markdown:right');
    assert.equal(normalizeResourceHandle(root, 'excalidraw', 'top', 'source'), 'scene:top');
    assert.equal(normalizeResourceHandle(root, 'excalidraw', 'bottom', 'source'), 'scene:bottom');
    assert.equal(normalizeResourceHandle(root, 'file', 'top', 'source'), 'file:top');
    assert.equal(normalizeResourceHandle(root, 'file', 'bottom', 'target'), 'file:bottom');
    assert.equal(normalizeResourceHandle(root, 'file', 'left', 'source'), 'file:left');
    assert.equal(normalizeResourceHandle(root, 'file', 'right', 'target'), 'file:right');
  });

  it('strips physical-side suffix from relation (W6: relation carries no side)', () => {
    // relation must never carry a physical-side suffix; it stays semantic-only.
    const edge = {
      id: 'rel-e1',
      from: 'md1',
      to: 'md2',
      relation: 'markdown:top',
      sourceHandle: 'markdown:top',
      targetHandle: 'markdown:bottom',
    };
    const out = store.normalizeWorkflowGraphEdge(root, edge, TYPED_NODES);
    assert.equal(out.relation, 'markdown', 'relation suffix :top must be stripped');
    assert.equal(out.sourceHandle, 'markdown:top');
    assert.equal(out.targetHandle, 'markdown:bottom');

    // scene / file side suffixes are stripped too.
    const sceneOut = store.normalizeWorkflowGraphEdge(root, {
      id: 'rel-e2', from: 'ex1', to: 'md2',
      relation: 'scene:bottom', sourceHandle: 'scene:bottom',
    }, TYPED_NODES);
    assert.equal(sceneOut.relation, 'scene');

    const fileOut = store.normalizeWorkflowGraphEdge(root, {
      id: 'rel-e3', from: 'fi1', to: 'md2',
      relation: 'file:left', sourceHandle: 'file:left',
    }, TYPED_NODES);
    assert.equal(fileOut.relation, 'file');
  });

  it('rejects undirected duplicate edges regardless of which side they use', () => {
    // Duplicate detection is unordered (A->B == B->A). The four-side expansion
    // must not weaken this: the same endpoint pair is still a duplicate.
    assert.throws(
      () => store.assertUniqueWorkflowEdgePairs([
        { id: 'a', from: 'md1', to: 'md2', relation: 'wf-bridge' },
        { id: 'b', from: 'md2', to: 'md1', relation: 'wf-bridge' },
      ]),
      (err) => err.code === 'DUPLICATE_EDGE',
    );
    // Even when handles are normalized to specific sides, the bidirectional
    // pair key collapses to the same unordered endpoint pair.
    const e1 = store.normalizeWorkflowGraphEdge(root, {
      id: 'x', from: 'md1', to: 'md2', sourceHandle: 'markdown:top', targetHandle: 'markdown:bottom',
    }, TYPED_NODES);
    const e2 = store.normalizeWorkflowGraphEdge(root, {
      id: 'y', from: 'md2', to: 'md1', sourceHandle: 'markdown:left', targetHandle: 'markdown:right',
    }, TYPED_NODES);
    assert.throws(
      () => store.assertUniqueWorkflowEdgePairs([e1, e2]),
      (err) => err.code === 'DUPLICATE_EDGE',
    );
  });
});

// ── Snapshot handles (workflow-node-runtime) ──
describe('Resource node snapshots expose 4 physical handles (workflow-node-runtime)', () => {
  let root;
  before(() => { root = tempProjectRoot(); });
  after(() => cleanup(root));

  const FOUR_SIDES = ['left', 'right', 'top', 'bottom'];

  it('markdown snapshot exposes markdown:{top,right,bottom,left} on one bidirectional port', async () => {
    const result = await runtime.createNode(root, { type: 'markdown', title: 'Four-side MD' });
    assert.ok(result.ok);
    const handles = result.node.graph.handles;
    assert.deepEqual(handles.bidirectional, ['markdown']);
    assert.deepEqual(handles.ports, ['markdown']);
    assert.deepEqual(handles.inputs, []);
    assert.deepEqual(handles.outputs, []);
    assert.deepEqual(handles.physical.sort(), FOUR_SIDES.map(side => `markdown:${side}`).sort());
  });

  it('excalidraw snapshot exposes scene:{top,right,bottom,left} on one bidirectional port', async () => {
    const result = await runtime.createNode(root, { type: 'excalidraw', title: 'Four-side Scene' });
    assert.ok(result.ok);
    const handles = result.node.graph.handles;
    assert.deepEqual(handles.bidirectional, ['scene']);
    assert.deepEqual(handles.ports, ['scene']);
    assert.deepEqual(handles.inputs, []);
    assert.deepEqual(handles.outputs, []);
    assert.deepEqual(handles.physical.sort(), FOUR_SIDES.map(side => `scene:${side}`).sort());
  });

  it('file snapshot exposes file:{top,right,bottom,left} with NO input/output split', async () => {
    const result = await runtime.createNode(root, {
      type: 'file',
      title: 'Four-side File',
      file: { source: 'workspace', path: 'README.md', name: 'README.md', mime: 'text/markdown', size: 100 },
    });
    assert.ok(result.ok);
    assert.equal(result.node.kind, 'file');
    const handles = result.node.graph.handles;
    // The input/output split is removed: file is a single bidirectional port.
    assert.deepEqual(handles.bidirectional, ['file']);
    assert.deepEqual(handles.ports, ['file']);
    assert.deepEqual(handles.inputs, []);
    assert.deepEqual(handles.outputs, []);
    assert.deepEqual(handles.physical.sort(), FOUR_SIDES.map(side => `file:${side}`).sort());
  });
});
