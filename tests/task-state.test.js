import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from './support/temp-root.js';
import { spawnSync } from 'node:child_process';
import { generate } from '../src/generator.js';

const tempRoots = [];

function tmpdir() {
  const root = makeHarnessTempRoot('harness-task-state-');
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
  assert.equal(doneState.status, 'closed');
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
  assert.equal(state.status, 'closed');
  assert.equal(state.phase, 'verified');
  assert.match(readRel(root, 'Harness/tasks/task-keep-active/PROGRESS.md'), /- Phase: Verified/);
});

test('archive-tasks compatibility entry delegates to task-state auto-archive', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id: 'task-finish-one', goal: 'Finish one', phase: 'Closeout' },
  ]));
  writeTask(root, 'task-finish-one', {
    phase: 'Closeout',
    state: { status: 'closed', phase: 'closeout', closedAt: '2026-01-01T00:00:00.000Z' },
  });

  const result = runNode(root, 'Harness/scripts/archive-tasks.mjs', ['--task', 'task-finish-one', '--dry-run', '--json']);
  const payload = jsonResult(result);

  assert.equal(result.status, 0);
  assert.equal(payload.command, 'auto-archive');
  assert.equal(payload.results[0].action, 'would-archive');
});

test('archive-tasks compatibility with --keep uses legacy archive', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id: 'task-finish-one', goal: 'Finish one', phase: 'Closeout' },
  ]));
  writeTask(root, 'task-finish-one', {
    phase: 'Closeout',
    state: { status: 'closed', phase: 'closeout', closedAt: '2026-01-01T00:00:00.000Z' },
  });

  const result = runNode(root, 'Harness/scripts/archive-tasks.mjs', ['--task', 'task-finish-one', '--keep', '5', '--dry-run', '--json']);
  const payload = jsonResult(result);

  assert.equal(result.status, 0);
  assert.equal(payload.command, 'archive');
});

test('archive-tasks compatibility help shows deprecation notice', () => {
  const root = generateProject();

  const result = runNode(root, 'Harness/scripts/archive-tasks.mjs', ['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /DEPRECATED/);
  assert.match(result.stdout, /auto-archive/);
  assert.match(result.stdout, /--apply/);
});

test('validate-harness strict accepts multiple active task capsules', () => {
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

  const normal = runTaskState(root, ['validate', '--json']);
  assert.equal(normal.status, 0);
  const normalPayload = jsonResult(normal);
  assert.equal(normalPayload.ok, true);
  assert.equal(normalPayload.tasks.filter(task => task.status === 'active').length, 2);

  const strict = runTaskState(root, ['validate', '--strict', '--json']);
  assert.equal(strict.status, 0);
  assert.equal(jsonResult(strict).ok, true);
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

test('fresh task records use canonical lifecycle, project tags, dates, and generated index', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const create = runTaskState(root, [
    'record', 'task-indexed-feature', '--create', '--project', 'wf-core',
    '--tag', 'routing,release', '--phase', 'implement', '--text', 'Build the task route', '--apply', '--json',
  ]);
  const payload = jsonResult(create);
  assert.equal(create.status, 0);
  assert.equal(payload.state.status, 'active');
  assert.equal(payload.state.project, 'wf-core');
  assert.equal(payload.state.phase, 'implement');
  assert.deepEqual(payload.state.tags, ['routing', 'release']);
  assert.match(payload.state.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(payload.state.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(payload.state.closedAt, null);

  const index = JSON.parse(readRel(root, 'Harness/tasks/INDEX.json'));
  assert.deepEqual(index.projects['wf-core'], ['task-indexed-feature']);
  assert.equal(index.tasks[0].status, 'active');
  assert.equal(index.tasks[0].project, 'wf-core');
  assert.deepEqual(index.tasks[0].tags, ['routing', 'release']);
  assert.match(readRel(root, 'Harness/tasks/INDEX.md'), /Task Index \(generated\)/);

  const query = runTaskState(root, ['query', 'release', '--project', 'wf-core', '--json']);
  const queryPayload = jsonResult(query);
  assert.equal(query.status, 0);
  assert.equal(queryPayload.count, 1);
  assert.equal(queryPayload.results[0].id, 'task-indexed-feature');
  assert.ok(queryPayload.results[0].hits.some(hit => hit.file === 'STATE.json'));

  const list = runTaskState(root, ['list', '--project', 'wf-core', '--status', 'active', '--json']);
  const listPayload = jsonResult(list);
  assert.equal(list.status, 0);
  assert.deepEqual(listPayload.tasks.map(task => task.id), ['task-indexed-feature']);
});

test('AC-001 explicit WF task becomes the durable resume focus and advertises managed lifecycle', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const create = runTaskState(root, [
    'record', 'task-wf-resume-contract', '--create', '--mode', 'wf', '--project', 'wf-core', '--apply', '--json',
  ]);
  const created = JSON.parse(create.stdout);
  assert.equal(create.status, 0, create.stderr);
  assert.equal(created.state.mode, 'wf');

  const rootProgress = readRel(root, 'Harness/PROGRESS.md');
  assert.match(rootProgress, /## Active Task\s+\r?\n\s*- task-wf-resume-contract/);

  const listed = jsonResult(runTaskState(root, ['list', '--json']));
  const task = listed.tasks.find(item => item.id === 'task-wf-resume-contract');
  assert.ok(task);
  assert.equal(task.wfManaged, true);
  assert.equal(task.resumeRequired, true);

  const opened = jsonResult(runTaskState(root, ['open', '--json']));
  assert.equal(opened.tasks[0].wfManaged, true);
  assert.equal(opened.tasks[0].resumeRequired, true);

  const index = JSON.parse(readRel(root, 'Harness/tasks/INDEX.json'));
  assert.equal(index.activeTask, 'task-wf-resume-contract');
  assert.equal(index.resumeTask.taskId, 'task-wf-resume-contract');
});

test('AC-002 direct tasks cannot be promoted and managed WF tasks cannot exit or reopen', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const direct = runTaskState(root, [
    'record', 'task-direct-forever', '--create', '--apply', '--json',
  ]);
  assert.equal(direct.status, 0);
  const promote = runTaskState(root, [
    'record', 'task-direct-forever', '--mode', 'wf', '--apply', '--json',
  ]);
  assert.notEqual(promote.status, 0);
  assert.match(promote.stdout, /direct task|promot|WF-managed/i);

  const managed = runTaskState(root, [
    'record', 'task-wf-locked', '--create', '--mode', 'wf-max', '--apply', '--json',
  ]);
  assert.equal(managed.status, 0);
  const downgrade = runTaskState(root, [
    'record', 'task-wf-locked', '--mode', 'direct', '--apply', '--json',
  ]);
  assert.notEqual(downgrade.status, 0);
  assert.match(downgrade.stdout, /cannot|downgrade|exit|WF/i);

  const close = runTaskState(root, [
    'transition', 'task-wf-locked', '--status', 'closed', '--phase', 'closeout', '--apply', '--json',
  ]);
  assert.equal(close.status, 0, close.stderr);
  const reopen = runTaskState(root, [
    'transition', 'task-wf-locked', '--status', 'active', '--phase', 'implement', '--apply', '--json',
  ]);
  assert.notEqual(reopen.status, 0);
  assert.match(reopen.stdout, /closed|new task|reopen|WF/i);

  const replacement = runTaskState(root, [
    'record', 'task-wf-replacement', '--create', '--mode', 'wf', '--apply', '--json',
  ]);
  assert.equal(replacement.status, 0);
  assert.equal(JSON.parse(readRel(root, 'Harness/tasks/task-wf-locked/STATE.json')).mode, 'wf-max');
  assert.equal(JSON.parse(readRel(root, 'Harness/tasks/task-wf-replacement/STATE.json')).mode, 'wf');
});

test('open WF focus cannot be replaced by a direct task', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));
  assert.equal(runTaskState(root, ['record', 'task-wf-focus', '--create', '--mode', 'wf', '--apply', '--json']).status, 0);
  assert.equal(runTaskState(root, ['record', 'task-direct-sidecar', '--create', '--apply', '--json']).status, 0);

  const result = runTaskState(root, ['set-active', 'task-direct-sidecar', '--apply', '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /cannot replace|WF-managed focus/i);
  assert.match(readRel(root, 'Harness/PROGRESS.md'), /## Active Task\s+\r?\n\s*- task-wf-focus/);
});

test('validate rejects a direct focus while a managed WF task remains open', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));
  assert.equal(runTaskState(root, ['record', 'task-wf-focus-validation', '--create', '--mode', 'wf', '--apply', '--json']).status, 0);
  assert.equal(runTaskState(root, ['record', 'task-direct-focus-validation', '--create', '--apply', '--json']).status, 0);
  writeRel(root, 'Harness/PROGRESS.md', progress('task-direct-focus-validation', [
    { id: 'task-wf-focus-validation', goal: 'Managed focus', phase: 'Intake' },
    { id: 'task-direct-focus-validation', goal: 'Direct focus', phase: 'Intake' },
  ]));

  const result = runTaskState(root, ['validate', '--strict', '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Direct task.*active focus.*WF-managed/i);
});

test('only wf and wf-max opt tasks into the durable WF lifecycle', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress(null, []));

  const auto = runTaskState(root, [
    'record', 'task-auto-capability', '--create', '--mode', 'wf-auto', '--apply', '--json',
  ]);
  assert.equal(auto.status, 0, auto.stderr);
  const listed = jsonResult(runTaskState(root, ['list', '--json']));
  const task = listed.tasks.find(item => item.id === 'task-auto-capability');
  assert.equal(task.mode, 'wf-auto');
  assert.equal(task.wfManaged, false);
  assert.equal(task.resumeRequired, false);
  assert.equal(JSON.parse(readRel(root, 'Harness/tasks/INDEX.json')).activeTask, null);
});

test('legacy group and status aliases remain readable while query and transition use canonical output', () => {
  const root = generateProject();
  writeRel(root, 'Harness/PROGRESS.md', progress('task-legacy-record', [
    { id: 'task-legacy-record', goal: 'Legacy migration', phase: 'Verified' },
  ]));
  writeTask(root, 'task-legacy-record', {
    phase: 'Verified',
    state: { status: 'verified', group: 'legacy-project' },
  });

  const list = runTaskState(root, ['list', '--group', 'legacy-project', '--json']);
  const listPayload = jsonResult(list);
  assert.equal(list.status, 0);
  assert.equal(listPayload.tasks[0].status, 'closed');
  assert.equal(listPayload.tasks[0].project, 'legacy-project');

  const transition = runTaskState(root, ['transition', 'task-legacy-record', '--status', 'active', '--phase', 'implement', '--json']);
  assert.equal(transition.status, 0);
  const state = JSON.parse(readRel(root, 'Harness/tasks/task-legacy-record/STATE.json'));
  assert.equal(state.status, 'active');
  assert.equal(state.closedAt, null);
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
  assert.equal(updated.status, 'closed');
});

test('AC-005 closing a task synchronizes state, task progress, root progress, and index', () => {
  const root = generateProject();
  const taskId = 'task-close-view-sync';

  const create = runTaskState(root, [
    'record',
    taskId,
    '--create',
    '--project',
    'harness-foundations',
    '--text',
    'Close view synchronization',
    '--apply',
    '--json',
  ]);
  assert.equal(create.status, 0, create.stderr);

  const close = runTaskState(root, [
    'record',
    taskId,
    '--status',
    'closed',
    '--phase',
    'closeout',
    '--apply',
    '--json',
  ]);
  assert.equal(close.status, 0, close.stderr);
  const state = JSON.parse(readRel(root, `Harness/tasks/${taskId}/STATE.json`));
  assert.equal(state.status, 'closed');
  assert.ok(state.closedAt);
  assert.match(readRel(root, `Harness/tasks/${taskId}/PROGRESS.md`), /Phase: Closeout/);
  assert.match(readRel(root, 'Harness/PROGRESS.md'), new RegExp(`\\| ${taskId} \\| .* \\| Closeout \\| ${state.closedAt.slice(0, 10)} \\|`));
  const index = JSON.parse(readRel(root, 'Harness/tasks/INDEX.json'));
  assert.equal(index.tasks.find(task => task.id === taskId).status, 'closed');
});

test('AC-005 set-active rejects a closed task and preserves the current focus', () => {
  const root = generateProject();
  const closedId = 'task-closed-focus';
  const activeId = 'task-open-focus';
  writeTask(root, closedId, { state: { taskId: closedId, status: 'closed', phase: 'closeout', closedAt: '2026-01-02T00:00:00.000Z' } });
  writeTask(root, activeId, { state: { taskId: activeId, status: 'active', phase: 'implement' } });
  writeRel(root, 'Harness/PROGRESS.md', progress(activeId, [
    { id: closedId, goal: 'Closed task', phase: 'Closeout', closed: '2026-01-02' },
    { id: activeId, goal: 'Active task', phase: 'Implementation' },
  ]));

  const result = runTaskState(root, ['set-active', closedId, '--apply', '--json']);
  const payload = jsonResult(result);

  assert.equal(result.status, 1);
  assert.match(payload.errors.join('\n'), /closed/i);
  assert.match(readRel(root, 'Harness/PROGRESS.md'), new RegExp(`Active Task\\s+- ${activeId}`));
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

test('reopen just-closed WF-managed task preserves mode/queue/question and records reason', () => {
  const root = generateProject();
  const id = 'task-wf-reopen-allow';
  const ts = '2026-01-05T00:00:00.000Z';
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id, goal: 'Reopen allow', phase: 'Closeout', closed: '2026-01-05' },
  ]));
  writeTask(root, id, {
    phase: 'Closeout',
    state: {
      taskId: id, mode: 'wf-max', status: 'closed', phase: 'closeout',
      closedAt: ts, updatedAt: ts,
      activeQuestion: 'MVP scope question',
      queues: { ready: ['W1'], running: [], blocked: [], done: [] },
    },
  });

  const result = runTaskState(root, ['transition', id, '--reopen', '--status', 'blocked', '--note', 'accidental close', '--apply', '--json']);
  const payload = jsonResult(result);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.ok, true);

  const state = JSON.parse(readRel(root, `Harness/tasks/${id}/STATE.json`));
  assert.equal(state.status, 'blocked');
  assert.equal(state.closedAt, null);
  assert.equal(state.mode, 'wf-max');
  assert.equal(state.activeQuestion, 'MVP scope question');
  assert.deepEqual(state.queues.ready, ['W1']);
  assert.ok(state.lastRecovery);
  assert.equal(state.lastRecovery.reason, 'accidental close');
  assert.match(state.lastRecovery.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('ordinary transition without --reopen still refuses to reopen a closed WF-managed task', () => {
  const root = generateProject();
  const id = 'task-wf-reopen-refused';
  const ts = '2026-01-06T00:00:00.000Z';
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id, goal: 'Refused reopen', phase: 'Closeout', closed: '2026-01-06' },
  ]));
  writeTask(root, id, {
    phase: 'Closeout',
    state: { taskId: id, mode: 'wf', status: 'closed', phase: 'closeout', closedAt: ts, updatedAt: ts },
  });

  const result = runTaskState(root, ['transition', id, '--status', 'active', '--phase', 'implement', '--apply', '--json']);
  assert.notEqual(result.status, 0);
  const payload = jsonResult(result);
  assert.equal(payload.ok, false);
  assert.ok(payload.errors.some(e => /closed WF-managed task cannot be reopened|cannot be reopened/i.test(e)), `errors: ${JSON.stringify(payload.errors)}`);

  const state = JSON.parse(readRel(root, `Harness/tasks/${id}/STATE.json`));
  assert.equal(state.status, 'closed');
  assert.equal(state.lastRecovery, undefined);
});

test('--reopen without --note is rejected', () => {
  const root = generateProject();
  const id = 'task-wf-reopen-noreason';
  const ts = '2026-01-07T00:00:00.000Z';
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id, goal: 'No reason', phase: 'Closeout', closed: '2026-01-07' },
  ]));
  writeTask(root, id, {
    phase: 'Closeout',
    state: { taskId: id, mode: 'wf-max', status: 'closed', phase: 'closeout', closedAt: ts, updatedAt: ts },
  });

  const result = runTaskState(root, ['transition', id, '--reopen', '--status', 'active', '--apply', '--json']);
  assert.notEqual(result.status, 0);
  const payload = jsonResult(result);
  assert.equal(payload.ok, false);
  assert.ok(payload.errors.some(e => /--reopen requires.*--note|non-empty.*note|requires a non-empty --note/i.test(e)), `errors: ${JSON.stringify(payload.errors)}`);

  const state = JSON.parse(readRel(root, `Harness/tasks/${id}/STATE.json`));
  assert.equal(state.status, 'closed');
});

test('--reopen rejects stale closure where closedAt !== updatedAt', () => {
  const root = generateProject();
  const id = 'task-wf-reopen-stale';
  writeRel(root, 'Harness/PROGRESS.md', progress(null, [
    { id, goal: 'Stale closure', phase: 'Closeout', closed: '2026-01-08' },
  ]));
  writeTask(root, id, {
    phase: 'Closeout',
    state: {
      taskId: id, mode: 'wf-max', status: 'closed', phase: 'closeout',
      closedAt: '2026-01-08T00:00:00.000Z',
      updatedAt: '2026-01-10T00:00:00.000Z',
    },
  });

  const result = runTaskState(root, ['transition', id, '--reopen', '--status', 'active', '--note', 'reason text', '--apply', '--json']);
  assert.notEqual(result.status, 0);
  const payload = jsonResult(result);
  assert.equal(payload.ok, false);
  assert.ok(payload.errors.some(e => /closedAt.*updatedAt|stale|new task capsule/i.test(e)), `errors: ${JSON.stringify(payload.errors)}`);

  const state = JSON.parse(readRel(root, `Harness/tasks/${id}/STATE.json`));
  assert.equal(state.status, 'closed');
});

test('--reopen rejects archived tasks', () => {
  const root = generateProject();
  const id = 'task-wf-reopen-archived';
  const archiveDir = path.join(root, 'Harness', 'tasks', '_archive', '2026', '01', '01', id);
  fs.mkdirSync(archiveDir, { recursive: true });
  const ts = '2026-01-09T00:00:00.000Z';
  writeRel(root, 'Harness/tasks/_archive/2026/01/01/' + id + '/STATE.json', JSON.stringify({
    schemaVersion: 1,
    taskId: id,
    status: 'archived',
    mode: 'wf-max',
    phase: 'archived',
    closedAt: ts,
    updatedAt: ts,
  }, null, 2) + '\n');

  const result = runTaskState(root, ['transition', id, '--reopen', '--status', 'active', '--note', 'reason text', '--apply', '--json']);
  assert.notEqual(result.status, 0);
  const payload = jsonResult(result);
  assert.equal(payload.ok, false);
  assert.ok(payload.errors.some(e => /archived|terminal|history/i.test(e)), `errors: ${JSON.stringify(payload.errors)}`);
});
