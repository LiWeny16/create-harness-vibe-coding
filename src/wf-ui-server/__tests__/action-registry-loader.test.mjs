import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import {
  loadActionRegistry,
  resolveRegistryPath,
  actionsForNodeType,
  actionById,
  cliCommands,
  validateRegistry,
  clearActionRegistryCache,
} from '../action-registry.mjs';

// ── Paths ──────────────────────────────────────────────────────────────────
// This test lives at src/wf-ui-server/__tests__/; the repo root is 3 levels up.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ── Minimal valid fixture used by the cache/error tests ────────────────────
function fixtureRegistry(summary) {
  return {
    schemaVersion: 1,
    actions: [
      {
        id: 'fixture.read',
        nodeType: 'markdown',
        category: 'resource',
        summary,
        params: [],
        actor: { spawnGate: null, edgeRequired: false, agentAuthored: true },
        cli: {
          command: 'workflow-node-action',
          flags: [{ flag: '--node', value: '<graphNodeIdOrSessionId>' }],
        },
        implementation: { adapter: 'markdown', export: 'read', special: false },
      },
    ],
  };
}

test('L1: loads the real registry from the repo root with 85 actions', () => {
  clearActionRegistryCache();
  const registry = loadActionRegistry(REPO_ROOT);
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.actions.length, 85);
  assert.ok(resolveRegistryPath(REPO_ROOT).endsWith(path.join('Harness', 'a2a', 'action-registry.json')));
});

test('L2: cached — a second load returns the same object', () => {
  clearActionRegistryCache();
  const first = loadActionRegistry(REPO_ROOT);
  const second = loadActionRegistry(REPO_ROOT);
  assert.equal(second, first);
});

test('L3: actionsForNodeType("goal") returns 12 entries', () => {
  const registry = loadActionRegistry(REPO_ROOT);
  const goalActions = actionsForNodeType(registry, 'goal');
  assert.equal(goalActions.length, 12);
  assert.ok(goalActions.every((action) => action.nodeType === 'goal'));
});

test('L4: actionById("agent.sendMessage") resolves with a cli.command', () => {
  const registry = loadActionRegistry(REPO_ROOT);
  const action = actionById(registry, 'agent.sendMessage');
  assert.notEqual(action, null);
  assert.equal(action.cli.command, 'send-agent-message');
  assert.ok(action.cli.flags.length > 0);
  assert.equal(actionById(registry, 'does.not.exist'), null);
});

test('L5: validateRegistry on the real file reports ok with zero errors', () => {
  clearActionRegistryCache();
  const registry = loadActionRegistry(REPO_ROOT);
  const result = validateRegistry(registry);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('L6: missing registry file throws a descriptive error', () => {
  const tmpRoot = makeHarnessTempRoot('wf-ui-action-registry-');
  const projectRoot = path.join(tmpRoot, 'empty-project');
  fs.mkdirSync(projectRoot, { recursive: true });
  try {
    assert.throws(
      () => loadActionRegistry(projectRoot),
      /Action registry not found at .*Harness[\\/]a2a[\\/]action-registry\.json/,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('L6b: invalid JSON in the registry file throws a descriptive error', () => {
  const tmpRoot = makeHarnessTempRoot('wf-ui-action-registry-');
  const projectRoot = path.join(tmpRoot, 'project');
  const registryPath = path.join(projectRoot, 'Harness', 'a2a', 'action-registry.json');
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, 'not json {', 'utf8');
  try {
    assert.throws(() => loadActionRegistry(projectRoot), /is invalid JSON/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('L7: clearActionRegistryCache forces a re-read', () => {
  clearActionRegistryCache();
  const tmpRoot = makeHarnessTempRoot('wf-ui-action-registry-');
  const projectRoot = path.join(tmpRoot, 'project');
  const registryPath = path.join(projectRoot, 'Harness', 'a2a', 'action-registry.json');
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  try {
    fs.writeFileSync(registryPath, JSON.stringify(fixtureRegistry('first')), 'utf8');
    const first = loadActionRegistry(projectRoot);

    // Cache hit: still the same object even after the file changes.
    fs.writeFileSync(registryPath, JSON.stringify(fixtureRegistry('second')), 'utf8');
    assert.equal(loadActionRegistry(projectRoot), first);

    // Clear forces a re-read with the new content.
    clearActionRegistryCache();
    const reread = loadActionRegistry(projectRoot);
    assert.notEqual(reread, first);
    assert.equal(reread.actions[0].summary, 'second');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('L8: validateRegistry rejects an actor with invalid spawnGate', () => {
  const bad = fixtureRegistry('bad');
  bad.actions[0].actor.spawnGate = 'invalid';
  const result = validateRegistry(bad);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('actor.spawnGate')));
});

test('cliCommands returns deduplicated {command, actionId, flags} entries', () => {
  const registry = loadActionRegistry(REPO_ROOT);
  const commands = cliCommands(registry);
  const distinct = new Set(commands.map((entry) => entry.command));
  assert.equal(distinct.size, commands.length, 'commands must be deduplicated');
  for (const entry of commands) {
    assert.equal(typeof entry.command, 'string');
    assert.equal(typeof entry.actionId, 'string');
    assert.ok(Array.isArray(entry.flags));
  }
  const nodeMap = commands.find((entry) => entry.command === 'node-map');
  assert.equal(nodeMap.actionId, 'agent.layout');
  assert.ok(!commands.some((entry) => entry.command === 'agent.stop'), 'null-cli actions must not appear');
});
