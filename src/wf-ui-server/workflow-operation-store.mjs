import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OPERATION_LIMIT = 20;
const OPERATION_TTL_MS = 4200;

function operationsPath(projectRoot) {
  return path.join(projectRoot, 'Harness', 'a2a', 'workflow-operations.jsonl');
}

function ensureOperationsDir(projectRoot) {
  fs.mkdirSync(path.dirname(operationsPath(projectRoot)), { recursive: true });
}

function isoTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function cleanActor(actor = {}) {
  const source = actor && typeof actor === 'object' && !Array.isArray(actor) ? actor : {};
  return {
    type: String(source.type || source.kind || 'agent').trim() || 'agent',
    ...(source.nodeId ? { nodeId: String(source.nodeId) } : {}),
    ...(source.sessionId ? { sessionId: String(source.sessionId) } : {}),
    ...(source.agentKind ? { agentKind: String(source.agentKind) } : {}),
    ...(source.label ? { label: String(source.label).slice(0, 120) } : {}),
  };
}

function cleanError(error) {
  if (!error) return undefined;
  return {
    code: String(error.code || 'OPERATION_ERROR').slice(0, 80),
    message: String(error.message || 'Workflow operation failed').slice(0, 240),
  };
}

function normalizeOperation(input = {}) {
  const now = new Date();
  const startedAt = isoTime(input.startedAt || now);
  const completedAt = isoTime(input.completedAt || now);
  const expiresAt = isoTime(input.expiresAt || new Date(now.getTime() + OPERATION_TTL_MS));
  return {
    id: String(input.id || `op-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`),
    kind: String(input.kind || 'agent.operation').trim() || 'agent.operation',
    actor: cleanActor(input.actor),
    targetNodeIds: uniqueStrings(input.targetNodeIds).slice(0, 40),
    edgeIds: uniqueStrings(input.edgeIds).slice(0, 40),
    status: String(input.status || 'completed').trim() || 'completed',
    startedAt,
    completedAt,
    expiresAt,
    ...(input.summary ? { summary: String(input.summary).slice(0, 240) } : {}),
    ...(input.error ? { error: cleanError(input.error) } : {}),
  };
}

function readOperationsFile(projectRoot) {
  const file = operationsPath(projectRoot);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines
    .map(line => {
      try {
        return normalizeOperation(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeBoundedOperations(projectRoot, records) {
  ensureOperationsDir(projectRoot);
  const bounded = records.slice(-OPERATION_LIMIT);
  fs.writeFileSync(
    operationsPath(projectRoot),
    bounded.map(record => JSON.stringify(normalizeOperation(record))).join('\n') + (bounded.length ? '\n' : ''),
  );
  return bounded;
}

export function appendWorkflowOperation(projectRoot, operation = {}) {
  const record = normalizeOperation(operation);
  const records = readOperationsFile(projectRoot);
  writeBoundedOperations(projectRoot, [...records, record]);
  return record;
}

export function listRecentWorkflowOperations(projectRoot, { limit = OPERATION_LIMIT } = {}) {
  const boundedLimit = Math.max(1, Math.min(OPERATION_LIMIT, Number(limit) || OPERATION_LIMIT));
  return readOperationsFile(projectRoot).slice(-boundedLimit);
}

export function workflowOperationsSnapshot(projectRoot) {
  return {
    schemaVersion: 1,
    source: 'Harness/a2a/workflow-operations.jsonl',
    recent: listRecentWorkflowOperations(projectRoot),
  };
}
