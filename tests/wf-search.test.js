import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeHarnessTempRoot } from './support/temp-root.js';

// AC-002 (task-implement-wf-search-093): stateless validate/render/resolve-save-target
// data contract, stdin, input limits, reference/date/budget/URL/escaping rules,
// and no-write side effects. Tests drive the template script path because the
// template is the only source location; the root mirror is synced later.
const repoRoot = path.resolve('.');
const script = path.resolve('templates/common/Harness/scripts/wf-search.mjs');
const fixtureRoot = path.resolve('tests/fixtures/wf-search');
const SUBCOMMANDS = ['validate', 'render', 'resolve-save-target'];
const TRACKING_PARAMS = ['utm_source', 'utm_campaign', 'fbclid', 'gclid', 'msclkid', 'ref_src'];

const tempRoots = [];
function trackedTempRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  tempRoots.push(root);
  return root;
}
after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(...parts) {
  const file = path.join(fixtureRoot, ...parts);
  assert.ok(fs.existsSync(file), `fixture missing: ${file}`);
  return file;
}

function run(args, { stdin } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: stdin === undefined ? undefined : String(stdin),
  });
}

function json(result) {
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    assert.fail(`expected JSON output; status=${result.status}; stdout=${result.stdout}; stderr=${result.stderr}`);
  }
}

function jsonOrErrorOutput(result) {
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return null;
  }
}

function findError(output, code) {
  return output && Array.isArray(output.errors)
    ? output.errors.find(error => error && error.code === code)
    : null;
}

function hasErrorPath(output, pathNeedle) {
  return output && Array.isArray(output.errors)
    ? output.errors.some(error => error && typeof error.path === 'string' && error.path.includes(pathNeedle))
    : false;
}

function copyInput(name, value) {
  const root = trackedTempRoot('wf-search-');
  const file = path.join(root, `${name}.json`);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
  return { root, file };
}

function listFilesRecursive(root, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFilesRecursive(path.join(root, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

// ---------------------------------------------------------------- A. valid report

test('AC-002 valid compare fixture validates with correct summary counts (design 3.4 rules 1-10)', () => {
  const result = run(['validate', '--input', fixture('valid-compare.json')]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = json(result);
  assert.equal(output.ok, true);
  assert.deepEqual(output.errors, []);
  assert.equal(output.summary.mode, 'compare');
  assert.equal(output.summary.depth, 'standard');
  assert.equal(output.summary.operations, 5);
  assert.equal(output.summary.sources, 3);
  assert.equal(output.summary.claims, 4);
  assert.equal(output.summary.status, 'complete');
  assert.equal(output.summary.overBudget, false);
});

// ---------------------------------------------------------------- B. structural errors

test('AC-002 empty question and empty claim text are rejected as required-field errors', () => {
  const result = run(['validate', '--input', fixture('errors', 'missing-required.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  assert.ok(output, 'expected JSON error payload');
  assert.equal(output.ok, false);
  assert.ok(output.errors.length >= 2, `expected at least question + claim.text errors, got ${JSON.stringify(output.errors)}`);
  assert.ok(hasErrorPath(output, 'question'), `missing question error path: ${JSON.stringify(output.errors)}`);
  assert.ok(hasErrorPath(output, 'claims'), `missing claims error path: ${JSON.stringify(output.errors)}`);
  for (const error of output.errors) {
    assert.ok(error.code, `error missing code: ${JSON.stringify(error)}`);
    assert.ok(error.path !== undefined, `error missing path: ${JSON.stringify(error)}`);
    assert.ok(error.message, `error missing message: ${JSON.stringify(error)}`);
  }
});

test('AC-002 unknown enum values for mode/sourceType/confidence are rejected', () => {
  const result = run(['validate', '--input', fixture('errors', 'unknown-enums.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  assert.ok(output, 'expected JSON error payload');
  assert.equal(output.ok, false);
  const paths = output.errors.map(error => error.path || '').join('\n');
  assert.match(paths, /mode/);
  assert.match(paths, /sourceType/);
  assert.match(paths, /confidence/);
});

test('AC-002 duplicate source ids are rejected', () => {
  const result = run(['validate', '--input', fixture('errors', 'duplicate-id.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  assert.ok(output, 'expected JSON error payload');
  assert.equal(output.ok, false);
  assert.ok(
    output.errors.some(error => (error.path || '').includes('sources') || /duplicate/i.test(error.message || '')),
    `expected duplicate id error: ${JSON.stringify(output.errors)}`
  );
});

test('AC-002 dangling claim.supportIds and source.operationIds references are rejected', () => {
  const result = run(['validate', '--input', fixture('errors', 'dangling-refs.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  assert.ok(output, 'expected JSON error payload');
  assert.equal(output.ok, false);
  assert.ok(
    output.errors.some(error => (error.path || '').includes('supportIds') || /supportIds/i.test(error.message || '')),
    `expected supportIds dangling error: ${JSON.stringify(output.errors)}`
  );
  assert.ok(
    output.errors.some(error => (error.path || '').includes('operationIds') || /operationIds/i.test(error.message || '')),
    `expected operationIds dangling error: ${JSON.stringify(output.errors)}`
  );
});

test('AC-002 claim dependency cycles are rejected', () => {
  const result = run(['validate', '--input', fixture('errors', 'claim-cycle.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  assert.ok(output, 'expected JSON error payload');
  assert.equal(output.ok, false);
  assert.ok(
    output.errors.some(error => /cycle/i.test(error.message || '') || /dependsOnClaimIds/i.test(error.path || '')),
    `expected dependency cycle error: ${JSON.stringify(output.errors)}`
  );
});

test('AC-002 invalid publishedAt and checkedAt date strings are rejected', () => {
  const result = run(['validate', '--input', fixture('errors', 'bad-dates.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  assert.ok(output, 'expected JSON error payload');
  assert.equal(output.ok, false);
  assert.ok(
    output.errors.some(error => (error.path || '').includes('publishedAt') || /publishedAt/i.test(error.message || '')),
    `expected publishedAt error: ${JSON.stringify(output.errors)}`
  );
  assert.ok(
    output.errors.some(error => (error.path || '').includes('checkedAt') || /checkedAt/i.test(error.message || '')),
    `expected checkedAt error: ${JSON.stringify(output.errors)}`
  );
});

test('AC-002 non-ISO date strings are rejected even when Date.parse accepts them', () => {
  const report = JSON.parse(fs.readFileSync(fixture('valid-compare.json'), 'utf8'));
  report.checkedAt = '2025';
  const { file } = copyInput('non-iso-date', report);
  const result = run(['validate', '--input', file]);
  const output = jsonOrErrorOutput(result);
  assert.equal(result.status, 1, result.stdout);
  assert.ok(findError(output, 'WFR-DATE001'), `expected strict ISO date error: ${JSON.stringify(output)}`);
});

test('AC-002 malformed claim entries return structured type errors instead of crashing', () => {
  const report = JSON.parse(fs.readFileSync(fixture('valid-compare.json'), 'utf8'));
  report.claims = [null];
  const { file } = copyInput('malformed-claim', report);
  const result = run(['validate', '--input', file]);
  const output = jsonOrErrorOutput(result);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.ok(findError(output, 'WFR-TYPE001'), `expected WFR-TYPE001: ${JSON.stringify(output)}`);
});

test('AC-002 malformed operation/source entries return structured type errors instead of crashing', () => {
  for (const field of ['operations', 'sources']) {
    const report = JSON.parse(fs.readFileSync(fixture('valid-compare.json'), 'utf8'));
    report[field] = [null];
    const { file } = copyInput(`malformed-${field}`, report);
    const result = run(['validate', '--input', file]);
    const output = jsonOrErrorOutput(result);
    assert.equal(result.status, 1, `${field}: ${result.stdout || result.stderr}`);
    assert.ok(findError(output, 'WFR-TYPE001'), `${field}: expected WFR-TYPE001: ${JSON.stringify(output)}`);
  }
});

test('AC-002 impossible calendar dates are rejected', () => {
  const report = JSON.parse(fs.readFileSync(fixture('valid-compare.json'), 'utf8'));
  report.checkedAt = '2025-02-30T00:00:00Z';
  const { file } = copyInput('impossible-date', report);
  const result = run(['validate', '--input', file]);
  const output = jsonOrErrorOutput(result);
  assert.equal(result.status, 1, result.stdout);
  assert.ok(findError(output, 'WFR-DATE001'), `expected calendar date error: ${JSON.stringify(output)}`);
});

test('AC-002 ftp:// source URLs are rejected (http/https only)', () => {
  const result = run(['validate', '--input', fixture('errors', 'bad-url-protocol.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  assert.ok(output, 'expected JSON error payload');
  assert.equal(output.ok, false);
  assert.ok(
    output.errors.some(error => (error.path || '').includes('url') || /url/i.test(error.message || '')),
    `expected url protocol error: ${JSON.stringify(output.errors)}`
  );
});

test('AC-002 URL normalization strips tracking params, keeps other query keys and fragment', () => {
  const result = run(['validate', '--input', fixture('url-normalization.json')]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = json(result);
  assert.equal(output.ok, true);
  const flat = JSON.stringify(output);
  for (const param of TRACKING_PARAMS) {
    assert.ok(!flat.includes(`${param}=`), `normalized output still contains ${param}: ${flat}`);
  }
  assert.match(flat, /keep=me/);
  assert.match(flat, /sort=asc/);
  assert.match(flat, /#section/);
});

// ---------------------------------------------------------------- C. budget

test('AC-002 quick depth rejects 3 searches as over budget (WFR-EBT001)', () => {
  const result = run(['validate', '--input', fixture('budget', 'quick-over-search.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  const error = findError(output, 'WFR-EBT001');
  assert.ok(error, `expected WFR-EBT001 error: ${JSON.stringify(output && output.errors)}`);
  assert.equal(output.ok, false);
  assert.equal(output.summary.overBudget, true);
});

test('AC-002 failed searches still count: 2 searches with one failed is exactly at quick budget and passes', () => {
  const result = run(['validate', '--input', fixture('budget', 'quick-two-searches-one-failed.json')]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = json(result);
  assert.equal(output.ok, true);
  assert.equal(output.summary.overBudget, false);
  assert.deepEqual(output.errors, []);
});

test('AC-002 standard depth rejects 11 reads as over budget (WFR-EBT001)', () => {
  const result = run(['validate', '--input', fixture('budget', 'standard-over-read.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  const error = findError(output, 'WFR-EBT001');
  assert.ok(error, `expected WFR-EBT001 error: ${JSON.stringify(output && output.errors)}`);
  assert.equal(output.summary.overBudget, true);
});

test('AC-002 lowered overrides are enforced: maxSearches=1 rejects 2 searches', () => {
  const result = run(['validate', '--input', fixture('budget', 'overrides-lowered-over-budget.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  const error = findError(output, 'WFR-EBT001');
  assert.ok(error, `expected WFR-EBT001 error: ${JSON.stringify(output && output.errors)}`);
  assert.equal(output.summary.overBudget, true);
});

test('AC-002 raising the budget via overrides above the depth ceiling is rejected as invalid', () => {
  const result = run(['validate', '--input', fixture('budget', 'overrides-raised-rejected.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  assert.ok(output, 'expected JSON error payload');
  assert.equal(output.ok, false);
  assert.ok(
    output.errors.some(error => (error.path || '').includes('overrides') || /override/i.test(error.message || '')),
    `expected overrides-above-ceiling error: ${JSON.stringify(output.errors)}`
  );
});

// ---------------------------------------------------------------- D. evidence semantics

test('AC-002 snippet-only support for a supported major fact claim is rejected (WFR-EVD001)', () => {
  const result = run(['validate', '--input', fixture('evidence', 'snippet-only-major-fact.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  const error = findError(output, 'WFR-EVD001');
  assert.ok(error, `expected WFR-EVD001 error: ${JSON.stringify(output && output.errors)}`);
  assert.equal(output.ok, false);
});

test('AC-002 disputed major claim with overall status complete is rejected (WFR-STA001)', () => {
  const result = run(['validate', '--input', fixture('evidence', 'disputed-major-complete.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  const error = findError(output, 'WFR-STA001');
  assert.ok(error, `expected WFR-STA001 error: ${JSON.stringify(output && output.errors)}`);
  assert.equal(output.ok, false);
});

test('AC-002 the same disputed-major ledger is valid when overall status is incomplete', () => {
  const result = run(['validate', '--input', fixture('evidence', 'disputed-major-incomplete.json')]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = json(result);
  assert.equal(output.ok, true);
  assert.deepEqual(output.errors, []);
  assert.equal(output.summary.status, 'incomplete');
});

test('AC-002 inference without supportIds is rejected (WFR-EVD002)', () => {
  const result = run(['validate', '--input', fixture('evidence', 'inference-no-support.json')]);
  assert.equal(result.status, 1, result.stdout);
  const output = jsonOrErrorOutput(result);
  const error = findError(output, 'WFR-EVD002');
  assert.ok(error, `expected WFR-EVD002 error: ${JSON.stringify(output && output.errors)}`);
  assert.equal(output.ok, false);
});

test('AC-002 fact kind or major importance independently requires non-snippet evidence', () => {
  for (const [name, mutate] of [
    ['minor-fact-snippet', claim => { claim.importance = 'minor'; }],
    ['major-inference-snippet', claim => { claim.kind = 'inference'; }],
  ]) {
    const report = JSON.parse(fs.readFileSync(fixture('evidence', 'snippet-only-major-fact.json'), 'utf8'));
    mutate(report.claims[0]);
    const { file } = copyInput(name, report);
    const result = run(['validate', '--input', file]);
    const output = jsonOrErrorOutput(result);
    assert.equal(result.status, 1, `${name}: ${result.stdout}`);
    assert.ok(findError(output, 'WFR-EVD001'), `${name}: expected WFR-EVD001: ${JSON.stringify(output)}`);
  }
});

test('AC-002 a claim keeps at most three primary supporting sources', () => {
  const report = JSON.parse(fs.readFileSync(fixture('valid-compare.json'), 'utf8'));
  report.sources.push(
    { ...report.sources[0], id: 'src-four', operationIds: ['op-search-1'] },
    { ...report.sources[0], id: 'src-primary2', operationIds: ['op-search-1'] },
    { ...report.sources[0], id: 'src-primary3', operationIds: ['op-search-1'] },
  );
  report.claims[0].supportIds = ['src-official', 'src-four', 'src-primary2', 'src-primary3'];
  const { file } = copyInput('primary-support-cap', report);
  const result = run(['validate', '--input', file]);
  const output = jsonOrErrorOutput(result);
  assert.equal(result.status, 1, result.stdout);
  assert.ok(findError(output, 'WFR-EVD005'), `expected WFR-EVD005: ${JSON.stringify(output)}`);
});

test('AC-002 sources must cite a successful discovery/read operation', () => {
  for (const [name, mutate] of [
    ['empty-operation-ids', source => { source.operationIds = []; }],
    ['failed-operation', (source, report) => { source.operationIds = ['op-search-1']; report.operations[0].outcome = 'failed'; }],
  ]) {
    const report = JSON.parse(fs.readFileSync(fixture('valid-compare.json'), 'utf8'));
    mutate(report.sources[0], report);
    const { file } = copyInput(name, report);
    const result = run(['validate', '--input', file]);
    const output = jsonOrErrorOutput(result);
    assert.equal(result.status, 1, `${name}: ${result.stdout}`);
    assert.ok(findError(output, 'WFR-EVD003'), `${name}: expected WFR-EVD003: ${JSON.stringify(output)}`);
  }
});

test('AC-002 major claims with contradictions cannot remain supported', () => {
  const report = JSON.parse(fs.readFileSync(fixture('evidence', 'disputed-major-incomplete.json'), 'utf8'));
  report.status = 'incomplete';
  report.claims[0].status = 'supported';
  const { file } = copyInput('supported-major-contradiction', report);
  const result = run(['validate', '--input', file]);
  const output = jsonOrErrorOutput(result);
  assert.equal(result.status, 1, result.stdout);
  assert.ok(findError(output, 'WFR-EVD004'), `expected WFR-EVD004: ${JSON.stringify(output)}`);
});

// ---------------------------------------------------------------- E. stdin / CLI behavior

test('AC-002 --input - reads the same valid report from stdin and is equivalent to file input', () => {
  const payload = fs.readFileSync(fixture('valid-compare.json'), 'utf8');
  const viaFile = run(['validate', '--input', fixture('valid-compare.json')]);
  const viaStdin = run(['validate', '--input', '-'], { stdin: payload });
  assert.equal(viaStdin.status, 0, viaStdin.stderr || viaStdin.stdout);
  const fileOutput = json(viaFile);
  const stdinOutput = json(viaStdin);
  assert.equal(stdinOutput.ok, true);
  assert.deepEqual(stdinOutput.summary, fileOutput.summary);
});

test('AC-002 invalid JSON on stdin exits 1 with a clear error', () => {
  const result = run(['validate', '--input', '-'], { stdin: '{"schemaVersion": 1, "not json' });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout + result.stderr, /json/i);
});

test('AC-002 input larger than 1 MiB exits 1 with an explicit size error', () => {
  const { root } = copyInput('oversize', { schemaVersion: 1, padding: 'x'.repeat(1024 * 1024 + 4096) });
  const result = run(['validate', '--input', path.join(root, 'oversize.json')]);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout + result.stderr, /1\s*MiB|size|large/i);
});

test('AC-002 stdin larger than 1 MiB exits 1 with an explicit size error without buffering past the limit', () => {
  // A bounded read must enforce MAX_INPUT_BYTES on the stream itself; this
  // probe feeds 1 MiB + slack so a read-all-then-check implementation still
  // fails, while a stream-limit implementation fails fast on the cap.
  const payload = '{"schemaVersion":1,"padding":"' + 'x'.repeat(1024 * 1024 + 4096) + '"}';
  const result = run(['validate', '--input', '-'], { stdin: payload });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout + result.stderr, /1\s*MiB|size|large/i);
});

test('AC-002 unknown subcommand, missing --input, and unknown flags all exit 1 with actionable errors', () => {
  const unknownCommand = run(['frobnicate', '--input', fixture('valid-compare.json')]);
  assert.equal(unknownCommand.status, 1, unknownCommand.stdout);
  assert.match(unknownCommand.stdout + unknownCommand.stderr, /frobnicate|unknown command/i);

  const missingInput = run(['validate']);
  assert.equal(missingInput.status, 1, missingInput.stdout);
  assert.match(missingInput.stdout + missingInput.stderr, /--input|required/i);

  const unknownFlag = run(['validate', '--input', fixture('valid-compare.json'), '--frobnicate']);
  assert.equal(unknownFlag.status, 1, unknownFlag.stdout);
  assert.match(unknownFlag.stdout + unknownFlag.stderr, /frobnicate|unknown (option|flag|argument|param)/i);
});

test('AC-002 --help exits 0 and lists the three subcommands', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const text = result.stdout + result.stderr;
  for (const command of SUBCOMMANDS) {
    assert.ok(text.includes(command), `help output missing "${command}": ${text}`);
  }
});

// ---------------------------------------------------------------- F. render

test('AC-002 render emits report header with question, mode, and status for a valid report', () => {
  const result = run(['render', '--input', fixture('valid-compare.json')]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const text = result.stdout;
  assert.match(text, /Compare the built-in node:test runner with Jest for this repository\./);
  assert.match(text, /compare/);
  assert.match(text, /complete/);
});

test('AC-002 render escapes hostile source/claim text: no script tags, no javascript: links, markdown links neutralized', () => {
  const result = run(['render', '--input', fixture('malicious-render.json')]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const text = result.stdout;
  assert.ok(!text.includes('<script>alert(1)</script>'), 'raw script tag leaked into render output');
  assert.ok(!/<script/i.test(text), 'any script tag leaked into render output');
  assert.ok(!text.includes('](javascript:'), 'javascript: markdown link survived render');
  assert.ok(!/\(javascript:/i.test(text), 'javascript: URL survived render in any link form');
  assert.ok(!text.includes('[phish](https://evil.example)'), 'phishing markdown link syntax survived render');
  assert.ok(!text.includes('[click]('), 'click markdown link syntax survived render');
});

test('AC-002 render refuses invalid input and must validate first (exit 1, structured errors)', () => {
  for (const bad of [
    fixture('errors', 'missing-required.json'),
    fixture('evidence', 'snippet-only-major-fact.json'),
    fixture('budget', 'quick-over-search.json'),
  ]) {
    const result = run(['render', '--input', bad]);
    assert.equal(result.status, 1, `${bad}: ${result.stdout}`);
    const payload = jsonOrErrorOutput(result);
    assert.ok(payload, `${bad}: render must emit a JSON error payload`);
    assert.equal(payload.ok, false, `${bad}: render error payload must set ok=false`);
    assert.ok(Array.isArray(payload.errors) && payload.errors.length > 0, `${bad}: render error payload must carry errors`);
  }
});

test('AC-002 render links http/https source URLs but does not turn excerpt text into extra link syntax', () => {
  const result = run(['render', '--input', fixture('url-normalization.json')]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const text = result.stdout;
  assert.match(text, /https:\/\/docs\.example\/page\?keep=me&sort=asc#section/);
  const urlLinks = text.match(/\]\(https:\/\/docs\.example\/page[^\)]*\)/g) || [];
  assert.ok(urlLinks.length >= 1, 'expected the source URL to be rendered as a markdown link');
});

test('AC-002 render percent-encodes Markdown-significant URL characters', () => {
  const report = JSON.parse(fs.readFileSync(fixture('valid-compare.json'), 'utf8'));
  report.sources[0].url = 'https://evil.example/a)](javascript:alert(1))?keep=yes';
  const { file } = copyInput('hostile-url', report);
  const result = run(['render', '--input', file]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(!result.stdout.includes('](javascript:'), result.stdout);
  assert.ok(result.stdout.includes('%29%5D%28javascript:alert%281%29%29'), result.stdout);
});

test('AC-002 CLI failures preserve the structured error code/message order', () => {
  const result = run(['resolve-save-target', '--project', path.join(repoRoot, 'does-not-exist'), '--id', 'report']);
  const output = jsonOrErrorOutput(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(output.errors[0].code, 'WFR-CLI002');
  assert.match(output.errors[0].message, /does not exist/);
});

test('AC-002 CLI rejects unknown positional arguments and normalizes filesystem errors', () => {
  const unknown = run(['validate', 'garbage', '--input', fixture('valid-compare.json')]);
  const unknownOutput = jsonOrErrorOutput(unknown);
  assert.equal(unknown.status, 1, unknown.stdout);
  assert.equal(unknownOutput.errors[0].code, 'WFR-CLI001');
  const missing = run(['validate', '--input', path.join(repoRoot, 'missing-file.json')]);
  const missingOutput = jsonOrErrorOutput(missing);
  assert.equal(missing.status, 1, missing.stdout);
  assert.equal(missingOutput.errors[0].code, 'WFR-CLI002');
  assert.match(missingOutput.errors[0].message, /ENOENT|exist|file/i);
});

test('AC-002 render rejects validate-only flags', () => {
  const result = run(['render', '--input', fixture('valid-compare.json'), '--json']);
  const output = jsonOrErrorOutput(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(output.errors[0].code, 'WFR-CLI001');
  assert.match(output.errors[0].message, /unknown option/i);
});

test('AC-002 render isolates Markdown syntax in source titles', () => {
  const report = JSON.parse(fs.readFileSync(fixture('valid-compare.json'), 'utf8'));
  report.sources[0].title = 'x](https://evil.example)';
  const { file } = copyInput('hostile-title', report);
  const result = run(['render', '--input', file]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(!result.stdout.includes('[x](https://evil.example)'), result.stdout);
  assert.ok(result.stdout.includes('&#93;'), result.stdout);
});

test('AC-002 render neutralizes escaped-bracket markdown link injection in text fields', () => {
  const report = JSON.parse(fs.readFileSync(fixture('valid-compare.json'), 'utf8'));
  const hostile = '[x\\]](https://evil.example)';
  report.question = hostile;
  report.claims[0].text = hostile;
  report.sources[0].excerpt = hostile;
  const { file } = copyInput('hostile-escaped-bracket', report);
  const result = run(['render', '--input', file]);
  assert.equal(result.status, 0, result.stdout);
  assert.ok(!result.stdout.includes('](https://evil.example)'), `escaped-bracket link injection survived: ${result.stdout}`);
});

test('AC-002 render neutralizes bracket-markdown injection via parenthesized nesting in text fields', () => {
  const report = JSON.parse(fs.readFileSync(fixture('valid-compare.json'), 'utf8'));
  report.question = 'a [b](c(d)https://evil.example)';
  const { file } = copyInput('hostile-nested-paren', report);
  const result = run(['render', '--input', file]);
  assert.equal(result.status, 0, result.stdout);
  assert.ok(!result.stdout.includes('](https://evil.example)'), `nested-paren injection survived: ${result.stdout}`);
});

// ---------------------------------------------------------------- G. no write side effects

test('AC-002 validate and render create no files and leave the input untouched', () => {
  const { root, file } = copyInput('side-effect', JSON.parse(fs.readFileSync(fixture('valid-compare.json'), 'utf8')));
  const beforeContent = fs.readFileSync(file, 'utf8');
  const beforeMtimeMs = fs.statSync(file).mtimeMs;
  const beforeTree = listFilesRecursive(root);

  const validateResult = run(['validate', '--input', file]);
  assert.equal(validateResult.status, 0, validateResult.stderr || validateResult.stdout);
  const renderResult = run(['render', '--input', file]);
  assert.equal(renderResult.status, 0, renderResult.stderr || renderResult.stdout);

  assert.deepEqual(listFilesRecursive(root), beforeTree, 'validate/render created new files in the input directory');
  assert.equal(fs.readFileSync(file, 'utf8'), beforeContent, 'input file content changed');
  assert.equal(fs.statSync(file).mtimeMs, beforeMtimeMs, 'input file mtime changed');
});

// ---------------------------------------------------------------- H. resolve-save-target

function projectWithTask({ withTask = true } = {}) {
  const root = trackedTempRoot('wf-search-target-');
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  if (withTask) {
    const taskDir = path.join(root, 'Harness', 'tasks', 'existing-task');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'STATE.json'), JSON.stringify({ taskId: 'existing-task', status: 'active' }), 'utf8');
  }
  return root;
}

test('AC-002 resolve-save-target returns Harness/research/search/<id> for a good id without writing', () => {
  const root = projectWithTask({ withTask: false });
  const result = run(['resolve-save-target', '--project', root, '--id', 'good-report-1']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = json(result);
  assert.ok(output.researchDir, `missing researchDir: ${JSON.stringify(output)}`);
  assert.ok(output.tasksDir, `missing tasksDir: ${JSON.stringify(output)}`);
  const researchPosix = String(output.researchDir).replaceAll('\\', '/');
  assert.match(researchPosix, /Harness\/research\/search\/good-report-1$/);
  assert.ok(!fs.existsSync(path.join(root, 'Harness', 'research')), 'resolve-save-target must not create directories');
});

test('AC-002 resolve-save-target with --task returns the task evidence path', () => {
  const root = projectWithTask();
  const result = run(['resolve-save-target', '--project', root, '--task', 'existing-task', '--id', 'x']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = json(result);
  const flat = JSON.stringify(output).replaceAll('\\', '/');
  assert.match(flat, /Harness\/tasks\/existing-task\/evidence\/wf-search\/x/);
  assert.ok(!fs.existsSync(path.join(root, 'Harness', 'tasks', 'existing-task', 'evidence')), 'resolve-save-target must not create directories');
});

test('AC-002 resolve-save-target rejects traversal, spaces, and dot ids with clear errors', () => {
  const root = projectWithTask();
  for (const id of ['../evil', 'has space', '.']) {
    const result = run(['resolve-save-target', '--project', root, '--id', id]);
    assert.equal(result.status, 1, `id "${id}" should be rejected: ${result.stdout}`);
    assert.match(result.stdout + result.stderr, /id|report|invalid|escape/i, `id "${id}" rejected without explanation`);
  }
});

test('AC-002 resolve-save-target rejects a missing task and a missing id with clear errors', () => {
  const root = projectWithTask();
  const missingTask = run(['resolve-save-target', '--project', root, '--task', 'no-such-task', '--id', 'x']);
  assert.equal(missingTask.status, 1, missingTask.stdout);
  assert.match(missingTask.stdout + missingTask.stderr, /task|exist|not found|missing/i);

  const missingId = run(['resolve-save-target', '--project', root]);
  assert.equal(missingId.status, 1, missingId.stdout);
  assert.match(missingId.stdout + missingId.stderr, /--id|required|missing/i);
});
