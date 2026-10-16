import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateProject,
  makeProjectWorkspace,
  readProjectManifest,
  runProjectCli,
  successfulJson,
} from './support/project-management.js';
import {
  listWorkspaceProjects,
  registerWorkspaceProject,
  readProjectSection,
  searchProjectRecords,
  showProject,
  summarizeProject,
  validateProjectTree,
  writeProjectRecord,
} from '../templates/common/Harness/scripts/lib/project-store.mjs';

const workspaces = [];
after(() => workspaces.forEach(root => fs.rmSync(root, { recursive: true, force: true })));

function makeProject(name) {
  const workspace = makeProjectWorkspace('project-store-review-');
  workspaces.push(workspace);
  return generateProject(workspace, name, name);
}

function addPlanRecords(root, count) {
  for (let index = 0; index < count; index += 1) {
    const id = `review-plan-${String(index).padStart(3, '0')}`;
    writeProjectRecord({
      projectRoot: root,
      section: 'plan',
      record: { id, kind: 'milestone', title: `Milestone ${index}`, content: 'match body', createdAt: '2026-01-01T00:00:00Z' },
    });
  }
}

function instrumentOpensUnder(root, run) {
  const originalOpenSync = fs.openSync;
  let opened = 0;
  fs.openSync = function countOpens(file, ...args) {
    if (path.resolve(String(file)).startsWith(root)) opened += 1;
    return originalOpenSync.call(fs, file, ...args);
  };
  try {
    return { result: run(), opened: () => opened };
  } finally {
    fs.openSync = originalOpenSync;
  }
}

test('AC-003 page bytes describe the final JSON and the final JSON stays within budget', () => {
  const root = makeProject('page-byte-count');
  addPlanRecords(root, 10);
  const fullPage = readProjectSection({ projectRoot: root, section: 'plan', limit: 10 });
  const actualBytes = Buffer.byteLength(JSON.stringify(fullPage));
  assert.equal(fullPage.bytes, actualBytes);

  const budgetedPage = readProjectSection({ projectRoot: root, section: 'plan', limit: 10, budgetBytes: actualBytes - 1 });
  const budgetedBytes = Buffer.byteLength(JSON.stringify(budgetedPage));
  assert.equal(budgetedPage.bytes, budgetedBytes);
  assert.ok(budgetedBytes <= actualBytes - 1);
});

test('AC-003 domain section reads stop when the response byte budget is filled', () => {
  const root = makeProject('bounded-domain-page');
  addPlanRecords(root, 10);
  const recordsRoot = path.join(root, 'Harness', 'project', 'plan', 'milestones');
  const measured = instrumentOpensUnder(recordsRoot, () => readProjectSection({
    projectRoot: root,
    section: 'plan',
    limit: 10,
    budgetBytes: 512,
  }));
  assert.ok(measured.result.items.length > 0, 'the small page budget should still fit a minimal record');
  assert.ok(measured.result.items.length < 10, 'the byte budget should reduce the requested item count');
  assert.ok(measured.opened() <= measured.result.items.length + 1, 'only returned record bodies plus at most one boundary candidate should be read');
});

test('AC-003 progress section reads stop after the byte budget is filled', () => {
  const root = makeProject('bounded-progress-page');
  for (let month = 1; month <= 10; month += 1) {
    writeProjectRecord({
      projectRoot: root,
      section: 'progress',
      record: {
        id: `review-progress-${String(month).padStart(2, '0')}`,
        kind: 'delivery',
        title: `Delivery ${month}`,
        content: 'small body',
        createdAt: `2026-${String(month).padStart(2, '0')}-15T12:00:00Z`,
      },
    });
  }
  const segmentsRoot = path.join(root, 'Harness', 'project', 'progress', 'segments');
  const measured = instrumentOpensUnder(segmentsRoot, () => readProjectSection({
    projectRoot: root,
    section: 'progress',
    limit: 10,
    budgetBytes: 1024,
  }));
  assert.ok(measured.result.items.length > 0);
  assert.ok(measured.result.items.length < 10);
  assert.ok(measured.opened() <= measured.result.items.length + 1, 'continuation should not read every candidate segment body');
});

test('AC-003 domain indexes accept reordered keys but reject structural changes', () => {
  const root = makeProject('reordered-index');
  const indexPath = path.join(root, 'Harness', 'project', 'plan', 'INDEX.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  fs.writeFileSync(indexPath, JSON.stringify(Object.fromEntries(Object.entries(index).reverse())));

  assert.doesNotThrow(() => readProjectSection({ projectRoot: root, section: 'plan' }));
  assert.equal(validateProjectTree(root).ok, true);

  const invalid = { ...index, unexpected: true };
  fs.writeFileSync(indexPath, JSON.stringify(invalid));
  assert.throws(() => readProjectSection({ projectRoot: root, section: 'plan' }), error => error.code === 'INVALID_INDEX');
});

test('AC-003 explicit search enforces a per-request scan ceiling', () => {
  const root = makeProject('bounded-search');
  addPlanRecords(root, 5);
  const recordsRoot = path.join(root, 'Harness', 'project', 'plan', 'milestones');
  let opened = 0;
  const originalOpenSync = fs.openSync;
  fs.openSync = function countRecordOpens(file, ...args) {
    if (path.resolve(String(file)).startsWith(recordsRoot)) opened += 1;
    return originalOpenSync.call(fs, file, ...args);
  };
  let result = null;
  let failure = null;
  try {
    try {
      result = searchProjectRecords({ projectRoot: root, section: 'plan', query: 'match', maxScanRecords: 2 });
    } catch (error) {
      failure = error;
    }
  } finally {
    fs.openSync = originalOpenSync;
  }
  assert.ok(failure || result, 'search must either report its scan-budget boundary or return a continuation page');
  if (failure) assert.equal(failure.code, 'BUDGET_EXCEEDED');
  else {
    assert.equal(result.scanned, 2);
    assert.ok(result.nextCursor || result.truncated);
  }
  assert.ok(opened <= 2, `search read ${opened} record bodies despite maxScanRecords=2`);
});

test('AC-003 search cursors retain records with duplicate IDs across sections', () => {
  const root = makeProject('search-composite-cursor');
  for (const [section, id, title] of [
    ['plan', 'shared-match', 'Plan match'],
    ['risks', 'shared-match', 'Risk match'],
    ['plan', 'z-match', 'Later match'],
  ]) {
    writeProjectRecord({
      projectRoot: root,
      section,
      record: { id, kind: section === 'plan' ? 'milestone' : 'risk', title, content: 'match body', createdAt: '2026-01-01T00:00:00Z' },
    });
  }

  const seen = [];
  let cursor = null;
  do {
    const page = searchProjectRecords({ projectRoot: root, query: 'match', limit: 1, cursor });
    seen.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  assert.equal(seen.length, 3, 'the cursor must not collapse same-ID matches from different Project sections');
  assert.deepEqual(seen.filter(record => record.id === 'shared-match').map(record => record.section).sort(), ['plan', 'risks']);
});

test('AC-003 search cursors are bound to the Project and normalized query', () => {
  const root = makeProject('search-cursor-binding');
  addPlanRecords(root, 2);
  const firstPage = searchProjectRecords({ projectRoot: root, query: 'match', limit: 1 });
  assert.throws(
    () => searchProjectRecords({ projectRoot: root, query: 'different-query', limit: 1, cursor: firstPage.nextCursor }),
    error => error.code === 'BAD_REQUEST',
    'opaque search cursors must bind the Project and normalized query',
  );
});

test('AC-003 search CLI forwards cursor, limit, and byte-budget controls', () => {
  const root = makeProject('search-cli-pagination');
  addPlanRecords(root, 3);
  const projectId = readProjectManifest(root).id;
  const argumentsForSearch = ['search', projectId, '--query', 'match', '--limit', '1', '--budget-bytes', '2048'];
  const first = successfulJson(runProjectCli(root, [...argumentsForSearch, '--json']));
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);

  const second = successfulJson(runProjectCli(root, [...argumentsForSearch, '--cursor', first.nextCursor, '--json']));
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0].id, first.items[0].id);
});

test('AC-003 domain paging reaches records whose file stem differs from the record id', () => {
  const root = makeProject('domain-cursor-stem');
  addPlanRecords(root, 2);
  const handAuthored = path.join(root, 'Harness', 'project', 'plan', 'milestones', 'aaa-hand-authored.json');
  fs.writeFileSync(handAuthored, `${JSON.stringify({
    schemaVersion: 1,
    id: 'zzz-record',
    section: 'plan',
    kind: 'milestone',
    title: 'Hand authored',
    content: 'body',
    createdAt: '2026-01-01T00:00:00Z',
  }, null, 2)}\n`, 'utf8');

  const seen = [];
  let cursor = null;
  do {
    const page = readProjectSection({ projectRoot: root, section: 'plan', limit: 1, cursor });
    seen.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  assert.equal(seen.length, 3, 'paging must not skip a record whose file stem is not its id');
  assert.ok(seen.some(record => record.id === 'zzz-record'));
  assert.ok(seen.some(record => record.id === 'review-plan-000'));
  assert.ok(seen.some(record => record.id === 'review-plan-001'));
});

test('AC-003 malformed progress JSON returns a typed record error instead of a raw SyntaxError', () => {
  const root = makeProject('malformed-progress-json');
  const segmentDir = path.join(root, 'Harness', 'project', 'progress', 'segments', '2026', '01');
  fs.mkdirSync(segmentDir, { recursive: true });
  fs.writeFileSync(path.join(segmentDir, '0001.jsonl'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'progress-good',
    section: 'progress',
    kind: 'delivery',
    title: 'Good',
    content: 'body',
    createdAt: '2026-01-01T00:00:00Z',
  })}\n{"broken": \n`, 'utf8');

  for (const run of [
    () => readProjectSection({ projectRoot: root, section: 'progress', limit: 5 }),
    () => readProjectSection({ projectRoot: root, section: 'progress', limit: 5, cursor: null }),
    () => searchProjectRecords({ projectRoot: root, query: 'body', sections: ['progress'] }),
  ]) {
    assert.throws(run, error => error.code === 'INVALID_RECORD', 'corrupt progress JSON must surface as INVALID_RECORD');
  }
});

test('AC-003 charter validation rejects unsupported fields and future schema markers', () => {
  const root = makeProject('strict-charter');
  const charterPath = path.join(root, 'Harness', 'project', 'charter.json');
  const charter = JSON.parse(fs.readFileSync(charterPath, 'utf8'));
  fs.writeFileSync(charterPath, `${JSON.stringify({ ...charter, unsupportedField: 'x' }, null, 2)}\n`, 'utf8');

  assert.throws(
    () => readProjectSection({ projectRoot: root, section: 'charter' }),
    error => error.code === 'INVALID_CHARTER',
  );
  assert.equal(validateProjectTree(root).ok, false, 'validate must report an unsupported charter field');

  const projectId = readProjectManifest(root).id;
  const failed = runProjectCli(root, ['charter', projectId, '--goal', 'Updated', '--apply', '--json']);
  assert.notEqual(failed.status, 0, 'a charter update must not silently preserve unsupported fields');
});

test('AC-003 duplicate progress record ids are rejected instead of shadowed', () => {
  const root = makeProject('duplicate-progress-id');
  const record = { id: 'dup-progress', kind: 'delivery', title: 'First', content: 'body', createdAt: '2026-01-01T00:00:00Z' };
  writeProjectRecord({ projectRoot: root, section: 'progress', record });
  assert.throws(
    () => writeProjectRecord({ projectRoot: root, section: 'progress', record: { ...record, title: 'Second' } }),
    error => error.code === 'CONFLICT',
  );
});

test('AC-003 one stray route file does not make every Project unlistable', () => {
  const workspace = makeProjectWorkspace('project-store-stray-route-');
  workspaces.push(workspace);
  const alpha = generateProject(workspace, 'stray-alpha', 'Stray Alpha');
  const beta = generateProject(workspace, 'stray-beta', 'Stray Beta');
  const alphaId = readProjectManifest(alpha).id;
  const betaId = readProjectManifest(beta).id;

  registerWorkspaceProject(workspace, alpha);
  registerWorkspaceProject(workspace, beta);

  const stray = path.join(workspace, '.harness-workspace', 'routes', 'active', 'zz', 'stray-project.json');
  fs.mkdirSync(path.dirname(stray), { recursive: true });
  fs.writeFileSync(stray, `${JSON.stringify({ schemaVersion: 1, id: 'stray-project', root: 'stray-alpha', entry: 'Harness/project/PROJECT.json' }, null, 2)}\n`, 'utf8');

  const listed = listWorkspaceProjects(workspace, { limit: 10 });
  const ids = listed.projects.map(project => project.id);
  assert.ok(ids.includes(alphaId) && ids.includes(betaId), 'valid Projects must still be listed');
  assert.ok(listed.invalid.some(entry => entry.id === 'stray-project'), 'the stray route must be reported as invalid');
});

test('AC-003 show and summary clamp the byte budget like other bounded reads', () => {
  const root = makeProject('clamped-show-summary');
  const projectId = readProjectManifest(root).id;

  // Out-of-range budgets clamp to the same 512-byte / 64 KiB bounds as
  // list/section instead of being passed through unchanged.
  assert.deepEqual(
    summarizeProject({ projectRoot: root, budgetBytes: 1 }),
    summarizeProject({ projectRoot: root, budgetBytes: 512 }),
  );
  assert.deepEqual(
    showProject({ projectRoot: root, budgetBytes: 10 ** 9 }),
    showProject({ projectRoot: root, budgetBytes: 65536 }),
  );

  const huge = summarizeProject({ projectRoot: root, budgetBytes: 10 ** 9 });
  assert.ok(huge.bytes > 0 && huge.bytes <= 65536);
  assert.equal(huge.projectId, projectId);

  const shown = successfulJson(runProjectCli(root, ['show', projectId, '--budget-bytes', '1000000000', '--json']));
  assert.equal(shown.project.id, projectId);
  assert.ok(Buffer.byteLength(JSON.stringify(shown)) <= 65536);
});

test('AC-003 a page of only invalid routes still advances the workspace cursor', () => {
  const workspace = makeProjectWorkspace('project-store-invalid-page-');
  workspaces.push(workspace);
  const alpha = generateProject(workspace, 'page-alpha', 'Page Alpha');
  const beta = generateProject(workspace, 'page-beta', 'Page Beta');
  const alphaId = readProjectManifest(alpha).id;
  const betaId = readProjectManifest(beta).id;
  registerWorkspaceProject(workspace, alpha);
  registerWorkspaceProject(workspace, beta);

  // A stray route that sorts before both real ids and cannot be resolved.
  const stray = path.join(workspace, '.harness-workspace', 'routes', 'active', 'zz', '000-stray.json');
  fs.mkdirSync(path.dirname(stray), { recursive: true });
  fs.writeFileSync(stray, `${JSON.stringify({ schemaVersion: 1, id: '000-stray', root: 'missing-root', entry: 'Harness/project/PROJECT.json' }, null, 2)}\n`, 'utf8');

  const seen = [];
  let cursor = null;
  for (let step = 0; step < 5; step += 1) {
    const page = listWorkspaceProjects(workspace, { limit: 1, cursor });
    seen.push(...page.projects.map(project => project.id));
    cursor = page.nextCursor;
    if (!cursor) break;
  }

  assert.ok(seen.includes(alphaId), 'paging must not dead-end before reaching a valid Project');
  assert.ok(seen.includes(betaId), 'paging must reach every valid Project');
});
