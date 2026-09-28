import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  makeCapsuleProject,
  cleanupCapsuleFixtures,
  readArchiveIndex,
} from './fixtures/capsule-routing/lib/fixture.js';
import {
  readLiveTasks,
  readArchivedTasks,
  archiveEligibility,
  buildArchiveIndexEntries,
} from '../Harness/scripts/lib/task-route.mjs';

after(() => cleanupCapsuleFixtures());

function runTaskState(root, args = []) {
  const scriptPath = path.resolve('Harness', 'scripts', 'task-state.mjs');
  return spawnSync(process.execPath, [scriptPath, ...args], { cwd: root, encoding: 'utf8' });
}

function runAutoArchive(root, args = []) {
  return runTaskState(root, ['auto-archive', ...args]);
}

function parseJson(result) {
  return JSON.parse(result.stdout);
}

// ---------------------------------------------------------------------------
// Integration: real closeout trigger — task-state auto-archive is the sole
// writer. task-route.mjs stays pure (read-only) and task-state.mjs delegates
// to it for eligibility + index entries.
// ---------------------------------------------------------------------------

test('closeout: dry-run reports would-archive without moving', () => {
  const root = makeCapsuleProject();
  const result = runAutoArchive(root, ['--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseJson(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.dryRun, true);
  assert.ok(payload.scanned >= 1);
  assert.ok(payload.eligible >= 1);
  const wouldArchive = payload.results.find(r => r.taskId === 'task-closed-charlie');
  assert.ok(wouldArchive, 'closed task should appear in results');
  assert.equal(wouldArchive.status, 'would-archive');
  // Task is still live.
  assert.ok(readLiveTasks(root).find(t => t.id === 'task-closed-charlie'));
});

test('closeout: --apply moves the closed task and refreshes INDEX.json via unified builder', () => {
  const root = makeCapsuleProject();
  const result = runAutoArchive(root, ['--apply', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseJson(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.dryRun, false);

  const archived = payload.results.find(r => r.taskId === 'task-closed-charlie');
  assert.ok(archived, 'closed task should be archived');
  assert.equal(archived.status, 'archived');
  assert.match(String(archived.archivePath), /_archive\/\d{4}\/\d{2}\/\d{2}\/task-closed-charlie$/);

  // Filesystem: live task is gone; archive task is found.
  assert.ok(!readLiveTasks(root).find(t => t.id === 'task-closed-charlie'));
  const archivedTask = readArchivedTasks(root).find(t => t.id === 'task-closed-charlie');
  assert.ok(archivedTask, 'archived task should be listed');

  // INDEX.json was refreshed using the unified buildArchiveIndexEntries.
  const index = readArchiveIndex(root);
  assert.ok(index, 'archive INDEX.json should exist after apply');
  const entry = index.tasks.find(t => t.id === 'task-closed-charlie');
  assert.ok(entry, 'task-closed-charlie should appear in archive INDEX.json');
  assert.equal(entry.status, 'closed');
  assert.match(String(entry.archivePath), /_archive\/\d{4}\/\d{2}\/\d{2}\/task-closed-charlie$/);

  // The unified builder and the on-disk INDEX.json agree.
  const entries = buildArchiveIndexEntries(root);
  const unifiedEntry = entries.find(e => e.id === 'task-closed-charlie');
  assert.ok(unifiedEntry);
  assert.equal(entry.archivePath, unifiedEntry.archivePath);
});

test('closeout: active and blocked tasks are rejected; only closed tasks move', () => {
  const root = makeCapsuleProject();
  const result = runAutoArchive(root, ['--apply', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseJson(result);
  const active = payload.results.find(r => r.taskId === 'task-active-alpha');
  const blocked = payload.results.find(r => r.taskId === 'task-blocked-bravo');
  assert.ok(active, 'active task should appear in results');
  assert.equal(active.status, 'rejected');
  assert.ok(blocked, 'blocked task should appear in results');
  assert.equal(blocked.status, 'rejected');
  // Filesystem: both remain live.
  assert.ok(readLiveTasks(root).find(t => t.id === 'task-active-alpha'));
  assert.ok(readLiveTasks(root).find(t => t.id === 'task-blocked-bravo'));
});

test('closeout: --task on already-archived returns already-archived', () => {
  const root = makeCapsuleProject();
  runAutoArchive(root, ['--apply', '--json']);
  const result = runAutoArchive(root, ['--task', 'task-closed-charlie', '--apply', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseJson(result);
  assert.equal(payload.ok, true);
  const skipped = payload.results.find(r => r.taskId === 'task-closed-charlie');
  assert.ok(skipped, 'task should appear in results');
  assert.equal(skipped.status, 'already-archived');
  assert.match(String(skipped.archivePath), /_archive\/\d{4}\/\d{2}\/\d{2}\/task-closed-charlie$/);
});

test('closeout: --task on unknown task returns ok:false', () => {
  const root = makeCapsuleProject();
  const result = runAutoArchive(root, ['--task', 'task-not-found-zulu', '--json']);
  assert.notEqual(result.status, 0);
  const payload = parseJson(result);
  assert.equal(payload.ok, false);
});

test('closeout: pre-existing destination does not corrupt the source task', () => {
  const root = makeCapsuleProject();
  const srcPath = path.join(root, 'Harness', 'tasks', 'task-closed-charlie', 'STATE.json');
  const before = fs.readFileSync(srcPath, 'utf8');
  // Pre-create today's destination so the atomic move fails.
  const now = new Date();
  const destDir = path.join(
    root, 'Harness', 'tasks', '_archive',
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    'task-closed-charlie',
  );
  fs.mkdirSync(destDir, { recursive: true });
  const result = runAutoArchive(root, ['--task', 'task-closed-charlie', '--apply', '--json']);
  // Source task is untouched regardless of the move outcome.
  assert.equal(fs.readFileSync(srcPath, 'utf8'), before);
  // The failed result should surface as an error, not as silent success.
  const payload = parseJson(result);
  const failed = payload.results.find(r => r.taskId === 'task-closed-charlie');
  assert.equal(failed.status, 'failed');
});

// ---------------------------------------------------------------------------
// Unified archiveEligibility (task-route.mjs) agrees with the write surface.
// ---------------------------------------------------------------------------

test('unified: task-route archiveEligibility matches task-state write-side decisions', () => {
  const root = makeCapsuleProject();
  // Closed task is eligible on both surfaces.
  assert.equal(archiveEligibility(root, 'task-closed-charlie').ok, true);
  // Active/blocked tasks are never eligible.
  assert.equal(archiveEligibility(root, 'task-active-alpha').ok, false);
  assert.equal(archiveEligibility(root, 'task-blocked-bravo').ok, false);
  // Unknown and reserved are rejected.
  assert.equal(archiveEligibility(root, 'task-not-found-zulu').ok, false);
  assert.equal(archiveEligibility(root, '_template').ok, false);

  // Dry-run auto-archive on the closed task matches the unified verdict.
  const result = runAutoArchive(root, ['--task', 'task-closed-charlie', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseJson(result);
  const wouldArchive = payload.results.find(r => r.taskId === 'task-closed-charlie');
  assert.equal(wouldArchive.status, 'would-archive');
});
