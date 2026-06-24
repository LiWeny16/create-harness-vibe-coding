# PLAN.md - Active Execution Plan

Use this file when work spans more than one step, one file, or one agent.

## Current Goal

Dogfood the generated Harness scaffold inside this repository so future agents use root `Harness/` routing instead of stale `docs/harness/` guidance.

## Phase

Current: Verify

## Heartbeat

Mode: normal
Last beat: 2026-06-24 dogfood bootstrap
Current phase: Verify
Current blocker: none
Next beat trigger: next follow-up review or cleanup task
Failure count: 0
Recovery action: none

Update this section before long commands, after long commands, before and after subagent handoffs, after failed verification, and before stopping for user input. In `wf-mode`, use this as the resume point after context loss or interruption.

## Progress Rules

- Phase tracks lifecycle progress.
- Task status tracks execution progress.
- Update before handoff, after verification, and when blocked.

Allowed task statuses: Pending / In Progress / Blocked / Done / Verified.

- Pending: not started.
- In Progress: active work.
- Blocked: needs user input or external change.
- Done: task complete, evidence not final.
- Verified: verification evidence is recorded.

## Success Criteria

- [x] Root `CLAUDE.md` routes through `Harness/MEMORY.md` and `Harness/README.md`.
- [x] Root `MEMORY.md` no longer contains stale `docs/harness/` paths or template placeholders.
- [x] Root `Harness/` and `.claude/` dogfood runtime assets exist without overwriting existing `README.md`, `.gitignore`, or project source.
- [x] Harness strict validation passes.
- [x] Repository tests pass.

## Scope

Allowed write set:
- `CLAUDE.md`
- `MEMORY.md`
- `AGENTS.md`
- `.claude/**`
- `Harness/**`
- `tests/.gitkeep`

Forbidden:
- package publish metadata changes unless required by verification
- generated package contents outside `templates/`
- unrelated source refactors

## Loaded Context

- `Harness/README.md`
- `Harness/MEMORY.md`
- `templates/common/CLAUDE.md`
- `templates/common/MEMORY.md`
- `src/generator.js`
- `src/index.js`

## Tasks

| # | Task | Owner | Verify | Status |
| --- | --- | --- | --- | --- |
| 1 | Generate missing dogfood `Harness/` and `.claude/` files with conflict skip | main agent | dry-run and generation JSON output | Verified |
| 2 | Merge root `CLAUDE.md` and `MEMORY.md` into dogfood routing | main agent | validator required text checks | Done |
| 3 | Replace template placeholders in root dogfood project facts | main agent | `node Harness/scripts/validate-harness.mjs --strict` | Verified |
| 4 | Run repository regression checks | main agent | `npm test` and `git diff --check` | Verified |
| 5 | Move interactive confirmation after computed plan preview | main agent | `node --test tests/cli-smoke.test.js` | Verified |
| 6 | Tighten WF/subagent routing priority | main agent | `node --test tests/generator.test.js` | Verified |

## Parallel Dispatch

Use [subagents.md](subagents.md) and [dispatch.md](dispatch.md) when more than one agent or bounded pass is useful.

| Task | Agent | Mode | Read Set | Write Set | Depends On | Output | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dogfood bootstrap | main agent | Serial Write | root docs, generator dry-run, Harness templates | root `Harness/`, `.claude/`, `CLAUDE.md`, `MEMORY.md` | user approval | merged dogfood runtime | Verified |

## Subagent Synthesis

Agents used: Claude Code review report supplied by user; main agent verified findings against local files.
Findings accepted: root `CLAUDE.md` and root `MEMORY.md` were stale; dogfood install is the chosen fix.
Findings rejected: single `-y` does not overwrite critical files by itself; overwrite risk requires explicit conflict policy.
Conflicts: none.
Decisions: dogfood this repository with root `Harness/` while keeping source templates under `templates/`.
Next write set: none.
Verification path: strict harness validator, repository tests, diff whitespace check.
Residual risk: root dogfood files are intentionally outside npm package `files`; future template behavior still changes only through `templates/**`.

## Agent Handoffs

| Agent | Role | Context Pack | Result |
| --- | --- | --- | --- |
| Claude Code review | external reviewer | current repo diff and generated scaffold | identified root dogfood gap and related routing concerns |

## Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-06-24 | Dogfood the generated Harness scaffold in this repository | The project is the framework source; root agent docs should not point at stale generated-layout paths |
| 2026-06-24 | Keep scaffold source under `templates/` and dogfood runtime under root `Harness/` | Separates package source from this repository's operating harness |

## Verification

| Check | Result | Notes |
| --- | --- | --- |
| `node bin/create-harness-vibe-coding.js create-harness-vibe-coding . -y --dry-run --json` | Pass | showed only `.gitignore`, `CLAUDE.md`, and `README.md` conflicts |
| `node bin/create-harness-vibe-coding.js create-harness-vibe-coding . -y --on-conflict skip --json` | Pass | created missing dogfood files and skipped existing root files |
| `node Harness/scripts/validate-harness.mjs --strict` | Pass | strict project-fact placeholders resolved |
| `npm test` | Pass | 56/56 tests passed |
| `git diff --check` | Pass | no whitespace errors |
| `rg -n "docs/README\.md|docs/harness|\{\{projectName\}\}" CLAUDE.md MEMORY.md` | Pass | no stale root routing or template project name placeholder |
| `rg -n "[\u3400-\u9fff]" README.md` | Pass | no Chinese text in English README |
| `node --test tests/cli-smoke.test.js` | Pass | 23/23 tests passed; interactive fallback previews conflict plan before generation failure |
| `node --test tests/generator.test.js` | Pass | 25/25 tests passed; WF priority and subagent routing assertions covered |
| `npm test` | Pass | 57/57 tests passed after routing and CLI changes |
