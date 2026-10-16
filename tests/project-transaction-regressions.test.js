import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  archiveProject,
  listWorkspaceProjects,
  loadProjectManifest,
  registerWorkspaceProject,
  restoreProject,
  unregisterWorkspaceProject,
  updateProject,
  updateProjectCharter,
} from '../templates/common/Harness/scripts/lib/project-store.mjs';
import {
  generateProject,
  makeProjectWorkspace,
} from './support/project-management.js';

const workspaces = [];
after(() => workspaces.forEach(root => fs.rmSync(root, { recursive: true, force: true })));

function makeProject(name) {
  const workspace = makeProjectWorkspace('project-transaction-');
  workspaces.push(workspace);
  return { workspace, root: generateProject(workspace, name, name) };
}

function shard(projectId) {
  return createHash('sha256').update(projectId).digest('hex').slice(0, 2);
}

function routePath(workspace, category, projectId) {
  return path.join(workspace, '.harness-workspace', 'routes', category, shard(projectId), `${projectId}.json`);
}

function assertExactlyOneStatusRoute(workspace, projectRoot) {
  const manifest = loadProjectManifest(projectRoot);
  const active = routePath(workspace, 'active', manifest.id);
  const archived = routePath(workspace, 'archived', manifest.id);
  assert.notEqual(fs.existsSync(active), fs.existsSync(archived), 'exactly one active or archived route must exist');
  assert.equal(fs.existsSync(archived), manifest.status === 'archived', 'the sole route category must agree with Project status');
}

function runProjectCli(root, args) {
  const script = path.join(root, 'Harness', 'scripts', 'project-state.mjs');
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
}

function runImportScript(projectRoot, scriptBody) {
  const storeUrl = pathToFileURL(path.resolve('templates/common/Harness/scripts/lib/project-store.mjs')).href;
  const importUrl = pathToFileURL(path.resolve('templates/common/Harness/scripts/lib/project-import.mjs')).href;
  const script = `
    import fs from 'node:fs';
    import path from 'node:path';
    const store = await import(${JSON.stringify(storeUrl)});
    const importModule = await import(${JSON.stringify(importUrl)});
    ${scriptBody}
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function runCrashScript(projectRoot, scriptBody) {
  const storeUrl = pathToFileURL(path.resolve('templates/common/Harness/scripts/lib/project-store.mjs')).href;
  const script = `
    import fs from 'node:fs';
    import path from 'node:path';
    const store = await import(${JSON.stringify(storeUrl)});
    ${scriptBody}
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
}

test('AC-003 interrupted charter update recovers charter and Project revision together', () => {
  const { root } = makeProject('charter-transaction');
  const manifestFile = path.join(root, 'Harness', 'project', 'PROJECT.json');
  const originalRenameSync = fs.renameSync;
  let injected = false;
  fs.renameSync = function failManifestCommit(from, to, ...args) {
    if (!injected && path.resolve(String(to)) === path.resolve(manifestFile)) {
      injected = true;
      const error = new Error('injected interruption before Project revision commit');
      error.code = 'EIO';
      throw error;
    }
    return originalRenameSync.call(fs, from, to, ...args);
  };
  try {
    try {
      updateProjectCharter({ projectRoot: root, expectedRevision: 1, patch: { goal: 'Ship a coherent Project lifecycle' } });
    } catch {
      // A failed call may be rolled back or completed by recovery; persisted state must remain coherent either way.
    }
  } finally {
    fs.renameSync = originalRenameSync;
  }
  assert.equal(injected, true, 'the test must interrupt the manifest commit boundary');

  const manifest = loadProjectManifest(root);
  const charter = JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'project', 'charter.json'), 'utf8'));
  const rolledBack = manifest.revision === 1 && charter.goal === '';
  const committed = manifest.revision === 2 && charter.goal === 'Ship a coherent Project lifecycle';
  assert.ok(rolledBack || committed, 'charter facts and Project revision must recover as one transaction');
});

test('AC-003 recovery refuses a tampered staged charter payload', () => {
  const { root } = makeProject('tampered-charter-transaction');
  const manifestFile = path.join(root, 'Harness', 'project', 'PROJECT.json');
  const transactionDirectory = path.join(root, 'Harness', 'project', '.transactions');
  const result = runCrashScript(root, `
    const target = ${JSON.stringify(path.resolve(manifestFile))};
    const originalRenameSync = fs.renameSync;
    fs.renameSync = function stopBeforeManifestCommit(from, to, ...args) {
      if (path.resolve(String(to)) === target) process.exit(83);
      return originalRenameSync.call(fs, from, to, ...args);
    };
    store.updateProjectCharter({ projectRoot: ${JSON.stringify(root)}, expectedRevision: 1, patch: { goal: 'Do not trust a modified stage' } });
  `);
  assert.equal(result.status, 83, `child process should stop after preparing the journal: ${result.stderr}`);
  const stagedName = fs.readdirSync(transactionDirectory).find(name => name.endsWith('.charter.new.stage'));
  assert.ok(stagedName, 'the prepared transaction must have a staged charter payload');
  fs.writeFileSync(path.join(transactionDirectory, stagedName), '{"schemaVersion":1,"goal":"tampered","scope":[],"nonGoals":[]}');

  assert.throws(() => loadProjectManifest(root), error => error.code === 'INVALID_TRANSACTION');
  assert.equal(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).revision, 1, 'recovery must not replace Project state from a tampered stage');
});

test('AC-003 archive transition recovers after interruption during the multi-file commit', () => {
  const { workspace, root } = makeProject('archive-crash-recovery');
  registerWorkspaceProject(workspace, root);
  const projectId = loadProjectManifest(root).id;
  const archivedRoute = routePath(workspace, 'archived', projectId);
  const result = runCrashScript(root, `
    const target = ${JSON.stringify(path.resolve(archivedRoute))};
    const originalRenameSync = fs.renameSync;
    fs.renameSync = function stopBeforeRouteCommit(from, to, ...args) {
      if (path.resolve(String(to)) === target) process.exit(81);
      return originalRenameSync.call(fs, from, to, ...args);
    };
    store.archiveProject({ projectId: ${JSON.stringify(projectId)}, projectRoot: ${JSON.stringify(root)}, workspaceRoot: ${JSON.stringify(workspace)}, expectedRevision: 1 });
  `);
  assert.equal(result.status, 81, `child process should stop at the injected crash point: ${result.stderr}`);

  listWorkspaceProjects(workspace, { includeArchived: true });
  assertExactlyOneStatusRoute(workspace, root);
});

test('AC-003 restore recovers a source-route unlink failure without duplicate routes', () => {
  const { workspace, root } = makeProject('restore-unlink-recovery');
  registerWorkspaceProject(workspace, root);
  const projectId = loadProjectManifest(root).id;
  archiveProject({ projectId, projectRoot: root, workspaceRoot: workspace, expectedRevision: 1 });
  const archivedRoute = routePath(workspace, 'archived', projectId);
  const originalRmSync = fs.rmSync;
  const originalRenameSync = fs.renameSync;
  const originalUnlinkSync = fs.unlinkSync;
  let injected = false;
  const failSourceRemoval = () => {
    if (injected) return false;
    injected = true;
    const error = new Error('injected route unlink failure');
    error.code = 'EIO';
    throw error;
  };
  fs.rmSync = function failArchivedRouteRemoval(target, ...args) {
    if (path.resolve(String(target)) === path.resolve(archivedRoute)) failSourceRemoval();
    return originalRmSync.call(fs, target, ...args);
  };
  fs.renameSync = function failArchivedRouteRename(from, to, ...args) {
    if (path.resolve(String(from)) === path.resolve(archivedRoute)) failSourceRemoval();
    return originalRenameSync.call(fs, from, to, ...args);
  };
  fs.unlinkSync = function failArchivedRouteUnlink(target, ...args) {
    if (path.resolve(String(target)) === path.resolve(archivedRoute)) failSourceRemoval();
    return originalUnlinkSync.call(fs, target, ...args);
  };
  try {
    try {
      restoreProject({ projectId, projectRoot: root, workspaceRoot: workspace, expectedRevision: 2 });
    } catch {
      // A later workspace read must finish or roll back the journal idempotently.
    }
  } finally {
    fs.rmSync = originalRmSync;
    fs.renameSync = originalRenameSync;
    fs.unlinkSync = originalUnlinkSync;
  }
  assert.equal(injected, true, 'the test must interrupt the source-route unlink');

  listWorkspaceProjects(workspace, { includeArchived: true });
  assertExactlyOneStatusRoute(workspace, root);
});

test('AC-003 project registration recovery completes a category move exactly once', () => {
  const { workspace, root } = makeProject('register-route-recovery');
  registerWorkspaceProject(workspace, root);
  const archived = updateProject({ projectRoot: root, expectedRevision: 1, patch: { status: 'archived' } }).project;
  const activeRoute = routePath(workspace, 'active', archived.id);
  const archivedRoute = routePath(workspace, 'archived', archived.id);
  const result = runCrashScript(root, `
    const source = ${JSON.stringify(path.resolve(activeRoute))};
    const originalRmSync = fs.rmSync;
    const originalRenameSync = fs.renameSync;
    const originalUnlinkSync = fs.unlinkSync;
    fs.rmSync = function stopBeforeSourceRemoval(target, ...args) {
      if (path.resolve(String(target)) === source) process.exit(82);
      return originalRmSync.call(fs, target, ...args);
    };
    fs.renameSync = function stopBeforeSourceRename(from, to, ...args) {
      if (path.resolve(String(from)) === source) process.exit(82);
      return originalRenameSync.call(fs, from, to, ...args);
    };
    fs.unlinkSync = function stopBeforeSourceUnlink(target, ...args) {
      if (path.resolve(String(target)) === source) process.exit(82);
      return originalUnlinkSync.call(fs, target, ...args);
    };
    store.registerWorkspaceProject(${JSON.stringify(workspace)}, ${JSON.stringify(root)});
  `);
  assert.equal(result.status, 82, `child process should stop at the injected registration crash point: ${result.stderr}`);
  assert.ok(fs.existsSync(archivedRoute), 'the destination route should have been written before the injected crash');

  listWorkspaceProjects(workspace, { includeArchived: true });
  assertExactlyOneStatusRoute(workspace, root);
});

test('AC-005 CLI archive reconciles a workspace route discovered from the Project root', () => {
  const { workspace, root } = makeProject('cli-archive-route-discovery');
  registerWorkspaceProject(workspace, root);
  const manifest = loadProjectManifest(root);

  // No --workspace flag: the CLI must still find the ancestor workspace index
  // and move the route instead of leaving a stale active route behind.
  const archived = runProjectCli(root, ['archive', manifest.id, '--apply', '--json']);
  assert.equal(archived.status, 0, archived.stderr || archived.stdout);
  assert.equal(loadProjectManifest(root).status, 'archived');
  assertExactlyOneStatusRoute(workspace, root);

  const listedArchived = listWorkspaceProjects(workspace, { includeArchived: true });
  assert.ok(listedArchived.projects.some(project => project.id === manifest.id));
  assert.ok(!listWorkspaceProjects(workspace, { includeArchived: false }).projects.some(project => project.id === manifest.id));

  const restored = runProjectCli(root, ['restore', manifest.id, '--apply', '--json']);
  assert.equal(restored.status, 0, restored.stderr || restored.stdout);
  assert.equal(loadProjectManifest(root).status, 'active');
  assertExactlyOneStatusRoute(workspace, root);
});

test('AC-004 a crashed import stays recoverable and rollback restores the before-state', () => {
  const { root } = makeProject('import-crash-recovery');
  const sourcePath = path.join(root, 'MIGRATION.md');
  fs.writeFileSync(sourcePath, [
    '# Plan',
    '',
    '## Milestone alpha',
    '- Delivered alpha',
    '',
    '## Milestone beta',
    '- Delivered beta',
    '',
    '## Milestone gamma',
    '- Delivered gamma',
    '',
  ].join('\n'), 'utf8');

  const fixtureManifest = loadProjectManifest(root);
  const previewRun = runProjectCli(root, ['import', fixtureManifest.id, '--source', 'MIGRATION.md', '--json']);
  assert.equal(previewRun.status, 0, previewRun.stderr || previewRun.stdout);
  const plan = JSON.parse(previewRun.stdout);
  assert.ok(plan.planHash);
  assert.ok(plan.mappings.length >= 2, `the fixture must map at least two records: ${previewRun.stdout}`);

  // Die while writing the second mapped record, after the first output exists.
  const crash = runImportScript(root, `
    const planHash = ${JSON.stringify(plan.planHash)};
    const originalRenameSync = fs.renameSync;
    let writes = 0;
    fs.renameSync = function stopDuringSecondWrite(from, to, ...args) {
      const target = String(to).replaceAll(String.fromCharCode(92), '/');

      if (target.includes('/Harness/project/plan/')) {
        writes += 1;
        if (writes === 2) process.exit(77);
      }
      return originalRenameSync.call(fs, from, to, ...args);
    };
    importModule.applyProjectImport({ projectRoot: ${JSON.stringify(root)}, sources: ['MIGRATION.md'], planHash });
  `);
  assert.equal(crash.status, 77, `child should stop mid-import: ${crash.stderr}`);
  assert.ok(fs.existsSync(sourcePath), 'the import source must be preserved across a crash');

  const transactionId = fs.readdirSync(path.join(root, 'Harness', 'project', 'imports'))[0];
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'project', 'imports', transactionId, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'preparing', 'a crash mid-apply must leave a recoverable preparing transaction');

  const dryRun = runImportScript(root, `
    const result = importModule.rollbackProjectImport({ projectRoot: ${JSON.stringify(root)}, transactionId: ${JSON.stringify(transactionId)} });
    console.log(JSON.stringify(result));
  `);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const dryRunResult = JSON.parse(dryRun.stdout.trim().split('\n').at(-1));
  assert.equal(dryRunResult.canRollback, true, 'a preparing transaction must be rollbackable');
  assert.equal(dryRunResult.recovering, true);

  const applied = runImportScript(root, `
    const result = importModule.rollbackProjectImport({ projectRoot: ${JSON.stringify(root)}, transactionId: ${JSON.stringify(transactionId)}, apply: true });
    console.log(JSON.stringify(result));
  `);
  assert.equal(applied.status, 0, applied.stderr);
  const appliedResult = JSON.parse(applied.stdout.trim().split('\n').at(-1));
  assert.equal(appliedResult.rolledBack, true);

  const planDir = path.join(root, 'Harness', 'project', 'plan', 'milestones');
  const leftover = fs.existsSync(planDir) ? fs.readdirSync(planDir).filter(name => name.endsWith('.json')) : [];
  assert.equal(leftover.length, 0, `rollback must remove the partially imported records: ${leftover.join(', ')}`);
});

test('AC-005 unregister removes every route for the Project, including a stale counterpart', () => {
  const { workspace, root } = makeProject('unregister-both-routes');
  registerWorkspaceProject(workspace, root);
  const manifest = loadProjectManifest(root);
  const activeRoute = routePath(workspace, 'active', manifest.id);
  const archivedRoute = routePath(workspace, 'archived', manifest.id);
  assert.equal(fs.existsSync(activeRoute), true);
  // Simulate a stale counterpart left behind by an interrupted status change.
  fs.mkdirSync(path.dirname(archivedRoute), { recursive: true });
  fs.copyFileSync(activeRoute, archivedRoute);
  assert.equal(fs.existsSync(archivedRoute), true);

  const result = unregisterWorkspaceProject(workspace, manifest.id);
  assert.equal(result.removed, true);
  assert.equal(fs.existsSync(activeRoute), false, 'the active route must be removed');
  assert.equal(fs.existsSync(archivedRoute), false, 'the stale archived route must be removed too');
  assert.throws(
    () => unregisterWorkspaceProject(workspace, manifest.id),
    error => error.code === 'NOT_FOUND',
  );
});

test('AC-004 a failed import whose cleanup did not finish is still rollbackable', () => {
  const { root } = makeProject('import-failed-recovery');
  const sourcePath = path.join(root, 'PLAN.md');
  fs.writeFileSync(sourcePath, [
    '# Plan',
    '',
    '## Recovery milestone one',
    '- Delivered one',
    '',
    '## Recovery milestone two',
    '- Delivered two',
    '',
  ].join('\n'), 'utf8');

  const manifest = loadProjectManifest(root);
  const previewRun = runProjectCli(root, ['import', manifest.id, '--source', 'PLAN.md', '--json']);
  assert.equal(previewRun.status, 0, previewRun.stderr || previewRun.stdout);
  const plan = JSON.parse(previewRun.stdout);
  const applied = runProjectCli(root, ['import', manifest.id, '--source', 'PLAN.md', '--apply', '--plan-hash', plan.planHash, '--json']);
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  const transactionId = JSON.parse(applied.stdout).transactionId;

  const transactionRoot = path.join(root, 'Harness', 'project', 'imports', transactionId);
  const manifestPath = path.join(transactionRoot, 'manifest.json');
  const transaction = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(transaction.status, 'applied');
  // Simulate the documented failure mode: the in-process cleanup could not
  // finish, so the transaction is marked failed while outputs remain.
  transaction.status = 'failed';
  fs.writeFileSync(manifestPath, `${JSON.stringify(transaction, null, 2)}\n`, 'utf8');

  const rollback = runImportScript(root, `
    const result = importModule.rollbackProjectImport({ projectRoot: ${JSON.stringify(root)}, transactionId: ${JSON.stringify(transactionId)}, apply: true });
    console.log(JSON.stringify(result));
  `);
  assert.equal(rollback.status, 0, rollback.stderr || rollback.stdout);
  const rolledBack = JSON.parse(rollback.stdout.trim().split('\n').at(-1));
  assert.equal(rolledBack.rolledBack, true, 'a failed transaction with a complete journal must be recoverable');
  assert.equal(rolledBack.recovering, true);

  const planDir = path.join(root, 'Harness', 'project', 'plan', 'milestones');
  const leftover = fs.existsSync(planDir) ? fs.readdirSync(planDir).filter(name => name.endsWith('.json')) : [];
  assert.equal(leftover.length, 0, `rollback must remove the imported records: ${leftover.join(', ')}`);
});
