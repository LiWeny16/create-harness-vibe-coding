// workflow-graph-undo.test.mjs
//
// P5 graph undo/redo suite (Harness/tasks/task-agent-control-parity/UNDO-DESIGN.md).
//
//   U1 — moveNode records an op; undo restores the old position; redo re-applies.
//   U2 — deleteNode records node+edges; undo restores node+edges; redo re-deletes.
//   U3 — connect/disconnect/updateEdge record ops; undo restores old edge state.
//   U4 — attachDock/detachDock record ops; undo restores the dock link.
//   U5 — history cap 50: the oldest op is pruned.
//   U6 — empty-stack undo/redo are idempotent ({ok:true, applied:null}).
//   U7 — a new op clears the redo stack.
//   U8 — version-guarded undo: stale expectedVersion yields 409 STALE_GRAPH_VERSION.
//   U9 — restart persistence: history survives in workflow-map.json; undo works
//       after a server restart on the same project root.
//   U10 — CLI node-map --action undo posts to graph.undo and returns the
//       {ok, opId, applied, version} shape.
//
// Pattern: in-process node:test + HTTP server on port 0, temp roots, real
// `node Harness/scripts/wf-ui-control.mjs` subprocesses for the CLI test
// (mirrors control-plane-cli-smoke.test.mjs and workflow-depth-resume-dock.test.mjs).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { SessionRegistry } from '../session-registry.mjs';
import { startServer, stopServer } from '../server.mjs';
import { loadWorkflowGraphMap, writeWorkflowGraphMap } from '../a2a-store.mjs';
import { connectNodes, disconnectNodes, moveNode, redoGraphOp, undoGraphOp, updateEdge } from '../workflow-graph-store.mjs';
import { createComponentNode, getComponentNode } from '../component-node-store.mjs';
import { deleteNode } from '../workflow-node-runtime.mjs';
import { persistSession } from '../terminal-store.mjs';

function jsonRequest(baseUrl, route, { method = 'GET', body, token = '', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function runWfUi(args, { cwd, env = {}, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const script = path.join(cwd, 'Harness', 'scripts', 'wf-ui-control.mjs');
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`wf-ui-control timeout: ${args.join(' ')}`));
    }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      let parsed = stdout.trim();
      try { parsed = JSON.parse(parsed); } catch { /* non-JSON output stays raw */ }
      resolve({ status, stdout: parsed, stderr });
    });
  });
}

function seedRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

function agentNode(nodeId, sessionId, agentKind = 'subagent', role = 'Agent') {
  return {
    nodeId,
    sessionId,
    kind: 'terminal-session',
    runtime: 'claude',
    agentKind,
    role,
    label: role,
    status: 'running',
  };
}

function seedGraph(root, nodes, edges = [], options = {}) {
  writeWorkflowGraphMap(root, {
    schemaVersion: 1,
    version: 1,
    nodes,
    edges,
    capsuleDockLinks: options.capsuleDockLinks || [],
    positions: Object.fromEntries(nodes.map(node => [node.nodeId, { x: 0, y: 0 }])),
  });
}

function seedAgentSession(root, nodeId, sessionId, agentKind = 'subagent', role = 'Agent') {
  persistSession(root, {
    sessionId,
    graphNodeId: nodeId,
    runtime: 'claude',
    agentKind,
    role,
    status: 'running',
    attachMode: true,
    taskId: null,
  });
}

function historyActor(nodeId, sessionId) {
  return { kind: 'agent', nodeId, sessionId };
}

describe('P5 graph undo/redo (UNDO-DESIGN U1-U10)', () => {
  let root;
  let registry;
  let server;
  let baseUrl;

  beforeEach(async () => {
    root = seedRoot('wf-undo-');
    registry = new SessionRegistry();
    const started = await startServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      sessionRegistry: registry,
      eventsWs: false,
    });
    server = started.server;
    baseUrl = `http://127.0.0.1:${started.port}`;
  });

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
    if (root) {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      root = null;
    }
  });

  async function restartServer() {
    if (server) {
      await stopServer(server);
      server = null;
    }
    registry = new SessionRegistry();
    const started = await startServer({
      projectRoot: root,
      host: '127.0.0.1',
      port: 0,
      sessionRegistry: registry,
      eventsWs: false,
    });
    server = started.server;
    baseUrl = `http://127.0.0.1:${started.port}`;
  }

  it('U1 - moveNode records an op; undo restores the old position; redo re-applies', async () => {
    const main = agentNode('u1-main', 'u1-main-session', 'main', 'Main Agent');
    const worker = agentNode('u1-worker', 'u1-worker-session');
    seedGraph(root, [main, worker]);
    seedAgentSession(root, main.nodeId, main.sessionId, 'main');

    const moved = moveNode(root, 'u1-worker', { x: 300, y: 400 }, { action: 'agent.moveNode', actor: historyActor(main.nodeId, main.sessionId) });
    assert.equal(moved.position.x, 300);

    const graph = loadWorkflowGraphMap(root);
    assert.equal(graph.undoStack.length, 1);
    const op = graph.undoStack[0];
    assert.match(op.opId, /^op-/);
    assert.equal(typeof op.ts, 'string');
    assert.equal(op.actor.kind, 'agent');
    assert.equal(op.actor.nodeId, 'u1-main');
    assert.equal(op.action, 'agent.moveNode');
    assert.deepEqual(op.inverse.positions['u1-worker'], { x: 0, y: 0 });
    assert.deepEqual(op.forward.positions['u1-worker'], { x: 300, y: 400 });
    assert.deepEqual(graph.redoStack, []);

    const undone = undoGraphOp(root);
    assert.equal(undone.ok, true);
    assert.equal(undone.opId, op.opId);
    assert.equal(undone.version, graph.version + 1);
    assert.deepEqual(undone.applied.positions['u1-worker'], { x: 0, y: 0 });
    assert.deepEqual(loadWorkflowGraphMap(root).positions['u1-worker'], { x: 0, y: 0 });
    assert.equal(loadWorkflowGraphMap(root).redoStack.length, 1);

    const redone = redoGraphOp(root);
    assert.equal(redone.ok, true);
    assert.equal(redone.opId, op.opId);
    assert.deepEqual(redone.applied.positions['u1-worker'], { x: 300, y: 400 });
    assert.deepEqual(loadWorkflowGraphMap(root).positions['u1-worker'], { x: 300, y: 400 });
    assert.equal(loadWorkflowGraphMap(root).undoStack.length, 1);
  });

  it('U2 - deleteNode records node+edges; undo restores node+edges; redo re-deletes', async () => {
    const main = agentNode('u2-main', 'u2-main-session', 'main', 'Main Agent');
    const created = createComponentNode(root, {
      type: 'markdown',
      title: 'Notes',
      markdown: 'hello',
      position: { x: 120, y: 80 },
    });
    writeWorkflowGraphMap(root, {
      schemaVersion: 1,
      version: 1,
      nodes: [main, created.node],
      edges: [],
      capsuleDockLinks: [],
      positions: {
        [main.nodeId]: { x: 0, y: 0 },
        [created.node.nodeId]: { x: 120, y: 80 },
      },
    });
    seedAgentSession(root, main.nodeId, main.sessionId, 'main');
    connectNodes(root, { from: 'u2-main', to: created.node.nodeId, relation: 'wf-bridge' }, {
      action: 'agent.connectNodes',
      actor: historyActor(main.nodeId, main.sessionId),
    });

    await deleteNode(root, created.node.nodeId, { action: 'agent.deleteNode', actor: historyActor(main.nodeId, main.sessionId) });

    let graph = loadWorkflowGraphMap(root);
    assert.ok(graph.deletedNodes.some(entry => entry.nodeId === created.node.nodeId), 'delete writes the deletedNodes entry');
    assert.ok(!graph.nodes.some(node => node.nodeId === created.node.nodeId), 'node removed from graph');
    assert.ok(!graph.edges.some(edge => edge.id === `u2-main->${created.node.nodeId}`), 'edge removed from graph');
    assert.throws(() => getComponentNode(root, created.node.nodeId), (error) => error?.code === 'NOT_FOUND');
    assert.ok(graph.undoStack.length >= 2, 'connect + delete ops recorded');
    const deleteOp = graph.undoStack[graph.undoStack.length - 1];
    assert.equal(deleteOp.action, 'agent.deleteNode');
    assert.equal(deleteOp.inverse.nodes.length, 1);
    assert.equal(deleteOp.inverse.nodes[0].nodeId, created.node.nodeId);
    assert.equal(deleteOp.inverse.nodes[0].componentState.type, 'markdown');
    assert.equal(deleteOp.inverse.nodes[0].position.x, 120);
    assert.equal(deleteOp.inverse.edges.length, 1);

    const undone = undoGraphOp(root);
    assert.equal(undone.ok, true);
    assert.equal(undone.opId, deleteOp.opId);
    graph = loadWorkflowGraphMap(root);
    assert.ok(graph.nodes.some(node => node.nodeId === created.node.nodeId), 'undo restores the node into the graph');
    assert.ok(graph.edges.some(edge => edge.id === `u2-main->${created.node.nodeId}`), 'undo restores the associated edge');
    assert.ok(!graph.deletedNodes.some(entry => entry.nodeId === created.node.nodeId), 'deletedNodes entry cleared');
    const restored = getComponentNode(root, created.node.nodeId);
    assert.equal(restored.state.markdown, 'hello');

    const redone = redoGraphOp(root);
    assert.equal(redone.ok, true);
    graph = loadWorkflowGraphMap(root);
    assert.ok(!graph.nodes.some(node => node.nodeId === created.node.nodeId), 'redo re-deletes the node from the graph');
    assert.throws(() => getComponentNode(root, created.node.nodeId), (error) => error?.code === 'NOT_FOUND');
  });

  it('U3 - connect/disconnect/updateEdge record ops; undo restores old edge state', async () => {
    const main = agentNode('u3-main', 'u3-main-session', 'main', 'Main Agent');
    const worker = agentNode('u3-worker', 'u3-worker-session');
    seedGraph(root, [main, worker]);
    seedAgentSession(root, main.nodeId, main.sessionId, 'main');

    // connect → undo removes the edge → redo re-adds it
    connectNodes(root, { from: 'u3-main', to: 'u3-worker', relation: 'delegation' }, {
      action: 'agent.connectNodes',
      actor: historyActor(main.nodeId, main.sessionId),
    });
    assert.ok(loadWorkflowGraphMap(root).edges.some(edge => edge.id === 'u3-main->u3-worker'));
    undoGraphOp(root);
    assert.ok(!loadWorkflowGraphMap(root).edges.some(edge => edge.id === 'u3-main->u3-worker'), 'undo removes the created edge');
    redoGraphOp(root);
    assert.ok(loadWorkflowGraphMap(root).edges.some(edge => edge.id === 'u3-main->u3-worker'), 'redo re-adds the edge');

    // disconnect → undo re-adds the edge
    disconnectNodes(root, 'u3-main->u3-worker', { action: 'agent.disconnectNodes', actor: historyActor(main.nodeId, main.sessionId) });
    assert.ok(!loadWorkflowGraphMap(root).edges.some(edge => edge.id === 'u3-main->u3-worker'));
    undoGraphOp(root);
    assert.ok(loadWorkflowGraphMap(root).edges.some(edge => edge.id === 'u3-main->u3-worker'), 'undo re-adds the removed edge');

    // updateEdge → undo restores the old relation
    updateEdge(root, 'u3-main->u3-worker', { relation: 'requests-review' }, {
      action: 'agent.updateEdge',
      actor: historyActor(main.nodeId, main.sessionId),
    });
    assert.equal(loadWorkflowGraphMap(root).edges.find(edge => edge.id === 'u3-main->u3-worker').relation, 'requests-review');
    undoGraphOp(root);
    assert.equal(loadWorkflowGraphMap(root).edges.find(edge => edge.id === 'u3-main->u3-worker').relation, 'delegation', 'undo restores the old edge value');
    redoGraphOp(root);
    assert.equal(loadWorkflowGraphMap(root).edges.find(edge => edge.id === 'u3-main->u3-worker').relation, 'requests-review', 'redo re-applies the patch');
  });

  it('U4 - attachDock/detachDock record ops; undo restores the dock link', async () => {
    const main = agentNode('u4-main', 'u4-main-session', 'main', 'Main Agent');
    const worker = agentNode('u4-worker', 'u4-worker-session');
    seedGraph(root, [main, worker], [{
      id: 'u4-main->u4-worker',
      from: 'u4-main',
      to: 'u4-worker',
      relation: 'wf-bridge',
      direction: 'bidirectional',
    }]);
    seedAgentSession(root, main.nodeId, main.sessionId, 'main');

    const attach = await jsonRequest(baseUrl, `/api/workflow/nodes/u4-main/actions/agent.attachDock`, {
      method: 'POST',
      body: { actorNodeId: 'u4-main', anchorId: 'u4-main', draggedId: 'u4-worker', side: 'top' },
    });
    assert.equal(attach.status, 200);
    assert.ok(loadWorkflowGraphMap(root).capsuleDockLinks.some(link => link.nodeIds.includes('u4-worker')));

    const undoDock = await jsonRequest(baseUrl, `/api/workflow/nodes/u4-main/actions/graph.undo`, {
      method: 'POST',
      body: { actorNodeId: 'u4-main', scope: 'graph' },
    });
    assert.equal(undoDock.status, 200);
    assert.equal(undoDock.body.ok, true);
    assert.equal(typeof undoDock.body.opId, 'string');
    assert.ok(undoDock.body.applied, 'undo of attachDock applies a slice');
    assert.equal(undoDock.body.applied.dockLinks.length, 0, 'dock link removed');
    assert.equal(loadWorkflowGraphMap(root).capsuleDockLinks.length, 0);

    const redoDock = await jsonRequest(baseUrl, `/api/workflow/nodes/u4-main/actions/graph.redo`, {
      method: 'POST',
      body: { actorNodeId: 'u4-main', scope: 'graph' },
    });
    assert.equal(redoDock.status, 200);
    assert.equal(redoDock.body.applied.dockLinks.length, 1, 'redo restores the dock link');

    // detach → undo re-adds the link
    const detach = await jsonRequest(baseUrl, `/api/workflow/nodes/u4-main/actions/agent.detachDock`, {
      method: 'POST',
      body: { actorNodeId: 'u4-main', anchorId: 'u4-main', draggedId: 'u4-worker' },
    });
    assert.equal(detach.status, 200);
    assert.equal(loadWorkflowGraphMap(root).capsuleDockLinks.length, 0);
    const undoDetach = await jsonRequest(baseUrl, `/api/workflow/nodes/u4-main/actions/graph.undo`, {
      method: 'POST',
      body: { actorNodeId: 'u4-main' },
    });
    assert.equal(undoDetach.status, 200);
    assert.equal(undoDetach.body.applied.dockLinks.length, 1, 'undo restores the detached dock link');
    assert.equal(loadWorkflowGraphMap(root).capsuleDockLinks[0].side, 'top');
  });

  it('U5 - history cap 50: the oldest op is pruned', () => {
    const main = agentNode('u5-main', 'u5-main-session', 'main', 'Main Agent');
    const worker = agentNode('u5-worker', 'u5-worker-session');
    seedGraph(root, [main, worker]);
    for (let index = 1; index <= 51; index += 1) {
      moveNode(root, 'u5-worker', { x: index, y: index }, { action: 'agent.moveNode', actor: historyActor(main.nodeId, main.sessionId) });
    }
    const graph = loadWorkflowGraphMap(root);
    assert.equal(graph.undoStack.length, 50);
    assert.equal(graph.redoStack.length, 0);
    // The oldest op (op 1, position {x:1,y:1}) was pruned; undo restores op 2's
    // before-state ({x:1,y:1} is op 2's forward? no — op 2 inverse is {x:1,y:1}).
    assert.equal(graph.undoStack[0].inverse.positions['u5-worker'].x, 1);
    assert.equal(graph.undoStack[graph.undoStack.length - 1].inverse.positions['u5-worker'].x, 50);
  });

  it('U6 - empty-stack undo/redo are idempotent ({ok:true, applied:null})', async () => {
    const main = agentNode('u6-main', 'u6-main-session', 'main', 'Main Agent');
    seedGraph(root, [main]);
    seedAgentSession(root, main.nodeId, main.sessionId, 'main');

    assert.deepEqual(undoGraphOp(root), { ok: true, applied: null });
    assert.deepEqual(redoGraphOp(root), { ok: true, applied: null });

    const undoRes = await jsonRequest(baseUrl, `/api/workflow/nodes/u6-main/actions/graph.undo`, {
      method: 'POST',
      body: { actorNodeId: 'u6-main' },
    });
    assert.equal(undoRes.status, 200);
    assert.equal(undoRes.body.ok, true);
    assert.equal(undoRes.body.applied, null);

    const redoRes = await jsonRequest(baseUrl, `/api/workflow/nodes/u6-main/actions/graph.redo`, {
      method: 'POST',
      body: { actorNodeId: 'u6-main' },
    });
    assert.equal(redoRes.status, 200);
    assert.equal(redoRes.body.applied, null);
  });

  it('U7 - a new op clears the redo stack', () => {
    const main = agentNode('u7-main', 'u7-main-session', 'main', 'Main Agent');
    const worker = agentNode('u7-worker', 'u7-worker-session');
    seedGraph(root, [main, worker]);
    const actor = historyActor(main.nodeId, main.sessionId);

    moveNode(root, 'u7-worker', { x: 10, y: 10 }, { action: 'agent.moveNode', actor });
    undoGraphOp(root);
    assert.equal(loadWorkflowGraphMap(root).redoStack.length, 1);

    moveNode(root, 'u7-worker', { x: 99, y: 99 }, { action: 'agent.moveNode', actor });
    const graph = loadWorkflowGraphMap(root);
    assert.equal(graph.redoStack.length, 0, 'a new op clears the redo stack');
    assert.equal(graph.undoStack.length, 1, 'the new op replaces the undone one (redo was popped by the undo)');

    assert.deepEqual(redoGraphOp(root), { ok: true, applied: null }, 'redo of a cleared stack is idempotent');
  });

  it('U8 - version-guarded undo: stale expectedVersion yields 409 STALE_GRAPH_VERSION', async () => {
    const main = agentNode('u8-main', 'u8-main-session', 'main', 'Main Agent');
    const worker = agentNode('u8-worker', 'u8-worker-session');
    seedGraph(root, [main, worker]);
    seedAgentSession(root, main.nodeId, main.sessionId, 'main');
    moveNode(root, 'u8-worker', { x: 50, y: 60 }, { action: 'agent.moveNode', actor: historyActor(main.nodeId, main.sessionId) });

    const stale = await jsonRequest(baseUrl, `/api/workflow/nodes/u8-main/actions/graph.undo`, {
      method: 'POST',
      body: { actorNodeId: 'u8-main', expectedVersion: 999 },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_GRAPH_VERSION');

    const graph = loadWorkflowGraphMap(root);
    assert.equal(graph.undoStack.length, 1, 'conflicted undo leaves the stack untouched');
    assert.deepEqual(graph.positions['u8-worker'], { x: 50, y: 60 }, 'conflicted undo does not mutate positions');

    const fresh = await jsonRequest(baseUrl, `/api/workflow/nodes/u8-main/actions/graph.undo`, {
      method: 'POST',
      body: { actorNodeId: 'u8-main' },
    });
    assert.equal(fresh.status, 200);
    assert.deepEqual(fresh.body.applied.positions['u8-worker'], { x: 0, y: 0 });
  });

  it('U9 - restart persistence: history survives in workflow-map.json', async () => {
    const main = agentNode('u9-main', 'u9-main-session', 'main', 'Main Agent');
    const worker = agentNode('u9-worker', 'u9-worker-session');
    seedGraph(root, [main, worker]);
    seedAgentSession(root, main.nodeId, main.sessionId, 'main');
    moveNode(root, 'u9-worker', { x: 222, y: 333 }, { action: 'agent.moveNode', actor: historyActor(main.nodeId, main.sessionId) });

    const persisted = loadWorkflowGraphMap(root);
    assert.equal(persisted.undoStack.length, 1, 'op persisted into workflow-map.json');

    await restartServer();

    const undoRes = await jsonRequest(baseUrl, `/api/workflow/nodes/u9-main/actions/graph.undo`, {
      method: 'POST',
      body: { actorNodeId: 'u9-main' },
    });
    assert.equal(undoRes.status, 200);
    assert.equal(undoRes.body.ok, true);
    assert.equal(typeof undoRes.body.opId, 'string');
    assert.equal(undoRes.body.applied.positions['u9-worker'].x, 0, 'undo after restart restores the pre-move position');
    assert.deepEqual(loadWorkflowGraphMap(root).positions['u9-worker'], { x: 0, y: 0 });
  });

  it('U10 - CLI node-map --action undo posts to graph.undo and returns the contract shape', async () => {
    const cliRoot = seedRoot('wf-undo-cli-');
    try {
      const dest = path.join(cliRoot, 'Harness', 'scripts', 'wf-ui-control.mjs');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs'), dest);
      // The graph lives on the server root (`root` from beforeEach); the CLI
      // is copied into a separate dir and talks to the server via --url.
      const main = agentNode('u10-main', 'u10-main-session', 'main', 'Main Agent');
      const worker = agentNode('u10-worker', 'u10-worker-session');
      seedGraph(root, [main, worker], [{
        id: 'u10-main->u10-worker',
        from: 'u10-main',
        to: 'u10-worker',
        relation: 'delegation',
        direction: 'source-to-target',
      }]);
      seedAgentSession(root, main.nodeId, main.sessionId, 'main');

      const agentEnv = { HARNESS_AGENT_KIND: 'main' };
      const base = ['--project', cliRoot, '--url', baseUrl, '--token', ''];

      const moved = await runWfUi(['node-map', '--action', 'moveNode', '--node', 'u10-worker', '--x', '400', '--y', '500', '--actor', 'u10-main', ...base], { cwd: cliRoot, env: agentEnv });
      assert.equal(moved.status, 0, `moveNode CLI failed: ${moved.stderr}`);
      assert.equal(moved.stdout.ok, true);
      assert.deepEqual(loadWorkflowGraphMap(root).positions['u10-worker'], { x: 400, y: 500 });

      const undo = await runWfUi(['node-map', '--action', 'undo', '--actor', 'u10-main', ...base], { cwd: cliRoot, env: agentEnv });
      assert.equal(undo.status, 0, `undo CLI failed: ${undo.stderr}`);
      assert.equal(undo.stdout.ok, true);
      assert.match(undo.stdout.opId, /^op-/);
      assert.equal(typeof undo.stdout.version, 'number');
      assert.ok(undo.stdout.applied && typeof undo.stdout.applied === 'object', 'applied slice present');
      assert.deepEqual(undo.stdout.applied.positions['u10-worker'], { x: 0, y: 0 });
      assert.ok(Array.isArray(undo.stdout.applied.edges));
      assert.ok(Array.isArray(undo.stdout.applied.dockLinks));
      assert.ok(Array.isArray(undo.stdout.applied.nodes));
      assert.deepEqual(loadWorkflowGraphMap(root).positions['u10-worker'], { x: 0, y: 0 }, 'CLI undo restored the position');

      const redo = await runWfUi(['node-map', '--action', 'redo', '--actor', 'u10-main', ...base], { cwd: cliRoot, env: agentEnv });
      assert.equal(redo.status, 0);
      assert.equal(redo.stdout.ok, true);
      assert.deepEqual(loadWorkflowGraphMap(root).positions['u10-worker'], { x: 400, y: 500 }, 'CLI redo re-applied the move');
    } finally {
      fs.rmSync(cliRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
