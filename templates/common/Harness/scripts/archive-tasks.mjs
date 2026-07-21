#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tasksDir = path.join(root, 'Harness', 'tasks');
const archiveDir = path.join(tasksDir, '_archive');

const args = process.argv.slice(2);
const flags = {
  dryRun: !args.includes('--apply'),
  apply: args.includes('--apply'),
  json: args.includes('--json'),
  keep: parseInt(args.includes('--keep') ? args[args.indexOf('--keep') + 1] : '5', 10),
  task: args.includes('--task') ? args[args.indexOf('--task') + 1] : null,
};

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node Harness/scripts/archive-tasks.mjs [options]

Options:
  --dry-run        Show what would be archived without moving files (default)
  --apply          Execute the archive moves
  --keep <n>       Keep at most <n> non-archived tasks (default: 5)
  --task <id>      Archive only the specified task
  --json           Output results as JSON
  --help, -h       Show this help`);
  process.exit(0);
}

const RESERVED = new Set(['_template', '_archive', 'auto']);
const NEVER_ARCHIVE_STATUSES = new Set([
  'active', 'blocked', 'in_progress', 'running', 'pending', 'needs-user-decision',
]);
const SAFE_ARCHIVE_STATUSES = new Set([
  'complete', 'verified', 'archived', 'abandoned', 'obsolete', 'done', 'closed', 'closeout',
]);

function readStateJson(taskDir) {
  const statePath = path.join(tasksDir, taskDir, 'STATE.json');
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function readProgressPhase(taskDir) {
  const progressPath = path.join(tasksDir, taskDir, 'PROGRESS.md');
  if (!fs.existsSync(progressPath)) return null;
  const text = fs.readFileSync(progressPath, 'utf8');
  // Match "- Phase: X", "Phase: X", or "Current: X" (task capsules use all three).
  const match = text.match(/^(?:-\s*)?(?:Phase|Current(?: phase)?):\s*([A-Za-z_-]+)/mi);
  return match ? match[1].trim().toLowerCase() : null;
}

function canArchive(taskDir) {
  if (RESERVED.has(taskDir)) return { ok: false, reason: 'reserved directory' };
  if (taskDir.startsWith('_')) return { ok: false, reason: 'system directory' };

  const state = readStateJson(taskDir);
  const status = state?.status?.toLowerCase() || '';
  const phase = state?.phase?.toLowerCase() || '';

  if (NEVER_ARCHIVE_STATUSES.has(status)) {
    return { ok: false, reason: `status "${status}" is never auto-archived` };
  }
  if (NEVER_ARCHIVE_STATUSES.has(phase)) {
    return { ok: false, reason: `phase "${phase}" is never auto-archived` };
  }

  if (SAFE_ARCHIVE_STATUSES.has(status) || SAFE_ARCHIVE_STATUSES.has(phase)) {
    return { ok: true, reason: `status/phase allows archive` };
  }

  // Fallback: check PROGRESS.md phase
  const progressPhase = readProgressPhase(taskDir);
  if (progressPhase && SAFE_ARCHIVE_STATUSES.has(progressPhase)) {
    return { ok: true, reason: `PROGRESS.md phase "${progressPhase}" allows archive` };
  }
  if (progressPhase && NEVER_ARCHIVE_STATUSES.has(progressPhase)) {
    return { ok: false, reason: `PROGRESS.md phase "${progressPhase}" is never auto-archived` };
  }

  return { ok: false, reason: 'status indeterminate — requires manual review' };
}

function scandir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

function safeResolve(...segments) {
  const resolved = path.resolve(root, ...segments);
  const normalized = resolved.replace(/\\/g, '/');
  const tasksPrefix = tasksDir.replace(/\\/g, '/');
  if (!normalized.startsWith(tasksPrefix + '/') && normalized !== tasksPrefix) {
    throw new Error(`Path "${resolved}" is outside Harness/tasks/ — aborting`);
  }
  return resolved;
}

function mkdirIfMissing(dir) {
  if (!fs.existsSync(dir)) {
    if (flags.apply) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return true;
  }
  return false;
}

function resultsToJson(results) {
  return JSON.stringify(results, null, 2);
}

// Main
const taskDirs = scandir(tasksDir).filter(d => !RESERVED.has(d));
const candidates = flags.task
  ? taskDirs.filter(d => d === flags.task)
  : taskDirs;

if (flags.task && candidates.length === 0) {
  const msg = `Task "${flags.task}" not found in Harness/tasks/`;
  if (flags.json) console.log(resultsToJson({ error: msg }));
  else console.error(msg);
  process.exit(1);
}

const results = [];
const skipped = [];

// Read active task from PROGRESS.md
const progressPath = path.join(root, 'Harness', 'PROGRESS.md');
let activeTask = null;
if (fs.existsSync(progressPath)) {
  const text = fs.readFileSync(progressPath, 'utf8');
  const match = text.match(/## Active Task\s*\n+\s*-\s*(.+)/);
  if (match) activeTask = match[1].trim();
}

const archiveable = [];
for (const dir of candidates) {
  if (dir === activeTask) {
    skipped.push({ dir, reason: 'active task' });
    continue;
  }
  const result = canArchive(dir);
  if (result.ok) {
    archiveable.push(dir);
  } else {
    skipped.push({ dir, reason: result.reason });
  }
}

// Sort by modified time (oldest first) to archive oldest first
archiveable.sort((a, b) => {
  const statA = fs.statSync(path.join(tasksDir, a));
  const statB = fs.statSync(path.join(tasksDir, b));
  return statA.mtimeMs - statB.mtimeMs;
});

// Determine how many to archive: keep `flags.keep` non-archived
const currentNonArchived = taskDirs.length;
const toArchiveCount = flags.task
  ? archiveable.length
  : Math.max(0, currentNonArchived - flags.keep);

const toArchive = archiveable.slice(0, toArchiveCount);

for (const dir of toArchive) {
  const stat = fs.statSync(path.join(tasksDir, dir));
  const year = new Date(stat.mtimeMs).getFullYear().toString();
  const src = safeResolve('Harness', 'tasks', dir);
  const destDir = safeResolve('Harness', 'tasks', '_archive', year);
  const dest = path.join(destDir, dir);

  if (flags.apply) {
    mkdirIfMissing(destDir);
    fs.renameSync(src, dest);

    // Update STATE.json status to archived
    const statePath = path.join(dest, 'STATE.json');
    if (fs.existsSync(statePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        state.status = 'archived';
        state.phase = 'archived';
        state.updatedAt = new Date().toISOString();
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
      } catch {
        // If STATE.json is broken, leave it alone
      }
    }

    results.push({ dir, year, action: 'archived', status: 'moved' });
  } else {
    results.push({ dir, year, action: 'would-archive', status: 'dry-run' });
  }
}

for (const s of skipped) {
  results.push({ dir: s.dir, year: null, action: 'skipped', status: s.reason });
}

// Update INDEX.md
const indexPath = path.join(archiveDir, 'INDEX.md');
const indexEntries = results
  .filter(r => r.action === 'archived')
  .map(r => `| ${r.dir} | ${r.year} | ${new Date().toISOString().split('T')[0]} |`);

if (indexEntries.length > 0 && flags.apply) {
  mkdirIfMissing(archiveDir);
  const existingIndex = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, 'utf8')
    : '| Task | Year | Archived |\n|------|------|----------|\n';
  const newEntries = indexEntries.join('\n') + '\n';
  fs.writeFileSync(indexPath, existingIndex + newEntries);
}

if (flags.json) {
  console.log(resultsToJson({
    scanned: candidates.length,
    archiveable: archiveable.length,
    toArchive: toArchive.length,
    skipped: skipped.length,
    dryRun: flags.dryRun,
    results,
  }));
} else {
  if (flags.dryRun) console.log('[DRY RUN] No files moved. Use --apply to execute.');
  console.log(`Scanned: ${candidates.length}, Archiveable: ${archiveable.length}, To archive: ${toArchive.length}, Skipped: ${skipped.length}`);
  for (const r of results) {
    console.log(`  ${r.action}: ${r.dir} (${r.status})${r.year ? ' → _archive/' + r.year : ''}`);
  }
}
