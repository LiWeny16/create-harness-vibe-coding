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

function extractStringArray(text, name) {
  const match = text.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match, `${name} array should exist`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]).sort();
}

function numberedStepCount(text) {
  return [...text.matchAll(/^\d+\. /gm)].length;
}

test('wf-update direct command wrappers carry the canonical 8-step flow', () => {
  const files = [
    '.claude/commands/wf-update.md',
    '.opencode/commands/wf-update.md',
    'templates/common/.claude/commands/wf-update.md',
    'templates/common/.opencode/commands/wf-update.md',
  ];
  const bodies = files.map(read);

  for (const [idx, body] of bodies.entries()) {
    assert.equal(numberedStepCount(body), 8, `${files[idx]} should have 8 numbered update steps`);
    for (const marker of [
      '## Cache Discipline',
      'agent.safeApplyCommand',
      '--apply-safe',
      'agent.aiMergeRequired',
      '--accept-local',
      '--accept-merged',
      '--accept-template',
      '--finalize',
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

test('ECC /wf wildcard rule keeps direct command exemptions explicit', () => {
  for (const rel of [
    '.claude/rules/ecc/common.md',
    'templates/common/.claude/rules/ecc/common.md',
  ]) {
    const body = read(rel);
    assert.match(body, /excluding `\/wf-help` and `\/wf-update`/);
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
});

test('route-critical template and dogfood files stay byte-identical', () => {
  const pairs = [
    ['CLAUDE.md', 'templates/common/CLAUDE.md'],
    ['.claude/rules/ecc/common.md', 'templates/common/.claude/rules/ecc/common.md'],
    ['.claude/commands/wf-help.md', 'templates/common/.claude/commands/wf-help.md'],
    ['.opencode/commands/wf-help.md', 'templates/common/.opencode/commands/wf-help.md'],
    ['.claude/commands/wf-update.md', 'templates/common/.claude/commands/wf-update.md'],
    ['.opencode/commands/wf-update.md', 'templates/common/.opencode/commands/wf-update.md'],
    ['Harness/context-loading.md', 'templates/common/Harness/context-loading.md'],
    ['Harness/scripts/context-budget.mjs', 'templates/common/Harness/scripts/context-budget.mjs'],
    ['Harness/scripts/l2-cache-telemetry.mjs', 'templates/common/Harness/scripts/l2-cache-telemetry.mjs'],
    ['Harness/scripts/wf-remove.mjs', 'templates/common/Harness/scripts/wf-remove.mjs'],
    ['Harness/scripts/validate-harness.mjs', 'templates/common/Harness/scripts/validate-harness.mjs'],
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
