---
name: wf-max
description: Use when the user says /wf max, wf max, or asks for maximum parallelism. Three-tier enterprise hierarchy: CEO dispatches Managers, Managers dispatch Workers, max 14 concurrent with optimal span ratios.
---

# WF Max

Three-tier maximum-parallelism workflow. CEO (controller) dispatches domain Managers; each Manager dispatches parallel Workers. Built on military Rule of 3, Amazon two-pizza teams (5-7), and Dunbar layers (5→15→50).

## Load

- `Harness/WF-MAX.md`
- `Harness/subagents.md`
- `Harness/dispatch.md`
- `Harness/context-loading.md`

## Three-Tier Organization

```
TIER 1 — CEO (controller, 1 agent)
  Owns: intent, scope, integration, final verification
  Direct reports: 3-5 Managers

TIER 2 — Managers (3-5 agents)
  Architect-Manager: boundaries, interfaces, data contracts (span=3)
  Implementation-Manager: write-set coloring, N implementers (span=5-7)
  Review-Manager: spec/code/security parallel reviewers (span=3-4)

TIER 3 — Workers (manager_count × span)
  One file/module/dimension per worker. Execute and return.
```

## Span Formula

```
span = min(7, ceil(sqrt(files_in_domain)))
  Complex (architecture):     span = 3
  Standard (implementation):  span = 5-7
  Simple (review, research):  span = 7-10
```

## Organization Sizing

| Scale | Files | CEO | Mgrs | Workers | Total |
|-------|-------|-----|------|---------|-------|
| XS | 1-4 | 1 | 0 | 1-3 | 2-4 |
| S | 5-12 | 1 | 2 | 6 | 9 |
| M | 13-30 | 1 | 3 | 15 | 19 |
| L | 31-60 | 1 | 5 | 35 | 41 |
| XL | 60+ | 1 | 7 | 49+ | 57+ |

## Manager Dispatch

CEO → Manager (serial across domains):
1. CEO partitions task into domains
2. CEO dispatches Managers with domain scope
3. Each Manager dispatches Workers in parallel
4. Manager synthesizes Worker returns → reports to CEO

Manager → Workers (parallel within domain):
1. Manager partitions domain into worker units
2. Manager dispatches all workers simultaneously
3. Manager collects, deduplicates, resolves conflicts
4. Manager returns integrated report to CEO

## Saturation Cap

Total 14 concurrent: 1 CEO + up to 3 Managers + up to 10 Workers per wave.
Breakdown examples: 1+3+10=14 (M scale), 1+2+6=9 (S scale), 1+5+8=14 (L scale).

## Rules

- Context threshold: ~70% (CEO + Manager overhead consumes more context).
- File claims must be disjoint across all workers in the same wave.
- Managers verify no cross-worker file creation before reporting to CEO.
- If communication overhead > 30% of useful work, fall back to /wf.

## Return

- Organization chart (CEO→Managers→Workers)
- Span calibration per manager
- Integration results per domain
- Review findings per dimension
- Updated heartbeat
