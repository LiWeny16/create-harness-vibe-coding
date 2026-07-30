import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalizeProjectPath, validateTaskId } from './security.mjs';
import { parseTaskList, parseTaskCapsule, parseArchivedTasks, readTaskFile } from './task-parser.mjs';
import { loadSettings } from './settings.mjs';
import { generateToken, validateToken } from './token.mjs';
import { detectRuntimesCached, resolveRuntimeResumeArgs } from './runtime-detector.mjs';
import { spawnPty } from './pty-adapter.mjs';
import { killPtyProcess, registerPtyProcess, unregisterPtyProcess, writePtyInput } from './ws-terminal.mjs';
import {
  ensureA2aDefaults,
  loadA2aSkills,
  buildWorkflowSnapshot,
  loadBuiltInWorkflows,
  loadRoleGraph,
} from './a2a-store.mjs';
import { readRuntimeConfig, writeRuntimeConfig } from './runtime-config.mjs';
import {
  appendSessionEvent,
  appendTerminalData,
  globTerminalEvents,
  listTerminalSessions,
  persistSession,
  readTerminalRange,
  recordInputRequest,
} from './terminal-store.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SERVER_VERSION = '0.8.19';

// ── In-memory debug state (frontend posts, CLI reads) ──
let debugState = {
  connected: false,
  route: null,
  tasks: null,
  taskCount: 0,
  errors: [],
  events: [],
  lastUpdate: null,
};

/**
 * Resolve the UI dist directory.
 */
function resolveUiDist() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const pkgDist = path.resolve(__dirname, '..', '..', 'dist', 'wf-ui');
  if (fs.existsSync(pkgDist)) return pkgDist;
  const devDist = path.resolve(__dirname, '..', 'ui', 'dist');
  if (fs.existsSync(devDist)) return devDist;
  return null;
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const cacheControl = filePath.includes(`${path.sep}assets${path.sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': cacheControl,
    });
    res.end(content);
  } catch {
    return false;
  }
  return true;
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function sendError(res, statusCode, code, message, details) {
  const err = { error: { code, message } };
  if (details !== undefined) err.error.details = details;
  sendJson(res, statusCode, err);
}

function tokenFromRequest(req, url) {
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function mergeSessions(memorySessions, diskSessions) {
  const byId = new Map();
  for (const session of diskSessions) byId.set(session.sessionId, session);
  for (const session of memorySessions) byId.set(session.sessionId, { ...byId.get(session.sessionId), ...session });
  return [...byId.values()].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function isLiveSession(session) {
  return session?.status === 'running' || session?.status === 'starting';
}

function withResumeMetadata(session) {
  const runtimeInfo = detectRuntimesCached({ includeMissing: true })
    .find((candidate) => candidate.id === session.runtime);
  const resumeArgs = resolveRuntimeResumeArgs(session.runtime, { agentSessionId: session.agentSessionId });
  const command = runtimeInfo?.command || session.runtime;
  return {
    ...session,
    resumeSupported: resumeArgs.length > 0,
    resumeArgs,
    resumeCommand: resumeArgs.length > 0 ? [command, ...resumeArgs].join(' ') : null,
  };
}

export function createServer({ projectRoot, sessionRegistry: sr, token: expectedToken, terminalHub = null }) {
  const absRoot = canonicalizeProjectPath(projectRoot);
  const startTime = Date.now();
  ensureA2aDefaults(absRoot);

  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;

    if (expectedToken && pathname.startsWith('/api/')) {
      const presented = tokenFromRequest(req, url);
      if (!presented) return sendError(res, 401, 'UNAUTHORIZED', 'Missing token');
      if (!validateToken(presented, expectedToken)) return sendError(res, 403, 'FORBIDDEN', 'Invalid token');
    }

    // ── GET /api/health ──
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        status: 'ok',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        version: SERVER_VERSION,
      });
    }

    // ── GET /api/project ──
    if (req.method === 'GET' && pathname === '/api/project') {
      const tasksRoot = path.join(absRoot, 'Harness', 'tasks');
      let taskCount = 0;
      try {
        if (fs.existsSync(tasksRoot)) {
          const dirs = fs.readdirSync(tasksRoot, { withFileTypes: true });
          taskCount = dirs.filter(d => d.isDirectory() && !d.name.startsWith('_')).length;
        }
      } catch { /* fallback */ }
      let version = 'unknown';
      try {
        const vp = path.join(absRoot, 'Harness', '.harness-version');
        if (fs.existsSync(vp)) {
          const v = JSON.parse(fs.readFileSync(vp, 'utf8'));
          version = v.version || 'unknown';
        }
      } catch { /* fallback */ }
      return sendJson(res, 200, { root: absRoot, version, taskCount });
    }

    // ── GET /api/tasks ──
    if (req.method === 'GET' && pathname === '/api/tasks') {
      const tasksRoot = path.join(absRoot, 'Harness', 'tasks');
      const tasks = parseTaskList(tasksRoot);
      return sendJson(res, 200, tasks);
    }

    // ── GET /api/tasks/archived ──
    if (req.method === 'GET' && pathname === '/api/tasks/archived') {
      const tasksRoot = path.join(absRoot, 'Harness', 'tasks');
      return sendJson(res, 200, parseArchivedTasks(tasksRoot));
    }

    // ── GET /api/tasks/:taskId ──
    const tasksMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (req.method === 'GET' && tasksMatch) {
      const taskId = tasksMatch[1];
      if (!validateTaskId(taskId)) {
        return sendError(res, 400, 'BAD_REQUEST', 'Invalid task ID');
      }
      const taskDir = path.join(absRoot, 'Harness', 'tasks', taskId);
      try {
        const capsule = parseTaskCapsule(taskDir);
        if (capsule === null) {
          return sendError(res, 404, 'NOT_FOUND', `Task "${taskId}" not found`);
        }
        return sendJson(res, 200, capsule);
      } catch (err) {
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read task capsule', err.message);
      }
    }

    const taskArchiveMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/archive$/);
    if (req.method === 'POST' && taskArchiveMatch) {
      const taskId = taskArchiveMatch[1];
      if (!validateTaskId(taskId)) return sendError(res, 400, 'BAD_REQUEST', 'Invalid task ID');
      try {
        return sendJson(res, 200, archiveTask(absRoot, taskId));
      } catch (e) {
        return sendError(res, 400, 'BAD_REQUEST', e.message);
      }
    }

    // ── GET /api/settings ──
    if (req.method === 'GET' && pathname === '/api/settings') {
      const settings = loadSettings(absRoot);
      return sendJson(res, 200, settings);
    }

    if (req.method === 'GET' && pathname === '/api/runtimes') {
      return sendJson(res, 200, detectRuntimesCached({
        includeMissing: url.searchParams.get('all') === '1',
        refresh: url.searchParams.get('refresh') === '1',
      }));
    }

    const runtimeConfigMatch = pathname.match(/^\/api\/runtimes\/([^/]+)\/config$/);
    if (req.method === 'GET' && runtimeConfigMatch) {
      try {
        return sendJson(res, 200, readRuntimeConfig(absRoot, runtimeConfigMatch[1]));
      } catch (e) {
        return sendError(res, 400, 'BAD_REQUEST', e.message);
      }
    }

    if (req.method === 'POST' && runtimeConfigMatch) {
      readJsonBody(req).then((payload) => {
        try {
          const result = writeRuntimeConfig(absRoot, runtimeConfigMatch[1], payload);
          sendJson(res, 200, result);
        } catch (e) {
          sendError(res, 400, 'BAD_REQUEST', e.message);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/workflow') {
      return sendJson(res, 200, buildWorkflowSnapshot(absRoot, sr));
    }

    if (req.method === 'GET' && pathname === '/api/workflows') {
      return sendJson(res, 200, loadBuiltInWorkflows(absRoot));
    }

    if (req.method === 'GET' && pathname === '/api/roles') {
      return sendJson(res, 200, loadRoleGraph(absRoot));
    }

    if (req.method === 'POST' && pathname === '/api/workflow/run') {
      if (!sr || typeof sr.create !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      readJsonBody(req).then(async (payload) => {
        try {
          const session = await createWorkflowSession(sr, absRoot, payload, terminalHub);
          sendJson(res, 201, session);
        } catch (e) {
          sendError(res, 400, 'BAD_REQUEST', e.message);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/a2a/skills') {
      return sendJson(res, 200, loadA2aSkills(absRoot));
    }

    if (req.method === 'GET' && pathname === '/api/terminals') {
      return sendJson(res, 200, listTerminalSessions(absRoot));
    }

    if (req.method === 'GET' && pathname === '/api/terminals/events') {
      return sendJson(res, 200, globTerminalEvents(absRoot, {
        pattern: url.searchParams.get('glob') || '**/*',
        since: url.searchParams.get('since') || undefined,
        limit: Number(url.searchParams.get('limit') || 200),
      }));
    }

    const rangeMatch = pathname.match(/^\/api\/terminals\/([^/]+)\/range$/);
    if (req.method === 'GET' && rangeMatch) {
      return sendJson(res, 200, readTerminalRange(absRoot, {
        sessionId: rangeMatch[1],
        fromSeq: url.searchParams.has('fromSeq') ? Number(url.searchParams.get('fromSeq')) : undefined,
        toSeq: url.searchParams.has('toSeq') ? Number(url.searchParams.get('toSeq')) : undefined,
        tail: url.searchParams.has('tail') ? Number(url.searchParams.get('tail')) : undefined,
      }));
    }

    // ── GET /api/sessions ──
    if (req.method === 'GET' && pathname === '/api/sessions') {
      const memorySessions = sr && typeof sr.getAll === 'function' ? sr.getAll() : [];
      const includeAll = url.searchParams.get('all') === '1';
      const sessions = includeAll
        ? mergeSessions(memorySessions, listTerminalSessions(absRoot)).map(withResumeMetadata)
        : memorySessions.filter(isLiveSession).map(withResumeMetadata);
      return sendJson(res, 200, sessions);
    }

    // ── POST /api/sessions — create a new session ──
    if (req.method === 'POST' && pathname === '/api/sessions') {
      if (!sr || typeof sr.create !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      readJsonBody(req).then(async (payload) => {
        try {
          const session = await createRuntimeSession(sr, absRoot, payload, terminalHub);
          sendJson(res, 201, session);
        } catch (e) {
          sendError(res, 400, 'BAD_REQUEST', e.message);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    const taskSessionMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/sessions$/);
    if (req.method === 'POST' && taskSessionMatch) {
      if (!sr || typeof sr.create !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      const routeTaskId = taskSessionMatch[1];
      if (!validateTaskId(routeTaskId)) return sendError(res, 400, 'BAD_REQUEST', 'Invalid task ID');
      readJsonBody(req).then(async (payload) => {
        try {
          const session = await createRuntimeSession(sr, absRoot, { ...payload, taskId: routeTaskId }, terminalHub);
          sendJson(res, 201, session);
        } catch (e) {
          sendError(res, 400, 'BAD_REQUEST', e.message);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    // ── POST /api/sessions/:sessionId/stop ──
    const stopMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/stop$/);
    if (req.method === 'POST' && stopMatch) {
      if (!sr || typeof sr.stop !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      const sessionId = stopMatch[1];
      const runStop = typeof sr.withLock === 'function'
        ? sr.withLock(sessionId, () => stopRuntimeSession(sr, absRoot, sessionId, terminalHub))
        : Promise.resolve(stopRuntimeSession(sr, absRoot, sessionId, terminalHub));
      runStop
        .then(result => sendJson(res, 200, result))
        .catch(e => sendError(res, 500, 'INTERNAL_ERROR', e.message));
      return;
    }

    const attachMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/attach-mode$/);
    if (req.method === 'POST' && attachMatch) {
      if (!sr || typeof sr.get !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      const session = sr.get(attachMatch[1]);
      if (!session) return sendError(res, 404, 'NOT_FOUND', 'Session not found');
      readJsonBody(req).then((payload) => {
        const attachMode = Boolean(payload.attachMode);
        sr.update(session.sessionId, { attachMode });
        const updated = sr.get(session.sessionId);
        persistSession(absRoot, updated);
        appendSessionEvent(absRoot, updated, { type: 'session.attach-mode', attachMode });
        sendJson(res, 200, updated);
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    const inputMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/input$/);
    if (req.method === 'POST' && inputMatch) {
      if (!sr || typeof sr.get !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      const session = sr.get(inputMatch[1]);
      if (!session) return sendError(res, 404, 'NOT_FOUND', 'Session not found');
      readJsonBody(req).then((payload) => {
        const data = String(payload.data || payload.text || '');
        if (!session.attachMode) return sendError(res, 409, 'WATCH_MODE', 'Input rejected: session is in watch mode');
        if (!writePtyInput(session.sessionId, data)) return sendError(res, 409, 'NO_PTY', 'No PTY process attached to this session');
        recordInputRequest(absRoot, session.sessionId, data);
        appendTerminalData(absRoot, session, data, 'stdin');
        return sendJson(res, 200, { ok: true, sessionId: session.sessionId });
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    // ── GET /api/tasks/:taskId/file/:filename ──
    const fileMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/file\/([^/]+)$/);
    if (req.method === 'GET' && fileMatch) {
      const fileTaskId = fileMatch[1];
      const filename = fileMatch[2];
      if (!validateTaskId(fileTaskId)) return sendError(res, 400, 'BAD_REQUEST', 'Invalid task ID');
      const taskDir = findTaskDirectory(absRoot, fileTaskId);
      if (!taskDir || !fs.existsSync(taskDir)) return sendError(res, 404, 'NOT_FOUND', `Task "${fileTaskId}" not found`);
      const fileData = readTaskFile(taskDir, filename);
      if (!fileData) return sendError(res, 404, 'NOT_FOUND', `File "${filename}" not found`);
      return sendJson(res, 200, fileData);
    }

    // ── POST /api/settings — write project settings ──
    if (req.method === 'POST' && pathname === '/api/settings') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const newSettings = JSON.parse(body);
          const current = loadSettings(absRoot);
          const merged = { ...current, ...newSettings };
          const settingsPath = path.join(absRoot, 'Harness', 'settings.json');
          fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
          fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
          sendJson(res, 200, merged);
        } catch (e) {
          sendError(res, 400, 'BAD_REQUEST', e.message);
        }
      });
      return;
    }

    // ── POST /api/debug/report — frontend posts UI state ──
    if (req.method === 'POST' && pathname === '/api/debug/report') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const report = JSON.parse(body);
          debugState = {
            ...debugState,
            ...report,
            lastUpdate: new Date().toISOString(),
          };
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendError(res, 400, 'BAD_REQUEST', 'Invalid JSON');
        }
      });
      return;
    }

    // ── GET /api/debug/state — read latest frontend UI state ──
    if (req.method === 'GET' && pathname === '/api/debug/state') {
      const tasksRoot = path.join(absRoot, 'Harness', 'tasks');
      let tasks = [];
      try { tasks = parseTaskList(tasksRoot); } catch { /* */ }
      return sendJson(res, 200, {
        frontend: debugState,
        server: {
          version: SERVER_VERSION,
          uptime: Math.floor((Date.now() - startTime) / 1000),
          projectRoot: absRoot,
          tasksOnDisk: tasks.length,
        },
      });
    }

    // ── Static assets ──
    if (req.method === 'GET') {
      const uiDist = resolveUiDist();
      if (uiDist) {
        // /assets/* and /favicon.ico
        if (pathname.startsWith('/assets/') || pathname === '/favicon.ico') {
          const assetPath = path.join(uiDist, pathname);
          if (serveStatic(res, assetPath)) return;
        }
        // SPA fallback: all other GET → index.html
        if (!pathname.startsWith('/api/') && !pathname.startsWith('/ws/')) {
          const indexPath = path.join(uiDist, 'index.html');
          if (serveStatic(res, indexPath)) return;
        }
      }
    }

    return sendError(res, 404, 'NOT_FOUND', `No route matches ${req.method} ${pathname}`);
  });

  return server;
}

function optionalTaskId(value) {
  const taskId = String(value || '').trim();
  if (!taskId) return null;
  if (!validateTaskId(taskId)) throw new Error(`Invalid taskId: ${taskId}`);
  return taskId;
}

function cleanString(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function findTaskDirectory(absRoot, taskId) {
  const tasksRoot = path.join(absRoot, 'Harness', 'tasks');
  const activeDir = path.join(tasksRoot, taskId);
  if (fs.existsSync(activeDir)) return activeDir;

  const archiveRoot = path.join(tasksRoot, '_archive');
  if (!fs.existsSync(archiveRoot)) return null;
  const stack = [archiveRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(current, entry.name);
      if (entry.name === taskId && fs.existsSync(path.join(dir, 'STATE.json'))) return dir;
      stack.push(dir);
    }
  }
  return null;
}

function readTaskState(absRoot, taskId) {
  const taskDir = taskId ? findTaskDirectory(absRoot, taskId) : null;
  if (!taskDir) return null;
  const statePath = path.join(taskDir, 'STATE.json');
  try {
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveTaskRuntime(absRoot, taskId, requestedRuntime) {
  if (requestedRuntime) return requestedRuntime;
  const taskState = readTaskState(absRoot, taskId);
  const settings = loadSettings(absRoot);
  return cleanString(
    taskState?.defaultRuntime ||
    taskState?.defaultAgentRuntime ||
    taskState?.agentRuntime ||
    taskState?.cliAgent ||
    settings?.terminal?.defaultRuntime,
    'codex',
  );
}

function rememberTaskRuntime(absRoot, taskId, runtime) {
  if (!taskId || !runtime) return;
  const taskDir = findTaskDirectory(absRoot, taskId);
  if (!taskDir || taskDir.includes(`${path.sep}_archive${path.sep}`)) return;
  const statePath = path.join(taskDir, 'STATE.json');
  try {
    if (!fs.existsSync(statePath)) return;
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const next = {
      ...state,
      defaultRuntime: runtime,
      defaultAgentRuntime: runtime,
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(statePath, next);
  } catch {
    // Runtime binding is recovery metadata; session launch remains authoritative.
  }
}

function archiveTask(absRoot, taskId) {
  const scriptPath = path.join(absRoot, 'Harness', 'scripts', 'task-state.mjs');
  if (!fs.existsSync(scriptPath)) {
    throw new Error('Harness/scripts/task-state.mjs is not available for archive');
  }
  const result = spawnSync(process.execPath, [scriptPath, 'archive', '--apply', '--task', taskId, '--json'], {
    cwd: absRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  let payload = null;
  try { payload = result.stdout ? JSON.parse(result.stdout) : null; } catch { /* keep fallback */ }
  if (result.status !== 0 || payload?.ok === false) {
    const message = payload?.errors?.join('; ') || result.stderr || result.stdout || `Archive failed for ${taskId}`;
    throw new Error(message.trim());
  }
  return payload || { ok: true, command: 'archive', taskId };
}

function stopRuntimeSession(sr, absRoot, sessionId, terminalHub = null) {
  const session = sr.get(sessionId);
  if (!session) {
    killPtyProcess(sessionId);
    return { ok: true, killed: false, saved: null, alreadyStopped: true };
  }

  const killed = killPtyProcess(sessionId);
  const stopped = sr.stop(sessionId);
  if (!stopped) return { ok: true, killed, saved: null, alreadyStopped: true };
  const updated = withResumeMetadata({
    ...stopped,
    status: 'saved',
    killed,
    wsClientCount: 0,
    stoppedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  persistSession(absRoot, updated);
  appendSessionEvent(absRoot, updated, { type: 'session.stopped', killed });
  terminalHub?.broadcastToSession?.(updated.sessionId, {
    type: 'session:state',
    sessionId: updated.sessionId,
    state: updated.status || 'saved',
  });
  return { ok: true, killed, saved: updated };
}

function workflowCommandForRuntime(runtime, command) {
  if (runtime === 'codex' && command.startsWith('/')) return `$${command.slice(1)}`;
  return command;
}

function workflowInitialInput(runtime, workflow, ceoPrompt) {
  const command = workflowCommandForRuntime(runtime, workflow.command || '/wf');
  return `${command}\n${ceoPrompt.trim()}\n`;
}

async function createWorkflowSession(sr, absRoot, payload, terminalHub = null) {
  const workflows = loadBuiltInWorkflows(absRoot);
  const selectedWorkflow = workflows.find((workflow) =>
    workflow.id === payload.workflowId || workflow.command === payload.workflowCommand
  ) || workflows[0];
  const detected = detectRuntimesCached();
  const runtime = cleanString(payload.runtime, detected[0]?.id || '');
  if (!runtime) throw new Error('No detected runtime is available to start /wf');
  const ceoPrompt = cleanString(payload.ceoPrompt, selectedWorkflow.defaultCeoPrompt || 'Run Harness /wf mode as the CEO agent.');

  return createRuntimeSession(sr, absRoot, {
    ...payload,
    runtime,
    role: 'CEO',
    objective: `${selectedWorkflow.label || 'WF'} CEO terminal`,
    workflowMode: 'wf',
    workflowId: selectedWorkflow.id,
    workflowCommand: selectedWorkflow.command || '/wf',
    ceoPrompt,
    initialInput: workflowInitialInput(runtime, selectedWorkflow, ceoPrompt),
  }, terminalHub);
}

async function createRuntimeSession(sr, absRoot, payload, terminalHub = null) {
  const taskId = optionalTaskId(payload.taskId);
  const runtime = resolveTaskRuntime(absRoot, taskId, cleanString(payload.runtime));
  if (!runtime) throw new Error('Runtime is required');
  const role = cleanString(payload.role, 'terminal-agent');
  const objective = cleanString(payload.objective, 'Harness terminal agent');
  const subagentMode = cleanString(payload.subagentMode, 'wf-subagents');
  const workflowMode = cleanString(payload.workflowMode, '');
  const model = cleanString(payload.model, '');
  const provider = cleanString(payload.provider, '');
  const ceoPrompt = cleanString(payload.ceoPrompt, '');
  const runtimeInfo = detectRuntimesCached({ includeMissing: true }).find((candidate) => candidate.id === runtime);
  if (!runtimeInfo) throw new Error(`Unknown runtime: ${runtime}`);
  if (!runtimeInfo.path) throw new Error(`${runtimeInfo.label || runtime} is not detected on PATH`);
  rememberTaskRuntime(absRoot, taskId, runtime);

  const session = sr.create({
    runtime,
    taskId,
    role,
    objective,
    projectRoot: absRoot,
    subagentMode,
    workflowMode: workflowMode || null,
    model,
    provider,
    ceoPrompt,
  });
  persistSession(absRoot, session);
  appendSessionEvent(absRoot, session, {
    type: 'session.created',
    runtime,
    role: session.role,
    taskId,
    workflowMode: workflowMode || null,
    subagentMode,
  });

  if (!runtimeInfo.launchable) {
    sr.update(session.sessionId, {
      status: 'blocked',
      blockedReason: runtimeInfo.blockedReason || 'runtime-not-launchable',
    });
    const updated = sr.get(session.sessionId);
    persistSession(absRoot, updated);
    appendSessionEvent(absRoot, updated, { type: 'session.blocked', reason: updated.blockedReason });
    return updated;
  }

  const spawned = await spawnPty({
    runtime,
    taskId,
    peerId: session.peerId,
    sessionId: session.sessionId,
    command: runtimeInfo.path || runtimeInfo.command,
    model,
    projectRoot: absRoot,
    cols: session.cols,
    rows: session.rows,
    onData: (data) => {
      const current = sr.get(session.sessionId);
      if (!current) return;
      appendTerminalData(absRoot, current, data, 'stdout');
      terminalHub?.broadcastToSession?.(session.sessionId, {
        type: 'pty:data',
        sessionId: session.sessionId,
        data,
      });
    },
    onExit: ({ exitCode, signal }) => {
      const handleExit = () => {
        if (!sr.get(session.sessionId)) {
          unregisterPtyProcess(session.sessionId);
          return;
        }
        sr.update(session.sessionId, { status: 'exited', exitCode });
        const current = sr.get(session.sessionId);
        persistSession(absRoot, current, { signal });
        appendSessionEvent(absRoot, current, { type: 'session.exited', exitCode, signal });
        terminalHub?.broadcastToSession?.(session.sessionId, {
          type: 'session:state',
          sessionId: session.sessionId,
          state: 'exited',
        });
        unregisterPtyProcess(session.sessionId);
      };
      if (typeof sr.withLock === 'function') {
        sr.withLock(session.sessionId, handleExit).catch(() => unregisterPtyProcess(session.sessionId));
      } else {
        handleExit();
      }
    },
  });

  if (spawned.blocked) {
    sr.update(session.sessionId, { status: 'blocked', blockedReason: spawned.reason, blockedHint: spawned.hint });
    const updated = sr.get(session.sessionId);
    persistSession(absRoot, updated, { hint: spawned.hint, details: spawned.details || [] });
    appendSessionEvent(absRoot, updated, {
      type: 'session.blocked',
      reason: spawned.reason,
      hint: spawned.hint,
      details: spawned.details || [],
    });
    return updated;
  }

  sr.update(session.sessionId, { status: 'running', pid: spawned.pid, ptyProvider: spawned.ptyProvider || null });
  const updated = sr.get(session.sessionId);
  persistSession(absRoot, updated);
  appendSessionEvent(absRoot, updated, { type: 'session.running', pid: spawned.pid, ptyProvider: spawned.ptyProvider || null });
  registerPtyProcess(session.sessionId, spawned.ptyProcess);
  if (payload.initialInput) {
    const input = String(payload.initialInput);
    writePtyInput(session.sessionId, input);
    appendTerminalData(absRoot, updated, input, 'stdin');
    appendSessionEvent(absRoot, updated, { type: 'terminal.input.injected', bytes: input.length });
  }
  return updated;
}

export function startServer(opts = {}) {
  const projectRoot = canonicalizeProjectPath(opts.projectRoot || process.cwd());
  const host = opts.host || '127.0.0.1';
  const port = opts.port !== undefined ? opts.port : 0;
  const token = opts.token || generateToken();

  const server = createServer({
    projectRoot,
    sessionRegistry: opts.sessionRegistry,
    token,
    terminalHub: opts.terminalHub || null,
  });

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = addr.port;
      resolve({
        server,
        port: actualPort,
        token,
        url: `http://${host}:${actualPort}/?token=${encodeURIComponent(token)}`,
      });
    });
    server.on('error', reject);
  });
}

export function stopServer(server) {
  return new Promise((resolve, reject) => {
    if (!server || !server.listening) return resolve();
    server.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/** Expose debug state for external readers (WS modules, etc.) */
export function getDebugState() { return debugState; }
