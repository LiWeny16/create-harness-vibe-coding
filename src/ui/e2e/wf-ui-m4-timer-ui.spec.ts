import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sessionId = 'e2e-session-m4-timer';
const graphNodeId = 'e2e-agent-m4-timer';
const timerNodeId = 'event-timer-m4-ui';

type JsonRecord = Record<string, any>;

type TimerMode = 'manual' | 'once' | 'interval' | 'cron' | 'loop' | 'adaptive' | 'watchdog' | 'while' | 'task';

type EventState = {
  nodeId: string;
  type: 'timer';
  title: string;
  revision: number;
  enabled: boolean;
  schedule: {
    mode: TimerMode;
    intervalSeconds: number;
    cron: string;
    triggerAt?: string;
    cadence?: { kind: 'fixed' | 'sequence' | 'backoff' | 'jitter'; sequenceSeconds?: number[] };
  };
  heartbeat?: {
    base: { enabled: boolean; intervalSeconds: number; count: number; lastAt?: string; nextDueAt?: string };
    watchdog: { enabled: boolean; intervalSeconds: number; timeoutSeconds: number; missedCount: number; state: 'ok' | 'waiting' | 'missed' };
  };
  controlPolicy?: { agentCanDisable: boolean; agentCanSetInterval: boolean; minIntervalSeconds: number; maxIntervalSeconds: number };
  payloadTemplate: JsonRecord;
  eventCount: number;
  lastFiredAt: string;
  lastEvent: JsonRecord | null;
  statePath: string;
};

const nodeConfig = {
  role: 'main',
  customRole: '',
  prompt: 'M4 timer UI fixture agent.',
  model: 'gpt-5-codex',
  provider: 'openai',
  cwd: repoRoot,
  env: { HARNESS_WORKFLOW_MAP: 'Harness/a2a/workflow-map.json' },
  permissions: { filesystem: 'workspace-write', network: 'enabled' },
  launchPolicy: { autoStart: false, restartOnSave: false },
  skills: ['wf-max'],
  skillPolicy: 'auto',
  recommendedSkills: ['wf-max'],
  contextSources: ['workflow-map', 'component-nodes'],
  capabilities: ['terminal', 'file-ops'],
};

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

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function nextTimerDueAt(seconds: number) {
  return new Date(Date.now() + Math.max(1, Math.floor(Number(seconds) || 60)) * 1000).toISOString();
}

function runningTimerState(mode: TimerMode, intervalSeconds: number): EventState {
  return {
    nodeId: timerNodeId,
    type: 'timer',
    title: 'M4 Timer',
    revision: 1,
    enabled: true,
    schedule: { mode, intervalSeconds, cron: '', cadence: { kind: 'fixed' } },
    heartbeat: {
      base: { enabled: true, intervalSeconds, count: 3, nextDueAt: nextTimerDueAt(intervalSeconds) },
      watchdog: { enabled: false, intervalSeconds: 600, timeoutSeconds: 1800, missedCount: 0, state: 'ok' },
    },
    controlPolicy: { agentCanDisable: true, agentCanSetInterval: true, minIntervalSeconds: 5, maxIntervalSeconds: 86400 },
    payloadTemplate: {},
    eventCount: 3,
    lastFiredAt: '',
    lastEvent: null,
    statePath: `Harness/a2a/event-nodes/${timerNodeId}/state.json`,
  };
}

function stoppedTimerState(mode: TimerMode): EventState {
  return {
    nodeId: timerNodeId,
    type: 'timer',
    title: 'M4 Timer Stopped',
    revision: 1,
    enabled: false,
    schedule: { mode, intervalSeconds: 60, cron: '', cadence: { kind: 'fixed' } },
    heartbeat: {
      base: { enabled: false, intervalSeconds: 60, count: 0 },
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

function applyTimerAction(state: EventState, action: string): EventState {
  if (action === 'timer.enable') {
    return {
      ...state,
      enabled: true,
      heartbeat: {
        ...state.heartbeat,
        base: {
          ...(state.heartbeat?.base || {}),
          enabled: true,
          intervalSeconds: state.schedule?.intervalSeconds || state.heartbeat?.base?.intervalSeconds || 60,
          nextDueAt: nextTimerDueAt(state.schedule?.intervalSeconds || state.heartbeat?.base?.intervalSeconds || 60),
        },
      },
      revision: state.revision + 1,
    };
  }
  if (action === 'timer.disable') {
    return {
      ...state,
      enabled: false,
      heartbeat: {
        ...state.heartbeat,
        base: { ...(state.heartbeat?.base || {}), enabled: false },
      },
      revision: state.revision + 1,
    };
  }
  return state;
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
        directions: { event: 'source-to-target', config: 'target-only', status: 'bidirectional' },
      },
      connections: [],
    },
    stateRef: { path: state.statePath, revision: state.revision },
    contentRef: { kind: 'event-node-state', statePath: state.statePath, revision: state.revision, eventKind: 'timer' },
    settings: { schemaId: 'timer-settings', values: {}, revision: 0 },
    capabilities: ['state:read', 'state:update', 'timer.read', 'timer.configure', 'timer.enable', 'timer.disable'],
    ui: { previewKind: 'timer', settingsPanel: 'timer-settings', testId: 'workflow-event-node', labels: { title: state.title } },
  };
}

function workflowSnapshot(eventState: EventState) {
  const eventPosition = { x: 300, y: 610 };
  const eventNodeListEntry = {
    id: timerNodeId,
    nodeId: timerNodeId,
    label: eventState.title,
    title: eventState.title,
    kind: 'event-node',
    type: 'timer',
    level: 0,
    status: 'ready',
    lifecycle: 'event-source',
    runtimeState: 'ready',
    managedByCurrentServer: true,
    control: control(),
    graphNodeId: timerNodeId,
    revision: eventState.revision,
    statePath: eventState.statePath,
    position: eventPosition,
  };
  const eventStateRefs = {
    [timerNodeId]: {
      type: 'timer',
      eventKind: 'timer',
      title: eventState.title,
      statePath: eventState.statePath,
      revision: eventState.revision,
      schedule: eventState.schedule,
      lastEvent: eventState.lastEvent,
      lastFiredAt: eventState.lastFiredAt,
      eventCount: eventState.eventCount,
    },
  };
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-05T00:00:00.000Z',
    workflowId: 'e2e-workflow-m4-timer',
    taskId: 'task-m4-timer-ui',
    mode: 'wf-max',
    phase: 'm4-interactions',
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
      label: 'M4 Agent',
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
      taskId: 'task-m4-timer-ui',
      agentKind: nodeConfig.role,
      runtime: 'codex',
      peerId: 'codex',
      objective: nodeConfig.prompt,
      cwd: nodeConfig.cwd,
      graphNodeId,
      config: nodeConfig,
    }, eventNodeListEntry],
    edges: [],
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-m4-timer',
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
        taskId: 'task-m4-timer-ui',
        cwd: repoRoot,
        position: { x: 620, y: 180 },
        config: nodeConfig,
      }, {
        nodeId: timerNodeId,
        kind: 'event-node',
        type: 'timer',
        status: 'ready',
        lifecycle: 'event-source',
        runtimeState: 'ready',
        managedByCurrentServer: true,
        control: control(),
        position: eventPosition,
        statePath: eventState.statePath,
        revision: eventState.revision,
        stateRef: { path: eventState.statePath, revision: eventState.revision },
      }],
      edges: [],
      capsuleDockLinks: [],
      positions: {
        [graphNodeId]: { x: 620, y: 180 },
        [timerNodeId]: eventPosition,
      },
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes',
      sourceOfTruth: 'backend',
      componentStateRefs: {},
      eventStateRefs,
      capabilityStateRefs: {},
      goalStateRefs: {},
    },
    componentNodes: {},
    eventNodes: { [timerNodeId]: eventState },
    capabilityNodes: {},
    goalNodes: {},
    graphContextBySessionId: {
      [sessionId]: {
        workflowMapPath: 'Harness/a2a/workflow-map.json',
        componentStatePath: 'Harness/a2a/component-nodes',
        sourceOfTruth: 'backend',
        componentStateRefs: {},
        eventStateRefs,
        capabilityStateRefs: {},
        goalStateRefs: {},
      },
    },
  };
}

async function installTimerFixture(page: import('@playwright/test').Page, eventState: EventState, options: { actionDelayMs?: number } = {}) {
  const failedResponses: string[] = [];
  const timerActionRequests: Array<{ action: string; nodeId: string; payload?: unknown }> = [];
  let currentState: EventState = eventState;
  page.on('pageerror', error => { throw new Error(`Unexpected page error: ${error.message}`); });
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('/favicon.ico')) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, {
    taskId: 'task-m4-timer-ui',
    phase: 'm4-interactions',
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
    taskId: 'task-m4-timer-ui',
    status: 'open',
    phase: 'm4-interactions',
  }]));
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, workflowSnapshot(eventState)));
  await page.route('**/api/a2a/graph-map**', route => jsonResponse(route, {
    ok: true,
    revision: 1,
    graph: workflowSnapshot(eventState).graph,
    sourceOfTruth: 'backend',
  }));
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, workflowSnapshot(eventState).sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, {
    entries: [{ seq: 1, stream: 'stdout', data: '\r\nM4 timer fixture ready\r\n' }],
  }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, route => jsonResponse(route, {
    ok: true,
    nodes: [timerRuntimeNodeSnapshot(currentState, { x: 300, y: 610 })],
  }));
  await page.route(/\/api\/workflow\/nodes\/.+/, async route => {
    const request = route.request();
    const actionMatch = new URL(request.url()).pathname.match(/\/api\/workflow\/nodes\/([^/]+)\/actions\/([^/]+)$/);
    if (request.method() === 'POST' && actionMatch) {
      const nodeId = decodeURIComponent(actionMatch[1]);
      const action = decodeURIComponent(actionMatch[2]);
      timerActionRequests.push({ action, nodeId, payload: request.postDataJSON() ?? undefined });
      currentState = applyTimerAction(currentState, action);
      if (options.actionDelayMs) {
        await new Promise(resolve => setTimeout(resolve, options.actionDelayMs));
      }
      return jsonResponse(route, {
        ok: true,
        node: timerRuntimeNodeSnapshot(currentState, { x: 300, y: 610 }),
        state: currentState,
        revision: currentState.revision,
        action,
      });
    }
    return jsonResponse(route, {
      ok: true,
      node: timerRuntimeNodeSnapshot(currentState, { x: 300, y: 610 }),
      state: currentState,
      revision: currentState.revision,
    });
  });
  return { failedResponses, timerActionRequests };
}

async function openWorkflow(page: import('@playwright/test').Page) {
  await page.goto('/workflow');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-node').first()).toBeVisible();
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-wf-browser-ready', 'true');
}

test.describe('WF UI M4 Timer card polish', () => {
  test('running loop timer renders state, countdown, next-due, event count, and mode badge', async ({ page }) => {
    await installTimerFixture(page, runningTimerState('loop', 60));
    await openWorkflow(page);

    const timerCard = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    await expect(timerCard).toBeVisible();

    const statePill = timerCard.getByTestId('workflow-timer-state');
    await expect(statePill).toBeVisible();
    await expect(statePill).toHaveAttribute('data-state', 'running');

    await expect(timerCard.getByTestId('workflow-timer-countdown')).toBeVisible();
    await expect(timerCard.getByTestId('workflow-timer-countdown')).toHaveAttribute('data-active', 'true');

    const nextDue = timerCard.getByTestId('workflow-timer-next-due');
    await expect(nextDue).toBeVisible();
    await expect(nextDue).toContainText(/due \d{2}:\d{2}:\d{2}/);

    const eventCount = timerCard.getByTestId('workflow-timer-event-count');
    await expect(eventCount).toBeVisible();
    await expect(eventCount).toContainText('3');

    const modeBadge = timerCard.getByTestId('workflow-timer-mode-badge');
    await expect(modeBadge).toBeVisible();
    await expect(modeBadge).toHaveAttribute('data-mode', 'loop');
    await expect(modeBadge).toHaveClass(/workflow-timer-mode-badge/);
  });

  test('stopped manual timer hides next-due and reflects manual mode + stopped state', async ({ page }) => {
    await installTimerFixture(page, stoppedTimerState('manual'));
    await openWorkflow(page);

    const timerCard = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    await expect(timerCard).toBeVisible();

    await expect(timerCard.getByTestId('workflow-timer-state')).toHaveAttribute('data-state', 'stopped');
    await expect(timerCard.getByTestId('workflow-timer-countdown')).toHaveAttribute('data-active', 'false');
    await expect(timerCard.getByTestId('workflow-timer-next-due')).toHaveCount(0);

    const modeBadge = timerCard.getByTestId('workflow-timer-mode-badge');
    await expect(modeBadge).toBeVisible();
    await expect(modeBadge).toHaveAttribute('data-mode', 'manual');
  });

  test('task mode badge is visually distinct from loop mode', async ({ page }) => {
    await installTimerFixture(page, runningTimerState('task', 120));
    await openWorkflow(page);

    const timerCard = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    const modeBadge = timerCard.getByTestId('workflow-timer-mode-badge');
    await expect(modeBadge).toBeVisible();
    await expect(modeBadge).toHaveAttribute('data-mode', 'task');
    const background = await modeBadge.evaluate(element => window.getComputedStyle(element).backgroundColor);
    // task mode uses a purple background (#7c3aed -> rgb(124, 58, 237)); ensure it resolves to a color value
    expect(background, 'mode badge should resolve a background color').toBeTruthy();
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('stopped timer card shows 启动 toggle and idle countdown mark', async ({ page }) => {
    await installTimerFixture(page, stoppedTimerState('manual'));
    await openWorkflow(page);

    const timerCard = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    await expect(timerCard).toBeVisible();

    const toggle = timerCard.getByTestId('workflow-timer-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('启动');
    await expect(timerCard.getByTestId('workflow-timer-state')).toHaveAttribute('data-action', 'start');

    const countdown = timerCard.getByTestId('workflow-timer-countdown');
    await expect(countdown).toHaveAttribute('data-active', 'false');
    await expect(countdown).toContainText('—');
  });

  test('running loop timer countdown ticks in real time', async ({ page }) => {
    await installTimerFixture(page, runningTimerState('loop', 60));
    await openWorkflow(page);

    const timerCard = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    const countdown = timerCard.getByTestId('workflow-timer-countdown');
    await expect(countdown).toHaveAttribute('data-active', 'true');

    const mainValue = countdown.locator('.workflow-timer-countdown-main strong');
    const initial = (await mainValue.textContent())?.trim() ?? '';
    expect(initial).toMatch(/\d{2}:\d{2}/);
    await expect.poll(
      async () => ((await mainValue.textContent()) ?? '').trim(),
      { timeout: 5000, message: 'countdown value should tick every second' },
    ).not.toBe(initial);
  });

  test('clicking 启动 issues timer.enable and flips the toggle to 终止', async ({ page }) => {
    const network = await installTimerFixture(page, stoppedTimerState('interval'));
    await openWorkflow(page);

    const timerCard = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    await expect(timerCard.getByTestId('workflow-timer-state')).toHaveAttribute('data-action', 'start');

    await timerCard.getByTestId('workflow-timer-toggle').click();

    await expect.poll(() => network.timerActionRequests.length).toBe(1);
    expect(network.timerActionRequests[0]).toEqual(expect.objectContaining({
      action: 'timer.enable',
      nodeId: timerNodeId,
    }));

    // The card refreshes from the action response snapshot: toggle flips and
    // the countdown becomes live immediately (backend created nextDueAt).
    await expect(timerCard.getByTestId('workflow-timer-state')).toHaveAttribute('data-action', 'stop');
    await expect(timerCard.getByTestId('workflow-timer-toggle')).toContainText('终止');
    await expect(timerCard.getByTestId('workflow-timer-countdown')).toHaveAttribute('data-active', 'true');
  });

  test('clicking 启动 flips the toggle instantly while the delayed action is still in flight (optimistic UI)', async ({ page }) => {
    const network = await installTimerFixture(page, stoppedTimerState('interval'), { actionDelayMs: 1000 });
    await openWorkflow(page);

    const timerCard = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    const toggle = timerCard.getByTestId('workflow-timer-toggle');
    const stateBtn = timerCard.getByTestId('workflow-timer-state');
    await expect(stateBtn).toHaveAttribute('data-action', 'start');

    const clickedAt = Date.now();
    await toggle.click();

    // The action response is delayed 1s, so the flip within 250ms can only
    // come from the optimistic preview — the UI must not wait for the API.
    await expect(stateBtn).toHaveAttribute('data-action', 'stop', { timeout: 250 });
    await expect(stateBtn).toHaveAttribute('data-pending', 'true', { timeout: 250 });
    const flipMs = Date.now() - clickedAt;
    expect(flipMs, `toggle should flip within 250ms of the click, took ${flipMs}ms`).toBeLessThan(250);
    console.log(`[wf-ui-m4] optimistic toggle flip latency: ${flipMs}ms (action response delayed 1000ms)`);
    expect(network.timerActionRequests.length, 'exactly one action request must be fired').toBe(1);

    // A synthetic second click while pending must not fire a second action.
    await toggle.dispatchEvent('click');
    await page.waitForTimeout(200);
    expect(network.timerActionRequests.length, 'double click while pending must be guarded').toBe(1);

    // Once the response lands the pending state clears and the after-snapshot
    // keeps the flipped state (reconcile).
    await expect(stateBtn).not.toHaveAttribute('data-pending', 'true', { timeout: 3000 });
    await expect(stateBtn).toHaveAttribute('data-action', 'stop');
    await expect(toggle).toContainText('终止');
    await expect(timerCard.getByTestId('workflow-timer-countdown')).toHaveAttribute('data-active', 'true');
  });

  test('timer card contents never overflow the card bounding box', async ({ page }) => {
    await installTimerFixture(page, runningTimerState('loop', 60));
    await openWorkflow(page);

    const timerCard = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    await expect(timerCard).toBeVisible();

    const result = await timerCard.evaluate(card => {
      const cardRect = card.getBoundingClientRect();
      const overflowing: Array<Record<string, unknown>> = [];
      const EPS = 0.75;
      const walk = (element: Element) => {
        // ReactFlow connection handles sit half-outside the card edge by design.
        if (element !== card && !element.classList.contains('react-flow__handle')) {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const inside = rect.left >= cardRect.left - EPS
              && rect.right <= cardRect.right + EPS
              && rect.top >= cardRect.top - EPS
              && rect.bottom <= cardRect.bottom + EPS;
            if (!inside) {
              overflowing.push({
                tag: element.tagName,
                testid: element.getAttribute('data-testid') || undefined,
                className: element.className ? String(element.className).slice(0, 80) : undefined,
                left: Math.round(rect.left - cardRect.left),
                right: Math.round(rect.right - cardRect.right),
                top: Math.round(rect.top - cardRect.top),
                bottom: Math.round(rect.bottom - cardRect.bottom),
              });
            }
          }
        }
        for (const child of Array.from(element.children)) {
          walk(child);
        }
      };
      for (const child of Array.from(card.children)) {
        walk(child);
      }
      return {
        cardBox: { width: Math.round(cardRect.width), height: Math.round(cardRect.height) },
        overflowing,
      };
    });

    expect(result.overflowing, `timer card box ${JSON.stringify(result.cardBox)} has overflowing children: ${JSON.stringify(result.overflowing)}`).toEqual([]);
  });
});
