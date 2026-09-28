#!/usr/bin/env node
/**
 * wf-cli release tooling (AC-001).
 *
 * Single source of truth for the cross-platform matrix used by:
 *   - packages/wf-cli/bin/wf.js launcher
 *   - packages/wf-cli/package.json optionalDependencies
 *   - packages/wf-cli-* platform packages
 *   - .github/workflows/wf-cli-release.yml build matrix
 *
 * Commands:
 *   node scripts/wf-cli-release.mjs verify                # contract check (no build needed)
 *   node scripts/wf-cli-release.mjs stage --platform P --target T
 *   node scripts/wf-cli-release.mjs pack --platform P     # npm pack one platform package
 *   node scripts/wf-cli-release.mjs verify-artifacts --dist <dir>
 *   node scripts/wf-cli-release.mjs pack-main [--dry-run]
 *
 * This tool never publishes and never pushes.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Canonical platform matrix: the single source of truth.
export const PLATFORMS = [
  { dir: 'wf-cli-darwin-arm64', launcher: 'darwin-arm64', os: 'darwin', cpu: 'arm64', target: 'aarch64-apple-darwin', ext: '' },
  { dir: 'wf-cli-darwin-x64', launcher: 'darwin-x64', os: 'darwin', cpu: 'x64', target: 'x86_64-apple-darwin', ext: '' },
  { dir: 'wf-cli-linux-arm64-gnu', launcher: 'linux-arm64', os: 'linux', cpu: 'arm64', target: 'aarch64-unknown-linux-gnu', ext: '' },
  { dir: 'wf-cli-linux-x64-gnu', launcher: 'linux-x64', os: 'linux', cpu: 'x64', target: 'x86_64-unknown-linux-gnu', ext: '' },
  { dir: 'wf-cli-win32-arm64-msvc', launcher: 'win32-arm64', os: 'win32', cpu: 'arm64', target: 'aarch64-pc-windows-msvc', ext: '.exe' },
  { dir: 'wf-cli-win32-x64-msvc', launcher: 'win32-x64', os: 'win32', cpu: 'x64', target: 'x86_64-pc-windows-msvc', ext: '.exe' },
];

const SCOPE = '@zingspark';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function pkgName(dir) {
  return `${SCOPE}/${dir}`;
}

function fail(errors) {
  console.error(`[wf-cli-release] ${errors.length} contract violation(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

function ok(message) {
  console.log(`[wf-cli-release] ${message}`);
}

// --- verify ---------------------------------------------------------------

export function verify() {
  const errors = [];
  const cargo = read('crates/wf-cli/Cargo.toml');
  const cargoVersion = /version\s*=\s*"([^"]+)"/.exec(cargo)?.[1];
  const main = readJson('packages/wf-cli/package.json');

  // 1. Cargo and main launcher package share one version.
  if (!cargoVersion) errors.push('crates/wf-cli/Cargo.toml: missing version');
  if (cargoVersion && main.version !== cargoVersion) {
    errors.push(`version drift: Cargo.toml=${cargoVersion} packages/wf-cli=${main.version}`);
  }

  // 2. Launcher platform map covers exactly the canonical matrix.
  //    The launcher map values are full scoped package names such as
  //    `@zingspark/wf-cli-darwin-arm64`; we strip the `@zingspark/` prefix to
  //    obtain the directory name for comparison.
  const launcher = read('packages/wf-cli/bin/wf.js');
  const declared = new Map();
  const launcherRe = /'(\w+-\w+)':\s*'@zingspark\/([\w-]+)'/g;
  let m;
  while ((m = launcherRe.exec(launcher))) declared.set(m[1], m[2]);
  for (const p of PLATFORMS) {
    const dir = declared.get(p.launcher);
    if (dir !== p.dir) {
      errors.push(`launcher: ${p.launcher} -> ${dir ?? 'missing'} (expected ${p.dir})`);
    }
  }
  if (declared.size !== PLATFORMS.length) {
    errors.push(`launcher: ${declared.size} platform entries (expected ${PLATFORMS.length})`);
  }

  // 3. optionalDependencies exactly match the launcher matrix with one shared version.
  const optional = main.optionalDependencies || {};
  const optionalNames = Object.keys(optional);
  if (optionalNames.length !== PLATFORMS.length) {
    errors.push(`optionalDependencies: ${optionalNames.length} entries (expected ${PLATFORMS.length})`);
  }
  for (const p of PLATFORMS) {
    const name = pkgName(p.dir);
    if (!(name in optional)) {
      errors.push(`optionalDependencies: missing ${name}`);
    } else if (optional[name] !== main.version) {
      errors.push(`optionalDependencies: ${name}=${optional[name]} (expected ${main.version})`);
    }
  }
  for (const name of optionalNames) {
    if (!PLATFORMS.some((p) => pkgName(p.dir) === name)) {
      errors.push(`optionalDependencies: unexpected entry ${name}`);
    }
  }

  // 4. Platform packages exist with correct metadata.
  for (const p of PLATFORMS) {
    const rel = `packages/${p.dir}/package.json`;
    if (!fs.existsSync(path.join(ROOT, rel))) {
      errors.push(`missing platform package ${rel}`);
      continue;
    }
    const meta = readJson(rel);
    if (meta.name !== pkgName(p.dir)) errors.push(`${rel}: name ${meta.name} != ${pkgName(p.dir)}`);
    if (meta.version !== main.version) errors.push(`${rel}: version ${meta.version} != ${main.version}`);
    if (JSON.stringify(meta.os) !== JSON.stringify([p.os])) errors.push(`${rel}: os ${JSON.stringify(meta.os)} != ${JSON.stringify([p.os])}`);
    if (JSON.stringify(meta.cpu) !== JSON.stringify([p.cpu])) errors.push(`${rel}: cpu ${JSON.stringify(meta.cpu)} != ${JSON.stringify([p.cpu])}`);
    if (meta.binary !== `wf${p.ext}`) errors.push(`${rel}: binary ${meta.binary} != wf${p.ext}`);
    const files = new Set(meta.files || []);
    if (!files.has(`wf${p.ext}`)) errors.push(`${rel}: files must include wf${p.ext}`);
  }

  // 5. pnpm workspace covers platform packages.
  const workspace = read('pnpm-workspace.yaml');
  if (!/packages:\s*\n\s*-\s*"packages\/\*"/.test(workspace) && !/packages:\s*\n\s*-\s*'packages\/\*'/.test(workspace)) {
    errors.push('pnpm-workspace.yaml: must include packages/*');
  }

  // 6. CI workflow contains the build matrix and packaging jobs.
  const workflowRel = '.github/workflows/wf-cli-release.yml';
  if (!fs.existsSync(path.join(ROOT, workflowRel))) {
    errors.push(`missing ${workflowRel}`);
  } else {
    const workflow = read(workflowRel);
    for (const p of PLATFORMS) {
      if (!workflow.includes(`platform: ${p.dir}`)) errors.push(`workflow: matrix missing platform ${p.dir}`);
      if (!workflow.includes(p.target)) errors.push(`workflow: matrix missing cargo target ${p.target}`);
    }
    if (!/^\s*package:\s*$/m.test(workflow)) errors.push('workflow: missing "package" job');
    if (!/verify-artifacts/.test(workflow)) errors.push('workflow: package job must run verify-artifacts');
  }

  if (errors.length > 0) fail(errors);
  ok(`verify: ${PLATFORMS.length}-platform matrix consistent across launcher, optionalDependencies, platform packages, workspace, and CI workflow.`);
}

// --- stage -----------------------------------------------------------------

export function stage({ platform, target }) {
  const p = PLATFORMS.find((x) => x.dir === platform);
  if (!p) return fail([`unknown platform: ${platform}`]);
  if (target !== p.target) return fail([`${platform}: target ${target} != ${p.target}`]);

  const bin = path.join(ROOT, 'crates', 'wf-cli', 'target', target, 'release', `wf${p.ext}`);
  if (!fs.existsSync(bin)) return fail([`built binary not found: ${bin}`]);
  const dest = path.join(ROOT, 'packages', p.dir, `wf${p.ext}`);
  fs.copyFileSync(bin, dest);
  if (p.ext === '') fs.chmodSync(dest, 0o755);
  ok(`stage: ${bin} -> ${dest}`);
}

// --- pack ------------------------------------------------------------------

export function pack({ platform }) {
  const p = PLATFORMS.find((x) => x.dir === platform);
  if (!p) return fail([`unknown platform: ${platform}`]);
  const dir = path.join(ROOT, 'packages', p.dir);
  const binary = path.join(dir, `wf${p.ext}`);
  if (!fs.existsSync(binary)) return fail([`binary not staged in ${dir}: wf${p.ext}`]);
  const tgz = execFileSync('npm', ['pack'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').pop();
  ok(`pack: ${path.join(dir, tgz)}`);
}

// --- verify-artifacts -------------------------------------------------------

export function verifyArtifacts({ dist }) {
  const errors = [];
  const main = readJson('packages/wf-cli/package.json');
  for (const p of PLATFORMS) {
    // npm pack emits scoped packages as <scope-without-@>-<name>-<version>.tgz,
    // so @zingspark/wf-cli-darwin-arm64 -> zingspark-wf-cli-darwin-arm64-<version>.tgz
    const tgz = path.join(dist, `zingspark-${p.dir}-${main.version}.tgz`);
    if (!fs.existsSync(tgz)) errors.push(`missing artifact ${tgz}`);
  }
  if (errors.length > 0) return fail(errors);
  ok(`verify-artifacts: ${PLATFORMS.length}/${PLATFORMS.length} platform tarballs present in ${dist}.`);
}

// --- pack-main ---------------------------------------------------------------

export function packMain({ dryRun = true } = {}) {
  const args = dryRun ? ['pack', '--dry-run'] : ['pack'];
  const out = execFileSync('npm', args, { cwd: path.join(ROOT, 'packages', 'wf-cli'), encoding: 'utf8' });
  ok(`pack-main: ${dryRun ? 'dry-run ' : ''}npm pack succeeded for ${mainName()}.`);
}

function mainName() {
  return readJson('packages/wf-cli/package.json').name;
}

// --- CLI ---------------------------------------------------------------------

function flag(rest, name) {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (!isMain) {
  // Library mode: exporting functions only; CLI dispatch skipped.
} else {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case 'verify':
      verify();
      break;
    case 'stage':
      stage({ platform: flag(rest, '--platform'), target: flag(rest, '--target') });
      break;
    case 'pack':
      pack({ platform: flag(rest, '--platform') });
      break;
    case 'verify-artifacts':
      verifyArtifacts({ dist: path.resolve(ROOT, flag(rest, '--dist') || 'dist/wf-cli') });
      break;
    case 'pack-main':
      packMain({ dryRun: !rest.includes('--publish') });
      break;
    default:
      console.error('usage: node scripts/wf-cli-release.mjs <verify|stage|pack|verify-artifacts|pack-main> [flags]');
      process.exit(2);
  }
}
