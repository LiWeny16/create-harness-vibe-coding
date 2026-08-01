import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { parseArchivedTasks, parseTaskCapsule, parseTaskList } from '../task-parser.mjs';

describe('task-parser', () => {
  let baseDir;

  before(() => {
    baseDir = makeHarnessTempRoot('tp-test-');

    // task-alpha — fully populated, latest updatedAt
    const dirA = path.join(baseDir, 'task-alpha');
    fs.mkdirSync(dirA, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'STATE.json'), JSON.stringify({
      schemaVersion: 1,
      taskId: 'task-alpha',
      status: 'active',
      mode: 'wf',
      tier: 'standard',
      phase: 'wave-1-synthesis',
      gate: 'E-GATE',
      updatedAt: '2026-07-29T08:00:00.000Z',
      activeQuestion: null,
      nextAction: 'Proceed to dispatch',
      acceptance: [{ id: 'AC-001', text: 'Task A acceptance', status: 'passed' }],
      links: { dependsOn: ['task-beta'], blocks: [], related: [] }
    }));
    fs.writeFileSync(path.join(dirA, 'PLAN.md'), '# Plan A');
    fs.writeFileSync(path.join(dirA, 'PROGRESS.md'), '# Progress A');
    const alphaClaude = path.join(dirA, 'sessions', 'session-claude');
    const alphaCodex = path.join(dirA, 'sessions', 'session-codex');
    fs.mkdirSync(alphaClaude, { recursive: true });
    fs.mkdirSync(alphaCodex, { recursive: true });
    fs.writeFileSync(path.join(alphaClaude, 'STATE.json'), JSON.stringify({ sessionId: 'session-claude', runtime: 'claude', status: 'saved' }));
    fs.writeFileSync(path.join(alphaCodex, 'STATE.json'), JSON.stringify({ sessionId: 'session-codex', runtime: 'codex', status: 'saved' }));

    // task-beta — completed, no plan/progress files
    const dirB = path.join(baseDir, 'task-beta');
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirB, 'STATE.json'), JSON.stringify({
      schemaVersion: 1,
      taskId: 'task-beta',
      status: 'completed',
      mode: 'direct',
      tier: 'none',
      phase: 'closed',
      gate: null,
      updatedAt: '2026-07-28T12:00:00.000Z',
      activeQuestion: null,
      nextAction: null,
      acceptance: ['AC-TRACKED'],
      links: { dependsOn: [], blocks: ['task-alpha'], related: [] }
    }));

    // task-gamma — earliest updatedAt, has active question
    const dirC = path.join(baseDir, 'task-gamma');
    fs.mkdirSync(dirC, { recursive: true });
    fs.writeFileSync(path.join(dirC, 'STATE.json'), JSON.stringify({
      schemaVersion: 2,
      taskId: 'task-gamma',
      status: 'pending',
      mode: 'direct',
      tier: 'none',
      phase: 'intake',
      gate: null,
      updatedAt: '2026-07-27T10:00:00.000Z',
      activeQuestion: 'What to build?',
      nextAction: 'Define goal',
      acceptance: [],
      links: { dependsOn: [], blocks: [], related: ['task-alpha'] }
    }));

    // not-a-capsule — directory with no STATE.json
    const dirNoState = path.join(baseDir, 'not-a-capsule');
    fs.mkdirSync(dirNoState, { recursive: true });
    fs.writeFileSync(path.join(dirNoState, 'some-file.txt'), 'hello');

    // task-bad-json — malformed STATE.json
    const dirBadJson = path.join(baseDir, 'task-bad-json');
    fs.mkdirSync(dirBadJson, { recursive: true });
    fs.writeFileSync(path.join(dirBadJson, 'STATE.json'), '{ invalid json }');

    // task-no-schema — STATE.json missing schemaVersion
    const dirNoSchema = path.join(baseDir, 'task-no-schema');
    fs.mkdirSync(dirNoSchema, { recursive: true });
    fs.writeFileSync(path.join(dirNoSchema, 'STATE.json'), JSON.stringify({
      taskId: 'task-no-schema',
      status: 'active',
      phase: 'unknown'
    }));
  });

  after(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

test('parseTaskCapsule parses a valid task capsule directory with STATE.json', () => {
  const result = parseTaskCapsule(path.join(baseDir, 'task-alpha'));

  assert.notEqual(result, null);
  assert.equal(result.taskId, 'task-alpha');
  assert.equal(result.status, 'active');
  assert.equal(result.phase, 'wave-1-synthesis');
  assert.equal(result.gate, 'E-GATE');
  assert.equal(result.updatedAt, '2026-07-29T08:00:00.000Z');
  assert.equal(result.activeQuestion, null);
  assert.ok(Array.isArray(result.acceptance));
  assert.equal(result.acceptance.length, 1);
  assert.equal(result.acceptance[0].id, 'AC-001');
  assert.equal(result.acceptance[0].status, 'passed');
  assert.deepEqual(result.dependsOn, ['task-beta']);
  assert.deepEqual(result.blocks, []);
  assert.equal(result.hasPlan, true);
  assert.equal(result.hasProgress, true);
  assert.deepEqual(result.runtimeHistory, ['claude', 'codex']);
});

test('parseTaskCapsule returns null for directory without STATE.json', () => {
  const result = parseTaskCapsule(path.join(baseDir, 'not-a-capsule'));
  assert.equal(result, null);
});

test('parseTaskCapsule throws on malformed JSON in STATE.json', () => {
  assert.throws(
    () => parseTaskCapsule(path.join(baseDir, 'task-bad-json')),
    /malformed|JSON|parse|SyntaxError/i
  );
});

test('parseTaskCapsule throws on missing schemaVersion field', () => {
  assert.throws(
    () => parseTaskCapsule(path.join(baseDir, 'task-no-schema')),
    /schemaVersion/i
  );
});

test('parseTaskList returns capsules sorted by updatedAt desc', () => {
  const results = parseTaskList(baseDir);

  assert.ok(results.length > 1);
  for (let i = 1; i < results.length; i++) {
    const prev = new Date(results[i - 1].updatedAt).getTime();
    const curr = new Date(results[i].updatedAt).getTime();
    assert.ok(prev >= curr, `Expected ${results[i - 1].taskId} (${results[i - 1].updatedAt}) >= ${results[i].taskId} (${results[i].updatedAt})`);
  }

  // Strict order: task-alpha (T+08:00), task-beta (T-1d 12:00), task-gamma (T-2d 10:00)
  assert.equal(results[0].taskId, 'task-alpha');
  assert.equal(results[1].taskId, 'task-beta');
  assert.equal(results[2].taskId, 'task-gamma');
});

test('parseTaskList skips non-capsule directories', () => {
  const results = parseTaskList(baseDir);
  const taskIds = results.map(r => r.taskId);

  assert.ok(taskIds.includes('task-alpha'));
  assert.ok(taskIds.includes('task-beta'));
  assert.ok(taskIds.includes('task-gamma'));
  assert.ok(!taskIds.includes('not-a-capsule'));
});

test('parseTaskList handles completed capsule without PLAN.md or PROGRESS.md', () => {
  const results = parseTaskList(baseDir);
  const beta = results.find(r => r.taskId === 'task-beta');

  assert.ok(beta);
  assert.equal(beta.status, 'completed');
  assert.equal(beta.phase, 'closed');
  assert.equal(beta.hasPlan, false);
  assert.equal(beta.hasProgress, false);
  assert.deepEqual(beta.acceptance, [{ id: 'AC-TRACKED', text: '', status: 'tracked' }]);
});

test('parseTaskList includes capsule with activeQuestion as string', () => {
  const results = parseTaskList(baseDir);
  const gamma = results.find(r => r.taskId === 'task-gamma');

  assert.ok(gamma);
  assert.equal(gamma.activeQuestion, 'What to build?');
  assert.equal(gamma.gate, null);
  assert.deepEqual(gamma.dependsOn, []);
  assert.deepEqual(gamma.blocks, []);
});

test('parseArchivedTasks reads YYYY/MM/DD archive layout', () => {
  const archiveDir = path.join(baseDir, '_archive', '2026', '07', '30', 'task-archived-alpha');
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId: 'task-archived-alpha',
    status: 'archived',
    phase: 'archived',
    updatedAt: '2026-07-30T10:00:00.000Z',
    defaultRuntime: 'codex',
  }));

  const archived = parseArchivedTasks(baseDir);
  const match = archived.find(task => task.taskId === 'task-archived-alpha');
  assert.ok(match);
  assert.equal(match.archivedYear, '2026');
  assert.equal(match.archivedPath, '2026/07/30');
  assert.equal(match.defaultRuntime, 'codex');
});
});
