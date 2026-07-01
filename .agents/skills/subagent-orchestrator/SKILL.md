---
name: subagent-orchestrator
description: Use when work needs bounded subagent coordination, parallel read-only exploration, independent review gates, broad context partitioning, or controlled handoffs.
---

# Subagent Orchestrator

This skill is runtime-neutral. Claude Code and Codex expose different
subagent surfaces; follow the same Harness role contract either way.

## Load

- `Harness/subagents.md`
- `Harness/dispatch.md`
- `Harness/context-loading.md`
- `Harness/agent-workflow.md`
- `Harness/PROGRESS.md`
- Active `Harness/tasks/<task-id>/PROGRESS.md` and `PLAN.md`, when present
- `Harness/WF.md` when in `/wf`, `wf mode`, `workflow mode`, or `wk mode`

## Runtime Mapping

- Claude Code: use the `.claude/agents/` role roster and the available
  subagent/task tool.
- Codex: use the available subagent tool or role mechanism in the current
  surface. If unavailable, emulate the same roles as separate bounded passes.
- In every runtime, record fallback and role coverage in the task plan.

## Rules

- The main agent is the controller. It decomposes work, writes task state,
  integrates returns, and owns final verification.
- Subagents or bounded passes are readers and reporters unless a write set is
  explicitly assigned and disjoint.
- Explicit WF/WK mode requires at least three distinct role passes before the
  second plan.
- Every dispatch needs role, goal, mode, read set, write set, forbidden scope,
  injected docs, dependencies, evidence, stop condition, and return format.
- Prefer parallel read-only exploration first. Serialize writers unless write
  sets are disjoint and isolated.
- After implementation, run a spec review gate and a code/architecture review
  gate before final verification.

## Return

Report roles or bounded passes used, dispatch table status, accepted/rejected
findings, conflicts, decisions, commands, evidence, and remaining risks.
