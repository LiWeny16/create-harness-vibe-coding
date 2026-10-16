import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, stopServer } from '../src/wf-ui-server/server.mjs';
import {
  generateProject,
  makeProjectWorkspace,
  readProjectManifest,
  registerProject,
  runProjectCli,
  successfulJson,
} from './support/project-management.js';

const workspaces = [];
const servers = [];
after(async () => {
  while (servers.length) await stopServer(servers.pop());
  workspaces.forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

async function startProjectApi(projectRoot, workspaceRoot) {
  const started = await startServer({
    projectRoot,
    workspaceRoot,
    host: '127.0.0.1',
    port: 0,
    eventsWs: false,
    chatWs: false,
  });
  servers.push(started.server);
  return { ...started, baseUrl: `http://127.0.0.1:${started.port}` };
}

async function requestJson(baseUrl, route, { method = 'GET', body } = {}) {
  const response = await fetch(new URL(route, baseUrl), {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function setup() {
  const workspace = makeProjectWorkspace('project-api-');
  workspaces.push(workspace);
  const alpha = generateProject(workspace, 'alpha', 'Alpha');
  const beta = generateProject(workspace, 'beta', 'Beta');
  const alphaManifest = readProjectManifest(alpha);
  const betaManifest = readProjectManifest(beta);
  successfulJson(registerProject(alpha, workspace));
  successfulJson(registerProject(beta, workspace));
  return { workspace, alpha, beta, alphaManifest, betaManifest };
}

test('AC-001/AC-006 API lists and resolves the same isolated Project routes as the CLI', async () => {
  const { workspace, alpha, beta, alphaManifest, betaManifest } = setup();
  const { baseUrl } = await startProjectApi(alpha, workspace);
  const list = await requestJson(baseUrl, '/api/projects?limit=10');
  const alphaShow = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}`);
  const betaShow = await requestJson(baseUrl, `/api/projects/${betaManifest.id}`);

  assert.equal(list.status, 200);
  assert.deepEqual(new Set(list.body.projects.map(project => project.id)), new Set([alphaManifest.id, betaManifest.id]));
  assert.equal(alphaShow.status, 200);
  assert.equal(betaShow.status, 200);
  assert.equal(alphaShow.body.project.id, alphaManifest.id);
  assert.equal(betaShow.body.project.id, betaManifest.id);
  assert.equal(alphaShow.body.projectRoot, alpha);
  assert.equal(betaShow.body.projectRoot, beta);
});

test('AC-002/AC-006 Project summary API matches CLI and state updates use optimistic revisions', async () => {
  const { workspace, alpha, alphaManifest } = setup();
  const { baseUrl } = await startProjectApi(alpha, workspace);
  const cli = successfulJson(runProjectCli(alpha, ['summary', alphaManifest.id, '--workspace', workspace, '--json']));
  const api = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}/summary`);
  assert.equal(api.status, 200);
  assert.deepEqual(api.body, cli);
  assert.equal(api.body.generated, true);

  const updated = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}`, {
    method: 'PATCH',
    body: { expectedRevision: alphaManifest.revision, status: 'paused' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.project.status, 'paused');
  const stale = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}`, {
    method: 'PATCH',
    body: { expectedRevision: alphaManifest.revision, status: 'active' },
  });
  assert.equal(stale.status, 409);
});

test('AC-003 API section reads stay within byte budget and do not return unrelated project or history content', async () => {
  const { workspace, alpha, alphaManifest, beta, betaManifest } = setup();
  const { baseUrl } = await startProjectApi(alpha, workspace);
  const betaManifestPath = path.join(beta, 'Harness', 'project', 'PROJECT.json');
  const held = `${betaManifestPath}.hold`;
  fs.renameSync(betaManifestPath, held);
  try {
    const result = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}/sections/plan?budgetBytes=8192&limit=5`);
    assert.equal(result.status, 200);
    assert.ok(result.body.bytes <= 8192);
    assert.equal(JSON.stringify(result.body).includes(betaManifest.id), false);
    assert.ok(Object.hasOwn(result.body, 'nextCursor'));
  } finally {
    fs.renameSync(held, betaManifestPath);
  }
  assert.ok(betaManifest.id);
});

test('AC-005/AC-006 local API list omits archived Projects by default and honors includeArchived cursor paging', async () => {
  const { alpha, alphaManifest } = setup();
  const { baseUrl } = await startProjectApi(alpha, alpha);
  successfulJson(runProjectCli(alpha, ['archive', alphaManifest.id, '--apply', '--json']));
  const hidden = await requestJson(baseUrl, '/api/projects?limit=1');
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.projects.some(project => project.id === alphaManifest.id), false);
  const included = await requestJson(baseUrl, '/api/projects?includeArchived=true&limit=1');
  assert.equal(included.status, 200);
  assert.equal(included.body.projects.length, 1);
  assert.ok(included.body.bytes > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(included.body)) <= 8192);
  const afterCursor = await requestJson(baseUrl, `/api/projects?includeArchived=true&limit=1&cursor=${alphaManifest.id}&budgetBytes=8192`);
  assert.equal(afterCursor.status, 200);
  assert.equal(afterCursor.body.projects.length, 0);
});

test('AC-004/AC-006 API import conflict preserves safe structured CLI error details', async () => {
  const { workspace, alpha, alphaManifest } = setup();
  const source = path.join(alpha, 'Plan.md');
  fs.writeFileSync(source, '# Plan\n## Candidate\n');
  const preview = successfulJson(runProjectCli(alpha, ['import', alphaManifest.id, '--source', 'Plan.md', '--json']));
  const applied = successfulJson(runProjectCli(alpha, ['import', alphaManifest.id, '--source', 'Plan.md', '--apply', '--plan-hash', preview.planHash, '--json']));
  assert.ok(applied.outputs.length > 0);
  fs.appendFileSync(path.join(alpha, applied.outputs[0].path), '\nexternal change\n');
  const cli = runProjectCli(alpha, ['rollback', '--transaction', applied.transactionId, '--apply', '--json']);
  const cliBody = JSON.parse(cli.stdout);
  const { baseUrl } = await startProjectApi(alpha, workspace);
  const api = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}/imports/${applied.transactionId}/rollback`, { method: 'POST', body: { apply: true } });
  assert.notEqual(cli.status, 0);
  assert.equal(api.status, 409);
  assert.ok(Array.isArray(cliBody.error.details.conflicts));
  assert.ok(Array.isArray(api.body.error.details?.conflicts));
  assert.deepEqual(
    api.body.error.details.conflicts.map(({ path: itemPath, reason }) => ({ path: itemPath, reason })),
    cliBody.error.details.conflicts.map(({ path: itemPath, reason }) => ({ path: itemPath, reason })),
  );
});

test('AC-003/AC-006 API Project record writes enforce schema fields and serialized-byte limits', async () => {
  const { workspace, alpha, alphaManifest } = setup();
  const { baseUrl } = await startProjectApi(alpha, workspace);
  const results = await Promise.all([
    requestJson(baseUrl, `/api/projects/${alphaManifest.id}/records`, {
      method: 'POST',
      body: { section: 'plan', id: 'invalid-date-api', kind: 'milestone', title: 'Invalid date', content: '', createdAt: 'not-a-date' },
    }),
    requestJson(baseUrl, `/api/projects/${alphaManifest.id}/records`, {
      method: 'POST',
      body: { section: 'plan', id: 'unknown-field-api', kind: 'milestone', title: 'Unknown field', content: '', createdAt: '2026-01-01T00:00:00Z', unexpected: true },
    }),
    requestJson(baseUrl, `/api/projects/${alphaManifest.id}/records`, {
      method: 'POST',
      body: { section: 'plan', id: 'oversized-api', kind: 'milestone', title: 'Large source', content: '', createdAt: '2026-01-01T00:00:00Z', source: { url: 'x'.repeat(9000) } },
    }),
  ]);
  assert.deepEqual(results.map(result => result.status), [422, 422, 413], 'invalid date, extra fields, and oversized records must all be rejected');
});

test('AC-004 API import preview stays read-only and returns a hash required for explicit apply', async () => {
  const { workspace, alpha, alphaManifest } = setup();
  const source = path.join(alpha, 'legacy-Plan.md');
  fs.writeFileSync(source, '# Plan\n## Candidate\n- status: unspecified\n');
  const before = fs.readFileSync(source);
  const { baseUrl } = await startProjectApi(alpha, workspace);
  const preview = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}/imports/preview`, {
    method: 'POST',
    body: { sources: ['legacy-Plan.md'] },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.dryRun, true);
  assert.match(preview.body.planHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(fs.readFileSync(source), before);
});

test('AC-005/AC-006 API archive and restore require an optimistic revision', async () => {
  const { workspace, alpha, alphaManifest } = setup();
  const { baseUrl } = await startProjectApi(alpha, workspace);

  const withoutRevision = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}/archive`, { method: 'POST' });
  assert.equal(withoutRevision.status, 400, JSON.stringify(withoutRevision.body));
  assert.equal(readProjectManifest(alpha).status, 'active', 'a revision-less archive must not mutate the Project');

  const nullRevision = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}/archive`, {
    method: 'POST',
    body: { expectedRevision: null },
  });
  assert.equal(nullRevision.status, 400, `null must not pass as an integer revision: ${JSON.stringify(nullRevision.body)}`);

  const patchNull = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}`, {
    method: 'PATCH',
    body: { expectedRevision: null, stage: 'planning' },
  });
  assert.equal(patchNull.status, 400, `PATCH must reject a null revision: ${JSON.stringify(patchNull.body)}`);

  const charterNull = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}/charter`, {
    method: 'PUT',
    body: { expectedRevision: null, goal: 'Silently accepted' },
  });
  assert.equal(charterNull.status, 400, `charter update must reject a null revision: ${JSON.stringify(charterNull.body)}`);
  assert.equal(readProjectManifest(alpha).stage, alphaManifest.stage, 'rejected writes must not mutate the Project');

  const stale = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}/archive`, {
    method: 'POST',
    body: { expectedRevision: alphaManifest.revision + 5 },
  });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(readProjectManifest(alpha).status, 'active');

  const archived = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}/archive`, {
    method: 'POST',
    body: { expectedRevision: alphaManifest.revision },
  });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));

  const restored = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}/restore`, {
    method: 'POST',
    body: { expectedRevision: archived.body.project.revision },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(readProjectManifest(alpha).status, 'active');

  const conflict = await requestJson(baseUrl, `/api/projects/${alphaManifest.id}/archive`, {
    method: 'POST',
    body: { expectedRevision: alphaManifest.revision },
  });
  assert.equal(conflict.status, 409, 'a stale revision must be refused after another writer advanced the Project');
});
