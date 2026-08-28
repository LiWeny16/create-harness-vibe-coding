// workflow-terminal-control.test.mjs
//
// Agent terminal control surface (AC-CTRL-001/002/004).
//
//   Group A (AC-CTRL-001): submit byte sequences — the body is typed
//     CHAR-BY-CHAR (first char synchronously, the rest at 12ms gaps) followed
//     by exactly ONE \r (0x0D), never \n; trailing CR/CRLF is stripped before
//     typing; an empty body submits a single \r only.
//   Group B (AC-CTRL-001): ready gating — sessions without a tracked terminal
//     spawn submit immediately (preserving the 409 NO_PTY contract for dead
//     sessions); sessions WITH a tracked spawn wait for the prompt marker
//     (❯/›) before any write; never-ready terminals still submit after the
//     wait window.
//   Group C (AC-CTRL-001): retry + stale timers — a failed \r write is retried
//     exactly once; a second submit cancels the first submit's pending
//     poll/enter timers.
//   Group D (AC-CTRL-002): initialPrompt chain (Enter-free trigger) —
//     POST /api/sessions carries initialPrompt into spawnPty opts; the CLI
//     create-agent --initial-prompt lands it in the POST body (real subprocess
//     against a recording HTTP server).
//   Group E (AC-CTRL-004): [harness-request] envelope delivery — exact prefix
//     format preserved; envelope delivery ready-gated like prompt submits.
//
// Pattern: in-process node:test + HTTP server on port 0, temp roots, fake
// PTYs (mirrors control-plane-acceptance.test.mjs). The deterministic spawn
// path is provided by redirecting pty-adapter.mjs to an in-test fixture via
// module.registerHooks (node --test runs each file in its own process, so the
// redirect stays local). Runtime detection is satisfied by a stub `codex`
// executable prepended to PATH, so POST /api/sessions reaches the spawn branch
// without any real PTY backend.
//
// Envelope delivery (E1/E2) follows the same typed submit semantics: the
// [harness-request ...] prefix + text lands char-by-char and is ready-gated
// like prompt submits (E2).
//
// Run: node --test src/wf-ui-server/__tests__/workflow-terminal-control.test.mjs
import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { SessionRegistry } from '../session-registry.mjs';
import { registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';
import { listBridgeMessages } from '../bridge-store.mjs';

// ── pty-adapter fixture (deterministic spawn path) ──────────────────────────
// Replaces pty-adapter.mjs for this process: spawnPty records the spawn opts
// (D1), returns an in-memory pty whose writes are captured (A/B/C/E), and
// exposes the onData/onExit hooks the server wires readiness through (B2/C2).
const FIXTURE_SOURCE = [
  '// Test fixture replacing pty-adapter.mjs (see workflow-terminal-control.test.mjs).',
  'const recorder = {',
  '  spawnOpts: [],',
  '  writesBySession: new Map(),',
  '  onDataBySession: new Map(),',
  '  onExitBySession: new Map(),',
  '  reset() {',
  '    this.spawnOpts.length = 0;',
  '    this.writesBySession.clear();',
  '    this.onDataBySession.clear();',
  '    this.onExitBySession.clear();',
  '  },',
  '};',
  'export async function spawnPty(opts) {',
  '  recorder.spawnOpts.push(opts);',
  '  const writes = [];',
  '  recorder.writesBySession.set(opts.sessionId, writes);',
  '  if (typeof opts.onData === "function") recorder.onDataBySession.set(opts.sessionId, opts.onData);',
  '  if (typeof opts.onExit === "function") recorder.onExitBySession.set(opts.sessionId, opts.onExit);',
  '  const ptyProcess = {',
  '    pid: 42000 + recorder.spawnOpts.length,',
  '    write(data) { writes.push(String(data)); },',
  '    kill() {},',
  '    onData() {},',
  '    onExit() {},',
  '  };',
  '  return { sessionId: opts.sessionId, pid: ptyProcess.pid, ptyProcess, ptyProvider: "test-fixture" };',
  '}',
  'export { recorder };',
].join('\n');

const fixtureDir = makeHarnessTempRoot('wf-ui-ctrl-fixture-');
const fixturePath = path.join(fixtureDir, 'pty-adapter.mjs');
fs.writeFileSync(fixturePath, FIXTURE_SOURCE, 'utf8');
const fixtureUrl = pathToFileURL(fixturePath).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './pty-adapter.mjs' && String(context.parentURL || '').endsWith('/src/wf-ui-server/server.mjs')) {
      return { url: fixtureUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { startServer, stopServer, terminalReadyForInitialInput } = await import('../server.mjs');
const { recorder } = await import(fixtureUrl);

// ── runtime stub ────────────────────────────────────────────────────────────
// A stub `codex` on PATH makes createRuntimeSession take the spawn branch
// (runtimeInfo.path + launchable) so trackTerminalSpawn runs for real.
const ORIGINAL_PATH = process.env.PATH || '';
let runtimeStubDir = '';

before(() => {
  runtimeStubDir = makeHarnessTempRoot('wf-ui-ctrl-runtime-');
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(runtimeStubDir, 'codex.cmd'), '@echo off\r\nrem wf-ui control test stub\r\n');
  } else {
    const stub = path.join(runtimeStubDir, 'codex');
    fs.writeFileSync(stub, '#!/bin/sh\n');
    fs.chmodSync(stub, 0o755);
  }
  process.env.PATH = `${runtimeStubDir}${path.delimiter}${ORIGINAL_PATH}`;
});

after(() => {
  process.env.PATH = ORIGINAL_PATH;
  for (const dir of [runtimeStubDir, fixtureDir]) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
  }
});

// ── HTTP helper ──
function jsonRequest(baseUrl, route, { method = 'GET', body, token = '' } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Project seeding + suite helpers ──
function seedRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

async function waitFor(fn, { timeout = 5000, step = 25 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise(resolve => setTimeout(resolve, step));
  }
  throw new Error(`waitFor timed out; last=${JSON.stringify(last)}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// The one true submit sequence for typed delivery: the body lands CHAR-BY-CHAR
// (first char synchronously, the rest at PROMPT_TYPING_CHAR_DELAY_MS gaps),
// then exactly one \r (0x0D) as its own final write, and no \n anywhere in the
// injected bytes.
function assertTypedSubmitSequence(writes, body) {
  const joined = writes.join('');
  assert.equal(joined.includes('\n'), false, `no \\n may be injected: ${JSON.stringify(writes)}`);
  assert.ok(joined.endsWith('\r'), `sequence must end with the single \\r: ${JSON.stringify(writes)}`);
  assert.equal(writes[writes.length - 1], '\r', `the \\r must arrive as its own single-byte write: ${JSON.stringify(writes)}`);
  assert.equal(joined.slice(0, -1), body, `the typed chars must join to the exact body: ${JSON.stringify(writes)}`);
  if (body) {
    assert.equal(writes[0], body[0], `the first char must be the first write (synchronous): ${JSON.stringify(writes)}`);
  }
}

// Spawn a real `node Harness/scripts/wf-ui-control.mjs <command>` subprocess
// (same runner as control-plane-cli-smoke.test.mjs).
function runWfUi(args, { cwd, env = {}, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const script = path.join(cwd, 'Harness', 'scripts', 'wf-ui-control.mjs');
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
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
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      let parsed = stdout.trim();
      try { parsed = JSON.parse(parsed); } catch { /* raw text */ }
      resolve({ status, stdout: parsed, stderr });
    });
  });
}

// ── Suite ──
describe('Agent Terminal Control Surface (AC-CTRL-001/002/004)', () => {
  let root;
  let registry;
  let server;
  let baseUrl;
  const registeredPties = [];

  beforeEach(async () => {
    recorder.reset();
    root = seedRoot('wf-ctrl-');
    registry = new SessionRegistry();
    const started = await startServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      sessionRegistry: registry,
      eventsWs: false,
    });
    server = started.server;
    baseUrl = `http://127.0.0.1:${started.port}`;
  });

  afterEach(async () => {
    for (const sessionId of registeredPties.splice(0)) {
      unregisterPtyProcess(sessionId);
    }
    if (server) {
      await stopServer(server);
      server = null;
    }
    if (root) {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      root = null;
    }
  });

  // ── Suite-local helpers ──
  function registerPty(sessionId, writes) {
    registerPtyProcess(sessionId, { write: data => writes.push(String(data)) });
    registeredPties.push(sessionId);
  }

  // Untracked session (deferPtySpawn): no tracked spawn, no readiness gating.
  async function createAgentViaApi(overrides = {}) {
    const res = await jsonRequest(baseUrl, '/api/sessions', {
      method: 'POST',
      body: {
        runtime: 'claude',
        agentKind: 'subagent',
        role: 'Subagent',
        roleTitle: 'implementer',
        displayName: 'implementer',
        responsibility: 'terminal control test agent',
        capabilities: ['terminal'],
        objective: 'Terminal control acceptance agent',
        attachGraphNode: true,
        deferPtySpawn: true,
        ...overrides,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { sessionId: res.body.sessionId, nodeId: `session-${res.body.sessionId}`, body: res.body };
  }

  // Tracked session (real spawn branch through the pty-adapter fixture):
  // trackTerminalSpawn records it and readiness is gated until the fixture's
  // onData callback delivers a prompt marker.
  async function createSpawnedAgent(overrides = {}) {
    const agent = await createAgentViaApi({ runtime: 'codex', deferPtySpawn: false, ...overrides });
    assert.equal(agent.body.status, 'running', JSON.stringify(agent.body));
    registeredPties.push(agent.sessionId);
    return agent;
  }

  async function connectDelegation(fromNodeId, toNodeId) {
    const res = await jsonRequest(baseUrl, '/api/workflow/edges', {
      method: 'POST',
      body: { from: fromNodeId, to: toNodeId, relation: 'delegation', direction: 'bidirectional' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  function submitInput(sessionId, data) {
    return jsonRequest(baseUrl, `/api/sessions/${sessionId}/input`, {
      method: 'POST',
      body: { data, submit: true },
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // Group A: submit byte sequences (AC-CTRL-001)
  // ══════════════════════════════════════════════════════════════════
  it('A1 - submit types the body char-by-char then exactly one \\r (0x0D), never \\n', async () => {
    const agent = await createAgentViaApi();
    const writes = [];
    registerPty(agent.sessionId, writes);

    const res = await submitInput(agent.sessionId, 'echo hello');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(writes[0], 'e', 'the first char must be written synchronously on submit; the rest are typed');

    // 10 chars: 9 × 12ms typing + 800ms before the enter lands.
    await waitFor(() => (writes.join('') === 'echo hello\r' ? writes : null), { timeout: 5000 });
    assertTypedSubmitSequence(writes, 'echo hello');
  });

  it('A2 - trailing CR/CRLF is stripped from the body before write', async () => {
    const agent = await createAgentViaApi();
    const writes = [];
    registerPty(agent.sessionId, writes);

    const res = await submitInput(agent.sessionId, 'echo hello\r\n');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(writes[0], 'e', 'the stripped body must start typing synchronously');
    await waitFor(() => (writes.join('') === 'echo hello\r' ? writes : null), { timeout: 5000 });
    assertTypedSubmitSequence(writes, 'echo hello');

    // CR-only trailing is stripped too.
    const agent2 = await createAgentViaApi();
    const writes2 = [];
    registerPty(agent2.sessionId, writes2);
    await submitInput(agent2.sessionId, 'list files\r');
    assert.equal(writes2[0], 'l', 'the stripped CR-only body must start typing synchronously');
    await waitFor(() => (writes2.join('') === 'list files\r' ? writes2 : null), { timeout: 5000 });
    assertTypedSubmitSequence(writes2, 'list files');
  });

  it('A3 - empty body + submit injects a single \\r only', async () => {
    const agent = await createAgentViaApi();
    const writes = [];
    registerPty(agent.sessionId, writes);

    const res = await submitInput(agent.sessionId, '');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await waitFor(() => (writes.length === 1 ? writes : null));
    assert.equal(writes.length, 1, JSON.stringify(writes));
    assert.equal(writes[0], '\r', 'an empty submit must inject exactly one \\r and no body');
  });

  // ══════════════════════════════════════════════════════════════════
  // Group B: ready gating (AC-CTRL-001)
  // ══════════════════════════════════════════════════════════════════
  it('B0 - prompt-marker readiness detector contract (❯/›)', () => {
    assert.equal(terminalReadyForInitialInput('Codex › ready', 'codex'), true);
    assert.equal(terminalReadyForInitialInput('Codex ❯', 'codex'), true);
    assert.equal(terminalReadyForInitialInput('Codex booting...', 'codex'), false);
    assert.equal(terminalReadyForInitialInput('Claude Code 2.0.1 — ❯', 'claude'), true);
    assert.equal(terminalReadyForInitialInput('Claude Code 2.0.1', 'claude'), false);
    assert.equal(terminalReadyForInitialInput('❯', ''), true);
    assert.equal(terminalReadyForInitialInput('', 'codex'), false);
  });

  it('B1a - session WITHOUT tracked spawn keeps the 409 NO_PTY contract (no polling wait)', async () => {
    const agent = await createAgentViaApi(); // blocked; no PTY registered
    const res = await submitInput(agent.sessionId, 'dead session');
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'NO_PTY');
  });

  it('B1b - session WITHOUT tracked spawn submits immediately (no polling delay)', async () => {
    const agent = await createAgentViaApi();
    const writes = [];
    registerPty(agent.sessionId, writes);

    const res = await submitInput(agent.sessionId, 'B1b immediate');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(writes[0], 'B', 'untracked sessions must type the first char synchronously — no gate');
    await waitFor(() => (writes.join('') === 'B1b immediate\r' ? writes : null), { timeout: 5000 });
    assertTypedSubmitSequence(writes, 'B1b immediate');
  });

  it('B2 - tracked spawn waits for the ready marker; nothing is written before it', async () => {
    const agent = await createSpawnedAgent();
    const writes = recorder.writesBySession.get(agent.sessionId);
    assert.ok(writes, 'spawn fixture must register the session writes');

    const res = await submitInput(agent.sessionId, 'B2 gated task');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.deepEqual(writes, [], 'ready-gated submit must not write before the marker is observed');

    await sleep(700); // spans several 250ms poll cycles
    assert.deepEqual(writes, [], 'poll must keep waiting while the prompt marker is missing');

    const onData = recorder.onDataBySession.get(agent.sessionId);
    assert.equal(typeof onData, 'function', 'spawn fixture must expose the onData hook');
    onData('Codex › ready');
    // 13 chars: 12 × 12ms typing + 800ms before the enter.
    await waitFor(() => (writes.join('') === 'B2 gated task\r' ? writes : null), { timeout: 5000 });
    assertTypedSubmitSequence(writes, 'B2 gated task');
  });

  it('B3 - never-ready tracked spawn still submits after the wait window', async () => {
    const agent = await createSpawnedAgent();
    const writes = recorder.writesBySession.get(agent.sessionId);

    const res = await submitInput(agent.sessionId, 'B3 fallback task');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(writes, [], 'no write while not ready');

    // The readiness wait window is 10s (poll 250ms), then the body is typed
    // (15 × 12ms) and the enter fires 800ms after the last char. Never feed a
    // ready marker: the fallback must still submit once the window elapses.
    await waitFor(() => (writes.join('') === 'B3 fallback task\r' ? writes : null), { timeout: 16000 });
    assertTypedSubmitSequence(writes, 'B3 fallback task');
  });

  // ══════════════════════════════════════════════════════════════════
  // Group C: retry + stale timers (AC-CTRL-001)
  // ══════════════════════════════════════════════════════════════════
  it('C1 - a failed \\r write is retried exactly once', async () => {
    const agent = await createAgentViaApi();
    const writes = [];
    let accessCount = 0;
    const realWrite = data => writes.push(String(data));
    // writePtyInput checks `typeof pty.write === 'function'` before calling.
    // Access map for the typed flow on 'C1 retry body' (14 chars):
    //   accesses 1-2: typeof+call for the synchronous first char,
    //   accesses 3-28: typeof+call for chars 2..14 (12ms gaps),
    //   access 29: typeof for the FIRST enter -> pretend the write channel is
    //     missing once, so writePtyInput returns false and the server retries
    //     the enter 800ms later (access 30: typeof, access 31: call -> \r).
    const pty = {
      pid: 4242,
      kill() {},
      onData() {},
      onExit() {},
      get write() {
        accessCount += 1;
        return accessCount === 2 * 'C1 retry body'.length + 1 ? undefined : realWrite;
      },
    };
    registerPtyProcess(agent.sessionId, pty);
    registeredPties.push(agent.sessionId);

    const res = await submitInput(agent.sessionId, 'C1 retry body');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(writes[0], 'C', 'the first char must be written synchronously');

    // All 14 chars land by ~156ms; the first enter attempt fails at >=956ms;
    // the retry cannot fire before >=1756ms. At 1200ms the write list must
    // still hold only the typed body — this is what proves the retry path (a
    // successful first enter would already have pushed the \r here).
    await sleep(1200);
    assert.equal(writes.join(''), 'C1 retry body', 'first enter must fail without writing, retry still pending');
    assert.equal(writes.includes('\r'), false, 'no \\r may land before the retry fires');

    await waitFor(() => (writes.join('') === 'C1 retry body\r' ? writes : null), { timeout: 5000 });
    assertTypedSubmitSequence(writes, 'C1 retry body');
  });

  it('C2 - a second submit cancels the first submit pending timers', async () => {
    const agent = await createSpawnedAgent();
    const writes = recorder.writesBySession.get(agent.sessionId);

    const first = await submitInput(agent.sessionId, 'first');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(writes, [], 'first submit is gated: nothing written yet');

    const second = await submitInput(agent.sessionId, 'second');
    assert.equal(second.status, 200, JSON.stringify(second.body));

    const onData = recorder.onDataBySession.get(agent.sessionId);
    onData('Codex › ready');
    // 'second' = 6 chars: 5 × 12ms typing + 800ms before the enter.
    await waitFor(() => (writes.join('') === 'second\r' ? writes : null), { timeout: 5000 });
    await sleep(300); // let any stale first-submit char land, if cancellation failed
    assert.equal(writes.join(''), 'second\r', 'only the second submit may land; the first must be cancelled');
    assertTypedSubmitSequence(writes, 'second');
    assert.ok(!writes.join('').includes('first'), `first submit body must never be written: ${JSON.stringify(writes)}`);
  });

  // ══════════════════════════════════════════════════════════════════
  // Group D: initialPrompt chain (AC-CTRL-002, Enter-free trigger)
  // ══════════════════════════════════════════════════════════════════
  it('D1 - POST /api/sessions initialPrompt reaches spawnPty opts', async () => {
    const created = await createSpawnedAgent({
      agentKind: 'main',
      role: 'Main Agent',
      roleTitle: 'ceo',
      initialPrompt: 'D1 initial task via API',
    });
    const opts = recorder.spawnOpts[recorder.spawnOpts.length - 1];
    assert.ok(opts, 'spawn fixture must record the spawn');
    assert.equal(opts.initialPrompt, 'D1 initial task via API', 'spawn must carry the initialPrompt argv');
    assert.equal(opts.runtime, 'codex');
    assert.equal(opts.sessionId, created.sessionId);
    assert.ok(opts.launchPolicy, 'spawn must carry the launch policy');
  });

  it('D2 - CLI create-agent --initial-prompt lands initialPrompt in the POST body', async () => {
    // Real subprocess against a recording HTTP server: the CLI posts to it,
    // the server captures the request body and returns a fake session.
    const captured = [];
    const recording = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        captured.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessionId: 'd2-fake-session', status: 'running', ok: true }));
      });
    });
    await new Promise(resolve => recording.listen(0, '127.0.0.1', resolve));
    const port = recording.address().port;
    try {
      const cliRoot = seedRoot('wf-ctrl-cli-');
      try {
        const scriptDest = path.join(cliRoot, 'Harness', 'scripts', 'wf-ui-control.mjs');
        fs.mkdirSync(path.dirname(scriptDest), { recursive: true });
        fs.copyFileSync(path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs'), scriptDest);
        const run = await runWfUi([
          'create-agent',
          '--project', cliRoot,
          '--url', `http://127.0.0.1:${port}`,
          '--token', 'd2-token',
          '--actor-kind', 'main',
          '--initial-prompt', 'D2 initial task from CLI',
        ], { cwd: cliRoot });
        assert.equal(run.status, 0, run.stderr);
        assert.equal(run.stdout.sessionId, 'd2-fake-session', JSON.stringify(run.stdout));
        assert.equal(captured.length, 1, JSON.stringify(captured));
        assert.equal(captured[0].method, 'POST');
        assert.ok(captured[0].url.startsWith('/api/sessions'), captured[0].url);
        assert.equal(captured[0].body.initialPrompt, 'D2 initial task from CLI');
        assert.equal(captured[0].body.runtime, 'claude', 'CLI defaults to the claude runtime');
        assert.equal(captured[0].body.agentKind, 'subagent', 'CLI defaults to subagent kind');
      } finally {
        fs.rmSync(cliRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    } finally {
      recording.closeAllConnections?.();
      await new Promise(resolve => recording.close(resolve));
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // Group E: [harness-request] envelope delivery (AC-CTRL-004)
  // ══════════════════════════════════════════════════════════════════
  it('E1 - [harness-request] envelope keeps the exact format prefix', async () => {
    const sender = await createAgentViaApi({ agentKind: 'main', role: 'Main Agent', roleTitle: 'ceo' });
    const target = await createAgentViaApi();
    const writes = [];
    registerPty(target.sessionId, writes);
    await connectDelegation(sender.nodeId, target.nodeId);

    const sent = await jsonRequest(baseUrl, `/api/workflow/nodes/${sender.nodeId}/actions/agent.sendMessage`, {
      method: 'POST',
      body: { to: target.nodeId, text: 'STRUCTURED_E1', requestId: 'req-e1-1', toRole: 'implementer' },
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.result.mode, 'direct');
    assert.equal(sent.body.result.deliveries[0].ok, true);

    // Envelope delivered like a prompt submit: prefix + body typed char-by-char
    // (first char synchronously), then a single \r. The joined sequence must
    // keep the exact prefix format.
    const expectJoined1 = '[harness-request req-e1-1 to-role=implementer] STRUCTURED_E1\r';
    assert.equal(writes[0], '[', 'envelope typing must start with the first prefix char synchronously');
    await waitFor(() => (writes.join('') === expectJoined1 ? expectJoined1 : null), { timeout: 8000 });
    assert.equal(writes.join(''), expectJoined1);
    assert.equal(writes.join('').includes('\n'), false);
    assert.equal(writes[writes.length - 1], '\r', 'the delivered sequence must end with the single \\r');
    assert.equal(writes.filter(w => w === '\r').length, 1, 'exactly one \\r (0x0D) in the delivered sequence');

    const bridge = listBridgeMessages(root, { fromSessionId: sender.sessionId, toSessionId: target.sessionId });
    assert.equal(bridge.entries.length, 1);
    assert.equal(bridge.entries[0].data.replace(/\r$/, ''), 'STRUCTURED_E1');

    // Full envelope form with contextRefs.
    const sent2 = await jsonRequest(baseUrl, `/api/workflow/nodes/${sender.nodeId}/actions/agent.sendMessage`, {
      method: 'POST',
      body: { to: target.nodeId, text: 'DO_E1_2', requestId: 'req-e1-2', toRole: 'reviewer', contextRefs: ['md-x1'] },
    });
    assert.equal(sent2.status, 200, JSON.stringify(sent2.body));
    const expectJoined2 = expectJoined1 + '[harness-request req-e1-2 to-role=reviewer contextRefs=md-x1] DO_E1_2\r';
    await waitFor(() => (writes.join('') === expectJoined2 ? expectJoined2 : null), { timeout: 8000 });
    assert.equal(writes.join(''), expectJoined2);
  });

  it('E2 - envelope delivery is ready-gated like prompt submits (no write before ready)', async () => {
    const sender = await createAgentViaApi({ agentKind: 'main', role: 'Main Agent', roleTitle: 'ceo' });
    const target = await createSpawnedAgent();
    const writes = recorder.writesBySession.get(target.sessionId);
    await connectDelegation(sender.nodeId, target.nodeId);

    const sent = await jsonRequest(baseUrl, `/api/workflow/nodes/${sender.nodeId}/actions/agent.sendMessage`, {
      method: 'POST',
      body: { to: target.nodeId, text: 'STRUCTURED_E2', requestId: 'req-e2-1', toRole: 'implementer' },
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    // EXPECTED RED until delivery is routed through the ready gate: the
    // envelope must not reach the PTY before the prompt marker was observed.
    assert.deepEqual(writes, [], 'no envelope write before the ready marker');

    const onData = recorder.onDataBySession.get(target.sessionId);
    onData('Codex › ready');
    const expectJoined = '[harness-request req-e2-1 to-role=implementer] STRUCTURED_E2\r';
    await waitFor(() => (writes.join('') === expectJoined ? expectJoined : null), { timeout: 5000 });
    assert.equal(writes.join(''), expectJoined);
    assert.equal((writes.join('').match(/\r/g) || []).length, 1, 'exactly one \\r in the delivered envelope');

    const bridge = listBridgeMessages(root, { fromSessionId: sender.sessionId, toSessionId: target.sessionId });
    assert.equal(bridge.entries.length, 1);
    assert.equal(bridge.entries[0].data.replace(/\r$/, ''), 'STRUCTURED_E2', 'bridge data stays the plain text body');
  });
});
