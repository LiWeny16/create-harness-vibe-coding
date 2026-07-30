import fs from 'node:fs';
import path from 'node:path';
import { RUNTIME_DEFINITIONS } from './runtime-detector.mjs';

/**
 * Default settings for the wf-ui server.
 * These are the baseline values overridden by project settings.
 */
export const DEFAULT_SETTINGS = {
  server: { host: '127.0.0.1', port: 0 },
  terminal: { enabled: false, attachMode: false, defaultRuntime: 'codex' },
  peers: { allowlist: RUNTIME_DEFINITIONS.map((runtime) => runtime.id) },
  ui: { theme: 'auto', language: 'en', reducedMotion: false },
};

/**
 * Deep-merge two plain objects. Only known keys from the defaults
 * structure are accepted; unknown keys in the override are silently ignored.
 *
 * @param {object} defaults - Default settings object
 * @param {object} override - Project override settings object
 * @returns {object} Merged result
 */
function deepMerge(defaults, override) {
  const result = { ...defaults };

  for (const key of Object.keys(override)) {
    if (!Object.hasOwn(defaults, key)) {
      // Silently ignore unknown keys
      continue;
    }

    const defVal = defaults[key];
    const ovrVal = override[key];

    if (defVal !== null && typeof defVal === 'object' && !Array.isArray(defVal) &&
        ovrVal !== null && typeof ovrVal === 'object' && !Array.isArray(ovrVal)) {
      result[key] = deepMerge(defVal, ovrVal);
    } else {
      result[key] = ovrVal;
    }
  }

  return result;
}

/**
 * Read project settings from Harness/settings.json relative to projectRoot.
 * Merges project settings over defaults. Non-existent settings.json produces
 * defaults. Unknown keys in project settings are silently ignored.
 *
 * @param {string} projectRoot - Absolute path to the project root directory
 * @returns {object} Merged settings object
 */
export function loadSettings(projectRoot) {
  if (!projectRoot) {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  const settingsPath = path.join(projectRoot, 'Harness', 'settings.json');

  if (!fs.existsSync(settingsPath)) {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  let raw;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  let projectSettings;
  try {
    projectSettings = JSON.parse(raw);
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  return deepMerge(DEFAULT_SETTINGS, projectSettings);
}

/**
 * Resolve settings with explicit precedence.
 * The precedence object may specify a projectRoot; project settings
 * override defaults.
 *
 * @param {object} precedence - Precedence configuration
 * @param {string} [precedence.projectRoot] - Project root for settings lookup
 * @returns {object} Merged settings object
 */
export function resolveSettings(precedence = {}) {
  const projectRoot = precedence.projectRoot;

  if (projectRoot) {
    return loadSettings(projectRoot);
  }

  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}
