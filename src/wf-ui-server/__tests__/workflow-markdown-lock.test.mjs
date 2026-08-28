import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';

async function loadModules() {
  const store = await import('../component-node-store.mjs');
  const markdown = await import('../workflow-node-types/markdown-node.mjs');
  return { store, markdown };
}

function makeProject(prefix = 'wf-markdown-lock-') {
  const projectRoot = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(projectRoot, 'Harness', 'tasks'), { recursive: true });
  return projectRoot;
}

function createMarkdown(store, projectRoot, title, markdown) {
  return store.createComponentNode(projectRoot, { type: 'markdown', title, markdown });
}

test('T8/AC-016 markdown.find by nodeId and by title returns nodeId + stateRef, never content', async () => {
  const { store, markdown } = await loadModules();
  const projectRoot = makeProject();
  try {
    const board = createMarkdown(store, projectRoot, 'Sprint Board', '# Sprint\nsecret body');
    const design = createMarkdown(store, projectRoot, 'Design Notes', '# Design\nsecret body');

    const byNodeId = markdown.find(board.node.nodeId, projectRoot, { nodeId: board.node.nodeId });
    assert.equal(byNodeId.count, 1);
    assert.equal(byNodeId.matches[0].nodeId, board.node.nodeId);
    assert.equal(byNodeId.matches[0].title, 'Sprint Board');
    assert.equal(byNodeId.matches[0].revision, 1);
    assert.deepEqual(byNodeId.matches[0].stateRef, { path: board.node.statePath, revision: 1 });
    assert.ok(!('markdown' in byNodeId.matches[0]), 'find must never return content');

    const byTitle = markdown.find(board.node.nodeId, projectRoot, { title: 'design' });
    assert.equal(byTitle.count, 1);
    assert.equal(byTitle.matches[0].nodeId, design.node.nodeId);
    assert.ok(!('markdown' in byTitle.matches[0]), 'title search must never return content');

    const noMatch = markdown.find(board.node.nodeId, projectRoot, { title: 'does-not-exist' });
    assert.equal(noMatch.count, 0);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('T9/AC-017 lock lease + revision guard: second writer gets markdown_conflict, never silent overwrite', async () => {
  const { store, markdown } = await loadModules();
  const projectRoot = makeProject();
  try {
    const created = createMarkdown(store, projectRoot, 'Shared Notes', 'v1');
    const nodeId = created.node.nodeId;

    // Writer A acquires the lease (default TTL 30s)
    const lock = markdown.acquireLock(nodeId, projectRoot, { lockOwner: 'agent-a' });
    assert.equal(lock.owner, 'agent-a');
    assert.equal(lock.revision, 1);
    assert.ok(lock.lockId);
    assert.ok(lock.expiresAt > Date.now());
    assert.ok(lock.expiresAt - Date.now() >= 29000, 'default ttlSeconds should be 30');

    // Writer B cannot acquire while A holds it
    assert.throws(
      () => markdown.acquireLock(nodeId, projectRoot, { lockOwner: 'agent-b', ttlSeconds: 30 }),
      (err) => {
        assert.equal(err.code, 'markdown_locked');
        assert.equal(err.holder, 'agent-a');
        assert.ok(err.expiresAt);
        return true;
      },
    );

    // A writes with its lockId + expectedRevision
    const written = markdown.append(nodeId, projectRoot, {
      markdown: '\nv2 from A',
      lockId: lock.lockId,
      expectedRevision: lock.revision,
    });
    assert.equal(written.revision, 2);
    assert.ok(written.markdown.includes('v2 from A'));

    // B cannot release a lock it does not hold
    assert.throws(
      () => markdown.releaseLock(nodeId, projectRoot, { lockOwner: 'agent-b', lockId: lock.lockId }),
      (err) => {
        assert.equal(err.code, 'markdown_locked');
        return true;
      },
    );

    // A releases the lease; the revision guard (markdown_conflict) then applies
    // to writes without a lock (F18/D15: lockless writes stay compatible).
    const released = markdown.releaseLock(nodeId, projectRoot, { lockOwner: 'agent-a', lockId: lock.lockId });
    assert.equal(released.released, true);

    // B holds a stale expectedRevision -> recoverable conflict, no write happens
    assert.throws(
      () => markdown.append(nodeId, projectRoot, { markdown: '\nclobbered by B', expectedRevision: 1 }),
      (err) => {
        assert.equal(err.code, 'markdown_conflict');
        assert.equal(err.currentRevision, 2);
        assert.equal(err.expectedRevision, 1);
        assert.match(err.message, /Reread, merge your changes, and retry/);
        return true;
      },
    );
    const after = markdown.read(nodeId, projectRoot);
    assert.equal(after.revision, 2);
    assert.ok(!after.markdown.includes('clobbered by B'), 'conflict must not write');

    // B rereads and retries with the fresh revision (AC-018 flow)
    const retried = markdown.append(nodeId, projectRoot, { markdown: '\nv3 from B', expectedRevision: after.revision });
    assert.equal(retried.revision, 3);
    assert.ok(retried.markdown.includes('v3 from B'));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('F18/D15: write while lock held by another conflicts with markdown_locked even without expectedRevision', async () => {
  const { store, markdown } = await loadModules();
  const projectRoot = makeProject();
  try {
    const created = createMarkdown(store, projectRoot, 'Locked Notes', 'body');
    const nodeId = created.node.nodeId;
    markdown.acquireLock(nodeId, projectRoot, { lockOwner: 'agent-a', ttlSeconds: 30 });

    // Mandatory exclusion while held: a valid foreign lock rejects patch/append/
    // replace with markdown_locked EVEN IF no expectedRevision is supplied.
    assert.throws(
      () => markdown.patch(nodeId, projectRoot, { diff: { op: 'append', text: 'x' } }),
      (err) => {
        assert.equal(err.code, 'markdown_locked');
        assert.equal(err.holder, 'agent-a');
        assert.ok(err.expiresAt);
        return true;
      },
    );
    assert.throws(
      () => markdown.append(nodeId, projectRoot, { markdown: '\nclobbered' }),
      (err) => {
        assert.equal(err.code, 'markdown_locked');
        assert.equal(err.holder, 'agent-a');
        return true;
      },
    );
    assert.throws(
      () => markdown.replace(nodeId, projectRoot, { markdown: 'clobbered' }),
      (err) => {
        assert.equal(err.code, 'markdown_locked');
        assert.equal(err.holder, 'agent-a');
        return true;
      },
    );
    const after = markdown.read(nodeId, projectRoot);
    assert.equal(after.markdown, 'body', 'no write may land while a valid foreign lock is held');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('AC-018 conflict carries currentRevision; reread + merge + retry succeeds', async () => {
  const { store, markdown } = await loadModules();
  const projectRoot = makeProject();
  try {
    const created = createMarkdown(store, projectRoot, 'Merge Notes', 'base');
    const nodeId = created.node.nodeId;

    const r1 = markdown.read(nodeId, projectRoot);
    assert.equal(r1.revision, 1);

    // Concurrent writer A writes without a guard (compat path)
    markdown.append(nodeId, projectRoot, { markdown: '\nA writes' });

    // Writer B with stale expectedRevision gets a recoverable conflict
    assert.throws(
      () => markdown.replace(nodeId, projectRoot, { markdown: 'B overwrite', expectedRevision: r1.revision }),
      (err) => {
        assert.equal(err.code, 'markdown_conflict');
        assert.equal(err.currentRevision, 2);
        assert.equal(err.expectedRevision, 1);
        return true;
      },
    );

    // B rereads, merges, and retries with the fresh currentRevision
    const fresh = markdown.read(nodeId, projectRoot);
    assert.equal(fresh.revision, 2);
    const merged = markdown.replace(nodeId, projectRoot, {
      markdown: `${fresh.markdown}\nB merged`,
      expectedRevision: fresh.revision,
    });
    assert.equal(merged.revision, 3);
    const final = markdown.read(nodeId, projectRoot);
    assert.ok(final.markdown.includes('A writes'));
    assert.ok(final.markdown.includes('B merged'));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('compat: patch/append/replace with no lock and no expectedRevision keep last-write-wins behavior', async () => {
  const { store, markdown } = await loadModules();
  const projectRoot = makeProject();
  try {
    const created = createMarkdown(store, projectRoot, 'Compat Notes', 'v1');
    const nodeId = created.node.nodeId;

    const appended = markdown.append(nodeId, projectRoot, { markdown: '\nv2' });
    assert.equal(appended.revision, 2);

    const patched = markdown.patch(nodeId, projectRoot, { diff: { op: 'insert', text: 'X', offset: 0 } });
    assert.equal(patched.revision, 3);

    const replaced = markdown.replace(nodeId, projectRoot, { markdown: 'v4' });
    assert.equal(replaced.revision, 4);
    assert.equal(replaced.markdown, 'v4');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('store lease: TTL expiry + renewal + release rules via clock injection (no sleeping)', async () => {
  const { store } = await loadModules();
  const projectRoot = makeProject();
  try {
    const created = createMarkdown(store, projectRoot, 'Ttl Notes', 'x');
    const nodeId = created.node.nodeId;
    const T0 = Date.UTC(2026, 7, 12, 9, 0, 0);

    const lock = store.acquireLock(nodeId, 'agent-a', 30000, { now: T0 });
    assert.equal(lock.expiresAt, T0 + 30000);
    assert.ok(store.isLocked(nodeId, T0 + 1000));

    // second acquire while held -> markdown_locked with holder + expiresAt
    assert.throws(
      () => store.acquireLock(nodeId, 'agent-b', 30000, { now: T0 + 1000 }),
      (err) => {
        assert.equal(err.code, 'markdown_locked');
        assert.equal(err.holder, 'agent-a');
        assert.equal(err.expiresAt, T0 + 30000);
        return true;
      },
    );

    // renewal: same holder re-acquires with its own lockId -> same lockId, extended expiry
    const renewed = store.acquireLock(nodeId, 'agent-a', 30000, { now: T0 + 1000, lockId: lock.lockId });
    assert.equal(renewed.lockId, lock.lockId);
    assert.equal(renewed.expiresAt, T0 + 31000);

    // expiry: at T0 + 61000 the lease is gone; another holder may acquire freely
    assert.equal(store.isLocked(nodeId, T0 + 61000), null);
    const bLock = store.acquireLock(nodeId, 'agent-b', 30000, { now: T0 + 61000 });
    assert.equal(bLock.holder, 'agent-b');

    // release when not holder -> error; release by holder -> released
    assert.throws(
      () => store.releaseLock(nodeId, 'agent-a', { now: T0 + 62000 }),
      (err) => err.code === 'markdown_locked',
    );
    const released = store.releaseLock(nodeId, 'agent-b', { now: T0 + 62000, lockId: bLock.lockId });
    assert.equal(released.released, true);
    assert.equal(store.isLocked(nodeId, T0 + 62000), null);

    // release after expiry is a no-op
    const a2 = store.acquireLock(nodeId, 'agent-a', 30000, { now: T0 + 70000 });
    const noop = store.releaseLock(nodeId, 'agent-a', { now: T0 + 70000 + 40000, lockId: a2.lockId });
    assert.equal(noop.released, false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('F18/D15: lock survives store re-init — persisted in node state, read on load, TTL honored', async () => {
  const { store, markdown } = await loadModules();
  const projectRoot = makeProject();
  try {
    const created = createMarkdown(store, projectRoot, 'Persist Notes', 'body');
    const nodeId = created.node.nodeId;
    const lock = markdown.acquireLock(nodeId, projectRoot, { lockOwner: 'agent-a', ttlSeconds: 30 });
    assert.ok(lock.lockId);

    // A brand-new store module instance (fresh in-memory registry, i.e. a
    // restarted process) must see the persisted lease from the node state.
    const freshStore = await import(`../component-node-store.mjs?restart=${Date.now()}`);
    const persisted = freshStore.isLocked(nodeId, Date.now() + 1000, { projectRoot });
    assert.ok(persisted, 'persisted lock must survive store re-init');
    assert.equal(persisted.holder, 'agent-a');
    assert.equal(persisted.lockId, lock.lockId);

    // The fresh instance also refuses writes under the foreign persisted lock.
    await assert.rejects(
      freshMarkdownAppend(nodeId, projectRoot, 'clobber'),
      (err) => {
        assert.equal(err.code, 'markdown_locked');
        assert.equal(err.holder, 'agent-a');
        return true;
      },
    );
    const untouched = markdown.read(nodeId, projectRoot);
    assert.equal(untouched.markdown, 'body');

    // Owner renewal keeps the SAME persisted lockId and extends the expiry.
    const renewed = freshStore.acquireLock(nodeId, 'agent-a', 30000, { lockId: lock.lockId, projectRoot });
    assert.equal(renewed.lockId, lock.lockId);
    assert.ok(renewed.expiresAt > lock.expiresAt, 'renewal must extend the lease');

    // Release clears the persisted lease so a new store sees no lock.
    freshStore.releaseLock(nodeId, 'agent-a', { lockId: lock.lockId, projectRoot });
    const afterRelease = freshStore.isLocked(nodeId, Date.now() + 1000, { projectRoot });
    assert.equal(afterRelease, null, 'release must clear the persisted lease');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// Append through the FRESH markdown module instance so the memory cache of the
// original store is irrelevant — the persisted lock is the only source.
async function freshMarkdownAppend(nodeId, projectRoot, text) {
  const freshMarkdown = await import(`../workflow-node-types/markdown-node.mjs?fresh=${Date.now()}`);
  return freshMarkdown.append(nodeId, projectRoot, { markdown: `\n${text}` });
}

test('F18/D15: after TTL expiry a foreign-lock write is allowed again (expiry honored on read)', async () => {
  const { store, markdown } = await loadModules();
  const projectRoot = makeProject();
  try {
    const created = createMarkdown(store, projectRoot, 'Expiry Notes', 'v1');
    const nodeId = created.node.nodeId;
    const lock = markdown.acquireLock(nodeId, projectRoot, { lockOwner: 'agent-a', ttlSeconds: 1 });
    assert.ok(lock.lockId);

    await new Promise(resolve => setTimeout(resolve, 1200));

    // Lease expired on read -> the write gate sees no valid lock and allows the
    // lockless write (compat path), clearing the stale persisted record.
    const written = markdown.append(nodeId, projectRoot, { markdown: '\nv2 after expiry' });
    assert.equal(written.revision, 2);
    const state = store.getComponentNode(projectRoot, nodeId);
    assert.equal(state.state.lock, null, 'stale persisted lock record must be cleared by the write');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('store assertRevision: null on match, markdown_conflict error on mismatch with currentRevision', async () => {
  const { store } = await loadModules();
  assert.equal(store.assertRevision(2, 2), null);
  assert.equal(store.assertRevision(2, undefined), null);
  assert.equal(store.assertRevision(2, '2'), null, 'numeric string should compare as number');
  const err = store.assertRevision(2, 1);
  assert.equal(err.code, 'markdown_conflict');
  assert.equal(err.currentRevision, 2);
  assert.equal(err.expectedRevision, 1);
  assert.match(err.message, /revision 1 -> 2/);
});
