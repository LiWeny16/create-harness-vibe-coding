import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { makeHarnessTempRoot } from './support/temp-root.js';

const ROOT = path.resolve('.');
const ROOT_HELPER = path.join(ROOT, 'Harness', 'scripts', 'wf-search-video.mjs');
const TEMPLATE_HELPER = path.join(ROOT, 'templates', 'common', 'Harness', 'scripts', 'wf-search-video.mjs');
const VALID_FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'wf-search', 'video-transcript.json');
const tempDirs = [];

function tempDir(prefix) {
  const dir = makeHarnessTempRoot(prefix);
  tempDirs.push(dir);
  return dir;
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [ROOT_HELPER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
    ...options,
  });
}

function runAsync(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ROOT_HELPER, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('AC-001 wf-search is thin adapter without legacy references', () => {
  // Old reference paths should NOT exist in any skill tree
  const oldRefs = [
    'references/platform-adapters.md',
    'references/video-research.md',
  ];
  for (const rel of oldRefs) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'templates', 'common', '.claude', 'skills', 'wf-search', rel)), `${rel} should not exist`);
    assert.ok(!fs.existsSync(path.join(ROOT, '.claude', 'skills', 'wf-search', rel)), `${rel} should not exist`);
    assert.ok(!fs.existsSync(path.join(ROOT, '.agents', 'skills', 'wf-search', rel)), `${rel} should not exist`);
  }
  
  // SKILL.md should not reference old files
  for (const skillPath of [
    path.join(ROOT, 'templates', 'common', '.claude', 'skills', 'wf-search', 'SKILL.md'),
    path.join(ROOT, '.claude', 'skills', 'wf-search', 'SKILL.md'),
    path.join(ROOT, '.agents', 'skills', 'wf-search', 'SKILL.md'),
  ]) {
    const skill = fs.readFileSync(skillPath, 'utf8');
    for (const ref of oldRefs) {
      const fileName = path.basename(ref);
      assert.ok(!skill.includes(fileName), `${path.basename(skillPath)} should not reference ${fileName}`);
    }
  }
  
  // Registry should still register the packages
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'Harness', 'extensions', 'registry.json'), 'utf8'));
  const expected = ['wf-search-media', 'wf-search-asr', 'wf-search-vlm'];
  for (const id of expected) {
    assert.ok(registry.extensions.some(e => e.id === id), `registry should include ${id}`);
  }
});

test('AC-002 video helper validates and searches a timestamped transcript', () => {
  const result = run(['validate', '--input', VALID_FIXTURE, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);

  const search = run(['search', '--input', VALID_FIXTURE, '--query', '模型']);
  assert.equal(search.status, 0, search.stderr || search.stdout);
  const found = JSON.parse(search.stdout);
  assert.equal(found.matches.length, 1);
  assert.equal(found.matches[0].startMs, 1200);
  assert.equal(found.matches[0].endMs, 2600);
});

test('AC-002 video helper rejects malformed segment timestamps', () => {
  const dir = tempDir('wf-search-video-red-');
  const input = path.join(dir, 'bad.json');
  const document = JSON.parse(fs.readFileSync(VALID_FIXTURE, 'utf8'));
  document.segments[0].endMs = document.segments[0].startMs;
  fs.writeFileSync(input, JSON.stringify(document));
  const result = run(['validate', '--input', input, '--json']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /endMs/);
});

test('AC-002 video helper wraps a mocked ASR response without exposing request headers', async () => {
  const dir = tempDir('wf-search-video-asr-');
  const audio = path.join(dir, 'sample.wav');
  fs.writeFileSync(audio, Buffer.from('RIFFwf-search-test'));
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/transcribe');
    assert.equal(req.headers['cookie'], undefined);
    let bytes = 0;
    req.on('data', chunk => { bytes += chunk.length; });
    req.on('end', () => {
      assert.ok(bytes > 0);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        language: 'zh',
        language_probability: 0.99,
        model: 'large-v3',
        segments: [{ id: 0, start: 1.2, end: 2.6, text: '模型成功。' }],
      }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const output = path.join(dir, 'out.json');
    const result = await runAsync([
      'transcribe', '--input', audio, '--endpoint', `http://127.0.0.1:${address.port}/transcribe`,
      '--url', 'https://example.com/video', '--title', '测试视频', '--platform', 'youtube', '--output', output,
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const transcript = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(transcript.schemaVersion, 'wf-search/video-transcript.v1');
    assert.equal(transcript.source, 'asr');
    assert.equal(transcript.segments[0].startMs, 1200);
    assert.equal(transcript.segments[0].endMs, 2600);
    assert.equal(transcript.video.url, 'https://example.com/video');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('AC-002 video helper resolves Whisper from the separate JSON backend config', async () => {
  const dir = tempDir('wf-search-video-config-');
  const audio = path.join(dir, 'sample.wav');
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(audio, Buffer.from('RIFFwf-search-config-test'));
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/transcribe');
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ language: 'en', model: 'large-v3', segments: [{ start: 0, end: 1, text: 'configured backend works' }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    fs.writeFileSync(config, JSON.stringify({
      schemaVersion: 'wf-search/backend-config.v1',
      backends: { whisper: { baseUrl: `http://127.0.0.1:${address.port}` } },
    }));
    const result = await runAsync(['transcribe', '--input', audio, '--config', config, '--backend', 'whisper']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.transcript.segments[0].text, 'configured backend works');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('AC-002 root and template video helpers are mirrored', () => {
  assert.ok(fs.existsSync(ROOT_HELPER));
  assert.ok(fs.existsSync(TEMPLATE_HELPER));
  assert.equal(fs.readFileSync(ROOT_HELPER, 'utf8').replace(/\r\n/g, '\n'), fs.readFileSync(TEMPLATE_HELPER, 'utf8').replace(/\r\n/g, '\n'));
});

test('AC-003 Whisper deployment artifacts are mirrored and stay localhost-only', () => {
  const files = [
    'Harness/integrations/wf-search/whisper/whisper_server.py',
    'Harness/integrations/wf-search/whisper/whisper-server@.service',
    'Harness/integrations/wf-search/whisper/switch.sh',
    'Harness/integrations/wf-search/whisper/patch-ai-whisper.py',
  ];
  for (const rel of files) {
    const template = path.join(ROOT, 'templates', 'common', rel);
    const root = path.join(ROOT, rel);
    assert.ok(fs.existsSync(template), `missing template artifact: ${rel}`);
    assert.ok(fs.existsSync(root), `missing root artifact: ${rel}`);
    assert.equal(fs.readFileSync(root, 'utf8').replace(/\r\n/g, '\n'), fs.readFileSync(template, 'utf8').replace(/\r\n/g, '\n'), rel);
  }
  const service = fs.readFileSync(path.join(ROOT, 'templates', 'common', files[1]), 'utf8');
  assert.match(service, /Environment=WHISPER_HOST=127\.0\.0\.1/);
  assert.match(service, /Environment=WHISPER_MODEL=large-v3/);
  assert.match(service, /User=%i/);
  assert.match(service, /WorkingDirectory=%h\/ai\/whisper/);
  assert.doesNotMatch(service, /\/home\/onion/);
  assert.match(service, /HF_HUB_DISABLE_XET=1/);
  const switcher = fs.readFileSync(path.join(ROOT, 'templates', 'common', files[2]), 'utf8');
  assert.match(switcher, /PROFILE.*whisper/);
  assert.match(switcher, /127\.0\.0\.1:8090\/health/);
  assert.doesNotMatch(switcher, /\/home\/onion/);
});
