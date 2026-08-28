import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';

async function loadComponentNodeStore() {
  return import('../component-node-store.mjs');
}

function makeProject(prefix = 'wf-component-node-store-') {
  const projectRoot = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(projectRoot, 'Harness', 'tasks'), { recursive: true });
  return projectRoot;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function assertStatePathUnderComponentRoot(projectRoot, node) {
  assert.equal(path.isAbsolute(node.statePath), false, 'statePath should be repo-relative for agent context');
  assert.match(node.statePath.replace(/\\/g, '/'), /^Harness\/a2a\/component-nodes\/[^/]+\/state\.json$/);
  const absoluteStatePath = path.join(projectRoot, node.statePath);
  const componentRoot = path.join(projectRoot, 'Harness', 'a2a', 'component-nodes');
  assert.ok(path.resolve(absoluteStatePath).startsWith(path.resolve(componentRoot)), 'state file must stay under component node root');
  assert.ok(fs.existsSync(absoluteStatePath), 'backend-owned state file should exist');
  return absoluteStatePath;
}

function assertCommonNodeContract(projectRoot, node, expected) {
  assert.equal(node.kind, 'component-node');
  assert.equal(node.type, expected.type);
  assert.equal(node.title, expected.title);
  assert.equal(typeof node.nodeId, 'string');
  assert.equal(node.id, node.nodeId);
  assert.match(node.nodeId, /^component-[a-z0-9][a-z0-9-]*$/);
  assert.deepEqual(node.position, expected.position);
  assert.equal(node.revision, 1);
  assert.deepEqual(node.stateRef, { path: node.statePath, revision: node.revision });
  assert.deepEqual(node.config, {
    componentType: expected.type,
    editable: true,
    backendSourceOfTruth: true,
  });
  assertStatePathUnderComponentRoot(projectRoot, node);
}

test('AC-006 createComponentNode writes markdown node graph metadata and backend-owned Markdown state', async () => {
  const projectRoot = makeProject();
  try {
    const { createComponentNode, getComponentNode } = await loadComponentNodeStore();

    const created = createComponentNode(projectRoot, {
      type: 'markdown',
      title: 'Implementation Notes',
      position: { x: 120, y: 80 },
      markdown: '# Notes\n\n- RED first\n',
    });

    assert.equal(created.ok, true);
    assertCommonNodeContract(projectRoot, created.node, {
      type: 'markdown',
      title: 'Implementation Notes',
      position: { x: 120, y: 80 },
    });
    assert.equal(created.state.type, 'markdown');
    assert.equal(created.state.markdown, '# Notes\n\n- RED first\n');
    assert.deepEqual(created.state.uiContract, {
      editor: 'markdown',
      modes: ['wysiwyg', 'source'],
      defaultMode: 'wysiwyg',
    });
    assert.deepEqual(created.state.inputs, [
      { id: 'markdown', type: 'markdown', label: 'Markdown' },
    ]);
    assert.deepEqual(created.state.outputs, [
      { id: 'markdown', type: 'markdown', label: 'Markdown' },
      { id: 'plainText', type: 'text', label: 'Plain text' },
    ]);

    const persisted = readJson(path.join(projectRoot, created.node.statePath));
    assert.deepEqual(persisted, created.state);

    const fetched = getComponentNode(projectRoot, created.node.nodeId);
    assert.deepEqual(fetched.node, created.node);
    assert.deepEqual(fetched.state, created.state);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-006 createComponentNode writes excalidraw node graph metadata and backend-owned scene state', async () => {
  const projectRoot = makeProject();
  try {
    const { createComponentNode } = await loadComponentNodeStore();
    const scene = {
      elements: [
        { id: 'box-1', type: 'rectangle', x: 10, y: 20, width: 100, height: 60, versionNonce: 1 },
      ],
      appState: { viewBackgroundColor: '#ffffff', name: 'Architecture' },
      files: {},
    };

    const created = createComponentNode(projectRoot, {
      type: 'excalidraw',
      title: 'Workflow Sketch',
      position: { x: 420, y: 160 },
      scene,
    });

    assert.equal(created.ok, true);
    assertCommonNodeContract(projectRoot, created.node, {
      type: 'excalidraw',
      title: 'Workflow Sketch',
      position: { x: 420, y: 160 },
    });
    assert.equal(created.state.type, 'excalidraw');
    assert.deepEqual(created.state.scene, scene);
    assert.deepEqual(created.state.uiContract, {
      editor: 'excalidraw',
      modes: ['canvas'],
      defaultMode: 'canvas',
    });
    assert.deepEqual(created.state.inputs, [
      { id: 'scene', type: 'excalidraw-scene', label: 'Scene' },
    ]);
    assert.deepEqual(created.state.outputs, [
      { id: 'scene', type: 'excalidraw-scene', label: 'Scene' },
      { id: 'image', type: 'image', label: 'Rendered image' },
    ]);
    assert.deepEqual(readJson(path.join(projectRoot, created.node.statePath)), created.state);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-002 createComponentNode writes file resource node metadata without copying workspace references', async () => {
  const projectRoot = makeProject();
  try {
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'input.png'), 'png-bytes');
    const { createComponentNode, getComponentNode } = await loadComponentNodeStore();

    const created = createComponentNode(projectRoot, {
      type: 'file',
      title: 'input.png',
      position: { x: 180, y: 120 },
      file: {
        source: 'workspace',
        path: 'src/input.png',
        name: 'input.png',
        mime: 'image/png',
        size: 9,
      },
    });

    assert.equal(created.ok, true);
    assert.equal(created.node.kind, 'component-node');
    assert.equal(created.node.type, 'file');
    assert.equal(created.node.config.componentType, 'file');
    assert.deepEqual(created.state.file, {
      source: 'workspace',
      kind: 'file',
      path: 'src/input.png',
      name: 'input.png',
      mime: 'image/png',
      size: 9,
    });
    assert.deepEqual(created.state.uiContract, {
      editor: 'file-preview',
      modes: ['preview', 'metadata'],
      defaultMode: 'preview',
    });
    assert.ok(created.state.outputs.some(output => output.id === 'file' && output.type === 'file-ref'));
    assert.equal(fs.readFileSync(path.join(projectRoot, 'src', 'input.png'), 'utf8'), 'png-bytes');
    assert.deepEqual(getComponentNode(projectRoot, created.node.nodeId).state.file, created.state.file);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-006 updateComponentNode enforces revision match and records recovery metadata', async () => {
  const projectRoot = makeProject();
  try {
    const {
      createComponentNode,
      getComponentNode,
      updateComponentNode,
      componentNodeRevisionLogPath,
    } = await loadComponentNodeStore();

    const created = createComponentNode(projectRoot, {
      type: 'markdown',
      title: 'Editable Notes',
      position: { x: 0, y: 0 },
      markdown: 'v1',
    });

    const updated = updateComponentNode(projectRoot, created.node.nodeId, {
      revision: created.node.revision,
      markdown: 'v2',
    });

    assert.equal(updated.ok, true);
    assert.equal(updated.node.revision, 2);
    assert.equal(updated.state.revision, 2);
    assert.equal(updated.state.markdown, 'v2');
    assert.equal(getComponentNode(projectRoot, created.node.nodeId).state.markdown, 'v2');

    assert.throws(() => updateComponentNode(projectRoot, created.node.nodeId, {
      revision: created.node.revision,
      markdown: 'stale overwrite',
    }), (err) => {
      assert.equal(err.code, 'STALE_REVISION');
      assert.match(err.message, /stale|revision/i);
      return true;
    });

    const afterStale = getComponentNode(projectRoot, created.node.nodeId);
    assert.equal(afterStale.node.revision, 2);
    assert.equal(afterStale.state.markdown, 'v2');

    const revisionRows = readJsonl(componentNodeRevisionLogPath(projectRoot, created.node.nodeId));
    assert.equal(revisionRows.length, 2);
    assert.deepEqual(revisionRows.map(row => row.revision), [1, 2]);
    assert.equal(revisionRows[1].previousRevision, 1);
    assert.equal(revisionRows[1].statePath, created.node.statePath);
    assert.ok(revisionRows[1].recoverable, 'component edits should expose revisioned recovery metadata');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-006 updateComponentNode stores excalidraw scene JSON with revision guard', async () => {
  const projectRoot = makeProject();
  try {
    const { createComponentNode, getComponentNode, updateComponentNode } = await loadComponentNodeStore();
    const created = createComponentNode(projectRoot, {
      type: 'excalidraw',
      title: 'Editable Sketch',
      position: { x: 20, y: 30 },
      scene: { elements: [], appState: {}, files: {} },
    });
    const nextScene = {
      elements: [{ id: 'arrow-1', type: 'arrow', x: 1, y: 2, points: [[0, 0], [120, 0]], versionNonce: 2 }],
      appState: { name: 'Updated Sketch', viewBackgroundColor: '#f8fafc' },
      files: { 'file-1': { id: 'file-1', mimeType: 'image/png', dataURL: 'data:image/png;base64,aW1hZ2U=' } },
    };

    const updated = updateComponentNode(projectRoot, created.node.nodeId, {
      revision: created.node.revision,
      scene: nextScene,
    });

    assert.equal(updated.node.revision, 2);
    assert.deepEqual(updated.state.scene, nextScene);
    assert.deepEqual(getComponentNode(projectRoot, created.node.nodeId).state.scene, nextScene);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-006 listComponentNodes returns snapshot-ready refs without inlining frontend-local state', async () => {
  const projectRoot = makeProject();
  try {
    const { createComponentNode, listComponentNodes } = await loadComponentNodeStore();
    const markdown = createComponentNode(projectRoot, {
      type: 'markdown',
      title: 'Spec',
      position: { x: 10, y: 10 },
      markdown: '# Spec\n',
    });
    const excalidraw = createComponentNode(projectRoot, {
      type: 'excalidraw',
      title: 'Diagram',
      position: { x: 240, y: 10 },
      scene: { elements: [], appState: {}, files: {} },
    });

    const list = listComponentNodes(projectRoot);

    assert.deepEqual(list.map(item => item.nodeId).sort(), [markdown.node.nodeId, excalidraw.node.nodeId].sort());
    for (const item of list) {
      assert.equal(item.kind, 'component-node');
      assert.equal(typeof item.revision, 'number');
      assert.ok(item.stateRef);
      assert.equal(item.stateRef.path, item.statePath);
      assert.equal(item.stateRef.revision, item.revision);
      assert.equal(Object.hasOwn(item, 'markdown'), false, 'snapshot node ref should not inline Markdown');
      assert.equal(Object.hasOwn(item, 'scene'), false, 'snapshot node ref should not inline Excalidraw scene');
    }
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-006 componentNodeStates rejects corrupt persisted state instead of hydrating defaults', async () => {
  const projectRoot = makeProject();
  try {
    const { componentNodeStates, createComponentNode } = await loadComponentNodeStore();
    const created = createComponentNode(projectRoot, {
      type: 'excalidraw',
      title: 'Corrupt Scene Guard',
      position: { x: 10, y: 10 },
      scene: { elements: [], appState: {}, files: {} },
    });
    fs.writeFileSync(path.join(projectRoot, created.node.statePath), `${JSON.stringify({
      type: 'excalidraw',
      revision: created.node.revision,
      inputs: created.state.inputs,
      outputs: created.state.outputs,
    }, null, 2)}\n`, 'utf8');

    assert.throws(
      () => componentNodeStates(projectRoot),
      /scene is missing|out of sync|STATE_MISMATCH/i,
      'snapshot hydration must not silently replace corrupt persisted state with an empty scene',
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-006 deleteComponentNode removes stale index entries when state files are missing', async () => {
  const projectRoot = makeProject();
  try {
    const { createComponentNode, deleteComponentNode, getComponentNode, listComponentNodes } = await loadComponentNodeStore();
    const created = createComponentNode(projectRoot, {
      type: 'markdown',
      title: 'Stale Markdown',
      position: { x: 10, y: 10 },
      markdown: 'stale',
    });
    fs.rmSync(path.join(projectRoot, created.node.statePath), { force: true });

    assert.throws(
      () => getComponentNode(projectRoot, created.node.nodeId),
      /missing|out of sync|STATE_MISMATCH/i,
    );
    const deleted = deleteComponentNode(projectRoot, created.node.nodeId);

    assert.equal(deleted.ok, true);
    assert.equal(deleted.nodeId, created.node.nodeId);
    assert.equal(listComponentNodes(projectRoot).some(node => node.nodeId === created.node.nodeId), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-006 component node store rejects invalid types, traversal ids, and escaped mutable state paths', async () => {
  const projectRoot = makeProject();
  try {
    const {
      componentNodesIndexPath,
      createComponentNode,
      getComponentNode,
      updateComponentNode,
    } = await loadComponentNodeStore();

    assert.throws(() => createComponentNode(projectRoot, {
      type: 'terminal',
      title: 'Invalid',
      position: { x: 0, y: 0 },
    }), /component type|markdown|excalidraw|invalid/i);

    assert.throws(() => createComponentNode(projectRoot, {
      nodeId: '../escape',
      type: 'markdown',
      title: 'Escape',
      position: { x: 0, y: 0 },
      markdown: 'bad',
    }), /node id|traversal|outside|escape/i);

    const created = createComponentNode(projectRoot, {
      type: 'markdown',
      title: 'Safe',
      position: { x: 0, y: 0 },
      markdown: 'safe',
    });
    const indexPath = componentNodesIndexPath(projectRoot);
    const index = readJson(indexPath);
    index.nodes = index.nodes.map(node => node.nodeId === created.node.nodeId
      ? { ...node, statePath: '../outside/state.json', stateRef: { path: '../outside/state.json', revision: node.revision } }
      : node);
    fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

    assert.throws(() => getComponentNode(projectRoot, created.node.nodeId), /state path|traversal|outside|escape/i);
    assert.throws(() => updateComponentNode(projectRoot, '../escape', { revision: 1, markdown: 'bad' }), /node id|traversal|outside|escape/i);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
