import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RUN_PREFIX = 'run';
const WINDOW_PREFIX = 'window';
const LEASE_PREFIX = 'lease';
const ARTIFACT_PREFIX = 'artifact';
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_KEEP_LATEST_RUNS = 20;
const DEFAULT_MAX_RUN_AGE_DAYS = 7;

const ARTIFACT_TYPES = new Map([
  ['screenshot', { dir: 'screenshots', ext: '.png', contentType: 'image/png' }],
  ['ui-tree', { dir: 'ui-tree', ext: '.json', contentType: 'application/json' }],
  ['state', { dir: 'state', ext: '.json', contentType: 'application/json' }],
  ['logs', { dir: 'logs', ext: '.jsonl', contentType: 'application/x-ndjson' }],
  ['network', { dir: 'network', ext: '.jsonl', contentType: 'application/x-ndjson' }],
  ['ast', { dir: 'ast', ext: '.json', contentType: 'application/json' }],
  ['replay', { dir: 'replay', ext: '.json', contentType: 'application/json' }],
  ['analysis', { dir: 'analysis', ext: '.json', contentType: 'application/json' }],
]);

export class WfBrowserStoreError extends Error {
  constructor(message, { statusCode = 400, code = 'BAD_REQUEST' } = {}) {
    super(message);
    this.name = 'WfBrowserStoreError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function wfBrowserRoot(projectRoot) {
  return path.join(projectRoot, 'Harness', 'wf-browser');
}

export function wfBrowserRunsRoot(projectRoot) {
  return path.join(wfBrowserRoot(projectRoot), 'runs');
}

export function wfBrowserBackendCapabilities() {
  return {
    schemaVersion: 1,
    readiness: {
      current: 'L3-minimal-bridge',
      target: 'L3-bridge-ready',
      note: 'HTTP run/window/lease/artifact primitives, /ws/wf-browser command dispatch, visible action primitives, first-party route capability maps, network capture, replay timeline, compact diffs, connection wait, and control-script isolated browser launch/list/close are available; full L3 still needs trusted screenshot/AST coverage and deeper route-owned capability maps.',
    },
    primitives: {
      runs: ['create', 'list', 'get', 'cleanup'],
      windows: ['create', 'list', 'launch-url', 'connection-wait', 'launch-list-via-control-script', 'isolated-open-via-control-script', 'close-via-control-script', 'profile-cleanup-via-control-script'],
      leases: ['control', 'observe', 'release', 'conflict-reject'],
      commands: ['observe.route', 'observe.capabilities', 'observe.uiTree', 'observe.state', 'observe.logs', 'observe.network', 'observe.replay', 'observe.diff', 'act.hover', 'act.click', 'act.contextMenu', 'act.focus', 'act.type', 'act.clear', 'act.select', 'act.press', 'act.drag', 'act.scroll', 'act.wait'],
      artifacts: [...ARTIFACT_TYPES.keys()],
    },
    endpoints: [
      'GET /api/wf-browser/capabilities',
      'GET /api/wf-browser/connections',
      'GET /api/wf-browser/runs',
      'POST /api/wf-browser/runs',
      'GET /api/wf-browser/runs/:runId',
      'GET /api/wf-browser/runs/:runId/windows',
      'POST /api/wf-browser/runs/:runId/windows',
      'POST /api/wf-browser/runs/:runId/windows/:windowId/lease',
      'POST /api/wf-browser/runs/:runId/windows/:windowId/lease/:leaseId/release',
      'GET /api/wf-browser/runs/:runId/windows/:windowId/launch-url',
      'POST /api/wf-browser/runs/:runId/windows/:windowId/commands',
      'GET /api/wf-browser/runs/:runId/windows/:windowId/artifacts',
      'POST /api/wf-browser/runs/:runId/windows/:windowId/artifacts',
      'POST /api/wf-browser/cleanup',
    ],
  };
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function assertId(value, label) {
  const text = decodeURIComponent(String(value || '').trim());
  if (!ID_RE.test(text) || text.includes('..') || text.includes('/') || text.includes('\\') || text.includes('\0')) {
    throw new WfBrowserStoreError(`Invalid ${label}; traversal and escaped ids are not allowed`);
  }
  return text;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function cleanEnum(value, allowed, fallback) {
  const text = String(value || '').trim().toLowerCase();
  return allowed.has(text) ? text : fallback;
}

function runDir(projectRoot, runId) {
  return path.join(wfBrowserRunsRoot(projectRoot), assertId(runId, 'run id'));
}

function windowDir(projectRoot, runId, windowId) {
  return path.join(runDir(projectRoot, runId), 'windows', assertId(windowId, 'window id'));
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function appendJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

function manifestPath(projectRoot, runId) {
  return path.join(runDir(projectRoot, runId), 'manifest.json');
}

function timelinePath(projectRoot, runId) {
  return path.join(runDir(projectRoot, runId), 'timeline.jsonl');
}

function sessionsPath(projectRoot, runId) {
  return path.join(runDir(projectRoot, runId), 'sessions.json');
}

function windowStatePath(projectRoot, runId, windowId) {
  return path.join(windowDir(projectRoot, runId, windowId), 'window.json');
}

function leasesPath(projectRoot, runId, windowId) {
  return path.join(windowDir(projectRoot, runId, windowId), 'leases.json');
}

function artifactsPath(projectRoot, runId, windowId) {
  return path.join(windowDir(projectRoot, runId, windowId), 'artifacts.jsonl');
}

function actionsPath(projectRoot, runId, windowId) {
  return path.join(windowDir(projectRoot, runId, windowId), 'actions.jsonl');
}

function relativeFromProject(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
}

function requireRun(projectRoot, runId) {
  const id = assertId(runId, 'run id');
  const manifest = readJson(manifestPath(projectRoot, id), null);
  if (!manifest) {
    throw new WfBrowserStoreError(`wf-browser run not found: ${id}`, {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }
  return manifest;
}

function requireWindow(projectRoot, runId, windowId) {
  requireRun(projectRoot, runId);
  const id = assertId(windowId, 'window id');
  const state = readJson(windowStatePath(projectRoot, runId, id), null);
  if (!state) {
    throw new WfBrowserStoreError(`wf-browser window not found: ${id}`, {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }
  return state;
}

function updateRunManifest(projectRoot, runId, patch = {}) {
  const current = requireRun(projectRoot, runId);
  const next = {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  };
  writeJson(manifestPath(projectRoot, runId), next);
  return next;
}

function appendTimeline(projectRoot, runId, event) {
  const row = {
    schemaVersion: 1,
    at: nowIso(),
    runId,
    ...event,
  };
  appendJsonl(timelinePath(projectRoot, runId), row);
  return row;
}

function windowArtifactDirs() {
  return [...new Set([...ARTIFACT_TYPES.values()].map(item => item.dir))];
}

function ensureWindowLayout(projectRoot, runId, windowId) {
  const root = windowDir(projectRoot, runId, windowId);
  for (const dir of windowArtifactDirs()) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
}

function listWindows(projectRoot, runId) {
  const root = path.join(runDir(projectRoot, runId), 'windows');
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { entries = []; }
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => readJson(path.join(root, entry.name, 'window.json'), null))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

function readLeases(projectRoot, runId, windowId) {
  const data = readJson(leasesPath(projectRoot, runId, windowId), { schemaVersion: 1, leases: [] });
  return {
    schemaVersion: 1,
    leases: Array.isArray(data.leases) ? data.leases : [],
  };
}

function writeLeases(projectRoot, runId, windowId, leases) {
  writeJson(leasesPath(projectRoot, runId, windowId), {
    schemaVersion: 1,
    updatedAt: nowIso(),
    leases,
  });
}

function activeLease(lease, nowMs = Date.now()) {
  return lease?.status === 'active' && Date.parse(lease.expiresAt || '') > nowMs;
}

function cleanName(value, fallback) {
  const raw = String(value || '').trim();
  const base = path.basename(raw)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');
  return base || fallback;
}

function artifactSpec(type) {
  const key = cleanEnum(type, new Set(ARTIFACT_TYPES.keys()), '');
  const spec = ARTIFACT_TYPES.get(key);
  if (!spec) {
    throw new WfBrowserStoreError(`Invalid artifact type; expected ${[...ARTIFACT_TYPES.keys()].join(', ')}`);
  }
  return { key, ...spec };
}

function artifactBytes(payload, spec) {
  if (payload?.contentBase64 !== undefined) {
    return Buffer.from(String(payload.contentBase64 || ''), 'base64');
  }
  if (payload?.json !== undefined) {
    return Buffer.from(`${JSON.stringify(payload.json, null, 2)}\n`, 'utf8');
  }
  if (payload?.text !== undefined) {
    return Buffer.from(String(payload.text), 'utf8');
  }
  if (payload?.lines !== undefined) {
    const lines = Array.isArray(payload.lines) ? payload.lines : [payload.lines];
    const body = lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n');
    return Buffer.from(`${body}${body.endsWith('\n') ? '' : '\n'}`, 'utf8');
  }
  if (spec.ext === '.json') return Buffer.from('{}\n', 'utf8');
  return Buffer.alloc(0);
}

export function wfBrowserDebugUrlParams({ runId, windowId, agentId = '', leaseId = '', debug = true } = {}) {
  const params = new URLSearchParams();
  params.set('wfRun', assertId(runId, 'run id'));
  params.set('wfWindow', assertId(windowId, 'window id'));
  if (agentId) params.set('wfAgent', cleanString(agentId, 'agent-unknown'));
  if (leaseId) params.set('wfLease', assertId(leaseId, 'lease id'));
  if (debug) params.set('wfDebug', '1');
  return params.toString();
}

function runSummary(manifest) {
  return {
    runId: manifest.runId,
    status: manifest.status,
    mode: manifest.mode,
    agentId: manifest.agentId,
    sessionId: manifest.sessionId,
    taskId: manifest.taskId,
    route: manifest.route,
    windowCount: Number(manifest.windowCount || 0),
    artifactRoot: manifest.artifactRoot,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  };
}

export function createWfBrowserRun(projectRoot, payload = {}) {
  const runId = assertId(payload.runId || randomId(RUN_PREFIX), 'run id');
  const root = runDir(projectRoot, runId);
  if (fs.existsSync(root)) {
    throw new WfBrowserStoreError(`wf-browser run already exists: ${runId}`, {
      statusCode: 409,
      code: 'CONFLICT',
    });
  }
  const createdAt = nowIso();
  const mode = cleanEnum(payload.mode, new Set(['architecture', 'runtime', 'mixed', 'recovery']), 'mixed');
  const manifest = {
    schemaVersion: 1,
    kind: 'wf-browser-run',
    runId,
    status: cleanEnum(payload.status, new Set(['active', 'complete', 'blocked', 'archived']), 'active'),
    mode,
    agentId: cleanString(payload.agentId, 'agent-unknown'),
    sessionId: cleanString(payload.sessionId, ''),
    taskId: cleanString(payload.taskId, ''),
    route: cleanString(payload.route, ''),
    objective: cleanString(payload.objective, ''),
    readinessBefore: cleanString(payload.readinessBefore, ''),
    readinessAfter: cleanString(payload.readinessAfter, ''),
    fixtureScope: isPlainObject(payload.fixtureScope) ? payload.fixtureScope : {},
    artifactRoot: `Harness/wf-browser/runs/${runId}`,
    windowCount: 0,
    createdAt,
    updatedAt: createdAt,
  };
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'windows'), { recursive: true });
  writeJson(manifestPath(projectRoot, runId), manifest);
  writeJson(sessionsPath(projectRoot, runId), { schemaVersion: 1, sessions: [] });
  appendTimeline(projectRoot, runId, {
    type: 'run.created',
    mode,
    agentId: manifest.agentId,
    taskId: manifest.taskId,
    route: manifest.route,
  });
  return { ok: true, run: manifest };
}

export function listWfBrowserRuns(projectRoot, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 20), 1), 200);
  let entries = [];
  try { entries = fs.readdirSync(wfBrowserRunsRoot(projectRoot), { withFileTypes: true }); } catch { entries = []; }
  const runs = entries
    .filter(entry => entry.isDirectory())
    .map(entry => readJson(path.join(wfBrowserRunsRoot(projectRoot), entry.name, 'manifest.json'), null))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .slice(0, limit)
    .map(runSummary);
  return { ok: true, runs };
}

export function getWfBrowserRun(projectRoot, runId) {
  const run = requireRun(projectRoot, runId);
  return {
    ok: true,
    run,
    windows: listWindows(projectRoot, run.runId),
  };
}

export function getWfBrowserWindow(projectRoot, runId, windowId) {
  const window = requireWindow(projectRoot, runId, windowId);
  return {
    ok: true,
    window,
    leases: readLeases(projectRoot, runId, windowId).leases,
  };
}

export function listWfBrowserWindows(projectRoot, runId) {
  const run = requireRun(projectRoot, runId);
  return {
    ok: true,
    runId: run.runId,
    windows: listWindows(projectRoot, run.runId),
  };
}

export function createWfBrowserWindow(projectRoot, runId, payload = {}) {
  const run = requireRun(projectRoot, runId);
  const windowId = assertId(payload.windowId || randomId(WINDOW_PREFIX), 'window id');
  const stateFile = windowStatePath(projectRoot, run.runId, windowId);
  if (fs.existsSync(stateFile)) {
    throw new WfBrowserStoreError(`wf-browser window already exists: ${windowId}`, {
      statusCode: 409,
      code: 'CONFLICT',
    });
  }
  const createdAt = nowIso();
  const state = {
    schemaVersion: 1,
    kind: 'wf-browser-window',
    runId: run.runId,
    windowId,
    status: 'idle',
    agentId: cleanString(payload.agentId, run.agentId || 'agent-unknown'),
    sessionId: cleanString(payload.sessionId, run.sessionId || ''),
    route: cleanString(payload.route, run.route || ''),
    viewport: isPlainObject(payload.viewport) ? payload.viewport : {},
    fixtureScope: isPlainObject(payload.fixtureScope) ? payload.fixtureScope : run.fixtureScope || {},
    artifactRoot: `Harness/wf-browser/runs/${run.runId}/windows/${windowId}`,
    activeLeaseId: '',
    activeLeaseType: '',
    createdAt,
    updatedAt: createdAt,
  };
  ensureWindowLayout(projectRoot, run.runId, windowId);
  writeJson(stateFile, state);
  writeLeases(projectRoot, run.runId, windowId, []);
  const windowCount = listWindows(projectRoot, run.runId).length;
  updateRunManifest(projectRoot, run.runId, { windowCount });
  appendTimeline(projectRoot, run.runId, {
    type: 'window.created',
    windowId,
    agentId: state.agentId,
    route: state.route,
  });
  return { ok: true, window: state };
}

export function getWfBrowserLease(projectRoot, runId, windowId, leaseId) {
  requireWindow(projectRoot, runId, windowId);
  const key = assertId(leaseId, 'lease id');
  const lease = readLeases(projectRoot, runId, windowId).leases.find(item => item.leaseId === key);
  if (!lease) {
    throw new WfBrowserStoreError(`wf-browser lease not found: ${key}`, {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }
  return { ok: true, lease };
}

export function leaseWfBrowserWindow(projectRoot, runId, windowId, payload = {}) {
  const windowState = requireWindow(projectRoot, runId, windowId);
  const type = cleanEnum(payload.type, new Set(['control', 'observe']), 'control');
  const agentId = cleanString(payload.agentId, 'agent-unknown');
  const nowMs = Date.now();
  const leaseState = readLeases(projectRoot, runId, windowId);
  const leases = leaseState.leases.map(lease => (
    lease.status === 'active' && !activeLease(lease, nowMs)
      ? { ...lease, status: 'expired', expiredAt: lease.expiresAt }
      : lease
  ));
  const activeControl = leases.find(lease => activeLease(lease, nowMs) && lease.type === 'control');
  if (type === 'control' && activeControl && activeControl.agentId !== agentId) {
    appendTimeline(projectRoot, runId, {
      type: 'lease.rejected',
      windowId,
      agentId,
      leaseType: type,
      conflictLeaseId: activeControl.leaseId,
      conflictAgentId: activeControl.agentId,
    });
    writeLeases(projectRoot, runId, windowId, leases);
    throw new WfBrowserStoreError(`Window ${windowId} already has an active control lease`, {
      statusCode: 409,
      code: 'LEASE_CONFLICT',
    });
  }

  const ttlMs = Math.min(Math.max(Number(payload.ttlMs || DEFAULT_LEASE_TTL_MS), 1000), 60 * 60 * 1000);
  const leaseId = assertId(payload.leaseId || randomId(LEASE_PREFIX), 'lease id');
  const createdAt = nowIso();
  const lease = {
    schemaVersion: 1,
    kind: 'wf-browser-lease',
    runId,
    windowId,
    leaseId,
    type,
    status: 'active',
    agentId,
    sessionId: cleanString(payload.sessionId, windowState.sessionId || ''),
    reason: cleanString(payload.reason, ''),
    readonly: type === 'observe',
    createdAt,
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };
  writeLeases(projectRoot, runId, windowId, [...leases, lease]);
  writeJson(windowStatePath(projectRoot, runId, windowId), {
    ...windowState,
    status: type === 'control' ? 'leased' : windowState.status,
    activeLeaseId: type === 'control' ? lease.leaseId : windowState.activeLeaseId,
    activeLeaseType: type === 'control' ? lease.type : windowState.activeLeaseType,
    updatedAt: createdAt,
  });
  appendTimeline(projectRoot, runId, {
    type: 'lease.granted',
    windowId,
    leaseId,
    agentId,
    leaseType: type,
    expiresAt: lease.expiresAt,
  });
  return {
    ok: true,
    lease,
    debugUrlParams: wfBrowserDebugUrlParams({ runId, windowId, agentId, leaseId }),
  };
}

export function releaseWfBrowserLease(projectRoot, runId, windowId, leaseId, payload = {}) {
  const windowState = requireWindow(projectRoot, runId, windowId);
  const key = assertId(leaseId, 'lease id');
  const leaseState = readLeases(projectRoot, runId, windowId);
  let found = null;
  const releasedAt = nowIso();
  const leases = leaseState.leases.map(lease => {
    if (lease.leaseId !== key) return lease;
    found = {
      ...lease,
      status: lease.status === 'active' ? 'released' : lease.status,
      releasedAt: lease.releasedAt || releasedAt,
      releaseReason: cleanString(payload.reason, 'released'),
    };
    return found;
  });
  if (!found) {
    throw new WfBrowserStoreError(`wf-browser lease not found: ${key}`, {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }
  writeLeases(projectRoot, runId, windowId, leases);
  const stillActiveControl = leases.find(lease => activeLease(lease) && lease.type === 'control');
  writeJson(windowStatePath(projectRoot, runId, windowId), {
    ...windowState,
    status: stillActiveControl ? 'leased' : 'idle',
    activeLeaseId: stillActiveControl?.leaseId || '',
    activeLeaseType: stillActiveControl?.type || '',
    updatedAt: releasedAt,
  });
  appendTimeline(projectRoot, runId, {
    type: 'lease.released',
    windowId,
    leaseId: key,
    agentId: found.agentId,
    leaseType: found.type,
    reason: found.releaseReason,
  });
  return { ok: true, lease: found };
}

function commandAccessForPrimitive(primitive) {
  const text = String(primitive || '').trim();
  if (text.startsWith('act.')) return 'control';
  if (text.startsWith('observe.')) return 'observe';
  throw new WfBrowserStoreError('Invalid wf-browser primitive; expected observe.* or act.*');
}

export function validateWfBrowserCommandLease(projectRoot, runId, windowId, payload = {}) {
  requireWindow(projectRoot, runId, windowId);
  const primitive = cleanString(payload.primitive || payload.command?.primitive, '');
  const access = commandAccessForPrimitive(primitive);
  const leaseId = cleanString(payload.leaseId || payload.command?.leaseId, '');
  if (!leaseId) {
    throw new WfBrowserStoreError('wf-browser command requires a leaseId', {
      statusCode: 400,
      code: 'LEASE_REQUIRED',
    });
  }
  const agentId = cleanString(payload.agentId || payload.command?.agentId, '');
  const leases = readLeases(projectRoot, runId, windowId).leases;
  const lease = leases.find(item => item.leaseId === leaseId);
  if (!lease || !activeLease(lease)) {
    throw new WfBrowserStoreError('wf-browser command lease is missing, expired, or inactive', {
      statusCode: 409,
      code: 'LEASE_INACTIVE',
    });
  }
  if (agentId && lease.agentId !== agentId) {
    throw new WfBrowserStoreError('wf-browser command lease belongs to another agent', {
      statusCode: 403,
      code: 'LEASE_AGENT_MISMATCH',
    });
  }
  if (access === 'control' && lease.type !== 'control') {
    throw new WfBrowserStoreError('act.* commands require an active control lease', {
      statusCode: 403,
      code: 'CONTROL_LEASE_REQUIRED',
    });
  }
  return { ok: true, lease, primitive, access };
}

export function recordWfBrowserAction(projectRoot, runId, windowId, payload = {}) {
  requireWindow(projectRoot, runId, windowId);
  const row = {
    schemaVersion: 1,
    at: nowIso(),
    runId,
    windowId,
    commandId: cleanString(payload.commandId, ''),
    primitive: cleanString(payload.primitive, ''),
    agentId: cleanString(payload.agentId, ''),
    leaseId: cleanString(payload.leaseId, ''),
    status: cleanString(payload.status, ''),
    type: cleanString(payload.type, 'command.event'),
    summary: cleanString(payload.summary, ''),
    target: isPlainObject(payload.target) ? payload.target : undefined,
    error: isPlainObject(payload.error) ? payload.error : undefined,
    artifactIds: Array.isArray(payload.artifactIds) ? payload.artifactIds : undefined,
  };
  appendJsonl(actionsPath(projectRoot, runId, windowId), row);
  appendTimeline(projectRoot, runId, {
    type: row.type,
    windowId,
    commandId: row.commandId,
    primitive: row.primitive,
    agentId: row.agentId,
    leaseId: row.leaseId,
    status: row.status,
  });
  return { ok: true, action: row };
}

export function storeWfBrowserArtifact(projectRoot, runId, windowId, payload = {}) {
  requireWindow(projectRoot, runId, windowId);
  const spec = artifactSpec(payload.type);
  const artifactId = assertId(payload.artifactId || randomId(ARTIFACT_PREFIX), 'artifact id');
  const bytes = artifactBytes(payload, spec);
  const fallbackName = `${artifactId}${spec.ext}`;
  const name = cleanName(payload.name, fallbackName);
  const fileName = path.extname(name) ? name : `${name}${spec.ext}`;
  const absolutePath = path.join(windowDir(projectRoot, runId, windowId), spec.dir, fileName);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes);
  const createdAt = nowIso();
  const artifact = {
    schemaVersion: 1,
    kind: 'wf-browser-artifact',
    artifactId,
    runId,
    windowId,
    type: spec.key,
    label: cleanString(payload.label, ''),
    contentType: cleanString(payload.contentType, spec.contentType),
    path: relativeFromProject(projectRoot, absolutePath),
    bytes: bytes.length,
    createdAt,
  };
  appendJsonl(artifactsPath(projectRoot, runId, windowId), artifact);
  appendTimeline(projectRoot, runId, {
    type: 'artifact.stored',
    windowId,
    artifactId,
    artifactType: spec.key,
    path: artifact.path,
    bytes: artifact.bytes,
  });
  return { ok: true, artifact };
}

export function listWfBrowserArtifacts(projectRoot, runId, windowId) {
  requireWindow(projectRoot, runId, windowId);
  let artifacts = [];
  try {
    artifacts = fs.readFileSync(artifactsPath(projectRoot, runId, windowId), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    artifacts = [];
  }
  return { ok: true, artifacts };
}

export function cleanupWfBrowserRuns(projectRoot, payload = {}) {
  const keepLatest = Math.min(Math.max(Number(payload.keepLatest ?? DEFAULT_KEEP_LATEST_RUNS), 0), 500);
  const maxAgeDays = Math.min(Math.max(Number(payload.maxAgeDays ?? DEFAULT_MAX_RUN_AGE_DAYS), 0), 3650);
  const apply = payload.apply === true;
  const nowMs = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const runs = listWfBrowserRuns(projectRoot, { limit: 1000 }).runs
    .map(summary => requireRun(projectRoot, summary.runId))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const eligible = [];
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    const ageMs = nowMs - Date.parse(run.updatedAt || run.createdAt || new Date(0).toISOString());
    const beyondKeep = index >= keepLatest;
    const olderThanMax = maxAgeDays === 0 ? false : ageMs > maxAgeMs;
    if (run.status !== 'active' && (beyondKeep || olderThanMax)) {
      eligible.push({
        runId: run.runId,
        status: run.status,
        updatedAt: run.updatedAt,
        reason: beyondKeep ? 'beyond-keep-latest' : 'older-than-max-age',
        path: run.artifactRoot,
      });
    }
  }
  const removed = [];
  if (apply) {
    for (const item of eligible) {
      fs.rmSync(runDir(projectRoot, item.runId), { recursive: true, force: true });
      removed.push(item.runId);
    }
  }
  return {
    ok: true,
    apply,
    policy: { keepLatest, maxAgeDays },
    totalRuns: runs.length,
    eligible,
    removed,
  };
}
