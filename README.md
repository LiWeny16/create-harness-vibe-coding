<p align="center">
  <img src="https://img.shields.io/npm/v/create-harness-vibe-coding?color=blue" alt="npm version">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node">
  <img src="https://img.shields.io/npm/l/create-harness-vibe-coding" alt="license">
  <img src="https://img.shields.io/github/stars/zingspark/create-harness-vibe-coding?style=social" alt="stars">
</p>

<h1 align="center">create-harness-vibe-coding</h1>
<p align="center">
  <b>0-1 product harness scaffold for AI-assisted engineering.</b><br>
  <sub>Idea -> Research -> PRD -> Architecture -> docs/harness/PLAN.md -> Build -> Verify -> Feedback.</sub>
</p>

---

## One Command

```bash
npx create-harness-vibe-coding@latest my-project
```

| What You Get | Purpose |
|-------------|---------|
| `CLAUDE.md` + `docs/README.md` | Short entry and dynamic doc router |
| `docs/harness/PLAN.md` | Active execution state for multi-step work |
| Research + PRD templates | Clarify idea, scope, non-goals, acceptance criteria |
| Research protocol | Route research agents, source search, and fallback tools |
| Built-in common agents | Research, planning, architecture, testing, implementation, debugging, review, verification |
| Harness architecture docs | Boundaries, ports, data flow, state machines |
| Dispatch protocol | Lightweight parallel-agent coordination without a scheduler |
| Extension contract | Keep stack-specific agents and skills compatible |
| Context-loading protocol | Inject only the right docs into each subagent |
| Skill-style loaders | `.claude/skills/*` route lifecycle, context, and build loops |
| Harness validator | Checks required files and unresolved project placeholders |
| `.claude/` skeleton | Built-in common agents plus room for stack-specific assets |

---

## Why This Exists

Most 0-1 AI coding projects fail before code quality matters:

| Without Harness | With This Scaffold |
|---|---|
| Idea jumps straight to code | lifecycle forces research, PRD, and scope |
| Agent reads too much context | docs router loads only the needed harness file |
| Subagents get vague prompts | context-loading packs define role, boundaries, and return format |
| Process drift is invisible | validator checks core harness readiness |
| Architecture drifts silently | ports, data-flow, and state docs mark boundary changes |
| Tests come after implementation | workflow requires failing test or manual check first |

---

## How It Works

```text
npx scaffold
-> Claude reads SETUP.md
-> docs router selects only needed harness docs
-> PRD/research/architecture/PLAN are filled
-> first vertical slice is built, tested, reviewed, and fed back
-> validator catches missing project facts before release
```

### Harness idea

The scaffold does not prebuild business code. It gives agents a compact process for turning an idea into a verified product slice.

---

## What's Inside

```
my-project/
├── CLAUDE.md              ← Short startup rules + context discipline
├── AGENTS.md              ← Coding agent entry
├── MEMORY.md              ← Cross-session resource index
├── SETUP.md               ← Temporary init guide (delete after setup)
├── .gitignore
├── docs/
│   ├── README.md          ← Dynamic doc router
│   ├── harness/
│   │   ├── PLAN.md               ← Active execution plan and handoffs
│   │   ├── lifecycle.md          ← 0-1 product flow
│   │   ├── context-loading.md    ← Subagent context packs
│   │   ├── dispatch.md           ← Lightweight parallel-agent protocol
│   │   ├── extension.md          ← Stack-specific agent/skill contract
│   │   ├── architecture.md       ← Layer rules, components, ADRs
│   │   ├── agent-workflow.md     ← TDD loop, subagent roles, write sets
│   │   ├── data-flow.md          ← Event lifecycle: normal + failure paths
│   │   └── state-machines.md     ← State enums, transition tables, guards
│   ├── domain/
│   │   └── ports.md              ← Port contracts: pre/postconditions, errors
│   ├── features/
│   │   └── _template.md          ← Kiro-lite feature doc template
│   └── research/
│       ├── README.md             ← Research-agent protocol and tool fallbacks
│       ├── PRD.md                ← MVP scope & acceptance template
│       └── research-results.md   ← Tech research results and decisions
├── scripts/
│   └── validate-harness.mjs      ← Lightweight harness readiness check
├── .claude/
│   ├── settings.json     ← Base permissions
│   ├── agents/           ← Built-in common agents + stack-specific agents later
│   ├── skills/           ← Harness loaders + stack-specific skills
│   ├── hooks/            ← Configure automation after stack choice
│   └── rules/ecc/
│       └── common.md     ← Universal coding rules
└── tests/                ← Your test suite goes here
```

---

## Ecosystem Compatibility

| Platform | Fit |
|----------|-----|
| Claude Code | Native `CLAUDE.md`, `.claude/settings.json`, agents, skills, hooks |
| Codex / Cursor / Gemini CLI | Works as docs-first process scaffold |
| ECC / Superpowers / toolboxes | Optional source for stack-specific agents, skills, and rules |

---

## Usage

### Human

```bash
# Interactive mode — prompts for project name and directory
npx create-harness-vibe-coding@latest
```

### Agent / CI/CD

Agents and automation can skip all prompts with `-y`:

```bash
# One-liner with defaults (project name = my-vibe-project)
npx create-harness-vibe-coding@latest -y

# Named project, auto directory
npx create-harness-vibe-coding@latest my-app -y

# Named project, explicit directory
npx create-harness-vibe-coding@latest my-app ./dist/my-app -y
```

| Flag | Purpose |
|------|---------|
| `-y`, `--yes` | Skip all prompts. Uses positional args or defaults. |
| `-h`, `--help` | Print usage and exit. |

> [!TIP]
> Agents should always pass `-y` to avoid hanging on interactive prompts.
> If the agent needs to discover the CLI surface first, run with `--help`.

### After scaffolding, tell Claude:

```
"Read SETUP.md. Bootstrap this project from idea to first vertical slice."
"Read SETUP.md. This is a React TypeScript SaaS idea. Clarify PRD first, then plan the first slice."
"Read SETUP.md. This is a Python data product. Research the stack, define the MVP, then create docs/harness/PLAN.md."
```

---

## Footprint

| Metric | Value |
|--------|-------|
| Runtime after scaffold | none |
| Dependencies | 2 (`@clack/prompts`, `picocolors`) |
| Node requirement | >= 18 |
| Generated code | none until the product stack is chosen |

---

## Contributing

PRs welcome. The template docs live in `templates/common/` — edit them to change what gets scaffolded.

---

## License

MIT © [zingspark](https://github.com/zingspark)
