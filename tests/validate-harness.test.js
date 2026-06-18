import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { generate } from '../src/generator.js';

const projectFacts = [
  'docs/harness/PLAN.md',
  'docs/research/PRD.md',
  'docs/research/research-results.md',
  'docs/harness/architecture.md',
  'docs/domain/ports.md',
];

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-validator-'));
}

function writeRel(root, rel, content) {
  fs.writeFileSync(path.join(root, ...rel.split('/')), content, 'utf8');
}

function readRel(root, rel) {
  return fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
}

function generateProject(options = {}) {
  const root = tmpdir();
  const targetDir = path.join(root, 'validated');
  const result = generate({ projectName: 'validated', targetDir, ...options });

  assert.equal(result.success, true, result.errors.join('\n'));
  return targetDir;
}

function writeResolvedProjectFacts(targetDir, planGoal = 'Ship the first verified slice. Literal placeholder syntax `{{...}}` may appear in explanatory text.') {
  writeRel(targetDir, 'docs/harness/PLAN.md', `# PLAN.md - Active Execution Plan

## Current Goal

${planGoal}

## Phase

Current: Build

## Success Criteria

- [ ] A user-visible slice is verified.

## Scope

Allowed write set:
- \`src/**\`

Forbidden:
- none

## Loaded Context

- \`docs/README.md\`

## Tasks

| # | Task | Owner | Verify | Status |
| --- | --- | --- | --- | --- |
| 1 | Verify slice | implementer | \`npm test\` | Verified |

## Parallel Dispatch

No parallel dispatch needed.

## Verification

| Check | Result | Notes |
| --- | --- | --- |
| \`npm test\` | Pass | includes literal \`{{...}}\` syntax documentation |
`);

  writeRel(targetDir, 'docs/research/PRD.md', `# PRD: validated

## Why

The project exists to validate the harness.

## Acceptance Criteria

- [ ] Strict validation ignores literal \`{{...}}\` syntax examples.
`);

  writeRel(targetDir, 'docs/research/research-results.md', `# validated - Research Results

## Final Decision

- **Architecture Style**: Modular monolith.
- **Core References**: Existing scaffold documentation.
`);

  writeRel(targetDir, 'docs/harness/architecture.md', `# Harness Architecture - validated

## 1. Layering Rules

The generated harness keeps project facts separate from implementation code.
`);

  writeRel(targetDir, 'docs/domain/ports.md', `# Port Contracts - validated

## 1. Port Classification

No project-specific ports are required for the first validation slice.

> **Note**: Use literal \`{{...}}\` text when explaining placeholder syntax.
`);
}

test('strict validation passes literal placeholder syntax and prints enforced project fact scope', () => {
  const targetDir = generateProject();
  writeResolvedProjectFacts(targetDir);

  const output = execFileSync(process.execPath, ['scripts/validate-harness.mjs', '--strict'], {
    cwd: targetDir,
    encoding: 'utf8',
  });

  assert.match(output, /Strict placeholder scope:/);
  for (const rel of projectFacts) {
    assert.match(output, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(output, /Harness validation passed \(strict\)/);
});

test('strict validation fails real unresolved template placeholders by token', () => {
  const targetDir = generateProject();
  writeResolvedProjectFacts(targetDir, '{{CURRENT_GOAL}}');

  const result = spawnSync(process.execPath, ['scripts/validate-harness.mjs', '--strict'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Strict placeholder scope:/);
  assert.match(output, /docs\/harness\/PLAN\.md/);
  assert.match(output, /\{\{CURRENT_GOAL\}\}/);
});

test('validation fails when required memory reflection files are missing', () => {
  const targetDir = generateProject();
  fs.rmSync(path.join(targetDir, 'memory', 'tool-usage-reflections.md'), { force: true });

  const result = spawnSync(process.execPath, ['scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /memory\/tool-usage-reflections\.md/);
});

test('validation fails when durable filesystem communication invariant is removed from core docs', () => {
  const targetDir = generateProject();
  const invariant = 'project files are the only durable communication channel';
  writeRel(
    targetDir,
    'docs/README.md',
    readRel(targetDir, 'docs/README.md').replace(invariant, 'project files are useful context'),
  );

  const result = spawnSync(process.execPath, ['scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /docs\/README\.md missing durable filesystem communication invariant/);
});

test('validation fails when optional web workflows lose stable selector requirements', () => {
  const targetDir = generateProject({ withOptions: ['browser-e2e,ts-react-frontend'] });
  writeRel(
    targetDir,
    'docs/workflows/browser-e2e.md',
    readRel(targetDir, 'docs/workflows/browser-e2e.md').replaceAll('data-testid', 'data-qa-id'),
  );

  const result = spawnSync(process.execPath, ['scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /docs\/workflows\/browser-e2e\.md missing stable UI selector contract/);
});
