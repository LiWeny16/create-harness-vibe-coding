import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadSettings, resolveSettings } from '../settings.mjs';
import { RUNTIME_DEFINITIONS } from '../runtime-detector.mjs';

const DEFAULTS = {
  server: { host: '127.0.0.1', port: 0 },
  terminal: { enabled: false, attachMode: false, defaultRuntime: 'codex' },
  peers: { allowlist: RUNTIME_DEFINITIONS.map(runtime => runtime.id) },
  ui: { theme: 'auto', language: 'en', reducedMotion: false },
};

describe('settings', () => {
  let baseDir;

  before(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-test-'));
  });

  after(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  test('loadSettings returns defaults when no settings.json exists', () => {
    const settings = loadSettings(baseDir);
    assert.deepEqual(settings, DEFAULTS);
  });

  test('project settings override defaults', () => {
    const projectDir = path.join(baseDir, 'override-test');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'Harness'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'Harness', 'settings.json'),
      JSON.stringify({
        server: { port: 3456 },
        ui: { language: 'zh-CN' },
      })
    );

    const settings = loadSettings(projectDir);

    assert.equal(settings.server.host, '127.0.0.1'); // from defaults
    assert.equal(settings.server.port, 3456); // from project
    assert.equal(settings.ui.language, 'zh-CN'); // from project
    assert.equal(settings.ui.theme, 'auto'); // from defaults
    assert.equal(settings.terminal.enabled, false); // from defaults
    assert.deepEqual(settings.peers.allowlist, RUNTIME_DEFINITIONS.map(runtime => runtime.id)); // from defaults
  });

  test('unknown keys are silently ignored in project settings', () => {
    const projectDir = path.join(baseDir, 'unknown-keys');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'Harness'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'Harness', 'settings.json'),
      JSON.stringify({
        unknownKey: 'should-be-ignored',
        nestedUnknown: { inner: 'also-ignored' },
        server: { host: '0.0.0.0' },
      })
    );

    const settings = loadSettings(projectDir);

    assert.equal(settings.server.host, '0.0.0.0');
    assert.equal(settings.server.port, 0);
    // unknown keys should not appear
    assert.equal(Object.hasOwn(settings, 'unknownKey'), false);
    assert.equal(Object.hasOwn(settings, 'nestedUnknown'), false);
  });

  test('missing required keys get default values', () => {
    const projectDir = path.join(baseDir, 'missing-keys');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'Harness'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'Harness', 'settings.json'),
      JSON.stringify({
        server: { host: '0.0.0.0' },
      })
    );

    const settings = loadSettings(projectDir);

    assert.equal(settings.server.host, '0.0.0.0');
    assert.equal(settings.server.port, 0); // default, not provided
    assert.equal(settings.terminal.enabled, false); // default, not provided
  });

  test('nested settings merge correctly (not full replace)', () => {
    const projectDir = path.join(baseDir, 'nested-merge');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'Harness'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'Harness', 'settings.json'),
      JSON.stringify({
        server: { port: 8080 },
        peers: { allowlist: ['claude'] },
      })
    );

    const settings = loadSettings(projectDir);

    // server.host came from defaults, server.port from project
    assert.equal(settings.server.host, '127.0.0.1');
    assert.equal(settings.server.port, 8080);
    // peers.allowlist replaced (not merged)
    assert.deepEqual(settings.peers.allowlist, ['claude']);
    // ui fully from defaults
    assert.equal(settings.ui.theme, 'auto');
    assert.equal(settings.ui.language, 'en');
  });

  test('resolveSettings returns the merged result from loadSettings', () => {
    const projectDir = path.join(baseDir, 'resolve-test');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'Harness'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'Harness', 'settings.json'),
      JSON.stringify({
        terminal: { enabled: true },
      })
    );

    // resolveSettings takes a precedence object (project root overrides)
    const settings = resolveSettings({ projectRoot: projectDir });

    assert.equal(settings.terminal.enabled, true);
    assert.equal(settings.server.host, '127.0.0.1');
  });
});
