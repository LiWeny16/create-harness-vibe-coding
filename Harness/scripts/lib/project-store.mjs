import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const PROJECT_ENTRY = 'Harness/project/PROJECT.json';
export const WORKSPACE_INDEX = '.harness-workspace/INDEX.json';
export const PROJECT_ENTRY_MAX_BYTES = 4096;
export const DEFAULT_ROUTE_BUDGET_BYTES = 8192;
export const MAX_ROUTE_BUDGET_BYTES = 65536;
export const MAX_PAGE_SIZE = 100;
export const MAX_RECORD_BYTES = 8192;
export const MAX_TASK_INDEX_BYTES = 1024 * 1024;
export const MAX_PROGRESS_SEGMENT_BYTES = 8192;
export const MAX_PROGRESS_ITEMS_PER_SEGMENT = 100;
export const MAX_SEARCH_SCAN_RECORDS = 1000;
export const RECORD_INPUT_FIELDS = Object.freeze(['schemaVersion','id','section','kind','title','content','text','status','createdAt','source','taskIds','tasks','milestoneIds']);

export const PROJECT_STATUSES = Object.freeze(['active', 'paused', 'completed', 'archived']);
export const PROJECT_STAGES = Object.freeze(['discovery', 'planning', 'execution', 'maintenance', 'sunset']);
export const PROJECT_DOMAINS = Object.freeze({
  charter: 'charter.json',
  plan: 'plan/INDEX.json',
  risks: 'risks/INDEX.json',
  decisions: 'decisions/INDEX.json',
  progress: 'progress/INDEX.json',
  evidence: 'evidence/INDEX.json',
});

export const WORKSPACE_INDEX_DEFAULT = Object.freeze({
  schemaVersion: 1,
  routesRoot: 'routes',
  activeRoot: 'routes/active',
  archivedRoot: 'routes/archived',
  shardAlgorithm: 'sha256-prefix-2',
});

const DOMAIN_CONFIG = Object.freeze({
  plan: { dirname: 'plan', indexPath: 'plan/INDEX.json', recordsRoot: 'milestones' },
  risks: { dirname: 'risks', indexPath: 'risks/INDEX.json', recordsRoot: 'records' },
  decisions: { dirname: 'decisions', indexPath: 'decisions/INDEX.json', recordsRoot: 'records' },
  evidence: { dirname: 'evidence', indexPath: 'evidence/INDEX.json', recordsRoot: 'records' },
});
const PROGRESS_INDEX = Object.freeze({
  schemaVersion: 1,
  segmentsRoot: 'segments',
  partition: 'YYYY/MM',
  maxSegmentBytes: MAX_PROGRESS_SEGMENT_BYTES,
});
const DOMAIN_INDEXES = Object.freeze({
  plan: { schemaVersion: 1, recordsRoot: 'milestones', shardAlgorithm: 'sha256-prefix-2' },
  risks: { schemaVersion: 1, recordsRoot: 'records', shardAlgorithm: 'sha256-prefix-2' },
  decisions: { schemaVersion: 1, recordsRoot: 'records', shardAlgorithm: 'sha256-prefix-2' },
  evidence: { schemaVersion: 1, recordsRoot: 'records', shardAlgorithm: 'sha256-prefix-2' },
});

export class ProjectError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
    this.statusCode = ({ NOT_FOUND: 404, ARCHIVED: 409, CONFLICT: 409, REVISION_CONFLICT: 409, IMPORT_CONFLICT: 409, ROLLBACK_CONFLICT: 409, BUDGET_EXCEEDED: 413, INVALID_PROJECT: 422, INVALID_INDEX: 422, INVALID_ROUTE: 422, INVALID_RECORD: 422, INVALID_TRANSACTION: 422, VALIDATION_FAILED: 422 })[code] || 400;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new ProjectError(code, message, details);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function projectRouteShard(projectId) {
  return sha256(String(projectId)).slice(0, 2);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    fail('BAD_PATH', `${label} must be a non-empty relative path`);
  }
  const normalized = value.replace(/\\/g, '/');
  if (path.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    fail('BAD_PATH', `${label} must be relative`);
  }
  const parts = normalized.split('/');
  if (parts.some(part => part === '..' || part === '.')) {
    fail('BAD_PATH', `${label} must not contain dot segments`);
  }
  return parts.join('/');
}

function realPathOrParent(candidate) {
  let current = candidate;
  const tail = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    tail.unshift(path.basename(current));
    current = parent;
  }
  const realParent = fs.realpathSync(current);
  return path.join(realParent, ...tail);
}

export function resolveInside(root, relativePath, label = 'path') {
  const normalized = normalizeRelativePath(relativePath, label);
  const rootReal = fs.realpathSync(root);
  const candidate = path.resolve(rootReal, ...normalized.split('/'));
  if (!isInside(rootReal, candidate)) fail('BAD_PATH', `${label} escapes its root`);
  const resolved = realPathOrParent(candidate);
  if (!resolved || !isInside(rootReal, resolved)) fail('BAD_PATH', `${label} escapes its root through a symlink`);
  return candidate;
}

function ensureAbsoluteDirectory(root, label) {
  const absolute = path.resolve(root);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    fail('NOT_FOUND', `${label} directory does not exist: ${absolute}`);
  }
  return fs.realpathSync(absolute);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function atomicWriteFile(filePath, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (!fs.existsSync(filePath) || !['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
      throw error;
    }
    const backup = `${filePath}.bak-${randomUUID()}`;
    fs.renameSync(filePath, backup);
    try {
      fs.renameSync(temporary, filePath);
      fs.rmSync(backup, { force: true });
    } catch (replaceError) {
      if (!fs.existsSync(filePath) && fs.existsSync(backup)) fs.renameSync(backup, filePath);
      try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
      throw replaceError;
    }
  }
}

export function atomicWriteJson(filePath, value) {
  atomicWriteFile(filePath, jsonBytes(value));
}

function parseProgressRecord(line, file) {
  try {
    return JSON.parse(line);
  } catch {
    fail('INVALID_RECORD', `Progress segment contains invalid JSON: ${path.basename(file)}`);
  }
}

function readBoundedFile(filePath, maxBytes) {
  const fd = fs.openSync(filePath, 'r');
  const chunks = [];
  let totalBytes = 0;
  try {
    const buffer = Buffer.alloc(64 * 1024);
    while (true) {
      const remaining = maxBytes + 1 - totalBytes;
      const bytesRead = fs.readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) fail('BUDGET_EXCEEDED', `File exceeds ${maxBytes} byte budget: ${filePath}`);
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
  } finally {
    fs.closeSync(fd);
  }
  return Buffer.concat(chunks, totalBytes);
}

export function readJsonFile(filePath, maxBytes = MAX_RECORD_BYTES) {
  let bytes;
  try {
    bytes = readBoundedFile(filePath, maxBytes);
  } catch (error) {
    if (error.code === 'ENOENT') fail('NOT_FOUND', `File not found: ${filePath}`);
    throw error;
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail('INVALID_JSON', `Invalid JSON in ${filePath}: ${error.message}`);
  }
}

const TRANSACTION_DIRECTORY = '.transactions';
const TRANSACTION_JOURNAL_MAX_BYTES = 16 * 1024;
const TRANSACTION_PAYLOAD_MAX_BYTES = 64 * 1024;
const MAX_TRANSACTION_ENTRIES = 64;

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function transactionDirectory(root, relative, label, create = false) {
  const directory = resolveInside(root, relative, label);
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) return null;
    fs.mkdirSync(directory, { recursive: true });
    stat = fs.lstatSync(directory);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('INVALID_TRANSACTION', `${label} must be a real directory`);
  return directory;
}

function regularFileBytes(filePath, maxBytes, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') fail('INVALID_TRANSACTION', `${label} is missing: ${filePath}`);
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail('INVALID_TRANSACTION', `${label} must be a regular file: ${filePath}`);
  return readBoundedFile(filePath, maxBytes);
}

function hashOrNull(filePath, maxBytes = TRANSACTION_PAYLOAD_MAX_BYTES) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail('INVALID_TRANSACTION', `Transaction target must be a regular file: ${filePath}`);
  return sha256(readBoundedFile(filePath, maxBytes));
}

function optionalRegularFileBytes(filePath, maxBytes, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail('INVALID_TRANSACTION', `${label} must be a regular file: ${filePath}`);
  return readBoundedFile(filePath, maxBytes);
}

function transactionStagePath(root, transactionRelative, id, name) {
  const relative = `${transactionRelative}/${id}.${name}.stage`;
  return resolveInside(root, relative, `Transaction ${name} staging path`);
}

function validateHash(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) fail('INVALID_TRANSACTION', `${label} must be a SHA-256 hash`);
}

function validateStageReference(root, transactionRelative, id, value, name, required) {
  if (value === null && !required) return null;
  const expected = `${transactionRelative}/${id}.${name}.stage`;
  if (value !== expected) fail('INVALID_TRANSACTION', `Transaction staging path for ${name} is invalid`);
  return transactionStagePath(root, transactionRelative, id, name);
}

function readTransactionJournal(filePath) {
  const bytes = regularFileBytes(filePath, TRANSACTION_JOURNAL_MAX_BYTES, 'Transaction journal');
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail('INVALID_TRANSACTION', `Invalid transaction journal ${filePath}: ${error.message}`);
  }
}

function listTransactionJournals(directory, label) {
  if (!directory) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  if (entries.length > MAX_TRANSACTION_ENTRIES) fail('INVALID_TRANSACTION', `${label} contains too many entries`);
  const journals = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) fail('INVALID_TRANSACTION', `${label} contains a symlink: ${entry.name}`);
    if (!entry.name.endsWith('.json')) continue;
    if (!/^txn-[0-9a-f-]+\.json$/i.test(entry.name) || !entry.isFile()) {
      fail('INVALID_TRANSACTION', `Unexpected transaction journal entry: ${entry.name}`);
    }
    journals.push({ path: path.join(directory, entry.name), id: entry.name.slice(0, -5) });
  }
  return journals.sort((a, b) => a.path.localeCompare(b.path));
}

function parseStagedJson(filePath, label) {
  const bytes = regularFileBytes(filePath, TRANSACTION_PAYLOAD_MAX_BYTES, label);
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch (error) {
    fail('INVALID_TRANSACTION', `Invalid staged JSON ${filePath}: ${error.message}`);
  }
}

function removeTransactionArtifact(filePath, label) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) fail('INVALID_TRANSACTION', `${label} is not removable safely`);
    fs.rmSync(filePath, { force: true, recursive: stat.isDirectory() });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function cleanupTransaction(journalPath, stagePaths) {
  for (const stagePath of stagePaths) if (stagePath) removeTransactionArtifact(stagePath, 'Transaction staging file');
  removeTransactionArtifact(journalPath, 'Transaction journal');
}

function replaceFromStage(targetPath, stagePath, oldHash, newHash, label) {
  const currentHash = hashOrNull(targetPath);
  if (currentHash === newHash) return;
  if (currentHash !== oldHash) fail('INVALID_TRANSACTION', `${label} has an unexpected hash`);
  const bytes = regularFileBytes(stagePath, TRANSACTION_PAYLOAD_MAX_BYTES, `${label} staging file`);
  if (sha256(bytes) !== newHash) fail('INVALID_TRANSACTION', `${label} staging payload hash does not match its journal`);
  atomicWriteFile(targetPath, bytes);
  if (hashOrNull(targetPath) !== newHash) fail('INVALID_TRANSACTION', `${label} did not reach its staged hash`);
}

function removeExpectedFile(filePath, oldHash, label) {
  const currentHash = hashOrNull(filePath);
  if (currentHash === null) return;
  if (currentHash !== oldHash) fail('INVALID_TRANSACTION', `${label} has an unexpected hash`);
  fs.rmSync(filePath, { force: true });
  if (hashOrNull(filePath) !== null) fail('INVALID_TRANSACTION', `${label} was not removed`);
}

function validateCharterValue(charter) {
  if (!charter || typeof charter !== 'object' || Array.isArray(charter)) fail('INVALID_CHARTER', 'Charter must be a JSON object');
  const allowedKeys = ['goal', 'nonGoals', 'schemaVersion', 'scope'];
  const keys = Object.keys(charter).sort();
  if (JSON.stringify(keys) !== JSON.stringify(allowedKeys)) fail('INVALID_CHARTER', `Charter has unsupported fields: ${keys.filter(key => !allowedKeys.includes(key)).join(', ')}`);
  if (charter.schemaVersion !== 1) fail('INVALID_CHARTER', 'Charter schemaVersion must be 1');
  if (typeof charter.goal !== 'string' || charter.goal.length > 2000) fail('INVALID_CHARTER', 'goal must be a string <= 2000 characters');
  for (const key of ['scope', 'nonGoals']) {
    if (!Array.isArray(charter[key]) || charter[key].some(item => typeof item !== 'string')) fail('INVALID_CHARTER', `${key} must be an array of strings`);
  }
  if (Buffer.byteLength(JSON.stringify(charter)) > DEFAULT_ROUTE_BUDGET_BYTES) fail('BUDGET_EXCEEDED', 'Charter exceeds 8 KiB; split details into Project records');
}

function createProjectCharterTransaction(root, oldManifest, newManifest, oldManifestBytes, oldCharterBytes, newCharterBytes) {
  const transactionRelative = `Harness/project/${TRANSACTION_DIRECTORY}`;
  const directory = transactionDirectory(root, transactionRelative, 'Project transaction directory', true);
  const id = `txn-${randomUUID()}`;
  const charterOldStage = transactionStagePath(root, transactionRelative, id, 'charter.old');
  const charterNewStage = transactionStagePath(root, transactionRelative, id, 'charter.new');
  const projectOldStage = transactionStagePath(root, transactionRelative, id, 'project.old');
  const projectNewStage = transactionStagePath(root, transactionRelative, id, 'project.new');
  const journal = {
    schemaVersion: 1,
    type: 'project-charter-v1',
    id,
    charter: {
      path: 'Harness/project/charter.json',
      oldHash: sha256(oldCharterBytes),
      newHash: sha256(newCharterBytes),
      oldStage: `${transactionRelative}/${id}.charter.old.stage`,
      newStage: `${transactionRelative}/${id}.charter.new.stage`,
    },
    project: {
      path: PROJECT_ENTRY,
      oldHash: sha256(oldManifestBytes),
      newHash: sha256(jsonBytes(newManifest)),
      oldRevision: oldManifest.revision,
      newRevision: newManifest.revision,
      oldStage: `${transactionRelative}/${id}.project.old.stage`,
      newStage: `${transactionRelative}/${id}.project.new.stage`,
    },
  };
  const journalPath = path.join(directory, `${id}.json`);
  atomicWriteFile(charterOldStage, oldCharterBytes);
  atomicWriteFile(charterNewStage, newCharterBytes);
  atomicWriteFile(projectOldStage, oldManifestBytes);
  atomicWriteFile(projectNewStage, jsonBytes(newManifest));
  atomicWriteJson(journalPath, journal);
  return { journalPath, charterPath: resolveInside(root, 'Harness/project/charter.json', 'Project charter'), manifestPath: resolveInside(root, PROJECT_ENTRY, 'Project entry'), journal, stages: [charterOldStage, charterNewStage, projectOldStage, projectNewStage] };
}

function commitProjectCharterTransaction(transaction) {
  const { journal } = transaction;
  const charterOldStage = transaction.stages.find(stage => stage.endsWith('.charter.old.stage'));
  const charterNewStage = transaction.stages.find(stage => stage.endsWith('.charter.new.stage'));
  const projectOldStage = transaction.stages.find(stage => stage.endsWith('.project.old.stage'));
  const projectNewStage = transaction.stages.find(stage => stage.endsWith('.project.new.stage'));
  replaceFromStage(transaction.charterPath, charterNewStage, journal.charter.oldHash, journal.charter.newHash, 'Charter');
  replaceFromStage(transaction.manifestPath, projectNewStage, journal.project.oldHash, journal.project.newHash, 'Project manifest');
  cleanupTransaction(transaction.journalPath, [charterOldStage, charterNewStage, projectOldStage, projectNewStage]);
}

function recoverProjectCharterTransaction(root, transactionDirectoryPath, journalPath, journal) {
  const id = path.basename(journalPath, '.json');
  if (!exactKeys(journal, ['schemaVersion', 'type', 'id', 'charter', 'project']) || journal.schemaVersion !== 1 || journal.type !== 'project-charter-v1' || journal.id !== id) {
    fail('INVALID_TRANSACTION', `Unsupported Project transaction journal: ${journalPath}`);
  }
  const transactionRelative = path.relative(root, transactionDirectoryPath).replace(/\\/g, '/');
  const expectedTransactionRelative = `Harness/project/${TRANSACTION_DIRECTORY}`;
  if (transactionRelative !== expectedTransactionRelative) fail('INVALID_TRANSACTION', 'Project transaction directory is invalid');
  if (!exactKeys(journal.charter, ['path', 'oldHash', 'newHash', 'oldStage', 'newStage']) || !exactKeys(journal.project, ['path', 'oldHash', 'newHash', 'oldRevision', 'newRevision', 'oldStage', 'newStage'])) {
    fail('INVALID_TRANSACTION', 'Project transaction metadata is invalid');
  }
  const charter = journal.charter;
  const project = journal.project;
  if (charter.path !== 'Harness/project/charter.json' || project.path !== PROJECT_ENTRY) fail('INVALID_TRANSACTION', 'Project transaction target path is invalid');
  validateHash(charter.oldHash, 'Charter oldHash');
  validateHash(charter.newHash, 'Charter newHash');
  validateHash(project.oldHash, 'Project oldHash');
  validateHash(project.newHash, 'Project newHash');
  if (!Number.isInteger(project.oldRevision) || !Number.isInteger(project.newRevision) || project.newRevision !== project.oldRevision + 1) fail('INVALID_TRANSACTION', 'Project transaction revisions are invalid');
  const charterOldStage = validateStageReference(root, expectedTransactionRelative, id, charter.oldStage, 'charter.old', true);
  const charterNewStage = validateStageReference(root, expectedTransactionRelative, id, charter.newStage, 'charter.new', true);
  const projectOldStage = validateStageReference(root, expectedTransactionRelative, id, project.oldStage, 'project.old', true);
  const projectNewStage = validateStageReference(root, expectedTransactionRelative, id, project.newStage, 'project.new', true);
  const charterOld = parseStagedJson(charterOldStage, 'Charter old staging file');
  const charterNew = parseStagedJson(charterNewStage, 'Charter new staging file');
  validateCharterValue(charterOld.value);
  validateCharterValue(charterNew.value);
  if (sha256(charterOld.bytes) !== charter.oldHash || sha256(charterNew.bytes) !== charter.newHash) fail('INVALID_TRANSACTION', 'Charter staging payload hash mismatch');
  const projectOld = parseStagedJson(projectOldStage, 'Project old staging file');
  const projectNew = parseStagedJson(projectNewStage, 'Project new staging file');
  for (const [label, payload, expectedHash, expectedRevision] of [
    ['old', projectOld, project.oldHash, project.oldRevision],
    ['new', projectNew, project.newHash, project.newRevision],
  ]) {
    const errors = validateProjectManifest(payload.value);
    if (errors.length || sha256(payload.bytes) !== expectedHash || payload.value.revision !== expectedRevision) fail('INVALID_TRANSACTION', `Project ${label} staging payload is invalid`);
  }
  if (projectOld.value.id !== projectNew.value.id) fail('INVALID_TRANSACTION', 'Project transaction changes the Project id');
  const manifestPath = resolveInside(root, PROJECT_ENTRY, 'Project transaction manifest');
  const charterPath = resolveInside(root, 'Harness/project/charter.json', 'Project transaction charter');
  replaceFromStage(charterPath, charterNewStage, charter.oldHash, charter.newHash, 'Charter');
  replaceFromStage(manifestPath, projectNewStage, project.oldHash, project.newHash, 'Project manifest');
  if (hashOrNull(charterPath) !== charter.newHash || hashOrNull(manifestPath) !== project.newHash) fail('INVALID_TRANSACTION', 'Project transaction did not reach its final hashes');
  cleanupTransaction(journalPath, [charterOldStage, charterNewStage, projectOldStage, projectNewStage]);
}

function recoverProjectTransactions(root) {
  const directory = transactionDirectory(root, `Harness/project/${TRANSACTION_DIRECTORY}`, 'Project transaction directory');
  for (const { path: journalPath } of listTransactionJournals(directory, 'Project transaction directory')) {
    recoverProjectCharterTransaction(root, directory, journalPath, readTransactionJournal(journalPath));
  }
}

function validateRouteRootValue(value, label) {
  if (value === '.') return;
  normalizeRelativePath(value, label);
}

function routeRelativePath(category, projectId) {
  return `.harness-workspace/routes/${category}/${projectRouteShard(projectId)}/${projectId}.json`;
}

function validateRouteMetadata(root, transactionRelative, id, metadata, name, expectedPath, requireNew) {
  if (!exactKeys(metadata, ['path', 'oldHash', 'newHash', 'oldStage', 'newStage']) || metadata.path !== expectedPath) fail('INVALID_TRANSACTION', `Route ${name} metadata is invalid`);
  validateHash(metadata.oldHash, `Route ${name} oldHash`, true);
  validateHash(metadata.newHash, `Route ${name} newHash`, true);
  if (requireNew && metadata.newHash === null) fail('INVALID_TRANSACTION', `Route ${name} must have a new payload`);
  const oldStage = validateStageReference(root, transactionRelative, id, metadata.oldStage, `${name}.old`, metadata.oldHash !== null);
  const newStage = validateStageReference(root, transactionRelative, id, metadata.newStage, `${name}.new`, metadata.newHash !== null);
  if ((metadata.oldHash === null) !== (oldStage === null) || (metadata.newHash === null) !== (newStage === null)) fail('INVALID_TRANSACTION', `Route ${name} staging metadata is inconsistent`);
  return { oldStage, newStage };
}

function recoverWorkspaceRouteTransaction(workspace, transactionDirectoryPath, journalPath, journal) {
  const id = path.basename(journalPath, '.json');
  if (!exactKeys(journal, ['schemaVersion', 'type', 'id', 'projectId', 'category', 'sourceCategory', 'destination', 'source', 'project']) || journal.schemaVersion !== 1 || journal.type !== 'workspace-route-v1' || journal.id !== id) {
    fail('INVALID_TRANSACTION', `Unsupported workspace transaction journal: ${journalPath}`);
  }
  if (!['active', 'archived'].includes(journal.category) || !['active', 'archived'].includes(journal.sourceCategory) || journal.category === journal.sourceCategory || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(journal.projectId)) {
    fail('INVALID_TRANSACTION', 'Workspace route transaction categories or id are invalid');
  }
  const projectId = journal.projectId;
  const transactionRelative = path.relative(workspace, transactionDirectoryPath).replace(/\\/g, '/');
  const expectedTransactionRelative = `.harness-workspace/${TRANSACTION_DIRECTORY}`;
  if (transactionRelative !== expectedTransactionRelative) fail('INVALID_TRANSACTION', 'Workspace transaction directory is invalid');
  const expectedDestination = routeRelativePath(journal.category, projectId);
  const expectedSource = routeRelativePath(journal.sourceCategory, projectId);
  const destination = validateRouteMetadata(workspace, expectedTransactionRelative, id, journal.destination, 'destination', expectedDestination, true);
  const source = validateRouteMetadata(workspace, expectedTransactionRelative, id, journal.source, 'source', expectedSource, false);
  const destinationNew = parseStagedJson(destination.newStage, 'Destination route staging file');
  const route = destinationNew.value;
  if (sha256(destinationNew.bytes) !== journal.destination.newHash) fail('INVALID_TRANSACTION', 'Destination route staging payload hash mismatch');
  if (!route || route.id !== projectId || route.entry !== PROJECT_ENTRY) fail('INVALID_TRANSACTION', 'Destination route staging payload is invalid');
  validateRouteRootValue(route.root, 'Destination Project root route');
  let destinationOld = null;
  if (destination.oldStage) {
    destinationOld = parseStagedJson(destination.oldStage, 'Destination old route staging file');
    if (sha256(destinationOld.bytes) !== journal.destination.oldHash) fail('INVALID_TRANSACTION', 'Destination old route staging payload hash mismatch');
    const oldRoute = destinationOld.value;
    if (!oldRoute || oldRoute.id !== projectId || oldRoute.entry !== PROJECT_ENTRY || oldRoute.root !== route.root) fail('INVALID_TRANSACTION', 'Destination old route staging payload is invalid');
  }
  if (source.oldStage) {
    const sourceOld = parseStagedJson(source.oldStage, 'Source route staging file');
    if (sha256(sourceOld.bytes) !== journal.source.oldHash) fail('INVALID_TRANSACTION', 'Source route staging payload hash mismatch');
    const oldRoute = sourceOld.value;
    if (!oldRoute || oldRoute.id !== projectId || oldRoute.entry !== PROJECT_ENTRY || oldRoute.root !== route.root) fail('INVALID_TRANSACTION', 'Source route staging payload is invalid');
  }
  const destinationPath = resolveInside(workspace, expectedDestination, 'Destination workspace route');
  const sourcePath = resolveInside(workspace, expectedSource, 'Source workspace route');
  const projectRoot = workspaceRootPath(workspace, route);
  let projectStagePaths = [];
  if (journal.project !== null) {
    if (!exactKeys(journal.project, ['root', 'path', 'oldHash', 'newHash', 'oldRevision', 'newRevision', 'oldStage', 'newStage']) || journal.project.root !== route.root || journal.project.path !== PROJECT_ENTRY) fail('INVALID_TRANSACTION', 'Workspace Project metadata is invalid');
    validateRouteRootValue(journal.project.root, 'Workspace Project root');
    validateHash(journal.project.oldHash, 'Workspace Project oldHash');
    validateHash(journal.project.newHash, 'Workspace Project newHash');
    if (!Number.isInteger(journal.project.oldRevision) || !Number.isInteger(journal.project.newRevision) || journal.project.newRevision !== journal.project.oldRevision + 1) fail('INVALID_TRANSACTION', 'Workspace Project revisions are invalid');
    const projectOldStage = validateStageReference(workspace, expectedTransactionRelative, id, journal.project.oldStage, 'project.old', true);
    const projectNewStage = validateStageReference(workspace, expectedTransactionRelative, id, journal.project.newStage, 'project.new', true);
    const oldPayload = parseStagedJson(projectOldStage, 'Workspace Project old staging file');
    const newPayload = parseStagedJson(projectNewStage, 'Workspace Project new staging file');
    for (const [label, payload, expectedHash, expectedRevision] of [
      ['old', oldPayload, journal.project.oldHash, journal.project.oldRevision],
      ['new', newPayload, journal.project.newHash, journal.project.newRevision],
    ]) {
      const errors = validateProjectManifest(payload.value);
      if (errors.length || sha256(payload.bytes) !== expectedHash || payload.value.revision !== expectedRevision || payload.value.id !== projectId) fail('INVALID_TRANSACTION', `Workspace Project ${label} staging payload is invalid`);
    }
    if ((newPayload.value.status === 'archived') !== (journal.category === 'archived') || (oldPayload.value.status === 'archived') !== (journal.sourceCategory === 'archived')) fail('INVALID_TRANSACTION', 'Workspace Project status does not match route categories');
    const manifestPath = resolveInside(projectRoot, PROJECT_ENTRY, 'Workspace Project manifest');
    replaceFromStage(manifestPath, projectNewStage, journal.project.oldHash, journal.project.newHash, 'Workspace Project manifest');
    projectStagePaths = [projectOldStage, projectNewStage];
  }
  const manifest = loadProjectManifest(projectRoot);
  if (manifest.id !== projectId || (manifest.status === 'archived') !== (journal.category === 'archived')) fail('INVALID_TRANSACTION', 'Workspace route does not match Project status');
  if (journal.project && manifest.revision !== journal.project.newRevision) fail('INVALID_TRANSACTION', 'Workspace Project revision does not match its route transaction');
  replaceFromStage(destinationPath, destination.newStage, journal.destination.oldHash, journal.destination.newHash, 'Destination route');
  removeExpectedFile(sourcePath, journal.source.oldHash, 'Source route');
  if (hashOrNull(destinationPath) !== journal.destination.newHash || hashOrNull(sourcePath) !== null) fail('INVALID_TRANSACTION', 'Workspace route transaction did not produce exactly one route');
  cleanupTransaction(journalPath, [destination.oldStage, destination.newStage, source.oldStage, source.newStage, ...projectStagePaths]);
}

function recoverWorkspaceTransactions(workspace) {
  const directory = transactionDirectory(workspace, `.harness-workspace/${TRANSACTION_DIRECTORY}`, 'Workspace transaction directory');
  for (const { path: journalPath } of listTransactionJournals(directory, 'Workspace transaction directory')) {
    recoverWorkspaceRouteTransaction(workspace, directory, journalPath, readTransactionJournal(journalPath));
  }
}

function validateDomainRefs(domains) {
  if (!domains || typeof domains !== 'object' || Array.isArray(domains)) return ['domains must be an object'];
  const errors = [];
  const actualKeys = Object.keys(domains).sort();
  const expectedKeys = Object.keys(PROJECT_DOMAINS).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) errors.push('domains must contain the v1 domain keys only');
  for (const [key, expected] of Object.entries(PROJECT_DOMAINS)) {
    if (domains[key] !== expected) errors.push(`domains.${key} must be ${expected}`);
  }
  return errors;
}

export function validateProjectManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['Project entry must be a JSON object'];
  const expectedKeys = ['schemaVersion', 'id', 'name', 'status', 'stage', 'revision', 'domains'].sort();
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(expectedKeys)) errors.push('Project entry contains missing or unsupported fields');
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(manifest.id)) errors.push('id must be a lowercase route-safe identifier');
  if (typeof manifest.name !== 'string' || manifest.name.trim().length === 0 || manifest.name.length > 200) errors.push('name must be a non-empty string of at most 200 characters');
  if (!PROJECT_STATUSES.includes(manifest.status)) errors.push(`status must be one of: ${PROJECT_STATUSES.join(', ')}`);
  if (!PROJECT_STAGES.includes(manifest.stage)) errors.push(`stage must be one of: ${PROJECT_STAGES.join(', ')}`);
  if (!Number.isInteger(manifest.revision) || manifest.revision < 1) errors.push('revision must be a positive integer');
  errors.push(...validateDomainRefs(manifest.domains));
  return errors;
}

export function loadProjectManifest(projectRoot) {
  const root = ensureAbsoluteDirectory(projectRoot, 'Project root');
  recoverProjectTransactions(root);
  const manifestPath = resolveInside(root, PROJECT_ENTRY, 'Project entry');
  const stat = fs.statSync(manifestPath);
  if (!stat.isFile()) fail('INVALID_PROJECT', `${PROJECT_ENTRY} must be a file`);
  if (stat.size > PROJECT_ENTRY_MAX_BYTES) fail('BUDGET_EXCEEDED', `${PROJECT_ENTRY} exceeds ${PROJECT_ENTRY_MAX_BYTES} bytes`);
  const manifest = readJsonFile(manifestPath, PROJECT_ENTRY_MAX_BYTES);
  const errors = validateProjectManifest(manifest);
  if (errors.length) fail('INVALID_PROJECT', errors.join('; '), { errors });
  return manifest;
}

function createDomainDefaults() {
  return [
    ['charter.json', { schemaVersion: 1, goal: '', scope: [], nonGoals: [] }],
    ['plan/INDEX.json', DOMAIN_INDEXES.plan],
    ['risks/INDEX.json', DOMAIN_INDEXES.risks],
    ['decisions/INDEX.json', DOMAIN_INDEXES.decisions],
    ['progress/INDEX.json', PROGRESS_INDEX],
    ['evidence/INDEX.json', DOMAIN_INDEXES.evidence],
  ];
}

export function makeProjectManifest({ id, name }) {
  const safeName = String(name || '').trim();
  const projectId = String(id || `project-${sha256(`${safeName}\0${randomUUID()}`).slice(0, 16)}`);
  const manifest = {
    schemaVersion: 1,
    id: projectId,
    name: safeName,
    status: 'active',
    stage: 'discovery',
    revision: 1,
    domains: { ...PROJECT_DOMAINS },
  };
  const errors = validateProjectManifest(manifest);
  if (errors.length) fail('INVALID_PROJECT', errors.join('; '), { errors });
  return manifest;
}

export function initializeProject(projectRoot, { id, name, overwrite = false } = {}) {
  const root = path.resolve(projectRoot);
  fs.mkdirSync(root, { recursive: true });
  const projectDir = path.join(root, 'Harness', 'project');
  const manifestPath = path.join(root, ...PROJECT_ENTRY.split('/'));
  if (fs.existsSync(manifestPath) && !overwrite) fail('CONFLICT', `Project entry already exists: ${manifestPath}`);
  const manifest = makeProjectManifest({ id, name: name || path.basename(root) });
  for (const [relativePath, value] of createDomainDefaults()) {
    const target = resolveInside(root, `Harness/project/${relativePath}`, `Project domain ${relativePath}`);
    if (!fs.existsSync(target) || overwrite) atomicWriteJson(target, value);
  }
  fs.mkdirSync(projectDir, { recursive: true });
  atomicWriteJson(manifestPath, manifest);
  return manifest;
}

function readWorkspaceIndex(workspaceRoot, { create = false } = {}) {
  const root = ensureAbsoluteDirectory(workspaceRoot, 'Workspace root');
  recoverWorkspaceTransactions(root);
  const indexPath = resolveInside(root, WORKSPACE_INDEX, 'Workspace Project index');
  if (!fs.existsSync(indexPath)) {
    if (!create) fail('NOT_FOUND', `Workspace Project index not found: ${indexPath}`);
    atomicWriteJson(indexPath, WORKSPACE_INDEX_DEFAULT);
  }
  const stat = fs.statSync(indexPath);
  if (stat.size > PROJECT_ENTRY_MAX_BYTES) fail('BUDGET_EXCEEDED', `Workspace index exceeds ${PROJECT_ENTRY_MAX_BYTES} bytes`);
  const index = readJsonFile(indexPath, PROJECT_ENTRY_MAX_BYTES);
  const expectedKeys = Object.keys(WORKSPACE_INDEX_DEFAULT).sort();
  if (!index || typeof index !== 'object' || Array.isArray(index) || JSON.stringify(Object.keys(index).sort()) !== JSON.stringify(expectedKeys)) {
    fail('INVALID_INDEX', 'Workspace index does not match the supported v1 route-only schema');
  }
  for (const [key, value] of Object.entries(WORKSPACE_INDEX_DEFAULT)) {
    if (index[key] !== value) fail('INVALID_INDEX', 'Workspace index does not match the supported v1 route-only schema');
  }
  return { root, indexRoot: path.dirname(indexPath), index };
}

function routePath(indexRoot, index, category, projectId) {
  const base = category === 'archived' ? index.archivedRoot : index.activeRoot;
  const prefix = projectRouteShard(projectId);
  const candidate = path.join(indexRoot, ...base.split('/'), prefix, `${projectId}.json`);
  const relative = path.relative(indexRoot, candidate).replace(/\\/g, '/');
  return resolveInside(indexRoot, relative, 'Workspace route stub');
}

function readRouteStub(filePath, expectedId = undefined) {
  const route = readJsonFile(filePath, DEFAULT_ROUTE_BUDGET_BYTES);
  if (!route || typeof route !== 'object' || Array.isArray(route)) fail('INVALID_ROUTE', `Invalid Project route stub: ${filePath}`);
  if (JSON.stringify(Object.keys(route).sort()) !== JSON.stringify(['entry', 'id', 'root'])) fail('INVALID_ROUTE', 'Project route stubs may contain only id, root, and entry');
  if (typeof route.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(route.id)) fail('INVALID_ROUTE', 'Project route id is invalid');
  if (expectedId && route.id !== expectedId) fail('INVALID_ROUTE', `Route id does not match requested id ${expectedId}`);
  if (route.entry !== PROJECT_ENTRY) fail('INVALID_ROUTE', `Project route entry must be ${PROJECT_ENTRY}`);
  if (route.root !== '.') normalizeRelativePath(route.root, 'Project root route');
  return route;
}

function findWorkspaceRoute(indexRoot, index, projectId) {
  for (const category of ['active', 'archived']) {
    const file = routePath(indexRoot, index, category, projectId);
    if (fs.existsSync(file)) return { category, file };
  }
  return null;
}

function workspaceRootPath(workspaceRoot, route) {
  if (route.root === '.') return fs.realpathSync(workspaceRoot);
  return resolveInside(workspaceRoot, route.root, 'Project root route');
}

function createWorkspaceRouteTransaction({
  workspace,
  projectId,
  category,
  sourceCategory,
  destinationPath,
  sourcePath,
  destinationOldBytes,
  destinationNewBytes,
  sourceOldBytes,
  projectRoot = null,
  oldManifestBytes = null,
  newManifestBytes = null,
  oldManifest = null,
  newManifest = null,
}) {
  const transactionRelative = `.harness-workspace/${TRANSACTION_DIRECTORY}`;
  const directory = transactionDirectory(workspace, transactionRelative, 'Workspace transaction directory', true);
  const id = `txn-${randomUUID()}`;
  const destinationRelative = path.relative(workspace, destinationPath).replace(/\\/g, '/');
  const sourceRelative = path.relative(workspace, sourcePath).replace(/\\/g, '/');
  if (destinationRelative !== routeRelativePath(category, projectId) || sourceRelative !== routeRelativePath(sourceCategory, projectId)) fail('INVALID_TRANSACTION', 'Workspace route transaction target path is invalid');
  const destinationNewStage = transactionStagePath(workspace, transactionRelative, id, 'destination.new');
  const destinationOldStage = destinationOldBytes ? transactionStagePath(workspace, transactionRelative, id, 'destination.old') : null;
  const sourceOldStage = sourceOldBytes ? transactionStagePath(workspace, transactionRelative, id, 'source.old') : null;
  const projectOldStage = oldManifestBytes ? transactionStagePath(workspace, transactionRelative, id, 'project.old') : null;
  const projectNewStage = newManifestBytes ? transactionStagePath(workspace, transactionRelative, id, 'project.new') : null;
  const destination = {
    path: destinationRelative,
    oldHash: destinationOldBytes ? sha256(destinationOldBytes) : null,
    newHash: sha256(destinationNewBytes),
    oldStage: destinationOldStage ? `${transactionRelative}/${id}.destination.old.stage` : null,
    newStage: `${transactionRelative}/${id}.destination.new.stage`,
  };
  const source = {
    path: sourceRelative,
    oldHash: sourceOldBytes ? sha256(sourceOldBytes) : null,
    newHash: null,
    oldStage: sourceOldStage ? `${transactionRelative}/${id}.source.old.stage` : null,
    newStage: null,
  };
  let project = null;
  if (oldManifestBytes && newManifestBytes) {
    const relativeRoot = path.relative(workspace, projectRoot).replace(/\\/g, '/') || '.';
    if (relativeRoot !== '.' && (relativeRoot === '..' || relativeRoot.startsWith('../') || path.isAbsolute(relativeRoot))) fail('BAD_PATH', 'Project root is outside its workspace');
    project = {
      root: relativeRoot,
      path: PROJECT_ENTRY,
      oldHash: sha256(oldManifestBytes),
      newHash: sha256(newManifestBytes),
      oldRevision: oldManifest.revision,
      newRevision: newManifest.revision,
      oldStage: `${transactionRelative}/${id}.project.old.stage`,
      newStage: `${transactionRelative}/${id}.project.new.stage`,
    };
  } else if (oldManifestBytes || newManifestBytes || oldManifest || newManifest) {
    fail('INVALID_TRANSACTION', 'Workspace Project transaction payloads must be supplied as a pair');
  }
  const journal = { schemaVersion: 1, type: 'workspace-route-v1', id, projectId, category, sourceCategory, destination, source, project };
  const journalPath = path.join(directory, `${id}.json`);
  atomicWriteFile(destinationNewStage, destinationNewBytes);
  if (destinationOldBytes) atomicWriteFile(destinationOldStage, destinationOldBytes);
  if (sourceOldBytes) atomicWriteFile(sourceOldStage, sourceOldBytes);
  if (oldManifestBytes) atomicWriteFile(projectOldStage, oldManifestBytes);
  if (newManifestBytes) atomicWriteFile(projectNewStage, newManifestBytes);
  atomicWriteJson(journalPath, journal);
  return {
    workspace,
    journalPath,
    destinationPath,
    sourcePath,
    projectRoot,
    manifestPath: projectRoot ? resolveInside(projectRoot, PROJECT_ENTRY, 'Workspace Project manifest') : null,
    journal,
    stages: [destinationOldStage, destinationNewStage, sourceOldStage, projectOldStage, projectNewStage].filter(Boolean),
  };
}

function commitWorkspaceRouteTransaction(transaction) {
  const { journal } = transaction;
  if (journal.project) replaceFromStage(transaction.manifestPath, transaction.stages.find(stage => stage.endsWith('.project.new.stage')), journal.project.oldHash, journal.project.newHash, 'Workspace Project manifest');
  replaceFromStage(transaction.destinationPath, transaction.stages.find(stage => stage.endsWith('.destination.new.stage')), journal.destination.oldHash, journal.destination.newHash, 'Destination route');
  removeExpectedFile(transaction.sourcePath, journal.source.oldHash, 'Source route');
  if (hashOrNull(transaction.destinationPath) !== journal.destination.newHash || hashOrNull(transaction.sourcePath) !== null) fail('INVALID_TRANSACTION', 'Workspace route transaction did not produce exactly one route');
  cleanupTransaction(transaction.journalPath, transaction.stages);
}

export function registerWorkspaceProject(workspaceRoot, projectRoot) {
  const workspace = ensureAbsoluteDirectory(workspaceRoot, 'Workspace root');
  const root = ensureAbsoluteDirectory(projectRoot, 'Project root');
  const relativeRoot = path.relative(workspace, root).replace(/\\/g, '/') || '.';
  if (relativeRoot !== '.' && (relativeRoot === '..' || relativeRoot.startsWith('../') || path.isAbsolute(relativeRoot))) {
    fail('BAD_PATH', 'Registered Project root must be inside the selected workspace');
  }
  const manifest = loadProjectManifest(root);
  const { indexRoot, index } = readWorkspaceIndex(workspace, { create: true });
  const targetCategory = manifest.status === 'archived' ? 'archived' : 'active';
  const targetPath = routePath(indexRoot, index, targetCategory, manifest.id);
  const otherPath = routePath(indexRoot, index, targetCategory === 'active' ? 'archived' : 'active', manifest.id);
  const existing = [targetPath, otherPath].find(file => fs.existsSync(file));
  if (existing) {
    const previous = readRouteStub(existing, manifest.id);
    const previousRoot = workspaceRootPath(workspace, previous);
    if (previousRoot !== root) fail('CONFLICT', `Project id ${manifest.id} is already registered to a different root`);
  }
  const route = { id: manifest.id, root: relativeRoot, entry: PROJECT_ENTRY };
  const encoded = jsonBytes(route);
  if (encoded.byteLength > DEFAULT_ROUTE_BUDGET_BYTES) fail('BUDGET_EXCEEDED', 'Project route stub exceeds route budget');
  const destinationOldBytes = optionalRegularFileBytes(targetPath, DEFAULT_ROUTE_BUDGET_BYTES, 'Destination route');
  const sourceOldBytes = optionalRegularFileBytes(otherPath, DEFAULT_ROUTE_BUDGET_BYTES, 'Source route');
  const transaction = createWorkspaceRouteTransaction({
    workspace,
    projectId: manifest.id,
    category: targetCategory,
    sourceCategory: targetCategory === 'active' ? 'archived' : 'active',
    destinationPath: targetPath,
    sourcePath: otherPath,
    destinationOldBytes,
    destinationNewBytes: encoded,
    sourceOldBytes,
  });
  commitWorkspaceRouteTransaction(transaction);
  return { ok: true, project: manifest, route, category: targetCategory, index: path.relative(workspace, path.join(indexRoot, WORKSPACE_INDEX.split('/').at(-1))).replace(/\\/g, '/') };
}

export function unregisterWorkspaceProject(workspaceRoot, projectId) {
  const { root, indexRoot, index } = readWorkspaceIndex(workspaceRoot);
  const found = findWorkspaceRoute(indexRoot, index, projectId);
  if (!found) fail('NOT_FOUND', `Project ${projectId} is not registered in this workspace`);
  const route = readRouteStub(found.file, projectId);
  // Collect every route file that resolves to this id, including a stale
  // counterpart category or a stray shard, so unregister cannot half-remove.
  const targets = [];
  for (const category of ['active', 'archived']) {
    const routeRoot = path.join(indexRoot, ...(category === 'archived' ? index.archivedRoot : index.activeRoot).split('/'));
    if (!fs.existsSync(routeRoot)) continue;
    for (const shard of fs.readdirSync(routeRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      const candidate = path.join(routeRoot, shard.name, `${projectId}.json`);
      if (!fs.existsSync(candidate)) continue;
      readRouteStub(candidate, projectId);
      targets.push({ file: candidate, bytes: readBoundedFile(candidate, DEFAULT_ROUTE_BUDGET_BYTES, `Workspace route exceeds ${DEFAULT_ROUTE_BUDGET_BYTES} bytes: ${path.basename(candidate)}`) });
    }
  }
  if (!targets.length) fail('NOT_FOUND', `Project ${projectId} route file is missing`);
  const removed = [];
  try {
    for (const target of targets) {
      const current = readBoundedFile(target.file, DEFAULT_ROUTE_BUDGET_BYTES, `Workspace route exceeds ${DEFAULT_ROUTE_BUDGET_BYTES} bytes: ${path.basename(target.file)}`);
      if (!current.equals(target.bytes)) fail('INVALID_TRANSACTION', `Workspace route changed during unregister: ${path.basename(target.file)}`);
      fs.rmSync(target.file, { force: true });
      removed.push(target);
    }
  } catch (error) {
    for (const target of removed) {
      try { fs.writeFileSync(target.file, target.bytes); } catch { /* preserve the original error */ }
    }
    throw error;
  }
  return { ok: true, projectId, root: workspaceRootPath(root, route), removed: true };
}

function enumerateRouteIds(indexRoot, index, includeArchived) {
  const categories = includeArchived ? ['active', 'archived'] : ['active'];
  const ids = new Set();
  for (const category of categories) {
    const routeRoot = path.join(indexRoot, ...(category === 'archived' ? index.archivedRoot : index.activeRoot).split('/'));
    if (!fs.existsSync(routeRoot)) continue;
    for (const shard of fs.readdirSync(routeRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      const shardRoot = path.join(routeRoot, shard.name);
      for (const entry of fs.readdirSync(shardRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        ids.add(entry.name.slice(0, -5));
      }
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function serializedPageBytes(payload) {
  if (!Object.hasOwn(payload, 'bytes')) payload.bytes = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const measured = Buffer.byteLength(JSON.stringify(payload));
    if (payload.bytes === measured) return measured;
    payload.bytes = measured;
  }
  fail('INVALID_PAGE', 'Serialized page byte count did not converge');
}

function encodePage(payload, budgetBytes) {
  const bytes = serializedPageBytes(payload);
  if (bytes > budgetBytes) fail('BUDGET_EXCEEDED', `Result exceeds ${budgetBytes} byte route budget`);
  return payload;
}

export function listLocalProject(projectRoot, options = {}) {
  const manifest = loadProjectManifest(projectRoot);
  const includeArchived = options.includeArchived === true;
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number.parseInt(options.limit, 10) || 20));
  const budget = Math.max(512, Math.min(MAX_ROUTE_BUDGET_BYTES, Number.parseInt(options.budgetBytes, 10) || DEFAULT_ROUTE_BUDGET_BYTES));
  const available = manifest.status !== 'archived' || includeArchived;
  const projects = available && (!options.cursor || manifest.id.localeCompare(String(options.cursor)) > 0) ? [{ id: manifest.id, root: '.', entry: PROJECT_ENTRY }] : [];
  const count = Math.min(limit, projects.length);
  return encodePage({ schemaVersion: 1, generated: true, projects: projects.slice(0, count), nextCursor: projects.length > count && count ? projects[count - 1].id : null, truncated: projects.length > count, bytes: 0 }, budget);
}

export function listWorkspaceProjects(workspaceRoot, {
  includeArchived = false,
  limit = 20,
  cursor = null,
  budgetBytes = DEFAULT_ROUTE_BUDGET_BYTES,
} = {}) {
  const { root, indexRoot, index } = readWorkspaceIndex(workspaceRoot);
  const requestedLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number.parseInt(limit, 10) || 20));
  const budget = Math.max(512, Math.min(MAX_ROUTE_BUDGET_BYTES, Number.parseInt(budgetBytes, 10) || DEFAULT_ROUTE_BUDGET_BYTES));
  const ids = enumerateRouteIds(indexRoot, index, includeArchived).filter(id => !cursor || id.localeCompare(cursor) > 0);
  let count = Math.min(requestedLimit, ids.length);
  let projects = [];
  let invalid = [];
  let payload;
  while (count >= 0) {
    invalid = [];
    projects = [];
    for (const id of ids.slice(0, count)) {
      const found = findWorkspaceRoute(indexRoot, index, id);
      if (!found) { invalid.push({ id, reason: 'route disappeared during listing' }); continue; }
      try {
        const route = readRouteStub(found.file, id);
        workspaceRootPath(root, route);
        projects.push(route);
      } catch (error) {
        invalid.push({ id, reason: String(error.message || error).slice(0, 200) });
      }
    }
    payload = {
      schemaVersion: 1,
      generated: true,
      projects,
      invalid,
      nextCursor: ids.length > count && count > 0 ? ids[count - 1] : null,
      truncated: ids.length > count,
      bytes: 0,
    };
    if (serializedPageBytes(payload) <= budget) break;
    count -= 1;
  }
  if (count < 1 && ids.length > 0 && !projects.length && !invalid.length) fail('BUDGET_EXCEEDED', `No Project route fits within ${budget} bytes`);
  return encodePage(payload, budget);
}

export function resolveProject({ projectId = null, projectRoot = process.cwd(), workspaceRoot = null, includeArchived = false } = {}) {
  if (workspaceRoot) {
    const { root: workspace, indexRoot, index } = readWorkspaceIndex(workspaceRoot);
    if (!projectId) fail('BAD_REQUEST', 'projectId is required when routing through a workspace index');
    const found = findWorkspaceRoute(indexRoot, index, projectId);
    if (!found) fail('NOT_FOUND', `Project ${projectId} is not registered`);
    if (found.category === 'archived' && !includeArchived) fail('ARCHIVED', `Project ${projectId} is archived; request includeArchived to open it`);
    const route = readRouteStub(found.file, projectId);
    const root = workspaceRootPath(workspace, route);
    const manifest = loadProjectManifest(root);
    if (manifest.id !== projectId) fail('INVALID_ROUTE', `Project entry id does not match workspace route ${projectId}`);
    if ((found.category === 'archived') !== (manifest.status === 'archived')) fail('INVALID_ROUTE', `Project archive route is inconsistent for ${projectId}`);
    return { projectRoot: root, project: manifest, route, workspaceRoot: workspace, routeCategory: found.category };
  }
  const root = ensureAbsoluteDirectory(projectRoot, 'Project root');
  const manifest = loadProjectManifest(root);
  if (projectId && manifest.id !== projectId) fail('NOT_FOUND', `Project ${projectId} does not match this project root (${manifest.id})`);
  if (manifest.status === 'archived' && !includeArchived) fail('ARCHIVED', `Project ${manifest.id} is archived; request includeArchived to open it`);
  return { projectRoot: root, project: manifest, route: null, workspaceRoot: null, routeCategory: null };
}

export function showProject(options = {}) {
  const resolved = resolveProject(options);
  const result = {
    project: resolved.project,
    projectRoot: resolved.projectRoot,
    route: resolved.route,
    generated: true,
    truncated: false,
    nextCursor: null,
    bytes: 0,
  };
  const budget = Math.max(512, Math.min(MAX_ROUTE_BUDGET_BYTES, Number.parseInt(options.budgetBytes, 10) || DEFAULT_ROUTE_BUDGET_BYTES));
  return encodePage(result, budget);
}

function readTaskRollup(projectRoot) {
  const indexPath = resolveInside(projectRoot, 'Harness/tasks/INDEX.json', 'Task route index');
  if (!fs.existsSync(indexPath)) {
    return { generated: true, source: 'Harness/tasks/INDEX.json', total: 0, statusCounts: { active: 0, blocked: 0, closed: 0 } };
  }
  const index = readJsonFile(indexPath, MAX_TASK_INDEX_BYTES);
  if (!Array.isArray(index.tasks)) fail('INVALID_TASK_INDEX', 'Task route index must contain a tasks array');
  const statusCounts = { active: 0, blocked: 0, closed: 0 };
  for (const task of index.tasks) {
    if (Object.hasOwn(statusCounts, task.status)) statusCounts[task.status] += 1;
  }
  return {
    generated: true,
    source: 'Harness/tasks/INDEX.json',
    total: index.tasks.length,
    statusCounts,
  };
}

export function summarizeProject(options = {}) {
  const resolved = resolveProject(options);
  const result = {
    schemaVersion: 1,
    projectId: resolved.project.id,
    project: {
      id: resolved.project.id,
      name: resolved.project.name,
      status: resolved.project.status,
      stage: resolved.project.stage,
      revision: resolved.project.revision,
    },
    generated: true,
    sourceOfTruth: 'Harness/project/PROJECT.json + Harness/tasks/INDEX.json',
    taskRollup: readTaskRollup(resolved.projectRoot),
    truncated: false,
    nextCursor: null,
    bytes: 0,
  };
  const budget = Math.max(512, Math.min(MAX_ROUTE_BUDGET_BYTES, Number.parseInt(options.budgetBytes, 10) || DEFAULT_ROUTE_BUDGET_BYTES));
  return encodePage(result, budget);
}

function relocateWorkspaceRoute(workspaceRoot, currentManifest, updatedManifest, projectRoot, fromCategory, toCategory) {
  const { root, indexRoot, index } = readWorkspaceIndex(workspaceRoot);
  const source = routePath(indexRoot, index, fromCategory, updatedManifest.id);
  const destination = routePath(indexRoot, index, toCategory, updatedManifest.id);
  const relativeRoot = path.relative(root, projectRoot).replace(/\\/g, '/') || '.';
  if (relativeRoot !== '.' && (relativeRoot === '..' || relativeRoot.startsWith('../') || path.isAbsolute(relativeRoot))) {
    fail('BAD_PATH', 'Project root is outside its workspace');
  }
  const route = { id: updatedManifest.id, root: relativeRoot, entry: PROJECT_ENTRY };
  for (const [label, candidate] of [['source', source], ['destination', destination]]) {
    if (!fs.existsSync(candidate)) continue;
    const existing = readRouteStub(candidate, updatedManifest.id);
    if (workspaceRootPath(root, existing) !== projectRoot) fail('CONFLICT', `Workspace Project ${label} route points to a different root`);
  }
  const oldManifestPath = resolveInside(projectRoot, PROJECT_ENTRY, 'Workspace Project manifest');
  const oldManifestBytes = regularFileBytes(oldManifestPath, PROJECT_ENTRY_MAX_BYTES, 'Workspace Project manifest');
  const newManifestBytes = jsonBytes(updatedManifest);
  const transaction = createWorkspaceRouteTransaction({
    workspace: root,
    projectId: updatedManifest.id,
    category: toCategory,
    sourceCategory: fromCategory,
    destinationPath: destination,
    sourcePath: source,
    destinationOldBytes: optionalRegularFileBytes(destination, DEFAULT_ROUTE_BUDGET_BYTES, 'Destination route'),
    destinationNewBytes: jsonBytes(route),
    sourceOldBytes: optionalRegularFileBytes(source, DEFAULT_ROUTE_BUDGET_BYTES, 'Source route'),
    projectRoot,
    oldManifestBytes,
    newManifestBytes,
    oldManifest: currentManifest,
    newManifest: updatedManifest,
  });
  commitWorkspaceRouteTransaction(transaction);
}

export function updateProject({ projectId = null, projectRoot = process.cwd(), workspaceRoot = null, includeArchived = false, expectedRevision = null, patch = {} } = {}) {
  const resolved = resolveProject({ projectId, projectRoot, workspaceRoot, includeArchived: true });
  const current = resolved.project;
  if (expectedRevision !== null && Number(expectedRevision) !== current.revision) {
    fail('REVISION_CONFLICT', `Project revision mismatch: expected ${expectedRevision}, current ${current.revision}`);
  }
  const allowed = ['name', 'status', 'stage'];
  const unsupported = Object.keys(patch).filter(key => !allowed.includes(key));
  if (unsupported.length) fail('BAD_REQUEST', `Project metadata may not update: ${unsupported.join(', ')}`);
  const updated = { ...current, ...patch, revision: current.revision + 1 };
  const errors = validateProjectManifest(updated);
  if (errors.length) fail('INVALID_PROJECT', errors.join('; '), { errors });
  const previousCategory = current.status === 'archived' ? 'archived' : 'active';
  const nextCategory = updated.status === 'archived' ? 'archived' : 'active';
  const manifestPath = resolveInside(resolved.projectRoot, PROJECT_ENTRY, 'Project entry');
  if (workspaceRoot && previousCategory !== nextCategory) {
    relocateWorkspaceRoute(workspaceRoot, current, updated, resolved.projectRoot, previousCategory, nextCategory);
  } else {
    atomicWriteJson(manifestPath, updated);
  }
  return { ok: true, project: updated, projectRoot: resolved.projectRoot, generated: false };
}

export function archiveProject(options = {}) {
  return updateProject({ ...options, patch: { status: 'archived' } });
}

export function restoreProject(options = {}) {
  return updateProject({ ...options, includeArchived: true, patch: { status: 'active' } });
}

function matchesFixedIndex(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length
    && actualKeys.every(key => Object.hasOwn(expected, key))
    && expectedKeys.every(key => Object.hasOwn(value, key) && value[key] === expected[key]);
}

function readDomainIndex(projectRoot, section) {
  if (section === 'progress') {
    const indexPath = resolveInside(projectRoot, 'Harness/project/progress/INDEX.json', 'Progress index');
    const index = readJsonFile(indexPath, DEFAULT_ROUTE_BUDGET_BYTES);
    if (!matchesFixedIndex(index, PROGRESS_INDEX)) fail('INVALID_INDEX', 'Progress index does not match schema v1');
    return index;
  }
  const config = DOMAIN_CONFIG[section];
  if (!config) fail('BAD_REQUEST', `Unknown Project section: ${section}`);
  const index = readJsonFile(resolveInside(projectRoot, `Harness/project/${config.indexPath}`, `${section} index`), DEFAULT_ROUTE_BUDGET_BYTES);
  const expected = DOMAIN_INDEXES[section];
  if (!matchesFixedIndex(index, expected)) fail('INVALID_INDEX', `${section} index does not match schema v1`);
  return index;
}

function normalizeSection(section) {
  const value = String(section || '').toLowerCase();
  if (value === 'milestone' || value === 'milestones') return 'plan';
  if (value === 'risk' || value === 'problem' || value === 'blocker' || value === 'question') return 'risks';
  if (value === 'decision') return 'decisions';
  if (value === 'history' || value === 'delivery' || value === 'learning') return 'progress';
  if (Object.hasOwn(DOMAIN_CONFIG, value) || value === 'progress' || value === 'charter') return value;
  fail('BAD_REQUEST', `Unknown Project section: ${section}`);
}

function recordRootFor(projectRoot, section) {
  const config = DOMAIN_CONFIG[section];
  const index = readDomainIndex(projectRoot, section);
  const relativeRoot = path.posix.join(config.dirname, index.recordsRoot);
  return resolveInside(path.join(projectRoot, 'Harness', 'project'), relativeRoot, `${section} records root`);
}

function recordFilePath(projectRoot, section, id) {
  const root = recordRootFor(projectRoot, section);
  return path.join(root, sha256(id).slice(0, 2), `${id}.json`);
}

function validateRecord(record, section) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('INVALID_RECORD', 'Project record must be a JSON object');
  if (record.schemaVersion !== 1 || record.section !== section) fail('INVALID_RECORD', 'Project record schemaVersion/section is invalid');
  if (typeof record.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(record.id)) fail('INVALID_RECORD', 'Project record id is invalid');
  if (typeof record.title !== 'string' || !record.title.trim() || record.title.length > 240) fail('INVALID_RECORD', 'Project record title is required and must be <= 240 characters');
  if (typeof record.content !== 'string' || Buffer.byteLength(record.content) > 4096) fail('INVALID_RECORD', 'Project record content must be <= 4096 bytes');
  const allowed = ['schemaVersion','id','section','kind','title','content','status','createdAt','source','taskIds','milestoneIds'];
  if (Object.keys(record).some(key => !allowed.includes(key))) fail('INVALID_RECORD', 'Project record has unsupported fields');
  for (const key of ['schemaVersion','id','section','kind','title','content','createdAt']) if (!Object.hasOwn(record, key)) fail('INVALID_RECORD', `Project record requires ${key}`);
  if (typeof record.kind !== 'string' || !record.kind.length || record.kind.length > 64) fail('INVALID_RECORD', 'Project record kind is invalid');
  if (record.status !== undefined && (typeof record.status !== 'string' || record.status.length > 64)) fail('INVALID_RECORD', 'Project record status is invalid');
  if (record.source !== undefined && (!record.source || typeof record.source !== 'object' || Array.isArray(record.source))) fail('INVALID_RECORD', 'Project record source must be an object');
  for (const key of ['taskIds','milestoneIds']) if (record[key] !== undefined && (!Array.isArray(record[key]) || record[key].some(id => typeof id !== 'string') || new Set(record[key]).size !== record[key].length)) fail('INVALID_RECORD', `${key} must be a unique string array`);
  if (typeof record.createdAt !== 'string' || Number.isNaN(Date.parse(record.createdAt)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(record.createdAt)) fail('INVALID_RECORD', 'Project record createdAt must be date-time');
  if (Buffer.byteLength(JSON.stringify(record)) > MAX_RECORD_BYTES) fail('BUDGET_EXCEEDED', `Project record exceeds ${MAX_RECORD_BYTES} bytes`);
}

function normalizeTaskIds(value) {
  if (value === undefined || value === null || value === '') return [];
  const values = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(values.map(item => String(item).trim()).filter(Boolean))];
}

function recordFromInput(section, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_RECORD', 'Project record input must be an object');
  const unsupported = Object.keys(input).filter(key => !RECORD_INPUT_FIELDS.includes(key));
  if (unsupported.length) fail('INVALID_RECORD', `Project record has unsupported fields: ${unsupported.join(', ')}`);
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) fail('INVALID_RECORD', 'Project record schemaVersion must be 1');
  if (input.section !== undefined && input.section !== section) fail('INVALID_RECORD', 'Project record section does not match the selected section');
  for (const key of ['id','kind','title','content','text','status','createdAt']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') fail('INVALID_RECORD', `Project record ${key} must be a string`);
  }
  for (const key of ['id','kind','createdAt']) {
    if (input[key] !== undefined && !input[key].trim()) fail('INVALID_RECORD', `Project record ${key} must not be empty`);
  }
  for (const key of ['taskIds','milestoneIds']) {
    if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key].some(id => typeof id !== 'string') || new Set(input[key]).size !== input[key].length)) fail('INVALID_RECORD', `${key} must be a unique string array`);
  }
  if (input.tasks !== undefined && !(typeof input.tasks === 'string' || (Array.isArray(input.tasks) && input.tasks.every(id => typeof id === 'string') && new Set(input.tasks).size === input.tasks.length))) fail('INVALID_RECORD', 'tasks must be a string or unique string array');
  const title = (input.title || '').trim();
  const content = (input.content ?? input.text ?? '').trim();
  const id = input.id || `record-${randomUUID()}`;
  const record = {
    schemaVersion: 1,
    id,
    section,
    kind: input.kind || (section === 'plan' ? 'milestone' : section === 'risks' ? 'risk' : section === 'decisions' ? 'decision' : section === 'progress' ? 'delivery' : 'reference'),
    title,
    content,
    createdAt: input.createdAt || new Date().toISOString(),
    taskIds: normalizeTaskIds(input.taskIds ?? input.tasks),
  };
  if (input.status !== undefined) record.status = input.status;
  if (input.source !== undefined) record.source = input.source;
  if (input.milestoneIds !== undefined) record.milestoneIds = input.milestoneIds;
  validateRecord(record, section);
  return record;
}

function progressSegmentFiles(projectRoot) {
  const root = resolveInside(projectRoot, 'Harness/project/progress/segments', 'Progress segments');
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(absolute);
    }
  };
  visit(root);
  return files.sort((a, b) => a.localeCompare(b));
}

function progressSegmentRelative(progressRoot, file) {
  return path.relative(progressRoot, file).replace(/\\/g, '/');
}

function encodeProgressCursor(projectId, segment, ordinal) {
  const payload = { v: 1, projectId, section: 'progress', segment, ordinal };
  return `p1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

function decodeProgressCursor(cursor, projectId, files, progressRoot) {
  if (typeof cursor !== 'string' || cursor.length > 1024) fail('BAD_REQUEST', 'Progress cursor is invalid');
  const match = cursor.match(/^p1\.([A-Za-z0-9_-]+)$/);
  if (!match) fail('BAD_REQUEST', 'Progress cursor version is unsupported');
  let payload;
  try { payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); }
  catch { fail('BAD_REQUEST', 'Progress cursor is invalid'); }
  const expectedKeys = ['ordinal', 'projectId', 'section', 'segment', 'v'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(expectedKeys)) fail('BAD_REQUEST', 'Progress cursor payload is invalid');
  if (payload.v !== 1 || payload.projectId !== projectId || payload.section !== 'progress' || !Number.isInteger(payload.ordinal) || payload.ordinal < 0 || typeof payload.segment !== 'string') fail('BAD_REQUEST', 'Progress cursor does not match this Project section');
  const index = files.findIndex(file => progressSegmentRelative(progressRoot, file) === payload.segment);
  if (index < 0) fail('BAD_REQUEST', 'Progress cursor segment no longer exists');
  return { fileIndex: index, ordinal: payload.ordinal };
}

function makeSectionPage(projectId, section, items, nextCursor) {
  return {
    schemaVersion: 1,
    projectId,
    section,
    sourceOfTruth: `Harness/project/${section}/`,
    items,
    nextCursor,
    truncated: Boolean(nextCursor),
    generated: false,
    bytes: 0,
  };
}

function readProgressPage(projectRoot, projectId, files, cursor, limit, budgetBytes) {
  const progressRoot = resolveInside(projectRoot, 'Harness/project/progress/segments', 'Progress segments');
  const start = cursor ? decodeProgressCursor(cursor, projectId, files, progressRoot) : { fileIndex: 0, ordinal: 0 };
  const records = [];
  const nextCursors = [];
  for (let fileIndex = start.fileIndex; fileIndex < files.length; fileIndex += 1) {
    const bytes = readBoundedFile(files[fileIndex], MAX_PROGRESS_SEGMENT_BYTES);
    const lines = bytes.toString('utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length > MAX_PROGRESS_ITEMS_PER_SEGMENT) fail('BUDGET_EXCEEDED', `Progress segment exceeds ${MAX_PROGRESS_ITEMS_PER_SEGMENT} records: ${files[fileIndex]}`);
    const firstOrdinal = fileIndex === start.fileIndex ? start.ordinal : 0;
    if (firstOrdinal > lines.length) fail('BAD_REQUEST', 'Progress cursor ordinal is past the segment end');
    for (let ordinal = firstOrdinal; ordinal < lines.length; ordinal += 1) {
      const record = parseProgressRecord(lines[ordinal], files[fileIndex]);
      validateRecord(record, 'progress');
      const nextPosition = ordinal + 1 < lines.length
        ? { segment: progressSegmentRelative(progressRoot, files[fileIndex]), ordinal: ordinal + 1 }
        : fileIndex + 1 < files.length
          ? { segment: progressSegmentRelative(progressRoot, files[fileIndex + 1]), ordinal: 0 }
          : null;
      const nextCursor = nextPosition ? encodeProgressCursor(projectId, nextPosition.segment, nextPosition.ordinal) : null;
      const candidate = makeSectionPage(projectId, 'progress', [...records, record], nextCursor);
      if (serializedPageBytes(candidate) > budgetBytes) {
        if (records.length === 0) fail('BUDGET_EXCEEDED', `One progress record exceeds the ${budgetBytes} byte page budget`);
        return { records, nextCursors, hasMore: true };
      }
      records.push(record);
      nextCursors.push(nextCursor);
      if (records.length === limit) return { records, nextCursors, hasMore: Boolean(nextCursor) };
    }
  }
  return { records, nextCursors, hasMore: false };
}

function domainRecordFiles(projectRoot, section) {
  const root = recordRootFor(projectRoot, section);
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(absolute);
    }
  };
  visit(root);
  return files.sort((a, b) => a.localeCompare(b));
}

export function readProjectSection(options = {}) {
  const resolved = resolveProject(options);
  const section = normalizeSection(options.section);
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number.parseInt(options.limit, 10) || 20));
  const budget = Math.max(512, Math.min(MAX_ROUTE_BUDGET_BYTES, Number.parseInt(options.budgetBytes, 10) || DEFAULT_ROUTE_BUDGET_BYTES));
  if (section === 'charter') {
    const charterPath = resolveInside(resolved.projectRoot, 'Harness/project/charter.json', 'Project charter');
    const charter = readJsonFile(charterPath, DEFAULT_ROUTE_BUDGET_BYTES);
    validateCharterValue(charter);
    const response = { schemaVersion: 1, projectId: resolved.project.id, section, sourceOfTruth: 'Harness/project/charter.json', item: charter, items: [], nextCursor: null, truncated: false, generated: false, bytes: 0 };
    return encodePage(response, budget);
  }
  readDomainIndex(resolved.projectRoot, section);
  const cursor = options.cursor ? String(options.cursor) : null;
  if (section !== 'progress' && cursor?.startsWith('p1.')) fail('BAD_REQUEST', 'Progress cursor cannot be used for another Project section');
  if (section === 'progress') {
    const files = progressSegmentFiles(resolved.projectRoot);
    const page = readProgressPage(resolved.projectRoot, resolved.project.id, files, cursor, limit, budget);
    const nextCursor = page.records.length ? page.nextCursors.at(-1) : null;
    const response = makeSectionPage(resolved.project.id, section, page.records, nextCursor);
    return encodePage(response, budget);
  }
  const files = domainRecordFiles(resolved.projectRoot, section);
  const eligibleFiles = files.filter(file => !cursor || path.basename(file, '.json').localeCompare(cursor) > 0).sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  const items = [];
  let response = makeSectionPage(resolved.project.id, section, items, null);
  for (let index = 0; index < eligibleFiles.length && items.length < limit; index += 1) {
    const record = readJsonFile(eligibleFiles[index], MAX_RECORD_BYTES);
    validateRecord(record, section);
    const hasMore = index + 1 < eligibleFiles.length;
    const candidate = makeSectionPage(resolved.project.id, section, [...items, record], hasMore ? path.basename(eligibleFiles[index], '.json') : null);
    if (serializedPageBytes(candidate) > budget) {
      if (items.length === 0) fail('BUDGET_EXCEEDED', `One ${section} record exceeds the ${budget} byte page budget`);
      break;
    }
    items.push(record);
    response = candidate;
  }
  return encodePage(response, budget);
}

export function getProjectRecord(options = {}) {
  const resolved = resolveProject(options);
  const section = normalizeSection(options.section);
  if (section === 'charter') return readProjectSection({ ...options, projectRoot: resolved.projectRoot, workspaceRoot: null });
  const id = String(options.recordId || options.id || '');
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(id)) fail('BAD_REQUEST', 'A route-safe recordId is required');
  const file = section === 'progress'
    ? null
    : recordFilePath(resolved.projectRoot, section, id);
  if (file) {
    const record = readJsonFile(file, MAX_RECORD_BYTES);
    validateRecord(record, section);
    return { projectId: resolved.project.id, section, record, generated: false };
  }
  const records = [];
  for (const segment of progressSegmentFiles(resolved.projectRoot)) {
    const bytes = readBoundedFile(segment, MAX_PROGRESS_SEGMENT_BYTES);
    const lines = bytes.toString('utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length > MAX_PROGRESS_ITEMS_PER_SEGMENT) fail('BUDGET_EXCEEDED', `Progress segment exceeds ${MAX_PROGRESS_ITEMS_PER_SEGMENT} records: ${segment}`);
    for (const line of lines) {
      const record = parseProgressRecord(line, segment);
      validateRecord(record, 'progress');
      if (record.id === id) records.push(record);
    }
  }
  if (!records.length) fail('NOT_FOUND', `Project record ${id} not found`);
  return { projectId: resolved.project.id, section, record: records[0], generated: false };
}

// A segment that cannot be read within its own cap is treated as full so a
// legacy oversized segment rotates instead of blocking every later write.
function readProgressSegmentBytes(filePath) {
  if (!fs.existsSync(filePath)) return Buffer.alloc(0);
  try {
    return readBoundedFile(filePath, MAX_PROGRESS_SEGMENT_BYTES);
  } catch {
    return null;
  }
}

function progressSegmentCount(bytes) {
  if (bytes === null) return MAX_PROGRESS_ITEMS_PER_SEGMENT;
  return bytes.toString('utf8').split(/\r?\n/).filter(Boolean).length;
}

function chooseProgressSegment(projectRoot, dateKey, lineBytes, draft = new Map()) {
  const root = path.join(projectRoot, 'Harness', 'project', 'progress', 'segments', dateKey.slice(0, 4), dateKey.slice(5, 7));
  fs.mkdirSync(root, { recursive: true });
  const files = fs.readdirSync(root).filter(name => /^\d{4}\.jsonl$/.test(name)).sort();
  const load = target => (draft.has(target) ? draft.get(target) : readProgressSegmentBytes(target));
  const fits = (bytes, count) => bytes !== null && bytes.byteLength + lineBytes.byteLength <= MAX_PROGRESS_SEGMENT_BYTES && count < MAX_PROGRESS_ITEMS_PER_SEGMENT;
  let target = files.length ? path.join(root, files.at(-1)) : path.join(root, '0001.jsonl');
  let current = load(target);
  if (!fits(current, progressSegmentCount(current))) {
    const next = String((files.length ? Number(files.at(-1).slice(0, 4)) : 0) + 1).padStart(4, '0');
    target = path.join(root, `${next}.jsonl`);
    current = load(target);
  }
  return { target, current };
}

function progressRecordExists(projectRoot, id) {
  for (const file of progressSegmentFiles(projectRoot)) {
    const bytes = readProgressSegmentBytes(file);
    if (bytes === null) continue;
    for (const line of bytes.toString('utf8').split(/\r?\n/).filter(Boolean)) {
      const record = parseProgressRecord(line, file);
      if (record && record.id === id) return true;
    }
  }
  return false;
}

// The single write implementation. `fixedTarget` lets the import path journal an
// exact destination before mutating it, so a crash cannot leave an unwritten
// entry in the recovery log.
function writeProjectRecordCore({ projectRoot = process.cwd(), projectId = null, workspaceRoot = null, section, record = {}, fixedTarget = null } = {}) {
  const resolved = resolveProject({ projectId, projectRoot, workspaceRoot });
  const normalized = normalizeSection(section || record.section);
  if (normalized === 'charter') fail('BAD_REQUEST', 'Use updateProjectCharter to update charter fields');
  const value = recordFromInput(normalized, record);
  const target = fixedTarget
    ? resolveInside(resolved.projectRoot, path.relative(resolved.projectRoot, fixedTarget).replace(/\\/g, '/'), 'Project record target')
    : projectRecordTarget(resolved.projectRoot, normalized, value);
  const relative = path.relative(resolved.projectRoot, target).replace(/\\/g, '/');
  if (normalized === 'progress') {
    const line = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
    if (progressRecordExists(resolved.projectRoot, value.id)) fail('CONFLICT', `Progress record already exists: ${value.id}`);
    const { target: segment, current } = fixedTarget
      ? { target, current: readProgressSegmentBytes(target) }
      : chooseProgressSegment(resolved.projectRoot, value.createdAt.slice(0, 10), line);
    if (current === null || current.byteLength + line.byteLength > MAX_PROGRESS_SEGMENT_BYTES || progressSegmentCount(current) >= MAX_PROGRESS_ITEMS_PER_SEGMENT) fail('BUDGET_EXCEEDED', 'Progress segment is full');
    atomicWriteFile(segment, Buffer.concat([current, line]));
    return { ok: true, projectId: resolved.project.id, section: normalized, record: value, path: path.relative(resolved.projectRoot, segment).replace(/\\/g, '/') };
  }
  if (fs.existsSync(target)) fail('CONFLICT', `Project record already exists: ${value.id}`);
  atomicWriteJson(target, value);
  return { ok: true, projectId: resolved.project.id, section: normalized, record: value, path: relative };
}

export function writeProjectRecord(options = {}) {
  return writeProjectRecordCore(options);
}

export function writeProjectRecordAt(options = {}) {
  if (!options.target) fail('BAD_REQUEST', 'writeProjectRecordAt requires an explicit target');
  return writeProjectRecordCore(options);
}

export function projectRecordTarget(projectRoot, section, record) {
  const normalized = normalizeSection(section);
  if (normalized === 'progress') {
    const dateKey = String(record.createdAt || new Date().toISOString()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) fail('INVALID_RECORD', 'Progress createdAt must be a valid YYYY-MM-DD date');
    const line = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
    if (line.byteLength > MAX_PROGRESS_SEGMENT_BYTES) fail('BUDGET_EXCEEDED', 'Progress record is larger than one segment');
    return chooseProgressSegment(projectRoot, dateKey, line).target;
  }
  if (!DOMAIN_CONFIG[normalized]) fail('BAD_REQUEST', `Records cannot be added to ${normalized}`);
  return recordFilePath(projectRoot, normalized, record.id);
}

export function updateProjectCharter({ projectRoot = process.cwd(), projectId = null, workspaceRoot = null, expectedRevision = null, patch = {} } = {}) {
  const resolved = resolveProject({ projectId, projectRoot, workspaceRoot });
  const allowed = ['goal', 'scope', 'nonGoals'];
  const unsupported = Object.keys(patch).filter(key => !allowed.includes(key));
  if (unsupported.length) fail('BAD_REQUEST', `Unsupported charter fields: ${unsupported.join(', ')}`);
  const file = resolveInside(resolved.projectRoot, 'Harness/project/charter.json', 'Project charter');
  const charterBytes = regularFileBytes(file, DEFAULT_ROUTE_BUDGET_BYTES, 'Project charter');
  const charter = readJsonFile(file, DEFAULT_ROUTE_BUDGET_BYTES);
  if (expectedRevision !== null && Number(expectedRevision) !== resolved.project.revision) fail('REVISION_CONFLICT', 'Project revision mismatch');
  const updated = { ...charter, ...patch, schemaVersion: 1 };
  validateCharterValue(updated);
  const manifestPath = resolveInside(resolved.projectRoot, PROJECT_ENTRY, 'Project entry');
  const manifestBytes = regularFileBytes(manifestPath, PROJECT_ENTRY_MAX_BYTES, 'Project entry');
  const project = { ...resolved.project, revision: resolved.project.revision + 1 };
  const errors = validateProjectManifest(project);
  if (errors.length) fail('INVALID_PROJECT', errors.join('; '), { errors });
  const transaction = createProjectCharterTransaction(
    resolved.projectRoot,
    resolved.project,
    project,
    manifestBytes,
    charterBytes,
    jsonBytes(updated),
  );
  commitProjectCharterTransaction(transaction);
  return { ok: true, project, charter: updated };
}

function walkJsonFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.json')) result.push(absolute);
    }
  };
  visit(root);
  return result.sort((a, b) => a.localeCompare(b));
}

function encodeSearchCursor(projectId, query, sections, position) {
  const payload = { v: 1, projectId, query, sections, position };
  return `s1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

function decodeSearchCursor(cursor, projectId, query, sections) {
  if (typeof cursor !== 'string' || cursor.length > 2048) fail('BAD_REQUEST', 'Search cursor is invalid');
  const match = cursor.match(/^s1\.([A-Za-z0-9_-]+)$/);
  if (!match) fail('BAD_REQUEST', 'Search cursor version is unsupported');
  let payload;
  try { payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); }
  catch { fail('BAD_REQUEST', 'Search cursor is invalid'); }
  const keys = ['position', 'projectId', 'query', 'sections', 'v'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(keys)) fail('BAD_REQUEST', 'Search cursor payload is invalid');
  if (payload.v !== 1 || payload.projectId !== projectId || payload.query !== query || JSON.stringify(payload.sections) !== JSON.stringify(sections)) fail('BAD_REQUEST', 'Search cursor does not match this Project query');
  const position = payload.position;
  const positionKeys = ['file', 'ordinal', 'section'];
  if (!position || typeof position !== 'object' || Array.isArray(position) || JSON.stringify(Object.keys(position).sort()) !== JSON.stringify(positionKeys)) fail('BAD_REQUEST', 'Search cursor position is invalid');
  if (!sections.includes(position.section) || typeof position.file !== 'string' || position.file.includes('\0') || path.posix.isAbsolute(position.file) || position.file.split('/').some(part => part === '.' || part === '..') || !Number.isInteger(position.ordinal) || position.ordinal < 0) fail('BAD_REQUEST', 'Search cursor position is invalid');
  const expectedPrefix = position.section === 'progress' ? 'Harness/project/progress/segments/' : `Harness/project/${position.section}/`;
  if (!position.file.startsWith(expectedPrefix) || (position.section !== 'progress' && position.ordinal !== 0)) fail('BAD_REQUEST', 'Search cursor position is outside the selected Project section');
  return position;
}

function searchPositionAfter(candidate, cursorPosition, sections) {
  if (!cursorPosition) return true;
  const candidateSection = sections.indexOf(candidate.section);
  const cursorSection = sections.indexOf(cursorPosition.section);
  if (candidateSection !== cursorSection) return candidateSection > cursorSection;
  const fileOrder = candidate.file.localeCompare(cursorPosition.file);
  if (fileOrder !== 0) return fileOrder > 0;
  return candidate.ordinal > cursorPosition.ordinal;
}

function searchHasCandidateAfter(sectionData, sectionIndex, fileIndex, ordinal, lineCount) {
  const current = sectionData[sectionIndex];
  if (current.section === 'progress' && ordinal + 1 < lineCount) return true;
  if (fileIndex + 1 < current.files.length) return true;
  return sectionData.slice(sectionIndex + 1).some(entry => entry.files.length > 0);
}

function makeSearchPage(projectId, query, items, scanned, nextCursor) {
  return { schemaVersion: 1, projectId, query, items, generated: true, scanned, nextCursor, truncated: Boolean(nextCursor), bytes: 0 };
}

export function searchProjectRecords({ projectId = null, projectRoot = process.cwd(), workspaceRoot = null, section = null, query = '', limit = 20, cursor = null, budgetBytes = DEFAULT_ROUTE_BUDGET_BYTES, maxScanRecords = MAX_SEARCH_SCAN_RECORDS } = {}) {
  const resolved = resolveProject({ projectId, projectRoot, workspaceRoot });
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) fail('BAD_REQUEST', 'A non-empty query is required');
  if (Buffer.byteLength(needle) > 256) fail('BAD_REQUEST', 'Search query must not exceed 256 bytes');
  const sections = section ? [normalizeSection(section)] : ['plan', 'risks', 'decisions', 'progress', 'evidence'];
  const positionAfterCursor = cursor ? decodeSearchCursor(cursor, resolved.project.id, needle, sections) : null;
  const scanRequested = Number.parseInt(maxScanRecords, 10);
  const scanLimit = Number.isInteger(scanRequested) ? Math.max(1, Math.min(MAX_SEARCH_SCAN_RECORDS, scanRequested)) : MAX_SEARCH_SCAN_RECORDS;
  const max = Math.max(1, Math.min(MAX_PAGE_SIZE, Number.parseInt(limit, 10) || 20));
  const budget = Math.max(512, Math.min(MAX_ROUTE_BUDGET_BYTES, Number.parseInt(budgetBytes, 10) || DEFAULT_ROUTE_BUDGET_BYTES));
  const sectionData = sections.map(current => {
    if (current === 'charter') return { section: current, files: [] };
    readDomainIndex(resolved.projectRoot, current);
    const files = current === 'progress'
      ? progressSegmentFiles(resolved.projectRoot)
      : domainRecordFiles(resolved.projectRoot, current);
    return { section: current, files };
  });
  const sectionIndexes = new Map(sections.map((name, index) => [name, index]));
  const items = [];
  let scanned = 0;
  let lastScannedPosition = null;
  let lastResultPosition = null;
  let lastResultHasMore = false;
  let stopState = null;

  const inspectRecord = (record, position, sectionIndex, fileIndex, lineCount, ordinal) => {
    validateRecord(record, position.section);
    scanned += 1;
    lastScannedPosition = position;
    const hasMoreAfter = searchHasCandidateAfter(sectionData, sectionIndex, fileIndex, ordinal, lineCount);
    if (`${record.title || ''}\n${record.content || ''}`.toLocaleLowerCase().includes(needle)) {
      const nextCursor = hasMoreAfter ? encodeSearchCursor(resolved.project.id, needle, sections, position) : null;
      const candidate = makeSearchPage(resolved.project.id, needle, [...items, record], scanLimit, nextCursor);
      if (serializedPageBytes(candidate) > budget) {
        if (items.length === 0) fail('BUDGET_EXCEEDED', `Search result exceeds ${budget} byte budget`);
        stopState = { position: lastResultPosition, hasMore: true, reason: 'budget' };
        return false;
      }
      items.push(record);
      lastResultPosition = position;
      lastResultHasMore = hasMoreAfter;
      if (items.length >= max) {
        stopState = { position: hasMoreAfter ? position : null, hasMore: hasMoreAfter, reason: 'limit' };
        return false;
      }
    }
    if (scanned >= scanLimit) {
      stopState = { position: hasMoreAfter ? position : null, hasMore: hasMoreAfter, reason: 'scan' };
      return false;
    }
    return true;
  };

  for (let sectionIndex = 0; sectionIndex < sectionData.length && !stopState; sectionIndex += 1) {
    const current = sectionData[sectionIndex];
    const cursorSectionIndex = positionAfterCursor ? sectionIndexes.get(positionAfterCursor.section) : -1;
    if (positionAfterCursor && sectionIndex < cursorSectionIndex) continue;
    for (let fileIndex = 0; fileIndex < current.files.length && !stopState; fileIndex += 1) {
      const file = current.files[fileIndex];
      const fileKey = path.relative(resolved.projectRoot, file).replace(/\\/g, '/');
      if (current.section === 'progress') {
        let firstOrdinal = 0;
        if (positionAfterCursor && sectionIndex === cursorSectionIndex) {
          const fileOrder = fileKey.localeCompare(positionAfterCursor.file);
          if (fileOrder < 0) continue;
          if (fileOrder === 0) firstOrdinal = positionAfterCursor.ordinal + 1;
        }
        const text = readBoundedFile(file, MAX_PROGRESS_SEGMENT_BYTES).toString('utf8');
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length > MAX_PROGRESS_ITEMS_PER_SEGMENT) fail('BUDGET_EXCEEDED', `Progress segment exceeds ${MAX_PROGRESS_ITEMS_PER_SEGMENT} records: ${file}`);
        for (let ordinal = firstOrdinal; ordinal < lines.length && !stopState; ordinal += 1) {
          const candidatePosition = { section: current.section, file: fileKey, ordinal };
          if (!searchPositionAfter(candidatePosition, positionAfterCursor, sections)) continue;
          const record = parseProgressRecord(lines[ordinal], file);
          const proceed = inspectRecord(record, candidatePosition, sectionIndex, fileIndex, lines.length, ordinal);
          if (!proceed) break;
        }
      } else {
        const candidatePosition = { section: current.section, file: fileKey, ordinal: 0 };
        if (!searchPositionAfter(candidatePosition, positionAfterCursor, sections)) continue;
        const record = readJsonFile(file, MAX_RECORD_BYTES);
        const proceed = inspectRecord(record, candidatePosition, sectionIndex, fileIndex, 1, 0);
        if (!proceed) break;
      }
    }
  }

  let continuation = stopState?.position || null;
  let hasMore = Boolean(stopState?.hasMore && continuation);
  let nextCursor = hasMore ? encodeSearchCursor(resolved.project.id, needle, sections, continuation) : null;
  let payload = makeSearchPage(resolved.project.id, needle, items, scanned, nextCursor);
  if (serializedPageBytes(payload) > budget && stopState?.reason === 'scan' && lastResultPosition) {
    continuation = lastResultPosition;
    hasMore = lastResultHasMore;
    nextCursor = hasMore ? encodeSearchCursor(resolved.project.id, needle, sections, continuation) : null;
    payload = makeSearchPage(resolved.project.id, needle, items, scanned, nextCursor);
  }
  return encodePage(payload, budget);
}

export function validateProjectTree(projectRoot, { includeWorkspace = false } = {}) {
  const root = ensureAbsoluteDirectory(projectRoot, 'Project root');
  const manifest = loadProjectManifest(root);
  const errors = [];
  try {
    validateCharterValue(readJsonFile(resolveInside(root, 'Harness/project/charter.json', 'Project charter'), DEFAULT_ROUTE_BUDGET_BYTES));
  } catch (error) {
    errors.push(`charter: ${error.message}`);
  }
  for (const [section, relativePath] of Object.entries(manifest.domains)) {
    try {
      const file = resolveInside(root, `Harness/project/${relativePath}`, `Project domain ${section}`);
      const stat = fs.statSync(file);
      if (!stat.isFile()) errors.push(`${relativePath} must be a file`);
      if (stat.size > DEFAULT_ROUTE_BUDGET_BYTES) errors.push(`${relativePath} exceeds 8 KiB`);
      const value = readJsonFile(file, DEFAULT_ROUTE_BUDGET_BYTES);
      if (value.schemaVersion !== 1) errors.push(`${relativePath} schemaVersion must be 1`);
      if (section === 'progress' && !matchesFixedIndex(value, PROGRESS_INDEX)) errors.push('progress index does not match schema v1');
      else if (Object.hasOwn(DOMAIN_INDEXES, section) && !matchesFixedIndex(value, DOMAIN_INDEXES[section])) errors.push(`${section} index does not match schema v1`);
    } catch (error) {
      errors.push(`${section}: ${error.message}`);
    }
  }
  const charterPath = resolveInside(root, 'Harness/project/charter.json', 'Project charter');
  for (const [section, config] of Object.entries(DOMAIN_CONFIG)) {
    try {
      for (const file of domainRecordFiles(root, section)) {
        try { validateRecord(readJsonFile(file, MAX_RECORD_BYTES), section); }
        catch (error) { errors.push(`${path.relative(root, file)}: ${error.message}`); }
      }
    } catch (error) {
      errors.push(`${section} record: ${error.message}`);
    }
  }
  for (const file of progressSegmentFiles(root)) {
    try {
      const lines = readBoundedFile(file, MAX_PROGRESS_SEGMENT_BYTES).toString('utf8').split(/\r?\n/).filter(Boolean);
      if (lines.length > MAX_PROGRESS_ITEMS_PER_SEGMENT) errors.push(`${path.relative(root, file)} exceeds ${MAX_PROGRESS_ITEMS_PER_SEGMENT} records`);
      for (const line of lines) validateRecord(JSON.parse(line), 'progress');
    } catch (error) {
      errors.push(`progress segment: ${error.message}`);
    }
  }
  let workspace = null;
  if (includeWorkspace) {
    try {
      const { root: workspaceRoot, indexRoot, index } = readWorkspaceIndex(includeWorkspace);
      const categories = ['active', 'archived'];
      for (const category of categories) {
        const routeRoot = path.join(indexRoot, ...(category === 'archived' ? index.archivedRoot : index.activeRoot).split('/'));
        if (!fs.existsSync(routeRoot)) continue;
        for (const shard of fs.readdirSync(routeRoot, { withFileTypes: true }).filter(item => item.isDirectory())) {
          for (const entry of fs.readdirSync(path.join(routeRoot, shard.name), { withFileTypes: true }).filter(item => item.isFile() && item.name.endsWith('.json'))) {
            try {
              const route = readRouteStub(path.join(routeRoot, shard.name, entry.name));
              const target = workspaceRootPath(workspaceRoot, route);
              const targetManifest = loadProjectManifest(target);
              if (targetManifest.id !== route.id || ((category === 'archived') !== (targetManifest.status === 'archived')) || entry.name !== `${route.id}.json`) errors.push(`workspace route reconciliation failed: ${entry.name}`);
              if (target === root && route.id !== manifest.id) errors.push('workspace route root/id does not match selected Project');
            } catch (error) { errors.push(`workspace route: ${error.message}`); }
          }
        }
      }
      workspace = { root: workspaceRoot };
    } catch (error) { errors.push(`workspace index: ${error.message}`); }
  }
  return { ok: errors.length === 0, projectId: manifest.id, projectRoot: root, schemaVersion: 1, errors, workspace: workspace ? { index: WORKSPACE_INDEX } : null };
}
