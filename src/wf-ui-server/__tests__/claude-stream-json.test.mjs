import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createClaudeDriver } from '../drivers/claude-stream-json.mjs';

const tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

let fakePidSeq = 0;

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = ++fakePidSeq;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.signals = [];
    this.stdinChunks = [];
    this.stdinEnded = false;
    this.exitCode = null;
    this.signalCode = null;
    this.forceAlive = false;
    this.finished = false;
    this.stdin.on('data', (chunk) => this.stdinChunks.push(chunk));
    const origEnd = this.stdin.end.bind(this.stdin);
    this.stdin.end = (...rest) => {
      this.stdinEnded = true;
      return origEnd(...rest);
    };
  }

  kill(signal) {
    this.signals.push(signal);
    if (this.forceAlive && signal !== 'SIGKILL') return false;
    this.finish(signal === 'SIGKILL' ? 'SIGKILL' : signal, null);
    return true;
  }

  finish(code, signal) {
    if (this.finished) return;
    this.finished = true;
    this.exitCode = code;
    this.signalCode = signal;
    queueMicrotask(() => {
      this.emit('exit', code, signal);
      this.emit('close', code, signal);
    });
  }

  pushLine(value) {
    const line = typeof value === 'string' ? value : JSON.stringify(value);
    this.stdout.write(line + '\n');
  }

  writtenLines() {
    return Buffer.concat(this.stdinChunks)
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}

function fakeSpawnFactory() {
  const spawnFn = (cmd, args, opts) => {
    spawnFn.calls.push({ cmd, args, opts });
    spawnFn.last = new FakeChild();
    spawnFn.children.push(spawnFn.last);
    return spawnFn.last;
  };
  spawnFn.calls = [];
  spawnFn.children = [];
  return spawnFn;
}

function makeHarness(driverOptions = {}, spawnFn = fakeSpawnFactory()) {
  const events = [];
  const driver = createClaudeDriver({
    command: 'claude',
    args: [],
    cwd: '/tmp/proj',
    env: { HARNESS_TEST: '1' },
    onEvent: (event) => events.push(event),
    _spawn: spawnFn,
    _graceMs: 10,
    _killGraceMs: 10,
    ...driverOptions,
  });
  const canonical = () => events.filter((event) => event.type !== 'raw');
  const raws = () => events.filter((event) => event.type === 'raw');
  return { driver, events, canonical, raws, spawnFn };
}

describe('claude-stream-json driver', () => {
  it('maps a scripted frame sequence to canonical envelopes with monotonic seq', async () => {
    const { driver, events, canonical, raws, spawnFn } = makeHarness();
    const started = driver.start();
    assert.equal(typeof started.pid, 'number');
    const child = spawnFn.last;

    child.pushLine({ type: 'system', subtype: 'init', session_id: 's-init' });
    child.pushLine({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
    });
    child.pushLine({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
    });
    child.pushLine({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello world' },
          { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    });
    child.pushLine({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }],
      },
    });
    child.pushLine({
      type: 'result',
      subtype: 'success',
      session_id: 's-init',
      result: 'final',
      num_turns: 2,
    });
    await tick();

    const types = canonical().map((e) => e.type);
    assert.deepEqual(types, [
      'session_ready',
      'turn_started',
      'text_delta',
      'thinking_delta',
      'text_delta',
      'tool_call_start',
      'tool_call_end',
      'turn_ended',
      'done',
    ]);
    const payloads = Object.fromEntries(
      canonical().map((e, i) => [`${e.type}#${i}`, e.payload])
    );
    assert.equal(canonical()[0].payload.sessionId, 's-init');
    assert.equal(canonical()[2].payload.delta, 'Hel');
    assert.equal(canonical()[3].payload.delta, 'hmm');
    assert.equal(canonical()[4].payload.delta, 'Hello world');
    assert.deepEqual(canonical()[5].payload, {
      callId: 'tu_1',
      name: 'Bash',
      input: { command: 'ls' },
    });
    assert.deepEqual(canonical()[6].payload, { callId: 'tu_1', isError: false });

    // seq starts at 1 and is strictly monotonic across ALL envelopes (raw included).
    assert.equal(events[0].seq, 1);
    for (let i = 0; i < events.length; i++) {
      assert.equal(events[i].seq, i + 1);
      assert.match(events[i].ts, /^\d{4}-\d{2}-\d{2}T/);
    }
    assert.equal(raws().length, 6);
    assert.ok(raws().every((r) => typeof r.payload.data === 'string'));

    await driver.dispose();
  });

  it('passes fresh args through, appends --model once, and emits session_ready immediately', async () => {
    const spawnFn = fakeSpawnFactory();
    const args = ['--session-id', '11111111-2222-3333-4444-555555555555', '--verbose'];
    const { driver, events, canonical, spawnFn: fn } = makeHarness(
      { args, model: 'opus' },
      spawnFn
    );
    driver.start();

    const call = fn.calls[0];
    assert.equal(call.cmd, 'claude');
    assert.deepEqual(call.args, [...args, '--model', 'opus']);
    assert.equal(call.opts.windowsHide, true);
    assert.deepEqual(call.opts.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(call.opts.cwd, '/tmp/proj');
    assert.deepEqual(call.opts.env, { HARNESS_TEST: '1' });

    await tick();
    const first = canonical()[0];
    assert.equal(first.type, 'session_ready');
    assert.equal(first.seq, 1);
    assert.equal(first.payload.sessionId, '11111111-2222-3333-4444-555555555555');

    // model dedupe: appending again must not duplicate
    const again = makeHarness({ args: [...args, '--model', 'sonnet'], model: 'sonnet' }, spawnFn);
    again.driver.start();
    assert.deepEqual(again.spawnFn.calls[1].args, [...args, '--model', 'sonnet']);
    await again.driver.dispose();
    void events;
    await driver.dispose();
  });

  it('resume mode: args untouched and session_ready deferred to result frame', async () => {
    const { driver, canonical, spawnFn } = makeHarness({
      args: ['--resume', 'sess_abc'],
      providerSessionId: 'sess_abc',
    });
    driver.start();
    assert.deepEqual(spawnFn.calls[0].args, ['--resume', 'sess_abc']);
    await tick();
    assert.equal(canonical().filter((e) => e.type === 'session_ready').length, 0);

    spawnFn.last.pushLine({
      type: 'result',
      subtype: 'success',
      session_id: 'sess_abc',
      result: 'done text',
    });
    await tick();
    const readyIndex = canonical().findIndex((e) => e.type === 'session_ready');
    assert.notEqual(readyIndex, -1);
    assert.equal(canonical()[readyIndex].payload.sessionId, 'sess_abc');
    const tailTypes = canonical().slice(readyIndex).map((e) => e.type);
    assert.deepEqual(tailTypes, ['session_ready', 'turn_ended', 'done']);
    assert.equal(canonical().at(-1).payload.reason, 'result');
    assert.equal(canonical().at(-1).payload.result, 'done text');
    await driver.dispose();
  });

  it('send/steer write user turn JSONL on stdin', async () => {
    const { driver, spawnFn } = makeHarness();
    driver.start();
    assert.equal(driver.send('hi'), true);
    assert.equal(driver.steer('go'), true);
    const lines = spawnFn.last.writtenLines();
    assert.deepEqual(lines[0], {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    });
    assert.deepEqual(lines[1], {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'go' }] },
    });
    await driver.dispose();
  });

  it('can_use_tool round-trip writes correct control_response JSONL', async () => {
    const { driver, canonical, spawnFn } = makeHarness();
    driver.start();
    const child = spawnFn.last;

    child.pushLine({
      type: 'control_request',
      request_id: 'req_1',
      subtype: 'can_use_tool',
      tool_name: 'Bash',
      input: { command: 'rm -rf /' },
    });
    await tick();
    const perm = canonical().find((e) => e.type === 'permission_request');
    assert.deepEqual(perm.payload, {
      requestId: 'req_1',
      toolName: 'Bash',
      input: { command: 'rm -rf /' },
    });

    assert.equal(driver.approve('req_1', 'allow'), true);
    let lines = child.writtenLines();
    assert.deepEqual(lines.at(-1), {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req_1',
        response: { behavior: 'allow' },
      },
    });

    driver.approve('req_2', { behavior: 'deny' });
    lines = child.writtenLines();
    assert.deepEqual(lines.at(-1).response.response, { behavior: 'deny' });

    driver.approve('req_3', { behavior: 'allow', updatedInput: { command: 'safe' } });
    lines = child.writtenLines();
    assert.deepEqual(lines.at(-1).response.response, {
      behavior: 'allow',
      updatedInput: { command: 'safe' },
    });

    // Liberal parsing: nested request shape also handled.
    child.pushLine({
      type: 'control_request',
      request_id: 'req_n',
      request: { subtype: 'can_use_tool', tool_name: 'Write', input: { path: 'a' } },
    });
    await tick();
    const permN = canonical().filter((e) => e.type === 'permission_request').at(-1);
    assert.equal(permN.payload.requestId, 'req_n');
    assert.equal(permN.payload.toolName, 'Write');
    await driver.dispose();
  });

  it('interrupt writes control_request frame with uuid request_id', async () => {
    const { driver, spawnFn } = makeHarness();
    driver.start();
    assert.equal(driver.interrupt(), true);
    const line = spawnFn.last.writtenLines()[0];
    assert.equal(line.type, 'control_request');
    assert.equal(line.subtype, 'interrupt');
    assert.match(line.request_id, /^[0-9a-f-]{36}$/);
    await driver.dispose();
  });

  it('tolerates malformed lines and buffers partial lines', async () => {
    const { driver, canonical, raws, spawnFn } = makeHarness();
    driver.start();
    const child = spawnFn.last;
    child.stdout.write('{"type":"assistant","mess');
    child.stdout.write('age":{"content":[{"type":"text","text":"hi"}]}}\n');
    child.stdout.write('oops not json {{{\n');
    child.pushLine({ type: 'result', subtype: 'success', session_id: 's9' });
    await tick();

    assert.equal(raws().length, 3);
    assert.deepEqual(
      canonical()
        .filter((e) => e.type === 'text_delta')
        .map((e) => e.payload.delta),
      ['hi']
    );
    assert.ok(canonical().some((e) => e.type === 'session_ready'));
    assert.ok(canonical().some((e) => e.type === 'done'));
    await driver.dispose();
  });

  it('dispose: ends stdin, SIGTERM resolves, escalates to SIGKILL when child survives', async () => {
    // Happy ladder: SIGTERM terminates.
    const a = makeHarness();
    a.driver.start();
    await a.driver.dispose();
    assert.equal(a.spawnFn.last.stdinEnded, true);
    assert.deepEqual(a.spawnFn.last.signals, ['SIGTERM']);

    // Forced ladder: child survives SIGTERM until SIGKILL.
    const b = makeHarness();
    b.driver.start();
    b.spawnFn.last.forceAlive = true;
    const sendAfterDispose = () => b.driver.send('late');
    await b.driver.dispose();
    assert.deepEqual(b.spawnFn.last.signals, ['SIGTERM', 'SIGKILL']);
    assert.equal(sendAfterDispose(), false);

    // Idempotent.
    await b.driver.dispose();
  });

  it('emits error on spawn failure and done on close without result', async () => {
    const { driver, canonical, spawnFn } = makeHarness();
    driver.start();
    const failure = new Error('spawn claude ENOENT');
    failure.code = 'ENOENT';
    spawnFn.last.emit('error', failure);
    spawnFn.last.finish(null, 'SIGTERM');
    await tick();
    const errEvent = canonical().find((e) => e.type === 'error');
    assert.equal(errEvent.payload.stage, 'process');
    assert.match(errEvent.payload.message, /ENOENT/);
    const doneEvent = canonical().find((e) => e.type === 'done');
    assert.equal(doneEvent.payload.reason, 'exit');
    assert.equal(doneEvent.payload.signal, 'SIGTERM');
    await driver.dispose();
  });

  it('AskUserQuestion tool_use additionally emits user_ask', async () => {
    const { driver, canonical, spawnFn } = makeHarness();
    driver.start();
    spawnFn.last.pushLine({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_ask',
            name: 'AskUserQuestion',
            input: { questions: [{ question: 'Which?' }] },
          },
        ],
      },
    });
    await tick();
    const ask = canonical().find((e) => e.type === 'user_ask');
    assert.equal(ask.payload.callId, 'tu_ask');
    assert.equal(ask.payload.name, 'AskUserQuestion');
    await driver.dispose();
  });
});
