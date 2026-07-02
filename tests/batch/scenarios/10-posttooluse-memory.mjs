import { simulateHook } from '../harness/setup.mjs';
import { scenario, assert, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { mkdirSync } from 'fs';

scenario('10-posttooluse-memory');
const P = process.env.BATCH_TMP + '/10-memory';
mkdirSync(join(P, 'Harness', '.runtime'), { recursive: true });
mkdirSync(join(P, 'Harness', 'memory'), { recursive: true });

let r = simulateHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash',
  tool_stderr: 'Error: EACCES permission denied',
  tool_stdout: '' });
assert(r.exit === 0, 'PostToolUse error exits 0');

r = simulateHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash',
  tool_stdout: 'Tests: 3 passed, 1 failed',
  tool_stderr: '' });
assert(r.exit === 0, 'PostToolUse test result exits 0');

r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: 'don\'t forget: always use const first' });
r = simulateHook({ hook_event_name: 'PostToolUse', tool_name: 'Edit',
  tool_stdout: 'file saved', tool_stderr: '' });
assert(r.exit === 0, 'PostToolUse correction exits 0');

process.exit(summary());
