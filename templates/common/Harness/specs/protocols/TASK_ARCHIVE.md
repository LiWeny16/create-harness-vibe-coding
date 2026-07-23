# TASK_ARCHIVE — Task Archive Mechanism

Purpose: keep `Harness/tasks/` lean by archiving completed/abandoned tasks while preserving all evidence.

## Archive Location

Active tasks stay in `Harness/tasks/<task-id>/`.
Archived tasks move to `Harness/tasks/_archive/YYYY/<task-id>/`.

## What Is Never Archived

- `Harness/tasks/_template/` — scaffold template, never moved.
- `Harness/tasks/auto/` — WF-AUTO permanent state capsule, never moved unless explicitly allowed by WF-AUTO docs.
- `Harness/tasks/_archive/` — the archive directory itself.
- Active, blocked, in-progress, or needs-user-decision tasks.
- Tasks whose STATE.json status is `active`, `blocked`, `in_progress`, `running`, `pending`, or `needs-user-decision`.

## What May Be Archived

Tasks whose STATE.json or PROGRESS.md status is: `complete`, `verified`, `archived`, `abandoned`, `obsolete`, `done`, `closed`, or `closeout`.

The script reads STATE.json `status`/`phase` first, then falls back to the first `- Phase:`, `Phase:`, or `Current:` marker in the task's PROGRESS.md (first word wins). Ambiguous phases are never auto-archived.

## Archive Process

1. Verify the task is not active/blocked.
2. Ensure `Harness/tasks/_archive/YYYY/` exists.
3. Move `Harness/tasks/<task-id>/` → `Harness/tasks/_archive/YYYY/<task-id>/`.
4. Update the moved STATE.json: `status` → `archived`, `phase` → `archived`.
5. Update `Harness/tasks/_archive/INDEX.md`.
6. Update `Harness/PROGRESS.md` Task Index — remove or annotate `(archived)`.

## Retention

- Archived tasks retain: PLAN, PROGRESS, STATE, ARTIFACTS, NOTES.
- Do NOT delete historical evidence.
- `Harness/PROGRESS.md` keeps the last 5 non-archived task entries in the Task Index.
- When outer task capsules exceed 5 completed/abandoned/obsolete, archive the oldest.
- The validator (`Harness/scripts/validate-harness.mjs`) warns when `Harness/tasks/` holds more than 5 outer task capsules (excluding `_archive`, `_template`, `auto`) and fails in `--strict` mode.

## Script

Use `Harness/scripts/archive-tasks.mjs`:
- Default: dry-run
- `--apply` to execute
- `--keep 5` to set the non-archived task threshold
- `--task <task-id>` to archive a specific task
- `--json` for machine-readable output
- `node Harness/scripts/archive-tasks.mjs --dry-run --json` must always run

## Safety Rules

- Windows path safe. Use `path.resolve()` before moving.
- Confirm target is within `Harness/tasks/` before any move.
- Do NOT recursively delete.
- Tasks with `needs-user-decision` status are never auto-archived.
