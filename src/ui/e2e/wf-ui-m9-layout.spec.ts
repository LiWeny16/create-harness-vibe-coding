// wf-ui-m9-layout.spec.ts
//
// M9 layout optimization acceptance (task-optimize-graph-layout):
//   AC-002 (Test A): the toolbar "Tidy" button re-lays out the whole graph
//     hierarchically — layers by edge direction, no overlapping pairs
//     (>= 16px gap), positions persisted through the client -> graph-map PUT.
//   AC-001 (Test B): a newly created node never overlaps existing nodes and
//     existing node positions are never changed by creation.
//   AC-001/HIGH-1 (Test C): the agent-create session POST carries the client
//     position so the server materializes the node at that spot (review
//     finding HIGH-1; W5 fix wave).
//
// The server layout action (POST /api/workflow/nodes/:actor/actions/agent.layout
// with {mode:'tidy'}) is mocked below so the spec exercises the real client
// path independent of server wave W2. After W2 lands the mock MAY be removed
// to hit the real endpoint — the route handler also documents the wire
// contract: 200 {ok:true, action:'layout', positions:{[nodeId]:{x,y}}}.
//
// Fixture/mocking style follows wf-ui-m3-component-nodes.spec.ts and
// wf-ui-m4-magnetic.spec.ts (page.route + in-memory graph state + snapshot).
import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const mainAgentNodeId = 'layout-agent-main';
const mainAgentSessionId = 'layout-session-main';
const goalNodeId = 'layout-goal';
const markdownNodeId = 'layout-resource-markdown';
const fileNodeId = 'layout-resource-file';

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

type GoalState = {
  nodeId: string;
  type: 'goal';
  title: string;
  taskId: string;
  objective: string;
  status: string;
  phase: string;
  gate: string;
  revision: number;
  acceptance: JsonRecord[];
  progress: { verified: number; total: number };
  nextAction: string;
  stateRef: { path: string; revision: number };
  contentRef: { planPath: string; progressPath: string };
  statePath: string;
};

type GraphState = {
  positions: Record<string, { x: number; y: number }>;
  edges: JsonRecord[];
  capsuleDockLinks: JsonRecord[];
  version: number;
};

type CreatedAgent = {
  nodeId: string;
  sessionId: string;
  label: string;
};

type Network = {
  layoutRequests: JsonRecord[];
  graphMapRequests: JsonRecord[];
  createRequests: JsonRecord[];
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

function defaultComponentState(type: ComponentType, nodeId: string): ComponentState {
  const title = type === 'markdown' ? 'M9 Notes' : 'M9 File';
  return {
    nodeId,
    type,
    title,
    revision: 1,
    markdown: type === 'markdown' ? '# M9 Notes\n\nLayout fixture.' : undefined,
    file: type === 'file'
      ? { source: 'workspace', path: 'package.json', name: 'package.json', mime: 'application/json', size: 820 }
      : undefined,
    observableInputs: type === 'markdown' ? ['markdown'] : ['file'],
    observableOutputs: type === 'markdown' ? ['markdown', 'plainText'] : ['file', 'path'],
    statePath: `Harness/a2a/component-nodes/${nodeId}/state.json`,
  };
}

function defaultGoalState(): GoalState {
  return {
    nodeId: goalNodeId,
    type: 'goal',
    title: 'M9 Goal',
    taskId: 'task-m9-layout',
    objective: 'Lay out the graph without overlaps.',
    status: 'active',
    phase: 'implement',
    gate: 'TEST-GATE',
    revision: 1,
    acceptance: [{ id: 'AC-002', text: 'Tidy re-lays out by edge direction.', status: 'tracked' }],
    progress: { verified: 0, total: 1 },
    nextAction: 'Run tidy.',
    stateRef: { path: 'Harness/tasks/task-m9-layout/STATE.json', revision: 1 },
    contentRef: { planPath: 'Harness/tasks/task-m9-layout/PLAN.md', progressPath: 'Harness/tasks/task-m9-layout/PROGRESS.md' },
    statePath: 'Harness/tasks/task-m9-layout/STATE.json',
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
    graph: { position, handles, connections: [] },
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

function workflowSnapshot(graphState: GraphState, components: ComponentState[], goal: GoalState | null, createdAgents: CreatedAgent[] = []) {
  const componentNodes = components.map(state => componentNodeSnapshot(state, graphState.positions[state.nodeId]));
  const goalNodes = goal ? [{
    id: goal.nodeId,
    label: goal.title,
    kind: 'goal-node',
    type: 'goal',
    level: 0,
    status: goal.status,
    lifecycle: 'goal-anchor',
    runtimeState: goal.status,
    managedByCurrentServer: true,
    revision: goal.revision,
    statePath: goal.statePath,
    position: graphState.positions[goal.nodeId],
  }] : [];
  const componentStateRefs = Object.fromEntries(components.map(state => [state.nodeId, {
    type: state.type,
    title: state.title,
    statePath: state.statePath,
    revision: state.revision,
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
    taskId: 'task-m9-layout',
    cwd: repoRoot,
    skills: ['wf-max'],
    permissions: ['terminal'],
  };
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-m9',
    taskId: 'task-m9-layout',
    mode: 'wf-max',
    phase: 'm9-red',
    gate: 'TEST-GATE',
    rootAgentId: mainAgentNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [
      { sessionId: mainAgentSessionId, runtime: 'codex', role: 'main', status: 'running', attachMode: true, graphNodeId: mainAgentNodeId, cwd: repoRoot },
      ...createdAgents.map(agent => ({
        sessionId: agent.sessionId,
        runtime: 'codex',
        role: 'subagent',
        status: 'running',
        attachMode: true,
        graphNodeId: agent.nodeId,
        cwd: repoRoot,
      })),
    ],
    nodes: [
      { ...baseAgent, id: mainAgentNodeId, label: 'M9 Agent', role: 'main', agentKind: 'main', sessionId: mainAgentSessionId, graphNodeId: mainAgentNodeId, objective: 'M9 layout agent' },
      ...componentNodes,
      ...goalNodes,
      ...createdAgents.map(agent => ({
        ...baseAgent,
        id: agent.nodeId,
        label: agent.label,
        role: 'subagent',
        agentKind: 'subagent',
        sessionId: agent.sessionId,
        graphNodeId: agent.nodeId,
        objective: 'M9 created agent',
      })),
    ],
    edges: graphState.edges.map(edge => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      source: edge.from,
      target: edge.to,
      relation: edge.relation || 'wf-bridge',
      direction: edge.direction || 'bidirectional',
      offset: edge.offset,
    })),
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-m9',
      version: graphState.version,
      nodes: [
        { nodeId: mainAgentNodeId, sessionId: mainAgentSessionId, kind: 'terminal-session', agentKind: 'main', runtime: 'codex', status: 'running', lifecycle: 'live', runtimeState: 'running', control: control(), taskId: 'task-m9-layout', cwd: repoRoot, position: graphState.positions[mainAgentNodeId] },
        ...componentNodes.map(node => ({
          nodeId: node.id,
          kind: 'component-node',
          componentType: node.componentType,
          type: node.type,
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
        ...goalNodes.map(node => ({
          nodeId: node.id,
          kind: 'goal-node',
          type: 'goal',
          status: node.status,
          lifecycle: 'goal-anchor',
          runtimeState: node.status,
          managedByCurrentServer: true,
          control: control(),
          position: graphState.positions[node.id],
          statePath: node.statePath,
          revision: node.revision,
        })),
        ...createdAgents.map(agent => ({
          nodeId: agent.nodeId,
          sessionId: agent.sessionId,
          kind: 'terminal-session',
          agentKind: 'subagent',
          runtime: 'codex',
          status: 'running',
          lifecycle: 'live',
          runtimeState: 'running',
          managedByCurrentServer: true,
          control: control(),
          taskId: 'task-m9-layout',
          cwd: repoRoot,
          position: graphState.positions[agent.nodeId],
        })),
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
    eventNodes: {},
    graphContextBySessionId: {},
  };
}

// Mock positions the agent-tree engine is expected to return for the fixture
// (goal + file owned by the main agent via edges -> both in the matrix band
// ABOVE main, one row, centered; main sits below the band). Rows are sized for
// the REAL rendered fixture node sizes (goal ~374px tall, agent 560x358, per
// W4 real-browser measurement), not the server's 280x180 slot — a 500px
// vertical pitch guarantees >= 16px clearance for every pair even after
// fitView (pairwise gaps are scale-invariant).
const AGENT_TREE_POSITIONS: Record<string, { x: number; y: number }> = {
  [goalNodeId]: { x: -200, y: 200 },
  [fileNodeId]: { x: 420, y: 200 },
  [mainAgentNodeId]: { x: 260, y: 900 },
};

type FixtureOptions = {
  components?: ComponentType[];
  includeGoal?: boolean;
  positions: Record<string, { x: number; y: number }>;
  edges?: JsonRecord[];
};

async function installWorkflowFixture(page: Page, options: FixtureOptions): Promise<{ network: Network; graphState: GraphState }> {
  const components = new Map<string, ComponentState>();
  for (const type of options.components || []) {
    const nodeId = type === 'markdown' ? markdownNodeId : fileNodeId;
    components.set(nodeId, defaultComponentState(type, nodeId));
  }
  const goal: GoalState | null = options.includeGoal ? defaultGoalState() : null;
  const graphState: GraphState = {
    positions: cloneJson(options.positions),
    edges: cloneJson(options.edges || []),
    capsuleDockLinks: [],
    version: 1,
  };
  const createdAgents = new Map<string, CreatedAgent>();
  const network: Network = { layoutRequests: [], graphMapRequests: [], createRequests: [], pageErrors: [], failedResponses: [] };

  page.on('pageerror', error => network.pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('favicon.ico')) {
      network.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  const currentSnapshot = () => workflowSnapshot(graphState, [...components.values()], goal, [...createdAgents.values()]);

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, { taskId: 'task-m9-layout', phase: 'm9-red', gate: 'TEST-GATE' }));
  await page.route('**/api/runtimes**', route => jsonResponse(route, [{
    id: 'codex', label: 'Codex', command: 'codex', path: 'codex', version: 'test',
    status: 'available', launchable: true, adapterStatus: 'ok', capabilities: ['terminal'],
  }]));
  await page.route('**/api/tasks**', route => jsonResponse(route, [{ taskId: 'task-m9-layout', status: 'open', phase: 'm9-red' }]));
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, currentSnapshot()));
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, currentSnapshot().sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, { entries: [{ seq: 1, stream: 'stdout', data: '\r\nM9 terminal fixture\r\n' }] }));
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
      graphState.version += 1;
    }
    const snapshot = currentSnapshot();
    return jsonResponse(route, { ok: true, revision: graphState.version, graph: snapshot.graph, sourceOfTruth: 'backend' });
  });
  await page.route('**/api/workspace/tree**', route => jsonResponse(route, { root: repoRoot, path: '', entries: [] }));
  await page.route('**/api/workspace/meta**', route => jsonResponse(route, { ok: true, exists: false }));
  await page.route('**/api/workspace/text**', route => jsonResponse(route, { text: '{}', bytesRead: 2, truncated: false, encoding: 'utf-8' }));
  await page.route('**/api/workspace/file**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route(/\/api\/workflow\/edges(?:\?.*)?$/, route => jsonResponse(route, { ok: true, edge: { id: 'edge-new', from: mainAgentNodeId, to: goalNodeId } }, 201));
  await page.route('**/api/user-files', route => jsonResponse(route, { ok: true, files: [] }));

  // Node list + node creation (POST /api/workflow/nodes carries the client
  // computed position; the created node is added to the fixture state).
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      return jsonResponse(route, {
        ok: true,
        nodes: [...components.values()].map(state => runtimeNodeSnapshot(state, graphState.positions[state.nodeId])),
      });
    }
    const payload = req.postData() ? req.postDataJSON() as JsonRecord : {};
    network.createRequests.push({ method: req.method(), url: req.url(), payload });
    const type = payload.type as ComponentType;
    const fileCount = [...components.keys()].filter(id => id.startsWith('component-file-')).length + 1;
    const nodeId = type === 'file' ? `component-file-${fileCount}` : markdownNodeId;
    const state = defaultComponentState(type, nodeId);
    state.title = String(payload.title || state.title);
    if (payload.file) state.file = payload.file;
    if (payload.markdown) state.markdown = payload.markdown;
    components.set(nodeId, state);
    const position = payload.position && typeof payload.position?.x === 'number' && typeof payload.position?.y === 'number'
      ? { x: Number(payload.position.x), y: Number(payload.position.y) }
      : { x: 260, y: 420 };
    graphState.positions[nodeId] = position;
    graphState.version += 1;
    return jsonResponse(route, {
      ok: true,
      node: runtimeNodeSnapshot(state, position),
      state,
      revision: state.revision,
    });
  });

  // Runtime node lookup by id (fetchRuntimeNode after create).
  await page.route(/\/api\/workflow\/nodes\/[^/]+/, async route => {
    if (route.request().method() !== 'GET') return jsonResponse(route, { ok: true });
    const url = new URL(route.request().url());
    const nodeId = url.pathname.split('/').filter(Boolean)[3] || '';
    const state = components.get(nodeId);
    if (!state) return jsonResponse(route, { ok: true, node: null }, 404);
    return jsonResponse(route, {
      ok: true,
      node: runtimeNodeSnapshot(state, graphState.positions[nodeId]),
      state,
      revision: state.revision,
    });
  });

  // Layout action mock (registered last so it wins over the generic node
  // route): wire contract POST /api/workflow/nodes/:actor/actions/agent.layout
  // {mode:'agent-tree', sizes?} -> {ok:true, action:'layout', positions}.
  // A non-agent-tree mode answers 400 so the spec fails if the client ever
  // regresses to the old tidy mode.
  await page.route(/\/api\/workflow\/nodes\/[^/]+\/actions\/agent\.layout/, route => {
    const req = route.request();
    const payload = req.postData() ? req.postDataJSON() as JsonRecord : {};
    network.layoutRequests.push({ method: req.method(), url: req.url(), payload });
    if (payload.mode !== 'agent-tree') {
      return jsonResponse(route, { error: 'expected agent-tree mode' }, 400);
    }
    return jsonResponse(route, { ok: true, action: 'layout', positions: cloneJson(AGENT_TREE_POSITIONS) });
  });

  // Session creation (HIGH-1): the client's agent-create POST must carry the
  // client-computed free spot; the server materializes the graph node AT that
  // position (positions map + snapshot). When the payload has no position
  // (pre-fix), the mock reproduces the old slot-based server behavior: a
  // 280x180 slot at (660,420) that overlaps the fixture's markdown node —
  // exactly the clobber the fix removes.
  await page.route('**/api/sessions', async route => {
    const req = route.request();
    if (req.method() !== 'POST') {
      return jsonResponse(route, currentSnapshot().sessions);
    }
    const payload = req.postData() ? req.postDataJSON() as JsonRecord : {};
    network.createRequests.push({ method: req.method(), url: req.url(), payload });
    const count = createdAgents.size + 1;
    const sessionId = `layout-created-session-${count}`;
    const nodeId = `session-${sessionId}`;
    const position = payload.position && typeof payload.position?.x === 'number' && typeof payload.position?.y === 'number'
      ? { x: Number(payload.position.x), y: Number(payload.position.y) }
      : { x: 660, y: 420 };
    createdAgents.set(nodeId, { nodeId, sessionId, label: String(payload.displayName || 'M9 Created Agent') });
    graphState.positions[nodeId] = position;
    graphState.version += 1;
    return jsonResponse(route, {
      sessionId,
      graphNodeId: nodeId,
      runtime: String(payload.runtime || 'codex'),
      agentKind: String(payload.agentKind || 'subagent'),
      role: String(payload.role || 'Subagent'),
      status: 'running',
      attachMode: true,
      cwd: repoRoot,
      taskId: payload.taskId || null,
    }, 201);
  });

  return { network, graphState };
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

// React Flow applies a uniform scale to .react-flow__viewport (fitView after
// tidy); pairwise gaps/order are scale-invariant, so read boxes in graph
// space by dividing the viewport scale out (translation cancels pairwise).
async function viewportScale(page: Page): Promise<number> {
  const transform = await page.locator('.react-flow__viewport').evaluate(el => getComputedStyle(el).transform);
  const match = /matrix\(([^,]+)/.exec(transform || '');
  const scale = match ? Number.parseFloat(match[1]) : 1;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

type Box = { x: number; y: number; w: number; h: number };

function minGapBetween(a: Box, b: Box): number {
  const sepX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
  const sepY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
  return Math.max(sepX, sepY);
}

// Playwright boundingBox() returns {x,y,width,height} but minGapBetween reads
// w/h — map to Box the same way allGraphSpaceBoxes does below.
function toBox(box: { x: number; y: number; width: number; height: number }): Box {
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

async function allGraphSpaceBoxes(page: Page): Promise<Box[]> {
  const scale = await viewportScale(page);
  const nodes = page.locator('.react-flow__node');
  const count = await nodes.count();
  const boxes: Box[] = [];
  for (let i = 0; i < count; i++) {
    const box = await nodes.nth(i).boundingBox();
    if (box) boxes.push({ x: box.x / scale, y: box.y / scale, w: box.width / scale, h: box.height / scale });
  }
  return boxes;
}

test.describe('WF UI M9 layout optimization', () => {
  test('AC-002 tidy button re-lays out the graph agent-centric (assets above, main below) with zero overlaps', async ({ page }) => {
    // Deliberately scrambled initial graph: goal below, file in the middle,
    // overlapping the agent — exactly what the tidy button must fix.
    const { network } = await installWorkflowFixture(page, {
      components: ['file'],
      includeGoal: true,
      positions: {
        [mainAgentNodeId]: { x: 500, y: 200 },
        [fileNodeId]: { x: 500, y: 400 },
        [goalNodeId]: { x: 500, y: 620 },
      },
      edges: [
        { id: 'edge-goal-agent', from: goalNodeId, to: mainAgentNodeId, relation: 'delegates', direction: 'source-to-target' },
        { id: 'edge-agent-file', from: mainAgentNodeId, to: fileNodeId, relation: 'delegates', direction: 'source-to-target' },
      ],
    });
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    const button = page.getByTestId('workflow-tidy-layout');
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    // i18n label lands with W3 translations; only assert the control is
    // labeled somehow (en "Tidy layout" / zh "整理布局").
    const label = (await button.getAttribute('aria-label'))
      || (await button.getAttribute('title'))
      || (await button.textContent()) || '';
    expect(label.length).toBeGreaterThan(0);

    await button.click();

    // Network contract: one POST to the agent.layout action with agent-tree mode.
    await expect.poll(() => network.layoutRequests.length).toBeGreaterThanOrEqual(1);
    const layoutReq = network.layoutRequests[network.layoutRequests.length - 1];
    expect(layoutReq.method).toBe('POST');
    expect(String(layoutReq.url)).toContain(`/api/workflow/nodes/${mainAgentNodeId}/actions/agent.layout`);
    expect(layoutReq.payload).toMatchObject({ mode: 'agent-tree' });

    // Client persists the server positions through the debounced graph-map PUT.
    await expect.poll(() => {
      const puts = network.graphMapRequests.filter(r => r.method === 'PUT');
      const last = puts[puts.length - 1];
      const positions = (last?.payload as JsonRecord | undefined)?.positions as JsonRecord | undefined;
      return positions?.[goalNodeId];
    }).toEqual(AGENT_TREE_POSITIONS[goalNodeId]);

    await waitForCanvasSettlement(page);
    await page.waitForTimeout(150);

    // AC-002: every rendered node pair keeps >= 16px clearance (graph space).
    const boxes = await allGraphSpaceBoxes(page);
    expect(boxes.length, 'all fixture nodes rendered').toBeGreaterThanOrEqual(3);
    let minGap = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        minGap = Math.min(minGap, minGapBetween(boxes[i], boxes[j]));
      }
    }
    expect(minGap, `no overlapping pairs after tidy (min gap ${minGap})`).toBeGreaterThanOrEqual(16);

    // Agent-tree contract: goal + file (main's assets) sit in the matrix band
    // ABOVE main on the same row; main anchors the row below.
    const goalBox = await page.locator(`[data-testid="workflow-goal-node"][data-node-id="${goalNodeId}"]`).boundingBox();
    const agentBox = await page.locator(`[data-testid="workflow-node"][data-node-id="${mainAgentNodeId}"]`).boundingBox();
    const fileBox = await page.locator(`[data-testid="workflow-component-node"][data-node-id="${fileNodeId}"]`).boundingBox();
    expect(goalBox).not.toBeNull();
    expect(agentBox).not.toBeNull();
    expect(fileBox).not.toBeNull();
    expect(goalBox!.y, 'goal band above agent').toBeLessThan(agentBox!.y);
    expect(fileBox!.y, 'file band above agent').toBeLessThan(agentBox!.y);
    expect(Math.abs(goalBox!.y - fileBox!.y), 'assets share one matrix band row').toBeLessThanOrEqual(2);

    await expect(button).toBeEnabled();
    expect(network.pageErrors, 'page errors').toEqual([]);
  });

  test('AC-001 new node never overlaps existing nodes and existing nodes never move', async ({ page }) => {
    // The current pre-fix client places a new component at
    // (260 + componentCount*400, 420 when a main agent exists) — the fixture
    // puts the markdown node exactly on that slot, so the pre-fix client
    // overlaps it and the test is RED until the free-spot helper lands.
    const { network } = await installWorkflowFixture(page, {
      components: ['markdown'],
      includeGoal: false,
      positions: {
        [mainAgentNodeId]: { x: 260, y: 300 },
        [markdownNodeId]: { x: 660, y: 420 },
      },
      edges: [],
    });
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${mainAgentNodeId}"]`);
    const markdownNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
    await expect(agentNode).toBeVisible();
    await expect(markdownNode).toBeVisible();

    const before = [await agentNode.boundingBox(), await markdownNode.boundingBox()];
    expect(before[0]).not.toBeNull();
    expect(before[1]).not.toBeNull();

    await page.getByTestId('workflow-create-node').click();
    const picker = page.getByTestId('workflow-create-node-panel');
    await expect(picker).toBeVisible();
    await picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="file"]').click();
    // The file option opens the file-config panel: fill the workspace path and
    // submit (same flow as wf-ui-m3-component-nodes.spec.ts:1601) — only then
    // does the client POST /api/workflow/nodes and materialize the node.
    await page.getByTestId('workflow-create-file-path').fill('package.json');
    await page.getByTestId('workflow-create-file-submit').click();

    const newFileNode = page.locator('[data-testid="workflow-component-node"][data-node-id^="component-file-"]');
    await expect(newFileNode).toBeVisible();
    await expect.poll(() => network.createRequests.length).toBeGreaterThanOrEqual(1);

    await waitForCanvasSettlement(page);
    await page.waitForTimeout(150);

    const after = [await agentNode.boundingBox(), await markdownNode.boundingBox()];
    const newBox = await newFileNode.boundingBox();
    expect(newBox, 'created node rendered').not.toBeNull();

    // AC-001: existing node positions unchanged (exact x/y compare).
    expect(Math.abs(after[0]!.x - before[0]!.x)).toBeLessThan(0.5);
    expect(Math.abs(after[0]!.y - before[0]!.y)).toBeLessThan(0.5);
    expect(Math.abs(after[1]!.x - before[1]!.x)).toBeLessThan(0.5);
    expect(Math.abs(after[1]!.y - before[1]!.y)).toBeLessThan(0.5);

    // AC-001: the new node keeps >= 16px clearance from every existing node.
    for (const existing of after) {
      expect(minGapBetween(toBox(existing!), toBox(newBox!))).toBeGreaterThanOrEqual(16);
    }

    // The client-computed position traveled in the create request.
    const createReq = network.createRequests[network.createRequests.length - 1];
    expect(createReq.payload.type).toBe('file');
    expect(createReq.payload.position).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });

    expect(network.pageErrors, 'page errors').toEqual([]);
  });

  // W4 review finding HIGH-1 (AC-001 for agent creation): the agent create
  // path computes a size-aware free spot client-side but the session POST
  // carries NO position, so the server materializes the node on a 280x180
  // slot and the snapshot reload clobbers the client spot — adjacent 560x358
  // agents end up overlapping. The fix: the session POST body carries
  // {position:{x,y}} and the server materializes the node AT that spot.
  test('AC-001/HIGH-1 agent create: session POST carries the client position; new agent never overlaps', async ({ page }) => {
    const { network } = await installWorkflowFixture(page, {
      components: ['markdown'],
      includeGoal: false,
      positions: {
        [mainAgentNodeId]: { x: 260, y: 300 },
        [markdownNodeId]: { x: 660, y: 420 },
      },
      edges: [],
    });
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    await page.getByTestId('workflow-create-node').click();
    const picker = page.getByTestId('workflow-create-node-panel');
    await expect(picker).toBeVisible();
    await picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="agent"]').click();
    const submit = page.getByTestId('workflow-create-agent-submit');
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
    await submit.click();

    // Network contract (HIGH-1): the session POST must carry the client-
    // computed free spot so the server materializes the node at the same
    // spot (snapshot reload can no longer clobber it). RED until the fix
    // wave adds the position field to the create payload.
    await expect.poll(() => network.createRequests.length).toBeGreaterThanOrEqual(1);
    const sessionReq = network.createRequests[network.createRequests.length - 1];
    expect(sessionReq.method).toBe('POST');
    expect(String(sessionReq.url)).toContain('/api/sessions');
    expect(sessionReq.payload.position).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });

    // The mock materializes the agent at the position the client sent; the
    // new agent bbox must keep >= 16px clearance from every existing node.
    const createdNodeId = 'session-layout-created-session-1';
    const createdNode = page.locator(`[data-testid="workflow-node"][data-node-id="${createdNodeId}"]`);
    await expect(createdNode).toBeVisible();
    await waitForCanvasSettlement(page);
    await page.waitForTimeout(150);

    const agentBox = await page.locator(`[data-testid="workflow-node"][data-node-id="${mainAgentNodeId}"]`).boundingBox();
    const markdownBox = await page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`).boundingBox();
    const newBox = await createdNode.boundingBox();
    expect(agentBox).not.toBeNull();
    expect(markdownBox).not.toBeNull();
    expect(newBox).not.toBeNull();
    expect(minGapBetween(toBox(agentBox!), toBox(newBox!))).toBeGreaterThanOrEqual(16);
    expect(minGapBetween(toBox(markdownBox!), toBox(newBox!))).toBeGreaterThanOrEqual(16);

    expect(network.pageErrors, 'page errors').toEqual([]);
  });

  // Edge-routing upgrade B (task-agent-tree-layout round 3): the bridge trunk
  // snaps to a free channel between node bands instead of the naive midpoint,
  // so an edge crossing a third node's column no longer paints its label over
  // that node's card. Fixture: goal (top) -> main agent (bottom) with a
  // markdown card BETWEEN them on the same column — the naive midpoint trunk
  // lands inside the markdown card; the channel-aware trunk must route the
  // label into one of the gutters instead.
  test('AC-004 edge trunk routes through a free channel: bridge label never sits over the blocking card', async ({ page }) => {
    const { network } = await installWorkflowFixture(page, {
      components: ['markdown'],
      includeGoal: true,
      positions: {
        [goalNodeId]: { x: 500, y: 100 },
        [markdownNodeId]: { x: 500, y: 520 },
        [mainAgentNodeId]: { x: 500, y: 940 },
      },
      edges: [
        {
          id: 'edge-goal-agent-top-bottom',
          from: goalNodeId,
          to: mainAgentNodeId,
          relation: 'delegates',
          direction: 'bidirectional',
          sourceHandle: 'top',
          targetHandle: 'bottom',
        },
      ],
    });
    await openWorkflow(page);
    await waitForCanvasSettlement(page);
    await page.waitForTimeout(150);

    const label = page.getByTestId('workflow-bridge-label');
    await expect(label).toBeVisible();
    const markdownBox = await page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`).boundingBox();
    const labelBox = await label.boundingBox();
    expect(markdownBox).not.toBeNull();
    expect(labelBox).not.toBeNull();

    const labelCx = labelBox!.x + labelBox!.width / 2;
    const labelCy = labelBox!.y + labelBox!.height / 2;
    const inside = (
      labelCx > markdownBox!.x && labelCx < markdownBox!.x + markdownBox!.width
      && labelCy > markdownBox!.y && labelCy < markdownBox!.y + markdownBox!.height
    );
    expect(inside, `bridge label center (${labelCx}, ${labelCy}) must not sit inside the blocking markdown card`).toBe(false);

    // Z-index contract: with no edge selected the label layer sits BELOW the
    // nodes layer (an icon never paints over a card); selecting the edge
    // raises it back above the nodes for dragging.
    const labelLayerZ = await page.locator('.react-flow__edgelabel-renderer').evaluate(el => Number(getComputedStyle(el).zIndex));
    const nodesLayerZ = await page.locator('.react-flow__nodes').evaluate(el => Number(getComputedStyle(el).zIndex));
    expect(labelLayerZ).toBeLessThan(nodesLayerZ);
    await label.click();
    const canvasClass = await page.getByTestId('workflow-canvas').getAttribute('class');
    expect(canvasClass).toContain('has-selected-edge');
    const raisedZ = await page.locator('.react-flow__edgelabel-renderer').evaluate(el => Number(getComputedStyle(el).zIndex));
    expect(raisedZ).toBeGreaterThan(nodesLayerZ);

    expect(network.pageErrors, 'page errors').toEqual([]);
  });
});
