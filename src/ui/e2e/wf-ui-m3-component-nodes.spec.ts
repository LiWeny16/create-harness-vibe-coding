import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sessionId = 'e2e-session-m3';
const graphNodeId = 'e2e-agent-m3';
const markdownNodeId = 'component-markdown-e2e';
const excalidrawNodeId = 'component-excalidraw-e2e';
const timerNodeId = 'event-timer-e2e';
const skillGroupNodeId = 'capability-skill-group-e2e';
const mcpConnectorNodeId = 'capability-mcp-connector-e2e';
const goalNodeId = 'goal-task-w14-e2e';

type JsonRecord = Record<string, any>;
type ComponentType = 'markdown' | 'excalidraw' | 'file';
type EventType = 'timer';
type CapabilityType = 'skill-group' | 'mcp-connector';

type ComponentState = {
  nodeId: string;
  type: ComponentType;
  title: string;
  revision: number;
  markdown?: string;
  scene?: JsonRecord;
  file?: {
    source: 'workspace' | 'user-file';
    path: string;
    name?: string;
    mime?: string;
    size?: number;
  };
  observableInputs: string[];
  observableOutputs: string[];
  statePath: string;
};

type EventState = {
  nodeId: string;
  type: EventType;
  title: string;
  revision: number;
  enabled: boolean;
  schedule: {
    mode: 'manual' | 'once' | 'interval' | 'cron' | 'loop' | 'adaptive' | 'watchdog' | 'while' | 'task';
    intervalSeconds: number;
    cron: string;
    triggerAt?: string;
    cadence?: { kind: 'fixed' | 'sequence' | 'backoff' | 'jitter'; sequenceSeconds?: number[]; backoffFactor?: number; maxIntervalSeconds?: number };
  };
  heartbeat?: {
    base: { enabled: boolean; intervalSeconds: number; count: number; lastAt?: string; nextDueAt?: string };
    watchdog: { enabled: boolean; intervalSeconds: number; timeoutSeconds: number; missedCount: number; state: 'ok' | 'waiting' | 'missed'; lastPingAt?: string; lastAckAt?: string };
  };
  controlPolicy?: { agentCanDisable: boolean; agentCanSetInterval: boolean; minIntervalSeconds: number; maxIntervalSeconds: number };
  payloadTemplate: JsonRecord;
  eventCount: number;
  lastFiredAt: string;
  lastEvent: JsonRecord | null;
  statePath: string;
};

type GoalState = {
  nodeId: string;
  type: 'goal';
  title: string;
  taskId: string;
  objective: string;
  status: 'active' | 'blocked' | 'proposed-complete' | 'needs-confirmation' | 'completed';
  phase: string;
  gate: string;
  revision: number;
  acceptance: { id: string; text: string; status: string }[];
  progress: { verified: number; total: number };
  planItems?: { id: string; text: string; status: string }[];
  nextAction: string;
  blocker?: string | null;
  activeQuestion?: string | null;
  confirmation: { required: boolean; proposedBy?: string; proposedAt?: string; evidenceRefs?: string[] };
  wdt: { timerNodeId?: string; state: string; staleAfterMs?: number; lastTickAt?: string };
  stateRef: { path: string; revision: number };
  contentRef: { planPath: string; progressPath: string };
  statePath: string;
};

type CapabilityState = {
  nodeId: string;
  type: CapabilityType;
  title: string;
  revision: number;
  description: string;
  sourceGroup: { id: string; label: string; kind: string } | null;
  skills: { id: string; name: string; title: string; description: string; source: string; state: string }[];
  skillNames: string[];
  skillCount: number;
  servers: JsonRecord[];
  serverNames: string[];
  serverCount: number;
  transports: string[];
  envKeyNames: string[];
  envKeyCount: number;
  redactedFieldCount: number;
  nodeSemantics: { role: string; defaultConnection: string; executor: string; safety?: string };
  statePath: string;
};

type HarnessNetwork = {
  componentCreateRequests: JsonRecord[];
  componentPutRequests: JsonRecord[];
  nodeConfigPatchRequests: JsonRecord[];
  graphMapRequests: JsonRecord[];
  workflowEdgeRequests: JsonRecord[];
  nodeDeleteRequests: JsonRecord[];
  nodeRestoreRequests: JsonRecord[];
  stopRequests: JsonRecord[];
  userFileRequests: JsonRecord[];
  workspaceTreeRequests: string[];
  workspaceTextRequests: JsonRecord[];
  workspaceFileRequests: string[];
  skillHubRequests: JsonRecord[];
  mcpHubRequests: JsonRecord[];
  timerActionRequests: JsonRecord[];
  goalActionRequests: JsonRecord[];
  pageErrors: string[];
  failedResponses: string[];
};

const nodeConfig = {
  role: 'main',
  customRole: '',
  prompt: 'Run inside WF UI and read backend workflow map/component nodes.',
  model: 'gpt-5-codex',
  provider: 'openai',
  cwd: repoRoot,
  env: { HARNESS_WORKFLOW_MAP: 'Harness/a2a/workflow-map.json' },
  permissions: { filesystem: 'workspace-write', network: 'enabled' },
  launchPolicy: { autoStart: false, restartOnSave: false },
  skills: ['wf-max', 'tdd', 'wf-browser'],
  skillPolicy: 'auto',
  recommendedSkills: ['wf-max', 'tdd', 'wf-browser'],
  contextSources: ['workflow-map', 'component-nodes', 'task-capsule'],
  capabilities: ['terminal', 'file-ops', 'browser'],
};

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function control() {
  return {
    canReadGraph: true,
    canModifyGraph: true,
    canStart: true,
    canStop: true,
    canDelete: true,
    canOpenTerminal: true,
    canOpenTranscript: true,
    canSendInput: true,
    canCreateAgent: true,
    canCreateComponentNode: true,
  };
}

function observableInputsForType(type: ComponentType) {
  if (type === 'markdown') return ['markdown'];
  if (type === 'file') return ['file'];
  return ['scene'];
}

function observableOutputsForType(type: ComponentType) {
  if (type === 'markdown') return ['markdown', 'plainText'];
  if (type === 'file') return ['file', 'path'];
  return ['scene', 'image'];
}

function primaryOutputForType(type: ComponentType) {
  return observableOutputsForType(type)[0];
}

function defaultComponentState(type: ComponentType, nodeId: string): ComponentState {
  const title = type === 'markdown' ? 'M3 Notes' : type === 'file' ? 'M3 File' : 'M3 Diagram';
  return {
    nodeId,
    type,
    title,
    revision: 1,
    markdown: type === 'markdown' ? '# M3 Notes\n\nInitial backend text.' : undefined,
    scene: type === 'excalidraw'
      ? { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }
      : undefined,
    file: type === 'file'
      ? { source: 'workspace', path: 'package.json', name: 'package.json', mime: 'application/json', size: 820 }
      : undefined,
    observableInputs: observableInputsForType(type),
    observableOutputs: observableOutputsForType(type),
    statePath: `Harness/a2a/component-nodes/${nodeId}/state.json`,
  };
}

function defaultTimerState(nodeId: string): EventState {
  return {
    nodeId,
    type: 'timer',
    title: 'M3 Timer',
    revision: 1,
    enabled: false,
    schedule: { mode: 'manual', intervalSeconds: 60, cron: '', cadence: { kind: 'fixed' } },
    heartbeat: {
      base: { enabled: false, intervalSeconds: 60, count: 0 },
      watchdog: { enabled: false, intervalSeconds: 600, timeoutSeconds: 1800, missedCount: 0, state: 'ok' },
    },
    controlPolicy: { agentCanDisable: true, agentCanSetInterval: true, minIntervalSeconds: 5, maxIntervalSeconds: 86400 },
    payloadTemplate: {},
    eventCount: 0,
    lastFiredAt: '',
    lastEvent: null,
    statePath: `Harness/a2a/event-nodes/${nodeId}/state.json`,
  };
}

function nextTimerDueAt(seconds: number) {
  return new Date(Date.now() + Math.max(1, Math.floor(Number(seconds) || 60)) * 1000).toISOString();
}

function scheduleTimerDueState(state: EventState): EventState {
  const intervalSeconds = Number(state.heartbeat?.base?.intervalSeconds || state.schedule?.intervalSeconds || 60);
  const running = Boolean(state.enabled && state.heartbeat?.base?.enabled);
  return {
    ...state,
    heartbeat: {
      ...(state.heartbeat || {}),
      base: {
        ...(state.heartbeat?.base || {}),
        intervalSeconds,
        nextDueAt: running ? nextTimerDueAt(intervalSeconds) : '',
      },
    },
  };
}

function applyTimerActionState(eventState: EventState, action: string, payload: JsonRecord, nodeId: string): EventState {
  const payloadHeartbeat = payload.heartbeat && typeof payload.heartbeat === 'object' && !Array.isArray(payload.heartbeat)
    ? payload.heartbeat as JsonRecord
    : {};
  const payloadBase = payloadHeartbeat.base && typeof payloadHeartbeat.base === 'object' && !Array.isArray(payloadHeartbeat.base)
    ? payloadHeartbeat.base as JsonRecord
    : {};
  const payloadWatchdog = payloadHeartbeat.watchdog && typeof payloadHeartbeat.watchdog === 'object' && !Array.isArray(payloadHeartbeat.watchdog)
    ? payloadHeartbeat.watchdog as JsonRecord
    : {};
  if (action === 'timer.configure') {
    return scheduleTimerDueState({
      ...eventState,
      ...payload,
      nodeId,
      type: eventState.type,
      title: String(payload.title || eventState.title),
      schedule: { ...eventState.schedule, ...(payload.schedule || {}) },
      heartbeat: {
        ...eventState.heartbeat,
        ...payloadHeartbeat,
        base: { ...(eventState.heartbeat?.base || {}), ...payloadBase },
        watchdog: { ...(eventState.heartbeat?.watchdog || {}), ...payloadWatchdog },
      },
      revision: eventState.revision + 1,
      statePath: eventState.statePath,
    });
  }
  if (action === 'timer.setInterval') {
    const intervalSeconds = Math.max(1, Math.floor(Number(payload.intervalSeconds || eventState.schedule?.intervalSeconds || 60)));
    const lane = String(payload.lane || 'base');
    return scheduleTimerDueState({
      ...eventState,
      schedule: { ...eventState.schedule, intervalSeconds },
      heartbeat: {
        ...eventState.heartbeat,
        base: {
          ...(eventState.heartbeat?.base || {}),
          intervalSeconds: lane === 'watchdog' ? Number(eventState.heartbeat?.base?.intervalSeconds || eventState.schedule?.intervalSeconds || 60) : intervalSeconds,
        },
        watchdog: {
          ...(eventState.heartbeat?.watchdog || {}),
          intervalSeconds: lane === 'watchdog' ? intervalSeconds : Number(eventState.heartbeat?.watchdog?.intervalSeconds || 600),
        },
      },
      revision: eventState.revision + 1,
    });
  }
  if (action === 'timer.enable') {
    return scheduleTimerDueState({
      ...eventState,
      enabled: true,
      heartbeat: {
        ...eventState.heartbeat,
        base: { ...(eventState.heartbeat?.base || {}), enabled: true },
      },
      revision: eventState.revision + 1,
    });
  }
  if (action === 'timer.disable') {
    return scheduleTimerDueState({
      ...eventState,
      enabled: false,
      heartbeat: {
        ...eventState.heartbeat,
        base: { ...(eventState.heartbeat?.base || {}), enabled: false },
      },
      revision: eventState.revision + 1,
    });
  }
  return eventState;
}

function defaultGoalState(nodeId: string = goalNodeId): GoalState {
  return {
    nodeId,
    type: 'goal',
    title: 'W14 Goal',
    taskId: 'task-w14-e2e',
    objective: 'Ship Advanced Timer and Goal node.',
    status: 'active',
    phase: 'implement',
    gate: 'TEST-GATE',
    revision: 1,
    acceptance: [
      { id: 'W14-TIMER', text: 'Advanced Timer renders heartbeat and health state.', status: 'tracked' },
      { id: 'W14-GOAL', text: 'Goal node renders objective and completion state.', status: 'tracked' },
    ],
    progress: { verified: 0, total: 2 },
    nextAction: 'Run Agent interaction checks.',
    blocker: null,
    activeQuestion: null,
    confirmation: { required: true },
    wdt: { timerNodeId, state: 'ok', staleAfterMs: 1800000 },
    stateRef: { path: 'Harness/tasks/task-w14-e2e/STATE.json', revision: 1 },
    contentRef: { planPath: 'Harness/tasks/task-w14-e2e/PLAN.md', progressPath: 'Harness/tasks/task-w14-e2e/PROGRESS.md' },
    statePath: 'Harness/tasks/task-w14-e2e/STATE.json',
  };
}

function defaultCapabilityState(
  nodeId: string,
  skills: CapabilityState['skills'] = [],
  type: CapabilityType = 'skill-group',
  servers: JsonRecord[] = [],
): CapabilityState {
  const isMcp = type === 'mcp-connector';
  return {
    nodeId,
    type,
    title: isMcp ? 'MCP Connector' : 'Workflow skills',
    revision: 1,
    description: isMcp ? 'MCP connector from MCP Hub' : 'Capability pack from Skills Hub',
    sourceGroup: isMcp
      ? { id: 'source:project-mcp', label: 'Project MCP config', kind: 'mcp-source' }
      : { id: 'recommended:workflow', label: 'Workflow skills', kind: 'recommended' },
    skills,
    skillNames: skills.map(skill => skill.name),
    skillCount: skills.length,
    servers,
    serverNames: servers.map(server => String(server.name || '')).filter(Boolean),
    serverCount: servers.length,
    transports: [...new Set(servers.map(server => String(server.transport || '')).filter(Boolean))],
    envKeyNames: [...new Set(servers.flatMap(server => Array.isArray(server.envKeys) ? server.envKeys.map(String) : []))],
    envKeyCount: [...new Set(servers.flatMap(server => Array.isArray(server.envKeys) ? server.envKeys.map(String) : []))].length,
    redactedFieldCount: servers.filter(server => server.risk?.secretsRedacted).length,
    nodeSemantics: {
      role: isMcp ? 'agent-attached-mcp-provider' : 'agent-attached-capability-provider',
      defaultConnection: 'bidirectional capability port to Agent nodes',
      executor: 'agent',
      ...(isMcp ? { safety: 'metadata-only-no-spawn-no-secret' } : {}),
    },
    statePath: `Harness/a2a/capability-nodes/${nodeId}/state.json`,
  };
}

function mcpServerFixture(serverId: string): JsonRecord {
  if (serverId.includes(':docs')) {
    return {
      id: 'mcp:project-cursor:docs',
      name: 'docs',
      title: 'docs',
      kind: 'mcp-server',
      nodeSemantics: 'agent-attached-mcp-provider',
      attachable: false,
      creatable: true,
      state: 'indexed',
      transport: 'http',
      url: 'https://docs.example.test/mcp',
      envKeys: [],
      risk: { metadataOnly: true, commandNotExecuted: true, credentialsNotProbed: true, secretsRedacted: true },
      sources: [{ rootId: 'project-cursor', label: 'Cursor MCP config', scope: 'project', runtime: 'cursor', relativePath: 'mcp.json', path: '.cursor/mcp.json' }],
    };
  }
  return {
    id: 'mcp:project-mcp:github',
    name: 'github',
    title: 'github',
    kind: 'mcp-server',
    nodeSemantics: 'agent-attached-mcp-provider',
    attachable: false,
    creatable: true,
    state: 'indexed',
    transport: 'stdio',
    commandName: 'npx',
    argCount: 1,
    envKeys: ['GITHUB_TOKEN'],
    risk: { metadataOnly: true, commandNotExecuted: true, credentialsNotProbed: true, secretsRedacted: true },
    sources: [{ rootId: 'project-mcp', label: 'Project MCP config', scope: 'project', runtime: 'mcp', relativePath: '.mcp.json', path: '.mcp.json' }],
  };
}

function componentNodeSnapshot(state: ComponentState, position: { x: number; y: number }) {
  return {
    id: state.nodeId,
    label: state.title,
    kind: 'component-node',
    componentType: state.type,
    type: state.type,
    level: 0,
    status: 'ready',
    lifecycle: 'stateful',
    runtimeState: 'ready',
    managedByCurrentServer: true,
    control: control(),
    graphNodeId: state.nodeId,
    revision: state.revision,
    statePath: state.statePath,
    observableInputs: state.observableInputs,
    observableOutputs: state.observableOutputs,
    position,
  };
}

function capabilityNodeSnapshot(state: CapabilityState, position: { x: number; y: number }) {
  return {
    id: state.nodeId,
    label: state.title,
    kind: 'capability-node',
    type: state.type,
    level: 0,
    status: 'ready',
    lifecycle: 'capability-provider',
    runtimeState: 'ready',
    managedByCurrentServer: true,
    control: control(),
    position,
    statePath: state.statePath,
    revision: state.revision,
    graphNodeId: state.nodeId,
  };
}

function eventNodeSnapshot(state: EventState, position: { x: number; y: number }) {
  return {
    id: state.nodeId,
    nodeId: state.nodeId,
    label: state.title,
    title: state.title,
    kind: 'event-node',
    type: state.type,
    level: 0,
    status: 'ready',
    lifecycle: 'event-source',
    runtimeState: 'ready',
    managedByCurrentServer: true,
    control: control(),
    graphNodeId: state.nodeId,
    revision: state.revision,
    statePath: state.statePath,
    position,
  };
}

function runtimeNodeSnapshot(state: ComponentState, position: { x: number; y: number }) {
  const primaryPort = state.type === 'markdown' ? 'markdown' : state.type === 'excalidraw' ? 'scene' : 'file';
  const handles = state.type === 'markdown' || state.type === 'excalidraw'
    ? {
        inputs: [],
        outputs: [],
        bidirectional: [primaryPort],
        ports: [primaryPort],
        physical: [`${primaryPort}:left`, `${primaryPort}:right`],
      }
    : [
        ...state.observableInputs.map(id => ({ id, role: 'input', type: id, label: id })),
        ...state.observableOutputs.map(id => ({ id, role: 'output', type: id, label: id })),
      ];
  return {
    nodeId: state.nodeId,
    kind: state.type,
    version: state.revision,
    lifecycle: 'ready',
    status: { state: 'ready', updatedAt: '2026-08-01T00:00:00.000Z' },
    graph: {
      position,
      handles,
      connections: [],
    },
    stateRef: { path: state.statePath, revision: state.revision },
    contentRef: state.type === 'file'
      ? state.file
      : { kind: 'component-state', statePath: state.statePath, revision: state.revision },
    settings: { schemaId: `${state.type}-settings`, values: {}, revision: 0 },
    capabilities: ['state:read', 'state:update'],
    ui: {
      previewKind: state.type,
      settingsPanel: `${state.type}-settings`,
      testId: `workflow-${state.type}-node`,
      labels: { title: state.title },
    },
  };
}

function timerRuntimeNodeSnapshot(state: EventState, position: { x: number; y: number }) {
  return {
    nodeId: state.nodeId,
    kind: 'timer',
    version: state.revision,
    lifecycle: 'event-source',
    status: { state: 'ready', updatedAt: '2026-08-05T00:00:00.000Z' },
    graph: {
      position,
      handles: {
        inputs: ['config'],
        outputs: ['event'],
        bidirectional: ['status'],
        ports: ['event', 'config', 'status'],
        physical: ['config:left', 'event:right', 'status:bottom'],
        directions: {
          event: 'source-to-target',
          config: 'target-only',
          status: 'bidirectional',
        },
      },
      connections: [],
    },
    stateRef: { path: state.statePath, revision: state.revision },
    contentRef: { kind: 'event-node-state', statePath: state.statePath, revision: state.revision, eventKind: 'timer' },
    settings: { schemaId: 'timer-settings', values: {}, revision: 0 },
    capabilities: ['state:read', 'state:update', 'timer.read', 'timer.configure', 'timer.fire', 'timer.enable', 'timer.disable', 'timer.setInterval', 'timer.setMode', 'timer.ackWatchdog', 'timer.resetWatchdog', 'timer.tick', 'event:emit'],
    ui: {
      previewKind: 'timer',
      settingsPanel: 'timer-settings',
      testId: 'workflow-event-node',
      labels: { title: state.title },
    },
  };
}

function goalRuntimeNodeSnapshot(state: GoalState, position: { x: number; y: number }) {
  return {
    nodeId: state.nodeId,
    kind: 'goal',
    version: state.revision,
    lifecycle: 'goal-anchor',
    status: { state: state.status, updatedAt: '2026-08-05T00:00:00.000Z' },
    graph: {
      position,
      handles: {
        inputs: [],
        outputs: [],
        bidirectional: ['goal'],
        ports: ['goal'],
        physical: ['goal:left', 'goal:right'],
        directions: { goal: 'bidirectional' },
      },
      connections: [],
    },
    stateRef: state.stateRef,
    contentRef: { kind: 'goal-node-state', ...state.contentRef, taskId: state.taskId },
    settings: { schemaId: 'goal-settings', values: {}, revision: 0 },
    capabilities: ['goal.read', 'goal.requestCompletion', 'goal.confirmCompletion', 'goal.returnToWork'],
    ui: {
      previewKind: 'goal',
      settingsPanel: 'goal-settings',
      testId: 'workflow-goal-node',
      labels: { title: state.title },
    },
  };
}

function capabilityRuntimeNodeSnapshot(state: CapabilityState, position: { x: number; y: number }) {
  const isMcp = state.type === 'mcp-connector';
  return {
    nodeId: state.nodeId,
    kind: state.type,
    version: state.revision,
    lifecycle: 'capability-provider',
    status: { state: 'ready', updatedAt: '2026-08-05T00:00:00.000Z' },
    graph: {
      position,
      handles: {
        inputs: [],
        outputs: [],
        bidirectional: ['capability'],
        ports: ['capability'],
        physical: ['capability:left', 'capability:right'],
        directions: { capability: 'bidirectional' },
      },
      connections: [],
    },
    stateRef: { path: state.statePath, revision: state.revision },
    contentRef: { kind: 'capability-node-state', statePath: state.statePath, revision: state.revision, capabilityKind: state.type },
    settings: { schemaId: `${state.type}-settings`, values: {}, revision: 0 },
    capabilities: isMcp
      ? ['state:read', 'state:update', 'mcp-connector.read', 'mcp-connector.configure', 'capability:read', 'mcp:metadata:read']
      : ['state:read', 'state:update', 'skill-group.read', 'skill-group.configure', 'capability:read'],
    ui: {
      previewKind: state.type,
      settingsPanel: `${state.type}-settings`,
      testId: 'workflow-capability-node',
      labels: { title: state.title },
    },
  };
}

function workflowSnapshot(components: ComponentState[] = [], options: { includeInitialEdges?: boolean; events?: EventState[]; capabilities?: CapabilityState[]; goals?: GoalState[]; graphEdges?: JsonRecord[]; capsuleDockLinks?: JsonRecord[]; agentCanDelete?: boolean } = {}) {
  const includeInitialEdges = options.includeInitialEdges !== false;
  const events = options.events || [];
  const capabilities = options.capabilities || [];
  const goals = options.goals || [];
  const graphEdges = options.graphEdges || [];
  const componentNodes = components.map((state, index) => componentNodeSnapshot(state, {
    x: 260 + (index * 360),
    y: 420,
  }));
  const eventNodes = events.map((state, index) => eventNodeSnapshot(state, {
    x: 300 + (index * 320),
    y: 610,
  }));
  const capabilityNodes = capabilities.map((state, index) => capabilityNodeSnapshot(state, {
    x: 300 + (index * 320),
    y: 610,
  }));
  const goalNodes = goals.map((state, index) => ({
    id: state.nodeId,
    label: state.title,
    kind: 'goal-node',
    type: 'goal',
    level: 0,
    status: state.status,
    lifecycle: 'goal-anchor',
    runtimeState: state.status,
    managedByCurrentServer: true,
    revision: state.revision,
    statePath: state.statePath,
    position: { x: 960 + (index * 340), y: 180 },
  }));
  const graphComponentNodes = componentNodes.map(node => ({
    nodeId: node.id,
    kind: 'component-node',
    componentType: node.componentType,
    status: 'ready',
    lifecycle: 'stateful',
    runtimeState: 'ready',
    managedByCurrentServer: true,
    control: control(),
    position: node.position,
    statePath: node.statePath,
    revision: node.revision,
    stateRef: { path: node.statePath, revision: node.revision },
  }));
  const componentStateRefs = Object.fromEntries(components.map(state => [state.nodeId, {
    type: state.type,
    title: state.title,
    statePath: state.statePath,
    revision: state.revision,
    ...(state.file ? { file: state.file } : {}),
  }]));
  const eventStateRefs = Object.fromEntries(events.map(state => [state.nodeId, {
    type: state.type,
    eventKind: state.type,
    title: state.title,
    statePath: state.statePath,
    revision: state.revision,
    schedule: state.schedule,
    lastEvent: state.lastEvent,
    lastFiredAt: state.lastFiredAt,
    eventCount: state.eventCount,
  }]));
  const capabilityStateRefs = Object.fromEntries(capabilities.map(state => [state.nodeId, {
    type: state.type,
    capabilityKind: state.type,
    title: state.title,
    statePath: state.statePath,
    revision: state.revision,
    sourceGroup: state.sourceGroup,
    skills: state.skills,
    skillNames: state.skillNames,
    skillCount: state.skillCount,
    nodeSemantics: state.nodeSemantics,
  }]));
  const goalStateRefs = Object.fromEntries(goals.map(state => [state.nodeId, {
    type: 'goal',
    title: state.title,
    taskId: state.taskId,
    objective: state.objective,
    status: state.status,
    phase: state.phase,
    gate: state.gate,
    statePath: state.statePath,
    revision: state.revision,
    acceptance: state.acceptance,
    progress: state.progress,
    nextAction: state.nextAction,
    confirmation: state.confirmation,
    wdt: state.wdt,
    stateRef: state.stateRef,
    contentRef: state.contentRef,
  }]));
  const initialSourceHandle = components.length > 0 ? primaryOutputForType(components[0].type) : 'output';
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-m3',
    taskId: 'task-define-workflow-context-surface',
    mode: 'wf-max',
    phase: 'm3-red',
    gate: 'TEST-GATE',
    rootAgentId: graphNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [{
      sessionId,
      runtime: 'codex',
      role: nodeConfig.role,
      objective: nodeConfig.prompt,
      status: 'running',
      attachMode: true,
      wsClientCount: 1,
      agentKind: nodeConfig.role,
      workflowMode: 'wf-max',
      cwd: nodeConfig.cwd,
      graphNodeId,
      config: nodeConfig,
      inputOwnerId: 'drawer',
    }],
    nodes: [{
      id: graphNodeId,
      label: 'M3 Agent',
      kind: 'terminal-session',
      level: 0,
      status: 'running',
      lifecycle: 'live',
      runtimeState: 'running',
      managedByCurrentServer: true,
      control: { ...control(), canDelete: options.agentCanDelete ?? true },
      role: nodeConfig.role,
      skills: nodeConfig.skills,
      permissions: nodeConfig.permissions,
      sessionId,
      taskId: 'task-define-workflow-context-surface',
      agentKind: nodeConfig.role,
      runtime: 'codex',
      peerId: 'codex',
      objective: nodeConfig.prompt,
      cwd: nodeConfig.cwd,
      graphNodeId,
      config: nodeConfig,
    }, ...componentNodes, ...eventNodes, ...capabilityNodes, ...goalNodes],
    edges: [
      ...(includeInitialEdges && components.length > 0 ? [{
      id: `edge-${components[0].nodeId}-${graphNodeId}`,
      source: components[0].nodeId,
      target: graphNodeId,
      sourceHandle: initialSourceHandle,
      targetHandle: 'context',
      relation: 'wf-bridge/context',
      direction: 'bidirectional',
      label: `${initialSourceHandle} <-> context`,
    }] : []),
      ...graphEdges.map(edge => ({
        id: edge.id,
        source: edge.source || edge.from,
        target: edge.target || edge.to,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        relation: edge.relation || 'wf-bridge',
        direction: edge.direction || 'bidirectional',
        label: `${edge.relation || 'wf-bridge'}`,
      })),
    ],
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-m3',
      version: 1,
      nodes: [{
        nodeId: graphNodeId,
        sessionId,
        agentKind: nodeConfig.role,
        runtime: 'codex',
        status: 'running',
        lifecycle: 'live',
        runtimeState: 'running',
        managedByCurrentServer: true,
        control: control(),
        taskId: 'task-define-workflow-context-surface',
        cwd: repoRoot,
        position: { x: 620, y: 180 },
        config: nodeConfig,
      }, ...graphComponentNodes, ...eventNodes.map(node => ({
        nodeId: node.id,
        kind: 'event-node',
        type: node.type,
        status: 'ready',
        lifecycle: 'event-source',
        runtimeState: 'ready',
        managedByCurrentServer: true,
        control: control(),
        position: node.position,
        statePath: node.statePath,
        revision: node.revision,
        stateRef: { path: node.statePath, revision: node.revision },
      })), ...capabilityNodes.map(node => ({
        nodeId: node.id,
        kind: 'capability-node',
        type: node.type,
        status: 'ready',
        lifecycle: 'capability-provider',
        runtimeState: 'ready',
        managedByCurrentServer: true,
        control: control(),
        position: node.position,
        statePath: node.statePath,
        revision: node.revision,
        stateRef: { path: node.statePath, revision: node.revision },
      })), ...goalNodes.map(node => ({
        nodeId: node.id,
        kind: 'goal-node',
        type: 'goal',
        status: node.status,
        lifecycle: 'goal-anchor',
        runtimeState: node.runtimeState,
        managedByCurrentServer: true,
        control: control(),
        position: node.position,
        statePath: node.statePath,
        revision: node.revision,
        stateRef: { path: node.statePath, revision: node.revision },
      }))],
      edges: [
        ...(includeInitialEdges && components.length > 0 ? [{
        id: `edge-${components[0].nodeId}-${graphNodeId}`,
        from: components[0].nodeId,
        to: graphNodeId,
        source: components[0].nodeId,
        target: graphNodeId,
        relation: 'wf-bridge/context',
        direction: 'bidirectional',
        sourceHandle: initialSourceHandle,
        targetHandle: 'context',
      }] : []),
        ...graphEdges,
      ],
      capsuleDockLinks: options.capsuleDockLinks || [],
      positions: {
        [graphNodeId]: { x: 620, y: 180 },
        ...Object.fromEntries(componentNodes.map(node => [node.id, node.position])),
        ...Object.fromEntries(eventNodes.map(node => [node.id, node.position])),
        ...Object.fromEntries(capabilityNodes.map(node => [node.id, node.position])),
        ...Object.fromEntries(goalNodes.map(node => [node.id, node.position])),
      },
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes',
      sourceOfTruth: 'backend',
      componentStateRefs,
      eventStateRefs,
      capabilityStateRefs,
      goalStateRefs,
    },
    componentNodes: Object.fromEntries(components.map(state => [state.nodeId, state])),
    eventNodes: Object.fromEntries(events.map(state => [state.nodeId, state])),
    capabilityNodes: Object.fromEntries(capabilities.map(state => [state.nodeId, state])),
    goalNodes: Object.fromEntries(goals.map(state => [state.nodeId, state])),
    graphContextBySessionId: {
      [sessionId]: {
        workflowMapPath: 'Harness/a2a/workflow-map.json',
        componentStatePath: 'Harness/a2a/component-nodes',
        sourceOfTruth: 'backend',
        componentStateRefs,
        eventStateRefs,
        capabilityStateRefs,
        goalStateRefs,
      },
    },
  };
}

function workspaceEntries(relPath: string) {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const table: Record<string, unknown[]> = {
    '': [
      { name: 'src', path: 'src', type: 'directory', size: 0, hasChildren: true },
      { name: 'Harness', path: 'Harness', type: 'directory', size: 0, hasChildren: true },
      { name: 'package.json', path: 'package.json', type: 'file', size: 820, hasChildren: false },
    ],
  };
  return table[normalized] || [];
}

async function installWorkflowFixture(
  page: Page,
  options: { initialComponents?: ComponentState[]; initialEvents?: EventState[]; initialCapabilities?: CapabilityState[]; initialGoals?: GoalState[]; initialGraphEdges?: JsonRecord[]; agentCanDelete?: boolean; deleteActionDelayMs?: number; failNextPut?: number; includeInitialEdges?: boolean } = {},
): Promise<HarnessNetwork> {
  const network: HarnessNetwork = {
    componentCreateRequests: [],
    componentPutRequests: [],
    nodeConfigPatchRequests: [],
    graphMapRequests: [],
    workflowEdgeRequests: [],
    nodeDeleteRequests: [],
    nodeRestoreRequests: [],
    stopRequests: [],
    userFileRequests: [],
    workspaceTreeRequests: [],
    workspaceTextRequests: [],
    workspaceFileRequests: [],
    skillHubRequests: [],
    mcpHubRequests: [],
    timerActionRequests: [],
    goalActionRequests: [],
    pageErrors: [],
    failedResponses: [],
  };
  const components = new Map<string, ComponentState>();
  for (const state of options.initialComponents || []) {
    components.set(state.nodeId, { ...state });
  }
  const timers = new Map<string, EventState>();
  for (const state of options.initialEvents || []) {
    timers.set(state.nodeId, { ...state });
  }
  const capabilities = new Map<string, CapabilityState>();
  for (const state of options.initialCapabilities || []) {
    capabilities.set(state.nodeId, { ...state });
  }
  const goals = new Map<string, GoalState>();
  for (const state of options.initialGoals || []) {
    goals.set(state.nodeId, { ...state });
  }
  const deletedGoals = new Map<string, GoalState>();
  const graphEdges: JsonRecord[] = [...(options.initialGraphEdges || [])];
  let capsuleDockLinks: JsonRecord[] = [];
  let graphVersion = 1;
  const deleteActionDelayMs = Math.max(0, Number(options.deleteActionDelayMs || 0));
  let failNextPut = options.failNextPut;
  let currentNodeConfig: JsonRecord = {
    ...nodeConfig,
    skills: [...nodeConfig.skills],
    contextSources: [...nodeConfig.contextSources],
    capabilities: [...nodeConfig.capabilities],
  };

  page.on('pageerror', error => network.pageErrors.push(error.message));
  page.on('response', response => {
    const isExpectedPutFailure = response.url().includes('/api/workflow/nodes/') && response.status() === failNextPut;
    if (response.status() >= 400 && !response.url().includes('/favicon.ico') && !isExpectedPutFailure) {
      network.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, {
    taskId: 'task-define-workflow-context-surface',
    phase: 'm3-red',
    gate: 'TEST-GATE',
  }));
  await page.route('**/api/runtimes**', route => jsonResponse(route, [{
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    path: 'codex',
    version: 'test',
    status: 'available',
    launchable: true,
    adapterStatus: 'ok',
    capabilities: ['terminal'],
  }]));
  await page.route('**/api/tasks**', route => jsonResponse(route, [{
    taskId: 'task-define-workflow-context-surface',
    status: 'open',
    phase: 'm3-red',
  }]));
  const currentSnapshot = () => workflowSnapshot([...components.values()], {
    includeInitialEdges: options.includeInitialEdges,
    agentCanDelete: options.agentCanDelete,
    events: [...timers.values()],
    capabilities: [...capabilities.values()],
    goals: [...goals.values()],
    graphEdges,
    capsuleDockLinks,
  });
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, currentSnapshot()));
  await page.route('**/api/a2a/graph-map**', async route => {
    const payload = route.request().postDataJSON() as JsonRecord || {};
    network.graphMapRequests.push({
      method: route.request().method(),
      payload,
    });
    if (route.request().method() === 'PUT') {
      if (Array.isArray(payload.edges)) {
        graphEdges.splice(0, graphEdges.length, ...payload.edges.map((edge: JsonRecord) => ({
          ...edge,
          id: String(edge.id || `${edge.from || edge.source}->${edge.to || edge.target}`),
          from: edge.from || edge.source,
          to: edge.to || edge.target,
          source: edge.source || edge.from,
          target: edge.target || edge.to,
        })));
      }
      capsuleDockLinks = Array.isArray(payload.capsuleDockLinks) ? [...payload.capsuleDockLinks] : [];
      graphVersion += 1;
    }
    const snapshot = currentSnapshot();
    snapshot.graph.version = graphVersion;
    return jsonResponse(route, {
      ok: true,
      revision: graphVersion,
      graph: snapshot.graph,
      sourceOfTruth: 'backend',
    });
  });
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, currentSnapshot().sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, {
    entries: [{ seq: 1, stream: 'stdout', data: '\r\nM3 terminal fixture ready\r\n' }],
  }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/stop', async route => {
    network.stopRequests.push({ url: route.request().url() });
    return jsonResponse(route, { ok: true, stopped: { status: 'stopped' } });
  });
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/workspace/tree**', route => {
    const url = new URL(route.request().url());
    const relPath = url.searchParams.get('path') || '';
    network.workspaceTreeRequests.push(relPath);
    return jsonResponse(route, {
      root: repoRoot,
      path: relPath,
      entries: workspaceEntries(relPath),
    });
  });
  await page.route('**/api/workspace/text**', route => {
    const url = new URL(route.request().url());
    network.workspaceTextRequests.push({
      method: route.request().method(),
      path: url.searchParams.get('path') || '',
      offset: url.searchParams.get('offset') || '',
      limit: url.searchParams.get('limit') || '',
    });
    return jsonResponse(route, {
      text: 'AC-002 bounded file preview fixture from the workspace text pipe.\nSecond preview line.',
      bytesRead: 82,
      truncated: true,
      encoding: 'utf-8',
    });
  });
  await page.route('**/api/user-files', async route => {
    const payload = route.request().postDataJSON() as JsonRecord;
    network.userFileRequests.push(payload);
    const files = (payload.files || []).map((file: JsonRecord) => {
      const category = String(file.mime || '').startsWith('image/') ? 'images' : 'other';
      const savedPath = `Harness/user-files/${category}/${file.name || 'user-file'}`;
      return {
        name: file.name,
        path: savedPath,
        mime: file.mime,
        size: file.size,
        terminalTag: `@file(${savedPath})`,
        absolutePath: path.join(repoRoot, savedPath),
      };
    });
    return jsonResponse(route, { ok: true, files });
  });
  await page.route('**/api/workspace/file**', route => {
    network.workspaceFileRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"fixture":true}',
    });
  });
  await page.route('**/api/workflow/skills-hub**', route => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') || '').toLowerCase();
    network.skillHubRequests.push({
      scope: url.searchParams.get('scope') || '',
      q,
    });
    const skills = [
      {
        id: 'skill:wf-ui',
        name: 'wf-ui',
        title: 'WF-UI Adapter',
        description: 'Open and control the local workflow UI.',
        kind: 'skill',
        nodeSemantics: 'agent-attached-capability-provider',
        attachable: true,
        state: 'indexed',
        sources: [{ rootId: 'project-agents', label: 'Project Codex skills', scope: 'project', runtime: 'codex', relativePath: 'wf-ui/SKILL.md', path: '.agents/skills/wf-ui/SKILL.md' }],
      },
      {
        id: 'skill:browser-lab',
        name: 'browser-lab',
        title: 'Browser Lab',
        description: 'Browser verification helper.',
        kind: 'skill',
        nodeSemantics: 'agent-attached-capability-provider',
        attachable: true,
        state: 'indexed',
        sources: [{ rootId: 'project-agents', label: 'Project Codex skills', scope: 'project', runtime: 'codex', relativePath: 'browser-lab/SKILL.md', path: '.agents/skills/browser-lab/SKILL.md' }],
      },
    ].filter(skill => !q || `${skill.name} ${skill.title} ${skill.description}`.toLowerCase().includes(q));
    return jsonResponse(route, {
      ok: true,
      schemaVersion: 1,
      kind: 'skills-hub',
      generatedAt: '2026-08-05T00:00:00.000Z',
      query: { scope: url.searchParams.get('scope') || 'project', q, limit: 250 },
      roots: [{ id: 'project-agents', label: 'Project Codex skills', scope: 'project', runtime: 'codex', exists: true, path: '.agents/skills' }],
      summary: { skillCount: skills.length, groupCount: 1, sourceCount: 1 },
      nodeSemantics: {
        role: 'agent-attached-capability-provider',
        defaultConnection: 'bidirectional capability/status port to Agent nodes',
        executor: 'agent',
      },
      skills,
      groups: [{ id: 'recommended:workflow', label: 'Workflow skills', kind: 'recommended', skillIds: skills.map(skill => skill.id) }],
    });
  });
  await page.route('**/api/workflow/mcp-hub**', route => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') || '').toLowerCase();
    network.mcpHubRequests.push({
      scope: url.searchParams.get('scope') || '',
      q,
    });
    const servers = [
      {
        id: 'mcp:project-mcp:github',
        name: 'github',
        title: 'github',
        kind: 'mcp-server',
        nodeSemantics: 'agent-attached-mcp-provider',
        attachable: false,
        creatable: true,
        state: 'indexed',
        transport: 'stdio',
        commandName: 'npx',
        argCount: 2,
        url: '',
        envKeys: ['GITHUB_TOKEN'],
        risk: { metadataOnly: true, commandNotExecuted: true, credentialsNotProbed: true, secretsRedacted: true },
        sources: [{ rootId: 'project-mcp', label: 'Project MCP config', scope: 'project', runtime: 'mcp', relativePath: '.mcp.json', path: '.mcp.json' }],
      },
      {
        id: 'mcp:project-cursor:docs',
        name: 'docs',
        title: 'docs',
        kind: 'mcp-server',
        nodeSemantics: 'agent-attached-mcp-provider',
        attachable: false,
        creatable: true,
        state: 'indexed',
        transport: 'http',
        commandName: '',
        argCount: 0,
        url: 'https://docs.example.test/mcp',
        envKeys: [],
        risk: { metadataOnly: true, commandNotExecuted: true, credentialsNotProbed: true, secretsRedacted: true },
        sources: [{ rootId: 'project-cursor', label: 'Cursor MCP config', scope: 'project', runtime: 'cursor', relativePath: 'mcp.json', path: '.cursor/mcp.json' }],
      },
    ].filter(server => !q || `${server.name} ${server.title} ${server.transport} ${server.commandName} ${server.url} ${server.envKeys.join(' ')}`.toLowerCase().includes(q));
    return jsonResponse(route, {
      ok: true,
      schemaVersion: 1,
      kind: 'mcp-hub',
      generatedAt: '2026-08-05T00:00:00.000Z',
      query: { scope: url.searchParams.get('scope') || 'project', q, limit: 250 },
      roots: [
        { id: 'project-mcp', label: 'Project MCP config', scope: 'project', runtime: 'mcp', exists: true, path: '.mcp.json' },
        { id: 'project-cursor', label: 'Cursor MCP config', scope: 'project', runtime: 'cursor', exists: true, path: '.cursor/mcp.json' },
      ],
      summary: { serverCount: servers.length, groupCount: 2, sourceCount: 2, envKeyCount: servers.reduce((count, server) => count + server.envKeys.length, 0), redactedFieldCount: servers.filter(server => server.risk.secretsRedacted).length },
      nodeSemantics: {
        role: 'agent-attached-tool-resource-provider',
        defaultConnection: 'bidirectional capability/status port to Agent nodes',
        executor: 'agent',
        safety: 'metadata-only-no-spawn-no-secret',
      },
      servers,
      groups: [
        { id: 'transport:stdio', label: 'stdio transport', kind: 'transport', serverIds: servers.filter(server => server.transport === 'stdio').map(server => server.id) },
        { id: 'transport:http', label: 'http transport', kind: 'transport', serverIds: servers.filter(server => server.transport === 'http').map(server => server.id) },
      ].filter(group => group.serverIds.length > 0),
    });
  });
  await page.route('**/api/a2a/nodes/**/config', route => {
    const payload = route.request().postDataJSON() as JsonRecord;
    network.nodeConfigPatchRequests.push(payload);
    currentNodeConfig = {
      ...currentNodeConfig,
      ...payload,
      skills: Array.isArray(payload.skills) ? [...new Set(payload.skills.map(String).filter(Boolean))] : currentNodeConfig.skills,
    };
    return jsonResponse(route, {
      ok: true,
      node: { id: graphNodeId, config: currentNodeConfig },
      restartRequired: false,
      revision: 2 + network.nodeConfigPatchRequests.length,
    });
  });
  await page.route('**/api/a2a/nodes/**/restart', route => jsonResponse(route, {
    ok: true,
    nodeId: graphNodeId,
    sessionId: `${sessionId}-restarted`,
    restartRequired: false,
    revision: 3,
  }));
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, async route => {
    if (route.request().method() === 'GET') {
      return jsonResponse(route, {
        ok: true,
        nodes: [
          ...[...components.values()].map(state => runtimeNodeSnapshot(state, { x: 260, y: 420 })),
          ...[...timers.values()].map(state => timerRuntimeNodeSnapshot(state, { x: 300, y: 610 })),
          ...[...capabilities.values()].map(state => capabilityRuntimeNodeSnapshot(state, { x: 300, y: 610 })),
          ...[...goals.values()].map(state => goalRuntimeNodeSnapshot(state, { x: 960, y: 180 })),
        ],
      });
    }
    const payload = route.request().postDataJSON() as JsonRecord;
    network.componentCreateRequests.push(payload);
    if (payload.type === 'timer') {
      const state = defaultTimerState(`${timerNodeId}-${network.componentCreateRequests.length}`);
      state.title = payload.title || state.title;
      if (payload.schedule) state.schedule = { ...state.schedule, ...payload.schedule };
      if (payload.payloadTemplate) state.payloadTemplate = payload.payloadTemplate;
      timers.set(state.nodeId, state);
      return jsonResponse(route, {
        ok: true,
        node: timerRuntimeNodeSnapshot(state, payload.position || { x: 300, y: 610 }),
        state,
        revision: state.revision,
      });
    }
    if (payload.type === 'skill-group') {
      const skills = Array.isArray(payload.skills) ? payload.skills.map((skill: JsonRecord) => ({
        id: String(skill.id || ''),
        name: String(skill.name || skill.id || ''),
        title: String(skill.title || skill.name || skill.id || ''),
        description: String(skill.description || ''),
        source: String(skill.source || 'skills-hub'),
        state: String(skill.state || 'indexed'),
      })) : [];
      const state = defaultCapabilityState(`${skillGroupNodeId}-${network.componentCreateRequests.length}`, skills);
      state.title = payload.title || state.title;
      state.description = payload.description || state.description;
      state.sourceGroup = payload.sourceGroup || state.sourceGroup;
      capabilities.set(state.nodeId, state);
      return jsonResponse(route, {
        ok: true,
        node: capabilityRuntimeNodeSnapshot(state, payload.position || { x: 300, y: 610 }),
        state,
        revision: state.revision,
      }, 201);
    }
    if (payload.type === 'mcp-connector') {
      const server = mcpServerFixture(String(payload.mcpServerId || payload.serverId || 'mcp:project-mcp:github'));
      const state = defaultCapabilityState(`${mcpConnectorNodeId}-${network.componentCreateRequests.length}`, [], 'mcp-connector', [server]);
      state.title = payload.title || `${server.title || server.name} MCP`;
      capabilities.set(state.nodeId, state);
      return jsonResponse(route, {
        ok: true,
        node: capabilityRuntimeNodeSnapshot(state, payload.position || { x: 340, y: 650 }),
        state,
        revision: state.revision,
      }, 201);
    }
    if (payload.type === 'goal') {
      const state = defaultGoalState(goalNodeId);
      state.title = payload.title || state.title;
      goals.set(state.nodeId, state);
      return jsonResponse(route, {
        ok: true,
        node: goalRuntimeNodeSnapshot(state, payload.position || { x: 960, y: 180 }),
        state,
        revision: state.revision,
      }, 201);
    }
    const type = payload.type as ComponentType;
    const nodeId = type === 'markdown'
      ? markdownNodeId
      : type === 'file'
        ? `component-file-${network.componentCreateRequests.length}`
        : excalidrawNodeId;
    const state = defaultComponentState(type, nodeId);
    state.title = payload.title || state.title;
    if (payload.file) state.file = payload.file;
    if (payload.markdown) state.markdown = payload.markdown;
    components.set(nodeId, state);
    const backendState: Partial<ComponentState> = { ...state };
    delete backendState.statePath;
    delete backendState.title;
    return jsonResponse(route, {
      ok: true,
      node: runtimeNodeSnapshot(state, payload.position || { x: 260, y: 420 }),
      state: backendState,
      revision: state.revision,
    });
  });
  await page.route(/\/api\/workflow\/nodes\/.+/, async route => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/').filter(Boolean);
    const nodeId = parts[3] || '';
    if (route.request().method() === 'GET') {
      const eventState = timers.get(nodeId);
      if (eventState) {
        return jsonResponse(route, {
          ok: true,
          node: timerRuntimeNodeSnapshot(eventState, { x: 300, y: 610 }),
          state: eventState,
          revision: eventState.revision,
        });
      }
      const capabilityState = capabilities.get(nodeId);
      if (capabilityState) {
        return jsonResponse(route, {
          ok: true,
          node: capabilityRuntimeNodeSnapshot(capabilityState, { x: 300, y: 610 }),
          state: capabilityState,
          revision: capabilityState.revision,
        });
      }
      const goalState = goals.get(nodeId);
      if (goalState) {
        return jsonResponse(route, {
          ok: true,
          node: goalRuntimeNodeSnapshot(goalState, { x: 960, y: 180 }),
          state: goalState,
          revision: goalState.revision,
        });
      }
      const state = components.get(nodeId) || defaultComponentState('markdown', nodeId);
      return jsonResponse(route, {
        ok: true,
        node: runtimeNodeSnapshot(state, { x: 260, y: 420 }),
        state,
        revision: state.revision,
      });
    }
    if (route.request().method() === 'PATCH' && parts[4] === 'state') {
      const payload = route.request().postDataJSON() as JsonRecord;
      network.componentPutRequests.push({
        method: 'PATCH',
        nodeId,
        payload,
      });
      if (failNextPut) {
        const status = failNextPut;
        failNextPut = undefined;
        return jsonResponse(route, {
          ok: false,
          code: status === 409 ? 'STALE_REVISION' : 'COMPONENT_SAVE_FAILED',
          message: status === 409 ? 'Component node revision is stale.' : 'Network save failed.',
          currentRevision: (components.get(nodeId)?.revision || 1) + 1,
        }, status);
      }
      const current = components.get(nodeId) || defaultComponentState('markdown', nodeId);
      const updated: ComponentState = {
        ...current,
        ...payload,
        nodeId,
        type: current.type,
        title: payload.title || current.title,
        revision: current.revision + 1,
        observableInputs: payload.observableInputs || current.observableInputs,
        observableOutputs: payload.observableOutputs || current.observableOutputs,
        statePath: current.statePath,
      };
      components.set(nodeId, updated);
      return jsonResponse(route, {
        ok: true,
        node: runtimeNodeSnapshot(updated, { x: 260, y: 420 }),
        state: updated,
        revision: updated.revision,
      });
    }
    if (route.request().method() === 'POST' && parts[4] === 'actions') {
      const action = decodeURIComponent(parts[5] || '');
      if (action === 'node.delete') {
        network.nodeDeleteRequests.push({ nodeId });
        if (deleteActionDelayMs > 0) await new Promise(resolve => setTimeout(resolve, deleteActionDelayMs));
        const deletedGoal = goals.get(nodeId);
        if (deletedGoal) deletedGoals.set(nodeId, deletedGoal);
        components.delete(nodeId);
        timers.delete(nodeId);
        capabilities.delete(nodeId);
        goals.delete(nodeId);
        return jsonResponse(route, { ok: true, action, node: null, result: { ok: true, nodeId } });
      }
      if (action === 'node.restore') {
        network.nodeRestoreRequests.push({ nodeId, payload: route.request().postDataJSON() || {} });
        const restoredGoal = deletedGoals.get(nodeId);
        if (restoredGoal) goals.set(nodeId, restoredGoal);
        return jsonResponse(route, {
          ok: true,
          action,
          node: restoredGoal ? goalRuntimeNodeSnapshot(restoredGoal, { x: 960, y: 180 }) : null,
          result: { ok: true, nodeId },
        });
      }
      const eventState = timers.get(nodeId);
      if (eventState) {
        network.timerActionRequests.push({
          action,
          nodeId,
          payload: route.request().postDataJSON() || {},
        });
        const payload = route.request().postDataJSON() || {};
        const updated = applyTimerActionState(eventState, action, payload, nodeId);
        timers.set(nodeId, updated);
        return jsonResponse(route, {
          ok: true,
          action,
          node: timerRuntimeNodeSnapshot(updated, { x: 300, y: 610 }),
          result: { state: updated, schedule: updated.schedule, heartbeat: updated.heartbeat },
        });
      }
      const capabilityState = capabilities.get(nodeId);
      if (capabilityState) {
        return jsonResponse(route, {
          ok: true,
          action,
          node: capabilityRuntimeNodeSnapshot(capabilityState, { x: 300, y: 610 }),
          result: {},
        });
      }
      const goalState = goals.get(nodeId);
      if (goalState) {
        const payload = route.request().postDataJSON() || {};
        network.goalActionRequests.push({
          action,
          nodeId,
          payload,
        });
        const updated = action === 'goal.requestCompletion'
          ? {
              ...goalState,
              status: 'proposed-complete' as const,
              revision: goalState.revision + 1,
              confirmation: {
                required: true,
                proposedBy: String(payload.actorNodeId || graphNodeId),
                evidenceRefs: Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs : [],
              },
            }
          : action === 'goal.update'
            ? {
                ...goalState,
                ...payload,
                nodeId,
                type: 'goal' as const,
                title: String(payload.title || goalState.title),
                status: String(payload.status || goalState.status) as GoalState['status'],
                acceptance: Array.isArray(payload.acceptance) ? payload.acceptance : goalState.acceptance,
                progress: Array.isArray(payload.acceptance)
                  ? {
                      verified: payload.acceptance.filter((item: JsonRecord) => /verified|complete|done|pass/i.test(String(item.status || ''))).length,
                      total: payload.acceptance.length,
                    }
                  : goalState.progress,
                wdt: payload.wdt ? { ...goalState.wdt, ...payload.wdt } : goalState.wdt,
                revision: goalState.revision + 1,
                statePath: goalState.statePath,
              }
          : goalState;
        goals.set(nodeId, updated);
        return jsonResponse(route, {
          ok: true,
          action,
          node: goalRuntimeNodeSnapshot(updated, { x: 960, y: 180 }),
          result: { state: updated },
        });
      }
      const state = components.get(nodeId) || defaultComponentState('markdown', nodeId);
      return jsonResponse(route, {
        ok: true,
        action,
        node: runtimeNodeSnapshot(state, { x: 260, y: 420 }),
        result: {},
      });
    }
    if (route.request().method() === 'PATCH' && parts[4] === 'settings') {
      const eventState = timers.get(nodeId);
      if (eventState) {
        return jsonResponse(route, {
          ok: true,
          node: timerRuntimeNodeSnapshot(eventState, { x: 300, y: 610 }),
          settings: { schemaId: 'timer-settings', values: route.request().postDataJSON() || {}, revision: 1 },
        });
      }
      const capabilityState = capabilities.get(nodeId);
      if (capabilityState) {
        return jsonResponse(route, {
          ok: true,
          node: capabilityRuntimeNodeSnapshot(capabilityState, { x: 300, y: 610 }),
          settings: { schemaId: `${capabilityState.type}-settings`, values: route.request().postDataJSON() || {}, revision: 1 },
        });
      }
      const state = components.get(nodeId) || defaultComponentState('markdown', nodeId);
      return jsonResponse(route, {
        ok: true,
        node: runtimeNodeSnapshot(state, { x: 260, y: 420 }),
        settings: { schemaId: `${state.type}-settings`, values: route.request().postDataJSON() || {}, revision: 1 },
      });
    }
    return jsonResponse(route, { ok: false, message: 'unsupported' }, 405);
  });
  await page.route(/\/api\/workflow\/edges(?:\?.*)?$/, async route => {
    const payload = route.request().postDataJSON() as JsonRecord || {};
    const edge = {
      id: `${payload.from}->${payload.to}`,
      from: payload.from,
      to: payload.to,
      relation: payload.relation || 'wf-bridge',
      direction: payload.direction || 'bidirectional',
      sourceHandle: payload.sourceHandle || null,
      targetHandle: payload.targetHandle || null,
    };
    network.workflowEdgeRequests.push({
      method: route.request().method(),
      payload,
    });
    graphEdges.push({
      ...edge,
      source: edge.from,
      target: edge.to,
    });
    graphVersion += 1;
    return jsonResponse(route, { ok: true, edge }, 201);
  });
  await page.route(/\/api\/workflow\/edges\/.+/, route => {
    const edgeId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '');
    network.workflowEdgeRequests.push({
      method: route.request().method(),
      payload: { edgeId },
    });
    const edgeIndex = graphEdges.findIndex(edge => edge.id === edgeId);
    if (edgeIndex >= 0) graphEdges.splice(edgeIndex, 1);
    capsuleDockLinks = capsuleDockLinks
      .map(link => ({
        ...link,
        edges: Array.isArray(link.edges)
          ? link.edges.filter((binding: JsonRecord | string) => (
              typeof binding === 'string'
                ? binding !== edgeId
                : String(binding.edgeId || binding.id || '') !== edgeId
            ))
          : [],
      }))
      .filter(link => (
        (Array.isArray(link.edges) && link.edges.length > 0)
          || (Array.isArray(link.connections) && link.connections.length > 0)
      ));
    graphVersion += 1;
    return jsonResponse(route, { ok: true });
  });

  return network;
}

async function openWorkflow(page: Page) {
  await page.goto('/workflow');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-node').first()).toBeVisible();
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-wf-browser-ready', 'true');
}

async function createComponentNode(page: Page, type: ComponentType) {
  if (await page.getByTestId('workflow-create-node-panel').count() === 0) {
    await page.getByTestId('workflow-create-node').click();
  }
  await expect(page.getByTestId('workflow-create-node-panel')).toBeVisible();
  const kind = type === 'excalidraw' ? 'diagram' : type;
  await page.locator(`[data-testid="workflow-create-node-option"][data-node-kind="${kind}"]`).click();
  if (type !== 'file') return;
  await page.getByTestId('workflow-create-file-path').fill('package.json');
  await page.getByTestId('workflow-create-file-submit').click();
}

async function dragWorkspaceReferenceToCanvas(
  page: Page,
  sourcePath: string,
  kind: 'workspace-file' | 'workspace-folder' = 'workspace-file',
) {
  const canvas = page.getByTestId('workflow-canvas');
  await expect(canvas).toBeVisible();
  const dataTransfer = await page.evaluateHandle(({ sourcePath: pathValue, kind: itemKind }) => {
    const dt = new DataTransfer();
    dt.setData('application/x-harness-workspace-item', JSON.stringify({ kind: itemKind, path: pathValue }));
    dt.setData('text/plain', pathValue);
    return dt;
  }, { sourcePath, kind });
  await canvas.dispatchEvent('dragenter', { dataTransfer });
  await canvas.dispatchEvent('dragover', { dataTransfer });
  await canvas.dispatchEvent('drop', { dataTransfer, clientX: 740, clientY: 510 });
  await dataTransfer.dispose();
}

async function dropExternalFileOnCanvas(page: Page, file: { name: string; mime: string; bytes: number[] }) {
  const canvas = page.getByTestId('workflow-canvas');
  await expect(canvas).toBeVisible();
  const dataTransfer = await page.evaluateHandle(({ name, mime, bytes }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], name, { type: mime }));
    return dt;
  }, file);
  await canvas.dispatchEvent('dragenter', { dataTransfer });
  await canvas.dispatchEvent('dragover', { dataTransfer });
  await canvas.dispatchEvent('drop', { dataTransfer, clientX: 820, clientY: 540 });
  await dataTransfer.dispose();
}

async function pasteLargeTextOnCanvas(page: Page, text: string) {
  const canvas = page.getByTestId('workflow-canvas');
  await expect(canvas).toBeVisible();
  await canvas.evaluate((element, value) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', value);
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    element.dispatchEvent(event);
  }, text);
}

async function setMarkdownEditorText(page: Page, text: string) {
  const editor = page.getByTestId('workflow-markdown-node-editor');
  await expect(editor).toBeVisible();
  const directEditable = await editor.evaluate(element => {
    const tagName = element.tagName.toLowerCase();
    return tagName === 'textarea' || tagName === 'input' || element.getAttribute('contenteditable') === 'true';
  });
  if (directEditable) {
    await editor.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(text);
    return;
  }
  const nestedEditor = editor.locator('textarea, input, [contenteditable="true"]').first();
  await expect(nestedEditor).toBeVisible();
  await nestedEditor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(text);
}

async function fillSourceEditor(page: Page, text: string) {
  const sourceEditor = page.getByTestId('workflow-markdown-source-editor');
  await expect(sourceEditor).toBeVisible();
  const directEditable = await sourceEditor.evaluate(element => {
    const tagName = element.tagName.toLowerCase();
    return tagName === 'textarea' || tagName === 'input' || element.getAttribute('contenteditable') === 'true';
  });
  if (directEditable) {
    await sourceEditor.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(text);
    return;
  }
  const nestedEditor = sourceEditor.locator('textarea, input, [contenteditable="true"]').first();
  await expect(nestedEditor).toBeVisible();
  await nestedEditor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(text);
}

async function dragHandlePath(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox, 'source handle should be visible before connect').not.toBeNull();
  expect(targetBox, 'target handle should be visible before connect').not.toBeNull();
  const sourcePoint = await source.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const candidates = [
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: rect.left + Math.max(1, rect.width - 2), y: rect.top + rect.height / 2 },
      { x: rect.left + 2, y: rect.top + rect.height / 2 },
      { x: rect.left + rect.width / 2, y: rect.top + 2 },
      { x: rect.left + rect.width / 2, y: rect.top + Math.max(1, rect.height - 2) },
    ];
    return candidates.find(point => {
      const hit = document.elementFromPoint(point.x, point.y);
      return hit === element || element.contains(hit) || hit?.closest('.react-flow__handle') === element;
    }) || candidates[0];
  });
  const targetPoint = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const candidates = [
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: rect.left + 2, y: rect.top + rect.height / 2 },
      { x: rect.left + Math.max(1, rect.width - 2), y: rect.top + rect.height / 2 },
      { x: rect.left + rect.width / 2, y: rect.top + 2 },
      { x: rect.left + rect.width / 2, y: rect.top + Math.max(1, rect.height - 2) },
    ];
    return candidates.find(point => {
      const hit = document.elementFromPoint(point.x, point.y);
      return hit === element || element.contains(hit) || hit?.closest('.react-flow__handle') === element;
    }) || candidates[0];
  });
  const sx = sourcePoint.x;
  const sy = sourcePoint.y;
  const tx = targetPoint.x;
  const ty = targetPoint.y;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move((sx + tx) / 2, sy, { steps: 8 });
  await page.mouse.move((sx + tx) / 2, ty, { steps: 8 });
  await page.mouse.move(tx, ty, { steps: 8 });
  await page.mouse.up();
}

async function dragNodeCenterTo(page: Page, node: Locator, target: { x: number; y: number }) {
  const box = await node.boundingBox();
  expect(box, 'node should be visible before drag').not.toBeNull();
  const start = {
    x: box!.x + box!.width / 2,
    y: box!.y + box!.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + target.x) / 2, start.y, { steps: 8 });
  await page.mouse.move((start.x + target.x) / 2, target.y, { steps: 10 });
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.mouse.up();
}

async function expectInViewport(page: Page, locator: Locator, label = 'surface') {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${label} should have a bounding box`).not.toBeNull();
  expect(viewport, 'viewport should be available').not.toBeNull();
  expect(box!.x, `${label} left edge should be in viewport`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${label} top edge should be in viewport`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${label} right edge should be in viewport`).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height, `${label} bottom edge should be in viewport`).toBeLessThanOrEqual(viewport!.height + 1);
}

async function expectTopLayerAtCenter(page: Page, topLayer: Locator, coveredLayer: Locator, label = 'top layer') {
  const topSelector = `[data-testid="${await topLayer.getAttribute('data-testid')}"]`;
  const coveredBox = await coveredLayer.boundingBox();
  expect(coveredBox, `${label} covered layer should have a bounding box`).not.toBeNull();
  await expect(page.evaluate(({ selector, x, y }) => {
    const element = document.elementFromPoint(x, y);
    return Boolean(element?.closest(selector));
  }, {
    selector: topSelector,
    x: coveredBox!.x + coveredBox!.width / 2,
    y: coveredBox!.y + coveredBox!.height / 2,
  })).resolves.toBe(true);
}

test.describe('WF UI M3 RED trusted component nodes acceptance', () => {
  test('AC-001 creates Agent, File, Markdown, and Diagram nodes through the unified node picker', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    await expect(page.getByTestId('workflow-component-node-toolbar')).toHaveCount(0);
    await page.getByTestId('workflow-create-node').click();
    const picker = page.getByTestId('workflow-create-node-panel');
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('data-canvas-control', 'true');
    await expect(picker.getByTestId('workflow-create-node-search')).toBeVisible();
    for (const kind of ['agent', 'file', 'markdown', 'diagram', 'timer', 'goal']) {
      const option = picker.locator(`[data-testid="workflow-create-node-option"][data-node-kind="${kind}"]`);
      await expect(option).toBeVisible();
      await expect(option).toHaveAttribute('data-node-state', 'ready');
    }
    for (const kind of ['trigger', 'github-trigger', 'group']) {
      const option = picker.locator(`[data-testid="workflow-create-node-option"][data-node-kind="${kind}"]`);
      await expect(option).toBeVisible();
      await expect(option).toHaveAttribute('data-node-state', 'planned');
      await expect(option).toHaveAttribute('data-node-action', 'disabled');
      await expect(option).toBeDisabled();
    }
    for (const kind of ['mcp']) {
      const option = picker.locator(`[data-testid="workflow-create-node-option"][data-node-kind="${kind}"]`);
      await expect(option).toBeVisible();
      await expect(option).toHaveAttribute('data-node-state', 'ready');
      await expect(option).toHaveAttribute('data-node-action', 'open-hub');
      await expect(option).toBeEnabled();
    }
    // Skill and skill-group entries were removed from the create-node catalog;
    // the Skills Hub overlay is the single skills surface now.
    await expect(picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="skill"]')).toHaveCount(0);
    await expect(picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="skill-group"]')).toHaveCount(0);
    await picker.getByTestId('workflow-create-node-search').fill('skills');
    await expect(picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="skill"]')).toHaveCount(0);
    await expect(picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="skill-group"]')).toHaveCount(0);
    await expect(picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="markdown"]')).toHaveCount(0);
    await picker.getByTestId('workflow-create-node-search').fill('');

    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`);
    await agentNode.click({ button: 'right' });
    const nodeMenu = page.getByTestId('workflow-node-context-menu');
    await expect(nodeMenu.locator('[data-testid="workflow-node-context-action"][data-action="skills-hub"]')).toBeVisible();
    await nodeMenu.locator('[data-testid="workflow-node-context-action"][data-action="skills-hub"]').click();
    const targetedHub = page.getByTestId('workflow-capability-hub-drawer');
    await expect(targetedHub).toBeVisible();
    await expect(targetedHub).toHaveAttribute('data-hub-kind', 'skills');
    await expect(targetedHub).toHaveAttribute('data-origin', 'agent-menu');
    await expect(targetedHub).toHaveAttribute('data-target-agent-id', graphNodeId);
    await targetedHub.getByTestId('workflow-capability-hub-search').fill('wf');
    const wfSkillItem = targetedHub.getByTestId('workflow-capability-hub-item').filter({ hasText: 'WF-UI Adapter' });
    const attachSkill = wfSkillItem.getByTestId('workflow-capability-attach');
    await expect(attachSkill).toBeEnabled();
    await attachSkill.click();
    await expect.poll(() => network.nodeConfigPatchRequests.length).toBe(1);
    expect(network.nodeConfigPatchRequests[0]).toEqual(expect.objectContaining({
      skills: expect.arrayContaining(['wf-max', 'tdd', 'wf-browser', 'wf-ui']),
      skillPolicy: 'manual',
    }));
    await expect(attachSkill).toHaveText(/Attached/i);
    const groupCreate = targetedHub.getByTestId('workflow-capability-hub-group').filter({ hasText: 'Workflow skills' });
    await expect(groupCreate.getByTestId('workflow-capability-create-node')).toBeVisible();
    await groupCreate.click();
    await expect(page.getByTestId('workflow-capability-node')).toBeVisible();
    await expect(page.getByTestId('workflow-capability-node')).toHaveAttribute('data-skill-count', '1');
    const skillGroupCreate = network.componentCreateRequests.find(request => request.type === 'skill-group');
    expect(skillGroupCreate).toEqual(expect.objectContaining({
      type: 'skill-group',
      sourceGroup: expect.objectContaining({ id: 'recommended:workflow' }),
      skills: [expect.objectContaining({ name: 'wf-ui' })],
    }));
    expect(network.workflowEdgeRequests.some(request => (
      request.method === 'POST'
      && request.payload?.relation === 'capability'
      && request.payload?.direction === 'bidirectional'
      && String(request.payload?.targetHandle || '').startsWith('capability:')
    ))).toBeTruthy();
    const createCountAfterCapabilityPack = network.componentCreateRequests.length;

    await createComponentNode(page, 'markdown');
    await expect.poll(() => network.componentCreateRequests.length).toBe(createCountAfterCapabilityPack + 1);
    expect(network.componentCreateRequests[network.componentCreateRequests.length - 1]).toEqual(expect.objectContaining({
      type: 'markdown',
      position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    }));
    await expect(page.getByTestId('workflow-markdown-node-editor')).toBeVisible();

    await createComponentNode(page, 'excalidraw');
    await expect.poll(() => network.componentCreateRequests.length).toBe(createCountAfterCapabilityPack + 2);
    expect(network.componentCreateRequests[network.componentCreateRequests.length - 1]).toEqual(expect.objectContaining({ type: 'excalidraw' }));
    await expect(page.getByTestId('workflow-excalidraw-node')).toBeVisible();

    await createComponentNode(page, 'file');
    await expect.poll(() => network.componentCreateRequests.length).toBe(createCountAfterCapabilityPack + 3);
    expect(network.componentCreateRequests[network.componentCreateRequests.length - 1]).toEqual(expect.objectContaining({
      type: 'file',
      file: expect.objectContaining({
        source: 'workspace',
        path: 'package.json',
      }),
    }));
    await expect(page.getByTestId('workflow-file-node')).toBeVisible();

    await page.getByTestId('workflow-create-node').click();
    await page.locator('[data-testid="workflow-create-node-option"][data-node-kind="timer"]').click();
    await expect.poll(() => network.componentCreateRequests.length).toBe(createCountAfterCapabilityPack + 4);
    expect(network.componentCreateRequests[network.componentCreateRequests.length - 1]).toEqual(expect.objectContaining({
      type: 'timer',
      position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    }));
    await expect(page.getByTestId('workflow-event-node')).toBeVisible();

    await page.getByTestId('workflow-create-node').click();
    await page.locator('[data-testid="workflow-create-node-option"][data-node-kind="goal"]').click();
    await expect.poll(() => network.componentCreateRequests.length).toBe(createCountAfterCapabilityPack + 5);
    expect(network.componentCreateRequests[network.componentCreateRequests.length - 1]).toEqual(expect.objectContaining({
      type: 'goal',
      position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    }));
    await expect(page.getByTestId('workflow-goal-node')).toBeVisible();
  });

  test('AC-001 opens the same node picker from the canvas right-click create-node path', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await openWorkflow(page);

    const pane = page.locator('.react-flow__pane');
    await expect(pane).toBeVisible();
    const contextPoint = await page.evaluate(() => {
      const paneElement = document.querySelector('.react-flow__pane') as HTMLElement | null;
      if (!paneElement) return { ok: false, reason: 'pane missing' };
      const rect = paneElement.getBoundingClientRect();
      const point = {
        pageX: Math.round(rect.left + rect.width * 0.82),
        pageY: Math.round(rect.top + rect.height * 0.68),
        x: Math.round(rect.width * 0.82),
        y: Math.round(rect.height * 0.68),
      };
      const target = document.elementFromPoint(point.pageX, point.pageY) as HTMLElement | null;
      if (!target?.closest('.react-flow__pane')) {
        return { ok: false, reason: 'blank pane target missing', target: target?.className || target?.tagName || '' };
      }
      return {
        ok: true,
        target: target.className || target.tagName,
        ...point,
      };
    });
    expect(contextPoint).toEqual(expect.objectContaining({ ok: true }));
    await pane.click({ button: 'right', position: { x: contextPoint.x as number, y: contextPoint.y as number } });

    const menu = page.getByTestId('workflow-context-menu');
    await expect(menu).toBeVisible();
    await expectInViewport(page, menu, 'canvas context menu');
    await menu.locator('[data-testid="workflow-context-action"][data-action="create-node"]').click();

    const picker = page.getByTestId('workflow-create-node-panel');
    await expect(picker).toBeVisible();
    await expectInViewport(page, picker, 'canvas create node picker');
    await expect(page.getByTestId('workflow-context-menu')).toHaveCount(0);
    await expect(picker.getByTestId('workflow-create-node-search')).toBeVisible();
    for (const kind of ['agent', 'file', 'markdown', 'diagram', 'goal']) {
      await expect(picker.locator(`[data-testid="workflow-create-node-option"][data-node-kind="${kind}"]`)).toBeVisible();
    }
    await picker.getByTestId('workflow-create-node-search').fill('mcp');
    const mcpOption = picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="mcp"]');
    await expect(mcpOption).toBeVisible();
    await expect(mcpOption).toHaveAttribute('data-node-category', 'capability');
    await expect(mcpOption).toHaveAttribute('data-node-state', 'ready');
    await expect(mcpOption).toHaveAttribute('data-node-action', 'open-hub');
    await mcpOption.click();
    const hub = page.getByTestId('workflow-capability-hub-drawer');
    await expect(hub).toBeVisible();
    await expect(hub).toHaveAttribute('data-hub-kind', 'mcp');
    await expect(hub).toHaveAttribute('data-origin', 'create-panel');
    await expect(page.getByTestId('workflow-mcp-hub-panel')).toBeVisible();
    await expect.poll(() => network.mcpHubRequests.length).toBe(1);
    await expect(hub.getByTestId('workflow-capability-hub-item').filter({ hasText: 'github' })).toBeVisible();
    await expect(hub.getByText('metadata-only-no-spawn-no-secret')).toBeVisible();
    await expect(hub.getByTestId('workflow-capability-attach').first()).toBeDisabled();
    await expect(hub.getByTestId('workflow-capability-create-node').first()).toBeEnabled();
    await hub.getByTestId('workflow-capability-hub-search').fill('docs');
    const docsMcpItem = hub.getByTestId('workflow-capability-hub-item').filter({ hasText: 'docs' });
    await expect(docsMcpItem).toBeVisible();
    await expect(hub.getByTestId('workflow-capability-hub-item').filter({ hasText: 'github' })).toHaveCount(0);
    expect(JSON.stringify(network.mcpHubRequests)).not.toContain('secret');
    const graphPostBeforeMcpCreate = network.workflowEdgeRequests.filter(request => request.method === 'POST').length;
    await docsMcpItem.getByTestId('workflow-capability-create-node').click();
    await expect(page.getByTestId('workflow-capability-node')).toBeVisible();
    await expect(page.getByTestId('workflow-capability-node')).toHaveAttribute('data-capability-type', 'mcp-connector');
    await expect(page.getByTestId('workflow-capability-node')).toHaveAttribute('data-server-count', '1');
    const mcpConnectorCreate = network.componentCreateRequests.find(request => request.type === 'mcp-connector');
    expect(mcpConnectorCreate).toEqual(expect.objectContaining({
      type: 'mcp-connector',
      mcpServerId: 'mcp:project-cursor:docs',
    }));
    expect(network.workflowEdgeRequests.filter(request => request.method === 'POST').length).toBe(graphPostBeforeMcpCreate);
  });

  test('W14-TIMER W14-GOAL renders Advanced Timer heartbeat/health and active Goal node', async ({ page }) => {
    const timer = defaultTimerState(timerNodeId);
    timer.title = 'Agent heartbeat';
    timer.enabled = true;
    timer.schedule = { mode: 'loop', intervalSeconds: 45, cron: '', cadence: { kind: 'sequence', sequenceSeconds: [45, 90] } };
    timer.heartbeat = {
      base: { enabled: true, intervalSeconds: 45, count: 3, lastAt: '2026-08-05T00:00:00.000Z', nextDueAt: '2026-08-05T00:00:45.000Z' },
      watchdog: { enabled: true, intervalSeconds: 600, timeoutSeconds: 1800, missedCount: 0, state: 'ok', lastAckAt: '2026-08-05T00:00:00.000Z' },
    };
    const goal = defaultGoalState();
    await installWorkflowFixture(page, { initialEvents: [timer], initialGoals: [goal] });
    await openWorkflow(page);

    const timerNode = page.getByTestId('workflow-event-node').filter({ hasText: 'Agent heartbeat' });
    await expect(timerNode).toBeVisible();
    await expect(timerNode).toHaveAttribute('data-event-type', 'timer');
    await expect(timerNode).toHaveAttribute('data-base-heartbeat', 'on');
    await expect(timerNode).toHaveAttribute('data-watchdog-state', 'ok');
    await expect(timerNode).toHaveAttribute('data-timer-enabled', 'true');
    await expect(timerNode).toHaveAttribute('data-timer-status', 'running');
    await expect(timerNode.getByTestId('workflow-timer-state')).toContainText('running');
    await expect(timerNode.getByTestId('workflow-timer-countdown')).toContainText('Next');
    await expect(timerNode.getByTestId('workflow-timer-countdown')).toContainText(/\d{2}:\d{2}/);
    await expect(timerNode.getByTestId('workflow-timer-base-heartbeat')).toContainText('45s');
    await expect(timerNode.getByTestId('workflow-timer-watchdog')).toContainText('600s');

    const goalNode = page.getByTestId('workflow-goal-node');
    await expect(goalNode).toBeVisible();
    await expect(goalNode).toHaveAttribute('data-node-id', goalNodeId);
    await expect(goalNode.getByTestId('workflow-goal-status')).toContainText('active');
    await expect(goalNode.getByTestId('workflow-goal-progress')).toContainText('0/2');
    await expect(goalNode.getByTestId('workflow-goal-acceptance-item')).toHaveCount(2);
    await expect(goalNode.getByTestId('workflow-goal-health')).toContainText('Check ok');
  });

  test('W16-TIMER double-click opens the expanded Timer editor and saves schedule mode', async ({ page }) => {
    const timer = defaultTimerState(timerNodeId);
    timer.title = 'Agent heartbeat';
    timer.enabled = true;
    timer.schedule = { mode: 'loop', intervalSeconds: 45, cron: '', cadence: { kind: 'sequence', sequenceSeconds: [45, 90] } };
    const network = await installWorkflowFixture(page, { initialEvents: [timer] });
    await openWorkflow(page);

    const timerNode = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    await timerNode.dblclick();
    const editor = page.getByTestId('workflow-timer-expanded-node');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute('data-node-id', timerNodeId);
    await expect(editor.locator('[data-testid="workflow-timer-mode"][data-mode="loop"]')).toHaveAttribute('aria-pressed', 'true');

    await editor.locator('[data-testid="workflow-timer-mode"][data-mode="once"]').click();
    await editor.getByTestId('workflow-timer-expanded-title').fill('One shot reminder');
    await editor.getByTestId('workflow-timer-trigger-at').fill('2026-08-05T15:30:00.000Z');
    await editor.getByTestId('workflow-timer-interval-seconds').fill('90');
    await editor.getByTestId('workflow-timer-expanded-save').click();

    await expect.poll(() => network.timerActionRequests.length).toBe(1);
    expect(network.timerActionRequests[0]).toEqual(expect.objectContaining({
      action: 'timer.configure',
      nodeId: timerNodeId,
      payload: expect.objectContaining({
        title: 'One shot reminder',
        schedule: expect.objectContaining({
          mode: 'once',
          intervalSeconds: 90,
          triggerAt: '2026-08-05T15:30:00.000Z',
        }),
      }),
    }));
    await expect(timerNode).toContainText('One shot reminder');
    await expect(timerNode).toContainText('once');
  });

  test('W16-TIMER expanded editor preserves non-shortcut schedule modes on save', async ({ page }) => {
    const timer = defaultTimerState(timerNodeId);
    timer.title = 'Cron heartbeat';
    timer.enabled = true;
    timer.schedule = { mode: 'cron', intervalSeconds: 300, cron: '*/5 * * * *', cadence: { kind: 'fixed' } };
    const network = await installWorkflowFixture(page, { initialEvents: [timer] });
    await openWorkflow(page);

    const timerNode = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    await timerNode.dblclick();
    const editor = page.getByTestId('workflow-timer-expanded-node');
    await expect(editor).toBeVisible();
    await expect(editor.locator('[data-testid="workflow-timer-mode"][data-mode="cron"]')).toHaveAttribute('aria-pressed', 'true');

    await editor.getByTestId('workflow-timer-expanded-title').fill('Cron heartbeat saved');
    await editor.getByTestId('workflow-timer-expanded-save').click();

    await expect.poll(() => network.timerActionRequests.length).toBe(1);
    expect(network.timerActionRequests[0].payload.schedule).toEqual(expect.objectContaining({
      mode: 'cron',
      cron: '*/5 * * * *',
    }));
    await expect(timerNode).toContainText('Cron heartbeat saved');
    await expect(timerNode).toContainText(/cron/i);
  });

  test('W16-GOAL double-click opens Goal workbench and saves user Goal edits', async ({ page }) => {
    const goal = defaultGoalState();
    const network = await installWorkflowFixture(page, { initialGoals: [goal] });
    await openWorkflow(page);

    const goalNode = page.locator(`[data-testid="workflow-goal-node"][data-node-id="${goalNodeId}"]`);
    await goalNode.dblclick();
    const editor = page.getByTestId('workflow-goal-expanded-node');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute('data-node-id', goalNodeId);

    await editor.getByTestId('workflow-goal-expanded-title').fill('Ship Goal workbench');
    await editor.getByTestId('workflow-goal-objective').fill('Give users a direct Goal editing surface.');
    await editor.getByTestId('workflow-goal-next-action').fill('Verify linked Agent authority');
    await editor.getByTestId('workflow-goal-plan-editor').fill([
      'P-001 | Double-click opens Goal workbench | done',
      'P-002 | Agent can edit only when linked | todo',
    ].join('\n'));
    await editor.getByTestId('workflow-goal-acceptance-editor').fill([
      'W16-001 | Double-click opens Goal workbench | verified',
      'W16-002 | Agent can edit only when linked | tracked',
    ].join('\n'));
    await editor.getByTestId('workflow-goal-expanded-save').click();

    await expect.poll(() => network.goalActionRequests.length).toBe(1);
    expect(network.goalActionRequests[0]).toEqual(expect.objectContaining({
      action: 'goal.update',
      nodeId: goalNodeId,
      payload: expect.objectContaining({
        title: 'Ship Goal workbench',
        objective: 'Give users a direct Goal editing surface.',
        nextAction: 'Verify linked Agent authority',
        acceptance: [
          expect.objectContaining({ id: 'W16-001', status: 'verified' }),
          expect.objectContaining({ id: 'W16-002', status: 'tracked' }),
        ],
        planItems: [
          expect.objectContaining({ id: 'P-001', status: 'done' }),
          expect.objectContaining({ id: 'P-002', status: 'todo' }),
        ],
      }),
    }));
    expect(network.goalActionRequests[0].payload.actorNodeId).toBeUndefined();
    await expect(goalNode).toContainText('Ship Goal workbench');
    await expect(goalNode.getByTestId('workflow-goal-progress')).toContainText('1/2');
  });

  test('AC-010 Goal deletion is available and removes the node before a slow backend delete settles', async ({ page }) => {
    const goal = defaultGoalState();
    const network = await installWorkflowFixture(page, {
      initialGoals: [goal],
      deleteActionDelayMs: 1200,
    });
    await openWorkflow(page);

    const goalNode = page.locator(`[data-testid="workflow-goal-node"][data-node-id="${goalNodeId}"]`);
    await goalNode.click({ button: 'right' });
    const menu = page.getByTestId('workflow-node-context-menu');
    const deleteAction = menu.locator('[data-testid="workflow-node-context-action"][data-action="delete"]');
    await expect(deleteAction).toBeEnabled();
    await deleteAction.click();

    await expect.poll(() => network.nodeDeleteRequests.length).toBe(1);
    await expect(goalNode).toHaveCount(0, { timeout: 300 });
  });

  test('AC-010 deleting a running Agent requires confirmation to stop and delete', async ({ page }) => {
    const network = await installWorkflowFixture(page, {
      agentCanDelete: false,
      deleteActionDelayMs: 1200,
    });
    await openWorkflow(page);

    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`);
    await agentNode.click({ button: 'right' });
    const menu = page.getByTestId('workflow-node-context-menu');
    const deleteAction = menu.locator('[data-testid="workflow-node-context-action"][data-action="delete"]');
    await expect(deleteAction).toBeEnabled();
    await deleteAction.click();

    const confirm = page.getByTestId('workflow-delete-confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(/running|stop/i);
    await confirm.getByTestId('workflow-delete-confirm-accept').click();
    await expect.poll(() => network.stopRequests.length).toBe(1);
    await expect.poll(() => network.nodeDeleteRequests.length).toBe(1);
    await expect(agentNode).toHaveCount(0, { timeout: 300 });
  });

  test('AC-010 Ctrl+Z restores a deleted Goal and Ctrl+Shift+Z deletes it again', async ({ page }) => {
    const goal = defaultGoalState();
    const network = await installWorkflowFixture(page, { initialGoals: [goal] });
    await openWorkflow(page);

    const goalNode = page.locator(`[data-testid="workflow-goal-node"][data-node-id="${goalNodeId}"]`);
    await goalNode.click({ button: 'right' });
    await page.getByTestId('workflow-node-context-action').filter({ hasText: 'Delete' }).click();
    await expect.poll(() => network.nodeDeleteRequests.length).toBe(1);
    await expect(goalNode).toHaveCount(0);

    await page.getByTestId('workflow-undo').click();
    await expect.poll(() => network.nodeRestoreRequests.length).toBe(1);
    await expect(goalNode).toBeVisible();
    await expect(page.getByTestId('workflow-redo')).toBeEnabled();

    await page.keyboard.press('Control+Shift+Z');
    await expect.poll(() => network.nodeDeleteRequests.length).toBe(2);
    await expect(goalNode).toHaveCount(0);
  });

  test('W13 Agent-targeted MCP Hub creates a connector node and bidirectional capability edge', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`);
    await expect(agentNode).toBeVisible();
    await agentNode.click({ button: 'right' });
    const nodeMenu = page.getByTestId('workflow-node-context-menu');
    await expect(nodeMenu.locator('[data-testid="workflow-node-context-action"][data-action="mcp-hub"]')).toBeVisible();
    await nodeMenu.locator('[data-testid="workflow-node-context-action"][data-action="mcp-hub"]').click();

    const hub = page.getByTestId('workflow-capability-hub-drawer');
    await expect(hub).toBeVisible();
    await expect(hub).toHaveAttribute('data-hub-kind', 'mcp');
    await expect(hub).toHaveAttribute('data-origin', 'agent-menu');
    await expect(hub).toHaveAttribute('data-target-agent-id', graphNodeId);
    const githubItem = hub.getByTestId('workflow-capability-hub-item').filter({ hasText: 'github' });
    await expect(githubItem).toBeVisible();
    await expect(githubItem.getByTestId('workflow-capability-attach')).toBeDisabled();
    await expect(githubItem.getByTestId('workflow-capability-create-node')).toBeEnabled();
    await githubItem.getByTestId('workflow-capability-create-node').click();

    const connectorNode = page.getByTestId('workflow-capability-node');
    await expect(connectorNode).toBeVisible();
    await expect(connectorNode).toHaveAttribute('data-capability-type', 'mcp-connector');
    await expect(connectorNode).toHaveAttribute('data-server-count', '1');
    const mcpConnectorCreate = network.componentCreateRequests.find(request => request.type === 'mcp-connector');
    expect(mcpConnectorCreate).toEqual(expect.objectContaining({
      type: 'mcp-connector',
      mcpServerId: 'mcp:project-mcp:github',
    }));
    expect(network.workflowEdgeRequests.some(request => (
      request.method === 'POST'
      && request.payload?.relation === 'capability'
      && request.payload?.direction === 'bidirectional'
      && request.payload?.from === graphNodeId
      && String(request.payload?.targetHandle || '').startsWith('capability:')
    ))).toBeTruthy();
    expect(JSON.stringify(network.componentCreateRequests)).not.toContain('secret');
  });

  test('AC-002 canvas drop creates File node refs for workspace items and stored File nodes for external files', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    await dragWorkspaceReferenceToCanvas(page, 'package.json');
    await expect.poll(() => network.componentCreateRequests.length).toBe(1);
    expect(network.componentCreateRequests[0]).toEqual(expect.objectContaining({
      type: 'file',
      file: expect.objectContaining({
        source: 'workspace',
        path: 'package.json',
      }),
    }));

    await dropExternalFileOnCanvas(page, {
      name: 'clipboard-shot.png',
      mime: 'image/png',
      bytes: [137, 80, 78, 71],
    });
    await expect.poll(() => network.userFileRequests.length).toBe(1);
    expect(network.userFileRequests[0].files[0]).toEqual(expect.objectContaining({
      name: 'clipboard-shot.png',
      mime: 'image/png',
      contentBase64: 'iVBORw==',
    }));
    await expect.poll(() => network.componentCreateRequests.length).toBe(2);
    expect(network.componentCreateRequests[1]).toEqual(expect.objectContaining({
      type: 'file',
      file: expect.objectContaining({
        source: 'user-file',
        path: 'Harness/user-files/images/clipboard-shot.png',
      }),
    }));
  });

  test('AC-002 File node renders workspace path metadata and bounded text preview without user-file upload', async ({ page }) => {
    const workspacePath = 'Harness/tasks/task-standardize-workflow-nodes/PLAN.md';
    const fileState = defaultComponentState('file', 'component-file-workspace-e2e');
    fileState.title = 'Workflow node PLAN';
    fileState.file = {
      source: 'workspace',
      path: workspacePath,
      name: 'PLAN.md',
      mime: 'text/markdown',
      size: 32_000,
    };
    const network = await installWorkflowFixture(page, { initialComponents: [fileState] });
    await openWorkflow(page);

    const componentNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${fileState.nodeId}"]`);
    const fileNode = componentNode.getByTestId('workflow-file-node');
    await expect(fileNode).toBeVisible();
    await expect(fileNode).toHaveAttribute('data-file-source', 'workspace');
    await expect(fileNode).toHaveAttribute('data-file-path', workspacePath);

    const preview = componentNode.getByTestId('workflow-file-preview');
    await expect(preview).toBeVisible();
    await expect.poll(() => network.workspaceTextRequests.length).toBe(1);
    expect(network.workspaceTextRequests[0]).toEqual(expect.objectContaining({
      method: 'GET',
      path: workspacePath,
      offset: '0',
    }));
    expect(Number(network.workspaceTextRequests[0].limit)).toBeGreaterThan(0);
    expect(Number(network.workspaceTextRequests[0].limit)).toBeLessThanOrEqual(8192);
    await expect(componentNode.getByTestId('workflow-file-text-preview')).toContainText('AC-002 bounded file preview fixture');
    expect(network.userFileRequests).toHaveLength(0);
    expect(network.workspaceFileRequests).toHaveLength(0);
  });

  test('AC-002 pasting large text on the canvas creates a Markdown node', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    await pasteLargeTextOnCanvas(page, '# Clipboard Notes\n\nThis long pasted text should become its own Markdown resource node instead of terminal input.');

    await expect.poll(() => network.componentCreateRequests.length).toBe(1);
    expect(network.componentCreateRequests[0]).toEqual(expect.objectContaining({
      type: 'markdown',
      markdown: expect.stringContaining('Clipboard Notes'),
    }));
  });

  test('AC-006 Markdown node supports WYSIWYG edit, source mode, revisioned PUT, and reload persistence', async ({ page }) => {
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const network = await installWorkflowFixture(page, { initialComponents: [markdownState], includeInitialEdges: false });
    await openWorkflow(page);

    await expect(page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`)).toBeVisible();
    await setMarkdownEditorText(page, 'M3 visible editor text');
    await expect(page.getByTestId('workflow-component-node-save')).toBeEnabled();
    await page.getByTestId('workflow-component-node-save').click();
    await expect.poll(() => network.componentPutRequests.length).toBe(1);
    expect(network.componentPutRequests[0]).toEqual(expect.objectContaining({
      method: 'PATCH',
      nodeId: markdownNodeId,
      payload: expect.objectContaining({
        revision: 1,
        markdown: expect.stringContaining('M3 visible editor text'),
      }),
    }));

    await page.getByTestId('workflow-markdown-source-toggle').click();
    await fillSourceEditor(page, '# Source Mode\n\nBackend markdown text.');
    await page.getByTestId('workflow-component-node-save').click();
    await expect.poll(() => network.componentPutRequests.length).toBe(2);
    expect(network.componentPutRequests[1].payload).toEqual(expect.objectContaining({
      revision: 2,
      markdown: '# Source Mode\n\nBackend markdown text.',
    }));

    await page.reload();
    await expect(page.getByTestId('workflow-markdown-node-editor')).toContainText(/Backend markdown text|Source Mode/);
  });

  test('AC-006 Excalidraw-style node saves simple scene data with revision and persists after reload', async ({ page }) => {
    const excalidrawState = defaultComponentState('excalidraw', excalidrawNodeId);
    excalidrawState.scene = {
      elements: [
        {
          id: 'rect-node-save-e2e',
          type: 'rectangle',
          x: 30,
          y: 28,
          width: 92,
          height: 58,
          strokeColor: '#6965DB',
          backgroundColor: 'rgba(105,101,219,0.16)',
        },
        {
          id: 'ellipse-node-save-e2e',
          type: 'ellipse',
          x: 150,
          y: 24,
          width: 104,
          height: 72,
          strokeColor: '#1e1e1e',
          backgroundColor: 'transparent',
        },
        {
          id: 'diamond-node-save-e2e',
          type: 'diamond',
          x: 276,
          y: 26,
          width: 88,
          height: 68,
          strokeColor: '#1e1e1e',
          backgroundColor: 'transparent',
        },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    };
    const network = await installWorkflowFixture(page, { initialComponents: [excalidrawState] });
    await openWorkflow(page);

    const diagram = page.getByTestId('workflow-excalidraw-node');
    await expect(diagram).toBeVisible();
    await expect(diagram).toHaveAttribute('data-node-id', excalidrawNodeId);
    await expect(diagram).toHaveAttribute('data-revision', '1');
    await expect(page.getByTestId('workflow-excalidraw-test-helper-add-rect')).toHaveCount(0);
    await expect(page.locator('[data-testid="workflow-excalidraw-element"][data-element-type="rectangle"]')).toBeVisible();
    const previewEllipse = page.locator('[data-testid="workflow-excalidraw-element"][data-element-type="ellipse"]');
    const previewDiamond = page.locator('[data-testid="workflow-excalidraw-element"][data-element-type="diamond"]');
    await expect(previewEllipse).toBeVisible();
    await expect(previewDiamond).toBeVisible();
    await expect(previewEllipse.locator('ellipse')).toBeVisible();
    await expect(previewDiamond.locator('polygon')).toBeVisible();
    await page.getByTestId('workflow-component-node-save').click();

    await expect.poll(() => network.componentPutRequests.length).toBe(1);
    expect(network.componentPutRequests[0]).toEqual(expect.objectContaining({
      method: 'PATCH',
      nodeId: excalidrawNodeId,
      payload: expect.objectContaining({
        revision: 1,
        scene: expect.objectContaining({
          elements: expect.arrayContaining([
            expect.objectContaining({ type: 'rectangle' }),
          ]),
        }),
      }),
    }));

    await page.reload();
    await expect(page.getByTestId('workflow-excalidraw-node')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-excalidraw-element"][data-element-type="rectangle"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-excalidraw-element"][data-element-type="ellipse"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-excalidraw-element"][data-element-type="diamond"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-excalidraw-element"][data-element-type="ellipse"]').locator('ellipse')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-excalidraw-element"][data-element-type="diamond"]').locator('polygon')).toBeVisible();
  });

  test('AC-009 Markdown fullscreen shows loading state, rich editor readiness, and revisioned save', async ({ page }) => {
    test.setTimeout(90_000);
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const network = await installWorkflowFixture(page, { initialComponents: [markdownState], includeInitialEdges: false });
    await openWorkflow(page);

    const markdownNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    await markdownNode.locator('.workflow-component-node-header').dblclick();
    const fullscreen = page.getByTestId('workflow-component-fullscreen');
    await expect(fullscreen).toHaveAttribute('data-component-type', 'markdown');
    await expect(fullscreen.getByTestId('workflow-fullscreen-loading')).toBeVisible();
    const richEditor = fullscreen.getByTestId('workflow-markdown-rich-editor');
    await expect(richEditor).toBeVisible({ timeout: 20000 });
    await expect(fullscreen.getByTestId('workflow-fullscreen-loading')).toHaveCount(0);

    const richEditable = richEditor.locator('[contenteditable="true"]').first();
    await expect(richEditable).toBeVisible();
    await richEditable.click();
    await page.keyboard.type(' AC-009 fullscreen revision save');
    await fullscreen.getByTestId('workflow-component-fullscreen-save').click();

    await expect.poll(() => network.componentPutRequests.length).toBe(1);
    expect(network.componentPutRequests[0]).toEqual(expect.objectContaining({
      method: 'PATCH',
      nodeId: markdownNodeId,
      payload: expect.objectContaining({
        revision: 1,
        markdown: expect.stringContaining('AC-009 fullscreen revision save'),
      }),
    }));
  });

  test('AC-009 Excalidraw fullscreen loads the real editor with brand styling and no Rect helper', async ({ page }) => {
    test.setTimeout(90_000);
    const excalidrawState = defaultComponentState('excalidraw', excalidrawNodeId);
    excalidrawState.scene = {
      elements: [{
        id: 'rect-fullscreen-brand-e2e',
        type: 'rectangle',
        x: 32,
        y: 34,
        width: 86,
        height: 52,
        strokeColor: '#6965DB',
        backgroundColor: 'rgba(105,101,219,0.16)',
      }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    };
    await installWorkflowFixture(page, { initialComponents: [excalidrawState] });
    await openWorkflow(page);

    const diagramNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${excalidrawNodeId}"]`);
    await expect(diagramNode).toHaveAttribute('data-component-type', 'excalidraw');
    await expect(diagramNode.locator('.workflow-component-brand-icon-excalidraw img')).toBeVisible();
    await expect(page.getByTestId('workflow-excalidraw-test-helper-add-rect')).toHaveCount(0);
    const nodeBorder = await diagramNode.evaluate(element => getComputedStyle(element).borderColor);
    expect(nodeBorder).toContain('105, 101, 219');

    await diagramNode.locator('.workflow-component-node-header').dblclick();
    const fullscreen = page.getByTestId('workflow-component-fullscreen');
    await expect(fullscreen).toHaveAttribute('data-component-type', 'excalidraw');
    await expect(fullscreen.getByTestId('workflow-fullscreen-loading')).toBeVisible();
    const editor = fullscreen.getByTestId('workflow-excalidraw-fullscreen-editor');
    await expect(editor).toHaveAttribute('data-editor-loaded', 'true', { timeout: 30000 });
    await expect(editor.locator('.excalidraw')).toBeVisible();
    await expect(page.getByTestId('workflow-excalidraw-test-helper-add-rect')).toHaveCount(0);

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('wf:workflow-toast', { detail: { message: 'M3 fullscreen layer check' } }));
    });
    const toast = page.getByTestId('workflow-toast');
    await expect(toast).toBeVisible();
    const fullscreenZ = await fullscreen.evaluate(element => Number.parseInt(getComputedStyle(element).zIndex || '0', 10));
    const toastZ = await toast.evaluate(element => Number.parseInt(getComputedStyle(element).zIndex || '0', 10));
    expect(fullscreenZ).toBeGreaterThan(toastZ);
    await expectTopLayerAtCenter(page, fullscreen, toast, 'fullscreen');
  });

  test('AC-007 Markdown and Diagram nodes open fullscreen editors backed by rich components', async ({ page }) => {
    test.setTimeout(90_000);
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const excalidrawState = defaultComponentState('excalidraw', excalidrawNodeId);
    excalidrawState.scene = {
      elements: [{
        id: 'rect-fullscreen-e2e',
        type: 'rectangle',
        x: 32,
        y: 34,
        width: 86,
        height: 52,
        strokeColor: '#166534',
        backgroundColor: '#dcfce7',
      }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    };
    const network = await installWorkflowFixture(page, { initialComponents: [markdownState, excalidrawState] });
    await openWorkflow(page);

    const markdownNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    await markdownNode.locator('.workflow-component-node-header').dblclick();
    await expect(page.getByTestId('workflow-component-fullscreen')).toHaveAttribute('data-component-type', 'markdown');
    await expect(page.getByTestId('workflow-component-settings')).toHaveCount(0);
    await expect(page.getByTestId('workflow-markdown-rich-editor')).toBeVisible({ timeout: 20000 });
    const richEditable = page.getByTestId('workflow-markdown-rich-editor').locator('[contenteditable="true"]').first();
    await expect(richEditable).toBeVisible();
    await richEditable.click();
    await page.keyboard.type(' Fullscreen rich edit');
    await page.getByTestId('workflow-component-fullscreen').getByTestId('workflow-component-fullscreen-save').click();
    await expect.poll(() => network.componentPutRequests.length).toBe(1);
    expect(network.componentPutRequests[0].payload.markdown).toContain('Fullscreen rich edit');
    await page.getByTestId('workflow-component-fullscreen-close').click();
    await expect(page.getByTestId('workflow-component-fullscreen')).toHaveCount(0);

    const diagramNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${excalidrawNodeId}"]`);
    await diagramNode.locator('.workflow-component-node-header').dblclick();
    await expect(page.getByTestId('workflow-component-fullscreen')).toHaveAttribute('data-component-type', 'excalidraw');
    await expect(page.getByTestId('workflow-component-settings')).toHaveCount(0);
    await expect(page.getByTestId('workflow-excalidraw-fullscreen-editor')).toBeVisible();
    await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('workflow-component-fullscreen').getByTestId('workflow-component-fullscreen-save').click();
    await expect.poll(() => network.componentPutRequests.length).toBe(2);
    expect(network.componentPutRequests[1].payload.scene.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'rectangle' }),
    ]));
  });

  test('AC-007 component node drag writes persisted graph-map position state', async ({ page }) => {
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const network = await installWorkflowFixture(page, { initialComponents: [markdownState] });
    await openWorkflow(page);

    const componentNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    const header = componentNode.locator('.workflow-component-node-header');
    await expect(header).toBeVisible();
    const box = await header.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 80, box!.y + 14);
    await page.mouse.down();
    await page.mouse.move(box!.x + 170, box!.y + 86);
    await page.mouse.up();

    await expect.poll(() => network.graphMapRequests.some(request => (
      request.payload?.positions?.[markdownNodeId]
      && typeof request.payload.positions[markdownNodeId].x === 'number'
      && typeof request.payload.positions[markdownNodeId].y === 'number'
    ))).toBe(true);
  });

  test('AC-006 component nodes are ReactFlow nodes, connect to agent nodes, and use backend snapshot as source of truth', async ({ page }) => {
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const network = await installWorkflowFixture(page, { initialComponents: [markdownState], includeInitialEdges: false });
    await openWorkflow(page);

    const componentNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`).first();
    await expect(componentNode).toBeVisible();
    await expect(componentNode).toHaveAttribute('data-react-flow-node', 'true');
    await expect(componentNode).toHaveAttribute('data-source-of-truth', 'backend');
    await expect(componentNode.locator('.workflow-component-node-handle-bidirectional.workflow-component-node-handle-top')).toBeVisible();
    await expect(componentNode.locator('.workflow-component-node-handle-bidirectional.workflow-component-node-handle-right')).toBeVisible();
    await expect(componentNode.locator('.workflow-component-node-handle-bidirectional.workflow-component-node-handle-bottom')).toBeVisible();
    await expect(componentNode.locator('.workflow-component-node-handle-bidirectional.workflow-component-node-handle-left')).toBeVisible();
    await expect(componentNode.locator('[data-testid="workflow-component-node-port"]')).toHaveCount(4);
    await expect(componentNode.locator('.react-flow__handle')).toHaveCount(4);
    await expect(componentNode.locator('.react-flow__handle[data-handleid="markdown:top"]')).toHaveCount(1);
    await expect(componentNode.locator('.react-flow__handle[data-handleid="markdown:right"]')).toHaveCount(1);
    await expect(componentNode.locator('.react-flow__handle[data-handleid="markdown:bottom"]')).toHaveCount(1);
    await expect(componentNode.locator('.react-flow__handle[data-handleid="markdown:left"]')).toHaveCount(1);
    await expect(componentNode.locator('[data-testid="workflow-component-node-port"][data-side="top"]')).toHaveCount(1);
    await expect(componentNode.locator('[data-testid="workflow-component-node-port"][data-side="right"]')).toHaveCount(1);
    await expect(componentNode.locator('[data-testid="workflow-component-node-port"][data-side="bottom"]')).toHaveCount(1);
    await expect(componentNode.locator('[data-testid="workflow-component-node-port"][data-side="left"]')).toHaveCount(1);
    await expect(componentNode.locator('.workflow-component-node-handle-hit-target')).toHaveCount(0);
    expect(await componentNode.locator('[data-testid="workflow-component-node-port"]').evaluateAll(elements => elements.map(element => ({
      port: element.getAttribute('data-port-id'),
      side: element.getAttribute('data-side'),
      mode: element.getAttribute('data-handle-mode'),
      role: element.getAttribute('data-handle-role'),
    })).sort((left, right) => String(left.side).localeCompare(String(right.side))))).toEqual([
      { port: 'markdown', side: 'bottom', mode: 'bidirectional', role: 'bidirectional' },
      { port: 'markdown', side: 'left', mode: 'bidirectional', role: 'bidirectional' },
      { port: 'markdown', side: 'right', mode: 'bidirectional', role: 'bidirectional' },
      { port: 'markdown', side: 'top', mode: 'bidirectional', role: 'bidirectional' },
    ]);
    await expect(componentNode.locator('[data-testid="workflow-component-node-output"]')).toHaveCount(0);
    await expect(componentNode.locator('[data-testid="workflow-component-node-input"]')).toHaveCount(0);
    await expect(page.locator(`[data-testid="workflow-edge"][data-source="${markdownNodeId}"][data-target="${graphNodeId}"]`)).toHaveCount(0);

    const sourceHandle = componentNode.locator('.workflow-component-node-handle-bidirectional.workflow-component-node-handle-right');
    const targetHandle = agentNode.locator('[data-testid="workflow-agent-node-context-input"]').first();
    await expect(sourceHandle).toBeVisible();
    await expect(targetHandle).toBeVisible();
    await dragHandlePath(page, sourceHandle, targetHandle);
    await expect.poll(() => network.workflowEdgeRequests.some(request => (
      request.method === 'POST'
      && JSON.stringify(request.payload).includes(markdownNodeId)
      && JSON.stringify(request.payload).includes(graphNodeId)
    ))).toBe(true);
    const createPayload = network.workflowEdgeRequests.find(request => (
      request.method === 'POST'
      && JSON.stringify(request.payload).includes(markdownNodeId)
      && JSON.stringify(request.payload).includes(graphNodeId)
    ))?.payload as JsonRecord;
    expect(createPayload).toEqual(expect.objectContaining({
      from: markdownNodeId,
      to: graphNodeId,
      relation: 'wf-bridge/context',
      sourceHandle: 'markdown:right',
      targetHandle: 'context',
    }));
    expect(JSON.stringify(createPayload)).not.toContain('<->');
    const createdEdge = page.locator(`[data-testid="workflow-edge"][data-source="${markdownNodeId}"][data-target="${graphNodeId}"]`);
    await expect(createdEdge).toBeVisible();
    await expect(page.getByTestId('workflow-bridge-label').filter({ hasText: 'markdown <-> context' })).toBeVisible();
    const createdEdgePath = createdEdge.locator('.react-flow__edge-path').first();
    await expect(createdEdgePath).toHaveAttribute('marker-start', /url/);
    await expect(createdEdgePath).toHaveAttribute('marker-end', /url/);
  });

  test('AC-007 resource ports can receive manual connections on either side without endpoint snap drift', async ({ page }) => {
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const excalidrawState = defaultComponentState('excalidraw', excalidrawNodeId);
    const network = await installWorkflowFixture(page, {
      initialComponents: [markdownState, excalidrawState],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`).first();
    const diagramNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${excalidrawNodeId}"]`);
    const markdownNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    await expect(agentNode).toBeVisible();
    await expect(diagramNode).toBeVisible();
    await expect(markdownNode).toBeVisible();
    await expect(diagramNode.locator('[data-testid="workflow-component-node-port"]')).toHaveCount(4);
    await expect(diagramNode.locator('.react-flow__handle')).toHaveCount(4);
    await expect(diagramNode.locator('.react-flow__handle[data-handleid="scene:top"]')).toHaveCount(1);
    await expect(diagramNode.locator('.react-flow__handle[data-handleid="scene:right"]')).toHaveCount(1);
    await expect(diagramNode.locator('.react-flow__handle[data-handleid="scene:bottom"]')).toHaveCount(1);
    await expect(diagramNode.locator('.react-flow__handle[data-handleid="scene:left"]')).toHaveCount(1);
    await expect(diagramNode.locator('[data-testid="workflow-component-node-port"][data-side="top"]')).toHaveCount(1);
    await expect(diagramNode.locator('[data-testid="workflow-component-node-port"][data-side="right"]')).toHaveCount(1);
    await expect(diagramNode.locator('[data-testid="workflow-component-node-port"][data-side="bottom"]')).toHaveCount(1);
    await expect(diagramNode.locator('[data-testid="workflow-component-node-port"][data-side="left"]')).toHaveCount(1);
    await expect(diagramNode.locator('.workflow-component-node-handle-hit-target')).toHaveCount(0);
    await expect(diagramNode.locator('[data-testid="workflow-component-node-input"]')).toHaveCount(0);
    await expect(diagramNode.locator('[data-testid="workflow-component-node-output"]')).toHaveCount(0);

    const agentRightHandle = agentNode.locator('.wf-flow-handle-right').first();
    const diagramRightHandle = diagramNode.locator('.workflow-component-node-handle-bidirectional.workflow-component-node-handle-right');
    const graphMapPutsBeforeConnect = network.graphMapRequests.filter(request => request.method === 'PUT').length;
    await dragHandlePath(page, agentRightHandle, diagramRightHandle);

    await expect.poll(() => network.workflowEdgeRequests.some(request => (
      request.method === 'POST'
      && request.payload?.from === graphNodeId
      && request.payload?.to === excalidrawNodeId
    ))).toBe(true);
    const createPayload = network.workflowEdgeRequests.find(request => (
      request.method === 'POST'
      && request.payload?.from === graphNodeId
      && request.payload?.to === excalidrawNodeId
    ))?.payload as JsonRecord;
    expect(createPayload).toEqual(expect.objectContaining({
      from: graphNodeId,
      to: excalidrawNodeId,
      sourceHandle: 'right',
      targetHandle: 'scene:right',
    }));
    expect(JSON.stringify(createPayload)).not.toContain(markdownNodeId);
    await expect(page.locator(`[data-testid="workflow-edge"][data-source="${graphNodeId}"][data-target="${excalidrawNodeId}"]`)).toBeVisible();
    await page.waitForTimeout(300);
    expect(
      network.graphMapRequests.filter(request => request.method === 'PUT'),
      'manual resource-port connect must not PUT full graph-map topology',
    ).toHaveLength(graphMapPutsBeforeConnect);
    await expect(page.locator(`[data-testid="workflow-edge"][data-source="${graphNodeId}"][data-target="${markdownNodeId}"]`)).toHaveCount(0);
  });

  test('AC-007 Timer event output connects to Agent event input from any side without endpoint snap drift', async ({ page }) => {
    const timerState = defaultTimerState(timerNodeId);
    const network = await installWorkflowFixture(page, {
      initialEvents: [timerState],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    const timerNode = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`).first();
    await expect(timerNode).toBeVisible();
    await expect(agentNode).toBeVisible();
    await expect(timerNode.locator('[data-testid="workflow-event-node-output"]')).toHaveCount(1);
    await expect(timerNode.locator('[data-testid="workflow-event-node-input"]')).toHaveCount(1);
    await expect(timerNode.locator('.react-flow__handle')).toHaveCount(4);
    await expect(timerNode.locator('.workflow-event-node-handle-top')).toHaveCount(1);
    await expect(timerNode.locator('.workflow-event-node-handle-bottom')).toHaveCount(1);
    await expect(agentNode.locator('[data-testid="workflow-agent-node-context-input"]')).toHaveCount(4);
    await expect(agentNode.locator('[data-testid="workflow-agent-node-context-input"][data-handle-side="top"]')).toHaveCount(1);
    await expect(agentNode.locator('[data-testid="workflow-agent-node-context-input"][data-handle-side="right"]')).toHaveCount(1);
    await expect(agentNode.locator('[data-testid="workflow-agent-node-context-input"][data-handle-side="bottom"]')).toHaveCount(1);
    await expect(agentNode.locator('[data-testid="workflow-agent-node-context-input"][data-handle-side="left"]')).toHaveCount(1);
    await expect(page.locator(`[data-testid="workflow-edge"][data-source="${timerNodeId}"][data-target="${graphNodeId}"]`)).toHaveCount(0);

    const sourceHandle = timerNode.locator('.workflow-event-node-handle-top');
    const targetHandle = agentNode.locator('[data-testid="workflow-agent-node-context-input"][data-handle-side="bottom"]');
    await dragHandlePath(page, sourceHandle, targetHandle);

    await expect.poll(() => network.workflowEdgeRequests.some(request => (
      request.method === 'POST'
      && request.payload?.from === timerNodeId
      && request.payload?.to === graphNodeId
    ))).toBe(true);
    const createPayload = network.workflowEdgeRequests.find(request => (
      request.method === 'POST'
      && request.payload?.from === timerNodeId
      && request.payload?.to === graphNodeId
    ))?.payload as JsonRecord;
    expect(createPayload).toEqual(expect.objectContaining({
      from: timerNodeId,
      to: graphNodeId,
      relation: 'event',
      direction: 'source-to-target',
      sourceHandle: 'event',
      targetHandle: 'event.in',
    }));
    expect(JSON.stringify(createPayload)).not.toContain(markdownNodeId);
    expect(JSON.stringify(createPayload)).not.toContain(excalidrawNodeId);
    await expect(page.locator(`[data-testid="workflow-edge"][data-source="${timerNodeId}"][data-target="${graphNodeId}"]`)).toBeVisible();
    const eventLabel = page.locator('[data-testid="workflow-bridge-label"][aria-label*="event.in"]').first();
    await expect(eventLabel).toBeVisible();
    await expect(eventLabel.locator('.wf-bridge-label-icon')).toBeVisible();
    await expect(eventLabel.locator('.wf-bridge-label-tooltip')).toHaveText(/event/);
    const eventPath = page.locator(`[data-testid="workflow-edge"][data-source="${timerNodeId}"][data-target="${graphNodeId}"] .react-flow__edge-path`).first();
    const labelBox = await eventLabel.boundingBox();
    const pathBox = await eventPath.boundingBox();
    expect(labelBox).not.toBeNull();
    expect(pathBox).not.toBeNull();
    const labelCenter = {
      x: labelBox!.x + labelBox!.width / 2,
      y: labelBox!.y + labelBox!.height / 2,
    };
    expect(labelCenter.x).toBeGreaterThanOrEqual(pathBox!.x - 2);
    expect(labelCenter.x).toBeLessThanOrEqual(pathBox!.x + pathBox!.width + 2);
    expect(labelCenter.y).toBeGreaterThanOrEqual(pathBox!.y - 2);
    expect(labelCenter.y).toBeLessThanOrEqual(pathBox!.y + pathBox!.height + 2);
    await expect(page.locator(`[data-testid="workflow-edge"][data-source="${timerNodeId}"][data-target="${markdownNodeId}"]`)).toHaveCount(0);
  });

  test('W33-MAGNET Timer-Agent magnetic dock uses capsule links without creating normal graph edges', async ({ page }) => {
    const timerState = defaultTimerState(timerNodeId);
    const network = await installWorkflowFixture(page, {
      initialEvents: [timerState],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    const timerNode = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`).first();
    const timerFlowNode = page.locator(`.react-flow__node[data-id="${timerNodeId}"]`);
    const agentTimerPill = agentNode.locator('.workflow-capsule-pill[data-role="timer"]');
    const timerEventLine = page.locator(`[data-testid="workflow-edge"][data-source="${timerNodeId}"][data-target="${graphNodeId}"]`);
    const timerControlLine = page.locator(`[data-testid="workflow-edge"][data-source="${graphNodeId}"][data-target="${timerNodeId}"]`);
    await expect(timerNode).toBeVisible();
    await expect(agentNode).toBeVisible();
    await expect(timerEventLine).toHaveCount(0);
    await expect(timerControlLine).toHaveCount(0);

    const postsBefore = network.workflowEdgeRequests.filter(request => request.method === 'POST').length;
    const timerBox = await timerNode.boundingBox();
    const agentBox = await agentNode.boundingBox();
    expect(timerBox).not.toBeNull();
    expect(agentBox).not.toBeNull();
    await dragNodeCenterTo(page, timerNode, {
      x: agentBox!.x - (timerBox!.width / 2) - 10,
      y: agentBox!.y + agentBox!.height / 2,
    });

    await expect.poll(() => network.graphMapRequests.some(request => (
      request.method === 'PUT'
        && Array.isArray(request.payload?.capsuleDockLinks)
        && request.payload.capsuleDockLinks.some((link: JsonRecord) => (
          Array.isArray(link.connections)
            && link.connections.map((connection: JsonRecord) => `${connection.source || connection.from}->${connection.target || connection.to}:${connection.relation}`).sort().join('|')
              === [`${graphNodeId}->${timerNodeId}:control`, `${timerNodeId}->${graphNodeId}:event`].sort().join('|')
        ))
    ))).toBe(true);
    expect(network.workflowEdgeRequests.filter(request => request.method === 'POST').length).toBe(postsBefore);
    const dockPut = network.graphMapRequests.find(request => (
      request.method === 'PUT'
        && Array.isArray(request.payload?.capsuleDockLinks)
        && request.payload.capsuleDockLinks.length > 0
    ));
    expect((dockPut?.payload?.edges || []).length).toBe(0);
    await expect(timerFlowNode).toHaveClass(/workflow-capsule-docked/);
    await expect(timerEventLine).toHaveCount(0);
    await expect(timerControlLine).toHaveCount(0);
    await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-workflow-edge-count', '0');
    await expect(agentTimerPill).toHaveAttribute('data-state', 'linked');

    const deletesBefore = network.workflowEdgeRequests.filter(request => request.method === 'DELETE').length;
    const viewport = page.viewportSize() || { width: 1280, height: 900 };
    const dockedTimerBox = await timerNode.boundingBox();
    const dockedAgentBox = await agentNode.boundingBox();
    expect(dockedTimerBox).not.toBeNull();
    expect(dockedAgentBox).not.toBeNull();
    await dragNodeCenterTo(page, timerNode, {
      x: Math.min(viewport.width - 120, dockedAgentBox!.x + dockedAgentBox!.width + dockedTimerBox!.width + 180),
      y: Math.min(viewport.height - 90, dockedAgentBox!.y + dockedAgentBox!.height + 260),
    });
    await expect.poll(() => network.graphMapRequests.some(request => (
      request.method === 'PUT'
        && Array.isArray(request.payload?.capsuleDockLinks)
        && request.payload.capsuleDockLinks.length === 0
    ))).toBe(true);
    expect(network.workflowEdgeRequests.filter(request => request.method === 'DELETE').length).toBe(deletesBefore);
    await page.waitForTimeout(600);
    await expect(timerEventLine).toHaveCount(0);
    await expect(timerControlLine).toHaveCount(0);
    await expect(agentTimerPill).toHaveAttribute('data-state', 'empty');
    await expect(agentTimerPill).toContainText(/Timer offline/);
    await expect(page.getByTestId('workflow-agent-control-aura')).toHaveCount(0);
  });

  test('W33-MAGNET existing normal edges hide while docked and restore on detach without selection residue', async ({ page }) => {
    const timerState = defaultTimerState(timerNodeId);
    const existingEdges = [
      {
        id: 'manual-timer-agent-event',
        source: timerNodeId,
        target: graphNodeId,
        from: timerNodeId,
        to: graphNodeId,
        relation: 'event',
        direction: 'source-to-target',
        sourceHandle: 'event',
        targetHandle: 'event.in',
      },
      {
        id: 'manual-agent-timer-control',
        source: graphNodeId,
        target: timerNodeId,
        from: graphNodeId,
        to: timerNodeId,
        relation: 'control',
        direction: 'source-to-target',
        sourceHandle: 'context',
        targetHandle: 'config',
      },
    ];
    const network = await installWorkflowFixture(page, {
      initialEvents: [timerState],
      initialGraphEdges: existingEdges,
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    const timerNode = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`).first();
    const timerEventLine = page.locator(`[data-testid="workflow-edge"][data-source="${timerNodeId}"][data-target="${graphNodeId}"]`);
    const timerControlLine = page.locator(`[data-testid="workflow-edge"][data-source="${graphNodeId}"][data-target="${timerNodeId}"]`);
    const agentTimerPill = agentNode.locator('.workflow-capsule-pill[data-role="timer"]');
    await expect(timerEventLine).toBeVisible();
    await expect(timerControlLine).toBeVisible();
    await expect(agentTimerPill).toHaveAttribute('data-state', 'linked');

    await page.locator('[data-testid="workflow-bridge-label"][aria-label*="event"]').first().click();
    await expect(page.getByTestId('workflow-edge-selection-count')).toBeVisible();

    const postsBefore = network.workflowEdgeRequests.filter(request => request.method === 'POST').length;
    const deletesBefore = network.workflowEdgeRequests.filter(request => request.method === 'DELETE').length;
    const timerBox = await timerNode.boundingBox();
    const agentBox = await agentNode.boundingBox();
    expect(timerBox).not.toBeNull();
    expect(agentBox).not.toBeNull();
    await dragNodeCenterTo(page, timerNode, {
      x: agentBox!.x - (timerBox!.width / 2) - 10,
      y: agentBox!.y + agentBox!.height / 2,
    });

    await expect.poll(() => {
      const latestPut = [...network.graphMapRequests].reverse().find(request => request.method === 'PUT' && Array.isArray(request.payload?.capsuleDockLinks));
      const links = latestPut?.payload?.capsuleDockLinks || [];
      return links.length === 1
        && links[0].edges?.map((edge: JsonRecord) => edge.edgeId).sort().join('|') === existingEdges.map(edge => edge.id).sort().join('|')
        && links[0].edges?.every((edge: JsonRecord) => edge.retention === 'keep');
    }).toBe(true);
    await expect(timerEventLine).toHaveCount(0);
    await expect(timerControlLine).toHaveCount(0);
    await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-workflow-edge-count', '0');
    await expect(page.getByTestId('workflow-edge-selection-count')).toHaveCount(0);

    const viewport = page.viewportSize() || { width: 1280, height: 900 };
    const dockedTimerBox = await timerNode.boundingBox();
    const dockedAgentBox = await agentNode.boundingBox();
    expect(dockedTimerBox).not.toBeNull();
    expect(dockedAgentBox).not.toBeNull();
    await dragNodeCenterTo(page, timerNode, {
      x: Math.min(viewport.width - 120, dockedAgentBox!.x + dockedAgentBox!.width + dockedTimerBox!.width + 180),
      y: Math.min(viewport.height - 90, dockedAgentBox!.y + dockedAgentBox!.height + 260),
    });

    await expect.poll(() => {
      const latestPut = [...network.graphMapRequests].reverse().find(request => request.method === 'PUT' && Array.isArray(request.payload?.capsuleDockLinks));
      return (latestPut?.payload?.capsuleDockLinks || []).length === 0
        && (latestPut?.payload?.edges || []).map((edge: JsonRecord) => edge.id).sort().join('|') === existingEdges.map(edge => edge.id).sort().join('|');
    }).toBe(true);
    await expect(timerEventLine).toBeVisible();
    await expect(timerControlLine).toBeVisible();
    await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-workflow-edge-count', '2');
    await expect(agentTimerPill).toHaveAttribute('data-state', 'linked');
    expect(network.workflowEdgeRequests.filter(request => request.method === 'POST').length).toBe(postsBefore);
    expect(network.workflowEdgeRequests.filter(request => request.method === 'DELETE').length).toBe(deletesBefore);
    await expect(page.getByTestId('workflow-agent-control-aura')).toHaveCount(0);
  });

  test('W34-MAGNET Agent node can magnet to Timer and Goal nodes from vertical sides without normal edges', async ({ page }) => {
    const timerState = defaultTimerState(timerNodeId);
    const goalState = defaultGoalState(goalNodeId);
    const network = await installWorkflowFixture(page, {
      initialEvents: [timerState],
      initialGoals: [goalState],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`).first();
    const timerNode = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    const goalNode = page.locator(`[data-testid="workflow-goal-node"][data-node-id="${goalNodeId}"]`);
    const agentFlowNode = page.locator(`.react-flow__node[data-id="${graphNodeId}"]`);
    const agentTimerPill = agentNode.locator('.workflow-capsule-pill[data-role="timer"]');
    const agentGoalPill = agentNode.locator('.workflow-capsule-pill[data-role="goal"]');
    await expect(agentNode).toBeVisible();
    await expect(timerNode).toBeVisible();
    await expect(goalNode).toBeVisible();
    await expect(goalNode.locator('[data-testid="workflow-goal-node-port"]')).toHaveCount(4);
    await expect(goalNode.locator('[data-testid="workflow-goal-node-port"][data-handle-side="top"]')).toHaveCount(1);
    await expect(goalNode.locator('[data-testid="workflow-goal-node-port"][data-handle-side="right"]')).toHaveCount(1);
    await expect(goalNode.locator('[data-testid="workflow-goal-node-port"][data-handle-side="bottom"]')).toHaveCount(1);
    await expect(goalNode.locator('[data-testid="workflow-goal-node-port"][data-handle-side="left"]')).toHaveCount(1);

    const agentBox = await agentNode.boundingBox();
    const timerBox = await timerNode.boundingBox();
    expect(agentBox).not.toBeNull();
    expect(timerBox).not.toBeNull();
    const edgePostsBefore = network.workflowEdgeRequests.filter(request => request.method === 'POST').length;
    await dragNodeCenterTo(page, agentNode, {
      x: timerBox!.x + timerBox!.width / 2,
      y: timerBox!.y - agentBox!.height / 2 - 12,
    });

    await expect.poll(() => network.graphMapRequests.some(request => (
      request.method === 'PUT'
        && Array.isArray(request.payload?.capsuleDockLinks)
        && request.payload.capsuleDockLinks.some((link: JsonRecord) => (
          link.side === 'top'
            && Array.isArray(link.nodeIds)
            && link.nodeIds.includes(graphNodeId)
            && link.nodeIds.includes(timerNodeId)
            && Array.isArray(link.connections)
            && link.connections.length === 2
        ))
    ))).toBe(true);
    expect(network.workflowEdgeRequests.filter(request => request.method === 'POST').length).toBe(edgePostsBefore);
    await expect(agentFlowNode).toHaveClass(/workflow-capsule-docked/);
    await expect(agentTimerPill).toHaveAttribute('data-state', 'linked');
    await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-workflow-edge-count', '0');

    const dockedAgentBox = await agentNode.boundingBox();
    const goalBox = await goalNode.boundingBox();
    expect(dockedAgentBox).not.toBeNull();
    expect(goalBox).not.toBeNull();
    await dragNodeCenterTo(page, agentNode, {
      x: goalBox!.x + goalBox!.width / 2,
      y: goalBox!.y + goalBox!.height + dockedAgentBox!.height / 2 + 12,
    });

    await expect.poll(() => {
      const latestPut = [...network.graphMapRequests].reverse().find(request => request.method === 'PUT' && Array.isArray(request.payload?.capsuleDockLinks));
      const links = latestPut?.payload?.capsuleDockLinks || [];
      return links.length === 1
        && links.some((link: JsonRecord) => (
          link.side === 'bottom'
            && Array.isArray(link.nodeIds)
            && link.nodeIds.includes(graphNodeId)
            && link.nodeIds.includes(goalNodeId)
            && Array.isArray(link.connections)
            && link.connections.some((connection: JsonRecord) => String(connection.relation || '') === 'goal')
        ));
    }).toBe(true);
    expect(network.workflowEdgeRequests.filter(request => request.method === 'POST').length).toBe(edgePostsBefore);
    await expect(agentTimerPill).toHaveAttribute('data-state', 'empty');
    await expect(agentGoalPill).toHaveAttribute('data-state', 'linked');
    await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-workflow-edge-count', '0');
  });

  test('AC-007 Capability ports connect bidirectionally to Agent context without endpoint snap drift', async ({ page }) => {
    const capabilityState = defaultCapabilityState(skillGroupNodeId, [{
      id: 'skill:wf-ui',
      name: 'wf-ui',
      title: 'WF-UI Adapter',
      description: 'Open and control the local workflow UI.',
      source: 'skills-hub',
      state: 'indexed',
    }]);
    const network = await installWorkflowFixture(page, {
      initialCapabilities: [capabilityState],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    const capabilityNode = page.locator(`[data-testid="workflow-capability-node"][data-node-id="${skillGroupNodeId}"]`);
    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`).first();
    await expect(capabilityNode).toBeVisible();
    await expect(agentNode).toBeVisible();
    await expect(capabilityNode.locator('[data-testid="workflow-capability-node-port"]')).toHaveCount(4);
    await expect(capabilityNode.locator('.react-flow__handle')).toHaveCount(4);
    await expect(capabilityNode.locator('.react-flow__handle[data-handleid="capability:top"]')).toHaveCount(1);
    await expect(capabilityNode.locator('.react-flow__handle[data-handleid="capability:right"]')).toHaveCount(1);
    await expect(capabilityNode.locator('.react-flow__handle[data-handleid="capability:bottom"]')).toHaveCount(1);
    await expect(capabilityNode.locator('.react-flow__handle[data-handleid="capability:left"]')).toHaveCount(1);
    await expect(capabilityNode.locator('[data-testid="workflow-capability-node-port"][data-handle-side="top"]')).toHaveCount(1);
    await expect(capabilityNode.locator('[data-testid="workflow-capability-node-port"][data-handle-side="right"]')).toHaveCount(1);
    await expect(capabilityNode.locator('[data-testid="workflow-capability-node-port"][data-handle-side="bottom"]')).toHaveCount(1);
    await expect(capabilityNode.locator('[data-testid="workflow-capability-node-port"][data-handle-side="left"]')).toHaveCount(1);
    await expect(page.locator(`[data-testid="workflow-edge"][data-source="${skillGroupNodeId}"][data-target="${graphNodeId}"]`)).toHaveCount(0);

    const sourceHandle = capabilityNode.locator('[data-testid="workflow-capability-node-port"][data-handle-side="right"]');
    const targetHandle = agentNode.locator('[data-testid="workflow-agent-node-context-input"]').first();
    await dragHandlePath(page, sourceHandle, targetHandle);

    await expect.poll(() => network.workflowEdgeRequests.some(request => (
      request.method === 'POST'
      && request.payload?.from === skillGroupNodeId
      && request.payload?.to === graphNodeId
    ))).toBe(true);
    const createPayload = network.workflowEdgeRequests.find(request => (
      request.method === 'POST'
      && request.payload?.from === skillGroupNodeId
      && request.payload?.to === graphNodeId
    ))?.payload as JsonRecord;
    expect(createPayload).toEqual(expect.objectContaining({
      from: skillGroupNodeId,
      to: graphNodeId,
      relation: 'capability',
      direction: 'bidirectional',
      sourceHandle: 'capability:right',
      targetHandle: 'context',
    }));
    expect(JSON.stringify(createPayload)).not.toContain(timerNodeId);
    expect(JSON.stringify(createPayload)).not.toContain(excalidrawNodeId);
    await expect(page.locator(`[data-testid="workflow-edge"][data-source="${skillGroupNodeId}"][data-target="${graphNodeId}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="workflow-edge"][data-source="${skillGroupNodeId}"][data-target="${timerNodeId}"]`)).toHaveCount(0);
  });

  test('AC-006 stale revision or network failure shows a clear error without losing local Markdown text', async ({ page }) => {
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    await installWorkflowFixture(page, { initialComponents: [markdownState], failNextPut: 409 });
    await openWorkflow(page);

    await setMarkdownEditorText(page, 'Unsaved local text survives stale revision');
    await page.getByTestId('workflow-component-node-save').click();

    await expect(page.getByTestId('workflow-component-node-error')).toBeVisible();
    await expect(page.getByTestId('workflow-component-node-error')).toContainText(/stale|revision|save failed/i);
    await expect(page.getByTestId('workflow-markdown-node-editor')).toContainText('Unsaved local text survives stale revision');
    await expect(page.getByTestId('workflow-component-node-save')).toBeEnabled();
  });

  test('AC-006 keeps M1 Explorer, terminal owner, M2 settings, and component node layout usable at desktop and narrow widths', async ({ page }) => {
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const excalidrawState = defaultComponentState('excalidraw', excalidrawNodeId);
    await installWorkflowFixture(page, { initialComponents: [markdownState, excalidrawState] });
    await page.setViewportSize({ width: 1440, height: 960 });
    await openWorkflow(page);

    await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
    await expect(page.getByTestId('terminal-input-owner')).toBeVisible();
    await expect(page.getByTestId('workflow-markdown-node-editor')).toBeVisible();
    await expect(page.getByTestId('workflow-excalidraw-node')).toBeVisible();

    const agentNode = page.getByTestId('workflow-node').first();
    await agentNode.click();
    await agentNode.click({ button: 'right' });
    await page.locator('[data-testid="workflow-node-context-action"][data-action="settings"]').click();
    await expect(page.getByTestId('workflow-node-settings')).toBeVisible();

    const surfaces = [
      ['explorer', page.getByTestId('workflow-explorer-shell')],
      ['create-node', page.getByTestId('workflow-create-node')],
      ['markdown-editor', page.getByTestId('workflow-markdown-node-editor')],
      ['excalidraw-node', page.getByTestId('workflow-excalidraw-node')],
      ['node-settings', page.getByTestId('workflow-node-settings')],
    ];
    for (const [label, surface] of surfaces) {
      await expectInViewport(page, surface as Locator, String(label));
    }
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);

    await page.getByTestId('workflow-node-settings').locator('button[title="Close"]').click();
    const diagramNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${excalidrawNodeId}"]`);
    await diagramNode.click({ button: 'right' });
    await page.locator('[data-testid="workflow-node-context-action"][data-action="settings"]').click();
    const componentSettings = page.getByTestId('workflow-component-settings');
    await expect(componentSettings).toBeVisible();
    await expectInViewport(page, componentSettings, 'component settings');
    const settingsBox = await componentSettings.boundingBox();
    expect(settingsBox, 'component settings should have compact bounds').not.toBeNull();
    expect(settingsBox!.width).toBeLessThanOrEqual(402);
    expect(settingsBox!.height).toBeLessThanOrEqual(540);
    expect(settingsBox!.y).toBeGreaterThanOrEqual(52);
    const settingsFooterBox = await componentSettings.locator('.workflow-node-settings-footer').boundingBox();
    expect(settingsFooterBox, 'component settings footer should be compact').not.toBeNull();
    expect(settingsFooterBox!.height).toBeLessThanOrEqual(60);

    await page.setViewportSize({ width: 390, height: 820 });
    await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
    await expect(page.getByTestId('terminal-input-owner')).toBeVisible();
    await expect(page.getByTestId('workflow-component-settings')).toBeVisible();
    await expect(page.getByTestId('workflow-markdown-node-editor')).toBeVisible();
    await expect(page.getByTestId('workflow-excalidraw-node')).toBeVisible();
    await expectInViewport(page, page.getByTestId('workflow-component-settings'), 'narrow component settings');
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
  });

  test('AC-006 bridge label selects or drags on single click and opens the bridge panel only on double-click', async ({ page }) => {
    const timerState = defaultTimerState(timerNodeId);
    const network = await installWorkflowFixture(page, {
      initialEvents: [timerState],
      includeInitialEdges: false,
      initialGraphEdges: [{
        id: 'edge-timer-agent-event-label-e2e',
        source: timerNodeId,
        target: graphNodeId,
        sourceHandle: 'event',
        targetHandle: 'event.in',
        relation: 'event',
        direction: 'source-to-target',
      }],
    });
    await openWorkflow(page);

    const label = page.locator('[data-testid="workflow-bridge-label"][aria-label*="event.in"]').first();
    await expect(label).toBeVisible();
    await label.click();
    await expect(page.getByTestId('workflow-bridge-panel')).toHaveCount(0);
    await expect(page.getByTestId('workflow-edge-selection-count')).toBeVisible();

    const beforeRequests = network.graphMapRequests.length;
    const box = await label.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 34);
    await page.mouse.up();
    await expect.poll(() => network.graphMapRequests.length).toBeGreaterThan(beforeRequests);

    await label.dblclick();
    await expect(page.getByTestId('workflow-bridge-panel')).toBeVisible();
  });

  test('AC-006 keeps one readable bridge label and compacts lower-priority labels in a crowded cluster', async ({ page }) => {
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    await installWorkflowFixture(page, {
      initialComponents: [markdownState],
      includeInitialEdges: false,
      initialGraphEdges: [
        {
          id: 'edge-crowded-primary',
          source: markdownNodeId,
          target: graphNodeId,
          sourceHandle: 'markdown:right',
          targetHandle: 'context',
          relation: 'wf-bridge/context',
          direction: 'bidirectional',
        },
        {
          id: 'edge-crowded-secondary',
          source: markdownNodeId,
          target: graphNodeId,
          sourceHandle: 'markdown:right',
          targetHandle: 'context',
          relation: 'wf-bridge/context',
          direction: 'bidirectional',
        },
      ],
    });
    await openWorkflow(page);

    const labels = page.getByTestId('workflow-bridge-label');
    await expect(labels).toHaveCount(2);
    await expect(page.locator('[data-testid="workflow-bridge-label"][data-compact="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="workflow-bridge-label"][data-compact="true"]')).toHaveAttribute('aria-label', /<->/);
    await expect(page.locator('[data-testid="workflow-bridge-label"][data-compact="false"]')).toHaveCount(1);
  });
});
