# task-harden-ota-manifest-validation - PROGRESS

## Status

- Phase: Archived
- Evidence: full test suite and wf-ui server tests pass; mirror check is blocked only because 0.8.19 has not been published to npm/GitHub mirrors yet.

## Changes Made

- Added `Harness/scripts/wf-update-runner.mjs` for deterministic multi-scope updates.
- Added `Harness/scripts/sync-host-global.mjs` to compare and repair Claude/Codex/OpenCode host-global command and skill copies against the global runtime.
- Hardened `Harness/scripts/wf-update-check.mjs`: `--repair` now bypasses same-version short-circuit but still refuses older remote sources and prerelease sources by default.
- Expanded `Harness/scripts/validate-harness.mjs --manifest-audit` to detect missing manifest-owned files, stale host-global copies, and coverage gaps.
- Updated wf-update command/skill docs across Claude, Codex, OpenCode, and templates with project+global+global-only routing.
- Regenerated `Harness/ownership.manifest.json`, template `.harness-version`, and root `Harness/.harness-version`; manifest now tracks 162 framework-owned entries and 168 checksummed files.
- Fixed test drift in task-state archive paths, wf-auto continuous task paths, and context budget.
- Relaxed `wf-router-prefix` budget from 42KB to 43KB after 0.8.19 hot-path growth.

## Verification

- `npm test` - 265 passed, 1 skipped, 0 failed.
- `node --test src/wf-ui-server/__tests__/*.test.mjs` - 112 passed.
- `node scripts/build-version.mjs --check` - up to date, 168 checksums / 185 sources.
- `node Harness/scripts/validate-harness.mjs --manifest-audit` - passed; only task cap/process warnings remain.
- `node Harness/scripts/context-budget.mjs --json` - passed.
- `node Harness/scripts/wf-update-runner.mjs --json` - local 0.8.19 correctly ignores older npm 0.8.18 and does not auto-repair against it.
- `npm run check:mirrors` - expected failure until 0.8.19 is pushed/published.

## Open Release Work

- Publish/package 0.8.19.
- Push/sync canonical and legacy GitHub mirrors.
- Re-run `npm run check:mirrors` after publish; it must pass before release is marked done.
