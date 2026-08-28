// CLI shared-action-registry + manuals tests (wf-ui-control.mjs).
//
// Proves two CLI surface additions:
//  1. `help --json` merges the shared action registry
//     (Harness/a2a/action-registry.json) into its machine-readable output as
//     an `actions` array, and sets `actionsFallback: true` (no `actions` key)
//     when the registry file is absent from the project.
//  2. `manuals <nodeType>` prints the node manual JSON plus generated
//     `id — summary` command lines derived from the registry, and
//     `manuals --list` enumerates the valid manual types.
// T6 asserts the template mirror of the CLI stays byte-identical.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';

const REPO_ROOT = process.cwd();

// Spawn a real `node Harness/scripts/wf-ui-control.mjs <command>` process.
// Resolves with { status, stdout, stderr }; stdout is the parsed JSON object
// when the CLI printed JSON, otherwise the raw string.
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

// Temp project without a Harness/a2a/action-registry.json (used by T2 to
// prove the actionsFallback marker).
before(() => {
  tempRoot = makeHarnessTempRoot('wf-cli-registry-manuals-');
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

// ── T1: help --json merges the shared action registry ───────────────────────

describe('help --json merges the shared action registry', () => {
  it('T1: includes the actions array with agent.sendMessage mapped to its CLI command', async () => {
    const result = await runWfUi(['help', '--json'], { cwd: REPO_ROOT });
    assert.equal(result.status, 0, `help --json failed: ${result.stderr}`);
    assert.ok(result.stdout && typeof result.stdout === 'object', `non-JSON stdout: ${result.stdout}`);
    assert.ok(Array.isArray(result.stdout.commands), 'must return a commands array');
    assert.ok(Array.isArray(result.stdout.actions), 'must return an actions array from the shared registry');
    assert.ok(!('actionsFallback' in result.stdout), 'must not set actionsFallback when the registry is present');

    const sendMessage = result.stdout.actions.find(action => action.id === 'agent.sendMessage');
    assert.ok(sendMessage, `actions must include agent.sendMessage: ${result.stdout.actions.map(a => a.id).join(', ')}`);
    assert.equal(sendMessage.command, 'send-agent-message');
    assert.ok(typeof sendMessage.summary === 'string' && sendMessage.summary.length > 0, 'entry must carry a summary');
    assert.ok(Array.isArray(sendMessage.flags), 'entry must carry a flags array');
  });
});

// ── T2: help --json without a registry file ─────────────────────────────────

describe('help --json without a registry file', () => {
  it('T2: marks actionsFallback and omits the actions key', async () => {
    const result = await runWfUi(['help', '--json', '--project', tempRoot], { cwd: REPO_ROOT });
    assert.equal(result.status, 0, `help --json --project failed: ${result.stderr}`);
    assert.equal(result.stdout.actionsFallback, true, 'must set actionsFallback when the registry is missing');
    assert.ok(!('actions' in result.stdout), 'must omit the actions key when the registry is missing');
    assert.ok(Array.isArray(result.stdout.commands), 'commands must still be present');
  });
});

// ── T3/T4/T5: manuals command ───────────────────────────────────────────────

describe('manuals command', () => {
  it('T3: prints the timer manual and generated command lines', async () => {
    const result = await runWfUi(['manuals', 'timer'], { cwd: REPO_ROOT });
    assert.equal(result.status, 0, `manuals timer failed: ${result.stderr}`);
    assert.ok(result.stdout && typeof result.stdout === 'object', `non-JSON stdout: ${result.stdout}`);
    assert.equal(result.stdout.type, 'timer');
    assert.ok(result.stdout.manual && typeof result.stdout.manual === 'object', 'must carry the full manual');
    assert.match(String(result.stdout.manual.description || ''), /Timer nodes/i, 'must carry the timer manual description');
    assert.ok(Array.isArray(result.stdout.commands), 'must carry a generated commands array');
    assert.ok(
      result.stdout.commands.some(line => line.startsWith('timer.read —')),
      'commands must include a timer.read line',
    );
    assert.ok(
      result.stdout.commands.some(line => line.startsWith('timer.configure —')),
      'commands must include a timer.configure line',
    );
  });

  it('T3b: excalidraw resolves to the diagram manual with excalidraw action lines', async () => {
    const result = await runWfUi(['manuals', 'excalidraw'], { cwd: REPO_ROOT });
    assert.equal(result.status, 0, `manuals excalidraw failed: ${result.stderr}`);
    assert.equal(result.stdout.type, 'diagram', 'excalidraw must resolve to the diagram manual type');
    assert.match(String(result.stdout.manual.description || ''), /Diagram nodes/i, 'must carry the diagram manual description');
    assert.ok(
      result.stdout.commands.some(line => line.startsWith('excalidraw.readScene —')),
      'commands must include excalidraw action lines for the alias',
    );
  });

  it('T4: --list enumerates all manual types including the diagram alias', async () => {
    const result = await runWfUi(['manuals', '--list'], { cwd: REPO_ROOT });
    assert.equal(result.status, 0, `manuals --list failed: ${result.stderr}`);
    assert.ok(Array.isArray(result.stdout.types), 'must return a types array');
    for (const type of ['agent', 'markdown', 'excalidraw', 'file', 'timer', 'goal', 'skill-group', 'mcp-connector', 'github-trigger', 'diagram']) {
      assert.ok(result.stdout.types.includes(type), `types must include ${type}`);
    }
    assert.deepEqual(result.stdout.alias, { excalidraw: 'diagram' });
  });

  it('T5: unknown type fails with a valid-types list and non-zero exit', async () => {
    const result = await runWfUi(['manuals', 'unknown-type'], { cwd: REPO_ROOT });
    assert.notEqual(result.status, 0, 'must exit non-zero for an unknown type');
    assert.match(
      result.stderr,
      /Valid types: agent\|markdown\|excalidraw\|file\|display\|timer\|goal\|skill-group\|mcp-connector\|github-trigger\|diagram/,
    );
  });
});

// ── T6: template mirror parity ──────────────────────────────────────────────

describe('template mirror parity', () => {
  it('T6: the CLI file and its template mirror are byte-identical', () => {
    const cli = fs.readFileSync(path.join(REPO_ROOT, 'Harness', 'scripts', 'wf-ui-control.mjs'));
    const mirror = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'common', 'Harness', 'scripts', 'wf-ui-control.mjs'));
    assert.ok(
      cli.equals(mirror),
      'Harness/scripts/wf-ui-control.mjs and templates/common/Harness/scripts/wf-ui-control.mjs must be byte-identical',
    );
  });
});
