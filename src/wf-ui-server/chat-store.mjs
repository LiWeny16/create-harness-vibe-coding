import {
  appendTerminalData,
  readTerminalRange,
} from './terminal-store.mjs';

// ── Chat envelope store ──
// Canonical event envelopes ({seq, ts, type, payload}) for chat-mode sessions.
// Every envelope is mirrored into the terminal persist machinery as ONE stdout
// JSON line via appendTerminalData (so readTerminalRange keeps working and the
// transcript stays in one place); structured copies are also kept in a bounded
// in-memory ring as the fast path for WS replay/backfill, with the disk lines
// as the durable fallback after a server restart. seq comes from
// appendTerminalData itself, so envelope seq and terminal seq never diverge.
const ENVELOPE_MARKER = 'chat-envelope';
const MAX_MEMORY_ENVELOPES = 2000;
const MAX_READ_LIMIT = 2000;

/** sessionId -> envelope[] */
const memoryEnvelopes = new Map();

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEnvelopeBody({ type, payload, ts } = {}) {
  const at = typeof ts === 'number' && Number.isFinite(ts)
    ? new Date(ts).toISOString()
    : new Date().toISOString();
  return {
    kind: ENVELOPE_MARKER,
    ts: typeof ts === 'string' && ts ? ts : at,
    type: String(type || 'raw'),
    payload: isPlainObject(payload) ? payload : {},
  };
}

/**
 * Append one canonical envelope for a chat session. The terminal-store entry
 * carries the serialized body; the returned envelope pairs the assigned seq
 * with the body fields.
 * @returns {{seq:number, ts:string, type:string, payload:object}}
 */
export function appendChatEnvelope(projectRoot, session, event = {}) {
  const body = normalizeEnvelopeBody(event);
  const entry = appendTerminalData(projectRoot, session, JSON.stringify(body), 'stdout');
  const envelope = { seq: entry.seq, ts: body.ts, type: body.type, payload: body.payload };
  const ring = memoryEnvelopes.get(session.sessionId) || [];
  ring.push(envelope);
  if (ring.length > MAX_MEMORY_ENVELOPES) ring.splice(0, ring.length - MAX_MEMORY_ENVELOPES);
  memoryEnvelopes.set(session.sessionId, ring);
  return envelope;
}

function parseEnvelopeEntry(entry) {
  try {
    const parsed = JSON.parse(entry.data);
    if (parsed && parsed.kind === ENVELOPE_MARKER && parsed.type !== undefined) {
      return {
        seq: entry.seq,
        ts: String(parsed.ts || entry.ts),
        type: String(parsed.type),
        payload: isPlainObject(parsed.payload) ? parsed.payload : {},
      };
    }
  } catch { /* stdin mirrors and raw text lines are not envelopes */ }
  return null;
}

function readDiskEnvelopes(projectRoot, sessionId) {
  const { entries } = readTerminalRange(projectRoot, { sessionId });
  const envelopes = [];
  for (const entry of entries) {
    const envelope = parseEnvelopeEntry(entry);
    if (envelope) envelopes.push(envelope);
  }
  return envelopes;
}

/**
 * Stored envelopes for a chat session — the same store WS replay and the REST
 * range route both serve from. Memory ring first (covers live sessions), disk
 * fallback when the session is unknown to this server lifetime or the window
 * starts before the ring's oldest entry.
 */
export function readStoredEnvelopes(projectRoot, { sessionId } = {}) {
  if (!sessionId) return [];
  const ring = memoryEnvelopes.get(sessionId);
  if (Array.isArray(ring) && ring.length > 0) return [...ring];
  return readDiskEnvelopes(projectRoot, sessionId);
}

export function readChatEnvelopes(projectRoot, { sessionId, fromSeq, limit } = {}) {
  let envelopes = readStoredEnvelopes(projectRoot, { sessionId });
  const minMemorySeq = (() => {
    const ring = memoryEnvelopes.get(sessionId);
    return Array.isArray(ring) && ring.length > 0 ? ring[0].seq : null;
  })();
  if (Number.isFinite(fromSeq) && minMemorySeq !== null && fromSeq < minMemorySeq) {
    envelopes = readDiskEnvelopes(projectRoot, sessionId);
  }
  if (Number.isFinite(fromSeq)) envelopes = envelopes.filter((envelope) => envelope.seq >= fromSeq);
  const max = Math.min(Math.max(Number(limit) || MAX_READ_LIMIT, 1), MAX_READ_LIMIT);
  envelopes = envelopes.slice(-max);
  return { sessionId, envelopes };
}

export function clearChatEnvelopes(sessionId) {
  memoryEnvelopes.delete(sessionId);
}
