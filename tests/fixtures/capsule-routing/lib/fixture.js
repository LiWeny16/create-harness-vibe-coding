import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../support/temp-root.js';

export const CAPSULE_FIXTURE_ROOT = path.resolve('tests/fixtures/capsule-routing');
export const CAPSULE_BASE_FIXTURE_ROOT = path.join(CAPSULE_FIXTURE_ROOT, 'base');

const tempRoots = new Set();

export function track(root) {
  tempRoots.add(root);
  return root;
}

export function cleanupCapsuleFixtures() {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
}

/**
 * Copy the shared capsule-routing base fixture into a fresh temp root.
 * The base fixture ships Harness/PROGRESS.md, INDEX.json and a small set of
 * task capsules in every canonical state (active, blocked, closed, archived,
 * legacy) so that route/focus/blocker tests can assert against a stable
 * snapshot instead of reconstructing the tree per test.
 */
export function makeCapsuleProject(prefix = 'capsule-routing-') {
  const root = makeHarnessTempRoot(prefix);
  track(root);
  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(CAPSULE_BASE_FIXTURE_ROOT, root, { recursive: true });
  return root;
}

export function writeTaskState(root, taskId, state, { archive = false } = {}) {
  const base = archive
    ? path.join(root, 'Harness', 'tasks', '_archive', '2026', '01', '01')
    : path.join(root, 'Harness', 'tasks');
  const dir = path.join(base, taskId);
  fs.mkdirSync(dir, { recursive: true });
  const existing = readTaskStateFile(root, taskId, { archive });
  const merged = {
    schemaVersion: 1,
    taskId,
    status: 'active',
    mode: 'direct',
    tier: 'none',
    phase: 'implement',
    gate: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    activeQuestion: null,
    nextAction: 'Default next action.',
    acceptance: [],
    queues: { ready: [], running: [], blocked: [], done: [] },
    dispatchLedger: [],
    decisions: [],
    risks: [],
    artifacts: [],
    links: { dependsOn: [], blocks: [], related: [] },
    ...(existing || {}),
    ...state,
  };
  merged.taskId = taskId;
  fs.writeFileSync(path.join(dir, 'STATE.json'), JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return dir;
}

export function readTaskStateFile(root, taskId, { archive = false } = {}) {
  const base = archive
    ? path.join(root, 'Harness', 'tasks', '_archive', '2026', '01', '01')
    : path.join(root, 'Harness', 'tasks');
  const file = path.join(base, taskId, 'STATE.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeTaskFile(root, taskId, name, content, { archive = false } = {}) {
  const base = archive
    ? path.join(root, 'Harness', 'tasks', '_archive', '2026', '01', '01')
    : path.join(root, 'Harness', 'tasks');
  const dir = path.join(base, taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

export function writeArchiveIndex(root, tasks) {
  const file = path.join(root, 'Harness', 'tasks', '_archive', 'INDEX.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(tasks, null, 2) + '\n', 'utf8');
}

export function readArchiveIndex(root) {
  const file = path.join(root, 'Harness', 'tasks', '_archive', 'INDEX.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
