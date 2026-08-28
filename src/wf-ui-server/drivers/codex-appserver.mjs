import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const CLIENT_INFO = {
  name: 'wf-ui-codex-appserver-driver',
  title: 'WF UI Codex AppServer Driver',
  version: '0.1.0',
};

const TOOLISH_RE = /exec|command|file|patch|tool|shell|mcp/i;
const APPROVAL_RE = /approval|permission|exec|patch/i;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractThreadId(result) {
  if (!result || typeof result !== 'object') return null;
  return (
    result.threadId ??
    result.thread?.id ??
    result.sessionId ??
    result.conversationId ??
    result.id ??
    null
  );
}

function extractItem(params) {
  if (!params || typeof params !== 'object') return null;
  return params.item ?? params.threadItem ?? null;
}

function extractDeltaText(params) {
  if (!params || typeof params !== 'object') return null;
  if (typeof params.delta === 'string') return params.delta;
  if (typeof params.text === 'string') return params.text;
  for (const candidate of [params.item, params.threadItem, params.msg, params.message]) {
    if (!candidate || typeof candidate !== 'object') continue;
    if (typeof candidate.text === 'string') return candidate.text;
    if (typeof candidate.delta === 'string') return candidate.delta;
  }
  return null;
}

function toolData(params) {
  const item = extractItem(params);
  const src = item && typeof item === 'object' && Object.keys(item).length ? item : params ?? {};
  return {
    itemId: src.id ?? src.itemId ?? src.call_id ?? src.callId ?? null,
    itemType: src.type ?? null,
    command: src.command ?? src.cmd ?? null,
    title: src.title ?? src.summary ?? null,
    item: item ?? null,
  };
}

export function createCodexAppServerDriver(options = {}) {
  const {
    command = 'codex',
    args = [],
    cwd,
    env,
    model,
    providerSessionId = null,
    onEvent,
    _spawn,
    maxLineBytes = DEFAULT_MAX_LINE_BYTES,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    disposeGraceMs = 1000,
  } = options;

  if (typeof onEvent !== 'function') throw new TypeError('onEvent callback is required');
  const spawnFn = typeof _spawn === 'function' ? _spawn : spawn;

  let child = null;
  let pid = null;
  let disposed = false;
  let threadReady = false;
  let turnActive = false;
  let turnEndLatch = false;
  let currentThreadId = providerSessionId == null ? null : String(providerSessionId);
  let resumedExisting = false;
  let nextRequestId = 1;
  let seqCounter = 0;
  let lineBuf = '';
  let droppingLine = false;
  let stderrTail = '';
  const decoder = new StringDecoder('utf8');
  const pending = new Map();
  const sendQueue = [];
  let startPromise = null;

  const emit = (type, data = {}) => {
    seqCounter += 1;
    const envelope = {
      seq: seqCounter,
      type,
      ts: new Date().toISOString(),
      providerSessionId: currentThreadId,
      data,
    };
    try {
      onEvent(envelope);
    } catch {}
    return envelope;
  };

  const buildArgs = () => {
    const out = ['app-server', '--listen', 'stdio://'];
    const extra = Array.isArray(args) ? args.map(String) : [];
    out.push(...extra);
    if (model) {
      const hasModel = extra.some(
        (a, i) =>
          String(a).startsWith('model=') ||
          (a === '--config' && String(extra[i + 1] ?? '').startsWith('model=')),
      );
      if (!hasModel) out.push('--config', `model=${model}`);
    }
    return out;
  };

  const buildSpawnOptions = () => ({
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const writeLine = (obj) => {
    if (!child || !child.stdin) throw new Error('transport closed');
    child.stdin.write(JSON.stringify(obj) + '\n');
  };

  const request = (method, params = {}, { timeoutMs = requestTimeoutMs } = {}) => {
    const id = nextRequestId++;
    let entry;
    const promise = new Promise((resolve, reject) => {
      entry = { id, method, resolve, reject };
    });
    entry.timer = setTimeout(() => {
      if (pending.delete(id)) {
        const err = new Error(`request ${method} timed out after ${timeoutMs}ms`);
        err.code = 'ETIMEDOUT';
        err.method = method;
        entry.reject(err);
      }
    }, timeoutMs);
    pending.set(id, entry);
    try {
      writeLine({ jsonrpc: '2.0', id, method, params });
    } catch (err) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(err);
    }
    return promise;
  };

  const rejectAllPending = (message) => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message || `driver disposed before ${entry.method} completed`));
    }
    pending.clear();
  };

  const handleResponse = (msg) => {
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error && typeof msg.error === 'object') {
      const err = new Error(msg.error.message || `request ${entry.method} failed`);
      err.code = msg.error.code;
      err.data = msg.error.data;
      entry.reject(err);
    } else {
      entry.resolve(msg.result);
    }
  };

  const finishTurn = (status, params) => {
    if (turnEndLatch) return;
    turnEndLatch = true;
    turnActive = false;
    emit('turn_ended', {
      status,
      threadId: currentThreadId,
      usage: params?.usage ?? params?.tokenUsage ?? null,
    });
    emit('done', { reason: status === 'ok' ? 'task_complete' : 'task_failed' });
  };

  const handleNotification = (method, params) => {
    const m = String(method).toLowerCase();

    if (
      m.includes('task_complete') ||
      m.includes('taskcompleted') ||
      m.includes('task/completed') ||
      (m.includes('turn') &&
        (m.includes('complete') || m.includes('finish') || m.includes('ended')))
    ) {
      return finishTurn('ok', params);
    }
    if (
      m.includes('task_failed') ||
      m.includes('taskfailed') ||
      m.includes('task/failed') ||
      (m.includes('turn') && m.includes('fail'))
    ) {
      return finishTurn('failed', params);
    }
    if (m.includes('turn') && (m.includes('start') || m.includes('begin'))) {
      turnEndLatch = false;
      turnActive = true;
      return emit('turn_started', { threadId: currentThreadId });
    }
    if (m.includes('delta')) {
      const text = extractDeltaText(params);
      const item = extractItem(params);
      const reasoning =
        m.includes('reasoning') ||
        String(item?.type ?? '').toLowerCase().includes('reasoning');
      return emit(reasoning ? 'thinking_delta' : 'text_delta', { text });
    }
    if (TOOLISH_RE.test(m) && (m.includes('begin') || m.includes('start'))) {
      return emit('tool_call_start', toolData(params));
    }
    if (TOOLISH_RE.test(m) && (m.includes('end') || m.includes('finish') || m.includes('complete'))) {
      return emit('tool_call_end', toolData(params));
    }
    if (m.includes('item')) {
      const item = extractItem(params);
      const itemType = String(item?.type ?? '').toLowerCase();
      if (m.includes('start') || m.includes('begin')) {
        if (TOOLISH_RE.test(itemType)) return emit('tool_call_start', toolData(params));
        return undefined;
      }
      if (m.includes('complete') || m.includes('end')) {
        if (TOOLISH_RE.test(itemType)) return emit('tool_call_end', toolData(params));
        return undefined;
      }
    }
    return undefined;
  };

  const handleServerRequest = (msg) => {
    const method = String(msg.method);
    if (APPROVAL_RE.test(method)) {
      return emit('permission_request', {
        requestId: msg.id,
        method,
        payload: msg.params ?? {},
      });
    }
    try {
      writeLine({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: 'unsupported server request' },
      });
    } catch {}
    return undefined;
  };

  const handleLine = (line) => {
    if (!line.trim()) return;
    emit('raw', { line });
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      emit('error', { code: 'malformed_line', message: 'unparseable inbound line dropped' });
      return;
    }
    if (!msg || typeof msg !== 'object') {
      emit('error', { code: 'malformed_frame', message: 'inbound frame is not an object' });
      return;
    }
    if (msg.method !== undefined) {
      if (msg.id !== undefined && msg.id !== null) return handleServerRequest(msg);
      return handleNotification(msg.method, msg.params ?? {});
    }
    if (msg.id !== undefined && msg.id !== null) return handleResponse(msg);
    return undefined;
  };

  const handleChunk = (chunk) => {
    lineBuf += decoder.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    let idx;
    while ((idx = lineBuf.indexOf('\n')) !== -1) {
      const line = lineBuf.slice(0, idx).replace(/\r$/, '');
      lineBuf = lineBuf.slice(idx + 1);
      if (droppingLine) {
        droppingLine = false;
        continue;
      }
      handleLine(line);
    }
    if (!droppingLine && lineBuf.length > maxLineBytes) {
      droppingLine = true;
      lineBuf = '';
      emit('error', {
        code: 'line_overflow',
        message: `inbound line exceeded ${maxLineBytes} bytes; dropped`,
      });
    }
  };

  const handleTransportExit = (code) => {
    rejectAllPending('codex app-server process exited');
    if (disposed) return;
    emit('error', { code: 'process_exit', exitCode: code, stderrTail });
    emit('done', { reason: 'exit' });
  };

  const buildInput = (entry) => {
    const items = Array.isArray(entry.meta?.input) ? entry.meta.input.slice() : [];
    items.push({ type: 'text', text: String(entry.text) });
    return items;
  };

  const dispatchSend = async (entry) => {
    const input = buildInput(entry);
    const wantsSteer = entry.meta?.steer === true || turnActive;
    const method = wantsSteer ? 'turn/steer' : 'turn/start';
    try {
      await request(method, { threadId: currentThreadId, input });
      if (method === 'turn/start') {
        turnEndLatch = false;
        turnActive = true;
        emit('turn_started', { threadId: currentThreadId });
      }
    } catch (err) {
      if (!disposed) {
        emit('error', {
          code: 'turn_dispatch_failed',
          method,
          message: err?.message ?? String(err),
        });
      }
    }
  };

  const flushQueue = () => {
    const queued = sendQueue.splice(0);
    for (const entry of queued) dispatchSend(entry);
  };

  const handshake = async () => {
    await request('initialize', {
      clientInfo: { ...CLIENT_INFO },
      capabilities: { experimentalApi: true },
    });
    writeLine({ jsonrpc: '2.0', method: 'initialized', params: {} });
  };

  const ensureThread = async () => {
    if (currentThreadId) {
      resumedExisting = true;
      await request('thread/resume', { threadId: currentThreadId });
      return;
    }
    const result = await request('thread/start', {});
    const threadId = extractThreadId(result);
    if (!threadId) throw new Error('thread/start returned no thread id');
    currentThreadId = String(threadId);
  };

  const send = (text, meta = {}) => {
    if (disposed) throw new Error('driver disposed');
    const entry = {
      text: String(text),
      meta: meta && typeof meta === 'object' ? meta : {},
    };
    if (!threadReady) {
      sendQueue.push(entry);
      return;
    }
    dispatchSend(entry);
  };

  const steer = (text) => send(text, { steer: true });

  const interrupt = async () => {
    if (disposed) throw new Error('driver disposed');
    if (!threadReady || !currentThreadId) throw new Error('thread not ready');
    await request('turn/interrupt', { threadId: currentThreadId });
  };

  const approve = (requestId, result) => {
    if (disposed) throw new Error('driver disposed');
    const payload = result === undefined ? null : result;
    writeLine({ jsonrpc: '2.0', id: requestId, result: payload });
    emit('permission_resolved', { requestId, result: payload });
  };

  const dispose = async (opts = {}) => {
    if (disposed) return;
    disposed = true;
    rejectAllPending();
    emit('done', { reason: 'disposed' });
    const target = child;
    if (!target) return;
    const exited = new Promise((resolve) => {
      if (target.exitCode != null || target.signalCode != null) resolve();
      else target.once('exit', () => resolve());
    });
    try {
      target.kill('SIGTERM');
    } catch {}
    const grace = opts.graceMs ?? disposeGraceMs;
    const timedOut = await Promise.race([exited.then(() => false), delay(grace).then(() => true)]);
    if (timedOut) {
      try {
        target.kill('SIGKILL');
      } catch {}
      await Promise.race([exited, delay(grace)]);
    }
    try {
      target.removeAllListeners();
      target.stdout?.removeAllListeners();
      target.stderr?.removeAllListeners();
    } catch {}
    child = null;
    threadReady = false;
  };

  const start = () => {
    if (startPromise) return startPromise;
    let bootResolve;
    let bootReject;
    let settledBoot = false;
    startPromise = new Promise((resolve, reject) => {
      bootResolve = resolve;
      bootReject = reject;
    });
    startPromise.catch(() => {});
    const bootFail = (err) => {
      if (settledBoot) return;
      settledBoot = true;
      bootReject(err instanceof Error ? err : new Error(String(err)));
    };

    const run = async () => {
      const spawned = spawnFn(command, buildArgs(), buildSpawnOptions());
      child = spawned;
      pid = spawned.pid ?? null;
      spawned.stdout?.on?.('data', handleChunk);
      spawned.stderr?.on?.('data', (chunk) => {
        stderrTail = (stderrTail + String(chunk)).slice(-8192);
      });
      spawned.on?.('error', (err) => {
        bootFail(err);
        rejectAllPending('codex app-server process error');
        if (!disposed) emit('error', { code: 'process_error', message: err?.message });
      });
      spawned.on?.('exit', (code) => {
        bootFail(new Error(`codex app-server exited during startup (code ${code})`));
        handleTransportExit(code);
      });

      await handshake();
      await ensureThread();
      threadReady = true;
      emit('session_ready', {
        providerSessionId: currentThreadId,
        resumed: resumedExisting,
        pid,
      });
      flushQueue();
      settledBoot = true;
      bootResolve({ pid });
    };

    run().catch(bootFail);
    return startPromise;
  };

  return { start, send, steer, interrupt, approve, dispose };
}
