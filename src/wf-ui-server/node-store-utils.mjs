import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile, writeJsonFileAtomic } from './json-store-utils.mjs';

export function nodeStoreRoot(projectRoot, storeDir) {
  return path.join(projectRoot, 'Harness', 'a2a', storeDir);
}

export function nodeStoreIndexPath(projectRoot, storeDir) {
  return path.join(nodeStoreRoot(projectRoot, storeDir), 'index.json');
}

export function nodeStateRelPath(storeDir, nodeId) {
  return `Harness/a2a/${storeDir}/${nodeId}/state.json`;
}

export function nodeStatePath(projectRoot, { storeDir, statePath, nodeId, ErrorClass, label, rootLabel = label }) {
  const expected = nodeStateRelPath(storeDir, nodeId);
  const normalized = String(statePath || '').replace(/\\/g, '/');
  if (normalized !== expected) {
    throw new ErrorClass(`Invalid ${label} state path; traversal or mutable statePath is not allowed`);
  }
  const absolute = path.resolve(projectRoot, normalized);
  const root = path.resolve(nodeStoreRoot(projectRoot, storeDir));
  if (absolute !== path.resolve(nodeStoreRoot(projectRoot, storeDir), nodeId, 'state.json')) {
    throw new ErrorClass(`Invalid ${label} state path; escaped ${rootLabel} root`);
  }
  if (!(absolute === root || absolute.startsWith(`${root}${path.sep}`))) {
    throw new ErrorClass(`Invalid ${label} state path; escaped ${rootLabel} root`);
  }
  return absolute;
}

export function nodeRevisionLogPath(projectRoot, { storeDir, nodeId, assertNodeId }) {
  assertNodeId(nodeId);
  return path.join(nodeStoreRoot(projectRoot, storeDir), nodeId, 'revisions.jsonl');
}

export function readStoreJson(filePath, fallback) {
  return readJsonFile(filePath, fallback);
}

export function writeStoreJson(filePath, data) {
  writeJsonFileAtomic(filePath, data);
}

export function appendStoreJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

export function readNodeIndex(indexPath) {
  const index = readStoreJson(indexPath, { schemaVersion: 1, nodes: [] });
  return {
    schemaVersion: 1,
    nodes: Array.isArray(index?.nodes) ? index.nodes : [],
  };
}

export function writeNodeIndex(indexPath, index) {
  writeStoreJson(indexPath, {
    schemaVersion: 1,
    nodes: Array.isArray(index.nodes) ? index.nodes : [],
    updatedAt: new Date().toISOString(),
  });
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function slugPart(value, fallback) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || fallback;
}

export function normalizePosition(position) {
  const source = isPlainObject(position) ? position : {};
  return {
    x: Number.isFinite(Number(source.x)) ? Number(source.x) : 0,
    y: Number.isFinite(Number(source.y)) ? Number(source.y) : 0,
  };
}
