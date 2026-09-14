// W6 debugger repro driver: magnet dock commit flakiness + side docks.
// Runs the m4-replica fixture (agent + markdown + timer) with the SAME drag
// recipe as m4-replica.mjs, plus corrected side recipes, and captures the
// [dbg6] instrumentation logs from WorkflowRoute.tsx (drag-stop position,
// settle candidate, sizes, zoom, commit path). Per-run fresh browser profile.
// Usage: node w6-dock-repro.mjs [top|right|bottom|left|all] [runs]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.join(process.cwd(), 'driver-stub.cjs'));
const { chromium } = require('@playwright/test');
const BASE = 'http://127.0.0.1:43173';
const repoRoot = path.resolve(process.cwd(), '..', '..');
const mainAgentNodeId = 'magnet-agent-main';
const markdownNodeId = 'magnet-resource-markdown';
const mainAgentSessionId = 'magnet-session-main';
const timerNodeId = 'magnet-event-timer';

function jsonResponse(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
function cloneJson(v) { return JSON.parse(JSON.stringify(v)); }
function control() {
  return { canReadGraph: true, canModifyGraph: true, canStart: true, canStop: true, canDelete: true, canOpenTerminal: true, canOpenTranscript: true, canSendInput: false, canCreateAgent: true, canCreateComponentNode: true };
}
function defaultComponentState(type, nodeId) {
  const title = type === 'markdown' ? 'Magnet Notes' : type === 'file' ? 'Magnet File' : 'Magnet Diagram';
  return {
    nodeId, type, title, revision: 1,
    markdown: type === 'markdown' ? '# Magnet Notes\n\nResource handle fixture.' : undefined,
    scene: type === 'excalidraw' ? { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} } : undefined,
    file: type === 'file' ? { source: 'workspace', path: 'package.json', name: 'package.json', mime: 'application/json', size: 820 } : undefined,
    observableInputs: type === 'markdown' ? ['markdown'] : type === 'file' ? ['file'] : ['scene'],
    observableOutputs: type === 'markdown' ? ['markdown', 'plainText'] : type === 'file' ? ['file', 'path'] : ['scene', 'image'],
    statePath: 'Harness/a2a/component-nodes/' + nodeId + '/state.json',
  };
}
function defaultTimerState() {
  return {
    nodeId: timerNodeId, type: 'timer', title: 'Magnet Timer', revision: 1, enabled: false,
    schedule: { mode: 'loop', intervalSeconds: 120 },
    heartbeat: { base: { enabled: false, intervalSeconds: 60, lastAt: '', nextDueAt: '', count: 0 }, watchdog: { enabled: false, intervalSeconds: 600, timeoutSeconds: 1800, lastPingAt: '', lastAckAt: '', state: 'disabled', missedCount: 0 } },
    eventCount: 0, lastFiredAt: '', lastEvent: null, statePath: 'Harness/a2a/event-nodes/' + timerNodeId + '/state.json',
  };
}
function eventNodeSnapshot(state, position) {
  return {
    id: state.nodeId, label: state.title, kind: 'event-node', type: 'timer', level: 0,
    status: 'ready', lifecycle: 'event-source', runtimeState: 'ready', managedByCurrentServer: true,
    control: control(), graphNodeId: state.nodeId, revision: state.revision, statePath: state.statePath,
    observableInputs: [], observableOutputs: [], position,
  };
}
function componentNodeSnapshot(state, position) {
  return {
    id: state.nodeId, label: state.title, kind: 'component-node', componentType: state.type,
    type: state.type, level: 0, status: 'ready', lifecycle: 'stateful', runtimeState: 'ready',
    managedByCurrentServer: true, control: control(), graphNodeId: state.nodeId, revision: state.revision,
    statePath: state.statePath, observableInputs: state.observableInputs, observableOutputs: state.observableOutputs,
    position,
  };
}
function buildGraphState(components) {
  const positions = { [mainAgentNodeId]: { x: 500, y: 200 }, [timerNodeId]: { x: 500, y: 660 } };
  components.forEach((state, index) => { positions[state.nodeId] = { x: 220 + index * 340, y: 520 }; });
  return {
    positions,
    edges: [{ id: 'edge-magnet-main-worker', from: mainAgentNodeId, to: mainAgentNodeId, source: mainAgentNodeId, target: mainAgentNodeId, relation: 'delegates', direction: 'bidirectional', sourceHandle: 'right', targetHandle: 'left', offset: 0 }],
    capsuleDockLinks: [], version: 1,
  };
}
function workflowSnapshot(graphState, components, timerState) {
  const componentNodes = components.map(state => componentNodeSnapshot(state, graphState.positions[state.nodeId]));
  const timerNode = graphState.positions[timerState.nodeId] ? eventNodeSnapshot(timerState, graphState.positions[timerState.nodeId]) : null;
  const componentStateRefs = Object.fromEntries(components.map(state => [state.nodeId, { type: state.type, title: state.title, statePath: state.statePath, revision: state.revision, observableInputs: state.observableInputs, observableOutputs: state.observableOutputs }]));
  const baseAgent = { kind: 'terminal-session', level: 0, status: 'running', lifecycle: 'live', runtimeState: 'running', managedByCurrentServer: true, control: control(), runtime: 'codex', taskId: 'task-magnet-m4', cwd: repoRoot, skills: ['wf-max'], permissions: ['terminal'] };
  return {
    schemaVersion: 1, snapshotVersion: 1, generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-magnet', taskId: 'task-magnet-m4', mode: 'wf-max', phase: 'm4-red', gate: 'TEST-GATE',
    rootAgentId: mainAgentNodeId, availableWorkflows: [], subagentModes: [], roles: { nodes: [], edges: [] }, queues: {},
    sessions: [{ sessionId: mainAgentSessionId, runtime: 'codex', role: 'main', status: 'running', attachMode: true, graphNodeId: mainAgentNodeId, cwd: repoRoot }],
    nodes: [
      { ...baseAgent, id: mainAgentNodeId, label: 'Magnet Main Agent', role: 'main', agentKind: 'main', sessionId: mainAgentSessionId, graphNodeId: mainAgentNodeId, objective: 'Magnet main agent' },
      ...componentNodes, ...(timerNode ? [timerNode] : []),
    ],
    edges: [],
    graph: {
      schemaVersion: 1, workflowId: 'e2e-workflow-magnet', version: graphState.version,
      nodes: [
        { nodeId: mainAgentNodeId, sessionId: mainAgentSessionId, kind: 'terminal-session', agentKind: 'main', runtime: 'codex', status: 'running', lifecycle: 'live', runtimeState: 'running', control: control(), taskId: 'task-magnet-m4', cwd: repoRoot, position: graphState.positions[mainAgentNodeId] },
        ...componentNodes.map(node => ({ nodeId: node.id, kind: 'component-node', componentType: node.componentType, status: 'ready', lifecycle: 'stateful', runtimeState: 'ready', managedByCurrentServer: true, control: control(), position: graphState.positions[node.id], statePath: node.statePath, revision: node.revision, observableInputs: node.observableInputs, observableOutputs: node.observableOutputs })),
        ...(timerNode ? [{ nodeId: timerNode.id, kind: 'event-node', type: 'timer', status: 'ready', lifecycle: 'event-source', runtimeState: 'ready', managedByCurrentServer: true, control: control(), position: graphState.positions[timerNode.id], statePath: timerNode.statePath, revision: timerNode.revision }] : []),
      ],
      edges: cloneJson(graphState.edges), positions: cloneJson(graphState.positions), capsuleDockLinks: cloneJson(graphState.capsuleDockLinks),
      undoStack: [], redoStack: [], graphContextPath: 'Harness/a2a/workflow-map.json', componentStatePath: 'Harness/a2a/component-nodes', componentStateRefs, sourceOfTruth: 'backend',
    },
    eventNodes: timerNode ? { [timerState.nodeId]: timerState } : {},
    graphContextBySessionId: {},
  };
}
async function installFixture(page, opts = {}) {
  const components = [defaultComponentState('markdown', markdownNodeId)];
  const timerState = defaultTimerState();
  const graphState = buildGraphState(components);
  if (opts.notimer) {
    delete graphState.positions[timerNodeId];
    graphState.edges = [];
  }
  const puts = [];
  const currentSnapshot = () => workflowSnapshot(graphState, components, timerState);
  await page.route('**/api/debug/report', r => jsonResponse(r, { ok: true }));
  await page.route('**/api/settings', r => jsonResponse(r, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', r => jsonResponse(r, { taskId: 'task-magnet-m4', phase: 'm4-red', gate: 'TEST-GATE' }));
  await page.route('**/api/runtimes**', r => jsonResponse(r, [{ id: 'codex', label: 'Codex', command: 'codex', path: 'codex', version: 'test', status: 'available', launchable: true, adapterStatus: 'ok', capabilities: ['terminal'] }]));
  await page.route('**/api/tasks**', r => jsonResponse(r, [{ taskId: 'task-magnet-m4', status: 'open', phase: 'm4-red' }]));
  await page.route('**/api/a2a/snapshot**', r => jsonResponse(r, currentSnapshot()));
  await page.route('**/api/sessions?all=1**', r => jsonResponse(r, currentSnapshot().sessions));
  await page.route('**/api/terminals/**/range**', r => jsonResponse(r, { entries: [{ seq: 1, stream: 'stdout', data: 'magnet terminal fixture' }] }));
  await page.route('**/api/sessions/**/attach-mode', r => jsonResponse(r, { ok: true }));
  await page.route('**/api/sessions/**/input', r => jsonResponse(r, { ok: true }));
  await page.route('**/api/sessions/**/stop', r => jsonResponse(r, { ok: true }));
  await page.route('**/api/a2a/nodes/**/config', r => jsonResponse(r, { ok: true, node: { id: mainAgentNodeId }, restartRequired: false, revision: 2 }));
  await page.route('**/api/a2a/nodes/**/restart', r => jsonResponse(r, { ok: true, nodeId: mainAgentNodeId, revision: 3 }));
  await page.route('**/api/a2a/nodes/**', r => jsonResponse(r, { ok: true, revision: 4 }));
  if (!opts.unmocked) {
    // Deterministic older-backend answer for the typed dock action (m4-replica
    // left this unmocked and hit the real server — nondeterministic).
    await page.route('**/api/workflow/nodes/**/actions/**', r => {
      const action = new URL(r.request().url()).pathname.split('/').pop();
      return jsonResponse(r, { ok: false, error: `Unknown workflow node action: ${action}`, code: 'UNKNOWN_ACTION' }, 404);
    });
  }
  await page.route('**/api/a2a/graph-map**', async r => {
    const method = r.request().method();
    const payload = r.request().postData() ? r.request().postDataJSON() : {};
    puts.push({ method, positions: payload.positions, capsuleDockLinks: payload.capsuleDockLinks, edges: payload.edges });
    if (method === 'PUT') {
      if (payload.positions) Object.assign(graphState.positions, cloneJson(payload.positions));
      if (Array.isArray(payload.edges)) graphState.edges = cloneJson(payload.edges);
      if (Array.isArray(payload.capsuleDockLinks)) graphState.capsuleDockLinks = cloneJson(payload.capsuleDockLinks);
      graphState.version += 1;
    }
    const snap = currentSnapshot();
    return jsonResponse(r, { ok: true, revision: graphState.version, graph: snap.graph, sourceOfTruth: 'backend' });
  });
  await page.route('**/api/workspace/tree**', r => jsonResponse(r, { root: repoRoot, path: '', entries: [] }));
  await page.route('**/api/workspace/meta**', r => jsonResponse(r, { ok: true, path: 'package.json', name: 'package.json', type: 'file', exists: true, size: 820, mime: 'application/json', etag: 'e', previewKind: 'text' }));
  await page.route('**/api/workspace/text**', r => jsonResponse(r, { text: '{}', bytesRead: 2, truncated: false, encoding: 'utf-8' }));
  await page.route('**/api/workspace/file**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/user-files', r => jsonResponse(r, { ok: true, files: [] }));
  return { puts, graphState };
}

// side: 'top' | 'right' | 'bottom' | 'left'; corrected: compensate the grab
// offset (+15 top) so node center aligns with anchor center for left/right and
// node bottom sits gap 16px off the anchor bottom for bottom.
function dragTarget(anchorBox, peerBox, side, corrected) {
  const grabDx = peerBox.width / 2;
  const grabDy = 15;
  if (side === 'top') {
    return { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y - peerBox.height / 2 - 16 };
  }
  if (side === 'bottom') {
    if (corrected) return { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y + anchorBox.height + 16 + grabDy };
    return { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y + anchorBox.height + peerBox.height / 2 + 16 };
  }
  if (side === 'left') {
    const y = corrected
      ? anchorBox.y + anchorBox.height / 2 - peerBox.height / 2 + grabDy
      : anchorBox.y + anchorBox.height / 2;
    return { x: anchorBox.x - peerBox.width / 2 - 16, y };
  }
  const y = corrected
    ? anchorBox.y + anchorBox.height / 2 - peerBox.height / 2 + grabDy
    : anchorBox.y + anchorBox.height / 2;
  return { x: anchorBox.x + anchorBox.width + peerBox.width / 2 + 16, y };
}

async function runOnce(side, corrected, opts = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const logs = [];
  const pageErrors = [];
  page.on('console', m => { if (m.text().includes('[dbg6]')) logs.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e.stack || e)));
  const { puts } = await installFixture(page, opts);
  await page.goto(BASE + '/workflow', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('workflow-canvas').waitFor({ timeout: 30000 });
  await page.getByTestId('workflow-node').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });

  const agentNode = page.getByTestId('workflow-node').first();
  const resourceNode = page.getByTestId('workflow-component-node').first();
  const agentBox = await agentNode.boundingBox();
  const resourceBox = await resourceNode.boundingBox();
  const target = dragTarget(agentBox, resourceBox, side, corrected);
  const startX = resourceBox.x + resourceBox.width / 2;
  const startY = resourceBox.y + 15;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const midX = startX + (target.x - startX) * 0.5;
  const midY = startY + (target.y - startY) * 0.5;
  await page.mouse.move(midX, midY, { steps: 12 });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(900);

  const dockedAny = await page.locator('.react-flow__node.workflow-capsule-docked').count();
  const peerAfter = await resourceNode.boundingBox();
  const anchorAfter = await agentNode.boundingBox();
  const put = puts.find(p => p.method === 'PUT');
  await browser.close();
  return {
    side, corrected, target: { x: Math.round(target.x * 10) / 10, y: Math.round(target.y * 10) / 10 },
    start: { x: Math.round(startX * 10) / 10, y: Math.round(startY * 10) / 10 },
    anchor: anchorAfter ? { x: Math.round(anchorAfter.x * 10) / 10, y: Math.round(anchorAfter.y * 10) / 10, w: Math.round(anchorAfter.width * 10) / 10, h: Math.round(anchorAfter.height * 10) / 10 } : null,
    peerAfter: peerAfter ? { x: Math.round(peerAfter.x * 10) / 10, y: Math.round(peerAfter.y * 10) / 10, w: Math.round(peerAfter.width * 10) / 10, h: Math.round(peerAfter.height * 10) / 10 } : null,
    gapScreen: agentBox ? Math.round((agentBox.y - (peerAfter ? peerAfter.y + peerAfter.height : 0)) * 10) / 10 : null,
    dockedAny,
    put: put ? { positions: put.positions, dockLinks: put.capsuleDockLinks } : null,
    logs,
    pageErrors,
  };
}

async function main() {
  const side = process.argv[2] || 'all';
  const notimer = process.argv.includes('--notimer');
  const unmocked = process.argv.includes('--unmocked');
  const runs = Number(process.argv[3] || 1);
  const sides = side === 'all' ? ['top', 'right', 'bottom', 'left'] : [side];
  const results = {};
  for (const s of sides) {
    results[s] = [];
    for (let i = 0; i < runs; i += 1) {
      results[s].push(await runOnce(s, false, { notimer, unmocked }));
      if (s !== 'top') results[s].push(await runOnce(s, true, { notimer, unmocked }));
    }
  }
  console.log(JSON.stringify(results, null, 1));
}
main().catch(e => { console.log('DRIVER-ERR', String(e.stack || e)); process.exit(1); });
