import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRuntimeConfig, writeRuntimeConfig } from '../runtime-config.mjs';

test('writeRuntimeConfig writes project JSON model fields', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-config-'));
  try {
    const result = writeRuntimeConfig(projectRoot, 'opencode', {
      scope: 'project',
      values: { model: 'anthropic/claude-sonnet-4' },
    });
    assert.equal(result.path, 'opencode.json');
    const configPath = path.join(projectRoot, 'opencode.json');
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).model, 'anthropic/claude-sonnet-4');
    const readback = readRuntimeConfig(projectRoot, 'opencode');
    assert.equal(readback.files.find(file => file.scope === 'project').values.model, 'anthropic/claude-sonnet-4');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('writeRuntimeConfig writes project TOML fields and backs up existing file', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-config-'));
  try {
    const configPath = path.join(projectRoot, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'model = "old-model"\n', 'utf8');
    const result = writeRuntimeConfig(projectRoot, 'codex', {
      scope: 'project',
      values: { model: 'gpt-5', provider: 'openai' },
    });
    assert.ok(result.backupPath);
    assert.ok(fs.existsSync(result.backupPath));
    const text = fs.readFileSync(configPath, 'utf8');
    assert.match(text, /model = "gpt-5"/);
    assert.match(text, /model_provider = "openai"/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
