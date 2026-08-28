import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const STATE_JSON_PROHIBITION =
  'Never edit `Harness/a2a/**/state.json` directly — use typed actions.';

// F16/D13: the node-manual set is discovered dynamically from the skills
// directory (every workflow-<type>-node.json file), never a hardcoded list, so
// newly added node manuals are covered automatically.
function nodeManualIds() {
  const dir = path.join(ROOT, 'Harness', 'a2a', 'skills');
  return fs.readdirSync(dir)
    .filter(file => /^workflow-([a-z0-9-]+)-node\.json$/.test(file))
    .map(file => file.replace(/\.json$/, ''))
    .sort();
}

// nodeType per spec §9.1: node manuals carry it; control-plane manuals omit it.
const NODE_TYPES = {
  'workflow-agent-node': 'agent',
  'workflow-goal-node': 'goal',
  'workflow-timer-node': 'timer',
  'workflow-markdown-node': 'markdown',
  'workflow-file-node': 'file',
  'workflow-display-node': 'display',
  'workflow-diagram-node': 'excalidraw',
  'workflow-mcp-connector-node': 'mcp-connector',
  'workflow-skill-group-node': 'skill-group',
  'workflow-resource-node': 'resource',
  'workflow-node-actions': null,
};

// User-facing jargon that must not appear in the agent-facing examples
// (spec §9.3 / AC-023 / MANUAL-4). These terms may exist in the manuals as
// typed action names or backend field guidance, but never in examples.
const JARGON_TERMS = [
  { term: 'broadcast', re: /\bbroadcast\b/i },
  { term: 'A2A', re: /\bA2A\b/ },
  { term: 'thread', re: /\bthread\b/i },
  { term: 'shared-context', re: /shared-context/i },
];

function readJson(rel) {
  const file = path.join(ROOT, ...rel.split('/'));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readRaw(rel) {
  return fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
}

for (const id of nodeManualIds()) {
  test(`AC-020/MANUAL-1 ${id}: unified manual field layout`, () => {
    const manual = readJson(`Harness/a2a/skills/${id}.json`);

    assert.equal(manual.schemaVersion, 1, 'schemaVersion must be integer 1');
    assert.equal(manual.skillId, id, 'skillId must be the stable manual id');
    assert.ok(manual.description && manual.description.trim(), 'description must be a non-empty agent-facing summary');

    // Commands are registry-generated now (W39 audit: Harness/a2a/action-
    // registry.json is the single command source; the injection path appends
    // `Commands:` lines per manual nodeType). Node manuals are prose-only: the
    // final shape has NO commands key (an empty array is tolerated). While the
    // prose-only migration is in flight, a legacy non-empty table is accepted,
    // but every entry must stay well-formed.
    assert.ok(manual.commands === undefined || Array.isArray(manual.commands), 'commands, when present, must be an array (prose-only manuals omit it)');
    for (const command of Array.isArray(manual.commands) ? manual.commands : []) {
      assert.ok(command.name && command.command && command.description, 'each command needs name, CLI command, and plain description');
    }

    const expectedNodeType = NODE_TYPES[id];
    if (expectedNodeType) {
      assert.equal(manual.nodeType, expectedNodeType, `nodeType must be ${expectedNodeType}`);
      assert.ok(manual.controlSurface && typeof manual.controlSurface === 'object', 'node manuals must carry a controlSurface map');
    } else {
      assert.equal(manual.nodeType, undefined, 'control-plane manuals must omit nodeType');
    }

    // Examples are optional now: node manuals are prose-only and concrete
    // invocations come from the registry's per-action example field. When a
    // legacy examples table is still present, every entry must be well-formed.
    assert.ok(manual.examples === undefined || Array.isArray(manual.examples), 'examples must be an array when present');
    for (const example of Array.isArray(manual.examples) ? manual.examples : []) {
      assert.ok(example.name && example.command && example.payload && example.note, 'each example needs name, command, full payload, and a plain note');
    }
    assert.ok(Array.isArray(manual.prohibitions) && manual.prohibitions.length > 0, 'prohibitions must be a non-empty explicit list');
    assert.ok(Array.isArray(manual.environment), 'environment must be a list of env vars');
    assert.ok(Array.isArray(manual.triggers), 'triggers must be a list');
    assert.ok(manual.policy && Array.isArray(manual.policy.denied), 'policy.denied must list forbidden actions');
  });
}

test('AC-022/MANUAL-3: every node manual carries the state.json prohibition verbatim', () => {
  for (const id of nodeManualIds()) {
    const manual = readJson(`Harness/a2a/skills/${id}.json`);
    assert.ok(
      Array.isArray(manual.prohibitions) && manual.prohibitions.includes(STATE_JSON_PROHIBITION),
      `${id} must carry the verbatim prohibition: "${STATE_JSON_PROHIBITION}"`,
    );
  }
});

test('AC-023/MANUAL-4: examples (when present) are agent-facing and free of user-facing jargon', () => {
  for (const id of nodeManualIds()) {
    const manual = readJson(`Harness/a2a/skills/${id}.json`);
    if (!Array.isArray(manual.examples) || manual.examples.length === 0) continue; // prose-only manuals carry no examples
    for (const example of manual.examples) {
      const text = JSON.stringify(example);
      for (const { term, re } of JARGON_TERMS) {
        assert.doesNotMatch(text, re, `${id} example "${example.name}" must not present user-facing jargon term "${term}"`);
      }
    }
  }
});

test('AC-024: agent manual carries the 10-step team decision flow with the ask-user gate', () => {
  const manual = readJson('Harness/a2a/skills/workflow-agent-node.json');
  const flow = manual.decisionFlow;
  assert.ok(Array.isArray(flow) && flow.length >= 10, 'decisionFlow must hold the 10 decision steps (spec §2)');
  const text = JSON.stringify(flow).toLowerCase();
  for (const keyword of ['find', 'connect', 'create', 'ask the user', 'role profile', 'nodeid', 'goal']) {
    assert.ok(text.includes(keyword), `decisionFlow must cover "${keyword}"`);
  }
});

test('T8/AC-016..AC-018: markdown manual has find, lock lease, and revision-guard conflict guidance', () => {
  const manual = readJson('Harness/a2a/skills/workflow-markdown-node.json');
  // Action surface is prose-declared through policy.allowed (commands are
  // registry-generated now); the find/lock semantics live in the surviving
  // findGuidance/revisionGuard prose sections.
  const allowed = manual.policy.allowed || [];
  for (const action of ['markdown.find', 'markdown.acquireLock', 'markdown.releaseLock']) {
    assert.ok(allowed.includes(action), `markdown manual must expose ${action}`);
  }
  const guard = manual.revisionGuard;
  assert.ok(guard, 'revisionGuard guidance must be present');
  const guardText = JSON.stringify(guard);
  assert.ok(/markdown_conflict/.test(guardText), 'conflict error shape markdown_conflict must be documented');
  assert.ok(/currentRevision/.test(guardText), 'conflict must carry currentRevision');
  assert.ok(/expectedRevision/.test(guardText), 'writes must accept expectedRevision');
  assert.ok(/markdown_locked/.test(guardText), 'lock-conflict error shape markdown_locked must be documented');
  assert.ok(/holder/.test(guardText) && /expiresAt/.test(guardText), 'markdown_locked must carry holder and expiresAt');
});

test('AC-012/AC-011: timer manual is the only wakeup source; fire/tick/dispatchWakeup stay backend-internal', () => {
  const manual = readJson('Harness/a2a/skills/workflow-timer-node.json');
  const wakeup = JSON.stringify(manual.wakeup || {});
  assert.ok(/wakeup/.test(wakeup) && /next turn/.test(wakeup), 'timer manual must describe wakeup messages read on the next turn');
  assert.ok(/goalNodeId/.test(wakeup), 'wakeup messages must reference the group Goal node');
  const internal = JSON.stringify(manual.internalActions || {});
  assert.ok(/dispatchWakeup/.test(internal) && /backend-internal/.test(internal), 'timer.fire/tick/dispatchWakeup must be documented as backend-internal');
  assert.ok(manual.policy.denied.some(entry => /dispatchWakeup/.test(entry)), 'policy.denied must list timer.dispatchWakeup');
});

test('AC-015: goal manual documents the single-Goal-per-group rule with goal_already_bound', () => {
  const manual = readJson('Harness/a2a/skills/workflow-goal-node.json');
  const rule = JSON.stringify(manual.singleGoalPerGroup || {});
  assert.ok(/one Goal/.test(rule) || /at most one Goal/.test(rule), 'single-Goal-per-group rule must be documented');
  assert.ok(/goal_already_bound/.test(rule), 'goal_already_bound rejection must be documented');
  // Action surface is prose-declared through policy.allowed (commands are
  // registry-generated now).
  const allowed = manual.policy.allowed || [];
  for (const action of ['goal.add', 'goal.check', 'goal.complete']) {
    assert.ok(allowed.includes(action), `goal manual must expose ${action}`);
  }
});

test('AC-019/AC-024: agent manual covers role profile, structured requests, wakeup handling, goal ticking, markdown blackboard', () => {
  const manual = readJson('Harness/a2a/skills/workflow-agent-node.json');
  const profile = JSON.stringify(manual.roleProfile || {});
  for (const field of ['displayName', 'roleTitle', 'responsibility', 'capabilities', 'roleProfileRef']) {
    assert.ok(profile.includes(field), `roleProfile guidance must mention ${field}`);
  }
  const requests = JSON.stringify(manual.structuredRequests || {});
  assert.ok(/requestId/.test(requests), 'structured request guidance must mention requestId');
  assert.ok(/nodeId/.test(requests), 'context sharing must be by nodeId only (AC-019)');
  const wakeup = JSON.stringify(manual.wakeupMessages || {});
  assert.ok(/wakeup/.test(wakeup) && /next turn/.test(wakeup), 'agent manual must explain reading wakeup messages on the next turn');
  assert.ok(/goalNodeId/.test(wakeup), 'agent manual must tell the agent to check the referenced Goal node');
  const ticking = JSON.stringify(manual.goalTicking || {});
  assert.ok(/goal_items_pending/.test(ticking), 'goal ticking must document the goal_items_pending retry');
  const blackboard = JSON.stringify(manual.markdownBlackboard || {});
  assert.ok(/nodeId/.test(blackboard), 'markdown blackboard sharing must be by nodeId only');
  assert.ok(/markdown_conflict/.test(blackboard), 'markdown conflict reread-and-retry guidance must be present');
});

test('MANUAL-1/AC-020 + mirror parity: template mirrors are byte-identical to sources', () => {
  const ids = [...nodeManualIds(), 'workflow-node-actions'];
  for (const id of ids) {
    const source = readRaw(`Harness/a2a/skills/${id}.json`);
    const mirror = readRaw(`templates/common/Harness/a2a/skills/${id}.json`);
    assert.equal(mirror, source, `templates/common/Harness/a2a/skills/${id}.json must be byte-identical`);
  }
  assert.equal(
    readRaw('templates/common/Harness/a2a/role-graph.json'),
    readRaw('Harness/a2a/role-graph.json'),
    'templates/common/Harness/a2a/role-graph.json must be byte-identical',
  );
});

test('AC-003 manual note: role-graph.json documents the canonical roleTitle vocabulary', () => {
  const roleGraph = readJson('Harness/a2a/role-graph.json');
  const canonical = roleGraph.roleVocabulary?.canonical;
  assert.ok(Array.isArray(canonical) && canonical.length > 0, 'roleVocabulary.canonical must list the roleTitle ids');
  for (const title of ['ceo', 'manager', 'implementer', 'reviewer', 'verifier', 'planner', 'terminal-controller']) {
    assert.ok(canonical.includes(title), `canonical roleTitle vocabulary must include ${title}`);
  }
});

test('W39: the action registry covers every node manual nodeType', () => {
  const registry = readJson('Harness/a2a/action-registry.json');
  assert.equal(registry.schemaVersion, 1);
  for (const id of nodeManualIds()) {
    const manual = readJson(`Harness/a2a/skills/${id}.json`);
    const nodeType = manual.nodeType;
    assert.ok(nodeType, `${id} must declare nodeType`);
    // The resource manual is an umbrella guide over File/Markdown/Excalidraw
    // resource nodes; those covered types carry registry actions individually
    // (the diagram manual declares nodeType 'excalidraw', the registry's
    // spelling for its actions).
    if (nodeType === 'resource') {
      for (const covered of ['markdown', 'file', 'excalidraw']) {
        assert.ok(
          registry.actions.some(action => action.nodeType === covered),
          `registry must contain ${covered} actions for the resource umbrella`,
        );
      }
      continue;
    }
    assert.ok(
      registry.actions.some(action => action.nodeType === nodeType),
      `registry must contain actions for manual nodeType ${nodeType} (${id})`,
    );
  }
});
