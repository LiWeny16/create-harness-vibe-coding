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
import { executeNodeAction } from '../workflow-node-runtime.mjs';

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

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(fn, { timeout = 5000, step = 25 } = {}) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await fn()
    if (last) return last
    await new Promise(resolve => setTimeout(resolve, step))
  }
  throw new Error(`waitFor timed out; last=${JSON.stringify(last)}`)
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
    writes.length = 0;
    const input = await jsonRequest(`${baseUrl}/api/workflow/nodes/${graphNodeId}/actions/agent.sendInput`, {
      method: 'POST',
      body: { text: 'hello from workflow\n' },
    });
    assert.equal(input.status, 200);
    assert.deepEqual(writes, ['hello from workflow\n']);

    const transcript = readTerminalRange(root, { sessionId: session.sessionId, tail: 20 });
    assert.ok(transcript.entries.some(entry => entry.stream === 'stdin' && entry.data.includes('hello from workflow')));
  });

  it('W26-AGENT-SENDINPUT submit mode separates prompt text from Enter through canonical API', async () => {
    writes.length = 0;
    const input = await jsonRequest(`${baseUrl}/api/workflow/nodes/${graphNodeId}/actions/agent.sendInput`, {
      method: 'POST',
      body: { data: 'W26_PROMPT_SUBMIT\r', submit: true },
    });
    assert.equal(input.status, 200);
    assert.equal(writes[0], 'W', 'the submit body must start typing synchronously');
    await waitFor(() => (writes.join('') === 'W26_PROMPT_SUBMIT\r' ? writes : null));
    assert.equal(writes.join(''), 'W26_PROMPT_SUBMIT\r', 'the typed body must join to the exact text + \\r');
    assert.equal(writes[writes.length - 1], '\r', 'the typed body must end with a single \\r');
    assert.equal(writes.join('').includes('\n'), false, 'no \\n may be injected');
    assert.equal(writes.filter(w => w === '\r').length, 1, 'exactly one \\r (0x0D)');
  });

  it('W25-AGENT-SENDINPUT prefers payload.data over text for submitted PTY input', async () => {
    writes.length = 0;
    const result = await executeNodeAction(root, graphNodeId, 'agent.sendInput', {
      text: 'W25_UNSUBMITTED_TEXT',
      data: 'W25_SUBMITTED_DATA\r',
    });

    assert.equal(result.ok, true);
    assert.equal(result.result.sessionId, session.sessionId);
    assert.deepEqual(writes, ['W25_SUBMITTED_DATA\r']);
  });

  it('W26-AGENT-SENDINPUT submit mode separates prompt text from Enter through direct action runtime', async () => {
    writes.length = 0;
    const result = await executeNodeAction(root, graphNodeId, 'agent.sendInput', {
      data: 'W26_DIRECT_SUBMIT\r',
      submit: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.result.sessionId, session.sessionId);
    assert.equal(writes[0], 'W', 'the direct submit body must start typing synchronously');
    await waitFor(() => (writes.join('') === 'W26_DIRECT_SUBMIT\r' ? writes : null));
    assert.equal(writes.join(''), 'W26_DIRECT_SUBMIT\r', 'the typed body must join to the exact text + \\r');
    assert.equal(writes[writes.length - 1], '\r', 'the typed body must end with a single \\r');
    assert.equal(writes.join('').includes('\n'), false, 'no \\n may be injected');
    assert.equal(writes.filter(w => w === '\r').length, 1, 'exactly one \\r (0x0D)');
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

describe('wf-ui created agent session graph binding', () => {
  it('W23-AGENT-GRAPH-BINDING binds POST /api/sessions agents as graph endpoints', async () => {
    const root = tempProjectRoot();
    const registry = new SessionRegistry();
    const server = createServer({ projectRoot: root, sessionRegistry: registry, token: '' });
    await new Promise(resolve => server.listen(0, resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const main = await jsonRequest(`${baseUrl}/api/sessions`, {
        method: 'POST',
        body: {
          runtime: 'codex',
          agentKind: 'main',
          role: 'Main Agent',
          objective: 'W23 main agent',
          deferPtySpawn: true,
        },
      });
      assert.equal(main.status, 201, JSON.stringify(main.body));
      assert.ok(main.body.graphNodeId, 'main session should return graphNodeId');

      const worker = await jsonRequest(`${baseUrl}/api/sessions`, {
        method: 'POST',
        body: {
          runtime: 'codex',
          agentKind: 'subagent',
          role: 'Implementer',
          objective: 'W23 worker agent',
          parentNodeId: main.body.graphNodeId,
          parentAgentId: main.body.sessionId,
          deferPtySpawn: true,
        },
      });
      assert.equal(worker.status, 201, JSON.stringify(worker.body));
      assert.ok(worker.body.graphNodeId, 'worker session should return graphNodeId');

      const graph = readGraph(root);
      const workerNode = graph.nodes.find(node => node.nodeId === worker.body.graphNodeId);
      assert.ok(workerNode, 'worker session should be persisted as a graph node');
      assert.equal(workerNode.kind, 'terminal-session');
      assert.equal(workerNode.sessionId, worker.body.sessionId);
      assert.equal(workerNode.agentKind, 'subagent');
      assert.equal(workerNode.runtime, 'codex');
      assert.equal(workerNode.status, 'blocked');
      assert.equal(workerNode.role, 'Implementer');
      assert.equal(workerNode.parentNodeId, main.body.graphNodeId);
      assert.equal(workerNode.parentAgentId, main.body.sessionId);
      assert.ok(Number.isFinite(workerNode.position?.x));
      assert.ok(Number.isFinite(workerNode.position?.y));

      const md = await jsonRequest(`${baseUrl}/api/workflow/nodes`, {
        method: 'POST',
        body: { type: 'markdown', title: 'W23 Agent Note' },
      });
      assert.equal(md.status, 201, JSON.stringify(md.body));

      const resourceEdge = await jsonRequest(`${baseUrl}/api/workflow/edges`, {
        method: 'POST',
        body: {
          from: worker.body.graphNodeId,
          to: md.body.node.nodeId,
          relation: 'context',
        },
      });
      assert.equal(resourceEdge.status, 201, JSON.stringify(resourceEdge.body));
      assert.equal(resourceEdge.body.edge.from, worker.body.graphNodeId);
      assert.equal(resourceEdge.body.edge.to, md.body.node.nodeId);

      const workerContext = await jsonRequest(`${baseUrl}/api/workflow/context/${worker.body.graphNodeId}`);
      assert.equal(workerContext.status, 200, JSON.stringify(workerContext.body));
      assert.ok(workerContext.body.context.connectedResourceRefs.some(ref => ref.nodeId === md.body.node.nodeId && ref.type === 'markdown'));

      const delegationEdge = await jsonRequest(`${baseUrl}/api/workflow/edges`, {
        method: 'POST',
        body: {
          from: main.body.graphNodeId,
          to: worker.body.graphNodeId,
          relation: 'delegation',
        },
      });
      assert.equal(delegationEdge.status, 201, JSON.stringify(delegationEdge.body));

      const mainContext = await jsonRequest(`${baseUrl}/api/workflow/context/${main.body.graphNodeId}`);
      assert.equal(mainContext.status, 200, JSON.stringify(mainContext.body));
      const workerRef = mainContext.body.context.connectedAgentRefs.find(ref => ref.nodeId === worker.body.graphNodeId);
      assert.ok(workerRef, 'connected main agent context should expose worker agent refs');
      assert.equal(workerRef.relation, 'delegation');
      assert.equal(workerRef.delegation.sendAction, 'agent.sendInput');
      assert.equal(workerRef.delegation.canReadContext, true);
    } finally {
      await new Promise(resolve => server.close(resolve));
      cleanup(root);
    }
  });
});
