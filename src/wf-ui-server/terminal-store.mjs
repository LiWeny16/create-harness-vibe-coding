import fs from 'node:fs';
import path from 'node:path';
import { validateTaskId } from './security.mjs';

const MAX_READ_LIMIT = 2000;

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

export function appendTerminalData(projectRoot, session, data, stream = 'stdout') {
  const dir = sessionDir(projectRoot, session.taskId, session.sessionId);
  const statePath = path.join(dir, 'STATE.json');
  const state = readJson(statePath, session);
  const nextSeq = Number(state.terminalSeq || 0) + 1;
  const entry = {
    seq: nextSeq,
    ts: new Date().toISOString(),
    taskId: session.taskId || null,
    sessionId: session.sessionId,
    runtime: session.runtime,
    stream,
    data: String(data || ''),
  };
  appendJsonl(path.join(dir, 'terminal.jsonl'), entry);
  writeJson(statePath, {
    ...state,
    terminalSeq: nextSeq,
    lastActivityAt: entry.ts,
    updatedAt: entry.ts,
  });
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
