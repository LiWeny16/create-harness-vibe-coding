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

// --- main ---

const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const generatorVersion = pkg.version;

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
  const next = { ...(existing || {}) };
  let added = 0;
  let updated = 0;

  for (const [key, value] of Object.entries(templateMap)) {
    if (!rootFileExists(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      added++;
    } else if (next[key] !== value) {
      updated++;
    }
    next[key] = value;
  }

  return { next: sortedByKey(next), added, updated };
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
    const checksumSync = syncExistingRootTemplateMap(
      root.checksums && typeof root.checksums === 'object' ? root.checksums : {},
      ROOT_CHECKSUMS
    );
    const sourceSync = syncExistingRootTemplateMap(
      root.sources && typeof root.sources === 'object' ? root.sources : {},
      ROOT_SOURCES
    );

    root.generator = generatorVersion;
    root.generated = versionObj.generated;
    root.autoCheck = true;
    root.source = sourceUrl;
    root.checksums = checksumSync.next;
    root.sources = sourceSync.next;

    fs.writeFileSync(ROOT_HARNESS_VERSION, JSON.stringify(root, null, 2) + '\n', 'utf8');
    console.log(
      `[build-version] synced root Harness/.harness-version ` +
      `(generator ${generatorVersion}, checksums ${checksumSync.updated} updated/${checksumSync.added} added, ` +
      `sources ${sourceSync.updated} updated/${sourceSync.added} added)`
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
