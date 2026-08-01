import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';

async function loadWorkspaceStore() {
  return import('../workspace-store.mjs');
}

function makeProject() {
  const projectRoot = makeHarnessTempRoot('wf-workspace-store-');
  fs.mkdirSync(path.join(projectRoot, 'Harness', 'tasks'), { recursive: true });
  return projectRoot;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

test('AC-001 workspace tree store returns a root-bounded lazy metadata listing', async () => {
  const projectRoot = makeProject();
  try {
    fs.mkdirSync(path.join(projectRoot, 'src', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'app.js'), 'console.log("ok");\n');

    const { listWorkspaceTree } = await loadWorkspaceStore();
    const listing = listWorkspaceTree(projectRoot, { path: 'src' });

    assert.equal(listing.root, projectRoot);
    assert.equal(listing.path, 'src');
    assert.equal(listing.absolutePath, path.join(projectRoot, 'src'));
    assert.ok(Array.isArray(listing.entries));
    assert.equal(listing.entries.some(entry => entry.path === 'src/app.js' && entry.type === 'file'), true);
    assert.equal(listing.entries.some(entry => entry.path === 'src/nested' && entry.type === 'directory' && entry.hasChildren === false), true);
    for (const entry of listing.entries) {
      assert.equal(path.isAbsolute(entry.path), false, 'entry.path should be repo-relative');
      assert.equal(typeof entry.name, 'string');
      assert.match(entry.path, /^[^\\]+(?:\/[^\\]+)*$/);
      assert.ok(entry.type === 'file' || entry.type === 'directory');
      assert.equal(typeof entry.size, 'number');
      assert.equal(typeof entry.mtime, 'string');
      assert.equal(typeof entry.hasChildren, 'boolean');
      assert.equal(Object.hasOwn(entry, 'children'), false, 'lazy listing should not inline child arrays');
    }
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-001 workspace tree store denies traversal and reports missing directories', async () => {
  const projectRoot = makeProject();
  try {
    const { listWorkspaceTree } = await loadWorkspaceStore();

    assert.throws(() => listWorkspaceTree(projectRoot, { path: '../outside' }), {
      name: 'Error',
      message: /outside workspace|traversal|escape/i,
    });
    assert.throws(() => listWorkspaceTree(projectRoot, { path: 'missing-folder' }), {
      name: 'Error',
      message: /not found|missing/i,
    });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-002 workspace operations write disk, append JSONL records, and undo by latest or opId', async () => {
  const projectRoot = makeProject();
  try {
    const {
      applyWorkspaceOperation,
      undoWorkspaceOperation,
      workspaceOpsLogPath,
    } = await loadWorkspaceStore();

    const createdFile = await applyWorkspaceOperation(projectRoot, {
      op: 'create-file',
      target: 'src/new.txt',
      contentBase64: Buffer.from('v1', 'utf8').toString('base64'),
    });
    assert.equal(createdFile.ok, true);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'src', 'new.txt'), 'utf8'), 'v1');

    const wrote = await applyWorkspaceOperation(projectRoot, {
      op: 'write',
      target: 'src/new.txt',
      contentBase64: Buffer.from('v2', 'utf8').toString('base64'),
    });
    assert.equal(wrote.ok, true);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'src', 'new.txt'), 'utf8'), 'v2');

    const renamed = await applyWorkspaceOperation(projectRoot, {
      op: 'rename',
      source: 'src/new.txt',
      target: 'src/renamed.txt',
    });
    assert.equal(renamed.ok, true);
    assert.equal(fs.existsSync(path.join(projectRoot, 'src', 'new.txt')), false);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'src', 'renamed.txt'), 'utf8'), 'v2');

    const copied = await applyWorkspaceOperation(projectRoot, {
      op: 'copy',
      source: 'src/renamed.txt',
      target: 'src/copy.txt',
    });
    assert.equal(copied.ok, true);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'src', 'copy.txt'), 'utf8'), 'v2');

    const moved = await applyWorkspaceOperation(projectRoot, {
      op: 'move',
      source: 'src/copy.txt',
      target: 'src/nested/copy.txt',
    });
    assert.equal(moved.ok, true);
    assert.equal(fs.existsSync(path.join(projectRoot, 'src', 'copy.txt')), false);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'src', 'nested', 'copy.txt'), 'utf8'), 'v2');

    const folder = await applyWorkspaceOperation(projectRoot, {
      op: 'create-folder',
      target: 'notes',
    });
    assert.equal(folder.ok, true);
    assert.equal(fs.statSync(path.join(projectRoot, 'notes')).isDirectory(), true);

    const logPath = workspaceOpsLogPath(projectRoot);
    const logRows = readJsonl(logPath);
    assert.equal(logPath, path.join(projectRoot, 'Harness', 'a2a', 'workspace-ops.jsonl'));
    assert.deepEqual(logRows.map(row => row.op), ['create-file', 'write', 'rename', 'copy', 'move', 'create-folder']);
    for (const row of logRows) {
      assert.equal(typeof row.opId, 'string');
      assert.equal(typeof row.revision, 'number');
      assert.equal(row.undoable, true);
      assert.equal(typeof row.createdAt, 'string');
    }

    const undoLatest = await undoWorkspaceOperation(projectRoot, { opId: 'latest' });
    assert.equal(undoLatest.ok, true);
    assert.equal(undoLatest.undoneOpId, folder.opId);
    assert.equal(fs.existsSync(path.join(projectRoot, 'notes')), false);

    const undoMove = await undoWorkspaceOperation(projectRoot, { opId: moved.opId });
    assert.equal(undoMove.ok, true);
    assert.equal(fs.existsSync(path.join(projectRoot, 'src', 'nested', 'copy.txt')), false);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'src', 'copy.txt'), 'utf8'), 'v2');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-002 delete moves to same-volume trash and undo restores without recursive copy', async () => {
  const projectRoot = makeProject();
  try {
    const { applyWorkspaceOperation, undoWorkspaceOperation } = await loadWorkspaceStore();
    fs.mkdirSync(path.join(projectRoot, 'docs', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'deep', 'guide.md'), '# Guide\n');

    const deleted = await applyWorkspaceOperation(projectRoot, {
      op: 'delete',
      source: 'docs',
    });

    assert.equal(deleted.ok, true);
    assert.equal(deleted.undoable, true);
    assert.equal(fs.existsSync(path.join(projectRoot, 'docs')), false);
    assert.equal(path.dirname(deleted.trashPath), path.join(projectRoot, 'Harness', '.trash', 'workspace-ops', deleted.opId));
    assert.equal(fs.readFileSync(path.join(deleted.trashPath, 'deep', 'guide.md'), 'utf8'), '# Guide\n');
    assert.equal(path.parse(deleted.trashPath).root.toLowerCase(), path.parse(projectRoot).root.toLowerCase());
    assert.equal(deleted.strategy, 'rename-to-trash');

    const restored = await undoWorkspaceOperation(projectRoot, { opId: deleted.opId });
    assert.equal(restored.ok, true);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'docs', 'deep', 'guide.md'), 'utf8'), '# Guide\n');
    assert.equal(fs.existsSync(deleted.trashPath), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-002 workspace operations reject traversal and overwrite conflicts', async () => {
  const projectRoot = makeProject();
  try {
    const { applyWorkspaceOperation } = await loadWorkspaceStore();
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'existing.txt'), 'keep');

    assert.throws(() => applyWorkspaceOperation(projectRoot, {
      op: 'create-file',
      target: '../escape.txt',
      contentBase64: Buffer.from('bad').toString('base64'),
    }), /outside workspace|traversal|escape/i);

    assert.throws(() => applyWorkspaceOperation(projectRoot, {
      op: 'create-file',
      target: 'src/existing.txt',
      contentBase64: Buffer.from('replace').toString('base64'),
    }), /exists|overwrite/i);

    assert.equal(fs.readFileSync(path.join(projectRoot, 'src', 'existing.txt'), 'utf8'), 'keep');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
