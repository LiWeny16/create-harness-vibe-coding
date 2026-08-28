import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// WF UI M8 — Agent node subagentMode settings acceptance.
// AC-UI-001: Agent node settings shows both subagentMode options, default
//   built-in-subagents (Harness/tasks/task-subagent-strategy-2x2-matrix/STATE.json).
// AC-UI-002: Session/graph/context carry a consistent subagentMode.
// AC-NL-003: Unspecified creation defaults to built-in-subagents.
// Contracts: Harness/tasks/task-subagent-strategy-2x2-matrix/PLAN.md
//   (Accepted Values table, D1 rename wf-subagents -> wf-node-subagents,
//   D4 legacy alias).
// TaskType: ui / e2e. No production code is exercised beyond the built UI.

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const mainSessionId = 'e2e-session-m8-main';
const mainAgentNodeId = 'e2e-agent-m8-main';
const createdSessionId = 'e2e-session-m8-sub';
const createdNodeId = `session-${createdSessionId}`;

const SUBAGENT_MODE_CATALOG = [
  { id: 'built-in-subagents', label: 'Built-in Subagents' },
  { id: 'wf-node-subagents', label: 'WF Node Subagents' },
];

type JsonRecord = Record<string, any>;

type M8Network = {
  agentCreateRequests: JsonRecord[];
  nodeCreateRequests: JsonRecord[];
  configPatchRequests: JsonRecord[];
  settingsPatchRequests: JsonRecord[];
  snapshotBodies: JsonRecord[];
  pageErrors: string[];
};

const baseNodeConfig: JsonRecord = {
  role: 'ceo',
  customRole: '',
  prompt: 'Run inside WF UI and use the workflow map as context.',
  model: 'gpt-5-codex',
  provider: 'openai',
  cwd: repoRoot,
  env: { HARNESS_WORKFLOW_MAP: 'Harness/a2a/workflow-map.json' },
  permissions: { filesystem: 'full-access', network: 'enabled' },
  launchPolicy: {
    autoStart: false,
    restartOnSave: false,
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
  },
  outputRouting: {
    markdownDefaultEnabled: false,
    markdownTargetNodeId: '',
    fallback: 'oldest-connected-markdown',
  },
  skills: ['wf-max', 'tdd', 'wf-browser'],
  skillPolicy: 'auto',
  recommendedSkills: ['wf-max', 'tdd', 'wf-browser'],
  contextSources: ['workflow-map', 'task-capsule', 'terminal-transcript'],
  capabilities: ['terminal', 'file-ops', 'browser', 'review'],
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
  };
}

function isLaunchAffecting(payload: JsonRecord) {
  return ['model', 'provider', 'cwd', 'env', 'permissions', 'launchPolicy'].some(key => key in payload);
}

function mainSessionRecord(subagentMode: string) {
  return {
    sessionId: mainSessionId,
    runtime: 'codex',
    role: 'ceo',
    displayName: 'M8 Main Agent',
    roleTitle: 'ceo',
    agentKind: 'main',
    subagentMode,
    status: 'running',
    attachMode: true,
    wsClientCount: 1,
    workflowMode: 'wf-max',
    cwd: repoRoot,
    graphNodeId: mainAgentNodeId,
    inputOwnerId: 'drawer',
  };
}

function mainAgentNodeRecord(subagentMode: string) {
  return {
    id: mainAgentNodeId,
    label: 'M8 Main Agent',
    displayName: 'M8 Main Agent',
    roleTitle: 'ceo',
    // Snapshot/graph nodes must keep the session kind so layoutNodes()
    // renders them on the canvas. The agent kind is served only by the
    // runtime node endpoint (see agentRuntimeNodeRecord below).
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
    taskId: 'task-subagent-strategy-2x2-matrix',
    agentKind: 'main',
    runtime: 'codex',
    peerId: 'codex',
    objective: 'M8 subagentMode settings fixture',
    cwd: repoRoot,
    graphNodeId: mainAgentNodeId,
    subagentMode,
    config: { ...baseNodeConfig, subagentMode },
    position: { x: 420, y: 200 },
  };
}

function createdAgentSessionRecord(agent: JsonRecord) {
  return {
    sessionId: agent.sessionId,
    runtime: String(agent.runtime || 'codex'),
    role: String(agent.roleTitle || 'subagent'),
    displayName: String(agent.displayName || ''),
    roleTitle: String(agent.roleTitle || ''),
    agentKind: String(agent.agentKind || 'subagent'),
    subagentMode: String(agent.subagentMode || 'built-in-subagents'),
    status: 'running',
    attachMode: true,
    wsClientCount: 1,
    workflowMode: 'wf-max',
    cwd: repoRoot,
    graphNodeId: agent.nodeId,
    inputOwnerId: 'drawer',
  };
}

function createdAgentNodeRecord(agent: JsonRecord) {
  const subagentMode = String(agent.subagentMode || 'built-in-subagents');
  return {
    id: agent.nodeId,
    nodeId: agent.nodeId,
    label: String(agent.displayName || 'M8 Subagent'),
    displayName: String(agent.displayName || ''),
    roleTitle: String(agent.roleTitle || ''),
    // Snapshot/graph nodes must keep the session kind so layoutNodes()
    // renders them on the canvas. The agent kind is served only by the
    // runtime node endpoint (see agentRuntimeNodeRecord below).
    kind: 'terminal-session',
    level: 0,
    status: 'running',
    lifecycle: 'live',
    runtimeState: 'running',
    managedByCurrentServer: true,
    control: control(),
    role: String(agent.roleTitle || 'subagent'),
    skills: ['wf-max'],
    permissions: { filesystem: 'workspace-write', network: 'enabled' },
    sessionId: agent.sessionId,
    taskId: 'task-subagent-strategy-2x2-matrix',
    agentKind: String(agent.agentKind || 'subagent'),
    runtime: String(agent.runtime || 'codex'),
    peerId: String(agent.runtime || 'codex'),
    objective: String(agent.responsibility || 'M8 created subagent'),
    cwd: repoRoot,
    graphNodeId: agent.nodeId,
    subagentMode,
    config: { ...baseNodeConfig, role: String(agent.roleTitle || 'subagent'), subagentMode },
    position: agent.position || { x: 860, y: 220 },
  };
}

// Runtime node shape served by GET /api/workflow/nodes/:id (fetchRuntimeNode).
// Unlike the snapshot records above this MUST be kind 'agent' so that
// getNodeRenderer(kind) resolves AgentNodeSettings in nodeRegistry, with the
// subagentMode identity fields carried under settings.values (mirrors the
// backend buildAgentSnapshot in src/wf-ui-server/workflow-agent-context.mjs).
function agentRuntimeNodeRecord(source: JsonRecord) {
  const nodeId = String(source.nodeId || source.graphNodeId || source.id || mainAgentNodeId);
  const sessionId = String(source.sessionId || '');
  const displayName = String(source.displayName || '');
  const roleTitle = String(source.roleTitle || '');
  const subagentMode = String(source.subagentMode || 'built-in-subagents');
  const agentKind = String(source.agentKind || 'subagent');
  const runtime = String(source.runtime || 'codex');
  const skills = Array.isArray(source.skills) ? source.skills : ['wf-max', 'tdd', 'wf-browser'];
  const capabilities = Array.isArray(source.capabilities)
    ? source.capabilities
    : ['terminal', 'file-ops', 'browser', 'review'];
  return {
    nodeId,
    kind: 'agent',
    version: 1,
    lifecycle: 'live',
    status: { state: String(source.status || 'running'), updatedAt: '2026-08-12T00:00:00.000Z' },
    sessionId,
    control: control(),
    graph: {
      position: source.position || { x: 420, y: 200 },
      handles: [],
      connections: [],
    },
    stateRef: { path: `Harness/a2a/nodes/${sessionId || nodeId}`, revision: 0 },
    settings: {
      schemaId: 'agent-settings',
      values: {
        runtime,
        agentKind,
        skills,
        skillPolicy: 'auto',
        contextSources: ['workflow-map', 'task-capsule', 'terminal-transcript'],
        capabilities,
        displayName,
        roleTitle,
        subagentMode,
      },
      revision: 1,
    },
    capabilities: [
      'agent.sendInput',
      'agent.readOutput',
      'agent.readTranscript',
      'agent.start',
      'agent.stop',
      'agent.restart',
      'agent.delete',
      'agent.readContext',
    ],
    ui: {
      previewKind: 'agent',
      settingsPanel: 'agent-settings',
      testId: 'workflow-agent-node',
      labels: { title: displayName || 'Agent' },
    },
  };
}

function workflowSnapshot(options: { subagentMode: string; createdAgent: JsonRecord | null }) {
  const { subagentMode, createdAgent } = options;
  const positions: JsonRecord = { [mainAgentNodeId]: { x: 420, y: 200 } };
  const snapshotNodes: JsonRecord[] = [mainAgentNodeRecord(subagentMode)];
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
    taskId: 'task-subagent-strategy-2x2-matrix',
    cwd: repoRoot,
    position: positions[mainAgentNodeId],
    displayName: 'M8 Main Agent',
    roleTitle: 'ceo',
    subagentMode,
  }];
  const sessions: JsonRecord[] = [mainSessionRecord(subagentMode)];

  if (createdAgent) {
    positions[createdAgent.nodeId] = createdAgent.position;
    const nodeRecord = createdAgentNodeRecord(createdAgent);
    snapshotNodes.push(nodeRecord);
    graphNodes.push({
      nodeId: createdAgent.nodeId,
      sessionId: createdAgent.sessionId,
      agentKind: nodeRecord.agentKind,
      runtime: nodeRecord.runtime,
      status: 'running',
      lifecycle: 'live',
      runtimeState: 'running',
      managedByCurrentServer: true,
      control: control(),
      taskId: 'task-subagent-strategy-2x2-matrix',
      cwd: repoRoot,
      position: createdAgent.position,
      displayName: nodeRecord.displayName,
      roleTitle: nodeRecord.roleTitle,
      subagentMode: nodeRecord.subagentMode,
    });
    sessions.push(createdAgentSessionRecord(createdAgent));
  }

  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-12T00:00:00.000Z',
    workflowId: 'e2e-workflow-m8',
    taskId: 'task-subagent-strategy-2x2-matrix',
    mode: 'wf-max',
    phase: 'm8-red',
    gate: 'TEST-GATE',
    rootAgentId: mainAgentNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: SUBAGENT_MODE_CATALOG,
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions,
    nodes: snapshotNodes,
    edges: [],
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-m8',
      version: 1,
      nodes: graphNodes,
      edges: [],
      positions,
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
    },
    graphContextBySessionId: {},
  };
}

async function installWorkflowFixture(page: Page): Promise<M8Network> {
  const network: M8Network = {
    agentCreateRequests: [],
    nodeCreateRequests: [],
    configPatchRequests: [],
    settingsPatchRequests: [],
    snapshotBodies: [],
    pageErrors: [],
  };

  let nodeSubagentMode = 'built-in-subagents';
  let createdAgent: JsonRecord | null = null;

  const currentSnapshot = () => workflowSnapshot({ subagentMode: nodeSubagentMode, createdAgent });

  page.on('pageerror', error => network.pageErrors.push(error.message));

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, {
    taskId: 'task-subagent-strategy-2x2-matrix',
    phase: 'm8-red',
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
    taskId: 'task-subagent-strategy-2x2-matrix',
    status: 'open',
    phase: 'm8-red',
  }]));
  await page.route('**/api/a2a/snapshot**', route => {
    network.snapshotBodies.push(cloneJson(currentSnapshot()));
    return jsonResponse(route, currentSnapshot());
  });
  await page.route('**/api/a2a/graph-map**', route => jsonResponse(route, { ok: true, revision: 2 }));
  await page.route('**/api/sessions**', async route => {
    // NOTE: Playwright glob matching includes the query string, so the list
    // fetch `/api/sessions?all=1` and the create POST `/api/sessions` are
    // served from this single pattern (sibling specs use the same convention).
    if (route.request().method() === 'POST' && route.request().url().endsWith('/api/sessions')) {
      const payload = requestJson(route);
      network.agentCreateRequests.push(payload);
      createdAgent = {
        nodeId: createdNodeId,
        sessionId: createdSessionId,
        displayName: String(payload.displayName || ''),
        roleTitle: String(payload.roleTitle || ''),
        agentKind: String(payload.agentKind || 'subagent'),
        runtime: String(payload.runtime || 'codex'),
        responsibility: String(payload.responsibility || ''),
        subagentMode: String(payload.subagentMode || 'built-in-subagents'),
        position: { x: 860, y: 220 },
      };
      return jsonResponse(route, createdAgentSessionRecord(createdAgent), 201);
    }
    return jsonResponse(route, currentSnapshot().sessions);
  });
  await page.route(`**/api/a2a/nodes/${mainAgentNodeId}/config`, async route => {
    const payload = requestJson(route);
    network.configPatchRequests.push({
      method: route.request().method(),
      url: route.request().url(),
      payload,
    });
    if (typeof payload.subagentMode === 'string') {
      nodeSubagentMode = payload.subagentMode;
    }
    return jsonResponse(route, {
      ok: true,
      node: {
        id: mainAgentNodeId,
        config: { ...baseNodeConfig, ...payload },
      },
      restartRequired: isLaunchAffecting(payload),
      revision: network.configPatchRequests.length + 1,
    });
  });
  await page.route(`**/api/a2a/nodes/${mainAgentNodeId}/restart`, async route => {
    return jsonResponse(route, {
      ok: true,
      nodeId: mainAgentNodeId,
      sessionId: `${mainSessionId}-restarted`,
      restartRequired: false,
      revision: 10,
    });
  });
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, {
    entries: [{ seq: 1, stream: 'stdout', data: '\r\nM8 terminal fixture ready\r\n' }],
  }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/workspace/tree**', route => jsonResponse(route, {
    root: repoRoot,
    path: '',
    entries: [],
  }));
  await page.route('**/api/user-files', route => jsonResponse(route, { ok: true, files: [] }));
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, route => {
    if (route.request().method() === 'GET') {
      return jsonResponse(route, { ok: true, nodes: [] });
    }
    const payload = requestJson(route);
    network.nodeCreateRequests.push(payload);
    return jsonResponse(route, {
      ok: true,
      node: { nodeId: `m8-created-${network.nodeCreateRequests.length}`, kind: String(payload.type || 'file'), version: 1 },
      state: {},
      revision: 1,
    }, 201);
  });
  await page.route(/\/api\/workflow\/nodes\/.+/, route => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'GET') {
      // fetchRuntimeNode: serve an agent-kind runtime node (never the
      // terminal-session snapshot shape) so AgentNodeSettings renders.
      const match = url.match(/\/api\/workflow\/nodes\/([^/?]+)/);
      const nodeId = match ? decodeURIComponent(match[1]) : mainAgentNodeId;
      const runtimeSource = nodeId === mainAgentNodeId
        ? mainAgentNodeRecord(nodeSubagentMode)
        : createdAgent
          ? createdAgentNodeRecord(createdAgent)
          : mainAgentNodeRecord(nodeSubagentMode);
      return jsonResponse(route, {
        ok: true,
        node: agentRuntimeNodeRecord(runtimeSource),
        state: {},
        revision: 1,
      });
    }
    if (method === 'POST' && url.includes('/actions/')) {
      return jsonResponse(route, { ok: true, action: 'node.action', result: {} });
    }
    // PATCH /settings — AgentNodeSettings saveIdentity persists subagentMode.
    const payload = requestJson(route);
    network.settingsPatchRequests.push({ method, url, payload });
    if (typeof payload.subagentMode === 'string') {
      nodeSubagentMode = payload.subagentMode;
    }
    return jsonResponse(route, {
      ok: true,
      node: { nodeId: 'm8-node', kind: 'agent', version: 1 },
      settings: { schemaId: 'agent-settings', values: payload, revision: 1 },
      state: {},
      revision: 1,
    });
  });

  return network;
}

async function openWorkflow(page: Page) {
  await page.goto('/workflow');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  const mainCard = page.locator(`[data-testid="workflow-node"][data-node-id="${mainAgentNodeId}"]`);
  await expect(mainCard).toBeVisible();
}

async function openNodeSettingsFor(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node"][data-node-id="${nodeId}"]`);
  await expect(node).toBeVisible();
  await node.click({ button: 'right' });
  await page.locator('[data-testid="workflow-node-context-action"][data-action="settings"]').click();
  // The runtime node fetch resolves to kind 'agent', so AgentNodeSettings
  // renders inside NodeSettingsShell (workflow-component-settings panel).
  await expect(page.getByTestId('workflow-component-settings')).toBeVisible();
}

async function closeNodeSettings(page: Page) {
  await page.getByTestId('workflow-component-settings').locator('button[title="Close"]').click();
  await expect(page.getByTestId('workflow-component-settings')).toHaveCount(0);
}

test.describe('WF UI M8 subagentMode settings acceptance', () => {
  test('AC-UI-002/AC-NL-003 create-agent POST defaults subagentMode to built-in-subagents and the node lands on canvas', async ({ page }) => {
    test.setTimeout(60_000);
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);

    await page.getByTestId('workflow-create-node').click();
    const picker = page.getByTestId('workflow-create-node-panel');
    await expect(picker).toBeVisible();
    const agentOption = picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="agent"]');
    await expect(agentOption).toBeEnabled();
    await agentOption.click();

    await expect(picker.getByTestId('workflow-create-agent-display-name')).toBeVisible();
    await picker.getByTestId('workflow-agent-kind').selectOption('subagent');
    await picker.getByTestId('workflow-create-agent-display-name').fill('M8 Built-in Sub');
    await picker.getByTestId('workflow-create-agent-role-title').selectOption('reviewer');
    await picker.getByTestId('workflow-create-agent-responsibility').fill('M8 subagentMode create default acceptance.');
    await picker.getByTestId('workflow-create-agent-capabilities').fill('typescript, review');

    const submit = picker.getByTestId('workflow-create-agent-submit');
    await expect(submit).toBeEnabled();
    await submit.click();

    // The create POST carries subagentMode even though the form never
    // exposed a mode picker: unspecified must default to built-in-subagents.
    await expect.poll(() => network.agentCreateRequests.length).toBe(1);
    expect(network.agentCreateRequests[0]).toEqual(expect.objectContaining({
      agentKind: 'subagent',
      displayName: 'M8 Built-in Sub',
      roleTitle: 'reviewer',
      subagentMode: 'built-in-subagents',
    }));

    const card = page.locator(`[data-testid="workflow-node"][data-node-id="${createdNodeId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText('M8 Built-in Sub');
    expect(network.pageErrors, 'page errors').toEqual([]);
  });

  test('AC-UI-001 settings panel shows the subagentMode selector defaulting to Built-in Subagents with both options', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);
    await openNodeSettingsFor(page, mainAgentNodeId);

    const modeSelect = page.getByTestId('workflow-agent-settings-subagent-mode');
    await expect(modeSelect).toBeVisible();
    expect(await modeSelect.evaluate(element => element.tagName.toLowerCase()), 'subagentMode control should be a native <select>').toBe('select');
    await expect(modeSelect).toHaveValue('built-in-subagents');
    await expect(modeSelect.locator('option')).toHaveCount(2);
    await expect(modeSelect.locator('option[value="built-in-subagents"]')).toHaveText('Built-in Subagents');
    await expect(modeSelect.locator('option[value="wf-node-subagents"]')).toHaveText('WF Node Subagents');
    expect(network.pageErrors, 'page errors').toEqual([]);
  });

  test('AC-UI-001/AC-UI-002 changing subagentMode to WF Node Subagents persists through save and reopen', async ({ page }) => {
    test.setTimeout(60_000);
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);
    await openNodeSettingsFor(page, mainAgentNodeId);

    const modeSelect = page.getByTestId('workflow-agent-settings-subagent-mode');
    await expect(modeSelect).toHaveValue('built-in-subagents');
    await modeSelect.selectOption('wf-node-subagents');
    await expect(modeSelect).toHaveValue('wf-node-subagents');

    await page.getByTestId('workflow-agent-settings-save').click();

    // Save sends the chosen mode through the agent node settings PATCH.
    await expect.poll(() => network.settingsPatchRequests.length).toBe(1);
    expect(network.settingsPatchRequests[0]).toEqual(expect.objectContaining({
      method: 'PATCH',
      url: expect.stringContaining(`/api/workflow/nodes/${mainAgentNodeId}/settings`),
      payload: expect.objectContaining({ subagentMode: 'wf-node-subagents' }),
    }));

    // Reopen the panel: the persisted mode must be selected again.
    await closeNodeSettings(page);
    await openNodeSettingsFor(page, mainAgentNodeId);
    await expect(page.getByTestId('workflow-agent-settings-subagent-mode')).toHaveValue('wf-node-subagents');
    expect(network.pageErrors, 'page errors').toEqual([]);
  });

  test('AC-UI-001 snapshot subagentModes catalog is exactly the two canonical modes and drives the selector options', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);
    await openNodeSettingsFor(page, mainAgentNodeId);

    // Network assertion: the served snapshot exposes the canonical catalog
    // (two entries, correct ids/labels, no legacy wf-subagents id).
    await expect.poll(() => network.snapshotBodies.length).toBeGreaterThan(0);
    const catalog = network.snapshotBodies[0].subagentModes as JsonRecord[];
    expect(catalog).toEqual([
      { id: 'built-in-subagents', label: 'Built-in Subagents' },
      { id: 'wf-node-subagents', label: 'WF Node Subagents' },
    ]);
    expect(catalog.some(entry => entry.id === 'wf-subagents'), 'legacy wf-subagents must not appear').toBe(false);

    // The dropdown renders exactly the catalog entries 1:1.
    const modeSelect = page.getByTestId('workflow-agent-settings-subagent-mode');
    const renderedIds = await modeSelect.locator('option').evaluateAll(options => (
      options.map(option => (option as HTMLOptionElement).value)
    ));
    expect(renderedIds).toEqual(['built-in-subagents', 'wf-node-subagents']);
    await expect(modeSelect.locator('option[value="built-in-subagents"]')).toHaveText('Built-in Subagents');
    await expect(modeSelect.locator('option[value="wf-node-subagents"]')).toHaveText('WF Node Subagents');
    await expect(modeSelect.locator('option[value="wf-subagents"]')).toHaveCount(0);
    expect(network.pageErrors, 'page errors').toEqual([]);
  });
});
