import {
  ComponentNodeError,
  acquireLock as acquireComponentLock,
  assertRevision,
  getComponentNode,
  isLocked,
  listComponentNodes,
  releaseLock as releaseComponentLock,
  updateComponentNode,
} from '../component-node-store.mjs'

function rethrow(error) {
  if (error instanceof ComponentNodeError) throw error
  throw new ComponentNodeError(error.message, {
    statusCode: error.statusCode,
    code: error.code,
  })
}

function requireMarkdownNode(current) {
  if (current.state.type !== 'markdown') {
    throw new ComponentNodeError(`Node is not a markdown node: ${current.node.nodeId}`, {
      statusCode: 409,
      code: 'TYPE_MISMATCH',
    })
  }
  return current.state.markdown
}

function persistMarkdown(projectRoot, current, markdown) {
  const updated = updateComponentNode(projectRoot, current.node.nodeId, {
    revision: current.node.revision,
    markdown,
  })
  return { markdown: updated.state.markdown, revision: updated.node.revision }
}

// Guard for guarded writes (patch/append/replace): a live lock held by another
// holder is mandatory exclusion while held (F18/D15) — the write is refused
// with a markdown_locked error EVEN IF no expectedRevision is supplied. When
// no lock exists, lockless writes stay compatible and the revision guard
// (markdown_conflict) applies unchanged. The error carries holder/expiresAt
// (+ currentRevision/expectedRevision when supplied) so the agent can reread
// and retry.
function assertWriteAllowed(current, payload = {}, projectRoot = null) {
  const expectedRevision = payload.expectedRevision
  const lock = isLocked(current.node.nodeId, undefined, { projectRoot })
  if (lock) {
    const declaredLockId = payload.lockId !== undefined && payload.lockId !== null ? String(payload.lockId).trim() : ''
    const declaredOwner = String(payload.lockOwner || '').trim()
    const holdsLock = (declaredLockId !== '' && declaredLockId === lock.lockId)
      || (declaredLockId === '' && declaredOwner !== '' && declaredOwner === lock.holder)
    if (!holdsLock) {
      const error = new ComponentNodeError(
        `Markdown node is locked by ${lock.holder}. Reread, merge your changes, and retry.`,
        { statusCode: 409, code: 'markdown_locked' },
      )
      error.currentRevision = current.node.revision
      error.expectedRevision = expectedRevision === undefined || expectedRevision === null
        ? current.node.revision
        : Number(expectedRevision)
      error.holder = lock.holder
      error.expiresAt = lock.expiresAt
      throw error
    }
  }
  const stale = assertRevision(current.node.revision, expectedRevision)
  if (stale) throw stale
}

function boundedOffset(value, length) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ComponentNodeError('Markdown patch offset must be a non-negative number')
  }
  return Math.min(Math.floor(parsed), length)
}

export function read(nodeId, projectRoot) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const markdown = requireMarkdownNode(current)
    return {
      markdown,
      revision: current.node.revision,
      title: current.node.title,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function patch(nodeId, projectRoot, { diff, expectedRevision, lockId, lockOwner } = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const markdown = requireMarkdownNode(current)
    assertWriteAllowed(current, { expectedRevision, lockId, lockOwner }, projectRoot)
    const op = String(diff?.op || 'append').trim()
    const text = String(diff?.text ?? '')
    let next
    if (op === 'append') {
      next = markdown + text
    } else if (op === 'insert') {
      const offset = boundedOffset(diff?.offset, markdown.length)
      next = markdown.slice(0, offset) + text + markdown.slice(offset)
    } else if (op === 'replace') {
      const offset = boundedOffset(diff?.offset, markdown.length)
      const length = Number(diff?.length)
      const count = Number.isFinite(length) && length >= 0
        ? Math.min(Math.floor(length), markdown.length - offset)
        : 0
      next = markdown.slice(0, offset) + text + markdown.slice(offset + count)
    } else {
      throw new ComponentNodeError(`Unsupported markdown patch op: ${op}; expected append, insert, or replace`)
    }
    return persistMarkdown(projectRoot, current, next)
  } catch (error) {
    rethrow(error)
  }
}

export function replace(nodeId, projectRoot, { markdown, expectedRevision, lockId, lockOwner } = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    requireMarkdownNode(current)
    assertWriteAllowed(current, { expectedRevision, lockId, lockOwner }, projectRoot)
    return persistMarkdown(projectRoot, current, String(markdown ?? ''))
  } catch (error) {
    rethrow(error)
  }
}

export function append(nodeId, projectRoot, { markdown, expectedRevision, lockId, lockOwner } = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const currentMarkdown = requireMarkdownNode(current)
    assertWriteAllowed(current, { expectedRevision, lockId, lockOwner }, projectRoot)
    return persistMarkdown(projectRoot, current, currentMarkdown + String(markdown ?? ''))
  } catch (error) {
    rethrow(error)
  }
}

// Find markdown nodes by nodeId (exact) or title (case-insensitive substring).
// Returns metadata only (nodeId, title, revision, stateRef) — never content.
export function find(nodeId, projectRoot, payload = {}) {
  try {
    const targetNodeId = String(payload.nodeId || '').trim()
    const title = String(payload.title || '').trim()
    const matches = listComponentNodes(projectRoot)
      .filter(node => node.type === 'markdown')
      .filter(node => !targetNodeId || node.nodeId === targetNodeId)
      .filter(node => !title || node.title.toLowerCase().includes(title.toLowerCase()))
      .map(node => ({ nodeId: node.nodeId, title: node.title, revision: node.revision, stateRef: node.stateRef }))
    return { matches, count: matches.length }
  } catch (error) {
    rethrow(error)
  }
}

// Acquire (or renew) a write lease. Payload: { lockOwner, ttlSeconds = 30 (max
// 300), lockId? (renewal) }. Unexpired foreign locks -> markdown_locked error
// carrying holder + expiresAt.
export function acquireLock(nodeId, projectRoot, payload = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    requireMarkdownNode(current)
    const owner = String(payload.lockOwner || '').trim()
    if (!owner) {
      throw new ComponentNodeError('markdown.acquireLock requires lockOwner', {
        statusCode: 400,
        code: 'BAD_REQUEST',
      })
    }
    const ttlSeconds = payload.ttlSeconds === undefined ? 30 : Number(payload.ttlSeconds)
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new ComponentNodeError('markdown.acquireLock ttlSeconds must be a positive number', {
        statusCode: 400,
        code: 'BAD_REQUEST',
      })
    }
    const ttlMs = Math.min(Math.floor(ttlSeconds * 1000), 300000)
    // F18/D15: the lease is persisted into the node's backend-owned state file
    // (projectRoot), so restarts keep it; TTL expiry is honored on read.
    const lock = acquireComponentLock(current.node.nodeId, owner, ttlMs, { lockId: payload.lockId, projectRoot })
    return {
      lockId: lock.lockId,
      owner: lock.holder,
      acquiredAt: lock.acquiredAt,
      expiresAt: lock.expiresAt,
      revision: current.node.revision,
    }
  } catch (error) {
    rethrow(error)
  }
}

// Release a lease; only the holder may release (release by a non-holder is a
// markdown_locked error). Missing/expired leases are a no-op.
export function releaseLock(nodeId, projectRoot, payload = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    requireMarkdownNode(current)
    const owner = String(payload.lockOwner || '').trim()
    if (!owner) {
      throw new ComponentNodeError('markdown.releaseLock requires lockOwner', {
        statusCode: 400,
        code: 'BAD_REQUEST',
      })
    }
    const result = releaseComponentLock(current.node.nodeId, owner, { lockId: payload.lockId, projectRoot })
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

export function save(nodeId, projectRoot, { markdown } = {}) {
  return replace(nodeId, projectRoot, { markdown })
}
