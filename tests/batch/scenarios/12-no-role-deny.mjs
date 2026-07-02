import { simulateHook } from '../harness/setup.mjs';
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
