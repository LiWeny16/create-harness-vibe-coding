import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { createChatDriver, __resetChatDriversForTests } from '../chat-driver.mjs';
import { startServer, stopServer } from '../server.mjs';
import { SessionRegistry } from '../session-registry.mjs';

const modeCatalog = {
  claude: ['default', 'acceptEdits', 'plan', 'bypassPermissions'],
  codex: ['untrusted', 'on-request', 'on-failure', 'never'],
  opencode: ['ask', 'allow', 'deny'],
  pi: ['ask', 'allow', 'deny'],
};

function wait(ms = 25) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function connectChatWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages = [];
    const waiters = [];
    ws.addEventListener('message', event => {
      let parsed;
      try { parsed = JSON.parse(String(event.data)); } catch { parsed = event.data; }
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(parsed);
      else messages.push(parsed);
    });
    ws.addEventListener('open', () => resolve({
      ws,
      send(value) { ws.send(JSON.stringify(value)); },
      next(timeoutMs = 1500) {
        if (messages.length) return Promise.resolve(messages.shift());
        return new Promise((res, rej) => {
          const waiter = {
            resolve(value) { clearTimeout(timer); res(value); },
          };
          const timer = setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            rej(new Error('Timed out waiting for chat WebSocket frame'));
          }, timeoutMs);
          waiters.push(waiter);
        });
      },
      close() { ws.close(); },
    }));
    ws.addEventListener('error', () => reject(new Error(`WebSocket connection failed: ${url}`)));
  });
}

async function setupChatServer({ runtime = 'claude', permissionMode = modeCatalog[runtime][0] } = {}) {
  __resetChatDriversForTests();
  const projectRoot = makeHarnessTempRoot('chat-server-contract-');
  fs.mkdirSync(path.join(projectRoot, 'Harness', 'a2a'), { recursive: true });
  const registry = new SessionRegistry();
  const session = registry.create({
    runtime,
    uiMode: 'chat',
    agentKind: 'main',
    role: 'main',
    objective: 'Chat server contract test',
    projectRoot,
    cwd: projectRoot,
    graphNodeId: 'chat-contract-main',
  });
  registry.update(session.sessionId, { status: 'running', graphNodeId: 'chat-contract-main' });
  const activeSession = registry.get(session.sessionId);
  const state = {
    permissionMode,
    supportedModes: modeCatalog[runtime],
    modeCalls: [],
    modeGate: null,
    failModes: new Set(),
    pendingApprovals: new Set(),
    approvalResults: [],
  };
  const fakeDriver = {
    supportedModes: state.supportedModes,
    get permissionMode() { return state.permissionMode; },
    send() { return true; },
    steer() { return true; },
    interrupt() { return true; },
    async setPermissionMode(mode) {
      state.modeCalls.push(mode);
      if (state.modeGate) {
        const gate = state.modeGate;
        state.modeGate = null;
        await gate.promise;
      }
      if (state.failModes.has(mode)) throw new Error(`Runtime rejected ${mode}`);
      state.permissionMode = mode;
      return true;
    },
    approve(requestId, decision) {
      if (!state.pendingApprovals.has(requestId)) return false;
      state.pendingApprovals.delete(requestId);
      state.approvalResults.push({ requestId, decision });
      return true;
    },
    dispose() {},
  };
  const driver = await createChatDriver(runtime, {
    sessionId: session.sessionId,
    projectRoot,
    session: activeSession,
    driverModule: {
      default: ({ onEvent }) => ({
        ...fakeDriver,
        emit(event) { onEvent(event); },
      }),
    },
  });
  const serverResult = await startServer({
    projectRoot,
    sessionRegistry: registry,
    chatWs: true,
    eventsWs: false,
    host: '127.0.0.1',
    port: 0,
  });
  const baseUrl = `http://127.0.0.1:${serverResult.port}`;
  return {
    projectRoot,
    session: activeSession,
    state,
    driver,
    serverResult,
    baseUrl,
    wsUrl: `ws://127.0.0.1:${serverResult.port}/ws/chat/${session.sessionId}`,
    async close() {
      try { await stopServer(serverResult.server); } finally {
        await driver.dispose?.();
        __resetChatDriversForTests();
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  };
}

test('AC-3 chat WebSocket sends state before ordered stored/live envelopes and range returns them', async () => {
  const fixture = await setupChatServer({ runtime: 'claude' });
  try {
    fixture.driver.emit({ type: 'text_delta', payload: { delta: 'stored one' } });
    fixture.driver.emit({ type: 'tool_call_start', payload: { callId: 'tool-1', name: 'Read', input: { path: 'README.md' } } });

    const ws = await connectChatWs(fixture.wsUrl);
    const stateFrame = await ws.next();
    assert.equal(stateFrame.type, 'chat:state');
    assert.equal(stateFrame.sessionId, fixture.session.sessionId);
    assert.equal(stateFrame.uiMode, 'chat');
    assert.equal(stateFrame.runtime, 'claude');
    assert.deepEqual(stateFrame.supportedModes, modeCatalog.claude);
    assert.equal(stateFrame.permissionMode, 'default');

    const stored = [await ws.next(), await ws.next()];
    assert.deepEqual(stored.map(frame => frame.type), ['text_delta', 'tool_call_start']);
    assert.ok(stored[0].seq < stored[1].seq, 'stored envelopes are replayed in sequence order');

    fixture.driver.emit({ type: 'text_delta', payload: { delta: 'live after attach' } });
    const live = await ws.next();
    assert.equal(live.type, 'text_delta');
    assert.equal(live.payload.delta, 'live after attach');

    const range = await fetch(`${fixture.baseUrl}/api/chat/${fixture.session.sessionId}/range?fromSeq=0`);
    assert.equal(range.status, 200);
    const body = await range.json();
    assert.deepEqual(body.envelopes.map(envelope => envelope.type), ['text_delta', 'tool_call_start', 'text_delta']);
    assert.ok(body.envelopes.every((envelope, index) => index === 0 || envelope.seq > body.envelopes[index - 1].seq));
    ws.close();
  } finally {
    await fixture.close();
  }
});

for (const runtime of Object.keys(modeCatalog)) {
  test(`AC-4 ${runtime} state handshake declares only that runtime's supported permission modes`, async () => {
    const initialMode = modeCatalog[runtime][0];
    const fixture = await setupChatServer({ runtime, permissionMode: initialMode });
    try {
      const ws = await connectChatWs(fixture.wsUrl);
      const stateFrame = await ws.next();
      assert.equal(stateFrame.type, 'chat:state');
      assert.equal(stateFrame.runtime, runtime);
      assert.deepEqual(stateFrame.supportedModes, modeCatalog[runtime]);
      assert.equal(stateFrame.permissionMode, initialMode);
      ws.close();
    } finally {
      await fixture.close();
    }
  });
}

test('AC-4 server validates runtime modes, awaits confirmation, and returns correlated success/failure frames', async () => {
  const fixture = await setupChatServer({ runtime: 'codex', permissionMode: 'untrusted' });
  try {
    const ws = await connectChatWs(fixture.wsUrl);
    const stateFrame = await ws.next();
    assert.deepEqual(stateFrame.supportedModes, modeCatalog.codex);
    assert.equal(stateFrame.permissionMode, 'untrusted');

    ws.send({ type: 'chat:setPermissionMode', requestId: 'unsupported-1', mode: 'always-allow' });
    const rejected = await ws.next();
    assert.equal(rejected.type, 'permission_mode_change_failed');
    assert.equal(rejected.payload.requestId, 'unsupported-1');
    assert.equal(fixture.state.modeCalls.length, 0, 'unsupported modes never reach the runtime driver');

    const gate = deferred();
    fixture.state.modeGate = gate;
    ws.send({ type: 'chat:setPermissionMode', requestId: 'mode-1', mode: 'on-request' });
    while (fixture.state.modeCalls.length === 0) await wait();
    await wait(80);
    assert.equal(fixture.state.permissionMode, 'untrusted', 'server state stays on the confirmed mode while the driver is pending');

    let prematureFrame = null;
    const premature = ws.next(80).then(frame => { prematureFrame = frame; }).catch(() => {});
    await premature;
    assert.equal(prematureFrame, null, 'server does not broadcast success before driver confirmation');

    gate.resolve(true);
    const changed = await ws.next();
    assert.equal(changed.type, 'permission_mode_changed');
    assert.deepEqual(changed.payload, { requestId: 'mode-1', mode: 'on-request' });
    assert.equal(fixture.state.permissionMode, 'on-request');

    fixture.state.failModes.add('on-failure');
    ws.send({ type: 'chat:setPermissionMode', requestId: 'mode-2', mode: 'on-failure' });
    const failed = await ws.next();
    assert.equal(failed.type, 'permission_mode_change_failed');
    assert.equal(failed.payload.requestId, 'mode-2');
    assert.equal(failed.payload.mode, 'on-failure');
    assert.match(failed.payload.message, /rejected/i);
    assert.equal(fixture.state.permissionMode, 'on-request');
    ws.close();
  } finally {
    await fixture.close();
  }
});

test('AC-4 correlated approvals resolve once and ignore duplicate or stale request ids', async () => {
  const fixture = await setupChatServer({ runtime: 'opencode', permissionMode: 'ask' });
  try {
    const ws = await connectChatWs(fixture.wsUrl);
    assert.equal((await ws.next()).type, 'chat:state');
    fixture.state.pendingApprovals.add('approval-1');
    fixture.driver.emit({
      type: 'permission_request',
      payload: { requestId: 'approval-1', tool: 'Bash', input: { command: 'ls' } },
    });
    const request = await ws.next();
    assert.equal(request.type, 'permission_request');
    assert.equal(request.payload.requestId, 'approval-1');

    ws.send({ type: 'chat:approve', requestId: 'approval-1', decision: 'allow' });
    ws.send({ type: 'chat:approve', requestId: 'approval-1', decision: 'deny' });
    ws.send({ type: 'chat:approve', requestId: 'stale-approval', decision: 'allow' });
    await wait(80);
    assert.deepEqual(fixture.state.approvalResults, [
      { requestId: 'approval-1', decision: 'allow' },
    ]);
    ws.close();
  } finally {
    await fixture.close();
  }
});
