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

WF-MAX is a three-layer architecture:
1. Global mode (`wf-max`)
2. Agent role (`ceo` | `manager` | `worker` | `reviewer`)
3. Dispatch permission (`writeSet`, `forbidden`, `verification`)

- Top-level orchestrator is CEO (reads, plans, dispatches). Delegated Workers follow dispatch packet with explicit writeSet. Global mode ≠ every agent is CEO.
- CEO: never edit source files directly. Spawn Workers with writeSet.
- Worker: edit only files in dispatch writeSet. Outside writeSet → blocked.
- Manager: scope, review, coordinate. No source edits by default.
- Reviewer: read and report only. No edits.
- Use the D-GATE in `Harness/WF-MAX.md` before any implementation wave:
  dispatch table, self-audit, disjoint file claims, and reviewer plan.
- Use real subagents when the runtime supports them; otherwise record a
  bounded-pass fallback in `Harness/tasks/<task-id>/PLAN.md`.
- Keep `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` current.
