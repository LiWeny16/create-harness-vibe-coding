import fs from 'node:fs';
import path from 'node:path';
import { validateTaskId } from './security.mjs';

const MAX_READ_LIMIT = 2000;
const MAX_DROPPED_FILES = 12;
const MAX_DROPPED_FILE_BYTES = 10 * 1024 * 1024;

function validateSessionId(sessionId) {
  return validateTaskId(sessionId);
}

function isBoundTaskId(taskId) {
  return Boolean(taskId && validateTaskId(taskId));
}

function sessionsRoot(projectRoot, taskId) {
  if (isBoundTaskId(taskId)) {
    return path.join(projectRoot, 'Harness', 'tasks', taskId, 'sessions');
  }
  return path.join(projectRoot, 'Harness', 'a2a', 'sessions');
}

function sessionDir(projectRoot, taskId, sessionId) {
  if (taskId && !validateTaskId(taskId)) throw new Error(`Invalid taskId: ${taskId}`);
  if (!validateSessionId(sessionId)) throw new Error(`Invalid sessionId: ${sessionId}`);
  return path.join(sessionsRoot(projectRoot, taskId), sessionId);
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

function readJsonl(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function appendJsonl(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(data)}\n`, 'utf8');
}

// ── In-memory session index ──────────────────────────────────────────────────
// Maintained by every persistSession/appendTerminalData call and rebuilt once at
// backend startup. Snapshot fingerprinting (P1a) and the startup orphan
// downgrade (P1b) read this instead of scanning every session dir per request.
const sessionIndex = new Map();

export function touchSessionIndex(record, { activityOnly = false } = {}) {
  if (!record?.sessionId) return;
  const entry = sessionIndex.get(record.sessionId) || {};
  // activityOnly (terminal chunks/flushes) updates seq but NOT updatedAt: the
  // snapshot fingerprint must not churn with streamed output, or every 5s
  // poll rebuilds the snapshot and re-renders the canvas while any terminal
  // is active.
  const updatedAt = activityOnly
    ? (entry.updatedAt || new Date().toISOString())
    : (record.updatedAt ?? entry.updatedAt ?? new Date().toISOString());
  sessionIndex.set(record.sessionId, {
    ...entry,
    sessionId: record.sessionId,
    taskId: record.taskId ?? entry.taskId ?? null,
    runtime: record.runtime ?? entry.runtime,
    status: record.status ?? entry.status,
    updatedAt,
    terminalSeq: Number(record.terminalSeq ?? entry.terminalSeq ?? 0),
  });
}

export function getSessionIndexSummary() {
  let latestUpdatedAt = '';
  for (const entry of sessionIndex.values()) {
    if (String(entry.updatedAt || '') > latestUpdatedAt) latestUpdatedAt = String(entry.updatedAt);
  }
  return { count: sessionIndex.size, latestUpdatedAt };
}

export function getSessionIndexRecord(sessionId) {
  return sessionIndex.get(sessionId) || null;
}

// Rebuilds the index with a single scan of all session dirs. Called once at
// backend startup; per-request scans are gone.
export function buildSessionIndex(projectRoot) {
  sessionIndex.clear();
  for (const found of allSessionDirs(projectRoot)) {
    const state = readJson(path.join(found.dir, 'STATE.json'), null);
    if (state) touchSessionIndex({ ...state, taskId: found.taskId });
  }
  return sessionIndex.size;
}

// ── One-time startup migration: orphaned live sessions ───────────────────────
// At backend startup the in-memory registry manages nothing, so every disk
// record with a live status is orphaned by definition (its PTY died with the
// previous server). Persist the downgrade so snapshot, delete guards, and the
// UI all see one consistent truth instead of "fake-live" sessions.
export function downgradeOrphanedDiskSessions(projectRoot) {
  const downgraded = [];
  for (const found of allSessionDirs(projectRoot)) {
    const state = readJson(path.join(found.dir, 'STATE.json'), null);
    if (!state || !['running', 'starting'].includes(state.status)) continue;
    const updated = {
      ...state,
      status: 'stopped',
      blockedReason: state.blockedReason || 'not-managed-by-current-wf-ui',
      orphanedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // No clients can be attached right after a restart.
      wsClientCount: 0,
      attachMode: false,
    };
    writeJson(path.join(found.dir, 'STATE.json'), updated);
    touchSessionIndex({ ...updated, taskId: found.taskId });
    downgraded.push(found.sessionId);
  }
  return downgraded;
}

export function persistSession(projectRoot, session, patch = {}) {
  const dir = sessionDir(projectRoot, session.taskId, session.sessionId);
  const current = readJson(path.join(dir, 'STATE.json'), {});
  const state = {
    ...current,
    ...session,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeJson(path.join(dir, 'STATE.json'), state);
  touchSessionIndex(state);
  return state;
}

export function appendSessionEvent(projectRoot, session, event) {
  const dir = sessionDir(projectRoot, session.taskId, session.sessionId);
  appendJsonl(path.join(dir, 'events.jsonl'), {
    ts: new Date().toISOString(),
    taskId: session.taskId || null,
    sessionId: session.sessionId,
    runtime: session.runtime,
    ...event,
  });
}

// ── Batched terminal writes ──────────────────────────────────────────────────
// Per-chunk sync file I/O (read STATE.json + append terminal.jsonl + rewrite
// STATE.json per chunk) saturated the event loop when many terminals streamed
// at once. Entries now buffer per session and flush as ONE append + ONE state
// write every 500ms (or at 64 entries / 64KB, whichever first). Readers flush
// before reading, so disk reads always see the latest entry.
const TERMINAL_FLUSH_DELAY_MS = 500;
const TERMINAL_FLUSH_MAX_ENTRIES = 64;
const TERMINAL_FLUSH_MAX_BYTES = 64 * 1024;
const terminalFlushTimers = new Map();
const terminalBuffers = new Map();

export function flushTerminalBuffer(projectRoot, sessionId) {
  const pending = terminalBuffers.get(sessionId);
  if (!pending) return 0;
  terminalBuffers.delete(sessionId);
  const timer = terminalFlushTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    terminalFlushTimers.delete(sessionId);
  }
  const dir = sessionDir(projectRoot, pending.taskId, sessionId);
  const statePath = path.join(dir, 'STATE.json');
  const state = readJson(statePath, pending.session);
  const lines = pending.entries.map((entry) => `${JSON.stringify(entry)}\n`).join('');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'terminal.jsonl'), lines, 'utf8');
  const last = pending.entries[pending.entries.length - 1];
  const updatedState = {
    ...state,
    terminalSeq: last.seq,
    lastActivityAt: last.ts,
    updatedAt: last.ts,
  };
  writeJson(statePath, updatedState);
  touchSessionIndex(updatedState, { activityOnly: true });
  return pending.entries.length;
}

export function appendTerminalData(projectRoot, session, data, stream = 'stdout') {
  const indexRecord = getSessionIndexRecord(session.sessionId);
  const baseSeq = indexRecord
    ? Number(indexRecord.terminalSeq || 0)
    : Number(readJson(path.join(sessionDir(projectRoot, session.taskId, session.sessionId), 'STATE.json'), {}).terminalSeq || 0);
  const nextSeq = baseSeq + 1;
  const entry = {
    seq: nextSeq,
    ts: new Date().toISOString(),
    taskId: session.taskId || null,
    sessionId: session.sessionId,
    runtime: session.runtime,
    stream,
    data: String(data || ''),
  };
  const pending = terminalBuffers.get(session.sessionId) || {
    taskId: session.taskId,
    session,
    entries: [],
    bytes: 0,
  };
  pending.entries.push(entry);
  pending.bytes += entry.data.length;
  terminalBuffers.set(session.sessionId, pending);
  touchSessionIndex({ ...session, terminalSeq: nextSeq, updatedAt: entry.ts }, { activityOnly: true });

  if (pending.entries.length >= TERMINAL_FLUSH_MAX_ENTRIES || pending.bytes >= TERMINAL_FLUSH_MAX_BYTES) {
    flushTerminalBuffer(projectRoot, session.sessionId);
  } else if (!terminalFlushTimers.has(session.sessionId)) {
    const timer = setTimeout(() => {
      terminalFlushTimers.delete(session.sessionId);
      flushTerminalBuffer(projectRoot, session.sessionId);
    }, TERMINAL_FLUSH_DELAY_MS);
    timer.unref?.();
    terminalFlushTimers.set(session.sessionId, timer);
  }
  return entry;
}

function allSessionDirs(projectRoot) {
  const tasksRoot = path.join(projectRoot, 'Harness', 'tasks');
  let taskEntries = [];
  try {
    taskEntries = fs.readdirSync(tasksRoot, { withFileTypes: true });
  } catch {
    taskEntries = [];
  }
  const dirs = [];
  for (const taskEntry of taskEntries) {
    if (!taskEntry.isDirectory() || taskEntry.name.startsWith('_')) continue;
    const root = path.join(tasksRoot, taskEntry.name, 'sessions');
    let sessionEntries = [];
    try {
      sessionEntries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sessionEntry of sessionEntries) {
      if (sessionEntry.isDirectory()) {
        dirs.push({
          taskId: taskEntry.name,
          sessionId: sessionEntry.name,
          dir: path.join(root, sessionEntry.name),
          relRoot: `Harness/tasks/${taskEntry.name}/sessions/${sessionEntry.name}`,
        });
      }
    }
  }

  const a2aSessionsRoot = path.join(projectRoot, 'Harness', 'a2a', 'sessions');
  try {
    for (const sessionEntry of fs.readdirSync(a2aSessionsRoot, { withFileTypes: true })) {
      if (sessionEntry.isDirectory()) {
        dirs.push({
          taskId: null,
          sessionId: sessionEntry.name,
          dir: path.join(a2aSessionsRoot, sessionEntry.name),
          relRoot: `Harness/a2a/sessions/${sessionEntry.name}`,
        });
      }
    }
  } catch {
    // No unbound A2A sessions yet.
  }
  return dirs;
}

export function listTerminalSessions(projectRoot) {
  return allSessionDirs(projectRoot)
    .map(({ dir }) => readJson(path.join(dir, 'STATE.json'), null))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function findTerminalSession(projectRoot, sessionId) {
  if (!validateSessionId(sessionId)) return null;
  return allSessionDirs(projectRoot).find((entry) => entry.sessionId === sessionId) || null;
}

export function readTerminalRange(projectRoot, { sessionId, fromSeq, toSeq, tail } = {}) {
  // Disk reads always see the latest entry: flush the pending buffer first.
  flushTerminalBuffer(projectRoot, sessionId);
  const found = findTerminalSession(projectRoot, sessionId);
  if (!found) return { sessionId, entries: [] };
  let entries = readJsonl(path.join(found.dir, 'terminal.jsonl'));
  if (Number.isFinite(fromSeq)) entries = entries.filter((entry) => entry.seq >= fromSeq);
  if (Number.isFinite(toSeq)) entries = entries.filter((entry) => entry.seq <= toSeq);
  if (Number.isFinite(tail) && tail > 0) entries = entries.slice(-Math.min(tail, MAX_READ_LIMIT));
  else entries = entries.slice(0, MAX_READ_LIMIT);
  return { sessionId, taskId: found.taskId, entries };
}

function globToRegex(pattern) {
  const safe = String(pattern || '**/*')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${safe}$`);
}

export function globTerminalEvents(projectRoot, { pattern = '**/*', since, limit = 200 } = {}) {
  const regex = globToRegex(pattern.replace(/\\/g, '/'));
  const max = Math.min(Math.max(Number(limit) || 200, 1), MAX_READ_LIMIT);
  const sinceMs = since ? new Date(since).getTime() : null;
  const events = [];
  for (const found of allSessionDirs(projectRoot)) {
    for (const filename of ['events.jsonl', 'terminal.jsonl', 'input-requests.jsonl']) {
      const rel = `${found.relRoot}/${filename}`;
      if (!regex.test(rel)) continue;
      const rows = readJsonl(path.join(found.dir, filename));
      for (const row of rows) {
        const tsMs = row.ts ? new Date(row.ts).getTime() : 0;
        if (sinceMs && tsMs < sinceMs) continue;
        events.push({ source: rel, ...row });
      }
    }
  }
  return events
    .sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')))
    .slice(-max);
}

export function recordInputRequest(projectRoot, sessionId, text) {
  const found = findTerminalSession(projectRoot, sessionId);
  if (!found) throw new Error(`Session not found: ${sessionId}`);
  const state = readJson(path.join(found.dir, 'STATE.json'), null);
  if (!state?.attachMode) {
    throw new Error('Input rejected: session is in watch mode. Enable attach mode first.');
  }
  const event = {
    ts: new Date().toISOString(),
    type: 'terminal.input.requested',
    taskId: found.taskId || null,
    sessionId,
    data: String(text || ''),
  };
  appendJsonl(path.join(found.dir, 'input-requests.jsonl'), event);
  return event;
}

export function writeDroppedTerminalFiles(projectRoot, sessionId, files = []) {
  const found = findTerminalSession(projectRoot, sessionId);
  if (!found) {
    const err = new Error(`Session not found: ${sessionId}`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (!Array.isArray(files)) throw new Error('files must be an array');
  if (files.length > MAX_DROPPED_FILES) throw new Error(`Too many dropped files; max ${MAX_DROPPED_FILES}`);

  const dropRoot = path.join(found.dir, 'drops');
  fs.mkdirSync(dropRoot, { recursive: true });

  const written = files.map((file, index) => {
    const name = safeDropFileName(file?.name, index);
    const buffer = decodeDropContent(file?.contentBase64);
    if (buffer.byteLength > MAX_DROPPED_FILE_BYTES) {
      throw new Error(`Dropped file is too large: ${name}`);
    }
    const targetPath = uniqueDropPath(dropRoot, name);
    fs.writeFileSync(targetPath, buffer);
    return {
      name: path.basename(targetPath),
      path: targetPath,
      size: buffer.byteLength,
      terminalText: quoteTerminalPath(targetPath),
    };
  });

  const state = readJson(path.join(found.dir, 'STATE.json'), { sessionId, taskId: found.taskId });
  appendSessionEvent(projectRoot, state, {
    type: 'terminal.files.dropped',
    count: written.length,
    files: written.map(file => ({ name: file.name, path: file.path, size: file.size })),
  });
  return {
    files: written,
    terminalInput: written.map(file => file.terminalText).join(' '),
  };
}

function safeDropFileName(value, index) {
  const raw = String(value || `dropped-file-${index + 1}`);
  const basename = raw.split(/[\\/]+/).pop() || `dropped-file-${index + 1}`;
  const cleaned = basename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || `dropped-file-${index + 1}`).slice(0, 160);
}

function decodeDropContent(value) {
  const encoded = String(value || '');
  if (encoded.length > Math.ceil(MAX_DROPPED_FILE_BYTES * 1.4)) {
    throw new Error('Dropped file payload is too large');
  }
  return Buffer.from(encoded, 'base64');
}

function uniqueDropPath(dropRoot, filename) {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext) || 'dropped-file';
  let candidate = path.join(dropRoot, filename);
  for (let i = 2; fs.existsSync(candidate); i++) {
    candidate = path.join(dropRoot, `${stem}-${i}${ext}`);
  }
  const resolvedRoot = path.resolve(dropRoot);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Dropped file path escapes drop directory');
  }
  return resolvedCandidate;
}

function quoteTerminalPath(filePath) {
  return `'${String(filePath).replace(/'/g, "''")}'`;
}
