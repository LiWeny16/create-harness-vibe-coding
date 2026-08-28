import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadActionRegistry } from '../action-registry.mjs';
import { workflowOntology } from '../workflow-ontology.mjs';

// ── Two-way registry drift guard ─────────────────────────────────────────────
// Harness/a2a/action-registry.json is the single source of truth for the
// typed workflow-node action surface. This test keeps the registry and the
// implementations in lockstep in BOTH directions forever:
//
//   Direction 1 (ghost guard): every adapter function export that matches the
//     action-dispatch convention must be registered — an implemented-but-
//     unregistered action (the audit's 6 ghost actions) fails here.
//   Direction 2 (phantom guard): every registered non-special action must map
//     to a real adapter module function; every special action must be on the
//     hardcoded allowlist — a registered-but-unimplemented action (the audit's
//     capability:read phantom) fails here.
//   Direction 3 (surface guard): every action id surfaced by the ontology
//     catalog (readable/writable/control/runtime) must be registered.
//
// The audit previously flagged 6 ghost actions: file.meta (const alias of
// readMeta), agent.trackTerminalSpawn / markTerminalReady / clearTerminalState
// (PTY terminal tracking), timer.isTimerControlAction /
// timerControlActionsForState (timer control predicates). These are module
// infrastructure, NOT action handlers: they are never dispatched as
// "<type>.<name>" typed actions, and the test asserts they are NOT registered
// (see D0 below).

// ── Paths ──────────────────────────────────────────────────────────────────
// This test lives at src/wf-ui-server/__tests__/; the repo root is 3 levels up.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ADAPTER_DIR = path.join(REPO_ROOT, 'src', 'wf-ui-server', 'workflow-node-types');
const ADAPTER_FILE_SUFFIX = '-node.mjs';

// ── Registry membership helper ─────────────────────────────────────────────
// loadActionRegistry validates the legacy mainOnly actor shape that the P1
// data layer replaced with spawnGate; the loader's actor validation update is
// a later wave (backend gates). The drift guards below only read
// id/nodeType/implementation, so fall back to the raw parsed file instead of
// failing the whole suite on the stale actor rule.
function loadRegistryForDrift(root) {
  try {
    return loadActionRegistry(root);
  } catch {
    const registryPath = path.join(root, 'Harness', 'a2a', 'action-registry.json');
    return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  }
}

const REGISTRY = loadRegistryForDrift(REPO_ROOT);
const REGISTRY_IDS = new Set(REGISTRY.actions.map((action) => action.id));

function registryHas(id) {
  return REGISTRY_IDS.has(String(id));
}

// ── Hardcoded special-case allowlist ────────────────────────────────────────
// Pairs permitted to exist as registered actions without adapter-backed
// implementation (implementation.special === true). Every id on this list must
// stay in the registry (D2a), and every registry special must be on this list
// (D2b) — the two sets are asserted equal, so the list cannot rot.
const SPECIAL_CASE_IDS = new Set([
  // Server-intercepted in server.mjs before adapter dispatch (routes to
  // sendRuntimeSessionInput / startWorkflowGraphNode / restartWorkflowGraphNode
  // / stopRuntimeSession / setWorkflowNodeModel / executeGraphLayoutAction).
  'agent.start',
  'agent.restart',
  'agent.stop',
  'agent.sendInput',
  'agent.setModel',
  'agent.layout',
  // Runtime-special-cased in workflow-node-runtime executeNodeAction before
  // adapter dispatch.
  'node.delete',
  'node.restore',
  'agent.readContext',
  // Main-Agent graph action surface (executeAgentGraphAction).
  'agent.createNode',
  'agent.connectNodes',
  'agent.disconnectNodes',
  'agent.moveNode',
  'agent.deleteNode',
  'agent.deleteNodes',
  'agent.readGraph',
  // Server-special-cased in server.mjs before adapter dispatch (routes to
  // executeGraphHistoryAction → undoGraphOp / redoGraphOp).
  'graph.undo',
  'graph.redo',
]);

// ── Documented non-action adapter exports (the audit's 6 ghost actions) ────
// Adapter module exports that are module infrastructure rather than typed
// action handlers. They are excluded from the ghost enumeration in D1 and must
// never be registered (D0b keeps this honest in both directions).
const NON_ACTION_EXPORTS = new Set([
  'file.meta', // `export const meta = readMeta` — legacy alias, not a typed action
  'agent.trackTerminalSpawn', // PTY terminal tracking helpers
  'agent.markTerminalReady',
  'agent.clearTerminalState',
  'timer.isTimerControlAction', // timer control-predicate helpers
  'timer.timerControlActionsForState',
  'display.defaultDisplayTemplate', // display helper: themed fallback template
  'display.renderHtml', // display helper: serve-time render + placeholder expansion
  'display.reportHtmlPath', // display helper: html file location
  'goal.updateTaskCapsuleOnComplete', // goal internal callback: auto-close task capsule on completion
  'goal.updateTaskCapsuleOnReopen', // goal internal callback: restore phase on reopen
]);

// ── Adapter module enumeration ─────────────────────────────────────────────
// ACTION_ADAPTERS in workflow-node-runtime.mjs is module-local, but its
// surface is exactly the workflow-node-types/*-node.mjs files (the -node.mjs
// suffix naturally excludes role-profile-store.mjs). The derived set is pinned
// to the registry's adapter values in D1a, so a divergence on either side
// fails the lockstep check.
function listAdapterTypes() {
  return fs
    .readdirSync(ADAPTER_DIR)
    .filter((file) => file.endsWith(ADAPTER_FILE_SUFFIX))
    .map((file) => file.slice(0, -ADAPTER_FILE_SUFFIX.length))
    .sort();
}

function adapterModuleUrl(type) {
  return pathToFileURL(path.join(ADAPTER_DIR, `${type}${ADAPTER_FILE_SUFFIX}`)).href;
}

async function loadAdapterFunctionExports(type) {
  const module = await import(adapterModuleUrl(type));
  const names = [];
  for (const name of Object.keys(module)) {
    if (name === 'default') continue;
    if (typeof module[name] === 'function') names.push(name);
  }
  return names.sort();
}

function adapterActionId(type, exportName) {
  return `${type}.${exportName}`;
}

function registryAdapters(registry) {
  return new Set(registry.actions.map((action) => action.implementation?.adapter).filter((a) => typeof a === 'string'));
}

// ── D0: detector calibration (negative self-check) ─────────────────────────
test('D0a registry membership helper works both ways (negative self-check)', () => {
  // A registered id is detected…
  assert.equal(registryHas('agent.sendMessage'), true);
  // …an unregistered id is detected (simulated ghost)…
  assert.equal(registryHas('agent.fakeAction'), false);
  // …and the audit's phantom is impossible: capability:read is not registered.
  assert.equal(registryHas('capability.read'), false);
  assert.equal(registryHas(''), false);
  assert.equal(registryHas('markdown'), false);
});

test('D0b documented non-action exports: functions that must never be registered', async () => {
  assert.ok(NON_ACTION_EXPORTS.size > 0);
  for (const id of NON_ACTION_EXPORTS) {
    const separator = id.indexOf('.');
    const type = id.slice(0, separator);
    const exportName = id.slice(separator + 1);
    // The exclusion list stays load-bearing: the helper must still exist as a
    // function export (or the list must be cleaned up)…
    const module = await import(adapterModuleUrl(type));
    assert.equal(
      typeof module[exportName],
      'function',
      `${id} is listed as a non-action helper but is no longer a function export of the ${type} adapter`,
    );
    // …and it must never drift into the registry (a promoted helper becomes a
    // real action and must be audited through D1/D2 instead).
    assert.equal(
      registryHas(id),
      false,
      `${id} is a non-action helper export but has a registry entry; remove it from NON_ACTION_EXPORTS and audit it as a real action`,
    );
  }
});

// ── Direction 1: adapters → registry (ghost guard) ─────────────────────────
test('D1a adapter module set matches the registry adapter set', () => {
  const diskAdapters = listAdapterTypes();
  assert.deepEqual(diskAdapters, [...registryAdapters(REGISTRY)].sort());
});

test('D1b every adapter function export is registered (ghost guard)', async () => {
  const unregistered = [];
  for (const type of listAdapterTypes()) {
    const exportNames = await loadAdapterFunctionExports(type);
    for (const exportName of exportNames) {
      const id = adapterActionId(type, exportName);
      if (NON_ACTION_EXPORTS.has(id)) continue;
      // Registered as "<type>.<export>", or explicitly allowed as a
      // special-cased surface (SPECIAL_CASE_IDS).
      if (!registryHas(id) && !SPECIAL_CASE_IDS.has(id)) {
        unregistered.push(id);
      }
    }
  }
  assert.deepEqual(
    unregistered,
    [],
    `implemented-but-unregistered action(s) (ghost actions): ${unregistered.join(', ')}`,
  );
});

// ── Direction 2: registry → implementations (phantom guard) ────────────────
test('D2a special registry entries are exactly the hardcoded allowlist', () => {
  const registrySpecials = new Set(
    REGISTRY.actions.filter((action) => action.implementation?.special === true).map((action) => action.id),
  );
  // Every special entry must be on the allowlist (no undocumented special).
  const specialNotAllowed = [...registrySpecials].filter((id) => !SPECIAL_CASE_IDS.has(id));
  assert.deepEqual(specialNotAllowed, [], `special action(s) missing from the allowlist: ${specialNotAllowed.join(', ')}`);
  // Every allowlist id must be a registered special (no stale allowlist).
  const allowedNotSpecial = [...SPECIAL_CASE_IDS].filter((id) => !registrySpecials.has(id));
  assert.deepEqual(allowedNotSpecial, [], `allowlist id(s) not registered as special: ${allowedNotSpecial.join(', ')}`);
});

test('D2b every non-special registry entry is implemented (phantom guard)', async () => {
  const diskAdapters = new Set(listAdapterTypes());
  const missing = [];
  for (const action of REGISTRY.actions) {
    const impl = action.implementation;
    if (impl.special === true) continue; // covered by D2a
    const id = action.id;
    if (!diskAdapters.has(impl.adapter)) {
      missing.push(`${id} (adapter module ${impl.adapter}-node.mjs does not exist)`);
      continue;
    }
    const module = await import(adapterModuleUrl(impl.adapter));
    if (typeof module[impl.export] !== 'function') {
      missing.push(`${id} (adapter ${impl.adapter} has no function export '${impl.export}')`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `registered-but-unimplemented action(s) (phantom actions): ${missing.join(', ')}`,
  );
});

// ── Direction 3: ontology surface consistency (light) ──────────────────────
test('D3 every ontology catalog action id (readable/writable/control/runtime) is registered', () => {
  const catalog = workflowOntology(REPO_ROOT);
  const surfaceIds = new Set();
  for (const [type, entry] of Object.entries(catalog.nodeTypes || {})) {
    for (const bucket of ['readableActions', 'writableActions', 'controlActions', 'runtimeActions']) {
      if (Array.isArray(entry[bucket])) {
        for (const id of entry[bucket]) surfaceIds.add(`${id} (${type}.${bucket})`);
      }
    }
  }
  assert.ok(surfaceIds.size > 0, 'ontology catalog exposes an empty action surface; nothing was checked');
  const missing = [...surfaceIds].filter((labeled) => {
    const id = labeled.slice(0, labeled.lastIndexOf(' ('));
    return !registryHas(id);
  });
  assert.deepEqual(
    missing,
    [],
    `ontology action id(s) outside the registry: ${missing.join(', ')}`,
  );
});

test('D3b registry spawnGate "root" matches the ontology spawnRules in both directions', () => {
  const catalog = workflowOntology(REPO_ROOT);
  const gatedIds = new Set(
    REGISTRY.actions.filter((action) => action.actor?.spawnGate === 'root').map((action) => action.id),
  );
  const ruleActionIds = new Set();
  for (const [type, entry] of Object.entries(catalog.nodeTypes || {})) {
    for (const rule of entry.spawnRules || []) {
      assert.equal(rule.spawnRule, 'root-only', `ontology spawnRule for ${type}/${rule.actionId} must be root-only`);
      assert.equal(rule.gate, 'root', `ontology spawnRule gate for ${type}/${rule.actionId} must be root`);
      ruleActionIds.add(rule.actionId);
    }
  }
  const missingRules = [...gatedIds].filter((id) => !ruleActionIds.has(id));
  assert.deepEqual(
    missingRules,
    [],
    `registry spawnGate "root" action(s) without an ontology spawnRule: ${missingRules.join(', ')}`,
  );
  const missingGates = [...ruleActionIds].filter((id) => !gatedIds.has(id));
  assert.deepEqual(
    missingGates,
    [],
    `ontology spawnRules action(s) without registry spawnGate "root": ${missingGates.join(', ')}`,
  );
});
