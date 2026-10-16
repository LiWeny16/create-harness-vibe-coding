# TASK_ARCHIVE - Task Archive Mechanism

Purpose: keep completed work browsable without imposing a magic total-capsule
limit: archive verified closed tasks safely while preserving all evidence.

## Archive Surfaces

**Single writer**: `task-state.mjs` is the sole write surface for archives.
All archive operations delegate to the shared `performSafeArchive()` primitive.

- `task-state.mjs archive` — **DEPRECATED** legacy surface, mtime-based date, optional `--keep` preview target, batch `--group`.
  Still functional for compatibility but new work should use safe `auto-archive`.
- `task-state.mjs auto-archive` — safe surface. Closed-only, idempotent, atomic move.
  Refreshes both `INDEX.md` and `INDEX.json` with shared `routeRevision`.
- `task-state.mjs route --task <id> [--json]` — resolve route for a task (live or archived).
  Returns minimal route stub without leaking full context/PLAN/logs.
- `task-route.mjs` — pure derivation layer. Exposes route/focus/blocker/archive
  eligibility/resume summaries without writing anything to disk.
- `auto-archive-session-start.mjs` — SessionStart/Stop hook helper with safe-auto policy.
  - SessionStart: reindex + safe auto-archive by default; `HARNESS_SAFE_AUTO_ARCHIVE=0` opts out
  - `--dry-run` forces preview; explicit `--apply` overrides the environment opt-out
  - Stop: dry-run only (detection, no mutation)
  - Global owner-token lock prevents concurrent moves; a live PID keeps its lock regardless of age, and a stale lock is recoverable only after its owner is confirmed dead

### Safe-Auto Policy

Safe auto-archive (SessionStart by default) only archives tasks that meet ALL criteria:
1. Status is `closed` (not active/blocked/unknown)
2. Closeout verified (phase is `closeout` or later)
3. No active owner/lease/lock on the task
4. Not the current focus task (active pointer)
5. No unresolved active question or pending/running/blocked queue work
6. Global archive lock acquired (prevents concurrent moves)

Direct `task-state.mjs auto-archive` remains dry-run by default and requires
`--apply`; validation never performs archival.

## Archive Location

Active tasks stay in `Harness/tasks/<task-id>/`.
Archived tasks move to `Harness/tasks/_archive/YYYY/MM/DD/<task-id>/`.

## What Is Never Archived

- `Harness/tasks/_template/` - scaffold template, never moved.
- `Harness/tasks/continuous/` - WF-AUTO/WF-AUTO-SPARK permanent state capsule, never moved unless
  explicitly allowed by WF-AUTO docs.
- `Harness/tasks/_archive/` - the archive directory itself.
- Active or blocked tasks.
- Legacy `in_progress`, `running`, `pending`, and `needs-user-decision` values
  are treated as open during migration.

## What May Be Archived

Tasks whose STATE.json or reconciled phase is `closed` may be archived.
Legacy completed values such as `complete`, `verified`, `done`, and `closeout`
remain readable and archiveable.

`Harness/scripts/task-state.mjs` reads STATE.json `status`/`phase` first, then
uses root/task PROGRESS phases only as reconciliation evidence. Missing or
invalid STATE.json is skipped until
`node Harness/scripts/task-state.mjs reconcile --apply` creates or repairs
machine state.

## Two-Phase Archive

Tasks transition through two archive states:

```
closed → archiveEligible → archived
```

- `closed`: task is completed/verified/abandoned
- `archiveEligible`: task passes safe-auto policy checks (timestamped `archiveEligibleAt`)
- `archived`: task has been moved to `_archive/YYYY/MM/DD/<task-id>/`

This prevents auto-archiving tasks that are merely `closed` but not yet
verified for closeout.

## Archive Process

1. Verify the task is not active or blocked (including legacy open aliases).
2. Verify safe-auto policy (closed + closeout verified + no owner/lock + not focus).
3. Ensure `Harness/tasks/_archive/YYYY/MM/DD/` exists.
4. Move `Harness/tasks/<task-id>/` to
   `Harness/tasks/_archive/YYYY/MM/DD/<task-id>/` via `performSafeArchive()`.
5. Update the moved STATE.json: `status` to `archived`, `phase` to `archived`,
   set `archiveEligibleAt` timestamp.
6. Update `Harness/tasks/_archive/INDEX.md` and `INDEX.json` with shared `routeRevision`.
7. Rewrite `Harness/PROGRESS.md` Task Index from the remaining non-archived
   task capsules.

## Route Index Consistency

Both `Harness/tasks/INDEX.json` and `Harness/tasks/_archive/INDEX.json` include
a shared `routeRevision` hash. This allows detecting stale indexes and
triggering automatic reindex on SessionStart if the revision mismatch is detected.
Reindex refreshes both files. The revision covers live and archived STATE data,
the active-task pointer, and root Task Index rows so both indexes stay aligned
when any route-relevant input changes.

## Retention

- Archived tasks retain: PLAN, PROGRESS, STATE, ARTIFACTS, NOTES.
- Do NOT delete historical evidence.
- `Harness/PROGRESS.md` and the live task indexes list every non-archived task;
  archived tasks are listed under `Harness/tasks/_archive/`.
- There is no hard total-capsule limit. Validation checks task state and route
  integrity, never count alone, and never moves files.
- The SessionStart hook runs safe auto-archive by default after lifecycle and
  eligibility checks. Only closed, closeout-verified tasks without active focus,
  unresolved questions, pending queues, or owner/lease/lock state are moved.
  Ineligible tasks remain live regardless of count.
- Set `HARNESS_SAFE_AUTO_ARCHIVE=0` to opt out of SessionStart apply mode;
  `--dry-run` forces preview. Stop is always dry-run.

## Scripts

### DEPRECATED: `task-state.mjs archive`

User-facing command:

- Codex: `$wf-task-archive` or `/skills wf-task-archive`.
- Claude Code/OpenCode: `/wf-task-archive`.

Underlying implementation: `Harness/scripts/task-state.mjs archive`.

- **DEPRECATED**: prefer `auto-archive` for new work.
- Default: dry-run; without an explicit `--keep`, preview all eligible tasks.
- `--apply` to execute.
- Explicit `--apply` with no `--task` filter: archives **ALL** eligible tasks, bypassing `--keep`.
- `--keep <n>` optionally limits the preview to a chosen non-archived target; it is a manual legacy option, not a global policy.
- `--task <task-id>` to archive a specific task.
- `--group <tag>` to archive by tag (batch op).
- `--json` for machine-readable output.

### Safe: `task-state.mjs auto-archive`

Use this surface when you want:

- **Closed-only** archive (active/blocked/unknown/reserved are rejected).
- **Idempotent** behavior: already-archived tasks return `already-archived`.
- **Atomic move**: `fs.renameSync` on POSIX/Windows (single-volume).
- **Failure recovery**: the original capsule is untouched if the move fails.
- **Route index refresh**: both `INDEX.md` and `INDEX.json` are updated with `routeRevision`.

```
node Harness/scripts/task-state.mjs auto-archive [--dry-run] [--task <id>] [--json]
```

- Direct CLI default: dry-run. Use `--apply` to execute explicitly.
- SessionStart hook default: apply after safe eligibility checks; `HARNESS_SAFE_AUTO_ARCHIVE=0` opts out, `--dry-run` forces preview, and Stop remains dry-run.
- `--task <id>` for a single task (also returns `already-archived` if found under `_archive/`).
- `--json` for machine-readable output.
- After archiving, `Harness/tasks/_archive/INDEX.md` and `INDEX.json` are regenerated.

### Route: `task-state.mjs route`

Resolve a task's route by id (live or archived).

```
node Harness/scripts/task-state.mjs route --task <id> [--json]
```

Returns minimal route stub:
- id, title, status, phase, summary
- blockers, dependsOn, blocks
- path, archivePath, archived
- nextAction, activeQuestion, queues

Does NOT leak full context, PLAN, decisions, or raw logs.

### History: `task-state.mjs history load`

Load an archived task's record.

```
node Harness/scripts/task-state.mjs history load <task-id> [--summary] [--json]
```

- Default: full record including PLAN, PROGRESS, PROBLEM, REFERENCES.
- `--summary`: compact route stub without PLAN/decisions/logs (<= 8KB guaranteed).

### Compatibility: `archive-tasks.mjs`

**DEPRECATED** compatibility entry. Delegates to `task-state.mjs auto-archive`
by default; falls back to legacy `archive` if `--keep` or `--group` is present.

## Safety Rules

- Windows path safe. Use `path.resolve()` before moving.
- Confirm target is within `Harness/tasks/` before any move.
- Do NOT recursively delete.
- Tasks with `blocked` status (including legacy `needs-user-decision` and
  `failed`) are never auto-archived.
- Missing or invalid STATE.json is never archived without reconciliation.
- `auto-archive` only archives `closed` tasks; `active`, `blocked`, `unknown`,
  and `reserved` ids are rejected.
- `auto-archive` is idempotent: calling it twice returns `already-archived`
  without error.
- `auto-archive` uses `fs.renameSync` for atomic moves; a failed move leaves
  the original capsule untouched.
