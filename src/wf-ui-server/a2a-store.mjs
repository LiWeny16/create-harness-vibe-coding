import fs from 'node:fs';
import path from 'node:path';
import { parseTaskCapsule, parseTaskList } from './task-parser.mjs';
import { RUNTIME_DEFINITIONS } from './runtime-detector.mjs';
import { listTerminalSessions } from './terminal-store.mjs';

const DEFAULT_ROLE_GRAPH = {
  schemaVersion: 1,
  rootAgentId: 'ceo',
  agents: [
    {
      agentId: 'ceo',
      role: 'CEO Leader',
      level: 0,
      kind: 'controller',
      skills: ['wf', 'subagent-orchestrator', 'terminal-control'],
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
      skills: ['runtime-detection', 'terminal-control', 'a2a-files'],
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
      skills: ['terminal-control'],
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
  for (const session of diskSessions) bySessionId.set(session.sessionId, session);
  for (const session of memorySessions) {
    bySessionId.set(session.sessionId, { ...bySessionId.get(session.sessionId), ...session });
  }
  const sessions = [...bySessionId.values()]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  const roleNodes = roleGraph.agents.map((agent) => ({
    id: agent.agentId,
    label: agent.role,
    kind: agent.kind,
    level: agent.level,
    status: agent.agentId === 'ceo' ? (task?.status || 'idle') : 'ready',
    skills: agent.skills || [],
    permissions: agent.permissions || [],
  }));

  const nodes = [...roleNodes];
  const edges = [...roleGraph.edges];
  for (const session of sessions) {
    const nodeId = `session-${session.sessionId}`;
    const isWorkflowCeo = session.workflowMode === 'wf' && String(session.role || '').toLowerCase().includes('ceo');
    nodes.push({
      id: nodeId,
      label: isWorkflowCeo ? `${session.runtime} /wf CEO` : `${session.runtime} terminal`,
      kind: 'terminal-session',
      level: isWorkflowCeo ? 1 : 2,
      status: session.status,
      sessionId: session.sessionId,
      taskId: session.taskId,
      peerId: session.peerId,
      runtime: session.runtime,
      model: session.model,
      provider: session.provider,
      subagentMode: session.subagentMode,
      workflowMode: session.workflowMode,
      objective: session.objective,
    });
    edges.push({
      from: isWorkflowCeo ? 'ceo' : 'terminal-controller',
      to: nodeId,
      relation: isWorkflowCeo ? 'runs-wf-terminal' : 'owns-session',
    });
  }

  return {
    schemaVersion: 1,
    workflowId: task ? `workflow-${task.taskId}` : 'workflow-none',
    taskId: task?.taskId || null,
    mode: task?.mode || null,
    phase: task?.phase || null,
    gate: task?.gate || null,
    rootAgentId: roleGraph.rootAgentId,
    subagentModes: [
      { id: 'built-in-subagents', label: 'Built-in Subagents' },
      { id: 'wf-subagents', label: 'WF Subagents' },
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
  };
}
