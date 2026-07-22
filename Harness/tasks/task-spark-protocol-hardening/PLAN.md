# PLAN - task-spark-protocol-hardening

## Goal

Harden `/wf-auto-spark` from "able to reach the goal, but unstable, token-expensive, and CEO-heavy for process files" into a more stable, token-conscious protocol where task-state/process-file writing is delegated to `task-scribe` by default.

This task came from a previous spark self-evaluation after M1-M4 WF-MAX hardening work. The observed failures were:

- researcher/search subagent fallback was used in practice but not documented.
- scoped skill invocation could fail without a written fallback.
- reflector use was not clearly tiered for candidate triage vs final acceptance.
- process files were drafted by the CEO instead of `task-scribe`.
- checksum/template/validator drift prevention needed to be made explicit.

## Acceptance Criteria

- AC-STABLE: protocol deviation/fallback points are documented instead of patched inside a cycle.
- AC-TOKEN: task-state/process-file writing defaults to `task-scribe`; CEO provides concise bullets.
- AC-DELEGATION: `WF-AUTO-SPARK.md` and `WF-MAX.md` make process-file delegation explicit and define degradation when `task-scribe` is unavailable.
- AC-EDGE: anti-pattern and drift guards cover literal matching, checksum drift, process-file token burn, and fake delegation.
- AC-SYNC: root docs, templates, validators, tests, and `.harness-version` are synchronized.

## Non-Goals

- Do not enter `/wf-auto-spark` for this closeout.
- Do not change homepage UI work or `docs/index.html`.
- Do not add new runtime dependencies.

## Final Write Set

- `Harness/WF-AUTO-SPARK.md`
- `templates/common/Harness/WF-AUTO-SPARK.md`
- `Harness/WF-MAX.md`
- `templates/common/Harness/WF-MAX.md`
- `Harness/scripts/validate-harness.mjs`
- `templates/common/Harness/scripts/validate-harness.mjs`
- `tests/validate-harness.test.js`
- `tests/generator.test.js`
- `templates/common/.harness-version`
- `Harness/.harness-version`
- `Harness/tasks/task-spark-protocol-hardening/STATE.json`
- `Harness/tasks/task-spark-protocol-hardening/PROGRESS.md`
- `Harness/PROGRESS.md`

## Changes

- `WF-AUTO-SPARK.md` now says CEO provides concise bullets and `task-scribe` formats task-state writes for roadmap, cycle PLAN, heartbeat, evidence pointers, and closeout.
- Added `Spark Search Fallbacks` for filtered/unavailable researcher/search subagents, unavailable scoped skill names, discovery-only fallback boundaries, and adaptive source-family rotation.
- Added `Reflector Escalation`: CEO may self-score low-risk candidates during pre-implementation triage, but implemented spark acceptance still requires verifier evidence, cross-review, and reflector PASS.
- Added SP7-SP10 anti-patterns for literal anti-pattern matching, checksum drift, process-file token burn, and fake delegation.
- `WF-MAX.md` now says `task-scribe` runs by default for dispatch ledger, heartbeat, and evidence pointers when available.
- Root and template validators now require the new spark hardening clauses.
- Generator and validator tests now cover the new protocol text and fail when recorder delegation is removed.
- Ran `node scripts/build-version.mjs` to refresh template and root `.harness-version` checksums.

## Verification

- `node --test tests/validate-harness.test.js tests/generator.test.js` - PASS, 58 passed.
- `node scripts/build-version.mjs --check` - PASS.
- `node scripts/check-root-harness-version.mjs` - PASS, 123 files checked with 2 accepted-local skips.
- `node Harness/scripts/validate-harness.mjs --strict` - PASS.
- `node templates/common/Harness/scripts/validate-harness.mjs --strict` - PASS.
- `npm test` - PASS, 102 passed, 1 skipped.

## Closeout

Status: complete / verified as of 2026-07-22.

Residual risk: none known for the protocol hardening scope. Homepage UI changes remain separate and untouched.
