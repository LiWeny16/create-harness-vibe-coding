import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), `.tmp-mcp-hub-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({
    schemaVersion: 1,
    version: 1,
    nodes: [],
    edges: [],
    positions: {},
    undoStack: [],
    redoStack: [],
    deletedNodes: [],
  }));
  return dir;
}

function writeJson(root, relPath, value) {
  const filePath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function jsonRequest(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET' }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Workflow MCP Hub', () => {
  const roots = [];
  after(() => roots.forEach(cleanup));

  it('indexes project MCP configs without spawning servers or leaking secrets', async () => {
    const root = tempProjectRoot();
    roots.push(root);
    const sentinel = path.join(root, 'mcp-spawned.txt');
    writeJson(root, '.mcp.json', {
      mcpServers: {
        github: {
          command: process.execPath,
          args: ['-e', `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'spawned')`, '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_TOKEN: 'ghp_secret_value',
          },
        },
        linear: {
          transport: 'sse',
          url: 'https://api.linear.app/mcp?token=super-secret#frag',
        },
      },
    });

    const hub = await import('../workflow-mcp-hub.mjs');
    const result = hub.listMcpHub(root, { scope: 'project' });

    assert.equal(result.ok, true);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.kind, 'mcp-hub');
    assert.equal(result.nodeSemantics.safety, 'metadata-only-no-spawn-no-secret');
    assert.equal(result.summary.serverCount, 2);
    assert.ok(result.roots.every(source => !path.isAbsolute(source.path)), `absolute path leaked: ${JSON.stringify(result.roots)}`);
    assert.equal(fs.existsSync(sentinel), false, 'MCP Hub must not spawn command metadata');

    const github = result.servers.find(server => server.name === 'github');
    assert.ok(github, 'github server should be indexed');
    assert.equal(github.commandName, path.basename(process.execPath));
    assert.equal(github.argCount, 3);
    assert.deepEqual(github.envKeys, ['GITHUB_TOKEN']);
    assert.equal(github.creatable, true);
    assert.equal(github.attachable, false);
    assert.equal(github.risk.commandNotExecuted, true);
    assert.equal(github.risk.credentialsNotProbed, true);

    const linear = result.servers.find(server => server.name === 'linear');
    assert.ok(linear, 'linear server should be indexed');
    assert.equal(linear.url, 'https://api.linear.app/mcp');
    assert.equal(linear.risk.secretsRedacted, true);

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('ghp_secret_value'), false);
    assert.equal(serialized.includes('super-secret'), false);
    assert.equal(serialized.includes('@modelcontextprotocol/server-github'), false);
    assert.equal(serialized.includes('writeFileSync'), false);
    for (const forbidden of ['"args"', '"env"', '"command"', '"filePath"', '"searchText"', '"raw"', '"rawConfig"', '"mcpConfig"', '"configBody"', '"body"', '"toolSchema"', '"resources"']) {
      assert.equal(serialized.includes(forbidden), false, `MCP Hub response leaked forbidden field ${forbidden}`);
    }
  });

  it('redacts path-embedded URL credentials from MCP server metadata', async () => {
    const root = tempProjectRoot();
    roots.push(root);
    writeJson(root, '.mcp.json', {
      mcpServers: {
        pathToken: {
          url: 'https://docs.example.test/mcp/token/super-secret-path?key=secret#hash',
        },
      },
    });

    const hub = await import('../workflow-mcp-hub.mjs');
    const result = hub.listMcpHub(root, { scope: 'project' });
    const server = result.servers.find(item => item.name === 'pathToken');
    assert.ok(server, 'pathToken server should be indexed');
    assert.equal(server.url, 'https://docs.example.test/mcp/token/redacted');
    assert.equal(JSON.stringify(result).includes('super-secret-path'), false);
    assert.equal(JSON.stringify(result).includes('key=secret'), false);
  });

  it('GET /api/workflow/mcp-hub returns searchable project-scoped metadata', async () => {
    const root = tempProjectRoot();
    roots.push(root);
    writeJson(root, '.cursor/mcp.json', {
      mcpServers: {
        filesystem: {
          command: 'node',
          args: ['server.js', '--root', 'C:/secret/path'],
          env: { FILESYSTEM_ROOT: 'C:/secret/path' },
        },
        docs: {
          url: 'https://docs.example.test/mcp?key=secret',
        },
      },
    });

    const mod = await import('../server.mjs');
    const sessionMock = { getAll: () => [], get: () => null, create: () => {}, stop: () => null, update: () => {}, remove: () => {}, withLock: (_k, fn) => Promise.resolve().then(fn) };
    const server = mod.createServer({ projectRoot: root, sessionRegistry: sessionMock, token: '' });
    await new Promise(resolve => server.listen(0, resolve));
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const all = await jsonRequest(`${baseUrl}/api/workflow/mcp-hub?scope=project`);
      assert.equal(all.status, 200, JSON.stringify(all.body));
      assert.equal(all.body.ok, true);
      assert.equal(all.body.kind, 'mcp-hub');
      assert.ok(all.body.servers.some(server => server.name === 'filesystem'));
      assert.ok(all.body.servers.some(server => server.name === 'docs'));

      const filtered = await jsonRequest(`${baseUrl}/api/workflow/mcp-hub?scope=project&q=docs`);
      assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
      assert.deepEqual(filtered.body.servers.map(server => server.name), ['docs']);
      const filteredJson = JSON.stringify(filtered.body);
      assert.equal(filteredJson.includes('key=secret'), false);
      assert.equal(filteredJson.includes('C:/secret/path'), false);

      const badScope = await jsonRequest(`${baseUrl}/api/workflow/mcp-hub?scope=user`);
      assert.equal(badScope.status, 400, JSON.stringify(badScope.body));
      assert.equal(badScope.body.error.code, 'INVALID_SCOPE');
    } finally {
      server.close();
    }
  });
});
