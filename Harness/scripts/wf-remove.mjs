#!/usr/bin/env node
/**
 * wf-remove.mjs �?Safely remove Harness framework files.
 *
 * Classifies all Harness-owned files into:
 *   SAFE     �?framework files matching stored checksums �?auto-remove
 *   MODIFIED �?framework files edited by user �?MUST confirm
 *   USER     �?user data files �?NEVER remove
 *
 * Usage:
 *   node Harness/scripts/wf-remove.mjs                    # dry-run: show plan
 *   node Harness/scripts/wf-remove.mjs --apply            # apply SAFE, prompt for MODIFIED
 *   node Harness/scripts/wf-remove.mjs --yes              # auto-yes for SAFE only (non-interactive)
 *   node Harness/scripts/wf-remove.mjs --json             # JSON plan for AI consumption
 *   node Harness/scripts/wf-remove.mjs --apply --yes      # auto-apply SAFE, skip MODIFIED, report
 *   node Harness/scripts/wf-remove.mjs --apply --yes --purge-user-data --keep-tasks
 *                                                         # remove Harness project facts, keep task records
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, rmdirSync, readdirSync, lstatSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname, join, sep } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const __dirname = dirname(SCRIPT_FILE);
const SCRIPT_ROOT = resolve(__dirname, '..', '..');
const ROOT = process.env.WF_ROOT
  ? resolve(process.env.WF_ROOT)
  : SCRIPT_ROOT;
const VERSION_FILE = resolve(ROOT, 'Harness', '.harness-version');

// ── Classification ─────────────────────────────────────────────────

/** Path prefixes that Harness framework is allowed to own. ANY file outside these is NEVER removed. */
const HARNESS_PREFIXES = [
  '.claude/',
  '.agents/',
  '.codex/',
  'Harness/',
  'CLAUDE.md',
  'AGENTS.md',
  'MEMORY.md',
  'tests/.gitkeep',
];

/** Files the user owns �?NEVER remove. Consistent with wf-update-check PRESERVE_PATTERNS. */
const USER_DATA_PATTERNS = [
  /^Harness\/PROGRESS\.md$/,
  /^Harness\/tasks\//,
  /^Harness\/memory\//,
  /^Harness\/research\/PRD\.md$/,
  /^Harness\/research\/research-results\.md$/,
  /^Harness\/architecture\.md$/,
  /^Harness\/workflows\//,
  /^Harness\/features\//,
  /^Harness\/domain\//,
  /^README\.md$/,
  /^\.gitignore$/,
  /^package\.json$/,
  /^package-lock\.json$/,
];

/** Harness user-data paths that can be removed only with explicit purge flags. */
const PURGEABLE_HARNESS_DATA_PATTERNS = [
  /^Harness\/PROGRESS\.md$/,
  /^Harness\/tasks\//,
  /^Harness\/memory\//,
  /^Harness\/research\/PRD\.md$/,
  /^Harness\/research\/research-results\.md$/,
  /^Harness\/architecture\.md$/,
  /^Harness\/workflows\//,
  /^Harness\/features\//,
  /^Harness\/domain\//,
];

/** Framework task scaffolding is not a real task record. */
const FRAMEWORK_TASK_PATTERNS = [
  /^Harness\/tasks\/_template\//,
  /^Harness\/tasks\/auto\//,
];

function isUserData(file) {
  return USER_DATA_PATTERNS.some(p => p.test(file));
}

function isHarnessOwned(file) {
  return HARNESS_PREFIXES.some(p => file.startsWith(p));
}

function isFrameworkTaskFile(file) {
  return FRAMEWORK_TASK_PATTERNS.some(p => p.test(file));
}

function isPurgeableHarnessData(file, { keepTasks }) {
  if (keepTasks && /^Harness\/tasks\//.test(file) && !isFrameworkTaskFile(file)) return false;
  return PURGEABLE_HARNESS_DATA_PATTERNS.some(p => p.test(file));
}

/** Framework files that should always exist (not part of removal). */
const KEEP_FRAMEWORK = new Set([
  'Harness/.harness-version',
]);

const BUILT_IN_AGENT_NAMES = [
  'architect-manager',
  'architect',
  'context-master',
  'debugger',
  'docs-researcher',
  'explore-manager',
  'implement-manager',
  'implementer',
  'memory-master',
  'planner',
  'researcher',
  'review-manager',
  'reviewer',
  'tdd-guide',
  'test-writer',
  'verifier',
];

const BUILT_IN_SKILL_NAMES = [
  'browser-e2e',
  'github-pr-review',
  'python-backend',
  'subagent-orchestrator',
  'tdd',
  'ts-react-frontend',
  'ui-ux-review',
  'wf',
  'wf-auto',
  'wf-auto-spark',
  'wf-browser',
  'wf-learn',
  'wf-max',
  'wf-readme',
  'wf-remove',
  'wf-review',
  'wf-update',
];

const KNOWN_FRAMEWORK_FILES = new Set([
  ...BUILT_IN_AGENT_NAMES.map(name => `.claude/agents/${name}.md`),
  ...BUILT_IN_SKILL_NAMES.flatMap(name => [
    `.claude/skills/${name}/SKILL.md`,
    `.agents/skills/${name}/SKILL.md`,
  ]),
  '.claude/commands/wf-help.md',
  '.claude/rules/ecc/common.md',
]);

function isKnownFrameworkFile(file) {
  return KNOWN_FRAMEWORK_FILES.has(file);
}

/** Directories to clean up if empty after file removal. */
const CLEANUP_DIRS = [
  '.claude/agents',
  '.claude/skills/wf-auto',
  '.claude/skills/wf-browser',
  '.claude/skills/tdd',
  '.claude/skills/wf',
  '.claude/skills/wf-learn',
  '.claude/skills/wf-max',
  '.claude/skills/wf-readme',
  '.claude/skills/wf-review',
  '.claude/skills/wf-update',
  '.claude/skills/wf-remove',
  '.claude/skills/subagent-orchestrator',
  '.agents/skills/wf-auto',
  '.agents/skills/wf-browser',
  '.agents/skills/tdd',
  '.agents/skills/wf',
  '.agents/skills/wf-learn',
  '.agents/skills/wf-max',
  '.agents/skills/wf-readme',
  '.agents/skills/wf-review',
  '.agents/skills/wf-update',
  '.agents/skills/wf-remove',
  '.agents/skills/subagent-orchestrator',
  '.agents/skills',
  '.agents',
  '.codex',
  '.claude/rules/ecc',
  '.claude/rules',
  'Harness/scripts',
  'Harness/research',
  'Harness/workflows',
  'Harness/domain',
  'Harness/features',
  'Harness/memory',
  'Harness/tasks/_template',
  'Harness/tasks/auto',
  'Harness/tasks',
  'Harness',
];

// ── Helpers ────────────────────────────────────────────────────────

/** Reject paths that escape ROOT (traversal, absolute, .., etc.). Sync with wf-update-check. */
function safePath(file) {
  let normalized = file.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('//')) return null;  // double slash bypass
  if (normalized.split('/').some(p => p === '..')) return null;
  if (file.startsWith('/') || file.startsWith('\\')) return null;
  if (normalized === '.' || normalized === '') return null;
  const resolved = resolve(ROOT, normalized);
  if (!resolved.startsWith(ROOT + sep) && resolved !== ROOT) return null;
  return resolved;
}

function sha256File(path) {
  if (!existsSync(path)) return null;
  let content = readFileSync(path, 'utf-8');
  content = content.replace(/\r\n/g, '\n');
  return 'sha256-' + createHash('sha256').update(content).digest('hex');
}

function addExistingFile(allFiles, file, scanIssues = []) {
  const diskPath = safePath(file);
  if (!diskPath || !existsSync(diskPath)) return;
  try {
    if (!lstatSync(diskPath).isDirectory()) {
      allFiles.add(file);
    }
  } catch (e) {
    scanIssues.push({ file, reason: `scan failed: ${e.message}` });
  }
}

function addFilesUnder(allFiles, dir, scanIssues = []) {
  const diskPath = safePath(dir);
  if (!diskPath || !existsSync(diskPath)) return;

  let entries;
  try {
    if (!lstatSync(diskPath).isDirectory()) return;
    entries = readdirSync(diskPath);
  } catch (e) {
    scanIssues.push({ file: dir, reason: `scan failed: ${e.message}` });
    return;
  }

  for (const entry of entries) {
    const rel = `${dir}/${entry}`.replace(/\\/g, '/').replace(/\/+/g, '/');
    const full = safePath(rel);
    if (!full) continue;
    let stat;
    try {
      stat = lstatSync(full);
    } catch (e) {
      scanIssues.push({ file: rel, reason: `scan failed: ${e.message}` });
      continue;
    }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      addFilesUnder(allFiles, rel, scanIssues);
    } else if (!stat.isDirectory()) {
      allFiles.add(rel);
    }
  }
}

function parseRepeatedFlag(args, flagName) {
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
  return values.map(v => v.replace(/\\/g, '/').replace(/\/+/g, '/'));
}

function removePlannedFile(file) {
  const diskPath = safePath(file);
  if (!diskPath) return { ok: false, reason: 'path traversal rejected' };
  if (!existsSync(diskPath)) return { ok: false, reason: 'not on disk' };
  if (lstatSync(diskPath).isDirectory()) return { ok: false, reason: 'is directory' };
  unlinkSync(diskPath);
  return { ok: true };
}

function removeEmptyDirs(startDir) {
  if (!existsSync(startDir)) return;
  try {
    const entries = readdirSync(startDir);
    for (const e of entries) {
      const full = join(startDir, e);
      if (lstatSync(full).isDirectory() && !lstatSync(full).isSymbolicLink()) removeEmptyDirs(full);
    }
    // After recursing, check if dir is now empty
    const remaining = readdirSync(startDir);
    if (remaining.length === 0) {
      rmdirSync(startDir);
    }
  } catch (_) { /* permissions or already gone */ }
}

async function askUser(question) {
  if (!process.stdin.isTTY) {
    console.log('   (non-interactive �?defaulting to KEEP)');
    return 'k';
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const yes = args.includes('--yes');
  const jsonOut = args.includes('--json');
  const purgeUserData = args.includes('--purge-user-data') || args.includes('--purge');
  const keepTasks = args.includes('--keep-tasks');
  const deleteModified = new Set(parseRepeatedFlag(args, '--delete-modified'));

  // 1. Build file inventory
  const localVersion = existsSync(VERSION_FILE)
    ? JSON.parse(readFileSync(VERSION_FILE, 'utf-8'))
    : { checksums: {} };
  const storedChecksums = localVersion.checksums || {};

  // All files from checksums + known framework patterns
  const allFiles = new Set(Object.keys(storedChecksums));
  const scanIssues = [];

  // Preserve/purge candidates may be excluded from checksums, so discover them
  // from disk. This keeps JSON plans honest about what will remain.
  for (const file of [
    'Harness/PROGRESS.md',
    'Harness/architecture.md',
  ]) {
    addExistingFile(allFiles, file, scanIssues);
  }
  for (const dir of [
    'Harness/tasks',
    'Harness/memory',
    'Harness/research',
    'Harness/workflows',
    'Harness/features',
    'Harness/domain',
  ]) {
    addFilesUnder(allFiles, dir, scanIssues);
  }

  // Add framework files that might not be in checksums (newer additions)
  const extraPatterns = [
    ...KNOWN_FRAMEWORK_FILES,
    '.claude/skills/wf/SKILL.md',
    '.agents/skills/wf/SKILL.md',
    '.claude/skills/tdd/SKILL.md',
    '.agents/skills/tdd/SKILL.md',
    '.claude/skills/wf-auto/SKILL.md',
    '.agents/skills/wf-auto/SKILL.md',
    'Harness/WF-AUTO.md',
    'Harness/tasks/auto/PROGRESS.md',
    'Harness/tasks/auto/PLAN.md',
    'Harness/tasks/_template/ARTIFACTS.md',
    'Harness/tasks/_template/NOTES.md',
    'Harness/tasks/_template/PLAN.md',
    'Harness/tasks/_template/PROGRESS.md',
    'Harness/scripts/wf-update-check.mjs',
    'Harness/scripts/wf-remove.mjs',
  ];
  for (const f of extraPatterns) {
    if (existsSync(resolve(ROOT, f))) allFiles.add(f);
  }

  // 2. Classify every file
  const safe = [];     // SAFE �?matches checksum, auto-remove
  const modified = []; // MODIFIED �?user edited, must confirm
  const user = [];     // USER �?never remove
  const skipped = [];  // File not on disk, traversal rejected, or framework-keep
  const purge = [];    // Explicitly requested Harness user-data removal
  skipped.push(...scanIssues);

  for (const file of [...allFiles].sort()) {
    // Canonical normalization for classification
    const canonical = file.replace(/\\/g, '/').replace(/\/+/g, '/');

    if (KEEP_FRAMEWORK.has(canonical)) {
      skipped.push({ file, reason: 'framework keep' });
      continue;
    }

    if (isUserData(canonical)) {
      if (purgeUserData && isPurgeableHarnessData(canonical, { keepTasks })) {
        purge.push({
          file,
          reason: keepTasks && isFrameworkTaskFile(canonical) ? 'framework task scaffold' : 'purge requested',
        });
        continue;
      }
      user.push({ file, reason: 'user data �?NEVER removed' });
      continue;
    }

    // Only allow deletion of files under harness-owned prefixes
    if (!isHarnessOwned(canonical)) {
      user.push({ file, reason: 'outside harness prefix �?NEVER removed' });
      continue;
    }

    const diskPath = safePath(file);
    if (!diskPath) {
      skipped.push({ file, reason: 'path traversal rejected' });
      continue;
    }
    if (!existsSync(diskPath)) {
      skipped.push({ file, reason: 'not on disk' });
      continue;
    }

    const currentHash = sha256File(diskPath);
    const storedHash = storedChecksums[file];

    if (!storedHash) {
      if (isKnownFrameworkFile(canonical)) {
        safe.push({
          file,
          currentHash,
          storedHash: currentHash,
          reason: 'known framework file missing from legacy checksums',
        });
      } else {
        modified.push({ file, currentHash, storedHash: 'none', reason: 'not in checksums' });
      }
    } else if (currentHash === storedHash) {
      safe.push({ file, currentHash, storedHash });
    } else {
      modified.push({ file, currentHash, storedHash, reason: 'user modified' });
    }
  }

    // Also check for .claude/settings.json (might have user permissions)
  const settingsFile = resolve(ROOT, '.claude', 'settings.json');
  if (existsSync(settingsFile)) {
    const settingsHash = sha256File(settingsFile);
    const storedSettingsHash = storedChecksums['.claude/settings.json'];
    if (storedSettingsHash && settingsHash !== storedSettingsHash) {
      // User modified settings �?move to modified
      // Remove from safe if it was there
      const idx = safe.findIndex(s => s.file === '.claude/settings.json');
      if (idx >= 0) {
        safe.splice(idx, 1);
        modified.push({ file: '.claude/settings.json', currentHash: settingsHash, storedHash: storedSettingsHash, reason: 'user modified settings (may contain permissions)' });
      }
    }
  }

  // 3. Output plan
  if (jsonOut) {
    console.log(JSON.stringify({
      safe: safe.map(s => s.file),
      modified: modified.map(m => m.file),
      user: user.map(u => u.file),
      purge: purge.map(p => p.file),
      skipped: skipped.map(s => s.file),
      options: {
        purgeUserData,
        keepTasks,
        deleteModified: [...deleteModified],
      },
      agent: {
        sourceOfTruth: 'Use this JSON plan first. Script handles safe/purge lists; AI decides modified files and whether purge-user-data is intended.',
        safeRemoveCommand: 'node Harness/scripts/wf-remove.mjs --apply --yes',
        thoroughRemoveCommand: 'node Harness/scripts/wf-remove.mjs --apply --yes --purge-user-data --keep-tasks',
        deleteModifiedCommandExample: 'node Harness/scripts/wf-remove.mjs --apply --yes --delete-modified CLAUDE.md --delete-modified Harness/README.md',
        aiDecisionRequired: modified.map(m => ({
          file: m.file,
          reason: m.reason,
          defaultAction: 'keep',
        })),
        preservedByDefault: user.map(u => u.file),
      },
      totalRemove: safe.length + modified.length + purge.length,
      totalSafe: safe.length,
      totalModified: modified.length,
      totalPurge: purge.length,
      totalPreserved: user.length,
    }, null, 2));
    return;
  }

  console.log('\n🧹 WF-REMOVE �?Harness framework removal plan\n');

  if (safe.length > 0) {
    console.log(`�?SAFE (${safe.length} files �?auto-remove, unmodified framework):`);
    for (const s of safe) console.log(`   �?${s.file}`);
    console.log('');
  }

  if (modified.length > 0) {
    console.log(`�?MODIFIED (${modified.length} files �?REQUIRE CONFIRMATION):`);
    for (const m of modified) {
      console.log(`   ? ${m.file}  [${m.reason}]`);
    }
    console.log('');
  }

  if (user.length > 0) {
    console.log(`🔒 USER DATA (${user.length} files �?NEVER removed):`);
    for (const u of user) console.log(`   �?${u.file}  [${u.reason}]`);
    console.log('');
  }

  if (purge.length > 0) {
    console.log(`PURGE (${purge.length} files - explicit user-data cleanup):`);
    for (const p of purge) console.log(`   x ${p.file}  [${p.reason}]`);
    console.log('');
  }

  console.log(`Summary: ${safe.length} safe, ${modified.length} need confirm, ${purge.length} purge, ${user.length} preserved, ${skipped.length} skipped\n`);

  if (!apply) {
    console.log('DRY-RUN. Use --apply to execute the removal.\n');
    return;
  }

  // 4. Apply �?remove SAFE files automatically (rehash before unlink)
  let safeRemoved = 0;
  let safeFailed = 0;
  for (const s of safe) {
    const diskPath = safePath(s.file);
    if (!diskPath) { console.error(`   �?Traversal rejected: ${s.file}`); safeFailed++; continue; }
    if (!existsSync(diskPath)) continue;
    // Re-verify hash hasn't changed since classification
    const currentHash = sha256File(diskPath);
    if (currentHash !== s.storedHash) {
      console.log(`   �?Skipped (modified since classification): ${s.file}`);
      safeFailed++;
      continue;
    }
    try {
      unlinkSync(diskPath);
      safeRemoved++;
    } catch (e) {
      console.error(`   �?Failed to remove: ${s.file} �?${e.message}`);
      safeFailed++;
    }
  }
  console.log(`�?Removed ${safeRemoved} safe files.`);

  // 5. Handle MODIFIED files �?prompt user
  let modifiedRemoved = 0;
  let modifiedKept = 0;
  let modifiedFailed = 0;

  for (const m of modified) {
    const canonicalModified = m.file.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (deleteModified.has(canonicalModified)) {
      const result = removePlannedFile(m.file);
      if (result.ok) {
        console.log(`   Deleted modified by decision: ${m.file}`);
        modifiedRemoved++;
      } else {
        console.error(`   Failed modified decision: ${m.file} - ${result.reason}`);
        modifiedFailed++;
      }
      continue;
    }
    if (yes) {
      // Non-interactive mode: skip all modified
      console.log(`   �?Skipped (modified): ${m.file}`);
      modifiedKept++;
      continue;
    }

    console.log(`\n─── ${m.file} ───`);
    console.log(`   Reason: ${m.reason}`);
    console.log(`   [D]elete  [K]eep (default)`);

    const answer = await askUser('   Choose [d/k]: ');
    if (answer === 'd' || answer === 'delete') {
      const diskPath = safePath(m.file);
      if (!diskPath) { console.error(`   �?Traversal rejected: ${m.file}`); modifiedFailed++; continue; }
      try {
        unlinkSync(diskPath);
        console.log(`   �?Deleted: ${m.file}`);
        modifiedRemoved++;
      } catch (e) {
        console.error(`   �?Failed: ${m.file} �?${e.message}`);
        modifiedFailed++;
      }
    } else {
      console.log(`   �?Kept: ${m.file}`);
      modifiedKept++;
    }
  }

  // 5.5 Handle explicit purge files. These are Harness-scoped user-data files
  // only included when --purge-user-data was requested.
  let purgeRemoved = 0;
  let purgeKept = 0;
  let purgeFailed = 0;
  for (const p of purge) {
    if (!purgeUserData) {
      purgeKept++;
      continue;
    }
    if (!yes) {
      console.log(`\nPURGE ${p.file}`);
      console.log(`   Reason: ${p.reason}`);
      console.log(`   [D]elete  [K]eep (default)`);
      const answer = await askUser('   Choose [d/k]: ');
      if (!(answer === 'd' || answer === 'delete')) {
        console.log(`   Kept purge candidate: ${p.file}`);
        purgeKept++;
        continue;
      }
    }
    const result = removePlannedFile(p.file);
    if (result.ok) {
      purgeRemoved++;
    } else {
      console.error(`   Failed purge: ${p.file} - ${result.reason}`);
      purgeFailed++;
    }
  }

  // 6. Cleanup empty directories
  for (const dir of CLEANUP_DIRS) {
    removeEmptyDirs(resolve(ROOT, dir));
  }
  // Remove root Harness/ if empty
  removeEmptyDirs(resolve(ROOT, 'Harness'));
  // Remove root .claude/ if empty (but this is rare)
  removeEmptyDirs(resolve(ROOT, '.claude'));

  // 7. Remove version file if everything is gone
  if (existsSync(VERSION_FILE)) {
    const harPath = resolve(ROOT, 'Harness');
    const removalIncomplete = safeFailed > 0
      || modifiedFailed > 0
      || purgeFailed > 0
      || modifiedKept > 0
      || purgeKept > 0;
    if (purgeUserData) {
      if (removalIncomplete) {
        console.log('Kept .harness-version because some planned removals failed or were kept.');
      } else {
        unlinkSync(VERSION_FILE);
        console.log('Removed .harness-version (purge mode).');
      }
    } else if (!existsSync(harPath) || (existsSync(harPath) && readdirSync(harPath).filter(f => f !== '.harness-version').length === 0)) {
      unlinkSync(VERSION_FILE);
      console.log('�?Removed .harness-version (Harness directory empty).');
    }
  }

  // 7.5 Prune stale checksums for files that no longer exist on disk
  if (existsSync(VERSION_FILE)) {
    const versionData = JSON.parse(readFileSync(VERSION_FILE, 'utf-8'));
    const checksums = versionData.checksums || {};
    let pruned = 0;
    for (const file of Object.keys(checksums)) {
      const diskPath = safePath(file);
      if (!diskPath || !existsSync(diskPath)) {
        delete checksums[file];
        pruned++;
      }
    }
    if (pruned > 0) {
      versionData.checksums = checksums;
      writeFileSync(VERSION_FILE, JSON.stringify(versionData, null, 2) + '\n', 'utf-8');
      console.log(`�?Pruned ${pruned} stale checksum(s) from .harness-version.`);
    }
  }

  // 8. Remove CLAUDE.md harness section if it only has harness binding
  const claudePath = resolve(ROOT, 'CLAUDE.md');
  if (existsSync(claudePath)) {
    const content = readFileSync(claudePath, 'utf-8');
    if (content.includes('Harness contract') || content.includes('Harness Binding')) {
      const answer = yes ? 'k' : await askUser('\nCLAUDE.md contains Harness binding section. Remove it? [D]elete harness section / [K]eep as-is (default): ');
      if (answer === 'd' || answer === 'delete') {
        // Strip the harness section: everything from "## 1. Harness Binding" to the next "## "
        const cleaned = content.replace(/## 1\. Harness Binding[\s\S]*?(?=## 2\.)/, '');
        writeFileSync(claudePath, cleaned, 'utf-8');
        console.log('�?Stripped Harness binding section from CLAUDE.md.');
      }
    }
  }

  console.log(`\n🏁 Done. Safe: ${safeRemoved} removed. Modified: ${modifiedRemoved} removed, ${modifiedKept} kept.`);
  console.log('   Run `git status` to review changes.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
