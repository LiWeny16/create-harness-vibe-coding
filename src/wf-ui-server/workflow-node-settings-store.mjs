import fs from 'node:fs';
import path from 'node:path';
import { ComponentNodeError } from './component-node-store.mjs';

const DEFAULT_AGENT_OUTPUT_ROUTING = {
  markdownDefaultEnabled: false,
  markdownTargetNodeId: '',
  fallback: 'oldest-connected-markdown',
};

// ── Schemas ──
const SCHEMAS = {
  markdown: {
    schemaId: 'markdown-settings',
    fields: {
      editorMode: { type: 'string', enum: ['wysiwyg', 'source'], default: 'wysiwyg' },
      autoSave: { type: 'boolean', default: false },
      wordWrap: { type: 'boolean', default: true },
      fontSize: { type: 'number', default: 14, min: 10, max: 32 },
    },
  },
  excalidraw: {
    schemaId: 'excalidraw-settings',
    fields: {
      autoSave: { type: 'boolean', default: false },
      gridSize: { type: 'number', default: 20, min: 5, max: 100 },
      viewBackgroundColor: { type: 'string', default: '#ffffff' },
      exportScale: { type: 'number', default: 1, min: 1, max: 4 },
      theme: { type: 'string', enum: ['light', 'dark'], default: 'light' },
    },
  },
  file: {
    schemaId: 'file-settings',
    fields: {
      autoRefresh: { type: 'boolean', default: false },
      maxPreviewSize: { type: 'number', default: 256, min: 16, max: 4096 }, // KB
      defaultView: { type: 'string', enum: ['preview', 'metadata'], default: 'preview' },
      watchChanges: { type: 'boolean', default: false },
    },
  },
  agent: {
    schemaId: 'agent-settings',
    fields: {
      outputRouting: { type: 'object', default: DEFAULT_AGENT_OUTPUT_ROUTING },
    },
  },
};

const COMPONENT_NODE_ID_RE = /^component-[a-z0-9][a-z0-9-]*$/;
const SAFE_AGENT_NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// ── Helpers ──
function assertSettingsNodeId(nodeId, kindHint = '') {
  const value = String(nodeId || '').trim();
  const kind = String(kindHint || '').trim().toLowerCase();
  if (kind === 'agent' || (!kind && !COMPONENT_NODE_ID_RE.test(value))) {
    if (!SAFE_AGENT_NODE_ID_RE.test(value)) {
      throw new ComponentNodeError('Invalid workflow node id; traversal and escaped ids are not allowed');
    }
    return { id: value, scope: 'agent' };
  }
  if (!COMPONENT_NODE_ID_RE.test(value)) {
    throw new ComponentNodeError('Invalid component node id; traversal and escaped ids are not allowed');
  }
  return { id: value, scope: 'component' };
}

function assertKind(kind) {
  const value = String(kind || '').trim().toLowerCase();
  if (!Object.hasOwn(SCHEMAS, value)) {
    throw new ComponentNodeError('Invalid settings kind; expected markdown, excalidraw, file, or agent');
  }
  return value;
}

function settingsRoot(projectRoot) {
  return path.join(projectRoot, 'Harness', 'a2a', 'component-nodes');
}

function agentSettingsRoot(projectRoot) {
  return path.join(projectRoot, 'Harness', 'a2a', 'nodes');
}

function ensureInside(root, target) {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  const relative = path.relative(base, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ComponentNodeError('Invalid workflow node settings path; escaped settings root');
  }
  return resolved;
}

function settingsPath(projectRoot, nodeId, kindHint = '') {
  const { id, scope } = assertSettingsNodeId(nodeId, kindHint);
  const root = scope === 'agent' ? agentSettingsRoot(projectRoot) : settingsRoot(projectRoot);
  return ensureInside(root, path.join(root, id, 'settings.json'));
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneDefault(value) {
  if (Array.isArray(value)) return [...value];
  if (isPlainObject(value)) return { ...value };
  return value;
}

function defaultsFor(kind) {
  const schema = SCHEMAS[kind];
  if (!schema) return {};
  const values = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    values[key] = cloneDefault(field.default);
  }
  return values;
}

function kindForSchemaId(schemaId) {
  for (const kind of Object.keys(SCHEMAS)) {
    if (SCHEMAS[kind].schemaId === schemaId) return kind;
  }
  return null;
}

function invalidField(key, message) {
  return new ComponentNodeError(`Invalid settings field "${key}": ${message}`, {
    statusCode: 400,
    code: 'INVALID_SETTINGS',
  });
}

function normalizeOutputRouting(value) {
  if (!isPlainObject(value)) throw invalidField('outputRouting', 'expected an object');
  const enabled = value.markdownDefaultEnabled === undefined
    ? DEFAULT_AGENT_OUTPUT_ROUTING.markdownDefaultEnabled
    : value.markdownDefaultEnabled;
  if (typeof enabled !== 'boolean') {
    throw invalidField('outputRouting', 'markdownDefaultEnabled must be a boolean');
  }
  const target = String(value.markdownTargetNodeId ?? DEFAULT_AGENT_OUTPUT_ROUTING.markdownTargetNodeId).trim();
  if (target && !COMPONENT_NODE_ID_RE.test(target)) {
    throw invalidField('outputRouting', 'markdownTargetNodeId must be a component node id');
  }
  let fallback = value.fallback;
  if (fallback === undefined || fallback === true || fallback === '') fallback = DEFAULT_AGENT_OUTPUT_ROUTING.fallback;
  if (fallback !== false && fallback !== 'oldest-connected-markdown') {
    throw invalidField('outputRouting', 'fallback must be false or oldest-connected-markdown');
  }
  return {
    markdownDefaultEnabled: enabled,
    markdownTargetNodeId: target,
    fallback,
  };
}

function normalizeFieldValue(key, field, value) {
  if (field.type === 'object') {
    if (key === 'outputRouting') return normalizeOutputRouting(value);
    if (!isPlainObject(value)) throw invalidField(key, 'expected an object');
    return { ...value };
  }
  return value;
}

function validateValues(schema, values) {
  for (const [key, field] of Object.entries(schema.fields)) {
    if (!Object.hasOwn(values, key)) continue;
    const value = values[key];
    if (field.type === 'string') {
      if (typeof value !== 'string') throw invalidField(key, 'expected a string');
      if (field.enum && !field.enum.includes(value)) {
        throw invalidField(key, `must be one of: ${field.enum.join(', ')}`);
      }
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') throw invalidField(key, 'expected a boolean');
    } else if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidField(key, 'expected a number');
      if (field.min !== undefined && value < field.min) throw invalidField(key, `must be >= ${field.min}`);
      if (field.max !== undefined && value > field.max) throw invalidField(key, `must be <= ${field.max}`);
    } else if (field.type === 'object') {
      if (!isPlainObject(value)) throw invalidField(key, 'expected an object');
    }
  }
}

// ── Public API ──
export function getSettingsSchema(kind) {
  return SCHEMAS[kind] || null;
}

export function readNodeSettings(projectRoot, nodeId, kindHint = '') {
  const hintedKind = kindHint ? assertKind(kindHint) : null;
  const raw = readJson(settingsPath(projectRoot, nodeId, hintedKind || ''), null);
  if (!raw && hintedKind) {
    return { values: defaultsFor(hintedKind), revision: 0, schemaId: SCHEMAS[hintedKind].schemaId };
  }
  if (!isPlainObject(raw) || typeof raw.schemaId !== 'string' || !kindForSchemaId(raw.schemaId)) {
    return { values: {}, revision: 0, schemaId: null };
  }
  const kind = kindForSchemaId(raw.schemaId);
  const values = defaultsFor(kind);
  const stored = isPlainObject(raw.values) ? raw.values : {};
  for (const key of Object.keys(stored)) {
    const field = SCHEMAS[kind].fields[key];
    if (field) values[key] = normalizeFieldValue(key, field, stored[key]);
  }
  const revision = Number.isInteger(raw.revision) && raw.revision >= 1 ? raw.revision : 0;
  return { values, revision, schemaId: raw.schemaId };
}

export function writeNodeSettings(projectRoot, nodeId, values, kindHint = '') {
  const current = readNodeSettings(projectRoot, nodeId, kindHint);
  if (!current.schemaId) {
    throw new ComponentNodeError('Component node settings are not initialized; call initNodeSettings first', {
      statusCode: 400,
      code: 'SETTINGS_NOT_INITIALIZED',
    });
  }
  const schema = SCHEMAS[kindForSchemaId(current.schemaId)];
  const merged = { ...current.values };
  const incoming = isPlainObject(values) ? values : {};
  for (const key of Object.keys(incoming)) {
    const field = schema.fields[key];
    if (field) merged[key] = normalizeFieldValue(key, field, incoming[key]);
  }
  validateValues(schema, merged);
  const revision = current.revision + 1;
  writeJson(settingsPath(projectRoot, nodeId, kindForSchemaId(current.schemaId)), { schemaId: schema.schemaId, revision, values: merged });
  return { ok: true, values: merged, revision, schemaId: schema.schemaId };
}

export function deleteNodeSettings(projectRoot, nodeId, kindHint = '') {
  const file = settingsPath(projectRoot, nodeId, kindHint);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  return { ok: true };
}

export function initNodeSettings(projectRoot, nodeId, kind) {
  const schema = SCHEMAS[assertKind(kind)];
  const values = defaultsFor(kind);
  writeJson(settingsPath(projectRoot, nodeId, kind), { schemaId: schema.schemaId, revision: 1, values });
  return { ok: true, values, revision: 1, schemaId: schema.schemaId };
}
