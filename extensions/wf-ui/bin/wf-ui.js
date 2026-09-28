#!/usr/bin/env node
// wf-ui CLI entry — drives the wf-ui server via the published
// create-harness-vibe-coding package.
//
// Commands:
//   wf-ui start   [--project <dir>] [--host <h>] [--port <p>] [--open]
//                 Spawn a detached runner; print the URL and exit 0.
//   wf-ui status  [--project <dir>] [--url <u>]
//                 Report /api/health for a running server.
//   wf-ui inspect [--project <dir>] [--url <u>]
//                 Fetch /api/health, /api/project, /api/sessions.
//
// Server module resolution:
//   1. WF_UI_SERVER_PATH env override (used by tests / dev)
//   2. create-harness-vibe-coding/src/wf-ui-server/server.mjs
//      (resolved through the published dependency)
//   3. Workspace-relative fallback ../../src/wf-ui-server/server.mjs
//      (dev-only; helps the repo's own pnpm workspace)
//
// Ready-file: Harness/.temp/wf-ui/ready.json next to --project,
// written atomically by the runner so status/inspect can discover
// the running server without --url.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// --- arg parsing ---------------------------------------------------------

function findValue(argv, flag) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag) return argv[i + 1];
    if (argv[i].startsWith(`${flag}=`)) return argv[i].slice(flag.length + 1);
  }
  return undefined;
}

function findProjectArg(argv) {
  const value = findValue(argv, '--project');
  return value ? path.resolve(value) : path.resolve(process.cwd());
}

function parsePort(argv) {
  const raw = findValue(argv, '--port');
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 65535) {
    throw new Error(`invalid --port value: ${raw}`);
  }
  return value;
}

function parseHost(argv) {
  return findValue(argv, '--host') || '127.0.0.1';
}

// --- ready file ----------------------------------------------------------

function readyFileFor(projectRoot) {
  return path.join(projectRoot, 'Harness', '.temp', 'wf-ui', 'ready.json');
}

function readReady(projectRoot) {
  const file = readyFileFor(projectRoot);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// --- HTTP helpers --------------------------------------------------------

async function fetchJson(url, timeoutMs = 2500) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json();
    return { ok: response.ok, status: response.status, body };
  } catch (err) {
    return { ok: false, status: null, error: err?.message || String(err) };
  }
}

async function health(url) {
  return fetchJson(`${url.replace(/\/$/, '')}/api/health`);
}

async function projectInfo(url) {
  return fetchJson(`${url.replace(/\/$/, '')}/api/project`);
}

async function sessions(url) {
  return fetchJson(`${url.replace(/\/$/, '')}/api/sessions`);
}

// --- runner resolution ---------------------------------------------------

function resolveRunnerPath() {
  const runner = path.join(here, 'wf-ui-runner.mjs');
  if (!fs.existsSync(runner)) {
    throw new Error(`wf-ui runner not found at ${runner}`);
  }
  return runner;
}

// --- commands ------------------------------------------------------------

async function cmdStart(argv) {
  const projectRoot = findProjectArg(argv);
  const host = parseHost(argv);
  const port = parsePort(argv);
  const runnerPath = resolveRunnerPath();
  const readyFile = readyFileFor(projectRoot);
  const logDir = path.dirname(readyFile);
  const logFile = path.join(logDir, 'wf-ui.log');

  fs.mkdirSync(logDir, { recursive: true });

  // Remove any stale ready file
  try { fs.unlinkSync(readyFile); } catch { /* ignore */ }

  const child = spawn(
    process.execPath,
    [runnerPath, '--project', projectRoot, '--host', host, '--port', String(port)],
    {
      cwd: projectRoot,
      stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
      detached: true,
      env: { ...process.env },
      windowsHide: true,
    },
  );
  child.unref();

  const deadline = Date.now() + 30000;
  let ready = null;
  while (Date.now() < deadline) {
    if (fs.existsSync(readyFile)) {
      try {
        ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
        if (ready?.url) break;
      } catch { /* wait for atomic write to complete */ }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (!ready?.url) {
    child.kill('SIGTERM');
    console.error(`wf-ui start: runner did not become ready within 30s; see ${logFile}`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    command: 'start',
    url: ready.url,
    pid: ready.pid,
    port: ready.port,
    host: ready.host,
    readyFile,
    logFile,
  }, null, 2));
}

async function cmdStatus(argv) {
  const projectRoot = findProjectArg(argv);
  const explicit = findValue(argv, '--url');
  const ready = readReady(projectRoot);
  const url = explicit || ready?.url;
  if (!url) {
    console.log(JSON.stringify({
      ok: false,
      command: 'status',
      status: 'not-running',
      hint: 'wf ui start --project <dir>',
    }, null, 2));
    return;
  }
  const h = await health(url);
  const healthOk = Boolean(h.ok && h.body?.status === 'ok');
  const alive = Boolean(ready?.pid) && isPidAlive(ready.pid);
  console.log(JSON.stringify({
    ok: healthOk,
    command: 'status',
    status: healthOk ? 'running' : (alive ? 'starting' : 'unreachable'),
    url,
    pid: ready?.pid ?? null,
    pidAlive: alive,
    uptime: h.body?.uptime ?? null,
    version: h.body?.version ?? null,
    error: h.error || null,
  }, null, 2));
}

async function cmdInspect(argv) {
  const projectRoot = findProjectArg(argv);
  const explicit = findValue(argv, '--url');
  const ready = readReady(projectRoot);
  const url = explicit || ready?.url;
  if (!url) {
    console.log(JSON.stringify({
      ok: false,
      command: 'inspect',
      status: 'not-running',
      hint: 'wf ui start --project <dir>',
    }, null, 2));
    return;
  }
  const [h, p, s] = await Promise.all([health(url), projectInfo(url), sessions(url)]);
  const healthOk = Boolean(h.ok && h.body?.status === 'ok');
  const sessionCount = Array.isArray(s.body?.sessions) ? s.body.sessions.length : null;
  console.log(JSON.stringify({
    ok: healthOk,
    command: 'inspect',
    status: healthOk ? 'running' : 'unreachable',
    url,
    pid: ready?.pid ?? null,
    pidAlive: ready?.pid ? isPidAlive(ready.pid) : false,
    health: h.body ?? h,
    project: p.body ?? p,
    sessionCount,
  }, null, 2));
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cmdHelp() {
  console.log(JSON.stringify({
    ok: true,
    command: 'help',
    usage: 'wf-ui <start|status|inspect|help> [--project <dir>] [--host <h>] [--port <p>] [--url <u>] [--open]',
  }, null, 2));
}

const command = (process.argv[2] || 'help').toLowerCase();
const argv = process.argv.slice(3);

try {
  if (command === 'start') await cmdStart(argv);
  else if (command === 'status') await cmdStatus(argv);
  else if (command === 'inspect') await cmdInspect(argv);
  else if (command === 'help') cmdHelp();
  else {
    console.error(`unknown wf-ui command: ${command}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`wf-ui: ${err?.message || err}`);
  process.exitCode = 1;
}
