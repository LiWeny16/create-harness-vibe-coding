// AC-001: wf-cli cross-platform release contract.
// The platform matrix must stay consistent across the launcher, the main
// package optionalDependencies, the per-platform packages, the pnpm workspace,
// and the CI release workflow. No publishing happens anywhere in this chain.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const releaseScriptUrl = pathToFileURL(path.join(root, 'scripts', 'wf-cli-release.mjs'));

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function runRelease(args) {
  return spawnSync(process.execPath, ['scripts/wf-cli-release.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
}

test('AC-001: platform matrix has all six supported platforms', async () => {
  const { PLATFORMS } = await import(releaseScriptUrl);

  assert.equal(PLATFORMS.length, 6);
  const keys = new Set(PLATFORMS.map((p) => p.launcher));
  assert.deepEqual(
    [...keys].sort(),
    ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'].sort(),
  );
  for (const p of PLATFORMS) {
    assert.match(p.target, /^[a-z0-9_-]+$/);
    assert.equal(p.dir.startsWith('wf-cli-'), true);
  }
});

test('AC-001: verify reports a consistent matrix', () => {
  const result = runRelease(['verify']);
  assert.equal(result.status, 0, `verify failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /6-platform matrix consistent/);
});

test('AC-001: launcher platform map matches optionalDependencies exactly', async () => {
  const launcher = read('packages/wf-cli/bin/wf.js');
  const main = readJson('packages/wf-cli/package.json');

  const declared = new Map();
  const re = /'(\w+-\w+)':\s*'(@zingspark\/wf-cli-[\w-]+)'/g;
  let m;
  while ((m = re.exec(launcher))) declared.set(m[1], m[2]);

  const optional = Object.entries(main.optionalDependencies);
  assert.equal(declared.size, 6);
  assert.equal(optional.length, 6);

  for (const [platform, fullName] of declared) {
    assert.ok(optional.some(([n]) => n === fullName), `launcher platform ${platform} missing from optionalDependencies`);
  }
  for (const [name] of optional) {
    assert.ok([...declared.values()].includes(name),
      `optionalDependencies ${name} not referenced by launcher`);
  }
});

test('AC-001: one shared version across Cargo, launcher, and platform packages', () => {
  const cargo = read('crates/wf-cli/Cargo.toml');
  const cargoVersion = /version\s*=\s*"([^"]+)"/.exec(cargo)[1];
  const main = readJson('packages/wf-cli/package.json');

  assert.equal(main.version, cargoVersion, 'packages/wf-cli version must match crates/wf-cli');
  for (const [name, version] of Object.entries(main.optionalDependencies)) {
    assert.equal(version, main.version, `${name} must pin the shared version`);
    const meta = readJson(`packages/${name.replace('@zingspark/', '')}/package.json`);
    assert.equal(meta.name, name);
    assert.equal(meta.version, main.version);
  }
});

test('AC-001: platform packages declare correct os/cpu and binary metadata', async () => {
  const { PLATFORMS } = await import(releaseScriptUrl);
  for (const p of PLATFORMS) {
    const meta = readJson(`packages/${p.dir}/package.json`);
    assert.deepEqual(meta.os, [p.os]);
    assert.deepEqual(meta.cpu, [p.cpu]);
    assert.equal(meta.binary, `wf${p.ext}`);
    assert.ok((meta.files || []).includes(`wf${p.ext}`), `${p.dir}: files must include the binary`);
  }
});

test('AC-001: pnpm workspace covers launcher and platform packages', () => {
  const workspace = read('pnpm-workspace.yaml');
  assert.match(workspace, /packages:\s*\n\s*-\s*"packages\/\*"/);
  // packages/* must cover every wf-cli package directory.
  for (const dir of ['wf-cli', 'wf-cli-darwin-arm64', 'wf-cli-darwin-x64', 'wf-cli-linux-arm64-gnu', 'wf-cli-linux-x64-gnu', 'wf-cli-win32-arm64-msvc', 'wf-cli-win32-x64-msvc']) {
    assert.ok(fs.existsSync(path.join(root, 'packages', dir, 'package.json')), `missing packages/${dir}/package.json`);
  }
});

test('AC-001: CI release workflow covers every platform and never publishes', async () => {
  const workflow = read('.github/workflows/wf-cli-release.yml');
  const { PLATFORMS } = await import(releaseScriptUrl);

  for (const p of PLATFORMS) {
    assert.ok(workflow.includes(`platform: ${p.dir}`), `workflow matrix missing ${p.dir}`);
    assert.ok(workflow.includes(p.target), `workflow matrix missing target ${p.target}`);
  }
  assert.match(workflow, /^\s*verify:\s*$/m);
  assert.match(workflow, /^\s*build:\s*$/m);
  assert.match(workflow, /^\s*package:\s*$/m);
  assert.match(workflow, /cargo build --release --target/);
  assert.doesNotMatch(workflow, /npm publish|pnpm publish|npm publish --|publishConfig/,
    'release workflow must not publish');
});

test('AC-001: CI workflow artifact name and upload path do not duplicate wf-cli- prefix', async () => {
  const workflow = read('.github/workflows/wf-cli-release.yml');
  const { PLATFORMS } = await import(releaseScriptUrl);

  // matrix.platform values already carry the wf-cli- prefix, so the workflow
  // template must not add a second wf-cli- prefix to either the artifact name
  // or the upload path. A doubled prefix would point at a non-existent
  // packages/wf-cli-wf-cli-* directory and produce misnamed artifacts.
  assert.doesNotMatch(
    workflow,
    /name:\s*wf-cli-\$\{\{\s*matrix\.platform\s*\}\}/,
    'upload-artifact name must not prepend wf-cli- to matrix.platform',
  );
  assert.doesNotMatch(
    workflow,
    /packages\/wf-cli-\$\{\{\s*matrix\.platform\s*\}\}\/\*\.tgz/,
    'upload-artifact path must not prepend wf-cli- to matrix.platform',
  );

  // The upload step must reference packages/<dir>/*.tgz where <dir> is the
  // matrix.platform value (which itself starts with wf-cli-).
  assert.match(
    workflow,
    /packages\/\$\{\{\s*matrix\.platform\s*\}\}\/\*\.tgz/,
    'upload-artifact path must be packages/${{ matrix.platform }}/*.tgz',
  );

  // Each platform directory referenced by the upload path must exist on disk
  // so the glob can actually match a packed tarball.
  for (const p of PLATFORMS) {
    assert.ok(
      fs.existsSync(path.join(root, 'packages', p.dir, 'package.json')),
      `upload path would miss packages/${p.dir} (no package.json)`,
    );
  }
});

test('AC-001: CI workflow download-artifact uses merge-multiple for flat extraction', () => {
  const workflow = read('.github/workflows/wf-cli-release.yml');
  // verify-artifacts expects the per-platform tarballs to sit directly under
  // dist/wf-cli (e.g. dist/wf-cli/zingspark-wf-cli-darwin-arm64-<v>.tgz).
  // Without merge-multiple, download-artifact@v4 would create per-artifact
  // subdirectories (dist/wf-cli/<artifact-name>/) and verification would fail.
  assert.match(
    workflow,
    /merge-multiple:\s*true/,
    'download-artifact must set merge-multiple: true so artifacts land flat in dist/wf-cli',
  );
  // The download pattern must match the artifact names produced by the build
  // job, which are now exactly the matrix.platform values (wf-cli-*).
  assert.match(
    workflow,
    /pattern:\s*wf-cli-\*/,
    'download-artifact pattern must be wf-cli-*',
  );
});

test('AC-001: CI workflow installs and configures aarch64-linux-gnu cross linker', () => {
  const workflow = read('.github/workflows/wf-cli-release.yml');
  // The aarch64-unknown-linux-gnu target requires a cross linker on the
  // ubuntu runner. The workflow must install gcc-aarch64-linux-gnu and point
  // cargo at aarch64-linux-gnu-gcc for that target.
  assert.match(
    workflow,
    /gcc-aarch64-linux-gnu/,
    'workflow must install gcc-aarch64-linux-gnu for the linux-aarch64 target',
  );
  assert.match(
    workflow,
    /aarch64-unknown-linux-gnu/,
    'workflow must reference the aarch64-unknown-linux-gnu target',
  );
  assert.match(
    workflow,
    /CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER/,
    'workflow must set CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER for cross-linking',
  );
  assert.match(
    workflow,
    /aarch64-linux-gnu-gcc/,
    'workflow must configure aarch64-linux-gnu-gcc as the cross linker',
  );
});

test('AC-001: main launcher package packs without any native binary', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: path.join(root, 'packages', 'wf-cli'),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim())[0];
  const paths = report.files.map((f) => f.path);

  assert.ok(paths.includes('package.json'));
  assert.ok(paths.includes('bin/wf.js'), 'launcher bin must ship');
  assert.equal(paths.some((p) => /(^|\/)wf(\.exe)?$/.test(p)), false, 'no native binary may ship in the main package');
});
