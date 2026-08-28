// workflow-set-model.test.mjs
//
// agent.setModel backend action — model selection via project-scope runtime
// config files (no TUI keystrokes needed).
//
//   M1: setModel on a codex session → 200, project .codex/config.toml model
//       line updated, other lines preserved byte-for-byte, session record
//       model updated + restartRequired true
//   M2: unknown node → 404
//   M3: runtime without project config (deepseek: user-scope only) → 409
//       NO_PROJECT_MODEL_CONFIG
//   M4: empty model → 400
//   M5: only user-scope config exists (~/.codex) → 409
//       NO_PROJECT_MODEL_CONFIG, user file untouched
//   M6: JSON project config (.claude/settings.json) model field updated,
//       other fields preserved
//
// Pattern: in-process node:test + HTTP server on port 0, one temp project
// root for the server; config files and graph nodes are seeded under that
// same root (the action resolves project config paths against the server's
// project root). The user home is redirected to a temp dir BEFORE server.mjs
// is imported — runtime-detector.mjs captures os.homedir() at module load —
// so user-scope config paths (~/.codex/...) resolve inside the temp root and
// the real user home is never read or written. node --test runs each file in
// its own process, so the override stays local.
//
// Run: node --test src/wf-ui-server/__tests__/workflow-set-model.test.mjs
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { SessionRegistry } from '../session-registry.mjs';

// ── fake home redirect (must precede the server.mjs import) ──
const fakeHomeDir = makeHarnessTempRoot('wf-ui-set-model-home-');
process.env.USERPROFILE = fakeHomeDir;
process.env.HOMEDRIVE = path.parse(fakeHomeDir).root;
process.env.HOMEPATH = fakeHomeDir.slice(path.parse(fakeHomeDir).root.length);
process.env.HOME = fakeHomeDir;

const { createServer } = await import('../server.mjs');

// ── project seeding + helpers ──
function tempProjectRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  const a2a = path.join(root, 'Harness', 'a2a');
  fs.mkdirSync(path.join(a2a, 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(a2a, 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
  fs.writeFileSync(path.join(a2a, 'workflow-map.json'), JSON.stringify({
    schemaVersion: 1,
    version: 1,
    nodes: [],
    edges: [],
    positions: {},
    undoStack: [],
    redoStack: [],
    deletedNodes: [],
  }));
  return root;
}

function addGraphNode(root, { nodeId, sessionId, runtime }) {
  const file = path.join(root, 'Harness', 'a2a', 'workflow-map.json');
  const graph = JSON.parse(fs.readFileSync(file, 'utf8'));
  graph.nodes.push({
    nodeId,
    sessionId,
    kind: 'terminal-session',
    agentKind: 'main',
    runtime,
    status: 'running',
    cwd: root,
    position: { x: 120, y: 90 },
  });
  graph.positions[nodeId] = { x: 120, y: 90 };
  fs.writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
}

function makeAgentNode(registry, root, { runtime, graphNodeId }) {
  const session = registry.create({
    runtime,
    agentKind: 'main',
    role: 'main',
    objective: 'agent.setModel test',
    projectRoot: root,
    cwd: root,
    graphNodeId,
  });
  registry.update(session.sessionId, { status: 'running', graphNodeId });
  addGraphNode(root, { nodeId: graphNodeId, sessionId: session.sessionId, runtime });
  return { session: registry.get(session.sessionId), graphNodeId };
}

function jsonRequest(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { 'content-type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('agent.setModel workflow node action', () => {
  let root;
  let registry;
  let server;
  let baseUrl;

  before(async () => {
    root = tempProjectRoot('wf-ui-set-model-');
    registry = new SessionRegistry();
    server = createServer({ projectRoot: root, sessionRegistry: registry, token: '' });
    await new Promise(resolve => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    if (server) server.close();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(fakeHomeDir, { recursive: true, force: true }); } catch {}
  });

  it('M1: setModel updates the project .codex/config.toml model line and the session record', async () => {
    const configDir = path.join(root, '.codex');
    fs.mkdirSync(configDir, { recursive: true });
    try {
      const seed = [
        '# codex project config',
        'model = "gpt-5.4"',
        'model_provider = "openai"',
        '',
        '[model_providers.anthropic]',
        'name = "anthropic"',
      ].join('\n');
      fs.writeFileSync(path.join(configDir, 'config.toml'), seed, 'utf8');

      const { session, graphNodeId } = makeAgentNode(registry, root, { runtime: 'codex', graphNodeId: 'setmodel-m1' });
      const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/${graphNodeId}/actions/agent.setModel`, {
        method: 'POST',
        body: { model: 'gpt-5.5' },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.ok, true);
      assert.equal(res.body.action, 'agent.setModel');
      assert.equal(res.body.model, 'gpt-5.5');
      assert.equal(res.body.configFile, '.codex/config.toml');
      assert.equal(res.body.restartRequired, true);

      const text = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
      assert.equal(text, [
        '# codex project config',
        'model = "gpt-5.5"',
        'model_provider = "openai"',
        '',
        '[model_providers.anthropic]',
        'name = "anthropic"',
      ].join('\n'), 'only the top-level model line may change; every other byte preserved');

      const updated = registry.get(session.sessionId);
      assert.equal(updated.model, 'gpt-5.5');
      assert.equal(updated.restartRequired, true);
      assert.ok(updated.restartRequiredFields.includes('model'), 'restartRequiredFields must include model');

      const disk = JSON.parse(fs.readFileSync(
        path.join(root, 'Harness', 'a2a', 'sessions', session.sessionId, 'STATE.json'), 'utf8'));
      assert.equal(disk.model, 'gpt-5.5');
      assert.equal(disk.restartRequired, true);
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('M2: unknown node → 404', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/setmodel-does-not-exist/actions/agent.setModel`, {
      method: 'POST',
      body: { model: 'gpt-6' },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('M3: runtime without a project config → 409 NO_PROJECT_MODEL_CONFIG', async () => {
    // deepseek defines only a user-scope config (~/.deepseek/config.toml),
    // so no project-scope model config is known for the runtime.
    const { graphNodeId } = makeAgentNode(registry, root, { runtime: 'deepseek', graphNodeId: 'setmodel-m3' });
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/${graphNodeId}/actions/agent.setModel`, {
      method: 'POST',
      body: { model: 'deepseek-v4' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'NO_PROJECT_MODEL_CONFIG');
  });

  it('M4: empty model → 400', async () => {
    const { graphNodeId } = makeAgentNode(registry, root, { runtime: 'codex', graphNodeId: 'setmodel-m4' });
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/${graphNodeId}/actions/agent.setModel`, {
      method: 'POST',
      body: { model: '   ' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  it('M5: user-scope config is never touched — only user config exists → 409', async () => {
    // Seed the USER-scope codex config inside the redirected fake home; the
    // project itself has no .codex/config.toml.
    const userConfigPath = path.join(fakeHomeDir, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
    fs.writeFileSync(userConfigPath, 'model = "user-model"\n', 'utf8');

    const { graphNodeId } = makeAgentNode(registry, root, { runtime: 'codex', graphNodeId: 'setmodel-m5' });
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/${graphNodeId}/actions/agent.setModel`, {
      method: 'POST',
      body: { model: 'gpt-6' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'NO_PROJECT_MODEL_CONFIG');
    assert.equal(fs.readFileSync(userConfigPath, 'utf8'), 'model = "user-model"\n', 'user-scoped config must remain untouched');
  });

  it('M6: JSON project config (.claude/settings.json) model updated, other fields preserved', async () => {
    const settingsDir = path.join(root, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    try {
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
        model: 'claude-opus-4-0',
        env: { MY_VAR: 'keep-me' },
        permissions: { allow: ['Bash'] },
      }, null, 2), 'utf8');

      const { session, graphNodeId } = makeAgentNode(registry, root, { runtime: 'claude', graphNodeId: 'setmodel-m6' });
      const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/${graphNodeId}/actions/agent.setModel`, {
        method: 'POST',
        body: { model: 'claude-opus-4-1' },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.configFile, '.claude/settings.json');
      assert.equal(res.body.restartRequired, true);

      const data = JSON.parse(fs.readFileSync(path.join(settingsDir, 'settings.json'), 'utf8'));
      assert.equal(data.model, 'claude-opus-4-1');
      assert.deepEqual(data.env, { MY_VAR: 'keep-me' });
      assert.deepEqual(data.permissions, { allow: ['Bash'] });

      const updated = registry.get(session.sessionId);
      assert.equal(updated.model, 'claude-opus-4-1');
      assert.equal(updated.restartRequired, true);
    } finally {
      fs.rmSync(settingsDir, { recursive: true, force: true });
    }
  });
});
