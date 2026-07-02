# Context Loading Protocol

Use when context is growing, subagents are needed, or an agent is unsure which harness doc applies.

## Routing Authority

`Harness/README.md` is the primary router. This file is a secondary context-splitting protocol for subagents and long tasks.

If this file and `Harness/README.md` disagree, follow `Harness/README.md`, record the assumption in `Harness/tasks/<task-id>/PROGRESS.md`, and update this file later.

project files are the only durable communication channel; chat/subagent transcript state is non-authoritative. Important assumptions, decisions, blockers, evidence, and handoffs must be written to `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md`, the current feature doc, `Harness/MEMORY.md`, or `Harness/memory/*` as appropriate.

## Main Context

Always keep:

- `CLAUDE.md`
- `Harness/MEMORY.md`
- `Harness/README.md`
- `Harness/PROGRESS.md` when active
- `Harness/tasks/<task-id>/PROGRESS.md` when active
- `Harness/tasks/<task-id>/PLAN.md` when active
- current feature doc when active

Load other docs only by trigger.

## Trigger Matrix

| Trigger | Load |
| --- | --- |
| idea, scope, MVP | `Harness/lifecycle.md`, `Harness/research/PRD.md`, `Harness/ACCEPTANCE_PROTOCOL.md` |
| acceptance, AC, criteria, contract, validation matrix | `Harness/ACCEPTANCE_PROTOCOL.md`, `Harness/AGENT_ISOLATION.md`, `Harness/HARNESS_BRIDGE.md` as needed |
| research, competitors, stack choice | `Harness/research/README.md`, `Harness/research/research-results.md` |
| task split, owner, write set | `Harness/tasks/<task-id>/PROGRESS.md`, `Harness/tasks/<task-id>/PLAN.md`, `Harness/agent-workflow.md` |
| parallel agents, dispatch, worktree decision | `Harness/subagents.md`, `Harness/dispatch.md`, `Harness/tasks/<task-id>/PLAN.md` |
| `/wf` mode, long task, multi-file, multi-agent | `Harness/WF.md`, `Harness/subagents.md`, `Harness/dispatch.md`, `Harness/tasks/<task-id>/PLAN.md` |
| `/wf max`, 5+ disjoint files, maximum parallelism | `Harness/WF-MAX.md`, `Harness/subagents.md`, `Harness/dispatch.md`, `Harness/tasks/<task-id>/PLAN.md` |
| memory, scenario memory, repeated tool failure, repeated user correction, reusable lesson | `Harness/MEMORY.md`, `Harness/MEMORY_PROTOCOL.md`, the relevant `Harness/memory/*.md` file |
| subagent spawn | `Harness/subagents.md`, `Harness/AGENT_ISOLATION.md`, this file plus the role pack below |

## ECC Rules Per Role

Each subagent role loads a specific ECC rule subset. The dispatcher MUST include
`ecc` in the dispatch packet so the subagent knows which rules to read first.

| Role | Frontend Task | Backend Task | Full-Stack Task |
|------|--------------|-------------|-----------------|
| **Explorer** | `web/patterns.md`, `web/design-quality.md` | `common/patterns.md`, stack patterns | All |
| **Planner** | `common/patterns.md`, `web/patterns.md` | `common/patterns.md`, stack patterns | All |
| **Architect** | `web/patterns.md`, `web/performance.md` | `common/patterns.md`, `python/fastapi.md` or `golang/patterns.md` | All + API contract |
| **Implementer (FE)** | `web/design-quality.md`, `web/patterns.md`, `web/performance.md`, `typescript/patterns.md` | N/A | Frontend subset |
| **Implementer (BE)** | N/A | `common/patterns.md`, `python/fastapi.md` or `golang/patterns.md` | Backend subset |
| **Test Writer** | `web/testing.md`, `typescript/testing.md` | Stack testing rules | Both |
| **Reviewer** | `web/design-quality.md`, `web/security.md`, `web/performance.md` | Stack security + testing rules | All |
| **Debugger** | Stack-specific coding-style + patterns | Stack-specific coding-style + patterns | Context-dependent |
| **Verifier** | `web/testing.md` | Stack testing rules | Both |

## Subagent Packs

Each pack now includes `ecc` — the ECC rule files this role MUST load first.

Explorer Pass:
- ecc: `common/patterns.md` + stack-specific patterns (see ECC Rules Per Role)
- inject: question, read boundary, relevant docs
- forbid: writes
- return: files found, facts, risks, suggested tests

Planner:
- ecc: `common/patterns.md` + `common/development-workflow.md`
- inject: user goal, lifecycle phase, PRD or PLAN section, acceptance gate status, dispatch constraints
- forbid: production code
- return: tasks, dependencies, read/write sets, dispatch table, gates, open questions

Researcher:
- ecc: none (uses WebSearch/WebFetch, not code rules)
- inject: question, decision needed, source boundaries, tool options
- forbid: production code
- return: sources, adopted/rejected/watch decisions, risks, research-results.md patch

Docs Researcher:
- ecc: none (uses official docs, not code rules)
- inject: library/API/config, implementation question, version/date constraints
- forbid: production code
- return: official links, constraints, errors, examples, affected docs

Architect:
- ecc: `common/patterns.md` + stack-specific (web/patterns.md for FE, python/fastapi.md for BE)
- inject: PRD, current architecture, ports
- forbid: implementation
- return: boundary decision, affected docs, risks

Test Writer:
- ecc: `common/testing.md` + stack-specific testing rules
- inject: acceptance criteria, UI/API contracts, feature doc, test write set
- forbid: production code
- return: failing tests, AC ID mapping, and test intent

Implementer (Frontend):
- ecc: `web/design-quality.md`, `web/patterns.md`, `web/performance.md`, `typescript/patterns.md`
- inject: task, tests, allowed write set, forbidden scope
- forbid: unrelated refactor and test loosening
- return: changed files and implementation notes

Implementer (Backend):
- ecc: `common/patterns.md`, stack-specific patterns (`python/fastapi.md` or `golang/patterns.md`)
- inject: task, tests, allowed write set, forbidden scope
- forbid: unrelated refactor and test loosening
- return: changed files and implementation notes

Reviewer:
- ecc: `web/design-quality.md` (FE), `web/security.md` (FE), `common/security.md`, stack security
- inject: PRD, acceptance criteria, UI/API contracts, diff, test/validation evidence, architecture docs
- forbid: writes
- return: findings by severity, AC traceability, missing tests, boundary issues

Debugger:
- ecc: stack-specific coding-style + patterns
- inject: failed AC ID, failing command, error output, trace/screenshot/network evidence, related files
- forbid: broad rewrites
- return: failure layer, root cause, fix, proof

Verifier:
- ecc: stack-specific testing rules
- inject: verification commands, acceptance criteria, UI/API contracts, running app/API endpoint
- forbid: code changes
- return: commands run, AC-by-AC validation matrix, evidence paths, residual risk

Memory Master:
- inject: trigger reason, current failure/user-correction/closeout context, task PROGRESS.md section
- forbid: source code, unrelated Harness docs
- return: memory action summary, files written, cross-project flag

Context Master:
- inject: trigger reason (threshold % or closeout), current task PROGRESS.md, task phase
- forbid: source code, memory files, MEMORY.md writes
- return: context usage %, stale blocks, compressible blocks, durable knowledge candidates, compression suggestion

## Handoff Rule

Only the subagent summary enters main context. If details are needed, load the named files directly instead of replaying the subagent conversation.

Use the handoff format in [dispatch.md](dispatch.md) for every dispatched agent.
