# PROGRESS — task-tempdir-cleanup

## Status
- Phase: **Verified → Closeout** (PASS)
- Tier: WF-Standard
- Verifier evidence: guard-wrapped `npm test` green, zero net-new `harness-*` (run twice).
- Review: **APPROVE** (no CRITICAL/HIGH; M1 fixed; L1/L3 comments added).
- Reflector verdict: **PASS** — no unresolved contradictions; deferred items documented; AC-3 is operational/user-handled, not a code blocker.

## AC Status (final)
- AC-1 (Audit): **DONE** — 6 offenders identified (5 no-cleanup + p0-blockers failure-path leak).
- AC-2 (Fix): **DONE** — `after()` cleanup in all 6 test files.
- AC-3 (Purge): **USER-HANDLED** — user deletes the 8383 historical `harness-*` dirs; command provided.
- AC-4 (Guard): **DONE** — `scripts/check-temp-leak.mjs` wired into `scripts/pre-push-check.mjs`.
- AC-5 (Verify): **PASS** — guard-wrapped `npm test` = 130/129 pass/0 fail/1 skipped, zero net-new.

## Changes (DONE)
- `tests/{validate-harness,update-collision,generator,cli-smoke,check-harness-version,p0-blockers}.test.js` — import `after`; module-level `tempRoots`; `tmpdir()` pushes each root; one `after()` rmSync per file. (p0-blockers keeps its inline rmSync; after() is the failure-path safety net.)
- `scripts/check-temp-leak.mjs` — NEW guard: snapshots `harness-*` before/after a wrapped command, FAILs on net-new; `stdio:'inherit'`; win32 `shell:true`; leading `--` strip; spawn-error reporting; prefix + trusted-args comments.
- `scripts/pre-push-check.mjs` — `npm test` row wrapped by the guard.

## Verification
- `node scripts/check-temp-leak.mjs -- npm test` → GUARD_EXIT=0; 130/129/0/1 skipped, ~11s. Zero net-new `harness-*`. Run twice (before and after M1) — both clean.

## Risks / Residual
- AC-3 purge is USER-scoped to `harness-*`; agent does not touch `%Temp%`.
- Deferred (non-blocking): guard self-test, wrap e2e/pack, e2e before→after cleanup. See PLAN.md#Closeout.
