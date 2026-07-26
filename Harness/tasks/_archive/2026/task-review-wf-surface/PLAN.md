# task-review-wf-surface - PLAN

Compact task record. Keep only facts needed to resume, review, and verify.

## Goal

- Outcome: Review the current staged/worktree changes and determine whether the `wf-max`, `wf-help`, and `wf-browser` problems are actually fixed.
- Non-goals: Do not revert unrelated existing worktree changes. Do not broaden this task into a release or redesign unless the review finds a blocking issue.

## Decisions

- Use WF-Standard review: multi-file Harness surface changes with one independent review lens and full verification commands.
- Treat current worktree as authoritative; previous chat context is only a pointer.
- Benchmark/README changes from the prior turn are in scope only for package/distribution boundary checks.

## Acceptance

- AC-001: Current staged and unstaged worktree scope is inventoried, with staged vs unstaged state called out.
- AC-002: `wf-max`, `wf-help`, and `wf-browser` fixes are checked against their authoritative docs, generated templates, runtime command wrappers, mirrors, and tests.
- AC-003: Package/distribution boundaries are checked so external benchmark assets and retired browser-e2e assets do not leak into generated installs or npm package files.
- AC-004: Targeted tests, full test suite, task-state validation, build-version check, and strict Harness validator pass, or any failures are recorded with next action.

## Scope

Allowed write set:
- `Harness/tasks/task-review-wf-surface/**`
- Minimal fixes to `wf-max`, `wf-help`, `wf-browser`, benchmark, README, template mirror, manifest, or tests if the review finds a blocking defect.

Forbidden:
- Reverting unrelated user/worktree changes.
- Editing release/package metadata unless required by a verified boundary issue.
- Treating passing tests as sufficient without checking the named command surfaces.

## Memory Preflight

- Memory preflight: done
- Memory hints: none

## Context

- Loaded: `CLAUDE.md`, `Harness/MEMORY.md`, `Harness/README.md`, `.agents/skills/wf*/SKILL.md`, `Harness/specs/workflows/WF.md`, `Harness/specs/workflows/WF-MAX.md`, `Harness/specs/workflows/WF-KERNEL.md`, `Harness/specs/runtime/subagents.md`, `Harness/specs/runtime/dispatch.md`
- Assumptions: User wants a review of current local changes, not a commit or release.

## Agents

| Role | Read / Write Set | Result |
|------|------------------|--------|
| controller | read current worktree; fixed scoped wf-help/wf-browser validator drift; updated task state | Complete |
| wf-help reviewer | read-only scoped review of wf-help direct/compat surfaces | No issues found |
| wf-browser reviewer | read-only scoped review of wf-browser/browser-e2e retirement and Browser Use docs | No issues found |
| wf-max reviewer | read-only scoped review of wf-max fanout/config surfaces | Timed out; closed after local review and full tests passed |

## Verification

- [x] `git diff --cached --stat`
- [x] `git diff --stat`
- [x] `rg` checks for stale `browser-e2e`, scalar Codex caps, old Browser Use commands, stale benchmark claims
- [x] `node --test tests/generator.test.js tests/validate-harness.test.js`
- [x] `node --test tests/cli-smoke.test.js tests/ownership-manifest.test.js tests/p0-blockers.test.js tests/anti-drift.test.js tests/pack-smoke.test.js`
- [x] `node --test tests/harness-bench.test.js`
- [x] `npm test`
- [x] `node Harness/scripts/task-state.mjs validate --strict --json`
- [x] `node scripts/build-version.mjs --check`
- [x] `node Harness/scripts/validate-harness.mjs --strict`

## Risks

- The worktree already contains many unrelated dirty files from earlier work; review findings must separate this task's scope from pre-existing changes.
- Some tests may pass without proving runtime command text is correct, so command files and skill mirrors need direct inspection.

## Expanded Contracts

### Validation Matrix

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
| AC-001 | Pass | `git diff --cached --stat` empty; `git status --porcelain=v1` shows all changes are unstaged/untracked | Worktree is intentionally dirty from prior work; no staged changes existed. |
| AC-002 | Pass | Direct inspection plus tests: wf-help direct command/compat surfaces, wf-browser built-in mirrors, wf-max OpenCode depth and Codex config guard | Fixed false `.opencode/skills/` wf-help wording and synchronized validator guard for wf-browser Browser Use sentence. |
| AC-003 | Pass | `tests/harness-bench.test.js`; `pack-smoke`; retired browser-e2e no-op tests; ownership manifest tests | Benchmark assets remain external-only and retired browser-e2e assets do not install/package as active workflow files. |
| AC-004 | Pass | `npm test` 219 pass / 1 skip; `validate-harness --strict` pass; `build-version --check` pass; `task-state validate --strict --json` pass | wf-max independent reviewer timed out, but local scoped review and full suite passed. |
