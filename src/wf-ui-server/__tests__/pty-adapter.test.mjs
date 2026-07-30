import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolvePtyCommand, spawnPty } from '../pty-adapter.mjs';

test('spawnPty validates runtime before any PTY operation', async () => {
  await assert.rejects(
    () => spawnPty({
      runtime: 'unknown-runtime',
      taskId: 'task-test',
      peerId: 'unknown-001',
      projectRoot: process.cwd(),
      cols: 120,
      rows: 32,
      onData: () => {},
      onExit: () => {},
    }),
    { name: 'Error' }
  );
});

test('spawnPty with runtime fake-agent throws', async () => {
  await assert.rejects(
    () => spawnPty({
      runtime: 'fake-agent',
      taskId: 'task-test',
      peerId: 'fake-001',
      projectRoot: process.cwd(),
      cols: 120,
      rows: 32,
      onData: () => {},
      onExit: () => {},
    }),
    { name: 'Error', message: /Invalid runtime.*fake-agent/ }
  );
});

test('spawnPty reports blocked when command path cannot be spawned', async () => {
  const missingCommand = path.join(process.cwd(), 'missing-runtime-command.exe');
  const result = await spawnPty({
    runtime: 'claude',
    taskId: 'task-test',
    peerId: 'claude-001',
    projectRoot: process.cwd(),
    command: missingCommand,
    cols: 120,
    rows: 32,
    onData: () => {},
    onExit: () => {},
  });

  assert.equal(result.blocked, true);
  assert.ok(result.reason === 'runtime-spawn-failed' || result.reason === 'pty-adapter-missing');
  assert.ok(result.hint);
});

test('resolvePtyCommand uses split cmd call for Windows command wrappers', () => {
  const commandPath = 'C:\\Program Files\\Harness Agents\\agent.cmd';
  const args = ['--model', 'two words'];
  const resolved = resolvePtyCommand(commandPath, args);

  if (process.platform !== 'win32') {
    assert.deepEqual(resolved, { executable: commandPath, args });
    return;
  }

  assert.equal(resolved.executable, 'cmd.exe');
  assert.deepEqual(resolved.args, ['/d', '/c', 'call', commandPath, ...args]);
  assert.doesNotMatch(resolved.args.join('\n'), /\\"/);
});
