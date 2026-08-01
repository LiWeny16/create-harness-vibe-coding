import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';

async function loadWorkspaceStore() {
  return import('../workspace-store.mjs');
}

function makeProject(prefix = 'wf-workspace-store-hardening-') {
  const projectRoot = makeHarnessTempRoot(prefix);
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

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function contentBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function createEscapeDirectoryLink(t, projectRoot) {
  const outsideRoot = makeHarnessTempRoot('wf-workspace-outside-');
  fs.writeFileSync(path.join(outsideRoot, 'secret.txt'), 'outside-secret', 'utf8');
  const linkPath = path.join(projectRoot, 'linked-outside');
  try {
    fs.symlinkSync(outsideRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    fs.rmSync(outsideRoot, { recursive: true, force: true });
    t.skip(`Symlink/junction creation unavailable on this platform: ${err.message}`);
    return null;
  }
  return { outsideRoot, linkPath };
}

test('AC-002 hardening rejects malformed base64 for create-file without writing corrupt data', async () => {
  const projectRoot = makeProject();
  try {
    const { applyWorkspaceOperation } = await loadWorkspaceStore();

    assert.throws(() => applyWorkspaceOperation(projectRoot, {
      op: 'create-file',
      target: 'src/corrupt.txt',
      contentBase64: 'not-valid-base64!!!',
    }), /base64|invalid|malformed/i);
    assert.equal(fs.existsSync(path.join(projectRoot, 'src', 'corrupt.txt')), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-002 hardening rejects malformed base64 for write without changing existing content', async () => {
  const projectRoot = makeProject();
  try {
    const { applyWorkspaceOperation } = await loadWorkspaceStore();
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'existing.txt'), 'keep', 'utf8');

    assert.throws(() => applyWorkspaceOperation(projectRoot, {
      op: 'write',
      target: 'src/existing.txt',
      contentBase64: '!!!!',
    }), /base64|invalid|malformed/i);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'src', 'existing.txt'), 'utf8'), 'keep');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-001 hardening workspace tree rejects symlink or junction escapes instead of following them', async (t) => {
  const projectRoot = makeProject();
  let linkFixture;
  try {
    linkFixture = createEscapeDirectoryLink(t, projectRoot);
    if (!linkFixture) return;
    const { listWorkspaceTree } = await loadWorkspaceStore();

    assert.throws(() => listWorkspaceTree(projectRoot, { path: 'linked-outside' }), /symlink|junction|outside workspace|escape/i);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    if (linkFixture?.outsideRoot) fs.rmSync(linkFixture.outsideRoot, { recursive: true, force: true });
  }
});

test('AC-002 hardening workspace write rejects symlink or junction escapes before mutating outside files', async (t) => {
  const projectRoot = makeProject();
  let linkFixture;
  try {
    linkFixture = createEscapeDirectoryLink(t, projectRoot);
    if (!linkFixture) return;
    const { applyWorkspaceOperation } = await loadWorkspaceStore();

    assert.throws(() => applyWorkspaceOperation(projectRoot, {
      op: 'write',
      target: 'linked-outside/secret.txt',
      contentBase64: contentBase64('mutated'),
    }), /symlink|junction|outside workspace|escape/i);
    assert.equal(fs.readFileSync(path.join(linkFixture.outsideRoot, 'secret.txt'), 'utf8'), 'outside-secret');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    if (linkFixture?.outsideRoot) fs.rmSync(linkFixture.outsideRoot, { recursive: true, force: true });
  }
});

test('AC-004 hardening terminal context builder rejects symlink or junction escaped workspace files', async (t) => {
  const projectRoot = makeProject();
  let linkFixture;
  try {
    linkFixture = createEscapeDirectoryLink(t, projectRoot);
    if (!linkFixture) return;
    const { buildTerminalContextInput } = await loadWorkspaceStore();

    assert.throws(() => buildTerminalContextInput(projectRoot, {
      items: [{ kind: 'workspace-file', path: 'linked-outside/secret.txt', format: 'tag' }],
    }), /symlink|junction|outside workspace|escape/i);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    if (linkFixture?.outsideRoot) fs.rmSync(linkFixture.outsideRoot, { recursive: true, force: true });
  }
});

test('AC-002 hardening rejects stale non-latest undo when later operations affect the same path', async () => {
  const projectRoot = makeProject();
  try {
    const { applyWorkspaceOperation, undoWorkspaceOperation } = await loadWorkspaceStore();

    const created = applyWorkspaceOperation(projectRoot, {
      op: 'create-file',
      target: 'src/a.txt',
      contentBase64: contentBase64('v1'),
    });
    applyWorkspaceOperation(projectRoot, {
      op: 'write',
      target: 'src/a.txt',
      contentBase64: contentBase64('v2'),
    });

    assert.throws(() => undoWorkspaceOperation(projectRoot, { opId: created.opId }), /conflict|stale|newer|latest/i);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'src', 'a.txt'), 'utf8'), 'v2');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-002 hardening restore-trash validates mutable JSONL source remains under the op trash root', async () => {
  const projectRoot = makeProject();
  const outsideRoot = makeHarnessTempRoot('wf-trash-corrupt-outside-');
  try {
    const { applyWorkspaceOperation, undoWorkspaceOperation, workspaceOpsLogPath } = await loadWorkspaceStore();
    fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'a.txt'), 'original', 'utf8');
    const outsideFile = path.join(outsideRoot, 'outside.txt');
    fs.writeFileSync(outsideFile, 'outside', 'utf8');

    const deleted = applyWorkspaceOperation(projectRoot, {
      op: 'delete',
      source: 'docs/a.txt',
    });
    const logPath = workspaceOpsLogPath(projectRoot);
    const rows = readJsonl(logPath);
    const row = rows.find(candidate => candidate.opId === deleted.opId);
    row.inverse.source = outsideFile;
    writeJsonl(logPath, rows);

    assert.throws(() => undoWorkspaceOperation(projectRoot, { opId: deleted.opId }), /trash|corrupt|outside|escape/i);
    assert.equal(fs.existsSync(outsideFile), true);
    assert.equal(fs.existsSync(path.join(projectRoot, 'docs', 'a.txt')), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('AC-002 hardening workspace operations serialize revision assignment under reentrant writes', async () => {
  const projectRoot = makeProject();
  const originalWriteFileSync = fs.writeFileSync;
  try {
    const store = await loadWorkspaceStore();
    let reentered = false;
    fs.writeFileSync = function patchedWriteFileSync(filePath, ...args) {
      const normalized = String(filePath).replace(/\\/g, '/');
      if (!reentered && normalized.endsWith('/concurrent/a.txt')) {
        reentered = true;
        store.applyWorkspaceOperation(projectRoot, {
          op: 'create-file',
          target: 'concurrent/b.txt',
          contentBase64: contentBase64('b'),
        });
      }
      return originalWriteFileSync.call(this, filePath, ...args);
    };

    store.applyWorkspaceOperation(projectRoot, {
      op: 'create-file',
      target: 'concurrent/a.txt',
      contentBase64: contentBase64('a'),
    });

    const revisions = readJsonl(store.workspaceOpsLogPath(projectRoot)).map(row => row.revision);
    assert.equal(new Set(revisions).size, revisions.length, `duplicate revisions observed: ${revisions.join(', ')}`);
    assert.deepEqual([...revisions].sort((a, b) => a - b), [1, 2]);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-002 AC-003 hardening rejects Windows reserved and trailing-dot/space names', async () => {
  const projectRoot = makeProject();
  try {
    const { applyWorkspaceOperation, storeUserFiles } = await loadWorkspaceStore();
    const invalidNames = ['NUL', 'CON', 'PRN', 'COM1', 'trailing.', 'trailing '];
    const workspaceFailures = [];
    const userFileFailures = [];

    for (const name of invalidNames) {
      try {
        applyWorkspaceOperation(projectRoot, {
          op: 'create-file',
          target: `reserved/${name}`,
          contentBase64: contentBase64('bad'),
        });
        workspaceFailures.push(name);
      } catch (err) {
        assert.match(err.message, /reserved|invalid|filename|trailing/i);
      }

      try {
        storeUserFiles(projectRoot, {
          source: 'paste',
          files: [{ name, mime: 'text/plain', contentBase64: contentBase64('bad') }],
        });
        userFileFailures.push(name);
      } catch (err) {
        assert.match(err.message, /reserved|invalid|filename|trailing/i);
      }
    }

    assert.deepEqual(workspaceFailures, [], `workspace ops accepted invalid names: ${workspaceFailures.join(', ')}`);
    assert.deepEqual(userFileFailures, [], `user-files accepted invalid names: ${userFileFailures.join(', ')}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
