import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const bin = path.resolve('bin/create-harness-vibe-coding.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cli-'));
}

test('--help documents existing-project flags and optional skills', () => {
  const output = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.match(output, /--dry-run/);
  assert.match(output, /--on-conflict/);
  assert.match(output, /--with/);
  assert.match(output, /--without/);
  assert.match(output, /--preset/);
  assert.match(output, /--list-options/);
});

test('--dry-run prints plan and does not create target', () => {
  const root = tmpdir();
  const target = path.join(root, 'dry-app');
  const output = execFileSync(process.execPath, [bin, 'dry-app', target, '-y', '--dry-run'], { encoding: 'utf8' });

  assert.match(output, /Dry run/i);
  assert.match(output, /create/i);
  assert.doesNotMatch(output, /Generation complete/i);
  assert.equal(fs.existsSync(target), false);
});

test('--dry-run prints full plan for existing project conflicts without writing', () => {
  const root = tmpdir();
  const target = path.join(root, 'legacy');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');

  const result = spawnSync(process.execPath, [bin, 'legacy', target, '-y', '--dry-run'], { encoding: 'utf8' });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /Dry run/i);
  assert.match(output, /create:/i);
  assert.match(output, /conflict:/i);
  assert.match(output, /CLAUDE\.md/);
  assert.match(output, /tests\/\.gitkeep/);
  assert.doesNotMatch(output, /\.\.\. \d+ more/);
  assert.doesNotMatch(output, /Generation complete/i);
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
  assert.equal(fs.existsSync(path.join(target, 'SETUP.md')), false);
});

test('existing project default conflict exits non-zero and preserves file', () => {
  const root = tmpdir();
  const target = path.join(root, 'legacy');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');

  const result = spawnSync(process.execPath, [bin, 'legacy', target, '-y'], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /conflict/i);
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
});

test('existing project can opt into skip conflicts', () => {
  const root = tmpdir();
  const target = path.join(root, 'legacy');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');

  const output = execFileSync(process.execPath, [bin, 'legacy', target, '-y', '--on-conflict', 'skip'], { encoding: 'utf8' });

  assert.match(output, /skipped/i);
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
  assert.ok(fs.existsSync(path.join(target, 'scripts', 'validate-harness.mjs')));
});

test('existing project can use equals form for conflict policy', () => {
  const root = tmpdir();
  const target = path.join(root, 'legacy');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');

  const output = execFileSync(process.execPath, [bin, 'legacy', target, '-y', '--on-conflict=skip'], { encoding: 'utf8' });

  assert.match(output, /skipped/i);
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
});

test('--list-options prints built-in optional catalog', () => {
  const output = execFileSync(process.execPath, [bin, '--list-options'], { encoding: 'utf8' });
  assert.match(output, /browser-e2e/);
  assert.match(output, /ts-react-frontend/);
  assert.match(output, /web-app/);
});

test('--with copies optional skills and workflows', () => {
  const root = tmpdir();
  const target = path.join(root, 'web');

  execFileSync(process.execPath, [bin, 'web', target, '-y', '--with', 'ts-react-frontend,browser-e2e'], { encoding: 'utf8' });

  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'browser-e2e', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, 'docs', 'workflows', 'browser-e2e.md')));
  assert.match(fs.readFileSync(path.join(target, 'MEMORY.md'), 'utf8'), /ts-react-frontend/);
  const docsReadme = fs.readFileSync(path.join(target, 'docs', 'README.md'), 'utf8');
  const workflowLinks = [...docsReadme.matchAll(/\]\((workflows\/[^)]+)\)/g)].map(match => match[1]);
  assert.ok(workflowLinks.includes('workflows/browser-e2e.md'));
  for (const link of workflowLinks) {
    assert.ok(fs.existsSync(path.join(target, 'docs', link)), `Expected ${link} to resolve from docs/README.md`);
  }
});

test('--with equals form copies optional workflows', () => {
  const root = tmpdir();
  const target = path.join(root, 'web-equals');

  execFileSync(process.execPath, [bin, 'web-equals', target, '-y', '--with=browser-e2e'], { encoding: 'utf8' });

  assert.ok(fs.existsSync(path.join(target, 'docs', 'workflows', 'browser-e2e.md')));
});

test('--preset web-app expands optional skills', () => {
  const root = tmpdir();
  const target = path.join(root, 'web-preset');

  execFileSync(process.execPath, [bin, 'web-preset', target, '-y', '--preset', 'web-app'], { encoding: 'utf8' });

  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'browser-e2e', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ui-ux-review', 'SKILL.md')));
});

test('--preset equals form expands optional workflows', () => {
  const root = tmpdir();
  const target = path.join(root, 'web-preset-equals');

  execFileSync(process.execPath, [bin, 'web-preset-equals', target, '-y', '--preset=web-app'], { encoding: 'utf8' });

  assert.ok(fs.existsSync(path.join(target, 'docs', 'workflows', 'browser-e2e.md')));
});

test('--without subtracts optional workflows after preset and with', () => {
  const root = tmpdir();
  const target = path.join(root, 'trimmed-fullstack');

  execFileSync(
    process.execPath,
    [bin, 'trimmed-fullstack', target, '-y', '--preset', 'fullstack', '--with', 'ui-ux-review', '--without', 'python-backend,github-pr-review'],
    { encoding: 'utf8' },
  );

  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'browser-e2e', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ui-ux-review', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'python-backend', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'github-pr-review', 'SKILL.md')), false);
});

test('--without equals form accepts known unselected optional ids as no-op', () => {
  const root = tmpdir();
  const target = path.join(root, 'web-trimmed-equals');

  execFileSync(process.execPath, [bin, 'web-trimmed-equals', target, '-y', '--preset=web-app', '--without=python-backend'], { encoding: 'utf8' });

  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'python-backend', 'SKILL.md')), false);
});

test('unknown optional skill id exits with readable error', () => {
  const root = tmpdir();
  const target = path.join(root, 'bad');
  const result = spawnSync(process.execPath, [bin, 'bad', target, '-y', '--with', 'not-a-skill'], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /not-a-skill/);
  assert.match(`${result.stdout}\n${result.stderr}`, /--list-options/);
});

test('unknown without skill id exits with readable error', () => {
  const root = tmpdir();
  const target = path.join(root, 'bad-without');
  const result = spawnSync(process.execPath, [bin, 'bad-without', target, '-y', '--preset', 'web-app', '--without', 'not-a-skill'], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /not-a-skill/);
  assert.match(`${result.stdout}\n${result.stderr}`, /--list-options/);
  assert.equal(fs.existsSync(target), false);
});

test('flags requiring values fail readably without creating project', () => {
  for (const flag of ['--with', '--without', '--preset', '--on-conflict', '--with=', '--without=', '--preset=', '--on-conflict=']) {
    const root = tmpdir();
    const target = path.join(root, 'bad');
    const result = spawnSync(process.execPath, [bin, 'bad', target, '-y', flag, '--dry-run'], { encoding: 'utf8' });
    const flagName = flag.replace(/=$/, '');

    assert.notEqual(result.status, 0, flag);
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(`${flagName} requires a value`));
    assert.equal(fs.existsSync(target), false);
  }
});

test('unknown flags fail readably without creating project', () => {
  const root = tmpdir();
  const target = path.join(root, 'bad');
  const result = spawnSync(process.execPath, [bin, 'bad', target, '-y', '--wat'], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unknown flag "--wat"/);
  assert.equal(fs.existsSync(target), false);
});

test('generated optional project passes harness validator', () => {
  const root = tmpdir();
  const target = path.join(root, 'validated-web');

  execFileSync(process.execPath, [bin, 'validated-web', target, '-y', '--with', 'browser-e2e,ts-react-frontend'], { encoding: 'utf8' });
  const output = execFileSync(process.execPath, ['scripts/validate-harness.mjs'], { cwd: target, encoding: 'utf8' });

  assert.match(output, /Harness validation passed/);
});

test('--json --dry-run outputs valid JSON plan without decorative text', () => {
  const root = tmpdir();
  const target = path.join(root, 'json-dry');
  const output = execFileSync(process.execPath, [bin, 'json-dry', target, '--json', '--dry-run'], { encoding: 'utf8' });

  // Must be valid JSON with no leading/trailing non-JSON content
  const data = JSON.parse(output.trim());
  assert.equal(data.success, true);
  assert.equal(data.dryRun, true);
  assert.ok(Array.isArray(data.plan.create));
  assert.ok(data.plan.create.includes('CLAUDE.md'));
  assert.equal(data.summary.created, data.plan.create.length);
  // Verify no decorative text leaked into stdout
  assert.doesNotMatch(output, /Generation complete/);
  assert.doesNotMatch(output, /Next steps/);
  assert.doesNotMatch(output, /╔/);
});

test('--json --dry-run reports existing project conflicts in structured plan', () => {
  const root = tmpdir();
  const target = path.join(root, 'json-legacy');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');

  const output = execFileSync(process.execPath, [bin, 'json-legacy', target, '--json', '--dry-run'], { encoding: 'utf8' });
  const data = JSON.parse(output.trim());

  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.plan.conflict));
  assert.ok(data.plan.conflict.includes('CLAUDE.md'));
  assert.ok(Array.isArray(data.plan.create));
  assert.equal(data.summary.conflicts, data.plan.conflict.length);
  // Verify legacy file untouched
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
});

test('--json with --on-conflict skip outputs structured result', () => {
  const root = tmpdir();
  const target = path.join(root, 'json-skip');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');

  const output = execFileSync(process.execPath, [bin, 'json-skip', target, '--json', '--on-conflict', 'skip'], { encoding: 'utf8' });
  const data = JSON.parse(output.trim());

  assert.equal(data.success, true);
  assert.equal(data.dryRun, undefined);
  assert.ok(Array.isArray(data.plan.skip));
  assert.ok(data.plan.skip.includes('CLAUDE.md'));
  assert.ok(Array.isArray(data.plan.create));
  assert.ok(data.plan.create.includes('SETUP.md'));
  assert.equal(data.summary.skipped, data.plan.skip.length);
  // Verify legacy file preserved and new files created
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
  assert.ok(fs.existsSync(path.join(target, 'SETUP.md')));
});

test('--json mode is non-interactive and uses defaults', () => {
  const root = tmpdir();
  const target = path.join(root, 'json-default');
  // Run with --json only, no -y, no positionals, from a temp cwd
  const result = spawnSync(process.execPath, [bin, '--json', '--dry-run'], {
    encoding: 'utf8',
    cwd: root,
  });
  const output = result.stdout.trim();

  // Must produce valid JSON despite no arguments
  assert.equal(result.status, 0, output);
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  // Non-interactive mode used defaults — plan includes expected core files
  assert.ok(data.plan.create.includes('CLAUDE.md'));
  assert.ok(data.plan.create.includes('SETUP.md'));
  assert.ok(data.plan.create.includes('MEMORY.md'));
  // Verify no interactive text leaked
  assert.doesNotMatch(output, /Generation complete/);
  assert.doesNotMatch(output, /Confirm/);
});
