# Context Loading Protocol

Use when context is growing, subagents are needed, or an agent is unsure which harness doc applies.

## Routing Authority

`docs/README.md` is the primary router. This file is a secondary context-splitting protocol for subagents and long tasks.

If this file and `docs/README.md` disagree, follow `docs/README.md`, record the assumption in `docs/harness/PLAN.md`, and update this file later.

project files are the only durable communication channel; chat/subagent transcript state is non-authoritative. Important assumptions, decisions, blockers, evidence, and handoffs must be written to `docs/harness/PLAN.md`, the current feature doc, `MEMORY.md`, or `memory/*` as appropriate.

## Main Context

Always keep:

- `CLAUDE.md`
- `MEMORY.md`
- `docs/README.md`
- `docs/harness/PLAN.md` when active
- current feature doc when active

Load other docs only by trigger.

## Trigger Matrix

| Trigger | Load |
| --- | --- |
| idea, scope, MVP | `docs/harness/lifecycle.md`, `docs/research/PRD.md` |
| research, competitors, stack choice | `docs/research/README.md`, `docs/research/research-results.md` |
| official docs, API, SDK, version, limits | `docs/research/README.md`, `docs/harness/architecture.md`, `docs/domain/ports.md` as needed |
| layer, dependency, module boundary | `docs/harness/architecture.md`, `docs/domain/ports.md` |
| task split, owner, write set | `docs/harness/PLAN.md`, `docs/harness/agent-workflow.md` |
| parallel agents, dispatch, worktree decision | `docs/harness/dispatch.md`, `docs/harness/PLAN.md` |
| memory, repeated tool failure, repeated user correction, reusable lesson | `MEMORY.md`, the relevant `memory/*.md` file |
| event, retry, failure path | `docs/harness/data-flow.md` |
| status, transition, resume | `docs/harness/state-machines.md` |
| subagent spawn | this file plus the role pack below |

## Subagent Packs

Explorer Pass:
- inject: question, read boundary, relevant docs
- forbid: writes
- return: files found, facts, risks, suggested tests

Planner:
- inject: user goal, lifecycle phase, PRD or PLAN section, dispatch constraints
- forbid: production code
- return: tasks, dependencies, read/write sets, dispatch table, gates, open questions

Researcher:
- inject: question, decision needed, source boundaries, tool options
- forbid: production code
- return: sources, adopted/rejected/watch decisions, risks, research-results.md patch

Docs Researcher:
- inject: library/API/config, implementation question, version/date constraints
- forbid: production code
- return: official links, constraints, errors, examples, affected docs

Architect:
- inject: PRD, current architecture, ports
- forbid: implementation
- return: boundary decision, affected docs, risks

Test Writer:
- inject: acceptance criteria, feature doc, test write set
- forbid: production code
- return: failing tests and test intent

Implementer:
- inject: task, tests, allowed write set, forbidden scope
- forbid: unrelated refactor and test loosening
- return: changed files and implementation notes

Reviewer:
- inject: diff, acceptance criteria, architecture docs
- forbid: writes
- return: findings by severity, missing tests, boundary issues

Debugger:
- inject: failing command, error output, related files
- forbid: broad rewrites
- return: root cause, fix, proof

Verifier:
- inject: verification commands and acceptance criteria
- forbid: code changes
- return: commands run, results, residual risk

## Handoff Rule

Only the subagent summary enters main context. If details are needed, load the named files directly instead of replaying the subagent conversation.

Use the handoff format in [dispatch.md](dispatch.md) for every dispatched agent.
