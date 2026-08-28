import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * WF UI M8 — terminal & explorer UX (task-wf-ui-terminal-explorer-ux).
 *
 * AC mapping:
 *   AC-001 preview panel closes on outside click, survives inside click
 *   AC-002 context menu closes on outside click / Escape, survives inside click
 *   AC-003 New File/New Folder target logic (folder→inside, file→parent),
 *          rename Enter commit, delete via /api/workspace/ops
 *   AC-004 Copy Path + Open in Explorer (POST /api/workspace/reveal payloads)
 *   AC-005 real-file drop uploads via ops create-file (contentBase64); paste
 *          shares uploadFiles — covered by drop (same code path)
 *   AC-006 terminal fullscreen toggle + restore (button and Escape)
 *   AC-007 explorer header drag in float mode moves the panel, clamped to viewport
 *   AC-008 File big view reveal button fires /api/workspace/reveal
 *
 * Fixture model follows m4/m7 with one addition: the workspace tree keeps a
 * mutable extras table so ops-created entries appear in the reloaded tree
 * (rename input for the created file/folder needs them as tree rows).
 * /api/workspace/reveal is always intercepted so the real server never spawns
 * an OS window.
 */

type JsonRecord = Record<string, any>;

const rootKey = '';
const sessionId = 'e2e-session-m8';
const mainNodeId = 'e2e-agent-m8';
const fileNodeId = 'component-file-m8';

type Network = {
  opsRequests: JsonRecord[];
  revealRequests: JsonRecord[];
};

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

// 基础树表（fixture 静态部分）；extrasByDir 由 ops 捕获路由动态维护。
function baseWorkspaceEntries(relPath: string): JsonRecord[] {
  const table: Record<string, JsonRecord[]> = {
    [rootKey]: [
      { name: 'src', path: 'src', type: 'directory', size: 0, hasChildren: true },
      { name: 'package.json', path: 'package.json', type: 'file', size: 512, hasChildren: false },
    ],
    src: [
      { name: 'App.tsx', path: 'src/App.tsx', type: 'file', size: 120, hasChildren: false },
      { name: 'util.ts', path: 'src/util.ts', type: 'file', size: 88, hasChildren: false },
    ],
  };
  return table[relPath] || [];
}

async function installWorkflowFixture(page: Page): Promise<Network> {
  const network: Network = { opsRequests: [], revealRequests: [] };
  const extrasByDir: Record<string, JsonRecord[]> = {};
  const renameMap = new Map<string, string>(); // old path -> new path（供重命名后树刷新）

  const entriesFor = (relPath: string) => {
    const base = baseWorkspaceEntries(relPath).filter(entry => !renameMap.has(entry.path));
    const movedIn = [...renameMap.entries()]
      .filter(([, target]) => target.startsWith(relPath === rootKey ? '' : `${relPath}/`) && target.split('/').length === (relPath ? relPath.split('/').length + 1 : 1))
      .map(([, target]) => {
        const name = target.split('/').pop()!;
        return { name, path: target, type: target in extrasByDir ? 'directory' : 'file', size: 10, hasChildren: target in extrasByDir };
      });
    return [...base, ...(extrasByDir[relPath] || []), ...movedIn];
  };

  await page.route('**/api/settings**', route => jsonResponse(route, { language: 'en', theme: 'system' }));
  await page.route(/\/(?:api\/sessions\?all=1|api\/sessions)$/, route => jsonResponse(route, [
    {
      sessionId,
      nodeId: mainNodeId,
      peerId: sessionId,
      runtime: 'codex',
      status: 'running',
      kind: 'terminal-session',
      lifecycle: 'live',
      runtimeState: 'running',
      displayName: 'M8 Agent',
    },
  ]));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/stop', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, { entries: [{ seq: 1, stream: 'stdout', data: '\r\nM8 terminal ready\r\n' }] }));

  // 快照端点：主 Agent 节点（terminal-session）+ file 组件节点。画布从
  // /api/a2a/snapshot 取数（graph-map 路由仅提供写路径兼容）。
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, m8Snapshot(fileNodeId)));
  await page.route('**/api/a2a/graph-map**', route => jsonResponse(route, {
    ok: true,
    revision: 1,
    graph: m8Snapshot(fileNodeId).graph,
    sourceOfTruth: 'backend',
  }));
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, route => {
    if (route.request().method() !== 'GET') return jsonResponse(route, { ok: true }, 201);
    return jsonResponse(route, {
      ok: true,
      nodes: [
        {
          nodeId: mainNodeId,
          kind: 'terminal-session',
          kindLabel: 'Agent',
          graphNodeId: mainNodeId,
          sessionId,
          runtime: 'codex',
          status: 'running',
          lifecycle: 'live',
          runtimeState: 'running',
          version: 1,
          graph: { position: { x: 320, y: 180 }, handles: { inputs: [], outputs: [], bidirectional: [] } },
          control: { canReadGraph: true, canModifyGraph: true, canStart: true, canStop: true, canDelete: true, canOpenTerminal: true, canSendInput: true, canCreateAgent: true },
        },
        {
          nodeId: fileNodeId,
          kind: 'file',
          graphNodeId: fileNodeId,
          sessionId: null,
          status: 'ready',
          lifecycle: 'ready',
          runtimeState: 'ready',
          version: 1,
          graph: { position: { x: 660, y: 180 }, handles: { inputs: ['file'], outputs: ['file', 'path'], bidirectional: [] } },
          control: { canReadGraph: true, canModifyGraph: true, canStart: true, canStop: true, canDelete: true, canOpenTerminal: false, canSendInput: false, canCreateAgent: true },
        },
      ],
    });
  });
  await page.route(/\/api\/workflow\/nodes\/[^/]+\/state/, route => {
    const nodeId = new URL(route.request().url()).pathname.split('/').filter(Boolean)[3];
    return jsonResponse(route, { ok: true, result: { ok: true, nodeId, revision: 1 } });
  });
  await page.route(/\/api\/workflow\/nodes\/[^/]+\/actions\/.+/, route => {
    const parts = new URL(route.request().url()).pathname.split('/').filter(Boolean);
    const action = decodeURIComponent(parts.slice(5).join('/'));
    if (action === 'file.meta') {
      return jsonResponse(route, { ok: true, result: { file: { path: 'src/App.tsx', name: 'App.tsx', mime: 'text/plain', size: 120, exists: true } } });
    }
    if (action === 'file.preview') {
      return jsonResponse(route, { ok: true, result: { path: 'src/App.tsx', previewKind: 'text', mime: 'text/plain', size: 120 } });
    }
    if (action === 'file.readText') return jsonResponse(route, { ok: true, result: { text: 'export const m8 = 1;', bytesRead: 20, truncated: false } });
    if (action === 'file.writeText') return jsonResponse(route, { ok: true, result: { ok: true, path: 'src/App.tsx', bytes: 8, revision: 2 } });
    if (action === 'file.refresh') return jsonResponse(route, { ok: true, result: { ok: true } });
    if (action === 'node.delete') return jsonResponse(route, { ok: true, result: { ok: true } });
    return jsonResponse(route, { ok: true, result: { ok: true } });
  });
  await page.route(/\/(?:api\/workflow\/edges|api\/workflow\/graph\?.*)$/, route => jsonResponse(route, { ok: true, nodes: [], edges: [] }));

  // Workspace tree（动态：新创建/重命名的条目会出现在刷新后的树里）。
  await page.route('**/api/workspace/tree**', route => {
    const url = new URL(route.request().url());
    const rel = (url.searchParams.get('path') || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return jsonResponse(route, { root: '/repo', path: rel, entries: entriesFor(rel) });
  });
  await page.route('**/api/workspace/meta**', route => jsonResponse(route, { ok: true, path: '', name: 'm8', type: 'file', exists: true, size: 120, mime: 'text/plain', previewKind: 'text' }));
  await page.route('**/api/workspace/text**', route => jsonResponse(route, { text: '// m8 preview', bytesRead: 13, truncated: false }));
  await page.route('**/api/workspace/file**', route => jsonResponse(route, { name: 'm8' }));

  // Workspace mutation + reveal capture（永不打到真实服务端）。
  await page.route('**/api/workspace/ops', async route => {
    const payload = route.request().postDataJSON() as JsonRecord;
    network.opsRequests.push(payload);
    const op = String(payload.op || '');
    const target = String(payload.target || '');
    const source = String(payload.source || '');
    const parentOf = (pathValue: string) => {
      const index = pathValue.lastIndexOf('/');
      return index <= 0 ? rootKey : pathValue.slice(0, index);
    };
    if (op === 'create-file' || op === 'create-folder') {
      const dir = parentOf(target);
      extrasByDir[dir] = extrasByDir[dir] || [];
      extrasByDir[dir] = extrasByDir[dir].filter(entry => entry.path !== target);
      extrasByDir[dir].push({ name: target.split('/').pop(), path: target, type: op === 'create-folder' ? 'directory' : 'file', size: 0, hasChildren: op === 'create-folder' });
    } else if (op === 'rename' || op === 'move') {
      renameMap.set(source, target);
      const dir = parentOf(target);
      extrasByDir[dir] = (extrasByDir[dir] || []).filter(entry => entry.path !== source);
    } else if (op === 'delete') {
      // 静态条目删除：后续 entriesFor 过滤（movedOut 记录）。
      extrasByDir[parentOf(source)] = (extrasByDir[parentOf(source)] || []).filter(entry => entry.path !== source);
    }
    return jsonResponse(route, { ok: true, opId: `op-${network.opsRequests.length}`, revision: network.opsRequests.length, op: payload.op, undoable: true, entriesChanged: [] });
  });
  await page.route('**/api/workspace/reveal', async route => {
    const payload = route.request().postDataJSON() as JsonRecord;
    network.revealRequests.push(payload);
    return jsonResponse(route, { ok: true, path: payload.path, isDirectory: false, platform: 'test' });
  });

  return network;
}

function m8Snapshot(fileId: string): JsonRecord {
  const mainNode = {
    id: mainNodeId,
    label: 'M8 Agent',
    kind: 'terminal-session',
    level: 0,
    status: 'running',
    lifecycle: 'live',
    runtimeState: 'running',
    managedByCurrentServer: true,
    control: { canReadGraph: true, canModifyGraph: true, canStart: true, canStop: true, canDelete: true, canOpenTerminal: true, canSendInput: true, canCreateAgent: true },
    runtime: 'codex',
    role: 'main',
    agentKind: 'main',
    sessionId,
    graphNodeId: mainNodeId,
    skills: [],
    permissions: ['terminal'],
    position: { x: 320, y: 180 },
  };
  const fileNode = {
    id: fileId,
    label: 'M8 App.tsx',
    kind: 'component-node',
    componentType: 'file',
    type: 'file',
    level: 0,
    status: 'ready',
    lifecycle: 'stateful',
    runtimeState: 'ready',
    managedByCurrentServer: true,
    control: { canReadGraph: true, canModifyGraph: true, canStart: true, canStop: true, canDelete: true, canOpenTerminal: false, canSendInput: false, canCreateAgent: true },
    graphNodeId: fileId,
    revision: 1,
    statePath: `Harness/a2a/component-nodes/${fileId}/state.json`,
    observableInputs: ['file'],
    observableOutputs: ['file', 'path'],
    position: { x: 660, y: 180 },
  };
  const nodes = [mainNode, fileNode];
  const graph = {
    rows: nodes,
    edges: [],
    nodes,
    positions: { [mainNodeId]: { x: 320, y: 180 }, [fileId]: { x: 660, y: 180 } },
    version: 1,
    graphContextPath: 'Harness/a2a/workflow-map.json',
    sourceOfTruth: 'backend',
    undoStack: [],
    redoStack: [],
  };
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-m8',
    taskId: 'task-wf-ui-terminal-explorer-ux',
    mode: 'wf-max',
    phase: 'm8',
    gate: 'AC',
    rootAgentId: mainNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [
      { sessionId, runtime: 'codex', role: 'main', status: 'running', attachMode: true, graphNodeId: mainNodeId, cwd: '/repo' },
    ],
    nodes,
    edges: [],
    graph,
    fingerprint: 'm8-fixture-v1',
  };
}

async function openWorkflow(page: Page) {
  await page.goto('/workflow');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-wf-browser-ready', 'true');
}

async function openPreviewFor(page: Page, pathValue: string) {
  await page.locator(`[data-testid="workspace-tree-item"][data-path="${pathValue}"]`).first().click();
  await expect(page.getByTestId('workspace-preview-panel')).toBeVisible();
}

async function openContextMenuFor(page: Page, pathValue: string) {
  await page.locator(`[data-testid="workspace-tree-item"][data-path="${pathValue}"]`).first().click({ button: 'right' });
  const menu = page.getByTestId('workspace-context-menu');
  await expect(menu).toBeVisible();
  return menu;
}

test.describe('WF UI M8 terminal & explorer UX (AC-001..AC-008)', () => {
  test('AC-001 preview closes on outside click but survives clicks inside itself', async ({ page }) => {
    await installWorkflowFixture(page);
    await openWorkflow(page);

    await openPreviewFor(page, 'package.json');
    await page.getByTestId('workspace-preview-panel').locator('.workspace-preview-header').click();
    await expect(page.getByTestId('workspace-preview-panel')).toBeVisible();

    // 点击预览外部（Explorer 标题区）→ 关闭；目录点击同样不弹文件预览。
    await page.locator('.workflow-explorer-title').click();
    await expect(page.getByTestId('workspace-preview-panel')).toHaveCount(0);

    await openPreviewFor(page, 'package.json');
    await page.locator('[data-testid="workspace-tree-item"][data-path="src"]').first().click();
    await expect(page.getByTestId('workspace-preview-panel')).toHaveCount(0);
  });

  test('AC-002 context menu closes on outside click and Escape, stays open on inside click', async ({ page }) => {
    await installWorkflowFixture(page);
    await openWorkflow(page);

    const menu = await openContextMenuFor(page, 'src');

    // 菜单内点击（padding 空白处，不命中任何按钮）不关闭。
    await menu.click({ position: { x: 4, y: 4 } });
    await expect(menu).toBeVisible();

    // 菜单外点击 → 关闭。
    await page.getByTestId('workflow-canvas').click({ position: { x: 420, y: 420 } });
    await expect(menu).toHaveCount(0);

    // Esc 兜底。
    await openContextMenuFor(page, 'src');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('workspace-context-menu')).toHaveCount(0);
  });

  test('AC-003 New File/New Folder target the right-clicked folder; rename commits; delete via ops', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    // 右键文件夹 src → New File 建在 src/ 内，并进入重命名态。
    await (await openContextMenuFor(page, 'src')).getByTestId('workspace-context-new-file').click();
    await expect(page.getByTestId('workspace-context-menu')).toHaveCount(0);
    await expect(page.getByTestId('workspace-rename-input')).toBeVisible();
    expect(network.opsRequests[0].op).toBe('create-file');
    expect(network.opsRequests[0].target).toBe('src/file-1.txt');

    const renameInput = page.getByTestId('workspace-rename-input');
    await renameInput.fill('real-new.md');
    await renameInput.press('Enter');
    expect(network.opsRequests.some(request => request.op === 'rename' && request.source === 'src/file-1.txt' && request.target === 'src/real-new.md')).toBe(true);
    await expect(page.getByTestId('workspace-rename-input')).toHaveCount(0);

    // 右键文件 package.json → New Folder 建在其父目录（根）。
    await (await openContextMenuFor(page, 'package.json')).getByTestId('workspace-context-new-folder').click();
    const folderOp = network.opsRequests.find(request => request.op === 'create-folder');
    expect(folderOp?.target).toBe('New Folder');

    // Delete 走 ops delete。
    await (await openContextMenuFor(page, 'src/util.ts')).getByTestId('workspace-context-delete').click();
    const deleteOp = network.opsRequests.find(request => request.op === 'delete');
    expect(deleteOp?.source).toBe('src/util.ts');
    await expect(page.getByTestId('workspace-context-menu')).toHaveCount(0);
  });

  test('AC-004 context menu Open in Explorer and Copy Path behave correctly', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    await page.locator('[data-testid="workspace-tree-item"][data-path="src"]').first().click();
    await (await openContextMenuFor(page, 'src/util.ts')).getByTestId('workspace-context-reveal').click();
    await expect.poll(() => network.revealRequests.length).toBe(1);
    expect(network.revealRequests[0].path).toBe('src/util.ts');
    await expect(page.getByTestId('workspace-context-menu')).toHaveCount(0);

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await (await openContextMenuFor(page, 'package.json')).getByTestId('workspace-context-copy-path').click();
    await expect(page.getByTestId('workspace-context-menu')).toHaveCount(0);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('package.json');
  });

  test('AC-005 dropping a real file uploads it as create-file into the hovered folder', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    await page.locator('[data-testid="workspace-tree-item"][data-path="src"]').first().click();

    await page.getByTestId('workflow-explorer-shell').evaluate((shell) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['hello m8'], 'dropped.txt', { type: 'text/plain' }));
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      const target = shell.querySelector('[data-testid="workspace-tree-item"][data-path="src"]');
      target?.dispatchEvent(event);
    });

    await expect.poll(() => network.opsRequests.some(request => request.op === 'create-file' && request.target === 'src/dropped.txt')).toBe(true);
    const createOp = network.opsRequests.find(request => request.op === 'create-file');
    expect(createOp?.contentBase64).toBe('aGVsbG8gbTg='); // "hello m8"
  });

  test('AC-006 terminal fullscreen toggles, hides resize handle, restores via Escape', async ({ page }) => {
    await installWorkflowFixture(page);
    await openWorkflow(page);

    const node = page.locator(`[data-testid="workflow-node"][data-node-id="${mainNodeId}"]`).first();
    await expect(node).toBeVisible();
    await node.dblclick();
    const window = page.getByTestId('terminal-window');
    await expect(window).toBeVisible();
    // 等挂载 scale 动画结束再取基准矩形（动画中 boundingBox 会缩放）。
    await page.waitForTimeout(600);

    const before = await window.boundingBox();
    await page.getByTestId('terminal-fullscreen-toggle').click();
    await expect(window).toHaveAttribute('data-fullscreen', 'true');
    await expect(page.getByTestId('terminal-resize-handle')).toBeHidden();
    const full = await window.boundingBox();
    expect(full!.width).toBeGreaterThan(before!.width + 200);

    await page.keyboard.press('Escape');
    await expect(window).toHaveAttribute('data-fullscreen', 'false');
    const restored = await window.boundingBox();
    expect(Math.abs(restored!.width - before!.width)).toBeLessThan(4);
  });

  test('AC-007 explorer header drag moves the floating panel and clamps to viewport', async ({ page }) => {
    await installWorkflowFixture(page);
    await openWorkflow(page);

    const shell = page.getByTestId('workflow-explorer-shell');
    await shell.getByTestId('workflow-explorer-float').click();
    await expect(shell).toHaveAttribute('data-floating', 'true');

    const header = shell.locator('.workflow-explorer-header');
    const initial = await shell.boundingBox();
    const headerBox = await header.boundingBox();
    const startX = headerBox!.x + headerBox!.width / 2;
    const startY = headerBox!.y + headerBox!.height / 2;
    await header.hover();
    await page.mouse.down();
    await page.mouse.move(startX + 160, startY + 120, { steps: 5 });
    await page.mouse.up();

    const moved = await shell.boundingBox();
    expect(moved!.x).toBeGreaterThan(initial!.x + 60);
    expect(moved!.y).toBeGreaterThan(initial!.y + 40);

    // 拖向视口左上极端不回溢出（钳制在视口内）。
    await header.hover();
    await page.mouse.down();
    await page.mouse.move(2, 2, { steps: 12 });
    await page.mouse.up();
    const clamped = await shell.boundingBox();
    expect(clamped!.x).toBeGreaterThanOrEqual(0);
    expect(clamped!.y).toBeGreaterThanOrEqual(0);
  });

  test('AC-008 File big view reveal button fires /api/workspace/reveal with the bound path', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    const fileCard = page.locator(`[data-testid="workflow-component-node"][data-node-id="${fileNodeId}"]`).first();
    await expect(fileCard).toBeVisible();
    await fileCard.dblclick();

    const bigView = page.getByTestId('workflow-file-big-view');
    await expect(bigView).toBeVisible();
    await expect(bigView).toHaveAttribute('data-file-kind', 'text');

    await bigView.getByTestId('workflow-file-big-view-reveal').click();
    await expect.poll(() => network.revealRequests.length).toBe(1);
    expect(network.revealRequests[0].path).toBe('src/App.tsx');
  });
});