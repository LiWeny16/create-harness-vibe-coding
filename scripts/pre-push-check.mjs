#!/usr/bin/env node
/**
 * pre-push-check.mjs — local gate (1-2s). Run before `git push`.
 *
 *   node scripts/pre-push-check.mjs            run checks
 *   node scripts/pre-push-check.mjs --install  wire into .git/hooks/pre-push
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HOOK_PATH = join(ROOT, '.git', 'hooks', 'pre-push');

const CHECKS = [
  { label: 'harness-version up to date', cmd: 'node scripts/build-version.mjs --check' },
  { label: 'harness validator',          cmd: 'node Harness/scripts/validate-harness.mjs --strict' },
  { label: 'hook syntax ok',             cmd: 'node --check Harness/scripts/wf-mode-hook.mjs' },
  { label: 'tests pass',                 cmd: 'node --test tests/*.test.js' },
];

// ── install ──────────────────────────────────────────────────────────
if (process.argv.includes('--install')) {
  const script = [
    '#!/bin/bash',
    '# Installed by scripts/pre-push-check.mjs --install',
    'echo "[pre-push] running checks…"',
    'node "$(cd "$(dirname "$0")/../.." && pwd)/scripts/pre-push-check.mjs"',
    '',
  ].join('\n');

  const hookDir = dirname(HOOK_PATH);
  if (!existsSync(hookDir)) mkdirSync(hookDir, { recursive: true });
  writeFileSync(HOOK_PATH, script, { mode: 0o755 });
  console.log('✅ pre-push hook installed at .git/hooks/pre-push');
  process.exit(0);
}

// ── run ──────────────────────────────────────────────────────────────
let failed = 0;
const start = Date.now();

for (const { label, cmd } of CHECKS) {
  process.stdout.write(`  ${label}... `);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe', timeout: 60000 });
    console.log('✅');
  } catch {
    console.log('❌');
    failed++;
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
if (failed > 0) {
  console.error(`\n❌ ${failed}/${CHECKS.length} checks failed (${elapsed}s). Fix before push.`);
  process.exit(1);
}
console.log(`\n✅ ${CHECKS.length}/${CHECKS.length} passed (${elapsed}s). Safe to push.`);
