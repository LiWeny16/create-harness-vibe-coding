// Real CLI boundary checks for the opt-in dispatch path (AC-05 / AC-07).
//
// The first test is intentionally RED until the normal create-agent CLI carries
// the dispatch envelope.  It is a black-box check: an Agent subprocess invokes
// the shipped wf-ui-control script against a real in-process backend.
// The second test isolates the already-implemented report surface by creating
// through the API, then invoking the worker's progress/result commands as real
// CLI subprocesses with the service-injected identity.  The PTY is a
// test-owned fixture; this is integration evidence, not a provider benchmark.
import test, { after, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { makeHarnessTempRoot } from './support/temp-root.js';
import { SessionRegistry } from '../src/wf-ui-server/session-registry.mjs';

const repoRoot = path.resolve('.');
const controlCli = path.join(repoRoot, 'Harness', 'scripts', 'wf-ui-control.mjs');
const fixtureDir = path.join(repoRoot, 'tests', 'fixtures', 'runtime-092');
const fixtureUrl = pathToFileURL(path.join(fixtureDir, 'pty-adapter.mjs')).href;
const originalPath = process.env.PATH || '';
const taskId = 'task-runtime-cli-092';
const dispatchId = 'dispatch-runtime-cli-092';
const requestId = 'request-runtime-cli-092';
const replyTo = 'reply-runtime-cli-092';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './pty-adapter.mjs'
      && String(context.parentURL || '').endsWith('/src/wf-ui-server/server.mjs')) {
      return { url: fixtureUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// Import after the resolve hook so this test never starts a real PTY/provider.
const { startServer, stopServer } = await import('../src/wf-ui-server/server.mjs');
const { recorder } = await import(fixtureUrl);

let root;
let server;
let baseUrl;
let registry;

function writeTaskFixture(projectRoot) {
  const taskRoot = path.join(projectRoot, 'Harness', 'tasks', taskId);
  fs.mkdirSync(taskRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'Harness', 'PROGRESS.md'),
    `# PROGRESS.md\n\n## Active Task\n\n- ${taskId}\n`, 'utf8');
  fs.writeFileSync(path.join(taskRoot, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    mode: 'wf',
    title: 'Runtime CLI dispatch fixture',
    nextAction: 'Exercise dispatch',
    phase: 'implement',
    acceptance: [],
    planItems: [],
    links: { dependsOn: [], blocks: [], related: [] },
  }, null, 2));
  fs.writeFileSync(path.join(taskRoot, 'PLAN.md'), '# Plan\n', 'utf8');
  fs.writeFileSync(path.join(taskRoot, 'PROGRESS.md'), '# Progress\n', 'utf8');
  fs.mkdirSync(path.join(projectRoot, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(controlCli, path.join(projectRoot, 'Harness', 'scripts', 'wf-ui-control.mjs'));
  fs.writeFileSync(path.join(projectRoot, 'Harness', 'context-pack.md'),
    'CLI_CONTEXT_PACK_SENTINEL_092\n', 'utf8');
}

function runWfUi(args, { env = {}, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const script = path.join(root, 'Harness', 'scripts', 'wf-ui-control.mjs');
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`wf-ui-control timeout: ${args.join(' ')}`));
    }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', status => {
      clearTimeout(timer);
      let parsed = stdout.trim();
      try { parsed = JSON.parse(parsed); } catch { /* preserve diagnostics */ }
      resolve({ status, stdout: parsed, stderr });
    });
  });
}

function jsonRequest(route, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      // No keep-alive: a pooled socket the server already closed (default 5s
      // keepAliveTimeout) surfaces as ECONNRESET when a slow, loaded run reuses
      // it. A fresh connection per request keeps the gate deterministic.
      agent: false,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: response.statusCode, body: data }); }
      });
    });
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function dispatchRequest(overrides = {}) {
  return {
    dispatchId,
    taskId,
    runtime: 'codex',
    model: 'gpt-5.6-luna',
    effort: 'xhigh',
    transport: 'pty',
    role: 'implementer',
    objective: 'exercise the real worker CLI report path',
    initialPrompt: 'Use the worker identity to report progress and result.',
    contextPackPath: 'Harness/context-pack.md',
    requestId,
    replyTo,
    projectRoot: root,
    ...overrides,
  };
}

function dispatchWorkerEnv(session, capability) {
  return {
    HARNESS_WF_UI_URL: baseUrl,
    HARNESS_PEER_RUNTIME: session.runtime,
    HARNESS_AGENT_KIND: session.agentKind,
    HARNESS_WORKFLOW_NODE_ID: session.graphNodeId,
    HARNESS_PEER_TASK_ID: session.taskId,
    HARNESS_PEER_SESSION_ID: session.sessionId,
    HARNESS_DISPATCH_ID: session.dispatchId,
    HARNESS_DISPATCH_REQUEST_ID: session.dispatchRequestId,
    HARNESS_DISPATCH_REPLY_TO: session.dispatchReplyTo,
    HARNESS_WORKER_CAPABILITY: capability,
  };
}

function readSessionEvents(sessionId) {
  const file = path.join(root, 'Harness', 'tasks', taskId, 'sessions', sessionId, 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

before(() => {
  process.env.PATH = `${fixtureDir}${path.delimiter}${originalPath}`;
  if (process.platform !== 'win32') fs.chmodSync(path.join(fixtureDir, 'codex'), 0o755);
});

after(() => {
  process.env.PATH = originalPath;
  if (process.platform !== 'win32') fs.chmodSync(path.join(fixtureDir, 'codex'), 0o644);
});

beforeEach(async () => {
  root = makeHarnessTempRoot('runtime-dispatch-cli-092-');
  writeTaskFixture(root);
  recorder.reset();
  registry = new SessionRegistry();
  const started = await startServer({
    projectRoot: root,
    host: '127.0.0.1',
    port: 0,
    sessionRegistry: registry,
    eventsWs: false,
    chatWs: false,
    modelCapabilityProbe: ({ runtime, model, effort, projectRoot }) => ({
      status: 'supported',
      sourceKind: 'test-authoritative-catalog',
      verificationLevel: 'authoritative',
      complete: true,
      runtime,
      model,
      supportedEfforts: [effort],
      projectRoot,
    }),
  });
  server = started.server;
  baseUrl = `http://127.0.0.1:${started.port}`;
});

afterEach(async () => {
  if (server) await stopServer(server);
  server = null;
  if (root) {
    const resolved = path.resolve(root);
    const allowed = path.resolve('Harness', '.temp') + path.sep;
    assert.ok(resolved.startsWith(allowed), `refusing to remove non-temp root: ${root}`);
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  root = null;
});

test('AC-05/AC-07 create-agent CLI carries dispatch envelope into the created worker', async () => {
  const result = await runWfUi([
    'create-agent',
    '--project', root,
    '--url', baseUrl,
    '--actor-kind', 'main',
    '--agent-kind', 'subagent',
    '--role', 'implementer',
    '--runtime', 'codex',
    '--model', 'gpt-5.6-luna',
    '--objective', 'exercise the normal dispatch path',
    '--initial-prompt', 'Report explicit progress and result.',
    '--dispatch-id', dispatchId,
    '--task', taskId,
    '--effort', 'xhigh',
    '--transport', 'pty',
    '--context-pack-path', 'Harness/context-pack.md',
    '--request-id', requestId,
    '--reply-to', replyTo,
  ], { env: { HARNESS_AGENT_KIND: 'main' } });

  assert.equal(result.status, 0, `create-agent CLI failed: ${result.stderr}`);
  assert.equal(result.stdout?.ok, true, JSON.stringify(result.stdout));
  assert.equal(result.stdout?.dispatchId, dispatchId,
    'normal create-agent must opt into the dispatch endpoint when dispatchId is supplied');
  assert.deepEqual(result.stdout?.requested, {
    runtime: 'codex', model: 'gpt-5.6-luna', effort: 'xhigh', transport: 'pty',
  });
  assert.equal(result.stdout?.attempt, 0);
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0]?.options?.dispatchId, dispatchId);
  assert.match(String(recorder.calls[0]?.options?.initialPrompt), /CLI_CONTEXT_PACK_SENTINEL_092/);
});

test('AC-05/AC-07 worker report CLI consumes injected identity and reaches terminal result', async () => {
  const created = await jsonRequest('/api/sessions', { method: 'POST', body: dispatchRequest() });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const session = registry.get(created.body.sessionId);
  assert.ok(session, 'dispatch must create a registry session');
  const capability = recorder.calls[0]?.options?.workerCapability;
  assert.equal(typeof capability, 'string');
  assert.equal(recorder.calls[0]?.options?.dispatchId, dispatchId);
  assert.equal(recorder.calls[0]?.options?.taskId, taskId);
  assert.equal(recorder.calls[0]?.options?.requestId, requestId);
  assert.equal(recorder.calls[0]?.options?.replyTo, replyTo);
  assert.match(String(recorder.calls[0]?.options?.initialPrompt), /CLI_CONTEXT_PACK_SENTINEL_092/);

  const workerEnv = dispatchWorkerEnv(session, capability);
  const progress = await runWfUi([
    'dispatch-progress', '--url', baseUrl, '--text', 'worker progress from real CLI',
  ], { env: workerEnv });
  assert.equal(progress.status, 0, `dispatch-progress CLI failed: ${progress.stderr}`);
  assert.equal(progress.stdout?.ok, true, JSON.stringify(progress.stdout));
  assert.equal(progress.stdout?.dispatchId, dispatchId);
  assert.equal(progress.stdout?.sessionId, session.sessionId);
  assert.equal(progress.stdout?.status, 'running');

  const terminal = await runWfUi([
    'dispatch-result', '--url', baseUrl, '--status', 'succeeded',
    '--result', '{"source":"worker-cli","ok":true}',
  ], { env: workerEnv });
  assert.equal(terminal.status, 0, `dispatch-result CLI failed: ${terminal.stderr}`);
  assert.equal(terminal.stdout?.ok, true, JSON.stringify(terminal.stdout));
  assert.equal(terminal.stdout?.dispatchId, dispatchId);
  assert.equal(terminal.stdout?.sessionId, session.sessionId);
  assert.equal(terminal.stdout?.status, 'succeeded');

  const events = readSessionEvents(session.sessionId);
  assert.ok(events.some(event => event.type === 'dispatch.progress'
    && event.dispatchId === dispatchId && event.requestId === requestId));
  assert.ok(events.some(event => event.type === 'dispatch.result'
    && event.dispatchId === dispatchId && event.replyTo === replyTo));
  const current = registry.get(session.sessionId);
  assert.equal(current.status, 'succeeded');
  assert.equal(current.dispatchStatus, 'succeeded');
});
