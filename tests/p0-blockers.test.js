import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
test('hook: settings.json command exits 0 from project root and from Harness/memory subdir', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
  const cmd = settings.hooks.UserPromptSubmit[0].hooks[0].command;
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

// ── #6: scan-clean does not flag Harness-managed OpenCode commands as orphan ─
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
