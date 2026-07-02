import { simulateHook } from '../harness/setup.mjs';
import { scenario, assert, summary } from '../harness/verify.mjs';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';

scenario('09-goal-persistence');
const P = process.env.BATCH_TMP + '/09-goal';
const R = join(P, 'Harness', '.runtime');
mkdirSync(R, { recursive: true });

let r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: 'goal set fix the memory leak' });
assert(r.exit === 0, 'goal set accepted');

const gf = join(R, 'goals.json');
assert(existsSync(gf), 'goals.json created');
let g = JSON.parse(readFileSync(gf, 'utf8'));
assert(g.goals.length === 1, '1 goal');
assert(g.goals[0].status === 'active', 'active');
const id = g.goals[0].id;

r = simulateHook({ hook_event_name: 'UserPromptSubmit', prompt: 'goal complete ' + id });
g = JSON.parse(readFileSync(gf, 'utf8'));
assert(g.goals[0].status === 'completed', 'completed');

process.exit(summary());
