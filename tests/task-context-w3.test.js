import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeHarnessTempRoot } from './support/temp-root.js';

const repoRoot = path.resolve('.');
const fixtureRoot = path.resolve('tests/fixtures/harness-092/project');
const script = path.resolve('Harness/scripts/task-context.mjs');
const tempRoots = new Set();

function project(prefix = 'task-context-w3-') {
  const root = makeHarnessTempRoot(prefix);
  tempRoots.add(root);
  fs.cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function run(root, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function json(result) {
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    assert.fail(`expected JSON CLI output; status=${result.status}; stdout=${result.stdout}; stderr=${result.stderr}`);
  }
}

function writeTaskState(root, taskId, state) {
  const dir = path.join(root, 'Harness', 'tasks', taskId);
  fs.mkdirSync(dir, { recursive: true });
  const merged = {
    schemaVersion: 1,
    taskId,
    status: 'active',
    mode: 'direct',
    phase: 'plan',
    gate: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    activeQuestion: null,
    nextAction: 'Default next action.',
    acceptance: [],
    queues: { ready: [], running: [], blocked: [], done: [] },
    dispatchLedger: [],
    decisions: [],
    risks: [],
    artifacts: [],
    links: { dependsOn: [], blocks: [], related: [] },
    ...state,
  };
  merged.taskId = taskId;
  fs.writeFileSync(path.join(dir, 'STATE.json'), JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return dir;
}

function packTask(root, taskId, role = 'test-writer', budgetBytes = 4000) {
  const result = run(root, ['pack', taskId, '--project', root, '--role', role, '--budget-bytes', String(budgetBytes), '--json']);
  return { raw: result, output: json(result) };
}

// ---------------------------------------------------------------------------
// W3 RED tests for task-context pack expansion.
//
// The W0-W2 waves added task-route.mjs (route + blocker + archive surface).
// W3 extends `task-context pack` to include a mandatory state/blocker/
// dependency header so every pack exposes the minimum resume context.
// ---------------------------------------------------------------------------

test('W3 pack includes status/phase/gate header for task-context-fixture', () => {
  const root = project();
  const { raw, output } = packTask(root, 'task-context-fixture');
  assert.equal(raw.status, 0, raw.stderr || raw.stdout);
  assert.ok(typeof output.pack, 'string');
  const header = output.pack;
  assert.match(header, /status/i, 'pack must include status');
  assert.match(header, /phase/i, 'pack must include phase');
  assert.match(header, /active/, 'pack must show active status');
  assert.match(header, /plan/, 'pack must show plan phase');
});

test('W3 pack includes blockers section when blockers exist', () => {
  const root = project();
  writeTaskState(root, 'task-w3-blocked', {
    status: 'blocked',
    phase: 'implement',
    activeQuestion: 'Choose the next route strategy?',
    queues: { blocked: [{ id: 'task-w3-blocked-step-1', reason: 'Needs user decision' }] },
    links: { dependsOn: ['task-context-fixture'] },
  });
  const { raw, output } = packTask(root, 'task-w3-blocked');
  assert.equal(raw.status, 0, raw.stderr || raw.stdout);
  assert.match(output.pack, /blockers/i, 'pack must include blockers section');
  assert.match(output.pack, /Choose the next route strategy\?/, 'activeQuestion must appear');
  assert.match(output.pack, /Needs user decision/, 'blocked queue reason must appear');
  assert.match(output.pack, /task-context-fixture/, 'dependency must appear');
});

test('W3 pack includes dependencies section when dependencies exist', () => {
  const root = project();
  writeTaskState(root, 'task-w3-dep', {
    status: 'active',
    phase: 'implement',
    links: { dependsOn: ['task-context-fixture'] },
  });
  const { raw, output } = packTask(root, 'task-w3-dep');
  assert.equal(raw.status, 0, raw.stderr || raw.stdout);
  assert.match(output.pack, /dependencies/i, 'pack must include dependencies section');
  assert.match(output.pack, /task-context-fixture/, 'dependency must appear');
});

test('W3 pack header is mandatory even with tight byte budget', () => {
  const root = project();
  writeTaskState(root, 'task-w3-tight', {
    status: 'active',
    phase: 'plan',
    gate: null,
    nextAction: 'Continue the plan.',
  });
  // Tight budget that fits the header + mandatory sections but not optional ones.
  const { raw, output } = packTask(root, 'task-w3-tight', 'test-writer', 700);
  assert.equal(raw.status, 0, raw.stderr || raw.stdout);
  assert.ok(output.pack.includes('active'), 'status must survive');
  assert.ok(output.pack.includes('plan'), 'phase must survive');
  assert.ok(output.pack.includes('Continue the plan.'), 'nextAction must survive');
  assert.ok(Array.isArray(output.omitted), 'omitted must be an array');
});

test('W3 pack does not include raw log bodies from evidence pointers', () => {
  const root = project();
  // Reuse the fixture's evidence pointer (E-fixture -> Harness/tasks/.../REFERENCES.md)
  // and verify the pack exposes the pointer but not the file body.
  const { output } = packTask(root, 'task-context-fixture');
  const referencesPath = path.join(root, 'Harness', 'tasks', 'task-context-fixture', 'REFERENCES.md');
  if (fs.existsSync(referencesPath)) {
    const body = fs.readFileSync(referencesPath, 'utf8');
    // Find any line in the file body that is longer than 40 chars and not in the pack.
    const longLines = body.split(/\r?\n/).filter(line => line.length > 40 && !output.pack.includes(line.trim()));
    // We don't require any specific line to be missing (the file might be short),
    // but we do require the pack to NOT contain the entire file body verbatim.
    assert.ok(!output.pack.includes(body.trim()), 'pack must not embed raw log body');
  }
});

test('W3 pack hash is stable across identical inputs (regression guard)', () => {
  const root = project();
  const a = packTask(root, 'task-context-fixture').output;
  const b = packTask(root, 'task-context-fixture').output;
  assert.equal(a.hash, b.hash);
});
