---
description: "Universal harness constraints"
alwaysApply: true
---

# Universal Rules

## Context

- Start with `CLAUDE.md`, `MEMORY.md`, and `docs/README.md`.
- Do not bulk-read `docs/`. Load by router trigger.
- Keep `docs/harness/PLAN.md` current when work has multiple steps, files, or agents.
- project files are the only durable communication channel. chat/subagent transcript state is non-authoritative.
- Important assumptions, decisions, blockers, evidence, and handoffs must be written to `docs/harness/PLAN.md`, the current feature doc, `MEMORY.md`, or `memory/*` as appropriate.

## Verification

- Define acceptance criteria before implementation.
- New behavior: failing test first, or a written manual check if automation is not feasible yet.
- Bug fix: reproduction first.
- Before release, add CI for the chosen stack and run the full verification path.

## Subagents

- Use `docs/harness/context-loading.md` before spawning.
- Use `docs/harness/dispatch.md` before parallel or multi-agent work.
- Use `docs/harness/extension.md` before adding stack-specific agents, skills, rules, or hooks.
- Every subagent needs role, task, read boundary, write boundary, and return format.
- Writing agents must run serially unless write sets are disjoint.
- If the runtime cannot spawn subagents, emulate the same role pack in a separate bounded pass.
- Main agent owns integration and final verification.

## Memory

- Record a lightweight reflection in `memory/tool-usage-reflections.md` when the same tool/use pattern fails 3+ times.
- Record repeated user corrections or durable preferences in `memory/user-corrections-preferences.md` when the user corrects the same assumption/pattern 2+ times.
- Record reusable review/debug lessons in `memory/agent-lessons-patterns.md`.
- Keep memory entries concise and never include secrets.

## Security

- No secrets in source code.
- Validate external input at system boundaries.
- High-risk actions need explicit user approval or documented permission policy.
