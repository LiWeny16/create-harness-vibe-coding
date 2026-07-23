/**
 * build-version.mjs
 *
 * Populates templates/common/.harness-version with real version, checksums,
 * and a sources map so the published file isn't a placeholder.
 *
 * Usage:
 *   node scripts/build-version.mjs                       # writes the file
 *   node scripts/build-version.mjs --check               # dry-run, prints diff, exits 0
 *   node scripts/build-version.mjs --root <dir>          # point at a fixture tree
 *   node scripts/build-version.mjs --root <dir> --check  # dry-run against a fixture
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeChecksums, harnessDest, isChecksumExcluded } from '../src/generator.js';
import {
  buildOwnershipManifest,
  validateOwnershipManifest,
  skillDestMirrors,
  MANIFEST_DEST,
  MANIFEST_REL,
  PATH_MOVES,
} from './lib/ownership-manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default ROOT is the real repo root. `--root <dir>` is a testability hook so
// build-version can be pointed at a fixture tree: package.json, templates/common/,
// and both .harness-version paths all resolve from it. Default behavior is
// unchanged when the flag is absent. Mirrors check-root-harness-version.mjs.
const ROOT_ARG_IDX = process.argv.indexOf('--root');
const ROOT = ROOT_ARG_IDX !== -1 && process.argv[ROOT_ARG_IDX + 1]
  ? path.resolve(process.argv[ROOT_ARG_IDX + 1])
  : path.resolve(__dirname, '..');

const CHECK_MODE = process.argv.includes('--check');

// --- helpers ---

function walkFiles(dir, base = dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, base));
    } else {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

function sortedByKey(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));
}

function latestReleaseNotes(rootDir, version) {
  const changelogPath = path.join(rootDir, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) return null;
  const body = fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`(?:^|\\n)## \\[${escaped}\\] - ([^\\n]+)\\n([\\s\\S]*?)(?=\\n## \\[|$)`));
  if (!match) return null;
  const highlights = match[2]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
    .filter(Boolean)
    .slice(0, 8);
  return {
    version,
    date: match[1].trim(),
    highlights,
  };
}

/**
 * Walk templates/optional/skills/<id>/ for every catalog skill and return
 * { id, paths } pairs (dests via harnessDest + codex mirror). Pure-ish: reads
 * the filesystem but produces deterministic data for buildOwnershipManifest().
 */
function collectOptionalSkills(rootDir) {
  const optionalDir = path.join(rootDir, 'templates', 'optional');
  const catalogPath = path.join(optionalDir, 'catalog.json');
  if (!fs.existsSync(catalogPath)) return [];
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch {
    return [];
  }
  const skills = Array.isArray(catalog.skills) ? catalog.skills : [];
  return skills.map(skill => {
    const skillDir = path.join(optionalDir, 'skills', skill.id);
    const destSet = new Set();
    if (fs.existsSync(skillDir)) {
      for (const rawRel of walkFiles(skillDir)) {
        const rel = normalizePath(rawRel);
        const dest = harnessDest(rel);
        for (const d of skillDestMirrors(dest)) destSet.add(d);
      }
    }
    return { id: skill.id, paths: [...destSet].sort() };
  });
}

function collectOptionalInstallMaps(rootDir, selectedIds) {
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds.map(String).filter(Boolean) : []);
  if (selected.size === 0) return { checksums: {}, sources: {} };

  const optionalDir = path.join(rootDir, 'templates', 'optional');
  const catalogPath = path.join(optionalDir, 'catalog.json');
  if (!fs.existsSync(catalogPath)) return { checksums: {}, sources: {} };

  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch {
    return { checksums: {}, sources: {} };
  }

  const skillsById = new Map((Array.isArray(catalog.skills) ? catalog.skills : []).map(skill => [String(skill.id), skill]));
  const files = [];
  const optionalSources = {};

  for (const id of selected) {
    const skill = skillsById.get(id);
    if (!skill || !Array.isArray(skill.files)) continue;
    for (const fileRoot of skill.files) {
      const absRoot = path.join(optionalDir, ...String(fileRoot).split('/'));
      if (!fs.existsSync(absRoot)) continue;
      for (const rawRel of walkFiles(absRoot)) {
        const rel = normalizePath(rawRel);
        const src = path.join(absRoot, ...rel.split('/'));
        const dest = harnessDest(rel);
        const optionalRel = normalizePath(path.relative(optionalDir, src));
        const content = fs.readFileSync(src, 'utf8');

        optionalSources[dest] = optionalRel;
        if (!isChecksumExcluded(dest)) files.push({ dest, content });

        if (dest.startsWith('.claude/skills/')) {
          const mirrorDest = dest.replace(/^\.claude\/skills\//, '.agents/skills/');
          optionalSources[mirrorDest] = optionalRel;
          if (!isChecksumExcluded(mirrorDest)) files.push({ dest: mirrorDest, content });
        }
      }
    }
  }

  return {
    checksums: computeChecksums(files),
    sources: sortedByKey(optionalSources),
  };
}

// --- main ---

const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const generatorVersion = pkg.version;
const releaseNotes = latestReleaseNotes(ROOT, generatorVersion);

const TEMPLATES_DIR = path.join(ROOT, 'templates', 'common');
const HARNESS_VERSION_PATH = path.join(TEMPLATES_DIR, '.harness-version');
const CANONICAL_SOURCE_URL = 'https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/';

// Keep generated installs on the canonical personal repository.
const sourceUrl = CANONICAL_SOURCE_URL;

// Walk templates/common/ and build file list
const accumulatedFiles = [];  // { dest, content }
const sources = {};           // dest -> templateRelPath (POSIX)
const commonDestList = [];    // all dests (incl. codex mirrors) for manifest build

for (const rawRel of walkFiles(TEMPLATES_DIR)) {
  const rel = normalizePath(rawRel);         // POSIX template-relative path
  const dest = harnessDest(rel);             // POSIX dest path

  // Always record the source mapping (including .harness-version itself)
  sources[dest] = rel;
  commonDestList.push(dest);

  // Skip checksum-excluded files (PRESERVE + .harness-version)
  if (isChecksumExcluded(dest)) continue;
  // Also skip .harness-version by dest (the generator excludes it via CHECKSUM_EXCLUDE)
  // isChecksumExcluded already covers Harness/.harness-version; the template path maps there.

  const content = fs.readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
  accumulatedFiles.push({ dest, content });

  if (rel.startsWith('.claude/skills/')) {
    const mirrorDest = rel.replace(/^\.claude\/skills\//, '.agents/skills/');
    sources[mirrorDest] = rel;
    commonDestList.push(mirrorDest);
    if (!isChecksumExcluded(mirrorDest)) {
      accumulatedFiles.push({ dest: mirrorDest, content });
    }
  }
}

// --- ownership manifest: derive, validate, write (template + dogfood root) ---
const generatedTimestamp = new Date().toISOString();

const optionalSkillsData = collectOptionalSkills(ROOT);
const ownershipManifest = buildOwnershipManifest({
  commonDests: commonDestList,
  optionalSkills: optionalSkillsData,
  generator: generatorVersion,
  source: sourceUrl,
  generated: generatedTimestamp,
});
const manifestErrors = validateOwnershipManifest(ownershipManifest, {
  pkgVersion: generatorVersion,
  source: sourceUrl,
  catalogSkillIds: optionalSkillsData.map(s => s.id),
});
if (manifestErrors.length > 0) {
  console.error('[build-version] ownership manifest self-validation failed:');
  for (const e of manifestErrors) console.error('  - ' + e);
  process.exit(1);
}

const ownershipManifestJson = JSON.stringify(ownershipManifest, null, 2) + '\n';
const MANIFEST_TEMPLATE_PATH = path.join(TEMPLATES_DIR, ...MANIFEST_REL.split('/'));
const MANIFEST_ROOT_PATH = path.join(ROOT, ...MANIFEST_DEST.split('/'));

if (!CHECK_MODE) {
  fs.mkdirSync(path.dirname(MANIFEST_TEMPLATE_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_TEMPLATE_PATH, ownershipManifestJson, 'utf8');
  // Dogfood root copy is byte-identical to the template copy.
  fs.mkdirSync(path.dirname(MANIFEST_ROOT_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_ROOT_PATH, ownershipManifestJson, 'utf8');
  console.log(
    `[build-version] wrote ownership.manifest.json ` +
    `(${ownershipManifest.frameworkOwned.length} frameworkOwned, ` +
    `${ownershipManifest.optionalOwned.length} optionalOwned)`
  );
}

// Track the manifest in .harness-version checksums/sources like any other
// templates/common/ file. In write mode the freshly-written content is used.
// In --check mode the on-disk content (already read during the walk) is kept,
// so the manifest's volatile `generated` timestamp does not perturb the
// idempotent comparison (the stored checksum was computed from the same bytes).
sources[MANIFEST_DEST] = MANIFEST_REL;
const manifestExistingIdx = accumulatedFiles.findIndex(f => f.dest === MANIFEST_DEST);
if (!CHECK_MODE) {
  const manifestEntry = { dest: MANIFEST_DEST, content: ownershipManifestJson };
  if (manifestExistingIdx >= 0) accumulatedFiles[manifestExistingIdx] = manifestEntry;
  else accumulatedFiles.push(manifestEntry);
} else if (manifestExistingIdx === -1) {
  // First-run --check with no manifest on disk yet: fall back to built content.
  accumulatedFiles.push({ dest: MANIFEST_DEST, content: ownershipManifestJson });
}

const checksums = computeChecksums(accumulatedFiles);

const versionObj = {
  generator: generatorVersion,
  generated: generatedTimestamp,
  options: [],
  autoCheck: true,
  source: sourceUrl,
  ...(releaseNotes ? { releaseNotes } : {}),
  moves: PATH_MOVES.map(move => ({ ...move })),
  checksums: sortedByKey(checksums),
  sources: sortedByKey(sources),
};

const output = JSON.stringify(versionObj, null, 2) + '\n';

// Validate: no {{ placeholders remain
const placeholderMatch = output.match(/\{\{[^}]+\}\}/g);
if (placeholderMatch) {
  console.error('ERROR: unresolved placeholders found in output:', placeholderMatch);
  process.exit(1);
}

const fileCount = accumulatedFiles.length;
const sourceCount = Object.keys(sources).length;
const checksumCount = Object.keys(checksums).length;

if (CHECK_MODE) {
  const currentRaw = fs.readFileSync(HARNESS_VERSION_PATH, 'utf8');
  // Compare without 'generated' timestamp for idempotent CI checks
  let currentObj, newObj;
  try { currentObj = JSON.parse(currentRaw); } catch { currentObj = {}; }
  try { newObj = JSON.parse(output); } catch { newObj = {}; }
  // Normalize: strip 'generated' field before comparison
  delete currentObj.generated;
  delete newObj.generated;
  const currentStable = JSON.stringify(currentObj);
  const newStable = JSON.stringify(newObj);

  if (currentStable === newStable) {
    console.log(`[build-version] --check: file is already up to date (${checksumCount} checksums, ${sourceCount} sources).`);
    process.exit(0);
  } else {
    console.log(`[build-version] --check: file WOULD change.`);
    console.log(`  generator: ${generatorVersion}`);
    console.log(`  checksummed files: ${fileCount}`);
    console.log(`  sources entries: ${sourceCount}`);
    console.log(`  checksums entries: ${checksumCount}`);
    console.log('  (run without --check to apply)');
    process.exit(1);
    // Note: exit(1) so CI can detect staleness.
    // 'generated' timestamp is excluded from comparison for idempotency.
  }
}

fs.writeFileSync(HARNESS_VERSION_PATH, output, 'utf8');

// --- root sync: keep dogfood Harness/.harness-version in lockstep with templates ---
// The root install artifact carries local install state (acceptedConflicts,
// selected optional workflows, externalRecommendations). Preserve that local
// state, but refresh the template-owned identity and tracking maps so the
// dogfood repository reports the same generator version as the templates it
// publishes.
const ROOT_HARNESS_VERSION = path.join(ROOT, 'Harness', '.harness-version');
const ROOT_CHECKSUMS = versionObj.checksums;
const ROOT_SOURCES = versionObj.sources;

function rootFileExists(dest) {
  return fs.existsSync(path.join(ROOT, ...dest.split('/')));
}

function syncExistingRootTemplateMap(existing, templateMap) {
  const next = {};
  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const [key, value] of Object.entries(existing || {})) {
    if (rootFileExists(key)) {
      next[key] = value;
    } else {
      removed++;
    }
  }

  for (const [key, value] of Object.entries(templateMap)) {
    if (!rootFileExists(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      added++;
    } else if (next[key] !== value) {
      updated++;
    }
    next[key] = value;
  }

  return { next: sortedByKey(next), added, updated, removed };
}

if (fs.existsSync(ROOT_HARNESS_VERSION)) {
  let root;
  try {
    root = JSON.parse(fs.readFileSync(ROOT_HARNESS_VERSION, 'utf8'));
  } catch (err) {
    console.warn(`[build-version] WARNING: could not parse root Harness/.harness-version, skipping sync: ${err.message}`);
    root = null;
  }
  if (root && typeof root === 'object') {
    const optionalInstall = collectOptionalInstallMaps(ROOT, root.options);
    const rootChecksums = sortedByKey({ ...ROOT_CHECKSUMS, ...optionalInstall.checksums });
    const rootSources = sortedByKey({ ...ROOT_SOURCES, ...optionalInstall.sources });

    const checksumSync = syncExistingRootTemplateMap(
      root.checksums && typeof root.checksums === 'object' ? root.checksums : {},
      rootChecksums
    );
    const sourceSync = syncExistingRootTemplateMap(
      root.sources && typeof root.sources === 'object' ? root.sources : {},
      rootSources
    );

    root.generator = generatorVersion;
    root.generated = versionObj.generated;
    root.autoCheck = true;
    root.source = sourceUrl;
    if (releaseNotes) root.releaseNotes = releaseNotes;
    else delete root.releaseNotes;
    root.moves = PATH_MOVES.map(move => ({ ...move }));
    root.checksums = checksumSync.next;
    root.sources = sourceSync.next;

    fs.writeFileSync(ROOT_HARNESS_VERSION, JSON.stringify(root, null, 2) + '\n', 'utf8');
    console.log(
      `[build-version] synced root Harness/.harness-version ` +
      `(generator ${generatorVersion}, checksums ${checksumSync.updated} updated/${checksumSync.added} added, ` +
      `${checksumSync.removed} removed, sources ${sourceSync.updated} updated/${sourceSync.added} added, ` +
      `${sourceSync.removed} removed)`
    );
  }
}

console.log(`[build-version] wrote templates/common/.harness-version`);
console.log(`  generator:          ${generatorVersion}`);
console.log(`  generated:          ${versionObj.generated}`);
console.log(`  checksummed files:  ${fileCount}`);
console.log(`  sources entries:    ${sourceCount}`);
console.log(`  checksums entries:  ${checksumCount}`);
console.log(`  no {{placeholders}}: OK`);
