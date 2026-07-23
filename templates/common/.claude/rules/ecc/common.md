---
description: "Universal harness constraints"
alwaysApply: true
---

# Universal Rules

## Context

- Start with `CLAUDE.md`. When `Harness/` exists, also read `Harness/memory/startup-hints.md` (L2 lightweight digest, not full router).
- When the user explicitly invokes a `/wf-*` workflow command, excluding `/wf-help` and `/wf-update`, load `Harness/MEMORY.md` and `Harness/README.md`.
- For simple single-step tasks without `/wf-*`, operate in direct mode: skip the Harness router and execute directly.
- Do not bulk-read `Harness/`. Load by router trigger.
- Keep `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md` current when work has multiple steps, files, or agents.
- project files are the only durable communication channel. chat/subagent transcript state is non-authoritative.
- Important assumptions, decisions, blockers, evidence, and handoffs must be written to `Harness/tasks/<task-id>/PROGRESS.md`, `Harness/tasks/<task-id>/PLAN.md`, the current feature doc, `Harness/MEMORY.md`, or `Harness/memory/*` as appropriate.

## Verification

- Define acceptance criteria before implementation.
- New behavior: failing test first, or a written manual check if automation is not feasible yet.
- Bug fix: reproduction first.
- Before release, add CI for the chosen stack and run the full verification path.

## Low-Noise Progress

- Match the user's language for user-facing prose. Use the latest user message's dominant language unless the user asks otherwise; preserve code, commands, file paths, logs, and quoted source text exactly.
- Keep intermediate user updates to 1-2 short sentences.
- Do not recap plans, paste logs, or narrate obvious file reads while working.
- Put the detailed summary in the final response: files changed, verification, risks, and commit hash when relevant.
- During long-running work, report only phase changes, blockers, failed commands, or user decisions needed.

## Subagents

- Use `Harness/specs/runtime/subagents.md` before orchestrating multiple agents.
- Use `Harness/specs/runtime/context-loading.md` before spawning.
- Use `Harness/specs/runtime/dispatch.md` before parallel or multi-agent work.
- Use `Harness/specs/guides/extension.md` before adding stack-specific agents, skills, or rules.
- Every subagent needs role, task, read boundary, write boundary, and return format.
- Writing agents must run serially unless write sets are disjoint.
- If the runtime cannot spawn subagents, emulate the same role pack in a separate bounded pass.
- Main agent owns integration and final verification.

## Memory

- Detect memory candidates when user says: `remember`, `next time`, `don't`, `do not`, `never`, `always`, `I prefer`, `I want you to`, `记住`, `下次`, `以后`, `不要再`, `总是`, `永远不要`, `我偏好`, `我希望你以后`.
- Explicit user preference that is clear, safe, and scoped can be written to L3 immediately without waiting for `/wf-learn`.
- Use `Harness/memory/routes.md` for deterministic route matching before loading detailed L3 memory.
- Record a lightweight reflection in `Harness/memory/tool-usage-reflections.md` when the same tool/use pattern fails 3+ times.
- Record repeated user corrections or durable preferences in `Harness/memory/user-corrections-preferences.md` when the user corrects the same assumption/pattern 2+ times.
- Record reusable review/debug lessons in `Harness/memory/agent-lessons-patterns.md`.
- Never record task logs, process summaries, one-time emotions, transient notes, raw logs, or secrets.
- Keep memory entries compact and default to no date; only add date/timestamp for superseded, conflicting, or time-sensitive entries.

## Security

- No secrets in source code.
- Validate external input at system boundaries.
- High-risk actions need explicit user approval or documented permission policy.
