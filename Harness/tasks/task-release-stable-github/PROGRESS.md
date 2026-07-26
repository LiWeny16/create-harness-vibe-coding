# task-release-stable-github - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Verification
- Next: Commit staged release scope, then push branch and tag to both GitHub remotes.
- Blocker: none

## Tasks

- [x] Confirm remotes and current tag state
- [x] Create release task capsule
- [x] Bump version metadata to `0.8.17`
- [x] Run release-grade verification
- [x] Stage intended scope
- [ ] Commit intended scope
- [ ] Push `main` to both GitHub remotes
- [ ] Create and push `v0.8.17` tag to both GitHub remotes
- [ ] Verify final remote branch/tag SHAs

## Changes

- Archived `task-review-wf-surface` to keep the active task set within the Harness cap.
- Confirmed `main`, `origin/main`, and `legacy/main` are currently at `15e8706` with existing tag `v0.8.16`.
- Bumped `package.json`, `Harness/.harness-version`, and `templates/common/.harness-version` to `0.8.17`.
- Added `CHANGELOG.md` release notes for `0.8.17` so `.harness-version.releaseNotes` is populated.

## Verification

- `npm test`: 219 pass / 1 skip.
- `node Harness/scripts/validate-harness.mjs --strict`: pass.
- `node Harness/scripts/task-state.mjs validate --strict --json`: pass.
- `node scripts/build-version.mjs --check`: pass.
- `node --test tests/harness-bench.test.js tests/pack-smoke.test.js`: 5 pass.
- `git diff --check`: pass.
- Packed tarball smoke from `C:\Users\onion\AppData\Local\Temp\create-harness-vibe-coding-0.8.17.tgz`: `create-harness-vibe-coding --help` and `release-smoke-demo --dry-run --json` both executed through `npm exec --package`.

## Notes

- npm publishing is explicitly out of scope; user owns npm release.
- The packed tarball was written to system temp, not the repository.
