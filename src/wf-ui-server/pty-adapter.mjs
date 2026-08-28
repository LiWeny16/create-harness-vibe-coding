import { ALLOWED_RUNTIMES, generateSessionId } from './session-registry.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// node:sqlite (DatabaseSync) is loaded lazily through createRequire so older
// Node versions that lack the builtin never crash pty-adapter at import time.
const require = createRequire(import.meta.url);
import {
  getRuntimeDefinition,
  isRuntimeLaunchable,
  resolveRuntimeCommand,
  resolveRuntimeLaunchArgs,
} from './runtime-detector.mjs';
import {
  codexUpdatePromptControlEnabled,
  createCodexUpdatePromptDetector,
  stripTerminalControls,
} from './codex-update-prompt.mjs';
import { buildHarnessEnvSession } from './harness-env.mjs';

async function loadPtyModule() {
  const attempts = [
    {
      id: 'node-pty',
      hint: 'Install node-pty or @homebridge/node-pty-prebuilt-multiarch.',
      load: () => import('node-pty'),
    },
    {
      id: '@homebridge/node-pty-prebuilt-multiarch',
      hint: 'Install optional dependency @homebridge/node-pty-prebuilt-multiarch and approve its build scripts for pnpm.',
      load: () => import('@homebridge/node-pty-prebuilt-multiarch'),
    },
  ];

  const errors = [];
  for (const attempt of attempts) {
    try {
      const loaded = await attempt.load();
      const module = loaded.default || loaded;
      if (module && typeof module.spawn === 'function') {
        return { module, provider: attempt.id };
      }
      errors.push(`${attempt.id}: spawn export missing`);
    } catch (err) {
      errors.push(`${attempt.id}: ${err.message}`);
    }
  }

  return {
    blocked: true,
    reason: 'pty-adapter-missing',
    hint: `No PTY backend could be loaded. ${attempts[1].hint}`,
    details: errors,
  };
}

export function resolvePtyCommand(executable, args) {
  if (process.platform !== 'win32') return { executable, args };
  const ext = path.extname(executable).toLowerCase();
  if (ext !== '.cmd' && ext !== '.bat') return { executable, args };
  return {
    executable: 'cmd.exe',
    args: ['/d', '/c', 'call', executable, ...args],
  };
}

export function windowsPtyOptions() {
  if (process.platform !== 'win32') return {};
  return {
    useConpty: true,
    useConptyDll: process.env.HARNESS_WF_UI_USE_SYSTEM_CONPTY !== '1',
  };
}

/**
 * Codex rollout-id detector (secondary, confirmation-gated).
 *
 * Codex keys its saved sessions by an internal rollout UUID. Newer codex
 * TUI versions never print this UUID to PTY output (verified against real
 * sessions), so the primary source is the filesystem capture below. This
 * output-scanner is kept for runtimes/builds that do print a session-context
 * UUID at boot (e.g. `Session 019ffa1b-...`), but it never fires on its own:
 * when `sessionsDir` is provided, a captured PTY-line UUID must ALSO exist as
 * a real rollout-*.jsonl file in the sessions dir before it is reported.
 * Resume error lines (`No saved session found with ID <harness-uuid>`) carry
 * the harness session id, which never matches a rollout file, so they are
 * ignored instead of poisoning the persisted rollout id.
 *
 * Same shape as createCodexUpdatePromptDetector: observe(chunk) returns a
 * control request once (type 'codex:rollout-id', payload { rolloutId }).
 */
export const CODEX_ROLLOUT_ID_CAPTURE_WINDOW_MS = 30000;
const ROLLOUT_BUFFER_CHARS = 6000;
const CODEX_ROLLOUT_UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const CODEX_ROLLOUT_CONTEXT_PATTERN = /session|rollout/i;

export function createCodexRolloutIdDetector({ enabled = true, windowMs = CODEX_ROLLOUT_ID_CAPTURE_WINDOW_MS, sessionsDir = null } = {}) {
  let buffer = '';
  let captured = null;
  let expired = false;
  // Any finite offset is honored (negative = already past the window); a
  // non-finite value falls back to the default window.
  const captureWindowMs = Number.isFinite(windowMs) ? windowMs : CODEX_ROLLOUT_ID_CAPTURE_WINDOW_MS;
  const startedAt = Date.now();

  function scan(text) {
    for (const line of String(text).split(/\r?\n/)) {
      if (!CODEX_ROLLOUT_CONTEXT_PATTERN.test(line)) continue;
      const match = line.match(CODEX_ROLLOUT_UUID_PATTERN);
      if (!match) continue;
      const candidate = match[0].toLowerCase();
      // Anti-false-positive guard: a PTY line mentioning a uuid is only a
      // rollout when a real rollout-*.jsonl file with that uuid exists in the
      // sessions dir. Without an fs match the line is a resume error message,
      // not a rollout, so it must not fire or persist.
      if (sessionsDir && !rolloutIdExistsInSessionsDir(sessionsDir, candidate)) continue;
      return candidate;
    }
    return null;
  }

  return {
    observe(chunk) {
      if (!enabled || captured || expired) return null;
      if (Date.now() - startedAt > captureWindowMs) {
        expired = true;
        return null;
      }
      buffer = stripTerminalControls(`${buffer}${chunk || ''}`).slice(-ROLLOUT_BUFFER_CHARS);
      const rolloutId = scan(buffer);
      if (!rolloutId) return null;
      captured = rolloutId;
      return {
        reason: 'codex-rollout-id-detected',
        type: 'codex:rollout-id',
        payload: { rolloutId },
      };
    },
    get rolloutId() {
      return captured;
    },
    get active() {
      return enabled && !captured && !expired;
    },
  };
}

/**
 * Codex rollout-id filesystem capture (primary).
 *
 * codex 0.147.x TUI never prints its rollout UUID to the PTY; the UUID lives
 * in codex's sessions dir (`~/.codex/sessions`, or `$CODEX_HOME/sessions`)
 * under a per-day nested layout
 * `sessions/<YYYY>/<MM>/<DD>/rollout-<timestamp>-<uuid>.jsonl` (e.g.
 * `sessions/2026/08/13/rollout-2026-08-13T16-21-24-019ffa36-34a1-7923-ab6b-c66732a1e06e.jsonl`),
 * so every scan below walks the tree recursively (depth-bounded). This
 * capture snapshots the rollout files before spawn (baseline) and polls for
 * a NEW rollout file, extracting the UUID from the filename and emitting the
 * same control request the PTY detector emits:
 * `{ type: 'codex:rollout-id', payload: { rolloutId } }`.
 *
 * The window and poll interval default to 240s/2s and can be shortened via
 * CODEX_ROLLOUT_FS_CAPTURE_WINDOW_MS / CODEX_ROLLOUT_FS_POLL_MS (used in
 * tests). Returns a handle with start()/stop(), rolloutId, and active.
 */
export const CODEX_ROLLOUT_FS_CAPTURE_WINDOW_MS = 240000;
export const CODEX_ROLLOUT_FS_POLL_MS = 2000;
const ROLLOUT_FS_MTIME_SLACK_MS = 2000;
// Timestamp is dash-separated (2026-08-13T16-21-24); the trailing dash-delimited
// segment must be a canonical 8-4-4-4-12 UUID before `.jsonl`.
const CODEX_ROLLOUT_FILENAME_PATTERN = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
// Real layout is sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl (3 dir levels);
// one extra level of headroom keeps the walk bounded on any odd variant.
export const CODEX_ROLLOUT_SCAN_MAX_DEPTH = 4;

export function codexSessionsDir() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(codexHome, 'sessions');
}

export function extractRolloutIdFromFilename(filename) {
  const match = CODEX_ROLLOUT_FILENAME_PATTERN.exec(String(filename || ''));
  return match ? match[1].toLowerCase() : null;
}

/**
 * Recursive, depth-bounded walk of the codex sessions dir. Returns a Map of
 * posix-style relative paths (from sessionsDir) to mtimeMs (null when the file
 * is unreadable) for every rollout-*.jsonl file found. A flat readdir never
 * sees the real `YYYY/MM/DD` layout, so this is the single source of truth
 * for both the baseline snapshot and the capture poller.
 */
function collectRolloutFiles(sessionsDir, maxDepth = CODEX_ROLLOUT_SCAN_MAX_DEPTH) {
  const found = new Map();
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || extractRolloutIdFromFilename(entry.name) === null) continue;
      const relPath = path.relative(sessionsDir, fullPath).split(path.sep).join('/');
      let mtimeMs = null;
      try {
        mtimeMs = fs.statSync(fullPath).mtimeMs;
      } catch {
        // Unreadable file: keep it with null mtime so existence checks still see it.
      }
      found.set(relPath, mtimeMs);
    }
  }
  walk(sessionsDir, 0);
  return found;
}

/**
 * True when a rollout-*.jsonl file whose uuid equals `rolloutId` exists
 * anywhere under the sessions dir (recursive). Used by the PTY detector to
 * confirm a PTY-line uuid against the filesystem before it may fire.
 */
export function rolloutIdExistsInSessionsDir(sessionsDir, rolloutId) {
  const target = String(rolloutId || '').toLowerCase();
  if (!target) return false;
  for (const relPath of collectRolloutFiles(sessionsDir).keys()) {
    if (extractRolloutIdFromFilename(path.basename(relPath)) === target) return true;
  }
  return false;
}

export function snapshotRolloutFilenames(sessionsDir) {
  return new Set(collectRolloutFiles(sessionsDir).keys());
}

function readEnvCaptureMs(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createCodexRolloutFsCapture({
  sessionsDir,
  baselineFiles = new Set(),
  spawnTime = Date.now(),
  windowMs = readEnvCaptureMs('CODEX_ROLLOUT_FS_CAPTURE_WINDOW_MS', CODEX_ROLLOUT_FS_CAPTURE_WINDOW_MS),
  pollMs = readEnvCaptureMs('CODEX_ROLLOUT_FS_POLL_MS', CODEX_ROLLOUT_FS_POLL_MS),
  onControlRequest,
} = {}) {
  let timer = null;
  let capturedRolloutId = null;
  let expired = false;
  const startedAt = Date.now();

  function scan() {
    for (const [relPath, mtimeMs] of collectRolloutFiles(sessionsDir)) {
      if (baselineFiles.has(relPath)) continue;
      const rolloutId = extractRolloutIdFromFilename(path.basename(relPath));
      if (!rolloutId) continue;
      if (mtimeMs === null || mtimeMs >= spawnTime - ROLLOUT_FS_MTIME_SLACK_MS) {
        return rolloutId;
      }
    }
    return null;
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function tick() {
    if (capturedRolloutId) {
      stop();
      return;
    }
    if (Date.now() - startedAt >= windowMs) {
      expired = true;
      stop();
      return;
    }
    const rolloutId = scan();
    if (!rolloutId) return;
    capturedRolloutId = rolloutId;
    stop();
    if (typeof onControlRequest === 'function') {
      onControlRequest({
        reason: 'codex-rollout-id-detected',
        type: 'codex:rollout-id',
        payload: { rolloutId },
      });
    }
  }

  return {
    start() {
      if (timer || capturedRolloutId || expired) return;
      timer = setInterval(tick, pollMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop,
    get rolloutId() {
      return capturedRolloutId;
    },
    get active() {
      return !capturedRolloutId && !expired;
    },
  };
}

/**
 * OpenCode session-id capture.
 *
 * opencode 1.18.x never prints its session id to the PTY; sessions are stored
 * in the opencode SQLite db (`~/.local/share/opencode/opencode.db`, or
 * `$OPENCODE_DB`) in the `session` table keyed by `directory` (forward-slash
 * normalized cwd). This capture snapshots the newest session row for the
 * spawn directory BEFORE spawn (baseline) and polls the db for a NEW row
 * (id prefix `ses_`), emitting the same control-request shape as the codex
 * rollout capture: `{ type: 'opencode:session-id', payload: { sessionId } }`.
 *
 * The window and poll interval default to 240s/2s and can be shortened via
 * OPENCODE_SESSION_CAPTURE_WINDOW_MS / OPENCODE_SESSION_POLL_MS (used in
 * tests). Returns a handle with start()/stop(), sessionId, and active.
 * The capture is skipped when the db file is missing; schema/query failures
 * never throw — they simply yield no event until the window expires.
 */
export const OPENCODE_SESSION_CAPTURE_WINDOW_MS = 240000;
export const OPENCODE_SESSION_POLL_MS = 2000;

export function opencodeDbPath() {
  return process.env.OPENCODE_DB || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

// opencode stores the session `directory` with forward slashes on every
// platform, so a Windows cwd must be normalized before matching.
export function opencodeSessionDirectory(cwd) {
  return String(cwd || '').replace(/\\/g, '/');
}

export function queryOpencodeLatestSessionId(dbPath, directory) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(String(dbPath), { readOnly: true });
    try {
      const row = db
        .prepare('SELECT id FROM session WHERE directory = ? ORDER BY time_created DESC LIMIT 1')
        .get(String(directory || ''));
      return row ? String(row.id || '') : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export function createOpencodeSessionIdCapture({
  dbPath,
  directory,
  baselineId = null,
  windowMs = readEnvCaptureMs('OPENCODE_SESSION_CAPTURE_WINDOW_MS', OPENCODE_SESSION_CAPTURE_WINDOW_MS),
  pollMs = readEnvCaptureMs('OPENCODE_SESSION_POLL_MS', OPENCODE_SESSION_POLL_MS),
  onControlRequest,
} = {}) {
  let timer = null;
  let capturedSessionId = null;
  let expired = false;
  const startedAt = Date.now();

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function tick() {
    if (capturedSessionId) {
      stop();
      return;
    }
    if (Date.now() - startedAt >= windowMs) {
      expired = true;
      stop();
      return;
    }
    const latestId = queryOpencodeLatestSessionId(dbPath, directory);
    if (!latestId || latestId === baselineId || !String(latestId).startsWith('ses_')) return;
    capturedSessionId = latestId;
    stop();
    if (typeof onControlRequest === 'function') {
      onControlRequest({
        reason: 'opencode-session-id-detected',
        type: 'opencode:session-id',
        payload: { sessionId: latestId },
      });
    }
  }

  return {
    start() {
      if (timer || capturedSessionId || expired) return;
      timer = setInterval(tick, pollMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop,
    get sessionId() {
      return capturedSessionId;
    },
    get active() {
      return !capturedSessionId && !expired;
    },
  };
}

/**
 * Resolve the launch argument list for a runtime PTY spawn.
 *
 * Pure helper (no PTY side effects) so the claude pre-assign flag can be
 * asserted in unit tests. Claude Code pre-assigns its conversation session id
 * at spawn via `--session-id <uuid>` (deterministic, zero polling); resume
 * spawns never carry agentSessionId, so the flag is never combined with
 * resume args.
 */
export function resolveSpawnArgs(runtime, {
  model,
  launchPolicy,
  initialPrompt,
  agentSessionId,
  commandArgs = [],
} = {}) {
  const args = [
    ...resolveRuntimeLaunchArgs(runtime, { model, launchPolicy, initialPrompt }),
    ...commandArgs,
  ];
  if ((runtime === 'claude' || runtime === 'cc') && agentSessionId) {
    args.push('--session-id', String(agentSessionId));
  }
  return args;
}

/**
 * Spawn a PTY for a given runtime agent.
 *
 * Dynamically imports node-pty, then the prebuilt Homebridge fork. If both fail,
 * returns a BLOCKED response. Never silently falls back to a fake terminal.
 *
 * @param {object} opts
 * @param {string} opts.runtime - Agent runtime (claude, codex, opencode)
 * @param {string|null} opts.taskId - Optional task ID for the session
 * @param {string} opts.peerId - Peer identifier
 * @param {string} opts.projectRoot - Project root directory
 * @param {string} [opts.cwd] - Working directory for the PTY
 * @param {string} [opts.command] - Resolved executable command from detector
 * @param {string[]} [opts.commandArgs] - Extra args appended after runtime launch args
 * @param {string} [opts.agentSessionId] - Pre-assigned runtime session id for claude/cc (appended as --session-id)
 * @param {string} [opts.model] - Optional model override for runtimes that support it
 * @param {string} [opts.initialPrompt] - Optional initial prompt passed through the runtime CLI
 * @param {number} [opts.cols=120] - Terminal columns
 * @param {number} [opts.rows=32] - Terminal rows
 * @param {function} opts.onData - Callback for PTY output data (chunk) => void
 * @param {function} [opts.onControlRequest] - Callback when PTY output needs frontend-controlled input
 * @param {function} opts.onExit - Callback for PTY exit ({ exitCode, signal }) => void
 * @returns {Promise<{sessionId: string, pid: number, ptyProcess: object}|{blocked: boolean, reason: string, hint: string}>}
 * @throws {Error} If runtime is not in ALLOWED_RUNTIMES
 */
export async function spawnPty({
  runtime,
  taskId,
  peerId,
  projectRoot,
  cwd,
  sessionId,
  command,
  commandArgs = [],
  agentSessionId,
  model = '',
  initialPrompt = '',
  launchPolicy = null,
  controlPlaneUrl = '',
  controlPlaneToken = '',
  agentKind = '',
  workflowMode = '',
  subagentMode = '',
  graphNodeId = '',
  graphContextPath = '',
  nodeHomePath = '',
  nodeInitPath = '',
  cols = 120,
  rows = 32,
  onData,
  onControlRequest,
  onExit,
}) {
  // Validate runtime before anything else
  if (!ALLOWED_RUNTIMES.has(runtime)) {
    throw new Error(`Invalid runtime '${runtime}'. Must be one of: ${[...ALLOWED_RUNTIMES].join(', ')}`);
  }

  const definition = getRuntimeDefinition(runtime);
  if (!isRuntimeLaunchable(runtime)) {
    return {
      blocked: true,
      reason: 'runtime-adapter-needed',
      hint: `${definition?.label || runtime} is detectable but does not yet have a launch adapter.`,
    };
  }

  const loadedPty = await loadPtyModule();
  if (loadedPty.blocked) return loadedPty;
  const nodePty = loadedPty.module;

  const resolvedSessionId = sessionId || generateSessionId();

  const requestedExecutable = command || resolveRuntimeCommand(runtime);
  const requestedArgs = resolveSpawnArgs(runtime, { model, launchPolicy, initialPrompt, agentSessionId, commandArgs });
  const { executable, args: launchArgs } = resolvePtyCommand(requestedExecutable, requestedArgs);

  // Baseline snapshot of codex rollout files BEFORE spawn; the fs capture
  // started after spawn only reports rollout-*.jsonl files that appear after
  // this point, so pre-existing sessions can never be mistaken for new ones.
  const codexRolloutSessionsDir = runtime === 'codex' ? codexSessionsDir() : null;
  const codexRolloutBaseline = codexRolloutSessionsDir ? snapshotRolloutFilenames(codexRolloutSessionsDir) : new Set();
  const codexSpawnTimestamp = Date.now();

  // Baseline snapshot of the opencode session db BEFORE spawn; the sqlite
  // capture started after spawn only reports session rows that appear after
  // this point, so pre-existing sessions can never be mistaken for new ones.
  const spawnCwd = cwd || projectRoot || process.cwd();
  const opencodeDb = runtime === 'opencode' ? opencodeDbPath() : null;
  const opencodeSessionDir = opencodeDb ? opencodeSessionDirectory(spawnCwd) : '';
  const opencodeBaselineId = opencodeDb && fs.existsSync(opencodeDb)
    ? queryOpencodeLatestSessionId(opencodeDb, opencodeSessionDir)
    : null;

  let ptyProcess;
  try {
    ptyProcess = nodePty.spawn(executable, launchArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || projectRoot || process.cwd(),
      ...windowsPtyOptions(),
      env: buildHarnessEnvSession({
        runtime,
        agentKind,
        workflowMode,
        graphNodeId,
        graphContextPath,
        nodeHomePath,
        nodeInitPath,
        subagentMode,
        controlPlaneUrl,
        taskId,
        peerId,
        sessionId: resolvedSessionId,
      }),
    });
  } catch (err) {
    return {
      blocked: true,
      reason: 'runtime-spawn-failed',
      hint: `${runtime} executable not found or failed to start: ${err.message}`,
    };
  }

  const pid = ptyProcess.pid;
  const codexUpdateDetector = createCodexUpdatePromptDetector({
    enabled: runtime === 'codex' && codexUpdatePromptControlEnabled(),
  });
  // Secondary, confirmation-gated source: a PTY-line uuid only fires when a
  // real rollout-*.jsonl file with that uuid exists in the sessions dir, so
  // resume error lines (`No saved session found with ID <harness-uuid>`) can
  // never poison the captured rollout id.
  const codexRolloutIdDetector = createCodexRolloutIdDetector({
    enabled: runtime === 'codex',
    sessionsDir: codexRolloutSessionsDir,
  });
  // Primary rollout-id source: watch the codex sessions dir (recursively, the
  // real layout is sessions/YYYY/MM/DD/) for the new rollout-*.jsonl file
  // codex writes at session start (the TUI never prints the UUID). Bounded by
  // CODEX_ROLLOUT_FS_CAPTURE_WINDOW_MS.
  if (codexRolloutSessionsDir && typeof onControlRequest === 'function') {
    const rolloutFsCapture = createCodexRolloutFsCapture({
      sessionsDir: codexRolloutSessionsDir,
      baselineFiles: codexRolloutBaseline,
      spawnTime: codexSpawnTimestamp,
      onControlRequest,
    });
    rolloutFsCapture.start();
  }
  // Primary opencode session-id source: watch the opencode session table for
  // the new ses_ row opencode writes at session start (the TUI never prints
  // the id). Bounded by OPENCODE_SESSION_CAPTURE_WINDOW_MS.
  if (opencodeDb && fs.existsSync(opencodeDb) && typeof onControlRequest === 'function') {
    const opencodeCapture = createOpencodeSessionIdCapture({
      dbPath: opencodeDb,
      directory: opencodeSessionDir,
      baselineId: opencodeBaselineId,
      onControlRequest,
    });
    opencodeCapture.start();
  }

  ptyProcess.onData((data) => {
    if (typeof onData === 'function') {
      onData(data);
    }
    const controlRequest = codexUpdateDetector.observe(data);
    if (controlRequest && typeof onControlRequest === 'function') {
      onControlRequest(controlRequest);
    }
    const rolloutRequest = codexRolloutIdDetector.observe(data);
    if (rolloutRequest && typeof onControlRequest === 'function') {
      onControlRequest(rolloutRequest);
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    if (typeof onExit === 'function') {
      onExit({ exitCode, signal });
    }
  });

  return { sessionId: resolvedSessionId, pid, ptyProcess, ptyProvider: loadedPty.provider };
}
