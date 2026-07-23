#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCHEMA = 'harness-l2-cache-telemetry@1';
const DEFAULT_GROUPS = ['provider-control', 'harness-thin', 'wf-light'];
const OFFICIAL_DOCS = [
  'https://code.claude.com/docs/en/cli-reference',
  'https://code.claude.com/docs/en/prompt-caching',
  'https://code.claude.com/docs/en/statusline',
];

const GROUPS = {
  'provider-control': {
    description: 'Claude Code provider-cache control with project customizations disabled.',
    safeMode: true,
    disallowedTools: '*',
    maxTurns: 1,
    prompts: [
      'Answer exactly: provider cache control cold turn.',
      'Do not use tools. Answer exactly: cache_read_input_tokens.',
      'Do not use tools. Answer exactly: structured JSON usage is the source of truth; status text is only a visual aid.',
    ],
  },
  'harness-thin': {
    description: 'Harness thin startup route: CLAUDE.md plus startup hints only.',
    tools: 'Read',
    maxTurns: 4,
    prompts: [
      'Read only CLAUDE.md and Harness/memory/startup-hints.md. In two short sentences, state the normal startup route and what must not be loaded. Do not modify files.',
      'Do not read files or run tools. Answer exactly: cache_read_input_tokens.',
      'Do not read files or run tools. Answer exactly: No, L0/L1 cannot claim real cache-hit improvement without L2 provider usage telemetry.',
    ],
  },
  'wf-light': {
    description: 'Explicit /wf route with stable Harness router and WF-light documents.',
    tools: 'Read,Grep,Glob',
    maxTurns: 6,
    prompts: [
      '/wf Read only CLAUDE.md, Harness/MEMORY.md, Harness/README.md, Harness/specs/workflows/WF.md, Harness/specs/workflows/WF-KERNEL.md, and Harness/specs/runtime/context-loading.md. Return exactly three bullets: route used, cache-first boundary, no-edit confirmation.',
      'Do not read files or run tools. Based on this same session, one sentence: name the stable-prefix file categories.',
      'Do not read files or run tools. Answer exactly: cache_read_input_tokens should stay high when the prefix is stable.',
    ],
  },
};

function usage() {
  return `Usage:
  node Harness/scripts/l2-cache-telemetry.mjs [options]

Options:
  --dry-run                         Print the planned Claude Code calls only.
  --from-file <path>                Summarize an existing telemetry JSON file.
  --json                            Print JSON instead of text.
  --out <path>                      Output path for a real run.
  --groups <ids>                    Comma list: ${Object.keys(GROUPS).join(', ')}.
  --turns <n>                       Turns per group. Default: 3.
  --turn-budget-usd <n>             Per Claude call budget. Default: 0.35.
  --total-budget-usd <n>            Stop after total reported cost passes this. Default: 1.20.
  --claude-command <command>        Claude executable. Default: claude.cmd on Windows, claude elsewhere.
  --root <path>                     Working directory. Default: current directory.
  --model <model>                   Optional Claude model flag.
  --timeout-ms <n>                  Per turn timeout. Default: 180000.
  --include-raw                     Store full raw Claude JSON result for each turn.
  --exclude-dynamic-system-prompt-sections
                                    Add Claude Code's cache-friendly CLI flag; recorded in the report.
  --claim-min-warm-turns <n>        Warm turns required before README measured-claim gate. Default: 10.
  --claim-min-read-ratio <n>        Warm median read ratio threshold. Default: 95.
  --claim-min-uplift-points <n>     Improvement threshold over provider-control. Default: 2.
`;
}

function readArg(argv, index, name) {
  if (index + 1 >= argv.length) {
    throw new Error(`${name} requires a value`);
  }
  return argv[index + 1];
}

function numberArg(value, name, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`${name} must be a number >= ${min}`);
  }
  return parsed;
}

function intArg(value, name, min = 1) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    json: false,
    fromFile: '',
    outputPath: '',
    groups: [...DEFAULT_GROUPS],
    turnsPerGroup: 3,
    turnBudgetUsd: 0.35,
    totalBudgetUsd: 1.20,
    claudeCommand: process.platform === 'win32' ? 'claude.cmd' : 'claude',
    root: process.cwd(),
    model: '',
    timeoutMs: 180000,
    includeRaw: false,
    excludeDynamicSystemPromptSections: false,
    claimMinWarmTurns: 10,
    claimMinReadRatio: 95,
    claimMinUpliftPoints: 2,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--from-file') {
      options.fromFile = path.resolve(readArg(argv, i, arg));
      i++;
    } else if (arg === '--out') {
      options.outputPath = path.resolve(readArg(argv, i, arg));
      i++;
    } else if (arg === '--groups') {
      options.groups = readArg(argv, i, arg).split(',').map(item => item.trim()).filter(Boolean);
      i++;
    } else if (arg === '--turns') {
      options.turnsPerGroup = intArg(readArg(argv, i, arg), arg, 1);
      i++;
    } else if (arg === '--turn-budget-usd') {
      options.turnBudgetUsd = numberArg(readArg(argv, i, arg), arg, 0.01);
      i++;
    } else if (arg === '--total-budget-usd') {
      options.totalBudgetUsd = numberArg(readArg(argv, i, arg), arg, 0.01);
      i++;
    } else if (arg === '--claude-command') {
      options.claudeCommand = readArg(argv, i, arg);
      i++;
    } else if (arg === '--root') {
      options.root = path.resolve(readArg(argv, i, arg));
      i++;
    } else if (arg === '--model') {
      options.model = readArg(argv, i, arg);
      i++;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = intArg(readArg(argv, i, arg), arg, 1000);
      i++;
    } else if (arg === '--include-raw') {
      options.includeRaw = true;
    } else if (arg === '--exclude-dynamic-system-prompt-sections') {
      options.excludeDynamicSystemPromptSections = true;
    } else if (arg === '--claim-min-warm-turns') {
      options.claimMinWarmTurns = intArg(readArg(argv, i, arg), arg, 1);
      i++;
    } else if (arg === '--claim-min-read-ratio') {
      options.claimMinReadRatio = numberArg(readArg(argv, i, arg), arg, 0);
      i++;
    } else if (arg === '--claim-min-uplift-points') {
      options.claimMinUpliftPoints = numberArg(readArg(argv, i, arg), arg, 0);
      i++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const id of options.groups) {
    if (!GROUPS[id]) throw new Error(`Unknown group: ${id}`);
  }

  if (!options.outputPath) options.outputPath = defaultOutputPath();
  return options;
}

function defaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');
  return path.join(os.homedir(), '.claude', 'cache-telemetry', `harness-l2-${stamp}.json`);
}

function round(value, decimals = 1) {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function promptFor(group, turn) {
  if (turn < group.prompts.length) return group.prompts[turn];
  return 'Do not read files or run tools. In one sentence, restate the cache-first boundary for this same session.';
}

function claudeArgs(group, options, sessionId) {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--strict-mcp-config',
    '--max-budget-usd',
    String(options.turnBudgetUsd),
    '--max-turns',
    String(group.maxTurns),
  ];

  if (options.excludeDynamicSystemPromptSections) {
    args.push('--exclude-dynamic-system-prompt-sections');
  }
  if (options.model) args.push('--model', options.model);
  if (group.safeMode) args.push('--safe-mode');
  if (group.tools) args.push('--tools', group.tools);
  if (group.disallowedTools) args.push('--disallowedTools', group.disallowedTools);
  if (sessionId) args.push('--resume', sessionId);

  return args;
}

function plan(options) {
  return {
    groups: options.groups.map(id => {
      const group = GROUPS[id];
      return {
        id,
        description: group.description,
        turns: Array.from({ length: options.turnsPerGroup }, (_, turn) => {
          const sessionId = turn === 0 ? '' : '<session-id-from-cold-turn>';
          const prompt = promptFor(group, turn);
          return {
            turn,
            command: options.claudeCommand,
            args: claudeArgs(group, options, sessionId),
            prompt,
            promptSha256: sha256(prompt),
          };
        }),
      };
    }),
  };
}

function sourceEvidence() {
  return {
    localHelpRequired: true,
    localHelpCommand: 'claude --help',
    officialDocs: OFFICIAL_DOCS,
    telemetryFields: [
      'usage.cache_read_input_tokens',
      'usage.cache_creation_input_tokens',
      'context_window.current_usage.cache_read_input_tokens',
      'context_window.current_usage.cache_creation_input_tokens',
    ],
    formula: 'cache_read_input_tokens / (input_tokens + cache_creation_input_tokens + cache_read_input_tokens)',
  };
}

function usageFrom(raw) {
  const usage = raw?.usage
    || raw?.message?.usage
    || raw?.context_window?.current_usage
    || raw?.raw?.usage
    || raw?.raw?.context_window?.current_usage
    || {};

  return {
    input_tokens: numeric(usage.input_tokens ?? raw?.input_tokens),
    output_tokens: numeric(usage.output_tokens ?? raw?.output_tokens),
    cache_creation_input_tokens: numeric(usage.cache_creation_input_tokens ?? raw?.cache_creation_input_tokens),
    cache_read_input_tokens: numeric(usage.cache_read_input_tokens ?? raw?.cache_read_input_tokens),
  };
}

function hasTelemetry(raw, usage) {
  const usageSource = raw?.usage
    || raw?.message?.usage
    || raw?.context_window?.current_usage
    || raw?.raw?.usage
    || raw?.raw?.context_window?.current_usage
    || raw;
  return ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    .every(key => Object.prototype.hasOwnProperty.call(usageSource || {}, key)
      && Number.isFinite(Number(usageSource[key])));
}

function ratioFromUsage(usage) {
  const total = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
  return {
    totalInputTokens: total,
    readRatioPercent: total > 0 ? round((usage.cache_read_input_tokens / total) * 100, 1) : 0,
    creationRatioPercent: total > 0 ? round((usage.cache_creation_input_tokens / total) * 100, 1) : 0,
    freshRatioPercent: total > 0 ? round((usage.input_tokens / total) * 100, 1) : 0,
  };
}

function inferGroup(raw, index) {
  if (raw.group) return raw.group;
  if (typeof raw.label === 'string') {
    for (const id of Object.keys(GROUPS)) {
      if (raw.label.startsWith(id)) return id;
    }
    if (raw.label.startsWith('safe-baseline')) return 'provider-control';
    if (raw.label.startsWith('harness-strict')) return 'harness-thin';
    if (raw.label.startsWith('wf-approx')) return 'wf-light';
  }
  return `unknown-${index}`;
}

function inferTurn(raw, index, groupRuns) {
  if (Number.isInteger(raw.turn)) return raw.turn;
  if (typeof raw.label === 'string') {
    const match = raw.label.match(/-(\d+)$/);
    if (match) return Number(match[1]) - 1;
  }
  return groupRuns.get(inferGroup(raw, index)) || 0;
}

function normalizeRun(raw, index, groupRuns = new Map()) {
  const group = inferGroup(raw, index);
  const turn = inferTurn(raw, index, groupRuns);
  groupRuns.set(group, turn + 1);

  const usage = usageFrom(raw);
  const ratios = ratioFromUsage(usage);
  const telemetryPresent = hasTelemetry(raw, usage);
  const explicitSuccess = Object.prototype.hasOwnProperty.call(raw, 'success') ? Boolean(raw.success) : null;
  const rawSubtype = raw.subtype || raw.terminal_reason || raw.raw?.subtype || raw.raw?.terminal_reason || '';
  const subtypeSuccess = rawSubtype ? !/error|fail|budget|timeout/i.test(rawSubtype) : true;
  const success = explicitSuccess === null ? subtypeSuccess : explicitSuccess;

  return {
    group,
    turn,
    label: raw.label || `${group}-${turn + 1}`,
    session_id: raw.session_id || raw.sessionId || raw.raw?.session_id || '',
    success,
    telemetryPresent,
    usage,
    totalInputTokens: ratios.totalInputTokens,
    readRatioPercent: ratios.readRatioPercent,
    creationRatioPercent: ratios.creationRatioPercent,
    freshRatioPercent: ratios.freshRatioPercent,
    total_cost_usd: numeric(raw.total_cost_usd ?? raw.cost_usd ?? raw.raw?.total_cost_usd ?? raw.raw?.cost_usd),
    duration_ms: raw.duration_ms === null ? null : numeric(raw.duration_ms ?? raw.durationMs ?? raw.raw?.duration_ms),
    terminal_reason: raw.terminal_reason || raw.raw?.terminal_reason || '',
    subtype: raw.subtype || raw.raw?.subtype || '',
    error: raw.error || '',
    promptSha256: raw.promptSha256 || '',
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? round((sorted[mid - 1] + sorted[mid]) / 2, 1) : sorted[mid];
}

function percentile(values, pct) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function mean(values, decimals = 1) {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, decimals);
}

function summarizeRuns(rawRuns, settings) {
  const groupRuns = new Map();
  const runs = rawRuns.map((run, index) => normalizeRun(run, index, groupRuns));
  const byGroup = {};

  for (const run of runs) {
    byGroup[run.group] ||= [];
    byGroup[run.group].push(run);
  }

  const groups = {};
  for (const [group, items] of Object.entries(byGroup)) {
    const warm = items.filter(item => item.turn > 0 && item.telemetryPresent);
    const warmReadRatios = warm.map(item => item.readRatioPercent);
    const durations = items.map(item => item.duration_ms).filter(value => Number.isFinite(value) && value > 0);
    const warmDurations = warm.map(item => item.duration_ms).filter(value => Number.isFinite(value) && value > 0);
    const successCount = items.filter(item => item.success).length;
    const telemetryCount = items.filter(item => item.telemetryPresent).length;

    groups[group] = {
      totalTurns: items.length,
      successfulTurns: successCount,
      successRate: items.length ? round(successCount / items.length, 3) : 0,
      telemetryTurns: telemetryCount,
      warmTurns: warm.length,
      coldReadRatioPercent: items.find(item => item.turn === 0)?.readRatioPercent ?? null,
      warmReadRatioPercent: warmReadRatios,
      warmMinReadRatioPercent: warmReadRatios.length ? Math.min(...warmReadRatios) : null,
      warmMedianReadRatioPercent: median(warmReadRatios),
      warmMeanReadRatioPercent: mean(warmReadRatios),
      warmMaxReadRatioPercent: warmReadRatios.length ? Math.max(...warmReadRatios) : null,
      medianDurationMs: median(durations),
      p95DurationMs: percentile(durations, 95),
      maxDurationMs: durations.length ? Math.max(...durations) : null,
      warmMedianDurationMs: median(warmDurations),
      warmP95DurationMs: percentile(warmDurations, 95),
      totalCostUsd: round(items.reduce((sum, item) => sum + item.total_cost_usd, 0), 6),
    };
  }

  const totalCostUsd = round(runs.reduce((sum, run) => sum + run.total_cost_usd, 0), 6);
  return {
    totalTurns: runs.length,
    totalCostUsd,
    groups,
    claimGate: claimGate(groups, settings),
  };
}

function claimGate(groups, settings) {
  const measuredReasons = [];
  const improvementReasons = [];
  const harnessGroups = ['harness-thin', 'wf-light'].filter(group => groups[group]);

  if (harnessGroups.length === 0) {
    measuredReasons.push('no Harness telemetry group found');
  }

  for (const group of harnessGroups) {
    const summary = groups[group];
    if (summary.warmTurns < settings.claimMinWarmTurns) {
      measuredReasons.push(`${group} needs at least ${settings.claimMinWarmTurns} warm telemetry turns`);
    }
    if (summary.successRate < 0.95) {
      measuredReasons.push(`${group} success rate ${summary.successRate} is below 0.95`);
    }
    if (summary.telemetryTurns < summary.totalTurns) {
      measuredReasons.push(`${group} has turns without L2 usage telemetry`);
    }
    if ((summary.warmMedianReadRatioPercent ?? 0) < settings.claimMinReadRatio) {
      measuredReasons.push(`${group} warm median read ratio is below ${settings.claimMinReadRatio}%`);
    }
  }

  if (!groups['provider-control']) {
    improvementReasons.push('provider-control group is required before claiming improvement');
  } else {
    const control = groups['provider-control'].warmMedianReadRatioPercent;
    if (control === null) improvementReasons.push('provider-control has no warm telemetry turns');
    for (const group of harnessGroups) {
      const harness = groups[group].warmMedianReadRatioPercent;
      if (harness === null) continue;
      if (control !== null && harness - control < settings.claimMinUpliftPoints) {
        improvementReasons.push(`${group} uplift over provider-control is below ${settings.claimMinUpliftPoints} percentage points`);
      }
    }
  }

  const measuredWarmCacheClaimAllowed = measuredReasons.length === 0;
  const improvementClaimAllowed = measuredWarmCacheClaimAllowed && improvementReasons.length === 0;

  return {
    measuredWarmCacheClaimAllowed,
    improvementClaimAllowed,
    reasons: [...measuredReasons, ...improvementReasons],
    thresholds: {
      minWarmTurnsPerHarnessGroup: settings.claimMinWarmTurns,
      minWarmMedianReadRatioPercent: settings.claimMinReadRatio,
      minUpliftPointsOverProviderControl: settings.claimMinUpliftPoints,
    },
  };
}

function parseClaudeJson(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return { parsed: null, error: 'empty stdout' };
  try {
    return { parsed: JSON.parse(trimmed), error: '' };
  } catch (err) {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return { parsed: JSON.parse(trimmed.slice(first, last + 1)), error: '' };
      } catch {
        // Fall through to the original parse error.
      }
    }
    return { parsed: null, error: err.message };
  }
}

function truncate(text, max = 4000) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}...<truncated>` : value;
}

function spawnClaude(command, args, options) {
  if (process.platform === 'win32') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', command, ...args], options);
  }
  return spawnSync(command, args, options);
}

function runClaudeTurn({ options, groupId, turn, sessionId }) {
  const group = GROUPS[groupId];
  const prompt = promptFor(group, turn);
  const args = claudeArgs(group, options, sessionId);
  const started = Date.now();
  const child = spawnClaude(options.claudeCommand, args, {
    cwd: options.root,
    input: prompt,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' },
  });
  const durationMs = Date.now() - started;
  const parseResult = parseClaudeJson(child.stdout);
  const parsed = parseResult.parsed || {};
  const usage = usageFrom(parsed);
  const ratios = ratioFromUsage(usage);
  const telemetryPresent = parseResult.parsed ? hasTelemetry(parsed, usage) : false;
  const exitCode = child.status;
  const timedOut = child.error?.code === 'ETIMEDOUT';
  const subtype = parsed.subtype || parsed.terminal_reason || '';
  const success = exitCode === 0
    && Boolean(parseResult.parsed)
    && telemetryPresent
    && !parsed.is_error
    && !/error|fail|budget|timeout/i.test(subtype)
    && !timedOut;

  return {
    group: groupId,
    turn,
    label: `${groupId}-${turn + 1}`,
    command: options.claudeCommand,
    spawnVia: process.platform === 'win32' ? 'cmd.exe /d /s /c' : 'direct',
    args,
    promptSha256: sha256(prompt),
    session_id: parsed.session_id || '',
    success,
    telemetryPresent,
    usage,
    totalInputTokens: ratios.totalInputTokens,
    readRatioPercent: ratios.readRatioPercent,
    creationRatioPercent: ratios.creationRatioPercent,
    freshRatioPercent: ratios.freshRatioPercent,
    total_cost_usd: numeric(parsed.total_cost_usd ?? parsed.cost_usd),
    duration_ms: numeric(parsed.duration_ms) || durationMs,
    terminal_reason: parsed.terminal_reason || '',
    subtype: parsed.subtype || '',
    error: child.error?.message || parseResult.error || (exitCode === 0 ? '' : truncate(child.stderr)),
    resultPreview: parseResult.parsed ? truncate(parsed.result, 500) : '',
    raw: options.includeRaw && parseResult.parsed ? parsed : undefined,
    stdout: parseResult.parsed ? undefined : truncate(child.stdout),
    stderr: parseResult.parsed ? truncate(child.stderr, 1000) : truncate(child.stderr),
  };
}

function loadRunsFromFile(file) {
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.runs)) return body.runs;
  throw new Error(`No runs[] array found in ${file}`);
}

function settingsForReport(options) {
  return {
    groups: options.groups,
    turnsPerGroup: options.turnsPerGroup,
    turnBudgetUsd: options.turnBudgetUsd,
    totalBudgetUsd: options.totalBudgetUsd,
    claudeCommand: options.claudeCommand,
    root: options.root,
    model: options.model,
    timeoutMs: options.timeoutMs,
    includeRaw: options.includeRaw,
    excludeDynamicSystemPromptSections: options.excludeDynamicSystemPromptSections,
    claimMinWarmTurns: options.claimMinWarmTurns,
    claimMinReadRatio: options.claimMinReadRatio,
    claimMinUpliftPoints: options.claimMinUpliftPoints,
  };
}

function baseReport(options, mode) {
  return {
    schema: SCHEMA,
    mode,
    generatedAt: new Date().toISOString(),
    outputPath: options.outputPath,
    settings: settingsForReport(options),
    sourceEvidence: sourceEvidence(),
  };
}

function realRun(options) {
  const runs = [];
  let reportedCost = 0;
  let stoppedReason = '';

  for (const groupId of options.groups) {
    let sessionId = '';
    for (let turn = 0; turn < options.turnsPerGroup; turn++) {
      const run = runClaudeTurn({ options, groupId, turn, sessionId });
      runs.push(run);
      reportedCost = round(reportedCost + run.total_cost_usd, 6);

      if (!sessionId && run.session_id) sessionId = run.session_id;
      if (turn === 0 && !sessionId) {
        stoppedReason = `${groupId} cold turn did not return a session_id`;
        break;
      }
      if (reportedCost >= options.totalBudgetUsd) {
        stoppedReason = `reported total cost ${reportedCost} reached --total-budget-usd ${options.totalBudgetUsd}`;
        break;
      }
    }
    if (stoppedReason) break;
  }

  const report = {
    ...baseReport(options, 'run'),
    plan: plan(options),
    runs,
    summary: summarizeRuns(runs, options),
    stoppedReason,
  };

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return report;
}

function printText(report) {
  if (report.mode === 'dry-run') {
    console.log(`Dry run: ${report.plan.groups.length} group(s), ${report.settings.turnsPerGroup} turn(s) each.`);
    console.log(`Output path for real run: ${report.outputPath}`);
    for (const group of report.plan.groups) {
      console.log(`- ${group.id}: ${group.description}`);
    }
    return;
  }

  console.log(`L2 telemetry ${report.mode}: ${report.summary.totalTurns} turn(s), $${report.summary.totalCostUsd}`);
  for (const [group, summary] of Object.entries(report.summary.groups)) {
    console.log(
      `- ${group}: success ${summary.successfulTurns}/${summary.totalTurns}, ` +
      `warm median read ${summary.warmMedianReadRatioPercent ?? 'n/a'}%, ` +
      `warm turns ${summary.warmTurns}`,
    );
  }
  console.log(`Measured README claim allowed: ${report.summary.claimGate.measuredWarmCacheClaimAllowed}`);
  console.log(`Improvement README claim allowed: ${report.summary.claimGate.improvementClaimAllowed}`);
  if (report.summary.claimGate.reasons.length) {
    console.log('Claim gate reasons:');
    for (const reason of report.summary.claimGate.reasons) console.log(`- ${reason}`);
  }
  if (report.mode === 'run') console.log(`Report written: ${report.outputPath}`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  let report;

  if (options.fromFile) {
    const runs = loadRunsFromFile(options.fromFile);
    report = {
      ...baseReport(options, 'from-file'),
      inputPath: options.fromFile,
      runs: runs.map((run, index) => normalizeRun(run, index)),
      summary: summarizeRuns(runs, options),
    };
  } else if (options.dryRun) {
    report = {
      ...baseReport(options, 'dry-run'),
      plan: plan(options),
      summary: summarizeRuns([], options),
    };
  } else {
    report = realRun(options);
  }

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printText(report);
} catch (err) {
  console.error(`l2-cache-telemetry failed: ${err.message}`);
  process.exit(1);
}
