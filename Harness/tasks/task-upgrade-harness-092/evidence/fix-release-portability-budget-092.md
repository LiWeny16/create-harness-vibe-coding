# Release portability / context-budget fix evidence

Date: 2026-09-09  
Owner: `/root/verify_runtime_release_readiness_092`  
Scope: bounded test/spec portability only; no runtime, package, benchmark, version, or release-state writes.

## RED reproduced

1. `node Harness/scripts/context-budget.mjs --json` initially reported
   `cache-diagnostics-route` **36935 / 36000 bytes (FAIL)**. Its four loaded
   files were `Harness/specs/runtime/context-loading.md` (12737 bytes),
   `Harness/specs/workflows/WF-KERNEL.md` (9405),
   `Harness/specs/runtime/dispatch.md` (8364), and
   `.claude/skills/wf-agents-docs/SKILL.md` (6429). The first three contained
   this round's redundant context/research, capability-example, and fan-out
   prose; the skill file was not changed.

2. Before the test change, an isolated `makeHarnessTempRoot` project copied
   from `tests/fixtures/harness-092/project` contained only
   `task-context-fixture`. Running `task-context.mjs pack task-upgrade-harness-092
   --project <temp> ...` returned status 1:
   `Task STATE.json does not exist ...\Harness\tasks\task-upgrade-harness-092\STATE.json`.
   This proves `tests/verify-context-memory-092.test.js` was coupled to an
   unsubmitted repository task rather than a portable fixture.

## Minimal changes

- Compressed only the new sections in the three modified spec documents and
  synchronized their `templates/common` mirrors. The retained rules still
  require bounded hashed packs/pointers, research gating, exact capability
  declarations, operator-configured provenance, HTTP mutation rejection, and
  WF-Max Useful/Strict behavior. Moved the full operator JSON example and
  explanatory detail to the on-demand `Harness/scripts/README.md` section and
  its template mirror; runtime dispatch retains the short pointer and gate.
- Changed the first portability test to run `pack task-context-fixture` in a
  `makeHarnessTempRoot` copy. Existing immutable-intent, scoped-entry, pack,
  path/url, and no-STATE-write assertions remain unchanged.
- No new fixture was needed; the existing repository fixture
  `tests/fixtures/harness-092/project/Harness/tasks/task-context-fixture`
  is self-contained and is copied into the bounded temp root.

## GREEN matrix

| Check | Result |
|---|---|
| `node Harness/scripts/context-budget.mjs --json` | PASS; cache route **35702 / 36000** (298-byte headroom), all four routes PASS |
| `node --test tests/context-budget.test.js tests/verify-context-memory-092.test.js` | PASS, 6/6 |
| `node --test tests/anti-drift.test.js tests/task-context.test.js tests/memory-context.test.js tests/research-policy.test.js` | PASS, 43/43 |
| Combined command above including all six suites | PASS, 49/49 |
| `git diff --check` on owned docs/test paths | PASS |

The budget remains the frozen 36000-byte limit; it was not raised and no
mandatory role, safety, or acceptance rule was removed. All AC remain pending;
parent controls candidate release and the real benchmark.
