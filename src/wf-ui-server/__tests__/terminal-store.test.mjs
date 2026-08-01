import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import {
  appendSessionEvent,
  appendTerminalData,
  globTerminalEvents,
  listTerminalSessions,
  persistSession,
  readTerminalRange,
  recordInputRequest,
} from '../terminal-store.mjs';

function makeSession() {
  const projectRoot = makeHarnessTempRoot('terminal-store-');
  const session = {
    taskId: 'task-alpha',
    sessionId: 'session-abc',
    runtime: 'codex',
    status: 'running',
    attachMode: false,
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
  return { projectRoot, session };
}

test('persistSession writes task-scoped STATE.json', () => {
  const { projectRoot, session } = makeSession();
  try {
    persistSession(projectRoot, session);
    const statePath = path.join(projectRoot, 'Harness', 'tasks', 'task-alpha', 'sessions', 'session-abc', 'STATE.json');
    assert.ok(fs.existsSync(statePath));
    assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).runtime, 'codex');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('persistSession writes unbound sessions under Harness/a2a/sessions', () => {
  const projectRoot = makeHarnessTempRoot('terminal-store-');
  const session = {
    taskId: null,
    sessionId: 'session-unbound',
    runtime: 'opencode',
    status: 'running',
    attachMode: true,
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
  try {
    persistSession(projectRoot, session);
    appendTerminalData(projectRoot, session, 'hello-a2a');
    const statePath = path.join(projectRoot, 'Harness', 'a2a', 'sessions', 'session-unbound', 'STATE.json');
    assert.ok(fs.existsSync(statePath));
    assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).taskId, null);
    const range = readTerminalRange(projectRoot, { sessionId: 'session-unbound', tail: 1 });
    assert.equal(range.taskId, null);
    assert.equal(range.entries[0].data, 'hello-a2a');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('appendTerminalData creates monotonic seq and bounded range reads', () => {
  const { projectRoot, session } = makeSession();
  try {
    persistSession(projectRoot, session);
    appendTerminalData(projectRoot, session, 'one');
    appendTerminalData(projectRoot, session, 'two');
    const range = readTerminalRange(projectRoot, { sessionId: 'session-abc', fromSeq: 2, tail: 10 });
    assert.equal(range.entries.length, 1);
    assert.equal(range.entries[0].seq, 2);
    assert.equal(range.entries[0].data, 'two');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('globTerminalEvents reads event and terminal files by glob', () => {
  const { projectRoot, session } = makeSession();
  try {
    persistSession(projectRoot, session);
    appendSessionEvent(projectRoot, session, { type: 'session.running' });
    appendTerminalData(projectRoot, session, 'hello');
    const rows = globTerminalEvents(projectRoot, { pattern: 'Harness/tasks/**/sessions/**/events.jsonl' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'session.running');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('globTerminalEvents reads Harness/a2a session events', () => {
  const projectRoot = makeHarnessTempRoot('terminal-store-');
  const session = {
    taskId: null,
    sessionId: 'session-a2a-glob',
    runtime: 'claude',
    status: 'running',
    attachMode: true,
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
  try {
    persistSession(projectRoot, session);
    appendSessionEvent(projectRoot, session, { type: 'session.running' });
    const rows = globTerminalEvents(projectRoot, { pattern: 'Harness/a2a/sessions/**/events.jsonl' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].taskId, null);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('recordInputRequest is attach-gated', () => {
  const { projectRoot, session } = makeSession();
  try {
    persistSession(projectRoot, session);
    assert.throws(() => recordInputRequest(projectRoot, 'session-abc', 'hello'), /watch mode/);
    persistSession(projectRoot, { ...session, attachMode: true });
    const event = recordInputRequest(projectRoot, 'session-abc', 'hello');
    assert.equal(event.type, 'terminal.input.requested');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('listTerminalSessions returns persisted sessions', () => {
  const { projectRoot, session } = makeSession();
  try {
    persistSession(projectRoot, session);
    const sessions = listTerminalSessions(projectRoot);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, 'session-abc');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
