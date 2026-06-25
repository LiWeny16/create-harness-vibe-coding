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

test('package README stays English and links to Chinese README', () => {
  const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.doesNotMatch(readme, /[\u3400-\u9fff]/);
  assert.match(readme, /Chinese README: \[README-CN\.md\]\(README-CN\.md\)/);
  assert.match(readme, /One Command/);
  assert.match(readme, /Your Agent Knows/);
  assert.match(readme, /npx create-harness-vibe-coding/);
  assert.match(readme, /Agent-link install/);
  assert.match(readme, /before editing, ask the Agent-link install intake questions/);
  assert.match(readme, /new project run the 0-1 bootstrap/i);
  assert.match(readme, /existing project or legacy architecture/i);
  assert.match(readme, /dry-run first/i);
  assert.match(readme, /follow Harness\/SETUP\.md/i);
  assert.match(readme, /https:\/\/github\.com\/zingspark\/create-harness-vibe-coding/);
  assert.match(readme, /new project run the 0-1 bootstrap/i);
  assert.match(readme, /existing project or legacy architecture/i);
  assert.match(readme, /dry-run first/i);
  assert.match(readme, /follow Harness\/SETUP\.md/i);
  assert.match(readme, /If a file already exists/);
  assert.match(readme, /The default is always \*\*preserve\*\*/);
});

test('package README-CN gives Chinese one-sentence universal install prompt', () => {
  const readmeCn = fs.readFileSync(path.join(process.cwd(), 'README-CN.md'), 'utf8');

  assert.match(readmeCn, /一条命令。搞定/);
  assert.match(readmeCn, /一句话交给你的 Agent/);
  assert.match(readmeCn, /不用读文档/);
  assert.match(readmeCn, /Agent-link 安装前置问题/);
  assert.match(readmeCn, /就两条路/);
  assert.match(readmeCn, /你能得到什么/);
  assert.match(readmeCn, /\/wf update/);
  assert.match(readmeCn, /验证/);
  assert.match(readmeCn, /https:\/\/github\.com\/zingspark\/create-harness-vibe-coding/);
  assert.match(readmeCn, /新项目走 0-1 bootstrap/);
  assert.match(readmeCn, /老项目或老架构升级先 dry-run/);
  assert.match(readmeCn, /只合并缺失的 Harness 规范/);
  assert.match(readmeCn, /遵循 Harness\/SETUP\.md/);
});

test('dry run reports existing project conflicts in the plan without writing files', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'legacy');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'CLAUDE.md'), 'legacy rules\n');

  const result = generate({ projectName: 'legacy', targetDir, dryRun: true });

  assert.equal(result.success, true);
  assert.ok(result.plan.conflict.includes('CLAUDE.md'));
  assert.ok(result.plan.create.includes('Harness/SETUP.md'));
  assert.equal(result.summary.created, result.plan.create.length);
  assert.equal(result.summary.conflicts, result.plan.conflict.length);
  assert.equal(fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8'), 'legacy rules\n');
  assert.equal(fs.existsSync(path.join(targetDir, 'SETUP.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, 'Harness', 'SETUP.md')), false);
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
  assert.match(result.errors.join('\n'), /CLAUDE\.md already exists/);
  assert.match(result.errors.join('\n'), /ask the user to confirm refactoring or merging/);
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
  assert.match(result.warnings.join('\n'), /CLAUDE\.md already exists/);
  assert.match(result.warnings.join('\n'), /confirm refactoring or merging/);
  assert.equal(fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8'), 'legacy rules\n');
  assert.ok(fs.existsSync(path.join(targetDir, 'Harness', 'PLAN.md')));
});

test('skip conflict policy warns that AGENTS.md needs user consent before merging', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'legacy-agents');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'AGENTS.md'), 'legacy agent entry\n');

  const result = generate({ projectName: 'legacy-agents', targetDir, onConflict: 'skip' });

  assert.equal(result.success, true);
  assert.ok(result.plan.skip.includes('AGENTS.md'));
  assert.match(result.warnings.join('\n'), /AGENTS\.md/);
  assert.match(result.warnings.join('\n'), /user consent/i);
  assert.equal(fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8'), 'legacy agent entry\n');
});

test('skip conflict policy warns when README.md development guidance is preserved', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'legacy-readme');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'README.md'), 'legacy development docs\n');

  const result = generate({ projectName: 'legacy-readme', targetDir, onConflict: 'skip' });

  assert.equal(result.success, true);
  assert.ok(result.plan.skip.includes('README.md'));
  assert.match(result.warnings.join('\n'), /README\.md/);
  assert.match(result.warnings.join('\n'), /build, test, and git conventions/);
});

test('skip conflict policy warns when optional workflow registrations need manual merge', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'legacy-harness-registration');
  fs.mkdirSync(path.join(targetDir, 'Harness'), { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'Harness', 'README.md'), 'legacy router\n');
  fs.writeFileSync(path.join(targetDir, 'Harness', 'MEMORY.md'), 'legacy memory\n');

  const result = generate({
    projectName: 'legacy-harness-registration',
    targetDir,
    onConflict: 'skip',
    withOptions: ['browser-e2e'],
  });

  assert.equal(result.success, true);
  assert.ok(result.plan.skip.includes('Harness/README.md'));
  assert.ok(result.plan.skip.includes('Harness/MEMORY.md'));
  assert.match(result.warnings.join('\n'), /Harness\/README\.md/);
  assert.match(result.warnings.join('\n'), /Harness\/MEMORY\.md/);
});

test('generated scaffold stores harness-owned payload under root Harness directory', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'harness-root');

  const result = generate({ projectName: 'harness-root', targetDir });

  assert.equal(result.success, true);

  for (const rel of [
    'README.md',
    'CLAUDE.md',
    'AGENTS.md',
    'Harness/README.md',
    'Harness/SETUP.md',
    'Harness/MEMORY.md',
    'Harness/PLAN.md',
    'Harness/WF.md',
    'Harness/subagents.md',
    'Harness/architecture.md',
    'Harness/dispatch.md',
    'Harness/context-loading.md',
    'Harness/agent-workflow.md',
    'Harness/scripts/validate-harness.mjs',
    'Harness/memory/tool-usage-reflections.md',
    'Harness/memory/user-corrections-preferences.md',
    'Harness/memory/agent-lessons-patterns.md',
    '.claude/skills/wf-mode/SKILL.md',
    '.claude/skills/subagent-orchestrator/SKILL.md',
    '.claude/skills/readme-optimizer/SKILL.md',
    '.claude/commands/wf.md',
  ]) {
    assert.ok(fs.existsSync(path.join(targetDir, ...rel.split('/'))), `Expected ${rel} to be generated`);
  }

  assert.equal(fs.existsSync(path.join(targetDir, 'SETUP.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, 'MEMORY.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, 'docs', 'README.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, 'docs', 'harness', 'PLAN.md')), false);

  const claude = readRel(targetDir, 'CLAUDE.md');
  assert.match(claude, /Harness\/README\.md/);
  assert.match(claude, /Harness\/MEMORY\.md/);
  assert.match(claude, /If `Harness\/` exists, this repository is governed by the Harness contract/);
  assert.match(claude, /Harness\/MEMORY\.md` is the memory\/resource router/);
  assert.match(claude, /Harness\/README\.md#Load By Task/);
  assert.match(claude, /Harness\/SETUP\.md` exists, follow it before normal project work/);
  assert.match(claude, /subagent-orchestrator` and `Harness\/subagents\.md/);
  assert.match(claude, /## 2\. Think Before Coding/);
  assert.match(claude, /## 3\. Simplicity First/);
  assert.match(claude, /## 4\. Surgical Changes/);
  assert.match(claude, /## 5\. Goal-Driven Execution/);
  assert.ok(claude.split(/\r?\n/).length <= 200);
  assert.match(claude, /No features beyond what was asked/);
  assert.match(claude, /No unrequested flexibility/);
  assert.match(claude, /Touch only files and lines required by the task/);
  assert.match(claude, /every changed line traceable to the user's request/);
  assert.match(claude, /verifiable success criteria/);
  assert.doesNotMatch(claude, /docs\/README\.md/);

  const rootReadme = readRel(targetDir, 'README.md');
  assert.match(rootReadme, /Development Commands/);
  assert.match(rootReadme, /Harness\/README\.md/);
  assert.match(rootReadme, /Follow `Harness\/SETUP\.md` before normal work while it exists/);
  assert.match(rootReadme, /Harness\/MEMORY\.md/);
  assert.match(rootReadme, /readme-optimizer/);

  const wf = readRel(targetDir, 'Harness/WF.md');
  assert.match(wf, /Ralph-style/i);
  assert.match(wf, /Heartbeat Protocol/);
  assert.match(wf, /Chrome DevTools|CDP|Playwright/);
  assert.match(wf, /Harness\/subagents\.md/);
  assert.match(wf, /WF mode requires multi-subagent orchestration by default/);
  assert.match(wf, /Explicit `\/wf`, `wf mode`, `workflow mode`, or `wk mode` MUST spawn at least 3 distinct subagents/);
  assert.match(wf, /\.claude\/agents\//);
  assert.match(wf, /7:3 collaboration bias/);

  const subagents = readRel(targetDir, 'Harness/subagents.md');
  assert.match(subagents, /## Source Attribution/);
  assert.match(subagents, /npx skills find/);
  assert.match(subagents, /superpowers:dispatching-parallel-agents/);
  assert.match(subagents, /superpowers:subagent-driven-development/);
  assert.match(subagents, /## Built-in Agent Roster/);
  assert.match(subagents, /## WF Default Fan-Out/);
  assert.match(subagents, /`planner`/);
  assert.match(subagents, /`architect`/);
  assert.match(subagents, /`test-writer`/);
  assert.doesNotMatch(subagents, /parallel explorer\/researcher/);
  assert.match(subagents, /## Efficiency Ladder/);
  assert.match(subagents, /## Review Gates/);

  const orchestratorSkill = readRel(targetDir, '.claude/skills/subagent-orchestrator/SKILL.md');
  assert.match(orchestratorSkill, /Harness\/subagents\.md/);
  assert.match(orchestratorSkill, /after wf-mode has been selected/);
  assert.match(orchestratorSkill, /update `Harness\/tasks\/<task-id>\/PLAN\.md#Subagent Dispatch`/);
  assert.match(orchestratorSkill, /\.claude\/agents\//);
  assert.match(orchestratorSkill, /Explicit WF\/WK mode requires at least 3 distinct agents/);
  assert.doesNotMatch(orchestratorSkill, /^description:.*repeated failures/m);

  const architecture = readRel(targetDir, 'Harness/architecture.md');
  assert.match(architecture, /## 2\. Interface Decoupling/);
  assert.match(architecture, /## 3\. State Design/);
  assert.match(architecture, /Avoid speculative abstraction/);

  const readmeSkill = readRel(targetDir, '.claude/skills/readme-optimizer/SKILL.md');
  assert.match(readmeSkill, /Preserve \+ append/);
  assert.match(readmeSkill, /Structure pass/);
  assert.match(readmeSkill, /Full rewrite/);
  assert.match(readmeSkill, /Mermaid or ASCII architecture diagrams/);

  const plan = readRel(targetDir, 'Harness/PLAN.md');
  assert.match(plan, /DEPRECATED/);
  assert.match(plan, /## Legacy Content/);
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

test('file at Harness parent path fails before writing partial scaffold for every conflict policy', () => {
  for (const policy of ['fail', 'skip', 'backup', 'overwrite']) {
    const root = tmpdir();
    const targetDir = path.join(root, `harness-parent-${policy}`);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'Harness'), 'not a directory\n');

    const result = generate({ projectName: `harness-parent-${policy}`, targetDir, onConflict: policy });

    assert.equal(result.success, false, policy);
    assert.match(result.errors.join('\n'), /Harness/);
    assert.equal(fs.readFileSync(path.join(targetDir, 'Harness'), 'utf8'), 'not a directory\n');
    assert.equal(fs.existsSync(path.join(targetDir, '.claude')), false, `${policy} should not write partial .claude output`);
    assert.equal(fs.existsSync(path.join(targetDir, 'CLAUDE.md')), false, `${policy} should not write partial root output`);
  }
});

test('generated plan has unique destination paths after Harness mapping', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'unique-destinations');

  const result = generate({
    projectName: 'unique-destinations',
    targetDir,
    dryRun: true,
    preset: 'fullstack',
    withOptions: ['ui-ux-review'],
  });

  assert.equal(result.success, true);

  const plannedFiles = [
    ...result.plan.create,
    ...result.plan.conflict,
    ...result.plan.skip,
    ...result.plan.backup,
    ...result.plan.overwrite,
  ];
  assert.equal(plannedFiles.length, new Set(plannedFiles).size);
});

test('skip conflict policy leaves directory at target file path untouched', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'skip-dir');
  fs.mkdirSync(path.join(targetDir, 'CLAUDE.md'), { recursive: true });

  const result = generate({ projectName: 'skip-dir', targetDir, onConflict: 'skip' });

  assert.equal(result.success, true);
  assert.ok(result.plan.skip.includes('CLAUDE.md'));
  assert.equal(fs.statSync(path.join(targetDir, 'CLAUDE.md')).isDirectory(), true);
  assert.ok(fs.existsSync(path.join(targetDir, 'Harness', 'SETUP.md')));
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
  const generatedMemoryFiles = [
    'Harness/memory/tool-usage-reflections.md',
    'Harness/memory/user-corrections-preferences.md',
    'Harness/memory/agent-lessons-patterns.md',
  ];
  const memoryRefs = [
    'memory/tool-usage-reflections.md',
    'memory/user-corrections-preferences.md',
    'memory/agent-lessons-patterns.md',
  ];

  for (const rel of generatedMemoryFiles) {
    assert.ok(fs.existsSync(path.join(targetDir, ...rel.split('/'))), `Expected ${rel} to be generated`);
  }

  const memoryIndex = readRel(targetDir, 'Harness/MEMORY.md');
  const docsReadme = readRel(targetDir, 'Harness/README.md');
  const setup = readRel(targetDir, 'Harness/SETUP.md');
  const claude = readRel(targetDir, 'CLAUDE.md');
  const routerSkill = readRel(targetDir, '.claude/skills/harness-router/SKILL.md');
  const wfSkill = readRel(targetDir, '.claude/skills/wf-mode/SKILL.md');

  for (const rel of memoryRefs) {
    assert.match(memoryIndex, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(docsReadme, /Harness\/memory\/tool-usage-reflections\.md/);
  assert.match(docsReadme, /subagents\.md/);
  assert.match(docsReadme, /README optimization/);
  assert.match(docsReadme, /readme-optimizer/);
  assert.match(docsReadme, /Routing priority/);
  assert.match(docsReadme, /wk mode/);
  assert.match(docsReadme, /\| Need WF mode[^\n]*\[WF\.md\]\(WF\.md\), \[PROGRESS\.md\]\(PROGRESS\.md\)[^\n]*explicit WF\/WK loads subagent docs immediately/);
  assert.doesNotMatch(docsReadme, /\| Need WF mode[^\n]*subagents\.md/);
  assert.match(routerSkill, /routes to `wf-mode` first/);
  assert.match(routerSkill, /`\/wf`, `wf mode`, `workflow mode`, `wk mode`/);
  assert.match(routerSkill, /Let `wf-mode` decide when to load subagent docs/);
  assert.match(wfSkill, /only when coordinating subagents or bounded role passes/);
  assert.match(memoryIndex, /subagent-orchestrator/);
  assert.match(memoryIndex, /readme-optimizer/);
  assert.match(memoryIndex, /subagents\.md/);
  assert.match(setup, /memory\//);
  assert.match(setup, /Agent-Link Install Intake/);
  assert.match(setup, /Ask at most three blocking questions up front/);
  assert.match(setup, /Root agent entry/);
  assert.match(setup, /Harness location/);
  assert.match(setup, /README ownership/);
  assert.match(setup, /README optimization/);
  assert.match(setup, /readme-optimizer/);
  assert.match(setup, /ECC, Superpowers, custom rules/);
  assert.match(setup, /Install 1-2 relevant skills only after user approval/);
  assert.match(setup, /Memory\/privacy/);
  assert.match(setup, /Branch\/worktree/);
  assert.match(setup, /Package manager\/stack/);
  assert.match(setup, /Document existing commands first/);
  assert.match(setup, /add CI\/CD only after user approval/);
  assert.match(claude, /same tool\/use pattern fails 3\+ times/);
  assert.match(claude, /user corrects the same assumption\/pattern 2\+ times/);
});

test('core docs declare project files as the durable communication channel', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'durable-docs');

  const result = generate({ projectName: 'durable-docs', targetDir });

  assert.equal(result.success, true);
  for (const rel of ['Harness/README.md', 'Harness/subagents.md', 'Harness/dispatch.md', 'Harness/context-loading.md']) {
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

  const browserWorkflow = readRel(targetDir, 'Harness/workflows/browser-e2e.md');
  const reactWorkflow = readRel(targetDir, 'Harness/workflows/ts-react-frontend.md');
  const featureTemplate = readRel(targetDir, 'Harness/features/_template.md');

  for (const body of [browserWorkflow, reactWorkflow]) {
    assert.match(body, /data-testid/);
    assert.match(body, /accessible labels\/roles/);
    assert.match(body, /inputs, buttons, filters, rows, empty\/error\/loading states/);
  }

  assert.match(featureTemplate, /UI Automation Hooks/);
  assert.match(featureTemplate, /data-testid/);
  assert.match(featureTemplate, /critical UI controls and states/);
});

test('generated optional workflows are registered under Harness workflows', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'harness-web-contracts');

  const result = generate({
    projectName: 'harness-web-contracts',
    targetDir,
    preset: 'web-app',
  });

  assert.equal(result.success, true);

  const harnessReadme = readRel(targetDir, 'Harness/README.md');
  const memoryIndex = readRel(targetDir, 'Harness/MEMORY.md');
  const browserSkill = readRel(targetDir, '.claude/skills/browser-e2e/SKILL.md');

  for (const rel of [
    'Harness/workflows/browser-e2e.md',
    'Harness/workflows/ts-react-frontend.md',
    'Harness/workflows/ui-ux-review.md',
  ]) {
    assert.ok(fs.existsSync(path.join(targetDir, ...rel.split('/'))), `Expected ${rel} to be generated`);
  }

  assert.match(harnessReadme, /\]\(workflows\/browser-e2e\.md\)/);
  assert.match(memoryIndex, /workflows\/browser-e2e\.md/);
  assert.match(browserSkill, /Harness\/workflows\/browser-e2e\.md/);
  assert.equal(fs.existsSync(path.join(targetDir, 'docs', 'workflows', 'browser-e2e.md')), false);
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

  const browserWorkflow = readRel(targetDir, 'Harness/workflows/browser-e2e.md');

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
