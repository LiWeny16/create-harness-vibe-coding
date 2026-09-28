# Finalize capsule archive route — Mini PRD and verification plan

## Goal

Make task archival a single-writer, recoverable operation. Safe auto-archive may move only verified closed capsules, keeps live and archived route indexes consistent, and preserves the live route if any move or index write fails. Route lookup must resolve a task by ID without returning its full context.

## Scope

- `Harness/scripts/task-state.mjs` is the sole archive writer; compatibility scripts delegate to it.
- `Harness/scripts/lib/task-route.mjs` derives live/archive routes and eligibility without writing.
- SessionStart uses a global lock; Stop remains dry-run only.
- After a successful archive, refresh root `PROGRESS.md`, `tasks/INDEX.json`, `tasks/INDEX.md`, and archive indexes as one recoverable operation.
- Keep the archive process local. Do not commit, push, publish, or move any capsule during verification except isolated test fixtures.

## Non-scope

- Change task closeout semantics or archive historical user data.
- Auto-archive the current focus task, open tasks, tasks with unresolved work/ownership markers, or tasks without verified closeout.
- Expose task PLAN/context through the compact route command.

## Acceptance criteria

| ID | Criterion | Verification |
|---|---|---|
| AC-001 | `npm test` passes. | Full package test command. |
| AC-002 | Capsule-routing tests pass. | `node --test tests/capsule-routing.test.js tests/task-state-closeout.test.js`. |
| AC-003 | E2E tests pass. | Existing documented UI e2e command. |
| AC-004 | `pack:smoke` passes. | Existing package script. |
| AC-005 | `validate-harness --strict` passes. | Strict validator against the working tree. |
| AC-006 | Source/template mirrors match. | Repository mirror checks. |
| AC-007 | `git diff --check` passes. | Git whitespace/conflict check. |
| AC-008 | `route --task <id> --json` output is at most 8 KB and omits full context/PLAN content. | Integration test. |
| AC-009 | Legacy `--keep` and `--group` options are not silently ignored. | CLI compatibility tests. |
| AC-010 | A closed capsule without verified closeout is not auto-archived. | Integration test. |
| AC-011 | The current focus capsule is not auto-archived. | Integration test. |
| AC-012 | Concurrent SessionStart invocations perform at most one move of a given capsule. A live lock owner cannot be displaced based on age alone; stale locks may be recovered only after their owner is confirmed dead. | Isolated concurrent-process test plus live-PID/old-timestamp lock test. |
| AC-013 | A move or archive-index write failure preserves the original live route and prior indexes, and reports failure. | Fault-injected integration test. |
| AC-014 | Route lookup resolves both live and archived capsules by task ID. | Integration tests. |
| AC-015 | Successful archive removes the task from root `PROGRESS.md` and the live task indexes. | Integration test plus strict validation. |
| AC-016 | Live and archive `INDEX.json` files share one stable `routeRevision` for the same route state. Reindexing updates both revisions when live/archive STATE or root active-task/index rows change. | Integration test for state changes, root active-task changes, and live/archive revision equality. |
| AC-017 | Safe auto-archive skips a capsule with an active task-level owner, lease, or lock marker. | Unit/integration test from the declared marker contract. |

## Test-first plan

1. A test writer uses only this plan, `Harness/specs/protocols/TASK_ARCHIVE.md`, and existing test utilities to add AC-linked regression tests; confirm they fail for the specified behavior.
2. Implementer changes only archive source and its template mirror; do not edit this plan or the acceptance criteria.
3. Run focused RED/GREEN tests, then the full command set above.
4. Independent review and validation record an AC result matrix in `CLOSEOUT.md` before the task can close.

## Risks

- Multi-file index updates cannot be one filesystem atomic operation; implementation must snapshot old indexes, roll back moved capsules and restore snapshots on any write failure.
- Task-level owner/lease/lock markers need a conservative, documented shape so auto-archive cannot move a capsule while a worker still owns it.
- The root Task Index is generated from live capsules and can retain phantom entries if archive closeout omits refresh.
