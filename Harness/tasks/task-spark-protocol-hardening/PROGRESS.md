# task-spark-protocol-hardening - PROGRESS

Compact heartbeat for hardening `/wf-auto-spark` after the previous spark self-evaluation found stability, token, and delegation gaps.

## Status

- Phase: Verified/Complete
- Next: commit
- Blocker: none

## Acceptance

- [x] AC-STABLE: documented fallback behavior when researcher/search subagents are filtered, scoped skill names are unavailable, or external search needs to degrade to direct CEO discovery.
- [x] AC-TOKEN: task-state/process-file writing now defaults to task-scribe formatting from CEO bullets instead of high-reasoning CEO prose drafting.
- [x] AC-DELEGATION: `WF-AUTO-SPARK.md` and `WF-MAX.md` both state the default task-scribe path and the honest degradation rule.
- [x] AC-EDGE: added explicit guards for literal anti-pattern matching, checksum drift, process-file token burn, and fake delegation.
- [x] AC-SYNC: root Harness docs, templates, validator assertions, tests, and `.harness-version` are synchronized.

## Changes

- Updated `Harness/WF-AUTO-SPARK.md` and `templates/common/Harness/WF-AUTO-SPARK.md`:
  - task-scribe formats task-state writes from CEO bullets.
  - added `Spark Search Fallbacks`.
  - added `Reflector Escalation`.
  - added SP7-SP10 edge guards.
  - changed per-cycle value reflection and cycle PLAN wording away from CEO direct drafting.
- Updated `Harness/WF-MAX.md` and `templates/common/Harness/WF-MAX.md`:
  - task-scribe now runs by default for dispatch ledger, heartbeat, and evidence pointers when available.
  - fallback is explicit when task-scribe is unavailable.
- Updated root and template `validate-harness.mjs`:
  - requires task-scribe recorder delegation, search fallback, reflector escalation, anti-pattern guard, checksum drift guard, and WF-MAX process-file delegation text.
- Updated tests:
  - `tests/validate-harness.test.js`
  - `tests/generator.test.js`
- Ran `node scripts/build-version.mjs`:
  - refreshed `templates/common/.harness-version`.
  - synced root `Harness/.harness-version`.

## Verification

- [x] `node --test tests/validate-harness.test.js tests/generator.test.js` - PASS, 58 passed.
- [x] `node scripts/build-version.mjs --check` - PASS.
- [x] `node scripts/check-root-harness-version.mjs` - PASS, 123 files checked with 2 accepted-local skips.
- [x] `node Harness/scripts/validate-harness.mjs --strict` - PASS.
- [x] `node templates/common/Harness/scripts/validate-harness.mjs --strict` - PASS.
- [x] `npm test` - PASS, 102 passed, 1 skipped.

## Notes

- This closeout intentionally did not touch `docs/index.html` or the homepage Act 1 task files.
- The active homepage task remains separate in `Harness/PROGRESS.md`.
