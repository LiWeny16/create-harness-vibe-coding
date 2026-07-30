# task-build-state-cli - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived
- Next: Report result to user.
- Blocker: None.

## Tasks

- [x] Define goal and acceptance criteria
- [x] Confirm existing archive/state drift
- [x] Implement task-state CLI
- [x] Wire archive compatibility and validator
- [x] Add tests
- [x] Run validation

## Changes

- Created task capsule for deterministic task-state and archive control.
- Added `Harness/scripts/task-state.mjs` with list, validate, reconcile, set-active, transition, and archive commands.
- Converted `Harness/scripts/archive-tasks.mjs` into a compatibility wrapper.
- Updated validator, WF-STATE/TASK_ARCHIVE docs, template mirrors, ownership manifests, and generator coverage.
- Reconciled existing task drift and archived 3 completed task capsules, reducing outer tasks from 8 to 5.

## Verification

- PASS: `node --test tests\task-state.test.js`
- PASS: `node --test tests\generator.test.js tests\validate-harness.test.js`
- PASS: `node Harness\scripts\task-state.mjs validate --strict --json`
- PASS: `node Harness\scripts\validate-harness.mjs --strict`
- PASS: `node scripts\build-version.mjs --check`
- PASS: `npm test`
- PASS: `node tests\e2e-wf-scripts.test.mjs`
