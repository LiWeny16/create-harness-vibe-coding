import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readProjectSection } from '../templates/common/Harness/scripts/lib/project-store.mjs';
import {
  generateProject,
  makeProjectWorkspace,
  readProjectManifest,
  registerProject,
  runProjectCli,
  runTaskCli,
  successfulJson,
} from './support/project-management.js';

const workspaces = [];
after(() => workspaces.forEach(root => fs.rmSync(root, { recursive: true, force: true })));

function setupTwoProjects() {
  const workspace = makeProjectWorkspace('project-routing-');
  workspaces.push(workspace);
  const alpha = generateProject(workspace, 'alpha', 'Alpha Project');
  const beta = generateProject(workspace, 'beta', 'Beta Project');
  const alphaManifest = readProjectManifest(alpha);
  const betaManifest = readProjectManifest(beta);
  successfulJson(registerProject(alpha, workspace));
  successfulJson(registerProject(beta, workspace));
  return { workspace, alpha, beta, alphaManifest, betaManifest };
}

function walkFiles(root) {
  const result = [];
  const visit = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      else result.push(abs);
    }
  };
  visit(root);
  return result;
}

test('AC-001 two registered Projects isolate same-ID Tasks through the same CLI', () => {
  const { workspace, alpha, beta, alphaManifest, betaManifest } = setupTwoProjects();
  assert.notEqual(alphaManifest.id, betaManifest.id);
  for (const [root, status] of [[alpha, 'active'], [beta, 'blocked']]) {
    successfulJson(runTaskCli(root, [
      'record', 'task-same-local-id', '--create', '--status', status, '--apply', '--json',
    ]));
  }

  const alphaSummary = successfulJson(runProjectCli(alpha, ['summary', alphaManifest.id, '--workspace', workspace, '--json']));
  const betaSummary = successfulJson(runProjectCli(beta, ['summary', betaManifest.id, '--workspace', workspace, '--json']));
  assert.equal(alphaSummary.taskRollup.statusCounts.active, 1);
  assert.equal(alphaSummary.taskRollup.statusCounts.blocked, 0);
  assert.equal(betaSummary.taskRollup.statusCounts.active, 0);
  assert.equal(betaSummary.taskRollup.statusCounts.blocked, 1);
});

test('AC-003 workspace index and Project route stubs contain routing data only; unrequested files are not read', () => {
  const { workspace, alpha, beta, alphaManifest, betaManifest } = setupTwoProjects();
  const indexPath = path.join(workspace, '.harness-workspace', 'INDEX.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.shardAlgorithm, 'sha256-prefix-2');
  assert.ok(index.activeRoot);
  assert.ok(index.archivedRoot);

  const routeFiles = walkFiles(path.join(workspace, '.harness-workspace', index.activeRoot));
  assert.ok(routeFiles.length >= 2);
  for (const routePath of routeFiles) {
    const route = JSON.parse(fs.readFileSync(routePath, 'utf8'));
    assert.deepEqual(Object.keys(route).sort(), ['entry', 'id', 'root']);
    assert.ok(Buffer.byteLength(fs.readFileSync(routePath)) <= 8192);
    assert.equal(JSON.stringify(route).includes('status'), false);
    assert.equal(JSON.stringify(route).includes('taskRollup'), false);
  }

  const betaManifestPath = path.join(beta, 'Harness', 'project', 'PROJECT.json');
  const heldManifest = `${betaManifestPath}.hold`;
  fs.renameSync(betaManifestPath, heldManifest);
  const progressIndex = path.join(alpha, 'Harness', 'project', 'progress', 'INDEX.json');
  const progressBytes = fs.readFileSync(progressIndex);
  fs.writeFileSync(progressIndex, '{ unrequested malformed history');
  try {
    const route = successfulJson(runProjectCli(alpha, ['show', alphaManifest.id, '--workspace', workspace, '--json']));
    assert.equal(route.project.id, alphaManifest.id);
    const summary = successfulJson(runProjectCli(alpha, ['summary', alphaManifest.id, '--workspace', workspace, '--json']));
    assert.equal(summary.projectId, alphaManifest.id);
    assert.notEqual(betaManifest.id, route.project.id);
  } finally {
    fs.writeFileSync(progressIndex, progressBytes);
    fs.renameSync(heldManifest, betaManifestPath);
  }
});

test('AC-003 route-list pagination remains byte-bounded with a large workspace index', () => {
  const workspace = makeProjectWorkspace('project-route-pages-');
  workspaces.push(workspace);
  const project = generateProject(workspace, 'page-seed', 'Page Seed');
  const indexRoot = path.join(workspace, '.harness-workspace');
  const activeRoot = path.join(indexRoot, 'routes', 'active');
  fs.mkdirSync(activeRoot, { recursive: true });
  fs.writeFileSync(path.join(indexRoot, 'INDEX.json'), `${JSON.stringify({
    schemaVersion: 1,
    routesRoot: 'routes',
    activeRoot: 'routes/active',
    archivedRoot: 'routes/archived',
    shardAlgorithm: 'sha256-prefix-2',
  }, null, 2)}\n`);
  for (let i = 0; i < 105; i += 1) {
    const id = `project-route-${String(i).padStart(3, '0')}`;
    const prefix = createHash('sha256').update(id).digest('hex').slice(0, 2);
    const dir = path.join(activeRoot, prefix);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify({
      id,
      root: `fixture-${i}`,
      entry: 'Harness/project/PROJECT.json',
    })}\n`);
  }

  const first = successfulJson(runProjectCli(project, ['list', '--workspace', workspace, '--limit', '10', '--json']));
  assert.equal(first.projects.length, 10);
  assert.ok(first.nextCursor);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 8192);
  const second = successfulJson(runProjectCli(project, [
    'list', '--workspace', workspace, '--limit', '10', '--cursor', first.nextCursor, '--json',
  ]));
  assert.equal(second.projects.length, 10);
  assert.notEqual(first.projects.at(-1).id, second.projects[0].id);
});

test('AC-003 requested section page does not parse a corrupt unrequested later record', () => {
  const { alpha, alphaManifest } = setupTwoProjects();
  const sectionDir = path.join(alpha, 'Harness', 'project', 'plan');
  const planIndex = JSON.parse(fs.readFileSync(path.join(sectionDir, 'INDEX.json'), 'utf8'));
  const recordsRoot = path.join(sectionDir, planIndex.recordsRoot);
  const writeRecord = (id, record) => {
    const shard = createHash('sha256').update(id).digest('hex').slice(0, 2);
    const directory = path.join(recordsRoot, shard);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify(record));
  };
  writeRecord('page-a', { schemaVersion: 1, id: 'page-a', section: 'plan', kind: 'milestone', title: 'A', content: 'first', createdAt: '2026-01-01T00:00:00Z' });
  const laterShard = createHash('sha256').update('page-z').digest('hex').slice(0, 2);
  const laterDirectory = path.join(recordsRoot, laterShard);
  fs.mkdirSync(laterDirectory, { recursive: true });
  fs.writeFileSync(path.join(laterDirectory, 'page-z.json'), '{ corrupt unrelated record');

  const page = runProjectCli(alpha, ['section', alphaManifest.id, '--section', 'plan', '--limit', '1', '--json']);
  assert.equal(page.status, 0, `${page.stdout}\n${page.stderr}`);
  const body = JSON.parse(page.stdout);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].id, 'page-a');
});

test('AC-003 Progress continuation skips consumed segment bodies and returns an opaque cursor', () => {
  const { alpha, beta, alphaManifest, betaManifest } = setupTwoProjects();
  const progressRoot = path.join(alpha, 'Harness', 'project', 'progress', 'segments');
  const firstPath = path.join(progressRoot, '2026', '01', '0001.jsonl');
  const secondPath = path.join(progressRoot, '2026', '02', '0001.jsonl');
  fs.mkdirSync(path.dirname(firstPath), { recursive: true });
  fs.mkdirSync(path.dirname(secondPath), { recursive: true });
  fs.writeFileSync(firstPath, `${JSON.stringify({ schemaVersion: 1, id: 'progress-01-jan', section: 'progress', kind: 'delivery', title: 'January', content: 'first', createdAt: '2026-01-15T12:00:00Z' })}\n`);
  fs.writeFileSync(secondPath, `${JSON.stringify({ schemaVersion: 1, id: 'progress-02-feb', section: 'progress', kind: 'delivery', title: 'February', content: 'second', createdAt: '2026-02-15T12:00:00Z' })}\n`);

  const firstPage = readProjectSection({ projectId: alphaManifest.id, projectRoot: alpha, section: 'progress', limit: 1 });
  assert.equal(firstPage.items[0].id, 'progress-01-jan');
  assert.ok(firstPage.nextCursor);
  assert.notEqual(firstPage.nextCursor, firstPage.items[0].id);
  const readFileSync = fs.readFileSync;
  const openSync = fs.openSync;
  const rejectPreviousSegment = file => {
    if (path.resolve(String(file)) !== firstPath) return;
    const error = new Error('previous progress segment was read again');
    error.code = 'UNREQUESTED_SEGMENT_READ';
    throw error;
  };
  fs.readFileSync = function patchedReadFileSync(file, ...args) {
    rejectPreviousSegment(file);
    return readFileSync.call(fs, file, ...args);
  };
  fs.openSync = function patchedOpenSync(file, ...args) {
    rejectPreviousSegment(file);
    return openSync.call(fs, file, ...args);
  };
  try {
    const secondPage = readProjectSection({ projectId: alphaManifest.id, projectRoot: alpha, section: 'progress', limit: 1, cursor: firstPage.nextCursor });
    assert.deepEqual(secondPage.items.map(record => record.id), ['progress-02-feb']);
    assert.throws(() => readProjectSection({ projectId: betaManifest.id, projectRoot: beta, section: 'progress', cursor: firstPage.nextCursor }), error => error.code === 'BAD_REQUEST');
    assert.throws(() => readProjectSection({ projectId: alphaManifest.id, projectRoot: alpha, section: 'plan', cursor: firstPage.nextCursor }), error => error.code === 'BAD_REQUEST');
  } finally {
    fs.readFileSync = readFileSync;
    fs.openSync = openSync;
  }
});

test('AC-005/AC-006 explicit workspace validation rejects a route whose root does not match a Project', () => {
  const { workspace, alpha, alphaManifest } = setupTwoProjects();
  const prefix = createHash('sha256').update(alphaManifest.id).digest('hex').slice(0, 2);
  const routePath = path.join(workspace, '.harness-workspace', 'routes', 'active', prefix, `${alphaManifest.id}.json`);
  const route = JSON.parse(fs.readFileSync(routePath, 'utf8'));
  route.root = 'missing-project-root';
  fs.writeFileSync(routePath, `${JSON.stringify(route, null, 2)}\n`);

  const result = runProjectCli(alpha, ['validate', '--root', alpha, '--workspace', workspace, '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /workspace|route|root|project/i);
});

test('AC-005/AC-006 strict validator passes an explicit workspace root to route reconciliation', () => {
  const { workspace, alpha, alphaManifest } = setupTwoProjects();
  const prefix = createHash('sha256').update(alphaManifest.id).digest('hex').slice(0, 2);
  const routePath = path.join(workspace, '.harness-workspace', 'routes', 'active', prefix, `${alphaManifest.id}.json`);
  const route = JSON.parse(fs.readFileSync(routePath, 'utf8'));
  route.root = 'missing-project-root';
  fs.writeFileSync(routePath, `${JSON.stringify(route, null, 2)}\n`);

  for (const relative of [
    'Harness/PROGRESS.md',
    'Harness/research/PRD.md',
    'Harness/research/research-results.md',
    'Harness/project/architecture.md',
  ]) {
    const file = path.join(alpha, relative);
    if (fs.existsSync(file)) {
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('{{', 'resolved').replaceAll('}}', ''));
    }
  }
  const validator = path.join(alpha, 'Harness', 'scripts', 'validate-harness.mjs');
  const result = spawnSync(process.execPath, [validator, '--strict', '--workspace', workspace], { cwd: alpha, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /workspace|route|root|project/i);
});

test('AC-003/AC-006 root and generated workspace route schemas stay identical', () => {
  const rootSchema = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'Harness', 'schemas', 'workspace-index-v1.schema.json')));
  const templateSchema = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'templates', 'common', 'Harness', 'schemas', 'workspace-index-v1.schema.json')));
  assert.deepEqual(rootSchema, templateSchema);
});

test('AC-003 Project entry and default route output respect byte budgets', () => {
  const { workspace, alpha, alphaManifest } = setupTwoProjects();
  const entryPath = path.join(alpha, 'Harness', 'project', 'PROJECT.json');
  assert.ok(Buffer.byteLength(fs.readFileSync(entryPath)) <= 4096);
  const route = successfulJson(runProjectCli(alpha, [
    'show', alphaManifest.id, '--workspace', workspace, '--budget-bytes', '8192', '--json',
  ]));
  assert.ok(route.bytes <= 8192);
  assert.equal(route.truncated, false);
});
