import { simulateHook, readModeFile } from '../harness/setup.mjs';
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
