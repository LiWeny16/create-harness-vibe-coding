import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { generate } from '../src/generator.js';

const projectFacts = [
  'Harness/PROGRESS.md',
  'Harness/research/PRD.md',
  'Harness/research/research-results.md',
  'Harness/project/architecture.md',
  'Harness/project/architecture.md',
];

const tempRoots = [];
function tmpdir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-validator-'));
  tempRoots.push(root);
  return root;
}
after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

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
  writeRel(targetDir, 'Harness/PROGRESS.md', `# PROGRESS.md

Global task index.

## Active Task

None

## Task Index

| ID | Goal | Phase | Closed |
|----|------|-------|--------|

## Cross-Task Decisions

${planGoal}
`);

  writeRel(targetDir, 'Harness/research/PRD.md', `# PRD: validated

## Why

The project exists to validate the harness.

## Acceptance Criteria

- [ ] Strict validation ignores literal \`{{...}}\` syntax examples.
`);

  writeRel(targetDir, 'Harness/research/research-results.md', `# validated - Research Results

## Final Decision

- **Architecture Style**: Modular monolith.
- **Core References**: Existing scaffold documentation.
`);

  writeRel(targetDir, 'Harness/project/architecture.md', `# Harness Architecture - validated

## 1. Layering Rules

The generated harness keeps project facts separate from implementation code.

## 2. Interface Decoupling

Use ports only for real boundaries.

## 3. State Design

State has one owner and explicit recovery behavior.

Avoid speculative abstraction unless there is a concrete second use or testability need.

## 4. Port Classification

No project-specific ports are required for the first validation slice.

> **Note**: Use literal \`{{...}}\` text when explaining placeholder syntax.
`);
}

test('strict validation passes literal placeholder syntax and prints enforced project fact scope', () => {
  const targetDir = generateProject();
  writeResolvedProjectFacts(targetDir);

  const output = execFileSync(process.execPath, ['Harness/scripts/validate-harness.mjs', '--strict'], {
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

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs', '--strict'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Strict placeholder scope:/);
  assert.match(output, /Harness\/PROGRESS\.md/);
  assert.match(output, /\{\{CURRENT_GOAL\}\}/);
});

test('validation fails when required memory reflection files are missing', () => {
  const targetDir = generateProject();
  fs.rmSync(path.join(targetDir, 'Harness', 'memory', 'tool-usage-reflections.md'), { force: true });

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
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
    'Harness/README.md',
    readRel(targetDir, 'Harness/README.md').replace(invariant, 'project files are useful context'),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Harness\/README\.md missing durable filesystem communication invariant/);
});

test('validation fails when WF complete role chain contract is removed', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/workflows/WF.md',
    readRel(targetDir, 'Harness/specs/workflows/WF.md').replace('Orchestration Loop', 'WF mode may use one or more passes'),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Harness\/specs\/workflows\/WF\.md missing WF orchestration loop/);
});

test('validation fails when compact task record guidance is removed', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/tasks/_template/PLAN.md',
    readRel(targetDir, 'Harness/tasks/_template/PLAN.md').replace('Compact task record', 'Verbose task record'),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Harness\/tasks\/_template\/PLAN\.md missing compact task PLAN template/);
});

test('validation fails when cache-first context contract is removed', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/runtime/context-loading.md',
    readRel(targetDir, 'Harness/specs/runtime/context-loading.md').replace('Cache-First Context Contract', 'Context Loading Contract'),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Harness\/specs\/runtime\/context-loading\.md missing cache-first context contract/);
});

test('validation fails when real cache telemetry boundary is removed', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/runtime/context-loading.md',
    readRel(targetDir, 'Harness/specs/runtime/context-loading.md').replace('Do not claim real cache hits', 'Claim cache hits'),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Harness\/specs\/runtime\/context-loading\.md missing real cache telemetry boundary/);
});

test('validation fails when L2 telemetry claim gate is removed', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/scripts/l2-cache-telemetry.mjs',
    readRel(targetDir, 'Harness/scripts/l2-cache-telemetry.mjs').replaceAll('claimGate', 'claimDoor'),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Harness\/scripts\/l2-cache-telemetry\.mjs missing L2 telemetry claim gate/);
});

test('validation fails when workflow skill cache discipline is removed', () => {
  const targetDir = generateProject();
  for (const rel of ['.claude/skills/wf/SKILL.md', '.agents/skills/wf/SKILL.md']) {
    writeRel(
      targetDir,
      rel,
      readRel(targetDir, rel).replace('## Cache Discipline', '## Context Discipline'),
    );
  }

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /\.claude\/skills\/wf\/SKILL\.md missing wf skill cache discipline/);
});

test('validation fails when WF task-id naming convention is removed', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/workflows/WF.md',
    readRel(targetDir, 'Harness/specs/workflows/WF.md').replace('`task-<verb>-<noun>[-detail]`', '`work-<verb>-<noun>`'),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Harness\/specs\/workflows\/WF\.md missing WF task-id naming convention/);
});

test('validation fails when WF-MAX useful-degrade source-edit boundary is removed', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/workflows/WF-MAX.md',
    readRel(targetDir, 'Harness/specs/workflows/WF-MAX.md').replace('This does not authorize CEO source edits', 'CEO may edit directly'),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Harness\/specs\/workflows\/WF-MAX\.md missing WF-MAX useful-degrade CEO source-edit boundary/);
});

test('validation fails when WF-AUTO bounded tick auto capsule rule is removed', () => {
  const targetDir = generateProject();
  for (const rel of ['.claude/skills/wf-auto/SKILL.md', '.agents/skills/wf-auto/SKILL.md']) {
    writeRel(
      targetDir,
      rel,
      readRel(targetDir, rel).replace('missing auto capsule evidence', 'missing evidence'),
    );
  }

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /\.claude\/skills\/wf-auto\/SKILL\.md missing wf-auto skill missing auto capsule failure rule/);
});

test('validation fails when OpenCode workflow wrapper cache-first routing is removed', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    '.opencode/commands/wf.md',
    readRel(targetDir, '.opencode/commands/wf.md').replace(
      'Cache-First Context Contract',
      'Context Loading Contract',
    ),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /\.opencode\/commands\/wf\.md missing OpenCode wf cache-first routing/);
});

test('validation fails when wf-update direct command loses safe-apply flow', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    '.claude/commands/wf-update.md',
    readRel(targetDir, '.claude/commands/wf-update.md').replace('--apply-safe', '--legacy-apply'),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /\.claude\/commands\/wf-update\.md missing .*apply-safe command/);
});

test('validation fails when wf-update direct command loses release highlights reporting', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    '.claude/commands/wf-update.md',
    readRel(targetDir, '.claude/commands/wf-update.md').replaceAll('agent.releaseHighlights', 'agent.fileCounts'),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /\.claude\/commands\/wf-update\.md missing .*release highlights summary/);
});

test('validation fails when ECC direct command exemption is removed', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    '.claude/rules/ecc/common.md',
    readRel(targetDir, '.claude/rules/ecc/common.md').replace(', excluding `/wf-help` and `/wf-update`', ''),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /\.claude\/rules\/ecc\/common\.md missing ECC direct command exemption/);
});

test('validation fails when a frameworkOwned manifest file is missing', () => {
  const targetDir = generateProject();
  fs.rmSync(path.join(targetDir, 'Harness', 'scripts', 'context-budget.mjs'));

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /ownership manifest frameworkOwned file missing: Harness\/scripts\/context-budget\.mjs/);
});

test('validation fails when low-noise progress guidance is removed', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'CLAUDE.md',
    readRel(targetDir, 'CLAUDE.md').replace('## 5a. Low-Noise Progress', '## 5a. Verbose Progress'),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /CLAUDE\.md missing low-noise progress section/);
});

test('validation fails when user-facing language match rule is removed', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'CLAUDE.md',
    readRel(targetDir, 'CLAUDE.md').replace(
      "Match the user's language for all user-facing prose",
      'Choose response language freely',
    ),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /CLAUDE\.md missing user-facing language match rule/);
});

test('validation fails when optional web workflows lose stable selector requirements', () => {
  const targetDir = generateProject({ withOptions: ['browser-e2e,ts-react-frontend'] });
  writeRel(
    targetDir,
    'Harness/workflows/browser-e2e.md',
    readRel(targetDir, 'Harness/workflows/browser-e2e.md').replaceAll('data-testid', 'data-qa-id'),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Harness\/workflows\/browser-e2e\.md missing stable UI selector contract/);
});

test('validation passes when an optional workflow file is not installed', () => {
  const targetDir = generateProject({ withOptions: ['browser-e2e'] });
  fs.rmSync(path.join(targetDir, 'Harness', 'workflows', 'browser-e2e.md'), { force: true });

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0);
  assert.match(output, /Harness validation passed/);
});

test('validation fails when a registered optional skill file is missing', () => {
  const targetDir = generateProject({ withOptions: ['browser-e2e'] });
  fs.rmSync(path.join(targetDir, '.claude', 'skills', 'browser-e2e'), { recursive: true, force: true });

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /registered skill file is missing: \.claude\/skills\/browser-e2e\/SKILL\.md/);
});

test('AC-004 validation fails when command docs list a missing skill command', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    '.claude/commands/wf-help.md',
    `${readRel(targetDir, '.claude/commands/wf-help.md')}\n| \`/wf-ghost <task>\` | workflow skill | \`/wf-ghost test\` | Missing command. |\n`,
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /command docs list missing Claude skill: \/wf-ghost -> \.claude\/skills\/wf-ghost\/SKILL\.md/);
  assert.match(output, /command docs list missing Codex skill: \/wf-ghost -> \.agents\/skills\/wf-ghost\/SKILL\.md/);
});

test('validation fails when stale eight-angle exhaustion rule is present in WF-AUTO.md', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/workflows/WF-AUTO.md',
    readRel(targetDir, 'Harness/specs/workflows/WF-AUTO.md') + '\nAll 8 exhausted.\n',
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /stale eight-angle exhaustion rule/);
});

test('validation fails when stale three-consecutive-all-exhausted stop rule is present in WF-AUTO.md', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/workflows/WF-AUTO.md',
    readRel(targetDir, 'Harness/specs/workflows/WF-AUTO.md') + '\n3 consecutive all-exhausted rounds.\n',
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /stale three-consecutive-all-exhausted stop rule/);
});

test('validation fails when stale 8-Angle Exhaustion Gate name is present in WF-AUTO.md', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/workflows/WF-AUTO.md',
    readRel(targetDir, 'Harness/specs/workflows/WF-AUTO.md').replace(
      'Adaptive Coverage Exhaustion Gate',
      '8-Angle Exhaustion Gate',
    ),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /stale eight-angle exhaustion gate name/);
});

test('validation fails when stale eight-spark fixed-count search is present in WF-AUTO-SPARK.md', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/workflows/WF-AUTO-SPARK.md',
    readRel(targetDir, 'Harness/specs/workflows/WF-AUTO-SPARK.md').replace(
      'parallel external searches',
      '8 parallel external searches',
    ),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /stale eight-spark fixed-count search/);
});

test('validation fails when wf-auto-spark task-scribe recorder delegation is missing', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/workflows/WF-AUTO-SPARK.md',
    readRel(targetDir, 'Harness/specs/workflows/WF-AUTO-SPARK.md').replaceAll(
      'task-scribe formats task-state writes',
      'CEO writes task-state files directly',
    ),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /wf-auto-spark task-scribe recorder delegation/);
});

test('validation passes when WF-AUTO.md uses adaptive coverage contract exclusively', () => {
  const targetDir = generateProject();

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0);
  assert.match(output, /Harness validation passed/);
  // Must contain the adaptive contract
  const wfAuto = readRel(targetDir, 'Harness/specs/workflows/WF-AUTO.md');
  assert.match(wfAuto, /Adaptive Coverage Exhaustion Gate/);
  assert.match(wfAuto, /dynamic high-risk obligations/);
  assert.match(wfAuto, /two different confirmation strategies/);
  assert.doesNotMatch(wfAuto, /All 8 exhausted/);
  assert.doesNotMatch(wfAuto, /3 consecutive all-exhausted rounds/);
  assert.doesNotMatch(wfAuto, /8-Angle Exhaustion Gate/);
});

test('validation passes when WF-AUTO-SPARK.md uses non-fixed-count spark search', () => {
  const targetDir = generateProject();

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0);
  const wfAutoSpark = readRel(targetDir, 'Harness/specs/workflows/WF-AUTO-SPARK.md');
  assert.doesNotMatch(wfAutoSpark, /8 parallel external searches/);
  assert.match(wfAutoSpark, /parallel external searches/);
  assert.match(wfAutoSpark, /task-scribe formats task-state writes/);
  assert.match(wfAutoSpark, /searchFallback: ceo-direct/);
  assert.match(wfAutoSpark, /pre-implementation triage/);
  assert.match(wfAutoSpark, /Literal anti-pattern matching/);
  assert.match(wfAutoSpark, /node scripts\/build-version\.mjs --check/);
});

test('validation fails when old default complete-role-chain contract returns to a hot-path doc', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/runtime/dispatch.md',
    `${readRel(targetDir, 'Harness/specs/runtime/dispatch.md')}\n- /wf requires the complete role chain by default.\n`,
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /old \/wf default complete-role-chain contract/);
});

test('validation fails when old unconditional wf-max fan-out contract returns to a hot-path doc', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/workflows/WF-AUTO.md',
    readRel(targetDir, 'Harness/specs/workflows/WF-AUTO.md').replace(
      'does not inherit WF-MAX fan-out modes (Useful or Strict)',
      'does not inherit WF-MAX mandatory maximum fan-out',
    ),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /old \/wf-max unconditional fan-out contract/);
});

test('validation fails when CLAUDE.md references Harness/specs/guides/SETUP.md', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'CLAUDE.md',
    `${readRel(targetDir, 'CLAUDE.md')}\nIf setup is needed, route normal work through Harness/specs/guides/SETUP.md.\n`,
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /CLAUDE\.md contains forbidden CLAUDE\.md SETUP reference/);
});

test('validation fails when SETUP.md requires CLAUDE.md to reference SETUP.md', () => {
  const targetDir = generateProject();
  writeRel(
    targetDir,
    'Harness/specs/guides/SETUP.md',
    readRel(targetDir, 'Harness/specs/guides/SETUP.md').replace(
      'no startup dependency on this setup reference',
      'with the `Harness/specs/guides/SETUP.md` bootstrap contract line',
    ),
  );

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /SETUP startup boundary/);
  assert.match(output, /stale SETUP-to-CLAUDE bootstrap contract/);
});

test('validation fails when an OpenCode workflow command wrapper is missing', () => {
  const targetDir = generateProject();
  fs.rmSync(path.join(targetDir, '.opencode', 'commands', 'wf-max.md'), { force: true });

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /missing required file: \.opencode\/commands\/wf-max\.md/);
});

test('validation fails when old unconditional wf-max acceptance wording returns to the skill adapter', () => {
  const targetDir = generateProject();
  const body = `${readRel(targetDir, '.claude/skills/wf-max/SKILL.md')}\n- Final acceptance requires verifier evidence, cross-review, and reflector PASS.\n`;
  writeRel(targetDir, '.claude/skills/wf-max/SKILL.md', body);
  writeRel(targetDir, '.agents/skills/wf-max/SKILL.md', body);

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /old wf-max unconditional final acceptance/);
});

test('validation fails when an OpenCode agent body drifts from its .claude source', () => {
  const targetDir = generateProject();
  const rel = '.opencode/agents/planner.md';
  writeRel(targetDir, rel, `${readRel(targetDir, rel)}\nOpenCode-only extra rule.\n`);

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /\.opencode\/agents\/planner\.md body must mirror \.claude\/agents\/planner\.md/);
});

test('validation fails when the OpenCode wf-help body drifts from the .claude source', () => {
  const targetDir = generateProject();
  const rel = '.opencode/commands/wf-help.md';
  writeRel(targetDir, rel, `${readRel(targetDir, rel)}\nOpenCode-only footer line.\n`);

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /\.opencode\/commands\/wf-help\.md body must mirror \.claude\/commands\/wf-help\.md/);
});

test('strict validation fails when Harness/tasks exceeds the outer task capsule cap', () => {
  const targetDir = generateProject();
  writeResolvedProjectFacts(targetDir);
  for (let i = 1; i <= 6; i += 1) {
    const dir = path.join(targetDir, 'Harness', 'tasks', `task-test-capsule-${i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '# PROGRESS\n\n## Phase\n\nCurrent: Build\n', 'utf8');
  }

  const strictResult = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs', '--strict'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const strictOutput = `${strictResult.stdout}\n${strictResult.stderr}`;
  assert.notEqual(strictResult.status, 0);
  assert.match(strictOutput, /outer task capsules \(cap 5\)/);

  const result = spawnSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0);
  assert.match(output, /outer task capsules \(cap 5\)/);
});
