import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalizeProjectPath, validateTaskId } from './security.mjs';
import { parseTaskList, parseTaskCapsule, parseArchivedTasks, readTaskFile } from './task-parser.mjs';
import { loadSettings } from './settings.mjs';
import { detectRuntimesCached, getRuntimeDefinition, resolveRuntimeLaunchArgs, resolveRuntimeResumeArgs } from './runtime-detector.mjs';
import { spawnPty } from './pty-adapter.mjs';
import { buildHarnessEnvSession } from './harness-env.mjs';
import { createChatDriver, dispose as disposeChatDriver, sendTo as sendToChatDriver } from './chat-driver.mjs';
import { readChatEnvelopes } from './chat-store.mjs';
import { attachChatWs } from './ws-chat.mjs';
import { bringRevealWindowToFront } from './reveal-foreground.mjs';
import { gracefulStopPty, killPtyProcess, registerPtyProcess, unregisterPtyProcess, writePtyInput } from './ws-terminal.mjs';
import {
  applyWorkspaceOperation,
  buildTerminalContextInput,
  getWorkspaceFileInfo,
  getWorkspaceMeta,
  listWorkspaceTree,
  planRevealWorkspacePath,
  readWorkspaceTextPreview,
  storeUserFiles,
  undoWorkspaceOperation,
  WorkspaceStoreError,
} from './workspace-store.mjs';
import {
  ensureA2aDefaults,
  loadA2aSkills,
  buildWorkflowSnapshot,
  stateFingerprint,
  loadWorkflowGraphMap,
  loadBuiltInWorkflows,
  loadRoleGraph,
  removeWorkflowGraphNode,
  updateWorkflowGraphSessionNode,
  writeWorkflowGraphMap,
  assertSingleGoalPerGroup,
  autoConnectAgent,
  findAgents,
} from './a2a-store.mjs';
import { listGoalNodes } from './workflow-goal-node-store.mjs';
import { findAgentGraphNode, isMainAgentGraphNode } from './workflow-agent-context.mjs';
import { createRoleProfile, nextAvailableRole, profileSessionFields, readRoleProfile } from './workflow-node-types/role-profile-store.mjs';
// agent-node.mjs mirrors the ready-gated submit tracker for its own
// writePromptSubmitInput (agent.sendMessage/agent.sendInput); feed it the same
// spawn/ready/exit/stop signals this module feeds its own tracker below, so
// agent-node submits are ready-gated for server-spawned PTYs too. No import
// cycle: agent-node.mjs does not import server.mjs (verified dependency tree).
import { clearTerminalState as clearAgentNodeTerminalState, markTerminalReady as markAgentNodeTerminalReady, trackTerminalSpawn as trackAgentNodeTerminalSpawn } from './workflow-node-types/agent-node.mjs';
import { readRuntimeConfig, writeRuntimeConfig } from './runtime-config.mjs';
import { materializeClaudeTranscript, encodeClaudeProjectDir } from './claude-transcript-materializer.mjs';
import { createSpawnGate } from './spawn-gate.mjs';
import { autoPlaceNode, layeredTreePositions, tidyPositions, agentTreePositions, findClearPosition, nodeVisualSize } from './graph-layout.mjs';
import { renderHtml as renderDisplayHtml } from './workflow-node-types/display-node.mjs';
import { codexUpdatePromptInputForChoice } from './codex-update-prompt.mjs';
import { buildCleanupSummary, pruneCleanupTargets } from './session-cleanup.mjs';
import {
  appendSessionEvent,
  appendTerminalData,
  buildSessionIndex,
  downgradeOrphanedDiskSessions as persistOrphanDowngradeAtStartup,
  flushTerminalBuffer,
  globTerminalEvents,
  listTerminalSessions,
  persistSession,
  readTerminalRange,
  recordInputRequest,
  writeDroppedTerminalFiles,
} from './terminal-store.mjs';
import { listBridgeMessages, recordBridgeMessage } from './bridge-store.mjs';
import { stopTimerScheduler } from './timer-wakeup-scheduler.mjs';
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
import {
  listNodes,
  getNode,
  createNode as createWorkflowNode,
  updateNodeState,
  updateNodeSettings,
  executeNodeAction,
  deleteNode as deleteWorkflowNode,
  getNodeContext,
} from './workflow-node-runtime.mjs';
import { workflowOntology } from './workflow-ontology.mjs';
import {
  connectNodes,
  disconnectNodes,
  getGraphSnapshot,
  recordGraphOp,
  redoGraphOp,
  resolveWorkflowNodeId,
  undoGraphOp,
  updateEdge,
} from './workflow-graph-store.mjs';
import { appendWorkflowOperation } from './workflow-operation-store.mjs';
import { listSkillsHub } from './workflow-skills-hub.mjs';
import { listMcpHub } from './workflow-mcp-hub.mjs';
import { attachEventsWs } from './ws-events.mjs';
import { refreshBaseline, watchFileNodes } from './file-watcher.mjs';
import {
  cleanupWfBrowserRuns,
  createWfBrowserRun,
  createWfBrowserWindow,
  getWfBrowserLease,
  getWfBrowserRun,
  getWfBrowserWindow,
  leaseWfBrowserWindow,
  listWfBrowserArtifacts,
  listWfBrowserRuns,
  listWfBrowserWindows,
  recordWfBrowserAction,
  releaseWfBrowserLease,
  storeWfBrowserArtifact,
  validateWfBrowserCommandLease,
  wfBrowserBackendCapabilities,
  wfBrowserDebugUrlParams,
} from './wf-browser-store.mjs';

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
const EVENTS_WS_HANDLE = Symbol.for('wf-ui.eventsWsHandle');
const FILE_WATCHER_HANDLE = Symbol.for('wf-ui.fileNodeWatcher');
const CHAT_WS_HANDLE = Symbol.for('wf-ui.chatWsHandle');

function workflowOperationActor(projectRoot, type = 'human') {
  try {
    const graph = getGraphSnapshot(projectRoot);
    const main = (graph.nodes || []).find(node => (
      node.agentKind === 'main'
      || String(node.role || '').toLowerCase() === 'main'
      || String(node.role || '').toLowerCase().includes('ceo')
    )) || (graph.nodes || []).find(node => node.sessionId);
    return {
      type,
      ...(main?.nodeId || main?.id ? { nodeId: main.nodeId || main.id } : {}),
      ...(main?.sessionId ? { sessionId: main.sessionId } : {}),
      ...(main?.agentKind ? { agentKind: main.agentKind } : {}),
    };
  } catch {
    return { type };
  }
}
const PROCESS_MEMORY_CACHE_TTL_MS = 2000;
const INITIAL_INPUT_READY_DELAY_MS = 1200;
const INITIAL_INPUT_FALLBACK_DELAY_MS = 8000;
const INITIAL_INPUT_ENTER_DELAY_MS = 800;
const PROMPT_SUBMIT_ENTER_DELAY_MS = 800;
// Per-character gap when typing a prompt submit into the TUI composer. The
// xterm.js frontend delivers keystrokes one frame at a time; a single
// bulk-write of the whole body leaves text sitting unsubmitted in the codex
// composer, while per-char writes with ~12ms gaps submit reliably.
const PROMPT_TYPING_CHAR_DELAY_MS = 12;
const PROMPT_SUBMIT_READY_WAIT_MS = 10000;
const PROMPT_SUBMIT_READY_POLL_MS = 250;
const MAX_JSON_BODY_BYTES = 32 * 1024 * 1024;
const processMemoryCache = new Map();
const processCpuCache = new Map();
// PTY spawn gate: boots heavy CLI processes; bounds concurrent spawns so a
// batch of start requests queues instead of stampeding the machine.
const ptySpawnGate = createSpawnGate();

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
  if (fs.existsSync(path.join(pkgDist, 'index.html'))) return pkgDist;
  const devDist = path.resolve(__dirname, '..', 'ui', 'dist');
  if (fs.existsSync(path.join(devDist, 'index.html'))) return devDist;
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Harness-Session-Id, X-Harness-Actor-Type, X-Harness-Actor-Kind, X-Harness-Workflow-Node-Id, X-Harness-Node-Id, If-Match',
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Harness-Session-Id, X-Harness-Actor-Type, X-Harness-Actor-Kind, X-Harness-Workflow-Node-Id, X-Harness-Node-Id, If-Match',
  });
  res.end(body);
}

function sendTextHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(html);
}

function sendError(res, statusCode, code, message, details) {
  const err = { error: { code, message } };
  if (details !== undefined) err.error.details = details;
  sendJson(res, statusCode, err);
}

// Typed detail fields carried on thrown errors (GoalNodeError / ComponentNodeError /
// goal_already_bound) that must reach the HTTP body so the UI (T12 toast, markdown
// conflict retry, goal completion) can consume them. Strictly additive: codes and
// messages are unchanged (agent-team-cooperation-spec §6.2/§7/§8).
const TYPED_ERROR_DETAIL_FIELDS = ['remaining', 'currentRevision', 'expectedRevision', 'holder', 'expiresAt', 'existingGoalNodeId', 'timerNodeId'];

function sendMappedError(res, err) {
  const statusCode = Number(err?.statusCode || 400);
  const code = err?.code || (statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : 'BAD_REQUEST');
  const detail = {};
  for (const field of TYPED_ERROR_DETAIL_FIELDS) {
    const value = err?.[field];
    if (value !== undefined && value !== null) detail[field] = value;
  }
  return sendJson(res, statusCode, { error: { code, message: err?.message || 'Request failed' }, ...detail });
}

function wfBrowserCommandId(payload = {}) {
  const value = String(payload.commandId || payload.command?.commandId || '').trim();
  if (value) return value;
  return `command-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function wfBrowserPrimitive(payload = {}) {
  return String(payload.primitive || payload.command?.primitive || '').trim();
}

function wfBrowserArtifactTypeForPrimitive(primitive) {
  if (primitive === 'observe.uiTree') return 'ui-tree';
  if (primitive === 'observe.logs') return 'logs';
  if (primitive === 'observe.network') return 'network';
  if (primitive === 'observe.ast') return 'ast';
  if (primitive === 'observe.replay') return 'replay';
  if (primitive === 'observe.state' || primitive === 'observe.route' || primitive === 'observe.capabilities') return 'state';
  if (primitive === 'observe.diff') return 'analysis';
  return '';
}

function normalizeWfBrowserRoute(value) {
  const text = String(value || '').trim();
  if (!text || /^https?:\/\//i.test(text) || text.startsWith('//')) return '/';
  return text.startsWith('/') ? text : `/${text}`;
}

function wfBrowserLaunchUrl(requestUrl, _token, windowState, lease = null, options = {}) {
  const origin = `${requestUrl.protocol}//${requestUrl.host}`;
  const launchUrl = new URL(normalizeWfBrowserRoute(options.route || windowState.route || '/'), origin);
  const params = new URLSearchParams(wfBrowserDebugUrlParams({
    runId: windowState.runId,
    windowId: windowState.windowId,
    agentId: options.agentId || lease?.agentId || windowState.agentId || '',
    leaseId: options.leaseId || lease?.leaseId || '',
    debug: options.debug !== false,
  }));
  for (const [key, value] of params.entries()) launchUrl.searchParams.set(key, value);
  return launchUrl.toString();
}

function controlPlanePayload(url, _token) {
  return {
    controlPlaneUrl: `${url.protocol}//${url.host}`,
    controlPlaneToken: '',
  };
}

function workflowActionActorOptions(req, url) {
  const headers = req.headers || {};
  return {
    actorType: cleanString(url.searchParams.get('actorType') || headers['x-harness-actor-type'], ''),
    actorKind: cleanString(url.searchParams.get('actorKind') || headers['x-harness-actor-kind'], ''),
    actorNodeId: cleanString(
      url.searchParams.get('actorNodeId')
        || headers['x-harness-workflow-node-id']
        || headers['x-harness-node-id'],
      '',
    ),
    actorSessionId: cleanString(url.searchParams.get('actorSessionId') || headers['x-harness-session-id'], ''),
  };
}

// Spec §4.5 (AC-025): the cooperation audit is DERIVED from backend-owned
// data only — sessions (created whom + role), bridge messages grouped by
// requestId (asked / replied), and wakeup envelopes (wakeup dispatched).
// No timeout data is stored backend-side, so nothing is fabricated here; the
// UI derives the timed-out marker client-side from real timestamps
// (ask-without-reply beyond a threshold, see TerminalDrawer.tsx).
function deriveCooperationAudit(absRoot) {
  const sessions = listTerminalSessions(absRoot);
  const created = (Array.isArray(sessions) ? sessions : []).map(session => ({
    kind: 'created',
    sessionId: session.sessionId || '',
    nodeId: session.graphNodeId || (session.sessionId ? `session-${session.sessionId}` : ''),
    displayName: String(session.displayName || session.role || ''),
    roleTitle: String(session.roleTitle || session.role || ''),
    runtime: String(session.runtime || ''),
    agentKind: String(session.agentKind || ''),
    ts: String(session.createdAt || ''),
  }));
  const bridgeEntries = listBridgeMessages(absRoot, { limit: 500 }).entries || [];
  const requests = new Map();
  const wakeups = [];
  for (const entry of Array.isArray(bridgeEntries) ? bridgeEntries : []) {
    if (String(entry.deliveryMode || '') === 'wakeup' || String(entry.source || '') === 'timer.wakeup') {
      let goalNodeId = '';
      try {
        const parsed = JSON.parse(String(entry.data || ''));
        goalNodeId = String(parsed?.goalNodeId || '');
      } catch {
        // envelope data is informational; a parse failure omits goalNodeId
      }
      wakeups.push({
        kind: 'wakeup',
        messageId: String(entry.messageId || ''),
        timerNodeId: String(entry.fromNodeId || ''),
        goalNodeId,
        agentNodeId: String(entry.toNodeId || ''),
        ts: String(entry.ts || ''),
      });
      continue;
    }
    if (entry.requestId) {
      const list = requests.get(entry.requestId) || [];
      list.push(entry);
      requests.set(entry.requestId, list);
    }
  }
  const requestEntries = [];
  for (const [requestId, entries] of requests) {
    const ask = entries.find(entry => !entry.replyTo) || entries[0];
    requestEntries.push({
      kind: 'request',
      requestId: String(requestId || ''),
      asked: {
        fromSessionId: String(ask?.fromSessionId || ''),
        toSessionId: String(ask?.toSessionId || ''),
        fromNodeId: String(ask?.fromNodeId || ''),
        toNodeId: String(ask?.toNodeId || ''),
        toRole: String(ask?.toRole || ''),
        ts: String(ask?.ts || ''),
      },
      replied: entries
        .filter(entry => entry.replyTo)
        .map(reply => ({
          fromSessionId: String(reply.fromSessionId || ''),
          fromNodeId: String(reply.fromNodeId || ''),
          replyTo: String(reply.replyTo || ''),
          ts: String(reply.ts || ''),
        })),
    });
  }
  return {
    ok: true,
    derived: true,
    source: 'backend-derived',
    entries: { created, requests: requestEntries, wakeups },
    note: 'Timeout data is not stored backend-side; the UI derives timed-out from ask-without-reply timestamps.',
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

// True when claude/cc has a conversation transcript on disk for the given
// agent session id in the given project cwd. Used as a pre-flight check
// before passing --resume to the runtime: resuming a conversation whose
// transcript was cleaned prints "No conversation found with session ID"
// and exits immediately.
function claudeConversationExists(cwd, agentSessionId) {
  if (!cwd || !agentSessionId) return false;
  try {
    const filePath = path.join(os.homedir(), '.claude', 'projects', encodeClaudeProjectDir(cwd), `${agentSessionId}.jsonl`);
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
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
      ? {
        ...session,
        // Disk-only sessions are not dead: the PTY may still be alive after a
        // backend restart. Keep them attachable (status 'running', watch-only
        // attachMode) instead of marking them 'stopped' so the frontend can
        // reconnect over /ws/terminal.
        status: 'running',
        attachMode: false,
        blockedReason: session.blockedReason || 'not-managed-by-current-wf-ui',
        wsClientCount: 0,
      }
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
  const resumeArgs = resolveRuntimeResumeArgs(session.runtime, {
    agentSessionId: session.agentSessionId,
    codexRolloutId: session.codexRolloutId,
  });
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

export function createServer({ projectRoot, sessionRegistry: sr, token: expectedToken, terminalHub = null, wfBrowserHub = null }) {
  const absRoot = canonicalizeProjectPath(projectRoot);
  const startTime = Date.now();
  ensureA2aDefaults(absRoot);

  // ws-terminal.mjs revives /ws/terminal upgrades for sessions that exist on
  // disk but not in the in-memory registry (backend restarted while the PTY
  // session survived). Expose the same persisted-session lookup the sessions
  // API uses so the upgrade path can reattach to disk-only sessions.
  if (sr && typeof sr === 'object' && typeof sr.reviveSession !== 'function') {
    sr.reviveSession = (sessionId) => persistedSessionById(absRoot, sessionId);
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Harness-Session-Id, X-Harness-Actor-Type, X-Harness-Actor-Kind, X-Harness-Workflow-Node-Id, X-Harness-Node-Id, If-Match',
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;

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

    if (req.method === 'GET' && pathname === '/api/wf-browser/capabilities') {
      return sendJson(res, 200, wfBrowserBackendCapabilities());
    }

    if (req.method === 'POST' && pathname === '/api/wf-browser/cleanup') {
      readJsonBody(req).then((payload) => {
        try {
          return sendJson(res, 200, cleanupWfBrowserRuns(absRoot, payload));
        } catch (e) {
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/wf-browser/runs') {
      try {
        return sendJson(res, 200, listWfBrowserRuns(absRoot, {
          limit: url.searchParams.get('limit') || 20,
        }));
      } catch (e) {
        return sendMappedError(res, e);
      }
    }

    if (req.method === 'POST' && pathname === '/api/wf-browser/runs') {
      readJsonBody(req).then((payload) => {
        try {
          return sendJson(res, 201, createWfBrowserRun(absRoot, payload));
        } catch (e) {
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/wf-browser/connections') {
      try {
        return sendJson(res, 200, {
          ok: true,
          connections: typeof wfBrowserHub?.listConnections === 'function'
            ? wfBrowserHub.listConnections()
            : [],
        });
      } catch (e) {
        return sendMappedError(res, e);
      }
    }

    const wfBrowserCommandsMatch = pathname.match(/^\/api\/wf-browser\/runs\/([^/]+)\/windows\/([^/]+)\/commands$/);
    if (req.method === 'POST' && wfBrowserCommandsMatch) {
      readJsonBody(req).then(async (payload) => {
        const runId = wfBrowserCommandsMatch[1];
        const windowId = wfBrowserCommandsMatch[2];
        const commandId = wfBrowserCommandId(payload);
        const primitive = wfBrowserPrimitive(payload);
        const commandPayload = {
          ...payload,
          commandId,
          primitive,
          runId,
          windowId,
          agentId: payload.agentId || payload.command?.agentId || '',
          leaseId: payload.leaseId || payload.command?.leaseId || '',
        };
        try {
          if (typeof wfBrowserHub?.sendCommand !== 'function') {
            const err = new Error('wf-browser WebSocket bridge is not attached');
            err.statusCode = 409;
            err.code = 'BRIDGE_UNAVAILABLE';
            throw err;
          }
          const leaseCheck = validateWfBrowserCommandLease(absRoot, runId, windowId, commandPayload);
          recordWfBrowserAction(absRoot, runId, windowId, {
            type: 'command.requested',
            commandId,
            primitive,
            agentId: commandPayload.agentId,
            leaseId: commandPayload.leaseId,
            status: 'pending',
            target: payload.target || payload.payload?.target,
          });
          const command = await wfBrowserHub.sendCommand({
            ...commandPayload,
            access: leaseCheck.access,
          });
          let artifact = null;
          const artifactType = payload.storeArtifact === false ? '' : wfBrowserArtifactTypeForPrimitive(primitive);
          if (artifactType && command.status === 'ok') {
            artifact = storeWfBrowserArtifact(absRoot, runId, windowId, {
              type: artifactType,
              name: `${commandId}.json`,
              label: primitive,
              json: {
                primitive,
                commandId,
                result: command.result,
                artifacts: command.artifacts || [],
                events: command.events || [],
              },
            }).artifact;
          }
          recordWfBrowserAction(absRoot, runId, windowId, {
            type: 'command.result',
            commandId,
            primitive,
            agentId: commandPayload.agentId,
            leaseId: commandPayload.leaseId,
            status: command.status || 'ok',
            artifactIds: artifact ? [artifact.artifactId] : [],
            error: command.error || undefined,
          });
          return sendJson(res, 200, { ok: true, command, artifact });
        } catch (e) {
          try {
            recordWfBrowserAction(absRoot, runId, windowId, {
              type: 'command.failed',
              commandId,
              primitive,
              agentId: commandPayload.agentId,
              leaseId: commandPayload.leaseId,
              status: 'failed',
              error: { code: e?.code || 'ERROR', message: e?.message || 'Command failed' },
            });
          } catch { /* best-effort command evidence */ }
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    const wfBrowserArtifactsMatch = pathname.match(/^\/api\/wf-browser\/runs\/([^/]+)\/windows\/([^/]+)\/artifacts$/);
    if (req.method === 'GET' && wfBrowserArtifactsMatch) {
      try {
        return sendJson(res, 200, listWfBrowserArtifacts(absRoot, wfBrowserArtifactsMatch[1], wfBrowserArtifactsMatch[2]));
      } catch (e) {
        return sendMappedError(res, e);
      }
    }
    if (req.method === 'POST' && wfBrowserArtifactsMatch) {
      readJsonBody(req).then((payload) => {
        try {
          return sendJson(res, 201, storeWfBrowserArtifact(absRoot, wfBrowserArtifactsMatch[1], wfBrowserArtifactsMatch[2], payload));
        } catch (e) {
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    const wfBrowserLeaseReleaseMatch = pathname.match(/^\/api\/wf-browser\/runs\/([^/]+)\/windows\/([^/]+)\/lease\/([^/]+)\/release$/);
    if (req.method === 'POST' && wfBrowserLeaseReleaseMatch) {
      readJsonBody(req).then((payload) => {
        try {
          return sendJson(res, 200, releaseWfBrowserLease(
            absRoot,
            wfBrowserLeaseReleaseMatch[1],
            wfBrowserLeaseReleaseMatch[2],
            wfBrowserLeaseReleaseMatch[3],
            payload,
          ));
        } catch (e) {
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    const wfBrowserLeaseMatch = pathname.match(/^\/api\/wf-browser\/runs\/([^/]+)\/windows\/([^/]+)\/lease$/);
    if (req.method === 'POST' && wfBrowserLeaseMatch) {
      readJsonBody(req).then((payload) => {
        try {
          const result = leaseWfBrowserWindow(absRoot, wfBrowserLeaseMatch[1], wfBrowserLeaseMatch[2], payload);
          const windowState = getWfBrowserWindow(absRoot, wfBrowserLeaseMatch[1], wfBrowserLeaseMatch[2]).window;
          return sendJson(res, 201, {
            ...result,
            launchUrl: wfBrowserLaunchUrl(url, expectedToken, windowState, result.lease),
          });
        } catch (e) {
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    const wfBrowserLaunchUrlMatch = pathname.match(/^\/api\/wf-browser\/runs\/([^/]+)\/windows\/([^/]+)\/launch-url$/);
    if (req.method === 'GET' && wfBrowserLaunchUrlMatch) {
      try {
        const windowState = getWfBrowserWindow(absRoot, wfBrowserLaunchUrlMatch[1], wfBrowserLaunchUrlMatch[2]).window;
        const leaseId = url.searchParams.get('leaseId') || url.searchParams.get('lease') || '';
        const lease = leaseId ? getWfBrowserLease(absRoot, wfBrowserLaunchUrlMatch[1], wfBrowserLaunchUrlMatch[2], leaseId).lease : null;
        const debug = url.searchParams.get('debug') !== '0' && url.searchParams.get('debug') !== 'false';
        const debugUrlParams = wfBrowserDebugUrlParams({
          runId: windowState.runId,
          windowId: windowState.windowId,
          agentId: url.searchParams.get('agentId') || lease?.agentId || windowState.agentId || '',
          leaseId: lease?.leaseId || '',
          debug,
        });
        return sendJson(res, 200, {
          ok: true,
          runId: windowState.runId,
          windowId: windowState.windowId,
          leaseId: lease?.leaseId || '',
          route: normalizeWfBrowserRoute(url.searchParams.get('route') || windowState.route || '/'),
          debugUrlParams,
          launchUrl: wfBrowserLaunchUrl(url, expectedToken, windowState, lease, {
            route: url.searchParams.get('route') || '',
            agentId: url.searchParams.get('agentId') || '',
            debug,
          }),
        });
      } catch (e) {
        return sendMappedError(res, e);
      }
    }

    const wfBrowserWindowsMatch = pathname.match(/^\/api\/wf-browser\/runs\/([^/]+)\/windows$/);
    if (req.method === 'GET' && wfBrowserWindowsMatch) {
      try {
        return sendJson(res, 200, listWfBrowserWindows(absRoot, wfBrowserWindowsMatch[1]));
      } catch (e) {
        return sendMappedError(res, e);
      }
    }
    if (req.method === 'POST' && wfBrowserWindowsMatch) {
      readJsonBody(req).then((payload) => {
        try {
          const result = createWfBrowserWindow(absRoot, wfBrowserWindowsMatch[1], payload);
          return sendJson(res, 201, {
            ...result,
            launchUrl: wfBrowserLaunchUrl(url, expectedToken, result.window, null, {
              route: payload.route || '',
              agentId: payload.agentId || '',
            }),
          });
        } catch (e) {
          return sendMappedError(res, e);
        }
      }).catch(e => sendError(res, 400, 'BAD_REQUEST', e.message));
      return;
    }

    const wfBrowserRunMatch = pathname.match(/^\/api\/wf-browser\/runs\/([^/]+)$/);
    if (req.method === 'GET' && wfBrowserRunMatch) {
      try {
        return sendJson(res, 200, getWfBrowserRun(absRoot, wfBrowserRunMatch[1]));
      } catch (e) {
        return sendMappedError(res, e);
      }
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
          const result = applyWorkspaceOperation(absRoot, payload);
          // L1 self-write suppression: every successful workspace op (this
          // endpoint covers file.writeText too — the node action routes
          // through applyWorkspaceOperation) re-baselines the file-node
          // watcher so the write is never reported back as an external
          // file.changed event.
          if (result && Array.isArray(result.entriesChanged)) {
            for (const entry of result.entriesChanged) refreshBaseline(absRoot, entry);
          }
          return sendJson(res, 200, result);
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

    // ── POST /api/workspace/reveal ──
    // Opens the user's OS file manager at a workspace path (directories open in
    // place; files get revealed/selected). Loopback-only surface; the path is
    // validated for containment + existence before anything is spawned.
    if (req.method === 'POST' && pathname === '/api/workspace/reveal') {
      readJsonBody(req).then((payload) => {
        try {
          const plan = planRevealWorkspacePath(absRoot, payload?.path ?? '');
          // WF_UI_REVEAL_DRY_RUN=1 (tests/CI): validate + plan only, never
          // launch a real OS window.
          if (process.env.WF_UI_REVEAL_DRY_RUN === '1') {
            return sendJson(res, 200, { ok: true, dryRun: true, ...plan });
          }
          let child;
          try {
            // No windowsHide: the target is a GUI file manager (explorer.exe /
            // open / xdg-open) whose whole purpose is to show a window. On
            // Windows windowsHide maps to CREATE_NO_WINDOW, which spawns the
            // explorer window hidden — the request succeeds but nothing appears.
            child = spawn(plan.command, plan.args, { detached: true, stdio: 'ignore' });
          } catch (e) {
            return sendError(res, 500, 'REVEAL_FAILED', `Failed to launch ${plan.command}: ${e.message}`);
          }
          child.on('error', (e) => {
            // Spawn async failure (e.g. missing executable on PATH); the window
            // is already detached so this is best-effort reporting only.
            console.warn(`[workspace] reveal failed for ${plan.path}:`, e?.message || e);
          });
          child.unref();
          // Windows foreground lock: explorer spawned from this background
          // server opens behind the browser (or reuses an existing window
          // without raising it). Best-effort focus helper; no-op elsewhere.
          if (plan.platform === 'win32') bringRevealWindowToFront(plan);
          return sendJson(res, 200, {
            ok: true,
            path: plan.path,
            isDirectory: plan.isDirectory,
            platform: plan.platform,
          });
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
      try {
        // Incremental polling (P1a): clients send back the last fingerprint;
        // an unchanged graph+session state costs a tiny JSON instead of a full
        // snapshot build.
        const since = url.searchParams.get('since') || '';
        if (since && stateFingerprint(absRoot) === since) {
          return sendJson(res, 200, { unchanged: true, fingerprint: since });
        }
        const snapshot = buildWorkflowSnapshot(absRoot, sr);
        snapshot.fingerprint = stateFingerprint(absRoot);
        return sendJson(res, 200, snapshot);
      } catch (e) {
        return sendMappedError(res, e);
      }
    }

    if (req.method === 'GET' && pathname === '/api/workflow/ontology') {
      try {
        return sendJson(res, 200, { ok: true, ontology: workflowOntology() });
      } catch (e) {
        return sendMappedError(res, e);
      }
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

    // Display node report HTML (fully-open JS per user decision; agent-authored
    // content carries the same trust as the agent terminal). Excalidraw
    // placeholders expand to self-contained inline SVG at serve time.
    const componentHtmlMatch = pathname.match(/^\/api\/a2a\/component-nodes\/([^/]+)\/html$/);
    if (componentHtmlMatch && req.method === 'GET') {
      try {
        const nodeId = decodeURIComponent(componentHtmlMatch[1]);
        const html = renderDisplayHtml(absRoot, { nodeId });
        return sendTextHtml(res, 200, html);
      } catch (e) {
        return sendMappedError(res, e);
      }
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

    // ── Workflow Node Runtime ──
    if (req.method === 'GET' && pathname === '/api/workflow/nodes') {
      Promise.resolve().then(() => listNodes(absRoot))
        .then(data => sendJson(res, 200, data))
        .catch(e => sendMappedError(res, e));
      return;
    }

    // ── Agent find / connect routing (agent-team-cooperation-spec §4) ──
    if (req.method === 'GET' && pathname === '/api/workflow/agents/find') {
      Promise.resolve().then(async () => {
        const filters = {};
        for (const key of ['role', 'runtime', 'provider', 'capability', 'title']) {
          const value = url.searchParams.get(key);
          if (value) filters[key] = value;
        }
        const result = await findAgents(absRoot, filters, sr);
        const from = String(url.searchParams.get('from') || '').trim();
        if (!from || url.searchParams.get('autoConnect') !== '1' || result.count !== 1) return result;
        const fromNodeId = resolveAgentNodeId(absRoot, from);
        if (!fromNodeId) return result;
        if (!result.matches[0].connected) {
          const connected = autoConnectAgent(absRoot, fromNodeId, result.matches[0].nodeId);
          return { ...result, decision: 'connect', nodeId: result.matches[0].nodeId, edge: connected.edge };
        }
        return { ...result, decision: 'connect', nodeId: result.matches[0].nodeId, edge: null };
      })
        .then(data => sendJson(res, 200, data))
        .catch(e => sendMappedError(res, e));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/workflow/agents/profile') {
      const nodeId = String(url.searchParams.get('nodeId') || '').trim();
      if (!nodeId) return sendError(res, 400, 'BAD_REQUEST', 'Missing nodeId query param');
      return sendJson(res, 200, { ok: true, nodeId, profile: readRoleProfile(nodeId, absRoot) });
    }

    // ── Cooperation audit (spec §4.5, AC-025) ──
    if (req.method === 'GET' && pathname === '/api/workflow/cooperation/audit') {
      Promise.resolve().then(() => deriveCooperationAudit(absRoot))
        .then(data => sendJson(res, 200, data))
        .catch(e => sendMappedError(res, e));
      return;
    }

    function goalAlreadyBoundResponse(res, error) {
      return sendJson(res, 409, {
        error: 'goal_already_bound',
        message: error.message,
        existingGoalNodeId: error.existingGoalNodeId,
        timerNodeId: error.timerNodeId,
      });
    }

    function assertSingleGoalOrThrowGoalBound(res, goalNodeId, opts = {}) {
      try {
        return assertSingleGoalPerGroup(absRoot, goalNodeId, opts);
      } catch (error) {
        if (error?.code === 'goal_already_bound') {
          goalAlreadyBoundResponse(res, error);
          return null;
        }
        throw error;
      }
    }

    function resolveAgentNodeId(projectRoot, key) {
      const graph = loadWorkflowGraphMap(projectRoot);
      const node = (Array.isArray(graph.nodes) ? graph.nodes : [])
        .find(item => (item.nodeId || item.id) === key || item.sessionId === key);
      return node ? node.nodeId || node.id : '';
    }

    if (req.method === 'GET' && pathname === '/api/workflow/skills-hub') {
      Promise.resolve().then(() => listSkillsHub(absRoot, {
        q: url.searchParams.get('q') || '',
        scope: url.searchParams.get('scope') || 'project',
        limit: url.searchParams.get('limit') || undefined,
      }))
        .then(data => sendJson(res, 200, data))
        .catch(e => sendMappedError(res, e));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/workflow/mcp-hub') {
      Promise.resolve().then(() => listMcpHub(absRoot, {
        q: url.searchParams.get('q') || '',
        scope: url.searchParams.get('scope') || 'project',
        limit: url.searchParams.get('limit') || undefined,
      }))
        .then(data => sendJson(res, 200, data))
        .catch(e => sendMappedError(res, e));
      return;
    }

    const workflowNodeByIdMatch = pathname.match(/^\/api\/workflow\/nodes\/([^/]+)$/);
    if (req.method === 'GET' && workflowNodeByIdMatch) {
      Promise.resolve().then(() => getNode(absRoot, decodeURIComponent(workflowNodeByIdMatch[1])))
        .then(data => sendJson(res, 200, data))
        .catch(e => sendMappedError(res, e));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/workflow/nodes') {
      readJsonBody(req)
        .then((payload) => {
          // Single-Goal rule (spec §6.2, AC-015): creating a Goal into a
          // Timer+Agent magnetic group that already has a Goal is rejected.
          // The count is candidate-inclusive (F2): a Goal surfaced into a
          // group it is already docked in is counted; a free-floating Goal
          // forms no group yet and passes — connect-time catches the second.
          if (String(payload?.type || '').trim().toLowerCase() === 'goal') {
            const goalNodeId = (listGoalNodes(absRoot)[0] || {}).nodeId || '';
            if (goalNodeId && assertSingleGoalOrThrowGoalBound(res, goalNodeId, { extraNodeIds: [goalNodeId] }) === null) return null;
          }
          return createWorkflowNode(absRoot, payload);
        })
        .then(data => {
          if (data === null) return;
          const nodeId = data?.node?.nodeId || data?.node?.id || data?.state?.nodeId;
          const operation = appendWorkflowOperation(absRoot, {
            kind: 'graph.createNode',
            actor: workflowOperationActor(absRoot, 'human'),
            targetNodeIds: nodeId ? [nodeId] : [],
            edgeIds: [],
            status: 'completed',
            summary: `created ${nodeId || 'node'}`,
          });
          sendJson(res, 201, { ...data, operation });
        })
        .catch(e => sendMappedError(res, e));
      return;
    }

    const workflowNodeStateMatch = pathname.match(/^\/api\/workflow\/nodes\/([^/]+)\/state$/);
    if (req.method === 'PATCH' && workflowNodeStateMatch) {
      readJsonBody(req)
        .then(payload => updateNodeState(absRoot, decodeURIComponent(workflowNodeStateMatch[1]), payload))
        .then(data => sendJson(res, 200, data))
        .catch(e => sendMappedError(res, e));
      return;
    }

    const workflowNodeSettingsMatch = pathname.match(/^\/api\/workflow\/nodes\/([^/]+)\/settings$/);
    if (req.method === 'PATCH' && workflowNodeSettingsMatch) {
      readJsonBody(req)
        .then(payload => updateNodeSettings(absRoot, decodeURIComponent(workflowNodeSettingsMatch[1]), payload))
        .then(data => sendJson(res, 200, data))
        .catch(e => sendMappedError(res, e));
      return;
    }

    const workflowNodeActionMatch = pathname.match(/^\/api\/workflow\/nodes\/([^/]+)\/actions\/([^/]+)$/);
    if (req.method === 'POST' && workflowNodeActionMatch) {
      readJsonBody(req)
        .then(async (payload) => {
          const key = decodeURIComponent(workflowNodeActionMatch[1]);
          const action = decodeURIComponent(workflowNodeActionMatch[2]);
          if (action === 'agent.start' || action === 'agent.restart') {
            if (!sr || typeof sr.create !== 'function') {
              const e = new NodeConfigError('Session registry not available', {
                statusCode: 501,
                code: 'NOT_IMPLEMENTED',
              });
              throw e;
            }
            const run = () => action === 'agent.restart'
              ? restartWorkflowGraphNode(sr, absRoot, key, {
                  ...payload,
                  ...controlPlanePayload(url, expectedToken),
                }, terminalHub)
              : startWorkflowGraphNode(sr, absRoot, key, {
                  ...payload,
                  ...controlPlanePayload(url, expectedToken),
                }, terminalHub);
            const lockKey = `workflow-action:${action}:${key}`;
            const result = typeof sr.withLock === 'function'
              ? await sr.withLock(lockKey, run)
              : await Promise.resolve().then(run);
            const snapshot = await getNode(absRoot, result.graphNodeId || key).catch(() => ({ node: null }));
            return { ok: true, action, node: snapshot.node, result };
          }
          if (action === 'agent.stop') {
            if (!sr || typeof sr.get !== 'function') {
              const e = new NodeConfigError('Session registry not available', {
                statusCode: 501,
                code: 'NOT_IMPLEMENTED',
              });
              throw e;
            }
            const { node } = snapshotNodeByKey(absRoot, sr, key);
            const result = await stopRuntimeSession(sr, absRoot, node.sessionId, terminalHub);
            const snapshot = await getNode(absRoot, node.graphNodeId || node.id || key).catch(() => ({ node: null }));
            return { ok: true, action, node: snapshot.node, result };
          }
          if (action === 'agent.sendInput') {
            if (!sr || typeof sr.get !== 'function') {
              const e = new NodeConfigError('Session registry not available', {
                statusCode: 501,
                code: 'NOT_IMPLEMENTED',
              });
              throw e;
            }
            const { node } = snapshotNodeByKey(absRoot, sr, key);
            const result = sendRuntimeSessionInput(sr, absRoot, node.sessionId, payload, req.headers);
            const snapshot = await getNode(absRoot, node.graphNodeId || node.id || key).catch(() => ({ node: null }));
            return { ok: true, action, node: snapshot.node, result };
          }
          if (action === 'agent.setModel') {
            if (!sr || typeof sr.get !== 'function') {
              const e = new NodeConfigError('Session registry not available', {
                statusCode: 501,
                code: 'NOT_IMPLEMENTED',
              });
              throw e;
            }
            const { node } = snapshotNodeByKey(absRoot, sr, key);
            const result = setWorkflowNodeModel(absRoot, sr, node, payload, workflowActionActorOptions(req, url));
            const snapshot = await getNode(absRoot, node.graphNodeId || node.id || key).catch(() => ({ node: null }));
            return {
              ok: true,
              action,
              model: result.model,
              configFile: result.configFile,
              restartRequired: true,
              node: snapshot.node,
            };
          }
          if (action === 'agent.layout') {
            return executeGraphLayoutAction(absRoot, key, payload);
          }
          if (action === 'agent.attachDock' || action === 'agent.detachDock' || action === 'agent.setDockSide') {
            return executeGraphDockAction(absRoot, key, action, payload);
          }
          if (action === 'agent.updateEdge') {
            return executeGraphEdgeUpdateAction(absRoot, key, payload);
          }
          if (action === 'graph.undo' || action === 'graph.redo') {
            return executeGraphHistoryAction(absRoot, key, action, payload);
          }
          return executeNodeAction(
            absRoot,
            key,
            action,
            payload,
            workflowActionActorOptions(req, url),
          ).then(data => {
            // L1 self-write suppression: file.writeText lands on disk through
            // applyWorkspaceOperation, so re-baseline the watcher target the
            // same way the /api/workspace/ops route does — the node action's
            // own write must not echo back as file.changed.
            if (action === 'file.writeText' && data && data.result && typeof data.result.path === 'string') {
              refreshBaseline(absRoot, data.result.path);
            }
            return data;
          });
        })
        .then(data => sendJson(res, 200, data))
        .catch(e => sendMappedError(res, e));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/workflow/edges') {
      readJsonBody(req)
        .then((payload) => {
          // Single-Goal rule (spec §6.2, AC-015): connecting a Goal into a
          // Timer+Agent magnetic group that already has a Goal is rejected.
          // The count is candidate-inclusive (F2): the endpoint being
          // connected is joined to its peer with a simulated dock link before
          // counting, so a SECOND Goal that is not yet docked is still
          // rejected when its group already holds a Goal.
          const endpoints = [String(payload?.from || payload?.source || '').trim(), String(payload?.to || payload?.target || '').trim()];
          for (const endpoint of endpoints) {
            if (!endpoint || !/^goal-/.test(endpoint)) continue;
            const peer = endpoints.find(candidate => candidate && candidate !== endpoint) || '';
            const extraDockLinks = peer
              ? [{ id: `sim:${endpoint}->${peer}`, nodeIds: [endpoint, peer] }]
              : [];
            if (assertSingleGoalOrThrowGoalBound(res, endpoint, { extraDockLinks }) === null) return null;
          }
          return connectNodes(absRoot, payload, { action: 'agent.connectNodes', actor: { kind: 'human', nodeId: '', sessionId: '' } });
        })
        .then(data => {
          if (data === null) return;
          const edge = data.edge || {};
          const operation = appendWorkflowOperation(absRoot, {
            kind: 'graph.connectNodes',
            actor: workflowOperationActor(absRoot, 'human'),
            targetNodeIds: [edge.from || edge.source, edge.to || edge.target],
            edgeIds: [edge.id],
            status: 'completed',
            summary: `connected ${edge.id || 'edge'}`,
          });
          sendJson(res, 201, { ...data, operation });
        })
        .catch(e => sendMappedError(res, e));
      return;
    }

    const workflowEdgeDeleteMatch = pathname.match(/^\/api\/workflow\/edges\/([^/]+)$/);
    if (req.method === 'DELETE' && workflowEdgeDeleteMatch) {
      Promise.resolve().then(() => {
          const edgeId = decodeURIComponent(workflowEdgeDeleteMatch[1]);
          const graph = getGraphSnapshot(absRoot);
          const existing = (graph.edges || []).find(edge => edge.id === edgeId);
          const data = disconnectNodes(absRoot, edgeId, { action: 'agent.disconnectNodes', actor: { kind: 'human', nodeId: '', sessionId: '' } });
          const operation = appendWorkflowOperation(absRoot, {
            kind: 'graph.disconnectNodes',
            actor: workflowOperationActor(absRoot, 'human'),
            targetNodeIds: existing ? [existing.from || existing.source, existing.to || existing.target] : [],
            edgeIds: [edgeId],
            status: 'completed',
            summary: `disconnected ${edgeId}`,
          });
          return { ...data, operation };
        })
        .then(data => sendJson(res, 200, data))
        .catch(e => sendMappedError(res, e));
      return;
    }

    const workflowContextMatch = pathname.match(/^\/api\/workflow\/context\/([^/]+)$/);
    if (req.method === 'GET' && workflowContextMatch) {
      Promise.resolve().then(() => getNodeContext(absRoot, decodeURIComponent(workflowContextMatch[1])))
        .then(data => sendJson(res, 200, data))
        .catch(e => sendMappedError(res, e));
      return;
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
        const targetKey = node?.graphNodeId || node?.id || key;
        const graphBefore = loadWorkflowGraphMap(absRoot);
        const graphNodeRecord = (graphBefore.nodes || []).find(item => (
          (item.nodeId || item.id) === targetKey || item.sessionId === targetKey
        ));
        const historyOptions = {};
        if (graphNodeRecord) {
          const nodeIdForHistory = graphNodeRecord.nodeId || graphNodeRecord.id || targetKey;
          const affectedEdges = (graphBefore.edges || []).filter(edge => {
            const from = String(edge?.from || edge?.source || '');
            const to = String(edge?.to || edge?.target || '');
            return from === nodeIdForHistory || to === nodeIdForHistory
              || Boolean(graphNodeRecord.sessionId && (from === graphNodeRecord.sessionId || to === graphNodeRecord.sessionId));
          });
          // The inverse record carries the typed store state (event/component/
          // capability) so undo can restore the store alongside the graph node.
          const inverseRecord = { ...graphNodeRecord, position: graphBefore.positions?.[nodeIdForHistory] || graphNodeRecord.position };
          if (node?.eventState !== undefined) inverseRecord.eventState = node.eventState;
          if (node?.componentState !== undefined) inverseRecord.componentState = node.componentState;
          if (node?.capabilityState !== undefined) inverseRecord.capabilityState = node.capabilityState;
          const recorded = recordGraphOp(absRoot, {
            action: 'agent.deleteNode',
            actor: { kind: 'human', nodeId: '', sessionId: '' },
            inverse: {
              nodes: [inverseRecord],
              edges: affectedEdges,
            },
            forward: {
              nodes: [{ ...graphNodeRecord, _removed: true }],
              edges: affectedEdges.map(edge => ({ ...edge, _removed: true })),
            },
          });
          if (recorded) {
            historyOptions.undoStack = recorded.undoStack;
            historyOptions.redoStack = recorded.redoStack;
          }
        }
        const result = removeWorkflowGraphNode(absRoot, targetKey, historyOptions);
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

    // ── GET /api/chat/:sessionId/range — stored chat envelopes backfill ──
    const chatRangeMatch = pathname.match(/^\/api\/chat\/([^/]+)\/range$/);
    if (req.method === 'GET' && chatRangeMatch) {
      return sendJson(res, 200, readChatEnvelopes(absRoot, {
        sessionId: chatRangeMatch[1],
        fromSeq: url.searchParams.has('fromSeq') ? Number(url.searchParams.get('fromSeq')) : undefined,
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
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
          assertCanvasAgentSpawnAllowed(absRoot, payload, req.headers);
          const session = await createRuntimeSession(sr, absRoot, {
            ...payload,
            attachGraphNode: payload.attachGraphNode !== false,
            ...controlPlanePayload(url, expectedToken),
          }, terminalHub);
          sendJson(res, 201, session);
        } catch (e) {
          sendMappedError(res, e);
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
      readJsonBody(req).then((payload) => {
        try {
          return sendJson(res, 200, sendRuntimeSessionInput(
            sr,
            absRoot,
            decodeURIComponent(inputMatch[1]),
            payload,
            req.headers,
          ));
        } catch (e) {
          return sendMappedError(res, e);
        }
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

async function stopRuntimeSession(sr, absRoot, sessionId, terminalHub = null) {
  // Chat-mode sessions run on a live structured-stdio driver, not a PTY;
  // dispose it (driver-side graceful shutdown) before any registry teardown.
  try { await disposeChatDriver(sessionId, { reason: 'stopped' }); } catch { /* never blocks stop */ }
  const session = sr.get(sessionId);
  if (!session) {
    killPtyProcess(sessionId);
    // Backend restarted: the in-memory registry is empty, but the disk record
    // still knows the runtime identity — flush the terminal buffer, then
    // materialize the claude transcript from the persisted terminal ring
    // before reporting already-stopped.
    flushTerminalBuffer(absRoot, sessionId);
    const disk = listTerminalSessions(absRoot).find((entry) => entry.sessionId === sessionId);
    if (disk && disk.runtime === 'claude' && disk.agentSessionId) {
      await materializeStoppedClaudeTranscript(absRoot, disk);
    }
    return { ok: true, killed: false, stopped: null, saved: null, alreadyStopped: true };
  }

  // claude/cc get a graceful exit (write /exit, then Ctrl+C, then hard kill)
  // so the runtime can persist its transcript before the PTY dies; all other
  // runtimes are hard-killed. Bounded: gracefulStopPty never exceeds ~6s.
  const { killed } = await gracefulStopPty(sessionId, { runtime: session.runtime });
  clearTerminalState(sessionId);
  clearAgentNodeTerminalState(sessionId);
  // Persist buffered terminal entries before materialization reads the ring.
  flushTerminalBuffer(absRoot, sessionId);
  // Materialize BEFORE the stop guard so re-stopping an already-stopped claude
  // session still (re)builds its transcript from the persisted terminal ring.
  if (session.runtime === 'claude' && session.agentSessionId) {
    await materializeStoppedClaudeTranscript(absRoot, session);
  }
  const stopped = sr.stop(sessionId);
  if (!stopped) return { ok: true, killed, stopped: null, saved: null, alreadyStopped: true };
  // Restart race (AC-005): detachPreviousGraphSession may have already marked
  // this session as graph-replaced on disk while the stop was in flight. The
  // registry's stopped record predates that write, so persisting it verbatim
  // would erase the graphReplacedBy* fields and resurrect the old session in
  // the snapshot under the same node id. Merge: keep the disk-side detach
  // markers unless the stopped record itself carries them.
  const stoppedDisk = persistedSessionById(absRoot, sessionId) || {};
  const updated = withResumeMetadata({
    ...stopped,
    graphReplacedBySessionId: stopped.graphReplacedBySessionId || stoppedDisk.graphReplacedBySessionId || '',
    graphReplacedAt: stopped.graphReplacedAt || stoppedDisk.graphReplacedAt || '',
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

// claude-code never persists PTY-spawned conversations itself (RESUME-E2E-EVIDENCE.md
// PASS 2-7), so the harness rebuilds the transcript from its own terminal ring at
// stop time. Pure string work (no LLM); guarded so a materialize failure can never
// block or fail a stop.
async function materializeStoppedClaudeTranscript(absRoot, session) {
  try {
    const { entries } = readTerminalRange(absRoot, { sessionId: session.sessionId });
    const result = materializeClaudeTranscript({
      home: process.env.USERPROFILE || os.homedir(),
      cwd: absRoot,
      sessionId: session.agentSessionId,
      entries,
      model: session.model,
      gitBranch: session.gitBranch,
    });
    if (!result) {
      appendSessionEvent(absRoot, session, { type: 'claude.transcript.materialize.skipped', reason: 'no-turns' });
      return;
    }
    persistSession(absRoot, { ...session, claudeTranscriptPath: result.path });
    appendSessionEvent(absRoot, session, { type: 'claude.transcript.materialized', ...result });
  } catch (err) {
    appendSessionEvent(absRoot, session, { type: 'claude.transcript.materialize.failed', error: String(err?.message || err) });
  }
}

function sendRuntimeSessionInput(sr, absRoot, sessionId, payload = {}, headers = {}) {
  const session = sr.get(sessionId);
  if (!session) {
    throw new NodeConfigError('Session not found', {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }
  const data = String(payload.data ?? payload.input ?? payload.text ?? '');
  const actorSessionId = cleanString(
    payload.fromSessionId
      || payload.actorSessionId
      || payload.sourceSessionId
      || headers['x-harness-session-id'],
    '',
  );
  if (actorSessionId && !validateTaskId(actorSessionId)) {
    throw new NodeConfigError('Invalid actor session ID', {
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
  }
  const promptSubmit = payload.submit === true || payload.promptSubmit === true;
  const writeOk = promptSubmit
    ? writePromptSubmitInput(session.sessionId, data)
    : writePtyInput(session.sessionId, data);
  if (!writeOk) {
    throw new NodeConfigError('No PTY process attached to this session', {
      statusCode: 409,
      code: 'NO_PTY',
    });
  }
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
      messageId: cleanString(payload.messageId, ''),
      threadId: cleanString(payload.threadId, ''),
      topic: cleanString(payload.topic, ''),
      replyTo: cleanString(payload.replyTo, ''),
      deliveryMode: cleanString(payload.deliveryMode, 'direct'),
      recipientIndex: payload.recipientIndex,
      recipientCount: payload.recipientCount,
    });
    appendSessionEvent(absRoot, updated, {
      type: 'wf.bridge.message',
      bridgeId: bridgeMessage?.bridgeId || null,
      fromSessionId: actorSessionId,
      toSessionId: session.sessionId,
    });
  }
  return { ok: true, sessionId: session.sessionId, bridgeMessage };
}

// ── agent.setModel — model selection via project-scope runtime config ──
// TUI keystrokes (/model + arrows) are the interactive fallback; the right
// way for agents to switch models is a project config-file update + restart.
// Only PROJECT-scope config files are ever written here — user-scope files
// (~/.codex/config.toml, ~/.claude/settings.json) are never touched, and a
// missing project config file is refused (409) instead of created.
function escapeRegExpForModelField(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setJsonConfigField(data, dottedPath, value) {
  const parts = String(dottedPath || '').split('.').filter(Boolean);
  let current = data;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function writeModelToProjectConfig(configPath, format, modelField, model) {
  if (format === 'toml') {
    const text = fs.readFileSync(configPath, 'utf8');
    const nextLine = `${modelField} = ${JSON.stringify(model)}`;
    const regex = new RegExp(`^\\s*${escapeRegExpForModelField(modelField)}\\s*=\\s*.*$`, 'm');
    // Top-level key only: stop at the first TOML [section] header so a model
    // key inside a provider section is never treated as the runtime model.
    const sectionIndex = text.search(/^\[[^\]]*\][ \t]*(?:#.*)?$/m);
    const topLevel = sectionIndex === -1 ? text : text.slice(0, sectionIndex);
    fs.writeFileSync(
      configPath,
      regex.test(topLevel) ? text.replace(regex, nextLine) : `${text}\n${nextLine}\n`,
      'utf8',
    );
    return;
  }
  const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  setJsonConfigField(data, modelField, model);
  fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function setWorkflowNodeModel(absRoot, sr, node, payload = {}, actorOptions = {}) {
  const model = cleanString(payload.model, '');
  if (!model) {
    throw new NodeConfigError('model is required', {
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
  }
  if (model.length > 100) {
    throw new NodeConfigError('model must be at most 100 characters', {
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
  }
  const actorSessionId = cleanString(
    payload.actorSessionId
      || payload.fromSessionId
      || payload.sourceSessionId
      || actorOptions.actorSessionId,
    '',
  );
  if (actorSessionId && !validateTaskId(actorSessionId)) {
    throw new NodeConfigError('Invalid actor session ID', {
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
  }
  const source = sessionForWorkflowNode(sr, absRoot, node);
  const runtimeId = cleanString(source?.runtime || node.runtime, '');
  const definition = getRuntimeDefinition(runtimeId);
  const projectConfig = (definition?.configFiles || [])
    .find(candidate => candidate.scope === 'project' && candidate.fields?.model);
  if (!projectConfig) {
    throw new NodeConfigError(
      `Runtime ${runtimeId || 'unknown'} has no project-scope model config`,
      { statusCode: 409, code: 'NO_PROJECT_MODEL_CONFIG' },
    );
  }
  const configPath = path.isAbsolute(projectConfig.resolvedPath)
    ? projectConfig.resolvedPath
    : path.join(absRoot, projectConfig.resolvedPath);
  if (!fs.existsSync(configPath)) {
    throw new NodeConfigError(
      `Project model config file does not exist (${projectConfig.path}); refusing to create it`,
      { statusCode: 409, code: 'NO_PROJECT_MODEL_CONFIG' },
    );
  }
  writeModelToProjectConfig(configPath, projectConfig.format, projectConfig.fields.model, model);
  const patch = {
    model,
    restartRequired: true,
    restartRequiredFields: [...new Set([...(source.restartRequiredFields || []), 'model'])],
  };
  if (sr && typeof sr.update === 'function' && sr.get(source.sessionId)) {
    sr.update(source.sessionId, patch);
    persistSession(absRoot, sr.get(source.sessionId));
  } else {
    persistSession(absRoot, { ...source, ...patch });
  }
  return { model, configFile: projectConfig.path };
}

// ── Prompt-submit input (send-input with submit=true) ──
// Codex/Claude TUIs flush early writes at startup and need composer text
// typed char-by-char (like the xterm.js frontend delivers keystrokes) and
// followed by a SINGLE \r (0x0D, never \r\n): a bulk body write leaves text
// sitting unsubmitted in the codex composer, per-char typing submits.
// Submits are ready-gated on the prompt marker (❯/›, see
// terminalReadyForInitialInput): when the marker has not been observed yet,
// wait up to PROMPT_SUBMIT_READY_WAIT_MS (polled every
// PROMPT_SUBMIT_READY_POLL_MS) and then submit anyway. A new submit for the
// same session cancels every pending poll/char/enter timer of the previous
// submit so a stale \r can never hit a re-registered PTY.

/** sessionId -> { ready: boolean } — prompt-marker readiness for submit gating */
const terminalInputState = new Map();

/** sessionId -> pending submit timers (ready polls + enter), cancelled by the next submit */
const pendingSubmitTimers = new Map();

function trackTerminalSpawn(sessionId) {
  if (!sessionId) return;
  if (!terminalInputState.has(sessionId)) terminalInputState.set(sessionId, { ready: false });
}

function markTerminalReady(sessionId) {
  if (!sessionId) return;
  const entry = terminalInputState.get(sessionId) || { ready: false };
  entry.ready = true;
  terminalInputState.set(sessionId, entry);
}

function clearTerminalState(sessionId) {
  if (!sessionId) return;
  terminalInputState.delete(sessionId);
}

function terminalSubmitReady(sessionId) {
  const entry = terminalInputState.get(sessionId);
  // Untracked sessions (direct registration, tests) are treated as ready:
  // gating exists for server-spawned PTYs, which always record a spawn.
  if (!entry) return true;
  return entry.ready === true;
}

function cancelPendingSubmit(sessionId) {
  const timers = pendingSubmitTimers.get(sessionId);
  if (!timers) return;
  for (const timer of timers) clearTimeout(timer);
  pendingSubmitTimers.delete(sessionId);
}

function scheduleSubmitTimer(sessionId, delayMs, fn) {
  const timer = setTimeout(fn, delayMs);
  const timers = pendingSubmitTimers.get(sessionId) || [];
  timers.push(timer);
  pendingSubmitTimers.set(sessionId, timers);
  return timer;
}

function writePromptSubmitInput(sessionId, data) {
  const text = String(data || '');
  const body = text.replace(/[\r\n]+$/g, '');
  // A new submit supersedes any pending poll/char/enter of a previous submit.
  cancelPendingSubmit(sessionId);

  const scheduleEnter = () => {
    scheduleSubmitTimer(sessionId, PROMPT_SUBMIT_ENTER_DELAY_MS, () => {
      // Submit with a SINGLE \r (0x0D); never \r\n. Retry the enter once if
      // the PTY disappeared between the last char and the enter.
      if (!writePtyInput(sessionId, '\r')) {
        scheduleSubmitTimer(sessionId, PROMPT_SUBMIT_ENTER_DELAY_MS, () => writePtyInput(sessionId, '\r'));
      }
    });
  };

  const submit = () => {
    // Type the body char-by-char with PROMPT_TYPING_CHAR_DELAY_MS gaps, like
    // the xterm.js frontend delivers keystrokes: a bulk write of the whole
    // body + \r leaves the text unsubmitted in the codex composer, per-char
    // typing submits reliably. The first char is written synchronously so a
    // missing PTY still surfaces as NO_PTY (409) on the submit call; the
    // remaining chars and the enter ride the pending-timer list and are
    // cancelled by the next submit for the same session. An empty body skips
    // the char loop and just schedules the enter.
    const chars = Array.from(body);
    if (chars.length > 0 && !writePtyInput(sessionId, chars[0])) return false;
    const typeNext = (index) => {
      if (index >= chars.length) {
        scheduleEnter();
        return;
      }
      // Every remaining char (and the enter) rides the pending-timer list, so
      // a second submit for the same session aborts the whole sequence; stop
      // typing early if the PTY disappeared mid-sequence.
      scheduleSubmitTimer(sessionId, PROMPT_TYPING_CHAR_DELAY_MS, () => {
        if (!writePtyInput(sessionId, chars[index])) return;
        typeNext(index + 1);
      });
    };
    typeNext(1);
    return true;
  };

  if (terminalSubmitReady(sessionId)) return submit();

  // PTY is not ready yet: poll for the prompt marker, then submit anyway.
  const startedAt = Date.now();
  const poll = () => {
    if (terminalSubmitReady(sessionId) || Date.now() - startedAt >= PROMPT_SUBMIT_READY_WAIT_MS) {
      submit();
      return;
    }
    scheduleSubmitTimer(sessionId, PROMPT_SUBMIT_READY_POLL_MS, poll);
  };
  poll();
  return true;
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
    const explicitPosition = sourceNode?.position || current.positions?.[targetNodeId] || null;
    const position = explicitPosition || defaultGraphNodePosition(current, {
      parentAgentId: session.parentAgentId || sourceNode?.parentAgentId || null,
      parentNodeId: session.parentNodeId || sourceNode?.parentNodeId || null,
    });
    nodes.push({
      nodeId: targetNodeId,
      sessionId: session.sessionId,
      agentKind: session.agentKind,
      runtime: session.runtime,
      taskId: session.taskId || null,
      cwd: session.cwd,
      status: normalizeSessionStatus(session.status),
      label: sourceNode?.label || `${session.runtime} ${session.agentKind === 'main' ? 'main agent' : 'subagent'}`,
      parentAgentId: session.parentAgentId || sourceNode?.parentAgentId || null,
      parentNodeId: session.parentNodeId || sourceNode?.parentNodeId || null,
      position,
      restartedFromSessionId: previousSessionId || null,
      restartedAt: new Date().toISOString(),
    });
    return writeWorkflowGraphMap(absRoot, {
      ...current,
      version: current.version + 1,
      nodes,
      positions: explicitPosition
        ? current.positions
        : { ...(current.positions || {}), [targetNodeId]: position },
    });
  }
  return writeWorkflowGraphMap(absRoot, {
    ...current,
    version: current.version + 1,
    nodes,
  });
}

// Smart default placement for a NEW graph node pushed without an explicit
// position (previously `null`, which made the UI pile every node under the
// terminal). Placement rules:
//   1. Parent-anchored: when the node has a parent (parentAgentId/parentNodeId)
//      and the parent node carries a position, place the child right of the
//      parent, stacked vertically per sibling index.
//   2. Otherwise below the lowest existing node, or the empty-graph origin.
function defaultGraphNodePosition(graph, { parentAgentId = null, parentNodeId = null } = {}) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const positions = graph.positions && typeof graph.positions === 'object' && !Array.isArray(graph.positions)
    ? graph.positions
    : {};
  const parentKey = parentNodeId || parentAgentId || '';
  const parentNode = parentKey
    ? nodes.find(node => (
      (parentNodeId && ((node.nodeId || node.id) === parentNodeId || node.sessionId === parentNodeId))
      || (parentAgentId && ((node.sessionId === parentAgentId) || (node.nodeId || node.id) === parentAgentId))
    )) || null
    : null;
  if (parentNode) {
    const parentId = parentNode.nodeId || parentNode.id || '';
    const parentPosition = parentNode.position
      || positions[parentId]
      || (parentNodeId ? positions[parentNodeId] : null)
      || (parentAgentId ? positions[parentAgentId] : null);
    if (parentPosition && Number.isFinite(Number(parentPosition.x)) && Number.isFinite(Number(parentPosition.y))) {
      const childIndex = nodes.filter(node => {
        const nodeId = node.nodeId || node.id || '';
        if (nodeId === parentId) return false;
        const sameParentNode = parentNodeId
          ? node.parentNodeId === parentNodeId || node.parentNodeId === parentId
          : Boolean(parentId && node.parentNodeId === parentId);
        const sameParentAgent = parentAgentId
          ? node.parentAgentId === parentAgentId
          : Boolean(parentNode.sessionId && node.parentAgentId === parentNode.sessionId);
        return sameParentNode || sameParentAgent;
      }).length;
      return {
        x: Number(parentPosition.x) + 420,
        y: Number(parentPosition.y) + 80 * childIndex,
      };
    }
  }
  let maxBottom = -Infinity;
  let hasPosition = false;
  for (const value of Object.values(positions)) {
    if (!value || !Number.isFinite(Number(value.y))) continue;
    hasPosition = true;
    maxBottom = Math.max(maxBottom, Number(value.y) + 120);
  }
  if (!hasPosition) return { x: 260, y: 220 };
  return { x: 260, y: maxBottom + 140 };
}

function sessionGraphNodeLabel(session) {
  if (session.label) return session.label;
  return `${session.runtime} ${session.agentKind === 'main' ? 'main agent' : 'subagent'}`;
}

// ── graph layout action (agent.layout) ───────────────────────────────────────
// Main Agent can tidy the whole canvas: tree mode arranges roots left-to-right
// with children stacked right of their parent; grid mode fills rows of 4
// columns (main agents first, then subagents grouped by parent). Nodes that
// are bound into a capsuleDockLink are skipped so docked groups keep their
// relative placement. Every computed position is persisted into the graph map
// `positions` (the same persistence path moveNode uses).
const GRAPH_LAYOUT_DEFAULTS = Object.freeze({
  mode: 'tree',
  originX: 260,
  originY: 220,
  gapX: 420,
  gapY: 140,
});

function graphLayoutNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function graphLayoutMode(payload) {
  const mode = String(payload?.mode || GRAPH_LAYOUT_DEFAULTS.mode).toLowerCase();
  if (mode === 'grid') return 'grid';
  if (mode === 'tidy') return 'tidy';
  if (mode === 'agent-tree') return 'agent-tree';
  return 'tree';
}

function graphNodeLayoutParentId(node, nodes) {
  if (!node) return '';
  const parentNodeId = cleanString(node.parentNodeId, '');
  const parentAgentId = cleanString(node.parentAgentId, '');
  if (parentNodeId) {
    const match = (Array.isArray(nodes) ? nodes : []).find(candidate => (
      (candidate.nodeId || candidate.id) === parentNodeId
      || candidate.sessionId === parentNodeId
    ));
    if (match) return match.nodeId || match.id || parentNodeId;
  }
  if (parentAgentId) {
    const match = (Array.isArray(nodes) ? nodes : []).find(candidate => (
      candidate.sessionId === parentAgentId
      || (candidate.nodeId || candidate.id) === parentAgentId
    ));
    if (match) return match.nodeId || match.id || parentAgentId;
  }
  return '';
}

function layoutGraphGridPositions(nodes, { originX, originY, gapX, gapY }) {
  const sorted = [...nodes].sort((a, b) => {
    const aMain = isMainAgentGraphNode(a) ? 0 : 1;
    const bMain = isMainAgentGraphNode(b) ? 0 : 1;
    if (aMain !== bMain) return aMain - bMain;
    const aParent = graphNodeLayoutParentId(a, nodes);
    const bParent = graphNodeLayoutParentId(b, nodes);
    if (aParent !== bParent) return aParent < bParent ? -1 : 1;
    return 0;
  });
  const positions = {};
  sorted.forEach((node, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    positions[node.nodeId || node.id] = {
      x: originX + col * gapX,
      y: originY + row * gapY,
    };
  });
  return { positions, placed: new Set(Object.keys(positions)) };
}

// Depth-gated canvas-agent spawning (P1; ontology spawnRules agent.createNode
// root-only): ALL agents have equal permissions — the ONLY restriction is that
// a depth-1 agent (a graph node carrying a parentAgentId) may NOT spawn NEW
// canvas agent nodes. Anonymous / unresolvable actors stay allowed by design
// (the control plane is auth-less); runtime built-in subagents are outside
// this surface.
function assertCanvasAgentSpawnAllowed(absRoot, payload = {}, headers = {}) {
  const agentKind = cleanString(payload.agentKind, '').toLowerCase();
  if (!agentKind) return; // not creating an agent node
  const actorSessionCandidate = cleanString(
    payload.parentAgentId
    || headers['x-harness-session-id']
    || process.env.HARNESS_PEER_SESSION_ID
    || '',
    '',
  );
  const actorNodeCandidate = cleanString(
    payload.parentNodeId
    || headers['x-harness-workflow-node-id']
    || headers['x-harness-node-id']
    || '',
    '',
  );
  if (!actorSessionCandidate && !actorNodeCandidate) return; // anonymous
  const graph = loadWorkflowGraphMap(absRoot);
  let actorNode = actorNodeCandidate ? findAgentGraphNode(graph, actorNodeCandidate) : null;
  if (!actorNode && actorSessionCandidate) {
    actorNode = findAgentGraphNode(graph, actorSessionCandidate);
    if (!actorNode) {
      const session = persistedSessionById(absRoot, actorSessionCandidate);
      if (session?.graphNodeId) actorNode = findAgentGraphNode(graph, session.graphNodeId);
    }
  }
  if (!actorNode) return; // unresolvable actor — anonymous-equivalent
  if (cleanString(actorNode.parentAgentId, '')) {
    throw new NodeConfigError('Only the root agent can spawn canvas agents. Use your runtime\'s built-in subagents instead.', {
      statusCode: 403,
      code: 'DEPTH_LIMIT',
    });
  }
}

// ── Dock typed actions (P3): agent.attachDock / agent.detachDock /
// agent.setDockSide. Persisted via writeWorkflowGraphMap under
// graph.capsuleDockLinks, matching the shape the UI normalizes
// (normalizeCapsuleDockLinks) and the store re-normalizes on load. ──
const DOCK_SIDES = new Set(['left', 'right', 'top', 'bottom']);

function dockSideValue(value, fallback = 'right') {
  const side = cleanString(value, fallback).toLowerCase();
  return DOCK_SIDES.has(side) ? side : fallback;
}

function dockPairKey(a, b) {
  return [String(a || ''), String(b || '')].sort().join('::');
}

function dockLinkMatchesPair(link, anchorId, draggedId) {
  const pairKey = dockPairKey(anchorId, draggedId);
  const nodeIds = Array.isArray(link?.nodeIds)
    ? link.nodeIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  if (nodeIds.length >= 2) return dockPairKey(nodeIds[0], nodeIds[1]) === pairKey;
  const linkAnchor = String(link?.anchorId || '').trim();
  const linkDragged = String(link?.draggedId || '').trim();
  return Boolean(linkAnchor && linkDragged) && dockPairKey(linkAnchor, linkDragged) === pairKey;
}

function findDockLink(graph, { anchorId = '', draggedId = '', dockId = '' } = {}) {
  const links = Array.isArray(graph.capsuleDockLinks) ? graph.capsuleDockLinks : [];
  if (dockId) return links.find(link => String(link?.id || '') === String(dockId)) || null;
  if (!anchorId || !draggedId) return null;
  return links.find(link => dockLinkMatchesPair(link, anchorId, draggedId)) || null;
}

function graphActionActorNode(absRoot, actorKey, payload = {}) {
  const graph = loadWorkflowGraphMap(absRoot);
  const actorNodeId = cleanString(payload?.actorNodeId || actorKey, '');
  const graphNode = findAgentGraphNode(graph, actorNodeId);
  if (!graphNode) {
    throw new NodeConfigError('Agent graph actor not found', {
      statusCode: 404,
      code: 'AGENT_GRAPH_ACTOR_NOT_FOUND',
    });
  }
  return { graph, graphNode, actorNodeId };
}

function dockEdgeBetween(graph, fromId, toId) {
  const pairKey = dockPairKey(fromId, toId);
  return (Array.isArray(graph.edges) ? graph.edges : []).find(edge => {
    const from = String(edge.from || edge.source || '');
    const to = String(edge.to || edge.target || '');
    return Boolean(from && to) && dockPairKey(from, to) === pairKey;
  }) || null;
}

function executeGraphDockAction(absRoot, actorKey, action, payload = {}) {
  const { graph, graphNode, actorNodeId } = graphActionActorNode(absRoot, actorKey, payload);
  const historyActor = { kind: 'agent', nodeId: actorNodeId, sessionId: graphNode?.sessionId || payload?.actorSessionId || '' };
  const anchorId = cleanString(payload.anchorId, '');
  const draggedId = cleanString(payload.draggedId, '');
  const dockId = cleanString(payload.dockId, '');

  if (action === 'agent.detachDock') {
    if (!dockId && (!anchorId || !draggedId)) {
      throw new NodeConfigError('detachDock requires dockId or anchorId+draggedId', {
        statusCode: 400,
        code: 'INVALID_DOCK_PAYLOAD',
      });
    }
    const existing = dockId
      ? findDockLink(graph, { dockId })
      : (() => {
          const fromId = resolveWorkflowNodeId(absRoot, graph, anchorId);
          const toId = resolveWorkflowNodeId(absRoot, graph, draggedId);
          return findDockLink(graph, { anchorId: fromId, draggedId: toId });
        })();
    if (!existing) return { ok: true, action, removed: false, dockId: dockId || null };
    const removedId = existing.id || dockId || 'dock-link';
    const recorded = recordGraphOp(absRoot, {
      action,
      actor: historyActor,
      inverse: { dockLinks: [existing] },
      forward: { dockLinks: [{ ...existing, _removed: true }] },
    });
    writeWorkflowGraphMap(absRoot, {
      ...graph,
      version: graph.version + 1,
      capsuleDockLinks: (graph.capsuleDockLinks || []).filter(link => link !== existing),
      ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
    }, { overrideHistory: Boolean(recorded) });
    return { ok: true, action, removed: true, dockId: removedId };
  }

  if (!anchorId || !draggedId) {
    throw new NodeConfigError(`${action} requires anchorId and draggedId`, {
      statusCode: 400,
      code: 'INVALID_DOCK_PAYLOAD',
    });
  }
  const fromId = resolveWorkflowNodeId(absRoot, graph, anchorId);
  const toId = resolveWorkflowNodeId(absRoot, graph, draggedId);
  if (fromId === toId) {
    throw new NodeConfigError(`${action} anchorId and draggedId must differ`, {
      statusCode: 400,
      code: 'INVALID_DOCK_PAYLOAD',
    });
  }
  const existing = findDockLink(graph, { anchorId: fromId, draggedId: toId });

  if (action === 'agent.setDockSide') {
    if (!existing) {
      throw new NodeConfigError('Dock link not found', {
        statusCode: 404,
        code: 'DOCK_NOT_FOUND',
      });
    }
    const dockLink = { ...existing, side: dockSideValue(payload.side) };
    const recorded = recordGraphOp(absRoot, {
      action,
      actor: historyActor,
      inverse: { dockLinks: [existing] },
      forward: { dockLinks: [dockLink] },
    });
    writeWorkflowGraphMap(absRoot, {
      ...graph,
      version: graph.version + 1,
      capsuleDockLinks: (graph.capsuleDockLinks || []).map(link => (link === existing ? dockLink : link)),
      ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
    }, { overrideHistory: Boolean(recorded) });
    return { ok: true, action, dockLink };
  }

  // agent.attachDock — idempotent: re-attaching the same pair updates the side.
  const pairKey = dockPairKey(fromId, toId);
  const edge = dockEdgeBetween(graph, fromId, toId);
  const dockLink = {
    id: cleanString(payload.dockId, existing?.id || `dock:${pairKey}`),
    nodeIds: [fromId, toId].sort(),
    anchorId: fromId,
    draggedId: toId,
    side: dockSideValue(payload.side),
    edges: edge ? [{ edgeId: edge.id, retention: 'keep' }] : [],
    connections: edge ? [{
      id: `dock:${pairKey}:${edge.id}`,
      source: edge.source || edge.from,
      target: edge.target || edge.to,
      relation: edge.relation || 'wf-bridge',
      direction: edge.direction || 'bidirectional',
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
    }] : [],
  };
  const recorded = recordGraphOp(absRoot, {
    action,
    actor: historyActor,
    inverse: existing ? { dockLinks: [existing] } : { dockLinks: [{ ...dockLink, _removed: true }] },
    forward: { dockLinks: [dockLink] },
  });
  writeWorkflowGraphMap(absRoot, {
    ...graph,
    version: graph.version + 1,
    capsuleDockLinks: existing
      ? (graph.capsuleDockLinks || []).map(link => (link === existing ? dockLink : link))
      : [...(graph.capsuleDockLinks || []), dockLink],
    ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
  }, { overrideHistory: Boolean(recorded) });
  return { ok: true, action, dockLink, replaced: Boolean(existing) };
}

// P5: graph.undo / graph.redo — shared human+agent history. Applies the op's
// inverse (undo) or forward (redo) slice through the version-guarded
// writeWorkflowGraphMap path; empty stacks are idempotent ({ok:true, applied:null}).
function executeGraphHistoryAction(absRoot, actorKey, action, payload = {}) {
  graphActionActorNode(absRoot, actorKey, payload);
  const expectedVersion = payload?.expectedVersion;
  return action === 'graph.redo'
    ? redoGraphOp(absRoot, { expectedVersion })
    : undoGraphOp(absRoot, { expectedVersion });
}

// P4: agent.updateEdge HTTP route — mirrors the connectNodes store pattern
// (payload {edgeId, relation?, direction?, sourceHandle?, targetHandle?});
// empty patches and unknown edges surface the store's 400/404 shapes.
function executeGraphEdgeUpdateAction(absRoot, actorKey, payload = {}) {
  const { graphNode, actorNodeId } = graphActionActorNode(absRoot, actorKey, payload);
  const edgeId = cleanString(payload.edgeId, payload.id);
  const patch = {};
  if (payload.relation !== undefined) patch.relation = payload.relation;
  if (payload.direction !== undefined) patch.direction = payload.direction;
  if (payload.sourceHandle !== undefined) patch.sourceHandle = payload.sourceHandle;
  if (payload.targetHandle !== undefined) patch.targetHandle = payload.targetHandle;
  const result = updateEdge(absRoot, edgeId, patch, {
    action: 'agent.updateEdge',
    actor: { kind: 'agent', nodeId: actorNodeId, sessionId: graphNode?.sessionId || payload?.actorSessionId || '' },
  });
  return { ok: true, action: 'updateEdge', edge: result.edge };
}

function executeGraphLayoutAction(absRoot, actorKey, payload = {}) {
  const graph = loadWorkflowGraphMap(absRoot);
  const actorNodeId = cleanString(payload?.actorNodeId || actorKey, '');
  const graphNode = findAgentGraphNode(graph, actorNodeId);
  if (!graphNode) {
    throw new NodeConfigError('Agent graph actor not found', {
      statusCode: 404,
      code: 'AGENT_GRAPH_ACTOR_NOT_FOUND',
    });
  }
  if (!isMainAgentGraphNode(graphNode)) {
    throw new NodeConfigError('Agent graph control requires a Main Agent node', {
      statusCode: 403,
      code: 'MAIN_AGENT_REQUIRED',
    });
  }
  const mode = graphLayoutMode(payload);
  const originX = graphLayoutNumber(payload?.originX, GRAPH_LAYOUT_DEFAULTS.originX);
  const originY = graphLayoutNumber(payload?.originY, GRAPH_LAYOUT_DEFAULTS.originY);
  const gapX = graphLayoutNumber(payload?.gapX, GRAPH_LAYOUT_DEFAULTS.gapX);
  const gapY = graphLayoutNumber(payload?.gapY, GRAPH_LAYOUT_DEFAULTS.gapY);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const dockedNodeIds = new Set();
  for (const link of Array.isArray(graph.capsuleDockLinks) ? graph.capsuleDockLinks : []) {
    for (const nodeId of link?.nodeIds || []) dockedNodeIds.add(String(nodeId));
  }
  const movable = nodes.filter(node => !dockedNodeIds.has(String(node.nodeId || node.id || '')));
  // Shared inputs for tidy + agent-tree: per-node sizes, dock pairs (offsets
  // recomputed from current positions), and the edge list. Docked pairs are
  // INCLUDED and glued by both engines — each capsule keeps its exact
  // relative offset; per-node sizes make rows size-aware.
  const buildLayoutInputs = () => {
    const sizes = (payload && typeof payload === 'object' && payload.sizes) || {};
    const layoutNodes = nodes.map(node => {
      const nodeId = String(node.nodeId || node.id || '');
      const size = sizes[nodeId];
      return {
        id: nodeId,
        width: size?.w,
        height: size?.h,
        agentKind: node.agentKind,
        parentAgentId: node.parentAgentId,
        parentNodeId: node.parentNodeId,
      };
    });
    const currentPositions = new Map();
    for (const node of nodes) {
      const nodeId = String(node.nodeId || node.id || '');
      const pos = graph.positions?.[nodeId] || node?.position;
      if (pos && Number.isFinite(Number(pos.x)) && Number.isFinite(Number(pos.y))) {
        currentPositions.set(nodeId, pos);
      }
    }
    const dockedPairs = [];
    for (const link of Array.isArray(graph.capsuleDockLinks) ? graph.capsuleDockLinks : []) {
      const pair = Array.isArray(link?.nodeIds) ? link.nodeIds : [];
      const aId = cleanString(link?.anchorId || pair[0], '');
      const bId = cleanString(link?.draggedId || pair[1], '');
      if (!aId || !bId || aId === bId) continue;
      const posA = currentPositions.get(aId);
      const posB = currentPositions.get(bId);
      if (!posA || !posB) continue;
      dockedPairs.push({
        aId,
        bId,
        offset: { x: Number(posB.x) - Number(posA.x), y: Number(posB.y) - Number(posA.y) },
      });
    }
    const layoutEdges = [];
    for (const edge of Array.isArray(graph.edges) ? graph.edges : []) {
      if (!edge?.from || !edge?.to) continue;
      layoutEdges.push({ from: edge.from, to: edge.to, direction: edge.direction });
    }
    return { layoutNodes, dockedPairs, layoutEdges };
  };
  const { positions, placed } = mode === 'grid'
    ? layoutGraphGridPositions(movable, { originX, originY, gapX, gapY })
    : mode === 'tidy' || mode === 'agent-tree'
      ? (() => {
        // Tidy: hierarchical edge-direction relayout. Agent-tree: agent-core
        // compact layout (main centered anchor, agent tree below, asset
        // matrix bands above owners — never touches edges).
        const { layoutNodes, dockedPairs, layoutEdges } = buildLayoutInputs();
        const positionsMap = mode === 'tidy'
          ? tidyPositions(layoutNodes, layoutEdges, {
              origin: { x: originX, y: originY },
              gapX,
              gapY,
              dockedPairs,
            })
          : agentTreePositions(layoutNodes, layoutEdges, {
              origin: { x: originX, y: originY },
              // agent-tree uses its own compact defaults (64/48); the handler
              // passes explicit payload gaps only.
              ...(payload?.gapX !== undefined ? { gapX } : {}),
              ...(payload?.gapY !== undefined ? { gapY } : {}),
              dockedPairs,
            });
        return { positions: positionsMap, placed: new Set(Object.keys(positionsMap)) };
      })()
      : (() => {
      // Layered tree relayout: subtree-width blocks centered under parents —
      // no sibling-subtree collisions, edges point downward, deterministic.
      const treePositions = layeredTreePositions(movable, { originX, originY });
      return { positions: treePositions, placed: new Set(Object.keys(treePositions)) };
    })();
  // Cycle safety: any movable node the tree traversal could not reach gets a
  // deterministic fallback slot so no node is ever left without a position.
  const placedIds = new Set([...placed].map(String));
  let fallbackIndex = 0;
  for (const node of movable) {
    const nodeId = String(node.nodeId || node.id || '');
    if (!nodeId || placedIds.has(nodeId)) continue;
    const col = fallbackIndex % 4;
    const row = Math.floor(fallbackIndex / 4);
    positions[nodeId] = { x: originX + col * gapX, y: originY + row * gapY };
    placedIds.add(nodeId);
    fallbackIndex += 1;
  }
  // MED-2: the undo inverse must be able to restore EVERY node, including
  // docked pair members (anchor and slave) that are not in `positions` — so
  // the snapshot covers all graph nodes, not just the movable ones.
  const previousPositions = {};
  for (const node of nodes) {
    const nodeId = String(node.nodeId || node.id || '');
    if (!nodeId) continue;
    const previous = graph.positions?.[nodeId] || node.position || null;
    if (previous && Number.isFinite(Number(previous.x))) previousPositions[nodeId] = previous;
  }
  const recorded = recordGraphOp(absRoot, {
    action: 'agent.layout',
    actor: { kind: 'agent', nodeId: actorNodeId, sessionId: graphNode?.sessionId || '' },
    inverse: { positions: previousPositions },
    forward: { positions },
  });
  const nextNodes = nodes.map(node => {
    const nodeId = String(node.nodeId || node.id || '');
    if (!positions[nodeId]) return node;
    return { ...node, position: positions[nodeId] };
  });
  const written = writeWorkflowGraphMap(absRoot, {
    ...graph,
    version: graph.version + 1,
    nodes: nextNodes,
    positions: {
      ...(graph.positions || {}),
      ...positions,
    },
    ...(recorded ? { undoStack: recorded.undoStack, redoStack: recorded.redoStack } : {}),
  }, { overrideHistory: Boolean(recorded) });
  return { ok: true, action: 'layout', positions: written.positions || positions };
}

function sessionGraphNodePosition(graph, nodeId, existingNode = null, session = null) {
  const existingNodeId = existingNode?.nodeId || existingNode?.id || '';
  const existingPosition = existingNode?.position
    || graph.positions?.[nodeId]
    || (existingNodeId ? graph.positions?.[existingNodeId] : null);
  if (existingPosition && Number.isFinite(Number(existingPosition.x)) && Number.isFinite(Number(existingPosition.y))) {
    return {
      x: Number(existingPosition.x),
      y: Number(existingPosition.y),
    };
  }
  // Size-aware occupancy (HIGH-1): clearance is computed against REAL node
  // extents (per-kind visual sizes — agents render at 560x358, other kinds at
  // the 280x180 slot), never the slot size, so adjacent agents can't overlap.
  const selfSize = nodeVisualSize(existingNode || { kind: 'terminal-session', agentKind: session?.agentKind || 'subagent' });
  const existingRects = [];
  for (const node of Array.isArray(graph.nodes) ? graph.nodes : []) {
    const candidateId = node.nodeId || node.id || '';
    if (!candidateId) continue;
    const pos = graph.positions?.[candidateId] || node.position;
    if (!pos || !Number.isFinite(Number(pos.x)) || !Number.isFinite(Number(pos.y))) continue;
    const size = nodeVisualSize(node);
    existingRects.push({ x: Number(pos.x), y: Number(pos.y), w: size.w, h: size.h });
  }
  // HIGH-1: a caller-supplied {position:{x,y}} (client free-spot, AC-001) is
  // honored when it clears the existing rects; a colliding spot is moved to
  // the nearest clear position deterministically instead of being honored
  // blindly.
  const requested = session?.graphPosition;
  if (requested && Number.isFinite(Number(requested.x)) && Number.isFinite(Number(requested.y))) {
    return findClearPosition({
      requested: { x: Number(requested.x), y: Number(requested.y) },
      selfSize,
      existingRects,
    });
  }
  // Occupancy-aware auto-placement (graph-layout.mjs): new nodes land on a
  // free grid cell — near the parent's column when a parent is known — and
  // never overlap any existing node, dragged or auto-placed.
  const parentNodeId = cleanString(existingNode?.parentNodeId || session?.parentNodeId, '');
  const parentAgentId = cleanString(existingNode?.parentAgentId || session?.parentAgentId, '');
  let parentPos = null;
  if (parentNodeId || parentAgentId) {
    const parentNode = (Array.isArray(graph.nodes) ? graph.nodes : []).find((candidate) => {
      const candidateId = candidate.nodeId || candidate.id || '';
      return candidateId === parentNodeId
        || candidate.sessionId === parentNodeId
        || candidateId === parentAgentId
        || candidate.sessionId === parentAgentId
        || candidateId === `session-${parentAgentId}`;
    });
    if (parentNode) {
      const parentCandidateId = parentNode.nodeId || parentNode.id || '';
      parentPos = graph.positions?.[parentCandidateId] || parentNode.position || null;
    }
  }
  return autoPlaceNode(graph.positions || {}, { parent: parentPos, selfSize, existingRects });
}

function workflowGraphNodeForSession(session, graph, existingNode = null) {
  const nodeId = cleanString(session.graphNodeId, session.sessionId ? `session-${session.sessionId}` : '');
  const position = sessionGraphNodePosition(graph, nodeId, existingNode, session);
  return {
    ...(existingNode || {}),
    nodeId,
    kind: 'terminal-session',
    sessionId: session.sessionId,
    peerId: session.peerId,
    agentKind: session.agentKind,
    runtime: session.runtime,
    taskId: session.taskId || null,
    cwd: session.cwd,
    status: normalizeSessionStatus(session.status),
    role: session.role,
    displayName: session.displayName || '',
    roleTitle: session.roleTitle || '',
    label: existingNode?.label || sessionGraphNodeLabel(session),
    objective: session.objective,
    workflowMode: session.workflowMode || null,
    subagentMode: session.subagentMode,
    model: session.model || '',
    provider: session.provider || '',
    parentAgentId: session.parentAgentId || null,
    parentNodeId: session.parentNodeId || null,
    nodeHomeRel: session.nodeHomeRel || '',
    nodeInitRel: session.nodeInitRel || '',
    configRevision: Number(session.configRevision || 0),
    updatedAt: session.updatedAt || new Date().toISOString(),
    position,
  };
}

function ensureRuntimeSessionGraphNode(absRoot, session) {
  if (!session?.sessionId || !session.graphNodeId) return loadWorkflowGraphMap(absRoot);
  const current = loadWorkflowGraphMap(absRoot);
  const targetNodeId = cleanString(session.graphNodeId, `session-${session.sessionId}`);
  let existingForPosition = null;
  let inserted = false;
  const nodes = [];
  for (const node of current.nodes || []) {
    const nodeId = node.nodeId || node.id || '';
    const matches = nodeId === targetNodeId || node.sessionId === session.sessionId;
    if (!matches) {
      nodes.push(node);
      continue;
    }
    if (inserted) continue;
    existingForPosition = node;
    nodes.push(workflowGraphNodeForSession(session, current, node));
    inserted = true;
  }
  if (!inserted) {
    nodes.push(workflowGraphNodeForSession(session, current, existingForPosition));
  }
  const position = nodes.find(node => (node.nodeId || node.id) === targetNodeId)?.position
    || sessionGraphNodePosition(current, targetNodeId, existingForPosition);
  const positions = { ...(current.positions || {}) };
  if (existingForPosition) {
    const previousNodeId = existingForPosition.nodeId || existingForPosition.id || '';
    if (previousNodeId && previousNodeId !== targetNodeId) delete positions[previousNodeId];
  }
  positions[targetNodeId] = position;
  return writeWorkflowGraphMap(absRoot, {
    ...current,
    version: current.version + 1,
    nodes,
    positions,
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
      // Unified resume semantics: a live PTY ATTACHES — resume args are never
      // passed while the runtime process is still running.
      resumeUsed: false,
      resumeArgs: [],
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

  // P2 resume wiring (unified semantics): resume args are passed ONLY when
  // there is no live PTY (the alreadyRunning branch above handles attach) AND
  // the node has a persisted previous agent session that really ran — the
  // bound session's status is running/exited/stopped, or
  // restartedFromSessionId records an earlier restart binding. Fresh nodes
  // never resume. restart defaults to resume=true; plain start defaults to
  // true only when a previous session exists on the node. payload.resume:false
  // always opts out.
  const boundSession = persistedSessionById(absRoot, node.sessionId);
  const boundStatus = String(boundSession?.status || '').toLowerCase();
  const boundIsPrevious = boundStatus === 'running' || boundStatus === 'exited' || boundStatus === 'stopped';
  const previousAgentSessionId = cleanString(
    (boundIsPrevious ? node.sessionId : '')
    || node.restartedFromSessionId
    || source.restartedFromSessionId
    || source.previousSessionId
    || '',
    '',
  );
  const resumeDefault = payload.forceRestart === true ? true : Boolean(previousAgentSessionId);
  const resume = payload.resume !== undefined ? Boolean(payload.resume) : resumeDefault;
  // Per-runtime resume target: claude/cc and opencode key conversations by the
  // captured/pre-assigned agentSessionId (claude `--session-id` uuid, opencode
  // `ses_...` row id); codex keys by its internal rollout UUID (captured from
  // the previous PTY's sessions dir). When the previous session recorded its
  // per-runtime id, resume targets it; legacy sessions without one fall back
  // to the harness session id.
  const resumeSourceSession = previousAgentSessionId
    && previousAgentSessionId !== node.sessionId
    ? persistedSessionById(absRoot, previousAgentSessionId)
    : source;
  const previousAgentSessionIdForResume = cleanString(resumeSourceSession?.agentSessionId, '')
    || previousAgentSessionId;
  const previousCodexRolloutId = cleanString(resumeSourceSession?.codexRolloutId, '');
  // Pre-flight resume check: claude/cc resume a conversation only if its
  // transcript file still exists on disk (~/.claude/projects/<encoded-cwd>/
  // <sessionId>.jsonl). When the conversation store was cleaned, skip the
  // resume entirely and start fresh — otherwise the PTY prints
  // "No conversation found with session ID" and exits immediately.
  const resumeCwd = canonicalizeProjectPath(resumeSourceSession?.cwd || node.cwd || absRoot);
  const claudeConversationMissing = (runtime === 'claude' || runtime === 'cc')
    && !claudeConversationExists(resumeCwd, previousAgentSessionIdForResume);
  const resumeArgs = resume && !claudeConversationMissing
    ? resolveRuntimeResumeArgs(runtime, {
        agentSessionId: previousAgentSessionIdForResume,
        codexRolloutId: previousCodexRolloutId,
      })
    : [];
  if (resume && claudeConversationMissing && (runtime === 'claude' || runtime === 'cc')) {
    appendSessionEvent(absRoot, source, {
      type: 'session.resume-skipped',
      reason: 'claude-conversation-missing',
      agentSessionId: previousAgentSessionIdForResume,
      cwd: resumeCwd,
    });
  }

  const started = await createRuntimeSession(sr, absRoot, {
    runtime,
    agentKind,
    role: config.role || cleanString(payload.role, source.role || node.role || (agentKind === 'main' ? 'Main Agent' : 'Subagent')),
    customRole: config.customRole,
    prompt: config.prompt,
    objective: cleanString(payload.objective, config.prompt || source.objective || node.objective || 'Workflow agent'),
    taskId: payload.taskId !== undefined ? payload.taskId : (source.taskId || node.taskId || null),
    cwd: config.cwd || cleanString(payload.cwd, source.cwd || node.cwd || absRoot),
    subagentMode: cleanString(payload.subagentMode, source.subagentMode || 'built-in-subagents'),
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
    ...(Object.prototype.hasOwnProperty.call(payload, 'initialInput') ? { initialInput: payload.initialInput } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'initialPrompt') ? { initialPrompt: payload.initialPrompt } : {}),
    // Claude pre-assign continuity: the new session record keeps the resumed
    // (or harness-fallback) id so a later restart resumes the same
    // conversation; createRuntimeSession only uses it for claude/cc.
    ...((runtime === 'claude' || runtime === 'cc') && previousAgentSessionIdForResume
      ? { agentSessionId: previousAgentSessionIdForResume }
      : {}),
    resumeArgs,
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
    resumeUsed: resume && resumeArgs.length > 0,
    resumeArgs,
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
  const nextSession = result.sessionId && sr && typeof sr.get === 'function'
    ? sr.get(result.sessionId)
    : persistedSessionById(absRoot, result.sessionId);
  if (sr && typeof sr.get === 'function' && sr.get(previousSessionId)) {
    // AC-005 duplicate-node bug: the old session stays live in the registry
    // until its stop completes, and detachPreviousGraphSession early-returns
    // for live registry sessions — so a detach scheduled before (or racing)
    // the stop never persists the graphReplacedBy* markers. The old session
    // then remains snapshot-visible under the same node id as the new one.
    // Await the stop here (bounded by gracefulStopPty's hard-kill fallback,
    // ~6s worst case for claude; codex/opencode hard-kill immediately), THEN
    // detach — the registry entry is gone by then and the detach persists.
    // The catch guard keeps a kill failure from failing the whole restart.
    try {
      await stopRuntimeSession(sr, absRoot, previousSessionId, terminalHub);
    } catch { /* best-effort stop; detach below still marks the replacement */ }
  }
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
    resumeUsed: result.resumeUsed,
    resumeArgs: result.resumeArgs,
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

// Runtime-aware Subagent Strategy guidance (E2/E3/E5 in
// workflow-subagent-strategy-matrix.test.mjs). The heading structure and the
// literal `- subagentMode: <built-in-subagents|wf-node-subagents>` placeholder
// are pinned by B1; the `- When subagentMode is ...` prefixes and the NL
// trigger lines are pinned by B1/F1/F2/F3, and the Codex guidance lines by
// E2/E3/E5. Only the guidance lines vary by runtime and subagentMode.
// Unknown/unspecified runtimes fall back to the Claude Code text.
function subagentStrategyLines(session) {
  const runtimeId = String(session.runtime || '').toLowerCase();
  const wfNodeMode = session.subagentMode === 'wf-node-subagents';
  const lines = [
    '## Subagent Strategy',
    '',
    '- subagentMode: <built-in-subagents|wf-node-subagents>',
    '',
    '- When subagentMode is `built-in-subagents`:',
  ];
  if (runtimeId === 'codex') {
    lines.push(
      '- Use the Codex native subagent/tool/role path (codex_implement, codex exec, or native agent mechanism); do NOT create WF canvas Agent nodes; record fanoutAttempted, channel, roles evidence. If Codex native subagents are unavailable, record clear degradation evidence (runtime version, capability check result, error message) and inform the user; do not silently skip or pretend native subagents were used.',
    );
  } else if (runtimeId === 'opencode') {
    lines.push(
      '- Use the OpenCode native subagent mechanism (subagent_depth >= 2 required for nesting); do NOT create WF canvas Agent nodes; record fanoutAttempted, channel, roles evidence. If native subagents are unavailable, record clear degradation evidence and inform the user.',
    );
  } else {
    // claude / cc / unspecified default to Claude Code guidance.
    lines.push(
      "- Use the current runtime's native subagent mechanism (Agent tool for Claude Code); do NOT create WF canvas Agent nodes; record fanoutAttempted, channel, roles evidence. If native subagents are unavailable, record clear degradation evidence and inform the user.",
    );
  }
  // A Codex built-in session never gets the wf-node block, so the built-in
  // prompt cannot instruct WF canvas node creation (E2 doesNotMatch pin).
  if (runtimeId !== 'codex' || wfNodeMode) {
    lines.push(
      '',
      '- When subagentMode is `wf-node-subagents`:',
      '- Use `node Harness/scripts/wf-ui-control.mjs create-agent` to create/connect WF Agent nodes; communicate via sendMessage/broadcastMessage/readMessages; all worker nodes are visible on the canvas.',
    );
    if (runtimeId === 'codex') {
      lines.push(
        '- TIP: Codex main can create Claude Code implementer nodes (runtime: claude) as workers — send implementation tasks, Claude Code workers reply, Codex main aggregates via readMessages',
      );
    } else if (runtimeId !== 'opencode') {
      lines.push('- Worker agents can be Claude Code, Codex, or OpenCode nodes');
    }
  }
  lines.push(
    '',
    '- Natural language: "内部助手", "内置子代理", "不要开画布节点", "native subagent", "built-in" → built-in-subagents',
    '- "画布Agent节点", "开Claude Code节点", "WF node协作", "可视化协作", "canvas worker" → wf-node-subagents',
    '- Default when unspecified: built-in-subagents',
    '',
  );
  return lines;
}

// Methodology-only node init prompt: identity, a 5-step runtime discovery
// loop (help --json / workflow-context / manuals / snapshot /
// workflow-ontology), invariant rules, and the runtime-aware Subagent
// Strategy section. The init prompt deliberately carries NO command catalog —
// the agent discovers commands, context, node manuals, canvas state, and
// ontology at runtime through the discovery loop.
function nodeInitMarkdown(session) {
  const agentKind = session.agentKind === 'main' ? 'main' : 'subagent';
  const workflowMode = session.workflowMode ? `/${String(session.workflowMode).replace(/^\//, '')}` : 'none';
  const homeRel = session.nodeHomeRel || nodeHomeRel(session.sessionId);
  const lines = [
    '# Harness WF Node Init',
    '',
    '## Identity',
    `- You are: ${String(session.displayName || 'terminal-agent').trim()} (${String(session.roleTitle || 'terminal-agent').trim()}); Agent kind: ${agentKind}`,
    `- Session: ${session.sessionId} | Runtime: ${session.runtime} | Graph node: ${session.graphNodeId || ''}`,
    `- Subagent mode: ${session.subagentMode || 'built-in-subagents'} | Workflow mode: ${workflowMode}`,
    `- Node home: ${homeRel} | This file: ${homeRel}/init.md`,
    // F15/D12: the identity block appears only when a real role profile exists
    // (roleProfileRef is set exclusively by the create-agent profile path);
    // legacy sessions without a profile keep the previous init shape even
    // though the registry defaults roleTitle/displayName to 'terminal-agent'.
    ...(session.roleProfileRef
      ? [
          `- Display name: ${String(session.displayName || '').trim()}`,
          `- Role title: ${String(session.roleTitle || '').trim()}`,
          ...(String(session.responsibility || '').trim()
            ? [`- Responsibility: ${String(session.responsibility).trim()}`]
            : []),
          ...(Array.isArray(session.capabilities) && session.capabilities.some(item => String(item || '').trim())
            ? [`- Capabilities: ${session.capabilities.map(item => String(item).trim()).filter(Boolean).join(', ')}`]
            : []),
          `- Role profile: ${String(session.roleProfileRef || '').trim()} — read this file; it is your identity and mandate.`,
        ]
      : []),
    `- Objective: ${session.objective || 'none'}`,
    `- Env subagent mode: HARNESS_SUBAGENT_MODE=${session.subagentMode || ''} | Env: HARNESS_NODE_INIT=${session.nodeInitPath || ''} | HARNESS_PEER_SESSION_ID=${session.sessionId} | HARNESS_WORKFLOW_NODE_ID=${session.graphNodeId || ''}`,
    '',
    '## Working Method — discovery first',
    'You control the workflow canvas ONLY through typed interfaces. Never edit Harness/a2a/**/state.json or workflow-map.json directly.',
    '',
    'Discover in this order before acting:',
    '1. Commands:   node Harness/scripts/wf-ui-control.mjs help --json',
    '2. Context:    node Harness/scripts/wf-ui-control.mjs workflow-context --project .   ← hydrate EVERY turn, mandatory',
    '3. Manual:     node Harness/scripts/wf-ui-control.mjs manuals <nodeType>   ← before creating/connecting a node type',
    '4. Canvas:     node Harness/scripts/wf-ui-control.mjs snapshot --project .',
    '5. Vocabulary: node Harness/scripts/wf-ui-control.mjs workflow-ontology --project .',
    '',
    '## Invariant Rules',
    '- The Timer is the only wakeup source; the Goal node never wakes agents.',
    '- Writing/modifying HTML files is normal work and always allowed. When PRESENTING a report or results to the user: if the user has not explicitly named a target file, the default presentation surface is a Display node (display.write). Never open a browser yourself. Guide: node Harness/scripts/wf-ui-control.mjs manuals display',
    ...(agentKind === 'subagent'
      ? ['- Subagent must not create nodes, tasks, unmanaged PTYs, or built-in/internal subagents; do assigned work and return concise evidence.']
      : []),
    '',
    ...subagentStrategyLines(session),
  ];
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
    uiMode: session.uiMode || 'pty',
    transport: (session.uiMode || 'pty') === 'chat' ? 'stdio' : 'pty',
    providerSessionId: session.providerSessionId || null,
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
  if (Object.prototype.hasOwnProperty.call(payload, 'initialInput')) return String(payload.initialInput ?? '');
  return '';
}

function runtimeInitialInputMode(session, payload, initialInput) {
  if (!initialInput) return '';
  if (Object.prototype.hasOwnProperty.call(payload, 'initialInput')) return 'explicit';
  return '';
}

export function terminalReadyForInitialInput(data, runtime = '') {
  const text = String(data || '');
  if (!text) return false;
  const runtimeId = String(runtime || '').toLowerCase();

  if (runtimeId.includes('claude')) {
    return text.includes('Claude Code') && (text.includes('bypass permissions') || text.includes('❯'));
  }

  if (runtimeId.includes('codex')) {
    return text.includes('Codex') && (text.includes('›') || text.includes('❯') || text.includes('bypass permissions'));
  }

  return text.includes('❯') || text.includes('›');
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
  const resumeArgs = Array.isArray(payload.resumeArgs) ? payload.resumeArgs : [];
  // Claude pre-assign (deterministic capture): claude 2.1.x accepts
  // `--session-id <uuid>` at spawn, so the harness mints the conversation id
  // up front instead of polling for it. The id source is the caller-supplied
  // agentSessionId (the previous session's id on graph resume) or a fresh
  // uuid — always generated for claude/cc. Resume spawns never re-pre-assign:
  // the --resume flag already targets the resumed conversation.
  const isClaudeRuntime = runtime === 'claude' || runtime === 'cc';
  const claudeAgentSessionId = isClaudeRuntime
    ? cleanString(payload.agentSessionId, '') || crypto.randomUUID()
    : null;
  const attachGraphNode = payload.attachGraphNode === true;
  const requestedGraphNodeId = cleanString(payload.graphNodeId, '');
  const agentKind = cleanString(payload.agentKind, String(payload.role || '').toLowerCase().includes('ceo') ? 'main' : 'subagent').toLowerCase();
  const role = cleanString(payload.role, 'terminal-agent');
  const objective = cleanString(payload.objective, 'Harness terminal agent');
  const subagentMode = cleanString(payload.subagentMode, 'built-in-subagents');
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
    uiMode: payload.uiMode === 'chat' ? 'chat' : 'pty',
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
    graphNodeId: requestedGraphNodeId,
    graphVersion: Number(payload.graphVersion || 0),
    graphContextPath: cleanString(payload.graphContextPath, currentGraph.graphContextPath || ''),
    parentAgentId: cleanString(payload.parentAgentId, '') || null,
    parentNodeId: cleanString(payload.parentNodeId, '') || null,
  });
  if (attachGraphNode && !session.graphNodeId) {
    sr.update(session.sessionId, { graphNodeId: `session-${session.sessionId}` });
    session = sr.get(session.sessionId) || { ...session, graphNodeId: `session-${session.sessionId}` };
  }
  if (claudeAgentSessionId) {
    sr.update(session.sessionId, { agentSessionId: claudeAgentSessionId });
    session = sr.get(session.sessionId) || { ...session, agentSessionId: claudeAgentSessionId };
  }
  // Role profile (agent-team-cooperation-spec §3, AC-001/AC-007): the
  // create-agent path writes the profile when the caller supplies profile
  // fields (displayName / roleTitle / responsibility / capabilities). F15/D12:
  // the profile is created/read BEFORE the node home init prompt is assembled,
  // so the init prompt can carry the identity fields + roleProfileRef. Legacy
  // creates without profile fields stay unchanged.
  const wantsProfile = Boolean(
    payload.displayName || payload.roleTitle
    || payload.responsibility || payload.capabilities
    || payload.roleProfile === true,
  );
  if (wantsProfile && session.graphNodeId) {
    const profileNodeId = cleanString(session.graphNodeId, `session-${session.sessionId}`);
    const legacyRoles = new Set(['Subagent', 'Main Agent', 'terminal-agent', 'CEO']);
    const parentSessionId = cleanString(payload.parentAgentId, '');
    // AC-004/F6: a subagent created WITHOUT an explicit roleTitle gets the
    // next distinct canonical role for its parent instead of a fixed default;
    // an explicit roleTitle is respected as given.
    const resolvedRoleTitle = cleanString(payload.roleTitle,
      agentKind === 'main' ? 'ceo'
        : (role && !legacyRoles.has(role) ? role : nextAvailableRole(parentSessionId, absRoot)));
    const profile = createRoleProfile({
      nodeId: profileNodeId,
      roleTitle: resolvedRoleTitle,
      displayName: cleanString(payload.displayName, resolvedRoleTitle),
      responsibility: cleanString(payload.responsibility, objective),
      agentKind,
      runtime,
      provider: cleanString(payload.provider, provider),
      model: cleanString(payload.model, model),
      capabilities: Array.isArray(payload.capabilities)
        ? payload.capabilities.map(item => String(item).trim()).filter(Boolean)
        : (Array.isArray(nodeConfig.capabilities) ? nodeConfig.capabilities : []),
      createdBy: cleanString(payload.createdBy, 'agent.create'),
      parentSessionId,
    }, absRoot);
    const sessionFields = profileSessionFields(profile.profile);
    const updatedSession = { ...(sr.get(session.sessionId) || session), ...sessionFields };
    if (typeof sr.update === 'function') sr.update(session.sessionId, sessionFields);
    session = sr.get(session.sessionId) || updatedSession;
  }
  const nodeHome = writeNodeHome(absRoot, {
    ...session,
    nodeHomeRel: nodeHomeRel(session.sessionId),
  }, currentGraph);
  sr.update(session.sessionId, nodeHome);
  session = sr.get(session.sessionId) || { ...session, ...nodeHome };
  persistSession(absRoot, session);
  // HIGH-1: the create payload may carry an optional {position:{x,y}} (client
  // free-spot). It rides a transient copy — the registry session itself keeps
  // its fixed shape, so start/reload paths (which pass sr.get sessions with
  // no graphPosition) are unaffected and existing positions still win.
  if (attachGraphNode) {
    ensureRuntimeSessionGraphNode(absRoot, { ...session, graphPosition: payload.position });
  }
  const initialInput = runtimeInitialInput(session, payload);
  const initialInputMode = runtimeInitialInputMode(session, payload, initialInput);
  const initialPrompt = runtimeInitialPrompt(session, payload);
  let initialInputScheduled = false;
  const scheduleInitialInput = (reason = 'unknown', delayMs = INITIAL_INPUT_READY_DELAY_MS) => {
    if (!initialInput || initialInputScheduled) return;
    initialInputScheduled = true;
    appendSessionEvent(absRoot, session, {
      type: 'terminal.input.schedule',
      mode: initialInputMode || 'unknown',
      bytes: initialInput.length,
      reason,
      delayMs,
    });
    setTimeout(() => writePtyInputSequence(session.sessionId, initialInput), delayMs);
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
    initialInputMode: initialInputMode || null,
    initialInputBytes: initialInput ? initialInput.length : 0,
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
    const pendingInitialInput = initialInput ? {
      pendingInitialInputMode: initialInputMode || 'unknown',
      pendingInitialInputBytes: initialInput.length,
      pendingInitialInputAt: new Date().toISOString(),
    } : {};
    persistSession(absRoot, updated, { hint: updated.blockedHint || runtimeInfo.hint, ...pendingInitialInput });
    if (attachGraphNode) ensureRuntimeSessionGraphNode(absRoot, updated);
    appendSessionEvent(absRoot, updated, { type: 'session.blocked', reason: updated.blockedReason, hint: updated.blockedHint || runtimeInfo.hint });
    if (initialInput) {
      appendSessionEvent(absRoot, updated, {
        type: 'terminal.input.pending',
        mode: initialInputMode || 'unknown',
        bytes: initialInput.length,
        intent: 'explicit-initial-input',
        reason: updated.blockedReason,
      });
    }
    return updated;
  }

  // Chat mode: same node semantics, but the runtime is spawned through a
  // structured-stdio chat driver instead of a PTY. TUI ready-gating and
  // initial typing are skipped — the initial input rides driver.send after
  // session_ready (or the fallback timeout).
  if (session.uiMode === 'chat') {
    return spawnChatRuntimeSession({
      sr,
      absRoot,
      payload,
      session,
      runtime,
      runtimeInfo,
      resumeArgs,
      claudeAgentSessionId,
      isClaudeRuntime,
      model,
      cwd,
      initialInput,
      attachGraphNode,
    });
  }

  const spawned = await ptySpawnGate(() => spawnPty({
    runtime,
    taskId,
    peerId: session.peerId,
    sessionId: session.sessionId,
    command: runtimeInfo.path || runtimeInfo.command,
    commandArgs: resumeArgs,
    agentSessionId: isClaudeRuntime && resumeArgs.length === 0 ? claudeAgentSessionId : undefined,
    model,
    initialPrompt,
    launchPolicy: session.launchPolicy,
    controlPlaneUrl: cleanString(payload.controlPlaneUrl, ''),
    controlPlaneToken: cleanString(payload.controlPlaneToken, ''),
    projectRoot: absRoot,
    cwd,
    agentKind: session.agentKind,
    workflowMode: session.workflowMode,
    subagentMode: session.subagentMode,
    graphNodeId: session.graphNodeId,
    graphContextPath: session.graphContextPath,
    nodeHomePath: session.nodeHomePath,
    nodeInitPath: session.nodeInitPath,
    cols: session.cols,
    rows: session.rows,
    onData: (data) => {
      if (terminalReadyForInitialInput(data, runtime)) {
        scheduleInitialInput('terminal-ready');
        markTerminalReady(session.sessionId);
        markAgentNodeTerminalReady(session.sessionId);
      }
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
      if (!current) return;
      if (requestEvent.type === 'codex:update-prompt') {
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
        return;
      }
      if (requestEvent.type === 'codex:rollout-id') {
        const rolloutId = String(requestEvent.payload?.rolloutId || '').trim();
        if (!rolloutId) return;
        sr.update(session.sessionId, { agentSessionId: rolloutId });
        const updated = sr.get(session.sessionId);
        if (!updated) return;
        // codexRolloutId is not part of the registry schema yet, so it is set
        // directly (sr.update only merges known keys); persistSession writes it
        // to the session STATE.json record.
        updated.codexRolloutId = rolloutId;
        persistSession(absRoot, updated);
        appendSessionEvent(absRoot, updated, {
          type: 'codex.rollout-id.captured',
          codexRolloutId: rolloutId,
        });
        terminalHub?.broadcastToSession?.(session.sessionId, {
          type: 'codex:rollout-id:captured',
          sessionId: session.sessionId,
          codexRolloutId: rolloutId,
        });
        return;
      }
      if (requestEvent.type === 'opencode:session-id') {
        const opencodeSessionId = String(requestEvent.payload?.sessionId || '').trim();
        if (!opencodeSessionId) return;
        sr.update(session.sessionId, { agentSessionId: opencodeSessionId });
        const updated = sr.get(session.sessionId);
        if (!updated) return;
        // Mirrors the codex:rollout-id handling: sr.update persists the
        // registry field and the direct set + persistSession lands it on the
        // session STATE.json record.
        updated.agentSessionId = opencodeSessionId;
        persistSession(absRoot, updated);
        appendSessionEvent(absRoot, updated, {
          type: 'opencode.session-id.captured',
          agentSessionId: opencodeSessionId,
        });
        terminalHub?.broadcastToSession?.(session.sessionId, {
          type: 'opencode:session-id:captured',
          sessionId: session.sessionId,
          agentSessionId: opencodeSessionId,
        });
        return;
      }
    },
    onExit: ({ exitCode, signal }) => {
      const handleExit = () => {
        flushTerminalBuffer(absRoot, session.sessionId);
        if (!sr.get(session.sessionId)) {
          unregisterPtyProcess(session.sessionId);
          clearTerminalState(session.sessionId);
          clearAgentNodeTerminalState(session.sessionId);
          return;
        }
        // Early-exit fallback: if the PTY exited within 8s of spawn AND this
        // was a resume attempt, retry once without resume args. This handles
        // "No conversation found with session ID" from Claude Code when the
        // conversation store has been cleaned.
        const earlyExitMs = Date.now() - spawnedAt;
        if (resumeArgs.length > 0 && earlyExitMs < 8000 && !session._resumeFallbackAttempted) {
          session._resumeFallbackAttempted = true;
          sr.update(session.sessionId, { status: 'starting' });
          persistSession(absRoot, sr.get(session.sessionId));
          appendSessionEvent(absRoot, sr.get(session.sessionId), {
            type: 'session.resume-fallback',
            reason: 'early-exit-after-resume',
            earlyExitMs,
            exitCode,
          });
          unregisterPtyProcess(session.sessionId);
          clearTerminalState(session.sessionId);
          clearAgentNodeTerminalState(session.sessionId);
          // Respawn without resume args
          ptySpawnGate(() => spawnPty({
            runtime,
            taskId,
            peerId: session.peerId,
            sessionId: session.sessionId,
            command: runtimeInfo.path || runtimeInfo.command,
            commandArgs: [],
            agentSessionId: isClaudeRuntime ? (claudeAgentSessionId || crypto.randomUUID()) : undefined,
            model,
            initialPrompt,
            launchPolicy: session.launchPolicy,
            controlPlaneUrl: cleanString(payload.controlPlaneUrl, ''),
            controlPlaneToken: cleanString(payload.controlPlaneToken, ''),
            projectRoot: absRoot,
            cwd,
            agentKind: session.agentKind,
            workflowMode: session.workflowMode,
            subagentMode: session.subagentMode,
            graphNodeId: session.graphNodeId,
            graphContextPath: session.graphContextPath,
            nodeHomePath: session.nodeHomePath,
            nodeInitPath: session.nodeInitPath,
            cols: session.cols,
            rows: session.rows,
            onData: (data) => {
              if (terminalReadyForInitialInput(data, runtime)) {
                markTerminalReady(session.sessionId);
                markAgentNodeTerminalReady(session.sessionId);
              }
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
            onExit: ({ exitCode: retryExitCode, signal: retrySignal }) => {
              flushTerminalBuffer(absRoot, session.sessionId);
              if (!sr.get(session.sessionId)) {
                unregisterPtyProcess(session.sessionId);
                clearTerminalState(session.sessionId);
                clearAgentNodeTerminalState(session.sessionId);
                return;
              }
              sr.update(session.sessionId, { status: 'exited', exitCode: retryExitCode });
              const current = sr.get(session.sessionId);
              persistSession(absRoot, current, { signal: retrySignal });
              appendSessionEvent(absRoot, current, { type: 'session.exited', exitCode: retryExitCode, signal: retrySignal });
              terminalHub?.broadcastToSession?.(session.sessionId, {
                type: 'session:state',
                sessionId: session.sessionId,
                state: 'exited',
              });
              unregisterPtyProcess(session.sessionId);
              clearTerminalState(session.sessionId);
              clearAgentNodeTerminalState(session.sessionId);
            },
          })).then((retrySpawned) => {
            if (retrySpawned.blocked) {
              sr.update(session.sessionId, { status: 'blocked', blockedReason: retrySpawned.reason });
              persistSession(absRoot, sr.get(session.sessionId));
              return;
            }
            sr.update(session.sessionId, { status: 'running', pid: retrySpawned.pid, ptyProvider: retrySpawned.ptyProvider || null });
            persistSession(absRoot, sr.get(session.sessionId));
            registerPtyProcess(session.sessionId, retrySpawned.ptyProcess);
            trackTerminalSpawn(session.sessionId);
            trackAgentNodeTerminalSpawn(session.sessionId);
          }).catch(() => {
            sr.update(session.sessionId, { status: 'exited', exitCode });
            persistSession(absRoot, sr.get(session.sessionId));
          });
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
        clearTerminalState(session.sessionId);
        clearAgentNodeTerminalState(session.sessionId);
      };
      if (typeof sr.withLock === 'function') {
        sr.withLock(session.sessionId, handleExit).catch(() => unregisterPtyProcess(session.sessionId));
      } else {
        handleExit();
      }
    },
  }));

  if (spawned.blocked) {
    sr.update(session.sessionId, { status: 'blocked', blockedReason: spawned.reason, blockedHint: spawned.hint });
    const updated = sr.get(session.sessionId);
    persistSession(absRoot, updated, { hint: spawned.hint, details: spawned.details || [] });
    if (attachGraphNode) ensureRuntimeSessionGraphNode(absRoot, updated);
    appendSessionEvent(absRoot, updated, {
      type: 'session.blocked',
      reason: spawned.reason,
      hint: spawned.hint,
      details: spawned.details || [],
    });
    return updated;
  }

  const spawnedAt = Date.now();
  sr.update(session.sessionId, { status: 'running', pid: spawned.pid, ptyProvider: spawned.ptyProvider || null });
  const updated = sr.get(session.sessionId);
  persistSession(absRoot, updated);
  if (attachGraphNode) ensureRuntimeSessionGraphNode(absRoot, updated);
  appendSessionEvent(absRoot, updated, { type: 'session.running', pid: spawned.pid, ptyProvider: spawned.ptyProvider || null });
  registerPtyProcess(session.sessionId, spawned.ptyProcess);
  trackTerminalSpawn(session.sessionId);
  trackAgentNodeTerminalSpawn(session.sessionId);
  if (initialInput) {
    setTimeout(() => scheduleInitialInput('fallback-timeout', 0), INITIAL_INPUT_FALLBACK_DELAY_MS);
    appendTerminalData(absRoot, updated, initialInput, 'stdin');
    appendSessionEvent(absRoot, updated, {
      type: 'terminal.input.injected',
      mode: initialInputMode || 'unknown',
      bytes: initialInput.length,
      delayed: true,
      schedule: 'terminal-ready-or-fallback',
      fallbackDelayMs: INITIAL_INPUT_FALLBACK_DELAY_MS,
    });
  }
  return updated;
}

// ── Chat-mode spawn path ──
// Mirrors the PTY spawn bookkeeping (status transitions, persistence, graph
// attach, events) but launches through chat-driver on structured stdio with
// TERM=dumb identity env. No TUI ready-gating: initial input is sent via
// driver.send once session_ready arrives, or after the fallback timeout.
async function spawnChatRuntimeSession({
  sr,
  absRoot,
  payload,
  session,
  runtime,
  runtimeInfo,
  resumeArgs,
  claudeAgentSessionId,
  isClaudeRuntime,
  model,
  cwd,
  initialInput,
  attachGraphNode,
}) {
  const launchArgs = [
    ...resolveRuntimeLaunchArgs(runtime, { model, launchPolicy: session.launchPolicy }),
    ...resumeArgs,
  ];
  if (isClaudeRuntime && resumeArgs.length === 0 && claudeAgentSessionId) {
    launchArgs.push('--session-id', String(claudeAgentSessionId));
  }
  const env = buildHarnessEnvSession({
    runtime,
    agentKind: session.agentKind,
    workflowMode: session.workflowMode,
    graphNodeId: session.graphNodeId,
    graphContextPath: session.graphContextPath,
    nodeHomePath: session.nodeHomePath,
    nodeInitPath: session.nodeInitPath,
    subagentMode: session.subagentMode,
    controlPlaneUrl: cleanString(payload.controlPlaneUrl, ''),
    taskId: session.taskId || '',
    peerId: session.peerId,
    sessionId: session.sessionId,
  }, { term: 'dumb' });

  let initialInputSent = false;
  let fallbackTimer = null;
  const sendInitialInput = (reason) => {
    if (!initialInput || initialInputSent) return;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    initialInputSent = true;
    const current = sr.get(session.sessionId);
    if (!current) return;
    appendTerminalData(absRoot, current, initialInput, 'stdin');
    appendSessionEvent(absRoot, current, { type: 'chat.initial-input.sent', reason, bytes: initialInput.length });
    sendToChatDriver(session.sessionId, initialInput, {});
  };
  if (initialInput) {
    fallbackTimer = setTimeout(() => sendInitialInput('fallback-timeout'), INITIAL_INPUT_FALLBACK_DELAY_MS);
    fallbackTimer.unref?.();
  }

  let startedHandle = null;
  try {
    startedHandle = await ptySpawnGate(async () => {
      const driver = await createChatDriver(runtime, {
        sessionId: session.sessionId,
        session: { sessionId: session.sessionId, taskId: session.taskId || null, runtime },
        projectRoot: absRoot,
        command: runtimeInfo.path || runtimeInfo.command || '',
        args: launchArgs,
        cwd,
        env,
        model,
        providerSessionId: session.agentSessionId || '',
        onSessionReady: (providerSessionId) => {
          // Same pattern as the codex/opencode agentSessionId capture:
          // registry field + direct set + persistSession lands it on disk.
          const current = sr.get(session.sessionId);
          if (!current) return;
          const resolvedProviderSessionId = cleanString(providerSessionId, '') || current.providerSessionId || null;
          sr.update(current.sessionId, { providerSessionId: resolvedProviderSessionId });
          const updated = sr.get(current.sessionId);
          if (!updated) return;
          updated.agentSessionId = updated.providerSessionId || updated.agentSessionId;
          persistSession(absRoot, updated);
          try { writeNodeHome(absRoot, updated, loadWorkflowGraphMap(absRoot)); } catch { /* node-home refresh stays best-effort */ }
          appendSessionEvent(absRoot, updated, { type: 'chat.provider-session.ready', providerSessionId: updated.providerSessionId });
          sendInitialInput('session-ready');
        },
        onEnded: () => {
          const current = sr.get(session.sessionId);
          if (!current || ['exited', 'stopped', 'blocked'].includes(current.status)) return;
          sr.update(current.sessionId, { status: 'exited' });
          const updated = sr.get(current.sessionId);
          if (!updated) return;
          persistSession(absRoot, updated);
          appendSessionEvent(absRoot, updated, { type: 'session.exited', reason: 'chat-driver-ended' });
        },
      });
      const started = await driver.start();
      return { driver, pid: Number(started?.pid) || null };
    });
  } catch (err) {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    sr.update(session.sessionId, { status: 'blocked', blockedReason: 'chat-driver-spawn-failed', blockedHint: String(err?.message || err) });
    const updated = sr.get(session.sessionId);
    persistSession(absRoot, updated, { hint: updated.blockedHint });
    if (attachGraphNode) ensureRuntimeSessionGraphNode(absRoot, updated);
    appendSessionEvent(absRoot, updated, {
      type: 'session.blocked',
      reason: 'chat-driver-spawn-failed',
      hint: String(err?.message || err),
    });
    return updated;
  }

  sr.update(session.sessionId, { status: 'running', pid: startedHandle.pid, ptyProvider: 'chat-stdio' });
  const updated = sr.get(session.sessionId);
  persistSession(absRoot, updated);
  if (attachGraphNode) ensureRuntimeSessionGraphNode(absRoot, updated);
  appendSessionEvent(absRoot, updated, { type: 'session.running', pid: startedHandle.pid, ptyProvider: 'chat-stdio' });
  trackTerminalSpawn(session.sessionId);
  trackAgentNodeTerminalSpawn(session.sessionId);
  markTerminalReady(session.sessionId);
  markAgentNodeTerminalReady(session.sessionId);
  if (initialInput) {
    appendSessionEvent(absRoot, updated, {
      type: 'chat.initial-input.pending',
      bytes: initialInput.length,
      trigger: 'session-ready-or-fallback',
    });
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

// ── Task group index (startup-only regeneration) ──
// Regenerate Harness/tasks/GROUPS.md once per backend start from the live
// task capsules (group field in STATE.json). Startup-only by design — no
// periodic timer. Any failure is non-fatal (log only): the index is derived,
// regenerable data and must never block the control plane.
async function regenerateTaskGroupIndex(absRoot) {
  try {
    const { scanTaskGroups, renderGroupsMd } = await import('../../Harness/scripts/task-group-index.mjs');
    const tasksRoot = path.join(absRoot, 'Harness', 'tasks');
    const model = scanTaskGroups({ tasksRoot });
    fs.mkdirSync(tasksRoot, { recursive: true });
    fs.writeFileSync(path.join(tasksRoot, 'GROUPS.md'), renderGroupsMd(model), 'utf8');
  } catch (err) {
    console.error(`[wf-ui] task-group-index generation skipped: ${err?.message || err}`);
  }
}

export function startServer(opts = {}) {
  const projectRoot = canonicalizeProjectPath(opts.projectRoot || process.cwd());
  const host = opts.host || '127.0.0.1';
  const port = opts.port !== undefined ? opts.port : 0;
  const token = opts.token || '';

  const server = createServer({
    projectRoot,
    sessionRegistry: opts.sessionRegistry,
    token,
    terminalHub: opts.terminalHub || null,
    wfBrowserHub: opts.wfBrowserHub || null,
  });
  const cleanupTimer = startCleanupScheduler(projectRoot, opts.sessionRegistry);
  if (cleanupTimer) server.once('close', () => clearInterval(cleanupTimer));
  const eventsWs = opts.eventsWs === false
    ? null
    : attachServerEventsWs(server, token, projectRoot, opts.eventsWsOptions || {});
  const chatWs = opts.chatWs === false
    ? null
    : attachServerChatWs(server, token, projectRoot, opts.sessionRegistry);

  return new Promise((resolve, reject) => {
    server.listen(port, host, async () => {
      const addr = server.address();
      const actualPort = addr.port;
      // Startup-only session state reconciliation: build the in-memory session
      // index (one disk scan) and persist the orphan downgrade for every disk
      // session still marked running/starting from a previous server lifetime.
      try {
        buildSessionIndex(projectRoot);
        const downgraded = persistOrphanDowngradeAtStartup(projectRoot);
        if (downgraded.length > 0) console.log(`[wf-ui] downgraded ${downgraded.length} orphaned live session(s)`);
      } catch (e) {
        console.error('[wf-ui] startup session reconciliation failed:', e?.message || e);
      }
      // Startup-only group-index regeneration (never rejects; log-only on error).
      await regenerateTaskGroupIndex(projectRoot);
      // AC-3 (task-upgrade-file-node W1): watch workspace files bound to file
      // nodes for external edits; broadcast file.changed over WS and persist a
      // session event when the bound node carries a sessionId. The watcher is
      // rebuilt naturally on the next server start.
      attachFileNodeWatcher(server, projectRoot, {
        sessionRegistry: opts.sessionRegistry,
        eventsWs,
      });
      resolve({
        server,
        port: actualPort,
        token,
        url: `http://${host}:${actualPort}/`,
        eventsWs,
      });
    });
    server.on('error', reject);
  });
}

function attachServerEventsWs(server, token, projectRoot, options = {}) {
  if (server[EVENTS_WS_HANDLE]) return server[EVENTS_WS_HANDLE];
  const handle = attachEventsWs(server, token, projectRoot, options);
  server[EVENTS_WS_HANDLE] = handle;
  server.once('close', () => {
    if (server[EVENTS_WS_HANDLE] === handle) {
      server[EVENTS_WS_HANDLE] = null;
      handle.close().catch(() => {});
    }
  });
  return handle;
}

// Chat-mode WS hub (/ws/chat/:sessionId). Attached inside the server module
// (unlike ws-terminal, which the CLI entry attaches) so chat sessions work
// for every startServer consumer; disable with opts.chatWs === false.
function attachServerChatWs(server, token, projectRoot, sessionRegistry) {
  if (server[CHAT_WS_HANDLE]) return server[CHAT_WS_HANDLE];
  const handle = attachChatWs(server, token, sessionRegistry, { projectRoot });
  server[CHAT_WS_HANDLE] = handle;
  server.once('close', () => {
    if (server[CHAT_WS_HANDLE] === handle) {
      server[CHAT_WS_HANDLE] = null;
      handle.close().catch(() => {});
    }
  });
  return handle;
}

// Resolve the session record for a file node change event so the event can be
// persisted to the session log. Component nodes normally carry no sessionId
// (skip), but when a bound node does, prefer the live registry then disk.
function sessionForFileChange(projectRoot, nodeId, sessionRegistry) {
  try {
    const graph = loadWorkflowGraphMap(projectRoot);
    const node = (graph.nodes || []).find(item => (item.nodeId || item.id) === nodeId);
    const sessionId = node && node.sessionId ? String(node.sessionId).trim() : '';
    if (!sessionId) return null;
    const live = sessionRegistry && typeof sessionRegistry.get === 'function'
      ? sessionRegistry.get(sessionId)
      : null;
    if (live) return live;
    const disk = listTerminalSessions(projectRoot).find(item => item.sessionId === sessionId);
    return disk || { sessionId, taskId: null, runtime: '' };
  } catch {
    return null;
  }
}

function attachFileNodeWatcher(server, projectRoot, { sessionRegistry = null, eventsWs = null } = {}) {
  if (server[FILE_WATCHER_HANDLE]) return server[FILE_WATCHER_HANDLE];
  const handle = watchFileNodes(projectRoot, {
    onChange: (event) => {
      // WS broadcast to every connected /ws/events client (AC-3).
      if (eventsWs && typeof eventsWs.broadcast === 'function') {
        eventsWs.broadcast('file.changed', {
          nodeId: event.nodeId,
          path: event.path,
          etag: event.etag,
        });
      }
      // Durable copy in the bound session's event log when one exists.
      const session = sessionForFileChange(projectRoot, event.nodeId, sessionRegistry);
      if (session) {
        appendSessionEvent(projectRoot, session, {
          type: 'file.changed',
          nodeId: event.nodeId,
          path: event.path,
          etag: event.etag,
        });
      }
      // Component file nodes carry no sessionId (D6): persist to a dedicated
      // project-level log so the event is durable regardless of binding.
      try {
        const logPath = path.join(projectRoot, 'Harness', 'a2a', 'events', 'file-changed.jsonl');
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(
          logPath,
          `${JSON.stringify({ ts: new Date().toISOString(), nodeId: event.nodeId, path: event.path, etag: event.etag })}\n`,
          'utf8',
        );
      } catch {
        /* best-effort durable copy */
      }
    },
  });
  server[FILE_WATCHER_HANDLE] = handle;
  server.once('close', () => {
    if (server[FILE_WATCHER_HANDLE] === handle) {
      server[FILE_WATCHER_HANDLE] = null;
      try {
        handle.stop();
      } catch {
        /* ignore */
      }
    }
  });
  return handle;
}

export function stopServer(server) {
  return new Promise((resolve, reject) => {
    Promise.resolve()
      .then(async () => {
        // Teardown (F4): the bounded timer wakeup scheduler must stop with the
        // server so no interval handle outlives the close.
        stopTimerScheduler();
        const eventsWs = server?.[EVENTS_WS_HANDLE];
        if (eventsWs) {
          server[EVENTS_WS_HANDLE] = null;
          await eventsWs.close();
        }
        const chatWs = server?.[CHAT_WS_HANDLE];
        if (chatWs) {
          server[CHAT_WS_HANDLE] = null;
          await chatWs.close();
        }
        const fileWatcher = server?.[FILE_WATCHER_HANDLE];
        if (fileWatcher) {
          server[FILE_WATCHER_HANDLE] = null;
          try {
            fileWatcher.stop();
          } catch {
            /* ignore */
          }
        }
        if (!server || !server.listening) return resolve();
        server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      })
      .catch(reject);
  });
}

/** Expose debug state for external readers (WS modules, etc.) */
export function getDebugState() { return debugState; }
