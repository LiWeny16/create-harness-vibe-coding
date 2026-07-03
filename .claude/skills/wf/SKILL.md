---
name: wf
description: Use for /wf in Claude Code, $wf or /skills wf in Codex, or any long, uncertain, multi-file, migration, recovery, or architecture-heavy task that should follow Harness WF mode.
---

# WF Mode Adapter

This skill is a thin tool adapter. The authoritative workflow lives in
`Harness/WF.md`; do not duplicate or override it here.

## Invocation

- Claude Code: use `/wf <task>` or select the `wf` skill.
- Codex CLI or IDE: use `$wf` or `/skills` then choose `wf`.
- Codex app may also list enabled skills in the `/` menu, depending on the
  current surface and feature state.

## Load

1. `CLAUDE.md`
2. `Harness/MEMORY.md`
3. `Harness/README.md`
4. `Harness/PROGRESS.md`
5. `Harness/WF.md`
6. `Harness/subagents.md` before any role split

## Rules

- Create or update a task capsule under `Harness/tasks/<task-id>/`.
- Run the WF loop from `Harness/WF.md`: intake, bounded exploration, second
  plan, implementation, review, verification, recovery, and closeout.
- For explicit WF invocation, schedule the complete role chain at intake:
  plan, research/docs research as needed, architecture, test, implement,
  independent validation, cross-review, reflector, and final acceptance. Use
  real subagents when the runtime supports them; otherwise record bounded-pass
  fallback coverage in the task plan.
- Do not mark accepted until cross-review passes and the reflector returns
  PASS.
- Keep `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` current before long
  commands, after failures, and at closeout.
