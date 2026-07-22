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
  assert.match(output, /templates\/common\/Harness\/SETUP\.md|templates\\common\\Harness\\SETUP\.md/);
  assert.match(output, /templates\/optional\/catalog\.json|templates\\optional\\catalog\.json/);
  assert.match(output, /bin\/create-harness-vibe-coding\.js|bin\\create-harness-vibe-coding\.js/);
  assert.match(output, /templates\/optional\/skills\/[^/\\]+\/\.claude\/skills\/[^/\\]+\/SKILL\.md|templates\\optional\\skills\\[^/\\]+\\.claude\\skills\\[^/\\]+\\SKILL\.md/);
  assert.match(output, /templates\/optional\/skills\/[^/\\]+\/Harness\/workflows\/[^/\\]+\.md|templates\\optional\\skills\\[^/\\]+\\Harness\\workflows\\[^/\\]+\.md/);
  assert.match(output, /templates\/common\/Harness\/README\.md|templates\\common\\Harness\\README\.md/);
  assert.doesNotMatch(output, /templates\/common\/docs\/README\.md|templates\\common\\docs\\README\.md/);
  assert.match(output, /templates\/common\/\.claude\/commands\/wf-help\.md|templates\\common\\.claude\\commands\\wf-help\.md/);
  assert.doesNotMatch(output, /templates\/common\/commands\/wf|templates\\common\\commands\\wf/);
  assert.doesNotMatch(output, /templates\/common\/\.claude\/commands\/wf(?:\.md|-(?:max|auto|review|learn|browser|readme|remove))(?:\/|\.md)|templates\\common\\.claude\\commands\\wf(?:\.md|-(?:max|auto|review|learn|browser|readme|remove))(?:\\|\.md)/);
  assert.doesNotMatch(output, /templates\/optional\/skills\/[^/\\]+\/\.claude\/commands|templates\\optional\\skills\\[^/\\]+\\.claude\\commands/);
  assert.doesNotMatch(output, /commands\/wf\.toml|commands\\wf\.toml/);
  assert.match(output, /src\/generator\.js|src\\generator\.js/);
  assert.match(output, /README-CN\.md/);
  assert.doesNotMatch(output, /\.agents\.bak|\\agents\.bak/);
});

test('test script runs unit and smoke tests', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));

  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
  assert.equal(pkg.scripts['check:mirrors'], 'node scripts/check-update-mirrors.mjs');
  assert.equal(pkg.scripts['test:smoke'], 'node --test tests/cli-smoke.test.js');
  assert.equal(pkg.scripts['pack:smoke'], 'node --test tests/pack-smoke.test.js');
});
