// Independent black-box release checks for normal create-agent dispatch
// mapping and --project path anchoring (AC-05/AC-07).
import test, { after, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { makeHarnessTempRoot, rmHarnessTempRootRobust } from './support/temp-root.js';
import { SessionRegistry } from '../src/wf-ui-server/session-registry.mjs';

const repoRoot = path.resolve('.');
const controlCli = path.join(repoRoot, 'Harness', 'scripts', 'wf-ui-control.mjs');
const fixtureDir = path.join(repoRoot, 'tests', 'fixtures', 'runtime-092');
const fixtureUrl = pathToFileURL(path.join(fixtureDir, 'pty-adapter.mjs')).href;
const originalPath = process.env.PATH || '';
const taskId = 'task-runtime-release-cli-092';
const model = 'gpt-5.6-luna';
const effort = 'xhigh';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './pty-adapter.mjs'
      && String(context.parentURL || '').endsWith('/src/wf-ui-server/server.mjs')) {
      return { url: fixtureUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { startServer, stopServer } = await import('../src/wf-ui-server/server.mjs');
const { recorder } = await import(fixtureUrl);

let targetRoot;
let callerRoot;
let server;
let baseUrl;
let registry;

function writeTargetFixture(projectRoot) {
  const taskRoot = path.join(projectRoot, 'Harness', 'tasks', taskId);
  fs.mkdirSync(taskRoot, { recursive: true });
  fs.writeFileSync(path.join(taskRoot, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    mode: 'wf',
    title: 'Runtime release CLI project fixture',
    nextAction: 'Exercise dispatch',
    phase: 'implement',
    acceptance: [],
    planItems: [],
    links: { dependsOn: [], blocks: [], related: [] },
  }, null, 2));
  fs.writeFileSync(path.join(taskRoot, 'PLAN.md'), '# Plan\n');
  fs.writeFileSync(path.join(taskRoot, 'PROGRESS.md'), '# Progress\n');
  fs.writeFileSync(path.join(projectRoot, 'Harness', 'context-pack.md'),
    'TARGET_CONTEXT_PACK_SENTINEL_092\n', 'utf8');
}

function runCli(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [controlCli, ...args], {
      cwd,
      env: { ...process.env, HARNESS_AGENT_KIND: 'main' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`wf-ui-control timeout: ${args.join(' ')}`));
    }, 15_000);
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

function commonArgs(dispatchId, overrides = []) {
  return [
    'create-agent',
    '--project', targetRoot,
    '--url', baseUrl,
    '--actor-kind', 'main',
    '--agent-kind', 'subagent',
    '--role', 'verifier',
    '--runtime', 'codex',
    '--model', model,
    '--objective', 'CLI_FIELD_MAPPING_OBJECTIVE_092',
    '--initial-prompt', 'CLI_FIELD_MAPPING_PROMPT_092',
    '--dispatch-id', dispatchId,
    '--task', taskId,
    '--effort', effort,
    '--transport', 'pty',
    '--context-pack-path', 'Harness/context-pack.md',
    '--context-refs', '[{"nodeId":"target-context-node-092"}]',
    '--request-id', 'request-runtime-release-cli-092',
    '--reply-to', 'reply-runtime-release-cli-092',
    ...overrides,
  ];
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
  targetRoot = makeHarnessTempRoot('verify-runtime-release-cli-target-');
  callerRoot = makeHarnessTempRoot('verify-runtime-release-cli-caller-');
  writeTargetFixture(targetRoot);
  recorder.reset();
  registry = new SessionRegistry();
  const started = await startServer({
    projectRoot: targetRoot,
    host: '127.0.0.1',
    port: 0,
    sessionRegistry: registry,
    eventsWs: false,
    chatWs: false,
    modelCapabilityProbe: ({ runtime, model: requestedModel, effort: requestedEffort, projectRoot }) => ({
      status: runtime === 'codex' && requestedModel === model && requestedEffort === effort ? 'supported' : 'unsupported',
      sourceKind: 'test-authoritative-catalog',
      verificationLevel: 'authoritative',
      complete: true,
      model: requestedModel,
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
  for (const root of [callerRoot, targetRoot]) {
    if (!root) continue;
    const resolved = path.resolve(root);
    const allowed = path.resolve('Harness', '.temp') + path.sep;
    assert.ok(resolved.startsWith(allowed), `refusing to remove non-temp root: ${root}`);
    await rmHarnessTempRootRobust(resolved);
  }
  callerRoot = null;
  targetRoot = null;
});

test('AC-05/AC-07 normal create-agent maps every dispatch CLI field to session and worker', async () => {
  const result = await runCli(targetRoot, commonArgs('dispatch-runtime-release-cli-fields-092'));
  assert.equal(result.status, 0, `create-agent CLI failed: ${result.stderr}`);
  assert.equal(result.stdout?.ok, true, JSON.stringify(result.stdout));
  assert.deepEqual(result.stdout?.requested, {
    runtime: 'codex', model, effort, transport: 'pty',
  });
  assert.equal(result.stdout.dispatchId, 'dispatch-runtime-release-cli-fields-092');
  assert.equal(result.stdout.replayed, false);
  const session = registry.get(result.stdout.sessionId);
  assert.ok(session, 'CLI dispatch must create a registry session');
  assert.deepEqual({
    dispatchId: session.dispatchId,
    taskId: session.taskId,
    runtime: session.runtime,
    model: session.model,
    effort: session.effort,
    transport: session.transport,
    role: session.role,
    objective: session.objective,
    dispatchRequestId: session.dispatchRequestId,
    dispatchReplyTo: session.dispatchReplyTo,
    contextRefs: session.contextRefs,
    projectRoot: session.projectRoot,
    cwd: session.cwd,
  }, {
    dispatchId: 'dispatch-runtime-release-cli-fields-092',
    taskId,
    runtime: 'codex',
    model,
    effort,
    transport: 'pty',
    role: 'verifier',
    objective: 'CLI_FIELD_MAPPING_OBJECTIVE_092',
    dispatchRequestId: 'request-runtime-release-cli-092',
    dispatchReplyTo: 'reply-runtime-release-cli-092',
    contextRefs: [{ nodeId: 'target-context-node-092' }],
    projectRoot: targetRoot,
    cwd: targetRoot,
  });
  const worker = recorder.calls[0]?.options;
  assert.equal(worker.runtime, 'codex');
  assert.equal(worker.taskId, taskId);
  assert.equal(worker.model, model);
  assert.equal(worker.projectRoot, targetRoot);
  assert.equal(worker.cwd, targetRoot);
  assert.equal(worker.dispatchId, 'dispatch-runtime-release-cli-fields-092');
  assert.equal(worker.requestId, 'request-runtime-release-cli-092');
  assert.equal(worker.replyTo, 'reply-runtime-release-cli-092');
  assert.match(worker.initialPrompt, /CLI_FIELD_MAPPING_PROMPT_092/);
  assert.match(worker.initialPrompt, /TARGET_CONTEXT_PACK_SENTINEL_092/);
});

test('AC-05/AC-07 --project anchors server root, default worker cwd, and relative context pack across cwd', async () => {
  const result = await runCli(callerRoot, commonArgs('dispatch-runtime-release-cli-project-092'));
  assert.equal(result.status, 0, `create-agent CLI from caller cwd failed: ${result.stderr}`);
  assert.equal(result.stdout?.ok, true, JSON.stringify(result.stdout));
  const session = registry.get(result.stdout.sessionId);
  assert.ok(session, 'target server must own the created session');
  assert.equal(session.projectRoot, targetRoot);
  assert.equal(session.cwd, targetRoot);
  assert.equal(session.contextPackPath, path.join(targetRoot, 'Harness', 'context-pack.md'));
  assert.equal(fs.existsSync(path.join(callerRoot, 'Harness', 'context-pack.md')), false,
    'caller cwd must not be used to resolve the target context pack');
  const worker = recorder.calls[0]?.options;
  assert.equal(worker.projectRoot, targetRoot);
  assert.equal(worker.cwd, targetRoot);
  assert.match(worker.initialPrompt, /TARGET_CONTEXT_PACK_SENTINEL_092/);
});
