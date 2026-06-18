import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generate } from '../src/generator.js';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-generator-'));
}

function readRel(root, rel) {
  return fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
}

test('dry run returns planned creates without writing files', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'app');
  const result = generate({ projectName: 'app', targetDir, dryRun: true });

  assert.equal(result.success, true);
  assert.equal(fs.existsSync(targetDir), false);
  assert.ok(result.plan.create.includes('CLAUDE.md'));
  assert.equal(result.summary.created, result.plan.create.length);
});

test('dry run reports existing project conflicts in the plan without writing files', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'legacy');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'CLAUDE.md'), 'legacy rules\n');

  const result = generate({ projectName: 'legacy', targetDir, dryRun: true });

  assert.equal(result.success, true);
  assert.ok(result.plan.conflict.includes('CLAUDE.md'));
  assert.ok(result.plan.create.includes('SETUP.md'));
  assert.equal(result.summary.created, result.plan.create.length);
  assert.equal(result.summary.conflicts, result.plan.conflict.length);
  assert.equal(fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8'), 'legacy rules\n');
  assert.equal(fs.existsSync(path.join(targetDir, 'SETUP.md')), false);
});

test('dry run summary reflects skip backup and overwrite plans', () => {
  for (const policy of ['skip', 'backup', 'overwrite']) {
    const root = tmpdir();
    const targetDir = path.join(root, policy);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'CLAUDE.md'), 'legacy rules\n');

    const result = generate({ projectName: policy, targetDir, dryRun: true, onConflict: policy });

    assert.equal(result.success, true);
    assert.equal(result.summary.created, result.plan.create.length);
    assert.equal(result.summary.skipped, result.plan.skip.length);
    assert.equal(result.summary.backedUp, result.plan.backup.length);
    assert.equal(result.summary.overwritten, result.plan.overwrite.length);
    assert.equal(fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8'), 'legacy rules\n');
  }
});

test('default conflict policy fails before overwriting existing files', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'legacy');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'CLAUDE.md'), 'legacy rules\n');

  const result = generate({ projectName: 'legacy', targetDir });

  assert.equal(result.success, false);
  assert.match(result.errors.join('\n'), /conflict/i);
  assert.equal(fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8'), 'legacy rules\n');
});

test('skip conflict policy preserves existing files and creates missing harness files', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'legacy');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'CLAUDE.md'), 'legacy rules\n');

  const result = generate({ projectName: 'legacy', targetDir, onConflict: 'skip' });

  assert.equal(result.success, true);
  assert.ok(result.plan.skip.includes('CLAUDE.md'));
  assert.equal(fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8'), 'legacy rules\n');
  assert.ok(fs.existsSync(path.join(targetDir, 'docs', 'harness', 'PLAN.md')));
});

test('backup conflict policy keeps original and writes template file', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'legacy');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'CLAUDE.md'), 'legacy rules\n');

  const result = generate({ projectName: 'legacy', targetDir, onConflict: 'backup' });

  assert.equal(result.success, true);
  assert.ok(result.plan.backup.includes('CLAUDE.md'));
  assert.ok(fs.existsSync(path.join(targetDir, 'CLAUDE.md.harness-backup')));
  assert.match(fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8'), /# CLAUDE\.md/);
});

test('backup conflict policy uses unique backup names without overwriting prior backups', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'legacy');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'CLAUDE.md'), 'legacy rules\n');
  fs.writeFileSync(path.join(targetDir, 'CLAUDE.md.harness-backup'), 'first backup\n');

  const result = generate({ projectName: 'legacy', targetDir, onConflict: 'backup' });

  assert.equal(result.success, true);
  assert.equal(fs.readFileSync(path.join(targetDir, 'CLAUDE.md.harness-backup'), 'utf8'), 'first backup\n');
  assert.equal(fs.readFileSync(path.join(targetDir, 'CLAUDE.md.harness-backup.1'), 'utf8'), 'legacy rules\n');
  assert.match(fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8'), /# CLAUDE\.md/);
});

test('directory at target file path is always a conflict except skip', () => {
  for (const policy of ['fail', 'backup', 'overwrite']) {
    const root = tmpdir();
    const targetDir = path.join(root, policy);
    fs.mkdirSync(path.join(targetDir, 'CLAUDE.md'), { recursive: true });

    const result = generate({ projectName: policy, targetDir, onConflict: policy });

    assert.equal(result.success, false);
    assert.ok(result.plan.conflict.includes('CLAUDE.md'));
    assert.equal(fs.statSync(path.join(targetDir, 'CLAUDE.md')).isDirectory(), true);
    assert.equal(fs.existsSync(path.join(targetDir, 'CLAUDE.md.harness-backup')), false);
  }
});

test('skip conflict policy leaves directory at target file path untouched', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'skip-dir');
  fs.mkdirSync(path.join(targetDir, 'CLAUDE.md'), { recursive: true });

  const result = generate({ projectName: 'skip-dir', targetDir, onConflict: 'skip' });

  assert.equal(result.success, true);
  assert.ok(result.plan.skip.includes('CLAUDE.md'));
  assert.equal(fs.statSync(path.join(targetDir, 'CLAUDE.md')).isDirectory(), true);
  assert.ok(fs.existsSync(path.join(targetDir, 'SETUP.md')));
});

test('without options subtract from preset and explicit optional skills', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'trimmed-fullstack');

  const result = generate({
    projectName: 'trimmed-fullstack',
    targetDir,
    preset: 'fullstack',
    withOptions: ['ui-ux-review'],
    withoutOptions: ['python-backend,github-pr-review'],
  });

  assert.equal(result.success, true);
  assert.ok(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'browser-e2e', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'ui-ux-review', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'python-backend', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'github-pr-review', 'SKILL.md')), false);
});

test('without options accept known unselected ids as no-op', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'web-with-unselected-without');

  const result = generate({
    projectName: 'web-with-unselected-without',
    targetDir,
    preset: 'web-app',
    withoutOptions: ['python-backend'],
  });

  assert.equal(result.success, true);
  assert.ok(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'python-backend', 'SKILL.md')), false);
});

test('unknown without options fail with list-options guidance', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'bad-without');

  const result = generate({
    projectName: 'bad-without',
    targetDir,
    preset: 'web-app',
    withoutOptions: ['not-a-skill'],
  });

  assert.equal(result.success, false);
  assert.match(result.errors.join('\n'), /not-a-skill/);
  assert.match(result.errors.join('\n'), /--list-options/);
  assert.equal(fs.existsSync(targetDir), false);
});

test('generated scaffold includes memory folder registrations and reflection triggers', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'memory-app');

  const result = generate({ projectName: 'memory-app', targetDir });

  assert.equal(result.success, true);
  const memoryFiles = [
    'memory/tool-usage-reflections.md',
    'memory/user-corrections-preferences.md',
    'memory/agent-lessons-patterns.md',
  ];

  for (const rel of memoryFiles) {
    assert.ok(fs.existsSync(path.join(targetDir, ...rel.split('/'))), `Expected ${rel} to be generated`);
  }

  const memoryIndex = readRel(targetDir, 'MEMORY.md');
  const docsReadme = readRel(targetDir, 'docs/README.md');
  const setup = readRel(targetDir, 'SETUP.md');
  const claude = readRel(targetDir, 'CLAUDE.md');

  for (const rel of memoryFiles) {
    assert.match(memoryIndex, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(docsReadme, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(setup, /memory\//);
  assert.match(claude, /same tool\/use pattern fails 3\+ times/);
  assert.match(claude, /user corrects the same assumption\/pattern 2\+ times/);
});

test('core docs declare project files as the durable communication channel', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'durable-docs');

  const result = generate({ projectName: 'durable-docs', targetDir });

  assert.equal(result.success, true);
  for (const rel of ['docs/README.md', 'docs/harness/dispatch.md', 'docs/harness/context-loading.md']) {
    const body = readRel(targetDir, rel);
    assert.match(body, /project files are the only durable communication channel/i, `${rel} should declare durable filesystem authority`);
    assert.match(body, /chat\/subagent transcript state is non-authoritative/i, `${rel} should reject transcript state as authoritative`);
  }
});

test('generated web workflows require stable accessible selectors and test hooks', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'web-contracts');

  const result = generate({
    projectName: 'web-contracts',
    targetDir,
    preset: 'web-app',
  });

  assert.equal(result.success, true);

  const browserWorkflow = readRel(targetDir, 'docs/workflows/browser-e2e.md');
  const reactWorkflow = readRel(targetDir, 'docs/workflows/ts-react-frontend.md');
  const featureTemplate = readRel(targetDir, 'docs/features/_template.md');

  for (const body of [browserWorkflow, reactWorkflow]) {
    assert.match(body, /data-testid/);
    assert.match(body, /accessible labels\/roles/);
    assert.match(body, /inputs, buttons, filters, rows, empty\/error\/loading states/);
  }

  assert.match(featureTemplate, /UI Automation Hooks/);
  assert.match(featureTemplate, /data-testid/);
  assert.match(featureTemplate, /critical UI controls and states/);
});

test('generated browser workflow includes Chrome DevTools CDP MCP checklist', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'browser-cdp-checklist');

  const result = generate({
    projectName: 'browser-cdp-checklist',
    targetDir,
    withOptions: ['browser-e2e'],
  });

  assert.equal(result.success, true);

  const browserWorkflow = readRel(targetDir, 'docs/workflows/browser-e2e.md');

  assert.match(browserWorkflow, /## Chrome DevTools \/ CDP \/ MCP Checklist/);
  assert.match(browserWorkflow, /record the URL and port/);
  assert.match(browserWorkflow, /available CDP, MCP, browser automation, or manual tooling/);
  assert.match(browserWorkflow, /not just HTTP 200/);
  assert.match(browserWorkflow, /runtime exceptions, console errors, and failed network requests/);
  assert.match(browserWorkflow, /stable accessible labels\/roles or `data-testid`/);
  assert.match(browserWorkflow, /critical flow end-to-end/);
  assert.match(browserWorkflow, /screenshot, trace, video, or result artifact paths/);
  assert.match(browserWorkflow, /Clean up any dev server or browser processes/);
});
