---
name: wf-max
description: Use for /wf-max in Claude Code, $wf-max or /skills wf-max in Codex. WF-MAX is explicit only — the user must type /wf-max, $wf-max, or /skills wf-max.
---

# WF-MAX Adapter

The authoritative workflow lives in `Harness/specs/workflows/WF-MAX.md`; this adapter only
routes and summarizes hard constraints.

## Invocation

- Claude Code: `/wf-max [task]`
- Codex: `$wf-max` or `/skills` then choose `wf-max`

## Memory Preflight

1. Direct simple tasks and `/wf-help` are exempt.
2. For non-direct work, load `CLAUDE.md`, `Harness/MEMORY.md` index only, then `Harness/README.md` before planning, dispatch, edits/deletes, validation, or peer review.
3. Load `Harness/memory/*` only when `MEMORY_PROTOCOL.md` scenario hints match; otherwise record "memory hints: none".

## Load

1. `CLAUDE.md`
2. `Harness/MEMORY.md` (index only per Memory Preflight)
3. `Harness/README.md`
4. `Harness/specs/workflows/WF-MAX.md`
5. `Harness/specs/runtime/subagents.md`
6. `Harness/specs/runtime/dispatch.md`
7. `Harness/specs/runtime/agent-workflow.md`

## Cache Discipline

Follow `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`: keep the
listed loads in order, defer unused skill/tool schemas, append volatile task
state and runtime facts last, and bound Worker returns through dispatch
`MaxReturnTokens`/`ReturnSchema`.

## Rules

WF-MAX inherits the selected WF tier and the shared WF-KERNEL gates
(`Harness/specs/workflows/WF-KERNEL.md`), then expands safe parallelism. WF-Max-Useful is
default; WF-Max-Strict only on explicit strict request. Execution expands
through:

- New task state directories MUST use task ids matching
  `task-<verb>-<noun>[-detail]` under `Harness/tasks/<task-id>/`; never
  create bare `fix-*` task ids.
1. Global mode: `wf-max`
2. Agent role: `ceo | manager | worker | reviewer | verifier | reflector`
3. Dispatch permission: `writeSet`, `forbidden`, `verification`

WF-Max-Useful (default): `/wf-max` fans out only where write sets or review
lenses are meaningfully independent. Overhead > 0.30 degrades the wave.
Degrading fan-out does not authorize CEO source edits; source implementation
still goes through an implementer/Worker role, or the run records an honest
downgrade before editing.

WF-Max-Strict (explicit override): user says `--strict`, `strict wf-max`, or
`strict mode`. Unconditional fan-out per the original span formula.

- CEO reads, plans, dispatches, synthesizes, and writes task state only. CEO
  never edits production source.
- Task-state updates must preserve required `Harness/PROGRESS.md` headings:
  `## Active Task`, `## Task Index`, and `## Cross-Task Decisions`.
- Workers edit only the dispatch `writeSet`; outside write set is blocked.
- Managers coordinate and synthesize. Reviewers read/report only.
- D-GATE is mandatory before implementation waves: dispatch table, AC IDs,
  disjoint file claims, self-audit, and reviewer plan.
- Final acceptance is tier-aware per `Harness/specs/workflows/WF-KERNEL.md`:
  - WF-Light + `/wf-max`: verification + state evidence suffices unless risk
    triggers review/reflector.
  - WF-Standard + `/wf-max`: verifier evidence + one independent review PASS.
  - WF-Full or risk-triggered `/wf-max`: cross-review PASS + reflector PASS.

## Fan-Out Discipline

- Use as many useful subagents as the runtime safely allows.
- Codex capacity may be configured through official `agents.max_threads` and
  `agents.max_depth`; generated Harness config defaults to
  `.codex/config.toml` with `max_threads = 12` and `max_depth = 1`.
- Close completed agents before declaring the pool exhausted.
- If Codex remains bottlenecked, ask the user before raising
  `agents.max_threads` above the scaffold default. Do not silently edit project
  or global Codex config.
- Keep `agents.max_depth = 1` unless the user explicitly approves recursive
  delegation.
- If the current runtime is exhausted, overflow to a peer CLI with explicit
  dispatch packets: `claude -p`, `codex exec`, or
  `opencode run --agent <role> --dir .`.
- Do not rely on undocumented config, environment variables, forked/derived
  conversations, Codex++, local patches, or third-party forks as stable ways to
  remove subagent limits.
- Fall back to bounded role passes only when native subagents and cross-CLI
  overflow are unavailable; record the fallback in the task PLAN.
