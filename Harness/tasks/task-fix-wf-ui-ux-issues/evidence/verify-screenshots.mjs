// Verifier ad-hoc driver (read-only; run with cwd = src/ui against the running
// e2e server). Captures visual evidence for AC-002/AC-005/AC-008 and diagnoses
// the m3 AC-001 markdown-create failure. All API traffic is mocked in-page.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(path.join(process.cwd(), 'driver-stub.cjs'));
const { chromium } = require('@playwright/test');

const OUT_DIR = path.resolve(process.cwd(), '..', '..', 'Harness', 'tasks', 'task-fix-wf-ui-ux-issues', 'evidence');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = 'http://127.0.0.1:43173';
const repoRoot = path.resolve(process.cwd(), '..', '..');
const sessionId = 'e2e-session-verify';
const graphNodeId = 'e2e-node-verify';
const markdownNodeId = 'e2e-node-verify-markdown';

const nodeConfig = {
  role: 'main', customRole: '', prompt: 'Run inside WF UI and use the workflow map as context.',
  model: 'gpt-5-codex', provider: 'openai', cwd: repoRoot,
  env: { HARNESS_WORKFLOW_MAP: 'Harness/a2a/workflow-map.json' },
  permissions: { filesystem: 'full-access', network: 'enabled' },
  launchPolicy: { autoStart: false, restartOnSave: false, sandboxMode: 'danger-full-access', approvalPolicy: 'never' },
  outputRouting: { markdownDefaultEnabled: false, markdownTargetNodeId: '', fallback: 'oldest-connected-markdown' },
  skills: ['wf-max', 'tdd', 'wf-browser'], skillPolicy: 'auto',
  recommendedSkills: ['wf-max', 'tdd', 'wf-browser'],
  contextSources: ['workflow-map', 'task-capsule', 'terminal-transcript'],
  capabilities: ['terminal', 'file-ops', 'browser', 'review'],
};

function jsonResponse(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
function control() {
  return { canStart: true, canStop: true, canDelete: true, canOpenTerminal: true, canOpenTranscript: true, canSendInput: true, canCreateAgent: true };
}
function snapshot() {
  return {
    schemaVersion: 1, snapshotVersion: 1, generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-verify', taskId: 'task-define-workflow-context-surface',
    mode: 'wf-max', phase: 'planning-dgate', gate: 'TEST-GATE', rootAgentId: graphNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] }, queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [{
      sessionId, runtime: 'codex', role: nodeConfig.role, objective: nodeConfig.prompt,
      status: 'running', attachMode: true, wsClientCount: 1, agentKind: nodeConfig.role,
      workflowMode: 'wf-max', cwd: nodeConfig.cwd, graphNodeId, config: nodeConfig, inputOwnerId: 'drawer',
    }],
    nodes: [{
      id: graphNodeId, label: 'Verify Agent', kind: 'terminal-session', level: 0,
      status: 'running', lifecycle: 'live', runtimeState: 'running', managedByCurrentServer: true,
      control: control(), role: nodeConfig.role, skills: nodeConfig.skills, permissions: nodeConfig.permissions,
      sessionId, taskId: 'task-define-workflow-context-surface', agentKind: nodeConfig.role,
      runtime: 'codex', peerId: 'codex', objective: nodeConfig.prompt, cwd: nodeConfig.cwd, graphNodeId, config: nodeConfig,
    }],
    edges: [],
    graph: {
      schemaVersion: 1, workflowId: 'e2e-workflow-verify', version: 1,
      nodes: [{
        nodeId: graphNodeId, sessionId, agentKind: nodeConfig.role, runtime: 'codex',
        status: 'running', lifecycle: 'live', runtimeState: 'running', managedByCurrentServer: true,
        control: control(), taskId: 'task-define-workflow-context-surface', cwd: nodeConfig.cwd,
        position: { x: 620, y: 180 }, config: nodeConfig,
      }],
      edges: [], capsuleDockLinks: [], positions: { [graphNodeId]: { x: 620, y: 180 } },
      undoStack: [], redoStack: [], graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes', sourceOfTruth: 'backend',
      componentStateRefs: {}, eventStateRefs: {}, capabilityStateRefs: {}, goalStateRefs: {},
    },
    componentNodes: {}, eventNodes: {}, capabilityNodes: {}, goalNodes: {},
    graphContextBySessionId: {
      [sessionId]: {
        workflowMapPath: 'Harness/a2a/workflow-map.json', componentStatePath: 'Harness/a2a/component-nodes',
        sourceOfTruth: 'backend', componentStateRefs: {}, eventStateRefs: {}, capabilityStateRefs: {}, goalStateRefs: {},
      },
    },
  };
}
function runtimeNodeSnapshot(state, position) {
  return {
    nodeId: state.nodeId, kind: state.type, version: state.revision, lifecycle: 'ready',
    status: { state: 'ready', updatedAt: '2026-08-01T00:00:00.000Z' },
    graph: { position, handles: { inputs: [], outputs: [], bidirectional: ['markdown'], ports: ['markdown'], physical: ['markdown:left', 'markdown:right'] }, connections: [] },
    stateRef: { path: state.statePath, revision: state.revision },
    contentRef: { kind: 'component-state', statePath: state.statePath, revision: state.revision },
    settings: { schemaId: 'markdown-settings', values: {}, revision: 0 },
    capabilities: ['state:read', 'state:update'], metadata: { title: state.title },
  };
}
function defaultMarkdownState() {
  return {
    nodeId: markdownNodeId, type: 'markdown', title: 'Markdown Notes',
    statePath: 'Harness/a2a/component-nodes/' + markdownNodeId + '/state.json', revision: 1,
    status: 'ready', markdown: { text: '' }, observableInputs: [], observableOutputs: [],
    layout: { width: 352, height: 314 },
  };
}
function nodesCollectionUrl(url) {
  const u = new URL(url);
  return u.pathname === '/api/workflow/nodes';
}
function nodeDetailUrl(url) {
  const u = new URL(url);
  return u.pathname.startsWith('/api/workflow/nodes/') && u.pathname !== '/api/workflow/nodes';
}

async function installMocks(page, network, delayCreateMs) {
  await page.route('**/api/debug/report', r => jsonResponse(r, { ok: true }));
  await page.route('**/api/settings', r => jsonResponse(r, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', r => jsonResponse(r, { taskId: 'task-define-workflow-context-surface', phase: 'planning-dgate', gate: 'TEST-GATE' }));
  await page.route('**/api/runtimes**', r => jsonResponse(r, [{
    id: 'codex', label: 'Codex', command: 'codex', path: 'codex', version: 'test',
    status: 'available', launchable: true, adapterStatus: 'ok', capabilities: ['terminal'],
  }]));
  await page.route('**/api/tasks**', r => jsonResponse(r, [{ taskId: 'task-define-workflow-context-surface', status: 'open', phase: 'planning-dgate' }]));
  await page.route('**/api/a2a/snapshot**', r => jsonResponse(r, snapshot()));
  await page.route('**/api/a2a/graph-map**', r => jsonResponse(r, { ok: true, revision: 2 }));
  await page.route('**/api/sessions?all=1**', r => jsonResponse(r, snapshot().sessions));
  await page.route('**/api/terminals/**/range**', r => jsonResponse(r, { entries: [{ seq: 1, stream: 'stdout', data: 'verify fixture ready' }] }));
  await page.route('**/api/sessions/**/attach-mode', r => jsonResponse(r, { ok: true }));
  await page.route('**/api/sessions/**/input', r => jsonResponse(r, { ok: true }));
  await page.route('**/api/workspace/tree**', r => jsonResponse(r, {
    root: repoRoot, path: new URL(r.request().url()).searchParams.get('path') || '',
    entries: [
      { name: 'src', path: 'src', type: 'directory', size: 0, hasChildren: true },
      { name: 'Harness', path: 'Harness', type: 'directory', size: 0, hasChildren: true },
      { name: 'package.json', path: 'package.json', type: 'file', size: 820, hasChildren: false },
    ],
  }));
  await page.route('**/api/workspace/text**', r => jsonResponse(r, { text: 'fixture text', bytesRead: 12, truncated: false, encoding: 'utf-8' }));
  await page.route('**/api/user-files', r => jsonResponse(r, { ok: true, files: [] }));

  const state = defaultMarkdownState();
  await page.route(nodesCollectionUrl, async r => {
    if (r.request().method() === 'GET') return jsonResponse(r, { ok: true, nodes: [] });
    const payload = r.request().postDataJSON() || {};
    network.createRequests.push(payload);
    if (delayCreateMs > 0) await new Promise(resolve => setTimeout(resolve, delayCreateMs));
    const backendState = { ...state };
    delete backendState.statePath;
    delete backendState.title;
    return jsonResponse(r, {
      ok: true, node: runtimeNodeSnapshot(state, payload.position || { x: 260, y: 420 }),
      state: backendState, revision: state.revision,
    }, 201);
  });
  await page.route(nodeDetailUrl, r => {
    if (r.request().method() !== 'GET') return r.continue();
    return jsonResponse(r, { ok: true, node: runtimeNodeSnapshot(state, { x: 260, y: 420 }), state, revision: state.revision });
  });
  await page.route('**/api/a2a/nodes/**/config', r => jsonResponse(r, { ok: true, node: { id: graphNodeId, config: nodeConfig }, restartRequired: false, revision: 2 }));
  await page.route('**/api/a2a/nodes/**/restart', r => jsonResponse(r, { ok: true, nodeId: graphNodeId, sessionId, restartRequired: false, revision: 3 }));
}
const results = {};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const network = { createRequests: [] };
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', error => pageErrors.push(String(error.stack || error)));
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

try {
  await installMocks(page, network, 2500);
  await page.goto(BASE + '/workflow', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('workflow-canvas').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);

  const paneCursor = await page.locator('.react-flow__pane').first().evaluate(el => getComputedStyle(el).cursor);
  results['ac002-pane-cursor'] = paneCursor;
  await page.screenshot({ path: path.join(OUT_DIR, '01-ac002-canvas-pane.png') });

  await page.setViewportSize({ width: 1368, height: 768 });
  await page.getByTestId('workflow-create-node').click();
  const panel = page.getByTestId('workflow-create-node-panel');
  await panel.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(400);
  results['ac005-panel-box'] = await panel.boundingBox();
  results['ac005-computed'] = await panel.evaluate(el => {
    const s = getComputedStyle(el);
    return { maxHeight: s.maxHeight, height: s.height, position: s.position, top: s.top, display: s.display };
  });
  results['ac005-panel-body-box'] = await page.getByTestId('workflow-create-node-panel-body').boundingBox().catch(() => null);
  results['ac005-overflow'] = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight,
  }));
  await page.screenshot({ path: path.join(OUT_DIR, '02-ac005-create-node-panel-1368x768.png') });

  const minimapClose = page.getByTestId('workflow-minimap-close');
  if (await minimapClose.count()) { await minimapClose.click(); await page.waitForTimeout(300); }
  results['probe-minimap-closed'] = await minimapClose.count() === 0;
  await page.locator('[data-testid="workflow-create-node-option"][data-node-kind="markdown"]').click();
  await page.waitForTimeout(600);
  results['ac008-node-count-during'] = await page.evaluate(() => document.querySelectorAll('.react-flow__node').length);
  results['ac008-placeholder-any'] = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid]')).filter(el => String(el.getAttribute('data-testid')).includes('loading')).map(el => el.getAttribute('data-testid')));
  const placeholder = page.locator('[data-testid="workflow-node-loading-placeholder"]').first();
  try {
    await placeholder.waitFor({ state: 'visible', timeout: 3000 });
    results['ac008-placeholder-visible'] = true;
    await page.screenshot({ path: path.join(OUT_DIR, '03-ac008-placeholder-markdown.png') });
  } catch {
    results['ac008-placeholder-visible'] = false;
  }
  await page.waitForTimeout(7000);
  const editor = page.getByTestId('workflow-markdown-node-editor');
  results['ac008-editor-visible-after-create'] = await editor.isVisible().catch(() => false);
  results['ac008-placeholder-still-present'] = await placeholder.isVisible().catch(() => false);
  results['ac008-create-requests'] = network.createRequests.length;
  await page.screenshot({ path: path.join(OUT_DIR, '04-ac008-after-resolve.png') });
} catch (error) {
  results['driver-error'] = String(error);
} finally {
  results['pageerrors'] = pageErrors;
  results['console-errors'] = consoleErrors;
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}
