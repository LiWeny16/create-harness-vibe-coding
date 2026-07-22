import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'check-root-harness-version.mjs');
const BUILD_VERSION_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'build-version.mjs');

const tempRoots = [];
function tmpdir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-check-root-'));
  tempRoots.push(root);
  return root;
}
after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function sha256Hex(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  return 'sha256-' + createHash('sha256').update(normalized).digest('hex');
}

function writeRel(root, rel, content) {
  const full = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function writeHarnessVersion(root, obj) {
  writeRel(root, 'Harness/.harness-version', JSON.stringify(obj, null, 2) + '\n');
}

function runCheckRoot(root) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root], {
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function runBuildVersion(root, extraArgs = []) {
  const result = spawnSync(process.execPath, [BUILD_VERSION_SCRIPT, '--root', root, ...extraArgs], {
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

// build-version.mjs now supports a `--root <dir>` testability hook (mirroring
// check-root-harness-version.mjs). The G2b/G2c tests below cover its root-sync
// behavior and --check idempotency against fixture trees.

test('W2 drift detection: mismatched checksums are flagged and exit non-zero', () => {
  const root = tmpdir();
  writeRel(root, '.claude/commands/wf-help.md', 'local content that does not match recorded hash\n');
  writeHarnessVersion(root, {
    generator: '0.8.11',
    checksums: {
      // Deliberately wrong recorded hash so the actual file drifts.
      '.claude/commands/wf-help.md': 'sha256-0000000000000000000000000000000000000000000000000000000000000000',
    },
  });

  const { status, output } = runCheckRoot(root);

  assert.notEqual(status, 0, 'drift must fail pre-push');
  assert.match(output, /1 drift finding/);
  assert.match(output, /drift: \.claude\/commands\/wf-help\.md/);
});

test('dogfood identity drift: generator and source must match the published package', () => {
  const root = tmpdir();
  const rel = 'Harness/WF.md';
  const content = 'matching framework file\n';
  writeRel(root, 'package.json', JSON.stringify({
    name: 'create-harness-vibe-coding',
    version: '0.8.14',
  }, null, 2) + '\n');
  writeRel(root, rel, content);
  writeHarnessVersion(root, {
    generator: '0.8.11',
    source: 'https://raw.githubusercontent.com/zingspark/create-harness-vibe-coding/main/templates/common/',
    checksums: { [rel]: sha256Hex(content) },
  });

  const { status, output } = runCheckRoot(root);

  assert.notEqual(status, 0, 'dogfood version identity drift must fail pre-push');
  assert.match(output, /generator drift: recorded 0\.8\.11, package\.json 0\.8\.14/);
  assert.match(output, /source drift: recorded https:\/\/raw\.githubusercontent\.com\/zingspark\/create-harness-vibe-coding\/main\/templates\/common\//);
});

test('accepted-conflict skip: accept-local key and its cross-runtime mirror are not flagged', () => {
  const root = tmpdir();
  const claudeRel = '.claude/commands/wf-help.md';
  const opencodeRel = '.opencode/commands/wf-help.md';
  // Actual local content (differs from the recorded/remote hashes below).
  const localContent = 'intentionally local wf-help body\n';
  writeRel(root, claudeRel, localContent);
  writeRel(root, opencodeRel, localContent);
  writeHarnessVersion(root, {
    generator: '0.8.11',
    checksums: {
      // Recorded hashes are the "remote" values, intentionally different from
      // the local file content, so without the skip these would both drift.
      [claudeRel]: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      [opencodeRel]: 'sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    acceptedConflicts: {
      // Only the .claude source is declared; .opencode mirror must be skipped
      // by transitivity via the generator's mirror mapping.
      [claudeRel]: {
        decision: 'accept-local',
        localHash: sha256Hex(localContent),
        remoteHash: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    },
  });

  const { status, output } = runCheckRoot(root);

  assert.equal(status, 0, 'accepted-local files must not fail pre-push');
  assert.match(output, /ACCEPTED \(accept-local\): \.claude\/commands\/wf-help\.md/);
  assert.match(output, /ACCEPTED \(accept-local\): \.opencode\/commands\/wf-help\.md/);
  assert.match(output, /2 accepted-local skipped/);
  assert.doesNotMatch(output, /drift finding/);
});

test('happy path: matching checksums with no acceptedConflicts pass unchanged', () => {
  const root = tmpdir();
  const rel = '.claude/commands/wf-help.md';
  const content = 'matching body\n';
  writeRel(root, rel, content);
  writeHarnessVersion(root, {
    generator: '0.8.11',
    checksums: { [rel]: sha256Hex(content) },
  });

  const { status, output } = runCheckRoot(root);

  assert.equal(status, 0);
  assert.match(output, /checksums match \(1 files\)/);
  assert.doesNotMatch(output, /accepted-local skipped/);
  assert.doesNotMatch(output, /drift finding/);
});

test('mirror derivation: accept-local on a .claude/skills file also skips its .agents mirror', () => {
  const root = tmpdir();
  const claudeRel = '.claude/skills/wf/SKILL.md';
  const agentsRel = '.agents/skills/wf/SKILL.md';
  const localContent = 'local skill body\n';
  writeRel(root, claudeRel, localContent);
  writeRel(root, agentsRel, localContent);
  writeHarnessVersion(root, {
    generator: '0.8.11',
    checksums: {
      [claudeRel]: 'sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      [agentsRel]: 'sha256-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    },
    acceptedConflicts: {
      [claudeRel]: { decision: 'accept-local' },
    },
  });

  const { status, output } = runCheckRoot(root);

  assert.equal(status, 0);
  assert.match(output, /ACCEPTED \(accept-local\): \.claude\/skills\/wf\/SKILL\.md/);
  assert.match(output, /ACCEPTED \(accept-local\): \.agents\/skills\/wf\/SKILL\.md/);
  assert.match(output, /2 accepted-local skipped/);
});

test('G2b: build-version --root syncs generator/source/checksums/sources and preserves local install state', () => {
  const root = tmpdir();
  const CANONICAL_SOURCE = 'https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/';

  // Fixture package.json carries its own version; build-version reads it from ROOT.
  writeRel(root, 'package.json', JSON.stringify({
    name: 'create-harness-vibe-coding',
    version: '9.9.9',
  }, null, 2) + '\n');

  // Minimal templates/common/ tree to be walked.
  const templateClaude = 'template CLAUDE body\n';
  writeRel(root, 'templates/common/CLAUDE.md', templateClaude);
  writeRel(root, 'templates/common/.claude/commands/wf-help.md', 'template wf-help body\n');

  // Root-level file so rootFileExists('CLAUDE.md') is true and its checksum/source refresh.
  writeRel(root, 'CLAUDE.md', 'root CLAUDE body\n');

  // Local install state with fields that must be preserved across the sync.
  const acceptedConflicts = {
    '.claude/commands/foo.md': { decision: 'accept-local', localHash: 'sha256-aaa', remoteHash: 'sha256-bbb' },
  };
  const externalRecommendations = [{ id: 'ext-1', note: 'sample' }];
  writeHarnessVersion(root, {
    generator: '0.0.0-old',
    generated: '2020-01-01T00:00:00.000Z',
    options: ['x'],
    autoCheck: false,
    source: 'https://old.example.com/',
    checksums: { 'CLAUDE.md': 'sha256-OLDVALUE' },
    sources: { 'CLAUDE.md': 'OLD_SOURCE' },
    acceptedConflicts,
    externalRecommendations,
  });

  const { status, output } = runBuildVersion(root);
  assert.equal(status, 0, `build-version should exit 0; output:\n${output}`);

  // Read back the synced root install.
  const synced = JSON.parse(fs.readFileSync(path.join(root, 'Harness', '.harness-version'), 'utf8'));

  // Refreshed identity and tracking maps.
  assert.equal(synced.generator, '9.9.9', 'generator refreshed from fixture package.json');
  assert.equal(synced.source, CANONICAL_SOURCE, 'source refreshed to canonical URL');
  assert.equal(synced.checksums['CLAUDE.md'], sha256Hex(templateClaude), 'checksum refreshed to template content hash');
  assert.equal(synced.sources['CLAUDE.md'], 'CLAUDE.md', 'source map refreshed to template rel path');

  // Preserved local install state.
  assert.deepEqual(synced.options, ['x'], 'options preserved unchanged');
  assert.deepEqual(synced.acceptedConflicts, acceptedConflicts, 'acceptedConflicts preserved unchanged');
  assert.deepEqual(synced.externalRecommendations, externalRecommendations, 'externalRecommendations preserved unchanged');
});

test('G2c: build-version --check is idempotent (repeated runs exit 0 on stable input)', () => {
  const root = tmpdir();
  writeRel(root, 'package.json', JSON.stringify({
    name: 'create-harness-vibe-coding',
    version: '9.9.9',
  }, null, 2) + '\n');
  writeRel(root, 'templates/common/CLAUDE.md', 'stable template body\n');
  // Pre-create the template manifest so the walk is stable across runs (the seed
  // write would otherwise create it and grow the sources map on the next walk).
  // Mirrors the real repo, where .harness-version always exists before a run.
  writeRel(root, 'templates/common/.harness-version', '{}\n');

  // Seed the manifest with a write (no --check) so --check has a current file to compare against.
  const seed = runBuildVersion(root);
  assert.equal(seed.status, 0, `seed write should exit 0; output:\n${seed.output}`);

  // First --check against the freshly written manifest.
  const first = runBuildVersion(root, ['--check']);
  assert.equal(first.status, 0, `first --check should exit 0; output:\n${first.output}`);

  // Second --check with no mutation between runs: idempotent.
  const second = runBuildVersion(root, ['--check']);
  assert.equal(second.status, 0, `second --check should exit 0 (idempotent); output:\n${second.output}`);
});
