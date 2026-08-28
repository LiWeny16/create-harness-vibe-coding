import crypto from 'node:crypto';
import {
  appendStoreJsonl,
  isPlainObject,
  nodeRevisionLogPath,
  nodeStatePath,
  nodeStateRelPath,
  nodeStoreIndexPath,
  normalizePosition,
  readNodeIndex,
  readStoreJson,
  slugPart,
  writeNodeIndex,
  writeStoreJson,
} from './node-store-utils.mjs';
import { syncTimerScheduler } from './timer-wakeup-scheduler.mjs';

const EVENT_TYPES = new Set(['timer', 'github-trigger']);
const TIMER_SCHEDULE_MODES = new Set(['manual', 'once', 'interval', 'cron', 'loop', 'adaptive', 'watchdog', 'while', 'task']);
const NODE_ID_RE = /^event-[a-z0-9][a-z0-9-]*$/;
const STORE_DIR = 'event-nodes';

export class EventNodeError extends Error {
  constructor(message, { statusCode = 400, code = 'BAD_REQUEST' } = {}) {
    super(message);
    this.name = 'EventNodeError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function eventNodesIndexPath(projectRoot) {
  return nodeStoreIndexPath(projectRoot, STORE_DIR);
}

function normalizeType(type) {
  const value = String(type || '').trim().toLowerCase();
  if (!EVENT_TYPES.has(value)) {
    throw new EventNodeError('Invalid event node type; expected timer or github-trigger');
  }
  return value;
}

function generateNodeId(type, title) {
  return `event-${slugPart(title, type)}-${crypto.randomBytes(3).toString('hex')}`;
}

function assertNodeId(nodeId) {
  const value = String(nodeId || '').trim();
  if (!NODE_ID_RE.test(value)) {
    throw new EventNodeError('Invalid event node id; traversal and escaped ids are not allowed');
  }
  return value;
}

function normalizeNodeId(nodeId, type, title) {
  return assertNodeId(nodeId || generateNodeId(type, title));
}

function normalizeTitle(title, type) {
  const value = String(title || '').trim();
  if (value) return value;
  return type === 'timer' ? 'Timer Node' : 'Event Node';
}

function relStatePath(nodeId) {
  return nodeStateRelPath(STORE_DIR, nodeId);
}

function absoluteStatePath(projectRoot, statePath, nodeId) {
  return nodeStatePath(projectRoot, {
    storeDir: STORE_DIR,
    statePath,
    nodeId,
    ErrorClass: EventNodeError,
    label: 'event node',
    rootLabel: 'event',
  });
}

function clampInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeSchedule(value) {
  const source = isPlainObject(value) ? value : {};
  const mode = TIMER_SCHEDULE_MODES.has(String(source.mode || '').toLowerCase())
    ? String(source.mode).toLowerCase()
    : 'manual';
  const intervalSeconds = clampInteger(source.intervalSeconds, { min: 1, max: 86400, fallback: 60 });
  const cron = String(source.cron || '').trim();
  return {
    mode,
    intervalSeconds,
    triggerAt: normalizeIso(source.triggerAt),
    cron: mode === 'cron' ? cron : '',
    cadence: normalizeCadence(source.cadence, intervalSeconds),
  };
}

function normalizePayloadTemplate(value) {
  return isPlainObject(value) ? value : {};
}

function safeString(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeCadence(value, intervalSeconds = 60) {
  const source = isPlainObject(value) ? value : {};
  const kind = ['fixed', 'sequence', 'backoff', 'jitter'].includes(String(source.kind || '').toLowerCase())
    ? String(source.kind).toLowerCase()
    : 'fixed';
  const sequenceSeconds = Array.isArray(source.sequenceSeconds)
    ? source.sequenceSeconds
        .map(item => clampInteger(item, { min: 1, max: 86400, fallback: 0 }))
        .filter(Boolean)
        .slice(0, 32)
    : [];
  return {
    kind,
    sequenceSeconds: kind === 'sequence' ? (sequenceSeconds.length ? sequenceSeconds : [intervalSeconds]) : [],
    jitterSeconds: clampInteger(source.jitterSeconds, { min: 0, max: 3600, fallback: 0 }),
    backoffFactor: Number.isFinite(Number(source.backoffFactor))
      ? Math.max(1, Math.min(10, Number(source.backoffFactor)))
      : 2,
    maxIntervalSeconds: clampInteger(source.maxIntervalSeconds, { min: 1, max: 86400, fallback: intervalSeconds }),
  };
}

function normalizeIso(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

function normalizeHeartbeatLane(value, schedule, fallbackEnabled = false) {
  const source = isPlainObject(value) ? value : {};
  return {
    enabled: source.enabled !== undefined ? Boolean(source.enabled) : fallbackEnabled,
    intervalSeconds: clampInteger(source.intervalSeconds, {
      min: 1,
      max: 86400,
      fallback: clampInteger(schedule?.intervalSeconds, { min: 1, max: 86400, fallback: 60 }),
    }),
    lastAt: normalizeIso(source.lastAt),
    nextDueAt: normalizeIso(source.nextDueAt),
    count: clampInteger(source.count, { min: 0, fallback: 0 }),
  };
}

function normalizeWatchdog(value, schedule) {
  const source = isPlainObject(value) ? value : {};
  const enabled = source.enabled !== undefined ? Boolean(source.enabled) : false;
  const state = ['ok', 'waiting', 'missed', 'disabled'].includes(String(source.state || '').toLowerCase())
    ? String(source.state).toLowerCase()
    : (enabled ? 'ok' : 'disabled');
  return {
    enabled,
    intervalSeconds: clampInteger(source.intervalSeconds, {
      min: 1,
      max: 604800,
      fallback: Math.max(300, clampInteger(schedule?.intervalSeconds, { min: 1, max: 86400, fallback: 60 }) * 10),
    }),
    timeoutSeconds: clampInteger(source.timeoutSeconds, { min: 1, max: 604800, fallback: 1800 }),
    lastPingAt: normalizeIso(source.lastPingAt),
    lastAckAt: normalizeIso(source.lastAckAt),
    state,
    missedCount: clampInteger(source.missedCount, { min: 0, fallback: 0 }),
  };
}

function normalizeHeartbeat(value, schedule) {
  const source = isPlainObject(value) ? value : {};
  return {
    base: normalizeHeartbeatLane(source.base, schedule),
    watchdog: normalizeWatchdog(source.watchdog, schedule),
  };
}

function isoSecondsFromNow(seconds) {
  return new Date(Date.now() + clampInteger(seconds, { min: 1, max: 604800, fallback: 60 }) * 1000).toISOString();
}

function timerBaseIntervalSeconds(state, fallback = 60) {
  return clampInteger(state?.heartbeat?.base?.intervalSeconds ?? state?.schedule?.intervalSeconds, {
    min: 1,
    max: 604800,
    fallback,
  });
}

function normalizeTimerRuntimeClock(state, payload = {}, previous = {}) {
  const heartbeat = state.heartbeat || {};
  const base = { ...(heartbeat.base || {}) };
  const payloadSchedule = isPlainObject(payload.schedule) ? payload.schedule : {};
  const payloadHeartbeat = isPlainObject(payload.heartbeat) ? payload.heartbeat : {};
  const payloadBase = isPlainObject(payloadHeartbeat.base) ? payloadHeartbeat.base : {};
  const previousBase = isPlainObject(previous.heartbeat?.base) ? previous.heartbeat.base : {};
  const intervalSeconds = timerBaseIntervalSeconds(state);
  const previousIntervalSeconds = timerBaseIntervalSeconds(previous, intervalSeconds);
  const wasRunning = Boolean(previous.enabled && previousBase.enabled);
  const isRunning = Boolean(state.enabled && base.enabled);
  base.intervalSeconds = intervalSeconds;
  if (!isRunning) {
    base.nextDueAt = '';
    state.heartbeat = { ...heartbeat, base };
    return state;
  }

  const explicitNextDueAt = normalizeIso(payloadBase.nextDueAt);
  if (explicitNextDueAt) {
    base.nextDueAt = explicitNextDueAt;
  } else if (
    !base.nextDueAt
    || !wasRunning
    || intervalSeconds !== previousIntervalSeconds
    || payload.enabled === true
    || payloadSchedule.intervalSeconds !== undefined
    || payloadBase.intervalSeconds !== undefined
    || payloadBase.enabled === true
  ) {
    base.nextDueAt = isoSecondsFromNow(intervalSeconds);
  }
  state.heartbeat = { ...heartbeat, base };
  return state;
}

function normalizeLoop(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    enabled: source.enabled !== undefined ? Boolean(source.enabled) : false,
    runCount: clampInteger(source.runCount, { min: 0, fallback: 0 }),
    maxIterations: clampInteger(source.maxIterations, { min: 0, max: 1000000, fallback: 0 }),
    stopOnFailure: source.stopOnFailure !== undefined ? Boolean(source.stopOnFailure) : true,
  };
}

function normalizeWhileGuard(value) {
  const source = isPlainObject(value) ? value : {};
  const allowedSources = new Set(['watchdogAck', 'agentStatus', 'taskPhase', 'manual']);
  const allowedOps = new Set(['eq', 'neq', 'exists', 'not-exists']);
  return {
    source: allowedSources.has(String(source.source || 'manual')) ? String(source.source || 'manual') : 'manual',
    op: allowedOps.has(String(source.op || 'exists')) ? String(source.op || 'exists') : 'exists',
    value: safeString(source.value, 200),
  };
}

function normalizeTaskBinding(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    taskId: safeString(source.taskId, 120).replace(/[^A-Za-z0-9_.-]/g, ''),
    phases: uniqueStringList(source.phases, { maxItems: 20, maxLength: 80 }),
    stopWhenClosed: source.stopWhenClosed !== undefined ? Boolean(source.stopWhenClosed) : true,
  };
}

function normalizeControlPolicy(value) {
  const source = isPlainObject(value) ? value : {};
  const minIntervalSeconds = clampInteger(source.minIntervalSeconds, { min: 1, max: 86400, fallback: 5 });
  const maxIntervalSeconds = Math.max(
    minIntervalSeconds,
    clampInteger(source.maxIntervalSeconds, { min: minIntervalSeconds, max: 604800, fallback: 86400 }),
  );
  return {
    agentCanDisable: source.agentCanDisable !== undefined ? Boolean(source.agentCanDisable) : false,
    agentCanSetInterval: source.agentCanSetInterval !== undefined ? Boolean(source.agentCanSetInterval) : false,
    agentCanSetMode: source.agentCanSetMode !== undefined ? Boolean(source.agentCanSetMode) : true,
    agentCanAckWatchdog: source.agentCanAckWatchdog !== undefined ? Boolean(source.agentCanAckWatchdog) : true,
    minIntervalSeconds,
    maxIntervalSeconds,
  };
}

function normalizeGithubName(value, maxLength = 100) {
  return safeString(value, maxLength).replace(/[^A-Za-z0-9_.-]/g, '');
}

function normalizeGithubRepository(value) {
  const source = isPlainObject(value) ? value : {};
  const fullName = safeString(source.fullName || source.full_name, 220);
  const [fullOwner, fullRepo] = fullName.includes('/') ? fullName.split('/', 2) : ['', ''];
  const owner = normalizeGithubName(source.owner || fullOwner);
  const name = normalizeGithubName(source.name || source.repo || fullRepo);
  return {
    owner,
    name,
    fullName: owner && name ? `${owner}/${name}` : '',
  };
}

function uniqueStringList(value, { maxItems = 20, maxLength = 80 } = {}) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(value) ? value : []) {
    const normalized = safeString(item, maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function normalizeGithubEventFilters(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    events: uniqueStringList(source.events, { maxItems: 20, maxLength: 64 }),
    actions: uniqueStringList(source.actions, { maxItems: 30, maxLength: 64 }),
    branches: uniqueStringList(source.branches, { maxItems: 30, maxLength: 120 }),
    labels: uniqueStringList(source.labels, { maxItems: 30, maxLength: 120 }),
  };
}

const GITHUB_FORBIDDEN_KEY_RE = /^(?:headers?|authorization|cookie|secret|token|raw|rawbody|body|payload|signature|webhooksecret)$/i;

function sanitizeGithubMetadata(value, depth = 0) {
  if (depth > 4) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(item => sanitizeGithubMetadata(item, depth + 1)).filter(item => item !== undefined);
  }
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, rawValue] of Object.entries(value)) {
      if (GITHUB_FORBIDDEN_KEY_RE.test(key)) continue;
      const safeValue = sanitizeGithubMetadata(rawValue, depth + 1);
      if (safeValue !== undefined) result[key] = safeValue;
    }
    return result;
  }
  if (typeof value === 'string') return safeString(value, 500);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return undefined;
}

function normalizeGithubLastEvent(value, previous = null) {
  const source = isPlainObject(value) ? sanitizeGithubMetadata(value) : null;
  return isPlainObject(source) ? source : (isPlainObject(previous) ? sanitizeGithubMetadata(previous) : null);
}

function stateFor(type, payload, revision, previous = {}) {
  const lastEvent = type === 'github-trigger'
    ? normalizeGithubLastEvent(payload.lastEvent, previous.lastEvent)
    : (isPlainObject(payload.lastEvent) ? payload.lastEvent : (isPlainObject(previous.lastEvent) ? previous.lastEvent : null));
  const eventCount = Number.isFinite(Number(payload.eventCount ?? previous.eventCount))
    ? Math.max(0, Math.floor(Number(payload.eventCount ?? previous.eventCount)))
    : 0;
  const state = {
    type,
    revision,
    enabled: payload.enabled !== undefined ? Boolean(payload.enabled) : Boolean(previous.enabled),
    payloadTemplate: type === 'github-trigger'
      ? sanitizeGithubMetadata(normalizePayloadTemplate(payload.payloadTemplate !== undefined ? payload.payloadTemplate : previous.payloadTemplate))
      : normalizePayloadTemplate(payload.payloadTemplate !== undefined ? payload.payloadTemplate : previous.payloadTemplate),
    eventCount,
    lastFiredAt: String(payload.lastFiredAt || previous.lastFiredAt || ''),
    lastEvent,
  };
  if (type === 'timer') {
    state.schedule = normalizeSchedule(payload.schedule !== undefined ? payload.schedule : previous.schedule);
    state.heartbeat = normalizeHeartbeat(payload.heartbeat !== undefined ? payload.heartbeat : previous.heartbeat, state.schedule);
    normalizeTimerRuntimeClock(state, payload, previous);
    state.loop = normalizeLoop(payload.loop !== undefined ? payload.loop : previous.loop);
    state.whileGuard = normalizeWhileGuard(payload.whileGuard !== undefined ? payload.whileGuard : previous.whileGuard);
    state.taskBinding = normalizeTaskBinding(payload.taskBinding !== undefined ? payload.taskBinding : previous.taskBinding);
    state.controlPolicy = normalizeControlPolicy(payload.controlPolicy !== undefined ? payload.controlPolicy : previous.controlPolicy);
  }
  if (type === 'github-trigger') {
    state.repository = normalizeGithubRepository(payload.repository !== undefined ? payload.repository : previous.repository);
    state.eventFilters = normalizeGithubEventFilters(payload.eventFilters !== undefined ? payload.eventFilters : previous.eventFilters);
    state.deliveryCount = eventCount;
    state.lastReceivedAt = String(payload.lastReceivedAt || previous.lastReceivedAt || state.lastFiredAt || '');
    state.lastDeliveryId = safeString(payload.lastDeliveryId || previous.lastDeliveryId || lastEvent?.deliveryId || '', 120);
    state.dedupeKeys = uniqueStringList(payload.dedupeKeys !== undefined ? payload.dedupeKeys : previous.dedupeKeys, { maxItems: 50, maxLength: 180 });
  }
  return state;
}

function nodeFor({ nodeId, type, title, position, revision }) {
  const statePath = relStatePath(nodeId);
  return {
    id: nodeId,
    nodeId,
    kind: 'event-node',
    type,
    title,
    label: title,
    position,
    revision,
    statePath,
    stateRef: { path: statePath, revision },
    status: 'ready',
    lifecycle: 'event-source',
    runtimeState: 'ready',
    config: {
      eventType: type,
      backendSourceOfTruth: true,
    },
  };
}

function readIndex(projectRoot) {
  return readNodeIndex(eventNodesIndexPath(projectRoot));
}

function writeIndex(projectRoot, index) {
  writeNodeIndex(eventNodesIndexPath(projectRoot), index);
}

function revisionLogPath(projectRoot, nodeId) {
  return nodeRevisionLogPath(projectRoot, { storeDir: STORE_DIR, nodeId, assertNodeId });
}

function revisionRow(action, node, previousRevision = null) {
  return {
    action,
    nodeId: node.nodeId,
    type: node.type,
    revision: node.revision,
    previousRevision,
    statePath: node.statePath,
    recoverable: true,
    createdAt: new Date().toISOString(),
  };
}

function validatedIndexNode(projectRoot, node) {
  const nodeId = assertNodeId(node?.nodeId || node?.id);
  const type = normalizeType(node?.type);
  const revision = Number(node?.revision || 0);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new EventNodeError('Invalid event node revision');
  }
  absoluteStatePath(projectRoot, node.statePath, nodeId);
  return {
    ...nodeFor({
      nodeId,
      type,
      title: normalizeTitle(node?.title || node?.label, type),
      position: normalizePosition(node?.position),
      revision,
    }),
  };
}

export function createEventNode(projectRoot, payload = {}) {
  const type = normalizeType(payload.type);
  const title = normalizeTitle(payload.title, type);
  const nodeId = normalizeNodeId(payload.nodeId, type, title);
  const index = readIndex(projectRoot);
  if (index.nodes.some(node => (node.nodeId || node.id) === nodeId)) {
    throw new EventNodeError(`Event node already exists: ${nodeId}`, {
      statusCode: 409,
      code: 'CONFLICT',
    });
  }
  const node = nodeFor({
    nodeId,
    type,
    title,
    position: normalizePosition(payload.position),
    revision: 1,
  });
  const state = stateFor(type, payload, node.revision);
  writeStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), state);
  appendStoreJsonl(revisionLogPath(projectRoot, node.nodeId), revisionRow('create', node));
  writeIndex(projectRoot, { nodes: [...index.nodes, node] });
  syncTimerScheduler(projectRoot);
  return { ok: true, node, state, revision: node.revision };
}

export function getEventNode(projectRoot, nodeId) {
  const key = assertNodeId(decodeURIComponent(String(nodeId || '')));
  const index = readIndex(projectRoot);
  const raw = index.nodes.find(node => (node.nodeId || node.id) === key);
  if (!raw) {
    throw new EventNodeError(`Event node not found: ${key}`, {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }
  const node = validatedIndexNode(projectRoot, raw);
  const state = readStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), null);
  if (!state || state.type !== node.type || Number(state.revision) !== node.revision) {
    throw new EventNodeError('Event node state file is missing or out of sync', {
      statusCode: 409,
      code: 'STATE_MISMATCH',
    });
  }
  return { ok: true, node, state, revision: node.revision };
}

export function updateEventNode(projectRoot, nodeId, payload = {}) {
  if (payload && Object.hasOwn(payload, 'statePath')) {
    throw new EventNodeError('statePath is backend-owned and cannot be mutated');
  }
  const current = getEventNode(projectRoot, nodeId);
  const expectedRevision = Number(payload.revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.node.revision) {
    throw new EventNodeError('Stale event node revision', {
      statusCode: 409,
      code: 'STALE_REVISION',
    });
  }
  const nextRevision = current.node.revision + 1;
  const node = nodeFor({
    nodeId: current.node.nodeId,
    type: current.node.type,
    title: payload.title !== undefined ? normalizeTitle(payload.title, current.node.type) : current.node.title,
    position: payload.position !== undefined ? normalizePosition(payload.position) : current.node.position,
    revision: nextRevision,
  });
  const state = stateFor(current.node.type, payload, nextRevision, current.state);
  writeStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), state);
  appendStoreJsonl(revisionLogPath(projectRoot, node.nodeId), revisionRow('update', node, current.node.revision));
  const index = readIndex(projectRoot);
  writeIndex(projectRoot, {
    nodes: index.nodes.map(item => ((item.nodeId || item.id) === node.nodeId ? node : item)),
  });
  syncTimerScheduler(projectRoot);
  return { ok: true, node, state, revision: node.revision };
}

export function deleteEventNode(projectRoot, nodeId) {
  const current = getEventNode(projectRoot, nodeId);
  appendStoreJsonl(revisionLogPath(projectRoot, current.node.nodeId), revisionRow('delete', current.node, current.node.revision));
  const index = readIndex(projectRoot);
  writeIndex(projectRoot, {
    nodes: index.nodes.filter(item => (item.nodeId || item.id) !== current.node.nodeId),
  });
  syncTimerScheduler(projectRoot);
  return { ok: true, nodeId: current.node.nodeId, removed: current.node };
}

export function restoreEventNode(projectRoot, snapshot = {}) {
  const rawNode = snapshot.node || snapshot;
  const nodeId = assertNodeId(rawNode?.nodeId || rawNode?.id);
  const index = readIndex(projectRoot);
  const existing = index.nodes.find(node => (node.nodeId || node.id) === nodeId);
  if (existing) return getEventNode(projectRoot, nodeId);
  const node = validatedIndexNode(projectRoot, { ...rawNode, nodeId });
  const state = snapshot.state || readStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), null);
  if (!state || state.type !== node.type) {
    throw new EventNodeError('Cannot restore event node without its state', { statusCode: 409, code: 'RESTORE_STATE_MISSING' });
  }
  writeStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), state);
  appendStoreJsonl(revisionLogPath(projectRoot, node.nodeId), revisionRow('restore', node, node.revision));
  writeIndex(projectRoot, { nodes: [...index.nodes, node] });
  syncTimerScheduler(projectRoot);
  return getEventNode(projectRoot, nodeId);
}

export function listEventNodes(projectRoot) {
  const index = readIndex(projectRoot);
  return index.nodes.map(node => validatedIndexNode(projectRoot, node));
}

export function eventStateRefs(projectRoot) {
  const refs = {};
  for (const node of listEventNodes(projectRoot)) {
    const current = getEventNode(projectRoot, node.nodeId);
    refs[node.nodeId] = {
      type: node.type,
      eventKind: node.type,
      title: node.title,
      statePath: node.statePath,
      revision: node.revision,
      enabled: Boolean(current.state.enabled),
      schedule: current.state.schedule || null,
      heartbeat: current.state.heartbeat || null,
      loop: current.state.loop || null,
      whileGuard: current.state.whileGuard || null,
      taskBinding: current.state.taskBinding || null,
      controlPolicy: current.state.controlPolicy || null,
      repository: current.state.repository || null,
      eventFilters: current.state.eventFilters || null,
      dedupeKeys: current.state.dedupeKeys || [],
      deliveryCount: Number(current.state.deliveryCount || current.state.eventCount || 0),
      lastEvent: current.state.lastEvent,
      lastFiredAt: current.state.lastFiredAt,
      lastReceivedAt: current.state.lastReceivedAt || '',
      lastDeliveryId: current.state.lastDeliveryId || '',
      eventCount: current.state.eventCount,
    };
  }
  return refs;
}

export function eventNodeStates(projectRoot) {
  const states = {};
  for (const listedNode of listEventNodes(projectRoot)) {
    const { node, state } = getEventNode(projectRoot, listedNode.nodeId);
    states[node.nodeId] = {
      nodeId: node.nodeId,
      type: node.type,
      title: node.title,
      revision: node.revision,
      schedule: state.schedule || null,
      heartbeat: state.heartbeat || null,
      loop: state.loop || null,
      whileGuard: state.whileGuard || null,
      taskBinding: state.taskBinding || null,
      controlPolicy: state.controlPolicy || null,
      enabled: state.enabled,
      payloadTemplate: state.payloadTemplate,
      repository: state.repository || null,
      eventFilters: state.eventFilters || null,
      dedupeKeys: state.dedupeKeys || [],
      deliveryCount: Number(state.deliveryCount || state.eventCount || 0),
      eventCount: state.eventCount,
      lastFiredAt: state.lastFiredAt,
      lastReceivedAt: state.lastReceivedAt || '',
      lastDeliveryId: state.lastDeliveryId || '',
      lastEvent: state.lastEvent,
      statePath: node.statePath,
    };
  }
  return states;
}
