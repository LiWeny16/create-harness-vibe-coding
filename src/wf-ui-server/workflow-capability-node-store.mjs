import crypto from 'node:crypto';
import {
  appendStoreJsonl,
  isPlainObject,
  nodeRevisionLogPath,
  nodeStatePath,
  nodeStateRelPath,
  nodeStoreIndexPath,
  normalizePosition,
  readNodeIndex,
  readStoreJson,
  slugPart,
  writeNodeIndex,
  writeStoreJson,
} from './node-store-utils.mjs';

const CAPABILITY_TYPES = new Set(['skill-group', 'mcp-connector']);
const NODE_ID_RE = /^capability-[a-z0-9][a-z0-9-]*$/;
const STORE_DIR = 'capability-nodes';

export class CapabilityNodeError extends Error {
  constructor(message, { statusCode = 400, code = 'BAD_REQUEST' } = {}) {
    super(message);
    this.name = 'CapabilityNodeError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function capabilityNodesIndexPath(projectRoot) {
  return nodeStoreIndexPath(projectRoot, STORE_DIR);
}

function normalizeType(type) {
  const value = String(type || '').trim().toLowerCase();
  if (!CAPABILITY_TYPES.has(value)) {
    throw new CapabilityNodeError('Invalid capability node type; expected skill-group or mcp-connector');
  }
  return value;
}

function generateNodeId(type, title) {
  return `capability-${slugPart(title, type)}-${crypto.randomBytes(3).toString('hex')}`;
}

function assertNodeId(nodeId) {
  const value = String(nodeId || '').trim();
  if (!NODE_ID_RE.test(value)) {
    throw new CapabilityNodeError('Invalid capability node id; traversal and escaped ids are not allowed');
  }
  return value;
}

function normalizeNodeId(nodeId, type, title) {
  return assertNodeId(nodeId || generateNodeId(type, title));
}

function normalizeTitle(title, type) {
  const value = String(title || '').trim();
  if (value) return value;
  if (type === 'skill-group') return 'Skill Group';
  if (type === 'mcp-connector') return 'MCP Connector';
  return 'Capability Node';
}

function normalizeDescription(description) {
  return String(description || '').trim().slice(0, 280);
}

function normalizePrompt(value) {
  return String(value || '').trim().slice(0, 280);
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map(item => String(item || '').trim()).filter(Boolean))]
    .map(item => item.slice(0, 48))
    .slice(0, 16);
}

function normalizeCategory(value) {
  return String(value || 'skills').trim().slice(0, 80) || 'skills';
}

function normalizeLockRef(value) {
  return String(value || '').trim().replace(/\\/g, '/').slice(0, 220);
}

function normalizeLoadStrategy(value) {
  const text = String(value || 'group-summary').trim().toLowerCase();
  return ['group-summary', 'names-only', 'manual'].includes(text) ? text : 'group-summary';
}

function relStatePath(nodeId) {
  return nodeStateRelPath(STORE_DIR, nodeId);
}

function absoluteStatePath(projectRoot, statePath, nodeId) {
  return nodeStatePath(projectRoot, {
    storeDir: STORE_DIR,
    statePath,
    nodeId,
    ErrorClass: CapabilityNodeError,
    label: 'capability node',
    rootLabel: 'capability',
  });
}

function normalizeSkill(raw) {
  const source = isPlainObject(raw) ? raw : { name: raw };
  const id = String(source.id || source.skillId || source.name || '').trim();
  const name = String(source.name || id.replace(/^skill:/, '')).trim();
  if (!id && !name) return null;
  const skillId = id || `skill:${name}`;
  return {
    id: skillId,
    name,
    title: String(source.title || name || skillId).trim().slice(0, 120),
    source: String(source.source || source.attachment || 'skills-hub').trim() || 'skills-hub',
    state: String(source.state || 'indexed').trim() || 'indexed',
    enabled: source.enabled === false ? false : true,
  };
}

function normalizeSkills(value) {
  const seen = new Set();
  const skills = [];
  for (const item of Array.isArray(value) ? value : []) {
    const skill = normalizeSkill(item);
    if (!skill) continue;
    const key = skill.name || skill.id;
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push(skill);
  }
  return skills.slice(0, 64);
}

function normalizeSourceGroup(value) {
  const source = isPlainObject(value) ? value : {};
  const id = String(source.id || '').trim().slice(0, 120);
  const label = String(source.label || source.title || '').trim().slice(0, 160);
  const kind = String(source.kind || 'skills-hub-group').trim().slice(0, 80);
  return { id, label, kind };
}

function normalizeInstallSource(value) {
  const source = isPlainObject(value) ? value : {};
  const signature = isPlainObject(source.signature) ? source.signature : {};
  const lockfileSignature = isPlainObject(source.lockfileSignature) ? source.lockfileSignature : {};
  return {
    provider: String(source.provider || '').trim().slice(0, 80),
    providerLabel: String(source.providerLabel || source.provider || '').trim().slice(0, 120),
    packSlug: String(source.packSlug || '').trim().slice(0, 120),
    packName: String(source.packName || source.name || '').trim().slice(0, 160),
    version: String(source.version || '').trim().slice(0, 80),
    targetScope: String(source.targetScope || '').trim().slice(0, 80),
    targetRuntime: String(source.targetRuntime || '').trim().slice(0, 80),
    installedAt: String(source.installedAt || '').trim().slice(0, 80),
    detailUrl: redactUrl(source.detailUrl || ''),
    manifestUrl: redactUrl(source.manifestUrl || ''),
    lockfileUrl: redactUrl(source.lockfileUrl || ''),
    signature: {
      present: Boolean(signature.present),
      verified: Boolean(signature.verified),
      algorithm: String(signature.algorithm || '').trim().slice(0, 40),
      keyId: String(signature.keyId || '').trim().slice(0, 80),
      signedAt: String(signature.signedAt || '').trim().slice(0, 80),
    },
    lockfileSignature: {
      present: Boolean(lockfileSignature.present),
      verified: Boolean(lockfileSignature.verified),
      algorithm: String(lockfileSignature.algorithm || '').trim().slice(0, 40),
      keyId: String(lockfileSignature.keyId || '').trim().slice(0, 80),
      signedAt: String(lockfileSignature.signedAt || '').trim().slice(0, 80),
    },
  };
}

function safeBasename(value) {
  const text = String(value || '').replace(/\\/g, '/').trim();
  if (!text) return '';
  return text.split('/').filter(Boolean).pop() || '';
}

function safeDisplayPath(value, fallback = '') {
  const text = String(value || '').replace(/\\/g, '/').trim();
  const fallbackText = String(fallback || '').replace(/\\/g, '/').trim();
  if (!text) return fallbackText.slice(0, 160);
  if (/^[a-zA-Z]:\//.test(text) || text.startsWith('/') || text.includes('..')) {
    return (fallbackText || safeBasename(text)).slice(0, 160);
  }
  return text.slice(0, 160);
}

function redactUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    const segments = url.pathname.split('/');
    url.pathname = segments.map((segment, index) => {
      const previous = String(segments[index - 1] || '').toLowerCase();
      if (/^(token|secret|key|auth|bearer|password|credential|credentials)$/.test(previous)) return 'redacted';
      if (/(token|secret|password|credential)=/i.test(segment)) return 'redacted';
      return segment;
    }).join('/');
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeEnvKeys(server) {
  const keys = new Set();
  if (Array.isArray(server.envKeys)) {
    for (const key of server.envKeys) {
      const text = String(key || '').trim();
      if (text) keys.add(text.slice(0, 120));
    }
  }
  if (isPlainObject(server.env)) {
    for (const key of Object.keys(server.env)) {
      const text = String(key || '').trim();
      if (text) keys.add(text.slice(0, 120));
    }
  }
  return [...keys].sort().slice(0, 64);
}

function normalizeMcpSource(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const relativePath = safeDisplayPath(source.relativePath || safeBasename(source.path), safeBasename(source.path));
  return {
    rootId: String(source.rootId || '').trim().slice(0, 120),
    label: String(source.label || '').trim().slice(0, 160),
    scope: String(source.scope || 'project').trim().slice(0, 80),
    runtime: String(source.runtime || 'mcp').trim().slice(0, 80),
    relativePath,
    path: safeDisplayPath(source.path || relativePath, relativePath),
  };
}

function normalizeMcpServer(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const id = String(source.id || source.name || '').trim().slice(0, 160);
  const name = String(source.name || source.title || id).trim().slice(0, 120);
  if (!id && !name) return null;
  const envKeys = normalizeEnvKeys(source);
  const url = redactUrl(source.url || source.endpoint || '');
  const commandName = safeBasename(source.commandName || source.command);
  const sources = (Array.isArray(source.sources) ? source.sources : [])
    .map(normalizeMcpSource)
    .filter(item => item.rootId || item.path || item.relativePath)
    .slice(0, 8);
  const hadQuery = /[?#]/.test(String(source.url || source.endpoint || ''));
  const secretsRedacted = Boolean(source.risk?.secretsRedacted || envKeys.length > 0 || hadQuery);
  return {
    id: id || `mcp:${slugPart(name, 'server')}`,
    name: name || id,
    title: String(source.title || name || id).trim().slice(0, 160),
    kind: 'mcp-server',
    nodeSemantics: 'agent-attached-mcp-provider',
    attachable: false,
    creatable: true,
    state: String(source.state || 'indexed').trim().slice(0, 80) || 'indexed',
    transport: String(source.transport || 'unknown').trim().toLowerCase().slice(0, 80) || 'unknown',
    commandName: commandName.slice(0, 120),
    argCount: Math.max(0, Math.min(Number(source.argCount || 0) || 0, 999)),
    url,
    envKeys,
    risk: {
      metadataOnly: true,
      commandNotExecuted: true,
      credentialsNotProbed: true,
      secretsRedacted,
    },
    sources,
  };
}

function normalizeMcpServers(value) {
  const rawServers = Array.isArray(value) ? value : (isPlainObject(value) ? [value] : []);
  const seen = new Set();
  const servers = [];
  for (const item of rawServers) {
    const server = normalizeMcpServer(item);
    if (!server) continue;
    const key = server.id || server.name;
    if (seen.has(key)) continue;
    seen.add(key);
    servers.push(server);
  }
  return servers.slice(0, 64);
}

function skillGroupStateFor(type, payload, revision, previous = {}) {
  const skills = payload.skills !== undefined ? normalizeSkills(payload.skills) : normalizeSkills(previous.skills);
  const sourceGroup = payload.sourceGroup !== undefined
    ? normalizeSourceGroup(payload.sourceGroup)
    : normalizeSourceGroup(previous.sourceGroup);
  return {
    type,
    revision,
    description: normalizeDescription(payload.description !== undefined ? payload.description : previous.description),
    prompt: normalizePrompt(payload.prompt !== undefined ? payload.prompt : previous.prompt),
    sourceGroup,
    category: normalizeCategory(payload.category !== undefined ? payload.category : previous.category),
    tags: normalizeTags(payload.tags !== undefined ? payload.tags : previous.tags),
    installSource: normalizeInstallSource(payload.installSource !== undefined ? payload.installSource : previous.installSource),
    lockRef: normalizeLockRef(payload.lockRef !== undefined ? payload.lockRef : previous.lockRef),
    loadStrategy: normalizeLoadStrategy(payload.loadStrategy !== undefined ? payload.loadStrategy : previous.loadStrategy),
    skills,
    skillNames: skills.map(skill => skill.name).filter(Boolean),
    skillCount: skills.length,
    nodeSemantics: {
      role: 'agent-attached-capability-provider',
      defaultConnection: 'bidirectional capability port to Agent nodes',
      executor: 'agent',
    },
  };
}

function mcpConnectorStateFor(type, payload, revision, previous = {}) {
  const sourceServers = payload.servers !== undefined
    ? payload.servers
    : (payload.server !== undefined ? [payload.server] : previous.servers);
  const servers = normalizeMcpServers(sourceServers);
  if (servers.length === 0) {
    throw new CapabilityNodeError('MCP connector requires at least one indexed server metadata record', {
      statusCode: 400,
      code: 'MCP_SERVER_REQUIRED',
    });
  }
  const sourceGroup = payload.sourceGroup !== undefined
    ? normalizeSourceGroup({ kind: 'mcp-hub-group', ...payload.sourceGroup })
    : normalizeSourceGroup({ kind: 'mcp-hub-group', ...previous.sourceGroup });
  const transports = [...new Set(servers.map(server => server.transport).filter(Boolean))].sort();
  const envKeyNames = [...new Set(servers.flatMap(server => server.envKeys || []))].sort();
  const redactedFieldCount = servers.filter(server => server.risk?.secretsRedacted).length;
  return {
    type,
    revision,
    description: normalizeDescription(payload.description !== undefined ? payload.description : previous.description),
    sourceGroup,
    servers,
    serverNames: servers.map(server => server.name).filter(Boolean),
    serverCount: servers.length,
    transports,
    envKeyNames,
    envKeyCount: envKeyNames.length,
    redactedFieldCount,
    nodeSemantics: {
      role: 'agent-attached-mcp-provider',
      defaultConnection: 'bidirectional capability port to Agent nodes',
      executor: 'agent',
      safety: 'metadata-only-no-spawn-no-secret',
    },
  };
}

function stateFor(type, payload, revision, previous = {}) {
  if (type === 'mcp-connector') return mcpConnectorStateFor(type, payload, revision, previous);
  return skillGroupStateFor(type, payload, revision, previous);
}

function nodeFor({ nodeId, type, title, position, revision }) {
  const statePath = relStatePath(nodeId);
  return {
    id: nodeId,
    nodeId,
    kind: 'capability-node',
    type,
    title,
    label: title,
    position,
    revision,
    statePath,
    stateRef: { path: statePath, revision },
    status: 'ready',
    lifecycle: 'capability-provider',
    runtimeState: 'ready',
    config: {
      capabilityType: type,
      backendSourceOfTruth: true,
      executor: 'agent',
    },
  };
}

function readIndex(projectRoot) {
  return readNodeIndex(capabilityNodesIndexPath(projectRoot));
}

function writeIndex(projectRoot, index) {
  writeNodeIndex(capabilityNodesIndexPath(projectRoot), index);
}

function revisionLogPath(projectRoot, nodeId) {
  return nodeRevisionLogPath(projectRoot, { storeDir: STORE_DIR, nodeId, assertNodeId });
}

function revisionRow(action, node, previousRevision = null) {
  return {
    action,
    nodeId: node.nodeId,
    type: node.type,
    revision: node.revision,
    previousRevision,
    statePath: node.statePath,
    recoverable: true,
    createdAt: new Date().toISOString(),
  };
}

function validatedIndexNode(projectRoot, node) {
  const nodeId = assertNodeId(node?.nodeId || node?.id);
  const type = normalizeType(node?.type);
  const revision = Number(node?.revision || 0);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new CapabilityNodeError('Invalid capability node revision');
  }
  absoluteStatePath(projectRoot, node.statePath, nodeId);
  return {
    ...nodeFor({
      nodeId,
      type,
      title: normalizeTitle(node?.title || node?.label, type),
      position: normalizePosition(node?.position),
      revision,
    }),
  };
}

export function createCapabilityNode(projectRoot, payload = {}) {
  const type = normalizeType(payload.type);
  const title = normalizeTitle(payload.title, type);
  const nodeId = normalizeNodeId(payload.nodeId, type, title);
  const index = readIndex(projectRoot);
  if (index.nodes.some(node => (node.nodeId || node.id) === nodeId)) {
    throw new CapabilityNodeError(`Capability node already exists: ${nodeId}`, {
      statusCode: 409,
      code: 'CONFLICT',
    });
  }
  const node = nodeFor({
    nodeId,
    type,
    title,
    position: normalizePosition(payload.position),
    revision: 1,
  });
  const state = stateFor(type, payload, node.revision);
  writeStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), state);
  appendStoreJsonl(revisionLogPath(projectRoot, node.nodeId), revisionRow('create', node));
  writeIndex(projectRoot, { nodes: [...index.nodes, node] });
  return { ok: true, node, state, revision: node.revision };
}

export function getCapabilityNode(projectRoot, nodeId) {
  const key = assertNodeId(decodeURIComponent(String(nodeId || '')));
  const index = readIndex(projectRoot);
  const raw = index.nodes.find(node => (node.nodeId || node.id) === key);
  if (!raw) {
    throw new CapabilityNodeError(`Capability node not found: ${key}`, {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }
  const node = validatedIndexNode(projectRoot, raw);
  const state = readStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), null);
  if (!state || state.type !== node.type || Number(state.revision) !== node.revision) {
    throw new CapabilityNodeError('Capability node state file is missing or out of sync', {
      statusCode: 409,
      code: 'STATE_MISMATCH',
    });
  }
  return { ok: true, node, state, revision: node.revision };
}

export function updateCapabilityNode(projectRoot, nodeId, payload = {}) {
  if (payload && Object.hasOwn(payload, 'statePath')) {
    throw new CapabilityNodeError('statePath is backend-owned and cannot be mutated');
  }
  const current = getCapabilityNode(projectRoot, nodeId);
  const expectedRevision = Number(payload.revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.node.revision) {
    throw new CapabilityNodeError('Stale capability node revision', {
      statusCode: 409,
      code: 'STALE_REVISION',
    });
  }
  const nextRevision = current.node.revision + 1;
  const node = nodeFor({
    nodeId: current.node.nodeId,
    type: current.node.type,
    title: payload.title !== undefined ? normalizeTitle(payload.title, current.node.type) : current.node.title,
    position: payload.position !== undefined ? normalizePosition(payload.position) : current.node.position,
    revision: nextRevision,
  });
  const state = stateFor(current.node.type, payload, nextRevision, current.state);
  writeStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), state);
  appendStoreJsonl(revisionLogPath(projectRoot, node.nodeId), revisionRow('update', node, current.node.revision));
  const index = readIndex(projectRoot);
  writeIndex(projectRoot, {
    nodes: index.nodes.map(item => ((item.nodeId || item.id) === node.nodeId ? node : item)),
  });
  return { ok: true, node, state, revision: node.revision };
}

export function setSkillEnabled(projectRoot, nodeId, skillId, enabled) {
  const key = String(skillId || '').trim();
  if (!key) {
    throw new CapabilityNodeError('skillId is required for skill-group.setSkillEnabled', {
      statusCode: 400,
      code: 'SKILL_ID_REQUIRED',
    });
  }
  const desired = enabled === false ? false : true;
  const current = getCapabilityNode(projectRoot, nodeId);
  if (current.state.type !== 'skill-group') {
    throw new CapabilityNodeError(`Node is not a skill-group node: ${nodeId}`, {
      statusCode: 409,
      code: 'TYPE_MISMATCH',
    });
  }
  const skills = normalizeSkills(current.state.skills || []);
  let matched = false;
  let alreadyAtTarget = false;
  const nextSkills = skills.map(skill => {
    if (skill.id === key || skill.name === key) {
      matched = true;
      if ((skill.enabled !== false) === desired) {
        alreadyAtTarget = true;
      }
      return { ...skill, enabled: desired };
    }
    return skill;
  });
  if (!matched) {
    throw new CapabilityNodeError(`Skill not found in skill group: ${key}`, {
      statusCode: 404,
      code: 'SKILL_NOT_FOUND',
    });
  }
  if (alreadyAtTarget) {
    return {
      nodeId: current.node.nodeId,
      revision: current.node.revision,
      skillId: key,
      enabled: desired,
      skills,
      skillNames: skills.map(skill => skill.name).filter(Boolean),
      skillCount: skills.length,
    };
  }
  const updated = updateCapabilityNode(projectRoot, nodeId, {
    revision: current.node.revision,
    skills: nextSkills,
  });
  return {
    nodeId: updated.node.nodeId,
    revision: updated.node.revision,
    skillId: key,
    enabled: desired,
    skills: updated.state.skills || [],
    skillNames: updated.state.skillNames || [],
    skillCount: Number(updated.state.skillCount || 0),
  };
}

export function deleteCapabilityNode(projectRoot, nodeId) {
  const current = getCapabilityNode(projectRoot, nodeId);
  appendStoreJsonl(revisionLogPath(projectRoot, current.node.nodeId), revisionRow('delete', current.node, current.node.revision));
  const index = readIndex(projectRoot);
  writeIndex(projectRoot, {
    nodes: index.nodes.filter(item => (item.nodeId || item.id) !== current.node.nodeId),
  });
  return { ok: true, nodeId: current.node.nodeId, removed: current.node };
}

export function restoreCapabilityNode(projectRoot, snapshot = {}) {
  const rawNode = snapshot.node || snapshot;
  const nodeId = assertNodeId(rawNode?.nodeId || rawNode?.id);
  const index = readIndex(projectRoot);
  const existing = index.nodes.find(node => (node.nodeId || node.id) === nodeId);
  if (existing) return getCapabilityNode(projectRoot, nodeId);
  const node = validatedIndexNode(projectRoot, { ...rawNode, nodeId });
  const state = snapshot.state || readStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), null);
  if (!state || state.type !== node.type) {
    throw new CapabilityNodeError('Cannot restore capability node without its state', { statusCode: 409, code: 'RESTORE_STATE_MISSING' });
  }
  writeStoreJson(absoluteStatePath(projectRoot, node.statePath, node.nodeId), state);
  appendStoreJsonl(revisionLogPath(projectRoot, node.nodeId), revisionRow('restore', node, node.revision));
  writeIndex(projectRoot, { nodes: [...index.nodes, node] });
  return getCapabilityNode(projectRoot, nodeId);
}

export function listCapabilityNodes(projectRoot) {
  const index = readIndex(projectRoot);
  return index.nodes.map(node => validatedIndexNode(projectRoot, node));
}

export function capabilityStateRefs(projectRoot) {
  const refs = {};
  for (const node of listCapabilityNodes(projectRoot)) {
    const current = getCapabilityNode(projectRoot, node.nodeId);
    const skills = normalizeSkills(current.state.skills || []);
    refs[node.nodeId] = {
      type: node.type,
      capabilityKind: node.type,
      title: node.title,
      statePath: node.statePath,
      revision: node.revision,
      description: current.state.description || '',
      prompt: current.state.prompt || '',
      sourceGroup: current.state.sourceGroup || null,
      category: current.state.category || '',
      tags: current.state.tags || [],
      installSource: current.state.installSource || null,
      lockRef: current.state.lockRef || '',
      loadStrategy: current.state.loadStrategy || 'group-summary',
      skills,
      skillNames: skills.map(skill => skill.name).filter(Boolean),
      skillCount: skills.length,
      servers: current.state.servers || [],
      serverNames: current.state.serverNames || [],
      serverCount: Number(current.state.serverCount || 0),
      transports: current.state.transports || [],
      envKeyNames: current.state.envKeyNames || [],
      envKeyCount: Number(current.state.envKeyCount || 0),
      redactedFieldCount: Number(current.state.redactedFieldCount || 0),
      nodeSemantics: current.state.nodeSemantics,
    };
  }
  return refs;
}

export function capabilityNodeStates(projectRoot) {
  const states = {};
  for (const listedNode of listCapabilityNodes(projectRoot)) {
    const { node, state } = getCapabilityNode(projectRoot, listedNode.nodeId);
    const skills = normalizeSkills(state.skills || []);
    states[node.nodeId] = {
      nodeId: node.nodeId,
      type: node.type,
      title: node.title,
      revision: node.revision,
      description: state.description || '',
      prompt: state.prompt || '',
      sourceGroup: state.sourceGroup || null,
      category: state.category || '',
      tags: state.tags || [],
      installSource: state.installSource || null,
      lockRef: state.lockRef || '',
      loadStrategy: state.loadStrategy || 'group-summary',
      skills,
      skillNames: skills.map(skill => skill.name).filter(Boolean),
      skillCount: skills.length,
      servers: state.servers || [],
      serverNames: state.serverNames || [],
      serverCount: Number(state.serverCount || 0),
      transports: state.transports || [],
      envKeyNames: state.envKeyNames || [],
      envKeyCount: Number(state.envKeyCount || 0),
      redactedFieldCount: Number(state.redactedFieldCount || 0),
      nodeSemantics: state.nodeSemantics,
      statePath: node.statePath,
    };
  }
  return states;
}
