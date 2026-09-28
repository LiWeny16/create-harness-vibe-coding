import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CATALOG_SCHEMA = 'wf-research/source-catalog.v1';
export const TOOLCHAIN_SCHEMA = 'wf-research/toolchain.v1';
export const RESULT_SCHEMA = 'wf-research/result.v1';
export const AGENT_SCHEMA = 'wf-research/agent-profile.v1';
export const BACKEND_CONFIG_SCHEMA = 'wf-search/backend-config.v1';
export const PROVIDER_SCHEMA = 'wf-research/search-provider-catalog.v1';
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROFILE_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SOURCE_KINDS = new Set(['official', 'paper', 'source-code', 'repository', 'news', 'community', 'social', 'video', 'comment', 'other']);
const ACCESS = new Set(['full', 'excerpt', 'snippet', 'visible', 'unavailable']);
const EVIDENCE_STATUS = new Set(['candidate', 'kept', 'discarded']);
const CLAIM_STATUS = new Set(['supported', 'disputed', 'insufficient']);
const CLAIM_KINDS = new Set(['fact', 'inference', 'recommendation', 'community-observation']);
const OP_KINDS = new Set(['search', 'read', 'transcribe', 'vision', 'comments', 'health']);
const OP_OUTCOMES = new Set(['success', 'failed', 'unavailable']);
const LIMIT = 1024 * 1024;

const issue = (code, field, message) => ({ code, path: field, message });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value, max = Infinity) => typeof value === 'string' && value.trim() !== '' && value.length <= max;
const validUrl = value => { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; } };
const validDate = value => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const id = (value, pattern = ID_RE) => typeof value === 'string' && pattern.test(value);
const range = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const unique = values => new Set(values).size === values.length;
const clone = value => JSON.parse(JSON.stringify(value));
const round = value => Math.round(value * 10) / 10;
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');

function getPath(value, dottedPath) {
  return String(dottedPath || '').split('.').filter(Boolean).reduce((current, key) => current && typeof current === 'object' ? current[key] : undefined, value);
}

export function validateResearchBackendConfig(input) {
  const errors = [];
  if (!object(input) || input.schemaVersion !== BACKEND_CONFIG_SCHEMA) errors.push(issue('WFR-CFG001', 'schemaVersion', `schemaVersion must be ${BACKEND_CONFIG_SCHEMA}`));
  if (!object(input)) return { ok: false, errors, normalized: input };
  if (!object(input.backends)) errors.push(issue('WFR-CFG002', 'backends', 'backends must be an object'));
  for (const [name, backend] of Object.entries(input.backends || {})) {
    if (!object(backend)) { errors.push(issue('WFR-CFG003', `backends.${name}`, 'backend must be an object')); continue; }
    if (backend.baseUrl !== undefined && !validUrl(backend.baseUrl)) errors.push(issue('WFR-CFG004', `backends.${name}.baseUrl`, 'baseUrl must be an HTTP(S) URL'));
    if (backend.model !== undefined && !nonEmpty(backend.model, 200)) errors.push(issue('WFR-CFG005', `backends.${name}.model`, 'model must be a non-empty string'));
    for (const key of Object.keys(backend)) if (/api.?key|cookie|authorization|token|password|secret|ssh/i.test(key)) errors.push(issue('WFR-CFG006', `backends.${name}.${key}`, 'backend config must not contain credentials or session material'));
  }
  return { ok: errors.length === 0, errors, normalized: input };
}

export function resolveResearchBackendValue(tool, { config = {}, env = {} } = {}) {
  if (tool?.configKey) return getPath(config, tool.configKey);
  return undefined;
}

export function validateSearchProviderCatalog(input) {
  const errors = [];
  if (!object(input) || input.schemaVersion !== PROVIDER_SCHEMA) errors.push(issue('WFR-PROV001', 'schemaVersion', `schemaVersion must be ${PROVIDER_SCHEMA}`));
  if (!object(input)) return { ok: false, errors, normalized: input };
  if (!nonEmpty(input.version, 100)) errors.push(issue('WFR-PROV002', 'version', 'version is required'));
  if (!nonEmpty(input.router, 100)) errors.push(issue('WFR-PROV003', 'router', 'router is required'));
  if (!Array.isArray(input.providers) || input.providers.length === 0) errors.push(issue('WFR-PROV004', 'providers', 'providers must be a non-empty array'));
  const providers = Array.isArray(input.providers) ? input.providers : [];
  const providerIds = providers.map(provider => provider?.id);
  if (!unique(providerIds)) errors.push(issue('WFR-PROV005', 'providers', 'provider ids must be unique'));
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index]; const field = `providers[${index}]`;
    if (!object(provider)) { errors.push(issue('WFR-PROV006', field, 'provider must be an object')); continue; }
    checkId(errors, provider.id, `${field}.id`);
    for (const name of ['kind', 'integration', 'availability', 'role']) if (!nonEmpty(provider[name], 200)) errors.push(issue('WFR-PROV007', `${field}.${name}`, `${name} is required`));
    if (!validUrl(provider.upstream)) errors.push(issue('WFR-PROV008', `${field}.upstream`, 'upstream must be an HTTP(S) URL'));
    if (provider.configKey !== undefined && !nonEmpty(provider.configKey, 200)) errors.push(issue('WFR-PROV009', `${field}.configKey`, 'configKey must be a non-empty string'));
    if (provider.credentialEnv !== undefined && (!Array.isArray(provider.credentialEnv) || provider.credentialEnv.some(name => !/^[A-Z][A-Z0-9_]*$/.test(name)))) errors.push(issue('WFR-PROV010', `${field}.credentialEnv`, 'credentialEnv must contain environment variable names only'));
  }
  return { ok: errors.length === 0, errors, normalized: input };
}

export function buildSearchProviderPlan(catalog, { config = {}, env = process.env, question = '' } = {}) {
  const checked = validateSearchProviderCatalog(catalog);
  if (!checked.ok) throw new Error(`invalid search provider catalog: ${checked.errors.map(error => error.message).join('; ')}`);
  const providers = catalog.providers.map(provider => {
    const endpoint = provider.configKey ? getPath(config, provider.configKey) : undefined;
    const credentialConfigured = Array.isArray(provider.credentialEnv) && provider.credentialEnv.some(name => nonEmpty(env?.[name], 1000));
    let status = 'not-selected';
    if (provider.availability === 'user-hosted-service') status = endpoint ? 'configured-not-checked' : 'requires-configuration';
    else if (provider.availability === 'config-required') status = credentialConfigured ? 'configured-not-checked' : 'requires-credentials';
    else if (provider.availability === 'probe-required') status = 'probe-required';
    return { id: provider.id, kind: provider.kind, availability: provider.availability, status, endpointConfigured: Boolean(endpoint), credentialConfigured };
  });
  return {
    schemaVersion: 'wf-research/search-provider-plan.v1',
    router: catalog.router,
    question: String(question),
    providers,
    limitations: providers.filter(provider => provider.status !== 'configured-not-checked').map(provider => `${provider.id}: ${provider.status}`),
  };
}

function checkId(errors, value, field) { if (!id(value)) errors.push(issue('WFR-ID001', field, `${field} must be a lower-case id`)); }
function checkDate(errors, value, field, nullable = false) { if (nullable && value === null) return; if (!validDate(value)) errors.push(issue('WFR-DATE001', field, `${field} must be an ISO date${nullable ? ' or null' : ''}`)); }
function checkRange(errors, value, field) { if (!range(value)) errors.push(issue('WFR-RANGE001', field, `${field} must be a number between 0 and 1`)); }
function checkRefs(errors, values, known, field) {
  if (!Array.isArray(values) || values.some(item => typeof item !== 'string')) errors.push(issue('WFR-REF001', field, `${field} must be an array of ids`));
  else for (const value of values) if (!known.has(value)) errors.push(issue('WFR-REF002', field, `unknown id: ${value}`));
}

export function validateResearchCatalog(input) {
  const errors = [];
  if (!object(input) || input.schemaVersion !== CATALOG_SCHEMA) errors.push(issue('WFR-CAT001', 'schemaVersion', `schemaVersion must be ${CATALOG_SCHEMA}`));
  if (!object(input)) return { ok: false, errors, normalized: input };
  if (!nonEmpty(input.version, 100)) errors.push(issue('WFR-CAT002', 'version', 'version is required'));
  if (!Array.isArray(input.sources) || input.sources.length < 1) errors.push(issue('WFR-CAT003', 'sources', 'sources must be a non-empty array'));
  if (!Array.isArray(input.profiles) || input.profiles.length < 1) errors.push(issue('WFR-CAT004', 'profiles', 'profiles must be a non-empty array'));
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const sourceIds = sources.map(source => source?.id);
  if (!unique(sourceIds)) errors.push(issue('WFR-CAT005', 'sources', 'source ids must be unique'));
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]; const field = `sources[${index}]`;
    if (!object(source)) { errors.push(issue('WFR-CAT006', field, 'source must be an object')); continue; }
    checkId(errors, source.id, `${field}.id`);
    if (!nonEmpty(source.name, 200)) errors.push(issue('WFR-CAT007', `${field}.name`, 'name is required'));
    if (!['primary', 'discovery', 'social', 'media'].includes(source.tier)) errors.push(issue('WFR-CAT008', `${field}.tier`, 'tier must be primary, discovery, social, or media'));
    for (const name of ['authorityTier', 'modality', 'accessScope', 'evidenceStrength']) if (!nonEmpty(source[name], 100)) errors.push(issue('WFR-CAT018', `${field}.${name}`, `${name} is required`));
    if (!Array.isArray(source.capabilities) || source.capabilities.length === 0 || source.capabilities.some(item => !nonEmpty(item, 100))) errors.push(issue('WFR-CAT009', `${field}.capabilities`, 'capabilities must be non-empty strings'));
    if (!nonEmpty(source.adapter, 100)) errors.push(issue('WFR-CAT010', `${field}.adapter`, 'adapter is required'));
    if (!Array.isArray(source.urls) || source.urls.length === 0 || source.urls.some(url => !validUrl(url))) errors.push(issue('WFR-CAT011', `${field}.urls`, 'urls must contain HTTP(S) URLs'));
    if (!SOURCE_KINDS.has(source.evidenceKind)) errors.push(issue('WFR-CAT012', `${field}.evidenceKind`, 'evidenceKind is invalid'));
  }
  const profiles = Array.isArray(input.profiles) ? input.profiles : [];
  const profileIds = profiles.map(profile => profile?.id);
  if (!unique(profileIds)) errors.push(issue('WFR-CAT013', 'profiles', 'profile ids must be unique'));
  const knownSources = new Set(sourceIds);
  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index]; const field = `profiles[${index}]`;
    if (!object(profile)) { errors.push(issue('WFR-CAT014', field, 'profile must be an object')); continue; }
    if (!id(profile.id, PROFILE_ID)) errors.push(issue('WFR-CAT015', `${field}.id`, 'profile id is invalid'));
    if (!Array.isArray(profile.matchAny) || profile.matchAny.length === 0) errors.push(issue('WFR-CAT016', `${field}.matchAny`, 'matchAny must be non-empty'));
    checkRefs(errors, profile.sourceIds, knownSources, `${field}.sourceIds`);
    if (profile.sourceTiers !== undefined && (!Array.isArray(profile.sourceTiers) || profile.sourceTiers.some(item => !nonEmpty(item, 100)))) errors.push(issue('WFR-CAT019', `${field}.sourceTiers`, 'sourceTiers must be strings'));
    if (profile.priority !== undefined && (!Array.isArray(profile.priority) || profile.priority.some(item => !nonEmpty(item, 100)))) errors.push(issue('WFR-CAT020', `${field}.priority`, 'priority must be strings'));
    if (!Array.isArray(profile.requiredCapabilities) || profile.requiredCapabilities.length === 0) errors.push(issue('WFR-CAT017', `${field}.requiredCapabilities`, 'requiredCapabilities must be non-empty'));
  }
  return { ok: errors.length === 0, errors, normalized: input };
}

export function validateResearchToolchain(input) {
  const errors = [];
  if (!object(input) || input.schemaVersion !== TOOLCHAIN_SCHEMA) errors.push(issue('WFR-TOOL001', 'schemaVersion', `schemaVersion must be ${TOOLCHAIN_SCHEMA}`));
  if (!object(input)) return { ok: false, errors, normalized: input };
  if (!nonEmpty(input.installRoot, 500) || !/Harness[\\/]extensions/.test(input.installRoot)) errors.push(issue('WFR-TOOL002', 'installRoot', 'installRoot must be under Harness/extensions'));
  if (input.defaultInstall !== false) errors.push(issue('WFR-TOOL003', 'defaultInstall', 'deep research runtimes must be optional by default'));
  if (!Array.isArray(input.tools) || input.tools.length === 0) errors.push(issue('WFR-TOOL004', 'tools', 'tools must be non-empty'));
  const tools = Array.isArray(input.tools) ? input.tools : [];
  const toolIds = tools.map(tool => tool?.id);
  if (!unique(toolIds)) errors.push(issue('WFR-TOOL005', 'tools', 'tool ids must be unique'));
  for (let index = 0; index < tools.length; index += 1) {
    const tool = tools[index]; const field = `tools[${index}]`;
    if (!object(tool)) { errors.push(issue('WFR-TOOL006', field, 'tool must be an object')); continue; }
    checkId(errors, tool.id, `${field}.id`);
    if (!nonEmpty(tool.name, 200) || !nonEmpty(tool.kind, 100)) errors.push(issue('WFR-TOOL007', field, 'tool name and kind are required'));
    if (!nonEmpty(tool.upstream, 500) || !validUrl(tool.upstream)) errors.push(issue('WFR-TOOL008', `${field}.upstream`, 'upstream must be an HTTP(S) URL'));
    if (!nonEmpty(tool.health, 500)) errors.push(issue('WFR-TOOL009', `${field}.health`, 'health check is required'));
    if (tool.kind === 'remote-service') {
      if (tool.install !== undefined) errors.push(issue('WFR-TOOL010', `${field}.install`, 'remote services must not declare a local installer'));
      if (!nonEmpty(tool.configKey, 200)) errors.push(issue('WFR-TOOL011', `${field}.configKey`, 'remote services need a JSON configKey'));
    } else if (tool.install?.scope === 'user-provided-external') {
      if (!Array.isArray(tool.install.commands)) errors.push(issue('WFR-TOOL012', `${field}.install.commands`, 'external tool commands must be an array'));
    } else if (!object(tool.install) || tool.install.scope !== 'global-extension-runtime' || !Array.isArray(tool.install.commands) || tool.install.commands.length === 0) {
      errors.push(issue('WFR-TOOL012', `${field}.install`, 'local tools need global-extension-runtime install commands'));
    }
  }
  return { ok: errors.length === 0, errors, normalized: input };
}

function requireAbsoluteDirectory(value, label) {
  if (!nonEmpty(value, 500) || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  return path.resolve(value);
}

function toolchainRoot(toolchain, globalDir, extensionVersion = '0.3.0') {
  const globalRoot = requireAbsoluteDirectory(globalDir, 'globalDir');
  const expected = path.resolve(globalRoot, 'Harness', 'extensions', 'wf-search-deep', extensionVersion, 'runtime');
  const declared = String(toolchain.installRoot).replace('<globalDir>', globalRoot).replace('<version>', extensionVersion);
  const resolved = path.resolve(declared);
  if (resolved !== expected) throw new Error('toolchain installRoot must resolve to the wf-search-deep global extension runtime');
  return resolved;
}

function resolveToolchainTemplate(value, root) {
  const python = process.platform === 'win32'
    ? path.join(root, 'python', 'Scripts', 'python.exe')
    : path.join(root, 'python', 'bin', 'python');
  return String(value)
    .replaceAll('<root>', root)
    .replaceAll('<nodeRoot>', path.join(root, 'node'))
    .replaceAll('<pythonExecutable>', python)
    .replaceAll('<installRoot>', root);
}

export function buildToolchainInstallPlan(toolchain, { globalDir, extensionVersion = '0.3.0', selectedTools = [] } = {}) {
  const checked = validateResearchToolchain(toolchain);
  if (!checked.ok) throw new Error(`invalid toolchain: ${checked.errors.map(error => error.message).join('; ')}`);
  const root = toolchainRoot(toolchain, globalDir, extensionVersion);
  const selected = new Set(Array.isArray(selectedTools) && selectedTools.length ? selectedTools : toolchain.tools.map(tool => tool.id));
  const tools = toolchain.tools.filter(tool => selected.has(tool.id)).map(tool => {
    const mode = tool.kind === 'remote-service'
      ? 'remote-service'
      : tool.install?.scope === 'user-provided-external'
        ? 'user-session'
        : tool.id === 'ffmpeg'
          ? 'manual-prerequisite'
          : 'installable';
    return {
      id: tool.id,
      name: tool.name,
      mode,
      upstream: tool.upstream,
      installRoot: root,
      commands: mode === 'installable' ? (tool.install?.commands || []).map(command => resolveToolchainTemplate(command, root)) : [],
      requires: tool.requires || [],
      configKey: tool.configKey || null,
      executed: false,
    };
  });
  return {
    schemaVersion: 'wf-research/install-plan.v1',
    extensionId: 'wf-search-deep',
    extensionVersion,
    installRoot: root,
    tools,
    applied: false,
  };
}

function runInstallRecipe(tool, root, { pythonCommand = 'python', npmCommand = 'npm', runner = spawnSync } = {}) {
  if (tool.id === 'tiktok-api') {
    const nodeRoot = path.join(root, 'node');
    fs.mkdirSync(nodeRoot, { recursive: true });
    const install = runner(npmCommand, ['install', '--prefix', nodeRoot, '@ssut/tiktok-api@1.5.2'], { cwd: root, encoding: 'utf8', stdio: 'pipe', shell: false });
    if (install.status !== 0) throw new Error('tiktok-api: package installation failed');
    return { executed: true, status: 'installed', nodeRoot, packageName: '@ssut/tiktok-api@1.5.2' };
  }
  if (!['gpt-researcher', 'storm', 'yt-dlp', 'gallery-dl'].includes(tool.id)) return { executed: false, status: tool.mode };
  const venv = path.join(root, 'python');
  const python = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
  fs.mkdirSync(root, { recursive: true });
  const create = runner(pythonCommand, ['-m', 'venv', venv], { cwd: root, encoding: 'utf8', stdio: 'pipe', shell: false });
  if (create.status !== 0) throw new Error(`${tool.id}: python venv creation failed`);
  const packageName = tool.id === 'gpt-researcher' ? 'gpt-researcher' : tool.id === 'storm' ? 'knowledge-storm' : tool.id === 'gallery-dl' ? 'gallery-dl' : 'yt-dlp[default,curl-cffi]';
  const install = runner(python, ['-m', 'pip', 'install', '--upgrade', packageName], { cwd: root, encoding: 'utf8', stdio: 'pipe', shell: false });
  if (install.status !== 0) throw new Error(`${tool.id}: package installation failed`);
  return { executed: true, status: 'installed', python, packageName };
}

export function executeToolchainInstallPlan(plan, { pythonCommand = 'python', npmCommand = 'npm', runner = spawnSync } = {}) {
  const result = clone(plan);
  result.tools = result.tools.map(tool => {
    if (tool.mode !== 'installable') return { ...tool, status: tool.mode };
    return { ...tool, ...runInstallRecipe(tool, result.installRoot, { pythonCommand, npmCommand, runner }) };
  });
  result.applied = true;
  return result;
}

export function diagnoseResearchToolchain(toolchain, { globalDir, extensionVersion = '0.3.0', config = {}, env = process.env, healthResults = {}, commandRunner = spawnSync } = {}) {
  const plan = buildToolchainInstallPlan(toolchain, { globalDir, extensionVersion });
  const tools = plan.tools.map(tool => {
    if (tool.mode === 'remote-service') {
      const endpoint = resolveResearchBackendValue(tool, { config, env });
      return { ...tool, status: !endpoint ? 'requires-configuration' : (healthResults[tool.id] || 'configured-not-checked'), endpointConfigured: Boolean(endpoint), endpointSource: 'json' };
    }
    if (tool.mode === 'user-session') return { ...tool, status: 'requires-session' };
    if (tool.mode === 'manual-prerequisite') return { ...tool, status: 'manual-prerequisite' };
    if (tool.id === 'tiktok-api') {
      const nodeRoot = path.join(plan.installRoot, 'node');
      const packageJson = path.join(nodeRoot, 'node_modules', '@ssut', 'tiktok-api', 'package.json');
      if (!fs.existsSync(packageJson)) return { ...tool, status: 'not-installed' };
      const check = commandRunner('node', ['--input-type=module', '-e', "import('@ssut/tiktok-api').then(() => process.exit(0)).catch(() => process.exit(1))"], { cwd: nodeRoot, encoding: 'utf8', stdio: 'pipe', shell: false });
      return { ...tool, status: check.status === 0 ? 'ready' : 'installed-but-unhealthy' };
    }
    const python = process.platform === 'win32' ? path.join(plan.installRoot, 'python', 'Scripts', 'python.exe') : path.join(plan.installRoot, 'python', 'bin', 'python');
    if (!fs.existsSync(python)) return { ...tool, status: 'not-installed' };
    const checkArgs = tool.id === 'yt-dlp'
      ? ['-m', 'yt_dlp', '--version']
      : ['-c', tool.id === 'storm' ? 'import knowledge_storm' : tool.id === 'gallery-dl' ? 'import gallery_dl' : 'import gpt_researcher'];
    const check = commandRunner(python, checkArgs, { cwd: plan.installRoot, encoding: 'utf8', stdio: 'pipe', shell: false });
    return { ...tool, status: check.status === 0 ? 'ready' : 'installed-but-unhealthy' };
  });
  return { schemaVersion: 'wf-research/doctor.v1', ok: tools.every(tool => tool.status === 'ready'), installRoot: plan.installRoot, tools };
}

function validateOperation(errors, operation, index) {
  const field = `operations[${index}]`;
  if (!object(operation)) { errors.push(issue('WFR-RES001', field, 'operation must be an object')); return; }
  checkId(errors, operation.id, `${field}.id`);
  if (!OP_KINDS.has(operation.kind)) errors.push(issue('WFR-RES002', `${field}.kind`, 'operation kind is invalid'));
  if (!nonEmpty(operation.tool, 200)) errors.push(issue('WFR-RES003', `${field}.tool`, 'operation tool is required'));
  if (!OP_OUTCOMES.has(operation.outcome)) errors.push(issue('WFR-RES004', `${field}.outcome`, 'operation outcome is invalid'));
  checkDate(errors, operation.checkedAt, `${field}.checkedAt`);
  if (operation.url !== undefined && !validUrl(operation.url)) errors.push(issue('WFR-RES005', `${field}.url`, 'operation url must be HTTP(S)'));
  if (operation.kind === 'search' && !nonEmpty(operation.query, 2000)) errors.push(issue('WFR-RES006', `${field}.query`, 'search operation needs query'));
}

export function validateDeepResearchResult(input) {
  const errors = [];
  if (!object(input) || input.schemaVersion !== RESULT_SCHEMA) errors.push(issue('WFR-RES007', 'schemaVersion', `schemaVersion must be ${RESULT_SCHEMA}`));
  if (!object(input)) return { ok: false, errors, normalized: input };
  if (!nonEmpty(input.question, 1000)) errors.push(issue('WFR-RES008', 'question', 'question is required'));
  checkDate(errors, input.checkedAt, 'checkedAt');
  if (!object(input.plan) || !nonEmpty(input.plan.profileId, 100)) errors.push(issue('WFR-RES009', 'plan', 'plan.profileId is required'));
  if (!Array.isArray(input.operations)) errors.push(issue('WFR-RES010', 'operations', 'operations must be an array'));
  const operations = Array.isArray(input.operations) ? input.operations : [];
  if (!unique(operations.map(operation => operation?.id))) errors.push(issue('WFR-RES011', 'operations', 'operation ids must be unique'));
  operations.forEach((operation, index) => validateOperation(errors, operation, index));
  const operationIds = new Set(operations.map(operation => operation?.id));
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) errors.push(issue('WFR-RES012', 'evidence', 'evidence must be non-empty'));
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const evidenceIds = evidence.map(item => item?.id);
  if (!unique(evidenceIds)) errors.push(issue('WFR-RES013', 'evidence', 'evidence ids must be unique'));
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index]; const field = `evidence[${index}]`;
    if (!object(item)) { errors.push(issue('WFR-RES014', field, 'evidence must be an object')); continue; }
    checkId(errors, item.id, `${field}.id`);
    for (const name of ['sourceId', 'url', 'title', 'kind', 'excerpt', 'access']) if (!nonEmpty(item[name], name === 'excerpt' ? 4000 : 1000)) errors.push(issue('WFR-RES015', `${field}.${name}`, `${name} is required`));
    if (!validUrl(item.url)) errors.push(issue('WFR-RES016', `${field}.url`, 'evidence url must be HTTP(S)'));
    if (!SOURCE_KINDS.has(item.kind)) errors.push(issue('WFR-RES017', `${field}.kind`, 'evidence kind is invalid'));
    if (!ACCESS.has(item.access)) errors.push(issue('WFR-RES018', `${field}.access`, 'evidence access is invalid'));
    checkDate(errors, item.publishedAt, `${field}.publishedAt`, true); checkDate(errors, item.retrievedAt, `${field}.retrievedAt`);
    if (!Array.isArray(item.operationIds) || item.operationIds.length === 0) errors.push(issue('WFR-RES019', `${field}.operationIds`, 'evidence needs operation ids'));
    else for (const operationId of item.operationIds) if (!operationIds.has(operationId)) errors.push(issue('WFR-RES020', `${field}.operationIds`, `unknown operation id: ${operationId}`));
    for (const name of ['relevance', 'directness', 'authority', 'recency', 'independence', 'evidenceQuality']) checkRange(errors, item[name], `${field}.${name}`);
    if (item.score !== undefined && (!Number.isFinite(item.score) || item.score < 0 || item.score > 100)) errors.push(issue('WFR-RES021', `${field}.score`, 'score must be between 0 and 100'));
    if (item.status !== undefined && !EVIDENCE_STATUS.has(item.status)) errors.push(issue('WFR-RES022', `${field}.status`, 'evidence status is invalid'));
    if (item.status === 'discarded' && !nonEmpty(item.discardReason, 500)) errors.push(issue('WFR-RES023', `${field}.discardReason`, 'discarded evidence needs a reason'));
  }
  const claims = Array.isArray(input.claims) ? input.claims : [];
  if (!Array.isArray(input.claims)) errors.push(issue('WFR-RES024', 'claims', 'claims must be an array'));
  const claimIds = claims.map(claim => claim?.id);
  if (!unique(claimIds)) errors.push(issue('WFR-RES025', 'claims', 'claim ids must be unique'));
  for (let index = 0; index < claims.length; index += 1) {
    const claim = claims[index]; const field = `claims[${index}]`;
    if (!object(claim)) { errors.push(issue('WFR-RES026', field, 'claim must be an object')); continue; }
    checkId(errors, claim.id, `${field}.id`);
    if (!nonEmpty(claim.text, 4000)) errors.push(issue('WFR-RES027', `${field}.text`, 'claim text is required'));
    if (!CLAIM_KINDS.has(claim.kind)) errors.push(issue('WFR-RES028', `${field}.kind`, 'claim kind is invalid'));
    if (!['major', 'minor'].includes(claim.importance)) errors.push(issue('WFR-RES029', `${field}.importance`, 'claim importance is invalid'));
    checkRefs(errors, claim.evidenceIds, new Set(evidenceIds), `${field}.evidenceIds`);
    if (!CLAIM_STATUS.has(claim.status)) errors.push(issue('WFR-RES030', `${field}.status`, 'claim status is invalid'));
    if (!['high', 'medium', 'low'].includes(claim.confidence)) errors.push(issue('WFR-RES031', `${field}.confidence`, 'claim confidence is invalid'));
    if (!nonEmpty(claim.confidenceReason, 1000)) errors.push(issue('WFR-RES032', `${field}.confidenceReason`, 'claim confidenceReason is required'));
    if (claim.gaps !== undefined && !strings(claim.gaps)) errors.push(issue('WFR-RES033', `${field}.gaps`, 'claim gaps must be strings'));
    if (claim.status === 'supported' && claim.importance === 'major') {
      const cited = (claim.evidenceIds || []).map(evidenceId => evidence.find(item => item?.id === evidenceId)).filter(Boolean);
      if (cited.length === 0 || cited.every(item => item.status === 'discarded')) errors.push(issue('WFR-RES037', `${field}.evidenceIds`, 'supported major claims need at least one non-discarded evidence item'));
    }
  }
  if (!Array.isArray(input.limitations) || input.limitations.some(item => !nonEmpty(item, 1000))) errors.push(issue('WFR-RES034', 'limitations', 'limitations must be an array of strings'));
  if (!object(input.decision)) errors.push(issue('WFR-RES035', 'decision', 'decision is required'));
  else {
    checkRefs(errors, input.decision.keptEvidenceIds, new Set(evidenceIds), 'decision.keptEvidenceIds');
    checkRefs(errors, input.decision.discardedEvidenceIds, new Set(evidenceIds), 'decision.discardedEvidenceIds');
    if (!Number.isFinite(input.decision.scoreThreshold)) errors.push(issue('WFR-RES036', 'decision.scoreThreshold', 'scoreThreshold is required'));
  }
  if (input.video !== undefined) validateVideo(errors, input.video, new Set(evidenceIds));
  return { ok: errors.length === 0, errors, normalized: input };
}

function validateVideo(errors, video, evidenceIds) {
  if (!object(video)) { errors.push(issue('WFR-VID001', 'video', 'video must be an object')); return; }
  if (!validUrl(video.sourceUrl)) errors.push(issue('WFR-VID002', 'video.sourceUrl', 'video sourceUrl must be HTTP(S)'));
  if (!Array.isArray(video.transcript)) errors.push(issue('WFR-VID003', 'video.transcript', 'transcript must be an array'));
  for (const [index, segment] of (video.transcript || []).entries()) {
    const field = `video.transcript[${index}]`;
    if (!object(segment) || !Number.isInteger(segment.id) || segment.id < 0 || !Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs) || segment.startMs < 0 || segment.endMs <= segment.startMs || !nonEmpty(segment.text, 4000)) errors.push(issue('WFR-VID004', field, 'transcript segment needs bounded timestamps and text'));
  }
  if (!Array.isArray(video.visualSegments)) errors.push(issue('WFR-VID005', 'video.visualSegments', 'visualSegments must be an array'));
  for (const [index, segment] of (video.visualSegments || []).entries()) {
    const field = `video.visualSegments[${index}]`;
    if (!object(segment) || !nonEmpty(segment.id, 100) || !Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs) || segment.startMs < 0 || segment.endMs <= segment.startMs || !nonEmpty(segment.summary, 4000)) errors.push(issue('WFR-VID006', field, 'visual segment needs bounded timestamps and summary'));
    else checkRefs(errors, segment.evidenceIds, evidenceIds, `${field}.evidenceIds`);
  }
  if (!Array.isArray(video.comments)) errors.push(issue('WFR-VID007', 'video.comments', 'comments must be an array'));
  for (const [index, comment] of (video.comments || []).entries()) {
    const field = `video.comments[${index}]`;
    if (!object(comment) || !nonEmpty(comment.id, 200) || !nonEmpty(comment.platform, 100) || !nonEmpty(comment.text, 4000) || !validUrl(comment.sourceUrl) || !ACCESS.has(comment.access)) errors.push(issue('WFR-VID008', field, 'comment needs id, platform, text, sourceUrl, and access'));
  }
  if (!object(video.tokenPolicy) || !nonEmpty(video.tokenPolicy.globalPass, 500) || !nonEmpty(video.tokenPolicy.localPass, 500) || !nonEmpty(video.tokenPolicy.contextRule, 500)) errors.push(issue('WFR-VID009', 'video.tokenPolicy', 'tokenPolicy must describe global, local, and context passes'));
}

export function scoreEvidence(item) {
  const score = round(100 * (
    item.relevance * 0.30
    + item.directness * 0.20
    + item.authority * 0.20
    + item.recency * 0.10
    + item.independence * 0.10
    + item.evidenceQuality * 0.10
  ));
  return score;
}

export function scoreDeepResearchResult(input, { threshold = 55 } = {}) {
  const result = clone(input);
  const scored = result.evidence.map(item => {
    const score = scoreEvidence(item);
    const kept = score >= threshold;
    return {
      ...item,
      score,
      status: kept ? 'kept' : 'discarded',
      ...(kept ? {} : { discardReason: `score ${score} is below threshold ${threshold}; evidence is too indirect, weak, or irrelevant` }),
    };
  });
  const keptEvidenceIds = scored.filter(item => item.status === 'kept').map(item => item.id);
  const discardedEvidenceIds = scored.filter(item => item.status === 'discarded').map(item => item.id);
  const keptSet = new Set(keptEvidenceIds);
  result.evidence = scored;
  result.claims = (result.claims || []).map(claim => {
    const ids = Array.isArray(claim.evidenceIds) ? claim.evidenceIds : [];
    if (ids.length > 0 && ids.every(evidenceId => !keptSet.has(evidenceId))) {
      return { ...claim, status: 'insufficient', confidence: 'low', confidenceReason: `${claim.confidenceReason} All supporting evidence was below the score threshold.`, gaps: [...new Set([...(claim.gaps || []), 'kept evidence after scoring'])] };
    }
    return claim;
  });
  result.decision = {
    ...(result.decision || {}),
    keptEvidenceIds,
    discardedEvidenceIds,
    scoreThreshold: threshold,
    discardedCount: discardedEvidenceIds.length,
  };
  return result;
}

export function buildResearchPlan(question, { catalog, availableTools = [] } = {}) {
  const checked = validateResearchCatalog(catalog);
  if (!checked.ok) throw new Error(`invalid source catalog: ${checked.errors.map(error => error.message).join('; ')}`);
  const normalizedQuestion = String(question || '').toLowerCase();
  const profile = catalog.profiles.find(candidate => candidate.matchAny.some(token => normalizedQuestion.includes(String(token).toLowerCase()))) || catalog.profiles.find(candidate => candidate.id === 'general') || catalog.profiles[0];
  const toolSet = new Set(Array.isArray(availableTools) ? availableTools.filter(tool => nonEmpty(tool, 200)) : []);
  const builtIn = new Set(['source-planner', 'search-provider-router', 'evidence-scorer', 'report-renderer']);
  const selectTools = tools => tools.filter(tool => builtIn.has(tool) || toolSet.has(tool));
  const stages = [
    { id: 'collect', kind: 'collect', objective: 'discover and read independent first-party, source-code, and social evidence', toolIds: selectTools(['source-planner', 'source-discovery', 'search-provider-router', 'gpt-researcher', 'storm']) },
    { id: 'video-understand', kind: 'understand', objective: 'convert media into compact timestamped transcript, visual, and comment evidence', toolIds: selectTools(['media-download', 'yt-dlp', 'gallery-dl', 'platform-youtube', 'platform-tiktok', 'platform-x', 'platform-bilibili', 'platform-instagram', 'platform-xiaohongshu', 'platform-wechat', 'whisper-large', 'video-asr', 'vlm-endpoint', 'video-vlm', 'browseros-neo', 'video-temporal-reader', 'comment-reader']) },
    { id: 'discard-and-replan', kind: 'decide', objective: 'deduplicate, score, detect contradictions, discard low-value evidence, and replan gaps', toolIds: selectTools(['evidence-scorer', 'evidence-scoring']) },
    { id: 'output', kind: 'output', objective: 'render a conclusion table with citations, confidence, and limitations', toolIds: selectTools(['report-renderer']) },
  ];
  return {
    schemaVersion: 'wf-research/plan.v1',
    question,
    profileId: profile.id,
    sourceIds: profile.sourceIds,
    stages,
    availableTools: [...toolSet],
    limitations: toolSet.size === 0
      ? ['No external adapter health results were supplied; the plan includes built-in orchestration only.']
      : ['Tool availability was supplied by the host and must be health-checked before execution.'],
  };
}

function escapeMarkdown(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

export function renderDeepResearchResult(input) {
  const checked = validateDeepResearchResult(input);
  if (!checked.ok) return null;
  const result = checked.normalized;
  const lines = [
    '# wf-research report',
    '',
    `**Question:** ${escapeMarkdown(result.question)}`,
    `**Profile:** ${escapeMarkdown(result.plan.profileId)}`,
    `**Evidence kept:** ${result.decision.keptEvidenceIds.length} / ${result.evidence.length}`,
    '',
    '## Conclusion',
  ];
  const claims = (result.claims || []).filter(claim => claim.status !== 'insufficient');
  for (const claim of claims) lines.push(`- **${escapeMarkdown(claim.status)}** ${escapeMarkdown(claim.text)} _(confidence: ${escapeMarkdown(claim.confidence)}; evidence: ${escapeMarkdown((claim.evidenceIds || []).join(', ') || 'none')})_`);
  lines.push('', '## Evidence score', '', '| Evidence | Score | Status | Source | Reason |', '| --- | ---: | --- | --- | --- |');
  for (const item of result.evidence.slice().sort((left, right) => (right.score || 0) - (left.score || 0))) lines.push(`| ${escapeMarkdown(item.title)} | ${item.score ?? '—'} | ${escapeMarkdown(item.status || 'candidate')} | [link](${item.url}) | ${escapeMarkdown(item.discardReason || item.excerpt)} |`);
  if (result.video) {
    lines.push('', '## Video evidence', '', `- Transcript segments: ${result.video.transcript.length}`, `- Visual segments: ${result.video.visualSegments.length}`, `- Visible comments: ${result.video.comments.length}`, `- Token policy: ${escapeMarkdown(result.video.tokenPolicy.contextRule)}`);
  }
  if (result.limitations?.length) lines.push('', '## Limitations', ...result.limitations.map(item => `- ${escapeMarkdown(item)}`));
  return `${lines.join('\n')}\n`;
}

export function readJsonInput(input) {
  if (!input) throw new Error('--input is required');
  const file = path.resolve(input);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > LIMIT) throw new Error('--input must be a regular file no larger than 1 MiB');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
