import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generate, getOptionalCatalog, harnessDest } from '../src/generator.js';

const tempRoots = [];
function tmpdir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-generator-'));
  tempRoots.push(root);
  return root;
}
after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

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
  assert.match(readme, /operating contract for reliable AI coding agents/i);
  assert.match(readme, /npx create-harness-vibe-coding/);
  assert.match(readme, /Read and follow https:\/\/github\.com\/LiWeny16\/create-harness-vibe-coding exactly/);
  assert.match(readme, /measurable difference/i);
  assert.match(readme, /What's new in 0\.8\.15/);
  assert.match(readme, /Real Claude Code L2 telemetry/);
  assert.match(readme, /\+5\.4/);
  assert.match(readme, /Prompt-cache L2 sample/);
  assert.match(readme, /cache_read_input_tokens/);
  assert.match(readme, /\+5\.8 percentage points/);
  assert.match(readme, /agent\.releaseHighlights/);
  assert.match(readme, /Which WF command should you use\?/);
  assert.match(readme, /\/wf-auto-spark/);
  assert.match(readme, /\/wf-browser/);
  assert.match(readme, /\/wf-update/);
  assert.match(readme, /Harness\/specs\/workflows\/WF-AUTO-ANGLES\.md/);
  assert.match(readme, /Rework rate/);
  assert.match(readme, /humanInterventions/);
  assert.match(readme, /bare-agent/);
  assert.match(readme, /harness-wf-max/);
  assert.match(readme, /Loss aversion/);
  assert.match(readme, /Leverage/);
  assert.match(readme, /Blind spot/);
  assert.match(readme, /harness-architecture-light\.png/);
  assert.match(readme, /Harness\/specs\/guides\/SETUP\.md/i);
  assert.match(readme, /Optional workflows/);
  assert.match(readme, /validate-harness\.mjs/);
  assert.match(readme, /Release gate/);
  assert.match(readme, /zingspark\/create-harness-vibe-coding/);
  assert.match(readme, /npm run check:mirrors/);
});

test('template source stores harness docs under categorized templates/common/Harness directories', () => {
  assert.equal(fs.existsSync(path.join(process.cwd(), 'templates', 'common', 'docs')), false);
  assert.ok(fs.existsSync(path.join(process.cwd(), 'templates', 'common', 'Harness', 'README.md')));
  assert.ok(fs.existsSync(path.join(process.cwd(), 'templates', 'common', 'Harness', 'specs', 'workflows', 'WF.md')));
  assert.ok(fs.existsSync(path.join(process.cwd(), 'templates', 'common', 'Harness', 'specs', 'guides', 'SETUP.md')));
  assert.ok(fs.existsSync(path.join(process.cwd(), 'templates', 'common', 'Harness', 'tasks', '_template', 'PLAN.md')));
  assert.equal(fs.existsSync(path.join(process.cwd(), 'templates', 'common', 'Harness', 'WF.md')), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'templates', 'common', 'Harness', 'SETUP.md')), false);

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
  assert.ok(ids.includes('grill-me'));
  const grillMe = catalog.externalRecommendations.find(item => item.id === 'grill-me');
  assert.match(grillMe.description, /plan|design|interview/i);
  assert.equal(grillMe.url, 'https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me');
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
  assert.ok(result.plan.create.includes('Harness/specs/guides/SETUP.md'));
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
  const generatedVersion = JSON.parse(readRel(targetDir, 'Harness/.harness-version'));
  assert.equal(generatedVersion.source, 'https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/');

  for (const rel of [
    'README.md',
    'CLAUDE.md',
    'AGENTS.md',
    'Harness/README.md',
    'Harness/settings.json',
    'Harness/specs/guides/SETUP.md',
    'Harness/MEMORY.md',
    'Harness/PROGRESS.md',
    'Harness/specs/workflows/WF.md',
    'Harness/specs/runtime/subagents.md',
    'Harness/project/architecture.md',
    'Harness/specs/runtime/dispatch.md',
    'Harness/specs/runtime/context-loading.md',
    'Harness/specs/runtime/agent-workflow.md',
    'Harness/scripts/context-budget.mjs',
    'Harness/scripts/validate-harness.mjs',
    'Harness/scripts/wf-update-check.mjs',
    'Harness/scripts/wf-auto-update-prompt.mjs',
    'Harness/scripts/wf-remove.mjs',
    'Harness/scripts/scan-clean.mjs',
    'Harness/memory/tool-usage-reflections.md',
    'Harness/memory/user-corrections-preferences.md',
    'Harness/memory/agent-lessons-patterns.md',
    '.codex/config.toml',
    '.codex/hooks.json',
    'opencode.json',
    '.opencode/plugins/harness-wf-status.mjs',
    '.opencode/commands/wf-help.md',
    '.opencode/commands/wf-update.md',
    '.opencode/commands/wf.md',
    '.opencode/commands/wf-max.md',
    '.opencode/commands/wf-auto.md',
    '.opencode/commands/wf-auto-spark.md',
    '.opencode/commands/wf-learn.md',
    '.opencode/commands/wf-review.md',
    '.opencode/commands/wf-readme.md',
    '.opencode/commands/wf-remove.md',
    '.claude/commands/wf-help.md',
    '.claude/commands/wf-update.md',
    '.opencode/agents/researcher.md',
    '.opencode/agents/planner.md',
    '.opencode/agents/implementer.md',
    '.opencode/agents/task-scribe.md',
    '.opencode/agents/codebase-explorer.md',
    '.claude/skills/wf/SKILL.md',
    '.agents/skills/wf/SKILL.md',
    '.claude/skills/wf-max/SKILL.md',
    '.agents/skills/wf-max/SKILL.md',
    '.claude/skills/wf-update/SKILL.md',
    '.agents/skills/wf-update/SKILL.md',
    '.claude/skills/wf-readme/SKILL.md',
    '.agents/skills/wf-readme/SKILL.md',
    '.claude/skills/wf-agents-docs/SKILL.md',
    '.agents/skills/wf-agents-docs/SKILL.md',
    '.claude/skills/subagent-orchestrator/SKILL.md',
    '.agents/skills/subagent-orchestrator/SKILL.md',
    '.claude/agents/reflector.md',
    'Harness/specs/workflows/WF-KERNEL.md',
  ]) {
    assert.ok(fs.existsSync(path.join(targetDir, ...rel.split('/'))), `Expected ${rel} to be generated`);
  }
  assert.equal(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'wf-browser', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'wf-browser', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.opencode', 'commands', 'wf-browser.md')), false);

  assert.equal(fs.existsSync(path.join(targetDir, 'SETUP.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, 'MEMORY.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, 'docs', 'README.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, 'docs', 'harness', 'PLAN.md')), false);
  for (const legacy of [
    'Harness/WF.md',
    'Harness/WF-MAX.md',
    'Harness/context-loading.md',
    'Harness/dispatch.md',
    'Harness/subagents.md',
    'Harness/SETUP.md',
  ]) {
    assert.equal(fs.existsSync(path.join(targetDir, ...legacy.split('/'))), false, `Expected legacy root spec doc to be absent: ${legacy}`);
  }

  const claude = readRel(targetDir, 'CLAUDE.md');
  assert.match(claude, /Harness\/README\.md/);
  assert.match(claude, /Harness\/MEMORY\.md/);
  assert.match(claude, /If `Harness\/` exists, this repository is governed by the Harness contract/);
  assert.match(claude, /memory and resource router/);
  assert.match(claude, /Harness\/README\.md/);
  assert.doesNotMatch(claude, /Harness\/SETUP\.md/);
  assert.match(claude, /Harness\/specs\/runtime\/subagents\.md/);
  assert.match(claude, /## 2\. Think Before Coding/);
  assert.match(claude, /## 3\. Simplicity First/);
  assert.match(claude, /## 4\. Surgical Changes/);
  assert.match(claude, /## 5\. Goal-Driven Execution/);
  assert.match(claude, /## 5a\. Low-Noise Progress/);
  assert.match(claude, /Match the user's language for all user-facing prose/);
  assert.match(claude, /Keep intermediate user updates to 1-2 short sentences/);
  assert.ok(claude.split(/\r?\n/).length <= 200);
  assert.match(claude, /No features beyond what was asked/);
  assert.match(claude, /No unrequested flexibility/);
  assert.match(claude, /Touch only files and lines required by the task/);
  assert.match(claude, /every changed line traceable to the user's request/);
  assert.match(claude, /verifiable success criteria/);
  assert.doesNotMatch(claude, /docs\/README\.md/);

  const eccCommon = readRel(targetDir, '.claude/rules/ecc/common.md');
  assert.match(eccCommon, /## Low-Noise Progress/);
  assert.match(eccCommon, /Match the user's language for user-facing prose/);
  assert.match(eccCommon, /Do not recap plans, paste logs, or narrate obvious file reads/);

  const rootReadme = readRel(targetDir, 'README.md');
  assert.match(rootReadme, /Development Commands/);
  assert.match(rootReadme, /Harness\/README\.md/);
  assert.match(rootReadme, /Normal agent sessions start from `CLAUDE\.md`/);
  assert.match(rootReadme, /Use `Harness\/specs\/guides\/SETUP\.md` only for install\/bootstrap guidance/);
  assert.match(rootReadme, /Harness workflow router/);
  assert.match(rootReadme, /release highlights from update metadata/);
  assert.doesNotMatch(rootReadme, /normal work starts at `Harness\/README\.md`/);
  assert.match(rootReadme, /Harness\/MEMORY\.md/);
  assert.match(rootReadme, /wf-readme/);
  assert.match(rootReadme, /Codex/);
  assert.match(rootReadme, /\.agents\/skills/);
  assert.match(rootReadme, /\.codex/);
  assert.doesNotMatch(rootReadme, /commands\/wf\.toml/);
  assert.doesNotMatch(rootReadme, /long, difficult, multi-agent work/);
  assert.match(rootReadme, /explicitly invokes a WF command/);

  const wfHelp = readRel(targetDir, '.claude/commands/wf-help.md');
  assert.match(wfHelp, /# \/wf-help/);
  assert.match(wfHelp, /Do not invoke a skill/);
  assert.match(wfHelp, /\| `\/wf-auto` \|/);
  assert.match(wfHelp, /\| `\/wf-readme <task>` \|/);
  assert.match(wfHelp, /\/wf-browser/);

  const docsReadme = readRel(targetDir, 'Harness/README.md');
  // wf-browser is always listed in the Skill Commands table as an optional workflow skill
  assert.match(docsReadme, /\/wf-browser/);
  assert.match(docsReadme, /Need context\/cache\/token efficiency/);
  assert.match(docsReadme, /cache-first context layout/);
  assert.match(docsReadme, /scripts\/l2-cache-telemetry\.mjs/);
  assert.match(docsReadme, /Need peer CLI automation docs/);
  assert.match(docsReadme, /wf-agents-docs/);

  const contextLoading = readRel(targetDir, 'Harness/specs/runtime/context-loading.md');
  assert.match(contextLoading, /Context Tiers/);
  assert.match(contextLoading, /automatic route profiles, not user-selected modes/);
  assert.match(contextLoading, /Budgets are regression guards, not exclusion rules/);
  assert.match(contextLoading, /Do not skip required rules/);
  assert.match(contextLoading, /Escalation rule/);
  assert.match(contextLoading, /Thin startup/);
  assert.match(contextLoading, /Routed skill\/doc/);
  assert.doesNotMatch(contextLoading, /Always keep:/);
  assert.match(contextLoading, /Cache-First Context Contract/);
  assert.match(contextLoading, /Cache Validation Levels/);
  assert.match(contextLoading, /Do not claim real cache hits/);
  assert.match(contextLoading, /cached_tokens/);
  assert.match(contextLoading, /cache_read_input_tokens/);
  assert.match(contextLoading, /Stable prefix/);
  assert.match(contextLoading, /Dynamic suffix/);

  const contextBudget = readRel(targetDir, 'Harness/scripts/context-budget.mjs');
  assert.match(contextBudget, /thin-startup/);
  assert.match(contextBudget, /cache-diagnostics-route/);
  assert.match(contextBudget, /not runtime exclusion rules/);
  assert.match(contextBudget, /approxTokens/);

  const memoryIndex = readRel(targetDir, 'Harness/MEMORY.md');
  // browser-e2e is always listed under Skills in MEMORY.md as an optional workflow
  assert.match(memoryIndex, /browser-e2e/);
  assert.match(memoryIndex, /wf-agents-docs/);

  const wf = readRel(targetDir, 'Harness/specs/workflows/WF.md');
  assert.match(wf, /Cache Discipline/);
  assert.match(wf, /Orchestration Loop/);
  assert.match(wf, /Task Type Routing/);
  assert.match(wf, /WF-KERNEL\.md/);
  assert.match(wf, /WF-KERNEL\.md/);
  assert.match(wf, /controller \+ task-scribe/);
  assert.match(wf, /delegated to appropriate subagents/);
  assert.match(wf, /Cross-review and reflector NOT mandatory/);
  assert.match(wf, /task-<verb>-<noun>\[-detail\]/);
  assert.doesNotMatch(wf, /MUST use at least 3 distinct role passes/);
  assert.match(wf, /\.claude\/agents\//);
  assert.match(wf, /WF Tiers/);

  const wfKernel = readRel(targetDir, 'Harness/specs/workflows/WF-KERNEL.md');
  assert.match(wfKernel, /Cache-First Context Contract/);
  assert.match(wfKernel, /MaxReturnTokens/);

  const wfMax = readRel(targetDir, 'Harness/specs/workflows/WF-MAX.md');
  assert.match(wfMax, /task-<verb>-<noun>\[-detail\]/);
  assert.match(wfMax, /CEO may NOT proceed to W2 implementation dispatch with a failing gate/);
  assert.match(wfMax, /parallelism superset/);
  assert.doesNotMatch(wfMax, /strict superset/);
  assert.match(wfMax, /cross-CLI overflow/i);
  assert.match(wfMax, /claude -p/);
  assert.match(wfMax, /codex exec/);
  assert.match(wfMax, /agents\.max_threads/);
  assert.match(wfMax, /agents\.max_depth/);
  assert.match(wfMax, /max_threads = 12/);
  assert.match(wfMax, /max_depth = 1/);
  assert.match(wfMax, /ask the user before raising/i);
  assert.match(wfMax, /Close completed agents/);
  assert.match(wfMax, /Codex\+\+/);
  assert.match(wfMax, /does not authorize CEO source edits/);
  assert.match(wfMax, /## Cross-Task Decisions/);
  assert.doesNotMatch(wfMax, /proceed to W1 with a failing gate/);
  assert.doesNotMatch(wfMax, /no hard agent cap; recursion governed/);

  const wfState = readRel(targetDir, 'Harness/specs/workflows/WF-STATE.md');
  assert.match(wfState, /task-<verb>-<noun>\[-detail\]/);

  const wfAutoSkill = readRel(targetDir, '.claude/skills/wf-auto/SKILL.md');
  assert.match(wfAutoSkill, /Memory Preflight/);
  assert.match(wfAutoSkill, /bounded test tick/);
  assert.match(wfAutoSkill, /Harness\/tasks\/auto\/PLAN\.md/);
  assert.match(wfAutoSkill, /evidence ledger path\/summary/);

  const codexConfig = readRel(targetDir, '.codex/config.toml');
  assert.match(codexConfig, /\[agents\]/);
  assert.match(codexConfig, /max_threads = 12/);
  assert.match(codexConfig, /max_depth = 1/);

  const codexHooks = readRel(targetDir, '.codex/hooks.json');
  assert.match(codexHooks, /SessionStart/);
  assert.match(codexHooks, /startup\|resume\|clear/);
  assert.match(codexHooks, /wf-auto-update-prompt\.mjs/);
  assert.doesNotMatch(codexHooks, /UserPromptSubmit/);

  const claudeSettings = readRel(targetDir, '.claude/settings.json');
  assert.match(claudeSettings, /SessionStart/);
  assert.match(claudeSettings, /startup\|resume\|clear/);
  assert.match(claudeSettings, /wf-auto-update-prompt\.mjs/);
  assert.doesNotMatch(claudeSettings, /UserPromptSubmit/);

  const opencodeConfig = readRel(targetDir, 'opencode.json');
  assert.match(opencodeConfig, /\$schema.*opencode\.ai\/config\.json/);
  assert.match(opencodeConfig, /\.claude\/rules\/ecc\/common\.md/);

  const opencodePlugin = readRel(targetDir, '.opencode/plugins/harness-wf-status.mjs');
  assert.match(opencodePlugin, /HarnessWfStatusPlugin/);
  assert.match(opencodePlugin, /mode on/);
  assert.match(opencodePlugin, /wf-auto-update-prompt\.mjs/);
  assert.match(opencodePlugin, /opencode\.startup/);
  assert.doesNotMatch(opencodePlugin, /'chat\.message'/);

  const opencodePlanner = readRel(targetDir, '.opencode/agents/planner.md');
  const claudePlanner = readRel(targetDir, '.claude/agents/planner.md');
  assert.match(claudePlanner, /harness: wf-agent/);
  assert.match(opencodePlanner, /harness: wf-agent/);
  assert.match(opencodePlanner, /mode: subagent/);
  assert.match(opencodePlanner, /description:/);
  assert.match(opencodePlanner, /edit: deny/);
  assert.match(opencodePlanner, /bash: deny/);
  assert.match(opencodePlanner, /websearch: deny/);
  assert.match(opencodePlanner, /webfetch: deny/);
  assert.doesNotMatch(opencodePlanner, /^name:/m);

  const opencodeImplementer = readRel(targetDir, '.opencode/agents/implementer.md');
  assert.match(opencodeImplementer, /mode: subagent/);
  assert.doesNotMatch(opencodeImplementer, /edit: deny/);

  const opencodeResearcher = readRel(targetDir, '.opencode/agents/researcher.md');
  assert.doesNotMatch(opencodeResearcher, /websearch: deny/);
  assert.doesNotMatch(opencodeResearcher, /webfetch: deny/);

  const opencodeExploreManager = readRel(targetDir, '.opencode/agents/explore-manager.md');
  assert.match(opencodeExploreManager, /"git \*": allow/);
  assert.match(opencodeExploreManager, /"\*": deny/);

  const opencodeWfHelp = readRel(targetDir, '.opencode/commands/wf-help.md');
  assert.match(opencodeWfHelp, /description:/);
  assert.match(opencodeWfHelp, /\/wf-help/);
  assert.match(opencodeWfHelp, /\.opencode\/commands\//);

  const opencodeWfCommand = readRel(targetDir, '.opencode/commands/wf.md');
  assert.match(opencodeWfCommand, /description:/);
  assert.match(opencodeWfCommand, /workflow command/);
  assert.match(opencodeWfCommand, /Harness\/MEMORY\.md/);
  assert.match(opencodeWfCommand, /Cache-First Context Contract/);
  assert.match(opencodeWfCommand, /\.claude\/skills\/wf\/SKILL\.md/);

  const opencodeWfMaxCommand = readRel(targetDir, '.opencode/commands/wf-max.md');
  assert.match(opencodeWfMaxCommand, /workflow command/);
  assert.match(opencodeWfMaxCommand, /\.claude\/skills\/wf-max\/SKILL\.md/);

  const wfMaxSkill = readRel(targetDir, '.claude/skills/wf-max/SKILL.md');
  assert.match(wfMaxSkill, /Cache Discipline/);
  assert.match(wfMaxSkill, /inherits the selected WF tier/);
  assert.match(wfMaxSkill, /Final acceptance is tier-aware/);
  assert.match(wfMaxSkill, /D-GATE is mandatory before implementation waves/);
  assert.match(wfMaxSkill, /never edits production source/);
  assert.doesNotMatch(wfMaxSkill, /every WF role, gate, and acceptance rule still/);
  assert.doesNotMatch(wfMaxSkill, /Final acceptance requires verifier evidence, cross-review, and reflector PASS/);
  assert.equal(readRel(targetDir, '.agents/skills/wf-max/SKILL.md'), wfMaxSkill);

  const wfAuto = readRel(targetDir, 'Harness/specs/workflows/WF-AUTO.md');
  assert.match(wfAuto, /Inherited WF\/WF-MAX Constraints/);
  assert.match(wfAuto, /Mini PRD -> AC IDs -> test\/validation plan -> implementer -> verifier/);
  assert.match(wfAuto, /reflector PASS/);

  const wfAutoAngles = readRel(targetDir, 'Harness/specs/workflows/WF-AUTO-ANGLES.md');
  assert.match(wfAutoAngles, /Selection algorithm/);
  assert.match(wfAutoAngles, /Dynamic obligations/);
  assert.match(wfAutoAngles, /Common probe recipes/);
  assert.match(wfAutoAngles, /Context \/ memory quality/);

  const wfAutoSpark = readRel(targetDir, 'Harness/specs/workflows/WF-AUTO-SPARK.md');
  assert.match(wfAutoSpark, /Inherited Execution Chain/);
  assert.match(wfAutoSpark, /External spark search replaces discovery only/);
  assert.match(wfAutoSpark, /reflector PASS/);
  assert.match(wfAutoSpark, /task-scribe formats task-state writes/);
  assert.match(wfAutoSpark, /searchFallback: ceo-direct/);
  assert.match(wfAutoSpark, /pre-implementation triage/);
  assert.match(wfAutoSpark, /Literal anti-pattern matching/);
  assert.match(wfAutoSpark, /node scripts\/build-version\.mjs --check/);

  assert.match(wfMax, /process-file delegation is the default/);

  const subagents = readRel(targetDir, 'Harness/specs/runtime/subagents.md');
  assert.match(subagents, /## Source Attribution/);
  assert.match(subagents, /npx skills find/);
  assert.match(subagents, /superpowers:dispatching-parallel-agents/);
  assert.match(subagents, /superpowers:subagent-driven-development/);
  assert.match(subagents, /## Built-in Agent Roster/);
  assert.match(subagents, /## WF Default Fan-Out/);
  assert.match(subagents, /`planner`/);
  assert.match(subagents, /`architect`/);
  assert.match(subagents, /`test-writer`/);
  assert.match(subagents, /`reflector`/);
  assert.match(subagents, /reflector PASS/);
  assert.doesNotMatch(subagents, /parallel explorer\/researcher/);
  assert.match(subagents, /## Efficiency Ladder/);
  assert.match(subagents, /## Review Gates/);

  const orchestratorSkill = readRel(targetDir, '.claude/skills/subagent-orchestrator/SKILL.md');
  assert.match(orchestratorSkill, /Harness\/specs\/runtime\/subagents\.md/);
  assert.match(orchestratorSkill, /Cache Discipline/);
  assert.match(orchestratorSkill, /runtime-neutral/);
  assert.match(orchestratorSkill, /bounded passes/);
  assert.match(orchestratorSkill, /\.claude\/agents\//);
  assert.match(orchestratorSkill, /tier-specific role coverage/);
  assert.match(orchestratorSkill, /cross-CLI overflow/);
  assert.doesNotMatch(orchestratorSkill, /^description:.*repeated failures/m);
  assert.equal(
    readRel(targetDir, '.agents/skills/subagent-orchestrator/SKILL.md'),
    orchestratorSkill,
  );

  const agentsDocsSkill = readRel(targetDir, '.claude/skills/wf-agents-docs/SKILL.md');
  assert.match(agentsDocsSkill, /claude -p --output-format json/);
  assert.match(agentsDocsSkill, /codex exec --json/);
  assert.match(agentsDocsSkill, /opencode run --format json/);
  assert.match(agentsDocsSkill, /cache_read_input_tokens/);
  assert.match(agentsDocsSkill, /Do not trust exit code alone/);
  assert.match(agentsDocsSkill, /Evidence-Packet Review Pattern/);
  assert.match(agentsDocsSkill, /No Scratch-File Rule/);
  assert.match(agentsDocsSkill, /Subagent Output Contract/);
  assert.match(agentsDocsSkill, /Do not write CLI probe output under `%TEMP%`/);
  assert.match(agentsDocsSkill, /Cache Discipline/);
  assert.equal(readRel(targetDir, '.agents/skills/wf-agents-docs/SKILL.md'), agentsDocsSkill);

  const reflector = readRel(targetDir, '.claude/agents/reflector.md');
  assert.match(reflector, /RETURN_TO_DEBUG/);
  assert.match(reflector, /final acceptance may proceed/);

  const architecture = readRel(targetDir, 'Harness/project/architecture.md');
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
  assert.ok(fs.existsSync(path.join(targetDir, 'Harness', 'specs', 'guides', 'SETUP.md')));
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

test('package README-CN gives a concise Chinese quickstart and Harness-only docs contract', () => {
  const readmeCn = fs.readFileSync(path.join(process.cwd(), 'README-CN.md'), 'utf8');
  assert.doesNotMatch(readmeCn, /涓€/);
  assert.doesNotMatch(readmeCn, /鏂伴/);
  assert.match(readmeCn, /一句话安装/);
  assert.match(readmeCn, /WF 命令怎么选/);
  assert.match(readmeCn, /\/wf-auto-spark/);
  assert.match(readmeCn, /\/wf-browser/);
  assert.match(readmeCn, /\/wf-update/);
  assert.match(readmeCn, /Prompt-cache L2/);
  assert.match(readmeCn, /cache_read_input_tokens/);
  assert.match(readmeCn, /0\.8\.15/);
  assert.match(readmeCn, /98\.7%/);
  assert.match(readmeCn, /\+5\.4/);
  assert.match(readmeCn, /\+5\.8/);
  assert.match(readmeCn, /agent\.releaseHighlights/);
  assert.match(readmeCn, /Harness\/specs\/workflows\/WF-AUTO-ANGLES\.md/);
  assert.match(readmeCn, /让 AI agent 在真实仓库里先理解/);
  assert.match(readmeCn, /三个核心支柱/);
  assert.match(readmeCn, /嗔/);
  assert.match(readmeCn, /贪/);
  assert.match(readmeCn, /痴/);
  assert.match(readmeCn, /harness-architecture-light\.png/);
  assert.match(readmeCn, /https:\/\/github\.com\/obra\/Superpowers/);
  assert.match(readmeCn, /https:\/\/github\.com\/JuliusBrussee\/caveman/);
  assert.match(readmeCn, /https:\/\/github\.com\/lingzhi227\/agent-research-skills/);
  assert.match(readmeCn, /https:\/\/github\.com\/colbymchenry\/codegraph/);
  assert.match(readmeCn, /https:\/\/github\.com\/mattpocock\/skills\/tree\/main\/skills\/productivity\/grill-me/);
  assert.match(readmeCn, /外部推荐/);
  assert.match(readmeCn, /验证/);
  assert.match(readmeCn, /https:\/\/github\.com\/LiWeny16\/create-harness-vibe-coding/);
  assert.match(readmeCn, /zingspark\/create-harness-vibe-coding/);
  assert.match(readmeCn, /npm run check:mirrors/);
  assert.match(readmeCn, /\.agents\/skills/);
  assert.match(readmeCn, /Agent instruction/);
  assert.doesNotMatch(readmeCn, /commands\/wf\.toml/);
});

test('package README-CN contains required Chinese workflow and verification clauses', () => {
  const readmeCn = fs.readFileSync(path.join(process.cwd(), 'README-CN.md'), 'utf8');

  assert.match(readmeCn, /\u4e00\u53e5\u8bdd\u5b89\u88c5/u);
  assert.match(readmeCn, /\u5df2\u6709\u9879\u76ee/u);
  assert.match(readmeCn, /--on-conflict skip/);
  assert.match(readmeCn, /\u7a33\u5b9a\u6027\u3001\u8fd4\u4fee\u7387\u4e0e\u4eba\u5de5\u7ea0\u504f/u);
  assert.match(readmeCn, /humanInterventions/);
  assert.match(readmeCn, /HarnessBench v0\.1/);
  assert.match(readmeCn, /\u4e09\u4e2a\u6838\u5fc3\u652f\u67f1/u);
  assert.match(readmeCn, /\u55d4/u);
  assert.match(readmeCn, /\u8d2a/u);
  assert.match(readmeCn, /\u75f4/u);
  assert.match(readmeCn, /harness-architecture-light\.png/);
  assert.match(readmeCn, /https:\/\/github\.com\/obra\/Superpowers/);
  assert.match(readmeCn, /https:\/\/github\.com\/JuliusBrussee\/caveman/);
  assert.match(readmeCn, /https:\/\/github\.com\/lingzhi227\/agent-research-skills/);
  assert.match(readmeCn, /https:\/\/github\.com\/colbymchenry\/codegraph/);
  assert.match(readmeCn, /https:\/\/github\.com\/mattpocock\/skills\/tree\/main\/skills\/productivity\/grill-me/);
  assert.match(readmeCn, /\u5916\u90e8\u63a8\u8350/u);
  assert.match(readmeCn, /\u9a8c\u8bc1/u);
  assert.match(readmeCn, /\u53d1\u5e03\u95e8\u7981/u);
  assert.match(readmeCn, /https:\/\/github\.com\/LiWeny16\/create-harness-vibe-coding/);
  assert.match(readmeCn, /zingspark\/create-harness-vibe-coding/);
  assert.match(readmeCn, /npm run check:mirrors/);
  assert.match(readmeCn, /\.agents\/skills/);
  assert.match(readmeCn, /Agent instruction/);
});

test('external recommendations are recorded without installing third-party skills', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'external-recommendations');

  const result = generate({
    projectName: 'external-recommendations',
    targetDir,
    externalOptions: ['superpowers,codegraph,grill-me'],
  });

  assert.equal(result.success, true);

  const setup = readRel(targetDir, 'Harness/specs/guides/SETUP.md');
  assert.match(setup, /Selected External Recommendations/);
  assert.match(setup, /superpowers/);
  assert.match(setup, /codegraph/);
  assert.match(setup, /grill-me/);
  assert.match(setup, /https:\/\/github\.com\/obra\/Superpowers/);
  assert.match(setup, /https:\/\/github\.com\/colbymchenry\/codegraph/);
  assert.match(setup, /https:\/\/github\.com\/mattpocock\/skills\/tree\/main\/skills\/productivity\/grill-me/);
  assert.match(setup, /recommendation only/i);
  assert.doesNotMatch(setup, /install hint/i);
  assert.equal(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'superpowers', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'superpowers', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'codegraph', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'codegraph', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'grill-me', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'grill-me', 'SKILL.md')), false);

  const harnessVersion = JSON.parse(readRel(targetDir, 'Harness/.harness-version'));
  assert.deepEqual(harnessVersion.externalRecommendations, ['superpowers', 'codegraph', 'grill-me']);
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
  const setup = readRel(targetDir, 'Harness/specs/guides/SETUP.md');
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
  assert.match(docsReadme, /explicit WF token/);
  assert.match(docsReadme, /\| Need WF mode \(explicit only\)[^\n]*\[WF\.md\]\(specs\/workflows\/WF\.md\), \[WF-KERNEL\.md\]\(specs\/workflows\/WF-KERNEL\.md\), \[PROGRESS\.md\]\(PROGRESS\.md\)[^\n]*tier-gated acceptance/);
  assert.match(docsReadme, /\| Need WF mode \(explicit only\)/);
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
  assert.match(setup, /no startup dependency on this setup reference/);
  assert.doesNotMatch(setup, /bootstrap contract line/);
  const memoryProto = readRel(targetDir, 'Harness/specs/protocols/MEMORY_PROTOCOL.md');
  assert.match(memoryProto, /same tool or command pattern fails 3\+ times/);
  assert.match(memoryProto, /user corrects the same assumption or preference 2\+ times/);
});

test('core docs declare project files as the durable communication channel', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'durable-docs');

  const result = generate({ projectName: 'durable-docs', targetDir });

  assert.equal(result.success, true);
  for (const rel of ['Harness/README.md', 'Harness/specs/runtime/subagents.md', 'Harness/specs/runtime/dispatch.md', 'Harness/specs/runtime/context-loading.md']) {
    const body = readRel(targetDir, rel);
    assert.match(body, /project files are the only durable communication channel/i, `${rel} should declare durable filesystem authority`);
    assert.match(body, /chat\/subagent transcript state is non-authoritative/i, `${rel} should reject transcript state as authoritative`);
  }
});

test('generated web workflows require stable accessible selectors and test selectors', () => {
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
  const progressTemplate = readRel(targetDir, 'Harness/tasks/_template/PROGRESS.md');

  for (const body of [browserWorkflow, reactWorkflow]) {
    assert.match(body, /data-testid/);
    assert.match(body, /accessible labels\/roles/);
    assert.match(body, /inputs, buttons, filters, rows, empty\/error\/loading states/);
  }

  assert.match(featureTemplate, /Compact task record/);
  assert.match(featureTemplate, /Default: keep 1-3 concise ACs/);
  assert.match(featureTemplate, /Expanded Contracts/);
  assert.match(progressTemplate, /Compact heartbeat/);
  assert.doesNotMatch(featureTemplate, /\| AC ID \| Given \/ When \/ Then \| Verification \| Evidence \|/);
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
  const wfBrowserSkill = readRel(targetDir, '.claude/skills/wf-browser/SKILL.md');
  const wfBrowserCodexSkill = readRel(targetDir, '.agents/skills/wf-browser/SKILL.md');
  const wfHelp = readRel(targetDir, '.claude/commands/wf-help.md');

  for (const rel of [
    'Harness/workflows/browser-e2e.md',
    'Harness/workflows/ts-react-frontend.md',
    'Harness/workflows/ui-ux-review.md',
  ]) {
    assert.ok(fs.existsSync(path.join(targetDir, ...rel.split('/'))), `Expected ${rel} to be generated`);
  }

  assert.match(harnessReadme, /\]\(workflows\/browser-e2e\.md\)/);
  assert.match(harnessReadme, /\/wf-browser/);
  assert.match(wfHelp, /\/wf-browser/);
  const opencodeWfBrowser = readRel(targetDir, '.opencode/commands/wf-browser.md');
  assert.match(opencodeWfBrowser, /workflow command/);
  assert.match(opencodeWfBrowser, /\.claude\/skills\/wf-browser\/SKILL\.md/);
  assert.match(memoryIndex, /workflows\/browser-e2e\.md/);
  assert.match(browserSkill, /Harness\/workflows\/browser-e2e\.md/);
  assert.equal(browserCodexSkill, browserSkill);
  assert.match(wfBrowserSkill, /Harness\/workflows\/browser-e2e\.md/);
  assert.match(wfBrowserSkill, /Cache Discipline/);
  assert.equal(wfBrowserCodexSkill, wfBrowserSkill);
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

  const rootHarnessVersionPath = path.join(process.cwd(), 'Harness', '.harness-version');
  if (fs.existsSync(rootHarnessVersionPath)) {
    const rootHarnessVersion = JSON.parse(fs.readFileSync(rootHarnessVersionPath, 'utf8'));
    assert.equal(rootHarnessVersion.generator, pkg.version, 'dogfood root generator should match package.json version');
    assert.equal(rootHarnessVersion.source, harnessVersion.source, 'dogfood root source should match template source');
  }

  // Assert checksums is populated with >0 keys (all non-PRESERVE files)
  const checksumKeys = Object.keys(harnessVersion.checksums);
  assert.ok(checksumKeys.length > 0, 'checksums should have at least one entry');
  assert.ok(
    checksumKeys.includes('Harness/project/architecture.md'),
    'project architecture starter should be checksummed so updates can create/move it without overwriting user edits',
  );

  assert.equal(harnessVersion.releaseNotes.version, pkg.version, 'release notes should match package version');
  assert.ok(
    harnessVersion.releaseNotes.highlights.some(line => /L2 prompt-cache telemetry/i.test(line)),
    'release notes should include cache telemetry highlight',
  );

  // Assert sources is populated with >0 keys and includes remapped paths
  const sourceKeys = Object.keys(harnessVersion.sources);
  assert.ok(sourceKeys.length > 0, 'sources should have at least one entry');

  // Specifically assert that Harness/specs/workflows/WF.md maps directly from templates/common/Harness/specs/workflows/WF.md
  assert.equal(
    harnessVersion.sources['Harness/specs/workflows/WF.md'],
    'Harness/specs/workflows/WF.md',
    'Harness/specs/workflows/WF.md should be mapped from Harness/specs/workflows/WF.md'
  );

  // Harness/scripts/* files now live under templates/common/Harness/scripts/
  assert.equal(
    harnessVersion.sources['Harness/scripts/scan-clean.mjs'],
    'Harness/scripts/scan-clean.mjs',
    'Harness/scripts/scan-clean.mjs should be mapped from Harness/scripts/scan-clean.mjs'
  );

  // Verify scripts/ prefix mapping for other script files
  assert.equal(
    harnessVersion.sources['Harness/scripts/validate-harness.mjs'],
    'Harness/scripts/validate-harness.mjs',
    'Harness/scripts/validate-harness.mjs should be mapped from Harness/scripts/validate-harness.mjs'
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
  assert.ok(
    checksumKeys.includes('Harness/project/architecture.md'),
    'generated .harness-version should track project architecture starter checksum',
  );

  // Assert generated is a valid ISO timestamp
  assert.match(harnessVersion.generated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'generated should be a valid ISO timestamp');

  // Verify the timestamp is recent (within the last minute)
  const generatedDate = new Date(harnessVersion.generated);
  const now = new Date();
  const diffMs = now - generatedDate;
  assert.ok(diffMs >= 0 && diffMs < 60000, 'generated timestamp should be recent');
});
