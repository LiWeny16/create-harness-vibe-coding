import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) {
    const item = cleanup.pop();
    if (item.server) await stopServer(item.server);
    if (item.root) fs.rmSync(item.root, { recursive: true, force: true });
    if (item.outsideRoot) fs.rmSync(item.outsideRoot, { recursive: true, force: true });
  }
});

async function makeServer() {
  const root = makeHarnessTempRoot('wf-workspace-api-hardening-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0 });
  cleanup.push({ root, server: started.server });
  return { ...started, root, baseUrl: `http://127.0.0.1:${started.port}` };
}

function requestJson(baseUrl, token, method, route, payload) {
  const url = new URL(route, baseUrl);
  const body = payload === undefined ? null : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(responseBody) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: responseBody }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function getJson(baseUrl, token, route) {
  return requestJson(baseUrl, token, 'GET', route);
}

function postJson(baseUrl, token, route, payload) {
  return requestJson(baseUrl, token, 'POST', route, payload);
}

function contentBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function expectClientOrPayloadError(result) {
  assert.ok([400, 413].includes(result.status), `expected 400/413, got ${result.status}: ${JSON.stringify(result.body)}`);
  assert.equal(typeof result.body.error?.code, 'string');
  assert.match(result.body.error?.message || '', /limit|too large|base64|invalid|malformed|reserved|filename|trailing/i);
}

function createEscapeDirectoryLink(t, projectRoot) {
  const outsideRoot = makeHarnessTempRoot('wf-workspace-api-outside-');
  fs.writeFileSync(path.join(outsideRoot, 'secret.txt'), 'outside-secret', 'utf8');
  const linkPath = path.join(projectRoot, 'linked-outside');
  try {
    fs.symlinkSync(outsideRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    fs.rmSync(outsideRoot, { recursive: true, force: true });
    t.skip(`Symlink/junction creation unavailable on this platform: ${err.message}`);
    return null;
  }
  cleanup.at(-1).outsideRoot = outsideRoot;
  return { outsideRoot, linkPath };
}

test('AC-002 AC-003 hardening API rejects malformed base64 for workspace ops and user-files', async () => {
  const { root, baseUrl, token } = await makeServer();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'existing.txt'), 'keep', 'utf8');

  const create = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'create-file',
    target: 'src/corrupt.txt',
    contentBase64: 'not-valid-base64!!!',
  });
  const write = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'write',
    target: 'src/existing.txt',
    contentBase64: '!!!!',
  });
  const upload = await postJson(baseUrl, token, '/api/user-files', {
    source: 'paste',
    files: [{ name: 'shot.png', mime: 'image/png', contentBase64: 'bad??bad' }],
  });

  expectClientOrPayloadError(create);
  expectClientOrPayloadError(write);
  expectClientOrPayloadError(upload);
  assert.equal(fs.existsSync(path.join(root, 'src', 'corrupt.txt')), false);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'existing.txt'), 'utf8'), 'keep');
  assert.equal(fs.existsSync(path.join(root, 'Harness', 'user-files', 'images', 'shot.png')), false);
});

test('AC-003 hardening /api/user-files enforces file count limits', async () => {
  const { baseUrl, token } = await makeServer();
  const files = Array.from({ length: 65 }, (_, index) => ({
    name: `file-${index}.txt`,
    mime: 'text/plain',
    contentBase64: contentBase64('x'),
  }));

  const result = await postJson(baseUrl, token, '/api/user-files', {
    source: 'drop',
    files,
  });

  expectClientOrPayloadError(result);
});

test('AC-003 hardening /api/user-files enforces per-file and body size limits', async () => {
  const { root, baseUrl, token } = await makeServer();
  const oversized = Buffer.alloc(12 * 1024 * 1024, 97).toString('base64');

  const result = await postJson(baseUrl, token, '/api/user-files', {
    source: 'paste',
    files: [{ name: 'large.bin', mime: 'application/octet-stream', contentBase64: oversized }],
  });

  expectClientOrPayloadError(result);
  assert.equal(fs.existsSync(path.join(root, 'Harness', 'user-files', 'other', 'large.bin')), false);
});

test('AC-001 AC-002 hardening API rejects symlink or junction escaped tree and write operations', async (t) => {
  const { root, baseUrl, token } = await makeServer();
  const fixture = createEscapeDirectoryLink(t, root);
  if (!fixture) return;

  const tree = await getJson(baseUrl, token, '/api/workspace/tree?path=linked-outside');
  const write = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'write',
    target: 'linked-outside/secret.txt',
    contentBase64: contentBase64('mutated'),
  });

  assert.equal(tree.status, 400);
  assert.equal(tree.body.error.code, 'BAD_REQUEST');
  assert.match(tree.body.error.message, /symlink|junction|outside workspace|escape/i);
  assert.equal(write.status, 400);
  assert.equal(write.body.error.code, 'BAD_REQUEST');
  assert.match(write.body.error.message, /symlink|junction|outside workspace|escape/i);
  assert.equal(fs.readFileSync(path.join(fixture.outsideRoot, 'secret.txt'), 'utf8'), 'outside-secret');
});

test('AC-002 AC-003 hardening API rejects Windows reserved and trailing-dot/space names', async () => {
  const { baseUrl, token } = await makeServer();
  const invalidNames = ['NUL', 'CON', 'PRN', 'COM1', 'trailing.', 'trailing '];

  for (const name of invalidNames) {
    const workspace = await postJson(baseUrl, token, '/api/workspace/ops', {
      op: 'create-file',
      target: `reserved/${name}`,
      contentBase64: contentBase64('bad'),
    });
    const upload = await postJson(baseUrl, token, '/api/user-files', {
      source: 'paste',
      files: [{ name, mime: 'text/plain', contentBase64: contentBase64('bad') }],
    });

    expectClientOrPayloadError(workspace);
    expectClientOrPayloadError(upload);
  }
});
