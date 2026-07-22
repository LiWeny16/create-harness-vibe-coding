import test from 'node:test';
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

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-check-root-'));
}

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

// TODO: W1 integration — `scripts/build-version.mjs` resolves ROOT/templates from
// its own __dirname and cannot be pointed at a temp tree without refactoring
// (out of scope for W-fix; build-version.mjs is W1-owned). The tests below
// cover W2 drift detection and the accepted-conflict skip, which is the
// behavior W-fix changed. Add a W1 root-sync integration test once build-version
// gains a testability hook.

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
