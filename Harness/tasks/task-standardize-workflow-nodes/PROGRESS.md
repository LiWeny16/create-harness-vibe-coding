# task-standardize-workflow-nodes - PROGRESS

Compact heartbeat.

## Current

- Phase: Implementation
- Next: Wait for W2G graph persistence debugger, then rerun M3/M4/M5 and CDP closeout.
- Blocker: no user blocker. W2 implementation is in progress through bounded subagents.

## Verification

- [x] W0 native subagent fan-out completed and closed.
- [x] `pnpm exec tsc --noEmit` in `src/ui` passed.
- [x] Targeted backend component/workspace tests passed: 21 tests.
- [x] Targeted M3 Playwright node-picker/drop tests passed: 2 tests.
- [x] Targeted M1 Playwright reproduced Explorer isolation failure: node drifted `26.17822265625px`.
- [x] RED backend tests for workspace file pipe and connected resource context.
- [x] RED Playwright tests for Explorer preview/menu isolation, node context menu, overlay z-index, bridge gesture, fullscreen editors, React #185 guard, and performance smoke.
- [ ] W2 implementation Workers.
- [ ] Independent spec/API/performance reviews.
- [ ] CEO CDP closeout against `/workflow`.

## RCA Summary

The current failures come from multiple layers:

- Architecture instability: `WorkflowRoute.tsx` centralizes too many graph, UI, persistence, terminal, overlay, and editor concerns.
- Interaction detail bugs: Explorer, canvas, node, edge, and pane gestures do not have a single ownership model.
- API contract gaps: the file read endpoint exists, but the full file pipe for browser previews and agent-readable content refs is incomplete.
- Persistence instability: pointermove and transient edge offset changes can become durable graph-map writes.
- Overlay instability: toast/menu/panel z-index is not a declared layer system.
- Performance instability: exact zoom fanout, eager previews, deep scene comparisons, and broad state effects can cause rerender storms.
- React crash: user reported React minified error #185, treated as a P0 update-loop failure until CDP reproduces and the fix is verified.

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
