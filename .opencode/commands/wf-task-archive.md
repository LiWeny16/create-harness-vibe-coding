---
description: Archive completed/obsolete task capsules to _archive
---
# /wf-task-archive

Archive completed/obsolete task capsules to `Harness/tasks/_archive/`. Do not invoke a skill or start WF mode.

## Classification

DIRECT command. Wraps `node Harness/scripts/task-state.mjs archive`. Never loads Harness/MEMORY.md.

## Usage

/wf-task-archive [--dry-run] [--apply] [--task <id>] [--keep <n>]

- Defaults to dry-run (`--dry-run`) without `--apply`.
- With `--apply`: moves eligible task directories into yearly subdirectories under `_archive/`.
- With `--task <id>`: targets a specific task for archive eligibility check.
- With `--keep <n>`: keeps N most recent non-archived task capsules (default 5).
- Tasks with active, blocked, in_progress, running, pending, or needs-user-decision status are never auto-archived.

## Execution

Run: `node Harness/scripts/task-state.mjs archive [--dry-run] [--apply] [--task <id>] [--keep <n>] [--json]`

## Return

- JSON output with archive plan: scanned, archiveable, toArchive, kept, skipped counts and per-task results.
- If the command fails, report the error and do not retry.
