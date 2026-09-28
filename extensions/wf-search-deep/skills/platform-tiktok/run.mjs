#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function fail(message) {
  process.stdout.write(`${JSON.stringify({ ok: false, errors: [{ code: 'TIKTOK-SKILL001', path: '$', message }] }, null, 2)}\n`);
  process.exitCode = 1;
}

function parse(argv) {
  const args = { _: [], json: false };
  const values = new Set(['url', 'output-dir', 'runtime-root', 'downloader-script', 'region']);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--json') { args.json = true; continue; }
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2);
    if (!values.has(key)) throw new Error(`unknown option: --${key}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    args[key] = value;
  }
  return args;
}

function assertUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('--url must be an HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('--url must be an HTTP(S) URL');
}

function safeStem(url, metadata = {}) {
  const id = metadata.id || url.match(/\/video\/(\d+)/)?.[1] || 'tiktok-video';
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'tiktok-video';
}

function runtimeNodeRoot(runtimeRoot) {
  const root = path.resolve(runtimeRoot);
  const nodeRoot = path.join(root, 'node');
  const packageJson = path.join(nodeRoot, 'node_modules', '@ssut', 'tiktok-api', 'package.json');
  if (!fs.existsSync(packageJson)) throw new Error(`tiktok-api package is missing: ${packageJson}`);
  return nodeRoot;
}

function defaultDownloader(runtimeRoot) {
  return path.resolve(runtimeRoot, '..', '..', '..', '..', 'scripts', 'wf-search-download.mjs');
}

function apiScript(url, region) {
  return `import { TikTokClient } from '@ssut/tiktok-api';
const client = new TikTokClient({ region: ${JSON.stringify(region || 'US')} });
const response = await client.downloadVideo(${JSON.stringify(url)});
if (response?.status !== 'success' || response?.result?.type !== 'video') throw new Error('tiktok-api returned no video');
const video = response.result.video || {};
const formats = Array.isArray(video.formats) ? video.formats : [];
const selected = formats.find(item => item.format_id === 'play_addr_h264') || formats.find(item => item.vcodec === 'h264') || formats[0];
if (!selected?.url) throw new Error('tiktok-api returned no downloadable format');
process.stdout.write(JSON.stringify({
  mediaUrl: selected.url,
  metadata: {
    id: video.id || null,
    desc: video.desc || null,
    author: video.author?.unique_id || video.author?.nickname || null,
    duration: video.duration || null,
    width: selected.width || null,
    height: selected.height || null,
    formatId: selected.format_id || null,
    resolution: selected.resolution || null,
    formatNote: selected.format_note || null,
    hasWatermark: selected.has_watermark ?? null
  }
}));`;
}

function run(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-12000); });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-12000); });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => !name.endsWith('.part'));
}

async function main() {
  const args = parse(process.argv.slice(2));
  const url = args.url || args._[0];
  if (!url || !args['output-dir'] || !args['runtime-root']) throw new Error('--url, --output-dir, and --runtime-root are required');
  assertUrl(url);
  const runtimeRoot = path.resolve(args['runtime-root']);
  const nodeRoot = runtimeNodeRoot(runtimeRoot);
  const outputDir = path.resolve(args['output-dir']);
  fs.mkdirSync(outputDir, { recursive: true });
  const api = await run(process.env.WF_SEARCH_NODE || 'node', ['--input-type=module', '-e', apiScript(url, args.region)], { cwd: nodeRoot });
  if (api.status !== 0) throw new Error(`tiktok-api failed: ${api.stderr.trim().slice(-1000)}`);
  let payload;
  try { payload = JSON.parse(api.stdout.trim()); } catch { throw new Error('tiktok-api returned invalid JSON'); }
  if (!payload.mediaUrl) throw new Error('tiktok-api returned no media URL');
  const stem = safeStem(url, payload.metadata);
  const metadataPath = path.join(outputDir, `${stem}.tiktok.json`);
  fs.writeFileSync(metadataPath, `${JSON.stringify(payload.metadata || {}, null, 2)}\n`, 'utf8');
  const downloader = path.resolve(args['downloader-script'] || defaultDownloader(runtimeRoot));
  const download = await run(process.env.WF_SEARCH_NODE || 'node', [downloader, '--url', payload.mediaUrl, '--output-dir', outputDir, '--runtime-root', runtimeRoot, '--tool', 'yt-dlp', '--format', 'best', '--no-subs', '--no-info-json', '--output-name', stem, '--json']);
  if (download.status !== 0) throw new Error(`yt-dlp failed: ${download.stderr.replace(/https?:\/\/\S+/g, '[redacted-url]').trim().slice(-1500)}`);
  let result;
  try { result = JSON.parse(download.stdout.trim()); } catch { throw new Error('yt-dlp returned invalid JSON'); }
  const output = {
    ok: Boolean(result.ok),
    status: result.status,
    signal: result.signal,
    tool: 'platform-tiktok:@ssut/tiktok-api+yt-dlp',
    url,
    outputDir,
    metadataPath,
    metadata: payload.metadata || {},
    files: filesIn(outputDir),
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { await main(); } catch (error) { fail(error.message || String(error)); }
}
