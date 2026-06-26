#!/usr/bin/env node
/**
 * e2e-wf-hooks.test.mjs — E2E tests for wf-mode-hook.mjs
 *
 * Verifies the 3-layer hook defense (SessionStart / UserPromptSubmit / PreToolUse),
 * security hardening (path traversal, symlink, bash injection), mode file I/O,
 * and per-turn reinforcement.
 *
 * Usage: node tests/e2e-wf-hooks.test.mjs
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'fs';
import { resolve, join, sep } from 'path';
import { execFileSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { platform } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HOOK_SCRIPT = resolve(ROOT, 'Harness', 'scripts', 'wf-mode-hook.mjs');
const TMP = resolve(ROOT, 'tests', '.tmp-hook-e2e');

let passed = 0;
let failed = 0;

function assert(condition, name, detail = '') {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

function runHook(eventJSON) {
  try {
    const result = execFileSync(process.execPath, [HOOK_SCRIPT], {
      input: JSON.stringify(eventJSON),
      encoding: 'utf8',
      timeout: 5000,
      cwd: ROOT,
    });
    return { stdout: result, stderr: '', exit: 0 };
  } catch (e) {
    return { stdout: e.stdout || '', stderr: e.stderr || '', exit: e.status || 1 };
  }
}

function setupModeFile(mode = 'wf-max', active = true) {
  const runtimeDir = join(ROOT, 'Harness', '.runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'current-mode.json'), JSON.stringify({
    active,
    mode,
    role: 'ceo',
    taskId: 'test-task',
    phase: 'W0_EXPLORE',
    explicitInvocation: true,
    startedAt: new Date().toISOString(),
  }, null, 2));
}

function cleanupModeFile() {
  const f = join(ROOT, 'Harness', '.runtime', 'current-mode.json');
  try { rmSync(f); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════
// SessionStart
// ═══════════════════════════════════════════════════════════════════════

console.log('\n── SessionStart ──');

setupModeFile('wf-max', true);
const ss = runHook({ hook_event_name: 'SessionStart' });
assert(ss.exit === 0, 'SessionStart exits 0');
assert(ss.stdout.includes('WF-MAX MODE ACTIVE'), 'SessionStart injects CEO role');
assert(ss.stdout.includes('W0_EXPLORE'), 'SessionStart includes phase');
cleanupModeFile();

// Idle mode — no injection
const ssIdle = runHook({ hook_event_name: 'SessionStart' });
assert(ssIdle.exit === 0, 'Idle SessionStart exits cleanly');
assert(!ssIdle.stdout.includes('WF-MAX'), 'Idle SessionStart does not inject');
assert(!ssIdle.stdout.includes('WF-REVIEW'), 'Idle SessionStart does not inject');

// WF-REVIEW mode
setupModeFile('wf-review', true);
const ssRev = runHook({ hook_event_name: 'SessionStart' });
assert(ssRev.stdout.includes('WF-REVIEW MODE ACTIVE'), 'SessionStart injects WF-REVIEW role');
assert(ssRev.stdout.includes('OTHER CLI'), 'SessionStart includes anti-self-review guard');
cleanupModeFile();

// ═══════════════════════════════════════════════════════════════════════
// UserPromptSubmit — mode detection
// ═══════════════════════════════════════════════════════════════════════

console.log('\n── UserPromptSubmit — Detection ──');

const modeFile = join(ROOT, 'Harness', '.runtime', 'current-mode.json');

// /wf-max detection
try { rmSync(modeFile); } catch {}
const upsMax = runHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-max implement auth' });
assert(upsMax.exit === 0, '/wf-max detection exits 0');
assert(existsSync(modeFile), '/wf-max creates mode file');
const mode1 = JSON.parse(readFileSync(modeFile, 'utf8'));
assert(mode1.mode === 'wf-max', '/wf-max sets mode to wf-max');
assert(mode1.active === true, '/wf-max sets active');
assert(mode1.role === 'ceo', '/wf-max sets role to ceo');
assert(mode1.phase === 'W0_EXPLORE', '/wf-max sets initial phase');

// /wf-review detection
try { rmSync(modeFile); } catch {}
runHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-review security' });
assert(existsSync(modeFile), '/wf-review creates mode file');
const mode2 = JSON.parse(readFileSync(modeFile, 'utf8'));
assert(mode2.mode === 'wf-review', '/wf-review sets mode');

// Natural language "wf max" detection
try { rmSync(modeFile); } catch {}
runHook({ hook_event_name: 'UserPromptSubmit', prompt: 'please enter wf max mode' });
assert(existsSync(modeFile), '"wf max" natural language triggers detection');

// Non-wf prompt — does NOT overwrite mode
setupModeFile('wf-max', true);
runHook({ hook_event_name: 'UserPromptSubmit', prompt: 'fix the login bug' });
const mode3 = JSON.parse(readFileSync(modeFile, 'utf8'));
assert(mode3.mode === 'wf-max', 'Non-wf prompt preserves existing mode');
cleanupModeFile();

// ═══════════════════════════════════════════════════════════════════════
// UserPromptSubmit — per-turn reinforcement
// ═══════════════════════════════════════════════════════════════════════

console.log('\n── UserPromptSubmit — Per-turn Reinforcement ──');

// WF-MAX per-turn
setupModeFile('wf-max', true);
const ptMax = runHook({ hook_event_name: 'UserPromptSubmit', prompt: 'do the thing' });
assert(ptMax.stdout.includes('hookSpecificOutput'), 'WF-MAX per-turn emits hookSpecificOutput');
assert(ptMax.stdout.includes('WF-MAX ACTIVE'), 'Per-turn reminds CEO role');
assert(ptMax.stdout.includes('W0_EXPLORE'), 'Per-turn includes phase');
cleanupModeFile();

// WF-REVIEW per-turn
setupModeFile('wf-review', true);
const ptRev = runHook({ hook_event_name: 'UserPromptSubmit', prompt: 'check it' });
assert(ptRev.stdout.includes('hookSpecificOutput'), 'WF-REVIEW per-turn emits hookSpecificOutput');
assert(ptRev.stdout.includes('OTHER CLI'), 'Per-turn reminds anti-self-review');
cleanupModeFile();

// Idle — no reinforcement
const ptIdle = runHook({ hook_event_name: 'UserPromptSubmit', prompt: 'casual question' });
assert(!ptIdle.stdout.includes('hookSpecificOutput'), 'Idle mode no per-turn output');

// ═══════════════════════════════════════════════════════════════════════
// PreToolUse — CEO blocking
// ═══════════════════════════════════════════════════════════════════════

console.log('\n── PreToolUse — CEO Blocking ──');

setupModeFile('wf-max', true);

// Block: Edit source file
const editBlock = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/auth.ts' } });
assert(editBlock.exit === 2, 'Edit src file BLOCKED');
assert(editBlock.stderr.includes('CEO BLOCK'), 'Edit block message');

// Block: Write source file
const writeBlock = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'index.js' } });
assert(writeBlock.exit === 2, 'Write source file BLOCKED');

// Block: MultiEdit source file
const multiEditBlock = runHook({ hook_event_name: 'PreToolUse', tool_name: 'MultiEdit', tool_input: { file_path: 'config.json' } });
assert(multiEditBlock.exit === 2, 'MultiEdit source file BLOCKED');

// Block: Bash with arbitrary command
const bashBlock = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm install' } });
assert(bashBlock.exit === 2, 'Bash arbitrary command BLOCKED');

// Allow: Edit PLAN.md
const planOk = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'Harness/tasks/test-task/PLAN.md' } });
assert(planOk.exit === 0, 'Write PLAN.md ALLOWED');

// Allow: Write PROGRESS.md
const progressOk = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'Harness/tasks/test-task/PROGRESS.md' } });
assert(progressOk.exit === 0, 'Edit PROGRESS.md ALLOWED');

// Allow: Bash git status
const gitOk = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
assert(gitOk.exit === 0, 'Bash git status ALLOWED');

// Allow: Bash ls
const lsOk = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la' } });
assert(lsOk.exit === 0, 'Bash ls ALLOWED');

// Allow: Bash harness script
const scriptOk = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'node Harness/scripts/validate-harness.mjs' } });
assert(scriptOk.exit === 0, 'Bash harness script ALLOWED');

cleanupModeFile();

// Idle — no CEO, no blocking
console.log('\n── PreToolUse — Idle (No CEO) ──');
const idleEdit = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/auth.ts' } });
assert(idleEdit.exit === 0, 'Idle Edit ALLOWED (no active mode)');

const idleBash = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm run build' } });
assert(idleBash.exit === 0, 'Idle Bash ALLOWED (no active mode)');

// ═══════════════════════════════════════════════════════════════════════
// Security — Bash injection prevention
// ═══════════════════════════════════════════════════════════════════════

console.log('\n── Security — Bash Injection ──');

setupModeFile('wf-max', true);

// Block: shell separator
const semiBlock = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status; rm -rf /' } });
assert(semiBlock.exit === 2, 'Bash with ; BLOCKED');

// Block: newline injection (the caveman-missed edge case)
const nlBlock = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status\nnode -e "console.log(1)"' } });
assert(nlBlock.exit === 2, 'Bash with newline BLOCKED');

// Block: pipe redirect
const pipeBlock = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git diff > /tmp/leak' } });
assert(pipeBlock.exit === 2, 'Bash with > redirect BLOCKED');

// Block: backtick injection
const btBlock = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo `cat /etc/passwd`' } });
assert(btBlock.exit === 2, 'Bash with backtick BLOCKED');

cleanupModeFile();

// ═══════════════════════════════════════════════════════════════════════
// Security — Path traversal prevention
// ═══════════════════════════════════════════════════════════════════════

console.log('\n── Security — Path Traversal ──');

setupModeFile('wf-max', true);

// Block: ../ traversal disguised as task file
const travBlock = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'Harness/tasks/../../src/PLAN.md' } });
assert(travBlock.exit === 2, 'Path traversal BLOCKED');

// Block: .. in path
const dotDotBlock = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'Harness/../secret.key' } });
assert(dotDotBlock.exit === 2, '.. traversal BLOCKED');

cleanupModeFile();

// ═══════════════════════════════════════════════════════════════════════
// Mode file — safe I/O
// ═══════════════════════════════════════════════════════════════════════

console.log('\n── Mode File I/O ──');

// Valid JSON round-trips correctly
try { rmSync(modeFile); } catch {}
runHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-max test' });
const m = JSON.parse(readFileSync(modeFile, 'utf8'));
assert(m.active === true, 'Mode file active flag set');
assert(m.mode === 'wf-max', 'Mode file mode set');
assert(m.explicitInvocation === true, 'Mode file explicitInvocation set');
assert(typeof m.startedAt === 'string', 'Mode file has timestamp');

// Corrupted mode file is rejected
writeFileSync(modeFile, 'not json');
const ssBad = runHook({ hook_event_name: 'SessionStart' });
assert(!ssBad.stdout.includes('WF-MAX'), 'Corrupted JSON rejected silently');

// Oversized mode file is rejected
writeFileSync(modeFile, 'x'.repeat(5000));
const ssBig = runHook({ hook_event_name: 'SessionStart' });
assert(!ssBig.stdout.includes('WF-MAX'), 'Oversized file rejected silently');

// Invalid mode value is rejected
writeFileSync(modeFile, JSON.stringify({ active: true, mode: 'evil-mode', role: 'ceo' }));
const ssBadMode = runHook({ hook_event_name: 'SessionStart' });
assert(!ssBadMode.stdout.includes('WF-MAX'), 'Invalid mode value rejected');

// Invalid phase value is rejected
writeFileSync(modeFile, JSON.stringify({ active: true, mode: 'wf-max', role: 'ceo', phase: 'do_bad_things' }));
const ssBadPhase = runHook({ hook_event_name: 'SessionStart' });
assert(!ssBadPhase.stdout.includes('WF-MAX'), 'Invalid phase rejected');

// Non-boolean active is rejected
writeFileSync(modeFile, JSON.stringify({ active: 'yes', mode: 'wf-max', role: 'ceo' }));
const ssBadBool = runHook({ hook_event_name: 'SessionStart' });
assert(!ssBadBool.stdout.includes('WF-MAX'), 'Non-boolean active rejected');

// TaskId sanitization — special chars and tags stripped, safe text preserved
writeFileSync(modeFile, JSON.stringify({ active: true, mode: 'wf-max', role: 'ceo', taskId: 'evil\n<script>alert(1)</script>' }));
const ssSanitize = runHook({ hook_event_name: 'SessionStart' });
assert(!ssSanitize.stdout.includes('<script>'), 'TaskId sanitized — script tag stripped');
// The taskId line in output should be on a single line (no injected newline breaks it)
const taskIdLine = ssSanitize.stdout.split('\n').find(l => l.includes('Task:'));
assert(taskIdLine && !taskIdLine.includes('\n'), 'TaskId line is single line — injected newline stripped');
assert(taskIdLine && taskIdLine.includes('evilscriptalert1script'), 'TaskId kept safe alphanumeric content');

// Extra-long taskId is truncated (not rejected)
const longId = 'x'.repeat(200);
writeFileSync(modeFile, JSON.stringify({ active: true, mode: 'wf-max', role: 'ceo', taskId: longId }));
const ssLong = runHook({ hook_event_name: 'SessionStart' });
assert(ssLong.stdout.includes('WF-MAX'), 'Long taskId session still activates');
assert(ssLong.stdout.includes('Task: ' + 'x'.repeat(128)), 'TaskId truncated to MAX_TASKID_BYTES');
assert(!ssLong.stdout.includes('x'.repeat(129)), 'TaskId does not exceed limit');

cleanupModeFile();

// ═══════════════════════════════════════════════════════════════════════
// Event format compatibility
// ═══════════════════════════════════════════════════════════════════════

console.log('\n── Event Format Compatibility ──');

setupModeFile('wf-max', true);

// hook_event_name (Codex-reported format)
const evt1 = runHook({ hook_event_name: 'SessionStart' });
assert(evt1.stdout.includes('WF-MAX'), 'hook_event_name format works');

// event (alternate format)
const evt2 = runHook({ event: 'SessionStart' });
assert(evt2.stdout.includes('WF-MAX'), 'event format works');

// type (fallback format)
const evt3 = runHook({ type: 'SessionStart' });
assert(evt3.stdout.includes('WF-MAX'), 'type format works');

cleanupModeFile();

// ═══════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Passed: ${passed}  Failed: ${failed}`);
console.log(`${'═'.repeat(60)}\n`);

if (failed > 0) {
  console.error(`${failed} test(s) FAILED`);
  process.exit(1);
}

console.log('All hook E2E tests passed.\n');
