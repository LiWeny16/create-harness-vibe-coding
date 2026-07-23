#!/usr/bin/env node
/**
 * wf-update-check.mjs - Fast harness update comparison.
 * Fetches remote checksums, compares locally, classifies all files instantly.
 * Only CONFLICT files need AI/user decision.
 *
 * Usage:
 *   node Harness/scripts/wf-update-check.mjs              # full dry-run plan
 *   node Harness/scripts/wf-update-check.mjs --json       # JSON output for AI consumption
 *   node Harness/scripts/wf-update-check.mjs --json              # summary/counts + short agent hints only (token-safe)
 *   node Harness/scripts/wf-update-check.mjs --json --full-plan  # also include full plan + conflict details (verbose)
 *   node Harness/scripts/wf-update-check.mjs --apply-safe # apply SAFE+NEW, leave CONFLICT for AI
 *   node Harness/scripts/wf-update-check.mjs --apply      # apply only when no CONFLICT exists
 *
 *   --full-plan and --verbose are aliases.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, lstatSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import { gunzipSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.WF_ROOT ? resolve(process.env.WF_ROOT) : resolve(__dirname, '..', '..');
const VERSION_FILE = resolve(ROOT, 'Harness', '.harness-version');
const NPM_PACKAGE = 'create-harness-vibe-coding';
const NPM_REGISTRY = (process.env.NPM_CONFIG_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');
const GITHUB_REPO = 'LiWeny16/create-harness-vibe-coding';
const LEGACY_GITHUB_REPO = 'zingspark/create-harness-vibe-coding';
const GITHUB_LATEST_STABLE = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RAW_GITHUB = `https://raw.githubusercontent.com/${GITHUB_REPO}`;
const LEGACY_RAW_GITHUB = `https://raw.githubusercontent.com/${LEGACY_GITHUB_REPO}`;
const TEMPLATE_SUBPATH = 'templates/common/';
const DEFAULT_SOURCE_BASE = `${RAW_GITHUB}/main/${TEMPLATE_SUBPATH}`;
const LEGACY_SOURCE_BASE = `${LEGACY_RAW_GITHUB}/main/${TEMPLATE_SUBPATH}`;
const npmPackageCache = new Map();

// Tier classification

/** Files we NEVER overwrite or delete. */
const PRESERVE_PATTERNS = [
  /^Harness\/PROGRESS\.md$/,
  /^Harness\/tasks\//,
  /^Harness\/memory\//,
  /^Harness\/research\/PRD\.md$/,
  /^Harness\/research\/research-results\.md$/,
  /^Harness\/architecture\.md$/,
  /^Harness\/project\/architecture\.md$/,
  /^README\.md$/,
  /^\.gitignore$/,
  /^package\.json$/,
  /^package-lock\.json$/,
];

/** Files that are safe to overwrite if checksums match, otherwise need merge. */
const MERGE_PATTERNS = [
  /^CLAUDE\.md$/,
  /^AGENTS\.md$/,
  /^MEMORY\.md$/,
  /^Harness\/MEMORY\.md$/,
  /^Harness\/README\.md$/,
  /^Harness\/settings\.json$/,
];

const OPTIONAL_REGISTRATION_FILES = new Set([
  '.claude/commands/wf-help.md',
  'Harness/MEMORY.md',
  'Harness/README.md',
]);

const HARNESS_OWNED_CANDIDATE_PATTERNS = [
  /^\.claude\/agents\/[^/]+\.md$/,
  /^\.opencode\/agents\/[^/]+\.md$/,
  /^\.claude\/commands\/wf(?:-[^/]+)?\.md$/,
  /^\.opencode\/commands\/wf(?:-[^/]+)?\.md$/,
  /^\.claude\/skills\/(?:wf|wf-[^/]+|subagent-orchestrator|tdd)\/SKILL\.md$/,
  /^\.agents\/skills\/(?:wf|wf-[^/]+|subagent-orchestrator|tdd)\/SKILL\.md$/,
  /^\.codex\//,
  /^\.opencode\/plugins\/harness-/,
  /^Harness\/scripts\//,
];

const HARNESS_OWNED_CONTENT_MARKERS = [
  /^harness:\s*(?:wf-agent|wf-framework|create-harness-vibe-coding)\b/im,
  /\bcreate-harness-vibe-coding\b/i,
  /\bproject harness\b/i,
  /\bHarness\/(?:specs|WF|MEMORY|tasks|scripts|subagents|dispatch|context-loading|lifecycle|SETUP)\b/,
  /\bWF-(?:MAX|AUTO|KERNEL|STATE)\b/,
];

// Helpers

/** Reject paths that escape ROOT (traversal, absolute, .., etc.). */
function safePath(file) {
  if (/^[A-Za-z]:/.test(file)) return null;
  let normalized = file.replace(/\\/g, '/').replace(/^\/+/, '');
  if (/\/\//.test(normalized)) return null;
  if (normalized.split('/').some(p => p === '..')) return null;
  if (file.startsWith('/') || file.startsWith('\\')) return null;
  if (normalized === '.' || normalized === '') return null;
  const resolved = resolve(ROOT, normalized);
  if (!resolved.startsWith(ROOT + sep) && resolved !== ROOT) return null;
  return resolved;
}

/** Canonical normalization for classification matching. */
function canonicalPath(file) {
  return file.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function readFlagValue(args, flagName) {
  const idx = args.indexOf(flagName);
  if (idx === -1) return null;
  const value = args[idx + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}

function readRepeatedFlagValues(args, flagName) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === flagName && args[i + 1] && !args[i + 1].startsWith('--')) {
      values.push(args[i + 1]);
      i += 1;
    } else if (arg.startsWith(`${flagName}=`)) {
      values.push(arg.slice(flagName.length + 1));
    }
  }
  return [...new Set(values.map(canonicalPath).filter(Boolean))];
}

function normalizeSourceBase(sourceBase) {
  return sourceBase.endsWith('/') ? sourceBase : sourceBase + '/';
}

function selectedOptionIds(localVersion) {
  return new Set(
    Array.isArray(localVersion?.options)
      ? localVersion.options.map(String).filter(Boolean)
      : [],
  );
}

function optionalSkillFromSource(source) {
  const normalized = canonicalPath(source || '');
  const match = normalized.match(/^skills\/([^/]+)\//);
  return match ? match[1] : null;
}

function isInstalledOptionalFile(file, localVersion) {
  const skillId = optionalSkillFromSource(localVersion?.sources?.[file]);
  return Boolean(skillId && selectedOptionIds(localVersion).has(skillId));
}

function hasInstalledOptions(localVersion) {
  return selectedOptionIds(localVersion).size > 0;
}

/** Detect template placeholders in remote content. */
function isTemplate(raw) {
  return /\{\{[a-zA-Z]+\}\}/.test(raw);
}

function sha256(content) {
  return 'sha256-' + createHash('sha256').update(content).digest('hex');
}

function sha256File(path) {
  if (!existsSync(path)) return null;
  let content = readFileSync(path, 'utf-8');
  // Normalize CRLF to LF.
  content = content.replace(/\r\n/g, '\n');
  return sha256(content);
}

// ── Ownership manifest (manifest-first classification) ─────────────────────
//
// Harness/ownership.manifest.json is the machine-readable source of truth for
// file classification. When present it drives PRESERVE/MERGE/frameworkOwned/
// optionalOwned decisions; the path-regex + content-marker logic below remains
// as a FALLBACK for old installs that ship no manifest. The updater cannot
// import from scripts/lib (different package layer), so a small local glob
// matcher mirrors the one in scripts/lib/ownership-manifest.mjs.

function globToRegex(pattern) {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i += 2;
      if (pattern[i] === '/') i += 1; // swallow a trailing slash after **
    } else if (c === '*') {
      re += '[^/]*';
      i += 1;
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp('^' + re + '$');
}

function matchesGlob(dest, pattern) {
  if (!pattern.includes('*')) return dest === pattern;
  return globToRegex(pattern).test(dest);
}

function matchesAnyGlob(dest, patterns) {
  return (patterns || []).some(p => matchesGlob(dest, p));
}

function buildOptionalOwnedMap(optionalOwned) {
  const map = new Map();
  for (const entry of optionalOwned || []) {
    if (!entry || typeof entry.option !== 'string') continue;
    map.set(entry.option, new Set(entry.paths || []));
  }
  return map;
}

/** Load + validate the ownership manifest. Missing/unreadable/invalid -> null (fallback mode). */
function loadOwnershipManifest(root) {
  const manifestPath = resolve(root, 'Harness', 'ownership.manifest.json');
  try {
    if (!existsSync(manifestPath)) return null;
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.preserve)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildManifestCtx(manifest) {
  if (!manifest) {
    return { present: false, preserveGlobs: [], mergeSet: new Set(), frameworkOwnedSet: new Set(), optionalOwned: new Map() };
  }
  return {
    present: true,
    preserveGlobs: manifest.preserve || [],
    mergeSet: new Set(manifest.merge || []),
    frameworkOwnedSet: new Set((manifest.frameworkOwned || []).map(e => e && e.path).filter(Boolean)),
    optionalOwned: buildOptionalOwnedMap(manifest.optionalOwned),
  };
}

function isPreserveFile(file, ctx) {
  if (ctx.present) return matchesAnyGlob(file, ctx.preserveGlobs);
  return PRESERVE_PATTERNS.some(p => p.test(file));
}

function isMergeFile(file, ctx) {
  if (ctx.present) return ctx.mergeSet.has(file);
  return MERGE_PATTERNS.some(p => p.test(file));
}

/** Manifest-first declared ownership: frameworkOwned, or optionalOwned whose option is selected. */
function isDeclaredHarnessOwned(file, ctx, selectedOptions) {
  if (!ctx.present) return false;
  if (ctx.frameworkOwnedSet.has(file)) return true;
  for (const [option, paths] of ctx.optionalOwned) {
    if (paths.has(file) && selectedOptions.has(option)) return true;
  }
  return false;
}

/** An optional-owned file whose owning option is NOT selected for this install. */
function isOptionalOwnedUnselected(file, ctx, selectedOptions) {
  if (!ctx.present) return false;
  let owned = false;
  for (const [option, paths] of ctx.optionalOwned) {
    if (paths.has(file)) {
      owned = true;
      if (selectedOptions.has(option)) return false;
    }
  }
  return owned;
}

/**
 * Manifest-first untracked-existing-file ownership. When a remote file is NEW
 * (not in local checksums) but exists on disk, decide Harness-owned vs
 * user-owned. The MARKER decides instance ownership: a prior Harness install
 * leaves a marker, a user-authored file at a Harness-looking path does not.
 * Manifest declaration (frameworkOwned / installed-optional) and the candidate
 * regex only build the Harness-interest candidate set; they never by themselves
 * authorize overwriting an untracked file. A user file at a Harness-interest
 * path with NO marker stays a conflict (protected) in BOTH manifest and
 * fallback modes. This matches the installer and AC #5: a user's same-name
 * agent/command/skill must never be overwritten.
 */
function isHarnessOwnedExistingFileManifestFirst(file, diskPath, ctx, selectedOptions) {
  // A manifest-declared path joins the candidate set, but — like a regex
  // candidate — still requires a Harness content marker to be adopted. The
  // marker (not the declaration) decides adopt-vs-conflict for an untracked
  // existing file, in both manifest and fallback modes.
  if (isDeclaredHarnessOwned(file, ctx, selectedOptions)) {
    return fileHasHarnessOwnedMarker(diskPath);
  }
  return isHarnessOwnedExistingFile(file, diskPath);
}

function classify(file, localHash, storedHash, ctx) {
  // PRESERVE
  if (isPreserveFile(file, ctx)) return 'PRESERVE';
  // MERGE: dual-purpose, check if user modified.
  if (isMergeFile(file, ctx)) {
    if (localHash === storedHash) return 'SAFE'; // unmodified, safe
    return 'CONFLICT'; // user modified, needs decision
  }
  // Everything else is SAFE runtime file: always overwrite.
  // Harness system files (scripts, skills, agents, commands, WF docs) are
  // not user data; the template is authoritative. Only PRESERVE and MERGE
  // files should ever require conflict resolution.
  return 'SAFE';
}

function isHarnessOwnedCandidate(file) {
  return HARNESS_OWNED_CANDIDATE_PATTERNS.some(pattern => pattern.test(file));
}

/** Read on-disk content and test for a Harness ownership marker. */
function fileHasHarnessOwnedMarker(diskPath) {
  try {
    const content = readFileSync(diskPath, 'utf-8');
    return HARNESS_OWNED_CONTENT_MARKERS.some(pattern => pattern.test(content));
  } catch {
    return false;
  }
}

function isHarnessOwnedExistingFile(file, diskPath) {
  if (!isHarnessOwnedCandidate(file)) return false;
  return fileHasHarnessOwnedMarker(diskPath);
}

async function fetchRemote(url, timeoutMs = 30000) {
  if (url.startsWith('file://')) {
    return readFileSync(fileURLToPath(url), 'utf-8');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytes(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'harness-wf-update-check' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function tarString(header, start, length) {
  const slice = header.subarray(start, start + length);
  const zero = slice.indexOf(0);
  return Buffer.from(zero === -1 ? slice : slice.subarray(0, zero)).toString('utf8').trim();
}

function parseTarFiles(buffer) {
  const files = new Map();
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;

    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const sizeText = tarString(header, 124, 12);
    const size = Number.parseInt(sizeText || '0', 8) || 0;
    const type = String.fromCharCode(header[156] || 0);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const dataStart = offset + 512;

    if ((type === '\0' || type === '0' || type === '') && fullName) {
      files.set(fullName, buffer.subarray(dataStart, dataStart + size));
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

// Main

function isPrerelease(v) {
  if (!v || typeof v !== 'string') return false;
  return /-[0-9A-Za-z.-]+/.test(v.replace(/^[^0-9]*/, ''));
}

function parseSemver(v) {
  if (!v || typeof v !== 'string') return [0, 0, 0];
  return v.replace(/^[^0-9]*/, '').split('.').slice(0, 3).map(n => Number(n) || 0);
}

function cmpSemver(a, b) {
  const va = parseSemver(a), vb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if ((va[i] || 0) > (vb[i] || 0)) return 1;
    if ((va[i] || 0) < (vb[i] || 0)) return -1;
  }
  return 0;
}

async function loadNpmPackage(version = 'latest') {
  const cacheKey = `${NPM_REGISTRY}:${version}`;
  if (npmPackageCache.has(cacheKey)) return npmPackageCache.get(cacheKey);

  const metaUrl = `${NPM_REGISTRY}/${NPM_PACKAGE}/${version}`;
  const meta = JSON.parse(await fetchRemote(metaUrl, 15000));
  const packageVersion = meta.version;
  const tarball = meta?.dist?.tarball;
  if (!packageVersion || !tarball) throw new Error(`npm metadata missing dist.tarball for ${NPM_PACKAGE}@${version}`);

  const archive = gunzipSync(await fetchBytes(tarball, 30000));
  const files = parseTarFiles(archive);
  const loaded = { version: packageVersion, tarball, files };
  npmPackageCache.set(cacheKey, loaded);
  npmPackageCache.set(`${NPM_REGISTRY}:${packageVersion}`, loaded);
  return loaded;
}

function readNpmFile(pkg, templateRelPath) {
  const key = `package/${TEMPLATE_SUBPATH}${templateRelPath}`;
  const content = pkg.files.get(key);
  if (!content) throw new Error(`npm package missing ${key}`);
  return Buffer.from(content).toString('utf8');
}

async function createNpmSource(version = 'latest') {
  const pkg = await loadNpmPackage(version);
  const raw = readNpmFile(pkg, '.harness-version');
  if (isTemplate(raw)) throw new Error('npm .harness-version has not been generated yet');
  const manifest = JSON.parse(raw);
  return {
    kind: 'npm',
    stable: true,
    label: `npm:${NPM_PACKAGE}@${pkg.version}/${TEMPLATE_SUBPATH}`,
    version: pkg.version,
    manifest,
    package: pkg,
  };
}

async function createUrlSource(sourceBase, { stable = false } = {}) {
  const base = normalizeSourceBase(sourceBase);
  const raw = await fetchRemote(base + '.harness-version');
  if (isTemplate(raw)) throw new Error('remote .harness-version has not been generated yet');
  return {
    kind: 'url',
    stable,
    label: base,
    base,
    manifest: JSON.parse(raw),
  };
}

async function resolveGithubReleaseSource() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(GITHUB_LATEST_STABLE, {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'harness-wf-update-check' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = JSON.parse(await res.text());
    const tag = data && data.tag_name;
    if (!tag || data.prerelease) return null;
    return await createUrlSource(`${RAW_GITHUB}/${tag}/${TEMPLATE_SUBPATH}`, { stable: true });
  } catch {
    return null;
  }
}

async function resolveUpdateSource(explicitSource) {
  if (explicitSource) {
    return createUrlSource(explicitSource, { stable: false });
  }

  const errors = [];
  try {
    return await createNpmSource('latest');
  } catch (e) {
    errors.push(`npm latest: ${e.message}`);
  }

  const releaseSource = await resolveGithubReleaseSource();
  if (releaseSource) return releaseSource;
  errors.push('GitHub latest release: unavailable');

  try {
    return await createUrlSource(DEFAULT_SOURCE_BASE, { stable: false });
  } catch (e) {
    errors.push(`GitHub canonical main: ${e.message}`);
  }

  try {
    return await createUrlSource(LEGACY_SOURCE_BASE, { stable: false });
  } catch (e) {
    errors.push(`GitHub legacy mirror: ${e.message}`);
  }

  const err = new Error('Cannot reach npm, canonical GitHub, or legacy mirror update sources.');
  err.sourceErrors = errors;
  throw err;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const applySafe = args.includes('--apply-safe') || args.includes('--safe-only');
  const jsonOut = args.includes('--json');
  const finalize = args.includes('--finalize');
  const acceptLocal = readRepeatedFlagValues(args, '--accept-local');
  const acceptMerged = readRepeatedFlagValues(args, '--accept-merged');
  const acceptTemplate = readRepeatedFlagValues(args, '--accept-template');
  const ignoreVersion = args.includes('--ignore-version') || args.includes('--force-check');
  const explicitSource = readFlagValue(args, '--source-base') || process.env.WF_SOURCE_BASE;
  let source;
  let sourceBase;
  let sourceStable = false;
  let sourceErrors = [];
  try {
    source = await resolveUpdateSource(explicitSource);
    sourceBase = source.label;
    sourceStable = Boolean(source.stable);
  } catch (e) {
    sourceErrors = e.sourceErrors || [e.message];
  }

  // 1. Read local state
  if (!existsSync(VERSION_FILE)) {
    if (jsonOut) {
      console.log(JSON.stringify({
        status: 'error',
        message: 'Local Harness/.harness-version not found. Is Harness installed?',
        recovery: 'If this is an old Harness install that predates .harness-version, do not reinstall blindly. Restore Harness/.harness-version from backup if available. If the updater script is also missing, run from the project root: npx create-harness-vibe-coding@latest <name> . -y --on-conflict skip --json to restore missing updater infrastructure without overwriting user files.',
      }));
    } else {
      console.error('ERROR: Harness/.harness-version not found. Is Harness installed?');
      console.error('  If this is an old Harness install without version tracking, do not reinstall blindly.');
      console.error('  Restore Harness/.harness-version from backup if available.');
      console.error('  If the updater script is also missing, recover with:');
      console.error('    npx create-harness-vibe-coding@latest <project-name> . -y --on-conflict skip --json');
      console.error('  This restores missing updater infrastructure without overwriting user data.');
    }
    process.exitCode = 1;
    return;
  }

  let localVersion;
  try {
    localVersion = JSON.parse(readFileSync(VERSION_FILE, 'utf-8'));
  } catch (e) {
    if (jsonOut) {
      console.log(JSON.stringify({
        status: 'error',
        message: 'Failed to parse Harness/.harness-version: ' + e.message,
        recovery: 'The .harness-version file may be corrupted. Do not overwrite user files. Back up or move the corrupted Harness/.harness-version before manual recovery. If the updater script is also missing, run from the project root: npx create-harness-vibe-coding@latest <name> . -y --on-conflict skip --json to restore missing updater infrastructure.',
      }));
    } else {
      console.error('ERROR: Failed to parse Harness/.harness-version:', e.message);
      console.error('  The file may be corrupted. Back up or move Harness/.harness-version before manual recovery.');
      console.error('  If the updater script is also missing, recover with:');
      console.error('    npx create-harness-vibe-coding@latest <project-name> . -y --on-conflict skip --json');
    }
    process.exitCode = 1;
    return;
  }

  if (!localVersion || typeof localVersion !== 'object') {
    if (jsonOut) {
      console.log(JSON.stringify({ status: 'error', message: 'Invalid Harness/.harness-version structure.' }));
    } else {
      console.error('ERROR: Harness/.harness-version has unexpected structure.');
    }
    process.exitCode = 1;
    return;
  }

  const localChecksums = localVersion.checksums || {};

  // Ownership manifest: manifest-first classification with regex/marker fallback
  // for old installs that ship no manifest. manifest=null -> fallback mode.
  const manifest = loadOwnershipManifest(ROOT);
  const manifestCtx = buildManifestCtx(manifest);
  const selectedOptions = selectedOptionIds(localVersion);

  // 2. Read remote version metadata from the selected update source.
  let remoteVersion = source?.manifest;
  if (!remoteVersion) {
    if (jsonOut) {
      console.log(JSON.stringify({
        status: 'offline',
        message: 'Cannot reach npm, canonical GitHub, or legacy mirror update sources.',
        sourceErrors,
      }));
    } else {
      console.error('ERROR: Cannot reach npm, canonical GitHub, or legacy mirror update sources. Offline?');
      for (const err of sourceErrors) console.error(`  ${err}`);
    }
    process.exitCode = 1;
    return;
  }

  const localGen = localVersion.generator || '0.0.0';
  const remoteGen = remoteVersion.generator || '0.0.0';

  if (!ignoreVersion && isPrerelease(remoteGen)) {
    if (jsonOut) {
      console.log(JSON.stringify({ status: 'up-to-date', version: localGen, remote: remoteGen, sourceBase }));
    } else {
      console.log(`Already up to date (v${localGen}). Remote ${remoteGen} is a prerelease and is ignored.`);
    }
    return;
  }

  const versionCmp = cmpSemver(remoteGen, localGen);

  if (!ignoreVersion && versionCmp <= 0) {
    const reportDowngrade = !sourceStable;
    if (jsonOut) {
      console.log(JSON.stringify({
        status: (versionCmp < 0 && reportDowngrade) ? 'downgrade-refused' : 'up-to-date',
        version: localGen,
        remote: remoteGen,
        sourceBase,
      }));
    } else if (versionCmp < 0 && reportDowngrade) {
      console.log(`WARN: Remote (v${remoteGen}) is OLDER than local (v${localGen}). Downgrade refused.`);
    } else {
      console.log(`Already up to date (v${localGen})`);
    }
    if (versionCmp < 0 && reportDowngrade) process.exitCode = 1;
    return;
  }

  if (ignoreVersion) {
    if (!jsonOut) console.log('Version check bypassed (--ignore-version). Comparing files anyway.');
  }

  const remoteChecksums = remoteVersion.checksums || {};
  const remoteSources = remoteVersion.sources || {};
  const remoteMoves = Array.isArray(remoteVersion.moves)
    ? remoteVersion.moves
        .map(move => ({
          from: canonicalPath(move?.from || ''),
          to: canonicalPath(move?.to || ''),
          deleteOldIfChecksumMatches: move?.deleteOldIfChecksumMatches !== false,
          preserveOldIfModified: move?.preserveOldIfModified !== false,
        }))
        .filter(move => move.from && move.to && remoteChecksums[move.to])
    : [];
  const moveByFrom = new Map(remoteMoves.map(move => [move.from, move]));
  const movedToFiles = new Set();
  localVersion.acceptedConflicts = localVersion.acceptedConflicts || {};

  /** Resolve the remote template-relative path for a dest-keyed file. Falls back to the key itself for back-compat. */
  function remotePath(file) {
    return remoteSources[file] || file;
  }

  async function fetchSourceFile(templateRelPath) {
    if (source.kind === 'npm') return readNpmFile(source.package, templateRelPath);
    return fetchRemote(source.base + templateRelPath);
  }

  function sourceUrl(templateRelPath) {
    if (source.kind === 'npm') return `${source.label}${templateRelPath}`;
    return source.base + templateRelPath;
  }

  function releaseHighlights(versionObj) {
    const highlights = versionObj?.releaseNotes?.highlights;
    return Array.isArray(highlights)
      ? highlights.map(String).map(s => s.trim()).filter(Boolean)
      : [];
  }

  function printReleaseHighlights(versionObj) {
    const highlights = releaseHighlights(versionObj).slice(0, 6);
    if (highlights.length === 0) return;
    console.log('\nRelease highlights:');
    for (const item of highlights) console.log(`   - ${item}`);
  }

  function withRemoteMeta(entry) {
    if (!entry || !entry.file || !remoteChecksums[entry.file]) return entry;
    const templateHint = remotePath(entry.file);
    return {
      ...entry,
      templateHint,
      remoteUrl: sourceUrl(templateHint),
    };
  }

  function withConflictActions(entry) {
    return {
      ...withRemoteMeta(entry),
      choices: ['merge', 'keep-local', 'overwrite-from-template'],
      decisionCommands: {
        keepLocal: `node Harness/scripts/wf-update-check.mjs --accept-local ${shellArg(entry.file)} --finalize`,
        acceptMerged: `node Harness/scripts/wf-update-check.mjs --accept-merged ${shellArg(entry.file)} --finalize`,
        overwriteFromTemplate: `node Harness/scripts/wf-update-check.mjs --accept-template ${shellArg(entry.file)} --finalize`,
      },
    };
  }

  function shellArg(value) {
    return /^[A-Za-z0-9@._/\\:-]+$/.test(value) ? value : JSON.stringify(value);
  }

  function buildJsonPlan() {
    const verbose = args.includes('--verbose') || args.includes('--full-plan');
    return {
      updated: plan.updated.map(withRemoteMeta),
      created: plan.created.map(withRemoteMeta),
      adopted: plan.adopted.map(withRemoteMeta),
      conflict: verbose ? plan.conflict.map(withConflictActions) : plan.conflict.map(withConflictActions).slice(0, 5),
      conflictTruncated: !verbose && plan.conflict.length > 5 ? plan.conflict.length - 5 : undefined,
      moved: plan.moved.map(withRemoteMeta),
      skipped: plan.skipped.map(withRemoteMeta),
    };
  }

  function buildAgentHints(jsonPlan) {
    // Token-safe by default: omit the conflict array; full list available via --json --verbose (or --full-plan)
    const verbose = args.includes('--verbose') || args.includes('--full-plan');
    const maxConflictDetails = verbose ? Infinity : 5;
    const totalConflicts = plan.conflict.length;
    const conflicts = jsonPlan.conflict.slice(0, maxConflictDetails);
    const truncated = totalConflicts > maxConflictDetails
      ? totalConflicts - maxConflictDetails
      : 0;
    return {
      mode: 'script-first-ai-conflicts',
      dryRunJsonCommand: 'node Harness/scripts/wf-update-check.mjs --json',
      safeApplyCommand: 'node Harness/scripts/wf-update-check.mjs --apply-safe',
      strictApplyCommand: 'node Harness/scripts/wf-update-check.mjs --apply',
      finalizeCommand: 'node Harness/scripts/wf-update-check.mjs --finalize',
      pathMoves: remoteMoves,
      partialUpdate: localVersion.partialUpdate || null,
      acceptedConflicts: localVersion.acceptedConflicts || {},
      releaseNotes: remoteVersion.releaseNotes || null,
      releaseHighlights: releaseHighlights(remoteVersion),
      updateReportRequired: 'After apply/finalize, tell the user the version, safe/new/conflict counts, validation results, and the core releaseHighlights from this update.',
      // aiMergeRequired array is attached only in verbose mode to keep default output token-safe.
      ...(verbose ? { aiMergeRequired: conflicts } : {}),
      aiMergeRequiredCount: totalConflicts,
      aiMergeRequiredTruncated: truncated > 0 ? truncated : undefined,
      conflictPolicy: 'Use the script for SAFE/NEW/adopted files. For each CONFLICT file, compare local content with templateHint/remoteUrl, then record the decision with --accept-local, --accept-merged, or --accept-template. Do not hand-edit Harness/.harness-version.',
      postUpdateCommands: [
        'node Harness/scripts/validate-harness.mjs',
        'node Harness/scripts/scan-clean.mjs --json',
      ],
      bootstrapDebtCommand: 'node Harness/scripts/validate-harness.mjs --strict',
    };
  }

  async function applyTemplateFile(file) {
    const remoteHash = remoteChecksums[file];
    if (!remoteHash) throw new Error(`No remote checksum for ${file}`);
    const dest = safePath(file);
    if (!dest) throw new Error(`Traversal rejected: ${file}`);
    if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) throw new Error(`Symlink rejected: ${file}`);
    const content = await fetchSourceFile(remotePath(file));
    const normalized = content.replace(/\r\n/g, '\n');
    const fetchedHash = sha256(normalized);
    if (fetchedHash !== remoteHash) throw new Error(`Hash mismatch: ${file}`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, normalized, 'utf-8');
    localVersion.checksums[file] = remoteHash;
    delete localVersion.acceptedConflicts[file];
  }

  function recordLocalDecision(file, decision, appliedAt) {
    const remoteHash = remoteChecksums[file];
    if (!remoteHash) throw new Error(`No remote checksum for ${file}`);
    const diskPath = safePath(file);
    if (!diskPath) throw new Error(`Traversal rejected: ${file}`);
    const localHash = sha256File(diskPath);
    if (!localHash) throw new Error(`File not found for ${decision}: ${file}`);
    localVersion.acceptedConflicts[file] = {
      decision,
      targetGenerator: remoteGen,
      localHash,
      remoteHash,
      templateHint: remotePath(file),
      updatedAt: appliedAt,
    };
  }

  function acceptedDecisionMatches(file, localHash, remoteHash) {
    const decision = localVersion.acceptedConflicts?.[file];
    return Boolean(
      decision
      && decision.localHash === localHash
      && decision.remoteHash === remoteHash
    );
  }

  function acceptedDecisionReason(file) {
    const decision = localVersion.acceptedConflicts?.[file];
    if (!decision) return 'accepted conflict decision';
    if (decision.targetGenerator === remoteGen) return `accepted conflict decision: ${decision.decision}`;
    return `accepted conflict decision carried forward from ${decision.targetGenerator}: ${decision.decision}`;
  }

  let decisionMetadataDirty = false;
  if (acceptLocal.length || acceptMerged.length || acceptTemplate.length) {
    const appliedAt = new Date().toISOString();
    try {
      for (const file of acceptLocal) recordLocalDecision(file, 'accept-local', appliedAt);
      for (const file of acceptMerged) recordLocalDecision(file, 'accept-merged', appliedAt);
      for (const file of acceptTemplate) await applyTemplateFile(file);
      decisionMetadataDirty = true;
    } catch (e) {
      if (jsonOut) {
        console.log(JSON.stringify({ status: 'error', message: e.message }, null, 2));
      } else {
        console.error(`ERROR: ${e.message}`);
      }
      process.exitCode = 1;
      return;
    }
  }

  const allFiles = new Set([...Object.keys(localChecksums), ...Object.keys(remoteChecksums)]);

  const plan = { updated: [], created: [], adopted: [], moved: [], conflict: [], skipped: [] };

  for (const file of [...allFiles].sort()) {
    const canonical = canonicalPath(file);
    if (movedToFiles.has(canonical)) continue;

    // Reject paths that escape ROOT before any file access
    const diskPath = safePath(file);
    if (!diskPath) {
      plan.skipped.push({ file, reason: 'path traversal rejected' });
      continue;
    }

    const localHash = sha256File(diskPath);
    const storedHash = localChecksums[file];
    const remoteHash = remoteChecksums[file];

    const move = moveByFrom.get(canonical);
    if (move && storedHash && !remoteHash) {
      const toDiskPath = safePath(move.to);
      if (!toDiskPath) {
        plan.skipped.push({ file, movedTo: move.to, reason: 'path move target traversal rejected' });
        continue;
      }
      const toLocalHash = sha256File(toDiskPath);
      const toRemoteHash = remoteChecksums[move.to];
      if (localHash && localHash !== storedHash) {
        plan.skipped.push({
          file,
          movedTo: move.to,
          reason: 'legacy moved file modified; preserved for manual review',
        });
        continue;
      }
      if (toLocalHash && toLocalHash !== toRemoteHash) {
        plan.skipped.push({
          file,
          movedTo: move.to,
          reason: 'legacy moved file preserved until canonical path conflict is resolved',
        });
        continue;
      }
      plan.moved.push({
        file: move.to,
        from: file,
        to: move.to,
        localHash,
        storedHash,
        remoteHash: toRemoteHash,
        write: toLocalHash !== toRemoteHash,
        reason: toLocalHash === toRemoteHash
          ? 'legacy framework path cleanup; canonical file already current'
          : 'safe framework path move',
      });
      movedToFiles.add(move.to);
      continue;
    }

    if (!remoteHash) {
      if (storedHash && isInstalledOptionalFile(file, localVersion)) {
        plan.skipped.push({ file, reason: 'installed optional workflow file' });
        continue;
      }
      plan.skipped.push({ file, reason: 'not in remote' });
      continue;
    }

    // Manifest-first: an optional-owned file whose option is NOT selected for
    // this install is not in this install's plan; skip it rather than
    // force-applying an optional workflow the user never opted into.
    if (isOptionalOwnedUnselected(canonical, manifestCtx, selectedOptions)) {
      plan.skipped.push({ file, reason: 'optional workflow not selected for this install' });
      continue;
    }

    if (!storedHash) {
      // New file from remote: if local file exists, it is a CONFLICT.
      if (localHash) {
        if (localHash === remoteHash) {
          plan.adopted.push({ file, localHash, remoteHash, reason: 'new remote file already matches local file' });
          continue;
        }
        if (acceptedDecisionMatches(file, localHash, remoteHash)) {
          plan.skipped.push({ file, reason: acceptedDecisionReason(file) });
          continue;
        }
        if (isHarnessOwnedExistingFileManifestFirst(canonical, diskPath, manifestCtx, selectedOptions)) {
          plan.updated.push({ file, localHash, remoteHash, reason: 'existing untracked Harness-owned file' });
          continue;
        }
        plan.conflict.push({ file, localHash, storedHash: 'none', remoteHash, reason: 'new remote file conflicts with existing local file' });
        continue;
      }
      // New file: still respect PRESERVE classification for existing user data,
      // but create missing scaffold starter files. PRESERVE means "do not
      // overwrite local user data", not "leave required new docs absent".
      const tier = classify(canonical, null, null, manifestCtx);
      if (tier === 'PRESERVE') {
        plan.created.push({ file, remoteHash, reason: 'PRESERVE: missing scaffold starter; no local user data to overwrite' });
      } else {
        plan.created.push({ file, remoteHash });
      }
      continue;
    }

    if (
      storedHash
      && hasInstalledOptions(localVersion)
      && OPTIONAL_REGISTRATION_FILES.has(canonical)
      && localHash === storedHash
      && localHash !== remoteHash
    ) {
      if (acceptedDecisionMatches(file, localHash, remoteHash)) {
        plan.skipped.push({ file, reason: acceptedDecisionReason(file) });
        continue;
      }
      plan.conflict.push({
        file,
        localHash,
        storedHash,
        remoteHash,
        reason: 'installed optional registration needs merge',
      });
      continue;
    }

    const tier = classify(canonical, localHash, storedHash, manifestCtx);

    if (tier === 'PRESERVE') {
      plan.skipped.push({ file, reason: 'PRESERVE: user data' });
    } else if (tier === 'SAFE') {
      if (localHash === remoteHash) {
        plan.skipped.push({ file, reason: 'already current' });
      } else {
        plan.updated.push({ file, remoteHash });
      }
    } else if (tier === 'CONFLICT') {
      if (acceptedDecisionMatches(file, localHash, remoteHash)) {
        plan.skipped.push({ file, reason: acceptedDecisionReason(file) });
        continue;
      }
      plan.conflict.push({
        file,
        localHash,
        storedHash,
        remoteHash,
        reason: isMergeFile(canonical, manifestCtx)
          ? 'user modified MERGE file'
          : 'user modified runtime file',
      });
    }
  }

  // 3. Output
  if (jsonOut) {
    const verbose = args.includes('--verbose') || args.includes('--full-plan');
    const jsonPlan = buildJsonPlan();
    console.log(JSON.stringify({
      status: localVersion.partialUpdate ? 'partial-update' : 'update-available',
      from: localGen,
      to: remoteGen,
      sourceBase,
      releaseNotes: remoteVersion.releaseNotes || null,
      partialUpdate: localVersion.partialUpdate || null,
      acceptedConflicts: localVersion.acceptedConflicts || {},
      updated: plan.updated.length,
      created: plan.created.length,
      adopted: plan.adopted.length,
      moved: plan.moved.length,
      conflict: plan.conflict.length,
      skipped: plan.skipped.length,
      // Token-safe by default: attach the full plan only when --verbose / --full-plan is passed.
      ...(verbose ? { plan: jsonPlan } : {}),
      agent: buildAgentHints(jsonPlan),
    }, null, 2));
    return;
  }

  console.log(`\nUpdate: v${localGen} -> v${remoteGen}`);
  console.log(`   ${plan.updated.length} safe update, ${plan.created.length} new, ${plan.moved.length} moved, ${plan.conflict.length} conflict, ${plan.skipped.length} skipped\n`);
  printReleaseHighlights(remoteVersion);

  // Show conflicts (these need AI/user decision)
  if (plan.conflict.length > 0) {
    console.log('CONFLICTS (need your decision):');
    for (const c of plan.conflict) {
      console.log(`   ! ${c.file}  [${c.reason}]`);
    }
    if (plan.updated.length + plan.created.length > 0) {
      console.log('   Tip: run --apply-safe to apply SAFE/NEW files first, then merge conflicts.');
    }
    console.log('');
  }

  // Show what will be auto-updated
  if (plan.updated.length + plan.created.length + plan.moved.length > 0) {
    console.log('AUTO (safe to apply):');
    for (const u of plan.updated) console.log(`   ^ ${u.file}`);
    for (const c of plan.created) console.log(`   + ${c.file}`);
    for (const m of plan.moved) console.log(`   > ${m.from} -> ${m.to}`);
    console.log('');
  }

  // 4. Apply if requested
  if (apply || applySafe) {
    // Refuse to apply when conflicts exist; must resolve first.
    if (apply && !applySafe && plan.conflict.length > 0) {
      console.log(`Cannot apply: ${plan.conflict.length} conflicts must be resolved first.`);
      console.log('   Run --apply-safe to apply SAFE/NEW files first, or resolve conflicts manually then re-run --apply.');
      process.exitCode = 1;
      return plan;
    }
    if (applySafe && plan.conflict.length > 0) {
      console.log(`Applying SAFE/NEW files only; ${plan.conflict.length} conflicts will remain for AI/user merge.`);
    }

    const preparedWrites = [];
    let failed = 0;

    async function prepareWrite(entry, { mustNotExist = false } = {}) {
      try {
        const dest = safePath(entry.file);
        if (!dest) return { ok: false, message: `   x Traversal rejected: ${entry.file}` };
        // Symlink rejection: do not follow symlinks.
        if (existsSync(dest)) {
          try { if (lstatSync(dest).isSymbolicLink()) return { ok: false, message: `   x Symlink rejected: ${entry.file}` }; } catch (_) {}
          if (mustNotExist) {
            return { ok: false, message: `   x File created since plan: ${entry.file} - treating as CONFLICT` };
          }
        }
        const content = await fetchSourceFile(remotePath(entry.file));
        const normalized = content.replace(/\r\n/g, '\n');
        const fetchedHash = sha256(normalized);
        if (fetchedHash !== entry.remoteHash) {
          return { ok: false, message: `   x Hash mismatch: ${entry.file}` };
        }
        return { ok: true, prepared: { file: entry.file, dest, content: normalized, mustNotExist } };
      } catch (e) {
        return { ok: false, message: `   x Failed: ${entry.file} - ${e.message}` };
      }
    }

    const prepareJobs = [
      ...plan.updated.map(entry => ({ entry, options: {} })),
      ...plan.created.map(entry => ({ entry, options: { mustNotExist: true } })),
      ...plan.moved
        .filter(entry => entry.write !== false)
        .map(entry => ({ entry, options: { mustNotExist: !existsSync(safePath(entry.file)) } })),
    ];
    const prepareResults = await Promise.all(
      prepareJobs.map(job => prepareWrite(job.entry, job.options)),
    );
    for (const result of prepareResults) {
      if (result.ok) {
        preparedWrites.push(result.prepared);
      } else {
        console.error(result.message);
        failed++;
      }
    }

    if (failed === 0) {
      for (const prepared of preparedWrites) {
        if (prepared.mustNotExist && existsSync(prepared.dest)) {
          console.error(`   x File created since plan: ${prepared.file} - treating as CONFLICT`);
          failed++;
        }
      }
    }

    // All-or-nothing apply invariant: every prepared file above was hash-validated
    // against its manifest checksum before ANY writeFileSync below. The version
    // file is advanced only when failed === 0, so a failed apply leaves version
    // tracking unchanged and is safe to re-run with --apply-safe. A mid-loop
    // writeFileSync throw (disk failure) is the only partial-disk edge case;
    // re-running --apply-safe reconciles it.
    let applied = 0;
    if (failed === 0) {
      try {
        for (const prepared of preparedWrites) {
          mkdirSync(dirname(prepared.dest), { recursive: true });
          writeFileSync(prepared.dest, prepared.content, 'utf-8');
          applied++;
        }
        for (const moved of plan.moved) {
          const from = safePath(moved.from);
          if (!from) throw new Error(`Traversal rejected: ${moved.from}`);
          if (!existsSync(from)) continue;
          if (lstatSync(from).isSymbolicLink()) throw new Error(`Symlink rejected: ${moved.from}`);
          const currentHash = sha256File(from);
          if (currentHash && currentHash !== moved.storedHash) {
            throw new Error(`Legacy moved file changed before cleanup: ${moved.from}`);
          }
          unlinkSync(from);
        }
      } catch (e) {
        console.error(`   x Failed while writing prepared files - ${e.message}`);
        failed++;
      }
    }

    // Only version-track applied files after complete script success.
    if (failed === 0) {
      const appliedAt = new Date().toISOString();
      localVersion.checksums = localVersion.checksums || {};
      for (const u of plan.updated) localVersion.checksums[u.file] = u.remoteHash;
      for (const c of plan.created) localVersion.checksums[c.file] = c.remoteHash;
      for (const a of plan.adopted) localVersion.checksums[a.file] = a.remoteHash;
      localVersion.sources = localVersion.sources || {};
      for (const u of plan.updated) localVersion.sources[u.file] = remoteSources[u.file] || u.file;
      for (const c of plan.created) localVersion.sources[c.file] = remoteSources[c.file] || c.file;
      for (const a of plan.adopted) localVersion.sources[a.file] = remoteSources[a.file] || a.file;
      for (const m of plan.moved) {
        localVersion.checksums[m.file] = m.remoteHash;
        localVersion.sources[m.file] = remoteSources[m.file] || m.file;
        delete localVersion.checksums[m.from];
        delete localVersion.sources[m.from];
        delete localVersion.acceptedConflicts[m.from];
      }
      if (Array.isArray(remoteVersion.moves)) localVersion.moves = remoteVersion.moves;
      else delete localVersion.moves;
      if (plan.conflict.length === 0) {
        localVersion.generator = remoteGen;
        localVersion.generated = appliedAt;
        if (remoteVersion.releaseNotes) localVersion.releaseNotes = remoteVersion.releaseNotes;
        else delete localVersion.releaseNotes;
        delete localVersion.partialUpdate;
      } else {
        localVersion.partialUpdate = {
          targetGenerator: remoteGen,
          updatedAt: appliedAt,
          appliedFiles: [...plan.updated, ...plan.created, ...plan.moved].map(x => x.file),
          adoptedFiles: plan.adopted.map(x => x.file),
          movedFiles: plan.moved.map(x => ({ from: x.from, to: x.to })),
          conflicts: plan.conflict.map(x => x.file),
          releaseNotes: remoteVersion.releaseNotes || null,
        };
      }
      writeFileSync(VERSION_FILE, JSON.stringify(localVersion, null, 2) + '\n', 'utf-8');
      if (plan.conflict.length === 0) {
        console.log(`Applied ${applied} files. Version updated to ${remoteVersion.generator}.`);
        printReleaseHighlights(remoteVersion);
      } else {
        console.log(`Applied ${applied} SAFE/NEW files. Version remains ${localGen}; ${plan.conflict.length} conflicts still need merge.`);
        printReleaseHighlights(remoteVersion);
      }
    } else {
      console.log(`${failed} failures. NO files were version-tracked. Fix and re-run.`);
      process.exitCode = 1;
    }
  }

  if (finalize) {
    if (plan.updated.length > 0 || plan.created.length > 0 || plan.adopted.length > 0 || plan.moved.length > 0) {
      console.log(`Cannot finalize: ${plan.updated.length} safe updates, ${plan.created.length} new files, ${plan.moved.length} path moves, and ${plan.adopted.length} adopted metadata entries still need --apply-safe.`);
      if (decisionMetadataDirty) {
        writeFileSync(VERSION_FILE, JSON.stringify(localVersion, null, 2) + '\n', 'utf-8');
      }
      process.exitCode = 1;
      return plan;
    }
    if (plan.conflict.length > 0) {
      console.log(`Cannot finalize: ${plan.conflict.length} conflicts still need a script-recorded decision.`);
      if (decisionMetadataDirty) {
        writeFileSync(VERSION_FILE, JSON.stringify(localVersion, null, 2) + '\n', 'utf-8');
      }
      process.exitCode = 1;
      return plan;
    }
    const finalizedAt = new Date().toISOString();
    localVersion.generator = remoteGen;
    localVersion.generated = finalizedAt;
    if (remoteVersion.releaseNotes) localVersion.releaseNotes = remoteVersion.releaseNotes;
    else delete localVersion.releaseNotes;
    delete localVersion.partialUpdate;
    writeFileSync(VERSION_FILE, JSON.stringify(localVersion, null, 2) + '\n', 'utf-8');
    console.log(`Finalized Harness update to ${remoteGen}.`);
    printReleaseHighlights(remoteVersion);
  } else if (decisionMetadataDirty) {
    writeFileSync(VERSION_FILE, JSON.stringify(localVersion, null, 2) + '\n', 'utf-8');
    console.log('Recorded conflict decision metadata.');
  }

  return plan;
}

main().catch(e => { console.error(e); process.exit(1); });
