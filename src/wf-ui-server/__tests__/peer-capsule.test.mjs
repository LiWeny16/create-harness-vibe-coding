import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';

import {
  createPeerCapsule,
  writePeerEvent,
  writePeerResult,
  blockPeer,
  getPeerCapsule,
} from '../peer-capsule.mjs';

/**
 * Create a temporary project root with a Harness/tasks structure for testing.
 */
function makeTempProject() {
  const tmpDir = makeHarnessTempRoot('peer-capsule-test-');
  // Create the expected structure
  fs.mkdirSync(path.join(tmpDir, 'Harness', 'tasks'), { recursive: true });
  return tmpDir;
}

test('createPeerCapsule writes REQUEST.json with correct taskId/peerId/runtime', () => {
  const projectRoot = makeTempProject();
  try {
    const request = {
      runtime: 'claude',
      taskId: 'task-test-123',
      peerId: 'worker-001',
      command: 'say hello',
    };

    const result = createPeerCapsule(projectRoot, 'task-test-123', 'worker-001', request);

    // Check returned structure — request gets createdAt added by createPeerCapsule
    assert.ok(result.capsuleDir);
    assert.ok(result.capsuleDir.endsWith(path.join('task-test-123', 'peers', 'worker-001')));
    assert.equal(result.request.taskId, request.taskId);
    assert.equal(result.request.peerId, request.peerId);
    assert.equal(result.request.runtime, request.runtime);
    assert.equal(result.request.command, request.command);
    assert.ok(result.request.createdAt);

    // Check file on disk
    const requestPath = path.join(result.capsuleDir, 'REQUEST.json');
    assert.ok(fs.existsSync(requestPath));
    const parsed = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
    assert.equal(parsed.taskId, 'task-test-123');
    assert.equal(parsed.peerId, 'worker-001');
    assert.equal(parsed.runtime, 'claude');
    assert.equal(parsed.command, 'say hello');
    // createdAt is added by createPeerCapsule
    assert.ok(parsed.createdAt);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('createPeerCapsule writes STATE.json with status starting', () => {
  const projectRoot = makeTempProject();
  try {
    const result = createPeerCapsule(projectRoot, 'task-test-123', 'worker-001', {
      runtime: 'claude',
      taskId: 'task-test-123',
      peerId: 'worker-001',
    });

    const statePath = path.join(result.capsuleDir, 'STATE.json');
    assert.ok(fs.existsSync(statePath));
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    assert.equal(state.status, 'starting');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('writePeerEvent appends line to events.jsonl', () => {
  const projectRoot = makeTempProject();
  try {
    createPeerCapsule(projectRoot, 'task-test-123', 'worker-001', {
      runtime: 'claude',
      taskId: 'task-test-123',
      peerId: 'worker-001',
    });

    writePeerEvent(projectRoot, 'task-test-123', 'worker-001', { type: 'data', text: 'hello' });
    writePeerEvent(projectRoot, 'task-test-123', 'worker-001', { type: 'data', text: 'world' });

    const eventsPath = path.join(projectRoot, 'Harness', 'tasks', 'task-test-123', 'peers', 'worker-001', 'events.jsonl');
    assert.ok(fs.existsSync(eventsPath));
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).text, 'hello');
    assert.equal(JSON.parse(lines[1]).text, 'world');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('writePeerResult writes RESULT.json', () => {
  const projectRoot = makeTempProject();
  try {
    createPeerCapsule(projectRoot, 'task-test-123', 'worker-001', {
      runtime: 'claude',
      taskId: 'task-test-123',
      peerId: 'worker-001',
    });

    const result = { status: 'completed', output: 'done' };
    writePeerResult(projectRoot, 'task-test-123', 'worker-001', result);

    const resultPath = path.join(projectRoot, 'Harness', 'tasks', 'task-test-123', 'peers', 'worker-001', 'RESULT.json');
    assert.ok(fs.existsSync(resultPath));
    const parsed = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    assert.equal(parsed.status, result.status);
    assert.equal(parsed.output, result.output);
    assert.ok(parsed.completedAt);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('blockPeer updates STATE.status to blocked', () => {
  const projectRoot = makeTempProject();
  try {
    createPeerCapsule(projectRoot, 'task-test-123', 'worker-001', {
      runtime: 'claude',
      taskId: 'task-test-123',
      peerId: 'worker-001',
    });

    blockPeer(projectRoot, 'task-test-123', 'worker-001', 'node-pty not installed');

    const statePath = path.join(projectRoot, 'Harness', 'tasks', 'task-test-123', 'peers', 'worker-001', 'STATE.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    assert.equal(state.status, 'blocked');
    assert.equal(state.blockedReason, 'node-pty not installed');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('blockPeer writes PROGRESS.md with reason', () => {
  const projectRoot = makeTempProject();
  try {
    createPeerCapsule(projectRoot, 'task-test-123', 'worker-001', {
      runtime: 'claude',
      taskId: 'task-test-123',
      peerId: 'worker-001',
    });

    blockPeer(projectRoot, 'task-test-123', 'worker-001', 'node-pty not installed');

    const progressPath = path.join(projectRoot, 'Harness', 'tasks', 'task-test-123', 'peers', 'worker-001', 'PROGRESS.md');
    assert.ok(fs.existsSync(progressPath));
    const content = fs.readFileSync(progressPath, 'utf-8');
    assert.ok(content.includes('node-pty not installed'));
    assert.ok(content.includes('BLOCKED'));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('getPeerCapsule reads all capsule files', () => {
  const projectRoot = makeTempProject();
  try {
    createPeerCapsule(projectRoot, 'task-test-123', 'worker-001', {
      runtime: 'claude',
      taskId: 'task-test-123',
      peerId: 'worker-001',
    });

    writePeerEvent(projectRoot, 'task-test-123', 'worker-001', { type: 'data', text: 'hello' });
    writePeerResult(projectRoot, 'task-test-123', 'worker-001', { status: 'completed', output: 'done' });

    const capsule = getPeerCapsule(projectRoot, 'task-test-123', 'worker-001');

    assert.ok(capsule.request);
    assert.equal(capsule.request.taskId, 'task-test-123');
    assert.equal(capsule.request.peerId, 'worker-001');

    assert.ok(capsule.state);
    assert.equal(capsule.state.status, 'starting');

    assert.ok(Array.isArray(capsule.events));
    assert.equal(capsule.events.length, 1);
    assert.equal(capsule.events[0].text, 'hello');

    assert.ok(capsule.result);
    assert.equal(capsule.result.status, 'completed');

    assert.equal(capsule.progress, null); // no PROGRESS.md written
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('getPeerCapsule returns progress content when PROGRESS.md exists', () => {
  const projectRoot = makeTempProject();
  try {
    createPeerCapsule(projectRoot, 'task-test-123', 'worker-001', {
      runtime: 'claude',
      taskId: 'task-test-123',
      peerId: 'worker-001',
    });

    blockPeer(projectRoot, 'task-test-123', 'worker-001', 'block reason');
    const capsule = getPeerCapsule(projectRoot, 'task-test-123', 'worker-001');

    assert.ok(capsule.progress);
    assert.ok(capsule.progress.includes('BLOCKED'));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('getPeerCapsule for non-existent capsule returns null', () => {
  const projectRoot = makeTempProject();
  try {
    const capsule = getPeerCapsule(projectRoot, 'task-nonexistent', 'no-one');
    assert.equal(capsule, null);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('path traversal in taskId is rejected', () => {
  const projectRoot = makeTempProject();
  try {
    assert.throws(() => createPeerCapsule(projectRoot, '../evil', 'worker-001', {}), {
      name: 'Error',
    });
    assert.throws(() => writePeerEvent(projectRoot, '../evil', 'worker-001', {}), {
      name: 'Error',
    });
    assert.throws(() => getPeerCapsule(projectRoot, '../evil', 'worker-001'), {
      name: 'Error',
    });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('path traversal in peerId is rejected', () => {
  const projectRoot = makeTempProject();
  try {
    assert.throws(() => createPeerCapsule(projectRoot, 'task-valid', '../evil', {}), {
      name: 'Error',
    });
    assert.throws(() => writePeerEvent(projectRoot, 'task-valid', '../evil', {}), {
      name: 'Error',
    });
    assert.throws(() => getPeerCapsule(projectRoot, 'task-valid', '../evil'), {
      name: 'Error',
    });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('validatePeerId rejects path traversal', async () => {
  const { validatePeerId } = await import('../peer-capsule.mjs');
  assert.equal(validatePeerId('../evil'), false);
  assert.equal(validatePeerId('valid-peer-001'), true);
  assert.equal(validatePeerId('peer/with/slash'), false);
});
