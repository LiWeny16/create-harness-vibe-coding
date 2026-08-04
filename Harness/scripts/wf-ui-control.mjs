#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

function print(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function readJson(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
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
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

function allSessionDirs(projectRoot) {
  const out = [];
  const pushSessions = (root, taskId = null) => {
    let sessions = [];
    try { sessions = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
    for (const session of sessions) {
      if (session.isDirectory()) out.push({ taskId, sessionId: session.name, dir: path.join(root, session.name) });
    }
  };
  const tasksRoot = path.join(projectRoot, 'Harness', 'tasks');
  let tasks = [];
  try { tasks = fs.readdirSync(tasksRoot, { withFileTypes: true }); } catch { tasks = []; }
  for (const task of tasks) {
    if (task.isDirectory() && !task.name.startsWith('_')) {
      pushSessions(path.join(tasksRoot, task.name, 'sessions'), task.name);
    }
  }
  pushSessions(path.join(projectRoot, 'Harness', 'a2a', 'sessions'), null);
  return out;
}

function localSnapshot(projectRoot) {
  const mapPath = process.env.HARNESS_WORKFLOW_MAP || path.join(projectRoot, 'Harness', 'a2a', 'workflow-map.json');
  const graph = readJson(mapPath, { schemaVersion: 1, version: 1, nodes: [], edges: [] });
  const sessions = allSessionDirs(projectRoot)
    .map(({ dir }) => readJson(path.join(dir, 'STATE.json')))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return {
    source: 'local-files',
    self: selfContext(),
    graph,
    nodes: graph.nodes || [],
    edges: graph.edges || [],
    sessions,
  };
}

function selfContext() {
  return {
    sessionId: process.env.HARNESS_PEER_SESSION_ID || '',
    peerRuntime: process.env.HARNESS_PEER_RUNTIME || '',
    agentKind: process.env.HARNESS_AGENT_KIND || '',
    workflowMode: process.env.HARNESS_WORKFLOW_MODE || '',
    nodeId: process.env.HARNESS_WORKFLOW_NODE_ID || '',
    mapPath: process.env.HARNESS_WORKFLOW_MAP || '',
    hasControlToken: Boolean(process.env.HARNESS_WF_UI_TOKEN || process.env.WF_UI_TOKEN),
    hasReadToken: Boolean(process.env.HARNESS_WF_UI_READ_TOKEN || process.env.WF_UI_READ_TOKEN),
  };
}

function controlPlane(flags) {
  return {
    url: flags.url || process.env.HARNESS_WF_UI_URL || process.env.WF_UI_URL || '',
    token: flags.token || process.env.HARNESS_WF_UI_TOKEN || process.env.WF_UI_TOKEN || '',
    readToken: flags['read-token'] || process.env.HARNESS_WF_UI_READ_TOKEN || process.env.WF_UI_READ_TOKEN || '',
  };
}

function apiJson(baseUrl, token, route, { method = 'GET', body = null, actorSessionId = '' } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        Authorization: `Bearer ${token}`,
        ...(actorSessionId ? { 'X-Harness-Session-Id': actorSessionId } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : null; } catch {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function snapshot(projectRoot, flags) {
  const cp = controlPlane(flags);
  if (cp.url && cp.token) return apiJson(cp.url, cp.token, '/api/a2a/snapshot');
  if (cp.url && cp.readToken) {
    return apiJson(cp.url, cp.readToken, '/api/a2a/snapshot', {
      actorSessionId: process.env.HARNESS_PEER_SESSION_ID || '',
    });
  }
  return localSnapshot(projectRoot);
}

function describeSnapshot(data) {
  const self = data.self || selfContext();
  const nodes = data.nodes || data.graph?.nodes || [];
  const edges = data.edges || data.graph?.edges || [];
  const sessions = data.sessions || [];
  const selfNodeIds = new Set([
    self.nodeId,
    self.sessionId ? `session-${self.sessionId}` : '',
  ].filter(Boolean));
  for (const node of nodes) {
    if (node.sessionId === self.sessionId || node.graphNodeId === self.nodeId || node.nodeId === self.nodeId) {
      selfNodeIds.add(node.id || node.nodeId || node.graphNodeId);
      if (node.graphNodeId) selfNodeIds.add(node.graphNodeId);
    }
  }
  const connectedEdges = edges.filter(edge =>
    selfNodeIds.has(edge.from) || selfNodeIds.has(edge.to) || selfNodeIds.has(edge.source) || selfNodeIds.has(edge.target)
  );
  return {
    self,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      sessions: sessions.length,
      runningSessions: sessions.filter(session => session.status === 'running' || session.status === 'starting').length,
    },
    nodes: nodes.map(node => ({
      id: node.id || node.nodeId,
      sessionId: node.sessionId,
      label: node.label,
      agentKind: node.agentKind,
      runtime: node.runtime,
      status: node.status,
      role: node.role,
    })),
    connectedEdges,
  };
}

function assertMainAgent(flags, action = 'create-agent') {
  const actorKind = flags['actor-kind'] || process.env.HARNESS_AGENT_KIND || '';
  if (actorKind !== 'main') {
    throw new Error(`${action} is only available to Main Agent nodes. Subagents can read the workflow map but cannot create or control nodes.`);
  }
}

async function createAgent(projectRoot, flags) {
  assertMainAgent(flags, 'create-agent');
  const cp = controlPlane(flags);
  if (!cp.url || !cp.token) throw new Error('Missing HARNESS_WF_UI_URL/HARNESS_WF_UI_TOKEN for agent control.');
  const agentKind = flags['agent-kind'] || 'subagent';
  const runtime = flags.runtime || process.env.HARNESS_PEER_RUNTIME || 'claude';
  const body = {
    runtime,
    agentKind,
    role: flags.role || (agentKind === 'main' ? 'Main Agent' : 'Subagent'),
    objective: flags.objective || 'Spawned by Harness Workflow Main Agent',
    workflowMode: flags.mode || process.env.HARNESS_WORKFLOW_MODE || 'wf',
    cwd: flags.cwd || projectRoot,
    model: flags.model || '',
    provider: flags.provider || '',
    parentAgentId: flags.parent || process.env.HARNESS_PEER_SESSION_ID || null,
    parentNodeId: flags['parent-node'] || process.env.HARNESS_WORKFLOW_NODE_ID || null,
    launchPolicy: {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
    },
  };
  return apiJson(cp.url, cp.token, '/api/sessions', { method: 'POST', body });
}

async function sendInput(flags) {
  assertMainAgent(flags, 'send-input');
  const cp = controlPlane(flags);
  if (!cp.url || !cp.token) throw new Error('Missing HARNESS_WF_UI_URL/HARNESS_WF_UI_TOKEN for terminal input.');
  if (!flags.session) throw new Error('Missing --session <sessionId>.');
  const raw = flags.raw === 'true';
  const text = flags.text || '';
  const data = raw || /[\r\n]$/.test(text) ? text : `${text}\r`;
  const actorSessionId = flags.from || flags['from-session'] || process.env.HARNESS_PEER_SESSION_ID || '';
  return apiJson(cp.url, cp.token, `/api/sessions/${encodeURIComponent(flags.session)}/input`, {
    method: 'POST',
    actorSessionId,
    body: {
      data,
      fromSessionId: actorSessionId,
      fromNodeId: flags['from-node'] || process.env.HARNESS_WORKFLOW_NODE_ID || '',
      source: 'wf-ui-control.send-input',
    },
  });
}

async function bridgeMessages(flags) {
  const cp = controlPlane(flags);
  if (!cp.url || !cp.token) throw new Error('Missing HARNESS_WF_UI_URL/HARNESS_WF_UI_TOKEN for bridge messages.');
  const fromSessionId = flags.from || flags['from-session'] || process.env.HARNESS_PEER_SESSION_ID || '';
  const toSessionId = flags.to || flags.session || flags['to-session'] || '';
  if (!fromSessionId) throw new Error('Missing --from <sessionId> or HARNESS_PEER_SESSION_ID.');
  if (!toSessionId) throw new Error('Missing --to <sessionId> or --session <sessionId>.');
  const limit = flags.limit || flags.tail || 200;
  return apiJson(cp.url, cp.token, `/api/a2a/bridge-messages?fromSessionId=${encodeURIComponent(fromSessionId)}&toSessionId=${encodeURIComponent(toSessionId)}&limit=${encodeURIComponent(limit)}`);
}

function wfBrowserControlPlane(flags) {
  const cp = controlPlane(flags);
  if (!cp.url || !cp.token) throw new Error('Missing HARNESS_WF_UI_URL/HARNESS_WF_UI_TOKEN for wf-browser control.');
  return cp;
}

const DEFAULT_BROWSER_SNAPSHOT_PRIMITIVES = [
  'observe.route',
  'observe.capabilities',
  'observe.uiTree',
  'observe.state',
  'observe.logs',
  'observe.network',
  'observe.replay',
  'observe.diff',
];

function trueFlag(value) {
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

function listFlag(value) {
  return String(value || '')
    .split(/[,\n;]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function pickIndexed(values, index, fallback = '') {
  if (!values.length) return fallback;
  return values[index] || values[values.length - 1] || fallback;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(numeric, min), max);
}

function safePathSegment(value, fallback = 'item') {
  const text = String(value || fallback)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');
  return text || fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function openLocalUrl(url) {
  if (!url) return false;
  let command;
  let args;
  if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return true;
}

function existingFile(candidate) {
  try {
    return candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function browserCandidates(kind) {
  const browser = String(kind || 'chrome').toLowerCase();
  const candidates = [];
  const push = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  if (process.platform === 'win32') {
    const programFiles = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    if (browser === 'edge' || browser === 'msedge') {
      for (const root of programFiles) push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    } else if (browser === 'chromium') {
      for (const root of programFiles) push(path.join(root, 'Chromium', 'Application', 'chrome.exe'));
    } else {
      for (const root of programFiles) push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      for (const root of programFiles) push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    if (browser === 'edge' || browser === 'msedge') {
      push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    } else if (browser === 'chromium') {
      push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    } else {
      push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
      push('/Applications/Chromium.app/Contents/MacOS/Chromium');
      push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    }
  } else {
    if (browser === 'edge' || browser === 'msedge') {
      push('/usr/bin/microsoft-edge');
      push('/usr/bin/microsoft-edge-stable');
    } else if (browser === 'chromium') {
      push('/usr/bin/chromium');
      push('/usr/bin/chromium-browser');
    } else {
      push('/usr/bin/google-chrome');
      push('/usr/bin/google-chrome-stable');
      push('/usr/bin/chromium');
      push('/usr/bin/chromium-browser');
      push('/usr/bin/microsoft-edge');
      push('/usr/bin/microsoft-edge-stable');
    }
  }
  return candidates;
}

function resolveBrowserExecutable(flags) {
  const explicit = flags.browserCommand || flags['browser-command'] || flags.browserPath || flags['browser-path'] || process.env.HARNESS_WF_BROWSER_BROWSER || '';
  if (explicit) return { command: explicit, source: 'explicit', candidates: [] };
  const candidates = browserCandidates(flags.browser || 'chrome');
  const found = candidates.find(existingFile);
  return {
    command: found || '',
    source: found ? 'detected' : 'missing',
    candidates,
  };
}

function browserProfileDir(projectRoot, runId, windowId, flags) {
  const explicit = flags.profileDir || flags['profile-dir'] || '';
  if (explicit) return path.resolve(projectRoot, explicit);
  return path.join(
    projectRoot,
    'Harness',
    'wf-browser',
    'tmp',
    'browser-profiles',
    safePathSegment(runId, 'run'),
    safePathSegment(windowId, 'window')
  );
}

function browserOpenArgs({ launchUrl, profileDir, context, width, height, flags }) {
  const args = [
    '--new-window',
    '--no-first-run',
    '--disable-default-apps',
    '--disable-background-mode',
  ];
  if (context === 'isolated') args.push(`--user-data-dir=${profileDir}`);
  if (width && height) args.push(`--window-size=${width},${height}`);
  if (trueFlag(flags.app)) args.push(`--app=${launchUrl}`);
  else args.push(launchUrl);
  return args;
}

function shouldUseBrowserOpen(flags) {
  return Boolean(
    flags.context
    || flags['browser-context']
    || flags.browser
    || flags.browserCommand
    || flags['browser-command']
    || flags.browserPath
    || flags['browser-path']
    || flags.profileDir
    || flags['profile-dir']
    || trueFlag(flags.isolated)
    || trueFlag(flags.dryRun)
  );
}

function nowIso() {
  return new Date().toISOString();
}

function wfBrowserWindowRuntimeDir(projectRoot, runId, windowId) {
  return path.join(
    projectRoot,
    'Harness',
    'wf-browser',
    'runs',
    safePathSegment(runId, 'run'),
    'windows',
    safePathSegment(windowId, 'window')
  );
}

function browserLaunchesPath(projectRoot, runId, windowId) {
  return path.join(wfBrowserWindowRuntimeDir(projectRoot, runId, windowId), 'browser-launches.json');
}

function readBrowserLaunchState(projectRoot, runId, windowId) {
  const data = readJson(browserLaunchesPath(projectRoot, runId, windowId), { schemaVersion: 1, launches: [] });
  return {
    schemaVersion: 1,
    runId,
    windowId,
    updatedAt: data.updatedAt || '',
    launches: Array.isArray(data.launches) ? data.launches : [],
  };
}

function writeBrowserLaunchState(projectRoot, runId, windowId, launches) {
  const filePath = browserLaunchesPath(projectRoot, runId, windowId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const state = {
    schemaVersion: 1,
    runId,
    windowId,
    updatedAt: nowIso(),
    launches,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { state, path: path.relative(projectRoot, filePath).replace(/\\/g, '/') };
}

function upsertBrowserLaunch(projectRoot, launch) {
  const state = readBrowserLaunchState(projectRoot, launch.runId, launch.windowId);
  const launches = state.launches.filter(item => item.launchId !== launch.launchId);
  launches.push(launch);
  launches.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  return writeBrowserLaunchState(projectRoot, launch.runId, launch.windowId, launches);
}

function processAlive(pid) {
  const numericPid = Number(pid || 0);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function closeProcess(pid, { dryRun = false, force = false } = {}) {
  const numericPid = Number(pid || 0);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return { attempted: false, status: 'no-pid', pid: null, aliveBefore: false, aliveAfter: false };
  }
  const aliveBefore = processAlive(numericPid);
  if (dryRun) {
    return { attempted: false, status: 'dry-run', pid: numericPid, aliveBefore, aliveAfter: aliveBefore };
  }
  if (!aliveBefore) {
    return { attempted: false, status: 'already-exited', pid: numericPid, aliveBefore, aliveAfter: false };
  }
  try {
    process.kill(numericPid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (err) {
    return {
      attempted: true,
      status: 'failed',
      pid: numericPid,
      aliveBefore,
      aliveAfter: processAlive(numericPid),
      error: err?.message || 'process kill failed',
    };
  }
  return {
    attempted: true,
    status: 'closed',
    pid: numericPid,
    aliveBefore,
    aliveAfter: processAlive(numericPid),
  };
}

function removeBrowserProfile(projectRoot, profileDir, { dryRun = false } = {}) {
  if (!profileDir) return { attempted: false, removed: false, status: 'no-profile-dir', path: '' };
  const profilesRoot = path.resolve(projectRoot, 'Harness', 'wf-browser', 'tmp', 'browser-profiles');
  const target = path.resolve(profileDir);
  const withinProfiles = target.startsWith(`${profilesRoot}${path.sep}`);
  if (!withinProfiles) {
    return { attempted: false, removed: false, status: 'outside-profile-root', path: target };
  }
  const exists = fs.existsSync(target);
  if (dryRun) return { attempted: false, removed: false, status: 'dry-run', path: target, exists };
  if (!exists) return { attempted: false, removed: false, status: 'missing', path: target, exists: false };
  fs.rmSync(target, { recursive: true, force: true });
  return { attempted: true, removed: true, status: 'removed', path: target, exists: true };
}

function launchIdFromFlags(flags, windowId) {
  return flags.launch || flags.launchId || flags.id || `launch-${Date.now().toString(36)}-${safePathSegment(windowId, 'window')}`;
}

function shouldRemoveBrowserProfile(flags) {
  return trueFlag(flags.removeProfile)
    || trueFlag(flags['remove-profile'])
    || trueFlag(flags.cleanupProfile)
    || trueFlag(flags['cleanup-profile']);
}

function browserLaunchWithRuntime(launch) {
  return {
    ...launch,
    alive: processAlive(launch.pid),
  };
}

function selectBrowserLaunches(launches, flags) {
  const requested = flags.launch || flags.launchId || flags.id || '';
  if (requested) return launches.filter(item => item.launchId === requested);
  if (trueFlag(flags.all)) return launches;
  const reusable = launches.find(item => !new Set(['closed', 'removed']).has(String(item.status || '')));
  return reusable ? [reusable] : [];
}

async function browserRuns(flags) {
  const cp = wfBrowserControlPlane(flags);
  const limit = flags.limit || 20;
  return apiJson(cp.url, cp.token, `/api/wf-browser/runs?limit=${encodeURIComponent(limit)}`);
}

async function browserRun(flags) {
  const cp = wfBrowserControlPlane(flags);
  return apiJson(cp.url, cp.token, '/api/wf-browser/runs', {
    method: 'POST',
    body: {
      runId: flags.run || flags.runId || undefined,
      mode: flags.mode || 'mixed',
      agentId: flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown',
      sessionId: flags.session || process.env.HARNESS_PEER_SESSION_ID || '',
      taskId: flags.task || flags.taskId || '',
      route: flags.route || '',
      objective: flags.objective || '',
      readinessBefore: flags['readiness-before'] || '',
      readinessAfter: flags['readiness-after'] || '',
    },
  });
}

async function browserWindow(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  return apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows`, {
    method: 'POST',
    body: {
      windowId: flags.window || flags.windowId || undefined,
      agentId: flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown',
      sessionId: flags.session || process.env.HARNESS_PEER_SESSION_ID || '',
      route: flags.route || '',
      viewport: {
        width: flags.width ? Number(flags.width) : undefined,
        height: flags.height ? Number(flags.height) : undefined,
      },
    },
  });
}

async function browserWindows(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  return apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows`);
}

async function browserLease(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  return apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/lease`, {
    method: 'POST',
    body: {
      leaseId: flags.lease || flags.leaseId || undefined,
      type: flags.type || 'control',
      agentId: flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown',
      sessionId: flags.session || process.env.HARNESS_PEER_SESSION_ID || '',
      reason: flags.reason || '',
      ttlMs: flags.ttlMs ? Number(flags.ttlMs) : undefined,
    },
  });
}

async function browserUrl(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  const params = new URLSearchParams();
  const leaseId = flags.lease || flags.leaseId || process.env.HARNESS_WF_BROWSER_LEASE_ID || '';
  if (leaseId) params.set('leaseId', leaseId);
  if (flags.agent || flags.agentId) params.set('agentId', flags.agent || flags.agentId);
  if (flags.route) params.set('route', flags.route);
  if (flags.debug === 'false' || flags.debug === '0') params.set('debug', '0');
  const query = params.toString();
  const result = await apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/launch-url${query ? `?${query}` : ''}`);
  return {
    ...result,
    opened: trueFlag(flags.open) ? openLocalUrl(result.launchUrl) : false,
  };
}

async function browserOpen(flags, options = {}) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  const projectRoot = path.resolve(flags.project || process.cwd());
  const directCommand = options.directCommand !== false;
  const context = String(flags.context || flags['browser-context'] || (trueFlag(flags.isolated) || directCommand ? 'isolated' : 'default')).toLowerCase();
  if (!new Set(['default', 'isolated']).has(context)) {
    throw new Error('Invalid --context; expected default or isolated.');
  }
  const urlResult = flags.url
    ? { ok: true, launchUrl: flags.url, runId, windowId, leaseId: flags.lease || flags.leaseId || '' }
    : await browserUrl({ ...flags, run: runId, window: windowId, open: 'false' });
  const launchUrl = urlResult.launchUrl;
  const dryRun = trueFlag(flags.dryRun) || trueFlag(flags['dry-run']);
  const width = flags.width ? Number(flags.width) : undefined;
  const height = flags.height ? Number(flags.height) : undefined;
  const launchId = launchIdFromFlags(flags, windowId);
  const startedAt = new Date().toISOString();
  let opened = false;
  let pid = null;
  let command = '';
  let args = [];
  let profileDir = '';
  let resolver = { source: 'system-default', candidates: [] };

  if (context === 'default' || String(flags.browser || '').toLowerCase() === 'default') {
    if (!dryRun) opened = openLocalUrl(launchUrl);
  } else {
    profileDir = browserProfileDir(projectRoot, runId, windowId, flags);
    fs.mkdirSync(profileDir, { recursive: true });
    resolver = resolveBrowserExecutable(flags);
    command = resolver.command;
    if (!command) {
      throw new Error(`Unable to locate Chrome/Edge/Chromium for isolated browser context. Pass --browser-command <path>. Checked: ${resolver.candidates.join(', ')}`);
    }
    args = browserOpenArgs({ launchUrl, profileDir, context, width, height, flags });
    if (!dryRun) {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      opened = true;
      pid = child.pid || null;
    }
  }

  const launch = {
    ok: true,
    launchId,
    runId,
    windowId,
    leaseId: urlResult.leaseId || flags.lease || flags.leaseId || '',
    agentId: flags.agent || flags.agentId || '',
    context,
    isolated: context === 'isolated',
    launchUrl,
    opened,
    dryRun,
    status: dryRun ? 'prepared' : (opened ? 'open' : 'not-opened'),
    pid,
    command,
    args,
    profileDir,
    resolver,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  if (flags['no-artifact'] !== 'true') {
    const artifact = await apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/artifacts`, {
      method: 'POST',
      body: {
        type: 'analysis',
        name: `browser-launch-${Date.now().toString(36)}.json`,
        label: 'browser.open',
        json: launch,
      },
    });
    launch.artifact = artifact.artifact || null;
  }
  const launchState = upsertBrowserLaunch(projectRoot, launch);
  launch.statePath = launchState.path;
  if (trueFlag(flags.wait) && !dryRun) {
    launch.connection = (await browserWait({
      ...flags,
      run: runId,
      window: windowId,
      agent: launch.agentId,
    })).connection;
    const updatedLaunchState = upsertBrowserLaunch(projectRoot, launch);
    launch.statePath = updatedLaunchState.path;
  }
  return launch;
}

function matchingWfBrowserConnection(connections, { runId, windowId, agentId = '' } = {}) {
  return (connections || []).find(item =>
    item.runId === runId
    && item.windowId === windowId
    && (!agentId || item.agentId === agentId)
  ) || null;
}

async function browserWait(flags) {
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  const agentId = flags.agent || flags.agentId || '';
  const timeoutMs = boundedNumber(flags.timeout || flags.timeoutMs || flags['wait-timeout'] || flags.waitTimeout, 10000, 250, 120000);
  const intervalMs = boundedNumber(flags.interval || flags.intervalMs, 250, 50, 5000);
  const startedAtMs = Date.now();
  let attempts = 0;
  let lastConnections = [];
  while (Date.now() - startedAtMs <= timeoutMs) {
    attempts += 1;
    const result = await browserConnections(flags);
    lastConnections = result.connections || [];
    const connection = matchingWfBrowserConnection(lastConnections, { runId, windowId, agentId });
    if (connection) {
      return {
        ok: true,
        runId,
        windowId,
        agentId,
        connection,
        attempts,
        waitedMs: Date.now() - startedAtMs,
      };
    }
    await sleep(intervalMs);
  }
  throw new Error(`wf-browser window did not connect within ${timeoutMs}ms: ${runId}/${windowId}${agentId ? ` agent=${agentId}` : ''}`);
}

async function browserAllocate(flags) {
  const cp = wfBrowserControlPlane(flags);
  let runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  let run = null;
  if (!runId) {
    const createdRun = await browserRun(flags);
    run = createdRun.run;
    runId = run.runId;
  }
  const windowResult = await apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows`, {
    method: 'POST',
    body: {
      windowId: flags.window || flags.windowId || undefined,
      agentId: flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown',
      sessionId: flags.session || process.env.HARNESS_PEER_SESSION_ID || '',
      route: flags.route || '',
      viewport: {
        width: flags.width ? Number(flags.width) : undefined,
        height: flags.height ? Number(flags.height) : undefined,
      },
    },
  });
  const leaseResult = await apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowResult.window.windowId)}/lease`, {
    method: 'POST',
    body: {
      type: flags.type || 'control',
      agentId: flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown',
      sessionId: flags.session || process.env.HARNESS_PEER_SESSION_ID || '',
      reason: flags.reason || 'allocated by wf-ui-control',
      ttlMs: flags.ttlMs ? Number(flags.ttlMs) : undefined,
    },
  });
  const urlResult = await browserUrl({
    ...flags,
    run: runId,
    window: windowResult.window.windowId,
    lease: leaseResult.lease.leaseId,
    open: 'false',
  });
  let browserLaunch = null;
  let opened = false;
  if (trueFlag(flags.open)) {
    if (shouldUseBrowserOpen(flags)) {
      browserLaunch = await browserOpen({
        ...flags,
        run: runId,
        window: windowResult.window.windowId,
        lease: leaseResult.lease.leaseId,
        agent: leaseResult.lease.agentId,
        url: urlResult.launchUrl,
      }, { directCommand: false });
      opened = browserLaunch.opened;
    } else {
      opened = openLocalUrl(urlResult.launchUrl);
    }
  }
  return {
    ok: true,
    run: run || { runId },
    window: windowResult.window,
    lease: leaseResult.lease,
    debugUrlParams: urlResult.debugUrlParams,
    launchUrl: urlResult.launchUrl,
    opened,
    browserLaunch,
    connection: trueFlag(flags.wait) && !trueFlag(flags.dryRun) && !trueFlag(flags['dry-run']) ? (await browserWait({
      ...flags,
      run: runId,
      window: windowResult.window.windowId,
      agent: leaseResult.lease.agentId,
    })).connection : null,
  };
}

async function browserAllocateMany(flags) {
  const agents = listFlag(flags.agents || flags.agentIds);
  const routes = listFlag(flags.routes);
  const sessions = listFlag(flags.sessions || flags.sessionIds);
  const windows = listFlag(flags.windows || flags.windowIds);
  const requestedCount = Number(flags.count || Math.max(agents.length, routes.length, sessions.length, windows.length, 1));
  const count = Math.min(Math.max(Number.isFinite(requestedCount) ? requestedCount : 1, 1), 50);
  let runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  let run = null;
  if (!runId) {
    const createdRun = await browserRun({
      ...flags,
      agent: pickIndexed(agents, 0, flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown'),
      session: pickIndexed(sessions, 0, flags.session || process.env.HARNESS_PEER_SESSION_ID || ''),
      route: pickIndexed(routes, 0, flags.route || ''),
    });
    run = createdRun.run;
    runId = run.runId;
  }

  const allocations = [];
  for (let index = 0; index < count; index += 1) {
    const agentId = pickIndexed(agents, index, flags.agent || flags.agentId || `${process.env.HARNESS_PEER_SESSION_ID || 'agent'}-${index + 1}`);
    const sessionId = pickIndexed(sessions, index, flags.session || process.env.HARNESS_PEER_SESSION_ID || '');
    const route = pickIndexed(routes, index, flags.route || '');
    const windowId = pickIndexed(windows, index, '');
    const allocation = await browserAllocate({
      ...flags,
      run: runId,
      window: windowId || undefined,
      agent: agentId,
      session: sessionId,
      route,
      reason: flags.reason || `batch allocation ${index + 1}/${count}`,
    });
    allocations.push({
      index,
      agentId,
      sessionId,
      route,
      run: allocation.run,
      window: allocation.window,
      lease: allocation.lease,
      debugUrlParams: allocation.debugUrlParams,
      launchUrl: allocation.launchUrl,
      opened: allocation.opened,
      browserLaunch: allocation.browserLaunch,
      connection: allocation.connection,
    });
  }

  return {
    ok: true,
    run: run || { runId },
    count: allocations.length,
    allocations,
    windows: allocations.map(item => item.window),
    leases: allocations.map(item => item.lease),
    launchUrls: allocations.map(item => item.launchUrl),
  };
}

async function browserLaunches(flags) {
  const projectRoot = path.resolve(flags.project || process.cwd());
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  const state = readBrowserLaunchState(projectRoot, runId, windowId);
  return {
    ok: true,
    runId,
    windowId,
    updatedAt: state.updatedAt,
    path: path.relative(projectRoot, browserLaunchesPath(projectRoot, runId, windowId)).replace(/\\/g, '/'),
    count: state.launches.length,
    launches: state.launches.map(browserLaunchWithRuntime),
  };
}

async function browserClose(flags) {
  const cp = wfBrowserControlPlane(flags);
  const projectRoot = path.resolve(flags.project || process.cwd());
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  const dryRun = trueFlag(flags.dryRun) || trueFlag(flags['dry-run']);
  const closeReason = flags.reason || 'closed by wf-ui-control';
  const state = readBrowserLaunchState(projectRoot, runId, windowId);
  const selected = selectBrowserLaunches(state.launches, flags);
  if (!selected.length) {
    return {
      ok: true,
      runId,
      windowId,
      path: path.relative(projectRoot, browserLaunchesPath(projectRoot, runId, windowId)).replace(/\\/g, '/'),
      count: 0,
      selectedLaunchIds: [],
      closed: [],
      warning: 'No matching browser launch found.',
    };
  }

  const selectedLaunchIds = new Set(selected.map(item => item.launchId));
  const closed = [];
  const launches = state.launches.map((launch) => {
    if (!selectedLaunchIds.has(launch.launchId)) return launch;
    const closeResult = closeProcess(launch.pid, {
      dryRun,
      force: trueFlag(flags.force),
    });
    const profileCleanup = shouldRemoveBrowserProfile(flags)
      ? removeBrowserProfile(projectRoot, launch.profileDir, { dryRun })
      : null;
    let status = launch.status || 'unknown';
    if (dryRun) status = 'close-dry-run';
    else if (closeResult.status === 'failed') status = 'close-failed';
    else if (profileCleanup?.status === 'outside-profile-root') status = 'cleanup-blocked';
    else status = 'closed';
    const updated = {
      ...launch,
      status,
      closeReason,
      closeResult,
      profileCleanup,
      closedAt: dryRun ? '' : nowIso(),
      updatedAt: nowIso(),
    };
    closed.push(browserLaunchWithRuntime(updated));
    return updated;
  });
  const written = writeBrowserLaunchState(projectRoot, runId, windowId, launches);
  const result = {
    ok: true,
    runId,
    windowId,
    path: written.path,
    count: closed.length,
    selectedLaunchIds: Array.from(selectedLaunchIds),
    closed,
  };
  if (flags['no-artifact'] !== 'true' && cp.url && cp.token) {
    const artifact = await apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/artifacts`, {
      method: 'POST',
      body: {
        type: 'analysis',
        name: `browser-close-${Date.now().toString(36)}.json`,
        label: 'browser.close',
        json: result,
      },
    });
    result.artifact = artifact.artifact || null;
  }
  return result;
}

async function browserRelease(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  const leaseId = flags.lease || flags.leaseId || process.env.HARNESS_WF_BROWSER_LEASE_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  if (!leaseId) throw new Error('Missing --lease <leaseId> or HARNESS_WF_BROWSER_LEASE_ID.');
  const released = await apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/lease/${encodeURIComponent(leaseId)}/release`, {
    method: 'POST',
    body: { reason: flags.reason || 'released' },
  });
  if (!trueFlag(flags.close)) return released;
  const browserCloseResult = await browserClose({
    ...flags,
    run: runId,
    window: windowId,
    lease: leaseId,
    reason: flags.reason || 'released',
  });
  return {
    ...released,
    browserClose: browserCloseResult,
  };
}

async function browserArtifacts(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  return apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/artifacts`);
}

async function browserConnections(flags) {
  const cp = wfBrowserControlPlane(flags);
  return apiJson(cp.url, cp.token, '/api/wf-browser/connections');
}

async function browserCleanup(flags) {
  const cp = wfBrowserControlPlane(flags);
  return apiJson(cp.url, cp.token, '/api/wf-browser/cleanup', {
    method: 'POST',
    body: {
      apply: trueFlag(flags.apply),
      keepLatest: flags.keepLatest || flags['keep-latest'] ? Number(flags.keepLatest || flags['keep-latest']) : undefined,
      maxAgeDays: flags.maxAgeDays || flags['max-age-days'] ? Number(flags.maxAgeDays || flags['max-age-days']) : undefined,
    },
  });
}

function parseJsonFlag(value, fallback = {}) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch {
    throw new Error(`Invalid JSON flag: ${value}`);
  }
}

function browserCommandPayload(flags) {
  const payload = parseJsonFlag(flags.payload || flags.json, {});
  const target = {
    ...(payload.target && typeof payload.target === 'object' ? payload.target : {}),
    ...(flags.selector ? { selector: flags.selector } : {}),
    ...(flags.testid ? { testId: flags.testid } : {}),
    ...(flags['test-id'] ? { testId: flags['test-id'] } : {}),
    ...(flags.role ? { role: flags.role } : {}),
    ...(flags.name ? { name: flags.name } : {}),
    ...(flags.textTarget ? { text: flags.textTarget } : {}),
    ...(flags['text-target'] ? { text: flags['text-target'] } : {}),
  };
  const to = {
    ...(payload.to && typeof payload.to === 'object' ? payload.to : {}),
    ...(payload.destination && typeof payload.destination === 'object' ? payload.destination : {}),
    ...(flags.toSelector ? { selector: flags.toSelector } : {}),
    ...(flags['to-selector'] ? { selector: flags['to-selector'] } : {}),
    ...(flags.toTestid ? { testId: flags.toTestid } : {}),
    ...(flags.toTestId ? { testId: flags.toTestId } : {}),
    ...(flags['to-testid'] ? { testId: flags['to-testid'] } : {}),
    ...(flags['to-test-id'] ? { testId: flags['to-test-id'] } : {}),
    ...(flags.toRole ? { role: flags.toRole } : {}),
    ...(flags['to-role'] ? { role: flags['to-role'] } : {}),
    ...(flags.toName ? { name: flags.toName } : {}),
    ...(flags['to-name'] ? { name: flags['to-name'] } : {}),
  };
  const body = {
    ...payload,
    ...(Object.keys(target).length ? { target } : {}),
    ...(Object.keys(to).length ? { to } : {}),
    ...(flags.text ? { text: flags.text } : {}),
    ...(flags.key ? { key: flags.key } : {}),
    ...(flags.dx ? { dx: Number(flags.dx) } : {}),
    ...(flags.dy ? { dy: Number(flags.dy) } : {}),
    ...(flags.toX ? { toX: Number(flags.toX) } : {}),
    ...(flags['to-x'] ? { toX: Number(flags['to-x']) } : {}),
    ...(flags.toY ? { toY: Number(flags.toY) } : {}),
    ...(flags['to-y'] ? { toY: Number(flags['to-y']) } : {}),
    ...(flags.steps ? { steps: Number(flags.steps) } : {}),
    ...(flags.timeout ? { timeoutMs: Number(flags.timeout) } : {}),
    ...(flags.timeoutMs ? { timeoutMs: Number(flags.timeoutMs) } : {}),
    ...(flags.limit ? { limit: Number(flags.limit) } : {}),
    ...(flags.maxNodes ? { maxNodes: Number(flags.maxNodes) } : {}),
    ...(flags['max-nodes'] ? { maxNodes: Number(flags['max-nodes']) } : {}),
    ...(flags.prefix ? { prefix: flags.prefix } : {}),
    ...(flags.replace === 'true' ? { replace: true } : {}),
  };
  return body;
}

async function browserCommand(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  const leaseId = flags.lease || flags.leaseId || process.env.HARNESS_WF_BROWSER_LEASE_ID || '';
  const primitive = flags.primitive || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  if (!leaseId) throw new Error('Missing --lease <leaseId> or HARNESS_WF_BROWSER_LEASE_ID.');
  if (!primitive) throw new Error('Missing --primitive observe.* or act.*.');
  return apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/commands`, {
    method: 'POST',
    body: {
      commandId: flags.command || flags.commandId || undefined,
      primitive,
      agentId: flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown',
      sessionId: flags.session || process.env.HARNESS_PEER_SESSION_ID || '',
      leaseId,
      timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
      payload: browserCommandPayload(flags),
      storeArtifact: flags['no-artifact'] === 'true' ? false : undefined,
    },
  });
}

function browserSnapshotPrimitives(flags) {
  const values = listFlag(flags.primitives || flags.primitive);
  const primitives = values.length ? values : DEFAULT_BROWSER_SNAPSHOT_PRIMITIVES;
  const invalid = primitives.filter(primitive => !primitive.startsWith('observe.'));
  if (invalid.length) {
    throw new Error(`browser-snapshot only accepts observe.* primitives: ${invalid.join(', ')}`);
  }
  return primitives;
}

async function browserSnapshot(flags) {
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  const leaseId = flags.lease || flags.leaseId || process.env.HARNESS_WF_BROWSER_LEASE_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  if (!leaseId) throw new Error('Missing --lease <leaseId> or HARNESS_WF_BROWSER_LEASE_ID.');

  const primitives = browserSnapshotPrimitives(flags);
  const agentId = flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown';
  const startedAt = new Date().toISOString();
  let connection = null;
  try {
    const connections = await browserConnections(flags);
    connection = (connections.connections || []).find(item => item.runId === runId && item.windowId === windowId) || null;
  } catch { /* command loop reports disconnected windows */ }

  const results = [];
  const baseCommandId = flags.command || flags.commandId || '';
  for (let index = 0; index < primitives.length; index += 1) {
    const primitive = primitives[index];
    const itemStartedAt = Date.now();
    try {
      const output = await browserCommand({
        ...flags,
        primitive,
        run: runId,
        window: windowId,
        lease: leaseId,
        agent: agentId,
        command: baseCommandId ? `${baseCommandId}-${String(index + 1).padStart(2, '0')}` : undefined,
        commandId: undefined,
      });
      results.push({
        primitive,
        ok: true,
        status: output.command?.status || 'ok',
        commandId: output.command?.commandId || '',
        artifact: output.artifact || null,
        durationMs: Date.now() - itemStartedAt,
      });
    } catch (err) {
      const failed = {
        primitive,
        ok: false,
        status: 'failed',
        error: err?.message || 'Snapshot primitive failed',
        durationMs: Date.now() - itemStartedAt,
      };
      results.push(failed);
      if (trueFlag(flags.strict)) throw err;
    }
  }

  const artifacts = results.map(item => item.artifact).filter(Boolean);
  return {
    ok: results.every(item => item.ok),
    runId,
    windowId,
    leaseId,
    agentId,
    startedAt,
    completedAt: new Date().toISOString(),
    connection,
    primitives,
    results,
    artifacts,
  };
}

async function deleteNode(flags) {
  assertMainAgent(flags, 'delete-node');
  const cp = controlPlane(flags);
  if (!cp.url || !cp.token) throw new Error('Missing HARNESS_WF_UI_URL/HARNESS_WF_UI_TOKEN for graph modification.');
  const node = flags.node || flags.session || flags.id || '';
  if (!node) throw new Error('Missing --node <graphNodeIdOrSessionId>.');
  return apiJson(cp.url, cp.token, `/api/a2a/nodes/${encodeURIComponent(node)}`, { method: 'DELETE' });
}

function resolveGraphNode(snapshotData, key) {
  const nodes = snapshotData?.nodes || [];
  const match = nodes.find(node =>
    node.id === key
    || node.graphNodeId === key
    || node.nodeId === key
    || node.sessionId === key
  );
  if (!match) throw new Error(`Graph node not found: ${key}`);
  return match.graphNodeId || match.nodeId || match.id;
}

async function connectNodes(projectRoot, flags) {
  assertMainAgent(flags, 'connect');
  const cp = controlPlane(flags);
  if (!cp.url || !cp.token) throw new Error('Missing HARNESS_WF_UI_URL/HARNESS_WF_UI_TOKEN for graph modification.');
  const fromKey = flags.from || flags['from-session'] || process.env.HARNESS_PEER_SESSION_ID || '';
  const toKey = flags.to || flags.session || flags['to-session'] || '';
  if (!fromKey || !toKey) throw new Error('Missing --from <nodeOrSession> and --to <nodeOrSession>.');
  const current = await snapshot(projectRoot, flags);
  const graph = current.graph || { schemaVersion: 1, version: 1, nodes: [], edges: [], positions: {} };
  const from = resolveGraphNode(current, fromKey);
  const to = resolveGraphNode(current, toKey);
  const edges = graph.edges || [];
  if (!edges.some(edge => edge.from === from && edge.to === to)) {
    edges.push({
      id: `bridge-${from}-${to}-${Date.now()}`,
      from,
      to,
      relation: 'wf-bridge',
    });
  }
  return apiJson(cp.url, cp.token, '/api/a2a/graph-map', {
    method: 'PUT',
    body: {
      ...graph,
      version: Number(graph.version || 1) + 1,
      edges,
    },
  });
}

function tail(projectRoot, flags) {
  const sessionId = flags.session || process.env.HARNESS_PEER_SESSION_ID;
  const found = allSessionDirs(projectRoot).find(session => session.sessionId === sessionId);
  if (!found) return { sessionId, entries: [] };
  const lines = Math.min(Math.max(Number(flags.lines || flags.tail || 80), 1), 1000);
  return {
    taskId: found.taskId,
    sessionId,
    entries: readJsonl(path.join(found.dir, 'terminal.jsonl')).slice(-lines),
  };
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(flags.project || process.cwd());
  if (command === 'self') return print(selfContext());
  if (command === 'snapshot') return print(await snapshot(projectRoot, flags));
  if (command === 'describe') return print(describeSnapshot(await snapshot(projectRoot, flags)));
  if (command === 'create-agent') return print(await createAgent(projectRoot, flags));
  if (command === 'send-input') return print(await sendInput(flags));
  if (command === 'bridge-messages') return print(await bridgeMessages(flags));
  if (command === 'browser-runs') return print(await browserRuns(flags));
  if (command === 'browser-run') return print(await browserRun(flags));
  if (command === 'browser-window') return print(await browserWindow(flags));
  if (command === 'browser-windows') return print(await browserWindows(flags));
  if (command === 'browser-lease') return print(await browserLease(flags));
  if (command === 'browser-url') return print(await browserUrl(flags));
  if (command === 'browser-allocate') return print(await browserAllocate(flags));
  if (command === 'browser-allocate-many') return print(await browserAllocateMany(flags));
  if (command === 'browser-open') return print(await browserOpen({ ...flags, project: projectRoot }));
  if (command === 'browser-launches') return print(await browserLaunches({ ...flags, project: projectRoot }));
  if (command === 'browser-close') return print(await browserClose({ ...flags, project: projectRoot }));
  if (command === 'browser-wait') return print(await browserWait(flags));
  if (command === 'browser-release') return print(await browserRelease(flags));
  if (command === 'browser-artifacts') return print(await browserArtifacts(flags));
  if (command === 'browser-connections') return print(await browserConnections(flags));
  if (command === 'browser-cleanup') return print(await browserCleanup(flags));
  if (command === 'browser-command') return print(await browserCommand(flags));
  if (command === 'browser-snapshot') return print(await browserSnapshot(flags));
  if (command === 'delete-node') return print(await deleteNode(flags));
  if (command === 'connect') return print(await connectNodes(projectRoot, flags));
  if (command === 'tail') return print(tail(projectRoot, flags));
  throw new Error('Usage: wf-ui-control.mjs self|snapshot|describe|create-agent|send-input|bridge-messages|browser-runs|browser-run|browser-window|browser-windows|browser-lease|browser-url|browser-allocate|browser-allocate-many|browser-open|browser-launches|browser-close|browser-wait|browser-release|browser-artifacts|browser-connections|browser-cleanup|browser-command|browser-snapshot|connect|delete-node|tail [--project .]');
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
