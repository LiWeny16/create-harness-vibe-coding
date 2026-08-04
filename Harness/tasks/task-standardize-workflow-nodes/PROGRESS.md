# task-standardize-workflow-nodes - PROGRESS

Compact heartbeat.

## Current

- Phase: Implementation
- Next: Resume the bidirectional connection-state fix from the current dirty worktree, finish implementation, update architecture/spec docs, then rerun backend, typecheck, build, and Playwright validation.
- Blocker: paused by user request. Do not archive this task while the bidirectional connection changes are partially implemented and not fully verified.

## Verification

- [x] W0 native subagent fan-out completed and closed.
- [x] `pnpm exec tsc --noEmit` in `src/ui` passed.
- [x] Targeted backend component/workspace tests passed: 21 tests.
- [x] Targeted M3 Playwright node-picker/drop tests passed: 2 tests.
- [x] Targeted M1 Playwright reproduced Explorer isolation failure: node drifted `26.17822265625px`.
- [x] RED backend tests for workspace file pipe and connected resource context.
- [x] RED Playwright tests for Explorer preview/menu isolation, node context menu, overlay z-index, bridge gesture, fullscreen editors, React #185 guard, and performance smoke.
- [x] Node Runtime Phase 1: 12 new files, 10 new /api/workflow/* routes, 40/40 backend tests, frontend typecheck+build pass.
- [x] Node Runtime Phase 2 Bug Fix: RED->GREEN, 54/54 tests, 6 bugs fixed (async route, delete graph cleanup, connect validation, snapshot connections, Excalidraw preview fit-to-bounds, agent adapter).
- [x] Node Runtime Phase 3 Canonical Runtime: 62/62 tests (19 existing + 13 integration + 15 runtime + 7 graph + 8 P3). Agent adapter integrated, unified node snapshot (component + agent), graph.connections in all responses, agent.delete/readContext/readOutput/stop/start/restart through /api/workflow.
- [x] W2 implementation Workers.
- [x] Independent spec/API/performance reviews.
- [x] CEO CDP closeout against `/workflow`.
- [x] wf-browser single-window smoke against `/workflow`: run `run-msdc5ali-695a04`, window `window-msdc5alp-2322d1`; create, drag, context-menu delete, agent terminal output/read and focused input control verified; backend graph-map connect command verified, but page-visible ReactFlow edge render/hydration still failed with `workflow.canvas.edges = 0`.
- [x] W2G browser/runtime closeout: `npm run build --prefix src/ui` PASS; M3 Playwright 14/14 PASS; M4 Playwright 5/5 PASS; M5 Playwright 1/1 PASS; backend canonical runtime/API target `node --test ...workflow*.mjs` 47/47 PASS.
- [x] `wf-browser` skill improved from closeout findings: settlement-before-ok, canvas readiness, stale-dist check, semantic handle rendering, deterministic overlays, layer hit-testing, and immediate modal release.
- [x] W3 independent review gate closed after accepted blockers were fixed: spec/UX, API/security, and performance/React lenses.
- [x] Final W4 closeout validation: M2 AC-010 Playwright 1/1 PASS; combined M3/M4/M5 Playwright 21/21 PASS; backend workflow/workspace/component/runtime tests 78 PASS; UI typecheck PASS; UI build PASS with existing Vite chunk-size warnings.
- [x] Final reflector `019fccde-92e4-7e61-8b8c-8549be5c6181` returned `PASS_CLOSEOUT`.
- [ ] Pause checkpoint: bidirectional connection-state follow-up is not fully verified yet. RED tests were added for runtime connection `direction: bidirectional`, `endpointRole`, and reverse duplicate edge rejection; backend runtime/A2A/agent adapter and frontend edge label/marker/type changes are partially implemented.

## RCA Summary

The current failures came from multiple layers:

- Architecture instability: `WorkflowRoute.tsx` centralizes too many graph, UI, persistence, terminal, overlay, and editor concerns.
- Interaction detail bugs: Explorer, canvas, node, edge, and pane gestures lacked a single ownership model.
- API contract gaps: the file read endpoint existed, but the full file pipe for browser previews and agent-readable content refs was incomplete.
- Persistence instability: pointermove and transient edge offset changes could become durable graph-map writes.
- Overlay instability: toast/menu/panel z-index was not a declared layer system.
- Performance instability: exact zoom fanout, eager previews, deep scene comparisons, and broad state effects could cause rerender storms.
- React crash: user reported React minified error #185, treated as a P0 update-loop failure until browser evidence cleared it.

## Subagent Evidence

| Date | Agent | Status | Integrated Finding |
|---|---|---|---|
| 2026-08-01 | codebase-explorer `019fbc4d-5551-7af3-8dfb-9eb118d818a1` | Returned, closed | Gesture ownership, overlay layering, drop ambiguity, edge persistence need redesign. |
| 2026-08-01 | architect `019fbc4d-a3ae-7002-b9b6-7bf703fb9968` | Returned, closed | File pipe needs meta/HEAD/Range/text, content refs, and WS invalidation only. |
| 2026-08-01 | performance architect `019fbc4d-f053-7ec1-9c4c-a3603ab690a5` | Returned, closed | Memo nodes, remove exact zoom fanout, debounce persistence, lazy/cap previews. |
| 2026-08-01 | test-writer `019fbc4e-3df2-7d22-9d33-35db862c5e79` | Returned, closed | Expanded AC matrix and Playwright/CDP/API RED test plan. |

## Log

| Date | Phase | Note |
|------|-------|------|
| 2026-08-01 | Intake | User confirmed node semantics: workspace files dragged from Explorer become reference File nodes; external files/images become stored File nodes; pasted large text becomes Markdown node. |
| 2026-08-01 | Intake | User accepted default bidirectional node connections for now, with permission interfaces reserved for later. |
| 2026-08-01 | Intake | User accepted Markdown default-output behavior as an agent setting with explicit target selection or oldest connected Markdown fallback. |
| 2026-08-01 | Intake | User requested agent settings become a productized settings surface: searchable categorized sections, icon side routes, tooltips, i18n, explorer-backed cwd selection, selectable permissions/launch policy, working skill add, and common actions moved to predictable locations. |
| 2026-08-01 | WF-MAX D-GATE | User escalated to `$wf-max` and requested RCA plus sufficiently detailed refactor split for subagents, with CEO CDP closeout. |
| 2026-08-01 | WF-MAX D-GATE | W0 read-only subagents completed. PLAN was rewritten around AC-001..AC-012, API/UI/state/performance contracts, and Worker waves. |
| 2026-08-01 | Verification | Current focused checks: UI typecheck PASS; backend focused tests 21 PASS; M3 node picker/drop Playwright 2 PASS; M1 Explorer isolation FAIL with `26.17822265625px` canvas drift. |
| 2026-08-01 | User Evidence | User reported React production error #185, file preview/embedding 404, drag embedding failure, and toast z-index issue. These are now first-class AC/performance/regression gates. |
| 2026-08-01 | WF-MAX W1 | Dispatched backend contract test Worker `019fbc59-1943-7b91-8c65-fb3aedfc8213` for AC-003, AC-004, AC-005. |
| 2026-08-01 | WF-MAX W1 | Dispatched interaction/CDP test Worker `019fbc59-6673-7ad3-887e-c65ef0a2407a` for AC-006, AC-007, AC-008, AC-011, AC-012. |
| 2026-08-01 | WF-MAX W1 | Dispatched component/fullscreen/performance test Worker `019fbc59-a795-7ac2-b39f-8ca849deda20` for AC-002, AC-009, AC-012. |
| 2026-08-01 | WF-MAX W1 RED | Backend contract Worker returned: `node --test src/wf-ui-server/__tests__/workspace-api.test.mjs src/wf-ui-server/__tests__/component-node-api.test.mjs` is RED with 14 pass / 5 fail. Expected failures are missing `/api/workspace/meta`, missing `HEAD /api/workspace/file`, missing `/api/workspace/text`, missing graph `contentRef`, and missing Markdown output routing resolution. |
| 2026-08-01 | WF-MAX W1 RED | Interaction/CDP Worker returned: `pnpm --dir src/ui exec playwright test e2e/wf-ui-m4-interactions.spec.ts --reporter=line` is RED with 5 expected failures covering Explorer second-click collapse, workspace menu coordinates, missing node menu/actions, bridge drag early graph-map PUT, and missing `workflow-toast`. |
| 2026-08-01 | WF-MAX W2 | Dispatched backend implementer `019fbc65-25e7-7b83-9f45-dfcdfe2acae6` for AC-003, AC-004, AC-005 with write set limited to wf-ui server source. |
| 2026-08-01 | WF-MAX W2 | Dispatched Explorer/File implementer `019fbc65-743c-7902-96e3-1fb9f615ec53` for AC-002, AC-006 with write set limited to `WorkspaceExplorerPanel.tsx`, `FileComponentNode.tsx`, and `terminalControl.ts`. |
| 2026-08-01 | WF-MAX W2 | Dispatched Canvas/bridge implementer `019fbc65-c492-7320-b72c-b1c0c1bc0e7b` for AC-001, AC-002, AC-007, AC-008, AC-011, AC-012 with write set limited to `WorkflowRoute.tsx` and optional new workflow helpers. |
| 2026-08-01 | WF-MAX W1 RED | Component/performance Worker returned: targeted M3/M5 command ran 4 tests, 1 passed and 3 expected RED failures remained: missing `workflow-file-preview`, missing `data-component-type="excalidraw"`, and missing Excalidraw fullscreen `data-editor-loaded="true"`. |
| 2026-08-01 | WF-MAX W2 | Dispatched editor/settings implementer `019fbc69-7f71-7e30-82e8-46ceef077ead` for AC-009, AC-010, AC-012 with write set limited to settings/editor/icon files. |
| 2026-08-01 | WF-MAX W2 Verify | Backend implementer returned and was closed. Local verification `node --test src/wf-ui-server/__tests__/workspace-api.test.mjs src/wf-ui-server/__tests__/component-node-store.test.mjs src/wf-ui-server/__tests__/component-node-api.test.mjs` passed 26/26. |
| 2026-08-01 | WF-MAX W2 Partial | Canvas/bridge implementer returned and was closed. Local `pnpm --dir src/ui exec tsc --noEmit` passed. Remaining focused Playwright failures are `/ws/events` 404 in test fixture/browser collector and missing visible `workflow-toast`, both assigned to later integration/style work. |
| 2026-08-01 | WF-MAX W2 Partial | Explorer/File implementer returned and was closed. Local `pnpm --dir src/ui exec tsc --noEmit` passed. Worker build passed with existing chunk-size warnings. Remaining targeted Playwright failures: canvas node drift `8.55px` and `/ws/events` 404. |
| 2026-08-01 | WF-MAX W2 Verify | Integration/debug Workers returned and were closed. Local `pnpm --dir src/ui exec playwright test e2e/wf-ui-m4-interactions.spec.ts --reporter=line` passed 5/5. |
| 2026-08-01 | WF-MAX W2 Verify | Local M3/M5 combined run passed 13/15 and failed 2 graph-map persistence checks: component node drag did not PUT persisted position, and handle connect did not PUT graph-map payload containing both component and agent node ids. Dispatched W2G debugger `019fbc9f-486f-7273-b358-ff4fa5b8772e` with write set limited to `WorkflowRoute.tsx`. |
| 2026-08-03 | wf-browser Control Smoke | Started wf-ui on `127.0.0.1:65125` and controlled one visible `/workflow` window through the first-party bridge. Verified `observe.uiTree` stable `dataAttrs`, `act.click`, `act.contextMenu`, `act.drag`, terminal output/read, and terminal focused input. Verified graph-map backend connect writes, but visible edge state stayed at 0, so AC-008 remains open for W2G. Artifacts: `Harness/wf-browser/runs/run-msdc5ali-695a04/windows/window-msdc5alp-2322d1/`. |
| 2026-08-03 | Architecture Re-Audit | User identified the missing abstraction: every large node type needs a primitive capability layer plus backend-owned state, storage, settings, and connection status. Added `PLAN.md#Node Runtime Architecture Amendment`; it defines the Node Runtime, per-type Agent/Markdown/Excalidraw/File contracts, graph semantic actions, frontend node registry, and migration order. |
| 2026-08-04 | Node Runtime Phase 3 Canonical Runtime | TDD: 8 RED tests (3 failed as expected), dispatched 2 haiku implementers (runtime.mjs + agent-node.mjs). Agent adapter registered in ACTION_ADAPTERS, executeNodeAction now branches agent vs component, listNodes/getNode include agent graph-map nodes with buildAgentSnapshot. All snapshot responses (executeNodeAction, updateNodeSettings, getNode, listNodes) fill graph.connections. agent-node.mjs: all 8 functions use (nodeId, projectRoot, payload) convention, deleteAgentNode aliased as delete, start/restart delegate to /api/a2a/nodes/:id/start|restart (400 USE_A2A_START). Final: 62/62 tests pass, typecheck+build pass. (CEO/implementer roles) with disjoint write sets. Created 12 new files: backend runtime modules (workflow-node-runtime.mjs, workflow-graph-store.mjs, workflow-node-settings-store.mjs, 3 type adapters), frontend modules (nodeRuntimeClient.ts, nodeRegistry.tsx, NodeSettingsShell.tsx, 3 settings panels). Wired 10 new `/api/workflow/*` routes into server.mjs. 2 rounds of bug fixing: initSettings flow, arg order mismatch in adapters, return shape mismatches. Final: 40/40 backend tests pass (19 existing + 21 new), frontend typecheck + build pass. |
| 2026-08-04 | W2G Browser Closeout | Closed `/workflow` runtime control gaps found by wf-browser/TDD: graph effect no longer resets edge state on unstable i18n refs; `act.intent('graph.connectNodes')` waits for rendered settlement; `data-wf-browser-ready` gates post-fitView gestures; legacy agent target handle `left` normalizes to `context`; component nodes now render all declared semantic handles; deterministic `wf:workflow-toast` hook validates overlay layers; fullscreen close releases the controlled surface immediately. Verification: build PASS, M3 14/14, M4 5/5, M5 1/1, backend target 47/47. |
| 2026-08-04 | W3 Review | Started independent read-only review gate for spec/UX, API/security, and performance/React while rerunning closeout validation commands. |
| 2026-08-04 | Validation Failure | Combined Playwright M3+M4+M5 run passed 19/20 but failed M4 AC-006 by `6.97967529296875px` x drift. Focused M4 AC-006 and full M4 reruns both passed, so the failure is order/timing-sensitive and isolated to combined-suite validation. |
| 2026-08-04 | Review Gate | W3 reviewers returned RETURN_TO_DEBUG. Accepted blockers: canonical `/api/workflow/context/:nodeId` lacks connected resource refs/output routing; AC-001/AC-010/AC-011 need stronger browser evidence and fullscreen layer fix; AC-008 reload persistence evidence is missing; M3->M4 order-sensitive AC-006 test baseline fixed by debugger with combined M3+M4+M5 now passing. |
| 2026-08-04 | Debug Dispatch | Dispatched backend canonical context/settings implementer, UI evidence/layer implementer, and performance/edge persistence test writer with disjoint write-set intent. |
| 2026-08-04 | Final Validation | Controller reran final gates after W3 fixes: M2 AC-010 Playwright 1/1 PASS; combined M3/M4/M5 Playwright 21/21 PASS; backend workflow/workspace/component/runtime target 78 tests PASS; UI typecheck PASS; UI build PASS with existing Vite chunk-size warnings. |
| 2026-08-04 | Reflector Closeout | Final read-only reflector `019fccde-92e4-7e61-8b8c-8549be5c6181` returned `PASS_CLOSEOUT`, with residual risk limited to stale/global task-index inconsistencies outside this task and untracked runtime files needing inclusion in any commit. |
| 2026-08-04 | Task Verified | Marked `w3-review` and `w4-ceo-cdp-closeout` done; all AC-001..AC-012 are verified and this task is ready for archive once the broader task index is reconciled. |
| 2026-08-04 | Pause Checkpoint | User paused after Excalidraw hydration/state persistence fix and during the bidirectional connection-state follow-up. Current dirty work includes RED tests plus partial backend/frontend implementation; finish and rerun validation before archiving. |
