# task-make-wf-lifecycle-0908 - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived

## Heartbeat

- The canonical task-state writer, wf-ui parser/server, A2A snapshot, and UI source now share project, tags, dates, mode, active-focus, and resume metadata.
- Durable ownership is explicit at creation/entry: only `wf` and `wf-max` are managed; direct tasks and capability modes are never promoted.
- Managed task sessions inherit their task mode at the server boundary; direct-task binding to durable WF mode is rejected.
- Skills Hub Market/install remnants were removed from the UI surface; the standalone market module remains on disk for compatibility but is no longer wired into the Hub.
- `wf-learn` command/skill mirrors now enforce instance-fact isolation and the generalized Probe -> Identify -> Act -> Verify method gate. This turn modified the command contract only; it did not write memory.

## Verification

- Targeted lifecycle/parser/server/A2A tests: 95 passed.
- Full regression: 308 passed, 1 skipped, 0 failed.
- `node Harness/scripts/validate-harness.mjs --strict`: passed.
- `node Harness/scripts/task-state.mjs validate --strict --json`: passed; 5 task capsules, outer cap respected.
- A2A store regression: 14 passed; no direct-task fallback was reintroduced.
- `git diff --check`: passed.
- `pnpm --dir src/ui typecheck`: passed.
- `pnpm --dir src/ui build`: passed; production bundle regenerated.
- `node --test tests/wf-learn-contract.test.js`: 3 passed.
- Local release prep: package/package-lock/wf-ui server aligned to `0.9.1`; `node scripts/build-version.mjs --check` passed; `npm pack --dry-run` produced `create-harness-vibe-coding-0.9.1.tgz` (7.83 MB).
- Release pre-push gate: `npm run prepush` passed all 9 checks.

## Blocker

- none

## External release gate

- `npm run check:mirrors` remains intentionally pending: npm authentication is unavailable, remote `v0.9.1` tags are not present, and online canonical/legacy manifests still report older generators. No publish or remote push was performed.
