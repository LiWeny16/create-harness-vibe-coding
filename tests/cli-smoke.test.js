import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { makeHarnessTempRoot } from './support/temp-root.js';
import { execFileSync, spawnSync } from 'node:child_process';

const bin = path.resolve('bin/create-harness-vibe-coding.js');

const tempRoots = [];
function tmpdir() {
  const root = makeHarnessTempRoot('harness-cli-');
  tempRoots.push(root);
  return root;
}
after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function writeUpdateStub(target, script = "console.log(JSON.stringify({ status: 'up-to-date', cwd: process.cwd(), args: process.argv.slice(2), sourceBase: process.env.WF_SOURCE_BASE }));\n") {
  fs.mkdirSync(path.join(target, 'Harness', 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(target, 'Harness', 'scripts', 'wf-update-check.mjs'),
    script,
    'utf8',
  );
}

async function waitForPathGone(target, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (fs.existsSync(target)) {
    if (Date.now() >= deadline) assert.fail(`${target} was not cleaned up`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function reservePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
  });
}

async function reservePortWithFreeNext() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const blocker = await reservePort(0);
    const port = blocker.address().port;
    if (port >= 65535) {
      await closeServer(blocker);
      continue;
    }
    try {
      const next = await reservePort(port + 1);
      await closeServer(next);
      return { blocker, port };
    } catch {
      await closeServer(blocker);
    }
  }
  throw new Error('could not find a reserved port with the next port free');
}

test('wf-ui --detach prints URL and leaves server running after launcher exits', async () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const launchRoot = path.join(root, 'Harness', '.temp', 'wf-ui-launch');
  const beforeTemp = new Set(
    fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('harness-wf-ui-')),
  );
  let ready = null;
  let launchDir = null;

  try {
    const env = { ...process.env };
    delete env.HARNESS_WF_UI_READY_FILE;
    const result = spawnSync(
      process.execPath,
      [bin, 'wf-ui', '--project', root, '--host', '127.0.0.1', '--port', '0', '--no-open', '--detach'],
      {
        encoding: 'utf8',
        timeout: 20000,
        env,
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    const stdoutUrl = result.stdout.trim().match(/\[wf-ui\] (http:\/\/127\.0\.0\.1:\d+\/)$/)?.[1];
    assert.ok(stdoutUrl, result.stdout);
    assert.equal(new URL(stdoutUrl).searchParams.has('token'), false);
    const launchDirs = fs.readdirSync(launchRoot).filter(name => name.startsWith('harness-wf-ui-'));
    assert.equal(launchDirs.length, 1, 'detached launcher should use a project-local launch dir');
    launchDir = path.join(launchRoot, launchDirs[0]);
    const readyFile = path.join(launchDir, 'ready.json');
    const logFile = path.join(launchDir, 'wf-ui.log');
    assert.ok(fs.existsSync(readyFile), 'detached child should write ready file');
    assert.ok(fs.existsSync(logFile), 'detached child should write log file beside ready file');
    const afterTemp = new Set(
      fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('harness-wf-ui-')),
    );
    assert.deepEqual([...afterTemp].filter(name => !beforeTemp.has(name)), []);

    ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
    const startedUrl = new URL(ready.url);
    assert.equal(startedUrl.searchParams.has('token'), false);
    const healthUrl = new URL('/api/health', startedUrl);
    const response = await fetch(healthUrl);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
  } finally {
    if (ready?.pid) {
      try { process.kill(ready.pid, 'SIGTERM'); } catch {}
    }
    if (launchDir) await waitForPathGone(launchDir);
  }
});

test('AC-001 wf-ui without --port defaults to 56670 and falls forward when occupied', async () => {
  let blocker = null;
  let exactExpectedPort = '56671';
  try {
    blocker = await reservePort(56670);
  } catch (err) {
    if (err?.code === 'EADDRINUSE') {
      exactExpectedPort = null;
    } else {
      throw err;
    }
  }
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const launchRoot = path.join(root, 'Harness', '.temp', 'wf-ui-launch');
  let ready = null;
  let launchDir = null;

  try {
    const env = { ...process.env };
    delete env.HARNESS_WF_UI_READY_FILE;
    const result = spawnSync(
      process.execPath,
      [bin, 'wf-ui', '--project', root, '--host', '127.0.0.1', '--no-open', '--detach'],
      {
        encoding: 'utf8',
        timeout: 20000,
        env,
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    const stdoutUrl = result.stdout.trim().match(/\[wf-ui\] (http:\/\/127\.0\.0\.1:\d+\/)$/)?.[1];
    assert.ok(stdoutUrl, result.stdout);
    const selectedPort = new URL(stdoutUrl).port;
    if (exactExpectedPort) {
      assert.equal(selectedPort, exactExpectedPort);
    } else {
      assert.ok(Number(selectedPort) >= 56671, `expected fallback port >= 56671, got ${selectedPort}`);
    }

    const launchDirs = fs.readdirSync(launchRoot).filter(name => name.startsWith('harness-wf-ui-'));
    assert.equal(launchDirs.length, 1, 'detached launcher should use a project-local launch dir');
    launchDir = path.join(launchRoot, launchDirs[0]);
    ready = JSON.parse(fs.readFileSync(path.join(launchDir, 'ready.json'), 'utf8'));
    assert.equal(new URL(ready.url).port, selectedPort);
  } finally {
    if (ready?.pid) {
      try { process.kill(ready.pid, 'SIGTERM'); } catch {}
    }
    if (launchDir) await waitForPathGone(launchDir);
    if (blocker) await closeServer(blocker);
  }
});

test('AC-002 wf-ui explicit nonzero occupied port falls forward to the next free port', async () => {
  const { blocker, port } = await reservePortWithFreeNext();
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  const launchRoot = path.join(root, 'Harness', '.temp', 'wf-ui-launch');
  let ready = null;
  let launchDir = null;

  try {
    const env = { ...process.env };
    delete env.HARNESS_WF_UI_READY_FILE;
    const result = spawnSync(
      process.execPath,
      [bin, 'wf-ui', '--project', root, '--host', '127.0.0.1', '--port', String(port), '--no-open', '--detach'],
      {
        encoding: 'utf8',
        timeout: 20000,
        env,
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    const stdoutUrl = result.stdout.trim().match(/\[wf-ui\] (http:\/\/127\.0\.0\.1:\d+\/)$/)?.[1];
    assert.ok(stdoutUrl, result.stdout);
    assert.equal(new URL(stdoutUrl).port, String(port + 1));

    const launchDirs = fs.readdirSync(launchRoot).filter(name => name.startsWith('harness-wf-ui-'));
    assert.equal(launchDirs.length, 1, 'detached launcher should use a project-local launch dir');
    launchDir = path.join(launchRoot, launchDirs[0]);
    ready = JSON.parse(fs.readFileSync(path.join(launchDir, 'ready.json'), 'utf8'));
    assert.equal(new URL(ready.url).port, String(port + 1));
  } finally {
    if (ready?.pid) {
      try { process.kill(ready.pid, 'SIGTERM'); } catch {}
    }
    if (launchDir) await waitForPathGone(launchDir);
    await closeServer(blocker);
  }
});

test('--help documents existing-project flags and optional skills', () => {
  const output = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.match(output, /--dry-run/);
  assert.match(output, /--on-conflict/);
  assert.match(output, /--with/);
  assert.match(output, /--without/);
  assert.match(output, /--preset/);
  assert.match(output, /--install-scope/);
  assert.match(output, /--global-dir/);
  assert.match(output, /--host-global-dir/);
  assert.match(output, /--recommend/);
  assert.match(output, /--list-options/);
  assert.match(output, /interactive mode offers checkbox selection/i);
});

test('--dry-run prints plan and does not create target', () => {
  const root = tmpdir();
  const target = path.join(root, 'dry-app');
  const output = execFileSync(process.execPath, [bin, 'dry-app', target, '-y', '--dry-run'], { encoding: 'utf8' });

  assert.match(output, /Dry run/i);
  assert.match(output, /create/i);
  assert.doesNotMatch(output, /Generation complete/i);
  assert.equal(fs.existsSync(target), false);
});

test('--dry-run prints full plan for existing project conflicts without writing', () => {
  const root = tmpdir();
  const target = path.join(root, 'legacy');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');

  const result = spawnSync(process.execPath, [bin, 'legacy', target, '-y', '--dry-run'], { encoding: 'utf8' });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /Dry run/i);
  assert.match(output, /create:/i);
  assert.match(output, /conflict:/i);
  assert.match(output, /CLAUDE\.md/);
  assert.match(output, /confirm refactoring or merging/i);
  assert.match(output, /tests\/\.gitkeep/);
  assert.doesNotMatch(output, /\.\.\. \d+ more/);
  assert.doesNotMatch(output, /Generation complete/i);
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
  assert.equal(fs.existsSync(path.join(target, 'SETUP.md')), false);
  assert.equal(fs.existsSync(path.join(target, 'Harness', 'SETUP.md')), false);
});

test('existing project default conflict exits non-zero and preserves file', () => {
  const root = tmpdir();
  const target = path.join(root, 'legacy');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');

  const result = spawnSync(process.execPath, [bin, 'legacy', target, '-y'], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /conflict/i);
  assert.match(output, /CLAUDE\.md already exists/);
  assert.match(output, /confirm refactoring or merging/i);
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
});

test('interactive fallback previews computed conflict plan before generation failure', { skip: !process.stdout.isTTY }, () => {
  const root = tmpdir();
  const target = path.join(root, 'my-vibe-project');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');

  const result = spawnSync(process.execPath, [bin], { cwd: root, encoding: 'utf8' });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, output);
  assert.match(output, /Planned changes: no files have been written yet/);
  assert.match(output, /conflict:/i);
  assert.match(output, /CLAUDE\.md/);
  assert.match(output, /Generation failed/);
  assert.ok(output.indexOf('Planned changes') < output.indexOf('Generation failed'));
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
  assert.equal(fs.existsSync(path.join(target, 'Harness', 'SETUP.md')), false);
});

test('existing project can opt into skip conflicts', () => {
  const root = tmpdir();
  const target = path.join(root, 'legacy');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');

  const output = execFileSync(process.execPath, [bin, 'legacy', target, '-y', '--on-conflict', 'skip'], { encoding: 'utf8' });

  assert.match(output, /skipped/i);
  assert.match(output, /CLAUDE\.md already exists/);
  assert.match(output, /confirm refactoring or merging/i);
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
  assert.ok(fs.existsSync(path.join(target, 'Harness', 'scripts', 'validate-harness.mjs')));
});

test('existing project can use equals form for conflict policy', () => {
  const root = tmpdir();
  const target = path.join(root, 'legacy');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');

  const output = execFileSync(process.execPath, [bin, 'legacy', target, '-y', '--on-conflict=skip'], { encoding: 'utf8' });

  assert.match(output, /skipped/i);
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
});

test('AC-001 existing Harness non-JSON install switches to update checker without install writes', () => {
  const root = tmpdir();
  const target = path.join(root, 'installed-harness');
  fs.mkdirSync(path.join(target, 'Harness'), { recursive: true });
  fs.writeFileSync(path.join(target, 'Harness', 'README.md'), 'existing harness\n');
  writeUpdateStub(target);

  const result = spawnSync(
    process.execPath,
    [bin, 'installed-harness', target, '-y', '--on-conflict', 'skip'],
    { encoding: 'utf8' },
  );
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /Existing Harness detected/i);
  assert.match(output, /up-to-date/);
  assert.equal(fs.existsSync(path.join(target, 'CLAUDE.md')), false);
  assert.equal(fs.existsSync(path.join(target, 'Harness', 'SETUP.md')), false);
  assert.equal(fs.readFileSync(path.join(target, 'Harness', 'README.md'), 'utf8'), 'existing harness\n');
});

test('AC-002 existing Harness JSON dry-run returns update mode instead of install plan', () => {
  const root = tmpdir();
  const target = path.join(root, 'installed-harness-json');
  fs.mkdirSync(path.join(target, 'Harness'), { recursive: true });
  fs.writeFileSync(path.join(target, 'Harness', 'README.md'), 'existing harness\n');
  writeUpdateStub(target);

  const output = execFileSync(
    process.execPath,
    [bin, 'installed-harness-json', target, '--json', '--dry-run'],
    { encoding: 'utf8' },
  );
  const data = JSON.parse(output.trim());

  assert.equal(data.success, true);
  assert.equal(data.mode, 'update');
  assert.equal(data.scan.markers.hasHarness, true);
  assert.equal(data.update.status, 'up-to-date');
  assert.deepEqual(data.update.args, ['--json']);
  assert.equal(data.update.sourceBase, 'https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/');
  assert.equal(data.agent.updateSourceBase, 'https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/');
  assert.equal(data.plan, undefined);
  assert.ok(data.agent.next.some(item => item.action === 'update'));
  assert.equal(fs.existsSync(path.join(target, 'CLAUDE.md')), false);
  assert.equal(fs.existsSync(path.join(target, 'Harness', 'SETUP.md')), false);
});

for (const status of ['error', 'offline', 'template-remote', 'downgrade-refused']) {
  test(`AC-002 existing Harness JSON update switch fails on ${status} even with zero exit`, () => {
    const root = tmpdir();
    const target = path.join(root, `installed-harness-json-${status}`);
    fs.mkdirSync(path.join(target, 'Harness'), { recursive: true });
    fs.writeFileSync(path.join(target, 'Harness', 'README.md'), 'existing harness\n');
    writeUpdateStub(
      target,
      `console.log(JSON.stringify({ status: '${status}', message: 'synthetic ${status}' }));\n`,
    );

    const result = spawnSync(
      process.execPath,
      [bin, `installed-harness-json-${status}`, target, '--json', '--dry-run'],
      { encoding: 'utf8' },
    );
    const data = JSON.parse(result.stdout.trim());

    assert.notEqual(result.status, 0);
    assert.equal(data.success, false);
    assert.equal(data.mode, 'update');
    assert.equal(data.update.status, status);
    assert.match(data.errors.join('\n'), new RegExp(status));
    assert.equal(fs.existsSync(path.join(target, 'CLAUDE.md')), false);
    assert.equal(fs.existsSync(path.join(target, 'Harness', 'SETUP.md')), false);
  });
}

test('--list-options prints built-in optional catalog', () => {
  const output = execFileSync(process.execPath, [bin, '--list-options'], { encoding: 'utf8' });
  assert.doesNotMatch(output, /browser-e2e/);
  assert.match(output, /ts-react-frontend/);
  assert.match(output, /web-app/);
  assert.match(output, /External recommendations/);
  assert.match(output, /superpowers/);
  assert.match(output, /codegraph/);
  assert.match(output, /grill-me/);
  assert.match(output, /https:\/\/github\.com\/obra\/Superpowers/);
  assert.match(output, /https:\/\/github\.com\/colbymchenry\/codegraph/);
  assert.match(output, /https:\/\/github\.com\/mattpocock\/skills\/tree\/main\/skills\/productivity\/grill-me/);
});

test('--recommend records external recommendations without installing them', () => {
  const root = tmpdir();
  const target = path.join(root, 'recommended');

  execFileSync(process.execPath, [bin, 'recommended', target, '-y', '--recommend', 'superpowers,codegraph,grill-me'], { encoding: 'utf8' });

  const setup = fs.readFileSync(path.join(target, 'Harness', 'specs', 'guides', 'SETUP.md'), 'utf8');
  assert.match(setup, /Selected External Recommendations/);
  assert.match(setup, /superpowers/);
  assert.match(setup, /codegraph/);
  assert.match(setup, /grill-me/);
  assert.match(setup, /https:\/\/github\.com\/obra\/Superpowers/);
  assert.match(setup, /https:\/\/github\.com\/colbymchenry\/codegraph/);
  assert.match(setup, /https:\/\/github\.com\/mattpocock\/skills\/tree\/main\/skills\/productivity\/grill-me/);
  assert.doesNotMatch(setup, /install hint/i);
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'superpowers', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.agents', 'skills', 'superpowers', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'grill-me', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.agents', 'skills', 'grill-me', 'SKILL.md')), false);
});

test('--with copies optional skills and workflows while wf-browser stays built in', () => {
  const root = tmpdir();
  const target = path.join(root, 'web');

  execFileSync(process.execPath, [bin, 'web', target, '-y', '--with', 'ts-react-frontend,ui-ux-review'], { encoding: 'utf8' });

  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.agents', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ui-ux-review', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.agents', 'skills', 'ui-ux-review', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'wf-browser', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.agents', 'skills', 'wf-browser', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'browser-e2e', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.agents', 'skills', 'browser-e2e', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, 'Harness', 'workflows', 'browser-e2e.md')), false);
  assert.equal(
    fs.readFileSync(path.join(target, '.agents', 'skills', 'wf-browser', 'SKILL.md'), 'utf8'),
    fs.readFileSync(path.join(target, '.claude', 'skills', 'wf-browser', 'SKILL.md'), 'utf8'),
  );
  assert.match(fs.readFileSync(path.join(target, 'Harness', 'MEMORY.md'), 'utf8'), /ts-react-frontend/);
  assert.match(fs.readFileSync(path.join(target, 'Harness', 'MEMORY.md'), 'utf8'), /wf-browser/);
  const docsReadme = fs.readFileSync(path.join(target, 'Harness', 'README.md'), 'utf8');
  const workflowLinks = [...docsReadme.matchAll(/\]\((workflows\/[^)]+)\)/g)].map(match => match[1]);
  assert.ok(workflowLinks.includes('workflows/ts-react-frontend.md'));
  assert.ok(workflowLinks.includes('workflows/ui-ux-review.md'));
  assert.equal(workflowLinks.includes('workflows/browser-e2e.md'), false);
  for (const link of workflowLinks) {
    assert.ok(fs.existsSync(path.join(target, 'Harness', link)), `Expected ${link} to resolve from Harness/README.md`);
  }
});

test('--with equals form copies optional workflows', () => {
  const root = tmpdir();
  const target = path.join(root, 'web-equals');

  execFileSync(process.execPath, [bin, 'web-equals', target, '-y', '--with=ui-ux-review'], { encoding: 'utf8' });

  assert.ok(fs.existsSync(path.join(target, 'Harness', 'workflows', 'ui-ux-review.md')));
  assert.equal(fs.existsSync(path.join(target, 'Harness', 'workflows', 'browser-e2e.md')), false);
});

test('--preset web-app expands optional skills', () => {
  const root = tmpdir();
  const target = path.join(root, 'web-preset');

  execFileSync(process.execPath, [bin, 'web-preset', target, '-y', '--preset', 'web-app'], { encoding: 'utf8' });

  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.agents', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'wf-browser', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.agents', 'skills', 'wf-browser', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'browser-e2e', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.agents', 'skills', 'browser-e2e', 'SKILL.md')), false);
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ui-ux-review', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.agents', 'skills', 'ui-ux-review', 'SKILL.md')));
});

test('--preset equals form expands optional workflows', () => {
  const root = tmpdir();
  const target = path.join(root, 'web-preset-equals');

  execFileSync(process.execPath, [bin, 'web-preset-equals', target, '-y', '--preset=web-app'], { encoding: 'utf8' });

  assert.ok(fs.existsSync(path.join(target, 'Harness', 'workflows', 'ts-react-frontend.md')));
  assert.ok(fs.existsSync(path.join(target, 'Harness', 'workflows', 'ui-ux-review.md')));
  assert.equal(fs.existsSync(path.join(target, 'Harness', 'workflows', 'browser-e2e.md')), false);
});

test('--without subtracts optional workflows after preset and with', () => {
  const root = tmpdir();
  const target = path.join(root, 'trimmed-fullstack');

  execFileSync(
    process.execPath,
    [bin, 'trimmed-fullstack', target, '-y', '--preset', 'fullstack', '--with', 'ui-ux-review', '--without', 'python-backend,github-pr-review'],
    { encoding: 'utf8' },
  );

  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.agents', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'wf-browser', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.agents', 'skills', 'wf-browser', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'browser-e2e', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.agents', 'skills', 'browser-e2e', 'SKILL.md')), false);
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ui-ux-review', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.agents', 'skills', 'ui-ux-review', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'python-backend', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.agents', 'skills', 'python-backend', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'github-pr-review', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.agents', 'skills', 'github-pr-review', 'SKILL.md')), false);
});

test('retired --with browser-e2e is a warning no-op because wf-browser is built in', () => {
  const root = tmpdir();
  const target = path.join(root, 'retired-browser');

  const output = execFileSync(process.execPath, [bin, 'retired-browser', target, '-y', '--with', 'browser-e2e'], { encoding: 'utf8' });

  assert.match(output, /browser-e2e/);
  assert.match(output, /retired/);
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'wf-browser', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.agents', 'skills', 'wf-browser', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'browser-e2e', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, 'Harness', 'workflows', 'browser-e2e.md')), false);
});

test('--without equals form accepts known unselected optional ids as no-op', () => {
  const root = tmpdir();
  const target = path.join(root, 'web-trimmed-equals');

  execFileSync(process.execPath, [bin, 'web-trimmed-equals', target, '-y', '--preset=web-app', '--without=python-backend'], { encoding: 'utf8' });

  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.agents', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'python-backend', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.agents', 'skills', 'python-backend', 'SKILL.md')), false);
});

test('unknown optional skill id exits with readable error', () => {
  const root = tmpdir();
  const target = path.join(root, 'bad');
  const result = spawnSync(process.execPath, [bin, 'bad', target, '-y', '--with', 'not-a-skill'], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /not-a-skill/);
  assert.match(`${result.stdout}\n${result.stderr}`, /--list-options/);
});

test('unknown without skill id exits with readable error', () => {
  const root = tmpdir();
  const target = path.join(root, 'bad-without');
  const result = spawnSync(process.execPath, [bin, 'bad-without', target, '-y', '--preset', 'web-app', '--without', 'not-a-skill'], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /not-a-skill/);
  assert.match(`${result.stdout}\n${result.stderr}`, /--list-options/);
  assert.equal(fs.existsSync(target), false);
});

test('flags requiring values fail readably without creating project', () => {
  for (const flag of ['--with', '--without', '--recommend', '--preset', '--on-conflict', '--install-scope', '--global-dir', '--host-global-dir', '--with=', '--without=', '--recommend=', '--preset=', '--on-conflict=', '--install-scope=', '--global-dir=', '--host-global-dir=']) {
    const root = tmpdir();
    const target = path.join(root, 'bad');
    const result = spawnSync(process.execPath, [bin, 'bad', target, '-y', flag, '--dry-run'], { encoding: 'utf8' });
    const flagName = flag.replace(/=$/, '');

    assert.notEqual(result.status, 0, flag);
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(`${flagName} requires a value`));
    assert.equal(fs.existsSync(target), false);
  }
});

test('--json --dry-run reports global install plan without moving project task state', () => {
  const root = tmpdir();
  const target = path.join(root, 'global-json');
  const globalDir = path.join(root, 'global-harness');
  const hostGlobalDir = path.join(root, 'host-global');
  const output = execFileSync(
    process.execPath,
    [bin, 'global-json', target, '--json', '--dry-run', '--install-scope', 'global', '--global-dir', globalDir, '--host-global-dir', hostGlobalDir],
    { encoding: 'utf8' },
  );
  const data = JSON.parse(output.trim());

  assert.equal(data.success, true);
  assert.equal(data.installScope, 'global');
  assert.equal(data.globalDir.replace(/\\/g, '/'), globalDir.replace(/\\/g, '/'));
  assert.ok(data.plan.create.includes('Harness/PROGRESS.md'));
  assert.ok(data.plan.create.includes('Harness/tasks/_template/PLAN.md'));
  assert.ok(data.plan.create.includes('Harness/memory/tool-usage-reflections.md'));
  assert.ok(data.plan.create.includes('Harness/research/PRD.md'));
  assert.ok(data.plan.create.includes('Harness/project/architecture.md'));
  assert.ok(data.plan.create.includes('Harness/specs/guides/SETUP.md'));
  assert.ok(data.plan.create.includes('Harness/settings.json'));
  assert.ok(data.globalPlan.create.includes('Harness/README.md'));
  assert.ok(data.globalPlan.create.includes('Harness/MEMORY.md'));
  assert.ok(!data.globalPlan.create.some(file => file.startsWith('Harness/tasks/')));
  assert.ok(!data.globalPlan.create.some(file => file.startsWith('Harness/research/')));
  assert.ok(!data.globalPlan.create.some(file => file.startsWith('Harness/project/')));
  assert.ok(!data.globalPlan.create.includes('Harness/PROGRESS.md'));
  assert.ok(data.hostPlans.some(plan => plan.host === 'claude' && plan.plan.create.includes('commands/wf.md')));
  assert.ok(data.hostPlans.some(plan => plan.host === 'codex' && plan.plan.create.includes('skills/wf/SKILL.md')));
  assert.ok(data.hostPlans.some(plan => plan.host === 'opencode' && plan.plan.create.includes('commands/wf.md')));
  assert.ok(data.ownershipClasses.projectTemplateBridge.includes('Harness/settings.json'));
  assert.ok(data.warnings.some(warning => /Claude Code, Codex, and OpenCode host-global surfaces/.test(warning)));
});

test('--json --dry-run treats global runtime conflicts as agent attention files', () => {
  const root = tmpdir();
  const target = path.join(root, 'global-json-conflict');
  const globalDir = path.join(root, 'global-harness');
  const hostGlobalDir = path.join(root, 'host-global');
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(path.join(globalDir, 'CLAUDE.md'), 'existing global runtime entry\n');

  const output = execFileSync(
    process.execPath,
    [bin, 'global-json-conflict', target, '--json', '--dry-run', '--install-scope', 'global', '--global-dir', globalDir, '--host-global-dir', hostGlobalDir],
    { encoding: 'utf8' },
  );
  const data = JSON.parse(output.trim());

  assert.equal(data.success, true);
  assert.ok(data.globalPlan.conflict.includes('CLAUDE.md'));
  assert.ok(data.agent.aiMergeRequired.some(item => item.file === 'global:CLAUDE.md' && item.scope === 'global-runtime'));
  assert.ok(data.agent.next.some(item => item.action === 'safe-merge'));
  assert.ok(!data.agent.next.some(item => item.action === 'install'));
});

test('--json --dry-run treats host-global user files as scoped attention files', () => {
  const root = tmpdir();
  const target = path.join(root, 'host-json-conflict');
  const globalDir = path.join(root, 'global-harness');
  const hostGlobalDir = path.join(root, 'host-global');
  fs.mkdirSync(path.join(hostGlobalDir, 'claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(hostGlobalDir, 'claude', 'commands', 'wf.md'), 'my personal wf command\n');

  const output = execFileSync(
    process.execPath,
    [bin, 'host-json-conflict', target, '--json', '--dry-run', '--install-scope', 'global', '--global-dir', globalDir, '--host-global-dir', hostGlobalDir],
    { encoding: 'utf8' },
  );
  const data = JSON.parse(output.trim());

  assert.equal(data.success, true);
  const claudePlan = data.hostPlans.find(plan => plan.host === 'claude');
  assert.ok(claudePlan.plan.conflict.includes('commands/wf.md'));
  assert.ok(data.agent.aiMergeRequired.some(item => item.file === 'host:claude:commands/wf.md' && item.scope === 'host-global:claude'));
  assert.ok(data.agent.next.some(item => item.action === 'safe-merge'));
  assert.ok(!data.agent.next.some(item => item.action === 'install'));
});

test('unknown flags fail readably without creating project', () => {
  const root = tmpdir();
  const target = path.join(root, 'bad');
  const result = spawnSync(process.execPath, [bin, 'bad', target, '-y', '--wat'], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unknown flag "--wat"/);
  assert.equal(fs.existsSync(target), false);
});

test('generated optional project passes harness validator', () => {
  const root = tmpdir();
  const target = path.join(root, 'validated-web');

  execFileSync(process.execPath, [bin, 'validated-web', target, '-y', '--with', 'ui-ux-review,ts-react-frontend'], { encoding: 'utf8' });
  const output = execFileSync(process.execPath, ['Harness/scripts/validate-harness.mjs'], { cwd: target, encoding: 'utf8' });

  assert.match(output, /Harness validation passed/);
});

test('--json --dry-run outputs valid JSON plan without decorative text', () => {
  const root = tmpdir();
  const target = path.join(root, 'json-dry');
  const output = execFileSync(process.execPath, [bin, 'json-dry', target, '--json', '--dry-run'], { encoding: 'utf8' });

  // Must be valid JSON with no leading/trailing non-JSON content
  const data = JSON.parse(output.trim());
  assert.equal(data.success, true);
  assert.equal(data.dryRun, true);
  assert.ok(Array.isArray(data.plan.create));
  assert.ok(data.plan.create.includes('CLAUDE.md'));
  assert.ok(data.plan.create.includes('.agents/skills/wf/SKILL.md'));
  assert.equal(data.summary.created, data.plan.create.length);
  // Verify no decorative text leaked into stdout
  assert.doesNotMatch(output, /Generation complete/);
  assert.doesNotMatch(output, /Next steps/);
  assert.doesNotMatch(output, /╔/);
});

test('--json --dry-run reports existing project conflicts in structured plan', () => {
  const root = tmpdir();
  const target = path.join(root, 'json-legacy');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');
  fs.mkdirSync(path.join(target, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'), '{"name":"legacy"}\n');

  const output = execFileSync(process.execPath, [bin, 'json-legacy', target, '--json', '--dry-run'], { encoding: 'utf8' });
  const data = JSON.parse(output.trim());

  assert.equal(data.success, true);
  assert.equal(data.scan.markers.hasClaude, true);
  assert.equal(data.scan.markers.hasDocs, true);
  assert.equal(data.scan.markers.hasPackageJson, true);
  assert.ok(data.scan.topLevelEntries.includes('CLAUDE.md'));
  assert.ok(Array.isArray(data.plan.conflict));
  assert.ok(data.plan.conflict.includes('CLAUDE.md'));
  assert.ok(Array.isArray(data.plan.create));
  assert.equal(data.summary.conflicts, data.plan.conflict.length);
  assert.match(data.agent.sourceOfTruth, /Do not read package source/);
  assert.match(data.agent.safeMergeCommand, /--on-conflict skip/);
  assert.deepEqual(
    data.agent.aiMergeRequired.find(item => item.file === 'CLAUDE.md'),
    {
      file: 'CLAUDE.md',
      templateHint: 'templates/common/CLAUDE.md',
      requiresUserConsent: true,
      defaultAction: 'preserve',
      reason: 'Root agent entry contract. Preserve project rules and ask before merging Harness startup guidance.',
    },
  );
  // Verify legacy file untouched
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
});

test('--json with --on-conflict skip outputs structured result', () => {
  const root = tmpdir();
  const target = path.join(root, 'json-skip');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\n');

  const output = execFileSync(process.execPath, [bin, 'json-skip', target, '--json', '--on-conflict', 'skip'], { encoding: 'utf8' });
  const data = JSON.parse(output.trim());

  assert.equal(data.success, true);
  assert.equal(data.dryRun, undefined);
  assert.ok(Array.isArray(data.plan.skip));
  assert.ok(data.plan.skip.includes('CLAUDE.md'));
  assert.ok(Array.isArray(data.plan.create));
  assert.ok(data.plan.create.includes('Harness/specs/guides/SETUP.md'));
  assert.equal(data.summary.skipped, data.plan.skip.length);
  assert.ok(data.agent.aiMergeRequired.some(item => item.file === 'CLAUDE.md'));
  assert.ok(data.agent.next.some(item => item.action === 'ai-merge'));
  // Verify legacy file preserved and new files created
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\n');
  assert.ok(fs.existsSync(path.join(target, 'Harness', 'specs', 'guides', 'SETUP.md')));
});

test('--json mode is non-interactive and uses defaults', () => {
  const root = tmpdir();
  const target = path.join(root, 'json-default');
  // Run with --json only, no -y, no positionals, from a temp cwd
  const result = spawnSync(process.execPath, [bin, '--json', '--dry-run'], {
    encoding: 'utf8',
    cwd: root,
  });
  const output = result.stdout.trim();

  // Must produce valid JSON despite no arguments
  assert.equal(result.status, 0, output);
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  // Non-interactive mode used defaults — plan includes expected core files
  assert.ok(data.plan.create.includes('CLAUDE.md'));
  assert.ok(data.plan.create.includes('Harness/specs/guides/SETUP.md'));
  assert.ok(data.plan.create.includes('Harness/MEMORY.md'));
  assert.ok(data.plan.create.includes('.agents/skills/wf/SKILL.md'));
  // Verify no interactive text leaked
  assert.doesNotMatch(output, /Generation complete/);
  assert.doesNotMatch(output, /Confirm/);
});
