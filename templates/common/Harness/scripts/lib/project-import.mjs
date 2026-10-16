import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ProjectError,
  MAX_PROGRESS_SEGMENT_BYTES,
  MAX_RECORD_BYTES,
  atomicWriteFile,
  atomicWriteJson,
  loadProjectManifest,
  projectRecordTarget,
  resolveInside,
  resolveProject,
  sha256,
  writeProjectRecordAt,
} from './project-store.mjs';

const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_RECORDS = 100;
const MAX_TRANSACTION_BYTES = 64 * 1024;
const MAX_IMPORT_OUTPUT_BYTES = Math.max(MAX_RECORD_BYTES, MAX_PROGRESS_SEGMENT_BYTES);
const IMPORT_ROOT = 'Harness/project/imports';
const RECOGNIZED_SOURCE_STATUSES = new Set([
  'active', 'blocked', 'closed', 'completed', 'done', 'open', 'resolved', 'planned', 'todo', 'in-progress', 'needs-review',
]);

function fail(code, message, details) {
  throw new ProjectError(code, message, details);
}

function readUnreadableSafe(filePath, maxBytes) {
  try {
    return readBoundedFile(filePath, maxBytes, `Stored file exceeds ${maxBytes} bytes: ${filePath}`);
  } catch {
    return null;
  }
}

function readBoundedFile(filePath, maxBytes, limitMessage) {
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
      if (totalBytes > maxBytes) fail('BUDGET_EXCEEDED', limitMessage);
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
  } finally {
    fs.closeSync(fd);
  }
  return Buffer.concat(chunks, totalBytes);
}

function normalizeSourcePath(projectRoot, source) {
  if (typeof source !== 'string' || source.trim() === '') fail('BAD_SOURCE', 'Each import source must be an explicit non-empty path');
  const raw = source.trim();
  let absolute;
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
    const rootReal = fs.realpathSync(projectRoot);
    const candidate = path.resolve(raw);
    const relative = path.relative(rootReal, candidate).replace(/\\/g, '/');
    if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) fail('BAD_SOURCE', 'Import source must be inside the selected project root');
    absolute = resolveInside(projectRoot, relative, 'Import source');
  } else {
    absolute = resolveInside(projectRoot, raw, 'Import source');
  }
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    fail('BAD_SOURCE', `Import source is not readable: ${source}`);
  }
  if (!stat.isFile()) fail('BAD_SOURCE', `Import source is not a file: ${source}`);
  const relativePath = path.relative(projectRoot, absolute).replace(/\\/g, '/');
  if (relativePath.startsWith(`${IMPORT_ROOT}/`)) fail('BAD_SOURCE', 'Import transaction files cannot be used as new migration sources');
  return { absolute, relative: relativePath, stat };
}

function sectionFromName(relativePath) {
  const basename = path.basename(relativePath).toLowerCase();
  if (/progress|delivery|complete/.test(basename)) return 'progress';
  if (/plan|roadmap|milestone/.test(basename)) return 'plan';
  if (/problem|risk|blocker|question/.test(basename)) return 'risks';
  return null;
}

function sectionFromHeading(heading) {
  const value = heading.trim().toLowerCase();
  if (/^(progress|completed|deliveries|delivery|learnings|learning)(\b|\s)/.test(value)) return 'progress';
  if (/^(plan|roadmap|milestones?)(\b|\s)/.test(value)) return 'plan';
  if (/^(problem|problems|risks?|blockers?|questions?)(\b|\s)/.test(value)) return 'risks';
  return null;
}

function normalizeTitle(value) {
  return String(value || '').replace(/[`*_~]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function parseMarkdownSource({ sourcePath, sourceHash, text, fallbackSection, createdAt }) {
  const mapped = [];
  const unmapped = [];
  let section = fallbackSection;
  let current = null;
  let lineNumber = 0;

  const flush = () => {
    if (!current) return;
    const content = current.lines.join('\n').trim();
    const sourceStatusMatch = content.match(/(?:^|\n|\s)status\s*:\s*([^\r\n]+)/i);
    const sourceStatus = sourceStatusMatch ? sourceStatusMatch[1].trim().replace(/^[-*]\s*/, '') : null;
    const normalizedTitle = normalizeTitle(current.title);
    const identity = `${current.section}\0${normalizedTitle}`;
    const id = `legacy-${sha256(identity).slice(0, 24)}`;
    const kind = current.section === 'progress'
      ? 'legacy-delivery-or-learning'
      : current.section === 'plan'
        ? 'legacy-milestone-candidate'
        : 'legacy-risk-or-question-candidate';
    const record = {
      schemaVersion: 1,
      id,
      section: current.section,
      kind,
      title: current.title.slice(0, 240),
      content: content.slice(0, 4096),
      createdAt,
      source: {
        kind: 'legacy-import',
        path: sourcePath,
        sha256: sourceHash,
        line: current.line,
        ...(sourceStatus ? { rawStatus: sourceStatus } : {}),
      },
      ...(current.section === 'progress' ? {} : { status: 'needs-review' }),
      taskIds: [],
    };
    mapped.push({ section: current.section, id, title: record.title, record, sourcePath, line: current.line, sourceStatus });
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    lineNumber += 1;
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      const explicitSection = sectionFromHeading(title);
      if (level === 1 && explicitSection) {
        flush();
        section = explicitSection;
        continue;
      }
      if (level >= 2 && section) {
        flush();
        current = { section, title, lines: [], line: lineNumber };
      } else {
        flush();
        unmapped.push({ source: sourcePath, line: lineNumber, text: rawLine.slice(0, 500) });
      }
      continue;
    }
    const bullet = line.match(/^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (bullet) {
      if (current) current.lines.push(bullet[1]);
      else if (section) mapped.push({
        section,
        id: `legacy-${sha256(`${section}\0${normalizeTitle(bullet[1])}`).slice(0, 24)}`,
        title: bullet[1].slice(0, 240),
        record: null,
        sourcePath,
        line: lineNumber,
        sourceStatus: (bullet[1].match(/status\s*:\s*([^,;]+)/i) || [])[1]?.trim() || null,
        rawBullet: bullet[1],
      });
      else unmapped.push({ source: sourcePath, line: lineNumber, text: rawLine.slice(0, 500) });
      continue;
    }
    if (current) current.lines.push(line);
    else unmapped.push({ source: sourcePath, line: lineNumber, text: rawLine.slice(0, 500) });
  }
  flush();

  // Flat list entries are converted to records after the same conservative rule
  // as heading blocks: status is not inferred or applied during import.
  for (const item of mapped) {
    if (item.record) continue;
    const sourceStatus = item.sourceStatus;
    item.record = {
      schemaVersion: 1,
      id: item.id,
      section: item.section,
      kind: item.section === 'progress' ? 'legacy-delivery-or-learning' : item.section === 'plan' ? 'legacy-milestone-candidate' : 'legacy-risk-or-question-candidate',
      title: item.title,
      content: item.rawBullet.slice(0, 4096),
      createdAt,
      source: {
        kind: 'legacy-import',
        path: sourcePath,
        sha256: sourceHash,
        line: item.line,
        ...(sourceStatus ? { rawStatus: sourceStatus } : {}),
      },
      ...(item.section === 'progress' ? {} : { status: 'needs-review' }),
      taskIds: [],
    };
  }
  return { mapped, unmapped };
}

function stableRecordFingerprint(record) {
  return sha256(JSON.stringify({ section: record.section, title: normalizeTitle(record.title), content: record.content, kind: record.kind }));
}

function findExistingRecord(projectRoot, section, id) {
  if (section === 'progress') {
    const root = path.join(projectRoot, 'Harness', 'project', 'progress', 'segments');
    if (!fs.existsSync(root)) return null;
    const files = [];
    const walk = dir => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, item.name);
        if (item.isDirectory()) walk(absolute);
        else if (item.isFile() && item.name.endsWith('.jsonl')) files.push(absolute);
      }
    };
    walk(root);
    for (const file of files) {
      // A legacy oversized segment is skipped rather than read unbounded; the
      // validator reports it and it cannot silently block an import.
      const bytes = readUnreadableSafe(file, MAX_PROGRESS_SEGMENT_BYTES);
      if (bytes === null) continue;
      for (const line of bytes.toString('utf8').split(/\r?\n/).filter(Boolean)) {
        let record;
        try { record = JSON.parse(line); } catch { continue; }
        if (record.id === id) return record;
      }
    }
    return null;
  }
  const target = projectRecordTarget(projectRoot, section, { id });
  if (!fs.existsSync(target)) return null;
  const bytes = readBoundedFile(target, MAX_RECORD_BYTES, `Stored Project record exceeds ${MAX_RECORD_BYTES} bytes: ${path.relative(projectRoot, target)}`);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('INVALID_RECORD', `Stored Project record is not valid JSON: ${path.relative(projectRoot, target)}`);
  }
}

export function previewProjectImport({ projectId = null, projectRoot = process.cwd(), workspaceRoot = null, sources = [] } = {}) {
  const resolved = resolveProject({ projectId, projectRoot, workspaceRoot, includeArchived: true });
  if (!Array.isArray(sources) || sources.length === 0) fail('BAD_SOURCE', 'Import requires one or more explicit --source paths');
  if (sources.length > 20) fail('BUDGET_EXCEEDED', 'An import preview accepts at most 20 source files; split the migration into reviewed batches');
  const sourceRows = [];
  const mappedItems = [];
  const unmapped = [];
  const sourceSeen = new Set();
  let totalBytes = 0;

  for (const rawSource of sources) {
    const source = normalizeSourcePath(resolved.projectRoot, rawSource);
    if (sourceSeen.has(source.relative)) fail('DUPLICATE_SOURCE', `Source selected more than once: ${source.relative}`);
    sourceSeen.add(source.relative);
    const maxAllowedBytes = Math.min(MAX_SOURCE_BYTES, MAX_TOTAL_SOURCE_BYTES - totalBytes);
    const limitMessage = maxAllowedBytes < MAX_SOURCE_BYTES
      ? `Combined import sources exceed ${MAX_TOTAL_SOURCE_BYTES} bytes`
      : `Import source exceeds ${MAX_SOURCE_BYTES} bytes: ${source.relative}`;
    const bytes = readBoundedFile(source.absolute, maxAllowedBytes, limitMessage);
    totalBytes += bytes.byteLength;
    const sourceHash = sha256(bytes);
    const fallbackSection = sectionFromName(source.relative);
    const createdAt = source.stat.mtime.toISOString();
    const parsed = parseMarkdownSource({
      sourcePath: source.relative,
      sourceHash,
      text: bytes.toString('utf8'),
      fallbackSection,
      createdAt,
    });
    sourceRows.push({ path: source.relative, sha256: sourceHash, size: bytes.byteLength, snapshot: `sources/${String(sourceRows.length + 1).padStart(4, '0')}.bin`, createdAt: source.stat.mtime.toISOString() });
    mappedItems.push(...parsed.mapped);
    unmapped.push(...parsed.unmapped);
  }
  if (mappedItems.length > MAX_IMPORT_RECORDS) fail('BUDGET_EXCEEDED', `Import has more than ${MAX_IMPORT_RECORDS} mapped records; split it into reviewed batches`);

  const duplicates = [];
  const conflicts = [];
  const unknownStatuses = [];
  const unique = new Map();
  const accepted = [];
  for (const item of mappedItems) {
    const record = item.record;
    const fingerprint = stableRecordFingerprint(record);
    const prior = unique.get(`${item.section}:${item.id}`);
    if (prior) {
      if (prior.fingerprint === fingerprint) duplicates.push({ id: item.id, source: item.sourcePath, line: item.line, duplicateOf: prior.item.sourcePath });
      else conflicts.push({ id: item.id, source: item.sourcePath, line: item.line, conflictWith: prior.item.sourcePath, reason: 'same domain/title has different content' });
      continue;
    }
    unique.set(`${item.section}:${item.id}`, { fingerprint, item });
    const existing = findExistingRecord(resolved.projectRoot, item.section, item.id);
    if (existing) {
      if (stableRecordFingerprint(existing) === fingerprint) {
        duplicates.push({ id: item.id, source: item.sourcePath, line: item.line, duplicateOf: 'existing-project-record' });
        continue;
      }
      conflicts.push({ id: item.id, source: item.sourcePath, line: item.line, conflictWith: 'existing-project-record', reason: 'target record already exists with different content' });
      continue;
    }
    accepted.push(item);
    if (item.sourceStatus && !RECOGNIZED_SOURCE_STATUSES.has(item.sourceStatus.toLowerCase())) {
      unknownStatuses.push({ source: item.sourcePath, line: item.line, value: item.sourceStatus, importedStatus: item.section === 'progress' ? null : 'needs-review' });
    }
  }

  const mappings = mappedItems.map(item => ({
    source: item.sourcePath,
    line: item.line,
    target: item.section,
    id: item.id,
    title: item.title,
    importedStatus: item.section === 'progress' ? null : 'needs-review',
  }));
  const plan = {
    schemaVersion: 1,
    projectId: resolved.project.id,
    sources: sourceRows,
    mappings,
    accepted: accepted.map(item => ({ section: item.section, id: item.id, record: item.record })),
    duplicates,
    conflicts,
    unknownStatuses,
    unmapped,
  };
  const planHash = sha256(JSON.stringify({
    schemaVersion: plan.schemaVersion,
    projectId: plan.projectId,
    sources: plan.sources.map(({ path: sourcePath, sha256: sourceHash, size }) => ({ path: sourcePath, sha256: sourceHash, size })),
    mappings: plan.mappings,
    duplicates,
    conflicts,
    unknownStatuses,
    unmapped,
  }));
  return {
    ok: true,
    dryRun: true,
    projectId: resolved.project.id,
    planHash,
    mappings,
    duplicates,
    conflicts,
    unknownStatuses,
    unmapped,
    sources: sourceRows.map(({ path: sourcePath, sha256: sourceHash, size }) => ({ path: sourcePath, sha256: sourceHash, size })),
    sourceCount: sourceRows.length,
    recordCount: accepted.length,
  };
}

function readTransaction(projectRoot, transactionId) {
  if (!/^import-[a-z0-9-]{8,128}$/.test(String(transactionId || ''))) fail('BAD_REQUEST', 'Invalid import transaction id');
  const root = resolveInside(projectRoot, `${IMPORT_ROOT}/${transactionId}`, 'Import transaction');
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail('NOT_FOUND', `Import transaction not found: ${transactionId}`);
  const bytes = readBoundedFile(manifestPath, MAX_TRANSACTION_BYTES, `Import transaction manifest exceeds ${MAX_TRANSACTION_BYTES} bytes`);
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('INVALID_TRANSACTION', 'Import transaction manifest is not valid JSON');
  }
  if (manifest.schemaVersion !== 1 || manifest.id !== transactionId) fail('INVALID_TRANSACTION', 'Import transaction manifest is invalid');
  return { root, manifestPath, manifest };
}

export function applyProjectImport({ projectId = null, projectRoot = process.cwd(), workspaceRoot = null, sources = [], planHash } = {}) {
  const resolved = resolveProject({ projectId, projectRoot, workspaceRoot, includeArchived: true });
  const preview = previewProjectImport({ projectId: resolved.project.id, projectRoot: resolved.projectRoot, sources });
  if (!planHash || preview.planHash !== planHash) fail('PLAN_MISMATCH', 'Import plan hash does not match the reviewed dry-run; preview again');
  if (preview.conflicts.length) fail('IMPORT_CONFLICT', 'Import has unresolved conflicts; resolve them before applying', { conflicts: preview.conflicts });

  const transactionId = `import-${randomUUID()}`;
  const transactionRoot = resolveInside(resolved.projectRoot, `${IMPORT_ROOT}/${transactionId}`, 'Import transaction');
  const sourceRows = [];
  const sourceArgs = Array.isArray(sources) ? sources : [];
  let totalBytes = 0;
  for (let i = 0; i < sourceArgs.length; i += 1) {
    const source = normalizeSourcePath(resolved.projectRoot, sourceArgs[i]);
    const maxAllowedBytes = Math.min(MAX_SOURCE_BYTES, MAX_TOTAL_SOURCE_BYTES - totalBytes);
    const limitMessage = maxAllowedBytes < MAX_SOURCE_BYTES
      ? `Combined import sources exceed ${MAX_TOTAL_SOURCE_BYTES} bytes`
      : `Import source exceeds ${MAX_SOURCE_BYTES} bytes: ${source.relative}`;
    const bytes = readBoundedFile(source.absolute, maxAllowedBytes, limitMessage);
    totalBytes += bytes.byteLength;
    const sourceHash = sha256(bytes);
    const snapshot = `sources/${String(i + 1).padStart(4, '0')}.bin`;
    sourceRows.push({ path: source.relative, sha256: sourceHash, size: bytes.byteLength, snapshot, createdAt: source.stat.mtime.toISOString(), bytes });
  }
  fs.mkdirSync(path.join(transactionRoot, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(transactionRoot, 'changes'), { recursive: true });
  for (const sourceRow of sourceRows) {
    atomicWriteFile(path.join(transactionRoot, ...sourceRow.snapshot.split('/')), sourceRow.bytes);
  }
  const manifestPath = path.join(transactionRoot, 'manifest.json');
  const transaction = {
    schemaVersion: 1,
    id: transactionId,
    projectId: resolved.project.id,
    planHash: preview.planHash,
    status: 'preparing',
    createdAt: new Date().toISOString(),
    sourceCount: sourceRows.length,
    changeCount: 0,
    sources: sourceRows.map(({ path: sourcePath, sha256: sourceHash, size, snapshot }) => ({ path: sourcePath, sha256: sourceHash, size, snapshot })),
  };
  atomicWriteJson(manifestPath, transaction);

  const outputsByPath = new Map();
  let changeIndex = 0;
  // Journal each destination BEFORE mutating it, so a crash can never leave an
  // output that the recovery log does not know about.
  const journalChange = (relativePath, beforeBytes) => {
    const existing = outputsByPath.get(relativePath);
    if (existing) return existing;
    const beforeSnapshot = beforeBytes === null ? null : `snapshots/${String(changeIndex + 1).padStart(4, '0')}.bin`;
    if (beforeSnapshot) atomicWriteFile(path.join(transactionRoot, ...beforeSnapshot.split('/')), beforeBytes);
    const change = {
      schemaVersion: 1,
      path: relativePath,
      beforeExists: beforeBytes !== null,
      beforeSha256: beforeBytes === null ? null : sha256(beforeBytes),
      beforeSnapshot,
      afterSha256: null,
    };
    const changePath = `changes/${String(changeIndex + 1).padStart(4, '0')}.json`;
    atomicWriteJson(path.join(transactionRoot, ...changePath.split('/')), change);
    const entry = { change, changePath, absolutePath: resolveInside(resolved.projectRoot, relativePath, 'Import output') };
    outputsByPath.set(relativePath, entry);
    changeIndex += 1;
    return entry;
  };
  try {
    const actualPreview = previewProjectImport({ projectId: resolved.project.id, projectRoot: resolved.projectRoot, sources });
    if (actualPreview.planHash !== planHash) fail('PLAN_MISMATCH', 'Import sources changed between preview and apply');
    if (actualPreview.conflicts.length) fail('IMPORT_CONFLICT', 'Import has unresolved conflicts');
    const skipped = new Set([
      ...actualPreview.duplicates.map(item => `${item.source}:${item.line}`),
      ...actualPreview.conflicts.map(item => `${item.source}:${item.line}`),
    ]);
    const parsedRows = actualPreview.mappings.filter(item => !skipped.has(`${item.source}:${item.line}`));
    const recordCandidates = [];
    for (const mapping of parsedRows) {
      if (actualPreview.duplicates.some(item => item.id === mapping.id && item.source === mapping.source && item.line === mapping.line)) continue;
      const sourceRow = sourceRows.find(item => item.path === mapping.source);
      const original = readBoundedFile(
        path.join(transactionRoot, ...sourceRow.snapshot.split('/')),
        MAX_SOURCE_BYTES,
        `Import source snapshot exceeds ${MAX_SOURCE_BYTES} bytes`,
      ).toString('utf8');
      const parsed = parseMarkdownSource({
        sourcePath: mapping.source,
        sourceHash: sourceRow.sha256,
        text: original,
        fallbackSection: sectionFromName(mapping.source),
        createdAt: sourceRow.createdAt,
      });
      const candidate = parsed.mapped.find(item => item.id === mapping.id && item.line === mapping.line);
      if (candidate) recordCandidates.push(candidate);
    }
    for (const candidate of recordCandidates) {
      const target = projectRecordTarget(resolved.projectRoot, candidate.section, candidate.record);
      const relativePath = path.relative(resolved.projectRoot, target).replace(/\\/g, '/');
      const beforeBytes = fs.existsSync(target) ? readBoundedFile(target, MAX_IMPORT_OUTPUT_BYTES, `Import output exceeds ${MAX_IMPORT_OUTPUT_BYTES} bytes: ${relativePath}`) : null;
      const entry = journalChange(relativePath, beforeBytes);
      writeProjectRecordAt({ projectRoot: resolved.projectRoot, projectId: resolved.project.id, section: candidate.section, record: candidate.record, target });
      const afterBytes = readBoundedFile(entry.absolutePath, MAX_IMPORT_OUTPUT_BYTES, `Import output exceeds ${MAX_IMPORT_OUTPUT_BYTES} bytes: ${relativePath}`);
      entry.change.afterSha256 = sha256(afterBytes);
      atomicWriteJson(path.join(transactionRoot, ...entry.changePath.split('/')), entry.change);
    }

    const outputs = [...outputsByPath.values()].map(entry => ({ path: entry.change.path, sha256: entry.change.afterSha256 }));
    transaction.status = 'applied';
    transaction.appliedAt = new Date().toISOString();
    transaction.changeCount = outputs.length;
    atomicWriteJson(manifestPath, transaction);
    return { ok: true, dryRun: false, transactionId, planHash, sourceCount: sourceRows.length, outputs };
  } catch (error) {
    for (const entry of outputsByPath.values()) {
      try {
        if (!entry.change.beforeExists) {
          fs.rmSync(entry.absolutePath, { force: true });
        } else {
          const beforeBytes = readBoundedFile(
            path.join(transactionRoot, ...String(entry.change.beforeSnapshot).split('/')),
            MAX_IMPORT_OUTPUT_BYTES,
            'Import rollback snapshot is larger than one output',
          );
          atomicWriteFile(entry.absolutePath, beforeBytes);
        }
      } catch { /* preserve original error and leave the journal for recovery */ }
    }
    transaction.status = 'failed';
    transaction.failure = String(error.message || error).slice(0, 500);
    atomicWriteJson(manifestPath, transaction);
    throw error;
  }
}

export function rollbackProjectImport({ projectRoot = process.cwd(), transactionId, apply = false } = {}) {
  const root = fs.realpathSync(projectRoot);
  const { root: transactionRoot, manifestPath, manifest } = readTransaction(root, transactionId);
  // `preparing` means the process died mid-apply; `failed` means the in-process
  // cleanup could not restore everything. Every write was journaled first, so
  // either status can be recovered from the journal.
  if (manifest.status !== 'applied' && manifest.status !== 'preparing' && manifest.status !== 'failed') fail('INVALID_TRANSACTION', `Cannot rollback transaction in status ${manifest.status}`);
  const recovering = manifest.status !== 'applied';
  const changeFiles = fs.readdirSync(path.join(transactionRoot, 'changes')).filter(name => /^\d{4}\.json$/.test(name)).sort();
  const changes = changeFiles.map(name => {
    const bytes = readBoundedFile(path.join(transactionRoot, 'changes', name), MAX_TRANSACTION_BYTES, `Import change journal entry exceeds ${MAX_TRANSACTION_BYTES} bytes: ${name}`);
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      fail('INVALID_TRANSACTION', `Import change journal entry is not valid JSON: ${name}`);
    }
  });
  const conflicts = [];
  for (const change of changes) {
    const target = resolveInside(root, change.path, 'Import rollback target');
    const exists = fs.existsSync(target);
    const currentHash = exists
      ? sha256(readBoundedFile(target, MAX_IMPORT_OUTPUT_BYTES, `Import output exceeds ${MAX_IMPORT_OUTPUT_BYTES} bytes: ${change.path}`))
      : null;
    if (!recovering) {
      if (!exists) {
        conflicts.push({ path: change.path, reason: 'output is missing' });
        continue;
      }
      if (currentHash !== change.afterSha256) conflicts.push({ path: change.path, reason: 'output changed after import', expected: change.afterSha256, actual: currentHash });
      continue;
    }
    // Recovery: any journaled state is acceptable, and only content that is
    // neither the before-state nor this transaction's write blocks recovery.
    if (!exists) {
      // Nothing to restore to when the file did not exist before; when it did,
      // the snapshot below recreates it.
      continue;
    }
    const alreadyRestored = change.beforeExists && currentHash === change.beforeSha256;
    const isOurWrite = change.afterSha256 === null || currentHash === change.afterSha256;
    if (alreadyRestored || isOurWrite) continue;
    conflicts.push({ path: change.path, reason: 'output changed after the interrupted import', expected: change.afterSha256, actual: currentHash });
  }
  const validatedSnapshots = new Map();
  for (const change of changes) {
    if (!change.beforeExists) continue;
    if (typeof change.beforeSnapshot !== 'string' || !change.beforeSnapshot) fail('INVALID_TRANSACTION', `Rollback snapshot reference is missing for ${change.path}`);
    const snapshotPath = resolveInside(transactionRoot, change.beforeSnapshot, 'Import rollback snapshot');
    if (!fs.existsSync(snapshotPath)) fail('INVALID_TRANSACTION', `Rollback snapshot is missing: ${change.beforeSnapshot}`);
    const beforeBytes = readBoundedFile(snapshotPath, MAX_IMPORT_OUTPUT_BYTES, `Rollback snapshot exceeds ${MAX_IMPORT_OUTPUT_BYTES} bytes: ${change.beforeSnapshot}`);
    if (sha256(beforeBytes) !== change.beforeSha256) fail('INVALID_TRANSACTION', `Rollback snapshot hash mismatch: ${change.beforeSnapshot}`);
    validatedSnapshots.set(change.path, beforeBytes);
  }
  const outputs = changes.map(change => ({ path: change.path, sha256: change.afterSha256 }));
  if (!apply) return { ok: conflicts.length === 0, dryRun: true, canRollback: conflicts.length === 0, recovering, transactionId, outputs, conflicts };
  if (conflicts.length) fail('ROLLBACK_CONFLICT', 'Rollback refused because one or more imported outputs changed', { conflicts });

  for (const change of changes) {
    const target = resolveInside(root, change.path, 'Import rollback target');
    if (!change.beforeExists) {
      fs.rmSync(target, { force: true });
    } else {
      atomicWriteFile(target, validatedSnapshots.get(change.path));
    }
  }
  manifest.status = 'rolledBack';
  manifest.rolledBackAt = new Date().toISOString();
  atomicWriteJson(manifestPath, manifest);
  return { ok: true, dryRun: false, rolledBack: true, recovering, transactionId, outputs, conflicts: [] };
}
