import { spawn as nodeSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

/**
 * Claude Code chat driver over the stream-json protocol
 * (`--output-format stream-json --input-format stream-json`, no `-p`; piped stdout auto-headless).
 *
 * Canonical envelope: { seq: number (starts at 1, monotonic), ts: ISO string, type, payload }.
 * Envelope types:
 *   session_ready      { sessionId }
 *   turn_started       {}
 *   text_delta         { delta }
 *   thinking_delta     { delta }
 *   tool_call_start    { callId, name, input }
 *   tool_call_end      { callId, isError }
 *   user_ask           { callId, name, input }        (AskUserQuestion-like tool_use)
 *   permission_request { requestId, toolName, input } (inbound control_request can_use_tool)
 *   turn_ended         { subtype, isError, result?, usage?, numTurns?, costUsd? }
 *   done               { reason: 'result' | 'exit', ... }  (emitted at most once)
 *   error              { stage, message, code? }
 *   raw                { data }                       (every stdout line verbatim, before its parse result)
 */

const ASK_USER_TOOL = /ask[-_]?user/i;

function extractArgValue(args, flag) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
    if (typeof args[i] === 'string' && args[i].startsWith(flag + '=')) {
      return args[i].slice(flag.length + 1);
    }
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createClaudeDriver(options = {}) {
  const {
    command = 'claude',
    args = [],
    cwd,
    env,
    model,
    providerSessionId = null,
    onEvent = () => {},
    _spawn = nodeSpawn,
    _graceMs = 300,
    _killGraceMs = 300,
    _uuid = () => randomUUID(),
  } = options;

  let seq = 0;
  let child = null;
  let started = false;
  let disposed = false;
  let sessionEmitted = false;
  let inTurn = false;
  let doneEmitted = false;
  let stderrTail = '';
  let closePromise = null;
  const pendingPermissions = new Set();

  const emit = (type, payload) => {
    seq += 1;
    try {
      onEvent({ seq, ts: new Date().toISOString(), type, payload });
    } catch {}
  };

  const emitSessionReady = (sessionId) => {
    if (sessionEmitted || !sessionId) return;
    sessionEmitted = true;
    emit('session_ready', { sessionId });
  };

  const markTurnStarted = () => {
    if (inTurn) return;
    inTurn = true;
    emit('turn_started', {});
  };

  function buildArgs() {
    const out = [...args];
    if (model && !out.includes('--model')) out.push('--model', model);
    return out;
  }

  function writeLine(obj) {
    if (disposed || !child || !child.stdin || child.stdin.destroyed) return false;
    try {
      child.stdin.write(JSON.stringify(obj) + '\n');
      return true;
    } catch {
      return false;
    }
  }

  const writeUserTurn = (text) =>
    writeLine({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
    });

  function handleStreamEvent(frame) {
    markTurnStarted();
    const ev = frame.event && typeof frame.event === 'object' ? frame.event : {};
    if (ev.type !== 'content_block_delta') return;
    const delta = ev.delta && typeof ev.delta === 'object' ? ev.delta : {};
    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      emit('text_delta', { delta: delta.text });
    } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      emit('thinking_delta', { delta: delta.thinking });
    }
  }

  function handleBlocks(blocks) {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        markTurnStarted();
        emit('text_delta', { delta: block.text });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        markTurnStarted();
        emit('thinking_delta', { delta: block.thinking });
      } else if (block.type === 'tool_use') {
        markTurnStarted();
        const payload = {
          callId: block.id,
          name: block.name,
          input: block.input && typeof block.input === 'object' ? block.input : {},
        };
        emit('tool_call_start', payload);
        if (typeof block.name === 'string' && ASK_USER_TOOL.test(block.name)) {
          emit('user_ask', payload);
        }
      }
    }
  }

  function handleUser(frame) {
    const message = frame.message && typeof frame.message === 'object' ? frame.message : {};
    const content = Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'tool_result') {
        emit('tool_call_end', {
          callId: block.tool_use_id,
          isError: Boolean(block.is_error),
        });
      }
    }
  }

  function handleResult(frame) {
    emitSessionReady(frame.session_id);
    const isError = frame.subtype ? frame.subtype !== 'success' : Boolean(frame.is_error);
    const payload = { subtype: frame.subtype, isError };
    if (typeof frame.result === 'string') payload.result = frame.result;
    if (frame.usage && typeof frame.usage === 'object') payload.usage = frame.usage;
    if (frame.num_turns != null) payload.numTurns = frame.num_turns;
    if (frame.total_cost_usd != null) payload.costUsd = frame.total_cost_usd;
    inTurn = false;
    emit('turn_ended', payload);
    if (!doneEmitted) {
      doneEmitted = true;
      emit('done', { reason: 'result', ...payload });
    }
  }

  function handleControlRequest(frame) {
    // Liberal parse: fields may sit at top level or nested under `.request`.
    const inner = frame.request && typeof frame.request === 'object' ? frame.request : {};
    const subtype = inner.subtype ?? frame.subtype;
    if (subtype !== 'can_use_tool') return;
    const requestId =
      inner.request_id ?? frame.request_id ?? inner.requestId ?? frame.requestId;
    const toolName =
      inner.tool_name ?? frame.tool_name ?? (inner.tool && inner.tool.name) ?? '';
    const input = inner.input ?? frame.input ?? (inner.tool && inner.tool.input) ?? {};
    if (requestId != null) pendingPermissions.add(requestId);
    emit('permission_request', { requestId, toolName, input });
  }

  function handleLine(line) {
    emit('raw', { data: line });
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object' || typeof frame.type !== 'string') return;
    switch (frame.type) {
      case 'stream_event':
        handleStreamEvent(frame);
        break;
      case 'assistant':
        handleBlocks(
          frame.message && typeof frame.message === 'object' ? frame.message.content : []
        );
        break;
      case 'user':
        handleUser(frame);
        break;
      case 'result':
        handleResult(frame);
        break;
      case 'system':
        if (frame.subtype === 'init') emitSessionReady(frame.session_id);
        break;
      case 'control_request':
        handleControlRequest(frame);
        break;
      default:
        break;
    }
  }

  function onceClose() {
    if (!closePromise) {
      closePromise = new Promise((resolve) => {
        if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once('close', () => resolve());
      });
    }
    return closePromise;
  }

  const exited = () => !child || child.exitCode !== null || child.signalCode !== null;

  function start() {
    if (started) throw new Error('claude driver already started');
    started = true;
    child = _spawn(command, buildArgs(), {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    if (child.stdin && typeof child.stdin.on === 'function') {
      child.stdin.on('error', () => {});
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + String(chunk)).slice(-4000);
      });
    }
    if (child.stdout && typeof child.stdout.on === 'function') {
      const rl = createInterface({ input: child.stdout });
      rl.on('line', handleLine);
    }

    // Pre-assigned session id (fresh sessions) -> ready immediately.
    // Resume sessions wait for the result frame's session_id instead.
    emitSessionReady(extractArgValue(buildArgs(), '--session-id'));

    if (typeof child.on === 'function') {
      child.on('error', (err) => {
        emit('error', {
          stage: 'process',
          message: String((err && err.message) || err),
          code: err && err.code,
        });
      });
      child.once('close', (code, signal) => {
        if (!doneEmitted) {
          doneEmitted = true;
          const payload = { reason: 'exit', code, signal };
          if (stderrTail) payload.stderrTail = stderrTail;
          emit('done', payload);
        }
      });
    }

    return { pid: child && child.pid != null ? child.pid : null };
  }

  function send(text) {
    if (typeof text !== 'string' || text.length === 0) return false;
    return writeUserTurn(text);
  }

  function steer(text) {
    return send(text);
  }

  function interrupt() {
    return writeLine({
      type: 'control_request',
      request_id: _uuid(),
      subtype: 'interrupt',
    });
  }

  function approve(requestId, decision) {
    let behavior;
    let updatedInput;
    if (decision && typeof decision === 'object') {
      behavior = decision.behavior;
      updatedInput = decision.updatedInput;
    } else {
      behavior = decision;
    }
    const response = { behavior: behavior === 'allow' ? 'allow' : 'deny' };
    if (updatedInput !== undefined) response.updatedInput = updatedInput;
    pendingPermissions.delete(requestId);
    return writeLine({
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response },
    });
  }

  function setPermissionMode(mode) {
    return writeLine({
      type: 'control_request',
      request_id: _uuid(),
      subtype: 'set_permission_mode',
      mode,
    });
  }

  async function dispose() {
    if (disposed) return onceClose();
    disposed = true;
    if (!started || !child) return;
    try {
      if (child.stdin && !child.stdin.destroyed) child.stdin.end();
    } catch {}
    await Promise.race([onceClose(), sleep(_graceMs)]);
    if (!exited()) {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
    await Promise.race([onceClose(), sleep(_killGraceMs)]);
    if (!exited()) {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
    await Promise.race([onceClose(), sleep(1000)]);
  }

  return {
    runtime: 'claude',
    transport: 'stream-json',
    get pid() {
      return child && child.pid != null ? child.pid : null;
    },
    get providerSessionId() {
      return providerSessionId;
    },
    start,
    send,
    steer,
    interrupt,
    approve,
    setPermissionMode,
    dispose,
  };
}

export default createClaudeDriver;
