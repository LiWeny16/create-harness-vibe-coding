import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Paths ──────────────────────────────────────────────────────────────────
// This test lives at src/wf-ui-server/__tests__/; the repo root is 3 levels up.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RUNTIME_REGISTRY_PATH = path.join(REPO_ROOT, 'Harness', 'a2a', 'action-registry.json');
const TEMPLATE_REGISTRY_PATH = path.join(REPO_ROOT, 'templates', 'common', 'Harness', 'a2a', 'action-registry.json');

// ── Enums (exact contract from the action-registry schema) ─────────────────
const NODE_TYPE_ENUM = [
  'agent',
  'markdown',
  'excalidraw',
  'file',
  'display',
  'timer',
  'goal',
  'skill-group',
  'mcp-connector',
  'github-trigger',
  'node',
  'graph',
];
const CATEGORY_ENUM = [
  'lifecycle',
  'terminal-io',
  'config',
  'communication',
  'graph',
  'discovery',
  'resource',
  'event',
  'capability',
  'workspace',
];
const PARAM_TYPE_ENUM = ['string', 'number', 'boolean', 'object', 'array'];

// ── Expected inventory (hardcoded; audited against the adapter exports and
// ── server-special-cased routes — see Harness/a2a/action-registry.json) ────
const EXPECTED_ACTION_IDS = [
  // markdown (8)
  'markdown.read',
  'markdown.patch',
  'markdown.replace',
  'markdown.append',
  'markdown.find',
  'markdown.acquireLock',
  'markdown.releaseLock',
  'markdown.save',
  // display (2)
  'display.write',
  'display.read',
  // excalidraw (4)
  'excalidraw.readScene',
  'excalidraw.patchScene',
  'excalidraw.saveScene',
  'excalidraw.renderPreview',
  // file (15: 6 original + 9 format/lock actions from task-upgrade-file-node W2)
  'file.readMeta',
  'file.readText',
  'file.readBytes',
  'file.refresh',
  'file.writeText',
  'file.preview',
  'file.acquireLock',
  'file.releaseLock',
  'file.readXlsx',
  'file.readXlsxSheet',
  'file.readPdf',
  'file.readPdfPage',
  'file.readZipEntries',
  'file.readZipEntry',
  'file.extractZipEntry',
  // agent (11 adapter-backed + setModel/layout specials + agent.delete alias = 14)
  'agent.readOutput',
  'agent.sendInput',
  'agent.sendMessage',
  'agent.broadcastMessage',
  'agent.readMessages',
  'agent.readTranscript',
  'agent.start',
  'agent.stop',
  'agent.restart',
  'agent.deleteAgentNode',
  'agent.delete',
  'agent.readContext',
  'agent.setModel',
  'agent.layout',
  // timer (11)
  'timer.read',
  'timer.fire',
  'timer.configure',
  'timer.enable',
  'timer.disable',
  'timer.setInterval',
  'timer.setMode',
  'timer.ackWatchdog',
  'timer.resetWatchdog',
  'timer.dispatchWakeup',
  'timer.tick',
  // github-trigger (3)
  'github-trigger.read',
  'github-trigger.receive',
  'github-trigger.configure',
  // skill-group (3)
  'skill-group.read',
  'skill-group.setSkillEnabled',
  'skill-group.configure',
  // mcp-connector (2)
  'mcp-connector.read',
  'mcp-connector.configure',
  // goal (11 + goal.delete alias = 12)
  'goal.read',
  'goal.update',
  'goal.requestCompletion',
  'goal.returnToWork',
  'goal.add',
  'goal.delete',
  'goal.replace',
  'goal.check',
  'goal.uncheck',
  'goal.complete',
  'goal.reopen',
  'goal.ackWatchdog',
  // node (2)
  'node.delete',
  'node.restore',
  // graph (9)
  'agent.createNode',
  'agent.connectNodes',
  'agent.disconnectNodes',
  'agent.moveNode',
  'agent.deleteNode',
  'agent.deleteNodes',
  'agent.readGraph',
  'graph.undo',
  'graph.redo',
];

function loadRegistry(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ── 1. Schema validation ───────────────────────────────────────────────────
test('registry parses and declares schemaVersion 1', () => {
  const registry = loadRegistry(RUNTIME_REGISTRY_PATH);
  assert.equal(registry.schemaVersion, 1);
  assert.ok(Array.isArray(registry.actions));
});

test('every action has the required schema fields', () => {
  const registry = loadRegistry(RUNTIME_REGISTRY_PATH);
  for (const action of registry.actions) {
    assert.equal(typeof action.id, 'string', `id missing for ${JSON.stringify(action)}`);
    assert.ok(action.id.length > 0, `empty id for ${JSON.stringify(action)}`);
    assert.equal(typeof action.nodeType, 'string', `nodeType missing for ${action.id}`);
    assert.equal(typeof action.category, 'string', `category missing for ${action.id}`);
    assert.equal(typeof action.summary, 'string', `summary missing for ${action.id}`);
    assert.ok(action.summary.length > 0, `empty summary for ${action.id}`);
    assert.ok(Array.isArray(action.params), `params must be an array for ${action.id}`);
    assert.ok(
      action.implementation && typeof action.implementation === 'object',
      `implementation missing for ${action.id}`,
    );
  }
});

test('action ids are unique', () => {
  const registry = loadRegistry(RUNTIME_REGISTRY_PATH);
  const ids = registry.actions.map(action => action.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('nodeType and category values are within the schema enums', () => {
  const registry = loadRegistry(RUNTIME_REGISTRY_PATH);
  for (const action of registry.actions) {
    assert.ok(NODE_TYPE_ENUM.includes(action.nodeType), `invalid nodeType ${action.nodeType} for ${action.id}`);
    assert.ok(CATEGORY_ENUM.includes(action.category), `invalid category ${action.category} for ${action.id}`);
  }
});

// ── 2. Coverage: the full implemented action inventory ─────────────────────
test('registry covers every implemented action id in the audited inventory', () => {
  const registry = loadRegistry(RUNTIME_REGISTRY_PATH);
  const ids = registry.actions.map(action => action.id);
  const missing = EXPECTED_ACTION_IDS.filter(id => !ids.includes(id));
  assert.deepEqual(missing, [], `registry is missing expected actions: ${missing.join(', ')}`);
  const unexpected = ids.filter(id => !EXPECTED_ACTION_IDS.includes(id));
  assert.deepEqual(unexpected, [], `registry has unexpected actions: ${unexpected.join(', ')}`);
  assert.equal(ids.length, EXPECTED_ACTION_IDS.length);
  assert.equal(ids.length, 85);
});

// ── 3. Special-flag consistency ────────────────────────────────────────────
test('implementation.special=true actions carry no adapter/export; non-special carry both', () => {
  const registry = loadRegistry(RUNTIME_REGISTRY_PATH);
  for (const action of registry.actions) {
    const impl = action.implementation;
    if (impl.special === true) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(impl, 'adapter'),
        `${action.id} is special but declares adapter ${impl.adapter}`,
      );
      assert.ok(
        !Object.prototype.hasOwnProperty.call(impl, 'export'),
        `${action.id} is special but declares export ${impl.export}`,
      );
    } else {
      assert.equal(typeof impl.adapter, 'string', `${action.id} needs adapter`);
      assert.equal(typeof impl.export, 'string', `${action.id} needs export`);
    }
  }
});

// ── 4. Params shape ────────────────────────────────────────────────────────
test('every param has name/type/required and a valid type', () => {
  const registry = loadRegistry(RUNTIME_REGISTRY_PATH);
  for (const action of registry.actions) {
    const names = new Set();
    for (const param of action.params) {
      assert.equal(typeof param.name, 'string', `${action.id} param missing name`);
      assert.ok(param.name.length > 0, `${action.id} param has empty name`);
      assert.equal(typeof param.type, 'string', `${action.id} param ${param.name} missing type`);
      assert.ok(PARAM_TYPE_ENUM.includes(param.type), `${action.id} param ${param.name} has invalid type ${param.type}`);
      assert.equal(typeof param.required, 'boolean', `${action.id} param ${param.name} missing required flag`);
      assert.equal(typeof param.description, 'string', `${action.id} param ${param.name} missing description`);
      assert.ok(!names.has(param.name), `${action.id} has duplicate param ${param.name}`);
      names.add(param.name);
    }
  }
});

test('actor object is present with spawnGate/edgeRequired/agentAuthored fields', () => {
  const registry = loadRegistry(RUNTIME_REGISTRY_PATH);
  for (const action of registry.actions) {
    assert.ok(action.actor && typeof action.actor === 'object', `${action.id} missing actor`);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(action.actor, 'mainOnly'),
      `${action.id} still declares the removed legacy mainOnly field`,
    );
    assert.ok(
      action.actor.spawnGate === 'root' || action.actor.spawnGate === null,
      `${action.id} actor.spawnGate must be "root" or null, got ${JSON.stringify(action.actor.spawnGate)}`,
    );
    assert.equal(typeof action.actor.edgeRequired, 'boolean', `${action.id} actor.edgeRequired must be boolean`);
    assert.equal(typeof action.actor.agentAuthored, 'boolean', `${action.id} actor.agentAuthored must be boolean`);
  }
});

test('spawnGate "root" appears only on the canvas-spawn actions (graph.createNode + agent.createNode)', () => {
  const registry = loadRegistry(RUNTIME_REGISTRY_PATH);
  const allowedSpawnActions = new Set(['graph.createNode', 'agent.createNode']);
  const gatedIds = registry.actions
    .filter(action => action.actor?.spawnGate === 'root')
    .map(action => action.id);
  // Depth rule (D-C): only canvas spawn is depth-gated; everything else is null.
  const unexpected = gatedIds.filter(id => !allowedSpawnActions.has(id));
  assert.deepEqual(unexpected, [], `spawnGate "root" leaked to non-spawn actions: ${unexpected.join(', ')}`);
  // Every registered createNode action must carry the gate.
  const createNodeIds = registry.actions
    .filter(action => action.id === 'agent.createNode')
    .map(action => action.id);
  assert.ok(createNodeIds.length > 0, 'agent.createNode must be registered');
  for (const id of createNodeIds) {
    assert.ok(gatedIds.includes(id), `${id} must be spawn-gated (spawnGate "root")`);
  }
});

// ── 5. Byte-identical template mirror ──────────────────────────────────────
test('templates/common mirror is byte-identical to the runtime registry', () => {
  const runtime = fs.readFileSync(RUNTIME_REGISTRY_PATH, 'utf8');
  const template = fs.readFileSync(TEMPLATE_REGISTRY_PATH, 'utf8');
  assert.equal(template, runtime);
  // Deep-equal as a semantic backstop (JSON object equality).
  assert.deepEqual(loadRegistry(TEMPLATE_REGISTRY_PATH), loadRegistry(RUNTIME_REGISTRY_PATH));
});
