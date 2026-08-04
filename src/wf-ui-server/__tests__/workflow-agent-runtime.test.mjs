import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import { readTerminalRange } from '../terminal-store.mjs';
import { registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';

function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), `.tmp-agent-runtime-${id}`);
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
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

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function readGraph(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'a2a', 'workflow-map.json'), 'utf8'));
}

function writeGraph(root, graph) {
  fs.writeFileSync(path.join(root, 'Harness', 'a2a', 'workflow-map.json'), `${JSON.stringify(graph, null, 2)}\n`);
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

describe('canonical workflow agent runtime', () => {
  let root;
  let registry;
  let server;
  let baseUrl;
  let session;
  const graphNodeId = 'agent-runtime-01';
  const writes = [];
  let killed = false;

  before(async () => {
    root = tempProjectRoot();
    registry = new SessionRegistry();
    session = registry.create({
      runtime: 'codex',
      agentKind: 'main',
      role: 'main',
      objective: 'agent runtime test',
      projectRoot: root,
      cwd: root,
      graphNodeId,
    });
    registry.update(session.sessionId, { status: 'running', graphNodeId });
    session = registry.get(session.sessionId);
    writeGraph(root, {
      ...readGraph(root),
      nodes: [{
        nodeId: graphNodeId,
        sessionId: session.sessionId,
        kind: 'terminal-session',
        agentKind: 'main',
        runtime: 'codex',
        status: 'running',
        cwd: root,
        position: { x: 120, y: 90 },
      }],
      positions: { [graphNodeId]: { x: 120, y: 90 } },
    });
    registerPtyProcess(session.sessionId, {
      write(data) { writes.push(String(data)); },
      kill() { killed = true; },
    });
    server = createServer({ projectRoot: root, sessionRegistry: registry, token: '' });
    await new Promise(resolve => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    unregisterPtyProcess(session?.sessionId);
    if (server) server.close();
    cleanup(root);
  });

  it('lists agent nodes and resolves canonical context endpoint for an agent', async () => {
    const list = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    assert.equal(list.status, 200);
    assert.ok(list.body.nodes.some(node => node.kind === 'agent' && node.nodeId === graphNodeId));

    const context = await jsonRequest(`${baseUrl}/api/workflow/context/${graphNodeId}`);
    assert.equal(context.status, 200);
    assert.equal(context.body.node.nodeId, graphNodeId);
    assert.equal(context.body.context.sessionId, session.sessionId);
  });

  it('accepts session ids in canonical edges and stores graph node ids', async () => {
    const md = await jsonRequest(`${baseUrl}/api/workflow/nodes`, {
      method: 'POST',
      body: { type: 'markdown', title: 'Agent Context' },
    });
    assert.equal(md.status, 201);

    const edge = await jsonRequest(`${baseUrl}/api/workflow/edges`, {
      method: 'POST',
      body: { from: md.body.node.nodeId, to: session.sessionId, sourceHandle: 'markdown', targetHandle: 'context' },
    });
    assert.equal(edge.status, 201);
    assert.equal(edge.body.edge.from, md.body.node.nodeId);
    assert.equal(edge.body.edge.to, graphNodeId);
  });

  it('agent.sendInput writes PTY input and records terminal stdin through the canonical action', async () => {
    const input = await jsonRequest(`${baseUrl}/api/workflow/nodes/${graphNodeId}/actions/agent.sendInput`, {
      method: 'POST',
      body: { text: 'hello from workflow\n' },
    });
    assert.equal(input.status, 200);
    assert.deepEqual(writes, ['hello from workflow\n']);

    const transcript = readTerminalRange(root, { sessionId: session.sessionId, tail: 20 });
    assert.ok(transcript.entries.some(entry => entry.stream === 'stdin' && entry.data.includes('hello from workflow')));
  });

  it('agent.stop updates graph status and agent.delete removes the stopped graph node', async () => {
    const stop = await jsonRequest(`${baseUrl}/api/workflow/nodes/${graphNodeId}/actions/agent.stop`, {
      method: 'POST',
      body: {},
    });
    assert.equal(stop.status, 200);
    assert.equal(killed, true);
    assert.equal(readGraph(root).nodes.find(node => node.nodeId === graphNodeId)?.status, 'stopped');

    const deleted = await jsonRequest(`${baseUrl}/api/workflow/nodes/${graphNodeId}/actions/agent.delete`, {
      method: 'POST',
      body: {},
    });
    assert.equal(deleted.status, 200);
    assert.ok(!readGraph(root).nodes.some(node => node.nodeId === graphNodeId));
  });
});
