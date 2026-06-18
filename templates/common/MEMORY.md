# MEMORY.md - {{projectName}} Project Resource Index

> The project fact source is reached via `CLAUDE.md -> docs/README.md`. This file persists cross-session context: resource index, user preferences, tool usage standards.
> Detailed memory lives in `memory/`. Keep entries short, newest first, and free of secrets.

## Agents (Sub-agents)

- [researcher](.claude/agents/researcher.md) — product, market, open-source, dependency, pricing, policy, and ecosystem research.
- [docs-researcher](.claude/agents/docs-researcher.md) — official docs, API, SDK, config, limits, errors, and examples verification.
- [planner](.claude/agents/planner.md) — task split, dependencies, write sets, and dispatch table.
- [architect](.claude/agents/architect.md) — boundaries, ports, data-flow, and state impact.
- [test-writer](.claude/agents/test-writer.md) — failing tests or manual verification before implementation.
- [implementer](.claude/agents/implementer.md) — bounded implementation inside declared write set.
- [debugger](.claude/agents/debugger.md) — smallest fix for a reproduced failure.
- [reviewer](.claude/agents/reviewer.md) — read-only diff review and closeout risk.
- [verifier](.claude/agents/verifier.md) — verification commands and evidence.

Stack-specific agents can be added after the product shape is known.

## Skills (Workflows)

- [harness-router](.claude/skills/harness-router/SKILL.md) — start-of-task routing to the smallest useful doc set.
- [harness-lifecycle](.claude/skills/harness-lifecycle/SKILL.md) — idea, PRD, scope, lifecycle, and feedback loops.
- [harness-research](.claude/skills/harness-research/SKILL.md) — market, product, stack, dependency, API, and open-source research.
- [harness-context](.claude/skills/harness-context/SKILL.md) — context splitting, subagent packs, and dispatch preparation.
- [harness-build-loop](.claude/skills/harness-build-loop/SKILL.md) — implementation, debugging, review, verification, and closeout.

Stack-specific skills can be added after the product shape is known.

## Rules (Harness Constraints)

Located under `.claude/rules/ecc/`, auto-loaded by the CC engine:

- [common.md](.claude/rules/ecc/common.md) — universal harness constraints for context loading, verification, subagents, and security (alwaysApply: true)
- Language-specific rules pending Claude Code initialization (e.g. python.md, typescript.md, etc.)

## Harness (Runtime)

- [Active plan](docs/harness/PLAN.md)
- [Docs router](docs/README.md)
- [0-1 lifecycle](docs/harness/lifecycle.md)
- [Research protocol](docs/research/README.md)
- [Context loading protocol](docs/harness/context-loading.md)
- [Dispatch protocol](docs/harness/dispatch.md)
- [Extension contract](docs/harness/extension.md)
- [Architecture docs](docs/harness/architecture.md)
- [Agent workflow](docs/harness/agent-workflow.md)
- [Harness validator](scripts/validate-harness.mjs)

## Memory Folder

- [Tool usage/reflections](memory/tool-usage-reflections.md) - repeated tool failures, better command patterns, environment-specific fixes.
- [User corrections/preferences](memory/user-corrections-preferences.md) - repeated user corrections, durable preferences, common-sense course corrections.
- [Agent lessons/patterns](memory/agent-lessons-patterns.md) - reusable lessons from review, debugging, validation, and handoff loops.

Write to the memory folder when the guidance should survive chat context loss:

- Use `memory/tool-usage-reflections.md` when the same tool/use pattern fails 3+ times, a better command pattern is found, or an environment-specific fix should be reused.
- Use `memory/user-corrections-preferences.md` when the user explicitly asks to remember a preference, or the user corrects the same assumption/pattern 2+ times.
- Use `memory/agent-lessons-patterns.md` when a review/debug loop yields a reusable lesson or regression guard.
- Use `MEMORY.md` for the resource index and routing pointers, not long-form lessons.
- Never record secrets, credentials, tokens, or private data. If a memory is ambiguous, ask before writing.
