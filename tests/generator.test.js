import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generate, getOptionalCatalog, harnessDest } from '../src/generator.js';

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
  assert.match(readme, /Read and follow https:\/\/github\.com\/zingspark\/create-harness-vibe-coding exactly/);
  assert.doesNotMatch(readme, /before editing, scan the project root and ask the Agent-link install intake questions/);
  assert.match(readme, /Install or Upgrade Path/);
  assert.match(readme, /scan the project root/i);
  assert.match(readme, /Existing `Harness\/`/i);
  assert.match(readme, /optional capabilities/i);
  assert.match(readme, /Superpowers/);
  assert.match(readme, /https:\/\/github\.com\/obra\/Superpowers/);
  assert.match(readme, /https:\/\/github\.com\/JuliusBrussee\/caveman/);
  assert.match(readme, /https:\/\/github\.com\/lingzhi227\/agent-research-skills/);
  assert.match(readme, /https:\/\/github\.com\/colbymchenry\/codegraph/);
  assert.match(readme, /code graph/i);
  assert.match(readme, /Empty or new project/i);
  assert.match(readme, /Legacy architecture or older project docs/i);
  assert.match(readme, /dry-run first/i);
  assert.match(readme, /Harness\/SETUP\.md/i);
  assert.match(readme, /https:\/\/github\.com\/zingspark\/create-harness-vibe-coding/);
  assert.match(readme, /already-installed skills\/plugins\/rules/i);
  assert.match(readme, /If a file already exists/);
  assert.match(readme, /The default is always \*\*preserve\*\*/);
});

test('template source stores harness docs under templates/common/Harness instead of docs', () => {
  assert.equal(fs.existsSync(path.join(process.cwd(), 'templates', 'common', 'docs')), false);
  assert.ok(fs.existsSync(path.join(process.cwd(), 'templates', 'common', 'Harness', 'README.md')));
  assert.ok(fs.existsSync(path.join(process.cwd(), 'templates', 'common', 'Harness', 'WF.md')));
  assert.ok(fs.existsSync(path.join(process.cwd(), 'templates', 'common', 'Harness', 'tasks', '_template', 'PLAN.md')));

  assert.equal(fs.existsSync(path.join(process.cwd(), 'templates', 'optional', 'skills', 'browser-e2e', 'docs')), false);
  assert.ok(fs.existsSync(path.join(process.cwd(), 'templates', 'optional', 'skills', 'browser-e2e', 'Harness', 'workflows', 'browser-e2e.md')));
});

test('optional catalog includes recommendation-only external capability choices', () => {
  const catalog = getOptionalCatalog();
  const ids = catalog.externalRecommendations.map(item => item.id);

  assert.ok(ids.includes('superpowers'));
  assert.ok(ids.includes('caveman'));
  assert.ok(ids.includes('agent-research'));
  assert.ok(ids.includes('codegraph'));
  for (const item of catalog.externalRecommendations) {
    assert.equal(item.installMode, 'recommend-only');
    assert.equal(item.files, undefined);
    assert.match(item.url, /^https:\/\/github\.com\//);
    assert.equal(item.installHint, undefined);
  }
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
  assert.ok(fs.existsSync(path.join(targetDir, 'Harness', 'PROGRESS.md')));
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
    'Harness/PROGRESS.md',
    'Harness/WF.md',
    'Harness/subagents.md',
    'Harness/architecture.md',
    'Harness/dispatch.md',
    'Harness/context-loading.md',
    'Harness/agent-workflow.md',
    'Harness/scripts/validate-harness.mjs',
    'Harness/scripts/wf-update-check.mjs',
    'Harness/scripts/wf-remove.mjs',
    'Harness/scripts/scan-clean.mjs',
    'Harness/memory/tool-usage-reflections.md',
    'Harness/memory/user-corrections-preferences.md',
    'Harness/memory/agent-lessons-patterns.md',
    '.codex/config.toml',
    '.codex/hooks.json',
    '.claude/skills/wf/SKILL.md',
    '.agents/skills/wf/SKILL.md',
    '.claude/skills/wf-max/SKILL.md',
    '.agents/skills/wf-max/SKILL.md',
    '.claude/skills/wf-update/SKILL.md',
    '.agents/skills/wf-update/SKILL.md',
    '.claude/skills/wf-readme/SKILL.md',
    '.agents/skills/wf-readme/SKILL.md',
    '.claude/skills/subagent-orchestrator/SKILL.md',
    '.agents/skills/subagent-orchestrator/SKILL.md',
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
  assert.match(rootReadme, /wf-readme/);
  assert.match(rootReadme, /Codex/);
  assert.match(rootReadme, /\.agents\/skills/);
  assert.match(rootReadme, /\.codex\/hooks\.json/);
  assert.doesNotMatch(rootReadme, /commands\/wf\.toml/);

  const wf = readRel(targetDir, 'Harness/WF.md');
  assert.match(wf, /Ralph-style/i);
  assert.match(wf, /Heartbeat Protocol/);
  assert.match(wf, /Chrome DevTools|CDP|Playwright/);
  assert.match(wf, /Harness\/subagents\.md/);
  assert.match(wf, /WF mode requires multi-subagent orchestration by default/);
  assert.match(wf, /Explicit `\/wf`, `\$wf`, `wf mode`, `workflow mode`, or `wk mode` MUST use at least 3 distinct role passes/);
  assert.match(wf, /\.claude\/agents\//);
  assert.match(wf, /replaces the old "7:3" heuristic/);

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
  assert.match(orchestratorSkill, /runtime-neutral/);
  assert.match(orchestratorSkill, /bounded passes/);
  assert.match(orchestratorSkill, /\.claude\/agents\//);
  assert.match(orchestratorSkill, /at least three distinct role passes/);
  assert.doesNotMatch(orchestratorSkill, /^description:.*repeated failures/m);
  assert.equal(
    readRel(targetDir, '.agents/skills/subagent-orchestrator/SKILL.md'),
    orchestratorSkill,
  );

  const architecture = readRel(targetDir, 'Harness/architecture.md');
  assert.match(architecture, /## 2\. Interface Decoupling/);
  assert.match(architecture, /## 3\. State Design/);
  assert.match(architecture, /Avoid speculative abstraction/);

  const readmeSkill = readRel(targetDir, '.claude/skills/wf-readme/SKILL.md');
  assert.match(readmeSkill, /Preserve \+ append/);
  assert.match(readmeSkill, /Structure pass/);
  assert.match(readmeSkill, /Full rewrite/);
  assert.match(readmeSkill, /Mermaid or ASCII architecture diagrams/);

  const plan = readRel(targetDir, 'Harness/PROGRESS.md');
  assert.match(plan, /## Active Task/);
  assert.match(plan, /## Task Index/);
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
  assert.ok(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'browser-e2e', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'browser-e2e', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'ui-ux-review', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'ui-ux-review', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'python-backend', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'python-backend', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'github-pr-review', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'github-pr-review', 'SKILL.md')), false);
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
  assert.ok(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'python-backend', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'python-backend', 'SKILL.md')), false);
});

test('package README-CN gives Chinese install prompt and Harness-only docs contract', () => {
  const readmeCn = fs.readFileSync(path.join(process.cwd(), 'README-CN.md'), 'utf8');
  assert.doesNotMatch(readmeCn, /涓€/);
  assert.doesNotMatch(readmeCn, /鏂伴/);
  assert.match(readmeCn, /一条命令/);
  assert.match(readmeCn, /一句话交给 Agent/);
  assert.match(readmeCn, /完整阅读并严格遵循/);
  assert.match(readmeCn, /安装或升级路径/);
  assert.match(readmeCn, /扫描根目录/);
  assert.match(readmeCn, /已有 `Harness\/`/);
  assert.match(readmeCn, /Agent-link 安装前置问题/);
  assert.match(readmeCn, /不要把 Harness 文件放进 `docs\/`/);
  assert.match(readmeCn, /--recommend superpowers,codegraph/);
  assert.match(readmeCn, /https:\/\/github\.com\/obra\/Superpowers/);
  assert.match(readmeCn, /https:\/\/github\.com\/JuliusBrussee\/caveman/);
  assert.match(readmeCn, /https:\/\/github\.com\/lingzhi227\/agent-research-skills/);
  assert.match(readmeCn, /https:\/\/github\.com\/colbymchenry\/codegraph/);
  assert.match(readmeCn, /外部建议只写入 `Harness\/SETUP\.md`/);
  assert.match(readmeCn, /不是已安装 Harness 的同步更新器/);
  assert.match(readmeCn, /验证/);
  assert.match(readmeCn, /https:\/\/github\.com\/zingspark\/create-harness-vibe-coding/);
  assert.match(readmeCn, /空项目或新项目/);
  assert.match(readmeCn, /老项目或老架构迁移/);
  assert.match(readmeCn, /只合并缺失的 Harness 指南/);
  assert.match(readmeCn, /遵循 `Harness\/SETUP\.md`/);
  assert.match(readmeCn, /\.agents\/skills/);
  assert.match(readmeCn, /\$wf/);
  assert.doesNotMatch(readmeCn, /commands\/wf\.toml/);
});

test('package README-CN contains required Chinese install contract clauses', () => {
  const readmeCn = fs.readFileSync(path.join(process.cwd(), 'README-CN.md'), 'utf8');

  assert.match(readmeCn, /\u4e00\u6761\u547d\u4ee4/u);
  assert.match(readmeCn, /\u4e00\u53e5\u8bdd\u4ea4\u7ed9 Agent/u);
  assert.match(readmeCn, /\u5b8c\u6574\u9605\u8bfb\u5e76\u4e25\u683c\u9075\u5faa/u);
  assert.match(readmeCn, /\u5b89\u88c5\u6216\u5347\u7ea7\u8def\u5f84/u);
  assert.match(readmeCn, /\u626b\u63cf\u6839\u76ee\u5f55/u);
  assert.match(readmeCn, /\u5df2\u6709 `Harness\/`/u);
  assert.match(readmeCn, /Agent-link \u5b89\u88c5\u524d\u7f6e\u95ee\u9898/u);
  assert.match(readmeCn, /\u4e0d\u8981\u628a Harness \u6587\u4ef6\u653e\u8fdb `docs\/`/u);
  assert.match(readmeCn, /--recommend superpowers,codegraph/);
  assert.match(readmeCn, /https:\/\/github\.com\/obra\/Superpowers/);
  assert.match(readmeCn, /https:\/\/github\.com\/JuliusBrussee\/caveman/);
  assert.match(readmeCn, /https:\/\/github\.com\/lingzhi227\/agent-research-skills/);
  assert.match(readmeCn, /https:\/\/github\.com\/colbymchenry\/codegraph/);
  assert.match(readmeCn, /\u5916\u90e8\u5efa\u8bae\u53ea\u5199\u5165 `Harness\/SETUP\.md`/u);
  assert.match(readmeCn, /\u4e0d\u662f\u5df2\u5b89\u88c5 Harness \u7684\u540c\u6b65\u66f4\u65b0\u5668/u);
  assert.match(readmeCn, /\u9a8c\u8bc1/u);
  assert.match(readmeCn, /https:\/\/github\.com\/zingspark\/create-harness-vibe-coding/);
  assert.match(readmeCn, /\u7a7a\u9879\u76ee\u6216\u65b0\u9879\u76ee/u);
  assert.match(readmeCn, /\u8001\u9879\u76ee\u6216\u8001\u67b6\u6784\u8fc1\u79fb/u);
  assert.match(readmeCn, /\u53ea\u5408\u5e76\u7f3a\u5931\u7684 Harness \u6307\u5357/u);
  assert.match(readmeCn, /\u9075\u5faa `Harness\/SETUP\.md`/u);
});

test('external recommendations are recorded without installing third-party skills', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'external-recommendations');

  const result = generate({
    projectName: 'external-recommendations',
    targetDir,
    externalOptions: ['superpowers,codegraph'],
  });

  assert.equal(result.success, true);

  const setup = readRel(targetDir, 'Harness/SETUP.md');
  assert.match(setup, /Selected External Recommendations/);
  assert.match(setup, /superpowers/);
  assert.match(setup, /codegraph/);
  assert.match(setup, /https:\/\/github\.com\/obra\/Superpowers/);
  assert.match(setup, /https:\/\/github\.com\/colbymchenry\/codegraph/);
  assert.match(setup, /recommendation only/i);
  assert.doesNotMatch(setup, /install hint/i);
  assert.equal(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'superpowers', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'superpowers', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'codegraph', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'codegraph', 'SKILL.md')), false);

  const harnessVersion = JSON.parse(readRel(targetDir, 'Harness/.harness-version'));
  assert.deepEqual(harnessVersion.externalRecommendations, ['superpowers', 'codegraph']);
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
  const wfUpdateSkill = readRel(targetDir, '.claude/skills/wf-update/SKILL.md');

  for (const rel of memoryRefs) {
    assert.match(memoryIndex, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(docsReadme, /Harness\/memory\/tool-usage-reflections\.md/);
  assert.match(docsReadme, /subagents\.md/);
  assert.match(docsReadme, /README optimization/);
  assert.match(docsReadme, /wf-readme/);
  assert.match(docsReadme, /Routing priority/);
  assert.match(docsReadme, /wk mode/);
  assert.match(docsReadme, /\| Need WF mode[^\n]*\[WF\.md\]\(WF\.md\), \[PROGRESS\.md\]\(PROGRESS\.md\)[^\n]*explicit WF\/WK loads subagent docs immediately/);
  assert.doesNotMatch(docsReadme, /\| Need WF mode[^\n]*subagents\.md/);
  assert.match(wfUpdateSkill, /wf-update-check\.mjs/);
  assert.match(wfUpdateSkill, /scan-clean\.mjs/);
  assert.match(memoryIndex, /subagent-orchestrator/);
  assert.match(memoryIndex, /wf-readme/);
  assert.match(memoryIndex, /subagents\.md/);
  assert.match(setup, /memory\//);
  assert.match(setup, /Agent-Link Install Intake/);
  assert.match(setup, /Root agent entry/);
  assert.match(setup, /Harness location/);
  assert.match(setup, /README ownership/);
  assert.match(setup, /README optimization/);
  assert.match(setup, /wf-readme/);
  assert.match(setup, /ECC, custom rules/);
  assert.match(setup, /Scan installed skills\/plugins\/rules first/);
  assert.match(setup, /External recommendation links/);
  assert.match(setup, /Install 1-2 relevant local workflows only after user approval/);
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
  const featureTemplate = readRel(targetDir, 'Harness/tasks/_template/PLAN.md');

  for (const body of [browserWorkflow, reactWorkflow]) {
    assert.match(body, /data-testid/);
    assert.match(body, /accessible labels\/roles/);
    assert.match(body, /inputs, buttons, filters, rows, empty\/error\/loading states/);
  }

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
  const browserCodexSkill = readRel(targetDir, '.agents/skills/browser-e2e/SKILL.md');

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
  assert.equal(browserCodexSkill, browserSkill);
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

// ============================================================================
// Scaffolding Infrastructure Tests (build-version, harnessDest, .harness-version)
// ============================================================================

test('harnessDest maps scripts/ prefix to Harness/scripts/', () => {
  // The harnessDest function should map any scripts/ path to Harness/scripts/
  assert.equal(harnessDest('scripts/foo.mjs'), 'Harness/scripts/foo.mjs');
  assert.equal(harnessDest('scripts/validate-harness.mjs'), 'Harness/scripts/validate-harness.mjs');
  assert.equal(harnessDest('scripts/scan-clean.mjs'), 'Harness/scripts/scan-clean.mjs');
  assert.equal(harnessDest('scripts/subdir/nested.mjs'), 'Harness/scripts/subdir/nested.mjs');
});

test('build-version produces valid semver and populated checksums/sources', async () => {
  const { execSync } = await import('node:child_process');
  const pkgPath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const harnessVersionPath = path.join(process.cwd(), 'templates', 'common', '.harness-version');

  // Read the current .harness-version file (it should already be populated from release)
  const harnessVersion = JSON.parse(fs.readFileSync(harnessVersionPath, 'utf8'));

  // Assert generator version matches package.json version (real semver, not placeholder)
  assert.equal(harnessVersion.generator, pkg.version, 'generator version should match package.json version');
  assert.match(harnessVersion.generator, /^\d+\.\d+\.\d+/, 'generator should be a real semver');

  // Assert checksums is populated with >0 keys (all non-PRESERVE files)
  const checksumKeys = Object.keys(harnessVersion.checksums);
  assert.ok(checksumKeys.length > 0, 'checksums should have at least one entry');

  // Assert sources is populated with >0 keys and includes remapped paths
  const sourceKeys = Object.keys(harnessVersion.sources);
  assert.ok(sourceKeys.length > 0, 'sources should have at least one entry');

  // Specifically assert that Harness/WF.md maps directly from templates/common/Harness/WF.md
  assert.equal(
    harnessVersion.sources['Harness/WF.md'],
    'Harness/WF.md',
    'Harness/WF.md should be mapped from Harness/WF.md'
  );

  // Specifically assert that scripts/scan-clean.mjs maps to Harness/scripts/scan-clean.mjs
  assert.equal(
    harnessVersion.sources['Harness/scripts/scan-clean.mjs'],
    'scripts/scan-clean.mjs',
    'Harness/scripts/scan-clean.mjs should be mapped from scripts/scan-clean.mjs'
  );

  // Verify scripts/ prefix mapping for other script files
  assert.equal(
    harnessVersion.sources['Harness/scripts/validate-harness.mjs'],
    'scripts/validate-harness.mjs',
    'Harness/scripts/validate-harness.mjs should be mapped from scripts/validate-harness.mjs'
  );
});

test('generated project has populated .harness-version with matching version and timestamps', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'version-check');
  const pkgPath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  const result = generate({ projectName: 'version-check', targetDir });

  assert.equal(result.success, true);

  const harnessVersionPath = path.join(targetDir, 'Harness', '.harness-version');
  assert.ok(fs.existsSync(harnessVersionPath), 'Harness/.harness-version should be generated');

  const harnessVersion = JSON.parse(fs.readFileSync(harnessVersionPath, 'utf8'));

  // Assert generator matches package.json version
  assert.equal(harnessVersion.generator, pkg.version, 'generated .harness-version generator should match package.json version');

  // Assert checksums is populated (non-empty, >0 keys)
  const checksumKeys = Object.keys(harnessVersion.checksums);
  assert.ok(checksumKeys.length > 0, 'generated .harness-version checksums should have entries');

  // Assert generated is a valid ISO timestamp
  assert.match(harnessVersion.generated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'generated should be a valid ISO timestamp');

  // Verify the timestamp is recent (within the last minute)
  const generatedDate = new Date(harnessVersion.generated);
  const now = new Date();
  const diffMs = now - generatedDate;
  assert.ok(diffMs >= 0 && diffMs < 60000, 'generated timestamp should be recent');
});
