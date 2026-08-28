import { expect, test, type Locator, type Page, type Request, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sessionId = 'e2e-session-m5';
const graphNodeId = 'e2e-agent-m5';
const markdownNodeId = 'perf-markdown-0';
const excalidrawNodeId = 'perf-excalidraw-1';

type JsonRecord = Record<string, any>;
type ComponentType = 'markdown' | 'excalidraw' | 'file';
type PerfLongTask = { name: string; startTime: number; duration: number };

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

type PerfNetwork = {
  graphMapRequests: JsonRecord[];
  graphMapPutsBeforePointerUp: JsonRecord[];
  edgeGesturePhase: 'idle' | 'dragging';
  failedResponses: string[];
  requestFailures: string[];
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

function componentState(type: ComponentType, index: number): ComponentState {
  const nodeId = index === 0 ? markdownNodeId : index === 1 ? excalidrawNodeId : `perf-${type}-${index}`;
  return {
    nodeId,
    type,
    title: type === 'markdown' ? `Perf Notes ${index}` : type === 'file' ? `Perf File ${index}` : `Perf Diagram ${index}`,
    revision: 1,
    markdown: type === 'markdown' ? `# Perf Notes ${index}\n\nSeeded markdown body.` : undefined,
    scene: type === 'excalidraw'
      ? {
          elements: [{
            id: `perf-rect-${index}`,
            type: 'rectangle',
            x: 24,
            y: 24,
            width: 92,
            height: 54,
            strokeColor: '#6965DB',
            backgroundColor: 'rgba(105,101,219,0.16)',
          }],
          appState: { viewBackgroundColor: '#ffffff' },
          files: {},
        }
      : undefined,
    file: type === 'file'
      ? { source: 'workspace', path: 'package.json', name: 'package.json', mime: 'application/json', size: 820 }
      : undefined,
    observableInputs: observableInputsForType(type),
    observableOutputs: observableOutputsForType(type),
    statePath: `Harness/a2a/component-nodes/${nodeId}/state.json`,
  };
}

function componentNodeSnapshot(state: ComponentState, index: number) {
  const column = index % 8;
  const row = Math.floor(index / 8);
  const position = { x: 180 + column * 360, y: 360 + row * 330 };
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

function buildComponents() {
  const cycle: ComponentType[] = ['markdown', 'excalidraw', 'file'];
  return Array.from({ length: 39 }, (_, index) => componentState(cycle[index % cycle.length], index));
}

function buildEdges(components: ComponentState[]) {
  return Array.from({ length: 80 }, (_, index) => {
    const source = components[index % components.length];
    return {
      id: `perf-edge-${index}`,
      source: source.nodeId,
      target: graphNodeId,
      sourceHandle: primaryOutputForType(source.type),
      targetHandle: 'context',
      label: 'resource -> context',
    };
  });
}

function workflowSnapshot() {
  const components = buildComponents();
  const componentNodes = components.map(componentNodeSnapshot);
  const edges = buildEdges(components);
  const componentStateRefs = Object.fromEntries(components.map(state => [state.nodeId, {
    type: state.type,
    title: state.title,
    statePath: state.statePath,
    revision: state.revision,
    ...(state.file ? { file: state.file } : {}),
  }]));
  const agentPosition = { x: 620, y: 120 };
  const agentNode = {
    id: graphNodeId,
    label: 'M5 Perf Agent',
    kind: 'terminal-session',
    level: 0,
    status: 'running',
    lifecycle: 'live',
    runtimeState: 'running',
    managedByCurrentServer: true,
    control: control(),
    role: 'main',
    skills: ['wf-max', 'tdd', 'wf-browser'],
    permissions: { filesystem: 'workspace-write', network: 'enabled' },
    sessionId,
    taskId: 'task-standardize-workflow-nodes',
    agentKind: 'main',
    runtime: 'codex',
    peerId: 'codex',
    objective: 'AC-012 performance smoke seeded graph',
    cwd: repoRoot,
    graphNodeId,
    config: {
      role: 'main',
      prompt: 'AC-012 performance smoke seeded graph',
      model: 'gpt-5-codex',
      provider: 'openai',
      cwd: repoRoot,
      env: { HARNESS_WORKFLOW_MAP: 'Harness/a2a/workflow-map.json' },
      permissions: { filesystem: 'workspace-write', network: 'enabled' },
      launchPolicy: { autoStart: false, restartOnSave: false },
      skills: ['wf-max', 'tdd', 'wf-browser'],
    },
  };

  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-m5',
    taskId: 'task-standardize-workflow-nodes',
    mode: 'wf-max',
    phase: 'm5-red',
    gate: 'TEST-GATE',
    rootAgentId: graphNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [{
      sessionId,
      runtime: 'codex',
      role: 'main',
      objective: 'AC-012 performance smoke seeded graph',
      status: 'running',
      attachMode: true,
      wsClientCount: 1,
      agentKind: 'main',
      workflowMode: 'wf-max',
      cwd: repoRoot,
      graphNodeId,
      inputOwnerId: 'drawer',
    }],
    nodes: [agentNode, ...componentNodes],
    edges,
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-m5',
      version: 1,
      nodes: [
        {
          nodeId: graphNodeId,
          sessionId,
          agentKind: 'main',
          runtime: 'codex',
          status: 'running',
          lifecycle: 'live',
          runtimeState: 'running',
          managedByCurrentServer: true,
          control: control(),
          taskId: 'task-standardize-workflow-nodes',
          cwd: repoRoot,
          position: agentPosition,
        },
        ...componentNodes.map(node => ({
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
        })),
      ],
      edges,
      positions: {
        [graphNodeId]: agentPosition,
        ...Object.fromEntries(componentNodes.map(node => [node.id, node.position])),
      },
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes',
      sourceOfTruth: 'backend',
      componentStateRefs,
    },
    componentNodes: Object.fromEntries(components.map(state => [state.nodeId, state])),
    graphContextBySessionId: {
      [sessionId]: {
        workflowMapPath: 'Harness/a2a/workflow-map.json',
        componentStatePath: 'Harness/a2a/component-nodes',
        sourceOfTruth: 'backend',
        componentStateRefs,
      },
    },
  };
}

function requestJson(request: Request) {
  try {
    return request.postData() ? request.postDataJSON() as JsonRecord : {};
  } catch {
    return {};
  }
}

async function installPerformanceFixture(page: Page): Promise<PerfNetwork> {
  const network: PerfNetwork = {
    graphMapRequests: [],
    graphMapPutsBeforePointerUp: [],
    edgeGesturePhase: 'idle',
    failedResponses: [],
    requestFailures: [],
    pageErrors: [],
  };
  const snapshot = workflowSnapshot();
  let committedGraph = cloneJson(snapshot.graph) as JsonRecord;

  page.on('pageerror', error => network.pageErrors.push(error.message));
  page.on('requestfailed', request => {
    if (request.url().includes('/api/')) network.requestFailures.push(`${request.failure()?.errorText || 'failed'} ${request.url()}`);
  });
  page.on('response', response => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      network.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, {
    taskId: 'task-standardize-workflow-nodes',
    phase: 'm5-red',
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
    taskId: 'task-standardize-workflow-nodes',
    status: 'open',
    phase: 'm5-red',
  }]));
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, snapshot));
  await page.route('**/api/a2a/graph-map**', route => {
    const record = {
      method: route.request().method(),
      payload: requestJson(route.request()),
    };
    network.graphMapRequests.push(record);
    if (record.method === 'PUT' && network.edgeGesturePhase === 'dragging') {
      network.graphMapPutsBeforePointerUp.push(record);
    }
    if (record.method === 'PUT') {
      committedGraph = {
        ...committedGraph,
        ...cloneJson(record.payload),
        version: Number(record.payload.version || committedGraph.version || 1),
        nodes: Array.isArray(record.payload.nodes) ? cloneJson(record.payload.nodes) : committedGraph.nodes,
        edges: Array.isArray(record.payload.edges) ? cloneJson(record.payload.edges) : committedGraph.edges,
        positions: record.payload.positions && typeof record.payload.positions === 'object'
          ? cloneJson(record.payload.positions)
          : committedGraph.positions,
        graphContextPath: committedGraph.graphContextPath || 'Harness/a2a/workflow-map.json',
        sourceOfTruth: record.payload.sourceOfTruth || committedGraph.sourceOfTruth || 'backend',
        undoStack: [],
        redoStack: [],
      };
    }
    return jsonResponse(route, {
      ok: true,
      revision: Number(committedGraph.version || network.graphMapRequests.length + 2),
      graph: cloneJson(committedGraph),
      sourceOfTruth: 'backend',
    });
  });
  await page.route('**/api/a2a/component-nodes/*', route => {
    const nodeId = new URL(route.request().url()).pathname.split('/').pop() || '';
    const state = snapshot.componentNodes[nodeId] || snapshot.componentNodes[markdownNodeId];
    return jsonResponse(route, {
      ok: true,
      nodeId,
      revision: state.revision,
      state,
      sourceOfTruth: 'backend',
    });
  });
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, snapshot.sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, {
    entries: [{ seq: 1, stream: 'stdout', data: '\r\nM5 performance fixture ready\r\n' }],
  }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/workspace/tree**', route => jsonResponse(route, {
    root: repoRoot,
    path: '',
    entries: [{ name: 'package.json', path: 'package.json', type: 'file', size: 820, hasChildren: false }],
  }));
  await page.route('**/api/workspace/text**', route => jsonResponse(route, {
    text: '{"perf":true}',
    bytesRead: 13,
    truncated: false,
    encoding: 'utf-8',
  }));
  await page.route('**/api/workspace/file**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{"perf":true}',
  }));
  await page.route('**/api/user-files', route => jsonResponse(route, { ok: true, files: [] }));
  return network;
}

async function installLongTaskObserver(page: Page) {
  await page.addInitScript(() => {
    const target = window as any;
    target.__workflowPerfLongTasks = [];
    target.__workflowPerfLongTaskObserverReady = false;
    try {
      const observer = new PerformanceObserver(list => {
        target.__workflowPerfLongTasks.push(...list.getEntries().map(entry => ({
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration,
        })));
      });
      observer.observe({ type: 'longtask', buffered: true } as any);
      target.__workflowPerfLongTaskObserver = observer;
      target.__workflowPerfLongTaskObserverReady = true;
    } catch {
      target.__workflowPerfLongTaskObserverReady = false;
    }
  });
}

async function performanceNow(page: Page) {
  return page.evaluate(() => performance.now());
}

async function longTasksBetween(page: Page, startTime: number, endTime: number): Promise<PerfLongTask[]> {
  return page.evaluate(({ start, end }) => {
    const tasks = ((window as any).__workflowPerfLongTasks || []) as PerfLongTask[];
    return tasks.filter(task => task.startTime >= start && task.startTime <= end + 50);
  }, { start: startTime, end: endTime });
}

async function expectNoLongTaskAbove(page: Page, startTime: number, endTime: number, label: string) {
  const tasks = await longTasksBetween(page, startTime, endTime);
  const maxDuration = Math.max(0, ...tasks.map(task => task.duration));
  expect(maxDuration, `${label} long tasks: ${JSON.stringify(tasks.slice(0, 8))}`).toBeLessThanOrEqual(250);
}

async function componentNodeWithViewportExpand(page: Page, innerTestId: string) {
  const candidates = page.locator(`[data-testid="workflow-component-node"]:has([data-testid="${innerTestId}"])`);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const expand = candidate.getByTestId('workflow-component-node-expand');
    const box = await expand.boundingBox();
    if (!box) continue;
    if (
      box.x >= 0
      && box.y >= 0
      && box.x + box.width <= viewport!.width
      && box.y + box.height <= viewport!.height
    ) {
      const actionable = await expand.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const topElement = document.elementFromPoint(centerX, centerY);
        return topElement === element || Boolean(topElement && element.contains(topElement));
      });
      if (actionable) return candidate;
    }
  }
  throw new Error(`No in-viewport component expand button found for ${innerTestId}`);
}

async function actionableBridgeLabel(page: Page): Promise<Locator> {
  const labels = page.getByTestId('workflow-bridge-label');
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const count = await labels.count();
  for (let index = 0; index < count; index += 1) {
    const label = labels.nth(index);
    const box = await label.boundingBox();
    if (!box) continue;
    if (
      box.x < 0
      || box.y < 0
      || box.x + box.width > viewport!.width
      || box.y + box.height > viewport!.height
    ) continue;
    const actionable = await label.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const topElement = document.elementFromPoint(centerX, centerY);
      const topBridgeLabel = topElement?.closest?.('[data-testid="workflow-bridge-label"]');
      return topElement === element || Boolean(topElement && element.contains(topElement)) || Boolean(topBridgeLabel);
    });
    if (actionable) return label;
  }
  throw new Error('No actionable bridge label found in the viewport');
}

async function workflowPanePoint(page: Page) {
  const point = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.react-flow__pane');
    const rect = pane?.getBoundingClientRect();
    if (!pane || !rect) return null;
    const candidates = [
      { x: 0.82, y: 0.22 },
      { x: 0.78, y: 0.72 },
      { x: 0.58, y: 0.86 },
      { x: 0.92, y: 0.48 },
    ];
    for (const candidate of candidates) {
      const x = rect.left + rect.width * candidate.x;
      const y = rect.top + rect.height * candidate.y;
      const element = document.elementFromPoint(x, y);
      if (element === pane || element?.classList.contains('react-flow__pane')) return { x, y };
    }
    return { x: rect.left + rect.width * 0.82, y: rect.top + rect.height * 0.48 };
  });
  expect(point).not.toBeNull();
  return point!;
}

test.describe('WF UI M5 RED workflow performance smoke', () => {
  test('AC-012 seeded workflow graph is ready under 3s with no >250ms long task on key menus/editors', async ({ page }) => {
    test.setTimeout(120_000);
    await installLongTaskObserver(page);
    const network = await installPerformanceFixture(page);
    const cdp = await page.context().newCDPSession(page);
    const runtimeExceptions: string[] = [];
    cdp.on('Runtime.exceptionThrown', event => {
      runtimeExceptions.push(event.exceptionDetails.text || event.exceptionDetails.exception?.description || 'runtime exception');
    });
    await cdp.send('Runtime.enable');

    const readyStartedAt = Date.now();
    await page.goto('/workflow');
    const canvas = page.getByTestId('workflow-canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('data-workflow-edge-count', '80');
    await expect(page.getByTestId('workflow-component-node')).toHaveCount(39);
    await expect.poll(() => page.getByTestId('workflow-bridge-label').count()).toBeGreaterThan(0);
    const readyMs = Date.now() - readyStartedAt;
    expect(readyMs).toBeLessThan(3000);
    await expect(page.evaluate(() => Boolean((window as any).__workflowPerfLongTaskObserverReady))).resolves.toBe(true);

    let start = await performanceNow(page);
    await page.getByTestId('workflow-create-node').click();
    await expect(page.getByTestId('workflow-create-node-panel')).toBeVisible();
    let end = await performanceNow(page);
    await expectNoLongTaskAbove(page, start, end, 'create node menu open');
    await page.keyboard.press('Escape');

    const bridgeLabel = await actionableBridgeLabel(page);
    const bridgeBox = await bridgeLabel.boundingBox();
    expect(bridgeBox).not.toBeNull();
    start = await performanceNow(page);
    network.edgeGesturePhase = 'dragging';
    await page.mouse.move(bridgeBox!.x + bridgeBox!.width / 2, bridgeBox!.y + bridgeBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bridgeBox!.x + bridgeBox!.width / 2, bridgeBox!.y + bridgeBox!.height / 2 + 36, { steps: 4 });
    await page.waitForTimeout(80);
    expect(network.graphMapPutsBeforePointerUp).toEqual([]);
    network.edgeGesturePhase = 'idle';
    await page.mouse.up();
    await expect.poll(() => network.graphMapRequests.some(request => request.method === 'PUT')).toBe(true);
    await page.waitForTimeout(120);
    end = await performanceNow(page);
    await expectNoLongTaskAbove(page, start, end, 'seeded edge label drag');

    const panePoint = await workflowPanePoint(page);
    start = await performanceNow(page);
    await page.mouse.move(panePoint.x, panePoint.y);
    await page.mouse.wheel(0, -320);
    await page.mouse.down();
    await page.mouse.move(panePoint.x + 96, panePoint.y + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    end = await performanceNow(page);
    await expectNoLongTaskAbove(page, start, end, 'seeded zoom and pan');

    const markdownNode = await componentNodeWithViewportExpand(page, 'workflow-markdown-node-editor');
    await expect(markdownNode).toBeVisible();
    start = await performanceNow(page);
    await markdownNode.getByTestId('workflow-component-node-expand').click();
    await expect(page.getByTestId('workflow-markdown-rich-editor')).toBeVisible({ timeout: 20000 });
    end = await performanceNow(page);
    await expectNoLongTaskAbove(page, start, end, 'markdown fullscreen open');
    await page.getByTestId('workflow-component-fullscreen-close').click();

    const excalidrawNode = await componentNodeWithViewportExpand(page, 'workflow-excalidraw-node');
    await expect(excalidrawNode).toBeVisible();
    start = await performanceNow(page);
    await excalidrawNode.getByTestId('workflow-component-node-expand').click();
    const editor = page.getByTestId('workflow-excalidraw-fullscreen-editor');
    await expect(editor).toHaveAttribute('data-editor-loaded', 'true', { timeout: 30000 });
    await expect(editor.locator('.excalidraw')).toBeVisible();
    end = await performanceNow(page);
    await expectNoLongTaskAbove(page, start, end, 'excalidraw fullscreen open');

    expect(network.failedResponses).toEqual([]);
    expect(network.requestFailures).toEqual([]);
    expect(network.pageErrors).toEqual([]);
    expect(runtimeExceptions).toEqual([]);
  });
});
