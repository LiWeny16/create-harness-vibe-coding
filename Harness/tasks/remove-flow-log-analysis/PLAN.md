# remove-flow-log-analysis - PLAN

## Goal

Make Harness removal mirror the improved install pattern:

- script produces a machine-readable plan
- script performs deterministic cleanup
- AI/user only decide explicit purge and modified-file choices
- default remains safe, but an explicit thorough mode can remove leftover Harness project-fact files

## Acceptance Criteria

- [x] Explain why `log2.log` left `Harness/memory`, `research`, `architecture`, `PROGRESS`, tasks, and `.harness-version`.
- [x] `wf-remove.mjs --json` reports preserved user data that is not in checksums.
- [x] A thorough mode can delete Harness user-data leftovers while preserving real task records.
- [x] `wf-update-check.mjs --json` gives agents enough source metadata and commands to script SAFE/NEW work before AI conflict handling.
- [x] Skill docs tell agents which command to use for thorough cleanup and safe update apply.
- [x] E2E tests pass.

## Scope

Allowed write set:
- `Harness/scripts/wf-remove.mjs`
- `templates/common/scripts/wf-remove.mjs`
- `Harness/scripts/wf-update-check.mjs`
- `templates/common/scripts/wf-update-check.mjs`
- `.claude/skills/wf-remove/SKILL.md`
- `.agents/skills/wf-remove/SKILL.md`
- `.claude/skills/wf-update/SKILL.md`
- `.agents/skills/wf-update/SKILL.md`
- `tests/e2e-wf-scripts.test.mjs`
- `Harness/tasks/remove-flow-log-analysis/`
- `Harness/PROGRESS.md`

Forbidden:
- Running destructive removal against this source repository.
- Reverting unrelated worktree changes.

## Loaded Context

- `CLAUDE.md`
- `Harness/MEMORY.md`
- `Harness/README.md`
- `Harness/PROGRESS.md`
- `.agents/skills/wf-remove/SKILL.md`
- `temp/log2.log`
- `Harness/.harness-version`
- `Harness/scripts/wf-remove.mjs`
- `templates/common/scripts/wf-remove.mjs`
- `tests/e2e-wf-scripts.test.mjs`

## Subagent Dispatch

| Agent | Mode | Read Set | Write Set | Status |
|-------|------|----------|-----------|--------|
| install-flow explorer | read-only | install CLI/docs/tests | none | Complete |
| remove-flow explorer | read-only | log2 + wf-remove script/docs/tests | none | Complete |
| update-flow explorer | read-only | wf-update script/docs/tests | none | Complete |

## Findings

- `log2.log` shows the script removed SAFE files, then the agent manually removed 4 MODIFIED files.
- Remaining files were intentional under the old rules: `Harness/PROGRESS.md`, `Harness/tasks/**`, `Harness/memory/**`, `Harness/research/PRD.md`, `Harness/research/research-results.md`, and `Harness/architecture.md` were USER DATA.
- `.harness-version` remained because `Harness/` still contained preserved files.
- The old script only classified files known from checksums plus a few extras, so untracked preserved files could remain without being fully visible in the JSON plan.
- `wf-update-check.mjs` had the same shape problem: JSON lacked agent-ready remote source hints, and `--apply` refused all work when any conflict existed.

## Subagent Synthesis

- Install flow: current JSON dry-run already supports script-first conflict handling; remaining gains are broader scan hints, not a blocker for this task.
- Remove flow: add an explicit purge mode, keep real task records by default when requested, expose exact modified-file deletion commands, and never purge root project files such as `README.md`, `.gitignore`, or package manifests.
- Update flow: add `--apply-safe`, `agent.aiMergeRequired`, `templateHint`, `remoteUrl`, distinct downgrade/noop statuses, and avoid rewriting files whose local checksum already equals remote.

## Implemented

- `wf-remove.mjs --json --purge-user-data --keep-tasks` now reports `purge`, `options`, and `agent` guidance.
- `wf-remove.mjs --apply --yes --purge-user-data --keep-tasks` removes Harness project-fact leftovers while preserving real task records.
- `wf-remove.mjs --delete-modified <path>` lets AI/user approve exact modified scaffold file deletion without broad prompts.
- `wf-update-check.mjs --json` now includes `agent.safeApplyCommand`, `agent.aiMergeRequired`, `templateHint`, and `remoteUrl`.
- `wf-update-check.mjs --apply-safe` applies SAFE/NEW files even when conflicts remain, records `partialUpdate`, and does not bump the generator version until all conflicts are resolved.
- `wf-update-check.mjs` skips files already current with remote checksums and supports `WF_SOURCE_BASE` / `--source-base` for mirrored or local update sources.

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| `node --check Harness/scripts/wf-remove.mjs` | Pass | Runtime remove script parses |
| `node --check templates/common/scripts/wf-remove.mjs` | Pass | Template remove script parses |
| `node --check Harness/scripts/wf-update-check.mjs` | Pass | Runtime update script parses |
| `node --check templates/common/scripts/wf-update-check.mjs` | Pass | Template update script parses |
| `node tests/e2e-wf-scripts.test.mjs` | Pass | 128 passed, 0 failed |
| `npm test` | Pass | 65 passed, 1 skipped |
| `npm run test:smoke` | Pass | 23 passed, 1 skipped |
| `node Harness/scripts/validate-harness.mjs --strict` | Pass | Harness validation passed |
