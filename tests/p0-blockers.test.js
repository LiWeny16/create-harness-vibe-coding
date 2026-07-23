import test, { after } from 'node:test';
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

const tempRoots = [];
function tmpdir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-p0-'));
  tempRoots.push(root);
  return root;
}
// Safety net: each test also does an inline rmSync at the end of its body, but if an
// assert above it throws, that inline cleanup is skipped. after() runs regardless of
// test failure, so the temp root is always reclaimed.
after(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

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

test('update-check: unchanged accepted conflicts carry forward across versions', () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  const remote = path.join(root, 'remote');
  fs.mkdirSync(path.join(proj, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), 'user claude rules\n');

  const remoteClaude = 'template claude\n';
  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '1.0.0',
    generated: '2026-01-01T00:00:00Z',
    checksums: { 'CLAUDE.md': sha('old template claude\n') },
    acceptedConflicts: {
      'CLAUDE.md': {
        decision: 'accept-local',
        targetGenerator: '1.0.0',
        localHash: sha('user claude rules\n'),
        remoteHash: sha(remoteClaude),
        templateHint: 'CLAUDE.md',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  }, null, 2) + '\n');

  fs.mkdirSync(remote, { recursive: true });
  fs.writeFileSync(path.join(remote, 'CLAUDE.md'), remoteClaude);
  fs.writeFileSync(path.join(remote, '.harness-version'), JSON.stringify({
    generator: '2.0.0',
    generated: '2026-07-22T00:00:00Z',
    checksums: { 'CLAUDE.md': sha(remoteClaude) },
    sources: { 'CLAUDE.md': 'CLAUDE.md' },
  }, null, 2) + '\n');

  const result = runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--json', '--full-plan'], {
    cwd: proj,
    env: { WF_SOURCE_BASE: fileSourceBase(remote) },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const json = JSON.parse(result.stdout.trim());
  assert.equal(json.conflict, 0);
  assert.ok(
    json.plan.skipped.some(entry => entry.file === 'CLAUDE.md' && /carried forward/.test(entry.reason)),
    JSON.stringify(json.plan.skipped),
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('update-check: colliding agent files use content ownership, not filename only', () => {
  const root = tmpdir();
  const remote = path.join(root, 'remote');
  fs.mkdirSync(path.join(remote, '.claude', 'agents'), { recursive: true });
  const remoteAgent = '---\nharness: wf-agent\nname: planner\ndescription: Remote harness planner\ntools: Read\nmodel: sonnet\n---\n\n# Planner\n\nHarness/tasks/PLAN.md\n';
  fs.writeFileSync(path.join(remote, '.claude', 'agents', 'planner.md'), remoteAgent);
  fs.writeFileSync(path.join(remote, '.harness-version'), JSON.stringify({
    generator: '2.0.0',
    generated: '2026-07-22T00:00:00Z',
    checksums: { '.claude/agents/planner.md': sha(remoteAgent) },
    sources: { '.claude/agents/planner.md': '.claude/agents/planner.md' },
  }, null, 2) + '\n');

  const harnessProj = path.join(root, 'harness-owned');
  fs.mkdirSync(path.join(harnessProj, 'Harness', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(harnessProj, '.claude', 'agents'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(harnessProj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.writeFileSync(path.join(harnessProj, '.claude', 'agents', 'planner.md'), '---\nharness: wf-agent\nname: planner\n---\n\nold project harness planner\n');
  fs.writeFileSync(path.join(harnessProj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '1.0.0',
    generated: '2026-01-01T00:00:00Z',
    checksums: {},
  }, null, 2) + '\n');

  const applied = runNode(path.join(harnessProj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--apply-safe'], {
    cwd: harnessProj,
    env: { WF_SOURCE_BASE: fileSourceBase(remote) },
  });
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  assert.equal(fs.readFileSync(path.join(harnessProj, '.claude', 'agents', 'planner.md'), 'utf8'), remoteAgent);

  const userProj = path.join(root, 'user-owned');
  fs.mkdirSync(path.join(userProj, 'Harness', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(userProj, '.claude', 'agents'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(userProj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.writeFileSync(path.join(userProj, '.claude', 'agents', 'planner.md'), '---\nname: planner\n---\n\nmy personal planning agent\n');
  fs.writeFileSync(path.join(userProj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '1.0.0',
    generated: '2026-01-01T00:00:00Z',
    checksums: {},
  }, null, 2) + '\n');

  const dryRun = runNode(path.join(userProj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--json', '--full-plan'], {
    cwd: userProj,
    env: { WF_SOURCE_BASE: fileSourceBase(remote) },
  });
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  const json = JSON.parse(dryRun.stdout.trim());
  assert.equal(json.conflict, 1);
  assert.ok(json.plan.conflict.some(entry => entry.file === '.claude/agents/planner.md'));
  assert.equal(fs.readFileSync(path.join(userProj, '.claude', 'agents', 'planner.md'), 'utf8'), '---\nname: planner\n---\n\nmy personal planning agent\n');
  fs.rmSync(root, { recursive: true, force: true });
});

test('update-check: user agent body mentioning /wf without a marker stays a conflict, not a Harness-owned update', () => {
  // RISK-1 regression on the update side: the bare /wf substring marker used
  // to false-match user files that merely mention /wf, silently reclassifying
  // them as Harness-owned updates. With the marker dropped, such a file must
  // remain a real CONFLICT.
  const root = tmpdir();
  const remote = path.join(root, 'remote');
  fs.mkdirSync(path.join(remote, '.claude', 'agents'), { recursive: true });
  const remoteAgent = '---\nharness: wf-agent\nname: planner\ndescription: Remote harness planner\ntools: Read\nmodel: sonnet\n---\n\n# Planner\n\nHarness/tasks/PLAN.md\n';
  fs.writeFileSync(path.join(remote, '.claude', 'agents', 'planner.md'), remoteAgent);
  fs.writeFileSync(path.join(remote, '.harness-version'), JSON.stringify({
    generator: '2.0.0',
    generated: '2026-07-22T00:00:00Z',
    checksums: { '.claude/agents/planner.md': sha(remoteAgent) },
    sources: { '.claude/agents/planner.md': '.claude/agents/planner.md' },
  }, null, 2) + '\n');

  const userProj = path.join(root, 'user-wf-text');
  fs.mkdirSync(path.join(userProj, 'Harness', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(userProj, '.claude', 'agents'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(userProj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  const userBody = '---\nname: planner\n---\n\nmy notes mention the /wf and /wf-max commands\n';
  fs.writeFileSync(path.join(userProj, '.claude', 'agents', 'planner.md'), userBody);
  fs.writeFileSync(path.join(userProj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '1.0.0',
    generated: '2026-01-01T00:00:00Z',
    checksums: {},
  }, null, 2) + '\n');

  const dryRun = runNode(path.join(userProj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--json', '--full-plan'], {
    cwd: userProj,
    env: { WF_SOURCE_BASE: fileSourceBase(remote) },
  });
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  const json = JSON.parse(dryRun.stdout.trim());
  assert.equal(json.conflict, 1);
  assert.ok(json.plan.conflict.some(entry => entry.file === '.claude/agents/planner.md'));
  assert.ok(!json.plan.updated.some(entry => entry.file === '.claude/agents/planner.md'));
  assert.equal(fs.readFileSync(path.join(userProj, '.claude', 'agents', 'planner.md'), 'utf8'), userBody);
  fs.rmSync(root, { recursive: true, force: true });
});

test('update-check: default source can use npm latest tarball without GitHub', async () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.mkdirSync(path.join(proj, 'Harness', 'specs', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'Harness', 'specs', 'workflows', 'WF.md'), 'old wf\n');
  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '1.0.0',
    generated: '2026-01-01T00:00:00Z',
    checksums: { 'Harness/specs/workflows/WF.md': sha('old wf\n') },
  }, null, 2) + '\n');

  const remoteFiles = { 'Harness/specs/workflows/WF.md': 'new wf\n' };
  const remoteVersion = {
    generator: '9.9.9',
    generated: '2026-07-22T00:00:00Z',
    checksums: { 'Harness/specs/workflows/WF.md': sha(remoteFiles['Harness/specs/workflows/WF.md']) },
    sources: { 'Harness/specs/workflows/WF.md': 'Harness/specs/workflows/WF.md' },
  };
  const tgz = makeTgz({
    'package/templates/common/.harness-version': JSON.stringify(remoteVersion, null, 2) + '\n',
    'package/templates/common/Harness/specs/workflows/WF.md': remoteFiles['Harness/specs/workflows/WF.md'],
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
    assert.ok(json.plan.updated.some(entry => entry.file === 'Harness/specs/workflows/WF.md'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('update-check: safe path moves create canonical specs path and remove legacy root doc', () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  const remote = path.join(root, 'remote');
  const from = 'Harness/WF.md';
  const to = 'Harness/specs/workflows/WF.md';
  const oldContent = 'old wf\n';
  const newContent = 'new wf\n';

  fs.mkdirSync(path.join(proj, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.writeFileSync(path.join(proj, ...from.split('/')), oldContent);
  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '1.0.0',
    generated: '2026-01-01T00:00:00Z',
    checksums: { [from]: sha(oldContent) },
    sources: { [from]: from },
  }, null, 2) + '\n');

  fs.mkdirSync(path.join(remote, 'Harness', 'specs', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(remote, ...to.split('/')), newContent);
  fs.writeFileSync(path.join(remote, '.harness-version'), JSON.stringify({
    generator: '2.0.0',
    generated: '2026-07-23T00:00:00.000Z',
    checksums: { [to]: sha(newContent) },
    sources: { [to]: to },
    moves: [{ from, to, deleteOldIfChecksumMatches: true, preserveOldIfModified: true }],
  }, null, 2) + '\n');

  const sourceBase = fileSourceBase(remote);
  const planResult = runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--json', '--full-plan'], {
    cwd: proj,
    env: { WF_SOURCE_BASE: sourceBase },
  });
  assert.equal(planResult.status, 0, planResult.stderr || planResult.stdout);
  const planJson = JSON.parse(planResult.stdout.trim());
  assert.equal(planJson.moved, 1);
  assert.ok(planJson.plan.moved.some(entry => entry.from === from && entry.to === to));
  assert.ok(!planJson.plan.created.some(entry => entry.file === to), 'moved file should not be double-counted as created');

  const applyResult = runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--apply-safe'], {
    cwd: proj,
    env: { WF_SOURCE_BASE: sourceBase },
  });
  assert.equal(applyResult.status, 0, applyResult.stderr || applyResult.stdout);
  assert.equal(fs.existsSync(path.join(proj, ...from.split('/'))), false, 'legacy root doc should be removed after safe move');
  assert.equal(fs.readFileSync(path.join(proj, ...to.split('/')), 'utf8'), newContent);

  const version = JSON.parse(fs.readFileSync(path.join(proj, 'Harness', '.harness-version'), 'utf8'));
  assert.equal(version.checksums[to], sha(newContent));
  assert.equal(version.sources[to], to);
  assert.equal(version.checksums[from], undefined);
  assert.equal(version.sources[from], undefined);
});

test('update-check: missing PRESERVE starter files are created without overwriting user data', () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  const remote = path.join(root, 'remote');
  const file = 'Harness/project/architecture.md';
  const content = '# Project Architecture\n\nStarter architecture notes.\n';

  fs.mkdirSync(path.join(proj, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '1.0.0',
    generated: '2026-01-01T00:00:00Z',
    checksums: {},
    sources: {},
  }, null, 2) + '\n');

  fs.mkdirSync(path.join(remote, 'Harness', 'project'), { recursive: true });
  fs.writeFileSync(path.join(remote, ...file.split('/')), content);
  fs.writeFileSync(path.join(remote, '.harness-version'), JSON.stringify({
    generator: '2.0.0',
    generated: '2026-07-23T00:00:00.000Z',
    checksums: { [file]: sha(content) },
    sources: { [file]: file },
  }, null, 2) + '\n');

  const sourceBase = fileSourceBase(remote);
  const planResult = runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--json', '--full-plan'], {
    cwd: proj,
    env: { WF_SOURCE_BASE: sourceBase },
  });
  assert.equal(planResult.status, 0, planResult.stderr || planResult.stdout);
  const planJson = JSON.parse(planResult.stdout.trim());
  assert.ok(planJson.plan.created.some(entry => entry.file === file), 'missing PRESERVE starter should be created');

  const applyResult = runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--apply-safe'], {
    cwd: proj,
    env: { WF_SOURCE_BASE: sourceBase },
  });
  assert.equal(applyResult.status, 0, applyResult.stderr || applyResult.stdout);
  assert.equal(fs.readFileSync(path.join(proj, ...file.split('/')), 'utf8'), content);

  fs.rmSync(root, { recursive: true, force: true });
});

test('update-check: unmodified legacy architecture moves to Harness/project', () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  const remote = path.join(root, 'remote');
  const from = 'Harness/architecture.md';
  const to = 'Harness/project/architecture.md';
  const oldContent = '# Old Architecture\n';
  const newContent = '# Project Architecture\n\n## 2. Interface Decoupling\n';

  fs.mkdirSync(path.join(proj, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.writeFileSync(path.join(proj, ...from.split('/')), oldContent);
  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '1.0.0',
    generated: '2026-01-01T00:00:00Z',
    checksums: { [from]: sha(oldContent) },
    sources: { [from]: from },
  }, null, 2) + '\n');

  fs.mkdirSync(path.join(remote, 'Harness', 'project'), { recursive: true });
  fs.writeFileSync(path.join(remote, ...to.split('/')), newContent);
  fs.writeFileSync(path.join(remote, '.harness-version'), JSON.stringify({
    generator: '2.0.0',
    generated: '2026-07-23T00:00:00.000Z',
    checksums: { [to]: sha(newContent) },
    sources: { [to]: to },
    moves: [{ from, to, deleteOldIfChecksumMatches: true, preserveOldIfModified: true }],
  }, null, 2) + '\n');

  const sourceBase = fileSourceBase(remote);
  const applyResult = runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--apply-safe'], {
    cwd: proj,
    env: { WF_SOURCE_BASE: sourceBase },
  });
  assert.equal(applyResult.status, 0, applyResult.stderr || applyResult.stdout);
  assert.equal(fs.existsSync(path.join(proj, ...from.split('/'))), false, 'legacy architecture should be removed after safe move');
  assert.equal(fs.readFileSync(path.join(proj, ...to.split('/')), 'utf8'), newContent);

  fs.rmSync(root, { recursive: true, force: true });
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

// ── all-or-nothing apply: a tampered served body writes ZERO files ─────────
test('apply-safe: hash mismatch on a served SAFE file writes zero files and leaves version tracking unchanged', () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  const remote = path.join(root, 'remote');
  fs.mkdirSync(path.join(proj, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'));
  fs.mkdirSync(path.join(proj, 'Harness', 'specs', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'Harness', 'specs', 'workflows', 'WF.md'), 'old wf\n');
  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'), JSON.stringify({
    generator: '1.0.0',
    generated: '2026-01-01T00:00:00Z',
    checksums: { 'Harness/specs/workflows/WF.md': sha('old wf\n') },
  }, null, 2) + '\n');

  // Serve ONE SAFE file whose body is tampered so its sha256 differs from the manifest.
  fs.mkdirSync(path.join(remote, 'Harness', 'specs', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(remote, 'Harness', 'specs', 'workflows', 'WF.md'), 'tampered wf body\n');
  fs.writeFileSync(path.join(remote, '.harness-version'), JSON.stringify({
    generator: '2.0.0',
    generated: '2026-07-22T00:00:00Z',
    checksums: { 'Harness/specs/workflows/WF.md': sha('the real canonical wf body\n') },
    sources: { 'Harness/specs/workflows/WF.md': 'Harness/specs/workflows/WF.md' },
  }, null, 2) + '\n');

  const result = runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--apply-safe'], {
    cwd: proj,
    env: { WF_SOURCE_BASE: fileSourceBase(remote) },
  });

  // Non-zero exit and a hash-mismatch failure is reported.
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /Hash mismatch: Harness\/specs\/workflows\/WF\.md/);
  // ZERO files written: destination keeps its original content (no partial application).
  assert.equal(fs.readFileSync(path.join(proj, 'Harness', 'specs', 'workflows', 'WF.md'), 'utf8'), 'old wf\n');
  // Version tracking unchanged -> safe to re-run with --apply-safe.
  const version = JSON.parse(fs.readFileSync(path.join(proj, 'Harness', '.harness-version'), 'utf8'));
  assert.equal(version.generator, '1.0.0');
  assert.equal(version.partialUpdate, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── GitHub releases 403 is swallowed; updater falls through to canonical raw ─
test('update-check: GitHub releases 403 is swallowed and updater resolves canonical raw source', async () => {
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
  const githubReleasesUrl = 'https://api.github.com/repos/LiWeny16/create-harness-vibe-coding/releases/latest';
  const canonicalManifestUrl = 'https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/.harness-version';
  const preload = path.join(root, 'fake-fetch-403.mjs');
  fs.writeFileSync(preload, `
const githubReleasesUrl = ${JSON.stringify(githubReleasesUrl)};
const canonicalManifestUrl = ${JSON.stringify(canonicalManifestUrl)};
globalThis.fetch = async function fakeFetch(input) {
  const url = String(input);
  if (url === githubReleasesUrl) {
    return new Response('rate limited', { status: 403 });
  }
  if (url === canonicalManifestUrl) {
    return new Response(process.env.HARNESS_FAKE_CANONICAL_MANIFEST, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('blocked by 403-fallback test: ' + url, { status: 503 });
};
`, 'utf8');

  const result = await runNodeAsync(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), ['--json'], {
    cwd: proj,
    env: {
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      HARNESS_FAKE_CANONICAL_MANIFEST: JSON.stringify(remoteVersion),
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const json = JSON.parse(result.stdout.trim());
  assert.equal(json.status, 'update-available');
  assert.equal(json.to, '2.0.0');
  assert.equal(json.sourceBase, 'https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/');
  fs.rmSync(root, { recursive: true, force: true });
});

// ── manifest-first classification (ownership.manifest.json) ────────────────
// The ownership manifest is the new source of truth for file classification.
// These tests assert manifest-first decisions (preserve/merge/frameworkOwned/
// optionalOwned) plus the regex/marker FALLBACK for old installs with no
// manifest, and the manifest-first untracked-existing-file ownership decision.

function fixtureManifest({ preserve = [], merge = [], frameworkOwned = [], optionalOwned = [], bootstrapOnly = [] } = {}) {
  return {
    schemaVersion: 1,
    generator: '0.8.14',
    source: 'fixture',
    generated: '2026-07-22T00:00:00.000Z',
    preserve,
    merge,
    bootstrapOnly,
    frameworkOwned: frameworkOwned.map(p => ({ path: p, kind: 'config', overwrite: 'safe' })),
    optionalOwned,
  };
}

function copyUpdater(proj) {
  fs.mkdirSync(path.join(proj, 'Harness', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'wf-update-check.mjs'), path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'));
}

function writeProjFile(proj, file, content) {
  const full = path.join(proj, ...file.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function writeProjVersion(proj, version) {
  fs.mkdirSync(path.join(proj, 'Harness'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'Harness', '.harness-version'), JSON.stringify(version, null, 2) + '\n', 'utf-8');
}

function writeRemoteVersion(remote, version) {
  fs.writeFileSync(path.join(remote, '.harness-version'), JSON.stringify(version, null, 2) + '\n', 'utf-8');
}

function runUpdateCheck(proj, remote, extraArgs = ['--json', '--full-plan']) {
  return runNode(path.join(proj, 'Harness', 'scripts', 'wf-update-check.mjs'), extraArgs, {
    cwd: proj,
    env: { WF_SOURCE_BASE: fileSourceBase(remote) },
  });
}

function writeManifest(proj, manifest) {
  writeProjFile(proj, 'Harness/ownership.manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}

test('manifest-first: PRESERVE (glob + exact) skips user files even when remote differs', () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  const remote = path.join(root, 'remote');
  copyUpdater(proj);
  writeManifest(proj, fixtureManifest({
    preserve: ['Harness/tasks/**', 'Harness/PROGRESS.md'],
    frameworkOwned: ['Harness/ownership.manifest.json'],
  }));
  writeProjFile(proj, 'Harness/PROGRESS.md', 'local progress\n');
  writeProjFile(proj, 'Harness/tasks/my-task/PROGRESS.md', 'task progress\n');
  writeProjVersion(proj, {
    generator: '1.0.0', generated: '2026-01-01T00:00:00Z',
    checksums: {
      'Harness/PROGRESS.md': sha('local progress\n'),
      'Harness/tasks/my-task/PROGRESS.md': sha('task progress\n'),
    },
  });
  fs.mkdirSync(remote, { recursive: true });
  writeProjFile(remote, 'Harness/PROGRESS.md', 'remote progress\n');
  writeProjFile(remote, 'Harness/tasks/my-task/PROGRESS.md', 'remote task progress\n');
  writeRemoteVersion(remote, {
    generator: '2.0.0', generated: '2026-07-22T00:00:00Z',
    checksums: {
      'Harness/PROGRESS.md': sha('remote progress\n'),
      'Harness/tasks/my-task/PROGRESS.md': sha('remote task progress\n'),
    },
    sources: {
      'Harness/PROGRESS.md': 'Harness/PROGRESS.md',
      'Harness/tasks/my-task/PROGRESS.md': 'Harness/tasks/my-task/PROGRESS.md',
    },
  });

  const res = runUpdateCheck(proj, remote);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const json = JSON.parse(res.stdout.trim());
  assert.ok(json.plan.skipped.some(e => e.file === 'Harness/PROGRESS.md' && /PRESERVE/.test(e.reason)), 'exact preserve: ' + JSON.stringify(json.plan.skipped));
  assert.ok(json.plan.skipped.some(e => e.file === 'Harness/tasks/my-task/PROGRESS.md' && /PRESERVE/.test(e.reason)), 'glob preserve: ' + JSON.stringify(json.plan.skipped));
  assert.ok(!json.plan.updated.some(e => e.file === 'Harness/PROGRESS.md' || e.file === 'Harness/tasks/my-task/PROGRESS.md'));
  assert.ok(!json.plan.conflict.some(e => e.file === 'Harness/PROGRESS.md' || e.file === 'Harness/tasks/my-task/PROGRESS.md'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('manifest-first: MERGE file modified -> CONFLICT, unmodified -> SAFE update', () => {
  const root = tmpdir();
  const remote = path.join(root, 'remote');
  const manifest = fixtureManifest({
    merge: ['Harness/README.md'],
    frameworkOwned: ['Harness/ownership.manifest.json'],
  });

  fs.mkdirSync(remote, { recursive: true });
  writeProjFile(remote, 'Harness/README.md', 'remote readme\n');
  writeRemoteVersion(remote, {
    generator: '2.0.0', generated: '2026-07-22T00:00:00Z',
    checksums: { 'Harness/README.md': sha('remote readme\n') },
    sources: { 'Harness/README.md': 'Harness/README.md' },
  });

  // Modified locally (storedHash != localHash).
  const projM = path.join(root, 'modified');
  copyUpdater(projM);
  writeManifest(projM, manifest);
  writeProjFile(projM, 'Harness/README.md', 'local readme edit\n');
  writeProjVersion(projM, {
    generator: '1.0.0', generated: '2026-01-01T00:00:00Z',
    checksums: { 'Harness/README.md': sha('original readme\n') },
  });
  let res = runUpdateCheck(projM, remote);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  let json = JSON.parse(res.stdout.trim());
  assert.ok(json.plan.conflict.some(e => e.file === 'Harness/README.md'), 'modified MERGE -> conflict: ' + JSON.stringify(json.plan));
  assert.ok(!json.plan.updated.some(e => e.file === 'Harness/README.md'), 'modified MERGE not auto-updated');

  // Unmodified (localHash === storedHash), remote differs -> SAFE update.
  const projU = path.join(root, 'unmodified');
  copyUpdater(projU);
  writeManifest(projU, manifest);
  writeProjFile(projU, 'Harness/README.md', 'original readme\n');
  writeProjVersion(projU, {
    generator: '1.0.0', generated: '2026-01-01T00:00:00Z',
    checksums: { 'Harness/README.md': sha('original readme\n') },
  });
  res = runUpdateCheck(projU, remote);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  json = JSON.parse(res.stdout.trim());
  assert.ok(json.plan.updated.some(e => e.file === 'Harness/README.md'), 'unmodified MERGE -> SAFE update: ' + JSON.stringify(json.plan));
  assert.ok(!json.plan.conflict.some(e => e.file === 'Harness/README.md'), 'unmodified MERGE not a conflict');
  fs.rmSync(root, { recursive: true, force: true });
});

test('manifest-first: frameworkOwned file classifies as SAFE update tier', () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  const remote = path.join(root, 'remote');
  copyUpdater(proj);
  writeManifest(proj, fixtureManifest({
    frameworkOwned: ['.claude/agents/planner.md', 'Harness/ownership.manifest.json'],
  }));
  writeProjFile(proj, '.claude/agents/planner.md', 'planner v1\n');
  writeProjVersion(proj, {
    generator: '1.0.0', generated: '2026-01-01T00:00:00Z',
    checksums: { '.claude/agents/planner.md': sha('planner v1\n') },
  });
  fs.mkdirSync(remote, { recursive: true });
  writeProjFile(remote, '.claude/agents/planner.md', 'planner v2\n');
  writeRemoteVersion(remote, {
    generator: '2.0.0', generated: '2026-07-22T00:00:00Z',
    checksums: { '.claude/agents/planner.md': sha('planner v2\n') },
    sources: { '.claude/agents/planner.md': '.claude/agents/planner.md' },
  });

  const res = runUpdateCheck(proj, remote);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const json = JSON.parse(res.stdout.trim());
  assert.ok(json.plan.updated.some(e => e.file === '.claude/agents/planner.md'), 'frameworkOwned -> SAFE update: ' + JSON.stringify(json.plan));
  assert.ok(!json.plan.conflict.some(e => e.file === '.claude/agents/planner.md'), 'frameworkOwned not a conflict');
  fs.rmSync(root, { recursive: true, force: true });
});

test('manifest-first: optionalOwned file SAFE when option selected, skipped when not selected', () => {
  const root = tmpdir();
  const remote = path.join(root, 'remote');
  const browserPath = '.claude/skills/wf-browser/SKILL.md';
  const manifest = fixtureManifest({
    frameworkOwned: ['Harness/ownership.manifest.json'],
    optionalOwned: [{ option: 'browser-e2e', paths: [browserPath], overwrite: 'safe-if-installed' }],
  });

  fs.mkdirSync(remote, { recursive: true });
  writeProjFile(remote, browserPath, 'browser v2\n');
  writeRemoteVersion(remote, {
    generator: '2.0.0', generated: '2026-07-22T00:00:00Z',
    checksums: { [browserPath]: sha('browser v2\n') },
    sources: { [browserPath]: browserPath },
  });

  // Option IS selected + file tracked locally -> SAFE update (not skipped as unselected).
  const projSel = path.join(root, 'selected');
  copyUpdater(projSel);
  writeManifest(projSel, manifest);
  writeProjFile(projSel, browserPath, 'browser v1\n');
  writeProjVersion(projSel, {
    generator: '1.0.0', generated: '2026-01-01T00:00:00Z',
    options: ['browser-e2e'],
    checksums: { [browserPath]: sha('browser v1\n') },
  });
  let res = runUpdateCheck(projSel, remote);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  let json = JSON.parse(res.stdout.trim());
  assert.ok(json.plan.updated.some(e => e.file === browserPath), 'optional installed -> SAFE update: ' + JSON.stringify(json.plan));
  assert.ok(!json.plan.skipped.some(e => e.file === browserPath && /not selected/.test(e.reason)), 'optional installed not skipped as unselected');

  // Option NOT selected, file not tracked locally -> skipped, never force-applied.
  const projNo = path.join(root, 'not-selected');
  copyUpdater(projNo);
  writeManifest(projNo, manifest);
  writeProjVersion(projNo, {
    generator: '1.0.0', generated: '2026-01-01T00:00:00Z',
    options: [],
    checksums: {},
  });
  res = runUpdateCheck(projNo, remote);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  json = JSON.parse(res.stdout.trim());
  assert.ok(json.plan.skipped.some(e => e.file === browserPath && /not selected/.test(e.reason)), 'optional unselected -> skipped: ' + JSON.stringify(json.plan.skipped));
  assert.ok(!json.plan.created.some(e => e.file === browserPath), 'optional unselected not force-created');
  assert.ok(!json.plan.updated.some(e => e.file === browserPath), 'optional unselected not force-updated');
  fs.rmSync(root, { recursive: true, force: true });
});

test('manifest-first: undeclared user file at Harness path with no marker -> conflict (protected)', () => {
  const root = tmpdir();
  const proj = path.join(root, 'proj');
  const remote = path.join(root, 'remote');
  copyUpdater(proj);
  // Minimal manifest that does NOT declare .claude/agents/planner.md.
  writeManifest(proj, fixtureManifest({
    frameworkOwned: ['Harness/ownership.manifest.json'],
  }));
  // User-authored file at a candidate path, NO harness marker, not in local checksums.
  const userBody = '---\nname: planner\n---\n\nmy personal planner\n';
  writeProjFile(proj, '.claude/agents/planner.md', userBody);
  writeProjVersion(proj, {
    generator: '1.0.0', generated: '2026-01-01T00:00:00Z',
    checksums: {},
  });
  fs.mkdirSync(remote, { recursive: true });
  writeProjFile(remote, '.claude/agents/planner.md', 'remote planner\n');
  writeRemoteVersion(remote, {
    generator: '2.0.0', generated: '2026-07-22T00:00:00Z',
    checksums: { '.claude/agents/planner.md': sha('remote planner\n') },
    sources: { '.claude/agents/planner.md': '.claude/agents/planner.md' },
  });

  const res = runUpdateCheck(proj, remote);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const json = JSON.parse(res.stdout.trim());
  assert.ok(json.plan.conflict.some(e => e.file === '.claude/agents/planner.md'), 'undeclared user file -> conflict: ' + JSON.stringify(json.plan));
  assert.ok(!json.plan.updated.some(e => e.file === '.claude/agents/planner.md'), 'undeclared user file NOT auto-overwritten');
  assert.equal(fs.readFileSync(path.join(proj, '.claude', 'agents', 'planner.md'), 'utf-8'), userBody, 'user file content preserved');
  fs.rmSync(root, { recursive: true, force: true });
});

test('manifest-first: declared frameworkOwned untracked file is marker-decided (no marker -> conflict, marker -> adopted)', () => {
  // AC #5: a user's same-name file at a manifest-declared frameworkOwned path
  // must NEVER be silently overwritten. The manifest declaration only puts the
  // path in the Harness-interest candidate set; the MARKER decides whether an
  // untracked existing file is a prior Harness install (adopt) or user-authored
  // (protected conflict). This holds in manifest mode and matches the installer.
  const root = tmpdir();
  const remote = path.join(root, 'remote');
  const manifest = fixtureManifest({
    frameworkOwned: ['.claude/agents/planner.md', 'Harness/ownership.manifest.json'],
  });
  fs.mkdirSync(remote, { recursive: true });
  writeProjFile(remote, '.claude/agents/planner.md', 'remote planner\n');
  writeRemoteVersion(remote, {
    generator: '2.0.0', generated: '2026-07-22T00:00:00Z',
    checksums: { '.claude/agents/planner.md': sha('remote planner\n') },
    sources: { '.claude/agents/planner.md': '.claude/agents/planner.md' },
  });

  // No marker: user-authored file at a declared frameworkOwned path -> CONFLICT.
  const projUser = path.join(root, 'user-no-marker');
  copyUpdater(projUser);
  writeManifest(projUser, manifest);
  const userBody = 'no marker here at all\n';
  writeProjFile(projUser, '.claude/agents/planner.md', userBody);
  writeProjVersion(projUser, {
    generator: '1.0.0', generated: '2026-01-01T00:00:00Z',
    checksums: {},
  });
  let res = runUpdateCheck(projUser, remote);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  let json = JSON.parse(res.stdout.trim());
  assert.ok(json.plan.conflict.some(e => e.file === '.claude/agents/planner.md'), 'declared untracked file with no marker -> conflict: ' + JSON.stringify(json.plan));
  assert.ok(!json.plan.updated.some(e => e.file === '.claude/agents/planner.md'), 'declared untracked file with no marker NOT auto-adopted');
  assert.equal(fs.readFileSync(path.join(projUser, '.claude', 'agents', 'planner.md'), 'utf8'), userBody, 'user file content preserved');

  // Has marker: prior Harness install at a declared frameworkOwned path -> adopted (plan.updated).
  const projHarness = path.join(root, 'harness-marker');
  copyUpdater(projHarness);
  writeManifest(projHarness, manifest);
  const harnessBody = '---\nharness: wf-agent\nname: planner\n---\n\nold harness planner\n';
  writeProjFile(projHarness, '.claude/agents/planner.md', harnessBody);
  writeProjVersion(projHarness, {
    generator: '1.0.0', generated: '2026-01-01T00:00:00Z',
    checksums: {},
  });
  res = runUpdateCheck(projHarness, remote);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  json = JSON.parse(res.stdout.trim());
  assert.ok(json.plan.updated.some(e => e.file === '.claude/agents/planner.md' && /untracked Harness-owned/.test(e.reason)), 'declared untracked file WITH marker -> adopted: ' + JSON.stringify(json.plan.updated));
  assert.ok(!json.plan.conflict.some(e => e.file === '.claude/agents/planner.md'), 'declared untracked file WITH marker not a conflict');

  fs.rmSync(root, { recursive: true, force: true });
});
