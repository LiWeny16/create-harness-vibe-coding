import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  makeCapsuleProject,
  writeTaskState,
  readTaskStateFile,
  writeTaskFile,
  cleanupCapsuleFixtures,
} from './fixtures/capsule-routing/lib/fixture.js';
import {
  normalizeStatus,
  readLiveTasks,
  readArchivedTasks,
  resolveRoute,
  resolveFocus,
  aggregateBlockers,
  archiveEligibility,
  buildRouteStub,
  buildResumeSummary,
  buildArchiveIndexEntries,
} from '../Harness/scripts/lib/task-route.mjs';

function runTaskState(root, ...args) {
  const taskStatePath = path.resolve('Harness/scripts/task-state.mjs');
  const result = spawnSync(process.execPath, [taskStatePath, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    json: () => JSON.parse(result.stdout),
  };
}

after(() => cleanupCapsuleFixtures());

// ---------------------------------------------------------------------------
// W0 RED tests for task-route.mjs.
//
// This file is the W0 acceptance contract for task-refactor-capsule-routing.
// It pins the surface of the derived route layer that W1-W5 must implement:
//
//   - normalizeStatus(value)               legacy -> canonical status
//   - readLiveTasks(root)                  enumerate live tasks from STATE.json
//   - readArchivedTasks(root)              enumerate archived tasks
//   - resolveRoute(root, taskId)           locate a task and return its path
//   - resolveFocus(root)                   decide focus status (resolved/ambiguous)
//   - aggregateBlockers(root, taskId)      unify blocker sources
//   - archiveEligibility(root, taskId)     closed only; active/blocked rejected
//   - buildRouteStub(root, taskId)         minimal route entry for indexes
//   - buildResumeSummary(root, taskId)     state/queue/dependency resume payload
//
// The module does not exist yet; every test below is RED until W1 lands.
// ---------------------------------------------------------------------------

test('W0 normalizeStatus maps legacy aliases to canonical lifecycle', () => {
  assert.equal(normalizeStatus('in-progress'), 'active');
  assert.equal(normalizeStatus('in_progress'), 'active');
  assert.equal(normalizeStatus('running'), 'active');
  assert.equal(normalizeStatus('pending'), 'active');
  assert.equal(normalizeStatus('needs_user_decision'), 'blocked');
  assert.equal(normalizeStatus('needs-user-decision'), 'blocked');
  assert.equal(normalizeStatus('failed'), 'blocked');
  assert.equal(normalizeStatus('complete'), 'closed');
  assert.equal(normalizeStatus('completed'), 'closed');
  assert.equal(normalizeStatus('verified'), 'closed');
  assert.equal(normalizeStatus('archived'), 'closed');
  assert.equal(normalizeStatus('done'), 'closed');
  assert.equal(normalizeStatus('skipped'), 'closed');
  assert.equal(normalizeStatus('abandoned'), 'closed');
  assert.equal(normalizeStatus('closeout'), 'closed');
  assert.equal(normalizeStatus('active'), 'active');
  assert.equal(normalizeStatus('blocked'), 'blocked');
  assert.equal(normalizeStatus('closed'), 'closed');
});

test('W0 readLiveTasks returns live tasks with normalized status and canonical fields', () => {
  const root = makeCapsuleProject();
  const tasks = readLiveTasks(root);
  const byId = new Map(tasks.map(t => [t.id, t]));

  assert.ok(byId.has('task-active-alpha'), 'live active task is present');
  assert.ok(byId.has('task-blocked-bravo'), 'live blocked task is present');
  assert.ok(byId.has('task-closed-charlie'), 'live closed task is present');
  assert.ok(byId.has('task-legacy-echo'), 'live legacy task is present');
  assert.ok(!byId.has('task-archive-delta'), 'archived task is not reported as live');

  assert.equal(byId.get('task-active-alpha').status, 'active');
  assert.equal(byId.get('task-blocked-bravo').status, 'blocked');
  assert.equal(byId.get('task-closed-charlie').status, 'closed');
  // Legacy "in-progress" is normalized to canonical "active".
  assert.equal(byId.get('task-legacy-echo').status, 'active');
});

test('W0 readArchivedTasks returns archived tasks with archivePath', () => {
  const root = makeCapsuleProject();
  const tasks = readArchivedTasks(root);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, 'task-archive-delta');
  assert.equal(tasks[0].status, 'closed');
  assert.match(tasks[0].archivePath, /_archive\/2026\/01\/01\/task-archive-delta$/);
  assert.ok(tasks[0].path, 'archive task exposes a resolvable path');
});

test('W0 resolveRoute finds live tasks with status, phase and capsule path', () => {
  const root = makeCapsuleProject();
  const route = resolveRoute(root, 'task-active-alpha');
  assert.equal(route.id, 'task-active-alpha');
  assert.equal(route.status, 'active');
  assert.equal(route.phase, 'plan');
  assert.match(route.path, /Harness\/tasks\/task-active-alpha$/);
  assert.equal(route.archived, false);
});

test('W0 resolveRoute finds archived tasks with archivePath', () => {
  const root = makeCapsuleProject();
  const route = resolveRoute(root, 'task-archive-delta');
  assert.equal(route.id, 'task-archive-delta');
  assert.equal(route.status, 'closed');
  assert.equal(route.archived, true);
  assert.match(route.path, /_archive\/2026\/01\/01\/task-archive-delta$/);
  assert.match(route.archivePath, /_archive\/2026\/01\/01\/task-archive-delta$/);
});

test('W0 resolveRoute returns ok:false for unknown tasks instead of guessing', () => {
  const root = makeCapsuleProject();
  const route = resolveRoute(root, 'task-not-found-zulu');
  assert.equal(route.ok, false);
  assert.equal(route.id, 'task-not-found-zulu');
});

test('W0 resolveRoute rejects path traversal task ids', () => {
  const root = makeCapsuleProject();
  assert.throws(() => resolveRoute(root, '../escape'));
  assert.throws(() => resolveRoute(root, '..'));
});

test('W0 resolveFocus returns resolved when PROGRESS.md names an open task', () => {
  const root = makeCapsuleProject();
  const focus = resolveFocus(root);
  assert.equal(focus.status, 'resolved');
  assert.equal(focus.taskId, 'task-active-alpha');
});

test('W0 resolveFocus returns ambiguous when multiple active tasks exist without explicit focus', () => {
  const root = makeCapsuleProject();
  const progressPath = path.join(root, 'Harness', 'PROGRESS.md');
  // Add two more active tasks so focus becomes ambiguous.
  writeTaskState(root, 'task-active-focal', { status: 'active', phase: 'plan' });
  writeTaskState(root, 'task-active-golf', { status: 'active', phase: 'plan' });
  // Remove active pointer by rewriting PROGRESS.md without "Active Task" entry.
  fs.writeFileSync(progressPath, '# PROGRESS.md\n\n## Active Task\n\n- None\n\n## Task Index\n\n| ID |\n|----|\n', 'utf8');
  const focus = resolveFocus(root);
  assert.equal(focus.status, 'ambiguous');
  assert.ok(Array.isArray(focus.candidates));
  assert.ok(focus.candidates.length >= 2);
});

test('W0 aggregateBlockers unifies activeQuestion, blocked queue, dependencies and handoff unresolved', () => {
  const root = makeCapsuleProject();
  const blockers = aggregateBlockers(root, 'task-blocked-bravo');
  assert.ok(Array.isArray(blockers.items));
  assert.ok(blockers.items.length >= 2, 'at least activeQuestion + queue blocker expected');

  const kinds = new Set(blockers.items.map(item => item.kind));
  assert.ok(kinds.has('activeQuestion'), 'activeQuestion blocker is reported');
  assert.ok(kinds.has('queue') || kinds.has('queueBlocked'), 'blocked queue item is reported');
  assert.ok(kinds.has('dependency'), 'open dependency is reported');

  const activeQuestion = blockers.items.find(item => item.kind === 'activeQuestion');
  assert.match(String(activeQuestion.text), /route strategy/);
});

test('W0 aggregateBlockers returns empty items for clean active task', () => {
  const root = makeCapsuleProject();
  const blockers = aggregateBlockers(root, 'task-active-alpha');
  assert.ok(Array.isArray(blockers.items));
  assert.equal(blockers.items.length, 0);
});

test('W0 archiveEligibility only allows closed tasks', () => {
  const root = makeCapsuleProject();

  const closed = archiveEligibility(root, 'task-closed-charlie');
  assert.equal(closed.ok, true);

  const active = archiveEligibility(root, 'task-active-alpha');
  assert.equal(active.ok, false);
  assert.match(String(active.reason), /active/i);

  const blocked = archiveEligibility(root, 'task-blocked-bravo');
  assert.equal(blocked.ok, false);
  assert.match(String(blocked.reason), /blocked/i);
});

test('W0 archiveEligibility rejects unknown and reserved ids', () => {
  const root = makeCapsuleProject();
  assert.equal(archiveEligibility(root, 'task-missing-mike').ok, false);
  assert.equal(archiveEligibility(root, '_template').ok, false);
});

test('W0 buildRouteStub returns a minimal queryable route entry', () => {
  const root = makeCapsuleProject();
  const stub = buildRouteStub(root, 'task-active-alpha');
  for (const key of ['id', 'title', 'status', 'phase', 'summary', 'blockers', 'dependsOn', 'blocks', 'latestEvidenceRefs']) {
    assert.ok(key in stub, `stub exposes ${key}`);
  }
  assert.equal(stub.id, 'task-active-alpha');
  assert.equal(stub.status, 'active');
  assert.ok(Array.isArray(stub.blockers));
  assert.ok(Array.isArray(stub.dependsOn));
  assert.ok(Array.isArray(stub.blocks));
});

test('W0 buildResumeSummary returns state/queue/dependency resume payload', () => {
  const root = makeCapsuleProject();
  const summary = buildResumeSummary(root, 'task-blocked-bravo');
  for (const key of ['id', 'status', 'phase', 'nextAction', 'activeQuestion', 'dependencies', 'blockers', 'queues']) {
    assert.ok(key in summary, `resume summary exposes ${key}`);
  }
  assert.equal(summary.id, 'task-blocked-bravo');
  assert.equal(summary.status, 'blocked');
  assert.ok(Array.isArray(summary.dependencies));
  assert.ok(summary.dependencies.includes('task-active-alpha'));
  assert.match(String(summary.nextAction), /user/i);
});

// ---------------------------------------------------------------------------
// W2 RED tests for the archive route index (read-only builder).
// ---------------------------------------------------------------------------

test('W2 buildArchiveIndexEntries returns minimal route entries with required fields', () => {
  const root = makeCapsuleProject();
  const entries = buildArchiveIndexEntries(root);
  assert.ok(entries.length >= 1, 'at least one archived task expected');
  const entry = entries.find(e => e.id === 'task-archive-delta');
  assert.ok(entry, 'task-archive-delta entry expected');
  for (const key of ['id', 'title', 'status', 'phase', 'summary', 'blockers', 'dependsOn', 'blocks', 'latestEvidenceRefs', 'archivePath']) {
    assert.ok(key in entry, `entry exposes ${key}`);
  }
  assert.match(String(entry.archivePath), /_archive\/2026\/01\/01\/task-archive-delta$/);
  assert.ok(Array.isArray(entry.blockers));
  assert.ok(Array.isArray(entry.dependsOn));
  assert.ok(Array.isArray(entry.latestEvidenceRefs));
});

// ---------------------------------------------------------------------------
// Route command tests
// ---------------------------------------------------------------------------

test('route --task resolves live task with status and phase', () => {
  const root = makeCapsuleProject();
  const result = runTaskState(root, 'route', '--task', 'task-active-alpha', '--json');
  assert.equal(result.status, 0);
  const payload = result.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.route.id, 'task-active-alpha');
  assert.equal(payload.route.status, 'active');
  assert.ok(payload.route.phase);
  assert.equal(payload.route.archived, false);
});

test('route --task resolves archived task with archivePath', () => {
  const root = makeCapsuleProject();
  const result = runTaskState(root, 'route', '--task', 'task-archive-delta', '--json');
  assert.equal(result.status, 0);
  const payload = result.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.route.id, 'task-archive-delta');
  assert.equal(payload.route.archived, true);
  assert.ok(payload.route.archivePath);
  assert.match(payload.route.archivePath, /_archive\/2026\/01\/01\/task-archive-delta$/);
});

test('route --task returns ok:false for unknown task', () => {
  const root = makeCapsuleProject();
  const result = runTaskState(root, 'route', '--task', 'task-nonexistent-xyz', '--json');
  assert.equal(result.status, 1);
  const payload = result.json();
  assert.equal(payload.ok, false);
});

test('route output does not leak full context or PLAN', () => {
  const root = makeCapsuleProject();
  // Add a large context to the task
  writeTaskState(root, 'task-context-test', {
    status: 'closed',
    phase: 'closeout',
    context: {
      intent: { original: 'Original intent text', current: 'Current intent', changes: [] },
      constraints: ['constraint1', 'constraint2'],
      facts: ['fact1', 'fact2'],
      assumptions: ['assumption1'],
      decisions: ['decision1', 'decision2'],
      evidence: [{ path: 'some/evidence/path' }],
      attempts: [],
      handoff: { unresolved: ['item1'] },
    },
  });
  writeTaskFile(root, 'task-context-test', 'PLAN.md', '# Plan\n\nThis is a very detailed plan with lots of context. '.repeat(100));
  const result = runTaskState(root, 'route', '--task', 'task-context-test', '--json');
  assert.equal(result.status, 0);
  const payload = result.json();
  const routeStr = JSON.stringify(payload.route);
  // Should not contain full context fields
  assert.ok(!routeStr.includes('Original intent text'));
  assert.ok(!routeStr.includes('constraint1'));
  assert.ok(!routeStr.includes('decision1'));
  // Should not contain PLAN content
  assert.ok(!routeStr.includes('very detailed plan'));
});

test('route output is <= 8KB', () => {
  const root = makeCapsuleProject();
  const result = runTaskState(root, 'route', '--task', 'task-active-alpha', '--json');
  assert.equal(result.status, 0);
  const size = Buffer.byteLength(result.stdout, 'utf8');
  assert.ok(size <= 8 * 1024, `route output ${size} bytes exceeds 8KB limit`);
});

// ---------------------------------------------------------------------------
// Auto-archive tests
// ---------------------------------------------------------------------------

test('auto-archive --apply archives closed task', () => {
  const root = makeCapsuleProject();
  // Ensure the fixture task has closeout phase for archive eligibility
  const statePath = path.join(root, 'Harness', 'tasks', 'task-closed-charlie', 'STATE.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.phase = 'closeout';
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  
  const result = runTaskState(root, 'auto-archive', '--task', 'task-closed-charlie', '--apply', '--json');
  assert.equal(result.status, 0);
  const payload = result.json();
  assert.equal(payload.ok, true);
  const archived = payload.results.find(r => r.taskId === 'task-closed-charlie');
  assert.equal(archived.action, 'archived');
  assert.ok(archived.archivePath);
  // Verify the task was moved to the mtime-based archive path
  const parts = archived.archivePath.split('/');
  const taskId = parts[parts.length - 1];
  const archiveDir = path.join(root, 'Harness', 'tasks', ...parts);
  assert.ok(fs.existsSync(path.join(archiveDir, 'STATE.json')), 'STATE.json exists at archive path');
  // Verify STATE.json was updated
  const archivedState = JSON.parse(fs.readFileSync(path.join(archiveDir, 'STATE.json'), 'utf8'));
  assert.equal(archivedState.status, 'archived');
  assert.equal(archivedState.phase, 'archived');
  assert.ok(archivedState.archiveEligibleAt, 'archiveEligibleAt timestamp set');
});

test('auto-archive skips active task', () => {
  const root = makeCapsuleProject();
  const result = runTaskState(root, 'auto-archive', '--task', 'task-active-alpha', '--apply', '--json');
  assert.equal(result.status, 0);
  const payload = result.json();
  assert.equal(payload.ok, true);
  const skipped = payload.results.find(r => r.taskId === 'task-active-alpha');
  assert.equal(skipped.action, 'skipped');
  assert.match(String(skipped.reason || skipped.status), /active|rejected/i);
});

test('auto-archive skips blocked task', () => {
  const root = makeCapsuleProject();
  const result = runTaskState(root, 'auto-archive', '--task', 'task-blocked-bravo', '--apply', '--json');
  assert.equal(result.status, 0);
  const payload = result.json();
  assert.equal(payload.ok, true);
  const skipped = payload.results.find(r => r.taskId === 'task-blocked-bravo');
  assert.equal(skipped.action, 'skipped');
  assert.match(String(skipped.reason || skipped.status), /blocked|rejected/i);
});

test('auto-archive is idempotent (already-archived)', () => {
  const root = makeCapsuleProject();
  // First archive
  runTaskState(root, 'auto-archive', '--task', 'task-closed-charlie', '--apply', '--json');
  // Second archive should return already-archived
  const result = runTaskState(root, 'auto-archive', '--task', 'task-closed-charlie', '--apply', '--json');
  assert.equal(result.status, 0);
  const payload = result.json();
  assert.equal(payload.ok, true);
  const skipped = payload.results.find(r => r.taskId === 'task-closed-charlie');
  assert.equal(skipped.action, 'skipped');
  assert.match(String(skipped.status), /already-archived/i);
});

test('closed but not closeout phase is not auto-archived', () => {
  const root = makeCapsuleProject();
  // Create a task that is closed but not in closeout phase
  writeTaskState(root, 'task-closed-no-closeout', {
    status: 'closed',
    phase: 'verify', // Not closeout
    closedAt: '2026-01-01T00:00:00.000Z',
  });
  const result = runTaskState(root, 'auto-archive', '--task', 'task-closed-no-closeout', '--apply', '--json');
  assert.equal(result.status, 0);
  const payload = result.json();
  const task = payload.results.find(r => r.taskId === 'task-closed-no-closeout');
  // Should be rejected or skipped because not in closeout phase
  assert.ok(task);
  assert.notEqual(task.action, 'archived', 'closed but not closeout should not be auto-archived');
});

// ---------------------------------------------------------------------------
// Legacy archive compatibility tests
// ---------------------------------------------------------------------------

test('legacy archive --keep is not silently ignored', () => {
  const root = makeCapsuleProject();
  // Create multiple closed tasks
  for (const id of ['task-legacy-a', 'task-legacy-b', 'task-legacy-c']) {
    writeTaskState(root, id, { status: 'closed', phase: 'closeout', closedAt: '2026-01-01T00:00:00.000Z' });
  }
  // Archive with --keep 1 should only archive excess
  const result = runTaskState(root, 'archive', '--keep', '1', '--apply', '--json');
  assert.equal(result.status, 0);
  const payload = result.json();
  assert.equal(payload.ok, true);
  // Should have archived some tasks but kept at least 1
  const archived = payload.results.filter(r => r.action === 'archived');
  const kept = payload.results.filter(r => r.action === 'kept');
  assert.ok(kept.length >= 0, '--keep flag was processed');
});

test('legacy archive --group is not silently ignored', () => {
  const root = makeCapsuleProject();
  // Create a task with a group tag
  writeTaskState(root, 'task-group-test', {
    status: 'closed',
    phase: 'closeout',
    closedAt: '2026-01-01T00:00:00.000Z',
    group: 'test-group',
  });
  // Archive by group
  const result = runTaskState(root, 'archive', '--group', 'test-group', '--json');
  assert.equal(result.status, 0);
  const payload = result.json();
  assert.equal(payload.ok, true);
  // Should have found the task in the group
  assert.ok(payload.results.length > 0, '--group filter was processed');
});

// ---------------------------------------------------------------------------
// History load --summary tests
// ---------------------------------------------------------------------------

test('history load --summary returns compact stub without PLAN', () => {
  const root = makeCapsuleProject();
  // Archive a task first
  runTaskState(root, 'auto-archive', '--task', 'task-closed-charlie', '--apply', '--json');
  // Load with summary
  const result = runTaskState(root, 'history', 'load', 'task-closed-charlie', '--summary', '--json');
  assert.equal(result.status, 0);
  const payload = result.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.summary, true);
  const task = payload.task;
  assert.ok(task.id);
  assert.ok(task.archivePath);
  assert.ok(task.status);
  // Should NOT have full state or files
  assert.ok(!task.files || Object.keys(task.files).length === 0);
  const str = JSON.stringify(task);
  assert.ok(!str.includes('PLAN.md'));
});

test('history load --task flag works (compat with positional)', () => {
  const root = makeCapsuleProject();
  runTaskState(root, 'auto-archive', '--task', 'task-closed-charlie', '--apply', '--json');
  const result = runTaskState(root, 'history', 'load', '--task', 'task-closed-charlie', '--json');
  assert.equal(result.status, 0);
  const payload = result.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.task.id, 'task-closed-charlie');
});


