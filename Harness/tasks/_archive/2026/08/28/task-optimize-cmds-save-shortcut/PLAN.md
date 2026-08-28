# task-optimize-cmds-save-shortcut - PLAN

Compact task record. Browser-visible keyboard behavior across 6 surfaces -> expanded AC matrix + e2e contract.

## Goal

- Outcome: Give wf-ui a coherent, context-aware **Ctrl/Cmd+S** shortcut:
  - **No node open** (focus on the canvas): Ctrl+S forces the graph save (flush the debounced `PUT /api/a2a/graph-map`) and shows a success toast. The graph is already auto-saved, so this is a "confirm saved" affordance.
  - **A specific node is open**: Ctrl+S saves THAT node via its existing save function. Applies to the 5 nodes that have a real editable + save surface: **Excalidraw (diagram), Markdown, File (text kinds), Goal, Timer**.
- Non-goals:
  - Display node (read-only HTML report, agent-written) — no user save, no shortcut.
  - Agent settings panel / generic `WorkflowNodeSettingsPanel` — a config surface, not a diagram/drawing surface; excluded this pass (documented decision D3).
  - Changing auto-save behavior, save semantics, or backend APIs. This is purely a shortcut + confirmation on top of existing save functions.

## Scope

- Write set (disjoint across workers):
  - **Worker N (nodes)**: `src/ui/src/hooks/useSaveShortcut.ts` (new), `src/ui/src/components/ExcalidrawComponentNode.tsx`, `src/ui/src/components/MarkdownComponentNode.tsx`, `src/ui/src/components/WorkflowFileBigView.tsx`, `src/ui/src/components/WorkflowGoalExpandedNode.tsx`, `src/ui/src/components/WorkflowTimerExpandedNode.tsx`.
  - **Worker G (global canvas save)**: `src/ui/src/components/WorkflowRoute.tsx`, `src/ui/src/i18n/translations.ts` (only the one new key).
  - **Worker T (tests)**: `src/ui/e2e/wf-ui-cmds-save-shortcut.spec.ts` (new).
- Forbidden:
  - Do not change any existing save function's body/semantics; only add a keyboard trigger that calls it.
  - Do not add a browser `window` keydown listener in **bubble** phase for the node surfaces (must be **capture** phase — see D1). Do not touch `handleKeyboardGlobally` on the Excalidraw editor.
  - Do not remove or re-order the existing global `keydown` branches (Esc, Ctrl+Z/C/X/V/A, Delete) in WorkflowRoute.
  - No `0.0.0.0`, no backend changes, no new dependencies.

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| D1 | Node surfaces intercept Ctrl+S via a **capture-phase** `window` listener (new `useSaveShortcut(onSave, active)` hook). The global canvas Ctrl+S stays in the **existing bubble-phase** `onKeyDown` in WorkflowRoute. | Capture fires before bubble on the same `window`; the node hook calls `stopPropagation()` so the bubble canvas handler is skipped while a node overlay is open. Deterministic precedence without a shared "which overlay is open" registry. Excalidraw's canvas focus does NOT match the existing input/contenteditable guard, so a bubble canvas handler would wrongly fire for excalidraw — capture pre-emption fixes that. | 2026-08-24 |
| D2 | One shared hook `useSaveShortcut(onSave, active)` reused by all 5 node surfaces. Hook holds `onSave` in a ref (stable), registers/unregisters the capture listener on `active`. | 5 identical call sites; single place to fix the shortcut logic. Keeps each node change to ~2 lines (import + one call). | 2026-08-24 |
| D3 | Exclude Agent settings / generic settings panel and Display node from Ctrl+S. | They are not content/diagram editing surfaces the user named. Display is read-only. Documented as non-goal; trivial follow-up if wanted. | 2026-08-24 |
| D4 | Canvas (no node) Ctrl+S = flush pending graph PUT (`graphPutFlushRef.current?.()`) + success toast via `showWorkflowToast`. Local localStorage/IndexedDB already persist on change; the PUT is 250ms-debounced. | Matches user's "它自动保存但 toast 告诉保存成功". Flush is a no-op when nothing pending (graph already current) — toast still shown. | 2026-08-24 |
| D5 | Node Ctrl+S calls the node's **existing** save fn and relies on its existing feedback (Saving…/Saved/dirty indicator, revision bump). No new per-node toast. | Avoids premature toast before async save completes; existing feedback is already correct and localized. | 2026-08-24 |
| D6 | WF-Max-Useful fan-out = 3 parallel agents (Worker N, Worker G, Worker T), not 7 per-file. | Each per-file edit is <15 lines and uniform; 7 subagents would exceed the 0.30 overhead threshold and add cross-worker hook-contract risk. Grouping the hook + its 5 consumers in one Worker keeps the contract internally consistent. Disjoint write sets preserved. `fanoutAttempted: true`. | 2026-08-24 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | No node open, focus on canvas: Ctrl+S force-flushes a PENDING graph save (distinguishable from the 250ms debounce) and shows a success toast containing "saved"/"Saved". No node component save fires. | e2e: schedule a debounced graph-map PUT, Ctrl+S well inside the 250ms window -> `graph-map` PUT observed BEFORE the debounce could fire (proof of flush, not natural expiry) + `data-testid="workflow-toast"` visible with saved text + zero `componentPutRequests`. | pass (W-V-rerun2: 10/10 x2, tsc clean, 2026-08-24) |
| AC-002 | Excalidraw fullscreen open: Ctrl+S saves the current draft scene (component PUT carrying the draft), and the canvas bubble handler does NOT also fire. | e2e: open excalidraw fullscreen, Ctrl+S -> `componentPutRequests` includes excalidraw scene PUT. | pass (W-V-rerun2) |
| AC-003 | Markdown fullscreen open: Ctrl+S saves (PATCH with bumped revision + edited content). | e2e: open markdown fullscreen, edit, Ctrl+S -> `componentPutRequests` includes markdown PATCH. | pass (W-V-rerun2) |
| AC-004 | File big view (text/md/json kind), dirty: Ctrl+S fires the file save. | e2e: open file big view, make dirty, Ctrl+S -> file save request recorded. | pass (W-V-rerun2) |
| AC-005 | Goal expanded open: Ctrl+S fires the goal save (plan/acceptance update). | e2e: open goal expanded, Ctrl+S -> goal node action recorded with echoed payload fields. | pass (W-V-rerun2) |
| AC-006 | Timer expanded open: Ctrl+S fires the timer save. | e2e: open timer expanded, Ctrl+S -> timer node action recorded with echoed payload fields. | pass (W-V-rerun2) |
| AC-007 | Ctrl+S is a no-op (no save, no toast) when focus is in a terminal (`.xterm`) or a plain non-save input. | e2e: plain-input case + AC-007b `.xterm` case with an active capture surface -> no save request, no toast (exact count). | pass (W-V-rerun2) |
| AC-008 | Regression: existing shortcuts still work — Ctrl+Z / Ctrl+Shift+Z undo/redo, and Delete removes a selected node; the new **capture** listener does not swallow them (it only intercepts `key === 's'`). The test must run with a node surface OPEN so the capture hook is actually active, then press non-'s' keys and prove they reach their canvas handlers / are no-ops (not eaten, not turned into a save). | e2e: goal surface OPEN (hook active), non-editor focus: Ctrl+Z -> no save/action/delete/toast; Delete -> node.delete recorded + node detaches. AC-008b keeps the surface-CLOSED Ctrl+S no-delete case. | pass (W-V-rerun2) |

Expanded contracts (verified against components 2026-08-24): e2e selectors — toast `data-testid="workflow-toast"`; fullscreen `data-testid="workflow-component-fullscreen"` (`data-component-type`=markdown/excalidraw); file big view `data-testid="workflow-file-big-view"` + editor `data-testid="workflow-file-big-view-text-editor"` (NOTE: there is NO `workflow-file-big-view-save` testid); goal/timer expanded per existing specs; node header `.workflow-component-node-header`. Fixture reference: this spec's own `installWorkflowFixture` (self-contained), plus `src/ui/e2e/wf-ui-m3-component-nodes.spec.ts` for the original pattern (`openWorkflow`, `network.componentPutRequests`, graph-map route).

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Capture listener breaks existing shortcuts / Excalidraw typing | Hook intercepts ONLY `key === 's'` with Ctrl/Cmd; `stopPropagation` only on that branch. AC-007/AC-008 guard it. | open |
| Excalidraw editor swallows / fights the key | Hook uses native window capture (fires before Excalidraw's internal handler and before React); do NOT change `handleKeyboardGlobally`. Verified in AC-002. | open |
| Cross-worker hook contract drift | Hook + all 5 consumers written by ONE Worker (Worker N) -> internally consistent. | open |
| File big view Ctrl+S when not dirty | Worker N guards `handleSave` on `dirty` (mirrors the disabled Save button). | open |
| i18n key missing in non-English | `t()` falls back to the English key (I18nContext.tsx:49); Worker G adds the one canvas key to en + zh. | open |

## Subagent Dispatch (D-GATE)

Tier: **WF-Full** (browser-visible behavior, 6 surfaces, capture-phase listener). Acceptance = verifier (real Playwright run) + cross-review (spec + code) PASS + reflector PASS.

| # | Role | AgentName | Mode | Write set (disjoint claims) | Read set | Deps | AC IDs | Status |
|---|------|-----------|------|------------------------------|----------|------|--------|--------|
| W-N | implementer | implementer | Write | hooks/useSaveShortcut.ts; components/ExcalidrawComponentNode.tsx; components/MarkdownComponentNode.tsx; components/WorkflowFileBigView.tsx; components/WorkflowGoalExpandedNode.tsx; components/WorkflowTimerExpandedNode.tsx | same + i18n/I18nContext.tsx, workflowToast.ts, e2e m3 spec (ref) | none | AC-002..006,007 | Pending |
| W-G | implementer | implementer | Write | components/WorkflowRoute.tsx; i18n/translations.ts | same + workflowToast.ts, e2e m3 spec (ref) | none | AC-001,007,008 | Pending |
| W-T | test-writer | test-writer | Write | e2e/wf-ui-cmds-save-shortcut.spec.ts | PLAN (this file), e2e m3 spec, components (selectors only) | W-N,W-G contracts (in AC) | AC-001..008 | Pending |
| W-V | verifier | verifier | Read/Bash | none | all of the above | W-N,W-G,W-T | all | Pending |
| W-R1 | reviewer (spec/AC) | reviewer | Read | none | diff, PLAN | W-V | all | Pending |
| W-R2 | reviewer (code/arch) | reviewer | Read | none | diff | W-V | all | Pending |
| W-F | reflector | reflector | Read | none | evidence, findings | W-R1,W-R2 | all | Pending |

Self-audit:
- [x] Write sets disjoint (Worker N: 6 files; Worker G: 2 files; Worker T: 1 file — no overlap).
- [x] One file_claim grouping is documented (D6, WF-Max-Useful degradation).
- [x] AC IDs mapped to every worker.
- [x] `fanoutAttempted: true` — 3 parallel native subagents (W-N, W-G, W-T); degradation from 7-way documented in D6.
- [x] Implementer ≠ validator for same AC (W-V is independent of W-N/W-G).
