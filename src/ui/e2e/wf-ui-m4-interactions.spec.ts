import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const token = process.env.WF_UI_E2E_TOKEN || 'playwright-m1-red';
const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const mainSessionId = 'e2e-session-m4-main';
const workerSessionId = 'e2e-session-m4-worker';
const mainNodeId = 'e2e-agent-main-m4';
const workerNodeId = 'e2e-agent-worker-m4';
const bridgeEdgeId = 'edge-m4-main-worker';

type JsonRecord = Record<string, any>;

type BrowserSignals = {
  consoleErrors: string[];
  pageErrors: string[];
  cdpExceptions: string[];
  requestFailures: string[];
  failedApiResponses: string[];
  reactUpdateLoopErrors: string[];
};

type HarnessNetwork = {
  workspaceTreeRequests: string[];
  componentCreateRequests: JsonRecord[];
  graphMapRequests: JsonRecord[];
  graphMapPutsBeforePointerUp: JsonRecord[];
  bridgeMessageRequests: string[];
  edgeGesturePhase: 'idle' | 'dragging';
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

function workflowSnapshot() {
  const baseNode = {
    kind: 'terminal-session',
    level: 0,
    status: 'running',
    lifecycle: 'live',
    runtimeState: 'running',
    managedByCurrentServer: true,
    control: control(),
    runtime: 'codex',
    taskId: 'task-standardize-workflow-nodes',
    cwd: repoRoot,
    skills: ['wf-max', 'tdd', 'wf-browser'],
    permissions: ['terminal'],
  };
  const nodes = [
    {
      ...baseNode,
      id: mainNodeId,
      label: 'M4 Main Agent',
      role: 'main',
      agentKind: 'main',
      sessionId: mainSessionId,
      graphNodeId: mainNodeId,
      objective: 'M4 interaction fixture main node',
    },
    {
      ...baseNode,
      id: workerNodeId,
      label: 'M4 Worker Agent',
      role: 'test-writer',
      agentKind: 'subagent',
      sessionId: workerSessionId,
      graphNodeId: workerNodeId,
      objective: 'M4 interaction fixture worker node',
    },
  ];
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-m4',
    taskId: 'task-standardize-workflow-nodes',
    mode: 'wf-max',
    phase: 'm4-red',
    gate: 'TEST-GATE',
    rootAgentId: mainNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [
      { sessionId: mainSessionId, runtime: 'codex', role: 'main', status: 'running', attachMode: true, graphNodeId: mainNodeId, cwd: repoRoot },
      { sessionId: workerSessionId, runtime: 'codex', role: 'test-writer', status: 'running', attachMode: true, graphNodeId: workerNodeId, cwd: repoRoot },
    ],
    nodes,
    edges: [{
      id: bridgeEdgeId,
      from: mainNodeId,
      to: workerNodeId,
      source: mainNodeId,
      target: workerNodeId,
      relation: 'delegates',
      sourceHandle: 'right',
      targetHandle: 'left',
      offset: 0,
    }],
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-m4',
      version: 1,
      nodes: [
        { nodeId: mainNodeId, sessionId: mainSessionId, kind: 'terminal-session', agentKind: 'main', runtime: 'codex', status: 'running', lifecycle: 'live', runtimeState: 'running', control: control(), taskId: 'task-standardize-workflow-nodes', cwd: repoRoot, position: { x: 460, y: 180 } },
        { nodeId: workerNodeId, sessionId: workerSessionId, kind: 'terminal-session', agentKind: 'subagent', runtime: 'codex', status: 'running', lifecycle: 'live', runtimeState: 'running', control: control(), taskId: 'task-standardize-workflow-nodes', cwd: repoRoot, position: { x: 760, y: 390 } },
      ],
      edges: [{
        id: bridgeEdgeId,
        from: mainNodeId,
        to: workerNodeId,
        source: mainNodeId,
        target: workerNodeId,
        relation: 'delegates',
        sourceHandle: 'right',
        targetHandle: 'left',
        offset: 0,
      }],
      positions: {
        [mainNodeId]: { x: 460, y: 180 },
        [workerNodeId]: { x: 760, y: 390 },
      },
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
      sourceOfTruth: 'backend',
    },
    graphContextBySessionId: {},
  };
}

function workspaceEntries(relPath: string) {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const table: Record<string, unknown[]> = {
    '': [
      { name: 'src', path: 'src', type: 'directory', size: 0, hasChildren: true, mtime: '2026-08-01T00:00:00.000Z' },
      { name: 'Harness', path: 'Harness', type: 'directory', size: 0, hasChildren: true, mtime: '2026-08-01T00:00:00.000Z' },
      { name: 'package.json', path: 'package.json', type: 'file', size: 820, hasChildren: false, mtime: '2026-08-01T00:00:00.000Z' },
    ],
    src: [
      { name: 'ui', path: 'src/ui', type: 'directory', size: 0, hasChildren: true, mtime: '2026-08-01T00:00:00.000Z' },
      { name: 'index.js', path: 'src/index.js', type: 'file', size: 610, hasChildren: false, mtime: '2026-08-01T00:00:00.000Z' },
    ],
  };
  return table[normalized] || [];
}

async function installBrowserCollectors(page: Page): Promise<BrowserSignals> {
  const signals: BrowserSignals = {
    consoleErrors: [],
    pageErrors: [],
    cdpExceptions: [],
    requestFailures: [],
    failedApiResponses: [],
    reactUpdateLoopErrors: [],
  };
  await page.addInitScript(() => {
    (window as any).__wfM4LongTasks = [];
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          (window as any).__wfM4LongTasks.push({ name: entry.name, duration: entry.duration });
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      (window as any).__wfM4LongTasksUnavailable = true;
    }
  });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    signals.consoleErrors.push(text);
    if (/Minified React error #185|maximum update depth|too many re-renders/i.test(text)) {
      signals.reactUpdateLoopErrors.push(text);
    }
  });
  page.on('pageerror', error => {
    const text = error.message;
    signals.pageErrors.push(text);
    if (/Minified React error #185|maximum update depth|too many re-renders/i.test(text)) {
      signals.reactUpdateLoopErrors.push(text);
    }
  });
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      signals.requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.trim());
    }
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/') && response.status() >= 400) {
      signals.failedApiResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown', event => {
    const text = event.exceptionDetails.exception?.description
      || event.exceptionDetails.text
      || JSON.stringify(event.exceptionDetails);
    signals.cdpExceptions.push(text);
    if (/Minified React error #185|maximum update depth|too many re-renders/i.test(text)) {
      signals.reactUpdateLoopErrors.push(text);
    }
  });
  return signals;
}

async function installWorkflowFixture(page: Page): Promise<HarnessNetwork> {
  const network: HarnessNetwork = {
    workspaceTreeRequests: [],
    componentCreateRequests: [],
    graphMapRequests: [],
    graphMapPutsBeforePointerUp: [],
    bridgeMessageRequests: [],
    edgeGesturePhase: 'idle',
  };

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, { taskId: 'task-standardize-workflow-nodes', phase: 'm4-red', gate: 'TEST-GATE' }));
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
  await page.route('**/api/tasks**', route => jsonResponse(route, [{ taskId: 'task-standardize-workflow-nodes', status: 'open', phase: 'm4-red' }]));
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, workflowSnapshot()));
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, workflowSnapshot().sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, { entries: [{ seq: 1, stream: 'stdout', data: '\r\nM4 terminal fixture ready\r\n' }] }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/stop', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/a2a/nodes/**/config', route => jsonResponse(route, { ok: true, node: { id: mainNodeId }, restartRequired: false, revision: 2 }));
  await page.route('**/api/a2a/nodes/**/restart', route => jsonResponse(route, { ok: true, nodeId: mainNodeId, revision: 3 }));
  await page.route('**/api/a2a/nodes/**', route => jsonResponse(route, { ok: true, revision: 4 }));
  await page.route('**/api/a2a/bridge-messages**', route => {
    network.bridgeMessageRequests.push(route.request().url());
    return jsonResponse(route, {
      entries: [{
        seq: 1,
        ts: '2026-08-01T00:00:00.000Z',
        fromSessionId: mainSessionId,
        toSessionId: workerSessionId,
        data: 'M4 bridge fixture message',
      }],
    });
  });
  await page.route('**/api/a2a/graph-map**', async route => {
    const payload = route.request().postDataJSON() as JsonRecord || {};
    const record = { method: route.request().method(), url: route.request().url(), payload };
    network.graphMapRequests.push(record);
    if (record.method === 'PUT' && network.edgeGesturePhase === 'dragging') {
      network.graphMapPutsBeforePointerUp.push(record);
    }
    return jsonResponse(route, {
      ok: true,
      revision: network.graphMapRequests.length + 1,
      graph: workflowSnapshot().graph,
      sourceOfTruth: 'backend',
    });
  });
  await page.route('**/api/workspace/tree**', route => {
    const url = new URL(route.request().url());
    const relPath = url.searchParams.get('path') || '';
    network.workspaceTreeRequests.push(relPath);
    return jsonResponse(route, { root: repoRoot, path: relPath, entries: workspaceEntries(relPath) });
  });
  await page.route('**/api/workspace/meta**', route => {
    const url = new URL(route.request().url());
    const filePath = url.searchParams.get('path') || '';
    return jsonResponse(route, { ok: true, path: filePath, name: path.basename(filePath), type: 'file', exists: true, size: 820, mime: 'application/json', etag: 'm4-etag', previewKind: 'text' });
  });
  await page.route('**/api/workspace/text**', route => jsonResponse(route, { text: '{ "name": "m4" }', bytesRead: 16, truncated: false, encoding: 'utf-8' }));
  await page.route('**/api/workspace/file**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{ "name": "m4" }' }));
  await page.route('**/api/a2a/component-nodes', async route => {
    const payload = route.request().postDataJSON() as JsonRecord;
    network.componentCreateRequests.push(payload);
    const nodeId = `component-m4-${network.componentCreateRequests.length}`;
    return jsonResponse(route, {
      ok: true,
      nodeId,
      revision: 1,
      node: { id: nodeId, label: payload.title || 'M4 file node', kind: 'component-node', componentType: payload.type, type: payload.type, level: 0, status: 'ready', lifecycle: 'stateful', runtimeState: 'ready', managedByCurrentServer: true, control: control(), graphNodeId: nodeId, revision: 1, statePath: `Harness/a2a/component-nodes/${nodeId}.json`, observableInputs: ['file'], observableOutputs: ['file', 'path'] },
      state: { nodeId, type: payload.type, title: payload.title || 'M4 file node', revision: 1, file: payload.file, observableInputs: ['file'], observableOutputs: ['file', 'path'] },
    });
  });
  await page.route('**/api/a2a/component-nodes/*', route => jsonResponse(route, { ok: true, revision: 2 }));
  await page.route('**/api/user-files', route => jsonResponse(route, { ok: true, files: [] }));

  return network;
}

async function openWorkflow(page: Page) {
  await page.goto(`/workflow?token=${encodeURIComponent(token)}`);
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-node').first()).toBeVisible();
  await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
  await page.waitForTimeout(250);
}

async function expectInViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function expectTopAtCenter(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const topDescriptor = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y) as HTMLElement | null;
    return element?.closest('[data-testid]')?.getAttribute('data-testid') || element?.tagName || null;
  }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
  const expected = await locator.getAttribute('data-testid');
  expect(topDescriptor).toBe(expected);
}

async function assertNoBrowserFailures(page: Page, signals: BrowserSignals) {
  const longTasks = await page.evaluate(() => ((window as any).__wfM4LongTasks || []) as { duration: number }[]);
  expect(signals.reactUpdateLoopErrors, 'React #185 / update-loop browser errors').toEqual([]);
  expect(signals.pageErrors, 'pageerror events').toEqual([]);
  expect(signals.cdpExceptions, 'CDP Runtime.exceptionThrown events').toEqual([]);
  expect(signals.consoleErrors, 'console.error events').toEqual([]);
  expect(signals.requestFailures, 'failed /api requests').toEqual([]);
  expect(signals.failedApiResponses, 'unexpected failed /api responses').toEqual([]);
  expect(longTasks.filter(entry => entry.duration > 250), 'long tasks above 250ms').toEqual([]);
}

test.describe('WF UI M4 RED interaction acceptance', () => {
  test('AC-006 Explorer single-click toggles folders, opens file preview, and never moves the canvas node', async ({ page }) => {
    const signals = await installBrowserCollectors(page);
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    const nodeBefore = await page.getByTestId('workflow-node').first().boundingBox();
    const srcItem = page.locator('[data-testid="workspace-tree-item"][data-path="src"]').first();
    await expect(srcItem).toBeVisible();
    await expect(srcItem).toHaveAttribute('aria-expanded', 'false');

    await srcItem.click();
    await expect(srcItem).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => network.workspaceTreeRequests.includes('src')).toBe(true);
    await srcItem.click();
    await expect(srcItem).toHaveAttribute('aria-expanded', 'false');

    const fileItem = page.locator('[data-testid="workspace-tree-item"][data-path="package.json"]').first();
    await fileItem.click();
    await expect(page.getByTestId('workspace-preview-panel')).toBeVisible();
    await expect(page.getByTestId('workspace-preview-panel')).toContainText('package.json');
    await page.getByTestId('workspace-preview-insert').click();
    await expect.poll(() => network.componentCreateRequests.length).toBe(1);
    expect(network.componentCreateRequests[0]).toEqual(expect.objectContaining({
      type: 'file',
      file: expect.objectContaining({ source: 'workspace', path: 'package.json' }),
    }));

    const explorer = page.getByTestId('workflow-explorer-shell');
    await explorer.hover();
    await page.mouse.down();
    await page.mouse.move(260, 420);
    await page.mouse.up();
    const nodeAfter = await page.getByTestId('workflow-node').first().boundingBox();
    expect(nodeBefore).not.toBeNull();
    expect(nodeAfter).not.toBeNull();
    expect(Math.abs(nodeAfter!.x - nodeBefore!.x)).toBeLessThan(2);
    expect(Math.abs(nodeAfter!.y - nodeBefore!.y)).toBeLessThan(2);
    await assertNoBrowserFailures(page, signals);
  });

  test('AC-006 AC-011 workspace context menu uses viewport coordinates, clamps in view, and stays clickable on top', async ({ page }) => {
    const signals = await installBrowserCollectors(page);
    await installWorkflowFixture(page);
    await page.setViewportSize({ width: 640, height: 420 });
    await openWorkflow(page);

    const srcItem = page.locator('[data-testid="workspace-tree-item"][data-path="src"]').first();
    await expect(srcItem).toBeVisible();
    await srcItem.evaluate((element) => {
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: window.innerWidth - 6,
        clientY: window.innerHeight - 6,
      }));
    });

    const menu = page.getByTestId('workspace-context-menu');
    await expect(menu).toBeVisible();
    await expectInViewport(page, menu);
    await expectTopAtCenter(page, menu);
    const menuBox = await menu.boundingBox();
    expect(menuBox!.x).toBeGreaterThan(360);
    expect(menuBox!.y).toBeGreaterThan(250);
    await menu.getByRole('button', { name: /new file/i }).click();
    await assertNoBrowserFailures(page, signals);
  });

  test('AC-007 node double-click opens settings and right-click opens only the contracted node menu actions', async ({ page }) => {
    const signals = await installBrowserCollectors(page);
    await installWorkflowFixture(page);
    await openWorkflow(page);

    const node = page.locator(`[data-testid="workflow-node"][data-node-id="${mainNodeId}"]`).first();
    await expect(node).toBeVisible();
    await node.dblclick();
    await expect(page.getByTestId('workflow-node-settings')).toBeVisible();
    await page.keyboard.press('Escape');

    await node.click({ button: 'right' });
    await expect(page.getByTestId('workflow-node-context-menu')).toBeVisible();
    await expect(page.getByTestId('workflow-context-menu')).toHaveCount(0);
    await expect(page.getByTestId('workflow-bridge-panel')).toHaveCount(0);

    const actionValues = await page.getByTestId('workflow-node-context-action').evaluateAll(elements => (
      elements.map(element => element.getAttribute('data-action')).filter(Boolean).sort()
    ));
    expect(actionValues).toEqual(['copy', 'cut', 'delete', 'duplicate', 'open-config', 'settings'].sort());
    await assertNoBrowserFailures(page, signals);
  });

  test('AC-008 AC-012 bridge single-click/drag does not open the panel or PUT graph-map before pointerup; double-click opens it', async ({ page }) => {
    const signals = await installBrowserCollectors(page);
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    const label = page.getByTestId('workflow-bridge-label').first();
    await expect(label).toBeVisible();
    await label.click();
    await expect(page.getByTestId('workflow-bridge-panel')).toHaveCount(0);
    await expect(page.getByTestId('workflow-edge-selection-count')).toBeVisible();

    const box = await label.boundingBox();
    expect(box).not.toBeNull();
    network.edgeGesturePhase = 'dragging';
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 40, { steps: 4 });
    await page.waitForTimeout(150);
    expect(network.graphMapPutsBeforePointerUp).toEqual([]);
    await expect(page.getByTestId('workflow-bridge-panel')).toHaveCount(0);
    await page.mouse.up();
    network.edgeGesturePhase = 'idle';
    await expect.poll(() => network.graphMapRequests.some(request => request.method === 'PUT')).toBe(true);

    await label.dblclick();
    await expect(page.getByTestId('workflow-bridge-panel')).toBeVisible();
    await expect.poll(() => network.bridgeMessageRequests.length).toBe(1);
    await assertNoBrowserFailures(page, signals);
  });

  test('AC-011 toast layer renders above workflow chrome, menus, and panels', async ({ page }) => {
    const signals = await installBrowserCollectors(page);
    await installWorkflowFixture(page);
    await openWorkflow(page);

    await page.getByTestId('workflow-create-node').click();
    await expect(page.getByTestId('workflow-create-node-panel')).toBeVisible();
    await page.locator('[data-testid="workspace-tree-item"][data-path="src"]').first().click({ button: 'right' });
    await expect(page.getByTestId('workspace-context-menu')).toBeVisible();

    const toast = page.getByTestId('workflow-toast');
    await expect(toast).toBeVisible();
    await expectTopAtCenter(page, toast);
    const z = await toast.evaluate(element => Number.parseInt(getComputedStyle(element).zIndex || '0', 10));
    const menuZ = await page.getByTestId('workspace-context-menu').evaluate(element => Number.parseInt(getComputedStyle(element).zIndex || '0', 10));
    const panelZ = await page.getByTestId('workflow-create-node-panel').evaluate(element => Number.parseInt(getComputedStyle(element).zIndex || '0', 10));
    expect(z).toBeGreaterThan(menuZ);
    expect(z).toBeGreaterThan(panelZ);
    await assertNoBrowserFailures(page, signals);
  });
});
