import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeHarnessTempRoot } from './support/temp-root.js';

const ROOT = path.resolve('.');
const SCRIPT = path.join(ROOT, 'Harness', 'scripts', 'extensions.mjs');
const TEMPLATE_SCRIPT = path.join(ROOT, 'templates', 'common', 'Harness', 'scripts', 'extensions.mjs');
const REGISTRY = path.join(ROOT, 'Harness', 'extensions', 'registry.json');
const TEMPLATE_REGISTRY = path.join(ROOT, 'templates', 'common', 'Harness', 'extensions', 'registry.json');
const SKILLS_MANIFEST = path.join(ROOT, 'extensions', 'wf-search-deep', 'skills', 'manifest.json');
const tempRoots = [];

function tempRoot(prefix) {
  const root = makeHarnessTempRoot(`extensions-${prefix}-`);
  tempRoots.push(root);
  return root;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
    env: process.env,
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

test('AC-001 extension manager and registry are shipped in root/template mirrors', () => {
  assert.ok(fs.existsSync(SCRIPT), 'root extension manager should exist');
  assert.ok(fs.existsSync(TEMPLATE_SCRIPT), 'template extension manager should exist');
  assert.equal(
    fs.readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n'),
    fs.readFileSync(TEMPLATE_SCRIPT, 'utf8').replace(/\r\n/g, '\n'),
    'root and template extension managers should stay mirrored',
  );
  assert.ok(fs.existsSync(REGISTRY), 'root extension registry should exist');
  assert.ok(fs.existsSync(TEMPLATE_REGISTRY), 'template extension registry should exist');
  assert.equal(fs.readFileSync(REGISTRY, 'utf8'), fs.readFileSync(TEMPLATE_REGISTRY, 'utf8'));
});

test('AC-004 registry exposes optional pnpm extensions for wf-ui and media research', () => {
  const registry = readJson(REGISTRY);
  assert.equal(registry.schemaVersion, 1);
  const wfSearch = registry.extensions.find(extension => extension.id === 'wf-search-deep');
  const wfUi = registry.extensions.find(extension => extension.id === 'wf-ui');
  assert.ok(wfSearch, 'registry should expose the lazy wf-search deep package');
  assert.equal(wfSearch.kind, 'package');
  assert.equal(wfSearch.defaultInstall, false);
  assert.equal(wfSearch.package.manager, 'pnpm');
  assert.ok(wfUi, 'registry should document wf-ui');
  assert.equal(wfUi.kind, 'package');
  assert.equal(wfUi.defaultInstall, false);
  assert.equal(wfUi.package.name, '@zingspark/wf-extension-ui');
});

test('AC-005 package wf-ui is never installed by the legacy file-payload manager', () => {
  const root = tempRoot('package');
  const result = runCli([
    'ensure', '--id', 'wf-ui', '--project', path.join(root, 'project'),
    '--global-dir', path.join(root, 'global-runtime'), '--registry', REGISTRY, '--json',
  ]);
  assert.notEqual(result.status, 0, 'package extensions must not enter the legacy file installer');
  assert.match(result.stdout + '\\n' + result.stderr, /pnpm package extension.*wf extension install/i);
  assert.equal(fs.existsSync(path.join(root, 'global-runtime', 'Harness', 'extensions', 'wf-ui')), false);
});

test('AC-001 ensure writes payload only under global Harness/extensions and project lock metadata only', () => {
  const root = tempRoot('install');
  const project = path.join(root, 'project');
  const globalDir = path.join(root, 'global-runtime');
  const source = path.join(root, 'source');
  const manifest = JSON.stringify({
    schemaVersion: 1,
    id: 'fixture-extension',
    version: '1.0.0',
    entry: 'payload.json',
    capabilities: ['fixture'],
  }, null, 2) + '\n';
  const payload = JSON.stringify({ ok: true, source: 'fixture' }, null, 2) + '\n';
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'extension.json'), manifest, 'utf8');
  fs.writeFileSync(path.join(source, 'payload.json'), payload, 'utf8');
  const registry = path.join(root, 'registry.json');
  writeJson(registry, {
    schemaVersion: 1,
    extensions: [{
      id: 'fixture-extension',
      version: '1.0.0',
      kind: 'downloaded',
      source: {
        type: 'files',
        directory: source,
        files: [
          { path: 'extension.json', sha256: sha256(manifest) },
          { path: 'payload.json', sha256: sha256(payload) },
        ],
      },
    }],
  });

  const result = runCli([
    'ensure', '--id', 'fixture-extension', '--project', project,
    '--global-dir', globalDir, '--registry', registry, '--json',
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  const expectedPayloadRoot = path.join(globalDir, 'Harness', 'extensions', 'fixture-extension', '1.0.0');
  assert.equal(path.resolve(output.path), path.resolve(expectedPayloadRoot));
  assert.equal(fs.readFileSync(path.join(expectedPayloadRoot, 'payload.json'), 'utf8'), payload);
  assert.ok(fs.existsSync(path.join(project, 'Harness', 'extensions', 'lock.json')));
  const lock = readJson(path.join(project, 'Harness', 'extensions', 'lock.json'));
  assert.equal(lock.extensions['fixture-extension'].version, '1.0.0');
  assert.doesNotMatch(JSON.stringify(lock), new RegExp(globalDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.equal(fs.existsSync(path.join(project, 'Harness', 'extensions', 'fixture-extension')), false);

  const second = runCli([
    'ensure', '--id', 'fixture-extension', '--project', project,
    '--global-dir', globalDir, '--registry', registry, '--json',
  ]);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(JSON.parse(second.stdout).status, 'already-installed');

  const secondProject = path.join(root, 'second-project');
  const third = runCli([
    'ensure', '--id', 'fixture-extension', '--project', secondProject,
    '--global-dir', globalDir, '--registry', registry, '--json',
  ]);
  assert.equal(third.status, 0, third.stderr || third.stdout);
  assert.equal(JSON.parse(third.stdout).status, 'installed');
  assert.equal(path.resolve(JSON.parse(third.stdout).path), path.resolve(expectedPayloadRoot), 'two projects must share one global payload');
  assert.ok(fs.existsSync(path.join(secondProject, 'Harness', 'extensions', 'lock.json')));
});

test('AC-002 hash or traversal failures leave no partial global extension and no project lock', () => {
  const root = tempRoot('reject');
  const project = path.join(root, 'project');
  const globalDir = path.join(root, 'global-runtime');
  const source = path.join(root, 'source');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'extension.json'), JSON.stringify({
    schemaVersion: 1, id: 'bad-extension', version: '1.0.0', entry: 'payload.json',
  }) + '\n', 'utf8');
  fs.writeFileSync(path.join(source, 'payload.json'), '{"ok":true}\n', 'utf8');
  const registry = path.join(root, 'registry.json');
  writeJson(registry, {
    schemaVersion: 1,
    extensions: [{
      id: 'bad-extension', version: '1.0.0', kind: 'downloaded',
      source: { type: 'files', directory: source, files: [
        { path: 'extension.json', sha256: '0'.repeat(64) },
        { path: '../escape.txt', sha256: '0'.repeat(64) },
      ] },
    }],
  });
  const result = runCli([
    'ensure', '--id', 'bad-extension', '--project', project,
    '--global-dir', globalDir, '--registry', registry, '--json',
  ]);
  assert.notEqual(result.status, 0, 'invalid extension should be rejected');
  assert.equal(fs.existsSync(path.join(globalDir, 'Harness', 'extensions', 'bad-extension')), false);
  assert.equal(fs.existsSync(path.join(project, 'Harness', 'extensions', 'lock.json')), false);
});

test('AC-001 update and remove preserve project extension metadata', () => {
  const update = fs.readFileSync(path.join(ROOT, 'Harness', 'scripts', 'wf-update-check.mjs'), 'utf8');
  const remove = fs.readFileSync(path.join(ROOT, 'Harness', 'scripts', 'wf-remove.mjs'), 'utf8');
  assert.ok(update.includes('Harness\\/extensions\\/'), 'updater must preserve extension metadata');
  assert.ok(remove.includes('Harness\\/extensions\\/'), 'remover must preserve extension metadata');
});

test('AC-003 wf-search and wf-ui docs describe the native CLI extension contract', () => {
  const search = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'wf-search', 'SKILL.md'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'wf-ui', 'SKILL.md'), 'utf8');
  assert.match(search, /pnpm exec wf search/);
  assert.match(search, /optional CLI extensions/i);
  assert.match(ui, /optional extension/i);
  assert.match(ui, /pnpm exec wf ui/);
  assert.doesNotMatch(ui, /built-in/i);
});

test('AC-004 wf-search-deep skill bundle has loadable entries and a runnable video VLM pass', () => {
  const manifest = readJson(SKILLS_MANIFEST);
  assert.equal(manifest.loading.scope, 'global');
  assert.equal(manifest.loading.defaultInstall, false);
  for (const skill of manifest.skills) {
    assert.ok(skill.entry, `${skill.id} should expose a SKILL.md entry`);
    assert.ok(fs.existsSync(path.join(ROOT, 'extensions', 'wf-search-deep', 'skills', skill.entry)), `${skill.id} entry should exist`);
    if (skill.runtime) assert.ok(fs.existsSync(path.join(ROOT, 'extensions', 'wf-search-deep', 'skills', skill.runtime)), `${skill.id} runtime should exist`);
  }
  const runner = path.join(ROOT, 'extensions', 'wf-search-deep', 'skills', 'video-vlm', 'run.mjs');
  const result = spawnSync(process.execPath, [runner, '--help'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /global video pass/i);
  assert.match(result.stdout, /WF_SEARCH_VLM_API_KEY/);
});


