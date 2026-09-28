#!/usr/bin/env node
/**
 * archive-tasks.mjs — DEPRECATED compatibility entry.
 *
 * This script delegates to `task-state.mjs auto-archive` for safe archive
 * semantics. The legacy `archive` command with --keep/--group is still
 * available via `task-state.mjs archive` directly, but this entry point
 * now prefers the safe auto-archive path.
 *
 * Usage:
 *   node Harness/scripts/archive-tasks.mjs [options]
 *
 * Options are forwarded to `task-state.mjs auto-archive`.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const taskState = path.join(__dirname, 'task-state.mjs');
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`DEPRECATED: archive-tasks.mjs

This is a compatibility entry for: node Harness/scripts/task-state.mjs auto-archive [options]

Legacy archive with --keep/--group is available via:
  node Harness/scripts/task-state.mjs archive [options]

Options (forwarded to auto-archive):
  --dry-run        Show what would be archived without moving files (default)
  --apply          Execute archive moves
  --task <id>      Archive only the specified task
  --json           Output results as JSON
  --help, -h       Show this help`);
  process.exit(0);
}

// Map legacy flags: if --keep or --group is present, use legacy archive; otherwise use auto-archive
const useLegacy = args.includes('--keep') || args.includes('--group');
const command = useLegacy ? 'archive' : 'auto-archive';

const result = spawnSync(process.execPath, [taskState, command, ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
