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
  assert.equal(fs.existsSync(relPath(root, 'Harness/tasks/_archive/2024/task-finish-one')), true);
  assert.equal(fs.existsSync(relPath(root, 'Harness/tasks/_archive/2025/task-finish-two')), true);
  const archivedState = JSON.parse(readRel(root, 'Harness/tasks/_archive/2024/task-finish-one/STATE.json'));
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
