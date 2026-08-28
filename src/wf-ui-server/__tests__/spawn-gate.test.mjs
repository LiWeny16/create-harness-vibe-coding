import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpawnGate } from '../spawn-gate.mjs';

// Spawn-gate contract: a sliding window over concurrent spawns; FIFO waiters;
// slots always released (success, error, or timeout).

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('T1 window cap: maxConcurrent run at once, the rest wait FIFO', async () => {
  const gate = createSpawnGate({ maxConcurrent: 2, timeoutMs: 5000 });
  const blockers = [deferred(), deferred(), deferred(), deferred()];
  const order = [];

  const run = async (i) => gate(() => {
    order.push(`run-${i}`);
    return blockers[i].promise;
  });

  const p1 = run(0); // slot 1
  const p2 = run(1); // slot 2
  await sleep(20);
  const p3 = run(2); // queued
  const p4 = run(3); // queued
  await sleep(20);

  assert.deepEqual(order, ['run-0', 'run-1']); // third+fourth not started

  blockers[0].resolve('a');
  assert.equal(await p1, 'a');
  await sleep(10);
  assert.deepEqual(order, ['run-0', 'run-1', 'run-2']); // FIFO: 2 enters next

  blockers[1].resolve('b');
  assert.equal(await p2, 'b');
  await sleep(10);
  assert.deepEqual(order, ['run-0', 'run-1', 'run-2', 'run-3']);

  blockers[2].resolve('c');
  blockers[3].resolve('d');
  assert.equal(await p3, 'c');
  assert.equal(await p4, 'd');
});

test('T2 rejection releases the slot; the next waiter proceeds', async () => {
  const gate = createSpawnGate({ maxConcurrent: 1, timeoutMs: 5000 });
  const blocker = deferred();
  const p1 = gate(() => blocker.promise);
  await sleep(10);
  const p2 = gate(() => 'second-ok');

  blocker.reject(new Error('boom'));
  await assert.rejects(p1, /boom/);
  assert.equal(await p2, 'second-ok'); // p2 entered after p1's slot freed
});

test('T3 a hung spawn times out: caller errors and the slot frees', async () => {
  const gate = createSpawnGate({ maxConcurrent: 1, timeoutMs: 40 });
  const hung = deferred();
  const p1 = gate(() => hung.promise);
  await assert.rejects(p1, /timed out after 40ms/);
  const p2 = gate(() => 'after-timeout');
  assert.equal(await p2, 'after-timeout');
  hung.resolve('late'); // background settlement must not break anything
});

test('T4 the result of the gated fn passes through untouched', async () => {
  const gate = createSpawnGate({ maxConcurrent: 2, timeoutMs: 5000 });
  assert.deepEqual(await gate(() => ({ ok: 1 })), { ok: 1 });
  assert.equal(await gate(() => 42), 42);
});
