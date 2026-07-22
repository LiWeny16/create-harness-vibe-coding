import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { generate } from '../src/generator.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'Harness', 'scripts');
const sha = (s) => 'sha256-' + createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-p0-'));
}

function fileSourceBase(dir) {
  // file:// URL with trailing separator, the form wf-update-check/scan-clean expect.
  return pathToFileURL(path.resolve(dir) + path.sep).href;
}

function runNode(scriptAbs, args, opts = {}) {
  const cwd = opts.cwd || ROOT;
  return spawnSync(process.execPath, [scriptAbs, ...(args || [])], {
    cwd,
    encoding: 'utf8',
    // WF_ROOT makes update-check/scan-clean operate on the project at cwd,
    // regardless of where the script file itself lives.
    env: { ...process.env, WF_ROOT: cwd, ...(opts.env || {}) },
    shell: false,
  });
}

function runShell(command, opts = {}) {
  // Run a hook command string the way a shell would (cross-platform).
  return spawnSync(command, { cwd: opts.cwd || ROOT, encoding: 'utf8', shell: true, env: { ...process.env, ...(opts.env || {}) } });
}

function runNodeAsync(scriptAbs, args, opts = {}) {
  const cwd = opts.cwd || ROOT;
  return new Promise(resolve => {
    const child = spawn(process.execPath, [scriptAbs, ...(args || [])], {
      cwd,
      env: { ...process.env, WF_ROOT: cwd, ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

function tarOctal(value, length) {
  return value.toString(8).padStart(length - 1, '0') + '\0';
}

function makeTgz(files) {
  const blocks = [];
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content, 'utf8');
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write(tarOctal(0o644, 8), 100, 8, 'ascii');
    header.write(tarOctal(0, 8), 108, 8, 'ascii');
    header.write(tarOctal(0, 8), 116, 8, 'ascii');
    header.write(tarOctal(body.length, 12), 124, 12, 'ascii');
    header.write(tarOctal(0, 12), 136, 12, 'ascii');
    header.fill(' ', 148, 156);
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    const sum = [...header].reduce((acc, byte) => acc + byte, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header, body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function createOldHarnessWithoutUpdater(root, name = 'old') {
  const proj = path.join(root, name);
  fs.mkdirSync(path.join(proj, 'Harness'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'),
    JSON.stringify({ generator: '0.5.0', generated: '2026-01-01T00:00:00Z', checksums: { 'Harness/README.md': 'sha256-x' } }, null, 2) + '\n');
  fs.writeFileSync(path.join(proj, 'Harness', 'README.md'), 'old harness\n');
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), 'user claude rules\n');
  return proj;
}

// ── #1: generator produces a project with no duplicate destinations ───────
test('generator: fresh project succeeds and writes previously-conflicting memory + codex mirror files', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'proj');
  const result = generate({ projectName: 'proj', targetDir });

  assert.equal(result.success, true, result.errors.join('\n'));
  assert.ok(result.summary.created > 0, 'expected files to be created');
  assert.equal(result.errors.length, 0);

  // These four destinations were the original duplicate-template failure; they
  // must now exist exactly once with real content (no double-mirror, no Harness/memory dup).
  assert.ok(fs.existsSync(path.join(targetDir, 'Harness', 'memory', 'startup-hints.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'Harness', 'memory', 'routes.md')));
  assert.ok(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'wf-learn', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'wf-auto', 'SKILL.md')));
  assert.ok(fs.readFileSync(path.join(targetDir, '.agents', 'skills', 'wf-learn', 'SKILL.md'), 'utf8').length > 0);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── #4: CLI recovery restores a missing updater without touching user data ─
test('recovery: old harness missing wf-update-check.mjs gets the updater restored and user files preserved', () => {
  const root = tmpdir();
  const proj = createOldHarnessWithoutUpdater(root, 'old');

  const updaterBefore = path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs');
  assert.equal(fs.existsSync(updaterBefore), false, 'precondition: updater missing');

  // Run the CLI recovery path (non-interactive, JSON).
  const cli = runNode(path.join(ROOT, 'src', 'index.js'),
    ['oldproj', proj, '-y', '--on-conflict', 'skip', '--json'], { cwd: root });
  const out = JSON.parse(cli.stdout.trim());
  assert.equal(cli.status, 0, 'CLI exit 0; stderr: ' + cli.stderr);
  assert.equal(out.success, true, 'recovery generate succeeded');

  // Updater must now exist (recovery path really restored infrastructure).
  assert.equal(fs.existsSync(updaterBefore), true, 'wf-update-check.mjs restored by recovery');

  // User data must be preserved (--on-conflict skip never overwrites existing files).
  assert.equal(fs.readFileSync(path.join(proj, 'CLAUDE.md'), 'utf8'), 'user claude rules\n');

  // A subsequent update-check run reaches a normal state (no missing-script crash).
  const recheck = runNode(updaterBefore, ['--json'], { cwd: proj, env: { WF_SOURCE_BASE: fileSourceBase(path.join(ROOT, 'templates', 'common')) } });
  let recheckJson = null;
  try { recheckJson = JSON.parse((recheck.stdout || '').trim()); } catch (_) { /* offline/error may still be valid JSON */ }
  assert.ok(recheckJson && typeof recheckJson.status === 'string', 'update-check returns a status after recovery (got: ' + recheck.stdout + ')');
  fs.rmSync(root, { recursive: true, force: true });
});

test('AC-ONE-LINE-001 recovery always uses skip semantics even if caller requests overwrite or backup', () => {
  for (const policy of ['overwrite', 'backup']) {
    const root = tmpdir();
    const proj = createOldHarnessWithoutUpdater(root, `old-${policy}`);

    const cli = runNode(path.join(ROOT, 'src', 'index.js'),
      ['oldproj', proj, '-y', '--on-conflict', policy, '--json'], { cwd: root });
    const out = JSON.parse(cli.stdout.trim());
    assert.equal(cli.status, 0, `CLI exit 0 for ${policy}; stderr: ${cli.stderr}`);
    assert.equal(out.mode, 'recovery', `recovery mode for ${policy}`);
    assert.match(out.recoveryNote, /--on-conflict skip/, `recovery note reports forced skip for ${policy}`);

    assert.equal(fs.readFileSync(path.join(proj, 'CLAUDE.md'), 'utf8'), 'user claude rules\n',
      `user CLAUDE.md preserved when caller requested ${policy}`);
    assert.equal(out.summary.overwritten, 0, `no overwrites during ${policy} recovery`);
    assert.equal(out.summary.backedUp, 0, `no backups during ${policy} recovery`);

    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-ONE-LINE-002 README one-line install routes old Harness without updater to safe CLI recovery', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const readmeCn = fs.readFileSync(path.join(ROOT, 'README-CN.md'), 'utf8');

  assert.match(readme, /Existing `Harness\/` but missing `Harness\/scripts\/wf-update-check\.mjs`/);
  assert.match(readme, /npx create-harness-vibe-coding@latest my-project \. -y --on-conflict skip --json/);
  assert.match(readme, /Then run `node Harness\/scripts\/wf-update-check\.mjs --json`/);

  assert.match(readmeCn, /已有 `Harness\/` 但缺少 `Harness\/scripts\/wf-update-check\.mjs`/);
  assert.match(readmeCn, /npx create-harness-vibe-coding@latest my-project \. -y --on-conflict skip --json/);
  assert.match(readmeCn, /然后执行 `node Harness\/scripts\/wf-update-check\.mjs --json`/);
});

// ── #2: hook command exits 0 from project root AND a Harness/memory subdir ─
test('hook: SessionStart settings command exits 0 from project root and from Harness/memory subdir', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
  assert.ok(settings.hooks.SessionStart, 'SessionStart hook present');
  assert.ok(!settings.hooks.UserPromptSubmit, 'UserPromptSubmit hook not used for update checks');
  const cmd = settings.hooks.SessionStart[0].hooks[0].command;
  assert.ok(cmd && cmd.length > 0, 'hook command present');

  // Use a generated project (has Harness/.harness-version + the helper script).
  const root = tmpdir();
  const targetDir = path.join(root, 'proj');
  const gen = generate({ projectName: 'proj', targetDir });
  assert.equal(gen.success, true, gen.errors.join('\n'));

  const fromRoot = runShell(cmd, { cwd: targetDir });
  assert.equal(fromRoot.status, 0, 'hook exit 0 from project root; stderr: ' + fromRoot.stderr);

  const subdir = path.join(targetDir, 'Harness', 'memory');
  fs.mkdirSync(subdir, { recursive: true });
  const fromSubdir = runShell(cmd, { cwd: subdir });
  assert.equal(fromSubdir.status, 0, 'hook exit 0 from Harness/memory subdir; stderr: ' + fromSubdir.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── #5: default --json omits the plan; --full-plan includes it ─────────────
test('update-check: default --json hides plan/conflict details; --full-plan reveals them', () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  const remote = path.join(root, 'remote');
  fs.mkdirSync(path.join(proj, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.mkdirSync(path.join(proj, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'agents', 'planner.md'), 'planner v1\n');
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), 'user modified claude\n');

  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '0.8.7', generated: '2026-01-01T00:00:00Z',
    checksums: { '.claude/agents/planner.md': sha('planner v1\n'), 'CLAUDE.md': sha('original claude\n') },
  }, null, 2) + '\n');

  fs.mkdirSync(path.join(remote, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(remote, '.claude', 'agents', 'planner.md'), 'planner v2\n');
  fs.writeFileSync(path.join(remote, 'CLAUDE.md'), 'new template claude\n');
  fs.writeFileSync(path.join(remote, '.harness-version'), JSON.stringify({
    generator: '0.8.8', generated: '2026-07-01T00:00:00Z',
    checksums: { '.claude/agents/planner.md': sha('planner v2\n'), 'CLAUDE.md': sha('new template claude\n') },
    sources: { '.claude/agents/planner.md': '.claude/agents/planner.md', 'CLAUDE.md': 'CLAUDE.md' },
  }, null, 2) + '\n');

  const base = fileSourceBase(remote);

  const def = runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--json'], { cwd: proj, env: { WF_SOURCE_BASE: base } });
  const defJson = JSON.parse(def.stdout.trim());
  assert.equal('plan' in defJson, false, 'default --json must NOT include top-level plan');
  assert.equal('aiMergeRequired' in (defJson.agent || {}), false, 'default --json agent must NOT include aiMergeRequired array');
  assert.ok(typeof defJson.conflict === 'number' && defJson.conflict >= 1, 'default still reports conflict count');
  assert.ok(typeof defJson.agent.aiMergeRequiredCount === 'number', 'default agent reports aiMergeRequiredCount');

  const full = runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--json', '--full-plan'], { cwd: proj, env: { WF_SOURCE_BASE: base } });
  const fullJson = JSON.parse(full.stdout.trim());
  assert.equal('plan' in fullJson, true, '--full-plan must include top-level plan');
  assert.ok((fullJson.plan.conflict || []).length >= 1, '--full-plan plan.conflict has entries');
  assert.ok((fullJson.agent.aiMergeRequired || []).length >= 1, '--full-plan agent.aiMergeRequired has entries');
  fs.rmSync(root, { recursive: true, force: true });
});

test('update-check: default source can use npm latest tarball without GitHub', async () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.writeFileSync(path.join(proj, 'Harness', 'WF.md'), 'old wf\n');
  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '1.0.0',
    generated: '2026-01-01T00:00:00Z',
    checksums: { 'Harness/WF.md': sha('old wf\n') },
  }, null, 2) + '\n');

  const remoteFiles = { 'Harness/WF.md': 'new wf\n' };
  const remoteVersion = {
    generator: '9.9.9',
    generated: '2026-07-22T00:00:00Z',
    checksums: { 'Harness/WF.md': sha(remoteFiles['Harness/WF.md']) },
    sources: { 'Harness/WF.md': 'Harness/WF.md' },
  };
  const tgz = makeTgz({
    'package/templates/common/.harness-version': JSON.stringify(remoteVersion, null, 2) + '\n',
    'package/templates/common/Harness/WF.md': remoteFiles['Harness/WF.md'],
  });

  const server = createServer((req, res) => {
    if (req.url === '/create-harness-vibe-coding/latest') {
      const base = `http://127.0.0.1:${server.address().port}`;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        name: 'create-harness-vibe-coding',
        version: '9.9.9',
        dist: { tarball: `${base}/create-harness-vibe-coding-9.9.9.tgz` },
      }));
      return;
    }
    if (req.url === '/create-harness-vibe-coding-9.9.9.tgz') {
      res.setHeader('content-type', 'application/octet-stream');
      res.end(tgz);
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const registry = `http://127.0.0.1:${server.address().port}`;
    const result = await runNodeAsync(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--json', '--full-plan'], {
      cwd: proj,
      env: { NPM_CONFIG_REGISTRY: registry },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const json = JSON.parse(result.stdout.trim());
    assert.equal(json.status, 'update-available');
    assert.equal(json.to, '9.9.9');
    assert.match(json.sourceBase, /^npm:create-harness-vibe-coding@9\.9\.9\/templates\/common\//);
    assert.ok(json.plan.updated.some(entry => entry.file === 'Harness/WF.md'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('update-check: default source falls back to zingspark legacy mirror', async () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '1.0.0',
    generated: '2026-01-01T00:00:00Z',
    checksums: {},
  }, null, 2) + '\n');

  const remoteVersion = {
    generator: '2.0.0',
    generated: '2026-07-22T00:00:00Z',
    checksums: {},
    sources: {},
  };
  const preload = path.join(root, 'fake-fetch.mjs');
  fs.writeFileSync(preload, `
const legacyManifestUrl = 'https://raw.githubusercontent.com/zingspark/create-harness-vibe-coding/main/templates/common/.harness-version';
globalThis.fetch = async function fakeFetch(input) {
  const url = String(input);
  if (url === legacyManifestUrl) {
    return new Response(process.env.HARNESS_FAKE_LEGACY_MANIFEST, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('blocked by fallback test: ' + url, { status: 503 });
};
`, 'utf8');

  const result = await runNodeAsync(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--json'], {
    cwd: proj,
    env: {
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      HARNESS_FAKE_LEGACY_MANIFEST: JSON.stringify(remoteVersion),
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const json = JSON.parse(result.stdout.trim());
  assert.equal(json.status, 'update-available');
  assert.equal(json.to, '2.0.0');
  assert.equal(json.sourceBase, 'https://raw.githubusercontent.com/zingspark/create-harness-vibe-coding/main/templates/common/');
  fs.rmSync(root, { recursive: true, force: true });
});

test('update-check: apply-safe validates all remote hashes before writing any file', () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  const remote = path.join(root, 'remote');
  fs.mkdirSync(path.join(proj, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.mkdirSync(path.join(proj, 'Harness'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'Harness', 'A.md'), 'old a\n');
  fs.writeFileSync(path.join(proj, 'Harness', 'B.md'), 'old b\n');
  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '1.0.0',
    generated: '2026-01-01T00:00:00Z',
    checksums: {
      'Harness/A.md': sha('old a\n'),
      'Harness/B.md': sha('old b\n'),
    },
  }, null, 2) + '\n');

  fs.mkdirSync(path.join(remote, 'Harness'), { recursive: true });
  fs.writeFileSync(path.join(remote, 'Harness', 'A.md'), 'new a\n');
  fs.writeFileSync(path.join(remote, 'Harness', 'B.md'), 'new b but manifest lies\n');
  fs.writeFileSync(path.join(remote, '.harness-version'), JSON.stringify({
    generator: '2.0.0',
    generated: '2026-07-22T00:00:00Z',
    checksums: {
      'Harness/A.md': sha('new a\n'),
      'Harness/B.md': sha('different b\n'),
    },
    sources: {
      'Harness/A.md': 'Harness/A.md',
      'Harness/B.md': 'Harness/B.md',
    },
  }, null, 2) + '\n');

  const result = runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--apply-safe'], {
    cwd: proj,
    env: { WF_SOURCE_BASE: fileSourceBase(remote) },
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /Hash mismatch: Harness\/B\.md/);
  assert.equal(fs.readFileSync(path.join(proj, 'Harness', 'A.md'), 'utf8'), 'old a\n');
  assert.equal(fs.readFileSync(path.join(proj, 'Harness', 'B.md'), 'utf8'), 'old b\n');
  const version = JSON.parse(fs.readFileSync(path.join(proj, 'Harness', '.harness-version'), 'utf8'));
  assert.equal(version.generator, '1.0.0');
  fs.rmSync(root, { recursive: true, force: true });
});

// ── #6: scan-clean does not flag Harness-managed OpenCode commands as orphan ─
test('update-check: prereleases are ignored and explicit older sources still refuse downgrade', () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  const remote = path.join(root, 'remote');
  fs.mkdirSync(path.join(proj, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '0.8.9',
    generated: '2026-07-01T00:00:00Z',
    checksums: {},
  }, null, 2) + '\n');
  fs.mkdirSync(remote, { recursive: true });
  fs.writeFileSync(path.join(remote, '.harness-version'), JSON.stringify({
    generator: '0.9.0-beta.1',
    generated: '2026-07-01T00:00:00Z',
    checksums: {},
  }, null, 2) + '\n');

  const prerelease = runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--json'], {
    cwd: proj,
    env: { WF_SOURCE_BASE: fileSourceBase(remote) },
  });
  assert.equal(prerelease.status, 0, 'prerelease check should exit 0');
  const prereleaseJson = JSON.parse(prerelease.stdout.trim());
  assert.equal(prereleaseJson.status, 'up-to-date', 'prerelease remote is ignored');
  assert.equal(prereleaseJson.remote, '0.9.0-beta.1');

  fs.writeFileSync(path.join(remote, '.harness-version'), JSON.stringify({
    generator: '0.8.8',
    generated: '2026-07-01T00:00:00Z',
    checksums: {},
  }, null, 2) + '\n');
  const downgrade = runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--json'], {
    cwd: proj,
    env: { WF_SOURCE_BASE: fileSourceBase(remote) },
  });
  assert.equal(downgrade.status, 1, 'explicit older source should fail');
  const downgradeJson = JSON.parse(downgrade.stdout.trim());
  assert.equal(downgradeJson.status, 'downgrade-refused');
  fs.rmSync(root, { recursive: true, force: true });
});

test('scan-clean: managed .opencode/commands and installed optional wf-browser are not orphaned', () => {
  const base = fileSourceBase(path.join(ROOT, 'templates', 'common'));

  // Default install: .opencode/commands/wf-update.md is checksum-tracked → not orphan.
  const root = tmpdir();
  let targetDir = path.join(root, 'proj');
  let gen = generate({ projectName: 'proj', targetDir });
  assert.equal(gen.success, true, gen.errors.join('\n'));
  let sc = runNode(path.join(SCRIPTS, 'scan-clean.mjs'), ['--json'], { cwd: targetDir, env: { WF_SOURCE_BASE: base } });
  let scJson = JSON.parse(sc.stdout.trim());
  let orphans = (scJson.orphan || []).map((o) => o.file);
  assert.ok(!orphans.includes('.opencode/commands/wf-update.md'), 'wf-update OpenCode wrapper not orphan; got: ' + orphans.join(','));
  assert.ok(!orphans.some((f) => f.startsWith('.opencode/commands/')), 'no OpenCode command wrappers orphaned; got: ' + orphans.join(','));
  fs.rmSync(root, { recursive: true, force: true });

  // Optional browser-e2e install: wf-browser wrapper must not be orphan/dead.
  const root2 = tmpdir();
  targetDir = path.join(root2, 'proj');
  gen = generate({ projectName: 'proj', targetDir, withOptions: ['browser-e2e'] });
  assert.equal(gen.success, true, gen.errors.join('\n'));
  sc = runNode(path.join(SCRIPTS, 'scan-clean.mjs'), ['--json'], { cwd: targetDir, env: { WF_SOURCE_BASE: base } });
  scJson = JSON.parse(sc.stdout.trim());
  orphans = (scJson.orphan || []).map((o) => o.file);
  const dead = (scJson.dead || []).map((o) => o.file);
  assert.ok(!orphans.includes('.opencode/commands/wf-browser.md'), 'wf-browser optional wrapper not orphan; got: ' + orphans.join(','));
  assert.ok(!dead.includes('.opencode/commands/wf-browser.md'), 'wf-browser optional wrapper not dead; got: ' + dead.join(','));
  fs.rmSync(root2, { recursive: true, force: true });
});

// ── #8: generator rejects a symlinked parent directory (chain safety) ──────
test('generator: rejects writes through a symlinked parent directory (.claude -> outside)', { skip: false }, async () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });

  let symlinkMade = false;
  try {
    fs.symlinkSync(outside, path.join(proj, '.claude'), 'dir');
    symlinkMade = true;
  } catch (e) {
    if (/EPERM|not permitted|privilege|operation not permitted/i.test(e.message)) {
      console.log('   SKIP: directory symlinks require elevated privileges on this platform');
      fs.rmSync(root, { recursive: true, force: true });
      return;
    }
    throw e;
  }
  assert.equal(symlinkMade, true, 'precondition: symlink created');

  const result = generate({ projectName: 'proj', targetDir: proj, onConflict: 'overwrite' });
  assert.equal(result.success, false, 'generate must fail when a parent dir is a symlink');
  assert.ok(result.errors.some((e) => /symlink/i.test(e)), 'error mentions symlink: ' + result.errors.join('; '));
  // Nothing should have been written through the symlink into the outside workspace.
  assert.equal(fs.readdirSync(outside).length, 0, 'no files escaped through the symlinked parent');
  fs.rmSync(root, { recursive: true, force: true });
});
