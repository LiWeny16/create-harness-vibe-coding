import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateProject,
  makeProjectWorkspace,
  readProjectManifest,
  runProjectCli,
  runTaskCli,
  successfulJson,
} from './support/project-management.js';
import { readJsonFile, writeProjectRecord } from '../templates/common/Harness/scripts/lib/project-store.mjs';

const workspaces = [];
after(() => workspaces.forEach(root => fs.rmSync(root, { recursive: true, force: true })));

function makeProject(name = 'alpha') {
  const workspace = makeProjectWorkspace('project-state-');
  workspaces.push(workspace);
  return generateProject(workspace, name, name);
}

function writePlanRecord(root, record) {
  const index = JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'project', 'plan', 'INDEX.json'), 'utf8'));
  const recordsRoot = path.join(root, 'Harness', 'project', 'plan', index.recordsRoot);
  const shard = createHash('sha256').update(record.id).digest('hex').slice(0, 2);
  const directory = path.join(recordsRoot, shard);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${record.id}.json`);
  fs.writeFileSync(file, JSON.stringify(record));
  return file;
}

test('AC-001 generated projects receive a versioned, lightweight Project entry and domain routes', () => {
  const root = makeProject();
  const manifestPath = path.join(root, 'Harness', 'project', 'PROJECT.json');
  assert.ok(fs.existsSync(manifestPath), 'the generated scaffold must include PROJECT.json');

  const manifest = readProjectManifest(root);
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.equal(manifest.name, 'alpha');
  assert.equal(manifest.status, 'active');
  assert.equal(manifest.stage, 'discovery');
  assert.ok(Buffer.byteLength(fs.readFileSync(manifestPath)) <= 4096);
  assert.equal(Object.hasOwn(manifest, 'tasks'), false);
  for (const rel of Object.values(manifest.domains)) {
    assert.equal(path.isAbsolute(rel), false);
    assert.ok(fs.existsSync(path.join(root, 'Harness', 'project', rel)), `missing routed domain index ${rel}`);
  }
});

test('AC-002 Task state updates are reflected in a generated Project summary without duplicating Task fields', () => {
  const root = makeProject();
  const manifest = readProjectManifest(root);
  const created = runTaskCli(root, [
    'record', 'task-project-rollup-check', '--create', '--status', 'blocked', '--text', 'Wait for the API contract', '--apply', '--json',
  ]);
  successfulJson(created, 'Task creation should succeed');

  const summary = successfulJson(runProjectCli(root, ['summary', manifest.id, '--json']));
  assert.equal(summary.generated, true);
  assert.equal(summary.projectId, manifest.id);
  assert.equal(summary.taskRollup.statusCounts.blocked, 1);
  assert.equal(summary.taskRollup.statusCounts.active, 0);
  assert.equal(JSON.stringify(manifest).includes('Wait for the API contract'), false);
  assert.equal(Object.hasOwn(manifest, 'taskRollup'), false);
});

test('AC-002/AC-003 summary handles Task INDEX larger than 8 KiB with bounded correct counts', () => {
  const root = makeProject();
  const manifest = readProjectManifest(root);
  const indexPath = path.join(root, 'Harness', 'tasks', 'INDEX.json');
  const tasks = Array.from({ length: 1800 }, (_, i) => ({
    id: `task-large-${String(i).padStart(4, '0')}`,
    status: i % 3 === 0 ? 'blocked' : 'active',
    title: `Padding ${'x'.repeat(40)}`,
  }));
  fs.writeFileSync(indexPath, `${JSON.stringify({ schemaVersion: 1, tasks }, null, 2)}\n`);
  assert.ok(fs.statSync(indexPath).size > 8192);
  const summary = successfulJson(runProjectCli(root, ['summary', manifest.id, '--json']));
  assert.equal(summary.taskRollup.statusCounts.blocked, 600);
  assert.equal(summary.taskRollup.statusCounts.active, 1200);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) <= 8192);
});

test('AC-003/AC-006 Project record writes reject invalid date-time fields', () => {
  const root = makeProject();
  assert.throws(() => writeProjectRecord({
    projectRoot: root,
    section: 'plan',
    record: { id: 'invalid-date', kind: 'milestone', title: 'Invalid date', content: '', createdAt: '2026-01-01T12:34:56' },
  }), error => error.code === 'INVALID_RECORD');
});

test('AC-003/AC-006 Project record writes reject unsupported fields and schema versions', () => {
  const root = makeProject();
  const record = { id: 'bad-schema-version', kind: 'milestone', title: 'Bad schema version', content: '', createdAt: '2026-01-01T00:00:00Z' };
  assert.throws(() => writeProjectRecord({ projectRoot: root, section: 'plan', record: { ...record, schemaVersion: 2 } }), error => error.code === 'INVALID_RECORD');
  assert.throws(() => writeProjectRecord({ projectRoot: root, section: 'plan', record: { ...record, id: 'extra-record-field', unexpected: true } }), error => error.code === 'INVALID_RECORD');
});

test('AC-003 capped JSON reads stop at the byte limit without a whole-file read', () => {
  const root = makeProject();
  const oversizedPath = path.join(root, 'oversized-capped.json');
  fs.writeFileSync(oversizedPath, 'x'.repeat(8193));
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function rejectWholeFileRead(file, ...args) {
    if (path.resolve(String(file)) === oversizedPath) {
      const error = new Error('whole-file read bypassed the configured byte cap');
      error.code = 'UNBOUNDED_READ';
      throw error;
    }
    return readFileSync.call(fs, file, ...args);
  };
  try {
    assert.throws(() => readJsonFile(oversizedPath, 8192), error => error.code === 'BUDGET_EXCEEDED');
  } finally {
    fs.readFileSync = readFileSync;
  }
});

test('AC-003/AC-006 Project record writes enforce final serialized-byte limit', () => {
  const root = makeProject();
  assert.throws(() => writeProjectRecord({
    projectRoot: root,
    section: 'plan',
    record: { id: 'oversized-write', kind: 'milestone', title: 'Large source', content: '', createdAt: '2026-01-01T00:00:00Z', source: { url: 'x'.repeat(9000) } },
  }), error => ['INVALID_RECORD', 'BUDGET_EXCEEDED'].includes(error.code));
});

test('AC-003/AC-006 Project record reads reject invalid schema fields', () => {
  const root = makeProject();
  const manifest = readProjectManifest(root);
  const badRecordPath = writePlanRecord(root, {
    schemaVersion: 1, id: 'invalid-read', section: 'plan', kind: 'milestone', title: 'Invalid date', content: '', createdAt: 'not-a-date', surprise: true,
  });
  const invalidRead = runProjectCli(root, ['section', manifest.id, '--section', 'plan', '--json']);
  fs.rmSync(badRecordPath, { force: true });
  assert.notEqual(invalidRead.status, 0);
});

test('AC-003/AC-006 Project record reads reject serialized records over 8 KiB', () => {
  const root = makeProject();
  const manifest = readProjectManifest(root);
  const oversizedRecordPath = writePlanRecord(root, {
    schemaVersion: 1, id: 'oversized-read', section: 'plan', kind: 'milestone', title: 'Large source', content: '', createdAt: '2026-01-01T00:00:00Z', source: { url: 'x'.repeat(9000) },
  });
  const oversizedRead = runProjectCli(root, ['section', manifest.id, '--section', 'plan', '--json']);
  fs.rmSync(oversizedRecordPath, { force: true });
  assert.notEqual(oversizedRead.status, 0);
});

test('AC-005/AC-006 local Project list hides archived entries by default and supports bounded pages', () => {
  const root = makeProject();
  const manifest = readProjectManifest(root);
  successfulJson(runProjectCli(root, ['archive', manifest.id, '--apply', '--json']));
  const defaultList = successfulJson(runProjectCli(root, ['list', '--json']));
  assert.equal(defaultList.projects.some(project => project.id === manifest.id), false);
  const archivedList = successfulJson(runProjectCli(root, ['list', '--include-archived', '--limit', '1', '--json']));
  assert.equal(archivedList.projects.length, 1);
  assert.ok(archivedList.bytes > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(archivedList)) <= 8192);
  const afterCursor = successfulJson(runProjectCli(root, ['list', '--include-archived', '--cursor', manifest.id, '--json']));
  assert.equal(afterCursor.projects.length, 0);
});

test('AC-005 Project archive and restore alter routing/lifecycle but never move the project root', () => {
  const workspace = makeProjectWorkspace('project-archive-');
  workspaces.push(workspace);
  const root = generateProject(workspace, 'archive-target', 'Archive Target');
  const manifest = readProjectManifest(root);
  successfulJson(runProjectCli(root, [
    'register', '--workspace', workspace, '--project-root', root, '--apply', '--json',
  ]));

  successfulJson(runProjectCli(root, ['archive', manifest.id, '--workspace', workspace, '--apply', '--json']));
  assert.equal(fs.existsSync(root), true);
  assert.equal(fs.existsSync(path.join(root, 'Harness', 'project', 'PROJECT.json')), true);
  assert.equal(readProjectManifest(root).status, 'archived');
  const activeList = successfulJson(runProjectCli(root, ['list', '--workspace', workspace, '--json']));
  assert.equal(activeList.projects.some(project => project.id === manifest.id), false);
  const archiveList = successfulJson(runProjectCli(root, ['list', '--workspace', workspace, '--include-archived', '--json']));
  assert.equal(archiveList.projects.some(project => project.id === manifest.id), true);

  successfulJson(runProjectCli(root, ['restore', manifest.id, '--workspace', workspace, '--apply', '--json']));
  assert.equal(readProjectManifest(root).status, 'active');
  assert.equal(fs.existsSync(root), true);
});

test('AC-006 generated Project validator accepts valid state and rejects an invalid stage', () => {
  const root = makeProject();
  const validator = path.join(root, 'Harness', 'scripts', 'validate-harness.mjs');
  for (const relative of [
    'Harness/PROGRESS.md',
    'Harness/research/PRD.md',
    'Harness/research/research-results.md',
    'Harness/project/architecture.md',
  ]) {
    const file = path.join(root, relative);
    if (fs.existsSync(file)) {
      const resolved = fs.readFileSync(file, 'utf8').replaceAll('{{', 'resolved').replaceAll('}}', '');
      fs.writeFileSync(file, resolved);
    }
  }
  const valid = spawnSync(process.execPath, [validator, '--strict'], { cwd: root, encoding: 'utf8' });
  assert.equal(valid.status, 0, `valid generated Project should pass validation: ${valid.stdout}\n${valid.stderr}`);

  const manifestPath = path.join(root, 'Harness', 'project', 'PROJECT.json');
  const manifest = readProjectManifest(root);
  manifest.stage = 'verified';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = runProjectCli(root, ['validate', '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /stage|schema|invalid/i);
  const invalid = spawnSync(process.execPath, [validator, '--strict'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stdout + invalid.stderr, /Project validation|stage|schema|invalid/i);
});
