import { simulateHook, readModeFile } from '../harness/setup.mjs';
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
