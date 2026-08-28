// workflow-terminal-control-live.test.mjs
//
// AC-CTRL-005 real-terminal probe (OPT-IN).
//
// These tests spawn a REAL codex process through the backend control plane and
// assert that an injected prompt triggers a real AI turn. Each run spends a
// real codex API call and can take minutes, so the whole suite is SKIPPED by
// default.
//
// Enable with:
//   HARNESS_LIVE_TERMINAL_PROBE=1 node --test src/wf-ui-server/__tests__/workflow-terminal-control-live.test.mjs
//
//   L1 - Enter-free trigger (AC-CTRL-002/005): spawn codex with initialPrompt
//        as argv; the codex TUI auto-submits it — zero keyboard injection.
//   L2 - single-\r submit (AC-CTRL-001/005): spawn codex without a prompt,
//        wait for the prompt marker (›/❯), send input with submit:true (body +
//        exactly one \r) and assert a real AI turn starts.
//
// Evidence rule: assertions match terminal-store STDOUT entries ONLY. The
// control plane records injected input as stdin entries, which must never
// satisfy an assertion (previous false positive: L2 matched the text the test
// itself sent). Output growth is likewise not evidence — TUI boot repaints
// were a previous false positive for L1. The expected token must also NOT be
// a substring of the prompt: the codex TUI repaints the typed/argv prompt
// into STDOUT (input-line render + queued-input banner), so substring tokens
// like the old probe-ok / probe-ok2 matched the echo before any AI turn.
// The current tokens (42 / 22) are arithmetic answers that can only come from
// a real AI reply. Sessions are kept alive for a fixed observation window
// after the trigger (a real AI turn takes ~30-90s) and only early-exit when
// the expected reply text renders in STDOUT.
//
// Evidence: the full terminal transcript is written to
// `Harness/.temp/live-terminal-probe-<timestamp>/` and the path is printed.
//
// Note: the deterministic byte-sequence / gating matrix lives in
// workflow-terminal-control.test.mjs; this file only adds real-process proof.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';

const LIVE = process.env.HARNESS_LIVE_TERMINAL_PROBE === '1';

// The marker the codex TUI prints when it is ready for input (› or ❯).
const PROMPT_MARKER_RE = /[›❯]/;

// Observation windows. A real codex AI turn takes ~30-90s, so the probe never
// stops on mere output growth; it keeps the session alive a fixed window after
// the trigger (spawn for L1, input write for L2) and only early-exits when the
// expected reply text actually renders in STDOUT.
const BOOT_WAIT_MS = 45000;        // max wait for TUI boot / prompt marker
const OBSERVE_WINDOW_MS = 100000;  // fixed observation window after trigger
// Per-test timeouts bound the whole suite: worst case L1 + L2 ≈ 5 min.
const L1_TIMEOUT_MS = 150000;
const L2_TIMEOUT_MS = 150000;

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

describe('Live terminal probe (AC-CTRL-005)', { skip: !LIVE }, () => {
  let root;
  let server;
  let baseUrl;
  let registry;
  const spawnedSessions = [];

  before(async () => {
    root = makeHarnessTempRoot('live-terminal-probe-');
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
    console.log(`[live-probe] backend on ${baseUrl}, evidence root ${root}`);
  });

  after(async () => {
    for (const sessionId of spawnedSessions) {
      try {
        await jsonRequest(baseUrl, `/api/sessions/${sessionId}/stop`, { method: 'POST', body: {} });
      } catch { /* already gone */ }
    }
    if (server) {
      await stopServer(server);
      server = null;
    }
    // Hard-exit fallback: the backend server / PTY handles must not keep the
    // runner alive forever (observed hang: process killed at 600s). unref()
    // keeps this timer from blocking a natural exit, and the runner's exit
    // code is preserved so a failed probe still fails the run.
    const exitTimer = setTimeout(() => process.exit(process.exitCode || 0), 5000);
    exitTimer.unref();
    // The temp root is intentionally kept: it holds the probe transcripts.
  });

  // ── helpers ──

  // ANSI control-sequence stripper — same pattern as the production
  // codex-update-prompt.mjs stripTerminalControls (CSI `\x1b[...[@-~]`, OSC
  // `\x1b]...\x07`/`\x1b]...\x1b\`, and \r→\n), kept local so the probe stays
  // self-contained. Raw PTY bytes otherwise carry escape sequences whose
  // parameters can satisfy a substring match (e.g. "42" inside the cursor
  // position `\x1b[20;42H`, "22" inside the SGR `\x1b[22m`), which is a
  // false-positive source for the reply-token match.
  const ANSI_PATTERN = /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~])/g;
  function stripAnsi(value) {
    return String(value || '')
      .replace(ANSI_PATTERN, '')
      .replace(/\r/g, '\n');
  }

  async function createCodexSession(extra = {}) {
    const res = await jsonRequest(baseUrl, '/api/sessions', {
      method: 'POST',
      body: {
        runtime: 'codex',
        agentKind: 'main',
        role: 'Main Agent',
        objective: 'Live terminal probe',
        attachGraphNode: true,
        ...extra,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    spawnedSessions.push(res.body.sessionId);
    if (res.body.status === 'blocked') {
      return { running: false, reason: res.body.blockedReason || res.body.blockedHint || 'blocked' };
    }
    return { running: true, sessionId: res.body.sessionId };
  }

  async function readOutput(sessionId) {
    const res = await jsonRequest(baseUrl, `/api/terminals/${sessionId}/range?tail=4000`);
    return res.body && Array.isArray(res.body.entries) ? res.body : { entries: [] };
  }

  // Real rendered evidence: STDOUT entries only. Terminal-store entries carry
  // a `stream` field; the test's own injected text is recorded as `stdin` and
  // never counts as a reply (L2 false positive: matched its own input echo).
  // ANSI escapes are stripped BEFORE matching — raw bytes contain sequences
  // (cursor positioning, SGR) whose parameters hold the expected token.
  function stdoutText(range) {
    return stripAnsi(
      (range.entries || [])
        .filter(entry => String(entry.stream || 'stdout') === 'stdout')
        .map(entry => String(entry.data || ''))
        .join(''),
    );
  }

  // Full transcript text (stdout + stdin) for the evidence file.
  function fullText(range) {
    return (range.entries || []).map(entry => String(entry.data || '')).join('');
  }

  // Observe a fixed window starting at fromMs. Early-exit ONLY when the
  // expected reply text renders in STDOUT; output growth is never evidence.
  // Returns null when the window elapses without the reply.
  // The match runs on ANSI-stripped text and additionally requires the token
  // NOT to be part of a longer digit run: `(^|\D)<token>(\D|$)`.
  async function waitForReplyText(sessionId, { expectText, fromMs, windowMs }) {
    const deadline = fromMs + windowMs;
    const expectedRe = new RegExp(`(^|\\D)${expectText}(\\D|$)`);
    let last = null;
    while (Date.now() < deadline) {
      last = await readOutput(sessionId);
      if (expectedRe.test(stdoutText(last))) {
        return { evidence: `expected-text:${expectText}`, range: last };
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return null;
  }

  async function saveTranscript(sessionId, range) {
    const dir = path.join(root, 'transcripts');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${sessionId}.txt`);
    const entries = range.entries || [];
    const stdoutCount = entries.filter(entry => String(entry.stream || 'stdout') === 'stdout').length;
    const stdinCount = entries.length - stdoutCount;
    fs.writeFileSync(
      file,
      `session: ${sessionId}\nentries: ${entries.length} (stdout: ${stdoutCount}, stdin: ${stdinCount})\n\n${fullText(range)}`,
      'utf8',
    );
    console.log(`[live-probe] transcript: ${file}`);
    return file;
  }

  // ── L1: Enter-free trigger (AC-CTRL-002/005) ──
  it('L1 - argv initialPrompt auto-submits in a real codex TUI (Enter-free)', async (t) => {
    const spawnTime = Date.now();
    const session = await createCodexSession({
      initialPrompt: 'What is 21 times 2? Reply with the number only, nothing else.',
    });
    if (!session.running) {
      t.skip(`codex not launchable: ${session.reason}`);
      return;
    }
    // Wait for the TUI to boot (any STDOUT output), then observe a fixed
    // window after spawn: the AI reply renders the number 42 in STDOUT.
    // No output-growth shortcut — boot repaints are not AI-turn evidence.
    const bootDeadline = spawnTime + BOOT_WAIT_MS;
    let booted = null;
    while (Date.now() < bootDeadline) {
      booted = await readOutput(session.sessionId);
      if (stdoutText(booted).length > 0) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!booted || stdoutText(booted).length === 0) {
      t.skip('codex TUI produced no output (spawn may be blocked)');
      return;
    }
    const evidence = await waitForReplyText(session.sessionId, {
      expectText: '42',
      fromMs: spawnTime,
      windowMs: OBSERVE_WINDOW_MS,
    });
    await saveTranscript(session.sessionId, evidence ? evidence.range : await readOutput(session.sessionId));
    assert.ok(evidence, `no AI reply rendered in STDOUT within ${OBSERVE_WINDOW_MS}ms of spawn (evidence=${evidence?.evidence || 'none'})`);
    console.log(`[live-probe] L1 evidence: ${evidence.evidence}`);
  }, { timeout: L1_TIMEOUT_MS });

  // ── L2: single-\r submit (AC-CTRL-001/005) ──
  it('L2 - submit:true (single \\r) triggers a real AI turn in a real codex TUI', async (t) => {
    const session = await createCodexSession({});
    if (!session.running) {
      t.skip(`codex not launchable: ${session.reason}`);
      return;
    }
    // Wait for the TUI prompt marker so the ready gate has something to see.
    const markerDeadline = Date.now() + BOOT_WAIT_MS;
    let markerSeen = false;
    while (Date.now() < markerDeadline) {
      const booted = await readOutput(session.sessionId);
      if (PROMPT_MARKER_RE.test(stdoutText(booted))) {
        markerSeen = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!markerSeen) {
      t.skip('codex TUI prompt marker never appeared');
      return;
    }
    const sent = await jsonRequest(baseUrl, `/api/sessions/${session.sessionId}/input`, {
      method: 'POST',
      body: { data: 'What is 17 plus 5? Reply with the number only, nothing else.', submit: true },
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    // Fixed observation window starting at the input write. Only a STDOUT
    // render of the number 22 counts; the stdin record of the injected text
    // does not (see stdoutText).
    const evidence = await waitForReplyText(session.sessionId, {
      expectText: '22',
      fromMs: Date.now(),
      windowMs: OBSERVE_WINDOW_MS,
    });
    await saveTranscript(session.sessionId, evidence ? evidence.range : await readOutput(session.sessionId));
    assert.ok(evidence, `no AI reply rendered in STDOUT within ${OBSERVE_WINDOW_MS}ms of submit (evidence=${evidence?.evidence || 'none'})`);
    console.log(`[live-probe] L2 evidence: ${evidence.evidence}`);
  }, { timeout: L2_TIMEOUT_MS });
});
