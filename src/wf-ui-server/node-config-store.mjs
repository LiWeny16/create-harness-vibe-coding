export const NODE_CONFIG_FIELDS = [
  'role',
  'customRole',
  'prompt',
  'model',
  'provider',
  'cwd',
  'env',
  'permissions',
  'launchPolicy',
  'skills',
  'skillPolicy',
  'contextSources',
  'capabilities',
  'outputRouting',
];

const LAUNCH_FIELDS = new Set([
  'role',
  'prompt',
  'model',
  'provider',
  'cwd',
  'env',
  'permissions',
  'launchPolicy',
]);

const ARRAY_FIELDS = new Set(['skills', 'contextSources', 'capabilities']);
const OBJECT_FIELDS = new Set(['env', 'permissions', 'launchPolicy', 'outputRouting']);
const SKILL_POLICIES = new Set(['auto', 'manual', 'locked']);

export class NodeConfigError extends Error {
  constructor(message, { statusCode = 400, code = 'BAD_REQUEST' } = {}) {
    super(message);
    this.name = 'NodeConfigError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalizeObject(value) {
  return isPlainObject(value) ? { ...value } : {};
}

function normalizeScalar(value) {
  return String(value || '').trim();
}

function normalizeSkillPolicy(value, fallback = 'auto') {
  const policy = normalizeScalar(value || fallback);
  return SKILL_POLICIES.has(policy) ? policy : fallback;
}

function normalizeConfigField(key, value, fallback) {
  if (ARRAY_FIELDS.has(key)) return uniqueStrings(value);
  if (OBJECT_FIELDS.has(key)) return normalizeObject(value);
  if (key === 'skillPolicy') return normalizeSkillPolicy(value, fallback || 'auto');
  return normalizeScalar(value);
}

export function defaultNodeConfig(session = {}) {
  return {
    role: normalizeScalar(session.role || 'terminal-agent'),
    customRole: normalizeScalar(session.customRole),
    prompt: normalizeScalar(session.prompt || session.objective || session.ceoPrompt),
    model: normalizeScalar(session.model),
    provider: normalizeScalar(session.provider),
    cwd: normalizeScalar(session.cwd || session.projectRoot),
    env: normalizeObject(session.env),
    permissions: normalizeObject(session.permissions),
    launchPolicy: normalizeObject(session.launchPolicy),
    skills: uniqueStrings(session.skills),
    skillPolicy: normalizeSkillPolicy(session.skillPolicy, 'auto'),
    contextSources: uniqueStrings(session.contextSources || ['workflow-map']),
    capabilities: uniqueStrings(session.capabilities || ['terminal']),
    outputRouting: normalizeObject(session.outputRouting || session.nodeConfig?.outputRouting || {
      markdownDefaultEnabled: false,
      markdownTargetNodeId: '',
      fallback: 'oldest-connected-markdown',
    }),
  };
}

export function normalizeNodeConfig(config = {}, session = {}) {
  const base = defaultNodeConfig(session);
  const source = isPlainObject(config) ? config : {};
  const normalized = {};
  for (const key of NODE_CONFIG_FIELDS) {
    normalized[key] = normalizeConfigField(key, source[key] !== undefined ? source[key] : base[key], base[key]);
  }
  return normalized;
}

export function normalizeNodeConfigPatch(patch = {}, baseConfig = {}) {
  if (!isPlainObject(patch)) {
    throw new NodeConfigError('Node config patch must be an object');
  }
  const normalized = {};
  for (const key of NODE_CONFIG_FIELDS) {
    if (patch[key] === undefined) continue;
    normalized[key] = normalizeConfigField(key, patch[key], baseConfig[key]);
  }
  return normalized;
}

function configValueChanged(a, b) {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

export function changedLaunchFields(previous = {}, next = {}) {
  return [...LAUNCH_FIELDS].filter(field => configValueChanged(previous[field], next[field]));
}

export function recommendSkills(config = {}, session = {}) {
  const haystack = [
    config.role,
    config.customRole,
    config.prompt,
    session.runtime,
    session.agentKind,
    session.taskId,
  ].map(value => String(value || '').toLowerCase()).join(' ');

  const skills = new Set();
  if (/\btdd\b|test|red|green|spec/.test(haystack)) skills.add('tdd');
  if (/backend|api|server|store|node\.?js|mjs/.test(haystack)) skills.add('tdd');
  if (/frontend|react|ui|browser|playwright|chrome|cdp|verify|verifier|e2e/.test(haystack)) skills.add('wf-browser');
  if (/review|reviewer|audit|risk|regression/.test(haystack)) skills.add('wf-review');
  if (/wf|max|workflow|orchestr|manager|ceo/.test(haystack)) skills.add('wf');
  if (/subagent|dispatch|orchestr/.test(haystack)) skills.add('subagent-orchestrator');
  if (skills.size === 0 && /codex|claude|opencode/.test(haystack)) skills.add('wf');

  const recommendedSkills = [...skills];
  return {
    recommendedSkills,
    recommendationReason: recommendedSkills.length
      ? `Recommended from role/prompt/runtime signals: ${recommendedSkills.join(', ')}`
      : 'No role/prompt/runtime signals matched a built-in skill recommendation.',
  };
}

export function mergeNodeConfig(session = {}, patch = {}) {
  const current = normalizeNodeConfig(session.nodeConfig, session);
  const normalizedPatch = normalizeNodeConfigPatch(patch, current);
  if (current.skillPolicy === 'locked' && normalizedPatch.skillPolicy === 'auto') {
    throw new NodeConfigError('Locked node config cannot be switched to auto skill policy', {
      statusCode: 409,
      code: 'LOCKED_CONFIG',
    });
  }

  let next = { ...current, ...normalizedPatch };
  const recommendation = recommendSkills(next, session);
  if (next.skillPolicy === 'auto') {
    next = { ...next, skills: recommendation.recommendedSkills };
  }

  const patchedLaunchFields = Object.keys(normalizedPatch).filter(field => LAUNCH_FIELDS.has(field));
  const launchFields = uniqueStrings([
    ...changedLaunchFields(current, next),
    ...patchedLaunchFields,
  ]);
  const existingRestartFields = Array.isArray(session.restartRequiredFields)
    ? session.restartRequiredFields
    : [];
  const restartRequiredFields = uniqueStrings([
    ...(session.restartRequired ? existingRestartFields : []),
    ...launchFields,
  ]);
  const configRevision = Number(session.configRevision || 0) + 1;

  return {
    config: next,
    restartRequired: restartRequiredFields.length > 0,
    restartRequiredFields,
    configRevision,
    ...recommendation,
  };
}

export function sessionPatchForNodeConfig(session = {}, config = {}, options = {}) {
  const normalized = normalizeNodeConfig(config, session);
  return {
    role: normalized.role,
    customRole: normalized.customRole,
    prompt: normalized.prompt,
    objective: normalized.prompt || session.objective || '',
    model: normalized.model,
    provider: normalized.provider,
    cwd: normalized.cwd || session.cwd || session.projectRoot || '',
    env: normalized.env,
    permissions: normalized.permissions,
    launchPolicy: normalized.launchPolicy,
    skills: normalized.skills,
    skillPolicy: normalized.skillPolicy,
    contextSources: normalized.contextSources,
    capabilities: normalized.capabilities,
    outputRouting: normalized.outputRouting,
    nodeConfig: normalized,
    restartRequired: Boolean(options.restartRequired),
    restartRequiredFields: uniqueStrings(options.restartRequiredFields || []),
    configRevision: Number(options.configRevision || session.configRevision || 0),
  };
}

export function nodeConfigResponse(node, result = {}) {
  return {
    ok: true,
    node,
    restartRequired: Boolean(node?.restartRequired),
    restartRequiredFields: Array.isArray(node?.restartRequiredFields) ? node.restartRequiredFields : [],
    revision: Number(result.configRevision || node?.configRevision || 0),
    recommendedSkills: Array.isArray(result.recommendedSkills) ? result.recommendedSkills : [],
    recommendationReason: result.recommendationReason || '',
  };
}
