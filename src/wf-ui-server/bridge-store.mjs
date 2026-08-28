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

// List bridge entries for any bridge this session participates in (used for
// wakeup reads and cross-peer request aggregation; spec 6.1, 5).
export function listBridgeMessagesForSession(projectRoot, sessionId, {
  deliveryMode = '',
  requestId = '',
  threadId = '',
  limit = 200,
} = {}) {
  const session = normalizeSessionId(sessionId);
  const max = Math.min(Math.max(Number(limit) || 200, 1), MAX_BRIDGE_LIMIT);
  const dir = bridgesRoot(projectRoot);
  const entries = [];
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue;
      const bridgeId = file.slice(0, -'.jsonl'.length);
      if (!(bridgeId === session || bridgeId.startsWith(`${session}__`) || bridgeId.endsWith(`__${session}`))) continue;
      entries.push(...readJsonl(path.join(dir, file)));
    }
  }
  let filtered = entries;
  if (deliveryMode) filtered = filtered.filter(entry => entry.deliveryMode === deliveryMode);
  if (requestId) filtered = filtered.filter(entry => entry.requestId === requestId);
  if (threadId) filtered = filtered.filter(entry => entry.threadId === threadId);
  filtered.sort((a, b) => {
    const tsA = String(a.ts || '');
    const tsB = String(b.ts || '');
    return tsA === tsB ? (Number(a.seq) || 0) - (Number(b.seq) || 0) : tsA.localeCompare(tsB);
  });
  return { sessionId: session, entries: filtered.slice(-max) };
}

export function recordBridgeMessage(projectRoot, {
  fromSessionId,
  toSessionId,
  fromNodeId = '',
  toNodeId = '',
  data = '',
  source = 'session-input',
  messageId = '',
  threadId = '',
  topic = '',
  replyTo = '',
  requestId = '',
  toRole = '',
  contextRefs = [],
  deliveryMode = 'direct',
  recipientIndex = null,
  recipientCount = null,
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
    messageId: String(messageId || ''),
    threadId: String(threadId || ''),
    topic: String(topic || ''),
    replyTo: String(replyTo || ''),
    requestId: String(requestId || ''),
    toRole: String(toRole || ''),
    contextRefs: Array.isArray(contextRefs) ? contextRefs : [],
    deliveryMode: String(deliveryMode || 'direct'),
    recipientIndex: Number.isFinite(Number(recipientIndex)) ? Number(recipientIndex) : null,
    recipientCount: Number.isFinite(Number(recipientCount)) ? Number(recipientCount) : null,
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
