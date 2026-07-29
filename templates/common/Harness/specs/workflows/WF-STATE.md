# WF-STATE - Lightweight Resumable State Machine

Purpose: persist resumable workflow state across compaction, new Claude Code
windows, new terminals, and project reopen. It is NOT a scheduler, daemon, lock
manager, async runtime, or graph framework.

## State Files

| File | Role |
|------|------|
| `Harness/PROGRESS.md` | Derived global active pointer and Task Index |
| `Harness/tasks/<task-id>/STATE.json` | Canonical machine-readable resume truth |
| `Harness/tasks/<task-id>/PROGRESS.md` | Human-readable summary |
| `Harness/tasks/<task-id>/PLAN.md` | Plan, decisions, scope context |

Task id convention: new task capsules MUST use
`task-<verb>-<noun>[-detail]` (kebab-case, 2-5 words after the prefix), for
example `task-fix-login-flow`. Do not create bare task names such as
`fix-login-flow`.

## Enums

### status

`active`, `blocked`, `in_progress`, `running`, `pending`,
`needs-user-decision`, `complete`, `verified`, `archived`, `abandoned`,
`obsolete`, `done`, `closed`, `closeout`, `skipped`, `failed`

### phase

`intake`, `clarify`, `requirements`, `prd`, `acceptance`, `plan`, `explore`,
`implement`, `verify`, `review`, `fix`, `reflect`, `closeout`, `blocked`,
`verified`, `archived`

Legacy aliases such as `Implementation`, `Validation`, and
`Verified/Complete` are normalized by `task-state.mjs`.

### item status (queues)

`pending`, `ready`, `running`, `done`, `blocked`, `skipped`, `failed`

### mode

`direct`, `wf`, `wf-max`, `wf-auto`, `wf-auto-spark`, `wf-review`,
`wf-browser`

### tier

`none`, `light`, `standard`, `full`, `max-useful`, `max-strict`

## Rules

1. **STATE.json is machine-readable resume truth.** On session start, the agent
   reads it to know where it left off.
2. **PROGRESS.md is human-readable summary.** It mirrors key state but is
   secondary for machine reasoning and may be rewritten from state.
3. **PLAN.md is plan/decision context.** Load only when decisions or scope need
   review.
4. **On every phase transition, dispatch return, blocker, verification result,
   review finding, or closeout, update STATE.json through
   `Harness/scripts/task-state.mjs` when the command covers the change.**
   task-scribe or controller writes; production agents never write task state.
5. **Long logs/transcripts never go into STATE.json.** Store paths only.
6. **task-scribe may update STATE.json and task summaries; production agents may
   not.**
7. **If STATE.json conflicts with PLAN/PROGRESS, controller stops and reconciles
   before continuing.**

## CLI Contract

Use `Harness/scripts/task-state.mjs` as the deterministic state writer:

- `node Harness/scripts/task-state.mjs list --json`
- `node Harness/scripts/task-state.mjs validate --json`
- `node Harness/scripts/task-state.mjs reconcile --dry-run --json`
- `node Harness/scripts/task-state.mjs reconcile --apply`
- `node Harness/scripts/task-state.mjs set-active <task-id>`
- `node Harness/scripts/task-state.mjs transition <task-id> --status <status> --phase <phase>`
- `node Harness/scripts/task-state.mjs archive --keep 5 --dry-run --json`
- `node Harness/scripts/task-state.mjs archive --keep 5 --apply`

Do not rely on prompt instructions alone to keep active task, task `STATE.json`,
task `PROGRESS.md`, and root `Harness/PROGRESS.md` synchronized.

## Links (Cross-Task Dependencies)

STATE.json `links` enables cross-task dependency resolution without reading
every task capsule:

| Field | Type | Description |
|-------|------|-------------|
| `links.dependsOn` | `string[]` | Task IDs this task depends on (blockers) |
| `links.blocks` | `string[]` | Task IDs this task blocks |
| `links.related` | `string[]` | Related task IDs (no dependency direction) |

When resolving `links.dependsOn`, the controller reads only the listed tasks'
STATE.json, not all task capsules. A task with unresolved dependsOn entries
should stay in the blocked queue until its dependencies resolve.

## Work Items (Parallel Dispatch)

STATE.json `workItems[]` enables fine-grained parallel dispatch tracking with
per-item dependencies:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique item identifier |
| `status` | `string` | `pending`, `ready`, `running`, `done`, `blocked`, `skipped`, `failed` |
| `phase` | `string` | Phase this item belongs to |
| `dependsOn` | `string[]` | Item IDs this item depends on |
| `parallelGroup` | `string` | Group name for concurrent dispatch (optional) |
| `readSet` | `string[]` | Files/patterns the item may read |
| `writeSet` | `string[]` | Files/patterns the item may write |
| `agent` | `string` | Agent role assigned (optional) |
| `evidence` | `string` | Evidence path or summary (optional) |
| `next` | `string` | Next action after this item completes (optional) |

`workItems` is an additive array — it supplements the dispatchLedger and queues
for finer-grained tracking. The dispatchLedger remains the canonical record of
subagent dispatches.

## Open Tasks

"Open tasks" are non-archived task capsules with status one of:
`active`, `in_progress`, `running`, `pending`, `blocked`,
`needs-user-decision`.

The active pointer (`Harness/PROGRESS.md`) marks the single task the agent
should resume. Other open tasks remain visible in the Task Index but are not
automatically loaded.

## Queue Entry Normalization

Queues (`ready`, `running`, `blocked`, `done`) accept both plain string entries
and object entries. The normalization rules are backward-compatible:

- A plain string entry is treated as a task or dispatch item ID.
- An object entry may contain the same fields as a work item (`id`, `status`,
  `dependsOn`, etc.) for richer inline tracking.
- `task-state.mjs` preserves both forms during reconcile — it does not coerce
  objects to strings or vice versa.

This enables incremental adoption: existing STATE.json files with string-only
queues continue to work without changes.

## Resume Protocol

New window / session start:

1. Read `CLAUDE.md`.
2. If user says "continue", "resume", "last task", "current task", "status",
   or the work is not a simple direct task:
   - Read `Harness/PROGRESS.md` and find Active Task.
   - If Active Task exists, read `Harness/tasks/<active-task>/STATE.json`.
   - Read `Harness/tasks/<active-task>/PROGRESS.md`.
   - Read `Harness/tasks/<active-task>/PLAN.md` only if decisions/scope need review.
3. From STATE.json, determine:
   - Current phase, gate, tier.
   - activeQuestion (needs user answer before proceeding).
   - Queues: ready (can dispatch immediately), running (awaiting results),
     blocked (needs resolution), done.
   - nextAction (what to do next).
   - **links.dependsOn**: if non-empty, check whether any dependency tasks are
     still open (their STATE.json has a non-archived status). Report blocked
     dependencies to the user.
   - **workItems[]**: if non-empty, inspect items with status `running` or
     `ready` for parallel dispatch candidates.
4. Do NOT bulk-read `Harness/tasks/` to find context. Use the active pointer.
5. Direct simple tasks may skip STATE/PLAN/PROGRESS unless the user says
   "continue"/"resume".

## State Transitions

```text
intake -> clarify -> requirements -> prd -> acceptance -> plan
-> explore -> implement -> verify -> review
-> (fix -> verify -> review loop)
-> reflect -> closeout
```

Any phase may transition to `blocked` if a dependency, user decision, or external
input is required.

## Dispatch Ledger

Every dispatch packet MUST have an `id`. On return, controller or task-scribe
updates the ledger item:

- `id`, `agent`, `role`, `phase`, `status` (`pending`, `ready`, `running`,
  `done`, `blocked`, `skipped`, `failed`), `evidence`

See [WF-KERNEL.md](WF-KERNEL.md) for the dispatch packet format.

## Integration with /wf and /wf-max

- `/wf` uses the STATE ready queue for dynamic orchestration.
- `/wf-max` uses the SAME STATE ready queue for maximum safe fan-out.
- When a subagent returns or goes idle, controller immediately dispatches the
  next ready item.
- task-scribe is the exception for task-state writes.
- Production source agents do not write STATE/PLAN/PROGRESS unless explicitly
  dispatched as task-scribe.

## Template

See `Harness/tasks/_template/STATE.json` for the canonical template. On task
creation, copy and populate from the template.
