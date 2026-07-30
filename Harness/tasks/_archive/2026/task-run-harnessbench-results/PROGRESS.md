# task-run-harnessbench-results - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived
- Next: Final task-state validation, then mark task complete.
- Blocker: none

## Tasks

- [x] Define goal and scope
- [x] Add external benchmark scorer/results
- [x] Run benchmark scorer and validation tests
- [x] Update README/README-CN with measured result summary
- [x] Complete independent review

## Changes

- Created task capsule for external HarnessBench proof run.
- Added external `benchmarks/` proof assets, `scripts/harness-bench.mjs`, and scorer test.
- Updated README/README-CN with deterministic lifecycle proof results and adjacent-tool comparison.
- Fixed README release heading to 0.8.16 and added README table drift guard in `tests/harness-bench.test.js`.
- Archived old verified `task-unify-command-surface` with `node Harness/scripts/task-state.mjs archive --apply --keep 5 --json` to restore the task cap.

## Verification

- PASS: `node scripts/harness-bench.mjs --input benchmarks/results/harnessbench-local-v0.1.json --markdown`
- PASS: `node --test tests/harness-bench.test.js tests/generator.test.js`
- PASS: `node --test tests/update-collision.test.js tests/ownership-manifest.test.js tests/task-state.test.js tests/harness-bench.test.js tests/generator.test.js tests/validate-harness.test.js`
- PASS: `npm test` (217 pass, 1 skip)
- PASS: `node Harness/scripts/task-state.mjs validate --strict --json`
- PASS: `node Harness/scripts/validate-harness.mjs`
- PASS: `node templates/common/Harness/scripts/validate-harness.mjs`
- PASS: `node scripts/build-version.mjs --check`
- PASS: independent reviewer

## Notes

- Benchmark files must remain outside generated Harness installs.
- Current proof is deterministic lifecycle proof, not a full LLM task-success A/B claim.
