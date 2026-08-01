import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalizeProjectPath, validateTaskId } from './security.mjs';
import { parseTaskList, parseTaskCapsule, parseArchivedTasks, readTaskFile } from './task-parser.mjs';
import { loadSettings } from './settings.mjs';
import { generateToken, validateToken } from './token.mjs';
import { validateGraphReadToken } from './control-plane-token.mjs';
import { detectRuntimesCached, getRuntimeDefinition, resolveRuntimeResumeArgs } from './runtime-detector.mjs';
import { spawnPty } from './pty-adapter.mjs';
import { killPtyProcess, registerPtyProcess, unregisterPtyProcess, writePtyInput } from './ws-terminal.mjs';
import {
  applyWorkspaceOperation,
  buildTerminalContextInput,
  getWorkspaceFileInfo,
  getWorkspaceMeta,
  listWorkspaceTree,
  readWorkspaceTextPreview,
  storeUserFiles,
  undoWorkspaceOperation,
  WorkspaceStoreError,
} from './workspace-store.mjs';
import {
  ensureA2aDefaults,
  loadA2aSkills,
  buildWorkflowSnapshot,
  loadWorkflowGraphMap,
  loadBuiltInWorkflows,
  loadRoleGraph,
  removeWorkflowGraphNode,
  updateWorkflowGraphSessionNode,
  writeWorkflowGraphMap,
} from './a2a-store.mjs';
import { readRuntimeConfig, writeRuntimeConfig } from './runtime-config.mjs';
import { codexUpdatePromptInputForChoice } from './codex-update-prompt.mjs';
import { buildCleanupSummary, pruneCleanupTargets } from './session-cleanup.mjs';
import {
  appendSessionEvent,
  appendTerminalData,
  globTerminalEvents,
  listTerminalSessions,
  persistSession,
  readTerminalRange,
  recordInputRequest,
  writeDroppedTerminalFiles,
} from './terminal-store.mjs';
import { listBridgeMessages, recordBridgeMessage } from './bridge-store.mjs';
import {
  mergeNodeConfig,
  nodeConfigResponse,
  NODE_CONFIG_FIELDS,
  normalizeNodeConfig,
  NodeConfigError,
  sessionPatchForNodeConfig,
} from './node-config-store.mjs';
import {
  createComponentNode,
  deleteComponentNode,
  getComponentNode,
  updateComponentNode,
} from './component-node-store.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SERVER_VERSION = '0.8.20';
const PROCESS_MEMORY_CACHE_TTL_MS = 2000;
const INITIAL_INPUT_READY_DELAY_MS = 1500;
const INITIAL_INPUT_FALLBACK_DELAY_MS = 6000;
const INITIAL_INPUT_ENTER_DELAY_MS = 800;
const MAX_JSON_BODY_BYTES = 32 * 1024 * 1024;
const processMemoryCache = new Map();
const processCpuCache = new Map();

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

function workspaceFileHeaders(info, length = info.size, extra = {}) {
  return {
    'Content-Type': info.mime,
    'Content-Length': length,
    'Content-Disposition': `inline; filename="${info.name.replace(/"/g, '')}"`,
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Harness-Session-Id, If-Match',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    ETag: info.etag,
    'Last-Modified': info.lastModified,
    ...extra,
  };
}

function parseRangeHeader(rangeHeader, size) {
  const match = String(rangeHeader || '').match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  let start;
  let end;
  if (match[1] === '' && match[2] === '') return null;
  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

function serveWorkspaceFile(req, res, projectRoot, rawPath) {
  const info = getWorkspaceFileInfo(projectRoot, rawPath || '');
  const rangeHeader = req.headers.range;
  if (rangeHeader && req.method === 'GET') {
    const range = parseRangeHeader(rangeHeader, info.size);
    if (!range) {
      res.writeHead(416, workspaceFileHeaders(info, 0, {
        'Content-Range': `bytes */${info.size}`,
      }));
      res.end();
      return true;
    }
    const length = range.end - range.start + 1;
    res.writeHead(206, workspaceFileHeaders(info, length, {
      'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
    }));
    fs.createReadStream(info.absolutePath, { start: range.start, end: range.end }).pipe(res);
    return true;
  }

  res.writeHead(200, workspaceFileHeaders(info));
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(info.absolutePath).pipe(res);
  return true;
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Harness-Session-Id, If-Match',
  });
  res.end(body);
}

function sendError(res, statusCode, code, message, details) {
  const err = { error: { code, message } };
  if (details !== undefined) err.error.details = details;
  sendJson(res, statusCode, err);
}

function sendMappedError(res, err) {
  const statusCode = Number(err?.statusCode || 400);
  const code = err?.code || (statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : 'BAD_REQUEST');
  return sendError(res, statusCode, code, err?.message || 'Request failed');
}

function tokenFromRequest(req, url) {
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function controlPlanePayload(url, token) {
  return {
    controlPlaneUrl: `${url.protocol}//${url.host}`,
    controlPlaneToken: token || '',
  };
}

function readJsonBody(req, { maxBytes = MAX_JSON_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        tooLarge = true;
        body = '';
        return;
      }
      if (!tooLarge) body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(new WorkspaceStoreError('JSON body too large; payload limit exceeded', {
          statusCode: 413,
          code: 'PAYLOAD_TOO_LARGE',
        }));
        return;
      }
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergePlainObjects(base, patch) {
  const result = { ...(isPlainObject(base) ? base : {}) };
  if (!isPlainObject(patch)) return result;
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? mergePlainObjects(result[key], value)
      : value;
  }
  return result;
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

function normalizeSessionStatus(status) {
  return status === 'saved' ? 'stopped' : status;
}

function normalizeSessionForApi(session) {
  if (!session) return session;
  return {
    ...session,
    status: normalizeSessionStatus(session.status),
  };
}

function downgradeOrphanedDiskSessions(memorySessions, diskSessions) {
  const currentSessionIds = new Set(memorySessions.map(session => session.sessionId));
  return diskSessions.map(session => (
    !currentSessionIds.has(session.sessionId) && isLiveSession(session)
      ? { ...session, status: 'stopped', blockedReason: session.blockedReason || 'not-managed-by-current-wf-ui', wsClientCount: 0 }
      : normalizeSessionForApi(session)
  ));
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map(value => value.trim());
}

function parseMemoryToBytes(value) {
  const text = String(value || '').replace(/\u00a0/g, ' ').trim();
  const numeric = Number(text.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (/gb/i.test(text)) return Math.round(numeric * 1024 * 1024 * 1024);
  if (/mb/i.test(text)) return Math.round(numeric * 1024 * 1024);
  if (/kb|k/i.test(text)) return Math.round(numeric * 1024);
  return Math.round(numeric);
}

function readProcessMemoryBytes(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return null;
  const cached = processMemoryCache.get(numericPid);
  if (cached && cached.expiresAt > Date.now()) return cached.memoryBytes;

  let memoryBytes = null;
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('tasklist', ['/fi', `PID eq ${numericPid}`, '/fo', 'csv', '/nh'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1200,
      });
      const line = String(result.stdout || '').split(/\r?\n/).find(row => row.trim() && !/No tasks/i.test(row));
      if (line) {
        const columns = parseCsvLine(line);
        memoryBytes = parseMemoryToBytes(columns[columns.length - 1]);
      }
    } else {
      const result = spawnSync('ps', ['-o', 'rss=', '-p', String(numericPid)], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1200,
      });
      const rssKb = Number(String(result.stdout || '').trim().split(/\s+/)[0]);
      if (Number.isFinite(rssKb) && rssKb > 0) memoryBytes = Math.round(rssKb * 1024);
    }
  } catch {
    memoryBytes = null;
  }

  processMemoryCache.set(numericPid, {
    memoryBytes,
    expiresAt: Date.now() + PROCESS_MEMORY_CACHE_TTL_MS,
  });
  return memoryBytes;
}

function readProcessCpuSeconds(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return null;
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `$p=Get-Process -Id ${numericPid} -ErrorAction SilentlyContinue; if($p){ [Console]::Write($p.CPU) }`,
      ], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1200,
      });
      const value = Number(String(result.stdout || '').trim());
      return Number.isFinite(value) ? value : null;
    }
    const result = spawnSync('ps', ['-o', 'time=', '-p', String(numericPid)], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 1200,
    });
    const text = String(result.stdout || '').trim();
    const parts = text.split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part))) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  } catch {
    return null;
  }
  return null;
}

function readProcessCpuPercent(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return null;
  const now = Date.now();
  const cpuSeconds = readProcessCpuSeconds(numericPid);
  if (cpuSeconds === null) return null;
  const previous = processCpuCache.get(numericPid);
  processCpuCache.set(numericPid, { cpuSeconds, sampledAt: now });
  if (!previous) return null;
  const elapsedSeconds = Math.max((now - previous.sampledAt) / 1000, 0.001);
  const deltaCpu = cpuSeconds - previous.cpuSeconds;
  if (!Number.isFinite(deltaCpu) || deltaCpu < 0) return null;
  const cpuCount = Math.max(1, os.cpus().length || 1);
  return Math.max(0, Math.round((deltaCpu / elapsedSeconds / cpuCount) * 1000) / 10);
}

function sessionResourceUsage(session) {
  const memoryBytes = readProcessMemoryBytes(session?.pid);
  const cpuPercent = readProcessCpuPercent(session?.pid);
  return {
    pid: Number.isInteger(Number(session?.pid)) && Number(session.pid) > 0 ? Number(session.pid) : null,
    ptyProvider: session?.ptyProvider || null,
    wsClientCount: Number(session?.wsClientCount || 0),
    memoryBytes,
    memoryMB: memoryBytes === null ? null : Math.round((memoryBytes / 1024 / 1024) * 10) / 10,
    cpuPercent,
  };
}

function liveSessionIds(sr) {
  if (!sr || typeof sr.getAll !== 'function') return new Set();
  return new Set(sr.getAll().filter(isLiveSession).map(session => session.sessionId));
}

function cleanupOptions(sr) {
  return {
    liveSessionIds: liveSessionIds(sr),
    currentReadyFile: process.env.HARNESS_WF_UI_READY_FILE,
  };
}

function cleanupPolicy(absRoot, override = {}) {
  return {
    ...(loadSettings(absRoot).cleanup || {}),
    ...(override || {}),
  };
}

function withResumeMetadata(session) {
  const runtimeInfo = getRuntimeDefinition(session.runtime);
  const resumeArgs = resolveRuntimeResumeArgs(session.runtime, { agentSessionId: session.agentSessionId });
  const command = runtimeInfo?.commands?.[0] || session.runtime;
  const resourceUsage = isLiveSession(session)
    ? sessionResourceUsage(session)
    : {
      pid: Number.isInteger(Number(session?.pid)) && Number(session.pid) > 0 ? Number(session.pid) : null,
      ptyProvider: session?.ptyProvider || null,
      wsClientCount: Number(session?.wsClientCount || 0),
      memoryBytes: null,
      memoryMB: null,
      cpuPercent: null,
    };
  return {
    ...session,
    resourceUsage,
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
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Harness-Session-Id, If-Match',
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;

    if (expectedToken && pathname.startsWith('/api/')) {
      const presented = tokenFromRequest(req, url);
      if (!presented) return sendError(res, 401, 'UNAUTHORIZED', 'Missing token');
      const fullToken = validateToken(presented, expectedToken);
      const readSessionId = url.searchParams.get('actorSessionId') || req.headers['x-harness-session-id'];
      const graphRead = req.method === 'GET'
        && (pathname === '/api/a2a/snapshot' || pathname === '/api/workflow')
        && validateGraphReadToken(presented, expectedToken, readSessionId);
      if (!fullToken && !graphRead) return sendError(res, 403, 'FORBIDDEN', 'Invalid token');
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
    if (req.method === 'GET' && pathname === '/api/workspace/tree') {
      try {
        return sendJson(res, 200, listWorkspaceTree(absRoot, {
          path: url.searchParams.get('path') || '',
        }));
      } catch (e) {
        return sendMappedError(res, e);
      }
    }

    if (req.method === 'GET' && pathname === '/api/workspace/meta') {
      try {
        return sendJson(res, 200, getWorkspaceMeta(absRoot, url.searchParams.get('path') || ''));
      } catch (e) {
        return sendMappedError(res, e);
      }
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/workspace/file') {
      try {
        return serveWorkspaceFile(req, res, absRoot, url.searchParams.get('path') || '');
      } catch (e) {
        return sendMappedError(res, e);
      }
    }

    if (req.method === 'GET' && pathname === '/api/workspace/text') {
      try {
        return sendJson(res, 200, readWorkspaceTextPreview(absRoot, {
          path: url.searchParams.get('path') || '',
          offset: url.searchParams.get('offset'),
          limit: url.searchParams.get('limit'),
        }));
      } catch (e) {
        return sendMappedError(res, e);
      }
    }

    if (req.method === 'POST' && pathname === '/api/workspace/ops') {
      readJsonBody(req).then((payload) => {
        try {
          return sendJson(res, 200, applyWorkspaceOperation(absRoot, payload));
        } catch (e) {
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/workspace/undo') {
      readJsonBody(req).then((payload) => {
        try {
          return sendJson(res, 200, undoWorkspaceOperation(absRoot, payload));
        } catch (e) {
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/user-files') {
      readJsonBody(req).then((payload) => {
        try {
          return sendJson(res, 200, storeUserFiles(absRoot, payload));
        } catch (e) {
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

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

    if (req.method === 'GET' && (pathname === '/api/workflow' || pathname === '/api/a2a/snapshot')) {
      return sendJson(res, 200, buildWorkflowSnapshot(absRoot, sr));
    }

    if (req.method === 'GET' && pathname === '/api/a2a/graph-map') {
      return sendJson(res, 200, loadWorkflowGraphMap(absRoot));
    }

    if (req.method === 'GET' && pathname === '/api/a2a/bridge-messages') {
      try {
        return sendJson(res, 200, listBridgeMessages(absRoot, {
          fromSessionId: url.searchParams.get('fromSessionId') || '',
          toSessionId: url.searchParams.get('toSessionId') || '',
          limit: Number(url.searchParams.get('limit') || 200),
        }));
      } catch (e) {
        return sendError(res, 400, 'BAD_REQUEST', e.message);
      }
    }

    if (req.method === 'POST' && pathname === '/api/a2a/component-nodes') {
      readJsonBody(req).then((payload) => {
        try {
          return sendJson(res, 201, createComponentNode(absRoot, payload));
        } catch (e) {
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    const componentNodeMatch = pathname.match(/^\/api\/a2a\/component-nodes\/([^/]+)$/);
    if (componentNodeMatch && req.method === 'GET') {
      try {
        const nodeId = decodeURIComponent(componentNodeMatch[1]);
        return sendJson(res, 200, getComponentNode(absRoot, nodeId));
      } catch (e) {
        return sendMappedError(res, e);
      }
    }

    if (componentNodeMatch && req.method === 'PUT') {
      readJsonBody(req).then((payload) => {
        try {
          const nodeId = decodeURIComponent(componentNodeMatch[1]);
          return sendJson(res, 200, updateComponentNode(absRoot, nodeId, payload));
        } catch (e) {
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    if (componentNodeMatch && req.method === 'DELETE') {
      try {
        const nodeId = decodeURIComponent(componentNodeMatch[1]);
        const result = deleteComponentNode(absRoot, nodeId);
        removeWorkflowGraphNode(absRoot, nodeId);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendMappedError(res, e);
      }
    }

    const graphNodeConfigMatch = pathname.match(/^\/api\/a2a\/(?:nodes|graph-nodes)\/([^/]+)\/config$/);
    if (req.method === 'PATCH' && graphNodeConfigMatch) {
      if (!sr || typeof sr.get !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      readJsonBody(req).then((payload) => {
        try {
          const key = decodeURIComponent(graphNodeConfigMatch[1]);
          const result = patchWorkflowNodeConfig(sr, absRoot, key, payload);
          return sendJson(res, 200, result);
        } catch (e) {
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    const graphNodeRestartMatch = pathname.match(/^\/api\/a2a\/(?:nodes|graph-nodes)\/([^/]+)\/restart$/);
    if (req.method === 'POST' && graphNodeRestartMatch) {
      if (!sr || typeof sr.create !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      readJsonBody(req).then((payload) => {
        const key = decodeURIComponent(graphNodeRestartMatch[1]);
        const runRestart = () => restartWorkflowGraphNode(sr, absRoot, key, {
          ...payload,
          ...controlPlanePayload(url, expectedToken),
        }, terminalHub);
        const lockKey = `graph-restart:${key}`;
        const operation = typeof sr.withLock === 'function'
          ? sr.withLock(lockKey, runRestart)
          : Promise.resolve().then(runRestart);
        operation
          .then(result => sendJson(res, 200, result))
          .catch(e => sendMappedError(res, e));
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    const graphNodeStartMatch = pathname.match(/^\/api\/a2a\/(?:nodes|graph-nodes)\/([^/]+)\/start$/);
    if (req.method === 'POST' && graphNodeStartMatch) {
      if (!sr || typeof sr.create !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      readJsonBody(req).then((payload) => {
        const key = decodeURIComponent(graphNodeStartMatch[1]);
        const runStart = () => startWorkflowGraphNode(sr, absRoot, key, {
          ...payload,
          ...controlPlanePayload(url, expectedToken),
        }, terminalHub);
        const lockKey = `graph-start:${key}`;
        const operation = typeof sr.withLock === 'function'
          ? sr.withLock(lockKey, runStart)
          : Promise.resolve().then(runStart);
        operation
          .then(result => sendJson(res, 200, result))
          .catch(e => sendMappedError(res, e));
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    const graphNodeDeleteMatch = pathname.match(/^\/api\/a2a\/(?:nodes|graph-nodes)\/([^/]+)$/);
    if (req.method === 'DELETE' && graphNodeDeleteMatch) {
      try {
        const key = decodeURIComponent(graphNodeDeleteMatch[1]);
        const snapshot = buildWorkflowSnapshot(absRoot, sr);
        const node = (snapshot.nodes || []).find(item =>
          item.id === key || item.graphNodeId === key || item.sessionId === key
        );
        if (node?.control && node.control.canDelete === false) {
          return sendError(res, 409, 'NODE_LIVE', 'Stop the live node before deleting it from the workflow graph');
        }
        const registrySession = node?.sessionId && sr && typeof sr.get === 'function' ? sr.get(node.sessionId) : null;
        if (registrySession && isLiveSession(registrySession)) {
          return sendError(res, 409, 'NODE_LIVE', 'Stop the live node before deleting it from the workflow graph');
        }
        const result = removeWorkflowGraphNode(absRoot, node?.graphNodeId || node?.id || key);
        if (registrySession && typeof sr.remove === 'function') {
          sr.remove(node.sessionId);
        }
        if (node?.sessionId) {
          const diskSession = listTerminalSessions(absRoot).find(session => session.sessionId === node.sessionId);
          if (diskSession) {
            persistSession(absRoot, diskSession, {
              graphDeletedAt: result.removed.deletedAt,
              graphDeletedNodeId: result.removed.nodeId,
            });
          }
        }
        return sendJson(res, 200, {
          ...result,
          snapshot: buildWorkflowSnapshot(absRoot, sr),
        });
      } catch (e) {
        return sendError(res, 400, 'BAD_REQUEST', e.message);
      }
    }

    if (req.method === 'PUT' && pathname === '/api/a2a/graph-map') {
      readJsonBody(req).then((payload) => {
        try {
          sendJson(res, 200, writeWorkflowGraphMap(absRoot, payload, {
            expectedVersion: req.headers['if-match'],
          }));
        } catch (e) {
          sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
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
          const session = await createWorkflowSession(sr, absRoot, {
            ...payload,
            ...controlPlanePayload(url, expectedToken),
          }, terminalHub);
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

    if (req.method === 'GET' && pathname === '/api/cleanup/summary') {
      return sendJson(res, 200, buildCleanupSummary(absRoot, cleanupPolicy(absRoot), cleanupOptions(sr)));
    }

    if (req.method === 'POST' && pathname === '/api/cleanup/prune') {
      readJsonBody(req).then((payload) => {
        const result = pruneCleanupTargets(absRoot, cleanupPolicy(absRoot, payload.policy), {
          ...cleanupOptions(sr),
          apply: payload.apply === true,
        });
        return sendJson(res, 200, result);
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
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
      const diskSessions = downgradeOrphanedDiskSessions(memorySessions, listTerminalSessions(absRoot));
      const includeAll = url.searchParams.get('all') === '1';
      const sessions = includeAll
        ? mergeSessions(memorySessions, diskSessions).map(normalizeSessionForApi).map(withResumeMetadata)
        : memorySessions.filter(isLiveSession).map(normalizeSessionForApi).map(withResumeMetadata);
      return sendJson(res, 200, sessions);
    }

    // ── POST /api/sessions — create a new session ──
    if (req.method === 'POST' && pathname === '/api/sessions') {
      if (!sr || typeof sr.create !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      readJsonBody(req).then(async (payload) => {
        try {
          const session = await createRuntimeSession(sr, absRoot, {
            ...payload,
            ...controlPlanePayload(url, expectedToken),
          }, terminalHub);
          sendJson(res, 201, session);
        } catch (e) {
          sendError(res, 400, 'BAD_REQUEST', e.message);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/terminal/start') {
      if (!sr || typeof sr.create !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      readJsonBody(req).then(async (payload) => {
        try {
          const session = await createRuntimeSession(sr, absRoot, {
            ...payload,
            ...controlPlanePayload(url, expectedToken),
          }, terminalHub);
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
          const session = await createRuntimeSession(sr, absRoot, {
            ...payload,
            taskId: routeTaskId,
            ...controlPlanePayload(url, expectedToken),
          }, terminalHub);
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

    const contextInputMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/context-input$/);
    if (req.method === 'POST' && contextInputMatch) {
      if (!sr || typeof sr.get !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      const session = sr.get(contextInputMatch[1]);
      if (!session) return sendError(res, 404, 'NOT_FOUND', 'Session not found');
      readJsonBody(req).then((payload) => {
        try {
          const { terminalInput } = buildTerminalContextInput(absRoot, payload);
          const inputOwnerId = cleanInputOwnerId(payload.inputOwnerId);
          const durableSession = {
            ...session,
            inputOwnerId,
            ptySessionId: session.sessionId,
          };
          persistSession(absRoot, durableSession);
          appendTerminalData(absRoot, durableSession, terminalInput, 'stdin');
          appendSessionEvent(absRoot, durableSession, {
            type: 'terminal.context-input',
            inputOwnerId,
            ptySessionId: session.sessionId,
          });
          if (!writePtyInput(session.sessionId, terminalInput)) {
            return sendError(res, 409, 'NO_PTY', 'No PTY process attached to this session');
          }
          sr.update(session.sessionId, {
            inputOwnerId,
            ptySessionId: session.sessionId,
          });
          return sendJson(res, 200, {
            ok: true,
            sessionId: session.sessionId,
            ptySessionId: session.sessionId,
            inputOwnerId,
            terminalInput,
          });
        } catch (e) {
          return sendMappedError(res, e);
        }
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
        const data = String(payload.data || payload.text || payload.input || '');
        const actorSessionId = cleanString(
          payload.fromSessionId
            || payload.actorSessionId
            || payload.sourceSessionId
            || req.headers['x-harness-session-id'],
          '',
        );
        if (actorSessionId && !validateTaskId(actorSessionId)) {
          return sendError(res, 400, 'BAD_REQUEST', 'Invalid actor session ID');
        }
        if (!writePtyInput(session.sessionId, data)) return sendError(res, 409, 'NO_PTY', 'No PTY process attached to this session');
        sr.update(session.sessionId, { attachMode: true });
        const updated = sr.get(session.sessionId);
        persistSession(absRoot, updated);
        recordInputRequest(absRoot, session.sessionId, data);
        appendTerminalData(absRoot, updated, data, 'stdin');
        let bridgeMessage = null;
        if (actorSessionId && actorSessionId !== session.sessionId) {
          bridgeMessage = recordBridgeMessage(absRoot, {
            fromSessionId: actorSessionId,
            toSessionId: session.sessionId,
            fromNodeId: cleanString(payload.fromNodeId || payload.sourceNodeId, ''),
            toNodeId: cleanString(payload.toNodeId || session.graphNodeId, ''),
            data,
            source: cleanString(payload.source, 'api.sessions.input'),
          });
          appendSessionEvent(absRoot, updated, {
            type: 'wf.bridge.message',
            bridgeId: bridgeMessage?.bridgeId || null,
            fromSessionId: actorSessionId,
            toSessionId: session.sessionId,
          });
        }
        return sendJson(res, 200, { ok: true, sessionId: session.sessionId, bridgeMessage });
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    const dropFilesMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/drop-files$/);
    if (req.method === 'POST' && dropFilesMatch) {
      readJsonBody(req).then((payload) => {
        const result = writeDroppedTerminalFiles(absRoot, dropFilesMatch[1], payload.files || []);
        return sendJson(res, 200, result);
      }).catch((e) => {
        const status = e?.code === 'NOT_FOUND' ? 404 : 400;
        const code = e?.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST';
        sendError(res, status, code, e.message);
      });
      return;
    }

    const codexUpdateMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/codex-update-prompt$/);
    if (req.method === 'POST' && codexUpdateMatch) {
      if (!sr || typeof sr.get !== 'function') {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Session registry not available');
      }
      const session = sr.get(codexUpdateMatch[1]);
      if (!session) return sendError(res, 404, 'NOT_FOUND', 'Session not found');
      readJsonBody(req).then((payload) => {
        const runRespond = () => respondToCodexUpdatePrompt(sr, absRoot, session.sessionId, payload.choice, terminalHub);
        const operation = typeof sr.withLock === 'function'
          ? sr.withLock(session.sessionId, runRespond)
          : Promise.resolve().then(runRespond);
        operation
          .then(result => sendJson(res, 200, result))
          .catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
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
          const merged = mergePlainObjects(current, newSettings);
          const settingsPath = path.join(absRoot, 'Harness', 'settings.json');
          let existing = {};
          try {
            if (fs.existsSync(settingsPath)) existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          } catch {
            existing = {};
          }
          fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
          const nextSettings = mergePlainObjects(existing, merged);
          fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2));
          sendJson(res, 200, nextSettings);
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

function cleanInputOwnerId(value) {
  const inputOwnerId = cleanString(value, '');
  if (!inputOwnerId) return '';
  if (inputOwnerId.length > 80 || !/^[A-Za-z0-9_.:-]+$/.test(inputOwnerId)) {
    throw new WorkspaceStoreError('Invalid inputOwnerId; use a short terminal view identifier');
  }
  return inputOwnerId;
}

function isNodeTestRunnerProcess() {
  return process.argv.some(arg => /(^|[\\/])__tests__[\\/].+\.test\.mjs$/i.test(String(arg || '')))
    || process.execArgv.includes('--test');
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
    return { ok: true, killed: false, stopped: null, saved: null, alreadyStopped: true };
  }

  const killed = killPtyProcess(sessionId);
  const stopped = sr.stop(sessionId);
  if (!stopped) return { ok: true, killed, stopped: null, saved: null, alreadyStopped: true };
  const updated = withResumeMetadata({
    ...stopped,
    status: 'stopped',
    killed,
    wsClientCount: 0,
    stoppedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  persistSession(absRoot, updated);
  updateWorkflowGraphSessionNode(absRoot, updated.sessionId, {
    status: 'stopped',
    stoppedAt: updated.stoppedAt,
  });
  appendSessionEvent(absRoot, updated, { type: 'session.stopped', killed });
  terminalHub?.broadcastToSession?.(updated.sessionId, {
    type: 'session:state',
    sessionId: updated.sessionId,
    state: updated.status || 'stopped',
  });
  return { ok: true, killed, stopped: updated, saved: updated };
}

function findWorkflowSnapshotNode(snapshot, key) {
  return (snapshot.nodes || []).find(item =>
    item.id === key || item.graphNodeId === key || item.sessionId === key
  ) || null;
}

function persistedSessionById(absRoot, sessionId) {
  if (!sessionId) return null;
  return listTerminalSessions(absRoot).find(session => session.sessionId === sessionId) || null;
}

function sessionForWorkflowNode(sr, absRoot, node) {
  if (!node?.sessionId) return null;
  const registrySession = sr && typeof sr.get === 'function' ? sr.get(node.sessionId) : null;
  const diskSession = persistedSessionById(absRoot, node.sessionId);
  return {
    ...(node || {}),
    ...(diskSession || {}),
    ...(registrySession || {}),
    sessionId: node.sessionId,
    graphNodeId: node.graphNodeId || node.id,
  };
}

function snapshotNodeByKey(absRoot, sr, key) {
  const snapshot = buildWorkflowSnapshot(absRoot, sr);
  const node = findWorkflowSnapshotNode(snapshot, key);
  if (!node?.sessionId) throw new NodeConfigError('Workflow session node not found', {
    statusCode: 404,
    code: 'NOT_FOUND',
  });
  return { snapshot, node };
}

function sessionConfigOverride(payload = {}) {
  const override = {};
  for (const field of NODE_CONFIG_FIELDS) {
    if (payload[field] !== undefined) override[field] = payload[field];
  }
  if (payload.nodeConfig && typeof payload.nodeConfig === 'object' && !Array.isArray(payload.nodeConfig)) {
    return { ...override, ...payload.nodeConfig };
  }
  return override;
}

function nodeForResponse(absRoot, sr, key) {
  const snapshot = buildWorkflowSnapshot(absRoot, sr);
  return findWorkflowSnapshotNode(snapshot, key) || null;
}

function patchWorkflowNodeConfig(sr, absRoot, key, payload = {}) {
  const { node } = snapshotNodeByKey(absRoot, sr, key);
  const source = sessionForWorkflowNode(sr, absRoot, node);
  const result = mergeNodeConfig(source, payload);
  const patch = sessionPatchForNodeConfig(source, result.config, result);
  if (sr && typeof sr.update === 'function' && sr.get(source.sessionId)) {
    sr.update(source.sessionId, patch);
    const updated = sr.get(source.sessionId);
    persistSession(absRoot, updated);
    appendSessionEvent(absRoot, updated, {
      type: 'session.node-config.updated',
      restartRequired: updated.restartRequired,
      restartRequiredFields: updated.restartRequiredFields,
      configRevision: updated.configRevision,
    });
  } else {
    const updated = persistSession(absRoot, { ...source, ...patch });
    appendSessionEvent(absRoot, updated, {
      type: 'session.node-config.updated',
      restartRequired: updated.restartRequired,
      restartRequiredFields: updated.restartRequiredFields,
      configRevision: updated.configRevision,
    });
  }
  const responseNode = nodeForResponse(absRoot, sr, key);
  return nodeConfigResponse(responseNode, result);
}

function activeNodeConfig(source = {}, node = {}, payload = {}) {
  const base = normalizeNodeConfig(source.nodeConfig || node.config, source);
  return normalizeNodeConfig({ ...base, ...sessionConfigOverride(payload) }, source);
}

function replaceWorkflowGraphSessionBinding(absRoot, { graphNodeId, previousSessionId, session, sourceNode }) {
  const current = loadWorkflowGraphMap(absRoot);
  const targetNodeId = cleanString(graphNodeId, session.graphNodeId || `session-${session.sessionId}`);
  let changed = false;
  const nodes = (current.nodes || []).map((node) => {
    const nodeId = node.nodeId || node.id || '';
    const matches = (
      nodeId === targetNodeId
      || node.sessionId === previousSessionId
      || (previousSessionId && nodeId === `session-${previousSessionId}`)
    );
    if (!matches) return node;
    changed = true;
    return {
      ...node,
      nodeId: targetNodeId,
      sessionId: session.sessionId,
      agentKind: session.agentKind,
      runtime: session.runtime,
      taskId: session.taskId || null,
      cwd: session.cwd,
      status: normalizeSessionStatus(session.status),
      label: sourceNode?.label || node.label,
      restartedFromSessionId: previousSessionId || null,
      restartedAt: new Date().toISOString(),
    };
  });
  if (!changed) {
    nodes.push({
      nodeId: targetNodeId,
      sessionId: session.sessionId,
      agentKind: session.agentKind,
      runtime: session.runtime,
      taskId: session.taskId || null,
      cwd: session.cwd,
      status: normalizeSessionStatus(session.status),
      label: sourceNode?.label || `${session.runtime} ${session.agentKind === 'main' ? 'main agent' : 'subagent'}`,
      position: sourceNode?.position || current.positions?.[targetNodeId] || null,
      restartedFromSessionId: previousSessionId || null,
      restartedAt: new Date().toISOString(),
    });
  }
  return writeWorkflowGraphMap(absRoot, {
    ...current,
    version: current.version + 1,
    nodes,
  });
}

function detachPreviousGraphSession(sr, absRoot, previousSessionId, nextSession) {
  if (!previousSessionId || previousSessionId === nextSession.sessionId) return;
  const registrySession = sr && typeof sr.get === 'function' ? sr.get(previousSessionId) : null;
  const diskSession = persistedSessionById(absRoot, previousSessionId);
  const source = registrySession || diskSession;
  if (!source || (registrySession && isLiveSession(registrySession))) return;
  const detachedStatus = isLiveSession(source)
    ? 'stopped'
    : normalizeSessionStatus(source.status) || 'stopped';
  const detached = {
    ...source,
    status: detachedStatus,
    graphNodeId: '',
    graphReplacedBySessionId: nextSession.sessionId,
    graphReplacedAt: new Date().toISOString(),
  };
  persistSession(absRoot, detached);
  appendSessionEvent(absRoot, detached, {
    type: 'session.graph-rebound',
    newSessionId: nextSession.sessionId,
  });
  if (registrySession && typeof sr.remove === 'function') {
    sr.remove(previousSessionId);
  }
}

async function startWorkflowGraphNode(sr, absRoot, key, payload = {}, terminalHub = null) {
  const snapshot = buildWorkflowSnapshot(absRoot, sr);
  const node = findWorkflowSnapshotNode(snapshot, key);
  if (!node?.sessionId) throw new Error('Workflow session node not found');

  const liveSession = sr && typeof sr.get === 'function' ? sr.get(node.sessionId) : null;
  if (liveSession && isLiveSession(liveSession) && payload.forceRestart !== true) {
    const responseNode = nodeForResponse(absRoot, sr, key);
    return {
      ok: true,
      alreadyRunning: true,
      graphNodeId: node.graphNodeId || node.id,
      previousSessionId: node.sessionId,
      started: withResumeMetadata(normalizeSessionForApi(liveSession)),
      sessionId: liveSession.sessionId,
      node: responseNode,
      snapshot,
    };
  }

  const snapshotSession = (snapshot.sessions || []).find(session => session.sessionId === node.sessionId) || null;
  const diskSession = persistedSessionById(absRoot, node.sessionId);
  const source = {
    ...(snapshotSession || {}),
    ...(diskSession || {}),
    ...(liveSession || {}),
  };
  const runtime = cleanString(payload.runtime, source.runtime || node.runtime);
  if (!runtime) throw new Error('Workflow node has no runtime to start');
  const agentKind = cleanString(payload.agentKind, source.agentKind || node.agentKind || 'subagent').toLowerCase();
  const graphNodeId = cleanString(payload.graphNodeId, node.graphNodeId || source.graphNodeId || node.id);
  const config = activeNodeConfig(source, node, payload);

  const started = await createRuntimeSession(sr, absRoot, {
    runtime,
    agentKind,
    role: config.role || cleanString(payload.role, source.role || node.role || (agentKind === 'main' ? 'Main Agent' : 'Subagent')),
    customRole: config.customRole,
    prompt: config.prompt,
    objective: cleanString(payload.objective, config.prompt || source.objective || node.objective || 'Workflow agent'),
    taskId: payload.taskId !== undefined ? payload.taskId : (source.taskId || node.taskId || null),
    cwd: config.cwd || cleanString(payload.cwd, source.cwd || node.cwd || absRoot),
    subagentMode: cleanString(payload.subagentMode, source.subagentMode || 'wf-subagents'),
    workflowMode: cleanString(payload.workflowMode, source.workflowMode || node.workflowMode || ''),
    model: config.model || cleanString(payload.model, source.model || node.model || ''),
    provider: config.provider || cleanString(payload.provider, source.provider || node.provider || ''),
    ceoPrompt: cleanString(payload.ceoPrompt, source.ceoPrompt || ''),
    env: config.env,
    permissions: config.permissions,
    launchPolicy: config.launchPolicy && Object.keys(config.launchPolicy).length > 0 ? config.launchPolicy : {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
    },
    skills: config.skills,
    skillPolicy: config.skillPolicy,
    contextSources: config.contextSources,
    capabilities: config.capabilities,
    nodeConfig: config,
    restartRequired: false,
    restartRequiredFields: [],
    configRevision: Number(source.configRevision || 0),
    deferPtySpawn: payload.deferPtySpawn === true || isNodeTestRunnerProcess(),
    graphContext: payload.graphContext || source.graphContext || null,
    graphNodeId,
    graphVersion: Number(snapshot.graph?.version || source.graphVersion || 0),
    graphContextPath: cleanString(payload.graphContextPath, source.graphContextPath || snapshot.graph?.graphContextPath || ''),
    parentAgentId: cleanString(payload.parentAgentId, source.parentAgentId || node.parentAgentId || '') || null,
    parentNodeId: cleanString(payload.parentNodeId, source.parentNodeId || node.parentNodeId || '') || null,
    controlPlaneUrl: cleanString(payload.controlPlaneUrl, ''),
    controlPlaneToken: cleanString(payload.controlPlaneToken, ''),
  }, terminalHub);

  replaceWorkflowGraphSessionBinding(absRoot, {
    graphNodeId,
    previousSessionId: node.sessionId,
    session: started,
    sourceNode: node,
  });
  detachPreviousGraphSession(sr, absRoot, node.sessionId, started);
  appendSessionEvent(absRoot, started, {
    type: 'session.graph-started',
    previousSessionId: node.sessionId,
    graphNodeId,
  });
  const nextSnapshot = buildWorkflowSnapshot(absRoot, sr);
  const responseNode = findWorkflowSnapshotNode(nextSnapshot, graphNodeId)
    || findWorkflowSnapshotNode(nextSnapshot, started.sessionId);
  return {
    ok: true,
    alreadyRunning: false,
    graphNodeId,
    previousSessionId: node.sessionId,
    started: withResumeMetadata(normalizeSessionForApi(started)),
    sessionId: started.sessionId,
    node: responseNode,
    snapshot: nextSnapshot,
  };
}

async function restartWorkflowGraphNode(sr, absRoot, key, payload = {}, terminalHub = null) {
  const { node } = snapshotNodeByKey(absRoot, sr, key);
  const previousSessionId = node.sessionId;
  const result = await startWorkflowGraphNode(sr, absRoot, key, {
    ...payload,
    forceRestart: true,
  }, terminalHub);
  if (sr && typeof sr.get === 'function' && sr.get(previousSessionId)) {
    stopRuntimeSession(sr, absRoot, previousSessionId, terminalHub);
  }
  const nextSession = result.sessionId && sr && typeof sr.get === 'function'
    ? sr.get(result.sessionId)
    : persistedSessionById(absRoot, result.sessionId);
  if (nextSession) detachPreviousGraphSession(sr, absRoot, previousSessionId, nextSession);
  const snapshot = buildWorkflowSnapshot(absRoot, sr);
  const responseNode = findWorkflowSnapshotNode(snapshot, result.graphNodeId)
    || findWorkflowSnapshotNode(snapshot, result.sessionId);
  return {
    ok: true,
    previousSessionId,
    sessionId: result.sessionId,
    graphNodeId: result.graphNodeId,
    started: result.started,
    node: responseNode,
    snapshot,
  };
}

function createCodexUpdateControlRequest(session) {
  const now = new Date().toISOString();
  return {
    requestId: `${session.sessionId}-${Date.now()}`,
    type: 'codex:update-prompt',
    status: 'pending',
    title: 'Codex update available',
    message: 'Codex is asking how to handle an available update for this terminal session.',
    choices: [
      {
        id: 'skip-session',
        label: 'Skip this session',
        description: 'Continue this terminal run without changing Codex update preferences.',
      },
      {
        id: 'skip-until-next-version',
        label: 'Skip until next version',
        description: 'Tell Codex to suppress this update prompt until a newer version is released.',
      },
    ],
    detectedAt: now,
  };
}

function respondToCodexUpdatePrompt(sr, absRoot, sessionId, choice, terminalHub = null) {
  const session = sr.get(sessionId);
  if (!session) throw new Error('Session not found');
  const request = session.controlRequest;
  if (!request || request.type !== 'codex:update-prompt' || request.status !== 'pending') {
    throw new Error('No pending Codex update prompt for this session');
  }

  const input = codexUpdatePromptInputForChoice(choice);
  if (!input) throw new Error('Invalid Codex update prompt choice');
  if (!writePtyInput(session.sessionId, input)) {
    throw new Error('No PTY process attached to this session. Cannot answer Codex update prompt.');
  }

  const resolved = {
    ...request,
    status: 'resolved',
    choice,
    resolvedAt: new Date().toISOString(),
  };
  sr.update(session.sessionId, { controlRequest: null });
  const updated = sr.get(session.sessionId);
  persistSession(absRoot, updated, { lastControlRequest: resolved });
  appendSessionEvent(absRoot, updated, {
    type: 'codex.update-prompt.responded',
    requestId: request.requestId,
    choice,
  });
  terminalHub?.broadcastToSession?.(updated.sessionId, {
    type: 'codex:update-prompt:resolved',
    sessionId: updated.sessionId,
    requestId: request.requestId,
    choice,
  });
  return { ok: true, sessionId: updated.sessionId, request: resolved };
}

function workflowCommandForRuntime(runtime, command) {
  if (runtime === 'codex' && command.startsWith('/')) return `$${command.slice(1)}`;
  return command;
}

function workflowInitialInput(runtime, workflow, ceoPrompt) {
  const command = workflowCommandForRuntime(runtime, workflow.command || '/wf');
  return `${command}\r${ceoPrompt.trim()}\r`;
}

function workflowModeForCommand(command) {
  const normalized = String(command || '/wf').replace(/^\//, '');
  return normalized || 'wf';
}

function nodeHomeRel(sessionId) {
  return `Harness/a2a/nodes/${sessionId}`;
}

function nodeHomeDir(absRoot, sessionId) {
  return path.join(absRoot, 'Harness', 'a2a', 'nodes', sessionId);
}

function nodeInitMarkdown(session) {
  const agentKind = session.agentKind === 'main' ? 'main' : 'subagent';
  const workflowMode = session.workflowMode ? `/${String(session.workflowMode).replace(/^\//, '')}` : 'none';
  const lines = [
    '# Harness WF Node Init',
    '',
    `- Session: ${session.sessionId}`,
    `- Runtime: ${session.runtime}`,
    `- Agent kind: ${agentKind}`,
    `- Role: ${session.role || 'terminal-agent'}`,
    `- Workflow mode: ${workflowMode}`,
    `- Objective: ${session.objective || 'none'}`,
    `- Prompt: ${session.prompt || session.nodeConfig?.prompt || 'none'}`,
    `- Config revision: ${Number(session.configRevision || 0)}`,
    `- Project root: ${session.projectRoot}`,
    `- Working directory: ${session.cwd}`,
    `- Node home: ${session.nodeHomeRel || nodeHomeRel(session.sessionId)}`,
    `- Env node init: HARNESS_NODE_INIT=${session.nodeInitPath || ''}`,
    `- Env session id: HARNESS_PEER_SESSION_ID=${session.sessionId}`,
    `- Env graph node id: HARNESS_WORKFLOW_NODE_ID=${session.graphNodeId || ''}`,
    `- Workflow map source of truth: backend control plane (${session.graphContextPath || 'Harness/a2a/workflow-map.json'})`,
    `- Node config source of truth: backend session state; hot-edit changes may require restart when restartRequired is true.`,
    '',
    '## Required Startup Behavior',
    '',
    '- Keep terminal startup quiet. Do not print this file unless the operator asks.',
    '- Treat this file plus Harness environment variables as your node identity. Do not wait for an injected bootstrap prompt.',
    '- Read the workflow graph with `node Harness/scripts/wf-ui-control.mjs describe --project .` when you need topology.',
    '- Communicate only with connected managed PTY nodes through wf-bridge routes.',
  ];
  if (agentKind === 'main') {
    lines.push(
      '- Main Agent has global workflow graph awareness and may modify managed wf-ui graph state through the Harness control plane.',
      '- Main Agent may create managed subagents with `node Harness/scripts/wf-ui-control.mjs create-agent --project . --agent-kind subagent --objective "..."`.',
      '- Main Agent may send input to connected sessions with `node Harness/scripts/wf-ui-control.mjs send-input --session <id> --text "..."`.',
      '- Main Agent should answer wf-bridge messages with `node Harness/scripts/wf-ui-control.mjs send-input --session <id> --text "..."` so both sides of the bridge are recorded.',
      '- Main Agent may delete stopped graph nodes with `node Harness/scripts/wf-ui-control.mjs delete-node --node <graphNodeIdOrSessionId>`.',
    );
  } else {
    lines.push(
      '- Subagent must not create nodes, tasks, unmanaged PTYs, or built-in/internal subagents.',
      '- Subagent should do assigned work and return concise evidence.',
    );
  }
  return `${lines.join('\n')}\n`;
}

function writeNodeHome(absRoot, session, graph) {
  const home = nodeHomeDir(absRoot, session.sessionId);
  fs.mkdirSync(home, { recursive: true });
  writeJsonAtomic(path.join(home, 'STATE.json'), {
    sessionId: session.sessionId,
    peerId: session.peerId,
    runtime: session.runtime,
    agentKind: session.agentKind,
    role: session.role,
    objective: session.objective,
    taskId: session.taskId,
    workflowMode: session.workflowMode,
    parentAgentId: session.parentAgentId,
    parentNodeId: session.parentNodeId,
    cwd: session.cwd,
    projectRoot: session.projectRoot,
    nodeHomeRel: session.nodeHomeRel,
    graphContextPath: session.graphContextPath,
    nodeConfig: session.nodeConfig || normalizeNodeConfig(null, session),
    restartRequired: Boolean(session.restartRequired),
    restartRequiredFields: Array.isArray(session.restartRequiredFields) ? session.restartRequiredFields : [],
    configRevision: Number(session.configRevision || 0),
    createdAt: session.startedAt,
    updatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(path.join(home, 'init.md'), nodeInitMarkdown(session), 'utf8');
  writeJsonAtomic(path.join(home, 'graph-snapshot.json'), graph || {});
  return {
    nodeHomePath: home,
    nodeHomeRel: nodeHomeRel(session.sessionId),
    nodeInitPath: path.join(home, 'init.md'),
    nodeInitRel: `${nodeHomeRel(session.sessionId)}/init.md`,
  };
}

function runtimeInitialInput(session, payload) {
  if (payload.initialInput) return String(payload.initialInput);
  return '';
}

function runtimeInitialPrompt(session, payload) {
  if (payload.initialPrompt) return String(payload.initialPrompt);
  return '';
}

function writePtyInputSequence(sessionId, input) {
  const text = String(input || '');
  if (!text) return;
  const chunks = text.split('\r');
  let offset = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (chunk) {
      const delay = offset;
      setTimeout(() => writePtyInput(sessionId, chunk), delay);
      offset += INITIAL_INPUT_ENTER_DELAY_MS;
    }
    if (i < chunks.length - 1) {
      const delay = offset;
      setTimeout(() => writePtyInput(sessionId, '\r'), delay);
      offset += INITIAL_INPUT_ENTER_DELAY_MS;
    }
  }
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
    agentKind: 'main',
    role: 'CEO',
    objective: `${selectedWorkflow.label || 'WF'} CEO terminal`,
    workflowMode: workflowModeForCommand(selectedWorkflow.command || '/wf'),
    workflowId: selectedWorkflow.id,
    workflowCommand: selectedWorkflow.command || '/wf',
    ceoPrompt,
    launchPolicy: payload.launchPolicy || {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
    },
    initialInput: workflowInitialInput(runtime, selectedWorkflow, ceoPrompt),
  }, terminalHub);
}

async function createRuntimeSession(sr, absRoot, payload, terminalHub = null) {
  const taskId = optionalTaskId(payload.taskId);
  const runtime = resolveTaskRuntime(absRoot, taskId, cleanString(payload.runtime));
  if (!runtime) throw new Error('Runtime is required');
  const agentKind = cleanString(payload.agentKind, String(payload.role || '').toLowerCase().includes('ceo') ? 'main' : 'subagent').toLowerCase();
  const role = cleanString(payload.role, 'terminal-agent');
  const objective = cleanString(payload.objective, 'Harness terminal agent');
  const subagentMode = cleanString(payload.subagentMode, 'wf-subagents');
  const workflowMode = cleanString(payload.workflowMode, '');
  const model = cleanString(payload.model, '');
  const provider = cleanString(payload.provider, '');
  const prompt = cleanString(payload.prompt, payload.objective || '');
  const customRole = cleanString(payload.customRole, '');
  const ceoPrompt = cleanString(payload.ceoPrompt, '');
  const cwd = canonicalizeProjectPath(payload.cwd || absRoot);
  const currentGraph = loadWorkflowGraphMap(absRoot);
  const launchPolicy = payload.launchPolicy || {
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
  };
  const runtimeInfo = detectRuntimesCached({ includeMissing: true }).find((candidate) => candidate.id === runtime);
  if (!runtimeInfo) throw new Error(`Unknown runtime: ${runtime}`);
  rememberTaskRuntime(absRoot, taskId, runtime);
  const nodeConfig = normalizeNodeConfig(payload.nodeConfig || {
    role,
    customRole,
    prompt,
    model,
    provider,
    cwd,
    env: payload.env,
    permissions: payload.permissions,
    launchPolicy,
    skills: payload.skills,
    skillPolicy: payload.skillPolicy,
    contextSources: payload.contextSources,
    capabilities: payload.capabilities,
  }, {
    role,
    customRole,
    prompt,
    model,
    provider,
    cwd,
    env: payload.env,
    permissions: payload.permissions,
    launchPolicy,
    skills: payload.skills,
    skillPolicy: payload.skillPolicy,
    contextSources: payload.contextSources,
    capabilities: payload.capabilities,
  });

  let session = sr.create({
    runtime,
    taskId,
    agentKind,
    role,
    objective,
    projectRoot: absRoot,
    cwd,
    subagentMode,
    workflowMode: workflowMode || null,
    model,
    provider,
    prompt,
    customRole,
    env: nodeConfig.env,
    permissions: nodeConfig.permissions,
    skills: nodeConfig.skills,
    skillPolicy: nodeConfig.skillPolicy,
    contextSources: nodeConfig.contextSources,
    capabilities: nodeConfig.capabilities,
    nodeConfig,
    restartRequired: Boolean(payload.restartRequired),
    restartRequiredFields: Array.isArray(payload.restartRequiredFields) ? payload.restartRequiredFields : [],
    configRevision: Number(payload.configRevision || 0),
    ceoPrompt,
    launchPolicy,
    graphContext: payload.graphContext || null,
    graphNodeId: cleanString(payload.graphNodeId, ''),
    graphVersion: Number(payload.graphVersion || 0),
    graphContextPath: cleanString(payload.graphContextPath, currentGraph.graphContextPath || ''),
    parentAgentId: cleanString(payload.parentAgentId, '') || null,
    parentNodeId: cleanString(payload.parentNodeId, '') || null,
  });
  const nodeHome = writeNodeHome(absRoot, {
    ...session,
    nodeHomeRel: nodeHomeRel(session.sessionId),
  }, currentGraph);
  sr.update(session.sessionId, nodeHome);
  session = sr.get(session.sessionId) || { ...session, ...nodeHome };
  persistSession(absRoot, session);
  const initialInput = runtimeInitialInput(session, payload);
  const initialPrompt = runtimeInitialPrompt(session, payload);
  let initialInputScheduled = false;
  const scheduleInitialInput = () => {
    if (!initialInput || initialInputScheduled) return;
    initialInputScheduled = true;
    setTimeout(() => writePtyInputSequence(session.sessionId, initialInput), INITIAL_INPUT_READY_DELAY_MS);
  };
  appendSessionEvent(absRoot, session, {
    type: 'session.created',
    runtime,
    role: session.role,
    taskId,
    workflowMode: workflowMode || null,
    subagentMode,
    bootstrapMode: 'env-node-init',
    nodeInitRel: session.nodeInitRel || null,
  });

  if (payload.deferPtySpawn === true || !runtimeInfo.path || !runtimeInfo.launchable) {
    sr.update(session.sessionId, {
      status: 'blocked',
      blockedReason: payload.deferPtySpawn === true
        ? 'runtime-launch-deferred'
        : (runtimeInfo.path ? (runtimeInfo.blockedReason || 'runtime-not-launchable') : 'runtime-not-detected'),
      blockedHint: payload.deferPtySpawn === true
        ? 'PTY launch was deferred for backend API verification.'
        : (runtimeInfo.path ? undefined : `${runtimeInfo.label || runtime} is not detected on PATH`),
    });
    const updated = sr.get(session.sessionId);
    persistSession(absRoot, updated, { hint: updated.blockedHint || runtimeInfo.hint });
    appendSessionEvent(absRoot, updated, { type: 'session.blocked', reason: updated.blockedReason, hint: updated.blockedHint || runtimeInfo.hint });
    return updated;
  }

  const spawned = await spawnPty({
    runtime,
    taskId,
    peerId: session.peerId,
    sessionId: session.sessionId,
    command: runtimeInfo.path || runtimeInfo.command,
    model,
    initialPrompt,
    launchPolicy: session.launchPolicy,
    controlPlaneUrl: cleanString(payload.controlPlaneUrl, ''),
    controlPlaneToken: cleanString(payload.controlPlaneToken, ''),
    projectRoot: absRoot,
    cwd,
    agentKind: session.agentKind,
    workflowMode: session.workflowMode,
    graphNodeId: session.graphNodeId,
    graphContextPath: session.graphContextPath,
    nodeHomePath: session.nodeHomePath,
    nodeInitPath: session.nodeInitPath,
    cols: session.cols,
    rows: session.rows,
    onData: (data) => {
      scheduleInitialInput();
      const current = sr.get(session.sessionId);
      if (!current) return;
      const entry = appendTerminalData(absRoot, current, data, 'stdout');
      terminalHub?.broadcastToSession?.(session.sessionId, {
        type: 'pty:data',
        sessionId: session.sessionId,
        seq: entry.seq,
        stream: entry.stream,
        data,
      });
    },
    onControlRequest: (requestEvent) => {
      const current = sr.get(session.sessionId);
      if (!current || requestEvent.type !== 'codex:update-prompt') return;
      const request = createCodexUpdateControlRequest(current);
      sr.update(session.sessionId, { controlRequest: request });
      const updated = sr.get(session.sessionId);
      persistSession(absRoot, updated);
      appendSessionEvent(absRoot, updated, {
        type: 'codex.update-prompt.detected',
        requestId: request.requestId,
        reason: requestEvent.reason,
      });
      terminalHub?.broadcastToSession?.(session.sessionId, {
        ...request,
        sessionId: session.sessionId,
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
  if (initialInput) {
    setTimeout(scheduleInitialInput, INITIAL_INPUT_FALLBACK_DELAY_MS);
    appendTerminalData(absRoot, updated, initialInput, 'stdin');
    appendSessionEvent(absRoot, updated, { type: 'terminal.input.injected', bytes: initialInput.length, delayed: true });
  }
  return updated;
}

function runAutomaticCleanup(projectRoot, sr) {
  const policy = cleanupPolicy(projectRoot);
  if (policy.enabled === false) return null;
  return pruneCleanupTargets(projectRoot, policy, {
    ...cleanupOptions(sr),
    apply: true,
    includeStoppedSessions: Boolean(policy.autoPruneStoppedSessions),
    includeTempLogs: true,
  });
}

function startCleanupScheduler(projectRoot, sr) {
  const settings = loadSettings(projectRoot);
  const policy = settings.cleanup || {};
  if (policy.enabled === false) return null;

  const run = () => {
    try {
      runAutomaticCleanup(projectRoot, sr);
    } catch {
      // Cleanup must never make the control panel unavailable.
    }
  };

  if (policy.autoPruneOnStartup !== false) setTimeout(run, 100).unref?.();
  const intervalHours = Number(policy.autoPruneIntervalHours ?? 0);
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) return null;
  const timer = setInterval(run, intervalHours * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
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
  const cleanupTimer = startCleanupScheduler(projectRoot, opts.sessionRegistry);
  if (cleanupTimer) server.once('close', () => clearInterval(cleanupTimer));

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
