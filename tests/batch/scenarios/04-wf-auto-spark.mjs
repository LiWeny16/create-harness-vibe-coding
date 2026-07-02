import { simulateHook, readModeFile } from '../harness/setup.mjs';
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
