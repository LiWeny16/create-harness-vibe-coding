/**
 * AC-002 runtime test for the wf-ui CLI extension.
 *
 * Spawns the real `wf-ui.js` entry point with a mock server fixture via
 * WF_UI_SERVER_PATH, waits for the ready file, then exercises status/inspect.
 * Cleans up the detached runner and temp project on exit.
 *
 * Replaces extensions/wf-ui/test/wf-ui.test.mjs (removed from formal test set).
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { makeHarnessTempRoot } from './support/temp-root.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const wfUiBin = path.join(root, 'extensions', 'wf-ui', 'bin', 'wf-ui.js');
const mockServer = path.join(root, 'extensions', 'wf-ui', 'test', 'mock-server.mjs');

function assertFileExists(p, label) {
  assert.ok(fs.existsSync(p), `${label} exists: ${p}`);
}

test('wf-ui runtime: start/status/inspect against mock server', { timeout: 60000 }, async (t) => {
  assertFileExists(wfUiBin, 'wf-ui bin');
  assertFileExists(mockServer, 'mock server fixture');

  const projectRoot = makeHarnessTempRoot('wf-ui-runtime-');
  const readyFile = path.join(projectRoot, 'Harness', '.temp', 'wf-ui', 'ready.json');
  const logFile = path.join(projectRoot, 'Harness', '.temp', 'wf-ui', 'wf-ui.log');

  const env = {
    ...process.env,
    WF_UI_SERVER_PATH: mockServer,
  };

  const spawnArgs = (args) => [wfUiBin, ...args];

  const start = spawn(process.execPath, spawnArgs(['start', '--project', projectRoot, '--port', '0']), {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let startStdout = '';
  let startStderr = '';
  start.stdout.on('data', (d) => { startStdout += d.toString(); });
  start.stderr.on('data', (d) => { startStderr += d.toString(); });

  let runnerPid = null;
  let readyInfo = null;

  try {
    // Wait for start command to exit cleanly (it exits once the ready file appears).
    const startExitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('wf-ui start timed out after 30s')), 30000);
      start.on('close', (code) => { clearTimeout(timer); resolve(code); });
    });

    assert.equal(startExitCode, 0, `wf-ui start exit code 0 (stdout=${startStdout}, stderr=${startStderr})`);

    const parsed = JSON.parse(startStdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, 'start');
    assert.ok(parsed.url, 'url present');
    assert.ok(parsed.port > 0, 'port > 0');
    assert.ok(parsed.pid > 0, 'pid > 0');
    assert.equal(parsed.readyFile, readyFile, 'readyFile matches');

    // Ready file readable
    assert.ok(fs.existsSync(readyFile), 'ready file exists');
    readyInfo = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
    assert.ok(readyInfo.pid > 0, 'ready.pid');
    assert.ok(readyInfo.url?.startsWith('http://'), 'ready.url');
    assert.ok(readyInfo.port > 0, 'ready.port');
    runnerPid = readyInfo.pid;

    // status
    const statusProc = spawn(process.execPath, spawnArgs(['status', '--project', projectRoot]), {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const statusRes = await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      statusProc.stdout.on('data', (d) => { stdout += d.toString(); });
      statusProc.stderr.on('data', (d) => { stderr += d.toString(); });
      statusProc.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(statusRes.code, 0, `status exit 0 (stderr=${statusRes.stderr})`);
    const statusJson = JSON.parse(statusRes.stdout);
    assert.equal(statusJson.ok, true, 'status ok:true');
    assert.equal(statusJson.command, 'status');
    assert.equal(statusJson.status, 'running', 'status reports running');
    assert.equal(statusJson.pidAlive, true, 'status pid alive');

    // inspect
    const inspectProc = spawn(process.execPath, spawnArgs(['inspect', '--project', projectRoot]), {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const inspectRes = await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      inspectProc.stdout.on('data', (d) => { stdout += d.toString(); });
      inspectProc.stderr.on('data', (d) => { stderr += d.toString(); });
      inspectProc.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(inspectRes.code, 0, `inspect exit 0 (stderr=${inspectRes.stderr})`);
    const inspectJson = JSON.parse(inspectRes.stdout);
    assert.equal(inspectJson.ok, true, 'inspect ok:true');
    assert.equal(inspectJson.command, 'inspect');
    assert.equal(inspectJson.status, 'running', 'inspect reports running');
    assert.ok(inspectJson.health, 'inspect has health');
    assert.equal(inspectJson.health?.status, 'ok', 'inspect health.status ok');
    assert.equal(inspectJson.project?.name, 'mock-project', 'inspect project.name');
    assert.equal(inspectJson.sessionCount, 2, 'inspect sessionCount=2');
  } finally {
    // Kill the detached runner and wait for exit. On Windows, process.kill
    // does not reliably terminate detached process trees, so use taskkill.
    if (runnerPid) {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(runnerPid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          process.kill(runnerPid, 'SIGTERM');
        }
      } catch { /* already gone */ }
      await new Promise((resolve) => {
        const deadline = Date.now() + 10000;
        const poll = () => {
          let alive = true;
          try { process.kill(runnerPid, 0); } catch { alive = false; }
          if (!alive || Date.now() > deadline) return resolve();
          setTimeout(poll, 100);
        };
        poll();
      });
      // Force kill if still alive
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(runnerPid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          process.kill(runnerPid, 'SIGKILL');
        }
      } catch { /* ignore */ }
    }
    // Clean up temp project
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
