import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { renderMarkdown, scoreSuite } from '../scripts/harness-bench.mjs';

const RESULT_PATH = path.join(process.cwd(), 'benchmarks', 'results', 'harnessbench-local-v0.2.json');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function readmeRowFor(mode) {
  return `| ${mode.modeLabel} (\`${mode.mode}\`) | ${mode.taskCount} | ${mode.totalRuns} | ${mode.verifiedRuns}/${mode.totalRuns} (${percent(mode.successRate)}) | ${mode.protectedOverwrites} | ${mode.repairRuns} | ${mode.manualRepairEvents} | ${mode.requiredFileMisses} | ${mode.benchmarkLeaks} | ${mode.boundaryViolations} |`;
}

function loadScored() {
  const suite = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8'));
  return { suite, scored: scoreSuite(suite) };
}

test('HarnessBench scorer summarizes 15-round local lifecycle proof results', () => {
  const { suite, scored } = loadScored();
  const direct = scored.modes.find(mode => mode.mode === 'direct-run');
  const harness = scored.modes.find(mode => mode.mode === 'harness-wf');

  assert.equal(suite.suiteId, 'harnessbench-local-v0.2');
  assert.equal(suite.runs.length, 30);
  assert.equal(suite.benchmarkScope.roundsPerMode, 15);
  assert.equal(direct.taskCount, 5);
  assert.equal(direct.totalRuns, 15);
  assert.equal(direct.verifiedRuns, 3);
  assert.equal(direct.protectedOverwrites, 21);
  assert.equal(direct.repairRuns, 12);
  assert.equal(direct.manualRepairEvents, 21);
  assert.equal(direct.requiredFileMisses, 0);
  assert.equal(direct.benchmarkLeaks, 0);
  assert.equal(direct.boundaryViolations, 12);
  assert.equal(harness.totalRuns, 15);
  assert.equal(harness.verifiedRuns, 15);
  assert.equal(harness.protectedOverwrites, 0);
  assert.equal(harness.repairRuns, 0);
  assert.equal(harness.benchmarkLeaks, 0);
  assert.equal(harness.boundaryViolations, 0);

  const markdown = renderMarkdown(scored);
  assert.match(markdown, /harnessbench-local-v0\.2/);
  assert.match(markdown, /deterministic-local-lifecycle-proof/);
  assert.match(markdown, /15\/15 \(100%/);
  assert.doesNotMatch(markdown, /Composite/);
});

test('README lifecycle proof table stays pinned to scorer output', () => {
  const { scored } = loadScored();
  const direct = scored.modes.find(mode => mode.mode === 'direct-run');
  const harness = scored.modes.find(mode => mode.mode === 'harness-wf');
  const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
  const readmeCn = fs.readFileSync(path.join(process.cwd(), 'README-CN.md'), 'utf8');

  assert.match(readme, new RegExp(escapeRegExp(readmeRowFor(direct))));
  assert.match(readme, new RegExp(escapeRegExp(readmeRowFor(harness))));
  assert.match(readmeCn, new RegExp(escapeRegExp(readmeRowFor(direct))));
  assert.match(readmeCn, new RegExp(escapeRegExp(readmeRowFor(harness))));
  assert.doesNotMatch(readme, /harnessbench-local-v0\.1/);
  assert.doesNotMatch(readmeCn, /harnessbench-local-v0\.1/);
});

test('benchmark assets are not included in generated package files', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const files = pkg.files || [];

  assert.ok(!files.some(entry => /^benchmarks\/?/.test(entry)), 'benchmarks/ must stay outside npm package files');
  assert.ok(!files.some(entry => /^scripts\/?/.test(entry)), 'benchmark scorer and runner scripts must stay outside npm package files');
});
