// Verifier probe: AC-001 free-spot behavior with the CORRECTED create flow
// (fill the file path, then Insert). Measures the created node's gap vs
// existing nodes and confirms existing nodes do not move.
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
const port = 43297;
const started = await startServer({ projectRoot: repoRoot, port });
console.log('server on', started.url);

const mainAgentNodeId = 'layout-agent-main';
const mainAgentSessionId = 'layout-session-main';
const markdownNodeId = 'layout-resource-markdown';
const positions = {
  [mainAgentNodeId]: { x: 260, y: 300 },
  [markdownNodeId]: { x: 660, y: 420 },
};
let graphVersion = 1;
const createRequests = [];
function control() {
  return { canReadGraph: true, canModifyGraph: true, canStart: true, canStop: true, canDelete: true, canOpenTerminal: true, canOpenTranscript: true, canSendInput: false, canCreateAgent: true, canCreateComponentNode: true };
}
function mdState() {
  return { nodeId: markdownNodeId, type: 'markdown', title: 'M9 Notes', revision: 1, markdown: '# M9 Notes\n\nLayout fixture.', observableInputs: ['markdown'], observableOutputs: ['markdown', 'plainText'], statePath: 'Harness/a2a/component-nodes/' + markdownNodeId + '/state.json' };
}
function snapshot() {
  const baseAgent = { kind: 'terminal-session', level: 0, status: 'running', lifecycle: 'live', runtimeState: 'running', managedByCurrentServer: true, control: control(), runtime: 'codex', taskId: 'task-m9-layout', cwd: repoRoot, skills: ['wf-max'], permissions: ['terminal'] };
  return {
    schemaVersion: 1, snapshotVersion: 1, generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-m9', taskId: 'task-m9-layout', mode: 'wf-max', phase: 'm9-red', gate: 'TEST-GATE',
    rootAgentId: mainAgentNodeId, availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }], subagentModes: [{ id: 'none', label: 'None' }], roles: { nodes: [], edges: [] }, queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [{ sessionId: mainAgentSessionId, runtime: 'codex', role: 'main', status: 'running', attachMode: true, graphNodeId: mainAgentNodeId, cwd: repoRoot }],
    nodes: [
      { ...baseAgent, id: mainAgentNodeId, label: 'M9 Agent', role: 'main', agentKind: 'main', sessionId: mainAgentSessionId, graphNodeId: mainAgentNodeId, objective: 'M9 layout agent' },
      { id: markdownNodeId, nodeId: markdownNodeId, kind: 'component-node', componentType: 'markdown', type: 'markdown', level: 0, status: 'ready', lifecycle: 'stateful', runtimeState: 'ready', managedByCurrentServer: true, control: control(), graphNodeId: markdownNodeId, revision: 1, statePath: mdState().statePath, observableInputs: ['markdown'], observableOutputs: ['markdown', 'plainText'], label: 'M9 Notes', position: positions[markdownNodeId] },
    ],
    edges: [],
    graph: {
      schemaVersion: 1, workflowId: 'e2e-workflow-m9', version: graphVersion,
      nodes: [
        { nodeId: mainAgentNodeId, sessionId: mainAgentSessionId, kind: 'terminal-session', agentKind: 'main', runtime: 'codex', status: 'running', lifecycle: 'live', runtimeState: 'running', control: control(), taskId: 'task-m9-layout', cwd: repoRoot, position: positions[mainAgentNodeId] },
        { nodeId: markdownNodeId, kind: 'component-node', componentType: 'markdown', type: 'markdown', status: 'ready', lifecycle: 'stateful', runtimeState: 'ready', managedByCurrentServer: true, control: control(), position: positions[markdownNodeId], statePath: mdState().statePath, revision: 1, observableInputs: ['markdown'], observableOutputs: ['markdown', 'plainText'] },
      ],
      edges: [], positions: JSON.parse(JSON.stringify(positions)), capsuleDockLinks: [], undoStack: [], redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json', componentStatePath: 'Harness/a2a/component-nodes',
      componentStateRefs: { [markdownNodeId]: { type: 'markdown', title: 'M9 Notes', statePath: mdState().statePath, revision: 1 } },
      sourceOfTruth: 'backend',
    },
    eventNodes: {}, graphContextBySessionId: {},
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e && e.stack || e)));
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
  if (method === 'PUT' && payload.positions) Object.assign(positions, payload.positions);
  graphVersion += 1;
  return r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, revision: graphVersion, graph: snapshot().graph, sourceOfTruth: 'backend' }) });
});
await page.route('**/api/workspace/tree**', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ root: repoRoot, path: '', entries: [] }) }));
await page.route('**/api/workspace/meta**', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, exists: false }) }));
await page.route('**/api/workspace/text**', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ text: '{}', bytesRead: 2, truncated: false, encoding: 'utf-8' }) }));
await page.route('**/api/workspace/file**', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, exists: true, size: 100, mime: 'text/plain' }) }));
await page.route('**/api/user-files', r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, files: [] }) }));

await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, async r => {
  const req = r.request();
  if (req.method() === 'GET') {
  const md = mdState();
  return r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, nodes: [{ nodeId: md.nodeId, kind: 'markdown', version: 1, lifecycle: 'ready', status: { state: 'ready', updatedAt: '2026-08-01T00:00:00.000Z' }, graph: { position: positions[md.nodeId], handles: [{ id: 'markdown', role: 'bidirectional', type: 'markdown', label: 'markdown' }], connections: [] }, stateRef: { path: md.statePath, revision: 1 }, contentRef: { kind: 'component-state', statePath: md.statePath, revision: 1 }, settings: { schemaId: 'markdown-settings', values: {}, revision: 0 }, capabilities: [], ui: { previewKind: 'markdown', settingsPanel: 'markdown-settings', testId: 'workflow-markdown-node', labels: { title: md.title } } }] }) });
}
  const payload = req.postData() ? JSON.parse(req.postData()) : {};
  createRequests.push({ method: req.method(), payload });
  const nodeId = 'component-file-' + (createRequests.length);
  positions[nodeId] = payload.position || { x: 260, y: 420 };
  graphVersion += 1;
  const node = { nodeId, kind: 'component-node', componentType: 'file', type: 'file', status: 'ready', lifecycle: 'stateful', runtimeState: 'ready', managedByCurrentServer: true, control: control(), revision: 1, statePath: 'Harness/a2a/component-nodes/' + nodeId + '/state.json', observableInputs: ['file'], observableOutputs: ['file', 'path'], graph: { position: positions[nodeId], handles: [], connections: [] }, ui: { previewKind: 'file', settingsPanel: 'file-settings', testId: 'workflow-file-node', labels: { title: 'M9 File' } } };
  return r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, node, state: { nodeId, type: 'file', title: 'M9 File', revision: 1, file: payload.file, observableInputs: ['file'], observableOutputs: ['file', 'path'], statePath: 'Harness/a2a/component-nodes/' + nodeId + '/state.json' }, revision: 1 }) });
});
await page.route(/\/api\/workflow\/nodes\/[^/]+/, r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true }) }));
await page.route(/\/api\/workflow\/edges(?:\?.*)?$/, r => r.fulfill({ status: 201, contentType: 'application/json', body: j({ ok: true, edge: { id: 'edge-new' } }) }));

await page.goto('http://127.0.0.1:' + port + '/workflow');
await page.waitForTimeout(3000);
const bootInfo = await page.evaluate(() => ({ url: location.href, title: document.title, bodyStart: document.body ? document.body.innerText.slice(0, 300) : '' }));
console.log('BOOT', JSON.stringify(bootInfo));
   console.log('PAGEERRORS', JSON.stringify(pageErrors));
await page.getByTestId('workflow-canvas').waitFor({ state: 'visible' });
await page.getByTestId('workflow-node').first().waitFor({ state: 'visible' });
await page.waitForTimeout(1500);

const agentNode = page.locator('[data-testid="workflow-node"][data-node-id="' + mainAgentNodeId + '"]');
const mdNode = page.locator('[data-testid="workflow-component-node"][data-node-id="' + markdownNodeId + '"]');
const before = [await agentNode.boundingBox(), await mdNode.boundingBox()];

await page.getByTestId('workflow-create-node').click();
const picker = page.getByTestId('workflow-create-node-panel');
await picker.waitFor({ state: 'visible' });
await picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="file"]').click();
await page.getByTestId('workflow-create-file-path').fill('package.json');
await page.getByTestId('workflow-create-file-submit').click();

const newFileNode = page.locator('[data-testid="workflow-component-node"][data-node-id^="component-file-"]');
await newFileNode.waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(1200);

const after = [await agentNode.boundingBox(), await mdNode.boundingBox()];
const newBox = await newFileNode.boundingBox();
const minGap = (a, b) => Math.max(
  Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width),
  Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height)
);
const gaps = [minGap(after[0], newBox), minGap(after[1], newBox)];
const existingMoved = after.some((box, i) =>
  Math.abs(box.x - before[i].x) > 0.5 || Math.abs(box.y - before[i].y) > 0.5
);
const newTransform = await newFileNode.evaluate(el => { const st = getComputedStyle(el); const t = new DOMMatrixReadOnly(st.transform); return { tx: t.m41, ty: t.m42, scale: t.a }; });
const allRects = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map(el => ({ id: el.getAttribute('data-node-id'), transform: getComputedStyle(el).transform, text: (el.textContent||'').slice(0,15) })));
const out = {
  newTransform,
  allRects,
  createRequests: createRequests.map(c => ({ method: c.method, position: c.payload.position })),
  before, after, newBox,
  gapsToExisting: gaps,
  minGapOk: Math.min(...gaps) >= 16,
  existingNodesMoved: existingMoved,
  pageErrors,
};
writeFileSync(path.join(__dirname, 'ac001-probe-result.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
await stopServer(started.server);
process.exit(0);
