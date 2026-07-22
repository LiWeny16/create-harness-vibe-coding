/**
 * ownership-manifest.mjs
 *
 * Pure helpers that derive the ownership manifest (the machine-readable source
 * of truth for install/update file classification) from a templates/common dest
 * list + optional-skill catalog data + fixed constants.
 *
 * No filesystem access lives here: the caller (scripts/build-version.mjs) walks
 * templates/common/ and templates/optional/, applies harnessDest, and hands the
 * resulting dest lists to buildOwnershipManifest(). This keeps the derivation
 * rule deterministic and unit-testable.
 */

export const SCHEMA_VERSION = 1;

/** Fixed preserve patterns (mirror updater PRESERVE_PATTERNS intent). */
export const PRESERVE_PATTERNS = [
  'Harness/PROGRESS.md',
  'Harness/tasks/**',
  'Harness/memory/**',
  'Harness/research/PRD.md',
  'Harness/research/research-results.md',
  'Harness/architecture.md',
  'README.md',
  'package.json',
  'package-lock.json',
  '.gitignore',
];

/** Fixed merge dest paths (mirror updater MERGE_PATTERNS). */
export const MERGE_PATHS = [
  'CLAUDE.md',
  'AGENTS.md',
  'MEMORY.md',
  'Harness/MEMORY.md',
  'Harness/README.md',
];

/** Fixed bootstrap-only dest paths. */
export const BOOTSTRAP_ONLY_PATHS = [
  'Harness/SETUP.md',
];

/** The manifest file's own dest (listed in frameworkOwned so the updater refreshes it). */
export const MANIFEST_DEST = 'Harness/ownership.manifest.json';

/** The manifest file's template-relative path (under templates/common/). */
export const MANIFEST_REL = 'Harness/ownership.manifest.json';

/** Excluded from frameworkOwned classification (tracked separately in .harness-version). */
export const HARNESS_VERSION_DEST = 'Harness/.harness-version';

/**
 * Convert a glob pattern (supports * and **) into a RegExp anchored full-match.
 * '*' matches a single path segment ([^/]*); '**' matches anything (.*).
 */
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

/** True if dest matches a glob (or exact-string) pattern. */
export function matchesGlob(dest, pattern) {
  if (!pattern.includes('*')) return dest === pattern;
  return globToRegex(pattern).test(dest);
}

/** True if dest matches any of the glob/exact patterns. */
export function matchesAnyGlob(dest, patterns) {
  return patterns.some(p => matchesGlob(dest, p));
}

/**
 * Derive a deterministic kind tag from a dest path. Mapping (per task spec):
 *   agents markdown under .claude or .opencode        -> agent
 *   commands markdown under .claude or .opencode      -> command
 *   SKILL.md under .claude/skills or .agents/skills   -> skill
 *   anything under .codex                              -> config
 *   anything under .opencode/plugins                   -> config
 *   anything under Harness/scripts                     -> script
 *   top-level Harness markdown (Harness/<name>.md)     -> doc
 *   anything else                                       -> config
 */
export function deriveKind(dest) {
  if (/^\.claude\/agents\/[^/]+\.md$/.test(dest)) return 'agent';
  if (/^\.opencode\/agents\/[^/]+\.md$/.test(dest)) return 'agent';
  if (/^\.claude\/commands\/[^/]+\.md$/.test(dest)) return 'command';
  if (/^\.opencode\/commands\/[^/]+\.md$/.test(dest)) return 'command';
  if (/^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(dest)) return 'skill';
  if (/^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(dest)) return 'skill';
  if (/^\.codex\//.test(dest)) return 'config';
  if (/^\.opencode\/plugins\//.test(dest)) return 'config';
  if (/^Harness\/scripts\//.test(dest)) return 'script';
  if (/^Harness\/[^/]+\.md$/.test(dest)) return 'doc';
  return 'config';
}

/**
 * Given a skill file's dest, return the dest plus any codex mirror dest.
 * Mirrors .claude/skills/ -> .agents/skills/ (matches generator
 * createCodexSkillMirrors + build-version's skill mirror branch).
 */
export function skillDestMirrors(dest) {
  const dests = [dest];
  if (dest.startsWith('.claude/skills/')) {
    dests.push(dest.replace(/^\.claude\/skills\//, '.agents/skills/'));
  }
  return dests;
}

/**
 * Build the manifest object. Pure.
 *
 * @param {object} opts
 * @param {string[]} opts.commonDests       - dests from templates/common/ walk (POSIX, via harnessDest), including codex mirrors
 * @param {Array<{id: string, paths: string[]}>} opts.optionalSkills - each skill's dest paths (mirrors already applied)
 * @param {string} opts.generator           - package.json version
 * @param {string} opts.source              - canonical source URL
 * @param {string} opts.generated           - ISO timestamp
 * @returns {object} manifest matching the ownership.manifest.json schema
 */
export function buildOwnershipManifest({ commonDests, optionalSkills, generator, source, generated }) {
  const optionalDestSet = new Set();
  for (const skill of optionalSkills) {
    for (const p of skill.paths || []) optionalDestSet.add(p);
  }

  const excluded = new Set([MANIFEST_DEST, HARNESS_VERSION_DEST]);

  const frameworkPaths = [];
  for (const dest of commonDests) {
    if (excluded.has(dest)) continue;
    if (matchesAnyGlob(dest, PRESERVE_PATTERNS)) continue;
    if (MERGE_PATHS.includes(dest)) continue;
    if (BOOTSTRAP_ONLY_PATHS.includes(dest)) continue;
    if (optionalDestSet.has(dest)) continue;
    frameworkPaths.push(dest);
  }
  // The manifest lists itself so the updater refreshes it on update.
  frameworkPaths.push(MANIFEST_DEST);
  frameworkPaths.sort();

  const frameworkOwned = frameworkPaths.map(dest => ({
    path: dest,
    kind: deriveKind(dest),
    overwrite: 'safe',
  }));

  const optionalOwned = optionalSkills
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(skill => ({
      option: skill.id,
      paths: [...(skill.paths || [])].sort(),
      overwrite: 'safe-if-installed',
    }));

  return {
    schemaVersion: SCHEMA_VERSION,
    generator,
    source,
    generated,
    preserve: [...PRESERVE_PATTERNS],
    merge: [...MERGE_PATHS],
    bootstrapOnly: [...BOOTSTRAP_ONLY_PATHS],
    frameworkOwned,
    optionalOwned,
  };
}

/**
 * Validate a manifest object. Returns an array of error strings (empty = valid).
 * Used as build-time self-validation; a non-empty list fails the build.
 *
 * @param {object} manifest
 * @param {object} opts
 * @param {string} opts.pkgVersion        - expected generator version
 * @param {string} opts.source            - expected canonical source URL
 * @param {string[]} opts.catalogSkillIds - known optional skill ids from catalog.json
 * @returns {string[]} error messages
 */
export function validateOwnershipManifest(manifest, { pkgVersion, source, catalogSkillIds }) {
  const errors = [];

  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}, got ${JSON.stringify(manifest.schemaVersion)}`);
  }
  if (manifest.generator !== pkgVersion) {
    errors.push(`generator must be ${pkgVersion}, got ${JSON.stringify(manifest.generator)}`);
  }
  if (manifest.source !== source) {
    errors.push(`source must be ${source}, got ${JSON.stringify(manifest.source)}`);
  }

  if (JSON.stringify(manifest.preserve) !== JSON.stringify(PRESERVE_PATTERNS)) {
    errors.push('preserve does not match the fixed constant');
  }
  if (JSON.stringify(manifest.merge) !== JSON.stringify(MERGE_PATHS)) {
    errors.push('merge does not match the fixed constant');
  }
  if (JSON.stringify(manifest.bootstrapOnly) !== JSON.stringify(BOOTSTRAP_ONLY_PATHS)) {
    errors.push('bootstrapOnly does not match the fixed constant');
  }

  for (const entry of manifest.frameworkOwned || []) {
    if (typeof entry.path !== 'string' || entry.path.length === 0) {
      errors.push(`frameworkOwned entry has empty/non-string path: ${JSON.stringify(entry)}`);
    }
  }

  const skillSet = new Set(catalogSkillIds);
  for (const entry of manifest.optionalOwned || []) {
    if (!skillSet.has(entry.option)) {
      errors.push(`optionalOwned option not in catalog: ${JSON.stringify(entry.option)}`);
    }
  }

  // No dest may appear in both frameworkOwned and optionalOwned.
  const frameworkSet = new Set((manifest.frameworkOwned || []).map(e => e.path));
  const optionalSet = new Set();
  for (const entry of manifest.optionalOwned || []) {
    for (const p of entry.paths || []) optionalSet.add(p);
  }
  for (const dest of frameworkSet) {
    if (optionalSet.has(dest)) {
      errors.push(`dest classified as both frameworkOwned and optionalOwned: ${dest}`);
    }
  }

  return errors;
}
