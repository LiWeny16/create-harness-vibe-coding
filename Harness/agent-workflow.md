# Agent Workflow

Use when implementing, reviewing, debugging, or coordinating subagents.

This workflow is acceptance-driven. PRD-derived Acceptance Criteria are the
source of truth; implementation, tests, review, validation, debug, and memory
must trace to AC IDs. Load [ACCEPTANCE_PROTOCOL.md](ACCEPTANCE_PROTOCOL.md) for
gate rules, [TDD-GUIDE.md](TDD-GUIDE.md) for AC-linked RED tests,
[HARNESS_BRIDGE.md](HARNESS_BRIDGE.md) for UI/API/browser evidence, and
[AGENT_ISOLATION.md](AGENT_ISOLATION.md) before role splits.

## ReAct Loop

```text
Observe -> Load minimal context -> Plan -> Act -> Verify -> Update Harness/tasks/<task-id>/PROGRESS.md
```

If context grows, load [context-loading.md](context-loading.md) and split the
work. If more than one agent is useful, load [subagents.md](subagents.md) and
[dispatch.md](dispatch.md).

## Feature Packet

Every PRD scope item must be covered by AC IDs and a task plan at
`Harness/tasks/<task-id>/PLAN.md` created from
`Harness/tasks/_template/PLAN.md` (the primary work tracking system).

**Cohesion rule**: if multiple PRD scope items share the same write set, the
same test/verification path, and the same review boundary, group them into a
single feature doc. The PRD owns scope decomposition; the feature doc owns the
implementation unit.

**Minimum bar**: a task plan is required when the implementation touches more
than one file or changes user-visible behavior. Record the plan in
`Harness/tasks/<task-id>/PLAN.md`. For single-file fixes with no behavior
change, a brief note in `PROGRESS.md` is enough.

Use the compact task template by default. `PLAN.md` owns goal, decisions,
scope/write set, agents, verification intent, and risks. `PROGRESS.md` owns
status/next/blocker, completed tasks, changed files, verification evidence, and
notes. Expand sections only when they change an implementation or review
decision.

**AC record size**: default to 1-3 concise ACs. Use full UI/API contracts and an
AC-by-AC validation matrix only for browser-visible, API/integration,
security/data-loss, cross-module, or other high-risk behavior.

**New vs iterate**: if a PRD scope item overlaps with an existing task, reopen
the existing task capsule and append to its `PROGRESS.md`. Only create a new
task capsule when the scope is substantially different. When unsure, ask.

## Acceptance-Driven Build Loop

```text
Mini PRD
-> Acceptance Criteria
-> UI/API contracts
-> test plan
-> failing test or manual check
-> minimal implementation
-> independent validation
-> cross-review (spec/AC + code/architecture/test)
-> reflector PASS
-> final acceptance
-> debug if needed
-> docs sync
-> memory
-> close or iterate
```

Rules:

- No PRD, no implementation.
- No acceptance criteria, no tests.
- No acceptance criteria, no code.
- Browser-visible behavior must have a real user-path test or documented browser validation; syntax-only checks are not acceptance.
- Frontend-backend behavior must include network/API assertions against the contract.
- Implementer cannot modify PRD, acceptance criteria, UI/API contracts, test plan, or validation report unless a Change Request is recorded.
- Validator must be independent from implementer and must produce an AC-by-AC result matrix.
- Cross-review and reflector PASS are required before final acceptance.

## Subagent Use

Use subagents when a task needs broad reading, parallel work, cross-layer
changes, independent review, or isolated debugging. Follow
[subagents.md](subagents.md) for controller-led orchestration and
[dispatch.md](dispatch.md) for the dispatch table.

Before spawn, define:

- role
- task
- mode
- read boundary
- write boundary
- dependency
- injected docs from [context-loading.md](context-loading.md)
- return format

Rules:

- Explorer Pass, Reviewer, Verifier, and Reflector are read-only.
- Researcher and Docs Researcher are read-only unless explicitly asked to return a docs patch.
- Planner and Architect are read-only unless explicitly asked to return a docs patch.
- Test Writer writes tests before Implementer writes production code.
- Implementer only writes inside its declared write set.
- Implementer forbidden set includes PRD, acceptance criteria, UI/API contracts, test plan, and validation report by default.
- Writing agents run serially unless write sets are disjoint.
- Debugger fixes the smallest failing path, not adjacent design.
- Debugger receives failed AC IDs, evidence, and failing layer hypothesis before editing.
- Main agent integrates summaries, resolves conflicts, and runs final verification.

## Parallel Dispatch

Use [subagents.md](subagents.md) and [dispatch.md](dispatch.md) for multi-agent work.

**Agent count by mode:**
| Mode | Agent Count Rule | Source |
|------|-----------------|--------|
| Default (non-WF) | up to 3 active agents by default | This file |
| `/wf` | complete role chain mandatory before closeout | [WF.md](WF.md) |
| `/wf max` | complete WF role chain plus maximum useful fan-out | [WF-MAX.md](WF-MAX.md) |

Prefer parallel read-only work first, then serial writes.

Every dispatched agent returns the handoff format defined in [dispatch.md](dispatch.md).

## Conflict Rule

If PRD, acceptance criteria, UI/API contracts, task PLAN.md, architecture,
ports, tests, or code disagree:

1. stop implementation
2. record the conflict in `Harness/tasks/<task-id>/PROGRESS.md` or the feature doc
3. choose the smallest reversible decision
4. ask the maintainer when user-visible behavior or security is affected

## Completion Gate

Close only when:

- acceptance criteria are satisfied by AC ID
- validation result matrix exists for user-visible behavior
- verification evidence is recorded
- cross-review has passed with no unresolved critical/high findings
- reflector verdict is PASS
- architecture docs are synced if affected
- no unresolved critical/high review findings remain
- any optimistic UI mutation has a declared and verified rollback path
- any file declared as DONE in PLAN.md or PROGRESS.md exists on disk (chat output is not durable evidence)
- `Harness/tasks/<task-id>/PROGRESS.md` states the final status or next iteration
