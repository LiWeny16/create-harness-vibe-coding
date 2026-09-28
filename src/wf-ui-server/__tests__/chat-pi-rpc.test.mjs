import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 901;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.signals = [];
    this.stdinChunks = [];
    this.stdin.on('data', (chunk) => this.stdinChunks.push(chunk));
  }

  kill(signal) {
    this.signals.push(signal);
    queueMicrotask(() => {
      this.emit('exit', null, signal);
      this.emit('close', null, signal);
    });
    return true;
  }

  pushRecord(value) {
    this.stdout.write(`${JSON.stringify(value)}\n`);
  }

  writtenRecords() {
    return Buffer.concat(this.stdinChunks)
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}

function fakeSpawnFactory() {
  const spawn = (command, args, options) => {
    spawn.calls.push({ command, args, options });
    spawn.last = new FakeChild();
    return spawn.last;
  };
  spawn.calls = [];
  return spawn;
}

async function makePiDriver(overrides = {}) {
  const { createPiRpcDriver } = await import('../drivers/pi-rpc.mjs');
  const events = [];
  const spawn = fakeSpawnFactory();
  const uuids = ['mode-request-1', 'mode-request-2', 'mode-request-3'];
  let uuidIndex = 0;
  const extensionPath = 'C:/workspace/extensions/pi-host-gate/index.ts';
  const driver = createPiRpcDriver({
    command: 'pi',
    args: [],
    cwd: 'C:/workspace',
    env: { HARNESS_TEST: '1' },
    extensionPath,
    permissionMode: 'ask',
    onEvent: (event) => events.push(event),
    _spawn: spawn,
    _uuid: () => uuids[uuidIndex++] || `mode-request-${uuidIndex}`,
    _graceMs: 10,
    _killGraceMs: 10,
    ...overrides,
  });
  return { driver, events, spawn, extensionPath };
}

describe('AC-4 Pi bundled permission gate over RPC', () => {
  it('launches Pi in RPC mode with the bundled host-gate extension', async () => {
    const { driver, spawn, extensionPath } = await makePiDriver();
    driver.start();

    assert.equal(spawn.calls.length, 1);
    assert.equal(spawn.calls[0].command, 'pi');
    assert.deepEqual(spawn.calls[0].args, [
      '--mode', 'rpc',
      '--extension', extensionPath,
    ]);
    assert.equal(spawn.calls[0].options.cwd, 'C:/workspace');
    assert.deepEqual(spawn.calls[0].options.env, { HARNESS_TEST: '1' });

    await driver.dispose();
  });

  it('confirms a permission-mode change only after its matching Pi prompt response', async () => {
    const { driver, spawn } = await makePiDriver();
    driver.start();

    const changed = driver.setPermissionMode('allow');
    await tick();
    assert.deepEqual(spawn.last.writtenRecords().at(-1), {
      id: 'mode-request-1',
      type: 'prompt',
      message: '/harness-permission-mode allow',
    });

    let settled = false;
    changed.then(() => { settled = true; }, () => { settled = true; });
    await tick();
    assert.equal(settled, false, 'the driver waits for runtime confirmation');

    spawn.last.pushRecord({
      id: 'mode-request-1',
      type: 'response',
      command: 'prompt',
      success: true,
      data: { disposition: 'handled' },
    });
    assert.equal(await changed, true);

    const failed = driver.setPermissionMode('deny');
    await tick();
    spawn.last.pushRecord({
      id: 'unrelated-request',
      type: 'response',
      command: 'prompt',
      success: true,
      data: { disposition: 'handled' },
    });
    let failureSettled = false;
    failed.then(() => { failureSettled = true; }, () => { failureSettled = true; });
    await tick();
    assert.equal(failureSettled, false, 'an unrelated response must not settle this change');

    spawn.last.pushRecord({
      id: 'mode-request-2',
      type: 'response',
      command: 'prompt',
      success: false,
      data: { disposition: 'rejected' },
      error: 'unsupported by installed extension',
    });
    await assert.rejects(failed, /unsupported|rejected/i);
    await assert.rejects(driver.setPermissionMode('full-access'), /unsupported|permission mode/i);

    await driver.dispose();
  });

  it('maps each ask-mode confirm id to one canonical request and correlated allow/deny RPC replies', async () => {
    const { driver, events, spawn } = await makePiDriver();
    driver.start();
    const child = spawn.last;

    child.pushRecord({
      type: 'extension_ui_request',
      id: 'pi-confirm-allow',
      method: 'confirm',
      title: 'Permission required',
      message: 'Bash: list the workspace',
    });
    child.pushRecord({
      type: 'extension_ui_request',
      id: 'pi-confirm-deny',
      method: 'confirm',
      title: 'Permission required',
      message: 'Bash: remove a file',
    });
    await tick();

    const requests = events.filter((event) => event.type === 'permission_request');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].payload.requestId, 'pi-confirm-allow');
    assert.equal(requests[1].payload.requestId, 'pi-confirm-deny');
    assert.equal(typeof requests[0].payload.tool, 'string');
    assert.ok(requests[0].payload.input !== undefined);

    assert.equal(driver.approve('pi-confirm-allow', 'allow'), true);
    assert.equal(driver.approve('pi-confirm-deny', 'deny'), true);
    assert.equal(driver.approve('pi-confirm-allow', 'deny'), false, 'a settled request cannot be answered twice');
    assert.equal(driver.approve('pi-confirm-stale', 'allow'), false, 'unknown request ids are ignored');

    assert.deepEqual(child.writtenRecords().slice(-2), [
      { type: 'extension_ui_response', id: 'pi-confirm-allow', confirmed: true },
      { type: 'extension_ui_response', id: 'pi-confirm-deny', confirmed: false },
    ]);
    await driver.dispose();
  });
});
