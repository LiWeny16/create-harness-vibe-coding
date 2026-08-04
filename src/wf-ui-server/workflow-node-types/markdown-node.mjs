import { ComponentNodeError, getComponentNode, updateComponentNode } from '../component-node-store.mjs'

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

export function patch(nodeId, projectRoot, { diff } = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const markdown = requireMarkdownNode(current)
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

export function replace(nodeId, projectRoot, { markdown } = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    requireMarkdownNode(current)
    return persistMarkdown(projectRoot, current, String(markdown ?? ''))
  } catch (error) {
    rethrow(error)
  }
}

export function append(nodeId, projectRoot, { markdown } = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const currentMarkdown = requireMarkdownNode(current)
    return persistMarkdown(projectRoot, current, currentMarkdown + String(markdown ?? ''))
  } catch (error) {
    rethrow(error)
  }
}

export function save(nodeId, projectRoot, { markdown } = {}) {
  return replace(nodeId, projectRoot, { markdown })
}
