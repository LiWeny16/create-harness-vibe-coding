import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';

async function loadFileNode() {
  return import('../workflow-node-types/file-node.mjs');
}

async function loadComponentStore() {
  return import('../component-node-store.mjs');
}

async function loadWorkspaceStore() {
  return import('../workspace-store.mjs');
}

function makeProject(prefix = 'wf-file-node-actions-') {
  const projectRoot = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(projectRoot, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  return projectRoot;
}

function createFileNode(projectRoot, store, filePayload) {
  return store.createComponentNode(projectRoot, {
    type: 'file',
    title: filePayload.title || 'File Node',
    file: filePayload.file,
  });
}

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('AC-038 file.meta returns metadata for the bound workspace file', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'notes.md'), '# Title\nbody\n');
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/notes.md', mime: 'text/markdown', name: 'notes.md', size: 0 },
    });

    const result = fileNode.meta(created.node.nodeId, projectRoot);
    assert.equal(result.file.path, 'src/notes.md');
    assert.equal(result.file.exists, true);
    assert.equal(result.file.stale, false);
    assert.equal(result.file.mime, 'text/markdown; charset=utf-8');
    assert.ok(result.file.size > 0);

    // Alias equivalence: file.meta and file.readMeta return the same shape.
    const readMetaResult = fileNode.readMeta(created.node.nodeId, projectRoot);
    assert.deepEqual(readMetaResult, result);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-038 file.writeText round-trips UTF-8 content through the workspace boundary', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'draft.txt'), 'old content\n');
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/draft.txt', mime: 'text/plain', name: 'draft.txt', size: 12 },
    });

    const payload = 'Hello — writeText round-trip · UTF-8 ✓\nsecond line\n';
    const result = fileNode.writeText(created.node.nodeId, projectRoot, { content: payload });
    assert.equal(result.ok, true);
    assert.equal(result.path, 'src/draft.txt');
    assert.equal(result.bytes, Buffer.byteLength(payload, 'utf8'));
    assert.equal(typeof result.mtime, 'string');
    assert.equal(typeof result.revision, 'number');
    assert.ok(result.revision > 0);

    // Round-trip: read it back via readText and via fs directly.
    const readResult = fileNode.readText(created.node.nodeId, projectRoot);
    assert.equal(readResult.text, payload);
    assert.equal(readResult.truncated, false);
    assert.equal(
      fs.readFileSync(path.join(projectRoot, 'src', 'draft.txt'), 'utf8'),
      payload,
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-038 file.writeText rejects non-string content', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'data.txt'), 'x');
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/data.txt', mime: 'text/plain', name: 'data.txt' },
    });

    assert.throws(
      () => fileNode.writeText(created.node.nodeId, projectRoot, { content: Buffer.from([1, 2, 3]) }),
      (err) => {
        assert.equal(err.code, 'BAD_REQUEST');
        assert.equal(err.constructor.name, 'ComponentNodeError');
        return true;
      },
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-038 file.writeText rejects paths that escape the workspace (defense-in-depth)', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'safe.txt'), 'x');
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/safe.txt', mime: 'text/plain', name: 'safe.txt' },
    });

    // Mutate the persisted state to point outside the workspace, simulating a
    // stale/drifted node. writeText must still refuse to escape via the
    // workspace boundary even though the node was tampered with.
    const statePath = path.join(projectRoot, created.node.statePath);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.file.path = '../outside-workspace.txt';
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    assert.throws(
      () => fileNode.writeText(created.node.nodeId, projectRoot, { content: 'escape' }),
      (err) => /outside workspace|traversal|escape/i.test(err.message || ''),
    );

    // And nothing should have been written outside the project root.
    assert.equal(fs.existsSync(path.join(projectRoot, '..', 'outside-workspace.txt')), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-038 file.preview returns previewKind and bounded snippet for text-like files', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    const body = '# Markdown Title\n\nparagraph text here\n';
    fs.writeFileSync(path.join(projectRoot, 'src', 'doc.md'), body);
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/doc.md', mime: 'text/markdown', name: 'doc.md' },
    });

    const result = fileNode.preview(created.node.nodeId, projectRoot);
    assert.equal(result.ok, true);
    assert.equal(result.path, 'src/doc.md');
    assert.equal(result.previewKind, 'text');
    assert.equal(result.available, true);
    assert.equal(result.mime, 'text/markdown; charset=utf-8');
    assert.equal(typeof result.size, 'number');
    assert.ok(result.size > 0);
    assert.equal(result.textSnippet, body);
    assert.equal(result.textTruncated, false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-038 file.preview returns image previewKind for PNG fixtures', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'pixel.png'), Buffer.from(TINY_PNG_BASE64, 'base64'));
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/pixel.png', mime: 'image/png', name: 'pixel.png' },
    });

    const result = fileNode.preview(created.node.nodeId, projectRoot);
    assert.equal(result.ok, true);
    assert.equal(result.previewKind, 'image');
    assert.equal(result.available, true);
    assert.equal(result.mime, 'image/png');
    assert.equal(Object.hasOwn(result, 'textSnippet'), false,
      'image preview must not include a text snippet');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-038 file.preview reports missing files without throwing', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/ghost.txt', mime: 'text/plain', name: 'ghost.txt' },
    });

    const result = fileNode.preview(created.node.nodeId, projectRoot);
    assert.equal(result.ok, true);
    assert.equal(result.available, false);
    assert.equal(result.previewKind, 'missing');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-038 file.preview returns previewKind pdf without extracting any text', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    // Preview only stats the file and classifies by mime/extension; the backend
    // performs NO PDF text extraction. Content need not be a valid PDF body.
    fs.writeFileSync(path.join(projectRoot, 'src', 'doc.pdf'), Buffer.from('%PDF-1.4 placeholder\n'));
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/doc.pdf', mime: 'application/pdf', name: 'doc.pdf' },
    });

    const result = fileNode.preview(created.node.nodeId, projectRoot);
    assert.equal(result.ok, true);
    assert.equal(result.previewKind, 'pdf');
    assert.equal(result.available, true);
    assert.equal(result.mime, 'application/pdf');
    assert.equal(Object.hasOwn(result, 'textSnippet'), false,
      'PDF preview must not extract or return any text snippet');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-038 file actions never directly mutate Harness/a2a component or event state files', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'audit.txt'), 'start\n');
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/audit.txt', mime: 'text/plain', name: 'audit.txt' },
    });

    const componentStatePath = path.join(projectRoot, created.node.statePath);
    const stateBefore = fs.readFileSync(componentStatePath, 'utf8');

    fileNode.meta(created.node.nodeId, projectRoot);
    fileNode.readText(created.node.nodeId, projectRoot);
    fileNode.preview(created.node.nodeId, projectRoot);
    fileNode.writeText(created.node.nodeId, projectRoot, { content: 'updated by action\n' });

    const stateAfter = fs.readFileSync(componentStatePath, 'utf8');
    assert.equal(stateAfter, stateBefore,
      'file.* actions must not mutate the component-node state.json directly');

    // The file content on disk IS expected to change via writeText, but that
    // goes through the workspace boundary, not through node state mutation.
    assert.equal(
      fs.readFileSync(path.join(projectRoot, 'src', 'audit.txt'), 'utf8'),
      'updated by action\n',
    );

    // workspace-ops.jsonl should record the write (proves we routed through the boundary).
    const { workspaceOpsLogPath } = await loadWorkspaceStore();
    const opsLog = workspaceOpsLogPath(projectRoot);
    assert.ok(fs.existsSync(opsLog), 'writeText should append to workspace-ops.jsonl');
    const ops = fs.readFileSync(opsLog, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(ops.some((row) => row.op === 'write' && row.target === 'src/audit.txt'),
      'workspace-ops log must contain the write row');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-038 file.writeText requires an existing file target (no implicit create)', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/never-created.txt', mime: 'text/plain', name: 'never-created.txt' },
    });

    assert.throws(
      () => fileNode.writeText(created.node.nodeId, projectRoot, { content: 'payload' }),
      (err) => /not found/i.test(err.message || ''),
    );
    assert.equal(fs.existsSync(path.join(projectRoot, 'src', 'never-created.txt')), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
