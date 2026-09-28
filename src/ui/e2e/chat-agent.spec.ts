import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const nodeId = 'e2e-standalone-chat-agent';
const sessionId = 'e2e-standalone-chat-session';
const graphPosition = { x: 420, y: 200 };
const permissionModes: Record<string, string[]> = {
  claude: ['default', 'acceptEdits', 'plan', 'bypassPermissions'],
  codex: ['untrusted', 'on-request', 'on-failure', 'never'],
  opencode: ['ask', 'allow', 'deny'],
  pi: ['ask', 'allow', 'deny'],
};

type JsonRecord = Record<string, any>;

type ChatFixture = {
  settingsPatches: JsonRecord[];
  actionRequests: JsonRecord[];
  snapshotBodies: JsonRecord[];
  rangeRequests: string[];
  chatFrames: JsonRecord[];
  pageErrors: string[];
  pushEnvelope: (event: string, payload: JsonRecord) => void;
};

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function requestJson(route: Route): JsonRecord {
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

function nodeConfig(runtime: string, uiMode: 'pty' | 'chat') {
  return {
    runtime,
    uiMode,
    agentKind: 'main',
    displayName: 'Standalone Chat Agent',
    roleTitle: 'main',
    model: 'test-model',
    provider: runtime,
    cwd: repoRoot,
    env: {},
    permissions: { filesystem: 'workspace-write', network: 'enabled' },
    launchPolicy: { autoStart: false, restartOnSave: false },
    skills: [],
    skillPolicy: 'auto',
    recommendedSkills: [],
    contextSources: ['workflow-map'],
    capabilities: ['terminal', 'chat'],
  };
}

function runtimeAgentNode(runtime: string, uiMode: 'pty' | 'chat', status: string) {
  const values = nodeConfig(runtime, uiMode);
  return {
    nodeId,
    kind: 'agent',
    version: 1,
    lifecycle: 'live',
    status: { state: status, updatedAt: '2026-09-28T00:00:00.000Z' },
    sessionId,
    runtime,
    config: values,
    control: control(),
    graph: { position: graphPosition, handles: [], connections: [] },
    stateRef: { path: `Harness/a2a/nodes/${nodeId}`, revision: 1 },
    settings: { schemaId: 'agent-settings', values, revision: 1 },
    capabilities: [
      'agent.start', 'agent.stop', 'agent.restart', 'agent.delete',
      'agent.sendInput', 'agent.readOutput', 'agent.readTranscript',
    ],
    ui: {
      previewKind: 'agent',
      settingsPanel: 'agent-settings',
      testId: 'workflow-agent-node',
      labels: { title: 'Standalone Chat Agent' },
    },
  };
}

function workflowSnapshot(runtime: string, uiMode: 'pty' | 'chat', status: string) {
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-09-28T00:00:00.000Z',
    workflowId: 'e2e-standalone-chat',
    taskId: 'task-add-web-agent-node',
    mode: 'direct',
    phase: 'test',
    gate: 'TEST-GATE',
    rootAgentId: nodeId,
    availableWorkflows: [],
    subagentModes: [],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [{
      sessionId,
      runtime,
      role: 'main',
      displayName: 'Standalone Chat Agent',
      agentKind: 'main',
      status,
      attachMode: status === 'running',
      wsClientCount: 0,
      cwd: repoRoot,
      graphNodeId: nodeId,
      uiMode,
    }],
    nodes: [{
      id: nodeId,
      nodeId,
      label: 'Standalone Chat Agent',
      kind: 'terminal-session',
      level: 0,
      status,
      lifecycle: status === 'running' ? 'live' : 'stopped',
      runtimeState: status,
      managedByCurrentServer: true,
      control: control(),
      role: 'main',
      agentKind: 'main',
      runtime,
      sessionId,
      graphNodeId: nodeId,
      cwd: repoRoot,
      config: nodeConfig(runtime, uiMode),
      position: graphPosition,
    }],
    edges: [],
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-standalone-chat',
      version: 1,
      nodes: [{
        nodeId,
        sessionId,
        agentKind: 'main',
        runtime,
        status,
        lifecycle: status === 'running' ? 'live' : 'stopped',
        runtimeState: status,
        managedByCurrentServer: true,
        control: control(),
        cwd: repoRoot,
        position: graphPosition,
        uiMode,
      }],
      edges: [],
      positions: { [nodeId]: graphPosition },
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
    },
    graphContextBySessionId: {},
  };
}

async function installChatFixture(
  page: Page,
  runtime: string,
  { initialChat = false }: { initialChat?: boolean } = {},
): Promise<ChatFixture> {
  const fixture: ChatFixture = {
    settingsPatches: [],
    actionRequests: [],
    snapshotBodies: [],
    rangeRequests: [],
    chatFrames: [],
    pageErrors: [],
    pushEnvelope: () => {},
  };
  let uiMode: 'pty' | 'chat' = initialChat ? 'chat' : 'pty';
  let status = initialChat ? 'running' : 'stopped';
  let values = nodeConfig(runtime, uiMode);
  let socket: { send: (message: string) => void } | undefined;
  let seq = 0;
  page.on('pageerror', error => fixture.pageErrors.push(error.message));

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/project', route => jsonResponse(route, { root: repoRoot }));
  await page.route('**/api/workflow', route => jsonResponse(route, {
    taskId: 'task-add-web-agent-node', phase: 'test', gate: 'TEST-GATE',
  }));
  await page.route('**/api/runtimes**', route => jsonResponse(route, [{
    id: runtime,
    label: runtime,
    command: runtime,
    path: runtime,
    version: 'test',
    status: 'available',
    launchable: true,
    adapterStatus: 'ok',
    capabilities: ['terminal', 'chat'],
  }]));
  await page.route('**/api/tasks**', route => jsonResponse(route, [{
    taskId: 'task-add-web-agent-node', status: 'open', phase: 'test',
  }]));
  await page.route('**/api/a2a/snapshot', route => {
    const snapshot = workflowSnapshot(runtime, uiMode, status);
    fixture.snapshotBodies.push(snapshot);
    return jsonResponse(route, snapshot);
  });
  await page.route('**/api/a2a/graph-map**', route => jsonResponse(route, {
    ok: true,
    revision: 1,
    graph: workflowSnapshot(runtime, uiMode, status).graph,
    sourceOfTruth: 'backend',
  }));
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, workflowSnapshot(runtime, uiMode, status).sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, { entries: [] }));
  await page.route('**/api/chat/**/range**', route => {
    fixture.rangeRequests.push(route.request().url());
    return jsonResponse(route, { envelopes: [] });
  });
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/workspace/tree**', route => jsonResponse(route, { root: repoRoot, path: '', entries: [] }));
  await page.route('**/api/user-files', route => jsonResponse(route, { ok: true, files: [] }));
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, route => jsonResponse(route, { ok: true, nodes: [] }));
  await page.route(new RegExp(`/api/workflow/nodes/${nodeId}/settings$`), async route => {
    const payload = requestJson(route);
    fixture.settingsPatches.push({ method: route.request().method(), payload });
    if (payload.uiMode === 'chat' || payload.uiMode === 'pty') uiMode = payload.uiMode;
    values = { ...values, ...payload };
    return jsonResponse(route, {
      ok: true,
      node: { nodeId, kind: 'agent', version: 1 },
      settings: { schemaId: 'agent-settings', values, revision: fixture.settingsPatches.length + 1 },
      state: {},
      revision: fixture.settingsPatches.length + 1,
    });
  });
  await page.route(new RegExp(`/api/workflow/nodes/${nodeId}/actions/([^/?]+)$`), async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1) || '';
    fixture.actionRequests.push({ method: route.request().method(), url: route.request().url(), action, payload: requestJson(route) });
    if (action === 'agent.start') status = 'running';
    return jsonResponse(route, { ok: true, action, result: { sessionId, graphNodeId: nodeId } });
  });
  await page.route(new RegExp(`/api/workflow/nodes/${nodeId}(?:\\?.*)?$`), route => {
    return jsonResponse(route, { ok: true, node: runtimeAgentNode(runtime, uiMode, status), state: {}, revision: 1 });
  });
  await page.routeWebSocket('**/ws/chat/**', ws => {
    socket = ws;
    ws.onMessage(message => {
      try { fixture.chatFrames.push(JSON.parse(String(message)) as JsonRecord); } catch {}
    });
    const supportedModes = permissionModes[runtime];
    ws.send(JSON.stringify({
      type: 'chat:state',
      sessionId,
      state: 'running',
      uiMode: 'chat',
      providerSessionId: `provider-${runtime}-session`,
      runtime,
      supportedModes,
      permissionMode: supportedModes[0],
    }));
  });
  fixture.pushEnvelope = (event, payload) => {
    if (!socket) throw new Error('chat WebSocket has not connected');
    seq += 1;
    socket.send(JSON.stringify({
      seq,
      ts: '2026-09-28T00:00:01.000Z',
      type: event,
      payload,
    }));
  };
  return fixture;
}

async function startChatFromSettings(page: Page) {
  await page.goto('/workflow');
  const node = page.locator(`[data-testid="workflow-node"][data-node-id="${nodeId}"]`);
  await expect(node).toBeVisible();

  await node.click({ button: 'right' });
  await page.locator('[data-testid="workflow-node-context-action"][data-action="settings"]').click();
  const settings = page.getByTestId('workflow-component-settings');
  await expect(settings).toBeVisible();

  // The task contract names the two visible surface labels, while intentionally
  // leaving the segmented-control implementation free to use buttons or radios.
  await settings.getByText('Chat', { exact: true }).click();
  await expect.poll(async () => fixtureCountSettings(page)).toBeGreaterThan(0);
  await settings.locator('button[title="Close"]').click();

  await node.click({ button: 'right' });
  const startAction = page.locator(
    '[data-testid="workflow-node-context-action"][data-action="agent.start"], ' +
    '[data-testid="workflow-node-context-action"][data-action="start"]'
  );
  await expect(startAction).toBeVisible();
  await startAction.click();
  await expect.poll(async () => fixtureCountStart(page)).toBe(1);
  await node.dblclick();
  await expect(page.getByTestId('chat-permission-mode')).toBeVisible();
}

async function openRunningChat(page: Page) {
  await page.goto('/workflow');
  const node = page.locator(`[data-testid="workflow-node"][data-node-id="${nodeId}"]`);
  await expect(node).toBeVisible();
  await node.dblclick();
  await expect(page.getByTestId('chat-permission-mode')).toBeVisible();
}

// Keep assertions outside the closure-based fixture setup while still polling
// asynchronous browser requests through the per-page test data registry.
const fixtureByPage = new WeakMap<Page, ChatFixture>();
function fixtureCountSettings(page: Page) { return fixtureByPage.get(page)?.settingsPatches.length || 0; }
function fixtureCountStart(page: Page) { return fixtureByPage.get(page)?.actionRequests.filter(item => item.action === 'agent.start').length || 0; }

async function installAndOpen(page: Page, runtime: string) {
  const fixture = await installChatFixture(page, runtime, { initialChat: true });
  fixtureByPage.set(page, fixture);
  await openRunningChat(page);
  return fixture;
}

test.describe('AC-1/AC-2/AC-4 standalone chat agent', () => {
  test('AC-1/AC-2 chooses Chat in AgentNodeSettings, persists the surface, and starts the same standalone graph node', async ({ page }) => {
    const fixture = await installChatFixture(page, 'claude');
    fixtureByPage.set(page, fixture);
    await startChatFromSettings(page);

    await page.reload();
    const reopenedNode = page.locator(`[data-testid="workflow-node"][data-node-id="${nodeId}"]`);
    await expect(reopenedNode).toBeVisible();
    await reopenedNode.dblclick();
    await expect(page.getByTestId('chat-permission-mode')).toBeVisible();

    expect(fixture.settingsPatches.some(patch => patch.payload.uiMode === 'chat')).toBe(true);
    expect(fixture.actionRequests.filter(request => request.action === 'agent.start')).toHaveLength(1);
    expect(fixture.actionRequests[0]).toMatchObject({
      method: 'POST',
      action: 'agent.start',
      url: expect.stringContaining(`/api/workflow/nodes/${nodeId}/actions/agent.start`),
    });
    const reopenedSnapshot = fixture.snapshotBodies.at(-1)!;
    expect(reopenedSnapshot.graph.edges).toEqual([]);
    const sameGraphNode = reopenedSnapshot.graph.nodes.find((item: JsonRecord) => item.nodeId === nodeId);
    expect(sameGraphNode.sessionId).toBe(sessionId);
    expect(sameGraphNode.uiMode).toBe('chat');
    expect(fixture.pageErrors, 'browser errors').toEqual([]);
  });

  for (const runtime of ['claude', 'codex', 'opencode', 'pi']) {
    test(`AC-4 ${runtime} exposes only its declared permission modes and waits for matching runtime confirmation`, async ({ page }) => {
      const fixture = await installAndOpen(page, runtime);
      const modes = permissionModes[runtime];
      const mode = page.getByTestId('chat-permission-mode');
      await expect(mode).toHaveAccessibleName('Permission mode');
      await expect(mode.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
        .resolves.toEqual(modes);
      await expect(mode).toHaveValue(modes[0]);

      await mode.selectOption(modes[1]);
      await expect.poll(() => fixture.chatFrames.some(frame => frame.type === 'chat:setPermissionMode')).toBe(true);
      const change = fixture.chatFrames.find(frame => frame.type === 'chat:setPermissionMode')!;
      expect(change).toEqual({ type: 'chat:setPermissionMode', requestId: expect.any(String), mode: modes[1] });
      await expect(mode).toHaveValue(modes[0], 'unconfirmed mode must not replace the selected value');

      fixture.pushEnvelope('permission_mode_changed', { requestId: 'unrelated-request', mode: modes[1] });
      await expect(mode).toHaveValue(modes[0], 'a response for another request must be ignored');
      fixture.pushEnvelope('permission_mode_changed', { requestId: change.requestId, mode: modes[1] });
      await expect(mode).toHaveValue(modes[1]);

      await mode.selectOption(modes[2]);
      await expect.poll(() => fixture.chatFrames.filter(frame => frame.type === 'chat:setPermissionMode').length).toBe(2);
      const failedChange = fixture.chatFrames.filter(frame => frame.type === 'chat:setPermissionMode')[1];
      fixture.pushEnvelope('permission_mode_change_failed', {
        requestId: failedChange.requestId,
        mode: modes[2],
        message: 'Runtime rejected that permission mode',
      });
      await expect(mode).toHaveValue(modes[1]);
      await expect(page.getByText('Runtime rejected that permission mode', { exact: true })).toBeVisible();

      const nodeGraphEdges = await page.locator('[data-testid="workflow-edge"]').count();
      expect(nodeGraphEdges).toBe(0, 'starting a standalone chat must not add a subagent edge');
      expect(fixture.chatFrames.filter(frame => frame.type === 'chat:setPermissionMode')).toHaveLength(2);
      expect(fixture.rangeRequests.some(url => url.includes(`/api/chat/${sessionId}/range?fromSeq=`))).toBe(true);
      expect(fixture.pageErrors, 'browser errors').toEqual([]);
    });
  }

  test('AC-4 Pi ask approvals correlate allow/deny by request id and ignore duplicate or stale requests', async ({ page }) => {
    const fixture = await installAndOpen(page, 'pi');
    const allowRequest = {
      seq: 1,
      ts: '2026-09-28T00:00:02.000Z',
      type: 'permission_request',
      payload: { requestId: 'pi-confirm-allow', tool: 'Bash', input: { command: 'ls' }, title: 'List workspace' },
    };
    const denyRequest = {
      seq: 2,
      ts: '2026-09-28T00:00:03.000Z',
      type: 'permission_request',
      payload: { requestId: 'pi-confirm-deny', tool: 'Bash', input: { command: 'remove file' }, title: 'Remove file' },
    };

    fixture.pushEnvelope(allowRequest.type, allowRequest.payload);
    await expect(page.getByText('pi-confirm-allow', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /always allow/i })).toHaveCount(0);
    await page.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect.poll(() => fixture.chatFrames.some(frame => frame.type === 'chat:approve' && frame.requestId === 'pi-confirm-allow')).toBe(true);
    expect(fixture.chatFrames.find(frame => frame.type === 'chat:approve' && frame.requestId === 'pi-confirm-allow'))
      .toEqual({ type: 'chat:approve', requestId: 'pi-confirm-allow', decision: 'allow' });

    fixture.pushEnvelope(allowRequest.type, allowRequest.payload);
    await expect(page.getByText('pi-confirm-allow', { exact: true })).toHaveCount(0);

    fixture.pushEnvelope(denyRequest.type, denyRequest.payload);
    await expect(page.getByText('pi-confirm-deny', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect.poll(() => fixture.chatFrames.some(frame => frame.type === 'chat:approve' && frame.requestId === 'pi-confirm-deny')).toBe(true);
    expect(fixture.chatFrames.find(frame => frame.type === 'chat:approve' && frame.requestId === 'pi-confirm-deny'))
      .toEqual({ type: 'chat:approve', requestId: 'pi-confirm-deny', decision: 'deny' });

    expect(fixture.pageErrors, 'browser errors').toEqual([]);
  });
});
