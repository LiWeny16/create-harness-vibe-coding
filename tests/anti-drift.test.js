import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, ...rel.split('/')));
}

function markdownNames(rel) {
  const dir = path.join(ROOT, ...rel.split('/'));
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name.replace(/\.md$/, ''))
    .sort();
}

function skillNames(...roots) {
  const names = new Set();
  for (const rel of roots) {
    const dir = path.join(ROOT, ...rel.split('/'));
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md'))) {
        names.add(entry.name);
      }
    }
  }
  return [...names].sort();
}

function optionalSkillNames() {
  const names = new Set();
  const optionalRoot = path.join(ROOT, 'templates', 'optional', 'skills');
  for (const option of fs.readdirSync(optionalRoot, { withFileTypes: true })) {
    if (!option.isDirectory()) continue;
    for (const rel of ['.claude/skills', '.agents/skills']) {
      const dir = path.join(optionalRoot, option.name, ...rel.split('/'));
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md'))) {
          names.add(entry.name);
        }
      }
    }
  }
  return [...names].sort();
}

function commandSurfaceCommands() {
  return JSON.parse(read('Harness/specs/runtime/command-surface.json')).commands;
}

function extractStringArray(text, name) {
  const match = text.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match, `${name} array should exist`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]).sort();
}

function numberedStepCount(text) {
  return [...text.matchAll(/^\d+\. /gm)].length;
}

test('wf-update direct command wrappers carry the canonical 9-step flow', () => {
  const files = [
    '.claude/commands/wf-update.md',
    '.opencode/commands/wf-update.md',
    'templates/common/.claude/commands/wf-update.md',
    'templates/common/.opencode/commands/wf-update.md',
  ];
  const bodies = files.map(read);

  for (const [idx, body] of bodies.entries()) {
    assert.equal(numberedStepCount(body), 9, `${files[idx]} should have 9 numbered update steps`);
    for (const marker of [
      '## Cache Discipline',
      'agent.safeApplyCommand',
      '--apply-safe',
      'agent.aiMergeRequired',
      '--accept-local',
      '--accept-merged',
      '--accept-template',
      '--finalize',
      '--manifest-audit',
      '--repair',
      'strict `--apply` only when',
      '## Return',
    ]) {
      assert.match(body, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${files[idx]} missing ${marker}`);
    }
  }

  for (const body of bodies.slice(1)) {
    assert.equal(body, bodies[0], 'wf-update command wrappers should be byte-identical');
  }
});

test('wf-ui direct command wrappers launch CLI without router load', () => {
  const files = [
    '.claude/commands/wf-ui.md',
    '.opencode/commands/wf-ui.md',
    'templates/common/.claude/commands/wf-ui.md',
    'templates/common/.opencode/commands/wf-ui.md',
  ];
  const bodies = files.map(read);

  for (const [idx, body] of bodies.entries()) {
    assert.match(body, /direct command/i, `${files[idx]} should be direct`);
    assert.match(body, /Do not invoke a skill/, `${files[idx]} should not invoke a skill`);
    assert.match(body, /create-harness-vibe-coding wf-ui/, `${files[idx]} should launch the CLI`);
    assert.match(body, /--host 127\.0\.0\.1/, `${files[idx]} should bind loopback`);
    assert.match(body, /--open/, `${files[idx]} should request browser open`);
    assert.doesNotMatch(body, /workflow command/i, `${files[idx]} should not be workflow-routed`);
    assert.doesNotMatch(body, /Load `CLAUDE\.md`/, `${files[idx]} should not preload the router`);
  }

  for (const body of bodies.slice(1)) {
    assert.equal(body, bodies[0], 'wf-ui command wrappers should be byte-identical');
  }

  assert.equal(read('.agents/skills/wf-ui/SKILL.md'), read('.claude/skills/wf-ui/SKILL.md'));
});

test('ECC /wf wildcard rule keeps direct command exemptions explicit', () => {
  const commands = commandSurfaceCommands();
  const directAliases = commands
    .filter(command => command.classification === 'direct')
    .flatMap(command => command.aliases);
  const workflowAliases = commands
    .filter(command => command.classification === 'workflow')
    .flatMap(command => command.aliases);

  for (const rel of [
    '.claude/rules/ecc/common.md',
    'templates/common/.claude/rules/ecc/common.md',
  ]) {
    const body = read(rel);
    const exemptionLine = body.split(/\r?\n/).find(line => line.includes('excluding')) || '';
    for (const alias of directAliases) {
      assert.ok(exemptionLine.includes(`\`${alias}\``), `${rel} missing direct exemption ${alias}`);
    }
    for (const alias of workflowAliases) {
      assert.equal(exemptionLine.includes(`\`${alias}\``), false, `${rel} incorrectly exempts workflow alias ${alias}`);
    }
    assert.doesNotMatch(body, /When the user explicitly invokes a `\/wf-\*` command, load/);
    assert.match(body, /记住/);
    assert.doesNotMatch(body, /鍚|銆|绂|鈥/);
  }
});

test('wf-remove built-in registries cover generated agents and skills', () => {
  const rootScript = read('Harness/scripts/wf-remove.mjs');
  const templateScript = read('templates/common/Harness/scripts/wf-remove.mjs');
  assert.equal(rootScript, templateScript);

  const agentRegistry = extractStringArray(rootScript, 'BUILT_IN_AGENT_NAMES');
  const skillRegistry = extractStringArray(rootScript, 'BUILT_IN_SKILL_NAMES');
  const commandRegistry = extractStringArray(rootScript, 'BUILT_IN_COMMAND_NAMES');
  const cleanupDirs = extractStringArray(rootScript, 'CLEANUP_DIRS');

  for (const name of markdownNames('templates/common/.claude/agents')) {
    assert.ok(agentRegistry.includes(name), `BUILT_IN_AGENT_NAMES missing ${name}`);
  }

  const commonSkills = skillNames('templates/common/.claude/skills');
  const allSkills = [...new Set([...commonSkills, ...optionalSkillNames()])].sort();
  for (const name of allSkills) {
    assert.ok(skillRegistry.includes(name), `BUILT_IN_SKILL_NAMES missing ${name}`);
    assert.ok(cleanupDirs.includes(`.claude/skills/${name}`), `CLEANUP_DIRS missing .claude/skills/${name}`);
    assert.ok(cleanupDirs.includes(`.agents/skills/${name}`), `CLEANUP_DIRS missing .agents/skills/${name}`);
  }

  for (const command of commandSurfaceCommands()) {
    if (command.surfaces?.claudeCommand || command.surfaces?.opencodeCommand) {
      assert.ok(commandRegistry.includes(command.id), `BUILT_IN_COMMAND_NAMES missing ${command.id}`);
    }
  }
});

test('route-critical template and dogfood files stay byte-identical', () => {
  const pairs = [
    ['CLAUDE.md', 'templates/common/CLAUDE.md'],
    ['.claude/rules/ecc/common.md', 'templates/common/.claude/rules/ecc/common.md'],
    ['Harness/specs/runtime/command-surface.json', 'templates/common/Harness/specs/runtime/command-surface.json'],
    ['.claude/commands/wf-help.md', 'templates/common/.claude/commands/wf-help.md'],
    ['.opencode/commands/wf-help.md', 'templates/common/.opencode/commands/wf-help.md'],
    ['.claude/commands/wf-command-create.md', 'templates/common/.claude/commands/wf-command-create.md'],
    ['.opencode/commands/wf-command-create.md', 'templates/common/.opencode/commands/wf-command-create.md'],
    ['.claude/commands/wf-update.md', 'templates/common/.claude/commands/wf-update.md'],
    ['.opencode/commands/wf-update.md', 'templates/common/.opencode/commands/wf-update.md'],
    ['.claude/commands/wf-ui.md', 'templates/common/.claude/commands/wf-ui.md'],
    ['.opencode/commands/wf-ui.md', 'templates/common/.opencode/commands/wf-ui.md'],
    ['.claude/skills/wf-ui/SKILL.md', 'templates/common/.claude/skills/wf-ui/SKILL.md'],
    ['Harness/specs/runtime/context-loading.md', 'templates/common/Harness/specs/runtime/context-loading.md'],
    ['Harness/scripts/context-budget.mjs', 'templates/common/Harness/scripts/context-budget.mjs'],
    ['Harness/scripts/l2-cache-telemetry.mjs', 'templates/common/Harness/scripts/l2-cache-telemetry.mjs'],
    ['Harness/scripts/wf-remove.mjs', 'templates/common/Harness/scripts/wf-remove.mjs'],
    ['Harness/scripts/sync-host-global.mjs', 'templates/common/Harness/scripts/sync-host-global.mjs'],
    ['Harness/scripts/validate-harness.mjs', 'templates/common/Harness/scripts/validate-harness.mjs'],
    ['Harness/scripts/wf-update-runner.mjs', 'templates/common/Harness/scripts/wf-update-runner.mjs'],
  ];

  for (const [rootRel, templateRel] of pairs) {
    assert.equal(read(rootRel), read(templateRel), `${rootRel} should match ${templateRel}`);
  }
});

test('ownership manifest frameworkOwned paths exist on disk', () => {
  const manifest = JSON.parse(read('Harness/ownership.manifest.json'));
  for (const entry of manifest.frameworkOwned) {
    assert.ok(exists(entry.path), `frameworkOwned path missing: ${entry.path}`);
  }
});

test('Harness spec docs live under categorized specs directories, not root', () => {
  const legacyRootDocs = [
    'ACCEPTANCE_PROTOCOL.md',
    'AGENT_ISOLATION.md',
    'DEBUG_PROTOCOL.md',
    'ECC-GUIDE.md',
    'HARNESS_BRIDGE.md',
    'MEMORY_PROTOCOL.md',
    'SETUP.md',
    'TASK_ARCHIVE.md',
    'TDD-GUIDE.md',
    'WF-AUTO-ANGLES.md',
    'WF-AUTO-SPARK.md',
    'WF-AUTO.md',
    'WF-KERNEL.md',
    'WF-MAX.md',
    'WF-STATE.md',
    'WF.md',
    'agent-workflow.md',
    'context-loading.md',
    'dispatch.md',
    'extension.md',
    'lifecycle.md',
    'subagents.md',
  ];

  for (const name of legacyRootDocs) {
    assert.equal(exists(`Harness/${name}`), false, `dogfood legacy root spec doc exists: Harness/${name}`);
    assert.equal(exists(`templates/common/Harness/${name}`), false, `template legacy root spec doc exists: templates/common/Harness/${name}`);
  }

  const manifest = JSON.parse(read('Harness/ownership.manifest.json'));
  for (const entry of manifest.frameworkOwned) {
    assert.doesNotMatch(entry.path, /^Harness\/[^/]+\.md$/, `frameworkOwned root markdown should not be a spec doc: ${entry.path}`);
  }
});
