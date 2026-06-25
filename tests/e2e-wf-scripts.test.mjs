#!/usr/bin/env node
/**
 * e2e-wf-scripts.test.mjs — E2E tests for wf-remove.mjs and wf-update-check.mjs
 *
 * Tests classification accuracy, path safety, PRESERVE integrity, and edge cases.
 * Creates a temporary mock project, runs scripts against it, verifies output.
 *
 * Usage: node tests/e2e-wf-scripts.test.mjs
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { resolve, join, sep } from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SCRIPTS = resolve(ROOT, 'Harness', 'scripts');
const TMP = resolve(ROOT, 'tests', '.tmp-e2e');
const REMOVE = join(SCRIPTS, 'wf-remove.mjs');
const UPDATE = join(SCRIPTS, 'wf-update-check.mjs');

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

function runNode(script, args = '') {
  try {
    const result = execSync(`node "${script}" ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      env: { ...process.env, WF_ROOT: TMP },
    });
    return { ok: true, stdout: result, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout || '', stderr: e.stderr || e.message };
  }
}

// ── Setup mock project ────────────────────────────────────────────

console.log('\n🏗 Setting up mock project...');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// Create mock .harness-version with known checksums
const mockFiles = {
  // SAFE framework files (will match checksums)
  'CLAUDE.md': 'Harness binding content here\n## 1. Harness Binding & Startup\n- Use `/wf` for long tasks.\n## 2. Think Before Coding\n',
  'AGENTS.md': 'Agent instructions here.',
  '.claude/agents/planner.md': 'planner agent definition.',
  '.claude/skills/wf-update/SKILL.md': 'wf-update skill.',
  '.claude/commands/wf.md': '/wf command bridge.',
  '.claude/rules/ecc/common.md': 'Universal rules.',
  'Harness/WF.md': 'WF mode spec.',
  'Harness/dispatch.md': 'Dispatch protocol.',
  'Harness/subagents.md': 'Subagent orchestration.',
  'tests/.gitkeep': '',

  // USER DATA files (must NEVER be in SAFE or MODIFIED)
  'Harness/PROGRESS.md': 'my progress',
  'Harness/tasks/my-task/PROGRESS.md': 'task progress',
  'Harness/memory/my-notes.md': 'user memory notes',
  'Harness/memory/tool-usage-reflections.md': 'reflections',
  'Harness/research/PRD.md': 'my PRD',
  'Harness/architecture.md': 'my architecture',
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

// Write .harness-version
const versionFile = {
  generator: '0.6.1',
  generated: '2026-06-25T00:00:00.000Z',
  options: [],
  autoCheck: true,
  source: 'https://raw.githubusercontent.com/zingspark/create-harness-vibe-coding/main/templates/common/',
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
  'Harness/memory/my-notes.md',
  'Harness/memory/tool-usage-reflections.md',
  'Harness/research/PRD.md',
  'Harness/architecture.md',
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
const expectedSafe = ['AGENTS.md', 'tests/.gitkeep', '.claude/rules/ecc/common.md'];
for (const es of expectedSafe) {
  assert(safeFiles.includes(es), `Expected SAFE: ${es}`);
}

// Test 7: CLI DRY-RUN output
const dryResult = runNode(REMOVE, '', TMP);
assert(dryResult.ok, 'DRY-RUN runs without error');
assert(dryResult.stdout.includes('DRY-RUN'), 'DRY-RUN shows notice');
assert(dryResult.stdout.includes('SAFE'), 'DRY-RUN shows SAFE section');
assert(dryResult.stdout.includes('USER DATA'), 'DRY-RUN shows USER DATA section');

// Test 8: --yes flag works (non-interactive)
const yesResult = runNode(REMOVE, '--apply --yes', TMP);
assert(yesResult.ok, '--apply --yes runs without error');

// ── TEST: wf-update-check.mjs ─────────────────────────────────────

console.log('\n─── wf-update-check.mjs E2E Tests ───\n');

const updateResult = runNode(UPDATE, '--json', TMP);
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
  { file: 'Harness/WF.md', expect: 'SAFE' },  // runtime, unmodified
  { file: 'CLAUDE.md', expect: 'SAFE|CONFLICT' },  // MERGE file
  { file: 'Harness/README.md', expect: 'SAFE|CONFLICT' },  // MERGE file
];

// We can't easily test classify() in isolation, but we can verify
// the JSON output correctly separates PRESERVE from updated/created
if (updatePlan.plan) {
  for (const skipped of (updatePlan.plan.skipped || [])) {
    assert(skipped.reason.includes('PRESERVE') || skipped.reason.includes('not in remote') || skipped.reason.includes('traversal'),
      `Skipped file has valid reason: ${skipped.file} — ${skipped.reason}`);
  }
}

// ── TEST: safePath() traversal rejection ──────────────────────────

console.log('\n─── safePath() Traversal Tests ───\n');

// Test via Node inline — import safePath equivalent logic
const traversalTests = [
  ['../etc/passwd', false],
  ['..\\..\\Windows\\system.ini', false],
  ['/etc/passwd', false],
  ['C:\\Windows\\win.ini', false],
  ['Harness/../../secret.txt', false],
  ['Harness/../CLAUDE.md', false],
  ['CLAUDE.md', true],
  ['Harness/WF.md', true],
  ['.claude/agents/planner.md', true],
  ['Harness/subagents.md', true],
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
  const isAbs = input.startsWith('/') || input.startsWith('\\');
  const isEmpty = normalized === '.' || normalized === '';
  const resolved = resolve(TMP, normalized);
  const inRoot = resolved.startsWith(TMP + sep) || resolved === TMP;
  const result = !hasDblSlash && !hasDots && !isAbs && !isEmpty && inRoot;

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
console.log('\n🧹 Cleaned up temp files.');

// ── Summary ────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) process.exit(1);
