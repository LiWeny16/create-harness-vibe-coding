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

## Architecture Research (Dynamic)

Do not guess the architecture. Use `docs/research/README.md` as the protocol and the high-star repos below as seed references. Search within them; do not read them whole.

### Seed Repositories (High-Star, High-Trust)

| Repository | Stars | Use For |
|-----------|-------|---------|
| [donnemartin/system-design-primer](https://github.com/donnemartin/system-design-primer) | 266k+ | System design fundamentals, trade-off frameworks |
| [ByteByteGoHq/system-design-101](https://github.com/ByteByteGoHq/system-design-101) | 65k+ | Visual system design, protocol/DB patterns |
| [DovAmir/awesome-design-patterns](https://github.com/DovAmir/awesome-design-patterns) | 47k+ | General arch, cloud, serverless, microservices, front-end, security |
| [mehdihadeli/awesome-software-architecture](https://github.com/mehdihadeli/awesome-software-architecture) | high | CQRS, Outbox, Saga, Circuit Breaker, BFF, scaling |
| [greatfrontend/awesome-front-end-system-design](https://github.com/greatfrontend/awesome-front-end-system-design) | high | Front-end system design patterns |
| [adr.github.io](https://adr.github.io) | — | ADR templates and tooling |

### Architecture Fill Protocol

After research, fill these docs in order:

1. `docs/research/research-results.md` — Record candidate architectures with Adopt / Reject / Watch decisions. Use the `## Candidate References` template.
2. `docs/harness/architecture.md` — Fill the layering diagram, core components, and constraints. Do NOT add speculative layers. One layer per proven need.
3. `docs/domain/ports.md` — Define ONE driving port and ONE driven port from the first vertical slice. More ports come with more slices.
4. `docs/harness/data-flow.md` — Fill the happy path for the first slice only. Add failure paths when they differ from the happy path.

**Constraint**: If the research does not give you enough confidence to fill a section, leave the `{{...}}` placeholder and record the open question in `docs/harness/PLAN.md`. The strict validator will catch it.

## User Confirmation Protocol (Non-Negotiable)

> This harness is a design partner, not a solo builder. The user owns product intent.

When user intent is unclear or ambiguous:

- **Maximum 3 blocking questions per decision point.** Ask the highest-impact questions first.
- **Do not act on assumptions that affect architecture, scope, stack, or user-facing behavior.**
- **You must have ≥95% confidence before writing implementation code.** If below that threshold, stop and ask.
- **Record every assumption explicitly** in `docs/harness/PLAN.md` so the user can correct it later.
- **Silent picks are forbidden.** If two valid approaches exist and you cannot decide with high confidence, present both to the user with trade-offs.

False confidence is worse than a question. If you catch yourself thinking "this is probably what they want," stop and ask.

## How to Find Proper Skills

After the architecture stage reveals your stack, install matching agent skills. Skills teach Claude Code domain-specific patterns, testing conventions, and design rules.

**Built-in route**: invoke the `/find-skills` skill (or say "help me find skills for X"). Examples:

```text
"Find skills for React TypeScript frontend testing."
"Find skills for Python FastAPI backend development."
"What skills exist for Playwright e2e testing?"
"I need a skill for PostgreSQL schema design."
```

**Superpowers**: [Superpowers](https://github.com/obra/superpowers) is a community skill registry. Search it:

```bash
# If superpowers CLI or MCP is configured
npx skills search "react testing"
npx skills search "python api"
```

**Manual discovery**: search GitHub and npm directly using patterns from `docs/research/README.md#Architecture Decision References`.

**Priority order**:
1. `/find-skills` first — fastest discovery, respects your tool environment.
2. Superpowers registry — broad community coverage.
3. GitHub search — when the first two miss niche domains.

**What to install**: after finding skills, add them to `.claude/skills/<name>/SKILL.md`. Follow `docs/harness/extension.md` for compatibility. Start with 1-2 skills per stack area; more is not better.

This scaffold includes built-in harness skills (`.claude/skills/harness-*`). Keep those. Add stack-specific ones alongside them.

## Optional Agent Assets

After the product shape is known, Claude may also install or copy stack-specific agents, rules, and hooks into `.claude/`. Follow `docs/harness/extension.md` for every added asset.

Examples:

```text
This is a React TypeScript SaaS app. Add frontend testing and review agents.
This is a Python data product. Add data pipeline and pytest workflow agents.
This is a Go service. Add API, security, and integration-test agents.
```

## Cleanup (Isolate & Remove)

This file is designed to be orphaned. When all configuration is complete:

1. Open `CLAUDE.md`. Delete the line: `If SETUP.md exists in the project root, read it first.`
2. Delete this file.

```bash
rm SETUP.md
```

After both steps, `SETUP.md` is fully isolated — no file references it, no trace remains. You are free to delete it at any time. It is a bootstrap scaffold, not a permanent fixture.

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
