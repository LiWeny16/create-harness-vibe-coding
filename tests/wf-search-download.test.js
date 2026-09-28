import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildDownloadInvocation } from '../Harness/scripts/wf-search-download.mjs';
import { makeHarnessTempRoot } from './support/temp-root.js';

const ROOT = path.resolve('.');
const SCRIPT = path.join(ROOT, 'Harness', 'scripts', 'wf-search-download.mjs');
const TEMPLATE = path.join(ROOT, 'templates', 'common', 'Harness', 'scripts', 'wf-search-download.mjs');

test('AC-004 media downloader delegates YouTube/TikTok/X/Bilibili URLs to yt-dlp', () => {
  const outputDir = makeHarnessTempRoot('wf-search-download-');
  try {
    const invocation = buildDownloadInvocation({
      url: 'https://www.youtube.com/watch?v=example',
      outputDir,
      tool: 'yt-dlp',
      cookiesFromBrowser: 'chrome:Default',
    });
    assert.equal(invocation.tool, 'yt-dlp');
    assert.equal(invocation.args[0], '-m');
    assert.equal(invocation.args[1], 'yt_dlp');
    assert.ok(invocation.args.includes('--write-info-json'));
    assert.equal(invocation.args[invocation.args.indexOf('--paths') + 1], `home:${path.resolve(outputDir)}`);
    assert.ok(invocation.args.includes('--cookies-from-browser'));
    assert.ok(invocation.args.includes('chrome:Default'));
    assert.equal(invocation.args.some(value => /cookies?\.txt|api[_-]?key|authorization/i.test(value)), false);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('AC-004 gallery-dl is available as a social collection fallback without a cookie file', () => {
  const outputDir = makeHarnessTempRoot('wf-search-gallery-download-');
  try {
    const invocation = buildDownloadInvocation({
      url: 'https://x.com/example/status/1',
      outputDir,
      tool: 'gallery-dl',
    });
    assert.equal(invocation.args[1], 'gallery_dl');
    assert.equal(invocation.args.includes('--directory'), true);
    assert.equal(invocation.args.some(value => /cookie/i.test(value)), false);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('AC-004 generic downloader supports safe skill-owned output names without info sidecars', () => {
  const outputDir = makeHarnessTempRoot('wf-search-download-generic-');
  try {
    const invocation = buildDownloadInvocation({
      url: 'https://cdn.example.test/video.mp4',
      outputDir,
      tool: 'yt-dlp',
      outputName: '7106594312292453675',
      writeInfoJson: false,
    });
    assert.equal(invocation.args.includes('--write-info-json'), false);
    assert.equal(invocation.args[invocation.args.indexOf('--output') + 1], '7106594312292453675.%(ext)s');
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('AC-004 downloader CLI exposes the optional GitHub-backed adapter contract and mirrors templates', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /yt-dlp\|gallery-dl/);
  assert.match(result.stdout, /--no-info-json/);
  assert.equal(fs.readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n'), fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n'));
});
