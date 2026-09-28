import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), `.tmp-skills-hub-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({
    schemaVersion: 1,
    version: 1,
    nodes: [],
    edges: [],
    positions: {},
    undoStack: [],
    redoStack: [],
    deletedNodes: [],
  }));
  return dir;
}

function writeSkill(root, relDir, frontmatter, body = '# Skill\n') {
  const dir = path.join(root, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}`, 'utf8');
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function jsonRequest(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET' }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Workflow Skills Hub', () => {
  const roots = [];
  after(() => roots.forEach(cleanup));

  it('indexes project .agents and .claude skills without exposing absolute paths', async () => {
    const root = tempProjectRoot();
    roots.push(root);
    writeSkill(root, '.agents/skills/wf-ui', 'name: wf-ui\ndescription: Open the local workflow control panel.', '# WF UI\n');
    writeSkill(root, '.claude/skills/wf-ui', 'name: wf-ui\ndescription: Claude mirror for wf-ui.', '# WF UI Mirror\n');
    writeSkill(root, '.agents/skills/custom-pack/review', 'name: custom-pack:review\ndescription: Review helper.', '# Review Skill\n');

    const hub = await import('../workflow-skills-hub.mjs');
    const result = hub.listSkillsHub(root, { scope: 'project' });

    assert.equal(result.ok, true);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.kind, 'skills-hub');
    assert.deepEqual(result.query, { scope: 'project', q: '', limit: 250 });
    assert.equal(result.nodeSemantics.role, 'agent-attached-capability-provider');
    assert.ok(result.summary.skillCount >= 2);

    const wfUi = result.skills.find(skill => skill.name === 'wf-ui');
    assert.ok(wfUi, 'wf-ui skill should be indexed');
    assert.equal(wfUi.id, 'skill:wf-ui');
    assert.equal(wfUi.attachable, true);
    assert.equal(wfUi.state, 'indexed');
    assert.ok(wfUi.sources.length >= 2, 'duplicate skill mirrors should merge into one skill with multiple sources');
    assert.ok(wfUi.sources.every(source => !path.isAbsolute(source.path)), `absolute path leaked: ${JSON.stringify(wfUi.sources)}`);

    const custom = result.skills.find(skill => skill.name === 'custom-pack:review');
    assert.ok(custom, 'colon names should be valid skill ids');
    assert.equal(custom.id, 'skill:custom-pack:review');
    assert.ok(result.groups.some(group => group.id === 'family:custom' || group.id === 'family:custom-pack'));
  });

  it('scans all five user runtimes and reports missing conventional project roots without throwing', async () => {
    const projectRoot = tempProjectRoot();
    const fakeHome = path.join(projectRoot, 'fake-home');
    roots.push(projectRoot);
    fs.mkdirSync(fakeHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;

    try {
      writeSkill(fakeHome, '.codex/skills/codex-fixture', 'name: codex-fixture\ndescription: Codex user skill.');
      writeSkill(fakeHome, '.claude/skills/claude-fixture', 'name: claude-fixture\ndescription: Claude user skill.');
      writeSkill(fakeHome, '.config/opencode/skills/opencode-fixture', 'name: opencode-fixture\ndescription: OpenCode user skill.');
      writeSkill(fakeHome, '.pi/skills/pi-fixture', 'name: pi-fixture\ndescription: Pi user skill.');
      writeSkill(fakeHome, '.copilot/skills/copilot-fixture', 'name: copilot-fixture\ndescription: Copilot user skill.');

      const hub = await import('../workflow-skills-hub.mjs');
      const userResult = hub.listSkillsHub(projectRoot, { scope: 'user' });
      assert.equal(userResult.ok, true);
      assert.deepEqual(
        [...new Set(userResult.roots.map(root => root.runtime))].sort(),
        ['claude', 'codex', 'copilot', 'opencode', 'pi'],
      );
      for (const name of ['codex-fixture', 'claude-fixture', 'opencode-fixture', 'pi-fixture', 'copilot-fixture']) {
        assert.ok(userResult.skills.some(skill => skill.name === name), `${name} should be indexed from its runtime root`);
      }
      for (const root of userResult.roots) {
        assert.equal(typeof root.rootPath, 'string');
        assert.equal(typeof root.path, 'string');
        assert.equal(typeof root.exists, 'boolean');
        assert.equal(root.scope, 'user');
      }

      const emptyHome = path.join(projectRoot, 'empty-home');
      fs.mkdirSync(emptyHome, { recursive: true });
      process.env.HOME = emptyHome;
      process.env.USERPROFILE = emptyHome;
      const missingUserResult = hub.listSkillsHub(projectRoot, { scope: 'user' });
      assert.equal(missingUserResult.ok, true, 'missing runtime skill roots should not throw');
      assert.deepEqual(
        [...new Set(missingUserResult.roots.map(root => root.runtime))].sort(),
        ['claude', 'codex', 'copilot', 'opencode', 'pi'],
      );
      assert.ok(missingUserResult.roots.every(root => root.exists === false));

      const projectResult = hub.listSkillsHub(projectRoot, { scope: 'project' });
      assert.equal(projectResult.ok, true);
      assert.ok(projectResult.roots.some(root => root.exists === false), 'absent project skill directories must be represented with exists:false');
      assert.ok(projectResult.roots.every(root => root.scope === 'project'));
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
    }
  });

  it('groups hyphenated and colon-delimited skill names under their first name family', async () => {
    const root = tempProjectRoot();
    roots.push(root);
    writeSkill(root, '.agents/skills/lark-search', 'name: lark-search\ndescription: Search helper.');
    writeSkill(root, '.agents/skills/lark-calendar-colon', 'name: lark:calendar\ndescription: Calendar helper.');

    const hub = await import('../workflow-skills-hub.mjs');
    const result = hub.listSkillsHub(root, { scope: 'project' });
    const family = result.groups.find(group => group.id === 'family:lark');

    assert.ok(family, 'server grouping should use family:lark for both supported separators');
    assert.equal(family.kind, 'name-family');
    assert.deepEqual(new Set(family.skillIds), new Set(['skill:lark-search', 'skill:lark:calendar']));
  });

  it('GET /api/workflow/skills-hub returns a searchable project-scoped hub index', async () => {
    const root = tempProjectRoot();
    roots.push(root);
    writeSkill(root, '.agents/skills/browser-lab', 'name: browser-lab\ndescription: Browser automation helper.', '# Browser Lab\n');
    writeSkill(root, '.agents/skills/api-lab', 'name: api-lab\ndescription: Backend API helper.', '# API Lab\n');

    const mod = await import('../server.mjs');
    const sessionMock = { getAll: () => [], get: () => null, create: () => {}, stop: () => null, update: () => {}, remove: () => {}, withLock: (_k, fn) => Promise.resolve().then(fn) };
    const server = mod.createServer({ projectRoot: root, sessionRegistry: sessionMock, token: '' });
    await new Promise(resolve => server.listen(0, resolve));
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const all = await jsonRequest(`${baseUrl}/api/workflow/skills-hub?scope=project`);
      assert.equal(all.status, 200, JSON.stringify(all.body));
      assert.equal(all.body.ok, true);
      assert.ok(all.body.skills.some(skill => skill.name === 'browser-lab'));
      assert.ok(all.body.skills.some(skill => skill.name === 'api-lab'));
      assert.deepEqual(all.body.nodeSemantics, {
        role: 'agent-attached-capability-provider',
        defaultConnection: 'bidirectional capability/status port to Agent nodes',
        executor: 'agent',
      });

      const filtered = await jsonRequest(`${baseUrl}/api/workflow/skills-hub?scope=project&q=browser`);
      assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
      assert.deepEqual(filtered.body.skills.map(skill => skill.name), ['browser-lab']);

      const defaultScope = await jsonRequest(`${baseUrl}/api/workflow/skills-hub`);
      assert.equal(defaultScope.status, 200, JSON.stringify(defaultScope.body));
      assert.equal(defaultScope.body.query.scope, 'project');
      assert.ok(defaultScope.body.roots.every(root => root.scope === 'project'));

      const badScope = await jsonRequest(`${baseUrl}/api/workflow/skills-hub?scope=..%2Fuser`);
      assert.equal(badScope.status, 400, JSON.stringify(badScope.body));
      assert.equal(badScope.body.error.code, 'INVALID_SCOPE');
    } finally {
      server.close();
    }
  });
});
