# {{projectName}} - Harness Router

Purpose: route humans and agents to the smallest useful context.

Default load: `CLAUDE.md`, `MEMORY.md`, this file, and `docs/harness/PLAN.md` when work is active. Do not read the whole docs tree.

## 0-1 Flow

```text
Idea -> Research -> PRD -> Architecture -> Plan -> Build -> Verify -> Feedback
```

For the full phase contract, load [harness/lifecycle.md](harness/lifecycle.md).

## Development Contract

- This file is a router, not a full spec.
- If the task does not clearly match a row below, search by keywords before loading more docs.
- project files are the only durable communication channel; chat/subagent transcript state is non-authoritative.
- Important assumptions, decisions, blockers, evidence, and handoffs must be written to [harness/PLAN.md](harness/PLAN.md), the current feature doc, `MEMORY.md`, or `memory/*` as appropriate.
- Core rules live in `CLAUDE.md` and `.claude/rules/ecc/common.md`.
- Phase rules live in [harness/lifecycle.md](harness/lifecycle.md).
- Build, review, test, and subagent rules live in [harness/agent-workflow.md](harness/agent-workflow.md).
- Parallel dispatch rules live in [harness/dispatch.md](harness/dispatch.md).
- Extension rules live in [harness/extension.md](harness/extension.md).
- Context-loading rules live in [harness/context-loading.md](harness/context-loading.md).
- Progress lives in [harness/PLAN.md](harness/PLAN.md) and the current feature doc.

## Keyword Routing

Use this only when the task is ambiguous or the matching row is unclear.

1. Extract 2-5 concrete keywords from the user request.
2. Search the project docs first:

```bash
rg -n "keyword1|keyword2|keyword3" CLAUDE.md MEMORY.md docs
```

3. Load only the top matching doc or the smallest matching doc pair.
4. If keyword search conflicts with the table below, follow the table and record the assumption in `docs/harness/PLAN.md`.

Keywords are retrieval hints, not project facts.

## Load By Task

Load the matching row only. Add adjacent docs only when the loaded doc directly names them.

| When to Read | Keywords | Load | Output |
| --- | --- | --- | --- |
| Raw idea or vague product request | idea, vague, clarify, goal, non-goal, lifecycle | [harness/lifecycle.md](harness/lifecycle.md), [research/PRD.md](research/PRD.md) | clarified goal, non-goals, first questions |
| Need market/tech direction | research, market, competitor, stack, library, pricing, policy | [research/README.md](research/README.md), [research/research-results.md](research/research-results.md) | research protocol, adopted/rejected choices |
| Need MVP/spec | PRD, MVP, scope, requirement, acceptance, non-goal | [research/PRD.md](research/PRD.md) | one-page PRD with verifiable acceptance criteria |
| Need architecture or boundaries | architecture, boundary, layer, domain, port, adapter, dependency | [harness/architecture.md](harness/architecture.md), [domain/ports.md](domain/ports.md) | layer map, ports, constraints |
| Adding harness to existing project | existing project, onboarding, migrate, bootstrap, preserve, conflict | [harness/extension.md](harness/extension.md), [harness/PLAN.md](harness/PLAN.md), root `README.md` and package/CI files | discovered project facts, preserved config, manual registration plan |
| Need implementation plan | plan, task, write set, verify, milestone, progress | [harness/PLAN.md](harness/PLAN.md), [harness/agent-workflow.md](harness/agent-workflow.md) | tasks, write set, verification commands |
| Need parallel agents | parallel, dispatch, handoff, write set, dependency, status | [harness/dispatch.md](harness/dispatch.md), [harness/context-loading.md](harness/context-loading.md), [harness/PLAN.md](harness/PLAN.md) | dispatch table, agent roles, read/write sets |
| Adding stack-specific agents/skills | extension, agent, skill, rule, hook, stack-specific, compatibility | [harness/extension.md](harness/extension.md), [harness/dispatch.md](harness/dispatch.md) | compatible agents, skills, rules, hooks |
| Optional workflow installed | workflow, optional, browser-e2e, ui-ux-review, github-pr-review, python-backend, ts-react-frontend | matching `docs/workflows/*.md`, [harness/extension.md](harness/extension.md) | workflow-specific evidence, commands, fallback path |
| Need durable memory or reflection | memory, remember, preference, correction, tool failure, lesson, reflection | `MEMORY.md`, `memory/tool-usage-reflections.md`, `memory/user-corrections-preferences.md`, `memory/agent-lessons-patterns.md` | concise newest-first memory entry or no-op rationale |
| Need subagents | subagent, role pack, context, inject, return format | [harness/context-loading.md](harness/context-loading.md) | role-specific context pack |
| Need feature work | feature, implementation, TDD, test, review, closeout | [features/_template.md](features/_template.md), [harness/agent-workflow.md](harness/agent-workflow.md) | feature doc, tests, implementation loop |
| Flow or failure behavior changes | data flow, event, failure, retry, recovery, caller behavior | [harness/data-flow.md](harness/data-flow.md) | happy path, failure path, caller behavior |
| Stateful behavior changes | state, transition, guard, illegal transition, state machine | [harness/state-machines.md](harness/state-machines.md) | states, transitions, illegal transitions |
| Review or release check | review, release, finding, risk, evidence, verification | [harness/agent-workflow.md](harness/agent-workflow.md), current feature doc | findings, verification evidence |
| Harness readiness check | validate, readiness, placeholder, missing file, release gate | `scripts/validate-harness.mjs`, `scripts/validate-harness.mjs --strict` | missing files and unresolved project placeholders |

## Gates

- Move phases in order unless the user asks for a fast lane.
- Do not code before the PRD has MVP, non-goals, and acceptance criteria.
- Do not cross a layer boundary without reading `domain/ports.md` and updating architecture or ports.
- Before adding failure paths, read `harness/data-flow.md`.
- Before modifying stateful components, read `harness/state-machines.md`.
- Unsure whether to open a feature doc? Read `harness/agent-workflow.md` Section 1.
- Do not spawn a subagent without a role, read boundary, write boundary, and return contract.
- Do not run writing agents in parallel unless write sets are disjoint.
- Before coordinating multiple agents, fill `harness/PLAN.md#Parallel Dispatch` and follow `harness/dispatch.md`.
- Do not add stack-specific agents or skills without following `harness/extension.md`.
- Do not close work without tests or recorded manual verification.
- Do not mark work `Verified` until evidence is recorded in `harness/PLAN.md` or the feature doc.
- Run `node scripts/validate-harness.mjs` for scaffold structure; run `node scripts/validate-harness.mjs --strict` after bootstrap and before release.
- If a doc still has `{{...}}`, treat that section as a template, not project fact.

## Doc Map

```text
docs/README.md                  router only
docs/harness/PLAN.md            active execution plan
docs/harness/lifecycle.md       0-1 product flow
docs/harness/context-loading.md dynamic loading and subagent packs
docs/harness/dispatch.md       lightweight parallel dispatch protocol
docs/harness/extension.md      stack-specific asset contract
docs/harness/agent-workflow.md  build/review/test loop
docs/harness/architecture.md    layer boundaries
docs/harness/data-flow.md       runtime/failure paths
docs/harness/state-machines.md  state transitions
docs/domain/ports.md            cross-layer contracts
docs/features/_template.md      feature work packet
docs/research/README.md         research protocol
docs/research/PRD.md            product scope
docs/research/research-results.md research results
memory/tool-usage-reflections.md repeated tool failures and better command patterns
memory/user-corrections-preferences.md durable user corrections and preferences
memory/agent-lessons-patterns.md reusable review/debug lessons
scripts/validate-harness.mjs    lightweight harness gate
.claude/agents/*                built-in common agents
.claude/skills/*                skill-style dynamic loaders
```
