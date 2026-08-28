import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { renderGroupsMd, scanTaskGroups } from '../../../Harness/scripts/task-group-index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const TASK_STATE = path.join(ROOT, 'Harness', 'scripts', 'task-state.mjs');
const TASK_GROUP_INDEX = path.join(ROOT, 'Harness', 'scripts', 'task-group-index.mjs');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const tempRoots = [];

function makeProject() {
  const root = makeHarnessTempRoot('task-group-tag-');
  tempRoots.push(root);
  const project = path.join(root, 'app');
  fs.mkdirSync(path.join(project, 'Harness', 'tasks'), { recursive: true });
  return project;
}

after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function runTaskState(project, args) {
  return spawnSync(process.execPath, [TASK_STATE, ...args], { cwd: project, encoding: 'utf8' });
}

function jsonResult(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr, '', result.stderr);
  return JSON.parse(result.stdout);
}

function readState(project, taskId) {
  const file = path.join(project, 'Harness', 'tasks', taskId, 'STATE.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeFixtureState(tasksRoot, taskId, state) {
  const dir = path.join(tasksRoot, taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'STATE.json'), JSON.stringify(state, null, 2) + '\n');
}

function archivedTaskExists(project, taskId) {
  const archiveRoot = path.join(project, 'Harness', 'tasks', '_archive');
  if (!fs.existsSync(archiveRoot)) return false;
  for (const year of fs.readdirSync(archiveRoot, { withFileTypes: true })) {
    if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
    for (const month of fs.readdirSync(path.join(archiveRoot, year.name), { withFileTypes: true })) {
      if (!month.isDirectory()) continue;
      for (const day of fs.readdirSync(path.join(archiveRoot, year.name, month.name), { withFileTypes: true })) {
        if (!day.isDirectory()) continue;
        if (fs.existsSync(path.join(archiveRoot, year.name, month.name, day.name, taskId))) return true;
      }
    }
  }
  return false;
}

test('G1: record --group writes the tag; missing group renders as default at list time', () => {
  const project = makeProject();

  // create with --group
  let result = runTaskState(project, [
    'record', 'task-group-alpha', '--create', '--group', 'release-0819-formal',
    '--text', 'alpha task', '--apply', '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readState(project, 'task-group-alpha').group, 'release-0819-formal');

  // update branch: re-tag the same task
  result = runTaskState(project, ['record', 'task-group-alpha', '--group', 'migration', '--apply', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readState(project, 'task-group-alpha').group, 'migration');

  // no group -> 'default' at list time (no data migration)
  result = runTaskState(project, ['record', 'task-group-beta', '--create', '--text', 'beta task', '--apply', '--json']);
  assert.equal(result.status, 0, result.stderr);

  const payload = jsonResult(runTaskState(project, ['list', '--json']));
  const alpha = payload.tasks.find(task => task.id === 'task-group-alpha');
  const beta = payload.tasks.find(task => task.id === 'task-group-beta');
  assert.equal(alpha.group, 'migration');
  assert.equal(beta.group, 'default');
  assert.equal(payload.groupFilter, null);
});

test('G2: list --group filter and --by-group grouping output', () => {
  const project = makeProject();
  const setups = [
    ['task-group-alpha', 'release-0819-formal'],
    ['task-group-beta', 'release-0819-formal'],
    ['task-group-gamma', null],
  ];
  for (const [id, group] of setups) {
    const args = ['record', id, '--create'];
    if (group) args.push('--group', group);
    args.push('--text', id, '--apply', '--json');
    const result = runTaskState(project, args);
    assert.equal(result.status, 0, result.stderr);
  }

  // --group filter
  const filtered = jsonResult(runTaskState(project, ['list', '--group', 'release-0819-formal', '--json']));
  assert.equal(filtered.taskCount, 2);
  assert.equal(filtered.groupFilter, 'release-0819-formal');
  assert.ok(filtered.tasks.every(task => task.group === 'release-0819-formal'));
  assert.deepEqual(filtered.tasks.map(task => task.id).sort(), ['task-group-alpha', 'task-group-beta']);

  // --by-group: non-default groups alphabetical, default last
  const grouped = jsonResult(runTaskState(project, ['list', '--by-group', '--json']));
  assert.equal(grouped.taskCount, 3);
  assert.deepEqual(grouped.groups.map(group => group.group), ['release-0819-formal', 'default']);
  assert.equal(grouped.groups[0].tasks.length, 2);
  assert.equal(grouped.groups[1].tasks.length, 1);
});

test('G3: archive --group archives the whole group as a confirmation-less batch op', () => {
  const project = makeProject();

  // archivable (verified status)
  let result = runTaskState(project, [
    'record', 'task-group-alpha', '--create', '--group', 'release-0819-formal',
    '--status', 'verified', '--text', 'a', '--apply', '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);

  // in the same group but active -> must be skipped, not archived
  result = runTaskState(project, [
    'record', 'task-group-beta', '--create', '--group', 'release-0819-formal',
    '--status', 'active', '--text', 'b', '--apply', '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);

  // different group (default) -> untouched
  result = runTaskState(project, ['record', 'task-group-gamma', '--create', '--text', 'c', '--apply', '--json']);
  assert.equal(result.status, 0, result.stderr);

  // no --apply passed: --group implies apply and reports what it did
  const payload = jsonResult(runTaskState(project, ['archive', '--group', 'release-0819-formal', '--json']));
  assert.equal(payload.ok, true, JSON.stringify(payload));
  assert.equal(payload.dryRun, false);
  assert.equal(payload.group, 'release-0819-formal');
  assert.equal(payload.scanned, 2);
  assert.equal(payload.toArchive, 1);
  assert.equal(payload.skipped, 1);

  assert.ok(!fs.existsSync(path.join(project, 'Harness', 'tasks', 'task-group-alpha')), 'alpha should be archived');
  assert.ok(archivedTaskExists(project, 'task-group-alpha'));
  assert.ok(fs.existsSync(path.join(project, 'Harness', 'tasks', 'task-group-beta')), 'beta stays (active)');
  assert.ok(fs.existsSync(path.join(project, 'Harness', 'tasks', 'task-group-gamma')), 'gamma stays (other group)');
});

test('G4: task-group-index scan + render produce correct sections and stale flags', () => {
  const project = makeProject();
  const tasksRoot = path.join(project, 'Harness', 'tasks');
  const now = new Date('2026-08-13T12:00:00.000Z');

  // fresh active task in a named group
  writeFixtureState(tasksRoot, 'task-group-alpha', {
    schemaVersion: 1, taskId: 'task-group-alpha', status: 'active', phase: 'implement',
    group: 'release-0819-formal', updatedAt: new Date(now.getTime() - HOUR_MS).toISOString(),
  });
  // completed 12 days ago -> needs archive
  writeFixtureState(tasksRoot, 'task-group-beta', {
    schemaVersion: 1, taskId: 'task-group-beta', status: 'verified', phase: 'verified',
    group: 'release-0819-formal', updatedAt: new Date(now.getTime() - (12 * DAY_MS + HOUR_MS)).toISOString(),
  });
  // active with no heartbeat for 8 days
  writeFixtureState(tasksRoot, 'task-group-gamma', {
    schemaVersion: 1, taskId: 'task-group-gamma', status: 'active', phase: 'implement',
    updatedAt: new Date(now.getTime() - (8 * DAY_MS + HOUR_MS)).toISOString(),
  });
  // completed but fresh (2 days) -> not stale at the default threshold
  writeFixtureState(tasksRoot, 'task-group-delta', {
    schemaVersion: 1, taskId: 'task-group-delta', status: 'complete', phase: 'verified',
    group: 'release-0819-formal', updatedAt: new Date(now.getTime() - (2 * DAY_MS + HOUR_MS)).toISOString(),
  });

  const model = scanTaskGroups({ tasksRoot, now });

  // group order: non-default alphabetical, default last
  assert.deepEqual(model.groups.map(group => group.name), ['release-0819-formal', 'default']);
  assert.equal(model.groups[0].tasks.length, 3);
  assert.equal(model.groups[1].tasks.length, 1);

  // stale entries: completed kind first, then active kind, each by id
  assert.deepEqual(model.stale.map(entry => entry.id), ['task-group-beta', 'task-group-gamma']);
  assert.equal(model.stale[0].kind, 'completed');
  assert.equal(model.stale[0].days, 12);
  assert.equal(model.stale[1].kind, 'active');
  assert.equal(model.stale[1].days, 8);

  const md = renderGroupsMd(model);
  assert.match(md, /## release-0819-formal \(3 tasks\)/);
  assert.match(md, /## default \(1 task\)/);
  assert.match(md, /\| `task-group-beta` \| verified \| verified \| 2026-08-01 \|/);
  assert.match(md, /## Needs Archive \(stale\)/);
  assert.match(md, /- task-group-beta: completed 12d ago, not archived/);
  assert.match(md, /- task-group-gamma: no heartbeat 8d \(active\)/);
});

test('G4b: stale thresholds are env-overridable', () => {
  const project = makeProject();
  const tasksRoot = path.join(project, 'Harness', 'tasks');
  const now = new Date('2026-08-13T12:00:00.000Z');

  // completed 2 days ago: below the default 3-day threshold
  writeFixtureState(tasksRoot, 'task-group-epsilon', {
    schemaVersion: 1, taskId: 'task-group-epsilon', status: 'complete', phase: 'verified',
    updatedAt: new Date(now.getTime() - (2 * DAY_MS + HOUR_MS)).toISOString(),
  });

  assert.equal(scanTaskGroups({ tasksRoot, now }).stale.length, 0, 'default 3-day threshold should not flag 2 days');

  const before = process.env.TASK_STALE_COMPLETED_DAYS;
  try {
    process.env.TASK_STALE_COMPLETED_DAYS = '1';
    const model = scanTaskGroups({ tasksRoot, now });
    assert.equal(model.stale.length, 1);
    assert.equal(model.stale[0].id, 'task-group-epsilon');
    assert.equal(model.stale[0].days, 2);
  } finally {
    if (before === undefined) delete process.env.TASK_STALE_COMPLETED_DAYS;
    else process.env.TASK_STALE_COMPLETED_DAYS = before;
  }
});

test('G5: CLI writes GROUPS.md with Needs Archive entries for both stale kinds', () => {
  const project = makeProject();
  const tasksRoot = path.join(project, 'Harness', 'tasks');
  const nowMs = Date.now();

  writeFixtureState(tasksRoot, 'task-group-alpha', {
    schemaVersion: 1, taskId: 'task-group-alpha', status: 'verified', phase: 'verified',
    group: 'release-0819-formal', updatedAt: new Date(nowMs - (12 * DAY_MS + HOUR_MS)).toISOString(),
  });
  writeFixtureState(tasksRoot, 'task-group-beta', {
    schemaVersion: 1, taskId: 'task-group-beta', status: 'active', phase: 'implement',
    updatedAt: new Date(nowMs - (8 * DAY_MS + HOUR_MS)).toISOString(),
  });

  const result = spawnSync(process.execPath, [TASK_GROUP_INDEX, '--project', project], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const md = fs.readFileSync(path.join(tasksRoot, 'GROUPS.md'), 'utf8');
  assert.match(md, /^# Task Groups \(generated\)/);
  assert.match(md, /## release-0819-formal \(1 task\)/);
  assert.match(md, /## default \(1 task\)/);
  assert.match(md, /## Needs Archive \(stale\)/);
  assert.match(md, /- task-group-alpha: completed \d+d ago, not archived/);
  assert.match(md, /- task-group-beta: no heartbeat \d+d \(active\)/);
});
