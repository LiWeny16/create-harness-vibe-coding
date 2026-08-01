import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolvePtyCommand, spawnPty, windowsPtyOptions } from '../pty-adapter.mjs';
import {
  CODEX_UPDATE_SKIP_SESSION_KEYS,
  CODEX_UPDATE_SKIP_UNTIL_NEXT_VERSION_KEYS,
  codexUpdatePromptControlEnabled,
  codexUpdatePromptInputForChoice,
  createCodexUpdatePromptDetector,
  isCodexUpdatePrompt,
} from '../codex-update-prompt.mjs';

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

test('windowsPtyOptions uses bundled ConPTY cleanup path on Windows', () => {
  const previous = process.env.HARNESS_WF_UI_USE_SYSTEM_CONPTY;
  delete process.env.HARNESS_WF_UI_USE_SYSTEM_CONPTY;
  const options = windowsPtyOptions();
  try {
    if (process.platform !== 'win32') {
      assert.deepEqual(options, {});
      return;
    }

    assert.equal(options.useConpty, true);
    assert.equal(options.useConptyDll, true);
  } finally {
    if (previous === undefined) delete process.env.HARNESS_WF_UI_USE_SYSTEM_CONPTY;
    else process.env.HARNESS_WF_UI_USE_SYSTEM_CONPTY = previous;
  }
});

test('codex update prompt detector detects the menu once without choosing for the user', () => {
  const makeMenu = (from, to) => [
    `\x1b[1mUpdate available! ${from} -> ${to}`,
    '',
    '  Release notes: https://github.com/openai/codex/releases/latest',
    '  1. Update now (runs `pnpm add -g @openai/codex`)',
    '  2. Skip',
    '  3. Skip until next version',
    '',
    '  Press enter to continue',
  ].join('\r\n');

  for (let index = 0; index < 3; index += 1) {
    const from = `0.${140 + index}.${4 + index}`;
    const to = `0.${146 + index}.${index}`;
    const menu = makeMenu(from, to);
    const detector = createCodexUpdatePromptDetector();

    assert.equal(detector.observe(menu.slice(0, 42)), null);
    const action = detector.observe(menu.slice(42));

    assert.equal(action.reason, 'codex-update-prompt');
    assert.equal(action.type, 'codex:update-prompt');
    assert.equal(detector.observe(menu), null);
  }
});

test('codex update prompt detection, choice mapping, and env guard are conservative', () => {
  const dynamicVersionMenu = [
    'Update available! older-build -> newer-build',
    'Release notes: x',
    '3. Skip until next version',
    'Press enter to continue',
  ].join('\n');
  assert.equal(isCodexUpdatePrompt('Update available! older-build -> newer-build'), false);
  assert.equal(isCodexUpdatePrompt(dynamicVersionMenu), true);
  assert.equal(codexUpdatePromptControlEnabled({}), true);
  assert.equal(codexUpdatePromptControlEnabled({ HARNESS_CODEX_UPDATE_PROMPT: 'manual' }), false);
  assert.equal(codexUpdatePromptControlEnabled({ HARNESS_CODEX_UPDATE_PROMPT: 'passthrough' }), false);
  assert.equal(codexUpdatePromptInputForChoice('skip-session'), CODEX_UPDATE_SKIP_SESSION_KEYS);
  assert.equal(codexUpdatePromptInputForChoice('skip-until-next-version'), CODEX_UPDATE_SKIP_UNTIL_NEXT_VERSION_KEYS);
  assert.equal(codexUpdatePromptInputForChoice('update-now'), null);
});
