// Verifier end-to-end MEASUREMENT driver (read-only; cwd = src/ui, against the
// running e2e server). Measures magnet dock geometry with real mouse drags,
// the file-node async-height scenario, mid-drag preview tracking, and the real
// server-layout graph. Output: evidence/05-magnet-measurements.json + PNGs.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(path.join(process.cwd(), 'driver-stub.cjs'));
const { chromium } = require('@playwright/test');

const BASE = 'http://127.0.0.1:43173';
const repoRoot = path.resolve(process.cwd(), '..', '..');
const OUT_DIR = path.resolve(process.cwd(), '..', '..', 'Harness', 'tasks', 'task-fix-wf-ui-ux-issues', 'evidence');
fs.mkdirSync(OUT_DIR, { recursive: true });

const agentId = 'measure-agent';
const mdId = 'measure-markdown';
const fileId = 'measure-file';
const sessionId = 'measure-session';
const CAPSULE_DOCK_GAP = 14;

function jsonResponse(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
function control() {
  return { canStart: true, canStop: true, canDelete: true, canOpenTerminal: true, canOpenTranscript: true, canSendInput: true, canCreateAgent: true };
}

function fixtureSnapshot(components) {
  const componentNodes = components.map(c => ({
    nodeId: c.nodeId, kind: 'component-node', componentType: c.type, status: 'ready',
    lifecycle: 'stateful', runtimeState: 'ready', managedByCurrentServer: true,
    control: control(), position: c.position, statePath: c.statePath, revision: 1,
    stateRef: { path: c.statePath, revision: 1 },
  }));
  const componentNodeEntries = components.map(c => ({
    id: c.nodeId, label: c.title, kind: 'component-node', componentType: c.type,
    type: c.type, level: 0, status: 'ready', lifecycle: 'stateful',
    runtimeState: 'ready', managedByCurrentServer: true, control: control(),
    graphNodeId: c.nodeId, revision: 1, statePath: c.statePath,
    observableInputs: c.observableInputs, observableOutputs: c.observableOutputs,
    position: c.position,
  }));
  return {
    schemaVersion: 1, snapshotVersion: 1, generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-measure', taskId: 'task-define-workflow-context-surface',
    mode: 'wf-max', phase: 'planning-dgate', gate: 'TEST-GATE', rootAgentId: agentId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] }, queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [{
      sessionId, runtime: 'codex', role: 'main', objective: 'measure', status: 'running',
      attachMode: true, wsClientCount: 1, agentKind: 'main', workflowMode: 'wf-max',
      cwd: repoRoot, graphNodeId: agentId, config: {}, inputOwnerId: 'drawer',
    }],
    nodes: [{
      id: agentId, label: 'Measure Agent', kind: 'terminal-session', level: 0,
      status: 'running', lifecycle: 'live', runtimeState: 'running', managedByCurrentServer: true,
      control: control(), role: 'main', skills: [], permissions: {}, sessionId,
      taskId: 'task-define-workflow-context-surface', agentKind: 'main', runtime: 'codex',
      peerId: 'codex', objective: 'measure', cwd: repoRoot, graphNodeId: agentId, config: {},
    }, ...componentNodeEntries],
    edges: [],
    graph: {
      schemaVersion: 1, workflowId: 'e2e-measure', version: 1,
      nodes: [
        { nodeId: agentId, sessionId, agentKind: 'main', runtime: 'codex', status: 'running',
          lifecycle: 'live', runtimeState: 'running', managedByCurrentServer: true,
          control: control(), taskId: 'task-define-workflow-context-surface', cwd: repoRoot,
          position: { x: 520, y: 350 }, config: {} },
        ...componentNodes,
      ],
      edges: [], capsuleDockLinks: [], positions: { [agentId]: { x: 520, y: 350 } },
      undoStack: [], redoStack: [], graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes', sourceOfTruth: 'backend',
      componentStateRefs: Object.fromEntries(components.map(c => [c.nodeId, { type: c.type, title: c.title, statePath: c.statePath, revision: 1 }])),
      eventStateRefs: {}, capabilityStateRefs: {}, goalStateRefs: {},
    },
    componentNodes: Object.fromEntries(components.map(c => [c.nodeId, c])),
    eventNodes: {}, capabilityNodes: {}, goalNodes: {},
    graphContextBySessionId: { [sessionId]: { workflowMapPath: 'Harness/a2a/workflow-map.json', componentStatePath: 'Harness/a2a/component-nodes', sourceOfTruth: 'backend' } },
  };
}

const markdownState = {
  nodeId: mdId, type: 'markdown', title: 'Measure Notes', statePath: `Harness/a2a/component-nodes/${mdId}/state.json`,
  revision: 1, status: 'ready', markdown: { text: '' }, observableInputs: ['markdown'],
  observableOutputs: ['markdown', 'plainText'], layout: { width: 352, height: 314 },
};
const spacerState = {
  nodeId: 'measure-spacer', type: 'markdown', title: 'Spacer', statePath: 'Harness/a2a/component-nodes/measure-spacer/state.json',
  revision: 1, status: 'ready', markdown: { text: '' }, observableInputs: ['markdown'],
  observableOutputs: ['markdown', 'plainText'], layout: { width: 352, height: 314 },
};
const fileState = {
  nodeId: fileId, type: 'file', title: 'Measure File', statePath: `Harness/a2a/component-nodes/${fileId}/state.json`,
  revision: 1, status: 'ready', file: { source: 'workspace', path: 'package.json', name: 'package.json', mime: 'application/json', size: 820 },
  observableInputs: ['file'], observableOutputs: ['file', 'path'], layout: { width: 352, height: 314 },
};
async function installFixture(page, components) {
  let capsuleDockLinks = [];
  let version = 1;
  const graphRef = { capsuleDockLinks, version, puts: [] };
  await page.route('**/api/debug/report', r => jsonResponse(r, { ok: true }));
  await page.route('**/api/settings', r => jsonResponse(r, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', r => jsonResponse(r, { taskId: 'task-define-workflow-context-surface', phase: 'planning-dgate', gate: 'TEST-GATE' }));
  await page.route('**/api/runtimes**', r => jsonResponse(r, [{ id: 'codex', label: 'Codex', command: 'codex', path: 'codex', version: 'test', status: 'available', launchable: true, adapterStatus: 'ok', capabilities: ['terminal'] }]));
  await page.route('**/api/tasks**', r => jsonResponse(r, [{ taskId: 'task-define-workflow-context-surface', status: 'open' }]));
  await page.route('**/api/a2a/snapshot**', r => jsonResponse(r, fixtureSnapshot(components)));
  await page.route('**/api/a2a/graph-map**', async r => {
    const payload = r.request().postDataJSON() || {};
    if (r.request().method() === 'PUT') {
      if (!graphRef.puts) graphRef.puts = [];
      graphRef.puts.push({ positions: payload.positions, dockLinks: payload.capsuleDockLinks });
      if (Array.isArray(payload.capsuleDockLinks)) graphRef.capsuleDockLinks = payload.capsuleDockLinks;
      graphRef.version += 1;
    }
    const snap = fixtureSnapshot(components);
    snap.graph.capsuleDockLinks = graphRef.capsuleDockLinks;
    snap.graph.version = graphRef.version;
    return jsonResponse(r, { ok: true, revision: graphRef.version, graph: snap.graph, sourceOfTruth: 'backend' });
  });
  await page.route('**/api/sessions?all=1**', r => jsonResponse(r, fixtureSnapshot(components).sessions));
  await page.route('**/api/terminals/**/range**', r => jsonResponse(r, { entries: [{ seq: 1, stream: 'stdout', data: 'measure fixture ready' }] }));
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
  await page.route('**/api/workspace/text**', r => jsonResponse(r, { text: 'AC-007 bounded file preview fixture from the workspace text pipe.\nSecond preview line.', bytesRead: 82, truncated: false, encoding: 'utf-8' }));
  await page.route('**/api/workspace/meta**', r => jsonResponse(r, { ok: true, path: 'package.json', name: 'package.json', type: 'file', exists: true, size: 820, mime: 'application/json', etag: 'e', previewKind: 'text' }));
  await page.route('**/api/workspace/file**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/sessions/**/stop', r => jsonResponse(r, { ok: true }));
  await page.route('**/api/a2a/nodes/**', r => jsonResponse(r, { ok: true, revision: 4 }));
  await page.route('**/api/workflow/edges**', r => jsonResponse(r, { ok: true, edge: { id: 'edge-new' } }, 201));
  await page.route('**/api/user-files', r => jsonResponse(r, { ok: true, files: [] }));
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, r => {
    if (r.request().method() === 'GET') return jsonResponse(r, { ok: true, nodes: [] });
    return r.continue();
  });
  await page.route('**/api/a2a/nodes/**/config', r => jsonResponse(r, { ok: true, node: { id: agentId, config: {} }, restartRequired: false, revision: 2 }));
  await page.route('**/api/a2a/nodes/**/restart', r => jsonResponse(r, { ok: true, nodeId: agentId, sessionId, restartRequired: false, revision: 3 }));
  return graphRef;
}

async function openCanvas(page) {
  await page.evaluate(async () => {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    try {
      const dbs = await indexedDB.databases();
      for (const db of dbs) { if (db.name) indexedDB.deleteDatabase(db.name); }
    } catch {}
  }).catch(() => {});
  await page.goto(BASE + '/workflow', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('workflow-canvas').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1800);
}

async function viewportTransform(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.react-flow__viewport');
    if (!el) return null;
    const t = getComputedStyle(el).transform;
    const m = /matrix\(([^)]+)\)/.exec(t);
    if (m) {
      const v = m[1].split(',').map(s => parseFloat(s));
      if (v.length === 6 && v.every(Number.isFinite)) {
        return { scale: v[0], panX: v[4], panY: v[5], raw: t };
      }
    }
    return { raw: t };
  });
}

function toCanvas(rect, vp) {
  if (!vp || !vp.scale) return rect;
  return {
    x: (rect.x - vp.panX) / vp.scale,
    y: (rect.y - vp.panY) / vp.scale,
    w: rect.width / vp.scale,
    h: rect.height / vp.scale,
    width: rect.width / vp.scale,
    height: rect.height / vp.scale,
  };
}

function nodeRect(locator) {
  return locator.boundingBox();
}

async function dockDrag(page, peer, anchorBox, side) {
  const p = await peer.boundingBox();
  if (!p) return false;
  const start = { x: p.x + p.width / 2, y: p.y + 15 };
  // Mouse target = snap position + grab offset (grab at peer center-x, top+15):
  // node top-left = mouse - (w/2, 15); snap top-left = anchor edge ∓ (w or h) - 14.
  let target;
  if (side === 'top') target = { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y - p.height / 2 - 16 };
  else if (side === 'bottom') target = { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y + anchorBox.height + p.height / 2 + 16 };
  else if (side === 'left') target = { x: anchorBox.x - p.width / 2 - 16, y: anchorBox.y + anchorBox.height / 2 };
  else target = { x: anchorBox.x + anchorBox.width + p.width / 2 + 16, y: anchorBox.y + anchorBox.height / 2 };
  // Clamp inside the viewport so ReactFlow edge auto-pan cannot shift the
  // canvas mid-drag (auto-pan breaks the snap-anchor reference).
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + (target.x - start.x) * 0.5, start.y + (target.y - start.y) * 0.5, { steps: 10 });
  await page.mouse.move(target.x, target.y, { steps: 14 });
  await page.waitForTimeout(140);
  await page.mouse.up();
  await page.waitForTimeout(900);
  return true;
}

function gapForSide(a, p, side) {
  if (side === 'top') return { gap: a.y - (p.y + p.height), alignX: Math.abs((p.x + p.width / 2) - (a.x + a.width / 2)) };
  if (side === 'bottom') return { gap: p.y - (a.y + a.height), alignX: Math.abs((p.x + p.width / 2) - (a.x + a.width / 2)) };
  if (side === 'left') return { gap: a.x - (p.x + p.width), alignY: Math.abs((p.y + p.height / 2) - (a.y + a.height / 2)) };
  return { gap: p.x - (a.x + a.width), alignY: Math.abs((p.y + p.height / 2) - (a.y + a.height / 2)) };
}

function sharedEdgeMidpoint(a, p, side) {
  if (side === 'top') {
    const left = Math.max(a.x, p.x); const right = Math.min(a.x + a.width, p.x + p.width);
    return { x: (left + right) / 2, y: a.y };
  }
  if (side === 'bottom') {
    const left = Math.max(a.x, p.x); const right = Math.min(a.x + a.width, p.x + p.width);
    return { x: (left + right) / 2, y: a.y + a.height };
  }
  if (side === 'left') {
    const top = Math.max(a.y, p.y); const bottom = Math.min(a.y + a.height, p.y + p.height);
    return { x: a.x, y: (top + bottom) / 2 };
  }
  const top = Math.max(a.y, p.y); const bottom = Math.min(a.y + a.height, p.y + p.height);
  return { x: a.x + a.width, y: (top + bottom) / 2 };
}
// Pill (anchor ::before bar) center during preview, computed from CSS values.
async function pillCenterOf(page, side) {
  return page.evaluate((sideSel) => {
    const el = document.querySelector('.react-flow__node.workflow-capsule-dock-anchor');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el, '::before');
    if (!s || s.display === 'none' || s.content === 'none') return null;
    const parse = (v, fallback) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };
    let cx; let cy;
    if (sideSel === 'top' || sideSel === 'bottom') {
      const left = r.left + parse(s.left, 0); const width = r.width - parse(s.left, 0) - parse(s.right, 0);
      const top = r.top + parse(s.top, 0); const height = parse(s.height, 20);
      cx = left + width / 2; cy = top + height / 2;
    } else {
      const left = r.left + parse(s.left, -22); const width = parse(s.width, 20);
      const top = r.top + parse(s.top, 0); const height = r.height - parse(s.top, 0) - parse(s.bottom, 0);
      cx = left + width / 2; cy = top + height / 2;
    }
    return { cx, cy, left: r.left, top: r.top, width: r.width, height: r.height };
  }, side);
}

async function measureDock(page, peerSel, side) {
  const anchor = await page.locator(`[data-testid="workflow-node"][data-node-id="${agentId}"]`).boundingBox();
  const peer = await page.locator(peerSel).boundingBox();
  if (!anchor || !peer) return { error: 'missing rects' };
  const g = gapForSide(anchor, peer, side);
  const mid = sharedEdgeMidpoint(anchor, peer, side);
  const docked = await page.locator('.react-flow__node.workflow-capsule-docked').count();
  const vp = await viewportTransform(page);
  const ca = toCanvas(anchor, vp);
  const cp = toCanvas(peer, vp);
  const cg = gapForSide(ca, cp, side);
  return {
    side,
    targetClamped: Boolean(globalThis.__measureClamped),
    viewport: vp,
    anchorScreen: { x: Math.round(anchor.x * 10) / 10, y: Math.round(anchor.y * 10) / 10, w: Math.round(anchor.width * 10) / 10, h: Math.round(anchor.height * 10) / 10 },
    peerScreen: { x: Math.round(peer.x * 10) / 10, y: Math.round(peer.y * 10) / 10, w: Math.round(peer.width * 10) / 10, h: Math.round(peer.height * 10) / 10 },
    anchorCanvas: { x: Math.round(ca.x * 10) / 10, y: Math.round(ca.y * 10) / 10, w: Math.round(ca.w * 10) / 10, h: Math.round(ca.h * 10) / 10 },
    peerCanvas: { x: Math.round(cp.x * 10) / 10, y: Math.round(cp.y * 10) / 10, w: Math.round(cp.w * 10) / 10, h: Math.round(cp.h * 10) / 10 },
    gapScreenPx: Math.round(g.gap * 10) / 10,
    gapCanvasPx: Math.round(cg.gap * 10) / 10,
    centerOffsetCanvasPx: Math.round((cg.alignX || cg.alignY || 0) * 10) / 10,
    sharedEdgeMidpointCanvas: { x: Math.round(mid.x * 10) / 10, y: Math.round(mid.y * 10) / 10 },
    dockedClassCount: docked,
    graphPuts: (globalThis.__graphPuts || []).map(p => ({ positions: p.positions, dockLinks: p.dockLinks })),
  };
}

const results = { magnet: {}, fileScenario: {}, midDrag: {}, layout: {} };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.stack || e)));

try {
  // ---- Part A: dock geometry, 4 orientations (real mouse drags) ----
  const fixtureA = await installFixture(page, [{ ...markdownState, position: { x: 1000, y: 420 } }]);
  globalThis.__graphPuts = fixtureA.puts;
  await openCanvas(page);
  const agentSel = `[data-testid="workflow-node"][data-node-id="${agentId}"]`;
  const peerSel = `[data-testid="workflow-component-node"][data-node-id="${mdId}"]`;
  for (const side of ['top', 'bottom', 'left', 'right']) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('workflow-canvas').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1600);
    const anchor = await page.locator(agentSel).boundingBox();
    if (!anchor) { results.magnet[side] = { error: 'anchor missing' }; continue; }
    await dockDrag(page, page.locator(peerSel), anchor, side);
    results.magnet[side] = await measureDock(page, peerSel, side);
    // during-preview pill measurement is done in Part C; here capture if present
    results.magnet[side].pillCenter = await pillCenterOf(page, side);
  }
  // ---- Part C: mid-drag preview tracking (top orientation, real drag) ----
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('workflow-canvas').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1600);
  {
    const anchor = await page.locator(agentSel).boundingBox();
    const peer = await page.locator(peerSel).boundingBox();
    const target = { x: anchor.x + anchor.width / 2, y: anchor.y - peer.height / 2 - 16 };
    const start = { x: peer.x + peer.width / 2, y: peer.y + 15 };
    const mouseStart = start;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + (target.x - start.x) * 0.5, start.y + (target.y - start.y) * 0.5, { steps: 10 });
    await page.mouse.move(target.x, target.y, { steps: 14 });
    await page.waitForTimeout(220);
    const mid = await page.evaluate(() => {
      const dragged = document.querySelector('.react-flow__node.workflow-capsule-dock-dragged');
      const anchorEl = document.querySelector('.react-flow__node.workflow-capsule-dock-anchor');
      const r = dragged ? dragged.getBoundingClientRect() : null;
      const bar = anchorEl ? getComputedStyle(anchorEl, '::before') : null;
      let pill = null;
      let ar = null;
      if (anchorEl) {
        ar = anchorEl.getBoundingClientRect();
      }
      if (anchorEl && bar && bar.display !== 'none') {
        const parse = (v, f) => { const n = parseFloat(v); return Number.isFinite(n) ? n : f; };
        const bw = parse(bar.width, 0);
        const bh = parse(bar.height, 0);
        if (bw >= bh) {
          pill = { cx: ar.left + parse(bar.left, 0) + bw / 2, cy: ar.top + parse(bar.top, 0) + bh / 2 };
        } else {
          pill = { cx: ar.left + parse(bar.left, -22) + bw / 2, cy: ar.top + parse(bar.top, 0) + bh / 2 };
        }
      }
      return {
        draggedClass: Boolean(dragged),
        anchorClass: Boolean(anchorEl),
        barDisplay: bar ? bar.display : 'n/a',
        pill,
        anchorRect: ar ? { x: ar.x, y: ar.y, w: ar.width, h: ar.height } : null,
        draggedRect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
      };
    });
    // expected dragged-node position = mouse position minus grab offset
    const expectedX = target.x - (start.x - peer.x);
    const expectedY = target.y - (start.y - peer.y);
    let pillOffset = null;
    if (mid.pill && mid.anchorRect) {
      pillOffset = {
        dxPx: Math.round((mid.pill.cx - (mid.anchorRect.x + mid.anchorRect.w / 2)) * 10) / 10,
        dyPx: Math.round((mid.pill.cy - mid.anchorRect.y) * 10) / 10,
      };
    }
    results.midDrag = {
      ...mid,
      pillOffsetVsAnchorEdgeMidpoint: pillOffset,
      mouseAtTarget: { x: Math.round(target.x), y: Math.round(target.y) },
      expectedRect: { x: Math.round(expectedX * 10) / 10, y: Math.round(expectedY * 10) / 10 },
      actualRect: mid.draggedRect ? { x: Math.round(mid.draggedRect.x * 10) / 10, y: Math.round(mid.draggedRect.y * 10) / 10 } : null,
      trackErrorX: mid.draggedRect ? Math.round((mid.draggedRect.x - expectedX) * 10) / 10 : null,
      trackErrorY: mid.draggedRect ? Math.round((mid.draggedRect.y - expectedY) * 10) / 10 : null,
    };
    await page.mouse.up();
    await page.waitForTimeout(900);
  }

  // ---- Part B: file-node async height + simulated resize, top dock ----
  await page.goto(BASE + '/workflow', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await installFixture(page, [{ ...fileState, position: { x: 1000, y: 420 } }]);
  await openCanvas(page);
  {
    const fileSel = `[data-testid="workflow-component-node"][data-node-id="${fileId}"]`;
    const fileNode = page.locator(fileSel);
    await fileNode.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);
    const h0 = (await fileNode.boundingBox()).height;
    await page.waitForTimeout(1400);
    const h1 = (await fileNode.boundingBox()).height;
    results.fileScenario.realHeightChangePx = Math.round((h1 - h0) * 10) / 10;
    results.fileScenario.heights = { t0: Math.round(h0 * 10) / 10, t1: Math.round(h1 * 10) / 10 };
    // Simulated async content growth (no real image/video preview in e2e):
    await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="workflow-component-node"][data-node-id="${id}"]`);
      if (el) {
        const filler = document.createElement('div');
        filler.style.cssText = 'height:90px;flex:0 0 auto;';
        filler.setAttribute('data-measure-filler', '');
        el.appendChild(filler);
      }
    }, fileId);
    await page.waitForTimeout(500);
    const h2 = (await fileNode.boundingBox()).height;
    results.fileScenario.simulatedHeightPx = Math.round(h2 * 10) / 10;
    const anchor = await page.locator(agentSel).boundingBox();
    await dockDrag(page, fileNode, anchor, 'top');
    results.fileScenario.topDock = await measureDock(page, fileSel, 'top');
    await page.screenshot({ path: path.join(OUT_DIR, '07-file-node-top-dock.png') });
  }
  // ---- Part D: real server graph layout metrics ----
  const layoutPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await layoutPage.goto(BASE + '/workflow', { waitUntil: 'domcontentloaded' });
  await layoutPage.getByTestId('workflow-canvas').waitFor({ timeout: 30000 });
  await layoutPage.waitForTimeout(3000);
  {
    const metrics = await layoutPage.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.react-flow__node')).map(el => {
        const r = el.getBoundingClientRect();
        return { id: el.getAttribute('data-id') || el.className, x: r.x, y: r.y, w: r.width, h: r.height };
      }).filter(n => n.w > 0 && n.h > 0);
      const overlaps = [];
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i]; const b = nodes[j];
          const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ix > 0 && iy > 0) overlaps.push({ a: a.id, b: b.id, area: Math.round(ix * iy) });
        }
      }
      const edges = Array.from(document.querySelectorAll('.react-flow__edge path')).map(p => p.getBoundingClientRect());
      const crossings = edges.filter(e => e.width > 0 && e.height > 0 && nodes.some(n => {
        return e.x < n.x + n.w && e.x + e.width > n.x && e.y < n.y + n.h && e.y + e.height > n.y;
      })).length;
      let minGap = Infinity; let minPair = null;
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i]; const b = nodes[j];
          const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
          const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < minGap) { minGap = d; minPair = [a.id, b.id]; }
        }
      }
      return {
        nodeCount: nodes.length,
        nodes: nodes.map(n => ({ id: n.id, x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.w), h: Math.round(n.h) })),
        overlapPairs: overlaps,
        edgePathBboxCount: edges.filter(e => e.width > 0 && e.height > 0).length,
        edgeNodeCrossingsApprox: crossings,
        minPairwiseGapPx: minGap === Infinity ? null : Math.round(minGap * 10) / 10,
        minPairwiseGapPair: minPair,
      };
    });
    const zoom = await layoutPage.evaluate(() => {
      const pane = document.querySelector('.react-flow__pane');
      return pane ? getComputedStyle(pane).transform : null;
    });
    results.layout = { ...metrics, paneTransform: zoom, source: 'server snapshot (graph-layout.mjs positions)' };
    await layoutPage.screenshot({ path: path.join(OUT_DIR, '06-full-canvas.png') });
  }
  results.pageErrors = pageErrors;
} catch (error) {
  results.driverError = String(error.stack || error);
} finally {
  fs.writeFileSync(path.join(OUT_DIR, '05-magnet-measurements.json'), JSON.stringify(results, null, 2));
  await browser.close();
  console.log(JSON.stringify(results, null, 1));
}
