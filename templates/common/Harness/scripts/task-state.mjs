#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const harnessDir = path.join(root, 'Harness');
const tasksDir = path.join(harnessDir, 'tasks');
const archiveDir = path.join(tasksDir, '_archive');
const progressPath = path.join(harnessDir, 'PROGRESS.md');
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'help';

const OUTER_TASK_CAP = 5;
const RESERVED = new Set(['_template', '_archive', 'continuous']);
const TASK_ID_RE = /^task-[a-z]+(-[a-z0-9]+){1,4}$/;
const NEVER_ARCHIVE_STATUSES = new Set([
  'active',
  'blocked',
  'in_progress',
  'running',
  'pending',
  'needs-user-decision',
]);
const SAFE_ARCHIVE_STATUSES = new Set([
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
  ...NEVER_ARCHIVE_STATUSES,
  ...SAFE_ARCHIVE_STATUSES,
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
  ['in-progress', 'in_progress'],
  ['inprogress', 'in_progress'],
  ['needs_user_decision', 'needs-user-decision'],
  ['needs-user', 'needs-user-decision'],
  ['need-user-decision', 'needs-user-decision'],
  ['close-out', 'closeout'],
]);
const OPEN_TASK_STATUSES = new Set(['active', 'blocked', 'in_progress', 'running', 'pending', 'needs-user-decision']);
const VALUE_FLAGS = new Set(['--keep', '--mode', '--phase', '--status', '--task', '--text', '--title', '--note', '--context']);

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
    for (const task of payload.tasks || []) {
      const deps = task.dependsOn?.length ? `  dependsOn: [${task.dependsOn.join(', ')}]` : '';
      const blocks = task.blocks?.length ? `  blocks: [${task.blocks.join(', ')}]` : '';
      console.log(`- ${task.id}: status=${task.status || '-'} phase=${task.phase || '-'}${deps}${blocks}`);
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
  } else if (payload.command === 'archive') {
    if (payload.dryRun) console.log('[DRY RUN] No files moved. Use --apply to execute.');
    console.log(`Scanned: ${payload.scanned}, Archiveable: ${payload.archiveable}, To archive: ${payload.toArchive}, Kept: ${payload.kept}, Skipped: ${payload.skipped}`);
    for (const r of payload.results) {
      const suffix = r.path ? ` -> _archive/${r.path}` : '';
      console.log(`- ${r.action}: ${r.dir} (${r.status})${suffix}`);
    }
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
  list [--json]                         List task state with dependency/resume info.
  validate [--strict] [--json]          Validate state consistency (includes link checks).
  reconcile [--dry-run|--apply] [--json] Normalize STATE.json and root PROGRESS.md.
  set-active <task-id> [--dry-run]       Set the single active task.
  transition <task-id> --status <s> --phase <p> [--dry-run]
  archive [--dry-run|--apply] [--keep n] [--task id] [--json]
                                        Archive eligible tasks to _archive/YYYY/MM/DD/.
                                        Explicit --apply (no --task filter) archives ALL.
  history list [--year YYYY] [--month MM] [--json]
                                        List archived tasks, optional year/month filter.
  history search <keyword> [--json]      Full-text search archived PLAN/PROGRESS/PROBLEM/REFERENCES.
  history load <task-id> [--json]        Load one archived task's full record.
  history delete <task-id> [--dry-run|--apply] [--json]
                                        Delete an archived task (audit trail written).
  record <task-id> [--create] [--text "description"] [--status <s>] [--mode <m>] [--dry-run|--apply] [--json]
                                        Create or update a task record.
  open [--json]                         List open (non-archived, active-status) tasks.

Archive defaults to dry-run and keeps ${OUTER_TASK_CAP} non-archived task capsules.`,
  }, 0);
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function writeJsonAtomic(file, value) {
  writeTextAtomic(file, JSON.stringify(value, null, 2) + '\n');
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
  if (isActive) return 'active';
  if (normalized === 'verified' || normalized === 'closeout') return 'verified';
  if (normalized === 'archived') return 'archived';
  if (normalized === 'blocked') return 'blocked';
  if (normalized) return 'in_progress';
  return 'pending';
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

function normalizeMode(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim().toLowerCase();
  if (!raw) return '';
  if (VALID_MODES.has(raw)) return raw;
  return '';
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
    const phase = rootPhase || progressPhase || statePhase;
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
  const status = normalizeStatus(task.state.status);
  const phase = normalizePhase(task.state.phase);
  if (NEVER_ARCHIVE_STATUSES.has(status)) return { ok: false, reason: `status "${status}" is never auto-archived` };
  if (NEVER_ARCHIVE_STATUSES.has(phase)) return { ok: false, reason: `phase "${phase}" is never auto-archived` };
  if (task.state.activeQuestion) return { ok: false, reason: 'activeQuestion is set' };
  const queues = normalizeQueues(task.state);
  if (queues.running.length > 0) return { ok: false, reason: 'running queue is not empty' };
  if (queues.blocked.length > 0) return { ok: false, reason: 'blocked queue is not empty' };
  if (SAFE_ARCHIVE_STATUSES.has(status) || SAFE_ARCHIVE_STATUSES.has(phase)) {
    return { ok: true, reason: 'status/phase allows archive' };
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
    if (normalizeStatus(task.state.status) === 'active' && task.id !== rootProgress.activeTask) {
      issue(`${task.id}: STATE.json is active but root Active Task is ${rootProgress.activeTask || 'None'}`, true);
    }
    if (task.id === rootProgress.activeTask && normalizeStatus(task.state.status) && normalizeStatus(task.state.status) !== 'active') {
      issue(`${task.id}: root Active Task points here but STATE.json status is "${normalizeStatus(task.state.status)}"`, true);
    }

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

  const activeStateTasks = tasks.filter(task => normalizeStatus(task.state?.status) === 'active');
  if (activeStateTasks.length > 1) {
    issue(`Multiple STATE.json files are active: ${activeStateTasks.map(task => task.id).join(', ')}`, true);
  }
  if (tasks.length > OUTER_TASK_CAP) {
    issue(`Harness/tasks/ has ${tasks.length} outer task capsules (cap ${OUTER_TASK_CAP}); remind the user to run $wf-task-archive when they want to archive completed tasks`);
  }

  return {
    ok: errors.length === 0,
    command: 'validate',
    activeTask: rootProgress.activeTask,
    outerTaskCap: OUTER_TASK_CAP,
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
  return resolved;
}

function desiredPhaseForTask(task, activeTask) {
  return task.rootPhase || task.progressPhase || task.statePhase || (task.id === activeTask ? 'implement' : 'intake');
}

function desiredStatusForTask(task, activeTask, desiredPhase) {
  if (task.id === activeTask) return 'active';
  const current = normalizeStatus(task.state?.status);
  if (current && current !== 'active') return current;
  return statusFromPhase(desiredPhase, false);
}

function defaultState(taskId, status, phase, now) {
  const runtime = defaultTaskRuntime();
  return {
    schemaVersion: 1,
    taskId,
    status,
    mode: 'direct',
    defaultRuntime: runtime,
    defaultAgentRuntime: runtime,
    tier: 'none',
    phase,
    gate: null,
    updatedAt: now,
    activeQuestion: null,
    nextAction: 'Review task state.',
    acceptance: [],
    queues: defaultQueues(),
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
  state.status = status;
  state.phase = phase;
  if (!state.mode) state.mode = 'direct';
  if (!state.defaultRuntime) state.defaultRuntime = defaultTaskRuntime();
  if (!state.defaultAgentRuntime) state.defaultAgentRuntime = state.defaultRuntime;
  if (!state.tier) state.tier = 'none';
  if (!Object.prototype.hasOwnProperty.call(state, 'gate')) state.gate = null;
  if (!Object.prototype.hasOwnProperty.call(state, 'activeQuestion')) state.activeQuestion = null;
  if (!state.nextAction) state.nextAction = task.rootRow?.goal || 'Review task state.';
  state.queues = normalizeQueues(state);
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

Non-archived tasks only (max ${OUTER_TASK_CAP}). Archived tasks are listed in \`Harness/tasks/_archive/INDEX.md\` (see \`Harness/specs/protocols/TASK_ARCHIVE.md\`).

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
    return {
      id,
      goal: task.rootRow?.goal || task.state?.goal || task.state?.nextAction || taskTitle(id),
      phase: displayPhase(phase),
      closed: task.rootRow?.closed || '-',
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
      if (transition.status) {
        const status = normalizeStatus(transition.status);
        if (!status) errors.push(`${task.id}: unknown transition status "${transition.status}"`);
        if (status === 'active') activeTask = task.id;
        if (rootProgress.activeTask === task.id && SAFE_ARCHIVE_STATUSES.has(status)) activeTask = null;
      }
      if (transition.phase && !normalizePhase(transition.phase)) {
        errors.push(`${task.id}: unknown transition phase "${transition.phase}"`);
      }
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
      nextState.updatedAt = now;
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

function runList() {
  const { rootProgress, tasks } = collectTasks();

  const expandedTasks = tasks.map(task => {
    const state = task.state || {};
    const links = state.links || {};
    const status = normalizeStatus(state.status) || task.status;
    return {
      id: task.id,
      status,
      phase: normalizePhase(state.phase) || task.phase,
      rootPhase: task.rootPhase,
      progressPhase: task.progressPhase,
      dependsOn: Array.isArray(links.dependsOn) ? links.dependsOn : [],
      blocks: Array.isArray(links.blocks) ? links.blocks : [],
      statusDisplay: status || '-',
      openTasks: OPEN_TASK_STATUSES.has(status),
      nextAction: state.nextAction || null,
      archive: (state ? archiveEligibility(task, rootProgress.activeTask) : { ok: false, reason: 'no state' }),
    };
  });

  const graph = buildListGraph(expandedTasks);

  const payload = {
    ok: true,
    command: 'list',
    taskCount: expandedTasks.length,
    activeTask: rootProgress.activeTask,
    tasks: expandedTasks,
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

function runValidate() {
  const payload = validateState({ strict: hasFlag('--strict') });
  finish(payload, payload.ok ? 0 : 1);
}

function runReconcile(overrides = {}) {
  const plan = buildReconcilePlan(overrides);
  if (overrides.commandLabel) plan.command = overrides.commandLabel;
  if (plan.ok && hasFlag('--apply')) {
    applyOperations(plan.operations);
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
  if (!status && !phase && !nextAction) {
    finish({ ok: false, command: 'transition', errors: ['transition requires --status, --phase, or --next'], warnings: [], operations: [] }, 1);
  }
  if (!hasFlag('--apply') && !hasFlag('--dry-run')) args.push('--apply');
  runReconcile({ commandLabel: 'transition', transition: { taskId, status, phase, nextAction } });
}

function buildArchivePlan() {
  const keepValue = Number.parseInt(flagValue('--keep', String(OUTER_TASK_CAP)), 10);
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

  const { rootProgress, tasks } = collectTasks();
  const selectedTasks = taskFilter ? tasks.filter(task => task.id === taskFilter) : tasks;
  if (taskFilter && selectedTasks.length === 0) {
    return { ok: false, command: 'archive', errors: [`Task "${taskFilter}" not found in Harness/tasks/`], warnings: [], results: [] };
  }

  const archiveable = [];
  const skipped = [];
  for (const task of selectedTasks) {
    const eligibility = archiveEligibility(task, rootProgress.activeTask);
    if (eligibility.ok) archiveable.push(task);
    else skipped.push({ task, reason: eligibility.reason });
  }

  const dryRun = !hasFlag('--apply');
  const explicitTrigger = dryRun === false && !taskFilter;
  archiveable.sort((a, b) => a.mtimeMs - b.mtimeMs || a.id.localeCompare(b.id));

  // Explicit user trigger (no --task filter, with --apply): archive ALL eligible tasks.
  // Explicit --task targets the selected eligible task in both dry-run and apply.
  // Auto/scheduled/dry-run: only archive tasks exceeding --keep cap.
  const toArchiveCount = taskFilter
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
        ? (explicitTrigger ? 'explicit --apply: all eligible' : 'moved')
        : (taskFilter ? 'dry-run' : `dry-run (${toArchiveCount} of ${archiveable.length} eligible)`),
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

function runArchive() {
  const plan = buildArchivePlan();
  if (!plan.ok) finish(plan, 1);

  if (hasFlag('--apply')) {
    const indexEntries = [];
    for (const result of plan.results.filter(result => result.action === 'archived')) {
      const src = safeTaskPath(result.dir);
      const destDir = safeTaskPath('_archive', result.year, result.month, result.day);
      const dest = safeTaskPath('_archive', result.year, result.month, result.day, result.dir);
      fs.mkdirSync(destDir, { recursive: true });
      fs.renameSync(src, dest);
      const movedStatePath = path.join(dest, 'STATE.json');
      const movedState = fs.existsSync(movedStatePath)
        ? JSON.parse(fs.readFileSync(movedStatePath, 'utf8'))
        : defaultState(result.dir, 'archived', 'archived', new Date().toISOString());
      movedState.status = 'archived';
      movedState.phase = 'archived';
      movedState.updatedAt = new Date().toISOString();
      writeJsonAtomic(movedStatePath, movedState);
      const movedProgressPath = path.join(dest, 'PROGRESS.md');
      writeTextAtomic(movedProgressPath, renderTaskProgress(readText(movedProgressPath), result.dir, movedState));
      indexEntries.push({ id: result.dir, year: result.year, month: result.month, day: result.day });
    }
    const graphContent = buildArchiveGraphIndex();
    appendArchiveIndex(indexEntries, graphContent);

    for (const task of plan.tasks) {
      task.desiredState = task.state || defaultState(task.id, task.status, task.phase || 'intake', new Date().toISOString());
    }
    const rows = buildRows(plan.tasks, plan.rootProgress.activeTask, plan.toArchiveIds);
    const desiredProgress = renderRootProgress(plan.rootProgress.text, plan.rootProgress.activeTask, rows);
    writeTextAtomic(progressPath, desiredProgress);
    plan.dryRun = false;
  }

  delete plan.tasks;
  delete plan.rootProgress;
  delete plan.toArchiveIds;
  finish(plan, 0);
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
  const modeRaw = flagValue('--mode');

  if (!existing.state && isCreate) {
    const now = new Date().toISOString();
    if (statusRaw) {
      const ns = normalizeStatus(statusRaw);
      if (!ns) {
        finish({ ok: false, command: 'record', errors: [`Invalid status "${statusRaw}". Valid: ${[...VALID_STATUSES].join(', ')}`], warnings: [] }, 1);
        return;
      }
    }
    const status = statusRaw ? normalizeStatus(statusRaw) : 'pending';
    const mode = modeRaw || 'direct';
    const newState = defaultState(taskId, status, 'intake', now);
    newState.mode = mode;
    if (text) newState.nextAction = text;
  if (modeRaw) {
    const normalizedMode = normalizeMode(modeRaw);
    if (!normalizedMode) {
      finish({ ok: false, command: 'record', errors: [`Invalid mode "${modeRaw}". Valid: ${[...VALID_MODES].join(', ')}`], warnings: [] }, 1);
      return;
    }
    newState.mode = normalizedMode;
  }

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
      const newRoot = renderRootProgress(rootText, parsed.activeTask, rows);
      writeTextAtomic(progressPath, newRoot);
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
    updated.updatedAt = now;
    if (!updated.defaultRuntime) updated.defaultRuntime = defaultTaskRuntime();
    if (!updated.defaultAgentRuntime) updated.defaultAgentRuntime = updated.defaultRuntime;
    if (statusRaw) {
      const ns = normalizeStatus(statusRaw);
      if (!ns) {
        finish({ ok: false, command: 'record', errors: [`Invalid status "${statusRaw}". Valid: ${[...VALID_STATUSES].join(', ')}`], warnings: [] }, 1);
        return;
      }
      updated.status = ns;
    }
    if (modeRaw) {
      const normalizedMode = normalizeMode(modeRaw);
      if (!normalizedMode) {
        finish({ ok: false, command: 'record', errors: [`Invalid mode "${modeRaw}". Valid: ${[...VALID_MODES].join(', ')}`], warnings: [] }, 1);
        return;
      }
      updated.mode = normalizedMode;
    }
    if (text) updated.nextAction = text;

    if (actuallyApply) {
      writeJsonAtomic(existing.path, updated);
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

  const openTasks = tasks.filter(task => {
    const status = normalizeStatus(task.state?.status) || task.status;
    return OPEN_TASK_STATUSES.has(status);
  }).map(task => {
    const state = task.state || {};
    const links = state.links || {};
    const status = normalizeStatus(state.status) || task.status;
    const dependsOn = Array.isArray(links.dependsOn) ? links.dependsOn : [];
    const openDepTasks = dependsOn.filter(depId => {
      const depTask = tasks.find(t => t.id === depId);
      if (!depTask) return false;
      const depStatus = normalizeStatus(depTask.state?.status) || depTask.status;
      return OPEN_TASK_STATUSES.has(depStatus);
    });
    return {
      id: task.id,
      status,
      phase: normalizePhase(state.phase) || task.phase,
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
  const taskId = args[2];
  if (!taskId) {
    finish({ ok: false, command: 'history/load', errors: ['history load requires <task-id>'], warnings: [] }, 1);
    return;
  }
  const tasks = walkArchived({ taskId });
  if (tasks.length === 0) {
    finish({ ok: false, command: 'history/load', errors: [`Task "${taskId}" not found in archive`], warnings: [] }, 1);
    return;
  }
  const task = tasks[0];
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

// ---- dispatch ----
if (command === 'help' || hasFlag('--help') || hasFlag('-h')) usage();
if (command === 'list') runList();
if (command === 'validate') runValidate();
if (command === 'reconcile') runReconcile();
if (command === 'set-active') runSetActive();
if (command === 'transition') runTransition();
if (command === 'archive') runArchive();
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
