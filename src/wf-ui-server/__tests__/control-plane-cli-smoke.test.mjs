// Layer 2 CLI/API smoke test (task-backend-api-acceptance-matrix).
//
// Proves an Agent can drive the control plane through the real
// `Harness/scripts/wf-ui-control.mjs` CLI (25 commands wrapping the HTTP API).
// Each test spawns genuine `node Harness/scripts/wf-ui-control.mjs <command>`
// subprocesses against an in-process HTTP server started with
// `startServer({ port: 0 })`. The CLI script is copied into the temp project
// root so the spawned command runs exactly what an Agent node would run.
//
// Every test seeds its own graph nodes with per-test id prefixes so tests stay
// independent within the shared temp root (graph state accumulates across
// tests, so all assertions are membership-based, never exact totals).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';
import { persistSession, readTerminalRange } from '../terminal-store.mjs';
import { writeWorkflowGraphMap, loadWorkflowGraphMap } from '../a2a-store.mjs';
import { listBridgeMessages } from '../bridge-store.mjs';
import { registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';
import { createComponentNode } from '../component-node-store.mjs';

// ── CLI runner ──────────────────────────────────────────────────────────────

// Spawn a real `node Harness/scripts/wf-ui-control.mjs <command>` process.
// Resolves with { status, stdout, stderr }; stdout is the parsed JSON object
// when the CLI printed JSON, otherwise the raw string (e.g. error output).
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
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      let parsed = stdout.trim();
      try {
        parsed = JSON.parse(parsed);
      } catch {
        // Non-JSON output (e.g. usage/error text) is left as the raw string.
      }
      resolve({ status, stdout: parsed, stderr });
    });
  });
}

// Poll until fn returns truthy. PTY prompt submission types char-by-char at
// 12ms/char, so writes keep landing after the CLI call itself resolves; any
// write-array assertion must poll the joined buffer until the trailing \r.
async function waitFor(fn, { timeout = 8000, step = 100 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise(resolve => setTimeout(resolve, step));
  }
  throw new Error(`waitFor timed out; last=${JSON.stringify(last)}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

let tempRoot;
let serverHandle;
let baseUrl;
let token;
let registry;
const registeredPtySessions = [];

// Identity environment every spawned Agent CLI runs with: the actor is a
// Main Agent node, so the CLI main-agent gates (assertMainAgent) pass.
const AGENT_ENV = { HARNESS_AGENT_KIND: 'main' };

// Flags shared by every command: where the project lives, and the control
// plane it talks to.
function baseArgs() {
  return ['--project', tempRoot, '--url', baseUrl, '--token', token];
}

function seedRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

function copyCliInto(root) {
  const dest = path.join(root, 'Harness', 'scripts', 'wf-ui-control.mjs');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs'), dest);
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

function persistAgentSession(root, nodeId, sessionId, agentKind = 'subagent', role = 'Agent') {
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

// Seed agent graph nodes (workflow-map.json) plus their durable sessions.
function seedAgents(nodes, edges = [], options = {}) {
  writeWorkflowGraphMap(tempRoot, {
    schemaVersion: 1,
    nodes,
    edges,
    capsuleDockLinks: options.capsuleDockLinks || [],
    positions: Object.fromEntries(nodes.map(node => [node.nodeId, { x: 0, y: 0 }])),
  });
  for (const node of nodes) {
    persistAgentSession(tempRoot, node.nodeId, node.sessionId, node.agentKind, node.role);
  }
}

// Register a fake PTY whose writes are collected; returned array doubles as
// the assertion spy.
function attachPtySpy(sessionId) {
  const writes = [];
  registerPtyProcess(sessionId, { write: (data) => writes.push(String(data)) });
  registeredPtySessions.push(sessionId);
  return writes;
}

before(async () => {
  tempRoot = seedRoot('cp-cli-');
  copyCliInto(tempRoot);
  registry = new SessionRegistry();
  const started = await startServer({
    projectRoot: tempRoot,
    host: '127.0.0.1',
    port: 0,
    sessionRegistry: registry,
    eventsWs: false,
  });
  serverHandle = started.server;
  token = started.token;
  baseUrl = `http://127.0.0.1:${started.port}`;
});

after(async () => {
  for (const sessionId of registeredPtySessions) unregisterPtyProcess(sessionId);
  if (serverHandle) await stopServer(serverHandle);
  if (tempRoot) {
    const resolved = path.resolve(tempRoot);
    const tempRootDir = path.resolve('Harness', '.temp') + path.sep;
    assert.ok(resolved.startsWith(tempRootDir), `refusing to remove non-temp root: ${tempRoot}`);
    try {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 });
    } catch (e) {
      // Windows may briefly hold session files after server close; tolerate.
      if (process.platform === 'win32' && ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(e?.code)) return;
      throw e;
    }
  }
});

// ── 1. create-agent ─────────────────────────────────────────────────────────

describe('create-agent', () => {
  it('spawns a managed agent session and attaches its graph node', async () => {
    const result = await runWfUi([
      'create-agent',
      ...baseArgs(),
      '--actor-kind', 'main',
      '--agent-kind', 'main',
      '--role', 'Main Agent',
      '--runtime', 'claude',
      // Keep the smoke test hermetic: never spawn a real PTY process.
      '--defer',
    ], { cwd: tempRoot, env: AGENT_ENV });

    assert.equal(result.status, 0, `create-agent failed: ${result.stderr}`);
    assert.ok(result.stdout && typeof result.stdout === 'object', `non-JSON stdout: ${result.stdout}`);
    const session = result.stdout;
    assert.ok(session.sessionId, 'session must carry a sessionId');
    assert.equal(session.agentKind, 'main');
    assert.equal(session.displayName, 'Main Agent');
    assert.equal(session.roleTitle, 'Main Agent');
    assert.ok(session.graphNodeId, 'session must carry a graphNodeId');

    // The backend must have added the new node to the workflow graph map.
    const graph = loadWorkflowGraphMap(tempRoot);
    const node = (graph.nodes || []).find(item => item.sessionId === session.sessionId);
    assert.ok(node, 'graph must contain the created agent node');
    assert.equal(node.nodeId, `session-${session.sessionId}`);
    assert.equal(node.agentKind, 'main');
    assert.equal(node.role, 'Main Agent');
  });
});

// ── 2. workflow-node-map readGraph ──────────────────────────────────────────

describe('workflow-node-map readGraph', () => {
  it('reads nodes, edges, capsuleDockLinks, and version through the typed agent action', async () => {
    seedAgents(
      [
        agentNode('t2-main', 'session-t2-main', 'main', 'Agent Main'),
        agentNode('t2-b', 'session-t2-b', 'subagent', 'Agent B'),
        agentNode('t2-c', 'session-t2-c', 'subagent', 'Agent C'),
      ],
      [
        { id: 'edge-t2-main-b', from: 't2-main', to: 't2-b', relation: 'delegation', direction: 'bidirectional' },
        { id: 'edge-t2-main-c', from: 't2-main', to: 't2-c', relation: 'delegation', direction: 'bidirectional' },
      ],
      {
        capsuleDockLinks: [{
          id: 'dock-t2-main-b',
          nodeIds: ['t2-main', 't2-b'],
          anchorId: 't2-main',
          draggedId: 't2-b',
          side: 'right',
          edges: [{ edgeId: 'edge-t2-main-b', retention: 'keep' }],
          connections: [{ source: 't2-main', target: 't2-b', relation: 'delegation' }],
        }],
      },
    );

    const result = await runWfUi([
      'workflow-node-map',
      ...baseArgs(),
      '--action', 'readGraph',
      '--actor', 't2-main',
    ], { cwd: tempRoot, env: AGENT_ENV });

    assert.equal(result.status, 0, `workflow-node-map failed: ${result.stderr}`);
    assert.equal(result.stdout.ok, true);
    assert.equal(result.stdout.action, 'agent.readGraph');
    const graph = result.stdout.result.graph;
    assert.ok(graph, 'readGraph must return a graph');
    assert.ok(Number.isInteger(graph.version) && graph.version >= 1, `version must be a positive integer, got ${graph.version}`);
    assert.ok(Array.isArray(graph.nodes), 'graph must carry nodes');
    assert.ok(graph.nodes.some(node => node.nodeId === 't2-main'), 'graph must contain t2-main');
    assert.ok(graph.nodes.some(node => node.nodeId === 't2-b'), 'graph must contain t2-b');
    assert.ok(Array.isArray(graph.edges), 'graph must carry edges');
    assert.ok(graph.edges.some(edge => edge.from === 't2-main' && edge.to === 't2-b'), 'graph must carry the t2-main -> t2-b edge');
    assert.ok(Array.isArray(graph.capsuleDockLinks), 'graph must carry capsuleDockLinks');
    assert.ok(graph.capsuleDockLinks.some(link => (link.nodeIds || []).includes('t2-main') && link.nodeIds.includes('t2-b')), 'dock link between t2-main and t2-b must be present');
  });

  it('fails loudly when the actor node is missing', async () => {
    seedAgents([agentNode('t2x-main', 'session-t2x-main', 'main', 'Agent Main')]);
    const result = await runWfUi([
      'workflow-node-map',
      ...baseArgs(),
      '--action', 'readGraph',
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.notEqual(result.status, 0, 'missing --actor must exit non-zero');
    assert.match(String(result.stderr), /--actor|Missing/i);
  });
});

// ── 3. workflow-context ─────────────────────────────────────────────────────

describe('workflow-context', () => {
  it('returns identity, connectedPeers, connectedNodeManuals, and allowed actions', async () => {
    seedAgents(
      [
        agentNode('t3-main', 'session-t3-main', 'main', 'Agent Main'),
        agentNode('t3-sub', 'session-t3-sub', 'subagent', 'Agent B'),
      ],
      [
        { id: 'edge-t3', from: 't3-main', to: 't3-sub', relation: 'delegation', direction: 'bidirectional' },
      ],
    );

    const result = await runWfUi([
      'workflow-context',
      ...baseArgs(),
      '--node', 't3-sub',
    ], { cwd: tempRoot, env: AGENT_ENV });

    assert.equal(result.status, 0, `workflow-context failed: ${result.stderr}`);
    assert.equal(result.stdout.ok, true);
    const context = result.stdout.context;
    assert.ok(context, 'must return a context');
    assert.equal(context.nodeId, 't3-sub');
    assert.equal(context.identity.nodeId, 't3-sub');
    assert.equal(context.identity.displayName, 'Agent B');
    assert.equal(context.identity.agentKind, 'subagent');
    assert.ok(Array.isArray(context.connectedPeers), 'must return connectedPeers');
    assert.ok(
      context.connectedPeers.some(peer => peer.nodeId === 't3-main' && peer.type === 'agent'),
      `connectedPeers must include the connected t3-main agent: ${JSON.stringify(context.connectedPeers)}`,
    );
    assert.ok(Array.isArray(context.connectedNodeManuals), 'must return connectedNodeManuals');
    assert.ok(Array.isArray(context.availableActions), 'must return availableActions');
    assert.ok(context.availableActions.includes('agent.sendMessage'), 'availableActions must include agent.sendMessage');
    const peerRef = (context.connectedAgentRefs || []).find(ref => ref.nodeId === 't3-main');
    assert.ok(peerRef, 'connectedAgentRefs must include the connected peer');
    assert.ok(Array.isArray(peerRef.allowedActions), 'peer ref must carry allowedActions');
    assert.ok(peerRef.allowedActions.includes('agent.sendMessage'), 'peer allowedActions must include agent.sendMessage');
  });
});

// ── 4. send-agent-message (1-to-1) ──────────────────────────────────────────

describe('send-agent-message', () => {
  it('delivers a direct structured message from A to B and records it in the bridge store', async () => {
    seedAgents(
      [
        agentNode('t4-a', 'session-t4-a', 'main', 'Agent A'),
        agentNode('t4-b', 'session-t4-b', 'subagent', 'Agent B'),
      ],
      [
        { id: 'edge-t4', from: 't4-a', to: 't4-b', relation: 'delegation', direction: 'bidirectional' },
      ],
    );
    const writesA = attachPtySpy('session-t4-a');
    const writesB = attachPtySpy('session-t4-b');

    const result = await runWfUi([
      'send-agent-message',
      ...baseArgs(),
      '--node', 't4-a',
      '--to', 't4-b',
      '--text', 'Hello B',
      '--request-id', 'test-req-1',
    ], { cwd: tempRoot, env: AGENT_ENV });

    assert.equal(result.status, 0, `send-agent-message failed: ${result.stderr}`);
    assert.equal(result.stdout.ok, true);
    assert.equal(result.stdout.action, 'agent.sendMessage');
    assert.equal(result.stdout.result.mode, 'direct');
    assert.equal(result.stdout.result.requestId, 'test-req-1');
    assert.equal(result.stdout.result.deliveries.length, 1);
    assert.equal(result.stdout.result.deliveries[0].ok, true);
    assert.equal(result.stdout.result.deliveries[0].fromNodeId, 't4-a');
    assert.equal(result.stdout.result.deliveries[0].toNodeId, 't4-b');
    assert.equal(result.stdout.result.deliveries[0].fromSessionId, 'session-t4-a');
    assert.equal(result.stdout.result.deliveries[0].toSessionId, 'session-t4-b');

    // Delivery reached B's PTY as the structured envelope prefix + text. The
    // submit sequence is typed char-by-char, so wait until the joined buffer
    // carries the envelope + text and the trailing submit \r has landed.
    assert.deepEqual(writesA, [], 'sender PTY must not receive its own message');
    await waitFor(() => {
      const joined = writesB.join('');
      return joined.includes('test-req-1') && joined.includes('Hello B') && joined.endsWith('\r')
        ? joined
        : null;
    });
    const joinedB = writesB.join('');
    assert.ok(joinedB.includes('test-req-1'), `target PTY must receive the request id: ${JSON.stringify(writesB)}`);
    assert.ok(joinedB.includes('Hello B'), `target PTY must receive the text: ${JSON.stringify(writesB)}`);
    assert.ok(joinedB.endsWith('\r'), `sequence must end with the submit \\r: ${JSON.stringify(writesB)}`);

    // The bridge store holds the envelope with the request id.
    const bridge = listBridgeMessages(tempRoot, {
      fromSessionId: 'session-t4-a',
      toSessionId: 'session-t4-b',
    });
    const entry = (bridge.entries || []).find(item => item.requestId === 'test-req-1');
    assert.ok(entry, `bridge store must contain the request-id message: ${JSON.stringify(bridge.entries)}`);
    // data may carry a trailing \r from PTY submit; match the content.
    assert.match(entry.data, /Hello B/);
    assert.equal(entry.fromNodeId, 't4-a');
    assert.equal(entry.toNodeId, 't4-b');
    assert.equal(entry.fromSessionId, 'session-t4-a');
    assert.equal(entry.toSessionId, 'session-t4-b');
    assert.equal(entry.deliveryMode, 'direct');
  });
});

// ── 5. read-agent-messages ──────────────────────────────────────────────────

describe('read-agent-messages', () => {
  it('reads the recorded conversation between two agents with correct from/to', async () => {
    seedAgents(
      [
        agentNode('t5-a', 'session-t5-a', 'main', 'Agent A'),
        agentNode('t5-b', 'session-t5-b', 'subagent', 'Agent B'),
      ],
      [
        { id: 'edge-t5', from: 't5-a', to: 't5-b', relation: 'delegation', direction: 'bidirectional' },
      ],
    );
    attachPtySpy('session-t5-a');
    attachPtySpy('session-t5-b');

    // Send first through the CLI so the read has real recorded envelopes.
    const sent = await runWfUi([
      'send-agent-message',
      ...baseArgs(),
      '--node', 't5-a',
      '--to', 't5-b',
      '--text', 'Hello B',
      '--request-id', 'test-req-1',
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(sent.status, 0, `send-agent-message failed: ${sent.stderr}`);
    assert.equal(sent.stdout.ok, true);

    const result = await runWfUi([
      'read-agent-messages',
      ...baseArgs(),
      '--node', 't5-a',
      '--peer', 't5-b',
    ], { cwd: tempRoot, env: AGENT_ENV });

    assert.equal(result.status, 0, `read-agent-messages failed: ${result.stderr}`);
    assert.equal(result.stdout.ok, true);
    assert.equal(result.stdout.action, 'agent.readMessages');
    // executeNodeAction may spread or nest the handler result; accept both.
    const allEntries = result.stdout.result?.entries || result.stdout.entries || [];
    assert.ok(Array.isArray(allEntries), `must return entries: ${JSON.stringify(result.stdout).slice(0, 500)}`);
    const entry = (allEntries).find(item => item.requestId === 'test-req-1');
    assert.ok(entry, `entries must include the sent message: ${JSON.stringify(allEntries)}`);
    assert.match(entry.data, /Hello B/);
    assert.equal(entry.fromNodeId, 't5-a');
    assert.equal(entry.toNodeId, 't5-b');
    assert.equal(entry.fromSessionId, 'session-t5-a');
    assert.equal(entry.toSessionId, 'session-t5-b');
  });
});

// ── 6. broadcast-agent-message (1-to-many) ──────────────────────────────────

describe('broadcast-agent-message', () => {
  it('delivers one message to every explicit target and queues it for each', async () => {
    seedAgents(
      [
        agentNode('t6-a', 'session-t6-a', 'main', 'Agent A'),
        agentNode('t6-b', 'session-t6-b', 'subagent', 'Agent B'),
        agentNode('t6-c', 'session-t6-c', 'subagent', 'Agent C'),
        agentNode('t6-d', 'session-t6-d', 'subagent', 'Agent D'),
      ],
      [
        { id: 'edge-t6-a-b', from: 't6-a', to: 't6-b', relation: 'delegation', direction: 'bidirectional' },
        { id: 'edge-t6-a-c', from: 't6-a', to: 't6-c', relation: 'delegation', direction: 'bidirectional' },
        { id: 'edge-t6-a-d', from: 't6-a', to: 't6-d', relation: 'delegation', direction: 'bidirectional' },
      ],
    );
    const writesB = attachPtySpy('session-t6-b');
    const writesC = attachPtySpy('session-t6-c');
    const writesD = attachPtySpy('session-t6-d');

    const result = await runWfUi([
      'broadcast-agent-message',
      ...baseArgs(),
      '--node', 't6-a',
      '--to', 't6-b,t6-c,t6-d',
      '--text', 'Broadcast',
      '--request-id', 'test-bcast-1',
    ], { cwd: tempRoot, env: AGENT_ENV });

    assert.equal(result.status, 0, `broadcast-agent-message failed: ${result.stderr}`);
    assert.equal(result.stdout.ok, true);
    assert.equal(result.stdout.action, 'agent.broadcastMessage');
    assert.equal(result.stdout.result.mode, 'broadcast');
    assert.equal(result.stdout.result.requestId, 'test-bcast-1');
    assert.equal(result.stdout.result.deliveredCount, 3);
    assert.equal(result.stdout.result.failedCount, 0);
    assert.deepEqual(
      result.stdout.result.deliveries.map(item => item.toNodeId).sort(),
      ['t6-b', 't6-c', 't6-d'],
    );
    assert.ok(result.stdout.result.deliveries.every(item => item.ok), 'every delivery must succeed');

    // Every target's PTY receives the broadcast envelope. The submit sequence
    // is typed char-by-char, so wait until the joined buffer carries the
    // envelope + text and the trailing submit \r has landed.
    for (const [label, writes] of [['B', writesB], ['C', writesC], ['D', writesD]]) {
      await waitFor(() => {
        const joined = writes.join('');
        return joined.includes('test-bcast-1') && joined.includes('Broadcast') && joined.endsWith('\r')
          ? joined
          : null;
      });
      const joined = writes.join('');
      assert.ok(joined.includes('test-bcast-1'), `target ${label} PTY must receive the request id: ${JSON.stringify(writes)}`);
      assert.ok(joined.includes('Broadcast'), `target ${label} PTY must receive the broadcast text: ${JSON.stringify(writes)}`);
      assert.ok(joined.endsWith('\r'), `target ${label} sequence must end with the submit \\r: ${JSON.stringify(writes)}`);
    }

    // Every target's bridge queue holds the broadcast envelope.
    for (const sub of ['t6-b', 't6-c', 't6-d']) {
      const bridge = listBridgeMessages(tempRoot, {
        fromSessionId: 'session-t6-a',
        toSessionId: `session-${sub}`,
      });
      const entry = (bridge.entries || []).find(item => item.requestId === 'test-bcast-1');
      assert.ok(entry, `bridge for ${sub} must contain the broadcast`);
      assert.match(entry.data, /Broadcast/);
      assert.equal(entry.fromNodeId, 't6-a');
      assert.equal(entry.toNodeId, sub);
      assert.equal(entry.deliveryMode, 'broadcast');
    }
  });
});

// ── 7. send-input ───────────────────────────────────────────────────────────

describe('send-input', () => {
  it('writes terminal input for a managed session and records it in the terminal store', async () => {
    const session = registry.create({
      runtime: 'claude',
      agentKind: 'main',
      role: 'Main Agent',
      taskId: null,
    });
    registry.update(session.sessionId, { status: 'running' });
    const writes = attachPtySpy(session.sessionId);

    const result = await runWfUi([
      'send-input',
      ...baseArgs(),
      '--actor-kind', 'main',
      '--session', session.sessionId,
      '--text', 'test input',
    ], { cwd: tempRoot, env: AGENT_ENV });

    assert.equal(result.status, 0, `send-input failed: ${result.stderr}`);
    assert.equal(result.stdout.ok, true);
    assert.equal(result.stdout.sessionId, session.sessionId);

    // The CLI appends a submit-enter so the PTY receives the data + \r.
    assert.deepEqual(writes, ['test input\r'], 'PTY must receive the input with submit enter');

    // The terminal store records the input as a stdin transcript entry.
    const transcript = readTerminalRange(tempRoot, { sessionId: session.sessionId, tail: 10 });
    assert.ok(
      (transcript.entries || []).some(entry => entry.stream === 'stdin' && entry.data.includes('test input')),
      `terminal transcript must record the input: ${JSON.stringify(transcript.entries)}`,
    );

    // The input-requests.jsonl file records the request.
    const inputRequestsPath = path.join(tempRoot, 'Harness', 'a2a', 'sessions', session.sessionId, 'input-requests.jsonl');
    assert.ok(fs.existsSync(inputRequestsPath), 'input-requests.jsonl must exist');
    const requests = fs.readFileSync(inputRequestsPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
    assert.ok(
      requests.some(item => String(item.text || item.data || '').includes('test input')),
      `input-requests.jsonl must contain the request: ${JSON.stringify(requests)}`,
    );
  });
});

// ── 8. connect ──────────────────────────────────────────────────────────────

describe('connect', () => {
  it('connects two graph nodes and the graph gains a new edge between them', async () => {
    seedAgents([
      agentNode('t8-main', 'session-t8-main', 'main', 'Agent Main'),
      agentNode('t8-b', 'session-t8-b', 'subagent', 'Agent B'),
    ]);

    const result = await runWfUi([
      'connect',
      ...baseArgs(),
      '--actor', 't8-main',
      '--from', 't8-main',
      '--to', 't8-b',
    ], { cwd: tempRoot, env: AGENT_ENV });

    assert.equal(result.status, 0, `connect failed: ${result.stderr}`);
    assert.equal(result.stdout.ok, true);
    assert.equal(result.stdout.action, 'agent.connectNodes');
    assert.equal(result.stdout.result.edge.from, 't8-main');
    assert.equal(result.stdout.result.edge.to, 't8-b');
    assert.equal(result.stdout.result.edge.relation, 'delegation');

    // The workflow graph map must now hold the new edge.
    const graph = loadWorkflowGraphMap(tempRoot);
    assert.ok(
      (graph.edges || []).some(edge => edge.from === 't8-main' && edge.to === 't8-b'),
      `graph must contain the new edge: ${JSON.stringify(graph.edges)}`,
    );
  });
});

// ── 9. read-node ────────────────────────────────────────────────────────────

describe('read-node', () => {
  it('reads a single agent node by id', async () => {
    seedAgents([agentNode('t9-b', 'session-t9-b', 'subagent', 'Agent B')]);

    const result = await runWfUi([
      'read-node',
      ...baseArgs(),
      '--node', 't9-b',
    ], { cwd: tempRoot, env: AGENT_ENV });

    assert.equal(result.status, 0, `read-node failed: ${result.stderr}`);
    assert.equal(result.stdout.ok, true);
    assert.equal(result.stdout.node.nodeId, 't9-b');
    assert.equal(result.stdout.node.kind, 'agent');
    assert.equal(result.stdout.node.sessionId, 'session-t9-b');
    assert.equal(result.stdout.node.status.state, 'running');
  });
});

// ── 10. workflow-node-action (markdown.read) ────────────────────────────────

describe('workflow-node-action', () => {
  it('reads a markdown node through the typed markdown.read action', async () => {
    const created = createComponentNode(tempRoot, {
      type: 'markdown',
      title: 'Notes',
      markdown: '# Hello\nsmoke body',
    });
    const mdNodeId = created.node.nodeId;
    assert.ok(mdNodeId, 'component node must carry a nodeId');

    const result = await runWfUi([
      'workflow-node-action',
      ...baseArgs(),
      '--node', mdNodeId,
      '--action', 'markdown.read',
    ], { cwd: tempRoot, env: AGENT_ENV });

    assert.equal(result.status, 0, `workflow-node-action failed: ${result.stderr}`);
    assert.equal(result.stdout.ok, true);
    assert.equal(result.stdout.action, 'markdown.read');
    assert.equal(result.stdout.node.nodeId, mdNodeId);
    assert.equal(result.stdout.result.title, 'Notes');
    assert.equal(result.stdout.result.markdown, '# Hello\nsmoke body');
  });
});

// ── 11. Full-Chain CLI E2E: E0 → E18 ────────────────────────────────────────

describe('Full-Chain CLI E2E (E0-E18)', () => {
  // This test proves the critical CLI path from a blank node map through
  // the complete E0-E18 matrix using only `Harness/scripts/wf-ui-control.mjs`
  // subprocess commands. Every graph/node mutation goes through the real CLI.
  // We do not duplicate the in-process backend suite; we prove the CLI path
  // covers the most important chains: blank→create→connect→communicate→
  // markdown→timer→goal→aggregate.

  it('chains: clear map -> create Main Agent -> subagents -> connect -> 1:1 + 1:many messages -> markdown shared context -> goal -> timer -> aggregate evidence', async () => {
    // ── E0: Start from a clean graph ──
    // Create several nodes first so we can prove clearing works.
    const preMain = await runWfUi([
      'create-agent',
      ...baseArgs(),
      '--actor-kind', 'main',
      '--agent-kind', 'main',
      '--role', 'Main Agent',
      '--runtime', 'claude',
      '--defer',
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(preMain.status, 0);
    const preNodeId = `session-${preMain.stdout.sessionId}`;
    const preGraph = loadWorkflowGraphMap(tempRoot);
    assert.ok(preGraph.nodes.length >= 1, 'graph must have at least 1 node before clear');

    // Clear all nodes except the actor (which is also the CLI actor, so it survives).
    const cleared = await runWfUi([
      'workflow-node-map',
      ...baseArgs(),
      '--action', 'deleteNodes',
      '--all', 'true',
      '--actor', preNodeId,
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(cleared.status, 0, `clear failed: ${cleared.stderr}`);
    assert.equal(cleared.stdout.ok, true);
    assert.equal(cleared.stdout.action, 'agent.deleteNodes');
    const afterClear = loadWorkflowGraphMap(tempRoot);
    // After clear, only the surviving actor remains.
    const afterClearIds = (afterClear.nodes || []).map(n => n.nodeId || n.id);
    assert.ok(afterClearIds.includes(preNodeId), 'actor must survive');
    assert.ok(afterClearIds.length >= 1, `after clear at least actor: ${JSON.stringify(afterClearIds)}`);

    // ── E1: Create fresh Main Agent as the orchestrator ──
    const main = await runWfUi([
      'create-agent',
      ...baseArgs(),
      '--actor-kind', 'main',
      '--agent-kind', 'main',
      '--role', 'Main Agent',
      '--runtime', 'claude',
      '--defer',
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(main.status, 0, `create main agent failed: ${main.stderr}`);
    const mainNodeId = `session-${main.stdout.sessionId}`;
    const mainSessionId = main.stdout.sessionId;
    assert.ok(mainNodeId, 'Main Agent must have a graph node');
    assert.equal(main.stdout.displayName, 'Main Agent');
    assert.equal(main.stdout.roleTitle, 'Main Agent');

    // ── E3: Create 3 role-distinct subagents ──
    const roles = ['implementer', 'reviewer', 'tester'];
    const workers = [];
    for (const role of roles) {
      const w = await runWfUi([
        'create-agent',
        ...baseArgs(),
        '--actor-kind', 'main',
        '--agent-kind', 'subagent',
        '--role', 'Subagent',
        '--runtime', 'claude',
        '--defer',
        '--payload', JSON.stringify({ roleTitle: role, displayName: role, responsibility: `${role} agent` }),
      ], { cwd: tempRoot, env: AGENT_ENV });
      assert.equal(w.status, 0, `create ${role} failed: ${w.stderr}`);
      const wNodeId = `session-${w.stdout.sessionId}`;
      workers.push({ nodeId: wNodeId, sessionId: w.stdout.sessionId, role });
      // Register fake PTYs so messages can deliver.
      attachPtySpy(w.stdout.sessionId);
    }
    // Register fake PTY for Main Agent too.
    attachPtySpy(mainSessionId);

    // ── E4: Connect Main Agent to each worker ──
    for (const w of workers) {
      const conn = await runWfUi([
        'connect',
        ...baseArgs(),
        '--actor', mainNodeId,
        '--from', mainNodeId,
        '--to', w.nodeId,
      ], { cwd: tempRoot, env: AGENT_ENV });
      assert.equal(conn.status, 0, `connect to ${w.role} failed: ${conn.stderr}`);
      assert.equal(conn.stdout.ok, true);
      assert.equal(conn.stdout.action, 'agent.connectNodes');
    }

    // ── E2: Main Agent observes graph and context ──
    const graph = await runWfUi([
      'workflow-node-map',
      ...baseArgs(),
      '--action', 'readGraph',
      '--actor', mainNodeId,
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(graph.status, 0, `readGraph failed: ${graph.stderr}`);
    assert.ok(Array.isArray(graph.stdout.result.graph.nodes));
    assert.ok(graph.stdout.result.graph.nodes.length >= 4, `expect >= 4 nodes: ${graph.stdout.result.graph.nodes.length}`);
    assert.ok(graph.stdout.result.graph.edges.length >= 3, `expect >= 3 edges: ${graph.stdout.result.graph.edges.length}`);

    const ctx = await runWfUi([
      'workflow-context',
      ...baseArgs(),
      '--node', mainNodeId,
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(ctx.status, 0, `context failed: ${ctx.stderr}`);
    assert.equal(ctx.stdout.context.identity.nodeId, mainNodeId);
    assert.ok(ctx.stdout.context.connectedPeers.length >= 3, `peers: ${ctx.stdout.context.connectedPeers.length}`);

    // ── E5: 1-to-1 mailbox - Main Agent sends to one worker ──
    const direct = await runWfUi([
      'send-agent-message',
      ...baseArgs(),
      '--node', mainNodeId,
      '--to', workers[0].nodeId,
      '--text', 'Implement the login module',
      '--request-id', 'chain-req-1',
      '--actor-kind', 'main',
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(direct.status, 0, `1:1 msg failed: ${direct.stderr}`);
    assert.equal(direct.stdout.ok, true);
    assert.equal(direct.stdout.result.requestId, 'chain-req-1');
    assert.equal(direct.stdout.result.deliveries.length, 1);

    // Worker replies.
    const reply = await runWfUi([
      'send-agent-message',
      ...baseArgs(),
      '--node', workers[0].nodeId,
      '--to', mainNodeId,
      '--text', 'Login module implemented',
      '--request-id', 'chain-req-1',
      '--actor-kind', 'subagent',
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(reply.status, 0, `reply failed: ${reply.stderr}`);
    assert.equal(reply.stdout.result.requestId, 'chain-req-1');

    // ── E6: 1-to-many broadcast - Main Agent sends to all workers ──
    const broadcast = await runWfUi([
      'broadcast-agent-message',
      ...baseArgs(),
      '--node', mainNodeId,
      '--to', workers.map(w => w.nodeId).join(','),
      '--text', 'All hands: review the login module',
      '--request-id', 'chain-bcast-1',
      '--actor-kind', 'main',
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(broadcast.status, 0, `broadcast failed: ${broadcast.stderr}`);
    assert.equal(broadcast.stdout.result.deliveredCount, 3);
    assert.equal(broadcast.stdout.result.failedCount, 0);

    // Workers reply to the broadcast.
    for (let i = 0; i < workers.length; i += 1) {
      const r = await runWfUi([
        'send-agent-message',
        ...baseArgs(),
        '--node', workers[i].nodeId,
        '--to', mainNodeId,
        '--text', `Review done by ${workers[i].role}`,
        '--request-id', 'chain-bcast-1',
        '--actor-kind', 'subagent',
      ], { cwd: tempRoot, env: AGENT_ENV });
      assert.equal(r.status, 0, `broadcast reply ${i} failed: ${r.stderr}`);
    }

    // Aggregate all broadcast messages.
    const aggregated = await runWfUi([
      'read-agent-messages',
      ...baseArgs(),
      '--node', mainNodeId,
      '--peer', workers[0].nodeId,
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(aggregated.status, 0, `aggregate failed: ${aggregated.stderr}`);
    const entries = aggregated.stdout.result?.entries || aggregated.stdout.entries || [];
    assert.ok(entries.length >= 2, `must have entries for chain-bcast-1: ${entries.length}`);

    // ── E8: Markdown shared context ──
    // Create markdown node via the graph action.
    const mdCreate = await runWfUi([
      'workflow-node-map',
      ...baseArgs(),
      '--action', 'createNode',
      '--actor', mainNodeId,
      '--type', 'markdown',
      '--title', 'Chain Shared Plan',
      '--payload', JSON.stringify({ markdown: '# Chain Plan\n- Step A\n- Step B' }),
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(mdCreate.status, 0, `md create failed: ${mdCreate.stderr}`);
    const mdNodeId = mdCreate.stdout.result?.node?.nodeId || mdCreate.stdout.node?.nodeId;
    assert.ok(mdNodeId, 'markdown node must have a nodeId');

    // Connect Main Agent to the markdown node.
    const mdEdge = await runWfUi([
      'connect',
      ...baseArgs(),
      '--actor', mainNodeId,
      '--from', mainNodeId,
      '--to', mdNodeId,
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(mdEdge.status, 0, `md edge failed: ${mdEdge.stderr}`);

    // Read markdown through CLI.
    const mdRead = await runWfUi([
      'workflow-node-action',
      ...baseArgs(),
      '--node', mdNodeId,
      '--action', 'markdown.read',
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(mdRead.status, 0, `md read failed: ${mdRead.stderr}`);
    assert.ok(mdRead.stdout.result.markdown.includes('Chain Plan'), `md content: ${mdRead.stdout.result.markdown}`);

    // Write shared context via markdown.append.
    const mdAppend = await runWfUi([
      'workflow-node-action',
      ...baseArgs(),
      '--node', mdNodeId,
      '--action', 'markdown.append',
      '--payload', JSON.stringify({ markdown: '\n- Step C added by Main Agent' }),
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(mdAppend.status, 0, `md append failed: ${mdAppend.stderr}`);
    const mdAfter = await runWfUi([
      'workflow-node-action',
      ...baseArgs(),
      '--node', mdNodeId,
      '--action', 'markdown.read',
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.ok(mdAfter.stdout.result.markdown.includes('Step C'), 'markdown must reflect append');

    // ── E13: Goal node ──
    // Create a task capsule for the goal to reference.
    const taskDir = path.join(tempRoot, 'Harness', 'tasks', 'task-chain-goal');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'STATE.json'), JSON.stringify({
      schemaVersion: 1,
      taskId: 'task-chain-goal',
      status: 'active',
      title: 'Chain Goal',
      phase: 'implement',
      acceptance: [],
      links: { dependsOn: [], blocks: [], related: [] },
    }));
    const goalNodeId = `goal-task-chain-goal`;
    const goalNode = {
      nodeId: goalNodeId,
      kind: 'goal',
      role: 'Goal',
      label: 'Chain Goal',
      status: 'idle',
    };
    const currentGraph = loadWorkflowGraphMap(tempRoot);
    writeWorkflowGraphMap(tempRoot, {
      ...currentGraph,
      version: currentGraph.version + 1,
      nodes: [...(currentGraph.nodes || []), goalNode],
    });

    // Connect Main Agent to goal.
    const goalEdge = await runWfUi([
      'connect',
      ...baseArgs(),
      '--actor', mainNodeId,
      '--from', mainNodeId,
      '--to', goalNodeId,
      '--relation', 'goal',
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(goalEdge.status, 0, `goal edge failed: ${goalEdge.stderr}`);

    // Add and check goal items.
    const goalAdd = await runWfUi([
      'workflow-node-action',
      ...baseArgs(),
      '--node', goalNodeId,
      '--action', 'goal.add',
      '--actor', mainNodeId,
      '--actor-kind', 'main',
      '--payload', JSON.stringify({ planItems: [{ text: 'Complete chain test' }, { text: 'Verify evidence' }] }),
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(goalAdd.status, 0, `goal add failed: ${goalAdd.stderr}`);

    const goalCheck = await runWfUi([
      'workflow-node-action',
      ...baseArgs(),
      '--node', goalNodeId,
      '--action', 'goal.check',
      '--actor', mainNodeId,
      '--actor-kind', 'main',
      '--payload', JSON.stringify({ planItemIds: ['P-001', 'P-002'] }),
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(goalCheck.status, 0, `goal check failed: ${goalCheck.stderr}`);

    // Complete the goal.
    const goalDone = await runWfUi([
      'workflow-node-action',
      ...baseArgs(),
      '--node', goalNodeId,
      '--action', 'goal.complete',
      '--actor', mainNodeId,
      '--actor-kind', 'main',
      '--payload', JSON.stringify({ note: 'Chain test complete', evidenceRefs: ['chain-cli-smoke'] }),
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(goalDone.status, 0, `goal complete failed: ${goalDone.stderr}`);

    // ── E18: Final evidence aggregation ──
    // Main Agent reads all sources: mailbox, markdown, goal.
    const finalMailbox = await runWfUi([
      'read-agent-messages',
      ...baseArgs(),
      '--node', mainNodeId,
      '--peer', workers[0].nodeId,
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(finalMailbox.status, 0);

    const finalGoal = await runWfUi([
      'workflow-node-action',
      ...baseArgs(),
      '--node', goalNodeId,
      '--action', 'goal.read',
      '--actor', mainNodeId,
      '--actor-kind', 'main',
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(finalGoal.status, 0, `final goal read failed: ${finalGoal.stderr}`);
    assert.equal(finalGoal.stdout.result.status, 'proposed-complete');

    const finalMd = await runWfUi([
      'workflow-node-action',
      ...baseArgs(),
      '--node', mdNodeId,
      '--action', 'markdown.read',
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(finalMd.status, 0);
    assert.ok(finalMd.stdout.result.markdown.includes('Chain Plan'));

    const finalCtx = await runWfUi([
      'workflow-context',
      ...baseArgs(),
      '--node', mainNodeId,
    ], { cwd: tempRoot, env: AGENT_ENV });
    assert.equal(finalCtx.status, 0);
    // Verify manuals are injected (E16).
    assert.ok(ctx.stdout.context.connectedNodeManuals.length >= 1, 'must have manuals');

    // ── Assertions that prove the full chain completed ──
    const finalGraph = loadWorkflowGraphMap(tempRoot);
    const finalNodeIds = (finalGraph.nodes || []).map(n => n.nodeId || n.id);
    assert.ok(finalNodeIds.includes(mainNodeId), 'main must survive to end');
    assert.ok(finalNodeIds.includes(mdNodeId), 'markdown must survive to end');
    assert.ok(finalNodeIds.includes(goalNodeId), 'goal must survive to end');
    assert.ok(finalGraph.edges.length >= 5, `edges: ${finalGraph.edges.length}`);
  });
});
