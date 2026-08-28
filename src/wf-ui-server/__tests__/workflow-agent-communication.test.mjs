import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { writeWorkflowGraphMap, loadWorkflowGraphMap } from '../a2a-store.mjs';
import { createNode, executeNodeAction } from '../workflow-node-runtime.mjs';
import { buildAgentContext, findAgentGraphNode } from '../workflow-agent-context.mjs';
import { persistSession, readTerminalRange } from '../terminal-store.mjs';
import { registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';

function seedRoot() {
  const root = makeHarnessTempRoot('wf-agent-comm-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

function agentNode(nodeId, sessionId, agentKind = 'subagent', role = 'Agent') {
  return {
    nodeId,
    sessionId,
    kind: 'terminal-session',
    runtime: 'codex',
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
    runtime: 'codex',
    agentKind,
    role,
    status: 'running',
    attachMode: true,
    taskId: null,
  });
}

// Submit sequences are typed CHAR-BY-CHAR (first char synchronously, the rest
// at 12ms gaps) and end with exactly one \r (0x0D) as its own final write.
function assertTypedSubmitSequence(writes, body) {
  const joined = writes.join('');
  assert.equal(joined.includes('\n'), false, `no \\n may be injected: ${JSON.stringify(writes)}`);
  assert.ok(joined.endsWith('\r'), `sequence must end with the single \\r: ${JSON.stringify(writes)}`);
  assert.equal(writes[writes.length - 1], '\r', `the \\r must arrive as its own single-byte write: ${JSON.stringify(writes)}`);
  assert.equal(joined.slice(0, -1), body, `the typed chars must join to the exact body: ${JSON.stringify(writes)}`);
}

async function waitFor(fn, { timeout = 5000, step = 25 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise(resolve => setTimeout(resolve, step));
  }
  throw new Error(`waitFor timed out; last=${JSON.stringify(last)}`);
}

function runNode(args, { cwd, env, timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${args.join(' ')}`));
    }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', status => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

test('W41-DIRECT Agent A sends a connected message to B and B replies to A through backend actions', async () => {
  const root = seedRoot();
  const writes = { a: [], b: [] };
  try {
    persistAgentSession(root, 'agent-a', 'session-agent-a', 'main', 'Agent A');
    persistAgentSession(root, 'agent-b', 'session-agent-b', 'subagent', 'Agent B');
    writeWorkflowGraphMap(root, {
      schemaVersion: 1,
      version: 1,
      nodes: [
        agentNode('agent-a', 'session-agent-a', 'main', 'Agent A'),
        agentNode('agent-b', 'session-agent-b', 'subagent', 'Agent B'),
      ],
      edges: [
        { id: 'edge-a-b', from: 'agent-a', to: 'agent-b', relation: 'delegation', direction: 'bidirectional' },
      ],
      positions: {},
    });
    registerPtyProcess('session-agent-a', { write: data => writes.a.push(String(data)) });
    registerPtyProcess('session-agent-b', { write: data => writes.b.push(String(data)) });

    const sent = await executeNodeAction(root, 'agent-a', 'agent.sendMessage', {
      to: 'agent-b',
      text: 'A_TO_B_W41',
    });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.mode, 'direct');
    assert.equal(sent.result.deliveries.length, 1);
    assert.equal(sent.result.deliveries[0].ok, true);
    assert.equal(sent.result.deliveries[0].fromNodeId, 'agent-a');
    assert.equal(sent.result.deliveries[0].toNodeId, 'agent-b');
    assert.equal(writes.b[0], 'A', 'the first char of the submitted body must be written synchronously');
    await waitFor(() => (writes.b.join('') === 'A_TO_B_W41\r' ? writes.b : null));
    assertTypedSubmitSequence(writes.b, 'A_TO_B_W41');

    const reply = await executeNodeAction(root, 'agent-b', 'agent.sendMessage', {
      to: 'agent-a',
      text: 'B_TO_A_W41',
      replyTo: sent.result.messageId,
    });
    assert.equal(reply.ok, true);
    assert.equal(reply.result.deliveries[0].ok, true);
    assert.equal(writes.a[0], 'B', 'the reply body starts typing synchronously');
    await waitFor(() => (writes.a.join('') === 'B_TO_A_W41\r' ? writes.a : null));
    assertTypedSubmitSequence(writes.a, 'B_TO_A_W41');

    const read = await executeNodeAction(root, 'agent-a', 'agent.readMessages', {
      peer: 'agent-b',
      tail: 20,
    });
    assert.equal(read.ok, true);
    assert.equal(read.result.entries.length, 2);
    assert.deepEqual(read.result.entries.map(entry => entry.data.replace(/\r$/, '')), ['A_TO_B_W41', 'B_TO_A_W41']);
    assert.equal(read.result.entries[1].replyTo, sent.result.messageId);

    const transcript = readTerminalRange(root, { sessionId: 'session-agent-b', tail: 20 });
    assert.ok(transcript.entries.some(entry => entry.stream === 'stdin' && entry.data.includes('A_TO_B_W41')));
  } finally {
    unregisterPtyProcess('session-agent-a');
    unregisterPtyProcess('session-agent-b');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W41-BROADCAST Agent A sends one message to connected B and C, skipping unconnected D', async () => {
  const root = seedRoot();
  const writes = { b: [], c: [], d: [] };
  try {
    for (const [nodeId, sessionId, kind, role] of [
      ['agent-a', 'session-agent-a', 'main', 'Agent A'],
      ['agent-b', 'session-agent-b', 'subagent', 'Agent B'],
      ['agent-c', 'session-agent-c', 'subagent', 'Agent C'],
      ['agent-d', 'session-agent-d', 'subagent', 'Agent D'],
    ]) {
      persistAgentSession(root, nodeId, sessionId, kind, role);
    }
    writeWorkflowGraphMap(root, {
      schemaVersion: 1,
      version: 1,
      nodes: [
        agentNode('agent-a', 'session-agent-a', 'main', 'Agent A'),
        agentNode('agent-b', 'session-agent-b', 'subagent', 'Agent B'),
        agentNode('agent-c', 'session-agent-c', 'subagent', 'Agent C'),
        agentNode('agent-d', 'session-agent-d', 'subagent', 'Agent D'),
      ],
      edges: [
        { id: 'edge-a-b', from: 'agent-a', to: 'agent-b', relation: 'delegation', direction: 'bidirectional' },
        { id: 'edge-a-c', from: 'agent-a', to: 'agent-c', relation: 'delegation', direction: 'bidirectional' },
      ],
      positions: {},
    });
    registerPtyProcess('session-agent-b', { write: data => writes.b.push(String(data)) });
    registerPtyProcess('session-agent-c', { write: data => writes.c.push(String(data)) });
    registerPtyProcess('session-agent-d', { write: data => writes.d.push(String(data)) });

    const broadcast = await executeNodeAction(root, 'agent-a', 'agent.broadcastMessage', {
      text: 'A_BROADCAST_W41',
      to: ['agent-b', 'agent-c', 'agent-d'],
      topic: 'w41-status',
    });

    assert.equal(broadcast.ok, false);
    assert.equal(broadcast.result.mode, 'broadcast');
    assert.equal(broadcast.result.deliveries.filter(item => item.ok).length, 2);
    assert.equal(broadcast.result.deliveries.find(item => item.toNodeId === 'agent-d').ok, false);
    assert.equal(broadcast.result.deliveries.find(item => item.toNodeId === 'agent-d').code, 'NOT_CONNECTED');
    assert.equal(writes.b[0], 'A', 'the first char of the broadcast body must be written synchronously');
    assert.equal(writes.c[0], 'A');
    assert.deepEqual(writes.d, []);
    await waitFor(() => (writes.b.join('') === 'A_BROADCAST_W41\r' ? writes.b : null));
    await waitFor(() => (writes.c.join('') === 'A_BROADCAST_W41\r' ? writes.c : null));
    assertTypedSubmitSequence(writes.b, 'A_BROADCAST_W41');
    assertTypedSubmitSequence(writes.c, 'A_BROADCAST_W41');
    assert.deepEqual(writes.d, []);

    const bMessages = await executeNodeAction(root, 'agent-a', 'agent.readMessages', { peer: 'agent-b' });
    const cMessages = await executeNodeAction(root, 'agent-a', 'agent.readMessages', { peer: 'agent-c' });
    assert.equal(bMessages.result.entries.at(-1).topic, 'w41-status');
    assert.equal(cMessages.result.entries.at(-1).topic, 'w41-status');
  } finally {
    unregisterPtyProcess('session-agent-b');
    unregisterPtyProcess('session-agent-c');
    unregisterPtyProcess('session-agent-d');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W41-DIRECT subagent cannot force a message to an unconnected Agent', async () => {
  const root = seedRoot();
  try {
    persistAgentSession(root, 'agent-b', 'session-agent-b', 'subagent', 'Agent B');
    persistAgentSession(root, 'agent-d', 'session-agent-d', 'subagent', 'Agent D');
    writeWorkflowGraphMap(root, {
      schemaVersion: 1,
      version: 1,
      nodes: [
        agentNode('agent-b', 'session-agent-b', 'subagent', 'Agent B'),
        agentNode('agent-d', 'session-agent-d', 'subagent', 'Agent D'),
      ],
      edges: [],
      positions: {},
    });

    await assert.rejects(
      () => executeNodeAction(root, 'agent-b', 'agent.sendMessage', {
        text: 'MISSING_TARGET_W41',
      }),
      error => error.code === 'RECIPIENT_REQUIRED',
    );
    await assert.rejects(
      () => executeNodeAction(root, 'agent-b', 'agent.sendMessage', {
        to: ['agent-d', 'agent-b'],
        text: 'MULTI_TARGET_DIRECT_W41',
      }),
      error => error.code === 'TOO_MANY_RECIPIENTS',
    );
    await assert.rejects(
      () => executeNodeAction(root, 'agent-b', 'agent.sendMessage', {
        to: 'agent-d',
        text: 'FORCE_SHOULD_FAIL_W41',
        force: true,
      }),
      error => error.code === 'MAIN_AGENT_FORCE_REQUIRED',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W41-SHARED-CONTEXT connected Markdown can serve as shared blackboard context for A and B', async () => {
  const root = seedRoot();
  try {
    persistAgentSession(root, 'agent-a', 'session-agent-a', 'main', 'Agent A');
    persistAgentSession(root, 'agent-b', 'session-agent-b', 'subagent', 'Agent B');
    const markdown = await createNode(root, {
      type: 'markdown',
      title: 'Shared Agent Blackboard',
      markdown: '# Shared Agent Blackboard\n',
    });
    writeWorkflowGraphMap(root, {
      ...loadWorkflowGraphMap(root),
      nodes: [
        agentNode('agent-a', 'session-agent-a', 'main', 'Agent A'),
        agentNode('agent-b', 'session-agent-b', 'subagent', 'Agent B'),
        ...(loadWorkflowGraphMap(root).nodes || []).filter(node => node.nodeId === markdown.node.nodeId),
      ],
      edges: [
        { id: 'edge-a-b', from: 'agent-a', to: 'agent-b', relation: 'delegation', direction: 'bidirectional' },
        { id: 'edge-a-md', from: 'agent-a', to: markdown.node.nodeId, relation: 'shared-context', direction: 'bidirectional', sourceHandle: 'context', targetHandle: 'markdown' },
        { id: 'edge-b-md', from: 'agent-b', to: markdown.node.nodeId, relation: 'shared-context', direction: 'bidirectional', sourceHandle: 'context', targetHandle: 'markdown' },
      ],
    });

    await executeNodeAction(root, markdown.node.nodeId, 'markdown.append', {
      markdown: '- Agent A posted W41 shared context.\n',
      actorNodeId: 'agent-a',
      actorType: 'agent',
    });
    await executeNodeAction(root, markdown.node.nodeId, 'markdown.append', {
      markdown: '- Agent B read and replied using W41 shared context.\n',
      actorNodeId: 'agent-b',
      actorType: 'agent',
    });

    const graph = loadWorkflowGraphMap(root);
    const contextA = buildAgentContext(root, findAgentGraphNode(graph, 'agent-a'), graph).context;
    const contextB = buildAgentContext(root, findAgentGraphNode(graph, 'agent-b'), graph).context;
    for (const context of [contextA, contextB]) {
      const ref = context.connectedResourceRefs.find(item => item.nodeId === markdown.node.nodeId);
      assert.ok(ref, JSON.stringify(context.connectedResourceRefs));
      assert.equal(ref.type, 'markdown');
      assert.equal(ref.relation, 'shared-context');
      assert.ok(ref.capabilities.includes('markdown:append'));
    }
    assert.ok(contextA.availableActions.includes('agent.sendMessage'));
    assert.ok(contextB.availableActions.includes('agent.sendMessage'));
    const bAgentRef = contextA.connectedAgentRefs.find(ref => ref.nodeId === 'agent-b');
    assert.ok(bAgentRef.allowedActions.includes('agent.sendMessage'));
    assert.equal(bAgentRef.delegation.messageAction, 'agent.sendMessage');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W41-CLI send-agent-message and broadcast-agent-message wrap typed backend actions', async () => {
  const root = seedRoot();
  const registry = new SessionRegistry();
  const writes = { b: [], c: [] };
  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0, sessionRegistry: registry });
  const script = path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs');
  const env = {
    ...process.env,
    HARNESS_PEER_SESSION_ID: 'session-agent-a',
    HARNESS_WORKFLOW_NODE_ID: 'agent-a',
    HARNESS_AGENT_KIND: 'main',
    HARNESS_WF_UI_URL: `http://127.0.0.1:${started.port}`,
    HARNESS_WF_UI_TOKEN: started.token,
  };
  try {
    for (const [nodeId, sessionId, kind, role] of [
      ['agent-a', 'session-agent-a', 'main', 'Agent A'],
      ['agent-b', 'session-agent-b', 'subagent', 'Agent B'],
      ['agent-c', 'session-agent-c', 'subagent', 'Agent C'],
    ]) {
      persistAgentSession(root, nodeId, sessionId, kind, role);
      registry.create({ runtime: 'codex', agentKind: kind, role, graphNodeId: nodeId });
      registry.update(sessionId, { status: 'running', graphNodeId: nodeId });
    }
    writeWorkflowGraphMap(root, {
      schemaVersion: 1,
      version: 1,
      nodes: [
        agentNode('agent-a', 'session-agent-a', 'main', 'Agent A'),
        agentNode('agent-b', 'session-agent-b', 'subagent', 'Agent B'),
        agentNode('agent-c', 'session-agent-c', 'subagent', 'Agent C'),
      ],
      edges: [
        { id: 'edge-a-b', from: 'agent-a', to: 'agent-b', relation: 'delegation', direction: 'bidirectional' },
        { id: 'edge-a-c', from: 'agent-a', to: 'agent-c', relation: 'delegation', direction: 'bidirectional' },
      ],
      positions: {},
    });
    registerPtyProcess('session-agent-b', { write: data => writes.b.push(String(data)) });
    registerPtyProcess('session-agent-c', { write: data => writes.c.push(String(data)) });

    const direct = await runNode([
      script,
      'send-agent-message',
      '--to',
      'agent-b',
      '--text',
      'CLI_DIRECT_W41',
      '--project',
      root,
    ], { cwd: root, env });
    assert.equal(direct.status, 0, direct.stderr || direct.stdout);
    const directBody = JSON.parse(direct.stdout);
    assert.equal(directBody.action, 'agent.sendMessage');
    assert.equal(writes.b[0], 'C', 'the CLI direct body must start typing synchronously');
    await waitFor(() => (writes.b.join('') === 'CLI_DIRECT_W41\r' ? writes.b : null), { timeout: 8000 });
    assertTypedSubmitSequence(writes.b, 'CLI_DIRECT_W41');

    const broadcast = await runNode([
      script,
      'broadcast-agent-message',
      '--text',
      'CLI_BROADCAST_W41',
      '--project',
      root,
    ], { cwd: root, env });
    assert.equal(broadcast.status, 0, broadcast.stderr || broadcast.stdout);
    const broadcastBody = JSON.parse(broadcast.stdout);
    assert.equal(broadcastBody.action, 'agent.broadcastMessage');
    assert.equal(broadcastBody.result.deliveries.filter(item => item.ok).length, 2);
    // The direct submit has fully landed (typed body + \r); the broadcast
    // starts typing into both recipients with its first char.
    assert.ok(
      writes.b.join('').startsWith('CLI_DIRECT_W41\rC'),
      `broadcast typing must follow the completed direct sequence: ${JSON.stringify(writes.b)}`,
    );
    assert.equal(writes.c[0], 'C', 'the CLI broadcast body must start typing synchronously');
    await waitFor(() => (writes.b.join('') === 'CLI_DIRECT_W41\rCLI_BROADCAST_W41\r' ? writes.b : null), { timeout: 8000 });
    await waitFor(() => (writes.c.join('') === 'CLI_BROADCAST_W41\r' ? writes.c : null), { timeout: 8000 });
    assert.equal(writes.b.join(''), 'CLI_DIRECT_W41\rCLI_BROADCAST_W41\r');
    assert.equal(writes.c.join(''), 'CLI_BROADCAST_W41\r');
    assertTypedSubmitSequence(writes.c, 'CLI_BROADCAST_W41');
    assert.equal(writes.b[writes.b.length - 1], '\r', 'B sequence must end with the single \\r');
    assert.equal(writes.b.filter(w => w === '\r').length, 2, 'B received one \\r per submitted sequence');
    assert.equal(writes.c.filter(w => w === '\r').length, 1, 'C received exactly one \\r');
  } finally {
    unregisterPtyProcess('session-agent-b');
    unregisterPtyProcess('session-agent-c');
    await stopServer(started.server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
