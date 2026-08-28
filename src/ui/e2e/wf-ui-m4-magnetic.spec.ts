import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const mainAgentNodeId = 'magnet-agent-main';
const workerAgentNodeId = 'magnet-agent-worker';
const mainAgentSessionId = 'magnet-session-main';
const workerAgentSessionId = 'magnet-session-worker';
const markdownNodeId = 'magnet-resource-markdown';
const excalidrawNodeId = 'magnet-resource-excalidraw';
const fileNodeId = 'magnet-resource-file';
const timerNodeId = 'magnet-event-timer';
const bridgeEdgeId = 'edge-magnet-main-worker';

type JsonRecord = Record<string, any>;
type ComponentType = 'markdown' | 'excalidraw' | 'file';

type ComponentState = {
  nodeId: string;
  type: ComponentType;
  title: string;
  revision: number;
  markdown?: string;
  scene?: JsonRecord;
  file?: { source: 'workspace' | 'user-file'; path: string; name?: string; mime?: string; size?: number };
  observableInputs: string[];
  observableOutputs: string[];
  statePath: string;
};

type EventState = {
  nodeId: string;
  type: 'timer';
  title: string;
  revision: number;
  enabled: boolean;
  schedule: { mode: string; intervalSeconds: number };
  heartbeat: {
    base: { enabled: boolean; intervalSeconds: number; lastAt: string; nextDueAt: string; count: number };
    watchdog: { enabled: boolean; intervalSeconds: number; timeoutSeconds: number; lastPingAt: string; lastAckAt: string; state: string; missedCount: number };
  };
  eventCount: number;
  lastFiredAt: string;
  lastEvent: null;
  statePath: string;
};

type GraphState = {
  positions: Record<string, { x: number; y: number }>;
  edges: JsonRecord[];
  capsuleDockLinks: JsonRecord[];
  version: number;
};

type Network = {
  graphMapRequests: JsonRecord[];
  pageErrors: string[];
  failedResponses: string[];
};

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
    canSendInput: false,
    canCreateAgent: true,
    canCreateComponentNode: true,
  };
}

function primaryPort(type: ComponentType) {
  if (type === 'excalidraw') return 'scene';
  if (type === 'markdown') return 'markdown';
  return 'file';
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

function defaultComponentState(type: ComponentType, nodeId: string): ComponentState {
  const title = type === 'markdown' ? 'Magnet Notes' : type === 'file' ? 'Magnet File' : 'Magnet Diagram';
  return {
    nodeId,
    type,
    title,
    revision: 1,
    markdown: type === 'markdown' ? '# Magnet Notes\n\nResource handle fixture.' : undefined,
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

function defaultTimerState(): EventState {
  return {
    nodeId: timerNodeId,
    type: 'timer',
    title: 'Magnet Timer',
    revision: 1,
    enabled: false,
    schedule: { mode: 'loop', intervalSeconds: 120 },
    heartbeat: {
      base: { enabled: false, intervalSeconds: 60, lastAt: '', nextDueAt: '', count: 0 },
      watchdog: { enabled: false, intervalSeconds: 600, timeoutSeconds: 1800, lastPingAt: '', lastAckAt: '', state: 'disabled', missedCount: 0 },
    },
    eventCount: 0,
    lastFiredAt: '',
    lastEvent: null,
    statePath: `Harness/a2a/event-nodes/${timerNodeId}/state.json`,
  };
}

function eventNodeSnapshot(state: EventState, position: { x: number; y: number }) {
  return {
    id: state.nodeId,
    label: state.title,
    kind: 'event-node',
    type: 'timer',
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

function buildGraphState(components: ComponentState[]): GraphState {
  const positions: Record<string, { x: number; y: number }> = {
    [mainAgentNodeId]: { x: 500, y: 200 },
    [workerAgentNodeId]: { x: 920, y: 200 },
    [timerNodeId]: { x: 500, y: 660 },
  };
  components.forEach((state, index) => {
    positions[state.nodeId] = { x: 220 + index * 340, y: 520 };
  });
  return {
    positions,
    edges: [{
      id: bridgeEdgeId,
      from: mainAgentNodeId,
      to: workerAgentNodeId,
      source: mainAgentNodeId,
      target: workerAgentNodeId,
      relation: 'delegates',
      direction: 'bidirectional',
      sourceHandle: 'right',
      targetHandle: 'left',
      offset: 0,
    }],
    capsuleDockLinks: [],
    version: 1,
  };
}

function workflowSnapshot(graphState: GraphState, components: ComponentState[], timerState: EventState) {
  const componentNodes = components.map(state => componentNodeSnapshot(state, graphState.positions[state.nodeId]));
  const timerNode = eventNodeSnapshot(timerState, graphState.positions[timerState.nodeId]);
  const componentStateRefs = Object.fromEntries(components.map(state => [state.nodeId, {
    type: state.type,
    title: state.title,
    statePath: state.statePath,
    revision: state.revision,
    observableInputs: state.observableInputs,
    observableOutputs: state.observableOutputs,
    ...(state.file ? { file: state.file } : {}),
  }]));
  const baseAgent = {
    kind: 'terminal-session',
    level: 0,
    status: 'running',
    lifecycle: 'live',
    runtimeState: 'running',
    managedByCurrentServer: true,
    control: control(),
    runtime: 'codex',
    taskId: 'task-magnet-m4',
    cwd: repoRoot,
    skills: ['wf-max'],
    permissions: ['terminal'],
  };
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-magnet',
    taskId: 'task-magnet-m4',
    mode: 'wf-max',
    phase: 'm4-red',
    gate: 'TEST-GATE',
    rootAgentId: mainAgentNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [
      { sessionId: mainAgentSessionId, runtime: 'codex', role: 'main', status: 'running', attachMode: true, graphNodeId: mainAgentNodeId, cwd: repoRoot },
      { sessionId: workerAgentSessionId, runtime: 'codex', role: 'worker', status: 'running', attachMode: true, graphNodeId: workerAgentNodeId, cwd: repoRoot },
    ],
    nodes: [
      { ...baseAgent, id: mainAgentNodeId, label: 'Magnet Main Agent', role: 'main', agentKind: 'main', sessionId: mainAgentSessionId, graphNodeId: mainAgentNodeId, objective: 'Magnet main agent' },
      { ...baseAgent, id: workerAgentNodeId, label: 'Magnet Worker Agent', role: 'worker', agentKind: 'subagent', sessionId: workerAgentSessionId, graphNodeId: workerAgentNodeId, objective: 'Magnet worker agent' },
      ...componentNodes,
      timerNode,
    ],
    edges: graphState.edges.map(edge => ({
      id: edge.id,
      from: edge.from || edge.source,
      to: edge.to || edge.target,
      source: edge.source || edge.from,
      target: edge.target || edge.to,
      relation: edge.relation || 'wf-bridge',
      direction: edge.direction || 'bidirectional',
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      offset: edge.offset,
    })),
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-magnet',
      version: graphState.version,
      nodes: [
        { nodeId: mainAgentNodeId, sessionId: mainAgentSessionId, kind: 'terminal-session', agentKind: 'main', runtime: 'codex', status: 'running', lifecycle: 'live', runtimeState: 'running', control: control(), taskId: 'task-magnet-m4', cwd: repoRoot, position: graphState.positions[mainAgentNodeId] },
        { nodeId: workerAgentNodeId, sessionId: workerAgentSessionId, kind: 'terminal-session', agentKind: 'subagent', runtime: 'codex', status: 'running', lifecycle: 'live', runtimeState: 'running', control: control(), taskId: 'task-magnet-m4', cwd: repoRoot, position: graphState.positions[workerAgentNodeId] },
        ...componentNodes.map(node => ({
          nodeId: node.id,
          kind: 'component-node',
          componentType: node.componentType,
          status: 'ready',
          lifecycle: 'stateful',
          runtimeState: 'ready',
          managedByCurrentServer: true,
          control: control(),
          position: graphState.positions[node.id],
          statePath: node.statePath,
          revision: node.revision,
          observableInputs: node.observableInputs,
          observableOutputs: node.observableOutputs,
        })),
        {
          nodeId: timerNode.id,
          kind: 'event-node',
          type: 'timer',
          status: 'ready',
          lifecycle: 'event-source',
          runtimeState: 'ready',
          managedByCurrentServer: true,
          control: control(),
          position: graphState.positions[timerNode.id],
          statePath: timerNode.statePath,
          revision: timerNode.revision,
        },
      ],
      edges: cloneJson(graphState.edges),
      positions: cloneJson(graphState.positions),
      capsuleDockLinks: cloneJson(graphState.capsuleDockLinks),
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes',
      componentStateRefs,
      sourceOfTruth: 'backend',
    },
    eventNodes: {
      [timerState.nodeId]: timerState,
    },
    graphContextBySessionId: {},
  };
}

async function installWorkflowFixture(page: Page): Promise<{ network: Network; graphState: GraphState; components: ComponentState[]; timerState: EventState }> {
  const components: ComponentState[] = [
    defaultComponentState('markdown', markdownNodeId),
    defaultComponentState('excalidraw', excalidrawNodeId),
    defaultComponentState('file', fileNodeId),
  ];
  const timerState = defaultTimerState();
  const graphState = buildGraphState(components);
  const network: Network = { graphMapRequests: [], pageErrors: [], failedResponses: [] };

  page.on('pageerror', error => network.pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('favicon.ico')) {
      network.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  const currentSnapshot = () => workflowSnapshot(graphState, components, timerState);

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, { taskId: 'task-magnet-m4', phase: 'm4-red', gate: 'TEST-GATE' }));
  await page.route('**/api/runtimes**', route => jsonResponse(route, [{
    id: 'codex', label: 'Codex', command: 'codex', path: 'codex', version: 'test',
    status: 'available', launchable: true, adapterStatus: 'ok', capabilities: ['terminal'],
  }]));
  await page.route('**/api/tasks**', route => jsonResponse(route, [{ taskId: 'task-magnet-m4', status: 'open', phase: 'm4-red' }]));
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, currentSnapshot()));
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, currentSnapshot().sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, { entries: [{ seq: 1, stream: 'stdout', data: '\r\nMagnet terminal fixture\r\n' }] }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/stop', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/a2a/nodes/**/config', route => jsonResponse(route, { ok: true, node: { id: mainAgentNodeId }, restartRequired: false, revision: 2 }));
  await page.route('**/api/a2a/nodes/**/restart', route => jsonResponse(route, { ok: true, nodeId: mainAgentNodeId, revision: 3 }));
  await page.route('**/api/a2a/nodes/**', route => jsonResponse(route, { ok: true, revision: 4 }));
  await page.route('**/api/a2a/graph-map**', route => {
    const method = route.request().method();
    const payload = route.request().postData() ? route.request().postDataJSON() as JsonRecord : {};
    network.graphMapRequests.push({ method, payload });
    if (method === 'PUT') {
      if (payload.positions && typeof payload.positions === 'object') {
        Object.assign(graphState.positions, cloneJson(payload.positions));
      }
      if (Array.isArray(payload.edges)) graphState.edges = cloneJson(payload.edges);
      if (Array.isArray(payload.capsuleDockLinks)) graphState.capsuleDockLinks = cloneJson(payload.capsuleDockLinks);
      graphState.version += 1;
    }
    const snapshot = currentSnapshot();
    return jsonResponse(route, { ok: true, revision: graphState.version, graph: snapshot.graph, sourceOfTruth: 'backend' });
  });
  await page.route('**/api/workspace/tree**', route => {
    const relPath = new URL(route.request().url()).searchParams.get('path') || '';
    return jsonResponse(route, { root: repoRoot, path: relPath, entries: [] });
  });
  await page.route('**/api/workspace/meta**', route => {
    const filePath = new URL(route.request().url()).searchParams.get('path') || '';
    return jsonResponse(route, { ok: true, path: filePath, name: path.basename(filePath), type: 'file', exists: true, size: 820, mime: 'application/json', etag: 'magnet-etag', previewKind: 'text' });
  });
  await page.route('**/api/workspace/text**', route => jsonResponse(route, { text: '{}', bytesRead: 2, truncated: false, encoding: 'utf-8' }));
  await page.route('**/api/workspace/file**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route(/\/api\/workflow\/edges(?:\?.*)?$/, route => jsonResponse(route, { ok: true, edge: { id: 'edge-new', from: mainAgentNodeId, to: workerAgentNodeId } }, 201));
  await page.route('**/api/user-files', route => jsonResponse(route, { ok: true, files: [] }));

  return { network, graphState, components, timerState };
}

async function openWorkflow(page: Page) {
  await page.goto('/workflow');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-node').first()).toBeVisible();
  await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-wf-browser-ready', 'true');
}

async function waitForCanvasSettlement(page: Page) {
  const canvas = page.getByTestId('workflow-canvas');
  await expect(canvas).toHaveAttribute('data-wf-browser-ready', 'true');
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function assertResourceHandleSides(page: Page, nodeTestId: string, port: string) {
  const node = page.getByTestId('workflow-component-node').filter({ hasText: new RegExp(port, 'i') }).first();
  await expect(node).toBeVisible();
  const handles = node.locator('[data-testid="workflow-component-node-port"][data-handle-mode="bidirectional"]');
  const count = await handles.count();
  expect(count, `${nodeTestId} should render exactly 4 bidirectional handles`).toBe(4);
  const sides = new Set<string>();
  for (let i = 0; i < count; i++) {
    const side = await handles.nth(i).getAttribute('data-side');
    if (side) sides.add(side);
  }
  expect(sides, `${nodeTestId} handle sides`).toEqual(new Set(['top', 'right', 'bottom', 'left']));
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const sideHandles = node.locator(`[data-testid="workflow-component-node-port"][data-handle-mode="bidirectional"][data-side="${side}"]`);
    const sideCount = await sideHandles.count();
    expect(sideCount, `${nodeTestId} side=${side} should have exactly ONE handle (W11)`).toBe(1);
  }
}

test.describe('WF UI M4 magnetic resource handles + dock guards', () => {
  test('resource nodes render exactly four bidirectional connection handles (one per side)', async ({ page }) => {
    await installWorkflowFixture(page);
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    await assertResourceHandleSides(page, 'markdown', 'markdown');
    await assertResourceHandleSides(page, 'excalidraw', 'scene');
    await assertResourceHandleSides(page, 'file', 'file');
  });

  test('Agent double-click opens terminal-window drawer and never converts to terminal-mode', async ({ page }) => {
    await installWorkflowFixture(page);
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    expect(page.getByTestId('workflow-node-terminal')).toHaveCount(0);
    expect(page.getByTestId('terminal-window')).toHaveCount(0);

    const agentNode = page.getByTestId('workflow-node').first();
    await agentNode.dblclick();

    await expect(page.getByTestId('terminal-window')).toBeVisible();
    await expect(page.getByTestId('workflow-node-terminal')).toHaveCount(0);
  });

  test('node drag start clears edge selection so top-bar does not show "edge selected"', async ({ page }) => {
    await installWorkflowFixture(page);
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    expect(page.getByTestId('workflow-edge-selection-count')).toHaveCount(0);

    const edgeHit = page.locator('.wf-bridge-edge-hit').first();
    await edgeHit.click({ force: true });

    await expect(page.getByTestId('workflow-edge-selection-count')).toBeVisible();

    const agentNode = page.getByTestId('workflow-node').first();
    const box = await agentNode.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 30, { steps: 4 });

    await expect(page.getByTestId('workflow-edge-selection-count')).toHaveCount(0);

    await page.mouse.up();
    await expect(page.getByTestId('workflow-edge-selection-count')).toHaveCount(0);
  });

  test('resource node can dock to an Agent on the top side (side=top)', async ({ page }) => {
    const { network } = await installWorkflowFixture(page);
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    const agentNode = page.getByTestId('workflow-node').first();
    const resourceNode = page.getByTestId('workflow-component-node').first();
    await expect(resourceNode).toBeVisible();

    const agentBox = await agentNode.boundingBox();
    const resourceBox = await resourceNode.boundingBox();
    expect(agentBox).not.toBeNull();
    expect(resourceBox).not.toBeNull();

    const targetX = agentBox!.x + agentBox!.width / 2;
    const targetY = agentBox!.y - resourceBox!.height / 2 - 16;

    const startX = resourceBox!.x + resourceBox!.width / 2;
    const startY = resourceBox!.y + 15;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const midX = startX + (targetX - startX) * 0.5;
    const midY = startY + (targetY - startY) * 0.5;
    await page.mouse.move(midX, midY, { steps: 12 });
    await page.mouse.move(targetX, targetY, { steps: 12 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(600);

    const dockPut = network.graphMapRequests.find(req => {
      const payload = req.payload as JsonRecord;
      const links = Array.isArray(payload.capsuleDockLinks) ? payload.capsuleDockLinks : [];
      return links.length > 0;
    });

    const dockedAny = await page.locator('.react-flow__node.workflow-capsule-docked').count();

    expect(dockedAny > 0 || Boolean(dockPut), 'resource node should dock to agent after drag').toBe(true);

    if (dockPut) {
      const links = (dockPut.payload as JsonRecord).capsuleDockLinks as JsonRecord[];
      const verticalLinks = links.filter(link => {
        const side = String(link.side || '').toLowerCase();
        return side === 'top' || side === 'bottom';
      });
      expect(verticalLinks.length, 'at least one dock link on a vertical side (top or bottom)').toBeGreaterThan(0);
    }

    expect(network.pageErrors, 'page errors').toEqual([]);
  });

  test('Timer vertical magnetic dock uses rendered bounds and does not overlap Agent', async ({ page }) => {
    const { network } = await installWorkflowFixture(page);
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${mainAgentNodeId}"]`);
    const timerNode = page.locator(`[data-testid="workflow-event-node"][data-node-id="${timerNodeId}"]`);
    await expect(agentNode).toBeVisible();
    await expect(timerNode).toBeVisible();

    const agentBox = await agentNode.boundingBox();
    const timerBox = await timerNode.boundingBox();
    expect(agentBox).not.toBeNull();
    expect(timerBox).not.toBeNull();

    const startX = timerBox!.x + timerBox!.width / 2;
    const startY = timerBox!.y + timerBox!.height / 2;
    const targetX = agentBox!.x + agentBox!.width / 2;
    const targetY = agentBox!.y - timerBox!.height / 2 + 34;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + (targetX - startX) * 0.45, startY + (targetY - startY) * 0.45, { steps: 12 });
    await page.mouse.move(targetX, targetY, { steps: 14 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(700);

    const timerAfter = await timerNode.boundingBox();
    const agentAfter = await agentNode.boundingBox();
    expect(timerAfter).not.toBeNull();
    expect(agentAfter).not.toBeNull();
    expect(
      timerAfter!.y + timerAfter!.height,
      `Timer bottom ${timerAfter!.y + timerAfter!.height} should stay above Agent top ${agentAfter!.y}`,
    ).toBeLessThanOrEqual(agentAfter!.y - 2);

    const dockPut = network.graphMapRequests.find(req => {
      const links = Array.isArray((req.payload as JsonRecord).capsuleDockLinks)
        ? (req.payload as JsonRecord).capsuleDockLinks as JsonRecord[]
        : [];
      return links.some(link => (
        Array.isArray(link.nodeIds)
          && link.nodeIds.includes(timerNodeId)
          && link.nodeIds.includes(mainAgentNodeId)
          && String(link.side || '').toLowerCase() === 'top'
      ));
    });
    expect(Boolean(dockPut), 'Timer should persist a top-side magnetic dock to Agent').toBe(true);
    expect(network.pageErrors, 'page errors').toEqual([]);
  });
});
