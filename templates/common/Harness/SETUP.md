# SETUP.md - Bootstrap This Product Harness

Temporary file. Delete after the first vertical slice is verified.

## What This Is

This scaffold is a 0-1 product harness:

- short agent entry files
- dynamic docs router
- Mini PRD, acceptance protocol, UI/API contracts, research protocol, architecture, ports, data-flow, state templates
- active `Harness/PROGRESS.md`
- `Harness/MEMORY.md` plus a `Harness/memory/` folder for durable self-learning, user corrections, and tool reflections
- built-in common agents
- subagent orchestration and context-loading protocol
- skill-style dynamic loaders in `.claude/skills/` for Claude Code and `.agents/skills/` for Codex
- lightweight harness validator
- acceptance/test/review/debug/memory loop

It does not guess your stack or business domain. The agent MUST detect or ask, then install the right ECC rules for the project.

## Bootstrap Prompt

Start Claude Code or Codex, then say:

```text
Read Harness/SETUP.md. Bootstrap this project as a 0-1 product harness.
Use Harness/README.md as the router. Keep context small.
First clarify the idea, then create Mini PRD, acceptance criteria, UI/API contracts, test plan, research, architecture, Harness/PROGRESS.md, the first per-task plan, and the first vertical-slice task.
```

## Required Bootstrap Sequence

Claude or Codex must follow this order during bootstrap. This sequence is broader than installation; if the user only asked to install/configure the harness in an existing project, follow the "Existing Project Fast Path" below and stop after the non-strict validator passes.

0. **ECC Stack Configuration** — Detect the project's tech stack. If the repo is empty or has no stack markers (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, `Gemfile`, `composer.json`, `build.gradle`, etc.), ask the user: "What's your tech stack? (language/framework)" Then install the matching ECC rule sets from `~/.claude/rules/ecc/`. See `Harness/ECC-GUIDE.md` for the stack→rules mapping. Minimum: always install `common/`. Verify with `ls .claude/rules/ecc/`.
1. Read `CLAUDE.md`, `Harness/MEMORY.md`, `Harness/README.md`, `Harness/lifecycle.md`, and `Harness/ACCEPTANCE_PROTOCOL.md`. Load `Harness/memory/*` only when the router or memory trigger applies.
2. Ask up to 3 blocking product questions. If not blocked, record assumptions in `Harness/tasks/<task-id>/PLAN.md`.
3. Fill `Harness/research/PRD.md` or the first task PLAN with Mini PRD fields: goal, scope, non-scope, user flow, UI elements, API behavior, acceptance criteria, and verification commands.
4. Read `Harness/research/README.md`, then fill `Harness/research/research-results.md` with adopted/rejected research choices.
5. Create AC IDs, UI/API contract tables, and a test plan before implementation. Use `Harness/templates/*` when helpful.
6. Fill `Harness/architecture.md`.
7. Create a task capsule from `Harness/tasks/_template/` and fill the first vertical-slice plan in `Harness/tasks/<task-id>/PLAN.md`.
8. Use `Harness/AGENT_ISOLATION.md`, `Harness/subagents.md`, `Harness/context-loading.md`, and `Harness/dispatch.md` when explicit WF/WK mode or any spawned subagents are involved.
9. Implement only after PRD-GATE, AC-GATE, CONTRACT-GATE, and TEST-GATE pass.
10. Independently validate with an AC-by-AC result matrix; use `Harness/HARNESS_BRIDGE.md` for browser/API/CDP flows.
11. For `/wf-auto` or memory scenario hints, read `Harness/WF-AUTO.md` and `Harness/MEMORY_PROTOCOL.md`; do not enable a background runner by default. The only allowed runtime hook is the optional `/wf-auto` bounded tick hook.
12. Run `node Harness/scripts/validate-harness.mjs --strict` after project-fact placeholders are resolved.
13. Record final verification and next feedback step in `Harness/tasks/<task-id>/PROGRESS.md`. If repeated tool failures, repeated user corrections, or reusable review/debug lessons appeared, record the concise reflection in the relevant `Harness/memory/` file.

## Install or Upgrade Path

Before writing, identify the project state:

| Project state | Required action |
| --- | --- |
| Empty or new project | Run the scaffold, then follow this file for 0-1 bootstrap |
| Existing project, no `Harness/` | Scan project facts first, run `--dry-run`, preserve existing files, merge only missing Harness guidance |
| Legacy architecture or older project docs | Treat existing code/docs as source of truth, dry-run first, then fill PRD, research, architecture, and task plans from observed facts |
| Existing `Harness/` | Do not use `npx` as an updater; ask whether to run `/wf-update`, `$wf-update`, `node Harness/scripts/wf-update-check.mjs`, keep untouched, or remove/reinstall after approval |

When adding this harness to a project that already has source code, docs, CI, or tool configuration, treat the existing project as the source of truth before filling harness docs.

### Existing Project Fast Path

Use this path when the user asks only to install or configure the harness in an existing project. Do not bootstrap PRD, research, architecture, or task capsules unless the user explicitly asks for bootstrap.

1. Get the machine-readable install report first with `npx create-harness-vibe-coding@latest <project-name> <target-dir> -y --dry-run --on-conflict skip --json`. Use `scan.markers` and `agent.aiMergeRequired` instead of hand-written root probes for install decisions. Do manual project-fact reading only after the script has created missing Harness files.
2. Run the JSON `agent.safeMergeCommand` to create only missing files.
3. Record discovered facts in the final install summary. Create or update task capsules only when bootstrap or multi-step implementation work begins.
4. Existing configuration is project fact. Do not overwrite `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.agents/`, `.codex/`, `.gitignore`, settings, package files, CI, docs routers, workflow docs, or installed skills/plugins/rules unless the user explicitly approves that exact overwrite.
5. When a harness file conflicts with an existing file, preserve the existing file and register any missing harness guidance manually using `Harness/extension.md`.
6. Run `node Harness/scripts/validate-harness.mjs` as the install-complete gate.
7. Defer `node Harness/scripts/validate-harness.mjs --strict` until bootstrap removes project-fact placeholders. If placeholders intentionally remain, report strict validation as deferred rather than treating install as failed.

`npx create-harness-vibe-coding` is an install/safe-merge entry, not an update engine for a project that already has an installed Harness. If `Harness/` already exists, use `/wf-update`, `$wf-update`, or `node Harness/scripts/wf-update-check.mjs`; root entry files and user-modified Harness docs require agent-mediated merge decisions.

### Agent-Link Install Intake

When the user installs by pasting the GitHub link into an agent, get the JSON install report before editing or asking generic questions. Do not fetch full template files or read package source until `agent.aiMergeRequired` names a file that needs semantic comparison. Summarize `scan.markers`, then ask only questions that affect writes, architecture, security, or workflow. Ask at most three blocking questions up front, record safe defaults for the rest, and ask follow-ups only when that choice becomes active.

| Topic | Ask When | Default If Unanswered |
| --- | --- | --- |
| Root agent entry | `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.agents/`, `.codex/`, or other agent entry files already exist | Preserve files; ask before merging the Harness entry contract |
| Existing Harness | `Harness/` already exists | Stop and ask whether to run `/wf-update`, dry-run merge missing files, keep it untouched, or remove/reinstall after approval |
| Harness location | Always | Use root `Harness/`; do not write harness docs into `docs/` |
| README ownership | root `README.md` is a public product page, package docs, or heavily customized | Preserve existing README and propose a minimal Development section |
| README optimization | existing README is stale, sparse, missing command tables, or the user asks for diagrams/polished docs | Offer `wf-readme`; default to append-only Development notes until the user approves a structure pass or full rewrite |
| Extensions | ECC, custom rules, or stack-specific skills may be useful | Scan installed skills/plugins/rules first; recommend only missing capabilities; install only after user approval |
| Optional capabilities | stack is known or the user wants setup guidance | Offer local workflows plus recommendation-only GitHub links: Superpowers, Caveman, agent research, and code graph; do not duplicate already-installed capabilities |
| Skills | stack is known and optional skills could improve testing, frontend, backend, review, or browser evidence | Install 1-2 relevant local workflows only after user approval |
| CI/CD | CI config exists or the project lacks a test/build gate | Document existing commands first; add CI/CD only after user approval |
| Verification depth | browser-visible, API, database, auth, payment, or deployment behavior is affected | Require real command evidence; require browser/API evidence when relevant |
| Memory/privacy | repo contains sensitive domain data, customer data, secrets, or private workflows | Enable memory index only; never record secrets or private data |
| Branch/worktree | project has uncommitted changes, risky migration, or parallel implementation lanes | Preserve current worktree; propose branch/worktree before broad edits |
| Package manager/stack | multiple package managers, monorepo apps, or unclear stack boundaries exist | Ask which workspace/app is in scope before writing |

### Agent Conflict Resolution Protocol

When `--on-conflict skip` leaves existing files untouched, the script still owns file creation and the agent resolves only the files named in `agent.aiMergeRequired`.

**Workflow:**

1. Run the harness tool in planning mode to get the conflict list:
   ```
   npx create-harness-vibe-coding@latest . . -y --dry-run --on-conflict skip --json
   ```
   Parse the JSON output. Files in `plan.create[]` are handled automatically by the script. If `agent.aiMergeRequired[]` is empty, do not read package source or templates; run the safe merge command from `agent.safeMergeCommand`.

2. For each file in `agent.aiMergeRequired[]`, use its `templateHint` to locate the harness template counterpart only when semantic comparison is needed:
   - From npm: `node_modules/create-harness-vibe-coding/<templateHint>`
   - From GitHub: `https://raw.githubusercontent.com/zingspark/create-harness-vibe-coding/main/<templateHint>`

3. For each skipped file:
   - Read the existing project file.
   - Read the harness template counterpart only for that file.
   - Compare sections and headings. Identify structural sections, registration entries, and required text patterns that exist in the template but are missing from the existing file.
   - If the skipped file is `CLAUDE.md`, tell the user that it is the root agent entry contract. Ask whether they consent to refactor or merge it before editing. Preserve project-specific rules while adding the Harness startup, memory, router, workflow, and subagent orchestration contract.
   - If the skipped file is `AGENTS.md`, tell the user that it is part of the root agent entry contract and ask whether they consent to merge or replace it before editing.
   - Present each gap to the user as a choice:
     - **[Merge]** — Edit the existing file to add only the missing sections. Preserve all existing content, ordering, and formatting.
     - **[Overwrite]** — Replace with the template version. Optionally backup the original first (`--on-conflict backup`).
     - **[Keep]** — Leave the existing file as-is. Skip this file.

4. For Merge: use targeted edits, not a full-file rewrite. In Codex, use `apply_patch` or an equivalent patch operation. Only insert sections, headings, and text that are structurally required. Do not reorder or modify existing content. Do not remove custom project-specific registrations. After merging `CLAUDE.md` or `AGENTS.md`, inspect the heading outline and remove duplicate headings or repeated bullets introduced by the merge.

5. After all install merges, run `node Harness/scripts/validate-harness.mjs`. Run `node Harness/scripts/validate-harness.mjs --strict` only after project-fact placeholders are resolved during bootstrap or release preparation.

**File-specific gap checklists:**

The harness validator checks for specific structural invariants. When comparing existing files against templates, verify these are present. Most other template content can vary; only the items below are required.

| File | Required check |
|------|----------------|
| `CLAUDE.md` | Must be merged only after user confirmation when it already exists. Required contract: `## 1. Harness Binding & Startup` with the `Harness/SETUP.md` bootstrap contract line; `## 6. Memory & Self-Learning` section; the tool reflection trigger text (`same tool/use pattern fails 3+ times`); the user correction trigger text (`user corrects the same assumption/pattern 2+ times`); `Never bulk-read Harness/` in Startup |
| `AGENTS.md` | Root agent entry points to `CLAUDE.md` and `Harness/README.md`; for existing projects, merge only after explicit user consent |
| `README.md` | Existing README is project-owned. Preserve by default; ask whether to append only Development notes or run `wf-readme` for a structure pass with tables/diagrams before broad edits |
| `Harness/MEMORY.md` | All common agents registered under `## Agents`; all common harness skills registered under `## Skills`; all 3 `Harness/memory/` files registered under `## Memory Folder`; `Harness/memory/` folder usage guidance; `Project Resource Index` in title |
| `.claude/rules/ecc/common.md` | Required project-local universal rules. Keep it even when global `~/.claude/rules/ecc/common/` exists; that directory and this file have different scopes. Required sections: `## Context` with the durable communication invariant (`project files are the only durable communication channel`); `## Memory` with three reflection file entries; `## Security` |
| `Harness/README.md` | `## Keyword Routing` heading; `## Load By Task` table with at minimum the rows: "Need WF mode (explicit only)", "Adding harness to existing project", "Need implementation plan", "Need parallel agents", "Need subagents", "Need durable memory or reflection"; WF routing keywords include `/wf`, `$wf`, `/skills wf`, `/wf-max`, `$wf-max`, `/skills wf-max`; explicit WF entry only — no auto-triggering from task complexity, failure count, or old aliases; `## Doc Map` with `memory/` and `subagents.md` entries; the durable communication invariant text; `Harness/README.md is the primary Harness documentation router` |
| `Harness/WF.md` | `WF is explicit only`; tier-aware contract: `WF-Light` (planner/test/verifier, no mandatory cross-review/reflector), `WF-Standard` (adds research + one review lens), `WF-Full` (complete role chain with cross-review + reflector PASS); `Collaboration tier guide`; `Heartbeat Protocol` |
| `Harness/WF-MAX.md` | `WF-MAX is explicit only`; `WF-Max-Useful` (default, fan-out only where independent); `WF-Max-Strict` (explicit strict override); three-layer architecture; D-GATE; span formula |
| `Harness/extension.md` | `## Non-Invasive Extension Rules` section with the "Preserve existing" rule; `## Agent Contract` section; `## Registration` section |
| `Harness/dispatch.md` | The durable communication invariant; registered common agent entries; `## Handoff Format` heading |
| `Harness/context-loading.md` | The durable communication invariant; `Harness/README.md is the primary Harness documentation router`; all 12 subagent context packs (Explorer Pass, Planner, Researcher, Docs Researcher, Architect, Test Writer, Implementer, Reviewer, Debugger, Verifier, Memory Master, Context Master) |
| `Harness/subagents.md` | `## Source Attribution`; `## Built-in Agent Roster`; `## WF Default Fan-Out`; `Controller Role`; `Efficiency Ladder`; `Review Gates`; `collaboration decision tree`; source markers for `npx skills find`, `dispatching-parallel-agents`, and `subagent-driven-development` |
| `Harness/architecture.md` | `## 2. Interface Decoupling`; `## 3. State Design`; `Avoid speculative abstraction`; layer constraints derived from actual project facts |
| `Harness/PROGRESS.md` | global task index with Active Task and task history; cross-task decisions |
| `Harness/tasks/<id>/PROGRESS.md` | `## Current Goal`, `## Phase`, `## Heartbeat`, `## Loaded Context` headings |
| `Harness/tasks/<id>/PLAN.md` | `## Tasks`, `## Parallel Dispatch`, `## Subagent Synthesis`, `## Verification` headings |
| `Harness/SETUP.md` | Temporary install/bootstrap guide for new projects, existing projects, legacy upgrades, and Harness update decisions. If kept, ensure "Install or Upgrade Path" is present. |
| `Harness/workflows/browser-e2e.md` (if installed as optional) | `data-testid`, `accessible labels/roles`, and `inputs, buttons, filters, rows, empty/error/loading states` requirement |
| `Harness/workflows/ts-react-frontend.md` (if installed as optional) | Same UI selector contract as above |

**Files that do NOT need manual merge when the path does not already exist (auto-created by harness):**

The generated file list is authoritative by path, not by stale count labels. Current common scaffolds include WF-MAX manager agents and `tdd-guide`; keep every file created by the scaffold unless a removal workflow explicitly classifies it as safe to remove.

- `Harness/memory/tool-usage-reflections.md`, `Harness/memory/user-corrections-preferences.md`, `Harness/memory/agent-lessons-patterns.md` — these are new empty files
- `.claude/agents/*.md` - all built-in common agent files, including WF-MAX managers and `tdd-guide`
- `.claude/skills/*.md` and mirrored `.agents/skills/*.md` — Claude Code and Codex skill adapters over the same Harness docs
- `.claude/rules/ecc/common.md` - required project-local universal rules. Do not delete this file as a duplicate of a global `~/.claude/rules/ecc/common/` directory; they are different scopes.
- `.claude/settings.json` — harness settings
- `Harness/WF.md`, `Harness/lifecycle.md`, `Harness/subagents.md`, `Harness/agent-workflow.md`, `Harness/architecture.md` — harness runtime docs
- `Harness/research/*.md` — research protocol and templates
- `AGENTS.md` — agent registry; if it already exists, ask for user consent before merging or replacing it
- `Harness/scripts/validate-harness.mjs` and `tests/.gitkeep` — tooling

Optional workflow examples:

```bash
npx create-harness-vibe-coding@latest my-app ./my-app -y --with browser-e2e,ts-react-frontend
npx create-harness-vibe-coding@latest my-app ./my-app -y --preset web-app
npx create-harness-vibe-coding@latest my-app ./my-app -y --recommend superpowers,codegraph
```

`--recommend` records recommendation-only external capability links in this file. It does not install third-party skills or plugins.

### Template Fill Guide

Each template doc contains `{{PLACEHOLDER}}` markers. Below is what every placeholder expects. Replace all markers in the doc before moving to the next doc. If a section does not apply yet, leave the `{{...}}` but record why in `Harness/tasks/<task-id>/PLAN.md`.

**`Harness/research/PRD.md`** — Product scope. Fill with product facts from user input, not guesses:
- `{{WHY_THIS_PROJECT_EXISTS}}`: one-sentence motivation
- `{{MUST_1..3}}`: concrete, testable MVP items (checkbox form)
- `{{NON_GOAL_1..3}}`: explicitly out-of-scope items
- `{{USER_ROLE}}`, `{{SCENARIO}}`, `{{FREQUENCY}}`, `{{PAIN}}`: one row per user type
- `AC-001..003`: verifiable project-level acceptance criteria written as Given/When/Then summaries
- UI/API contract requirements: stable selectors, endpoint contracts, state changes, and evidence methods for relevant AC IDs
- `{{DIMENSION}}`, `{{TARGET}}`, `{{MEASUREMENT}}`: non-functional requirements (perf, security, etc.)

**`Harness/research/research-results.md`** — Tech decisions. Research before filling:
- Use `Harness/research/README.md` as the research protocol.
- `{{CANDIDATE_1..3}}`: each candidate (framework, library, architecture style) with Purpose/Strength/Weakness/Decision/Link.
- `{{Architecture Style}}`: the chosen architectural style (e.g., Hexagonal, Modular Monolith).
- `{{CONSTRAINT_1..3}}`: hard technical constraints derived from research.
- `{{ALTERNATIVE_1..2}}`: rejected candidates worth watching for future.

**`Harness/architecture.md`** — Layer structure. Derive from research-results:
- Fill the ASCII layer diagram with actual layer names. Do NOT add layers without a proven need.
- `Interface Decoupling`: document only real boundaries and ports. Do not add speculative factories, plugin systems, generic repositories, or config layers.
- `State Design`: name state owners, persistence level, legal transitions, and recovery behavior for long-running workflows.
- `Harness Core Components`: describe each core component (Runner, Permission Policy, Event Bus, State Store, Tool Registry) in project-specific terms.
- `Architectural Constraints`: add project-specific non-negotiables. Keep the domain/harness purity rules.


**Constraint**: If the research does not give you enough confidence to fill a section, leave the `{{...}}` placeholder and record the open question in `Harness/tasks/<task-id>/PLAN.md`. The strict validator will catch it.

## User Confirmation Protocol (Non-Negotiable)

> This harness is a design partner, not a solo builder. The user owns product intent.

When user intent is unclear or ambiguous:

- **Maximum 3 blocking questions per decision point.** Ask the highest-impact questions first.
- **Do not act on assumptions that affect architecture, scope, stack, or user-facing behavior.**
- **You must have ≥95% confidence before writing implementation code.** If below that threshold, stop and ask.
- **Record every assumption explicitly** in `Harness/tasks/<task-id>/PLAN.md` so the user can correct it later.
- **Silent picks are forbidden.** If two valid approaches exist and you cannot decide with high confidence, present both to the user with trade-offs.

False confidence is worse than a question. If you catch yourself thinking "this is probably what they want," stop and ask.

## How to Find Proper Skills

After the architecture stage reveals your stack, inspect existing `.claude/skills/`, `.agents/skills/`, plugins, and custom rules before recommending anything. Skills teach Claude Code and Codex domain-specific patterns, testing conventions, and design rules, but duplicate skills create routing noise.

**Built-in route**: invoke the `/find-skills` skill (or say "help me find skills for X"). Examples:

```text
"Find skills for React TypeScript frontend testing."
"Find skills for Python FastAPI backend development."
"What skills exist for Playwright e2e testing?"
"I need a skill for PostgreSQL schema design."
```

**External recommendation links**:

| Recommendation | Source | Purpose |
| --- | --- | --- |
| Superpowers | <https://github.com/obra/Superpowers> | **[RECOMMENDED]** community skill registry for agent workflows. Installed alongside ECC — Superpowers teaches *how to execute*, ECC defines *what standards to meet*. |
| Caveman | <https://github.com/JuliusBrussee/caveman> | terse, low-token agent behavior and memory compression |
| Agent Research | <https://github.com/lingzhi227/agent-research-skills> | research-agent skills for literature, product, dependency, and ecosystem investigation |
| CodeGraph | <https://github.com/colbymchenry/codegraph> | code graph or repository-map tooling |

These are links for the user's agent to evaluate. This scaffold does not maintain third-party install steps. If a user selects one, first check whether an equivalent capability is already installed; then present the GitHub link and ask for approval before the user's agent follows that project's own README.

### ECC (Rules) vs Superpowers (Skills) — Complementary, Not Redundant

ECC and Superpowers overlap ~80% in topic coverage but serve different purposes:

| | ECC Rules | Superpowers Skills |
|---|------|------|
| **Role** | Coding STANDARD (what to enforce) | Coding GUIDE (how to execute) |
| **Enforcement** | Validator plus documented command evidence | Agent self-discipline |
| **Scope** | Universal + per-language (TS/Python/Go/...) | Universal (no language specifics) |
| **TDD** | `testing.md`: coverage ≥80%, AAA pattern | `test-driven-development`: red-green-refactor workflow |
| **Code Review** | `code-review.md`: severity levels, checklist | `requesting-code-review`: dispatch reviewer subagent |
| **Subagents** | `subagents.md` + `dispatch.md`: role packs, write sets | `subagent-driven-development`: two-stage review after each task |
| **Verification** | `testing.md` + `agent-workflow.md`: evidence before claims | `verification-before-completion`: verification before claiming done |
| **Unique** | Design quality, performance budgets, security CSP, per-language idioms | Brainstorming, git worktrees |

**Installation rule:**
1. **ECC is mandatory.** Install `common/` + stack-specific rules during bootstrap step 0. See `Harness/ECC-GUIDE.md`.
2. **Superpowers is recommended.** Install after ECC. It adds ~14 workflow skills that teach agents *how* to execute ECC standards.
3. **No duplicates from other sources.** If a Superpowers skill has an ECC equivalent, keep both — they don't conflict. ECC sets the bar, Superpowers shows the path.
4. **Priority**: ECC rules take precedence when there's a conflict. ECC is the contract; Superpowers is the training manual.

**Manual discovery**: search GitHub and npm directly using patterns from `Harness/research/README.md#Architecture Decision References`.

**Priority order**:
1. Existing project skills/plugins/rules first - do not recommend duplicates.
2. `/find-skills` or the runtime's local skill discovery - fastest and respects the user's tool environment.
3. Selected external GitHub links - let the user's agent read that project's README and install only after approval.
4. GitHub search - when the first three miss niche domains.

**What to install**: after finding skills, add the canonical copy to `.claude/skills/<name>/SKILL.md` and mirror the same file to `.agents/skills/<name>/SKILL.md` when Codex should discover it. Follow `Harness/extension.md` for compatibility. Start with 1-2 skills per stack area; more is not better.

This scaffold includes built-in harness skills in `.claude/skills/*` and mirrored Codex repo skills in `.agents/skills/*`. Keep those. Add stack-specific ones alongside them.

## Optional Agent Assets

After the product shape is known, Claude Code may also install or copy stack-specific agents and rules into `.claude/`. Codex-discoverable workflow skills belong in `.agents/skills/`. Follow `Harness/extension.md` for every added asset.

Examples:

```text
This is a React TypeScript SaaS app. Add frontend testing and review agents.
This is a Python data product. Add data pipeline and pytest workflow agents.
This is a Go service. Add API, security, and integration-test agents.
```

## Cleanup (Isolate & Remove)

This file is designed to be orphaned. When all configuration is complete:

1. Open `CLAUDE.md`. Confirm the setup line reads the bootstrap-only contract (starts with: ``Harness/SETUP.md` is a bootstrap-only document``). It stays valid after this file is deleted.
2. Delete this file.

```bash
rm Harness/SETUP.md
```

After both steps, `Harness/SETUP.md` is fully isolated — no file references it, no trace remains. You are free to delete it at any time. It is a bootstrap scaffold, not a permanent fixture.

---

## For Agents (Self-Bootstrapping)

If you are an AI agent running `create-harness-vibe-coding` to scaffold your own project harness, use non-interactive mode:

```bash
npx create-harness-vibe-coding@latest <project-name> <target-dir> -y --on-conflict skip --json
```

Example:

```bash
npx create-harness-vibe-coding@latest my-agent-project ./my-agent-project -y --on-conflict skip --json
```

After scaffolding, use the JSON output first. Files in `plan.create[]` were handled by the script; only files in `agent.aiMergeRequired[]` need AI merge work. Then bootstrap the harness yourself:

1. Read `CLAUDE.md`, `Harness/MEMORY.md`, and `Harness/README.md`.
2. Follow the Required Bootstrap Sequence above.
3. Run `node Harness/scripts/validate-harness.mjs` after install. Run `node Harness/scripts/validate-harness.mjs --strict` after bootstrap resolves project-fact placeholders.
4. Delete `Harness/SETUP.md`.
