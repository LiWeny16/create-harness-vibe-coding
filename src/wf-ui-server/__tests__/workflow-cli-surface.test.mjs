// Workflow CLI surface tests (wf-ui-control.mjs).
//
// Proves the machine-readable command registry (`help --json`) and the
// send-key keystroke primitive. Each test spawns a genuine
// `node Harness/scripts/wf-ui-control.mjs <command>` subprocess against a
// copied CLI script, so it exercises exactly what an Agent node would run.
// Help/registry tests need no backend; send-key posts to a local recording
// HTTP server that captures the request bodies.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';

// ── CLI runner ──────────────────────────────────────────────────────────────

// Spawn a real `node Harness/scripts/wf-ui-control.mjs <command>` process.
// Resolves with { status, stdout, stderr }; stdout is the parsed JSON object
// when the CLI printed JSON, otherwise the raw string (e.g. help text).
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
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      let parsed = stdout.trim();
      try {
        parsed = JSON.parse(parsed);
      } catch {
        // Non-JSON output (e.g. help text) is left as the raw string.
      }
      resolve({ status, stdout: parsed, stderr });
    });
  });
}

// ── Fixtures ────────────────────────────────────────────────────────────────

let tempRoot;

// Identity environment every spawned Agent CLI runs with: the actor is a
// Main Agent node, so the CLI main-agent gates (assertMainAgent) pass.
const AGENT_ENV = { HARNESS_AGENT_KIND: 'main' };

before(() => {
  tempRoot = makeHarnessTempRoot('wf-cli-surface-');
  const dest = path.join(tempRoot, 'Harness', 'scripts', 'wf-ui-control.mjs');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs'), dest);
});

after(() => {
  if (!tempRoot) return;
  const resolved = path.resolve(tempRoot);
  const tempRootDir = path.resolve('Harness', '.temp') + path.sep;
  assert.ok(resolved.startsWith(tempRootDir), `refusing to remove non-temp root: ${resolved}`);
  try {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 });
  } catch (e) {
    // Windows may briefly hold session files after server close; tolerate.
    if (process.platform === 'win32' && ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(e?.code)) return;
    throw e;
  }
});

// ── T1: help --json dumps the full machine-readable registry ───────────────

describe('help --json registry', () => {
  it('prints a valid JSON registry with the core commands and their flags', async () => {
    const result = await runWfUi(['help', '--json'], { cwd: tempRoot });
    assert.equal(result.status, 0, `help --json failed: ${result.stderr}`);
    assert.ok(result.stdout && typeof result.stdout === 'object', `non-JSON stdout: ${result.stdout}`);
    assert.ok(Array.isArray(result.stdout.commands), 'must return a commands array');

    const byName = new Map(result.stdout.commands.map(entry => [entry.name, entry]));
    for (const required of ['create-agent', 'send-input', 'send-agent-message', 'send-key']) {
      const entry = byName.get(required);
      assert.ok(entry, `commands must include ${required}: ${result.stdout.commands.map(c => c.name).join(', ')}`);
      assert.ok(typeof entry.summary === 'string' && entry.summary.length > 0, `${required} must carry a summary`);
      assert.ok(Array.isArray(entry.aliases), `${required} must carry an aliases array`);
      assert.ok(Array.isArray(entry.flags), `${required} must carry a flags array`);
    }

    const createAgent = byName.get('create-agent');
    assert.ok(
      createAgent.flags.some(flag => flag.flag === 'initial-prompt'),
      'create-agent must list the initial-prompt flag',
    );
  });
});

// ── T2: help <command> --json prints one command entry ─────────────────────

describe('help <command> --json', () => {
  it('prints a single command entry with flags', async () => {
    const result = await runWfUi(['help', 'send-input', '--json'], { cwd: tempRoot });
    assert.equal(result.status, 0, `help send-input --json failed: ${result.stderr}`);
    assert.equal(result.stdout.name, 'send-input');
    assert.ok(typeof result.stdout.summary === 'string' && result.stdout.summary.length > 0, 'entry must carry a summary');
    assert.ok(Array.isArray(result.stdout.flags), 'entry must carry flags');
    assert.ok(result.stdout.flags.some(flag => flag.flag === 'session'), 'send-input must list the session flag');
    assert.ok(result.stdout.flags.some(flag => flag.flag === 'text'), 'send-input must list the text flag');
  });
});

// ── T3: plain-text help parity (no regression) ──────────────────────────────

describe('plain help parity', () => {
  it('create-agent --help still lists --initial-prompt', async () => {
    const result = await runWfUi(['create-agent', '--help'], { cwd: tempRoot });
    assert.equal(result.status, 0, `create-agent --help failed: ${result.stderr}`);
    const text = String(result.stdout);
    assert.match(text, /Usage: wf-ui-control\.mjs create-agent \[flags\]/);
    assert.match(text, /--initial-prompt/, 'create-agent help must still show --initial-prompt');
  });
});

// ── T4: send-key keystroke primitive ───────────────────────────────────────

describe('send-key keystroke primitive', () => {
  it('maps named keys to raw bytes posted to the session input endpoint', async () => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { /* record raw */ }
        requests.push({ method: req.method, url: req.url, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const expectMap = {
      up: '\x1b[A',
      down: '\x1b[B',
      enter: '\r',
      esc: '\x1b',
      backspace: '\x7f',
    };
    try {
      for (const [key, expected] of Object.entries(expectMap)) {
        const result = await runWfUi(
          ['send-key', key, '--session', 'sess-live-1', '--url', baseUrl],
          { cwd: tempRoot, env: AGENT_ENV },
        );
        assert.equal(result.status, 0, `send-key ${key} failed: ${result.stderr}`);
        const last = requests[requests.length - 1];
        assert.equal(last.method, 'POST', `${key}: must POST to the input endpoint`);
        assert.equal(last.url, '/api/sessions/sess-live-1/input', `${key}: must target the session input endpoint`);
        assert.equal(last.body.data, expected, `${key}: raw data bytes must match the terminal mapping`);
        assert.equal(last.body.raw, true, `${key}: raw flag must be true`);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
