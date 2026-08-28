import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOpencodeServerDriver } from '../drivers/opencode-server.mjs';

// Contract: opencode serve HTTP API + SSE chat driver, tested via injected
// _spawn/_fetch fakes and a scripted SSE byte stream. No real processes/network.

const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  child.kills = [];
  child.kill = (sig) => {
    child.kills.push(sig);
    return true;
  };
  return child;
}

// Fake _spawn whose serve prints its bound URL on stdout (as real `opencode serve` does).
function urlSpawn(url = 'http://127.0.0.1:45990') {
  const child = fakeChild();
  return () => {
    setTimeout(() => child.stdout.emit('data', Buffer.from(`opencode serve listening on ${url}\n`)), 0);
    return child;
  };
}

function makeFetch() {
  const calls = [];
  const routes = [];
  const fn = async (url, opts = {}) => {
    let body;
    if (opts.body) {
      try { body = JSON.parse(opts.body); } catch { body = opts.body; }
    }
    calls.push({ url, method: opts.method || 'GET', body });
    for (const route of routes) {
      if (route.match(url, opts)) return route.handler(url, opts);
    }
    return resp(404, {});
  };
  fn.calls = calls;
  fn.on = (match, handler) => {
    routes.push({ match, handler });
    return fn;
  };
  return fn;
}

function resp(status, json, extra = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => json, ...extra };
}

function endBody(chunks) {
  let i = 0;
  return {
    getReader() {
      return {
        read() {
          return i < chunks.length
            ? Promise.resolve({ done: false, value: enc.encode(chunks[i++]) })
            : Promise.resolve({ done: true });
        },
        cancel() { return Promise.resolve(); },
      };
    },
  };
}

function hangBody(chunks) {
  let i = 0;
  let wake = null;
  return {
    getReader() {
      return {
        read() {
          if (i < chunks.length) return Promise.resolve({ done: false, value: enc.encode(chunks[i++]) });
          return new Promise((r) => { wake = r; });
        },
        cancel() {
          if (wake) { wake({ done: true }); wake = null; }
          return Promise.resolve();
        },
      };
    },
  };
}

const sse = (...objs) => objs.map((o) => `data: ${JSON.stringify(o)}\n\n`).join('');

async function waitFor(pred, timeoutMs = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(10);
  }
  return assert.fail('waitFor timed out');
}

function installRoutes(f, {
  sessionId = 'ses_test1',
  resumeExists = true,
  doc = null,
  promptAsyncStatus = 204,
  syncParts = [{ type: 'text', text: 'sync-final' }],
  permissionHandler = null,
  eventResponder = null,
} = {}) {
  f.on((u) => u.endsWith('/health'), () => resp(200, {}));
  f.on((u) => u.endsWith('/event'), () =>
    eventResponder ? eventResponder() : resp(200, {}, { body: hangBody([]) }));
  f.on((u) => u.endsWith('/doc'), () => (doc === null ? resp(404, {}) : resp(200, doc)));
  f.on((u, o) => o.method === 'POST' && /\/prompt_async$/.test(u), () => resp(promptAsyncStatus, {}));
  f.on((u, o) => o.method === 'POST' && /\/abort$/.test(u), () => resp(200, {}));
  f.on((u, o) => o.method === 'POST' && /\/permissions\//.test(u), (_u, _o) =>
    permissionHandler ? permissionHandler(f.calls[f.calls.length - 1]) : resp(204, {}));
  f.on((u, o) => o.method === 'POST' && /\/message$/.test(u), () => resp(200, { parts: syncParts }));
  f.on((u) => new RegExp(`/session/${sessionId}$`).test(u), () =>
    resp(resumeExists ? 200 : 404, resumeExists ? { id: sessionId } : { error: 'not found' }));
  f.on((u, o) => o.method === 'POST' && /\/session$/.test(u), () => resp(200, { id: sessionId }));
}

const DOC_RESPONSE_FLAVOR = {
  paths: {
    '/session/{id}/permissions/{id}': {
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: { required: ['response'], properties: { response: { type: 'string' } } },
            },
          },
        },
      },
    },
  },
};

test('T1 boot parses base URL from serve stdout and waits for /health', async () => {
  const events = [];
  let spawnedArgs = null;
  const child = fakeChild();
  const _spawn = (cmd, args) => {
    spawnedArgs = { cmd, args };
    setTimeout(() => child.stdout.emit('data', Buffer.from('opencode serve listening on http://127.0.0.1:45871\n')), 5);
    return child;
  };
  const f = makeFetch();
  installRoutes(f, { sessionId: 'ses_boot' });

  const d = createOpencodeServerDriver({ _spawn, _fetch: f, onEvent: (e) => events.push(e) });
  try {
    const info = await d.start();
    assert.equal(info.pid, 4242);
    assert.equal(info.baseUrl, 'http://127.0.0.1:45871');
    assert.equal(info.sessionId, 'ses_boot');
    assert.equal(spawnedArgs.cmd, 'opencode');
    assert.deepEqual(spawnedArgs.args.slice(0, 2), ['serve', '--port']);
    const health = f.calls.find((c) => c.url.endsWith('/health'));
    assert.equal(health.url, 'http://127.0.0.1:45871/health');
  } finally {
    await d.dispose({ immediate: true });
  }
});

test('T2 create session: POST /session then prompt_async with parts/model/meta passthrough', async () => {
  const events = [];
  const f = makeFetch();
  installRoutes(f, { sessionId: 'ses_create' });
  const d = createOpencodeServerDriver({
    _spawn: urlSpawn(),
    _fetch: f,
    onEvent: (e) => events.push(e),
    title: 'My Task',
    model: 'openai/gpt-x',
  });
  try {
    await d.start();
    const createCall = f.calls.find((c) => c.method === 'POST' && c.url.endsWith('/session'));
    assert.deepEqual(createCall.body, { title: 'My Task' });

    await d.send('hi', { wfNodeId: 'n1' });
    const prompt = f.calls.find((c) => c.url.endsWith('/session/ses_create/prompt_async'));
    assert.equal(prompt.method, 'POST');
    assert.deepEqual(prompt.body, {
      parts: [{ type: 'text', text: 'hi' }],
      model: 'openai/gpt-x',
      meta: { wfNodeId: 'n1' },
    });

    await d.steer('go');
    const prompts = f.calls.filter((c) => c.url.endsWith('/prompt_async'));
    assert.equal(prompts.length, 2);
    assert.equal(prompts[1].body.parts[0].text, 'go');
  } finally {
    await d.dispose({ immediate: true });
  }
});

test('T3 resume: providerSessionId skips create, verifies GET, prompts into resumed session', async () => {
  const f = makeFetch();
  installRoutes(f, { sessionId: 'ses_resume9' });
  const d = createOpencodeServerDriver({
    _spawn: urlSpawn(),
    _fetch: f,
    providerSessionId: 'ses_resume9',
  });
  try {
    const info = await d.start();
    assert.equal(info.sessionId, 'ses_resume9');
    assert.equal(f.calls.some((c) => c.method === 'POST' && c.url.endsWith('/session')), false);
    const verify = f.calls.find((c) => c.method === 'GET' && c.url.endsWith('/session/ses_resume9'));
    assert.ok(verify, 'resume verification GET performed');
    await d.send('continue');
    const prompt = f.calls.find((c) => c.url.endsWith('/session/ses_resume9/prompt_async'));
    assert.ok(prompt);
    assert.deepEqual(prompt.body.parts, [{ type: 'text', text: 'continue' }]);
  } finally {
    await d.dispose({ immediate: true });
  }
});

test('T4 resume of unknown session emits error and start() rejects', async () => {
  const events = [];
  const f = makeFetch();
  installRoutes(f, { sessionId: 'ses_gone', resumeExists: false });
  const d = createOpencodeServerDriver({
    _spawn: urlSpawn(),
    _fetch: f,
    onEvent: (e) => events.push(e),
    providerSessionId: 'ses_gone',
  });
  try {
    await assert.rejects(() => d.start(), /resume failed/);
    assert.ok(events.some((e) => e.type === 'error' && /not found/.test(e.message)));
  } finally {
    await d.dispose({ immediate: true });
  }
});

test('T5 prompt_async 404 falls back to sync /message batch emitting parts + done', async () => {
  const events = [];
  const f = makeFetch();
  installRoutes(f, {
    sessionId: 'ses_sync',
    promptAsyncStatus: 404,
    syncParts: [
      { type: 'text', text: 'final answer' },
      { type: 'reasoning', text: 'thought' },
    ],
  });
  const d = createOpencodeServerDriver({ _spawn: urlSpawn(), _fetch: f, onEvent: (e) => events.push(e) });
  try {
    await d.start();
    const r = await d.send('question');
    assert.equal(r.ok, true);
    assert.equal(r.sync, true);
    const msg = f.calls.find((c) => c.url.endsWith('/session/ses_sync/message'));
    assert.deepEqual(msg.body.parts, [{ type: 'text', text: 'question' }]);
    await waitFor(() => events.some((e) => e.type === 'done'));
    const types = events.map((e) => e.type);
    assert.deepEqual(
      types.filter((t) => t !== 'error'),
      ['text_delta', 'thinking_delta', 'turn_ended', 'done'],
    );
    const td = events.find((e) => e.type === 'text_delta');
    assert.equal(td.text, 'final answer');
  } finally {
    await d.dispose({ immediate: true });
  }
});

test('T6 SSE events map to canonical envelopes with monotonic seq and raw preserved', async () => {
  const events = [];
  const f = makeFetch();

  const evStepStart = { type: 'step-start', properties: {} };
  const evTextDelta = { type: 'message.part.updated', properties: { part: { type: 'text', text: 'Hel' }, delta: 'Hel' } };
  const evTextFull = { type: 'message.part.updated', properties: { part: { type: 'text', text: 'Hello' } } };
  const evReasoning = { type: 'message.part.updated', properties: { part: { type: 'reasoning', text: 'hmm' } } };
  const evToolRun = { type: 'message.part.updated', properties: { part: { type: 'tool', callID: 'call_1', tool: 'bash', state: { status: 'running', input: { cmd: 'ls' } } } } };
  const evToolRunDup = { type: 'message.part.updated', properties: { part: { type: 'tool', callID: 'call_1', tool: 'bash', state: { status: 'running', input: { cmd: 'ls' } } } } };
  const evToolDone = { type: 'message.part.updated', properties: { part: { type: 'tool', callID: 'call_1', tool: 'bash', state: { status: 'completed', output: 'ok' } } } };
  const evPerm = { type: 'permission.updated', properties: { id: 'perm_9', type: 'bash', title: 'run ls' } };
  const evIdle = { type: 'session.idle', properties: { sessionID: 'ses_sse' } };

  // Chunk split mid-JSON validates streaming buffer handling.
  const full = sse(evStepStart, evTextDelta, evTextFull, evReasoning, evToolRun, evToolRunDup, evToolDone, evPerm, evIdle);
  const cut = Math.floor(full.length / 2);

  installRoutes(f, {
    sessionId: 'ses_sse',
    eventResponder: () => resp(200, {}, { body: hangBody([full.slice(0, cut), full.slice(cut)]) }),
  });
  const d = createOpencodeServerDriver({ _spawn: urlSpawn(), _fetch: f, onEvent: (e) => events.push(e) });
  try {
    await d.start();
    await waitFor(() => events.some((e) => e.type === 'done'));

    const canon = events.filter((e) => e.type !== 'error');
    assert.deepEqual(canon.map((e) => e.type), [
      'turn_started',
      'text_delta',
      'text_delta',
      'thinking_delta',
      'tool_call_start',
      'tool_call_end',
      'permission_request',
      'turn_ended',
      'done',
    ]);

    let prev = 0;
    for (const e of events) {
      assert.ok(e.seq > prev, `seq monotonic at ${e.seq}`);
      prev = e.seq;
    }
    for (const e of canon) assert.equal(e.sessionId, 'ses_sse');

    const [t1, t2] = canon.filter((e) => e.type === 'text_delta');
    assert.equal(t1.text, 'Hel');
    assert.equal(t1.delta, 'Hel');
    assert.equal(t2.text, 'Hello');
    assert.equal('delta' in t2, false);

    const think = canon.find((e) => e.type === 'thinking_delta');
    assert.equal(think.text, 'hmm');

    const ts = canon.find((e) => e.type === 'tool_call_start');
    assert.equal(ts.callId, 'call_1');
    assert.equal(ts.name, 'bash');
    assert.deepEqual(ts.input, { cmd: 'ls' });
    const te = canon.find((e) => e.type === 'tool_call_end');
    assert.equal(te.callId, 'call_1');
    assert.equal(te.output, 'ok');
    assert.equal(te.isError, false);

    const pr = canon.find((e) => e.type === 'permission_request');
    assert.equal(pr.requestId, 'perm_9');
    assert.equal(pr.tool, 'bash');
    assert.equal(pr.title, 'run ls');

    assert.deepEqual(pr.raw, evPerm);
    assert.deepEqual(ts.raw, evToolRun);
    assert.deepEqual(canon[0].raw, evStepStart);
  } finally {
    await d.dispose({ immediate: true });
  }
});

test('T7 session.error maps to error envelope', async () => {
  const events = [];
  const f = makeFetch();
  const evErr = { type: 'session.error', properties: { error: { message: 'boom' } } };
  installRoutes(f, {
    sessionId: 'ses_err',
    eventResponder: () => resp(200, {}, { body: hangBody([sse(evErr)]) }),
  });
  const d = createOpencodeServerDriver({ _spawn: urlSpawn(), _fetch: f, onEvent: (e) => events.push(e) });
  try {
    await d.start();
    await waitFor(() => events.some((e) => e.type === 'error'));
    const err = events.find((e) => e.type === 'error' && e.raw);
    assert.equal(err.message, 'boom');
  } finally {
    await d.dispose({ immediate: true });
  }
});

test('T8 /doc detects {response} flavor; approve posts detected shape once', async () => {
  const f = makeFetch();
  installRoutes(f, { sessionId: 'ses_perm', doc: DOC_RESPONSE_FLAVOR });
  const d = createOpencodeServerDriver({ _spawn: urlSpawn(), _fetch: f });
  try {
    await d.start();
    const r1 = await d.approve('perm_1', 'allow');
    assert.equal(r1.ok, true);
    assert.equal(r1.shape, 'response');
    assert.deepEqual(r1.tried, ['response']);
    const r2 = await d.approve('perm_2', false);
    assert.equal(r2.ok, true);
    const posts = f.calls.filter((c) => c.method === 'POST' && c.url.includes('/permissions/'));
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0].body, { response: 'allow' });
    assert.equal(posts[0].url.endsWith('/session/ses_perm/permissions/perm_1'), true);
    assert.deepEqual(posts[1].body, { response: 'deny' });
  } finally {
    await d.dispose({ immediate: true });
  }
});

test('T9 undetected flavor logs info-error and approve tries {response} then {reply}', async () => {
  const events = [];
  const f = makeFetch();
  installRoutes(f, {
    sessionId: 'ses_fb',
    permissionHandler: (call) => (call.body && call.body.response !== undefined ? resp(400, {}) : resp(204, {})),
  });
  const d = createOpencodeServerDriver({ _spawn: urlSpawn(), _fetch: f, onEvent: (e) => events.push(e) });
  try {
    await d.start();
    assert.ok(events.some((e) => e.type === 'error' && e.recoverable === true && e.phase === 'permission-detection'));

    const r = await d.approve('perm_3', 'deny');
    assert.equal(r.ok, true);
    assert.equal(r.shape, 'reply');
    assert.deepEqual(r.tried, ['response', 'reply']);
    const posts = f.calls.filter((c) => c.method === 'POST' && c.url.includes('/permissions/'));
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0].body, { response: 'deny' });
    assert.deepEqual(posts[1].body, { reply: 'deny' });
  } finally {
    await d.dispose({ immediate: true });
  }
});

test('T10 approve total failure emits error envelope', async () => {
  const f = makeFetch();
  installRoutes(f, {
    sessionId: 'ses_fail',
    permissionHandler: () => resp(500, {}),
  });
  const d = createOpencodeServerDriver({ _spawn: urlSpawn(), _fetch: f });
  try {
    await d.start();
    const r = await d.approve('perm_x', 'allow');
    assert.equal(r.ok, false);
    assert.equal(r.status, 500);
  } finally {
    await d.dispose({ immediate: true });
  }
});

test('T11 interrupt posts abort; dispose aborts active turn and escalates SIGTERM->SIGKILL', async () => {
  const f = makeFetch();
  installRoutes(f, { sessionId: 'ses_kill' });
  const childHolder = {};
  const d = createOpencodeServerDriver({
    _spawn: () => {
      childHolder.c = fakeChild();
      setTimeout(() => childHolder.c.stdout.emit('data', Buffer.from('opencode serve listening on http://127.0.0.1:46111\n')), 0);
      return childHolder.c;
    },
    _fetch: f,
    killGraceMs: 20,
  });
  try {
    await d.start();
    await d.interrupt();
    await d.send('work');
    const abortsBefore = f.calls.filter((c) => c.url.endsWith('/abort')).length;

    await d.dispose();
    const abortsAfter = f.calls.filter((c) => c.url.endsWith('/abort')).length;
    assert.equal(abortsAfter - abortsBefore, 1, 'dispose aborts the pending turn');
    assert.deepEqual(childHolder.c.kills, ['SIGTERM', 'SIGKILL']);

    await d.dispose({ immediate: true }); // idempotent
    assert.deepEqual(childHolder.c.kills, ['SIGTERM', 'SIGKILL']);
  } finally {
    await d.dispose({ immediate: true });
  }
});

test('T12 SSE drop: single reconnect succeeds and stream continues', async () => {
  const events = [];
  const f = makeFetch();
  let connections = 0;
  const evStepStart = { type: 'step-start', properties: {} };
  const evIdle = { type: 'session.idle', properties: { sessionID: 'ses_re' } };
  installRoutes(f, {
    sessionId: 'ses_re',
    eventResponder: () => {
      connections++;
      if (connections === 1) return resp(200, {}, { body: endBody([sse(evStepStart)]) });
      return resp(200, {}, { body: hangBody([sse(evIdle)]) });
    },
  });
  const d = createOpencodeServerDriver({
    _spawn: urlSpawn(),
    _fetch: f,
    onEvent: (e) => events.push(e),
    sseRetryDelayMs: 10,
  });
  try {
    await d.start();
    await waitFor(() => events.some((e) => e.type === 'done'));
    const eventCalls = f.calls.filter((c) => c.url.endsWith('/event'));
    assert.equal(eventCalls.length, 2);
    assert.deepEqual(events.filter((e) => e.type !== 'error').map((e) => e.type), ['turn_started', 'turn_ended', 'done']);
  } finally {
    await d.dispose({ immediate: true });
  }
});

test('T13 SSE drop twice exhausts single retry and emits terminal error event', async () => {
  const events = [];
  const f = makeFetch();
  installRoutes(f, {
    sessionId: 'ses_drop',
    eventResponder: () => resp(200, {}, { body: endBody([]) }),
  });
  const d = createOpencodeServerDriver({
    _spawn: urlSpawn(),
    _fetch: f,
    onEvent: (e) => events.push(e),
    sseRetryDelayMs: 10,
  });
  try {
    await d.start();
    await waitFor(() => events.some((e) => e.type === 'error' && e.recoverable === false));
    assert.equal(f.calls.filter((c) => c.url.endsWith('/event')).length, 2, 'exactly one reconnect attempt');
    const lost = events.find((e) => e.type === 'error' && e.recoverable === false);
    assert.match(lost.message, /event stream lost/);
  } finally {
    await d.dispose({ immediate: true });
  }
});
