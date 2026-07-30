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

function runNode(root, scriptPath, args, { parseJson = false } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  let json = null;
  if (parseJson && stdout.trim()) {
    try {
      json = JSON.parse(stdout.trim());
    } catch {
      json = { rawOutput: stdout };
    }
  }
  return {
    status: result.status ?? 1,
    stdout,
    stderr,
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

function runUpdateForTarget(target, forwardArgs) {
  const parseJson = forwardArgs.includes('--json');
  const script = updateScriptPath(target.root);
  const first = runNode(target.root, script, forwardArgs, { parseJson });
  const runs = [{ command: `node Harness/scripts/wf-update-check.mjs ${forwardArgs.join(' ')}`.trim(), ...first }];
  let effective = first;

  if (
    parseJson
    && first.status === 0
    && shouldAutoRepair(first.json, target.version)
    && !wantsRepair(forwardArgs)
  ) {
    const repairArgs = withRepair(forwardArgs);
    const repair = runNode(target.root, script, repairArgs, { parseJson });
    runs.push({ command: `node Harness/scripts/wf-update-check.mjs ${repairArgs.join(' ')}`.trim(), ...repair });
    effective = repair;
  }

  return { ...target, update: effective, runs };
}

function runPostUpdate(target, forwardArgs) {
  const post = [];
  const apply = wantsApply(forwardArgs);
  const syncScript = syncScriptPath(target.root);
  if (target.scope === 'global' && fs.existsSync(syncScript)) {
    const syncArgs = apply ? ['--apply', '--json'] : ['--json'];
    post.push({
      step: 'sync-host-global',
      ...runNode(target.root, syncScript, syncArgs, { parseJson: true }),
    });
  }
  if (apply && fs.existsSync(validateScriptPath(target.root))) {
    post.push({
      step: 'validate',
      ...runNode(target.root, validateScriptPath(target.root), [], { parseJson: false }),
    });
    post.push({
      step: 'manifest-audit',
      ...runNode(target.root, validateScriptPath(target.root), ['--manifest-audit'], { parseJson: false }),
    });
  }
  if (apply && target.scope !== 'global' && fs.existsSync(scanCleanScriptPath(target.root))) {
    post.push({
      step: 'scan-clean',
      ...runNode(target.root, scanCleanScriptPath(target.root), ['--json'], { parseJson: true }),
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
}

function main() {
  const projectRoot = path.resolve(readFlagValue(rawArgs, '--project') || process.cwd());
  const forwardArgs = stripFlagWithValue(rawArgs, '--project');
  const effectiveArgs = JSON_OUT ? ensureJsonArg(forwardArgs) : forwardArgs;
  const targets = discoverTargets(projectRoot);

  if (targets.length === 0) {
    const result = {
      success: false,
      status: 'no-harness-target',
      projectRoot: normalizePath(projectRoot),
      message: 'No project Harness updater or global Harness runtime was found. No project files were modified.',
      targets: [],
    };
    if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
    else printText(result);
    process.exitCode = 1;
    return;
  }

  const updatedTargets = targets.map(target => {
    const withUpdate = runUpdateForTarget(target, effectiveArgs);
    return {
      ...withUpdate,
      post: runPostUpdate(withUpdate, effectiveArgs),
    };
  });

  const failures = [];
  for (const target of updatedTargets) {
    if (target.update.status !== 0) failures.push(`${target.scope}: update exit ${target.update.status}`);
    for (const post of target.post || []) {
      if (post.status !== 0) failures.push(`${target.scope}: ${post.step} exit ${post.status}`);
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
    ...(failures.length ? { failures } : {}),
  };

  if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
  else printText(result);
  if (failures.length) process.exitCode = 1;
}

main();
