#!/usr/bin/env node
/**
 * Temp-leak guard (recurrence net for the "litter the user's machine" bug class).
 *
 * Wraps a command, snapshots framework temp dirs before/after, and FAILS if
 * the command leaves net-new dirs in either system temp or Harness/.temp.
 *
 *   node scripts/check-temp-leak.mjs -- npm test
 *
 * The wrapped command's stdout/stderr are inherited (never masked). The
 * command's own exit status is propagated; a detected leak adds an extra
 * non-zero exit. Existing leftover dirs (present before the run) are treated
 * as baseline and ignored, so only NEW litter fails the gate.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep this list aligned with legacy/system-temp framework prefixes.
// If a new framework temp prefix is introduced, add it here or the guard will miss it.
const PREFIXES = [
  'harness-',
  'wf-ui-',
  'wf-terminal-',
  'wf-workspace-',
  'wf-component-',
  'wf-node-',
  'wf-trash-',
  'runtime-config-',
  'terminal-store-',
  'a2a-store-',
  'st-test-',
  'tp-test-',
  'peer-capsule-test-',
];

const PROJECT_TEMP_ROOT = path.resolve('Harness', '.temp');

function addSystemTempSnapshot(dirs) {
  let entries;
  try {
    entries = fs.readdirSync(os.tmpdir(), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && PREFIXES.some((p) => entry.name.startsWith(p))) {
      dirs.add(`system:${entry.name}`);
    }
  }
}

function addProjectTempSnapshot(dirs, dir = PROJECT_TEMP_ROOT, base = PROJECT_TEMP_ROOT) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    dirs.add(`project:${rel}`);
    addProjectTempSnapshot(dirs, full, base);
  }
}

function snapshot() {
  const dirs = new Set();
  addSystemTempSnapshot(dirs);
  addProjectTempSnapshot(dirs);
  return dirs;
}

const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();
const cmd = argv;
if (cmd.length === 0) {
  console.error('check-temp-leak: missing command. Usage: node scripts/check-temp-leak.mjs -- <command> [args...]');
  process.exit(2);
}

const before = snapshot();
const result = spawnSync(cmd[0], cmd.slice(1), {
  stdio: 'inherit',
  cwd: process.cwd(),
  // Windows: bare `npm`/`npx` are .cmd shims that need a shell to resolve.
  // shell:true is safe here because args are repo-controlled (scripts/pre-push-check.mjs);
  // never route externally-sourced args through this guard without quoting.
  shell: process.platform === 'win32',
});
if (result.error) {
  console.error(`\ncheck-temp-leak: failed to spawn ${cmd.join(' ')} - ${result.error.message}`);
  process.exit(1);
}
const after = snapshot();

const leaked = [...after].filter((d) => !before.has(d));

if (leaked.length > 0) {
  console.error(`\ncheck-temp-leak: FAIL - ${leaked.length} temp dir(s) left in system temp or Harness/.temp:`);
  for (const d of leaked.sort()) {
    const [scope, rel] = d.split(/:(.*)/, 2);
    const root = scope === 'project' ? PROJECT_TEMP_ROOT : os.tmpdir();
    console.error(`  ${path.join(root, rel)}`);
  }
  console.error('Every test that creates a temp dir must clean it up (after()/afterEach()/finally + fs.rmSync).');
  process.exit(1);
}

process.exit(result.status ?? 1);
