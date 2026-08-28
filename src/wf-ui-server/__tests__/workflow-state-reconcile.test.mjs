import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import {
  appendTerminalData,
  buildSessionIndex,
  downgradeOrphanedDiskSessions,
  flushTerminalBuffer,
  getSessionIndexSummary,
  persistSession,
  readTerminalRange,
} from '../terminal-store.mjs';
import { stateFingerprint } from '../a2a-store.mjs';

function makeRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a', 'sessions'), { recursive: true });
  return root;
}

function sessionRecord(sessionId, patch = {}) {
  return { taskId: null, sessionId, runtime: 'codex', role: 'Main Agent', ...patch };
}

test('S1 batched terminal writes: buffered appends land on disk in order at flush', () => {
  const root = makeRoot('wfui-batch-');
  try {
    const session = sessionRecord('session-batch-1');
    persistSession(root, session);
    const diskFile = path.join(root, 'Harness', 'a2a', 'sessions', 'session-batch-1', 'terminal.jsonl');

    const entries = [];
    for (let i = 0; i < 5; i++) entries.push(appendTerminalData(root, session, `chunk-${i}`, 'stdout'));
    // The 500ms timer has not fired: nothing on disk yet.
    assert.equal(fs.existsSync(diskFile), false, 'buffered appends must not hit disk before flush');

    const flushed = flushTerminalBuffer(root, session.sessionId);
    assert.equal(flushed, 5);
    const lines = fs.readFileSync(diskFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((line) => line.data), ['chunk-0', 'chunk-1', 'chunk-2', 'chunk-3', 'chunk-4']);
    assert.deepEqual(lines.map((line) => line.seq), entries.map((entry) => entry.seq));
    const state = JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'a2a', 'sessions', 'session-batch-1', 'STATE.json'), 'utf8'));
    assert.equal(state.terminalSeq, entries[4].seq);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('S2 reads flush first: readTerminalRange sees buffered entries', () => {
  const root = makeRoot('wfui-batch-');
  try {
    const session = sessionRecord('session-batch-2');
    persistSession(root, session);
    appendTerminalData(root, session, 'visible-after-flush', 'stdout');
    const { entries } = readTerminalRange(root, { sessionId: session.sessionId });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].data, 'visible-after-flush');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('S3 startup downgrade: orphaned live sessions persist as stopped; stopped untouched', () => {
  const root = makeRoot('wfui-down-');
  try {
    persistSession(root, sessionRecord('session-orphan-run', { status: 'running', wsClientCount: 3, attachMode: true }));
    persistSession(root, sessionRecord('session-orphan-start', { status: 'starting' }));
    persistSession(root, sessionRecord('session-already-stopped', { status: 'stopped' }));

    const downgraded = downgradeOrphanedDiskSessions(root);
    assert.deepEqual(downgraded.sort(), ['session-orphan-run', 'session-orphan-start']);

    const run = JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'a2a', 'sessions', 'session-orphan-run', 'STATE.json'), 'utf8'));
    assert.equal(run.status, 'stopped');
    assert.equal(run.blockedReason, 'not-managed-by-current-wf-ui');
    assert.equal(run.wsClientCount, 0);
    assert.equal(run.attachMode, false);
    assert.ok(run.orphanedAt);
    const stopped = JSON.parse(fs.readFileSync(path.join(root, 'Harness', 'a2a', 'sessions', 'session-already-stopped', 'STATE.json'), 'utf8'));
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.orphanedAt, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('S4 session index: built at startup, maintained by persistSession, summarized cheaply', () => {
  const root = makeRoot('wfui-idx-');
  try {
    persistSession(root, sessionRecord('session-idx-a', { status: 'stopped' }));
    assert.equal(buildSessionIndex(root), 1);
    assert.equal(getSessionIndexSummary().count, 1);
    const first = getSessionIndexSummary().latestUpdatedAt;
    assert.ok(first);
    persistSession(root, sessionRecord('session-idx-b', { status: 'running' }));
    const summary = getSessionIndexSummary();
    assert.equal(summary.count, 2);
    assert.ok(summary.latestUpdatedAt >= first);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('S5 fingerprint: stable when nothing changes, moves when a session writes', () => {
  const root = makeRoot('wfui-fp-');
  try {
    const before = stateFingerprint(root);
    persistSession(root, sessionRecord('session-fp-1', { status: 'running' }));
    const after = stateFingerprint(root);
    assert.notEqual(after, before);
    assert.equal(stateFingerprint(root), after, 'fingerprint must be deterministic without changes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('S6 fingerprint must NOT churn with streamed terminal output', () => {
  // Regression: every terminal chunk used to bump the index updatedAt, so the
  // snapshot fingerprint changed on each 5s poll while a terminal streamed ->
  // full snapshot rebuild + canvas re-render -> UI stutter (selection/scroll/
  // typing hitches). Terminal activity must leave the fingerprint alone.
  const root = makeRoot('wfui-fp2-');
  try {
    const session = sessionRecord('session-fp2-stream', { status: 'running' });
    persistSession(root, session);
    const stable = stateFingerprint(root);
    for (let i = 0; i < 20; i++) appendTerminalData(root, session, `stream-chunk-${i}`, 'stdout');
    flushTerminalBuffer(root, session.sessionId);
    assert.equal(stateFingerprint(root), stable, 'streaming must not move the fingerprint');

    persistSession(root, { ...session, status: 'exited' });
    assert.notEqual(stateFingerprint(root), stable, 'a real status write must move it');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
