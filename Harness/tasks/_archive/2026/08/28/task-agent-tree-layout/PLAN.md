# task-agent-tree-layout - PLAN

## Goal

Round 2 of graph layout (after task-optimize-graph-layout), user requirements 2026-08-14:

1. Tidy/整理布局 must be **compact**, agent-centric:
   - main agent = core anchor, centered;
   - subagents one layer BELOW main, arranged as an agent **tree** (multi-level);
   - scattered (non-agent) nodes arranged as a **matrix band ABOVE** the agents;
   - asset band per owner: nodes with `parentAgentId`/edge ownership sit above their
     owner agent; unowned nodes sit above main.
2. **Never create or modify edges** — layout only moves nodes.
3. Independent fixes riding along: 409 STALE_GRAPH_VERSION merge-replay; clipboard
   image paste into the node map.

## Scope

Write set:
- src/wf-ui-server/graph-layout.mjs (agentTreePositions + shared dock-chain helper)
- src/wf-ui-server/server.mjs (agent-tree mode branch)
- src/wf-ui-server/__tests__/graph-layout-agent-tree.test.mjs (new, RED first)
- src/wf-ui-server/__tests__/workflow-layout.test.mjs (L-series agent-tree HTTP tests)
- src/ui/src/components/WorkflowRoute.tsx (mode switch, 409 merge-replay, image paste)
- src/ui/e2e/wf-ui-m9-layout.spec.ts (update Test A to agent-tree expectations)
- Harness/tasks/task-agent-tree-layout/* (PLAN/PROGRESS/evidence)

Forbidden:
- grid/tree/tidy mode behavior changes (pinned tests T1-T13, G1-G5, L1-L8b stay green)
- edge creation/removal anywhere in the layout path

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| D-1 | New engine entry `agentTreePositions(nodes, edges, opts)`; new server mode `agent-tree`; grid/tree/tidy untouched | Existing modes are pinned by tests | 2026-08-14 |
| D-2 | Agent tree parenting: explicit parentAgentId (agent) > first edge whose other endpoint is an agent > main; cycle-guarded | Bridges are bidirectional; cycles must not drop nodes | 2026-08-14 |
| D-3 | Matrix band: cols = clamp(ceil(sqrt(n)), 2, 6), row-major stable id, row height = tallest unit + gap, band centered on owner subtree x; agent y row-aligned to tallest band in the row | User: "散落的nodes 矩阵排布即可"; row alignment keeps "一层" readable | 2026-08-14 |
| D-4 | Spacing: unit advance = unit extent + gap; agent-tree defaults gapX 64 / gapY 48; clearance floor 16px | User: "尽量紧凑"; floor keeps AC min-gap contract | 2026-08-14 |
| D-5 | Extract shared `dockChainUnits(ids, dockedPairs, sizeOf)` from tidyPositions; both engines use it; tidy stays byte-identical | Dock chains already pinned by T6/T10-T12; no duplication | 2026-08-14 |
| D-6 | No main agent → flat fallback: all agents one root row, all non-agent nodes one matrix band above, centered | Deterministic behavior without main | 2026-08-14 |
| D-7 | 409 fix: on STALE_GRAPH_VERSION → GET /api/a2a/graph-map, merge local positions over server, retry PUT once; only then invalidate+reload | Positions are last-writer-wins; drop-and-reload loses user gestures | 2026-08-14 |
| D-8 | Paste fix: `handleCanvasPaste` reads `clipboardData.items` image/* → blob File → `createFileNodesFromUploads` | Screenshots arrive as image items, not files | 2026-08-14 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | agent-tree layout: main centered; subagents below main one layer (tree depth nested); assets matrix band above owner; ≥16px clearance; deterministic | unit tests A1-A10 | pending |
| AC-002 | No edges added/removed by any layout action | HTTP L-series test | pending |
| AC-003 | tidy/grid/tree modes unchanged (T1-T13, G1-G5, L1-L8b green) | full server test run | pending |
| AC-004 | 409 conflict → client merges positions and retries once; no data loss | e2e or unit; console clean | pending |
| AC-005 | Pasting an image creates a file node at canvas position | e2e or manual browser check | pending |

## Assumptions

- A-1: Asset matrix band is ABOVE its owner agent (user: "散落的nodes放在agent上面").
- A-2: Subagent-owned assets join the matrix band above that subagent; user's matrix wording covers per-owner bands.
- A-3: e2e m9 Test A (tidy positions) must be updated to agent-tree expectations.
- A-4: agent-tree ignores edge DIRECTION for layering (bidirectional bridges are the norm); direction only matters for tidy mode.

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Extraction of dock-chain helper breaks tidy | T1-T13 pinned; run before/after | open |
| m9 e2e expectations shift with new mode | Update Test A expectations after engine is green | open |
| 409 retry loop (server bumps again) | Single retry, then reload as today | open |
