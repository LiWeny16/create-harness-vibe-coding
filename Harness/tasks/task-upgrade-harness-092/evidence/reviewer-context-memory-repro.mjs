import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '../../../..');
const fixture = path.join(repo, 'tests/fixtures/harness-092/project');
const taskCli = path.join(repo, 'Harness/scripts/task-context.mjs');
const memoryCli = path.join(repo, 'Harness/scripts/memory-context.mjs');
const researchCli = path.join(repo, 'Harness/scripts/research-policy.mjs');

function project(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `harness-092-review-${name}-`));
  fs.cpSync(fixture, root, { recursive: true });
  return root;
}

function run(script, root, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
  let json = null;
  try { json = JSON.parse(result.stdout.trim()); } catch {}
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr };
}

const validMethod = {
  id: 'global-scope-sentinel', kind: 'method', scope: 'global',
  when: 'global scope sentinel', rule: 'GLOBAL_SCOPE_SENTINEL', avoid: 'Do not leak project facts',
  signals: ['scope'], evidenceRefs: ['E-global'],
  counterexample: { scenario: 'project-only fact', outcome: 'do not promote it' },
  verification: { status: 'passed', method: 'review', evidenceRef: 'E-global' }, status: 'active',
};

const findings = [];

// The first context write can omit original, then a later update sets it.
{
  const root = project('late-original');
  const first = path.join(root, 'first.json');
  const second = path.join(root, 'second.json');
  const statePath = path.join(root, 'Harness/tasks/task-context-fixture/STATE.json');
  const initialState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  initialState.context = {};
  fs.writeFileSync(statePath, `${JSON.stringify(initialState, null, 2)}\n`, 'utf8');
  fs.writeFileSync(first, JSON.stringify({ context: { intent: { current: 'FIRST_CURRENT' } }, nextAction: 'first' }), 'utf8');
  fs.writeFileSync(second, JSON.stringify({ context: { intent: { original: 'LATE_ORIGINAL' } }, nextAction: 'second' }), 'utf8');
  const a = run(taskCli, root, ['update', 'task-context-fixture', '--project', root, '--input', first, '--apply', '--json']);
  const b = run(taskCli, root, ['update', 'task-context-fixture', '--project', root, '--input', second, '--apply', '--json']);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  findings.push({ case: 'task-context-late-original', firstStatus: a.status, secondStatus: b.status, original: state.context.intent.original, changes: state.context.intent.changes });
}

// Context applicability metadata cannot survive the read normalization path.
{
  const root = project('role');
  const statePath = path.join(root, 'Harness/tasks/task-context-fixture/STATE.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.context.facts.push({ id: 'fact-verifier-only', text: 'ROLE_ONLY_SENTINEL', source: 'fixture', status: 'verified', roles: ['verifier'], workItems: ['W-ONLY'] });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  const result = run(taskCli, root, ['pack', 'task-context-fixture', '--project', root, '--role', 'developer', '--work-item', 'W-OTHER', '--budget-bytes', '10000', '--json']);
  findings.push({
    case: 'task-context-role-workItem-filter',
    status: result.status,
    sentinelIncluded: Boolean(result.json?.pack?.includes('ROLE_ONLY_SENTINEL')),
    omitted: result.json?.omitted,
    expected: 'sentinel should be excluded for role=developer/work-item=W-OTHER',
  });
}

// A symlink inside the project can make --input read a file outside --project.
{
  const root = project('symlink');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-092-outside-'));
  const secret = path.join(outside, 'secret.json');
  fs.writeFileSync(secret, JSON.stringify({ nextAction: 'EXTERNAL_SECRET_SENTINEL' }), 'utf8');
  let symlink = true;
  const linkPath = path.join(root, 'input-link');
  try { fs.symlinkSync(outside, linkPath, 'junction'); } catch (error) {
    try { fs.symlinkSync(secret, `${linkPath}.json`, 'file'); } catch { symlink = false; }
  }
  const inputPath = fs.existsSync(linkPath) ? path.join(linkPath, 'secret.json') : `${linkPath}.json`;
  const result = symlink
    ? run(taskCli, root, ['pack', 'task-context-fixture', '--project', root, '--role', 'verifier', '--budget-bytes', '10000', '--input', inputPath, '--json'])
    : null;
  findings.push({ case: 'task-context-input-symlink-escape', symlink, status: result?.status, externalSecretObserved: Boolean(result?.json?.pack?.includes('EXTERNAL_SECRET_SENTINEL')), stderr: result?.stderr });
}

// Feedback accepts a path-shaped task id and writes under Harness/memory.
{
  const root = project('feedback-traversal');
  const result = run(memoryCli, root, ['feedback', '--project', root, '--task', '../memory', '--entry', 'x', '--outcome', 'useful', '--reason', 'FEEDBACK_TRAVERSAL_SENTINEL', '--apply', '--json']);
  const escapedTarget = path.join(root, 'Harness/memory/evidence/memory-feedback.md');
  findings.push({ case: 'memory-feedback-task-traversal', status: result.status, escapedWrite: fs.existsSync(escapedTarget), output: result.json });
}

// Negative query budget is silently clamped instead of rejected.
{
  const root = project('negative-budget');
  const result = run(memoryCli, root, ['query', '--project', root, '--text', 'context', '--scope', 'project', '--budget-bytes', '-1', '--json']);
  findings.push({ case: 'memory-negative-budget', status: result.status, budget: result.json?.budget, output: result.json });
  const bounded = run(memoryCli, root, ['query', '--project', root, '--text', 'context packing budget', '--scope', 'project', '--top-k', '5', '--budget-bytes', '1200', '--json']);
  findings.push({ case: 'memory-wire-output-not-counted', limit: bounded.json?.budget?.limitBytes, reportedUsed: bounded.json?.budget?.usedBytes, serializedOutputBytes: Buffer.byteLength(JSON.stringify(bounded.json || {}), 'utf8'), output: bounded.json });
  const noisyDir = path.join(root, 'Harness/memory/noisy');
  fs.mkdirSync(noisyDir, { recursive: true });
  for (let i = 0; i < 20; i += 1) fs.writeFileSync(path.join(noisyDir, `entry-${i}.md`), `- When context noise ${i}: ${'N'.repeat(300)}\n`, 'utf8');
  const skipped = run(memoryCli, root, ['query', '--project', root, '--text', 'context noise', '--scope', 'project', '--top-k', '0', '--budget-bytes', '1', '--json']);
  findings.push({ case: 'memory-skipped-output-not-counted', limit: skipped.json?.budget?.limitBytes, reportedUsed: skipped.json?.budget?.usedBytes, serializedOutputBytes: Buffer.byteLength(JSON.stringify(skipped.json || {}), 'utf8'), skippedCount: skipped.json?.skipped?.length });
}

// Query trusts arbitrary metadata verification claims without structural validation.
{
  const root = project('false-verified');
  const fake = path.join(root, 'Harness/memory/fake-verified.md');
  fs.writeFileSync(fake, '<!-- harness-memory: {"id":"fake-verified","kind":"method","scope":"project","when":"fake verification","rule":"FAKE_VERIFIED_SENTINEL","status":"active","verification":{"status":"passed"}} -->\n- When fake verification: FAKE_VERIFIED_SENTINEL.\n', 'utf8');
  const result = run(memoryCli, root, ['query', '--project', root, '--text', 'fake verification', '--scope', 'project', '--json']);
  const hit = result.json?.hits?.find(item => item.id === 'fake-verified');
  findings.push({ case: 'memory-unvalidated-verification-claim', status: result.status, hit, expected: 'invalid method metadata should not be reported as verified' });
}

// A global-scoped candidate is still written to project-local memory; no global root is consulted.
{
  const root = project('global-scope');
  const input = path.join(root, 'global.json');
  fs.writeFileSync(input, JSON.stringify(validMethod), 'utf8');
  const result = run(memoryCli, root, ['apply', '--project', root, '--input', input, '--apply', '--json']);
  const projectMemory = fs.readFileSync(path.join(root, 'Harness/memory/agent-lessons-patterns.md'), 'utf8');
  const query = run(memoryCli, root, ['query', '--project', root, '--text', 'global scope sentinel', '--scope', 'global', '--json']);
  findings.push({ case: 'memory-global-scope-boundary', status: result.status, projectFileContainsGlobal: projectMemory.includes('GLOBAL_SCOPE_SENTINEL'), globalQueryHits: query.json?.hits });
}

// Research records omit required counterexample/recheck fields even when supplied.
{
  const root = project('research-fields');
  fs.mkdirSync(path.join(root, 'Harness/tasks/research-task'), { recursive: true });
  const refs = path.join(root, 'Harness/tasks/research-task/REFERENCES.md');
  fs.writeFileSync(refs, '# Research references\n', 'utf8');
  const input = path.join(root, 'reference.json');
  fs.writeFileSync(input, JSON.stringify({ url: 'https://example.com/reviewer', title: 'Reviewer source', sourceType: 'official', version: '1.2', license: 'MIT', decision: 'adapt', reason: 'RESEARCH_REASON_SENTINEL', acIds: ['AC-04'], checkedAt: '2026-09-09T00:00:00Z', counterexample: 'RESEARCH_COUNTEREXAMPLE_SENTINEL', recheckAfter: '2027-01-01' }), 'utf8');
  const result = run(researchCli, root, ['record', '--project', root, '--task', 'research-task', '--input', input, '--apply', '--json']);
  const text = fs.readFileSync(refs, 'utf8');
  findings.push({ case: 'research-reference-counterexample-recheck', status: result.status, reasonWritten: text.includes('RESEARCH_REASON_SENTINEL'), counterexampleWritten: text.includes('RESEARCH_COUNTEREXAMPLE_SENTINEL'), recheckWritten: text.includes('2027-01-01'), text });
}

console.log(JSON.stringify({ repo, findings }, null, 2));
