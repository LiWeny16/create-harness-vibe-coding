#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const taskState = path.join(__dirname, 'task-state.mjs');
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node Harness/scripts/archive-tasks.mjs [options]

Compatibility entry for: node Harness/scripts/task-state.mjs archive [options]

Options:
  --dry-run        Show what would be archived without moving files (default)
  --apply          Execute archive moves
  --keep <n>       Keep at most <n> non-archived tasks (default: 5)
  --task <id>      Archive only the specified task
  --json           Output results as JSON
  --help, -h       Show this help`);
  process.exit(0);
}

const result = spawnSync(process.execPath, [taskState, 'archive', ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
