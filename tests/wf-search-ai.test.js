import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeHarnessTempRoot } from './support/temp-root.js';

const ROOT = path.resolve('.');
const PATCH = path.join(ROOT, 'templates', 'common', 'Harness', 'integrations', 'wf-search', 'whisper', 'patch-ai-whisper.py');
const SWITCH = path.join(ROOT, 'templates', 'common', 'Harness', 'integrations', 'wf-search', 'whisper', 'switch.sh');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'wf-search', 'ai-base.sh');

test('AC-001 patch contract gives ai on an explicit qwen/minimax/whisper grammar', () => {
  const patch = fs.readFileSync(PATCH, 'utf8');
  assert.match(patch, /AI_TARGET/);
  assert.match(patch, /action=\"\$\{2:-qwen\}\"/);
  assert.match(patch, /qwen\)/);
  assert.match(patch, /minimax\)/);
  assert.match(patch, /whisper\)/);
  assert.match(patch, /default.*qwen|qwen.*default/i);
});

test('AC-002 patch contract makes ai off stop all model families and clean VRAM', () => {
  const patch = fs.readFileSync(PATCH, 'utf8');
  assert.match(patch, /systemctl stop llama-server/);
  assert.match(patch, /WHISPER_UNIT=.*whisper-server/);
  assert.match(patch, /_minimax_off_quiet/);
  assert.match(patch, /drop_caches/);
});

test('AC-003 patch is executable against a sanitized ai fixture and leaves switch as the switching surface', () => {
  const temp = makeHarnessTempRoot('wf-search-ai-');
  try {
    const target = path.join(temp, 'ai');
    fs.copyFileSync(FIXTURE, target);
    const result = spawnSync('python', [PATCH], { encoding: 'utf8', env: { ...process.env, AI_TARGET: target } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const patched = fs.readFileSync(target, 'utf8');
    assert.match(patched, /action=\"\$\{2:-qwen\}\"/);
    assert.match(patched, /case \"\$action\"/);
    assert.match(patched, /switch \[fast\|max\|vision\|official\|whisper\]/);
    assert.match(patched, /systemctl stop llama-server/);
    assert.match(patched, /systemctl stop.*WHISPER_UNIT/);
    assert.match(patched, /echo whisper > "\$P\/\.current"/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('AC-003 Whisper switcher retains ai switch as the model-switching operation', () => {
  const switcher = fs.readFileSync(SWITCH, 'utf8');
  assert.match(switcher, /PROFILE.*whisper/);
  assert.match(switcher, /systemctl stop llama-server/);
  assert.match(switcher, /WHISPER_UNIT=.*whisper-server/);
  assert.match(switcher, /\.current/);
  assert.match(switcher, /127\.0\.0\.1:8080\/health/);
});
