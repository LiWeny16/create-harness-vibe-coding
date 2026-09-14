# task-upgrade-harness-092 - PROBLEM

## Active

| ID | Problem | Root cause / evidence | Fix / next owner | Status |
|---|---|---|---|---|
| P-001 | Broad dirty tree makes ownership ambiguous | `git status --short` and `git diff --stat` show extensive 0.9.1-prep edits plus user assets/state | baseline + disjoint claims + path allowlist; controller | open |
| P-002 | Existing docs describe release gates including npm publish | README/CHANGELOG historical release text; user explicitly forbids publish for this run | candidate GitHub push + remote SHA only; controller | constrained |
| P-003 | Prompt-level WF contracts lack proven runtime closure and cost evidence | W0 external report: 17 surfaces covered, but runtime/cost gaps and no SOTA basis | AC-03/05/07/09 real CLI/API/UI and fresh-install benchmarks | open |
| P-004 | Architecture/API is unresolved before runtime report | W0-RUNTIME pending; user permits business contracts first | keep TBD-01..03; W1 gate after report | open |
| P-005 | Task index currently exceeds displayed max-five guidance after new task | Existing five open task capsules; task-state creation allowed but may warn | preserve all tasks; report validator warning; do not archive unrelated work | open |

## Resolved

| ID | Problem | Resolution | Resolved |
|---|---|---|---|
| R-001 | No durable task capsule for the requested upgrade | Created `task-upgrade-harness-092` via canonical task-state CLI, set it active without closing prior task | 2026-09-09 |
| R-002 | Post-release validation could be mistaken for repository tests | Added AC-09 fresh-install, exact-SHA/hash, fresh Luna + independent scorer, holdout and retry contract | 2026-09-09 |
