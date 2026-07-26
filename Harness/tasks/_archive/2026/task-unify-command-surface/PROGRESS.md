# task-unify-command-surface - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived
- Next: User review.
- Blocker: none

## Tasks

- [x] Define goal and acceptance criteria
- [x] Move `wf-browser` into common built-ins
- [x] Remove optional `browser-e2e`
- [x] Add/validate command and skill parity
- [x] Remove Codex custom WF status runtime and hooks
- [x] Run validator and focused tests

## Changes

- Created task capsule after explicit `$wf`.
- Added common Claude/OpenCode command wrappers for the WF command family and Codex skill shims where needed.
- Added `wf-help` compatibility skill for Codex `$wf-help`.
- Moved browser automation guidance into built-in `wf-browser`; removed the optional `browser-e2e` files and catalog entry.
- Removed Codex custom WF status config, hooks, script, docs, and tests after confirming Codex has no documented command-backed status bar/statusline.
- Updated generator/update/remove/scan/validator logic and tests for retired `browser-e2e` compatibility.

## Verification

- PASS: `node --test tests/generator.test.js`
- PASS: `node --test tests/cli-smoke.test.js`
- PASS: `node --test tests/validate-harness.test.js`
- PASS: `node --test tests/ownership-manifest.test.js`
- PASS: `node --test tests/update-collision.test.js`
- PASS: `node --test tests/p0-blockers.test.js`
- PASS: `node Harness/scripts/validate-harness.mjs` (warning only: 6 outer task capsules; archive reminder)
- PASS: `node scripts/build-version.mjs --check`
- PASS: `node tests/e2e-wf-scripts.test.mjs`
- PASS: `npm test`
- PASS: removed Codex custom WF status script/config/hook references; remaining `harness-wf-status` references are OpenCode startup/toast plugin references.

## Notes

- Explorer subagent for `browser-e2e` reference audit errored before completion; proceeding locally with bounded audit.
