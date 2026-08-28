import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { writeWorkflowGraphMap } from '../a2a-store.mjs';
import { executeNodeAction } from '../workflow-node-runtime.mjs';
import { persistSession } from '../terminal-store.mjs';
import { registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';
import { recordBridgeMessage } from '../bridge-store.mjs';

function seedRoot() {
  const root = makeHarnessTempRoot('wf-agent-structured-');
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

function writeGraph(root, nodes, edges) {
  writeWorkflowGraphMap(root, {
    schemaVersion: 1,
    version: 1,
    nodes,
    edges,
    positions: {},
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

test('AC-009 structured sendMessage carries requestId/threadId/contextRefs/toRole through the envelope', async () => {
  const root = seedRoot();
  const writes = { b: [] };
  try {
    persistAgentSession(root, 'agent-a', 'session-agent-a', 'main', 'Agent A');
    persistAgentSession(root, 'agent-b', 'session-agent-b', 'subagent', 'Agent B');
    writeGraph(root, [
      agentNode('agent-a', 'session-agent-a', 'main', 'Agent A'),
      agentNode('agent-b', 'session-agent-b', 'subagent', 'Agent B'),
    ], [
      { id: 'edge-a-b', from: 'agent-a', to: 'agent-b', relation: 'delegation', direction: 'bidirectional' },
    ]);
    registerPtyProcess('session-agent-b', { write: data => writes.b.push(String(data)) });

    const sent = await executeNodeAction(root, 'agent-a', 'agent.sendMessage', {
      to: 'agent-b',
      text: 'STRUCTURED_REQ',
      requestId: 'req-20260812-0001',
      threadId: 'thread-7',
      toRole: 'implementer',
      contextRefs: [{ nodeId: 'markdown-2a1', relation: 'shared-context' }],
    });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.mode, 'direct');
    assert.equal(sent.result.requestId, 'req-20260812-0001');
    // F17/D14: a structured request reaches the target PTY as a compact
    // envelope prefix + the text, typed char-by-char; the recorded bridge
    // data stays plain text.
    const envelopeAC009 = '[harness-request req-20260812-0001 to-role=implementer contextRefs=markdown-2a1] STRUCTURED_REQ';
    assert.ok(writes.b.length >= 1, 'envelope typing must start immediately');
    assert.equal(writes.b[0], '[', 'envelope typing must start with the first prefix char synchronously');
    await waitFor(() => (writes.b.join('') === `${envelopeAC009}\r` ? writes.b : null), { timeout: 8000 });
    assertTypedSubmitSequence(writes.b, envelopeAC009);

    const read = await executeNodeAction(root, 'agent-a', 'agent.readMessages', { peer: 'agent-b' });
    assert.equal(read.ok, true);
    assert.equal(read.result.entries.length, 1);
    const entry = read.result.entries[0];
    assert.equal(entry.data.replace(/\r$/, ''), 'STRUCTURED_REQ');
    assert.equal(entry.requestId, 'req-20260812-0001');
    assert.equal(entry.threadId, 'thread-7');
    assert.equal(entry.toRole, 'implementer');
    assert.deepEqual(entry.contextRefs, [{ nodeId: 'markdown-2a1', relation: 'shared-context' }]);
    assert.equal(entry.deliveryMode, 'direct');
  } finally {
    unregisterPtyProcess('session-agent-b');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('F17/D14: structured sends compose the [harness-request ...] PTY prefix; legacy text sends are unchanged', async () => {
  const root = seedRoot();
  const writes = { b: [], c: [] };
  try {
    persistAgentSession(root, 'agent-a', 'session-agent-a', 'main', 'Agent A');
    persistAgentSession(root, 'agent-b', 'session-agent-b', 'subagent', 'Agent B');
    persistAgentSession(root, 'agent-c', 'session-agent-c', 'subagent', 'Agent C');
    writeGraph(root, [
      agentNode('agent-a', 'session-agent-a', 'main', 'Agent A'),
      agentNode('agent-b', 'session-agent-b', 'subagent', 'Agent B'),
      agentNode('agent-c', 'session-agent-c', 'subagent', 'Agent C'),
    ], [
      { id: 'edge-a-b', from: 'agent-a', to: 'agent-b', relation: 'delegation', direction: 'bidirectional' },
      { id: 'edge-a-c', from: 'agent-a', to: 'agent-c', relation: 'delegation', direction: 'bidirectional' },
    ]);
    registerPtyProcess('session-agent-b', { write: data => writes.b.push(String(data)) });
    registerPtyProcess('session-agent-c', { write: data => writes.c.push(String(data)) });

    // (a) Structured send -> target input carries the envelope prefix with
    // requestId + contextRefs nodeIds, typed char-by-char.
    await executeNodeAction(root, 'agent-a', 'agent.sendMessage', {
      to: 'agent-b',
      text: 'DO_THE_WORK',
      requestId: 'req-f17-1',
      toRole: 'implementer',
      contextRefs: [{ nodeId: 'markdown-5a1', relation: 'shared-context' }],
    });
    const envF17B1 = '[harness-request req-f17-1 to-role=implementer contextRefs=markdown-5a1] DO_THE_WORK';
    assert.ok(writes.b.length >= 1, 'envelope typing must start immediately');
    assert.equal(writes.b[0], '[', 'envelope must start typing with the prefix char synchronously');
    await waitFor(() => (writes.b.join('') === `${envF17B1}\r` ? writes.b : null), { timeout: 8000 });
    assertTypedSubmitSequence(writes.b, envF17B1);
    const bLenAfterFirst = writes.b.length;

    // Broadcast composes per-recipient prefixes with the shared requestId.
    await executeNodeAction(root, 'agent-a', 'agent.broadcastMessage', {
      text: 'REQ_ALL_F17',
      requestId: 'req-f17-2',
      contextRefs: [{ nodeId: 'markdown-6a1' }],
    });
    const envF17B2 = '[harness-request req-f17-2 contextRefs=markdown-6a1] REQ_ALL_F17';
    assert.ok(writes.b.length >= bLenAfterFirst + 1, 'broadcast must append its first typed char to B');
    assert.equal(writes.b[bLenAfterFirst], '[', 'broadcast envelope starts typing into B');
    assert.ok(writes.c.length >= 1, 'broadcast envelope must start typing into C');
    assert.equal(writes.c[0], '[', 'broadcast envelope starts typing into C');
    await waitFor(() => (writes.b.join('') === `${envF17B1}\r${envF17B2}\r` ? writes.b : null), { timeout: 8000 });
    await waitFor(() => (writes.c.join('') === `${envF17B2}\r` ? writes.c : null), { timeout: 8000 });
    assert.equal(writes.b.join(''), `${envF17B1}\r${envF17B2}\r`);
    assert.equal(writes.c.join(''), `${envF17B2}\r`);
    assert.equal(writes.b.filter(w => w === '\r').length, 2, 'B received one \\r per submitted sequence');
    assert.equal(writes.c.filter(w => w === '\r').length, 1, 'C received exactly one \\r');

    // The recorded bridge envelope still carries the structured fields, and
    // `data` stays the plain text body (spec §5).
    const read = await executeNodeAction(root, 'agent-a', 'agent.readMessages', { peer: 'agent-b' });
    assert.equal(read.result.entries.length, 2);
    assert.equal(read.result.entries[0].requestId, 'req-f17-1');
    assert.equal(read.result.entries[0].data.replace(/\r$/, ''), 'DO_THE_WORK');
    assert.deepEqual(read.result.entries[0].contextRefs, [{ nodeId: 'markdown-5a1', relation: 'shared-context' }]);

    // (b) Legacy text-only send -> input keeps the plain text body (no
    // prefix), submitted the same way: typed body, then a single \r.
    const legacy = await executeNodeAction(root, 'agent-a', 'agent.sendMessage', {
      to: 'agent-c',
      text: 'PLAIN_TEXT_F17',
    });
    assert.equal(legacy.ok, true);
    assert.ok(
      writes.c.join('').startsWith(`${envF17B2}\rP`),
      `legacy body must start typing with 'P' right after the broadcast sequence: ${JSON.stringify(writes.c)}`,
    );
    await waitFor(() => (writes.c.join('') === `${envF17B2}\rPLAIN_TEXT_F17\r` ? writes.c : null), { timeout: 8000 });
    assert.equal(writes.c.join(''), `${envF17B2}\rPLAIN_TEXT_F17\r`);
    assert.equal(writes.c[writes.c.length - 1], '\r', 'legacy body must end with a single \\r');
    assert.equal(writes.c.filter(w => w === '\r').length, 2, 'C received one \\r per submitted sequence');
  } finally {
    unregisterPtyProcess('session-agent-b');
    unregisterPtyProcess('session-agent-c');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-010 readMessages by requestId aggregates replies from multiple agents in one request thread', async () => {
  const root = seedRoot();
  const writes = { a: [], b: [], c: [] };
  try {
    persistAgentSession(root, 'agent-a', 'session-agent-a', 'main', 'Agent A');
    persistAgentSession(root, 'agent-b', 'session-agent-b', 'subagent', 'Agent B');
    persistAgentSession(root, 'agent-c', 'session-agent-c', 'subagent', 'Agent C');
    writeGraph(root, [
      agentNode('agent-a', 'session-agent-a', 'main', 'Agent A'),
      agentNode('agent-b', 'session-agent-b', 'subagent', 'Agent B'),
      agentNode('agent-c', 'session-agent-c', 'subagent', 'Agent C'),
    ], [
      { id: 'edge-a-b', from: 'agent-a', to: 'agent-b', relation: 'delegation', direction: 'bidirectional' },
      { id: 'edge-a-c', from: 'agent-a', to: 'agent-c', relation: 'delegation', direction: 'bidirectional' },
    ]);
    registerPtyProcess('session-agent-a', { write: data => writes.a.push(String(data)) });
    registerPtyProcess('session-agent-b', { write: data => writes.b.push(String(data)) });
    registerPtyProcess('session-agent-c', { write: data => writes.c.push(String(data)) });

    // Broadcast one request with a shared requestId to B and C.
    const broadcast = await executeNodeAction(root, 'agent-a', 'agent.broadcastMessage', {
      text: 'REQ_ALL',
      requestId: 'req-agg-1',
      threadId: 'thread-agg',
      contextRefs: [{ nodeId: 'markdown-9f1', relation: 'shared-context' }],
    });
    assert.equal(broadcast.ok, true);
    assert.equal(broadcast.result.requestId, 'req-agg-1');
    assert.equal(broadcast.result.deliveries.length, 2);

    // Both receivers echo the requestId in their replies.
    const replyB = await executeNodeAction(root, 'agent-b', 'agent.sendMessage', {
      to: 'agent-a',
      text: 'REPLY_B',
      requestId: 'req-agg-1',
      threadId: 'thread-agg',
    });
    const replyC = await executeNodeAction(root, 'agent-c', 'agent.sendMessage', {
      to: 'agent-a',
      text: 'REPLY_C',
      requestId: 'req-agg-1',
      threadId: 'thread-agg',
    });
    assert.equal(replyB.result.requestId, 'req-agg-1');
    assert.equal(replyC.result.requestId, 'req-agg-1');

    const aggregated = await executeNodeAction(root, 'agent-a', 'agent.readMessages', {
      requestId: 'req-agg-1',
    });
    assert.equal(aggregated.ok, true);
    assert.equal(aggregated.result.requestId, 'req-agg-1');
    assert.equal(aggregated.result.entries.length, 4);
    const texts = aggregated.result.entries.map(entry => entry.data.replace(/\r$/, '')).sort();
    assert.deepEqual(texts, ['REPLY_B', 'REPLY_C', 'REQ_ALL', 'REQ_ALL']);
    for (const entry of aggregated.result.entries) {
      assert.equal(entry.requestId, 'req-agg-1');
      assert.equal(entry.threadId, 'thread-agg');
    }
    // Replies to the same request surface their messageIds for follow-ups.
    const replyIds = aggregated.result.entries
      .filter(entry => entry.data.replace(/\r$/, '').startsWith('REPLY'))
      .map(entry => entry.messageId)
      .filter(Boolean);
    assert.equal(replyIds.length, 2);

    // Filtering by threadId narrows the same request thread.
    const threaded = await executeNodeAction(root, 'agent-a', 'agent.readMessages', {
      requestId: 'req-agg-1',
      threadId: 'thread-agg',
    });
    assert.equal(threaded.result.entries.length, 4);
    const otherThread = await executeNodeAction(root, 'agent-a', 'agent.readMessages', {
      requestId: 'req-agg-1',
      threadId: 'thread-other',
    });
    assert.equal(otherThread.result.entries.length, 0);
  } finally {
    unregisterPtyProcess('session-agent-a');
    unregisterPtyProcess('session-agent-b');
    unregisterPtyProcess('session-agent-c');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-019 contextRefs are nodeId references only; inline content is rejected, never stored', async () => {
  const root = seedRoot();
  const writes = { b: [] };
  try {
    persistAgentSession(root, 'agent-a', 'session-agent-a', 'main', 'Agent A');
    persistAgentSession(root, 'agent-b', 'session-agent-b', 'subagent', 'Agent B');
    writeGraph(root, [
      agentNode('agent-a', 'session-agent-a', 'main', 'Agent A'),
      agentNode('agent-b', 'session-agent-b', 'subagent', 'Agent B'),
    ], [
      { id: 'edge-a-b', from: 'agent-a', to: 'agent-b', relation: 'delegation', direction: 'bidirectional' },
    ]);
    registerPtyProcess('session-agent-b', { write: data => writes.b.push(String(data)) });

    // String-form refs are normalized to {nodeId, relation:''}.
    const viaString = await executeNodeAction(root, 'agent-a', 'agent.sendMessage', {
      to: 'agent-b',
      text: 'REF_STRING',
      contextRefs: ['markdown-2a1'],
    });
    assert.equal(viaString.ok, true);
    const readString = await executeNodeAction(root, 'agent-a', 'agent.readMessages', { peer: 'agent-b' });
    assert.deepEqual(readString.result.entries[0].contextRefs, [{ nodeId: 'markdown-2a1', relation: '' }]);

    // A ref with no nodeId is rejected.
    await assert.rejects(
      () => executeNodeAction(root, 'agent-a', 'agent.sendMessage', {
        to: 'agent-b',
        text: 'REF_MISSING_ID',
        contextRefs: [{ relation: 'shared-context' }],
      }),
      error => error.code === 'INVALID_CONTEXT_REFS',
    );

    // A ref that inlines markdown body content is rejected — never stored (AC-019).
    await assert.rejects(
      () => executeNodeAction(root, 'agent-a', 'agent.sendMessage', {
        to: 'agent-b',
        text: 'REF_INLINE',
        contextRefs: [{ nodeId: 'markdown-2a1', relation: 'shared-context', content: '# Inline body\n' }],
      }),
      error => error.code === 'CONTEXT_REF_CONTENT_FORBIDDEN',
    );
    await assert.rejects(
      () => executeNodeAction(root, 'agent-a', 'agent.broadcastMessage', {
        text: 'REF_INLINE_BC',
        contextRefs: [{ nodeId: 'markdown-2a1', markdown: '# Inline body\n' }],
      }),
      error => error.code === 'CONTEXT_REF_CONTENT_FORBIDDEN',
    );

    const read = await executeNodeAction(root, 'agent-a', 'agent.readMessages', { peer: 'agent-b' });
    assert.equal(read.result.entries.length, 1);
    for (const entry of read.result.entries) {
      assert.equal(entry.data.includes('# Inline'), false);
    }
  } finally {
    unregisterPtyProcess('session-agent-b');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-026/T14 legacy {to,text} sendMessage and legacy readMessages keep the exact previous shape', async () => {
  const root = seedRoot();
  const writes = { a: [], b: [] };
  try {
    persistAgentSession(root, 'agent-a', 'session-agent-a', 'main', 'Agent A');
    persistAgentSession(root, 'agent-b', 'session-agent-b', 'subagent', 'Agent B');
    writeGraph(root, [
      agentNode('agent-a', 'session-agent-a', 'main', 'Agent A'),
      agentNode('agent-b', 'session-agent-b', 'subagent', 'Agent B'),
    ], [
      { id: 'edge-a-b', from: 'agent-a', to: 'agent-b', relation: 'delegation', direction: 'bidirectional' },
    ]);
    registerPtyProcess('session-agent-a', { write: data => writes.a.push(String(data)) });
    registerPtyProcess('session-agent-b', { write: data => writes.b.push(String(data)) });

    const sent = await executeNodeAction(root, 'agent-a', 'agent.sendMessage', {
      to: 'agent-b',
      text: 'A_TO_B_T14',
    });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.mode, 'direct');
    assert.equal(sent.result.deliveries.length, 1);
    assert.equal(sent.result.deliveries[0].ok, true);
    assert.equal(sent.result.deliveries[0].fromNodeId, 'agent-a');
    assert.equal(sent.result.deliveries[0].toNodeId, 'agent-b');
    assert.equal(writes.b[0], 'A', 'the legacy body must start typing synchronously');
    await waitFor(() => (writes.b.join('') === 'A_TO_B_T14\r' ? writes.b : null), { timeout: 5000 });
    assertTypedSubmitSequence(writes.b, 'A_TO_B_T14');

    const reply = await executeNodeAction(root, 'agent-b', 'agent.sendMessage', {
      to: 'agent-a',
      text: 'B_TO_A_T14',
      replyTo: sent.result.messageId,
    });
    assert.equal(reply.ok, true);
    assert.equal(reply.result.deliveries[0].ok, true);

    const read = await executeNodeAction(root, 'agent-a', 'agent.readMessages', {
      peer: 'agent-b',
      tail: 20,
    });
    assert.equal(read.ok, true);
    assert.equal(read.result.entries.length, 2);
    assert.deepEqual(read.result.entries.map(entry => entry.data.replace(/\r$/, '')), ['A_TO_B_T14', 'B_TO_A_T14']);
    assert.equal(read.result.entries[1].replyTo, sent.result.messageId);
    // Legacy entries carry empty structured fields, not new keys.
    assert.equal(read.result.entries[0].requestId, '');
    assert.equal(read.result.entries[0].threadId, '');
    assert.equal(read.result.entries[0].replyTo, '');
    assert.deepEqual(read.result.entries[0].contextRefs, []);
  } finally {
    unregisterPtyProcess('session-agent-a');
    unregisterPtyProcess('session-agent-b');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('spec 6.1 readMessages wakeup filter returns timer wakeup envelopes from the message store', async () => {
  const root = seedRoot();
  const writes = { b: [] };
  try {
    persistAgentSession(root, 'agent-a', 'session-agent-a', 'main', 'Agent A');
    persistAgentSession(root, 'agent-b', 'session-agent-b', 'subagent', 'Agent B');
    writeGraph(root, [
      agentNode('agent-a', 'session-agent-a', 'main', 'Agent A'),
      agentNode('agent-b', 'session-agent-b', 'subagent', 'Agent B'),
    ], [
      { id: 'edge-a-b', from: 'agent-a', to: 'agent-b', relation: 'delegation', direction: 'bidirectional' },
    ]);
    registerPtyProcess('session-agent-b', { write: data => writes.b.push(String(data)) });

    recordBridgeMessage(root, {
      fromSessionId: 'session-timer-1',
      toSessionId: 'session-agent-a',
      fromNodeId: 'timer-node-1',
      toNodeId: 'agent-a',
      data: '',
      source: 'timer.wakeup',
      messageId: 'wake-0007',
      deliveryMode: 'wakeup',
    });

    const wakeups = await executeNodeAction(root, 'agent-a', 'agent.readMessages', { wakeup: true });
    assert.equal(wakeups.ok, true);
    assert.equal(wakeups.result.mode, 'wakeup');
    assert.equal(wakeups.result.entries.length, 1);
    const entry = wakeups.result.entries[0];
    assert.equal(entry.messageId, 'wake-0007');
    assert.equal(entry.deliveryMode, 'wakeup');
    assert.equal(entry.source, 'timer.wakeup');
    assert.equal(entry.fromNodeId, 'timer-node-1');
    assert.equal(entry.toNodeId, 'agent-a');

    // Non-wakeup bridge messages do not leak into the wakeup filter.
    await executeNodeAction(root, 'agent-a', 'agent.sendMessage', {
      to: 'agent-b',
      text: 'NOT_WAKEUP',
    });
    const stillWakeups = await executeNodeAction(root, 'agent-a', 'agent.readMessages', { wakeup: true });
    assert.equal(stillWakeups.result.entries.length, 1);
  } finally {
    unregisterPtyProcess('session-agent-b');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
