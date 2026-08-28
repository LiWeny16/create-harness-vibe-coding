import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * WF UI M7 — Markdown rendering upgrade (task-upgrade-markdown-node-rendering).
 *
 * AC-linked Playwright e2e, RED-first: the implementation is NOT landed yet, so
 * every test touching a NEW surface below must fail on a MISSING ELEMENT, never
 * on a fixture/syntax error. The base flows (fixture, canvas, fullscreen mdx
 * editor, file big view, TaskList) are taken from the existing m3/m4 specs and
 * must keep passing their regression assertions.
 *
 * TESTID CONTRACT (implementation will land these):
 *   markdown-mermaid-pending, markdown-mermaid-svg,
 *   markdown-mermaid-fallback, markdown-mermaid-error
 *   workflow-markdown-preview-toggle, workflow-markdown-preview-content
 *   workflow-markdown-fullscreen-preview-tab, workflow-markdown-fullscreen-preview-content
 *
 * CDN interception: any cdn.jsdelivr.net URL (glob "cdn.jsdelivr.net") is
 * fulfilled with the REAL mermaid bundle from the pnpm store:
 *   src/ui/node_modules/.pnpm/mermaid@11.16.0/node_modules/mermaid/dist/mermaid.min.js
 * (verified present, 3.5 MB). A CORS header is added because the loader is
 * expected to inject the script with crossorigin + SRI integrity, which makes
 * the fetch CORS-mode. If the file is ever missing the suite degrades to a
 * minimal stub (mermaidIsStub = true) — re-verify with the real file after the
 * implementation lands.
 */

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const specDir = path.dirname(fileURLToPath(import.meta.url));

const sessionId = 'e2e-session-m7';
const graphNodeId = 'e2e-agent-m7';
const markdownNodeAId = 'component-markdown-m7-a';
const markdownNodeBId = 'component-markdown-m7-b';
const fileNodeId = 'component-file-m7-md';
const taskListTaskId = 'task-m7-e2e';

type JsonRecord = Record<string, any>;
type ComponentType = 'markdown' | 'file';

type ComponentState = {
  nodeId: string;
  type: ComponentType;
  title: string;
  revision: number;
  markdown?: string;
  file?: { source: 'workspace' | 'user-file'; path: string; name?: string; mime?: string; size?: number };
  observableInputs: string[];
  observableOutputs: string[];
  statePath: string;
};

type HarnessNetwork = {
  componentPutRequests: JsonRecord[];
  fileActionRequests: JsonRecord[];
  pageErrors: string[];
  failedResponses: string[];
};

/* ---------------------------------------------------------------------------
 * Mermaid CDN interception (AC-001/002/003 共用)
 * ------------------------------------------------------------------------- */

const MERMAID_REAL = path.resolve(
  specDir,
  '..',
  'node_modules',
  '.pnpm',
  'mermaid@11.16.0',
  'node_modules',
  'mermaid',
  'dist',
  'mermaid.min.js',
);

const MERMAID_STUB_BODY = [
  'window.mermaid = {',
  '  initialize() {},',
  '  render(id) { return Promise.resolve({ svg: \'<svg id="\' + id + \'"><text>stub</text></svg>\' }); }',
  '};',
].join('\n');

let mermaidIsStub = false;
let MERMAID_BODY: Buffer;
try {
  MERMAID_BODY = fs.readFileSync(MERMAID_REAL);
} catch {
  mermaidIsStub = true;
  MERMAID_BODY = Buffer.from(MERMAID_STUB_BODY, 'utf8');
}

async function installMermaidCdnFulfill(page: Page): Promise<{ cdnRequests: string[] }> {
  const cdnRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('cdn.jsdelivr.net')) cdnRequests.push(request.url());
  });
  await page.route('**/cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    // crossorigin + SRI on the injected <script> turns the fetch into CORS mode.
    headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' },
    body: MERMAID_BODY,
  }));
  return { cdnRequests };
}

async function installMermaidCdnAbort(page: Page): Promise<{ cdnRequests: string[] }> {
  const cdnRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('cdn.jsdelivr.net')) cdnRequests.push(request.url());
  });
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort('failed'));
  return { cdnRequests };
}

/**
 * 断言共享 MarkdownPreview 已把 mermaid 块渲染成 SVG（真文件渲染时校验图内文本）。
 * 纯文本内容断言：容器 textContent 必须含节点 label 词。不依赖 label 的载体结构
 * （<text>/<tspan> 或 foreignObject <span>）——DOMPurify svg profile 会剥掉
 * foreignObject HTML，结构定位断言在净化链下不可靠。fixture 的 label 词
 * （Start/Finish/F1/F2/T1/T2/Safe）均为专属词，不会出现在 mermaid <style>
 * 的 CSS 类名/字体名里，contains 语义无假阳性。
 */
async function expectMermaidSvgRendered(scope: Locator, expectedLabelText: string) {
  const container = scope.getByTestId('markdown-mermaid-svg');
  await expect(container).toBeVisible();
  // 必须是真正的 SVG 图（而非文字化兜底）。
  await expect(container.locator('svg')).toBeVisible();
  await expect(container).toContainText(mermaidIsStub ? 'stub' : expectedLabelText);
}

/* ---------------------------------------------------------------------------
 * Markdown / File 内容 fixture
 * ------------------------------------------------------------------------- */

const MD_PLAIN = '# M7 Notes\n\nNo diagram in this document.';
const MD_TABLE_AND_CODE = [
  '# M7 Card',
  '',
  '| K | V |',
  '| --- | --- |',
  '| M7-Card-A | M7-Card-B |',
  '',
  '```js',
  'const m7 = 1;',
  '```',
].join('\n');
const MD_MERMAID = [
  '# M7 Graph',
  '',
  '```mermaid',
  'graph TD',
  '    A[Start] --> B[Finish]',
  '```',
].join('\n');
const MD_MERMAID_TABLE = [
  '# M7 Fullscreen',
  '',
  '| Name | Value |',
  '| --- | --- |',
  '| M7-Table-A | M7-Table-B |',
  '',
  '```mermaid',
  'graph TD',
  '    A[Start] --> B[Finish]',
  '```',
].join('\n');
const MD_SECURITY = [
  '# M7 Security',
  '',
  '```mermaid',
  '%%{init:{"securityLevel":"loose"}}%%',
  'graph TD',
  '    A["<img src=x onerror=window.__pwned=1>"] --> B[Safe]',
  '```',
].join('\n');
const MD_BIG_VIEW = [
  '# M7 Big View',
  '',
  '| Name | Value |',
  '| --- | --- |',
  '| M7-Md-Table-A | M7-Md-Table-B |',
  '',
  '```mermaid',
  'graph TD',
  '    F1 --> F2',
  '```',
].join('\n');
const MD_TASK_PLAN = [
  '# M7 Task Plan',
  '',
  '| Item | Owner |',
  '| --- | --- |',
  '| M7-Task-Table-A | M7-Task-Table-B |',
  '',
  '```mermaid',
  'graph LR',
  '    T1 --> T2',
  '```',
].join('\n');

/* ---------------------------------------------------------------------------
 * Fixture（沿用 m3/m4 spec 的后端 mock 模式；本仓库每个 spec 自带 fixture，
 * 不修改既有 spec，也不新增任何服务端。）
 * ------------------------------------------------------------------------- */

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
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
  return type === 'markdown' ? ['markdown'] : ['file'];
}

function observableOutputsForType(type: ComponentType) {
  return type === 'markdown' ? ['markdown', 'plainText'] : ['file', 'path'];
}

function defaultComponentState(type: ComponentType, nodeId: string, overrides: Partial<ComponentState> = {}): ComponentState {
  return {
    nodeId,
    type,
    title: type === 'markdown' ? 'M7 Notes' : 'M7 Markdown File',
    revision: 1,
    markdown: type === 'markdown' ? MD_PLAIN : undefined,
    file: type === 'file'
      ? { source: 'workspace', path: 'README.md', name: 'README.md', mime: 'text/markdown', size: 520 }
      : undefined,
    observableInputs: observableInputsForType(type),
    observableOutputs: observableOutputsForType(type),
    statePath: `Harness/a2a/component-nodes/${nodeId}/state.json`,
    ...overrides,
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

function runtimeNodeSnapshot(state: ComponentState, position: { x: number; y: number }) {
  const primaryPort = state.type === 'markdown' ? 'markdown' : 'file';
  const handles = state.type === 'markdown'
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

function workflowSnapshot(components: ComponentState[]) {
  const componentNodes = components.map((state, index) => componentNodeSnapshot(state, {
    x: 260 + (index * 380),
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
    stateRef: { path: node.statePath, revision: node.revision },
  }));
  const componentStateRefs = Object.fromEntries(components.map(state => [state.nodeId, {
    type: state.type,
    title: state.title,
    statePath: state.statePath,
    revision: state.revision,
    ...(state.file ? { file: state.file } : {}),
  }]));
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-m7',
    taskId: 'task-upgrade-markdown-node-rendering',
    mode: 'wf-standard',
    phase: 'm7-red',
    gate: 'TEST-GATE',
    rootAgentId: graphNodeId,
    availableWorkflows: [{ id: 'wf-standard', command: '/wf', label: 'WF' }],
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
      workflowMode: 'wf-standard',
      cwd: nodeConfig.cwd,
      graphNodeId,
      config: nodeConfig,
      inputOwnerId: 'drawer',
    }],
    nodes: [{
      id: graphNodeId,
      label: 'M7 Agent',
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
      taskId: 'task-upgrade-markdown-node-rendering',
      agentKind: nodeConfig.role,
      runtime: 'codex',
      peerId: 'codex',
      objective: nodeConfig.prompt,
      cwd: nodeConfig.cwd,
      graphNodeId,
      config: nodeConfig,
    }, ...componentNodes],
    edges: [],
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-m7',
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
        taskId: 'task-upgrade-markdown-node-rendering',
        cwd: repoRoot,
        position: { x: 620, y: 180 },
        config: nodeConfig,
      }, ...graphComponentNodes],
      edges: [],
      capsuleDockLinks: [],
      positions: {
        [graphNodeId]: { x: 620, y: 180 },
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

const fileFixtures: Record<string, { meta: JsonRecord; preview: JsonRecord }> = {
  [fileNodeId]: {
    meta: { file: { source: 'workspace', path: 'README.md', name: 'README.md', mime: 'text/markdown', size: 520, exists: true } },
    preview: { path: 'README.md', previewKind: 'text', mime: 'text/markdown' },
  },
};

async function installWorkflowFixture(
  page: Page,
  options: { initialComponents?: ComponentState[]; taskList?: { active: JsonRecord[]; files: Record<string, string> } } = {},
): Promise<HarnessNetwork> {
  const network: HarnessNetwork = {
    componentPutRequests: [],
    fileActionRequests: [],
    pageErrors: [],
    failedResponses: [],
  };
  const components = new Map<string, ComponentState>();
  for (const state of options.initialComponents || []) {
    components.set(state.nodeId, { ...state });
  }
  const savedFileTexts: Record<string, string> = { [fileNodeId]: MD_BIG_VIEW };

  page.on('pageerror', error => network.pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('/favicon.ico')) {
      network.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, {
    taskId: 'task-upgrade-markdown-node-rendering',
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

  if (options.taskList) {
    // AC-005: TaskList 页面（/）的 task 列表 + 文件内容（STATE.json / PLAN.md）。
    await page.route('**/api/tasks', route => jsonResponse(route, options.taskList!.active));
    await page.route('**/api/tasks/archived', route => jsonResponse(route, []));
    await page.route('**/api/tasks/*/file/*', route => {
      const parts = new URL(route.request().url()).pathname.split('/').filter(Boolean);
      const filename = parts[parts.length - 1] || '';
      return jsonResponse(route, {
        filename,
        content: options.taskList!.files[filename] || '(file not found)',
      });
    });
  } else {
    await page.route('**/api/tasks**', route => jsonResponse(route, [{
      taskId: 'task-upgrade-markdown-node-rendering',
      status: 'open',
      phase: 'm7-red',
    }]));
  }

  const currentSnapshot = () => workflowSnapshot([...components.values()]);
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, currentSnapshot()));
  await page.route('**/api/a2a/graph-map**', route => {
    const snapshot = currentSnapshot();
    return jsonResponse(route, {
      ok: true,
      revision: 1,
      graph: snapshot.graph,
      sourceOfTruth: 'backend',
    });
  });
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, currentSnapshot().sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, {
    entries: [{ seq: 1, stream: 'stdout', data: '\r\nM7 terminal fixture ready\r\n' }],
  }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/stop', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  // 画布对可启动的主 Agent 节点会走 auto-start（/api/a2a/nodes/:id/start）；
  // 未拦截时打到真实服务端并返回 501 噪音。注册在最前：更具体
  // 的 /config 与 /restart 路由在其后注册仍会优先命中自己的 URL。
  await page.route('**/api/a2a/nodes/**', route => jsonResponse(route, {
    ok: true,
    started: { sessionId, runtime: 'codex', status: 'running', kind: 'terminal-session', nodeId: graphNodeId },
  }));
  await page.route('**/api/a2a/nodes/**/config', route => jsonResponse(route, {
    ok: true,
    node: { id: graphNodeId, config: nodeConfig },
    restartRequired: false,
    revision: 2,
  }));
  await page.route('**/api/a2a/nodes/**/restart', route => jsonResponse(route, {
    ok: true,
    nodeId: graphNodeId,
    revision: 3,
  }));
  await page.route('**/api/workspace/tree**', route => jsonResponse(route, {
    root: repoRoot,
    path: new URL(route.request().url()).searchParams.get('path') || '',
    entries: [],
  }));
  await page.route('**/api/workspace/meta**', route => jsonResponse(route, {
    ok: true,
    path: new URL(route.request().url()).searchParams.get('path') || '',
    type: 'file',
    exists: true,
    size: 520,
    mime: 'text/markdown',
  }));
  await page.route('**/api/workspace/text**', route => jsonResponse(route, {
    text: MD_BIG_VIEW,
    bytesRead: MD_BIG_VIEW.length,
    truncated: false,
    encoding: 'utf-8',
  }));
  await page.route('**/api/workspace/file**', route => route.fulfill({
    status: 200,
    contentType: 'text/markdown',
    body: MD_BIG_VIEW,
  }));
  await page.route('**/api/user-files', route => jsonResponse(route, { ok: true, files: [] }));
  await page.route(/\/api\/workflow\/edges(?:\?.*)?$/, route => jsonResponse(route, {
    ok: true,
    edge: {
      id: 'edge-m7-stub',
      from: 'a',
      to: 'b',
      relation: 'wf-bridge',
      direction: 'bidirectional',
    },
  }, 201));
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, route => {
    if (route.request().method() === 'GET') {
      return jsonResponse(route, {
        ok: true,
        nodes: [...components.values()].map(state => runtimeNodeSnapshot(state, { x: 260, y: 420 })),
      });
    }
    const payload = route.request().postDataJSON() as JsonRecord;
    const type = payload.type as ComponentType;
    const nodeId = type === 'markdown'
      ? `component-markdown-${network.componentPutRequests.length}`
      : `component-file-${network.componentPutRequests.length}`;
    const state = defaultComponentState(type, nodeId);
    state.title = payload.title || state.title;
    if (payload.file) state.file = payload.file;
    if (payload.markdown) state.markdown = payload.markdown;
    components.set(nodeId, state);
    return jsonResponse(route, {
      ok: true,
      node: runtimeNodeSnapshot(state, payload.position || { x: 260, y: 420 }),
      state,
      revision: state.revision,
    }, 201);
  });

  // 节点级 route（GET / PATCH state）。actions 路由在其后注册，Playwright 逆序匹配，actions 优先。
  await page.route(/\/api\/workflow\/nodes\/.+/, async route => {
    const parts = new URL(route.request().url()).pathname.split('/').filter(Boolean);
    const nodeId = parts[3] || '';
    if (route.request().method() === 'GET') {
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
      network.componentPutRequests.push({ method: 'PATCH', nodeId, payload });
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
    if (route.request().method() === 'PATCH' && parts[4] === 'settings') {
      const state = components.get(nodeId) || defaultComponentState('markdown', nodeId);
      return jsonResponse(route, {
        ok: true,
        node: runtimeNodeSnapshot(state, { x: 260, y: 420 }),
        settings: { schemaId: `${state.type}-settings`, values: route.request().postDataJSON() || {}, revision: 1 },
      });
    }
    return jsonResponse(route, { ok: true, node: { nodeId } });
  });

  // AC-004: File 大视图的 file.* 动作（file.meta / file.preview / file.readText / file.writeText）。
  await page.route(/\/api\/workflow\/nodes\/[^/]+\/actions\/.+/, async route => {
    const parts = new URL(route.request().url()).pathname.split('/').filter(Boolean);
    const nodeId = parts[3] || '';
    const action = decodeURIComponent(parts.slice(5).join('/'));
    const payload = route.request().postDataJSON() as JsonRecord || {};
    network.fileActionRequests.push({ method: route.request().method(), nodeId, action, payload });
    if (action === 'file.meta') {
      return jsonResponse(route, { ok: true, result: fileFixtures[nodeId]?.meta || { file: { path: '' } } });
    }
    if (action === 'file.preview') {
      return jsonResponse(route, { ok: true, result: fileFixtures[nodeId]?.preview || { path: '', previewKind: 'none' } });
    }
    if (action === 'file.readText') {
      const text = savedFileTexts[nodeId] || '';
      return jsonResponse(route, { ok: true, result: { text, bytesRead: text.length, truncated: false } });
    }
    if (action === 'file.writeText') {
      savedFileTexts[nodeId] = String(payload.content || '');
      return jsonResponse(route, {
        ok: true,
        result: { ok: true, path: fileFixtures[nodeId]?.meta?.file?.path || '', bytes: savedFileTexts[nodeId].length, mtime: '2026-08-01T00:00:01.000Z', revision: 2 },
      });
    }
    if (action === 'file.refresh') {
      return jsonResponse(route, { ok: true, result: { ok: true } });
    }
    if (action === 'node.delete') {
      components.delete(nodeId);
      return jsonResponse(route, { ok: true, action, node: null, result: { ok: true, nodeId } });
    }
    return jsonResponse(route, { ok: true, result: { ok: true } });
  });

  return network;
}

async function openWorkflow(page: Page) {
  await page.goto('/workflow');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-node').first()).toBeVisible();
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-wf-browser-ready', 'true');
}

async function openTaskList(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('task-list')).toBeVisible();
  await expect(page.getByTestId('task-row').first()).toBeVisible();
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

function cardFor(page: Page, nodeId: string) {
  return page.locator(`[data-testid="workflow-component-node"][data-node-id="${nodeId}"]`);
}

function assertNoPageErrors(network: HarnessNetwork) {
  expect(network.pageErrors, 'page errors').toEqual([]);
  expect(network.failedResponses, 'failed API responses').toEqual([]);
}

/* ---------------------------------------------------------------------------
 * AC 链测试（每个 test 独立安装 fixture，不依赖执行顺序）
 * ------------------------------------------------------------------------- */

test.describe('WF UI M7 markdown rendering upgrade (AC-001..AC-007)', () => {
  // ============ AC-001 ============
  // 懒加载时机：不含 mermaid 的 md 打开时零 CDN 请求；首个含 mermaid 的 md 首次渲染时
  // 恰好请求一次（跨卡片/全屏两个渲染面仍是单次），渲染出 markdown-mermaid-svg 且占位先出现。
  test('AC-001 mermaid CDN lazy-loads once on first mermaid md; renders pending -> svg', async ({ page }) => {
    test.setTimeout(90_000);
    const { cdnRequests } = await installMermaidCdnFulfill(page);
    const stateA = defaultComponentState('markdown', markdownNodeAId, { markdown: MD_PLAIN });
    const stateB = defaultComponentState('markdown', markdownNodeBId, { markdown: MD_MERMAID });
    const network = await installWorkflowFixture(page, { initialComponents: [stateA, stateB] });
    await openWorkflow(page);

    // (a) 打开不含 mermaid 的 md（节点 A 卡片预览）→ 零 CDN 请求。
    const cardA = cardFor(page, markdownNodeAId);
    const toggleA = cardA.getByTestId('workflow-markdown-preview-toggle');
    await expect(toggleA).toBeVisible();
    await toggleA.click();
    const previewA = cardA.getByTestId('workflow-markdown-preview-content');
    await expect(previewA).toBeVisible();
    await expect(previewA).toContainText('M7 Notes');
    expect(cdnRequests, 'no CDN request for mermaid-free markdown').toEqual([]);
    await toggleA.click();

    // (b) 打开含 mermaid 的 md（节点 B 卡片预览）→ 占位 → SVG，恰好一次请求。
    const cardB = cardFor(page, markdownNodeBId);
    const toggleB = cardB.getByTestId('workflow-markdown-preview-toggle');
    await toggleB.click();
    await expect(cardB.getByTestId('markdown-mermaid-pending')).toBeVisible();
    await expectMermaidSvgRendered(cardB, 'Finish');
    expect(cdnRequests.length, 'exactly one CDN request on first mermaid render').toBe(1);
    expect(cdnRequests[0]).toContain('mermaid');

    // 再次打开同一卡片预览 → 不再发第二次请求。
    await toggleB.click();
    await toggleB.click();
    await expectMermaidSvgRendered(cardB, 'Finish');
    expect(cdnRequests.length, 'no second CDN request after cached render').toBe(1);

    // 跨渲染面（全屏预览 Tab）仍然复用同一脚本实例，不产生第二次请求。
    await toggleB.click();
    await cardB.locator('.workflow-component-node-header').dblclick();
    const fullscreen = page.getByTestId('workflow-component-fullscreen');
    await expect(fullscreen).toHaveAttribute('data-component-type', 'markdown');
    await expect(fullscreen.getByTestId('workflow-markdown-rich-editor')).toBeVisible({ timeout: 20000 });
    await fullscreen.getByTestId('workflow-markdown-fullscreen-preview-tab').click();
    const fsPreview = fullscreen.getByTestId('workflow-markdown-fullscreen-preview-content');
    await expect(fsPreview).toBeVisible();
    await expectMermaidSvgRendered(fsPreview, 'Finish');
    expect(cdnRequests.length, 'still a single CDN request across card + fullscreen surfaces').toBe(1);

    assertNoPageErrors(network);
  });

  // ============ AC-002 ============
  // CDN 加载失败 → 原始代码块兜底 + 错误徽标，页面不崩溃、仍可交互。
  test('AC-002 CDN failure degrades to raw code block with error badge; UI stays interactive', async ({ page }) => {
    const { cdnRequests } = await installMermaidCdnAbort(page);
    const stateB = defaultComponentState('markdown', markdownNodeBId, { markdown: MD_MERMAID });
    const network = await installWorkflowFixture(page, { initialComponents: [stateB] });
    await openWorkflow(page);

    const cardB = cardFor(page, markdownNodeBId);
    await expect(cardB.getByTestId('workflow-markdown-preview-toggle')).toBeVisible();
    await cardB.getByTestId('workflow-markdown-preview-toggle').click();
    await expect(cardB.getByTestId('markdown-mermaid-fallback')).toBeVisible();
    await expect(cardB.getByTestId('markdown-mermaid-fallback')).toContainText('graph TD');
    await expect(cardB.getByTestId('markdown-mermaid-error')).toBeVisible();
    expect(cdnRequests.length).toBe(1);

    // 兜底后页面仍可交互：切回编辑模式，contentEditable 仍可输入。
    await cardB.getByTestId('workflow-markdown-preview-toggle').click();
    const editor = cardB.getByTestId('workflow-markdown-node-editor');
    await expect(editor).toBeVisible();
    await setMarkdownEditorText(page, '# Still editable after CDN failure');
    await expect(editor).toContainText('Still editable after CDN failure');

    assertNoPageErrors(network);
  });

  // ============ AC-003 ============
  // 安全基线：%%{init:{"securityLevel":"loose"}}%% 不得降级 strict；
  // label 中的 <img onerror> 不得执行（window.__pwned 保持 undefined），SVG 仍渲染。
  test('AC-003 securityLevel loose directive is locked; img onerror payload never executes', async ({ page }) => {
    test.setTimeout(60_000);
    await installMermaidCdnFulfill(page);
    const stateSec = defaultComponentState('markdown', markdownNodeBId, { markdown: MD_SECURITY });
    const network = await installWorkflowFixture(page, { initialComponents: [stateSec] });
    await openWorkflow(page);

    const cardB = cardFor(page, markdownNodeBId);
    await expect(cardB.getByTestId('workflow-markdown-preview-toggle')).toBeVisible();
    await cardB.getByTestId('workflow-markdown-preview-toggle').click();
    await expectMermaidSvgRendered(cardB, 'Safe');

    // 注入的 <img onerror> 必须从未成为 DOM 元素或执行。
    await expect(cardB.getByTestId('markdown-mermaid-svg').locator('svg img')).toHaveCount(0);
    const pwned = await page.evaluate(() => (window as any).__pwned);
    expect(pwned, 'window.__pwned must stay undefined').toBeUndefined();

    assertNoPageErrors(network);
  });

  // ============ AC-004 ============
  // File 大视图 md 分支：GFM 表格 + mermaid 渲染；Save 流程回归（file.writeText）。
  test('AC-004 File big view md branch renders GFM table + mermaid; save round-trip', async ({ page }) => {
    test.setTimeout(60_000);
    const { cdnRequests } = await installMermaidCdnFulfill(page);
    const fileState = defaultComponentState('file', fileNodeId);
    const network = await installWorkflowFixture(page, { initialComponents: [fileState] });
    await openWorkflow(page);

    const fileNode = cardFor(page, fileNodeId);
    await expect(fileNode).toBeVisible();
    await fileNode.dblclick();

    const bigView = page.getByTestId('workflow-file-big-view');
    await expect(bigView).toBeVisible();
    await expect(bigView).toHaveAttribute('data-file-kind', 'md');

    const mdEditor = bigView.getByTestId('workflow-file-big-view-md-editor');
    await expect(mdEditor).toBeVisible();
    // 预览区渲染 GFM 表格。
    await expect(mdEditor).toContainText('M7-Md-Table-B');
    // mermaid 容器渲染出 SVG（实现后；当前 @uiw 预览无 mermaid，此项为 RED 断言）。
    await expectMermaidSvgRendered(bigView, 'F2');
    expect(cdnRequests.length, 'exactly one CDN request in big view md preview').toBe(1);

    // Save 流程回归：编辑 → Save → file.writeText 载荷断言 → dirty 清除（Save 重新禁用）。
    const saveButton = bigView.getByTestId('workflow-file-big-view-save');
    await expect(saveButton).toBeDisabled();
    const textarea = mdEditor.locator('textarea').first();
    await expect(textarea).toBeVisible();
    await textarea.fill('# M7 Big View edited\n\nchanged by m7 spec');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await expect.poll(() => network.fileActionRequests.filter(request => request.action === 'file.writeText').length).toBe(1);
    const write = network.fileActionRequests.find(request => request.action === 'file.writeText')!;
    expect(write.nodeId).toBe(fileNodeId);
    expect(write.payload).toEqual({ content: '# M7 Big View edited\n\nchanged by m7 spec' });
    await expect(saveButton).toBeDisabled();
    await expect(bigView.getByTestId('workflow-file-big-view-dirty')).toContainText('Saved');

    await bigView.getByTestId('workflow-file-big-view-close').click();
    await expect(bigView).toHaveCount(0);

    assertNoPageErrors(network);
  });

  // ============ AC-005 ============
  // TaskList 预览：共享渲染管线渲染 PLAN.md 的 GFM 表格与 mermaid（html:false 净化语义保留）。
  test('AC-005 TaskList PLAN.md preview renders GFM table and mermaid via shared pipeline', async ({ page }) => {
    test.setTimeout(60_000);
    const { cdnRequests } = await installMermaidCdnFulfill(page);
    const network = await installWorkflowFixture(page, {
      taskList: {
        active: [{
          taskId: taskListTaskId,
          status: 'active',
          phase: 'implement',
          gate: 'TEST-GATE',
          updatedAt: new Date().toISOString(),
          activeQuestion: null,
          nextAction: 'Run M7 e2e',
          tier: 'standard',
          mode: 'wf-standard',
          group: 'M7',
          acceptance: [{ id: 'M7-AC', text: 'M7 fixture acceptance', status: 'tracked' }],
          dependsOn: [],
          blocks: [],
          hasPlan: true,
          hasProgress: false,
          defaultRuntime: 'codex',
        }],
        files: {
          'STATE.json': JSON.stringify({
            objective: 'M7 fixture task',
            status: 'active',
            phase: 'implement',
            gate: 'TEST-GATE',
            revision: 1,
          }),
          'PLAN.md': MD_TASK_PLAN,
        },
      },
    });
    await openTaskList(page);

    await page.getByTestId('task-row').first().click();
    const inspector = page.getByTestId('task-inspector');
    await expect(inspector).toBeVisible();

    await inspector.getByRole('button', { name: /PLAN/ }).click();
    // GFM 表格渲染（当前裸 markdown-it 已支持，属回归断言）。
    await expect(inspector).toContainText('M7-Task-Table-B');
    await expect(inspector.locator('table')).toBeVisible();
    // mermaid 渲染（实现后；当前 markdown-it 无 mermaid 插件，此项为 RED 断言）。
    await expectMermaidSvgRendered(inspector, 'T2');
    expect(cdnRequests.length, 'exactly one CDN request in TaskList preview').toBe(1);

    assertNoPageErrors(network);
  });

  // ============ AC-006 ============
  // 全屏编辑器新增「预览」Tab：编辑 Tab（@mdxeditor）行为不回归（输入+保存），
  // 预览 Tab 用共享管线渲染表格与 mermaid。
  test('AC-006 fullscreen preview tab renders table + mermaid; edit tab save regression', async ({ page }) => {
    test.setTimeout(90_000);
    const { cdnRequests } = await installMermaidCdnFulfill(page);
    const state = defaultComponentState('markdown', markdownNodeBId, { markdown: MD_MERMAID_TABLE });
    const network = await installWorkflowFixture(page, { initialComponents: [state] });
    await openWorkflow(page);

    const markdownNode = cardFor(page, markdownNodeBId);
    await markdownNode.locator('.workflow-component-node-header').dblclick();
    const fullscreen = page.getByTestId('workflow-component-fullscreen');
    await expect(fullscreen).toHaveAttribute('data-component-type', 'markdown');

    // 编辑 Tab 回归：rich editor 正常加载并可输入 + 保存。
    const richEditor = fullscreen.getByTestId('workflow-markdown-rich-editor');
    await expect(richEditor).toBeVisible({ timeout: 20000 });
    const richEditable = richEditor.locator('[contenteditable="true"]').first();
    // mdxeditor 懒加载（全屏首次挂载 dynamic import），给富文本挂载一点缓冲。
    await page.waitForTimeout(1200);
    await expect(richEditable).toBeVisible();
    await richEditable.click();
    await page.keyboard.type(' AC-006 preview tab edit');
    await fullscreen.getByTestId('workflow-component-fullscreen-save').click();
    await expect.poll(() => network.componentPutRequests.length).toBe(1);
    expect(network.componentPutRequests[0].payload.markdown).toContain('AC-006 preview tab edit');

    // 预览 Tab：共享管线渲染表格 + mermaid。
    await expect(fullscreen.getByTestId('workflow-markdown-fullscreen-preview-tab')).toBeVisible();
    await fullscreen.getByTestId('workflow-markdown-fullscreen-preview-tab').click();
    const fsPreview = fullscreen.getByTestId('workflow-markdown-fullscreen-preview-content');
    await expect(fsPreview).toBeVisible();
    await expect(fsPreview).toContainText('M7-Table-B');
    await expectMermaidSvgRendered(fsPreview, 'Finish');
    expect(cdnRequests.length, 'exactly one CDN request in fullscreen preview').toBe(1);

    await fullscreen.getByTestId('workflow-component-fullscreen-close').click();
    await expect(fullscreen).toHaveCount(0);

    assertNoPageErrors(network);
  });

  // ============ AC-007 ============
  // 节点卡片预览 toggle：GFM 表格按 markdown 渲染；切回编辑模式 contentEditable 行为不回归。
  test('AC-007 card preview toggle renders GFM table; edit mode stays editable', async ({ page }) => {
    const state = defaultComponentState('markdown', markdownNodeAId, { markdown: MD_TABLE_AND_CODE });
    const network = await installWorkflowFixture(page, { initialComponents: [state] });
    await openWorkflow(page);

    const card = cardFor(page, markdownNodeAId);
    const toggle = card.getByTestId('workflow-markdown-preview-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();

    const preview = card.getByTestId('workflow-markdown-preview-content');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('M7-Card-B');
    await expect(preview.locator('table')).toBeVisible();

    // 切回编辑模式 → contentEditable 仍可用（回归）。
    await toggle.click();
    const editor = card.getByTestId('workflow-markdown-node-editor');
    await expect(editor).toBeVisible();
    await setMarkdownEditorText(page, 'M7 card edit still works');
    await expect(editor).toContainText('M7 card edit still works');

    assertNoPageErrors(network);
  });
});
