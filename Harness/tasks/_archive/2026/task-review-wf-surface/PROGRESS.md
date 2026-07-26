# task-review-wf-surface - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived
- Next: Close out review findings to user.
- Blocker: none

## Tasks

- [x] Create WF review task capsule
- [x] Inventory staged and unstaged changes
- [x] Review `wf-max`, `wf-help`, and `wf-browser` command/skill surfaces
- [x] Review package and benchmark distribution boundaries
- [x] Run targeted and full verification
- [x] Record final findings and acceptance matrix

## Changes

- Created task capsule for this review.
- Fixed scoped `wf-help` command docs that incorrectly referenced a nonexistent `.opencode/skills/` directory.
- Added generator assertions and validator forbids so generated wf-help command docs cannot reintroduce `.opencode/skills/`.
- Deduplicated and synchronized the `wf-browser` Browser Use CLI removal sentence across `.claude`, `.agents`, and template mirrors.
- Updated the `wf-browser` validator guard to match the current generated contract and refreshed `.harness-version` metadata with `build-version`.

## Verification

- `node --test tests/generator.test.js tests/validate-harness.test.js`: 72 pass.
- `node --test tests/cli-smoke.test.js tests/ownership-manifest.test.js tests/p0-blockers.test.js tests/anti-drift.test.js tests/pack-smoke.test.js`: 83 pass / 1 skip.
- `node --test tests/harness-bench.test.js`: 3 pass.
- `node Harness/scripts/validate-harness.mjs --strict`: pass.
- `node scripts/build-version.mjs --check`: pass.
- `node Harness/scripts/task-state.mjs validate --strict --json`: pass.
- `npm test`: 219 pass / 1 skip.

## Notes

- Memory preflight done; no detailed memory file matched.
- `git diff --cached --stat` was empty, so there were no staged changes to review. Current worktree changes are unstaged/untracked.
- wf-help and wf-browser read-only reviewers found no remaining issues. wf-max reviewer timed out and was closed; local review confirmed OpenCode subagent depth, manager allowlists, and Codex config guard coverage.
