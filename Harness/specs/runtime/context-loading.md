# Context Loading Protocol

Use when context is growing, subagents are needed, or an agent is unsure which harness doc applies.

## Routing Authority

`CLAUDE.md` is the session entry router. `Harness/README.md` is the primary Harness documentation router. This file is a secondary context-splitting protocol for subagents and long tasks.

If this file and `Harness/README.md` disagree, follow `Harness/README.md`, record the assumption in `Harness/tasks/<task-id>/PROGRESS.md`, and update this file later.

project files are the only durable communication channel; chat/subagent transcript state is non-authoritative. Important assumptions, decisions, blockers, evidence, and handoffs must be written to `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md`, the current feature doc, `Harness/MEMORY.md`, or `Harness/memory/*` as appropriate.

## Context Tiers

These tiers are automatic route profiles, not user-selected modes. The agent
selects a profile from the explicit command, user request, active task state,
router row, skill trigger, and concrete file references.

Budgets are regression guards, not exclusion rules. If correctness requires a
file outside the current profile, load that file and record the reason in the
task notes/progress when the work is in WF. Do not skip required rules, source
files, contracts, tests, or evidence to stay under budget.

| Tier | When | Keep | Do Not Load |
| --- | --- | --- | --- |
| Thin startup | New installed-project session before task routing | `CLAUDE.md`, `Harness/memory/startup-hints.md` | `Harness/MEMORY.md`, `Harness/README.md`, `Harness/PROGRESS.md`, workflow docs, skill bodies |
| Direct task | Simple, single-step, low-risk request | `CLAUDE.md` plus only files needed for the task | full router, task capsules, unrelated Harness docs |
| Router prefix | Explicit `/wf-*`, `$wf-*`, or `/skills wf-*` command | `CLAUDE.md`, `Harness/MEMORY.md` index, `Harness/README.md`, `Harness/PROGRESS.md` only when active | unrelated workflow docs, all skills, all agents, unused tool schemas |
| Active task scope | Router found an active task | `STATE.json` first, then task `PROGRESS.md`, task `PLAN.md` only when decisions/scope need review, current feature doc when active | archived tasks, unrelated task directories, broad task history |
| Routed skill/doc | Router, command, or `tool_search` selects a specific capability | selected skill body and adjacent docs named by that skill/doc | all skill bodies, all tool schemas, whole `Harness/` tree |

After the tier is selected, load other docs only by trigger.

Escalation rule: when unsure whether a file is required, prefer targeted
keyword search or a one-file read over guessing from memory. Escalate from a
smaller profile to the next targeted profile only when the new file directly
proves or disproves the current decision.

## Cache-First Context Contract

Prompt-cache hit rate is a context-layout constraint. Preserve this order for
WF commands, skill adapters, and subagent packets:

1. Stable prefix: `CLAUDE.md`, `Harness/MEMORY.md` index, `Harness/README.md`,
   selected workflow docs, and stable skill/agent indexes in deterministic
   order.
2. Scoped references: task `STATE.json`, `PLAN.md`, contracts, selected source
   files, and selected docs only.
3. Dynamic suffix: newest user message, active question, current heartbeat,
   current date/time, cwd/runtime/model/channel, fresh search results, tool
   output, command logs, screenshots, and validation evidence.

Rules:

- Do not reorder stable loads during a task.
- Put volatile values after the stable prefix; do not place timestamps, request
  IDs, latest tool output, or fresh search results in startup/router text.
- Load skill bodies and tool schemas only when routed by the explicit command,
  `Harness/README.md`, or `tool_search`; do not preload all skills or tools.
- Keep dispatch packets deterministic: canonical field order, stable tool/skill
  list order, bounded `MaxReturnTokens`, and short `ReturnSchema`.
- Prefer file paths and compact task-state summaries over pasted logs or
  transcripts. Append-only `PROGRESS.md`/`STATE.json` beats rewritten summaries
  until compaction is required.
- Treat a model switch, reasoning/context-size change, enabled-tool/MCP change,
  or compaction as a cache boundary and record it in task progress.

## Cache Validation Levels

- **L0 structure**: `validate-harness.mjs` proves the Harness still preserves
  stable-prefix/dynamic-suffix routing, deferred skills/tools, and bounded
  summaries. This is regression protection only.
- **L1 prefix simulation**: compare two serialized dispatch/context packets and
  prove the stable prefix bytes are identical while only the dynamic suffix
  changes. Use this when a runtime exposes prompt assembly locally.
  Covered by `tests/l1-prefix-simulation.test.js` (positive match + negative
  controls + anti-pollution detection).
- **L2 provider telemetry**: prove real cache behavior from model response
  usage fields, such as OpenAI `cached_tokens` / `cache_write_tokens` or
  Anthropic `cache_read_input_tokens` / `cache_creation_input_tokens`, across a
  warm-up request and repeated same-prefix requests.
  For Claude Code scripted probes, use
  `node Harness/scripts/l2-cache-telemetry.mjs`; it records the exact CLI
  flags, session IDs, usage fields, cost, duration, and claim-gate result in
  `$HOME/.claude/cache-telemetry/`.

Do not claim real cache hits or hit-rate improvement from structure checks
alone. A real cache-hit claim requires L2 telemetry, or an explicit statement
that the current runtime does not expose provider cache metrics.

## Trigger Matrix

| Trigger | Load |
| --- | --- |
| idea, scope, MVP | `Harness/specs/guides/lifecycle.md`, `Harness/research/PRD.md`, `Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md` |
| acceptance, AC, criteria, contract, validation matrix | `Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md`, `Harness/specs/protocols/AGENT_ISOLATION.md`, `Harness/specs/protocols/HARNESS_BRIDGE.md` as needed |
| research, competitors, stack choice | `Harness/research/README.md`, `Harness/research/research-results.md` |
| task split, owner, write set | `Harness/tasks/<task-id>/PROGRESS.md`, `Harness/tasks/<task-id>/PLAN.md`, `Harness/specs/runtime/agent-workflow.md` |
| parallel agents, dispatch, worktree decision | `Harness/specs/runtime/subagents.md`, `Harness/specs/runtime/dispatch.md`, `Harness/tasks/<task-id>/PLAN.md` |
| `/wf` mode (explicit only) | [Harness/specs/workflows/WF.md](../workflows/WF.md), [Harness/specs/runtime/subagents.md](subagents.md), [Harness/specs/runtime/dispatch.md](dispatch.md), [Harness/tasks/<task-id>/PLAN.md](../../tasks/<task-id>/PLAN.md) |
| `/wf-max` (explicit only) | [Harness/specs/workflows/WF-MAX.md](../workflows/WF-MAX.md), [Harness/specs/runtime/subagents.md](subagents.md), [Harness/specs/runtime/dispatch.md](dispatch.md), [Harness/tasks/<task-id>/PLAN.md](../../tasks/<task-id>/PLAN.md) |
| memory, scenario memory, repeated tool failure, repeated user correction, reusable lesson | `Harness/MEMORY.md`, `Harness/specs/protocols/MEMORY_PROTOCOL.md`, the relevant `Harness/memory/*.md` file |
| subagent spawn | `Harness/specs/runtime/subagents.md`, `Harness/specs/protocols/AGENT_ISOLATION.md`, this file plus the role pack below |

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
