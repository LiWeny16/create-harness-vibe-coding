import fs from 'node:fs';
import path from 'node:path';
import { validateTaskId } from './security.mjs';

const MAX_BRIDGE_LIMIT = 1000;

function normalizeSessionId(sessionId) {
  const text = String(sessionId || '').trim();
  if (!validateTaskId(text)) throw new Error(`Invalid sessionId: ${sessionId}`);
  return text;
}

function bridgesRoot(projectRoot) {
  return path.join(projectRoot, 'Harness', 'a2a', 'bridges');
}

export function bridgeIdForSessions(leftSessionId, rightSessionId) {
  const left = normalizeSessionId(leftSessionId);
  const right = normalizeSessionId(rightSessionId);
  return [left, right].sort().join('__');
}

function bridgePath(projectRoot, bridgeId) {
  return path.join(bridgesRoot(projectRoot), `${bridgeId}.jsonl`);
}

function readJsonl(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

function appendJsonl(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(data)}\n`, 'utf8');
}

export function listBridgeMessages(projectRoot, { fromSessionId, toSessionId, limit = 200 } = {}) {
  const bridgeId = bridgeIdForSessions(fromSessionId, toSessionId);
  const max = Math.min(Math.max(Number(limit) || 200, 1), MAX_BRIDGE_LIMIT);
  const entries = readJsonl(bridgePath(projectRoot, bridgeId)).slice(-max);
  return {
    bridgeId,
    fromSessionId: normalizeSessionId(fromSessionId),
    toSessionId: normalizeSessionId(toSessionId),
    entries,
  };
}

export function recordBridgeMessage(projectRoot, {
  fromSessionId,
  toSessionId,
  fromNodeId = '',
  toNodeId = '',
  data = '',
  source = 'session-input',
} = {}) {
  const from = normalizeSessionId(fromSessionId);
  const to = normalizeSessionId(toSessionId);
  if (from === to) return null;
  const bridgeId = bridgeIdForSessions(from, to);
  const filePath = bridgePath(projectRoot, bridgeId);
  const current = readJsonl(filePath);
  const entry = {
    seq: current.length + 1,
    ts: new Date().toISOString(),
    bridgeId,
    fromSessionId: from,
    toSessionId: to,
    fromNodeId: String(fromNodeId || ''),
    toNodeId: String(toNodeId || ''),
    source,
    data: String(data || ''),
  };
  appendJsonl(filePath, entry);
  return entry;
}
