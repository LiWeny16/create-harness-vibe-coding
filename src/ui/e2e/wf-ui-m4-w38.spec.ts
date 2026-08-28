import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * WF UI M4 W38 frontend integration acceptance.
 *
 * Covers the W38 slice on the shared WorkflowRoute:
 *   a. FOUR-SIDE HANDLES — markdown/excalidraw/file render exactly 4
 *      bidirectional connection handles, one DOM handle per side (W11/W6).
 *   b. AGENT DRAWER — Agent double-click opens the floating TerminalDrawer
 *      (terminal-window) and never converts to in-canvas terminal mode.
 *   c. DRAG CLEAR — starting a node drag clears a seeded edge selection so the
 *      top-bar "edge selected" indicator cannot persist during a dock gesture.
 *   d. FILE BIG VIEW — File double-click opens workflow-file-big-view; edit +
 *      save round-trips through file.writeText; image/pdf preview elements
 *      exist for those file kinds.
 *   e. SKILLS OVERLAY — Skill Group double-click opens workflow-skills-overlay
 *      in group mode; toggling a skill calls skill-group.setSkillEnabled.
 *   f. HUB MODE — the top-toolbar Skills Hub button opens the overlay in hub
 *      mode backed by skills-hub / skills-market payloads.
 *   g. MISSING FILE — a File node bound to a path missing on disk renders the
 *      missing badge from file.preview and never requests the preview URL
 *      (no /api/workspace/file 404), while existing-file previews are
 *      unchanged.
 */

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const mainAgentNodeId = 'w38-agent-main';
const workerAgentNodeId = 'w38-agent-worker';
const mainAgentSessionId = 'w38-session-main';
const workerAgentSessionId = 'w38-session-worker';
const markdownNodeId = 'w38-resource-markdown';
const excalidrawNodeId = 'w38-resource-excalidraw';
const fileTextNodeId = 'w38-resource-file-text';
const fileImageNodeId = 'w38-resource-file-image';
const filePdfNodeId = 'w38-resource-file-pdf';
const fileMissingNodeId = 'w38-resource-file-missing';
const groupNodeId = 'w38-skill-group';
const bridgeEdgeId = 'edge-w38-main-worker';
const groupEdgeId = 'edge-w38-main-group';
const alphaSkillId = 'skill:w38-alpha';
const betaSkillId = 'skill:w38-beta';

type JsonRecord = Record<string, any>;

type ComponentType = 'markdown' | 'excalidraw' | 'file';

type ComponentState = {
  nodeId: string;
  type: ComponentType;
  title: string;
  revision: number;
  markdown?: string;
  scene?: JsonRecord;
  file?: { source: 'workspace' | 'user-file'; path: string; name?: string; mime?: string; size?: number };
  observableInputs: string[];
  observableOutputs: string[];
  statePath: string;
};

type CapabilityState = {
  nodeId: string;
  type: 'skill-group' | 'mcp-connector';
  title: string;
  revision: number;
  sourceGroup: { id: string; label: string; kind: string } | null;
  category?: string;
  tags?: string[];
  skills: JsonRecord[];
  skillNames: string[];
  skillCount: number;
  lockRef?: string;
  loadStrategy?: string;
  statePath: string;
};

type Network = {
  graphMapRequests: JsonRecord[];
  fileActionRequests: JsonRecord[];
  setSkillEnabledRequests: JsonRecord[];
  skillsHubRequests: string[];
  workspaceFileRequests: string[];
  pageErrors: string[];
  failedResponses: string[];
  reactUpdateLoopErrors: string[];
};

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
    canSendInput: false,
    canCreateAgent: true,
    canCreateComponentNode: true,
  };
}

function primaryPort(type: ComponentType) {
  if (type === 'excalidraw') return 'scene';
  if (type === 'markdown') return 'markdown';
  return 'file';
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

function defaultComponentState(type: ComponentType, nodeId: string, title: string, file?: ComponentState['file']): ComponentState {
  return {
    nodeId,
    type,
    title,
    revision: 1,
    markdown: type === 'markdown' ? '# W38 Notes\n\nResource handle fixture.' : undefined,
    scene: type === 'excalidraw'
      ? { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }
      : undefined,
    file: type === 'file' ? file : undefined,
    observableInputs: observableInputsForType(type),
    observableOutputs: observableOutputsForType(type),
    statePath: `Harness/a2a/component-nodes/${nodeId}/state.json`,
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

function capabilityNodeSnapshot(state: CapabilityState, position: { x: number; y: number }) {
  return {
    id: state.nodeId,
    label: state.title,
    kind: 'capability-node',
    type: state.type,
    level: 0,
    status: 'ready',
    lifecycle: 'capability-provider',
    runtimeState: 'ready',
    managedByCurrentServer: true,
    control: control(),
    position,
    statePath: state.statePath,
    revision: state.revision,
    graphNodeId: state.nodeId,
  };
}

function defaultCapabilityState(): CapabilityState {
  const skills = [
    { id: alphaSkillId, name: 'w38-alpha', title: 'W38 Alpha Skill', source: 'project-root', state: 'indexed', enabled: true },
    { id: betaSkillId, name: 'w38-beta', title: 'W38 Beta Skill', source: 'project-root', state: 'indexed', enabled: false },
  ];
  return {
    nodeId: groupNodeId,
    type: 'skill-group',
    title: 'W38 Skill Group',
    revision: 1,
    sourceGroup: { id: 'recommended:w38', label: 'W38 group', kind: 'recommended' },
    category: 'recommended',
    tags: ['recommended'],
    skills,
    skillNames: skills.map(skill => skill.name),
    skillCount: skills.length,
    loadStrategy: 'group-summary',
    lockRef: 'local',
    statePath: `Harness/a2a/capability-nodes/${groupNodeId}/state.json`,
  };
}

const fileFixtures: Record<string, { meta: JsonRecord; preview: JsonRecord }> = {
  [fileTextNodeId]: {
    meta: { file: { source: 'workspace', path: 'notes.txt', name: 'notes.txt', mime: 'text/plain', size: 11, exists: true } },
    preview: { path: 'notes.txt', previewKind: 'text', mime: 'text/plain' },
  },
  [fileImageNodeId]: {
    meta: { file: { source: 'workspace', path: 'pic.png', name: 'pic.png', mime: 'image/png', size: 68, exists: true } },
    preview: { path: 'pic.png', previewKind: 'image', mime: 'image/png' },
  },
  [filePdfNodeId]: {
    meta: { file: { source: 'workspace', path: 'doc.pdf', name: 'doc.pdf', mime: 'application/pdf', size: 120, exists: true } },
    preview: { path: 'doc.pdf', previewKind: 'pdf', mime: 'application/pdf' },
  },
  // The bound path is gone from disk: file.preview returns previewKind
  // 'missing' / available:false (a clean flag, no 404) while the byte-read
  // endpoint GET /api/workspace/file would 404. The card must never request it.
  [fileMissingNodeId]: {
    meta: { file: { source: 'workspace', path: 'gone.png', name: 'gone.png', mime: 'image/png', size: 68, exists: false, stale: true } },
    preview: { path: 'gone.png', previewKind: 'missing', mime: 'image/png', size: 68, available: false },
  },
};

function workflowSnapshot(components: ComponentState[], capability: CapabilityState, graphState: JsonRecord) {
  const componentNodes = components.map(state => componentNodeSnapshot(state, graphState.positions[state.nodeId]));
  const componentStateRefs = Object.fromEntries(components.map(state => [state.nodeId, {
    type: state.type,
    title: state.title,
    statePath: state.statePath,
    revision: state.revision,
    observableInputs: state.observableInputs,
    observableOutputs: state.observableOutputs,
    ...(state.file ? { file: state.file } : {}),
  }]));
  const capabilityNode = capabilityNodeSnapshot(capability, graphState.positions[capability.nodeId]);
  const baseAgent = {
    kind: 'terminal-session',
    level: 0,
    status: 'running',
    lifecycle: 'live',
    runtimeState: 'running',
    managedByCurrentServer: true,
    control: control(),
    runtime: 'codex',
    taskId: 'task-w38-m4',
    cwd: repoRoot,
    skills: ['wf-max'],
    permissions: ['terminal'],
  };
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-w38',
    taskId: 'task-w38-m4',
    mode: 'wf-max',
    phase: 'm4-red',
    gate: 'TEST-GATE',
    rootAgentId: mainAgentNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [
      { sessionId: mainAgentSessionId, runtime: 'codex', role: 'main', status: 'running', attachMode: true, graphNodeId: mainAgentNodeId, cwd: repoRoot },
      { sessionId: workerAgentSessionId, runtime: 'codex', role: 'worker', status: 'running', attachMode: true, graphNodeId: workerAgentNodeId, cwd: repoRoot },
    ],
    nodes: [
      { ...baseAgent, id: mainAgentNodeId, label: 'W38 Main Agent', role: 'main', agentKind: 'main', sessionId: mainAgentSessionId, graphNodeId: mainAgentNodeId, objective: 'W38 main agent' },
      { ...baseAgent, id: workerAgentNodeId, label: 'W38 Worker Agent', role: 'worker', agentKind: 'subagent', sessionId: workerAgentSessionId, graphNodeId: workerAgentNodeId, objective: 'W38 worker agent' },
      ...componentNodes,
      capabilityNode,
    ],
    edges: graphState.edges.map((edge: JsonRecord) => ({
      id: edge.id,
      from: edge.from || edge.source,
      to: edge.to || edge.target,
      source: edge.source || edge.from,
      target: edge.target || edge.to,
      relation: edge.relation || 'wf-bridge',
      direction: edge.direction || 'bidirectional',
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      offset: edge.offset,
    })),
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-w38',
      version: Number(graphState.version || 1),
      nodes: [
        { nodeId: mainAgentNodeId, sessionId: mainAgentSessionId, kind: 'terminal-session', agentKind: 'main', runtime: 'codex', status: 'running', lifecycle: 'live', runtimeState: 'running', control: control(), taskId: 'task-w38-m4', cwd: repoRoot, position: graphState.positions[mainAgentNodeId] },
        { nodeId: workerAgentNodeId, sessionId: workerAgentSessionId, kind: 'terminal-session', agentKind: 'subagent', runtime: 'codex', status: 'running', lifecycle: 'live', runtimeState: 'running', control: control(), taskId: 'task-w38-m4', cwd: repoRoot, position: graphState.positions[workerAgentNodeId] },
        ...componentNodes.map(node => ({
          nodeId: node.id,
          kind: 'component-node',
          componentType: node.componentType,
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
        {
          nodeId: capability.nodeId,
          kind: 'capability-node',
          type: capability.type,
          status: 'ready',
          lifecycle: 'capability-provider',
          runtimeState: 'ready',
          managedByCurrentServer: true,
          control: control(),
          position: graphState.positions[capability.nodeId],
          statePath: capability.statePath,
          revision: capability.revision,
        },
      ],
      edges: cloneJson(graphState.edges),
      positions: cloneJson(graphState.positions),
      capsuleDockLinks: cloneJson(graphState.capsuleDockLinks || []),
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes',
      componentStateRefs,
      sourceOfTruth: 'backend',
    },
    componentNodes: Object.fromEntries(components.map(state => [state.nodeId, state])),
    capabilityNodes: { [capability.nodeId]: capability },
    graphContextBySessionId: {},
  };
}

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PDF_MINIMAL = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF';

async function installWorkflowFixture(page: Page): Promise<{ network: Network; graphState: JsonRecord }> {
  const components: ComponentState[] = [
    defaultComponentState('markdown', markdownNodeId, 'W38 Notes'),
    defaultComponentState('excalidraw', excalidrawNodeId, 'W38 Diagram'),
    defaultComponentState('file', fileTextNodeId, 'W38 Text File', { source: 'workspace', path: 'notes.txt', name: 'notes.txt', mime: 'text/plain', size: 11 }),
    defaultComponentState('file', fileImageNodeId, 'W38 Image File', { source: 'workspace', path: 'pic.png', name: 'pic.png', mime: 'image/png', size: 68 }),
    // NOTE: the pdf node binds an opaque binary blob (not application/pdf) so
    // FileComponentNode renders no inline <iframe> preview inside the card.
    // An inline iframe would swallow the dblclick (input goes to the iframe
    // document). The big view still derives kind=pdf from the file.preview
    // action response and renders the browser-native iframe preview there.
    defaultComponentState('file', filePdfNodeId, 'W38 Pdf File', { source: 'workspace', path: 'doc.pdf', name: 'doc.pdf', mime: 'application/octet-stream', size: 120 }),
    defaultComponentState('file', fileMissingNodeId, 'W38 Missing File', { source: 'workspace', path: 'gone.png', name: 'gone.png', mime: 'image/png', size: 68 }),
  ];
  const capability = defaultCapabilityState();
  const graphState: JsonRecord = {
    version: 1,
    positions: {
      [mainAgentNodeId]: { x: 500, y: 200 },
      [workerAgentNodeId]: { x: 920, y: 200 },
      [markdownNodeId]: { x: 160, y: 480 },
      [excalidrawNodeId]: { x: 440, y: 480 },
      [fileTextNodeId]: { x: 720, y: 480 },
      [fileImageNodeId]: { x: 1000, y: 480 },
      [filePdfNodeId]: { x: 1280, y: 480 },
      [fileMissingNodeId]: { x: 1560, y: 480 },
      [groupNodeId]: { x: 880, y: 780 },
    },
    edges: [
      {
        id: bridgeEdgeId,
        from: mainAgentNodeId,
        to: workerAgentNodeId,
        source: mainAgentNodeId,
        target: workerAgentNodeId,
        relation: 'delegates',
        direction: 'bidirectional',
        sourceHandle: 'right',
        targetHandle: 'left',
        offset: 0,
      },
      {
        id: groupEdgeId,
        from: mainAgentNodeId,
        to: groupNodeId,
        source: mainAgentNodeId,
        target: groupNodeId,
        relation: 'capability',
        direction: 'bidirectional',
        sourceHandle: 'right',
        targetHandle: 'capability:left',
        offset: 0,
      },
    ],
    capsuleDockLinks: [],
  };
  const network: Network = {
    graphMapRequests: [],
    fileActionRequests: [],
    setSkillEnabledRequests: [],
    skillsHubRequests: [],
    workspaceFileRequests: [],
    pageErrors: [],
    failedResponses: [],
    reactUpdateLoopErrors: [],
  };

  page.on('pageerror', error => {
    network.pageErrors.push(error.message);
    if (/Minified React error #185|maximum update depth|too many re-renders/i.test(error.message)) {
      network.reactUpdateLoopErrors.push(error.message);
    }
  });
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('favicon.ico')) {
      network.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  const savedTexts: Record<string, string> = { [fileTextNodeId]: '# W38 note' };
  const skillEnabled: Record<string, boolean> = { [alphaSkillId]: true, [betaSkillId]: false };

  const currentSnapshot = () => workflowSnapshot(components, capability, graphState);

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, { taskId: 'task-w38-m4', phase: 'm4-red', gate: 'TEST-GATE' }));
  await page.route('**/api/runtimes**', route => jsonResponse(route, [{
    id: 'codex', label: 'Codex', command: 'codex', path: 'codex', version: 'test',
    status: 'available', launchable: true, adapterStatus: 'ok', capabilities: ['terminal'],
  }]));
  await page.route('**/api/tasks**', route => jsonResponse(route, [{ taskId: 'task-w38-m4', status: 'open', phase: 'm4-red' }]));
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, currentSnapshot()));
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, currentSnapshot().sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, { entries: [{ seq: 1, stream: 'stdout', data: '\r\nW38 terminal fixture ready\r\n' }] }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/stop', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/a2a/nodes/**/config', route => jsonResponse(route, { ok: true, node: { id: mainAgentNodeId }, restartRequired: false, revision: 2 }));
  await page.route('**/api/a2a/nodes/**/restart', route => jsonResponse(route, { ok: true, nodeId: mainAgentNodeId, revision: 3 }));
  await page.route('**/api/a2a/nodes/**', route => jsonResponse(route, { ok: true, revision: 4 }));
  await page.route('**/api/a2a/graph-map**', route => {
    const method = route.request().method();
    const payload = requestJson(route);
    network.graphMapRequests.push({ method, payload });
    if (method === 'PUT') {
      if (payload.positions && typeof payload.positions === 'object') {
        Object.assign(graphState.positions, cloneJson(payload.positions));
      }
      if (Array.isArray(payload.edges)) graphState.edges = cloneJson(payload.edges);
      if (Array.isArray(payload.capsuleDockLinks)) graphState.capsuleDockLinks = cloneJson(payload.capsuleDockLinks);
      graphState.version = Number(graphState.version || 1) + 1;
    }
    const snapshot = currentSnapshot();
    return jsonResponse(route, { ok: true, revision: graphState.version, graph: snapshot.graph, sourceOfTruth: 'backend' });
  });
  await page.route('**/api/workspace/tree**', route => {
    const relPath = new URL(route.request().url()).searchParams.get('path') || '';
    return jsonResponse(route, { root: repoRoot, path: relPath, entries: [] });
  });
  await page.route('**/api/workspace/meta**', route => {
    const filePath = new URL(route.request().url()).searchParams.get('path') || '';
    return jsonResponse(route, { ok: true, path: filePath, name: path.basename(filePath), type: 'file', exists: true, size: 820, mime: 'application/json', etag: 'w38-etag', previewKind: 'text' });
  });
  await page.route('**/api/workspace/text**', route => jsonResponse(route, { text: '{}', bytesRead: 2, truncated: false, encoding: 'utf-8' }));
  await page.route('**/api/workspace/file**', route => {
    const url = new URL(route.request().url());
    const filePath = url.searchParams.get('path') || '';
    network.workspaceFileRequests.push(filePath);
    if (filePath.endsWith('.png')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1PX, 'base64') });
    }
    if (filePath.endsWith('.pdf')) {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from(PDF_MINIMAL, 'utf-8') });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/user-files', route => jsonResponse(route, { ok: true, files: [] }));
  // Generic node route FIRST (Playwright checks routes in reverse registration
  // order, so the more specific actions route below must be registered last).
  await page.route(/\/api\/workflow\/nodes\/.+/, route => jsonResponse(route, { ok: true, node: { nodeId } }, 200));

  // File node actions (used by WorkflowFileBigView) and the skill-group
  // enable/disable action used by the Skills Hub overlay.
  await page.route(/\/api\/workflow\/nodes\/[^/]+\/actions\/(.+)/, async route => {
    const parts = new URL(route.request().url()).pathname.split('/').filter(Boolean);
    const nodeId = parts[3] || '';
    const action = decodeURIComponent(parts.slice(5).join('/'));
    const payload = requestJson(route);
    const record = { method: route.request().method(), nodeId, action, payload };
    network.fileActionRequests.push(record);
    if (action === 'file.meta') {
      const meta = fileFixtures[nodeId]?.meta || { file: { path: '' } };
      return jsonResponse(route, { ok: true, result: meta });
    }
    if (action === 'file.preview') {
      const preview = fileFixtures[nodeId]?.preview || { path: '', previewKind: 'none' };
      return jsonResponse(route, { ok: true, result: preview });
    }
    if (action === 'file.readText') {
      return jsonResponse(route, { ok: true, result: { text: savedTexts[nodeId] || '', bytesRead: (savedTexts[nodeId] || '').length, truncated: false } });
    }
    if (action === 'file.writeText') {
      savedTexts[nodeId] = String(payload.content || '');
      return jsonResponse(route, { ok: true, result: { ok: true, path: fileFixtures[nodeId]?.meta?.file?.path || '', bytes: savedTexts[nodeId].length, mtime: '2026-08-01T00:00:01.000Z', revision: 2 } });
    }
    if (action === 'skill-group.setSkillEnabled') {
      const skillId = String(payload.skillId || '');
      const enabled = payload.enabled === true;
      network.setSkillEnabledRequests.push({ nodeId, skillId, enabled });
      if (skillId && skillEnabled[skillId] !== undefined) skillEnabled[skillId] = enabled;
      const skills = capability.skills.map(skill => ({ ...skill, enabled: skillEnabled[skill.id] ?? (skill.enabled !== false) }));
      return jsonResponse(route, {
        ok: true,
        result: {
          revision: 2,
          skillId,
          enabled,
          skills,
          skillNames: skills.map(skill => skill.name).filter(Boolean),
          skillCount: skills.length,
        },
      });
    }
    return jsonResponse(route, { ok: true, result: { ok: true } });
  });
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, route => {
    if (route.request().method() === 'GET') return jsonResponse(route, { ok: true, nodes: [] });
    return jsonResponse(route, { ok: true, node: { nodeId: `component-w38-${network.fileActionRequests.length}` } }, 201);
  });
  await page.route(/\/api\/workflow\/edges(?:\?.*)?$/, route => {
    const payload = requestJson(route);
    return jsonResponse(route, {
      ok: true,
      edge: {
        id: `${payload.from}->${payload.to}`,
        from: payload.from,
        to: payload.to,
        source: payload.from,
        target: payload.to,
        relation: payload.relation || 'wf-bridge',
        direction: payload.direction || 'bidirectional',
        sourceHandle: payload.sourceHandle || null,
        targetHandle: payload.targetHandle || null,
      },
    }, 201);
  });
  await page.route('**/api/workflow/skills-hub**', route => {
    network.skillsHubRequests.push(route.request().url());
    return jsonResponse(route, {
      ok: true,
      schemaVersion: 1,
      kind: 'skills-hub',
      generatedAt: '2026-08-01T00:00:00.000Z',
      query: { scope: 'project', q: '', limit: 50 },
      roots: [{ id: 'project-root', label: 'Project', scope: 'project', runtime: 'local', exists: true, path: '.' }],
      summary: { skillCount: 2, groupCount: 1, sourceCount: 1 },
      installTargets: [{ id: 'project-agents', label: 'Project agents', scope: 'project', runtime: 'local', default: true, path: '.' }],
      nodeSemantics: { role: 'agent-attached-capability-provider', defaultConnection: 'bidirectional capability port to Agent nodes', executor: 'agent' },
      skills: [
        { id: alphaSkillId, name: 'w38-alpha', title: 'W38 Alpha Skill', description: 'alpha fixture skill', kind: 'skill', nodeSemantics: 'agent-attached-capability-provider', attachable: true, state: 'indexed', sources: [{ rootId: 'project-root', label: 'Project', scope: 'project', runtime: 'local', relativePath: 'skills/w38-alpha', path: 'skills/w38-alpha' }] },
        { id: betaSkillId, name: 'w38-beta', title: 'W38 Beta Skill', description: 'beta fixture skill', kind: 'skill', nodeSemantics: 'agent-attached-capability-provider', attachable: true, state: 'indexed', sources: [{ rootId: 'project-root', label: 'Project', scope: 'project', runtime: 'local', relativePath: 'skills/w38-beta', path: 'skills/w38-beta' }] },
      ],
      groups: [{ id: 'recommended:w38', label: 'W38 group', kind: 'recommended', skillIds: [alphaSkillId] }],
    });
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

async function assertResourceHandleSides(page: Page, nodeTestId: string, port: string) {
  const node = page.getByTestId('workflow-component-node').filter({ hasText: new RegExp(port, 'i') }).first();
  await expect(node).toBeVisible();
  const handles = node.locator('[data-testid="workflow-component-node-port"][data-handle-mode="bidirectional"]');
  const count = await handles.count();
  expect(count, `${nodeTestId} should render exactly 4 bidirectional handles`).toBe(4);
  const sides = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const side = await handles.nth(i).getAttribute('data-side');
    if (side) sides.add(side);
  }
  expect(sides, `${nodeTestId} handle sides`).toEqual(new Set(['top', 'right', 'bottom', 'left']));
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const sideHandles = node.locator(`[data-testid="workflow-component-node-port"][data-handle-mode="bidirectional"][data-side="${side}"]`);
    const sideCount = await sideHandles.count();
    expect(sideCount, `${nodeTestId} side=${side} should have exactly ONE handle (W11)`).toBe(1);
  }
}

test.describe('WF UI M4 W38 frontend integration', () => {
  test('W38-1 markdown/excalidraw/file render exactly four bidirectional handles (one per side)', async ({ page }) => {
    await installWorkflowFixture(page);
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    await assertResourceHandleSides(page, 'markdown', 'markdown');
    await assertResourceHandleSides(page, 'excalidraw', 'scene');
    await assertResourceHandleSides(page, 'file', 'file');
  });

  test('W38-2 Agent double-click opens terminal-window and never converts to terminal-mode', async ({ page }) => {
    await installWorkflowFixture(page);
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    expect(await page.getByTestId('workflow-node-terminal').count()).toBe(0);
    expect(await page.getByTestId('terminal-window').count()).toBe(0);

    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${mainAgentNodeId}"]`).first();
    await agentNode.dblclick();

    await expect(page.getByTestId('terminal-window')).toBeVisible();
    await expect(page.locator(`[data-testid="workflow-node-terminal"][data-node-id="${mainAgentNodeId}"]`)).toHaveCount(0);
  });

  test('W38-3 node drag start clears edge selection so top-bar does not show "edge selected"', async ({ page }) => {
    await installWorkflowFixture(page);
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    expect(await page.getByTestId('workflow-edge-selection-count').count()).toBe(0);

    const edgeHit = page.locator('.wf-bridge-edge-hit').first();
    await edgeHit.click({ force: true });
    await expect(page.getByTestId('workflow-edge-selection-count')).toBeVisible();

    const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${mainAgentNodeId}"]`).first();
    const box = await agentNode.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 30, { steps: 4 });

    await expect(page.getByTestId('workflow-edge-selection-count')).toHaveCount(0);

    await page.mouse.up();
    await expect(page.getByTestId('workflow-edge-selection-count')).toHaveCount(0);
  });

  test('W38-4 File node double-click opens the big view; edit+save round-trips; image/pdf previews exist', async ({ page }) => {
    const { network } = await installWorkflowFixture(page);
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    // Text file: open, edit, save, verify writeText payload + re-read.
    const textNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${fileTextNodeId}"]`);
    await expect(textNode).toBeVisible();
    await textNode.dblclick();

    const bigView = page.getByTestId('workflow-file-big-view');
    await expect(bigView).toBeVisible();
    await expect(bigView).toHaveAttribute('data-node-id', fileTextNodeId);
    await expect(bigView).toHaveAttribute('data-file-kind', 'text');

    const editor = page.getByTestId('workflow-file-big-view-text-editor');
    await expect(editor).toHaveValue('# W38 note');
    const saveButton = page.getByTestId('workflow-file-big-view-save');
    await expect(saveButton).toBeDisabled();
    await editor.fill('# W38 note\n\nedited by w38 spec');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await expect.poll(() => network.fileActionRequests.filter(request => request.action === 'file.writeText').length).toBe(1);
    const write = network.fileActionRequests.find(request => request.action === 'file.writeText')!;
    expect(write.nodeId).toBe(fileTextNodeId);
    expect(write.payload).toEqual({ content: '# W38 note\n\nedited by w38 spec' });

    // The big view re-reads after save only on reload; close + reopen to verify
    // the write persisted through the fixture text store.
    await page.getByTestId('workflow-file-big-view-close').click();
    await expect(bigView).toHaveCount(0);
    await textNode.dblclick();
    await expect(bigView).toBeVisible();
    await expect(page.getByTestId('workflow-file-big-view-text-editor')).toHaveValue('# W38 note\n\nedited by w38 spec');

    await page.getByTestId('workflow-file-big-view-close').click();
    await expect(bigView).toHaveCount(0);

    // Image file: browser-native <img> preview.
    const imageNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${fileImageNodeId}"]`);
    await imageNode.dblclick();
    await expect(bigView).toBeVisible();
    await expect(bigView).toHaveAttribute('data-file-kind', 'image');
    await expect(bigView.locator('img')).toBeVisible();
    await page.getByTestId('workflow-file-big-view-close').click();
    await expect(bigView).toHaveCount(0);

    // PDF file: browser-native iframe preview element.
    const pdfNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${filePdfNodeId}"]`);
    await pdfNode.dblclick();
    await expect(bigView).toBeVisible();
    await expect(bigView).toHaveAttribute('data-file-kind', 'pdf');
    await expect(page.getByTestId('workflow-file-big-view-preview')).toBeVisible();
    await page.getByTestId('workflow-file-big-view-close').click();
    await expect(bigView).toHaveCount(0);

    expect(network.pageErrors, 'page errors').toEqual([]);
    expect(network.reactUpdateLoopErrors, 'React update-loop errors').toEqual([]);
  });

  test('W38-5 Skill Group double-click opens the skills overlay; toggling calls skill-group.setSkillEnabled', async ({ page }) => {
    const { network } = await installWorkflowFixture(page);
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    const groupNode = page.locator(`[data-testid="workflow-capability-node"][data-node-id="${groupNodeId}"]`);
    await expect(groupNode).toBeVisible();
    await groupNode.dblclick();

    const overlay = page.getByTestId('workflow-skills-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('data-mode', 'group');
    await expect(overlay).toHaveAttribute('data-node-id', groupNodeId);
    await expect(overlay).toContainText('W38 Alpha Skill');

    // Connected agent is listed from the graph edge (Mount affordance present).
    await expect(overlay.locator('[data-testid="workflow-skills-overlay-mount"]').first()).toBeVisible();

    const alphaToggle = overlay.locator(`[data-testid="workflow-skills-overlay-skill-toggle"][data-skill-id="${alphaSkillId}"]`);
    await expect(alphaToggle).toHaveAttribute('data-enabled', 'true');
    await alphaToggle.click();
    await expect.poll(() => network.setSkillEnabledRequests.length).toBe(1);
    expect(network.setSkillEnabledRequests[0]).toEqual({ nodeId: groupNodeId, skillId: alphaSkillId, enabled: false });
    await expect(alphaToggle).toHaveAttribute('data-enabled', 'false');

    // Re-enable through the toggle-all path.
    const toggleAll = overlay.getByTestId('workflow-skills-overlay-toggle-all');
    await expect(toggleAll).toBeVisible();
    await toggleAll.click();
    await expect.poll(() => network.setSkillEnabledRequests.length).toBeGreaterThan(1);
    const enableCall = network.setSkillEnabledRequests.find(request => request.skillId === alphaSkillId && request.enabled === true);
    expect(enableCall, 'alpha skill should be re-enabled via toggle-all').toBeTruthy();
    await expect(alphaToggle).toHaveAttribute('data-enabled', 'true');

    await page.getByTestId('workflow-skills-overlay-close').click();
    await expect(overlay).toHaveCount(0);

    expect(network.pageErrors, 'page errors').toEqual([]);
    expect(network.reactUpdateLoopErrors, 'React update-loop errors').toEqual([]);
  });

  test('W38-6 toolbar Skills Hub button opens the overlay in hub mode backed by hub/market payloads', async ({ page }) => {
    const { network } = await installWorkflowFixture(page);
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    await page.getByTestId('workflow-open-skills-overlay').click();
    const overlay = page.getByTestId('workflow-skills-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('data-mode', 'hub');

    await expect.poll(() => network.skillsHubRequests.length).toBe(1);
    await expect(overlay.locator('[data-testid="workflow-skills-overlay-skill-toggle"]').first()).toBeDisabled();
    await expect(overlay.getByText('W38 Alpha Skill')).toBeVisible();

    // Groups tab lists hub groups; picking an existing group opens group mode.
    await overlay.locator('[data-testid="workflow-skills-overlay-tab"][data-tab="groups"]').click();
    const pickGroup = overlay.locator('[data-testid="workflow-skills-overlay-pick-group"][data-group-id="recommended:w38"]');
    await expect(pickGroup).toBeVisible();
    await pickGroup.click();
    await expect(overlay).toHaveAttribute('data-mode', 'group');
    await expect(overlay).toHaveAttribute('data-node-id', groupNodeId);

    await page.getByTestId('workflow-skills-overlay-close').click();
    await expect(overlay).toHaveCount(0);

    expect(network.pageErrors, 'page errors').toEqual([]);
    expect(network.reactUpdateLoopErrors, 'React update-loop errors').toEqual([]);
  });

  test('W38-7 File node bound to a missing path renders the missing badge and never requests the preview URL', async ({ page }) => {
    const { network } = await installWorkflowFixture(page);
    await openWorkflow(page);
    await waitForCanvasSettlement(page);

    const missingNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${fileMissingNodeId}"]`);
    await expect(missingNode).toBeVisible();
    const missingCard = missingNode.getByTestId('workflow-file-node');

    // a. Missing badge + flag on the File card root.
    await expect(missingNode.getByTestId('workflow-file-missing')).toBeVisible();
    await expect(missingCard).toHaveAttribute('data-file-missing', 'true');
    await expect(missingCard).toContainText('文件缺失');

    // Give any hypothetical stray preview fetch a chance to surface, then
    // assert the byte-read URL was never requested for the missing path.
    await page.waitForTimeout(400);
    expect(network.workspaceFileRequests.filter(requestPath => requestPath === 'gone.png'), 'no /api/workspace/file request for the missing path').toEqual([]);
    expect(network.failedResponses.filter(failed => failed.includes('gone.png')), 'no 404 for the missing path').toEqual([]);

    // b. An existing-file node still renders its normal preview: the text card
    // shows the fixture text and the image card still fetches its preview URL.
    await expect(page.getByTestId('workflow-file-text-preview')).toContainText('{}');
    await expect.poll(() => network.workspaceFileRequests).toContain('pic.png');
    const imageNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${fileImageNodeId}"]`);
    await expect(imageNode.getByTestId('workflow-file-node')).not.toHaveAttribute('data-file-missing', 'true');
    await imageNode.scrollIntoViewIfNeeded();
    await expect(imageNode.locator('img').first()).toBeVisible();

    expect(network.pageErrors, 'page errors').toEqual([]);
    expect(network.reactUpdateLoopErrors, 'React update-loop errors').toEqual([]);
  });
});
