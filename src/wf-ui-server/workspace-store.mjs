import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const USER_FILES_MAX_COUNT = 64;
export const USER_FILES_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const USER_FILES_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const WORKSPACE_TEXT_PREVIEW_MAX_BYTES = 64 * 1024;

const WORKSPACE_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.ts': 'text/typescript; charset=utf-8',
  '.tsx': 'text/typescript; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.log': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.markdown',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

export class WorkspaceStoreError extends Error {
  constructor(message, { statusCode = 400, code = 'BAD_REQUEST' } = {}) {
    super(message);
    this.name = 'Error';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function canonicalRoot(projectRoot) {
  if (!projectRoot) throw new WorkspaceStoreError('Project root is required');
  return path.resolve(projectRoot);
}

function isInsideOrSame(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRel(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function realPathIfExists(absolutePath) {
  try {
    return fs.realpathSync.native(absolutePath);
  } catch {
    return null;
  }
}

function canonicalExistingRoot(projectRoot) {
  const root = canonicalRoot(projectRoot);
  return realPathIfExists(root) || root;
}

function isWindowsReservedName(segment) {
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment);
}

function validatePathSegment(segment) {
  if (!segment || segment === '.' || segment === '..') return;
  if (segment.endsWith('.') || segment.endsWith(' ')) {
    throw new WorkspaceStoreError(`Invalid filename segment with trailing dot or space: ${segment}`);
  }
  if (isWindowsReservedName(segment)) {
    throw new WorkspaceStoreError(`Reserved Windows filename segment is not allowed: ${segment}`);
  }
}

function validateWorkspaceRelPath(relPath) {
  for (const segment of normalizeRel(relPath).split('/').filter(Boolean)) {
    validatePathSegment(segment);
  }
}

function toWorkspaceRel(root, absolutePath) {
  const rel = path.relative(root, absolutePath).replace(/\\/g, '/');
  return rel === '' ? '' : rel;
}

export function resolveWorkspacePath(projectRoot, rawPath = '') {
  const root = canonicalRoot(projectRoot);
  const text = String(rawPath || '');
  if (text.includes('\0')) {
    throw new WorkspaceStoreError('Path traversal detected: null bytes are not allowed');
  }
  const candidate = path.isAbsolute(text) ? path.resolve(text) : path.resolve(root, text || '.');
  if (!isInsideOrSame(root, candidate)) {
    throw new WorkspaceStoreError('Path traversal detected: resolved path escapes outside workspace');
  }
  const relPath = toWorkspaceRel(root, candidate);
  validateWorkspaceRelPath(relPath);
  return {
    root,
    absolutePath: candidate,
    path: relPath,
  };
}

function assertExistingPathInsideWorkspace(projectRoot, absolutePath) {
  const root = canonicalRoot(projectRoot);
  const realRoot = canonicalExistingRoot(projectRoot);
  const realTarget = realPathIfExists(absolutePath);
  if (!realTarget) return;
  if (!isInsideOrSame(realRoot, realTarget)) {
    throw new WorkspaceStoreError('Path symlink/junction escape detected outside workspace');
  }
  if (!isInsideOrSame(root, path.resolve(absolutePath))) {
    throw new WorkspaceStoreError('Path traversal detected: resolved path escapes outside workspace');
  }
}

function nearestExistingAncestor(absolutePath) {
  let current = path.resolve(absolutePath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function assertParentInsideWorkspace(projectRoot, absolutePath) {
  const ancestor = nearestExistingAncestor(path.dirname(absolutePath));
  if (ancestor) assertExistingPathInsideWorkspace(projectRoot, ancestor);
}

function lstatExisting(absolutePath) {
  return fs.lstatSync(absolutePath);
}

function statExistingInside(projectRoot, absolutePath) {
  assertExistingPathInsideWorkspace(projectRoot, absolutePath);
  return fs.statSync(absolutePath);
}

function etagForStat(stat) {
  return `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
}

// ── Preview read cache (task-upgrade-file-node AC-1) ──
// In-memory cache for getWorkspaceMeta / readWorkspaceTextPreview results. Key
// = kind + canonical root + workspace-relative path (+ offset/limit for text).
// An entry is a hit only while the file's stat key (size + truncated mtimeMs)
// is unchanged and the entry is younger than the TTL, so a stat change is an
// automatic miss that re-reads the disk; explicit invalidation drops both the
// meta and text entries for the path. The Map is bounded (~200 entries, LRU by
// insertion age when full).
export const PREVIEW_CACHE_TTL_MS = 5000;
const PREVIEW_CACHE_MAX_ENTRIES = 200;
const previewCache = new Map(); // key -> { statKey, cachedAt, value }

function previewCacheKey(kind, root, relPath) {
  return `${kind}\u0000${root}\u0000${relPath}`;
}

function previewStatKey(stat) {
  return stat ? `${stat.size}:${Math.trunc(stat.mtimeMs)}` : 'missing';
}

function cachedPreviewValue(key, statKey) {
  const entry = previewCache.get(key);
  if (!entry) return null;
  if (entry.statKey !== statKey || entry.cachedAt + PREVIEW_CACHE_TTL_MS <= Date.now()) {
    previewCache.delete(key);
    return null;
  }
  return entry.value;
}

function setPreviewCache(key, statKey, value) {
  previewCache.set(key, { statKey, cachedAt: Date.now(), value });
  if (previewCache.size > PREVIEW_CACHE_MAX_ENTRIES) {
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [entryKey, entry] of previewCache) {
      if (entry.cachedAt < oldestAt) {
        oldestAt = entry.cachedAt;
        oldestKey = entryKey;
      }
    }
    if (oldestKey !== null) previewCache.delete(oldestKey);
  }
}

/**
 * Return the cached preview value for a workspace path, or undefined on miss.
 * The stat is re-checked like every internal read, so a changed file (or an
 * expired TTL entry) reports as a miss instead of serving stale content.
 */
export function getPreviewCached(projectRoot, rawPath = '') {
  const resolved = resolveWorkspacePath(projectRoot, rawPath);
  const stat = fs.existsSync(resolved.absolutePath) ? fs.statSync(resolved.absolutePath) : null;
  const statKey = previewStatKey(stat);
  const metaKey = previewCacheKey('meta', resolved.root, resolved.path);
  const meta = cachedPreviewValue(metaKey, statKey);
  if (meta) return meta;
  const textBase = previewCacheKey('text', resolved.root, resolved.path);
  for (const [key, entry] of previewCache) {
    if (key.startsWith(`${textBase}\u0000`) && entry.statKey === statKey) {
      if (entry.cachedAt + PREVIEW_CACHE_TTL_MS <= Date.now()) {
        previewCache.delete(key);
        continue;
      }
      return entry.value;
    }
  }
  return undefined;
}

/**
 * Drop every cached entry (meta and text) for a workspace path so the next
 * read re-reads the disk. Unresolvable paths are a no-op.
 */
export function invalidateFileCache(projectRoot, rawPath = '') {
  let resolved;
  try {
    resolved = resolveWorkspacePath(projectRoot, rawPath);
  } catch {
    return;
  }
  const prefixes = [
    previewCacheKey('meta', resolved.root, resolved.path),
    previewCacheKey('text', resolved.root, resolved.path),
  ];
  for (const key of [...previewCache.keys()]) {
    if (prefixes.some(prefix => key === prefix || key.startsWith(`${prefix}\u0000`))) {
      previewCache.delete(key);
    }
  }
}

export function workspaceMimeForPath(filePath) {
  return WORKSPACE_MIME[path.extname(String(filePath || '')).toLowerCase()] || 'application/octet-stream';
}

function mimeEssence(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

function isTextLikeMime(mime, filePath) {
  const essence = mimeEssence(mime);
  if (essence.startsWith('text/')) return true;
  if (['application/json', 'application/xml', 'application/yaml', 'application/x-yaml'].includes(essence)) return true;
  return TEXT_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function previewKindFor(type, mime, filePath) {
  if (type === 'missing') return 'missing';
  if (type !== 'file') return 'none';
  const essence = mimeEssence(mime);
  if (isTextLikeMime(mime, filePath)) return 'text';
  if (essence.startsWith('image/')) return 'image';
  if (essence === 'application/pdf') return 'pdf';
  if (essence.startsWith('video/')) return 'video';
  return 'none';
}

function typeForStat(stat) {
  if (stat.isFile()) return 'file';
  if (stat.isDirectory()) return 'directory';
  return 'other';
}

function workspaceMetaFromStat(resolved, stat, absolutePath) {
  const type = typeForStat(stat);
  const mime = type === 'file'
    ? workspaceMimeForPath(absolutePath)
    : (type === 'directory' ? 'inode/directory' : 'application/octet-stream');
  return {
    ok: true,
    path: resolved.path,
    name: path.basename(resolved.path || resolved.root),
    type,
    exists: true,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    mime,
    etag: etagForStat(stat),
    previewKind: previewKindFor(type, mime, absolutePath),
  };
}

export function getWorkspaceMeta(projectRoot, rawPath = '') {
  const resolved = resolveWorkspacePath(projectRoot, rawPath);
  const key = previewCacheKey('meta', resolved.root, resolved.path);
  const stat = fs.existsSync(resolved.absolutePath)
    ? statExistingInside(projectRoot, resolved.absolutePath)
    : null;
  const statKey = previewStatKey(stat);
  const cached = cachedPreviewValue(key, statKey);
  if (cached) return cached;
  let meta;
  if (!stat) {
    assertParentInsideWorkspace(projectRoot, resolved.absolutePath);
    meta = {
      ok: true,
      path: resolved.path,
      name: path.basename(resolved.path || resolved.root),
      type: 'missing',
      exists: false,
      size: 0,
      mtime: null,
      mime: '',
      etag: null,
      previewKind: 'missing',
    };
  } else {
    meta = workspaceMetaFromStat(resolved, stat, resolved.absolutePath);
  }
  setPreviewCache(key, statKey, meta);
  return meta;
}

export function getWorkspaceFileInfo(projectRoot, rawPath = '') {
  const resolved = requireExisting(projectRoot, rawPath);
  const absolutePath = fs.realpathSync.native(resolved.absolutePath);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new WorkspaceStoreError(`Path is not a file: ${resolved.path}`, {
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
  }
  return {
    ...workspaceMetaFromStat(resolved, stat, absolutePath),
    absolutePath,
    lastModified: stat.mtime.toUTCString(),
  };
}

function boundedInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new WorkspaceStoreError('Text preview offset and limit must be non-negative numbers');
  }
  return Math.min(Math.floor(parsed), max);
}

function bufferLooksBinary(buffer) {
  if (!buffer || buffer.length === 0) return false;
  return buffer.includes(0);
}

export function readWorkspaceTextPreview(projectRoot, options = {}) {
  const info = getWorkspaceFileInfo(projectRoot, options.path || '');
  if (!isTextLikeMime(info.mime, info.absolutePath)) {
    throw new WorkspaceStoreError(`Text preview is not supported for ${info.mime || 'binary content'}`, {
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  }
  const offset = boundedInteger(options.offset, 0);
  const limit = boundedInteger(options.limit, WORKSPACE_TEXT_PREVIEW_MAX_BYTES, WORKSPACE_TEXT_PREVIEW_MAX_BYTES);
  // Cache the (path, offset, limit) slice against the file's stat key so
  // repeated identical previews skip the disk read (AC-1). The 64KB text
  // preview cap is unchanged — the cached value IS the bounded slice.
  const resolved = resolveWorkspacePath(projectRoot, options.path || '');
  const key = `${previewCacheKey('text', resolved.root, info.path)}\u0000${offset}\u0000${limit}`;
  const statKey = previewStatKey({ size: info.size, mtimeMs: new Date(info.mtime).getTime() });
  const cached = cachedPreviewValue(key, statKey);
  if (cached) return cached;
  const start = Math.min(offset, info.size);
  const readLength = Math.min(limit, Math.max(info.size - start, 0));
  const buffer = Buffer.alloc(readLength);
  let bytesRead = 0;
  const fd = fs.openSync(info.absolutePath, 'r');
  try {
    bytesRead = readLength > 0 ? fs.readSync(fd, buffer, 0, readLength, start) : 0;
  } finally {
    fs.closeSync(fd);
  }
  const body = buffer.subarray(0, bytesRead);
  if (bufferLooksBinary(body)) {
    throw new WorkspaceStoreError('Binary content is not supported for text preview', {
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  }
  const result = {
    ok: true,
    path: info.path,
    text: body.toString('utf8'),
    bytesRead,
    truncated: start + bytesRead < info.size,
    encoding: 'utf-8',
  };
  setPreviewCache(key, statKey, result);
  return result;
}

function requireExisting(projectRoot, rawPath) {
  const resolved = resolveWorkspacePath(projectRoot, rawPath);
  if (!fs.existsSync(resolved.absolutePath)) {
    throw new WorkspaceStoreError(`Path not found: ${resolved.path || '.'}`, {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }
  assertExistingPathInsideWorkspace(projectRoot, resolved.absolutePath);
  return resolved;
}

function requireMissing(projectRoot, rawPath) {
  const resolved = resolveWorkspacePath(projectRoot, rawPath);
  if (fs.existsSync(resolved.absolutePath)) {
    throw new WorkspaceStoreError(`Path already exists; refusing overwrite: ${resolved.path}`, {
      statusCode: 409,
      code: 'CONFLICT',
    });
  }
  assertParentInsideWorkspace(projectRoot, resolved.absolutePath);
  return resolved;
}

function ensureParent(absolutePath) {
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
}

function readFileBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

function decodeContent(contentBase64 = '') {
  const compact = String(contentBase64 ?? '').replace(/\s+/g, '');
  if (!compact) return Buffer.alloc(0);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) {
    throw new WorkspaceStoreError('Invalid malformed base64 content');
  }
  const buffer = Buffer.from(compact, 'base64');
  const normalizedInput = compact.replace(/=+$/g, '');
  const normalizedOutput = buffer.toString('base64').replace(/=+$/g, '');
  if (normalizedInput !== normalizedOutput) {
    throw new WorkspaceStoreError('Invalid malformed base64 content');
  }
  return buffer;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function appendJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

const revisionState = new Map();

export function workspaceOpsLogPath(projectRoot) {
  return path.join(canonicalRoot(projectRoot), 'Harness', 'a2a', 'workspace-ops.jsonl');
}

function nextRevision(projectRoot) {
  const logPath = workspaceOpsLogPath(projectRoot);
  const rows = readJsonl(logPath);
  const diskMax = rows.reduce((max, row) => Math.max(max, Number(row.revision || 0)), 0);
  const current = Math.max(Number(revisionState.get(logPath) || 0), diskMax);
  const next = current + 1;
  revisionState.set(logPath, next);
  return next;
}

function trashRoot(projectRoot, opId) {
  return path.join(canonicalRoot(projectRoot), 'Harness', '.trash', 'workspace-ops', opId);
}

function changedEntries(...items) {
  return items.filter(Boolean).map((item) => normalizeRel(item));
}

function hasDirectoryChildren(dirPath) {
  try {
    return fs.readdirSync(dirPath).length > 0;
  } catch {
    return false;
  }
}

export function listWorkspaceTree(projectRoot, options = {}) {
  const resolved = requireExisting(projectRoot, options.path || '');
  const stat = statExistingInside(projectRoot, resolved.absolutePath);
  if (!stat.isDirectory()) {
    throw new WorkspaceStoreError(`Path is not a directory: ${resolved.path}`, {
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
  }
  const entries = fs.readdirSync(resolved.absolutePath, { withFileTypes: true })
    .map((entry) => {
      const absolutePath = path.join(resolved.absolutePath, entry.name);
      const entryStat = entry.isSymbolicLink()
        ? lstatExisting(absolutePath)
        : statExistingInside(projectRoot, absolutePath);
      const isDirectory = !entry.isSymbolicLink() && entryStat.isDirectory();
      return {
        name: entry.name,
        path: toWorkspaceRel(resolved.root, absolutePath),
        type: isDirectory ? 'directory' : 'file',
        size: entryStat.size,
        mtime: entryStat.mtime.toISOString(),
        hasChildren: isDirectory ? hasDirectoryChildren(absolutePath) : false,
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return {
    root: resolved.root,
    path: resolved.path,
    absolutePath: resolved.absolutePath,
    entries,
  };
}

function removePath(absolutePath) {
  fs.rmSync(absolutePath, { recursive: true, force: true });
}

function writeLogRow(projectRoot, row) {
  appendJsonl(workspaceOpsLogPath(projectRoot), row);
  return row;
}

export function applyWorkspaceOperation(projectRoot, operation = {}) {
  const op = String(operation.op || '').trim();
  const opId = crypto.randomUUID();
  const revision = nextRevision(projectRoot);
  const createdAt = nowIso();
  let result;

  if (op === 'create-file') {
    const target = requireMissing(projectRoot, operation.target);
    const content = decodeContent(operation.contentBase64);
    ensureParent(target.absolutePath);
    fs.writeFileSync(target.absolutePath, content);
    result = {
      source: null,
      target: target.path,
      inverse: { type: 'remove', target: target.path },
      entriesChanged: changedEntries(target.path),
    };
  } else if (op === 'create-folder') {
    const target = requireMissing(projectRoot, operation.target);
    ensureParent(target.absolutePath);
    fs.mkdirSync(target.absolutePath, { recursive: false });
    result = {
      source: null,
      target: target.path,
      inverse: { type: 'remove', target: target.path },
      entriesChanged: changedEntries(target.path),
    };
  } else if (op === 'write') {
    const target = requireExisting(projectRoot, operation.target);
    const content = decodeContent(operation.contentBase64);
    if (!statExistingInside(projectRoot, target.absolutePath).isFile()) {
      throw new WorkspaceStoreError(`Path is not a file: ${target.path}`);
    }
    const previousContentBase64 = readFileBase64(target.absolutePath);
    fs.writeFileSync(target.absolutePath, content);
    result = {
      source: null,
      target: target.path,
      inverse: { type: 'write', target: target.path, contentBase64: previousContentBase64 },
      entriesChanged: changedEntries(target.path),
    };
  } else if (op === 'rename' || op === 'move') {
    const source = requireExisting(projectRoot, operation.source);
    const target = requireMissing(projectRoot, operation.target);
    ensureParent(target.absolutePath);
    fs.renameSync(source.absolutePath, target.absolutePath);
    result = {
      source: source.path,
      target: target.path,
      inverse: { type: 'rename', source: target.path, target: source.path },
      entriesChanged: changedEntries(source.path, target.path),
    };
  } else if (op === 'copy') {
    const source = requireExisting(projectRoot, operation.source);
    const target = requireMissing(projectRoot, operation.target);
    ensureParent(target.absolutePath);
    fs.cpSync(source.absolutePath, target.absolutePath, { recursive: true, errorOnExist: true });
    result = {
      source: source.path,
      target: target.path,
      inverse: { type: 'remove', target: target.path },
      entriesChanged: changedEntries(target.path),
    };
  } else if (op === 'delete') {
    const source = requireExisting(projectRoot, operation.source);
    const targetTrashRoot = trashRoot(projectRoot, opId);
    fs.mkdirSync(targetTrashRoot, { recursive: true });
    const trashPath = path.join(targetTrashRoot, path.basename(source.absolutePath));
    fs.renameSync(source.absolutePath, trashPath);
    result = {
      source: source.path,
      target: null,
      inverse: { type: 'restore-trash', source: trashPath, target: source.path },
      trashPath,
      strategy: 'rename-to-trash',
      entriesChanged: changedEntries(source.path),
    };
  } else {
    throw new WorkspaceStoreError(`Unsupported workspace operation: ${op}`);
  }

  const row = writeLogRow(projectRoot, {
    opId,
    revision,
    op,
    source: result.source,
    target: result.target,
    inverse: result.inverse,
    entriesChanged: result.entriesChanged || [],
    undoable: true,
    createdAt,
  });

  return {
    ok: true,
    opId,
    revision,
    op,
    undoable: true,
    entriesChanged: result.entriesChanged || [],
    ...(result.trashPath ? { trashPath: result.trashPath } : {}),
    ...(result.strategy ? { strategy: result.strategy } : {}),
    logRow: row,
  };
}

function undoneOpIds(rows) {
  return new Set(rows.filter((row) => row.op === 'undo' && row.undoneOpId).map((row) => row.undoneOpId));
}

function rowChangedEntries(row) {
  const values = Array.isArray(row.entriesChanged) ? [...row.entriesChanged] : [];
  for (const key of ['source', 'target']) {
    if (row[key]) values.push(row[key]);
  }
  const inverse = row.inverse || {};
  for (const key of ['source', 'target']) {
    if (inverse[key] && !path.isAbsolute(String(inverse[key]))) values.push(inverse[key]);
  }
  return values.map(item => normalizeRel(item)).filter(Boolean);
}

function pathsOverlap(a, b) {
  const left = normalizeRel(a);
  const right = normalizeRel(b);
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function hasLaterOverlappingOperation(row, rows, undone) {
  const rowEntries = rowChangedEntries(row);
  if (rowEntries.length === 0) return false;
  return rows.some((candidate) => {
    if (!candidate.undoable || candidate.op === 'undo' || undone.has(candidate.opId)) return false;
    if (Number(candidate.revision || 0) <= Number(row.revision || 0)) return false;
    return rowChangedEntries(candidate).some(candidateEntry =>
      rowEntries.some(rowEntry => pathsOverlap(candidateEntry, rowEntry))
    );
  });
}

function resolveUndoRow(projectRoot, opId = 'latest') {
  const rows = readJsonl(workspaceOpsLogPath(projectRoot));
  const undone = undoneOpIds(rows);
  if (opId && opId !== 'latest') {
    const row = rows.find((candidate) => candidate.opId === opId && candidate.undoable);
    if (!row || undone.has(row.opId)) {
      throw new WorkspaceStoreError(`Undoable operation not found: ${opId}`, {
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    }
    if (hasLaterOverlappingOperation(row, rows, undone)) {
      throw new WorkspaceStoreError(`Stale undo conflict: newer operation affects ${row.opId}`, {
        statusCode: 409,
        code: 'CONFLICT',
      });
    }
    return row;
  }
  const row = [...rows].reverse().find((candidate) => candidate.undoable && candidate.op !== 'undo' && !undone.has(candidate.opId));
  if (!row) {
    throw new WorkspaceStoreError('No undoable workspace operation found', {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }
  return row;
}

function applyInverse(projectRoot, row) {
  const inverse = row.inverse || {};
  if (inverse.type === 'remove') {
    const target = requireExisting(projectRoot, inverse.target);
    removePath(target.absolutePath);
    return changedEntries(target.path);
  }
  if (inverse.type === 'write') {
    const target = resolveWorkspacePath(projectRoot, inverse.target);
    ensureParent(target.absolutePath);
    fs.writeFileSync(target.absolutePath, decodeContent(inverse.contentBase64));
    return changedEntries(target.path);
  }
  if (inverse.type === 'rename') {
    const source = requireExisting(projectRoot, inverse.source);
    const target = requireMissing(projectRoot, inverse.target);
    ensureParent(target.absolutePath);
    fs.renameSync(source.absolutePath, target.absolutePath);
    return changedEntries(source.path, target.path);
  }
  if (inverse.type === 'restore-trash') {
    const target = requireMissing(projectRoot, inverse.target);
    const source = path.resolve(String(inverse.source || ''));
    const expectedTrashRoot = trashRoot(projectRoot, row.opId);
    if (!isInsideOrSame(expectedTrashRoot, source)) {
      throw new WorkspaceStoreError(`Corrupt trash source outside operation trash root: ${source}`);
    }
    if (!fs.existsSync(source)) {
      throw new WorkspaceStoreError(`Trash path not found: ${source}`, {
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    }
    assertExistingPathInsideWorkspace(projectRoot, source);
    ensureParent(target.absolutePath);
    fs.renameSync(source, target.absolutePath);
    return changedEntries(target.path);
  }
  throw new WorkspaceStoreError(`Unsupported undo operation: ${inverse.type}`);
}

export function undoWorkspaceOperation(projectRoot, options = {}) {
  const row = resolveUndoRow(projectRoot, options.opId || 'latest');
  const entriesChanged = applyInverse(projectRoot, row);
  const undoOpId = crypto.randomUUID();
  const revision = nextRevision(projectRoot);
  writeLogRow(projectRoot, {
    opId: undoOpId,
    revision,
    op: 'undo',
    undoneOpId: row.opId,
    undoable: false,
    createdAt: nowIso(),
  });
  return {
    ok: true,
    opId: undoOpId,
    revision,
    undoneOpId: row.opId,
    entriesChanged,
  };
}

// ── "Open in OS file manager" reveal (task-wf-ui-terminal-explorer-ux AC-009) ──
// Pure plan builder: validates containment + existence, returns the spawn plan.
// The HTTP route executes the plan; tests assert the plan without spawning.
export function planRevealWorkspacePath(projectRoot, rawPath = '') {
  const resolved = resolveWorkspacePath(projectRoot, rawPath);
  if (!fs.existsSync(resolved.absolutePath)) {
    throw new WorkspaceStoreError(`Path does not exist on disk: ${resolved.path}`, {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }
  const isDirectory = fs.statSync(resolved.absolutePath).isDirectory();
  const platform = process.platform;
  let command;
  let args;
  if (platform === 'win32') {
    command = 'explorer.exe';
    // Directories open in place; files open with the item pre-selected.
    // explorer.exe takes the flag and path joined in one argument.
    args = isDirectory ? [resolved.absolutePath] : [`/select,${resolved.absolutePath}`];
  } else if (platform === 'darwin') {
    command = 'open';
    args = isDirectory ? [resolved.absolutePath] : ['-R', resolved.absolutePath];
  } else {
    command = 'xdg-open';
    args = [isDirectory ? resolved.absolutePath : path.dirname(resolved.absolutePath)];
  }
  return {
    path: resolved.path,
    absolutePath: resolved.absolutePath,
    isDirectory,
    platform,
    command,
    args,
  };
}

function safeFileName(value, index) {
  const raw = String(value || `user-file-${index + 1}`);
  const basename = raw.split(/[\\/]+/).pop() || `user-file-${index + 1}`;
  validatePathSegment(basename);
  const cleaned = basename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 160);
  const result = cleaned || `user-file-${index + 1}`;
  validatePathSegment(result);
  return result;
}

function uniquePath(directory, filename) {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext) || 'user-file';
  let candidate = path.join(directory, filename);
  for (let index = 2; fs.existsSync(candidate); index += 1) {
    candidate = path.join(directory, `${stem}-${index}${ext}`);
  }
  return candidate;
}

function categoryFor(file = {}) {
  const hint = String(file.categoryHint || '').trim().toLowerCase();
  if (hint === 'context') return 'context';
  const mime = String(file.mime || file.type || '').trim().toLowerCase();
  const ext = path.extname(String(file.name || '')).toLowerCase();
  if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return 'images';
  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (mime.includes('word') || mime.includes('document') || ['.doc', '.docx', '.rtf', '.odt'].includes(ext)) return 'documents';
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('rar') || ['.zip', '.tar', '.gz', '.tgz', '.rar', '.7z'].includes(ext)) return 'archives';
  if (mime.startsWith('text/') || ['.txt', '.md', '.markdown', '.csv', '.json', '.yaml', '.yml', '.log'].includes(ext)) return 'text';
  return 'other';
}

export function storeUserFiles(projectRoot, payload = {}) {
  const root = canonicalRoot(projectRoot);
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (files.length > USER_FILES_MAX_COUNT) {
    throw new WorkspaceStoreError(`User file count limit exceeded: ${files.length} > ${USER_FILES_MAX_COUNT}`, {
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
  }
  let totalBytes = 0;
  const stored = files.map((file, index) => {
    const category = categoryFor(file);
    const name = safeFileName(file?.name, index);
    const content = decodeContent(file?.contentBase64);
    totalBytes += content.length;
    if (content.length > USER_FILES_MAX_FILE_BYTES) {
      throw new WorkspaceStoreError(`User file too large: ${name}`, {
        statusCode: 413,
        code: 'PAYLOAD_TOO_LARGE',
      });
    }
    if (totalBytes > USER_FILES_MAX_TOTAL_BYTES) {
      throw new WorkspaceStoreError('User files aggregate size limit exceeded', {
        statusCode: 413,
        code: 'PAYLOAD_TOO_LARGE',
      });
    }
    const dir = path.join(root, 'Harness', 'user-files', category);
    fs.mkdirSync(dir, { recursive: true });
    const absolutePath = uniquePath(dir, name);
    fs.writeFileSync(absolutePath, content);
    const relPath = toWorkspaceRel(root, absolutePath);
    return {
      name: path.basename(absolutePath),
      category,
      path: relPath,
      mime: String(file?.mime || file?.type || ''),
      size: content.length,
      absolutePath,
      terminalTag: `@file(${relPath})`,
    };
  });
  return { ok: true, source: String(payload.source || ''), files: stored };
}

function tagFor(kind, relPath) {
  return kind === 'workspace-folder' ? `@folder(${relPath})` : `@file(${relPath})`;
}

function terminalItemText(projectRoot, item, shiftKey) {
  const resolved = requireExisting(projectRoot, item?.path || '');
  const stat = statExistingInside(projectRoot, resolved.absolutePath);
  const kind = String(item?.kind || '').trim();
  if (kind === 'workspace-file' && !stat.isFile()) {
    throw new WorkspaceStoreError(`Path is not a file: ${resolved.path}`);
  }
  if (kind === 'workspace-folder' && !stat.isDirectory()) {
    throw new WorkspaceStoreError(`Path is not a folder: ${resolved.path}`);
  }
  const absolute = shiftKey || item?.format === 'absolute-path';
  if (absolute) return resolved.absolutePath;
  if (item?.format === 'relative-path') return resolved.path;
  return tagFor(kind, resolved.path);
}

export function buildTerminalContextInput(projectRoot, payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const shiftKey = Boolean(payload.shiftKey);
  const terminalInput = items.map((item) => terminalItemText(projectRoot, item, shiftKey)).join(' ');
  return {
    ok: true,
    terminalInput,
  };
}
