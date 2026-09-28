import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  makeCapsuleProject,
  cleanupCapsuleFixtures,
  writeTaskState,
} from './fixtures/capsule-routing/lib/fixture.js';

const taskStatePath = path.resolve('Harness', 'scripts', 'task-state.mjs');
const sessionStartPath = path.resolve('Harness', 'scripts', 'auto-archive-session-start.mjs');

after(() => cleanupCapsuleFixtures());

function runTaskState(root, ...args) {
  const result = spawnSync(process.execPath, [taskStatePath, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    payload() {
      try { return JSON.parse(this.stdout); } catch { return null; }
    },
  };
}

function runSessionStart(root) {
  return new Promise((resolve, reject) => {
    const isolatedTemp = path.join(root, '.session-start-temp');
    fs.mkdirSync(isolatedTemp, { recursive: true });
    const child = spawn(process.execPath, [sessionStartPath], {
      cwd: root,
      env: {
        ...process.env,
        HARNESS_SAFE_AUTO_ARCHIVE: '1',
        TMP: isolatedTemp,
        TEMP: isolatedTemp,
        TMPDIR: isolatedTemp,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function makeEligible(root, taskId, extraState = {}) {
  return writeTaskState(root, taskId, {
    status: 'closed',
    phase: 'closeout',
    closedAt: '2026-01-02T00:00:00.000Z',
    ...extraState,
  });
}

function installArchiveScripts(root) {
  const source = path.resolve('Harness', 'scripts');
  const target = path.join(root, 'Harness', 'scripts');
  fs.mkdirSync(path.join(target, 'lib'), { recursive: true });
  for (const relative of ['task-state.mjs', 'auto-archive-session-start.mjs', path.join('lib', 'task-route.mjs')]) {
    fs.copyFileSync(path.join(source, relative), path.join(target, relative));
  }
}

function routeIndexSnapshots(root) {
  const relativePaths = [
    ['Harness', 'PROGRESS.md'],
    ['Harness', 'tasks', 'INDEX.md'],
    ['Harness', 'tasks', 'INDEX.json'],
    ['Harness', 'tasks', '_archive', 'INDEX.md'],
    ['Harness', 'tasks', '_archive', 'INDEX.json'],
  ];
  return Object.fromEntries(relativePaths.map(parts => {
    const file = path.join(root, ...parts);
    return [parts.join('/'), snapshotPath(file)];
  }));
}

function snapshotPath(target) {
  if (!fs.existsSync(target)) return { kind: 'missing' };
  const stat = fs.lstatSync(target);
  if (stat.isDirectory()) {
    return {
      kind: 'directory',
      entries: Object.fromEntries(fs.readdirSync(target).sort().map(name => [name, snapshotPath(path.join(target, name))])),
    };
  }
  if (stat.isFile()) return { kind: 'file', bytes: fs.readFileSync(target).toString('base64') };
  return { kind: 'other', mode: stat.mode };
}

function archivedTaskPaths(root, taskId) {
  const archiveRoot = path.join(root, 'Harness', 'tasks', '_archive');
  const matches = [];
  function visit(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name === taskId && fs.existsSync(path.join(child, 'STATE.json'))) matches.push(child);
      else if (entry.isDirectory()) visit(child);
    }
  }
  visit(archiveRoot);
  return matches;
}

function assertReportedFailure(result, taskId) {
  const payload = result.payload();
  const item = payload?.results?.find(entry => entry.taskId === taskId);
  assert.ok(
    result.status !== 0 || payload?.ok === false || item?.status === 'failed' || item?.action === 'failed',
    `archive failure should be reported (status=${result.status}, stdout=${result.stdout}, stderr=${result.stderr})`,
  );
}

test('AC-012 concurrent SessionStart runs never leave duplicate routes for one capsule', async () => {
  const root = makeCapsuleProject();
  const taskIds = Array.from({ length: 8 }, (_, i) => `task-concurrent-${i}`);
  for (const taskId of taskIds) makeEligible(root, taskId);
  installArchiveScripts(root);

  const results = await Promise.all([runSessionStart(root), runSessionStart(root)]);

  assert.ok(results.every(result => result.status === 0), `SessionStart invocations should exit cleanly; results=${JSON.stringify(results)}`);
  const archivedCount = taskIds.reduce((count, taskId) => count + archivedTaskPaths(root, taskId).length, 0);
  assert.ok(archivedCount > 0, `the lock winner must actually archive eligible work; results=${JSON.stringify(results)}`);
  for (const taskId of taskIds) {
    const livePath = path.join(root, 'Harness', 'tasks', taskId);
    const archived = archivedTaskPaths(root, taskId);
    assert.ok(archived.length <= 1, `${taskId} must not be moved to multiple archive routes`);
    assert.notEqual(fs.existsSync(livePath), archived.length === 1, `${taskId} must have exactly one live-or-archived route`);
  }
});

test('AC-013 a failed capsule move preserves the live route and every prior route index', () => {
  const root = makeCapsuleProject();
  const taskId = 'task-closed-charlie';
  const sourceState = path.join(root, 'Harness', 'tasks', taskId, 'STATE.json');
  const beforeState = fs.readFileSync(sourceState, 'utf8');
  const now = new Date();
  const destination = path.join(root, 'Harness', 'tasks', '_archive', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'), taskId);
  fs.mkdirSync(destination, { recursive: true });
  const beforeIndexes = routeIndexSnapshots(root);

  const result = runTaskState(root, 'auto-archive', '--task', taskId, '--apply', '--json');

  assertReportedFailure(result, taskId);
  assert.equal(fs.readFileSync(sourceState, 'utf8'), beforeState, 'failed move must leave source STATE.json untouched');
  const route = runTaskState(root, 'route', '--task', taskId, '--json').payload();
  assert.equal(route?.route?.archived, false, 'failed move must preserve the live route lookup');
  assert.deepEqual(routeIndexSnapshots(root), beforeIndexes, 'failed move must leave all route indexes unchanged');
  assert.equal(archivedTaskPaths(root, taskId).length, 0, 'failed move must not create an archived route');
});

test('AC-013 an archive-index write failure rolls back the move and prior index updates', () => {
  const root = makeCapsuleProject();
  const taskId = 'task-closed-charlie';
  const sourceState = path.join(root, 'Harness', 'tasks', taskId, 'STATE.json');
  const archiveJsonIndex = path.join(root, 'Harness', 'tasks', '_archive', 'INDEX.json');

  // Fault injection contract: replace the archive INDEX.json file with a
  // directory at the exact declared destination. Renaming the refreshed index
  // there must fail. Keep a sentinel so rollback must retain the prior route
  // surface at that path.
  fs.unlinkSync(archiveJsonIndex);
  fs.mkdirSync(archiveJsonIndex);
  fs.writeFileSync(path.join(archiveJsonIndex, 'sentinel.txt'), 'prior state\n', 'utf8');
  const beforeIndexes = routeIndexSnapshots(root);
  const beforeState = fs.readFileSync(sourceState, 'utf8');

  const result = runTaskState(root, 'auto-archive', '--task', taskId, '--apply', '--json');

  assert.equal(fs.existsSync(sourceState), true, 'index failure must restore the original live capsule');
  assert.equal(fs.readFileSync(sourceState, 'utf8'), beforeState, 'index failure must preserve original STATE.json');
  const route = runTaskState(root, 'route', '--task', taskId, '--json').payload();
  assert.equal(route?.route?.archived, false, 'index failure must restore the live route lookup');
  assert.deepEqual(routeIndexSnapshots(root), beforeIndexes, 'index failure must restore every prior route index');
  assert.equal(archivedTaskPaths(root, taskId).length, 0, 'index failure must not leave an archived route');
  assertReportedFailure(result, taskId);
});

test('AC-015/016 successful archive refreshes live indexes and shares a stable routeRevision', () => {
  const root = makeCapsuleProject();
  const taskId = 'task-closed-charlie';
  const archived = runTaskState(root, 'auto-archive', '--task', taskId, '--apply', '--json');
  assert.equal(archived.status, 0, archived.stderr || archived.stdout);
  assert.equal(archived.payload()?.ok, true);

  const progress = fs.readFileSync(path.join(root, 'Harness', 'PROGRESS.md'), 'utf8');
  const liveMarkdown = fs.readFileSync(path.join(root, 'Harness', 'tasks', 'INDEX.md'), 'utf8');
  const liveIndex = JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'tasks', 'INDEX.json'), 'utf8'));
  const archiveIndex = JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'tasks', '_archive', 'INDEX.json'), 'utf8'));
  assert.ok(!progress.includes(taskId), 'root PROGRESS.md must omit the archived task');
  assert.ok(!liveMarkdown.includes(taskId), 'live INDEX.md must omit the archived task');
  assert.ok(!liveIndex.tasks.some(task => task.id === taskId), 'live INDEX.json must omit the archived task');
  assert.ok(archiveIndex.tasks.some(task => task.id === taskId), 'archive INDEX.json must contain the archived task');
  assert.equal(typeof liveIndex.routeRevision, 'string');
  assert.ok(liveIndex.routeRevision.length > 0, 'live index must publish routeRevision');
  assert.equal(archiveIndex.routeRevision, liveIndex.routeRevision, 'live and archive indexes must share routeRevision');

  const revision = liveIndex.routeRevision;
  const repeated = runTaskState(root, 'auto-archive', '--task', taskId, '--apply', '--json');
  assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
  const repeatedLiveIndex = JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'tasks', 'INDEX.json'), 'utf8'));
  const repeatedArchiveIndex = JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'tasks', '_archive', 'INDEX.json'), 'utf8'));
  assert.equal(repeatedLiveIndex.routeRevision, revision, 'same task state must retain its routeRevision');
  assert.equal(repeatedArchiveIndex.routeRevision, revision, 'archive routeRevision must remain aligned after idempotent re-run');
});

test('AC-017 active owner, lease, and lock markers each veto safe auto-archive', () => {
  const root = makeCapsuleProject();
  const markers = [
    ['owner', 'agent-1'],
    ['lease', 'agent-1'],
    ['lock', 'agent-1'],
  ];

  // Marker contract: a non-empty string in STATE.json owner, lease, or lock
  // means a worker currently owns or has reserved the task; any one marker
  // makes the capsule ineligible for automatic archival.
  for (const [marker, value] of markers) {
    const taskId = `task-marker-${marker}`;
    makeEligible(root, taskId, { [marker]: value });
    const result = runTaskState(root, 'auto-archive', '--task', taskId, '--apply', '--json');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const item = result.payload()?.results?.find(entry => entry.taskId === taskId);
    assert.ok(item, `${marker} marker should be reported in task results`);
    assert.notEqual(item.action, 'archived', `${marker} marker must veto archival`);
    assert.ok(fs.existsSync(path.join(root, 'Harness', 'tasks', taskId)), `${marker} marker task must remain live`);
    assert.equal(archivedTaskPaths(root, taskId).length, 0, `${marker} marker task must not acquire an archive route`);
  }
});
