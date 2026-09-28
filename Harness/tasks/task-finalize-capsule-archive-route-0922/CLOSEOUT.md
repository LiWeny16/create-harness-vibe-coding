# Closeout: task-finalize-capsule-archive-route-0922

Date: 2026-09-28  
Status: acceptance complete; closed through `task-state transition`. The capsule itself remains live and was not archived.

## Result

The archive path now has one state writer, route derivation is read-only, lock recovery requires positive proof that the owner process is gone, and safe archival rejects pending/owned work. Archive source and template copies match byte-for-byte.

## Acceptance

| AC | Result | Evidence |
|---|---|---|
| AC-001 | Pass | `npm test`: 610 passed, 1 skipped, 0 failed. |
| AC-002 | Pass | Focused capsule routing and closeout suite: 84/84 passed. |
| AC-003 | Pass | `npm run test:e2e`: 177/177 passed; full UI E2E status passed (126 passed, 2 retried/flaky). |
| AC-004 | Pass | `npm run pack:smoke`: 3/3 passed. |
| AC-005 | Pass | `node Harness/scripts/validate-harness.mjs --strict` passed after the task state transition. |
| AC-006 | Pass for local source/template mirrors; broader legacy check has an unrelated upstream version mismatch. | SHA-256 matches for `task-state.mjs`, `auto-archive-session-start.mjs`, `lib/task-route.mjs`, and `archive-tasks.mjs` against their `templates/common` copies. `npm run check:mirrors` reports canonical `LiWeny16` main/tag passing, but legacy `zingspark` main is 0.9.4 vs package 0.9.5 and legacy tag v0.9.5 is HTTP 404. No external repository was modified. |
| AC-007 | Pass | `git diff --check` passed after closeout edits. |
| AC-008 | Pass | `capsule-routing.test.js` covers live/archive routing, context omission, and the 8 KB route bound. |
| AC-009 | Pass | Root suite covers legacy `--keep` and `--group` compatibility. |
| AC-010 | Pass | Regression tests verify a closed capsule without verified closeout remains live. |
| AC-011 | Pass | Regression tests verify the current focus capsule is not archived. |
| AC-012 | Pass | Concurrent SessionStart and live-PID/stale-lock tests passed. |
| AC-013 | Pass | Fault-injection tests verify route/index rollback on move and index-write failure. |
| AC-014 | Pass | Route tests cover live and archived capsules. |
| AC-015 | Pass | Archive integration tests verify task/root index refresh. |
| AC-016 | Pass | Archive tests verify shared stable `routeRevision` and reindex changes. |
| AC-017 | Pass | Active owner, lease, and lock marker regression tests passed. |

## Review and verification

- Focused archive tests: 84/84 passed.
- Root suite: 610 passed, 1 skipped, 0 failed.
- Root E2E: 177/177 passed.
- Pack smoke: 3/3 passed.
- Independent archive review verified path bounds, queue/owner eligibility, lock recovery, rollback, route size, and source/template parity.
- `npm run check:mirrors` is not fully green because the external legacy `zingspark` repository lacks the package's 0.9.5 mirror/tag; the canonical mirror and all local archive source/template pairs pass.

No archive move, commit, push, or package publish was performed.
