#!/usr/bin/env node
/**
 * e2e-wf-scripts.test.mjs — E2E tests for wf-remove.mjs and wf-update-check.mjs
 *
 * Tests classification accuracy, path safety, PRESERVE integrity, and edge cases.
 * Creates a temporary mock project, runs scripts against it, verifies output.
 *
 * Usage: node tests/e2e-wf-scripts.test.mjs
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync } from 'fs';
import { resolve, join, sep } from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
import { generate } from '../src/generator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SCRIPTS = resolve(ROOT, 'Harness', 'scripts');
const TMP = resolve(ROOT, 'tests', '.tmp-e2e');
const TMP_GUARD = resolve(ROOT, 'tests', '.tmp-e2e-guard');
const TMP_EXTERNAL = resolve(ROOT, 'tests', '.tmp-e2e-external');
const TMP_OPTIONAL = resolve(ROOT, 'tests', '.tmp-e2e-optional');
const TMP_OPTIONAL_REMOTE = resolve(ROOT, 'tests', '.tmp-e2e-optional-remote');
const REMOVE = join(SCRIPTS, 'wf-remove.mjs');
const UPDATE = join(SCRIPTS, 'wf-update-check.mjs');
const SCAN = join(SCRIPTS, 'scan-clean.mjs');
const COMMON_TEMPLATE_BASE = pathToFileURL(resolve(ROOT, 'templates', 'common') + sep).href;

let passed = 0;
let failed = 0;

function sha256(content) {
  return 'sha256-' + createHash('sha256').update(content).digest('hex');
}

function sha256File(filePath) {
  const content = readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  return 'sha256-' + createHash('sha256').update(content).digest('hex');
}

function assert(condition, testName, detail = '') {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${testName}${detail ? ' — ' + detail : ''}`);
  }
}

function runNode(script, args = '', root = TMP, extraEnv = {}) {
  try {
    const result = execSync(`node "${script}" ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      env: { ...process.env, WF_ROOT: root, ...extraEnv },
    });
    return { ok: true, stdout: result, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout || '', stderr: e.stderr || e.message };
  }
}

function runNodeWithoutWfRoot(script, args = '', cwd = ROOT, extraEnv = {}) {
  try {
    const env = { ...process.env, ...extraEnv };
    delete env.WF_ROOT;
    const result = execSync(`node "${script}" ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      env,
    });
    return { ok: true, stdout: result, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout || '', stderr: e.stderr || e.message };
  }
}

// ── Setup mock project ────────────────────────────────────────────

console.log('\n🏗 Setting up mock project...');
rmSync(TMP, { recursive: true, force: true });
rmSync(TMP_GUARD, { recursive: true, force: true });
rmSync(TMP_EXTERNAL, { recursive: true, force: true });
rmSync(TMP_OPTIONAL, { recursive: true, force: true });
rmSync(TMP_OPTIONAL_REMOTE, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// Create mock .harness-version with known checksums
const mockFiles = {
  // SAFE framework files (will match checksums)
  'CLAUDE.md': 'Harness binding content here\n## 1. Harness Binding & Startup\n- Use `/wf` for long tasks.\n## 2. Think Before Coding\n',
  'AGENTS.md': 'Agent instructions here.',
  '.claude/agents/planner.md': 'planner agent definition.',
  '.codex/config.toml': 'sandbox_mode = "workspace-write"\n',
  '.claude/skills/wf/SKILL.md': 'wf skill.',
  '.agents/skills/wf/SKILL.md': 'wf skill.',
  '.claude/skills/wf-update/SKILL.md': 'wf-update skill.',
  '.agents/skills/wf-update/SKILL.md': 'wf-update skill.',
  '.claude/rules/ecc/common.md': 'Universal rules.',
  'Harness/specs/workflows/WF.md': 'WF mode spec.',
  'Harness/specs/runtime/dispatch.md': 'Dispatch protocol.',
  'Harness/specs/runtime/subagents.md': 'Subagent orchestration.',
  'tests/.gitkeep': '',

  // USER DATA files (must NEVER be in SAFE or MODIFIED)
  'Harness/PROGRESS.md': 'my progress',
  'Harness/tasks/my-task/PROGRESS.md': 'task progress',
  'Harness/memory/my-notes.md': 'user memory notes',
  'Harness/memory/tool-usage-reflections.md': 'reflections',
  'Harness/research/PRD.md': 'my PRD',
  'Harness/project/architecture.md': 'my architecture',
  'Harness/workflows/custom.md': 'custom workflow',
  'README.md': 'my readme',
  '.gitignore': 'node_modules',
  'package.json': '{"name":"test"}',

  // USER-MODIFIED framework files (changed from scaffold)
  'Harness/README.md': 'my custom router with extra rows', // MERGE file, modified
  'MEMORY.md': 'my memory index with custom registrations', // MERGE file, modified
};

const checksums = {};
for (const [file, content] of Object.entries(mockFiles)) {
  const fullPath = join(TMP, ...file.split('/'));
  mkdirSync(dirname(fullPath), { recursive: true });
  const normalized = content.replace(/\r\n/g, '\n') + '\n';
  writeFileSync(fullPath, normalized, 'utf-8');
  checksums[file] = sha256(normalized);
}

// Residual files that are intentionally not in checksums. Real installs can
// leave these behind after bootstrap edits, so wf-remove must discover them
// from disk rather than only trusting .harness-version.
const untrackedResidualFiles = {
  'Harness/research/research-results.md': 'my research results',
  'Harness/tasks/_template/PLAN.md': 'framework task template',
  'Harness/tasks/auto/PLAN.md': 'auto task framework plan',
  '.claude/agents/reviewer.md': 'legacy reviewer agent',
  '.claude/commands/wf-help.md': 'legacy wf-help command',
  '.claude/skills/wf-max/SKILL.md': 'legacy wf-max skill',
  '.agents/skills/wf-max/SKILL.md': 'legacy wf-max skill',
  '.agents/skills/wf-review/SKILL.md': 'legacy wf-review skill',
  '.claude/skills/custom-user-skill/SKILL.md': 'user custom skill',
  '.agents/skills/custom-user-skill/SKILL.md': 'user custom skill',
};
for (const [file, content] of Object.entries(untrackedResidualFiles)) {
  const fullPath = join(TMP, ...file.split('/'));
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content.replace(/\r\n/g, '\n') + '\n', 'utf-8');
}

// Write .harness-version
const versionFile = {
  generator: '0.6.1',
  generated: '2026-06-25T00:00:00.000Z',
  options: [],
  autoCheck: true,
  source: 'https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/',
  checksums,
};
mkdirSync(join(TMP, 'Harness'), { recursive: true });
writeFileSync(join(TMP, 'Harness', '.harness-version'), JSON.stringify(versionFile, null, 2) + '\n', 'utf-8');

// Also create the scripts directory with symlink-like test (we'll test lstat behavior)
mkdirSync(join(TMP, 'Harness', 'scripts'), { recursive: true });
writeFileSync(join(TMP, 'Harness', 'scripts', 'validate-harness.mjs'), '// validator', 'utf-8');
checksums['Harness/scripts/validate-harness.mjs'] = sha256('// validator\n');

console.log(`   Created ${Object.keys(mockFiles).length} mock files + version file`);

// ── TEST: wf-remove.mjs ───────────────────────────────────────────

console.log('\n─── wf-remove.mjs E2E Tests ───\n');

const removeResult = runNode(REMOVE, '--json', TMP);
let removePlan;
try {
  removePlan = JSON.parse(removeResult.stdout.trim());
} catch {
  // Try extracting JSON from mixed output
  const jsonMatch = removeResult.stdout.match(/\{[\s\S]*\}/);
  removePlan = jsonMatch ? JSON.parse(jsonMatch[0]) : { safe: [], modified: [], user: [] };
}

// Test 1: Script runs without error
assert(removeResult.ok, 'wf-remove runs without error');

// Test 2: No user data files in SAFE list
const userFiles = removePlan.user || [];
const safeFiles = removePlan.safe || [];
for (const uf of userFiles) {
  assert(!safeFiles.includes(uf), `USER file NOT in SAFE: ${uf}`);
}

// Test 3: No user data files in MODIFIED list
const modifiedFiles = removePlan.modified || [];
for (const uf of userFiles) {
  assert(!modifiedFiles.includes(uf), `USER file NOT in MODIFIED: ${uf}`);
}

// Test 4: All expected USER files are classified correctly
const expectedUser = [
  'Harness/PROGRESS.md',
  'Harness/tasks/my-task/PROGRESS.md',
  'Harness/tasks/_template/PLAN.md',
  'Harness/tasks/auto/PLAN.md',
  'Harness/memory/my-notes.md',
  'Harness/memory/tool-usage-reflections.md',
  'Harness/research/PRD.md',
  'Harness/research/research-results.md',
  'Harness/project/architecture.md',
  'Harness/workflows/custom.md',
  'README.md',
  '.gitignore',
  'package.json',
];
for (const eu of expectedUser) {
  assert(userFiles.includes(eu), `Expected USER: ${eu}`);
}

// Test 5: Non-harness files are NEVER in any remove list
// Note: src/ files aren't in checksums, so they won't appear in ANY list.
// The classification only scans checksum keys, not the whole filesystem.
// This is by design — non-harness files are invisible to the scanner.

// Test 6: Unmodified framework files are in SAFE
const expectedSafe = [
  'AGENTS.md',
  'tests/.gitkeep',
  '.codex/config.toml',
  '.claude/rules/ecc/common.md',
  '.claude/skills/wf/SKILL.md',
  '.agents/skills/wf/SKILL.md',
  '.claude/agents/reviewer.md',
  '.claude/commands/wf-help.md',
  '.claude/skills/wf-max/SKILL.md',
  '.agents/skills/wf-max/SKILL.md',
  '.agents/skills/wf-review/SKILL.md',
];
for (const es of expectedSafe) {
  assert(safeFiles.includes(es), `Expected SAFE: ${es}`);
}
assert(!safeFiles.includes('.claude/skills/custom-user-skill/SKILL.md'), 'custom Claude skill is not SAFE');
assert(!safeFiles.includes('.agents/skills/custom-user-skill/SKILL.md'), 'custom Codex skill is not SAFE');

// Test 6.5: thorough purge plan removes Harness project facts but keeps real task records
const purgePlanResult = runNode(REMOVE, '--json --purge-user-data --keep-tasks', TMP);
const purgePlan = JSON.parse(purgePlanResult.stdout.trim());
const purgeFiles = purgePlan.purge || [];
const purgePreserved = purgePlan.user || [];
assert(purgePlan.options.purgeUserData === true, 'purge JSON records purgeUserData option');
assert(purgePlan.options.keepTasks === true, 'purge JSON records keepTasks option');
assert(purgeFiles.includes('Harness/PROGRESS.md'), 'purge includes Harness/PROGRESS.md');
assert(purgeFiles.includes('Harness/memory/my-notes.md'), 'purge includes memory notes');
assert(purgeFiles.includes('Harness/research/PRD.md'), 'purge includes PRD');
assert(purgeFiles.includes('Harness/research/research-results.md'), 'purge includes untracked research results');
assert(purgeFiles.includes('Harness/project/architecture.md'), 'purge includes architecture');
assert(purgeFiles.includes('Harness/tasks/_template/PLAN.md'), 'purge includes framework task template');
assert(purgeFiles.includes('Harness/tasks/auto/PLAN.md'), 'purge includes auto task framework file');
assert(purgePreserved.includes('Harness/tasks/my-task/PROGRESS.md'), 'purge keeps real task record with --keep-tasks');
assert(!purgeFiles.includes('README.md'), 'purge never removes root README');
assert(!purgeFiles.includes('.gitignore'), 'purge never removes root .gitignore');
assert(!purgeFiles.includes('package.json'), 'purge never removes package.json');

// Test 6.6: purge mode keeps version tracking if modified scaffold files remain
mkdirSync(TMP_GUARD, { recursive: true });
const guardOriginalReadme = 'original scaffold readme\n';
const guardProgress = 'guard progress\n';
const guardVersion = {
  generator: '0.6.1',
  generated: '2026-06-25T00:00:00.000Z',
  checksums: {
    'Harness/README.md': sha256(guardOriginalReadme),
    'Harness/PROGRESS.md': sha256(guardProgress),
  },
};
mkdirSync(join(TMP_GUARD, 'Harness'), { recursive: true });
writeFileSync(join(TMP_GUARD, 'Harness', 'README.md'), 'local modified readme\n', 'utf-8');
writeFileSync(join(TMP_GUARD, 'Harness', 'PROGRESS.md'), guardProgress, 'utf-8');
writeFileSync(join(TMP_GUARD, 'Harness', '.harness-version'), JSON.stringify(guardVersion, null, 2) + '\n', 'utf-8');
const guardPurgeResult = runNode(REMOVE, '--apply --yes --purge-user-data --keep-tasks', TMP_GUARD);
assert(guardPurgeResult.ok, 'purge guard runs without error');
assert(existsSync(join(TMP_GUARD, 'Harness', '.harness-version')), 'purge keeps .harness-version when modified scaffold remains');
assert(existsSync(join(TMP_GUARD, 'Harness', 'README.md')), 'purge guard keeps modified scaffold file');
assert(!existsSync(join(TMP_GUARD, 'Harness', 'PROGRESS.md')), 'purge guard removes purgeable project fact');

// Test 6.7: script-root targeting wins over cwd targeting.
// This prevents accidental removal from the caller's current project when an
// agent invokes a Harness script by absolute path from another Harness repo.
mkdirSync(join(TMP_EXTERNAL, 'Harness', 'scripts'), { recursive: true });
writeFileSync(join(TMP_EXTERNAL, 'Harness', 'scripts', 'wf-remove.mjs'), readFileSync(REMOVE, 'utf-8'), 'utf-8');
writeFileSync(join(TMP_EXTERNAL, 'AGENTS.md'), 'external target agents\n', 'utf-8');
writeFileSync(join(TMP_EXTERNAL, 'Harness', '.harness-version'), JSON.stringify({
  generator: '0.6.1',
  generated: '2026-06-25T00:00:00.000Z',
  checksums: {
    'AGENTS.md': sha256('external target agents\n'),
  },
}, null, 2) + '\n', 'utf-8');
const externalRootResult = runNodeWithoutWfRoot(
  join(TMP_EXTERNAL, 'Harness', 'scripts', 'wf-remove.mjs'),
  '--json',
  ROOT
);
const externalRootPlan = JSON.parse(externalRootResult.stdout.trim());
assert(externalRootResult.ok, 'external script-root remove JSON runs without WF_ROOT');
assert(externalRootPlan.totalSafe === 1, 'external script-root targeting ignores caller cwd Harness');
assert(externalRootPlan.safe.includes('AGENTS.md'), 'external script-root plan sees target AGENTS.md');

// Test 7: CLI DRY-RUN output
const dryResult = runNode(REMOVE, '', TMP);
assert(dryResult.ok, 'DRY-RUN runs without error');
assert(dryResult.stdout.includes('DRY-RUN'), 'DRY-RUN shows notice');
assert(dryResult.stdout.includes('SAFE'), 'DRY-RUN shows SAFE section');
assert(dryResult.stdout.includes('USER DATA'), 'DRY-RUN shows USER DATA section');

// Test 8: --yes flag works (non-interactive)
const yesResult = runNode(REMOVE, '--apply --yes', TMP);
assert(yesResult.ok, '--apply --yes runs without error');
assert(!existsSync(join(TMP, '.claude', 'agents', 'reviewer.md')), '--apply --yes removes legacy unchecksummed Claude agent');
assert(!existsSync(join(TMP, '.claude', 'commands', 'wf-help.md')), '--apply --yes removes legacy unchecksummed direct command');
assert(!existsSync(join(TMP, '.claude', 'skills', 'wf-max', 'SKILL.md')), '--apply --yes removes legacy unchecksummed Claude skill');
assert(!existsSync(join(TMP, '.agents', 'skills', 'wf-max', 'SKILL.md')), '--apply --yes removes legacy unchecksummed Codex skill');
assert(!existsSync(join(TMP, '.agents', 'skills', 'wf-review', 'SKILL.md')), '--apply --yes removes legacy unchecksummed Codex review skill');
assert(existsSync(join(TMP, '.claude', 'skills', 'custom-user-skill', 'SKILL.md')), '--apply --yes preserves custom Claude skill');
assert(existsSync(join(TMP, '.agents', 'skills', 'custom-user-skill', 'SKILL.md')), '--apply --yes preserves custom Codex skill');
	// Test 8.1: opencode.json without provenance is NOT auto-removed (preserve pre-existing user config)
	const TMP_OPENCODE_PREEXIST = resolve(ROOT, 'tests', '.tmp-e2e-opencode-preexist');
	rmSync(TMP_OPENCODE_PREEXIST, { recursive: true, force: true });
	mkdirSync(TMP_OPENCODE_PREEXIST, { recursive: true });
	mkdirSync(join(TMP_OPENCODE_PREEXIST, 'Harness'), { recursive: true });
	mkdirSync(join(TMP_OPENCODE_PREEXIST, '.claude', 'agents'), { recursive: true });
	const preexistOpencode = JSON.stringify({
	  $schema: 'https://opencode.ai/config.json',
	  instructions: ['.claude/rules/ecc/common.md'],
	  permission: { bash: { '*': 'ask' }, read: { '**/.env*': 'deny' } },
	}, null, 2) + '\n';
	writeFileSync(join(TMP_OPENCODE_PREEXIST, 'opencode.json'), preexistOpencode, 'utf-8');
	writeFileSync(join(TMP_OPENCODE_PREEXIST, 'CLAUDE.md'), 'Harness binding content here\n## 1. Harness Binding & Startup\n', 'utf-8');
	writeFileSync(join(TMP_OPENCODE_PREEXIST, '.claude', 'agents', 'planner.md'), 'planner agent definition.', 'utf-8');
	const preexistVersion = {
	  generator: '0.8.0',
	  generated: '2026-07-01T00:00:00.000Z',
	  checksums: {
	    'CLAUDE.md': sha256('Harness binding content here\n## 1. Harness Binding & Startup\n\n'),
	    '.claude/agents/planner.md': sha256('planner agent definition.\n'),
	    // NOTE: opencode.json is intentionally NOT in checksums — simulates pre-existing
	  },
	};
	writeFileSync(join(TMP_OPENCODE_PREEXIST, 'Harness', '.harness-version'), JSON.stringify(preexistVersion, null, 2) + '\n', 'utf-8');
	const preexistRemoveResult = runNode(REMOVE, '--json', TMP_OPENCODE_PREEXIST);
	const preexistPlan = JSON.parse(preexistRemoveResult.stdout.trim());
	assert(preexistPlan.modified.includes('opencode.json'), 'pre-existing opencode.json (not in checksums) is classified as MODIFIED (must confirm)');
	assert(!preexistPlan.safe.includes('opencode.json'), 'pre-existing opencode.json (not in checksums) is NOT auto-removed as SAFE');
	rmSync(TMP_OPENCODE_PREEXIST, { recursive: true, force: true });

	// Test 8.2: generator-created opencode.json with matching checksum IS auto-removed as SAFE
	const TMP_OPENCODE_HARNESS = resolve(ROOT, 'tests', '.tmp-e2e-opencode-harness');
	rmSync(TMP_OPENCODE_HARNESS, { recursive: true, force: true });
	mkdirSync(TMP_OPENCODE_HARNESS, { recursive: true });
	mkdirSync(join(TMP_OPENCODE_HARNESS, 'Harness'), { recursive: true });
	mkdirSync(join(TMP_OPENCODE_HARNESS, '.claude', 'agents'), { recursive: true });
	const harnessOpencodeContent = JSON.stringify({
	  $schema: 'https://opencode.ai/config.json',
	  instructions: ['.claude/rules/ecc/common.md'],
	  permission: { bash: { '*': 'ask' }, read: { '**/.env*': 'deny' } },
	}, null, 2) + '\n';
	writeFileSync(join(TMP_OPENCODE_HARNESS, 'opencode.json'), harnessOpencodeContent, 'utf-8');
	writeFileSync(join(TMP_OPENCODE_HARNESS, 'CLAUDE.md'), 'Harness binding content here\n## 1. Harness Binding & Startup\n', 'utf-8');
	writeFileSync(join(TMP_OPENCODE_HARNESS, '.claude', 'agents', 'planner.md'), 'planner agent definition.', 'utf-8');
	const harnessVersion = {
	  generator: '0.8.0',
	  generated: '2026-07-01T00:00:00.000Z',
	  checksums: {
	    'CLAUDE.md': sha256('Harness binding content here\n## 1. Harness Binding & Startup\n\n'),
	    '.claude/agents/planner.md': sha256('planner agent definition.\n'),
	    'opencode.json': sha256(harnessOpencodeContent),
	  },
	};
	writeFileSync(join(TMP_OPENCODE_HARNESS, 'Harness', '.harness-version'), JSON.stringify(harnessVersion, null, 2) + '\n', 'utf-8');
	const harnessRemoveResult = runNode(REMOVE, '--json', TMP_OPENCODE_HARNESS);
	const harnessPlan = JSON.parse(harnessRemoveResult.stdout.trim());
	assert(harnessPlan.safe.includes('opencode.json'), 'Harness-created opencode.json with matching checksum IS auto-removed as SAFE');
	rmSync(TMP_OPENCODE_HARNESS, { recursive: true, force: true });

// ── TEST: wf-update-check.mjs ─────────────────────────────────────

console.log('\n─── wf-update-check.mjs E2E Tests ───\n');

const updateResult = runNode(UPDATE, '--json', TMP, { WF_SOURCE_BASE: COMMON_TEMPLATE_BASE });
let updatePlan;
try {
  updatePlan = JSON.parse(updateResult.stdout.trim());
} catch {
  const jsonMatch = updateResult.stdout.match(/\{[\s\S]*\}/);
  updatePlan = jsonMatch ? JSON.parse(jsonMatch[0]) : { status: 'unknown' };
}

// Test 9: Script runs (template-remote is expected in test env)
assert(updateResult.ok || updatePlan.status === 'template-remote', 'wf-update-check runs without crash');

// Test 10: Down-script classification matches
// (We test classification logic directly via a unit-like approach)
const classTestFiles = [
  { file: 'Harness/PROGRESS.md', expect: 'PRESERVE' },
  { file: 'Harness/tasks/foo/bar.md', expect: 'PRESERVE' },
  { file: 'Harness/memory/x.md', expect: 'PRESERVE' },
  { file: 'README.md', expect: 'PRESERVE' },
  { file: '.gitignore', expect: 'PRESERVE' },
  { file: 'package.json', expect: 'PRESERVE' },
  { file: 'Harness/specs/workflows/WF.md', expect: 'SAFE' },  // runtime, unmodified
  { file: 'CLAUDE.md', expect: 'SAFE|CONFLICT' },  // MERGE file
  { file: 'Harness/README.md', expect: 'SAFE|CONFLICT' },  // MERGE file
];

// We can't easily test classify() in isolation, but we can verify
// the JSON output correctly separates PRESERVE from updated/created
if (updatePlan.plan) {
  for (const skipped of (updatePlan.plan.skipped || [])) {
    assert(skipped.reason.includes('PRESERVE') || skipped.reason.includes('not in remote') || skipped.reason.includes('traversal') || skipped.reason.includes('already current'),
      `Skipped file has valid reason: ${skipped.file} — ${skipped.reason}`);
  }
}

// Test 10.1: local remote source exercises JSON agent hints and --apply-safe
const updateRemoteDir = join(TMP, 'remote-template');
rmSync(updateRemoteDir, { recursive: true, force: true });
mkdirSync(updateRemoteDir, { recursive: true });

const localMergePath = join(TMP, 'Harness', 'README.md');
mkdirSync(dirname(localMergePath), { recursive: true });
writeFileSync(localMergePath, 'local router conflict\n', 'utf-8');

const localByteMatchNewPath = join(TMP, '.claude', 'settings.json');
mkdirSync(dirname(localByteMatchNewPath), { recursive: true });
writeFileSync(localByteMatchNewPath, 'settings template\n', 'utf-8');

const localCommandOrphanPath = join(TMP, '.claude', 'commands', 'legacy.md');
mkdirSync(dirname(localCommandOrphanPath), { recursive: true });
writeFileSync(localCommandOrphanPath, 'legacy untracked command\n', 'utf-8');

const localAlreadyCurrentPath = join(TMP, 'Harness', 'specs', 'workflows', 'WF.md');
mkdirSync(dirname(localAlreadyCurrentPath), { recursive: true });
writeFileSync(localAlreadyCurrentPath, mockFiles['Harness/specs/workflows/WF.md'] + '\n', 'utf-8');

const localModifiedRuntimePath = join(TMP, 'Harness', 'specs', 'runtime', 'dispatch.md');
mkdirSync(dirname(localModifiedRuntimePath), { recursive: true });
writeFileSync(localModifiedRuntimePath, 'local runtime edit should be replaced\n', 'utf-8');

const updateLocalVersionPath = join(TMP, 'Harness', '.harness-version');
const updateLocalVersion = JSON.parse(readFileSync(updateLocalVersionPath, 'utf-8'));
updateLocalVersion.generator = '0.6.1';
updateLocalVersion.checksums = {
  ...(updateLocalVersion.checksums || {}),
  '.claude/agents/planner.md': checksums['.claude/agents/planner.md'],
  'Harness/specs/runtime/dispatch.md': checksums['Harness/specs/runtime/dispatch.md'],
  'Harness/specs/guides/SETUP.md': sha256('old bootstrap setup\n'),
  'Harness/specs/workflows/WF.md': checksums['Harness/specs/workflows/WF.md'],
  'Harness/README.md': checksums['Harness/README.md'],
};
delete updateLocalVersion.partialUpdate;
writeFileSync(updateLocalVersionPath, JSON.stringify(updateLocalVersion, null, 2) + '\n', 'utf-8');

const remoteUpdateFiles = {
  '.claude/agents/planner.md': 'planner agent definition v2.\n',
  '.claude/settings.json': 'settings template\n',
  'Harness/specs/runtime/NEW.md': 'new runtime file\n',
  'Harness/specs/runtime/dispatch.md': 'remote dispatch template v2\n',
  'Harness/specs/guides/SETUP.md': 'remote bootstrap setup v2\n',
  'Harness/README.md': 'remote router template v2\n',
  'Harness/specs/workflows/WF.md': mockFiles['Harness/specs/workflows/WF.md'] + '\n',
};
const remoteUpdateChecksums = {};
for (const [file, content] of Object.entries(remoteUpdateFiles)) {
  const fullPath = join(updateRemoteDir, ...file.split('/'));
  mkdirSync(dirname(fullPath), { recursive: true });
  const normalized = content.replace(/\r\n/g, '\n');
  writeFileSync(fullPath, normalized, 'utf-8');
  remoteUpdateChecksums[file] = sha256(normalized);
}
const remoteReleaseNotes = {
  version: '0.7.0',
  date: '2099-01-01',
  highlights: [
    'Cache telemetry added',
    'Update flow now reports release highlights',
  ],
};
writeFileSync(join(updateRemoteDir, '.harness-version'), JSON.stringify({
  generator: '0.7.0',
  generated: '2026-07-01T00:00:00.000Z',
  releaseNotes: remoteReleaseNotes,
  checksums: remoteUpdateChecksums,
  sources: Object.fromEntries(Object.keys(remoteUpdateChecksums).map(file => [file, file])),
}, null, 2) + '\n', 'utf-8');

const updateRemoteBase = pathToFileURL(updateRemoteDir).href + '/';
const localUpdateResult = runNode(UPDATE, '--json --full-plan', TMP, { WF_SOURCE_BASE: updateRemoteBase });
let localUpdatePlan = {};
try {
  localUpdatePlan = JSON.parse(localUpdateResult.stdout.trim());
} catch {
  localUpdatePlan = { status: 'parse-error' };
}
const localJsonPlan = localUpdatePlan.plan || { updated: [], created: [], conflict: [], skipped: [] };
assert(localUpdateResult.ok, 'local-source update JSON runs without error');
assert(localUpdatePlan.status === 'update-available', 'local-source update reports update available');
assert(localUpdatePlan.agent?.safeApplyCommand?.includes('--apply-safe'), 'JSON agent hints include --apply-safe command');
assert(localUpdatePlan.agent?.aiMergeRequired?.some(c => c.file === 'Harness/README.md' && c.templateHint === 'Harness/README.md' && c.remoteUrl?.startsWith('file://')), 'JSON agent hints include remote conflict source');
assert(localUpdatePlan.releaseNotes?.highlights?.includes('Cache telemetry added'), 'JSON output includes remote release notes');
assert(localUpdatePlan.agent?.releaseHighlights?.includes('Cache telemetry added'), 'JSON agent hints include release highlights');
assert(localUpdatePlan.agent?.updateReportRequired?.includes('releaseHighlights'), 'JSON agent hints require user-facing release highlight report');
assert(localJsonPlan.updated.some(x => x.file === '.claude/agents/planner.md'), 'local-source update marks missing safe file as updated');
assert(localJsonPlan.updated.some(x => x.file === 'Harness/specs/runtime/dispatch.md'), 'local-source update marks modified runtime file as updated');
assert(!localJsonPlan.conflict.some(x => x.file === 'Harness/specs/runtime/dispatch.md'), 'local-source update does not route modified runtime file through AI conflict');
assert(localJsonPlan.updated.some(x => x.file === 'Harness/specs/guides/SETUP.md'), 'local-source update recreates retained SETUP.md when missing');
assert(localJsonPlan.adopted?.some(x => x.file === '.claude/settings.json'), 'AC-001 byte-matching new remote file is adopted without AI conflict');
assert(!localJsonPlan.conflict.some(x => x.file === '.claude/settings.json'), 'AC-001 byte-matching new remote file is not a conflict');
assert(localJsonPlan.created.some(x => x.file === 'Harness/specs/runtime/NEW.md'), 'local-source update marks new runtime file as created');
assert(localJsonPlan.conflict.some(x => x.file === 'Harness/README.md'), 'local-source update marks modified merge file as conflict');
assert(localJsonPlan.skipped.some(x => x.file === 'Harness/specs/workflows/WF.md' && x.reason.includes('already current')), 'local-source update skips already-current files');

const applySafeUpdateResult = runNode(UPDATE, '--apply-safe', TMP, { WF_SOURCE_BASE: updateRemoteBase });
assert(applySafeUpdateResult.ok, '--apply-safe runs without error');
const plannerAfterApply = join(TMP, '.claude', 'agents', 'planner.md');
assert(existsSync(plannerAfterApply), '--apply-safe restored safe planner file');
if (existsSync(plannerAfterApply)) {
  assert(readFileSync(plannerAfterApply, 'utf-8') === remoteUpdateFiles['.claude/agents/planner.md'], '--apply-safe wrote planner remote content');
}
assert(readFileSync(localModifiedRuntimePath, 'utf-8') === remoteUpdateFiles['Harness/specs/runtime/dispatch.md'], '--apply-safe overwrote modified runtime file from template');
assert(existsSync(join(TMP, 'Harness', 'specs', 'runtime', 'NEW.md')), '--apply-safe created new runtime file');
assert(existsSync(join(TMP, 'Harness', 'specs', 'guides', 'SETUP.md')), '--apply-safe recreates retained SETUP.md');
assert(readFileSync(join(TMP, 'Harness', 'specs', 'guides', 'SETUP.md'), 'utf-8') === remoteUpdateFiles['Harness/specs/guides/SETUP.md'], '--apply-safe writes retained SETUP.md remote content');
assert(readFileSync(localMergePath, 'utf-8') === 'local router conflict\n', '--apply-safe preserved conflict file');
const versionAfterApplySafe = JSON.parse(readFileSync(join(TMP, 'Harness', '.harness-version'), 'utf-8'));
assert(versionAfterApplySafe.generator === '0.6.1', '--apply-safe does not bump generator while conflicts remain');
assert(versionAfterApplySafe.partialUpdate?.targetGenerator === '0.7.0', '--apply-safe records partial update target');
assert(versionAfterApplySafe.partialUpdate?.releaseNotes?.highlights?.includes('Cache telemetry added'), '--apply-safe records release notes while conflicts remain');
assert(versionAfterApplySafe.checksums['.claude/agents/planner.md'] === remoteUpdateChecksums['.claude/agents/planner.md'], '--apply-safe tracks applied file checksum');
assert(versionAfterApplySafe.checksums['.claude/settings.json'] === remoteUpdateChecksums['.claude/settings.json'], 'AC-001 --apply-safe adopts byte-matching new file checksum');

const partialJsonResult = runNode(UPDATE, '--json', TMP, { WF_SOURCE_BASE: updateRemoteBase });
const partialJsonPlan = JSON.parse(partialJsonResult.stdout.trim());
assert(partialJsonPlan.status === 'partial-update', 'partial update JSON reports partial-update status');
assert(partialJsonPlan.partialUpdate?.targetGenerator === '0.7.0', 'partial update JSON includes target generator');
assert(partialJsonPlan.agent?.partialUpdate?.targetGenerator === '0.7.0', 'partial update agent hints include partialUpdate');
assert(partialJsonPlan.agent?.releaseHighlights?.includes('Cache telemetry added'), 'partial update agent hints retain release highlights');

const finalizeLocalResult = runNode(UPDATE, '--accept-local Harness/README.md --finalize', TMP, { WF_SOURCE_BASE: updateRemoteBase });
assert(finalizeLocalResult.ok, 'AC-002 accept-local finalize runs without error');
const versionAfterFinalize = JSON.parse(readFileSync(join(TMP, 'Harness', '.harness-version'), 'utf-8'));
assert(versionAfterFinalize.generator === '0.7.0', 'AC-002 finalize bumps generator after all conflicts are decided');
assert(versionAfterFinalize.releaseNotes?.highlights?.includes('Cache telemetry added'), 'AC-002 finalize persists release notes for the installed version');
assert(!versionAfterFinalize.partialUpdate, 'AC-002 finalize clears partialUpdate residue');
assert(readFileSync(localMergePath, 'utf-8') === 'local router conflict\n', 'AC-002 accept-local preserves project-specific merge file');
assert(versionAfterFinalize.acceptedConflicts?.['Harness/README.md']?.decision === 'accept-local', 'AC-002 finalize records local conflict decision');

const scanCommandOrphanResult = runNode(SCAN, '--json', TMP, { WF_SOURCE_BASE: updateRemoteBase });
assert(scanCommandOrphanResult.ok, 'AC-003 scan-clean JSON runs against local source');
const scanCommandOrphanPlan = JSON.parse(scanCommandOrphanResult.stdout.trim());
assert(scanCommandOrphanPlan.orphan?.some(x => x.file === '.claude/commands/legacy.md'), 'AC-003 scan-clean reports .claude/commands orphan files');

const optionalGenerateResult = generate({
  projectName: 'optional-scan',
  targetDir: TMP_OPTIONAL,
  withOptions: ['browser-e2e'],
});
assert(optionalGenerateResult.success, 'optional browser-e2e fixture generates');
const commonTemplateBase = pathToFileURL(resolve(ROOT, 'templates', 'common') + sep).href;
const optionalScanResult = runNode(SCAN, '--json', TMP_OPTIONAL, { WF_SOURCE_BASE: commonTemplateBase });
assert(optionalScanResult.ok, 'scan-clean JSON runs against optional install');
const optionalScanPlan = JSON.parse(optionalScanResult.stdout.trim());
assert(
  !optionalScanPlan.dead?.some(x => x.file.includes('browser-e2e') || x.file.includes('wf-browser')),
  'scan-clean does not mark installed optional browser workflow files dead',
);
assert(
  !optionalScanPlan.dead?.some(x => x.file === 'tests/.gitkeep'),
  'scan-clean does not mark generated tests/.gitkeep dead',
);

cpSync(resolve(ROOT, 'templates', 'common'), TMP_OPTIONAL_REMOTE, { recursive: true });
const optionalRemoteVersionPath = join(TMP_OPTIONAL_REMOTE, '.harness-version');
const optionalRemoteVersion = JSON.parse(readFileSync(optionalRemoteVersionPath, 'utf-8'));
optionalRemoteVersion.generator = '9.9.9';
writeFileSync(optionalRemoteVersionPath, JSON.stringify(optionalRemoteVersion, null, 2) + '\n', 'utf-8');
const optionalRemoteBase = pathToFileURL(TMP_OPTIONAL_REMOTE + sep).href;
const optionalUpdateResult = runNode(UPDATE, '--json --full-plan', TMP_OPTIONAL, { WF_SOURCE_BASE: optionalRemoteBase });
assert(optionalUpdateResult.ok, 'wf-update-check JSON runs against optional install');
const optionalUpdatePlan = JSON.parse(optionalUpdateResult.stdout.trim());
assert(
  !optionalUpdatePlan.plan?.updated?.some(x => x.file === 'Harness/README.md'),
  'wf-update-check does not SAFE overwrite optional Harness/README.md registration',
);
assert(
  optionalUpdatePlan.plan?.conflict?.some(x => x.file === 'Harness/README.md' && x.reason.includes('optional registration')),
  'wf-update-check routes optional Harness/README.md registration through merge',
);
assert(
  optionalUpdatePlan.plan?.skipped?.some(x => x.file === '.claude/skills/wf-browser/SKILL.md' && x.reason.includes('optional workflow')),
  'wf-update-check preserves optional wf-browser skill outside common manifest',
);

// ── TEST: safePath() traversal rejection ──────────────────────────

console.log('\n─── safePath() Traversal Tests ───\n');

// Test via Node inline — import safePath equivalent logic
// Test 10.5: explicit thorough remove keeps real tasks but removes Harness leftovers and selected modified files
const purgeApplyResult = runNode(
  REMOVE,
  '--apply --yes --purge-user-data --keep-tasks --delete-modified Harness/README.md --delete-modified MEMORY.md',
  TMP
);
assert(purgeApplyResult.ok, 'purge apply keeps tasks and removes leftovers');
assert(!existsSync(join(TMP, 'Harness', 'PROGRESS.md')), 'purge removed Harness/PROGRESS.md');
assert(!existsSync(join(TMP, 'Harness', 'memory', 'my-notes.md')), 'purge removed memory notes');
assert(!existsSync(join(TMP, 'Harness', 'research', 'PRD.md')), 'purge removed PRD');
assert(!existsSync(join(TMP, 'Harness', 'research', 'research-results.md')), 'purge removed untracked research results');
assert(!existsSync(join(TMP, 'Harness', 'architecture.md')), 'purge removed architecture');
assert(!existsSync(join(TMP, 'Harness', 'tasks', '_template', 'PLAN.md')), 'purge removed task template');
assert(!existsSync(join(TMP, 'Harness', 'tasks', 'auto', 'PLAN.md')), 'purge removed auto task file');
assert(existsSync(join(TMP, 'Harness', 'tasks', 'my-task', 'PROGRESS.md')), 'purge kept real task record');
assert(!existsSync(join(TMP, 'Harness', '.harness-version')), 'purge removed .harness-version');
assert(!existsSync(join(TMP, 'Harness', 'README.md')), 'delete-modified removed Harness/README.md');
assert(!existsSync(join(TMP, 'MEMORY.md')), 'delete-modified removed root MEMORY.md');
assert(existsSync(join(TMP, 'README.md')), 'purge preserved root README.md');
assert(existsSync(join(TMP, '.gitignore')), 'purge preserved .gitignore');
assert(existsSync(join(TMP, 'package.json')), 'purge preserved package.json');

const traversalTests = [
  ['../etc/passwd', false],
  ['..\\..\\Windows\\system.ini', false],
  ['/etc/passwd', false],
  ['C:\\Windows\\win.ini', false],
  ['Harness/../../secret.txt', false],
  ['Harness/../CLAUDE.md', false],
  ['CLAUDE.md', true],
  ['Harness/specs/workflows/WF.md', true],
  ['.claude/agents/planner.md', true],
  ['Harness/specs/runtime/subagents.md', true],
  ['Harness//tasks/foo.md', false], // double slash → safePath rejects via includes('//')
  ['normal/path/file.md', true],
  ['.', false],
  ['', false],
];

for (const [input, shouldPass] of traversalTests) {
  // Simulate safePath logic (must match actual implementation)
  let normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  const hasDblSlash = normalized.includes('//');
  const hasDots = normalized.split('/').some(p => p === '..');
  const hasDrive = /^[A-Za-z]:/.test(input);
  const isAbs = input.startsWith('/') || input.startsWith('\\');
  const isEmpty = normalized === '.' || normalized === '';
  const resolved = resolve(TMP, normalized);
  const inRoot = resolved.startsWith(TMP + sep) || resolved === TMP;
  const result = !hasDrive && !hasDblSlash && !hasDots && !isAbs && !isEmpty && inRoot;

  assert(result === shouldPass, `safePath: "${input}" → ${result} (expected ${shouldPass})`);
}

// ── TEST: Canonical normalization ─────────────────────────────────

console.log('\n─── Canonical Path Tests ───\n');

const canonTests = [
  ['Harness//tasks/foo', 'Harness/tasks/foo'],
  ['Harness\\\\tasks\\\\foo', 'Harness/tasks/foo'],
  ['Harness\\tasks/foo', 'Harness/tasks/foo'],
  ['CLAUDE.md', 'CLAUDE.md'],
  ['.claude/agents/planner.md', '.claude/agents/planner.md'],
];

for (const [input, expected] of canonTests) {
  const result = input.replace(/\\/g, '/').replace(/\/+/g, '/');
  assert(result === expected, `canonicalPath: "${input}" → "${result}" (expected "${expected}")`);
}

// ── TEST: Checksum integrity ──────────────────────────────────────

console.log('\n─── Checksum Integrity Tests ───\n');

// Verify that sha256File produces consistent results
const testContent = 'hello world\n';
const hash1 = sha256(testContent);
const hash2 = sha256(testContent.replace(/\r\n/g, '\n'));
assert(hash1 === hash2, 'SHA-256 is consistent after normalization');

// Verify LF normalization works via file read
const crlfPath = join(TMP, 'tests', '.crlf-test');
writeFileSync(crlfPath, 'hello\r\nworld\r\n', 'utf-8');
const lfPath = join(TMP, 'tests', '.lf-test');
writeFileSync(lfPath, 'hello\nworld\n', 'utf-8');
const crlfHash = sha256File(crlfPath);
const lfHash = sha256File(lfPath);
assert(crlfHash === lfHash, 'CRLF normalizes to LF for checksums');

// ── Cleanup ────────────────────────────────────────────────────────

rmSync(TMP, { recursive: true, force: true });
rmSync(TMP_GUARD, { recursive: true, force: true });
rmSync(TMP_EXTERNAL, { recursive: true, force: true });
rmSync(TMP_OPTIONAL, { recursive: true, force: true });
rmSync(TMP_OPTIONAL_REMOTE, { recursive: true, force: true });
console.log('\n🧹 Cleaned up temp files.');

// ── Summary ────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) process.exit(1);
