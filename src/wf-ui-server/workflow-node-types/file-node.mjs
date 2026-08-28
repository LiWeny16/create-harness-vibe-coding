import {
  acquireLock as acquireComponentLock,
  ComponentNodeError,
  getComponentNode,
  isLocked,
  releaseLock as releaseComponentLock,
  updateComponentNode,
} from '../component-node-store.mjs'
import fs from 'node:fs'
import path from 'node:path'
import * as formatAdapters from '../file-format-adapters.mjs'
import {
  applyWorkspaceOperation,
  getWorkspaceFileInfo,
  getWorkspaceMeta,
  readWorkspaceTextPreview,
  resolveWorkspacePath,
  WORKSPACE_TEXT_PREVIEW_MAX_BYTES,
} from '../workspace-store.mjs'

function rethrow(error) {
  if (error instanceof ComponentNodeError) throw error
  throw new ComponentNodeError(error.message, {
    statusCode: error.statusCode,
    code: error.code,
  })
}

// AC-2/W4F-M1: the same lock gate file.writeText applies before disk writes.
// A live lease held by anyone else than `holder` refuses the action with 409
// file_locked; expired leases are reclaimed by isLocked and never block.
function assertNotLockedByOther(nodeId, projectRoot, holder) {
  const lock = isLocked(nodeId, Date.now(), { projectRoot })
  if (lock && String(lock.holder || '') !== String(holder || '').trim()) {
    const err = new ComponentNodeError(
      `File node is locked by ${lock.holder} until ${new Date(lock.expiresAt).toISOString()}`,
      { statusCode: 409, code: 'file_locked' },
    )
    err.holder = lock.holder
    err.expiresAt = lock.expiresAt
    throw err
  }
}

function realpathOrNull(absolutePath) {
  try {
    return fs.realpathSync.native(absolutePath)
  } catch {
    return null
  }
}

// W4F-M1: lightweight version of workspace-store's assertParentInsideWorkspace
// (not exported there): the nearest existing ancestor of the target directory
// is realpath'd and must stay inside the workspace realpath, so a symlink or
// junction pointing outside cannot turn an extract into a write-anywhere.
function assertExtractDirInsideWorkspace(projectRoot, absoluteDir) {
  const root = path.resolve(projectRoot)
  const realRoot = realpathOrNull(root) || root
  let ancestor = path.resolve(absoluteDir)
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) return
    ancestor = parent
  }
  const realAncestor = realpathOrNull(ancestor)
  if (!realAncestor) return
  const relative = path.relative(realRoot, realAncestor)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return
  throw new ComponentNodeError(
    'Extract destination resolves outside the workspace (symlink/junction escape)',
    { statusCode: 400, code: 'ZIP_SLIP' },
  )
}

function requireFileNode(current) {
  if (current.state.type !== 'file') {
    throw new ComponentNodeError(`Node is not a file node: ${current.node.nodeId}`, {
      statusCode: 409,
      code: 'TYPE_MISMATCH',
    })
  }
  if (!current.state.file || !current.state.file.path) {
    throw new ComponentNodeError(`File node has no file reference: ${current.node.nodeId}`)
  }
  return current.state.file
}

export function readMeta(nodeId, projectRoot) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    const meta = getWorkspaceMeta(projectRoot, file.path)
    return {
      file: {
        source: file.source,
        path: meta.path,
        name: meta.name,
        mime: meta.mime || file.mime,
        size: meta.exists ? meta.size : file.size,
        exists: meta.exists,
        stale: !meta.exists,
      },
    }
  } catch (error) {
    rethrow(error)
  }
}

export function readText(nodeId, projectRoot, { offset, limit } = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    const result = readWorkspaceTextPreview(projectRoot, { path: file.path, offset, limit })
    return {
      text: result.text,
      bytesRead: result.bytesRead,
      truncated: result.truncated,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function readBytes(nodeId, projectRoot) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    const info = getWorkspaceFileInfo(projectRoot, file.path)
    return {
      file: {
        path: info.path,
        name: info.name,
        mime: info.mime,
        size: info.size,
        etag: info.etag,
      },
      note: 'Byte-range reads are served by GET /api/workspace/file; this adapter returns metadata only',
    }
  } catch (error) {
    rethrow(error)
  }
}

export function refresh(nodeId, projectRoot) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    const meta = getWorkspaceMeta(projectRoot, file.path)
    const refreshed = {
      source: file.source,
      kind: file.kind,
      path: file.path,
      name: meta.name || file.name,
      mime: meta.mime || file.mime,
      size: meta.exists ? meta.size : 0,
    }
    const updated = updateComponentNode(projectRoot, current.node.nodeId, {
      revision: current.node.revision,
      file: refreshed,
    })
    return {
      file: {
        ...updated.state.file,
        exists: meta.exists,
        stale: !meta.exists,
        mtime: meta.mtime,
        etag: meta.etag,
      },
    }
  } catch (error) {
    rethrow(error)
  }
}

/**
 * Write UTF-8 text content to the file bound to this node.
 * Routes through applyWorkspaceOperation({op:'write'}) so the existing
 * workspace boundary checks (traversal/symlink-escape/realpath) and the
 * workspace-ops.jsonl undo log are reused. Returns to caller the absolute
 * workspace-relative path, byte count, mtime, and the new workspace op revision.
 */
export function writeText(nodeId, projectRoot, { content, offset, holder } = {}) {
  try {
    if (offset !== undefined && offset !== null && offset !== 0) {
      throw new ComponentNodeError('file.writeText currently supports only full-file writes (offset must be 0 or omitted)', {
        statusCode: 400,
        code: 'BAD_REQUEST',
      })
    }
    if (typeof content !== 'string') {
      throw new ComponentNodeError('file.writeText requires string content', {
        statusCode: 400,
        code: 'BAD_REQUEST',
      })
    }
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    // AC-2: a live lease held by someone else (caller may claim identity via
    // `holder`) refuses the write before it touches the disk. Expired leases
    // are reclaimed by isLocked and never block.
    const lock = isLocked(nodeId, Date.now(), { projectRoot })
    if (lock && String(lock.holder || '') !== String(holder || '').trim()) {
      const err = new ComponentNodeError(
        `File node is locked by ${lock.holder} until ${new Date(lock.expiresAt).toISOString()}`,
        { statusCode: 409, code: 'file_locked' },
      )
      err.holder = lock.holder
      err.expiresAt = lock.expiresAt
      throw err
    }
    // Defense-in-depth: re-validate the node-bound path through the workspace
    // boundary before delegating to applyWorkspaceOperation. This catches any
    // future drift in node state and keeps the boundary check explicit at the
    // action entry point.
    resolveWorkspacePath(projectRoot, file.path)
    const contentBase64 = Buffer.from(content, 'utf8').toString('base64')
    const op = applyWorkspaceOperation(projectRoot, {
      op: 'write',
      target: file.path,
      contentBase64,
    })
    const meta = getWorkspaceMeta(projectRoot, file.path)
    return {
      ok: true,
      path: file.path,
      bytes: Buffer.byteLength(content, 'utf8'),
      mtime: meta.mtime,
      revision: op.revision,
      opId: op.opId,
    }
  } catch (error) {
    rethrow(error)
  }
}

/**
 * Single-call preview metadata for the bound file. Returns previewKind
 * (image|video|pdf|text|missing|none), mime, size, exists flag, and for
 * text-like files a bounded UTF-8 textSnippet.
 */
export function preview(nodeId, projectRoot) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    const meta = getWorkspaceMeta(projectRoot, file.path)
    const result = {
      ok: true,
      path: file.path,
      previewKind: meta.previewKind,
      mime: meta.mime || file.mime,
      size: meta.exists ? meta.size : Number(file.size || 0),
      meta,
      available: Boolean(meta.exists),
    }
    if (meta.exists && meta.previewKind === 'text') {
      try {
        const textResult = readWorkspaceTextPreview(projectRoot, {
          path: file.path,
          limit: WORKSPACE_TEXT_PREVIEW_MAX_BYTES,
        })
        result.textSnippet = textResult.text
        result.textTruncated = textResult.truncated
      } catch {
        // Snippet extraction must never break preview metadata.
      }
    }
    return result
  } catch (error) {
    rethrow(error)
  }
}

// ── Lock lease actions (AC-2) ──────────────────────────────────────────────
// file.acquireLock / file.releaseLock reuse the component-node-store lease
// registry: persisted into the node's backend-owned state file (restart-safe),
// TTL-expiring, stale-lock reclaimed on read. file.writeText refuses writes
// under a foreign lease with 409 file_locked (see writeText above).

export async function acquireLock(nodeId, projectRoot, payload = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    requireFileNode(current)
    const holder = String(payload.holder || '').trim()
    if (!holder) {
      throw new ComponentNodeError('file.acquireLock requires holder', {
        statusCode: 400,
        code: 'BAD_REQUEST',
      })
    }
    const ttlMs = payload.ttlMs === undefined ? 30000 : Number(payload.ttlMs)
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new ComponentNodeError('file.acquireLock ttlMs must be a positive number', {
        statusCode: 400,
        code: 'BAD_REQUEST',
      })
    }
    const lock = acquireComponentLock(current.node.nodeId, holder, ttlMs, {
      lockId: payload.lockId,
      projectRoot,
    })
    return {
      lockId: lock.lockId,
      holder: lock.holder,
      acquiredAt: lock.acquiredAt,
      expiresAt: lock.expiresAt,
    }
  } catch (error) {
    rethrow(error)
  }
}

export async function releaseLock(nodeId, projectRoot, payload = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    requireFileNode(current)
    const holder = String(payload.holder || '').trim()
    if (!holder) {
      throw new ComponentNodeError('file.releaseLock requires holder', {
        statusCode: 400,
        code: 'BAD_REQUEST',
      })
    }
    const result = releaseComponentLock(current.node.nodeId, holder, {
      lockId: payload.lockId,
      projectRoot,
    })
    return {
      ok: true,
      released: result.released,
      nodeId: current.node.nodeId,
      lockId: result.lockId,
    }
  } catch (error) {
    rethrow(error)
  }
}

// ── Format adapters (AC-5 Excel, AC-6 PDF, AC-7 ZIP) ───────────────────────
// File path is resolved from node state.file.path the same way readMeta
// resolves it (requireFileNode + resolveWorkspacePath), so the workspace
// boundary (traversal/symlink-escape) is re-validated at every action entry
// point. All parsing is async and delegated to file-format-adapters.mjs.

export async function readXlsx(nodeId, projectRoot, payload = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    const absPath = resolveWorkspacePath(projectRoot, file.path).absolutePath
    return await formatAdapters.readXlsxSheets(absPath, { maxBytes: payload.maxBytes })
  } catch (error) {
    rethrow(error)
  }
}

export async function readXlsxSheet(nodeId, projectRoot, payload = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    const absPath = resolveWorkspacePath(projectRoot, file.path).absolutePath
    const result = await formatAdapters.readXlsxSheet(absPath, {
      sheet: payload.sheet,
      page: payload.page,
      pageSize: payload.pageSize,
      maxBytes: payload.maxBytes,
    })
    // The adapter keeps the column header as rows[0] on every page; split it
    // out so callers get headers + data rows separately.
    return {
      sheet: result.sheet,
      headers: Array.isArray(result.rows) && result.rows.length > 0 ? result.rows[0] : [],
      rows: Array.isArray(result.rows) ? result.rows.slice(1) : [],
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    }
  } catch (error) {
    rethrow(error)
  }
}

export async function readPdf(nodeId, projectRoot, payload = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    const absPath = resolveWorkspacePath(projectRoot, file.path).absolutePath
    const info = await formatAdapters.readPdfInfo(absPath, { maxBytes: payload.maxBytes })
    return { totalPages: info.pages, metadata: info.meta }
  } catch (error) {
    rethrow(error)
  }
}

export async function readPdfPage(nodeId, projectRoot, payload = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    const absPath = resolveWorkspacePath(projectRoot, file.path).absolutePath
    return await formatAdapters.readPdfPageText(absPath, {
      page: payload.page,
      pageCount: payload.pageCount,
      maxBytes: payload.maxBytes,
    })
  } catch (error) {
    rethrow(error)
  }
}

export async function readZipEntries(nodeId, projectRoot, payload = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    const absPath = resolveWorkspacePath(projectRoot, file.path).absolutePath
    const result = await formatAdapters.readZipEntries(absPath, { maxEntries: payload.maxEntries })
    return result.entries
  } catch (error) {
    rethrow(error)
  }
}

export async function readZipEntry(nodeId, projectRoot, payload = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    const absPath = resolveWorkspacePath(projectRoot, file.path).absolutePath
    return await formatAdapters.readZipEntryText(absPath, payload.entryName, {
      maxBytes: payload.maxBytes,
    })
  } catch (error) {
    rethrow(error)
  }
}

export async function extractZipEntry(nodeId, projectRoot, payload = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const file = requireFileNode(current)
    const absPath = resolveWorkspacePath(projectRoot, file.path).absolutePath
    const entryName = String(payload.entryName || '').trim()
    if (!entryName) {
      throw new ComponentNodeError('file.extractZipEntry requires entryName', {
        statusCode: 400,
        code: 'BAD_REQUEST',
      })
    }
    // W4F-M1: same lock gate as file.writeText — an extract writes to disk,
    // so a live foreign lease refuses it with 409 file_locked before any
    // byte lands.
    assertNotLockedByOther(nodeId, projectRoot, payload.holder)
    // destDir defaults to a workspace-controlled extract directory scoped to
    // the node; caller-supplied destDir is resolved through the workspace
    // boundary (escapes are rejected before any write).
    const rawDestDir = payload.destDir !== undefined && payload.destDir !== null && String(payload.destDir).trim()
      ? String(payload.destDir).trim()
      : `Harness/a2a/file-extracts/${current.node.nodeId}`
    const resolved = resolveWorkspacePath(projectRoot, rawDestDir)
    // W4F-M1: the final target basename is re-validated through the workspace
    // segment rules (trailing dot/space, Windows reserved names) — reuse of
    // workspace-store's validateWorkspaceRelPath via resolveWorkspacePath.
    const targetRel = path.join(resolved.path, path.basename(entryName)).replace(/\\/g, '/')
    resolveWorkspacePath(projectRoot, targetRel)
    // W4F-M1: realpath boundary — the nearest existing ancestor of the
    // destination must resolve inside the workspace realpath, so a symlinked
    // destDir cannot escape the workspace after the path-level check passed.
    assertExtractDirInsideWorkspace(projectRoot, resolved.absolutePath)
    const result = await formatAdapters.extractZipEntry(absPath, entryName, resolved.absolutePath, {
      maxBytes: payload.maxBytes,
    })
    // Undo note (documented limitation): extraction does NOT participate in
    // the workspace-ops.jsonl undo log — workspace-store exports no
    // append-undo-row helper, so there is no inverse to replay. Callers that
    // need undoability must re-extract or delete the produced file explicitly.
    return {
      ok: true,
      path: path.join(resolved.path, path.basename(entryName)).replace(/\\/g, '/'),
      bytes: result.bytes,
      entryName,
    }
  } catch (error) {
    rethrow(error)
  }
}

export const meta = readMeta;
