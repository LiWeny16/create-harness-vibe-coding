import fs from 'node:fs';
import path from 'node:path';
import { getComponentNode, listLiveComponentNodes } from './component-node-store.mjs';

// ── File-node change watcher (task-upgrade-file-node AC-3) ──
// Watches the workspace files referenced by file-type component nodes and
// reports external edits via onChange({ nodeId, path, etag }). Each file's
// parent directory is watched with a non-recursive fs.watch; rename/change
// events are debounced (200ms) and then re-verified with fs.stat so only real
// mtime/size changes fire. A 5s stat-compare poll is the fallback — it also
// recovers silently when a watched parent directory is deleted (Windows EPERM)
// or a node is created after startup.
//
// The etag uses the same algorithm as workspace-store.mjs (etagForStat) so the
// reported etag always matches getWorkspaceMeta(...).etag. Keep both in sync.

const CHANGE_DEBOUNCE_MS = 200;
const POLL_INTERVAL_MS = 5000;

// Live watcher instances by canonical project root, so the module-level
// refreshBaseline(projectRoot, relPath) can re-baseline a specific watcher's
// target without threading handles through every caller (L1 self-write
// suppression wiring from server.mjs).
const activeWatchers = new Map(); // absRoot -> { targets: Map<absPath, target> }

function etagForStat(stat) {
  return `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
}

function statKeyFor(stat) {
  return stat ? `${stat.size}:${Math.trunc(stat.mtimeMs)}` : 'missing';
}

function tryStat(absolutePath) {
  try {
    return fs.statSync(absolutePath);
  } catch {
    return null; // missing/deleted — treated as a stat change baseline only
  }
}

/**
 * Watch every workspace file referenced by a file-type component node.
 * @param {string} projectRoot - Absolute path to the project root.
 * @param {{ onChange?: (event: { nodeId: string, path: string, etag: string }) => void }} [options]
 * @returns {{ stop: () => void, close: () => void }}
 */
/**
 * Re-baseline one watched target to its CURRENT on-disk stat so the pending
 * fs.watch/debounce/poll verification sees "no real change" for the next
 * CHANGE_DEBOUNCE_MS window. server.mjs calls this after every successful
 * workspace op (POST /api/workspace/ops) — including file.writeText, which
 * routes through applyWorkspaceOperation — so the server's own writes never
 * surface as external file.changed events (L1). A real external edit that
 * lands afterwards still fires normally.
 * @param {string} projectRoot - Absolute path to the project root.
 * @param {string} relPath - Workspace-relative path of the written file.
 * @returns {boolean} true when a live watcher target was re-baselined.
 */
export function refreshBaseline(projectRoot, relPath) {
  const root = path.resolve(projectRoot);
  const state = activeWatchers.get(root);
  if (!state) return false;
  const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(root, rel);
  const target = state.targets.get(abs);
  if (!target) return false;
  target.statKey = statKeyFor(tryStat(abs));
  return true;
}

export function watchFileNodes(projectRoot, { onChange } = {}) {
  const root = path.resolve(projectRoot);
  const targets = new Map(); // absPath -> { nodeId, path: relPath, statKey }
  activeWatchers.set(root, { targets });
  const dirWatchers = new Map(); // absDir -> fs.FSWatcher
  const pending = new Map(); // absPath -> debounce timer
  let pollTimer = null;
  let stopped = false;

  function isInsideRoot(absolutePath) {
    const relative = path.relative(root, absolutePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  // (Re)scan file-type component nodes, add new targets (baseline stat), drop
  // targets whose node disappeared, and re-establish directory watchers.
  function scanFileNodes() {
    let nodes = [];
    try {
      nodes = listLiveComponentNodes(root);
    } catch {
      return;
    }
    const seen = new Set();
    for (const node of nodes) {
      if (node.type !== 'file') continue;
      let state;
      try {
        state = getComponentNode(root, node.nodeId).state;
      } catch {
        continue; // node vanished between list and read — skip
      }
      const file = state && state.file;
      if (!file || !file.path) continue;
      const rel = String(file.path).replace(/\\/g, '/').replace(/^\/+/, '');
      const abs = path.resolve(root, rel);
      if (!isInsideRoot(abs)) continue; // drifted/escaped reference — ignore
      seen.add(abs);
      let target = targets.get(abs);
      if (!target) {
        target = { nodeId: node.nodeId, path: rel, statKey: null };
        targets.set(abs, target);
      } else {
        target.nodeId = node.nodeId;
        target.path = rel;
      }
      if (target.statKey === null) target.statKey = statKeyFor(tryStat(abs));
    }
    for (const abs of [...targets.keys()]) {
      if (!seen.has(abs)) targets.delete(abs);
    }
  }

  // Deleted parent directories surface as EPERM on fs.watch (Windows) or as
  // plain errors; swallow them and let the poll timer re-establish the watch.
  function ensureDirWatcher(dir) {
    if (dirWatchers.has(dir)) return;
    let watcher;
    try {
      watcher = fs.watch(dir, (_eventType, filename) => {
        if (stopped) return;
        if (filename) {
          handleChange(path.join(dir, String(filename)));
        } else {
          // No filename info: check every target under this directory.
          for (const abs of targets.keys()) {
            if (path.dirname(abs) === dir) handleChange(abs);
          }
        }
      });
    } catch {
      return; // dir missing/EPERM — the 5s poll recovers it
    }
    watcher.on('error', () => {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      dirWatchers.delete(dir);
    });
    dirWatchers.set(dir, watcher);
  }

  function handleChange(abs) {
    const target = targets.get(abs);
    if (!target) return; // only files referenced by file nodes fire events
    if (pending.has(abs)) clearTimeout(pending.get(abs));
    pending.set(abs, setTimeout(() => {
      pending.delete(abs);
      verifyAndEmit(abs);
    }, CHANGE_DEBOUNCE_MS));
  }

  // Post-debounce fs.stat re-check: only an existing file whose mtime/size
  // changed is reported (atomic-write/rename scenarios settle before this).
  function verifyAndEmit(abs) {
    if (stopped) return;
    const target = targets.get(abs);
    if (!target) return;
    const stat = tryStat(abs);
    const statKey = statKeyFor(stat);
    if (statKey === target.statKey) return; // no real change
    target.statKey = statKey;
    if (!stat) return; // deletion is not a change per AC-3 (exists required)
    onChange?.({ nodeId: target.nodeId, path: target.path, etag: etagForStat(stat) });
  }

  // 5s fallback: stat-compare every target (catches events fs.watch missed,
  // e.g. after the watched directory was deleted and recreated).
  function pollOnce() {
    if (stopped) return;
    scanFileNodes();
    for (const abs of targets.keys()) {
      ensureDirWatcher(path.dirname(abs));
      verifyAndEmit(abs);
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    activeWatchers.delete(root);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    for (const watcher of dirWatchers.values()) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
    }
    dirWatchers.clear();
    targets.clear();
  }

  scanFileNodes();
  for (const abs of targets.keys()) ensureDirWatcher(path.dirname(abs));
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);

  return { stop, close: stop };
}
