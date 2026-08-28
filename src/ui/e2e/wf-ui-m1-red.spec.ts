import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sessionId = 'e2e-session-m1';
const graphNodeId = 'e2e-node-m1';

type JsonRecord = Record<string, any>;

type HarnessNetwork = {
  workspaceTreeRequests: string[];
  componentCreateRequests: JsonRecord[];
  contextInputRequests: JsonRecord[];
  contextInputOrderingViolations: string[];
  completedUserFileUploads: string[];
  userFileRequests: JsonRecord[];
  terminalInputRequests: JsonRecord[];
  pageErrors: string[];
  failedResponses: string[];
};

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function workflowSnapshot() {
  const control = {
    canReadGraph: true,
    canModifyGraph: true,
    canStart: true,
    canStop: true,
    canDelete: true,
    canOpenTerminal: true,
    canOpenTranscript: true,
    canSendInput: true,
    canCreateAgent: true,
  };
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-m1',
    taskId: 'task-define-workflow-context-surface',
    mode: 'wf-max',
    phase: 'planning-dgate',
    gate: 'TEST-GATE',
    rootAgentId: graphNodeId,
    availableWorkflows: [{ id: 'wf', command: '/wf', label: 'WF' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [{
      sessionId,
      runtime: 'codex',
      role: 'main',
      objective: 'M1 frontend acceptance fixture',
      status: 'running',
      attachMode: true,
      wsClientCount: 1,
      agentKind: 'main',
      workflowMode: 'wf-max',
      cwd: repoRoot,
      graphNodeId,
    }],
    nodes: [{
      id: graphNodeId,
      label: 'M1 Agent',
      kind: 'terminal-session',
      level: 0,
      status: 'running',
      lifecycle: 'live',
      runtimeState: 'running',
      managedByCurrentServer: true,
      control,
      role: 'main',
      skills: ['wf-max'],
      permissions: ['terminal'],
      sessionId,
      taskId: 'task-define-workflow-context-surface',
      agentKind: 'main',
      runtime: 'codex',
      peerId: 'codex',
      objective: 'M1 frontend acceptance fixture',
      cwd: repoRoot,
      graphNodeId,
    }],
    edges: [],
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-m1',
      version: 1,
      nodes: [{
        nodeId: graphNodeId,
        sessionId,
        agentKind: 'main',
        runtime: 'codex',
        status: 'running',
        lifecycle: 'live',
        runtimeState: 'running',
        managedByCurrentServer: true,
        control,
        taskId: 'task-define-workflow-context-surface',
        cwd: repoRoot,
        position: { x: 420, y: 160 },
      }],
      edges: [],
      positions: { [graphNodeId]: { x: 420, y: 160 } },
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
    },
    graphContextBySessionId: {},
  };
}

function runtimeComponentNode(nodeId: string, payload: JsonRecord) {
  const type = String(payload.type || 'file');
  const statePath = `Harness/a2a/component-nodes/${nodeId}/state.json`;
  const title = payload.title || payload.file?.name || 'File Node';
  const state = {
    nodeId,
    type,
    title,
    revision: 1,
    file: payload.file,
    observableInputs: ['file'],
    observableOutputs: ['file', 'path'],
    statePath,
  };
  return {
    ok: true,
    node: {
      nodeId,
      kind: type,
      version: 1,
      lifecycle: 'ready',
      status: { state: 'ready', updatedAt: '2026-08-01T00:00:00.000Z' },
      graph: {
        position: payload.position || { x: 260, y: 420 },
        handles: [
          { id: 'file', role: 'input', type: 'file', label: 'file' },
          { id: 'path', role: 'output', type: 'path', label: 'path' },
        ],
        connections: [],
      },
      stateRef: { path: statePath, revision: 1 },
      contentRef: payload.file,
      settings: { schemaId: `${type}-settings`, values: {}, revision: 0 },
      capabilities: ['state:read', 'state:update'],
      ui: { previewKind: type, settingsPanel: `${type}-settings`, testId: `workflow-${type}-node`, labels: { title } },
    },
    state,
    revision: 1,
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
    src: [
      { name: 'ui', path: 'src/ui', type: 'directory', size: 0, hasChildren: true },
      { name: 'wf-ui-server', path: 'src/wf-ui-server', type: 'directory', size: 0, hasChildren: true },
    ],
    'src/ui': [
      { name: 'src', path: 'src/ui/src', type: 'directory', size: 0, hasChildren: true },
      { name: 'package.json', path: 'src/ui/package.json', type: 'file', size: 820, hasChildren: false },
    ],
    'src/ui/src': [
      { name: 'App.tsx', path: 'src/ui/src/App.tsx', type: 'file', size: 1000, hasChildren: false },
      { name: 'components', path: 'src/ui/src/components', type: 'directory', size: 0, hasChildren: true },
    ],
    Harness: [
      { name: 'tasks', path: 'Harness/tasks', type: 'directory', size: 0, hasChildren: true },
    ],
  };
  return table[normalized] || [];
}

function categoryFor(name: string, mime = '') {
  if (mime.startsWith('image/')) return 'images';
  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'pdf';
  if (/\.(zip|tar|gz|7z)$/i.test(name)) return 'archives';
  if (mime.startsWith('text/') || /\.(txt|md|json)$/i.test(name)) return 'text';
  return 'other';
}

async function installWorkflowFixture(page: Page): Promise<HarnessNetwork> {
  const network: HarnessNetwork = {
    workspaceTreeRequests: [],
    componentCreateRequests: [],
    contextInputRequests: [],
    contextInputOrderingViolations: [],
    completedUserFileUploads: [],
    userFileRequests: [],
    terminalInputRequests: [],
    pageErrors: [],
    failedResponses: [],
  };

  page.on('pageerror', error => network.pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('/favicon.ico')) {
      network.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, {
    taskId: 'task-define-workflow-context-surface',
    phase: 'planning-dgate',
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
    phase: 'planning-dgate',
  }]));
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, workflowSnapshot()));
  await page.route('**/api/a2a/graph-map**', route => jsonResponse(route, { ok: true, revision: 2 }));
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, workflowSnapshot().sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, {
    entries: [{ seq: 1, stream: 'stdout', data: '\r\nM1 terminal fixture ready\r\n' }],
  }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', async route => {
    network.terminalInputRequests.push(route.request().postDataJSON() as JsonRecord);
    await jsonResponse(route, { ok: true });
  });
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
  await page.route('**/api/workspace/ops', async route => {
    const payload = route.request().postDataJSON() as JsonRecord;
    return jsonResponse(route, {
      ok: true,
      opId: `e2e-${payload.op || 'op'}`,
      undoable: true,
      entriesChanged: [payload.source, payload.target].filter(Boolean),
      revision: 3,
    });
  });
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, async route => {
    if (route.request().method() === 'GET') return jsonResponse(route, { ok: true, nodes: [] });
    const payload = route.request().postDataJSON() as JsonRecord;
    network.componentCreateRequests.push(payload);
    const nodeId = `component-file-${network.componentCreateRequests.length}`;
    return jsonResponse(route, runtimeComponentNode(nodeId, payload), 201);
  });
  await page.route(/\/api\/workflow\/nodes\/.+/, route => {
    const nodeId = new URL(route.request().url()).pathname.split('/').filter(Boolean)[3] || 'component-file-1';
    return jsonResponse(route, runtimeComponentNode(nodeId, {
      type: 'file',
      title: 'File Node',
      file: { source: 'workspace', path: 'package.json', name: 'package.json' },
    }));
  });
  await page.route('**/api/a2a/component-nodes', async route => {
    const payload = route.request().postDataJSON() as JsonRecord;
    network.componentCreateRequests.push(payload);
    const nodeId = `component-file-${network.componentCreateRequests.length}`;
    return jsonResponse(route, {
      ok: true,
      nodeId,
      revision: 1,
      node: {
        id: nodeId,
        label: payload.title || payload.file?.name || 'File Node',
        kind: 'component-node',
        componentType: payload.type,
        type: payload.type,
        level: 0,
        status: 'ready',
        lifecycle: 'stateful',
        runtimeState: 'ready',
        managedByCurrentServer: true,
        graphNodeId: nodeId,
        revision: 1,
        statePath: `Harness/a2a/component-nodes/${nodeId}/state.json`,
        observableInputs: ['file'],
        observableOutputs: ['file', 'path'],
      },
      state: {
        nodeId,
        type: payload.type,
        revision: 1,
        file: payload.file,
        observableInputs: ['file'],
        observableOutputs: ['file', 'path'],
      },
    });
  });
  await page.route('**/api/workspace/file**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{"name":"fixture"}',
  }));
  await page.route('**/api/user-files', async route => {
    const payload = route.request().postDataJSON() as JsonRecord;
    network.userFileRequests.push(payload);
    const files = (payload.files || []).map((file: JsonRecord) => {
      const category = categoryFor(file.name, file.mime);
      const savedPath = `Harness/user-files/${category}/${file.name}`;
      return {
        name: file.name,
        path: savedPath,
        terminalTag: `@file(${savedPath})`,
        absolutePath: path.join(repoRoot, savedPath),
      };
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const file of files) network.completedUserFileUploads.push(file.path);
    return jsonResponse(route, { files });
  });
  await page.route('**/api/sessions/**/context-input', async route => {
    const payload = route.request().postDataJSON() as JsonRecord;
    network.contextInputRequests.push(payload);
    const missingUploads = (payload.items || [])
      .map((item: JsonRecord) => String(item.path || ''))
      .filter((itemPath: string) => itemPath.startsWith('Harness/user-files/'))
      .filter((itemPath: string) => !network.completedUserFileUploads.includes(itemPath));
    network.contextInputOrderingViolations.push(...missingUploads);
    const terminalInput = (payload.items || []).map((item: JsonRecord) => {
      if (item.format === 'absolute-path') return path.join(repoRoot, item.path || '');
      if (item.kind === 'workspace-folder') return `@folder(${item.path})`;
      return `@file(${item.path})`;
    }).join(' ');
    return jsonResponse(route, {
      ok: true,
      terminalInput,
      inputOwnerId: payload.inputOwnerId || 'e2e-owner',
    });
  });

  return network;
}

async function openWorkflow(page: Page) {
  await page.goto('/workflow');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-node').first()).toBeVisible();
}

async function expandWorkspacePath(page: Page) {
  for (const relPath of ['src', 'src/ui', 'src/ui/src']) {
    const item = page.locator(`[data-testid="workspace-tree-item"][data-path="${relPath}"]`).first();
    await expect(item).toBeVisible();
    await item.click();
    await item.press('ArrowRight');
  }
}

async function openEmbeddedTerminal(page: Page) {
  await page.getByTestId('workflow-open-terminal').first().click();
  await expect(page.getByTestId('workflow-terminal-attach')).toBeVisible();
}

async function openDrawerTerminal(page: Page) {
  const drawerButton = page.getByTitle(/Open drawer terminal|打开抽屉终端/).first();
  await expect(drawerButton).toBeVisible();
  await drawerButton.click();
  await expect(page.getByTestId('terminal-window')).toBeVisible();
  await expect(page.getByTestId('terminal-output')).toBeVisible();
}

async function dragWorkspaceReference(
  page: Page,
  sourcePath: string,
  kind: 'workspace-file' | 'workspace-folder',
  targetTestId: string,
  shiftKey = false,
) {
  const source = page.locator(`[data-testid="workspace-tree-item"][data-path="${sourcePath}"]`).first();
  const target = page.getByTestId(targetTestId);
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();

  const dataTransfer = await page.evaluateHandle(({ sourcePath: pathValue, kind: itemKind }) => {
    const dt = new DataTransfer();
    dt.setData('application/x-harness-workspace-item', JSON.stringify({ kind: itemKind, path: pathValue }));
    dt.setData('text/plain', pathValue);
    return dt;
  }, { sourcePath, kind });

  await source.dispatchEvent('dragstart', { dataTransfer });
  await target.dispatchEvent('dragenter', { dataTransfer, shiftKey });
  await target.dispatchEvent('dragover', { dataTransfer, shiftKey });
  await target.dispatchEvent('drop', { dataTransfer, shiftKey });
  await dataTransfer.dispose();
}

async function dropExternalFile(page: Page, targetTestId: string, file: { name: string; mime: string; bytes: number[] }) {
  const target = page.getByTestId(targetTestId);
  await expect(target).toBeVisible();
  const dataTransfer = await page.evaluateHandle(({ name, mime, bytes }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], name, { type: mime }));
    return dt;
  }, file);
  await target.dispatchEvent('dragenter', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
  await dataTransfer.dispose();
}

async function pasteImage(page: Page, targetTestId: string) {
  const target = page.getByTestId(targetTestId);
  await expect(target).toBeVisible();
  await target.evaluate((element) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'clipboard-shot.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    element.dispatchEvent(event);
  });
}

async function expectUserFileUpload(
  network: HarnessNetwork,
  expected: { name: string; mime: string; contentBase64: string },
) {
  await expect.poll(() => {
    for (let index = network.userFileRequests.length - 1; index >= 0; index -= 1) {
      const file = (network.userFileRequests[index].files || [])
        .find((entry: JsonRecord) => entry.name === expected.name);
      if (file) {
        return {
          name: file.name,
          mime: file.mime,
          contentBase64: file.contentBase64,
        };
      }
    }
    return null;
  }).toEqual(expect.objectContaining(expected));
}

function expectLastContextInput(
  network: HarnessNetwork,
  expected: { kind: string; path: string; format: string },
) {
  expect(network.contextInputRequests.length, 'expected terminal context-input request').toBeGreaterThan(0);
  const last = network.contextInputRequests.at(-1)!;
  expect(last.items).toEqual(expect.arrayContaining([
    expect.objectContaining(expected),
  ]));
}

test.describe('WF UI M1 RED acceptance', () => {
  test('AC-001 Explorer is default-left, collapsible/floating, lazy, keyboardable, and isolated from canvas drag', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    const explorer = page.getByTestId('workflow-explorer-shell');
    await expect(explorer).toBeVisible();
    await expect(page.getByTestId('workflow-explorer-toggle')).toBeVisible();
    await expect(page.getByTestId('workflow-explorer-float')).toBeVisible();
    await expect(page.getByTestId('workflow-explorer-tree')).toBeVisible();
    expect(network.workspaceTreeRequests).toContain('');

    const srcItem = page.locator('[data-testid="workspace-tree-item"][data-path="src"]').first();
    const packageItem = page.locator('[data-testid="workspace-tree-item"][data-path="package.json"]').first();
    await expect(srcItem).toBeVisible();
    await srcItem.click();
    await srcItem.press('ArrowRight');
    await expect.poll(() => network.workspaceTreeRequests.includes('src')).toBe(true);

    await packageItem.click({ modifiers: ['Control'] });
    await expect(page.locator('[data-testid="workspace-tree-item"][aria-selected="true"]')).toHaveCount(2);
    await expect(page.getByTestId('workspace-preview-panel')).toBeVisible();
    await expect(page.getByTestId('workspace-preview-panel')).toContainText('package.json');
    await page.getByTestId('workspace-preview-insert').click();
    await expect.poll(() => network.componentCreateRequests.length).toBe(1);
    expect(network.componentCreateRequests[0]).toEqual(expect.objectContaining({
      type: 'file',
      file: expect.objectContaining({
        source: 'workspace',
        path: 'package.json',
      }),
    }));

    await srcItem.click({ button: 'right' });
    await expect(page.getByTestId('workspace-context-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await srcItem.press('F2');
    await expect(page.getByTestId('workspace-rename-input')).toBeVisible();

    const nodeBefore = await page.getByTestId('workflow-node').first().boundingBox();
    await explorer.hover();
    await page.mouse.down();
    await page.mouse.move(260, 420);
    await page.mouse.up();
    const nodeAfter = await page.getByTestId('workflow-node').first().boundingBox();
    expect(nodeBefore).not.toBeNull();
    expect(nodeAfter).not.toBeNull();
    expect(Math.abs((nodeAfter!.x) - (nodeBefore!.x))).toBeLessThan(2);

    await page.getByTestId('workflow-explorer-toggle').click();
    await expect(explorer).toHaveAttribute('data-collapsed', 'true');
    await page.getByTestId('workflow-explorer-float').click();
    await expect(explorer).toHaveAttribute('data-floating', 'true');
  });

  test('AC-003 AC-004 workspace file and folder drops insert default @file/@folder tags into drawer and embedded terminals', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);
    await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
    await expandWorkspacePath(page);
    await openEmbeddedTerminal(page);
    await openDrawerTerminal(page);

    await dragWorkspaceReference(page, 'src/ui/src/App.tsx', 'workspace-file', 'terminal-output');
    expectLastContextInput(network, {
      kind: 'workspace-file',
      path: 'src/ui/src/App.tsx',
      format: 'tag',
    });
    await expect(page.getByTestId('terminal-input-owner')).toContainText(/drawer/i);

    await dragWorkspaceReference(page, 'src/ui', 'workspace-folder', 'workflow-terminal-attach');
    expectLastContextInput(network, {
      kind: 'workspace-folder',
      path: 'src/ui',
      format: 'tag',
    });
    await expect(page.getByTestId('terminal-input-owner')).toContainText(/embedded/i);
  });

  test('AC-003 Shift-dragging a workspace item inserts an absolute path instead of a tag', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);
    await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
    await expandWorkspacePath(page);
    await openEmbeddedTerminal(page);

    await dragWorkspaceReference(page, 'src/ui/src/App.tsx', 'workspace-file', 'workflow-terminal-attach', true);

    expectLastContextInput(network, {
      kind: 'workspace-file',
      path: 'src/ui/src/App.tsx',
      format: 'absolute-path',
    });
    await expect(page.getByTestId('terminal-input-owner')).toContainText(/embedded/i);
  });

  test('AC-003 external drop and image paste upload through Harness/user-files and insert terminal refs', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);
    await openEmbeddedTerminal(page);
    await openDrawerTerminal(page);

    await dropExternalFile(page, 'terminal-output', {
      name: 'm1-spec.pdf',
      mime: 'application/pdf',
      bytes: [37, 80, 68, 70],
    });
    await expectUserFileUpload(network, {
      name: 'm1-spec.pdf',
      mime: 'application/pdf',
      contentBase64: 'JVBERg==',
    });
    expect(network.userFileRequests.at(-1)?.files?.[0]).toEqual(expect.objectContaining({
      name: 'm1-spec.pdf',
      mime: 'application/pdf',
      contentBase64: 'JVBERg==',
    }));
    await expect.poll(() => JSON.stringify(network.contextInputRequests.at(-1) || {}))
      .toContain('Harness/user-files/pdf/m1-spec.pdf');
    expect(network.contextInputOrderingViolations).toEqual([]);
    await expect(page.getByTestId('terminal-input-owner')).toContainText(/drawer/i);

    await pasteImage(page, 'workflow-terminal-attach');
    await expectUserFileUpload(network, {
      name: 'clipboard-shot.png',
      mime: 'image/png',
      contentBase64: 'iVBORw==',
    });
    expect(network.userFileRequests.at(-1)?.files?.[0]).toEqual(expect.objectContaining({
      name: 'clipboard-shot.png',
      mime: 'image/png',
      contentBase64: 'iVBORw==',
    }));
    await expect.poll(() => JSON.stringify(network.contextInputRequests.at(-1) || {}))
      .toContain('Harness/user-files/images/clipboard-shot.png');
    expect(network.contextInputOrderingViolations).toEqual([]);
    await expect(page.getByTestId('terminal-input-owner')).toContainText(/embedded/i);
  });

  test('AC-004 existing canvas and terminal controls remain visible, with copy/paste and active-owner coverage', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    await expect(page.getByTestId('workflow-node').first()).toBeVisible();
    await expect(page.getByTestId('workflow-open-terminal').first()).toBeVisible();
    await expect(page.getByTestId('workflow-node-stop').first()).toBeVisible();
    await expect(page.getByTestId('workflow-node-delete').first()).toBeVisible();
    await expect(page.getByTestId('workflow-undo')).toBeVisible();

    await openEmbeddedTerminal(page);
    await openDrawerTerminal(page);
    await expect(page.getByTestId('workflow-terminal-attach')).toBeVisible();
    await expect(page.getByTestId('terminal-output')).toBeVisible();
    await expect(page.getByTestId('terminal-copy-selection')).toBeVisible();
    await expect(page.getByTestId('terminal-paste-clipboard')).toBeVisible();

    await page.getByTestId('terminal-output').click();
    await expect(page.getByTestId('terminal-input-owner')).toHaveAttribute('data-owner-surface', 'drawer');
    await page.getByTestId('workflow-terminal-attach').click();
    await expect(page.getByTestId('terminal-input-owner')).toHaveAttribute('data-owner-surface', 'embedded');

    expect(network.pageErrors).toEqual([]);
    expect(network.failedResponses).toEqual([]);
  });
});
