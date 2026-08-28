import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';

// ---------------------------------------------------------------------------
// task-upgrade-file-node — RED acceptance tests, wave W1T (test writer).
//
// AC mapping (task PLAN "验收标准"):
//   AC-1  read cache: two consecutive file.preview calls with the same params;
//         the second must NOT re-read the disk (mtime+size validation hits).
//         Invalidation (explicit, or via changed stat) forces a fresh read.
//   AC-2  file lock: acquireLock/releaseLock usable on file nodes (persisted,
//         TTL, stale-lock reclamation); file.writeText rejects with 409
//         file_locked while another holder owns the lease.
//   AC-3  change watch: external edits to a file referenced by a file node
//         produce a file.changed event (here: the watchFileNodes onChange
//         callback contract {nodeId, path, etag}) within ~10s; unrelated-file
//         edits must not fire events for the bound node.
//   AC-4  paged read: readText offset>0 + limit reads >64KB files in bounded
//         chunks; preview textSnippet stays capped at 64KB.
//
// Expected RED state BEFORE implementation (this is the TDD gate):
//   - AC-1 test: getPreviewCached / invalidateFileCache are NOT exported from
//     workspace-store.mjs yet -> dynamic import yields undefined -> TypeError
//     "getPreviewCached is not a function" -> test FAILS.
//   - AC-2 writeText-gate test: file.writeText currently has no lock gate, so
//     a write under a foreign lease SUCCEEDS; the expected file_locked
//     exception never appears -> assert.throws FAILS.
//   - AC-3 test: ../file-watcher.mjs does not exist -> dynamic import rejects
//     with ERR_MODULE_NOT_FOUND -> test FAILS.
//   - Guard tests (AC-2 lifecycle, AC-2 stale lock, AC-4 pagination) are
//     expected to PASS before implementation — the current code already
//     persists/releases leases, treats expired leases as dead, and supports
//     offset/limit reads. They become meaningful once the writeText gate
//     exists: they pin the exact AC-2 stale-lock reclamation semantics and
//     protect AC-4 from regression. The FILE is RED overall via the other
//     tests; the guard status of each test is marked inline.
//
// Import touch points for the implementer (W1 write set):
//   - cache exports live in src/wf-ui-server/workspace-store.mjs per PLAN W1
//     ("workspace-cache 集成(workspace-store.mjs)"): getPreviewCached(projectRoot, path)
//     and invalidateFileCache(projectRoot, path). If the implementer instead
//     places them in file-watcher.mjs, only the import line below changes.
//   - watchFileNodes(projectRoot, { onChange }) lives in
//     src/wf-ui-server/file-watcher.mjs (PLAN W1 "file-watcher.mjs(新)"). It
//     must return a handle with a stop()/close() method when provided.
//
// AC-3 scope note: the WS broadcast and event persistence halves of AC-3 are
// server wiring (ws-events.mjs / server.mjs, W1); this wave tests the watcher
// callback contract. Frontend badge/refresh (AC-9) is a later wave.
// ---------------------------------------------------------------------------

async function loadFileNode() {
  return import('../workflow-node-types/file-node.mjs');
}

async function loadComponentStore() {
  return import('../component-node-store.mjs');
}

async function loadWorkspaceStore() {
  return import('../workspace-store.mjs');
}

function makeProject(prefix = 'wf-file-cache-lock-watch-') {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEvent(events, predicate, { timeoutMs = 12000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = events.find(predicate);
    if (hit) return hit;
    await sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for watch event`);
}

test('AC-1 preview read cache: consecutive preview() hits mtime+size validation; invalidate forces re-read (RED: cache exports missing)', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    // RED shape: these exports do not exist yet -> TypeError at call time.
    const { getPreviewCached, invalidateFileCache } = await import('../workspace-store.mjs');

    const absPath = path.join(projectRoot, 'src', 'cache.txt');
    fs.writeFileSync(absPath, 'alpha-v1\n');
    // Fix the mtime so both writes below end up with an identical stat
    // (same size + same mtime) — the AC-1 cache-hit condition.
    const fixedMtime = new Date('2020-01-01T00:00:00.000Z');
    const stat0 = fs.statSync(absPath);
    fs.utimesSync(absPath, stat0.atime, fixedMtime);

    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/cache.txt', mime: 'text/plain', name: 'cache.txt' },
    });
    const nodeId = created.node.nodeId;

    // First preview populates the cache.
    const first = fileNode.preview(nodeId, projectRoot);
    assert.equal(first.textSnippet, 'alpha-v1\n');
    assert.ok(getPreviewCached(projectRoot, 'src/cache.txt'),
      'first preview must populate the cache entry');

    // External edit that does NOT satisfy the invalidation condition:
    // same byte length, mtime restored to the exact previous value. The
    // mtime+size validation therefore still hits, and the second preview
    // must serve the CACHED result without re-reading the disk.
    fs.writeFileSync(absPath, 'bravo-v1\n');
    const stat1 = fs.statSync(absPath);
    fs.utimesSync(absPath, stat1.atime, fixedMtime);
    const second = fileNode.preview(nodeId, projectRoot);
    assert.equal(second.textSnippet, 'alpha-v1\n',
      'cache hit: no disk re-read even though the file changed underneath (mtime+size unchanged)');
    assert.equal(second.meta.etag, first.meta.etag, 'cache hit keeps the same etag');
    assert.equal(second.size, first.size, 'cache hit keeps the same size');

    // Explicit invalidation drops the entry.
    invalidateFileCache(projectRoot, 'src/cache.txt');
    assert.ok(!getPreviewCached(projectRoot, 'src/cache.txt'),
      'invalidateFileCache must drop the cached entry');

    // A real change (different size -> different etag) then re-reads fresh.
    fs.writeFileSync(absPath, 'charlie-v2 longer content\n');
    const third = fileNode.preview(nodeId, projectRoot);
    assert.equal(third.textSnippet, 'charlie-v2 longer content\n',
      'after invalidation the next preview re-reads the file');
    assert.notEqual(third.meta.etag, first.meta.etag, 'changed file yields a new etag');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-2 file lock gate: writeText under a foreign lease refuses with 409 file_locked (RED: no gate today)', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'locked.txt'), 'v1\n');
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/locked.txt', mime: 'text/plain', name: 'locked.txt', size: 3 },
    });
    const nodeId = created.node.nodeId;

    const lock = store.acquireLock(nodeId, 'agent-a', 60000, { projectRoot });
    assert.ok(lock.lockId, 'acquireLock returns a lease for a file node');

    // The write must be rejected while another agent holds the lease.
    // RED shape: file.writeText has no lock gate, so it succeeds and the
    // expected exception never appears -> assert.throws FAILS.
    assert.throws(
      () => fileNode.writeText(nodeId, projectRoot, { content: 'hijacked\n' }),
      (err) => {
        if (!err || typeof err.code !== 'string') return false;
        assert.equal(err.code, 'file_locked', 'AC-2 error code must be file_locked');
        assert.equal(err.statusCode, 409, 'AC-2 lock conflict must be HTTP 409');
        return true;
      },
    );

    // And the file content must be untouched by the rejected write.
    assert.equal(fs.readFileSync(path.join(projectRoot, 'src', 'locked.txt'), 'utf8'), 'v1\n');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-2 lock lifecycle: lease persists in the node state file and releaseLock restores writability (guard: green before implementation)', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'draft.txt'), 'old\n');
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/draft.txt', mime: 'text/plain', name: 'draft.txt' },
    });
    const nodeId = created.node.nodeId;
    const statePath = path.join(projectRoot, created.node.statePath);

    const lock = store.acquireLock(nodeId, 'agent-b', 60000, { projectRoot });
    const stateWhileLocked = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.ok(stateWhileLocked.lock, 'lock must be persisted in the node state file');
    assert.equal(stateWhileLocked.lock.holder, 'agent-b');
    assert.equal(stateWhileLocked.lock.lockId, lock.lockId);
    assert.ok(stateWhileLocked.lock.expiresAt > Date.now(), 'TTL is persisted');

    const released = store.releaseLock(nodeId, 'agent-b', { projectRoot });
    assert.equal(released.released, true);
    const stateAfterRelease = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(stateAfterRelease.lock, null, 'releaseLock must clear the persisted lease');

    // After release the same node accepts writes again.
    const written = fileNode.writeText(nodeId, projectRoot, { content: 'after release\n' });
    assert.equal(written.ok, true);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'src', 'draft.txt'), 'utf8'), 'after release\n');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-2 stale lock: an expired lease is reclaimed and never blocks writeText (guard: green before implementation)', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'stale.txt'), 'v1\n');
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/stale.txt', mime: 'text/plain', name: 'stale.txt' },
    });
    const nodeId = created.node.nodeId;

    // Simulate a lease left behind by a crashed process: acquired 2x TTL in
    // the past (clock injection), so expiresAt is already 1x TTL behind now.
    store.acquireLock(nodeId, 'ghost-agent', 60000, {
      now: Date.now() - 2 * 60000,
      projectRoot,
    });

    // The expired lease is not live...
    assert.equal(store.isLocked(nodeId, Date.now(), { projectRoot }), null,
      'expired lease must be reclaimed on read');

    // ...and a write proceeds instead of being blocked by the ghost.
    const written = fileNode.writeText(nodeId, projectRoot, { content: 'stale lock cleared\n' });
    assert.equal(written.ok, true, 'stale lock must never block file.writeText');
    assert.equal(
      fs.readFileSync(path.join(projectRoot, 'src', 'stale.txt'), 'utf8'),
      'stale lock cleared\n',
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-3 watchFileNodes: external edit emits {nodeId, path, etag} within 12s; unrelated files do not fire (RED: module missing)', async () => {
  const projectRoot = makeProject();
  let watcher = null;
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    const workspaceStore = await loadWorkspaceStore();
    fs.writeFileSync(path.join(projectRoot, 'src', 'watched.txt'), 'v1\n');
    fs.writeFileSync(path.join(projectRoot, 'src', 'other.txt'), 'unrelated\n');
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/watched.txt', mime: 'text/plain', name: 'watched.txt' },
    });
    const nodeId = created.node.nodeId;

    // RED shape: ../file-watcher.mjs does not exist yet -> dynamic import
    // rejects with ERR_MODULE_NOT_FOUND -> test FAILS.
    const { watchFileNodes } = await import('../file-watcher.mjs');
    const events = [];
    watcher = watchFileNodes(projectRoot, { onChange: (event) => events.push(event) });

    // External modification (not via the node action) must be detected.
    fs.writeFileSync(path.join(projectRoot, 'src', 'watched.txt'), 'v2 changed externally\n');

    const hit = await waitForEvent(events, (event) => event && event.nodeId === nodeId);
    assert.ok(String(hit.path).replace(/\\/g, '/').endsWith('src/watched.txt'),
      'event carries the workspace path of the bound file');
    assert.equal(typeof hit.etag, 'string');
    assert.ok(hit.etag.length > 0, 'event carries the fresh etag');
    assert.equal(hit.etag, workspaceStore.getWorkspaceMeta(projectRoot, 'src/watched.txt').etag,
      'event etag matches the current on-disk stat');

    // Negative control: editing an unrelated file must not emit events for
    // the bound node (watcher only watches files referenced by file nodes).
    const before = events.length;
    fs.writeFileSync(path.join(projectRoot, 'src', 'other.txt'), 'unrelated v2\n');
    await sleep(1500);
    const newEvents = events.slice(before);
    assert.ok(!newEvents.some((event) => event && event.nodeId === nodeId),
      'edits to unrelated files must not fire events for the bound node');
  } finally {
    if (watcher && typeof watcher.stop === 'function') watcher.stop();
    if (watcher && typeof watcher.close === 'function') watcher.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('W4F-L1 refreshBaseline: a self-write re-baselined right after writing fires no onChange; the next real external edit still fires', async () => {
  const projectRoot = makeProject();
  let watcher = null;
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    fs.writeFileSync(path.join(projectRoot, 'src', 'self.txt'), 'v1\n');
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/self.txt', mime: 'text/plain', name: 'self.txt' },
    });
    const nodeId = created.node.nodeId;
    const absPath = path.join(projectRoot, 'src', 'self.txt');

    const { watchFileNodes, refreshBaseline } = await import('../file-watcher.mjs');
    const events = [];
    watcher = watchFileNodes(projectRoot, { onChange: (event) => events.push(event) });

    // Unknown/unwatched paths are a no-op and never throw.
    assert.equal(refreshBaseline(projectRoot, 'src/does-not-exist.txt'), false,
      'refreshBaseline on an unwatched target is a no-op');

    // Simulate a server self-write: the file changes, then server.mjs calls
    // refreshBaseline (as it does after /api/workspace/ops) so the pending
    // debounce/poll verification sees "no real change".
    fs.writeFileSync(absPath, 'self-write v2\n');
    assert.equal(refreshBaseline(projectRoot, 'src/self.txt'), true,
      'refreshBaseline must re-baseline the watched target');

    // Past the 200ms debounce (and well inside the first 5s poll): the
    // self-write must NOT produce a file.changed event.
    await sleep(1500);
    assert.equal(events.length, 0,
      'a re-baselined self-write must not fire onChange (self-write suppression)');

    // A genuinely external edit afterwards still fires normally.
    fs.writeFileSync(absPath, 'external v3\n');
    const hit = await waitForEvent(events, (event) => event && event.nodeId === nodeId);
    assert.ok(hit, 'the next real external edit still fires onChange');
    assert.ok(String(hit.path).replace(/\\/g, '/').endsWith('src/self.txt'),
      'the external event carries the bound workspace path');
  } finally {
    if (watcher && typeof watcher.stop === 'function') watcher.stop();
    if (watcher && typeof watcher.close === 'function') watcher.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-4 paged readText: a >64KB file reads in bounded offset chunks with continuity; preview snippet stays capped (guard: green before implementation)', async () => {
  const projectRoot = makeProject();
  try {
    const store = await loadComponentStore();
    const fileNode = await loadFileNode();
    const content = 'A'.repeat(100 * 1024); // 100 KB, no NUL bytes -> text-safe
    fs.writeFileSync(path.join(projectRoot, 'src', 'big.txt'), content);
    const created = createFileNode(projectRoot, store, {
      file: { path: 'src/big.txt', mime: 'text/plain', name: 'big.txt', size: content.length },
    });
    const nodeId = created.node.nodeId;

    const chunk1 = fileNode.readText(nodeId, projectRoot, { offset: 0, limit: 16384 });
    assert.equal(chunk1.bytesRead, 16384);
    assert.equal(chunk1.truncated, true, 'first chunk of a >64KB file must be truncated');

    const chunk2 = fileNode.readText(nodeId, projectRoot, { offset: 16384, limit: 16384 });
    assert.equal(chunk2.bytesRead, 16384);
    assert.equal(chunk1.text + chunk2.text, content.slice(0, 32768),
      'chunks must be byte-continuous at the offset boundary');

    const tailOffset = 100 * 1024 - 1024;
    const tail = fileNode.readText(nodeId, projectRoot, { offset: tailOffset, limit: 16384 });
    assert.equal(tail.truncated, false, 'tail chunk reaches EOF');
    assert.equal(tail.bytesRead, 1024);
    assert.equal(tail.text, content.slice(tailOffset));

    // preview textSnippet stays capped at 64KB (unchanged per AC-4).
    const preview = fileNode.preview(nodeId, projectRoot);
    assert.equal(preview.textTruncated, true);
    assert.ok(preview.textSnippet.length <= 64 * 1024, 'textSnippet is capped at 64KB');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
