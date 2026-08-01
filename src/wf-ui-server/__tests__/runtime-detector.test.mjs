import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectRuntimes,
  resolveRuntimeCommand,
  resolveRuntimeLaunchArgs,
  resolveRuntimeResumeArgs,
  isRuntimeLaunchable,
  RUNTIME_DEFINITIONS,
} from '../runtime-detector.mjs';

function fakeRunner(command, args) {
  if (command === 'where.exe' || command === 'which') {
    const found = new Set(['claude', 'cc', 'codex', 'opencode', 'openclaw', 'pi', 'deepseek-tui']);
    const name = args[0];
    return found.has(name)
      ? { status: 0, stdout: `/bin/${name}\n`, stderr: '' }
      : { status: 1, stdout: '', stderr: '' };
  }
  return { status: 0, stdout: `${command} 1.2.3\n`, stderr: '' };
}

test('detectRuntimes returns detected CLI runtime entries by default', () => {
  const runtimes = detectRuntimes({ runner: fakeRunner });
  assert.deepEqual(runtimes.map(r => r.id), ['claude', 'cc', 'codex', 'opencode', 'deepseek', 'pi', 'openclaw']);
});

test('detectRuntimes includeMissing returns the full candidate registry', () => {
  const runtimes = detectRuntimes({ runner: () => ({ status: 1, stdout: '', stderr: '' }), includeMissing: true });
  assert.deepEqual(runtimes.map(r => r.id), RUNTIME_DEFINITIONS.map(r => r.id));
});

test('detected terminal agents are launchable when executable exists', () => {
  const byId = new Map(detectRuntimes({ runner: fakeRunner }).map(r => [r.id, r]));
  for (const id of ['claude', 'cc', 'codex', 'opencode', 'openclaw', 'pi', 'deepseek']) {
    assert.equal(byId.get(id).status, 'available');
    assert.equal(byId.get(id).launchable, true);
    assert.ok(byId.get(id).path);
  }
});

test('multi-command runtime keeps the detected command', () => {
  const byId = new Map(detectRuntimes({ runner: fakeRunner }).map(r => [r.id, r]));
  assert.equal(byId.get('deepseek').command, 'deepseek-tui');
});

test('detectRuntimes skips version commands unless requested', () => {
  const versionCommands = [];
  const runner = (command, args) => {
    if (command === 'where.exe' || command === 'which') {
      return args[0] === 'claude'
        ? { status: 0, stdout: '/bin/claude\n', stderr: '' }
        : { status: 1, stdout: '', stderr: '' };
    }
    versionCommands.push([command, ...args].join(' '));
    return { status: 0, stdout: `${command} 1.2.3\n`, stderr: '' };
  };

  const withoutVersion = detectRuntimes({ runner });
  assert.equal(withoutVersion.find(runtime => runtime.id === 'claude').version, null);
  assert.deepEqual(versionCommands, []);

  const withVersion = detectRuntimes({ runner, readVersion: true });
  assert.equal(withVersion.find(runtime => runtime.id === 'claude').version, 'claude 1.2.3');
  assert.deepEqual(versionCommands, ['claude --version']);
});

test('missing executable returns missing status', () => {
  const missingRunner = () => ({ status: 1, stdout: '', stderr: '' });
  const byId = new Map(detectRuntimes({ runner: missingRunner, includeMissing: true }).map(r => [r.id, r]));
  assert.equal(byId.get('codex').status, 'missing');
  assert.equal(byId.get('codex').blockedReason, 'executable-not-found');
});

test('runtime launch policy is separate from command detection', () => {
  assert.equal(isRuntimeLaunchable('codex'), true);
  assert.equal(isRuntimeLaunchable('openclaw'), true);
  assert.equal(resolveRuntimeCommand('cc'), 'cc');
  assert.deepEqual(resolveRuntimeLaunchArgs('codex', { model: 'gpt-5' }), ['--model', 'gpt-5']);
});

test('runtime launch args convert full-access never-approval policy to CLI bypass flags', () => {
  const launchPolicy = { sandboxMode: 'danger-full-access', approvalPolicy: 'never' };
  assert.deepEqual(resolveRuntimeLaunchArgs('claude', { launchPolicy }), ['--dangerously-skip-permissions']);
  assert.deepEqual(resolveRuntimeLaunchArgs('cc', { launchPolicy }), ['--dangerously-skip-permissions']);
  assert.deepEqual(resolveRuntimeLaunchArgs('codex', { model: 'gpt-5', launchPolicy }), [
    '--model',
    'gpt-5',
    '--dangerously-bypass-approvals-and-sandbox',
  ]);
  assert.deepEqual(resolveRuntimeLaunchArgs('opencode', { launchPolicy }), ['--auto']);
});

test('runtime launch args pass initial prompts through runtime-native CLI shapes', () => {
  assert.deepEqual(resolveRuntimeLaunchArgs('claude', { initialPrompt: 'WF node ready' }), ['WF node ready']);
  assert.deepEqual(resolveRuntimeLaunchArgs('codex', {
    model: 'gpt-5',
    initialPrompt: 'Describe graph',
  }), ['--model', 'gpt-5', 'Describe graph']);
  assert.deepEqual(resolveRuntimeLaunchArgs('opencode', { initialPrompt: 'Describe graph' }), ['--prompt', 'Describe graph']);
});

test('resume args match installed CLI resume command shapes', () => {
  assert.deepEqual(resolveRuntimeResumeArgs('claude', { agentSessionId: 'abc-123' }), ['--resume', 'abc-123']);
  assert.deepEqual(resolveRuntimeResumeArgs('claude'), ['--continue']);
  assert.deepEqual(resolveRuntimeResumeArgs('codex', { agentSessionId: 'abc-123' }), ['resume', 'abc-123']);
  assert.deepEqual(resolveRuntimeResumeArgs('codex'), ['resume', '--last']);
  assert.deepEqual(resolveRuntimeResumeArgs('opencode', { agentSessionId: 'abc-123' }), ['--session', 'abc-123']);
  assert.deepEqual(resolveRuntimeResumeArgs('opencode'), ['--continue']);
  assert.deepEqual(resolveRuntimeResumeArgs('openclaw'), []);
});
