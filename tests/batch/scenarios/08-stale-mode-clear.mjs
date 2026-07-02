import { simulateHook, readModeFile } from '../harness/setup.mjs';
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
