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
const RESERVED = new Set(['_template', '_archive', 'auto']);
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

function hasFlag(name) {
  return args.includes(name);
}

function flagValue(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

const outputJson = hasFlag('--json');

function print(payload) {
  if (outputJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (payload.command === 'list' || payload.command === 'validate') {
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
      const suffix = r.year ? ` -> _archive/${r.year}` : '';
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
  list [--json]                         List task state.
  validate [--strict] [--json]          Validate state consistency.
  reconcile [--dry-run|--apply] [--json] Normalize STATE.json and root PROGRESS.md.
  set-active <task-id> [--dry-run]       Set the single active task.
  transition <task-id> --status <s> --phase <p> [--dry-run]
  archive [--dry-run|--apply] [--keep n] [--task id] [--json]

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
  }

  const activeStateTasks = tasks.filter(task => normalizeStatus(task.state?.status) === 'active');
  if (activeStateTasks.length > 1) {
    issue(`Multiple STATE.json files are active: ${activeStateTasks.map(task => task.id).join(', ')}`, true);
  }
  if (tasks.length > OUTER_TASK_CAP) {
    issue(`Harness/tasks/ has ${tasks.length} outer task capsules (cap ${OUTER_TASK_CAP}); run node Harness/scripts/task-state.mjs archive --apply`);
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
  return {
    schemaVersion: 1,
    taskId,
    status,
    mode: 'direct',
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

function runList() {
  const validation = validateState();
  finish({ ...validation, command: 'list', ok: true }, 0);
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

  archiveable.sort((a, b) => a.mtimeMs - b.mtimeMs || a.id.localeCompare(b.id));
  const toArchiveCount = taskFilter ? archiveable.length : Math.max(0, tasks.length - keepValue);
  const toArchive = archiveable.slice(0, toArchiveCount);
  const toArchiveIds = new Set(toArchive.map(task => task.id));
  const keptArchiveable = archiveable.filter(task => !toArchiveIds.has(task.id));

  const errors = [];
  for (const task of toArchive) {
    const year = new Date(task.mtimeMs).getFullYear().toString();
    const dest = safeTaskPath('_archive', year, task.id);
    if (fs.existsSync(dest)) errors.push(`Archive destination already exists: Harness/tasks/_archive/${year}/${task.id}`);
  }
  if (errors.length) {
    return { ok: false, command: 'archive', errors, warnings: [], results: [] };
  }

  const results = [
    ...toArchive.map(task => ({
      dir: task.id,
      year: new Date(task.mtimeMs).getFullYear().toString(),
      action: hasFlag('--apply') ? 'archived' : 'would-archive',
      status: hasFlag('--apply') ? 'moved' : 'dry-run',
    })),
    ...keptArchiveable.map(task => ({
      dir: task.id,
      year: new Date(task.mtimeMs).getFullYear().toString(),
      action: 'kept',
      status: `kept by --keep ${keepValue}`,
    })),
    ...skipped.map(({ task, reason }) => ({
      dir: task.id,
      year: null,
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
  };
}

function appendArchiveIndex(entries) {
  if (entries.length === 0) return;
  const indexPath = path.join(archiveDir, 'INDEX.md');
  const existing = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, 'utf8').trimEnd() + '\n'
    : '| Task | Year | Archived |\n|------|------|----------|\n';
  const date = new Date().toISOString().slice(0, 10);
  const lines = entries.map(entry => `| ${entry.id} | ${entry.year} | ${date} |`).join('\n');
  writeTextAtomic(indexPath, `${existing}${lines}\n`);
}

function runArchive() {
  const plan = buildArchivePlan();
  if (!plan.ok) finish(plan, 1);

  if (hasFlag('--apply')) {
    const indexEntries = [];
    for (const result of plan.results.filter(result => result.action === 'archived')) {
      const src = safeTaskPath(result.dir);
      const destDir = safeTaskPath('_archive', result.year);
      const dest = safeTaskPath('_archive', result.year, result.dir);
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
      indexEntries.push({ id: result.dir, year: result.year });
    }
    appendArchiveIndex(indexEntries);

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

if (command === 'help' || hasFlag('--help') || hasFlag('-h')) usage();
if (command === 'list') runList();
if (command === 'validate') runValidate();
if (command === 'reconcile') runReconcile();
if (command === 'set-active') runSetActive();
if (command === 'transition') runTransition();
if (command === 'archive') runArchive();

finish({
  ok: false,
  command,
  errors: [`Unknown command "${command}". Run node Harness/scripts/task-state.mjs --help.`],
  warnings: [],
}, 1);
