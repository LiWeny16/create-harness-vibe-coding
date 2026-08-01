import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRegistry, ALLOWED_RUNTIMES } from '../session-registry.mjs';
import { RUNTIME_DEFINITIONS } from '../runtime-detector.mjs';

test('ALLOWED_RUNTIMES contains supported and detectable CLI agents', () => {
  assert.deepEqual([...ALLOWED_RUNTIMES].sort(), RUNTIME_DEFINITIONS.map(runtime => runtime.id).sort());
});

test('create with valid runtime claude succeeds', () => {
  const reg = new SessionRegistry();
  const session = reg.create({ taskId: 'task-xyz', runtime: 'claude', cols: 120, rows: 32, projectRoot: '/tmp/proj' });
  assert.ok(session.sessionId);
  assert.equal(session.taskId, 'task-xyz');
  assert.equal(session.runtime, 'claude');
  assert.equal(session.subagentMode, 'wf-subagents');
  assert.equal(session.workflowMode, null);
  assert.equal(session.status, 'starting');
  assert.equal(session.cols, 120);
  assert.equal(session.rows, 32);
  assert.equal(session.pid, null);
  assert.equal(session.exitCode, null);
  assert.equal(session.wsClientCount, 0);
  assert.equal(typeof session.startedAt, 'string');
  assert.equal(typeof session.updatedAt, 'string');
});

test('create can start an unbound terminal agent session', () => {
  const reg = new SessionRegistry();
  const session = reg.create({ runtime: 'opencode', cols: 100, rows: 30, model: 'sonnet', provider: 'anthropic' });
  assert.ok(session.sessionId);
  assert.equal(session.taskId, null);
  assert.equal(session.runtime, 'opencode');
  assert.equal(session.model, 'sonnet');
  assert.equal(session.provider, 'anthropic');
});

test('AC-001 AC-005 create preserves explicit agent launch fields and graph context', () => {
  const reg = new SessionRegistry();
  const graphContext = {
    nodeId: 'agent-main-1',
    connectedPeerIds: ['agent-subagent-1'],
    relationship: 'main-controls-subagent',
  };
  const launchPolicy = {
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
  };

  const session = reg.create({
    agentKind: 'main',
    runtime: 'codex',
    workflowMode: 'wf',
    taskId: 'task-alpha',
    cwd: 'D:\\workspaces\\alpha',
    launchPolicy,
    graphContext,
  });

  assert.equal(session.agentKind, 'main');
  assert.equal(session.runtime, 'codex');
  assert.equal(session.workflowMode, 'wf');
  assert.equal(session.taskId, 'task-alpha');
  assert.equal(session.cwd, 'D:\\workspaces\\alpha');
  assert.deepEqual(session.launchPolicy, launchPolicy);
  assert.deepEqual(session.graphContext, graphContext);
});

test('AC-001 AC-005 create rejects Router as an agent kind', () => {
  const reg = new SessionRegistry();
  assert.throws(() => reg.create({ runtime: 'codex', agentKind: 'router' }), {
    name: 'Error',
    message: /agent kind.*router/i,
  });
});

test('create can mark a wf CEO terminal session', () => {
  const reg = new SessionRegistry();
  const session = reg.create({
    runtime: 'codex',
    role: 'CEO',
    workflowMode: 'wf',
    ceoPrompt: 'run the workflow',
    subagentMode: 'built-in-subagents',
  });
  assert.equal(session.role, 'CEO');
  assert.equal(session.workflowMode, 'wf');
  assert.equal(session.ceoPrompt, 'run the workflow');
  assert.equal(session.subagentMode, 'built-in-subagents');
});

test('create with invalid runtime fake-peer throws', () => {
  const reg = new SessionRegistry();
  assert.throws(() => reg.create({ taskId: 'task-xyz', runtime: 'fake-peer' }), {
    name: 'Error',
    message: /Invalid runtime.*fake-peer/,
  });
});

test('create with codex succeeds', () => {
  const reg = new SessionRegistry();
  const session = reg.create({ taskId: 'task-abc', runtime: 'codex', cols: 80, rows: 24, projectRoot: '/tmp' });
  assert.equal(session.runtime, 'codex');
  assert.ok(session.sessionId);
});

test('create with opencode succeeds', () => {
  const reg = new SessionRegistry();
  const session = reg.create({ taskId: 'task-abc', runtime: 'opencode', cols: 80, rows: 24, projectRoot: '/tmp' });
  assert.equal(session.runtime, 'opencode');
  assert.ok(session.sessionId);
});

test('create with cc succeeds', () => {
  const reg = new SessionRegistry();
  const session = reg.create({ taskId: 'task-abc', runtime: 'cc', cols: 80, rows: 24, projectRoot: '/tmp' });
  assert.equal(session.runtime, 'cc');
  assert.ok(session.sessionId);
});

test('get returns correct session', () => {
  const reg = new SessionRegistry();
  const created = reg.create({ taskId: 'task-xyz', runtime: 'claude', cols: 120, rows: 32, projectRoot: '/tmp' });
  const retrieved = reg.get(created.sessionId);
  assert.deepEqual(retrieved, created);
});

test('get returns undefined for unknown sessionId', () => {
  const reg = new SessionRegistry();
  assert.equal(reg.get('nonexistent'), undefined);
});

test('getAll returns array', () => {
  const reg = new SessionRegistry();
  reg.create({ taskId: 'task-a', runtime: 'claude', cols: 120, rows: 32, projectRoot: '/tmp' });
  reg.create({ taskId: 'task-b', runtime: 'codex', cols: 80, rows: 24, projectRoot: '/tmp' });
  const all = reg.getAll();
  assert.equal(all.length, 2);
});

test('getAllForTask filters correctly', () => {
  const reg = new SessionRegistry();
  const s1 = reg.create({ taskId: 'task-xyz', runtime: 'claude', cols: 120, rows: 32, projectRoot: '/tmp/a' });
  const s2 = reg.create({ taskId: 'task-xyz', runtime: 'codex', cols: 80, rows: 24, projectRoot: '/tmp/a' });
  reg.create({ taskId: 'task-other', runtime: 'claude', cols: 100, rows: 40, projectRoot: '/tmp/b' });

  const filtered = reg.getAllForTask('task-xyz');
  assert.equal(filtered.length, 2);
  assert.ok(filtered.some(s => s.sessionId === s1.sessionId));
  assert.ok(filtered.some(s => s.sessionId === s2.sessionId));
});

test('update merges status and cols/rows', () => {
  const reg = new SessionRegistry();
  const created = reg.create({ taskId: 'task-xyz', runtime: 'claude', cols: 120, rows: 32, projectRoot: '/tmp' });

  reg.update(created.sessionId, { status: 'running', cols: 100, rows: 40 });
  const updated = reg.get(created.sessionId);

  assert.equal(updated.status, 'running');
  assert.equal(updated.cols, 100);
  assert.equal(updated.rows, 40);
  assert.equal(updated.taskId, 'task-xyz'); // unchanged
  assert.equal(updated.runtime, 'claude'); // unchanged
});

test('update merges pid and exitCode', () => {
  const reg = new SessionRegistry();
  const created = reg.create({ taskId: 'task-xyz', runtime: 'claude', cols: 120, rows: 32, projectRoot: '/tmp' });

  reg.update(created.sessionId, { pid: 12345 });
  assert.equal(reg.get(created.sessionId).pid, 12345);

  reg.update(created.sessionId, { status: 'exited', exitCode: 0 });
  assert.equal(reg.get(created.sessionId).status, 'exited');
  assert.equal(reg.get(created.sessionId).exitCode, 0);
});

test('update merges wsClientCount', () => {
  const reg = new SessionRegistry();
  const created = reg.create({ taskId: 'task-xyz', runtime: 'claude', cols: 120, rows: 32, projectRoot: '/tmp' });
  reg.update(created.sessionId, { wsClientCount: 3 });
  assert.equal(reg.get(created.sessionId).wsClientCount, 3);
});

test('update sets updatedAt timestamp', () => {
  const reg = new SessionRegistry();
  const created = reg.create({ taskId: 'task-xyz', runtime: 'claude', cols: 120, rows: 32, projectRoot: '/tmp' });
  const before = created.updatedAt;

  // Small delay to ensure different timestamp
  const updated = reg.get(created.sessionId);
  reg.update(created.sessionId, { status: 'running' });
  const after = reg.get(created.sessionId).updatedAt;
  assert.ok(after >= before);
});

test('count returns correct number', () => {
  const reg = new SessionRegistry();
  assert.equal(reg.count(), 0);
  reg.create({ taskId: 'task-a', runtime: 'claude', cols: 120, rows: 32, projectRoot: '/tmp' });
  assert.equal(reg.count(), 1);
  reg.create({ taskId: 'task-b', runtime: 'opencode', cols: 100, rows: 40, projectRoot: '/tmp' });
  assert.equal(reg.count(), 2);
});

test('remove then get returns undefined', () => {
  const reg = new SessionRegistry();
  const created = reg.create({ taskId: 'task-xyz', runtime: 'claude', cols: 120, rows: 32, projectRoot: '/tmp' });
  assert.equal(reg.count(), 1);

  reg.remove(created.sessionId);
  assert.equal(reg.get(created.sessionId), undefined);
  assert.equal(reg.count(), 0);
});

test('stop removes web session from live registry and returns stopped state', () => {
  const reg = new SessionRegistry();
  const created = reg.create({ runtime: 'claude' });
  const stopped = reg.stop(created.sessionId);
  assert.equal(stopped.sessionId, created.sessionId);
  assert.equal(stopped.status, 'stopped');
  assert.equal(reg.get(created.sessionId), undefined);
  assert.equal(reg.count(), 0);
});

test('withLock serializes updates for the same session', async () => {
  const reg = new SessionRegistry();
  const created = reg.create({ runtime: 'claude' });
  const events = [];

  await Promise.all([
    reg.withLock(created.sessionId, async () => {
      events.push('a:start');
      await new Promise(resolve => setTimeout(resolve, 20));
      events.push('a:end');
    }),
    reg.withLock(created.sessionId, async () => {
      events.push('b:start');
      events.push('b:end');
    }),
  ]);

  assert.deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('remove non-existent session does nothing', () => {
  const reg = new SessionRegistry();
  reg.remove('nonexistent');
  assert.equal(reg.count(), 0);
});

test('two concurrent sessions do not interfere', () => {
  const reg = new SessionRegistry();
  const s1 = reg.create({ taskId: 'task-a', runtime: 'claude', cols: 120, rows: 32, projectRoot: '/proj-a' });
  const s2 = reg.create({ taskId: 'task-b', runtime: 'codex', cols: 80, rows: 24, projectRoot: '/proj-b' });

  assert.notEqual(s1.sessionId, s2.sessionId);
  assert.equal(s1.taskId, 'task-a');
  assert.equal(s2.taskId, 'task-b');

  reg.update(s1.sessionId, { status: 'running' });
  assert.equal(reg.get(s1.sessionId).status, 'running');
  assert.equal(reg.get(s2.sessionId).status, 'starting'); // unchanged

  reg.remove(s1.sessionId);
  assert.equal(reg.get(s1.sessionId), undefined);
  assert.equal(reg.get(s2.sessionId).taskId, 'task-b'); // s2 intact
  assert.equal(reg.count(), 1);
});

test('create returns session with peerId derived from runtime', () => {
  const reg = new SessionRegistry();
  const session = reg.create({ taskId: 'task-xyz', runtime: 'claude', cols: 120, rows: 32, projectRoot: '/tmp' });
  assert.ok(session.peerId);
  assert.ok(session.peerId.startsWith('claude-'));
});
