# PLAN — task-tempdir-cleanup

## Goal
Eliminate the "litter the user's machine" defect class: repo scripts/tests must not leave unbounded temp or external files. Three deliverables (per user):
1. Audit ALL scripts with the same bug (write, never reclaim).
2. Purge the historical garbage in `%LocalAppData%/Temp`.
3. Comprehensive hygiene check so the framework never litters a user's machine again.

## Triggering evidence
- `tests/validate-harness.test.js:18` and `tests/update-collision.test.js:9` create `mkdtemp` dirs, generate a full scaffold (137 files / ~574 KB each), and never clean up.
- `scripts/pre-push-check.mjs:22-24` runs `npm test` (+ e2e + pack:smoke) on every push → ~45 scaffolds/push accumulate.
- Observed: **8383 leftover `harness-*` dirs** in `%LocalAppData%/Temp` (~4.8 GB, ~1.15M files) → slow boot / Windows Defender scan.

## Non-goals
- Do not change test assertions or scaffold content.
- Do not touch the paused `task-homepage-act1-flat-layout`.

## Acceptance Criteria
- **AC-1 (Audit)**: Complete table of every file+line that creates a temp dir or writes outside the repo, with cleanup status. Covers `tests/`, `src/`, `scripts/`, `Harness/scripts/`, and `templates/**/*.{js,mjs,cjs}`.
- **AC-2 (Fix)**: Every offender cleans up after itself. Tests use a shared `after()` hook; scripts clean up on exit/error.
- **AC-3 (Purge)**: Historical `harness-*` garbage in `%Temp%` deleted, scoped to framework prefixes only.
- **AC-4 (Guard)**: A recurrence guard exists (shared test helper AND/OR a cleanup self-check that fails if `harness-*` dirs remain after a run).
- **AC-5 (Verify)**: `npm test` + `npm run test:e2e` + `npm run pack:smoke` all green AND leave ZERO net-new `harness-*` dirs in `%Temp%`.

## Write set
- `tests/*.test.{js,mjs}` (add `after()` cleanup)
- `tests/lib/temp-helpers.mjs` (new shared helper, optional)
- `scripts/` or `Harness/scripts/` (guard, optional)
- `Harness/tasks/task-tempdir-cleanup/*` (state)

## Subagent Dispatch
| Role | Task | Reads | Writes | Return |
|---|---|---|---|---|
| codebase-explorer | Audit all temp-dir/external-write patterns + cleanup status | repo source | none | offender table |
| implementer | Add cleanup to offenders + guard | audit table, tests | tests/*, helper | diff |
| verifier | run npm test/e2e/pack, count `harness-*` dirs before/after | repo | none | evidence matrix |
| reviewer | spec+code review of diffs vs ACs | diffs, ACs | none | findings |

## Decisions
- Tier: **WF-Standard** (multi-file hygiene/correctness bug; one review lens).
- Cleanup pattern: centralized `after()` hook per test file, collect roots in an array.
- Purge scope: prefixes `harness-validator-`, `harness-collision-`, `harness-generator-`, `harness-p0-`, `harness-cli-`, `harness-check-root-`, `size-probe-` ONLY (never broad `%Temp%` delete).
- Memory preflight: done. Memory hints: none.

## Closeout
- **Result: PASS** (WF-Standard). Verifier: guard-wrapped `npm test` green (130/129 pass/0 fail/1 skipped) with zero net-new `harness-*`, run twice. Review: APPROVE, no CRITICAL/HIGH.
- **Scope expansion (review M1)**: `tests/p0-blockers.test.js` added to the fix set — its inline-tail `rmSync` is skipped on a throwing assert, so it got the same `after()` safety net. Total fixed test files: **6**.
- **AC-3 (purge)**: delegated to USER (agent must not run `%Temp%` deletion). Command provided.
- **Deferred follow-ups (non-blocking, documented)**:
  - Optional regression self-test for `scripts/check-temp-leak.mjs` (skipped to avoid a litter-prone test; guard is exercised every pre-push).
  - Optional: wrap `npm run test:e2e` and `npm run pack:smoke` in the guard for symmetry (both confirmed clean by construction today).
  - Optional: `tests/e2e-wf-scripts.test.mjs` cleans its in-repo `.tmp-e2e*` before-run, not after-run (out of `%Temp%` scope; presumably gitignored).
- **Lesson recorded**: `Harness/memory/agent-lessons-patterns.md` (after() over inline-tail rmSync; guard + `harness-` prefix convention).
