import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const COMPONENT_TYPES = new Set(['markdown', 'excalidraw', 'file']);
const NODE_ID_RE = /^component-[a-z0-9][a-z0-9-]*$/;

export class ComponentNodeError extends Error {
  constructor(message, { statusCode = 400, code = 'BAD_REQUEST' } = {}) {
    super(message);
    this.name = 'ComponentNodeError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function componentRoot(projectRoot) {
  return path.join(projectRoot, 'Harness', 'a2a', 'component-nodes');
}

export function componentNodesIndexPath(projectRoot) {
  return path.join(componentRoot(projectRoot), 'index.json');
}

export function componentNodeRevisionLogPath(projectRoot, nodeId) {
  assertNodeId(nodeId);
  return path.join(componentRoot(projectRoot), nodeId, 'revisions.jsonl');
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeType(type) {
  const value = String(type || '').trim().toLowerCase();
  if (!COMPONENT_TYPES.has(value)) {
    throw new ComponentNodeError('Invalid component type; expected markdown, excalidraw, or file');
  }
  return value;
}

function slugPart(value, fallback) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || fallback;
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
  return value || (type === 'markdown' ? 'Markdown Node' : 'Excalidraw Node');
}

function normalizePosition(position) {
  const source = isPlainObject(position) ? position : {};
  return {
    x: Number.isFinite(Number(source.x)) ? Number(source.x) : 0,
    y: Number.isFinite(Number(source.y)) ? Number(source.y) : 0,
  };
}

function relStatePath(nodeId) {
  return `Harness/a2a/component-nodes/${nodeId}/state.json`;
}

function absoluteStatePath(projectRoot, statePath, nodeId) {
  const expected = relStatePath(nodeId);
  const normalized = String(statePath || '').replace(/\\/g, '/');
  if (normalized !== expected) {
    throw new ComponentNodeError('Invalid component state path; traversal or mutable statePath is not allowed');
  }
  const absolute = path.resolve(projectRoot, normalized);
  const root = path.resolve(componentRoot(projectRoot));
  if (absolute !== path.resolve(componentRoot(projectRoot), nodeId, 'state.json')) {
    throw new ComponentNodeError('Invalid component state path; escaped component root');
  }
  if (!(absolute === root || absolute.startsWith(`${root}${path.sep}`))) {
    throw new ComponentNodeError('Invalid component state path; escaped component root');
  }
  return absolute;
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
  return {
    editor: 'excalidraw',
    modes: ['canvas'],
    defaultMode: 'canvas',
  };
}

function inputsForType(type) {
  if (type === 'markdown') return [{ id: 'markdown', type: 'markdown', label: 'Markdown' }];
  if (type === 'file') return [{ id: 'file', type: 'file-ref', label: 'File' }];
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
  const index = readJson(componentNodesIndexPath(projectRoot), { schemaVersion: 1, nodes: [] });
  return {
    schemaVersion: 1,
    nodes: Array.isArray(index.nodes) ? index.nodes : [],
  };
}

function writeIndex(projectRoot, index) {
  writeJson(componentNodesIndexPath(projectRoot), {
    schemaVersion: 1,
    nodes: Array.isArray(index.nodes) ? index.nodes : [],
    updatedAt: new Date().toISOString(),
  });
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
  writeJson(stateFile, state);
  appendJsonl(componentNodeRevisionLogPath(projectRoot, node.nodeId), revisionRow('create', node));
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
  const state = readJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), null);
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
  const stateFile = absoluteStatePath(projectRoot, node.statePath, node.nodeId);
  writeJson(stateFile, state);
  appendJsonl(componentNodeRevisionLogPath(projectRoot, node.nodeId), revisionRow('update', node, current.node.revision));

  const index = readIndex(projectRoot);
  const nodes = index.nodes.map(item => ((item.nodeId || item.id) === node.nodeId ? node : item));
  writeIndex(projectRoot, { nodes });
  return { ok: true, node, state, revision: node.revision };
}

export function deleteComponentNode(projectRoot, nodeId) {
  const current = getComponentNode(projectRoot, nodeId);
  appendJsonl(componentNodeRevisionLogPath(projectRoot, current.node.nodeId), revisionRow('delete', current.node, current.node.revision));
  const index = readIndex(projectRoot);
  writeIndex(projectRoot, {
    nodes: index.nodes.filter(item => (item.nodeId || item.id) !== current.node.nodeId),
  });
  return { ok: true, nodeId: current.node.nodeId, removed: current.node };
}

export function listComponentNodes(projectRoot) {
  const index = readIndex(projectRoot);
  return index.nodes.map(node => validatedIndexNode(projectRoot, node));
}

export function componentStateRefs(projectRoot) {
  const refs = {};
  for (const node of listComponentNodes(projectRoot)) {
    const state = readJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), null);
    refs[node.nodeId] = {
      type: node.type,
      title: node.title,
      statePath: node.statePath,
      revision: node.revision,
      ...(state?.file ? { file: state.file } : {}),
    };
  }
  return refs;
}
