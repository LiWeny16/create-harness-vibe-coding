// Independent cross-contract review probes (AC-05/AC-09).
// These tests exercise the real server boundary with a deterministic PTY
// fixture. They do not alter source, benchmark contracts, or canonical state.
import test, { after, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { makeHarnessTempRoot } from './support/temp-root.js';
import { scoreRun } from '../scripts/harness-intelligence-bench.mjs';
import { SessionRegistry } from '../src/wf-ui-server/session-registry.mjs';

const repoRoot = path.resolve('.');
const fixtureDir = path.join(repoRoot, 'tests', 'fixtures', 'runtime-092');
const fixtureUrl = pathToFileURL(path.join(fixtureDir, 'pty-adapter.mjs')).href;
const originalPath = process.env.PATH || '';
const model = 'gpt-5.6-luna';
const openCodeModel = 'opencode/gpt-5.6-luna';
const effort = 'xhigh';
const taskId = 'task-review-cross-contract-092';

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

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

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

function dispatchRequest(dispatchId, overrides = {}) {
  return {
    dispatchId,
    taskId,
    runtime: 'codex',
    model,
    effort,
    transport: 'pty',
    role: 'verifier',
    objective: 'cross-contract retry review',
    initialPrompt: 'cross-contract review fixture',
    requestId: `${dispatchId}-request`,
    replyTo: `${dispatchId}-reply`,
    projectRoot: root,
    ...overrides,
  };
}

function trustedFixtureProbe({ runtime, model: requestedModel, effort: requestedEffort }) {
  return {
    status: runtime === 'codex' && requestedModel === model && requestedEffort === effort ? 'supported' : 'unsupported',
    sourceKind: 'test-authoritative-catalog',
    verificationLevel: 'authoritative',
    complete: true,
    model: requestedModel,
    supportedEfforts: [effort],
  };
}

function authoritativeCatalogProbe(catalog) {
  return ({ runtime, model: requestedModel, effort: requestedEffort }) => {
    const declaration = catalog?.[runtime]?.models?.[requestedModel];
    if (!declaration) {
      return {
        status: 'unsupported',
        sourceKind: 'test-authoritative-catalog',
        verificationLevel: 'authoritative',
        complete: true,
        model: requestedModel,
        reason: {
          code: 'MODEL_NOT_IN_AUTHORITATIVE_CATALOG',
          message: 'The requested model is absent from the test-owned complete catalog.',
        },
      };
    }

    const supportedEfforts = declaration.supportedEfforts;
    if (Array.isArray(supportedEfforts)
      && requestedEffort
      && !supportedEfforts.includes(String(requestedEffort).toLowerCase())) {
      return {
        status: 'unsupported',
        sourceKind: 'test-authoritative-catalog',
        verificationLevel: 'authoritative',
        complete: true,
        model: requestedModel,
        supportedEfforts,
        reason: {
          code: 'MODEL_EFFORT_NOT_SUPPORTED',
          message: `The test-owned authoritative catalog excludes effort '${requestedEffort}'.`,
        },
      };
    }

    return {
      status: 'supported',
      sourceKind: 'test-authoritative-catalog',
      verificationLevel: 'authoritative',
      complete: true,
      model: requestedModel,
      // Deliberately preserve omission: model presence alone must remain
      // UNVERIFIED for a mandatory effort request.
      ...(Object.hasOwn(declaration, 'supportedEfforts') ? { supportedEfforts } : {}),
    };
  };
}

function claudeStringOnlyProbe({ projectRoot, model: requestedModel }) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(path.join(projectRoot, '.claude', 'settings.json'), 'utf8'));
  } catch {
    return {
      status: 'unavailable',
      sourceKind: 'test-claude-operator-settings',
      verificationLevel: 'operator-configured',
      complete: false,
      model: requestedModel,
    };
  }
  const availableModels = Array.isArray(settings?.availableModels) ? settings.availableModels : [];
  return {
    status: availableModels.includes(requestedModel) ? 'supported' : 'unsupported',
    sourceKind: 'test-claude-operator-settings',
    verificationLevel: 'operator-configured',
    complete: true,
    model: requestedModel,
    // availableModels is intentionally string-only; it has no effort claim.
  };
}

function waitForTurn() {
  return new Promise(resolve => setTimeout(resolve, 40));
}

function writeStateFixture(projectRoot) {
  const taskRoot = path.join(projectRoot, 'Harness', 'tasks', taskId);
  fs.mkdirSync(taskRoot, { recursive: true });
  fs.writeFileSync(path.join(taskRoot, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    mode: 'wf',
    title: 'Cross-contract review fixture',
    nextAction: 'Review retry contract',
    phase: 'verify',
    acceptance: [],
    planItems: [],
    links: { dependsOn: [], blocks: [], related: [] },
  }));
}

async function boot(options = {}) {
  root = makeHarnessTempRoot('review-cross-contract-092-');
  roots.add(root);
  writeStateFixture(root);
  recorder.reset();
  const started = await startServer({
    projectRoot: root,
    host: '127.0.0.1',
    port: 0,
    sessionRegistry: new SessionRegistry(),
    eventsWs: false,
    chatWs: false,
    ...options,
  });
  server = started.server;
  baseUrl = `http://127.0.0.1:${started.port}`;
}

before(() => {
  process.env.PATH = `${fixtureDir}${path.delimiter}${originalPath}`;
  if (process.platform !== 'win32') fs.chmodSync(path.join(fixtureDir, 'codex'), 0o755);
});

after(() => {
  process.env.PATH = originalPath;
  if (process.platform !== 'win32') fs.chmodSync(path.join(fixtureDir, 'codex'), 0o644);
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
});

test('AC-05 independent cancellation plus one retry/new-session trace passes the scorer', async () => {
  await boot({ modelCapabilityProbe: trustedFixtureProbe });

  const cancelledRequest = dispatchRequest('dispatch-cross-contract-cancel-092');
  const cancelled = await jsonRequest('/api/sessions', { method: 'POST', body: cancelledRequest });
  assert.equal(cancelled.status, 201, JSON.stringify(cancelled.body));
  const cancelResult = await jsonRequest(`/api/sessions/${cancelled.body.sessionId}/cancel`, {
    method: 'POST', body: {},
  });
  assert.equal(cancelResult.status, 200, JSON.stringify(cancelResult.body));
  assert.equal((cancelResult.body.cancelled || cancelResult.body).status, 'cancelled');

  const retryRequest = dispatchRequest('dispatch-cross-contract-retry-092');
  const first = await jsonRequest('/api/sessions', { method: 'POST', body: retryRequest });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(emitExit(first.body.sessionId, 23), true);
  await waitForTurn();
  const retry = await jsonRequest('/api/sessions', {
    method: 'POST', body: { ...retryRequest, retry: true },
  });
  assert.equal(retry.status, 201, JSON.stringify(retry.body));
  assert.equal(retry.body.attempt, 1);
  assert.notEqual(retry.body.sessionId, first.body.sessionId,
    'the single allowed retry must be a new runtime session');

  // The runtime's raw attempt numbering is 0-based (initial=0, retry=1),
  // while the benchmark evidence schema is 1-based (initial=1, retry=2).
  // Preserve both values in every evidence row; the scorer must consume only
  // the explicit normalized field and never require rewriting the raw trace.
  assert.equal(cancelled.body.attempt, 0, 'raw cancellation attempt must remain 0-based initial');
  assert.equal(first.body.attempt, 0, 'raw failed attempt must remain 0-based initial');
  assert.equal(retry.body.attempt, 1, 'raw retry attempt must remain 0-based retry');
  const cancelAttempt = cancelled.body.attempt + 1;
  const failedAttempt = first.body.attempt + 1;
  const retryAttempt = retry.body.attempt + 1;
  assert.equal(cancelAttempt, 1);
  assert.equal(failedAttempt, 1);
  assert.equal(retryAttempt, 2);

  const capability = recorder.calls[2]?.options?.workerCapability;
  const succeeded = await jsonRequest(`/api/dispatches/${retryRequest.dispatchId}/result`, {
    method: 'POST',
    body: {
      sessionId: retry.body.sessionId,
      taskId,
      requestId: retryRequest.requestId,
      replyTo: retryRequest.replyTo,
      status: 'succeeded',
      result: { source: 'cross-contract-fixture' },
    },
    headers: {
      'X-Harness-Worker-Capability': capability,
      'X-Harness-Session-Id': retry.body.sessionId,
    },
  });
  assert.equal(succeeded.status, 201, JSON.stringify(succeeded.body));
  const replay = await jsonRequest('/api/sessions', {
    method: 'POST', body: { ...retryRequest, retry: true },
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.sessionId, retry.body.sessionId);
  assert.equal(recorder.calls.length, 3,
    'cancelled dispatch + failed dispatch + one retry must create exactly three sessions');

  // B3 RED/HIGH oracle probe: this is the actual allowed trace shape, with
  // one independent cancellation dispatch and a separate failed->retry
  // dispatch whose retry uses a new session. The scorer currently hard-codes
  // one dispatchId and one sessionId, so it should reject this evidence.
  const resultPath = path.join(root, 'result.json');
  const eventsPath = path.join(root, 'events.jsonl');
  const effectsPath = path.join(root, 'effects.jsonl');
  const executionPath = path.join(root, 'execution.log');
  fs.writeFileSync(resultPath, '{"ok":true,"source":"cross-contract"}\n');
  const eventRows = [
    { seq: 1, kind: 'request', dispatchId: cancelledRequest.dispatchId, sessionId: cancelled.body.sessionId, requestId: cancelledRequest.requestId, rawAttempt: cancelled.body.attempt, attempt: cancelAttempt, replyTo: cancelledRequest.requestId },
    { seq: 2, kind: 'ack', dispatchId: cancelledRequest.dispatchId, sessionId: cancelled.body.sessionId, requestId: cancelledRequest.requestId, rawAttempt: cancelled.body.attempt, attempt: cancelAttempt, replyTo: cancelledRequest.requestId },
    { seq: 3, kind: 'cancelled', status: 'cancelled', dispatchId: cancelledRequest.dispatchId, sessionId: cancelled.body.sessionId, requestId: cancelledRequest.requestId, rawAttempt: cancelled.body.attempt, attempt: cancelAttempt, replyTo: cancelledRequest.requestId },
    { seq: 4, kind: 'request', dispatchId: retryRequest.dispatchId, sessionId: first.body.sessionId, requestId: retryRequest.requestId, rawAttempt: first.body.attempt, attempt: failedAttempt, replyTo: retryRequest.requestId },
    { seq: 5, kind: 'ack', dispatchId: retryRequest.dispatchId, sessionId: first.body.sessionId, requestId: retryRequest.requestId, rawAttempt: first.body.attempt, attempt: failedAttempt, replyTo: retryRequest.requestId },
    { seq: 6, kind: 'failed', status: 'failed', dispatchId: retryRequest.dispatchId, sessionId: first.body.sessionId, requestId: retryRequest.requestId, rawAttempt: first.body.attempt, attempt: failedAttempt, replyTo: retryRequest.requestId },
    { seq: 7, kind: 'request', dispatchId: retryRequest.dispatchId, sessionId: retry.body.sessionId, requestId: retryRequest.requestId, rawAttempt: retry.body.attempt, attempt: retryAttempt, replyTo: retryRequest.requestId },
    { seq: 8, kind: 'ack', dispatchId: retryRequest.dispatchId, sessionId: retry.body.sessionId, requestId: retryRequest.requestId, rawAttempt: retry.body.attempt, attempt: retryAttempt, replyTo: retryRequest.requestId },
    { seq: 9, kind: 'result', status: 'succeeded', dispatchId: retryRequest.dispatchId, sessionId: retry.body.sessionId, requestId: retryRequest.requestId, rawAttempt: retry.body.attempt, attempt: retryAttempt, replyTo: retryRequest.requestId },
  ];
  const effectRows = [
    { kind: 'dispatch', dispatchId: cancelledRequest.dispatchId, idempotencyKey: cancelledRequest.dispatchId, sessionId: cancelled.body.sessionId, requestId: cancelledRequest.requestId, rawAttempt: cancelled.body.attempt, attempt: cancelAttempt },
    { kind: 'dispatch', dispatchId: retryRequest.dispatchId, idempotencyKey: retryRequest.dispatchId, sessionId: first.body.sessionId, requestId: retryRequest.requestId, rawAttempt: first.body.attempt, attempt: failedAttempt },
    { kind: 'dispatch', dispatchId: retryRequest.dispatchId, idempotencyKey: retryRequest.dispatchId, sessionId: retry.body.sessionId, requestId: retryRequest.requestId, rawAttempt: retry.body.attempt, attempt: retryAttempt },
    { kind: 'write', path: resultPath, sha256: sha256File(resultPath), sessionId: retry.body.sessionId, requestId: retryRequest.requestId, rawAttempt: retry.body.attempt, attempt: retryAttempt },
  ];
  fs.writeFileSync(eventsPath, `${eventRows.map(JSON.stringify).join('\n')}\n`);
  fs.writeFileSync(effectsPath, `${effectRows.map(JSON.stringify).join('\n')}\n`);
  fs.writeFileSync(executionPath, 'requested runtime codex; target runtime claude; model gpt-5.6-luna; effort xhigh\nattempt normalization: raw runtime 0-based [0,0,1] -> evidence 1-based [1,1,2]; rawAttempt fields preserved\n');
  const evidence = filePath => ({ path: filePath, sha256: sha256File(filePath), source: 'independent-cross-contract-runtime-trace' });
  const report = scoreRun({
    isolatedRoot: root,
    evidenceRoot: root,
    duplicateSideEffects: 0,
    categories: {
      B3: {
        eventsEvidence: evidence(eventsPath),
        sideEffectsEvidence: evidence(effectsPath),
        executionEvidence: evidence(executionPath),
        retry: { explicit: true, attempt: retryAttempt, rawAttempt: retry.body.attempt, requestId: retryRequest.requestId, sessionId: retry.body.sessionId },
        resultPath,
        resultSha256: sha256File(resultPath),
      },
    },
  });
  assert.equal(report.categories.B3.status, 'pass', report.categories.B3.message);
  assert.equal(report.categories.B3.evidence.dispatchId, retryRequest.dispatchId);
  assert.equal(report.categories.B3.evidence.sessionId, retry.body.sessionId);
  assert.equal(report.categories.B3.evidence.currentAttempt, retryAttempt);
  assert.equal(report.categories.B3.evidence.dispatches, 3,
    'cancel + failed initial + one retry must preserve three dispatch effects');
});

test('AC-05 mandatory effort is fail-closed until the exact catalog declares it', async () => {
  await boot({
    modelCapabilityProbe: authoritativeCatalogProbe({
      opencode: { models: { [openCodeModel]: {} } },
    }),
  });
  const missingEffortMetadata = await jsonRequest('/api/sessions', {
    method: 'POST',
    body: dispatchRequest('dispatch-cross-contract-opencode-missing-effort-092', {
      runtime: 'opencode',
      model: openCodeModel,
    }),
  });
  assert.equal(missingEffortMetadata.status, 422, JSON.stringify(missingEffortMetadata.body));
  assert.equal(missingEffortMetadata.body?.error?.code, 'UNVERIFIED', JSON.stringify(missingEffortMetadata.body));
  assert.equal(missingEffortMetadata.body?.capability?.reason?.code,
    'MODEL_EFFORT_METADATA_UNAVAILABLE', JSON.stringify(missingEffortMetadata.body));
  assert.equal(recorder.count(), 0, 'missing effort metadata must not spawn a provider');

  await stopServer(server);
  server = null;
  await boot({
    modelCapabilityProbe: authoritativeCatalogProbe({
      opencode: { models: { [openCodeModel]: { supportedEfforts: [effort] } } },
    }),
  });
  const supportedEffort = await jsonRequest('/api/sessions', {
    method: 'POST',
    body: dispatchRequest('dispatch-cross-contract-opencode-supported-effort-092', {
      runtime: 'opencode',
      model: openCodeModel,
    }),
  });
  assert.equal(supportedEffort.status, 201, JSON.stringify(supportedEffort.body));
  assert.equal(supportedEffort.body.requested.model, openCodeModel);
  assert.equal(supportedEffort.body.requested.effort, effort);
  assert.equal(supportedEffort.body.effective.model, openCodeModel);
  assert.equal(supportedEffort.body.effective.effort, effort);
  assert.equal(recorder.count(), 1, 'declared effort must reach the provider exactly once');
  assert.equal(recorder.calls[0].options.model, openCodeModel);
  assert.equal(recorder.calls[0].options.effort, effort);

  await stopServer(server);
  server = null;
  await boot({
    modelCapabilityProbe: authoritativeCatalogProbe({
      opencode: { models: { [openCodeModel]: { supportedEfforts: [effort] } } },
    }),
  });
  const unsupportedEffort = await jsonRequest('/api/sessions', {
    method: 'POST',
    body: dispatchRequest('dispatch-cross-contract-opencode-unsupported-effort-092', {
      runtime: 'opencode',
      model: openCodeModel,
      effort: 'low',
    }),
  });
  assert.equal(unsupportedEffort.status, 422, JSON.stringify(unsupportedEffort.body));
  assert.equal(unsupportedEffort.body?.error?.code, 'UNSUPPORTED', JSON.stringify(unsupportedEffort.body));
  assert.equal(unsupportedEffort.body?.capability?.reason?.code,
    'MODEL_EFFORT_NOT_SUPPORTED', JSON.stringify(unsupportedEffort.body));
  assert.equal(recorder.count(), 0, 'an unsupported effort must not spawn a provider');

  await stopServer(server);
  server = null;
  await boot({ modelCapabilityProbe: claudeStringOnlyProbe });
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({
    availableModels: [model],
  }));
  const claudeStringOnly = await jsonRequest('/api/sessions', {
    method: 'POST',
    body: dispatchRequest('dispatch-cross-contract-claude-string-only-092', { runtime: 'claude' }),
  });
  assert.equal(claudeStringOnly.status, 422, JSON.stringify(claudeStringOnly.body));
  assert.equal(claudeStringOnly.body?.error?.code, 'UNVERIFIED', JSON.stringify(claudeStringOnly.body));
  assert.equal(claudeStringOnly.body?.capability?.reason?.code,
    'MODEL_EFFORT_METADATA_UNAVAILABLE', JSON.stringify(claudeStringOnly.body));
  assert.equal(recorder.count(), 0,
    'Claude availableModels strings cannot satisfy mandatory effort validation without metadata');
});
