// AC-05 structured-chat effort review.
//
// This verifier is intentionally independent of provider inference.  The first
// test crosses the real HTTP dispatch/server boundary with a test-owned chat
// driver module.  The remaining tests exercise the repository's real native
// driver adapters against test-owned stdio/HTTP recorders.
import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { makeHarnessTempRoot, rmHarnessTempRootRobust } from './support/temp-root.js';
import { SessionRegistry } from '../src/wf-ui-server/session-registry.mjs';
import { flushTerminalBuffer } from '../src/wf-ui-server/terminal-store.mjs';
import { createCodexAppServerDriver } from '../src/wf-ui-server/drivers/codex-appserver.mjs';
import { createClaudeDriver } from '../src/wf-ui-server/drivers/claude-stream-json.mjs';
import { createOpencodeServerDriver } from '../src/wf-ui-server/drivers/opencode-server.mjs';

const effort = 'xhigh';
const trustedVariant = 'luna-xhigh-model-variant';
const taskId = 'task-review-chat-effort-092';
const originalPath = process.env.PATH || '';
const originalOpencodeDb = process.env.OPENCODE_DB;

// The server's production chat-driver import is replaced only in this test
// worker.  Its factory and lifecycle remain real server calls; this module is
// a recorder, so no paid provider or real child process can be reached.
globalThis.__reviewChatEffort092 = {
  entries: [],
  ptyFallbacks: 0,
  reset() { this.entries.length = 0; this.ptyFallbacks = 0; },
};
const chatDriverFixtureUrl = `data:text/javascript,${encodeURIComponent(`
  const recorder = globalThis.__reviewChatEffort092;
  export async function createChatDriver(runtime, options = {}) {
    const entry = {
      runtime,
      options,
      sends: [],
      started: false,
      failed: false,
      fail() {
        if (this.failed) return;
        this.failed = true;
        options.onEnded?.({ type: 'error', payload: { reason: 'test-driver-failure' } });
      },
    };
    const driver = {
      async start() {
        entry.started = true;
        options.onSessionReady?.('provider-chat-092-' + recorder.entries.length);
        return { pid: 62000 + recorder.entries.length };
      },
      send(text, meta) { entry.sends.push({ text: String(text), meta: meta ?? {} }); return true; },
      steer(text, meta) { entry.sends.push({ text: String(text), meta: { ...(meta ?? {}), steer: true } }); return true; },
      async dispose() { entry.disposed = true; },
    };
    entry.driver = driver;
    recorder.entries.push(entry);
    return driver;
  }
  export function sendTo(sessionId, text, options = {}) {
    const entry = recorder.entries.find(item => item.options.sessionId === String(sessionId));
    if (!entry) return false;
    return entry.driver.send(text, options);
  }
  export async function dispose(sessionId) {
    const entry = recorder.entries.find(item => item.options.sessionId === String(sessionId));
    if (!entry) return false;
    await entry.driver.dispose();
    return true;
  }
`)} `;

const ptyFallbackFixtureUrl = `data:text/javascript,${encodeURIComponent(`
  export async function spawnPty() {
    globalThis.__reviewChatEffort092.ptyFallbacks += 1;
    return { blocked: true, reason: 'test-owned-pty-fallback-recorder' };
  }
`)} `;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './chat-driver.mjs'
      && String(context.parentURL || '').endsWith('/src/wf-ui-server/server.mjs')) {
      return { url: chatDriverFixtureUrl, shortCircuit: true };
    }
    if (specifier === './pty-adapter.mjs'
      && String(context.parentURL || '').endsWith('/src/wf-ui-server/server.mjs')) {
      return { url: ptyFallbackFixtureUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// Ensure server runtime detection sees all three launchable runtime IDs while
// the actual structured driver remains test-owned by the hook above.
const detectionRoot = makeHarnessTempRoot('review-chat-effort-092-bin-');
const detectionBin = path.join(detectionRoot, 'bin');
fs.mkdirSync(detectionBin, { recursive: true });
for (const command of ['codex', 'claude', 'opencode']) {
  fs.writeFileSync(path.join(detectionBin, `${command}.cmd`), '@echo off\r\nexit /b 0\r\n');
}
process.env.PATH = `${detectionBin}${path.delimiter}${originalPath}`;
// The accidental-PTY negative path must not attach to a developer's real
// OpenCode database.  A missing test-owned DB also disables the production
// session-id poller, keeping this verifier's teardown bounded.
process.env.OPENCODE_DB = path.join(detectionRoot, 'missing-opencode.db');

const { startServer, stopServer } = await import('../src/wf-ui-server/server.mjs');

let projectRoot;
let server;
let baseUrl;
const activeSessionIds = new Set();

function response(status, json, extra = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => json, ...extra };
}

function jsonRequest(route, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      agent: false,
      headers: payload
        ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Connection: 'close',
        }
        : { Connection: 'close' },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
        res.socket?.destroy();
      });
    });
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function writeTaskState(root) {
  const dir = path.join(root, 'Harness', 'tasks', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    mode: 'wf',
    title: 'Structured chat effort review fixture',
    nextAction: 'verify structured native effort transfer',
    phase: 'verify',
    acceptance: [],
    planItems: [],
    links: { dependsOn: [], blocks: [], related: [] },
  }));
}

function chatDispatch({ dispatchId, runtime, model, projectRoot: root, retry = false }) {
  return {
    dispatchId,
    taskId,
    runtime,
    model,
    effort,
    transport: 'chat',
    role: 'chat-verifier',
    objective: 'verify structured effort handoff without provider inference',
    initialInput: 'initial structured turn',
    requestId: `request-${dispatchId}`,
    replyTo: `reply-${dispatchId}`,
    projectRoot: root,
    ...(retry ? { retry: true } : {}),
  };
}

function authoritativeProbe({ runtime, model, effort: requestedEffort }) {
  return {
    status: 'supported',
    sourceKind: 'test-authoritative-chat-catalog',
    verificationLevel: 'authoritative',
    complete: true,
    model,
    supportedEfforts: [requestedEffort],
    ...(runtime === 'opencode' ? { effortVariant: trustedVariant, catalogModelId: model } : {}),
  };
}

function tick(ms = 10) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeTempRoot(resolved) {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await rmHarnessTempRootRobust(resolved);
      return;
    } catch (error) {
      lastError = error;
      await tick(250);
    }
  }
  throw lastError;
}

before(async () => {
  projectRoot = makeHarnessTempRoot('review-chat-effort-092-project-');
  writeTaskState(projectRoot);
  globalThis.__reviewChatEffort092.reset();
  const started = await startServer({
    projectRoot,
    host: '127.0.0.1',
    port: 0,
    sessionRegistry: new SessionRegistry(),
    eventsWs: false,
    chatWs: false,
    modelCapabilityProbe: authoritativeProbe,
  });
  server = started.server;
  baseUrl = `http://127.0.0.1:${started.port}`;
});

afterEach(async () => {
  if (server && baseUrl) {
    for (const sessionId of activeSessionIds) {
      try {
        await jsonRequest(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' });
      } catch {
        // Teardown must still close the HTTP server and remove only this test's
        // temp root; the assertion that the retry was chat-owned remains above.
      }
    }
  }
  if (server) await stopServer(server);
  server = null;
  if (projectRoot) {
    for (const entry of globalThis.__reviewChatEffort092.entries) {
      flushTerminalBuffer(projectRoot, entry.options?.sessionId);
    }
  }
  if (projectRoot) {
    const resolved = path.resolve(projectRoot);
    const allowed = path.resolve('Harness', '.temp') + path.sep;
    assert.ok(resolved.startsWith(allowed), `refusing to remove non-temp root: ${projectRoot}`);
    // Server startup regenerates a derived task-group index asynchronously;
    // let that bounded write finish before removing the test-owned tree on
    // Windows, where an immediate recursive remove can wait on its handle.
    await tick(250);
    await removeTempRoot(resolved);
  }
  projectRoot = null;
  baseUrl = null;
  activeSessionIds.clear();
});

after(async () => {
  process.env.PATH = originalPath;
  if (originalOpencodeDb === undefined) delete process.env.OPENCODE_DB;
  else process.env.OPENCODE_DB = originalOpencodeDb;
  const resolved = path.resolve(detectionRoot);
  const allowed = path.resolve('Harness', '.temp') + path.sep;
  assert.ok(resolved.startsWith(allowed), `refusing to remove non-temp root: ${detectionRoot}`);
  await rmHarnessTempRootRobust(resolved);
});

test('AC-05 RED: real POST transport:chat preserves model/effort/variant on initial and one retry', async () => {
  const cases = [
    { runtime: 'opencode', model: 'openai/gpt-5.6-luna', variant: trustedVariant },
  ];

  for (const item of cases) {
    const body = chatDispatch({
      dispatchId: `dispatch-chat-effort-${item.runtime}-092`,
      runtime: item.runtime,
      model: item.model,
      projectRoot,
    });
    const initial = await jsonRequest('/api/sessions', { method: 'POST', body });
    assert.equal(initial.status, 201, `${item.runtime}: ${JSON.stringify(initial.body)}`);
    activeSessionIds.add(initial.body.sessionId);
    assert.deepEqual(initial.body.requested, {
      runtime: item.runtime,
      model: item.model,
      effort,
      transport: 'chat',
    });
    const first = globalThis.__reviewChatEffort092.entries.at(-1);
    assert.ok(first?.started, `${item.runtime} chat driver must start through the real server path`);
    assert.equal(first.options.model, item.model);
    assert.equal(first.options.effort, effort, `${item.runtime} initial driver lost mandatory effort`);
    assert.equal(String(first.options.effortVariant || ''), item.variant,
      `${item.runtime} initial driver changed trusted variant`);
    assert.deepEqual(first.sends.map(send => send.text), ['initial structured turn']);

    first.fail();
    await tick(35);
    const retry = await jsonRequest('/api/sessions', {
      method: 'POST',
      body: chatDispatch({ ...body, retry: true }),
    });
    assert.equal(retry.status, 201, `${item.runtime} retry: ${JSON.stringify(retry.body)}`);
    activeSessionIds.add(retry.body.sessionId);
    assert.notEqual(retry.body.sessionId, initial.body.sessionId);
    assert.equal(globalThis.__reviewChatEffort092.ptyFallbacks, 0,
      `${item.runtime} retry must not silently downgrade transport:chat to PTY`);
    assert.equal(globalThis.__reviewChatEffort092.entries.length, 2,
      `${item.runtime} retry must remain on the structured chat driver`);
    const second = globalThis.__reviewChatEffort092.entries.at(-1);
    assert.notEqual(second.options.sessionId, first.options.sessionId,
      `${item.runtime} retry must create a distinct chat driver entry`);
    assert.equal(second.options.model, item.model);
    assert.equal(second.options.effort, effort, `${item.runtime} retry driver lost mandatory effort`);
    assert.equal(String(second.options.effortVariant || ''), item.variant,
      `${item.runtime} retry driver changed trusted variant`);
    assert.deepEqual(second.sends.map(send => send.text), ['initial structured turn']);
  }
});

class JsonRpcChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 63100;
    this.exitCode = null;
    this.signalCode = null;
    this.stdin = {
      writes: [],
      destroyed: false,
      write: chunk => { this.stdin.writes.push(String(chunk)); },
    };
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }

  lines() {
    return this.stdin.writes.join('').split('\n').filter(Boolean).map(line => JSON.parse(line));
  }

  feed(frame) {
    this.stdout.emit('data', `${JSON.stringify(frame)}\n`);
  }

  kill(signal = 'SIGTERM') {
    this.exitCode = 0;
    this.signalCode = signal;
    queueMicrotask(() => this.emit('exit', 0, signal));
    return true;
  }
}

async function bootCodex(driver, child) {
  const started = driver.start();
  await tick();
  const initialize = child.lines()[0];
  child.feed({ jsonrpc: '2.0', id: initialize.id, result: {} });
  await tick();
  const thread = child.lines()[2];
  child.feed({
    jsonrpc: '2.0',
    id: thread.id,
    result: thread.method === 'thread/start' ? { threadId: 'thread-chat-092' } : { ok: true },
  });
  await started;
}

test('AC-05 native Codex app-server uses documented effort on initial and subsequent turns', async () => {
  const child = new JsonRpcChild();
  const spawnCalls = [];
  const driver = createCodexAppServerDriver({
    model: 'gpt-5.6-luna',
    effort,
    onEvent: () => {},
    _spawn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return child;
    },
    requestTimeoutMs: 500,
  });
  try {
    driver.send('initial queued turn');
    await bootCodex(driver, child);
    await tick();
    let turn = child.lines().find(line => line.method === 'turn/start');
    assert.ok(turn, 'queued initial turn must reach app-server');
    assert.equal(turn.params.threadId, 'thread-chat-092');
    assert.equal(turn.params.effort, effort, 'Codex native turn/start must carry effort');
    assert.ok(spawnCalls[0].args.includes('model=gpt-5.6-luna'), 'Codex model must remain exact');
    child.feed({ jsonrpc: '2.0', id: turn.id, result: {} });
    child.feed({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { status: 'completed' } } });
    await tick();

    driver.send('subsequent retry turn');
    await tick();
    const starts = child.lines().filter(line => line.method === 'turn/start');
    assert.equal(starts.length, 2);
    assert.deepEqual(starts.map(line => line.params.effort), [effort, effort],
      'subsequent Codex turn must not silently inherit/drop effort');
  } finally {
    await driver.dispose({ graceMs: 10 });
  }
});

class StreamChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 63200;
    this.exitCode = null;
    this.signalCode = null;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.writes = [];
    this.stdin.on('data', chunk => this.writes.push(String(chunk)));
  }

  lines() {
    return this.writes.join('').split('\n').filter(Boolean).map(line => JSON.parse(line));
  }

  kill(signal = 'SIGTERM') {
    this.exitCode = 0;
    this.signalCode = signal;
    queueMicrotask(() => this.emit('close', 0, signal));
    return true;
  }
}

test('AC-05 native Claude stream-json keeps --effort in argv across initial and subsequent turns; legacy omits it', async () => {
  const calls = [];
  const children = [];
  const spawn = (command, args, options) => {
    const child = new StreamChild();
    calls.push({ command, args, options });
    children.push(child);
    return child;
  };
  const driver = createClaudeDriver({
    model: 'claude-opus-4-7',
    effort,
    onEvent: () => {},
    _spawn: spawn,
    _graceMs: 10,
    _killGraceMs: 10,
  });
  try {
    driver.start();
    driver.send('initial Claude turn');
    driver.send('subsequent Claude retry');
    await tick();
    const args = calls[0].args;
    assert.deepEqual(args.slice(-4), ['--model', 'claude-opus-4-7', '--effort', effort]);
    assert.deepEqual(children[0].lines().map(line => line.message.content[0].text), [
      'initial Claude turn',
      'subsequent Claude retry',
    ]);
  } finally {
    await driver.dispose();
  }

  const legacyCalls = [];
  const legacyChild = new StreamChild();
  const legacy = createClaudeDriver({
    model: 'claude-opus-4-7',
    onEvent: () => {},
    _spawn: (command, args, options) => {
      legacyCalls.push({ command, args, options });
      return legacyChild;
    },
    _graceMs: 10,
    _killGraceMs: 10,
  });
  try {
    legacy.start();
    assert.equal(legacyCalls[0].args.includes('--effort'), false,
      'legacy chat driver without effort must preserve its old argv');
  } finally {
    await legacy.dispose();
  }
});

function completedEventBody() {
  let index = 0;
  const chunks = ['data: {"type":"session.idle","properties":{"sessionID":"oc-chat-092"}}\n\n'];
  return {
    getReader() {
      return {
        read: () => index < chunks.length
          ? Promise.resolve({ done: false, value: new TextEncoder().encode(chunks[index++]) })
          : Promise.resolve({ done: true }),
        cancel: () => Promise.resolve(),
      };
    },
  };
}

function fakeServeChild() {
  const child = new EventEmitter();
  child.pid = 63300;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = signal => { child.exitCode = 0; child.signalCode = signal; queueMicrotask(() => child.emit('exit', 0, signal)); };
  queueMicrotask(() => child.stdout.emit('data', Buffer.from('opencode serve listening on http://127.0.0.1:46292\n')));
  return child;
}

test('AC-05 native OpenCode server sends exact model and trusted variant on initial and subsequent prompts', async () => {
  const calls = [];
  const fetchRecorder = async (url, options = {}) => {
    let body;
    if (options.body) body = JSON.parse(options.body);
    calls.push({ url, method: options.method || 'GET', body });
    if (url.endsWith('/health')) return response(200, {});
    if (url.endsWith('/doc')) return response(404, {});
    if (url.endsWith('/session') && options.method === 'POST') return response(200, { id: 'oc-chat-092' });
    if (url.endsWith('/prompt_async')) return response(204, {});
    if (url.endsWith('/abort')) return response(200, {});
    if (url.endsWith('/event')) return response(200, {}, { body: completedEventBody() });
    return response(404, {});
  };
  const driver = createOpencodeServerDriver({
    model: 'openai/gpt-5.6-luna',
    effort,
    effortVariant: trustedVariant,
    _spawn: () => fakeServeChild(),
    _fetch: fetchRecorder,
    sseRetryDelayMs: 5,
    killGraceMs: 5,
  });
  try {
    await driver.start();
    await driver.send('initial OpenCode turn');
    await driver.send('subsequent OpenCode retry');
    const prompts = calls.filter(call => call.method === 'POST' && call.url.endsWith('/prompt_async'));
    assert.equal(prompts.length, 2);
    for (const prompt of prompts) {
      // OpenCode's native HTTP prompt shape uses model/parts; model reasoning
      // variants are carried as the top-level `variant` (see the official
      // server compatibility adapter), not an invented `reasoning_effort` key.
      assert.equal(prompt.body.model, 'openai/gpt-5.6-luna');
      assert.equal(prompt.body.variant, trustedVariant,
        'OpenCode native request must preserve the trusted model-level variant');
      assert.deepEqual(prompt.body.parts, [{ type: 'text', text: prompt === prompts[0] ? 'initial OpenCode turn' : 'subsequent OpenCode retry' }]);
      assert.equal('reasoning_effort' in prompt.body, false);
    }
  } finally {
    await driver.dispose({ immediate: true });
  }
});
