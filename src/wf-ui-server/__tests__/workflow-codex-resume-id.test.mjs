// workflow-codex-resume-id.test.mjs
//
// Codex resume fix: codex keys its saved sessions by an internal rollout UUID
// (e.g. `Session 019ffa1b-...`), not by the harness session id — `codex resume
// <harnessSessionId>` exits 1. The codex TUI never prints the UUID to the PTY
// (verified against real sessions), so the primary capture source is codex's
// sessions dir with the REAL nested per-day layout:
// `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<timestamp>-<uuid>.jsonl`
// (a flat readdir would never see these files). These tests cover:
//
//   T1 — FS capture: a NEW rollout-*.jsonl file appearing after spawn in the
//     nested layout yields the rollout id from its filename; pre-spawn
//     (baseline) files are ignored and the capture fires only once.
//   T2 — FS capture: rollout files that existed before spawn never fire, and
//     the capture expires after the window.
//   T3 — FS capture: no new file within the (env-overridable) window → no
//     event; filename parsing unit checks.
//   T3d — Recursive walk: the baseline snapshot sees nested rollout files and
//     the fs existence check only confirms real rollout uuids.
//   T4 — resolveRuntimeResumeArgs unit: codex with agentSessionId absent and a
//     captured codexRolloutId resumes that rollout id (codexRolloutId wins over
//     the harness-tracked id).
//   T5 — Server integration: the capture event persists codexRolloutId on the
//     session record (registry + STATE.json + event), and a subsequent
//     agent.start on the bound node resumes the captured rollout id instead of
//     the harness session id.
//   T6 — PTY scanner anti-false-positive: a uuid on a resume error line
//     (`No saved session found with ID <harness-uuid>`) with NO matching
//     rollout file never fires; once a matching nested rollout file exists,
//     the same scanner does fire with the confirmed uuid.
//
// Pattern: in-process node:test + HTTP server on port 0, temp roots, a fake
// PTY via a pty-adapter.mjs fixture (registerHooks, same as
// workflow-depth-resume-dock.test.mjs) that emits the codex:rollout-id control
// request the real capture would emit, and a stub `codex` executable on PATH
// so POST /api/sessions reaches the spawn branch.
import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { SessionRegistry } from '../session-registry.mjs';
import { persistSession, listTerminalSessions } from '../terminal-store.mjs';
import { loadWorkflowGraphMap, writeWorkflowGraphMap } from '../a2a-store.mjs';
import {
  createCodexRolloutFsCapture,
  createCodexRolloutIdDetector,
  CODEX_ROLLOUT_FS_CAPTURE_WINDOW_MS,
  codexSessionsDir,
  extractRolloutIdFromFilename,
  rolloutIdExistsInSessionsDir,
  snapshotRolloutFilenames,
} from '../pty-adapter.mjs';
import { resolveRuntimeResumeArgs } from '../runtime-detector.mjs';

// ── pty-adapter fixture ─────────────────────────────────────────────────────
// Replaces pty-adapter.mjs for server.mjs: spawnPty records the spawn opts and
// emits the codex:rollout-id control request the real capture would emit for a
// codex session whose rollout file appeared in the sessions dir.
const FAKE_ROLLOUT_ID = '019ffa1b-1234-5678-9abc-def012345678';
const FIXTURE_SOURCE = [
  '// Test fixture replacing pty-adapter.mjs (workflow-codex-resume-id.test.mjs).',
  'const recorder = {',
  '  spawnOpts: [],',
  '  reset() { this.spawnOpts.length = 0; },',
  '};',
  'export async function spawnPty(opts) {',
  '  recorder.spawnOpts.push(opts);',
  `  if (opts.runtime === "codex" && typeof opts.onControlRequest === "function") {`,
  '    opts.onControlRequest({',
  '      reason: "codex-rollout-id-detected",',
  '      type: "codex:rollout-id",',
  `      payload: { rolloutId: "${FAKE_ROLLOUT_ID}" },`,
  '    });',
  '  }',
  '  const ptyProcess = {',
  '    pid: 43200 + recorder.spawnOpts.length,',
  '    write() {},',
  '    kill() {},',
  '    onData() {},',
  '    onExit() {},',
  '  };',
  '  return { sessionId: opts.sessionId, pid: ptyProcess.pid, ptyProcess, ptyProvider: "test-fixture" };',
  '}',
  'export { recorder };',
].join('\n');

const fixtureDir = makeHarnessTempRoot('wf-codex-resume-id-fixture-');
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

const { startServer, stopServer } = await import('../server.mjs');
const { recorder } = await import(fixtureUrl);

// ── runtime stub ────────────────────────────────────────────────────────────
// A stub `codex` on PATH makes createRuntimeSession take the spawn branch so
// spawnPty (the fixture) runs for real in-process.
const ORIGINAL_PATH = process.env.PATH || '';
let runtimeStubDir = '';

before(() => {
  runtimeStubDir = makeHarnessTempRoot('wf-codex-resume-id-runtime-');
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(runtimeStubDir, 'codex.cmd'), '@echo off\r\nrem wf-ui codex resume id test stub\r\n');
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
function jsonRequest(baseUrl, route, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
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

function seedRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

function seedAgent(root, { nodeId, sessionId, agentKind = 'subagent', role = 'Agent', runtime = 'claude', status = 'running' }) {
  const graph = loadWorkflowGraphMap(root);
  const nodes = [
    ...(graph.nodes || []).filter(node => (node.nodeId || node.id) !== nodeId),
    {
      nodeId,
      sessionId,
      kind: 'terminal-session',
      runtime,
      agentKind,
      role,
      label: role,
      status,
    },
  ];
  writeWorkflowGraphMap(root, {
    schemaVersion: 1,
    version: 1,
    nodes,
    edges: [],
    capsuleDockLinks: [],
    positions: Object.fromEntries(nodes.map(node => [node.nodeId, { x: 0, y: 0 }])),
  });
  persistSession(root, {
    sessionId,
    graphNodeId: nodeId,
    runtime,
    agentKind,
    role,
    status,
    attachMode: true,
    taskId: null,
  });
}

function readSessionEvents(root, sessionId) {
  const dirs = ['Harness', 'a2a', 'sessions', sessionId];
  const eventsPath = path.join(root, ...dirs, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return [];
  return fs.readFileSync(eventsPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

// ── fs-capture helpers ──
// Real codex filename shape: rollout-<dash-separated timestamp>-<uuid>.jsonl
function rolloutFilename(uuid, stamp = '2026-08-13T16-21-24') {
  return `rollout-${stamp}-${uuid}.jsonl`;
}

// Real codex layout: sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<uuid>.jsonl —
// the timestamp in the name also selects the per-day directory.
function rolloutDir(sessionsDir, stamp) {
  const [date] = String(stamp).split('T');
  const [y, m, d] = date.split('-');
  return path.join(sessionsDir, y, m, d);
}

function writeRolloutFile(sessionsDir, uuid, stamp = '2026-08-13T16-21-24') {
  const dir = rolloutDir(sessionsDir, stamp);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, rolloutFilename(uuid, stamp)), '');
}

function waitForEvent(capture, events, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    while (events.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  })();
}

describe('codex resume id (rollout UUID capture + mapping)', () => {
  let root;
  let registry;
  let server;
  let baseUrl;

  beforeEach(async () => {
    recorder.reset();
    root = seedRoot('wf-cri-');
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
    if (server) {
      await stopServer(server);
      server = null;
    }
    if (root) {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      root = null;
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // T1 — fs capture: new rollout file after spawn fires its UUID once
  // ══════════════════════════════════════════════════════════════════
  it('T1 - fires with the UUID of a NEW rollout file (nested layout); baseline files ignored; fires once', async () => {
    const sessionsDir = makeHarnessTempRoot('wf-cri-fs-');
    try {
      // Pre-existing rollout file in its per-day dir (written before spawn) → baseline.
      writeRolloutFile(sessionsDir, '11111111-2222-3333-4444-555555555555', '2026-07-01T08-00-00');
      const events = [];
      const capture = createCodexRolloutFsCapture({
        sessionsDir,
        baselineFiles: snapshotRolloutFilenames(sessionsDir),
        spawnTime: Date.now(),
        windowMs: 5000,
        pollMs: 25,
        onControlRequest: event => events.push(event),
      });
      capture.start();
      assert.equal(capture.active, true, 'capture must be active before a new file appears');

      // codex writes its new rollout file shortly after spawn, nested under
      // today's YYYY/MM/DD dir — a flat readdir would never see it.
      writeRolloutFile(sessionsDir, FAKE_ROLLOUT_ID);
      await waitForEvent(capture, events);

      assert.equal(events.length, 1, `fs capture must fire exactly once, got: ${JSON.stringify(events)}`);
      assert.equal(events[0].type, 'codex:rollout-id');
      assert.equal(events[0].reason, 'codex-rollout-id-detected');
      assert.deepEqual(events[0].payload, { rolloutId: FAKE_ROLLOUT_ID },
        'must carry the NEW file uuid, not the pre-spawn baseline uuid');
      assert.equal(capture.rolloutId, FAKE_ROLLOUT_ID);
      assert.equal(capture.active, false, 'capture must stop after firing');

      // A second new file must not refire.
      writeRolloutFile(sessionsDir, '66666666-7777-8888-9999-000000000000', '2026-08-13T17-00-00');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(events.length, 1, 'must fire only once');
    } finally {
      fs.rmSync(sessionsDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // T2 — fs capture: pre-spawn files never fire; capture expires
  // ══════════════════════════════════════════════════════════════════
  it('T2 - rollout files present pre-spawn (nested layout) are ignored and the capture expires', async () => {
    const sessionsDir = makeHarnessTempRoot('wf-cri-fs-');
    try {
      // Files that exist before spawn (baseline) and a name without a UUID
      // must never trigger the capture — including nested ones.
      writeRolloutFile(sessionsDir, FAKE_ROLLOUT_ID, '2026-07-01T08-00-00');
      writeRolloutFile(sessionsDir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '2026-08-12T09-30-00');
      fs.mkdirSync(rolloutDir(sessionsDir, '2026-08-13T00-00-00'), { recursive: true });
      fs.writeFileSync(path.join(rolloutDir(sessionsDir, '2026-08-13T00-00-00'), 'rollout-not-a-uuid.jsonl'), '');
      const events = [];
      const capture = createCodexRolloutFsCapture({
        sessionsDir,
        baselineFiles: snapshotRolloutFilenames(sessionsDir),
        spawnTime: Date.now(),
        windowMs: 250,
        pollMs: 25,
        onControlRequest: event => events.push(event),
      });
      capture.start();
      await new Promise(resolve => setTimeout(resolve, 400));

      assert.deepEqual(events, [], 'pre-spawn rollout files must never fire');
      assert.equal(capture.rolloutId, null);
      assert.equal(capture.active, false, 'capture must expire after the window');
    } finally {
      fs.rmSync(sessionsDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // T3 — fs capture: no new file within the window → no event; env override
  // ══════════════════════════════════════════════════════════════════
  it('T3 - no new rollout file within the window → no event (env-overridable window)', async () => {
    const sessionsDir = makeHarnessTempRoot('wf-cri-fs-');
    const prevWindow = process.env.CODEX_ROLLOUT_FS_CAPTURE_WINDOW_MS;
    process.env.CODEX_ROLLOUT_FS_CAPTURE_WINDOW_MS = '200';
    try {
      const events = [];
      const capture = createCodexRolloutFsCapture({
        sessionsDir,
        baselineFiles: snapshotRolloutFilenames(sessionsDir),
        spawnTime: Date.now(),
        pollMs: 25,
        onControlRequest: event => events.push(event),
      });
      capture.start();
      await new Promise(resolve => setTimeout(resolve, 350));

      assert.deepEqual(events, [], 'no new rollout file → no event');
      assert.equal(capture.rolloutId, null);
      assert.equal(capture.active, false, 'capture must expire after the window');
    } finally {
      if (prevWindow === undefined) {
        delete process.env.CODEX_ROLLOUT_FS_CAPTURE_WINDOW_MS;
      } else {
        process.env.CODEX_ROLLOUT_FS_CAPTURE_WINDOW_MS = prevWindow;
      }
      fs.rmSync(sessionsDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // T3b — filename parsing + sessions dir resolution + default window
  // ══════════════════════════════════════════════════════════════════
  it('T3b - parses the uuid segment from real codex rollout filenames', () => {
    assert.equal(
      extractRolloutIdFromFilename('rollout-2026-08-13T16-21-24-019ffa36-34a1-7923-ab6b-c66732a1e06e.jsonl'),
      '019ffa36-34a1-7923-ab6b-c66732a1e06e',
      'real codex rollout filename must yield its uuid',
    );
    assert.equal(extractRolloutIdFromFilename(rolloutFilename(FAKE_ROLLOUT_ID)), FAKE_ROLLOUT_ID);
    assert.equal(extractRolloutIdFromFilename('rollout-2026-08-13T16-21-24.jsonl'), null, 'missing uuid segment');
    assert.equal(extractRolloutIdFromFilename('rollout-not-a-uuid.jsonl'), null);
    assert.equal(extractRolloutIdFromFilename('session_meta.jsonl'), null);
    assert.equal(extractRolloutIdFromFilename(''), null);
  });

  it('T3c - codex sessions dir resolves CODEX_HOME or ~/.codex; default window is positive', () => {
    const prevHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join('C:', 'fake-codex-home');
    try {
      assert.equal(codexSessionsDir(), path.join('C:', 'fake-codex-home', 'sessions'));
    } finally {
      if (prevHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prevHome;
      }
    }
    assert.equal(codexSessionsDir(), path.join(os.homedir(), '.codex', 'sessions'));
    assert.ok(CODEX_ROLLOUT_FS_CAPTURE_WINDOW_MS > 0, 'default capture window must be positive');
  });

  // ══════════════════════════════════════════════════════════════════
  // T3d — recursive walk: nested rollout files are visible to the baseline
  //      snapshot and the fs existence check
  // ══════════════════════════════════════════════════════════════════
  it('T3d - baseline snapshot and existence check see nested rollout files only', () => {
    const sessionsDir = makeHarnessTempRoot('wf-cri-snap-');
    try {
      writeRolloutFile(sessionsDir, FAKE_ROLLOUT_ID, '2026-08-13T16-21-24');
      // Non-rollout files (nested and flat) must never appear in the snapshot.
      fs.writeFileSync(path.join(rolloutDir(sessionsDir, '2026-08-13T16-21-24'), 'session_meta.jsonl'), '');
      fs.writeFileSync(path.join(sessionsDir, 'other.jsonl'), '');

      const snapshot = snapshotRolloutFilenames(sessionsDir);
      assert.equal(snapshot.size, 1, 'only rollout-*.jsonl files count, nested or not');
      assert.deepEqual([...snapshot], [
        '2026/08/13/rollout-2026-08-13T16-21-24-019ffa1b-1234-5678-9abc-def012345678.jsonl',
      ], 'relative posix path into the YYYY/MM/DD layout');

      assert.equal(rolloutIdExistsInSessionsDir(sessionsDir, FAKE_ROLLOUT_ID), true,
        'a uuid with a nested rollout file must be confirmed');
      assert.equal(rolloutIdExistsInSessionsDir(sessionsDir, '00000000-0000-0000-0000-000000000000'), false,
        'a uuid with no rollout file anywhere must not be confirmed');
      assert.equal(rolloutIdExistsInSessionsDir(sessionsDir, ''), false);
      assert.equal(rolloutIdExistsInSessionsDir(sessionsDir, null), false);
    } finally {
      fs.rmSync(sessionsDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // T4 — resume arg resolution prefers the codex rollout id
  // ══════════════════════════════════════════════════════════════════
  it('T4 - codex resume args use the captured rollout id over the harness session id', () => {
    assert.deepEqual(
      resolveRuntimeResumeArgs('codex', { agentSessionId: null, codexRolloutId: FAKE_ROLLOUT_ID }),
      ['resume', FAKE_ROLLOUT_ID],
      'codex with agentSessionId absent must resume the captured rollout id',
    );
    assert.deepEqual(
      resolveRuntimeResumeArgs('codex', { agentSessionId: 'harness-session-1', codexRolloutId: FAKE_ROLLOUT_ID }),
      ['resume', FAKE_ROLLOUT_ID],
      'codexRolloutId must win over the harness-tracked agentSessionId',
    );
    assert.deepEqual(
      resolveRuntimeResumeArgs('codex', { agentSessionId: 'harness-session-1' }),
      ['resume', 'harness-session-1'],
      'without a rollout id the harness id is used unchanged',
    );
    assert.deepEqual(resolveRuntimeResumeArgs('codex', {}), ['resume', '--last']);
    // Other runtimes are unaffected by the new option.
    assert.deepEqual(
      resolveRuntimeResumeArgs('claude', { agentSessionId: 's1', codexRolloutId: FAKE_ROLLOUT_ID }),
      ['--resume', 's1'],
    );
    assert.deepEqual(
      resolveRuntimeResumeArgs('opencode', { agentSessionId: 's1', codexRolloutId: FAKE_ROLLOUT_ID }),
      ['--session', 's1'],
    );
  });

  // ══════════════════════════════════════════════════════════════════
  // T5 — server integration: capture persists on the session record and
  //      drives the resume mapping
  // ══════════════════════════════════════════════════════════════════
  it('T5 - capture event persists codexRolloutId; agent.start resumes it', async () => {
    const created = await jsonRequest(baseUrl, '/api/sessions', {
      method: 'POST',
      body: { runtime: 'codex', agentKind: 'subagent', attachGraphNode: false },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const sessionId = created.body.sessionId;
    assert.ok(sessionId, 'session must be created');
    assert.equal(created.body.codexRolloutId, FAKE_ROLLOUT_ID, 'response session must carry the captured rollout id');

    // Registry record.
    const live = registry.get(sessionId);
    assert.ok(live, 'session must be in the registry');
    assert.equal(live.codexRolloutId, FAKE_ROLLOUT_ID);
    assert.equal(live.agentSessionId, FAKE_ROLLOUT_ID, 'agentSessionId must mirror the rollout id for resume metadata');

    // Persisted STATE.json record.
    const persisted = listTerminalSessions(root).find(session => session.sessionId === sessionId);
    assert.ok(persisted, 'session must be persisted');
    assert.equal(persisted.codexRolloutId, FAKE_ROLLOUT_ID, 'STATE.json must persist codexRolloutId');
    assert.equal(persisted.agentSessionId, FAKE_ROLLOUT_ID);

    // Session event.
    const events = readSessionEvents(root, sessionId);
    assert.ok(events.some(event => event.type === 'codex.rollout-id.captured' && event.codexRolloutId === FAKE_ROLLOUT_ID),
      `expected codex.rollout-id.captured event, got: ${JSON.stringify(events)}`);

    // Now bind the captured session to a graph node as a previous (exited)
    // session and start the node: resume must target the rollout id, not the
    // harness session id.
    registry.remove(sessionId);
    seedAgent(root, {
      nodeId: 't5-main',
      sessionId,
      runtime: 'codex',
      agentKind: 'main',
      role: 'Main Agent',
      status: 'exited',
    });
    const resumed = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent('t5-main')}/actions/agent.start`, {
      method: 'POST',
      body: { deferPtySpawn: true },
    });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.result.resumeUsed, true);
    assert.deepEqual(resumed.body.result.resumeArgs, ['resume', FAKE_ROLLOUT_ID],
      `codex resume must target the captured rollout id, got: ${JSON.stringify(resumed.body.result.resumeArgs)}`);
    assert.notEqual(resumed.body.result.resumeArgs[1], sessionId, 'harness session id must not be used for codex resume');
  });

  // ══════════════════════════════════════════════════════════════════
  // T6 — PTY scanner anti-false-positive: a uuid on a resume error line
  //      never fires without a matching rollout file in the sessions dir;
  //      once the fs confirms the uuid, the same scanner does fire
  // ══════════════════════════════════════════════════════════════════
  it('T6 - PTY scanner ignores a uuid with no matching rollout file; fires only on fs confirmation', () => {
    const sessionsDir = makeHarnessTempRoot('wf-cri-pty-');
    try {
      const detector = createCodexRolloutIdDetector({ sessionsDir });

      // `codex resume <harnessSessionId>` fails with this line — the uuid is
      // the HARNESS session id, which never matches a real rollout file, so
      // it must not fire (and must not poison the persisted rollout id).
      const errorLine = `codex: error: No saved session found with ID ${FAKE_ROLLOUT_ID}`;
      assert.equal(detector.observe(errorLine), null, 'error-line harness uuid must never fire without an fs match');
      assert.equal(detector.rolloutId, null, 'detector must stay uncaptured');
      assert.equal(detector.active, true, 'detector must keep scanning after an unmatched uuid');

      // A real rollout file (nested layout) confirms a REAL uuid, so the same
      // scanner now fires for it.
      const realId = '019ffa36-34a1-7923-ab6b-c66732a1e06e';
      writeRolloutFile(sessionsDir, realId, '2026-08-13T16-21-24');
      const request = detector.observe(`Session ${realId} resumed`);
      assert.ok(request, 'a PTY uuid with a matching nested rollout file must fire');
      assert.equal(request.type, 'codex:rollout-id');
      assert.equal(request.reason, 'codex-rollout-id-detected');
      assert.deepEqual(request.payload, { rolloutId: realId });
      assert.equal(detector.rolloutId, realId);
    } finally {
      fs.rmSync(sessionsDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
