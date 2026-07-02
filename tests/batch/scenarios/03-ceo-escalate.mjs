import { simulateHook, readModeFile } from '../harness/setup.mjs';
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
