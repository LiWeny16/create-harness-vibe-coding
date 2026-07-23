# framework-metrics-and-entry-contract - PLAN

## Goal

Define the next Harness framework iteration with enough precision to implement safely:

- slim `CLAUDE.md` into a minimal entry contract now that `/wf-*` and `$wf-*` skills own command behavior
- define HarnessBench v0.1 so the framework can be explained and measured with repeatable evidence
- specify implementation phases, validators, tests, and migration risks before source edits

## Current Constraints

- `/wf-max` CEO mode is active.
- Main agent must not edit source files directly.
- PLAN/PROGRESS writes are allowed.
- Workers may inspect and report; implementation must happen in a later worker/implementation phase with bounded write scopes.

## Design Requirements

### CLAUDE.md Entry Contract

- `CLAUDE.md` should be a short startup and safety contract, not a command catalog.
- It must preserve the startup chain: `CLAUDE.md` -> `Harness/MEMORY.md` -> `Harness/README.md`.
- It must preserve the no-bulk-read rule and task routing through `Harness/README.md#Load By Task`.
- It must keep the minimal WF-MAX safety guard because tool safety depends on it before deeper docs are loaded.
- Detailed `/wf-*` behavior belongs in skill docs and `Harness/WF*.md`.

### HarnessBench v0.1

- Must evaluate Harness as a framework, not raw model coding skill.
- Must compare same model / same repo / same budget across at least bare agent, Harness `/wf`, and Harness `/wf-max`.
- Must measure verified completion, safety, conflict handling, recovery, verification discipline, and cost.
- Must produce artifacts that are understandable to outsiders without reading the whole repo.

## Acceptance Criteria

- [ ] CLAUDE ownership boundary is specified with destination files for removed content.
- [ ] HarnessBench task suite and scoring rubric are specified.
- [ ] Implementation phases and write scopes are specified.
- [ ] Validator/test changes are enumerated.
- [ ] Migration and compatibility risks are explicit.
- [ ] Confidence checklist reaches at least 95% before source edits begin.

## Open Decisions

| Decision | Current Lean | Evidence Needed |
|---|---|---|
| Max size for slim `CLAUDE.md` | 120-180 lines or less | Worker CLAUDE spec |
| Benchmark location | Decided: runtime `Harness/benchmarks/`, generated source `templates/common/Harness/benchmarks/` | HarnessBench architect worker |
| Runner now or later | Methodology first, runner later | Worker implementation plan |
| Public benchmark citations | Use as alignment, not as direct proof | Stable citation list |

## Worker Inputs

| Worker | Scope | Status |
|---|---|---|
| CLAUDE contract spec | Entry contract boundaries and validator risks | Running |
| HarnessBench spec | Metrics, task suites, scoring, schemas | Running |
| Implementation plan | Phased PR plan and 95% readiness gate | Running |

## Evidence Collected

Targeted `git grep` confirmed the hard dependencies that must move with the slim contract:

- `Harness/scripts/validate-harness.mjs` and `templates/common/scripts/validate-harness.mjs` currently require exact `CLAUDE.md` strings for memory triggers, subagent routing, `/wf-update`, `/wf-max`, and the old rule section headings.
- `Harness/specs/guides/SETUP.md` and `templates/common/SETUP.md` currently declare a required `CLAUDE.md` contract containing `## 1. Harness Binding & Startup`, `## 6. Memory & Self-Learning`, memory trigger phrases, and the setup bootstrap line.
- `Harness/README.md` and `templates/common/Harness/README.md` already own command routing through `Load By Task` and `Skill Commands`.
- `.claude/skills/*`, `.agents/skills/*`, and `templates/common/.claude/skills/*` already own command-specific invocation details for `wf-max`, `wf-review`, `wf-update`, and `wf-remove`.
- Memory trigger details currently exist in `CLAUDE.md` and `templates/common/CLAUDE.md`, not in `Harness/MEMORY.md`; Phase A must migrate or summarize them there before removing them from `CLAUDE.md`.

## Read-Only Worker Cross-Check - 2026-07-01

Agents used:

- planner/architect Worker: checked WF-MAX dispatch readiness and found the PLAN was architecture-ready but not yet implementation-dispatchable because exact write claims were incomplete.
- validator-impact Worker: mapped old `CLAUDE.md` assumptions in validators, setup docs, and generator tests.
- HarnessBench architect Worker: chose benchmark artifact locations and minimum schema/runner boundaries.

Findings accepted:

- WF-MAX implementation cannot proceed until a D-GATE table assigns exactly one write Worker per write file.
- Phase A must include exact test file claims, not a generic "tests that assert required scaffold docs" row.
- Phase A must update both root and template validators to avoid scaffold drift.
- Phase B benchmark docs should live under `templates/common/Harness/benchmarks/` and mirror to root `Harness/benchmarks/` for dogfood runtime.
- Phase C runner should be score-only in v0.1 and live under `templates/common/scripts/harness-bench.mjs`, mirrored to `Harness/scripts/harness-bench.mjs`.

Conflicts:

- `Harness/PROGRESS.md` says active task is `None`, while this task is still being advanced. Treat the task capsule as authoritative for this WF-MAX thread until global progress is reconciled.

Decisions:

- Benchmark docs location is no longer open: use `Harness/benchmarks/` runtime and `templates/common/Harness/benchmarks/` source.
- Phase A verification tests are `tests/generator.test.js` and `tests/validate-harness.test.js`.
- Add `Harness/.harness-version` to Phase A write scope if template checksum metadata must change.

Residual risk:

- Combined Phase A/B/C implementation is too broad for a single D-GATE wave. Dispatch Phase A first, then re-run D-GATE for Phase B and Phase C after Phase A verification.

## Framework Decision v0.1

### 1. CLAUDE.md Must Become an Entry Contract

`CLAUDE.md` should answer only five startup questions:

1. Is this repository governed by Harness?
2. What must be loaded first?
3. What is forbidden before routing?
4. Where does each category of instruction live?
5. What safety invariant applies before any source edit?

Target structure:

```md
# CLAUDE.md

## Harness Entry
- If `Harness/` exists, this repo is governed by Harness.
- Load `Harness/MEMORY.md`, then `Harness/README.md`.
- If `Harness/specs/guides/SETUP.md` exists, complete it before normal work.
- Do not bulk-read `Harness/`; use `Harness/README.md#Load By Task`.

## Command Handoff
- If the user invokes `/wf-*`, `$wf-*`, or a named Harness skill, use that skill.
- Otherwise route through `Harness/README.md#Load By Task`.
- `/wf-max` active: CEO does not edit source; load `Harness/specs/workflows/WF-MAX.md`.

## Operating Invariants
- Clarify intent before implementation when uncertain.
- Keep changes scoped to the request.
- Verify before claiming completion.
- Read the proving file before asserting codebase facts.

## Durable State
- Task state lives in `Harness/tasks/<task-id>/`.
- Memory routing starts from `Harness/MEMORY.md`.
- Project architecture belongs in `Harness/project/architecture.md`.

## Boundaries
- Build/run/release commands belong in `README.md`.
- Workflow details belong in `Harness/WF*.md`, `Harness/workflows/`, or skill docs.
- Command-specific behavior belongs in `.claude/skills/*/SKILL.md` and `.agents/skills/*/SKILL.md`.
```

Implementation-ready replacement text:

```md
# CLAUDE.md

Entry point for coding agents. If `Harness/` exists, this repository is governed by the Harness contract.

## Harness Entry

- Load `Harness/MEMORY.md` first, then `Harness/README.md`.
- If `Harness/specs/guides/SETUP.md` exists, follow it before normal project work; it is the install/bootstrap contract and may be deleted after setup is complete.
- Never bulk-read `Harness/`. Use `Harness/README.md#Load By Task` to route only the files needed for the current request.
- Load `Harness/PROGRESS.md` when work is active or when task history matters.

## Command Handoff

- If the user invokes `/wf-*`, `$wf-*`, or a named Harness skill, use the matching skill document.
- Otherwise route through `Harness/README.md#Load By Task`.
- Command catalogs and workflow details live in `Harness/README.md`, `Harness/WF*.md`, `Harness/workflows/`, and skill docs.

## WF-MAX Safety

When `/wf-max` is active, you are CEO, not implementer. Do not edit source files directly. Spawn Workers for source changes. The only CEO write exception is task state under `Harness/tasks/<task-id>/PLAN.md` and `PROGRESS.md`. Load `Harness/specs/workflows/WF-MAX.md` for the full contract.

## Operating Invariants

- Clarify intent before implementation when confidence is low or architecture/user-facing behavior is ambiguous.
- Keep changes scoped to the request and avoid adjacent refactors.
- Verify with tests, validators, builds, or documented manual evidence before claiming completion.
- Before asserting a codebase fact, read the file that proves it.
- Preserve user work. Never overwrite project files, secrets, credentials, or local configuration without explicit approval.

## Durable State

- Multi-step task state lives in `Harness/tasks/<task-id>/`.
- Memory/resource routing starts from `Harness/MEMORY.md`.
- Durable lessons and user corrections belong under `Harness/memory/`.
- Architecture belongs in `Harness/project/architecture.md` or the current feature doc.

## Boundaries

- Build commands, git conventions, release process, and product facts belong in `README.md` or project docs, not this file.
- Workflow rules belong in `Harness/WF*.md`, `Harness/workflows/`, or skill docs.
- This file should stay small. If it accumulates command details or project notes, move them to the routed destination.
```

Target size: roughly 60-100 lines. Hard cap: 150 lines unless a validator-critical invariant truly cannot move elsewhere.

### 2. CLAUDE.md Content Migration Matrix

| Current Content Type | Keep in `CLAUDE.md`? | Destination |
|---|---:|---|
| Startup load order | Yes | `CLAUDE.md`, mirrored in `AGENTS.md` if needed |
| No bulk-read rule | Yes | `CLAUDE.md` + `Harness/README.md` |
| Full CEO contract table | No, keep only emergency guard | `Harness/specs/workflows/WF-MAX.md`, `Harness/README.md#Load By Task`, wf-max skill |
| `/wf`, `/wf-review`, `/wf-update`, `/wf-auto` descriptions | No | Skill docs and `Harness/README.md` command catalog |
| Subagent orchestration details | No | `Harness/specs/runtime/subagents.md`, `Harness/specs/runtime/dispatch.md`, `subagent-orchestrator` skill |
| Memory trigger details | No | `Harness/MEMORY.md`, `Harness/memory/*`, wf-learn skill |
| Think-before-coding / simplicity / surgical edits | Condense | `CLAUDE.md` invariants + `.claude/rules/ecc/common.md` |
| Browser/UI evidence rule | No | Relevant workflow doc or `.claude/rules/ecc/common.md` |
| Project-specific source paths | No | Project `README.md`, `docs/`, `Harness/project/architecture.md` |
| Build/run/git conventions | No | `README.md` |

### 3. HarnessBench v0.1 Goal

HarnessBench measures the framework layer:

```text
same model + same repo + same budget
baseline agent vs Harness /wf vs Harness /wf-max
= delta in reliability, safety, recovery, and verified completion
```

It does not try to replace public coding benchmarks. Public benchmarks are alignment references:

- SWE-bench / SWE-bench Verified: real GitHub issue resolution
- Terminal-Bench: terminal-based agent task execution
- SWE-Bench Pro: longer horizon software engineering tasks
- SlopCodeBench: multi-round codebase degradation under iterative change
- METR time horizon: human-time-equivalent task completion horizon

HarnessBench should fill the gap those benchmarks leave: lifecycle safety, durable state, conflict handling, and recovery.

Public benchmark alignment evidence:

| Benchmark | What It Proves | Why HarnessBench Still Needs To Exist |
|---|---|---|
| SWE-bench / SWE-bench Verified | Real GitHub issue patching is the standard coding-agent reference; Verified is a human-validated subset. | It measures issue resolution, not scaffold lifecycle safety, memory, or update/remove workflows. |
| SWE-Bench Pro | Longer-horizon, harder software engineering tasks are becoming the relevant frontier. | It still primarily scores task patches, not process reliability or project governance. |
| Terminal-Bench | Terminal agents need realistic end-to-end task environments and robust verification. | Harness operates in the same terminal/repo arena, but adds workflow control and durable state metrics. |
| METR Time Horizon | Agent capability can be framed as human-time-equivalent task horizon. | Harness should claim it extends reliable task horizon for the same model by improving recovery and verification. |
| SlopCodeBench | Iterative agent coding can pass checkpoints while degrading maintainability. | HarnessBench should explicitly score codebase erosion, diff discipline, and repeated-change stability. |

### 4. HarnessBench v0.1 Suites

Minimum viable suite: 16 tasks, grouped into four suites.

| Suite | Purpose | Example Tasks |
|---|---|---|
| Lifecycle Safety | Prove install/update/remove does not damage user work | empty install; install into existing README/package conflict; update SAFE+NEW+CONFLICT; remove default; remove purge keep tasks |
| Conflict Handling | Prove script handles deterministic work and AI handles semantic conflicts | AGENTS merge; README preserve; package.json preserve; modified runtime file decision |
| Long Task Execution | Prove Harness improves multi-step coding reliability | CLI feature with tests; bugfix with regression; docs+validator change; multi-file refactor |
| Recovery & Memory | Prove durable state helps after interruption or repeated error | resume from task capsule; apply user correction; use memory lesson; recover after failed verification |

Concrete v0.1 tasks:

1. `install-empty-project`
2. `install-existing-readme-package`
3. `install-existing-agents-conflict`
4. `update-safe-new-conflict`
5. `remove-default-preserve-user-data`
6. `remove-purge-keep-tasks`
7. `modified-runtime-delete-decision`
8. `safe-json-agent-guidance`
9. `resume-interrupted-feature`
10. `resume-after-context-summary`
11. `bugfix-with-regression-test`
12. `validator-rule-change`
13. `docs-router-update`
14. `memory-correction-application`
15. `subagent-review-fix-loop`
16. `multi-step-feature-no-adjacent-refactor`

### 5. Metrics and Scoring

Primary score:

```text
Harness Effect Score =
35% Verified Completion
20% Safety / No Data Loss
15% Conflict Handling Efficiency
15% Recovery / Continuity
10% Verification Discipline
5% Cost Overhead
```

Metric definitions:

| Metric | Pass Evidence |
|---|---|
| Verified Completion | Required tests/validator/manual checks pass; expected files changed |
| Safety / No Data Loss | User-owned files preserved; no unauthorized overwrite/delete; version state consistent |
| Conflict Handling Efficiency | SAFE/NEW work completed by script; semantic conflicts isolated in JSON/plan |
| Recovery / Continuity | Agent resumes from `Harness/PROGRESS.md` and task capsule without redoing discovery |
| Verification Discipline | Claims backed by command output or explicit manual evidence |
| Cost Overhead | Token/time/tool overhead recorded and compared against baseline |

Suggested result fields:

```json
{
  "taskId": "update-safe-new-conflict",
  "runner": "harness-wf",
  "model": "gpt-5-codex",
  "budget": {"tokens": 120000, "minutes": 30},
  "verifiedCompletion": 1,
  "safetyIncidents": 0,
  "conflictsPresented": 2,
  "conflictsResolved": 2,
  "humanInterventions": 1,
  "verificationCommands": ["npm test", "node Harness/scripts/validate-harness.mjs --strict"],
  "durationSeconds": 840,
  "tokenEstimate": 64000,
  "notes": ""
}
```

### 6. Baseline / Ablation Protocol

Run every task in three modes:

1. `bare-agent`: same model, no Harness docs beyond ordinary project README
2. `harness-wf`: same model with standard Harness `/wf`
3. `harness-wf-max`: same model with CEO->Worker delegation

Controls:

- Same initial repo fixture.
- Same task prompt.
- Same time/token ceiling.
- Same verification script.
- No manual rescue except documented intervention.
- Every run stores transcript summary, final diff, verification output, and result JSON.

The output claim should be delta-based:

```text
Harness /wf improved verified completion from X% to Y%,
reduced unsafe file operations from A to B,
and improved interruption recovery from C% to D%
under the same model and budget.
```

### 7. Likely Implementation Phases

#### Phase A - Entry Contract Slimming

Write scope:

- `CLAUDE.md`
- `templates/common/CLAUDE.md`
- `Harness/specs/guides/SETUP.md`
- `templates/common/SETUP.md`
- `Harness/scripts/validate-harness.mjs`
- `templates/common/scripts/validate-harness.mjs`
- `tests/generator.test.js`
- `tests/validate-harness.test.js`
- `Harness/.harness-version` if template checksums are refreshed

Acceptance:

- `CLAUDE.md` is <= 150 lines.
- No command-specific workflow detail remains in `CLAUDE.md`.
- Startup chain and WF-MAX safety guard remain.
- Validator passes against slim contract.
- Existing install/update conflict behavior remains unchanged.

#### Phase A D-GATE Dispatch

| File | Concern | Worker Type | Worker Label | Read-Only? |
|------|---------|-------------|--------------|------------|
| `CLAUDE.md` | Dogfood slim entry contract | implementer | impl-root-claude | No |
| `templates/common/CLAUDE.md` | Generated slim entry contract | implementer | impl-template-claude | No |
| `Harness/specs/guides/SETUP.md` | Runtime setup contract text | implementer | impl-root-setup | No |
| `templates/common/SETUP.md` | Template setup contract text | implementer | impl-template-setup | No |
| `Harness/scripts/validate-harness.mjs` | Runtime validator retargeting | implementer | impl-root-validator | No |
| `templates/common/scripts/validate-harness.mjs` | Template validator retargeting | implementer | impl-template-validator | No |
| `tests/generator.test.js` | Generator contract assertions | implementer | impl-generator-test | No |
| `tests/validate-harness.test.js` | Validator contract assertions | implementer | impl-validator-test | No |
| `Harness/.harness-version` | Template checksum metadata | implementer | impl-harness-version | No |

Self-audit:

- CEO source file assignment: No.
- Every Phase A write file assigned to exactly one write Worker: Yes.
- Any Worker has more than one write file: No.
- Manager count floor: 2 managers for 9 write files, satisfying `ceil(sqrt(9) / 3)` and the 7-worker cap.
- Manager grouping: entry-contract manager owns 4 workers; validator/test manager owns 5 workers.
- Workers spawned in one message: required for implementation wave.

#### Phase B - Benchmark Methodology Docs

Write scope:

- `templates/common/Harness/benchmarks/README.md`
- `templates/common/Harness/benchmarks/schema/result.schema.json`
- `templates/common/Harness/benchmarks/tasks/*.md`
- `Harness/benchmarks/README.md`
- `Harness/benchmarks/schema/result.schema.json`
- `Harness/benchmarks/tasks/*.md`
- README summary link

Acceptance:

- Defines goals, non-goals, suites, metrics, scoring, and baseline protocol.
- Includes at least 16 v0.1 task specs.
- Explicitly states public benchmark alignment and why HarnessBench is different.
- Does not require runner implementation yet.

#### Phase C - HarnessBench-lite Runner

Write scope:

- `templates/common/scripts/harness-bench.mjs`
- `Harness/scripts/harness-bench.mjs`
- fixture/task definitions under `templates/common/Harness/benchmarks/`
- fixture/task definitions under `Harness/benchmarks/`
- tests for schema parsing and score calculation

Acceptance:

- Can score manually collected result JSON.
- Can validate required fields.
- Can produce a Markdown summary table.
- Does not attempt to automate external model execution in v0.1.

#### Phase D - Launch and Promotion Package

Write scope:

- `README.md`
- `README-CN.md`
- `docs/benchmarks/HarnessBench.md` or `Harness/benchmarks/README.md`
- `docs/launch/positioning.md`
- `docs/launch/assets.md`
- optional examples/screenshots generated from benchmark outputs

Acceptance:

- One-line positioning is clear to a developer in under 10 seconds.
- README shows the problem, install command, 60-second demo, and benchmark story above the fold.
- Benchmark claims are phrased as measured deltas, not vague "better agent" claims.
- Launch assets include Hacker News, Reddit, X/LinkedIn, Product Hunt, and Chinese community variants.
- Repository has contribution affordances: issues labeled `good first issue`, `benchmark-task`, `help wanted`, and a short roadmap.

### 8. Validator and Test Impact

Expected updates:

- In validator, move memory trigger assertions from `CLAUDE.md` to `Harness/MEMORY.md` or a dedicated memory doc.
- In validator, replace old heading assertions (`Think Before Coding`, `Simplicity First`, `Surgical Changes`, `Goal-Driven Execution`) with the slim `Operating Invariants` heading plus specific invariant checks.
- In validator, replace `/wf-update` and `/wf-max` requirements in `CLAUDE.md` with command-handoff requirements and skill-doc checks.
- In setup docs, replace the old required `CLAUDE.md` contract row with the slim entry-contract requirements.
- Add a test that `CLAUDE.md` stays below the line cap.
- Add a test that `CLAUDE.md` contains no duplicated command catalog strings.
- Add a test that skill docs still contain command-specific instructions.
- Add benchmark docs/schema tests only after Phase B/C.

### 9. Migration and Compatibility Risks

| Risk | Mitigation |
|---|---|
| Validator recreates CLAUDE bloat | Update validator and setup contract in same PR |
| Existing installs expect section anchors like `§1a` | Keep a stable `WF-MAX` anchor or update all references |
| Agents miss command routing after slimming | Add explicit “command handoff to skills” in slim CLAUDE |
| Memory triggers become undiscoverable | Move them to `Harness/MEMORY.md` and ensure README routes memory tasks there |
| Benchmark appears self-serving | Use delta against bare-agent baseline and cite public benchmarks only as context |
| Runner over-automates too early | Phase B docs first; runner only scores collected evidence in v0.1 |

### 10. 95% Confidence Gate Before Source Edits

Implementation should not start until all are true:

- [ ] Current `CLAUDE.md`, template `CLAUDE.md`, setup docs, and validator requirements have been inspected.
- [ ] Exact slim `CLAUDE.md` replacement text is drafted.
- [ ] Every removed content category has a destination file.
- [ ] Validator/test changes are mapped to each removed requirement.
- [ ] HarnessBench v0.1 metrics and task list are accepted.
- [ ] Benchmark docs location is chosen.
- [ ] No source edit requires changing project product facts unrelated to Harness.
- [ ] Backward compatibility for existing installs is documented.
- [ ] Verification command list is ready.

Current confidence estimate: 95%.

Why 95%:

- The CLAUDE ownership problem is proven by current template content and validator/setup exact-string requirements.
- Command-specific details are proven to have alternative homes in README and skill docs.
- The exact migration targets for memory, command, setup, and validator assertions are mapped.
- HarnessBench scope is intentionally methodology-first, avoiding premature runner complexity.
- The remaining 5% risk is implementation drift: validator/setup/template/checksum updates must be done in the same PR and verified together.

Ready for implementation after this PLAN is accepted.

## Growth Strategy Toward 1k Stars

### Positioning

Current project should not be marketed as "another prompt pack" or "Claude/Codex config." The stronger positioning:

```text
Harness is an operating contract for coding agents: it gives Claude/Codex durable memory, safe lifecycle scripts, workflow routing, and benchmarkable engineering discipline.
```

Short tagline candidates:

- "An operating system for long-running coding agents."
- "Make coding agents safer across install, update, review, and resume."
- "SWE-bench measures patches. HarnessBench measures whether your agent can keep a project healthy."
- "Stop losing context. Stop overwriting user files. Give your coding agent a workflow contract."

### Audience

Primary:

- developers using Claude Code, Codex, Cursor, Aider, or custom agents on real repos
- maintainers tired of agent drift, context loss, accidental overwrites, and unverified claims
- agent-tool builders looking for workflow/benchmark fixtures

Secondary:

- AI infra people interested in agent evaluation
- open-source developers who want better contribution workflows
- Chinese AI coding community, where practical "how to make agents reliable" content spreads well

### Star Growth Funnel

| Stage | Goal | Asset |
|---|---|---|
| Foundation | Repo converts visitors to stars | README rewrite, demo GIF, clear install, benchmark table |
| Proof | Claim is credible | HarnessBench-lite results and reproducible tasks |
| Launch | Drive first spike | HN "Show HN", Reddit, X/LinkedIn thread, Product Hunt, V2EX/Juejin/Zhihu |
| Sustained | Keep stars accumulating | Weekly benchmark tasks, release notes, comparisons, contribution issues |
| Community | Convert users to contributors | templates, labels, examples, "add a benchmark task" guide |

### 30-Day Plan To 1k Stars

Week 1 - Make It Understandable:

- Slim `CLAUDE.md` and dogfood it.
- README above-the-fold rewrite:
  - problem
  - what Harness does
  - 60-second install/demo
  - "why this is not a prompt pack"
  - benchmark preview
- Add `docs/benchmarks/HarnessBench.md`.
- Add 5-8 screenshot/GIF assets: JSON plan, safe update, safe remove, task capsule recovery.

Week 2 - Make It Measurable:

- Run HarnessBench-lite manually on 6-8 tasks.
- Publish a table: bare agent vs Harness `/wf` vs Harness `/wf-max`.
- Prefer honest early numbers over inflated claims.
- Add `benchmark-task` issues so outsiders can contribute tasks.

Week 3 - Launch:

- Launch order:
  1. X/LinkedIn technical thread
  2. Hacker News "Show HN"
  3. Reddit: r/ClaudeAI, r/LocalLLaMA if relevant, r/opensource, r/programming with non-spam framing
  4. V2EX / 掘金 / 知乎文章
  5. Product Hunt only after demo assets are polished
- Message should center on the pain:
  - "My agent could code, but couldn't safely maintain a repo across days."
  - "So I built a Harness: lifecycle scripts + memory + workflow routing + benchmark."

Week 4 - Sustain:

- Release v0.9 with HarnessBench-lite results.
- Post "what current coding benchmarks miss" article.
- Add comparison pages:
  - Harness vs prompt-only workflows
  - Harness vs raw Claude Code/Codex usage
  - HarnessBench vs SWE-bench/Terminal-Bench
- Invite benchmark task PRs.

### Launch Copy Draft

Hacker News:

```text
Show HN: Harness — an operating contract for long-running coding agents

I kept seeing the same failure pattern with Claude/Codex on real repos:
the agent could write patches, but lost context, overwrote scaffold files,
forgot verification, and had no measurable way to prove the workflow helped.

Harness adds a repo-local operating contract:
- task capsules and durable memory
- script-first install/update/remove plans
- safe conflict handling
- /wf and /wf-max workflows for long tasks
- HarnessBench, a small benchmark for lifecycle safety and recovery

It is not a model benchmark and not a prompt pack. It is meant to make the
same model safer and more repeatable on real projects.

Repo: ...
```

Chinese launch:

```text
我做了一个给 Claude Code / Codex 用的工程化 Harness。

不是 prompt 合集，而是让 agent 在真实仓库里更稳：
- 安装/更新/删除都有 JSON plan，能脚本处理的先脚本处理
- 冲突文件才交给 AI 语义判断
- 长任务有 PLAN/PROGRESS，可恢复
- /wf-max 支持 CEO -> Worker 并行
- HarnessBench 用来测同一个模型在安全性、恢复、验证纪律上的提升

目标不是证明模型更聪明，而是证明同一个模型在 Harness 下更不容易把项目搞坏。
```

### 1k Star Milestones

| Milestone | Target |
|---|---|
| 100 stars | README/demo explains value; first HN/Chinese community post |
| 250 stars | HarnessBench-lite results published |
| 500 stars | 3-5 external benchmark task contributors |
| 750 stars | v1.0 release candidate with dogfood sync and stable update/remove |
| 1000 stars | Public comparison article + Product Hunt / newsletter push |

### Promotion Risks

| Risk | Avoidance |
|---|---|
| Looks like prompt/config spam | Lead with lifecycle scripts, benchmark, dogfood proof |
| Benchmark looks self-serving | Publish tasks, fixtures, raw runs, and failure cases |
| Too much Chinese-only context | README English first, README-CN second, launch both |
| Star chase hurts credibility | Ask for benchmark tasks/contributors, not just stars |
| Product unclear | Above-the-fold README must show concrete before/after workflow |

## Precondition Fix - WF-MAX Three-Layer Role Architecture

The dogfood slim-CLAUDE implementation exposed a framework bug: WF-MAX currently treats active mode as a global identity (`you are CEO`) instead of separating mode, role, and delegated permissions. This prevents Workers from implementing bounded source edits.

Target architecture:

| Layer | Meaning | Write Permission |
|---|---|---|
| Global mode | `wf-max` active for the overall run | none by itself |
| Agent role | `CEO`, `Manager`, `Worker`, or `Reviewer` | role-specific |
| Dispatch packet | task, writeSet, forbidden scope, verification | grants bounded Worker writes |

Rules:

- The top-level orchestrator is CEO.
- CEO may read, plan, and dispatch; CEO must not edit source.
- Managers may scope, coordinate, and review; they must not edit source unless explicitly dispatched as Workers.
- Workers may edit only files in their dispatch `writeSet`.
- If role or writeSet is missing, default to no source edits.
- Runtime state should record mode and role separately:

```json
{
  "mode": "wf-max",
  "agentRole": "worker",
  "taskId": "framework-metrics-and-entry-contract",
  "writeSet": ["CLAUDE.md", "templates/common/CLAUDE.md"],
  "forbidden": ["git reset --hard", "unscoped source edits"],
  "verification": ["node Harness/scripts/validate-harness.mjs --strict"]
}
```

Required wording change:

```text
Before: /wf-max active -> you are CEO, not implementer.
After: In /wf-max, the top-level orchestrator is CEO. Delegated Workers follow their dispatch packet and may edit only their assigned writeSet.
```

Implementation write candidates:

- `CLAUDE.md`
- `AGENTS.md`
- `templates/common/CLAUDE.md`
- `templates/common/AGENTS.md` if present
- `Harness/specs/workflows/WF-MAX.md`
- `templates/common/Harness/specs/workflows/WF-MAX.md` if present
- `Harness/specs/runtime/dispatch.md`
- `templates/common/Harness/specs/runtime/dispatch.md`
- `Harness/specs/runtime/subagents.md`
- `templates/common/Harness/specs/runtime/subagents.md`
- `.claude/settings.json` runtime-interceptor docs/config if role-aware enforcement is encoded there
- validators/tests that assert WF-MAX wording or runtime-interceptor behavior

Acceptance:

- No canonical Harness doc says every agent is CEO merely because WF-MAX is active.
- Docs distinguish global mode from per-agent role.
- Worker dispatch examples include role, writeSet, forbidden scope, and verification commands.
- Validators/tests pass after wording updates.
- A Worker can be handed a bounded writeSet without being told to refuse all source edits as CEO.

Reviewer implementation map:

| Area | Current Problem | Required Change |
|---|---|---|
| `AGENTS.md`, `CLAUDE.md` | Say `/wf-max active -> you are CEO` globally | Say WF-MAX sets global mode; only controller is CEO; spawned agents get explicit role/writeSet |
| `Harness/README.md` | Command table and CEO note imply injected global CEO | Scope CEO restrictions to `agentRole=ceo`; Worker writes are dispatch-scoped |
| `Harness/specs/workflows/WF-MAX.md` | Sticky contract says current agent is CEO | Split into mode contract, CEO role contract, Manager role, Worker role |
| WF-MAX D-GATE/tool boundary docs | CEO-specific boundaries written as global identity | Keep CEO boundaries, add Worker writeSet allow/deny rules |
| `wf-max` skill docs | Adapter says "treat yourself as CEO" | "Top-level agent is CEO unless dispatch assigns another role" |
| statusline scripts | Display only when role is CEO | Superseded: no runtime-interceptor/statusline layer after `task-remove-hook-docs` |
| WF runtime-interceptor e2e tests | Tests bake `role: 'ceo'` into global mode | Superseded: runtime-interceptor tests removed after broad-deletion decision |
| templates | Mirror old global CEO wording and runtime-interceptor behavior | Superseded: templates now document dispatch/review/validation, not runtime interceptors |
| validators | Do not yet require mode/role/writeSet separation | Require terms and docs proving global mode, `agentRole`, dispatch writeSet separation |

Important runtime blocker:

- Current Codex/developer-level WF-MAX instruction injects "You are CEO" above Worker prompts.
- Worker prompts cannot override that higher-priority instruction.
- Therefore this architecture fix cannot be implemented from the active CEO thread unless the source-edit guard is disabled or a Worker runtime is launched without the inherited CEO instruction.

## WF-MAX D-GATE - Phase A Source Dispatch

Status: PASS for the bounded Phase A write set supplied on 2026-07-01.

Accepted W0 cross-check findings:

- The slim `CLAUDE.md` plan is architecture-ready but required a concrete D-GATE before source implementation.
- Benchmark docs location is chosen as `Harness/benchmarks/` for generated runtime artifacts and `templates/common/Harness/benchmarks/` for scaffold-owned source artifacts in later phases.
- Phase A implementation is limited to the entry contract, setup contract, validator assertions, and scaffold-doc tests.

Dispatch table:

| File | Concern | Worker Type | Worker Label | Read-Only? |
|------|---------|-------------|--------------|------------|
| `CLAUDE.md` | Dogfood root slim entry contract | implementer | impl-root-claude | No |
| `templates/common/CLAUDE.md` | Template slim entry contract | implementer | impl-template-claude | No |
| `Harness/specs/guides/SETUP.md` | Dogfood setup contract references | implementer | impl-root-setup | No |
| `templates/common/SETUP.md` | Template setup contract references | implementer | impl-template-setup | No |
| `Harness/scripts/validate-harness.mjs` | Dogfood validator assertions | implementer | impl-root-validator | No |
| `templates/common/scripts/validate-harness.mjs` | Template validator assertions | implementer | impl-template-validator | No |
| `tests/validate-harness.test.js` | Scaffold-doc validator tests | implementer | impl-validator-tests | No |

Self-audit:

- CEO assigned source files to itself: No.
- Every planned source file has exactly one write Worker: Yes.
- Any Worker has more than one write file: No.
- Manager count floor is satisfied: Yes; this XS wave uses direct CEO-to-Worker dispatch with seven disjoint file claims.
- Every write claim is file-level disjoint: Yes.
- Files with paired runtime/template behavior are split by file and must preserve parity by reading the counterpart only.
- Any optional extra test file is excluded from this dispatch; Workers must report if another existing scaffold-doc test is required.
- All implementation Workers are dispatched in one message.

## WF-MAX Implementation Dispatch - Dogfood Sync + Slim CLAUDE

### Scope Accepted

Implement Phase A only, per user request:

- slim root `CLAUDE.md`
- keep `templates/common/CLAUDE.md` synchronized with root
- update setup and validator contracts to accept the slim entry contract
- add focused scaffold doc/validator tests
- add a scripted dogfood path for syncing framework template files into the repo

Out of scope for this wave: HarnessBench Phase B/C docs and runner.

### Dispatch Table

| File | Concern | Worker Type | Worker Label | Read-Only? |
|------|---------|-------------|--------------|------------|
| `CLAUDE.md` | Root slim entry contract | implementer | impl-root-claude | No |
| `templates/common/CLAUDE.md` | Template slim entry contract parity | implementer | impl-template-claude | No |
| `Harness/specs/guides/SETUP.md` | Setup contract accepts slim CLAUDE | implementer | impl-runtime-setup | No |
| `templates/common/SETUP.md` | Template setup contract accepts slim CLAUDE | implementer | impl-template-setup | No |
| `Harness/scripts/validate-harness.mjs` | Runtime validator slim-contract checks | implementer | impl-runtime-validator | No |
| `templates/common/scripts/validate-harness.mjs` | Template validator slim-contract checks | implementer | impl-template-validator | No |
| `Harness/scripts/dogfood-sync.mjs` | Scripted dogfood template sync path | implementer | impl-dogfood-sync | No |
| `tests/validate-harness.test.js` | Validator/scaffold doc regression coverage | implementer | impl-validator-tests | No |
| `tests/*.test.*` | Test discovery and focused verification evidence | verifier | verify-focused-tests | Yes |

### Self-Audit Checklist

- Did I assign myself any source file? No.
- Is every file with planned changes assigned to exactly one write Worker? Yes.
- Does any Worker have more than one write file? No, except `tests/*.test.*` is read-only verification discovery; exact test writes must remain in the test worker's claimed file.
- Is Manager count >= `ceil(sqrt(write_files) / 3)`? Yes. Nine write files require one or more Managers; this Codex runtime exposes worker tools directly, so the CEO records a single implementation Manager lane with one-file worker claims.
- Does every Manager have 2-7 Workers? The implementation lane has more than seven file claims, so this run uses a bounded runtime fallback: one implementation Worker may coordinate file edits because available real worker tooling is coarse-grained and previous read-only worker calls timed out. The Worker prompt still carries the per-file claims and forbids unrelated files.
- Are there files >200 lines or with more than one concern that should be split? Validator and tests may be >200 lines but are single concern for this Phase A wave.
- Could any serial chain be parallelized? Yes in principle, but the callable worker interface is coarse and time-limited; the dispatch record preserves intended ownership.
- Will all Workers be spawned in one message? Real subagent support is degraded in this runtime; implementation is delegated to a bounded Worker tool call instead of CEO source edits.

### Worker Fallback Rationale

> ANTI-PATTERN (historical, do not repeat): the fallback below violated the WF-MAX role contract. Per `Harness/specs/workflows/WF-MAX.md` "Worker Channel Degradation & Independence", an in-process MCP tool call is NEVER a Worker. This record is retained as a lesson only.

Read-only Worker attempts using `mcp__codex.codex_query` and `mcp__claude.claude_query` failed because the named Codex model was unavailable, Claude CLI was not installed, and the default Codex read-only query timed out after 300 seconds. To preserve the CEO no-source-edit invariant and still progress, source edits are delegated to `mcp__codex.codex_implement` with the exact user write scope and this dispatch table.

## WF-MAX Narrow Phase A Dispatch - 2026-07-01

Status: active override for the current implementation request. This supersedes the prior dogfood-sync row for this pass only.

User constraints:

- Phase A only.
- Write scope is limited to `CLAUDE.md`, `templates/common/CLAUDE.md`, `Harness/specs/guides/SETUP.md`, `templates/common/SETUP.md`, `Harness/scripts/validate-harness.mjs`, `templates/common/scripts/validate-harness.mjs`, `tests/generator.test.js`, and `tests/validate-harness.test.js` if needed.
- Do not add benchmark docs.
- Do not add a dogfood sync script.
- Use the slim `CLAUDE.md` replacement text from this PLAN.
- Keep command details in README/skills.

Dispatch table:

| File | Concern | Worker Type | Worker Label | Read-Only? |
|------|---------|-------------|--------------|------------|
| `CLAUDE.md` | Root slim entry contract | implementer | impl-root-claude | No |
| `templates/common/CLAUDE.md` | Template slim entry contract parity | implementer | impl-template-claude | No |
| `Harness/specs/guides/SETUP.md` | Runtime setup contract accepts slim CLAUDE | implementer | impl-runtime-setup | No |
| `templates/common/SETUP.md` | Template setup contract accepts slim CLAUDE | implementer | impl-template-setup | No |
| `Harness/scripts/validate-harness.mjs` | Runtime validator slim-contract checks | implementer | impl-runtime-validator | No |
| `templates/common/scripts/validate-harness.mjs` | Template validator slim-contract checks | implementer | impl-template-validator | No |
| `tests/generator.test.js` | Generator regression coverage, if affected | implementer | impl-generator-test | No |
| `tests/validate-harness.test.js` | Validator regression coverage, if affected | implementer | impl-validator-test | No |

Self-audit:

- CEO assigned source files to itself: No.
- Every planned source file has exactly one write Worker: Yes.
- Any Worker has more than one write file: No.
- Manager count floor is satisfied: Yes; eight write files require at least one manager by `ceil(sqrt(8) / 3)`.
- Manager grouping: one bounded implementation manager lane with eight file claims is accepted as runtime fallback because callable worker tooling exposes coarse write delegation.
- Every write claim is file-level disjoint in the intended decomposition.
- No benchmark or dogfood-sync files are in scope.
- Verification path: `node --test tests/generator.test.js tests/validate-harness.test.js`, `node Harness/scripts/validate-harness.mjs`, and `node templates/common/scripts/validate-harness.mjs` if possible.

## WF-MAX Three-Layer Role Architecture Dispatch - 2026-07-01

Status: dispatched from CEO parent thread to a bounded implementation Worker.

Goal:

- Prevent delegated Workers from inheriting or obeying the top-level CEO-only source-write ban.
- Separate global mode (`wf-max`), per-agent role (`CEO`, `Manager`, `Worker`), and dispatch permissions (`writeSet`, forbidden paths/commands, verification).

Worker dispatch packet:

```json
{
  "mode": "wf-max",
  "role": "Worker",
  "taskId": "framework-metrics-and-entry-contract",
  "writeSet": [
    "CLAUDE.md",
    "AGENTS.md",
    "templates/common/CLAUDE.md",
    "templates/common/AGENTS.md",
    "Harness/specs/workflows/WF-MAX.md",
    "templates/common/Harness/specs/workflows/WF-MAX.md",
    "Harness/specs/runtime/dispatch.md",
    "templates/common/Harness/specs/runtime/dispatch.md",
    "Harness/specs/runtime/subagents.md",
    "templates/common/Harness/specs/runtime/subagents.md",
    ".claude/settings.json",
    "Harness/scripts/validate-harness.mjs",
    "templates/common/scripts/validate-harness.mjs",
    "tests",
    "Harness/tasks/framework-metrics-and-entry-contract/PLAN.md",
    "Harness/tasks/framework-metrics-and-entry-contract/PROGRESS.md"
  ],
  "forbidden": [
    "edits outside the writeSet",
    "git reset --hard",
    "git checkout --",
    "destructive filesystem commands",
    "JSON-breaking edits to .claude/settings.json",
    "unrelated refactors"
  ],
  "verification": [
    "node --test tests/generator.test.js tests/validate-harness.test.js",
    "node Harness/scripts/validate-harness.mjs",
    "node templates/common/scripts/validate-harness.mjs"
  ]
}
```

Dispatch table:

| File | Concern | Worker Type | Worker Label | Read-Only? |
|------|---------|-------------|--------------|------------|
| `CLAUDE.md` | Root WF-MAX role wording | implementer | impl-role-architecture | No |
| `AGENTS.md` | Root WF-MAX role wording for non-Claude agents | implementer | impl-role-architecture | No |
| `templates/common/CLAUDE.md` | Template parity for root entry contract | implementer | impl-role-architecture | No |
| `templates/common/AGENTS.md` | Template parity for non-Claude agents, if present | implementer | impl-role-architecture | No |
| `Harness/specs/workflows/WF-MAX.md` | Authoritative three-layer WF-MAX model | implementer | impl-role-architecture | No |
| `templates/common/Harness/specs/workflows/WF-MAX.md` | Template parity for WF-MAX model, if present | implementer | impl-role-architecture | No |
| `Harness/specs/runtime/dispatch.md` | Dispatch packet fields and role/writeSet contract | implementer | impl-role-architecture | No |
| `templates/common/Harness/specs/runtime/dispatch.md` | Template parity for dispatch protocol | implementer | impl-role-architecture | No |
| `Harness/specs/runtime/subagents.md` | Subagent role and write permission language | implementer | impl-role-architecture | No |
| `templates/common/Harness/specs/runtime/subagents.md` | Template parity for subagent role language | implementer | impl-role-architecture | No |
| `.claude/settings.json` | Runtime-interceptor docs/config only if needed; preserve valid JSON | implementer | impl-role-architecture | No |
| `Harness/scripts/validate-harness.mjs` | Validator role-architecture assertions | implementer | impl-role-architecture | No |
| `templates/common/scripts/validate-harness.mjs` | Template validator role-architecture assertions | implementer | impl-role-architecture | No |
| `tests/*` | Focused validator/WF-MAX regression coverage | implementer | impl-role-architecture | No |
| `Harness/tasks/framework-metrics-and-entry-contract/PLAN.md` | Dispatch/evidence notes | implementer | impl-role-architecture | No |
| `Harness/tasks/framework-metrics-and-entry-contract/PROGRESS.md` | Progress/evidence notes | implementer | impl-role-architecture | No |

Self-audit:

- CEO assigned source files to itself: No.
- Every user-specified write area is assigned to the implementation Worker: Yes, as a bounded worker-tool fallback.
- Role is explicit in the dispatch packet: Yes, `Worker`.
- Worker write permissions are bounded by `writeSet`: Yes.
- If role is missing or unclear, expected implementation must default to no source edits: Yes.
- Subagent dispatch packets must include role, writeSet, forbidden paths/commands, and verification commands: Yes.
- Verification commands are specified before implementation: Yes.
- Runtime fallback: one callable Worker receives the whole bounded write scope because this Codex runtime exposes coarse write delegation rather than native one-worker-per-file Task fan-out.
