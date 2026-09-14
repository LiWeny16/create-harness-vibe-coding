import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeHarnessTempRoot } from './support/temp-root.js';

// task-implement-wf-search-093 — AC-003 / AC-004 / AC-005
//
// RED install/protection tests for /wf-search (0.9.3). These assertions run
// against the real repository files and the real root helper CLI. While the
// implementation is missing they must fail; they turn GREEN once surfaces,
// registry rows, protection patterns, mirrors, and the helper land.
//
// Write set of this file: tests/wf-search-install.test.js only.

const ROOT = path.resolve('.');
const ROOT_HELPER = path.join(ROOT, 'Harness', 'scripts', 'wf-search.mjs');
const TEMPLATE_HELPER = path.join(ROOT, 'templates', 'common', 'Harness', 'scripts', 'wf-search.mjs');
const TEMPLATE_LIB = path.join(ROOT, 'templates', 'common', 'Harness', 'scripts', 'lib', 'wf-search.mjs');
const FIXTURE_VALID = path.join(ROOT, 'tests', 'fixtures', 'wf-search', 'valid-compare.json');

const WF_SEARCH_ALIASES = ['/wf-search', '$wf-search', '/skills wf-search'];
const SKILL_REFERENCE_FILES = [
  'references/evidence-contract.md',
  'references/policies/compare.md',
  'references/policies/fact.md',
  'references/policies/troubleshoot.md',
  'references/policies/verify.md',
  'references/source-routing.md',
  'references/tool-adapters.md',
];

function abs(rel) {
  return path.join(ROOT, ...rel.split('/'));
}

function exists(rel) {
  return fs.existsSync(abs(rel));
}

function readRaw(rel) {
  return fs.readFileSync(abs(rel), 'utf8');
}

// CRLF-normalized read, mirroring the checksum/check-version convention so a
// root mirror synced with a different EOL policy still compares equal for .mjs.
function readNormalized(rel) {
  return readRaw(rel).replace(/\r\n/g, '\n');
}

function lineCount(text) {
  return text.replace(/\r\n/g, '\n').split('\n').length;
}

function walkFilesRel(rootAbs, base = '') {
  if (!fs.existsSync(rootAbs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(rootAbs, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkFilesRel(path.join(rootAbs, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

function listFilesRecursive(rootAbs, base = '') {
  if (!fs.existsSync(rootAbs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(rootAbs, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFilesRecursive(path.join(rootAbs, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

// Same extraction shape as tests/anti-drift.test.js extractStringArray.
function extractStringArray(text, name) {
  const match = text.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match, `${name} array should exist`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]).sort();
}

// Extract the raw source block of a const array (for regex-literal pattern
// groups that extractStringArray cannot see).
function extractArrayBlock(text, name) {
  const match = text.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match, `${name} array should exist`);
  return match[1];
}

// The literal text `/^Harness\/research\/search\//` as it must appear inside
// regex-literal pattern groups. Each `\\/` below is one backslash in the
// matched source text.
const SEARCH_PATTERN_SOURCE_TEXT = 'Harness\\/research\\/search\\/';

function runRootHelper(args, { cwd = ROOT, env } = {}) {
  return spawnSync(process.execPath, [ROOT_HELPER, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    env: env || process.env,
  });
}

function assertNoModuleCrash(result, label) {
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(
    combined,
    /Cannot find module|ERR_MODULE_NOT_FOUND/,
    `${label}: the root helper itself is missing or crashed on import; this rejection must come from the CLI contract, not a module error`,
  );
  return combined;
}

function fixtureAvailable() {
  return fs.existsSync(FIXTURE_VALID);
}

// Temp-leak guard contract (scripts/check-temp-leak.mjs): every dir created
// via makeHarnessTempRoot must be removed before the run ends.
const tempRoots = [];
function tmpRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  tempRoots.push(root);
  return root;
}
after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

// ================================================================ 1. template surfaces

test('AC-003 wf-search command wrappers exist, stay direct, and fit the 80-line budget', () => {
  const files = [
    'templates/common/.claude/commands/wf-search.md',
    'templates/common/.opencode/commands/wf-search.md',
  ];
  for (const rel of files) {
    assert.ok(exists(rel), `${rel} should exist`);
    const body = readRaw(rel);
    assert.match(body, /direct command/i, `${rel} should be marked as a direct command`);
    assert.match(body, /Do not invoke a skill/, `${rel} should not invoke a skill`);
    assert.ok(lineCount(body) <= 80, `${rel} exceeds the 80-line wrapper budget (${lineCount(body)} lines)`);
  }
  assert.equal(readRaw(files[0]), readRaw(files[1]), 'claude and opencode wrappers should carry the same content');
});

test('AC-003 wf-search skill frontmatter and the seven references exist within the 180-line budget', () => {
  const skillRel = 'templates/common/.claude/skills/wf-search/SKILL.md';
  assert.ok(exists(skillRel), `${skillRel} should exist`);
  const body = readRaw(skillRel);
  assert.match(body, /^---\r?\n/, 'SKILL.md should start with frontmatter');
  assert.match(body, /^name: wf-search$/m, 'SKILL.md frontmatter should declare name: wf-search');
  assert.ok(lineCount(body) <= 180, `SKILL.md exceeds the 180-line budget (${lineCount(body)} lines)`);

  for (const rel of SKILL_REFERENCE_FILES) {
    assert.ok(exists(`templates/common/.claude/skills/wf-search/${rel}`), `reference missing: ${rel}`);
  }

  const fileSet = walkFilesRel(abs('templates/common/.claude/skills/wf-search'));
  assert.deepEqual(
    fileSet,
    ['SKILL.md', ...SKILL_REFERENCE_FILES].sort(),
    'the skill payload should be exactly SKILL.md plus the seven references',
  );
});

test('AC-003 root dogfood command wrappers mirror the templates byte-identically', () => {
  const pairs = [
    ['.claude/commands/wf-search.md', 'templates/common/.claude/commands/wf-search.md'],
    ['.opencode/commands/wf-search.md', 'templates/common/.opencode/commands/wf-search.md'],
  ];
  for (const [rootRel, templateRel] of pairs) {
    assert.ok(exists(rootRel), `${rootRel} should exist`);
    assert.equal(readRaw(rootRel), readRaw(templateRel), `${rootRel} should be byte-identical to ${templateRel}`);
  }
});

test('AC-003 root skill mirrors (.claude and .agents) stay byte-identical with templates including references', () => {
  const templateFiles = walkFilesRel(abs('templates/common/.claude/skills/wf-search'));
  assert.ok(templateFiles.length > 0, 'templates/common/.claude/skills/wf-search should contain files');

  for (const rel of templateFiles) {
    const rootClaudeRel = `.claude/skills/wf-search/${rel}`;
    const rootAgentsRel = `.agents/skills/wf-search/${rel}`;
    assert.ok(exists(rootClaudeRel), `${rootClaudeRel} should exist`);
    assert.equal(
      readRaw(rootClaudeRel),
      readRaw(`templates/common/.claude/skills/wf-search/${rel}`),
      `${rootClaudeRel} should be byte-identical to its template`,
    );
    assert.ok(exists(rootAgentsRel), `${rootAgentsRel} should exist`);
    assert.equal(
      readRaw(rootAgentsRel),
      readRaw(rootClaudeRel),
      `${rootAgentsRel} should be byte-identical to ${rootClaudeRel}`,
    );
  }
});

test('AC-003 root wf-search scripts mirror the templates after CRLF normalization', () => {
  const pairs = [
    ['Harness/scripts/wf-search.mjs', 'templates/common/Harness/scripts/wf-search.mjs'],
    ['Harness/scripts/lib/wf-search.mjs', 'templates/common/Harness/scripts/lib/wf-search.mjs'],
  ];
  for (const [rootRel, templateRel] of pairs) {
    assert.ok(exists(templateRel), `${templateRel} should exist`);
    assert.ok(exists(rootRel), `${rootRel} should exist`);
    assert.equal(readNormalized(rootRel), readNormalized(templateRel), `${rootRel} should match ${templateRel} after CRLF normalization`);
  }
});

// ================================================================ 2. registry and doc rows

test('AC-003 command-surface registry registers wf-search as a direct no-capsule command', () => {
  const rootRegistry = readRaw('Harness/specs/runtime/command-surface.json');
  const templateRegistry = readRaw('templates/common/Harness/specs/runtime/command-surface.json');
  assert.equal(rootRegistry, templateRegistry, 'root and template command-surface.json should be byte-identical');

  const commands = JSON.parse(rootRegistry).commands;
  assert.ok(commands.length >= 18, `registry should carry at least 18 commands, found ${commands.length}`);
  const entry = commands.find(command => command.id === 'wf-search');
  assert.ok(entry, 'registry should contain a wf-search entry');
  assert.equal(entry.classification, 'direct');
  assert.equal(entry.entersWf, false);
  assert.equal(entry.taskCapsulePolicy, 'none');
  for (const alias of WF_SEARCH_ALIASES) {
    assert.ok(entry.aliases.includes(alias), `wf-search aliases missing ${alias}`);
  }
  for (const surface of ['claudeCommand', 'opencodeCommand', 'claudeSkill', 'codexSkill', 'helpRow']) {
    assert.equal(entry.surfaces[surface], true, `wf-search surfaces.${surface} should be true`);
  }
});

test('AC-003 wf-remove built-in registries cover the wf-search skill, command, and cleanup dirs', () => {
  const rootScript = readRaw('Harness/scripts/wf-remove.mjs');
  const templateScript = readRaw('templates/common/Harness/scripts/wf-remove.mjs');
  assert.equal(rootScript, templateScript, 'wf-remove.mjs root and template should be byte-identical');

  assert.ok(
    extractStringArray(rootScript, 'BUILT_IN_SKILL_NAMES').includes('wf-search'),
    'BUILT_IN_SKILL_NAMES should include wf-search',
  );
  assert.ok(
    extractStringArray(rootScript, 'BUILT_IN_COMMAND_NAMES').includes('wf-search'),
    'BUILT_IN_COMMAND_NAMES should include wf-search',
  );
  const cleanupDirs = extractStringArray(rootScript, 'CLEANUP_DIRS');
  assert.ok(cleanupDirs.includes('.claude/skills/wf-search'), 'CLEANUP_DIRS should include .claude/skills/wf-search');
  assert.ok(cleanupDirs.includes('.agents/skills/wf-search'), 'CLEANUP_DIRS should include .agents/skills/wf-search');
});

test('AC-003 CLAUDE.md direct alias list carries all three wf-search alias forms', () => {
  const rootBody = readRaw('CLAUDE.md');
  const templateBody = readRaw('templates/common/CLAUDE.md');
  assert.equal(rootBody, templateBody, 'root and template CLAUDE.md should be byte-identical');
  for (const alias of WF_SEARCH_ALIASES) {
    assert.ok(rootBody.includes(`\`${alias}\``), `CLAUDE.md missing alias ${alias}`);
  }
});

test('AC-003 ECC common.md exclusion line covers the three wf-search alias forms', () => {
  const rootBody = readRaw('.claude/rules/ecc/common.md');
  const templateBody = readRaw('templates/common/.claude/rules/ecc/common.md');
  assert.equal(rootBody, templateBody, 'root and template ECC common.md should be byte-identical');

  for (const body of [rootBody]) {
    const exclusionLine = body.split(/\r?\n/).find(line => line.includes('excluding')) || '';
    for (const alias of WF_SEARCH_ALIASES) {
      assert.ok(exclusionLine.includes(`\`${alias}\``), `ECC exclusion line missing ${alias}`);
    }
  }
});

test('AC-003 wf-help tables gain a wf-search row on both command surfaces', () => {
  const pairs = [
    ['.claude/commands/wf-help.md', 'templates/common/.claude/commands/wf-help.md'],
    ['.opencode/commands/wf-help.md', 'templates/common/.opencode/commands/wf-help.md'],
  ];
  for (const [rootRel, templateRel] of pairs) {
    const rootBody = readRaw(rootRel);
    const templateBody = readRaw(templateRel);
    assert.equal(rootBody, templateBody, `${rootRel} should be byte-identical to ${templateRel}`);
    assert.match(rootBody, /\|\s*`\/wf-search`/, `${rootRel} should carry a wf-search help table row`);
  }
});

test('AC-003 Harness README and MEMORY mention wf-search in root and templates', () => {
  for (const rel of ['Harness/README.md', 'templates/common/Harness/README.md']) {
    const body = readRaw(rel);
    assert.ok(body.includes('/wf-search'), `${rel} should mention /wf-search`);
    assert.ok(body.includes('$wf-search'), `${rel} should mention $wf-search`);
  }
  for (const rel of ['Harness/MEMORY.md', 'templates/common/Harness/MEMORY.md']) {
    assert.ok(readRaw(rel).includes('wf-search'), `${rel} should mention wf-search`);
  }
});

test('AC-003 user-facing README.md and README-CN.md document /wf-search', () => {
  for (const rel of ['README.md', 'README-CN.md']) {
    assert.ok(readRaw(rel).includes('/wf-search'), `${rel} should mention /wf-search`);
  }
});

// ================================================================ 3. protection rules

test('AC-004 generator CHECKSUM_EXCLUDE protects Harness/research/search/', () => {
  const block = extractArrayBlock(readRaw('src/generator.js'), 'CHECKSUM_EXCLUDE');
  assert.ok(
    block.includes(SEARCH_PATTERN_SOURCE_TEXT),
    'CHECKSUM_EXCLUDE should contain /^Harness\\/research\\/search\\//',
  );
});

test('AC-004 ownership-manifest PRESERVE_PATTERNS protect Harness/research/search/**', () => {
  const patterns = extractStringArray(readRaw('scripts/lib/ownership-manifest.mjs'), 'PRESERVE_PATTERNS');
  assert.ok(patterns.includes('Harness/research/search/**'), 'PRESERVE_PATTERNS should include Harness/research/search/**');
});

test('AC-004 wf-update-check PRESERVE_PATTERNS protect research/search in root and template mirrors', () => {
  const rootBody = readRaw('Harness/scripts/wf-update-check.mjs');
  const templateBody = readRaw('templates/common/Harness/scripts/wf-update-check.mjs');
  assert.equal(rootBody, templateBody, 'wf-update-check.mjs root and template should be byte-identical');

  const rootBlock = extractArrayBlock(rootBody, 'PRESERVE_PATTERNS');
  const templateBlock = extractArrayBlock(templateBody, 'PRESERVE_PATTERNS');
  assert.ok(rootBlock.includes(SEARCH_PATTERN_SOURCE_TEXT), 'root wf-update-check PRESERVE_PATTERNS should protect research/search');
  assert.ok(templateBlock.includes(SEARCH_PATTERN_SOURCE_TEXT), 'template wf-update-check PRESERVE_PATTERNS should protect research/search');
});

test('AC-004 wf-remove user-data and purgeable patterns protect research/search', () => {
  const body = readRaw('Harness/scripts/wf-remove.mjs');
  const userBlock = extractArrayBlock(body, 'USER_DATA_PATTERNS');
  const purgeableBlock = extractArrayBlock(body, 'PURGEABLE_HARNESS_DATA_PATTERNS');
  assert.ok(userBlock.includes(SEARCH_PATTERN_SOURCE_TEXT), 'USER_DATA_PATTERNS should protect research/search');
  assert.ok(purgeableBlock.includes(SEARCH_PATTERN_SOURCE_TEXT), 'PURGEABLE_HARNESS_DATA_PATTERNS should protect research/search');
});

test('AC-004 wf-remove dynamically preserves a search report by default', () => {
  const project = tmpRoot('wf-search-remove-dynamic-');
  const report = path.join(project, 'Harness', 'research', 'search', 'report-1.md');
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(path.join(project, 'Harness', '.harness-version'), JSON.stringify({ generator: '0.9.3', checksums: {} }), 'utf8');
  fs.writeFileSync(report, '# retained search report\n', 'utf8');
  const result = spawnSync(process.execPath, [abs('Harness/scripts/wf-remove.mjs'), '--json'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, WF_ROOT: project },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const plan = JSON.parse(result.stdout.trim());
  assert.ok(plan.user.includes('Harness/research/search/report-1.md'), `search report should be preserved: ${result.stdout}`);
  assert.ok(fs.existsSync(report), 'dry-run must leave the search report on disk');
});

test('AC-004 ownership manifests (root and template) preserve Harness/research/search/**', () => {
  for (const rel of ['Harness/ownership.manifest.json', 'templates/common/Harness/ownership.manifest.json']) {
    const manifest = JSON.parse(readRaw(rel));
    assert.ok(
      Array.isArray(manifest.preserve) && manifest.preserve.includes('Harness/research/search/**'),
      `${rel} preserve array should include Harness/research/search/**`,
    );
  }
});

// ================================================================ 4. helper executable + global bridge

test('AC-003 root helper validates the W1 compare fixture', t => {
  if (!fixtureAvailable()) {
    t.skip('W1 fixture tests/fixtures/wf-search/valid-compare.json not written yet');
    return;
  }
  const result = runRootHelper(['validate', '--input', FIXTURE_VALID, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.ok, true);
});

test('AC-003 helper runs from an isolated global runtime root over a slim project bridge', t => {
  if (!fixtureAvailable()) {
    t.skip('W1 fixture tests/fixtures/wf-search/valid-compare.json not written yet');
    return;
  }
  assert.ok(fs.existsSync(TEMPLATE_HELPER), 'template helper should exist before it can be installed into a global runtime');
  assert.ok(fs.existsSync(TEMPLATE_LIB), 'template lib should exist before it can be installed into a global runtime');

  const globalDir = tmpRoot('wf-search-global-');
  fs.mkdirSync(path.join(globalDir, 'Harness', 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(TEMPLATE_HELPER, path.join(globalDir, 'Harness', 'scripts', 'wf-search.mjs'));
  fs.copyFileSync(TEMPLATE_LIB, path.join(globalDir, 'Harness', 'scripts', 'lib', 'wf-search.mjs'));

  // Slim project bridge: only Harness/.harness-version (pointing at the global
  // runtime) and an empty Harness/scripts, i.e. no local wf-search helper.
  const bridgeDir = tmpRoot('wf-search-bridge-');
  fs.mkdirSync(path.join(bridgeDir, 'Harness', 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(bridgeDir, 'Harness', '.harness-version'),
    JSON.stringify({ generator: '0.9.3', globalDir }, null, 2),
    'utf8',
  );

  const result = spawnSync(process.execPath, [
    path.join(globalDir, 'Harness', 'scripts', 'wf-search.mjs'),
    'validate', '--input', FIXTURE_VALID, '--json',
  ], {
    cwd: bridgeDir,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, HARNESS_GLOBAL_HOME: globalDir },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.ok, true, 'the helper must run from the global runtime path, independent of the bridge cwd');
});

test('AC-003 root helper --help exits zero', () => {
  const result = runRootHelper(['--help']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('AC-003 root helper validate fails with a clear input error for a missing input file', () => {
  const missingInput = path.join(tmpRoot('wf-search-missing-input-'), 'nope.json');
  const result = runRootHelper(['validate', '--input', missingInput, '--json']);
  assert.equal(result.status, 1, result.stdout);
  const combined = assertNoModuleCrash(result, 'missing input');
  assert.match(combined, /input|not found|missing|exist|read/i, 'missing input should be reported as an input error');
});

// ================================================================ 5. resolve-save-target path safety

test('AC-004 resolve-save-target accepts a safe id without creating any directory', () => {
  const project = tmpRoot('wf-search-save-ok-');
  fs.mkdirSync(path.join(project, 'Harness'), { recursive: true });
  const before = listFilesRecursive(project).sort();

  const result = runRootHelper(['resolve-save-target', '--project', project, '--id', 'good-report-1']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout.trim());
  const flat = JSON.stringify(output).replaceAll('\\', '/');
  assert.match(flat, /Harness\/research\/search\/good-report-1/, 'resolved research path should target Harness/research/search/<id>');
  assert.ok(!fs.existsSync(path.join(project, 'Harness', 'research')), 'resolve-save-target must not create Harness/research');
  assert.deepEqual(listFilesRecursive(project).sort(), before, 'resolve-save-target must not create any file or directory');
});

test('AC-004 resolve-save-target rejects traversal, slash-containing, and empty task ids', () => {
  const project = tmpRoot('wf-search-save-bad-');
  fs.mkdirSync(path.join(project, 'Harness'), { recursive: true });
  const before = listFilesRecursive(project).sort();

  const cases = [
    { args: ['--project', project, '--id', '../evil'], label: 'traversal id' },
    { args: ['--project', project, '--id', 'abs/path'], label: 'slash-containing id' },
    { args: ['--project', project, '--task', '', '--id', 'x'], label: 'empty task id' },
  ];
  for (const item of cases) {
    const result = runRootHelper(['resolve-save-target', ...item.args]);
    assert.equal(result.status, 1, `${item.label} should be rejected: ${result.stdout}`);
    const combined = assertNoModuleCrash(result, item.label);
    assert.match(combined, /id|task|invalid|escape|exist|not found|missing/i, `${item.label} rejected without an explanation`);
  }
  assert.deepEqual(listFilesRecursive(project).sort(), before, 'rejected resolutions must not create any file or directory');
});

test('AC-004 resolve-save-target rejects a junction escape of Harness/research', t => {
  const outside = tmpRoot('wf-search-outside-');
  const project = tmpRoot('wf-search-junction-');
  fs.mkdirSync(path.join(project, 'Harness'), { recursive: true });
  // Windows-safe directory link: junctions need no privilege. If junction
  // creation is unavailable (non-Windows without symlink permission), skip
  // rather than misreport.
  try {
    fs.symlinkSync(outside, path.join(project, 'Harness', 'research'), 'junction');
  } catch (error) {
    t.skip(`cannot create junction/symlink for the escape fixture: ${error.code || error.message}`);
    return;
  }

  const result = runRootHelper(['resolve-save-target', '--project', project, '--id', 'good-report-1']);
  assert.equal(result.status, 1, `a junctioned Harness/research must not be accepted as a save root: ${result.stdout}`);
  assertNoModuleCrash(result, 'junction escape');
});

test('AC-004 resolve-save-target rejects a dangling link of Harness/research', t => {
  const project = tmpRoot('wf-search-dangling-');
  fs.mkdirSync(path.join(project, 'Harness'), { recursive: true });
  // A link pointing at a target that does not exist must still be rejected:
  // existsSync skips dangling links, so path validation must not treat the
  // link as a plain directory. Junctions need no privilege on Windows; skip
  // when link creation is unavailable (non-Windows without symlink rights).
  try {
    fs.symlinkSync(path.join(project, 'Harness', 'no-such-target'), path.join(project, 'Harness', 'research'), 'junction');
  } catch (error) {
    t.skip(`cannot create junction/symlink for the dangling fixture: ${error.code || error.message}`);
    return;
  }

  const result = runRootHelper(['resolve-save-target', '--project', project, '--id', 'good-report-1']);
  assert.equal(result.status, 1, `a dangling-link Harness/research must not be accepted as a save root: ${result.stdout}`);
  assertNoModuleCrash(result, 'dangling link escape');
});

// ================================================================ 6. npm pack coverage

function assertPacked(output, posixPath) {
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const winPath = posixPath.replaceAll('/', '\\');
  assert.match(
    output,
    new RegExp(`${escape(posixPath)}|${escape(winPath)}`),
    `npm pack should ship ${posixPath}`,
  );
}

test('AC-005 npm pack ships the wf-search helper, command, and skill references', () => {
  const result =
    process.platform === 'win32'
      ? spawnSync('npm pack --dry-run', { encoding: 'utf8', shell: true })
      : spawnSync('npm', ['pack', '--dry-run'], { encoding: 'utf8' });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);

  assertPacked(output, 'templates/common/Harness/scripts/wf-search.mjs');
  assertPacked(output, 'templates/common/Harness/scripts/lib/wf-search.mjs');
  assertPacked(output, 'templates/common/.claude/commands/wf-search.md');
  assertPacked(output, 'templates/common/.claude/skills/wf-search/SKILL.md');
  assert.match(
    output,
    /templates[/\\]common[/\\]\.claude[/\\]skills[/\\]wf-search[/\\]references[/\\]/,
    'npm pack should ship at least one wf-search skill reference file',
  );
});
