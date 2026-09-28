import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildResearchPlan,
  buildToolchainInstallPlan,
  diagnoseResearchToolchain,
  renderDeepResearchResult,
  scoreDeepResearchResult,
  validateResearchBackendConfig,
  validateDeepResearchResult,
  validateResearchCatalog,
  validateResearchToolchain,
  validateSearchProviderCatalog,
  buildSearchProviderPlan,
} from '../Harness/scripts/lib/wf-research.mjs';

const ROOT = path.resolve('.');
const SCRIPT = path.join(ROOT, 'Harness', 'scripts', 'wf-research.mjs');
const TEMPLATE_SCRIPT = path.join(ROOT, 'templates', 'common', 'Harness', 'scripts', 'wf-research.mjs');
const CATALOG = path.join(ROOT, 'extensions', 'wf-search-deep', 'source-catalog.json');
const TOOLCHAIN = path.join(ROOT, 'extensions', 'wf-search-deep', 'toolchain.json');
const SEARCH_PROVIDERS = path.join(ROOT, 'extensions', 'wf-search-deep', 'search-providers.json');
const WORKFLOW = path.join(ROOT, 'extensions', 'wf-search-deep', 'workflow.json');
const AGENT = path.join(ROOT, 'extensions', 'wf-search-deep', 'agent.json');
const SKILLS = path.join(ROOT, 'extensions', 'wf-search-deep', 'skills', 'manifest.json');
const BENCHMARK = path.join(ROOT, 'tests', 'fixtures', 'wf-research', 'vlm-video-temporal.json');
const COMMAND_SURFACE = path.join(ROOT, 'Harness', 'specs', 'runtime', 'command-surface.json');
const SKILL = path.join(ROOT, '.claude', 'skills', 'wf-search', 'SKILL.md');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const run = args => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });

test('AC-001 wf-research exposes a dedicated deep-research subagent contract and mirrored CLI', () => {
  assert.ok(fs.existsSync(SCRIPT), 'root wf-research helper should exist');
  assert.ok(fs.existsSync(TEMPLATE_SCRIPT), 'template wf-research helper should exist');
  assert.equal(fs.readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n'), fs.readFileSync(TEMPLATE_SCRIPT, 'utf8').replace(/\r\n/g, '\n'));
  assert.match(fs.readFileSync(SKILL, 'utf8'), /pnpm exec wf search/);
  const surface = readJson(COMMAND_SURFACE);
  assert.ok(!surface.commands.some(command => command.id === 'wf-research'), 'wf-research must not be a public command; wf-search is the public entry');
  const agent = readJson(AGENT);
  assert.equal(agent.schemaVersion, 'wf-research/agent-profile.v1');
  assert.equal(agent.id, 'wf-search-deep');
  assert.equal(agent.kind, 'subagent');
  assert.deepEqual(agent.stages, ['collect', 'understand', 'decide', 'output']);
  assert.ok(agent.tools.includes('source-planner'));
  assert.ok(agent.tools.includes('video-temporal-reader'));
  assert.ok(agent.tools.includes('platform-tiktok'));
  assert.equal(readJson(SKILLS).loading.scope, 'global');
  assert.equal(readJson(SKILLS).loading.defaultInstall, false);
});

test('AC-002 source catalog routes first-party and social sources by question profile', () => {
  const catalog = readJson(CATALOG);
  const checked = validateResearchCatalog(catalog);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.ok(catalog.sources.length >= 12, 'catalog should contain a meaningful global seed set');
  assert.ok(catalog.sources.every(source => source.authorityTier && source.modality && source.accessScope && source.evidenceStrength), 'sources should separate authority, modality, access, and evidence strength');
  assert.ok(catalog.profiles.some(profile => profile.id === 'technical-frontier'));
  const ids = new Set(catalog.sources.map(source => source.id));
  for (const id of ['arxiv', 'github', 'huggingface', 'youtube', 'x', 'reddit', 'bilibili', 'xiaohongshu']) assert.ok(ids.has(id), `catalog should include ${id}`);
  const plan = buildResearchPlan('如何让 VLM agent 看懂长视频时序信息并节省 token？', { catalog, availableTools: ['gpt-researcher', 'yt-dlp', 'whisper-large', 'vlm-endpoint'] });
  assert.equal(plan.profileId, 'technical-frontier');
  assert.ok(plan.sourceIds.includes('arxiv'));
  assert.ok(plan.sourceIds.includes('x'));
  assert.ok(plan.stages.find(stage => stage.id === 'collect').toolIds.includes('search-provider-router'));
  assert.ok(plan.stages.some(stage => stage.id === 'video-understand'));
  assert.ok(plan.stages.some(stage => stage.id === 'discard-and-replan'));
  const capabilityPlan = buildResearchPlan('How do VLM agents understand video?', { catalog, availableTools: ['gpt-researcher', 'storm', 'video-temporal-reader', 'comment-reader'] });
  assert.ok(capabilityPlan.stages.find(stage => stage.id === 'collect').toolIds.includes('storm'));
  assert.ok(capabilityPlan.stages.find(stage => stage.id === 'video-understand').toolIds.includes('video-temporal-reader'));
  const mediaPlan = buildResearchPlan('How do VLM agents understand video?', { catalog, availableTools: ['gallery-dl'] });
  assert.ok(mediaPlan.stages.find(stage => stage.id === 'video-understand').toolIds.includes('gallery-dl'));
  const skillPlan = buildResearchPlan('How do VLM agents understand video?', { catalog, availableTools: ['platform-tiktok', 'video-asr', 'video-vlm'] });
  const videoTools = skillPlan.stages.find(stage => stage.id === 'video-understand').toolIds;
  assert.ok(videoTools.includes('platform-tiktok'));
  assert.ok(videoTools.includes('video-asr'));
  assert.ok(videoTools.includes('video-vlm'));
});

test('AC-002 unknown tool inventory never schedules external adapters', () => {
  const catalog = readJson(CATALOG);
  const plan = buildResearchPlan('How do VLM agents understand video?', { catalog, availableTools: [] });
  const externalTools = plan.stages.flatMap(stage => stage.toolIds).filter(tool => !['source-planner', 'search-provider-router', 'evidence-scorer', 'report-renderer'].includes(tool));
  assert.deepEqual(externalTools, []);
  assert.ok(plan.limitations.some(item => /health|availability|unknown/i.test(item)));
});

test('AC-003 toolchain keeps external runtimes optional and global under Harness/extensions', () => {
  const toolchain = readJson(TOOLCHAIN);
  const checked = validateResearchToolchain(toolchain);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.match(toolchain.installRoot, /Harness[\\/]extensions/);
  assert.equal(toolchain.defaultInstall, false);
  const tools = new Map(toolchain.tools.map(tool => [tool.id, tool]));
  assert.equal(tools.get('gpt-researcher').install.scope, 'global-extension-runtime');
  assert.equal(tools.get('yt-dlp').install.scope, 'global-extension-runtime');
  assert.equal(tools.get('gallery-dl').install.scope, 'global-extension-runtime');
  assert.equal(tools.get('tiktok-api').install.scope, 'global-extension-runtime');
  assert.ok(tools.get('tiktok-api').install.commands.some(command => command.includes('@ssut/tiktok-api@1.5.2')));
  assert.deepEqual(tools.get('yt-dlp').platforms, ['youtube', 'tiktok', 'x', 'bilibili']);
  assert.equal(tools.get('whisper-large').kind, 'remote-service');
  assert.equal(tools.get('whisper-large').install, undefined);
  assert.equal(tools.get('browseros-neo').credentials, 'user-session-only');
});

test('AC-003 toolchain bootstrap resolves a safe global install plan without executing it', () => {
  const toolchain = readJson(TOOLCHAIN);
  const plan = buildToolchainInstallPlan(toolchain, {
    globalDir: path.join(ROOT, 'Harness', '.temp', 'wf-research-global'),
    selectedTools: ['gpt-researcher', 'yt-dlp', 'gallery-dl', 'tiktok-api', 'whisper-large', 'ffmpeg'],
  });
  assert.equal(plan.installRoot.includes(path.join('Harness', 'extensions')), true);
  assert.ok(plan.tools.find(tool => tool.id === 'gpt-researcher').commands.some(command => command.includes('python')));
  assert.ok(plan.tools.find(tool => tool.id === 'gallery-dl').commands.some(command => command.includes('gallery-dl')));
  assert.ok(plan.tools.find(tool => tool.id === 'tiktok-api').commands.some(command => command.includes(path.join('wf-search-deep', '0.3.0', 'runtime', 'node'))));
  assert.equal(plan.tools.find(tool => tool.id === 'whisper-large').mode, 'remote-service');
  assert.equal(plan.tools.find(tool => tool.id === 'ffmpeg').mode, 'manual-prerequisite');
  assert.ok(plan.tools.every(tool => tool.executed === false));
});

test('AC-003 search provider catalog distinguishes integrated, hosted, and self-hosted adapters', () => {
  const catalog = readJson(SEARCH_PROVIDERS);
  assert.equal(validateSearchProviderCatalog(catalog).ok, true);
  assert.equal(catalog.schemaVersion, 'wf-research/search-provider-catalog.v1');
  const providers = new Map(catalog.providers.map(provider => [provider.id, provider]));
  for (const id of ['tavily', 'brave-search', 'searxng', 'firecrawl', 'duckduckgo']) assert.ok(providers.has(id), `provider catalog should include ${id}`);
  assert.equal(providers.get('tavily').availability, 'config-required');
  assert.equal(providers.get('searxng').availability, 'user-hosted-service');
  assert.match(providers.get('firecrawl').install, /upstream Docker Compose/i);
  const plan = buildSearchProviderPlan(catalog, { config: { backends: { searchProviders: { searxng: { baseUrl: 'http://search.example' } } } }, env: {}, question: 'frontier video research' });
  assert.equal(plan.router, 'gpt-researcher');
  assert.equal(plan.providers.find(provider => provider.id === 'searxng').status, 'configured-not-checked');
  assert.equal(plan.providers.find(provider => provider.id === 'tavily').status, 'requires-credentials');
});

test('AC-003 doctor distinguishes missing configuration, session-only tools, and local runtimes', () => {
  const toolchain = readJson(TOOLCHAIN);
  const report = diagnoseResearchToolchain(toolchain, {
    globalDir: path.join(ROOT, 'Harness', '.temp', 'wf-research-global-missing'),
    env: {},
    commandRunner: () => ({ ok: false, status: 'not-installed' }),
  });
  const statuses = new Map(report.tools.map(tool => [tool.id, tool.status]));
  assert.equal(statuses.get('whisper-large'), 'requires-configuration');
  assert.equal(statuses.get('vlm-endpoint'), 'requires-configuration');
  assert.equal(statuses.get('browseros-neo'), 'requires-session');
  assert.equal(statuses.get('gpt-researcher'), 'not-installed');
  assert.equal(statuses.get('tiktok-api'), 'not-installed');
  assert.equal(report.ok, false);
});

test('AC-008 configure writes only endpoint/model metadata and never provider secrets', () => {
  const project = fs.mkdtempSync(path.join(ROOT, 'Harness', '.temp', 'wf-research-config-'));
  try {
    const result = run([
      'configure', '--project', project,
      '--whisper-endpoint', 'http://127.0.0.1:19100',
      '--vlm-base-url', 'http://127.0.0.1:8000/v1',
      '--vlm-model', 'qwen3.8-27b', '--apply', '--json',
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const configPath = path.join(project, 'Harness', 'extensions', 'config.json');
    const config = readJson(configPath);
    assert.equal(config.schemaVersion, 'wf-search/backend-config.v1');
    assert.equal(config.backends.whisper.baseUrl, 'http://127.0.0.1:19100');
    assert.equal(config.backends.vlm.baseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(config.backends.vlm.model, 'qwen3.8-27b');
    assert.doesNotMatch(fs.readFileSync(configPath, 'utf8'), /api[_-]?key|cookie|authorization|token/i);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('AC-008 backend config is JSON-only and rejects credential/session fields', () => {
  const valid = validateResearchBackendConfig({
    schemaVersion: 'wf-search/backend-config.v1',
    backends: { whisper: { baseUrl: 'https://backend.example.test' }, vlm: { baseUrl: 'https://vlm.example.test/v1', model: 'vision-model' } },
  });
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));
  const invalid = validateResearchBackendConfig({
    schemaVersion: 'wf-search/backend-config.v1',
    backends: { private: { baseUrl: 'https://backend.example.test', apiKey: 'must-not-be-here' } },
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some(error => error.code === 'WFR-CFG006'));
});

test('AC-008 doctor reads remote backend endpoints from the project JSON config', () => {
  const project = fs.mkdtempSync(path.join(ROOT, 'Harness', '.temp', 'wf-research-doctor-config-'));
  const globalDir = path.join(project, 'global');
  try {
    const configPath = path.join(project, 'Harness', 'extensions', 'config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      schemaVersion: 'wf-search/backend-config.v1',
      backends: {
        whisper: { baseUrl: 'https://asr.example.test' },
        vlm: { baseUrl: 'https://vlm.example.test/v1', model: 'vision-model' },
      },
    }));
    const result = run(['doctor', '--toolchain', TOOLCHAIN, '--global-dir', globalDir, '--project', project, '--no-network', '--json']);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.configPath, path.resolve(configPath));
    const tools = new Map(output.report.tools.map(tool => [tool.id, tool]));
    assert.equal(tools.get('whisper-large').status, 'configured-not-checked');
    assert.equal(tools.get('whisper-large').endpointSource, 'json');
    assert.equal(tools.get('vlm-endpoint').status, 'configured-not-checked');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('AC-004 scoring keeps evidence with strong relevance and directness and discards noise with reasons', () => {
  const result = {
    schemaVersion: 'wf-research/result.v1',
    question: 'test',
    checkedAt: '2026-09-18T00:00:00Z',
    plan: { profileId: 'technical-frontier', sourceIds: [], stages: [] },
    operations: [],
    evidence: [
      { id: 'e-strong', sourceId: 'official', url: 'https://example.com/official', title: 'Official', kind: 'paper', excerpt: 'direct evidence', access: 'full', relevance: 1, directness: 1, authority: 1, recency: 0.9, independence: 1, evidenceQuality: 1 },
      { id: 'e-noise', sourceId: 'social', url: 'https://example.com/noise', title: 'Noise', kind: 'social', excerpt: 'unrelated repost', access: 'snippet', relevance: 0.05, directness: 0.1, authority: 0.1, recency: 0.2, independence: 0.1, evidenceQuality: 0.1 },
    ],
    claims: [],
    limitations: [],
  };
  const scored = scoreDeepResearchResult(result, { threshold: 55 });
  const strong = scored.evidence.find(item => item.id === 'e-strong');
  const noise = scored.evidence.find(item => item.id === 'e-noise');
  assert.equal(strong.status, 'kept');
  assert.ok(strong.score >= 90);
  assert.equal(noise.status, 'discarded');
  assert.ok(noise.discardReason);
  assert.deepEqual(scored.decision.keptEvidenceIds, ['e-strong']);
  assert.deepEqual(scored.decision.discardedEvidenceIds, ['e-noise']);
});

test('AC-004 a supported major claim cannot rely only on discarded evidence', () => {
  const result = readJson(BENCHMARK);
  const scored = scoreDeepResearchResult(result, { threshold: 55 });
  const claim = scored.claims.find(item => item.id === 'c-1');
  claim.evidenceIds = ['e-social'];
  claim.status = 'supported';
  claim.confidence = 'high';
  const checked = validateDeepResearchResult(scored);
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some(error => error.code === 'WFR-RES037'));
});

test('AC-005 video result requires bounded timestamped transcript, visual segments, and comments', () => {
  const result = readJson(BENCHMARK);
  const checked = validateDeepResearchResult(result);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.ok(result.video.transcript.some(segment => segment.startMs < segment.endMs));
  assert.ok(result.video.visualSegments.some(segment => segment.evidenceIds.length > 0));
  assert.ok(result.video.comments.some(comment => comment.access === 'visible'));
  assert.ok(result.video.tokenPolicy.globalPass && result.video.tokenPolicy.localPass);
  const workflow = readJson(WORKFLOW);
  assert.ok(workflow.videoPolicy.maxRounds >= 1);
  assert.ok(workflow.videoPolicy.globalMaxFrames >= 1);
  assert.ok(workflow.videoPolicy.localMaxFrames >= 1);
  assert.ok(workflow.videoPolicy.maxVisualTokens >= 1);
  assert.ok(workflow.videoPolicy.replanWhen.length > 0);
});

test('AC-006 benchmark fixture produces a citation-oriented conclusion table', () => {
  const result = readJson(BENCHMARK);
  const scored = scoreDeepResearchResult(result, { threshold: 55 });
  const checked = validateDeepResearchResult(scored);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  const markdown = renderDeepResearchResult(scored);
  assert.match(markdown, /Evidence score/);
  assert.match(markdown, /temporal|时序/i);
  assert.match(markdown, /LongVT|LongVideoAgent/);
  assert.match(markdown, /discarded|丢弃/i);
});

test('AC-007 npm pack ships the wf-research glue layer and extension catalog', () => {
  const result = spawnSync('npm pack --dry-run', { cwd: ROOT, encoding: 'utf8', shell: true, timeout: 30000 });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  for (const entry of [
    'templates/common/Harness/scripts/wf-research.mjs',
    'templates/common/Harness/scripts/lib/wf-research.mjs',
    'templates/common/.claude/commands/wf-search.md',
    'templates/common/.claude/skills/wf-search/SKILL.md',
  ]) assert.match(output, new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('/', '[/\\\\]')));
});
