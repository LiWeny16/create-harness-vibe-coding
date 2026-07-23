import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function read(rel) {
  return fs.readFileSync(rel, 'utf8');
}

test('context budget script passes current Harness load sets', () => {
  const output = execFileSync(
    process.execPath,
    ['Harness/scripts/context-budget.mjs', '--json'],
    { encoding: 'utf8' },
  );
  const report = JSON.parse(output);

  assert.equal(report.ok, true);
  assert.equal(report.note, 'Budgets are route-profile regression guards, not runtime exclusion rules. approxTokens is bytes/4, not provider token accounting.');

  const routes = new Map(report.results.map(result => [result.id, result]));
  for (const id of ['thin-startup', 'wf-router-prefix', 'wf-light-prefix', 'cache-diagnostics-route']) {
    assert.equal(routes.get(id).status, 'PASS', `${id} should stay under budget`);
    assert.equal(routes.get(id).missing.length, 0, `${id} should not have missing files`);
    assert.ok(routes.get(id).totalBytes <= routes.get(id).maxBytes, `${id} should stay below byte budget`);
  }

  assert.deepEqual(
    routes.get('thin-startup').files.map(file => file.path),
    ['CLAUDE.md', 'Harness/memory/startup-hints.md'],
  );
});

test('context docs enforce tiered lazy loading instead of broad prefetch', () => {
  for (const prefix of ['', 'templates/common/']) {
    const context = read(`${prefix}Harness/context-loading.md`);
    const startup = read(`${prefix}${prefix ? 'memory/startup-hints.md' : 'Harness/memory/startup-hints.md'}`);

    assert.match(context, /## Context Tiers/);
    assert.match(context, /automatic route profiles, not user-selected modes/);
    assert.match(context, /Budgets are regression guards, not exclusion rules/);
    assert.match(context, /Do not skip required rules, source\s+files, contracts, tests, or evidence to stay under budget/);
    assert.match(context, /Escalation rule/);
    assert.match(context, /Thin startup[^\n]*CLAUDE\.md[^\n]*startup-hints\.md/);
    assert.match(context, /Direct task[^\n]*only files needed for the task/);
    assert.match(context, /Router prefix[^\n]*Harness\/MEMORY\.md[^\n]*Harness\/README\.md/);
    assert.match(context, /Routed skill\/doc[^\n]*selected skill body/);
    assert.match(context, /Load skill bodies and tool schemas only when routed/);
    assert.match(context, /do not preload all skills or tools/);
    assert.doesNotMatch(context, /Always keep:/);

    assert.match(startup, /lightweight startup memory digest/);
    assert.match(startup, /must not load full `Harness\/MEMORY\.md`/);
    assert.match(startup, /Direct mode must not load the full Harness router/);
    assert.match(startup, /记住/);
    assert.doesNotMatch(startup, /鍚|銆|绂|鈥/);
  }
});

test('startup and router docs agree on direct-mode thin startup', () => {
  const claude = read('CLAUDE.md');
  const readme = read('Harness/README.md');

  assert.match(claude, /Default installed-project startup is thin/);
  assert.match(claude, /This is NOT loading `Harness\/MEMORY\.md`, `Harness\/README\.md`, or PROGRESS/);
  assert.match(claude, /In direct mode, do not load the full Harness router/);

  assert.match(readme, /Direct mode \(default\)[^\n]*Nothing beyond CLAUDE\.md/);
  assert.match(readme, /Do not read the whole `Harness\/` tree/);
  assert.match(readme, /Load the matching row only/);
});
