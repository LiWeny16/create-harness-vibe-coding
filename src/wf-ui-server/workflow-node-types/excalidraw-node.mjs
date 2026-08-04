import { ComponentNodeError, getComponentNode, updateComponentNode } from '../component-node-store.mjs'

function rethrow(error) {
  if (error instanceof ComponentNodeError) throw error
  throw new ComponentNodeError(error.message, {
    statusCode: error.statusCode,
    code: error.code,
  })
}

function requireSceneState(current) {
  if (current.state.type !== 'excalidraw') {
    throw new ComponentNodeError(`Node is not an excalidraw node: ${current.node.nodeId}`, {
      statusCode: 409,
      code: 'TYPE_MISMATCH',
    })
  }
  const scene = current.state.scene
  if (scene === null || typeof scene !== 'object' || Array.isArray(scene)) {
    throw new ComponentNodeError(`Node has an invalid scene: ${current.node.nodeId}`)
  }
  return scene
}

function persistScene(projectRoot, current, scene) {
  const updated = updateComponentNode(projectRoot, current.node.nodeId, {
    revision: current.node.revision,
    scene,
  })
  return { scene: updated.state.scene, revision: updated.node.revision }
}

export function readScene(nodeId, projectRoot) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const scene = requireSceneState(current)
    return {
      scene,
      revision: current.node.revision,
      title: current.node.title,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function patchScene(nodeId, projectRoot, { patch } = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const scene = requireSceneState(current)
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new ComponentNodeError('Scene patch must be a plain object')
    }
    return persistScene(projectRoot, current, { ...scene, ...patch })
  } catch (error) {
    rethrow(error)
  }
}

export function saveScene(nodeId, projectRoot, { scene } = {}) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    requireSceneState(current)
    if (scene === null || typeof scene !== 'object' || Array.isArray(scene)) {
      throw new ComponentNodeError('Scene must be an object with elements, appState, and files')
    }
    const providedElements = Array.isArray(scene.elements) ? scene.elements : []
    const result = persistScene(projectRoot, current, scene)
    const storedElements = Array.isArray(result.scene.elements) ? result.scene.elements : []
    if (providedElements.length > 0 && storedElements.length === 0) {
      throw new ComponentNodeError('Scene save failed: provided elements were not persisted')
    }
    return result
  } catch (error) {
    rethrow(error)
  }
}

export function renderPreview(nodeId, projectRoot) {
  try {
    const current = getComponentNode(projectRoot, nodeId)
    const scene = requireSceneState(current)
    const elements = Array.isArray(scene.elements) ? scene.elements : []

    // Compute bounding box
    if (elements.length === 0) {
      return {
        preview: {
          elements: [],
          elementCount: 0,
          hasContent: false,
          bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
          viewport: { x: 0, y: 0, width: 300, height: 240, scale: 1 },
        },
      }
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const el of elements) {
      const x = Number(el.x) || 0
      const y = Number(el.y) || 0
      const w = Number(el.width) || 50
      const h = Number(el.height) || 50
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x + w > maxX) maxX = x + w
      if (y + h > maxY) maxY = y + h
    }

    const boundsWidth = Math.max(maxX - minX, 1)
    const boundsHeight = Math.max(maxY - minY, 1)

    // Target preview size
    const viewW = 300
    const viewH = 240
    const padding = 16

    // Scale to fit
    const scaleX = (viewW - padding * 2) / boundsWidth
    const scaleY = (viewH - padding * 2) / boundsHeight
    const scale = Math.min(scaleX, scaleY, 2) // cap at 2x

    // Normalize elements to viewport coordinates
    const normalized = elements.map(el => ({
      ...el,
      x: (el.x - minX) * scale + padding,
      y: (el.y - minY) * scale + padding,
      width: el.width * scale,
      height: el.height * scale,
    }))

    return {
      preview: {
        ...scene,
        elements: normalized,
        elementCount: elements.length,
        hasContent: true,
        bounds: { minX, minY, maxX, maxY, width: boundsWidth, height: boundsHeight },
        viewport: { x: 0, y: 0, width: viewW, height: viewH, scale },
      },
    }
  } catch (error) {
    rethrow(error)
  }
}
