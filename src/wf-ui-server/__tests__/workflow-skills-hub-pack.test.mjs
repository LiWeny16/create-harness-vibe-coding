import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import * as runtime from '../workflow-node-runtime.mjs';

function makeProject() {
  const root = makeHarnessTempRoot('wf-skills-hub-pack-');
  fs.mkdirSync(path.join(root, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
  fs.writeFileSync(path.join(root, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({
    schemaVersion: 1,
    version: 1,
    nodes: [],
    edges: [],
    positions: {},
    undoStack: [],
    redoStack: [],
    deletedNodes: [],
  }));
  return root;
}

test('AC-003 skill-group prompt can be configured, read back, and persisted', async () => {
  const root = makeProject();
  try {
    const created = await runtime.createNode(root, {
      type: 'skill-group',
      title: 'Research Pack',
      skills: [
        { id: 'skill:browser-lab', name: 'browser-lab', title: 'Browser Lab', source: 'project' },
        { id: 'skill:api-lab', name: 'api-lab', title: 'API Lab', source: 'project' },
      ],
    });
    const prompt = 'Use browser-lab for site research and api-lab for API checks.';
    const configured = await runtime.executeNodeAction(root, created.node.nodeId, 'skill-group.configure', { prompt });

    assert.equal(configured.ok, true);
    assert.ok(JSON.stringify(configured).includes(prompt), 'configure response should return the saved prompt');

    const statePath = path.join(root, created.node.stateRef.path);
    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(persisted.prompt, prompt, 'prompt should be stored as lightweight pack state');
    assert.ok(!JSON.stringify(persisted).includes(root), 'pack state must not persist absolute project paths');
    assert.ok(!JSON.stringify(persisted).includes('SKILL.md'), 'pack state must not persist skill bodies');

    const read = await runtime.executeNodeAction(root, created.node.nodeId, 'skill-group.read', {});
    assert.equal(read.ok, true);
    assert.ok(JSON.stringify(read).includes(prompt), 'skill-group.read should return the configured prompt');

    const listed = await runtime.listNodes(root);
    assert.ok(Array.isArray(listed.nodes));
    const listedPack = listed.nodes.find(node => node.nodeId === created.node.nodeId);
    assert.ok(listedPack, 'configured pack should appear in node list');
    assert.ok(
      JSON.stringify(listedPack).includes(prompt),
      'node list should return the configured prompt with the pack',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
