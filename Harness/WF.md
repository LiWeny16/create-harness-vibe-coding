# WF Mode - Long Task Workflow

Use this when work is long, difficult, uncertain, multi-file, multi-agent, or
user-triggered with `/wf`, `$wf`, `wf mode`, `workflow mode`, or `wk mode`.

This is a Ralph-style harness loop: keep moving through evidence, bounded
exploration, second planning, implementation, review, verification, and recovery
instead of stalling on the first obstacle.

WF is acceptance-driven. The source of truth is not the implementation, not the
tests, and not the agent's summary. The source of truth is the PRD-derived
Acceptance Criteria. Code, tests, review, validation, debug, and memory must
trace to AC IDs. Load [ACCEPTANCE_PROTOCOL.md](ACCEPTANCE_PROTOCOL.md) for the
gate contract, [AGENT_ISOLATION.md](AGENT_ISOLATION.md) for role separation, and
[HARNESS_BRIDGE.md](HARNESS_BRIDGE.md) for UI/API/browser evidence.

## Trigger

Enter WF mode when any of these are true:

- The user explicitly says `/wf`, `$wf`, `wf mode`, `workflow mode`, `wk mode`,
  or asks for the full workflow.
- The task needs more than one step, more than three files, or more than one
  subsystem.
- The task needs research, architecture judgment, browser/API validation, or
  migration planning.
- Confidence in intent, architecture, or implementation is below 95%.
- The same command, test, tool, or approach fails twice.
- The user explicitly says `/wf-max [task]`, `$wf-max [task]`, or `wf max` (for
  maximum-parallelism mode, see [WF-MAX.md](WF-MAX.md)).

Two distinct trigger classes; do not conflate them:

- Explicit invocation (`/wf`, `$wf`, `wf mode`, `workflow mode`, `wk mode`,
  `/wf-max`, `$wf-max`): role fan-out is mandatory and unconditional. File
  count, task size, and subsystem count are irrelevant. A one-file task invoked
  with WF still schedules the complete role chain before closeout.
- Auto-triggering decides whether the harness enters WF mode on its own. It can
  only escalate into WF, never downgrade an explicit command out of WF.

## Complete Role Chain Requirement

WF mode requires the complete role chain by default.

Normative rule: Explicit `/wf`, `$wf`, `wf mode`, `workflow mode`, or `wk mode` MUST cover every mandatory role class before closeout: Plan, Research, Architecture, Test, Implement, Independent Validation, Cross-Review, Reflect, and Final Acceptance.

- Explicit `/wf`, `$wf`, `wf mode`, `workflow mode`, or `wk mode` MUST schedule
  the complete role chain at intake. Use real subagents when the runtime
  supports them; otherwise emulate those roles as bounded passes and record the
  fallback.
- Mandatory role classes:
  - Plan: `planner`
  - Research: `researcher` or `docs-researcher`; use both when local and external/current facts matter
  - Architecture: `architect`
  - Test: `test-writer`
  - Implement: `implementer` and `debugger` when needed
  - Independent Validation: `verifier` records AC-mapped evidence before cross-review
  - Cross-Review: at least two independent review lenses after implementation
  - Reflect: `reflector`
  - Final Acceptance: controller accepts only after cross-review passes and `reflector` returns PASS
- Runtime mapping:
  - Claude Code: prefer subagents from `.claude/agents/`.
  - Codex: prefer the available Codex subagent surface; if unavailable, use
    bounded passes with the same roles and evidence contract.
- Collaboration decision tree (replaces the old "7:3" heuristic with concrete
  conditions):
  - Explicit WF/WK mode -> complete role chain, no exceptions.
  - 3+ files changed -> complete role chain.
  - Cross-layer change -> complete role chain plus separate architecture review.
  - Uncertain scope or approach -> complete role chain with both researcher and architect passes.
  - 1-2 files, well-understood, not in WF mode -> solo is acceptable.
  - Repeated failure on the same task -> stop solo and switch to multi-role.
- Default `/wf` startup records the full chain in the task plan. Dependency-bound
  roles run when their phase is ready; they are not optional.

## Exploration Gate

- [ ] Controller has not read source files directly; only Harness docs, root
  agent entries, and subagent or bounded-pass returns.
- [ ] Complete role chain is scheduled in the task plan.
- [ ] Plan, Research, and Architecture role passes each have one specific question before second planning.
- [ ] Role passes were dispatched together when the runtime supports parallel
  dispatch.
- [ ] Agent count is at least `max(3, ceil(estimated_dirs / 2))`; estimate from
  prompt/docs and run a second wave if returns reveal more.
- [ ] Fallbacks are recorded in `Harness/tasks/<task-id>/PLAN.md`.

For maximum-parallelism mode (write-set coloring, wave dispatch, parallel
reviewers), use `/wf-max [task]` in Claude Code or `$wf-max [task]` in Codex and
see [WF-MAX.md](WF-MAX.md).

## WF Loop

```text
Intake
-> confidence gate
-> parallel planner / researcher / docs-researcher / architect roles
-> Mini PRD
-> Acceptance Criteria
-> UI/API contracts
-> test plan
-> second plan
-> test-writer
-> implementer
-> independent validator
-> cross-review: spec/AC reviewer + code/architecture/test reviewer
-> reflector
-> if failed: debugger -> verifier -> cross-review -> reflector -> loop
-> memory closeout with evidence
```

## Intake

1. Read `CLAUDE.md`, `Harness/MEMORY.md`, `Harness/README.md`,
   `Harness/PROGRESS.md`, and the active task capsule if present.
2. State the goal, non-goals, confidence level, known risks, acceptance truth
   files, and write boundaries.
3. Ask up to three blocking questions only when the next action cannot reach
   95% confidence.
4. Update `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` before dispatching
   roles or running long commands.
5. Load `Harness/subagents.md` before coordinating multiple roles.

## Exploration

Use read-only role passes first. For automatic WF triggers, default to 3-5
active agents or bounded passes unless the task is clearly small enough for the
solo exception.

| Role | Purpose | Writes |
| --- | --- | --- |
| `planner` | map local project facts, commands, app entry points, existing docs, and initial decomposition | none |
| `researcher` | product, ecosystem, dependency, and external context | none unless returning a docs patch |
| `docs-researcher` | official docs, SDK/API versions, browser/tool limits | none unless returning a docs patch |
| `architect` | boundaries, ports, data flow, state impact, migration risks | none unless returning a docs patch |

Use local files first. Use web search or official docs only when the decision
needs current or external evidence. Record tool choice and limitations in
`Harness/research/research-results.md` or the task plan.

## Subagent Orchestration

Use `Harness/subagents.md` as the orchestration methodology and
`Harness/dispatch.md` as the dispatch table protocol.

- The main agent is the controller and owns synthesis, integration, and final
  verification.
- Subagents are readers and reporters. Only the main agent writes task
  `PROGRESS.md` and `PLAN.md`.
- Parallelize read-only exploration; serialize writers unless write sets are
  disjoint and isolated.
- Every role gets a dispatch pack with role, goal, mode, read set, write set,
  forbidden scope, injected docs, evidence, stop condition, and return format.
- After implementation, run spec review before code-quality or architecture
  review.
- If subagents are unavailable, emulate the same roles as bounded passes and
  record the fallback.

## Second Plan

After exploration, synthesize facts found, assumptions, risks,
accepted/rejected options, Mini PRD, AC IDs, UI/API contracts, tasks,
read/write sets, verification path, and rollback or recovery plan.

Write the result to `Harness/tasks/<task-id>/PLAN.md` before implementation.
Update `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat`.

The second plan must pass:

- PRD-GATE: goal, scope, non-scope, user flow, and verification commands exist.
- AC-GATE: each behavior has an AC ID and Given/When/Then.
- CONTRACT-GATE: UI/API/state contracts exist when the feature touches UI/API/state.
- TEST-GATE: verification commands and test levels map to AC IDs.
- IMPLEMENT-GATE: implementer forbidden set includes PRD, AC, UI/API contracts, test plan, and validation report unless a Change Request is approved.

## Build And Review

1. `test-writer` defines failing tests or written manual checks from AC IDs and contracts first.
2. `implementer` changes only the declared write set and may not edit truth files without Change Request.
3. `verifier` or independent validator runs AC-mapped checks against running behavior and records an evidence matrix before cross-review.
4. Cross-review is mandatory: at least two independent review lenses must pass before acceptance.
   - Spec/AC review checks request, scope, contracts, and non-goals.
   - Code/architecture/test review checks implementation risk, maintainability, security, and verification adequacy.
5. `reflector` reads verifier evidence and reviewer findings, resolves contradictions with the controller, and returns PASS before final acceptance.
6. For cross-layer or risky work, run separate reviewers for spec/AC compliance, architecture, security, and test adequacy.

## Browser And API Evidence

For browser-visible changes, typecheck/build/unit tests are not enough. Use
Chrome DevTools, CDP, Playwright, or a documented real-browser run:

- start the app and record URL/port
- click through the critical flow
- capture frontend console/runtime errors
- capture failed network requests
- collect backend logs when the flow crosses an API
- record screenshot, trace, video, or manual evidence path
- produce an AC-by-AC acceptance result matrix
- for frontend-backend paths, check UI selectors and API behavior against `HARNESS_BRIDGE.md`

For API changes, run the project API/integration test path or a documented real
request against a local service and record request, response, logs, and failure
behavior.

## Recovery Loop

If verification fails:

1. Update `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` with failure count
   and blocker.
2. Dispatch `debugger` with the failed AC ID, failing command, error output,
   trace/screenshot/network evidence, and smallest relevant files.
3. Classify the failure layer using [DEBUG_PROTOCOL.md](DEBUG_PROTOCOL.md), then fix the smallest reproduced failure.
4. Run verifier again and record fresh AC-mapped evidence.
5. Run cross-review again.
6. Run reflector again.
7. Repeat until verified or blocked by missing user input/external state.

Before asking the user after repeated failures, run the context-master then
memory-master learning cycle or use `wf-learn`.

## Heartbeat Protocol

Heartbeat is a lightweight recovery protocol, not a background daemon.
Keep heartbeat entries to one or two lines: phase, blocker/failure, next action,
and evidence pointer. Do not paste command logs or subagent transcripts.

Update `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat`:

- before a long command
- after a long command
- before spawning subagents or bounded passes
- after integrating returns
- after each failed verification
- before stopping for user input

When context approaches about 85% of the window, run context-master or the
equivalent bounded pass to append a compression suggestion to the task heartbeat.

## Closeout

Close only when:

- PRD-GATE, AC-GATE, CONTRACT-GATE, TEST-GATE, VALIDATION-GATE, REVIEW-GATE, and REFLECT-GATE are satisfied
- acceptance criteria are satisfied and reported by AC ID
- cross-review has passed with no unresolved critical/high findings
- reflector verdict is PASS
- test/API/browser evidence is recorded
- affected Harness docs are synced
- context-master has analyzed the session and extracted durable knowledge
- memory-master has consolidated extracted knowledge into `Harness/memory/*`
- current task PROGRESS.md and PLAN.md are archived under `Harness/tasks/<task-id>/`
  with Phase set to Verified
- `Harness/PROGRESS.md` task index is updated and Active Task is cleared or set
  to the next task
