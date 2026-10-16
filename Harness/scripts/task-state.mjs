#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  normalizeStatus as routeNormalizeStatus,
  archiveEligibility as routeArchiveEligibility,
  buildArchiveIndexEntries as routeBuildArchiveIndexEntries,
  readArchivedTasks as routeReadArchivedTasks,
  resolveRoute as routeResolveRoute,
  buildRouteStub as routeBuildRouteStub,
  buildResumeSummary as routeBuildResumeSummary,
} from './lib/task-route.mjs';

const root = process.cwd();
const harnessDir = path.join(root, 'Harness');
const tasksDir = path.join(harnessDir, 'tasks');
const archiveDir = path.join(tasksDir, '_archive');
const progressPath = path.join(harnessDir, 'PROGRESS.md');
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'help';

const LEGACY_ARCHIVE_KEEP_DEFAULT = 0;
const RESERVED = new Set(['_template', '_archive', 'continuous']);
const TASK_ID_RE = /^task-[a-z]+(-[a-z0-9]+){1,4}$/;
const CANONICAL_STATUSES = new Set(['active', 'blocked', 'closed']);
const NEVER_ARCHIVE_STATUSES = new Set([
  'active',
  'blocked',
]);
const SAFE_ARCHIVE_STATUSES = new Set([
  'closed',
  // Legacy values are retained for archive compatibility. New writes use
  // the canonical lifecycle statuses above.
  'complete',
  'verified',
  'archived',
  'abandoned',
  'obsolete',
  'done',
  'closed',
  'closeout',
]);
const VALID_STATUSES = new Set([
  ...CANONICAL_STATUSES,
  ...NEVER_ARCHIVE_STATUSES,
  ...SAFE_ARCHIVE_STATUSES,
  'in_progress',
  'running',
  'pending',
  'needs-user-decision',
  'skipped',
  'failed',
]);
const VALID_PHASES = new Set([
  'intake',
  'clarify',
  'requirements',
  'prd',
  'acceptance',
  'plan',
  'explore',
  'implement',
  'verify',
  'review',
  'fix',
  'reflect',
  'closeout',
  'blocked',
  'archived',
  'verified',
]);
const PHASE_ALIASES = new Map([
  ['implementation', 'implement'],
  ['build', 'implement'],
  ['validation', 'verify'],
  ['complete', 'verified'],
  ['done', 'verified'],
  ['closed', 'closeout'],
]);
const STATUS_ALIASES = new Map([
  // Legacy values intentionally normalize to the smaller lifecycle. The raw
  // value remains available to archive/history code when needed.
  ['in-progress', 'active'],
  ['inprogress', 'active'],
  ['in_progress', 'active'],
  ['running', 'active'],
  ['pending', 'active'],
  ['needs_user_decision', 'blocked'],
  ['needs-user-decision', 'blocked'],
  ['needs-user', 'blocked'],
  ['need-user-decision', 'blocked'],
  ['complete', 'closed'],
  ['completed', 'closed'],
  ['verified', 'closed'],
  ['archived', 'closed'],
  ['abandoned', 'closed'],
  ['obsolete', 'closed'],
  ['done', 'closed'],
  ['closeout', 'closed'],
  ['skipped', 'closed'],
  ['failed', 'blocked'],
  ['close-out', 'closed'],
]);
const OPEN_TASK_STATUSES = new Set(['active', 'blocked']);
const VALUE_FLAGS = new Set(['--keep', '--mode', '--phase', '--status', '--task', '--text', '--title', '--note', '--context', '--group', '--project', '--tag', '--tags', '--keyword', '--since']);

function hasFlag(name) {
  return args.includes(name);
}

function flagValue(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function findTaskIdArg(startIndex = 1) {
  for (let i = startIndex; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      if (a.includes('=')) continue;
      const next = args[i + 1];
      if (VALUE_FLAGS.has(a) && next && !next.startsWith('--')) {
        i++; // skip the value
      }
      continue;
    }
    return a;
  }
  return null;
}

const outputJson = hasFlag('--json');

function print(payload) {
  if (outputJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (payload.command === 'list') {
    console.log(`Active Task: ${payload.activeTask || 'None'}`);
    console.log(`Tasks: ${payload.taskCount}`);
    const renderTask = (task) => {
      const deps = task.dependsOn?.length ? `  dependsOn: [${task.dependsOn.join(', ')}]` : '';
      const blocks = task.blocks?.length ? `  blocks: [${task.blocks.join(', ')}]` : '';
      const project = task.project || task.group || 'default';
      const tags = task.tags?.length ? ` tags=[${task.tags.join(', ')}]` : '';
      const dates = task.createdAt || task.updatedAt
        ? ` created=${String(task.createdAt || '-').slice(0, 10)} updated=${String(task.updatedAt || '-').slice(0, 10)}`
        : '';
      console.log(`- ${task.id}: project=${project} status=${task.status || '-'} phase=${task.phase || '-'}${tags}${dates}${deps}${blocks}`);
    };
    if (payload.groups) {
      console.log('');
      console.log('=== Task Groups ===');
      for (const group of payload.groups) {
        console.log(`${group.group} (${group.tasks.length} task${group.tasks.length === 1 ? '' : 's'}):`);
        for (const task of group.tasks) renderTask(task);
      }
    } else {
      for (const task of payload.tasks || []) renderTask(task);
    }

    // Render graph
    const g = payload.graph;
    if (g) {
      console.log('');
      console.log('=== Task Graph ===');
      if (g.roots.length > 0) {
        console.log(`\nRoots (${g.roots.length} tasks, no internal dependencies):`);
        for (const id of g.roots) console.log(`  → ${id}`);
      }
      if (g.depEdges.length > 0) {
        console.log(`\nDependency chains (${g.depEdges.length} edges):`);
        for (const e of g.depEdges) console.log(`  ${e.from}  ──▶  ${e.to}`);
      }
      if (g.blockEdges.length > 0) {
        console.log(`\nBlocks (${g.blockEdges.length} edges):`);
        for (const e of g.blockEdges) console.log(`  ${e.from}  ▸▸  ${e.to}`);
      }
      if (g.orphanedDeps.length > 0) {
        console.log(`\nOrphaned dependencies (${g.orphanedDeps.length}, target not in active tasks):`);
        for (const o of g.orphanedDeps) console.log(`  ${o.task}  ──▶  ${o.missingDep}  (missing)`);
      }
      if (g.roots.length === 0 && g.depEdges.length === 0 && g.blockEdges.length === 0) {
        console.log('  (no relationships — all tasks are independent)');
      }
    }
  } else if (payload.command === 'validate') {
    console.log(`Active Task: ${payload.activeTask || 'None'}`);
    console.log(`Tasks: ${payload.taskCount}`);
    for (const task of payload.tasks || []) {
      console.log(`- ${task.id}: status=${task.status || '-'} phase=${task.phase || '-'}`);
    }
  } else if (payload.command === 'reconcile' || payload.command === 'set-active' || payload.command === 'transition') {
    if (payload.dryRun) console.log('[DRY RUN] No files changed. Use --apply to write.');
    console.log(`Operations: ${payload.operations.length}`);
    for (const op of payload.operations) console.log(`- ${op.action}: ${op.taskId || op.path} (${op.reason})`);
  } else if (payload.command === 'archive' || payload.command === 'auto-archive') {
    if (payload.dryRun) console.log('[DRY RUN] No files moved. Use --apply to execute.');
    if (payload.group) console.log(`Group: ${payload.group}`);
    if (payload.command === 'auto-archive') {
      console.log(`Scanned: ${payload.scanned}, Eligible: ${payload.eligible}, To archive: ${payload.toArchive}`);
      for (const r of payload.results) {
        const suffix = r.archivePath ? ` -> ${r.archivePath}` : '';
        console.log(`- ${r.action}: ${r.taskId} (${r.status || r.reason})${suffix}`);
      }
      return;
    }
    console.log(`Scanned: ${payload.scanned}, Archiveable: ${payload.archiveable}, To archive: ${payload.toArchive}, Kept: ${payload.kept}, Skipped: ${payload.skipped}`);
    for (const r of payload.results) {
      const suffix = r.path ? ` -> _archive/${r.path}` : '';
      console.log(`- ${r.action}: ${r.dir} (${r.status})${suffix}`);
    }
  } else if (payload.command === 'open') {
    console.log(`Open tasks: ${payload.taskCount}`);
    for (const task of payload.tasks || []) {
      const blocked = task.blockedByOpenDeps?.length ? ` blockedBy=[${task.blockedByOpenDeps.join(', ')}]` : '';
      console.log(`- ${task.id}: project=${task.project || task.group || 'default'} status=${task.status || '-'} phase=${task.phase || '-'} updated=${String(task.updatedAt || '-').slice(0, 10)}${blocked}`);
    }
  } else if (payload.command === 'query') {
    console.log(`Query: ${payload.keyword} (${payload.count} match${payload.count === 1 ? '' : 'es'})`);
    for (const result of payload.results || []) {
      console.log(`- ${result.id}: project=${result.project || result.group || 'default'} status=${result.status || '-'} path=${result.path}`);
      for (const hit of result.hits || []) console.log(`  ${hit.file}:${hit.line} ${hit.snippet}`);
    }
  } else if (payload.command === 'index') {
    console.log(`Task index rebuilt: ${payload.taskCount} task(s) in ${payload.projectCount} project(s).`);
    console.log(`- JSON: ${payload.path}`);
    console.log(`- Markdown: ${payload.markdownPath}`);
  } else {
    console.log(payload.message || '');
  }

  for (const warning of payload.warnings || []) console.warn(`Warning: ${warning}`);
  for (const error of payload.errors || []) console.error(`Error: ${error}`);
}

function finish(payload, exitCode = payload.ok === false ? 1 : 0) {
  print(payload);
  process.exit(exitCode);
}

function usage() {
  finish({
    ok: true,
    command: 'help',
    message: `Usage: node Harness/scripts/task-state.mjs <command> [options]

Commands:
  list [--json] [--group <project>] [--project <project>] [--status <s>] [--by-group]
                                        List task state with dependency/resume info.
                                        --group is a legacy alias for --project.
  index [--json]                         Rebuild Harness/tasks/INDEX.json and INDEX.md.
  query <keyword> [--project <project>] [--status <s>] [--json]
                                        Search task metadata and capsule notes.
  validate [--strict] [--json]          Validate state consistency (includes link checks).
  reconcile [--dry-run|--apply] [--json] Normalize STATE.json and root PROGRESS.md.
  set-active <task-id> [--dry-run]       Set the focus/resume task (multiple open tasks are valid).
  transition <task-id> --status <s> --phase <p> [--dry-run]
  transition <task-id> --reopen --status active|blocked --note "reason" [--dry-run]
                                        --reopen is recovery-only: it may only reopen a
                                        just-closed WF-managed task (closedAt === updatedAt),
                                        requires a non-empty --note reason and status
                                        active|blocked, and preserves mode and all
                                        queues/questions. It persists lastRecovery {at, reason}.
  archive [--dry-run|--apply] [--keep n] [--task id] [--group <tag>] [--json]
                                        Archive eligible tasks to _archive/YYYY/MM/DD/.
                                        Explicit --apply (no --task/--group filter) archives ALL.
                                        --group archives a whole tag (batch op, no confirmation;
                                        it implies --apply unless --dry-run is given).
                                        DEPRECATED: prefer auto-archive. --keep/--group still supported.
  auto-archive [--dry-run] [--task id] [--json]
                                        Safe auto-archive of closed tasks only.
                                        active/blocked/unknown/reserved tasks are rejected.
                                        Idempotent: already-archived tasks return already-archived.
                                        Default is dry-run; use --apply to execute.
  route --task <id> [--json]
                                        Resolve route for a task (live or archived).
                                        Returns id, title, status, phase, path, archivePath,
                                        blockers, dependsOn, blocks. Does not leak full context.
  history list [--year YYYY] [--month MM] [--json]
                                        List archived tasks, optional year/month filter.
  history search <keyword> [--json]      Full-text search archived PLAN/PROGRESS/PROBLEM/REFERENCES.
  history load <task-id> [--summary] [--json]  Load one archived task's record.
                                        --summary returns compact route stub (no PLAN/decisions/logs).
  history delete <task-id> [--dry-run|--apply] [--json]
                                        Delete an archived task (audit trail written).
  record <task-id> [--create] [--text "description"] [--status <s>] [--phase <p>] [--mode <m>] [--group <project>] [--project <project>] [--tag <tag[,tag...]>] [--dry-run|--apply] [--json]
                                        Create or update a task record.
                                        --project is canonical; --group remains compatible.
  open [--project <project>] [--status <s>] [--json]
                                        List all active/blocked tasks; multiple open tasks are valid.

Legacy archive defaults to dry-run and previews all eligible tasks; --keep only applies when explicitly supplied. Prefer safe auto-archive.`,
  }, 0);
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
}

function writeJsonAtomic(file, value) {
  writeTextAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

// Small parameterized helpers for adjacent runtime consumers.  The task-state
// CLI remains the canonical owner of task paths and atomic writes; these
// helpers deliberately do not normalize or maintain a second task store.
function taskPathsForProject(projectRoot) {
  const project = path.resolve(String(projectRoot || ''));
  const harness = path.join(project, 'Harness');
  const tasks = path.join(harness, 'tasks');
  return { project, harnessDir: harness, tasksDir: tasks };
}

function readTaskState(projectRoot, taskId) {
  const { tasksDir: projectTasksDir } = taskPathsForProject(projectRoot);
  const file = path.join(projectTasksDir, String(taskId));
  const statePath = path.join(file, 'STATE.json');
  if (!fs.existsSync(statePath)) return { state: null, error: null, path: statePath };
  try {
    return { state: JSON.parse(fs.readFileSync(statePath, 'utf8')), error: null, path: statePath };
  } catch (err) {
    return { state: null, error: `invalid STATE.json: ${err.message}`, path: statePath };
  }
}

function writeTaskStateAtomic(projectRoot, taskId, state) {
  const { tasksDir: projectTasksDir } = taskPathsForProject(projectRoot);
  writeJsonAtomic(path.join(projectTasksDir, String(taskId), 'STATE.json'), state);
}

function normalizeCandidate(value, validSet, aliasMap) {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim().toLowerCase();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '-');
  const direct = aliasMap.get(compact) || compact;
  if (validSet.has(direct)) return direct;

  const tokens = raw
    .replace(/[`*_()[\]{}:]/g, ' ')
    .replace(/[^a-z0-9_-]+/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const canonical = aliasMap.get(token) || token;
    if (validSet.has(canonical)) return canonical;
  }

  return '';
}

function normalizeStatus(value) {
  return normalizeCandidate(value, VALID_STATUSES, STATUS_ALIASES);
}

function normalizePhase(value) {
  return normalizeCandidate(value, VALID_PHASES, PHASE_ALIASES);
}

function displayPhase(phase) {
  const value = normalizePhase(phase) || String(phase || '').trim().toLowerCase();
  const labels = {
    intake: 'Intake',
    clarify: 'Clarify',
    requirements: 'Requirements',
    prd: 'PRD',
    acceptance: 'Acceptance',
    plan: 'Plan',
    explore: 'Explore',
    implement: 'Implementation',
    verify: 'Validation',
    review: 'Review',
    fix: 'Fix',
    reflect: 'Reflect',
    closeout: 'Closeout',
    blocked: 'Blocked',
    archived: 'Archived',
    verified: 'Verified',
  };
  return labels[value] || (value ? value[0].toUpperCase() + value.slice(1) : '-');
}

function statusFromPhase(phase, isActive) {
  const normalized = normalizePhase(phase);
  if (normalized === 'verified' || normalized === 'closeout' || normalized === 'archived') return 'closed';
  if (normalized === 'blocked') return 'blocked';
  if (isActive) return 'active';
  return 'active';
}

function defaultQueues() {
  return {
    ready: [],
    running: [],
    blocked: [],
    done: [],
  };
}

function defaultTaskRuntime() {
  if (process.env.HARNESS_DEFAULT_RUNTIME) return process.env.HARNESS_DEFAULT_RUNTIME;
  const settingsPath = path.join(harnessDir, 'settings.json');
  try {
    if (!fs.existsSync(settingsPath)) return 'codex';
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return settings?.terminal?.defaultRuntime || 'codex';
  } catch {
    return 'codex';
  }
}

const VALID_MODES = new Set([
  'direct',
  'wf',
  'wf-max',
  'wf-auto',
  'wf-auto-spark',
  'wf-review',
  'wf-browser',
]);
// Durable task lifecycle is opt-in only for the two task-owning WF modes.
// wf-auto/wf-auto-spark remain explicit workflow capabilities, but their
// continuous capsule is not a normal task lifecycle and must not adopt tasks.
const WF_MANAGED_MODES = new Set(['wf', 'wf-max']);

function normalizeMode(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim().toLowerCase();
  if (!raw) return '';
  if (VALID_MODES.has(raw)) return raw;
  return '';
}

function isWfManagedMode(value) {
  return WF_MANAGED_MODES.has(normalizeMode(value));
}

function lifecycleForState(state, fallbackStatus = 'active') {
  const status = normalizeStatus(state?.status) || fallbackStatus;
  const mode = normalizeMode(state?.mode) || 'direct';
  const wfManaged = isWfManagedMode(mode);
  return {
    mode,
    wfManaged,
    resumeRequired: wfManaged && OPEN_TASK_STATUSES.has(status),
  };
}
function normalizeQueues(state) {
  const source = state && typeof state.queues === 'object' && state.queues ? state.queues : state || {};
  return {
    ready: Array.isArray(source.ready) ? source.ready : [],
    running: Array.isArray(source.running) ? source.running : [],
    blocked: Array.isArray(source.blocked) ? source.blocked : [],
    done: Array.isArray(source.done) ? source.done : [],
  };
}

function readState(taskId) {
  const file = path.join(tasksDir, taskId, 'STATE.json');
  if (!fs.existsSync(file)) return { state: null, error: null, path: file };
  try {
    return { state: JSON.parse(fs.readFileSync(file, 'utf8')), error: null, path: file };
  } catch (err) {
    return { state: null, error: `invalid STATE.json: ${err.message}`, path: file };
  }
}

function readTaskProgressPhase(taskId) {
  const text = readText(path.join(tasksDir, taskId, 'PROGRESS.md'));
  for (const pattern of [
    /^(?:-\s*)?Phase:\s*(.+)$/mi,
    /^Current phase:\s*(.+)$/mi,
    /^Current:\s*(.+)$/mi,
  ]) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return '';
}

function parseRootProgress() {
  const text = readText(progressPath);
  const activeMatch = text.match(/## Active Task\s*\r?\n+(?:\s*\r?\n)?\s*-\s*([^\r\n]+)/);
  const rawActive = activeMatch ? activeMatch[1].trim() : '';
  const activeTask = rawActive && !/^none$/i.test(rawActive) ? rawActive : null;
  const rows = [];
  const taskIndexMatch = text.match(/## Task Index\s*\r?\n([\s\S]*?)(?=\r?\n## |\s*$)/);
  if (taskIndexMatch) {
    for (const line of taskIndexMatch[1].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|')) continue;
      if (/^\|\s*-+/.test(trimmed) || /^\|\s*ID\s*\|/i.test(trimmed)) continue;
      const cells = trimmed.split('|').slice(1, -1).map(cell => cell.trim());
      if (cells.length >= 4 && cells[0]) {
        rows.push({ id: cells[0], goal: cells[1], phase: cells[2], closed: cells[3] });
      }
    }
  }
  return { text, activeTask, rows };
}

function listOuterTaskNames() {
  if (!fs.existsSync(tasksDir)) return [];
  return fs.readdirSync(tasksDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => !RESERVED.has(name) && !name.startsWith('_'))
    .sort();
}

function taskTitle(taskId) {
  return taskId
    .replace(/^task-/, '')
    .split('-')
    .map(word => word[0] ? word[0].toUpperCase() + word.slice(1) : word)
    .join(' ');
}

function collectTasks() {
  const rootProgress = parseRootProgress();
  const rowsById = new Map(rootProgress.rows.map(row => [row.id, row]));
  const tasks = listOuterTaskNames().map(id => {
    const stateRead = readState(id);
    const state = stateRead.state;
    const rootRow = rowsById.get(id) || null;
    const progressPhaseRaw = readTaskProgressPhase(id);
    const stateStatus = normalizeStatus(state?.status);
    const statePhase = normalizePhase(state?.phase);
    const rootPhase = normalizePhase(rootRow?.phase);
    const progressPhase = normalizePhase(progressPhaseRaw);
    // STATE.json is authoritative once present; root/task progress remains a
    // compatibility fallback for legacy capsules without normalized state.
    const phase = statePhase || progressPhase || rootPhase;
    const status = stateStatus || statusFromPhase(phase, id === rootProgress.activeTask);
    const stat = fs.statSync(path.join(tasksDir, id));
    return {
      id,
      path: path.join(tasksDir, id),
      statePath: stateRead.path,
      state,
      stateError: stateRead.error,
      rootRow,
      progressPhaseRaw,
      stateStatus,
      statePhase,
      rootPhase,
      progressPhase,
      status,
      phase,
      mtimeMs: stat.mtimeMs,
    };
  });

  return { rootProgress, tasks, rowsById };
}

function archiveEligibility(task, activeTask) {
  if (task.id === activeTask) return { ok: false, reason: 'active task' };
  if (task.stateError) return { ok: false, reason: task.stateError };
  if (!task.state) return { ok: false, reason: 'missing STATE.json requires reconcile' };
  // Unified route-layer eligibility. task-route.mjs is the single source of
  // truth for canonical status checks; we layer the write-side safety rules
  // (active-question, queue state, root/progress phase) on top. The route
  // layer rejects malformed task ids, so we swallow that and rely on the
  // local status checks below to produce a verdict.
  let base = null;
  try {
    base = routeArchiveEligibility(root, task.id);
  } catch {
    base = null;
  }
  if (base && !base.ok) return { ok: false, reason: base.reason };
  const status = normalizeStatus(task.state.status);
  const phase = normalizePhase(task.state.phase);
  if (NEVER_ARCHIVE_STATUSES.has(status)) return { ok: false, reason: `status "${status}" is never auto-archived` };
  if (NEVER_ARCHIVE_STATUSES.has(phase)) return { ok: false, reason: `phase "${phase}" is never auto-archived` };
  if (task.state.activeQuestion) return { ok: false, reason: 'activeQuestion is set' };
  for (const marker of ['owner', 'lease', 'lock']) {
    const value = task.state[marker];
    const active = typeof value === 'string'
      ? value.trim().length > 0
      : Array.isArray(value)
        ? value.length > 0
        : value && typeof value === 'object'
          ? Object.keys(value).length > 0
          : value !== undefined && value !== null && value !== false;
    if (active) return { ok: false, reason: `active ${marker} marker is set` };
  }
  const queues = normalizeQueues(task.state);
  if (queues.ready.length > 0) return { ok: false, reason: 'ready queue is not empty' };
  if (queues.running.length > 0) return { ok: false, reason: 'running queue is not empty' };
  if (queues.blocked.length > 0) return { ok: false, reason: 'blocked queue is not empty' };
  // Require closeout verification: task must be in closeout or later phase
  // OR have explicit closeout/verified/archived status to be auto-archived.
  const CLOSEOUT_PHASES = new Set(['closeout', 'verified', 'archived', 'reflect']);
  const isClosedStatus = SAFE_ARCHIVE_STATUSES.has(status);
  const isCloseoutPhase = CLOSEOUT_PHASES.has(phase);
  if (isClosedStatus && isCloseoutPhase) {
    return { ok: true, reason: 'closed + closeout verified; allows archive' };
  }
  if (isClosedStatus && !isCloseoutPhase) {
    return { ok: false, reason: `closed but phase "${phase}" is not closeout/verified; run closeout first` };
  }
  if (SAFE_ARCHIVE_STATUSES.has(task.rootPhase) || SAFE_ARCHIVE_STATUSES.has(task.progressPhase)) {
    return { ok: true, reason: 'root/progress phase allows archive' };
  }
  return { ok: false, reason: 'status indeterminate; run reconcile or review manually' };
}

function validateState({ strict = false } = {}) {
  const { rootProgress, tasks } = collectTasks();
  const errors = [];
  const warnings = [];
  const rootIds = new Set(rootProgress.rows.map(row => row.id));
  const taskIds = new Set(tasks.map(task => task.id));

  function issue(message, hard = false) {
    if (hard || strict) errors.push(message);
    else warnings.push(message);
  }

  if (rootProgress.activeTask && !taskIds.has(rootProgress.activeTask)) {
    issue(`Active Task "${rootProgress.activeTask}" does not exist under Harness/tasks/`, true);
  }

  for (const row of rootProgress.rows) {
    if (!taskIds.has(row.id)) issue(`Task Index row has no outer task directory: ${row.id}`);
  }
  for (const task of tasks) {
    if (!rootIds.has(task.id)) issue(`Outer task directory is missing from Task Index: ${task.id}`);
    if (task.stateError) {
      issue(`${task.id}: ${task.stateError}`, true);
      continue;
    }
    if (!task.state) {
      issue(`${task.id}: missing STATE.json`);
      continue;
    }
    if (task.state.taskId && task.state.taskId !== task.id) {
      issue(`${task.id}: STATE.json taskId "${task.state.taskId}" does not match directory`, true);
    }
    if (task.state.status && !normalizeStatus(task.state.status)) {
      issue(`${task.id}: unknown status "${task.state.status}"`);
    }
    if (task.state.phase && !normalizePhase(task.state.phase)) {
      issue(`${task.id}: unknown phase "${task.state.phase}"`);
    }
    // Multiple tasks may be active. The root Active Task is retained as a
    // focus/resume pointer for compatibility, not as a singleton invariant.

    const links = task.state.links || {};
    if (Array.isArray(links.dependsOn)) {
      for (const depId of links.dependsOn) {
        if (!taskIds.has(depId)) issue(`${task.id}: links.dependsOn references non-existent task "${depId}"`);
      }
    }
    if (Array.isArray(links.blocks)) {
      for (const blockId of links.blocks) {
        if (!taskIds.has(blockId)) issue(`${task.id}: links.blocks references non-existent task "${blockId}"`);
      }
    }
    if (Array.isArray(task.state.workItems)) {
      const runningItems = task.state.workItems.filter(wi => wi && normalizeStatus(wi.status) === 'running');
      if (runningItems.length > 0 && (!Array.isArray(task.state.dispatchLedger) || task.state.dispatchLedger.length === 0)) {
        issue(`${task.id}: workItems has ${runningItems.length} running item(s) but no dispatchLedger entries`);
      }
    }

    const queues = normalizeQueues(task.state);
    const queueMembership = new Map();
    for (const queueName of ['ready', 'running', 'blocked', 'done']) {
      for (const item of queues[queueName]) {
        const itemId = typeof item === 'string' ? item : (item && typeof item.id === 'string' ? item.id : null);
        if (!itemId) {
          issue(`${task.id}: queues.${queueName} contains an item without an id`, true);
          continue;
        }
        const priorQueue = queueMembership.get(itemId);
        if (priorQueue) {
          issue(`${task.id}: queue item "${itemId}" appears in both ${priorQueue} and ${queueName}`, true);
        } else {
          queueMembership.set(itemId, queueName);
        }
      }
    }
    const status = normalizeStatus(task.state.status);
    const phase = normalizePhase(task.state.phase);
    if ((SAFE_ARCHIVE_STATUSES.has(status) || SAFE_ARCHIVE_STATUSES.has(phase)) &&
      (queues.ready.length > 0 || queues.running.length > 0 || queues.blocked.length > 0)) {
      issue(`${task.id}: closed task has non-empty ready/running/blocked queues`, true);
    }
  }

  const focusedTask = tasks.find(task => task.id === rootProgress.activeTask);
  const openManagedTasks = tasks.filter(task => {
    const status = normalizeStatus(task.state?.status) || task.status;
    return isWfManagedMode(task.state?.mode) && OPEN_TASK_STATUSES.has(status);
  });
  if (focusedTask && openManagedTasks.length > 0) {
    const focusedStatus = normalizeStatus(focusedTask.state?.status) || focusedTask.status;
    if (!isWfManagedMode(focusedTask.state?.mode) && OPEN_TASK_STATUSES.has(focusedStatus)) {
      issue(`Direct task "${focusedTask.id}" cannot be the active focus while an open WF-managed task exists`, true);
    }
  }

  return {
    ok: errors.length === 0,
    command: 'validate',
    activeTask: rootProgress.activeTask,
    taskCount: tasks.length,
    errors,
    warnings,
    tasks: tasks.map(task => ({
      id: task.id,
      status: normalizeStatus(task.state?.status) || task.status,
      phase: normalizePhase(task.state?.phase) || task.phase,
      rootPhase: task.rootPhase,
      progressPhase: task.progressPhase,
      archive: archiveEligibility(task, rootProgress.activeTask),
    })),
  };
}

function ensureValidTaskId(taskId) {
  if (!taskId || !TASK_ID_RE.test(taskId) || RESERVED.has(taskId) || taskId.startsWith('_')) {
    throw new Error(`Invalid task id "${taskId || ''}". Expected task-<verb>-<noun>[-detail].`);
  }
}

function safeTaskPath(...segments) {
  const resolved = path.resolve(tasksDir, ...segments);
  const normalized = resolved.replace(/\\/g, '/');
  const prefix = tasksDir.replace(/\\/g, '/');
  if (normalized !== prefix && !normalized.startsWith(`${prefix}/`)) {
    throw new Error(`Resolved path is outside Harness/tasks/: ${resolved}`);
  }
  assertRealPathWithinTasksRoot(resolved);
  return resolved;
}

function assertRealPathWithinTasksRoot(candidatePath) {
  const rootReal = fs.realpathSync(tasksDir);
  let existing = candidatePath;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      throw new Error(`Cannot resolve archive path under Harness/tasks/: ${candidatePath}`);
    }
    existing = parent;
  }
  const existingReal = fs.realpathSync(existing);
  const relative = path.relative(rootReal, existingReal);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Resolved path traverses outside Harness/tasks/: ${candidatePath}`);
  }
}

function desiredPhaseForTask(task, activeTask) {
  return task.statePhase || task.progressPhase || task.rootPhase || (task.id === activeTask ? 'implement' : 'intake');
}

function desiredStatusForTask(task, activeTask, desiredPhase) {
  const current = normalizeStatus(task.state?.status);
  const phaseStatus = statusFromPhase(desiredPhase, false);
  if (current === 'active' && phaseStatus === 'closed') return 'closed';
  if (current) return current;
  return statusFromPhase(desiredPhase, task.id === activeTask);
}

function defaultState(taskId, status, phase, now) {
  const runtime = defaultTaskRuntime();
  const lifecycleStatus = normalizeStatus(status) || 'active';
  return {
    schemaVersion: 1,
    taskId,
    status: lifecycleStatus,
    mode: 'direct',
    defaultRuntime: runtime,
    defaultAgentRuntime: runtime,
    tier: 'none',
    phase,
    gate: null,
    project: 'default',
    tags: [],
    createdAt: now,
    startedAt: lifecycleStatus === 'active' ? now : null,
    closedAt: lifecycleStatus === 'closed' ? now : null,
    updatedAt: now,
    activeQuestion: null,
    nextAction: 'Review task state.',
    acceptance: [],
    queues: defaultQueues(),
    workItems: [],
    dispatchLedger: [],
    decisions: [],
    risks: [],
    artifacts: [],
  };
}

function normalizeState(task, activeTask, now) {
  const phase = desiredPhaseForTask(task, activeTask);
  const status = desiredStatusForTask(task, activeTask, phase);
  const before = task.state ? JSON.stringify(task.state) : null;
  const state = task.state
    ? { ...task.state }
    : defaultState(task.id, status, phase, now);

  state.schemaVersion = 1;
  state.taskId = task.id;
  // Keep an archived marker intact when an old repository has an archived
  // capsule in the live directory; archive migration can still move it.
  const rawStatus = String(task.state?.status || '').trim().toLowerCase();
  state.status = rawStatus === 'archived' ? 'archived' : status;
  state.phase = phase;
  if (!state.mode) state.mode = 'direct';
  if (!state.defaultRuntime) state.defaultRuntime = defaultTaskRuntime();
  if (!state.defaultAgentRuntime) state.defaultAgentRuntime = state.defaultRuntime;
  if (!state.tier) state.tier = 'none';
  if (!Object.prototype.hasOwnProperty.call(state, 'gate')) state.gate = null;
  state.tags = normalizeTags(state.tags);
  if (!state.createdAt) state.createdAt = now;
  if (!Object.prototype.hasOwnProperty.call(state, 'startedAt')) state.startedAt = state.status === 'active' ? now : null;
  if (!Object.prototype.hasOwnProperty.call(state, 'closedAt')) state.closedAt = state.status === 'closed' || state.status === 'archived' ? now : null;
  if (state.status === 'active' && !state.startedAt) state.startedAt = now;
  if (state.status === 'closed' || state.status === 'archived') {
    if (!state.closedAt) state.closedAt = now;
  } else if (state.closedAt) {
    state.closedAt = null;
  }
  if (!Object.prototype.hasOwnProperty.call(state, 'activeQuestion')) state.activeQuestion = null;
  if (!state.nextAction) state.nextAction = task.rootRow?.goal || 'Review task state.';
  state.queues = normalizeQueues(state);
  if (!Array.isArray(state.workItems)) state.workItems = [];
  if (!Array.isArray(state.dispatchLedger)) state.dispatchLedger = [];
  if (!Array.isArray(state.decisions)) state.decisions = [];
  if (!Array.isArray(state.risks)) state.risks = [];
  if (!Array.isArray(state.artifacts)) state.artifacts = [];
  if (!state.updatedAt || JSON.stringify(state) !== before) state.updatedAt = now;

  const after = JSON.stringify(state);
  return {
    state,
    changed: before !== after,
    reason: task.state ? 'normalize existing STATE.json' : 'create missing STATE.json',
  };
}

function renderRootProgress(existingText, activeTask, rows) {
  const activeSection = `## Active Task\n\n- ${activeTask || 'None'}`;
  const taskIndex = `## Task Index

Non-archived task capsules. Archived tasks are listed in \`Harness/tasks/_archive/INDEX.md\` (see \`Harness/specs/protocols/TASK_ARCHIVE.md\`).

| ID | Goal | Phase | Closed |
|----|------|-------|--------|
${rows.map(row => `| ${row.id} | ${row.goal || taskTitle(row.id)} | ${row.phase || '-'} | ${row.closed || '-'} |`).join('\n')}`;

  let text = (existingText || '# PROGRESS.md\n\nGlobal task index.\n\n## Cross-Task Decisions\n\n| Date | Decision | Reason |\n|------|----------|--------|\n').replace(/\r\n/g, '\n');
  text = replaceSection(text, '## Active Task', '## Task Index', activeSection);
  text = replaceSection(text, '## Task Index', '## Cross-Task Decisions', taskIndex);
  return text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderTaskProgress(existingText, taskId, state) {
  const phase = displayPhase(state.phase);
  let text = (existingText || `# ${taskId} - PROGRESS\n\nCompact heartbeat. Update on phase changes, blockers, failures, and closeout.\n`).replace(/\r\n/g, '\n');
  const phaseLine = `- Phase: ${phase}`;

  if (/^(?:-\s*)?Phase:\s*.*$/mi.test(text)) {
    text = text.replace(/^(?:-\s*)?Phase:\s*.*$/mi, phaseLine);
  } else if (text.includes('## Status')) {
    text = text.replace(/## Status\s*\n+/, `## Status\n\n${phaseLine}\n`);
  } else {
    text = `${text.trimEnd()}\n\n## Status\n\n${phaseLine}\n`;
  }

  return text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function replaceSection(text, startHeading, nextHeading, replacement) {
  const start = text.indexOf(startHeading);
  if (start === -1) {
    const next = text.indexOf(nextHeading);
    if (next === -1) return `${text.trimEnd()}\n\n${replacement.trimEnd()}\n`;
    return `${text.slice(0, next).trimEnd()}\n\n${replacement.trimEnd()}\n\n${text.slice(next).trimStart()}`;
  }
  const next = text.indexOf(nextHeading, start + startHeading.length);
  if (next === -1) return `${text.slice(0, start).trimEnd()}\n\n${replacement.trimEnd()}\n`;
  return `${text.slice(0, start).trimEnd()}\n\n${replacement.trimEnd()}\n\n${text.slice(next).trimStart()}`;
}

function buildRows(tasks, activeTask, excluded = new Set()) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const rootOrder = [];
  for (const task of tasks) {
    if (task.rootRow && !rootOrder.includes(task.id)) rootOrder.push(task.id);
  }
  const ids = [];
  if (activeTask && byId.has(activeTask) && !excluded.has(activeTask)) ids.push(activeTask);
  for (const id of rootOrder) {
    if (!ids.includes(id) && byId.has(id) && !excluded.has(id)) ids.push(id);
  }
  for (const task of tasks) {
    if (!ids.includes(task.id) && !excluded.has(task.id)) ids.push(task.id);
  }

  return ids.map(id => {
    const task = byId.get(id);
    const phase = normalizePhase(task.desiredState?.phase) || task.phase;
    const desiredState = task.desiredState || task.state || {};
    return {
      id,
      goal: task.rootRow?.goal || task.state?.goal || task.state?.nextAction || taskTitle(id),
      phase: displayPhase(phase),
      closed: desiredState.closedAt
        ? String(desiredState.closedAt).slice(0, 10)
        : task.rootRow?.closed || '-',
    };
  });
}

function buildReconcilePlan({ activeOverride = undefined, transition = null } = {}) {
  const now = new Date().toISOString();
  const { rootProgress, tasks } = collectTasks();
  const errors = [];
  let activeTask = activeOverride === undefined ? rootProgress.activeTask : activeOverride;

  if (activeTask) {
    try {
      ensureValidTaskId(activeTask);
    } catch (err) {
      errors.push(err.message);
    }
    if (!tasks.some(task => task.id === activeTask)) {
      errors.push(`Active task "${activeTask}" does not exist under Harness/tasks/`);
    }
  }

  for (const task of tasks) {
    if (task.stateError) errors.push(`${task.id}: ${task.stateError}`);
    if (transition && task.id === transition.taskId) {
      const reopen = Boolean(transition.reopen);
      const requestedStatus = transition.status ? normalizeStatus(transition.status) : '';
      const currentStatus = normalizeStatus(task.state?.status) || task.status;
      const localErrors = [];
      if (reopen) {
        const rawStatus = String(task.state?.status || '').trim().toLowerCase();
        const reason = String(transition.reason || '').trim();
        if (!isWfManagedMode(task.state?.mode)) {
          localErrors.push(`${task.id}: --reopen only supports WF-managed tasks; direct tasks cannot be reopened`);
        }
        if (!localErrors.length && rawStatus !== 'closed') {
          localErrors.push(`${task.id}: --reopen requires status "closed"; got "${rawStatus || 'unset'}"`);
        }
        if (!localErrors.length && String(task.state?.closedAt || '').trim() !== String(task.state?.updatedAt || '').trim()) {
          localErrors.push(`${task.id}: --reopen only targets a just-closed WF task (closedAt must equal updatedAt); stale closures require a new task capsule`);
        }
        if (!localErrors.length && !reason) {
          localErrors.push(`${task.id}: --reopen requires a non-empty --note "reason"`);
        }
        if (!localErrors.length) {
          if (!requestedStatus || !OPEN_TASK_STATUSES.has(requestedStatus)) {
            localErrors.push(`${task.id}: --reopen status must be "active" or "blocked"`);
          } else if (requestedStatus === 'active') {
            activeTask = task.id;
          }
        }
      } else {
        if (transition.status) {
          if (!requestedStatus) localErrors.push(`${task.id}: unknown transition status "${transition.status}"`);
          if (requestedStatus && isWfManagedMode(task.state?.mode) && currentStatus === 'closed' && requestedStatus !== 'closed') {
            localErrors.push(`${task.id}: closed WF-managed task cannot be reopened; use --reopen with --note "reason"`);
          }
          if (requestedStatus === 'active') activeTask = task.id;
          if (rootProgress.activeTask === task.id && SAFE_ARCHIVE_STATUSES.has(requestedStatus)) activeTask = null;
        }
      }
      if (transition.phase && !normalizePhase(transition.phase)) {
        localErrors.push(`${task.id}: unknown transition phase "${transition.phase}"`);
      }
      errors.push(...localErrors);
    }
  }

  const focusedTask = tasks.find(task => task.id === activeTask);
  const openManagedTasks = tasks.filter(task => {
    const status = normalizeStatus(task.state?.status) || task.status;
    return isWfManagedMode(task.state?.mode) && OPEN_TASK_STATUSES.has(status);
  });
  if (focusedTask && openManagedTasks.length > 0) {
    const focusedStatus = normalizeStatus(focusedTask.state?.status) || focusedTask.status;
    if (!isWfManagedMode(focusedTask.state?.mode) && OPEN_TASK_STATUSES.has(focusedStatus)) {
      errors.push(`Direct task "${activeTask}" cannot replace an open WF-managed focus; close the WF task or focus another WF task.`);
    }
  }

  if (errors.length) {
    return { ok: false, command: 'reconcile', dryRun: true, activeTask, errors, warnings: [], operations: [] };
  }

  const operations = [];
  for (const task of tasks) {
    let normalized = normalizeState(task, activeTask, now);
    if (transition && task.id === transition.taskId) {
      const nextState = { ...normalized.state };
      if (transition.status) nextState.status = normalizeStatus(transition.status);
      if (transition.phase) nextState.phase = normalizePhase(transition.phase);
      if (transition.nextAction) nextState.nextAction = transition.nextAction;
      if (nextState.status === 'active' && !nextState.startedAt) nextState.startedAt = now;
      if (nextState.status === 'closed' && !nextState.closedAt) nextState.closedAt = now;
      if (nextState.status !== 'closed' && nextState.status !== 'archived') nextState.closedAt = null;
      nextState.updatedAt = now;
      if (transition.reopen) {
        nextState.mode = normalizeMode(task.state?.mode) || nextState.mode;
        nextState.closedAt = null;
        nextState.lastRecovery = {
          at: now,
          reason: String(transition.reason || '').trim(),
        };
      }
      normalized = {
        state: nextState,
        changed: JSON.stringify(nextState) !== JSON.stringify(task.state),
        reason: 'apply explicit transition',
      };
    }
    task.desiredState = normalized.state;
    if (normalized.changed) {
      operations.push({
        action: task.state ? 'write-state' : 'create-state',
        taskId: task.id,
        path: `Harness/tasks/${task.id}/STATE.json`,
        reason: normalized.reason,
        state: normalized.state,
      });
    }

    const progressRel = `Harness/tasks/${task.id}/PROGRESS.md`;
    const progressFile = path.join(root, ...progressRel.split('/'));
    const existingProgress = readText(progressFile);
    const desiredProgress = renderTaskProgress(existingProgress, task.id, normalized.state);
    if (desiredProgress !== existingProgress.replace(/\r\n/g, '\n')) {
      operations.push({
        action: 'write-task-progress',
        taskId: task.id,
        path: progressRel,
        reason: 'sync task PROGRESS.md phase from STATE.json',
        text: desiredProgress,
      });
    }
  }

  const rows = buildRows(tasks, activeTask);
  const desiredProgress = renderRootProgress(rootProgress.text, activeTask, rows);
  if (desiredProgress !== rootProgress.text.replace(/\r\n/g, '\n')) {
    operations.push({
      action: 'rewrite-root-progress',
      path: 'Harness/PROGRESS.md',
      reason: 'sync active pointer and Task Index from task state',
      text: desiredProgress,
    });
  }

  return {
    ok: true,
    command: 'reconcile',
    dryRun: !hasFlag('--apply'),
    activeTask,
    errors: [],
    warnings: [],
    operations,
  };
}

function applyOperations(operations) {
  for (const op of operations) {
    if (op.action === 'write-state' || op.action === 'create-state') {
      writeJsonAtomic(path.join(root, ...op.path.split('/')), op.state);
    } else if (op.action === 'rewrite-root-progress' || op.action === 'write-task-progress') {
      writeTextAtomic(path.join(root, ...op.path.split('/')), op.text);
    }
  }
}

function syncTaskViewsForState(taskId, state) {
  const { rootProgress, tasks } = collectTasks();
  const task = tasks.find(item => item.id === taskId);
  if (!task) return;

  task.desiredState = state;
  let activeTask = rootProgress.activeTask;
  const status = normalizeStatus(state.status);
  if (activeTask === taskId && (status === 'closed' || status === 'archived')) activeTask = null;

  const progressFile = path.join(tasksDir, taskId, 'PROGRESS.md');
  const existingProgress = readText(progressFile);
  const desiredProgress = renderTaskProgress(existingProgress, taskId, state);
  if (desiredProgress !== existingProgress.replace(/\r\n/g, '\n')) {
    writeTextAtomic(progressFile, desiredProgress);
  }

  const rows = buildRows(tasks, activeTask);
  const desiredRoot = renderRootProgress(rootProgress.text, activeTask, rows);
  if (desiredRoot !== rootProgress.text.replace(/\r\n/g, '\n')) {
    writeTextAtomic(progressPath, desiredRoot);
  }
  writeTaskIndex();
}

function buildListGraph(expandedTasks) {
  const byId = new Map(expandedTasks.map(t => [t.id, t]));
  const graph = { roots: [], depEdges: [], blockEdges: [], orphanedDeps: [] };

  // Roots: tasks with no dependsOn pointing to other active tasks (or empty dependsOn)
  // Non-roots: tasks whose dependsOn includes at least one other active task
  const hasInternalDep = new Set();
  const incomingBlocks = new Map(); // taskId → who blocks it (for reverse lookup)

  for (const task of expandedTasks) {
    for (const depId of task.dependsOn) {
      if (byId.has(depId)) {
        hasInternalDep.add(task.id);
        graph.depEdges.push({ from: depId, to: task.id });
      } else if (depId) {
        graph.orphanedDeps.push({ task: task.id, missingDep: depId });
      }
    }
    for (const blockId of task.blocks) {
      if (byId.has(blockId)) {
        graph.blockEdges.push({ from: task.id, to: blockId });
      }
      if (!incomingBlocks.has(blockId)) incomingBlocks.set(blockId, []);
      incomingBlocks.get(blockId).push(task.id);
    }
  }

  graph.roots = expandedTasks.filter(t => !hasInternalDep.has(t.id));

  return graph;
}

function taskGroupFor(state) {
  const project = String(state?.project || '').trim();
  const legacyGroup = String(state?.group || '').trim();
  // A migrated legacy capsule may have project="default" while its
  // meaningful grouping still lives in group. Preserve that grouping.
  return (project && project !== 'default') || !legacyGroup
    ? (project || legacyGroup || 'default')
    : legacyGroup;
}

function taskProjectFor(state) {
  return taskGroupFor(state);
}

function taskTagsFor(state) {
  return Array.isArray(state?.tags)
    ? state.tags.map(tag => String(tag).trim()).filter(Boolean)
    : [];
}

function normalizeTags(value) {
  return String(value || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

function taskIndexEntry(task) {
  const state = task.state || {};
  const links = state.links || {};
  const status = normalizeStatus(state.status) || task.status || 'active';
  const lifecycle = lifecycleForState(state, status);
  return {
    id: task.id,
    project: taskProjectFor(state),
    group: taskProjectFor(state),
    title: task.rootRow?.goal || state.goal || state.nextAction || taskTitle(task.id),
    status,
    mode: lifecycle.mode,
    wfManaged: lifecycle.wfManaged,
    resumeRequired: lifecycle.resumeRequired,
    phase: normalizePhase(state.phase) || task.phase || 'intake',
    tags: taskTagsFor(state),
    createdAt: state.createdAt || null,
    startedAt: state.startedAt || null,
    updatedAt: state.updatedAt || null,
    closedAt: state.closedAt || null,
    dependsOn: Array.isArray(links.dependsOn) ? links.dependsOn : [],
    blocks: Array.isArray(links.blocks) ? links.blocks : [],
    path: `Harness/tasks/${task.id}`,
  };
}

// Generate a route revision hash from task state for consistency checks.
// Both root INDEX.json and _archive/INDEX.json share this revision.
function computeRouteRevision() {
  const { rootProgress, tasks } = collectTasks();
  const archived = routeReadArchivedTasks(root);
  const readArchivedState = task => {
    try {
      const relativePath = String(task.path || task.archivePath || '')
        .split(/[\\/]+/)
        .filter(Boolean);
      return JSON.parse(fs.readFileSync(path.join(root, ...relativePath, 'STATE.json'), 'utf8'));
    } catch {
      return null;
    }
  };
  const records = [
    ...tasks.map(task => ({ id: task.id, state: task.state || null })),
    ...archived.map(task => ({ id: task.id, state: readArchivedState(task) })),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const rootRoute = {
    activeTask: rootProgress.activeTask,
    rows: rootProgress.rows.map(({ id, goal, phase, closed }) => ({ id, goal, phase, closed })),
  };
  return createHash('sha256').update(JSON.stringify({ rootRoute, records })).digest('hex').slice(0, 16);
}

function buildTaskIndexModel() {
  const { rootProgress, tasks } = collectTasks();
  const entries = tasks.map(taskIndexEntry).sort((a, b) => a.id.localeCompare(b.id));
  const projects = {};
  for (const task of entries) {
    if (!projects[task.project]) projects[task.project] = [];
    projects[task.project].push(task.id);
  }
  const activeEntry = entries.find(task => task.id === rootProgress.activeTask) || null;
  const resumeTask = activeEntry?.resumeRequired
    ? {
        taskId: activeEntry.id,
        mode: activeEntry.mode,
        status: activeEntry.status,
        project: activeEntry.project,
      }
    : null;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    routeRevision: computeRouteRevision(),
    sourceOfTruth: 'Harness/tasks/*/STATE.json',
    activeTask: rootProgress.activeTask,
    resumeTask,
    resumeRequired: Boolean(resumeTask),
    projects,
    tasks: entries,
  };
}

function renderTaskIndexMd(model) {
  const lines = [
    '# Task Index (generated)',
    '',
    `Generated: ${model.generatedAt}`,
    '',
    'This file is derived from task STATE.json files. Do not edit it directly.',
    '',
    '| Task | Project | Status | Mode | Phase | Created | Updated |',
    '|------|---------|--------|------|-------|---------|---------|',
  ];
  for (const task of model.tasks) {
    lines.push(`| \`${task.id}\` | ${task.project} | ${task.status} | ${task.mode} | ${task.phase} | ${String(task.createdAt || '-').slice(0, 10)} | ${String(task.updatedAt || '-').slice(0, 10)} |`);
  }
  lines.push('', '## Projects', '');
  for (const [project, ids] of Object.entries(model.projects).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- **${project}**: ${ids.map(id => `\`${id}\``).join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

function writeTaskIndex() {
  const model = buildTaskIndexModel();
  writeJsonAtomic(path.join(tasksDir, 'INDEX.json'), model);
  writeTextAtomic(path.join(tasksDir, 'INDEX.md'), renderTaskIndexMd(model));
  // The same state revision is published by live and archive indexes. Any
  // live route change therefore refreshes both views, not only the live one.
  refreshArchiveIndexJson();
  return model;
}

function taskSearchText(task) {
  const files = ['PLAN.md', 'PROGRESS.md', 'PROBLEM.md', 'REFERENCES.md'];
  const stateText = JSON.stringify(task.state || {});
  const fileText = files.map(file => readText(path.join(task.path, file))).join('\n');
  return `${task.id}\n${stateText}\n${fileText}`.toLowerCase();
}

function runList() {
  const { rootProgress, tasks } = collectTasks();
  const groupFilter = flagValue('--group');
  const projectFilter = flagValue('--project') || groupFilter;
  const statusFilter = flagValue('--status');

  const expandedTasks = tasks.map(task => {
    const state = task.state || {};
    const links = state.links || {};
    const status = normalizeStatus(state.status) || task.status;
    const lifecycle = lifecycleForState(state, status);
    return {
      id: task.id,
      status,
      mode: lifecycle.mode,
      wfManaged: lifecycle.wfManaged,
      resumeRequired: lifecycle.resumeRequired,
      phase: normalizePhase(state.phase) || task.phase,
      rootPhase: task.rootPhase,
      progressPhase: task.progressPhase,
      project: taskProjectFor(state),
      group: taskProjectFor(state),
      tags: taskTagsFor(state),
      createdAt: state.createdAt || null,
      startedAt: state.startedAt || null,
      updatedAt: state.updatedAt || null,
      closedAt: state.closedAt || null,
      dependsOn: Array.isArray(links.dependsOn) ? links.dependsOn : [],
      blocks: Array.isArray(links.blocks) ? links.blocks : [],
      statusDisplay: status || '-',
      openTasks: OPEN_TASK_STATUSES.has(status),
      nextAction: state.nextAction || null,
      archive: (state ? archiveEligibility(task, rootProgress.activeTask) : { ok: false, reason: 'no state' }),
    };
  });

  const normalizedStatusFilter = statusFilter ? normalizeStatus(statusFilter) : null;
  if (statusFilter && !normalizedStatusFilter) {
    finish({
      ok: false,
      command: 'list',
      errors: [`Invalid status filter "${statusFilter}". Valid: active, blocked, closed (legacy aliases accepted)`],
      warnings: [],
      tasks: [],
    }, 1);
    return;
  }
  const selectedTasks = projectFilter
    ? expandedTasks.filter(task => task.project === projectFilter)
    : expandedTasks;
  const statusTasks = normalizedStatusFilter
    ? selectedTasks.filter(task => task.status === normalizedStatusFilter)
    : selectedTasks;

  let groups = null;
  if (hasFlag('--by-group')) {
    const byName = new Map();
    for (const task of statusTasks) {
      if (!byName.has(task.group)) byName.set(task.group, []);
      byName.get(task.group).push(task);
    }
    groups = [...byName.entries()]
      .map(([group, groupTasks]) => ({ group, tasks: groupTasks }))
      .sort((a, b) => (a.group === 'default' ? 1 : 0) - (b.group === 'default' ? 1 : 0) || a.group.localeCompare(b.group));
  }

  const graph = buildListGraph(statusTasks);

  const payload = {
    ok: true,
    command: 'list',
    taskCount: statusTasks.length,
    activeTask: rootProgress.activeTask,
    groupFilter: groupFilter || null,
    projectFilter: projectFilter || null,
    statusFilter: normalizedStatusFilter,
    tasks: statusTasks,
    groups,
    graph: {
      roots: graph.roots.map(t => t.id),
      depEdges: graph.depEdges,
      blockEdges: graph.blockEdges,
      orphanedDeps: graph.orphanedDeps,
    },
    errors: [],
    warnings: [],
  };
  finish(payload, 0);
}

function runIndex() {
  const model = writeTaskIndex();
  finish({
    ok: true,
    command: 'index',
    path: 'Harness/tasks/INDEX.json',
    markdownPath: 'Harness/tasks/INDEX.md',
    generatedAt: model.generatedAt,
    projectCount: Object.keys(model.projects).length,
    taskCount: model.tasks.length,
    projects: model.projects,
    warnings: [],
  }, 0);
}

function runQuery() {
  const keyword = flagValue('--keyword') || findTaskIdArg(1);
  const projectFilter = flagValue('--project') || flagValue('--group');
  const statusFilter = flagValue('--status');
  const normalizedStatusFilter = statusFilter ? normalizeStatus(statusFilter) : null;
  if (statusFilter && !normalizedStatusFilter) {
    finish({
      ok: false,
      command: 'query',
      errors: [`Invalid status filter "${statusFilter}". Valid: active, blocked, closed (legacy aliases accepted)`],
      warnings: [],
      results: [],
    }, 1);
    return;
  }
  if (!keyword) {
    finish({ ok: false, command: 'query', errors: ['query requires <keyword> or --keyword <text>'], warnings: [], results: [] }, 1);
    return;
  }

  const needle = String(keyword).trim().toLowerCase();
  const { tasks } = collectTasks();
  const results = tasks
    .filter(task => {
      const status = normalizeStatus(task.state?.status) || task.status;
      if (projectFilter && taskProjectFor(task.state) !== projectFilter) return false;
      if (normalizedStatusFilter && status !== normalizedStatusFilter) return false;
      return taskSearchText(task).includes(needle);
    })
    .map(task => {
      const entry = taskIndexEntry(task);
      const hits = [];
      for (const file of ['PLAN.md', 'PROGRESS.md', 'PROBLEM.md', 'REFERENCES.md', 'STATE.json']) {
        const content = readText(path.join(task.path, file));
        const lines = content.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
          if (lines[index].toLowerCase().includes(needle)) {
            hits.push({ file, line: index + 1, snippet: lines[index].trim().slice(0, 160) });
          }
        }
      }
      return { ...entry, hits };
    });

  finish({
    ok: true,
    command: 'query',
    keyword,
    projectFilter: projectFilter || null,
    statusFilter: normalizedStatusFilter,
    count: results.length,
    results,
    warnings: [],
  }, 0);
}

function runValidate() {
  const payload = validateState({ strict: hasFlag('--strict') });
  finish(payload, payload.ok ? 0 : 1);
}

function runReconcile(overrides = {}) {
  const plan = buildReconcilePlan(overrides);
  if (overrides.commandLabel) plan.command = overrides.commandLabel;
  if (plan.ok && hasFlag('--apply')) {
    applyOperations(plan.operations);
    writeTaskIndex();
    plan.dryRun = false;
  }
  finish(plan, plan.ok ? 0 : 1);
}

function runSetActive() {
  const taskId = args[1];
  try {
    ensureValidTaskId(taskId);
  } catch (err) {
    finish({ ok: false, command: 'set-active', errors: [err.message], warnings: [], operations: [] }, 1);
  }
  const { tasks } = collectTasks();
  const task = tasks.find(item => item.id === taskId);
  const status = normalizeStatus(task?.state?.status) || task?.status;
  if (status === 'closed' || status === 'archived') {
    finish({
      ok: false,
      command: 'set-active',
      errors: [`Cannot set closed task "${taskId}" as active focus.`],
      warnings: [],
      operations: [],
    }, 1);
  }
  const openManagedTasks = tasks.filter(item => {
    const itemStatus = normalizeStatus(item.state?.status) || item.status;
    return isWfManagedMode(item.state?.mode) && OPEN_TASK_STATUSES.has(itemStatus);
  });
  if (openManagedTasks.length > 0 && !isWfManagedMode(task?.state?.mode)) {
    finish({
      ok: false,
      command: 'set-active',
      errors: [`Direct task "${taskId}" cannot replace an open WF-managed focus; close the WF task or focus another WF task.`],
      warnings: [],
      operations: [],
    }, 1);
  }
  const previousApply = hasFlag('--apply');
  if (!previousApply && !hasFlag('--dry-run')) args.push('--apply');
  runReconcile({ activeOverride: taskId, commandLabel: 'set-active' });
}

function runTransition() {
  const taskId = args[1];
  try {
    ensureValidTaskId(taskId);
  } catch (err) {
    finish({ ok: false, command: 'transition', errors: [err.message], warnings: [], operations: [] }, 1);
  }
  const status = flagValue('--status');
  const phase = flagValue('--phase');
  const nextAction = flagValue('--next');
  const reopen = hasFlag('--reopen');
  const reason = String(flagValue('--note') || '').trim();
  if (reopen && !reason) {
    finish({ ok: false, command: 'transition', errors: ['--reopen requires a non-empty --note "reason"'], warnings: [], operations: [] }, 1);
  }
  if (!status && !phase && !nextAction && !reopen) {
    finish({ ok: false, command: 'transition', errors: ['transition requires --status, --phase, --next, or --reopen'], warnings: [], operations: [] }, 1);
  }
  if (reopen) {
    const liveStatePath = path.join(tasksDir, taskId, 'STATE.json');
    if (!fs.existsSync(liveStatePath)) {
      let foundInArchive = false;
      if (fs.existsSync(archiveDir)) {
        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (entry.name === taskId && fs.existsSync(path.join(full, 'STATE.json'))) { foundInArchive = true; return; }
              if (!foundInArchive) walk(full);
            }
          }
        };
        walk(archiveDir);
      }
      finish({
        ok: false, command: 'transition',
        errors: [foundInArchive
          ? `Archived task "${taskId}" cannot be reopened; archive is a terminal state. Use history commands to inspect it.`
          : `Task "${taskId}" not found under Harness/tasks/ or Harness/tasks/_archive/; --reopen only targets live, closed WF-managed tasks.`],
        warnings: [], operations: [],
      }, 1);
      return;
    }
  }
  if (!hasFlag('--apply') && !hasFlag('--dry-run')) args.push('--apply');
  runReconcile({ commandLabel: 'transition', transition: { taskId, status, phase, nextAction, reopen: reopen ? true : null, reason: reason || null } });
}

function buildArchivePlan() {
  const keepValue = Number.parseInt(flagValue('--keep', String(LEGACY_ARCHIVE_KEEP_DEFAULT)), 10);
  if (!Number.isInteger(keepValue) || keepValue < 0) {
    return { ok: false, command: 'archive', errors: ['--keep must be a non-negative integer'], warnings: [], results: [] };
  }

  const taskFilter = flagValue('--task');
  if (taskFilter) {
    try {
      ensureValidTaskId(taskFilter);
    } catch (err) {
      return { ok: false, command: 'archive', errors: [err.message], warnings: [], results: [] };
    }
  }

  const groupFilter = flagValue('--group');
  if (taskFilter && groupFilter) {
    return { ok: false, command: 'archive', errors: ['archive accepts either --task <id> or --group <tag>, not both'], warnings: [], results: [] };
  }

  const { rootProgress, tasks } = collectTasks();
  const selectedTasks = taskFilter
    ? tasks.filter(task => task.id === taskFilter)
    : groupFilter
    ? tasks.filter(task => taskGroupFor(task.state) === groupFilter)
    : tasks;
  if (taskFilter && selectedTasks.length === 0) {
    return { ok: false, command: 'archive', errors: [`Task "${taskFilter}" not found in Harness/tasks/`], warnings: [], results: [] };
  }
  if (groupFilter && selectedTasks.length === 0) {
    return { ok: false, command: 'archive', errors: [`Group "${groupFilter}" not found in Harness/tasks/`], warnings: [], results: [] };
  }

  const archiveable = [];
  const skipped = [];
  for (const task of selectedTasks) {
    const eligibility = archiveEligibility(task, rootProgress.activeTask);
    if (eligibility.ok) archiveable.push(task);
    else skipped.push({ task, reason: eligibility.reason });
  }

  const dryRun = !hasFlag('--apply');
  const explicitTrigger = dryRun === false && !taskFilter && !groupFilter;
  archiveable.sort((a, b) => a.mtimeMs - b.mtimeMs || a.id.localeCompare(b.id));

  // Explicit user trigger (no --task/--group filter, with --apply): archive ALL eligible tasks.
  // Explicit --task targets the selected eligible task in both dry-run and apply.
  // Explicit --group is a batch op that archives every eligible task in the tag (implies apply).
  // Auto/scheduled/dry-run: only archive tasks exceeding --keep cap.
  const toArchiveCount = taskFilter || groupFilter
    ? archiveable.length
    : explicitTrigger
    ? archiveable.length
    : Math.max(0, tasks.length - keepValue);
  const toArchive = archiveable.slice(0, toArchiveCount);
  const toArchiveIds = new Set(toArchive.map(task => task.id));
  const keptArchiveable = archiveable.filter(task => !toArchiveIds.has(task.id));

  const errors = [];
  for (const task of toArchive) {
    const mtime = new Date(task.mtimeMs);
    const year = mtime.getFullYear().toString();
    const month = String(mtime.getMonth() + 1).padStart(2, '0');
    const day = String(mtime.getDate()).padStart(2, '0');
    const dest = safeTaskPath('_archive', year, month, day, task.id);
    const relPath = `_archive/${year}/${month}/${day}/${task.id}`;
    if (fs.existsSync(dest)) errors.push(`Archive destination already exists: Harness/tasks/${relPath}`);
  }
  if (errors.length) {
    return { ok: false, command: 'archive', errors, warnings: [], results: [] };
  }

  function dateParts(ts) {
    const d = new Date(ts);
    return {
      year: d.getFullYear().toString(),
      month: String(d.getMonth() + 1).padStart(2, '0'),
      day: String(d.getDate()).padStart(2, '0'),
      path: `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
    };
  }

  const results = [
    ...toArchive.map(task => ({
      dir: task.id,
      ...dateParts(task.mtimeMs),
      action: hasFlag('--apply') ? 'archived' : 'would-archive',
      status: hasFlag('--apply')
        ? (groupFilter ? `group "${groupFilter}": batch archive` : explicitTrigger ? 'explicit --apply: all eligible' : 'moved')
        : (taskFilter ? 'dry-run' : groupFilter ? `dry-run (group "${groupFilter}")` : `dry-run (${toArchiveCount} of ${archiveable.length} eligible)`),
    })),
    ...keptArchiveable.map(task => ({
      dir: task.id,
      ...dateParts(task.mtimeMs),
      action: 'kept',
      status: `kept by --keep ${keepValue}`,
    })),
    ...skipped.map(({ task, reason }) => ({
      dir: task.id,
      year: null,
      month: null,
      day: null,
      path: null,
      action: 'skipped',
      status: reason,
    })),
  ];

  return {
    ok: true,
    command: 'archive',
    dryRun: !hasFlag('--apply'),
    group: groupFilter || null,
    keep: keepValue,
    scanned: selectedTasks.length,
    archiveable: archiveable.length,
    toArchive: toArchive.length,
    kept: keptArchiveable.length,
    skipped: skipped.length,
    errors: [],
    warnings: [],
    results,
    toArchiveIds,
    tasks,
    rootProgress,
    graphGenerated: hasFlag('--apply') && archiveable.length > 0,
  };
}

function buildArchiveGraphIndex() {
  // Walk _archive/YYYY/MM/DD/task-id/ for all archived tasks
  const allArchived = [];
  if (fs.existsSync(archiveDir)) {
    const yearDirs = fs.readdirSync(archiveDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^\d{4}$/.test(e.name))
      .map(e => e.name).sort();
    for (const year of yearDirs) {
      const yearPath = path.join(archiveDir, year);
      const monthDirs = fs.readdirSync(yearPath, { withFileTypes: true })
        .filter(e => e.isDirectory() && /^\d{2}$/.test(e.name))
        .map(e => e.name).sort();
      for (const month of monthDirs) {
        const monthPath = path.join(yearPath, month);
        const dayDirs = fs.readdirSync(monthPath, { withFileTypes: true })
          .filter(e => e.isDirectory() && /^\d{2}$/.test(e.name))
          .map(e => e.name).sort();
        for (const day of dayDirs) {
          const dayPath = path.join(monthPath, day);
          const taskDirs = fs.readdirSync(dayPath, { withFileTypes: true })
            .filter(e => e.isDirectory()).map(e => e.name);
          for (const taskId of taskDirs) {
            const statePath = path.join(dayPath, taskId, 'STATE.json');
            const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
            const planPath = path.join(dayPath, taskId, 'PLAN.md');
            const planText = fs.existsSync(planPath) ? fs.readFileSync(planPath, 'utf8') : '';
            const progressPath2 = path.join(dayPath, taskId, 'PROGRESS.md');
            const progressText = fs.existsSync(progressPath2) ? fs.readFileSync(progressPath2, 'utf8') : '';
            allArchived.push({ id: taskId, year, month, day, state, planText, progressText });
          }
        }
      }
    }
  }

  if (allArchived.length === 0) return null;

  const byId = new Map(allArchived.map(t => [t.id, t]));
  const graphLines = [];
  graphLines.push('## Task Graph\n');

  // Identify root tasks (no dependsOn, or all dependsOn are archived but not in this set)
  const hasDep = new Set();
  for (const task of allArchived) {
    const deps = task.state?.links?.dependsOn || [];
    for (const depId of deps) {
      if (byId.has(depId)) hasDep.add(task.id);
    }
  }

  // Root tasks
  const roots = allArchived.filter(t => !hasDep.has(t.id));
  if (roots.length > 0) {
    graphLines.push('### Roots (no dependencies)');
    for (const task of roots) {
      const deps = (task.state?.links?.dependsOn || []).map(id => `\`${id}\``).join(', ') || 'none';
      const blocks = (task.state?.links?.blocks || []).map(id => `\`${id}\``).join(', ') || 'none';
      graphLines.push(`- \`${task.id}\` → blocks: ${blocks}`);
    }
  }

  // Build dependency chains
  const visited = new Set();
  function chainLines(taskId, indent) {
    if (visited.has(taskId)) return [];
    visited.add(taskId);
    const task = byId.get(taskId);
    if (!task) return [];
    const deps = task.state?.links?.dependsOn || [];
    const lines = [];
    if (deps.length > 0) {
      const depList = deps.map(depId => {
        const depTask = byId.get(depId);
        return depTask
          ? `[\`${depId}\`](#${depId.toLowerCase().replace(/-/g, '')})`
          : `\`${depId}\``;
      }).join(' → ');
      lines.push(`${indent}- \`${taskId}\` ← depends on: ${depList}`);
    } else {
      lines.push(`${indent}- \`${taskId}\``);
    }
    for (const depId of deps) {
      lines.push(...chainLines(depId, indent + '  '));
    }
    return lines;
  }

  // Show dependency relationships
  const depGraph = [];
  for (const task of allArchived) {
    const deps = task.state?.links?.dependsOn || [];
    for (const depId of deps) {
      if (byId.has(depId)) {
        depGraph.push({ from: depId, to: task.id });
      }
    }
  }

  if (depGraph.length > 0) {
    graphLines.push('\n### Dependencies');
    graphLines.push('```\n' + depGraph.map(e => `  ${e.from}  ──▶  ${e.to}`).join('\n') + '\n```\n');
    graphLines.push('| From | To |');
    graphLines.push('|------|----|');
    for (const e of depGraph) {
      graphLines.push(`| \`${e.from}\` | \`${e.to}\` |`);
    }
  }

  // Blocks relationships
  const blocksGraph = [];
  for (const task of allArchived) {
    const blocks = task.state?.links?.blocks || [];
    for (const blockId of blocks) {
      if (byId.has(blockId)) {
        blocksGraph.push({ from: task.id, to: blockId });
      }
    }
  }
  if (blocksGraph.length > 0) {
    graphLines.push('\n### Blocks (completion triggers)');
    graphLines.push('| Task | Unblocks |');
    graphLines.push('|------|----------|');
    for (const e of blocksGraph) {
      graphLines.push(`| \`${e.from}\` | \`${e.to}\` |`);
    }
  }

  // Per-task detail section
  graphLines.push('\n## Task Details\n');
  const detailOrder = allArchived.slice().sort((a, b) => {
    if (a.year !== b.year) return b.year.localeCompare(a.year);
    if (a.month !== b.month) return b.month.localeCompare(a.month);
    if (a.day !== b.day) return b.day.localeCompare(a.day);
    return a.id.localeCompare(b.id);
  });
  for (const task of detailOrder) {
    const anchor = task.id.toLowerCase().replace(/-/g, '');
    const phase = task.state?.phase || '-';
    const status = task.state?.status || '-';
    const goal = (task.planText.match(/^## Goal\s*\n+([\s\S]*?)(?=\n## |$)/mi) || ['', ''])[1].trim().slice(0, 120) || (task.state?.nextAction || '-');
    const deps = (task.state?.links?.dependsOn || []).join(', ') || '-';
    const blocks = (task.state?.links?.blocks || []).join(', ') || '-';
    graphLines.push(`### \`${task.id}\` {#${anchor}}`);
    graphLines.push(`- **Archived:** ${task.year}/${task.month}/${task.day}`);
    graphLines.push(`- **Status:** ${status}  **Phase:** ${phase}`);
    graphLines.push(`- **Goal:** ${goal.slice(0, 120)}${goal !== '-' && goal.length >= 120 ? '...' : ''}`);
    graphLines.push(`- **Depends on:** ${deps}  **Blocks:** ${blocks}`);
  }

  return graphLines.join('\n');
}

function appendArchiveIndex(entries, graphContent) {
  if (entries.length === 0 && !graphContent) return;
  const indexPath = path.join(archiveDir, 'INDEX.md');
  const date = new Date().toISOString().slice(0, 10);

  let existing = '';
  if (fs.existsSync(indexPath)) {
    const raw = fs.readFileSync(indexPath, 'utf8');
    // Strip old graph section if present so we regenerate fresh
    const graphStart = raw.indexOf('\n## Task Graph\n');
    existing = graphStart >= 0 ? raw.slice(0, graphStart).trimEnd() : raw.trimEnd();
  }
  if (existing && !existing.endsWith('\n')) existing += '\n';

  const lines = [];
  lines.push(existing);
  if (entries.length > 0) {
    if (!existing || !existing.includes('| Task | Path | Archived |')) {
      lines.push('| Task | Path | Archived |');
      lines.push('|------|------|----------|');
    }
    for (const entry of entries) {
      const entryPath = `${entry.year}/${entry.month}/${entry.day}`;
      lines.push(`| \`${entry.id}\` | ${entryPath} | ${date} |`);
    }
  }

  if (graphContent) {
    lines.push('');
    lines.push(graphContent);
  }

  writeTextAtomic(indexPath, lines.join('\n') + '\n');
}

const ARCHIVE_ROUTE_FILES = [
  progressPath,
  path.join(tasksDir, 'INDEX.json'),
  path.join(tasksDir, 'INDEX.md'),
  path.join(archiveDir, 'INDEX.md'),
  path.join(archiveDir, 'INDEX.json'),
];

function capturePathSnapshot(target) {
  if (!fs.existsSync(target) && !fs.lstatSync(target, { throwIfNoEntry: false })) return { type: 'missing' };
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return { type: 'symlink', link: fs.readlinkSync(target) };
  if (stat.isDirectory()) {
    const entries = {};
    for (const name of fs.readdirSync(target).sort()) entries[name] = capturePathSnapshot(path.join(target, name));
    return { type: 'directory', entries };
  }
  return { type: 'file', data: fs.readFileSync(target).toString('base64') };
}

function restorePathSnapshot(target, snapshot) {
  fs.rmSync(target, { recursive: true, force: true });
  if (snapshot.type === 'missing') return;
  if (snapshot.type === 'directory') {
    fs.mkdirSync(target, { recursive: true });
    for (const [name, entry] of Object.entries(snapshot.entries)) restorePathSnapshot(path.join(target, name), entry);
  } else if (snapshot.type === 'file') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(snapshot.data, 'base64'));
  } else if (snapshot.type === 'symlink') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(snapshot.link, target);
  }
}

function captureArchiveRouteSnapshots() {
  return ARCHIVE_ROUTE_FILES.map(file => ({ file, snapshot: capturePathSnapshot(file) }));
}

function restoreArchiveRouteSnapshots(snapshots) {
  const errors = [];
  for (const { file, snapshot } of snapshots) {
    try { restorePathSnapshot(file, snapshot); }
    catch (err) { errors.push(`${file}: ${err.message}`); }
  }
  return errors;
}

function rollbackArchiveMoves(moves) {
  const errors = [];
  for (const move of [...moves].reverse()) {
    try {
      const dest = safeTaskPath(...move.archivePath.split('/'));
      const src = safeTaskPath(move.taskId);
      fs.renameSync(dest, src);
      const statePath = path.join(src, 'STATE.json');
      if (move.originalStateRaw === null) fs.rmSync(statePath, { force: true });
      else fs.writeFileSync(statePath, move.originalStateRaw, 'utf8');
      const progressFile = path.join(src, 'PROGRESS.md');
      if (move.originalProgressRaw === null) fs.rmSync(progressFile, { force: true });
      else fs.writeFileSync(progressFile, move.originalProgressRaw, 'utf8');
    } catch (err) {
      errors.push(`${move.taskId}: ${err.message}`);
    }
  }
  return errors;
}

function archiveTasksTransaction(candidates) {
  const snapshots = captureArchiveRouteSnapshots();
  const moves = [];
  let failure = null;
  for (const candidate of candidates) {
    const moved = performSafeArchive(candidate, candidate.mtimeMs);
    if (!moved.ok) {
      failure = `${candidate.id}: ${moved.error}`;
      break;
    }
    moves.push(moved);
    const movedProgressPath = path.join(safeTaskPath(...moved.archivePath.split('/')), 'PROGRESS.md');
    try {
      if (fs.existsSync(movedProgressPath)) {
        const movedState = JSON.parse(fs.readFileSync(path.join(path.dirname(movedProgressPath), 'STATE.json'), 'utf8'));
        writeTextAtomic(movedProgressPath, renderTaskProgress(readText(movedProgressPath), candidate.id, movedState));
      }
    } catch (err) {
      failure = `${candidate.id}: failed to update archived progress: ${err.message}`;
      break;
    }
  }

  if (!failure) {
    try {
      const { rootProgress, tasks } = collectTasks();
      const rows = buildRows(tasks, rootProgress.activeTask);
      writeTextAtomic(progressPath, renderRootProgress(rootProgress.text, rootProgress.activeTask, rows));
      writeTaskIndex();
      const entries = moves.map(move => {
        const [, year, month, day] = move.archivePath.split('/');
        return { id: move.taskId, year, month, day };
      });
      appendArchiveIndex(entries, buildArchiveGraphIndex());
      refreshArchiveIndexJson();
      return { ok: true, moves };
    } catch (err) {
      failure = `route index refresh failed: ${err.message}`;
    }
  }

  const rollbackErrors = rollbackArchiveMoves(moves);
  const restoreErrors = restoreArchiveRouteSnapshots(snapshots);
  return {
    ok: false,
    moves,
    error: [failure, ...rollbackErrors.map(error => `rollback failed: ${error}`), ...restoreErrors.map(error => `index restore failed: ${error}`)].join('; '),
  };
}

function runArchive() {
  // --group is a confirmation-less batch op: it implies --apply unless --dry-run is given.
  if (hasFlag('--group') && !hasFlag('--apply') && !hasFlag('--dry-run')) args.push('--apply');
  const plan = buildArchivePlan();
  if (!plan.ok) finish(plan, 1);

  if (hasFlag('--apply')) {
    const candidates = plan.results.filter(result => result.action === 'archived').map(result => ({
      id: result.dir,
      mtimeMs: new Date(result.year, result.month - 1, result.day).getTime(),
    }));
    const transaction = archiveTasksTransaction(candidates);
    if (!transaction.ok) {
      const reason = transaction.error || 'archive transaction failed';
      for (const result of plan.results.filter(result => result.action === 'archived')) {
        result.action = 'failed';
        result.status = 'failed';
        result.reason = reason;
      }
      finish({ ok: false, command: 'archive', errors: [reason], warnings: [], results: plan.results }, 1);
      return;
    }
    plan.dryRun = false;
  }

  delete plan.tasks;
  delete plan.rootProgress;
  delete plan.toArchiveIds;
  finish(plan, 0);
}

// Shared archive move primitive. Both runArchive() and runAutoArchive()
// delegate here to ensure a single write surface for capsule moves.
// Returns { ok, taskId, archivePath, error? }.
function performSafeArchive(task, mtimeMs) {
  const mtime = new Date(mtimeMs);
  const year = mtime.getFullYear().toString();
  const month = String(mtime.getMonth() + 1).padStart(2, '0');
  const day = String(mtime.getDate()).padStart(2, '0');
  const destDir = safeTaskPath('_archive', year, month, day);
  const dest = safeTaskPath('_archive', year, month, day, task.id);
  const src = safeTaskPath(task.id);
  if (fs.existsSync(dest)) {
    return { ok: false, taskId: task.id, error: `archive destination already exists: ${dest}` };
  }
  const originalStateRaw = fs.existsSync(path.join(src, 'STATE.json'))
    ? fs.readFileSync(path.join(src, 'STATE.json'), 'utf8')
    : null;
  const originalProgressRaw = fs.existsSync(path.join(src, 'PROGRESS.md'))
    ? fs.readFileSync(path.join(src, 'PROGRESS.md'), 'utf8')
    : null;
  let moved = false;
  try {
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(src, dest);
    moved = true;
    const movedStatePath = path.join(dest, 'STATE.json');
    const movedState = fs.existsSync(movedStatePath)
      ? JSON.parse(fs.readFileSync(movedStatePath, 'utf8'))
      : defaultState(task.id, 'archived', 'archived', new Date().toISOString());
    movedState.status = 'archived';
    movedState.phase = 'archived';
    movedState.updatedAt = new Date().toISOString();
    if (!movedState.closedAt) movedState.closedAt = movedState.updatedAt;
    movedState.archiveEligibleAt = movedState.updatedAt;
    writeJsonAtomic(movedStatePath, movedState);
    return {
      ok: true,
      taskId: task.id,
      archivePath: `_archive/${year}/${month}/${day}/${task.id}`,
      originalStateRaw,
      originalProgressRaw,
    };
  } catch (err) {
    let rollbackError = null;
    if (moved) {
      try {
        fs.renameSync(dest, src);
        if (originalStateRaw === null) fs.rmSync(path.join(src, 'STATE.json'), { force: true });
        else fs.writeFileSync(path.join(src, 'STATE.json'), originalStateRaw, 'utf8');
        if (originalProgressRaw === null) fs.rmSync(path.join(src, 'PROGRESS.md'), { force: true });
        else fs.writeFileSync(path.join(src, 'PROGRESS.md'), originalProgressRaw, 'utf8');
      } catch (rollbackErr) {
        rollbackError = `; rollback failed: ${rollbackErr.message}`;
      }
    }
    return { ok: false, taskId: task.id, error: `${err.message}${rollbackError || ''}` };
  }
}

// W4: safe auto-archive via existing task-state archive primitives.
// Closed tasks only. Idempotent. atomic move. Failure does not corrupt the original.
// Uses archiveEligibility (already in task-state.mjs) to decide eligibility,
// then moves the capsule and refreshes every route index transactionally.
function runAutoArchive() {
  const taskFilter = flagValue('--task');
  if (taskFilter) {
    try {
      ensureValidTaskId(taskFilter);
    } catch (err) {
      finish({ ok: false, command: 'auto-archive', errors: [err.message], warnings: [], results: [] }, 1);
      return;
    }
  }
  const dryRun = !hasFlag('--apply');
  const { rootProgress, tasks } = collectTasks();
  const selected = taskFilter ? tasks.filter(t => t.id === taskFilter) : tasks;
  if (taskFilter && selected.length === 0) {
    // Task not in live; check if it is already archived.
    const archivedPath = findArchivedTask(taskFilter);
    if (archivedPath) {
      finish({
        ok: true,
        command: 'auto-archive',
        dryRun,
        scanned: 1,
        eligible: 1,
        toArchive: 0,
        errors: [],
        warnings: [],
        results: [{ taskId: taskFilter, action: 'skipped', status: 'already-archived', archivePath: archivedPath }],
      }, 0);
      return;
    }
    finish({
      ok: false,
      command: 'auto-archive',
      dryRun,
      scanned: 0,
      eligible: 0,
      toArchive: 0,
      errors: [`Task "${taskFilter}" not found in Harness/tasks/ or _archive/`],
      warnings: [],
      results: [],
    }, 1);
    return;
  }
  const results = [];
  let eligible = 0;
  let toArchive = 0;
  const toArchiveIds = new Set();
  for (const task of selected) {
    const eligibility = archiveEligibility(task, rootProgress.activeTask);
    if (!eligibility.ok) {
      results.push({ taskId: task.id, action: 'skipped', status: 'rejected', reason: eligibility.reason });
      continue;
    }
    eligible += 1;
    // Check if already archived (idempotent no-op).
    const alreadyArchived = fs.existsSync(safeTaskPath('_archive')) && findArchivedTask(task.id);
    if (alreadyArchived) {
      results.push({ taskId: task.id, action: 'skipped', status: 'already-archived', archivePath: alreadyArchived });
      continue;
    }
    toArchiveIds.add(task.id);
    if (dryRun) {
      results.push({ taskId: task.id, action: 'would-archive', status: 'would-archive' });
      toArchive += 1;
      continue;
    }
    results.push({ taskId: task.id, action: 'pending', status: 'pending' });
    toArchive += 1;
  }

  // Move selected capsules and refresh all route surfaces as one recoverable batch.
  if (!dryRun && toArchive > 0) {
    const candidates = selected.filter(task => toArchiveIds.has(task.id));
    const transaction = archiveTasksTransaction(candidates);
    if (transaction.ok) {
      const byId = new Map(transaction.moves.map(move => [move.taskId, move]));
      for (const result of results.filter(item => item.action === 'pending')) {
        const move = byId.get(result.taskId);
        result.action = 'archived';
        result.status = 'archived';
        result.archivePath = move.archivePath;
      }
    } else {
      for (const result of results.filter(item => item.action === 'pending')) {
        result.action = 'failed';
        result.status = 'failed';
        result.reason = transaction.error;
      }
    }
  }

  const failed = results.filter(r => r.action === 'failed');
  const ok = failed.length === 0;
  finish({
    ok,
    command: 'auto-archive',
    dryRun,
    scanned: selected.length,
    eligible,
    toArchive,
    errors: failed.map(r => r.reason),
    warnings: [],
    results,
  }, ok ? 0 : 1);
}

// Route command: resolve a task's route by id (live or archived).
// Returns minimal route stub without leaking full context/PLAN/logs.
function runRoute() {
  const taskId = flagValue('--task') || args[1];
  if (!taskId) {
    finish({ ok: false, command: 'route', errors: ['route requires --task <id>'], warnings: [], route: null }, 1);
    return;
  }
  try {
    const route = routeResolveRoute(root, taskId);
    if (!route.ok) {
      finish({ ok: false, command: 'route', errors: ['Task not found'], warnings: [], route: null }, 1);
      return;
    }
    const stub = routeBuildRouteStub(root, taskId);
    const resume = routeBuildResumeSummary(root, taskId);
    const boundedRoute = boundRouteForOutput({
      id: stub.id,
      title: stub.title,
      status: stub.status,
      phase: stub.phase,
      summary: stub.summary,
      blockers: stub.blockers,
      dependsOn: stub.dependsOn,
      blocks: stub.blocks,
      path: stub.path,
      archivePath: stub.archivePath,
      archived: stub.archived,
      updatedAt: stub.updatedAt,
      nextAction: resume.nextAction,
      activeQuestion: resume.activeQuestion,
      queues: resume.queues,
    });
    finish({
      ok: true,
      command: 'route',
      route: boundedRoute,
      warnings: [],
    }, 0);
  } catch (err) {
    finish({ ok: false, command: 'route', errors: ['Task not found or route ID invalid'], warnings: [], route: null }, 1);
  }
}

function boundRouteForOutput(route) {
  const clip = (value, maxLength) => value == null ? value : String(value).slice(0, maxLength);
  const clipList = (value, maxItems = 2, maxLength = 32) => (Array.isArray(value) ? value : [])
    .slice(0, maxItems)
    .map(item => {
      if (item == null || typeof item === 'boolean' || typeof item === 'number') return item;
      if (typeof item === 'string') return clip(item, maxLength);
      let serialized;
      try { serialized = JSON.stringify(item); } catch { serialized = String(item); }
      return clip(serialized ?? String(item), maxLength);
    });
  return {
    id: clip(route.id, 64),
    title: clip(route.title, 60),
    status: clip(route.status, 24),
    phase: clip(route.phase, 24),
    summary: clip(route.summary, 80),
    blockers: clipList(route.blockers),
    dependsOn: clipList(route.dependsOn),
    blocks: clipList(route.blocks),
    path: clip(route.path, 80),
    archivePath: clip(route.archivePath, 80),
    archived: Boolean(route.archived),
    updatedAt: clip(route.updatedAt, 40),
    nextAction: clip(route.nextAction, 80),
    activeQuestion: clip(route.activeQuestion, 80),
    queues: Object.fromEntries(['ready', 'running', 'blocked', 'done'].map(key => [
      key,
      clipList(route.queues?.[key], 1, 32),
    ])),
  };
}

// Rebuild _archive/INDEX.json using the unified route-layer builder.
// task-route.mjs buildArchiveIndexEntries is the single source of truth;
// this function is the sole write surface.
function refreshArchiveIndexJson() {
  if (!fs.existsSync(archiveDir)) return;
  const entries = routeBuildArchiveIndexEntries(root);
  const indexPath = path.join(archiveDir, 'INDEX.json');
  writeJsonAtomic(indexPath, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    routeRevision: computeRouteRevision(),
    sourceOfTruth: 'Harness/tasks/_archive/**/STATE.json',
    tasks: entries,
  });
}

// Find an archived task by id under _archive/YYYY/MM/DD/<id>/
function findArchivedTask(taskId) {
  if (!fs.existsSync(archiveDir)) return null;
  const yearDirs = fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d{4}$/.test(e.name)).sort((a, b) => b.name.localeCompare(a.name));
  for (const year of yearDirs) {
    const yearPath = path.join(archiveDir, year.name);
    const monthDirs = fs.readdirSync(yearPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^\d{2}$/.test(e.name)).sort((a, b) => b.name.localeCompare(a.name));
    for (const month of monthDirs) {
      const monthPath = path.join(yearPath, month.name);
      const dayDirs = fs.readdirSync(monthPath, { withFileTypes: true })
        .filter(e => e.isDirectory() && /^\d{2}$/.test(e.name)).sort((a, b) => b.name.localeCompare(a.name));
      for (const day of dayDirs) {
        const candidate = path.join(monthPath, day.name, taskId);
        // Only count a real archived capsule (STATE.json present). A stale
        // directory left by a failed move is NOT a successful archive.
        if (fs.existsSync(path.join(candidate, 'STATE.json'))) {
          return `_archive/${year.name}/${month.name}/${day.name}/${taskId}`;
        }
      }
    }
  }
  return null;
}

function readTemplateState() {
  const templatePath = path.join(tasksDir, '_template', 'STATE.json');
  if (!fs.existsSync(templatePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  } catch {
    return null;
  }
}

function generateTaskId(title, note, context) {
  // lowercase first, then sanitize — ensures uppercase letters survive as lowercase
  const raw = (title || note || context || 'record')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const parts = raw.split('-').filter(Boolean).slice(0, 3).join('-');
  // fallback: empty slug (pure CJK/emoji) defaults to 'task'
  const slug = parts.slice(0, 25) || 'task';
  const now = new Date();
  const suffix = `${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  return `task-${slug}-${suffix}`;
}

function findMatchingTask(title, note, context) {
  const { tasks } = collectTasks();
  const openTasks = tasks.filter(t => OPEN_TASK_STATUSES.has(normalizeStatus(t.state?.status) || t.status));

  // Step 1: title match (highest priority)
  if (title) {
    const slugKey = title.replace(/\s+/g, '-').toLowerCase();
    const matches = openTasks.filter(t => {
      if (t.id === `task-${slugKey}`) return true;
      if (t.id.includes(slugKey)) return true;
      const goal = (t.rootRow?.goal || t.state?.nextAction || '').toLowerCase();
      return slugKey.split('-').every(part => goal.includes(part));
    });
    if (matches.length === 1) return { matched: matches[0], candidates: null };
    if (matches.length > 1) return { matched: null, candidates: matches };
  }

  // Step 2: note/context overlap match
  if (note || context) {
    const query = ((note || '') + ' ' + (context || '')).toLowerCase();
    const terms = query.split(/\s+/).filter(t => t.length > 3);
    if (terms.length === 0) return { matched: null, candidates: null };
    const scored = openTasks.map(t => {
      const fields = [t.state?.nextAction || '', t.state?.goal || '', t.rootRow?.goal || ''].join(' ').toLowerCase();
      const score = terms.filter(term => fields.includes(term)).length;
      return { task: t, score };
    }).filter(s => s.score > 0);
    scored.sort((a, b) => b.score - a.score);
    if (scored.length === 0) return { matched: null, candidates: null };
    const bestScore = scored[0].score;
    const best = scored.filter(s => s.score === bestScore);
    if (best.length === 1 && bestScore >= Math.max(2, Math.ceil(terms.length * 0.5))) {
      return { matched: best[0].task, candidates: null };
    }
    if (best.length > 1) {
      return { matched: null, candidates: best.map(s => s.task) };
    }
  }

  return { matched: null, candidates: null };
}

function runRecord() {
  const title = flagValue('--title');
  const note = flagValue('--note');
  const context = flagValue('--context');
  const forceNew = hasFlag('--new');

  let taskId = findTaskIdArg(1);
  let createOrResume = false;

  if (!taskId) {
    if (!title && !note && !context) {
      finish({ ok: false, command: 'record', errors: ['requires <task-id> or --title/--note/--context'], warnings: [] }, 1);
      return;
    }
    if (!forceNew) {
      const { matched, candidates } = findMatchingTask(title, note, context);
      if (matched) {
        taskId = matched.id;
      } else if (candidates && candidates.length > 0) {
        finish({ ok: false, command: 'record', errors: [`Ambiguous match: ${candidates.map(t => t.id).join(', ')}. Use --new to force new, or specify --title more precisely.`], warnings: [] }, 1);
        return;
      }
    }
    if (!taskId) {
      taskId = generateTaskId(title, note, context);
      createOrResume = true;
    }

    // --new uniqueness: probe existing task dirs, append incrementing suffix on collision
    if (forceNew && createOrResume) {
      const existingNames = new Set(listOuterTaskNames());
      let counter = 1;
      const baseId = taskId;
      while (existingNames.has(taskId)) {
        counter++;
        taskId = `${baseId}-${counter}`;
      }
      // if suffix made it invalid, fall back to base id
      try {
        ensureValidTaskId(taskId);
      } catch {
        taskId = baseId;
      }
    }
  }

  if (!taskId) {
    finish({ ok: false, command: 'record', errors: ['record requires a <task-id>'], warnings: [] }, 1);
    return;
  }
  try {
    ensureValidTaskId(taskId);
  } catch (err) {
    finish({ ok: false, command: 'record', errors: [err.message], warnings: [] }, 1);
    return;
  }

  const isCreate = hasFlag('--create') || createOrResume;
  const isDryRun = hasFlag('--dry-run');
  const isApply = hasFlag('--apply');
  const actuallyApply = isApply && !isDryRun;

  const existing = readState(taskId);
  if (!existing.state && !isCreate) {
    finish({ ok: false, command: 'record', errors: [`Task "${taskId}" not found; use --create to create`], warnings: [] }, 1);
    return;
  }

  const text = flagValue('--text');
  const statusRaw = flagValue('--status');
  const phaseRaw = flagValue('--phase');
  const modeRaw = flagValue('--mode');
  const groupRaw = flagValue('--group');
  const projectRaw = flagValue('--project');
  const tagsRaw = flagValue('--tag') || flagValue('--tags');

  if (!existing.state && isCreate) {
    const now = new Date().toISOString();
    if (statusRaw) {
      const ns = normalizeStatus(statusRaw);
      if (!ns) {
        finish({ ok: false, command: 'record', errors: [`Invalid status "${statusRaw}". Valid: ${[...VALID_STATUSES].join(', ')}`], warnings: [] }, 1);
        return;
      }
    }
    if (phaseRaw && !normalizePhase(phaseRaw)) {
      finish({ ok: false, command: 'record', errors: [`Invalid phase "${phaseRaw}". Valid: ${[...VALID_PHASES].join(', ')}`], warnings: [] }, 1);
      return;
    }
    const status = statusRaw ? normalizeStatus(statusRaw) : 'active';
    let mode = 'direct';
    if (modeRaw) {
      const normalizedMode = normalizeMode(modeRaw);
      if (!normalizedMode) {
        finish({ ok: false, command: 'record', errors: [`Invalid mode "${modeRaw}". Valid: ${[...VALID_MODES].join(', ')}`], warnings: [] }, 1);
        return;
      }
      mode = normalizedMode;
    }
    const phase = phaseRaw ? normalizePhase(phaseRaw) : 'intake';
    const newState = defaultState(taskId, status, phase, now);
    newState.mode = mode;
    const project = String(projectRaw || groupRaw || '').trim();
    if (project) {
      newState.project = project;
      // Keep the legacy key populated for older Harness readers.
      newState.group = project;
    }
    if (tagsRaw) newState.tags = normalizeTags(tagsRaw);
    if (text) newState.nextAction = text;
    const templateState = readTemplateState();
    if (templateState) {
      if (Array.isArray(templateState.acceptance)) newState.acceptance = [...templateState.acceptance];
      if (templateState.links) newState.links = JSON.parse(JSON.stringify(templateState.links));
    }

    if (actuallyApply) {
      const taskDir = safeTaskPath(taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      writeJsonAtomic(path.join(taskDir, 'STATE.json'), newState);
      const progressFile = path.join(taskDir, 'PROGRESS.md');
      writeTextAtomic(progressFile, renderTaskProgress(readText(progressFile), taskId, newState));

      const planFile = path.join(taskDir, 'PLAN.md');
      if (!fs.existsSync(planFile)) {
        writeTextAtomic(planFile, `# ${taskId} - PLAN\n\n## Goal\n\n${text || taskTitle(taskId)}\n\n## Scope\n\nWrite set:\n-\n\nForbidden:\n-\n\n## Decisions\n\n| # | Decision | Reason | Date |\n|---|----------|--------|------|\n\n## Acceptance\n\n| ID | Criterion | Evidence | Status |\n|----|-----------|----------|--------|\n| AC-001 | | | pending |\n\n## Risks\n\n| Risk | Mitigation | Status |\n|------|------------|--------|\n`);
      }
      const problemFile = path.join(taskDir, 'PROBLEM.md');
      if (!fs.existsSync(problemFile)) {
        writeTextAtomic(problemFile, `# ${taskId} - PROBLEM\n\n## Active\n\n| ID | Problem | Root cause | Fix | Status |\n|----|---------|------------|-----|--------|\n\n## Resolved\n\n| ID | Problem | Root cause | Fix | Resolved |\n|----|---------|------------|-----|----------|\n`);
      }
      const refFile = path.join(taskDir, 'REFERENCES.md');
      if (!fs.existsSync(refFile)) {
        writeTextAtomic(refFile, `# ${taskId} - REFERENCES\n\n## Logs\n\n| Description | File / Command | Date |\n|-------------|---------------|------|\n\n## Evidence\n\n| What | Pointer | Verified |\n|------|---------|----------|\n\n## Links\n\n| Description | URL / Path |\n|-------------|------------|\n\n## Notes\n\n-\n`);
      }

      const rootText = readText(progressPath);
      const parsed = parseRootProgress();
      const newRow = { id: taskId, goal: text || taskTitle(taskId), phase: displayPhase('intake'), closed: '-' };
      parsed.rows.push(newRow);
      const rows = parsed.rows.map(r => ({ id: r.id, goal: r.goal, phase: r.phase, closed: r.closed }));
      const newActiveTask = isWfManagedMode(newState.mode) && OPEN_TASK_STATUSES.has(newState.status)
        ? taskId
        : parsed.activeTask;
      const newRoot = renderRootProgress(rootText, newActiveTask, rows);
      writeTextAtomic(progressPath, newRoot);
      writeTaskIndex();
    }

    finish({
      ok: true,
      command: 'record',
      action: 'created',
      dryRun: !actuallyApply,
      taskId,
      state: newState,
      warnings: [],
    }, 0);
    return;
  }

  if (existing.state) {
    const now = new Date().toISOString();
    const updated = { ...existing.state };
    if (!updated.createdAt) updated.createdAt = updated.updatedAt || now;
    if (!Object.prototype.hasOwnProperty.call(updated, 'startedAt')) updated.startedAt = null;
    if (!Object.prototype.hasOwnProperty.call(updated, 'closedAt')) updated.closedAt = null;
    updated.updatedAt = now;
    if (!updated.defaultRuntime) updated.defaultRuntime = defaultTaskRuntime();
    if (!updated.defaultAgentRuntime) updated.defaultAgentRuntime = updated.defaultRuntime;
    const currentMode = normalizeMode(updated.mode) || 'direct';
    const currentStatus = normalizeStatus(updated.status) || 'active';
    if (modeRaw) {
      const normalizedMode = normalizeMode(modeRaw);
      if (!normalizedMode) {
        finish({ ok: false, command: 'record', errors: [`Invalid mode "${modeRaw}". Valid: ${[...VALID_MODES].join(', ')}`], warnings: [] }, 1);
        return;
      }
      if (currentMode === 'direct' && isWfManagedMode(normalizedMode)) {
        finish({ ok: false, command: 'record', errors: [`Direct task "${taskId}" cannot be promoted into WF-managed lifecycle; create a new task with --mode ${normalizedMode}.`], warnings: [] }, 1);
        return;
      }
      if (isWfManagedMode(currentMode) && normalizedMode !== currentMode) {
        finish({ ok: false, command: 'record', errors: [`WF-managed task "${taskId}" cannot downgrade or exit WF lifecycle; close it and create a new task.`], warnings: [] }, 1);
        return;
      }
    }
    if (isWfManagedMode(currentMode) && currentStatus === 'closed' && statusRaw) {
      const requestedStatus = normalizeStatus(statusRaw);
      if (requestedStatus && requestedStatus !== 'closed') {
        finish({ ok: false, command: 'record', errors: [`Closed WF-managed task "${taskId}" cannot be reopened; create a new task capsule.`], warnings: [] }, 1);
        return;
      }
    }
    if (statusRaw) {
      const ns = normalizeStatus(statusRaw);
      if (!ns) {
        finish({ ok: false, command: 'record', errors: [`Invalid status "${statusRaw}". Valid: ${[...VALID_STATUSES].join(', ')}`], warnings: [] }, 1);
        return;
      }
      updated.status = ns;
    }
    if (phaseRaw) {
      const normalizedPhase = normalizePhase(phaseRaw);
      if (!normalizedPhase) {
        finish({ ok: false, command: 'record', errors: [`Invalid phase "${phaseRaw}". Valid: ${[...VALID_PHASES].join(', ')}`], warnings: [] }, 1);
        return;
      }
      updated.phase = normalizedPhase;
    }
    if (modeRaw) updated.mode = normalizeMode(modeRaw);
    const project = String(projectRaw || groupRaw || '').trim();
    if (project) {
      updated.project = project;
      updated.group = project;
    }
    if (tagsRaw) updated.tags = normalizeTags(tagsRaw);
    if (text) updated.nextAction = text;

    if (updated.status === 'active' && !updated.startedAt) updated.startedAt = now;
    if (updated.status === 'closed' && !updated.closedAt) updated.closedAt = now;
    if (updated.status !== 'closed') updated.closedAt = null;

    if (actuallyApply) {
      writeJsonAtomic(existing.path, updated);
      syncTaskViewsForState(taskId, updated);
    }

    finish({
      ok: true,
      command: 'record',
      action: 'updated',
      dryRun: !actuallyApply,
      taskId,
      state: updated,
      warnings: [],
    }, 0);
    return;
  }
}

function runOpen() {
  const { rootProgress, tasks } = collectTasks();
  const projectFilter = flagValue('--project') || flagValue('--group');
  const statusFilter = flagValue('--status');
  const normalizedStatusFilter = statusFilter ? normalizeStatus(statusFilter) : null;
  if (statusFilter && !normalizedStatusFilter) {
    finish({
      ok: false,
      command: 'open',
      errors: [`Invalid status filter "${statusFilter}". Valid: active, blocked (legacy aliases accepted)`],
      warnings: [],
      tasks: [],
    }, 1);
    return;
  }

  const openTasks = tasks.filter(task => {
    const status = normalizeStatus(task.state?.status) || task.status;
    if (!OPEN_TASK_STATUSES.has(status)) return false;
    if (projectFilter && taskProjectFor(task.state) !== projectFilter) return false;
    if (normalizedStatusFilter && status !== normalizedStatusFilter) return false;
    return true;
  }).map(task => {
    const state = task.state || {};
    const links = state.links || {};
    const status = normalizeStatus(state.status) || task.status;
    const lifecycle = lifecycleForState(state, status);
    const dependsOn = Array.isArray(links.dependsOn) ? links.dependsOn : [];
    const openDepTasks = dependsOn.filter(depId => {
      const depTask = tasks.find(t => t.id === depId);
      if (!depTask) return false;
      const depStatus = normalizeStatus(depTask.state?.status) || depTask.status;
      return OPEN_TASK_STATUSES.has(depStatus);
    });
    return {
      id: task.id,
      project: taskProjectFor(state),
      group: taskProjectFor(state),
      status,
      mode: lifecycle.mode,
      wfManaged: lifecycle.wfManaged,
      resumeRequired: lifecycle.resumeRequired,
      phase: normalizePhase(state.phase) || task.phase,
      createdAt: state.createdAt || null,
      startedAt: state.startedAt || null,
      updatedAt: state.updatedAt || null,
      closedAt: state.closedAt || null,
      dependsOn,
      blocks: Array.isArray(links.blocks) ? links.blocks : [],
      blockedByOpenDeps: openDepTasks,
      nextAction: state.nextAction || null,
      statusDisplay: status || '-',
      openTasks: true,
    };
  });

  finish({
    ok: true,
    command: 'open',
    projectFilter: projectFilter || null,
    statusFilter: normalizedStatusFilter,
    taskCount: openTasks.length,
    tasks: openTasks,
    errors: [],
    warnings: [],
  }, 0);
}

// ---- history ----
function walkArchived(filter = {}) {
  const results = [];
  if (!fs.existsSync(archiveDir)) return results;

  function addTask(taskPath, year, month, day) {
    const taskId = path.basename(taskPath);
    if (taskId.startsWith('_') || taskId.startsWith('.')) return;
    if (filter.taskId && taskId !== filter.taskId) return;
    const statePath = path.join(taskPath, 'STATE.json');
    const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
    results.push({
      id: taskId,
      year, month, day,
      archivePath: `${year}/${month}/${day}`,
      fullPath: taskPath,
      mtime: fs.statSync(taskPath).mtime.toISOString(),
      state,
    });
  }

  // Walk new layout: _archive/YYYY/MM/DD/task-id/
  // Walk old layout: _archive/YYYY/task-id/ (legacy, auto-assign month=01, day=01)
  const entries = fs.readdirSync(archiveDir, { withFileTypes: true });
  const yearDirs = entries
    .filter(e => e.isDirectory() && /^\d{4}$/.test(e.name) && (!filter.year || e.name === filter.year))
    .map(e => e.name).sort();

  for (const year of yearDirs) {
    const yearPath = path.join(archiveDir, year);
    const yearEntries = fs.readdirSync(yearPath, { withFileTypes: true });

    // New layout: month dirs (two-digit)
    const monthDirs = yearEntries
      .filter(e => e.isDirectory() && /^\d{2}$/.test(e.name) && (!filter.month || e.name === filter.month));
    const hasMonthDirs = monthDirs.length > 0;

    if (hasMonthDirs) {
      for (const month of monthDirs.map(e => e.name).sort()) {
        const monthPath = path.join(yearPath, month);
        const dayDirs = fs.readdirSync(monthPath, { withFileTypes: true })
          .filter(e => e.isDirectory() && /^\d{2}$/.test(e.name))
          .map(e => e.name).sort();
        for (const day of dayDirs) {
          const dayPath = path.join(monthPath, day);
          const taskDirs = fs.readdirSync(dayPath, { withFileTypes: true })
            .filter(e => e.isDirectory());
          for (const taskDir of taskDirs) {
            addTask(path.join(dayPath, taskDir.name), year, month, day);
          }
        }
      }
    }

    // Legacy layout: task dirs directly under year
    const legacyTasks = yearEntries
      .filter(e => e.isDirectory() && !/^\d{2}$/.test(e.name) && e.name !== '_deleted.jsonl');
    for (const taskDir of legacyTasks) {
      addTask(path.join(yearPath, taskDir.name), year, '01', '01');
    }
  }
  return results;
}

function searchArchivedText(keyword) {
  const results = [];
  const archived = walkArchived();
  const kw = keyword.toLowerCase();
  for (const task of archived) {
    const files = ['PLAN.md', 'PROGRESS.md', 'PROBLEM.md', 'REFERENCES.md', 'STATE.json'];
    const hits = [];
    for (const f of files) {
      const fp = path.join(task.fullPath, f);
      if (!fs.existsSync(fp)) continue;
      const content = fs.readFileSync(fp, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(kw)) {
          hits.push({ file: f, line: i + 1, snippet: lines[i].trim().slice(0, 120) });
        }
      }
    }
    if (hits.length > 0) {
      results.push({ id: task.id, archivePath: task.archivePath, hits });
    }
  }
  return results;
}

function runHistoryList() {
  const year = flagValue('--year');
  const month = flagValue('--month');
  const tasks = walkArchived({ year, month });
  const payload = {
    ok: true,
    command: 'history/list',
    count: tasks.length,
    tasks: tasks.map(t => ({
      id: t.id,
      archivePath: t.archivePath,
      mtime: t.mtime,
      status: t.state?.status || '-',
      phase: t.state?.phase || '-',
    })),
  };
  finish(payload, 0);
}

function runHistorySearch() {
  const keyword = args[2] || flagValue('--keyword');
  if (!keyword) {
    finish({ ok: false, command: 'history/search', errors: ['history search requires <keyword>'], warnings: [], count: 0, results: [] }, 1);
    return;
  }
  const results = searchArchivedText(keyword);
  finish({
    ok: true,
    command: 'history/search',
    keyword,
    count: results.length,
    results,
  }, 0);
}

function runHistoryLoad() {
  const taskId = flagValue('--task') || args[2];
  if (!taskId) {
    finish({ ok: false, command: 'history/load', errors: ['history load requires <task-id> or --task <id>'], warnings: [] }, 1);
    return;
  }
  const summaryOnly = hasFlag('--summary');
  const tasks = walkArchived({ taskId });
  if (tasks.length === 0) {
    finish({ ok: false, command: 'history/load', errors: [`Task "${taskId}" not found in archive`], warnings: [] }, 1);
    return;
  }
  const task = tasks[0];
  if (summaryOnly) {
    // Compact summary: no PLAN, no decisions, no raw logs. Just route stub.
    const result = {
      id: task.id,
      archivePath: task.archivePath,
      mtime: task.mtime,
      status: task.state?.status || 'archived',
      phase: task.state?.phase || 'archived',
      title: task.state?.title || task.id,
      closedAt: task.state?.closedAt || null,
      summary: task.state?.nextAction || task.state?.title || '',
      blockers: summarizeBlockersFromState(task.state),
      dependsOn: task.state?.links?.dependsOn || [],
      blocks: task.state?.links?.blocks || [],
    };
    finish({ ok: true, command: 'history/load', task: result, summary: true }, 0);
    return;
  }
  const result = {
    id: task.id,
    archivePath: task.archivePath,
    mtime: task.mtime,
    state: task.state,
    files: {},
  };
  for (const f of ['PLAN.md', 'PROGRESS.md', 'PROBLEM.md', 'REFERENCES.md']) {
    const fp = path.join(task.fullPath, f);
    if (fs.existsSync(fp)) {
      result.files[f] = fs.readFileSync(fp, 'utf8');
    }
  }
  finish({ ok: true, command: 'history/load', task: result }, 0);
}

function summarizeBlockersFromState(state) {
  const items = [];
  if (!state) return items;
  if (state.activeQuestion) items.push(String(state.activeQuestion));
  const blocked = state.queues?.blocked || [];
  for (const entry of blocked) {
    const text = typeof entry === 'string'
      ? entry
      : (entry.reason || entry.text || entry.id || 'blocked queue entry');
    items.push(String(text));
  }
  return items;
}

function runHistoryDelete() {
  const taskId = args[2];
  if (!taskId) {
    finish({ ok: false, command: 'history/delete', errors: ['history delete requires <task-id>'], warnings: [] }, 1);
    return;
  }
  const tasks = walkArchived({ taskId });
  if (tasks.length === 0) {
    finish({ ok: false, command: 'history/delete', errors: [`Task "${taskId}" not found in archive`], warnings: [] }, 1);
    return;
  }
  const task = tasks[0];
  if (hasFlag('--apply')) {
    // Audit: write a deletion record before removing
    const auditPath = path.join(archiveDir, '_deleted.jsonl');
    const auditEntry = JSON.stringify({
      id: task.id,
      archivePath: task.archivePath,
      deletedAt: new Date().toISOString(),
      deletedBy: process.env.USER || process.env.USERNAME || 'unknown',
    });
    fs.appendFileSync(auditPath, auditEntry + '\n');
    fs.rmSync(task.fullPath, { recursive: true, force: true });
    // Clean up empty day/month/year dirs
    const dayPath = path.dirname(task.fullPath);
    const monthPath = path.dirname(dayPath);
    const yearPath = path.dirname(monthPath);
    for (const dir of [dayPath, monthPath, yearPath]) {
      try {
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch {}
    }
    finish({
      ok: true,
      command: 'history/delete',
      action: 'deleted',
      taskId: task.id,
      archivePath: task.archivePath,
      auditSaved: true,
    }, 0);
  } else {
    finish({
      ok: true,
      command: 'history/delete',
      dryRun: true,
      taskId: task.id,
      archivePath: task.archivePath,
      message: 'Dry run. Use --apply to delete.',
    }, 0);
  }
}

export {
  readTaskState,
  writeTaskStateAtomic,
  taskPathsForProject,
  writeTextAtomic,
  writeJsonAtomic,
};

// ---- dispatch ----
// Keep imports side-effect free so runtime workers can reuse the canonical
// reader/writer without accidentally running the task-state CLI.
const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (command === 'help' || hasFlag('--help') || hasFlag('-h')) usage();
  if (command === 'list') runList();
  if (command === 'index') runIndex();
  if (command === 'query') runQuery();
  if (command === 'validate') runValidate();
  if (command === 'reconcile') runReconcile();
  if (command === 'set-active') runSetActive();
  if (command === 'transition') runTransition();
  if (command === 'archive') runArchive();
  if (command === 'auto-archive') runAutoArchive();
  if (command === 'route') runRoute();
  if (command === 'record') runRecord();
  if (command === 'open') runOpen();
  if (command === 'history') {
    const sub = args[1];
    if (sub === 'list') runHistoryList();
    else if (sub === 'search') runHistorySearch();
    else if (sub === 'load') runHistoryLoad();
    else if (sub === 'delete') runHistoryDelete();
    else finish({
      ok: false, command: 'history',
      errors: [`Unknown history subcommand "${sub}". Try: list, search <kw>, load <id>, delete <id>`],
      warnings: [],
    }, 1);
  }

  finish({
    ok: false,
    command,
    errors: [`Unknown command "${command}". Run node Harness/scripts/task-state.mjs --help.`],
    warnings: [],
  }, 1);
}
