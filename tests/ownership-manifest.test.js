import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { harnessDest } from '../src/generator.js';
import {
  buildOwnershipManifest,
  validateOwnershipManifest,
  skillDestMirrors,
  deriveKind,
  matchesGlob,
  PRESERVE_PATTERNS,
  MERGE_PATHS,
  BOOTSTRAP_ONLY_PATHS,
  MANIFEST_DEST,
  SCHEMA_VERSION,
} from '../scripts/lib/ownership-manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const TEMPLATES_COMMON = path.join(ROOT, 'templates', 'common');
const OPTIONAL_DIR = path.join(ROOT, 'templates', 'optional');
const CANONICAL_SOURCE = 'https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/';
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function walkFiles(dir, base = dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkFiles(full, base));
    else results.push(path.relative(base, full));
  }
  return results;
}

const posix = (p) => p.replace(/\\/g, '/');

// Compute the templates/common dest list the same way build-version does.
function commonDests() {
  const dests = [];
  for (const rawRel of walkFiles(TEMPLATES_COMMON)) {
    const rel = posix(rawRel);
    dests.push(harnessDest(rel));
    if (rel.startsWith('.claude/skills/')) {
      dests.push(rel.replace(/^\.claude\/skills\//, '.agents/skills/'));
    }
  }
  return dests;
}

// Compute optional skill dest paths (walk templates/optional/skills/<id>/).
function optionalSkills() {
  const catalog = JSON.parse(fs.readFileSync(path.join(OPTIONAL_DIR, 'catalog.json'), 'utf8'));
  return catalog.skills.map((skill) => {
    const skillDir = path.join(OPTIONAL_DIR, 'skills', skill.id);
    const destSet = new Set();
    if (fs.existsSync(skillDir)) {
      for (const rawRel of walkFiles(skillDir)) {
        const dest = harnessDest(posix(rawRel));
        for (const d of skillDestMirrors(dest)) destSet.add(d);
      }
    }
    return { id: skill.id, paths: [...destSet].sort() };
  });
}

function buildRealManifest() {
  return buildOwnershipManifest({
    commonDests: commonDests(),
    optionalSkills: optionalSkills(),
    generator: PKG_VERSION,
    source: CANONICAL_SOURCE,
    generated: '2026-01-01T00:00:00.000Z',
  });
}

test('preserve / merge / bootstrap equal the fixed constants', () => {
  const m = buildRealManifest();
  assert.deepEqual(m.preserve, PRESERVE_PATTERNS);
  assert.deepEqual(m.merge, MERGE_PATHS);
  assert.deepEqual(m.bootstrapOnly, BOOTSTRAP_ONLY_PATHS);
});

test('Harness/PROGRESS.md is PRESERVE (active task index), never frameworkOwned', () => {
  // The updater's PRESERVE_PATTERNS matches PROGRESS.md as an exact path; the
  // manifest must classify it the same way so it is never treated as overwrite-safe.
  assert.ok(
    PRESERVE_PATTERNS.includes('Harness/PROGRESS.md'),
    'PRESERVE_PATTERNS must list Harness/PROGRESS.md',
  );
  const m = buildRealManifest();
  assert.ok(
    m.preserve.includes('Harness/PROGRESS.md'),
    'manifest.preserve must list Harness/PROGRESS.md',
  );
  const frameworkPaths = m.frameworkOwned.map((e) => e.path);
  assert.ok(
    !frameworkPaths.includes('Harness/PROGRESS.md'),
    'Harness/PROGRESS.md must NOT appear in frameworkOwned',
  );
});

test('schemaVersion, generator, source are set correctly', () => {
  const m = buildRealManifest();
  assert.equal(m.schemaVersion, SCHEMA_VERSION);
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.generator, PKG_VERSION);
  assert.equal(m.source, CANONICAL_SOURCE);
});

test('manifest lists itself as a frameworkOwned entry', () => {
  const m = buildRealManifest();
  const paths = m.frameworkOwned.map((e) => e.path);
  assert.ok(paths.includes(MANIFEST_DEST), 'manifest dest must be in frameworkOwned');
});

test('frameworkOwned includes all non-preserve/merge/optional template dests', () => {
  const m = buildRealManifest();
  const frameworkPaths = new Set(m.frameworkOwned.map((e) => e.path));
  const optionalSet = new Set();
  for (const skill of m.optionalOwned) for (const p of skill.paths) optionalSet.add(p);

  const seen = new Set();
  for (const dest of commonDests()) {
    if (dest === MANIFEST_DEST) continue; // added explicitly
    if (dest === 'Harness/.harness-version') continue; // tracked separately
    if (PRESERVE_PATTERNS.some((p) => matchesGlob(dest, p))) continue;
    if (MERGE_PATHS.includes(dest)) continue;
    if (BOOTSTRAP_ONLY_PATHS.includes(dest)) continue;
    if (optionalSet.has(dest)) continue;
    seen.add(dest);
  }

  // Every non-excluded common dest must appear in frameworkOwned.
  for (const dest of seen) {
    assert.ok(frameworkPaths.has(dest), `missing frameworkOwned dest: ${dest}`);
  }
  // And the manifest dest is added on top.
  assert.ok(frameworkPaths.has(MANIFEST_DEST));
});

test('no dest appears in both frameworkOwned and optionalOwned', () => {
  const m = buildRealManifest();
  const frameworkSet = new Set(m.frameworkOwned.map((e) => e.path));
  for (const skill of m.optionalOwned) {
    for (const p of skill.paths) {
      assert.ok(!frameworkSet.has(p), `dest in both lists: ${p}`);
    }
  }
});

test('optionalOwned browser-e2e paths include the expected dests', () => {
  const m = buildRealManifest();
  const browser = m.optionalOwned.find((s) => s.option === 'browser-e2e');
  assert.ok(browser, 'browser-e2e optional entry exists');
  const expected = [
    '.claude/skills/browser-e2e/SKILL.md',
    '.agents/skills/browser-e2e/SKILL.md',
    '.claude/skills/wf-browser/SKILL.md',
    '.opencode/commands/wf-browser.md',
    'Harness/workflows/browser-e2e.md',
  ];
  for (const p of expected) {
    assert.ok(browser.paths.includes(p), `browser-e2e missing path: ${p}`);
  }
  // paths are sorted
  const sorted = [...browser.paths].sort();
  assert.deepEqual(browser.paths, sorted);
  assert.equal(browser.overwrite, 'safe-if-installed');
});

test('every optionalOwned option exists in the catalog', () => {
  const m = buildRealManifest();
  const catalog = JSON.parse(fs.readFileSync(path.join(OPTIONAL_DIR, 'catalog.json'), 'utf8'));
  const catalogIds = new Set(catalog.skills.map((s) => s.id));
  for (const entry of m.optionalOwned) {
    assert.ok(catalogIds.has(entry.option), `unknown optional id: ${entry.option}`);
  }
});

test('validateOwnershipManifest passes for a correct manifest', () => {
  const m = buildRealManifest();
  const errors = validateOwnershipManifest(m, {
    pkgVersion: PKG_VERSION,
    source: CANONICAL_SOURCE,
    catalogSkillIds: optionalSkills().map((s) => s.id),
  });
  assert.deepEqual(errors, []);
});

test('validateOwnershipManifest catches a generator mismatch', () => {
  const m = buildRealManifest();
  m.generator = '0.0.0-bad';
  const errors = validateOwnershipManifest(m, {
    pkgVersion: PKG_VERSION,
    source: CANONICAL_SOURCE,
    catalogSkillIds: optionalSkills().map((s) => s.id),
  });
  assert.ok(errors.length > 0, 'validation should fail on generator mismatch');
  assert.ok(errors.some((e) => e.includes('generator')));
});

test('validateOwnershipManifest catches a tampered preserve constant', () => {
  const m = buildRealManifest();
  m.preserve = ['wrong'];
  const errors = validateOwnershipManifest(m, {
    pkgVersion: PKG_VERSION,
    source: CANONICAL_SOURCE,
    catalogSkillIds: optionalSkills().map((s) => s.id),
  });
  assert.ok(errors.some((e) => e.includes('preserve')));
});

test('validateOwnershipManifest catches an unknown optional option', () => {
  const m = buildRealManifest();
  m.optionalOwned.push({ option: 'does-not-exist', paths: [], overwrite: 'safe-if-installed' });
  const errors = validateOwnershipManifest(m, {
    pkgVersion: PKG_VERSION,
    source: CANONICAL_SOURCE,
    catalogSkillIds: optionalSkills().map((s) => s.id),
  });
  assert.ok(errors.some((e) => e.includes('not in catalog')));
});

test('validateOwnershipManifest catches a framework/optional dest collision', () => {
  const m = buildRealManifest();
  const collidingDest = m.optionalOwned[0].paths[0];
  m.frameworkOwned.push({ path: collidingDest, kind: 'config', overwrite: 'safe' });
  const errors = validateOwnershipManifest(m, {
    pkgVersion: PKG_VERSION,
    source: CANONICAL_SOURCE,
    catalogSkillIds: optionalSkills().map((s) => s.id),
  });
  assert.ok(errors.some((e) => e.includes('both frameworkOwned and optionalOwned')));
});

test('deriveKind maps representative dests deterministically', () => {
  assert.equal(deriveKind('.claude/agents/implementer.md'), 'agent');
  assert.equal(deriveKind('.opencode/agents/implementer.md'), 'agent');
  assert.equal(deriveKind('.claude/commands/wf.md'), 'command');
  assert.equal(deriveKind('.opencode/commands/wf.md'), 'command');
  assert.equal(deriveKind('.claude/skills/wf/SKILL.md'), 'skill');
  assert.equal(deriveKind('.agents/skills/wf/SKILL.md'), 'skill');
  assert.equal(deriveKind('.codex/config.toml'), 'config');
  assert.equal(deriveKind('.opencode/plugins/harness-wf-status.mjs'), 'config');
  assert.equal(deriveKind('Harness/scripts/wf-update-check.mjs'), 'script');
  assert.equal(deriveKind('Harness/WF.md'), 'doc');
  assert.equal(deriveKind('opencode.json'), 'config');
});

test('matchesGlob handles ** and exact patterns', () => {
  assert.ok(matchesGlob('Harness/tasks/abc/STATE.json', 'Harness/tasks/**'));
  assert.ok(matchesGlob('Harness/memory/x.md', 'Harness/memory/**'));
  assert.ok(!matchesGlob('Harness/memory-x.md', 'Harness/memory/**'));
  assert.ok(matchesGlob('README.md', 'README.md'));
  assert.ok(!matchesGlob('README-CN.md', 'README.md'));
});

test('generated manifest file on disk is valid and self-consistent', () => {
  const templatePath = path.join(TEMPLATES_COMMON, 'Harness', 'ownership.manifest.json');
  const rootPath = path.join(ROOT, 'Harness', 'ownership.manifest.json');
  assert.ok(fs.existsSync(templatePath), 'template manifest exists');
  assert.ok(fs.existsSync(rootPath), 'root manifest exists');

  const templateRaw = fs.readFileSync(templatePath, 'utf8');
  const rootRaw = fs.readFileSync(rootPath, 'utf8');
  // Root copy must be byte-identical to template copy.
  assert.equal(templateRaw, rootRaw);

  const onDisk = JSON.parse(templateRaw);
  const errors = validateOwnershipManifest(onDisk, {
    pkgVersion: PKG_VERSION,
    source: CANONICAL_SOURCE,
    catalogSkillIds: optionalSkills().map((s) => s.id),
  });
  assert.deepEqual(errors, []);
  assert.equal(onDisk.generator, PKG_VERSION);
  assert.equal(onDisk.source, CANONICAL_SOURCE);
});
