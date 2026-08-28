import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCodexAppServerDriver } from '../drivers/codex-appserver.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeChild extends EventEmitter {
  constructor({ stubborn = false } = {}) {
    super();
    this.pid = 4321;
    this.kills = [];
    this.exitCode = null;
    this.signalCode = null;
    this.stubborn = stubborn;
    const stdinWrites = [];
    this.stdin = {
      writes: stdinWrites,
      ended: false,
      write: (chunk) => {
        stdinWrites.push(String(chunk));
      },
      end: () => {
        this.ended = true;
      },
    };
    this.stdout = new EventEmitter();
    this.stdout.write = (text) => {
      this.stdout.emit('data', Buffer.isBuffer(text) ? text : Buffer.from(String(text)));
    };
    this.stderr = new EventEmitter();
    this.stderr.write = this.stdout.write;
  }

  kill(signal) {
    this.kills.push(signal ?? 'SIGTERM');
    if (this.stubborn && signal !== 'SIGKILL') return false;
    this.exitCode = 0;
    queueMicrotask(() => this.emit('exit', 0, signal ?? 'SIGTERM'));
    return true;
  }

  sentLines() {
    return this.stdin.writes
      .join('')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  feed(payload) {
    const text =
      typeof payload === 'string' ? payload : JSON.stringify(payload) + '\n';
    this.stdout.write(text);
  }
}

function setup({ providerSessionId = null, child = new FakeChild(), ...opts } = {}) {
  const envelopes = [];
  const driver = createCodexAppServerDriver({
    onEvent: (envelope) => envelopes.push(envelope),
    _spawn: () => child,
    providerSessionId,
    ...opts,
  });
  const types = () => envelopes.map((e) => e.type);
  return { driver, child, envelopes, types };
}

async function bootToReady({ driver, child }) {
  const started = driver.start();
  await tick();
  const initLine = child.sentLines()[0];
  assert.equal(initLine.method, 'initialize');
  child.feed({ jsonrpc: '2.0', id: initLine.id, result: {} });
  await tick();
  const lines = child.sentLines();
  assert.equal(lines[1].method, 'initialized');
  const threadLine = lines[2];
  child.feed({
    jsonrpc: '2.0',
    id: threadLine.id,
    result:
      threadLine.method === 'thread/start'
        ? { threadId: 'th_abc' }
        : { ok: true },
  });
  await started;
  return lines;
}

test('handshake ordering: initialize result gates initialized + readiness', async () => {
  const { driver, child, envelopes, types } = setup();
  const started = driver.start();
  await tick();

  const before = child.sentLines();
  assert.equal(before.length, 1);
  assert.equal(before[0].jsonrpc, '2.0');
  assert.equal(before[0].id, 1);
  assert.deepEqual(before[0].params.capabilities, { experimentalApi: true });
  assert.ok(before[0].params.clientInfo.name);

  assert.ok(!types().includes('session_ready'));

  driver.send('early message');
  assert.equal(child.sentLines().length, 1, 'queued send must not write pre-ready');

  child.feed({ jsonrpc: '2.0', id: 1, result: {} });
  await tick();

  const lines = child.sentLines();
  assert.equal(lines[1].method, 'initialized');
  assert.equal(lines[1].id, undefined, 'initialized is a notification (no id)');
  assert.equal(lines[2].method, 'thread/start');

  child.feed({ jsonrpc: '2.0', id: lines[2].id, result: { thread: { id: 'th_abc' } } });
  const res = await started;
  assert.equal(res.pid, 4321);

  const ready = envelopes.find((e) => e.type === 'session_ready');
  assert.equal(ready.data.providerSessionId, 'th_abc');
  assert.equal(ready.data.resumed, false);
  assert.equal(ready.seq, 3, 'seq starts at 1 and counts raw envelopes');

  const turnCall = child.sentLines()[3];
  assert.equal(turnCall.method, 'turn/start');
  assert.deepEqual(turnCall.params.input, [{ type: 'text', text: 'early message' }]);
});

test('thread/resume selected when providerSessionId provided', async () => {
  const { driver, child, envelopes } = setup({ providerSessionId: 'th_old' });
  const lines = await bootToReady({ driver, child });

  assert.equal(lines[2].method, 'thread/resume');
  assert.deepEqual(lines[2].params, { threadId: 'th_old' });
  const ready = envelopes.find((e) => e.type === 'session_ready');
  assert.equal(ready.data.providerSessionId, 'th_old');
  assert.equal(ready.data.resumed, true);
  assert.ok(!child.sentLines().some((l) => l.method === 'thread/start'));
});

test('send payload shape, turn_started, and steer routing mid-turn', async () => {
  const { driver, child, envelopes } = setup();
  await bootToReady({ driver, child });

  driver.send('hello world', { input: [{ type: 'text', text: 'prefix' }] });
  await tick();
  let lines = child.sentLines();
  const turnCall = lines[lines.length - 1];
  assert.equal(turnCall.method, 'turn/start');
  assert.deepEqual(turnCall.params, {
    threadId: 'th_abc',
    input: [
      { type: 'text', text: 'prefix' },
      { type: 'text', text: 'hello world' },
    ],
  });

  child.feed({ jsonrpc: '2.0', id: turnCall.id, result: {} });
  await tick();
  assert.ok(envelopes.some((e) => e.type === 'turn_started' && e.data.threadId === 'th_abc'));

  driver.send('mid-turn followup');
  await tick();
  lines = child.sentLines();
  const steerCall = lines[lines.length - 1];
  assert.equal(steerCall.method, 'turn/steer');
  assert.deepEqual(steerCall.params.input, [{ type: 'text', text: 'mid-turn followup' }]);

  driver.steer('explicit steer');
  await tick();
  lines = child.sentLines();
  const explicitSteer = lines[lines.length - 1];
  assert.equal(explicitSteer.method, 'turn/steer');
  assert.equal(explicitSteer.params.input[0].text, 'explicit steer');
});

test('text-delta and reasoning notifications map to canonical deltas', async () => {
  const { driver, child, envelopes, types } = setup();
  await bootToReady({ driver, child });

  child.feed({
    jsonrpc: '2.0',
    method: 'item/delta',
    params: { threadId: 'th_abc', item: { type: 'agentMessage', text: 'Hel' } },
  });
  child.feed({
    jsonrpc: '2.0',
    method: 'item/delta',
    params: { item: { type: 'reasoning', text: 'thinking...' } },
  });
  child.feed({
    jsonrpc: '2.0',
    method: 'codex/event/reasoning_delta',
    params: { delta: 'r1' },
  });

  const textDelta = envelopes.find((e) => e.type === 'text_delta');
  assert.equal(textDelta.data.text, 'Hel');
  const thinking = envelopes.filter((e) => e.type === 'thinking_delta');
  assert.equal(thinking.length, 2);
  assert.deepEqual(thinking.map((e) => e.data.text), ['thinking...', 'r1']);

  for (let i = 1; i < envelopes.length; i++) {
    assert.ok(envelopes[i].seq > envelopes[i - 1].seq);
  }
  assert.ok(types().filter((t) => t === 'raw').length >= 4);
});

test('exec begin/end notifications map to tool_call_start/end', async () => {
  const { driver, child, envelopes } = setup();
  await bootToReady({ driver, child });

  child.feed({
    jsonrpc: '2.0',
    method: 'item/started',
    params: { item: { type: 'commandExecution', id: 'c1', command: 'npm test' } },
  });
  child.feed({
    jsonrpc: '2.0',
    method: 'item/completed',
    params: { item: { type: 'commandExecution', id: 'c1', exitCode: 0 } },
  });
  child.feed({ jsonrpc: '2.0', method: 'exec/begin', params: { command: 'ls -la' } });
  child.feed({ jsonrpc: '2.0', method: 'exec/end', params: { exitCode: 0 } });

  const starts = envelopes.filter((e) => e.type === 'tool_call_start');
  const ends = envelopes.filter((e) => e.type === 'tool_call_end');
  assert.equal(starts.length, 2);
  assert.equal(starts[0].data.itemId, 'c1');
  assert.equal(starts[0].data.command, 'npm test');
  assert.equal(starts[1].data.command, 'ls -la');
  assert.equal(ends.length, 2);
  assert.equal(ends[0].data.item?.exitCode, 0);
});

test('server approval request -> permission_request -> approve writes response with same id', async () => {
  const { driver, child, envelopes } = setup();
  await bootToReady({ driver, child });

  child.feed({
    jsonrpc: '2.0',
    id: 77,
    method: 'execCommandApproval',
    params: { command: 'rm -rf build', cwd: '/repo' },
  });

  const perm = envelopes.find((e) => e.type === 'permission_request');
  assert.equal(perm.data.requestId, 77);
  assert.equal(perm.data.method, 'execCommandApproval');
  assert.equal(perm.data.payload.command, 'rm -rf build');

  driver.approve(77, { decision: 'approved' });
  const lines = child.sentLines();
  const response = lines[lines.length - 1];
  assert.deepEqual(response, {
    jsonrpc: '2.0',
    id: 77,
    result: { decision: 'approved' },
  });
  const resolved = envelopes.find((e) => e.type === 'permission_resolved');
  assert.equal(resolved.data.requestId, 77);
  assert.deepEqual(resolved.data.result, { decision: 'approved' });

  child.feed({ jsonrpc: '2.0', id: 78, method: 'unknownServerThing', params: {} });
  await tick();
  const errResponse = child.sentLines()[child.sentLines().length - 1];
  assert.equal(errResponse.id, 78);
  assert.equal(errResponse.error.code, -32601);
  assert.ok(!envelopes.some((e) => e.type === 'permission_request' && e.data.requestId === 78));

  child.feed({ jsonrpc: '2.0', method: 'totallyUnknownEvent', params: {} });
  await tick();
  assert.equal(envelopes[envelopes.length - 1].type, 'raw');
});

test('interrupt sends turn/interrupt and resolves on response', async () => {
  const { driver, child } = setup();
  await bootToReady({ driver, child });

  const pending = driver.interrupt();
  await tick();
  const lines = child.sentLines();
  const interruptCall = lines[lines.length - 1];
  assert.equal(interruptCall.method, 'turn/interrupt');
  assert.deepEqual(interruptCall.params, { threadId: 'th_abc' });

  child.feed({ jsonrpc: '2.0', id: interruptCall.id, result: {} });
  await pending;
});

test('task_complete/task_failed mark turn_ended + done; next send starts new turn', async () => {
  const { driver, child, envelopes, types } = setup();
  await bootToReady({ driver, child });

  driver.send('go');
  await tick();
  const lines = child.sentLines();
  const turnCall = lines[lines.length - 1];
  child.feed({ jsonrpc: '2.0', id: turnCall.id, result: {} });
  await tick();

  child.feed({
    jsonrpc: '2.0',
    method: 'task_complete',
    params: { usage: { tokens: 42 } },
  });

  const endedIdx = types().indexOf('turn_ended');
  const doneIdx = types().indexOf('done');
  assert.ok(endedIdx !== -1 && doneIdx === endedIdx + 1);
  assert.equal(envelopes[endedIdx].data.status, 'ok');
  assert.deepEqual(envelopes[endedIdx].data.usage, { tokens: 42 });

  driver.send('second round');
  await tick();
  const secondTurn = child.sentLines()[child.sentLines().length - 1];
  assert.equal(secondTurn.method, 'turn/start');
  child.feed({ jsonrpc: '2.0', id: secondTurn.id, result: {} });
  await tick();

  child.feed({ jsonrpc: '2.0', method: 'task_failed', params: { error: 'boom' } });
  const failedEnds = envelopes.filter((e) => e.type === 'turn_ended' && e.data.status === 'failed');
  assert.equal(failedEnds.length, 1);
  const dones = envelopes.filter((e) => e.type === 'done');
  assert.equal(dones.length, 2);
});

test('dispose ladder: SIGTERM then SIGKILL for stubborn child; rejects pending and blocks sends', async () => {
  const normal = setup();
  await bootToReady(normal);
  const stuckInterrupt = normal.driver.interrupt().catch((err) => err);
  await tick();
  await normal.driver.dispose();
  const err = await stuckInterrupt;
  assert.match(err.message, /disposed/);
  assert.throws(() => normal.driver.send('after dispose'), /disposed/);
  assert.deepEqual(normal.child.kills, ['SIGTERM']);
  const last = normal.envelopes[normal.envelopes.length - 1];
  assert.equal(last.type, 'done');
  assert.equal(last.data.reason, 'disposed');

  const stubbornChild = new FakeChild({ stubborn: true });
  const stubborn = setup({ child: stubbornChild });
  await bootToReady(stubborn);
  await stubborn.driver.dispose({ graceMs: 15 });
  assert.deepEqual(stubbornChild.kills, ['SIGTERM', 'SIGKILL']);
});

test('malformed line tolerance and oversized-line guard keep stream alive', async () => {
  const { driver, child, envelopes } = setup();
  await bootToReady({ driver, child });

  child.feed('### not json at all\n');
  child.feed({
    jsonrpc: '2.0',
    method: 'item/delta',
    params: { delta: 'still alive' },
  });

  const malformed = envelopes.find((e) => e.type === 'error');
  assert.equal(malformed.data.code, 'malformed_line');
  assert.ok(
    envelopes.some((e) => e.type === 'raw' && e.data.line.includes('not json')),
  );
  assert.ok(envelopes.some((e) => e.type === 'text_delta' && e.data.text === 'still alive'));

  const guarded = setup({ maxLineBytes: 32 });
  await bootToReady(guarded);
  guarded.child.feed('a'.repeat(64));
  guarded.child.feed('\n{"jsonrpc":"2.0","method":"item/delta","params":{"delta":"ok"}}\n');

  const overflow = guarded.envelopes.find((e) => e.type === 'error');
  assert.equal(overflow.data.code, 'line_overflow');
  assert.ok(
    guarded.envelopes.some(
      (e) => e.type === 'text_delta' && e.data.text === 'ok',
    ),
  );
});

test('pending requests reject with timeout errors', async () => {
  const fresh = setup({ requestTimeoutMs: 25 });
  await bootToReady(fresh);
  const interrupted = fresh.driver.interrupt().catch((err) => err);
  const err = await interrupted;
  assert.equal(err.code, 'ETIMEDOUT');
  assert.match(err.message, /timed out/);
});
