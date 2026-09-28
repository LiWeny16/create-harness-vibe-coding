import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SUPPORTED_MODES = Object.freeze(['ask', 'allow', 'deny']);
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_LINE_LIMIT = 16 * 1024 * 1024;
const DEFAULT_EXTENSION_PATH = fileURLToPath(new URL('../../../extensions/pi-host-gate/index.ts', import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPiRpcDriver(options = {}) {
  const {
    command = 'pi', args = [], cwd, env, providerSessionId = '', onEvent = () => {},
    permissionMode = 'ask', extensionPath = DEFAULT_EXTENSION_PATH,
    _spawn = spawn, _uuid = randomUUID, _graceMs = 300, _killGraceMs = 300,
    _requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, _maxLineBytes = DEFAULT_LINE_LIMIT,
  } = options;
  if (!SUPPORTED_MODES.includes(String(permissionMode))) throw new Error(`unsupported Pi permission mode: ${permissionMode}`);

  let child = null;
  let started = false;
  let disposed = false;
  let exited = false;
  let lineBuf = '';
  let droppingLine = false;
  let mode = String(permissionMode);
  let sessionId = String(providerSessionId || '');
  let seq = 0;
  const decoder = new StringDecoder('utf8');
  const pendingModes = new Map();
  const pendingApprovals = new Map();

  function emit(type, payload = {}) {
    try { onEvent({ seq: ++seq, ts: new Date().toISOString(), type, payload }); } catch {}
  }

  function writeLine(record) {
    if (!child?.stdin || disposed || exited || child.stdin.destroyed) return false;
    try { child.stdin.write(`${JSON.stringify(record)}\n`); return true; } catch { return false; }
  }

  function rejectPendingModes(message) {
    for (const pending of pendingModes.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    pendingModes.clear();
  }

  function denyPendingApprovals() {
    for (const [id] of pendingApprovals) {
      writeLine({ type: 'extension_ui_response', id, confirmed: false, cancelled: true });
    }
    pendingApprovals.clear();
  }

  function handleExtensionRequest(record) {
    if (record.method !== 'confirm' || record.id === undefined || record.id === null) return;
    const id = String(record.id);
    if (pendingApprovals.has(id)) return;
    const title = String(record.title || 'Permission required');
    const message = String(record.message || 'Pi requested permission.');
    const tool = title.startsWith('Permission required: ')
      ? title.slice('Permission required: '.length)
      : 'Pi tool';
    pendingApprovals.set(id, { id });
    emit('permission_request', {
      requestId: id,
      tool,
      input: { summary: message },
      title,
    });
  }

  function handleResponse(record) {
    if (record.type !== 'response' || record.id === undefined || record.id === null) return;
    const pending = pendingModes.get(String(record.id));
    if (!pending || record.command !== 'prompt') return;
    pendingModes.delete(String(record.id));
    clearTimeout(pending.timer);
    if (record.success === true && record.data?.disposition === 'handled') {
      mode = pending.mode;
      pending.resolve(true);
    } else {
      pending.reject(new Error(String(record.error || record.data?.error || 'Pi rejected the permission mode change')));
    }
  }

  function handleEvent(record) {
    const type = String(record.type || '');
    if (type === 'extension_ui_request') return handleExtensionRequest(record);
    if (type === 'response') return handleResponse(record);
    if (type === 'session_start' || type === 'session_started') {
      const id = record.sessionId ?? record.session_id ?? record.data?.sessionId ?? record.data?.session_id;
      if (id) {
        sessionId = String(id);
        emit('session_ready', { providerSessionId: sessionId, resumed: Boolean(providerSessionId) });
      }
      return;
    }
    if (type === 'agent_start') { emit('turn_started', { providerSessionId: sessionId || null }); return; }
    if (type === 'agent_end') { emit('turn_ended', { providerSessionId: sessionId || null }); emit('done', { reason: 'turn_complete' }); return; }
    if (type === 'message_update') {
      const event = record.assistantMessageEvent || record.event || {};
      if (event.type === 'text_delta') emit('text_delta', { delta: String(event.delta || '') });
      else if (event.type === 'thinking_delta') emit('thinking_delta', { delta: String(event.delta || '') });
      return;
    }
    if (type === 'tool_execution_start') {
      emit('tool_call_start', {
        callId: record.toolCallId ?? record.callId ?? null,
        name: String(record.toolName ?? record.name ?? 'tool'),
        input: record.args ?? record.input ?? {},
      });
      return;
    }
    if (type === 'tool_execution_end') {
      emit('tool_call_end', {
        callId: record.toolCallId ?? record.callId ?? null,
        output: record.result ?? record.output ?? null,
        isError: Boolean(record.isError ?? record.is_error),
      });
      return;
    }
    if (type === 'error') emit('error', { message: String(record.message || record.error || 'Pi RPC error') });
  }

  function handleLine(line) {
    if (!line.trim()) return;
    let record;
    try { record = JSON.parse(line); } catch { emit('error', { code: 'malformed_line', message: 'unparseable Pi RPC line dropped' }); return; }
    if (!record || typeof record !== 'object') return;
    handleEvent(record);
  }

  function handleChunk(chunk) {
    lineBuf += decoder.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    let index;
    while ((index = lineBuf.indexOf('\n')) !== -1) {
      const line = lineBuf.slice(0, index).replace(/\r$/, '');
      lineBuf = lineBuf.slice(index + 1);
      if (droppingLine) { droppingLine = false; continue; }
      handleLine(line);
    }
    if (!droppingLine && lineBuf.length > _maxLineBytes) {
      droppingLine = true;
      lineBuf = '';
      emit('error', { code: 'line_overflow', message: `Pi RPC line exceeded ${_maxLineBytes} bytes; dropped` });
    }
  }

  function onExit(code, signal) {
    if (exited) return;
    exited = true;
    rejectPendingModes('Pi RPC process exited before confirming permission mode');
    pendingApprovals.clear();
    if (!disposed) {
      emit('error', { code: 'process_exit', exitCode: code, signal });
      emit('done', { reason: 'exit' });
    }
  }

  function start() {
    if (started) throw new Error('Pi RPC driver already started');
    if (disposed) throw new Error('Pi RPC driver disposed');
    started = true;
    const spawnArgs = ['--mode', 'rpc', '--extension', String(extensionPath), ...(Array.isArray(args) ? args.map(String) : [])];
    child = _spawn(command, spawnArgs, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout?.on?.('data', handleChunk);
    child.stderr?.on?.('data', () => {});
    child.on?.('error', (err) => emit('error', { code: 'process_error', message: err?.message || String(err) }));
    child.on?.('exit', onExit);
    return { pid: child.pid ?? null };
  }

  function send(text) {
    if (!started || disposed || exited) throw new Error('Pi RPC driver is not running');
    const message = String(text ?? '');
    if (!message) return false;
    return writeLine({ type: 'prompt', message });
  }

  async function setPermissionMode(nextMode) {
    const value = String(nextMode || '');
    if (!SUPPORTED_MODES.includes(value)) throw new Error(`unsupported Pi permission mode: ${value}`);
    if (!started || disposed || exited) throw new Error('Pi RPC driver is not running');
    const id = String(_uuid());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pendingModes.delete(id)) return;
        reject(new Error('Pi did not confirm the permission mode change before timeout'));
      }, _requestTimeoutMs);
      pendingModes.set(id, { mode: value, timer, resolve, reject });
      if (!writeLine({ id, type: 'prompt', message: `/harness-permission-mode ${value}` })) {
        clearTimeout(timer);
        pendingModes.delete(id);
        reject(new Error('Could not send permission mode command to Pi'));
      }
    });
  }

  function approve(requestId, decision) {
    const id = String(requestId || '');
    if (!['allow', 'deny'].includes(String(decision)) || !pendingApprovals.has(id)) return false;
    const written = writeLine({ type: 'extension_ui_response', id, confirmed: decision === 'allow' });
    if (!written) return false;
    pendingApprovals.delete(id);
    return true;
  }

  function interrupt() {
    if (!started || disposed || exited) return false;
    return writeLine({ type: 'abort' });
  }

  async function dispose() {
    if (disposed) return;
    denyPendingApprovals();
    disposed = true;
    rejectPendingModes('Pi RPC driver disposed before confirming permission mode');
    const target = child;
    if (!target) return;
    const waitExit = () => new Promise((resolve) => {
      if (exited || target.exitCode != null || target.signalCode != null) return resolve();
      target.once?.('exit', resolve);
    });
    const exitedPromise = waitExit();
    try { target.kill?.('SIGTERM'); } catch {}
    if (!(await Promise.race([exitedPromise.then(() => false), delay(_graceMs).then(() => true)]))) return;
    try { target.kill?.('SIGKILL'); } catch {}
    await Promise.race([exitedPromise, delay(_killGraceMs)]);
  }

  return {
    runtime: 'pi',
    transport: 'rpc',
    supportedModes: SUPPORTED_MODES,
    get permissionMode() { return mode; },
    get providerSessionId() { return sessionId || null; },
    start,
    send,
    steer: send,
    interrupt,
    approve,
    setPermissionMode,
    dispose,
  };
}

export default createPiRpcDriver;
