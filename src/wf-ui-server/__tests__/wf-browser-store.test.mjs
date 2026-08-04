import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import {
  cleanupWfBrowserRuns,
  createWfBrowserRun,
  createWfBrowserWindow,
  getWfBrowserLease,
  getWfBrowserRun,
  getWfBrowserWindow,
  leaseWfBrowserWindow,
  listWfBrowserArtifacts,
  listWfBrowserRuns,
  listWfBrowserWindows,
  releaseWfBrowserLease,
  storeWfBrowserArtifact,
  wfBrowserDebugUrlParams,
  wfBrowserRoot,
} from '../wf-browser-store.mjs';

function makeProject(prefix = 'wf-browser-store-') {
  const projectRoot = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(projectRoot, 'Harness', 'tasks'), { recursive: true });
  return projectRoot;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('creates wf-browser run window layout and stores artifact metadata under Harness/wf-browser', () => {
  const projectRoot = makeProject();
  try {
    const created = createWfBrowserRun(projectRoot, {
      mode: 'runtime',
      agentId: 'agent-main',
      sessionId: 'session-main',
      taskId: 'task-alpha',
      route: '/workflow',
      objective: 'verify workflow canvas',
    });
    assert.equal(created.ok, true);
    assert.match(created.run.runId, /^run-/);
    assert.equal(created.run.artifactRoot, `Harness/wf-browser/runs/${created.run.runId}`);

    const win = createWfBrowserWindow(projectRoot, created.run.runId, {
      agentId: 'agent-main',
      route: '/workflow',
      viewport: { width: 1440, height: 900 },
    });
    assert.equal(win.ok, true);
    assert.match(win.window.windowId, /^window-/);
    assert.equal(win.window.artifactRoot, `Harness/wf-browser/runs/${created.run.runId}/windows/${win.window.windowId}`);
    for (const dir of ['screenshots', 'ui-tree', 'state', 'logs', 'network', 'ast', 'replay', 'analysis']) {
      assert.equal(fs.existsSync(path.join(projectRoot, win.window.artifactRoot, dir)), true);
    }

    const artifact = storeWfBrowserArtifact(projectRoot, created.run.runId, win.window.windowId, {
      type: 'ui-tree',
      label: 'initial tree',
      name: 'initial.json',
      json: { route: '/workflow', nodes: [] },
    });
    assert.equal(artifact.ok, true);
    assert.equal(path.isAbsolute(artifact.artifact.path), false);
    assert.match(artifact.artifact.path.replace(/\\/g, '/'), /^Harness\/wf-browser\/runs\/[^/]+\/windows\/[^/]+\/ui-tree\/initial\.json$/);
    assert.deepEqual(readJson(path.join(projectRoot, artifact.artifact.path)), { route: '/workflow', nodes: [] });

    const fetched = getWfBrowserRun(projectRoot, created.run.runId);
    assert.equal(fetched.windows.length, 1);
    assert.equal(fetched.windows[0].windowId, win.window.windowId);
    assert.deepEqual(listWfBrowserWindows(projectRoot, created.run.runId).windows.map(item => item.windowId), [win.window.windowId]);
    assert.equal(getWfBrowserWindow(projectRoot, created.run.runId, win.window.windowId).window.windowId, win.window.windowId);
    assert.equal(listWfBrowserArtifacts(projectRoot, created.run.runId, win.window.windowId).artifacts.length, 1);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('control leases reject conflicting agents and release makes the window available again', () => {
  const projectRoot = makeProject();
  try {
    const run = createWfBrowserRun(projectRoot, { agentId: 'agent-a' }).run;
    const win = createWfBrowserWindow(projectRoot, run.runId, { agentId: 'agent-a' }).window;
    const first = leaseWfBrowserWindow(projectRoot, run.runId, win.windowId, {
      type: 'control',
      agentId: 'agent-a',
      ttlMs: 60_000,
    });
    assert.equal(first.lease.status, 'active');
    assert.equal(first.lease.readonly, false);
    assert.equal(getWfBrowserLease(projectRoot, run.runId, win.windowId, first.lease.leaseId).lease.leaseId, first.lease.leaseId);
    assert.equal(first.debugUrlParams, wfBrowserDebugUrlParams({
      runId: run.runId,
      windowId: win.windowId,
      agentId: 'agent-a',
      leaseId: first.lease.leaseId,
    }));

    assert.throws(() => leaseWfBrowserWindow(projectRoot, run.runId, win.windowId, {
      type: 'control',
      agentId: 'agent-b',
      ttlMs: 60_000,
    }), (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'LEASE_CONFLICT');
      return true;
    });

    const released = releaseWfBrowserLease(projectRoot, run.runId, win.windowId, first.lease.leaseId, {
      reason: 'handoff',
    });
    assert.equal(released.lease.status, 'released');
    assert.equal(released.lease.releaseReason, 'handoff');

    const second = leaseWfBrowserWindow(projectRoot, run.runId, win.windowId, {
      type: 'control',
      agentId: 'agent-b',
      ttlMs: 60_000,
    });
    assert.equal(second.lease.agentId, 'agent-b');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('observe lease can coexist with an active control lease as read-only access', () => {
  const projectRoot = makeProject();
  try {
    const run = createWfBrowserRun(projectRoot, { agentId: 'agent-a' }).run;
    const win = createWfBrowserWindow(projectRoot, run.runId, { agentId: 'agent-a' }).window;
    leaseWfBrowserWindow(projectRoot, run.runId, win.windowId, {
      type: 'control',
      agentId: 'agent-a',
      ttlMs: 60_000,
    });
    const observe = leaseWfBrowserWindow(projectRoot, run.runId, win.windowId, {
      type: 'observe',
      agentId: 'agent-b',
      ttlMs: 60_000,
    });
    assert.equal(observe.lease.type, 'observe');
    assert.equal(observe.lease.readonly, true);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('wf-browser ids reject traversal and escaped path segments', () => {
  const projectRoot = makeProject();
  try {
    const run = createWfBrowserRun(projectRoot, { agentId: 'agent-a' }).run;
    assert.throws(() => getWfBrowserRun(projectRoot, '../escape'), /Invalid run id/);
    assert.throws(() => createWfBrowserWindow(projectRoot, run.runId, { windowId: '..\\escape' }), /Invalid window id/);
    assert.throws(() => storeWfBrowserArtifact(projectRoot, run.runId, '../window', {
      type: 'state',
      json: {},
    }), /Invalid window id/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('cleanup previews and removes non-active runs without deleting active runs', () => {
  const projectRoot = makeProject();
  try {
    const complete = createWfBrowserRun(projectRoot, { runId: 'run-complete', status: 'complete' }).run;
    const active = createWfBrowserRun(projectRoot, { runId: 'run-active', status: 'active' }).run;
    const preview = cleanupWfBrowserRuns(projectRoot, { keepLatest: 0, maxAgeDays: 7, apply: false });
    assert.equal(preview.apply, false);
    assert.ok(preview.eligible.some(item => item.runId === complete.runId));
    assert.equal(preview.eligible.some(item => item.runId === active.runId), false);

    const applied = cleanupWfBrowserRuns(projectRoot, { keepLatest: 0, maxAgeDays: 7, apply: true });
    assert.deepEqual(applied.removed, [complete.runId]);
    assert.equal(fs.existsSync(path.join(wfBrowserRoot(projectRoot), 'runs', complete.runId)), false);
    assert.equal(fs.existsSync(path.join(wfBrowserRoot(projectRoot), 'runs', active.runId)), true);
    assert.deepEqual(listWfBrowserRuns(projectRoot).runs.map(run => run.runId), [active.runId]);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
