import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const sessionId = 'e2e-session-w18-main';
const agentNodeId = 'e2e-agent-w18-main';
const markdownNodeId = 'e2e-markdown-w18-target';
const peerMarkdownNodeId = 'e2e-markdown-w18-peer';
const edgeId = 'edge-w18-agent-markdown';
const operationId = 'op-w18-agent-control';

type JsonRecord = Record<string, any>;

type W18Network = {
  workflowNodeRequests: JsonRecord[];
  workflowEdgeRequests: JsonRecord[];
  graphMapRequests: JsonRecord[];
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

function markdownState(nodeId = markdownNodeId, title = nodeId === markdownNodeId ? 'W18 Controlled Notes' : 'W18 Peer Notes') {
  return {
    nodeId,
    type: 'markdown',
    title,
    revision: 1,
    markdown: `# ${title}\n\nAgent-control fixture.`,
    observableInputs: ['markdown'],
    observableOutputs: ['markdown', 'plainText'],
    statePath: `Harness/a2a/component-nodes/${nodeId}/state.json`,
  };
}

function runtimeMarkdownNode(nodeId = markdownNodeId, position = nodeId === markdownNodeId ? { x: 760, y: 320 } : { x: 1060, y: 460 }) {
  const state = markdownState(nodeId);
  return {
    nodeId,
    kind: 'markdown',
    version: state.revision,
    lifecycle: 'ready',
    status: { state: 'ready', updatedAt: '2026-08-05T00:00:00.000Z' },
    graph: {
      position,
      handles: {
        inputs: [],
        outputs: [],
        bidirectional: ['markdown'],
        ports: ['markdown'],
        physical: ['markdown:left', 'markdown:right'],
      },
      connections: nodeId === markdownNodeId
        ? [{
            edgeId,
            peerNodeId: agentNodeId,
            endpointRole: 'target',
            localHandle: 'markdown:left',
            peerHandle: 'right',
            sourceHandle: 'right',
            targetHandle: 'markdown:left',
            relation: 'wf-bridge/context',
            direction: 'bidirectional',
          }]
        : [],
    },
    stateRef: { path: state.statePath, revision: state.revision },
    contentRef: { kind: 'component-state', statePath: state.statePath, revision: state.revision },
    settings: { schemaId: 'markdown-settings', values: {}, revision: 0 },
    capabilities: ['state:read', 'state:update', 'markdown:append', 'markdown:replace'],
    ui: { previewKind: 'markdown', settingsPanel: 'markdown-settings', testId: 'workflow-markdown-node', labels: { title: state.title } },
  };
}

function recentOperation(activeUntilMs: number) {
  const startedAt = new Date(activeUntilMs - 15_000).toISOString();
  const completedAt = new Date(activeUntilMs - 3_000).toISOString();
  return {
    id: operationId,
    kind: 'agent.moveNode',
    actor: {
      type: 'agent',
      nodeId: agentNodeId,
      sessionId,
      agentKind: 'main',
    },
    targetNodeIds: [markdownNodeId],
    edgeIds: [edgeId],
    status: 'completed',
    startedAt,
    completedAt,
    expiresAt: new Date(activeUntilMs).toISOString(),
  };
}

function workflowSnapshot(activeUntilMs: number) {
  const state = markdownState();
  const peerState = markdownState(peerMarkdownNodeId);
  const agentPosition = { x: 420, y: 220 };
  const markdownPosition = { x: 760, y: 320 };
  const peerPosition = { x: 1060, y: 460 };
  const edge = {
    id: edgeId,
    from: agentNodeId,
    to: markdownNodeId,
    source: agentNodeId,
    target: markdownNodeId,
    relation: 'wf-bridge/context',
    direction: 'bidirectional',
    sourceHandle: 'right',
    targetHandle: 'markdown:left',
    label: 'context <-> markdown',
  };
  const operation = recentOperation(activeUntilMs);

  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-05T00:00:00.000Z',
    workflowId: 'e2e-workflow-w18',
    taskId: 'task-standardize-workflow-nodes',
    mode: 'wf-max',
    phase: 'w18-red',
    gate: 'TEST-GATE',
    rootAgentId: agentNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    workflow: {
      operations: {
        recent: [operation],
      },
    },
    sessions: [{
      sessionId,
      runtime: 'codex',
      role: 'main',
      status: 'running',
      attachMode: true,
      wsClientCount: 1,
      agentKind: 'main',
      workflowMode: 'wf-max',
      cwd: repoRoot,
      graphNodeId: agentNodeId,
      inputOwnerId: 'drawer',
    }],
    nodes: [{
      id: agentNodeId,
      label: 'W18 Main Agent',
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
      objective: 'W18 Agent control operation layer fixture',
      cwd: repoRoot,
      graphNodeId: agentNodeId,
    }, {
      id: markdownNodeId,
      label: state.title,
      kind: 'component-node',
      componentType: 'markdown',
      type: 'markdown',
      level: 0,
      status: 'ready',
      lifecycle: 'stateful',
      runtimeState: 'ready',
      managedByCurrentServer: true,
      control: control(),
      graphNodeId: markdownNodeId,
      revision: state.revision,
      statePath: state.statePath,
      observableInputs: state.observableInputs,
      observableOutputs: state.observableOutputs,
      position: markdownPosition,
    }, {
      id: peerMarkdownNodeId,
      label: peerState.title,
      kind: 'component-node',
      componentType: 'markdown',
      type: 'markdown',
      level: 0,
      status: 'ready',
      lifecycle: 'stateful',
      runtimeState: 'ready',
      managedByCurrentServer: true,
      control: control(),
      graphNodeId: peerMarkdownNodeId,
      revision: peerState.revision,
      statePath: peerState.statePath,
      observableInputs: peerState.observableInputs,
      observableOutputs: peerState.observableOutputs,
      position: peerPosition,
    }],
    edges: [edge],
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-w18',
      version: 1,
      nodes: [{
        nodeId: agentNodeId,
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
      }, {
        nodeId: markdownNodeId,
        kind: 'component-node',
        componentType: 'markdown',
        status: 'ready',
        lifecycle: 'stateful',
        runtimeState: 'ready',
        managedByCurrentServer: true,
        control: control(),
        position: markdownPosition,
        statePath: state.statePath,
        revision: state.revision,
        stateRef: { path: state.statePath, revision: state.revision },
      }, {
        nodeId: peerMarkdownNodeId,
        kind: 'component-node',
        componentType: 'markdown',
        status: 'ready',
        lifecycle: 'stateful',
        runtimeState: 'ready',
        managedByCurrentServer: true,
        control: control(),
        position: peerPosition,
        statePath: peerState.statePath,
        revision: peerState.revision,
        stateRef: { path: peerState.statePath, revision: peerState.revision },
      }],
      edges: [edge],
      positions: {
        [agentNodeId]: agentPosition,
        [markdownNodeId]: markdownPosition,
        [peerMarkdownNodeId]: peerPosition,
      },
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes',
      sourceOfTruth: 'backend',
      componentStateRefs: {
        [markdownNodeId]: {
          type: state.type,
          title: state.title,
          statePath: state.statePath,
          revision: state.revision,
        },
        [peerMarkdownNodeId]: {
          type: peerState.type,
          title: peerState.title,
          statePath: peerState.statePath,
          revision: peerState.revision,
        },
      },
    },
    componentNodes: {
      [markdownNodeId]: state,
      [peerMarkdownNodeId]: peerState,
    },
    graphContextBySessionId: {
      [sessionId]: {
        workflowMapPath: 'Harness/a2a/workflow-map.json',
        componentStatePath: 'Harness/a2a/component-nodes',
        sourceOfTruth: 'backend',
        componentStateRefs: {
          [markdownNodeId]: {
            type: state.type,
            title: state.title,
            statePath: state.statePath,
            revision: state.revision,
          },
          [peerMarkdownNodeId]: {
            type: peerState.type,
            title: peerState.title,
            statePath: peerState.statePath,
            revision: peerState.revision,
          },
        },
        connectedResourceRefs: [{
          nodeId: markdownNodeId,
          type: 'markdown',
          direction: 'bidirectional',
          endpointRole: 'target',
          edgeId,
          stateRef: { path: state.statePath, revision: state.revision },
          capabilities: ['state:read', 'state:update', 'markdown:append', 'markdown:replace'],
        }],
      },
    },
  };
}

function requestJson(route: Route) {
  try {
    return route.request().postData() ? route.request().postDataJSON() as JsonRecord : {};
  } catch {
    return {};
  }
}

async function installW18Fixture(page: Page, activeUntilMs = Date.now() + 2500): Promise<W18Network> {
  const network: W18Network = {
    workflowNodeRequests: [],
    workflowEdgeRequests: [],
    graphMapRequests: [],
  };
  let snapshot = workflowSnapshot(activeUntilMs) as JsonRecord;
  let committedGraph = cloneJson(snapshot.graph) as JsonRecord;

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/project', route => jsonResponse(route, { root: repoRoot }));
  await page.route('**/api/workflow', route => jsonResponse(route, {
    taskId: 'task-standardize-workflow-nodes',
    phase: 'w18-red',
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
    phase: 'w18-red',
  }]));
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, {
    ...snapshot,
    graph: committedGraph,
  }));
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, snapshot.sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, {
    entries: [{ seq: 1, stream: 'stdout', data: '\r\nW18 terminal fixture ready\r\n' }],
  }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/workspace/tree**', route => jsonResponse(route, {
    root: repoRoot,
    path: '',
    entries: [{ name: 'package.json', path: 'package.json', type: 'file', size: 820, hasChildren: false }],
  }));
  await page.route('**/api/a2a/graph-map**', route => {
    const payload = requestJson(route);
    network.graphMapRequests.push({ method: route.request().method(), url: route.request().url(), payload });
    if (route.request().method() === 'PUT') {
      committedGraph = {
        ...committedGraph,
        ...cloneJson(payload),
        version: Number(payload.version || committedGraph.version || 1),
        nodes: Array.isArray(payload.nodes) ? cloneJson(payload.nodes) : committedGraph.nodes,
        edges: Array.isArray(payload.edges) ? cloneJson(payload.edges) : committedGraph.edges,
        positions: payload.positions && typeof payload.positions === 'object'
          ? cloneJson(payload.positions)
          : committedGraph.positions,
      };
      snapshot = { ...snapshot, graph: committedGraph };
    }
    return jsonResponse(route, { ok: true, revision: Number(committedGraph.version || 1), graph: cloneJson(committedGraph), sourceOfTruth: 'backend' });
  });
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, route => {
    network.workflowNodeRequests.push({ method: route.request().method(), url: route.request().url(), payload: requestJson(route) });
    if (route.request().method() === 'GET') {
      return jsonResponse(route, { ok: true, nodes: [runtimeMarkdownNode(), runtimeMarkdownNode(peerMarkdownNodeId)] });
    }
    return jsonResponse(route, {
      ok: true,
      operation: { id: 'op-w18-create-node', kind: 'graph.createNode' },
      node: runtimeMarkdownNode('e2e-markdown-w18-created', { x: 900, y: 460 }),
      state: markdownState('e2e-markdown-w18-created', 'W18 Browser Intent Node'),
      revision: 2,
    }, 201);
  });
  await page.route(/\/api\/workflow\/nodes\/.+/, route => {
    network.workflowNodeRequests.push({ method: route.request().method(), url: route.request().url(), payload: requestJson(route) });
    const nodeId = new URL(route.request().url()).pathname.split('/').filter(Boolean)[3] || markdownNodeId;
    return jsonResponse(route, { ok: true, node: runtimeMarkdownNode(nodeId), state: markdownState(nodeId), revision: 1 });
  });
  await page.route(/\/api\/workflow\/edges(?:\?.*)?$/, route => {
    const payload = requestJson(route);
    network.workflowEdgeRequests.push({ method: route.request().method(), url: route.request().url(), payload });
    return jsonResponse(route, {
      ok: true,
      operation: { id: 'op-w18-connect-nodes', kind: 'graph.connectNodes' },
      edge: {
        id: `edge-${payload.from || payload.source}-${payload.to || payload.target}`,
        from: payload.from || payload.source,
        to: payload.to || payload.target,
        source: payload.from || payload.source,
        target: payload.to || payload.target,
        relation: payload.relation || 'wf-bridge/context',
        direction: payload.direction || 'bidirectional',
        sourceHandle: payload.sourceHandle || null,
        targetHandle: payload.targetHandle || null,
      },
    }, 201);
  });
  await page.route(/\/api\/workflow\/edges\/.+/, route => {
    network.workflowEdgeRequests.push({ method: route.request().method(), url: route.request().url(), payload: requestJson(route) });
    return jsonResponse(route, {
      ok: true,
      operation: { id: 'op-w18-disconnect-nodes', kind: 'graph.disconnectNodes' },
    });
  });
  await page.route('**/api/user-files', route => jsonResponse(route, { ok: true, files: [] }));

  return network;
}

async function openWorkflow(page: Page) {
  await page.goto('/workflow');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-wf-browser-ready', 'true');
  await expect(page.locator(`[data-testid="workflow-node"][data-node-id="${agentNodeId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="workflow-component-node"][data-node-id="${peerMarkdownNodeId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="workflow-edge"][data-source="${agentNodeId}"][data-target="${markdownNodeId}"]`)).toBeVisible();
}

async function dispatchBrowserIntent(page: Page, intent: string, payload: JsonRecord) {
  return page.evaluate(({ intent, payload }) => new Promise<JsonRecord>(resolve => {
    const detail: JsonRecord = {
      intent,
      payload,
      resolve: (value: unknown) => resolve({ ok: true, handled: Boolean(detail.handled), value }),
      reject: (error: unknown) => resolve({ ok: false, handled: Boolean(detail.handled), error: String(error) }),
    };
    window.dispatchEvent(new CustomEvent('harness:wf-browser:intent', { detail }));
    window.setTimeout(() => resolve({ ok: false, handled: Boolean(detail.handled), timeout: true }), 600);
  }), { intent, payload });
}

function operationMetadataMatcher(kind: string) {
  return expect.objectContaining({
    ok: true,
    value: expect.objectContaining({
      ok: true,
      intent: kind,
      operation: expect.objectContaining({
        id: expect.any(String),
        kind,
      }),
    }),
  });
}

test.describe('WF UI M6 RED Agent control operation layer acceptance', () => {
  test('W18-UI-CONTROL W18-DATA-FLOW active Agent operation marks canvas, controlled node, and animated edge until expiry', async ({ page }) => {
    test.setTimeout(60_000);
    const activeUntilMs = Date.now() + 2500;
    await installW18Fixture(page, activeUntilMs);
    await openWorkflow(page);

    const canvas = page.getByTestId('workflow-canvas');
    const targetNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    const flowEdge = page.locator(`[data-testid="workflow-edge"][data-source="${agentNodeId}"][data-target="${markdownNodeId}"]`);
    const edgePath = flowEdge.locator('.react-flow__edge-path').first();

    await expect(canvas).toHaveAttribute('data-agent-control-active', 'true');
    await expect(targetNode).toHaveAttribute('data-agent-controlled', 'true');
    await expect(targetNode).toHaveAttribute('data-agent-control-operation-id', operationId);
    await expect(flowEdge).toHaveAttribute('data-agent-flow', 'true');
    await expect(flowEdge).toHaveAttribute('data-agent-flow-operation-id', operationId);
    await expect(edgePath).toHaveCSS('animation-name', /agent|flow|dash|pulse/i);

    await page.waitForTimeout(Math.max(0, activeUntilMs - Date.now()) + 700);
    await expect(canvas).not.toHaveAttribute('data-agent-control-active', 'true');
    await expect(targetNode).not.toHaveAttribute('data-agent-controlled', 'true');
    await expect(flowEdge).not.toHaveAttribute('data-agent-flow', 'true');
    await expect(flowEdge, 'edge remains connected after operation fade-out').toBeVisible();
  });

  test('W18-PARITY browser intents create/connect/disconnect/move/delete nodes with operation metadata and no duplicate graph path', async ({ page }) => {
    const network = await installW18Fixture(page, Date.now() + 10_000);
    await openWorkflow(page);

    const mutationRequests = () => [
      ...network.workflowNodeRequests,
      ...network.workflowEdgeRequests,
      ...network.graphMapRequests,
    ].filter(request => ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method));
    const dispatchAndMeasure = async (intent: string, payload: JsonRecord) => {
      const before = mutationRequests().length;
      const result = await dispatchBrowserIntent(page, intent, payload);
      const mutations = mutationRequests().slice(before);
      return { result, mutations };
    };

    const create = await dispatchAndMeasure('graph.createNode', {
      type: 'markdown',
      title: 'W18 Browser Intent Node',
      position: { x: 900, y: 460 },
    });
    const connect = await dispatchAndMeasure('graph.connectNodes', {
      sourceNodeId: agentNodeId,
      targetNodeId: peerMarkdownNodeId,
      sourceHandle: 'right',
      targetHandle: 'markdown:left',
      relation: 'wf-bridge/context',
    });
    const move = await dispatchAndMeasure('graph.moveNode', {
      nodeId: markdownNodeId,
      position: { x: 940, y: 500 },
    });
    const disconnect = await dispatchAndMeasure('graph.disconnectNodes', {
      edgeId: 'edge-w18-agent-peer',
      sourceNodeId: agentNodeId,
      targetNodeId: peerMarkdownNodeId,
    });
    const deleteNode = await dispatchAndMeasure('graph.deleteNode', {
      actorNodeId: agentNodeId,
      targetNodeId: peerMarkdownNodeId,
    });

    for (const [intent, attempt] of Object.entries({
      'graph.createNode': create,
      'graph.connectNodes': connect,
      'graph.moveNode': move,
      'graph.disconnectNodes': disconnect,
      'graph.deleteNode': deleteNode,
    })) {
      expect.soft(attempt.result).toEqual(operationMetadataMatcher(intent));
      const mutationKeys = attempt.mutations.map(request => `${request.method} ${new URL(request.url).pathname}`);
      expect.soft(mutationKeys, `${intent} should perform one semantic mutation request`).toHaveLength(1);
      expect.soft(new Set(mutationKeys).size, `${intent} duplicate mutation paths: ${mutationKeys.join(', ')}`).toBe(mutationKeys.length);
    }
  });
});
