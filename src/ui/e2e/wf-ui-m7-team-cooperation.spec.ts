import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// WF UI M7 — Agent Team Cooperation UI acceptance (AC-003/T5, AC-015/T12,
// AC-025/UX-4). Contracts: Harness/specs/cooperation/agent-team-cooperation-spec.md
// §3 (role profile / card identity), §6.2 (single-Goal-per-group rejection
// shape goal_already_bound), §4.5 (collaboration audit).
// TaskType: ui / e2e. No production code is exercised beyond the built UI.

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const mainSessionId = 'e2e-session-m7-main';
const mainAgentNodeId = 'e2e-agent-m7-main';
const reviewerSessionId = 'e2e-session-m7-reviewer';
const reviewerNodeId = `session-${reviewerSessionId}`;
const timerNodeId = 'e2e-event-timer-m7';
const goalNodeId = 'e2e-goal-m7';
const requestId = 'req-m7-review-1';
const wakeupMessageId = 'wake-m7-1';

type JsonRecord = Record<string, any>;

type M7Network = {
  sessionCreateRequests: JsonRecord[];
  nodeCreateRequests: JsonRecord[];
  goalRejections: JsonRecord[];
  bridgeAuditRequests: string[];
  pageErrors: string[];
};

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function requestJson(route: Route) {
  try {
    return route.request().postData() ? route.request().postDataJSON() as JsonRecord : {};
  } catch {
    return {};
  }
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

function timerState() {
  return {
    nodeId: timerNodeId,
    type: 'timer',
    title: 'M7 Timer',
    revision: 1,
    enabled: true,
    schedule: { mode: 'interval', intervalSeconds: 60, cron: '', cadence: { kind: 'fixed' } },
    heartbeat: {
      base: { enabled: true, intervalSeconds: 60, count: 0, nextDueAt: '' },
      watchdog: { enabled: false, intervalSeconds: 600, timeoutSeconds: 1800, missedCount: 0, state: 'ok' },
    },
    controlPolicy: { agentCanDisable: true, agentCanSetInterval: true, minIntervalSeconds: 5, maxIntervalSeconds: 86400 },
    payloadTemplate: {},
    eventCount: 0,
    lastFiredAt: '',
    lastEvent: null,
    statePath: `Harness/a2a/event-nodes/${timerNodeId}/state.json`,
  };
}

function goalState() {
  return {
    nodeId: goalNodeId,
    type: 'goal',
    title: 'M7 Goal',
    taskId: 'task-agent-team-cooperation-layer',
    objective: 'Deliver Agent Team Cooperation UI acceptance.',
    status: 'active',
    phase: 'implement',
    gate: 'TEST-GATE',
    revision: 1,
    acceptance: [{ id: 'M7-001', text: 'Team cooperation UI acceptance.', status: 'tracked' }],
    progress: { verified: 0, total: 1 },
    nextAction: 'Run e2e evidence.',
    blocker: null,
    activeQuestion: null,
    confirmation: { required: false },
    wdt: { timerNodeId, state: 'ok', staleAfterMs: 1800000 },
    stateRef: { path: 'Harness/tasks/task-agent-team-cooperation-layer/STATE.json', revision: 1 },
    contentRef: {
      planPath: 'Harness/tasks/task-agent-team-cooperation-layer/PLAN.md',
      progressPath: 'Harness/tasks/task-agent-team-cooperation-layer/PROGRESS.md',
    },
    statePath: 'Harness/tasks/task-agent-team-cooperation-layer/STATE.json',
  };
}

function timerRuntimeNode(position: { x: number; y: number }) {
  const state = timerState();
  return {
    nodeId: state.nodeId,
    kind: 'timer',
    version: state.revision,
    lifecycle: 'event-source',
    status: { state: 'ready', updatedAt: '2026-08-12T00:00:00.000Z' },
    graph: {
      position,
      handles: {
        inputs: ['config'],
        outputs: ['event'],
        bidirectional: ['status'],
        ports: ['event', 'config', 'status'],
        physical: ['config:left', 'event:right', 'status:bottom'],
      },
      connections: [],
    },
    stateRef: { path: state.statePath, revision: state.revision },
    contentRef: { kind: 'event-node-state', statePath: state.statePath, revision: state.revision, eventKind: 'timer' },
    settings: { schemaId: 'timer-settings', values: {}, revision: 0 },
    capabilities: ['state:read', 'state:update', 'timer.read', 'timer.configure', 'timer.enable', 'timer.disable', 'timer.setInterval'],
    ui: { previewKind: 'timer', settingsPanel: 'timer-settings', testId: 'workflow-event-node', labels: { title: state.title } },
  };
}

function goalRuntimeNode(position: { x: number; y: number }) {
  const state = goalState();
  return {
    nodeId: state.nodeId,
    kind: 'goal',
    version: state.revision,
    lifecycle: 'goal-anchor',
    status: { state: state.status, updatedAt: '2026-08-12T00:00:00.000Z' },
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
    ui: { previewKind: 'goal', settingsPanel: 'goal-settings', testId: 'workflow-goal-node', labels: { title: state.title } },
  };
}

function mainAgentNode(position: { x: number; y: number }) {
  return {
    id: mainAgentNodeId,
    label: 'Main Agent',
    displayName: 'Main Agent',
    roleTitle: 'ceo',
    kind: 'terminal-session',
    level: 0,
    status: 'running',
    lifecycle: 'live',
    runtimeState: 'running',
    managedByCurrentServer: true,
    control: control(),
    role: 'ceo',
    skills: ['wf-max', 'tdd', 'wf-browser'],
    permissions: { filesystem: 'workspace-write', network: 'enabled' },
    sessionId: mainSessionId,
    taskId: 'task-agent-team-cooperation-layer',
    agentKind: 'main',
    runtime: 'codex',
    peerId: 'codex',
    objective: 'M7 team cooperation fixture main agent',
    cwd: repoRoot,
    graphNodeId: mainAgentNodeId,
    position,
  };
}

function reviewerAgentNode(reviewer: JsonRecord, position: { x: number; y: number }) {
  return {
    id: reviewer.nodeId,
    label: String(reviewer.displayName || 'M7 Reviewer'),
    displayName: String(reviewer.displayName || ''),
    roleTitle: String(reviewer.roleTitle || ''),
    kind: 'terminal-session',
    level: 0,
    status: 'running',
    lifecycle: 'live',
    runtimeState: 'running',
    managedByCurrentServer: true,
    control: control(),
    role: String(reviewer.roleTitle || 'subagent'),
    skills: ['wf-max'],
    permissions: { filesystem: 'workspace-write', network: 'enabled' },
    sessionId: reviewer.sessionId,
    taskId: 'task-agent-team-cooperation-layer',
    agentKind: String(reviewer.agentKind || 'subagent'),
    runtime: String(reviewer.runtime || 'codex'),
    peerId: String(reviewer.runtime || 'codex'),
    objective: String(reviewer.responsibility || 'M7 reviewer agent'),
    cwd: repoRoot,
    graphNodeId: reviewer.nodeId,
    position,
  };
}

function workflowSnapshot(options: {
  magneticGroup: boolean;
  sessions: JsonRecord[];
  reviewers: JsonRecord[];
  graphVersion: number;
  capsuleDockLinks: JsonRecord[];
}) {
  const { magneticGroup, sessions, reviewers, graphVersion, capsuleDockLinks } = options;
  const positions: JsonRecord = {
    [mainAgentNodeId]: { x: 420, y: 200 },
  };
  const snapshotNodes: JsonRecord[] = [mainAgentNode(positions[mainAgentNodeId])];
  const graphNodes: JsonRecord[] = [{
    nodeId: mainAgentNodeId,
    sessionId: mainSessionId,
    agentKind: 'main',
    runtime: 'codex',
    status: 'running',
    lifecycle: 'live',
    runtimeState: 'running',
    managedByCurrentServer: true,
    control: control(),
    taskId: 'task-agent-team-cooperation-layer',
    cwd: repoRoot,
    position: positions[mainAgentNodeId],
    displayName: 'Main Agent',
    roleTitle: 'ceo',
  }];
  const eventStateRefs: JsonRecord = {};
  const goalStateRefs: JsonRecord = {};
  const eventNodes: JsonRecord = {};
  const goalNodes: JsonRecord = {};

  if (magneticGroup) {
    const timerPosition = { x: 420, y: 570 };
    const goalPosition = { x: 420, y: -170 };
    positions[timerNodeId] = timerPosition;
    positions[goalNodeId] = goalPosition;
    const timerRecord = timerState();
    const goalRecord = goalState();
    eventStateRefs[timerNodeId] = {
      type: 'timer',
      eventKind: 'timer',
      title: timerRecord.title,
      statePath: timerRecord.statePath,
      revision: timerRecord.revision,
      schedule: timerRecord.schedule,
      lastEvent: timerRecord.lastEvent,
      lastFiredAt: timerRecord.lastFiredAt,
      eventCount: timerRecord.eventCount,
    };
    goalStateRefs[goalNodeId] = {
      type: 'goal',
      title: goalRecord.title,
      taskId: goalRecord.taskId,
      objective: goalRecord.objective,
      status: goalRecord.status,
      phase: goalRecord.phase,
      gate: goalRecord.gate,
      statePath: goalRecord.statePath,
      revision: goalRecord.revision,
      acceptance: goalRecord.acceptance,
      progress: goalRecord.progress,
      nextAction: goalRecord.nextAction,
      confirmation: goalRecord.confirmation,
      wdt: goalRecord.wdt,
      stateRef: goalRecord.stateRef,
      contentRef: goalRecord.contentRef,
    };
    eventNodes[timerNodeId] = timerRecord;
    goalNodes[goalNodeId] = goalRecord;
    snapshotNodes.push({
      id: timerNodeId,
      nodeId: timerNodeId,
      label: timerRecord.title,
      kind: 'event-node',
      type: 'timer',
      level: 0,
      status: 'ready',
      lifecycle: 'event-source',
      runtimeState: 'ready',
      managedByCurrentServer: true,
      control: control(),
      graphNodeId: timerNodeId,
      revision: timerRecord.revision,
      statePath: timerRecord.statePath,
      position: timerPosition,
    }, {
      id: goalNodeId,
      nodeId: goalNodeId,
      label: goalRecord.title,
      kind: 'goal-node',
      type: 'goal',
      level: 0,
      status: goalRecord.status,
      lifecycle: 'goal-anchor',
      runtimeState: goalRecord.status,
      managedByCurrentServer: true,
      control: control(),
      graphNodeId: goalNodeId,
      revision: goalRecord.revision,
      statePath: goalRecord.statePath,
      position: goalPosition,
    });
    graphNodes.push({
      nodeId: timerNodeId,
      kind: 'event-node',
      type: 'timer',
      status: 'ready',
      lifecycle: 'event-source',
      runtimeState: 'ready',
      managedByCurrentServer: true,
      control: control(),
      position: timerPosition,
      statePath: timerRecord.statePath,
      revision: timerRecord.revision,
      stateRef: { path: timerRecord.statePath, revision: timerRecord.revision },
    }, {
      nodeId: goalNodeId,
      kind: 'goal-node',
      type: 'goal',
      status: goalRecord.status,
      lifecycle: 'goal-anchor',
      runtimeState: goalRecord.runtimeState || goalRecord.status,
      managedByCurrentServer: true,
      control: control(),
      position: goalPosition,
      statePath: goalRecord.statePath,
      revision: goalRecord.revision,
      stateRef: goalRecord.stateRef,
    });
  }

  for (const reviewer of reviewers) {
    const position = reviewer.position || { x: 860, y: 220 };
    positions[reviewer.nodeId] = position;
    snapshotNodes.push(reviewerAgentNode(reviewer, position));
    graphNodes.push({
      nodeId: reviewer.nodeId,
      sessionId: reviewer.sessionId,
      agentKind: String(reviewer.agentKind || 'subagent'),
      runtime: String(reviewer.runtime || 'codex'),
      status: 'running',
      lifecycle: 'live',
      runtimeState: 'running',
      managedByCurrentServer: true,
      control: control(),
      taskId: 'task-agent-team-cooperation-layer',
      cwd: repoRoot,
      position,
      displayName: String(reviewer.displayName || ''),
      roleTitle: String(reviewer.roleTitle || ''),
    });
  }

  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-12T00:00:00.000Z',
    workflowId: 'e2e-workflow-m7',
    taskId: 'task-agent-team-cooperation-layer',
    mode: 'wf-max',
    phase: 'm7-red',
    gate: 'TEST-GATE',
    rootAgentId: mainAgentNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions,
    nodes: snapshotNodes,
    edges: [],
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-m7',
      version: graphVersion,
      nodes: graphNodes,
      edges: [],
      capsuleDockLinks,
      positions,
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes',
      sourceOfTruth: 'backend',
      componentStateRefs: {},
      eventStateRefs,
      capabilityStateRefs: {},
      goalStateRefs,
    },
    componentNodes: {},
    eventNodes,
    capabilityNodes: {},
    goalNodes,
    graphContextBySessionId: {},
  };
}

function defaultMagneticDockLinks() {
  return [
    {
      id: 'dock-m7-goal',
      side: 'top',
      nodeIds: [goalNodeId, mainAgentNodeId],
      connections: [{
        source: goalNodeId,
        target: mainAgentNodeId,
        relation: 'goal',
        direction: 'bidirectional',
        sourceHandle: 'goal:bottom',
        targetHandle: 'context',
      }],
      edges: [],
    },
    {
      id: 'dock-m7-timer',
      side: 'bottom',
      nodeIds: [timerNodeId, mainAgentNodeId],
      connections: [
        {
          source: mainAgentNodeId,
          target: timerNodeId,
          relation: 'control',
          direction: 'source-to-target',
          sourceHandle: 'context',
          targetHandle: 'config',
        },
        {
          source: timerNodeId,
          target: mainAgentNodeId,
          relation: 'event',
          direction: 'source-to-target',
          sourceHandle: 'event',
          targetHandle: 'event.in',
        },
      ],
      edges: [],
    },
  ];
}

function auditBridgeEntries() {
  return [
    {
      seq: 1,
      ts: '2026-08-12T09:01:00.000Z',
      messageId: 'msg-m7-ask-1',
      requestId,
      threadId: 'thread-m7-1',
      replyTo: '',
      deliveryMode: 'direct',
      source: 'agent.sendMessage',
      fromSessionId: mainSessionId,
      toSessionId: reviewerSessionId,
      toRole: 'reviewer',
      data: 'Please review the PR scope and reply with evidence.',
    },
    {
      seq: 2,
      ts: '2026-08-12T09:02:00.000Z',
      messageId: 'msg-m7-reply-1',
      requestId,
      threadId: 'thread-m7-1',
      replyTo: 'msg-m7-ask-1',
      deliveryMode: 'direct',
      source: 'agent.sendMessage',
      fromSessionId: reviewerSessionId,
      toSessionId: mainSessionId,
      data: 'Review done: PR scope is clear.',
    },
    {
      seq: 3,
      ts: '2026-08-12T09:03:00.000Z',
      messageId: wakeupMessageId,
      timerNodeId,
      goalNodeId,
      fromNodeId: timerNodeId,
      deliveryMode: 'wakeup',
      source: 'timer.wakeup',
      data: '',
    },
  ];
}

function reviewerSessionRecord(reviewer: JsonRecord) {
  return {
    sessionId: reviewer.sessionId,
    runtime: String(reviewer.runtime || 'codex'),
    role: String(reviewer.roleTitle || 'subagent'),
    displayName: String(reviewer.displayName || ''),
    roleTitle: String(reviewer.roleTitle || ''),
    agentKind: String(reviewer.agentKind || 'subagent'),
    status: 'running',
    attachMode: true,
    wsClientCount: 1,
    workflowMode: 'wf-max',
    cwd: repoRoot,
    graphNodeId: reviewer.nodeId,
    inputOwnerId: 'drawer',
  };
}

async function installWorkflowFixture(
  page: Page,
  options: {
    magneticGroup?: boolean;
    seedReviewer?: boolean;
    bridgeEntries?: JsonRecord[] | null;
  } = {},
): Promise<M7Network> {
  const magneticGroup = options.magneticGroup !== false;
  const seedReviewer = Boolean(options.seedReviewer);
  const bridgeEntries = options.bridgeEntries === null ? [] : options.bridgeEntries || auditBridgeEntries();
  const network: M7Network = {
    sessionCreateRequests: [],
    nodeCreateRequests: [],
    goalRejections: [],
    bridgeAuditRequests: [],
    pageErrors: [],
  };

  const mainSession = {
    sessionId: mainSessionId,
    runtime: 'codex',
    role: 'ceo',
    displayName: 'Main Agent',
    roleTitle: 'ceo',
    agentKind: 'main',
    status: 'running',
    attachMode: true,
    wsClientCount: 1,
    workflowMode: 'wf-max',
    cwd: repoRoot,
    graphNodeId: mainAgentNodeId,
    inputOwnerId: 'drawer',
  };
  const sessions: JsonRecord[] = [cloneJson(mainSession)];
  const reviewers: JsonRecord[] = [];
  if (seedReviewer) {
    reviewers.push({
      nodeId: reviewerNodeId,
      sessionId: reviewerSessionId,
      displayName: 'Architecture Reviewer',
      roleTitle: 'reviewer',
      agentKind: 'subagent',
      runtime: 'codex',
      responsibility: 'Review UI work inside the assigned write set and return evidence.',
      position: { x: 860, y: 220 },
    });
    sessions.push(reviewerSessionRecord(reviewers[0]));
  }

  let graphVersion = 1;
  let capsuleDockLinks: JsonRecord[] = magneticGroup ? defaultMagneticDockLinks() : [];

  page.on('pageerror', error => network.pageErrors.push(error.message));

  const currentSnapshot = () => workflowSnapshot({
    magneticGroup,
    sessions,
    reviewers,
    graphVersion,
    capsuleDockLinks,
  });

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, {
    taskId: 'task-agent-team-cooperation-layer',
    phase: 'm7-red',
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
    taskId: 'task-agent-team-cooperation-layer',
    status: 'open',
    phase: 'm7-red',
  }]));
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, currentSnapshot()));
  await page.route('**/api/sessions**', async route => {
    // NOTE: Playwright glob matching includes the query string, so the list
    // fetch `/api/sessions?all=1` and the create POST `/api/sessions` must be
    // served from this single pattern (sibling specs use the same convention).
    if (route.request().method() === 'POST' && route.request().url().endsWith('/api/sessions')) {
      const payload = requestJson(route);
      network.sessionCreateRequests.push(payload);
      const reviewer = {
        nodeId: reviewerNodeId,
        sessionId: reviewerSessionId,
        displayName: String(payload.displayName || ''),
        roleTitle: String(payload.roleTitle || ''),
        agentKind: String(payload.agentKind || 'subagent'),
        runtime: String(payload.runtime || 'codex'),
        responsibility: String(payload.responsibility || ''),
        position: { x: 860, y: 220 },
      };
      reviewers.push(reviewer);
      sessions.push(reviewerSessionRecord(reviewer));
      return jsonResponse(route, reviewerSessionRecord(reviewer), 201);
    }
    return jsonResponse(route, currentSnapshot().sessions);
  });
  await page.route('**/api/a2a/graph-map**', route => {
    if (route.request().method() === 'PUT') {
      const payload = requestJson(route);
      if (payload.positions && typeof payload.positions === 'object') {
        for (const [nodeId, position] of Object.entries(payload.positions)) {
          if (position && typeof position === 'object') {
            const snapshot = currentSnapshot();
            snapshot.graph.positions[nodeId] = position;
          }
        }
      }
      if (Array.isArray(payload.capsuleDockLinks)) capsuleDockLinks = cloneJson(payload.capsuleDockLinks);
      graphVersion = Number(payload.version || graphVersion) + 1;
    }
    const snapshot = currentSnapshot();
    return jsonResponse(route, {
      ok: true,
      revision: graphVersion,
      graph: snapshot.graph,
      sourceOfTruth: 'backend',
    });
  });
  await page.route('**/api/a2a/bridge-messages**', route => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get('fromSessionId') || '';
    const to = url.searchParams.get('toSessionId') || '';
    network.bridgeAuditRequests.push(route.request().url());
    const entries = from === mainSessionId && to === reviewerSessionId ? cloneJson(bridgeEntries) : [];
    return jsonResponse(route, { entries });
  });
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, {
    entries: [{ seq: 1, stream: 'stdout', data: '\r\nM7 terminal fixture ready\r\n' }],
  }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/stop', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/workspace/tree**', route => jsonResponse(route, {
    root: repoRoot,
    path: '',
    entries: [],
  }));
  await page.route('**/api/user-files', route => jsonResponse(route, { ok: true, files: [] }));
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, route => {
    if (route.request().method() === 'GET') {
      return jsonResponse(route, {
        ok: true,
        nodes: magneticGroup
          ? [timerRuntimeNode({ x: 420, y: 570 }), goalRuntimeNode({ x: 420, y: -170 })]
          : [],
      });
    }
    const payload = requestJson(route);
    network.nodeCreateRequests.push(payload);
    if (payload.type === 'goal') {
      // AC-015/T12 backend rejection shape (agent-team-cooperation-spec §6.2).
      const body = {
        ok: false,
        error: 'goal_already_bound',
        message: `This group already has a Goal (${goalNodeId}) bound to its Timer (${timerNodeId}).`,
        existingGoalNodeId: goalNodeId,
        timerNodeId,
      };
      network.goalRejections.push({ payload, body });
      return jsonResponse(route, body, 409);
    }
    return jsonResponse(route, {
      ok: true,
      node: { nodeId: `m7-created-${network.nodeCreateRequests.length}`, kind: String(payload.type || 'file'), version: 1 },
      state: {},
      revision: 1,
    }, 201);
  });
  await page.route(/\/api\/workflow\/nodes\/.+/, route => {
    if (route.request().method() === 'POST' && route.request().url().includes('/actions/')) {
      return jsonResponse(route, { ok: true, action: 'node.action', result: {} });
    }
    return jsonResponse(route, {
      ok: true,
      node: { nodeId: 'm7-node', kind: 'markdown', version: 1 },
      state: {},
      revision: 1,
    });
  });
  await page.route(/\/api\/workflow\/edges(?:\?.*)?$/, route => {
    const payload = requestJson(route);
    return jsonResponse(route, {
      ok: true,
      edge: {
        id: `${payload.from || payload.source}->${payload.to || payload.target}`,
        from: payload.from || payload.source,
        to: payload.to || payload.target,
        source: payload.from || payload.source,
        target: payload.to || payload.target,
        relation: payload.relation || 'wf-bridge',
        direction: payload.direction || 'bidirectional',
      },
    }, 201);
  });

  return network;
}

async function openWorkflow(page: Page) {
  await page.goto('/workflow');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-node').first()).toBeVisible();
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-wf-browser-ready', 'true');
}

test.describe('WF UI M7 Agent Team Cooperation acceptance', () => {
  test('AC-003/T5 create-agent form produces a card showing displayName and roleTitle chip', async ({ page }) => {
    test.setTimeout(60_000);
    const network = await installWorkflowFixture(page, { seedReviewer: false });
    await openWorkflow(page);

    await page.getByTestId('workflow-create-node').click();
    const picker = page.getByTestId('workflow-create-node-panel');
    await expect(picker).toBeVisible();
    const agentOption = picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="agent"]');
    await expect(agentOption).toBeEnabled();
    await agentOption.click();

    await expect(picker.getByTestId('workflow-create-agent-display-name')).toBeVisible();
    await picker.getByTestId('workflow-agent-kind').selectOption('subagent');
    await picker.getByTestId('workflow-create-agent-display-name').fill('Architecture Reviewer');
    await picker.getByTestId('workflow-create-agent-role-title').selectOption('reviewer');
    await picker.getByTestId('workflow-create-agent-responsibility').fill('Review UI work inside the assigned write set and return evidence.');
    await picker.getByTestId('workflow-create-agent-capabilities').fill('typescript, review');

    const submit = picker.getByTestId('workflow-create-agent-submit');
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect.poll(() => network.sessionCreateRequests.length).toBe(1);
    expect(network.sessionCreateRequests[0]).toEqual(expect.objectContaining({
      agentKind: 'subagent',
      displayName: 'Architecture Reviewer',
      roleTitle: 'reviewer',
      responsibility: 'Review UI work inside the assigned write set and return evidence.',
      capabilities: ['typescript', 'review'],
    }));

    const card = page.locator(`[data-testid="workflow-node"][data-node-id="${reviewerNodeId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText('Architecture Reviewer');
    await expect(card).toContainText('REVIEWER');
    await expect(card).not.toContainText('SUBAGENT');
    expect(network.pageErrors, 'page errors').toEqual([]);
  });

  test('AC-015/T12 second Goal in a magnetic group shows the goal_already_bound rejection toast and keeps one Goal node', async ({ page }) => {
    test.setTimeout(60_000);
    const network = await installWorkflowFixture(page, { magneticGroup: true });
    await openWorkflow(page);

    // The magnetic group (agent + timer + goal) is seeded via capsuleDockLinks:
    // the agent card carries linked timer and goal pills.
    const agentCard = page.locator(`[data-testid="workflow-node"][data-node-id="${mainAgentNodeId}"]`);
    await expect(agentCard.locator('.workflow-capsule-pill[data-role="timer"]')).toHaveAttribute('data-state', 'linked');
    await expect(agentCard.locator('.workflow-capsule-pill[data-role="goal"]')).toHaveAttribute('data-state', 'linked');
    await expect(page.locator(`[data-testid="workflow-goal-node"][data-node-id="${goalNodeId}"]`)).toBeVisible();
    await expect(page.getByTestId('workflow-goal-node')).toHaveCount(1);

    await page.getByTestId('workflow-create-node').click();
    const picker = page.getByTestId('workflow-create-node-panel');
    await expect(picker).toBeVisible();
    await picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="goal"]').click();

    await expect.poll(() => network.goalRejections.length).toBe(1);
    expect(network.goalRejections[0].payload).toEqual(expect.objectContaining({ type: 'goal' }));
    expect(network.goalRejections[0].body).toEqual(expect.objectContaining({
      error: 'goal_already_bound',
      existingGoalNodeId: goalNodeId,
      timerNodeId,
      message: expect.stringContaining('already has a Goal'),
    }));

    const toast = page.getByTestId('workflow-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('data-kind', 'error');
    await expect(toast).toContainText('already has a Goal');
    await expect(toast).toContainText(goalNodeId);

    await expect(page.getByTestId('workflow-goal-node')).toHaveCount(1);
    await expect(page.locator(`[data-testid="workflow-goal-node"][data-node-id="${goalNodeId}"]`)).toBeVisible();
    expect(network.pageErrors, 'page errors').toEqual([]);
  });

  test('AC-025/UX-4 Cooperation audit panel shows agent identity rows and requestId-grouped asked/replied + wakeup entries', async ({ page }) => {
    test.setTimeout(60_000);
    const network = await installWorkflowFixture(page, { magneticGroup: true, seedReviewer: true });
    await openWorkflow(page);

    const mainCard = page.locator(`[data-testid="workflow-node"][data-node-id="${mainAgentNodeId}"]`);
    await expect(mainCard).toBeVisible();
    await mainCard.dblclick();

    const drawer = page.getByTestId('terminal-window');
    await expect(drawer).toBeVisible();
    await drawer.getByTestId('terminal-audit-toggle').click();

    const panel = drawer.getByTestId('terminal-audit-panel');
    await expect(panel).toBeVisible();

    const sessionsSection = panel.getByTestId('audit-sessions');
    await expect(sessionsSection).toBeVisible();
    const reviewerRow = sessionsSection.getByTestId('audit-session-identity').filter({ hasText: 'Architecture Reviewer' });
    await expect(reviewerRow).toBeVisible();
    await expect(reviewerRow).toContainText('reviewer');
    const mainRow = sessionsSection.getByTestId('audit-session-identity').filter({ hasText: 'Main Agent' });
    await expect(mainRow).toBeVisible();
    await expect(mainRow).toContainText('ceo');

    const requestSection = panel.locator(`[data-testid="audit-request"][data-request-id="${requestId}"]`);
    await expect(requestSection).toBeVisible();
    const askEntry = requestSection.locator('[data-testid="audit-request-entry"][data-kind="ask"]');
    await expect(askEntry).toBeVisible();
    await expect(askEntry).toContainText('asked');
    await expect(askEntry).toContainText('Architecture Reviewer');
    const replyEntry = requestSection.locator('[data-testid="audit-request-entry"][data-kind="reply"]');
    await expect(replyEntry).toBeVisible();
    await expect(replyEntry).toContainText('replied');

    const wakeupsSection = panel.getByTestId('audit-wakeups');
    await expect(wakeupsSection).toBeVisible();
    await expect(wakeupsSection.getByTestId('audit-wakeup-entry').filter({ hasText: 'wakeup dispatched' })).toBeVisible();

    expect(network.bridgeAuditRequests.length, 'audit should fetch bridge messages for the peer session').toBeGreaterThan(0);
    expect(network.pageErrors, 'page errors').toEqual([]);
  });
});
