# Dispatch Protocol

Purpose: coordinate a small set of subagents without building a scheduler.

Use [subagents.md](subagents.md) for orchestration strategy. Use this file for the dispatch table, handoff format, and status protocol.

Use when work needs parallel reading, independent review, cross-layer analysis, or more than one bounded implementation pass.

## Principles

- Main agent owns the final decision, integration, and verification.
- project files are the only durable communication channel; chat/subagent transcript state is non-authoritative.
- Important assumptions, decisions, blockers, evidence, and handoffs must be written to `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md`, the current feature doc, `Harness/MEMORY.md`, or `Harness/memory/*` as appropriate.
- Prefer three or fewer active agents (WF mode overrides this; see [WF.md](WF.md)).
- Read-only agents may run in parallel.
- Writing agents run serially unless write sets are disjoint.
- Use a worktree when two agents may touch overlapping files or long-running branches.
- Only summaries enter main context. Load named files directly when details are needed.
- Subagents read task files, return findings and PLAN patch suggestions. Only the main agent commits changes to PROGRESS.md and PLAN.md.

## Dispatch Loop

```text
Goal
-> Fill task PROGRESS.md and PLAN.md
-> Apply subagents.md efficiency ladder
-> Run parallel read-only agents
-> Main agent integrates findings
-> Test Writer defines failing test or manual check
-> Implementer makes bounded change
-> Reviewer checks diff
-> Verifier records evidence
-> Main agent updates task files and closes or iterates
```

## Modes

| Mode | Use When | Constraint |
| --- | --- | --- |
| Parallel Read | research, exploration, architecture review, docs/API check | no writes |
| Serial Write | tests, implementation, docs sync | one writer at a time |
| Isolated Worktree | overlapping write sets or competing approaches | merge only after review |

## Common Agents

| Agent | Mode | Purpose |
| --- | --- | --- |
| `planner` | Parallel Read | split goal into tasks, dependencies, write sets |
| Explorer Pass | Parallel Read | bounded read-only exploration when no dedicated agent is needed |
| `researcher` | Parallel Read | product, market, ecosystem, dependency research |
| `docs-researcher` | Parallel Read | official docs, API, SDK, version, limits |
| `architect` | Parallel Read | layer boundaries, ports, data flow, state impact |
| `test-writer` | Serial Write | failing test or manual verification plan |
| `implementer` | Serial Write | minimal change inside declared write set |
| `debugger` | Serial Write | smallest fix for a reproduced failure |
| `reviewer` | Parallel Read | diff review, risks, missing tests |
| `verifier` | Parallel Read | run checks and record evidence |
| `memory-master` | Serial Write | write/consolidate memory entries, dedup, cross-project extraction |
| `context-master` | Parallel Read | analyze context usage, recommend compression, extract session knowledge |

## Dispatch Rules

- Every dispatch row needs task, agent, mode, read set, write set, dependency, output, and status.
- A write set of `none` means read-only.
- If two write sets overlap, do not run those agents in parallel.
- If an agent returns uncertainty, mark the row `Blocked` or add a follow-up row.
- If docs, tests, and code disagree, stop implementation and record the conflict in `Harness/tasks/<task-id>/PROGRESS.md`.

## Handoff Format

Subagents return summaries in this shape:

```text
Agent:
Task:
Mode:
Files read:
Files changed:
Findings:
Evidence:
Risks:
Next:
PLAN patch:
```

Use `Files changed: none` for read-only agents. Use `PLAN patch: none` when no state update is needed.
If a handoff matters after context loss, write it to `Harness/tasks/<task-id>/PROGRESS.md`, `Harness/tasks/<task-id>/PLAN.md`, the current feature doc, or `Harness/memory/*`; do not rely on chat transcript state.

## Statuses

Allowed dispatch statuses: Pending / In Progress / Returned / Integrated / Blocked / Verified.
