import { appendChatEnvelope } from './chat-store.mjs';

// ── Chat driver factory + live registry ──
// One structured-stdio driver per chat session. Driver MODULES are built by
// parallel workers and resolved lazily via dynamic import here; this module
// owns the seams: the canonical onEvent pipeline (seq assignment + persistence
// + broadcast), turn-state tracking for steering, and the live registry that
// sendTo/interrupt/approve/dispose operate on.
export class ChatDriverError extends Error {
  constructor(message, code = 'CHAT_DRIVER_ERROR', details = null) {
    super(message);
    this.name = 'ChatDriverError';
    this.code = code;
    this.details = details;
  }
}

const CHAT_DRIVER_MODULES = {
  claude: () => import('./drivers/claude-stream-json.mjs'),
  cc: () => import('./drivers/claude-stream-json.mjs'),
  codex: () => import('./drivers/codex-appserver.mjs'),
  opencode: () => import('./drivers/opencode-server.mjs'),
  pi: () => import('./drivers/pi-rpc.mjs'),
};

/** sessionId -> { sessionId, runtime, driver, midTurn, providerSessionId, projectRoot, session, onSessionReady, onEnded, createdAt } */
const liveDrivers = new Map();

let chatEventBroadcaster = null;

/**
 * Register the sink that receives every persisted envelope for live broadcast
 * (ws-chat.mjs attaches its broadcastToSession here at server start).
 */
export function setChatEventBroadcaster(fn) {
  chatEventBroadcaster = typeof fn === 'function' ? fn : null;
}

export function hasLiveChatDriver(sessionId) {
  return liveDrivers.has(String(sessionId || ''));
}

export function getLiveChatDriverMeta(sessionId) {
  const entry = liveDrivers.get(String(sessionId || ''));
  if (!entry) return null;
  const supportedModes = Array.isArray(entry.driver.supportedModes)
    ? entry.driver.supportedModes
    : entry.supportedModes;
  return {
    sessionId: entry.sessionId,
    runtime: entry.runtime,
    midTurn: entry.midTurn,
    providerSessionId: entry.providerSessionId,
    supportedModes: [...supportedModes],
    permissionMode: String(entry.driver.permissionMode || entry.permissionMode),
  };
}

export function listLiveChatDriverSessionIds() {
  return [...liveDrivers.keys()];
}

/**
 * Register an already-constructed driver for a session. Also the injection
 * seam for tests (fake drivers). Enforces one driver per session.
 */
export function registerLiveChatDriver(sessionId, driver, meta = {}) {
  const id = String(sessionId || '');
  if (!id) throw new ChatDriverError('registerLiveChatDriver requires a sessionId', 'CHAT_DRIVER_INVALID_SESSION');
  if (!driver || typeof driver.send !== 'function') {
    throw new ChatDriverError('chat driver must expose at least send(text)', 'CHAT_DRIVER_SHAPE_INVALID');
  }
  if (liveDrivers.has(id)) {
    throw new ChatDriverError(`Chat driver already registered for session ${id}`, 'CHAT_DRIVER_EXISTS');
  }
  const entry = {
    sessionId: id,
    runtime: String(meta.runtime || ''),
    driver,
    supportedModes: Array.isArray(driver.supportedModes)
      ? [...new Set(driver.supportedModes.map(String).filter(Boolean))]
      : [],
    permissionMode: String(driver.permissionMode || ''),
    pendingApprovals: new Set(),
    midTurn: false,
    providerSessionId: meta.providerSessionId ? String(meta.providerSessionId) : '',
    projectRoot: meta.projectRoot || null,
    session: meta.session || { sessionId: id, taskId: null, runtime: String(meta.runtime || '') },
    onSessionReady: typeof meta.onSessionReady === 'function' ? meta.onSessionReady : null,
    onEnded: typeof meta.onEnded === 'function' ? meta.onEnded : null,
    createdAt: new Date().toISOString(),
  };
  liveDrivers.set(id, entry);
  return entry;
}

// ── Canonical event pipeline ──
// Drivers emit through onEvent; the pipeline normalizes to the frozen envelope
// shape, tracks turn state, persists via the chat store, and broadcasts.
function handleDriverEvent(sessionId, event) {
  const entry = liveDrivers.get(sessionId);
  if (!entry) return null; // events before registration/start are dropped
  let type = 'raw';
  let payload = {};
  if (event && typeof event === 'object') {
    if (event.type !== undefined && event.type !== null) type = String(event.type);
    if (event.payload !== undefined) payload = event.payload;
    else if (event.data !== undefined) payload = event.data;
    else {
      payload = { ...event };
      for (const key of ['seq', 'ts', 'type', 'sessionId', 'providerSessionId', 'raw']) delete payload[key];
    }
  } else {
    payload = { data: event === null || event === undefined ? '' : String(event) };
  }
  if (type === 'permission_request' && payload && typeof payload === 'object') {
    const nested = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    const request = nested.payload && typeof nested.payload === 'object' ? nested.payload : nested;
    payload = {
      requestId: nested.requestId ?? request.requestId ?? payload.requestId,
      tool: request.tool ?? request.toolName ?? nested.method ?? payload.tool ?? 'tool',
      input: request.input ?? request.params ?? request.payload ?? payload.input ?? {},
      ...(request.title || nested.title || payload.title ? { title: request.title || nested.title || payload.title } : {}),
    };
  }
  if (type === 'turn_started') entry.midTurn = true;
  if (type === 'turn_ended' || type === 'done' || type === 'error') entry.midTurn = false;
  if (type === 'session_ready' && payload && payload.providerSessionId) {
    entry.providerSessionId = String(payload.providerSessionId);
  }
  if (type === 'permission_request') {
    const requestId = payload?.requestId ?? payload?.data?.requestId;
    if (requestId !== undefined && requestId !== null && String(requestId)) {
      entry.pendingApprovals.add(String(requestId));
    }
  }
  const envelope = appendChatEnvelope(entry.projectRoot, entry.session, { type, payload });
  if (type === 'session_ready' && entry.onSessionReady) {
    try { entry.onSessionReady(envelope.payload.providerSessionId || ''); } catch { /* handler must not break the stream */ }
  }
  if ((type === 'done' || type === 'error') && entry.onEnded) {
    try { entry.onEnded({ type, payload }); } catch { /* handler must not break the stream */ }
  }
  try { chatEventBroadcaster?.(sessionId, envelope); } catch { /* disconnected clients are ignored */ }
  return envelope;
}

/**
 * Create (and register) the chat driver for a runtime. The driver module is
 * resolved lazily; tests inject fake modules via opts.driverModule
 * ({ default: factory }). The returned driver still needs start().
 */
export async function createChatDriver(runtime, opts = {}) {
  const loader = CHAT_DRIVER_MODULES[String(runtime)];
  if (!loader) {
    throw new ChatDriverError(
      `No chat driver for runtime '${runtime}'. Supported: ${Object.keys(CHAT_DRIVER_MODULES).join(', ')}`,
      'CHAT_DRIVER_UNSUPPORTED_RUNTIME',
      { runtime },
    );
  }
  const sessionId = String(opts.sessionId || opts.session?.sessionId || '');
  if (!sessionId) throw new ChatDriverError('createChatDriver requires a sessionId', 'CHAT_DRIVER_INVALID_SESSION');
  if (liveDrivers.has(sessionId)) {
    throw new ChatDriverError(`Chat driver already registered for session ${sessionId}`, 'CHAT_DRIVER_EXISTS');
  }
  const mod = opts.driverModule || await loader();
  const factory = mod?.default;
  if (typeof factory !== 'function') {
    throw new ChatDriverError(`Chat driver module for '${runtime}' has no default factory`, 'CHAT_DRIVER_MODULE_INVALID');
  }
  const driver = factory({
    runtime: String(runtime),
    command: String(opts.command || ''),
    args: Array.isArray(opts.args) ? [...opts.args] : [],
    cwd: String(opts.cwd || ''),
    env: opts.env && typeof opts.env === 'object' ? opts.env : {},
    model: String(opts.model || ''),
    effort: String(opts.effort || ''),
    effortVariant: String(opts.effortVariant || ''),
    providerSessionId: opts.providerSessionId ? String(opts.providerSessionId) : '',
    permissionMode: String(opts.permissionMode || ''),
    extensionPath: opts.extensionPath ? String(opts.extensionPath) : '',
    projectRoot: opts.projectRoot || '',
    onEvent: (event) => handleDriverEvent(sessionId, event),
  });
  registerLiveChatDriver(sessionId, driver, {
    runtime: String(runtime),
    providerSessionId: opts.providerSessionId,
    projectRoot: opts.projectRoot,
    session: opts.session,
    onSessionReady: opts.onSessionReady,
    onEnded: opts.onEnded,
  });
  return driver;
}

/**
 * Send text into a session's driver. steer=true means "use the steering
 * channel when a turn is active"; without an active turn it falls back to a
 * plain send so callers never need to track turn state themselves.
 * @returns {boolean} false when no live driver exists
 */
export function sendTo(sessionId, text, { steer = false } = {}) {
  const entry = liveDrivers.get(String(sessionId || ''));
  if (!entry) return false;
  const value = String(text ?? '');
  if (!value) return false;
  if (steer && entry.midTurn && typeof entry.driver.steer === 'function') {
    entry.driver.steer(value);
  } else {
    entry.driver.send(value);
  }
  return true;
}

export async function interrupt(sessionId) {
  const entry = liveDrivers.get(String(sessionId || ''));
  if (!entry || typeof entry.driver.interrupt !== 'function') return false;
  try {
    await entry.driver.interrupt();
    return true;
  } catch {
    return false;
  }
}

export async function approve(sessionId, requestId, result) {
  const entry = liveDrivers.get(String(sessionId || ''));
  const id = String(requestId || '');
  if (!entry || !id || !['allow', 'deny'].includes(String(result)) || typeof entry.driver.approve !== 'function') return false;
  if (!entry.pendingApprovals.has(id)) return false;
  entry.pendingApprovals.delete(id);
  try {
    const outcome = await entry.driver.approve(id, result);
    return outcome !== false && outcome?.ok !== false && outcome?.success !== false;
  } catch {
    return false;
  }
}

export async function setPermissionMode(sessionId, mode) {
  const entry = liveDrivers.get(String(sessionId || ''));
  const value = String(mode || '');
  if (!entry) throw new ChatDriverError('No live chat driver for this session', 'CHAT_DRIVER_NOT_FOUND');
  const supportedModes = Array.isArray(entry.driver.supportedModes)
    ? entry.driver.supportedModes
    : entry.supportedModes;
  if (!supportedModes.includes(value)) {
    throw new ChatDriverError(`Permission mode '${value}' is not supported by ${entry.runtime}`, 'CHAT_PERMISSION_MODE_UNSUPPORTED');
  }
  if (typeof entry.driver.setPermissionMode !== 'function') {
    throw new ChatDriverError(`Permission mode changes are not supported by ${entry.runtime}`, 'CHAT_PERMISSION_MODE_UNSUPPORTED');
  }
  const result = await entry.driver.setPermissionMode(value);
  if (result === false || result?.ok === false || result?.success === false) {
    throw new ChatDriverError(`Runtime did not confirm permission mode '${value}'`, 'CHAT_PERMISSION_MODE_UNCONFIRMED');
  }
  entry.permissionMode = String(entry.driver.permissionMode || value);
  return entry.permissionMode;
}

export async function dispose(sessionId, opts = {}) {
  const id = String(sessionId || '');
  const entry = liveDrivers.get(id);
  if (!entry) return false;
  liveDrivers.delete(id);
  try {
    await entry.driver.dispose?.(opts);
  } catch { /* dispose must never throw through stop paths */ }
  return true;
}

/** Test-only: drop every live driver and the broadcaster. */
export function __resetChatDriversForTests() {
  liveDrivers.clear();
  setChatEventBroadcaster(null);
}
