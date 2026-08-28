import { spawn as nodeSpawn } from 'node:child_process';
import net from 'node:net';

const STDOUT_URL_WAIT_MS = 3000;
const HEALTH_POLL_MS = 100;
const DEFAULT_HEALTH_TIMEOUT_MS = 10000;
const DEFAULT_SSE_RETRY_DELAY_MS = 250;
const DEFAULT_KILL_GRACE_MS = 2000;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function firstHttpUrlFromStdout(child) {
  return new Promise((resolve) => {
    let buf = '';
    const onData = (d) => {
      buf += typeof d === 'string' ? d : Buffer.from(d).toString('utf8');
      const m = buf.match(/https?:\/\/127\.0\.0\.1:\d+/);
      if (m) finish(m[0]);
    };
    const onExit = () => finish(null);
    const finish = (v) => {
      child.stdout?.off?.('data', onData);
      child.off?.('exit', onExit);
      resolve(v);
    };
    child.stdout?.on?.('data', onData);
    child.on?.('exit', onExit);
  });
}

export function createOpencodeServerDriver(options = {}) {
  const {
    command = 'opencode',
    args = [],
    cwd,
    env,
    model,
    title,
    providerSessionId = null,
    onEvent = () => {},
    _spawn = nodeSpawn,
    _fetch = globalThis.fetch.bind(globalThis),
    healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
    sseRetryDelayMs = DEFAULT_SSE_RETRY_DELAY_MS,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
  } = options;

  let child = null;
  let baseUrl = null;
  let sessionId = null;
  let started = false;
  let disposed = false;
  let seq = 0;
  let turnActive = false;
  let pendingTurn = false;
  let sseReader = null;
  let permFlavor = null; // 'response' | 'reply' | null
  const startedToolCalls = new Set();

  function emit(type, fields = {}, raw = null) {
    const envelope = { seq: ++seq, type, sessionId, ...fields, raw };
    try {
      onEvent(envelope);
    } catch {}
    return envelope;
  }

  async function waitForHealth(deadline) {
    while (Date.now() < deadline) {
      if (child?.spawnError) throw child.spawnError;
      try {
        await _fetch(`${baseUrl}/health`);
        return true;
      } catch {}
      await delay(HEALTH_POLL_MS);
    }
    return false;
  }

  async function detectPermissionFlavor() {
    let allText = '';
    try {
      const res = await _fetch(`${baseUrl}/doc`);
      if (res.ok) {
        const doc = await res.json();
        allText = JSON.stringify(doc);
        const paths = doc.paths ?? {};
        outer: for (const [p, def] of Object.entries(paths)) {
          if (!p.includes('/permissions/')) continue;
          const schema = def?.post?.requestBody?.content?.['application/json']?.schema;
          if (!schema) continue;
          const names = [...(schema.required ?? []), ...Object.keys(schema.properties ?? {})];
          if (names.includes('response')) { permFlavor = 'response'; break outer; }
          if (names.includes('reply')) { permFlavor = 'reply'; break outer; }
        }
        if (!permFlavor && allText.includes('/permissions/')) {
          if (allText.includes('"reply"')) permFlavor = 'reply';
          else if (allText.includes('"response"')) permFlavor = 'response';
        }
      }
    } catch {}
    if (!permFlavor) {
      emit('error', {
        message: 'opencode permission flavor undetected via /doc; approve will try {response} then {reply}',
        recoverable: true,
        phase: 'permission-detection',
      }, null);
    }
  }

  async function initSession() {
    if (providerSessionId) {
      const res = await _fetch(`${baseUrl}/session/${encodeURIComponent(providerSessionId)}`);
      if (!res.ok) {
        emit('error', { message: `resume failed: session ${providerSessionId} not found (HTTP ${res.status})` }, null);
        throw new Error(`opencode resume failed: session ${providerSessionId} not found`);
      }
      sessionId = providerSessionId;
      return;
    }
    const body = { ...(title ? { title } : {}) };
    const res = await _fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`opencode session create failed (HTTP ${res.status})`);
    const json = await res.json();
    sessionId = json.id;
    if (!sessionId) throw new Error('opencode session create returned no id');
  }

  function endTurn() {
    if (turnActive || pendingTurn) {
      emit('turn_ended', {}, null);
      emit('done', {}, null);
    }
    turnActive = false;
    pendingTurn = false;
  }

  function mapPart(part, delta, raw) {
    if (!part) return;
    switch (part.type) {
      case 'text': {
        const fields = { text: part.text ?? '' };
        if (delta !== undefined && delta !== null) fields.delta = delta;
        emit('text_delta', fields, raw);
        break;
      }
      case 'reasoning': {
        const fields = { text: part.text ?? '' };
        if (delta !== undefined && delta !== null) fields.delta = delta;
        emit('thinking_delta', fields, raw);
        break;
      }
      case 'tool': {
        const callId = part.callID || part.id;
        const st = part.state ?? {};
        if (st.status === 'pending' || st.status === 'running') {
          if (callId && startedToolCalls.has(callId)) break;
          if (callId) startedToolCalls.add(callId);
          emit('tool_call_start', { callId, name: part.tool, input: st.input }, raw);
        } else if (st.status === 'completed' || st.status === 'error') {
          if (callId) startedToolCalls.delete(callId);
          emit('tool_call_end', { callId, output: st.output, isError: st.status === 'error' }, raw);
        }
        break;
      }
      case 'step-start':
        turnActive = true;
        emit('turn_started', {}, raw);
        break;
      default:
        break;
    }
  }

  function handleServerEvent(evt) {
    if (!evt || typeof evt !== 'object') return;
    const props = evt.properties ?? {};
    switch (evt.type) {
      case 'step-start':
        mapPart({ type: 'step-start' }, undefined, evt);
        break;
      case 'message.part.updated':
        mapPart(props.part ?? evt.part, props.delta, evt);
        break;
      case 'permission.updated':
      case 'permission.asked':
        emit('permission_request', { requestId: props.id, tool: props.type, title: props.title }, evt);
        break;
      case 'session.idle':
        if (props.sessionID == null || props.sessionID === sessionId) endTurn();
        break;
      case 'session.error':
        emit('error', { message: props.error?.message ?? JSON.stringify(props.error ?? null) }, evt);
        break;
      default:
        break;
    }
  }

  function handleSsePayload(payload) {
    let evt;
    try {
      evt = JSON.parse(payload);
    } catch {
      return;
    }
    handleServerEvent(evt);
  }

  async function consumeSse(body) {
    const reader = body.getReader();
    sseReader = reader;
    const decoder = new TextDecoder();
    let buf = '';
    let dataLines = [];
    let handledAny = false;
    const flush = () => {
      if (dataLines.length) {
        const payload = dataLines.join('\n');
        dataLines = [];
        handledAny = true;
        handleSsePayload(payload);
      }
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (line === '') flush();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
      }
      buf += decoder.decode();
      if (buf.startsWith('data:')) dataLines.push(buf.slice(5).trimStart());
      flush();
      return handledAny;
    } finally {
      if (sseReader === reader) sseReader = null;
    }
  }

  async function runEventLoop() {
    let consecutiveFailures = 0;
    while (!disposed) {
      try {
        const res = await _fetch(`${baseUrl}/event`, { headers: { accept: 'text/event-stream' } });
        if (!res.ok || !res.body) throw new Error(`event stream HTTP ${res.status}`);
        const gotData = await consumeSse(res.body);
        if (disposed) return;
        if (gotData) {
          consecutiveFailures = 0;
          continue;
        }
        throw new Error('event stream ended unexpectedly');
      } catch (err) {
        if (disposed) return;
        consecutiveFailures++;
        if (consecutiveFailures > 1) {
          emit('error', { message: `event stream lost: ${err.message}`, recoverable: false }, null);
          return;
        }
        await delay(sseRetryDelayMs);
      }
    }
  }

  async function start() {
    if (started) throw new Error('driver already started');
    started = true;
    let port;
    try {
      port = await getFreePort();
    } catch {}
    child = _spawn(command, ['serve', '--port', String(port ?? 0), ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on?.('error', (err) => {
      child.spawnError = err;
    });
    child.stderr?.on?.('data', () => {});
    const stdoutUrl = await Promise.race([
      firstHttpUrlFromStdout(child),
      delay(STDOUT_URL_WAIT_MS).then(() => null),
    ]);
    baseUrl = stdoutUrl ?? (port ? `http://127.0.0.1:${port}` : null);
    if (!baseUrl) throw new Error('opencode serve printed no base URL and no fallback port available');
    const healthy = await waitForHealth(Date.now() + healthTimeoutMs);
    if (!healthy) throw new Error(`opencode serve did not become healthy at ${baseUrl} within ${healthTimeoutMs}ms`);
    await detectPermissionFlavor();
    await initSession();
    void runEventLoop();
    return { pid: child.pid, baseUrl, sessionId };
  }

  function buildPromptBody(text, meta) {
    const body = { parts: [{ type: 'text', text }] };
    if (model) body.model = model;
    if (meta !== undefined) body.meta = meta;
    return body;
  }

  async function sendSync(text, meta) {
    const res = await _fetch(`${baseUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildPromptBody(text, meta)),
    });
    if (!res.ok) {
      emit('error', { message: `sync prompt failed (HTTP ${res.status})` }, null);
      return { ok: false, status: res.status };
    }
    let parts = [];
    try {
      const json = await res.json();
      parts = Array.isArray(json) ? json : (json.parts ?? []);
    } catch {}
    for (const part of parts) mapPart(part, undefined, part);
    endTurn();
    return { ok: true, sync: true };
  }

  async function send(text, meta) {
    if (!started || !sessionId) throw new Error('driver not started');
    pendingTurn = true;
    const res = await _fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildPromptBody(text, meta)),
    });
    if (res.status === 404) return sendSync(text, meta);
    if (!res.ok) {
      emit('error', { message: `prompt_async failed (HTTP ${res.status})` }, null);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  }

  async function interrupt() {
    if (!started || !sessionId || disposed) return { ok: false };
    turnActive = false;
    pendingTurn = false;
    try {
      await _fetch(`${baseUrl}/session/${sessionId}/abort`, { method: 'POST' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function approve(requestId, result) {
    if (!started || !sessionId) throw new Error('driver not started');
    const value = typeof result === 'boolean' ? (result ? 'allow' : 'deny') : String(result ?? 'allow');
    const url = `${baseUrl}/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}`;
    const shapes = permFlavor
      ? [{ key: permFlavor, body: { [permFlavor]: value } }]
      : [
          { key: 'response', body: { response: value } },
          { key: 'reply', body: { reply: value } },
        ];
    const tried = [];
    const finishFail = (extra = {}) => {
      emit('error', { message: extra.message ?? 'approve failed' }, null);
      return { ok: false, tried };
    };
    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      tried.push(shape.key);
      let res;
      try {
        res = await _fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(shape.body),
        });
      } catch (err) {
        if (i === shapes.length - 1) return finishFail({ message: `approve failed: ${err.message}` });
        continue;
      }
      if (res.ok) return { ok: true, shape: shape.key, tried };
      if (i === shapes.length - 1) {
        emit('error', { message: `approve failed (HTTP ${res.status})` }, null);
        return { ok: false, tried, status: res.status };
      }
    }
    return { ok: false, tried };
  }

  function closeSse() {
    const reader = sseReader;
    sseReader = null;
    try {
      reader?.cancel?.();
    } catch {}
  }

  async function dispose(opts = {}) {
    if (disposed) return { ok: true };
    disposed = true;
    if ((turnActive || pendingTurn) && sessionId && baseUrl) {
      try {
        await _fetch(`${baseUrl}/session/${sessionId}/abort`, { method: 'POST' });
      } catch {}
    }
    closeSse();
    if (child?.pid) {
      child.kill?.('SIGTERM');
      if (!(opts.force || opts.immediate)) await delay(killGraceMs);
      if (child.exitCode == null && child.signalCode == null) child.kill?.('SIGKILL');
    }
    return { ok: true };
  }

  return {
    start,
    send,
    steer: (text, meta) => send(text, meta),
    interrupt,
    approve,
    dispose,
  };
}

export default createOpencodeServerDriver;
