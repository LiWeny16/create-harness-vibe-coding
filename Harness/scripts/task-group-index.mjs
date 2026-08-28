#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COMPLETED_DAYS = 3;
const DEFAULT_ACTIVE_DAYS = 7;

// Statuses/phases that mean the task is finished and, if left in Harness/tasks/,
// should eventually be archived. Missing/unknown statuses are not treated as completed.
const COMPLETED_KINDS = new Set([
  'complete',
  'completed',
  'verified',
  'archived',
  'abandoned',
  'obsolete',
  'done',
  'closed',
  'closeout',
  'skipped',
  'failed',
]);

function envDays(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function normalizeKind(value) {
  return String(value || '').trim().toLowerCase();
}

function groupNameFor(state) {
  return String(state?.group || '').trim() || 'default';
}

function daysAgo(nowMs, updatedAt) {
  const time = new Date(updatedAt).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((nowMs - time) / DAY_MS));
}

/**
 * Scan the STATE.json files in an outer tasks directory (skips _-prefixed
 * entries) and produce the group model plus stale/needs-archive entries.
 *
 * Stale rules (thresholds env-overridable via TASK_STALE_COMPLETED_DAYS /
 * TASK_STALE_ACTIVE_DAYS; env wins over explicit options):
 *  (a) completed (status or phase in COMPLETED_KINDS), not archived,
 *      updatedAt older than staleCompletedDays -> needs archive.
 *  (b) status active, updatedAt older than staleActiveDays -> no heartbeat.
 */
export function scanTaskGroups({
  tasksRoot,
  now = new Date(),
  staleCompletedDays = DEFAULT_COMPLETED_DAYS,
  staleActiveDays = DEFAULT_ACTIVE_DAYS,
} = {}) {
  const nowMs = new Date(now).getTime();
  const completedDays = envDays('TASK_STALE_COMPLETED_DAYS', staleCompletedDays);
  const activeDays = envDays('TASK_STALE_ACTIVE_DAYS', staleActiveDays);

  const groups = new Map();
  const stale = [];
  const skipped = [];

  if (!fs.existsSync(tasksRoot)) {
    return {
      groups: [],
      stale,
      skipped,
      staleCompletedDays: completedDays,
      staleActiveDays: activeDays,
      generatedAt: new Date(nowMs).toISOString(),
    };
  }

  const entries = fs.readdirSync(tasksRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const dir = path.join(tasksRoot, entry.name);
    const statePath = path.join(dir, 'STATE.json');
    if (!fs.existsSync(statePath)) continue;
    let state;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      skipped.push({ id: entry.name, reason: 'malformed STATE.json' });
      continue;
    }
    if (state.schemaVersion === undefined || state.schemaVersion === null) {
      skipped.push({ id: entry.name, reason: 'missing schemaVersion' });
      continue;
    }

    const group = groupNameFor(state);
    const status = normalizeKind(state.status);
    const phase = normalizeKind(state.phase);
    const updatedAt = state.updatedAt || null;
    const item = { id: entry.name, status, phase, group, updatedAt };
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);

    const ageDays = updatedAt ? daysAgo(nowMs, updatedAt) : null;
    const isArchived = status === 'archived' || phase === 'archived';
    const isCompleted = COMPLETED_KINDS.has(status) || COMPLETED_KINDS.has(phase);
    if (!isArchived && isCompleted && ageDays !== null && ageDays > completedDays) {
      stale.push({ id: entry.name, kind: 'completed', days: ageDays, updatedAt, status, phase, group });
    } else if (status === 'active' && ageDays !== null && ageDays > activeDays) {
      stale.push({ id: entry.name, kind: 'active', days: ageDays, updatedAt, status, phase, group });
    }
  }

  const groupList = [...groups.entries()]
    .map(([name, tasks]) => ({
      name,
      tasks: tasks.sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort(
      (a, b) => (a.name === 'default' ? 1 : 0) - (b.name === 'default' ? 1 : 0) || a.name.localeCompare(b.name),
    );
  stale.sort(
    (a, b) =>
      (a.kind === 'completed' ? 0 : 1) - (b.kind === 'completed' ? 0 : 1) ||
      a.id.localeCompare(b.id),
  );

  return {
    groups: groupList,
    stale,
    skipped,
    staleCompletedDays: completedDays,
    staleActiveDays: activeDays,
    generatedAt: new Date(nowMs).toISOString(),
  };
}

function formatUpdated(updatedAt) {
  if (!updatedAt) return '-';
  const text = String(updatedAt).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : updatedAt;
}

/**
 * Render the model to the generated GROUPS.md text.
 */
export function renderGroupsMd(model) {
  const lines = ['# Task Groups (generated)', '', `Generated: ${model.generatedAt}`, ''];

  for (const group of model.groups) {
    const count = group.tasks.length;
    lines.push(`## ${group.name} (${count} task${count === 1 ? '' : 's'})`, '');
    lines.push('| Task | Status | Phase | Updated |', '|------|--------|-------|---------|');
    for (const task of group.tasks) {
      lines.push(`| \`${task.id}\` | ${task.status || '-'} | ${task.phase || '-'} | ${formatUpdated(task.updatedAt)} |`);
    }
    lines.push('');
  }

  lines.push('## Needs Archive (stale)', '');
  if (model.stale.length === 0) {
    lines.push('- (none)');
  } else {
    for (const entry of model.stale) {
      if (entry.kind === 'completed') {
        lines.push(`- ${entry.id}: completed ${entry.days}d ago, not archived`);
      } else {
        lines.push(`- ${entry.id}: no heartbeat ${entry.days}d (active)`);
      }
    }
  }
  lines.push('');

  return lines.join('\n');
}

function flagValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function main() {
  const args = process.argv.slice(2);
  const project = flagValue(args, '--project', '.');
  const out = flagValue(args, '--out', null);
  const tasksRoot = path.resolve(project, 'Harness', 'tasks');
  const model = scanTaskGroups({ tasksRoot });
  const text = renderGroupsMd(model);

  const outPath = out ? path.resolve(out) : path.join(tasksRoot, 'GROUPS.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, outPath);

  const taskCount = model.groups.reduce((count, group) => count + group.tasks.length, 0);
  console.log(`GROUPS.md: ${taskCount} tasks in ${model.groups.length} group(s), ${model.stale.length} stale`);
  for (const skippedEntry of model.skipped) {
    console.warn(`Skipped ${skippedEntry.id}: ${skippedEntry.reason}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
