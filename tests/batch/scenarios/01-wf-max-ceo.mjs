import { simulateHook, readModeFile, createHarnessProject } from '../harness/setup.mjs';
import { scenario, assert, assertMode, assertHookBlocked, assertHookAllowed, assertSessionStartContains, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

scenario('01-wf-max-ceo');
const P = createHarnessProject('01-wf-max-ceo');
process.env.BATCH_PROJECT = P;
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
