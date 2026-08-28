import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sessionId = 'e2e-session-save-shortcut';
const graphNodeId = 'e2e-agent-save-shortcut';
const markdownNodeId = 'component-markdown-save-e2e';
const excalidrawNodeId = 'component-excalidraw-save-e2e';
const fileNodeId = 'component-file-save-e2e';
const timerNodeId = 'event-timer-save-e2e';
const goalNodeId = 'goal-task-save-e2e';

type JsonRecord = Record<string, any>;
type ComponentType = 'markdown' | 'excalidraw' | 'file';
type EventType = 'timer';

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
  fileActionRequests: JsonRecord[];
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
  const title = type === 'markdown' ? 'Save Notes' : type === 'file' ? 'Save File' : 'Save Diagram';
  return {
    nodeId,
    type,
    title,
    revision: 1,
    markdown: type === 'markdown' ? '# Save Notes\n\nInitial backend text.' : undefined,
    scene: type === 'excalidraw'
      ? { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }
      : undefined,
    file: type === 'file'
      ? { source: 'workspace', path: 'notes.txt', name: 'notes.txt', mime: 'text/plain', size: 38 }
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
    title: 'Save Timer',
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
    title: 'Save Shortcut Goal',
    taskId: 'task-optimize-cmds-save-shortcut',
    objective: 'Verify Ctrl+S save shortcut across all node surfaces.',
    status: 'active',
    phase: 'implement',
    gate: 'TEST-GATE',
    revision: 1,
    acceptance: [
      { id: 'AC-001', text: 'Canvas Ctrl+S flushes graph-map and shows toast.', status: 'tracked' },
      { id: 'AC-005', text: 'Goal expanded Ctrl+S saves via goal.update.', status: 'tracked' },
    ],
    progress: { verified: 0, total: 2 },
    nextAction: 'Run save shortcut e2e tests.',
    blocker: null,
    activeQuestion: null,
    confirmation: { required: true },
    wdt: { timerNodeId, state: 'ok', staleAfterMs: 1800000 },
    stateRef: { path: 'Harness/tasks/task-optimize-cmds-save-shortcut/STATE.json', revision: 1 },
    contentRef: { planPath: 'Harness/tasks/task-optimize-cmds-save-shortcut/PLAN.md', progressPath: 'Harness/tasks/task-optimize-cmds-save-shortcut/PROGRESS.md' },
    statePath: 'Harness/tasks/task-optimize-cmds-save-shortcut/STATE.json',
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

function workflowSnapshot(components: ComponentState[] = [], options: { includeInitialEdges?: boolean; events?: EventState[]; goals?: GoalState[]; graphEdges?: JsonRecord[]; capsuleDockLinks?: JsonRecord[] } = {}) {
  const includeInitialEdges = options.includeInitialEdges !== false;
  const events = options.events || [];
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
    workflowId: 'e2e-workflow-save-shortcut',
    taskId: 'task-optimize-cmds-save-shortcut',
    mode: 'wf-max',
    phase: 'save-shortcut-red',
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
      label: 'Save Agent',
      kind: 'terminal-session',
      level: 0,
      status: 'running',
      lifecycle: 'live',
      runtimeState: 'running',
      managedByCurrentServer: true,
      control: control(),
      role: nodeConfig.role,
      skills: nodeConfig.skills,
      permissions: nodeConfig.permissions,
      sessionId,
      taskId: 'task-optimize-cmds-save-shortcut',
      agentKind: nodeConfig.role,
      runtime: 'codex',
      peerId: 'codex',
      objective: nodeConfig.prompt,
      cwd: nodeConfig.cwd,
      graphNodeId,
      config: nodeConfig,
    }, ...componentNodes, ...eventNodes, ...goalNodes],
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
      workflowId: 'e2e-workflow-save-shortcut',
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
        taskId: 'task-optimize-cmds-save-shortcut',
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
      })), ...goalNodes.map(node => ({
        nodeId: node.id,
        kind: 'goal-node',
        type: 'goal',
        status: node.status,
        lifecycle: 'goal-anchor',
        runtimeState: node.runtimeState,
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
        ...Object.fromEntries(goalNodes.map(node => [node.id, node.position])),
      },
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes',
      sourceOfTruth: 'backend',
      componentStateRefs,
      eventStateRefs,
      goalStateRefs,
    },
    componentNodes: Object.fromEntries(components.map(state => [state.nodeId, state])),
    eventNodes: Object.fromEntries(events.map(state => [state.nodeId, state])),
    goalNodes: Object.fromEntries(goals.map(state => [state.nodeId, state])),
    graphContextBySessionId: {
      [sessionId]: {
        workflowMapPath: 'Harness/a2a/workflow-map.json',
        componentStatePath: 'Harness/a2a/component-nodes',
        sourceOfTruth: 'backend',
        componentStateRefs,
        eventStateRefs,
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
      { name: 'notes.txt', path: 'notes.txt', type: 'file', size: 38, hasChildren: false },
      { name: 'package.json', path: 'package.json', type: 'file', size: 820, hasChildren: false },
    ],
  };
  return table[normalized] || [];
}

async function installWorkflowFixture(
  page: Page,
  options: { initialComponents?: ComponentState[]; initialEvents?: EventState[]; initialGoals?: GoalState[]; initialGraphEdges?: JsonRecord[]; includeInitialEdges?: boolean } = {},
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
    fileActionRequests: [],
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
  const goals = new Map<string, GoalState>();
  for (const state of options.initialGoals || []) {
    goals.set(state.nodeId, { ...state });
  }
  const graphEdges: JsonRecord[] = [...(options.initialGraphEdges || [])];
  let capsuleDockLinks: JsonRecord[] = [];
  let graphVersion = 1;

  // File fixture data for file.* actions.
  const fileFixtures: Record<string, { meta: JsonRecord; preview: JsonRecord }> = {};
  const savedFileTexts: Record<string, string> = {};
  for (const state of options.initialComponents || []) {
    if (state.type === 'file' && state.file) {
      fileFixtures[state.nodeId] = {
        meta: { file: state.file },
        preview: { path: state.file.path, previewKind: 'text', mime: state.file.mime || 'text/plain' },
      };
      savedFileTexts[state.nodeId] = 'Initial file content for save shortcut e2e.';
    }
  }

  page.on('pageerror', error => network.pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('/favicon.ico')) {
      network.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, {
    taskId: 'task-optimize-cmds-save-shortcut',
    phase: 'save-shortcut-red',
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
    taskId: 'task-optimize-cmds-save-shortcut',
    status: 'open',
    phase: 'save-shortcut-red',
  }]));
  const currentSnapshot = () => workflowSnapshot([...components.values()], {
    includeInitialEdges: options.includeInitialEdges,
    events: [...timers.values()],
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
    entries: [{ seq: 1, stream: 'stdout', data: '\r\nSave shortcut fixture ready\r\n' }],
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
      text: 'Save shortcut bounded file preview fixture.\nSecond preview line.',
      bytesRead: 62,
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
    ].filter(server => !q || `${server.name} ${server.title} ${server.transport} ${server.commandName} ${server.url} ${server.envKeys.join(' ')}`.toLowerCase().includes(q));
    return jsonResponse(route, {
      ok: true,
      schemaVersion: 1,
      kind: 'mcp-hub',
      generatedAt: '2026-08-05T00:00:00.000Z',
      query: { scope: url.searchParams.get('scope') || 'project', q, limit: 250 },
      roots: [
        { id: 'project-mcp', label: 'Project MCP config', scope: 'project', runtime: 'mcp', exists: true, path: '.mcp.json' },
      ],
      summary: { serverCount: servers.length, groupCount: 1, envKeyCount: servers.reduce((count, server) => count + server.envKeys.length, 0), redactedFieldCount: servers.filter(server => server.risk.secretsRedacted).length },
      nodeSemantics: {
        role: 'agent-attached-tool-resource-provider',
        defaultConnection: 'bidirectional capability/status port to Agent nodes',
        executor: 'agent',
        safety: 'metadata-only-no-spawn-no-secret',
      },
      servers,
      groups: [
        { id: 'transport:stdio', label: 'stdio transport', kind: 'transport', serverIds: servers.filter(server => server.transport === 'stdio').map(server => server.id) },
      ].filter(group => group.serverIds.length > 0),
    });
  });
  await page.route('**/api/a2a/nodes/**/config', route => {
    const payload = route.request().postDataJSON() as JsonRecord;
    network.nodeConfigPatchRequests.push(payload);
    return jsonResponse(route, {
      ok: true,
      node: { id: graphNodeId, config: nodeConfig },
      restartRequired: false,
      revision: 2 + network.nodeConfigPatchRequests.length,
    });
  });
  // The app auto-starts the main agent node on canvas load (startNode auto).
  // The real e2e wf-ui-server has no session registry and 501s this, which the
  // app surfaces as a persistent error toast that masks the success toast. Mock
  // it to a benign 200 with the shape startNode reads (result.started?.sessionId/
  // ?.status) so no field is missing.
  await page.route('**/api/a2a/nodes/**/start', route => jsonResponse(route, {
    ok: true,
    nodeId: graphNodeId,
    started: { sessionId, status: 'running' },
    revision: 4,
  }));
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
        ? `component-file-save-${network.componentCreateRequests.length}`
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
      const actionPayload = route.request().postDataJSON() || {};

      // File.* actions for WorkflowFileBigView.
      if (action.startsWith('file.')) {
        network.fileActionRequests.push({ action, nodeId, payload: actionPayload });
        const fixture = fileFixtures[nodeId];
        if (action === 'file.meta') {
          return jsonResponse(route, { ok: true, result: fixture?.meta || { file: { path: '' } } });
        }
        if (action === 'file.preview') {
          return jsonResponse(route, { ok: true, result: fixture?.preview || { path: '', previewKind: 'none' } });
        }
        if (action === 'file.readText') {
          const text = savedFileTexts[nodeId] || '';
          return jsonResponse(route, { ok: true, result: { text, bytesRead: text.length, truncated: false } });
        }
        if (action === 'file.writeText') {
          const content = String(actionPayload.content || '');
          savedFileTexts[nodeId] = content;
          return jsonResponse(route, {
            ok: true,
            result: { ok: true, path: fixture?.meta?.file?.path || '', bytes: content.length, mtime: '2026-08-01T00:00:01.000Z', revision: 2 },
          });
        }
        return jsonResponse(route, { ok: true, result: { ok: true } });
      }

      if (action === 'node.delete') {
        network.nodeDeleteRequests.push({ nodeId });
        components.delete(nodeId);
        timers.delete(nodeId);
        goals.delete(nodeId);
        return jsonResponse(route, { ok: true, action, node: null, result: { ok: true, nodeId } });
      }
      if (action === 'node.restore') {
        network.nodeRestoreRequests.push({ nodeId, payload: actionPayload });
        return jsonResponse(route, {
          ok: true,
          action,
          node: null,
          result: { ok: true, nodeId },
        });
      }
      const eventState = timers.get(nodeId);
      if (eventState) {
        network.timerActionRequests.push({
          action,
          nodeId,
          payload: actionPayload,
        });
        const updated = applyTimerActionState(eventState, action, actionPayload, nodeId);
        timers.set(nodeId, updated);
        return jsonResponse(route, {
          ok: true,
          action,
          node: timerRuntimeNodeSnapshot(updated, { x: 300, y: 610 }),
          result: { state: updated, schedule: updated.schedule, heartbeat: updated.heartbeat },
        });
      }
      const goalState = goals.get(nodeId);
      if (goalState) {
        network.goalActionRequests.push({
          action,
          nodeId,
          payload: actionPayload,
        });
        const updated = action === 'goal.update'
          ? {
              ...goalState,
              ...actionPayload,
              nodeId,
              type: 'goal' as const,
              title: String(actionPayload.title || goalState.title),
              status: String(actionPayload.status || goalState.status) as GoalState['status'],
              acceptance: Array.isArray(actionPayload.acceptance) ? actionPayload.acceptance : goalState.acceptance,
              progress: Array.isArray(actionPayload.acceptance)
                ? {
                    verified: actionPayload.acceptance.filter((item: JsonRecord) => /verified|complete|done|pass/i.test(String(item.status || ''))).length,
                    total: actionPayload.acceptance.length,
                  }
                : goalState.progress,
              wdt: actionPayload.wdt ? { ...goalState.wdt, ...actionPayload.wdt } : goalState.wdt,
              revision: goalState.revision + 1,
              statePath: goalState.statePath,
            }
          : action === 'goal.requestCompletion'
            ? {
                ...goalState,
                status: 'proposed-complete' as const,
                revision: goalState.revision + 1,
                confirmation: {
                  required: true,
                  proposedBy: String(actionPayload.actorNodeId || graphNodeId),
                  evidenceRefs: Array.isArray(actionPayload.evidenceRefs) ? actionPayload.evidenceRefs : [],
                },
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
      .map(link => {
        const record = link as JsonRecord;
        return {
          ...record,
          edges: Array.isArray(record.edges)
            ? record.edges.filter((binding: JsonRecord | string) => (
                typeof binding === 'string'
                  ? binding !== edgeId
                  : String(binding.edgeId || binding.id || '') !== edgeId
              ))
            : [],
        };
      })
      .filter((link: JsonRecord) => (
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

/**
 * Press Ctrl+S (or Cmd+S on macOS) via the keyboard.
 * Playwright's 'Control+s' produces e.key === 's' with ctrlKey true,
 * matching the useSaveShortcut and WorkflowRoute canvas handlers.
 */
async function pressSaveShortcut(page: Page) {
  await page.keyboard.press('Control+s');
}

/**
 * Drag a component node to schedule a debounced graph-map PUT.
 * Returns the component node locator.
 */
async function dragComponentNodeToSchedulePut(page: Page, componentNode: Locator) {
  const header = componentNode.locator('.workflow-component-node-header');
  await expect(header).toBeVisible();
  const box = await header.boundingBox();
  expect(box, 'node header should have a bounding box before drag').not.toBeNull();
  await page.mouse.move(box!.x + 80, box!.y + 14);
  await page.mouse.down();
  await page.mouse.move(box!.x + 170, box!.y + 86, { steps: 6 });
  await page.mouse.up();
  // Allow the React re-render + effect to schedule the 250 ms debounce timer,
  // but stay well inside the window so the PUT is still pending when
  // pressSaveShortcut fires.
  await page.waitForTimeout(80);
}

/**
 * Open the component-node fullscreen surface by double-clicking its header.
 * Waits for the fullscreen testid to be visible with the expected
 * data-component-type.
 */
async function openComponentFullscreen(
  page: Page,
  componentNode: Locator,
  expectedType: 'markdown' | 'excalidraw',
) {
  await componentNode.locator('.workflow-component-node-header').dblclick();
  const fullscreen = page.getByTestId('workflow-component-fullscreen');
  await expect(fullscreen).toHaveAttribute('data-component-type', expectedType);
  return fullscreen;
}

test.describe('WF UI Ctrl/Cmd+S save shortcut acceptance (task-optimize-cmds-save-shortcut)', () => {

  test('AC-001 canvas Ctrl+S flushes pending graph-map PUT before the 250ms debounce could fire, shows saved toast, no component save', async ({ page }) => {
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const network = await installWorkflowFixture(page, {
      initialComponents: [markdownState],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    // Drag the markdown node to schedule a debounced graph-map PUT.
    const componentNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    await dragComponentNodeToSchedulePut(page, componentNode);

    // Record the graph-map PUT count before Ctrl+S.
    const putsBefore = network.graphMapRequests.filter(r => r.method === 'PUT').length;

    // Ctrl+S on the canvas (no node surface open) must flush the pending PUT
    // immediately — the 250ms debounce timer is still running at press time,
    // so only a flush can explain a PUT this early.
    await pressSaveShortcut(page);

    // Hard 150ms deadline: well inside the 250ms debounce window, so the
    // natural debounce expiry cannot satisfy this. If the app's
    // graphPutFlushRef.current?.() call were deleted, the PUT would only
    // arrive at ~250ms and this poll would time out.
    await expect
      .poll(() => network.graphMapRequests.filter(r => r.method === 'PUT').length, { timeout: 150 })
      .toBeGreaterThan(putsBefore);

    // The saved toast must be visible.
    const toast = page.getByTestId('workflow-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/saved/i);

    // No component save must have fired.
    expect(network.componentPutRequests, 'no component PATCH/PUT should be recorded').toHaveLength(0);

    // Hardening: firePendingGraphPut CONSUMES the pending debounce (it nulls
    // graphPutDebounceRef before firing), so exactly one PUT must arrive — the
    // flush must not be followed by a second PUT from the old timer.
    const putsAfterFlush = network.graphMapRequests.filter(r => r.method === 'PUT').length;
    await expect
      .poll(() => network.graphMapRequests.filter(r => r.method === 'PUT').length, { timeout: 500 })
      .toBe(putsAfterFlush);
  });

  test('AC-002 excalidraw fullscreen Ctrl+S saves scene via component PUT', async ({ page }) => {
    test.setTimeout(90_000);
    const excalidrawState = defaultComponentState('excalidraw', excalidrawNodeId);
    excalidrawState.scene = {
      elements: [{
        id: 'rect-save-shortcut-e2e',
        type: 'rectangle',
        x: 30,
        y: 28,
        width: 92,
        height: 58,
        strokeColor: '#6965DB',
        backgroundColor: 'rgba(105,101,219,0.16)',
      }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    };
    const network = await installWorkflowFixture(page, {
      initialComponents: [excalidrawState],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    // Open the excalidraw fullscreen editor.
    const diagramNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${excalidrawNodeId}"]`);
    const fullscreen = await openComponentFullscreen(page, diagramNode, 'excalidraw');
    const editor = fullscreen.getByTestId('workflow-excalidraw-fullscreen-editor');
    await expect(editor).toHaveAttribute('data-editor-loaded', 'true', { timeout: 30000 });

    // Ctrl+S in the excalidraw fullscreen should trigger a component save.
    await pressSaveShortcut(page);

    // The component PUT/PATCH must appear in network.componentPutRequests
    // with the excalidraw scene payload.
    await expect.poll(() => network.componentPutRequests.length).toBeGreaterThan(0);
    const put = network.componentPutRequests[0];
    expect(put).toEqual(expect.objectContaining({
      method: 'PATCH',
      nodeId: excalidrawNodeId,
      payload: expect.objectContaining({
        scene: expect.objectContaining({
          elements: expect.arrayContaining([
            expect.objectContaining({ type: 'rectangle' }),
          ]),
        }),
      }),
    }));
  });

  test('AC-003 markdown fullscreen Ctrl+S saves dirty text via component PATCH with revision', async ({ page }) => {
    test.setTimeout(90_000);
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const network = await installWorkflowFixture(page, {
      initialComponents: [markdownState],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    // Open the markdown fullscreen editor.
    const markdownNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    const fullscreen = await openComponentFullscreen(page, markdownNode, 'markdown');
    const richEditor = fullscreen.getByTestId('workflow-markdown-rich-editor');
    await expect(richEditor).toBeVisible({ timeout: 20000 });
    const richEditable = richEditor.locator('[contenteditable="true"]').first();
    await expect(richEditable).toBeVisible();

    // Type to make the editor dirty.
    await richEditable.click();
    await page.keyboard.type(' AC-003 dirty text from save shortcut');

    // Ctrl+S in the markdown fullscreen should trigger a component save.
    await pressSaveShortcut(page);

    // The component PATCH must appear with the dirty markdown and a revision.
    await expect.poll(() => network.componentPutRequests.length).toBeGreaterThan(0);
    const put = network.componentPutRequests[0];
    expect(put).toEqual(expect.objectContaining({
      method: 'PATCH',
      nodeId: markdownNodeId,
      payload: expect.objectContaining({
        revision: expect.any(Number),
        markdown: expect.stringContaining('AC-003 dirty text from save shortcut'),
      }),
    }));
  });

  test('AC-004 file big-view Ctrl+S saves dirty text via file.writeText action', async ({ page }) => {
    test.setTimeout(60_000);
    const fileState = defaultComponentState('file', fileNodeId);
    // Ensure the file is a text-kind file so the big view renders a textarea.
    fileState.file = {
      source: 'workspace',
      path: 'notes.txt',
      name: 'notes.txt',
      mime: 'text/plain',
      size: 38,
    };
    const network = await installWorkflowFixture(page, {
      initialComponents: [fileState],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    // Open the file big view by double-clicking the file node.
    const fileNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${fileNodeId}"]`);
    await fileNode.dblclick();
    const bigView = page.getByTestId('workflow-file-big-view');
    await expect(bigView).toBeVisible();
    await expect(bigView).toHaveAttribute('data-node-id', fileNodeId);

    // Wait for the text editor to be populated (file.readText).
    const editor = page.getByTestId('workflow-file-big-view-text-editor');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(editor).toHaveValue(/Initial file content/);

    // Make it dirty by filling new content.
    await editor.fill('AC-004 dirty content from save shortcut');

    // Ctrl+S in the file big view should trigger file.writeText.
    await pressSaveShortcut(page);

    // The file.writeText action must be recorded.
    await expect.poll(() => network.fileActionRequests.filter(r => r.action === 'file.writeText').length).toBeGreaterThan(0);
    const write = network.fileActionRequests.find(r => r.action === 'file.writeText')!;
    expect(write.nodeId).toBe(fileNodeId);
    expect(write.payload).toEqual(expect.objectContaining({
      content: 'AC-004 dirty content from save shortcut',
    }));
  });

  test('AC-005 goal expanded Ctrl+S saves via goal.update action', async ({ page }) => {
    const goal = defaultGoalState();
    const network = await installWorkflowFixture(page, {
      initialGoals: [goal],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    // Open the goal expanded node by double-clicking.
    const goalNode = page.locator(`[data-testid="workflow-goal-node"][data-node-id="${goalNodeId}"]`);
    await goalNode.dblclick();
    const editor = page.getByTestId('workflow-goal-expanded-node');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute('data-node-id', goalNodeId);

    // Ctrl+S in the goal expanded view should trigger a goal.save.
    await pressSaveShortcut(page);

    // The goal.update action must be recorded with the goal's real payload —
    // the title and acceptance text the fixture set — so a garbage or
    // empty-body save would fail here.
    await expect.poll(() => network.goalActionRequests.length).toBeGreaterThan(0);
    const save = network.goalActionRequests[0];
    expect(save).toEqual(expect.objectContaining({
      action: 'goal.update',
      nodeId: goalNodeId,
      payload: expect.objectContaining({
        title: goal.title,
        objective: goal.objective,
        acceptance: expect.arrayContaining([
          expect.objectContaining({ id: 'AC-001' }),
        ]),
      }),
    }));
  });

  test('AC-006 timer expanded Ctrl+S saves via timer.configure action', async ({ page }) => {
    const timer = defaultTimerState(timerNodeId);
    const network = await installWorkflowFixture(page, {
      initialEvents: [timer],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    // Open the timer expanded node by double-clicking.
    const timerNode = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    await timerNode.dblclick();
    const editor = page.getByTestId('workflow-timer-expanded-node');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute('data-node-id', timerNodeId);

    // Ctrl+S in the timer expanded view should trigger a timer.save.
    await pressSaveShortcut(page);

    // The timer.configure action must be recorded with the timer's real
    // payload — the title and interval the fixture set — so a garbage or
    // empty-body save would fail here.
    await expect.poll(() => network.timerActionRequests.length).toBeGreaterThan(0);
    const save = network.timerActionRequests[0];
    expect(save).toEqual(expect.objectContaining({
      action: 'timer.configure',
      nodeId: timerNodeId,
      payload: expect.objectContaining({
        title: timer.title,
        schedule: expect.objectContaining({
          intervalSeconds: timer.schedule.intervalSeconds,
        }),
      }),
    }));
  });

  test('AC-007 Ctrl+S in a plain input (no node open) does NOT fire graph-map PUT or toast', async ({ page }) => {
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const network = await installWorkflowFixture(page, {
      initialComponents: [markdownState],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    // Open the create-node panel to get a plain <input> (search box) to focus.
    // The canvas keydown handler (WorkflowRoute) early-returns when
    // event.target.closest('input, textarea, select, [contenteditable], .xterm')
    // is truthy, so Ctrl+S in an input must not trigger a save or toast.
    await page.getByTestId('workflow-create-node').click();
    const searchBox = page.getByTestId('workflow-create-node-search');
    await expect(searchBox).toBeVisible();
    await searchBox.click();
    await searchBox.fill('test');

    // Record graph-map PUT count and toast visibility before Ctrl+S.
    const putsBefore = network.graphMapRequests.filter(r => r.method === 'PUT').length;
    const toastBefore = await page.getByTestId('workflow-toast').count();

    // Ctrl+S while focused in the search input.
    await pressSaveShortcut(page);

    // Brief wait to allow any async side-effects to settle.
    await page.waitForTimeout(300);

    // No new graph-map PUT.
    const putsAfter = network.graphMapRequests.filter(r => r.method === 'PUT').length;
    expect(putsAfter, 'no new graph-map PUT after Ctrl+S in input').toBe(putsBefore);

    // No toast should appear: the canvas handler early-returns for input
    // targets, so the toast count must be EXACTLY unchanged (an exact
    // equality, not a lenient "did not increase" — a stray new toast must
    // still fail this even if an older toast happens to be on screen).
    const toastAfter = await page.getByTestId('workflow-toast').count();
    expect(toastAfter, 'no toast should appear after Ctrl+S in input').toBe(toastBefore);

    // No component save.
    expect(network.componentPutRequests).toHaveLength(0);
  });

  test('AC-007b Ctrl+S on a .xterm target with an active capture surface is a no-op (no component save, no canvas toast)', async ({ page }) => {
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const network = await installWorkflowFixture(page, {
      initialComponents: [markdownState],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    // Open the markdown fullscreen so useSaveShortcut is ACTIVE for this
    // component node.
    const markdownNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    await openComponentFullscreen(page, markdownNode, 'markdown');

    // Inject a focusable fake terminal element and focus it, so the keydown
    // target resolves to .xterm.
    await page.evaluate(() => {
      const terminal = document.createElement('div');
      terminal.className = 'xterm';
      terminal.setAttribute('tabindex', '0');
      terminal.textContent = 'fake terminal';
      document.body.appendChild(terminal);
      terminal.focus();
    });
    await expect
      .poll(async () => page.evaluate(() => document.activeElement?.className || ''))
      .toContain('xterm');

    const putsBefore = network.graphMapRequests.filter(r => r.method === 'PUT').length;
    const toastsBefore = await page.getByTestId('workflow-toast').count();

    // Ctrl+S with the .xterm target focused.
    await pressSaveShortcut(page);

    // Brief wait to allow any async side-effects to settle.
    await page.waitForTimeout(300);

    // Neither the active capture hook (useSaveShortcut .xterm guard) nor the
    // canvas bubble handler (:6782 .xterm guard) may fire.
    expect(network.componentPutRequests, 'no component save from the .xterm target').toHaveLength(0);
    const putsAfter = network.graphMapRequests.filter(r => r.method === 'PUT').length;
    expect(putsAfter, 'no graph-map PUT from the .xterm target').toBe(putsBefore);
    const toastAfter = await page.getByTestId('workflow-toast').count();
    expect(toastAfter, 'no toast from the .xterm target').toBe(toastsBefore);
    const canvasSavedToast = page.getByTestId('workflow-toast').filter({ hasText: /canvas saved/i });
    await expect(canvasSavedToast).toHaveCount(0);

    // Remove the fake element.
    await page.evaluate(() => {
      document.querySelector('div.xterm')?.remove();
    });
  });

  test('AC-008 with the goal surface OPEN (capture hook active), non-\'s\' keys pass through: Ctrl+Z is not misread as save and Delete reaches the canvas handler', async ({ page }) => {
    // The goal expanded node mounts useSaveShortcut(save, true) — the hook is
    // ACTIVE the whole time the surface is open. Its backdrop stops pointer
    // events but NOT keydown, so keys on a non-editor target bubble to the
    // window canvas handler. This proves the active capture hook only
    // intercepts key === \'s\' and lets every other key (Ctrl+Z, Delete)
    // reach the canvas bubble handler untouched.
    const goal = defaultGoalState();
    const network = await installWorkflowFixture(page, {
      initialGoals: [goal],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    const goalNode = page.locator(`[data-testid="workflow-goal-node"][data-node-id="${goalNodeId}"]`);
    await expect(goalNode).toBeVisible();

    // Double-click opens the expanded surface AND selects the goal node
    // (doubleClickNode sets selectedNodeIds to the goal node before opening).
    await goalNode.dblclick();
    const expanded = page.getByTestId('workflow-goal-expanded-node');
    await expect(expanded).toBeVisible();
    await expect(expanded).toHaveAttribute('data-node-id', goalNodeId);

    // Ensure keyboard focus is on a NON-input, NON-.xterm, NON-contenteditable
    // target (the goal surface and node are plain divs, none of which match the
    // :6782 bail selector). Blur any focused element so the canvas guard does
    // not bail; if focus ever lands on an input, the poll below fails loudly
    // instead of silently re-testing the wrong branch.
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body) el.blur();
    });
    await expect
      .poll(async () => page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? el.closest('input, textarea, select, [contenteditable="true"], .xterm') === null : false;
      }))
      .toBe(true);

    // Step B (Ctrl+Z): the active hook must NOT swallow Ctrl+Z or misread it
    // as a save. undoGraph() is async and unobservable here; the contract is
    // the NEGATIVES — no save, no node action, no "saved" toast, no delete.
    const deletesBefore = network.nodeDeleteRequests.length;
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(network.componentPutRequests, 'Ctrl+Z must not trigger a component save').toHaveLength(0);
    expect(network.goalActionRequests, 'Ctrl+Z must not trigger a goal action').toHaveLength(0);
    expect(network.timerActionRequests, 'Ctrl+Z must not trigger a timer action').toHaveLength(0);
    expect(network.fileActionRequests, 'Ctrl+Z must not trigger a file action').toHaveLength(0);
    expect(network.nodeDeleteRequests, 'Ctrl+Z must not delete the selected node').toHaveLength(deletesBefore);
    await expect(page.getByTestId('workflow-toast').filter({ hasText: /saved/i }), 'no "saved" toast from Ctrl+Z').toHaveCount(0);

    // Step A (Delete): the active hook must NOT swallow Delete, so it reaches
    // the canvas bubble handler, which deletes the still-selected goal node.
    // Proven by the node.delete action being recorded AND the node detaching.
    await page.keyboard.press('Delete');
    await expect.poll(() => network.nodeDeleteRequests.length, { timeout: 5000 }).toBeGreaterThan(deletesBefore);
    expect(network.nodeDeleteRequests[network.nodeDeleteRequests.length - 1]).toEqual(expect.objectContaining({ nodeId: goalNodeId }));
    // The goal node must detach from the canvas (the fixture removes it from
    // the node map on node.delete, so the next reload re-renders without it).
    await expect.poll(async () => page.locator(`[data-testid="workflow-goal-node"][data-node-id="${goalNodeId}"]`).count(), { timeout: 5000 }).toBe(0);
  });

  test('AC-008b regression (surface CLOSED): Ctrl+S on a selected node does NOT delete it (only Delete/Backspace deletes)', async ({ page }) => {
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const network = await installWorkflowFixture(page, {
      initialComponents: [markdownState],
      includeInitialEdges: false,
    });
    await openWorkflow(page);

    const componentNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    await expect(componentNode).toBeVisible();

    // Select the node by clicking its header (NOT the card center, which for a
    // markdown node is the contenteditable editor). Clicking the editor would
    // leave focus in [contenteditable=true], and the canvas keydown handler
    // bails on input targets — so the header keeps keyboard focus on a
    // non-editor target and lets the canvas Ctrl+S handler fire.
    await componentNode.locator('.workflow-component-node-header').click();

    // Ctrl+S should NOT delete the node.
    await pressSaveShortcut(page);

    // The canvas "saved" toast is transient (2000ms) and, unlike AC-001, no
    // graph-map PUT/reload extends it here — assert it immediately while it is
    // still mounted.
    const toast = page.getByTestId('workflow-toast');
    await expect(toast).toBeVisible({ timeout: 2000 });
    await expect(toast).toContainText(/saved/i);

    // The node must still be visible.
    await expect(componentNode).toBeVisible();

    // No node delete request must have been recorded.
    expect(network.nodeDeleteRequests, 'no node delete after Ctrl+S').toHaveLength(0);

    // No component save must have fired either (Ctrl+S on a selected
    // component node without its surface open goes to the canvas handler,
    // which only flushes graph-map and shows a toast).
    expect(network.componentPutRequests, 'no component PATCH after Ctrl+S on selected node').toHaveLength(0);
  });
});
