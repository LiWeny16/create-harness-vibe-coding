// Generates all 12 batch test scenario files cleanly
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'scenarios');
mkdirSync(OUT, { recursive: true });

const S = (name, content) => writeFileSync(join(OUT, name), content.trim() + '\n');

// ── Helper: create mock project with CLAUDE.md so hook resolves correctly ──
function mockProject(name) {
  const P = process.env.BATCH_TMP + '/' + name;
  mkdirSync(join(P, 'Harness', '.runtime'), { recursive: true });
  writeFileSync(join(P, 'CLAUDE.md'), '# test project\\n');
  return P;
}

// ── 01: wf-max CEO enforcement ──
S('01-wf-max-ceo.mjs', `import { simulateHook, readModeFile, createHarnessProject } from '../harness/setup.mjs';
import { scenario, assert, assertMode, assertHookBlocked, assertHookAllowed, assertSessionStartContains, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

scenario('01-wf-max-ceo');
const P = createHarnessProject('01-wf-max-ceo');
process.env.BATCH_PROJECT = P;
mkdirSync(join(P, 'src'), { recursive: true });
writeFileSync(join(P, 'src', 'index.js'), '// test');
let r;
mkdirSync(join(P, 'Harness', 'tasks', 'test'), { recursive: true });
mkdirSync(join(P, 'src'), { recursive: true });
writeFileSync(join(P, 'src', 'index.js'), '// test');
let r;

r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-max test fixing a bug' });
assert(r.exit === 0, '/wf-max detected');

let mode = readModeFile(P);
assertMode(mode, 'wf-max', 'ceo', 'W0_EXPLORE');

r = simulateHook({ hook_event_name: 'SessionStart' });
assertSessionStartContains(r.stdout, 'WF-MAX CEO');

r = simulateHook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(P, 'src', 'index.js') } });
assertHookBlocked(r, 'Edit source blocked');

r = simulateHook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(P, 'index.js') } });
assertHookBlocked(r, 'Write source blocked');

r = simulateHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm install' } });
assertHookBlocked(r, 'Bash arbitrary blocked');

r = simulateHook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(P, 'Harness', 'tasks', 'test', 'PLAN.md') } });
assertHookAllowed(r, 'Write PLAN.md allowed');

process.exit(summary());
`);

// ── 02: Worker writeSet boundaries ──
S('02-wf-max-worker.mjs', `import { simulateHook, readModeFile } from '../harness/setup.mjs';
import { scenario, assert, assertHookBlocked, assertHookAllowed, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

scenario('02-wf-max-worker');
const P = process.env.BATCH_TMP + '/02-wf-max-worker';
const R = join(P, 'Harness', '.runtime');
mkdirSync(R, { recursive: true });

writeFileSync(join(R, 'current-mode.json'), JSON.stringify({
  active: true, mode: 'wf-max', agentRole: 'worker', role: 'worker',
  taskId: 'test-worker', phase: 'W2_IMPLEMENT',
  writeSet: ['CLAUDE.md', 'AGENTS.md'],
  startedAt: new Date().toISOString(),
}));

let r = simulateHook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(P, 'CLAUDE.md') } });
assertHookAllowed(r, 'Worker Write writeSet file');

r = simulateHook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(P, 'Harness', 'WF-MAX.md') } });
assertHookBlocked(r, 'Worker Edit outside writeSet');

process.exit(summary());
`);

// ── 03: CEO escalation ──
S('03-ceo-escalate.mjs', `import { simulateHook, readModeFile } from '../harness/setup.mjs';
import { scenario, assert, assertMode, assertHookBlocked, assertHookAllowed, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

scenario('03-ceo-escalate');
const P = process.env.BATCH_TMP + '/03-ceo-escalate';
const R = join(P, 'Harness', '.runtime');
mkdirSync(R, { recursive: true });

writeFileSync(join(R, 'current-mode.json'), JSON.stringify({
  active: true, mode: 'wf-max', agentRole: 'ceo', role: 'ceo',
  taskId: 'test-ceo', phase: 'W2_IMPLEMENT',
  startedAt: new Date().toISOString(),
}));

let r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: 'ceo escalate CLAUDE.md "Worker stuck on syntax"' });
assert(r.exit === 0, 'escalate accepted');

let mode = readModeFile(P);
assert(mode.agentRole === 'ceo-escalated', 'role=ceo-escalated');
assert(mode.writeSet && mode.writeSet.includes('CLAUDE.md'), 'writeSet has escalated file');

r = simulateHook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(P, 'CLAUDE.md') } });
assertHookAllowed(r, 'Escalated CEO Write CLAUDE.md');

r = simulateHook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(P, 'Harness', 'WF-MAX.md') } });
assertHookBlocked(r, 'Escalated CEO Edit outside');

r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: 'ceo deescalate' });
assert(r.exit === 0, 'deescalate accepted');
mode = readModeFile(P);
assert(mode.agentRole === 'ceo', 'back to ceo');
assert(!mode.writeSet, 'writeSet cleared');

process.exit(summary());
`);

// ── 04: wf-auto-spark ──
S('04-wf-auto-spark.mjs', `import { simulateHook, readModeFile } from '../harness/setup.mjs';
import { scenario, assert, assertMode, assertSessionStartContains, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { mkdirSync } from 'fs';

scenario('04-wf-auto-spark');
const P = process.env.BATCH_TMP + '/04-wf-auto-spark';
mkdirSync(join(P, 'Harness', '.runtime'), { recursive: true });

let r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-auto-spark need optimization' });
assert(r.exit === 0, '/wf-auto-spark detected');

let mode = readModeFile(P);
assertMode(mode, 'wf-auto-spark', 'ceo', 'SPARK');

r = simulateHook({ hook_event_name: 'SessionStart' });
assertSessionStartContains(r.stdout, 'WF-AUTO-SPARK');

process.exit(summary());
`);

// ── 05: wf-auto ──
S('05-wf-auto.mjs', `import { simulateHook, readModeFile } from '../harness/setup.mjs';
import { scenario, assert, assertMode, assertSessionStartContains, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { mkdirSync } from 'fs';

scenario('05-wf-auto');
const P = process.env.BATCH_TMP + '/05-wf-auto';
mkdirSync(join(P, 'Harness', '.runtime'), { recursive: true });

let r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-auto optimize the codebase' });
assert(r.exit === 0, '/wf-auto detected');

let mode = readModeFile(P);
assertMode(mode, 'wf-auto', 'ceo', 'AUTO');

r = simulateHook({ hook_event_name: 'SessionStart' });
assertSessionStartContains(r.stdout, 'WF-AUTO');

process.exit(summary());
`);

// ── 06: wf mode ──
S('06-wf-mode.mjs', `import { simulateHook, readModeFile } from '../harness/setup.mjs';
import { scenario, assert, assertMode, assertSessionStartContains, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { mkdirSync } from 'fs';

scenario('06-wf-mode');
const P = process.env.BATCH_TMP + '/06-wf-mode';
mkdirSync(join(P, 'Harness', '.runtime'), { recursive: true });

let r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf fix the auth bug' });
assert(r.exit === 0, '/wf detected');

let mode = readModeFile(P);
assertMode(mode, 'wf', 'ceo', 'W0_EXPLORE');

r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: 'lets use wf mode to plan this' });
assert(r.exit === 0, 'wf mode detected');
mode = readModeFile(P);
assertMode(mode, 'wf', 'ceo', 'W0_EXPLORE');

r = simulateHook({ hook_event_name: 'SessionStart' });
assertSessionStartContains(r.stdout, 'WF MODE');

process.exit(summary());
`);

// ── 07: wf-review + wf-learn ──
S('07-wf-review-learn.mjs', `import { simulateHook, readModeFile } from '../harness/setup.mjs';
import { scenario, assert, assertMode, assertSessionStartContains, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { mkdirSync } from 'fs';

scenario('07-wf-review-learn');
const P = process.env.BATCH_TMP + '/07-wf-review-learn';
mkdirSync(join(P, 'Harness', '.runtime'), { recursive: true });

let r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-review this PR' });
assert(r.exit === 0, '/wf-review detected');
let mode = readModeFile(P);
assertMode(mode, 'wf-review', 'ceo', 'REVIEW');

r = simulateHook({ hook_event_name: 'SessionStart' });
assertSessionStartContains(r.stdout, 'WF-REVIEW');

r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-learn' });
assert(r.exit === 0, '/wf-learn detected');
mode = readModeFile(P);
assertMode(mode, 'wf-learn', 'ceo', 'LEARN');

r = simulateHook({ hook_event_name: 'SessionStart' });
assertSessionStartContains(r.stdout, 'WF-LEARN');

process.exit(summary());
`);

// ── 08: stale mode auto-clear ──
S('08-stale-mode-clear.mjs', `import { simulateHook, readModeFile } from '../harness/setup.mjs';
import { scenario, assert, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

scenario('08-stale-clear');
const P = process.env.BATCH_TMP + '/08-stale-clear';
const R = join(P, 'Harness', '.runtime');
mkdirSync(R, { recursive: true });

writeFileSync(join(R, 'current-mode.json'), JSON.stringify({
  active: true, mode: 'wf-max', agentRole: 'ceo',
  taskId: 'stale-task', phase: 'W0_EXPLORE',
  startedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
}));

let r = simulateHook({ hook_event_name: 'SessionStart' });
assert(!r.stdout.includes('WF-MAX'), 'stale mode NOT injected');
let mode = readModeFile(P);
assert(mode.active === false, 'stale mode cleared');

writeFileSync(join(R, 'current-mode.json'), JSON.stringify({
  active: true, mode: 'wf-max', agentRole: 'ceo',
  taskId: 'no-ts', phase: 'W0_EXPLORE',
}));

r = simulateHook({ hook_event_name: 'SessionStart' });
assert(!r.stdout.includes('WF-MAX'), 'no-startedAt NOT injected');
mode = readModeFile(P);
assert(mode.active === false, 'no-startedAt cleared');

process.exit(summary());
`);

// ── 09: goal persistence ──
S('09-goal-persistence.mjs', `import { simulateHook } from '../harness/setup.mjs';
import { scenario, assert, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';

scenario('09-goal-persistence');
const P = process.env.BATCH_TMP + '/09-goal';
const R = join(P, 'Harness', '.runtime');
mkdirSync(R, { recursive: true });

let r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: 'goal set fix the memory leak' });
assert(r.exit === 0, 'goal set accepted');

const gf = join(R, 'goals.json');
assert(existsSync(gf), 'goals.json created');
let g = JSON.parse(readFileSync(gf, 'utf8'));
assert(g.goals.length === 1, '1 goal');
assert(g.goals[0].status === 'active', 'active');
const id = g.goals[0].id;

r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: 'goal complete ' + id });
g = JSON.parse(readFileSync(gf, 'utf8'));
assert(g.goals[0].status === 'completed', 'completed');

process.exit(summary());
`);

// ── 10: PostToolUse memory capture ──
S('10-posttooluse-memory.mjs', `import { simulateHook } from '../harness/setup.mjs';
import { scenario, assert, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { mkdirSync } from 'fs';

scenario('10-posttooluse-memory');
const P = process.env.BATCH_TMP + '/10-memory';
mkdirSync(join(P, 'Harness', '.runtime'), { recursive: true });
mkdirSync(join(P, 'Harness', 'memory'), { recursive: true });

let r = simulateHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash',
  tool_stderr: 'Error: EACCES permission denied',
  tool_stdout: '' });
assert(r.exit === 0, 'PostToolUse error exits 0');

r = simulateHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash',
  tool_stdout: 'Tests: 3 passed, 1 failed',
  tool_stderr: '' });
assert(r.exit === 0, 'PostToolUse test result exits 0');

r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: 'don\\'t forget: always use const first' });
r = simulateHook({ hook_event_name: 'PostToolUse', tool_name: 'Edit',
  tool_stdout: 'file saved', tool_stderr: '' });
assert(r.exit === 0, 'PostToolUse correction exits 0');

process.exit(summary());
`);

// ── 11: cross-mode transitions ──
S('11-cross-mode-transition.mjs', `import { simulateHook, readModeFile } from '../harness/setup.mjs';
import { scenario, assertMode, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { mkdirSync } from 'fs';

scenario('11-cross-mode');
const P = process.env.BATCH_TMP + '/11-cross-mode';
mkdirSync(join(P, 'Harness', '.runtime'), { recursive: true });

simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-max first' });
let mode = readModeFile(P);
assertMode(mode, 'wf-max', 'ceo', 'W0_EXPLORE');

simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf different task' });
mode = readModeFile(P);
assertMode(mode, 'wf', 'ceo', 'W0_EXPLORE');

simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-auto optimize' });
mode = readModeFile(P);
assertMode(mode, 'wf-auto', 'ceo', 'AUTO');

simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-auto-spark search' });
mode = readModeFile(P);
assertMode(mode, 'wf-auto-spark', 'ceo', 'SPARK');

simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: '/wf-review check' });
mode = readModeFile(P);
assertMode(mode, 'wf-review', 'ceo', 'REVIEW');

process.exit(summary());
`);

// ── 12: no-role default deny ──
S('12-no-role-deny.mjs', `import { simulateHook } from '../harness/setup.mjs';
import { scenario, assertHookBlocked, assertHookAllowed, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

scenario('12-no-role-deny');
const P = process.env.BATCH_TMP + '/12-no-role';
const R = join(P, 'Harness', '.runtime');
mkdirSync(R, { recursive: true });
mkdirSync(join(P, 'Harness', 'tasks', 'test'), { recursive: true });

writeFileSync(join(R, 'current-mode.json'), JSON.stringify({
  active: true, mode: 'wf-max',
  taskId: 'no-role-test', phase: 'W0_EXPLORE',
  startedAt: new Date().toISOString(),
}));

let r = simulateHook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(P, 'CLAUDE.md') } });
assertHookBlocked(r, 'Write no role');

r = simulateHook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(P, 'src', 'index.js') } });
assertHookBlocked(r, 'Edit no role');

r = simulateHook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(P, 'Harness', 'tasks', 'test', 'PLAN.md') } });
assertHookAllowed(r, 'Write PLAN.md meta ok');

process.exit(summary());
`);

console.log('Generated 12 scenario files in', OUT);
