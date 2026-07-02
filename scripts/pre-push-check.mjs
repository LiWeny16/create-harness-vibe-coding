#!/usr/bin/env node
/**
 * Local pre-push gate. Run manually before `git push`.
 *
 *   node scripts/pre-push-check.mjs
 */

import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const CHECKS = [
  { label: 'harness-version up to date', cmd: 'node scripts/build-version.mjs --check' },
  { label: 'harness validator', cmd: 'node Harness/scripts/validate-harness.mjs --strict' },
  { label: 'tests pass', cmd: 'node --test tests/*.test.js' },
];

let failed = 0;
const start = Date.now();

for (const { label, cmd } of CHECKS) {
  process.stdout.write(`  ${label}... `);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe', timeout: 60000 });
    console.log('PASS');
  } catch {
    console.log('FAIL');
    failed++;
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
if (failed > 0) {
  console.error(`\n${failed}/${CHECKS.length} checks failed (${elapsed}s). Fix before push.`);
  process.exit(1);
}

console.log(`\n${CHECKS.length}/${CHECKS.length} passed (${elapsed}s).`);
