---
name: wf-max
description: Use for /wf-max in Claude Code, $wf-max or /skills wf-max in Codex, or maximum-parallelism Harness work with CEO to manager to worker decomposition.
---

# WF-MAX Adapter

This skill is a thin tool adapter. The authoritative workflow lives in
`Harness/WF-MAX.md`; do not duplicate or override it here.

## Invocation

- Claude Code: use `/wf-max [task]` or select the `wf-max` skill.
- Codex CLI or IDE: use `$wf-max` or `/skills` then choose `wf-max`.
- Codex app may also list enabled skills in the `/` menu.

## Load

1. `CLAUDE.md`
2. `Harness/MEMORY.md`
3. `Harness/README.md`
4. `Harness/WF-MAX.md`
5. `Harness/subagents.md`
6. `Harness/dispatch.md`
7. `Harness/agent-workflow.md`

## Rules

- Treat yourself as CEO, not implementer.
- Do not edit production/source files directly while WF-MAX is active.
- Use the D-GATE in `Harness/WF-MAX.md` before any implementation wave:
  dispatch table, self-audit, disjoint file claims, and reviewer plan.
- Use real subagents when the runtime supports them; otherwise record a
  bounded-pass fallback in `Harness/tasks/<task-id>/PLAN.md`.
- Keep `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` current.
