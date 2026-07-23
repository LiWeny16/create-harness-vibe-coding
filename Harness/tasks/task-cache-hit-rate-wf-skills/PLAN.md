# task-cache-hit-rate-wf-skills - PLAN

Compact task record. Keep only facts needed to resume, review, and verify.

## Goal

- Outcome: Understand agent token-saving and prompt-cache hit-rate principles from GitHub/web research, then embed a cache-first contract into the WF command family and skills framework so repeated agent turns reuse stable context more often.
- Non-goals: Do not add provider-specific runtime APIs, background hooks, telemetry services, or broad architecture rewrites. Do not change user-facing workflow semantics beyond context-loading discipline.

## Decisions

- Tier: WF-Standard.
- Subagents: current Codex surface exposes no native subagent tool here; use bounded role passes and record role coverage per `subagent-orchestrator`.
- Tavily: required CLI is not installed and the linked `tavily-cli` local skill is missing; bash is unavailable on this Windows host. Use the built-in web search tool and record this limitation.
- Scope both generator templates and dogfood runtime mirrors because this repo dogfoods generated Harness files.

## Acceptance

- AC-001: Research evidence from current web search and GitHub repositories identifies concrete token-saving and cache-hit-rate principles for coding agents.
- AC-002: WF docs, command wrappers, and skill adapters define and route through a concise cache-first context contract: stable prefix, dynamic suffix, lazy tool/skill loading, bounded returns, and compact task-state writes.
- AC-003: Validation proves changed generated/runtime mirrors are consistent and no harness structural checks regress.

## Scope

Allowed write set:
- `Harness/tasks/task-cache-hit-rate-wf-skills/*`
- `Harness/PROGRESS.md`
- `Harness/WF.md`
- `Harness/WF-KERNEL.md`
- `Harness/WF-MAX.md`
- `Harness/WF-AUTO.md`
- `Harness/WF-AUTO-SPARK.md`
- `Harness/context-loading.md`
- `Harness/subagents.md`
- `.claude/skills/*/SKILL.md`
- `.agents/skills/*/SKILL.md`
- `.opencode/commands/wf*.md`
- `templates/common/CLAUDE.md`
- `templates/common/Harness/*.md`
- `templates/common/.claude/skills/*/SKILL.md`
- `templates/common/.agents/skills/*/SKILL.md`
- `templates/common/.opencode/commands/wf*.md`
- `templates/common/Harness/scripts/validate-harness.mjs`
- `Harness/scripts/validate-harness.mjs`
- `tests/validate-harness.test.js`
- `tests/generator.test.js`

Forbidden:
- Homepage task source (`docs/index.html`) and unrelated active task files.
- Optional workflow internals unless a mirror or validator requires them.
- Provider SDK implementation or network service code.
- Truth files outside this task unless a Change Request is recorded.

## Memory Preflight

- Memory preflight: done
- Memory hints: none

## Context

- Loaded: `CLAUDE.md`, `Harness/memory/startup-hints.md`, `Harness/MEMORY.md`, `Harness/README.md`, `Harness/PROGRESS.md`, `Harness/WF.md`, `Harness/WF-KERNEL.md`, `Harness/subagents.md`, `Harness/dispatch.md`, `Harness/context-loading.md`, `Harness/agent-workflow.md`, active previous task state.
- Assumptions: Cache-hit-rate improvements should be instruction/layout changes in the Harness framework, not a new provider API layer.

## Agents

| Role | Read / Write Set | Result |
|------|------------------|--------|
| researcher | Read: web + GitHub search results. Write: none. | Complete |
| codebase-explorer | Read: WF docs, skills, commands, validators. Write: none. | Complete |
| planner/test-writer | Read: ACs + existing test suite. Write: PLAN suggestions only. | Complete |
| implementer | Read: accepted plan. Write: allowed write set only. | Complete |
| reviewer | Read: diff + ACs + evidence. Write: none. | Complete; external CLI review degraded, same-runtime pass found no high/critical findings |
| verifier | Read: changed files + commands. Write: none. | Complete |

## Verification

- [x] Research source matrix recorded in PROGRESS.
- [x] `node Harness/scripts/validate-harness.mjs`
- [x] `npm run check:mirrors`
- [x] `node scripts/build-version.mjs --check`
- [x] `node --test tests/validate-harness.test.js tests/generator.test.js`
- [x] `npm test`
- [x] Review pass records AC coverage and L2 telemetry caveat.

## Risks

- Putting long cache theory into hot-path docs would reduce net savings; keep hot-path rules compact and move rationale to task state or non-hot docs.
- Over-specifying provider details could age badly; keep provider-specific facts in research evidence, not startup instructions.

## Expanded Contracts

### Validation Matrix

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
| AC-001 | Pass | Research source matrix in PROGRESS | Official OpenAI/Anthropic/GitHub docs plus GitHub repos/issues and arXiv paper |
| AC-002 | Pass | Runtime/template docs, skills, OpenCode wrappers, validator | Adds stable prefix, dynamic suffix, lazy loading, bounded return discipline, compact writes |
| AC-003 | Pass | Validation commands in PROGRESS | Local checks prove structure/mirror/test coverage only; real cache-hit claims require provider telemetry |
