# Dispatch Protocol

Purpose: coordinate a small set of subagents without building a scheduler.

Use [subagents.md](subagents.md) for orchestration strategy. Use this file for the dispatch table, handoff format, and status protocol.

Use when work needs parallel reading, independent review, cross-layer analysis, or more than one bounded implementation pass.

## Principles

- Main agent owns the final decision, integration, and verification.
- project files are the only durable communication channel; chat/subagent transcript state is non-authoritative.
- Important assumptions, decisions, blockers, evidence, and handoffs must be written to `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md`, the current feature doc, `Harness/MEMORY.md`, or `Harness/memory/*` as appropriate.
- PRD-derived Acceptance Criteria are the source of truth. Dispatch packets must carry the relevant AC IDs and contracts.
- Agent count: default (non-WF) <=3 active agents; `/wf` requires the complete role chain by default; `/wf max` inherits that chain and removes the Harness default cap through the span formula. Real concurrency is still bounded by runtime thread budget, config, billing, and local resources. Use current runtime subagents first, close completed agents, then cross-CLI overflow. Generated Codex config defaults to `agents.max_threads = 12` and `agents.max_depth = 1`; ask the user before raising `agents.max_threads` above that default. See [WF.md](WF.md) and [WF-MAX.md](WF-MAX.md).
- Read-only agents may run in parallel.
- Writing agents run serially unless write sets are disjoint.
- Use a worktree when two agents may touch overlapping files or long-running branches.
- Only summaries enter main context. Load named files directly when details are needed.
- Subagents read task files, return findings and PLAN patch suggestions. Only the main agent commits changes to PROGRESS.md and PLAN.md.

## Scope

`agent-workflow.md` owns the build/review loop. `subagents.md` owns orchestration strategy and agent roster. This file owns the dispatch input and subagent handoff formats.

## Agent Roster

| Agent | Mode | Purpose |
| --- | --- | --- |
| `planner` | Read | split goal into tasks, dependencies, write sets |
| `researcher` | Read | product, market, ecosystem, dependency research |
| `docs-researcher` | Read | official docs, API, SDK, version, limits |
| `architect` | Read | layer boundaries, ports, data flow, state impact |
| `test-writer` | Write | failing test or manual verification plan |
| `implementer` | Write | minimal change inside declared write set |
| `debugger` | Write | smallest fix for a reproduced failure |
| `reviewer` | Read | diff review, risks, missing tests |
| `verifier` | Read | run checks and record evidence |
| `reflector` | Read | synthesize review/evidence and decide acceptance readiness |
| `memory-master` | Write | write/consolidate memory entries |
| `context-master` | Read | analyze context, recommend compression |
| `explore-manager` | Read | WF-MAX W0: spawn researchers, synthesize |
| `architect-manager` | Read | WF-MAX W1: spawn architects, synthesize |
| `implement-manager` | Write | WF-MAX W2: spawn implementers |
| `review-manager` | Read | WF-MAX W2R: spawn reviewers, deduplicate |

## Dispatch Rules

- Every dispatch row needs task, agent, mode, read set, write set, dependency, output, and status.
- A write set of `none` means read-only.
- If two write sets overlap, do not run those agents in parallel.
- If an agent returns uncertainty, mark the row `Blocked` or add a follow-up row.
- If docs, tests, and code disagree, stop implementation and record the conflict in `Harness/tasks/<task-id>/PROGRESS.md`.
- In /wf max, file claims must respect WF-MAX.md leaf condition: no split below 50 avgLines, no split when files <= span*2.

## Dispatch Input (Controller -> Subagent)

The controller MUST include these fields in the subagent's dispatch packet.
Without them, the subagent has no way to know which rules or contracts to load.

```text
Role:               <installed agent name or bounded role, e.g. planner, implementer-fe, reviewer, memory-master>
Task:               <one-sentence goal>
ECC:                <which ECC rules to load, e.g. web/design-quality.md, python/fastapi.md. See context-loading.md#ecc-rules-per-role>
Skills:             <which skills to activate, e.g. react-review, tdd-guide>
PRD:                <path or task PLAN section containing Mini PRD>
Acceptance IDs:     <AC-001, AC-002, or "none" for non-behavioral work>
UI contract:        <path to UI_CONTRACT.md or task PLAN section, if UI task>
API contract:       <path to api/openapi.yaml, if frontend<->backend task. Omit if N/A>
Read set:           <files and directories the subagent may read>
Write set:          <files the subagent may modify. "none" = read-only>
Forbidden:          <commands, paths, or patterns the subagent must not touch>
Verification:       <commands to run after implementation, e.g. npm test>
```

## Handoff Format (Subagent -> Controller)

Subagents return summaries in this shape:

```text
Agent:
Task:
Mode:
ECC loaded:         <which ECC rule files were actually loaded. Should match dispatch ECC field.>
Skills active:      <which skills were active. Should match dispatch Skills field.>
API contract:       <path to api/openapi.yaml, if frontend<->backend task. Omit if N/A>
Acceptance IDs:     <AC IDs handled or validated>
Files read:
Files changed:
Findings:
Evidence:
Risks:
Next:
PLAN patch:
Validation matrix:  <AC-by-AC pass/fail/block evidence, for validators>
Concurrency group:  <wave number - 0=exploration, 1,2,3,...=implementation waves. Optional; only used in /wf max.>
File claim:         <list of exact file paths this agent exclusively owns. Optional; only used in /wf max.>
Granularity floor:  <50 avgLines -> do NOT spawn. Apply leaf condition from WF-MAX.md.>
```

Use `Files changed: none` for read-only agents. Use `PLAN patch: none` when no state update is needed.
If a handoff matters after context loss, write it to `Harness/tasks/<task-id>/PROGRESS.md`, `Harness/tasks/<task-id>/PLAN.md`, the current feature doc, or `Harness/memory/*`; do not rely on chat transcript state.

## Statuses

Allowed dispatch statuses: Pending / In Progress / Returned / Integrated / Blocked / Verified.
