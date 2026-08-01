# task-define-workflow-context-surface - PLAN

## Goal

- Outcome: Build a WF UI context surface that combines a VS Code-like workspace Explorer, controlled terminal/context insertion, categorized user-file uploads, richer agent node configuration, and trusted component nodes.
- Non-goals: Do not replace `@xterm/xterm` or `node-pty`. Do not allow arbitrary third-party React component loading in the first implementation. Do not store frontend IndexedDB/local state as the source of truth for graph/component state.

## Current Code Facts

- `src/ui/src/components/WorkflowRoute.tsx` renders the WF node map with `@xyflow/react`, using one `wfNode` type for terminal-session agent nodes.
- `src/wf-ui-server/a2a-store.mjs` builds workflow snapshot nodes from live/persisted terminal sessions and stores graph positions/edges in `Harness/a2a/workflow-map.json`.
- The create-agent panel already collects agent kind, runtime, workflow mode, working directory, objective, and model. The selected-node config panel is mostly read-only with start/stop/delete/open controls.
- There is no existing workspace file tree API or durable `Harness/user-files` upload model.
- Browser drag/drop of external files exposes file contents and names, not original local absolute paths; workspace-tree drag can safely carry repo-relative paths.

## Direction Under Discussion

- Add a default-left workspace resource explorer similar to VS Code Explorer, with collapse/floating behavior.
- Let users drag workspace files/folders from that explorer into any agent terminal/input surface as references.
- Let users drag external files or paste screenshots/images into controlled terminal/chat surfaces; store uploaded files under `Harness/user-files/<category>/...` and insert generated paths as references.
- Replace the rough double-click node detail panel with a richer node settings surface for role, custom role, prompt/objective, model, provider placeholder, restart-required status, restart action, and hover tooltips.
- Add a generic component-node capability so React components can appear inside the workflow graph with defined inputs, outputs, and observable state.
- Consider an Excalidraw-style diagram node controlled by agents and users, with all diagram state persisted through the backend rather than local-only browser state.
- Workspace Explorer file operations write to disk immediately, while backend operation records support compensating undo for create/rename/move/delete.
- Terminal reference insertion supports both tag and raw path modes; Shift-drag inserts absolute paths.
- Folder references default to `@folder(path)`, with `bundle as context` as a later explicit action.
- Component nodes begin as trusted built-ins. Editable Markdown node is in scope, with WYSIWYG and source modes.

## Research Notes

- React Flow custom nodes are React components registered in `nodeTypes`; interactive inputs require `nodrag` / `nopan` handling inside node surfaces.
- React Complex Tree is a stronger fit than a minimal tree library for Explorer behavior because it already covers accessibility, multi-select, drag/drop, keyboard control, rename, and controlled state.
- React DnD TreeView is lighter and render-prop based, but would require more custom work for a VS Code-like Explorer.
- Excalidraw exposes scene APIs including `updateScene`, `onChange`, file APIs, and internal undo/redo capture controls. Backend-source-of-truth integration must treat Excalidraw as an editor view over backend scene state.
- Current frontend exploration found `WorkflowRoute.tsx` owns graph state, node rendering, embedded terminals, create-agent UI, config panel, and graph undo in one large route component. The Explorer should mount inside `WorkflowRoute` so it appears only on `/workflow`, but implementation should carve new leaf components/helpers instead of growing the route further.
- Current drawer and embedded terminals both write to the same backend session PTY through xterm `onData`, so the correct model is one PTY per agent session with multiple observing terminal views and one active input/resize owner at a time.
- `src/ui/src/index.css` disables text selection on the canvas except form controls. Terminal copy/selection must explicitly override canvas selection behavior and expose copy/paste actions.
- Existing `src/ui/src/terminalControl.ts` already contains partial reusable terminal input/drop logic; use it as the terminal integration point rather than duplicating handlers in drawer and embedded terminal code.
- Current graph persistence can fall back to frontend cache. For this feature, backend workflow-map/component-node state must win and any local cache must be treated as hydration/cache only.

## Dependency Decisions

| Area | Decision | Why | Install Timing |
|---|---|---|---|
| File Explorer tree | `react-complex-tree@2.6.2` | Controlled tree state, keyboard navigation, multi-select, drag/drop, rename, and accessibility are already modeled. This gives VS Code-like behavior without hand-rolling the hard parts. | M1 |
| Markdown node | `@mdxeditor/editor@4.1.1` | React 19-compatible WYSIWYG Markdown editor with plugin architecture and source/diff/editor modes. Backend can keep Markdown text as the source of truth. | M3 |
| Markdown source fallback | CodeMirror 6 via MDXEditor plugins, or direct `@codemirror/lang-markdown` only if MDXEditor source mode is insufficient | Keeps source editing precise without committing to a second editor unless needed. | M3, conditional |
| Diagram node | `@excalidraw/excalidraw@0.18.1` | Mature React component with scene APIs and file support; suitable as a trusted built-in node controlled by backend scene JSON. | M3 |
| Terminal | Keep `@xterm/xterm`, current WS/PTTY backend | Existing PTY/session behavior works and should be wrapped with ownership and context insertion, not replaced. | Existing |
| Canvas | Keep `@xyflow/react` | Current workflow graph already uses ReactFlow; component nodes fit its custom node model. | Existing |

Dependency rule: add each dependency only in the milestone that uses it. This keeps the M1 regression surface narrow and makes failures easier to isolate.

## Open Questions

- Closed: global undo includes filesystem operations through backend compensating actions.
- Closed: terminal input uses one active input owner per PTY session; any terminal can acquire ownership on focus, drag/drop, or paste.
- Closed: Excalidraw ships first as a dedicated trusted built-in component node before generic third-party component loading.
- Closed: Markdown nodes initially store backend-owned content under `Harness/a2a/component-nodes/`.
- Closed: Nodes may carry manually configured skills, and the main agent/control plane may auto-assign skills from node role/task with user override.

## Draft Slice

- Vertical slice candidate: fixed-left controlled Explorer + backend workspace file API + `Harness/user-files` upload API + terminal drop/paste/reference insertion on every terminal surface + richer node config with restart-required state.
- Larger follow-up: backend event-sourced undo across file operations and graph operations, editable node templates, folder-as-context bundles, provider configuration, generic component nodes, and Excalidraw diagram node.

## Milestone Execution Plan

### M1 - Explorer, Recoverable File Ops, Terminal Context

- Add backend workspace tree/ops/undo APIs with root-bounded path resolution, JSONL operation log, and same-volume trash moves under `Harness/.trash/workspace-ops/<opId>/`.
- Add categorized user-file upload API under `Harness/user-files/images|pdf|documents|archives|text|other|context/`.
- Add fixed-left/collapsible/floating Explorer inside `/workflow`, backed by lazy tree loading and React Complex Tree.
- Wire workspace-file/folder drag and external file/image paste/drop into both drawer and embedded terminals through shared terminal-control helpers.
- Enforce one PTY per agent session with active input/resize owner metadata and visible owner state.
- Done when AC-001 through AC-004 pass backend tests, UI tests, and CDP happy/edge flows.

### M2 - Agent Node Settings And Skill Equipment

- Replace the rough node detail view with a settings panel for role, custom role, prompt/objective, model, provider placeholder, cwd, env, permissions, launch policy, skills, skill policy, context sources, and capability/tool hints.
- Persist settings in backend-owned node/session config; hot edits that affect launch show restart-required and restart from latest config.
- Add automatic skill recommendation from role/runtime/task with manual override and clear UI tooltips.
- Inject WF UI workflow-map context into node launch metadata so agents know they are running inside a workflow map and can locate graph/nodes/edges/component state.
- Done when AC-005 passes and existing create/start/stop/delete/open controls still work.

### M3 - Trusted Component Nodes

- Extend workflow node model from one `wfNode` to discriminated agent/component node types while preserving existing agent nodes.
- Add editable Markdown node with WYSIWYG and source modes, backend Markdown content as truth, revision checks, and observable inputs/outputs.
- Add Excalidraw-style diagram node backed by backend scene JSON, revision checks, persistence after reload, and agent-readable state.
- Add global undo integration for component-node edits where backend inverse operations are available; keep editor-local undo for in-session text/drawing edits and backend revision history for recovery.
- Done when AC-006 passes and CDP verifies Markdown/diagram editing, reload persistence, and agent-readable workflow context.

### Final Stabilization

- Run full build/typecheck/backend tests/CDP regression matrix.
- Do independent review waves for spec conformance, frontend architecture, backend data-loss/security, and evidence quality.
- Close only after AC-001 through AC-007 are green with evidence.

## Skill And Subagent Matrix

| Role | Skills / Inputs | Objective | Write Set |
|---|---|---|---|
| CEO/controller | `wf-max`, `subagent-orchestrator`, `tdd`, `wf-browser` | Own PRD, ACs, dispatch, review, task evidence; no production source edits. | `Harness/tasks/task-define-workflow-context-surface/*`, `Harness/PROGRESS.md` |
| test-writer-backend | `tdd` | Write RED backend/API/session tests before implementation. | `src/wf-ui-server/__tests__/*`, `tests/anti-drift.test.js` |
| test-writer-frontend | `tdd`, `wf-browser` | Write RED UI/CDP acceptance coverage for selectors and workflows. | UI test files, CDP scripts/evidence harness |
| backend-workspace-worker | `tdd` | Implement workspace tree/ops/undo/user-files APIs and efficient trash restore. | new backend store modules, `src/wf-ui-server/server.mjs` route wiring |
| backend-session-worker | `tdd` | Implement terminal input owner/context-input and node config restart wiring. | terminal/session backend modules and tests |
| frontend-explorer-worker | frontend codebase conventions | Implement Explorer shell/tree/context menu/keyboard/drag UI. | Explorer components, Workflow layout CSS |
| frontend-terminal-worker | frontend codebase conventions | Consolidate terminal drop/paste/context insertion/copy/selection/input-owner UI. | `TerminalDrawer`, embedded terminal component/helpers/CSS |
| frontend-node-settings-worker | frontend codebase conventions | Implement richer node settings and skill equipment UI. | node settings components/types/CSS |
| component-node-worker | frontend/backend conventions, `tdd` | Implement backend component-node state plus Markdown and Excalidraw trusted nodes. | component-node backend modules/routes, ReactFlow node components |
| cdp-verifier | `wf-browser` | Run Chrome/CDP full-regression matrix and save evidence. | verification scripts/screenshots/traces only |
| reviewers | `wf-review` style stance | Review independently for AC drift, data-loss/security, UI architecture, and evidence. | review notes only |

## Node Skill Equipment Model

Agent nodes gain these config fields in addition to existing runtime/session fields:

- `role`: built-in role key such as `main`, `planner`, `frontend-worker`, `backend-worker`, `reviewer`, `verifier`, or `custom`.
- `customRole`: user text used when `role=custom`.
- `prompt`: node-specific system/objective prompt.
- `skills`: explicit skill ids such as `wf-browser`, `tdd`, `wf-review`.
- `skillPolicy`: `auto|manual|locked`; `auto` lets the main agent/control plane recommend skills from role/task, `manual` lets the user edit, `locked` prevents automatic mutation.
- `contextSources`: selectable sources like workflow map, selected files, Markdown nodes, diagram nodes, recent terminal transcript, and task capsule.
- `capabilities`: visible hints for allowed operations such as terminal, browser, file ops, review-only, or no-source-write.
- `provider`, `model`, `cwd`, `env`, `permissions`, `launchPolicy`: launch-affecting fields that mark a live node restart-required.

The settings UI must expose manual control without forcing the user to understand every field. The default is auto skill assignment with visible chips and hover tips; advanced fields stay organized in sections.

## M2 Config Semantics

| Field | Hot Save | Restart Required On Live Node | Notes |
|---|---:|---:|---|
| `skills` | yes | no | Manual list of skill ids; auto policy may recompute recommendations. |
| `skillPolicy` | yes | no | `auto`, `manual`, or `locked`. |
| `contextSources` | yes | no | Controls what workflow context is surfaced to the agent at prompt/restart time. |
| `capabilities` | yes | no | UI/control-plane hints; not a security boundary in M2. |
| `customRole` | yes | no | Display/planning metadata unless selected as runtime role. |
| `role` | yes | yes | Affects node launch identity/prompt. |
| `prompt` / `objective` | yes | yes | Affects next runtime launch/bootstrap context. |
| `model` | yes | yes | Runtime launch field. |
| `provider` | yes | yes | Runtime launch/provider placeholder field. |
| `cwd` | yes | yes | Runtime working directory field. |
| `env` | yes | yes | Runtime environment. |
| `permissions` | yes | yes | Launch/tool permission hints. |
| `launchPolicy` | yes | yes | Launch behavior and approval/sandbox settings. |

Restart-required is stored with `restartRequired: true` and `restartRequiredFields[]` in backend-owned session/node config. Restart through `POST /api/a2a/nodes/:nodeId/restart` must clear that state only after the replacement backing session is successfully created/rebound.

## Mini PRD

### Problem

WF UI currently treats the workflow canvas and terminal sessions as the main working surface, but it lacks a first-class way to browse workspace files, attach context to agents, edit agent node launch/config state, or maintain backend-owned diagram/markdown context nodes. Users fall back to manual paths, brittle terminal drag/drop, and external editors.

### Target User

- A user operating Codex/Claude/OpenCode agents through WF UI.
- A user who expects VS Code-like file manipulation, terminal drag/drop, node settings, and diagram/spec editing in one controlled workflow map.
- Agents that need an accurate backend-owned workflow map containing terminal, file/context, component node, edge, and state information.

### Scope

- Fixed-left Explorer surface with collapse/floating modes.
- Root-bounded workspace tree API with lazy directory loading.
- Immediate create/rename/move/copy/delete operations with fast reversible undo.
- Drag workspace files/folders into any terminal view.
- Paste or drop external files/images into any terminal view; save under `Harness/user-files/<category>/`.
- Terminal input-owner model for one PTY with multiple terminal views.
- Node settings editor for agent launch/config fields and restart-required workflow.
- Trusted built-in component node foundation: Markdown node and Excalidraw-style diagram node.
- Backend state as the only source of truth for workflow graph/component state and operation logs.
- CDP/Chrome full-regression validation.

### Non-Scope

- Generic untrusted plugin/component loading.
- Collaborative realtime multi-user editing beyond backend version control.
- Replacing the current agent runtime launch mechanism.
- Provider-specific full config UI beyond a placeholder and safe persisted field.
- Full VS Code parity for search, git decorations, extensions, and language services.

### User Flows

1. User opens `/workflow`; Explorer is visible on the left, can collapse or float, and loads workspace directories on expand.
2. User creates/renames/moves/deletes a file from Explorer. The disk changes immediately and `Ctrl+Z` restores through the global undo stack.
3. User drags `src/foo.ts` into a drawer or embedded terminal; default text is `@file(src/foo.ts)`. Shift-drag inserts the absolute path.
4. User drags a folder into a terminal; default text is `@folder(path)`. A later action can bundle it into a context artifact.
5. User pastes an image into a terminal; backend stores it under `Harness/user-files/images/` and inserts an image reference.
6. User double-clicks an agent node, edits role/prompt/model/cwd/env/permissions, sees whether the live node requires restart, and can restart from the panel.
7. User creates a Markdown node, edits WYSIWYG or source, connects it to an agent node, and the agent can read it through the backend workflow map.
8. User creates an Excalidraw-style node, draws a flow, and the backend stores versioned scene state for users and agents.

## Acceptance Criteria

| ID | Criterion | Evidence |
|----|-----------|----------|
| AC-001 | WF UI shows a default-left workspace Explorer that can collapse/float and supports lazy tree browsing, multi-select, keyboard shortcuts, right-click actions, drag/drop, and immediate disk-backed file operations. | RED UI/API tests, CDP screenshots, network assertions |
| AC-002 | Workspace file operations are root-bounded, recorded in a backend operation log, and reversible through the global undo stack with fast delete/restore behavior. | API integration tests for create/rename/move/copy/delete/undo/traversal denial |
| AC-003 | Dragging workspace files/folders, external files, or pasted images into any terminal inserts usable references and stores uploaded files under categorized `Harness/user-files` directories. | Browser drag/paste tests + API tests + disk evidence |
| AC-004 | One agent session maps to one PTY; multiple terminal views can observe it, and the active terminal view owns input/resize without breaking existing terminal output, copy/paste, stop/start, or graph controls. | WS/API tests + CDP terminal interaction regression |
| AC-005 | Double-click node settings allow hot editing of role, custom role, prompt/objective, model, provider placeholder, cwd, env, permissions, and launch policy, with restart-required status and restart action for launch-affecting changes. | UI/API tests + session restart integration test |
| AC-006 | Trusted built-in component nodes include editable Markdown and Excalidraw-style diagram nodes with backend-owned state, observable inputs/outputs, and agent-readable workflow map context. | API/state tests + browser editing tests |
| AC-007 | CDP/Chrome full-regression validation proves original WF UI functions still work and new flows pass happy-path, edge-case, and UI-display checks with no unexpected console or network failures. | CDP evidence folder with screenshots/traces and AC matrix |

## UI Contract

| Surface | Selector / Role | AC IDs |
|---|---|---|
| Explorer shell | `data-testid="workflow-explorer-shell"` | AC-001, AC-002 |
| Explorer collapse button | `data-testid="workflow-explorer-toggle"` | AC-001 |
| Explorer float button | `data-testid="workflow-explorer-float"` | AC-001 |
| Explorer tree | `data-testid="workflow-explorer-tree"` | AC-001 |
| Explorer item | `data-testid="workspace-tree-item"` + `data-path` | AC-001, AC-002, AC-003 |
| Explorer context menu | `data-testid="workspace-context-menu"` | AC-001, AC-002 |
| Explorer rename input | `data-testid="workspace-rename-input"` | AC-001, AC-002 |
| Explorer undo toast/status | `data-testid="workspace-op-status"` | AC-002 |
| Drawer terminal drop zone | `data-testid="terminal-output"` | AC-003, AC-004 |
| Embedded terminal drop zone | `data-testid="workflow-terminal-attach"` | AC-003, AC-004 |
| Terminal input owner badge | `data-testid="terminal-input-owner"` | AC-004 |
| Terminal copy action | `data-testid="terminal-copy-selection"` | AC-004 |
| Terminal paste action | `data-testid="terminal-paste-clipboard"` | AC-003, AC-004 |
| Node settings panel | `data-testid="workflow-node-settings"` | AC-005 |
| Node restart required badge | `data-testid="workflow-node-restart-required"` | AC-005 |
| Node restart action | `data-testid="workflow-node-restart"` | AC-005 |
| Component node toolbar | `data-testid="workflow-component-node-toolbar"` | AC-006 |
| Markdown node editor | `data-testid="workflow-markdown-node-editor"` | AC-006 |
| Markdown source toggle | `data-testid="workflow-markdown-source-toggle"` | AC-006 |
| Excalidraw node canvas | `data-testid="workflow-excalidraw-node"` | AC-006 |

## API Contract

### Workspace Tree

- `GET /api/workspace/tree?path=<repo-relative-path>`
- Success: `{ "root": "...", "path": "src", "entries": [{ "name": "ui", "path": "src/ui", "type": "directory", "size": 0, "mtime": "...", "hasChildren": true }] }`
- Failure: `400 BAD_REQUEST` for traversal or invalid path; `404 NOT_FOUND` for missing path.

### Workspace Operations

- `POST /api/workspace/ops`
- Request: `{ "op": "create-file|create-folder|rename|move|copy|delete|write", "source": "src/a.ts", "target": "src/b.ts", "contentBase64": "..." }`
- Success: `{ "ok": true, "opId": "...", "undoable": true, "entriesChanged": ["src/a.ts"], "revision": 12 }`
- Delete behavior: move to `Harness/.trash/workspace-ops/<opId>/...` before returning success.
- Failure: root escape, overwrite conflict without explicit flag, missing source, invalid filename, too-large inline content.

### Global Undo

- `POST /api/workspace/undo`
- Request: `{ "opId": "latest" }`
- Success: `{ "ok": true, "undoneOpId": "...", "revision": 13 }`
- Side effect: restores deleted/moved/renamed/copied/written paths via recorded inverse operation.

### User Files

- `POST /api/user-files`
- Request: `{ "files": [{ "name": "shot.png", "contentBase64": "...", "mime": "image/png" }], "source": "paste|drop" }`
- Success: `{ "files": [{ "name": "shot.png", "path": "Harness/user-files/images/shot.png", "terminalTag": "@file(Harness/user-files/images/shot.png)", "absolutePath": "..." }] }`

### Terminal Context Insert

- `POST /api/sessions/:sessionId/context-input`
- Request: `{ "items": [{ "kind": "workspace-file|workspace-folder|user-file|text", "path": "src/a.ts", "format": "tag|relative-path|absolute-path" }], "inputOwnerId": "..." }`
- Success: `{ "ok": true, "terminalInput": "@file(src/a.ts)", "inputOwnerId": "..." }`
- Side effect: active input owner for the PTY session is updated.

### Agent Node Config

- `PATCH /api/a2a/nodes/:nodeId/config`
- Request: `{ "role": "...", "customRole": "...", "prompt": "...", "model": "...", "provider": "...", "cwd": "...", "env": {}, "permissions": {}, "launchPolicy": {} }`
- Success: `{ "ok": true, "node": {}, "restartRequired": true, "revision": 14 }`

- `POST /api/a2a/nodes/:nodeId/restart`
- Success: creates/restarts the backing session using latest config and records replacement session/node mapping.

### Component Nodes

- `POST /api/a2a/component-nodes`
- Request: `{ "type": "markdown|excalidraw", "title": "...", "position": { "x": 0, "y": 0 } }`
- Success: `{ "nodeId": "component-...", "statePath": "Harness/a2a/component-nodes/component-....json", "revision": 1 }`

- `GET /api/a2a/component-nodes/:nodeId`
- `PUT /api/a2a/component-nodes/:nodeId`
- Backend owns `revision`; writes must reject stale revision unless explicitly merged.

## State Contract

| State | Source of Truth | Notes |
|---|---|---|
| Workflow graph nodes/edges/positions | `Harness/a2a/workflow-map.json` via backend API | Frontend IndexedDB/local state is cache only and must not overwrite backend truth. |
| Workspace operation history | `Harness/a2a/workspace-ops.jsonl` | Used for global undo and audit. |
| Fast delete trash | `Harness/.trash/workspace-ops/<opId>/` | Same-volume move/rename for performance. |
| Uploaded user files | `Harness/user-files/images|pdf|documents|archives|text|other|context/` | Paths inserted into terminals as tags/paths. |
| Component node state | `Harness/a2a/component-nodes/<nodeId>.json` and markdown payload files | Backend revisioned state; Excalidraw scene stored as JSON. |
| Terminal input owner | session registry + persisted session state | One active input owner per PTY session; any terminal view can acquire. |

## Test Plan

### RED Before Implementation

- Anti-drift/static tests for required files, selectors, API routes, and backend-owned state paths.
- Backend integration tests for workspace tree/ops/undo/user-files/context-input/node-config/component-nodes.
- WS/session tests for one PTY, many terminal views, active input owner, and resize ownership.
- Playwright/CDP acceptance tests for Explorer operations, terminal drag/paste, node settings/restart, Markdown node edit, and Excalidraw node persistence.

### Final Verification Commands

- `node --test tests/anti-drift.test.js`
- `node --test src/wf-ui-server/__tests__/*.mjs`
- `npm --prefix src/ui run typecheck`
- `npm --prefix src/ui run build`
- CDP/Chrome full-regression script covering old and new flows.

### Mandatory CDP/Chrome Regression Matrix

| Coverage | Required Evidence |
|---|---|
| Existing workflow canvas opens, existing agent nodes render, start/stop/delete controls still work | CDP screenshot + network/console log |
| Existing drawer terminal opens, renders history/output, copy/paste still work | CDP interaction evidence |
| Existing embedded terminal renders and can acquire input owner only when focused/drop/paste targets it | CDP interaction evidence |
| Explorer collapse/float/tree/right-click/keyboard/multi-select works | CDP screenshots + DOM selector assertions |
| File create/rename/move/delete/undo writes disk and updates UI | CDP + API/disk assertions |
| Drag workspace file/folder to drawer and embedded terminal inserts expected tag/path | CDP drag/drop evidence |
| Shift-drag inserts absolute path | CDP keyboard-modified drag evidence |
| External file drop and pasted image store under `Harness/user-files` | CDP paste/drop + disk evidence |
| Node settings hot edit marks restart-required and restart launches with new config | CDP + API/session assertions |
| Markdown node WYSIWYG/source edit persists after reload | CDP screenshot + backend state assertion |
| Excalidraw node edit persists after reload | CDP screenshot + backend state assertion |
| Edge cases: traversal denied, overwrite conflict, stale component revision, large delete remains responsive, network failure shows error state | CDP/API evidence |
| UI display: no overlap at desktop and narrow viewport; tooltips visible; no unexpected console errors or failed network requests | screenshots + console/network capture |

## WF-MAX Dispatch

### Fan-Out Attempt

| Field | Value |
|---|---|
| fanoutAttempted | true |
| Runtime/channel | Codex native multi-agent tool |
| Agents requested | 3 read-only agents |
| Result | Spawned: frontend explorer `019fb981-b5ba-7f70-90b6-cc732acea5da`; backend explorer `019fb981-f028-78c2-92f9-8130629cc837`; test/CDP planner `019fb982-386f-7610-a8f1-3683723b4ea0` |
| Task-scribe | Degraded: not spawned as writer to avoid concurrent task-state edits in the current tool surface; controller writes task state until a mergeable task-scribe channel is available. |

### D-GATE Self-Audit

| Gate Item | Status | Notes |
|---|---|---|
| Mini PRD exists | PASS | This PLAN section. |
| AC IDs exist | PASS | AC-001 through AC-007. |
| UI/API/state contracts exist | PASS | Contract tables above. |
| Test plan exists | PASS | RED and final CDP plan above. |
| Implementation write sets disjoint | DRAFT | Final file claims depend on W0 exploration returns. |
| Reviewer plan exists | DRAFT | Review wave must include spec/AC, frontend architecture, backend security/data-loss, and CDP evidence review. |
| CEO source edits prohibited | PASS | CEO edits only task state until workers are dispatched. |

### Initial Write-Set Coloring

| Wave | Worker | Write Set | Depends On | AC IDs |
|---|---|---|---|---|
| W2a | test-writer-backend | `src/wf-ui-server/__tests__/workspace-store.test.mjs`, `src/wf-ui-server/__tests__/server.integration.test.mjs`, `tests/anti-drift.test.js` | D-GATE | AC-001, AC-002, AC-003, AC-005, AC-006 |
| W2a | test-writer-frontend | Playwright/CDP test files or existing UI test harness, `tests/anti-drift.test.js` selector assertions | D-GATE | AC-001, AC-003, AC-004, AC-005, AC-006, AC-007 |
| W2b | backend-workspace-worker | new workspace/user-files store modules, `src/wf-ui-server/server.mjs` routes | RED tests | AC-001, AC-002, AC-003 |
| W2b | backend-session-worker | `src/wf-ui-server/ws-terminal.mjs`, `session-registry.mjs`, terminal/session route updates | RED tests | AC-004, AC-005 |
| W2b | backend-component-worker | `src/wf-ui-server/a2a-store.mjs`, component node store/routes | RED tests | AC-006 |
| W2b | frontend-explorer-worker | Explorer component, App/Workflow layout, CSS, i18n | RED tests | AC-001, AC-002, AC-003 |
| W2b | frontend-terminal-worker | terminal control helpers, TerminalDrawer, embedded terminal drop/paste/input owner UI | RED tests | AC-003, AC-004 |
| W2b | frontend-node-settings-worker | WorkflowRoute node settings/component node UI | RED tests | AC-005, AC-006 |
| W2c | cdp-verifier | CDP/Chrome scripts/evidence only | GREEN build | AC-007 |

### Reviewer Plan

- Spec/AC reviewer: compare diff against AC-001..AC-007 and non-scope.
- Backend security/data-loss reviewer: traversal denial, trash/undo correctness, stale revision handling, PTY input owner.
- Frontend architecture reviewer: ReactFlow interaction stability, Explorer responsiveness, terminal focus/drag/paste behavior, visual layout.
- Test/evidence reviewer: RED/GREEN proof and CDP/Chrome matrix coverage.
