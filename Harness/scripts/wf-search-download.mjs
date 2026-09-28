#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = new Set(['yt-dlp', 'gallery-dl']);
const HELP = `wf-search media downloader

Usage:
  node Harness/scripts/wf-search-download.mjs --url <video-url> --output-dir <dir> [options]

Options:
  --tool yt-dlp|gallery-dl --runtime-root <global-runtime>
  --cookies-from-browser <browser[:profile]> --format <selector>
  --output-name <safe-stem> --playlist --no-subs --no-info-json --json

The downloader is a transparent runner for the optional GitHub-backed adapter.
It never accepts a cookie file or prints session material. Browser/session
access remains user-provided and platform terms and rate limits still apply.`;

function fail(message, code = 'WFD-CLI001') {
  process.stdout.write(`${JSON.stringify({ ok: false, errors: [{ code, path: '$', message }] }, null, 2)}\n`);
  process.exitCode = 1;
}

function parse(argv) {
  const args = { _: [], tool: 'yt-dlp', noPlaylist: true, writeSubs: true };
  const valueOptions = new Set(['url', 'output-dir', 'runtime-root', 'cookies-from-browser', 'format', 'tool', 'output-name']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') { args.help = true; continue; }
    if (token === '--json') { args.json = true; continue; }
    if (token === '--playlist') { args.noPlaylist = false; continue; }
    if (token === '--no-subs') { args.writeSubs = false; continue; }
    if (token === '--no-info-json') { args.writeInfoJson = false; continue; }
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2);
    if (!valueOptions.has(key)) throw new Error(`unknown option: --${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function assertUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('--url must be an HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--url must be an HTTP(S) URL');
}

function resolvePython(runtimeRoot) {
  if (!runtimeRoot) return 'python';
  const root = path.resolve(runtimeRoot);
  const candidate = process.platform === 'win32'
    ? path.join(root, 'python', 'Scripts', 'python.exe')
    : path.join(root, 'python', 'bin', 'python');
  if (!fs.existsSync(candidate)) throw new Error(`extension runtime Python is missing: ${candidate}`);
  return candidate;
}

function safeStem(value) {
  const stem = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
  return stem || 'download';
}

export function buildDownloadInvocation({
  url,
  outputDir,
  tool = 'yt-dlp',
  runtimeRoot,
  cookiesFromBrowser,
  format,
  noPlaylist = true,
  writeSubs = true,
  writeInfoJson = true,
  outputName,
} = {}) {
  if (!TOOLS.has(tool)) throw new Error(`unsupported downloader: ${tool}`);
  if (typeof url !== 'string' || url.trim() === '') throw new Error('--url is required');
  assertUrl(url);
  if (typeof outputDir !== 'string' || outputDir.trim() === '') throw new Error('--output-dir is required');
  if (cookiesFromBrowser && /[\r\n]/.test(cookiesFromBrowser)) throw new Error('--cookies-from-browser must be one browser/profile token');
  const python = resolvePython(runtimeRoot);
  const module = tool === 'yt-dlp' ? 'yt_dlp' : 'gallery_dl';
  const args = ['-m', module];
  if (tool === 'yt-dlp') {
    if (noPlaylist) args.push('--no-playlist');
    args.push('--paths', `home:${path.resolve(outputDir)}`);
    args.push('--output', outputName ? `${safeStem(outputName)}.%(ext)s` : '%(extractor)s/%(uploader_id)s/%(id)s.%(ext)s');
    if (writeInfoJson) args.push('--write-info-json');
    if (writeSubs) args.push('--write-subs', '--sub-langs', 'all', '--sub-format', 'vtt');
    if (format) args.push('--format', format);
  } else {
    args.push('--directory', path.resolve(outputDir));
  }
  if (cookiesFromBrowser) args.push('--cookies-from-browser', cookiesFromBrowser);
  args.push(url);
  return { command: python, args, tool, url, outputDir: path.resolve(outputDir), runtimeRoot };
}

export function runDownload(invocation, { spawnImpl = spawn } = {}) {
  fs.mkdirSync(invocation.outputDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawnImpl(invocation.command, invocation.args, { cwd: invocation.cwd || invocation.outputDir, stdio: ['ignore', 'pipe', 'pipe'], shell: false, env: { ...process.env, ...(invocation.env || {}) } });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-8000); });
    child.stderr?.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-8000); });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({
      ok: code === 0,
      status: code,
      signal,
      tool: invocation.tool,
      url: invocation.url,
      outputDir: invocation.outputDir,
      stdout,
      stderr,
    }));
  });
}

async function main() {
  let args;
  try { args = parse(process.argv.slice(2)); }
  catch (error) { fail(error.message); return; }
  if (args.help || (args._.length === 0 && args.url === undefined)) { process.stdout.write(`${HELP}\n`); return; }
  try {
    const url = args.url || args._[0];
    const invocation = buildDownloadInvocation({
      url,
      outputDir: args['output-dir'],
      tool: args.tool,
      runtimeRoot: args['runtime-root'],
      cookiesFromBrowser: args['cookies-from-browser'],
      format: args.format,
      noPlaylist: args.noPlaylist,
      writeSubs: args.writeSubs,
      writeInfoJson: args.writeInfoJson !== false,
      outputName: args['output-name'],
    });
    const result = await runDownload(invocation);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) { fail(error.message || String(error), 'WFD-CLI002'); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
