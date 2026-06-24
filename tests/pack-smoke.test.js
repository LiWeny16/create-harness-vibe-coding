import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('npm pack includes core and optional templates', () => {
  const result =
    process.platform === 'win32'
      ? spawnSync('npm pack --dry-run', { encoding: 'utf8', shell: true })
      : spawnSync('npm', ['pack', '--dry-run'], { encoding: 'utf8' });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /templates\/common\/SETUP\.md|templates\\common\\SETUP\.md/);
  assert.match(output, /templates\/optional\/catalog\.json|templates\\optional\\catalog\.json/);
  assert.match(output, /bin\/create-harness-vibe-coding\.js|bin\\create-harness-vibe-coding\.js/);
  assert.match(output, /templates\/optional\/skills\/[^/\\]+\/\.claude\/skills\/[^/\\]+\/SKILL\.md|templates\\optional\\skills\\[^/\\]+\\.claude\\skills\\[^/\\]+\\SKILL\.md/);
  assert.match(output, /templates\/optional\/skills\/[^/\\]+\/docs\/workflows\/[^/\\]+\.md|templates\\optional\\skills\\[^/\\]+\\docs\\workflows\\[^/\\]+\.md/);
  assert.match(output, /src\/generator\.js|src\\generator\.js/);
  assert.match(output, /README-CN\.md/);
});

test('test script runs unit and smoke tests', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));

  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
  assert.equal(pkg.scripts['test:smoke'], 'node --test tests/cli-smoke.test.js');
  assert.equal(pkg.scripts['pack:smoke'], 'node --test tests/pack-smoke.test.js');
});
