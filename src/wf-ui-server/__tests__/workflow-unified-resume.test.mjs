// workflow-unified-resume.test.mjs
//
// Unified resume semantics across claude/codex/opencode — attach-first:
// a running PTY NEVER resumes (agent.start on a live node attaches), resume
// args are passed ONLY after a real stop, and each runtime captures its own
// session id:
//
//   claude   — pre-assign at spawn: `--session-id <uuid>` (harness mints via
//              crypto.randomUUID), persisted on the session record as
//              agentSessionId; resume via `--resume <uuid>`.
//   codex    — rollout UUID captured from the sessions dir; resume via
//              `resume <rolloutId>` (covered in workflow-codex-resume-id).
//   opencode — ses_ row captured from the opencode sqlite db; resume via
//              `--session <ses_...>`.
//
// Tests:
//   U1 — claude spawn args include --session-id <uuid>; the session record
//     (registry + STATE.json) persists the same uuid.
//   U2 — resume trigger: a running PTY attaches (resumeUsed:false, no args);
//     a stopped/exited node with a known per-runtime id resumes with the
//     correct args per runtime (claude --resume uuid / codex resume rollout /
//     opencode --session ses_).
//   U3 — a fresh node (never ran) starts without any resume args.
//   U4 — stop → start flow resumes the pre-assigned claude uuid
//     (in-process harness, real spawn + real stop endpoints).
//   U5 — opencode capture: a NEW ses_ row for the spawn directory fires the
//     control request once (fast env window), baseline rows are ignored.
//   U6 — opencode capture: no new row within the window → no event.
//   U7 — server persists the opencode session id on the capture event
//     (registry + STATE.json + session event).
//   U8 — resolveRuntimeResumeArgs fallbacks when the per-runtime id is
//     absent (claude --continue / opencode --continue / codex resume --last).
//
// Pattern: in-process node:test + HTTP server on port 0, temp roots, a fake
// PTY via a pty-adapter.mjs fixture (registerHooks, same as
// workflow-depth-resume-dock.test.mjs / workflow-codex-resume-id.test.mjs),
// and stub claude/codex/opencode executables on PATH so POST /api/sessions
// reaches the spawn branch.
import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { SessionRegistry } from '../session-registry.mjs';
import { persistSession, listTerminalSessions } from '../terminal-store.mjs';
import { loadWorkflowGraphMap, writeWorkflowGraphMap } from '../a2a-store.mjs';
import {
  createOpencodeSessionIdCapture,
  OPENCODE_SESSION_CAPTURE_WINDOW_MS,
  opencodeDbPath,
  opencodeSessionDirectory,
  queryOpencodeLatestSessionId,
  resolveSpawnArgs,
} from '../pty-adapter.mjs';
import { resolveRuntimeResumeArgs } from '../runtime-detector.mjs';

// ── pty-adapter fixture ─────────────────────────────────────────────────────
// Replaces pty-adapter.mjs for server.mjs: spawnPty records the spawn opts and
// emits the opencode:session-id control request the real sqlite capture would
// emit for an opencode session whose ses_ row appeared in the db.
const FIXTURE_OPENCODE_SESSION_ID = 'ses_fixture_captured_1';
const FIXTURE_SOURCE = [
  '// Test fixture replacing pty-adapter.mjs (workflow-unified-resume.test.mjs).',
  'const recorder = {',
  '  spawnOpts: [],',
  '  reset() { this.spawnOpts.length = 0; },',
  '};',
  'export async function spawnPty(opts) {',
  '  recorder.spawnOpts.push(opts);',
  `  if (opts.runtime === "opencode" && typeof opts.onControlRequest === "function") {`,
  '    opts.onControlRequest({',
  '      reason: "opencode-session-id-detected",',
  '      type: "opencode:session-id",',
  `      payload: { sessionId: "${FIXTURE_OPENCODE_SESSION_ID}" },`,
  '    });',
  '  }',
  '  const ptyProcess = {',
  '    pid: 43300 + recorder.spawnOpts.length,',
  '    write() {},',
  '    kill() {},',
  '    onData() {},',
  '    onExit() {},',
  '  };',
  '  return { sessionId: opts.sessionId, pid: ptyProcess.pid, ptyProcess, ptyProvider: "test-fixture" };',
  '}',
  'export { recorder };',
].join('\n');

const fixtureDir = makeHarnessTempRoot('wf-unified-resume-fixture-');
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

// ── runtime stubs ───────────────────────────────────────────────────────────
// Stub claude/codex/opencode on PATH so createRuntimeSession takes the spawn
// branch and the fixture's spawnPty runs for real in-process.
const ORIGINAL_PATH = process.env.PATH || '';
let runtimeStubDir = '';

before(() => {
  runtimeStubDir = makeHarnessTempRoot('wf-unified-resume-runtime-');
  for (const name of ['claude', 'codex', 'opencode']) {
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(runtimeStubDir, `${name}.cmd`), '@echo off\r\nrem wf-ui unified resume test stub\r\n');
    } else {
      const stub = path.join(runtimeStubDir, name);
      fs.writeFileSync(stub, '#!/bin/sh\n');
      fs.chmodSync(stub, 0o755);
    }
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

function seedAgent(root, { nodeId, sessionId, agentKind = 'subagent', role = 'Agent', runtime = 'claude', status = 'running', agentSessionId, codexRolloutId }) {
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
    ...(agentSessionId ? { agentSessionId } : {}),
    ...(codexRolloutId ? { codexRolloutId } : {}),
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

function waitForEvent(events, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    while (events.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  })();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('unified resume (attach-first, per-runtime session ids)', () => {
  let root;
  let registry;
  let server;
  let baseUrl;

  beforeEach(async () => {
    recorder.reset();
    root = seedRoot('wf-ur-');
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
  // U1 — claude pre-assign: --session-id <uuid> + persisted record
  // ══════════════════════════════════════════════════════════════════
  it('U1 - claude spawn args include --session-id <uuid>; the session record persists the same uuid', async () => {
    const created = await jsonRequest(baseUrl, '/api/sessions', {
      method: 'POST',
      body: { runtime: 'claude', agentKind: 'subagent', attachGraphNode: false },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const sessionId = created.body.sessionId;
    const uuid = created.body.agentSessionId;
    assert.ok(UUID_PATTERN.test(uuid), `claude must pre-assign a uuid, got: ${uuid}`);

    // The adapter received the pre-assigned id and appends it as --session-id.
    const spawned = recorder.spawnOpts.find(entry => entry.sessionId === sessionId);
    assert.ok(spawned, 'spawnPty must have been reached');
    assert.equal(spawned.agentSessionId, uuid, 'adapter opts must carry the pre-assigned id');
    assert.deepEqual(resolveSpawnArgs('claude', { agentSessionId: spawned.agentSessionId }),
      ['--session-id', uuid], 'spawn args must include --session-id <uuid>');

    // Registry record.
    const live = registry.get(sessionId);
    assert.equal(live.agentSessionId, uuid, 'registry record must persist the uuid');

    // Persisted STATE.json record.
    const persisted = listTerminalSessions(root).find(session => session.sessionId === sessionId);
    assert.ok(persisted, 'session must be persisted');
    assert.equal(persisted.agentSessionId, uuid, 'STATE.json must persist the uuid');
  });

  // ══════════════════════════════════════════════════════════════════
  // U2 — resume trigger: live PTY attaches; stopped node resumes per runtime
  // ══════════════════════════════════════════════════════════════════
  it('U2 - a running PTY attaches (resumeUsed:false, no args); a stopped node resumes with the per-runtime id', async () => {
    // Part A: live session → agent.start ATTACHES, never resumes.
    const created = await jsonRequest(baseUrl, '/api/sessions', {
      method: 'POST',
      body: { runtime: 'claude', agentKind: 'subagent', attachGraphNode: true },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const nodeId = `session-${created.body.sessionId}`;
    const attach = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(nodeId)}/actions/agent.start`, {
      method: 'POST',
      body: {},
    });
    assert.equal(attach.status, 200, JSON.stringify(attach.body));
    assert.equal(attach.body.result.alreadyRunning, true, 'live PTY must attach');
    assert.equal(attach.body.result.resumeUsed, false, 'attach must never resume');
    assert.deepEqual(attach.body.result.resumeArgs, [], 'attach must pass no resume args');

    // Part B: stopped/exited nodes with known per-runtime ids resume with the
    // correct args per runtime.
    const CLAUDE_UUID = '00000000-0000-4000-8000-000000000001';
    const CODEX_ROLLOUT = '019ffa1b-1234-5678-9abc-def012345678';
    const OPENCODE_SESSION = 'ses_u2_opencode_1';
    seedAgent(root, { nodeId: 'u2-claude', sessionId: 'u2-c-s1', runtime: 'claude', status: 'exited', agentSessionId: CLAUDE_UUID });
    seedAgent(root, { nodeId: 'u2-codex', sessionId: 'u2-x-s1', runtime: 'codex', status: 'exited', codexRolloutId: CODEX_ROLLOUT });
    seedAgent(root, { nodeId: 'u2-opencode', sessionId: 'u2-o-s1', runtime: 'opencode', status: 'exited', agentSessionId: OPENCODE_SESSION });

    const claude = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent('u2-claude')}/actions/agent.start`, {
      method: 'POST',
      body: { deferPtySpawn: true },
    });
    assert.equal(claude.status, 200, JSON.stringify(claude.body));
    assert.equal(claude.body.result.resumeUsed, true);
    assert.deepEqual(claude.body.result.resumeArgs, ['--resume', CLAUDE_UUID],
      'claude must resume the pre-assigned uuid');

    const codex = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent('u2-codex')}/actions/agent.start`, {
      method: 'POST',
      body: { deferPtySpawn: true },
    });
    assert.equal(codex.status, 200, JSON.stringify(codex.body));
    assert.equal(codex.body.result.resumeUsed, true);
    assert.deepEqual(codex.body.result.resumeArgs, ['resume', CODEX_ROLLOUT],
      'codex must resume the captured rollout id');

    const opencode = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent('u2-opencode')}/actions/agent.start`, {
      method: 'POST',
      body: { deferPtySpawn: true },
    });
    assert.equal(opencode.status, 200, JSON.stringify(opencode.body));
    assert.equal(opencode.body.result.resumeUsed, true);
    assert.deepEqual(opencode.body.result.resumeArgs, ['--session', OPENCODE_SESSION],
      'opencode must resume the captured ses_ id');
  });

  // ══════════════════════════════════════════════════════════════════
  // U3 — fresh node: no resume args
  // ══════════════════════════════════════════════════════════════════
  it('U3 - a fresh node (never ran) starts without resume args', async () => {
    seedAgent(root, { nodeId: 'u3-main', sessionId: 'u3-s1', runtime: 'claude', agentKind: 'main', role: 'Main Agent', status: 'blocked' });
    const res = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent('u3-main')}/actions/agent.start`, {
      method: 'POST',
      body: { deferPtySpawn: true },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.result.alreadyRunning, false);
    assert.equal(res.body.result.resumeUsed, false, 'fresh node must not resume');
    assert.deepEqual(res.body.result.resumeArgs, [], 'fresh node must receive no resume args');
  });

  // ══════════════════════════════════════════════════════════════════
  // U4 — stop → start flow resumes the pre-assigned claude uuid
  // ══════════════════════════════════════════════════════════════════
  it('U4 - stop → start resumes the pre-assigned claude uuid (in-process harness)', async () => {
    const created = await jsonRequest(baseUrl, '/api/sessions', {
      method: 'POST',
      body: { runtime: 'claude', agentKind: 'subagent', attachGraphNode: true },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const sessionId = created.body.sessionId;
    const uuid = created.body.agentSessionId;
    assert.ok(UUID_PATTERN.test(uuid), `claude must pre-assign a uuid, got: ${uuid}`);

    const stopped = await jsonRequest(baseUrl, `/api/sessions/${sessionId}/stop`, { method: 'POST' });
    assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
    assert.equal(stopped.body.stopped.status, 'stopped', 'session must be stopped');

    const started = await jsonRequest(baseUrl, `/api/workflow/nodes/${encodeURIComponent(`session-${sessionId}`)}/actions/agent.start`, {
      method: 'POST',
      body: { deferPtySpawn: true },
    });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.result.alreadyRunning, false);
    assert.equal(started.body.result.resumeUsed, true, 'stop → start must resume');
    assert.deepEqual(started.body.result.resumeArgs, ['--resume', uuid],
      'resume must target the pre-assigned uuid, got: ' + JSON.stringify(started.body.result.resumeArgs));
  });

  // ══════════════════════════════════════════════════════════════════
  // U5 — opencode sqlite capture: NEW ses_ row fires once
  // ══════════════════════════════════════════════════════════════════
  it('U5 - opencode capture fires with a NEW ses_ row; baseline rows ignored; fires once', async () => {
    const dbDir = makeHarnessTempRoot('wf-ur-ocdb-');
    const dbPath = path.join(dbDir, 'opencode.db');
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const seedDb = new DatabaseSync(dbPath);
      seedDb.exec('CREATE TABLE session (id TEXT, directory TEXT, time_created INTEGER)');
      seedDb.prepare('INSERT INTO session (id, directory, time_created) VALUES (?, ?, ?)')
        .run('ses_baseline_1', 'C:/proj/app', 100);
      seedDb.close();

      const directory = 'C:/proj/app';
      const baselineId = queryOpencodeLatestSessionId(dbPath, directory);
      assert.equal(baselineId, 'ses_baseline_1', 'baseline snapshot must read the newest pre-spawn row');

      const events = [];
      const capture = createOpencodeSessionIdCapture({
        dbPath,
        directory,
        baselineId,
        windowMs: 5000,
        pollMs: 25,
        onControlRequest: event => events.push(event),
      });
      capture.start();
      assert.equal(capture.active, true, 'capture must be active before a new row appears');

      // opencode writes its new session row shortly after spawn.
      const writer = new DatabaseSync(dbPath);
      writer.prepare('INSERT INTO session (id, directory, time_created) VALUES (?, ?, ?)')
        .run('ses_new_captured_1', directory, 200);
      writer.close();
      await waitForEvent(events);

      assert.equal(events.length, 1, `capture must fire exactly once, got: ${JSON.stringify(events)}`);
      assert.equal(events[0].type, 'opencode:session-id');
      assert.equal(events[0].reason, 'opencode-session-id-detected');
      assert.deepEqual(events[0].payload, { sessionId: 'ses_new_captured_1' },
        'must carry the NEW row id, not the baseline id');
      assert.equal(capture.sessionId, 'ses_new_captured_1');
      assert.equal(capture.active, false, 'capture must stop after firing');

      // A further row must not refire.
      const writer2 = new DatabaseSync(dbPath);
      writer2.prepare('INSERT INTO session (id, directory, time_created) VALUES (?, ?, ?)')
        .run('ses_later_1', directory, 300);
      writer2.close();
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(events.length, 1, 'capture must fire only once');
    } finally {
      fs.rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // U6 — opencode sqlite capture: no new row within the window → no event
  // ══════════════════════════════════════════════════════════════════
  it('U6 - opencode capture: no new row within the window → no event; capture expires', async () => {
    const dbDir = makeHarnessTempRoot('wf-ur-ocdb-');
    const dbPath = path.join(dbDir, 'opencode.db');
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const seedDb = new DatabaseSync(dbPath);
      seedDb.exec('CREATE TABLE session (id TEXT, directory TEXT, time_created INTEGER)');
      seedDb.prepare('INSERT INTO session (id, directory, time_created) VALUES (?, ?, ?)')
        .run('ses_baseline_2', 'C:/proj/app', 100);
      seedDb.close();

      const directory = 'C:/proj/app';
      const baselineId = queryOpencodeLatestSessionId(dbPath, directory);
      const events = [];
      const capture = createOpencodeSessionIdCapture({
        dbPath,
        directory,
        baselineId,
        windowMs: 250,
        pollMs: 25,
        onControlRequest: event => events.push(event),
      });
      capture.start();
      await new Promise(resolve => setTimeout(resolve, 400));

      assert.deepEqual(events, [], 'no new ses_ row → no event');
      assert.equal(capture.sessionId, null);
      assert.equal(capture.active, false, 'capture must expire after the window');
    } finally {
      fs.rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // U7 — server persists the opencode session id on the capture event
  // ══════════════════════════════════════════════════════════════════
  it('U7 - the capture event persists agentSessionId on the session record', async () => {
    const created = await jsonRequest(baseUrl, '/api/sessions', {
      method: 'POST',
      body: { runtime: 'opencode', agentKind: 'subagent', attachGraphNode: false },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const sessionId = created.body.sessionId;
    assert.equal(created.body.agentSessionId, FIXTURE_OPENCODE_SESSION_ID,
      'response session must carry the captured opencode session id');

    const live = registry.get(sessionId);
    assert.ok(live, 'session must be in the registry');
    assert.equal(live.agentSessionId, FIXTURE_OPENCODE_SESSION_ID);

    const persisted = listTerminalSessions(root).find(session => session.sessionId === sessionId);
    assert.ok(persisted, 'session must be persisted');
    assert.equal(persisted.agentSessionId, FIXTURE_OPENCODE_SESSION_ID, 'STATE.json must persist the id');

    const events = readSessionEvents(root, sessionId);
    assert.ok(events.some(event => event.type === 'opencode.session-id.captured'
      && event.agentSessionId === FIXTURE_OPENCODE_SESSION_ID),
    `expected opencode.session-id.captured event, got: ${JSON.stringify(events)}`);
  });

  // ══════════════════════════════════════════════════════════════════
  // U8 — resolveRuntimeResumeArgs fallbacks when the id is absent
  // ══════════════════════════════════════════════════════════════════
  it('U8 - resolveRuntimeResumeArgs falls back to --continue / resume --last when no id is known', () => {
    assert.deepEqual(resolveRuntimeResumeArgs('claude', {}), ['--continue']);
    assert.deepEqual(resolveRuntimeResumeArgs('claude', { agentSessionId: '00000000-0000-4000-8000-000000000001' }),
      ['--resume', '00000000-0000-4000-8000-000000000001']);
    assert.deepEqual(resolveRuntimeResumeArgs('opencode', {}), ['--continue']);
    assert.deepEqual(resolveRuntimeResumeArgs('opencode', { agentSessionId: 'ses_x' }), ['--session', 'ses_x']);
    assert.deepEqual(resolveRuntimeResumeArgs('codex', {}), ['resume', '--last']);
    assert.deepEqual(resolveRuntimeResumeArgs('codex', { codexRolloutId: 'rollout-1' }), ['resume', 'rollout-1']);
  });

  // ══════════════════════════════════════════════════════════════════
  // Unit checks — opencode db path / directory normalization / window
  // ══════════════════════════════════════════════════════════════════
  it('U9 - opencode db path honors OPENCODE_DB; directory normalizes to forward slashes', () => {
    const prevDb = process.env.OPENCODE_DB;
    process.env.OPENCODE_DB = path.join('C:', 'fake', 'opencode.db');
    try {
      assert.equal(opencodeDbPath(), path.join('C:', 'fake', 'opencode.db'));
    } finally {
      if (prevDb === undefined) delete process.env.OPENCODE_DB;
      else process.env.OPENCODE_DB = prevDb;
    }
    assert.equal(opencodeSessionDirectory('C:\\proj\\app'), 'C:/proj/app');
    assert.equal(opencodeSessionDirectory('/proj/app'), '/proj/app');
    assert.ok(OPENCODE_SESSION_CAPTURE_WINDOW_MS > 0, 'default capture window must be positive');
  });
});
