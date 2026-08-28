import fs from 'node:fs';
import path from 'node:path';

/**
 * Shared loader for Harness/a2a/action-registry.json.
 *
 * Multiple backend modules (ontology, context) plus the CLI read the same
 * registry. This module centralizes the resolved path, a cached sync read,
 * validation-on-load, and small query helpers. Consumers wire in later waves.
 */

// ── Schema enums (exact contract from the action-registry schema; mirrors
// ── the rules in __tests__/workflow-action-registry.test.mjs) ───────────────
const NODE_TYPE_ENUM = [
  'agent',
  'markdown',
  'excalidraw',
  'file',
  'display',
  'timer',
  'goal',
  'skill-group',
  'mcp-connector',
  'github-trigger',
  'node',
  'graph',
];
const CATEGORY_ENUM = [
  'lifecycle',
  'terminal-io',
  'config',
  'communication',
  'graph',
  'discovery',
  'resource',
  'event',
  'capability',
  'workspace',
];
const PARAM_TYPE_ENUM = ['string', 'number', 'boolean', 'object', 'array'];

// Cache keyed by resolved registry path. `loadActionRegistry` is sync and
// request-time hot; callers that edit the file (only tests) must call
// `clearActionRegistryCache` to force a re-read.
const registryCache = new Map();

/**
 * Resolve the action-registry file path for a project root.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @returns {string} Absolute path to Harness/a2a/action-registry.json
 */
export function resolveRegistryPath(projectRoot) {
  return path.resolve(projectRoot, 'Harness', 'a2a', 'action-registry.json');
}

/**
 * Load and validate the action registry synchronously, cached per resolved
 * path. Throws a descriptive error when the file is missing, is invalid
 * JSON, or fails schema validation.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @returns {object} Parsed registry { schemaVersion, actions }
 */
export function loadActionRegistry(projectRoot) {
  const registryPath = resolveRegistryPath(projectRoot);
  const cached = registryCache.get(registryPath);
  if (cached) {
    return cached;
  }

  let raw;
  try {
    raw = fs.readFileSync(registryPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Action registry not found at ${registryPath} (expected Harness/a2a/action-registry.json): ${err.message}`,
    );
  }

  let registry;
  try {
    registry = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Action registry at ${registryPath} is invalid JSON: ${err.message}`);
  }

  const result = validateRegistry(registry);
  if (!result.ok) {
    throw new Error(
      `Action registry at ${registryPath} failed validation (${result.errors.length} issue(s)): ${result.errors.slice(0, 5).join('; ')}`,
    );
  }

  registryCache.set(registryPath, registry);
  return registry;
}

/**
 * Drop all cached registry reads. Only needed by tests that mutate the
 * registry file between loads.
 */
export function clearActionRegistryCache() {
  registryCache.clear();
}

/**
 * Return the actions for a given node type, in registry order.
 *
 * @param {object} registry - Parsed registry from loadActionRegistry
 * @param {string} nodeType - One of the node-type enum values
 * @returns {Array<object>} Matching actions (empty array when none)
 */
export function actionsForNodeType(registry, nodeType) {
  return registry.actions.filter((action) => action.nodeType === nodeType);
}

/**
 * Look up a single action by id.
 *
 * @param {object} registry - Parsed registry from loadActionRegistry
 * @param {string} id - Action id, e.g. 'agent.sendMessage'
 * @returns {object|null} The action, or null when not found
 */
export function actionById(registry, id) {
  return registry.actions.find((action) => action.id === id) ?? null;
}

/**
 * Deduplicated CLI command list. One entry per distinct cli.command
 * (first action declaring it wins), shaped for direct consumption by the
 * CLI surface.
 *
 * @param {object} registry - Parsed registry from loadActionRegistry
 * @returns {Array<{command: string, actionId: string, flags: Array<object>}>}
 */
export function cliCommands(registry) {
  const seen = new Set();
  const commands = [];
  for (const action of registry.actions) {
    if (!action.cli || seen.has(action.cli.command)) {
      continue;
    }
    seen.add(action.cli.command);
    commands.push({ command: action.cli.command, actionId: action.id, flags: action.cli.flags });
  }
  return commands;
}

/**
 * Schema-validate a registry without throwing. Applies the same rules as
 * __tests__/workflow-action-registry.test.mjs: schemaVersion, required
 * fields, unique ids, nodeType/category enums, params shape, actor shape,
 * special-flag consistency, and cli shape (when cli is present).
 *
 * @param {object} registry - Parsed registry
 * @returns {{ok: boolean, errors: Array<string>}} Validation result
 */
export function validateRegistry(registry) {
  const errors = [];

  if (registry === null || typeof registry !== 'object' || Array.isArray(registry)) {
    return { ok: false, errors: ['registry must be an object'] };
  }

  if (registry.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1, got ${JSON.stringify(registry.schemaVersion)}`);
  }
  if (!Array.isArray(registry.actions) || registry.actions.length === 0) {
    errors.push('actions must be a non-empty array');
    return { ok: false, errors };
  }

  const ids = new Set();
  for (const action of registry.actions) {
    const label = typeof action.id === 'string' ? action.id : '<unknown id>';

    // ── Required fields ──────────────────────────────────────────────────
    if (typeof action.id !== 'string' || action.id.length === 0) {
      errors.push(`${label}: id must be a non-empty string`);
    }
    if (typeof action.nodeType !== 'string') {
      errors.push(`${label}: nodeType must be a string`);
    }
    if (typeof action.category !== 'string') {
      errors.push(`${label}: category must be a string`);
    }
    if (typeof action.summary !== 'string' || action.summary.length === 0) {
      errors.push(`${label}: summary must be a non-empty string`);
    }
    if (!Array.isArray(action.params)) {
      errors.push(`${label}: params must be an array`);
    }
    if (!action.implementation || typeof action.implementation !== 'object') {
      errors.push(`${label}: implementation must be an object`);
    }

    // ── Unique ids ──────────────────────────────────────────────────────
    if (typeof action.id === 'string') {
      if (ids.has(action.id)) {
        errors.push(`${action.id}: duplicate action id`);
      }
      ids.add(action.id);
    }

    // ── Enum values ─────────────────────────────────────────────────────
    if (typeof action.nodeType === 'string' && !NODE_TYPE_ENUM.includes(action.nodeType)) {
      errors.push(`${label}: invalid nodeType ${action.nodeType}`);
    }
    if (typeof action.category === 'string' && !CATEGORY_ENUM.includes(action.category)) {
      errors.push(`${label}: invalid category ${action.category}`);
    }

    // ── Actor shape ─────────────────────────────────────────────────────
    if (!action.actor || typeof action.actor !== 'object') {
      errors.push(`${label}: missing actor object`);
    } else {
      if (!('spawnGate' in action.actor) || !['root', null].includes(action.actor.spawnGate)) {
        errors.push(`${label}: actor.spawnGate must be "root" or null`);
      }
      for (const key of ['edgeRequired', 'agentAuthored']) {
        if (typeof action.actor[key] !== 'boolean') {
          errors.push(`${label}: actor.${key} must be a boolean`);
        }
      }
    }

    // ── Params shape ────────────────────────────────────────────────────
    if (Array.isArray(action.params)) {
      const names = new Set();
      for (const param of action.params) {
        if (typeof param.name !== 'string' || param.name.length === 0) {
          errors.push(`${label}: param missing non-empty name`);
        } else if (names.has(param.name)) {
          errors.push(`${label}: duplicate param ${param.name}`);
        } else {
          names.add(param.name);
        }
        if (typeof param.type !== 'string' || !PARAM_TYPE_ENUM.includes(param.type)) {
          errors.push(`${label}: param ${param.name} has invalid type ${JSON.stringify(param.type)}`);
        }
        if (typeof param.required !== 'boolean') {
          errors.push(`${label}: param ${param.name} missing required flag`);
        }
        if (typeof param.description !== 'string') {
          errors.push(`${label}: param ${param.name} missing description`);
        }
      }
    }

    // ── Special-flag consistency ────────────────────────────────────────
    const impl = action.implementation;
    if (impl && typeof impl === 'object') {
      if (impl.special === true) {
        if (Object.prototype.hasOwnProperty.call(impl, 'adapter')) {
          errors.push(`${label}: special action must not declare adapter`);
        }
        if (Object.prototype.hasOwnProperty.call(impl, 'export')) {
          errors.push(`${label}: special action must not declare export`);
        }
      } else if (typeof impl.adapter !== 'string' || typeof impl.export !== 'string') {
        errors.push(`${label}: non-special action needs string adapter and export`);
      }
    }

    // ── cli shape (optional per action, but must be complete when present)
    if (action.cli !== null && action.cli !== undefined) {
      if (typeof action.cli !== 'object' || typeof action.cli.command !== 'string' || action.cli.command.length === 0) {
        errors.push(`${label}: cli must be null or an object with a non-empty command`);
      } else if (!Array.isArray(action.cli.flags)) {
        errors.push(`${label}: cli.flags must be an array`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
