#!/usr/bin/env node
import * as p from '@clack/prompts';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import pc from 'picocolors';
import { askConflictPolicy, askInstallScope, askOptionalSelections, askProjectName, askTargetDir } from './prompts.js';
import { generate, getOptionalCatalog } from './generator.js';

const UPDATE_SUCCESS_STATUSES = new Set(['up-to-date', 'update-available', 'partial-update']);
const UPDATE_FAILURE_STATUSES = new Set(['error', 'offline', 'template-remote', 'downgrade-refused']);
const CANONICAL_UPDATE_SOURCE_BASE = 'https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/';

// ── CLI flags ──────────────────────────────────────────────
const raw = process.argv.slice(2);
function extractFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  const withEquals = args.find(arg => arg.startsWith(`${flag}=`));
  if (withEquals) return withEquals.slice(flag.length + 1);
  return null;
}
function hasFlag(args, flag) {
  return args.includes(flag);
}

// wf-ui subcommand: handle before parseArgs so --project/--port/--open flags
// never fall through to the scaffold installer.
if (raw[0] === 'wf-ui') {
  await runWfUi(raw.slice(1));
  await flushStdout();
  process.exit(0);
}

const parsed = parseArgs(raw);
const showHelp = parsed.flags.help || parsed.flags.h;
const skipPrompts = parsed.flags.yes || parsed.flags.y;
const conflictPolicyProvided = parsed.flags.onConflict !== undefined;

if (parsed.errors.length > 0 && raw[0] !== 'wf-ui') {
  for (const err of parsed.errors) {
    console.error(pc.red(`Error: ${err}`));
  }
  process.exit(1);
}

if (showHelp) {
  console.log('');
  console.log('  create-harness-vibe-coding');
  console.log('');
  console.log('  Usage:');
  console.log('    npx create-harness-vibe-coding@latest [project-name] [target-dir] [flags]');
  console.log('');
  console.log('  Arguments:');
  console.log('    project-name   Name for the new project (default: my-vibe-project)');
  console.log('    target-dir     Directory to create the project in (default: ./<project-name>)');
  console.log('');
  console.log('  Flags:');
  console.log('    -y, --yes                    Skip all prompts, use defaults or provided args');
  console.log('    -h, --help                   Show this help');
  console.log('    --dry-run                    Print the planned writes without creating files');
  console.log('    --on-conflict <policy>       fail, skip, backup, or overwrite (default: fail)');
  console.log('    --with <id,id>               Add optional local workflow skills');
  console.log('    --without <id,id>            Remove optional workflow skills selected by --preset or --with');
  console.log('    --recommend <id,id>          Record recommendation-only external capabilities');
  console.log('    --preset <name>              Add a built-in optional workflow preset');
  console.log('    --install-scope <scope>      project or global (default: project)');
  console.log('    --global-dir <dir>           Global Harness runtime directory for --install-scope global');
  console.log('    --host-global-dir <dir>      Base directory for Claude/Codex/OpenCode global copies');
  console.log('    --list-options               Print optional workflow skills and presets');
  console.log('    --json                       Output machine-readable JSON (use with --dry-run for planning)');
  console.log('');
  console.log('  Interactive mode offers checkbox selection for optional workflows and external recommendations.');
  console.log('');
  console.log('  Examples:');
  console.log('    npx create-harness-vibe-coding@latest');
  console.log('    npx create-harness-vibe-coding@latest -y');
  console.log('    npx create-harness-vibe-coding@latest my-project');
  console.log('    npx create-harness-vibe-coding@latest my-project ./dist/my-project -y');
  console.log('    npx create-harness-vibe-coding@latest legacy ./legacy -y --dry-run');
  console.log('    npx create-harness-vibe-coding@latest legacy ./legacy -y --on-conflict skip');
  console.log('    npx create-harness-vibe-coding@latest web ./web -y --with ts-react-frontend,ui-ux-review');
  console.log('    npx create-harness-vibe-coding@latest web ./web -y --preset web-app');
  console.log('    npx create-harness-vibe-coding@latest api ./api -y --preset fullstack --without github-pr-review');
  console.log('    npx create-harness-vibe-coding@latest app ./app -y --install-scope global');
  console.log('');
  process.exit(0);
}

if (parsed.flags.listOptions) {
  printOptions();
  process.exit(0);
}

// Positional args (non-flag)
const positional = parsed.positionals;
const argName = positional[0];
const argDir = positional[1];
const generationOptions = {
  dryRun: Boolean(parsed.flags.dryRun),
  onConflict: parsed.flags.onConflict || 'fail',
  withOptions: parsed.flags.with || [],
  withoutOptions: parsed.flags.without || [],
  externalOptions: parsed.flags.recommend || [],
  preset: parsed.flags.preset,
  installScope: parsed.flags.installScope || 'project',
  globalDir: parsed.flags.globalDir,
  hostGlobalDir: parsed.flags.hostGlobalDir,
  json: Boolean(parsed.flags.json),
};

const DEFAULT_NAME = 'my-vibe-project';

// --json: machine-readable output, no prompts, no decorative output
if (generationOptions.json) {
  const projectName = argName || DEFAULT_NAME;
  const targetDir = argDir || `./${projectName}`;
  const scan = scanTarget(targetDir);
  if (needsScaffoldRecovery(scan)) {
    const recovery = createScaffoldRecoveryResult({ projectName, targetDir, options: generationOptions, scan });
    printJsonResult(recovery);
    process.exit(recovery.success ? 0 : 1);
  }

  if (scan.hasHarness) {
    printJsonResult(createUpdateSwitchResult(scan, { json: true }));
    process.exit(0);
  }
  const result = generate({ projectName, targetDir, ...generationOptions });
  result.scan = createJsonScan(scan);
  result.agent = createAgentGuidance(result, {
    projectName,
    targetDir,
    options: generationOptions,
    scan,
  });
  printJsonResult(result);
  // printJsonResult exits with 1 on failure; we only reach here on success
  process.exit(0);
}

console.log('');
console.log(pc.magenta('╔══════════════════════════════════════════╗'));
console.log(pc.magenta('║   create-harness-vibe-coding             ║'));
console.log(pc.magenta('║   0-1 Product Harness Scaffold           ║'));
console.log(pc.magenta('╚══════════════════════════════════════════╝'));
console.log('');

let projectName, targetDir;

// wf-ui: server already running, skip the scaffold/update flow
if (raw[0] !== 'wf-ui') {
// Non-interactive: positionals provided OR -y/--yes flag set
if (argName || skipPrompts) {
  projectName = argName || DEFAULT_NAME;
  targetDir = argDir || `./${projectName}`;
  const scan = scanTarget(targetDir);

  if (needsScaffoldRecovery(scan)) {
    process.exit(runScaffoldRecovery({ projectName, targetDir, options: generationOptions, scan }));
  }

  if (scan.hasHarness) {
    process.exit(runUpdateSwitch(scan, { json: false }));
  }

  console.log(pc.dim('────────────────────────────────────────────'));
  console.log(`  Project     ${pc.green(projectName)}`);
  console.log(`  Directory   ${pc.green(targetDir)}`);
  console.log(`  Scope       ${pc.green(generationOptions.installScope)}`);
  if (generationOptions.globalDir) {
    console.log(`  Global dir  ${pc.green(generationOptions.globalDir)}`);
  }
  if (generationOptions.hostGlobalDir) {
    console.log(`  Host dir    ${pc.green(generationOptions.hostGlobalDir)}`);
  }
  const creates = generationOptions.installScope === 'global'
    ? 'project bridge/state/settings + global runtime + Claude/Codex/OpenCode host copies'
    : 'CLAUDE.md, README.md, Harness/PROGRESS.md, Harness/, .claude/, .agents/, .opencode/, opencode.json, tests/';
  console.log(`  Creates     ${pc.cyan(creates)}`);
  if (generationOptions.dryRun) {
    console.log(`  Mode        ${pc.yellow('dry-run')}`);
  }
  console.log(`  Conflicts   ${pc.cyan(generationOptions.onConflict)}`);
  if (generationOptions.withOptions.length > 0) {
    console.log(`  Optional    ${pc.cyan(generationOptions.withOptions.join(','))}`);
  }
  if (generationOptions.withoutOptions.length > 0) {
    console.log(`  Without     ${pc.cyan(generationOptions.withoutOptions.join(','))}`);
  }
  if (generationOptions.externalOptions.length > 0) {
    console.log(`  Recommend   ${pc.cyan(generationOptions.externalOptions.join(','))}`);
  }
  if (generationOptions.preset) {
    console.log(`  Preset      ${pc.cyan(generationOptions.preset)}`);
  }
  if (skipPrompts) {
    console.log(`  Mode        ${pc.dim('non-interactive (-y)')}`);
  }
  console.log(pc.dim('────────────────────────────────────────────'));
  console.log('');

  const result = generate({ projectName, targetDir, ...generationOptions });
  printResult(result, targetDir);
} else {
  // Interactive mode
  try {
    projectName = await askProjectName();
  } catch {
    projectName = 'my-vibe-project';
    console.log(pc.dim(`  Project: ${projectName} (default)`));
  }

  try {
    targetDir = await askTargetDir(projectName);
  } catch {
    targetDir = `./${projectName}`;
    console.log(pc.dim(`  Directory: ${targetDir} (default)`));
  }

  try {
    generationOptions.installScope = await askInstallScope();
  } catch {
    generationOptions.installScope = 'project';
    console.log(pc.dim('  Scope: project (default)'));
  }

  const scan = scanTarget(targetDir);
  printScan(scan);

  if (needsScaffoldRecovery(scan)) {
    process.exit(runScaffoldRecovery({ projectName, targetDir, options: generationOptions, scan }));
  }

  if (scan.hasHarness) {
    process.exit(runUpdateSwitch(scan, { json: false }));
  }

  if (!generationOptions.dryRun && !conflictPolicyProvided && scan.needsConflictPolicy) {
    try {
      generationOptions.onConflict = await askConflictPolicy(scan);
    } catch {
      generationOptions.onConflict = 'skip';
      console.log(pc.dim('  Conflicts: skip (preserve existing files default)'));
    }
  }

  const optionFlagsProvided = generationOptions.withOptions.length > 0
    || generationOptions.withoutOptions.length > 0
    || generationOptions.externalOptions.length > 0
    || generationOptions.preset;

  if (!optionFlagsProvided) {
    try {
      const selected = await askOptionalSelections(getOptionalCatalog());
      generationOptions.withOptions = selected.withOptions;
      generationOptions.externalOptions = selected.externalOptions;
    } catch {
      generationOptions.withOptions = [];
      generationOptions.externalOptions = [];
      console.log(pc.dim('  Optional: none (default)'));
    }
  }

  console.log('');
  console.log(pc.dim('────────────────────────────────────────────'));
  console.log(`  Project     ${pc.green(projectName)}`);
  console.log(`  Directory   ${pc.green(targetDir)}`);
  console.log(`  Scope       ${pc.green(generationOptions.installScope)}`);
  if (generationOptions.globalDir) {
    console.log(`  Global dir  ${pc.green(generationOptions.globalDir)}`);
  }
  if (generationOptions.hostGlobalDir) {
    console.log(`  Host dir    ${pc.green(generationOptions.hostGlobalDir)}`);
  }
  const creates = generationOptions.installScope === 'global'
    ? 'project bridge/state + global runtime + Claude/Codex/OpenCode host copies'
    : 'CLAUDE.md, README.md, Harness/PROGRESS.md, Harness/, .claude/, .agents/, .opencode/, opencode.json, tests/';
  console.log(`  Creates     ${pc.cyan(creates)}`);
  console.log(`  Conflicts   ${pc.cyan(generationOptions.onConflict)}`);
  if (generationOptions.withOptions.length > 0) {
    console.log(`  Optional    ${pc.cyan(generationOptions.withOptions.join(','))}`);
  }
  if (generationOptions.externalOptions.length > 0) {
    console.log(`  Recommend   ${pc.cyan(generationOptions.externalOptions.join(','))}`);
  }
  console.log(pc.dim('────────────────────────────────────────────'));
  console.log('');

  const preview = generate({ projectName, targetDir, ...generationOptions, dryRun: true });
  if (!preview.success) {
    printResult(preview, targetDir);
  }

  console.log(pc.yellow('Planned changes: no files have been written yet.'));
  console.log(pc.bold('Project plan:'));
  printSummary(preview.summary);
  printPlan(preview.plan);
  if (preview.globalPlan) {
    console.log(pc.bold('\nGlobal runtime plan:'));
    console.log(`  Directory   ${pc.cyan(preview.globalDir)}`);
    printSummary(preview.globalSummary);
    printPlan(preview.globalPlan);
  }
  printHostPlans(preview.hostPlans, preview.hostSummary);
  printWarnings(preview);
  console.log('');

  if (generationOptions.dryRun) {
    process.exit(0);
  }

  let proceed = true;
  try {
    proceed = await p.confirm({
      message: 'Confirm generation with this plan?',
      initialValue: true,
    });
    if (p.isCancel(proceed)) proceed = false;
  } catch {
    proceed = true;
  }

  if (!proceed) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  console.log('');
  const result = generate({ projectName, targetDir, ...generationOptions });
  printResult(result, targetDir);
}

function printResult(result, targetDir) {
  if (result.success) {
    if (result.dryRun) {
      console.log(pc.yellow('\nDry run: no files or directories were written.'));
      console.log(pc.bold('Project plan:'));
      printSummary(result.summary);
      printPlan(result.plan);
      if (result.globalPlan) {
        console.log(pc.bold('\nGlobal runtime plan:'));
        console.log(`  Directory   ${pc.cyan(result.globalDir)}`);
        printSummary(result.globalSummary);
        printPlan(result.globalPlan);
      }
      printHostPlans(result.hostPlans, result.hostSummary);
      if (result.warnings.length > 0) {
        console.log(pc.yellow('\nWarning(s):'));
        for (const warning of result.warnings) {
          console.log(pc.yellow(`  - ${warning}`));
        }
      }
      console.log('');
      return;
    }

    console.log(pc.green('\nGeneration complete.\n'));
    console.log(pc.bold('Project install:'));
    printSummary(result.summary);
    if (result.globalSummary) {
      console.log(pc.bold('Global runtime:'));
      console.log(`  Directory   ${pc.cyan(result.globalDir)}`);
      printSummary(result.globalSummary);
    }
    printHostPlans(result.hostPlans, result.hostSummary, { summaryOnly: true });

    printWarnings(result);

    console.log(pc.bold('Next steps:'));
    console.log(`  ${pc.cyan(`cd ${targetDir}`)}`);
    console.log(`  ${pc.cyan('claude')}                          # Start Claude Code`);
    console.log(`  ${pc.cyan('codex')}                           # Or start Codex`);
    console.log(`  ${pc.cyan('opencode')}                        # Or start OpenCode`);
    console.log(`  Tell your agent: "${pc.yellow('Read Harness/specs/guides/SETUP.md. Bootstrap this project from idea to first vertical slice.')}"`);
    console.log('');
    console.log(pc.dim('  Keep Harness/specs/guides/SETUP.md as a setup reference; normal sessions start at CLAUDE.md, with Harness/README.md as the routed workflow router.'));
    console.log('');

  } else {
    console.log(pc.red('\nGeneration failed:'));
    for (const err of result.errors) {
      console.log(pc.red(`  - ${err}`));
    }
    process.exit(1);
  }
}
} // wf-ui skip block end — functions below are module-scoped

async function runWfUi(args) {
  const projectRoot = extractFlag(args, '--project') || process.cwd();
  const host = extractFlag(args, '--host') || '127.0.0.1';
  const rawPort = extractFlag(args, '--port') || '0';
  const port = Number.parseInt(rawPort, 10);
  const openBrowser = !hasFlag(args, '--no-open');
  const detach = hasFlag(args, '--detach');
  const detachedChild = hasFlag(args, '--detached-child');

  if (host !== '127.0.0.1') {
    console.error('[wf-ui] host must be 127.0.0.1');
    process.exit(1);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('[wf-ui] port must be an integer from 0 to 65535');
    process.exit(1);
  }

  if (detach && !detachedChild) {
    try {
      await runDetachedWfUi(args);
    } catch (err) {
      console.error(`[wf-ui] ${err.message}`);
      process.exit(1);
    }
    return;
  }

  try {
    const serverModule = await import('./wf-ui-server/server.mjs');
    const { SessionRegistry } = await import('./wf-ui-server/session-registry.mjs');
    const { attachEventsWs } = await import('./wf-ui-server/ws-events.mjs');
    const { attachTerminalWs } = await import('./wf-ui-server/ws-terminal.mjs');
    const { warmRuntimeCache } = await import('./wf-ui-server/runtime-detector.mjs');
    const { appendSessionEvent, appendTerminalData, persistSession, recordInputRequest } =
      await import('./wf-ui-server/terminal-store.mjs');
    const registry = new SessionRegistry();
    const terminalHub = {};
    const started = await serverModule.startServer({
      projectRoot,
      host,
      port,
      sessionRegistry: registry,
      terminalHub,
    });
    attachEventsWs(started.server, started.token, projectRoot);
    Object.assign(terminalHub, attachTerminalWs(started.server, started.token, registry, {
      onTerminalInput(session, data) {
        try {
          recordInputRequest(projectRoot, session.sessionId, data);
        } catch {
          // The session may not have been persisted yet; stdout/stderr capture still remains authoritative.
        }
        appendTerminalData(projectRoot, session, data, 'stdin');
      },
      onAttachModeChange(session, attachMode) {
        persistSession(projectRoot, session);
        appendSessionEvent(projectRoot, session, { type: 'session.attach-mode', attachMode });
      },
      onSessionState(session, state) {
        persistSession(projectRoot, session);
        appendSessionEvent(projectRoot, session, { type: 'session.state', state });
      },
    }));
    warmRuntimeCache();
    await writeStdoutLine(`[wf-ui] ${started.url}`);
    writeWfUiReadyFile(started.url, projectRoot);
    if (openBrowser) openLocalUrl(started.url);
    try {
      await waitForWfUiShutdown(started.server);
    } finally {
      cleanupWfUiLaunchDirFromReadyFile();
    }
  } catch (err) {
    console.error(`[wf-ui] ${err.message}`);
    process.exit(1);
  }
}

async function runDetachedWfUi(args) {
  const projectRoot = extractFlag(args, '--project') || process.cwd();
  const readyDir = process.env.HARNESS_WF_UI_READY_FILE
    ? null
    : makeProjectLocalWfUiLaunchDir(projectRoot);
  const readyFile = process.env.HARNESS_WF_UI_READY_FILE || path.join(readyDir, 'ready.json');
  const logFile = path.join(path.dirname(readyFile), 'wf-ui.log');
  fs.mkdirSync(path.dirname(readyFile), { recursive: true });
  try { fs.rmSync(readyFile, { force: true }); } catch {}

  const childArgs = args.filter(arg => arg !== '--detach');
  childArgs.push('--detached-child');
  const child = spawnDetachedWfUiChild(childArgs, readyFile, logFile);

  let childExit = null;
  child.once('exit', (code, signal) => {
    childExit = { code, signal };
  });
  child.unref();

  const started = await waitForWfUiReadyFile(readyFile, () => {
    if (process.platform === 'win32' && childExit?.code === 0) return null;
    return childExit;
  }, logFile);
  spawnWfUiLaunchCleanupWatcher(started.pid, path.dirname(readyFile));
  await writeStdoutLine(`[wf-ui] ${started.url}`);
}

function makeProjectLocalWfUiLaunchDir(projectRoot) {
  const launchRoot = path.join(path.resolve(projectRoot || process.cwd()), 'Harness', '.temp', 'wf-ui-launch');
  fs.mkdirSync(launchRoot, { recursive: true });
  return fs.mkdtempSync(path.join(launchRoot, 'harness-wf-ui-'));
}

function spawnDetachedWfUiChild(childArgs, readyFile, logFile) {
  if (process.platform === 'win32') {
    const launcherScript = `
const { spawn } = require('child_process');
const fs = require('fs');
const spec = JSON.parse(process.argv[1]);
const logFd = fs.openSync(spec.logFile, 'a');
const child = spawn(spec.execPath, spec.argv, {
  cwd: spec.cwd,
  detached: true,
  env: { ...process.env, HARNESS_WF_UI_READY_FILE: spec.readyFile },
  stdio: ['ignore', logFd, logFd],
  windowsHide: true,
});
fs.closeSync(logFd);
child.unref();
`;
    return spawn(process.execPath, ['-e', launcherScript, JSON.stringify({
      execPath: process.execPath,
      argv: [process.argv[1], 'wf-ui', ...childArgs],
      cwd: process.cwd(),
      readyFile,
      logFile,
    })], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [process.argv[1], 'wf-ui', ...childArgs], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      HARNESS_WF_UI_READY_FILE: readyFile,
    },
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  return child;
}

function writeWfUiReadyFile(url, projectRoot) {
  const readyFile = process.env.HARNESS_WF_UI_READY_FILE;
  if (!readyFile) return;
  try {
    fs.mkdirSync(path.dirname(readyFile), { recursive: true });
    fs.writeFileSync(readyFile, `${JSON.stringify({
      url,
      pid: process.pid,
      projectRoot: path.resolve(projectRoot),
      startedAt: new Date().toISOString(),
    })}\n`, 'utf8');
  } catch (err) {
    console.error(`[wf-ui] could not write ready file: ${err.message}`);
  }
}

function isProjectLocalWfUiLaunchDir(dir) {
  const resolved = path.resolve(dir);
  const launchRoot = path.dirname(resolved);
  return path.basename(resolved).startsWith('harness-wf-ui-')
    && path.basename(launchRoot) === 'wf-ui-launch'
    && path.basename(path.dirname(launchRoot)) === '.temp'
    && path.basename(path.dirname(path.dirname(launchRoot))) === 'Harness';
}

function removeWfUiLaunchDir(dir) {
  if (!isProjectLocalWfUiLaunchDir(dir)) return;
  const resolved = path.resolve(dir);
  const launchRoot = path.dirname(resolved);
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; the detached cleanup watcher also retries after process exit.
  }
  try {
    if (fs.existsSync(launchRoot) && fs.readdirSync(launchRoot).length === 0) {
      fs.rmdirSync(launchRoot);
    }
  } catch {
    // no-op
  }
}

function cleanupWfUiLaunchDirFromReadyFile() {
  const readyFile = process.env.HARNESS_WF_UI_READY_FILE;
  if (!readyFile) return;
  removeWfUiLaunchDir(path.dirname(readyFile));
}

function spawnWfUiLaunchCleanupWatcher(pid, launchDir) {
  if (!pid || !isProjectLocalWfUiLaunchDir(launchDir)) return;
  const watcherScript = `
const fs = require('fs');
const path = require('path');
const pid = Number(process.argv[1]);
const dir = process.argv[2];
const launchRoot = path.dirname(dir);
function alive() {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function cleanup() {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  try {
    if (fs.existsSync(launchRoot) && fs.readdirSync(launchRoot).length === 0) {
      fs.rmdirSync(launchRoot);
    }
  } catch {}
}
(function wait() {
  if (!alive()) {
    cleanup();
    return;
  }
  setTimeout(wait, 1000);
})();
`;
  try {
    const watcher = spawn(process.execPath, ['-e', watcherScript, String(pid), path.resolve(launchDir)], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    watcher.unref();
  } catch {
    // no-op
  }
}

function waitForWfUiReadyFile(readyFile, getChildExit, logFile) {
  const deadline = Date.now() + 15000;
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        if (fs.existsSync(readyFile)) {
          const payload = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
          if (payload?.url) {
            resolve(payload);
            return;
          }
        }
      } catch {
        // The child may still be writing the handoff file.
      }

      const childExit = getChildExit();
      if (childExit) {
        reject(new Error(`detached server exited before startup (${childExit.signal || childExit.code}); log: ${logFile}`));
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`detached server did not report a URL within 15s; log: ${logFile}`));
        return;
      }
      setTimeout(poll, 80);
    };
    poll();
  });
}

function waitForWfUiShutdown(server) {
  return new Promise((resolve) => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      server.close(() => resolve());
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    server.once('close', resolve);
  });
}

function openLocalUrl(url) {
  const command = process.platform === 'win32'
    ? { file: 'cmd', args: ['/c', 'start', '', url] }
    : process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : { file: 'xdg-open', args: [url] };

  try {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch (err) {
    console.error(`[wf-ui] could not open browser automatically: ${err.message}`);
  }
}

function flushStdout() {
  return new Promise((resolve) => {
    if (!process.stdout.writable || process.stdout.writableEnded) {
      resolve();
      return;
    }
    process.stdout.write('', resolve);
  });
}

function writeStdoutLine(line) {
  return new Promise((resolve) => {
    if (!process.stdout.writable || process.stdout.writableEnded) {
      resolve();
      return;
    }
    process.stdout.write(`${line}\n`, resolve);
  });
}

function parseArgs(args) {
  const flags = {
    with: [],
    without: [],
  };
  const positionals = [];
  const errors = [];

  function readValue(flagName, index) {
    const value = args[index + 1];
    if (!value || value.startsWith('-')) {
      errors.push(`${flagName} requires a value`);
      return { value: undefined, nextIndex: index };
    }
    return { value, nextIndex: index + 1 };
  }

  function readEqualsValue(flagName, value) {
    if (!value || value.startsWith('-')) {
      errors.push(`${flagName} requires a value`);
      return undefined;
    }
    return value;
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '-h') {
      flags.h = true;
    } else if (arg === '--help') {
      flags.help = true;
    } else if (arg === '-y') {
      flags.y = true;
    } else if (arg === '--yes') {
      flags.yes = true;
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--list-options') {
      flags.listOptions = true;
    } else if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--on-conflict') {
      const parsedValue = readValue('--on-conflict', i);
      flags.onConflict = parsedValue.value;
      i = parsedValue.nextIndex;
    } else if (arg.startsWith('--on-conflict=')) {
      flags.onConflict = readEqualsValue('--on-conflict', arg.slice('--on-conflict='.length));
    } else if (arg === '--with') {
      const parsedValue = readValue('--with', i);
      if (parsedValue.value !== undefined) flags.with.push(parsedValue.value);
      i = parsedValue.nextIndex;
    } else if (arg.startsWith('--with=')) {
      const value = readEqualsValue('--with', arg.slice('--with='.length));
      if (value !== undefined) flags.with.push(value);
    } else if (arg === '--without') {
      const parsedValue = readValue('--without', i);
      if (parsedValue.value !== undefined) flags.without.push(parsedValue.value);
      i = parsedValue.nextIndex;
    } else if (arg.startsWith('--without=')) {
      const value = readEqualsValue('--without', arg.slice('--without='.length));
      if (value !== undefined) flags.without.push(value);
    } else if (arg === '--recommend') {
      const parsedValue = readValue('--recommend', i);
      if (parsedValue.value !== undefined) {
        if (!flags.recommend) flags.recommend = [];
        flags.recommend.push(parsedValue.value);
      }
      i = parsedValue.nextIndex;
    } else if (arg.startsWith('--recommend=')) {
      const value = readEqualsValue('--recommend', arg.slice('--recommend='.length));
      if (value !== undefined) {
        if (!flags.recommend) flags.recommend = [];
        flags.recommend.push(value);
      }
    } else if (arg === '--preset') {
      const parsedValue = readValue('--preset', i);
      flags.preset = parsedValue.value;
      i = parsedValue.nextIndex;
    } else if (arg.startsWith('--preset=')) {
      flags.preset = readEqualsValue('--preset', arg.slice('--preset='.length));
    } else if (arg === '--install-scope') {
      const parsedValue = readValue('--install-scope', i);
      flags.installScope = parsedValue.value;
      i = parsedValue.nextIndex;
    } else if (arg.startsWith('--install-scope=')) {
      flags.installScope = readEqualsValue('--install-scope', arg.slice('--install-scope='.length));
    } else if (arg === '--global-dir') {
      const parsedValue = readValue('--global-dir', i);
      flags.globalDir = parsedValue.value;
      i = parsedValue.nextIndex;
    } else if (arg.startsWith('--global-dir=')) {
      flags.globalDir = readEqualsValue('--global-dir', arg.slice('--global-dir='.length));
    } else if (arg === '--host-global-dir') {
      const parsedValue = readValue('--host-global-dir', i);
      flags.hostGlobalDir = parsedValue.value;
      i = parsedValue.nextIndex;
    } else if (arg.startsWith('--host-global-dir=')) {
      flags.hostGlobalDir = readEqualsValue('--host-global-dir', arg.slice('--host-global-dir='.length));
    } else if (arg.startsWith('-')) {
      errors.push(`Unknown flag "${arg}"`);
    } else {
      positionals.push(arg);
    }
  }

  return { flags, positionals, errors };
}

function printOptions() {
  const catalog = getOptionalCatalog();

  console.log('');
  console.log(pc.bold('Optional workflow skills:'));
  for (const skill of catalog.skills) {
    console.log(`  ${pc.cyan(skill.id)} - ${skill.description}`);
  }

  console.log('');
  console.log(pc.bold('Presets:'));
  for (const [name, skills] of Object.entries(catalog.presets)) {
    console.log(`  ${pc.cyan(name)} - ${skills.join(', ')}`);
  }

  if (catalog.externalRecommendations?.length) {
    console.log('');
    console.log(pc.bold('External recommendations:'));
    for (const item of catalog.externalRecommendations) {
      console.log(`  ${pc.cyan(item.id)} - ${item.description} (${item.installMode}) ${item.url || ''}`.trimEnd());
    }
  }
  console.log('');
}

function printSummary(summary) {
  console.log(`  created     ${pc.green(summary.created)}`);
  console.log(`  skipped     ${pc.yellow(summary.skipped)}`);
  console.log(`  backed up   ${pc.cyan(summary.backedUp)}`);
  console.log(`  overwritten ${pc.cyan(summary.overwritten)}`);
  console.log(`  conflicts   ${summary.conflicts > 0 ? pc.red(summary.conflicts) : pc.dim(summary.conflicts)}`);
  console.log(`  directories ${pc.dim(summary.mkdir)}`);
  console.log('');
}

function printPlan(plan) {
  for (const [label, files] of Object.entries(plan)) {
    if (!files.length) continue;
    console.log(`  ${label}:`);
    for (const file of files) {
      console.log(`    - ${file}`);
    }
  }
}

function printHostPlans(hostPlans = [], hostSummary = [], { summaryOnly = false } = {}) {
  if (!hostPlans?.length) return;

  const summariesByHost = new Map((hostSummary || []).map(item => [item.host, item.summary]));
  console.log(pc.bold('\nHost-global copies:'));
  for (const hostPlan of hostPlans) {
    console.log(`  ${hostPlan.host}   ${pc.cyan(hostPlan.root)}`);
    const summary = summariesByHost.get(hostPlan.host);
    if (summary) printSummary(summary);
    if (!summaryOnly) printPlan(hostPlan.plan);
  }
}

function printWarnings(result) {
  if (!result.warnings.length) return;

  console.log(pc.yellow('\nWarning(s):'));
  for (const warning of result.warnings) {
    console.log(pc.yellow(`  - ${warning}`));
  }
}

function printJsonResult(result) {
  // Remove `created` array from output — it is already in the plan, avoid duplication
  const { created, globalCreated, hostCreated, ...rest } = result;
  console.log(JSON.stringify(rest, null, 2));
  if (!result.success) {
    process.exit(1);
  }
}

function updateScriptPath(scan) {
  return path.join(scan.resolvedDir, 'Harness', 'scripts', 'wf-update-check.mjs');
}

function missingRecoveryReasons(scan) {
  const reasons = [];
  if (!fs.existsSync(updateScriptPath(scan))) reasons.push('Harness/scripts/wf-update-check.mjs');
  return reasons;
}

function needsScaffoldRecovery(scan) {
  return scan.hasHarness && missingRecoveryReasons(scan).length > 0;
}

function recoveryOptions(options) {
  return {
    ...options,
    onConflict: 'skip',
  };
}

function createScaffoldRecoveryResult({ projectName, targetDir, options, scan }) {
  const reasons = missingRecoveryReasons(scan);
  const recovery = generate({
    projectName,
    targetDir,
    ...recoveryOptions(options),
  });
  recovery.mode = 'recovery';
  recovery.recoveryNote = `Missing ${reasons.join(' and ')}. Re-ran generate with --on-conflict ${recoveryOptions(options).onConflict} to restore missing Harness infrastructure without overwriting existing files.`;
  return recovery;
}

function runScaffoldRecovery({ projectName, targetDir, options, scan }) {
  const reasons = missingRecoveryReasons(scan);
  console.log('');
  console.log(pc.yellow(`Old Harness detected: missing ${reasons.join(' and ')}. Running safe recovery (--on-conflict ${recoveryOptions(options).onConflict}).`));
  const recovery = createScaffoldRecoveryResult({ projectName, targetDir, options, scan });
  printResult(recovery, targetDir);
  if (recovery.success) console.log(pc.green('Recovery complete. Now run: node Harness/scripts/wf-update-check.mjs'));
  return recovery.success ? 0 : 1;
}

function runUpdateSwitch(scan, { json }) {
  const updateResult = createUpdateSwitchResult(scan, { json });
  if (json) {
    printJsonResult(updateResult);
    return updateResult.success ? 0 : 1;
  }

  console.log('');
  console.log(pc.yellow('Existing Harness detected. Switching to wf-update check.'));
  console.log(pc.dim(`Directory   ${scan.resolvedDir}`));
  console.log(pc.dim('Command     node Harness/scripts/wf-update-check.mjs'));
  console.log(pc.dim(`Source      ${CANONICAL_UPDATE_SOURCE_BASE}`));
  console.log('');

  if (!updateResult.success && updateResult.error) {
    console.error(pc.red(updateResult.error));
    return 1;
  }

  if (updateResult.stdout) process.stdout.write(updateResult.stdout);
  if (updateResult.stderr) process.stderr.write(updateResult.stderr);
  return updateResult.exitCode ?? 0;
}

function getUpdateStatusError(update) {
  if (!update || typeof update !== 'object' || typeof update.status !== 'string') {
    return 'Update checker did not return a machine-readable status.';
  }
  if (UPDATE_FAILURE_STATUSES.has(update.status)) {
    return `Update checker reported ${update.status}${update.message ? `: ${update.message}` : ''}`;
  }
  if (!UPDATE_SUCCESS_STATUSES.has(update.status)) {
    return `Update checker returned unrecognized status: ${update.status}`;
  }
  return null;
}

function createUpdateSwitchResult(scan, { json }) {
  const args = ['Harness/scripts/wf-update-check.mjs'];
  if (json) args.push('--json');

  const scriptPath = path.join(scan.resolvedDir, 'Harness', 'scripts', 'wf-update-check.mjs');
  const command = `node ${args.join(' ')}`;
  const base = {
    success: false,
    mode: 'update',
    scan: createJsonScan(scan),
    agent: {
      sourceOfTruth: 'Existing Harness detected; install automatically switched to the target update checker. Do not continue install writes.',
      updateCommand: json
        ? 'node Harness/scripts/wf-update-check.mjs --json'
        : 'node Harness/scripts/wf-update-check.mjs',
      updateSourceBase: CANONICAL_UPDATE_SOURCE_BASE,
      next: [
        {
          action: 'update',
          command: json
            ? 'node Harness/scripts/wf-update-check.mjs --json'
            : 'node Harness/scripts/wf-update-check.mjs',
          env: { WF_SOURCE_BASE: CANONICAL_UPDATE_SOURCE_BASE },
          reason: 'Harness already exists, so updates must use the installed Harness update flow.',
        },
      ],
    },
  };

  if (!fs.existsSync(scriptPath)) {
    return {
      ...base,
      success: false,
      error: 'Existing Harness detected, but Harness/scripts/wf-update-check.mjs was not found. The Harness install is incomplete or was created by an older version that did not include the update checker script. Install writes were skipped — no files were overwritten.',
      errors: ['Harness/scripts/wf-update-check.mjs not found'],
      agent: {
        ...base.agent,
        next: [{
          action: 'recovery',
          reason: 'This Harness install predates the update-checker script.',
          recoveryPath: 'Run npx create-harness-vibe-coding@latest <project-name> . -y --on-conflict skip --json from the project root. Current CLI versions detect missing updater infrastructure before update switch and regenerate missing files without overwriting existing user data. After recovery, run node Harness/scripts/wf-update-check.mjs --json to check for updates.',
          command: 'npx create-harness-vibe-coding@latest <project-name> . -y --on-conflict skip',
          note: 'The --on-conflict skip policy preserves all existing files and only creates missing ones. You may still need to merge CLAUDE.md changes manually after recovery.',
        }],
      },
    };
  }

  const result = spawnSync(process.execPath, args, {
    cwd: scan.resolvedDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      WF_SOURCE_BASE: CANONICAL_UPDATE_SOURCE_BASE,
    },
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const status = result.status ?? 1;

  let update = undefined;
  if (json && stdout.trim()) {
    try {
      update = JSON.parse(stdout.trim());
    } catch {
      update = { rawOutput: stdout };
    }
  }

  const errors = [];
  if (status !== 0) errors.push(`Update checker exited with status ${status}`);
  if (json) {
    const statusError = getUpdateStatusError(update);
    if (statusError) errors.push(statusError);
  }

  return {
    ...base,
    success: errors.length === 0,
    exitCode: status,
    command,
    stdout,
    stderr,
    ...(json ? { update } : {}),
    ...(errors.length === 0 ? {} : { error: errors[0], errors }),
  };
}

function scanTarget(targetDir) {
  const resolvedDir = path.resolve(process.cwd(), targetDir);
  const exists = fs.existsSync(resolvedDir);
  const isDirectory = exists && fs.statSync(resolvedDir).isDirectory();
  const entries = isDirectory
    ? fs.readdirSync(resolvedDir)
    : [];
  const hasHarness = isDirectory && fs.existsSync(path.join(resolvedDir, 'Harness'));
  const hasClaude = isDirectory && fs.existsSync(path.join(resolvedDir, 'CLAUDE.md'));
  const hasAgents = isDirectory && fs.existsSync(path.join(resolvedDir, 'AGENTS.md'));
  const hasAgentSkills = isDirectory && fs.existsSync(path.join(resolvedDir, '.agents'));
  const hasCodex = isDirectory && fs.existsSync(path.join(resolvedDir, '.codex'));
  const hasOpencode = isDirectory && (fs.existsSync(path.join(resolvedDir, '.opencode')) || fs.existsSync(path.join(resolvedDir, 'opencode.json')));
  const hasDocs = isDirectory && fs.existsSync(path.join(resolvedDir, 'docs'));
  const hasReadme = isDirectory && fs.existsSync(path.join(resolvedDir, 'README.md'));
  const hasPackageJson = isDirectory && fs.existsSync(path.join(resolvedDir, 'package.json'));
  const hasPyproject = isDirectory && fs.existsSync(path.join(resolvedDir, 'pyproject.toml'));
  const hasGoMod = isDirectory && fs.existsSync(path.join(resolvedDir, 'go.mod'));
  const hasGithub = isDirectory && fs.existsSync(path.join(resolvedDir, '.github'));
  const hasGitignore = isDirectory && fs.existsSync(path.join(resolvedDir, '.gitignore'));

  return {
    resolvedDir,
    exists,
    isDirectory,
    entries,
    hasHarness,
    hasClaude,
    hasAgents,
    hasAgentSkills,
    hasCodex,
    hasOpencode,
    hasDocs,
    hasReadme,
    hasPackageJson,
    hasPyproject,
    hasGoMod,
    hasGithub,
    hasGitignore,
    needsConflictPolicy: exists && (!isDirectory || entries.length > 0 || hasHarness),
  };
}

function createJsonScan(scan) {
  const topLevelEntries = scan.entries.slice(0, 50);

  return {
    resolvedDir: scan.resolvedDir,
    exists: scan.exists,
    isDirectory: scan.isDirectory,
    entryCount: scan.entries.length,
    topLevelEntries,
    topLevelEntriesTruncated: scan.entries.length > topLevelEntries.length,
    needsConflictPolicy: scan.needsConflictPolicy,
    markers: {
      hasHarness: scan.hasHarness,
      hasClaude: scan.hasClaude,
      hasAgents: scan.hasAgents,
      hasAgentSkills: scan.hasAgentSkills,
      hasCodex: scan.hasCodex,
      hasOpencode: scan.hasOpencode,
      hasDocs: scan.hasDocs,
      hasReadme: scan.hasReadme,
      hasPackageJson: scan.hasPackageJson,
      hasPyproject: scan.hasPyproject,
      hasGoMod: scan.hasGoMod,
      hasGithub: scan.hasGithub,
      hasGitignore: scan.hasGitignore,
    },
  };
}

function createAgentGuidance(result, { projectName, targetDir, options, scan }) {
  const projectAttentionFiles = [...new Set([
    ...(result.plan?.conflict || []),
    ...(result.plan?.skip || []),
  ])].sort();
  const globalAttentionFiles = [...new Set([
    ...(result.globalPlan?.conflict || []),
    ...(result.globalPlan?.skip || []),
  ])].sort();
  const hostAttentionFiles = (result.hostPlans || []).flatMap(hostPlan => (
    [...new Set([
      ...(hostPlan.plan?.conflict || []),
      ...(hostPlan.plan?.skip || []),
    ])].sort().map(file => ({ host: hostPlan.host, root: hostPlan.root, file }))
  ));
  const aiMergeRequired = [
    ...projectAttentionFiles.map(file => createFileGuidance(file)),
    ...globalAttentionFiles.map(file => {
      const guidance = createFileGuidance(file);
      return {
        ...guidance,
        file: `global:${guidance.file}`,
        scope: 'global-runtime',
        reason: `Global runtime file in ${result.globalDir || 'the selected global directory'} needs review. ${guidance.reason}`,
      };
    }),
    ...hostAttentionFiles.map(({ host, root, file }) => {
      const guidance = createFileGuidance(file);
      return {
        ...guidance,
        file: `host:${host}:${guidance.file}`,
        scope: `host-global:${host}`,
        reason: `Host-global ${host} file in ${root} needs review. ${guidance.reason}`,
      };
    }),
  ];
  const hasBlockingConflicts = (result.plan?.conflict || []).length > 0
    || (result.globalPlan?.conflict || []).length > 0
    || (result.hostPlans || []).some(hostPlan => (hostPlan.plan?.conflict || []).length > 0);
  const safeMergeCommand = commandFor(projectName, targetDir, {
    ...options,
    dryRun: false,
    onConflict: 'skip',
    json: true,
  });
  const previewCommand = commandFor(projectName, targetDir, {
    ...options,
    dryRun: true,
    json: true,
  });
  const next = [];

  if (scan.hasHarness) {
    next.push({
      action: 'stop',
      reason: 'Harness already exists; use wf-update or Harness/scripts/wf-update-check.mjs instead of reinstalling blindly.',
    });
  } else if (result.dryRun && !hasBlockingConflicts) {
    next.push({
      action: 'install',
      command: safeMergeCommand,
      reason: 'Dry-run has no blocking conflicts; let the script create missing files.',
    });
  } else if (result.dryRun && hasBlockingConflicts) {
    next.push({
      action: 'safe-merge',
      command: safeMergeCommand,
      reason: 'Default dry-run found existing files; rerun with --on-conflict skip so the script creates missing files and preserves existing ones.',
    });
  } else if (result.success) {
    next.push({
      action: 'bootstrap',
      command: 'Read Harness/specs/guides/SETUP.md and use this JSON plan before opening any package templates.',
      reason: 'Scaffold files were written; bootstrap project facts from local evidence.',
    });
  } else {
    next.push({
      action: 'inspect-errors',
      reason: 'Generation failed before safe scaffold output was available.',
    });
  }

  if (aiMergeRequired.length > 0) {
    next.push({
      action: 'ai-merge',
      files: aiMergeRequired.map(item => item.file),
      reason: 'Only these existing/conflicting files need semantic review. Files in plan.create are script-owned.',
    });
  }

  return {
    sourceOfTruth: 'Use this JSON scan/plan first. Do not read package source or templates unless aiMergeRequired lists a file.',
    previewCommand,
    safeMergeCommand,
    scriptHandled: {
      create: result.plan?.create?.length || 0,
      mkdir: result.plan?.mkdir?.length || 0,
      backup: result.plan?.backup?.length || 0,
      overwrite: result.plan?.overwrite?.length || 0,
      globalCreate: result.globalPlan?.create?.length || 0,
      globalMkdir: result.globalPlan?.mkdir?.length || 0,
      globalBackup: result.globalPlan?.backup?.length || 0,
      globalOverwrite: result.globalPlan?.overwrite?.length || 0,
      hostCreate: (result.hostPlans || []).reduce((sum, hostPlan) => sum + (hostPlan.plan?.create?.length || 0), 0),
      hostMkdir: (result.hostPlans || []).reduce((sum, hostPlan) => sum + (hostPlan.plan?.mkdir?.length || 0), 0),
      hostBackup: (result.hostPlans || []).reduce((sum, hostPlan) => sum + (hostPlan.plan?.backup?.length || 0), 0),
      hostOverwrite: (result.hostPlans || []).reduce((sum, hostPlan) => sum + (hostPlan.plan?.overwrite?.length || 0), 0),
    },
    aiMergeRequired,
    next,
  };
}

function createFileGuidance(file) {
  const normalized = file.replace(/\\/g, '/');
  const guidance = {
    file: normalized,
    templateHint: templateHintFor(normalized),
    requiresUserConsent: false,
    defaultAction: 'preserve',
    reason: 'Existing file or path needs semantic review before any merge.',
  };

  if (normalized.endsWith('/')) {
    return {
      ...guidance,
      templateHint: null,
      defaultAction: 'stop',
      reason: 'A file blocks a required scaffold directory. Stop and ask before moving or replacing it.',
    };
  }

  if (normalized === 'CLAUDE.md' || normalized === 'AGENTS.md') {
    return {
      ...guidance,
      requiresUserConsent: true,
      reason: 'Root agent entry contract. Preserve project rules and ask before merging Harness startup guidance.',
    };
  }

  if (normalized === 'README.md') {
    return {
      ...guidance,
      reason: 'Project-owned public/development documentation. Preserve by default; append development notes only after review.',
    };
  }

  if (normalized === 'Harness/README.md' || normalized === 'Harness/MEMORY.md') {
    return {
      ...guidance,
      reason: 'Harness router/registry conflict. Merge only missing routing or registration entries.',
    };
  }

  return guidance;
}

function templateHintFor(file) {
  if (file === 'Harness/specs/guides/SETUP.md') return 'templates/common/Harness/specs/guides/SETUP.md';
  return `templates/common/${file}`;
}

function commandFor(projectName, targetDir, options) {
  const args = [
    'npx',
    'create-harness-vibe-coding@latest',
    projectName,
    targetDir,
    '-y',
  ];

  if (options.dryRun) args.push('--dry-run');
  if (options.onConflict) args.push('--on-conflict', options.onConflict);
  if (options.withOptions?.length) args.push('--with', options.withOptions.join(','));
  if (options.withoutOptions?.length) args.push('--without', options.withoutOptions.join(','));
  if (options.externalOptions?.length) args.push('--recommend', options.externalOptions.join(','));
  if (options.preset) args.push('--preset', options.preset);
  if (options.installScope && options.installScope !== 'project') args.push('--install-scope', options.installScope);
  if (options.globalDir) args.push('--global-dir', options.globalDir);
  if (options.hostGlobalDir) args.push('--host-global-dir', options.hostGlobalDir);
  if (options.json) args.push('--json');

  return args.map(shellQuoteArg).join(' ');
}

function shellQuoteArg(arg) {
  if (/^[A-Za-z0-9@._/\\:-]+$/.test(arg)) return arg;
  return JSON.stringify(arg);
}

function printScan(scan) {
  if (!scan.exists) return;

  console.log('');
  console.log(pc.bold('Root scan:'));
  console.log(`  Directory   ${pc.dim(scan.resolvedDir)}`);
  if (!scan.isDirectory) {
    console.log(`  Conflict    ${pc.yellow('target path exists and is not a directory')}`);
    return;
  }
  console.log(`  Entries     ${pc.cyan(scan.entries.length)}`);
  if (scan.hasHarness) console.log(`  Harness     ${pc.yellow('exists')}`);
  if (scan.hasClaude) console.log(`  CLAUDE.md   ${pc.yellow('exists')}`);
  if (scan.hasAgents) console.log(`  AGENTS.md   ${pc.yellow('exists')}`);
  if (scan.hasAgentSkills) console.log(`  .agents/    ${pc.yellow('exists')}`);
  if (scan.hasCodex) console.log(`  .codex/     ${pc.yellow('exists')}`);
  if (scan.hasOpencode) console.log(`  opencode     ${pc.yellow('exists')}  ${pc.dim('(.opencode/ or opencode.json)')}`);
  if (scan.hasDocs) console.log(`  docs/       ${pc.dim('project-owned; Harness stays in Harness/')}`);
}
