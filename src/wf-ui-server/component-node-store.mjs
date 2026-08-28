import crypto from 'node:crypto';
import path from 'node:path';
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

const COMPONENT_TYPES = new Set(['markdown', 'excalidraw', 'file', 'display']);
const NODE_ID_RE = /^component-[a-z0-9][a-z0-9-]*$/;
const STORE_DIR = 'component-nodes';

export class ComponentNodeError extends Error {
  constructor(message, { statusCode = 400, code = 'BAD_REQUEST' } = {}) {
    super(message);
    this.name = 'ComponentNodeError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function componentNodesIndexPath(projectRoot) {
  return nodeStoreIndexPath(projectRoot, STORE_DIR);
}

export function componentNodeRevisionLogPath(projectRoot, nodeId) {
  return nodeRevisionLogPath(projectRoot, { storeDir: STORE_DIR, nodeId, assertNodeId });
}

function normalizeType(type) {
  const value = String(type || '').trim().toLowerCase();
  if (!COMPONENT_TYPES.has(value)) {
    throw new ComponentNodeError('Invalid component type; expected markdown, excalidraw, file, or display');
  }
  return value;
}

function generateNodeId(type, title) {
  return `component-${slugPart(title, type)}-${crypto.randomBytes(3).toString('hex')}`;
}

function assertNodeId(nodeId) {
  const value = String(nodeId || '').trim();
  if (!NODE_ID_RE.test(value)) {
    throw new ComponentNodeError('Invalid component node id; traversal and escaped ids are not allowed');
  }
  return value;
}

function normalizeNodeId(nodeId, type, title) {
  return assertNodeId(nodeId || generateNodeId(type, title));
}

function normalizeTitle(title, type) {
  const value = String(title || '').trim();
  if (value) return value;
  if (type === 'file') return 'File Node';
  if (type === 'display') return 'Report Node';
  return value || (type === 'markdown' ? 'Markdown Node' : 'Excalidraw Node');
}

function relStatePath(nodeId) {
  return nodeStateRelPath(STORE_DIR, nodeId);
}

function absoluteStatePath(projectRoot, statePath, nodeId) {
  return nodeStatePath(projectRoot, {
    storeDir: STORE_DIR,
    statePath,
    nodeId,
    ErrorClass: ComponentNodeError,
    label: 'component',
  });
}

function uiContractForType(type) {
  if (type === 'markdown') {
    return {
      editor: 'markdown',
      modes: ['wysiwyg', 'source'],
      defaultMode: 'wysiwyg',
    };
  }
  if (type === 'file') {
    return {
      editor: 'file-preview',
      modes: ['preview', 'metadata'],
      defaultMode: 'preview',
    };
  }
  if (type === 'display') {
    return {
      editor: 'html-report',
      modes: ['report'],
      defaultMode: 'report',
    };
  }
  return {
    editor: 'excalidraw',
    modes: ['canvas'],
    defaultMode: 'canvas',
  };
}

function inputsForType(type) {
  if (type === 'markdown') return [{ id: 'markdown', type: 'markdown', label: 'Markdown' }];
  if (type === 'file') return [{ id: 'file', type: 'file-ref', label: 'File' }];
  if (type === 'display') return [{ id: 'html', type: 'html-report', label: 'HTML report' }];
  return [{ id: 'scene', type: 'excalidraw-scene', label: 'Scene' }];
}

function outputsForType(type) {
  if (type === 'markdown') {
    return [
      { id: 'markdown', type: 'markdown', label: 'Markdown' },
      { id: 'plainText', type: 'text', label: 'Plain text' },
    ];
  }
  if (type === 'file') {
    return [
      { id: 'file', type: 'file-ref', label: 'File reference' },
      { id: 'path', type: 'path', label: 'Path' },
    ];
  }
  if (type === 'display') {
    return [
      { id: 'html', type: 'html-report', label: 'HTML report' },
      { id: 'plainText', type: 'text', label: 'Plain text' },
    ];
  }
  return [
    { id: 'scene', type: 'excalidraw-scene', label: 'Scene' },
    { id: 'image', type: 'image', label: 'Rendered image' },
  ];
}

function normalizeNodePath(projectRoot, value) {
  const text = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!text || text.includes('\0')) {
    throw new ComponentNodeError('Invalid file node path');
  }
  const parts = text.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..')) {
    throw new ComponentNodeError('Invalid file node path; traversal is not allowed');
  }
  const absolute = path.resolve(projectRoot, text);
  const root = path.resolve(projectRoot);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ComponentNodeError('Invalid file node path; escaped workspace');
  }
  return text;
}

function normalizeFileState(projectRoot, payload = {}) {
  const source = payload.source === 'user-file' ? 'user-file' : 'workspace';
  const relPath = normalizeNodePath(projectRoot, payload.path);
  return {
    source,
    kind: payload.kind === 'folder' || payload.kind === 'workspace-folder' ? 'folder' : 'file',
    path: relPath,
    name: String(payload.name || path.basename(relPath) || 'file').trim(),
    mime: String(payload.mime || payload.type || '').trim(),
    size: Number.isFinite(Number(payload.size)) ? Number(payload.size) : 0,
  };
}

function stateFor(projectRoot, type, payload, revision) {
  const state = {
    type,
    revision,
    uiContract: uiContractForType(type),
    inputs: inputsForType(type),
    outputs: outputsForType(type),
  };
  if (type === 'markdown') {
    state.markdown = String(payload.markdown || '');
  } else if (type === 'excalidraw') {
    state.scene = isPlainObject(payload.scene)
      ? payload.scene
      : { elements: [], appState: {}, files: {} };
  } else if (type === 'display') {
    // The report lives in <nodeDir>/report.html (written by display.write);
    // state only tracks the metadata.
    state.html = { bytes: 0 };
  } else {
    state.file = normalizeFileState(projectRoot, payload.file || payload);
  }
  return state;
}

function nodeFor({ nodeId, type, title, position, revision }) {
  const statePath = relStatePath(nodeId);
  return {
    id: nodeId,
    nodeId,
    kind: 'component-node',
    type,
    title,
    position,
    revision,
    statePath,
    stateRef: { path: statePath, revision },
    config: {
      componentType: type,
      editable: true,
      backendSourceOfTruth: true,
    },
  };
}

function readIndex(projectRoot) {
  return readNodeIndex(componentNodesIndexPath(projectRoot));
}

function writeIndex(projectRoot, index) {
  writeNodeIndex(componentNodesIndexPath(projectRoot), index);
}

function validatedIndexNode(projectRoot, node) {
  const nodeId = assertNodeId(node?.nodeId || node?.id);
  const type = normalizeType(node?.type);
  const revision = Number(node?.revision || 0);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new ComponentNodeError('Invalid component node revision');
  }
  absoluteStatePath(projectRoot, node.statePath, nodeId);
  return {
    ...nodeFor({
      nodeId,
      type,
      title: normalizeTitle(node?.title, type),
      position: normalizePosition(node?.position),
      revision,
    }),
  };
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

export function createComponentNode(projectRoot, payload = {}) {
  const type = normalizeType(payload.type);
  const title = normalizeTitle(payload.title, type);
  const nodeId = normalizeNodeId(payload.nodeId, type, title);
  const index = readIndex(projectRoot);
  if (index.nodes.some(node => (node.nodeId || node.id) === nodeId)) {
    throw new ComponentNodeError(`Component node already exists: ${nodeId}`, {
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
  const state = stateFor(projectRoot, type, payload, node.revision);
  const stateFile = absoluteStatePath(projectRoot, node.statePath, node.nodeId);
  writeStoreJson(stateFile, state);
  appendStoreJsonl(componentNodeRevisionLogPath(projectRoot, node.nodeId), revisionRow('create', node));
  writeIndex(projectRoot, { nodes: [...index.nodes, node] });
  return { ok: true, node, state, revision: node.revision };
}

export function getComponentNode(projectRoot, nodeId) {
  const key = assertNodeId(decodeURIComponent(String(nodeId || '')));
  const index = readIndex(projectRoot);
  const raw = index.nodes.find(node => (node.nodeId || node.id) === key);
  if (!raw) {
    throw new ComponentNodeError(`Component node not found: ${key}`, {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }
  const node = validatedIndexNode(projectRoot, raw);
  const state = readStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), null);
  if (!state || state.type !== node.type || Number(state.revision) !== node.revision) {
    throw new ComponentNodeError('Component state file is missing or out of sync', {
      statusCode: 409,
      code: 'STATE_MISMATCH',
    });
  }
  return { ok: true, node, state, revision: node.revision };
}

export function updateComponentNode(projectRoot, nodeId, payload = {}) {
  if (payload && Object.hasOwn(payload, 'statePath')) {
    throw new ComponentNodeError('statePath is backend-owned and cannot be mutated');
  }
  const current = getComponentNode(projectRoot, nodeId);
  const expectedRevision = Number(payload.revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.node.revision) {
    throw new ComponentNodeError('Stale component node revision', {
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
  const state = stateFor(projectRoot, current.node.type, {
    markdown: payload.markdown !== undefined ? payload.markdown : current.state.markdown,
    scene: payload.scene !== undefined ? payload.scene : current.state.scene,
    file: payload.file !== undefined ? payload.file : current.state.file,
  }, nextRevision);
  // F18/D15: a successful write implies no live lock (the markdown write gate
  // rejects writes under a valid foreign lock), so the new state drops any
  // stale/expired persisted lock record.
  if (current.node.type === 'markdown') state.lock = null;
  // File nodes keep their persisted lease across metadata updates (refresh and
  // UI edits): the write gate runs before every write, so an update is never a
  // write itself and must not drop a live holder's lock. releaseLock is the
  // only clearing path (AC-2, restart-preserved).
  if (current.node.type === 'file' && current.state.lock) state.lock = current.state.lock;
  const stateFile = absoluteStatePath(projectRoot, node.statePath, node.nodeId);
  writeStoreJson(stateFile, state);
  appendStoreJsonl(componentNodeRevisionLogPath(projectRoot, node.nodeId), revisionRow('update', node, current.node.revision));

  const index = readIndex(projectRoot);
  const nodes = index.nodes.map(item => ((item.nodeId || item.id) === node.nodeId ? node : item));
  writeIndex(projectRoot, { nodes });
  return { ok: true, node, state, revision: node.revision };
}

// ---------------------------------------------------------------------------
// Markdown blackboard lock / lease registry (F18/D15: persisted + mandatory
// exclusion while held). The lock lives in the markdown node's backend-owned
// state file ({ lockId, holder, acquiredAt, expiresAt } on the state JSON), so
// a server restart keeps the lease; TTL expiry is honored on every read. The
// in-memory map is only a per-process cache seeded from the persisted lock.
// ---------------------------------------------------------------------------

const markdownLocks = new Map(); // nodeId -> { lockId, holder, acquiredAt, expiresAt }

function lockNow() {
  return Date.now();
}

// Read the persisted lock record from the node's backend-owned state file.
// Returns null when absent, not a markdown node, or expired (TTL honored on
// read). `projectRoot` is optional: without it the store behaves as a pure
// in-memory registry (unit-level usage, legacy behavior).
function persistedMarkdownLock(projectRoot, nodeId) {
  if (!projectRoot) return null;
  const key = assertNodeId(String(nodeId || ''));
  let state;
  try {
    state = readStoreJson(absoluteStatePath(projectRoot, relStatePath(key), key), null);
  } catch {
    return null;
  }
  const lock = state && state.lock && typeof state.lock === 'object' ? state.lock : null;
  if (!lock) return null;
  if (Number(lock.expiresAt) <= Date.now()) return null;
  return {
    lockId: String(lock.lockId || ''),
    holder: String(lock.holder || ''),
    acquiredAt: Number(lock.acquiredAt) || 0,
    expiresAt: Number(lock.expiresAt) || 0,
  };
}

// Persist (or clear) the lock on the node's state file. Never mutates the
// state revision, so getComponentNode validation stays intact.
function writePersistedMarkdownLock(projectRoot, nodeId, lock) {
  if (!projectRoot) return;
  const key = assertNodeId(String(nodeId || ''));
  const statePath = absoluteStatePath(projectRoot, relStatePath(key), key);
  let state;
  try {
    state = readStoreJson(statePath, null);
  } catch {
    return;
  }
  if (!state || typeof state !== 'object') return;
  writeStoreJson(statePath, { ...state, lock: lock || null });
}

function liveLock(nodeId, now, projectRoot = null) {
  const key = assertNodeId(String(nodeId || ''));
  const cached = markdownLocks.get(key);
  if (cached) {
    if (cached.expiresAt <= now) {
      markdownLocks.delete(key);
      return null;
    }
    return cached;
  }
  // Seed the cache from the persisted lease so restarts keep the lock (F18).
  const persisted = persistedMarkdownLock(projectRoot, key);
  if (persisted) {
    markdownLocks.set(key, persisted);
    return persisted;
  }
  return null;
}

function lockConflictError(lock) {
  const err = new ComponentNodeError(
    `Markdown node is locked by ${lock.holder} until ${new Date(lock.expiresAt).toISOString()}`,
    { statusCode: 409, code: 'markdown_locked' },
  );
  err.holder = lock.holder;
  err.expiresAt = lock.expiresAt;
  return err;
}

// Acquire or renew a lease. `options.now` overrides the clock (test injection);
// `options.lockId` renews an existing lease owned by the same holder; when
// `options.projectRoot` is supplied the lease is persisted into the node's
// backend-owned state file so restarts keep it (F18). TTL is clamped to
// [1ms, 300s].
export function acquireLock(nodeId, holder, ttlMs = 30000, options = {}) {
  const key = assertNodeId(String(nodeId || ''));
  const owner = String(holder || '').trim();
  if (!owner) {
    throw new ComponentNodeError('Lock holder is required', { statusCode: 400, code: 'BAD_REQUEST' });
  }
  const ttl = Math.min(Math.max(Number(ttlMs) || 0, 1), 300000);
  const now = Number(options.now) || lockNow();
  const existing = liveLock(key, now, options.projectRoot);
  if (existing && existing.holder !== owner) {
    throw lockConflictError(existing);
  }
  if (existing) {
    const lockId = options.lockId !== undefined && options.lockId !== null
      ? String(options.lockId).trim()
      : existing.lockId;
    if (lockId !== existing.lockId) throw lockConflictError(existing);
    existing.expiresAt = now + ttl;
    markdownLocks.set(key, existing);
    if (options.projectRoot) writePersistedMarkdownLock(options.projectRoot, key, existing);
    return { ...existing };
  }
  const lock = {
    lockId: options.lockId !== undefined && options.lockId !== null
      ? String(options.lockId).trim()
      : `lock-${crypto.randomBytes(8).toString('hex')}`,
    holder: owner,
    acquiredAt: now,
    expiresAt: now + ttl,
  };
  markdownLocks.set(key, lock);
  if (options.projectRoot) writePersistedMarkdownLock(options.projectRoot, key, lock);
  return { ...lock };
}

// Release a lease; only the holder may release. Missing/expired locks (or a
// lockId that no longer matches) are a no-op. `options.now` overrides the clock;
// `options.projectRoot` clears the persisted lease too (F18).
export function releaseLock(nodeId, holder, options = {}) {
  const key = assertNodeId(String(nodeId || ''));
  const owner = String(holder || '').trim();
  if (!owner) {
    throw new ComponentNodeError('Lock holder is required', { statusCode: 400, code: 'BAD_REQUEST' });
  }
  const now = Number(options.now) || lockNow();
  const requestedLockId = options.lockId !== undefined && options.lockId !== null
    ? String(options.lockId).trim()
    : null;
  const existing = liveLock(key, now, options.projectRoot);
  if (!existing) return { ok: true, released: false, nodeId: key, lockId: requestedLockId };
  if (existing.holder !== owner) throw lockConflictError(existing);
  if (requestedLockId !== null && requestedLockId !== existing.lockId) {
    return { ok: true, released: false, nodeId: key, lockId: requestedLockId };
  }
  markdownLocks.delete(key);
  if (options.projectRoot) writePersistedMarkdownLock(options.projectRoot, key, null);
  return { ok: true, released: true, nodeId: key, lockId: existing.lockId, holder: existing.holder, expiresAt: existing.expiresAt };
}

// Live lock record ({ lockId, holder, acquiredAt, expiresAt }) or null when
// absent/expired. `now` overrides the clock (test injection); `options.projectRoot`
// includes the persisted lease (read on load, F18).
export function isLocked(nodeId, now, options = {}) {
  const key = assertNodeId(String(nodeId || ''));
  const projectRoot = options && options.projectRoot ? options.projectRoot : null;
  return liveLock(key, Number(now) || lockNow(), projectRoot);
}

// Optimistic-concurrency compare for guarded markdown writes. Returns null
// when no expectedRevision is supplied or it matches; otherwise returns a
// recoverable markdown_conflict error carrying currentRevision/expectedRevision.
export function assertRevision(currentRevision, expectedRevision) {
  if (expectedRevision === undefined || expectedRevision === null) return null;
  const expected = Number(expectedRevision);
  const current = Number(currentRevision);
  if (Number.isFinite(expected) && expected !== current) {
    const err = new ComponentNodeError(
      `Markdown changed since read (revision ${expected} -> ${current}). Reread, merge your changes, and retry.`,
      { statusCode: 409, code: 'markdown_conflict' },
    );
    err.currentRevision = current;
    err.expectedRevision = expected;
    return err;
  }
  return null;
}

export function deleteComponentNode(projectRoot, nodeId) {
  const key = assertNodeId(decodeURIComponent(String(nodeId || '')));
  let current = null;
  try {
    current = getComponentNode(projectRoot, key);
  } catch (error) {
    if (!isRecoverableComponentNodeStateError(error)) throw error;
    const index = readIndex(projectRoot);
    const raw = index.nodes.find(node => (node.nodeId || node.id) === key);
    if (!raw) throw error;
    current = { node: validatedIndexNode(projectRoot, raw), state: null, revision: Number(raw.revision || 0) };
  }
  appendStoreJsonl(componentNodeRevisionLogPath(projectRoot, current.node.nodeId), revisionRow('delete', current.node, current.node.revision));
  const index = readIndex(projectRoot);
  writeIndex(projectRoot, {
    nodes: index.nodes.filter(item => (item.nodeId || item.id) !== current.node.nodeId),
  });
  return { ok: true, nodeId: current.node.nodeId, removed: current.node };
}

export function restoreComponentNode(projectRoot, snapshot = {}) {
  const rawNode = snapshot.node || snapshot;
  const nodeId = assertNodeId(rawNode?.nodeId || rawNode?.id);
  const index = readIndex(projectRoot);
  const existing = index.nodes.find(node => (node.nodeId || node.id) === nodeId);
  if (existing) return getComponentNode(projectRoot, nodeId);
  const node = validatedIndexNode(projectRoot, { ...rawNode, nodeId });
  const state = snapshot.state || readStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), null);
  if (!state || state.type !== node.type) {
    throw new ComponentNodeError('Cannot restore component node without its state', { statusCode: 409, code: 'RESTORE_STATE_MISSING' });
  }
  writeStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), state);
  appendStoreJsonl(componentNodeRevisionLogPath(projectRoot, node.nodeId), revisionRow('restore', node, node.revision));
  writeIndex(projectRoot, { nodes: [...index.nodes, node] });
  return getComponentNode(projectRoot, nodeId);
}

export function listComponentNodes(projectRoot) {
  const index = readIndex(projectRoot);
  return index.nodes.map(node => validatedIndexNode(projectRoot, node));
}

export function isRecoverableComponentNodeStateError(error) {
  return error instanceof ComponentNodeError
    && ['NOT_FOUND', 'STATE_MISMATCH'].includes(error.code);
}

export function listLiveComponentNodeEntries(projectRoot) {
  const entries = [];
  for (const node of listComponentNodes(projectRoot)) {
    try {
      const current = getComponentNode(projectRoot, node.nodeId);
      requiredStatePayload(current.node, current.state);
      entries.push(current);
    } catch (error) {
      if (!isRecoverableComponentNodeStateError(error)) throw error;
    }
  }
  return entries;
}

export function listLiveComponentNodes(projectRoot) {
  return listLiveComponentNodeEntries(projectRoot).map(entry => entry.node);
}

export function componentStateRefs(projectRoot) {
  const refs = {};
  for (const current of listLiveComponentNodeEntries(projectRoot)) {
    const node = current.node;
    refs[node.nodeId] = {
      type: node.type,
      title: node.title,
      statePath: node.statePath,
      revision: node.revision,
      ...(current.state.file ? { file: current.state.file } : {}),
    };
  }
  return refs;
}

function portIds(ports, fallback) {
  const ids = (Array.isArray(ports) ? ports : [])
    .map(port => String(port?.id || '').trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : fallback.map(port => port.id);
}

function requiredStatePayload(node, raw) {
  if (node.type === 'markdown' && typeof raw.markdown !== 'string') {
    throw new ComponentNodeError('Component markdown state is missing or out of sync', {
      statusCode: 409,
      code: 'STATE_MISMATCH',
    });
  }
  if (node.type === 'excalidraw' && !isPlainObject(raw.scene)) {
    throw new ComponentNodeError('Component Excalidraw scene is missing or out of sync', {
      statusCode: 409,
      code: 'STATE_MISMATCH',
    });
  }
  if (node.type === 'file' && !isPlainObject(raw.file)) {
    throw new ComponentNodeError('Component file state is missing or out of sync', {
      statusCode: 409,
      code: 'STATE_MISMATCH',
    });
  }
}

export function componentNodeStates(projectRoot) {
  const states = {};
  for (const listedNode of listComponentNodes(projectRoot)) {
    const { node, state: raw } = getComponentNode(projectRoot, listedNode.nodeId);
    requiredStatePayload(node, raw);
    const inputs = Array.isArray(raw.inputs) ? raw.inputs : inputsForType(node.type);
    const outputs = Array.isArray(raw.outputs) ? raw.outputs : outputsForType(node.type);
    const state = {
      nodeId: node.nodeId,
      type: node.type,
      title: node.title,
      revision: node.revision,
      observableInputs: portIds(inputs, inputsForType(node.type)),
      observableOutputs: portIds(outputs, outputsForType(node.type)),
      statePath: node.statePath,
    };
    if (node.type === 'markdown') {
      state.markdown = raw.markdown;
    } else if (node.type === 'excalidraw') {
      state.scene = raw.scene;
    } else if (node.type === 'file') {
      state.file = raw.file;
    }
    states[node.nodeId] = state;
  }
  return states;
}

export function componentNodeStatesForSnapshot(projectRoot) {
  const states = {};
  for (const { node, state: raw } of listLiveComponentNodeEntries(projectRoot)) {
    const inputs = Array.isArray(raw.inputs) ? raw.inputs : inputsForType(node.type);
    const outputs = Array.isArray(raw.outputs) ? raw.outputs : outputsForType(node.type);
    const state = {
      nodeId: node.nodeId,
      type: node.type,
      title: node.title,
      revision: node.revision,
      observableInputs: portIds(inputs, inputsForType(node.type)),
      observableOutputs: portIds(outputs, outputsForType(node.type)),
      statePath: node.statePath,
    };
    if (node.type === 'markdown') {
      state.markdown = raw.markdown;
    } else if (node.type === 'excalidraw') {
      state.scene = raw.scene;
    } else if (node.type === 'file') {
      state.file = raw.file;
    }
    states[node.nodeId] = state;
  }
  return states;
}
