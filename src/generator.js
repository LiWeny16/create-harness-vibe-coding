import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

/** Files excluded from checksum tracking. Most are PRESERVE user data; starter
 * docs that need move/create upgrade tracking may remain PRESERVE while still
 * being checksummed. */
const CHECKSUM_EXCLUDE = [
  /^Harness\/PROGRESS\.md$/,
  /^Harness\/tasks\//,
  /^Harness\/memory\//,
  /^Harness\/research\/PRD\.md$/,
  /^Harness\/research\/research-results\.md$/,
  /^Harness\/architecture\.md$/,
  /^README\.md$/,
  /^\.gitignore$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^Harness\/\.harness-version$/,
];

export function isChecksumExcluded(dest) {
  return CHECKSUM_EXCLUDE.some(p => p.test(dest));
}

/**
 * Compute LF-normalized SHA-256 checksums for a list of generated files.
 * @param {Array<{dest: string, content: string}>} files - dest is POSIX harnessDest path
 * @returns {Object} sorted map of dest -> "sha256-<hex>"
 */
export function computeChecksums(files) {
  const checksums = {};
  for (const { dest, content } of files) {
    if (isChecksumExcluded(dest)) continue;
    const normalized = content.replace(/\r\n/g, '\n');
    checksums[dest] = 'sha256-' + createHash('sha256').update(normalized).digest('hex');
  }
  return Object.fromEntries(Object.keys(checksums).sort().map(k => [k, checksums[k]]));
}

/**
 * Build a sources map: dest → template-relative POSIX path.
 * Maps each generated file back to its source under templates/common/ or templates/optional/.
 * @param {Array<{dest: string, src: string, type: string}>} fileSpecs
 * @returns {Object} sorted map of dest → templateRelPath
 */
export function computeSources(fileSpecs) {
  const sources = {};
  for (const spec of fileSpecs) {
    if (spec.type === 'empty') continue;
    if (!spec.src) continue;
    let rel;
    if (spec.type === 'common') {
      rel = normalizePath(path.relative(TEMPLATES_DIR, spec.src));
    } else if (spec.type === 'optional') {
      rel = normalizePath(path.relative(OPTIONAL_DIR, spec.src));
    } else {
      continue;
    }
    sources[spec.dest] = rel;
  }
  return Object.fromEntries(Object.keys(sources).sort().map(k => [k, sources[k]]));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates', 'common');
const OPTIONAL_DIR = path.resolve(__dirname, '..', 'templates', 'optional');
const OPTIONAL_CATALOG = path.join(OPTIONAL_DIR, 'catalog.json');
const VALID_CONFLICT_POLICIES = new Set(['fail', 'skip', 'backup', 'overwrite']);
const VALID_INSTALL_SCOPES = new Set(['project', 'global']);
const RETIRED_OPTION_MESSAGES = new Map([
  ['browser-e2e', 'Optional workflow "browser-e2e" has been retired; wf-browser is built in by default. Use /wf-browser, $wf-browser, or /skills wf-browser instead.'],
]);
const EMPTY_DIRS = [
  'tests',
];
const GLOBAL_RUNTIME_EXCLUDE = [
  /^Harness\/PROGRESS\.md$/,
  /^Harness\/tasks\//,
  /^Harness\/research\//,
  /^Harness\/project\//,
];
const GLOBAL_PROJECT_STATE_INCLUDE = [
  /^Harness\/\.harness-version$/,
  /^Harness\/PROGRESS\.md$/,
  /^Harness\/settings\.json$/,
  /^Harness\/tasks\//,
  /^Harness\/memory\//,
  /^Harness\/research\//,
  /^Harness\/project\//,
];

const GLOBAL_PROJECT_TEMPLATE_DESTS = [
  'AGENTS.md',
  'CLAUDE.md',
  'Harness/README.md',
  'Harness/MEMORY.md',
  'Harness/settings.json',
  'Harness/specs/guides/SETUP.md',
];

const PROJECT_USER_STATE_PATTERNS = [
  'Harness/PROGRESS.md',
  'Harness/tasks/**',
  'Harness/memory/**',
  'Harness/research/**',
  'Harness/project/**',
];

export function harnessDest(file) {
  if (file === '.harness-version') return 'Harness/.harness-version';
  if (file === 'SETUP.md') return 'Harness/specs/guides/SETUP.md';
  if (file === 'MEMORY.md') return 'Harness/MEMORY.md';
  if (file.startsWith('scripts/')) return `Harness/${file}`;
  if (file.startsWith('memory/')) return `Harness/${file}`;
  if (file.startsWith('Harness/')) return file;
  return file;
}

/**
 * Replace {{vars}} in file contents.
 */
function renderTemplate(src, vars) {
  let content = fs.readFileSync(src, 'utf-8');

  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }

  return content;
}

/**
 * Walk a directory and return relative paths of all files.
 */
function walkFiles(dir, base = dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, base));
    } else {
      results.push(path.relative(base, full));
    }
  }

  return results;
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function containsPath(parent, child) {
  const rel = path.relative(comparablePath(parent), comparablePath(child));
  return rel === '' || (rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function pathsOverlap(a, b) {
  return containsPath(a, b) || containsPath(b, a);
}

function defaultGlobalDir() {
  return process.env.HARNESS_GLOBAL_HOME
    || path.join(os.homedir(), '.harness', 'create-harness-vibe-coding');
}

function defaultHostGlobalRoots(hostGlobalDir = undefined) {
  if (hostGlobalDir || process.env.HARNESS_HOST_GLOBAL_HOME) {
    const base = path.resolve(process.cwd(), hostGlobalDir || process.env.HARNESS_HOST_GLOBAL_HOME);
    return {
      claude: path.join(base, 'claude'),
      codex: path.join(base, 'codex'),
      opencode: path.join(base, 'opencode'),
    };
  }

  return {
    claude: process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude'),
    codex: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    opencode: process.env.OPENCODE_CONFIG_HOME || path.join(os.homedir(), '.config', 'opencode'),
  };
}

function isGlobalRuntimeDest(dest) {
  return !GLOBAL_RUNTIME_EXCLUDE.some(pattern => pattern.test(dest));
}

function isGlobalProjectStateDest(dest) {
  return GLOBAL_PROJECT_STATE_INCLUDE.some(pattern => pattern.test(dest));
}

function renderInlineTemplate(content, vars) {
  let rendered = content;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

function virtualSpec(dest, content) {
  return {
    dest,
    type: 'virtual',
    content,
  };
}

function mapHostSpec(spec, fromPrefix, toPrefix = '') {
  return {
    ...spec,
    dest: `${toPrefix}${spec.dest.slice(fromPrefix.length)}`,
    projectDest: spec.dest,
  };
}

function mapExactHostSpec(spec, dest) {
  return {
    ...spec,
    dest,
    projectDest: spec.dest,
  };
}

function createHostGlobalFileSpecs(allFileSpecs) {
  const byDest = new Map(allFileSpecs.map(spec => [spec.dest, spec]));
  const claude = [];
  const codex = [];
  const opencode = [];

  for (const spec of allFileSpecs) {
    if (spec.dest.startsWith('.claude/commands/')) claude.push(mapHostSpec(spec, '.claude/'));
    if (spec.dest.startsWith('.claude/skills/')) claude.push(mapHostSpec(spec, '.claude/'));
    if (spec.dest.startsWith('.claude/agents/')) claude.push(mapHostSpec(spec, '.claude/'));
    if (spec.dest.startsWith('.claude/rules/')) claude.push(mapHostSpec(spec, '.claude/'));
    if (spec.dest.startsWith('.agents/skills/')) codex.push(mapHostSpec(spec, '.agents/'));
    if (spec.dest.startsWith('.opencode/commands/')) opencode.push(mapHostSpec(spec, '.opencode/'));
    if (spec.dest.startsWith('.opencode/agents/')) opencode.push(mapHostSpec(spec, '.opencode/'));
    if (spec.dest.startsWith('.opencode/plugins/')) opencode.push(mapHostSpec(spec, '.opencode/'));
  }

  const claudeSettings = byDest.get('.claude/settings.json');
  if (claudeSettings) claude.push(mapExactHostSpec(claudeSettings, 'settings.json'));

  const codexConfig = byDest.get('.codex/config.toml');
  if (codexConfig) codex.push(mapExactHostSpec(codexConfig, 'config.toml'));
  const codexHooks = byDest.get('.codex/hooks.json');
  if (codexHooks) codex.push(mapExactHostSpec(codexHooks, 'hooks.json'));

  const opencodeConfig = byDest.get('opencode.json');
  if (opencodeConfig) opencode.push(mapExactHostSpec(opencodeConfig, 'opencode.json'));

  return { claude, codex, opencode };
}

function createHostGlobalPlans(allFileSpecs, hostGlobalDir = undefined) {
  const roots = defaultHostGlobalRoots(hostGlobalDir);
  const specs = createHostGlobalFileSpecs(allFileSpecs);
  return Object.entries(specs).map(([host, fileSpecs]) => ({
    host,
    root: roots[host],
    fileSpecs,
    specsByDest: new Map(fileSpecs.map(spec => [spec.dest, spec])),
    plan: createPlan(roots[host], fileSpecs),
    candidateSet: new Set(fileSpecs.map(spec => spec.dest)),
  }));
}

function createOwnershipClasses({ resolvedGlobalDir, hostPlans }) {
  const hostGlobalTemplates = {};
  for (const hostPlan of hostPlans || []) {
    hostGlobalTemplates[hostPlan.host] = {
      root: normalizePath(hostPlan.root),
      paths: hostPlan.fileSpecs.map(spec => spec.dest).sort(),
    };
  }

  return {
    projectUserState: [...PROJECT_USER_STATE_PATTERNS],
    projectTemplateBridge: [...GLOBAL_PROJECT_TEMPLATE_DESTS],
    globalRuntimeTemplate: resolvedGlobalDir ? normalizePath(resolvedGlobalDir) : null,
    hostGlobalTemplates,
    userOwnedProtection: 'Existing non-Harness files at Harness-interest paths are preserved or surfaced as conflicts; generated project template files follow the selected conflict policy.',
  };
}

function createGlobalProjectBridgeSpecs({ globalDir }) {
  const globalPath = normalizePath(globalDir);
  return [
    virtualSpec('CLAUDE.md', `# CLAUDE.md

This project uses a global Harness runtime at \`${globalPath}\`.

Project-local state is authoritative:

- Tasks: \`Harness/tasks/\`
- Active pointer: \`Harness/PROGRESS.md\`
- Project memory: \`Harness/MEMORY.md\` and \`Harness/memory/\`
- Project settings: \`Harness/settings.json\`

Load global workflow docs, command surfaces, agents, and scripts from \`${globalPath}\`.
Project settings override global settings. Do not store project task state in the global runtime. Do not store secrets or raw transcripts in project or global memory/settings.
`),
    virtualSpec('AGENTS.md', `# AGENTS.md

Read \`CLAUDE.md\` first. This project uses the global Harness runtime at \`${globalPath}\`.

Keep task capsules, project memory, and project settings under local \`Harness/\`; use the global runtime only for shared framework docs, commands, skills, agents, settings defaults, and scripts.
`),
    virtualSpec('Harness/README.md', `# {{projectName}} - Project Harness State

This project is bound to a global Harness runtime at \`${globalPath}\`.

Project-local files:

- \`Harness/PROGRESS.md\` - active task pointer and task index.
- \`Harness/tasks/\` - task capsules; always project-local.
- \`Harness/MEMORY.md\` and \`Harness/memory/\` - project memory.
- \`Harness/settings.json\` - project settings and overrides.
- \`Harness/research/\` and \`Harness/project/\` - project facts.

Global runtime files:

- \`${globalPath}/Harness/README.md\` - shared Harness router.
- \`${globalPath}/Harness/MEMORY.md\` and \`${globalPath}/Harness/memory/\` - global memory and resource index.
- \`${globalPath}/Harness/settings.json\` - global settings defaults.
- \`${globalPath}/.claude/\`, \`${globalPath}/.agents/\`, \`${globalPath}/.opencode/\` - shared runtime command, skill, and agent surfaces.

Never discover task context from the global runtime. Resume work from local \`Harness/PROGRESS.md\` and local task \`STATE.json\`.
Project settings override global settings. Existing user-authored files are preserved unless the user explicitly chooses an overwrite-capable conflict policy.
`),
    virtualSpec('Harness/MEMORY.md', `# MEMORY.md - {{projectName}} Project Memory

Project memory lives here and under \`Harness/memory/\`.

Global memory lives under \`${globalPath}/Harness/memory/\` and is only for cross-project lessons and preferences.

Project settings live in \`Harness/settings.json\`; global settings defaults live in \`${globalPath}/Harness/settings.json\`. Project settings win.

Rules:

- Keep project-specific decisions, task evidence, and repo facts in this project.
- Keep reusable cross-project lessons in global memory only when safe and non-secret.
- Never store project task state, secrets, raw transcripts, or private project facts in global memory/settings.
`),
    virtualSpec('Harness/specs/guides/SETUP.md', `# SETUP.md - {{projectName}} Global Harness Bridge

This project uses a global Harness runtime at \`${globalPath}\`.

Read the full setup guide from \`${globalPath}/Harness/specs/guides/SETUP.md\`.

Project-local state remains authoritative:

- \`Harness/PROGRESS.md\`
- \`Harness/tasks/\`
- \`Harness/memory/\`
- \`Harness/settings.json\`
- \`Harness/research/\`
- \`Harness/project/\`

Run validators and shared scripts from the global runtime unless this project later installs a full project-local Harness runtime.
Project settings override global settings. Existing user-authored files at Harness-interest paths are preserved or surfaced for review; generated project template files follow the selected conflict policy.
`),
  ];
}

function installMetadata({ installScope, resolvedGlobalDir, hostPlans = [] }) {
  if (installScope !== 'global') return { installScope: 'project' };
  return {
    installScope: 'global',
    globalDir: normalizePath(resolvedGlobalDir),
    copyMode: 'copy',
    projectState: {
      tasks: 'Harness/tasks/',
      progress: 'Harness/PROGRESS.md',
      memory: 'Harness/memory/',
      settings: 'Harness/settings.json',
      research: 'Harness/research/',
      project: 'Harness/project/',
    },
    memoryScopes: {
      project: 'Harness/memory/',
      global: `${normalizePath(resolvedGlobalDir)}/Harness/memory/`,
    },
    settingsScopes: {
      precedence: ['project', 'global'],
      project: 'Harness/settings.json',
      global: `${normalizePath(resolvedGlobalDir)}/Harness/settings.json`,
      secretsPolicy: 'never store secrets in project/global settings or memory',
    },
    hostGlobal: {
      copyMode: 'copy',
      targets: Object.fromEntries(hostPlans.map(hostPlan => [
        hostPlan.host,
        {
          root: normalizePath(hostPlan.root),
          files: hostPlan.fileSpecs.map(spec => spec.dest).sort(),
        },
      ])),
    },
    ownershipClasses: createOwnershipClasses({ resolvedGlobalDir, hostPlans }),
  };
}

export function getOptionalCatalog() {
  if (!fs.existsSync(OPTIONAL_CATALOG)) {
    return { skills: [], presets: {}, externalRecommendations: [] };
  }

  return JSON.parse(fs.readFileSync(OPTIONAL_CATALOG, 'utf-8'));
}

function normalizeOptionList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter(Boolean)
    .flatMap(item => String(item).split(','))
    .map(item => item.trim())
    .filter(Boolean);
}

function externalRecommendations(catalog) {
  return Array.isArray(catalog.externalRecommendations)
    ? catalog.externalRecommendations
    : [];
}

function resolveOptionalSelection({
  withOptions = [],
  withoutOptions = [],
  preset = undefined,
  externalOptions = [],
}) {
  const catalog = getOptionalCatalog();
  const skillsById = new Map(catalog.skills.map(skill => [skill.id, skill]));
  const recommendationsById = new Map(externalRecommendations(catalog).map(item => [item.id, item]));
  const selected = [];
  const errors = [];
  const warnings = [];

  if (preset) {
    if (!catalog.presets[preset]) {
      errors.push(`Unknown preset "${preset}". Run --list-options to see available presets.`);
    } else {
      selected.push(...catalog.presets[preset]);
    }
  }

  selected.push(...normalizeOptionList(withOptions));

  const ids = [...new Set(selected)];
  const withoutIds = [...new Set(normalizeOptionList(withoutOptions))];
  for (const id of ids) {
    if (RETIRED_OPTION_MESSAGES.has(id)) {
      warnings.push(RETIRED_OPTION_MESSAGES.get(id));
    } else if (!skillsById.has(id)) {
      errors.push(`Unknown optional skill "${id}". Run --list-options to see available options.`);
    }
  }
  for (const id of withoutIds) {
    if (RETIRED_OPTION_MESSAGES.has(id)) {
      warnings.push(`Optional workflow "${id}" is retired and built in/no-op for --without.`);
    } else if (!skillsById.has(id)) {
      errors.push(`Unknown optional skill in --without "${id}". Run --list-options to see available options.`);
    }
  }

  const recommendationIds = [...new Set(normalizeOptionList(externalOptions))];
  for (const id of recommendationIds) {
    if (!recommendationsById.has(id)) {
      errors.push(`Unknown external recommendation "${id}". Run --list-options to see available options.`);
    }
  }

  const withoutSet = new Set(withoutIds);
  const selectedIds = ids.filter(id => !withoutSet.has(id) && !RETIRED_OPTION_MESSAGES.has(id));

  return {
    catalog,
    selectedSkills: errors.length ? [] : selectedIds.map(id => skillsById.get(id)),
    selectedRecommendations: errors.length ? [] : recommendationIds.map(id => recommendationsById.get(id)),
    errors,
    warnings,
  };
}

function createCoreFileSpecs() {
  const specs = walkFiles(TEMPLATES_DIR)
    .map(file => normalizePath(file))
    .sort()
    .map(file => ({
      dest: harnessDest(file),
      src: path.join(TEMPLATES_DIR, ...file.split('/')),
      type: 'common',
    }));

  specs.push(...createCodexSkillMirrors(specs));
  specs.push({ dest: 'tests/.gitkeep', src: undefined, type: 'empty' });
  return specs;
}

function createOptionalFileSpecs(selectedSkills) {
  const specs = [];

  for (const skill of selectedSkills) {
    for (const fileRoot of skill.files) {
      const absRoot = path.join(OPTIONAL_DIR, ...fileRoot.split('/'));
      for (const file of walkFiles(absRoot).map(normalizePath).sort()) {
        specs.push({
          dest: harnessDest(file),
          src: path.join(absRoot, ...file.split('/')),
          type: 'optional',
          skillId: skill.id,
        });
      }
    }
  }

  specs.push(...createCodexSkillMirrors(specs));
  return specs;
}

function createCodexSkillMirrors(fileSpecs) {
  return fileSpecs
    .filter(spec => spec.dest.startsWith('.claude/skills/'))
    .map(spec => ({
      ...spec,
      dest: spec.dest.replace(/^\.claude\/skills\//, '.agents/skills/'),
    }));
}

function duplicateDests(fileSpecs) {
  const seen = new Set();
  const duplicates = new Set();

  for (const spec of fileSpecs) {
    if (seen.has(spec.dest)) {
      duplicates.add(spec.dest);
    } else {
      seen.add(spec.dest);
    }
  }

  return [...duplicates].sort();
}

/**
 * Walk the directory chain from rootDir down to the parent of absPath.
 * Returns the first ancestor that is a symbolic link, or null if none.
 * Prevents writes from escaping the workspace via symlinked parent dirs
 * (e.g. .claude/, Harness/, .opencode/ pointing outside the project).
 */
function symlinkInChain(rootDir, absPath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(absPath);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep).filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur = path.join(cur, parts[i]);
    try {
      if (fs.lstatSync(cur).isSymbolicLink()) return cur;
    } catch (_) { /* directory not created yet */ }
  }
  return null;
}

function createPlan(resolvedDir, fileSpecs, { includeEmptyDirs = true } = {}) {
  const plan = {
    create: [],
    skip: [],
    overwrite: [],
    backup: [],
    conflict: [],
    mkdir: [],
    userOwnedSkip: [],
  };

  const fileSet = new Set(fileSpecs.map(spec => spec.dest));

  const dirSet = new Set(['.']);
  for (const file of fileSet) {
    let dir = path.posix.dirname(file);
    while (dir && dir !== '.') {
      dirSet.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  if (includeEmptyDirs) {
    for (const dir of EMPTY_DIRS) {
      dirSet.add(dir);
    }
  }

  for (const dir of [...dirSet].sort()) {
    const absDir = dir === '.'
      ? resolvedDir
      : path.join(resolvedDir, ...dir.split('/'));
    if (fs.existsSync(absDir)) {
      if (!fs.statSync(absDir).isDirectory()) {
        plan.conflict.push(dir === '.' ? './' : `${dir}/`);
      }
    } else {
      plan.mkdir.push(dir === '.' ? './' : `${dir}/`);
    }
  }

  return plan;
}

/**
 * The package-side ownership manifest (the machine-readable source of truth for
 * which dest paths are Harness-interest). The generator runs from src/, so this
 * resolves to templates/common/Harness/ownership.manifest.json. Read defensively;
 * if missing/unparseable the candidate set falls back to fileSpec dests.
 */
const MANIFEST_PATH = path.resolve(__dirname, '..', 'templates', 'common', 'Harness', 'ownership.manifest.json');

/**
 * Read and parse the ownership manifest defensively. Returns null when the file
 * is missing, unreadable, unparseable, or lacks a frameworkOwned array so the
 * caller falls back to the fileSpecs-derived candidate set.
 */
function readOwnershipManifest() {
  try {
    if (!fs.existsSync(MANIFEST_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    if (!parsed || !Array.isArray(parsed.frameworkOwned)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build the Harness-interest candidate dest set (manifest-first, fileSpecs
 * fallback). Pure (no filesystem) so the manifest/fallback branches are unit
 * testable directly.
 *
 * Manifest-present: candidate set = manifest.frameworkOwned paths UNION the
 * selected optional skills' manifest.optionalOwned paths. This includes optional
 * skill paths like ui-ux-review (fixing the bug where same-name user files at
 * optional-skill paths were clobbered).
 *
 * Manifest-absent (null): candidate set = all fileSpec dests (the exact set of
 * paths being written), so optional skill paths remain protected.
 *
 * Instance ownership is still decided by MARKER in existingCandidateIsUserOwned:
 * a candidate path with no Harness marker is user-owned and protected.
 *
 * @param {object|null} manifest - parsed ownership manifest, or null for fallback
 * @param {Array<{dest: string}>} fileSpecs - installer write specs
 * @param {Array<{id: string}>} selectedSkills - selected optional skills
 * @returns {Set<string>} candidate dest paths
 */
export function buildHarnessInterestCandidateSet(manifest, fileSpecs, selectedSkills) {
  if (!manifest || !Array.isArray(manifest.frameworkOwned)) {
    return new Set(fileSpecs.map(spec => spec.dest));
  }
  const selectedIds = new Set((selectedSkills || []).map(skill => skill && skill.id));
  const candidates = new Set();
  for (const entry of manifest.frameworkOwned) {
    if (entry && typeof entry.path === 'string') candidates.add(entry.path);
  }
  for (const entry of manifest.optionalOwned || []) {
    if (!entry || !selectedIds.has(entry.option)) continue;
    for (const p of entry.paths || []) {
      if (typeof p === 'string') candidates.add(p);
    }
  }
  return candidates;
}

/**
 * Content markers proving a file was authored by this scaffold. Mirror of
 * wf-update-check.mjs HARNESS_OWNED_CONTENT_MARKERS.
 */
const HARNESS_OWNED_CONTENT_MARKERS = [
  /^harness:\s*(?:wf-agent|wf-framework|create-harness-vibe-coding)\b/im,
  /\bcreate-harness-vibe-coding\b/i,
  /\bproject harness\b/i,
  /\bHarness\/(?:specs|WF|MEMORY|tasks|scripts|subagents|dispatch|context-loading|lifecycle|SETUP)\b/,
  /\bWF-(?:MAX|AUTO|KERNEL|STATE)\b/,
];

/**
 * Returns true if the given file content carries a Harness ownership marker.
 * Pure (no filesystem access) so it can be unit-tested directly.
 */
export function isHarnessOwnedContent(content) {
  return HARNESS_OWNED_CONTENT_MARKERS.some(pattern => pattern.test(content));
}

/**
 * Returns true if an existing on-disk file is a Harness-interest candidate path
 * (per the manifest-first candidate set) that was NOT authored by this scaffold
 * (candidate path + no ownership marker + no matching template content).
 * Such user-authored files are preserved (skip) regardless of the conflict policy,
 * mirroring the updater safety rule.
 *
 * Ownership is determined by content marker first, then by exact template content
 * match (for JSON/TOML configs without markers). Manifest declaration alone does
 * NOT grant ownership — a user file at a manifest path without marker is still
 * user-owned.
 */
function existingCandidateIsUserOwned(dest, destPath, candidateSet, srcPath = null) {
  if (!candidateSet.has(dest)) return false;
  try {
    const content = fs.readFileSync(destPath, 'utf-8');
    // Harness content marker present → Harness-owned
    if (isHarnessOwnedContent(content)) return false;
    // Same content as template source → Harness-generated → Harness-owned
    if (srcPath && fs.existsSync(srcPath)) {
      const templateContent = fs.readFileSync(srcPath, 'utf-8');
      if (content === templateContent) return false;
    }
    return true; // user-owned: no marker, not template content
  } catch {
    return false;
  }
}

function addFileActions(plan, fileSpecs, resolvedDir, onConflict, candidateSet, specsByDest = null) {
  for (const { dest: file } of fileSpecs) {
    const destPath = path.join(resolvedDir, ...file.split('/'));

    if (!fs.existsSync(destPath)) {
      plan.create.push(file);
      continue;
    }

    if (fs.statSync(destPath).isDirectory()) {
      if (onConflict === 'skip') {
        plan.skip.push(file);
      } else {
        plan.conflict.push(file);
      }
      continue;
    }

    // Look up the template source path for content comparison
    const spec = specsByDest ? specsByDest.get(file) : null;
    const srcPath = spec && spec.type !== 'empty' && spec.type !== 'virtual' ? spec.src : null;

    // G4 guard: a non-Harness same-name candidate (any Harness-interest path
    // — agent/command/skill/optional-skill/script per the manifest-first
    // candidate set — without an ownership marker) must NEVER be overwritten.
    // Under overwrite/backup/skip it is preserved via plan.skip; under fail it
    // is blocked via plan.conflict so the collision surfaces (matching the fail
    // branch below). Only Harness-owned files (marker present or template
    // content match) reach the normal policy switch. Mirrors the
    // wf-update-check.mjs safety rule; see existingCandidateIsUserOwned /
    // isHarnessOwnedContent above.
    if (existingCandidateIsUserOwned(file, destPath, candidateSet, srcPath)) {
      if (onConflict === 'fail') {
        plan.conflict.push(file);
      } else {
        plan.skip.push(file);
        plan.userOwnedSkip.push(file);
      }
      continue;
    }

    if (onConflict === 'skip') {
      plan.skip.push(file);
    } else if (onConflict === 'backup') {
      plan.backup.push(file);
    } else if (onConflict === 'overwrite') {
      plan.overwrite.push(file);
    } else {
      plan.conflict.push(file);
    }
  }
}

function createSummary(plan, { noWrites = false } = {}) {
  return {
    created: noWrites ? 0 : plan.create.length,
    skipped: noWrites ? 0 : plan.skip.length,
    overwritten: noWrites ? 0 : plan.overwrite.length,
    backedUp: noWrites ? 0 : plan.backup.length,
    conflicts: plan.conflict.length,
    mkdir: noWrites ? 0 : plan.mkdir.length,
  };
}

function createHostSummary(hostPlans, options = {}) {
  return hostPlans.map(hostPlan => ({
    host: hostPlan.host,
    root: normalizePath(hostPlan.root),
    summary: createSummary(hostPlan.plan, options),
  }));
}

function nextBackupPath(destPath) {
  const first = `${destPath}.harness-backup`;
  if (!fs.existsSync(first)) {
    return first;
  }

  for (let index = 1; ; index += 1) {
    const candidate = `${first}.${index}`;
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }
}

function registerOptionalContent(file, content, selectedSkills) {
  if (!selectedSkills.length) return content;

  if (file === 'Harness/MEMORY.md') {
    const lines = selectedSkills.map(skill => (
      `- [${skill.id}](../.claude/skills/${skill.id}/SKILL.md) - ${skill.description} Codex mirror: [${skill.id}](../.agents/skills/${skill.id}/SKILL.md). Workflow: [workflows/${skill.id}.md](workflows/${skill.id}.md)`
    ));
    return content.replace(
      'Stack-specific skills can be added after the product shape is known.',
      `Installed optional skills:\n\n${lines.join('\n')}\n\nStack-specific skills can be added after the product shape is known.`,
    );
  }

  if (file === 'Harness/README.md') {
    const lines = selectedSkills.map(skill => (
      `- [${skill.title}](workflows/${skill.id}.md) - ${skill.description}`
    ));
    return `${content.trimEnd()}\n\n## Installed Optional Workflows\n\n${lines.join('\n')}\n`;
  }

  return content;
}

function registerExternalRecommendations(file, content, selectedRecommendations) {
  if (!selectedRecommendations.length || file !== 'Harness/specs/guides/SETUP.md') return content;

  const lines = selectedRecommendations.map(item => (
    `- \`${item.id}\` - ${item.description} Recommendation only; not installed by this scaffold. Source: ${item.url}`
  ));

  return `${content.trimEnd()}\n\n## Selected External Recommendations\n\n${lines.join('\n')}\n`;
}

function registrationWarnings(plan, selectedSkills) {
  const warnings = [];

  if (selectedSkills.length) {
    if (plan.skip.includes('Harness/MEMORY.md')) {
      warnings.push('Harness/MEMORY.md was skipped; manually register selected optional skills under #Skills.');
    }
    if (plan.skip.includes('Harness/README.md')) {
      warnings.push('Harness/README.md was skipped; manually register selected optional workflow paths.');
    }
  }

  if (plan.skip.includes('README.md')) {
    warnings.push('README.md was skipped; keep project run, build, test, and git conventions there, not in CLAUDE.md.');
  }
  if (plan.skip.includes('CLAUDE.md') || plan.conflict.includes('CLAUDE.md')) {
    warnings.push('CLAUDE.md already exists; ask the user to confirm refactoring or merging it with the Harness root-entry contract before editing.');
  }
  if (plan.skip.includes('AGENTS.md')) {
    warnings.push('AGENTS.md was skipped; ask for user consent before merging or replacing the project agent entry contract.');
  }

  for (const file of plan.userOwnedSkip) {
    warnings.push(`Skipped user-authored Harness-candidate '${file}' (no Harness marker); not overwritten. Remove the file or add a harness: wf-agent marker to upgrade.`);
  }

  return warnings;
}

function writeGeneratedPlan({
  plan,
  fileSpecs,
  specsByDest,
  resolvedDir,
  vars,
  optional,
  metadata,
  createdPrefix = '',
}) {
  const created = [];
  const generatedFiles = [];

  for (const dir of plan.mkdir) {
    const dirPath = dir === './'
      ? resolvedDir
      : path.join(resolvedDir, ...dir.slice(0, -1).split('/'));
    const __slMkdir = symlinkInChain(resolvedDir, dirPath);
    if (__slMkdir) throw new Error(`Cannot create directory ${createdPrefix}${dir}: symlinked directory in path (${__slMkdir})`);
    fs.mkdirSync(dirPath, { recursive: true });
    created.push(`${createdPrefix}${dir === './' ? './ (directory)' : `${dir} (directory)`}`);
  }

  for (const file of plan.backup) {
    const destPath = path.join(resolvedDir, ...file.split('/'));
    const __slBackup = symlinkInChain(resolvedDir, destPath);
    if (__slBackup) throw new Error(`Cannot backup ${createdPrefix}${file}: symlinked directory in path (${__slBackup})`);
    if (fs.existsSync(destPath)) {
      try { if (fs.lstatSync(destPath).isSymbolicLink()) throw new Error('Symlink rejected'); } catch (e) { throw new Error(`Cannot backup ${createdPrefix}${file}: ${e.message}`); }
    }
    fs.renameSync(destPath, nextBackupPath(destPath));
  }

  const writableFiles = [
    ...plan.create,
    ...plan.overwrite,
    ...plan.backup,
  ];

  const HARNESS_VERSION_DEST = 'Harness/.harness-version';
  let harnessVersionSpec = null;

  for (const file of writableFiles) {
    if (file === HARNESS_VERSION_DEST) {
      harnessVersionSpec = specsByDest.get(file);
      continue;
    }
    const spec = specsByDest.get(file);
    const destPath = path.join(resolvedDir, ...file.split('/'));
    const __slWrite = symlinkInChain(resolvedDir, destPath);
    if (__slWrite) throw new Error(`Cannot create/overwrite ${createdPrefix}${file}: symlinked directory in path (${__slWrite})`);
    if (fs.existsSync(destPath)) {
      try { if (fs.lstatSync(destPath).isSymbolicLink()) throw new Error('Symlink rejected'); } catch (e) { throw new Error(`Cannot create/overwrite ${createdPrefix}${file}: ${e.message}`); }
    }
    let content = spec.type === 'empty'
      ? ''
      : spec.type === 'virtual'
        ? renderInlineTemplate(spec.content, vars)
        : renderTemplate(spec.src, vars);
    content = registerOptionalContent(file, content, optional.selectedSkills);
    content = registerExternalRecommendations(file, content, optional.selectedRecommendations);

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content, 'utf-8');
    created.push(`${createdPrefix}${file}`);
    generatedFiles.push({ dest: file, content });
  }

  if (harnessVersionSpec) {
    const rendered = renderTemplate(harnessVersionSpec.src, vars);
    let parsed;
    try {
      parsed = JSON.parse(rendered);
    } catch {
      parsed = {};
    }
    parsed.generator = vars.generatorVersion;
    parsed.generated = vars.generatedTimestamp;
    parsed.options = optional.selectedSkills.map(s => s.id);
    parsed.externalRecommendations = optional.selectedRecommendations.map(item => item.id);
    parsed.autoCheck = true;
    Object.assign(parsed, metadata);
    parsed.checksums = computeChecksums(generatedFiles);
    const allWritableSpecs = writableFiles
      .map(f => specsByDest.get(f))
      .filter(Boolean);
    parsed.sources = computeSources(allWritableSpecs);
    const hvContent = JSON.stringify(parsed, null, 2) + '\n';
    const hvDestPath = path.join(resolvedDir, ...HARNESS_VERSION_DEST.split('/'));
    fs.mkdirSync(path.dirname(hvDestPath), { recursive: true });
    fs.writeFileSync(hvDestPath, hvContent, 'utf-8');
    created.push(`${createdPrefix}${HARNESS_VERSION_DEST}`);
  }

  return { created, generatedFiles };
}

export function generate({
  projectName,
  targetDir,
  dryRun = false,
  onConflict = 'fail',
  withOptions = [],
  withoutOptions = [],
  preset = undefined,
  externalOptions = [],
  installScope = 'project',
  globalDir = undefined,
  hostGlobalDir = undefined,
}) {
  const created = [];
  const errors = [];
  const warnings = [];

  // Resolve targetDir relative to cwd
  const resolvedDir = path.resolve(process.cwd(), targetDir);
  const normalizedInstallScope = String(installScope || 'project').trim().toLowerCase();
  const resolvedGlobalDir = normalizedInstallScope === 'global'
    ? path.resolve(process.cwd(), globalDir || defaultGlobalDir())
    : undefined;
  const vars = {
    projectName,
    generatorVersion: pkg.version,
    generatedTimestamp: new Date().toISOString(),
  };

  const optional = resolveOptionalSelection({ withOptions, withoutOptions, preset, externalOptions });
  warnings.push(...optional.warnings);
  const allFileSpecs = [
    ...createCoreFileSpecs(),
    ...createOptionalFileSpecs(optional.selectedSkills),
  ];
  const fileSpecs = normalizedInstallScope === 'global'
    ? [
      ...createGlobalProjectBridgeSpecs({ globalDir: resolvedGlobalDir }),
      ...allFileSpecs.filter(spec => isGlobalProjectStateDest(spec.dest)),
    ]
    : allFileSpecs;
  const specsByDest = new Map(fileSpecs.map(spec => [spec.dest, spec]));
  const plan = createPlan(resolvedDir, fileSpecs, { includeEmptyDirs: normalizedInstallScope !== 'global' });
  const globalFileSpecs = normalizedInstallScope === 'global'
    ? allFileSpecs.filter(spec => isGlobalRuntimeDest(spec.dest))
    : [];
  const globalSpecsByDest = new Map(globalFileSpecs.map(spec => [spec.dest, spec]));
  const globalPlan = normalizedInstallScope === 'global'
    ? createPlan(resolvedGlobalDir, globalFileSpecs)
    : undefined;
  const hostPlans = normalizedInstallScope === 'global'
    ? createHostGlobalPlans(allFileSpecs, hostGlobalDir)
    : [];
  const duplicateDestinations = duplicateDests(fileSpecs);
  const duplicateHostDestinations = hostPlans
    .flatMap(hostPlan => duplicateDests(hostPlan.fileSpecs).map(dest => `${hostPlan.host}:${dest}`));
  const candidateSet = buildHarnessInterestCandidateSet(
    readOwnershipManifest(),
    allFileSpecs,
    optional.selectedSkills,
  );

  if (!VALID_INSTALL_SCOPES.has(normalizedInstallScope)) {
    errors.push(`Unknown install scope "${installScope}". Use project or global.`);
    return {
      success: false,
      created,
      errors,
      plan,
      ...(globalPlan ? { globalPlan } : {}),
      ...(hostPlans.length ? { hostPlans: hostPlans.map(hostPlan => ({ host: hostPlan.host, root: normalizePath(hostPlan.root), plan: hostPlan.plan })) } : {}),
      summary: createSummary(plan, { noWrites: true }),
      ...(globalPlan ? { globalSummary: createSummary(globalPlan, { noWrites: true }) } : {}),
      ...(hostPlans.length ? { hostSummary: createHostSummary(hostPlans, { noWrites: true }) } : {}),
      warnings,
      installScope: normalizedInstallScope,
      ...(resolvedGlobalDir ? { globalDir: normalizePath(resolvedGlobalDir) } : {}),
    };
  }

  if (resolvedGlobalDir && pathsOverlap(resolvedDir, resolvedGlobalDir)) {
    errors.push('Global install directory must be outside the target project and must not contain the target project.');
    return {
      success: false,
      created,
      errors,
      plan,
      ...(globalPlan ? { globalPlan } : {}),
      ...(hostPlans.length ? { hostPlans: hostPlans.map(hostPlan => ({ host: hostPlan.host, root: normalizePath(hostPlan.root), plan: hostPlan.plan })) } : {}),
      summary: createSummary(plan, { noWrites: true }),
      ...(globalPlan ? { globalSummary: createSummary(globalPlan, { noWrites: true }), globalDir: normalizePath(resolvedGlobalDir) } : {}),
      ...(hostPlans.length ? { hostSummary: createHostSummary(hostPlans, { noWrites: true }) } : {}),
      warnings,
      installScope: normalizedInstallScope,
    };
  }

  for (const hostPlan of hostPlans) {
    if (pathsOverlap(resolvedDir, hostPlan.root)) {
      errors.push(`Host-global ${hostPlan.host} directory must be outside the target project.`);
    }
    if (resolvedGlobalDir && pathsOverlap(resolvedGlobalDir, hostPlan.root)) {
      errors.push(`Host-global ${hostPlan.host} directory must be outside the global runtime directory.`);
    }
  }
  if (errors.length > 0) {
    return {
      success: false,
      created,
      errors,
      plan,
      ...(globalPlan ? { globalPlan } : {}),
      ...(hostPlans.length ? { hostPlans: hostPlans.map(hostPlan => ({ host: hostPlan.host, root: normalizePath(hostPlan.root), plan: hostPlan.plan })) } : {}),
      summary: createSummary(plan, { noWrites: true }),
      ...(globalPlan ? { globalSummary: createSummary(globalPlan, { noWrites: true }), globalDir: normalizePath(resolvedGlobalDir) } : {}),
      ...(hostPlans.length ? { hostSummary: createHostSummary(hostPlans, { noWrites: true }) } : {}),
      warnings,
      installScope: normalizedInstallScope,
    };
  }

  if (!VALID_CONFLICT_POLICIES.has(onConflict)) {
    errors.push(`Unknown conflict policy "${onConflict}". Use fail, skip, backup, or overwrite.`);
    return {
      success: false,
      created,
      errors,
      plan,
      summary: createSummary(plan, { noWrites: true }),
      warnings,
    };
  }

  if (optional.errors.length > 0) {
    errors.push(...optional.errors);
    return {
      success: false,
      created,
      errors,
      plan,
      summary: createSummary(plan, { noWrites: true }),
      warnings,
    };
  }

  if (duplicateDestinations.length > 0) {
    errors.push(`Generation stopped because duplicate template destination(s) were found: ${duplicateDestinations.join(', ')}`);
    return {
      success: false,
      created,
      errors,
      plan,
      summary: createSummary(plan, { noWrites: true }),
      warnings,
    };
  }
  if (duplicateHostDestinations.length > 0) {
    errors.push(`Generation stopped because duplicate host-global destination(s) were found: ${duplicateHostDestinations.join(', ')}`);
    return {
      success: false,
      created,
      errors,
      plan,
      ...(globalPlan ? { globalPlan } : {}),
      ...(hostPlans.length ? { hostPlans: hostPlans.map(hostPlan => ({ host: hostPlan.host, root: normalizePath(hostPlan.root), plan: hostPlan.plan })) } : {}),
      summary: createSummary(plan, { noWrites: true }),
      ...(globalPlan ? { globalSummary: createSummary(globalPlan, { noWrites: true }) } : {}),
      ...(hostPlans.length ? { hostSummary: createHostSummary(hostPlans, { noWrites: true }) } : {}),
      warnings,
      installScope: normalizedInstallScope,
    };
  }

  addFileActions(plan, fileSpecs, resolvedDir, onConflict, candidateSet, specsByDest);
  if (globalPlan) {
    addFileActions(globalPlan, globalFileSpecs, resolvedGlobalDir, onConflict, candidateSet, globalSpecsByDest);
  }
  for (const hostPlan of hostPlans) {
    addFileActions(hostPlan.plan, hostPlan.fileSpecs, hostPlan.root, onConflict, hostPlan.candidateSet, hostPlan.specsByDest);
  }
  warnings.push(...registrationWarnings(plan, optional.selectedSkills));
  if (globalPlan) {
    warnings.push('Global install scope selected: shared runtime assets are written to the global directory and copied into Claude Code, Codex, and OpenCode host-global surfaces; Harness/tasks and Harness/PROGRESS.md remain project-local.');
  }

  if (dryRun) {
    return {
      success: true,
      created,
      errors,
      plan,
      ...(globalPlan ? { globalPlan } : {}),
      ...(hostPlans.length ? { hostPlans: hostPlans.map(hostPlan => ({ host: hostPlan.host, root: normalizePath(hostPlan.root), plan: hostPlan.plan })) } : {}),
      summary: createSummary(plan),
      ...(globalPlan ? { globalSummary: createSummary(globalPlan), globalDir: normalizePath(resolvedGlobalDir) } : {}),
      ...(hostPlans.length ? { hostSummary: createHostSummary(hostPlans) } : {}),
      ...(globalPlan ? { ownershipClasses: createOwnershipClasses({ resolvedGlobalDir, hostPlans }) } : {}),
      warnings,
      dryRun: true,
      installScope: normalizedInstallScope,
    };
  }

  const globalConflictCount = globalPlan?.conflict.length || 0;
  const hostConflicts = hostPlans.flatMap(hostPlan => hostPlan.plan.conflict.map(file => `${hostPlan.host}:${file}`));
  if (plan.conflict.length > 0 || globalConflictCount > 0 || hostConflicts.length > 0) {
    if (plan.conflict.length > 0) {
      errors.push(`Generation stopped because ${plan.conflict.length} file conflict(s) were found: ${plan.conflict.join(', ')}`);
    }
    if (globalConflictCount > 0) {
      errors.push(`Generation stopped because ${globalConflictCount} global file conflict(s) were found: ${globalPlan.conflict.join(', ')}`);
    }
    if (hostConflicts.length > 0) {
      errors.push(`Generation stopped because ${hostConflicts.length} host-global file conflict(s) were found: ${hostConflicts.join(', ')}`);
    }
    if (plan.conflict.includes('CLAUDE.md')) {
      errors.push('CLAUDE.md already exists. It is the root agent entry contract; ask the user to confirm refactoring or merging it with the Harness entry contract before editing, backing up, or overwriting.');
    }
    return {
      success: false,
      created,
      errors,
      plan,
      ...(globalPlan ? { globalPlan } : {}),
      ...(hostPlans.length ? { hostPlans: hostPlans.map(hostPlan => ({ host: hostPlan.host, root: normalizePath(hostPlan.root), plan: hostPlan.plan })) } : {}),
      summary: createSummary(plan, { noWrites: true }),
      ...(globalPlan ? { globalSummary: createSummary(globalPlan, { noWrites: true }), globalDir: normalizePath(resolvedGlobalDir) } : {}),
      ...(hostPlans.length ? { hostSummary: createHostSummary(hostPlans, { noWrites: true }) } : {}),
      warnings,
      installScope: normalizedInstallScope,
    };
  }

  try {
    const metadata = installMetadata({ installScope: normalizedInstallScope, resolvedGlobalDir, hostPlans });
    const projectWrite = writeGeneratedPlan({
      plan,
      fileSpecs,
      specsByDest,
      resolvedDir,
      vars,
      optional,
      metadata,
    });
    created.push(...projectWrite.created);

    let globalCreated = [];
    let hostCreated = [];
    if (globalPlan) {
      const globalWrite = writeGeneratedPlan({
        plan: globalPlan,
        fileSpecs: globalFileSpecs,
        specsByDest: globalSpecsByDest,
        resolvedDir: resolvedGlobalDir,
        vars,
        optional,
        metadata,
        createdPrefix: 'global:',
      });
      created.push(...globalWrite.created);
      globalCreated = globalWrite.created;
    }
    for (const hostPlan of hostPlans) {
      const hostWrite = writeGeneratedPlan({
        plan: hostPlan.plan,
        fileSpecs: hostPlan.fileSpecs,
        specsByDest: hostPlan.specsByDest,
        resolvedDir: hostPlan.root,
        vars,
        optional,
        metadata,
        createdPrefix: `host:${hostPlan.host}:`,
      });
      created.push(...hostWrite.created);
      hostCreated.push(...hostWrite.created);
    }

    return {
      success: true,
      created,
      errors,
      plan,
      ...(globalPlan ? { globalPlan, globalCreated, globalDir: normalizePath(resolvedGlobalDir) } : {}),
      ...(hostPlans.length ? { hostPlans: hostPlans.map(hostPlan => ({ host: hostPlan.host, root: normalizePath(hostPlan.root), plan: hostPlan.plan })), hostCreated } : {}),
      summary: createSummary(plan),
      ...(globalPlan ? { globalSummary: createSummary(globalPlan) } : {}),
      ...(hostPlans.length ? { hostSummary: createHostSummary(hostPlans), ownershipClasses: createOwnershipClasses({ resolvedGlobalDir, hostPlans }) } : {}),
      warnings,
      installScope: normalizedInstallScope,
    };

  } catch (err) {
    errors.push(err.message);
    return {
      success: false,
      created,
      errors,
      plan,
      ...(globalPlan ? { globalPlan, globalDir: normalizePath(resolvedGlobalDir) } : {}),
      ...(hostPlans.length ? { hostPlans: hostPlans.map(hostPlan => ({ host: hostPlan.host, root: normalizePath(hostPlan.root), plan: hostPlan.plan })) } : {}),
      summary: createSummary(plan),
      ...(globalPlan ? { globalSummary: createSummary(globalPlan) } : {}),
      ...(hostPlans.length ? { hostSummary: createHostSummary(hostPlans) } : {}),
      warnings,
      installScope: normalizedInstallScope,
    };
  }
}
