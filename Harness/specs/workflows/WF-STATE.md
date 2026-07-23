# WF-STATE — Lightweight Resumable State Machine

Purpose: persist resumable workflow state across compaction, new Claude Code windows, new terminals, and project reopen. It is NOT a scheduler, daemon, lock manager, async runtime, or graph framework.

## State Files

| File | Role |
|------|------|
| `Harness/PROGRESS.md` | Global active pointer — which task is current |
| `Harness/tasks/<task-id>/STATE.json` | Machine-readable resume truth |
| `Harness/tasks/<task-id>/PROGRESS.md` | Human-readable summary |
| `Harness/tasks/<task-id>/PLAN.md` | Plan, decisions, scope context |

Task id convention: new task capsules MUST use `task-<verb>-<noun>[-detail]`
(kebab-case, 2-5 words after the prefix), for example
`task-fix-login-flow`. Do not create bare task names such as
`fix-login-flow`.

## Enums

### phase
`intake`, `clarify`, `requirements`, `prd`, `acceptance`, `plan`, `explore`, `implement`, `verify`, `review`, `fix`, `reflect`, `closeout`, `blocked`, `archived`

### item status (queues)
`pending`, `ready`, `running`, `done`, `blocked`, `skipped`, `failed`

### mode
`direct`, `wf`, `wf-max`, `wf-auto`, `wf-auto-spark`, `wf-review`, `wf-browser`

### tier
`none`, `light`, `standard`, `full`, `max-useful`, `max-strict`

## Rules

1. **STATE.json is machine-readable resume truth.** On session start, the agent reads it to know where it left off.
2. **PROGRESS.md is human-readable summary.** It mirrors key state but is secondary for machine reasoning.
3. **PLAN.md is plan/decision context.** Load only when decisions or scope need review.
4. **On every phase transition, dispatch return, blocker, verification result, review finding, or closeout, update STATE.json.** task-scribe or controller writes; production agents never write task state.
5. **Long logs/transcripts never go into STATE.json.** Store paths only.
6. **task-scribe may update STATE.json and task summaries; production agents may not.**
7. **If STATE.json conflicts with PLAN/PROGRESS, controller stops and reconciles before continuing.**

## Resume Protocol

New window / session start:
1. Read `CLAUDE.md`.
2. If user says "continue", "resume", "last task", "current task", "status", or the work is not a simple direct task:
   - Read `Harness/PROGRESS.md` → find Active Task
   - If Active Task exists, read `Harness/tasks/<active-task>/STATE.json`
   - Read `Harness/tasks/<active-task>/PROGRESS.md`
   - Read `Harness/tasks/<active-task>/PLAN.md` only if decisions/scope need review
3. From STATE.json, determine:
   - Current phase, gate, tier
   - activeQuestion (needs user answer before proceeding)
   - Queues: ready (can dispatch immediately), running (awaiting results), blocked (needs resolution), done
   - nextAction (what to do next)
4. Do NOT bulk-read `Harness/tasks/` to find context. Use the active pointer.
5. Direct simple tasks may skip STATE/PLAN/PROGRESS unless the user says "continue"/"resume".

## State Transitions

```
intake → clarify → requirements → prd → acceptance → plan
→ explore → implement → verify → review
→ (fix → verify → review loop)
→ reflect → closeout
```

Any phase may transition to `blocked` if a dependency, user decision, or external input is required.

## Dispatch Ledger

Every dispatch packet MUST have an `id`. On return, controller or task-scribe updates the ledger item:
- `id`, `agent`, `role`, `phase`, `status` (pending/ready/running/done/blocked/skipped/failed), `evidence`

See [WF-KERNEL.md](WF-KERNEL.md) for the dispatch packet format.

## Integration with /wf and /wf-max

- `/wf` uses the STATE ready queue for dynamic orchestration.
- `/wf-max` uses the SAME STATE ready queue for maximum safe fan-out.
- When a subagent returns or goes idle, controller immediately dispatches the next ready item.
- task-scribe is the exception for task-state writes.
- Production source agents do not write STATE/PLAN/PROGRESS unless explicitly dispatched as task-scribe.

## Template

See `Harness/tasks/_template/STATE.json` for the canonical template. On task creation, copy and populate from the template.
