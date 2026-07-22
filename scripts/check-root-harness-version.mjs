#!/usr/bin/env node
/**
 * check-root-harness-version.mjs
 *
 * Verifies that the dogfood root Harness/.harness-version checksums still
 * match the actual root files. This is a drift detector complementing
 * build-version's auto-sync: any residual drift (root file edited by hand
 * but checksum not refreshed) fails pre-push.
 *
 *   node scripts/check-root-harness-version.mjs        # verify
 *   node scripts/check-root-harness-version.mjs --quiet # suppress per-file OK
 *   node scripts/check-root-harness-version.mjs --root <dir> # point at a fixture tree
 *
 * Files declared in acceptedConflicts with decision "accept-local" (and their
 * cross-runtime mirrors) are reported as ACCEPTED and excluded from drift
 * findings, since they are intentionally kept local during an update.
 *
 * Exit 0 = checksums match (or none to verify). Exit 1 = drift/missing files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default ROOT is the real repo root. `--root <dir>` is a testability hook so
// the drift detector can be pointed at a fixture tree; default behavior is
// unchanged when the flag is absent.
const ROOT_ARG_IDX = process.argv.indexOf('--root');
const ROOT = ROOT_ARG_IDX !== -1 && process.argv[ROOT_ARG_IDX + 1]
  ? path.resolve(process.argv[ROOT_ARG_IDX + 1])
  : path.resolve(__dirname, '..');

const QUIET = process.argv.includes('--quiet');

const ROOT_VERSION_PATH = path.join(ROOT, 'Harness', '.harness-version');

function abbr(checksum) {
  // checksum looks like 'sha256-<hex>'; show first 8 hex chars.
  const hex = String(checksum).replace(/^sha256-/, '');
  return hex.slice(0, 8);
}

function sha256Hex(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  return 'sha256-' + createHash('sha256').update(normalized).digest('hex');
}

// Cross-runtime mirror rules: a `.claude/<kind>/<X>` file is mirrored into the
// matching sibling runtime at generation time, so an accept-local conflict on
// the `.claude` source also implies its mirror is intentionally local. The
// mirror prefixes match src/generator.js (createCodexSkillMirrors) and the
// validate-harness mirror invariants for agents/commands.
const MIRROR_PREFIXES = [
  [/^\.claude\/skills\//, '.agents/skills/'],
  [/^\.claude\/agents\//, '.opencode/agents/'],
  [/^\.claude\/commands\//, '.opencode/commands/'],
];

function mirrorOf(key) {
  for (const [re, replacement] of MIRROR_PREFIXES) {
    if (re.test(key)) return key.replace(re, replacement);
  }
  return null;
}

// Build the set of dest-path keys that are declared accepted-local and must not
// be flagged as drift. Includes cross-runtime mirrors of each accepted key.
function buildSkipSet(root) {
  const skip = new Set();
  if (!root || typeof root !== 'object') return skip;
  const accepted = root.acceptedConflicts;
  if (!accepted || typeof accepted !== 'object') return skip;
  for (const [key, entry] of Object.entries(accepted)) {
    if (!entry || entry.decision !== 'accept-local') continue;
    skip.add(key);
    const mirrored = mirrorOf(key);
    if (mirrored && mirrored !== key) skip.add(mirrored);
  }
  return skip;
}

// --- main ---

if (!fs.existsSync(ROOT_VERSION_PATH)) {
  console.log('[check-root] no root checksums to verify');
  process.exit(0);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(ROOT_VERSION_PATH, 'utf8'));
} catch (err) {
  console.error(`[check-root] failed to parse Harness/.harness-version: ${err.message}`);
  process.exit(1);
}

const checksums = parsed && typeof parsed === 'object' ? parsed.checksums : null;
if (!checksums || typeof checksums !== 'object') {
  console.log('[check-root] no root checksums to verify');
  process.exit(0);
}

const keys = Object.keys(checksums);
const skip = buildSkipSet(parsed);
const findings = [];
let accepted = 0;

for (const key of keys) {
  if (skip.has(key)) {
    accepted++;
    if (!QUIET) console.log(`  ACCEPTED (accept-local): ${key}`);
    continue;
  }
  const absPath = path.resolve(ROOT, ...key.split('/'));
  if (!fs.existsSync(absPath)) {
    findings.push(`missing file: ${key}`);
    continue;
  }
  const content = fs.readFileSync(absPath, 'utf8');
  const actual = sha256Hex(content);
  const recorded = checksums[key];
  if (actual !== recorded) {
    findings.push(`drift: ${key} (recorded ${abbr(recorded)}…, actual ${abbr(actual)}…)`);
    continue;
  }
  if (!QUIET) {
    console.log(`  OK ${key}`);
  }
}

if (findings.length > 0) {
  console.error(`[check-root] ${findings.length} drift finding(s) in root Harness/.harness-version:`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}

const acceptedNote = accepted > 0 ? `, ${accepted} accepted-local skipped` : '';
console.log(`[check-root] root Harness/.harness-version checksums match (${keys.length} files${acceptedNote})`);
process.exit(0);
