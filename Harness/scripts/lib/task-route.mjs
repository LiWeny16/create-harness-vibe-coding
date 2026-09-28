#!/usr/bin/env node
/**
 * task-route.mjs — pure derivation layer for task routing.
 *
 * This module is read-only and pure. It derives task routes, focus, blockers,
 * archive eligibility, archive index entries, and resume summaries from
 * existing `Harness/tasks/` state. It NEVER writes to disk.
 *
 * The canonical write surface for archive operations lives in
 * `task-state.mjs`. This module exposes `archiveEligibility` and
 * `buildArchiveIndexEntries` as the single source of truth so task-state.mjs
 * can stay consistent with the derived route layer without duplicating logic.
 *
 * Contract: tests/capsule-routing.test.js and
 * Harness/tasks/task-refactor-capsule-routing/PLAN.md.
 *
 * Public API (read-only):
 *   normalizeStatus, normalizePhase
 *   readLiveTasks, readArchivedTasks
 *   resolveRoute, resolveFocus
 *   aggregateBlockers, archiveEligibility
 *   buildRouteStub, buildResumeSummary, buildArchiveIndexEntries
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Constants — mirror task-state.mjs to stay consistent with the canonical
// lifecycle. If the canonical set changes, change both together.
// ---------------------------------------------------------------------------

const CANONICAL_STATUSES = new Set(['active', 'blocked', 'closed']);
const NEVER_ARCHIVE_STATUSES = new Set(['active', 'blocked']);
const RESERVED_TASK_NAMES = new Set(['_template', '_archive', 'continuous']);
const TASK_ID_RE = /^task-[a-z0-9]+(-[a-z0-9]+){1,4}$/;

const STATUS_ALIASES = new Map([
  ['in-progress', 'active'],
  ['inprogress', 'active'],
  ['in_progress', 'active'],
  ['running', 'active'],
  ['pending', 'active'],
  ['needs_user_decision', 'blocked'],
  ['needs-user-decision', 'blocked'],
  ['needs-user', 'blocked'],
  ['need-user-decision', 'blocked'],
  ['failed', 'blocked'],
  ['complete', 'closed'],
  ['completed', 'closed'],
  ['verified', 'closed'],
  ['archived', 'closed'],
  ['abandoned', 'closed'],
  ['obsolete', 'closed'],
  ['done', 'closed'],
  ['closeout', 'closed'],
  ['close-out', 'closed'],
  ['skipped', 'closed'],
]);

const PHASE_ALIASES = new Map([
  ['implementation', 'implement'],
  ['build', 'implement'],
  ['validation', 'verify'],
  ['complete', 'verified'],
  ['done', 'verified'],
  ['closed', 'closeout'],
]);

const OPEN_TASK_STATUSES = new Set(['active', 'blocked']);

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Map a raw status value to the canonical lifecycle. Unknown values are
 * returned lower-cased (still readable, not canonical).
 */
export function normalizeStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'active';
  if (STATUS_ALIASES.has(raw)) return STATUS_ALIASES.get(raw);
  if (CANONICAL_STATUSES.has(raw)) return raw;
  return raw;
}

export function normalizePhase(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'implement';
  if (PHASE_ALIASES.has(raw)) return PHASE_ALIASES.get(raw);
  return raw;
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

/**
 * Enumerate live tasks under `<root>/Harness/tasks/<task-id>/STATE.json`.
 * Returns an array of normalized task records sorted by id.
 */
export function readLiveTasks(root) {
  const tasksDir = path.join(root, 'Harness', 'tasks');
  if (!fs.existsSync(tasksDir)) return [];
  const tasks = [];
  const entries = fs.readdirSync(tasksDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !RESERVED_TASK_NAMES.has(e.name));
  for (const entry of entries) {
    const statePath = path.join(tasksDir, entry.name, 'STATE.json');
    if (!fs.existsSync(statePath)) continue;
    const state = safeReadJson(statePath);
    if (!state || typeof state !== 'object') continue;
    tasks.push(mapTask(state, entry.name, false));
  }
  tasks.sort((a, b) => a.id.localeCompare(b.id));
  return tasks;
}

/**
 * Enumerate archived tasks under `<root>/Harness/tasks/_archive/`.
 * Each archived task gets `archivePath` set to its location relative to root.
 */
export function readArchivedTasks(root) {
  const archiveDir = path.join(root, 'Harness', 'tasks', '_archive');
  if (!fs.existsSync(archiveDir)) return [];
  const tasks = [];
  const yearDirs = fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d{4}$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  for (const year of yearDirs) {
    const yearPath = path.join(archiveDir, year.name);
    const monthDirs = fs.readdirSync(yearPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^\d{2}$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
    for (const month of monthDirs) {
      const monthPath = path.join(yearPath, month.name);
      const dayDirs = fs.readdirSync(monthPath, { withFileTypes: true })
        .filter(e => e.isDirectory() && /^\d{2}$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
      for (const day of dayDirs) {
        const dayPath = path.join(monthPath, day.name);
        const taskDirs = fs.readdirSync(dayPath, { withFileTypes: true }).filter(e => e.isDirectory());
        for (const taskDir of taskDirs) {
          const statePath = path.join(dayPath, taskDir.name, 'STATE.json');
          if (!fs.existsSync(statePath)) continue;
          const state = safeReadJson(statePath);
          if (!state || typeof state !== 'object') continue;
          const relPath = `Harness/tasks/_archive/${year.name}/${month.name}/${day.name}/${taskDir.name}`;
          tasks.push(mapTask(state, taskDir.name, true, relPath));
        }
      }
    }
  }
  tasks.sort((a, b) => a.id.localeCompare(b.id));
  return tasks;
}

// ---------------------------------------------------------------------------
// Route resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a task id to a route entry. Throws on path traversal or reserved
 * ids; returns `{ ok: false, id }` for unknown ids.
 */
export function resolveRoute(root, taskId) {
  assertSafeTaskId(taskId);
  const live = readLiveTasks(root).find(t => t.id === taskId);
  if (live) {
    return {
      ok: true,
      id: live.id,
      title: live.title,
      status: live.status,
      phase: live.phase,
      path: live.path,
      archivePath: null,
      archived: false,
      updatedAt: live.updatedAt,
      dependsOn: live.dependsOn,
      blocks: live.blocks,
    };
  }
  const archived = readArchivedTasks(root).find(t => t.id === taskId);
  if (archived) {
    return {
      ok: true,
      id: archived.id,
      title: archived.title,
      status: archived.status,
      phase: archived.phase,
      path: archived.path,
      archivePath: archived.archivePath,
      archived: true,
      updatedAt: archived.updatedAt,
      dependsOn: archived.dependsOn,
      blocks: archived.blocks,
    };
  }
  return { ok: false, id: taskId };
}

/**
 * Decide focus status. Reads the active pointer from Harness/PROGRESS.md.
 * Returns one of:
 *   { status: 'resolved', taskId }           — pointer names an open task
 *   { status: 'ambiguous', candidates }      — multiple open, no pointer
 *   { status: 'none' }                       — no open tasks
 */
export function resolveFocus(root) {
  const live = readLiveTasks(root);
  const open = live.filter(t => OPEN_TASK_STATUSES.has(t.status));
  if (open.length === 0) return { status: 'none', candidates: [] };

  const pointer = readActivePointer(root);
  if (pointer) {
    const found = open.find(t => t.id === pointer);
    if (found) return { status: 'resolved', taskId: found.id };
  }
  if (open.length === 1) return { status: 'resolved', taskId: open[0].id };
  return { status: 'ambiguous', candidates: open.map(t => t.id) };
}

// ---------------------------------------------------------------------------
// Blockers and eligibility
// ---------------------------------------------------------------------------

/**
 * Unify blocker sources for a task. Returns `{ items: [{kind, text, source}] }`.
 * Kinds: activeQuestion, queue, dependency, handoff, problem.
 */
export function aggregateBlockers(root, taskId) {
  const route = resolveRoute(root, taskId);
  if (!route.ok) return { id: taskId, items: [] };

  const rawState = readRawState(root, taskId, route.archived);
  if (!rawState) return { id: taskId, items: [] };

  const items = [];

  // activeQuestion
  if (rawState?.activeQuestion) {
    items.push({ kind: 'activeQuestion', text: String(rawState.activeQuestion), source: 'STATE.activeQuestion' });
  }

  // blocked queue
  const blockedQueue = rawState?.queues?.blocked || [];
  for (const entry of blockedQueue) {
    const text = typeof entry === 'string'
      ? entry
      : (entry.reason || entry.text || entry.id || 'blocked queue entry');
    items.push({ kind: 'queue', text: String(text), source: 'STATE.queues.blocked' });
  }

  // open dependencies
  const liveIds = new Set(readLiveTasks(root).map(t => t.id));
  const archivedIds = new Set(readArchivedTasks(root).map(t => t.id));
  const dependsOn = rawState?.links?.dependsOn || [];
  for (const dep of dependsOn) {
    if (liveIds.has(dep) || archivedIds.has(dep)) {
      const depRoute = resolveRoute(root, dep);
      if (depRoute.ok && OPEN_TASK_STATUSES.has(depRoute.status)) {
        items.push({ kind: 'dependency', text: dep, source: 'STATE.links.dependsOn' });
      }
    } else {
      items.push({ kind: 'dependency', text: `${dep} (missing)`, source: 'STATE.links.dependsOn' });
    }
  }

  // handoff unresolved
  const handoff = rawState?.context?.handoff;
  if (handoff && Array.isArray(handoff.unresolved)) {
    for (const u of handoff.unresolved) {
      items.push({ kind: 'handoff', text: String(u), source: 'STATE.context.handoff.unresolved' });
    }
  }

  // PROBLEM.md open items
  const problemText = readProblemMd(root, taskId, route.archived);
  if (problemText) {
    for (const line of problemText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith('-')) continue;
      const text = trimmed.replace(/^-\s*/, '').replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
      if (text) items.push({ kind: 'problem', text, source: 'PROBLEM.md' });
    }
  }

  return { id: taskId, items };
}

function activeProblemBlockers(problemText) {
  if (!problemText) return [];
  const blockers = [];
  const terminalStatuses = new Set(['resolved', 'closed', 'done', 'complete', 'completed', 'verified', 'cancelled', 'canceled', 'wontfix', "won't fix"]);
  let inActive = false;
  let columnNames = null;
  for (const line of problemText.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      inActive = heading[1].trim().toLowerCase() === 'active';
      columnNames = null;
      continue;
    }
    if (!inActive) continue;
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed.slice(1, -1).split('|').map(cell => cell.trim());
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
    if (!columnNames) {
      const normalized = cells.map(cell => cell.toLowerCase());
      const problemIndex = normalized.findIndex(cell => cell === 'problem');
      const statusIndex = normalized.findIndex(cell => cell === 'status');
      if (problemIndex !== -1) {
        columnNames = { problemIndex, statusIndex };
      }
      continue;
    }
    const problem = cells[columnNames.problemIndex]?.trim();
    if (!problem || /^[-—]$/.test(problem)) continue;
    const status = columnNames.statusIndex === -1
      ? ''
      : String(cells[columnNames.statusIndex] || '').trim().toLowerCase();
    if (!terminalStatuses.has(status)) blockers.push({ problem, status });
  }
  return blockers;
}

/**
 * Decide whether a task is eligible for auto-archive. Only closed tasks are
 * eligible; active/blocked are never archived; unknown/reserved are rejected.
 *
 * This is the single source of truth for archive eligibility. The canonical
 * write surface (`task-state.mjs auto-archive`) imports this function.
 */
export function archiveEligibility(root, taskId) {
  if (RESERVED_TASK_NAMES.has(taskId)) {
    return { ok: false, taskId, reason: `reserved name "${taskId}" is never auto-archived` };
  }
  const route = resolveRoute(root, taskId);
  if (!route.ok) {
    return { ok: false, taskId, reason: `task "${taskId}" not found` };
  }
  const status = normalizeStatus(route.status);
  if (status === 'closed') {
    const state = readRawState(root, taskId, route.archived);
    const queues = state?.queues && typeof state.queues === 'object' ? state.queues : {};
    for (const queue of ['ready', 'running', 'blocked']) {
      if (Array.isArray(queues[queue]) && queues[queue].length > 0) {
        return { ok: false, taskId, status, reason: `${queue} queue is not empty` };
      }
    }
    const unresolved = state?.context?.handoff?.unresolved;
    if (Array.isArray(unresolved) && unresolved.some(item => String(item ?? '').trim().length > 0)) {
      return { ok: false, taskId, status, reason: 'unresolved handoff work remains' };
    }
    const activeProblems = activeProblemBlockers(readProblemMd(root, taskId, route.archived));
    if (activeProblems.length > 0) {
      return { ok: false, taskId, status, reason: `active PROBLEM.md work remains: ${activeProblems[0].problem}` };
    }
    return { ok: true, taskId, status };
  }
  if (NEVER_ARCHIVE_STATUSES.has(status)) {
    return { ok: false, taskId, status, reason: `status "${status}" is never auto-archived` };
  }
  return { ok: false, taskId, status, reason: `status "${status}" is not archive-eligible` };
}

// ---------------------------------------------------------------------------
// Builders (pure)
// ---------------------------------------------------------------------------

/**
 * Build a minimal route stub for index entries. Fields:
 * id, title, status, phase, summary, blockers, dependsOn, blocks,
 * latestEvidenceRefs, path, archived, updatedAt.
 */
export function buildRouteStub(root, taskId) {
  const route = resolveRoute(root, taskId);
  if (!route.ok) throw new Error(`task "${taskId}" not found`);
  const blockers = aggregateBlockers(root, taskId).items.map(i => i.text);
  const evidenceRefs = readEvidenceRefs(root, taskId, route.archived);
  return {
    id: route.id,
    title: route.title,
    status: route.status,
    phase: route.phase,
    summary: summarizeState(readRawState(root, taskId, route.archived)),
    blockers,
    dependsOn: route.dependsOn || [],
    blocks: route.blocks || [],
    latestEvidenceRefs: evidenceRefs,
    path: route.path,
    archivePath: route.archivePath,
    archived: route.archived,
    updatedAt: route.updatedAt,
  };
}

/**
 * Build a resume summary for a task. Fields:
 * id, status, phase, nextAction, activeQuestion, dependencies, blockers,
 * queues, updatedAt.
 */
export function buildResumeSummary(root, taskId) {
  const route = resolveRoute(root, taskId);
  if (!route.ok) throw new Error(`task "${taskId}" not found`);
  const rawState = readRawState(root, taskId, route.archived);
  const blockers = aggregateBlockers(root, taskId).items.map(i => i.text);
  const queues = rawState?.queues || { ready: [], running: [], blocked: [], done: [] };
  return {
    id: route.id,
    status: route.status,
    phase: route.phase,
    nextAction: rawState?.nextAction || null,
    activeQuestion: rawState?.activeQuestion || null,
    dependencies: route.dependsOn || [],
    blockers,
    queues: {
      ready: queues.ready || [],
      running: queues.running || [],
      blocked: queues.blocked || [],
      done: queues.done || [],
    },
    updatedAt: route.updatedAt,
  };
}

/**
 * Build archive index entries for all archived tasks under
 * `<root>/Harness/tasks/_archive/`. Each entry is a minimal route stub.
 * Read-only. The canonical write surface (`task-state.mjs auto-archive`)
 * imports this function when it refreshes `_archive/INDEX.json`.
 */
export function buildArchiveIndexEntries(root) {
  const entries = [];
  const archiveDir = path.join(root, 'Harness', 'tasks', '_archive');
  if (!fs.existsSync(archiveDir)) return entries;

  const yearDirs = fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d{4}$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const year of yearDirs) {
    const yearPath = path.join(archiveDir, year.name);
    const monthDirs = fs.readdirSync(yearPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^\d{2}$/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const month of monthDirs) {
      const monthPath = path.join(yearPath, month.name);
      const dayDirs = fs.readdirSync(monthPath, { withFileTypes: true })
        .filter(e => e.isDirectory() && /^\d{2}$/.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const day of dayDirs) {
        const dayPath = path.join(monthPath, day.name);
        const taskDirs = fs.readdirSync(dayPath, { withFileTypes: true }).filter(e => e.isDirectory());
        for (const taskDir of taskDirs) {
          const statePath = path.join(dayPath, taskDir.name, 'STATE.json');
          const state = safeReadJson(statePath);
          if (!state || typeof state !== 'object') continue;
          const relPath = `Harness/tasks/_archive/${year.name}/${month.name}/${day.name}/${taskDir.name}`;
          entries.push(buildArchiveIndexEntry(relPath, taskDir.name, state));
        }
      }
    }
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

function buildArchiveIndexEntry(archivePath, taskId, state) {
  const status = normalizeStatus(state.status || state.phase || 'closed');
  const phase = normalizePhase(state.phase || state.status || 'archived');
  return {
    id: taskId,
    title: state.title || state.taskId || taskId,
    status,
    phase,
    summary: summarizeState(state),
    blockers: summarizeBlockers(state),
    dependsOn: state?.links?.dependsOn || [],
    blocks: state?.links?.blocks || [],
    latestEvidenceRefs: summarizeEvidence(state),
    archivePath,
    updatedAt: state.updatedAt || null,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mapTask(state, id, archived, relPath) {
  const status = normalizeStatus(state.status || state.phase || '');
  const phase = normalizePhase(state.phase || state.status || '');
  const baseDir = archived ? 'Harness/tasks/_archive' : 'Harness/tasks';
  const fullRelPath = archived && relPath ? relPath : `${baseDir}/${id}`;
  return {
    id,
    title: state.title || state.taskId || id,
    status,
    phase,
    path: fullRelPath,
    archivePath: archived ? fullRelPath : null,
    archived,
    updatedAt: state.updatedAt || null,
    dependsOn: state?.links?.dependsOn || [],
    blocks: state?.links?.blocks || [],
  };
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readRawState(root, taskId, archived) {
  if (archived) {
    const archivedTask = readArchivedTasks(root).find(t => t.id === taskId);
    if (!archivedTask) return null;
    const statePath = path.join(root, archivedTask.path, 'STATE.json');
    return safeReadJson(statePath);
  }
  const statePath = path.join(root, 'Harness', 'tasks', taskId, 'STATE.json');
  return safeReadJson(statePath);
}

function readActivePointer(root) {
  const file = path.join(root, 'Harness', 'PROGRESS.md');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const section = extractSection(text, 'Active Task');
  if (!section) return null;
  const match = section.match(/^-\s+(task-[^\s]+)$/m);
  if (!match) return null;
  const id = match[1].trim();
  if (id === 'None') return null;
  return id;
}

function extractSection(text, heading) {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `## ${heading}`) { start = i + 1; break; }
  }
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  const slice = end === -1 ? lines.slice(start) : lines.slice(start, end);
  return slice.join('\n');
}

function readProblemMd(root, taskId, archived) {
  if (archived) {
    const archivedTask = readArchivedTasks(root).find(t => t.id === taskId);
    if (!archivedTask) return null;
    const file = path.join(root, archivedTask.path, 'PROBLEM.md');
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf8');
  }
  const file = path.join(root, 'Harness', 'tasks', taskId, 'PROBLEM.md');
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function readEvidenceRefs(root, taskId, archived) {
  const rawState = readRawState(root, taskId, archived);
  return summarizeEvidence(rawState);
}

function summarizeState(state) {
  if (!state) return '';
  if (state.summary) return String(state.summary).slice(0, 200);
  if (state.nextAction) return String(state.nextAction).slice(0, 200);
  if (state.title) return String(state.title).slice(0, 200);
  return '';
}

function summarizeBlockers(state) {
  const items = [];
  if (state?.activeQuestion) items.push(String(state.activeQuestion));
  const blocked = state?.queues?.blocked || [];
  for (const entry of blocked) {
    const text = typeof entry === 'string'
      ? entry
      : (entry.reason || entry.text || entry.id || 'blocked queue entry');
    items.push(String(text));
  }
  return items;
}

function summarizeEvidence(state) {
  const refs = [];
  const artifacts = state?.artifacts || [];
  for (const a of artifacts) {
    if (typeof a === 'string') refs.push(a);
    else if (a?.path) refs.push(a.path);
    else if (a?.evidenceRefs) refs.push(...a.evidenceRefs);
  }
  const evidence = state?.context?.evidence || [];
  for (const e of evidence) {
    if (typeof e === 'string') refs.push(e);
    else if (e?.path) refs.push(e.path);
  }
  return Array.from(new Set(refs));
}

function assertSafeTaskId(taskId) {
  if (typeof taskId !== 'string' || !taskId) {
    throw new Error('taskId must be a non-empty string');
  }
  if (taskId.includes('..') || taskId.includes('/') || taskId.includes('\\')) {
    throw new Error(`taskId "${taskId}" contains path traversal`);
  }
  if (RESERVED_TASK_NAMES.has(taskId)) {
    throw new Error(`taskId "${taskId}" is reserved`);
  }
  if (!TASK_ID_RE.test(taskId)) {
    throw new Error(`taskId "${taskId}" does not match task-id pattern`);
  }
}
