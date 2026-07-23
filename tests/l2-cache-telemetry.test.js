import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function runScript(args) {
  const output = execFileSync(
    process.execPath,
    ['Harness/scripts/l2-cache-telemetry.mjs', ...args, '--json'],
    { encoding: 'utf8' },
  );
  return JSON.parse(output);
}

function writeFixture(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-l2-'));
  const file = path.join(dir, 'fixture.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return file;
}

test('AC-L2-001 dry-run prints an auditable Claude Code telemetry plan', () => {
  const report = runScript([
    '--dry-run',
    '--groups',
    'provider-control,harness-thin,wf-light',
    '--turns',
    '3',
    '--turn-budget-usd',
    '0.25',
    '--total-budget-usd',
    '0.90',
  ]);

  assert.equal(report.schema, 'harness-l2-cache-telemetry@1');
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.settings.turnsPerGroup, 3);
  assert.equal(report.settings.turnBudgetUsd, 0.25);
  assert.equal(report.settings.totalBudgetUsd, 0.9);
  assert.match(report.outputPath, /\.claude[\\/]cache-telemetry[\\/]harness-l2-/);
  assert.deepEqual(report.plan.groups.map(group => group.id), [
    'provider-control',
    'harness-thin',
    'wf-light',
  ]);

  const previews = report.plan.groups.flatMap(group => group.turns);
  for (const preview of previews) {
    assert.ok(preview.args.includes('-p'));
    assert.ok(preview.args.includes('--output-format'));
    assert.ok(preview.args.includes('json'));
    assert.ok(preview.args.includes('--strict-mcp-config'));
    assert.ok(preview.args.includes('--max-budget-usd'));
    assert.ok(preview.args.includes('--max-turns'));
    assert.ok(!preview.args.includes('--bare'));
    assert.ok(!preview.args.includes(''));
  }

  const wfCold = report.plan.groups.find(group => group.id === 'wf-light').turns[0];
  assert.match(wfCold.prompt, /^\/wf /);
  assert.ok(report.sourceEvidence.officialDocs.some(url => url.includes('/prompt-caching')));
  assert.equal(report.sourceEvidence.localHelpRequired, true);
});

test('AC-L2-002 summary uses provider input-only formula including cache creation tokens', () => {
  const fixture = writeFixture({
    schema: 'harness-l2-cache-telemetry@1',
    runs: [
      {
        group: 'harness-thin',
        turn: 0,
        success: true,
        usage: { input_tokens: 800, cache_creation_input_tokens: 200, cache_read_input_tokens: 0, output_tokens: 20 },
        duration_ms: 1000,
        total_cost_usd: 0.02,
      },
      {
        group: 'harness-thin',
        turn: 1,
        success: true,
        usage: { input_tokens: 100, cache_creation_input_tokens: 100, cache_read_input_tokens: 800, output_tokens: 10 },
        duration_ms: 700,
        total_cost_usd: 0.01,
      },
      {
        group: 'harness-thin',
        turn: 2,
        success: true,
        usage: { input_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 950, output_tokens: 10 },
        duration_ms: 600,
        total_cost_usd: 0.01,
      },
    ],
  });

  const report = runScript(['--from-file', fixture]);
  const group = report.summary.groups['harness-thin'];

  assert.equal(group.totalTurns, 3);
  assert.equal(group.successRate, 1);
  assert.equal(group.warmTurns, 2);
  assert.deepEqual(group.warmReadRatioPercent, [80, 95]);
  assert.equal(group.warmMinReadRatioPercent, 80);
  assert.equal(group.warmMedianReadRatioPercent, 87.5);
  assert.equal(group.warmMaxReadRatioPercent, 95);
  assert.equal(group.p95DurationMs, 1000);
  assert.equal(group.warmMedianDurationMs, 650);
  assert.equal(group.warmP95DurationMs, 700);
  assert.equal(report.summary.totalCostUsd, 0.04);
  assert.equal(report.summary.claimGate.measuredWarmCacheClaimAllowed, false);
  assert.match(
    report.summary.claimGate.reasons.join('\n'),
    /needs at least 10 warm telemetry turns/,
  );
});

test('AC-L2-003 claim gate separates measured cache evidence from improvement claims', () => {
  const runs = [];
  for (const group of ['provider-control', 'harness-thin', 'wf-light']) {
    runs.push({
      group,
      turn: 0,
      success: true,
      usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 },
      duration_ms: 1000,
      total_cost_usd: 0.01,
    });
    for (let turn = 1; turn <= 10; turn++) {
      const read = group === 'provider-control' ? 900 : 980;
      const fresh = group === 'provider-control' ? 100 : 20;
      runs.push({
        group,
        turn,
        success: true,
        usage: { input_tokens: fresh, cache_creation_input_tokens: 0, cache_read_input_tokens: read, output_tokens: 10 },
        duration_ms: 500,
        total_cost_usd: 0.002,
      });
    }
  }

  const report = runScript(['--from-file', writeFixture({ runs })]);

  assert.equal(report.summary.claimGate.measuredWarmCacheClaimAllowed, true);
  assert.equal(report.summary.claimGate.improvementClaimAllowed, true);
  assert.equal(report.summary.groups['provider-control'].warmMedianReadRatioPercent, 90);
  assert.equal(report.summary.groups['harness-thin'].warmMedianReadRatioPercent, 98);
  assert.equal(report.summary.groups['wf-light'].warmMedianReadRatioPercent, 98);
});
