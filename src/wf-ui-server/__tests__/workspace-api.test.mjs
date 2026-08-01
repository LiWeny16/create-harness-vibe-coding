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
  }
});

async function makeServer() {
  const root = makeHarnessTempRoot('wf-workspace-api-');
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

function requestRaw(baseUrl, token, method, route, options = {}) {
  const url = new URL(route, baseUrl);
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => { chunks.push(chunk); });
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          text: body.toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function getJson(baseUrl, token, route) {
  return requestJson(baseUrl, token, 'GET', route);
}

function postJson(baseUrl, token, route, payload) {
  return requestJson(baseUrl, token, 'POST', route, payload);
}

function workspaceApiPath(endpoint, relPath, extra = '') {
  return `${endpoint}?path=${encodeURIComponent(relPath)}${extra}`;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

test('AC-001 GET /api/workspace/tree lazily lists root-bounded directory metadata', async () => {
  const { root, baseUrl, token } = await makeServer();
  fs.mkdirSync(path.join(root, 'src', 'ui'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export {};\n');

  const result = await getJson(baseUrl, token, '/api/workspace/tree?path=src');

  assert.equal(result.status, 200);
  assert.equal(result.body.root, root);
  assert.equal(result.body.path, 'src');
  assert.equal(result.body.absolutePath, path.join(root, 'src'));
  assert.ok(result.body.entries.some(entry => entry.name === 'index.ts' && entry.path === 'src/index.ts' && entry.type === 'file'));
  assert.ok(result.body.entries.some(entry => entry.name === 'ui' && entry.path === 'src/ui' && entry.type === 'directory'));
  for (const entry of result.body.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['hasChildren', 'mtime', 'name', 'path', 'size', 'type'].sort());
    assert.equal(path.isAbsolute(entry.path), false);
  }
});

test('AC-001 GET /api/workspace/tree denies traversal and returns 404 for missing paths', async () => {
  const { baseUrl, token } = await makeServer();

  const traversal = await getJson(baseUrl, token, '/api/workspace/tree?path=..%2Foutside');
  const missing = await getJson(baseUrl, token, '/api/workspace/tree?path=missing');

  assert.equal(traversal.status, 400);
  assert.equal(traversal.body.error.code, 'BAD_REQUEST');
  assert.match(traversal.body.error.message, /outside workspace|traversal|escape/i);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('AC-003 GET /api/workspace/meta enforces auth and returns existing, missing, escaped, and directory metadata states', async () => {
  const { root, baseUrl, token } = await makeServer();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'guide.md'), '# Guide\n\nWorkspace metadata.\n');

  const outsideRoot = makeHarnessTempRoot('wf-workspace-meta-outside-');
  cleanup.push({ root: outsideRoot });
  fs.writeFileSync(path.join(outsideRoot, 'secret.txt'), 'outside');
  const linkPath = path.join(root, 'docs', 'outside-link');
  fs.symlinkSync(outsideRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');

  const missingAuth = await requestRaw(baseUrl, null, 'GET', workspaceApiPath('/api/workspace/meta', 'docs/guide.md'));
  const existing = await getJson(baseUrl, token, workspaceApiPath('/api/workspace/meta', 'docs/guide.md'));
  const missing = await getJson(baseUrl, token, workspaceApiPath('/api/workspace/meta', 'docs/missing.md'));
  const traversal = await getJson(baseUrl, token, '/api/workspace/meta?path=..%2Fescape.md');
  const symlinkEscape = await getJson(baseUrl, token, workspaceApiPath('/api/workspace/meta', 'docs/outside-link/secret.txt'));
  const directory = await getJson(baseUrl, token, workspaceApiPath('/api/workspace/meta', 'docs'));

  assert.equal(missingAuth.status, 401);
  assert.equal(existing.status, 200);
  assert.equal(existing.body.ok, true);
  assert.equal(existing.body.path, 'docs/guide.md');
  assert.equal(existing.body.name, 'guide.md');
  assert.equal(existing.body.type, 'file');
  assert.equal(existing.body.exists, true);
  assert.equal(existing.body.size, Buffer.byteLength('# Guide\n\nWorkspace metadata.\n'));
  assert.match(existing.body.mime, /^text\/markdown\b/);
  assert.equal(typeof existing.body.mtime, 'string');
  assert.equal(typeof existing.body.etag, 'string');
  assert.equal(existing.body.previewKind, 'text');

  assert.equal(missing.status, 200);
  assert.equal(missing.body.ok, true);
  assert.equal(missing.body.exists, false);
  assert.equal(missing.body.path, 'docs/missing.md');
  assert.equal(missing.body.type, 'missing');
  assert.equal(missing.body.previewKind, 'missing');

  assert.equal(traversal.status, 400);
  assert.equal(traversal.body.error.code, 'BAD_REQUEST');
  assert.equal(symlinkEscape.status, 400);
  assert.equal(symlinkEscape.body.error.code, 'BAD_REQUEST');

  assert.equal(directory.status, 200);
  assert.equal(directory.body.exists, true);
  assert.equal(directory.body.type, 'directory');
  assert.equal(directory.body.previewKind, 'none');
});

test('AC-003 HEAD and Range /api/workspace/file expose byte-pipe headers and 206/416 behavior', async () => {
  const { root, baseUrl, token } = await makeServer();
  fs.mkdirSync(path.join(root, 'media'), { recursive: true });
  const content = Buffer.from('0123456789abcdef');
  fs.writeFileSync(path.join(root, 'media', 'sample.txt'), content);
  const route = workspaceApiPath('/api/workspace/file', 'media/sample.txt');

  const head = await requestRaw(baseUrl, token, 'HEAD', route);
  assert.equal(head.status, 200);
  assert.match(head.headers['content-type'], /^text\/plain\b/);
  assert.equal(Number(head.headers['content-length']), content.length);
  assert.equal(head.headers['accept-ranges'], 'bytes');
  assert.equal(typeof head.headers.etag, 'string');
  assert.equal(typeof head.headers['last-modified'], 'string');
  assert.equal(head.body.length, 0);

  const partial = await requestRaw(baseUrl, token, 'GET', route, {
    headers: { Range: 'bytes=2-5' },
  });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers['content-range'], `bytes 2-5/${content.length}`);
  assert.equal(Number(partial.headers['content-length']), 4);
  assert.equal(partial.headers['accept-ranges'], 'bytes');
  assert.equal(partial.text, '2345');

  const unsatisfiable = await requestRaw(baseUrl, token, 'GET', route, {
    headers: { Range: `bytes=${content.length + 10}-${content.length + 20}` },
  });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers['content-range'], `bytes */${content.length}`);
});

test('AC-003 GET /api/workspace/text returns bounded UTF-8 previews and rejects binary content', async () => {
  const { root, baseUrl, token } = await makeServer();
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  const text = 'alpha\nbeta\ngamma\ndelta\nepsilon\n';
  fs.writeFileSync(path.join(root, 'notes', 'long.txt'), text);
  fs.writeFileSync(path.join(root, 'notes', 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff, 0x10]));

  const preview = await getJson(baseUrl, token, workspaceApiPath('/api/workspace/text', 'notes/long.txt', '&offset=6&limit=12'));
  assert.equal(preview.status, 200);
  assert.equal(preview.body.ok, true);
  assert.equal(preview.body.text, text.slice(6, 18));
  assert.equal(preview.body.bytesRead, 12);
  assert.equal(preview.body.truncated, true);
  assert.equal(preview.body.encoding, 'utf-8');
  assert.equal(preview.body.path, 'notes/long.txt');

  const binary = await getJson(baseUrl, token, workspaceApiPath('/api/workspace/text', 'notes/blob.bin', '&limit=12'));
  assert.equal(binary.status, 415);
  assert.equal(binary.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('AC-002 POST /api/workspace/ops supports create/write/rename/move/copy/delete and JSONL logging', async () => {
  const { root, baseUrl, token } = await makeServer();

  const createFolder = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'create-folder',
    target: 'src',
  });
  const createFile = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'create-file',
    target: 'src/a.txt',
    contentBase64: Buffer.from('one').toString('base64'),
  });
  const write = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'write',
    target: 'src/a.txt',
    contentBase64: Buffer.from('two').toString('base64'),
  });
  const rename = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'rename',
    source: 'src/a.txt',
    target: 'src/b.txt',
  });
  const copy = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'copy',
    source: 'src/b.txt',
    target: 'src/c.txt',
  });
  const move = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'move',
    source: 'src/c.txt',
    target: 'src/d.txt',
  });
  const remove = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'delete',
    source: 'src/d.txt',
  });

  for (const result of [createFolder, createFile, write, rename, copy, move, remove]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(typeof result.body.opId, 'string');
    assert.equal(result.body.undoable, true);
    assert.equal(typeof result.body.revision, 'number');
    assert.ok(Array.isArray(result.body.entriesChanged));
  }

  assert.equal(fs.readFileSync(path.join(root, 'src', 'b.txt'), 'utf8'), 'two');
  assert.equal(fs.existsSync(path.join(root, 'src', 'd.txt')), false);
  assert.equal(path.dirname(remove.body.trashPath), path.join(root, 'Harness', '.trash', 'workspace-ops', remove.body.opId));
  assert.equal(fs.readFileSync(remove.body.trashPath, 'utf8'), 'two');

  const rows = readJsonl(path.join(root, 'Harness', 'a2a', 'workspace-ops.jsonl'));
  assert.deepEqual(rows.map(row => row.op), ['create-folder', 'create-file', 'write', 'rename', 'copy', 'move', 'delete']);
  assert.equal(new Set(rows.map(row => row.opId)).size, rows.length);
});

test('AC-002 /api/workspace/ops rejects traversal and overwrite conflicts without mutating disk', async () => {
  const { root, baseUrl, token } = await makeServer();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'existing.txt'), 'keep');

  const traversal = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'create-file',
    target: '../escape.txt',
    contentBase64: Buffer.from('bad').toString('base64'),
  });
  const conflict = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'create-file',
    target: 'src/existing.txt',
    contentBase64: Buffer.from('replace').toString('base64'),
  });

  assert.equal(traversal.status, 400);
  assert.equal(traversal.body.error.code, 'BAD_REQUEST');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'CONFLICT');
  assert.equal(fs.readFileSync(path.join(root, 'src', 'existing.txt'), 'utf8'), 'keep');
});

test('AC-002 POST /api/workspace/undo restores latest and specific opId disk state', async () => {
  const { root, baseUrl, token } = await makeServer();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'original.txt'), 'body');

  const deleted = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'delete',
    source: 'src/original.txt',
  });
  const folder = await postJson(baseUrl, token, '/api/workspace/ops', {
    op: 'create-folder',
    target: 'scratch',
  });

  const undoLatest = await postJson(baseUrl, token, '/api/workspace/undo', { opId: 'latest' });
  assert.equal(undoLatest.status, 200);
  assert.equal(undoLatest.body.ok, true);
  assert.equal(undoLatest.body.undoneOpId, folder.body.opId);
  assert.equal(fs.existsSync(path.join(root, 'scratch')), false);

  const undoDelete = await postJson(baseUrl, token, '/api/workspace/undo', { opId: deleted.body.opId });
  assert.equal(undoDelete.status, 200);
  assert.equal(undoDelete.body.ok, true);
  assert.equal(undoDelete.body.undoneOpId, deleted.body.opId);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'original.txt'), 'utf8'), 'body');
});

test('AC-003 POST /api/user-files categorizes paste/drop uploads and returns terminal references', async () => {
  const { root, baseUrl, token } = await makeServer();
  const files = [
    { name: 'shot.png', mime: 'image/png', expectedDir: 'images', body: 'image-bytes' },
    { name: 'brief.pdf', mime: 'application/pdf', expectedDir: 'pdf', body: '%PDF' },
    { name: 'notes.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', expectedDir: 'documents', body: 'doc' },
    { name: 'bundle.zip', mime: 'application/zip', expectedDir: 'archives', body: 'zip' },
    { name: 'readme.txt', mime: 'text/plain', expectedDir: 'text', body: 'txt' },
    { name: 'blob.bin', mime: 'application/octet-stream', expectedDir: 'other', body: 'bin' },
    { name: 'selection.md', mime: 'text/markdown', categoryHint: 'context', expectedDir: 'context', body: '# context' },
  ];

  const result = await postJson(baseUrl, token, '/api/user-files', {
    source: 'paste',
    files: files.map(file => ({
      name: file.name,
      mime: file.mime,
      categoryHint: file.categoryHint,
      contentBase64: Buffer.from(file.body).toString('base64'),
    })),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.files.length, files.length);
  for (const expected of files) {
    const stored = result.body.files.find(file => file.name === expected.name);
    assert.ok(stored, `missing stored result for ${expected.name}`);
    assert.equal(stored.category, expected.expectedDir);
    assert.equal(stored.path, `Harness/user-files/${expected.expectedDir}/${expected.name}`);
    assert.equal(stored.absolutePath, path.join(root, 'Harness', 'user-files', expected.expectedDir, expected.name));
    assert.equal(stored.terminalTag, `@file(${stored.path})`);
    assert.equal(fs.readFileSync(stored.absolutePath, 'utf8'), expected.body);
  }
});
