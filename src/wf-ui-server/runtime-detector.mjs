import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();

function homePath(...parts) {
  return path.join(HOME, ...parts);
}

function projectPath(...parts) {
  return path.join(...parts);
}

const COMMON_CAPABILITIES = ['terminal', 'workflow', 'a2a-files', 'terminal-read', 'terminal-write'];

function jsonConfig(scope, displayPath, resolvedPath, fields = {}) {
  return { scope, path: displayPath, resolvedPath, format: 'json', fields };
}

function tomlConfig(scope, displayPath, resolvedPath, fields = {}) {
  return { scope, path: displayPath, resolvedPath, format: 'toml', fields };
}

export const RUNTIME_DEFINITIONS = [
  {
    id: 'claude',
    label: 'Claude Code',
    commands: ['claude'],
    launchable: true,
    adapterStatus: 'ready',
    modelArg: '--model',
    resumeArgs: (sessionId) => sessionId ? ['--resume', sessionId] : ['--continue'],
    capabilities: [...COMMON_CAPABILITIES, 'skills', 'built-in-subagents'],
    configFiles: [
      jsonConfig('user', '~/.claude/settings.json', homePath('.claude', 'settings.json'), { model: 'model' }),
      jsonConfig('project', '.claude/settings.json', projectPath('.claude', 'settings.json'), { model: 'model' }),
      jsonConfig('local', '.claude/settings.local.json', projectPath('.claude', 'settings.local.json'), { model: 'model' }),
      jsonConfig('user-private', '~/.claude.json', homePath('.claude.json'), {}),
    ],
  },
  {
    id: 'cc',
    label: 'Claude Code (cc)',
    commands: ['cc'],
    launchable: true,
    adapterStatus: 'ready',
    modelArg: '--model',
    resumeArgs: (sessionId) => sessionId ? ['--resume', sessionId] : ['--continue'],
    capabilities: [...COMMON_CAPABILITIES, 'skills', 'built-in-subagents'],
    configFiles: [
      jsonConfig('user', '~/.claude/settings.json', homePath('.claude', 'settings.json'), { model: 'model' }),
      jsonConfig('project', '.claude/settings.json', projectPath('.claude', 'settings.json'), { model: 'model' }),
      jsonConfig('local', '.claude/settings.local.json', projectPath('.claude', 'settings.local.json'), { model: 'model' }),
      jsonConfig('user-private', '~/.claude.json', homePath('.claude.json'), {}),
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    commands: ['codex'],
    launchable: true,
    adapterStatus: 'ready',
    modelArg: '--model',
    resumeArgs: (sessionId) => sessionId ? ['resume', sessionId] : ['resume', '--last'],
    capabilities: [...COMMON_CAPABILITIES, 'skills'],
    configFiles: [
      tomlConfig('user', '~/.codex/config.toml', homePath('.codex', 'config.toml'), { model: 'model', provider: 'model_provider' }),
      tomlConfig('project', '.codex/config.toml', projectPath('.codex', 'config.toml'), { model: 'model', provider: 'model_provider' }),
    ],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    commands: ['opencode'],
    launchable: true,
    adapterStatus: 'ready',
    modelArg: '--model',
    resumeArgs: (sessionId) => sessionId ? ['--session', sessionId] : ['--continue'],
    capabilities: [...COMMON_CAPABILITIES, 'skills'],
    configFiles: [
      jsonConfig('user', '~/.config/opencode/opencode.json', homePath('.config', 'opencode', 'opencode.json'), { model: 'model' }),
      jsonConfig('tui', '~/.config/opencode/tui.json', homePath('.config', 'opencode', 'tui.json'), {}),
      jsonConfig('project', 'opencode.json', projectPath('opencode.json'), { model: 'model' }),
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    commands: ['gemini'],
    launchable: true,
    adapterStatus: 'ready',
    modelArg: '--model',
    capabilities: [...COMMON_CAPABILITIES, 'mcp'],
    configFiles: [
      jsonConfig('user', '~/.gemini/settings.json', homePath('.gemini', 'settings.json'), { model: 'model.name' }),
      jsonConfig('project', '.gemini/settings.json', projectPath('.gemini', 'settings.json'), { model: 'model.name' }),
    ],
  },
  {
    id: 'qwen',
    label: 'Qwen Code',
    commands: ['qwen'],
    launchable: true,
    adapterStatus: 'ready',
    modelArg: '--model',
    capabilities: [...COMMON_CAPABILITIES, 'skills', 'built-in-subagents'],
    configFiles: [
      jsonConfig('user', '~/.qwen/settings.json', homePath('.qwen', 'settings.json'), { model: 'model.name' }),
      jsonConfig('project', '.qwen/settings.json', projectPath('.qwen', 'settings.json'), { model: 'model.name' }),
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek TUI',
    commands: ['deepseek', 'deepseek-tui'],
    launchable: true,
    adapterStatus: 'ready',
    modelArg: '--model',
    capabilities: [...COMMON_CAPABILITIES, 'mcp'],
    configFiles: [
      tomlConfig('user', '~/.deepseek/config.toml', homePath('.deepseek', 'config.toml'), {
        model: 'default_text_model',
        provider: 'provider',
        baseUrl: 'base_url',
      }),
    ],
  },
  {
    id: 'pi',
    label: 'Pi',
    commands: ['pi'],
    launchable: true,
    adapterStatus: 'ready',
    capabilities: [...COMMON_CAPABILITIES, 'minimal-tools'],
    configFiles: [],
  },
  {
    id: 'aider',
    label: 'Aider',
    commands: ['aider'],
    launchable: true,
    adapterStatus: 'ready',
    modelArg: '--model',
    capabilities: [...COMMON_CAPABILITIES],
    configFiles: [],
  },
  {
    id: 'goose',
    label: 'Goose',
    commands: ['goose'],
    launchable: true,
    adapterStatus: 'ready',
    capabilities: [...COMMON_CAPABILITIES, 'sessions'],
    configFiles: [],
  },
  {
    id: 'amp',
    label: 'Amp',
    commands: ['amp'],
    launchable: true,
    adapterStatus: 'ready',
    capabilities: [...COMMON_CAPABILITIES],
    configFiles: [],
  },
  {
    id: 'crush',
    label: 'Crush',
    commands: ['crush'],
    launchable: true,
    adapterStatus: 'ready',
    capabilities: [...COMMON_CAPABILITIES],
    configFiles: [],
  },
  {
    id: 'cline',
    label: 'Cline CLI',
    commands: ['cline'],
    launchable: true,
    adapterStatus: 'ready',
    modelArg: '--model',
    capabilities: [...COMMON_CAPABILITIES, 'kanban'],
    configFiles: [],
  },
  {
    id: 'plandex',
    label: 'Plandex',
    commands: ['plandex'],
    launchable: true,
    adapterStatus: 'ready',
    capabilities: [...COMMON_CAPABILITIES],
    configFiles: [],
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    commands: ['openclaw'],
    launchable: true,
    adapterStatus: 'ready',
    capabilities: [...COMMON_CAPABILITIES, 'assistant-gateway'],
    configFiles: [],
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT CLI',
    commands: ['chatgpt'],
    launchable: true,
    adapterStatus: 'ready',
    capabilities: [...COMMON_CAPABILITIES, 'generic-chat'],
    configFiles: [],
  },
  {
    id: 'openai',
    label: 'OpenAI CLI',
    commands: ['openai'],
    launchable: true,
    adapterStatus: 'ready',
    capabilities: ['terminal', 'api-cli'],
    configFiles: [],
  },
];

export const RUNTIME_IDS = new Set(RUNTIME_DEFINITIONS.map((runtime) => runtime.id));
const RUNTIME_BY_ID = new Map(RUNTIME_DEFINITIONS.map((runtime) => [runtime.id, runtime]));
const DEFAULT_RUNTIME_CACHE_TTL_MS = 12000;
const runtimeCache = new Map();
const runtimeRefreshInFlight = new Set();

function defaultRunner(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout || 2000,
    windowsHide: true,
    shell: false,
    env: options.env || process.env,
  });
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function commandCandidates(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function preferWindowsExecutable(paths) {
  if (process.platform !== 'win32') return paths[0] || null;
  const preferredExts = ['.exe', '.cmd', '.bat', '.ps1'];
  for (const ext of preferredExts) {
    const match = paths.find((candidate) => candidate.toLowerCase().endsWith(ext));
    if (match) return match;
  }
  return paths[0] || null;
}

export function getRuntimeDefinition(runtimeId) {
  return RUNTIME_BY_ID.get(runtimeId) || null;
}

export function resolveRuntimeCommand(runtimeId) {
  const definition = getRuntimeDefinition(runtimeId);
  return definition ? definition.commands[0] : runtimeId;
}

export function resolveRuntimeLaunchArgs(runtimeId, opts = {}) {
  const definition = getRuntimeDefinition(runtimeId);
  const args = [];
  const model = String(opts.model || '').trim();
  const initialPrompt = String(opts.initialPrompt || '').trim();
  if (definition?.modelArg && model) args.push(definition.modelArg, model);
  const launchPolicy = opts.launchPolicy || {};
  const bypassAll = launchPolicy.sandboxMode === 'danger-full-access'
    && launchPolicy.approvalPolicy === 'never';
  if (bypassAll) {
    if (runtimeId === 'claude' || runtimeId === 'cc') {
      args.push('--dangerously-skip-permissions');
    } else if (runtimeId === 'codex') {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else if (runtimeId === 'opencode') {
      args.push('--auto');
    }
  }
  if (initialPrompt) {
    // Newlines inside one argv element break `cmd.exe /c` quoting on Windows:
    // only the first line reaches the runtime (observed live: codex received
    // just the first paragraph of a multi-line mission prompt). Flatten to a
    // single line so the full prompt survives the shell.
    const flattened = initialPrompt.replace(/\s*\r?\n\s*/g, ' ');
    if (runtimeId === 'opencode') args.push('--prompt', flattened);
    else if (runtimeId === 'claude' || runtimeId === 'cc' || runtimeId === 'codex') args.push(flattened);
  }
  return args;
}

export function resolveRuntimeResumeArgs(runtimeId, opts = {}) {
  const definition = getRuntimeDefinition(runtimeId);
  if (typeof definition?.resumeArgs !== 'function') return [];
  const agentSessionId = String(opts.agentSessionId || '').trim();
  if (runtimeId === 'codex') {
    // Codex keys saved sessions by its internal rollout UUID (captured from
    // the PTY boot output), not by the harness session id. Prefer the captured
    // rollout id when present; fall back to the harness-tracked id.
    const codexRolloutId = String(opts.codexRolloutId || '').trim();
    return definition.resumeArgs(codexRolloutId || agentSessionId);
  }
  return definition.resumeArgs(agentSessionId);
}

export function isRuntimeLaunchable(runtimeId) {
  const definition = getRuntimeDefinition(runtimeId);
  return Boolean(definition?.launchable);
}

export function resolveExecutable(command, { runner = defaultRunner, env = process.env } = {}) {
  const resolver = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = runner(resolver, [command], { env, timeout: 1500 });
  if (result?.status !== 0) return null;
  return preferWindowsExecutable(commandCandidates(result.stdout));
}

export function readRuntimeVersion(command, { runner = defaultRunner, env = process.env } = {}) {
  const attempts = [['--version'], ['version']];
  for (const args of attempts) {
    const result = runner(command, args, { env, timeout: 2000 });
    if (result?.status === 0) {
      const line = firstLine(result.stdout) || firstLine(result.stderr);
      if (line) return line;
    }
  }
  return null;
}

export function detectRuntime(definition, opts = {}) {
  const found = definition.commands
    .map((command) => ({ command, path: resolveExecutable(command, opts) }))
    .find((candidate) => candidate.path);
  const command = found?.command || definition.commands[0];
  const executablePath = found?.path || null;
  const version = executablePath && opts.readVersion ? readRuntimeVersion(command, opts) : null;

  let status = 'missing';
  let blockedReason = 'executable-not-found';
  if (executablePath && definition.launchable) {
    status = 'available';
    blockedReason = null;
  } else if (executablePath && !definition.launchable) {
    status = 'adapter-needed';
    blockedReason = 'runtime-adapter-needed';
  }

  return {
    id: definition.id,
    label: definition.label,
    command,
    path: executablePath,
    version,
    status,
    launchable: Boolean(executablePath && definition.launchable),
    adapterStatus: definition.adapterStatus,
    resumeSupported: typeof definition.resumeArgs === 'function',
    blockedReason,
    capabilities: definition.capabilities,
    configFiles: definition.configFiles || [],
  };
}

export function detectRuntimes(opts = {}) {
  const rows = RUNTIME_DEFINITIONS.map((definition) => detectRuntime(definition, opts));
  return opts.includeMissing ? rows : rows.filter((runtime) => runtime.path);
}

export function detectRuntimesCached(opts = {}) {
  if (opts.runner) return detectRuntimes(opts);
  const includeMissing = Boolean(opts.includeMissing);
  const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : DEFAULT_RUNTIME_CACHE_TTL_MS;
  const cacheKey = includeMissing ? 'all' : 'detected';
  const cached = runtimeCache.get(cacheKey);
  const now = Date.now();
  if (!opts.refresh && cached) {
    if (now - cached.ts < ttlMs) return cached.rows;
    warmRuntimeCache({ includeMissing });
    return cached.rows;
  }
  const rows = detectRuntimes({ includeMissing });
  runtimeCache.set(cacheKey, { ts: now, rows });
  return rows;
}

export function warmRuntimeCache(opts = {}) {
  const includeMissing = Boolean(opts.includeMissing);
  const cacheKey = includeMissing ? 'all' : 'detected';
  if (runtimeRefreshInFlight.has(cacheKey)) return;
  runtimeRefreshInFlight.add(cacheKey);
  const timer = setTimeout(() => {
    try {
      runtimeCache.set(cacheKey, { ts: Date.now(), rows: detectRuntimes({ includeMissing }) });
    } finally {
      runtimeRefreshInFlight.delete(cacheKey);
    }
  }, 0);
  timer.unref?.();
}
