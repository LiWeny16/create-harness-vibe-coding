import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from './support/temp-root.js';
import { spawnSync } from 'node:child_process';

const tempRoots = [];

function tmpdir() {
  const root = makeHarnessTempRoot('harness-update-runner-');
  tempRoots.push(root);
  return root;
}

after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function writeFile(root, rel, content) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function writeVersion(root, version) {
  writeFile(root, 'Harness/.harness-version', JSON.stringify(version, null, 2) + '\n');
}

function writeStubUpdater(root, label) {
  writeFile(root, 'Harness/scripts/wf-update-check.mjs', `#!/usr/bin/env node
const args = process.argv.slice(2);
console.log(JSON.stringify({
  status: args.includes('--repair') ? 'repair-check' : 'up-to-date',
  label: ${JSON.stringify(label)},
  cwd: process.cwd().replace(/\\\\/g, '/'),
  args
}));
`);
}

function writeOldRemoteStubUpdater(root, label) {
  writeFile(root, 'Harness/scripts/wf-update-check.mjs', `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--repair')) {
  console.log(JSON.stringify({ status: 'downgrade-refused', label: ${JSON.stringify(label)}, args }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: 'up-to-date', version: '0.8.19', remote: '0.8.18', label: ${JSON.stringify(label)}, args }));
}
`);
}

function writeStubSync(root, label) {
  writeFile(root, 'Harness/scripts/sync-host-global.mjs', `#!/usr/bin/env node
console.log(JSON.stringify({
  status: 'ok',
  label: ${JSON.stringify(label)},
  args: process.argv.slice(2)
}));
`);
}

function copyRunner(root) {
  const source = path.resolve('Harness/scripts/wf-update-runner.mjs');
  writeFile(root, 'Harness/scripts/wf-update-runner.mjs', fs.readFileSync(source, 'utf8'));
}

function runRunner(scriptRoot, cwd, env = {}) {
  const result = spawnSync(
    process.execPath,
    [path.join(scriptRoot, 'Harness', 'scripts', 'wf-update-runner.mjs'), '--json'],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  return JSON.parse(result.stdout.trim());
}

test('runner updates project install and discovered global runtime together', () => {
  const root = tmpdir();
  const project = path.join(root, 'project');
  const global = path.join(root, 'global-runtime');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(global, { recursive: true });
  writeVersion(project, { generator: '0.8.18', installScope: 'project' });
  writeVersion(global, { generator: '0.8.18', installScope: 'global', globalDir: global });
  writeStubUpdater(project, 'project');
  writeStubUpdater(global, 'global');
  writeStubSync(global, 'global-sync');
  copyRunner(project);

  const payload = runRunner(project, project, { HARNESS_GLOBAL_HOME: global });

  assert.equal(payload.success, true);
  assert.deepEqual(payload.targets.map(target => target.scope), ['project', 'global']);
  assert.deepEqual(payload.targets.map(target => target.update.json.label), ['project', 'global']);
  assert.ok(payload.targets.find(target => target.scope === 'global').post.some(step => step.step === 'sync-host-global'));
});

test('runner in an uninstalled project updates only the global runtime', () => {
  const root = tmpdir();
  const project = path.join(root, 'plain-project');
  const global = path.join(root, 'global-runtime');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(global, { recursive: true });
  writeVersion(global, { generator: '0.8.18', installScope: 'global', globalDir: global });
  writeStubUpdater(global, 'global');
  writeStubSync(global, 'global-sync');
  copyRunner(global);

  const payload = runRunner(global, project, { HARNESS_GLOBAL_HOME: global });

  assert.equal(payload.success, true);
  assert.deepEqual(payload.targets.map(target => target.scope), ['global']);
  assert.equal(payload.targets[0].update.json.label, 'global');
  assert.equal(fs.existsSync(path.join(project, 'Harness')), false);
});

test('runner does not auto-repair against an older remote version', () => {
  const root = tmpdir();
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  writeVersion(project, { generator: '0.8.19', installScope: 'project' });
  writeOldRemoteStubUpdater(project, 'project');
  copyRunner(project);

  // Isolate discovery: a machine-level global runtime (~/.harness) must not
  // leak into this project-scope scenario.
  const payload = runRunner(project, project, { HARNESS_GLOBAL_HOME: path.join(root, 'no-global') });

  assert.equal(payload.success, true);
  assert.equal(payload.targets.length, 1);
  assert.equal(payload.targets[0].runs.length, 1);
  assert.equal(payload.targets[0].update.json.status, 'up-to-date');
  assert.equal(payload.targets[0].update.json.remote, '0.8.18');
});
