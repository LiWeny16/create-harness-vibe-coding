# MEMORY.md — {{projectName}} Project Resource Index

> The project fact source is reached via `CLAUDE.md -> docs/README.md`. This file persists cross-session context: resource index, user preferences, tool usage standards.

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

## User Mem

> User preferences, habits, corrections. Written by CLAUDE.md §5.1 triggers, newest first.
> No entries yet — awaiting first "remember…" instruction.

## Tool Usage Standards

> Claude Code self-learning: high-frequency tool/MCP/skill pitfalls, alternatives, common error fix templates.
> Written by CLAUDE.md §5.2 triggers.
> No entries yet — awaiting first auto-discovery.
