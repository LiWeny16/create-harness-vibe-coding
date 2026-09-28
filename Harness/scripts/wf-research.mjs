#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  BACKEND_CONFIG_SCHEMA,
  buildResearchPlan,
  buildToolchainInstallPlan,
  diagnoseResearchToolchain,
  executeToolchainInstallPlan,
  readJsonInput,
  renderDeepResearchResult,
  scoreDeepResearchResult,
  validateResearchBackendConfig,
  resolveResearchBackendValue,
  validateDeepResearchResult,
  validateResearchCatalog,
  validateResearchToolchain,
} from './lib/wf-research.mjs';

const HELP = `wf-research helper (stateless)\n\nUsage:\n  node Harness/scripts/wf-research.mjs validate --input <result.json> [--json]\n  node Harness/scripts/wf-research.mjs score --input <result.json> [--threshold <n>] [--json]\n  node Harness/scripts/wf-research.mjs render --input <result.json>\n  node Harness/scripts/wf-research.mjs plan --question <text> --catalog <catalog.json> [--tools <id,id>] [--json]\n  node Harness/scripts/wf-research.mjs validate-catalog --input <catalog.json> [--json]\n  node Harness/scripts/wf-research.mjs validate-toolchain --input <toolchain.json> [--json]\n  node Harness/scripts/wf-research.mjs setup --toolchain <file> --global-dir <dir> [--tools <id,id>] [--apply] [--json]\n  node Harness/scripts/wf-research.mjs doctor --toolchain <file> --global-dir <dir> [--no-network] [--json]\n  node Harness/scripts/wf-research.mjs configure --project <root> [endpoint/model flags] [--apply] [--json]\n\nThis helper performs no network access except doctor remote health probes, and never reads cookies or provider credentials.`;

const EXTRA_HELP = 'setup --toolchain <file> --global-dir <dir> [--tools <id,id>] [--apply] | doctor --toolchain <file> --global-dir <dir> [--project <root>] [--config <file>] [--no-network] | validate-config --input <config.json> | configure --project <root> [--research-backend-url <url>] [--whisper-endpoint <url>] [--vlm-base-url <url>] [--vlm-model <id>] [--apply] | backend config schema: wf-search/backend-config.v1 (JSON only)';

function parse(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') { args.help = true; continue; }
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2);
    const normalizedKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (['json', 'apply', 'no-network'].includes(key)) { args[normalizedKey] = true; continue; }
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`--${key} requires a value`);
    args[normalizedKey] = argv[++index];
  }
  return args;
}

function output(value, code = 0) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); process.exitCode = code; }
function fail(error) { output({ ok: false, errors: [{ code: 'WFR-CLI001', path: '$', message: error.message || String(error) }] }, 1); }

function loadToolchain(file) { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
function assertHttpUrl(value, label) {
  if (value === undefined) return;
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an HTTP(S) URL`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} must be an HTTP(S) URL`);
}
function configFromArgs(args) {
  const backends = {};
  if (args.researchBackendUrl !== undefined) { assertHttpUrl(args.researchBackendUrl, '--research-backend-url'); backends.research = { baseUrl: args.researchBackendUrl }; }
  if (args.whisperEndpoint !== undefined) { assertHttpUrl(args.whisperEndpoint, '--whisper-endpoint'); backends.whisper = { baseUrl: args.whisperEndpoint }; }
  if (args.vlmBaseUrl !== undefined) { assertHttpUrl(args.vlmBaseUrl, '--vlm-base-url'); backends.vlm = { ...(backends.vlm || {}), baseUrl: args.vlmBaseUrl }; }
  if (args.vlmModel !== undefined) backends.vlm = { ...(backends.vlm || {}), model: args.vlmModel };
  if (Object.keys(backends).length === 0) throw new Error('configure requires at least one endpoint or --vlm-model');
  const config = { schemaVersion: BACKEND_CONFIG_SCHEMA, backends };
  const checked = validateResearchBackendConfig(config);
  if (!checked.ok) throw new Error(`invalid backend config: ${checked.errors.map(error => error.message).join('; ')}`);
  return config;
}
function loadBackendConfig(file, { optional = false } = {}) {
  const resolved = path.resolve(file);
  if (optional && !fs.existsSync(resolved)) return {};
  const config = readJsonInput(resolved);
  const checked = validateResearchBackendConfig(config);
  if (!checked.ok) throw new Error(`invalid backend config ${resolved}: ${checked.errors.map(error => `${error.path} ${error.message}`).join('; ')}`);
  return checked.normalized;
}
async function probeRemoteTools(toolchain, config, noNetwork) {
  if (noNetwork) return {};
  const results = {};
  for (const tool of toolchain.tools || []) {
    if (tool.kind !== 'remote-service') continue;
    const configuredEndpoint = resolveResearchBackendValue(tool, { config, env: {} });
    if (!configuredEndpoint) continue;
    const endpoint = String(configuredEndpoint).replace(/\/+$/, '');
    const suffix = tool.id === 'vlm-endpoint' ? '/models' : '/health';
    try {
      const response = await fetch(`${endpoint}${suffix}`, { signal: AbortSignal.timeout(8000) });
      results[tool.id] = response.ok ? 'ready' : `unavailable-http-${response.status}`;
    } catch (error) {
      results[tool.id] = `unavailable-${error.name === 'TimeoutError' ? 'timeout' : 'network'}`;
    }
  }
  return results;
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help || args._.length === 0) { process.stdout.write(`${HELP}\n${EXTRA_HELP}\n`); return; }
  const command = args._[0];
  if (command === 'validate') {
    const checked = validateDeepResearchResult(readJsonInput(args.input));
    output({ ok: checked.ok, errors: checked.errors, result: checked.normalized }, checked.ok ? 0 : 1); return;
  }
  if (command === 'score') {
    const threshold = args.threshold === undefined ? 55 : Number(args.threshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error('--threshold must be between 0 and 100');
    const result = scoreDeepResearchResult(readJsonInput(args.input), { threshold });
    const checked = validateDeepResearchResult(result);
    output({ ok: checked.ok, errors: checked.errors, result }, checked.ok ? 0 : 1); return;
  }
  if (command === 'render') {
    const rendered = renderDeepResearchResult(readJsonInput(args.input));
    if (rendered === null) throw new Error('cannot render invalid wf-research result');
    process.stdout.write(rendered); return;
  }
  if (command === 'plan') {
    if (!args.question || !args.catalog) throw new Error('plan requires --question and --catalog');
    const catalog = JSON.parse(fs.readFileSync(path.resolve(args.catalog), 'utf8'));
    const plan = buildResearchPlan(args.question, { catalog, availableTools: args.tools ? args.tools.split(',').filter(Boolean) : [] });
    output({ ok: true, plan }); return;
  }
  if (command === 'validate-catalog') {
    const checked = validateResearchCatalog(readJsonInput(args.input));
    output({ ok: checked.ok, errors: checked.errors }, checked.ok ? 0 : 1); return;
  }
  if (command === 'validate-toolchain') {
    const checked = validateResearchToolchain(readJsonInput(args.input));
    output({ ok: checked.ok, errors: checked.errors }, checked.ok ? 0 : 1); return;
  }
  if (command === 'validate-config') {
    const checked = validateResearchBackendConfig(readJsonInput(args.input));
    output({ ok: checked.ok, errors: checked.errors, config: checked.normalized }, checked.ok ? 0 : 1); return;
  }
  if (command === 'setup') {
    if (!args.toolchain || !args.globalDir) throw new Error('setup requires --toolchain and --global-dir');
    const plan = buildToolchainInstallPlan(loadToolchain(args.toolchain), { globalDir: path.resolve(args.globalDir), selectedTools: args.tools ? args.tools.split(',').filter(Boolean) : [] });
    const result = args.apply ? executeToolchainInstallPlan(plan, { pythonCommand: process.env.WF_RESEARCH_PYTHON || 'python' }) : plan;
    output({ ok: true, applied: Boolean(args.apply), plan: result }); return;
  }
  if (command === 'doctor') {
    if (!args.toolchain || !args.globalDir) throw new Error('doctor requires --toolchain and --global-dir');
    const toolchain = loadToolchain(args.toolchain);
    const project = path.resolve(args.project || process.cwd());
    const configPath = path.resolve(args.config || path.join(project, 'Harness', 'extensions', 'config.json'));
    const config = loadBackendConfig(configPath, { optional: true });
    const healthResults = await probeRemoteTools(toolchain, config, args.noNetwork);
    const report = diagnoseResearchToolchain(toolchain, { globalDir: path.resolve(args.globalDir), config, env: {}, healthResults });
    output({ ok: report.ok, configPath, report }, report.ok ? 0 : 1); return;
  }
  if (command === 'configure') {
    if (!args.project) throw new Error('configure requires --project');
    const config = configFromArgs(args);
    const project = path.resolve(args.project);
    const target = path.join(project, 'Harness', 'extensions', 'config.json');
    const result = { schemaVersion: config.schemaVersion, path: target, config, applied: false };
    if (args.apply) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
      result.applied = true;
    }
    output({ ok: true, result }); return;
  }
  throw new Error(`unknown command: ${command}`);
}

try { await main(); } catch (error) { fail(error); }
