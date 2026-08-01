import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import {
  buildCleanupSummary,
  pruneCleanupTargets,
} from '../session-cleanup.mjs';

function tmpdir(prefix) {
  return makeHarnessTempRoot(prefix);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeSession(root, relDir, state, updatedAt) {
  const dir = path.join(root, relDir);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'STATE.json'), {
    sessionId: path.basename(relDir),
    runtime: 'codex',
    status: state,
    updatedAt,
    terminalSeq: 1,
  });
  fs.writeFileSync(path.join(dir, 'terminal.jsonl'), '{"seq":1,"data":"hello"}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"type":"session.saved"}\n', 'utf8');
  return dir;
}

test('AC-CLEANUP-001 stopped session cleanup is previewable and preserves live/task-bound sessions by default', () => {
  const root = tmpdir('harness-cleanup-sessions-');
  const previewTempRoot = tmpdir('harness-cleanup-empty-temp-');
  const pruneTempRoot = tmpdir('harness-cleanup-empty-temp-');
  try {
    const old = '2026-01-01T00:00:00.000Z';
    const recent = '2026-07-30T00:00:00.000Z';
    const oldUnbound = writeSession(root, 'Harness/a2a/sessions/session-old', 'saved', old);
    const recentUnbound = writeSession(root, 'Harness/a2a/sessions/session-recent', 'saved', recent);
    const liveUnbound = writeSession(root, 'Harness/a2a/sessions/session-live', 'running', old);
    const taskBound = writeSession(root, 'Harness/tasks/task-alpha/sessions/session-task', 'saved', old);

    const summary = buildCleanupSummary(root, {
      stoppedSessionRetentionDays: 7,
      keepStoppedSessions: 20,
      includeTaskSessions: false,
      detachedLogRetentionHours: 24,
    }, {
      liveSessionIds: new Set(['session-live']),
      now: new Date('2026-07-31T00:00:00.000Z'),
      tempRoot: previewTempRoot,
    });

    assert.equal(summary.sessions.eligibleCount, 1);
    assert.deepEqual(summary.targets.sessions.map(target => target.sessionId), ['session-old']);

    const result = pruneCleanupTargets(root, {
      stoppedSessionRetentionDays: 7,
      keepStoppedSessions: 20,
      includeTaskSessions: false,
      detachedLogRetentionHours: 24,
    }, {
      apply: true,
      liveSessionIds: new Set(['session-live']),
      now: new Date('2026-07-31T00:00:00.000Z'),
      tempRoot: pruneTempRoot,
    });

    assert.equal(result.applied, true);
    assert.equal(fs.existsSync(oldUnbound), false);
    assert.equal(fs.existsSync(recentUnbound), true);
    assert.equal(fs.existsSync(liveUnbound), true);
    assert.equal(fs.existsSync(taskBound), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(previewTempRoot, { recursive: true, force: true });
    fs.rmSync(pruneTempRoot, { recursive: true, force: true });
  }
});

test('AC-CLEANUP-002 detached wf-ui temp cleanup skips current and fresh launch logs', () => {
  const root = tmpdir('harness-cleanup-project-');
  const tempRoot = tmpdir('harness-cleanup-temp-root-');
  try {
    const oldDir = path.join(tempRoot, 'harness-wf-ui-old');
    const freshDir = path.join(tempRoot, 'harness-wf-ui-fresh');
    const currentDir = path.join(tempRoot, 'harness-wf-ui-current');
    const liveDir = path.join(tempRoot, 'harness-wf-ui-live');
    for (const dir of [oldDir, freshDir, currentDir, liveDir]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'wf-ui.log'), 'log\n', 'utf8');
    }
    fs.writeFileSync(path.join(liveDir, 'ready.json'), JSON.stringify({ pid: process.pid }));

    const oldDate = new Date('2026-07-28T00:00:00.000Z');
    for (const dir of [oldDir, liveDir]) {
      fs.utimesSync(dir, oldDate, oldDate);
      fs.utimesSync(path.join(dir, 'wf-ui.log'), oldDate, oldDate);
    }

    const result = pruneCleanupTargets(root, {
      stoppedSessionRetentionDays: 7,
      keepStoppedSessions: 20,
      includeTaskSessions: false,
      detachedLogRetentionHours: 24,
    }, {
      apply: true,
      now: new Date('2026-07-31T00:00:00.000Z'),
      tempRoot,
      currentReadyFile: path.join(currentDir, 'ready.json'),
    });

    assert.equal(result.tempLogs.eligibleCount, 1);
    assert.equal(fs.existsSync(oldDir), false);
    assert.equal(fs.existsSync(freshDir), true);
    assert.equal(fs.existsSync(currentDir), true);
    assert.equal(fs.existsSync(liveDir), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('AC-CLEANUP-002 detached wf-ui cleanup defaults to project-local launch logs', () => {
  const root = tmpdir('harness-cleanup-project-local-');
  try {
    const launchRoot = path.join(root, 'Harness', '.temp', 'wf-ui-launch');
    const oldDir = path.join(launchRoot, 'harness-wf-ui-old');
    const currentDir = path.join(launchRoot, 'harness-wf-ui-current');
    for (const dir of [oldDir, currentDir]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'wf-ui.log'), 'log\n', 'utf8');
    }
    const oldDate = new Date('2026-07-28T00:00:00.000Z');
    fs.utimesSync(oldDir, oldDate, oldDate);
    fs.utimesSync(path.join(oldDir, 'wf-ui.log'), oldDate, oldDate);

    const result = pruneCleanupTargets(root, {
      stoppedSessionRetentionDays: 7,
      keepStoppedSessions: 20,
      includeTaskSessions: false,
      detachedLogRetentionHours: 24,
    }, {
      apply: true,
      now: new Date('2026-07-31T00:00:00.000Z'),
      currentReadyFile: path.join(currentDir, 'ready.json'),
      legacyTempRoot: false,
    });

    assert.equal(result.tempLogs.eligibleCount, 1);
    assert.equal(fs.existsSync(oldDir), false);
    assert.equal(fs.existsSync(currentDir), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-CLEANUP-002 detached wf-ui cleanup includes legacy system-temp launch logs', () => {
  const root = tmpdir('harness-cleanup-project-legacy-');
  const legacyTempRoot = tmpdir('harness-cleanup-legacy-temp-root-');
  try {
    const oldDir = path.join(legacyTempRoot, 'harness-wf-ui-old');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'wf-ui.log'), 'legacy log\n', 'utf8');
    const oldDate = new Date('2026-07-28T00:00:00.000Z');
    fs.utimesSync(oldDir, oldDate, oldDate);
    fs.utimesSync(path.join(oldDir, 'wf-ui.log'), oldDate, oldDate);

    const result = pruneCleanupTargets(root, {
      stoppedSessionRetentionDays: 7,
      keepStoppedSessions: 20,
      includeTaskSessions: false,
      detachedLogRetentionHours: 24,
    }, {
      apply: true,
      now: new Date('2026-07-31T00:00:00.000Z'),
      legacyTempRoot,
    });

    assert.equal(result.tempLogs.eligibleCount, 1);
    assert.equal(fs.existsSync(oldDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(legacyTempRoot, { recursive: true, force: true });
  }
});
