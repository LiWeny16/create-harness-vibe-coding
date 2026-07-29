# task-release-stable-github - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Validation
- Next: User may run `npm publish`; commit, push, and tag remain pending for GitHub release completion.
- Blocker: none

## Tasks

- [x] Confirm remotes and current tag state
- [x] Create release task capsule
- [x] Bump version metadata to `0.8.18`
- [x] Run release-grade verification
- [x] Stage intended scope
- [ ] Commit intended scope
- [ ] Push `main` to both GitHub remotes
- [ ] Create and push `v0.8.18` tag to both GitHub remotes
- [ ] Verify final remote branch/tag SHAs

## Changes

- Archived `task-review-wf-surface` to keep the active task set within the Harness cap.
- Confirmed `main`, `origin/main`, and `legacy/main` are currently at `15e8706` with existing tag `v0.8.16`.
- Bumped `package.json`, `Harness/.harness-version`, and `templates/common/.harness-version` to `0.8.18`.
- Added `CHANGELOG.md` release notes for `0.8.18` so `.harness-version.releaseNotes` is populated.

## Verification

- `npm test`: 259 pass / 1 skip.
- `node Harness/scripts/validate-harness.mjs`: pass with task cap warning only.
- `node templates/common/Harness/scripts/validate-harness.mjs`: pass with task cap warning only.
- `node Harness/scripts/task-state.mjs validate --json`: pass with task cap warning only.
- `npm run build:version -- --check`: pass.
- `npm run pack:smoke`: 2 pass.
- `npm pack --dry-run`: `create-harness-vibe-coding-0.8.18.tgz`, 175 files, 1.8 MB package size.
- `npm publish --dry-run`: pass for `create-harness-vibe-coding@0.8.18`.
- `git diff --check`: pass.
- `npm view create-harness-vibe-coding version`: `0.8.17`.
- `npm run check:mirrors`: expected fail until `main` and `v0.8.18` are pushed to both GitHub remotes.

## Notes

- npm publishing is explicitly out of scope; user owns npm release.
- The packed tarball was written to system temp, not the repository.
