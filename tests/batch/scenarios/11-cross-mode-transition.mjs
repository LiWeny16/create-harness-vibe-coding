import { simulateHook, readModeFile } from '../harness/setup.mjs';
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
