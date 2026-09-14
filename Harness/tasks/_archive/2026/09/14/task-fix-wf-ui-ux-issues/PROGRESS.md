# task-fix-wf-ui-ux-issues - PROGRESS

## Status / Next

- Status: VERIFIED — all 8 ACs pass (verifier final pass + independent review PASS + W5 debug fix verified)
- Next: user browser check (visual ACs: cursor/panel/placeholder/skills drag) + commit on user request; then archive

## Final Verification Summary (2026-08-14)

- Build PASS (24.2s); tsc PASS; playwright m2+m4+drag combined: 17 passed / 0 failed; m3 "unified node picker": 1 passed. m3 full-suite has 6 pre-existing failures unrelated to this task (W5 verified identical with/without the fix).
- AC-001..AC-008 all PASS. Screenshot evidence: evidence/{01-ac002-canvas-pane,02-ac005-create-node-panel-1368x768,03-ac008-placeholder-markdown,04-ac008-after-resolve}.png.
- AC-004 hub→canvas drag now has 3 e2e tests (drop-create, cancel-restore, failed-create-restore) all green.
- AC-008 placeholder captured live: visible during 2.5s-delayed create, resolves to real node, zero page/console errors.
- Independent review: APPROVE (after W4 re-review; test-side findings fixed by W4-B).
- Nothing committed (per rules: commit only on user request). Working tree holds all changes on branch agent/wf-ui-state-checkpoint-20260804.

## User-Requested Gap Closure (2026-08-14)

- User critique: magnet stability and layout quality were never measured end-to-end (real rendered pixels). Acknowledged: E6 fix was code-level + m4 assertions (classes/gap constraints), never pill-pixel-verified; file-node scenario never browser-reproduced; layout algorithm never evaluated.
- Dispatched verifier measurement pass: (1) dock gap + pill-center offset per 4 orientations via real mouse drags; (2) file-node async-height scenario top-dock; (3) drag-preview tracking; (4) layout metrics: node-overlap pairs, edge-node crossings, min gap; (5) full-canvas screenshot. Evidence → evidence/05-magnet-measurements.json, 06-full-canvas.png, 07-file-node-top-dock.png.
- Measurement results: TOP dock gap 14.0px exact + pill offset 0.0 (incl. file-node scenario — user's bug closed with pixel evidence); mid-drag preview classes correct. Open questions → W6 debugger: (1) dock-commit flake was a DRIVER artifact (unmocked /agent.attachDock route → server-state dependence); with deterministic mock: 17/17 top commits, commit path deterministic (onNodeDragStop reads live position; preview never gates commit). (2) side docks: driver coordinate errors (no grab-offset compensation); corrected recipes commit right 3/3, left 2/2, bottom 2/2; bottom-with-timer blocked by designed overlap guard (intended). m4-magnetic 5/5 green, 0 page errors. NOTE: W6 also applied a 1-line fix `open={Boolean(displayViewRequest)}` at WorkflowDisplayView call (WorkflowRoute.tsx:9226) to unblock build — pre-existing tsc break in checkpoint tree (untracked WorkflowDisplayView.tsx requires the prop). Magnet subsystem: end-to-end VALIDATED. Layout: 2 overlapping node pairs + 6/6 edge bbox crossings in real graph (server graph-layout.mjs) — NEW finding, separate subsystem, awaiting user decision on a dedicated task.

## Heartbeat

- 2026-08-14: Task capsule created. W0 wave dispatched (7 read-only explorers E1-E7, one parallel message). User screenshots analyzed via vision MCP (images unreadable inline; vision analysis used).
- 2026-08-14: E4/E5/E7 returned. E2/E3 idle without report — re-asked via SendMessage. E1/E6 still running.

## W0 Findings (received)

### E4 — create-node panel overflow
- Panel: WorkflowRoute.tsx:8112-8226 inline in WorkflowFloatingPanel (motion.aside). Body: `.workflow-create-node-panel-body`; catalog grid :8152; options list :8163.
- Sizing: inline maxHeight min(536px, calc(100% - 80px)) refers to flow wrapper not viewport (WorkflowRoute.tsx:8143-8149); `.workflow-create-node-panel` grid-template-rows auto minmax(0,1fr) with no explicit height (create-node-panel.css:6-10); options fixed `max-height:388px; overflow:auto` (css:39-45); shared floating-panel body `overflow:auto` (floating-panel.css:117-122).
- Cause: nested double scrolling — options 388px + search 44px + padding ≈456px; body viewport max-height smaller than content → outer scroll + inner scroll; 388px fixed cap never shrinks.
- Fix plan (pure CSS, create-node-panel.css): body → flex column min-height:0 overflow:hidden; catalog → flex:1 min-height:0 column; options → drop fixed 388px, flex:1 1 auto min-height:0 overflow:auto.
- Skills entries: no dedicated CSS; catalog-driven via nodeRegistry.tsx:167-188 (`hub:'skills'` skill/skill-group), rendered `data-node-kind="skill"|"skill-group"` (WorkflowRoute.tsx:8186), click → 'open-hub' (:8170). Remove = filter catalog entries, no CSS collision.

### E5 — top-right canvas config button
- Button: WorkflowRoute.tsx:8959-8961 gear icon, testid workflow-canvas-settings, toolbar CSS `.workflow-top-toolbar-layer` index.css:673-679. Toggles showCanvasConfig (state :3693) → read-only diagnostics panel :8084-8110 (testid workflow-canvas-config, graph version/schema/counts/undo/map path) — zero controls, no mutation. User sees it as dead.
- Removal plan: delete button JSX :8959-8961 + panel JSX :8084-8110 + state :3693 + setter calls :4844,:6151,:6992,:7034,:7239,:7279; hasOpenOverlay checks :6143,:6227-6228; context-menu entry :8581-8588 (data-action="canvas-config") — remove both or keep both (decide: remove both); keep Settings2 import (also used :9768); i18n keys translations.ts:98,423; layers.css:17-18 z-index rule; wfBrowserRouteCapabilities.ts:98 selector; tests/anti-drift.test.js:559-560 assertions.
- Toolbar CSS stays (other buttons use it).

### E7 — node creation + placeholder
- Creation flow: toolbar :8807 / context menu :8575 → openCreateNodePanel :5434 → catalog :8114 → chooseCreateCatalogItem :5711 → per-kind creators: createComponentNode :5553, createTimerNode :5622, createGoalNode :5671, agent :5461 (config panel first :5733), skill-group :5795. createComponentNode: closes panel :5563, position :5569, await createRuntimeNode :5579 (nodeRuntimeClient.ts:347 → POST ${BASE}/nodes :377). Resolve: componentWorkflowNodeFromRuntime :5601 → setComponentNodeOverrides :5603 + updateGraph :5607 → invalidate :5613-14 → select :5615. Error only via catch :5617. No loading state.
- Server-first: every create is POST /api/workflow/nodes; panel closes immediately → visible gap on canvas.
- No existing node loading UI. LoadingView.tsx is page-level only.
- Sizes: constants WorkflowRoute.tsx:430-441 + fallbackNodeVisualSize :1889-1919 — agent/terminal 560x358, component 352x314, event/timer 276x292, capability (mcp/skill-group) 276x158, goal 320x220, fallback 278x178. Placeholder can reuse fallbackNodeVisualSize.
- Orb: no dedicated lib; package has `motion` ^11 (used as motion.div :9684). index.css already ships `.workflow-toast-orb` :547 + `@keyframes workflow-toast-orb-pulse` :605 + `loading-spin` :2359. Zero new deps — reuse/extend.
- Minimal design: pendingNodes map {x,y,kind} → placeholder nodeType registered in useMemo :5265-5271 sized via fallbackNodeVisualSize, orb + kind label; set optimistically before await (after :5569), delete in then (:5587-5601) and catch (:5617). Temp id `pending-<ts>`; verify swap doesn't conflict with updateGraph merge by id (:3392).
- Open risk: ReactFlow onNodesChange/flowNodes filtering vs placeholder id swap — read grep onNodesChange/flowNodes.

### E2 — cursor on white canvas
- No custom cursor anywhere (no cursor:url(...)). App CSS only: index.css:204, :2245/:2250 (grab/grabbing on edge hits), :1241/:1245, :79.
- Canvas cursor comes from react-flow defaults (node_modules/@xyflow/react/dist/style.css): .react-flow__pane.draggable cursor:grab (:115), .dragging grabbing (:118), .selection pointer (:121). panOnDrag+selectionOnDrag at WorkflowRoute.tsx:8043-8045.
- Root cause: OS-native grab-hand/arrow is small and light against near-white dotted canvas (index.css:632-638 #fbfcfd→#f7faf8; body #fff index.html:9). Low contrast, not missing.
- Fix: override `.wf-flow .react-flow__pane` cursor in index.css (~after :639) with black SVG cursor data-URI (black fill + white stroke outline, hotspot 3 3, fallback grab); optionally .selection (pointer) and .dragging (grabbing) variants. Zero deps, zero assets.

### E3 — skills hub + skills group semantics
- Hub = fullscreen overlay WorkflowSkillsHubOverlay.tsx (presentational, prop-driven). Opens via toolbar button workflow-open-skills-overlay (WorkflowRoute.tsx:8962) → skillsOverlay {mode:'hub'} rendered :9020-9036. Double-click a skill-group node → group mode (:7117-7121).
- Hub mode: Installed tab = skill checkboxes + per-skill Add (onAddSkillToGroup NOT wired — hidden :9031-9034); Agents column Mount → PATCH /api/a2a/nodes/:id/config {skills, skillPolicy:'manual'} (:7797-7829). Groups tab Open → handleSkillsOverlayPickGroup (:7837-7862) → createSkillGroupNode (:5795-5880) creates node + optional capability edge to agent (:5836-5859). Market tab installs packs (:5882+).
- Legacy in-canvas skills drawer (capabilityHub state :5736-5756, panel :7357+): single-skill attach to selected agent (:5758-5793).
- Create-node panel skill entries: nodeRegistry.tsx:167-177 'skill' (planned), :178-188 'skill-group' (ready), both category capability, hub 'skills'. Click → openCapabilityHub(option.hub) (WorkflowRoute.tsx:8194-8203) opens legacy drawer; planned-state bypass for hub items (:8171).
- Skills group data model: canvas node kind capability-node type skill-group (WorkflowRoute.tsx:1381,2217; WorkflowCapabilityNode.tsx:19). Backend workflow-capability-node-store.mjs CAPABILITY_TYPES {skill-group, mcp-connector} (:17); state: description, sourceGroup{id,label,kind}, category, tags, installSource, lockRef, loadStrategy, skills[] (max 64 {id,name,title,source,state,enabled}), skillNames, skillCount, nodeSemantics (:297-321). createCapabilityNode (:434); setSkillEnabled (:513-567) only per-skill mutation. Agent binding = agent-node config skills[] + capability edge (not on group node).
- Drag gaps: canvas drop accepts only workspace items/files/text (WORKSPACE_ITEM_TRANSFER_TYPE :457; handlers :6233-6267). Overlay has nodrag/nopan/nowheel + stopPropagation (:208-214), no draggable attrs. No hub→canvas drag, no multi-select compose.
- Minimal design (frontend-only, backend unchanged): (1) hub rows draggable, emit new transfer type application/x-harness-skill-group {skillIds,label}; (2) WorkflowRoute drop handlers accept it → refactor createSkillGroupNode body into helper (skillIds+position, reuses createRuntimeNode type 'skill-group' + optional agent edge); (3) compose: wire onAddSkillToGroup + draft-set state in hub; (4) remove skill + skill-group entries from nodeRegistry.tsx:167-188 (single skills surface).
- Risks: api.ts zero skill matches (endpoints in nodeRuntimeClient.tsx unread); agent-config skills/skillPolicy semantics unverified; hub-mode checkbox toggles appear inert (onSetSkillEnabled wired only in group mode).

### E1 — duplicate settings panels (agent node)
- Root cause: two panels gated by two DIFFERENT node variables + predicates. selectedNode (canvas graph node, agent kind='terminal-session') drives legacy panel gate; selectedRuntimeNode (async backend fetch, registry kind='agent') drives typed panel gate. At HEAD (3e9cdba) the legacy gate had NO exclusion guard — WorkflowRoute.tsx:8702 condition `showConfig && selectedNode?.kind==='terminal-session' && selectedNode.sessionId && (` renders legacy panel even when the typed panel also renders. Both hosts share the same z-index layer (layers.css:30-35, --wf-z-settings+20, both bottom-right anchored) → both visible. e2e fixture (terminal-session, no componentType, runtime fetch unmocked → fallback null) never hit the overlap → tests green.
- Render paths (all in WorkflowRoute.tsx after </ReactFlow>):
  1. :8702-8725 legacy full config panel WorkflowNodeSettingsPanel (data-testid=workflow-node-settings)
  2. :8727-8735 typed panel SelectedRuntimeSettings (nodeRegistry.tsx:60-67; agent → AgentNodeSettings.tsx:125 → NodeSettingsShell.tsx:19 → WorkflowFloatingPanel, data-testid=workflow-component-settings)
  3. :8737+ inline info bar (workflow-node-config), inverse of 1/2
- Canonical: BOTH are intentional — legacy panel for terminal-session agents (search/save/restart, AC-005, e2e wf-ui-m2-node-settings.spec.ts:337-342); typed panel for component nodes. Bug is overlap on mixed nodes.
- IMPORTANT: an uncommitted draft fix already exists in the working tree (git diff HEAD→worktree): Block A adds `!(selectedRuntimeNode && SelectedRuntimeSettings)` guard at :8702; Blocks B/C replace selectedComponentType with selectedRuntimeNode (and delete selectedComponentType derivation). After this the two gates are mutually exclusive → exactly one panel. Remaining: (1) commit it; (2) add e2e assertion: opening settings on terminal-session agent AND agent component node → workflow-node-settings + workflow-component-settings total === 1; (3) transient: while fetchRuntimeNode in-flight the legacy panel shows first then switches — acceptable; a single derived settingsSurface value would make the invariant structural.
- Risks: unverified draft (no test covers overlap); selectedNode fallback `|| canvasNodes[0]` (WorkflowRoute.tsx:4029-4032) may desync selectedNode from selectedNodeIds.

### E6 — magnet/snap drift
- Snap state model: drag-time capsuleMagnetDrag (WorkflowRoute.tsx:315-318, set :8016/cleared :8023); capsuleDockPreview (:3744, computed updateCapsuleDockPreview :6480-6500); persistent graphState.capsuleDockLinks. Classes via capsuleDockClassName (:3337-3363): anchor/dragged/docked + side.
- Snap math: snapCapsulePosition (:2030-2051); top: x = anchor.x + (anchor.w - dragged.w)/2, y = anchor.y - dragged.h - CAPSULE_DOCK_GAP(14); committed :6673-6674.
- Size chain: nodeRect (:1937-1947) = graph x/y + displayedNodeSize (:1921-1935) = Math.max(fallback, visualSizes); fallback for component = max(node.width, COMPONENT_NODE_W=352) (:1891-1895); visualSizes = mergeVisualSizeMaps(flowNodeVisualSizesRef, measuredDomNodeSizeMap(getBoundingClientRect/zoom)) (:3811-3819, :553-571).
- DRIFT ROOT CAUSE: indicator pill is CSS-only (index.css:1087-1173, position:absolute inside .react-flow__node → cannot leave its node). "Far away" = snapped node position disagrees with anchor. Snap size = Math.max of 3 sources (:1927-1934, :546-549) and flowNodeVisualSizesRef is NEVER invalidated. File node rendered height changes async (image/video/pdf previews after mount; FileComponentNode.tsx:144-201 IntersectionObserver + blob URL effects). Stale mount-time or fallback-inflated height persists → top-snap y = anchor.y - h - 14 lands the node far above the anchor (h too big) — matches "drift + top-snap affected". Ruled out: zoom (DOM rect divided by zoom :560), double transforms, wrong ancestor.
- Minimal fix: mergeVisualSizeMaps (:541-551) prefer DOM-measured override instead of Math.max; re-measure at onNodeDragStart (:8008-8017). Or drop fallback inflation in displayedNodeSize (:1931-1934).
- E2E affected: wf-ui-m4-magnetic.spec.ts top-dock (:483-533), Timer (:535-585) assert dock classes/positions not pill pixels — fix keeps them green (14px gap preserved). wf-ui-m3-component-nodes.spec.ts:2787-2830 unaffected.
- Risks: root cause inferred from code, not browser-repro'd; no test asserts pill pixel position → needs manual/visual check after fix.

## Completed

- W2-A (cursor): done — index.css:641-662 black SVG cursor overrides for .react-flow__pane.draggable/.dragging/.selection (white outline, fallback grab/grabbing/pointer). Visual check pending.
- W2-B (create-node panel css): done — create-node-panel.css body→flex column min-height:0 overflow:hidden; catalog→flex column; options→flex:1 min-height:0 overflow:auto (single scroll container). Visual check pending.
- W2-D (placeholder component): done — NEW NodeLoadingPlaceholder.tsx + node-loading.css + @import in index.css:7. API {kind,width,height,label?}, testid workflow-node-loading-placeholder, reuses workflow-toast-orb + pulse keyframes, motion spring enter, reduced-motion guard. tsc clean.
- W2-E (m2 spec): done — two AC-001 tests appended: Case A terminal-session agent with runtime kind:'agent' mock → exactly one settings panel (RED without guard); Case B markdown component node → combined count === 1, legacy never. page.route mocks for GET /api/workflow/nodes/*. Not run (deferred to verifier).
- W2-C (skills hub): done — nodeRegistry skill/skill-group entries removed (hub union kept: WorkflowRoute:8173 still compares hub==='skills'); overlay: draft set + draggable chip/rows + exports SKILL_GROUP_TRANSFER_TYPE/SkillGroupDragPayload + onDraftDragStart prop; motion bottom bar, tabular-nums, 40px chip, reduced-motion gated. tsc clean. Follow-ups: (1) wf-ui-m3-component-nodes.spec.ts:1801-1832,:1860-1862 assert catalog skill entries → assigned to W3b; (2) legacy capability hub drawer still reachable via agent right-click menu — kept per surgical scope (single skills surface = hub overlay for creation); (3) new hub strings need i18n keys (translations.ts, W3b).
- W3a (config button removal): done — WorkflowRoute.tsx: showCanvasConfig state + 6 setters + hasOpenOverlay ref + deps entry + diagnostics panel JSX + context-menu entry + toolbar gear button deleted; translations.ts Canvas Config keys (both variants, en/zh) removed; layers.css z-index entry dropped; wfBrowserRouteCapabilities.ts selector dropped; tests/anti-drift.test.js 2 assertions removed. Residual grep: zero code refs. tsc exit 0. Anti-drift: 20 pass / 1 PRE-EXISTING fail (unrelated branch state, a2a-store temp roots — not from this task; verifier to confirm).
- W3b (behavior changes): done — (a) E1 draft verified coherent, no edit needed (three mutually exclusive gates :8844/:8869/:8879); (b) E3 drag wired: SKILL_GROUP_TRANSFER_TYPE import, readSkillGroupTransfer helper :732, drop path :6402 → createSkillGroupAtPosition shared helper :5904 (createSkillGroupNode :6010 thin wrapper; legacy paths keep exact behavior), onDraftDragStart :9174 hides overlay via setSkillsOverlay({open:false}), window dragend effect :7995 reopens hub if no drop; (c) E6: mergeVisualSizeMaps DOM-wins (:541), displayedNodeSize returns measured directly (:1921), onNodeDragStart re-measures (:8017); gap/dock classes untouched; (d) E7: PendingNodePlaceholder type :365 + component :3373, nodeTypes 'loading-placeholder', pendingNodes merged in toFlowNodes effect :5266 (updateGraph verified client-only), inserted in all 6 create paths after position computed, removed on resolve + every catch, sized via fallbackNodeVisualSize; fixed sameFlowNodes crash on placeholder data; (e) E4: maxHeight min(536px, calc(100vh - var(--header-h) - 24px)) :8298, --header-h=48px verified; (f) m3 spec: catalog loop ['mcp'] only + skill count-0 assertions, removed create-panel→legacy-hub click flow; agent-menu legacy drawer flow intact; (g) i18n: 3 new en+zh keys. tsc exit 0.
- Implementation waves COMPLETE (W2-A..E, W3a, W3b). Next: verification wave (typecheck + e2e subset + screenshots) + independent review.
- W3 review (independent): APPROVE + findings — MEDIUM: drag-cancel restore broken (overlay unmounts on close at WorkflowRoute.tsx:9159 → draftSkillIds discarded; dragend reopens empty :8082-8094 + WorkflowSkillsHubOverlay.tsx:191-195; drop-start clears skillsDraftDragActiveRef :6400 before async create settles → failed create also loses draft with no reopen). LOW: pendingNodes no expiry (permanent placeholder if request never settles, :5266-5288). LOW: E6 sizes cached, refreshed only on drag start/dock ops (stale window between interactions; accepted residual). INFO: AC-004 drag flow has no e2e; some hub strings pre-existing untranslated. AC compliance: AC-001..003 PASS, AC-004 PARTIAL, AC-005..008 PASS (by inspection). Decision: fix MEDIUM + LOW(expiry) after verifier finishes (avoid racing its build/e2e); add AC-004 drag e2e spec.
- W3 verification (independent): build PASS (38.5s); m2+m4: 12 passed / 2 failed (the 2 new AC-001 tests — test-authoring bugs: Case A `count()+count()` on Promises at m2 spec :680; Case B fixture workflowSnapshotWithMarkdown() :155 missing componentType/control/stateRef/componentNodes per m3 schema); m3 "unified node picker": 1 failed at :1864 — BLOCKER: AC-008 crash: MiniMap nodeColor at WorkflowRoute.tsx:8248 reads (node.data).workflowNode.status on 'loading-placeholder' node → TypeError → React unmounts (canvas 0 nodes), reproduced via delayed-POST driver; AC-002 cursor PASS w/ screenshot; AC-003/004 catalog green, drag source-verified only; AC-005 PARTIAL FAIL: inline min(536px) cap :8298 defeated by pre-existing !important max-height layers.css:10-14 (computed 704px) → panel bottom clipped 23px at 768h; AC-006 PASS zero refs; AC-007 m4-magnetic fully green; npm test 285/1/1 — the fail pre-existing (wf-ui-server temp roots), unrelated confirmed. Evidence: evidence/{01-ac002-canvas-pane.png,02-ac005-create-node-panel-1368x768.png,04-ac008-after-resolve.png}.
- W4 fix wave dispatched: W4-A (implementer): nodeColor guard, draft-restore (overlay hidden-not-unmounted during drag; reopen with draft on cancel/failed create), pendingNodes 60s expiry, layers.css max-height fix. W4-B (test-writer): fix 2 AC-001 test bugs + NEW wf-ui-skills-hub-drag.spec.ts (AC-004 drag e2e incl. cancel-restore).
- W4-A done: (1) nodeColor → statusColor(node.data?.workflowNode?.status) — placeholder falls to neutral #6b7280; (2) skillsDragHideActive state + hidden prop (visibility:hidden) — overlay mounts when open||hideActive; dragstart sets flag; success closes, failure/cancel reopen with draft intact; X clears+unmounts; Escape no-op while hidden; (3) pendingNodeTimersRef 60s expiry, cleared via removePendingNode on all resolve/catch; (4) layers.css:13 max-height min(536px, calc(100vh - var(--header-h) - 24px)) !important (clamp invariant respected). tsc green.
- W4 re-review (reviewer): code APPROVE; HIGH test bug in new drag spec :600-601 (stale pre-W4 assertions) → W4-B fixed (assert open='true', count 1, visibility hidden; dragend-reopen assertions kept).
- W4 re-verification (fresh W4 build): AC-001 PASS (m2 green); AC-005 PASS (computed maxHeight 536px, panel fully in viewport @1368x768, screenshot re-captured); AC-007 PASS (m4 green); AC-004 PARTIAL/BLOCKED; AC-008 FAIL — BLOCKER persists: React error #185 "Maximum update depth exceeded": merge effect WorkflowRoute.tsx:5263-5305 → setNodes → ReactFlow store sync (adoptUserNodes → forceStoreRerender) loop when a loading-placeholder enters the controlled nodes array; app unmounts (canvas 0 nodes). Reproduced: m3 AC-001 :1864, drag tests 1/3, delayed-POST driver. NOT minimap (probe with minimap closed still crashes). Verifier suggestions: render placeholders as overlay divs on the flow wrapper (outside ReactFlow node lifecycle), or cache placeholder flow-node objects per pendingId + stabilize effect deps. Drag test 2 order-dependent flake in combined run — re-check after crash fix. Debugger dispatched (W5).
- W5 (#185 fixed): root cause — sameFlowNodes (WorkflowRoute.tsx:3632) always returned false for placeholders (no data.workflowNode) + merge effect deps include callbacks recreated every render (useT fresh t → startNode → callbacks churn) → every render re-ran setNodes with new placeholder object → ReactFlow re-adopt → re-measure → onNodesChange → loop → #185. Fix: sameFlowNodes now compares placeholder content (kind/label/width/height) so unchanged placeholders short-circuit setNodes. Evidence: m3 "unified node picker" PASS; drag tests 1/3 PASS; m3 full 24/6 (6 failures pre-existing, identical with/without fix — outside task); tsc clean.
- W4-B fix 2: drag spec failed-create route override now pushes payload into network.skillGroupCreateRequests before returning 500 (:630-637) — test 2's toHaveLength(1) can pass; 500 response unchanged. Final verification pass dispatched to verifier.
- CEO verification 2026-08-14: W2-A/W2-D index.css edits coexist (import line 7 + cursor rules 642-658 intact); `cd src/ui && npx tsc --noEmit` → exit 0.

## Changed Files

- src/ui/src/index.css (W2-A: cursor overrides ~:641-662; W2-D: @import node-loading.css line 7)
- src/ui/src/styles/workflow/create-node-panel.css (W2-B: responsive flex rules)
- src/ui/src/components/workflow/NodeLoadingPlaceholder.tsx (W2-D: new)
- src/ui/src/styles/workflow/node-loading.css (W2-D: new)
- src/ui/src/components/WorkflowSkillsHubOverlay.tsx (W2-C: draft set + drag chip)
- src/ui/src/components/workflow/nodeRegistry.tsx (W2-C: skill entries removed)
- src/ui/src/e2e/wf-ui-m2-node-settings.spec.ts (W2-E: AC-001 tests)
- src/ui/src/i18n/translations.ts (W3a: Canvas Config keys removed)
- src/ui/src/styles/workflow/layers.css (W3a: config z-index rule removed)
- src/ui/src/wfBrowserRouteCapabilities.ts (W3a: selector dropped)
- tests/anti-drift.test.js (W3a: 2 assertions removed)

## Verification

(none yet)

## Notes

- User report (2026-08-14, /wf-max):
  1. Node settings pops up two panels (agent node; maybe others) — must be one.
  2. Canvas is white — make wf-ui cursor black.
  3. Skills hub: only one should exist; remove the one inside create-node panel; hub must support composing a skill set and dragging it onto the node map as a skills package for agents; use /make-interfaces-feel-better; think through skills hub ↔ node-map skills group operation.
  4. Create-node panel overflows — responsive layout.
  5. Top-right canvas config button does nothing — remove.
  6. Magnet/snap position drift: file node snap state renders far from the node; top-snap state also affected.
  7. Node creation: render a same-size plain node with smooth thinking-orb loading animation while the node initializes.

## Goal Completed

- at: 2026-08-14T08:53:48.070Z
- goalNodeId: goal-task-fix-wf-ui-ux-issues
- items: 0

## Goal Completed

- at: 2026-08-14T08:53:48.639Z
- goalNodeId: goal-task-fix-wf-ui-ux-issues
- items: 0
