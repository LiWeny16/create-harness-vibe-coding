# task-wf-full-role-chain - PROGRESS

## Status

- Phase: Verified
- Next: none.
- Blocker: none

## Tasks

- [x] Confirm user decisions
- [x] Add reflector agent
- [x] Require full WF role chain and cross-review gate
- [x] Make WF-MAX a WF strict superset with cross-CLI overflow
- [x] Extend WF chain inheritance to wf-auto/spark and codify runtime thread-budget limits
- [x] Verify tests
- [x] Cross-review

## Changes

- Added `reflector` agent and template.
- Updated WF/WF-MAX/subagents/dispatch/agent-workflow/acceptance/router docs.
- Updated WF-AUTO/SPARK inheritance and WF-MAX thread-budget/overflow docs.
- Set generated Codex WF-MAX defaults to `max_threads = 12`, `max_depth = 1`; raise further only after user confirmation.
- Updated validators/tests and version manifest.

## Verification

- PASS: `node --test tests/generator.test.js tests/validate-harness.test.js`
- PASS: `node Harness/scripts/validate-harness.mjs --strict`
- PASS: `node tests/e2e-wf-scripts.test.mjs`
- PASS: `npm test`
- PASS: `node scripts/build-version.mjs --check`
- PASS: `node Harness/scripts/wf-update-check.mjs --json`
- PASS: `node Harness/scripts/scan-clean.mjs --json --source-base file:///.../templates/common/`
- PASS: final reviewer after fixes
- PASS: `git diff --check` (CRLF warnings only)

## Notes

- Historical task records left untouched.
- Official Codex unset default is 6 threads / depth 1; Harness scaffold now defaults WF-MAX to 12 threads / depth 1.
- Fixed reviewer blockers: WF-MAX debug order, AGENTS closeout gate, mojibake/operator corruption, and JSON update-switch failure statuses.
