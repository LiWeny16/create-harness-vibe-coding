#!/usr/bin/env node
/**
 * Temp-leak guard (recurrence net for the "litter the user's machine" bug class).
 *
 * Wraps a command, snapshots framework-prefixed temp dirs before/after, and
 * FAILS if the command leaves net-new `harness-*` dirs in the OS temp dir.
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

// Every framework temp dir MUST use the `harness-` prefix (tests use harness-validator-,
// harness-collision-, harness-generator-, harness-cli-, harness-check-root-, harness-p0-).
// If a new prefix is ever introduced, add it here or the guard will miss it silently.
const PREFIXES = ['harness-'];

function snapshot() {
  const dirs = new Set();
  let entries;
  try {
    entries = fs.readdirSync(os.tmpdir(), { withFileTypes: true });
  } catch {
    return dirs;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && PREFIXES.some((p) => entry.name.startsWith(p))) {
      dirs.add(entry.name);
    }
  }
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
  console.error(`\ncheck-temp-leak: failed to spawn ${cmd.join(' ')} — ${result.error.message}`);
  process.exit(1);
}
const after = snapshot();

const leaked = [...after].filter((d) => !before.has(d));

if (leaked.length > 0) {
  console.error(`\ncheck-temp-leak: FAIL — ${leaked.length} temp dir(s) left in ${os.tmpdir()}:`);
  for (const d of leaked.sort()) console.error(`  ${d}`);
  console.error('Every test that creates a temp dir must clean it up (after() + fs.rmSync).');
  process.exit(1);
}

process.exit(result.status ?? 1);
