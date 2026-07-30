import { ALLOWED_RUNTIMES, generateSessionId } from './session-registry.mjs';
import path from 'node:path';
import {
  getRuntimeDefinition,
  isRuntimeLaunchable,
  resolveRuntimeCommand,
  resolveRuntimeLaunchArgs,
} from './runtime-detector.mjs';

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
 * @param {string} [opts.command] - Resolved executable command from detector
 * @param {string[]} [opts.commandArgs] - Extra args appended after runtime launch args
 * @param {string} [opts.model] - Optional model override for runtimes that support it
 * @param {number} [opts.cols=120] - Terminal columns
 * @param {number} [opts.rows=32] - Terminal rows
 * @param {function} opts.onData - Callback for PTY output data (chunk) => void
 * @param {function} opts.onExit - Callback for PTY exit ({ exitCode, signal }) => void
 * @returns {Promise<{sessionId: string, pid: number, ptyProcess: object}|{blocked: boolean, reason: string, hint: string}>}
 * @throws {Error} If runtime is not in ALLOWED_RUNTIMES
 */
export async function spawnPty({
  runtime,
  taskId,
  peerId,
  projectRoot,
  sessionId,
  command,
  commandArgs = [],
  model = '',
  cols = 120,
  rows = 32,
  onData,
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
  const requestedArgs = [...resolveRuntimeLaunchArgs(runtime, { model }), ...commandArgs];
  const { executable, args: launchArgs } = resolvePtyCommand(requestedExecutable, requestedArgs);

  let ptyProcess;
  try {
    ptyProcess = nodePty.spawn(executable, launchArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: projectRoot || process.cwd(),
      env: {
        ...process.env,
        HARNESS_PEER_RUNTIME: runtime,
        CLAUDE_PEER_TASK_ID: taskId || '',
        HARNESS_PEER_TASK_ID: taskId || '',
        CLAUDE_PEER_ID: peerId,
        HARNESS_PEER_SESSION_ID: resolvedSessionId,
        TERM: 'xterm-256color',
      },
    });
  } catch (err) {
    return {
      blocked: true,
      reason: 'runtime-spawn-failed',
      hint: `${runtime} executable not found or failed to start: ${err.message}`,
    };
  }

  const pid = ptyProcess.pid;

  ptyProcess.onData((data) => {
    if (typeof onData === 'function') {
      onData(data);
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    if (typeof onExit === 'function') {
      onExit({ exitCode, signal });
    }
  });

  return { sessionId: resolvedSessionId, pid, ptyProcess, ptyProvider: loadedPty.provider };
}
