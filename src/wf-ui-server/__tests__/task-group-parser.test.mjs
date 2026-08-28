import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { parseTaskCapsule, parseTaskList } from '../task-parser.mjs';
import { startServer, stopServer } from '../server.mjs';

const tempRoots = [];

function makeProject() {
  const root = makeHarnessTempRoot('task-group-parser-');
  tempRoots.push(root);
  const tasksRoot = path.join(root, 'Harness', 'tasks');
  fs.mkdirSync(tasksRoot, { recursive: true });
  return { root, tasksRoot };
}

function writeFixtureState(tasksRoot, taskId, state) {
  const dir = path.join(tasksRoot, taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'STATE.json'), JSON.stringify(state, null, 2) + '\n');
}

after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function fetchJson(baseUrl, route) {
  return new Promise((resolve, reject) => {
    http.get(new URL(route, baseUrl), (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    }).on('error', reject);
  });
}

function baseState(overrides = {}) {
  return {
    schemaVersion: 1,
    taskId: 'task-x',
    status: 'active',
    phase: 'implement',
    updatedAt: '2026-08-13T08:00:00.000Z',
    links: { dependsOn: [], blocks: [], related: [] },
    ...overrides,
  };
}

test('P1: parseTaskCapsule exposes group from STATE.json when present', () => {
  const { tasksRoot } = makeProject();
  writeFixtureState(tasksRoot, 'task-grouped', baseState({ taskId: 'task-grouped', group: 'release-0819-formal' }));

  const capsule = parseTaskCapsule(path.join(tasksRoot, 'task-grouped'));
  assert.equal(capsule.group, 'release-0819-formal');

  const list = parseTaskList(tasksRoot);
  assert.equal(list.find(task => task.taskId === 'task-grouped').group, 'release-0819-formal');
});

test('P2: parseTaskCapsule group is null when absent from STATE.json', () => {
  const { tasksRoot } = makeProject();
  writeFixtureState(tasksRoot, 'task-ungrouped', baseState({ taskId: 'task-ungrouped' }));

  const capsule = parseTaskCapsule(path.join(tasksRoot, 'task-ungrouped'));
  assert.equal(capsule.group, null);

  const list = parseTaskList(tasksRoot);
  assert.equal(list.find(task => task.taskId === 'task-ungrouped').group, null);
});

test('P3: list endpoint payload carries group per task', async () => {
  const { root, tasksRoot } = makeProject();
  writeFixtureState(tasksRoot, 'task-grouped', baseState({ taskId: 'task-grouped', group: 'release-0819-formal' }));
  writeFixtureState(tasksRoot, 'task-ungrouped', baseState({ taskId: 'task-ungrouped' }));

  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0 });
  const baseUrl = `http://127.0.0.1:${started.port}`;
  try {
    const list = await fetchJson(baseUrl, '/api/tasks');
    assert.equal(list.status, 200);
    assert.equal(list.body.find(task => task.taskId === 'task-grouped').group, 'release-0819-formal');
    assert.equal(list.body.find(task => task.taskId === 'task-ungrouped').group, null);

    const single = await fetchJson(baseUrl, '/api/tasks/task-grouped');
    assert.equal(single.status, 200);
    assert.equal(single.body.group, 'release-0819-formal');
  } finally {
    await stopServer(started.server);
  }
});

test('P4: startup generation writes Harness/tasks/GROUPS.md from fixtures', async () => {
  const { root, tasksRoot } = makeProject();
  writeFixtureState(tasksRoot, 'task-grouped', baseState({
    taskId: 'task-grouped',
    group: 'release-0819-formal',
    updatedAt: new Date().toISOString(),
  }));
  writeFixtureState(tasksRoot, 'task-ungrouped', baseState({
    taskId: 'task-ungrouped',
    updatedAt: new Date().toISOString(),
  }));

  const started = await startServer({ projectRoot: root, host: '127.0.0.1', port: 0 });
  try {
    const md = fs.readFileSync(path.join(tasksRoot, 'GROUPS.md'), 'utf8');
    assert.match(md, /^# Task Groups \(generated\)/);
    assert.match(md, /## release-0819-formal \(1 task\)/);
    assert.match(md, /## default \(1 task\)/);
    assert.match(md, /## Needs Archive \(stale\)/);
  } finally {
    await stopServer(started.server);
  }
});
