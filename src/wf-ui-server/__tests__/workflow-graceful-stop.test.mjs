import test from 'node:test';
import assert from 'node:assert/strict';
import { gracefulStopPty, registerPtyProcess, unregisterPtyProcess } from '../ws-terminal.mjs';

// Graceful stop contract (fake-PTY fixture, same style as ws-terminal.integration):
// claude/cc persist their transcript only on graceful exit, so the stop path
// writes `/exit\r` first, then Ctrl+C (`\x03`) after the grace period, and
// only hard-kills as the bounded fallback. codex/opencode persist their
// session state continuously and go straight to the hard kill.

/**
 * Fake node-pty process. Records writes/kills and exposes onExit + fireExit
 * so the graceful-stop sequence can be driven deterministically.
 */
function makeFakePty() {
  const state = {
    writes: [],
    kills: [],
    _exitHandlers: [],
    _exited: false,
    write(data) {
      state.writes.push(String(data));
    },
    kill() {
      state.kills.push(true);
    },
    onExit(handler) {
      if (state._exited) {
        queueMicrotask(() => handler({ exitCode: 0, signal: 0 }));
        return;
      }
      state._exitHandlers.push(handler);
    },
    fireExit() {
      if (state._exited) return;
      state._exited = true;
      const handlers = state._exitHandlers.splice(0);
      for (const handler of handlers) {
        queueMicrotask(() => handler({ exitCode: 0, signal: 0 }));
      }
    },
  };
  return state;
}

test('claude/cc graceful stop writes /exit then \\r; process exit after the writes means no kill', async () => {
  for (const runtime of ['claude', 'cc']) {
    const sessionId = `gs-exit-${runtime}`;
    const pty = makeFakePty();
    registerPtyProcess(sessionId, pty);

    const promise = gracefulStopPty(sessionId, { runtime });
    assert.deepEqual(pty.writes, ['/exit', '\r'],
      `${runtime} must write /exit then \\r before anything else`);
    assert.deepEqual(pty.kills, [], 'no kill may happen before the exit check');

    pty.fireExit();
    const result = await promise;

    assert.equal(result.killed, false, `${runtime} must not be killed after a graceful exit`);
    assert.equal(result.graceful, true, `${runtime} exit must count as graceful`);
    assert.deepEqual(pty.kills, [], `${runtime} kill must never be called`);
    unregisterPtyProcess(sessionId);
  }
});

test('claude stop sends Ctrl+C when /exit does not terminate, hard-kills as fallback, and stays bounded', async () => {
  const pty = makeFakePty();
  registerPtyProcess('gs-stuck', pty);

  const startedAt = Date.now();
  const result = await gracefulStopPty('gs-stuck', { runtime: 'claude' });
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(pty.writes.slice(0, 2), ['/exit', '\r'], '/exit then \\r must be written first');
  assert.ok(pty.writes.includes('\x03'), 'Ctrl+C must be written after the /exit grace period');
  assert.deepEqual(pty.kills, [true], 'hard kill must fire exactly once when the process stays alive');
  assert.equal(result.killed, true, 'still-alive process must be reported as killed');
  assert.equal(result.graceful, false, 'a hard-killed stop must not be reported graceful');
  assert.ok(elapsed <= 7000, `stop must stay bounded within ~7s (elapsed ${elapsed}ms)`);
  unregisterPtyProcess('gs-stuck');
});

test('codex and opencode stop kill directly without any exit writes', async () => {
  for (const runtime of ['codex', 'opencode']) {
    const sessionId = `gs-kill-${runtime}`;
    const pty = makeFakePty();
    registerPtyProcess(sessionId, pty);

    const result = await gracefulStopPty(sessionId, { runtime });

    assert.equal(result.killed, true, `${runtime} must be hard-killed`);
    assert.equal(result.graceful, false, `${runtime} stop is never graceful`);
    assert.deepEqual(pty.writes, [], `${runtime} must not receive /exit or Ctrl+C writes`);
    assert.deepEqual(pty.kills, [true], `${runtime} kill must fire exactly once`);
    unregisterPtyProcess(sessionId);
  }
});

test('graceful stop with no attached PTY resolves immediately without waiting', async () => {
  const startedAt = Date.now();
  const result = await gracefulStopPty('gs-missing', { runtime: 'claude' });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.killed, false, 'no pty attached means nothing was killed');
  assert.equal(result.graceful, false, 'no pty attached means no graceful exit happened');
  assert.ok(elapsed < 1000, `no-pty stop must not wait for the grace window (elapsed ${elapsed}ms)`);
});
