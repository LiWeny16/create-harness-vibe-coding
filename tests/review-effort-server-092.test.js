// AC-05 black-box effort handoff review. This file exercises the real
// POST /api/sessions -> capability preflight -> server -> spawnPty boundary
// with a deterministic PTY recorder. No paid provider or inference is used.
import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { makeHarnessTempRoot } from './support/temp-root.js';
import { SessionRegistry } from '../src/wf-ui-server/session-registry.mjs';

const repoRoot = path.resolve('.');
const fixtureDir = path.join(repoRoot, 'tests', 'fixtures', 'runtime-092');
const fixtureUrl = pathToFileURL(path.join(fixtureDir, 'pty-adapter.mjs')).href;
const originalPath = process.env.PATH || '';
const taskId = 'task-review-effort-server-092';
const effort = 'xhigh';
const operatorModel = 'gateway/claude-luna';
const operatorEfforts = ['low', 'high', 'xhigh'];
const OPENCODE_MODEL_FIXTURE = [
  { catalogId: 'opencode/gpt-5.6-luna', model: 'gpt-5.6-luna', effortVariant: 'luna-xhigh-model-variant' },
  { catalogId: 'opencode-go/gpt-5.6-luna', model: 'gpt-5.6-luna', effortVariant: 'luna-xhigh-go-variant' },
];

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
const { recorder, emitExit } = await import(fixtureUrl);

let root;
let server;
let baseUrl;
const roots = new Set();

function jsonRequest(route, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = http.request({
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
    request.once('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function writeTaskState(projectRoot) {
  const taskRoot = path.join(projectRoot, 'Harness', 'tasks', taskId);
  fs.mkdirSync(taskRoot, { recursive: true });
  fs.writeFileSync(path.join(taskRoot, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    mode: 'wf',
    title: 'Effort server review fixture',
    nextAction: 'Review native effort handoff',
    phase: 'verify',
    acceptance: [],
    planItems: [],
    links: { dependsOn: [], blocks: [], related: [] },
  }));
}

function writeSettings(projectRoot, settings) {
  fs.mkdirSync(path.join(projectRoot, 'Harness'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'Harness', 'settings.json'), JSON.stringify(settings, null, 2));
}

function operatorSettings() {
  return {
    schema: 'harness-settings@1',
    ui: { theme: 'dark', language: 'en' },
    cleanup: { stoppedSessionRetentionDays: 14 },
    runtimeCapabilities: {
      claude: {
        models: {
          [operatorModel]: { supportedEfforts: operatorEfforts },
        },
      },
    },
  };
}

async function boot({ settings, modelCapabilityProbe } = {}) {
  root = makeHarnessTempRoot('review-effort-server-092-');
  roots.add(root);
  writeTaskState(root);
  if (settings) writeSettings(root, settings);
  recorder.reset();
  const started = await startServer({
    projectRoot: root,
    host: '127.0.0.1',
    port: 0,
    sessionRegistry: new SessionRegistry(),
    eventsWs: false,
    chatWs: false,
    ...(modelCapabilityProbe ? { modelCapabilityProbe } : {}),
  });
  server = started.server;
  baseUrl = `http://127.0.0.1:${started.port}`;
}

function waitForTurn() {
  return new Promise(resolve => setTimeout(resolve, 50));
}

function dispatchBody({ dispatchId, runtime, model, requestId, replyTo }) {
  return {
    dispatchId,
    taskId,
    runtime,
    model,
    effort,
    transport: 'pty',
    role: 'verifier',
    objective: 'verify effort propagation through the real dispatch boundary',
    initialPrompt: 'deterministic effort handoff fixture',
    requestId,
    replyTo,
    projectRoot: root,
  };
}

function authoritativeProbe({ runtime, model, effort: requestedEffort }) {
  const variant = runtime === 'opencode' ? 'luna-xhigh-model-variant' : undefined;
  return {
    status: 'supported',
    sourceKind: 'test-authoritative-catalog',
    verificationLevel: 'authoritative',
    complete: true,
    model,
    supportedEfforts: [requestedEffort],
    ...(variant ? { effortVariant: variant, catalogModelId: `catalog/${model}` } : {}),
  };
}

function ambiguousOpenCodeProbe({ runtime, model, effort: requestedEffort }) {
  if (runtime !== 'opencode') return authoritativeProbe({ runtime, model, effort: requestedEffort });
  const matches = OPENCODE_MODEL_FIXTURE.filter(entry => entry.model === model || entry.catalogId === model);
  if (!matches.length) {
    return {
      status: 'unsupported',
      sourceKind: 'test-authoritative-opencode-catalog',
      verificationLevel: 'authoritative',
      complete: true,
      model,
      reason: { code: 'MODEL_NOT_IN_AUTHORITATIVE_CATALOG', message: 'The model is absent from the two-provider test catalog.' },
    };
  }
  const exact = matches.find(entry => entry.catalogId === model);
  const selected = exact || matches[0];
  return {
    status: 'supported',
    sourceKind: 'test-authoritative-opencode-catalog',
    verificationLevel: 'authoritative',
    complete: true,
    model,
    supportedEfforts: [requestedEffort],
    effortVariant: selected.effortVariant,
    catalogModelId: selected.catalogId,
    catalogMatches: matches.map(entry => ({ catalogModelId: entry.catalogId, model: entry.model })),
  };
}

before(() => {
  process.env.PATH = `${fixtureDir}${path.delimiter}${originalPath}`;
});

after(() => {
  process.env.PATH = originalPath;
});

afterEach(async () => {
  if (server) await stopServer(server);
  server = null;
  for (const tempRoot of roots) {
    const resolved = path.resolve(tempRoot);
    const allowed = path.resolve('Harness', '.temp') + path.sep;
    assert.ok(resolved.startsWith(allowed), `refusing to remove non-temp root: ${tempRoot}`);
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  roots.clear();
  root = null;
  baseUrl = null;
});

test('AC-05 RED: real dispatch preserves effort and the model-level OpenCode variant on initial spawn and one retry', async () => {
  const cases = [
    { runtime: 'codex', model: 'gpt-5.6-luna' },
    { runtime: 'claude', model: operatorModel },
    { runtime: 'opencode', model: 'openai/gpt-5.6-luna', effortVariant: 'luna-xhigh-model-variant' },
  ];
  const probeCalls = [];
  await boot({
    modelCapabilityProbe: args => {
      probeCalls.push({ runtime: args.runtime, model: args.model, effort: args.effort });
      return authoritativeProbe(args);
    },
  });

  const observations = [];
  for (const item of cases) {
    const request = dispatchBody({
      dispatchId: `dispatch-effort-${item.runtime}-092`,
      runtime: item.runtime,
      model: item.model,
      requestId: `request-effort-${item.runtime}-092`,
      replyTo: `reply-effort-${item.runtime}-092`,
    });
    const initial = await jsonRequest('/api/sessions', { method: 'POST', body: request });
    assert.equal(initial.status, 201, `${item.runtime} initial dispatch: ${JSON.stringify(initial.body)}`);
    assert.equal(initial.body.requested.effort, effort);
    assert.equal(initial.body.effective.effort, effort);
    const initialSpawn = recorder.calls.at(-1);
    assert.ok(initialSpawn, `${item.runtime} initial dispatch must reach the PTY seam`);

    assert.equal(emitExit(initial.body.sessionId, 23), true, `${item.runtime} fixture exit must reach the server`);
    await waitForTurn();
    const retry = await jsonRequest('/api/sessions', { method: 'POST', body: { ...request, retry: true } });
    assert.equal(retry.status, 201, `${item.runtime} retry dispatch: ${JSON.stringify(retry.body)}`);
    assert.equal(retry.body.requested.effort, effort);
    assert.equal(retry.body.effective.effort, effort);
    assert.notEqual(retry.body.sessionId, initial.body.sessionId);
    const retrySpawn = recorder.calls.at(-1);
    assert.ok(retrySpawn, `${item.runtime} retry must reach the PTY seam`);
    observations.push({ item, initial: initialSpawn.options, retry: retrySpawn.options });
  }

  assert.equal(probeCalls.length, cases.length * 2, 'capability preflight must run for each initial dispatch and retry');
  for (const { item, initial, retry } of observations) {
    assert.equal(initial.runtime, item.runtime);
    assert.equal(retry.runtime, item.runtime);
    assert.equal(initial.effort, effort, `${item.runtime} initial spawn lost effort`);
    assert.equal(retry.effort, effort, `${item.runtime} retry spawn lost effort`);
    const expectedVariant = item.effortVariant || '';
    assert.equal(String(initial.effortVariant || ''), expectedVariant, `${item.runtime} initial variant was replaced`);
    assert.equal(String(retry.effortVariant || ''), expectedVariant, `${item.runtime} retry variant was replaced`);
  }
});

test('AC-05 RED: ordinary HTTP settings cannot add, replace, nest, or null out trusted runtimeCapabilities', async () => {
  const initial = operatorSettings();
  const forged = {
    claude: {
      models: {
        'gateway/http-forged-model': { supportedEfforts: ['xhigh'] },
      },
    },
  };
  await boot({ settings: initial, modelCapabilityProbe: authoritativeProbe });

  const attacks = [
    { runtimeCapabilities: forged },
    { schema: 'harness-settings@1', runtimeCapabilities: { claude: { models: {} } } },
    { runtimeCapabilities: null },
    { settings: { runtimeCapabilities: forged } },
    { payload: { runtimeCapabilities: forged } },
  ];
  const observed = [];
  for (const body of attacks) {
    const written = await jsonRequest('/api/settings', { method: 'POST', body });
    if (written.status !== 200) {
      assert.equal(written.status, 400, `unexpected settings response: ${JSON.stringify(written.body)}`);
      assert.ok(
        ['RUNTIME_CAPABILITIES_OPERATOR_ONLY', 'RUNTIME_CAPABILITIES_INVALID'].includes(written.body?.error?.code),
        `untrusted capability mutation must fail clearly: ${JSON.stringify(written.body)}`,
      );
    }
    const loaded = await jsonRequest('/api/settings');
    assert.equal(loaded.status, 200);
    observed.push(loaded.body.runtimeCapabilities);
  }
  assert.deepEqual(
    observed,
    attacks.map(() => initial.runtimeCapabilities),
    'HTTP settings must preserve the Harness-owned operator declaration exactly',
  );

  const ordinary = await jsonRequest('/api/settings', {
    method: 'POST',
    body: { ui: { theme: 'light' }, cleanup: { stoppedSessionRetentionDays: 3 } },
  });
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.body.ui.theme, 'light');
  assert.equal(ordinary.body.cleanup.stoppedSessionRetentionDays, 3);
  assert.deepEqual(ordinary.body.runtimeCapabilities, initial.runtimeCapabilities);
});

test('AC-05 UI-shaped GET-to-full-settings save changes ordinary settings without losing the operator declaration', async () => {
  const initial = operatorSettings();
  await boot({ settings: initial, modelCapabilityProbe: authoritativeProbe });
  const loaded = await jsonRequest('/api/settings');
  assert.equal(loaded.status, 200);
  const uiPayload = {
    ...loaded.body,
    ui: { ...loaded.body.ui, theme: 'light' },
  };
  const saved = await jsonRequest('/api/settings', { method: 'POST', body: uiPayload });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.ui.theme, 'light');
  assert.deepEqual(saved.body.runtimeCapabilities, initial.runtimeCapabilities);
  const roundTrip = await jsonRequest('/api/settings');
  assert.equal(roundTrip.status, 200);
  assert.equal(roundTrip.body.ui.theme, 'light');
  assert.deepEqual(roundTrip.body.runtimeCapabilities, initial.runtimeCapabilities);
});

test('AC-05 HTTP dispatch cannot self-authorize a model, while an existing operator declaration remains trusted', async () => {
  await boot({ settings: operatorSettings() });
  const forged = await jsonRequest('/api/sessions', {
    method: 'POST',
    body: {
      ...dispatchBody({
        dispatchId: 'dispatch-http-forged-model-092',
        runtime: 'claude',
        model: 'gateway/http-forged-model',
        requestId: 'request-http-forged-model-092',
        replyTo: 'reply-http-forged-model-092',
      }),
      modelCapability: {
        status: 'supported',
        sourceKind: 'http-self-asserted',
        verificationLevel: 'authoritative',
        complete: true,
        model: 'gateway/http-forged-model',
        supportedEfforts: [effort],
      },
      supportedModels: ['gateway/http-forged-model'],
      runtimeCapabilities: { claude: { models: { 'gateway/http-forged-model': { supportedEfforts: [effort] } } } },
    },
  });
  assert.equal(forged.status, 422, JSON.stringify(forged.body));
  assert.equal(forged.body?.error?.code, 'UNSUPPORTED', JSON.stringify(forged.body));
  assert.equal(recorder.count(), 0, 'self-authorized HTTP model must not reach spawnPty');

  const trusted = await jsonRequest('/api/sessions', {
    method: 'POST',
    body: dispatchBody({
      dispatchId: 'dispatch-http-operator-model-092',
      runtime: 'claude',
      model: operatorModel,
      requestId: 'request-http-operator-model-092',
      replyTo: 'reply-http-operator-model-092',
    }),
  });
  assert.equal(trusted.status, 201, JSON.stringify(trusted.body));
  assert.equal(trusted.body.requested.model, operatorModel);
  assert.equal(trusted.body.requested.effort, effort);
  assert.equal(recorder.count(), 1, 'trusted operator declaration should reach the PTY seam');
});

test('AC-05 RED: ambiguous bare OpenCode model is rejected and explicit provider/model reaches PTY unchanged', async () => {
  await boot({ modelCapabilityProbe: ambiguousOpenCodeProbe });
  const bareModel = await jsonRequest('/api/sessions', {
    method: 'POST',
    body: dispatchBody({
      dispatchId: 'dispatch-opencode-bare-092',
      runtime: 'opencode',
      model: 'gpt-5.6-luna',
      requestId: 'request-opencode-bare-092',
      replyTo: 'reply-opencode-bare-092',
    }),
  });
  assert.notEqual(bareModel.status, 201, `ambiguous bare model must not spawn: ${JSON.stringify(bareModel.body)}`);
  assert.match(
    `${bareModel.body?.error?.code || ''} ${bareModel.body?.error?.message || ''}`,
    /ambig|provider[\s/-]*model|explicit/i,
    `ambiguous bare model must fail with a clear provider/model error: ${JSON.stringify(bareModel.body)}`,
  );
  assert.equal(recorder.count(), 0, 'ambiguous bare model must not reach spawnPty');

  const explicitModel = OPENCODE_MODEL_FIXTURE[0].catalogId;
  const explicit = await jsonRequest('/api/sessions', {
    method: 'POST',
    body: dispatchBody({
      dispatchId: 'dispatch-opencode-explicit-092',
      runtime: 'opencode',
      model: explicitModel,
      requestId: 'request-opencode-explicit-092',
      replyTo: 'reply-opencode-explicit-092',
    }),
  });
  assert.equal(explicit.status, 201, JSON.stringify(explicit.body));
  assert.equal(explicit.body.requested.model, explicitModel);
  assert.equal(explicit.body.effective.model, explicitModel);
  assert.equal(recorder.count(), 1);
  assert.equal(recorder.calls[0].options.model, explicitModel, 'OpenCode PTY must receive provider/model, not a rewritten bare id');
});
