import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CLEANUP_POLICY = {
  enabled: true,
  autoPruneOnStartup: true,
  autoPruneIntervalHours: 6,
  autoPruneStoppedSessions: false,
  stoppedSessionRetentionDays: 14,
  keepStoppedSessions: 20,
  includeTaskSessions: false,
  detachedLogRetentionHours: 24,
};

const LIVE_STATUSES = new Set(['active', 'blocked', 'in_progress', 'needs-user-decision', 'pending', 'running', 'starting']);
const STOPPED_STATUSES = new Set(['archived', 'closed', 'complete', 'completed', 'done', 'exited', 'saved', 'stopped']);

function numberSetting(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function booleanSetting(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeCleanupPolicy(policy = {}) {
  return {
    enabled: booleanSetting(policy.enabled, DEFAULT_CLEANUP_POLICY.enabled),
    autoPruneOnStartup: booleanSetting(policy.autoPruneOnStartup, DEFAULT_CLEANUP_POLICY.autoPruneOnStartup),
    autoPruneIntervalHours: numberSetting(policy.autoPruneIntervalHours, DEFAULT_CLEANUP_POLICY.autoPruneIntervalHours, { min: 0, max: 168 }),
    autoPruneStoppedSessions: booleanSetting(policy.autoPruneStoppedSessions, DEFAULT_CLEANUP_POLICY.autoPruneStoppedSessions),
    stoppedSessionRetentionDays: numberSetting(policy.stoppedSessionRetentionDays, DEFAULT_CLEANUP_POLICY.stoppedSessionRetentionDays, { min: 0, max: 3650 }),
    keepStoppedSessions: Math.floor(numberSetting(policy.keepStoppedSessions, DEFAULT_CLEANUP_POLICY.keepStoppedSessions, { min: 0, max: 10000 })),
    includeTaskSessions: booleanSetting(policy.includeTaskSessions, DEFAULT_CLEANUP_POLICY.includeTaskSessions),
    detachedLogRetentionHours: numberSetting(policy.detachedLogRetentionHours, DEFAULT_CLEANUP_POLICY.detachedLogRetentionHours, { min: 1, max: 87600 }),
  };
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function safeStat(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch {
    return null;
  }
}

function dirSizeBytes(dir) {
  const stat = safeStat(dir);
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    const childStat = safeStat(child);
    if (!childStat) continue;
    if (childStat.isDirectory() && !childStat.isSymbolicLink()) total += dirSizeBytes(child);
    else total += childStat.size;
  }
  return total;
}

function parseTimeMs(value, fallbackMs) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : fallbackMs;
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function pushSessionDirsFromRoot(dirs, root, taskId = null) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    dirs.push({
      dir,
      taskId,
      sessionId: entry.name,
      relPath: taskId
        ? `Harness/tasks/${taskId}/sessions/${entry.name}`
        : `Harness/a2a/sessions/${entry.name}`,
    });
  }
}

function listSessionDirs(projectRoot) {
  const dirs = [];
  const tasksRoot = path.join(projectRoot, 'Harness', 'tasks');
  let taskEntries = [];
  try {
    taskEntries = fs.readdirSync(tasksRoot, { withFileTypes: true });
  } catch {
    taskEntries = [];
  }
  for (const taskEntry of taskEntries) {
    if (!taskEntry.isDirectory() || taskEntry.name.startsWith('_')) continue;
    pushSessionDirsFromRoot(dirs, path.join(tasksRoot, taskEntry.name, 'sessions'), taskEntry.name);
  }
  pushSessionDirsFromRoot(dirs, path.join(projectRoot, 'Harness', 'a2a', 'sessions'), null);
  return dirs;
}

function isLiveSession(state, liveSessionIds) {
  const sessionId = String(state?.sessionId || '');
  const status = String(state?.status || '').toLowerCase();
  return liveSessionIds.has(sessionId) || LIVE_STATUSES.has(status);
}

function isStoppedSession(state) {
  return STOPPED_STATUSES.has(String(state?.status || '').toLowerCase());
}

function collectSessionTargets(projectRoot, policy, { liveSessionIds = new Set(), now = new Date(), includeStoppedSessions = true } = {}) {
  const nowMs = now.getTime();
  const cutoffMs = nowMs - policy.stoppedSessionRetentionDays * 24 * 60 * 60 * 1000;
  const all = [];
  const stopped = [];

  for (const item of listSessionDirs(projectRoot)) {
    const statePath = path.join(item.dir, 'STATE.json');
    const stat = safeStat(item.dir);
    const state = readJson(statePath, {});
    const sessionId = String(state.sessionId || item.sessionId);
    const taskId = state.taskId || item.taskId || null;
    const updatedMs = parseTimeMs(state.updatedAt || state.lastActivityAt || state.startedAt, stat?.mtimeMs || 0);
    const target = {
      sessionId,
      taskId,
      status: String(state.status || 'unknown'),
      runtime: state.runtime || null,
      updatedAt: Number.isFinite(updatedMs) && updatedMs > 0 ? new Date(updatedMs).toISOString() : null,
      updatedMs,
      bytes: dirSizeBytes(item.dir),
      relPath: item.relPath,
      dir: item.dir,
    };
    all.push(target);
    if (!includeStoppedSessions) continue;
    if (taskId && !policy.includeTaskSessions) continue;
    if (isLiveSession({ ...state, sessionId }, liveSessionIds)) continue;
    if (!isStoppedSession(state)) continue;
    stopped.push(target);
  }

  stopped.sort((a, b) => b.updatedMs - a.updatedMs || a.sessionId.localeCompare(b.sessionId));
  const keptByCount = new Set(stopped.slice(0, policy.keepStoppedSessions).map(target => target.sessionId));
  const eligible = stopped
    .filter((target) => target.updatedMs <= cutoffMs || !keptByCount.has(target.sessionId))
    .sort((a, b) => a.updatedMs - b.updatedMs || a.sessionId.localeCompare(b.sessionId));

  return { all, stopped, eligible };
}

function collectDetachedLogTargets(policy, { tempRoot, now = new Date(), currentReadyFile = process.env.HARNESS_WF_UI_READY_FILE, includeTempLogs = true } = {}) {
  if (!tempRoot) return { all: [], eligible: [] };
  if (!includeTempLogs) return { all: [], eligible: [] };
  const root = path.resolve(tempRoot);
  const currentDir = currentReadyFile ? path.resolve(path.dirname(currentReadyFile)) : null;
  const cutoffMs = now.getTime() - policy.detachedLogRetentionHours * 60 * 60 * 1000;
  const all = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { all, eligible: [] };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('harness-wf-ui-')) continue;
    const dir = path.join(root, entry.name);
    const resolved = path.resolve(dir);
    const stat = safeStat(dir);
    if (!stat) continue;
    const ready = readJson(path.join(dir, 'ready.json'), {});
    const active = currentDir === resolved || isPidAlive(ready?.pid);
    const target = {
      name: entry.name,
      dir,
      relPath: entry.name,
      updatedAt: new Date(stat.mtimeMs).toISOString(),
      updatedMs: stat.mtimeMs,
      bytes: dirSizeBytes(dir),
      current: active,
      root,
    };
    all.push(target);
  }
  const eligible = all
    .filter(target => !target.current && target.updatedMs <= cutoffMs)
    .sort((a, b) => a.updatedMs - b.updatedMs || a.name.localeCompare(b.name));
  return { all, eligible };
}

function defaultDetachedLogRoot(projectRoot) {
  return path.join(projectRoot || process.cwd(), 'Harness', '.temp', 'wf-ui-launch');
}

function detachedLogRoots(projectRoot, options = {}) {
  if (options.tempRoot) return [path.resolve(options.tempRoot)];
  return [path.resolve(defaultDetachedLogRoot(projectRoot))];
}

function collectDetachedLogTargetsFromRoots(projectRoot, policy, options = {}) {
  const all = [];
  const eligible = [];
  const seenAll = new Set();
  const seenEligible = new Set();

  for (const tempRoot of detachedLogRoots(projectRoot, options)) {
    const collected = collectDetachedLogTargets(policy, { ...options, tempRoot });
    for (const target of collected.all) {
      const key = path.resolve(target.dir);
      if (seenAll.has(key)) continue;
      seenAll.add(key);
      all.push(target);
    }
    for (const target of collected.eligible) {
      const key = path.resolve(target.dir);
      if (seenEligible.has(key)) continue;
      seenEligible.add(key);
      eligible.push(target);
    }
  }

  eligible.sort((a, b) => a.updatedMs - b.updatedMs || a.name.localeCompare(b.name));
  return { all, eligible };
}

function summarizeTargets(targets) {
  return {
    totalCount: targets.all.length,
    stoppedCount: targets.stopped?.length,
    eligibleCount: targets.eligible.length,
    totalBytes: targets.all.reduce((sum, target) => sum + target.bytes, 0),
    eligibleBytes: targets.eligible.reduce((sum, target) => sum + target.bytes, 0),
  };
}

function publicTarget(target) {
  const { dir, root, updatedMs, ...safe } = target;
  return safe;
}

export function buildCleanupSummary(projectRoot, policy = {}, options = {}) {
  const normalized = normalizeCleanupPolicy(policy);
  const sessionTargets = collectSessionTargets(projectRoot, normalized, options);
  const tempLogTargets = collectDetachedLogTargetsFromRoots(projectRoot, normalized, options);
  const summary = {
    generatedAt: (options.now || new Date()).toISOString(),
    applied: false,
    policy: normalized,
    sessions: summarizeTargets(sessionTargets),
    tempLogs: summarizeTargets({ all: tempLogTargets.all, eligible: tempLogTargets.eligible }),
    totals: {
      eligibleCount: sessionTargets.eligible.length + tempLogTargets.eligible.length,
      eligibleBytes: sessionTargets.eligible.reduce((sum, target) => sum + target.bytes, 0)
        + tempLogTargets.eligible.reduce((sum, target) => sum + target.bytes, 0),
    },
    targets: {
      sessions: sessionTargets.eligible.map(publicTarget),
      tempLogs: tempLogTargets.eligible.map(publicTarget),
    },
  };
  if (options.includeInternal) {
    summary._internal = {
      sessions: sessionTargets.eligible,
      tempLogs: tempLogTargets.eligible,
    };
  }
  return summary;
}

function isWithin(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isSafeSessionDir(projectRoot, dir) {
  const harnessRoot = path.join(projectRoot, 'Harness');
  if (!isWithin(harnessRoot, dir)) return false;
  const rel = path.relative(harnessRoot, dir).replace(/\\/g, '/');
  return rel.startsWith('a2a/sessions/') || /^tasks\/[^/]+\/sessions\/[^/]+$/.test(rel);
}

function isSafeDetachedLogDir(tempRoot, dir, currentReadyFile) {
  if (!isWithin(tempRoot, dir)) return false;
  if (!path.basename(dir).startsWith('harness-wf-ui-')) return false;
  if (currentReadyFile && path.resolve(path.dirname(currentReadyFile)) === path.resolve(dir)) return false;
  return true;
}

function removeEmptyDir(dir) {
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // Directory may have been removed or may still contain sibling sessions.
  }
}

export function pruneCleanupTargets(projectRoot, policy = {}, options = {}) {
  const summary = buildCleanupSummary(projectRoot, policy, { ...options, includeInternal: true });
  const result = {
    ...summary,
    applied: Boolean(options.apply),
    deleted: { sessions: [], tempLogs: [] },
    errors: [],
  };
  delete result._internal;
  if (!options.apply) return result;

  const currentReadyFile = options.currentReadyFile || process.env.HARNESS_WF_UI_READY_FILE;
  const internal = summary._internal || { sessions: [], tempLogs: [] };
  for (const target of internal.sessions) {
    try {
      if (!isSafeSessionDir(projectRoot, target.dir)) throw new Error('unsafe session path');
      fs.rmSync(target.dir, { recursive: true, force: true });
      removeEmptyDir(path.dirname(target.dir));
      result.deleted.sessions.push(publicTarget(target));
    } catch (err) {
      result.errors.push({ relPath: target.relPath, message: err.message });
    }
  }
  for (const target of internal.tempLogs) {
    try {
      const tempRoot = target.root || defaultDetachedLogRoot(projectRoot);
      if (!isSafeDetachedLogDir(tempRoot, target.dir, currentReadyFile)) throw new Error('unsafe temp log path');
      fs.rmSync(target.dir, { recursive: true, force: true });
      result.deleted.tempLogs.push(publicTarget(target));
    } catch (err) {
      result.errors.push({ relPath: target.relPath, message: err.message });
    }
  }
  return result;
}
