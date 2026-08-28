# task-optimize-graph-layout - PROGRESS

## Status / Next

- Status: VERIFIED — AC-001/002/003 all pass; independent review PASS (after W5 re-review); final m9 3/3 green
- Next: user browser check (tidy button + new-node placement) + commit on user request; then archive

## Final Verification Summary (2026-08-14)

- Server tests 32/32 (T1-T13, G1-G5, L1-L8b); regression batch 123/123; tsc 0; build 0.
- e2e: m9 3/3 (tidy button zero-overlap + layer order; new node no-overlap + existing unmoved; agent create carries position); m2+m4-magnetic+drag 18/18; m3 unified picker 1/1.
- REAL-graph live tidy click (no mocks): overlap pairs 3 → 0, crossings 0, 8/8 nodes visually moved, 0 page/console errors; workflow-map.json restored byte-identical. Evidence: evidence/real-graph-measure-result.json + real-before/after.png.
- Reviewer re-check: all findings CLOSED (HIGH-1, MED-2/3/4/5, LOW-8/9) each pinned by tests; overall PASS.
- Nothing committed (per rules). Working tree holds all changes.

## Heartbeat

- 2026-08-14: Task created via /wf (user: 布局算法需要重新优化调整; requirements: 1. new nodes never overlap + sensible placement; 2. top-right Tidy button; hierarchy-aware layout; edges influence layout). User decisions: hierarchical (Sugiyama) strategy + nearest-free-spot placement. memory hints: none.

## Completed

- W1 (test-writer): NEW graph-layout-tidy.test.mjs (T1-T9), APPENDED workflow-layout.test.mjs (L7a-d), NEW wf-ui-m9-layout.spec.ts (A tidy button / B create no-overlap). RED-by-design; dockedPairs API pinned {aId,bId,offset:{x,y}}.
- W2 (server implementer): graph-layout.mjs + server.mjs — tidyPositions(nodes, edges, opts): DFS topological longest-path layering (back-edge exclusion for cycles, bidirectional edges no layer constraint), per-layer row stacking with per-unit bbox (docked pair = single glued unit, positions[b]=positions[a]+offset exact), deterministic, defaults origin 260/220 gapX 420 gapY 140 (test-pinned), min clearance 16 via max(gapY, tallest+16). server.mjs: mode 'tidy' branch in existing agent.layout action — sizes payload, dockedPairs from capsuleDockLinks (offset = current delta), shared persistence/undo/response. grid/tree untouched. Evidence: 20/20 new tests + G1-G5 pass, node --check OK.
- Risks noted: chained dock pairs (slave-as-anchor) untested; explicit gapX/gapY<16 honored as-is.
- W3 (client implementer): WorkflowRoute.tsx — findNearestFreePosition :1989 (outward square spiral, gap 16, 4096 cap + fallback); runTidyLayout :7458 (main-agent actor via isMainAgentNode, POST agent.layout {mode:'tidy', sizes} with displayedNodeSize keyed graphNodeId||id, apply via updateGraph, resetView, busy guard + error toast); toolbar button :9297 testid workflow-tidy-layout (LayoutGrid 13, disabled+opacity busy); free-spot called in all 6 create sites before placeholder (agent/agentFromSource/component/timer/goal/skill-group; preferred = magic offset kept / parent vicinity / target-agent vicinity). translations.ts: "Tidy layout"/"整理布局" + failure keys. index.css untouched. tsc green.
- W3 risks: new node can land at negative coords when vicinity packed (AC only pins gap); sync fitView may fit pre-update bounds (cosmetic).
- W4 dispatched: verifier (server tests + tsc/build + m9+m2+m4+drag+m3-picker regression + real-graph overlap/crossing measurement before/after tidy + screenshots) ∥ reviewer (independent lens).
- W4 review (independent): NEEDS_FIX — HIGH-1: agent creation bypasses AC-001 (client free spot not sent in POST /api/sessions; server autoPlaceNode is slot-based 280x180 non-size-aware → adjacent 560x358 agents overlap; snapshot reload clobbers client spot; same for createAgentNodeFromSource; component/event/goal/skill-group safe). MED-2: undo breaks docked pairs (inverse.positions lacks docked slaves). MED-3: negative-offset (top-docked) pairs extend above rowY → overlap row above. MED-4: chained dock pairs + dock cycles unhandled (cycle fallback stacks both at one point). MED-5: fitView sync after updateGraph fits pre-update bounds (cosmetic). LOW-6: crossings not minimized → AC-002 amended (decision D-4, barycenter = future enhancement). LOW-7: negative coords acceptable. LOW-8: missing i18n key. LOW-9: gapX/gapY<16 not clamped. AC-001 PARTIAL, AC-002 PARTIAL, AC-003 PASS (covered cases). Decision: fix HIGH-1 + MED-2/3/4 + LOW-8/9 + MED-5; W5-C test-writer (RED) → W5-A server ∥ W5-B client → re-verify + re-review.
- W5-B (client fix) done: session POST carries {position}; fitView deferred via rAF; i18n key added. tsc green.
- W4 verification (baseline, pre-W5): AC-003 PASS (25/25 server tests). AC-001 spec gap (m9 Test B needs file-path fill step — app fine). AC-002 TWO real defects: (1) runTidyLayout misses the explicit setNodes position apply (drag path uses it at :4566) → canvas never visually moves though state+PUT persist (proven live: real tidy returns valid positions, persisted v2093, rendered rects unchanged); (2) sizes wire mismatch: client sends {width,height} (:7471), server reads size?.w/.h (:3216) — W1 pinned {w,h} → sizes dropped, rows assume 280x180. m9 fixture issues: TIDY_POSITIONS too tight for real rendered sizes; Test B missing file-path step. Real-graph measurement: before=3 overlapping pairs / after=identical 3 pairs (canvas never moved — defect 1); server engine re-check on real data: 0 overlaps (engine itself fine). Evidence: evidence/real-graph-measure-result.json, real-before/after.png. NOTE: server import break (component-node-store.mjs listLiveComponentNodes export missing) observed mid-run = W5-A mid-edit transient; re-verify after W5-A returns. Remaining fixes: client setNodes apply + {w,h} sizes (W5-C client worker) + m9 spec fixes (file-path step, loosen TIDY_POSITIONS).
- W5-A (server fix) done: session-create honors {position} (transient session.graphPosition at create-time ensureRuntimeSessionGraphNode; findClearPosition clearance verify; autoPlaceNode size-aware rect path for no-position fallback; cell path unchanged G1-G5 identical); undo inverse snapshots ALL nodes incl. docked; tidy row advance covers upward extents; dock chains glued per head, cycles as separate units; gap clamp >=16; NODE_KIND_SIZES per-kind table (agent 560x358). 32/32 layout tests + 123/123 regression batch. Full-suite 19 pre-existing failures documented (AC-005 restart proven pre-existing via revert test).
- W5-C (client fix) done: setNodes visual apply reusing drag path :4566 with node.id||graphNodeId keying; sizes now {w,h}; response shape verified (top-level positions); rAF fitView kept. tsc green.
- W5-D (spec fix) done: m9 Test B fills workflow-create-file-path + submit (m3:1601 flow); Test A TIDY_POSITIONS 500px vertical pitch for real sizes. Final re-verification + reviewer re-check dispatched.

## Changed Files

- src/wf-ui-server/__tests__/graph-layout-tidy.test.mjs (W1, new)
- src/wf-ui-server/__tests__/workflow-layout.test.mjs (W1, appended L7a-d)
- src/ui/e2e/wf-ui-m9-layout.spec.ts (W1, new)
- src/wf-ui-server/graph-layout.mjs (W2)
- src/wf-ui-server/server.mjs (W2)
- src/ui/src/components/WorkflowRoute.tsx (W3)
- src/ui/src/i18n/translations.ts (W3)

## Verification

(none yet)

## Notes

- Predecessor measurement (task-fix-wf-ui-ux-issues/evidence/05-magnet-measurements.json): real graph 6 nodes/3 edges → 2 overlapping node pairs, 6/6 edge bbox crossings; positions all from server graph-layout.mjs; no client-side dagre.

## W0 Findings

### E1 — server layout subsystem
- graph-layout.mjs: autoPlaceNode (:58, one free 280x180 slot parent-vicinity scan) + layeredTreePositions (:108, parentNodeId tree, leaf-count blocks). GRAPH_SLOT_W/H=280/180 (:13-14), GRAPH_LAYOUT_DEFAULTS gap/origin (server.mjs:2875).
- **`agent.layout` action ALREADY EXISTS**: dispatch server.mjs:1567-1568, handler :3175-3252; modes grid|tree; docked nodes EXCLUDED from relayout (:3197-3201); cycle fallback slots (:3212-3222); undo recorded (:3230); persisted + version-bumped (:3241-3250); returns {ok, action:'layout', positions}. HTTP: POST /api/workflow/nodes/:id/actions/:action (nodeRuntimeClient.ts:425). Frontend does NOT call it today. Actor must be Main Agent node else 403 (:3185-3190).
- Persistence: Harness/a2a/workflow-map.json (a2a-store.mjs:1239-1240); graph.positions = {[nodeId]:{x,y}} + node.position (moveNode, workflow-graph-store.mjs:505-548).
- Edges: {id:'from->to', from, to, relation, direction:'source-to-target'|'bidirectional'} (workflow-graph-store.mjs:374-382). Docked: graph.capsuleDockLinks[] {id, nodeIds:[a,b]} (:249).
- Size awareness: NONE server-side (only 280x180 slot). Per-kind sizes client-only.
- dagre: NOT available anywhere (root deps @clack/prompts+picocolors only; no dagre/@dagrejs/mermaid in any node_modules). Zero-dep required.
- Tests: node:test; __tests__/graph-layout.test.mjs (pure unit G1-G5: no-overlap/parent-row/dragged-avoidance/determinism) + workflow-layout.test.mjs (in-process HTTP, L4-L6: grid/tree exact coords + dock untouched; temp-root helper tests/support/temp-root.js). L4/L5 assert EXACT coords for grid/tree — new mode must not alter existing modes; L6 asserts dock exclusion.
- Minimal design: add mode:'tidy' to the existing action: edge-direction BFS layering (from/to + parentNodeId, back-edge exclusion, cycle fallback), docked pairs stay excluded-or-glued (glue only in tidy mode, keep L6 green), payload can carry client sizes {[nodeId]:{w,h}} for size-awareness (uniform 280x180 slots don't cover agent 560x358 — likely the measured overlap cause). Persistence/undo/response already exist.

### E2 — client creation/toolbar/persistence
- Creation positions: magic offsets + sibling counts, no rect awareness — createComponentNode {260+count*400, 420/300} (:5712-5715); createTimerNode (:5780-5783); createGoalNode (:5832-5835); panel path stores flowX/flowY (:5571-5596, defaults 260/220) consumed :5866-5891; flowPositionFromClient :6203-6212.
- Persistence chain: updateGraph({positions}) :4286 = single choke point (version bump, undo 40-slot, graphCommitPendingRef → useEffect :5149 → debounced 250ms PUT /api/a2a/graph-map :5242-5244; per-node key `positions[node.id] || positions[node.graphNodeId]` :5191). Snapshot reload trusts server positions (:5107).
- Toolbar: JSX :9150-9199, buttons 30x30 inline-styled, lucide size 13, testids workflow-create-node/workflow-undo/workflow-redo/workflow-open-skills-overlay, disabled via `disabled=` + opacity .45 (:9184-9189); CSS index.css:687-704.
- Tidy integration: POST existing action endpoint → apply via updateGraph({positions merged}) → fitView(resetView :7378-7382). Busy state new useState. Keying must use node.id||graphNodeId lookup.
- Free-spot helper: insert near nodeRect (:1956-1981); inputs preferred + rects from canvasNodes via displayedNodeSize/nodeRect; gap=16 (m4-magnetic overlap threshold 18px — keep >=16 and below 18 to avoid magnet-adjacent false positives... just use 16 per AC).
- i18n: flat Record en:zh:ja; toolbar buttons currently UNKEYED (Undo/Redo show English) — add "Tidy layout"/"整理布局"; avoid existing "Tidy"/"Fit" keys (:231). E2E selector pattern: getByTestId('workflow-undo') etc.

### P1 — planner decomposition (summary)
- W1a/W1b failing tests first (server unit + e2e m9 spec) → W2 server engine (graph-layout.mjs only, zero-dep Sugiyama + size-aware free-spot) ∥ W3 client (WorkflowRoute.tsx toolbar ~9150-9220 + creation ~3440-3560 + translations + css) → W4 verifier + reviewer. No new persistence endpoint (existing graph-patch path a2a-store.mjs:2283 persists positions). Write sets disjoint.

## W1 Synthesis — contracts pinned (2026-08-14)

- Tidy action contract: POST /api/workflow/nodes/<mainAgentNodeId>/actions/layout with payload {mode:'tidy', sizes?: {[nodeId]:{w,h}}}; server handler adds 'tidy' branch ONLY (grid/tree byte-identical, L4/L5/L6 stay green); docked pairs GLUED in tidy mode (anchor laid out, capsule keeps relative offset); cycles via back-edge exclusion; response {ok:true, action:'layout', positions:{[nodeId]:{x,y}}} — same shape as existing modes.
- Client contract: toolbar button testid `workflow-tidy-layout`, i18n key "Tidy layout"/"整理布局", busy = disabled + opacity (existing pattern), onClick posts action → apply via updateGraph({positions:{...current,...server}}) with node.id||graphNodeId keying → fitView. Button inserted in toolbar JSX (:9150-9199).
- Free-spot contract: findNearestFreePosition({preferred:{x,y}, selfSize:{w,h}, gap=16}) — grid/spiral scan using canvasNodes rects (displayedNodeSize/nodeRect), returns first non-overlapping position; called in EVERY create path (component/timer/goal/agent/skill-group) before placeholder insertion; existing nodes never move.
- Sizes source: client sends displayedNodeSize-derived {w,h} per node in the tidy payload (server falls back to 280x180 slot when missing).
