import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Helpers ──
function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), '.tmp-skill-group-context-enabled-' + id);
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({ schemaVersion: 1, version: 1, nodes: [], edges: [], positions: {}, undoStack: [], redoStack: [], deletedNodes: [] }));
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function seedAgentGraphNode(root, nodeId = 'session-skill-context-agent-01', overrides = {}) {
  const graph = runtime.loadWorkflowGraphMap(root);
  const sessionId = overrides.sessionId || `${nodeId}-pty`;
  runtime.writeWorkflowGraphMap(root, {
    ...graph,
    version: graph.version + 1,
    nodes: [
      ...(graph.nodes || []),
      {
        nodeId,
        sessionId,
        agentKind: overrides.agentKind || 'main',
        runtime: overrides.runtime || 'codex',
        status: overrides.status || 'stopped',
        label: overrides.label || 'Skill Context Agent',
        cwd: root,
        taskId: null,
        role: overrides.role || overrides.agentKind || 'main',
      },
    ],
    positions: {
      ...(graph.positions || {}),
      [nodeId]: { x: 100, y: 120 },
    },
  });
  return nodeId;
}

let runtime;
let graphStore;
let SkillGroupNode;

before(async () => {
  runtime = await import('../workflow-node-runtime.mjs');
  graphStore = await import('../workflow-graph-store.mjs');
  SkillGroupNode = await import('../workflow-node-types/skill-group-node.mjs');
});

describe('effectiveSkillGroups skillRefs enabled projection (W38-BE-FOLLOWUP)', () => {
  const roots = [];
  after(() => roots.forEach(cleanup));

  function seedPack(root) {
    return runtime.createNode(root, {
      type: 'skill-group',
      title: 'Agent Skill Pack',
      sourceGroup: { id: 'source:workflow', label: 'Workflow', kind: 'source' },
      skills: [
        { id: 'skill:wf-ui', name: 'wf-ui', title: 'WF-UI Adapter', source: 'project' },
        { id: 'skill:browser-lab', name: 'browser-lab', title: 'Browser Lab', source: 'project' },
        { id: 'skill:api-lab', name: 'api-lab', title: 'API Lab', source: 'project' },
      ],
    });
  }

  it('projects enabled:false onto effectiveSkillGroups[].skillRefs after setSkillEnabled(false)', async () => {
    const root = tempProjectRoot();
    roots.push(root);
    const pack = await seedPack(root);
    const nodeId = pack.node.nodeId;
    const agentId = seedAgentGraphNode(root);
    graphStore.connectNodes(root, {
      from: agentId,
      to: nodeId,
      relation: 'capability',
      sourceHandle: 'right',
      targetHandle: 'capability:left',
    });

    // Default state: every projected skillRef reports enabled:true
    const before = await runtime.getNodeContext(root, agentId);
    assert.equal(before.context.effectiveSkillGroups.length, 1);
    const skillRefsBefore = before.context.effectiveSkillGroups[0].skillRefs;
    assert.ok(Array.isArray(skillRefsBefore));
    assert.equal(skillRefsBefore.length, 3);
    for (const ref of skillRefsBefore) {
      assert.equal(ref.enabled, true, `skill ${ref.name} should default to enabled:true`);
    }

    // Toggle one skill off
    SkillGroupNode.setSkillEnabled(nodeId, root, { skillId: 'skill:browser-lab', enabled: false });

    const after = await runtime.getNodeContext(root, agentId);
    assert.equal(after.context.effectiveSkillGroups.length, 1);
    const skillRefsAfter = after.context.effectiveSkillGroups[0].skillRefs;
    const browserLab = skillRefsAfter.find(s => s.name === 'browser-lab');
    const wfUi = skillRefsAfter.find(s => s.name === 'wf-ui');
    const apiLab = skillRefsAfter.find(s => s.name === 'api-lab');
    assert.equal(browserLab.enabled, false, 'toggled skill must surface enabled:false in skillRefs');
    assert.equal(wfUi.enabled, true, 'untouched skills must remain enabled:true');
    assert.equal(apiLab.enabled, true, 'untouched skills must remain enabled:true');

    // Toggle back to true
    SkillGroupNode.setSkillEnabled(nodeId, root, { skillId: 'skill:browser-lab', enabled: true });
    const restored = await runtime.getNodeContext(root, agentId);
    const skillRefsRestored = restored.context.effectiveSkillGroups[0].skillRefs;
    const browserLabRestored = skillRefsRestored.find(s => s.name === 'browser-lab');
    assert.equal(browserLabRestored.enabled, true, 'toggled-back skill must surface enabled:true in skillRefs');

    // skillRefs remain body-free (no SKILL.md body, no absolute project path, no description)
    const serialized = JSON.stringify(restored.context.effectiveSkillGroups);
    assert.ok(!serialized.includes('SKILL.md'), 'effectiveSkillGroups.skillRefs must not leak SKILL.md body');
    assert.ok(!serialized.includes(root), 'effectiveSkillGroups.skillRefs must not leak absolute project path');
    for (const ref of skillRefsRestored) {
      const keys = Object.keys(ref).sort();
      // Body-free: only the lightweight projected fields are allowed
      assert.deepEqual(keys, ['enabled', 'id', 'name', 'source', 'state', 'title'], `unexpected skillRef fields: ${keys.join(',')}`);
    }
  });
});
