# WF-STATE - Lightweight Resumable State Machine

Purpose: persist resumable workflow state across compaction, new Claude Code
windows, new terminals, and project reopen. It is NOT a scheduler, daemon, lock
manager, async runtime, or graph framework.

## State Files

| File | Role |
|------|------|
| `Harness/PROGRESS.md` | Derived global active pointer and Task Index |
| `Harness/tasks/<task-id>/STATE.json` | Canonical machine-readable resume truth |
| `Harness/tasks/INDEX.json` | Generated machine route for project/group/status/date queries |
| `Harness/tasks/INDEX.md` | Generated human route for the same task collection |
| `Harness/tasks/<task-id>/PROGRESS.md` | Human-readable summary |
| `Harness/tasks/<task-id>/PLAN.md` | Plan, decisions, scope context |

## Task Context Packs

`STATE.json.context` is optional for legacy capsules. When present it contains
only `intent` (with immutable `original`, `current`, and append-only `changes`),
`constraints`, `facts`, `assumptions`, `decisions`, `evidence`, `attempts`, and
`handoff`. The root `STATE.json.nextAction` is the only next-action field.
Use `node Harness/scripts/task-context.mjs update|show|pack <task-id>` for
bounded context updates and role/work-item packs. Packs include evidence paths
or URLs and claims, never the body of a raw log; UTF-8 byte budgets fail
explicitly when mandatory intent, constraints, unresolved items, or nextAction
cannot fit. Legacy context is reconstructed from PLAN/STATE for read-only use.

Task id convention: new task capsules MUST use
`task-<verb>-<noun>[-detail]` (kebab-case, 2-5 words after the prefix), for
example `task-fix-login-flow`. Do not create bare task names such as
`fix-login-flow`.

## Enums

### status

`active`, `blocked`, `closed`

Legacy repositories may still contain `in_progress`, `running`, `pending`,
`needs-user-decision`, `complete`, `verified`, `archived`, `abandoned`,
`obsolete`, `done`, `closeout`, `skipped`, or `failed`. `task-state.mjs` reads
those values and normalizes them to the three lifecycle statuses on new writes.

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

Only `wf` and `wf-max` own the durable task lifecycle. The auto/spark modes
use their separate continuous capsule; review/browser are capability modes.
They remain valid explicit mode values for compatibility, but do not promote a
normal task into cross-session WF management.

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
8. **Durable WF ownership is creation-time opt-in.** A task in `wf` or
   `wf-max` remains WF-managed for its whole lifetime; its mode cannot be
   downgraded or exited. `closed` is terminal for that capsule. Start the
   next unit of work in a new capsule with an explicit mode.

## CLI Contract

Use `Harness/scripts/task-state.mjs` as the deterministic state writer:

- `node Harness/scripts/task-state.mjs list --json`
- `node Harness/scripts/task-state.mjs index`
- `node Harness/scripts/task-state.mjs query <keyword> --project <project> --json`
- `node Harness/scripts/task-state.mjs validate --json`
- `node Harness/scripts/task-state.mjs reconcile --dry-run --json`
- `node Harness/scripts/task-state.mjs reconcile --apply`
- `node Harness/scripts/task-state.mjs set-active <task-id>`
- `node Harness/scripts/task-state.mjs transition <task-id> --status <status> --phase <phase>`
- `node Harness/scripts/task-state.mjs archive --keep 5 --dry-run --json`
- `node Harness/scripts/task-state.mjs archive --keep 5 --apply`
- `node Harness/scripts/task-state.mjs auto-archive --dry-run --json`
- `node Harness/scripts/task-state.mjs auto-archive --apply`
- `node Harness/scripts/auto-archive-session-start.mjs` (SessionStart/Stop hook helper,
  dry-run by default; never mutates unless the user invokes `task-state auto-archive --apply`)

## Derived Route Layer

`Harness/scripts/lib/task-route.mjs` is a pure derivation layer that reads live and
archived capsules and computes routes, focus, blockers, archive eligibility, and
resume summaries without writing anything to disk. It is read-only: the sole write
surface for archives is `task-state.mjs auto-archive`.

**Key functions:** `resolveRoute`, `resolveFocus`, `aggregateBlockers`,
`archiveEligibility`, `buildRouteStub`, `buildResumeSummary`,
`buildArchiveIndexEntries`.

The `task-context.mjs pack` command uses `aggregateBlockers` via a static import
to inject a mandatory `Task Header` into every context pack.

## SessionStart Hook Semantics

The SessionStart/Stop hook (`auto-archive-session-start.mjs`) runs
`task-state auto-archive` in **dry-run mode only**. It reports which closed tasks
are eligible for archive but does NOT move them. Archive is a user-initiated
action via `task-state auto-archive --apply`. The hook exists to surface
"eligible for archive" reminders without mutating state.

Do not rely on prompt instructions alone to keep task `STATE.json`, task
`PROGRESS.md`, the generated task route, and root `Harness/PROGRESS.md`
synchronized.

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

"Open tasks" are task capsules with lifecycle status `active` or `blocked`.
Legacy open values are accepted while an old repository is being migrated.

The active pointer (`Harness/PROGRESS.md`) is a focus/resume pointer, not a
lock. Multiple open tasks are valid and remain visible in `INDEX.json`,
`INDEX.md`, and `list --by-group`; `set-active` only changes which open WF task
is loaded first on resume while a managed WF task is open. It cannot replace
that focus with a direct task. A direct task may coexist, but it never acquires
WF lifecycle ownership.

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
     still open (their STATE.json status is `active` or `blocked`, after legacy
     normalization). Report blocked dependencies to the user.
   - **workItems[]**: if non-empty, inspect items with status `running` or
     `ready` for parallel dispatch candidates.
4. Do NOT bulk-read `Harness/tasks/` to find context. Use the active pointer
   and `Harness/tasks/INDEX.json` for deterministic project/group lookup.
5. If the active pointer targets an open `wf`/`wf-max` task, automatically
   resume WF mode from that capsule even when the user does not repeat `/wf`.
   If it targets a direct or capability-mode task, do not enter WF.
6. Direct simple tasks may skip STATE/PLAN/PROGRESS unless the user says
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

Task lifecycle is deliberately smaller than phase state:

```text
direct ------------------------------> closed
wf / wf-max (immutable ownership) ---> closed
active <-----------------------------> blocked
```

An open managed task may move between `active` and `blocked`, then only to
`closed`. It cannot return from `closed`, change to `direct`, or be reused as a
new task. Multiple capsules may be open at once; the active pointer selects
one managed focus without collapsing the collection.

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
