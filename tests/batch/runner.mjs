#!/usr/bin/env node
// runner.mjs — Batch integration test orchestrator
// Usage: node tests/batch/runner.mjs [--scenario N] [--verbose]

import { readdirSync, existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = new URL('.', import.meta.url).pathname;
const ROOT = resolve(__dirname, '..', '..');
const SCENARIOS_DIR = join(ROOT, 'tests', 'batch', 'scenarios');
const TMP = join(ROOT, 'tests', 'batch', '.tmp');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const scenarioFilter = args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : null;

// Clean and recreate tmp
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// Find scenarios
const scenarios = readdirSync(SCENARIOS_DIR)
  .filter(f => f.endsWith('.mjs'))
  .sort();

const toRun = scenarioFilter
  ? scenarios.filter(s => s.startsWith(scenarioFilter))
  : scenarios;

if (toRun.length === 0) {
  console.error(`No scenarios found${scenarioFilter ? ' matching ' + scenarioFilter : ''}`);
  process.exit(1);
}

console.log(`Running ${toRun.length} batch scenario(s)...\n`);

let totalPassed = 0, totalFailed = 0;

for (const scenarioFile of toRun) {
  const scenarioPath = join(SCENARIOS_DIR, scenarioFile);
  console.log(`── ${scenarioFile} ──`);
  try {
    const result = execFileSync(process.execPath, [scenarioPath], {
      encoding: 'utf8',
      timeout: 60000,
      cwd: ROOT,
      env: { ...process.env, BATCH_TMP: TMP, BATCH_VERBOSE: verbose ? '1' : '0' },
    });
    if (verbose) console.log(result);
    // Parse pass/fail from output
    const passed = (result.match(/✓/g) || []).length;
    const failed = (result.match(/FAIL/g) || []).length;
    totalPassed += passed;
    totalFailed += failed;
    console.log(`  ${passed}✓ ${failed > 0 ? failed + '✗' : ''}`);
  } catch (e) {
    console.error(`  CRASH: ${e.message.slice(0, 200)}`);
    if (verbose) console.error(e.stderr || '');
    totalFailed++;
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Total: ${totalPassed} passed, ${totalFailed} failed`);
console.log(`${'═'.repeat(60)}`);

// Cleanup
try { rmSync(TMP, { recursive: true, force: true }); } catch {}

process.exit(totalFailed > 0 ? 1 : 0);
