import { simulateHook, readModeFile } from '../harness/setup.mjs';
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
