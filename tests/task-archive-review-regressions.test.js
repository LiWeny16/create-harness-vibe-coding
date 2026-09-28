import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  makeCapsuleProject,
  cleanupCapsuleFixtures,
  writeTaskFile,
  writeTaskState,
} from './fixtures/capsule-routing/lib/fixture.js';

const scriptVariants = [
  { name: 'source', directory: path.resolve('Harness', 'scripts') },
  { name: 'template', directory: path.resolve('templates', 'common', 'Harness', 'scripts') },
];

after(() => cleanupCapsuleFixtures());

function installScripts(root, sourceDirectory) {
  const target = path.join(root, 'Harness', 'scripts');
  fs.mkdirSync(path.join(target, 'lib'), { recursive: true });
  for (const relative of ['task-state.mjs', 'auto-archive-session-start.mjs', path.join('lib', 'task-route.mjs')]) {
    fs.copyFileSync(path.join(sourceDirectory, relative), path.join(target, relative));
  }
}

function runScript(root, entry, args = [], env = {}) {
  const result = spawnSync(process.execPath, [path.join(root, 'Harness', 'scripts', entry), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: 'pipe',
  });
  return { status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function runSessionStart(root, env = {}) {
  return new Promise((resolve, reject) => {
    const result = spawn(process.execPath, [path.join(root, 'Harness', 'scripts', 'auto-archive-session-start.mjs')], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    result.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    result.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    result.once('error', reject);
    result.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function isolatedSessionEnv(root, safeAutoArchive) {
  const temp = path.join(root, '.session-start-temp');
  fs.mkdirSync(temp, { recursive: true });
  return { HARNESS_SAFE_AUTO_ARCHIVE: safeAutoArchive, TMP: temp, TEMP: temp, TMPDIR: temp };
}

function makeEligible(root, taskId, extraState = {}) {
  return writeTaskState(root, taskId, {
    status: 'closed',
    phase: 'closeout',
    closedAt: '2026-01-02T00:00:00.000Z',
    ...extraState,
  });
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

function snapshotRouteIndexes(root) {
  const paths = [
    path.join(root, 'Harness', 'PROGRESS.md'),
    path.join(root, 'Harness', 'tasks', 'INDEX.md'),
    path.join(root, 'Harness', 'tasks', 'INDEX.json'),
    path.join(root, 'Harness', 'tasks', '_archive', 'INDEX.md'),
    path.join(root, 'Harness', 'tasks', '_archive', 'INDEX.json'),
  ];
  return paths.map(file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
}

function snapshotTree(target) {
  if (!fs.existsSync(target)) return { kind: 'missing' };
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return { kind: 'symlink', target: fs.readlinkSync(target) };
  if (stat.isDirectory()) {
    return {
      kind: 'directory',
      entries: Object.fromEntries(fs.readdirSync(target).sort().map(name => [name, snapshotTree(path.join(target, name))])),
    };
  }
  if (stat.isFile()) return { kind: 'file', bytes: fs.readFileSync(target).toString('base64') };
  return { kind: 'other', mode: stat.mode };
}

for (const variant of scriptVariants) {
  test(`AC-008 [${variant.name}] route output stays under 8KB with large resume fields and keeps its summary`, () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const taskId = `task-large-route-${variant.name}`;
    const summary = 'Useful compact summary: preserve the two required acceptance gates.';
    const hugeNext = `NEXT_ACTION_SENTINEL ${'n'.repeat(12000)}`;
    const hugeQuestion = `ACTIVE_QUESTION_SENTINEL ${'q'.repeat(12000)}`;
    const hugeQueueItems = Array.from({ length: 40 }, (_, index) => `queue-${index}-${'w'.repeat(300)}`);
    writeTaskState(root, taskId, {
      status: 'blocked',
      phase: 'implement',
      summary,
      nextAction: hugeNext,
      activeQuestion: hugeQuestion,
      queues: { ready: hugeQueueItems, running: hugeQueueItems, blocked: hugeQueueItems, done: [] },
    });
    writeTaskFile(root, taskId, 'PROGRESS.md', `# ${taskId} - PROGRESS\n\n## Status\n\n- Phase: Implement\n- Goal: ${summary}\n- Next: ${hugeNext}\n- Blocker: ${hugeQuestion}\n`);
    writeTaskFile(root, taskId, 'PLAN.md', `# Plan\n\n## Goal\n\n${summary}\n`);

    const result = runScript(root, 'task-state.mjs', ['route', '--task', taskId, '--json']);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const bytes = Buffer.byteLength(result.stdout, 'utf8');
    assert.ok(bytes <= 8 * 1024, `route output is ${bytes} bytes; it must remain <=8KB`);
    const route = JSON.parse(result.stdout).route;
    assert.equal(route.id, taskId);
    assert.equal(route.status, 'blocked');
    assert.ok(String(route.summary).includes('Useful compact summary'), 'bounded route must retain a useful task summary');
    assert.ok(!result.stdout.includes('NEXT_ACTION_SENTINEL') || result.stdout.length < hugeNext.length, 'large nextAction must be bounded');
    assert.ok(!result.stdout.includes('ACTIVE_QUESTION_SENTINEL') || result.stdout.length < hugeQuestion.length, 'large activeQuestion must be bounded');
  });

  test(`AC-Stop [${variant.name}] --stop exits cleanly and remains a dry-run`, async () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const taskId = `task-stop-dry-run-${variant.name}`;
    makeEligible(root, taskId);
    const result = runScript(root, 'auto-archive-session-start.mjs', ['--stop'], isolatedSessionEnv(root, '1'));
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, output);
    assert.doesNotMatch(output, /ReferenceError.*locked|locked is not defined/i);
    assert.match(output, /dry[\s-]?run/i, 'Stop must report that it performed a dry-run');
    assert.ok(fs.existsSync(path.join(root, 'Harness', 'tasks', taskId)), 'Stop must leave eligible tasks live');
    assert.equal(archivedTaskPaths(root, taskId).length, 0, 'Stop must not create an archive route');
  });

  test(`AC-SessionStart [${variant.name}] a completed apply releases the global lock before exit`, async () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const env = isolatedSessionEnv(root, '1');
    const lockFile = path.join(root, 'Harness', '.archive-lock', 'auto-archive.lock');
    const firstId = `task-lock-release-first-${variant.name}`;
    makeEligible(root, firstId);

    const first = await runSessionStart(root, env);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.doesNotMatch(`${first.stdout}\n${first.stderr}`, /another session is auto-archiving/i);
    assert.equal(archivedTaskPaths(root, firstId).length, 1, 'first SessionStart should apply the archive');
    assert.equal(fs.existsSync(lockFile), false, 'successful SessionStart must remove its lock before the process exits');

    const secondId = `task-lock-release-second-${variant.name}`;
    makeEligible(root, secondId);
    const second = await runSessionStart(root, env);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.doesNotMatch(`${second.stdout}\n${second.stderr}`, /another session is auto-archiving/i, 'a completed process must release the global lock');
    assert.equal(archivedTaskPaths(root, secondId).length, 1, 'the next process should acquire the released lock and apply');
  });

  test(`AC-Revision [${variant.name}] routeRevision changes when live route state changes`, async () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const env = isolatedSessionEnv(root, '0');
    const taskId = 'task-active-alpha';
    const liveIndexPath = path.join(root, 'Harness', 'tasks', 'INDEX.json');

    const first = await runSessionStart(root, env);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const firstIndex = JSON.parse(fs.readFileSync(liveIndexPath, 'utf8'));
    assert.equal(typeof firstIndex.routeRevision, 'string');
    assert.ok(firstIndex.routeRevision.length > 0, 'reindexed live routes need a routeRevision');

    writeTaskState(root, taskId, {
      updatedAt: '2026-02-03T04:05:06.000Z',
      nextAction: 'Recheck the updated route and its new next step.',
    });
    const second = await runSessionStart(root, env);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const secondIndex = JSON.parse(fs.readFileSync(liveIndexPath, 'utf8'));
    assert.notEqual(secondIndex.routeRevision, firstIndex.routeRevision, 'routeRevision must reflect updatedAt and route-relevant task data');
  });

  test(`AC-012 [${variant.name}] a live lock owner cannot be displaced by an old timestamp`, async () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const taskId = `task-live-lock-owner-${variant.name}`;
    makeEligible(root, taskId);
    const lockFile = path.join(root, 'Harness', '.archive-lock', 'auto-archive.lock');
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    const priorLock = JSON.stringify({
      pid: process.pid,
      startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      token: `owner-${variant.name}`,
    });
    fs.writeFileSync(lockFile, priorLock, 'utf8');

    const result = await runSessionStart(root, isolatedSessionEnv(root, '1'));
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, output);
    assert.match(output, /another session is auto-archiving; skipping/i, 'a still-live lock owner must keep the lock regardless of its timestamp');
    assert.equal(fs.readFileSync(lockFile, 'utf8'), priorLock, 'the live owner lock must remain untouched');
    assert.ok(fs.existsSync(path.join(root, 'Harness', 'tasks', taskId)), 'a competing SessionStart must not archive through a live owner lock');
    assert.equal(archivedTaskPaths(root, taskId).length, 0);
    // This test covers live-owner stale-time handling. It does not directly
    // race an old owner's finally block against a replacement lock token.
  });

  test(`AC-016 [${variant.name}] live state changes keep live and archive revisions aligned`, async () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const env = isolatedSessionEnv(root, '0');
    const taskId = 'task-active-alpha';
    const liveIndexPath = path.join(root, 'Harness', 'tasks', 'INDEX.json');
    const archiveIndexPath = path.join(root, 'Harness', 'tasks', '_archive', 'INDEX.json');

    const archive = runScript(root, 'task-state.mjs', ['auto-archive', '--apply', '--json']);
    assert.equal(archive.status, 0, archive.stderr || archive.stdout);
    const beforeLive = JSON.parse(fs.readFileSync(liveIndexPath, 'utf8'));
    const beforeArchive = JSON.parse(fs.readFileSync(archiveIndexPath, 'utf8'));
    assert.equal(beforeLive.routeRevision, beforeArchive.routeRevision, 'archive setup should establish a shared revision');

    writeTaskState(root, taskId, {
      updatedAt: '2026-03-04T05:06:07.000Z',
      nextAction: 'Changed route-relevant state after an archive already exists.',
    });
    const reindex = await runSessionStart(root, env);
    assert.equal(reindex.status, 0, reindex.stderr || reindex.stdout);
    const afterLive = JSON.parse(fs.readFileSync(liveIndexPath, 'utf8'));
    const afterArchive = JSON.parse(fs.readFileSync(archiveIndexPath, 'utf8'));

    assert.notEqual(afterLive.routeRevision, beforeLive.routeRevision, 'the updated live STATE.json must advance the revision');
    assert.equal(afterArchive.routeRevision, afterLive.routeRevision, 'SessionStart/index must refresh both route revisions together');
  });

  test(`AC-016 [${variant.name}] changing the root active task advances routeRevision`, async () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const env = isolatedSessionEnv(root, '0');
    const liveIndexPath = path.join(root, 'Harness', 'tasks', 'INDEX.json');
    writeTaskState(root, 'task-active-beta', {
      status: 'active',
      phase: 'plan',
      nextAction: 'Continue the second active task.',
    });

    const first = await runSessionStart(root, env);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const before = JSON.parse(fs.readFileSync(liveIndexPath, 'utf8'));
    assert.equal(before.activeTask, 'task-active-alpha');

    const progressPath = path.join(root, 'Harness', 'PROGRESS.md');
    const progress = fs.readFileSync(progressPath, 'utf8');
    const changedProgress = progress.replace('## Active Task\n\n- task-active-alpha', '## Active Task\n\n- task-active-beta');
    assert.notEqual(changedProgress, progress, 'fixture should contain the original active task pointer');
    fs.writeFileSync(progressPath, changedProgress, 'utf8');

    const second = await runSessionStart(root, env);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const after = JSON.parse(fs.readFileSync(liveIndexPath, 'utf8'));
    assert.equal(after.activeTask, 'task-active-beta', 'the root active task change must reach INDEX.json');
    assert.notEqual(after.routeRevision, before.routeRevision, 'routeRevision must cover root active-task routing data');
  });

  test(`AC-016 [${variant.name}] changing archived STATE advances and aligns both route revisions`, async () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const env = isolatedSessionEnv(root, '0');
    const taskId = 'task-closed-charlie';
    const liveIndexPath = path.join(root, 'Harness', 'tasks', 'INDEX.json');
    const archiveIndexPath = path.join(root, 'Harness', 'tasks', '_archive', 'INDEX.json');

    const archive = runScript(root, 'task-state.mjs', ['auto-archive', '--apply', '--json']);
    assert.equal(archive.status, 0, archive.stderr || archive.stdout);
    const archivedPath = archivedTaskPaths(root, taskId)[0];
    assert.ok(archivedPath, 'fixture task must be archived before mutating its state');
    const beforeLive = JSON.parse(fs.readFileSync(liveIndexPath, 'utf8'));
    const beforeArchive = JSON.parse(fs.readFileSync(archiveIndexPath, 'utf8'));
    assert.equal(beforeLive.routeRevision, beforeArchive.routeRevision);

    const statePath = path.join(archivedPath, 'STATE.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.updatedAt = '2026-04-05T06:07:08.000Z';
    state.nextAction = 'Archived task state changed after initial closeout.';
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

    const reindex = await runSessionStart(root, env);
    assert.equal(reindex.status, 0, reindex.stderr || reindex.stdout);
    const afterLive = JSON.parse(fs.readFileSync(liveIndexPath, 'utf8'));
    const afterArchive = JSON.parse(fs.readFileSync(archiveIndexPath, 'utf8'));
    assert.notEqual(afterLive.routeRevision, beforeLive.routeRevision, 'an archived STATE change must advance the route revision');
    assert.equal(afterArchive.routeRevision, afterLive.routeRevision, 'reindex must keep live and archive revisions aligned');
  });

  test(`AC-016 [${variant.name}] changing a non-active root index row advances routeRevision`, async () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const env = isolatedSessionEnv(root, '0');
    const liveIndexPath = path.join(root, 'Harness', 'tasks', 'INDEX.json');
    const archiveIndexPath = path.join(root, 'Harness', 'tasks', '_archive', 'INDEX.json');

    const archive = runScript(root, 'task-state.mjs', ['auto-archive', '--apply', '--json']);
    assert.equal(archive.status, 0, archive.stderr || archive.stdout);
    const beforeLive = JSON.parse(fs.readFileSync(liveIndexPath, 'utf8'));
    const beforeArchive = JSON.parse(fs.readFileSync(archiveIndexPath, 'utf8'));
    assert.equal(beforeLive.routeRevision, beforeArchive.routeRevision);

    const progressPath = path.join(root, 'Harness', 'PROGRESS.md');
    const progress = fs.readFileSync(progressPath, 'utf8');
    const oldRow = '| task-blocked-bravo | Blocked task for routing | Implementation | - |';
    const newRow = '| task-blocked-bravo | Updated non-active route row | Verify | - |';
    const changedProgress = progress.replace(oldRow, newRow);
    assert.notEqual(changedProgress, progress, 'fixture should contain the non-active task index row');
    fs.writeFileSync(progressPath, changedProgress, 'utf8');

    const reindex = await runSessionStart(root, env);
    assert.equal(reindex.status, 0, reindex.stderr || reindex.stdout);
    const afterLive = JSON.parse(fs.readFileSync(liveIndexPath, 'utf8'));
    const afterArchive = JSON.parse(fs.readFileSync(archiveIndexPath, 'utf8'));
    const task = afterLive.tasks.find(entry => entry.id === 'task-blocked-bravo');
    assert.equal(task?.title, 'Updated non-active route row', 'reindex must include the changed root row');
    assert.notEqual(afterLive.routeRevision, beforeLive.routeRevision, 'a non-active root index row change must advance the route revision');
    assert.equal(afterArchive.routeRevision, afterLive.routeRevision, 'reindex must keep live and archive revisions aligned');
  });

  test(`AC-008 [${variant.name}] not-found route output stays under 8KB for a long legal task id`, () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const taskId = `task-${'a'.repeat(8300)}-missing`;

    const result = runScript(root, 'task-state.mjs', ['route', '--task', taskId, '--json']);

    assert.notEqual(result.status, 0, 'a missing task must remain a not-found result');
    const size = Buffer.byteLength(result.stdout, 'utf8');
    assert.ok(size <= 8 * 1024, `not-found route JSON is ${size} bytes; it must remain <=8KB`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors || []), /not found/i, 'the bounded error should still explain the lookup result');
  });

  test(`AC-008 [${variant.name}] invalid traversal route output stays under 8KB for a long task id`, () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const taskId = `task-${'a'.repeat(8300)}/../x`;

    const result = runScript(root, 'task-state.mjs', ['route', '--task', taskId, '--json']);

    assert.notEqual(result.status, 0, 'a traversal ID must remain an invalid lookup result');
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors || payload), /not found|invalid|unsafe|task.?id/i,
      'the bounded error should explain that the supplied route ID is invalid or unavailable');
    const size = Buffer.byteLength(result.stdout, 'utf8');
    assert.ok(size <= 8 * 1024, `invalid route JSON is ${size} bytes; it must remain <=8KB`);
  });

  for (const lockCase of [
    { label: 'missing PID', fields: {} },
    { label: 'invalid PID', fields: { pid: 'not-a-process-id' } },
  ]) {
    test(`AC-012 [${variant.name}] stale lock with ${lockCase.label} is retained`, async () => {
      const root = makeCapsuleProject();
      installScripts(root, variant.directory);
      const taskId = `task-stale-lock-${variant.name}-${lockCase.label === 'missing PID' ? 'missing' : 'invalid'}`;
      makeEligible(root, taskId);
      const lockFile = path.join(root, 'Harness', '.archive-lock', 'auto-archive.lock');
      fs.mkdirSync(path.dirname(lockFile), { recursive: true });
      const priorLock = JSON.stringify({
        ...lockCase.fields,
        startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        token: `unverifiable-owner-${variant.name}`,
      });
      fs.writeFileSync(lockFile, priorLock, 'utf8');

      const result = await runSessionStart(root, isolatedSessionEnv(root, '1'));
      const output = `${result.stdout}\n${result.stderr}`;

      assert.equal(result.status, 0, output);
      assert.match(output, /another session is auto-archiving; skipping/i, 'age alone cannot prove a lock owner is dead');
      assert.equal(fs.readFileSync(lockFile, 'utf8'), priorLock, 'an unverifiable lock must remain unchanged');
      assert.ok(fs.existsSync(path.join(root, 'Harness', 'tasks', taskId)), 'an unverifiable lock must veto archive apply');
      assert.equal(archivedTaskPaths(root, taskId).length, 0);
    });
  }

  test(`AC-013 [${variant.name}] archive junction outside tasks is rejected without changing capsule or indexes`, t => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const taskId = `task-junction-escape-${variant.name}`;
    const taskPath = makeEligible(root, taskId);
    const beforeCapsule = snapshotTree(taskPath);
    const beforeIndexes = snapshotRouteIndexes(root);
    const outside = path.join(root, 'outside-archive-target');
    fs.mkdirSync(outside, { recursive: true });

    // Route the task's mtime-based archive month through a Windows junction
    // that points outside Harness/tasks. The fixture uses a future month that
    // is absent from the normal archive tree.
    const future = new Date('2099-06-15T12:00:00.000Z');
    fs.utimesSync(taskPath, future, future);
    const monthJunction = path.join(root, 'Harness', 'tasks', '_archive', '2099', '06');
    fs.mkdirSync(path.dirname(monthJunction), { recursive: true });
    try {
      fs.symlinkSync(outside, monthJunction, 'junction');
    } catch (error) {
      t.skip(`this host cannot create a directory junction: ${error.code || error.message}`);
      return;
    }

    const result = runScript(root, 'task-state.mjs', ['auto-archive', '--task', taskId, '--apply', '--json']);
    const payload = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();
    const item = payload?.results?.find(entry => entry.taskId === taskId);
    const outsideTaskPath = path.join(outside, '15', taskId);

    assert.ok(result.status !== 0 || payload?.ok === false || item?.action !== 'archived', `an external junction destination must be rejected; stdout=${result.stdout}; stderr=${result.stderr}`);
    assert.ok(fs.existsSync(taskPath), 'the original capsule must remain live');
    assert.deepEqual(snapshotTree(taskPath), beforeCapsule, 'the entire live capsule must remain unchanged');
    assert.deepEqual(snapshotRouteIndexes(root), beforeIndexes, 'all route indexes must remain byte-for-byte unchanged');
    assert.equal(fs.existsSync(outsideTaskPath), false, 'the capsule must not be moved through the junction');
  });

  test(`AC-010 [${variant.name}] closed closeout task with ready work is not archived`, () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const taskId = `task-closeout-ready-${variant.name}`;
    makeEligible(root, taskId, {
      queues: {
        ready: [{ id: `${taskId}-unfinished`, title: 'Unresolved queued work' }],
        running: [],
        blocked: [],
        done: [],
      },
    });

    const result = runScript(root, 'task-state.mjs', ['auto-archive', '--task', taskId, '--apply', '--json']);
    const payload = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();
    const item = payload?.results?.find(entry => entry.taskId === taskId);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(item, 'the task should receive a safe-auto eligibility result');
    assert.notEqual(item.action, 'archived', 'ready queue work means closeout is not complete');
    assert.ok(fs.existsSync(path.join(root, 'Harness', 'tasks', taskId)), 'unresolved ready work must remain live');
    assert.equal(archivedTaskPaths(root, taskId).length, 0);
  });

  test(`AC-011 [${variant.name}] a closed closeout task remains live when it is the root focus`, () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const taskId = `task-closed-focus-${variant.name}`;
    makeEligible(root, taskId, {
      queues: { ready: [], running: [], blocked: [], done: [] },
      activeQuestion: null,
      owner: null,
      lease: null,
      lock: null,
    });
    const progressPath = path.join(root, 'Harness', 'PROGRESS.md');
    const progress = fs.readFileSync(progressPath, 'utf8');
    const focusedProgress = progress.replace('## Active Task\n\n- task-active-alpha', `## Active Task\n\n- ${taskId}`);
    assert.notEqual(focusedProgress, progress, 'fixture should contain an explicit root focus pointer');
    fs.writeFileSync(progressPath, focusedProgress, 'utf8');

    const result = runScript(root, 'task-state.mjs', ['auto-archive', '--task', taskId, '--apply', '--json']);
    const payload = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();
    const item = payload?.results?.find(entry => entry.taskId === taskId);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(item, 'the focused task should receive a safe-auto eligibility result');
    assert.notEqual(item.action, 'archived', 'the current root focus must veto archival even when closed and verified');
    assert.match(String(item.reason || item.status), /focus|active task/i, 'the focus marker alone should explain the veto');
    assert.ok(fs.existsSync(path.join(root, 'Harness', 'tasks', taskId)), 'the focused task must remain live');
    assert.equal(archivedTaskPaths(root, taskId).length, 0);
  });

  test(`AC-010 [${variant.name}] context.handoff.unresolved work vetoes closeout archive`, () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const taskId = `task-handoff-unresolved-${variant.name}`;
    makeEligible(root, taskId, {
      context: { handoff: { unresolved: ['handoff item'] } },
    });

    const result = runScript(root, 'task-state.mjs', ['auto-archive', '--task', taskId, '--apply', '--json']);
    const payload = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();
    const item = payload?.results?.find(entry => entry.taskId === taskId);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(item, 'the task should receive a safe-auto eligibility result');
    assert.notEqual(item.action, 'archived', 'an unresolved handoff item means closeout is incomplete');
    assert.ok(fs.existsSync(path.join(root, 'Harness', 'tasks', taskId)), 'unresolved handoff work must remain live');
    assert.equal(archivedTaskPaths(root, taskId).length, 0);
  });

  for (const status of ['open', 'investigating', 'blocked']) {
    test(`AC-010 [${variant.name}] PROBLEM Active row with status=${status} vetoes closeout archive`, () => {
      const root = makeCapsuleProject();
      installScripts(root, variant.directory);
      const taskId = `task-problem-active-${status}-${variant.name}`;
      makeEligible(root, taskId);
      writeTaskFile(root, taskId, 'PROBLEM.md', `# PROBLEM\n\n## Active\n\n| Problem | Status |\n|---|---|\n| unresolved closeout issue | ${status} |\n\n## Resolved\n\n| Problem | Status |\n|---|---|\n| earlier resolved issue | resolved |\n`);

      const result = runScript(root, 'task-state.mjs', ['auto-archive', '--task', taskId, '--apply', '--json']);
      const payload = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();
      const item = payload?.results?.find(entry => entry.taskId === taskId);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.ok(item, 'the task should receive a safe-auto eligibility result');
      assert.notEqual(item.action, 'archived', `a nonempty Active problem with status=${status} means closeout is incomplete`);
      assert.ok(fs.existsSync(path.join(root, 'Harness', 'tasks', taskId)), 'an active problem must remain live');
      assert.equal(archivedTaskPaths(root, taskId).length, 0);
    });
  }

  test(`AC-010 [${variant.name}] PROBLEM Resolved-only row remains eligible for closeout archive`, () => {
    const root = makeCapsuleProject();
    installScripts(root, variant.directory);
    const taskId = `task-problem-resolved-${variant.name}`;
    makeEligible(root, taskId);
    writeTaskFile(root, taskId, 'PROBLEM.md', `# PROBLEM\n\n## Active\n\n| Problem | Status |\n|---|---|\n\n## Resolved\n\n| Problem | Status |\n|---|---|\n| earlier resolved issue | resolved |\n`);

    const result = runScript(root, 'task-state.mjs', ['auto-archive', '--task', taskId, '--apply', '--json']);
    const payload = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();
    const item = payload?.results?.find(entry => entry.taskId === taskId);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(item, 'the task should receive a safe-auto eligibility result');
    assert.equal(item.action, 'archived', 'resolved history alone must not veto archival');
    assert.equal(fs.existsSync(path.join(root, 'Harness', 'tasks', taskId)), false, 'eligible task should leave the live route');
    assert.equal(archivedTaskPaths(root, taskId).length, 1, 'resolved-only task should have one archive route');
  });
}
