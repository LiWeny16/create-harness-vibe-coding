#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const MAX_LIMIT = 2000;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
    flags[key] = value;
  }
  return { command, flags };
}

function validId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
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

function appendJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

function allSessionDirs(projectRoot) {
  const tasksRoot = path.join(projectRoot, 'Harness', 'tasks');
  let tasks = [];
  try { tasks = fs.readdirSync(tasksRoot, { withFileTypes: true }); } catch { tasks = []; }
  const out = [];
  for (const task of tasks) {
    if (!task.isDirectory() || task.name.startsWith('_')) continue;
    const sessionsRoot = path.join(tasksRoot, task.name, 'sessions');
    let sessions = [];
    try { sessions = fs.readdirSync(sessionsRoot, { withFileTypes: true }); } catch { continue; }
    for (const session of sessions) {
      if (session.isDirectory()) out.push({ taskId: task.name, sessionId: session.name, dir: path.join(sessionsRoot, session.name) });
    }
  }
  const a2aSessionsRoot = path.join(projectRoot, 'Harness', 'a2a', 'sessions');
  let a2aSessions = [];
  try { a2aSessions = fs.readdirSync(a2aSessionsRoot, { withFileTypes: true }); } catch { a2aSessions = []; }
  for (const session of a2aSessions) {
    if (session.isDirectory()) out.push({ taskId: null, sessionId: session.name, dir: path.join(a2aSessionsRoot, session.name) });
  }
  return out;
}

function findSession(projectRoot, sessionId) {
  if (!validId(sessionId)) return null;
  return allSessionDirs(projectRoot).find((session) => session.sessionId === sessionId) || null;
}

function globToRegex(pattern) {
  const escaped = String(pattern || '**/*')
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function print(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function listSessions(projectRoot) {
  return allSessionDirs(projectRoot)
    .map(({ dir }) => readJson(path.join(dir, 'STATE.json')))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function readRange(projectRoot, flags) {
  const found = findSession(projectRoot, flags.session);
  if (!found) return { sessionId: flags.session, entries: [] };
  let entries = readJsonl(path.join(found.dir, 'terminal.jsonl'));
  const from = Number(flags.from);
  const to = Number(flags.to);
  const tail = Number(flags.tail);
  if (Number.isFinite(from)) entries = entries.filter((entry) => entry.seq >= from);
  if (Number.isFinite(to)) entries = entries.filter((entry) => entry.seq <= to);
  if (Number.isFinite(tail) && tail > 0) entries = entries.slice(-Math.min(tail, MAX_LIMIT));
  else entries = entries.slice(0, MAX_LIMIT);
  return { taskId: found.taskId, sessionId: found.sessionId, entries };
}

function globEvents(projectRoot, flags) {
  const regex = globToRegex(flags.pattern || flags.glob || '**/*');
  const limit = Math.min(Math.max(Number(flags.limit) || 200, 1), MAX_LIMIT);
  const sinceMs = flags.since ? new Date(flags.since).getTime() : null;
  const rows = [];
  for (const session of allSessionDirs(projectRoot)) {
    for (const filename of ['events.jsonl', 'terminal.jsonl', 'input-requests.jsonl']) {
      const rel = session.taskId
        ? `Harness/tasks/${session.taskId}/sessions/${session.sessionId}/${filename}`
        : `Harness/a2a/sessions/${session.sessionId}/${filename}`;
      if (!regex.test(rel)) continue;
      for (const row of readJsonl(path.join(session.dir, filename))) {
        const tsMs = row.ts ? new Date(row.ts).getTime() : 0;
        if (sinceMs && tsMs < sinceMs) continue;
        rows.push({ source: rel, ...row });
      }
    }
  }
  return rows.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || ''))).slice(-limit);
}

function postInput(urlText, token, sessionId, text) {
  return new Promise((resolve, reject) => {
    const base = new URL(urlText);
    const body = JSON.stringify({ data: text });
    const req = http.request({
      hostname: base.hostname,
      port: base.port,
      path: `/api/sessions/${encodeURIComponent(sessionId)}/input`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendInput(projectRoot, flags) {
  const sessionId = flags.session;
  const text = flags.text || '';
  const url = flags.url || process.env.WF_UI_URL;
  const token = flags.token || process.env.WF_UI_TOKEN;
  if (url) return postInput(url, token, sessionId, text);

  const found = findSession(projectRoot, sessionId);
  if (!found) throw new Error(`Session not found: ${sessionId}`);
  const state = readJson(path.join(found.dir, 'STATE.json'));
  if (!state?.attachMode) throw new Error('Input rejected: session is in watch mode. Enable attach mode first.');
  const row = {
    ts: new Date().toISOString(),
    type: 'terminal.input.requested',
    taskId: found.taskId,
    sessionId,
    data: text,
  };
  appendJsonl(path.join(found.dir, 'input-requests.jsonl'), row);
  return { queued: true, ...row };
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(flags.project || process.cwd());
  if (command === 'list-sessions') return print(listSessions(projectRoot));
  if (command === 'read-range') return print(readRange(projectRoot, flags));
  if (command === 'tail') return print(readRange(projectRoot, { ...flags, tail: flags.lines || flags.tail || 100 }));
  if (command === 'glob-events') return print(globEvents(projectRoot, flags));
  if (command === 'send-input') return print(await sendInput(projectRoot, flags));
  throw new Error('Usage: a2a-terminal.mjs list-sessions|read-range|tail|glob-events|send-input [--project .]');
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
