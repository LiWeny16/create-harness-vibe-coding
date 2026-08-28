import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createComponentNode, getComponentNode, acquireLock } from '../component-node-store.mjs';
import { write as displayWrite, read as displayRead, renderHtml, reportHtmlPath, defaultDisplayTemplate, DISPLAY_USAGE } from '../workflow-node-types/display-node.mjs';
import { renderSceneSvg } from '../excalidraw-svg.mjs';

function makeRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(root, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  return root;
}

function createDisplay(root, title = 'Research Report') {
  return createComponentNode(root, { type: 'display', title });
}

test('D1 default template: an unwritten display node serves the themed starter report', () => {
  const root = makeRoot('wfui-display-');
  try {
    const created = createDisplay(root);
    const html = renderHtml(root, { nodeId: created.node.nodeId });
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('Research Report'));
    assert.ok(html.includes('#D97757'), 'theme carries the Claude yellow accent');
    assert.ok(html.includes('#2563EB'), 'theme carries the blue accent');
    assert.ok(!fs.existsSync(reportHtmlPath(root, created.node.nodeId)), 'no file is written until an agent writes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('D2 display.write persists report.html and bumps the revision; display.read returns it with usage', () => {
  const root = makeRoot('wfui-display-');
  try {
    const created = createDisplay(root);
    const result = displayWrite(created.node.nodeId, root, { html: '<html><body><h1 class="report-title">Findings</h1></body></html>' });
    assert.equal(result.ok, true);
    assert.ok(result.revision > created.node.revision);
    const onDisk = fs.readFileSync(reportHtmlPath(root, created.node.nodeId), 'utf8');
    assert.ok(onDisk.includes('Findings'));
    const readBack = displayRead(created.node.nodeId, root);
    assert.equal(readBack.html, onDisk);
    assert.equal(readBack.usage, DISPLAY_USAGE);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('D3 revision guard: a stale expectedRevision refuses the write', () => {
  const root = makeRoot('wfui-display-');
  try {
    const created = createDisplay(root);
    displayWrite(created.node.nodeId, root, { html: '<p>v1</p>' });
    assert.throws(
      () => displayWrite(created.node.nodeId, root, { html: '<p>v2</p>', expectedRevision: created.node.revision }),
      /revision|conflict/i,
    );
    const readBack = displayRead(created.node.nodeId, root);
    assert.ok(readBack.html.includes('v1'), 'stale write must not clobber');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('D4 lock held by another holder refuses the write', () => {
  const root = makeRoot('wfui-display-');
  try {
    const created = createDisplay(root);
    acquireLock(created.node.nodeId, 'other-agent', 60000, { projectRoot: root });
    assert.throws(
      () => displayWrite(created.node.nodeId, root, { html: '<p>x</p>' }),
      /locked by other-agent/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('D5 type mismatch: display.write on a markdown node refuses', () => {
  const root = makeRoot('wfui-display-');
  try {
    const md = createComponentNode(root, { type: 'markdown', title: 'Notes' });
    assert.throws(
      () => displayWrite(md.node.nodeId, root, { html: '<p>x</p>' }),
      /not a display node/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('D6 excalidraw placeholder expands to an inline SVG at serve time', () => {
  const root = makeRoot('wfui-display-');
  try {
    const scene = createComponentNode(root, {
      type: 'excalidraw',
      title: 'Diagram',
      scene: {
        elements: [
          { type: 'rectangle', x: 0, y: 0, width: 100, height: 60, strokeColor: '#1e1e1e', fillStyle: 'solid', backgroundColor: '#ffffff' },
          { type: 'text', x: 10, y: 10, width: 80, height: 40, text: 'Flow <&>', fontSize: 20, strokeColor: '#000000' },
        ],
      },
    });
    const display = createDisplay(root);
    displayWrite(display.node.nodeId, root, {
      html: `<html><body><h1>Report</h1>{{excalidraw:${scene.node.nodeId}}}</body></html>`,
    });
    const html = renderHtml(root, { nodeId: display.node.nodeId });
    assert.ok(!html.includes('{{excalidraw:'), 'placeholder must be expanded');
    assert.ok(html.includes('<svg'), 'expanded to an inline svg');
    assert.ok(html.includes('harness-excalidraw'), 'wrapped in the figure class');
    assert.ok(html.includes('Flow &lt;&amp;&gt;'), 'text is XML-escaped');
    assert.ok(html.includes('open interactive node'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('D7 unresolved excalidraw placeholder stays as text (no crash)', () => {
  const root = makeRoot('wfui-display-');
  try {
    const display = createDisplay(root);
    displayWrite(display.node.nodeId, root, { html: '<p>{{excalidraw:component-missing-000000}}</p>' });
    const html = renderHtml(root, { nodeId: display.node.nodeId });
    assert.ok(html.includes('{{excalidraw:component-missing-000000}}'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('D8 SVG renderer: shapes + arrow + rotation survive; deterministic output', () => {
  const elements = [
    { type: 'rectangle', x: 0, y: 0, width: 120, height: 60, strokeColor: '#1e1e1e' },
    { type: 'ellipse', x: 200, y: 0, width: 80, height: 80, strokeColor: '#2563EB' },
    { type: 'diamond', x: 340, y: 0, width: 100, height: 60, strokeColor: '#D97757' },
    { type: 'arrow', x: 0, y: 100, width: 120, height: 20, points: [[0, 10], [120, 10]], strokeColor: '#111827' },
  ];
  const svg = renderSceneSvg(elements);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('<rect'), 'rectangle rendered');
  assert.ok(svg.includes('<ellipse'), 'ellipse rendered');
  assert.ok(svg.includes('<polygon'), 'diamond rendered');
  assert.ok(svg.includes('marker-end'), 'arrow marker rendered');
  assert.ok(svg.includes('viewBox'));
  assert.equal(svg, renderSceneSvg(elements), 'deterministic');
});
