import fs from 'node:fs';
import path from 'node:path';

// Keep this library self-contained so a global runtime can install only the
// wf-search CLI and library while a project bridge remains intentionally slim.
function isWithin(root, candidate, allowRoot = false) {
  const relative = path.relative(root, candidate);
  return (allowRoot && relative === '') || (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative));
}
function realpath(value, label) {
  try { return fs.realpathSync(value); }
  catch (error) { throw new Error(`${label || 'Path'} cannot be resolved: ${error.message}`); }
}
function isLink(value) {
  // lstat sees the link itself; existsSync skips dangling links, so link
  // detection must not depend on the target existing.
  try { return fs.lstatSync(value).isSymbolicLink(); } catch { return false; }
}
function scopedPath(root, candidate, { allowRoot = false, mustExist = false, label = 'Path' } = {}) {
  const lexicalRoot = path.resolve(String(root));
  const lexicalCandidate = path.resolve(String(candidate));
  if (!isWithin(lexicalRoot, lexicalCandidate, allowRoot)) throw new Error(`${label} escapes allowed root: ${lexicalCandidate}`);
  if (mustExist && !fs.existsSync(lexicalCandidate)) throw new Error(`${label} does not exist: ${lexicalCandidate}`);
  const realRoot = realpath(lexicalRoot, 'Allowed root');
  let realCandidate;
  if (fs.existsSync(lexicalCandidate)) realCandidate = realpath(lexicalCandidate, label);
  else if (isLink(lexicalCandidate)) realCandidate = realpath(lexicalCandidate, label);
  else {
    let cursor = lexicalCandidate; const suffix = [];
    while (!fs.existsSync(cursor) && !isLink(cursor)) { const parent = path.dirname(cursor); if (parent === cursor) throw new Error(`${label} has no existing parent: ${lexicalCandidate}`); suffix.unshift(path.basename(cursor)); cursor = parent; }
    realCandidate = path.join(realpath(cursor, label), ...suffix);
  }
  if (!isWithin(realRoot, realCandidate, allowRoot)) throw new Error(`${label} resolves outside allowed root: ${realCandidate}`);
  return lexicalCandidate;
}
function scopedProject(value, { label = 'Project root' } = {}) {
  if (!value || !path.isAbsolute(String(value))) throw new Error(`${label} must be an absolute path`);
  const root = path.resolve(String(value));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`${label} does not exist: ${root}`);
  scopedPath(root, root, { allowRoot: true, mustExist: true, label });
  return root;
}
function scopedTaskDirectory(root, taskId, { requireState = true } = {}) {
  if (!taskId || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(taskId)) || new Set(['_template', '_archive', 'continuous']).has(String(taskId))) throw new Error(`Invalid task id "${taskId || ''}"; path traversal is not allowed`);
  const tasks = scopedPath(root, path.join(root, 'Harness', 'tasks'), { mustExist: true, label: 'Harness/tasks' });
  const taskDir = scopedPath(tasks, path.join(tasks, String(taskId)), { mustExist: true, label: 'Task directory' });
  if (!fs.statSync(taskDir).isDirectory()) throw new Error(`Task is not a directory: ${taskId}`);
  if (requireState) scopedPath(tasks, path.join(taskDir, 'STATE.json'), { mustExist: true, label: 'Task STATE.json' });
  return taskDir;
}

export const SCHEMA_VERSION = 1;
export const BUDGETS = Object.freeze({
  quick: Object.freeze({ maxSearches: 2, maxReads: 3 }),
  standard: Object.freeze({ maxSearches: 6, maxReads: 10 }),
  deep: Object.freeze({ maxSearches: 12, maxReads: 20 }),
});
const MODES = new Set(['fact', 'verify', 'compare', 'troubleshoot']);
const DEPTHS = new Set(Object.keys(BUDGETS));
const OP_KINDS = new Set(['search', 'read']);
const OUTCOMES = new Set(['success', 'failed', 'unavailable']);
const SOURCE_TYPES = new Set(['official', 'source-code', 'issue', 'paper', 'community', 'news', 'other']);
const ACCESSES = new Set(['full', 'excerpt', 'snippet']);
const CLAIM_KINDS = new Set(['fact', 'inference', 'community-observation', 'recommendation']);
const IMPORTANCES = new Set(['major', 'minor']);
const CLAIM_STATUSES = new Set(['supported', 'disputed', 'insufficient']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);
const PRIMARY_SOURCE_TYPES = new Set(['official', 'source-code', 'issue', 'paper']);
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_INPUT_BYTES = 1024 * 1024;
const TRACKING_RE = /^(utm_[^=]+|fbclid|gclid|msclkid|ref_src)$/i;

const issue = (code, pathName, message) => ({ code, path: pathName, message });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value, max = Infinity) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const validDate = (value, nullable = false) => {
  if (nullable && value === null) return true;
  if (typeof value !== 'string') return false;
  const match = value.match(ISO_DATE_RE);
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const month = Number(match[2]); const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(Number(match[1]), month, 0)).getUTCDate();
};
const parsedUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url : null; } catch { return null; } };
const typeError = (errors, value, field, expected) => errors.push(issue(value === undefined ? 'WFR-REQ001' : 'WFR-TYPE001', field, `${field} must be ${expected}`));
const enumError = (errors, value, field, allowed) => { if (!allowed.has(value)) errors.push(issue('WFR-ENUM001', field, `${field} must be one of: ${[...allowed].join(', ')}`)); };
const idError = (errors, value, field) => { if (typeof value !== 'string' || !ID_RE.test(value)) errors.push(issue('WFR-ID001', field, `${field} must match ${ID_RE}`)); };
function unique(errors, list, field) {
  const seen = new Set();
  list.forEach((item, index) => { if (seen.has(item?.id)) errors.push(issue('WFR-ID002', `${field}[${index}].id`, `duplicate id: ${item?.id}`)); seen.add(item?.id); });
}
function ids(errors, list, field, known, kind) {
  if (!Array.isArray(list)) { typeError(errors, list, field, 'an array'); return; }
  list.forEach((value, index) => { if (typeof value !== 'string' || !known.has(value)) errors.push(issue('WFR-REF001', `${field}[${index}]`, `${kind} does not exist: ${value}`)); });
}
function hasCycle(claims) {
  const validClaims = claims.filter(object);
  const graph = new Map(validClaims.map(claim => [claim.id, Array.isArray(claim.dependsOnClaimIds) ? claim.dependsOnClaimIds : []]));
  const visiting = new Set(); const visited = new Set();
  function visit(id) { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); for (const next of graph.get(id) || []) if (visit(next)) return true; visiting.delete(id); visited.add(id); return false; }
  return validClaims.some(claim => typeof claim.id === 'string' && visit(claim.id));
}
function normalize(value) {
  const copy = JSON.parse(JSON.stringify(value));
  for (const operation of Array.isArray(copy.operations) ? copy.operations : []) if (object(operation) && typeof operation.url === 'string') operation.url = normalizeSourceUrl(operation.url);
  for (const source of Array.isArray(copy.sources) ? copy.sources : []) if (object(source) && typeof source.url === 'string') source.url = normalizeSourceUrl(source.url);
  return copy;
}
export function normalizeSourceUrl(value) {
  const url = parsedUrl(value); if (!url) return value;
  for (const key of [...url.searchParams.keys()]) if (TRACKING_RE.test(key)) url.searchParams.delete(key);
  return url.toString();
}
function validateOverrides(errors, constraints, depth) {
  if (constraints === undefined) return {};
  if (!object(constraints)) { typeError(errors, constraints, 'constraints', 'an object'); return {}; }
  if (constraints.overrides === undefined) return {};
  if (!object(constraints.overrides)) { typeError(errors, constraints.overrides, 'constraints.overrides', 'an object'); return {}; }
  const base = BUDGETS[depth] || BUDGETS.standard;
  for (const [key, value] of Object.entries(constraints.overrides)) {
    if (!['maxSearches', 'maxReads'].includes(key)) errors.push(issue('WFR-OVR001', `constraints.overrides.${key}`, `unknown budget override: ${key}`));
    else if (!Number.isInteger(value) || value < 0 || value > base[key]) errors.push(issue(value > base[key] ? 'WFR-OVR002' : 'WFR-OVR001', `constraints.overrides.${key}`, `${key} must be a non-negative integer no greater than ${base[key]}`));
  }
  return constraints.overrides;
}

export function validateResearchResult(input) {
  if (!object(input)) return { ok: false, errors: [issue('WFR-TYPE001', '$', 'research result must be an object')], warnings: [], normalized: input, summary: { overBudget: false } };
  const result = normalize(input); const errors = []; const warnings = [];
  if (result.schemaVersion !== SCHEMA_VERSION) errors.push(issue('WFR-SCHEMA001', 'schemaVersion', 'schemaVersion must be 1'));
  if (!nonEmpty(result.question, 500)) errors.push(issue('WFR-REQ001', 'question', 'question must be a non-empty string of at most 500 characters'));
  enumError(errors, result.mode, 'mode', MODES); enumError(errors, result.depth, 'depth', DEPTHS);
  if (!validDate(result.checkedAt)) errors.push(issue('WFR-DATE001', 'checkedAt', 'checkedAt must be a valid date'));
  if (!object(result.constraints)) errors.push(issue(result.constraints === undefined ? 'WFR-REQ001' : 'WFR-TYPE001', 'constraints', 'constraints must be an object'));
  if (!nonEmpty(result.stopReason, 1000)) errors.push(issue('WFR-REQ001', 'stopReason', 'stopReason must be a non-empty string of at most 1000 characters'));
  if (!Array.isArray(result.limitations) || result.limitations.some(item => !nonEmpty(item, 1000))) errors.push(issue(result.limitations === undefined ? 'WFR-REQ001' : 'WFR-TYPE001', 'limitations', 'limitations must be an array of non-empty strings'));
  const base = BUDGETS[result.depth] || BUDGETS.standard; const overrides = validateOverrides(errors, result.constraints, result.depth);
  const limits = { maxSearches: overrides.maxSearches ?? base.maxSearches, maxReads: overrides.maxReads ?? base.maxReads };
  for (const field of ['operations', 'sources', 'claims']) if (!Array.isArray(result[field])) typeError(errors, result[field], field, 'an array');
  const operations = Array.isArray(result.operations) ? result.operations : []; const sources = Array.isArray(result.sources) ? result.sources : []; const claims = Array.isArray(result.claims) ? result.claims : [];
  unique(errors, operations, 'operations'); unique(errors, sources, 'sources'); unique(errors, claims, 'claims');
  const operationIds = new Set(operations.map(item => item?.id)); const sourceIds = new Set(sources.map(item => item?.id)); const claimIds = new Set(claims.map(item => item?.id));
  for (let i = 0; i < operations.length; i += 1) {
    const op = operations[i]; const p = `operations[${i}]`; if (!object(op)) { errors.push(issue('WFR-TYPE001', p, `${p} must be an object`)); continue; }
    idError(errors, op.id, `${p}.id`); enumError(errors, op.kind, `${p}.kind`, OP_KINDS); enumError(errors, op.outcome, `${p}.outcome`, OUTCOMES);
    if (!nonEmpty(op.tool, 200)) errors.push(issue('WFR-REQ001', `${p}.tool`, 'tool is required')); if (!validDate(op.checkedAt)) errors.push(issue('WFR-DATE001', `${p}.checkedAt`, 'checkedAt must be a valid date'));
    if (op.kind === 'search' && !nonEmpty(op.query, 2000)) errors.push(issue('WFR-REQ001', `${p}.query`, 'search operations require query'));
    if (op.kind === 'read' && (!nonEmpty(op.url) || !parsedUrl(op.url))) errors.push(issue('WFR-URL001', `${p}.url`, 'read operation url must use http or https'));
  }
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i]; const p = `sources[${i}]`; if (!object(source)) { errors.push(issue('WFR-TYPE001', p, `${p} must be an object`)); continue; }
    idError(errors, source.id, `${p}.id`); for (const field of ['url', 'title', 'sourceType', 'publishedAt', 'retrievedAt', 'access', 'excerpt', 'locator', 'originGroup', 'operationIds']) if (!(field in source)) errors.push(issue('WFR-REQ001', `${p}.${field}`, `${field} is required`));
    if (!nonEmpty(source.url) || !parsedUrl(source.url)) errors.push(issue('WFR-URL001', `${p}.url`, 'url must use http or https')); if (!nonEmpty(source.title, 500)) errors.push(issue('WFR-REQ001', `${p}.title`, 'title must be a non-empty string'));
    enumError(errors, source.sourceType, `${p}.sourceType`, SOURCE_TYPES); enumError(errors, source.access, `${p}.access`, ACCESSES); if (!validDate(source.publishedAt, true)) errors.push(issue('WFR-DATE001', `${p}.publishedAt`, 'publishedAt must be a valid date or null')); if (!validDate(source.retrievedAt)) errors.push(issue('WFR-DATE001', `${p}.retrievedAt`, 'retrievedAt must be a valid date')); if (!nonEmpty(source.excerpt, 2000)) errors.push(issue('WFR-LEN001', `${p}.excerpt`, 'excerpt must be a non-empty string of at most 2000 characters'));
    if (source.locator !== null && source.locator !== undefined && !nonEmpty(source.locator, 500)) errors.push(issue('WFR-TYPE001', `${p}.locator`, 'locator must be a string or null')); if (source.originGroup !== null && source.originGroup !== undefined && !nonEmpty(source.originGroup, 200)) errors.push(issue('WFR-TYPE001', `${p}.originGroup`, 'originGroup must be a string or null')); ids(errors, source.operationIds, `${p}.operationIds`, operationIds, 'operation');
    if (Array.isArray(source.operationIds)) {
      if (source.operationIds.length === 0) errors.push(issue('WFR-EVD003', `${p}.operationIds`, 'source must reference at least one discovery or read operation'));
      for (const operationId of source.operationIds) {
        const operation = operations.find(candidate => candidate?.id === operationId);
        if (operation && operation.outcome !== 'success') errors.push(issue('WFR-EVD003', `${p}.operationIds`, `source cannot reference ${operation.outcome} operation: ${operationId}`));
      }
    }
  }
  for (let i = 0; i < claims.length; i += 1) {
    const claim = claims[i]; const p = `claims[${i}]`; if (!object(claim)) { errors.push(issue('WFR-TYPE001', p, `${p} must be an object`)); continue; }
    idError(errors, claim.id, `${p}.id`); for (const field of ['text', 'kind', 'importance', 'supportIds', 'contradictionIds', 'dependsOnClaimIds', 'status', 'confidence', 'confidenceReason', 'gaps']) if (!(field in claim)) errors.push(issue('WFR-REQ001', `${p}.${field}`, `${field} is required`)); if (!nonEmpty(claim.text, 2000)) errors.push(issue('WFR-REQ001', `${p}.text`, 'claim text must be a non-empty string of at most 2000 characters')); enumError(errors, claim.kind, `${p}.kind`, CLAIM_KINDS); enumError(errors, claim.importance, `${p}.importance`, IMPORTANCES); enumError(errors, claim.status, `${p}.status`, CLAIM_STATUSES); enumError(errors, claim.confidence, `${p}.confidence`, CONFIDENCES); if (!nonEmpty(claim.confidenceReason, 1000)) errors.push(issue('WFR-REQ001', `${p}.confidenceReason`, 'confidenceReason is required'));
    ids(errors, claim.supportIds, `${p}.supportIds`, sourceIds, 'source'); ids(errors, claim.contradictionIds, `${p}.contradictionIds`, sourceIds, 'source'); ids(errors, claim.dependsOnClaimIds, `${p}.dependsOnClaimIds`, claimIds, 'claim'); if (claim.gaps !== undefined && (!Array.isArray(claim.gaps) || claim.gaps.some(gap => typeof gap !== 'string'))) errors.push(issue('WFR-TYPE001', `${p}.gaps`, 'gaps must be an array of strings'));
    if ((claim.kind === 'inference' || claim.kind === 'recommendation') && (!Array.isArray(claim.supportIds) || claim.supportIds.length === 0)) errors.push(issue('WFR-EVD002', `${p}.supportIds`, 'inference and recommendation claims require supportIds')); if (Array.isArray(claim.supportIds) && claim.supportIds.filter(id => sources.some(source => source?.id === id && PRIMARY_SOURCE_TYPES.has(source.sourceType))).length > 3) errors.push(issue('WFR-EVD005', `${p}.supportIds`, 'claims may reference at most 3 primary supporting sources')); if ((claim.kind === 'fact' || claim.importance === 'major') && claim.status === 'supported' && (!Array.isArray(claim.supportIds) || !claim.supportIds.some(id => sources.some(source => source?.id === id && source.access !== 'snippet')))) errors.push(issue('WFR-EVD001', `${p}.supportIds`, 'supported fact or major claims require non-snippet evidence')); if (claim.importance === 'major' && Array.isArray(claim.contradictionIds) && claim.contradictionIds.length > 0 && claim.status === 'supported') errors.push(issue('WFR-EVD004', `${p}.status`, 'major claims with contradictions must be disputed or insufficient'));
    if (claim.kind === 'community-observation' && /\b(all|every|consensus|everyone|community agrees)\b/i.test(claim.text || '')) warnings.push(issue('WFR-COM001', `${p}.text`, 'community observation may exceed its observed scope'));
  }
  if (hasCycle(claims)) errors.push(issue('WFR-REF002', 'claims', 'claim dependency cycle detected'));
  const searchCount = operations.filter(op => op?.kind === 'search').length; const readCount = operations.filter(op => op?.kind === 'read').length; const overBudget = searchCount > limits.maxSearches || readCount > limits.maxReads; if (overBudget) errors.push(issue('WFR-EBT001', 'operations', `operation budget exceeded: searches ${searchCount}/${limits.maxSearches}, reads ${readCount}/${limits.maxReads}`));
  if (!['complete', 'incomplete'].includes(result.status)) errors.push(issue('WFR-ENUM001', 'status', 'status must be complete or incomplete')); for (const claim of claims) if (claim?.importance === 'major' && ['disputed', 'insufficient'].includes(claim.status) && result.status === 'complete') errors.push(issue('WFR-STA001', 'status', 'complete reports cannot contain an unresolved disputed or insufficient major claim'));
  return { ok: errors.length === 0, errors, warnings, normalized: result, summary: { mode: result.mode, depth: result.depth, operations: operations.length, sources: sources.length, claims: claims.length, status: result.status, overBudget } };
}

function plain(value) { return String(value ?? '').replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/javascript\s*:/gi, 'unsafe:'); }
// Square brackets are escaped in ALL text output (not just link labels) so
// escaped-bracket tricks like `[x\]](https://evil.example)` can never leave a
// residual bracket pair that a Markdown renderer would re-form into a link.
function escape(value) { return plain(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\[/g, '&#91;').replace(/\]/g, '&#93;'); }
function safeMarkdownUrl(value) { return value.replace(/[\\()[\]<>"`]/g, character => `%${character.codePointAt(0).toString(16).toUpperCase().padStart(2, '0')}`); }
function escapeMarkdownLabel(value) { return escape(value); }
function portablePath(value) { return String(value).split(path.sep).join('/'); }
export function renderResearchResult(value) {
  const checked = value?.normalized && Array.isArray(value.errors) ? value : validateResearchResult(value); if (!checked.ok) return null; const result = checked.normalized;
  const lines = ['# Research report', '', `**Question:** ${escape(result.question)}`, `**Mode:** ${escape(result.mode)}  `, `**Status:** ${escape(result.status)}  `, `**Checked:** ${escape(result.checkedAt)}`, '', '## Claims'];
  for (const claim of result.claims || []) lines.push(`- **${escape(claim.status)}** ${escape(claim.text)} _(confidence: ${escape(claim.confidence)}; evidence: ${escape([...(claim.supportIds || []), ...(claim.contradictionIds || [])].join(', ') || 'none')})_`);
  lines.push('', '## Sources'); for (const source of result.sources || []) { const url = parsedUrl(source.url) ? safeMarkdownUrl(normalizeSourceUrl(source.url)) : ''; lines.push(`- ${url ? `[${escapeMarkdownLabel(source.title)}](${url})` : escape(source.title)} — ${escape(source.sourceType)}; ${escape(source.access)}; ${escape(source.excerpt)}`); }
  if (result.limitations?.length) lines.push('', '## Limitations', ...result.limitations.map(item => `- ${escape(item)}`)); return `${lines.join('\n')}\n`;
}
export function resolveSaveTarget({ project, task, id }) {
  const root = scopedProject(project, { label: '--project' }); if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('--id must be a safe report id'); const researchDir = scopedPath(root, path.join(root, 'Harness', 'research', 'search', id), { label: 'Research report target' }); const tasksDir = path.join(root, 'Harness', 'tasks'); if (task) scopedPath(root, tasksDir, { mustExist: true, label: 'Harness/tasks' }); const output = { reportId: id, projectRoot: portablePath(root), researchDir: portablePath(researchDir), tasksDir: portablePath(path.resolve(tasksDir)) }; if (task) { const taskDir = scopedTaskDirectory(root, task, { requireState: true }); output.taskDir = portablePath(taskDir); output.taskEvidenceDir = portablePath(scopedPath(taskDir, path.join(taskDir, 'evidence', 'wf-search', id), { label: 'Task evidence target' })); } return output;
}
export function readInput(input) {
  if (!input) throw new Error('--input is required'); let data; if (input === '-') { data = readStdinBounded(); } else { const file = path.resolve(input); const stat = fs.statSync(file); if (!stat.isFile()) throw new Error('--input must be a file'); if (stat.size > MAX_INPUT_BYTES) throw new Error('input exceeds 1 MiB'); data = fs.readFileSync(file); } try { return JSON.parse(data.toString('utf8')); } catch (error) { throw new Error(`invalid JSON: ${error.message}`); }
}
// Stream stdin instead of readFileSync(0): the 1 MiB limit must be enforced
// during the read so an oversized stream aborts instead of buffering first.
function readStdinBounded() {
  const chunks = []; let received = 0;
  while (true) {
    const chunk = Buffer.alloc(64 * 1024);
    let bytes;
    try { bytes = fs.readSync(0, chunk, 0, chunk.length); } catch (error) { if (error.code === 'EAGAIN') continue; throw error; }
    if (bytes === 0) break;
    received += bytes; if (received > MAX_INPUT_BYTES) throw new Error('input exceeds 1 MiB');
    chunks.push(chunk.subarray(0, bytes));
  }
  return Buffer.concat(chunks);
}
