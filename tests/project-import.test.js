import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateProject,
  makeProjectWorkspace,
  readProjectManifest,
  runProjectCli,
  snapshotTree,
  successfulJson,
} from './support/project-management.js';
import { previewProjectImport } from '../templates/common/Harness/scripts/lib/project-import.mjs';

const workspaces = [];
after(() => workspaces.forEach(root => fs.rmSync(root, { recursive: true, force: true })));

function makeProject() {
  const workspace = makeProjectWorkspace('project-import-');
  workspaces.push(workspace);
  const root = generateProject(workspace, 'import-target', 'Import Target');
  return { workspace, root, manifest: readProjectManifest(root) };
}

test('AC-004 explicit-source dry-run is write-free and reports all mappings, duplicates, conflicts and unclassified status', () => {
  const { root, manifest } = makeProject();
  const sourceDir = path.join(root, 'legacy-management');
  fs.mkdirSync(sourceDir);
  const progress = path.join(sourceDir, 'Progress.md');
  const plan = path.join(sourceDir, 'Plan.md');
  const problem = path.join(sourceDir, 'Problem.md');
  fs.writeFileSync(progress, '# Progress\n- Delivered alpha\n- Delivered alpha\n');
  fs.writeFileSync(plan, '# Plan\n## Prepare beta\n- status: maybe\n- Confirm owner\n');
  fs.writeFileSync(problem, '# Problem\n## Build dependency\n- status: perhaps-resolved\n- Waiting for an answer\n## Build dependency\n- Different source detail\n');
  const before = snapshotTree(root);

  const preview = successfulJson(runProjectCli(root, [
    'import', manifest.id,
    '--source', path.relative(root, progress),
    '--source', path.relative(root, plan),
    '--source', path.relative(root, problem),
    '--json',
  ]));

  assert.equal(preview.dryRun, true);
  assert.match(preview.planHash, /^[a-f0-9]{64}$/);
  assert.ok(preview.mappings.some(item => item.target === 'progress'));
  assert.ok(preview.mappings.some(item => item.target === 'plan'));
  assert.ok(preview.mappings.some(item => item.target === 'risks'));
  assert.ok(preview.duplicates.length > 0);
  assert.ok(preview.conflicts.length > 0);
  assert.ok(preview.unknownStatuses.length > 0);
  assert.ok(preview.unmapped.length >= 0);
  assert.deepEqual(snapshotTree(root), before, 'dry-run must not create or modify files');
});

test('AC-004 confirmed import preserves original source files and rollback keeps an auditable transaction', () => {
  const { root, manifest } = makeProject();
  const source = path.join(root, 'Plan.md');
  fs.writeFileSync(source, '# Plan\n## Candidate milestone\n- status: not specified\n');
  const sourceBytes = fs.readFileSync(source);
  const preview = successfulJson(runProjectCli(root, [
    'import', manifest.id, '--source', 'Plan.md', '--json',
  ]));
  assert.equal(preview.dryRun, true);

  const applied = successfulJson(runProjectCli(root, [
    'import', manifest.id, '--source', 'Plan.md', '--apply', '--plan-hash', preview.planHash, '--json',
  ]));
  assert.ok(applied.transactionId);
  assert.deepEqual(fs.readFileSync(source), sourceBytes);
  assert.ok(Array.isArray(applied.outputs));
  const importedTaskDirs = fs.readdirSync(path.join(root, 'Harness', 'tasks'))
    .filter(name => name.startsWith('task-') && name !== '_template');
  assert.deepEqual(importedTaskDirs, [], 'Plan items must not silently create or close Tasks');

  const rollback = successfulJson(runProjectCli(root, [
    'rollback', '--transaction', applied.transactionId, '--apply', '--json',
  ]));
  assert.equal(rollback.rolledBack, true);
  assert.deepEqual(fs.readFileSync(source), sourceBytes);
  assert.ok(fs.existsSync(path.join(root, 'Harness', 'project', 'imports', applied.transactionId)));
});

test('AC-004 rollback refuses to overwrite imported output changed after apply', () => {
  const { root, manifest } = makeProject();
  const source = path.join(root, 'Problem.md');
  fs.writeFileSync(source, '# Problem\n## Unknown blocker\n- status: maybe\n- Need review\n');
  const preview = successfulJson(runProjectCli(root, [
    'import', manifest.id, '--source', 'Problem.md', '--json',
  ]));
  const applied = successfulJson(runProjectCli(root, [
    'import', manifest.id, '--source', 'Problem.md', '--apply', '--plan-hash', preview.planHash, '--json',
  ]));
  assert.ok(applied.outputs.length > 0);
  const target = path.join(root, applied.outputs[0].path);
  fs.appendFileSync(target, '\nuser change after import\n');
  const rollback = runProjectCli(root, ['rollback', '--transaction', applied.transactionId, '--apply', '--json']);
  assert.notEqual(rollback.status, 0);
  assert.match(rollback.stdout + rollback.stderr, /changed|conflict|hash/i);
  assert.match(fs.readFileSync(target, 'utf8'), /user change after import/);
  assert.ok(fs.existsSync(source));
});

test('AC-004 rollback validates every existing-output snapshot before changing any output', () => {
  const { root, manifest } = makeProject();
  const progressRoot = path.join(root, 'Harness', 'project', 'progress', 'segments');
  const cases = [
    { name: 'Progress-Jan.md', month: '01', date: '2026-01-15T12:00:00.000Z', title: 'January delivery' },
    { name: 'Progress-Feb.md', month: '02', date: '2026-02-15T12:00:00.000Z', title: 'February delivery' },
  ];
  for (const [index, item] of cases.entries()) {
    const source = path.join(root, item.name);
    fs.writeFileSync(source, `# Progress\n- Delivered ${item.title}\n`);
    const timestamp = new Date(item.date);
    fs.utimesSync(source, timestamp, timestamp);
    const segment = path.join(progressRoot, '2026', item.month, '0001.jsonl');
    fs.mkdirSync(path.dirname(segment), { recursive: true });
    fs.writeFileSync(segment, `${JSON.stringify({
      schemaVersion: 1, id: `seed-${index}`, section: 'progress', kind: 'delivery', title: `Existing ${item.title}`, content: 'existing progress', createdAt: item.date,
    })}\n`);
  }

  const preview = successfulJson(runProjectCli(root, ['import', manifest.id, '--source', cases[0].name, '--source', cases[1].name, '--json']));
  const applied = successfulJson(runProjectCli(root, ['import', manifest.id, '--source', cases[0].name, '--source', cases[1].name, '--apply', '--plan-hash', preview.planHash, '--json']));
  const outputs = applied.outputs.map(output => ({ path: path.join(root, output.path), bytes: fs.readFileSync(path.join(root, output.path)) }));
  const transactionDir = path.join(root, 'Harness', 'project', 'imports', applied.transactionId);
  const changesDir = path.join(transactionDir, 'changes');
  const changes = fs.readdirSync(changesDir).filter(name => /^\d{4}\.json$/.test(name)).sort()
    .map(name => JSON.parse(fs.readFileSync(path.join(changesDir, name), 'utf8')));
  const snapshots = changes.filter(change => change.beforeExists).map(change => path.join(transactionDir, ...change.beforeSnapshot.split('/')));
  assert.equal(snapshots.length, 2, 'both existing progress segments should be snapshotted');
  fs.writeFileSync(snapshots.at(-1), 'corrupted snapshot');
  const result = runProjectCli(root, ['rollback', '--transaction', applied.transactionId, '--apply', '--json']);
  assert.notEqual(result.status, 0);
  for (const output of outputs) assert.deepEqual(fs.readFileSync(output.path), output.bytes);
});

test('AC-004 preview reports source path/hash/size and transaction persists provenance', () => {
  const { root, manifest } = makeProject();
  const source = path.join(root, 'Plan.md');
  fs.writeFileSync(source, '# Plan\n## Candidate\n');
  const preview = successfulJson(runProjectCli(root, ['import', manifest.id, '--source', 'Plan.md', '--json']));
  assert.ok(preview.sources.some(row => row.path === 'Plan.md' && row.size === fs.statSync(source).size && /^[a-f0-9]{64}$/.test(row.sha256)));
  const applied = successfulJson(runProjectCli(root, ['import', manifest.id, '--source', 'Plan.md', '--apply', '--plan-hash', preview.planHash, '--json']));
  const transaction = JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'project', 'imports', applied.transactionId, 'manifest.json'), 'utf8'));
  assert.ok(transaction.sources.some(row => row.path === 'Plan.md' && row.sha256 === preview.sources.find(item => item.path === 'Plan.md').sha256 && row.size === preview.sources.find(item => item.path === 'Plan.md').size));
});

test('AC-004 importer enforces actual per-file cap when stat size is stale', () => {
  const { root, manifest } = makeProject();
  const oversizedPath = path.join(root, 'oversized.md');
  fs.writeFileSync(oversizedPath, 'x'.repeat(1024 * 1024 + 1));
  const statSync = fs.statSync;
  const readFileSync = fs.readFileSync;
  fs.statSync = function patchedStatSync(file, ...args) {
    const stat = statSync.call(fs, file, ...args);
    if (path.resolve(String(file)) !== oversizedPath) return stat;
    const fakeStat = Object.create(stat);
    Object.defineProperty(fakeStat, 'size', { value: 1 });
    return fakeStat;
  };
  fs.readFileSync = function patchedReadFileSync(file, ...args) {
    if (path.resolve(String(file)) === oversizedPath) {
      const error = new Error('unbounded source read attempted');
      error.code = 'UNBOUNDED_READ';
      throw error;
    }
    return readFileSync.call(fs, file, ...args);
  };
  try {
    assert.throws(() => previewProjectImport({ projectId: manifest.id, projectRoot: root, sources: ['oversized.md'] }), error => error.code === 'BUDGET_EXCEEDED');
  } finally {
    fs.statSync = statSync;
    fs.readFileSync = readFileSync;
  }
});

test('AC-004 importer enforces aggregate source byte limit', () => {
  const { root, manifest } = makeProject();
  const sources = [];
  for (let i = 0; i < 6; i += 1) {
    const name = `aggregate-${i}.md`;
    fs.writeFileSync(path.join(root, name), 'y'.repeat(i < 5 ? 1024 * 1024 : 1));
    sources.push(name);
  }
  const aggregateArgs = ['import', manifest.id, '--json'];
  for (const source of sources) aggregateArgs.push('--source', source);
  const aggregate = runProjectCli(root, aggregateArgs);
  assert.notEqual(aggregate.status, 0);
});

test('AC-004 importer rejects selected sources outside the project root without reading or writing them', () => {
  const { root, manifest } = makeProject();
  const result = runProjectCli(root, [
    'import', manifest.id, '--source', '../outside/Problem.md', '--json',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /outside|escape|root|path/i);
  assert.equal(fs.existsSync(path.join(root, 'Harness', 'project', 'imports')), false);
});
