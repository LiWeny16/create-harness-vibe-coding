import fs from 'node:fs';
import path from 'node:path';
import { parseTaskCapsule, parseTaskList } from './task-parser.mjs';
import { RUNTIME_DEFINITIONS } from './runtime-detector.mjs';
import { listTerminalSessions } from './terminal-store.mjs';
import { normalizeNodeConfig, recommendSkills } from './node-config-store.mjs';
import { componentStateRefs, listComponentNodes } from './component-node-store.mjs';
import { workspaceMimeForPath } from './workspace-store.mjs';

const DEFAULT_ROLE_GRAPH = {
  schemaVersion: 1,
  rootAgentId: 'ceo',
  agents: [
    {
      agentId: 'ceo',
      role: 'CEO Leader',
      level: 0,
      kind: 'controller',
      skills: ['wf', 'subagent-orchestrator', 'terminal-control', 'wf-ui-map'],
      permissions: ['plan', 'dispatch', 'read-terminals', 'send-terminal-input'],
    },
    {
      agentId: 'product-manager',
      role: 'Product Manager',
      level: 1,
      kind: 'planner',
      skills: ['product-shape', 'acceptance'],
      permissions: ['read-state', 'define-ac'],
    },
    {
      agentId: 'architect',
      role: 'Architect',
      level: 1,
      kind: 'architecture',
      skills: ['architecture', 'contracts'],
      permissions: ['read-code', 'define-contracts'],
    },
    {
      agentId: 'backend-expert',
      role: 'Backend Expert',
      level: 1,
      kind: 'implementer',
      skills: ['runtime-detection', 'terminal-control', 'wf-ui-map', 'a2a-files'],
      permissions: ['read-code', 'write-backend', 'terminal-io'],
    },
    {
      agentId: 'frontend-expert',
      role: 'Frontend Expert',
      level: 1,
      kind: 'implementer',
      skills: ['ui-control-plane'],
      permissions: ['read-code', 'write-ui'],
    },
    {
      agentId: 'reviewer',
      role: 'Reviewer',
      level: 1,
      kind: 'review',
      skills: ['wf-review'],
      permissions: ['read-code', 'read-evidence'],
    },
    {
      agentId: 'verifier',
      role: 'Verifier',
      level: 1,
      kind: 'validation',
      skills: ['wf-browser', 'test-runner'],
      permissions: ['run-tests', 'read-evidence'],
    },
    {
      agentId: 'terminal-controller',
      role: 'Terminal Controller',
      level: 1,
      kind: 'runtime',
      skills: ['terminal-control', 'wf-ui-map'],
      permissions: ['read-terminals', 'send-terminal-input'],
    },
  ],
  edges: [
    { from: 'ceo', to: 'product-manager', relation: 'defines' },
    { from: 'ceo', to: 'architect', relation: 'routes' },
    { from: 'ceo', to: 'backend-expert', relation: 'dispatches' },
    { from: 'ceo', to: 'frontend-expert', relation: 'dispatches' },
    { from: 'ceo', to: 'reviewer', relation: 'requests-review' },
    { from: 'ceo', to: 'verifier', relation: 'requests-evidence' },
    { from: 'ceo', to: 'terminal-controller', relation: 'controls' },
  ],
};

const DEFAULT_TERMINAL_CONTROL_SKILL = {
  schemaVersion: 1,
  skillId: 'terminal-control',
  name: 'Terminal Control',
  source: 'Harness/a2a/skills/terminal-control.json',
  description: 'Bounded A2A tools for listing terminal sessions, reading output ranges, globbing terminal events, and attach-gated input forwarding.',
  tools: [
    { name: 'list-sessions', reads: ['Harness/tasks/**/sessions/**/STATE.json', 'Harness/a2a/sessions/**/STATE.json'] },
    { name: 'read-range', reads: ['Harness/tasks/**/sessions/**/terminal.jsonl', 'Harness/a2a/sessions/**/terminal.jsonl'], args: ['session', 'from', 'to', 'tail'] },
    { name: 'glob-events', reads: ['Harness/tasks/**/sessions/**/events.jsonl', 'Harness/a2a/sessions/**/events.jsonl'], args: ['pattern', 'since', 'limit'] },
    { name: 'send-input', writes: ['Harness/tasks/**/sessions/**/input-requests.jsonl', 'Harness/a2a/sessions/**/input-requests.jsonl'], args: ['session', 'text'] },
  ],
  defaultMode: 'watch',
  inputPolicy: 'attach-mode-required',
};

const DEFAULT_WF_UI_MAP_SKILL = {
  schemaVersion: 1,
  skillId: 'wf-ui-map',
  name: 'WF UI Map',
  source: 'Harness/a2a/skills/wf-ui-map.json',
  description: 'Workflow-canvas awareness and control commands for PTY agent nodes.',
  commands: [
    {
      name: 'self',
      command: 'node Harness/scripts/wf-ui-control.mjs self',
      description: 'Print this PTY node identity and workflow map environment.',
    },
    {
      name: 'describe',
      command: 'node Harness/scripts/wf-ui-control.mjs describe',
      description: 'Describe the current workflow graph and connected nodes.',
    },
    {
      name: 'snapshot',
      command: 'node Harness/scripts/wf-ui-control.mjs snapshot',
      description: 'Read the complete wf-ui workflow snapshot.',
    },
    {
      name: 'create-agent',
      command: 'node Harness/scripts/wf-ui-control.mjs create-agent --agent-kind subagent --runtime claude --objective "..."',
      description: 'Main Agent only. Create a managed PTY node through wf-ui.',
    },
    {
      name: 'send-input',
      command: 'node Harness/scripts/wf-ui-control.mjs send-input --session <sessionId> --text "..."',
      description: 'Main Agent only. Send terminal input to a managed PTY node and record a wf-bridge message.',
    },
    {
      name: 'bridge-messages',
      command: 'node Harness/scripts/wf-ui-control.mjs bridge-messages --from <sessionId> --to <sessionId>',
      description: 'Main Agent only. Read the recorded wf-bridge conversation between two managed sessions.',
    },
    {
      name: 'connect',
      command: 'node Harness/scripts/wf-ui-control.mjs connect --from <nodeOrSession> --to <nodeOrSession>',
      description: 'Main Agent only. Add a wf-bridge edge to the workflow graph.',
    },
    {
      name: 'delete-node',
      command: 'node Harness/scripts/wf-ui-control.mjs delete-node --node <graphNodeIdOrSessionId>',
      description: 'Main Agent only. Remove a stopped workflow graph node while preserving transcript history.',
    },
  ],
  policy: {
    mainAgent: ['read-workflow-map', 'describe-graph', 'create-subagent-node', 'send-terminal-input', 'read-bridge-messages', 'connect-managed-nodes', 'delete-stopped-node'],
    subagent: ['read-workflow-map', 'describe-graph', 'return-evidence'],
    subagentDenied: ['create-agent-node', 'create-task-node', 'spawn-pty-subagents'],
  },
};

const BUILT_IN_WORKFLOWS = [
  {
    id: 'wf-standard',
    command: '/wf',
    label: 'WF Standard',
    description: 'CEO-led workflow with A2A terminal orchestration and acceptance gates.',
    defaultCeoPrompt: 'Act as the Harness /wf CEO. Create a concise plan, choose terminal agents only when useful, coordinate A2A READ/WRITE/GLOB evidence, and keep task binding optional unless explicitly needed.',
  },
  {
    id: 'wf-max',
    command: '/wf-max',
    label: 'WF Max',
    description: 'Deeper CEO workflow for broader architecture and verification passes.',
    defaultCeoPrompt: 'Act as the Harness /wf-max CEO. Expand exploration only where it improves decisions, then coordinate terminal agents through Harness A2A evidence.',
  },
  {
    id: 'wf-browser',
    command: '/wf-browser',
    label: 'WF Browser',
    description: 'Browser verification workflow with terminal agents and E2E evidence.',
    defaultCeoPrompt: 'Act as the Harness /wf-browser CEO. Coordinate implementation terminals and browser verification, then report evidence.',
  },
  {
    id: 'wf-review',
    command: '/wf-review',
    label: 'WF Review',
    description: 'Independent review workflow for risks, regressions, and missing tests.',
    defaultCeoPrompt: 'Act as the Harness /wf-review CEO. Inspect the current changes, ask terminal peers for independent findings when useful, and return prioritized review evidence.',
  },
];

function a2aRoot(projectRoot) {
  return path.join(projectRoot, 'Harness', 'a2a');
}

function writeJsonIfMissing(filePath, data) {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
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

function graphMapPath(projectRoot) {
  return path.join(a2aRoot(projectRoot), 'workflow-map.json');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function graphMapError(message, { statusCode = 400, code = 'BAD_REQUEST', details } = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

function normalizeExpectedGraphVersion(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  const match = text.match(/^(?:W\/)?"?(\d+)"?$/i);
  const version = match ? Number(match[1]) : Number(text);
  if (!Number.isInteger(version) || version < 0) {
    throw graphMapError('expectedVersion must be a non-negative integer');
  }
  return version;
}

function normalizeGraphPositions(graph) {
  if (
    graph?.positions
    && typeof graph.positions === 'object'
    && !Array.isArray(graph.positions)
    && Object.keys(graph.positions).length > 0
  ) {
    return graph.positions;
  }
  const undoStack = Array.isArray(graph?.undoStack) ? graph.undoStack : [];
  for (let index = undoStack.length - 1; index >= 0; index -= 1) {
    const positions = undoStack[index]?.positions;
    if (positions && typeof positions === 'object' && !Array.isArray(positions) && Object.keys(positions).length > 0) {
      return positions;
    }
  }
  const redoStack = Array.isArray(graph?.redoStack) ? graph.redoStack : [];
  for (let index = 0; index < redoStack.length; index += 1) {
    const positions = redoStack[index]?.positions;
    if (positions && typeof positions === 'object' && !Array.isArray(positions) && Object.keys(positions).length > 0) {
      return positions;
    }
  }
  const positions = {};
  for (const node of Array.isArray(graph?.nodes) ? graph.nodes : []) {
    const nodeId = node.nodeId || node.id;
    const position = node.position || (Number.isFinite(Number(node.x)) && Number.isFinite(Number(node.y))
      ? { x: Number(node.x), y: Number(node.y) }
      : null);
    if (nodeId && position) {
      positions[nodeId] = {
        x: Number(position.x) || 0,
        y: Number(position.y) || 0,
      };
    }
  }
  return positions;
}

function normalizeDeletedNodes(graph) {
  const rows = Array.isArray(graph?.deletedNodes) ? graph.deletedNodes : [];
  return rows
    .map((node) => ({
      nodeId: String(node?.nodeId || node?.id || '').trim(),
      sessionId: node?.sessionId ? String(node.sessionId).trim() : null,
      deletedAt: node?.deletedAt || new Date().toISOString(),
    }))
    .filter(node => node.nodeId || node.sessionId);
}

function mergeDeletedNodes(...groups) {
  const byKey = new Map();
  for (const group of groups) {
    for (const node of normalizeDeletedNodes({ deletedNodes: group })) {
      const key = node.nodeId || `session:${node.sessionId}`;
      byKey.set(key, { ...byKey.get(key), ...node });
    }
  }
  return [...byKey.values()];
}

function deletedNodeSets(deletedNodes) {
  return {
    nodeIds: new Set(deletedNodes.map(node => node.nodeId).filter(Boolean)),
    sessionIds: new Set(deletedNodes.map(node => node.sessionId).filter(Boolean)),
  };
}

function graphNodeMatches(node, nodeIds, sessionIds) {
  const nodeId = node?.nodeId || node?.id || '';
  const sessionId = node?.sessionId || '';
  return (
    (nodeId && nodeIds.has(nodeId))
    || (sessionId && sessionIds.has(sessionId))
    || (sessionId && nodeIds.has(`session-${sessionId}`))
  );
}

function graphNodeDedupeKey(node) {
  return node?.nodeId || node?.id || (node?.sessionId ? `session-${node.sessionId}` : '');
}

function normalizeGraphNode(node) {
  if (!node || typeof node !== 'object') return node;
  return { ...node, status: normalizeSessionStatus(node.status) };
}

function dedupeGraphNodes(nodes) {
  const seen = new Set();
  const result = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const normalized = normalizeGraphNode(node);
    const key = graphNodeDedupeKey(normalized);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(normalized);
  }
  return result;
}

function graphNodeId(node) {
  return node?.nodeId || node?.id || (node?.sessionId ? `session-${node.sessionId}` : '');
}

function mergeComponentGraphNodes(projectRoot, nodes = [], positions = {}) {
  const componentNodes = listComponentNodes(projectRoot);
  const componentIds = new Set(componentNodes.map(node => node.nodeId));
  const incomingById = new Map((Array.isArray(nodes) ? nodes : [])
    .map(node => [graphNodeId(node), node])
    .filter(([id]) => id));
  const nonComponentNodes = (Array.isArray(nodes) ? nodes : [])
    .filter(node => node?.kind !== 'component-node' && !componentIds.has(graphNodeId(node)));
  const mergedComponentNodes = componentNodes.map(node => ({
    ...node,
    position: positions?.[node.nodeId]
      || incomingById.get(node.nodeId)?.position
      || node.position,
  }));
  return dedupeGraphNodes([...nonComponentNodes, ...mergedComponentNodes]);
}

function graphEdgeMatches(edge, nodeIds, sessionIds) {
  return (
    (edge?.from && nodeIds.has(edge.from))
    || (edge?.to && nodeIds.has(edge.to))
    || (edge?.source && nodeIds.has(edge.source))
    || (edge?.target && nodeIds.has(edge.target))
    || (edge?.fromSessionId && sessionIds.has(edge.fromSessionId))
    || (edge?.toSessionId && sessionIds.has(edge.toSessionId))
  );
}

function filterPositionsForDeleted(positions, deletedNodes) {
  const next = { ...(positions || {}) };
  for (const node of deletedNodes) {
    if (node.nodeId) delete next[node.nodeId];
    if (node.sessionId) delete next[`session-${node.sessionId}`];
  }
  return next;
}

function filterHistoryForDeleted(history, deletedNodes) {
  if (!Array.isArray(history)) return [];
  const { nodeIds, sessionIds } = deletedNodeSets(deletedNodes);
  return history.map((entry) => ({
    ...entry,
    positions: filterPositionsForDeleted(entry?.positions, deletedNodes),
    edges: Array.isArray(entry?.edges)
      ? entry.edges.filter(edge => !graphEdgeMatches(edge, nodeIds, sessionIds))
      : [],
  }));
}

export function loadWorkflowGraphMap(projectRoot) {
  ensureA2aDefaults(projectRoot);
  const fallback = {
    schemaVersion: 1,
    version: 1,
    nodes: [],
    edges: [],
    positions: {},
    undoStack: [],
    redoStack: [],
    deletedNodes: [],
  };
  const graph = readJson(graphMapPath(projectRoot), fallback);
  const positions = normalizeGraphPositions(graph);
  const deletedNodes = normalizeDeletedNodes(graph);
  const { nodeIds, sessionIds } = deletedNodeSets(deletedNodes);
  return {
    ...fallback,
    ...graph,
    schemaVersion: Number(graph.schemaVersion || 1),
    version: Number(graph.version || graph.graphVersion || 1),
    nodes: mergeComponentGraphNodes(projectRoot, Array.isArray(graph.nodes) ? graph.nodes : [], positions)
      .filter(node => !graphNodeMatches(node, nodeIds, sessionIds)),
    edges: Array.isArray(graph.edges) ? graph.edges.filter(edge => !graphEdgeMatches(edge, nodeIds, sessionIds)) : [],
    positions: filterPositionsForDeleted(positions, deletedNodes),
    undoStack: filterHistoryForDeleted(graph.undoStack, deletedNodes),
    redoStack: filterHistoryForDeleted(graph.redoStack, deletedNodes),
    deletedNodes,
    graphContextPath: graphMapPath(projectRoot),
  };
}

export function writeWorkflowGraphMap(projectRoot, graph = {}, options = {}) {
  const current = loadWorkflowGraphMap(projectRoot);
  const graphPayload = isPlainObject(graph) ? graph : {};
  const expectedVersion = normalizeExpectedGraphVersion(
    graphPayload.expectedVersion !== undefined ? graphPayload.expectedVersion : options.expectedVersion
  );
  if (expectedVersion !== null && expectedVersion !== current.version) {
    throw graphMapError(`Stale graph-map write rejected: expected version ${expectedVersion}, current version ${current.version}`, {
      statusCode: 409,
      code: 'STALE_GRAPH_VERSION',
      details: { expectedVersion, currentVersion: current.version },
    });
  }

  const { expectedVersion: _expectedVersion, ifMatch: _ifMatch, ...graphPatch } = graphPayload;
  const deletedNodes = mergeDeletedNodes(current.deletedNodes, graphPatch.deletedNodes);
  const { nodeIds, sessionIds } = deletedNodeSets(deletedNodes);
  const rawNodes = Array.isArray(graphPatch.nodes) ? graphPatch.nodes : current.nodes;
  const rawEdges = Array.isArray(graphPatch.edges) ? graphPatch.edges : current.edges;
  const rawPositions = graphPatch.positions && typeof graphPatch.positions === 'object' && !Array.isArray(graphPatch.positions)
    ? graphPatch.positions
    : current.positions;
  const nodes = mergeComponentGraphNodes(projectRoot, rawNodes, rawPositions)
    .filter(node => !graphNodeMatches(node, nodeIds, sessionIds));
  const next = {
    ...current,
    ...graphPatch,
    schemaVersion: 1,
    version: Number(graphPatch.version || graphPatch.graphVersion || current.version + 1),
    nodes,
    edges: rawEdges.filter(edge => !graphEdgeMatches(edge, nodeIds, sessionIds)),
    positions: filterPositionsForDeleted(rawPositions, deletedNodes),
    undoStack: filterHistoryForDeleted(Array.isArray(graphPatch.undoStack) ? graphPatch.undoStack : current.undoStack, deletedNodes),
    redoStack: filterHistoryForDeleted(Array.isArray(graphPatch.redoStack) ? graphPatch.redoStack : current.redoStack, deletedNodes),
    deletedNodes,
    updatedAt: new Date().toISOString(),
  };
  writeJson(graphMapPath(projectRoot), next);
  return { ...next, graphContextPath: graphMapPath(projectRoot) };
}

export function updateWorkflowGraphSessionNode(projectRoot, sessionId, patch = {}) {
  const current = loadWorkflowGraphMap(projectRoot);
  let changed = false;
  const nodes = current.nodes.map((node) => {
    if (node.sessionId !== sessionId) return node;
    changed = true;
    return { ...node, ...patch, nodeId: node.nodeId || node.id };
  });
  if (!changed) return current;
  return writeWorkflowGraphMap(projectRoot, {
    ...current,
    version: current.version + 1,
    nodes,
  });
}

export function removeWorkflowGraphNode(projectRoot, nodeIdOrSessionId) {
  const current = loadWorkflowGraphMap(projectRoot);
  const key = String(nodeIdOrSessionId || '').trim();
  const target = current.nodes.find(node => {
    const nodeId = node.nodeId || node.id || '';
    const sessionId = node.sessionId || '';
    return nodeId === key || sessionId === key || (sessionId && `session-${sessionId}` === key);
  }) || null;
  const nodeId = target?.nodeId || target?.id || key;
  const sessionId = target?.sessionId || (key.startsWith('session-') ? key.slice('session-'.length) : null);
  const deletedAt = new Date().toISOString();
  const deletedNode = { nodeId, sessionId: sessionId || null, deletedAt };
  const deletedNodes = mergeDeletedNodes(current.deletedNodes, [deletedNode]);
  const { nodeIds, sessionIds } = deletedNodeSets(deletedNodes);
  const graph = writeWorkflowGraphMap(projectRoot, {
    ...current,
    version: current.version + 1,
    nodes: current.nodes.filter(node => !graphNodeMatches(node, nodeIds, sessionIds)),
    edges: current.edges.filter(edge => !graphEdgeMatches(edge, nodeIds, sessionIds)),
    positions: filterPositionsForDeleted(current.positions, deletedNodes),
    undoStack: filterHistoryForDeleted(current.undoStack, deletedNodes),
    redoStack: filterHistoryForDeleted(current.redoStack, deletedNodes),
    deletedNodes,
  });
  return { ok: true, removed: deletedNode, graph };
}

export function ensureA2aDefaults(projectRoot) {
  const root = a2aRoot(projectRoot);
  writeJsonIfMissing(path.join(root, 'role-graph.json'), DEFAULT_ROLE_GRAPH);
  writeJsonIfMissing(path.join(root, 'runtime-registry.json'), {
    schemaVersion: 1,
    source: 'backend-runtime-detector',
    runtimes: RUNTIME_DEFINITIONS.map((runtime) => runtime.id),
  });
  writeJsonIfMissing(path.join(root, 'workflows.json'), {
    schemaVersion: 1,
    workflows: BUILT_IN_WORKFLOWS,
  });
  writeJsonIfMissing(path.join(root, 'skills', 'terminal-control.json'), DEFAULT_TERMINAL_CONTROL_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'wf-ui-map.json'), DEFAULT_WF_UI_MAP_SKILL);
  return root;
}

export function loadRoleGraph(projectRoot) {
  ensureA2aDefaults(projectRoot);
  return readJson(path.join(a2aRoot(projectRoot), 'role-graph.json'), DEFAULT_ROLE_GRAPH);
}

export function loadA2aSkills(projectRoot) {
  ensureA2aDefaults(projectRoot);
  const skillsRoot = path.join(a2aRoot(projectRoot), 'skills');
  let entries = [];
  try {
    entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readJson(path.join(skillsRoot, entry.name), null))
    .filter(Boolean);
}

export function loadBuiltInWorkflows(projectRoot) {
  ensureA2aDefaults(projectRoot);
  const registry = readJson(path.join(a2aRoot(projectRoot), 'workflows.json'), { workflows: BUILT_IN_WORKFLOWS });
  return Array.isArray(registry.workflows) ? registry.workflows : BUILT_IN_WORKFLOWS;
}

function graphNodeIdForSession(session) {
  return session.graphNodeId || `session-${session.sessionId}`;
}

function isLiveStatus(status) {
  return status === 'running' || status === 'starting';
}

function normalizeSessionStatus(status) {
  return status === 'saved' ? 'stopped' : status;
}

function lifecycleForSession(session) {
  const status = normalizeSessionStatus(session.status);
  if (isLiveStatus(status)) return 'live';
  if (status === 'stopping') return 'stopping';
  return 'stopped';
}

function runtimeStateForSession(session) {
  if (session.blockedReason === 'not-managed-by-current-wf-ui') return 'not-managed';
  return normalizeSessionStatus(session.status) || 'unknown';
}

function nodeConfigSummary(session) {
  const config = normalizeNodeConfig(session.nodeConfig, session);
  const recommendation = recommendSkills(config, session);
  return {
    config,
    restartRequired: Boolean(session.restartRequired),
    restartRequiredFields: Array.isArray(session.restartRequiredFields) ? session.restartRequiredFields : [],
    configRevision: Number(session.configRevision || 0),
    recommendedSkills: recommendation.recommendedSkills,
    recommendationReason: recommendation.recommendationReason,
  };
}

function controlForSession(session) {
  const live = isLiveStatus(normalizeSessionStatus(session.status));
  const managed = Boolean(session.managedByCurrentServer);
  const canStop = managed && live;
  const canStart = Boolean(session.sessionId && session.runtime) && !live;
  return {
    canReadGraph: Boolean(session.sessionId),
    canModifyGraph: managed && live && session.agentKind === 'main',
    canStart,
    canStop,
    canDelete: Boolean(session.sessionId) && !live,
    canOpenTerminal: managed && live,
    canOpenTranscript: Boolean(session.sessionId),
    canSendInput: managed && live,
    canCreateAgent: canStop && session.agentKind === 'main',
  };
}

function buildSessionGraph(projectRoot, workflowId, sessions) {
  const persisted = loadWorkflowGraphMap(projectRoot);
  const persistedByNodeId = new Map((persisted.nodes || []).map(node => [node.nodeId || node.id, node]));
  const persistedBySessionId = new Map((persisted.nodes || []).filter(node => node.sessionId).map(node => [node.sessionId, node]));
  const componentNodes = listComponentNodes(projectRoot).map(node => ({
    ...node,
    position: persisted.positions?.[node.nodeId]
      || persistedByNodeId.get(node.nodeId)?.position
      || node.position,
  }));
  const componentOrder = new Map(componentNodes.map((node, index) => [node.nodeId, index]));
  const componentRefs = componentStateRefs(projectRoot);
  const sessionNodes = sessions.map((session) => {
    const configSummary = nodeConfigSummary(session);
    return {
      nodeId: graphNodeIdForSession(session),
      sessionId: session.sessionId,
      peerId: session.peerId,
      agentKind: session.agentKind || (String(session.role || '').toLowerCase().includes('ceo') ? 'main' : 'subagent'),
      runtime: session.runtime,
      role: session.role,
      taskId: session.taskId || null,
      cwd: session.cwd || session.projectRoot || '',
      status: session.status,
      lifecycle: lifecycleForSession(session),
      runtimeState: runtimeStateForSession(session),
      managedByCurrentServer: Boolean(session.managedByCurrentServer),
      control: controlForSession(session),
      parentAgentId: session.parentAgentId || null,
      parentNodeId: session.parentNodeId || null,
      ...configSummary,
      position: persisted.positions?.[graphNodeIdForSession(session)]
        || persisted.positions?.[`session-${session.sessionId}`]
        || persistedByNodeId.get(graphNodeIdForSession(session))?.position
        || persistedBySessionId.get(session.sessionId)?.position
        || null,
    };
  });
  const graphNodes = [...sessionNodes, ...componentNodes];
  const bySessionId = new Map(sessionNodes.map(node => [node.sessionId, node]));
  const byNodeId = new Map(graphNodes.map(node => [node.nodeId, node]));
  const edgesById = new Map();

  for (const edge of persisted.edges) {
    const fromNode = byNodeId.get(edge.from) || bySessionId.get(edge.fromSessionId);
    const toNode = byNodeId.get(edge.to) || bySessionId.get(edge.toSessionId);
    if (!fromNode || !toNode) continue;
    edgesById.set(edge.id || `${fromNode.nodeId}->${toNode.nodeId}`, {
      id: edge.id || `${fromNode.nodeId}->${toNode.nodeId}`,
      kind: edge.kind || (fromNode.sessionId && toNode.sessionId ? 'communication-permission' : 'workflow-link'),
      from: fromNode.nodeId,
      to: toNode.nodeId,
      fromSessionId: fromNode.sessionId || null,
      toSessionId: toNode.sessionId || null,
      relation: edge.relation || 'wf-bridge',
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      offset: Number.isFinite(Number(edge.offset)) ? Number(edge.offset) : undefined,
    });
  }

  for (const node of sessionNodes) {
    if (!node.parentAgentId) continue;
    const parent = bySessionId.get(node.parentAgentId);
    if (!parent) continue;
    const id = `${parent.nodeId}->${node.nodeId}`;
    edgesById.set(id, {
      id,
      kind: 'communication-permission',
      from: parent.nodeId,
      to: node.nodeId,
      fromSessionId: parent.sessionId,
      toSessionId: node.sessionId,
      relation: 'wf-bridge',
      sourceHandle: null,
      targetHandle: null,
    });
  }

  const edges = [...edgesById.values()];
  const fileSupportsText = (file = {}) => {
    const mime = String(file.mime || workspaceMimeForPath(file.path || '')).split(';')[0].trim().toLowerCase();
    return mime.startsWith('text/')
      || ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml'].includes(mime)
      || /\.(md|markdown|txt|csv|json|yaml|yml|log|js|mjs|jsx|ts|tsx|css|html)$/i.test(String(file.path || ''));
  };
  const capabilitiesFor = (type, ref = {}) => {
    if (type === 'file') {
      return [
        'meta:read',
        'bytes:read',
        ...(fileSupportsText(ref.file) ? ['text:read'] : []),
      ];
    }
    if (type === 'markdown') return ['state:read', 'state:update', 'markdown:append', 'markdown:replace'];
    if (type === 'excalidraw') return ['state:read', 'state:update', 'excalidraw:read', 'excalidraw:update'];
    return ['state:read'];
  };
  const handlesFor = (type) => {
    if (type === 'file') return { inputs: ['file'], outputs: ['file', 'path'] };
    if (type === 'markdown') return { inputs: ['markdown'], outputs: ['markdown', 'plainText'] };
    if (type === 'excalidraw') return { inputs: ['scene'], outputs: ['scene', 'image'] };
    return { inputs: [], outputs: [] };
  };
  const contentRefFor = (type, ref = {}) => {
    if (type === 'file') {
      const file = ref.file || {};
      return {
        kind: file.source === 'user-file' ? 'user-file' : 'workspace-file',
        source: file.source || 'workspace',
        path: file.path || '',
        mime: file.mime || workspaceMimeForPath(file.path || ''),
        size: Number(file.size || 0),
        endpoints: {
          meta: '/api/workspace/meta',
          bytes: '/api/workspace/file',
          text: '/api/workspace/text',
        },
      };
    }
    if (type === 'markdown') {
      return {
        kind: 'component-state',
        statePath: ref.statePath,
        revision: Number(ref.revision || 0),
        field: 'markdown',
        mime: 'text/markdown',
      };
    }
    if (type === 'excalidraw') {
      return {
        kind: 'component-state',
        statePath: ref.statePath,
        revision: Number(ref.revision || 0),
        field: 'scene',
        mime: 'application/vnd.excalidraw+json',
      };
    }
    return {
      kind: 'component-state',
      statePath: ref.statePath,
      revision: Number(ref.revision || 0),
    };
  };
  const compareResourceRefs = (a, b) => {
    const created = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    if (created !== 0) return created;
    const order = (componentOrder.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER) - (componentOrder.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER);
    if (order !== 0) return order;
    return String(a.nodeId).localeCompare(String(b.nodeId));
  };
  const resourceRefFor = (resourceNode, edge, direction) => {
    const ref = componentRefs[resourceNode.nodeId] || {
      type: resourceNode.type || resourceNode.componentType || resourceNode.kind,
      title: resourceNode.title || resourceNode.label || resourceNode.nodeId,
      statePath: resourceNode.statePath,
      revision: resourceNode.revision,
    };
    const type = ref.type || resourceNode.type || resourceNode.componentType;
    return {
      nodeId: resourceNode.nodeId,
      kind: resourceNode.kind || 'component-node',
      type,
      title: ref.title || resourceNode.title || resourceNode.label || resourceNode.nodeId,
      createdAt: ref.createdAt || resourceNode.createdAt || null,
      direction,
      relation: edge.relation || 'wf-bridge',
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      stateRef: {
        path: ref.statePath || resourceNode.statePath,
        revision: Number(ref.revision || resourceNode.revision || 0),
      },
      contentRef: contentRefFor(type, ref),
      capabilities: capabilitiesFor(type, ref),
      handles: handlesFor(type),
      ...(ref.file ? { file: ref.file } : {}),
    };
  };
  const outputRoutingFor = (sessionNode, connectedResourceRefs) => {
    const routing = sessionNode.config?.outputRouting || {};
    const enabled = Boolean(routing.markdownDefaultEnabled);
    const explicitTargetNodeId = String(routing.markdownTargetNodeId || '').trim();
    let resolvedTargetNodeId = '';
    let resolution = enabled ? 'none' : 'disabled';
    if (enabled && explicitTargetNodeId) {
      resolvedTargetNodeId = explicitTargetNodeId;
      resolution = 'explicit-target';
    } else if (enabled && routing.fallback !== false) {
      const oldest = connectedResourceRefs
        .filter(ref => ref.type === 'markdown')
        .sort(compareResourceRefs)[0];
      if (oldest) {
        resolvedTargetNodeId = oldest.nodeId;
        resolution = 'oldest-connected-markdown';
      }
    }
    return {
      markdownDefault: {
        enabled,
        explicitTargetNodeId,
        resolvedTargetNodeId,
        resolution,
      },
    };
  };
  const graphContextBySessionId = {};
  for (const node of sessionNodes) {
    const outbound = edges.filter(edge => edge.fromSessionId === node.sessionId).map(edge => edge.toSessionId);
    const inbound = edges.filter(edge => edge.toSessionId === node.sessionId).map(edge => edge.fromSessionId);
    const connectedResourceRefs = edges
      .filter(edge => edge.from === node.nodeId || edge.to === node.nodeId)
      .map((edge) => {
        const direction = edge.from === node.nodeId ? 'outbound' : 'inbound';
        const resourceNodeId = direction === 'outbound' ? edge.to : edge.from;
        const resourceNode = byNodeId.get(resourceNodeId);
        if (!resourceNode || resourceNode.sessionId) return null;
        return resourceRefFor(resourceNode, edge, direction);
      })
      .filter(Boolean)
      .sort(compareResourceRefs);
    graphContextBySessionId[node.sessionId] = {
      nodeId: node.nodeId,
      sessionId: node.sessionId,
      agentKind: node.agentKind,
      parentAgentId: node.parentAgentId || inbound[0] || null,
      connectedPeerIds: [...new Set([...outbound, ...inbound])],
      outboundPeerIds: outbound,
      inboundPeerIds: inbound,
      componentStateRefs: componentRefs,
      connectedResourceRefs,
      outputRouting: outputRoutingFor(node, connectedResourceRefs),
    };
  }

  return {
    graph: {
      schemaVersion: 1,
      workflowId,
      version: persisted.version,
      nodes: graphNodes,
      edges,
      positions: persisted.positions || {},
      undoStack: persisted.undoStack,
      redoStack: persisted.redoStack,
      componentStateRefs: componentRefs,
      graphContextPath: graphMapPath(projectRoot),
    },
    graphContextBySessionId,
  };
}

function readActiveTaskId(projectRoot) {
  const progressPath = path.join(projectRoot, 'Harness', 'PROGRESS.md');
  try {
    const content = fs.readFileSync(progressPath, 'utf8');
    const marker = content.match(/## Active Task\s+^- ([^\r\n]+)/m);
    if (marker) return marker[1].trim();
  } catch {
    return null;
  }
  return null;
}

function activeTask(projectRoot) {
  const tasksRoot = path.join(projectRoot, 'Harness', 'tasks');
  const activeTaskId = readActiveTaskId(projectRoot);
  if (activeTaskId) {
    const capsule = parseTaskCapsule(path.join(tasksRoot, activeTaskId));
    if (capsule) return capsule;
  }
  return parseTaskList(tasksRoot)[0] || null;
}

export function buildWorkflowSnapshot(projectRoot, sessionRegistry) {
  const roleGraph = loadRoleGraph(projectRoot);
  const task = activeTask(projectRoot);
  const memorySessions = sessionRegistry && typeof sessionRegistry.getAll === 'function'
    ? sessionRegistry.getAll()
    : [];
  const diskSessions = listTerminalSessions(projectRoot);
  const bySessionId = new Map();
  const currentSessionIds = new Set(memorySessions.map(session => session.sessionId));
  const liveSessionIds = new Set(memorySessions.map(session => session.sessionId));
  for (const session of diskSessions) {
    const orphanedLiveState = !liveSessionIds.has(session.sessionId) && ['running', 'starting'].includes(session.status);
    bySessionId.set(session.sessionId, orphanedLiveState
      ? { ...session, status: 'stopped', blockedReason: session.blockedReason || 'not-managed-by-current-wf-ui' }
      : { ...session, status: normalizeSessionStatus(session.status) });
  }
  for (const session of memorySessions) {
    bySessionId.set(session.sessionId, { ...bySessionId.get(session.sessionId), ...session, status: normalizeSessionStatus(session.status) });
  }
  const sessions = [...bySessionId.values()]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const persisted = loadWorkflowGraphMap(projectRoot);
  const persistedNodeIds = new Set((persisted.nodes || []).map(node => node.nodeId || node.id).filter(Boolean));
  const persistedSessionIds = new Set((persisted.nodes || []).map(node => node.sessionId).filter(Boolean));
  const visibleSessions = sessions
    .map((session) => {
      const persistedBySession = (persisted.nodes || []).find(node => node.sessionId === session.sessionId);
      return {
        ...session,
        managedByCurrentServer: currentSessionIds.has(session.sessionId),
        graphNodeId: session.graphNodeId || persistedBySession?.nodeId || graphNodeIdForSession(session),
      };
    })
    .filter((session) => {
      if (session.graphReplacedBySessionId && !currentSessionIds.has(session.sessionId)) return false;
      return (
        currentSessionIds.has(session.sessionId)
        || persistedSessionIds.has(session.sessionId)
        || isLiveStatus(session.status)
        || persistedNodeIds.has(graphNodeIdForSession(session))
      );
    });

  const roleNodes = roleGraph.agents.map((agent) => ({
    id: agent.agentId,
    label: agent.role,
    kind: agent.kind,
    level: agent.level,
    status: agent.agentId === 'ceo' ? (task?.status || 'idle') : 'ready',
    skills: agent.skills || [],
    permissions: agent.permissions || [],
  }));

  const nodes = [];
  for (const session of visibleSessions) {
    const isWorkflowCeo = session.workflowMode === 'wf' && String(session.role || '').toLowerCase().includes('ceo');
    const graphNodeId = graphNodeIdForSession(session);
    const lifecycle = lifecycleForSession(session);
    const runtimeState = runtimeStateForSession(session);
    const control = controlForSession(session);
    const status = normalizeSessionStatus(session.status);
    const configSummary = nodeConfigSummary(session);
    nodes.push({
      id: graphNodeId,
      label: isWorkflowCeo ? `${session.runtime} WF CEO` : `${session.runtime} ${session.agentKind === 'main' ? 'main agent' : 'subagent'}`,
      kind: 'terminal-session',
      level: isWorkflowCeo ? 1 : 2,
      status,
      lifecycle,
      runtimeState,
      managedByCurrentServer: Boolean(session.managedByCurrentServer),
      control,
      blockedReason: session.blockedReason,
      sessionId: session.sessionId,
      taskId: session.taskId,
      agentKind: session.agentKind,
      role: session.role,
      peerId: session.peerId,
      runtime: session.runtime,
      model: session.model,
      provider: session.provider,
      subagentMode: session.subagentMode,
      workflowMode: session.workflowMode,
      objective: session.objective,
      cwd: session.cwd,
      graphNodeId,
      parentAgentId: session.parentAgentId || null,
      parentNodeId: session.parentNodeId || null,
      nodeHomePath: session.nodeHomePath || '',
      nodeHomeRel: session.nodeHomeRel || '',
      nodeInitPath: session.nodeInitPath || '',
      nodeInitRel: session.nodeInitRel || '',
      ...configSummary,
    });
  }
  for (const componentNode of listComponentNodes(projectRoot)) {
    nodes.push({
      ...componentNode,
      label: componentNode.title,
      level: 2,
      status: 'ready',
    });
  }

  const workflowId = task ? `workflow-${task.taskId}` : 'workflow-none';
  const { graph, graphContextBySessionId } = buildSessionGraph(projectRoot, workflowId, visibleSessions);
  const nodeIdsByGraphId = new Map(nodes
    .map(node => [node.graphNodeId || node.nodeId || node.id, node.id])
    .filter(([key]) => key));
  const edges = graph.edges
    .map(edge => ({
      from: nodeIdsByGraphId.get(edge.from) || edge.from,
      to: nodeIdsByGraphId.get(edge.to) || edge.to,
      relation: edge.relation || 'wf-bridge',
      fromSessionId: edge.fromSessionId || null,
      toSessionId: edge.toSessionId || null,
      offset: Number.isFinite(Number(edge.offset)) ? Number(edge.offset) : undefined,
    }))
    .filter(edge => edge.from && edge.to);

  return {
    schemaVersion: 1,
    snapshotVersion: graph.version,
    generatedAt: new Date().toISOString(),
    workflowId,
    taskId: task?.taskId || null,
    mode: task?.mode || null,
    phase: task?.phase || null,
    gate: task?.gate || null,
    rootAgentId: roleGraph.rootAgentId,
    subagentModes: [
      { id: 'wf-subagents', label: 'Managed PTY subagents' },
    ],
    availableWorkflows: loadBuiltInWorkflows(projectRoot),
    roles: {
      nodes: roleNodes,
      edges: roleGraph.edges,
    },
    queues: task ? {
      dependsOn: task.dependsOn,
      blocks: task.blocks,
      acceptance: task.acceptance,
    } : null,
    nodes,
    edges,
    sessions,
    graph,
    graphContextBySessionId,
  };
}
