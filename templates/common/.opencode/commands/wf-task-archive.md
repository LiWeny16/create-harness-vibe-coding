# /wf-task-archive

Archive completed/obsolete task capsules to `Harness/tasks/_archive/`. Do not invoke a skill or start WF mode.

## Classification

DIRECT command. Wraps `node Harness/scripts/task-state.mjs archive`. Never loads Harness/MEMORY.md.

## Usage

/wf-task-archive [--dry-run] [--apply] [--task <id>] [--group <project>] [--keep <n>]

- Defaults to dry-run (`--dry-run`) without `--apply`.
- With `--apply`: moves eligible task directories into dated paths under `_archive/YYYY/MM/DD/`.
- With `--task <id>`: targets a specific task for archive eligibility check.
- With `--keep <n>`: previews only the N most recent non-archived capsules. Without it, every eligible capsule is previewed; there is no implicit cap.
- Prefer the safe surface (`node Harness/scripts/task-state.mjs auto-archive`, or the SessionStart hook, which applies it automatically) for routine archival: it archives only closed, closeout-verified capsules and never moves active, blocked, focus, unverified, questioned, queued, or owner/lease/locked work.
- Only closed tasks are archive candidates. Legacy completed status values remain
  readable and are treated as closed during eligibility checks.

## Execution

Run: `node Harness/scripts/task-state.mjs archive [--dry-run] [--apply] [--task <id>] [--group <project>] [--keep <n>] [--json]`

## Return

- JSON output with archive plan: scanned, archiveable, toArchive, kept, skipped counts and per-task results.
- If the command fails, report the error and do not retry.
