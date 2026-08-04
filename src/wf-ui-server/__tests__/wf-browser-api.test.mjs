import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) {
    const item = cleanup.pop();
    if (item.server) await stopServer(item.server);
    if (item.root) fs.rmSync(item.root, { recursive: true, force: true });
  }
});

async function makeServer() {
  const root = makeHarnessTempRoot('wf-browser-api-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0 });
  cleanup.push({ root, server: started.server });
  return { ...started, root, baseUrl: `http://127.0.0.1:${started.port}` };
}

function requestJson(baseUrl, token, method, route, payload) {
  const url = new URL(route, baseUrl);
  const body = payload === undefined ? null : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(responseBody) }); }
        catch { resolve({ status: res.statusCode, body: responseBody }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function getJson(baseUrl, token, route) {
  return requestJson(baseUrl, token, 'GET', route);
}

function postJson(baseUrl, token, route, payload) {
  return requestJson(baseUrl, token, 'POST', route, payload);
}

function runNode(args, { cwd, env, timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${args.join(' ')}`));
    }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: code, signal, stdout, stderr });
    });
  });
}

test('wf-browser capabilities and run/window/lease/artifact APIs expose backend control-plane primitives', async () => {
  const { root, baseUrl, token } = await makeServer();

  const capabilities = await getJson(baseUrl, token, '/api/wf-browser/capabilities');
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.body.readiness.current, 'L3-minimal-bridge');
  assert.ok(capabilities.body.primitives.leases.includes('conflict-reject'));
  assert.ok(capabilities.body.primitives.commands.includes('observe.uiTree'));
  assert.ok(capabilities.body.primitives.commands.includes('observe.network'));
  assert.ok(capabilities.body.primitives.commands.includes('observe.replay'));
  assert.ok(capabilities.body.primitives.commands.includes('observe.diff'));
  assert.ok(capabilities.body.primitives.commands.includes('act.contextMenu'));
  assert.ok(capabilities.body.primitives.windows.includes('isolated-open-via-control-script'));
  assert.ok(capabilities.body.endpoints.includes('GET /api/wf-browser/runs/:runId/windows'));
  assert.ok(capabilities.body.endpoints.includes('GET /api/wf-browser/runs/:runId/windows/:windowId/launch-url'));

  const run = await postJson(baseUrl, token, '/api/wf-browser/runs', {
    mode: 'runtime',
    agentId: 'agent-main',
    taskId: 'task-alpha',
    route: '/workflow',
  });
  assert.equal(run.status, 201);
  assert.equal(run.body.ok, true);
  assert.match(run.body.run.runId, /^run-/);

  const listed = await getJson(baseUrl, token, '/api/wf-browser/runs');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.runs.map(item => item.runId), [run.body.run.runId]);

  const win = await postJson(baseUrl, token, `/api/wf-browser/runs/${run.body.run.runId}/windows`, {
    agentId: 'agent-main',
    route: '/workflow',
    viewport: { width: 1280, height: 720 },
  });
  assert.equal(win.status, 201);
  assert.equal(win.body.window.runId, run.body.run.runId);
  assert.match(win.body.launchUrl, /^http:\/\/127\.0\.0\.1:\d+\/workflow\?/);
  assert.match(win.body.launchUrl, /wfRun=/);
  assert.match(win.body.launchUrl, /wfWindow=/);

  const windows = await getJson(baseUrl, token, `/api/wf-browser/runs/${run.body.run.runId}/windows`);
  assert.equal(windows.status, 200);
  assert.deepEqual(windows.body.windows.map(item => item.windowId), [win.body.window.windowId]);

  const lease = await postJson(baseUrl, token, `/api/wf-browser/runs/${run.body.run.runId}/windows/${win.body.window.windowId}/lease`, {
    type: 'control',
    agentId: 'agent-main',
    ttlMs: 60_000,
  });
  assert.equal(lease.status, 201);
  assert.equal(lease.body.lease.status, 'active');
  assert.match(lease.body.debugUrlParams, /wfLease=/);
  assert.match(lease.body.launchUrl, /wfLease=/);

  const launchUrl = await getJson(baseUrl, token, `/api/wf-browser/runs/${run.body.run.runId}/windows/${win.body.window.windowId}/launch-url?leaseId=${encodeURIComponent(lease.body.lease.leaseId)}`);
  assert.equal(launchUrl.status, 200);
  assert.equal(launchUrl.body.leaseId, lease.body.lease.leaseId);
  assert.match(launchUrl.body.launchUrl, /^http:\/\/127\.0\.0\.1:\d+\/workflow\?/);
  assert.match(launchUrl.body.launchUrl, /token=/);

  const conflict = await postJson(baseUrl, token, `/api/wf-browser/runs/${run.body.run.runId}/windows/${win.body.window.windowId}/lease`, {
    type: 'control',
    agentId: 'agent-other',
    ttlMs: 60_000,
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'LEASE_CONFLICT');

  const observe = await postJson(baseUrl, token, `/api/wf-browser/runs/${run.body.run.runId}/windows/${win.body.window.windowId}/lease`, {
    type: 'observe',
    agentId: 'agent-observer',
  });
  assert.equal(observe.status, 201);
  assert.equal(observe.body.lease.readonly, true);

  const artifact = await postJson(baseUrl, token, `/api/wf-browser/runs/${run.body.run.runId}/windows/${win.body.window.windowId}/artifacts`, {
    type: 'state',
    name: 'route-state.json',
    json: { route: '/workflow', selectedNodeId: null },
  });
  assert.equal(artifact.status, 201);
  assert.equal(fs.existsSync(path.join(root, artifact.body.artifact.path)), true);
  assert.match(artifact.body.artifact.path.replace(/\\/g, '/'), /^Harness\/wf-browser\/runs\/[^/]+\/windows\/[^/]+\/state\/route-state\.json$/);

  const artifacts = await getJson(baseUrl, token, `/api/wf-browser/runs/${run.body.run.runId}/windows/${win.body.window.windowId}/artifacts`);
  assert.equal(artifacts.status, 200);
  assert.equal(artifacts.body.artifacts.length, 1);

  const release = await postJson(baseUrl, token, `/api/wf-browser/runs/${run.body.run.runId}/windows/${win.body.window.windowId}/lease/${lease.body.lease.leaseId}/release`, {
    reason: 'test complete',
  });
  assert.equal(release.status, 200);
  assert.equal(release.body.lease.status, 'released');

  const nextLease = await postJson(baseUrl, token, `/api/wf-browser/runs/${run.body.run.runId}/windows/${win.body.window.windowId}/lease`, {
    type: 'control',
    agentId: 'agent-other',
  });
  assert.equal(nextLease.status, 201);
  assert.equal(nextLease.body.lease.agentId, 'agent-other');
});

test('wf-browser APIs reject escaped ids through the standard error envelope', async () => {
  const { baseUrl, token } = await makeServer();
  const badRun = await getJson(baseUrl, token, '/api/wf-browser/runs/..%2Fescape');
  assert.equal(badRun.status, 400);
  assert.equal(badRun.body.error.code, 'BAD_REQUEST');

  const run = await postJson(baseUrl, token, '/api/wf-browser/runs', { runId: 'run-safe' });
  assert.equal(run.status, 201);
  const badWindow = await postJson(baseUrl, token, '/api/wf-browser/runs/run-safe/windows', {
    windowId: '..\\escape',
  });
  assert.equal(badWindow.status, 400);
  assert.equal(badWindow.body.error.code, 'BAD_REQUEST');
});

test('wf-ui-control browser commands create and release a wf-browser lease', async () => {
  const { root, baseUrl, token } = await makeServer();
  const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
  const env = {
    ...process.env,
    HARNESS_WF_UI_URL: baseUrl,
    HARNESS_WF_UI_TOKEN: token,
    HARNESS_PEER_SESSION_ID: 'agent-cli',
  };

  const run = await runNode([
    script,
    'browser-run',
    '--project',
    root,
    '--mode',
    'runtime',
    '--route',
    '/workflow',
  ], { cwd: root, env });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const runBody = JSON.parse(run.stdout);
  assert.match(runBody.run.runId, /^run-/);

  const win = await runNode([
    script,
    'browser-window',
    '--project',
    root,
    '--run',
    runBody.run.runId,
    '--route',
    '/workflow',
  ], { cwd: root, env });
  assert.equal(win.status, 0, win.stderr || win.stdout);
  const winBody = JSON.parse(win.stdout);
  assert.match(winBody.window.windowId, /^window-/);

  const windows = await runNode([
    script,
    'browser-windows',
    '--project',
    root,
    '--run',
    runBody.run.runId,
  ], { cwd: root, env });
  assert.equal(windows.status, 0, windows.stderr || windows.stdout);
  assert.deepEqual(JSON.parse(windows.stdout).windows.map(item => item.windowId), [winBody.window.windowId]);

  const lease = await runNode([
    script,
    'browser-lease',
    '--project',
    root,
    '--run',
    runBody.run.runId,
    '--window',
    winBody.window.windowId,
    '--type',
    'control',
  ], { cwd: root, env });
  assert.equal(lease.status, 0, lease.stderr || lease.stdout);
  const leaseBody = JSON.parse(lease.stdout);
  assert.equal(leaseBody.lease.type, 'control');
  assert.match(leaseBody.launchUrl, /wfLease=/);

  const url = await runNode([
    script,
    'browser-url',
    '--project',
    root,
    '--run',
    runBody.run.runId,
    '--window',
    winBody.window.windowId,
    '--lease',
    leaseBody.lease.leaseId,
  ], { cwd: root, env });
  assert.equal(url.status, 0, url.stderr || url.stdout);
  const urlBody = JSON.parse(url.stdout);
  assert.match(urlBody.launchUrl, /wfRun=/);
  assert.match(urlBody.launchUrl, /wfWindow=/);

  const release = await runNode([
    script,
    'browser-release',
    '--project',
    root,
    '--run',
    runBody.run.runId,
    '--window',
    winBody.window.windowId,
    '--lease',
    leaseBody.lease.leaseId,
  ], { cwd: root, env });
  assert.equal(release.status, 0, release.stderr || release.stdout);
  assert.equal(JSON.parse(release.stdout).lease.status, 'released');

  const cleanupPreview = await runNode([
    script,
    'browser-cleanup',
    '--project',
    root,
    '--keep-latest',
    '20',
  ], { cwd: root, env });
  assert.equal(cleanupPreview.status, 0, cleanupPreview.stderr || cleanupPreview.stdout);
  assert.equal(JSON.parse(cleanupPreview.stdout).apply, false);
});

test('wf-ui-control browser-allocate creates run window lease and launch URL in one command', async () => {
  const { root, baseUrl, token } = await makeServer();
  const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
  const env = {
    ...process.env,
    HARNESS_WF_UI_URL: baseUrl,
    HARNESS_WF_UI_TOKEN: token,
    HARNESS_PEER_SESSION_ID: 'agent-allocate',
  };
  const allocated = await runNode([
    script,
    'browser-allocate',
    '--project',
    root,
    '--mode',
    'runtime',
    '--route',
    '/workflow',
    '--width',
    '1280',
    '--height',
    '720',
  ], { cwd: root, env });

  assert.equal(allocated.status, 0, allocated.stderr || allocated.stdout);
  const body = JSON.parse(allocated.stdout);
  assert.equal(body.ok, true);
  assert.match(body.run.runId, /^run-/);
  assert.match(body.window.windowId, /^window-/);
  assert.equal(body.lease.type, 'control');
  assert.equal(body.opened, false);
  assert.match(body.launchUrl, /^http:\/\/127\.0\.0\.1:\d+\/workflow\?/);
  assert.match(body.launchUrl, /wfLease=/);
});

test('wf-ui-control browser-open dry-run prepares isolated browser context and launch artifact', async () => {
  const { root, baseUrl, token } = await makeServer();
  const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
  const env = {
    ...process.env,
    HARNESS_WF_UI_URL: baseUrl,
    HARNESS_WF_UI_TOKEN: token,
    HARNESS_PEER_SESSION_ID: 'agent-open',
  };
  const allocated = await runNode([
    script,
    'browser-allocate',
    '--project',
    root,
    '--mode',
    'runtime',
    '--route',
    '/workflow',
  ], { cwd: root, env });
  assert.equal(allocated.status, 0, allocated.stderr || allocated.stdout);
  const allocation = JSON.parse(allocated.stdout);

  const opened = await runNode([
    script,
    'browser-open',
    '--project',
    root,
    '--run',
    allocation.run.runId,
    '--window',
    allocation.window.windowId,
    '--lease',
    allocation.lease.leaseId,
    '--agent',
    'agent-open',
    '--browser-command',
    process.execPath,
    '--context',
    'isolated',
    '--dry-run',
    'true',
    '--width',
    '1000',
    '--height',
    '700',
  ], { cwd: root, env });

  assert.equal(opened.status, 0, opened.stderr || opened.stdout);
  const body = JSON.parse(opened.stdout);
  assert.equal(body.ok, true);
  assert.match(body.launchId, /^launch-/);
  assert.equal(body.status, 'prepared');
  assert.equal(body.opened, false);
  assert.equal(body.dryRun, true);
  assert.equal(body.isolated, true);
  assert.equal(body.command, process.execPath);
  assert.match(body.launchUrl, /wfRun=/);
  assert.match(body.launchUrl, /wfWindow=/);
  assert.match(body.launchUrl, /wfLease=/);
  assert.ok(body.profileDir.startsWith(path.join(root, 'Harness', 'wf-browser', 'tmp', 'browser-profiles')));
  assert.ok(fs.existsSync(body.profileDir));
  assert.ok(body.args.includes(`--user-data-dir=${body.profileDir}`));
  assert.ok(body.args.includes('--window-size=1000,700'));
  assert.match(body.artifact.path.replace(/\\/g, '/'), /\/analysis\/browser-launch-/);
  assert.equal(fs.existsSync(path.join(root, body.artifact.path)), true);
  assert.match(body.statePath.replace(/\\/g, '/'), /Harness\/wf-browser\/runs\/.+\/windows\/.+\/browser-launches\.json$/);
  assert.equal(fs.existsSync(path.join(root, body.statePath)), true);

  const launches = await runNode([
    script,
    'browser-launches',
    '--project',
    root,
    '--run',
    allocation.run.runId,
    '--window',
    allocation.window.windowId,
  ], { cwd: root, env });
  assert.equal(launches.status, 0, launches.stderr || launches.stdout);
  const launchState = JSON.parse(launches.stdout);
  assert.equal(launchState.ok, true);
  assert.equal(launchState.count, 1);
  assert.equal(launchState.launches[0].launchId, body.launchId);
  assert.equal(launchState.launches[0].status, 'prepared');
  assert.equal(launchState.launches[0].alive, false);

  const closed = await runNode([
    script,
    'browser-close',
    '--project',
    root,
    '--run',
    allocation.run.runId,
    '--window',
    allocation.window.windowId,
    '--launch',
    body.launchId,
    '--remove-profile',
    'true',
  ], { cwd: root, env });
  assert.equal(closed.status, 0, closed.stderr || closed.stdout);
  const closeBody = JSON.parse(closed.stdout);
  assert.equal(closeBody.ok, true);
  assert.equal(closeBody.count, 1);
  assert.deepEqual(closeBody.selectedLaunchIds, [body.launchId]);
  assert.equal(closeBody.closed[0].status, 'closed');
  assert.equal(closeBody.closed[0].closeResult.status, 'no-pid');
  assert.equal(closeBody.closed[0].profileCleanup.removed, true);
  assert.equal(fs.existsSync(body.profileDir), false);
  assert.match(closeBody.artifact.path.replace(/\\/g, '/'), /\/analysis\/browser-close-/);
  assert.equal(fs.existsSync(path.join(root, closeBody.artifact.path)), true);

  const launchesAfterClose = await runNode([
    script,
    'browser-launches',
    '--project',
    root,
    '--run',
    allocation.run.runId,
    '--window',
    allocation.window.windowId,
  ], { cwd: root, env });
  assert.equal(launchesAfterClose.status, 0, launchesAfterClose.stderr || launchesAfterClose.stdout);
  const launchStateAfterClose = JSON.parse(launchesAfterClose.stdout);
  assert.equal(launchStateAfterClose.launches[0].launchId, body.launchId);
  assert.equal(launchStateAfterClose.launches[0].status, 'closed');
});

test('wf-ui-control browser-allocate can dry-run an isolated opened context without changing default open behavior', async () => {
  const { root, baseUrl, token } = await makeServer();
  const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
  const env = {
    ...process.env,
    HARNESS_WF_UI_URL: baseUrl,
    HARNESS_WF_UI_TOKEN: token,
    HARNESS_PEER_SESSION_ID: 'agent-allocate-open',
  };
  const allocated = await runNode([
    script,
    'browser-allocate',
    '--project',
    root,
    '--mode',
    'runtime',
    '--route',
    '/workflow',
    '--open',
    'true',
    '--context',
    'isolated',
    '--dry-run',
    'true',
    '--browser-command',
    process.execPath,
  ], { cwd: root, env });

  assert.equal(allocated.status, 0, allocated.stderr || allocated.stdout);
  const body = JSON.parse(allocated.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.opened, false);
  assert.equal(body.browserLaunch.isolated, true);
  assert.equal(body.browserLaunch.dryRun, true);
  assert.equal(body.browserLaunch.command, process.execPath);
  assert.match(body.browserLaunch.statePath.replace(/\\/g, '/'), /browser-launches\.json$/);
  assert.equal(fs.existsSync(path.join(root, body.browserLaunch.artifact.path)), true);

  const released = await runNode([
    script,
    'browser-release',
    '--project',
    root,
    '--run',
    body.run.runId,
    '--window',
    body.window.windowId,
    '--lease',
    body.lease.leaseId,
    '--close',
    'true',
    '--remove-profile',
    'true',
  ], { cwd: root, env });
  assert.equal(released.status, 0, released.stderr || released.stdout);
  const releaseBody = JSON.parse(released.stdout);
  assert.equal(releaseBody.ok, true);
  assert.equal(releaseBody.lease.status, 'released');
  assert.equal(releaseBody.browserClose.count, 1);
  assert.equal(releaseBody.browserClose.closed[0].launchId, body.browserLaunch.launchId);
  assert.equal(releaseBody.browserClose.closed[0].status, 'closed');
  assert.equal(fs.existsSync(body.browserLaunch.profileDir), false);
});

test('wf-ui-control browser-allocate-many creates independent windows and leases for subagents', async () => {
  const { root, baseUrl, token } = await makeServer();
  const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
  const env = {
    ...process.env,
    HARNESS_WF_UI_URL: baseUrl,
    HARNESS_WF_UI_TOKEN: token,
    HARNESS_PEER_SESSION_ID: 'agent-batch',
  };
  const allocated = await runNode([
    script,
    'browser-allocate-many',
    '--project',
    root,
    '--mode',
    'runtime',
    '--agents',
    'agent-a,agent-b',
    '--routes',
    '/workflow,/agents',
    '--width',
    '1280',
    '--height',
    '720',
  ], { cwd: root, env });

  assert.equal(allocated.status, 0, allocated.stderr || allocated.stdout);
  const body = JSON.parse(allocated.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.equal(body.allocations.length, 2);
  assert.equal(body.allocations[0].agentId, 'agent-a');
  assert.equal(body.allocations[1].agentId, 'agent-b');
  assert.equal(body.allocations[0].lease.type, 'control');
  assert.equal(body.allocations[1].lease.type, 'control');
  assert.notEqual(body.allocations[0].window.windowId, body.allocations[1].window.windowId);
  assert.equal(body.allocations[0].run.runId, body.allocations[1].run.runId);
  assert.match(body.allocations[0].launchUrl, /^http:\/\/127\.0\.0\.1:\d+\/workflow\?/);
  assert.match(body.allocations[1].launchUrl, /^http:\/\/127\.0\.0\.1:\d+\/agents\?/);

  const windows = await runNode([
    script,
    'browser-windows',
    '--project',
    root,
    '--run',
    body.run.runId,
  ], { cwd: root, env });
  assert.equal(windows.status, 0, windows.stderr || windows.stdout);
  const listed = JSON.parse(windows.stdout);
  assert.deepEqual(new Set(listed.windows.map(item => item.windowId)), new Set(body.windows.map(item => item.windowId)));
});
