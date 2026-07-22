<p align="center">
  <img src="https://img.shields.io/npm/v/create-harness-vibe-coding?color=blue" alt="npm version">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js >= 18">
  <img src="https://img.shields.io/npm/l/create-harness-vibe-coding" alt="MIT license">
  <img src="https://img.shields.io/github/stars/LiWeny16/create-harness-vibe-coding?style=social" alt="GitHub stars">
</p>

<p align="center">
  <img src="docs/images/harness-icon.png" alt="Harness icon" width="112">
</p>

<h1 align="center">create-harness-vibe-coding</h1>
<p align="center">
  <b>An operating contract for reliable AI coding agents.</b><br>
  <sub>Goals. Context. Loops. Evidence.</sub>
</p>

<p align="center">
  <a href="README-CN.md">Chinese</a> ·
  <a href="https://github.com/LiWeny16/create-harness-vibe-coding">GitHub</a> ·
  <a href="https://www.npmjs.com/package/create-harness-vibe-coding">npm</a>
</p>

`create-harness-vibe-coding` is a Node.js CLI that scaffolds a repo-local harness for AI-assisted software development: research, PRD, architecture, task decomposition, implementation, testing, review, recovery, and durable memory.

It is not a prompt pack and it does not generate business code. It gives Claude Code, Codex, and compatible agents a shared operating system for long-running work.

## The short version

Without a framework:

```text
Idea → prompt → patch → demo → rediscover context → repair drift
```

With Harness:

```text
Idea → Research → PRD → Architecture → Acceptance Criteria
     → Build → Test → Review → Verify → Learn → Update
```

## One-line install (recommended for existing repos)

Paste this into your agent:

> Please install the Harness framework by following https://github.com/LiWeny16/create-harness-vibe-coding/blob/main/README.md.

## Installation instructions (Agent instruction)

After reading this README, the agent selects the path that matches the project:

| Project state | Agent action |
|---|---|
| New project | `npx create-harness-vibe-coding@latest my-project -y` |
| Existing project | `npx create-harness-vibe-coding@latest my-project . -y --on-conflict skip --json` |
| Existing `Harness/` with `Harness/scripts/wf-update-check.mjs` | `node Harness/scripts/wf-update-check.mjs --json`; update, do not reinstall |
| Existing `Harness/` but missing `Harness/scripts/wf-update-check.mjs` | `npx create-harness-vibe-coding@latest my-project . -y --on-conflict skip --json`. Then run `node Harness/scripts/wf-update-check.mjs --json` |
| After install or update | `node Harness/scripts/validate-harness.mjs --strict` |

After installation, read `CLAUDE.md`, `AGENTS.md`, `Harness/SETUP.md`, and `Harness/README.md`; preserve project boundaries; research and plan before editing; run tests, validation, and review before claiming completion.

The user does not need to run commands manually. The agent handles installation, conflict handling, validation, and the handoff.

## Which WF command should you use?

When in doubt, use `/wf-help`. It returns the full command table. Use `/wf` for complex work and `/wf-max` when the work can be safely parallelized.

| Command | Use it when | What it does | Example |
|---|---|---|---|
| `/wf <task>` | Multi-file, architectural, risky, migration, or repeatedly failing work | Research → plan → implement → test → review → verify → reflect | `/wf refactor the payment module and add tests` |
| `/wf-max <task>` | The task splits into independent work and needs maximum parallelism | Adds CEO → Manager → Worker roles and parallel waves to the full WF chain | `/wf-max upgrade frontend, backend, and docs in parallel` |
| `/wf-auto` | You want continuous self-directed optimization with adaptive probe selection | Runs repeated optimization cycles with plans, evidence, and feedback | `/wf-auto improve this project's stability` |
| `/wf-auto-spark` | You need external inspiration, competitive direction, or a long-term roadmap | Searches for sparks, anchors work to a North Star and milestones, and guards scope drift | `/wf-auto-spark explore product growth directions` |
| `/wf-review [focus]` | You need a second opinion, peer review, or a pre-release check | Uses a peer CLI when available, otherwise an independent reviewer role, and classifies findings by severity | `/wf-review focus on security and data loss` |
| `/wf-learn` | The same mistakes keep recurring or a completed task needs to become reusable knowledge | Consolidates context, memory, and project lessons | `/wf-learn summarize why this task needed rework` |
| `/wf-browser <task>` | Browser smoke tests, E2E, screenshots, forms, or UI verification | Uses a real browser and returns screenshots, traces, and evidence | `/wf-browser verify login and checkout` |
| `/wf-readme <task>` | README, install docs, architecture diagrams, or project docs need work | Preserves facts while improving structure, setup, and usage guidance | `/wf-readme improve the Chinese README` |
| `/wf-update` | Harness is already installed and needs an update | Compares versions, applies safe changes, and leaves semantic conflicts to the agent | `/wf-update` |
| `/wf-remove` | You need to uninstall Harness | Removes safe files, preserves user data, and asks before touching conflicts | `/wf-remove` |
| `/wf-help` | You do not know which command to use | Returns command usage without starting a workflow | `/wf-help` |

Claude Code uses `/wf-*`; Codex uses the matching `$wf-*`; OpenCode uses the registered command or Agent instruction. `/wf-auto` and `/wf-auto-spark` are continuous modes, so give the agent a clear goal, scope, and acceptance criteria before starting.

Common starting points: Web/API work starts with correctness, security, reliability, and verification; CLI/SDK work starts with contracts, compatibility, error UX, and docs; AI-agent work starts with context quality, tool safety, evaluation, and recovery; data jobs start with idempotency, failure recovery, and observability. See the full [WF-AUTO-ANGLES.md](Harness/WF-AUTO-ANGLES.md) selection protocol.

Chinese README: [README-CN.md](README-CN.md)

## Why this matters: the measurable difference

Better prompts can improve one turn. A harness improves the conditions around every turn: what the agent may read, what it may change, how success is checked, and how the next session recovers.

| Dimension | Prompt-only / no Harness | With Harness | What to measure |
|---|---|---|---|
| Verified completion | “It looks finished” after a demo | Acceptance criteria, tests, validators, and review are part of the task boundary | Verified completion rate |
| Stability and safety | File ownership and conflict handling are ad hoc | Script-first plans classify create/skip/backup/overwrite/conflict before writes | Safety incidents and unauthorized overwrites |
| Rework rate | Drift is discovered late, so correction work is hidden in follow-up prompts | Task capsules, explicit boundaries, and closed-loop verification expose and reduce avoidable rework | `follow-up corrective runs ÷ completed tasks` |
| Human correction | People repeatedly restate context and rescue the agent | Humans focus on semantic conflicts and decisions; deterministic work stays in scripts | `humanInterventions` per task |
| Recovery after interruption | Rediscover the repository and decisions from scratch | `Harness/PROGRESS.md`, task capsules, and durable memory preserve the handoff | Recovery time and duplicated discovery |
| Cost | Lower setup cost, unpredictable downstream cost | More upfront structure, with token/time overhead recorded against the baseline | Duration, tokens, and cost overhead |

The honest status: this repository defines the comparison protocol, but it does not publish fabricated “50% fewer bugs” numbers. Run the same model, repo, prompt, budget, and verification in three modes—`bare-agent`, `harness-wf`, and `harness-wf-max`—before making a quantitative claim. See the [HarnessBench v0.1 scoring design](Harness/tasks/task-framework-metrics-and-entry-contract/PLAN.md#5-metrics-and-scoring).

## Three human motivations, used ethically

README structure should meet people where decisions actually happen. Harness uses the three motivations below to make the trade-off explicit—not to manufacture urgency or hide uncertainty.

| Motivation | The reader is thinking | Harness answers with |
|---|---|---|
| **Loss aversion** | “I cannot afford lost files, silent drift, or another repair cycle.” | Safe-merge conflict policies, scoped write sets, validators, and review evidence |
| **Leverage** | “I want the same agent to finish more work with less repeated explanation.” | Router-based context loading, task capsules, parallel role dispatch, and durable memory |
| **Blind spot** | “A better prompt should be enough.” | A visible process: goal → constraints → tests → feedback, plus a benchmarkable baseline |

## Architecture

<p align="center">
  <a href="docs/images/harness-architecture-light.png">
    <img src="docs/images/harness-architecture-light.png" alt="Light architecture diagram showing a developer request flowing through Goals and Constraints, Quality Context, and Decomposition and Feedback into an Execute, Verify, Learn, Update loop" width="100%">
  </a>
  <br>
  <sub>
    Light infographic · <a href="docs/images/harness-architecture.drawio">editable Drawio source</a>
  </sub>
</p>

The architecture has three pillars:

1. **Goals & Constraints** — PRD → research → architecture → acceptance criteria.
2. **Quality Context** — a router, context-loading protocol, and durable memory keep attention on the right evidence.
3. **Decomposition & Feedback** — `/wf` and `/wf-max` assign bounded work, then review, verify, learn, and update the next task.

## What gets scaffolded

| Layer | Purpose |
|---|---|
| `CLAUDE.md`, `AGENTS.md` | Agent entry contract and registry |
| `Harness/README.md`, `Harness/MEMORY.md` | Task-based routing and resource index |
| `Harness/tasks/`, `Harness/PROGRESS.md` | Resumable task state across sessions |
| `.claude/`, `.agents/`, `.codex/`, `.opencode/` | Tool-specific discovery and configuration |
| `templates/common/`, `templates/optional/` | Declarative scaffold source and optional workflows |
| `Harness/scripts/validate-harness.mjs` | Structural and strict readiness checks |

The generated project starts with no business stack or generated application code. You choose the stack after bootstrap.

## Existing project: safe merge first

Paste this to your agent:

```text
Read and follow https://github.com/LiWeny16/create-harness-vibe-coding exactly to configure this project with create-harness-vibe-coding.
```

The agent-first path previews the target before writing and preserves project-owned files. If you need the detailed CLI contract, the agent can read `Harness/SETUP.md` after setup.

If `Harness/` already exists, first check whether `Harness/scripts/wf-update-check.mjs` exists. If it does, use `/wf-update`, `$wf-update`, or `node Harness/scripts/wf-update-check.mjs --json` instead of reinstalling blindly. If it is missing, run the safe CLI recovery command from the installation table first, then run the updater.

## Optional workflows

Ask your agent to add the capability you need:

> Add `browser-e2e` and `ui-ux-review` to this Harness project, preserve existing files, run the strict validator, and report exactly what changed.

| Workflow | Use it for |
|---|---|
| `browser-e2e` | Screenshots, traces, and smoke tests |
| `ui-ux-review` | Responsive, accessibility, and polish review |
| `ts-react-frontend` | TypeScript, React, and Vite projects |
| `python-backend` | FastAPI and pytest projects |
| `github-pr-review` | PR diff review and CI evidence |

External recommendations are recorded in `Harness/SETUP.md`; they are not auto-installed.

| Recommendation | Use it for | Source |
|---|---|---|
| `superpowers` | Community agent skills and coding workflows | [Superpowers](https://github.com/obra/Superpowers) |
| `caveman` | Terse, low-token agent behavior | [Caveman](https://github.com/JuliusBrussee/caveman) |
| `agent-research` | Literature, product, dependency, and ecosystem research | [agent-research-skills](https://github.com/lingzhi227/agent-research-skills) |
| `codegraph` | Repository graph and architecture mapping | [CodeGraph](https://github.com/colbymchenry/codegraph) |
| `grill-me` | Relentless plan/design interview before implementation | [Grill Me](https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me) |

## Verify

```bash
# This package repository
npm test

# Generated project after safe merge
node Harness/scripts/validate-harness.mjs

# Generated project after bootstrap or before release
node Harness/scripts/validate-harness.mjs --strict

# After publishing an update release
npm run check:mirrors
```

## Release gate

Iron rule: every update release must keep both update channels live:

- Canonical: npm `create-harness-vibe-coding@latest` and `https://github.com/LiWeny16/create-harness-vibe-coding`
- Legacy compatibility mirror: `https://github.com/zingspark/create-harness-vibe-coding`

Low-version installs can have updater scripts hardcoded to the legacy mirror. Do not mark a release complete until the legacy mirror exposes the same commit, tag, and generated template manifest as canonical. Generated installs still record the canonical `LiWeny16` source; the `zingspark` repo is kept for backward compatibility.

## Footprint

| | |
|---|---|
| Runtime | None |
| Dependencies | 2 (`@clack/prompts`, `picocolors`) |
| Node.js | ≥ 18 |
| Generated application code | None until you choose a stack |

## Keywords and related concepts

AI coding agent framework · agentic workflow · context engineering · long-running coding tasks · task orchestration · durable memory · safe merge · conflict handling · acceptance criteria · Claude Code · Codex · OpenCode · Node.js CLI · developer productivity

MIT © [LiWeny16](https://github.com/LiWeny16)
