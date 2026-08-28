// Verifier real-graph measurement (task step 4): drive the REAL backend + REAL
// UI against the real Harness/a2a/workflow-map.json graph. Measures
// .react-flow__node rects before/after clicking the real tidy button:
// overlapping node pairs and edge-bbox crossings (the original complaint).
// workflow-map.json is backed up to evidence/ and restored afterwards.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(pathToFileURL('D:/MyFile/sample/synchronous-github/zingspark/create-harness-vibe-coding/src/ui/node_modules/.pnpm/@playwright+test@1.62.0/node_modules/@playwright/test/index.js').href);
const { chromium } = require('playwright');
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, readFileSync, copyFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const mapPath = path.join(repoRoot, 'Harness', 'a2a', 'workflow-map.json');
const backupPath = path.join(__dirname, 'workflow-map.backup.json');
copyFileSync(mapPath, backupPath);
console.log('backed up workflow-map.json ->', backupPath);

const { startServer, stopServer } = await import(pathToFileURL(path.join(repoRoot, 'src', 'wf-ui-server', 'server.mjs')).href);
const port = 43298;
const started = await startServer({ projectRoot: repoRoot, port });
console.log('real server on', started.url);

function intersect(a, b) {
  const ax = Math.max(a.x, b.x);
  const ay = Math.max(a.y, b.y);
  const bx = Math.min(a.x + a.w, b.x + b.w);
  const by = Math.min(a.y + a.h, b.y + b.h);
  return { x: ax, y: ay, w: bx - ax, h: by - ay, overlaps: ax < bx && ay < by };
}

async function measure(page) {
  // Screen-space rects; the viewport scale is uniform so pair metrics are
  // scale-invariant (same conclusion as the m9 spec's graph-space division).
  const nodes = page.locator('.react-flow__node');
  const count = await nodes.count();
  const rects = [];
  for (let i = 0; i < count; i++) {
    const box = await nodes.nth(i).boundingBox();
    if (!box) continue;
    const el = nodes.nth(i);
    const nodeId = (await el.getAttribute('data-node-id')) || (await el.getAttribute('data-id')) || (await el.textContent() || '').slice(0, 20);
    rects.push({ nodeId, x: box.x, y: box.y, w: box.width, h: box.height });
  }
  const overlapPairs = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const hit = intersect(rects[i], rects[j]);
      if (hit.overlaps) overlapPairs.push({ a: rects[i].nodeId, b: rects[j].nodeId, iw: hit.w, ih: hit.h });
    }
  }
  // Edge bbox crossings: the bbox spanning an edge's two endpoint rects
  // intersecting any non-endpoint node rect.
  const edges = page.locator('.react-flow__edge');
  const edgeCount = await edges.count();
  const crossings = [];
  for (let i = 0; i < edgeCount; i++) {
    const el = edges.nth(i);
    const from = (await el.getAttribute('data-from')) || (await el.getAttribute('data-source')) || '';
    const to = (await el.getAttribute('data-to')) || (await el.getAttribute('data-target')) || '';
    const eid = (await el.getAttribute('data-id')) || (await el.getAttribute('data-testid')) || String(i);
    const ra = rects.find(r => r.nodeId === from);
    const rb = rects.find(r => r.nodeId === to);
    if (!ra || !rb) continue;
    const ebbox = { x: Math.min(ra.x, rb.x), y: Math.min(ra.y, rb.y), w: Math.abs(ra.x - rb.x) + Math.max(ra.w, rb.w), h: Math.abs(ra.y - rb.y) + Math.max(ra.h, rb.h) };
    for (const r of rects) {
      if (r.nodeId === from || r.nodeId === to) continue;
      const hit = intersect(ebbox, r);
      if (hit.overlaps) crossings.push({ edge: eid, from, to, through: r.nodeId });
    }
  }
  return { nodeCount: rects.length, rects, overlapPairs, crossingCount: crossings.length, crossings };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const layoutResponses = [];
const netLog = [];
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('request', r => netLog.push(r.method() + ' ' + r.url()));
page.on('response', async r => {
  if (r.url().includes('/actions/agent.layout') && r.request().method() === 'POST') {
    try { layoutResponses.push(await r.json()); } catch {}
  }
});

await page.goto('http://127.0.0.1:' + port + '/workflow');
// wrap fetch to log bodies + errors
await page.evaluate(() => {
  const origFetch = window.fetch.bind(window);
  window.__fetchLog = [];
  window.fetch = async (...args) => {
    const url = String(args[0] || '');
    if (url.includes('agent.layout') || url.includes('graph-map') || url.includes('snapshot')) {
      try {
        const res = await origFetch(...args);
        const text = await res.text();
        window.__fetchLog.push({ url: url.slice(0, 140), method: (args[1] && args[1].method) || 'GET', status: res.status, body: text.slice(0, 400) });
        return new Response(text, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' } });
      } catch (e) {
        window.__fetchLog.push({ url: url.slice(0, 140), method: (args[1] && args[1].method) || 'GET', error: String(e) });
        throw e;
      }
    }
    return origFetch(...args);
  };
});
await page.getByTestId('workflow-canvas').waitFor({ state: 'visible', timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 4, null, { timeout: 60000 });
await page.waitForTimeout(1500);

const before = await measure(page);
await page.locator('.react-flow__viewport').screenshot({ path: path.join(__dirname, 'real-before.png') });

const btn = page.getByTestId('workflow-tidy-layout');
const btnVisible = await btn.isVisible();
const btnEnabled = await btn.isEnabled();
await btn.click();
await page.waitForFunction(() => !document.querySelector('[data-testid="workflow-tidy-layout"]:disabled'), null, { timeout: 30000 });
// dump any visible error/toast text right after the action completes
const uiText = await page.evaluate(() => {
  const cands = [];
  for (const el of document.querySelectorAll("[role=alert], [data-testid*=error], [data-testid*=toast]") ) {
    const txt = (el.textContent || "").trim();
    if (txt) cands.push(txt.slice(0, 200));
  }
  const tidyLines = document.body.innerText.split(String.fromCharCode(10)).filter(l => /tidy|layout failed|Failed/i.test(l)).slice(0, 6);
  return { cands, tidyLines };
});
const lsAfter = await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (/graph|workflow|state/i.test(k)) out[k] = String(localStorage.getItem(k)).slice(0, 600);
  }
  return out;
});
await page.waitForTimeout(4000);

const after = await measure(page);
await page.locator('.react-flow__viewport').screenshot({ path: path.join(__dirname, 'real-after.png') });

const out = {
  button: { visible: btnVisible, enabled: btnEnabled },
  layoutResponses,
  before: { nodeCount: before.nodeCount, overlapPairs: before.overlapPairs, overlapCount: before.overlapPairs.length, crossingCount: before.crossingCount, crossings: before.crossings, rects: before.rects },
  after: { nodeCount: after.nodeCount, overlapPairs: after.overlapPairs, overlapCount: after.overlapPairs.length, crossingCount: after.crossingCount, crossings: after.crossings, rects: after.rects },
  screenshots: { before: 'real-before.png', after: 'real-after.png' },
  uiText,
  lsAfter,
  pageErrors,
  consoleErrors: consoleErrors.slice(0, 8),
  netLog: netLog.slice(0, 40),
  fetchLog: await page.evaluate(() => window.__fetchLog || []),
};
writeFileSync(path.join(__dirname, 'real-graph-measure-result.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

await browser.close();
await stopServer(started.server);
// Restore the backend graph map exactly as found.
copyFileSync(backupPath, mapPath);
console.log('workflow-map.json restored from backup');
process.exit(0);
