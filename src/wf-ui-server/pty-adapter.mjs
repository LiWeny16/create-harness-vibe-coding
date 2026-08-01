import { ALLOWED_RUNTIMES, generateSessionId } from './session-registry.mjs';
import path from 'node:path';
import {
  getRuntimeDefinition,
  isRuntimeLaunchable,
  resolveRuntimeCommand,
  resolveRuntimeLaunchArgs,
} from './runtime-detector.mjs';
import {
  codexUpdatePromptControlEnabled,
  createCodexUpdatePromptDetector,
} from './codex-update-prompt.mjs';
import { graphReadToken } from './control-plane-token.mjs';

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
  model = '',
  initialPrompt = '',
  launchPolicy = null,
  controlPlaneUrl = '',
  controlPlaneToken = '',
  agentKind = '',
  workflowMode = '',
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
  const fullControlToken = agentKind === 'main' ? (controlPlaneToken || '') : '';
  const readControlToken = controlPlaneToken ? graphReadToken(controlPlaneToken, resolvedSessionId) : '';

  const requestedExecutable = command || resolveRuntimeCommand(runtime);
  const requestedArgs = [...resolveRuntimeLaunchArgs(runtime, { model, launchPolicy, initialPrompt }), ...commandArgs];
  const { executable, args: launchArgs } = resolvePtyCommand(requestedExecutable, requestedArgs);

  let ptyProcess;
  try {
    ptyProcess = nodePty.spawn(executable, launchArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || projectRoot || process.cwd(),
      ...windowsPtyOptions(),
      env: {
        ...process.env,
        HARNESS_PEER_RUNTIME: runtime,
        HARNESS_AGENT_KIND: agentKind || '',
        HARNESS_WORKFLOW_MODE: workflowMode || '',
        HARNESS_WORKFLOW_NODE_ID: graphNodeId || '',
        HARNESS_WORKFLOW_MAP: graphContextPath || '',
        HARNESS_NODE_HOME: nodeHomePath || '',
        HARNESS_NODE_INIT: nodeInitPath || '',
        HARNESS_WF_UI_URL: controlPlaneUrl || '',
        HARNESS_WF_UI_TOKEN: fullControlToken,
        HARNESS_WF_UI_READ_TOKEN: readControlToken,
        WF_UI_URL: controlPlaneUrl || '',
        WF_UI_TOKEN: fullControlToken,
        WF_UI_READ_TOKEN: readControlToken,
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
  const codexUpdateDetector = createCodexUpdatePromptDetector({
    enabled: runtime === 'codex' && codexUpdatePromptControlEnabled(),
  });

  ptyProcess.onData((data) => {
    if (typeof onData === 'function') {
      onData(data);
    }
    const controlRequest = codexUpdateDetector.observe(data);
    if (controlRequest && typeof onControlRequest === 'function') {
      onControlRequest(controlRequest);
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    if (typeof onExit === 'function') {
      onExit({ exitCode, signal });
    }
  });

  return { sessionId: resolvedSessionId, pid, ptyProcess, ptyProvider: loadedPty.provider };
}
