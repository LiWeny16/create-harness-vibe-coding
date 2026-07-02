import { simulateHook, readModeFile } from '../harness/setup.mjs';
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
