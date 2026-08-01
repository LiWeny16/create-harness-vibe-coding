import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const token = process.env.WF_UI_E2E_TOKEN || 'playwright-m1-red';
const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sessionId = 'e2e-session-m3';
const graphNodeId = 'e2e-agent-m3';
const markdownNodeId = 'component-markdown-e2e';
const excalidrawNodeId = 'component-excalidraw-e2e';

type JsonRecord = Record<string, any>;
type ComponentType = 'markdown' | 'excalidraw' | 'file';

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

type HarnessNetwork = {
  componentCreateRequests: JsonRecord[];
  componentPutRequests: JsonRecord[];
  graphMapRequests: JsonRecord[];
  userFileRequests: JsonRecord[];
  workspaceTreeRequests: string[];
  workspaceTextRequests: JsonRecord[];
  workspaceFileRequests: string[];
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
    observableInputs: type === 'file' ? ['file'] : ['selection', 'linked-agent-context'],
    observableOutputs: type === 'file' ? ['file', 'path'] : ['content', 'revision', 'summary'],
    statePath: `Harness/a2a/component-nodes/${nodeId}.json`,
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

function workflowSnapshot(components: ComponentState[] = []) {
  const componentNodes = components.map((state, index) => componentNodeSnapshot(state, {
    x: 260 + (index * 360),
    y: 420,
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
  }));
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
      control: control(),
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
    }, ...componentNodes],
    edges: components.length > 0 ? [{
      id: `edge-${components[0].nodeId}-${graphNodeId}`,
      source: components[0].nodeId,
      target: graphNodeId,
      sourceHandle: 'content',
      targetHandle: 'context',
      label: 'content -> context',
    }] : [],
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
      }, ...graphComponentNodes],
      edges: components.length > 0 ? [{
        id: `edge-${components[0].nodeId}-${graphNodeId}`,
        source: components[0].nodeId,
        target: graphNodeId,
        sourceHandle: 'content',
        targetHandle: 'context',
      }] : [],
      positions: {
        [graphNodeId]: { x: 620, y: 180 },
        ...Object.fromEntries(componentNodes.map(node => [node.id, node.position])),
      },
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes',
      sourceOfTruth: 'backend',
    },
    componentNodes: Object.fromEntries(components.map(state => [state.nodeId, state])),
    graphContextBySessionId: {
      [sessionId]: {
        workflowMapPath: 'Harness/a2a/workflow-map.json',
        componentStatePath: 'Harness/a2a/component-nodes',
        sourceOfTruth: 'backend',
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
  options: { initialComponents?: ComponentState[]; failNextPut?: number } = {},
): Promise<HarnessNetwork> {
  const network: HarnessNetwork = {
    componentCreateRequests: [],
    componentPutRequests: [],
    graphMapRequests: [],
    userFileRequests: [],
    workspaceTreeRequests: [],
    workspaceTextRequests: [],
    workspaceFileRequests: [],
    pageErrors: [],
    failedResponses: [],
  };
  const components = new Map<string, ComponentState>();
  for (const state of options.initialComponents || []) {
    components.set(state.nodeId, { ...state });
  }
  let failNextPut = options.failNextPut;

  page.on('pageerror', error => network.pageErrors.push(error.message));
  page.on('response', response => {
    const isExpectedPutFailure = response.url().includes('/api/a2a/component-nodes/') && response.status() === failNextPut;
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
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, workflowSnapshot([...components.values()])));
  await page.route('**/api/a2a/graph-map**', async route => {
    const payload = route.request().postDataJSON() as JsonRecord || {};
    network.graphMapRequests.push({
      method: route.request().method(),
      payload,
    });
    return jsonResponse(route, {
      ok: true,
      revision: network.graphMapRequests.length + 2,
      graph: workflowSnapshot([...components.values()]).graph,
      sourceOfTruth: 'backend',
    });
  });
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, workflowSnapshot([...components.values()]).sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, {
    entries: [{ seq: 1, stream: 'stdout', data: '\r\nM3 terminal fixture ready\r\n' }],
  }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
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
  await page.route('**/api/a2a/nodes/**/config', route => jsonResponse(route, {
    ok: true,
    node: { id: graphNodeId, config: nodeConfig },
    restartRequired: false,
    revision: 2,
  }));
  await page.route('**/api/a2a/nodes/**/restart', route => jsonResponse(route, {
    ok: true,
    nodeId: graphNodeId,
    sessionId: `${sessionId}-restarted`,
    restartRequired: false,
    revision: 3,
  }));
  await page.route('**/api/a2a/component-nodes', async route => {
    const payload = route.request().postDataJSON() as JsonRecord;
    network.componentCreateRequests.push(payload);
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
      nodeId,
      revision: state.revision,
      node: componentNodeSnapshot(state, payload.position || { x: 260, y: 420 }),
      state: backendState,
      sourceOfTruth: 'backend',
    });
  });
  await page.route('**/api/a2a/component-nodes/*', async route => {
    const url = new URL(route.request().url());
    const nodeId = url.pathname.split('/').pop() || '';
    if (route.request().method() === 'GET') {
      return jsonResponse(route, components.get(nodeId) || defaultComponentState('markdown', nodeId));
    }
    if (route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON() as JsonRecord;
      network.componentPutRequests.push({
        method: 'PUT',
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
        nodeId,
        revision: updated.revision,
        state: updated,
        sourceOfTruth: 'backend',
      });
    }
    return jsonResponse(route, { ok: false, message: 'unsupported' }, 405);
  });

  return network;
}

async function openWorkflow(page: Page) {
  await page.goto(`/workflow?token=${encodeURIComponent(token)}`);
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-node').first()).toBeVisible();
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

test.describe('WF UI M3 RED trusted component nodes acceptance', () => {
  test('AC-001 creates Agent, File, Markdown, and Diagram nodes through the unified node picker', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    await expect(page.getByTestId('workflow-component-node-toolbar')).toHaveCount(0);
    await page.getByTestId('workflow-create-node').click();
    const picker = page.getByTestId('workflow-create-node-panel');
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('data-canvas-control', 'true');
    for (const kind of ['agent', 'file', 'markdown', 'diagram']) {
      await expect(picker.locator(`[data-testid="workflow-create-node-option"][data-node-kind="${kind}"]`)).toBeVisible();
    }

    await createComponentNode(page, 'markdown');
    await expect.poll(() => network.componentCreateRequests.length).toBe(1);
    expect(network.componentCreateRequests[0]).toEqual(expect.objectContaining({
      type: 'markdown',
      position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    }));
    await expect(page.getByTestId('workflow-markdown-node-editor')).toBeVisible();

    await createComponentNode(page, 'excalidraw');
    await expect.poll(() => network.componentCreateRequests.length).toBe(2);
    expect(network.componentCreateRequests[1]).toEqual(expect.objectContaining({ type: 'excalidraw' }));
    await expect(page.getByTestId('workflow-excalidraw-node')).toBeVisible();

    await createComponentNode(page, 'file');
    await expect.poll(() => network.componentCreateRequests.length).toBe(3);
    expect(network.componentCreateRequests[2]).toEqual(expect.objectContaining({
      type: 'file',
      file: expect.objectContaining({
        source: 'workspace',
        path: 'package.json',
      }),
    }));
    await expect(page.getByTestId('workflow-file-node')).toBeVisible();
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
    const network = await installWorkflowFixture(page, { initialComponents: [markdownState] });
    await openWorkflow(page);

    await expect(page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`)).toBeVisible();
    await setMarkdownEditorText(page, 'M3 visible editor text');
    await expect(page.getByTestId('workflow-component-node-save')).toBeEnabled();
    await page.getByTestId('workflow-component-node-save').click();
    await expect.poll(() => network.componentPutRequests.length).toBe(1);
    expect(network.componentPutRequests[0]).toEqual(expect.objectContaining({
      method: 'PUT',
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
      elements: [{
        id: 'rect-node-save-e2e',
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
    const network = await installWorkflowFixture(page, { initialComponents: [excalidrawState] });
    await openWorkflow(page);

    const diagram = page.getByTestId('workflow-excalidraw-node');
    await expect(diagram).toBeVisible();
    await expect(diagram).toHaveAttribute('data-node-id', excalidrawNodeId);
    await expect(diagram).toHaveAttribute('data-revision', '1');
    await expect(page.getByTestId('workflow-excalidraw-test-helper-add-rect')).toHaveCount(0);
    await expect(page.locator('[data-testid="workflow-excalidraw-element"][data-element-type="rectangle"]')).toBeVisible();
    await page.getByTestId('workflow-component-node-save').click();

    await expect.poll(() => network.componentPutRequests.length).toBe(1);
    expect(network.componentPutRequests[0]).toEqual(expect.objectContaining({
      method: 'PUT',
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
  });

  test('AC-009 Markdown fullscreen shows loading state, rich editor readiness, and revisioned save', async ({ page }) => {
    test.setTimeout(90_000);
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const network = await installWorkflowFixture(page, { initialComponents: [markdownState] });
    await openWorkflow(page);

    const markdownNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    await markdownNode.getByTestId('workflow-component-node-expand').click();
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
      method: 'PUT',
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

    await diagramNode.getByTestId('workflow-component-node-expand').click();
    const fullscreen = page.getByTestId('workflow-component-fullscreen');
    await expect(fullscreen).toHaveAttribute('data-component-type', 'excalidraw');
    await expect(fullscreen.getByTestId('workflow-fullscreen-loading')).toBeVisible();
    const editor = fullscreen.getByTestId('workflow-excalidraw-fullscreen-editor');
    await expect(editor).toHaveAttribute('data-editor-loaded', 'true', { timeout: 30000 });
    await expect(editor.locator('.excalidraw')).toBeVisible();
    await expect(page.getByTestId('workflow-excalidraw-test-helper-add-rect')).toHaveCount(0);
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
    await markdownNode.getByTestId('workflow-component-node-expand').click();
    await expect(page.getByTestId('workflow-component-fullscreen')).toHaveAttribute('data-component-type', 'markdown');
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
    await diagramNode.getByTestId('workflow-component-node-expand').click();
    await expect(page.getByTestId('workflow-component-fullscreen')).toHaveAttribute('data-component-type', 'excalidraw');
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
    const network = await installWorkflowFixture(page, { initialComponents: [markdownState] });
    await openWorkflow(page);

    const componentNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`).first();
    await expect(componentNode).toBeVisible();
    await expect(componentNode).toHaveAttribute('data-react-flow-node', 'true');
    await expect(componentNode).toHaveAttribute('data-source-of-truth', 'backend');
    await expect(componentNode.locator('[data-testid="workflow-component-node-output"][data-output-id="content"]')).toBeVisible();
    await expect(componentNode.locator('[data-testid="workflow-component-node-input"][data-input-id="selection"]')).toBeVisible();
    await expect(page.locator(`[data-testid="workflow-edge"][data-source="${markdownNodeId}"][data-target="${graphNodeId}"]`)).toBeVisible();

    const sourceHandle = componentNode.locator('[data-testid="workflow-component-node-output"][data-output-id="content"]');
    const targetHandle = agentNode.locator('[data-testid="workflow-agent-node-context-input"]').first();
    await sourceHandle.dragTo(targetHandle);
    await expect.poll(() => network.graphMapRequests.some(request => (
      JSON.stringify(request.payload).includes(markdownNodeId)
      && JSON.stringify(request.payload).includes(graphNodeId)
    ))).toBe(true);
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
    await agentNode.dblclick();
    await expect(page.getByTestId('workflow-node-settings')).toBeVisible();

    const surfaces = [
      page.getByTestId('workflow-explorer-shell'),
      page.getByTestId('workflow-create-node'),
      page.getByTestId('workflow-markdown-node-editor'),
      page.getByTestId('workflow-excalidraw-node'),
      page.getByTestId('workflow-node-settings'),
    ];
    for (const surface of surfaces) {
      await expectInViewport(page, surface);
    }
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);

    await page.setViewportSize({ width: 390, height: 820 });
    await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
    await expect(page.getByTestId('terminal-input-owner')).toBeVisible();
    await expect(page.getByTestId('workflow-node-settings')).toBeVisible();
    await expect(page.getByTestId('workflow-markdown-node-editor')).toBeVisible();
    await expect(page.getByTestId('workflow-excalidraw-node')).toBeVisible();
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
  });

  test('AC-006 bridge label selects or drags on single click and opens the bridge panel only on double-click', async ({ page }) => {
    const markdownState = defaultComponentState('markdown', markdownNodeId);
    const network = await installWorkflowFixture(page, { initialComponents: [markdownState] });
    await openWorkflow(page);

    const label = page.getByTestId('workflow-bridge-label').first();
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
});
