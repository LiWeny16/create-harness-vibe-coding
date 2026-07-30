import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generate } from '../src/generator.js';

const tempRoots = [];

function tmpdir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-task-state-'));
  tempRoots.push(root);
  return root;
}

after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function generateProject() {
  const root = tmpdir();
  const targetDir = path.join(root, 'app');
  const result = generate({ projectName: 'app', targetDir });
  assert.equal(result.success, true, result.errors.join('\n'));
  return targetDir;
}

function relPath(root, rel) {
  return path.join(root, ...rel.split('/'));
}

function writeRel(root, rel, content) {
  fs.mkdirSync(path.dirname(relPath(root, rel)), { recursive: true });
  fs.writeFileSync(relPath(root, rel), content, 'utf8');
}

function readRel(root, rel) {
  return fs.readFileSync(relPath(root, rel), 'utf8');
}

function runNode(root, script, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function runTaskState(root, args = []) {
  return runNode(root, 'Harness/scripts/task-state.mjs', args);
}

function jsonResult(result) {
  assert.equal(result.stderr, '', result.stderr);
  return JSON.parse(result.stdout);
}

function progress(activeTask, rows) {
  return `# PROGRESS.md

Global task index.

## Active Task

- ${activeTask || 'None'}

## Task Index

Non-archived tasks only (max 5). Archived tasks are listed in \`Harness/tasks/_archive/INDEX.md\` (see \`Harness/specs/protocols/TASK_ARCHIVE.md\`).

| ID | Goal | Phase | Closed |
|----|------|-------|--------|
${rows.map(row => `| ${row.id} | ${row.goal || row.id} | ${row.phase} | ${row.closed || '-'} |`).join('\n')}

## Cross-Task Decisions

| Date | Decision | Reason |
|------|----------|--------|
`;
}

function writeTask(root, id, { state = null, phase = 'Implementation', mtime = null } = {}) {
  const dir = relPath(root, `Harness/tasks/${id}`);
  fs.mkdirSync(dir, { recursive: true });
  writeRel(root, `Harness/tasks/${id}/PROGRESS.md`, `# ${id} - PROGRESS

## Status

- Phase: ${phase}
`);
  if (state) {
    writeRel(root, `Harness/tasks/${id}/STATE.json`, JSON.stringify({
      schemaVersion: 1,
      taskId: id,
      mode: 'direct',
      tier: 'none',
      gate: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeQuestion: null,
      nextAction: 'Review task.',
      acceptance: [],
      queues: { ready: [], running: [], blocked: [], done: [] },
      dispatchLedger: [],
      decisions: [],
      risks: [],
      artifacts: [],
      ...state,
    }, null, 2) + '\n');
  }
  if (mtime) fs.utimesSync(dir, mtime, mtime);
}

test('task-state validate accepts an empty generated task set', () => {
  const root = generateProject();

  const result = runTaskState(root, ['validate', '--json']);
  const payload = jsonResult(result);

  assert.equal(result.status, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.activeTask, null);
  assert.equal(payload.taskCount, 0);
});

test('reconcile dry-run reports drift and apply repairs STATE plus root index', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress('task-keep-active', [
    { id: 'task-keep-active', goal: 'Keep current work active', phase: 'Implementation' },
    { id: 'task-finish-done', goal: 'Finish done work', phase: 'Verified' },
    { id: 'task-blocked-input', goal: 'Wait for input', phase: 'Blocked' },
  ]));
  writeTask(root, 'task-keep-active', {
    phase: 'Implementation',
    state: { status: 'active', phase: 'implementation' },
  });
  writeTask(root, 'task-finish-done', {
    phase: 'Verified',
    state: { status: 'active', phase: 'verified' },
  });
  writeTask(root, 'task-blocked-input', { phase: 'Current phase: Blocked' });

  const staleState = readRel(root, 'Harness/tasks/task-finish-done/STATE.json');
  const dryRun = runTaskState(root, ['reconcile', '--dry-run', '--json']);
  const dryPayload = jsonResult(dryRun);

  assert.equal(dryRun.status, 0);
  assert.equal(dryPayload.dryRun, true);
  assert.ok(dryPayload.operations.some(op => op.action === 'write-state' && op.taskId === 'task-finish-done'));
  assert.ok(dryPayload.operations.some(op => op.action === 'create-state' && op.taskId === 'task-blocked-input'));
  assert.equal(readRel(root, 'Harness/tasks/task-finish-done/STATE.json'), staleState);

  const apply = runTaskState(root, ['reconcile', '--apply', '--json']);
  const applyPayload = jsonResult(apply);
  assert.equal(apply.status, 0);
  assert.equal(applyPayload.dryRun, false);

  const doneState = JSON.parse(readRel(root, 'Harness/tasks/task-finish-done/STATE.json'));
  const blockedState = JSON.parse(readRel(root, 'Harness/tasks/task-blocked-input/STATE.json'));
  assert.equal(doneState.status, 'verified');
  assert.equal(doneState.phase, 'verified');
  assert.equal(blockedState.status, 'blocked');
  assert.equal(blockedState.phase, 'blocked');
  assert.match(readRel(root, 'Harness/PROGRESS.md'), /\| task-keep-active \| Keep current work active \| Implementation \| - \|/);

  const strict = runTaskState(root, ['validate', '--strict', '--json']);
  const strictPayload = jsonResult(strict);
  assert.equal(strict.status, 0);
  assert.equal(strictPayload.ok, true);
});

test('archive apply moves safe tasks and rewrites root Task Index', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress('task-keep-active', [
    { id: 'task-keep-active', goal: 'Keep active', phase: 'Implementation' },
    { id: 'task-finish-one', goal: 'Finish one', phase: 'Verified' },
    { id: 'task-finish-two', goal: 'Finish two', phase: 'Verified' },
  ]));

  writeTask(root, 'task-keep-active', {
    phase: 'Implementation',
    state: { status: 'active', phase: 'implement' },
    mtime: new Date('2026-01-03T00:00:00.000Z'),
  });
  writeTask(root, 'task-finish-one', {
    phase: 'Verified',
    state: { status: 'verified', phase: 'verified' },
    mtime: new Date('2024-01-01T00:00:00.000Z'),
  });
  writeTask(root, 'task-finish-two', {
    phase: 'Verified',
    state: { status: 'complete', phase: 'verified' },
    mtime: new Date('2025-01-01T00:00:00.000Z'),
  });

  const dryRun = runTaskState(root, ['archive', '--keep', '1', '--dry-run', '--json']);
  const dryPayload = jsonResult(dryRun);
  assert.equal(dryRun.status, 0);
  assert.equal(dryPayload.toArchive, 2);
  assert.equal(fs.existsSync(relPath(root, 'Harness/tasks/task-finish-one')), true);

  const apply = runTaskState(root, ['archive', '--keep', '1', '--apply', '--json']);
  const payload = jsonResult(apply);
  assert.equal(apply.status, 0);
  assert.equal(payload.dryRun, false);
  assert.equal(payload.toArchive, 2);

  assert.equal(fs.existsSync(relPath(root, 'Harness/tasks/task-finish-one')), false);
  assert.equal(fs.existsSync(relPath(root, 'Harness/tasks/_archive/2024/01/01/task-finish-one')), true);
  assert.equal(fs.existsSync(relPath(root, 'Harness/tasks/_archive/2025/01/01/task-finish-two')), true);
  const archivedState = JSON.parse(readRel(root, 'Harness/tasks/_archive/2024/01/01/task-finish-one/STATE.json'));
  assert.equal(archivedState.status, 'archived');
  assert.equal(archivedState.phase, 'archived');
  assert.doesNotMatch(readRel(root, 'Harness/PROGRESS.md'), /task-finish-one/);
  assert.match(readRel(root, 'Harness/tasks/_archive/INDEX.md'), /task-finish-one/);
});

test('transition command reports its command label and updates state by default', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress('task-keep-active', [
    { id: 'task-keep-active', goal: 'Keep active', phase: 'Implementation' },
  ]));
  writeTask(root, 'task-keep-active', {
    phase: 'Implementation',
    state: { status: 'active', phase: 'implement' },
  });

  const result = runTaskState(root, ['transition', 'task-keep-active', '--status', 'verified', '--phase', 'verified', '--json']);
  const payload = jsonResult(result);

  assert.equal(result.status, 0);
  assert.equal(payload.command, 'transition');
  assert.equal(payload.activeTask, null);
  const state = JSON.parse(readRel(root, 'Harness/tasks/task-keep-active/STATE.json'));
  assert.equal(state.status, 'verified');
  assert.equal(state.phase, 'verified');
  assert.match(readRel(root, 'Harness/tasks/task-keep-active/PROGRESS.md'), /- Phase: Verified/);
});

test('archive-tasks compatibility entry delegates to task-state archive', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id: 'task-finish-one', goal: 'Finish one', phase: 'Verified' },
  ]));
  writeTask(root, 'task-finish-one', {
    phase: 'Verified',
    state: { status: 'verified', phase: 'verified' },
  });

  const result = runNode(root, 'Harness/scripts/archive-tasks.mjs', ['--task', 'task-finish-one', '--dry-run', '--json']);
  const payload = jsonResult(result);

  assert.equal(result.status, 0);
  assert.equal(payload.command, 'archive');
  assert.equal(payload.results[0].action, 'would-archive');
});

test('archive-tasks compatibility help keeps old command surface', () => {
  const root = generateProject();

  const result = runNode(root, 'Harness/scripts/archive-tasks.mjs', ['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node Harness\/scripts\/archive-tasks\.mjs/);
  assert.match(result.stdout, /task-state\.mjs archive/);
  assert.match(result.stdout, /--apply/);
});

test('validate-harness strict reports task-state drift with task-state guidance', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress('task-keep-active', [
    { id: 'task-keep-active', goal: 'Keep active', phase: 'Implementation' },
    { id: 'task-drift-active', goal: 'Drift active', phase: 'Verified' },
  ]));
  writeTask(root, 'task-keep-active', {
    phase: 'Implementation',
    state: { status: 'active', phase: 'implement' },
  });
  writeTask(root, 'task-drift-active', {
    phase: 'Verified',
    state: { status: 'active', phase: 'verified' },
  });

  const normal = runNode(root, 'Harness/scripts/validate-harness.mjs');
  assert.equal(normal.status, 0);
  assert.match(`${normal.stdout}\n${normal.stderr}`, /Warning: Harness\/tasks\/task-drift-active\/STATE\.json is active/);

  const strict = runNode(root, 'Harness/scripts/validate-harness.mjs', ['--strict']);
  assert.notEqual(strict.status, 0);
  const output = `${strict.stdout}\n${strict.stderr}`;
  assert.match(output, /STATE\.json is active but Harness\/PROGRESS\.md Active Task/);
  assert.match(output, /task-state\.mjs/);
});

test('list --json returns valid JSON with tasks array and dependsOn/blocks fields', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress('task-active', [
    { id: 'task-active', goal: 'Active task', phase: 'Implementation' },
    { id: 'task-other', goal: 'Other task', phase: 'Verified' },
  ]));
  writeTask(root, 'task-active', {
    phase: 'Implementation',
    state: { status: 'active', phase: 'implement', links: { dependsOn: ['task-other'], blocks: [] }, nextAction: 'Do something' },
  });
  writeTask(root, 'task-other', {
    phase: 'Verified',
    state: { status: 'verified', phase: 'verified', links: { dependsOn: [], blocks: ['task-active'] } },
  });

  const result = runTaskState(root, ['list', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.command, 'list');
  assert.ok(Array.isArray(payload.tasks));
  assert.equal(payload.tasks.length, 2);

  const active = payload.tasks.find(t => t.id === 'task-active');
  assert.ok(active);
  assert.deepEqual(active.dependsOn, ['task-other']);
  assert.deepEqual(active.blocks, []);
  assert.equal(active.openTasks, true);
  assert.equal(active.nextAction, 'Do something');

  const other = payload.tasks.find(t => t.id === 'task-other');
  assert.ok(other);
  assert.deepEqual(other.dependsOn, []);
  assert.deepEqual(other.blocks, ['task-active']);
  assert.equal(other.openTasks, false);
});

test('open --json returns valid JSON with only open tasks', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress('task-active-one', [
    { id: 'task-active-one', goal: 'Active one', phase: 'Implementation' },
    { id: 'task-active-two', goal: 'Active two', phase: 'Implementation' },
    { id: 'task-done', goal: 'Done', phase: 'Verified' },
  ]));
  writeTask(root, 'task-active-one', {
    phase: 'Implementation',
    state: { status: 'active', phase: 'implement' },
  });
  writeTask(root, 'task-active-two', {
    phase: 'Implementation',
    state: { status: 'in_progress', phase: 'implement' },
  });
  writeTask(root, 'task-done', {
    phase: 'Verified',
    state: { status: 'verified', phase: 'verified' },
  });

  const result = runTaskState(root, ['open', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.ok(Array.isArray(payload.tasks));
  assert.equal(payload.taskCount, 2);

  const ids = payload.tasks.map(t => t.id).sort();
  assert.deepEqual(ids, ['task-active-one', 'task-active-two']);
});

test('validate --json returns valid JSON with ok/errors/warnings', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress('task-validate-task', [
    { id: 'task-validate-task', goal: 'Validate test', phase: 'Implementation' },
  ]));
  writeTask(root, 'task-validate-task', {
    phase: 'Implementation',
    state: { status: 'active', phase: 'implement' },
  });

  const result = runTaskState(root, ['validate', '--json']);
  const payload = jsonResult(result);
  assert.ok('ok' in payload);
  assert.ok('errors' in payload);
  assert.ok('warnings' in payload);
  assert.ok(Array.isArray(payload.errors));
  assert.ok(Array.isArray(payload.warnings));
  assert.ok(Array.isArray(payload.tasks));
});

test('validate cap warning points users to wf-task-archive', () => {
  const root = generateProject();
  const rows = [];
  for (let i = 1; i <= 6; i += 1) {
    const id = `task-archive-hint-${i}`;
    rows.push({ id, goal: `Archive hint ${i}`, phase: 'Verified' });
    writeTask(root, id, {
      phase: 'Verified',
      state: { status: 'verified', phase: 'verified' },
    });
  }
  writeRel(root, 'Harness/PROGRESS.md', progress(null, rows));

  const result = runTaskState(root, ['validate', '--json']);
  const payload = jsonResult(result);

  assert.equal(result.status, 0);
  assert.ok(payload.warnings.some(warning => warning.includes('$wf-task-archive')));
  assert.ok(!payload.warnings.some(warning => warning.includes('run node Harness/scripts/task-state.mjs archive --apply')));
});

test('record --create --apply --dry-run reports dry-run without writing files', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const result = runTaskState(root, ['record', 'task-record-test', '--create', '--dry-run', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.command, 'record');
  assert.equal(payload.action, 'created');
  assert.equal(payload.dryRun, true);

  assert.equal(fs.existsSync(relPath(root, 'Harness/tasks/task-record-test/STATE.json')), false);
});

test('record --create --apply creates task capsule and updates root PROGRESS.md', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const result = runTaskState(root, ['record', 'task-created-apply', '--create', '--apply', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.action, 'created');
  assert.equal(payload.dryRun, false);

  assert.equal(fs.existsSync(relPath(root, 'Harness/tasks/task-created-apply/STATE.json')), true);
  const state = JSON.parse(readRel(root, 'Harness/tasks/task-created-apply/STATE.json'));
  assert.equal(state.taskId, 'task-created-apply');
  assert.equal(fs.existsSync(relPath(root, 'Harness/tasks/task-created-apply/PROGRESS.md')), true);
  assert.equal(fs.existsSync(relPath(root, 'Harness/tasks/task-created-apply/PLAN.md')), true);
  assert.match(readRel(root, 'Harness/PROGRESS.md'), /\| task-created-apply \|/);
});

test('record accepts boolean flags before task id', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const result = runTaskState(root, ['record', '--create', 'task-flag-order', '--apply', '--json']);
  const payload = jsonResult(result);

  assert.equal(result.status, 0);
  assert.equal(payload.action, 'created');
  assert.equal(payload.taskId, 'task-flag-order');
  assert.equal(fs.existsSync(relPath(root, 'Harness/tasks/task-flag-order/STATE.json')), true);
});

test('record with non-existent task and no --create reports error', () => {
  const root = generateProject();

  const result = runTaskState(root, ['record', 'task-test-non-existent', '--json']);
  const payload = jsonResult(result);
  assert.equal(payload.ok, false);
  assert.ok(payload.errors.some(e => e.includes('not found') || e.includes('--create')));
});

test('record updates existing task state', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id: 'task-update-me', goal: 'Update me', phase: 'Implementation' },
  ]));
  writeTask(root, 'task-update-me', {
    phase: 'Implementation',
    state: { status: 'active', phase: 'implement', nextAction: 'Before' },
  });

  const result = runTaskState(root, ['record', 'task-update-me', '--text', 'After text', '--status', 'verified', '--apply', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.action, 'updated');

  const updated = JSON.parse(readRel(root, 'Harness/tasks/task-update-me/STATE.json'));
  assert.equal(updated.nextAction, 'After text');
  assert.equal(updated.status, 'verified');
});

test('validate rejects duplicate queue membership on a closed task', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id: 'task-queue-drift', goal: 'Queue drift', phase: 'Verified' },
  ]));
  writeTask(root, 'task-queue-drift', {
    phase: 'Verified',
    state: {
      status: 'verified',
      phase: 'verified',
      queues: {
        ready: [{ id: 'W1', next: 'stale ready item' }],
        running: [],
        blocked: [],
        done: ['W1'],
      },
    },
  });

  const result = runTaskState(root, ['validate', '--json']);
  const payload = jsonResult(result);

  assert.notEqual(result.status, 0);
  assert.equal(payload.ok, false);
  assert.ok(payload.errors.some(error => error.includes('appears in both ready and done')));
  assert.ok(payload.errors.some(error => error.includes('closed task has non-empty ready/running/blocked queues')));
});

test('record --status bogus exits non-zero with error message', () => {
  const root = generateProject();

  const result1 = runTaskState(root, ['record', 'task-bogus-status', '--create', '--status', 'bogus', '--json']);
  assert.notEqual(result1.status, 0);
  const payload1 = jsonResult(result1);
  assert.equal(payload1.ok, false);
  assert.ok(payload1.errors.some(e => e.includes('Invalid status "bogus"')));

  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id: 'task-exists-update', goal: 'Exists', phase: 'Implementation' },
  ]));
  writeTask(root, 'task-exists-update', {
    phase: 'Implementation',
    state: { status: 'active', phase: 'implement' },
  });

  const result2 = runTaskState(root, ['record', 'task-exists-update', '--status', 'bogus', '--json']);
  assert.notEqual(result2.status, 0);
  const payload2 = jsonResult(result2);
  assert.equal(payload2.ok, false);
  assert.ok(payload2.errors.some(e => e.includes('Invalid status "bogus"')));
});

test('record --title "specific-match" finds and updates matching open task', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id: 'task-specific-match', goal: 'This is specific match', phase: 'Implementation' },
  ]));
  writeTask(root, 'task-specific-match', {
    phase: 'Implementation',
    state: { status: 'active', phase: 'implement' },
  });

  const result = runTaskState(root, ['record', '--title', 'specific-match', '--text', 'Updated via title', '--apply', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.action, 'updated');
  assert.equal(payload.taskId, 'task-specific-match');
  const state = JSON.parse(readRel(root, 'Harness/tasks/task-specific-match/STATE.json'));
  assert.equal(state.nextAction, 'Updated via title');
});

test('record --title "no-match-xyz" creates new task with auto-generated task-id', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const result = runTaskState(root, ['record', '--title', 'no-match-xyz', '--text', 'Fresh task', '--apply', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.action, 'created');
  assert.ok(payload.taskId.startsWith('task-no-match-xyz'));
  assert.equal(fs.existsSync(relPath(root, `Harness/tasks/${payload.taskId}/STATE.json`)), true);
  const state = JSON.parse(readRel(root, `Harness/tasks/${payload.taskId}/STATE.json`));
  assert.equal(state.nextAction, 'Fresh task');
});

test('record --title "common" with multiple matches exits non-zero with ambiguous message', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id: 'task-common-one', goal: 'A common goal', phase: 'Implementation' },
    { id: 'task-common-two', goal: 'Another common goal', phase: 'Implementation' },
  ]));
  writeTask(root, 'task-common-one', {
    phase: 'Implementation',
    state: { status: 'in_progress', phase: 'implement' },
  });
  writeTask(root, 'task-common-two', {
    phase: 'Implementation',
    state: { status: 'in_progress', phase: 'implement' },
  });

  const result = runTaskState(root, ['record', '--title', 'common', '--json']);
  assert.notEqual(result.status, 0);
  const payload = jsonResult(result);
  assert.equal(payload.ok, false);
  assert.ok(payload.errors.some(e => e.includes('Ambiguous match')));
});

test('record --title "common" --new forces create', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id: 'task-common-one', goal: 'Common goal', phase: 'Implementation' },
  ]));
  writeTask(root, 'task-common-one', {
    phase: 'Implementation',
    state: { status: 'in_progress', phase: 'implement' },
  });

  const result = runTaskState(root, ['record', '--title', 'common', '--new', '--text', 'Forced new', '--apply', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.action, 'created');
  assert.ok(payload.taskId.startsWith('task-common-'));
  assert.notEqual(payload.taskId, 'task-common-one');
});

test('record --note "unique-note-text" matches and updates matching open task', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id: 'task-note-match', goal: 'This has unique note content', phase: 'Implementation' },
  ]));
  writeTask(root, 'task-note-match', {
    phase: 'Implementation',
    state: { status: 'active', phase: 'implement', nextAction: 'Original action' },
  });

  const result = runTaskState(root, ['record', '--note', 'unique note content for matching', '--text', 'Matched by note', '--apply', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.action, 'updated');
  assert.equal(payload.taskId, 'task-note-match');
  const state = JSON.parse(readRel(root, 'Harness/tasks/task-note-match/STATE.json'));
  assert.equal(state.nextAction, 'Matched by note');
});

test('record --note "unique-note-text" with no match creates new task', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const result = runTaskState(root, ['record', '--note', 'completely unmatched note text here', '--text', 'Created from note', '--apply', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.action, 'created');
  assert.ok(payload.taskId.startsWith('task-'));
  assert.equal(fs.existsSync(relPath(root, `Harness/tasks/${payload.taskId}/STATE.json`)), true);
  const state = JSON.parse(readRel(root, `Harness/tasks/${payload.taskId}/STATE.json`));
  assert.equal(state.nextAction, 'Created from note');
});

test('record --title "Global Install" creates task with correctly lowercased slug', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const result = runTaskState(root, ['record', '--title', 'Global Install', '--text', 'Test', '--apply', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.action, 'created');
  // slug should be "global-install", not "lobal-nstall"
  assert.ok(payload.taskId.startsWith('task-global-install-'), `expected task-global-install-*, got ${payload.taskId}`);
});

test('record --title "UPPER" creates task with lowercased slug', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const result = runTaskState(root, ['record', '--title', 'UPPER', '--text', 'Test', '--apply', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.action, 'created');
  // slug should be "upper", not empty
  assert.ok(payload.taskId.startsWith('task-upper-'), `expected task-upper-*, got ${payload.taskId}`);
});

test('record --title "你好世界" creates task with fallback slug', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const result = runTaskState(root, ['record', '--title', '你好世界', '--text', 'Test', '--apply', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.action, 'created');
  // slug should fallback to "task", not be empty
  assert.ok(payload.taskId.startsWith('task-task-'), `expected task-task-*, got ${payload.taskId}`);
});

test('--new creates different task-ids with same title on same day', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  // First --new
  const r1 = runTaskState(root, ['record', '--title', 'Unique Today', '--text', 'First', '--new', '--apply', '--json']);
  const p1 = jsonResult(r1);
  assert.equal(r1.status, 0);
  assert.equal(p1.action, 'created');

  // Second --new with same title
  const r2 = runTaskState(root, ['record', '--title', 'Unique Today', '--text', 'Second', '--new', '--apply', '--json']);
  const p2 = jsonResult(r2);
  assert.equal(r2.status, 0);
  assert.equal(p2.action, 'created');

  // Must have different task ids
  assert.notEqual(p1.taskId, p2.taskId, 'two --new calls with same title must produce different task ids');
  // Second id should be the first plus -2 suffix
  assert.equal(p2.taskId, `${p1.taskId}-2`);
  // Both task dirs must exist
  assert.equal(fs.existsSync(relPath(root, `Harness/tasks/${p1.taskId}/STATE.json`)), true);
  assert.equal(fs.existsSync(relPath(root, `Harness/tasks/${p2.taskId}/STATE.json`)), true);
});

test('--new with unique title creates task without numeric suffix', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const result = runTaskState(root, ['record', '--title', 'Totally Fresh', '--text', 'Test', '--new', '--apply', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0);
  assert.equal(payload.action, 'created');
  // Must end with MMDD date suffix (no extra -N)
  assert.match(payload.taskId, /^task-totally-fresh-\d{4}$/);
});

test('record with no args exits non-zero with requires message', () => {
  const root = generateProject();

  const result = runTaskState(root, ['record', '--json']);
  assert.notEqual(result.status, 0);
  const payload = jsonResult(result);
  assert.equal(payload.ok, false);
  assert.ok(payload.errors.some(e => e.includes('requires')));
});
