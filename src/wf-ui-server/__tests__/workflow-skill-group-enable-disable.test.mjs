import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { createCapabilityNode, getCapabilityNode, capabilityStateRefs } from '../workflow-capability-node-store.mjs';
import * as SkillGroupNode from '../workflow-node-types/skill-group-node.mjs';

function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), `.tmp-skill-enable-${id}`);
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function seedSkillGroup(root, overrides = {}) {
  return createCapabilityNode(root, {
    type: 'skill-group',
    title: overrides.title || 'Test Skill Pack',
    description: 'Test pack',
    sourceGroup: { id: 'family:test', label: 'Test', kind: 'family' },
    skills: overrides.skills || [
      { id: 'skill:wf-ui', name: 'wf-ui', title: 'WF-UI', source: 'project' },
      { id: 'skill:browser-lab', name: 'browser-lab', title: 'Browser Lab', source: 'project' },
      { id: 'skill:api-lab', name: 'api-lab', title: 'API Lab', source: 'project' },
    ],
  });
}

describe('skill-group setSkillEnabled (W38)', () => {
  const roots = [];
  after(() => roots.forEach(cleanup));

  it('toggles a skill enabled flag and persists (revision increments)', () => {
    const root = tempProjectRoot();
    roots.push(root);
    const created = seedSkillGroup(root);
    const nodeId = created.node.nodeId;

    const before = getCapabilityNode(root, nodeId);
    const wfUiBefore = before.state.skills.find(s => s.name === 'wf-ui');
    assert.equal(wfUiBefore.enabled, true, 'skills default to enabled');

    const result = SkillGroupNode.setSkillEnabled(nodeId, root, { skillId: 'skill:wf-ui', enabled: false });

    assert.equal(result.enabled, false);
    assert.equal(result.revision, before.node.revision + 1, 'revision must increment after toggle');

    const after = getCapabilityNode(root, nodeId);
    assert.equal(after.node.revision, before.node.revision + 1, 'revision must persist');
    const wfUiAfter = after.state.skills.find(s => s.name === 'wf-ui');
    assert.equal(wfUiAfter.enabled, false, 'disabled skill persists enabled:false');

    const browserLab = after.state.skills.find(s => s.name === 'browser-lab');
    assert.equal(browserLab.enabled, true, 'unrelated skills stay enabled');

    // group composition is unchanged (ids stay, only the flag flips)
    assert.deepEqual(after.state.skillNames, ['wf-ui', 'browser-lab', 'api-lab']);

    // read action reflects the flag too
    const readResult = SkillGroupNode.read(nodeId, root);
    const wfUiRead = readResult.skills.find(s => s.name === 'wf-ui');
    assert.equal(wfUiRead.enabled, false);
  });

  it('rejects a missing skillId', () => {
    const root = tempProjectRoot();
    roots.push(root);
    const created = seedSkillGroup(root);
    const nodeId = created.node.nodeId;

    assert.throws(
      () => SkillGroupNode.setSkillEnabled(nodeId, root, { enabled: false }),
      (err) => {
        assert.equal(err.code, 'SKILL_ID_REQUIRED');
        assert.equal(err.statusCode, 400);
        return true;
      },
    );

    // blank/whitespace skillId is also rejected
    assert.throws(
      () => SkillGroupNode.setSkillEnabled(nodeId, root, { skillId: '   ', enabled: false }),
      (err) => {
        assert.equal(err.code, 'SKILL_ID_REQUIRED');
        return true;
      },
    );

    // rejected call must not mutate persisted state
    const after = getCapabilityNode(root, nodeId);
    assert.equal(after.node.revision, 1);
  });

  it('reflects enabled:false in capability refs (agent-context source) without leaking bodies', () => {
    const root = tempProjectRoot();
    roots.push(root);
    const created = seedSkillGroup(root);
    const nodeId = created.node.nodeId;

    SkillGroupNode.setSkillEnabled(nodeId, root, { skillId: 'skill:browser-lab', enabled: false });

    const refs = capabilityStateRefs(root);
    const ref = refs[nodeId];
    assert.ok(ref, 'capability ref must exist for the skill-group node');

    const browserLab = ref.skills.find(s => s.name === 'browser-lab');
    assert.equal(browserLab.enabled, false, 'disabled skill surfaces enabled:false in capability refs');
    const wfUi = ref.skills.find(s => s.name === 'wf-ui');
    assert.equal(wfUi.enabled, true);

    // ids remain (group composition unchanged; only flag flips)
    assert.deepEqual(ref.skillNames, ['wf-ui', 'browser-lab', 'api-lab']);

    // body-free / absolute-path-free guarantee
    const serialized = JSON.stringify(refs);
    assert.ok(!serialized.includes('SKILL.md'), 'must not leak SKILL.md body');
    assert.ok(!serialized.includes(root), 'must not leak absolute project path');
    for (const skill of ref.skills) {
      const keys = Object.keys(skill).sort();
      assert.deepEqual(keys, ['enabled', 'id', 'name', 'source', 'state', 'title'], `unexpected skill fields: ${keys.join(',')}`);
    }
  });

  it('toggle is idempotent (repeated same-value call does not bump revision)', () => {
    const root = tempProjectRoot();
    roots.push(root);
    const created = seedSkillGroup(root);
    const nodeId = created.node.nodeId;

    const first = SkillGroupNode.setSkillEnabled(nodeId, root, { skillId: 'skill:api-lab', enabled: false });
    assert.equal(first.enabled, false);
    const revisionAfterFirst = first.revision;

    const second = SkillGroupNode.setSkillEnabled(nodeId, root, { skillId: 'skill:api-lab', enabled: false });
    assert.equal(second.enabled, false);
    assert.equal(second.revision, revisionAfterFirst, 'idempotent call must not increment revision');

    const fresh = getCapabilityNode(root, nodeId);
    assert.equal(fresh.node.revision, revisionAfterFirst, 'persisted revision unchanged after no-op');
    const apiLab = fresh.state.skills.find(s => s.name === 'api-lab');
    assert.equal(apiLab.enabled, false);

    // flipping back to true bumps revision again (not a no-op)
    const toggled = SkillGroupNode.setSkillEnabled(nodeId, root, { skillId: 'skill:api-lab', enabled: true });
    assert.equal(toggled.enabled, true);
    assert.equal(toggled.revision, revisionAfterFirst + 1, 'real toggle must increment revision');
  });

  it('rejects an unknown skillId', () => {
    const root = tempProjectRoot();
    roots.push(root);
    const created = seedSkillGroup(root);
    const nodeId = created.node.nodeId;

    assert.throws(
      () => SkillGroupNode.setSkillEnabled(nodeId, root, { skillId: 'skill:does-not-exist', enabled: false }),
      (err) => {
        assert.equal(err.code, 'SKILL_NOT_FOUND');
        assert.equal(err.statusCode, 404);
        return true;
      },
    );
  });

  it('rejects non-boolean enabled', () => {
    const root = tempProjectRoot();
    roots.push(root);
    const created = seedSkillGroup(root);
    const nodeId = created.node.nodeId;

    assert.throws(
      () => SkillGroupNode.setSkillEnabled(nodeId, root, { skillId: 'skill:wf-ui', enabled: 'nope' }),
      (err) => {
        assert.equal(err.code, 'INVALID_ENABLED');
        assert.equal(err.statusCode, 400);
        return true;
      },
    );
  });
});
