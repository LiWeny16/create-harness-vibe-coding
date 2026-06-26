/**
 * build-version.mjs
 *
 * Populates templates/common/.harness-version with real version, checksums,
 * and a sources map so the published file isn't a placeholder.
 *
 * Usage:
 *   node scripts/build-version.mjs          # writes the file
 *   node scripts/build-version.mjs --check  # dry-run, prints diff, exits 0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeChecksums, harnessDest, isChecksumExcluded } from '../src/generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

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

// --- main ---

const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const generatorVersion = pkg.version;

const TEMPLATES_DIR = path.join(ROOT, 'templates', 'common');
const HARNESS_VERSION_PATH = path.join(TEMPLATES_DIR, '.harness-version');

// Read existing file to preserve the source URL
const existing = JSON.parse(fs.readFileSync(HARNESS_VERSION_PATH, 'utf8'));
const sourceUrl = existing.source || 'https://raw.githubusercontent.com/zingspark/create-harness-vibe-coding/main/templates/common/';

// Walk templates/common/ and build file list
const accumulatedFiles = [];  // { dest, content }
const sources = {};           // dest -> templateRelPath (POSIX)

for (const rawRel of walkFiles(TEMPLATES_DIR)) {
  const rel = normalizePath(rawRel);         // POSIX template-relative path
  const dest = harnessDest(rel);             // POSIX dest path

  // Always record the source mapping (including .harness-version itself)
  sources[dest] = rel;

  // Skip checksum-excluded files (PRESERVE + .harness-version)
  if (isChecksumExcluded(dest)) continue;
  // Also skip .harness-version by dest (the generator excludes it via CHECKSUM_EXCLUDE)
  // isChecksumExcluded already covers Harness/.harness-version; the template path maps there.

  const content = fs.readFileSync(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
  accumulatedFiles.push({ dest, content });
}

const checksums = computeChecksums(accumulatedFiles);

const versionObj = {
  generator: generatorVersion,
  generated: new Date().toISOString(),
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
  if (currentRaw === output) {
    console.log(`[build-version] --check: file is already up to date (${fileCount} checksummed files, ${sourceCount} sources).`);
  } else {
    console.log(`[build-version] --check: file WOULD change.`);
    console.log(`  generator: ${generatorVersion}`);
    console.log(`  checksummed files: ${fileCount}`);
    console.log(`  sources entries: ${sourceCount}`);
    console.log(`  checksums entries: ${checksumCount}`);
    console.log('  (run without --check to apply)');
  }
  process.exit(0);
}

fs.writeFileSync(HARNESS_VERSION_PATH, output, 'utf8');

console.log(`[build-version] wrote templates/common/.harness-version`);
console.log(`  generator:          ${generatorVersion}`);
console.log(`  generated:          ${versionObj.generated}`);
console.log(`  checksummed files:  ${fileCount}`);
console.log(`  sources entries:    ${sourceCount}`);
console.log(`  checksums entries:  ${checksumCount}`);
console.log(`  no {{placeholders}}: OK`);
