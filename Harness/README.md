# create-harness-vibe-coding - Harness Router

Purpose: route humans and agents to the smallest useful context. `Harness/README.md` is the primary router.

Default load: `CLAUDE.md`, `Harness/MEMORY.md`, this file, and `Harness/PROGRESS.md` when work is active. Do not read the whole `Harness/` tree.

## 0-1 Flow

```text
Idea -> Research -> PRD -> Architecture -> Plan -> Build -> Verify -> Feedback
```

For the full phase contract, load [lifecycle.md](lifecycle.md).

## Development Contract

- This file is a router, not a full spec.
- If the task does not clearly match a row below, search by keywords before loading more docs.
- project files are the only durable communication channel; chat/subagent transcript state is non-authoritative.
- Important assumptions, decisions, blockers, evidence, and handoffs must be written to the current task's `tasks/<id>/PROGRESS.md` and `tasks/<id>/PLAN.md`, the current feature doc, `Harness/MEMORY.md`, or `Harness/memory/*` as appropriate.
- Build commands, git conventions, and release notes belong in root `README.md`, not `CLAUDE.md`.
- README rewrites are optional project-doc work. Use `readme-optimizer` and preserve existing public docs unless the user approves a broader restructure.
- Code architecture belongs in [architecture.md](architecture.md) or the current feature doc, not `CLAUDE.md`.
- Core rules live in `CLAUDE.md` and `.claude/rules/ecc/common.md`.
- WF mode rules live in [WF.md](WF.md).
- Phase rules live in [lifecycle.md](lifecycle.md).
- Build, review, test, and subagent rules live in [agent-workflow.md](agent-workflow.md).
- Parallel dispatch rules live in [dispatch.md](dispatch.md).
- Subagent orchestration methodology lives in [subagents.md](subagents.md).
- Extension rules live in [extension.md](extension.md).
- Context-loading rules live in [context-loading.md](context-loading.md).
- Progress lives in `Harness/PROGRESS.md`, `Harness/tasks/<task-id>/PROGRESS.md`, `Harness/tasks/<task-id>/PLAN.md`, and the current feature doc.

## Keyword Routing

Use this only when the task is ambiguous or the matching row is unclear.

1. Extract 2-5 concrete keywords from the user request.
2. Search the project docs first:

```bash
rg -n "keyword1|keyword2|keyword3" CLAUDE.md README.md Harness
```

3. Load only the top matching doc or the smallest matching doc pair.
4. If keyword search conflicts with the table below, follow the table and record the assumption in `Harness/tasks/<task-id>/PROGRESS.md`.

Keywords are retrieval hints, not project facts.

## Load By Task

Load the matching row only. Add adjacent docs only when the loaded doc directly names them.

Routing priority: if a request explicitly says `/wf <task>`, `/wf-max [task]`, `wf mode`, `workflow mode`, or `wk mode`, or is long, difficult, uncertain, repeated-failure, migration, architecture-heavy, browser-visible, or broad multi-agent implementation work, choose the WF row first. `wf-mode` MUST then delegate subagent coordination to `subagent-orchestrator`.

| When to Read | Keywords | Load | Output |
| --- | --- | --- | --- |
| Raw idea or vague product request | idea, vague, clarify, goal, non-goal, lifecycle | [lifecycle.md](lifecycle.md), [research/PRD.md](research/PRD.md) | clarified goal, non-goals, first questions |
| Need market/tech direction | research, market, competitor, stack, library, pricing, policy | [research/README.md](research/README.md), [research/research-results.md](research/research-results.md) | research protocol, adopted/rejected choices |
| Need MVP/spec | PRD, MVP, scope, requirement, acceptance, non-goal | [research/PRD.md](research/PRD.md) | one-page PRD with verifiable acceptance criteria |
| Need architecture or boundaries | architecture, boundary, layer, domain, port, adapter, dependency | [architecture.md](architecture.md), [domain/ports.md](domain/ports.md) | layer map, ports, constraints |
| Need WF mode | wf, /wf, wf mode, workflow mode, wk mode, long task, difficult, stuck, repeated failure | [WF.md](WF.md), [PROGRESS.md](PROGRESS.md), the current task `tasks/<id>/PROGRESS.md` and `tasks/<id>/PLAN.md` | exploration plan, second plan, heartbeat, recovery loop; explicit WF/WK loads subagent docs immediately |
| Need to learn from errors | /wf-learn, wf learn, learn, remember, memory, lesson | [MEMORY.md](MEMORY.md), `.claude/skills/wf-learn/SKILL.md`, `Harness/memory/*` | context-master → memory-master → project + global memory |
| Need WF Max mode | /wf-max, wf max, maximum parallelism, max parallel | [WF-MAX.md](WF-MAX.md), [WF.md](WF.md), [subagents.md](subagents.md), [dispatch.md](dispatch.md) | max-parallel exploration, write-set coloring, wave dispatch |
| Adding harness to existing project | existing project, onboarding, migrate, bootstrap, preserve, conflict | [extension.md](extension.md), [PROGRESS.md](PROGRESS.md), root `README.md` and package/CI files | discovered project facts, preserved config, manual registration plan |
| README optimization | README, docs, quickstart, install docs, architecture diagram, command table, documentation polish | root `README.md`, `.claude/skills/readme-optimizer/SKILL.md`, [PROGRESS.md](PROGRESS.md), [architecture.md](architecture.md) as needed | approved README mode, preserved sections, proposed diff plan |
| Need implementation plan | plan, task, write set, verify, milestone, progress | [PROGRESS.md](PROGRESS.md), the current task `tasks/<id>/PROGRESS.md` and `tasks/<id>/PLAN.md`, [agent-workflow.md](agent-workflow.md) | tasks, write set, verification commands |
| Need parallel agents | parallel, dispatch, handoff, write set, dependency, status | [subagents.md](subagents.md), [dispatch.md](dispatch.md), [context-loading.md](context-loading.md), the current task `tasks/<id>/PROGRESS.md` and `tasks/<id>/PLAN.md` | orchestration plan, dispatch table, agent roles, read/write sets |
| Adding stack-specific agents/skills | extension, agent, skill, rule, hook, stack-specific, compatibility | [extension.md](extension.md), [dispatch.md](dispatch.md) | compatible agents, skills, rules, hooks |
| Optional workflow installed | workflow, optional, browser-e2e, ui-ux-review, github-pr-review, python-backend, ts-react-frontend | matching `workflows/*.md` (if installed), [extension.md](extension.md) | workflow-specific evidence, commands, fallback path |
| Need durable memory or reflection | memory, remember, preference, correction, tool failure, lesson, reflection | [MEMORY.md](MEMORY.md), `Harness/memory/tool-usage-reflections.md`, `Harness/memory/user-corrections-preferences.md`, `Harness/memory/agent-lessons-patterns.md` | concise newest-first memory entry or no-op rationale |
| Need subagents | subagent, role pack, context, inject, return format, orchestrator | [subagents.md](subagents.md), [context-loading.md](context-loading.md), [dispatch.md](dispatch.md) | controller plan, role-specific context pack, dispatch pack |
| Need feature work | feature, implementation, TDD, test, review, closeout | [features/_template.md](features/_template.md), [agent-workflow.md](agent-workflow.md) | feature doc, tests, implementation loop |
| Flow or failure behavior changes | data flow, event, failure, retry, recovery, caller behavior | [data-flow.md](data-flow.md) | happy path, failure path, caller behavior |
| Stateful behavior changes | state, transition, guard, illegal transition, state machine | [state-machines.md](state-machines.md) | states, transitions, illegal transitions |
| Review or release check | review, release, finding, risk, evidence, verification | [agent-workflow.md](agent-workflow.md), current feature doc | findings, verification evidence |
| Harness readiness check | validate, readiness, placeholder, missing file, release gate | `Harness/scripts/validate-harness.mjs`, `Harness/scripts/validate-harness.mjs --strict` | missing files and unresolved project placeholders |
| Need harness update | update, /wf update, check for updates, harness version | `.claude/skills/wf-update/SKILL.md`, `Harness/.harness-version` | update plan, safe incremental update, merge candidates |

## Gates

- Move phases in order unless the user asks for a fast lane.
- Use `/wf <task>`, `/wf-max [task]`, `wf mode`, `workflow mode`, or `wk mode` when a task is long, difficult, uncertain, multi-file, or repeatedly failing.
- Do not code before the PRD has MVP, non-goals, and acceptance criteria.
- Do not cross a layer boundary without reading `domain/ports.md` and updating architecture or ports.
- Before adding failure paths, read `data-flow.md`.
- Before modifying stateful components, read `state-machines.md`.
- Unsure whether to open a feature doc? Read `agent-workflow.md` Section 1.
- Do not spawn a subagent without a role, read boundary, write boundary, and return contract.
- Do not run writing agents in parallel unless write sets are disjoint.
- Before coordinating multiple agents, fill `Harness/tasks/<task-id>/PLAN.md#Subagent Dispatch` and follow `subagents.md` plus `dispatch.md`; if the work also matches WF triggers, enter WF mode first.
- In WF mode, update `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` before long commands, after failures, and at closeout.
- In WF Max mode, never dispatch two implementers with overlapping file claims. Verify disjointness before each wave.
- Do not add stack-specific agents or skills without following `extension.md`.
- Do not close work without tests or recorded manual verification.
- Do not mark work `Verified` until evidence is recorded in the current task's `tasks/<id>/PROGRESS.md` and `tasks/<id>/PLAN.md` or the feature doc.
- Run `node Harness/scripts/validate-harness.mjs` for scaffold structure; run `node Harness/scripts/validate-harness.mjs --strict` after bootstrap and before release.
- If a doc still has `{{...}}`, treat that section as a template, not project fact.

## Doc Map

```text
Harness/README.md                  router only
Harness/MEMORY.md                  resource index
Harness/PROGRESS.md                global task index and cross-task decisions
Harness/tasks/<id>/PROGRESS.md     per-task progress, phase, heartbeat
Harness/tasks/<id>/PLAN.md         per-task implementation plan and evidence
Harness/tasks/_template/           task capsule template (copy to create new task)
Harness/WF.md                      long-task workflow and recovery loop
Harness/WF-MAX.md                  max-parallelism workflow with wave dispatch
.claude/skills/wf-max/SKILL.md     max-parallelism skill loader
.claude/commands/wf-max.md         /wf-max slash command bridge
.claude/commands/learn.md          /wf-learn slash command bridge
Harness/lifecycle.md               0-1 product flow
Harness/subagents.md               controller-led subagent orchestration
Harness/context-loading.md         dynamic loading and subagent packs
Harness/dispatch.md                lightweight parallel dispatch protocol
Harness/extension.md               stack-specific asset contract
Harness/agent-workflow.md          build/review/test loop
Harness/architecture.md            layer boundaries
Harness/data-flow.md               runtime/failure paths
Harness/state-machines.md          state transitions
Harness/domain/ports.md            cross-layer contracts
Harness/features/_template.md      feature work packet
Harness/research/README.md         research protocol
Harness/research/PRD.md            product scope
Harness/research/research-results.md research results
Harness/workflows/*.md             optional workflow evidence rules (if installed)
Harness/memory/tool-usage-reflections.md repeated tool failures and better command patterns
Harness/memory/user-corrections-preferences.md durable user corrections and preferences
Harness/memory/agent-lessons-patterns.md reusable review/debug lessons
Harness/scripts/validate-harness.mjs lightweight harness gate
.claude/agents/*                   built-in common agents
.claude/skills/*                   skill-style dynamic loaders
.claude/skills/readme-optimizer/SKILL.md README preservation and optional structure pass
.claude/commands/wf.md             slash command bridge into wf-mode
.claude/skills/wf-update/SKILL.md   GitHub-based harness update
.claude/commands/update.md           /wf update slash command bridge
Harness/.harness-version             scaffold version and file checksums
```
