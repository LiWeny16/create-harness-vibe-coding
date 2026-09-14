#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_ROOT = path.resolve(__dirname, '..', '..');
const rawArgs = process.argv.slice(2);
const JSON_OUT = rawArgs.includes('--json');
const DEFAULT_UPDATE_TIMEOUT_MS = 120000;
const UPDATE_TIMEOUT_EXIT = 3;

function readFlagValue(args, flagName) {
  const idx = args.indexOf(flagName);
  if (idx === -1) return null;
  const value = args[idx + 1];
  return value && !value.startsWith('--') ? value : null;
}

function stripFlagWithValue(args, flagName) {
  const next = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flagName) {
      i += 1;
      continue;
    }
    if (args[i].startsWith(`${flagName}=`)) continue;
    next.push(args[i]);
  }
  return next;
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(a, b) {
  if (!a || !b) return false;
  return comparablePath(a) === comparablePath(b);
}

function parseSemver(value) {
  if (!value || typeof value !== 'string') return [0, 0, 0];
  return value.replace(/^[^0-9]*/, '').split('.').slice(0, 3).map(part => Number(part) || 0);
}

function cmpSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if ((left[i] || 0) > (right[i] || 0)) return 1;
    if ((left[i] || 0) < (right[i] || 0)) return -1;
  }
  return 0;
}

function shouldAutoRepair(firstJson, targetVersion) {
  if (firstJson?.status !== 'up-to-date') return false;
  const remote = firstJson.remote || firstJson.to || null;
  if (remote && targetVersion && cmpSemver(remote, targetVersion) < 0) return false;
  return true;
}

function defaultGlobalDir() {
  return process.env.HARNESS_GLOBAL_HOME
    || path.join(os.homedir(), '.harness', 'create-harness-vibe-coding');
}

function versionPath(root) {
  return path.join(root, 'Harness', '.harness-version');
}

function updateScriptPath(root) {
  return path.join(root, 'Harness', 'scripts', 'wf-update-check.mjs');
}

function syncScriptPath(root) {
  return path.join(root, 'Harness', 'scripts', 'sync-host-global.mjs');
}

function validateScriptPath(root) {
  return path.join(root, 'Harness', 'scripts', 'validate-harness.mjs');
}

function scanCleanScriptPath(root) {
  return path.join(root, 'Harness', 'scripts', 'scan-clean.mjs');
}

function readVersion(root) {
  try {
    const file = versionPath(root);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function hasRunnableUpdater(root) {
  return fs.existsSync(versionPath(root)) && fs.existsSync(updateScriptPath(root));
}

function discoverGlobalRuntime(projectVersion) {
  const candidates = [];
  if (projectVersion?.globalDir) candidates.push(projectVersion.globalDir);
  if (process.env.HARNESS_GLOBAL_HOME) candidates.push(process.env.HARNESS_GLOBAL_HOME);
  candidates.push(defaultGlobalDir());
  const scriptVersion = readVersion(SCRIPT_ROOT);
  if (scriptVersion?.installScope === 'global') candidates.push(SCRIPT_ROOT);

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (hasRunnableUpdater(resolved)) return resolved;
  }
  return null;
}

function dedupeTargets(targets) {
  const seen = new Set();
  const result = [];
  for (const target of targets) {
    const key = comparablePath(target.root);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}

function discoverTargets(projectRoot) {
  const targets = [];
  const projectVersion = readVersion(projectRoot);
  const projectHasUpdater = hasRunnableUpdater(projectRoot);
  const globalRoot = discoverGlobalRuntime(projectVersion);

  if (projectHasUpdater && !samePath(projectRoot, globalRoot)) {
    targets.push({
      scope: projectVersion?.installScope === 'global' && projectVersion?.globalDir ? 'project-bridge' : 'project',
      root: projectRoot,
      version: projectVersion?.generator || null,
    });
  }

  if (globalRoot) {
    const globalVersion = readVersion(globalRoot);
    targets.push({
      scope: 'global',
      root: globalRoot,
      version: globalVersion?.generator || null,
    });
  }

  return dedupeTargets(targets);
}

function migrationRecommendation(projectRoot, targets) {
  const project = targets.find(target => target.scope === 'project');
  if (!project) return null;
  return {
    status: 'recommended',
    from: 'project',
    to: 'global',
    requiresConfirmation: true,
    reason: 'Project-local Harness is a legacy compatibility install. The recommended setup is one global runtime with project-local user state.',
    projectRoot: normalizePath(projectRoot),
    installCommand: 'npm install --global create-harness-vibe-coding@latest',
    migrateCommand: 'create-harness-vibe-coding init . --scope global --migrate',
    cleanupPolicy: 'Remove only safe Harness-owned framework files. Preserve tasks, progress, memory, research, project facts, README, package files, and modified or user-authored files.',
    preservedPaths: [
      'Harness/PROGRESS.md',
      'Harness/tasks/**',
      'Harness/memory/**',
      'Harness/research/**',
      'Harness/project/**',
      'README.md',
      'package.json',
      'package-lock.json',
      'modified or user-authored Harness-interest files',
    ],
    next: 'Ask the user whether to migrate. If accepted, install/update the global package, then run the migrate command. If declined, continue project-local update.',
  };
}

function parseTimeoutMs(args) {
  const raw = readFlagValue(args, '--timeout-ms') || process.env.WF_UPDATE_TIMEOUT_MS;
  if (!raw) return DEFAULT_UPDATE_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPDATE_TIMEOUT_MS;
}

function remainingTimeout(deadlineAt) {
  return Math.max(1, deadlineAt - Date.now());
}

function runNode(root, scriptPath, args, { parseJson = false, timeoutMs = DEFAULT_UPDATE_TIMEOUT_MS } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const timedOut = result.error?.code === 'ETIMEDOUT';
  let json = null;
  if (parseJson && stdout.trim()) {
    try {
      json = JSON.parse(stdout.trim());
    } catch {
      json = { rawOutput: stdout };
    }
  }
  if (timedOut && !json) {
    json = {
      status: 'timeout',
      code: 'UPDATE_TIMEOUT',
      message: `Update command exceeded the ${timeoutMs}ms deadline.`,
    };
  }
  return {
    status: timedOut ? UPDATE_TIMEOUT_EXIT : (result.status ?? 1),
    stdout,
    stderr,
    ...(timedOut ? { timedOut: true, errorCode: 'UPDATE_TIMEOUT' } : {}),
    ...(parseJson ? { json } : {}),
  };
}

function wantsApply(args) {
  return args.includes('--apply') || args.includes('--apply-safe') || args.includes('--safe-only') || args.includes('--finalize');
}

function wantsRepair(args) {
  return args.includes('--repair') || args.includes('--ignore-version') || args.includes('--force-check');
}

function ensureJsonArg(args) {
  return args.includes('--json') ? args : [...args, '--json'];
}

function withRepair(args) {
  return wantsRepair(args) ? args : [...args, '--repair'];
}

function runUpdateForTarget(target, forwardArgs, deadlineAt) {
  const parseJson = forwardArgs.includes('--json');
  const script = updateScriptPath(target.root);
  const first = runNode(target.root, script, forwardArgs, { parseJson, timeoutMs: remainingTimeout(deadlineAt) });
  const runs = [{ command: `node Harness/scripts/wf-update-check.mjs ${forwardArgs.join(' ')}`.trim(), ...first }];
  let effective = first;

  if (
    parseJson
    && first.status === 0
    && shouldAutoRepair(first.json, target.version)
    && !wantsRepair(forwardArgs)
  ) {
    const repairArgs = withRepair(forwardArgs);
    const repair = runNode(target.root, script, repairArgs, { parseJson, timeoutMs: remainingTimeout(deadlineAt) });
    runs.push({ command: `node Harness/scripts/wf-update-check.mjs ${repairArgs.join(' ')}`.trim(), ...repair });
    effective = repair;
  }

  return { ...target, update: effective, runs };
}

function runPostUpdate(target, forwardArgs, deadlineAt) {
  const post = [];
  const apply = wantsApply(forwardArgs);
  const syncScript = syncScriptPath(target.root);
  if (target.scope === 'global' && fs.existsSync(syncScript)) {
    const syncArgs = apply ? ['--apply', '--json'] : ['--json'];
    post.push({
      step: 'sync-host-global',
      ...runNode(target.root, syncScript, syncArgs, { parseJson: true, timeoutMs: remainingTimeout(deadlineAt) }),
    });
  }
  if (apply && fs.existsSync(validateScriptPath(target.root))) {
    post.push({
      step: 'validate',
      ...runNode(target.root, validateScriptPath(target.root), [], { parseJson: false, timeoutMs: remainingTimeout(deadlineAt) }),
    });
    post.push({
      step: 'manifest-audit',
      ...runNode(target.root, validateScriptPath(target.root), ['--manifest-audit'], { parseJson: false, timeoutMs: remainingTimeout(deadlineAt) }),
    });
  }
  if (apply && fs.existsSync(scanCleanScriptPath(target.root))) {
    post.push({
      step: 'scan-clean',
      ...runNode(target.root, scanCleanScriptPath(target.root), ['--json'], { parseJson: true, timeoutMs: remainingTimeout(deadlineAt) }),
    });
  }
  return post;
}

function printText(result) {
  if (!result.targets.length) {
    console.error(result.message);
    return;
  }
  for (const target of result.targets) {
    console.log(`\n[${target.scope}] ${target.root}`);
    for (const run of target.runs || []) {
      if (run.stdout) process.stdout.write(run.stdout);
      if (run.stderr) process.stderr.write(run.stderr);
    }
    for (const post of target.post || []) {
      console.log(`[post:${post.step}] exit ${post.status}`);
      if (post.stdout) process.stdout.write(post.stdout);
      if (post.stderr) process.stderr.write(post.stderr);
    }
  }
  if (result.migration) {
    console.log('\n[recommended migration]');
    console.log(`Project-local Harness detected at ${result.migration.projectRoot}.`);
    console.log(result.migration.reason);
    console.log(`Install: ${result.migration.installCommand}`);
    console.log(`Migrate: ${result.migration.migrateCommand}`);
    console.log('User data and modified/user-authored Harness files are preserved by the migration cleanup.');
  }
}

function main() {
  const projectRoot = path.resolve(readFlagValue(rawArgs, '--project') || process.cwd());
  const forwardArgs = stripFlagWithValue(rawArgs, '--project');
  const effectiveArgs = JSON_OUT ? ensureJsonArg(forwardArgs) : forwardArgs;
  const deadlineAt = Date.now() + parseTimeoutMs(rawArgs);
  const targets = discoverTargets(projectRoot);
  const migration = migrationRecommendation(projectRoot, targets);

  if (targets.length === 0) {
    const result = {
      success: false,
      status: 'no-harness-target',
      projectRoot: normalizePath(projectRoot),
      message: 'No project Harness updater or global Harness runtime was found. No project files were modified.',
      targets: [],
      migration: null,
    };
    if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
    else printText(result);
    process.exitCode = 1;
    return;
  }

  const updatedTargets = targets.map(target => {
    const withUpdate = runUpdateForTarget(target, effectiveArgs, deadlineAt);
    return {
      ...withUpdate,
      post: runPostUpdate(withUpdate, effectiveArgs, deadlineAt),
    };
  });

  const failures = [];
  for (const target of updatedTargets) {
    if (target.update.status !== 0) {
      failures.push(target.update.timedOut
        ? `${target.scope}: update timeout`
        : `${target.scope}: update exit ${target.update.status}`);
    }
    for (const post of target.post || []) {
      if (post.status !== 0) {
        failures.push(post.timedOut
          ? `${target.scope}: ${post.step} timeout`
          : `${target.scope}: ${post.step} exit ${post.status}`);
      }
    }
  }

  const result = {
    success: failures.length === 0,
    status: failures.length === 0 ? 'ok' : 'failed',
    projectRoot: normalizePath(projectRoot),
    targets: updatedTargets.map(target => ({
      ...target,
      root: normalizePath(target.root),
    })),
    migration,
    ...(failures.length ? { failures } : {}),
  };

  if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
  else printText(result);
  if (failures.length) {
    const timedOut = updatedTargets.some(target => target.update.timedOut
      || (target.post || []).some(post => post.timedOut));
    process.exitCode = timedOut ? UPDATE_TIMEOUT_EXIT : 1;
  }
}

main();
