#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

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
  if (command === 'delete-node') return print(await deleteNode(flags));
  if (command === 'connect') return print(await connectNodes(projectRoot, flags));
  if (command === 'tail') return print(tail(projectRoot, flags));
  throw new Error('Usage: wf-ui-control.mjs self|snapshot|describe|create-agent|send-input|bridge-messages|connect|delete-node|tail [--project .]');
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
