#!/usr/bin/env node
// wf-ui-runner — detached server runner
//
// Invoked by wf-ui.js `start` command as a detached child process.
// Imports startServer from the wf-ui-server module, persists until SIGINT/SIGTERM,
// and atomically writes the ready file once listening.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

function writeReadyAtomic(projectRoot, info) {
  const file = readyFileFor(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(info, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

// --- server resolution ---------------------------------------------------

function resolveServerModule() {
  if (process.env.WF_UI_SERVER_PATH) {
    const p = path.resolve(process.env.WF_UI_SERVER_PATH);
    if (!fs.existsSync(p)) {
      throw new Error(`WF_UI_SERVER_PATH points to missing file: ${p}`);
    }
    return p;
  }
  const candidates = [
    path.join(here, '..', 'node_modules', 'create-harness-vibe-coding', 'src', 'wf-ui-server', 'server.mjs'),
    path.join(here, '..', '..', 'node_modules', 'create-harness-vibe-coding', 'src', 'wf-ui-server', 'server.mjs'),
    path.resolve(here, '..', '..', '..', 'src', 'wf-ui-server', 'server.mjs'),
    path.resolve(here, '..', '..', 'src', 'wf-ui-server', 'server.mjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'wf-ui server module not found. Install the create-harness-vibe-coding dependency ' +
    'or set WF_UI_SERVER_PATH.',
  );
}

// --- main ----------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const projectRoot = findProjectArg(argv);
  const host = parseHost(argv);
  const port = parsePort(argv);
  const serverPath = resolveServerModule();

  const mod = await import(pathToFileURL(serverPath).href);
  const startServer = mod.startServer;
  const stopServer = mod.stopServer;

  if (typeof startServer !== 'function') {
    throw new Error(`server module ${serverPath} does not export startServer`);
  }

  const result = await startServer({ projectRoot, host, port });
  const url = result?.url || `http://${host}:${result?.port}/`;

  const readyFile = writeReadyAtomic(projectRoot, {
    pid: process.pid,
    url,
    host: result?.host || host,
    port: result?.port ?? port,
    token: result?.token || null,
    startedAt: new Date().toISOString(),
    serverModule: serverPath,
  });

  // Log for debugging — visible in the child's stderr
  process.stderr.write(`[wf-ui-runner] listening at ${url} (pid=${process.pid}, ready=${readyFile})\n`);

  // --- shutdown handlers --------------------------------------------------
  let shuttingDown = false;

  async function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      if (typeof stopServer === 'function') {
        await stopServer(result.server);
      } else if (result.server?.listening) {
        await new Promise(resolve => result.server.close(resolve));
      }
    } catch (err) {
      process.stderr.write(`[wf-ui-runner] shutdown error: ${err?.message || err}\n`);
    }
    try {
      fs.unlinkSync(readyFileFor(projectRoot));
    } catch { /* best-effort */ }
    process.exit(code);
  }

  process.once('SIGINT', () => shutdown(0));
  process.once('SIGTERM', () => shutdown(0));

  // Persist until shutdown signal
  await new Promise(() => { /* never resolves */ });
}

main().catch((err) => {
  process.stderr.write(`wf-ui-runner: ${err?.message || err}\n`);
  process.exitCode = 1;
});
