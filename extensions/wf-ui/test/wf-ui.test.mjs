/**
 * wf-ui CLI integration test
 *
 * Verifies:
 * 1. `start` spawns a detached runner, waits for readiness, then exits
 * 2. `status` reports running when health endpoint responds
 * 3. `inspect` returns combined health/project/sessions data
 * 4. No services leak — runner is cleaned up on test end
 */

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const here = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(here, 'bin');
const wfUiPath = path.join(binDir, 'wf-ui.js');

// --- Mock server module --------------------------------------------------

let mockServer = null;
let mockServerPort = 0;

function startMockServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);
      
      if (url.pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          uptime: 1.234,
          version: 'test-mock',
        }));
      } else if (url.pathname === '/api/project') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          name: 'test-project',
          root: process.cwd(),
        }));
      } else if (url.pathname === '/api/sessions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sessions: [{ id: 'session-1', status: 'running' }],
        }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      }
    });

    server.listen(0, '127.0.0.1', () => {
      mockServer = server;
      mockServerPort = server.address().port;
      resolve();
    });
  });
}

function stopMockServer() {
  return new Promise(resolve => {
    if (!mockServer) return resolve();
    mockServer.close(resolve);
    mockServer = null;
  });
}

// --- Test helpers ---------------------------------------------------------

async function runWfUi(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [wfUiPath, ...args], {
      cwd: cwd || process.cwd(),
      env: { ...process.env, WF_UI_SERVER_PATH: path.join(here, 'mock-server.mjs') },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 35000,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    child.on('error', (err) => {
      resolve({ code: -1, stdout: '', stderr: err.message });
    });
  });
}

function createTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-ui-test-'));
}

function cleanupTempProject(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// --- Tests -----------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function assertJsonContains(jsonStr, key, value) {
  try {
    const obj = JSON.parse(jsonStr);
    if (value === null) {
      return obj[key] === null || obj[key] === undefined;
    }
    return JSON.stringify(obj[key]) === JSON.stringify(value) ||
           JSON.stringify(obj).includes(JSON.stringify(value));
  } catch {
    return false;
  }
}

async function runTests() {
  console.log('\n=== wf-ui CLI Test Suite ===\n');

  // Setup mock server
  await startMockServer();
  console.log(`Mock server listening on port ${mockServerPort}`);

  const testProject = createTempProject();
  const readyFile = path.join(testProject, 'Harness', '.temp', 'wf-ui', 'ready.json');

  try {
    // --- Test 1: start command ---
    console.log('\n[1] wf-ui start');
    const startResult = await runWfUi([
      'start',
      '--project', testProject,
      '--port', String(mockServerPort),
    ], testProject);

    assert(startResult.code === 0, `exit code 0 (got ${startResult.code})`);
    assert(startResult.stdout.includes('"ok": true'), 'stdout contains ok:true');
    assert(startResult.stdout.includes('"command": "start"'), 'stdout contains command:start');
    assert(fs.existsSync(readyFile), 'ready file created');

    // Parse ready file
    let ready = null;
    if (fs.existsSync(readyFile)) {
      try {
        ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
      } catch { /* ignore */ }
    }
    assert(ready?.pid > 0, `ready file has valid pid (${ready?.pid})`);
    assert(ready?.url?.startsWith('http://'), `ready file has url (${ready?.url})`);

    // --- Test 2: status command ---
    console.log('\n[2] wf-ui status');
    const statusResult = await runWfUi([
      'status',
      '--project', testProject,
    ], testProject);

    assert(statusResult.code === 0, `exit code 0 (got ${statusResult.code})`);
    assert(statusResult.stdout.includes('"command": "status"'), 'stdout contains command:status');
    assert(statusResult.stdout.includes('"ok": true'), 'status reports ok:true');
    assert(statusResult.stdout.includes('"status": "running"'), 'status reports running');

    // --- Test 3: inspect command ---
    console.log('\n[3] wf-ui inspect');
    const inspectResult = await runWfUi([
      'inspect',
      '--project', testProject,
    ], testProject);

    assert(inspectResult.code === 0, `exit code 0 (got ${inspectResult.code})`);
    assert(inspectResult.stdout.includes('"command": "inspect"'), 'stdout contains command:inspect');
    assert(inspectResult.stdout.includes('"ok": true'), 'inspect reports ok:true');
    assert(inspectResult.stdout.includes('sessionCount'), 'inspect includes sessionCount');

  } finally {
    // Cleanup: kill any runner process and remove test artifacts
    if (ready?.pid) {
      try {
        process.kill(ready.pid, 'SIGTERM');
      } catch { /* already dead */ }
    }
    await stopMockServer();
    cleanupTempProject(testProject);
  }

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  return failed === 0;
}

runTests().then(ok => process.exit(ok ? 0 : 1)).catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
