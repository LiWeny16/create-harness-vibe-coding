import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

test('AC-001: command surface distinguishes Agent controllers from CLI-backed adapters', () => {
  const registry = readJson('Harness/specs/runtime/command-surface.json');
  const byId = new Map(registry.commands.map((command) => [command.id, command]));

  assert.equal(byId.get('wf').execution, 'skill-controller');
  assert.equal(byId.get('wf-max').execution, 'skill-controller');
  assert.equal(byId.get('wf-search').execution, 'cli-backed');
  assert.equal(byId.get('wf-ui').execution, 'cli-backed');
  assert.equal(byId.get('wf-extension').execution, 'cli-backed');
  assert.equal(byId.has('wf-research'), false);
});

test('AC-002: wf-ui is an optional package extension, not a builtin runtime', () => {
  const registry = readJson('Harness/extensions/registry.json');
  const byId = new Map(registry.extensions.map((extension) => [extension.id, extension]));
  const ui = byId.get('wf-ui');

  assert.ok(ui);
  assert.equal(ui.kind, 'package');
  assert.equal(ui.defaultInstall, false);
  assert.equal(ui.package.scope, '@zingspark');
  assert.ok(ui.package.name);

  // Package manifest must declare a bin entry, a server dependency, and the
  // files to distribute. The real files must exist on disk so the extension
  // is actually installable and runnable.
  const pkg = readJson('extensions/wf-ui/package.json');
  assert.equal(pkg.name, ui.package.name);
  assert.ok(pkg.name.startsWith(`${ui.package.scope}/`));
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.bin, 'wf-ui package must declare bin');
  assert.equal(pkg.bin['wf-ui'], 'bin/wf-ui.js');
  assert.ok(pkg.dependencies, 'wf-ui package must declare dependencies');
  assert.ok(pkg.dependencies['create-harness-vibe-coding'], 'depends on create-harness-vibe-coding');
  assert.equal(pkg.harnessExtension?.id, 'wf-ui');
  assert.equal(pkg.harnessExtension?.defaultInstall, false);
  assert.ok(
    Array.isArray(pkg.files) && pkg.files.length > 0,
    'files array must enumerate distributed files',
  );

  // Real distribution contract: every distributed file must exist on disk.
  const pkgRoot = path.join(root, 'extensions', 'wf-ui');
  for (const entry of pkg.files) {
    const abs = path.join(pkgRoot, entry);
    assert.ok(fs.existsSync(abs), `distributed file exists: ${entry}`);
  }
  const binEntry = path.join(pkgRoot, pkg.bin['wf-ui']);
  assert.ok(fs.existsSync(binEntry), 'bin entry exists on disk');
  const runnerEntry = path.join(pkgRoot, 'bin', 'wf-ui-runner.mjs');
  assert.ok(fs.existsSync(runnerEntry), 'runner entry exists on disk');
});

test('AC-003: base wf-search adapter does not load the removed wf-research skill', () => {
  const skill = read('.claude/skills/wf-search/SKILL.md');
  const command = read('.claude/commands/wf-search.md');

  assert.ok(skill.length < 4000, 'wf-search skill should remain a thin adapter');
  assert.doesNotMatch(skill, /wf-research\/?SKILL|load.*wf-research/i);
  assert.doesNotMatch(command, /wf-research.*controller|wf-research.*skill/i);
  assert.match(skill, /pnpm exec wf search/);
});

test('AC-004: Rust core and pnpm platform launcher contracts exist', () => {
  const cargo = read('crates/wf-cli/Cargo.toml');
  const packageJson = readJson('packages/wf-cli/package.json');
  const launcher = read('packages/wf-cli/bin/wf.js');

  assert.match(cargo, /name\s*=\s*"wf-cli"/);
  assert.equal(packageJson.bin.wf, 'bin/wf.js');
  assert.ok(packageJson.optionalDependencies);
  assert.match(launcher, /WF_CLI_BINARY|optionalDependencies|platform/i);
});

test('AC-005: optional search capabilities are represented by extension packages', () => {
  const registry = readJson('Harness/extensions/registry.json');
  const ids = new Set(registry.extensions.map((extension) => extension.id));

  for (const id of ['wf-search-media', 'wf-search-asr', 'wf-search-vlm', 'wf-search-deep']) {
    assert.equal(ids.has(id), true, `missing extension ${id}`);
  }
});

test('AC-006: CLI-backed commands prompt before installing the missing wf runtime', () => {
  const adapters = [
    '.claude/commands',
    '.opencode/commands',
    'templates/common/.claude/commands',
    'templates/common/.opencode/commands',
  ];
  const shims = [
    '.agents/skills',
    '.claude/skills',
    'templates/common/.claude/skills',
  ];
  for (const surface of [...adapters, ...shims]) {
    const commandSurface = surface.includes('/commands');
    for (const id of ['wf-search', 'wf-extension', 'wf-ui']) {
      const commandPath = commandSurface ? `${surface}/${id}.md` : `${surface}/${id}/SKILL.md`;
      const command = read(commandPath);
      assert.match(command, /pnpm exec wf --help/, `${commandPath} checks the CLI first`);
      assert.match(command, /pnpm add --save-dev @zingspark\/wf-cli@0\.1\.0/, `${commandPath} gives the install command`);
      assert.match(command, /explicit approval/i, `${commandPath} waits for user approval`);
    }
  }
});
