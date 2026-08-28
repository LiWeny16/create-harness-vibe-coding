// Verifier probe: HIGH-1 agent create — session POST must carry the client
// free spot and the materialized agent must not overlap existing nodes.
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
const port = 43296;
const started = await startServer({ projectRoot: repoRoot, port });

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
  return { nodeId: markdownNodeId, type: 'markdown', title: 'M9 Notes', revision: 1, markdown: '# M9 Notes', observableInputs: ['markdown'], observableOutputs: ['markdown', 'plainText'], statePath: 'Harness/a2a/component-nodes/' + markdownNodeId + '/state.json' };
}

let createdAgent = null;

function snapshot() {
  const created = createdAgent ? { ...createdAgent.baseAgent, id: createdAgent.nodeId, label: 'M9 Created Agent', role: 'subagent', agentKind: 'subagent', sessionId: createdAgent.sessionId, graphNodeId: createdAgent.nodeId, objective: 'Created agent' } : null;
  const baseAgent = { kind: 'terminal-session', level: 0, status: 'running', lifecycle: 'live', runtimeState: 'running', managedByCurrentServer: true, control: control(), runtime: 'codex', taskId: 'task-m9-layout', cwd: repoRoot, skills: ['wf-max'], permissions: ['terminal'] };
  const md = mdState();
  return {
    schemaVersion: 1, snapshotVersion: 1, generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-m9', taskId: 'task-m9-layout', mode: 'wf-max', phase: 'm9-red', gate: 'TEST-GATE',
    rootAgentId: mainAgentNodeId, availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }], subagentModes: [{ id: 'none', label: 'None' }], roles: { nodes: [], edges: [] }, queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [{ sessionId: mainAgentSessionId, runtime: 'codex', role: 'main', status: 'running', attachMode: true, graphNodeId: mainAgentNodeId, cwd: repoRoot }],
    nodes: [
      { ...baseAgent, id: mainAgentNodeId, label: 'M9 Agent', role: 'main', agentKind: 'main', sessionId: mainAgentSessionId, graphNodeId: mainAgentNodeId, objective: 'M9 layout agent' },
      ...(created ? [created] : []),
      { id: markdownNodeId, nodeId: markdownNodeId, kind: 'component-node', componentType: 'markdown', type: 'markdown', level: 0, status: 'ready', lifecycle: 'stateful', runtimeState: 'ready', managedByCurrentServer: true, control: control(), graphNodeId: markdownNodeId, revision: 1, statePath: md.statePath, observableInputs: ['markdown'], observableOutputs: ['markdown', 'plainText'], label: 'M9 Notes', position: positions[markdownNodeId] },
    ],
    edges: [],
    graph: {
      schemaVersion: 1, workflowId: 'e2e-workflow-m9', version: graphVersion,
      nodes: [
        { nodeId: mainAgentNodeId, sessionId: mainAgentSessionId, kind: 'terminal-session', agentKind: 'main', runtime: 'codex', status: 'running', lifecycle: 'live', runtimeState: 'running', control: control(), taskId: 'task-m9-layout', cwd: repoRoot, position: positions[mainAgentNodeId] },
        ...(created ? [{ nodeId: created.nodeId, sessionId: created.sessionId, kind: 'terminal-session', agentKind: 'subagent', runtime: 'codex', status: 'running', lifecycle: 'live', runtimeState: 'running', control: control(), taskId: 'task-m9-layout', cwd: repoRoot, position: positions[created.nodeId] }] : []),
        { nodeId: markdownNodeId, kind: 'component-node', componentType: 'markdown', type: 'markdown', status: 'ready', lifecycle: 'stateful', runtimeState: 'ready', managedByCurrentServer: true, control: control(), position: positions[markdownNodeId], statePath: md.statePath, revision: 1, observableInputs: ['markdown'], observableOutputs: ['markdown', 'plainText'] },
      ],
      edges: [], positions: JSON.parse(JSON.stringify(positions)), capsuleDockLinks: [], undoStack: [], redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json', componentStatePath: 'Harness/a2a/component-nodes',
      componentStateRefs: { [markdownNodeId]: { type: 'markdown', title: 'M9 Notes', statePath: md.statePath, revision: 1 } },
      sourceOfTruth: 'backend',
    },
    eventNodes: {}, graphContextBySessionId: {},
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
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
await page.route(/\/api\/workflow\/edges(?:\?.*)?$/, r => r.fulfill({ status: 201, contentType: 'application/json', body: j({ ok: true, edge: { id: 'edge-new' } }) }));
await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true, nodes: [] }) }));
await page.route(/\/api\/workflow\/nodes\/[^/]+/, r => r.fulfill({ status: 200, contentType: 'application/json', body: j({ ok: true }) }));

// Session create mock (registered LAST so it wins): materialize the agent at
// the client-sent position.
await page.route('**/api/sessions', async r => {
  if (r.request().method() !== 'POST') return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  const payload = r.request().postData() ? JSON.parse(r.request().postData()) : {};
  createRequests.push({ method: r.request().method(), url: r.request().url(), payload });
  const nodeId = 'session-layout-created-session-1';
  createdAgent = { nodeId, sessionId: 'layout-created-session-1', baseAgent: { kind: 'terminal-session', level: 0, status: 'running', lifecycle: 'live', runtimeState: 'running', managedByCurrentServer: true, control: control(), runtime: 'codex', taskId: 'task-m9-layout', cwd: repoRoot, skills: ['wf-max'], permissions: ['terminal'] } };
  const position = payload.position && typeof payload.position.x === 'number'
    ? { x: payload.position.x, y: payload.position.y }
    : { x: 660, y: 420 };
  positions[nodeId] = position;
  graphVersion += 1;
  return r.fulfill({ status: 201, contentType: 'application/json', body: j({ sessionId: 'layout-created-session-1', graphNodeId: nodeId, runtime: payload.runtime || 'codex', agentKind: payload.agentKind || 'subagent', role: payload.role || 'Subagent', status: 'running', attachMode: true, cwd: repoRoot }) });
});

await page.goto('http://127.0.0.1:' + port + '/workflow');
await page.getByTestId('workflow-canvas').waitFor({ state: 'visible' });
await page.getByTestId('workflow-node').first().waitFor({ state: 'visible' });
await page.waitForTimeout(1500);

await page.getByTestId('workflow-create-node').click();
const picker = page.getByTestId('workflow-create-node-panel');
await picker.waitFor({ state: 'visible' });
await picker.locator('[data-testid="workflow-create-node-option"][data-node-kind="agent"]').click();
const submit = page.getByTestId('workflow-create-agent-submit');
await submit.waitFor({ state: 'visible', timeout: 15000 });
await submit.click();

const createdNode = page.locator('[data-testid="workflow-node"][data-node-id="session-layout-created-session-1"]');
await createdNode.waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(1500);

const agentBox = await page.locator('[data-testid="workflow-node"][data-node-id="' + mainAgentNodeId + '"]').boundingBox();
const mdBox = await page.locator('[data-testid="workflow-component-node"][data-node-id="' + markdownNodeId + '"]').boundingBox();
const newBox = await createdNode.boundingBox();
const minGap = (a, b) => Math.max(
  Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width),
  Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height)
);
const out = {
  sessionRequests: createRequests.map(c => ({ method: c.method, url: String(c.url).slice(0, 60), position: c.payload.position })),
  positionCarried: Boolean(createRequests.length && createRequests[0].payload.position && typeof createRequests[0].payload.position.x === 'number'),
  agentBox, mdBox, newBox,
  gapToAgent: agentBox && newBox ? minGap(agentBox, newBox) : null,
  gapToMarkdown: mdBox && newBox ? minGap(mdBox, newBox) : null,
  pageErrors,
};
writeFileSync(path.join(__dirname, 'high1-probe-result.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
await stopServer(started.server);
process.exit(0);
