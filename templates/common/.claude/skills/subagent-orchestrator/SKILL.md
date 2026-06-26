---
name: subagent-orchestrator
description: Use when work needs bounded subagent coordination, parallel read-only exploration, independent review gates, broad context partitioning, or controlled handoffs for coordination-heavy tasks.
---

# Subagent Orchestrator

Load:

- `Harness/subagents.md`
- `Harness/dispatch.md`
- `Harness/context-loading.md`
- `Harness/PROGRESS.md`
- `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md` when active
- `Harness/agent-workflow.md`
- `Harness/WF.md` when in `/wf`, `wf mode`, `workflow mode`, `wk mode`, or recovery loop
- `.claude/agents/` roster names before choosing roles

Follow:

- The main agent is the controller. It decomposes work, writes `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md`, integrates returns, and owns final verification.
- Subagents are readers and reporters. Only the controller writes to task state files.
- **CEO Exploration Rule**: The controller MUST NOT read source files during exploration. Delegate ALL codebase reading to subagents. Default model is `sonnet` — exploration requires real code understanding. Use `haiku` only for shallow scans (directory listing, file counts). Use `opus` if the user requests. The CEO's instinct to "just check one file" is the #1 cause of failed parallelism. CEO reads only `Harness/` docs, `CLAUDE.md`, and subagent returns until the plan is written.
- Use the efficiency ladder in `Harness/subagents.md`: solo pass -> single reviewer -> parallel read-only -> serial build lane -> isolated lanes.
- Explicit WF/WK mode requires at least 3 distinct agents from `.claude/agents/` before second planning.
- Prefer the built-in roles `planner`, `researcher`, `docs-researcher`, `architect`, `test-writer`, `implementer`, `reviewer`, `debugger`, and `verifier` before inventing custom roles.
- Every subagent dispatch needs a complete dispatch pack: role, goal, mode, read set, write set, forbidden scope, injected docs, dependencies, expected evidence, stop condition, and return format.
- Prefer parallel read-only exploration first. Run writing agents serially unless write sets are disjoint and isolated.
- Use two review gates after implementation: spec review first, then code-quality or architecture review.
- If verification fails, dispatch debugger/fixer with the smallest reproduced failure, then re-review and re-verify.
- If subagents are unavailable, emulate the same roles as separate bounded passes and record that fallback.
- When used outside WF mode, update `Harness/tasks/<task-id>/PLAN.md#Subagent Dispatch`; update `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` only if an active heartbeat/recovery loop exists.

Return:

- agents or bounded passes used
- dispatch table status
- accepted/rejected findings
- conflicts and decisions
- commands and evidence
- remaining risks
- updated heartbeat or next recovery action
