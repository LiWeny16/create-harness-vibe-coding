# SETUP.md - Bootstrap This Product Harness

Temporary file. Delete after the first vertical slice is verified.

## What This Is

This scaffold is a 0-1 product harness:

- short agent entry files
- dynamic docs router
- PRD, research protocol, architecture, ports, data-flow, state templates
- active `docs/harness/PLAN.md`
- built-in common agents
- subagent context-loading protocol
- skill-style dynamic loaders in `.claude/skills/`
- lightweight harness validator
- test/review/feedback loop

It does not guess your stack or business domain. Claude Code should fill those through the lifecycle.

## Bootstrap Prompt

Start Claude Code, then say:

```text
Read SETUP.md. Bootstrap this project as a 0-1 product harness.
Use docs/README.md as the router. Keep context small.
First clarify the idea, then create PRD, research, architecture, docs/harness/PLAN.md, and the first vertical-slice task.
```

## Required Bootstrap Sequence

Claude must follow this order:

1. Read `CLAUDE.md`, `MEMORY.md`, `docs/README.md`, and `docs/harness/lifecycle.md`.
2. Ask up to 3 blocking product questions. If not blocked, record assumptions in `docs/harness/PLAN.md`.
3. Fill `docs/research/PRD.md` with MVP, non-goals, and acceptance criteria.
4. Read `docs/research/README.md`, then fill `docs/research/research-results.md` with adopted/rejected research choices.
5. Fill minimum architecture: `docs/harness/architecture.md` and one port in `docs/domain/ports.md`.
6. Create the first vertical-slice plan in `docs/harness/PLAN.md`.
7. Use `docs/harness/context-loading.md` and `docs/harness/dispatch.md` when spawning subagents.
8. Fill `docs/harness/data-flow.md` or `docs/harness/state-machines.md` only when the slice changes runtime flow, failure behavior, or state.
9. Implement only after a failing test or manual verification step is defined.
10. Run `node scripts/validate-harness.mjs --strict`.
11. Record final verification and next feedback step in `docs/harness/PLAN.md`.

## Optional Agent Assets

This scaffold includes common research and workflow agents. After the product shape is known, Claude may install or copy more stack-specific agents, skills, rules, and hooks into `.claude/`. Follow `docs/harness/extension.md` for every added asset.

Examples:

```text
This is a React TypeScript SaaS app. Add frontend testing and review agents.
This is a Python data product. Add data pipeline and pytest workflow agents.
This is a Go service. Add API, security, and integration-test agents.
```

## Cleanup

After bootstrap succeeds:

```bash
rm SETUP.md
```

---

## For Agents (Self-Bootstrapping)

If you are an AI agent running `create-harness-vibe-coding` to scaffold your own project harness, use non-interactive mode:

```bash
npx create-harness-vibe-coding@latest <project-name> <target-dir> -y
```

Example:

```bash
npx create-harness-vibe-coding@latest my-agent-project ./my-agent-project -y
```

After scaffolding, bootstrap the harness yourself:

1. Read `CLAUDE.md`, `MEMORY.md`, and `docs/README.md`.
2. Follow the Required Bootstrap Sequence above.
3. Run `node scripts/validate-harness.mjs --strict` when done.
4. Delete `SETUP.md`.
