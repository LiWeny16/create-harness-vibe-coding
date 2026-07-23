---
name: wf
description: Use for /wf in Claude Code, $wf or /skills wf in Codex. WF is explicit only — the user must type /wf, $wf, or /skills wf to enter.
---

# WF Mode Adapter

This skill is a thin tool adapter. The authoritative workflow lives in
`Harness/WF.md`; do not duplicate or override it here.

## Invocation

- Claude Code: use `/wf <task>` or select the `wf` skill.
- Codex CLI or IDE: use `$wf` or `/skills` then choose `wf`.
- Codex app may also list enabled skills in the `/` menu, depending on the
  current surface and feature state.

## Memory Preflight

1. Direct simple tasks and `/wf-help` are exempt.
2. For non-direct work, load `CLAUDE.md`, `Harness/MEMORY.md` index only, then `Harness/README.md` before planning, dispatch, edits/deletes, validation, or peer review.
3. Load `Harness/memory/*` only when `MEMORY_PROTOCOL.md` scenario hints match; otherwise record "memory hints: none".

## Load

1. `CLAUDE.md`
2. `Harness/MEMORY.md` (index only per Memory Preflight)
3. `Harness/README.md`
4. `Harness/PROGRESS.md`
5. `Harness/WF.md`
6. `Harness/subagents.md` before any role split

## Cache Discipline

Follow `Harness/context-loading.md#Cache-First Context Contract`: keep the
listed loads in order, load only routed skills/tools, append task state and
latest tool output after stable docs, and return compact evidence instead of
logs or transcripts.

## Rules

- Create or update a task capsule under `Harness/tasks/<task-id>/`.
- Select the right WF tier: WF-Light (low-risk, planner/test/verifier), WF-Standard (multi-file, compact ACs, one review lens), WF-Full (high-risk/cross-layer, full role chain).
- Run the WF loop from `Harness/WF.md`: intake, bounded exploration, second
  plan, implementation, review, verification, recovery, and closeout.
- **Tier-aware acceptance**:
  - **WF-Light**: planner + test-writer + implementer + verifier suffice. Verification passes = closeout. Cross-review and reflector are NOT mandatory unless risk triggers them.
  - **WF-Standard**: one independent review lens required. Reflector may be triggered by risk.
  - **WF-Full**: cross-review + reflector PASS required before final acceptance.
- WF-Full requires the complete role chain at intake:
  plan, research/docs research as needed, architecture, test, implement,
  independent validation, cross-review, reflector, and final acceptance.
- Keep `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` current before long
  commands, after failures, and at closeout.
