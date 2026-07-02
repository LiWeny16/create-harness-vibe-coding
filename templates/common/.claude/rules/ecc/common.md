---
description: "Universal harness constraints"
alwaysApply: true
---

# Universal Rules

## Context

- Start with `CLAUDE.md`, `Harness/MEMORY.md`, and `Harness/README.md`.
- Do not bulk-read `Harness/`. Load by router trigger.
- Keep `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md` current when work has multiple steps, files, or agents.
- project files are the only durable communication channel. chat/subagent transcript state is non-authoritative.
- Important assumptions, decisions, blockers, evidence, and handoffs must be written to `Harness/tasks/<task-id>/PROGRESS.md`, `Harness/tasks/<task-id>/PLAN.md`, the current feature doc, `Harness/MEMORY.md`, or `Harness/memory/*` as appropriate.

## Verification

- Define acceptance criteria before implementation.
- New behavior: failing test first, or a written manual check if automation is not feasible yet.
- Bug fix: reproduction first.
- Before release, add CI for the chosen stack and run the full verification path.

## Subagents

- Use `Harness/subagents.md` before orchestrating multiple agents.
- Use `Harness/context-loading.md` before spawning.
- Use `Harness/dispatch.md` before parallel or multi-agent work.
- Use `Harness/extension.md` before adding stack-specific agents, skills, or rules.
- Every subagent needs role, task, read boundary, write boundary, and return format.
- Writing agents must run serially unless write sets are disjoint.
- If the runtime cannot spawn subagents, emulate the same role pack in a separate bounded pass.
- Main agent owns integration and final verification.

## Memory

- Record a lightweight reflection in `Harness/memory/tool-usage-reflections.md` when the same tool/use pattern fails 3+ times.
- Record repeated user corrections or durable preferences in `Harness/memory/user-corrections-preferences.md` when the user corrects the same assumption/pattern 2+ times.
- Record reusable review/debug lessons in `Harness/memory/agent-lessons-patterns.md`.
- Keep memory entries concise and never include secrets.

## Security

- No secrets in source code.
- Validate external input at system boundaries.
- High-risk actions need explicit user approval or documented permission policy.
