# Subagent Orchestration

Purpose: coordinate subagents for speed without losing control of scope, evidence, or integration.

Use this file when work needs multiple roles, parallel reading, independent review, broad context, repeated failures, or `/wf`.

project files are the only durable communication channel; chat/subagent transcript state is non-authoritative. Important assumptions, decisions, blockers, evidence, and handoffs must be written to `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md`, the current feature doc, `Harness/MEMORY.md`, or `Harness/memory/*` as appropriate.

Subagent work is acceptance-driven. Use [AGENT_ISOLATION.md](AGENT_ISOLATION.md)
for role/context isolation and [ACCEPTANCE_PROTOCOL.md](ACCEPTANCE_PROTOCOL.md)
for PRD-GATE, AC-GATE, CONTRACT-GATE, TEST-GATE, VALIDATION-GATE, and
REVIEW-GATE.

## Source Attribution

This harness distills ideas from these sources. Keep the protocol local and conservative; do not import external runtimes by default.

| Source | Found By | Adopted Idea |
| --- | --- | --- |
| `superpowers:dispatching-parallel-agents` | local skill | Dispatch one agent per independent problem domain; give focused scope and exact context. |
| `superpowers:subagent-driven-development` | local skill | Fresh implementer per task; spec review before code-quality review; handle `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, and `BLOCKED`. |
| [`flc1125/skills@subagent-orchestrator`](https://skills.sh/flc1125/skills/subagent-orchestrator) | `npx skills find "subagent orchestration"` | Explicit subagent invocation, role-specific prompts, tool permission awareness. |
| [`davila7/claude-code-templates@parallel-agents`](https://skills.sh/davila7/claude-code-templates/parallel-agents) | `npx skills find "parallel agents"` | Discovery -> domain agents -> synthesis; one unified synthesis instead of scattered reports. |
| [`ruvnet/ruflo@agent-workflow`](https://skills.sh/ruvnet/ruflo/agent-workflow) | `npx skills find "agent workflow"` | Workflow thinking: triggers, agent assignments, parallel processing, and stateful handoffs. |
| [`pcvelz/superpowers@subagent-driven-development`](https://skills.sh/pcvelz/superpowers/subagent-driven-development) | `npx skills find "subagent driven development"` | Implementer plus review gates for spec compliance and code quality. |
| [`oimiragieo/agent-studio`](https://skills.sh/oimiragieo/agent-studio/dispatching-parallel-agents) | Skills CLI / public docs | Router-subordinate architecture and durable handoff discipline. |
| [`subagent-orchestration-skill`](https://skills.rest/rjtaryn/skills/subagent-orchestration-skill) | public docs | Multi-stage executor, spec reviewer, code reviewer, circuit breaker, and escalation pattern. |

## Controller Role

The main agent is the controller. It owns:

- intent confidence and user questions
- task decomposition
- read/write set boundaries
- dispatch table in `Harness/tasks/<task-id>/PLAN.md#Subagent Dispatch`
- integration of returned summaries
- final verification and closeout

Subagents provide bounded work. They do not own final scope, architecture, release claims, or user-facing decisions.

## Built-in Agent Roster

Use the installed roster under `.claude/agents/` before inventing ad hoc roles.

| Agent | Default Use |
| --- | --- |
| `planner` | decompose goals, map unknowns, define success criteria and write sets |
| `researcher` | local/external ecosystem context, comparable projects, current facts |
| `docs-researcher` | official docs, SDK/API behavior, browser/tool constraints |
| `architect` | boundaries, interface decoupling, state ownership, data flow, migration risk |
| `test-writer` | failing tests, manual check contracts, browser/API evidence plan |
| `implementer` | bounded code or doc changes after the second plan |
| `reviewer` | spec compliance, code quality, maintainability, security, missing tests |
| `debugger` | reproduced failures, root cause isolation, smallest safe fix |
| `verifier` | command execution, real browser/API checks, final evidence |
| `reflector` | closeout synthesis, unresolved-risk check, acceptance gate verdict |
| `memory-master` | write/consolidate memory entries, dedup, cross-project extraction; dispatched on repeated failures, user corrections, and WF closeout |
| `context-master` | analyze context usage, recommend compression at ~85% window, extract durable session knowledge during closeout |

## Acceptance Role Passes

These are role passes that may be handled by the built-in roster above or by
project-specific agents. They define context boundaries even when no dedicated
agent file exists.

| Role Pass | Default Agent | Reads | Writes |
| --- | --- | --- | --- |
| PRD Planner | `planner` | user request, memory, research | Mini PRD/task PLAN only |
| Acceptance Agent | `planner` or `test-writer` | PRD, user scenarios, UI requirements | AC section only |
| Contract Agent | `architect` or `test-writer` | PRD, AC, API/schema/UI requirements | UI/API/state contract section only |
| Test Architect | `test-writer` | AC, contracts, test utilities | tests or test plan only |
| Implementer | `implementer` | PRD, AC, contracts, tests, relevant code | assigned implementation write set only |
| Independent Validator | `verifier` | PRD, AC, contracts, running app/API, commands | validation report/evidence only |
| Cross Review | `reviewer` | PRD, AC, contracts, diff, tests, validation evidence | spec/AC and code/architecture/test findings only |
| Reflector | `reflector` | validation evidence, reviewer findings, risks, decisions | final PASS/RETURN_TO_DEBUG/BLOCKED verdict only |
| Debugger | `debugger` | failed AC, logs, trace, screenshot, diff | smallest assigned fix set |

Hard rule: implementer may not be the independent validator for the same AC ID.

## WF Default Fan-Out

Explicit `/wf`, `wf mode`, `workflow mode`, or `wk mode` requires complete
role-chain coverage from `.claude/agents/` before closeout: plan,
research/docs research as needed, architecture, test, implement, independent
validation, cross-review, reflector, and accept.

Default starter set:

- `planner` for decomposition and local map
- `architect` for boundaries, interfaces, and state impact
- `researcher` or `docs-researcher` depending whether the unknowns are project/ecosystem facts or official tool/API behavior

Then add phase-specific agents:

- `test-writer` before implementation
- `implementer` for the serial write lane
- `reviewer` for independent spec/AC and code/architecture/test gates
- `debugger` after a reproduced verification failure
- `verifier` for command/browser/API evidence and AC matrix
- `reflector` after cross-review to decide whether final acceptance may proceed
- `context-master` before closeout for knowledge extraction
- `memory-master` after repeated failures and during closeout for consolidation

Collaboration mode is determined by concrete conditions, not a fixed ratio. See `Harness/WF.md#Complete Role Chain Requirement` for the full decision tree. Summary: explicit WF/WK mode always uses the complete role chain. 3+ files or cross-layer work uses multi-agent orchestration. 1-2 local files, well-understood, not in WF mode can be solo. Repeated failure stops solo work and switches to multi-agent.

## Efficiency Ladder

Choose the cheapest coordination level that is safe.

| Level | Use When | Pattern |
| --- | --- | --- |
| Solo pass | one file, low risk, clear intent | no subagent |
| Single reviewer | small change with meaningful risk | implement, then reviewer |
| Parallel read-only | broad reading, research, architecture, multiple independent failures | 2-3 read-only agents |
| Serial build lane | normal feature or fix | acceptance/contract -> test-writer -> implementer -> verifier evidence -> cross-review -> reflector -> acceptance |
| Isolated lanes | disjoint write sets or competing approaches | separate worktrees, then review and merge |
| Max parallelism | 5+ disjoint files, fan-out benefit > coordination cost | /wf max: write-set coloring -> wave dispatch -> parallel review |

Max parallelism removes the Harness default cap, not the runtime's physical or
account cap. For WF-MAX, record the current runtime budget, use native
subagents first, close completed agents before declaring the pool exhausted,
then overflow to the other CLI (`claude -p` or `codex exec`) with explicit
dispatch packets. Generated Harness Codex config defaults to
`agents.max_threads = 12` and `agents.max_depth = 1`; if that becomes the
bottleneck, ask the user before raising `agents.max_threads` and keep
`max_depth = 1` unless recursive delegation is explicitly approved. Do not rely
on undocumented fork/derive bypasses as stable capacity.

Default for automatic WF triggers: 3-5 active read-only agents before second
planning. For explicit WF/WK mode, never use the solo pass; schedule the
complete role chain and use bounded role passes as the recorded fallback when
subagents are unavailable.

## WF Orchestration Shape

```text
controller intake
-> parallel planner/researcher/docs-researcher/architect subagents
-> controller synthesis
-> second plan with dependencies and write sets
-> acceptance/contract/test-writer
-> implementer
-> independent validator
-> cross-review: spec/AC reviewer + code/architecture/test reviewer
-> reflector
-> if failed: debugger/fixer -> verify -> cross-review -> reflector -> loop
-> close with evidence
```

Use this shape for `/wf`, long tasks, multi-file changes, architecture work, migrations, browser/API behavior, or repeated failures.

```text
/wf max orchestration shape:
controller intake
-> wave 0: max-parallel exploration (4-14 read-only agents)
-> E-GATE: Exploration Gate - all questions answered, findings synthesized (per WF-MAX.md)
-> wave 1: architecture - 3 parallel architects -> boundary decisions + interface contract
-> D-GATE: Write Decomposition Gate - Dispatch Table + Self-Audit for write-set (MANDATORY, per WF-MAX.md)
-> wave 2: N parallel implementers (disjoint file claims, ALL spawned in ONE message)
-> wave 2 review: parallel spec/code/security reviewers
-> wave 3+: dependent implementers (if any; re-run D-GATE if write-set changed)
-> integration verifier
-> reflector after cross-review
-> closeout with evidence
```

## Dispatch Pack

Use the canonical dispatch input and handoff format in `Harness/dispatch.md`. Every subagent dispatch must be self-contained - inject only the docs selected by `Harness/README.md` and `Harness/context-loading.md`.

## Parallelism Rules

- Read-only agents may run in parallel.
- Writing agents run serially unless write sets are disjoint and the controller has chosen an isolated worktree.
- Reviewers may run in parallel after implementation, but spec compliance is evaluated before code-quality approval.
- Subagents are readers and reporters. They return findings and PLAN patch suggestions. Only the controller (main agent) commits state changes to task files.
- Do not let two agents edit `Harness/tasks/<task-id>/PROGRESS.md`, `Harness/tasks/<task-id>/PLAN.md`, `Harness/MEMORY.md`, or `Harness/memory/*` concurrently. The controller writes durable state.
- If two agents disagree, the controller records the conflict in `Harness/tasks/<task-id>/PLAN.md` and chooses the smallest reversible next step.

## Review Gates

Implementation is not complete until cross-review and reflection pass:

1. **Spec review**: confirms the result matches the user request, PRD, feature doc, acceptance criteria, contracts, and non-goals. Extra features are failures.
2. **Code-quality review**: checks correctness, maintainability, architecture, tests, security, and integration risk.
3. **Reflector gate**: checks reviewer findings, verifier evidence, unresolved risks, and contradictions; returns PASS, RETURN_TO_DEBUG, or BLOCKED.

Validation is separate from review. Validator must produce an AC-by-AC result
matrix from running behavior and evidence, not from the implementer's summary.

If either reviewer finds issues, the implementer or debugger fixes them and the same gate runs again. Do not move to final acceptance with open critical/high findings or without reflector PASS.

## Subagent Status Handling

| Status | Controller Action |
| --- | --- |
| `DONE` | start review gates |
| `DONE_WITH_CONCERNS` | read concerns, decide whether to address before review, record in `Harness/tasks/<task-id>/PROGRESS.md` |
| `NEEDS_CONTEXT` | provide only missing context and re-dispatch |
| `BLOCKED` | change something: add context, split task, upgrade reasoning, use debugger, or ask user |

Never retry the same failed prompt unchanged.

## Failure Recovery

- First failed verification: record evidence, dispatch debugger with the smallest reproduced failure.
- Second same-class failure: narrow scope, update `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat`, and add a reviewer before another fix.
- Third same-class failure: stop blind fixes. Present evidence-backed options to the user.

The recovery loop must preserve the same evidence standard as the main workflow: real commands, real browser/API checks when applicable, and recorded logs or artifacts.

## Synthesis Output

After subagents return, the controller writes one synthesis into `Harness/tasks/<task-id>/PLAN.md`:

```text
Agents used:
Findings accepted:
Findings rejected:
Conflicts:
Decisions:
Next write set:
Verification path:
Acceptance/contract traceability:
Residual risk:
```

Only the synthesis and named files enter main context. Do not replay full subagent conversations.
