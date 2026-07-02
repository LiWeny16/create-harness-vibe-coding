#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HOOK_SCRIPT = resolve(ROOT, 'Harness', 'scripts', 'wf-mode-hook.mjs');
const MODE_FILE = join(ROOT, 'Harness', '.runtime', 'current-mode.json');

let passed = 0;
let failed = 0;

function assert(condition, name, detail = '') {
  if (condition) {
    passed++;
    return;
  }
  failed++;
  console.error(`  FAIL: ${name}${detail ? ' - ' + detail : ''}`);
}

function runHook(event, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [HOOK_SCRIPT], {
      input: JSON.stringify(event),
      encoding: 'utf8',
      timeout: 5000,
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    return { stdout, stderr: '', exit: 0 };
  } catch (error) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exit: error.status || 1,
    };
  }
}

function writeMode(overrides = {}) {
  mkdirSync(dirname(MODE_FILE), { recursive: true });
  writeFileSync(MODE_FILE, JSON.stringify({
    active: true,
    mode: 'wf-max',
    taskId: 'test-task',
    phase: 'W0_EXPLORE',
    explicitInvocation: true,
    startedAt: new Date().toISOString(),
    ...overrides,
  }, null, 2));
}

function cleanupMode() {
  try {
    rmSync(MODE_FILE);
  } catch {}
}

function preTool(toolName, toolInput, dispatch = undefined) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    dispatch,
  };
}

console.log('\n-- syntax and mode lifecycle --');

cleanupMode();
let result = runHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-max implement auth' });
assert(result.exit === 0, '/wf-max detection exits cleanly', result.stderr);
assert(existsSync(MODE_FILE), '/wf-max creates observable mode file');
let mode = JSON.parse(readFileSync(MODE_FILE, 'utf8'));
assert(mode.active === true && mode.mode === 'wf-max', 'mode file records active wf-max');
assert(!('writeSet' in mode), 'mode activation does not create write authority');

result = runHook({ hook_event_name: 'SessionStart' });
assert(result.exit === 0, 'SessionStart exits cleanly');
assert(result.stdout.includes('WF-MAX'), 'SessionStart reports active mode');

console.log('\n-- dispatch context is authoritative --');

writeMode({ agentRole: 'worker', writeSet: ['CLAUDE.md'] });
result = runHook(preTool('Write', { file_path: join(ROOT, 'CLAUDE.md') }));
assert(result.exit === 2, 'mode-file worker writeSet does not grant authority');
assert(result.stderr.includes('no dispatch role'), 'missing dispatch role is reported');

result = runHook(preTool('Write', { file_path: join(ROOT, 'CLAUDE.md') }, {
  agentRole: 'worker',
  writeSet: ['CLAUDE.md'],
}));
assert(result.exit === 0, 'event dispatch worker can edit writeSet file', result.stderr);

result = runHook(preTool('Write', { file_path: join(ROOT, 'Harness', 'WF-MAX.md') }, {
  agentRole: 'worker',
  writeSet: ['CLAUDE.md'],
}));
assert(result.exit === 2, 'event dispatch worker cannot edit outside writeSet');
assert(result.stderr.includes('outside writeSet'), 'outside writeSet is reported');

result = runHook(preTool('Write', { file_path: join(ROOT, 'CLAUDE.md') }), {
  HARNESS_AGENT_ROLE: 'worker',
  HARNESS_WRITE_SET: JSON.stringify(['CLAUDE.md']),
});
assert(result.exit === 0, 'env dispatch worker can edit writeSet file', result.stderr);

result = runHook(preTool('Write', { file_path: join(ROOT, 'CLAUDE.md') }, {
  agentRole: 'worker',
  writeSet: ['CLAUDE.md'],
  forbidden: ['CLAUDE.md'],
}));
assert(result.exit === 2, 'forbidden overrides worker writeSet');
assert(result.stderr.includes('forbidden'), 'forbidden path is reported');

console.log('\n-- role enforcement --');

result = runHook(preTool('Write', { file_path: join(ROOT, 'CLAUDE.md') }, {
  agentRole: 'ceo',
}));
assert(result.exit === 2, 'CEO cannot source-edit');
assert(result.stderr.includes('CEO BLOCK'), 'CEO block is reported');

result = runHook(preTool('Write', { file_path: join(ROOT, 'Harness', 'tasks', 'test', 'PLAN.md') }, {
  agentRole: 'ceo',
}));
assert(result.exit === 0, 'CEO can write task PLAN');

result = runHook(preTool('Write', { file_path: join(ROOT, 'CLAUDE.md') }, {
  agentRole: 'manager',
}));
assert(result.exit === 2, 'manager cannot source-edit without writeSet');

result = runHook(preTool('Write', { file_path: join(ROOT, 'CLAUDE.md') }, {
  agentRole: 'manager',
  writeSet: ['CLAUDE.md'],
}));
assert(result.exit === 0, 'manager can write explicit writeSet when dispatched');

result = runHook(preTool('Write', { file_path: join(ROOT, 'Harness', 'tasks', 'test', 'PLAN.md') }, {
  agentRole: 'reviewer',
}));
assert(result.exit === 2, 'reviewer cannot write task files');

console.log('\n-- safety and recovery --');

result = runHook(preTool('Bash', { command: 'git status; rm -rf /' }, {
  agentRole: 'worker',
  writeSet: ['CLAUDE.md'],
}));
assert(result.exit === 2, 'shell metacharacters are blocked');

result = runHook(preTool('Write', { file_path: 'Harness/tasks/../../src/PLAN.md' }, {
  agentRole: 'worker',
  writeSet: ['Harness/tasks/../../src/PLAN.md'],
}));
assert(result.exit === 2, 'path traversal is blocked');

writeMode({
  startedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
});
result = runHook({ hook_event_name: 'SessionStart' });
assert(!result.stdout.includes('WF-MAX'), 'stale mode does not inject context');
mode = JSON.parse(readFileSync(MODE_FILE, 'utf8'));
assert(mode.active === false, 'stale mode clears observable state');

writeMode();
result = runHook({ hook_event_name: 'UserPromptSubmit', prompt: 'ceo done' });
assert(result.exit === 0, 'ceo done exits cleanly');
mode = JSON.parse(readFileSync(MODE_FILE, 'utf8'));
assert(mode.active === false, 'ceo done clears observable state');

cleanupMode();

console.log(`\nPassed: ${passed}  Failed: ${failed}\n`);
if (failed > 0) process.exit(1);
console.log('All hook E2E tests passed.');
