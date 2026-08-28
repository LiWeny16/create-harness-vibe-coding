# task-fix-wf-ui-ux-issues - PLAN

Compact task record.

## Goal

- Outcome: fix 7 wf-ui UX issues reported by the user on 2026-08-14:
  1. Node settings must open exactly one panel (currently two panels appear; seen on agent node, may affect other node types).
  2. Cursor on the white wf-ui canvas must be black/visible.
  3. Skills hub must be the single skills surface: remove skills-hub entries from the create-node panel; enable composing a skill set in the hub and dragging it onto the node map as a skills group attachable to agents. Use `make-interfaces-feel-better` skill for UI polish; document how Skills Hub ↔ node-map skills group operate.
  4. Create-node panel must use responsive layout (currently overflows).
  5. Remove the non-functional top-right canvas config button.
  6. Fix magnet/snap indicator position drift (file node snap state renders far from the node; top-snap state also affected).
  7. Node creation: render a same-size plain placeholder node with a smooth thinking-orb loading animation until the real node is initialized/loaded.
- Non-goals: redesigning the whole wf-ui; changing backend action semantics beyond what the skills-group flow requires; new node types.

## Scope

- Write set (expected, to be confirmed after W0): `src/ui/src/**` (WorkflowRoute.tsx, workflow/*.tsx, styles/workflow/*.css, index.css), possibly `src/wf-ui-server/workflow-capability-node-store.mjs` if the skills-group drag needs a backend change. Task state files under `Harness/tasks/task-fix-wf-ui-ux-issues/` + `Harness/PROGRESS.md`.
- Forbidden: `Harness/a2a/**` state files (backend-owned), `src/ui/dist/**` (build output), existing e2e specs unless a fix requires updating an assertion, `.claude/rules/**`.

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | New task capsule `task-fix-wf-ui-ux-issues` | Scope substantially different from active task-agent-control-parity | 2026-08-14 |
| 2 | WF-Max-Useful fan-out | 7 issues are largely independent investigation lanes; implementation waves follow disjoint write sets | 2026-08-14 |
| 3 | memory hints: none | No L3 route scenario matched | 2026-08-14 |
| 4 | W0 explorers are read-only codebase-explorer agents | Investigation first, no code until root causes + design are synthesized | 2026-08-14 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | Opening settings on any node type renders exactly one settings panel; closing it removes all settings UI | e2e wf-ui-m2-node-settings.spec.ts extended + browser screenshot | pending |
| AC-002 | Canvas cursor is black and visible on the white background (all canvas tools: select, pan, connect) | browser screenshot | pending |
| AC-003 | Create-node panel contains no skills-hub surface; Skills Hub is reachable from a single entry | browser screenshot + DOM assertion | pending |
| AC-004 | Skills Hub allows selecting/composing multiple skills and dragging the composed set onto the node map; a skills group node appears and can be attached to an agent | manual drag + e2e assertion | pending |
| AC-005 | Create-node panel fits viewport with no overflow at 1366×768 and 1920×1080 | Playwright viewport screenshots | pending |
| AC-006 | Top-right canvas config button is gone; no dead UI remains | DOM assertion | pending |
| AC-007 | Snap indicators (all 4 orientations) render exactly at the node's snap points with no drift | e2e wf-ui-m4-magnetic.spec.ts + screenshots | pending |
| AC-008 | Creating a node shows a same-size placeholder with thinking-orb animation; placeholder is replaced by the real node when initialized | browser screenshot sequence | pending |

## Expanded Contracts

- AC-004 needs a short design note (after W0) documenting Skills Hub ↔ skills group semantics before implementation.

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Skills-group drag touches backend store semantics | Keep frontend-first; only extend backend if the drag target requires a new node kind | open |
| Magnet geometry change could regress other snap orientations | Run wf-ui-m4-magnetic e2e before/after | open |
| Loading animation could block data availability | Animation overlay must not delay the real node mount | open |

## Fan-Out Record

- fanoutAttempted: true
- runtime: claude (current session), channel: native Agent tool subagents
- W0: 7 read-only codebase-explorer agents in one parallel wave (E1-E7)
- limits: Claude Code session caps (CLAUDE_CODE_MAX_* env) unknown at dispatch time; Harness WF-MAX per-wave cap 7 — 7 read-only scouts do not count toward the 15 worker cap

## Subagent Dispatch

W0 exploration wave (read-only):

| Row | Agent | Objective | Read set | Output |
|-----|-------|-----------|----------|--------|
| E1 | codebase-explorer | Why does node settings open two panels? | `src/ui/src/components/workflow/**`, `WorkflowRoute.tsx` | Root cause + file:line + fix approach |
| E2 | codebase-explorer | Where is canvas cursor styled? | `src/ui/src/index.css`, `styles/**`, canvas components | CSS rules + fix |
| E3 | codebase-explorer | Map Skills Hub ↔ skills group operation and drag gaps | `WorkflowSkillsHubOverlay.tsx`, `nodeRegistry.tsx`, `create-node-panel.css`, `WorkflowRoute.tsx`, `src/wf-ui-server/workflow-capability-node-store.mjs` | Data-flow map + gap list + design suggestion |
| E4 | codebase-explorer | Create-node panel layout structure and overflow causes | `create-node-panel.css`, the panel component, `floating-panel.css` | Layout structure + responsive fix plan |
| E5 | codebase-explorer | Locate top-right canvas config button and confirm it is dead | `WorkflowRoute.tsx`, `Header.tsx`, related | file:line + removal plan |
| E6 | codebase-explorer | Trace magnet/snap position math and drift cause | magnetic logic in `src/ui/src/**`, `e2e/wf-ui-m4-magnetic.spec.ts` | Position computation chain + drift root cause |
| E7 | codebase-explorer | Node creation flow; placeholder/animation insertion points; check for thinking-orb lib | `WorkflowRoute.tsx` creation path, `WorkflowComponentNode.tsx`, `src/ui/package.json` | Flow map + insertion points + lib availability |

## W0 Synthesis (2026-08-14)

- E1: uncommitted draft fix already in working tree (guard `!(selectedRuntimeNode && SelectedRuntimeSettings)` at WorkflowRoute.tsx:8702 + selectedComponentType→selectedRuntimeNode refactor). Decision: adopt + verify + e2e assertion. Rejected: full structural settingsSurface refactor (riskier; draft exists; user asked for single panel, not refactor).
- E2: black SVG data-URI cursor override in index.css (zero deps). Rejected: recolorable asset file (overkill).
- E3: canonical Skills Hub = fullscreen overlay. Remove catalog skill/skill-group entries. Compose = multi-select draft set in hub; drag chip → overlay hides on dragstart → drop on canvas creates skill-group node. Frontend-only; backend store already supports skill-group.
- E4: pure CSS flex fix in create-node-panel.css + viewport-based inline maxHeight adjustment in WorkflowRoute (wave 3).
- E5: remove button + panel + state + context-menu entry + satellite references (atomic in wave 3).
- E6: prefer DOM-measured override in mergeVisualSizeMaps + re-measure at onNodeDragStart; keep CAPSUDE_DOCK_GAP semantics.
- E7: pendingNodes map + placeholder nodeType reusing workflow-toast-orb keyframes + motion; non-blocking swap.

## D-GATE — W2/W3 Dispatch Table

AC IDs covered: AC-001..AC-008.

Wave 2 (parallel — disjoint file claims):

| # | Agent | AC | File claim(s) | Task |
|---|-------|----|---------------|------|
| W2-A | implementer | AC-002 | src/ui/src/index.css | Black SVG cursor override after .wf-flow block (~:639); keep fallback grab; optional .selection/.dragging variants |
| W2-B | implementer | AC-005 | src/ui/src/styles/workflow/create-node-panel.css | Responsive: body flex column min-height:0 overflow:hidden; catalog flex:1 column min-height:0; options drop fixed 388px → flex:1 min-height:0 overflow:auto. Keep existing class names (contract with wave 3) |
| W2-C | implementer | AC-003, AC-004 | src/ui/src/components/WorkflowSkillsHubOverlay.tsx, src/ui/src/components/workflow/nodeRegistry.tsx | Hub compose UI: multi-select draft set, sticky bottom bar with draggable chip, wire onAddSkillToGroup; remove skill + skill-group catalog entries; export SKILL_GROUP_TRANSFER_TYPE + SkillGroupDragPayload |
| W2-D | implementer | AC-008 | NEW src/ui/src/components/workflow/NodeLoadingPlaceholder.tsx, NEW src/ui/src/styles/workflow/node-loading.css, + style import registration (main.tsx or App.tsx — worker discovers) | Placeholder component: props {kind,width,height,label}; orb via existing workflow-toast-orb classes; motion enter/exit; prefers-reduced-motion |
| W2-E | test-writer | AC-001 | src/ui/e2e/wf-ui-m2-node-settings.spec.ts | Add assertion: opening settings on terminal-session agent AND agent component node → exactly one settings panel (workflow-node-settings + workflow-component-settings count === 1) |

Wave 3 (serial — single claim on the contended monolith):

| # | Agent | AC | File claim(s) | Task |
|---|-------|----|---------------|------|
| W3 | implementer | AC-001..AC-008 | src/ui/src/components/WorkflowRoute.tsx, src/ui/src/i18n/translations.ts, src/ui/src/styles/workflow/layers.css, src/ui/src/wfBrowserRouteCapabilities.ts, tests/anti-drift.test.js | (a) E1: verify/finalize existing draft; (b) E3: drop handlers for SKILL_GROUP_TRANSFER_TYPE + refactor createSkillGroupNode into helper(skillIds,position) + hub wiring; (c) E5: full removal per E5 report; (d) E6: mergeVisualSizeMaps prefer DOM override + re-measure at onNodeDragStart; (e) E7: pendingNodes state + nodeTypes registration + set/clear at create callbacks; (f) E4: adjust inline panel maxHeight to viewport-based; (g) i18n keys for new UI strings |

Cross-wave interface contracts:
- W2-C exports: `SKILL_GROUP_TRANSFER_TYPE = 'application/x-harness-skill-group'`, `SkillGroupDragPayload { skillIds: string[]; label: string }`.
- W2-D exports: `NodeLoadingPlaceholderProps { kind: string; width: number; height: number; label?: string }`, default export component.
- W2-B keeps class names: workflow-create-node-panel-body / -catalog / -options.
- W3 must NOT run before W2 returns (imports the contracts).

## D-GATE Self-Audit

- [x] Dispatch table above: role, objective, AC IDs, file claims, verification
- [x] Disjoint claims within wave 2 (index.css / create-node-panel.css / 2 hub files / new files+style-import / m2 spec — no overlap)
- [x] WorkflowRoute.tsx single-owner (W3, serial after wave 2)
- [x] Workers = native subagent channel (implementer/test-writer), independent contexts
- [x] No worker may edit Harness task state (CEO owns PLAN/PROGRESS/STATE)
- [x] Reviewer plan: after W3, wave 4 = independent reviewer subagent on full diff; then verifier (typecheck + e2e subset + browser screenshots)
- [x] WF-Max-Useful: fan-out only where disjoint (5 parallel in W2, 1 serial in W3); overhead ratio acceptable
- [ ] Verification per worker: W2-A/B manual-visual note; W2-C/D run `cd src/ui && npx tsc --noEmit`; W2-E compiles (playwright spec, no run until W3 done)
