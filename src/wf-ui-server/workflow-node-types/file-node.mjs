import { ComponentNodeError, getComponentNode, updateComponentNode } from '../component-node-store.mjs'
import { getWorkspaceFileInfo, getWorkspaceMeta, readWorkspaceTextPreview } from '../workspace-store.mjs'

function rethrow(error) {
  if (error instanceof ComponentNodeError) throw error
  throw new ComponentNodeError(error.message, {
    statusCode: error.statusCode,
    code: error.code,
  })
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
