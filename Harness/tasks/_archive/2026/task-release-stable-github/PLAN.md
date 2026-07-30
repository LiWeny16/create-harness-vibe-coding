# task-release-stable-github - PLAN

Compact release record. Keep only facts needed to resume, verify, and audit.

## Goal

- Outcome: Raise release confidence to 95%, commit the current stable release scope, push it to both GitHub remotes, and publish the GitHub stable tag. The user will handle npm publishing.
- Version target: `0.8.18` / `v0.8.18`, because npm latest is `0.8.17` and published npm versions cannot be overwritten.
- Remotes: `origin` = `LiWeny16/create-harness-vibe-coding`; `legacy` = `zingspark/create-harness-vibe-coding`.

## Acceptance

- AC-001: Release scope is understood and staged intentionally; no unrelated files are silently omitted or added.
- AC-002: Version metadata and generated harness version manifests are synchronized for `0.8.18`.
- AC-003: Release-grade checks pass: full tests, strict Harness validation, task-state validation, version check, npm pack dry-run/package boundary, benchmark boundary.
- AC-004: Commit is created on `main` and pushed to both GitHub remotes.
- AC-005: `v0.8.18` tag is created on the release commit and pushed to both GitHub remotes.
- AC-006: Final remote state proves both GitHub repositories have the same branch commit and tag commit.

## Scope

Allowed:
- Commit current release-scope worktree changes after validation.
- Bump package/generator version from `0.8.17` to `0.8.18`.
- Push branch and tag to `origin` and `legacy`.

Forbidden:
- npm publish.
- Force push.
- Rewriting existing tags.
- Opening PRs unless the direct push is rejected.

## Verification

- [ ] `npm test`
- [ ] `node Harness/scripts/validate-harness.mjs --strict`
- [ ] `node Harness/scripts/task-state.mjs validate --strict --json`
- [ ] `node scripts/build-version.mjs --check`
- [ ] `node --test tests/harness-bench.test.js tests/pack-smoke.test.js`
- [ ] `npm pack --dry-run --json`
- [ ] Remote branch and tag SHA checks for `origin` and `legacy`

## Risks

- The worktree is large and mixed. Mitigation: inspect staged scope and run full validation after version bump.
- Current npm latest `0.8.17` already exists. Mitigation: create a new patch release tag only after commit.
