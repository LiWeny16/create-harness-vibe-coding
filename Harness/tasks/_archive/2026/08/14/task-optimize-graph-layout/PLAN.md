# task-optimize-graph-layout - PLAN

## Goal

- Outcome: (1) new nodes are placed at the nearest free spot (never overlapping existing nodes; existing nodes never move); (2) a top-right "整理/Tidy" toolbar button re-lays out the whole graph hierarchically — edge direction defines layers, same-layer nodes don't overlap, crossings minimized; positions persist through the server.
- Non-goals: auto-layout on every graph change (button-triggered only); client-side layout engine (positions remain server-owned per current architecture); moving nodes on creation.
- Evidence basis: end-to-end measurement (task-fix-wf-ui-ux-issues evidence/05) showed 2 overlapping node pairs + 6/6 edge bbox crossings in the real graph produced by server `src/wf-ui-server/graph-layout.mjs`.

## Scope

- Write set (expected, refine after W0): `src/wf-ui-server/graph-layout.mjs` (+ its tests under `src/wf-ui-server/__tests__/`), position persistence endpoint if a new one is needed, `src/ui/src/components/WorkflowRoute.tsx` (tidy button + creation position helper + toolbar wiring), `src/ui/src/i18n/translations.ts` (button label), maybe `src/ui/src/index.css` (button style if new class needed).
- Forbidden: `Harness/a2a/**`, backend-owned state files, m4-magnetic semantics, task-state of other tasks.

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | Hierarchical Sugiyama-style layout | User decision (连线影响布局) | 2026-08-14 |
| 2 | Nearest-free-spot placement on create; existing nodes untouched | User decision | 2026-08-14 |
| 3 | WF-Standard tier | multi-file server+client behavior change | 2026-08-14 |
| 4 | AC-002 amended: drop "crossings minimized" (edge-direction layering satisfies 连线影响布局; barycenter crossing pass recorded as future enhancement) | Review finding LOW-6; keep scope on no-overlap + hierarchy | 2026-08-14 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | New node never overlaps existing (gap >= 16px); existing positions unchanged; preferred point = parent vicinity (edge) else visual center | Playwright measurement: rect intersection check + position snapshot diff | pending |
| AC-002 | Tidy button top-right; hierarchical re-layout (layers by edge direction, no same-layer overlap); server-persisted; button busy/idle states + i18n | e2e + measurement (overlap pairs 0, layer order) | pending |
| AC-003 | Layout engine unit tests: deterministic, no overlaps for cyclic/multi-component/isolated graphs; docked pairs glued | node --test server tests | pending |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Docked capsule pairs break during tidy | Treat docked pairs as glued units in layering/coordinate assignment; e2e assert dock preserved after tidy | open |
| Cycles | BFS layering + back-edge exclusion heuristic | open |
| Size variance | Coordinate assignment uses per-kind sizes (existing fallback sizes) + H/V gaps | open |
| No dagre server-side | Zero-dep compact layered layout in graph-layout.mjs | open |

## Subagent Dispatch

W0 (parallel, read-only): E1 codebase-explorer (server layout), E2 codebase-explorer (client creation/toolbar), P1 planner (decomposition).
W1: test-writer (AC-linked failing tests / measurement spec). W2: implementer(s) by disjoint write set. W3: verifier + one independent reviewer.
