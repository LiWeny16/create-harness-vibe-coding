// Verifier probe: reproduce m9 AC-002 flow with the same mock fixture and dump
// full request payloads. Evidence-only; does not modify source.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(pathToFileURL('D:/MyFile/sample/synchronous-github/zingspark/create-harness-vibe-coding/src/ui/node_modules/.pnpm/@playwright+test@1.62.0/node_modules/@playwright/test/index.js').href);
const { chromium } = require('playwright');
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const { startServer, stopServer } = await import(pathToFileURL(path.join(repoRoot, 'src', 'wf-ui-server', 'server.mjs')).href);
const port = 43299;
const started = await startServer({ projectRoot: repoRoot, port });
console.log('server on', started.url);

const mainAgentNodeId = 'layout-agent-main';
const mainAgentSessionId = 'layout-session-main';
const goalNodeId = 'layout-goal';
const fileNodeId = 'layout-resource-file';
const TIDY_POSITIONS = {
  [goalNodeId]: { x: 260, y: 220 },
  [mainAgentNodeId]: { x: 260, y: 500 },
  [fileNodeId]: { x: 260, y: 900 },
};
const positions = {
  [mainAgentNodeId]: { x: 500, y: 200 },
  [fileNodeId]: { x: 500, y: 400 },
  [goalNodeId]: { x: 500, y: 620 },
};
const edges = [
  { id: 'edge-goal-agent', from: goalNodeId, to: mainAgentNodeId, relation: 'delegates', direction: 'source-to-target' },
  { id: 'edge-agent-file', from: mainAgentNodeId, to: fileNodeId, relation: 'delegates', direction: 'source-to-target' },
];
let graphVersion = 1;
function control() {
  return { canReadGraph: true, canModifyGraph: true, canStart: true, canStop: true, canDelete: true, canOpenTerminal: true, canOpenTranscript: true, canSendInput: false, canCreateAgent: true, canCreateComponentNode: true };
}
function snapshot() {
  const baseAgent = { kind: 'terminal-session', level: 0, status: 'running', lifecycle: 'live', runtimeState: 'running', managedByCurrentServer: true, control: control(), runtime: 'codex', taskId: 'task-m9-layout', cwd: repoRoot, skills: ['wf-max'], permissions: ['terminal'] };
  const comp = { nodeId: fileNodeId, kind: 'component-node', componentType: 'file', type: 'file', level: 0, status: 'ready', lifecycle: 'stateful', runtimeState: 'ready', managedByCurrentServer: true, control: control(), graphNodeId: fileNodeId, revision: 1, statePath: 'Harness/a2a/component-nodes/' + fileNodeId + '/state.json', observableInputs: ['file'], observableOutputs: ['file', 'path'] };
  return {
    schemaVersion: 1, snapshotVersion: 1, generatedAt: '2026-08-01T00:00:00.000Z', workflowId: 'e2e-workflow-m9', taskId: 'task-m9-layout', mode: 'wf-max', phase: 'm9-red', gate: 'TEST-GATE',
    rootAgentId: mainAgentNodeId, availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }], subagentModes: [{ id: 'none', label: 'None' }], roles: { nodes: [], edges: [] }, queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [{ sessionId: mainAgentSessionId, runtime: 'codex', role: 'main', status: 'running', attachMode: true, graphNodeId: mainAgentNodeId, cwd: repoRoot }],
    nodes: [
      { ...baseAgent, id: mainAgentNodeId, label: 'M9 Agent', role: 'main', agentKind: 'main', sessionId: mainAgentSessionId, graphNodeId: mainAgentNodeId, objective: 'M9 layout agent' },
      { ...comp, id: fileNodeId, label: 'M9 File', componentType: 'file', position: positions[fileNodeId] },
      { id: goalNodeId, label: 'M9 Goal', kind: 'goal-node', type: 'goal', level: 0, status: 'active', lifecycle: 'goal-anchor', runtimeState: 'active', managedByCurrentServer: true, revision: 1, statePath: 'Harness/tasks/task-m9-layout/STATE.json', position: positions[goalNodeId] },
    ],
    edges: edges.map(e => ({ ...e, source: e.from, target: e.to })),
    graph: {
      schemaVersion: 1, workflowId: 'e2e-workflow-m9', version: graphVersion,
      nodes: [
        { nodeId: mainAgentNodeId, sessionId: mainAgentSessionId, kind: 'terminal-session', agentKind: 'main', runtime: 'codex', status: 'running', lifecycle: 'live', runtimeState: 'running', control: control(), taskId: 'task-m9-layout', cwd: repoRoot, position: positions[mainAgentNodeId] },
        { nodeId: fileNodeId, kind: 'component-node', componentType: 'file', type: 'file', status: 'ready', lifecycle: 'stateful', runtimeState: 'ready', managedByCurrentServer: true, control: control(), position: positions[fileNodeId], statePath: 'Harness/a2a/component-nodes/' + fileNodeId + '/state.json', revision: 1, observableInputs: ['file'], observableOutputs: ['file', 'path'] },
        { nodeId: goalNodeId, kind: 'goal-node', type: 'goal', status: 'active', lifecycle: 'goal-anchor', runtimeState: 'active', managedByCurrentServer: true, control: control(), position: positions[goalNodeId], statePath: 'Harness/tasks/task-m9-layout/STATE.json', revision: 1 },
      ],
      edges: JSON.parse(JSON.stringify(edges)),
      positions: JSON.parse(JSON.stringify(positions)),
      capsuleDockLinks: [], undoStack: [], redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes',
      componentStateRefs: { [fileNodeId]: { type: 'file', title: 'M9 File', statePath: 'Harness/a2a/component-nodes/' + fileNodeId + '/state.json', revision: 1, file: { source: 'workspace', path: 'package.json', name: 'package.json', mime: 'application/json', size: 820 } } },
      sourceOfTruth: 'backend',
    },
    eventNodes: {}, graphContextBySessionId: {},
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const log = { layout: [], puts: [], pageErrors: [], consoleErrors: [], failed: [] };
page.on('pageerror', e => log.pageErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') log.consoleErrors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) log.failed.push(r.status() + ' ' + r.url()); });
const j = o => JSON.stringify(o);

await page.route('**/api/debug/report', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true }) }));
await page.route('**/api/settings', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ui: { theme: 'light' } }) }));
await page.route('**/api/workflow', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ taskId: 'task-m9-layout', phase: 'm9-red', gate: 'TEST-GATE' }) }));
await page.route('**/api/runtimes**', r => r.fulfill({ status: 200, contentType: 'application/json', body: j([{ id: 'codex', label: 'Codex', command: 'codex', path: 'codex', version: 'test', status: 'available', launchable: true, adapterStatus: 'ok', capabilities: ['terminal'] }]) }));
await page.route('**/api/tasks**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await page.route('**/api/a2a/snapshot**', r => r.fulfill({ status: 200, contentType: 'application/json', body: j(snapshot()) }));
await page.route('**/api/sessions?all=1**', r => r.fulfill({ status: 200, contentType: 'application/json', body: j(snapshot().sessions) }));
await page.route('**/api/terminals/**/range**', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ entries: [{ seq: 1, stream: 'stdout', data: 'M9 terminal fixture' }] }) }));
await page.route('**/api/sessions/**/attach-mode', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true }) }));
await page.route('**/api/sessions/**/input', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true }) }));
await page.route('**/api/sessions/**/stop', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true }) }));
await page.route('**/api/a2a/nodes/**/config', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, node: { id: mainAgentNodeId }, restartRequired: false, revision: 2 }) }));
await page.route('**/api/a2a/nodes/**/restart', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, nodeId: mainAgentNodeId, revision: 3 }) }));
await page.route('**/api/a2a/nodes/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, revision: 4 }) }));

await page.route('**/api/a2a/graph-map**', r => {
  const method = r.request().method();
  const body = r.request().postData() || '';
  const payload = body ? JSON.parse(body) : {};
  log.puts.push({ method, url: r.request().url(), body: payload });
  if (method === 'PUT' && payload.positions) Object.assign(positions, payload.positions);
  graphVersion += 1;
  return r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, revision: graphVersion, graph: snapshot().graph, sourceOfTruth: 'backend' }) });
});
await page.route('**/api/workspace/tree**', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ root: repoRoot, path: '', entries: [] }) }));
await page.route('**/api/workspace/meta**', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, exists: false }) }));
await page.route('**/api/workspace/text**', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ text: '{}', bytesRead: 2, truncated: false, encoding: 'utf-8' }) }));
await page.route('**/api/workspace/file**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route(/\/api\/workflow\/edges(?:\?.*)?$/, r => r.fulfill({ status: 201, contentType: 'application/json', body: j({ ok: true, edge: { id: 'edge-new', from: mainAgentNodeId, to: goalNodeId } }) }));
await page.route('**/api/user-files', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, files: [] }) }));
await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, nodes: [] }) }));
await page.route(/\/api\/workflow\/nodes\/[^/]+/, r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true }) }));
await page.route(/\/api\/workflow\/nodes\/[^/]+\/actions\/agent\.layout/, r => {
  const body = r.request().postData() || '';
  log.layout.push({ method: r.request().method(), url: r.request().url(), body: body ? JSON.parse(body) : {} });
  return r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, action: 'layout', positions: Object.assign(JSON.parse(JSON.stringify(TIDY_POSITIONS)), { 'mystery-goal-1': { x: 860, y: 160 }, 'mystery-goal-2': { x: 1629, y: -1063 } }) }) });
});

await page.goto('http://127.0.0.1:' + port + '/workflow');
await page.getByTestId('workflow-canvas').waitFor({ state: 'visible' });
await page.getByTestId('workflow-node').first().waitFor({ state: 'visible' });
await page.waitForTimeout(1500);

const boxesBefore = {};
for (const [id, testid] of [[mainAgentNodeId, 'workflow-node'], [fileNodeId, 'workflow-component-node'], [goalNodeId, 'workflow-goal-node']]) {
  boxesBefore[id] = await page.locator('[data-testid="' + testid + '"][data-node-id="' + id + '"]').boundingBox();
}

const btn = page.getByTestId('workflow-tidy-layout');
const btnVisible = await btn.isVisible();
const btnEnabled = await btn.isEnabled();
const btnLabel = (await btn.getAttribute('aria-label')) || (await btn.getAttribute('title')) || (await btn.textContent()) || '';
await btn.click();
await page.waitForTimeout(1800);

const boxesAfter = {};
for (const [id, testid] of [[mainAgentNodeId, 'workflow-node'], [fileNodeId, 'workflow-component-node'], [goalNodeId, 'workflow-goal-node']]) {
  boxesAfter[id] = await page.locator('[data-testid="' + testid + '"][data-node-id="' + id + '"]').boundingBox();
}

const out = {
  button: { visible: btnVisible, enabled: btnEnabled, label: btnLabel },
  layoutRequests: log.layout,
  graphMapRequests: log.puts,
  pageErrors: log.pageErrors,
  consoleErrors: log.consoleErrors.slice(0, 10),
  failedResponses: log.failed.slice(0, 10),
  boxesBefore,
  boxesAfter,
};

writeFileSync(path.join(__dirname, 'ac002-probe-result.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
await stopServer(started.server);
process.exit(0);