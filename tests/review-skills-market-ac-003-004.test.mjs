import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { makeHarnessTempRoot } from './support/temp-root.js';
import { createServer } from '../src/wf-ui-server/server.mjs';

const roots = [];

function seedProject() {
  const root = makeHarnessTempRoot('wf-ui-skills-market-ac-003-004-');
  roots.push(root);
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({
    schemaVersion: 1,
    version: 1,
    nodes: [],
    edges: [],
    positions: {},
    undoStack: [],
    redoStack: [],
    deletedNodes: [],
  }));
  fs.mkdirSync(path.join(root, '.agents', 'skills', 'market-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'skills', 'market-fixture', 'SKILL.md'), [
    '---',
    'name: market-fixture',
    'description: Deterministic Skills Market fixture.',
    '---',
    '',
    '# Market fixture',
    '',
  ].join('\n'));
  return root;
}

function sessionRegistry() {
  return {
    getAll: () => [],
    get: () => null,
    create: () => {},
    stop: () => null,
    update: () => {},
    remove: () => {},
    withLock: (_key, fn) => Promise.resolve().then(fn),
  };
}

function request(baseUrl, pathname, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(new URL(pathname, baseUrl), {
      method,
      headers: payload === null ? {} : {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function withServer(fn) {
  const root = seedProject();
  const server = createServer({ projectRoot: root, sessionRegistry: sessionRegistry(), token: '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test.after(() => {
  for (const root of roots) {
    const resolved = path.resolve(root);
    const allowed = path.resolve('Harness', '.temp') + path.sep;
    assert.ok(resolved.startsWith(allowed), `refusing to remove non-Harness temp root: ${root}`);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-006 Skills Market list and install routes are not wired to the hub surface', async () => {
  await withServer(async baseUrl => {
    const list = await request(baseUrl, '/api/workflow/skills-market?scope=project');
    assert.equal(list.status, 404, JSON.stringify(list.body));
    const install = await request(baseUrl, '/api/workflow/skills-market/install', {
      method: 'POST',
      body: { packId: 'pack:missing-ac-004-fixture' },
    });
    assert.equal(install.status, 404, JSON.stringify(install.body));
  });
});
