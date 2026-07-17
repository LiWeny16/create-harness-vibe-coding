#!/usr/bin/env node
/**
 * wf-auto-update-prompt.mjs
 *
 * Lightweight hook helper for Claude Code, Codex, and OpenCode.
 * It checks the installed Harness update plan and emits a prompt reminder only
 * when an update is available. It never applies updates.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { spawnSync } from 'child_process';

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_NOTICE_INTERVAL_MS = 60 * 60 * 1000;
const args = process.argv.slice(2);
const format = readFlagValue('--format') || 'plain';
const force = args.includes('--force');
const modeOnly = args.includes('--mode-only');
const input = readStdinJson();
const root = findRoot();

function readFlagValue(flagName) {
  const index = args.indexOf(flagName);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function readStdinJson() {
  try {
    if (process.stdin.isTTY) return {};
    const raw = readFileSync(0, 'utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function findRoot() {
  const candidates = [
    process.env.WF_ROOT,
    input.cwd,
    input.workspace,
    process.cwd(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const found = ascendToHarnessRoot(resolve(candidate));
    if (found) return found;
  }
  return process.cwd();
}

function ascendToHarnessRoot(start) {
  let current = start;
  for (;;) {
    if (existsSync(resolve(current, 'Harness', '.harness-version'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function runtimeDir() {
  return resolve(root, 'Harness', '.runtime');
}

function cachePath() {
  return resolve(runtimeDir(), 'update-check.json');
}

function modePath() {
  return resolve(runtimeDir(), 'current-mode.json');
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function readVersion() {
  return readJsonFile(resolve(root, 'Harness', '.harness-version'), null);
}

function shouldSkipPrompt() {
  const prompt = String(input.prompt || input.message || '');
  return /\b\/?wf-update\b|\$wf-update\b/.test(prompt);
}

function intervalFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function runUpdateCheck() {
  const script = resolve(root, 'Harness', 'scripts', 'wf-update-check.mjs');
  if (!existsSync(script)) {
    return { status: 'error', message: 'Harness/scripts/wf-update-check.mjs not found.' };
  }
  const result = spawnSync(process.execPath, [script, '--json'], {
    cwd: root,
    encoding: 'utf-8',
    timeout: intervalFromEnv('WF_UPDATE_CHECK_TIMEOUT_MS', 30000),
    env: process.env,
  });

  if (result.error) {
    return { status: 'offline', message: result.error.message };
  }

  const stdout = (result.stdout || '').trim();
  if (!stdout) {
    return { status: 'error', message: `Update checker exited with no JSON output (${result.status ?? 'unknown'}).` };
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return { status: 'error', message: 'Update checker returned invalid JSON.' };
  }
}

function isUpdateStatus(status) {
  return status === 'update-available' || status === 'partial-update';
}

function buildMessage(update) {
  const from = update.from || update.version || 'unknown';
  const to = update.to || update.remote || 'unknown';
  const parts = [
    `Harness update available: ${from} -> ${to}.`,
    `Before unrelated work, ask the user whether to run /wf-update.`,
  ];
  if (update.conflict > 0) {
    parts.push(`${update.conflict} conflict file(s) will need agent/user merge decisions.`);
  }
  if (update.updated > 0 || update.created > 0) {
    parts.push(`${update.updated || 0} safe update(s), ${update.created || 0} new file(s).`);
  }
  return parts.join(' ');
}

function readModeLabel() {
  const mode = readJsonFile(modePath(), null);
  if (!mode || !mode.active || !mode.mode) return null;
  return `${mode.mode} mode on`;
}

function emit(message, payload = {}) {
  if (!message && !payload.modeLabel) return;

  if (format === 'claude') {
    const context = [message, payload.modeLabel].filter(Boolean).join('\n');
    if (context) console.log(JSON.stringify({ additionalContext: context }));
    return;
  }

  if (format === 'codex') {
    const context = [message, payload.modeLabel].filter(Boolean).join('\n');
    if (context) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: input.hook_event_name || 'UserPromptSubmit',
          additionalContext: context,
        },
      }));
    }
    return;
  }

  if (format === 'json') {
    console.log(JSON.stringify({ message, ...payload }, null, 2));
    return;
  }

  if (message) console.log(message);
  if (payload.modeLabel) console.log(payload.modeLabel);
}

function main() {
  if (!existsSync(resolve(root, 'Harness', '.harness-version'))) return;
  const version = readVersion();
  if (version?.autoCheck === false) return;

  const modeLabel = readModeLabel();
  if (modeOnly) {
    emit('', { modeLabel, status: 'mode' });
    return;
  }

  if (shouldSkipPrompt()) {
    emit('', { modeLabel, status: 'skipped-update-command' });
    return;
  }

  const now = Date.now();
  const cache = readJsonFile(cachePath(), {});
  const checkInterval = intervalFromEnv('WF_UPDATE_CHECK_INTERVAL_MS', DEFAULT_CHECK_INTERVAL_MS);
  const noticeInterval = intervalFromEnv('WF_UPDATE_NOTICE_INTERVAL_MS', DEFAULT_NOTICE_INTERVAL_MS);

  let update = cache.update;
  const shouldCheck = force
    || !cache.checkedAt
    || now - Date.parse(cache.checkedAt) >= checkInterval;

  if (shouldCheck) {
    update = runUpdateCheck();
    writeJsonFile(cachePath(), {
      checkedAt: new Date(now).toISOString(),
      noticedAt: cache.noticedAt || null,
      update,
    });
  }

  if (!isUpdateStatus(update?.status)) {
    emit('', { modeLabel, status: update?.status || 'unknown' });
    return;
  }

  const shouldNotice = force
    || !cache.noticedAt
    || now - Date.parse(cache.noticedAt) >= noticeInterval
    || cache.update?.to !== update.to
    || cache.update?.remote !== update.remote;

  if (!shouldNotice) {
    emit('', { modeLabel, status: update.status, suppressed: true });
    return;
  }

  writeJsonFile(cachePath(), {
    checkedAt: cache.checkedAt || new Date(now).toISOString(),
    noticedAt: new Date(now).toISOString(),
    update,
  });

  emit(buildMessage(update), { modeLabel, status: update.status, update });
}

try {
  main();
} catch {
  // Hooks must fail open. A broken update reminder should never block work.
}
