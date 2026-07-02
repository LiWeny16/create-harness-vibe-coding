# framework-metrics-and-entry-contract - PROGRESS

## Current Goal

Define the Harness entry-contract and benchmark framework until implementation can begin with at least 95% confidence.

## Phase

Current: Explore / Design

## Heartbeat

Last beat: 2026-07-01 delegated implementation Worker returned `BLOCKED` because higher-priority WF-MAX CEO-only instructions are active in the Worker runtime and source writes are banned.
Current phase: Blocked before source implementation
Current blocker: WF-MAX role model conflates global mode with CEO identity, so delegated Workers inherit/refuse under CEO-only source-write rules.
Next beat trigger: rerun the task in a runtime that honors explicit Worker role/writeSet dispatch, or temporarily disables the inherited top-level CEO guard for delegated Workers.
Failure count: 4
Recovery action: Do not edit source from the parent CEO thread. Report blocker explicitly with Worker output and preserve the dispatch packet in PLAN.md.

## Tasks

| # | Task | Owner | Verify | Status |
|---|---|---|---|---|
| 1 | Confirm CLAUDE.md should be slim entry contract | Worker + CEO synthesis | file ownership matrix | Done |
| 2 | Define HarnessBench v0.1 methodology | Worker + CEO synthesis | metrics/task schema | Done |
| 3 | Define implementation phases and write scopes | Worker + CEO synthesis | staged plan | Done |
| 4 | Define 95% confidence checklist | CEO | checklist in PLAN | Done |
| 5 | Hand off implementation package | CEO | final summary | Done |
| 6 | Dogfood slim CLAUDE into root repo | Worker | root/template parity + tests | Blocked by WF-MAX guard |
| 7 | Update setup and validator contract checks | Worker | validator/test output | Blocked by WF-MAX guard |
| 8 | Add Phase A D-GATE dispatch table | CEO + read-only Workers | PLAN self-audit | Done |
| 9 | Search benchmark landscape and map HarnessBench | CEO | PLAN benchmark section | Done |
| 10 | Design 1k-star promotion plan | CEO | PLAN growth section | Done |
| 11 | Fix WF-MAX three-layer role architecture | Worker | docs/tests/validator output | Blocked by inherited CEO guard |
| 12 | Record three-layer implementation map | CEO + read-only Reviewer | PLAN reviewer map | Done |

## Notes

- Current user direction: fix the dogfood CLAUDE issue first, then design benchmark and promotion toward 1k stars.
- Current mode prevents direct source edits by the main agent.
- Read-only planner/architect, validator-impact, and HarnessBench architect workers returned; their accepted findings are synthesized in `PLAN.md`.
- A write Worker confirmed it cannot override the higher-priority WF-MAX CEO source-write ban. Do not retry source implementation from this CEO thread; switch to an implementation context first.
