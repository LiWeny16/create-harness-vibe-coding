# task-standardize-workflow-nodes - PLAN

## Goal

Refactor `/workflow` into a stable typed-node canvas where Agent, File, Markdown, and Diagram nodes share one graph model. Agent nodes remain the thinking and execution core, but connected resource nodes must be readable and controllable through wf-ui APIs instead of ad hoc UI-only state.

## WF-MAX Reset

Mode: `wf-max`
Tier: `WF-Full`
Gate: `D-GATE`
Reason: the scope is cross-layer UI/API/state/performance/browser behavior and current evidence shows interaction races plus a React infinite update failure. The controller/CEO must not edit production source. All source implementation must be delegated to Workers with explicit, non-overlapping write sets.

## Product RCA

This is both an architecture-stability problem and a details problem.

| Class | Diagnosis | Evidence | Product Impact |
|---|---|---|---|
| Gesture ownership | Explorer, canvas, nodes, bridge labels, and pane handlers each own overlapping click/drag/double-click behavior. | Explorer single/double click split; ReactFlow pane/node/context handlers reset overlapping state; bridge label pointer/click/double-click share one path. | Folder expansion feels random, edge dragging becomes connection editing, node right-click/double-click race. |
| State ownership | Graph state is split across backend graph-map, frontend graph state, localStorage, IndexedDB, component-node state, and transient UI state. | Persistence effect writes graph-map broadly on node/edge/manualEdge changes. | Edges disappear, offsets persist accidentally, reload can resurrect stale graph state. |
| API contract | File byte preview exists but lacks a complete file-pipe contract. Same-origin dev calls can also hit Vite instead of the backend. | `/api/workspace/file` exists; no HEAD/Range/meta/text endpoints; no Vite `/api` proxy guarantee. | 404s, broken PDF/video preview, stale file nodes, agent cannot know how to read file content reliably. |
| Overlay layering | Menu/panel/toast z-index is ad hoc. | Inline z-index values vary by surface; toast has no stable top-layer contract. | Toasts appear under workflow chrome; context menus appear in wrong positions. |
| Performance | `WorkflowRoute.tsx` is a large global state hub. Zoom, edge movement, persistence, previews, and editors can invalidate too much UI. | Exact zoom is passed into nodes/edges; file previews eager-fetch; Excalidraw preview uses many DOM nodes; scene comparison uses deep stringify. | Explorer/canvas feels stuck, dragging stutters, opening editors can freeze. |
| React #185 | User reported minified React error #185, consistent with maximum update depth/infinite update loop. | Stack includes `vanilla.mjs` store notification and React production update frames. | UI can crash instead of just feeling slow. Must be treated as P0 until reproduced and fixed. |

## Mini PRD

### Scope

- Replace old top-center Markdown/Diagram toolbar with a single node picker opened from the top-right plus button.
- Add canvas right-click creation menu.
- Add node right-click menu for delete, settings, open config, duplicate/copy/cut, and related basic node actions.
- Keep double-click on a node reserved for its configuration or enlarged editor surface, depending node kind.
- Make Explorer single click deterministic: folders expand/collapse; files open a floating preview panel.
- Allow preview panel insertion into canvas as a File node.
- Drag workspace files/folders from Explorer into canvas as reference File nodes.
- Drop/paste external files/images into canvas as stored File nodes under `Harness/user-files`.
- Paste large text into canvas as a Markdown node.
- File node previews support browser-native image/PDF/video plus bounded text preview. Excel parsing is optional and only lightweight if added deliberately.
- Markdown nodes support better rendered/WYSIWYG editing and enlarged editing.
- Diagram nodes use the real open-source Excalidraw editor, with Excalidraw icon and brand styling based on `#6965DB`.
- Agent settings become a productized UI: searchable categories, icon nav with tooltips, selectors/switches instead of raw JSON, explorer-backed cwd selection, working skill add, i18n-ready labels, compact sticky footer.
- Agent graph context exposes connected resource nodes through typed `stateRef`, `contentRef`, handles, and capability hints.
- Markdown default output is an agent setting. If enabled, explicit target wins; otherwise choose the oldest connected Markdown node.
- Bridge tag behavior: single click/drag selects or moves edge label; double-click opens bridge panel.
- Persist node positions, edges, and bridge offsets without pointermove network spam.
- Add performance guardrails for graph render, file previews, editor loading, and Explorer tree expansion.

### Non-Scope

- No arbitrary third-party component plugin marketplace.
- No full permission matrix UI in this slice; connections stay default bidirectional with reserved schema fields.
- No heavy document extraction pipeline or OCR.
- No full Excel workbook editor.
- No Service Worker or WASM unless profiling proves a specific CPU or caching bottleneck.
- No broad unrelated visual redesign outside `/workflow`.

## Acceptance Criteria

| ID | Criterion | Required Evidence |
|---|---|---|
| AC-001 | Unified node creation exists from top-right plus and canvas right-click, offers Agent/File/Markdown/Diagram, and removes the old top-center Markdown/Diagram toolbar. | Playwright DOM and click path. |
| AC-002 | File/text ingestion works: Explorer drag creates workspace-reference File node; Explorer preview can insert File node; external drop/paste stores File node under `Harness/user-files`; large pasted text creates Markdown node. | Playwright plus API/disk assertions. |
| AC-003 | Backend exposes a complete workspace file pipe: meta, byte read, bounded text read, HEAD, Range, MIME, traversal denial, stale/missing file state. | `node --test` workspace API tests. |
| AC-004 | Agent-readable graph snapshot includes connected resource refs, handles, directions, `stateRef`, `contentRef`, and capability hints for File/Markdown/Diagram nodes. | Backend component/context tests. |
| AC-005 | Markdown default output is configurable per agent, target-selectable, and falls back to oldest connected Markdown when enabled with no explicit target. | Backend config tests plus UI test. |
| AC-006 | Explorer interaction is deterministic: single-click folder toggles open/closed, file click opens preview, right-click menu uses global viewport coordinates and clamps in view, Explorer gestures do not pan/drag canvas. | Playwright with bounding-box and network assertions. |
| AC-007 | Node interaction is deterministic: double-click opens config/editor; right-click opens node menu only; delete/settings/open config/copy/cut/duplicate actions are available with stable selectors. | Playwright node gesture test. |
| AC-008 | Bridge edge interaction is stable: single-click/drag does not open panel, double-click opens panel, edge/offset persistence happens on commit only and survives reload without disconnections. | Playwright plus graph-map network assertions. |
| AC-009 | Markdown and Excalidraw editors have enlarged/fullscreen mode, smooth loading/open animation, real editor loaded state, save revisions, Excalidraw icon/brand styling, no useless Rect toolbar button. | Playwright UI/editor assertions, typecheck. |
| AC-010 | Agent settings panel is searchable, categorized, compact, i18n-ready, has tooltips, selectors/switches for common config, explorer-backed cwd picker, working Add Skill, and no raw JSON for common permission/launch policy. | Playwright settings assertions. |
| AC-011 | Overlay stack is deterministic: toasts render above workflow chrome, menus/panels clamp to viewport, fullscreen is top layer. | Playwright `elementFromPoint` and computed z-index checks. |
| AC-012 | Performance budget holds on `/workflow`: no React update loop, no failed API resources, ready under 3s in seeded graph smoke, no long task above 250ms during key interactions, edge drag sends no graph-map PUT before pointerup. | CDP/Playwright performance spec and browser console/network capture. |

## UI Contract

| Surface | Selector / Contract |
|---|---|
| Node picker trigger | `data-testid="workflow-create-node"` |
| Node picker panel | `data-testid="workflow-create-node-panel"` |
| Node picker option | `data-testid="workflow-create-node-option"` and `data-node-kind="agent|file|markdown|diagram"` |
| Canvas context menu | `data-testid="workflow-context-menu"` |
| Canvas context action | `data-testid="workflow-context-action"` and `data-action` |
| Node root | `data-testid="workflow-node"` and `data-node-id` |
| Node context menu | `data-testid="workflow-node-context-menu"` and `data-node-id` |
| Node context action | `data-testid="workflow-node-context-action"` and `data-action` |
| File node | `data-testid="workflow-file-node"` plus `data-file-source` and `data-file-path` |
| File preview | `data-testid="workflow-file-preview"` |
| File text preview | `data-testid="workflow-file-text-preview"` |
| Workspace tree item | `data-testid="workspace-tree-item"` plus `data-path`, `aria-expanded` for folders |
| Workspace preview panel | `data-testid="workspace-preview-panel"` |
| Workspace context menu | `data-testid="workspace-context-menu"` |
| Workspace insert action | `data-testid="workspace-insert-file"` |
| Agent settings panel | `data-testid="workflow-node-settings"` |
| Agent settings search | `data-testid="workflow-node-settings-search"` |
| Agent settings side nav | `data-testid="workflow-node-settings-nav"` |
| Agent settings nav item | `data-testid="workflow-node-settings-nav-item"` and `data-section` |
| CWD picker button | `data-testid="workflow-node-cwd-picker"` |
| Permission control | `data-testid="workflow-node-permission-mode"` |
| Launch policy control | `data-testid="workflow-node-launch-policy"` |
| Skill add control | `data-testid="workflow-node-skill-add"` |
| Markdown output toggle | `data-testid="workflow-node-markdown-output-toggle"` |
| Markdown output target | `data-testid="workflow-node-markdown-output-target"` |
| Bridge label | `data-testid="workflow-bridge-label"` |
| Bridge panel | `data-testid="workflow-bridge-panel"` |
| Fullscreen loading | `data-testid="workflow-fullscreen-loading"` |
| Markdown rich editor | `data-testid="workflow-markdown-rich-editor"` |
| Excalidraw fullscreen editor | `data-testid="workflow-excalidraw-fullscreen-editor"` and `data-editor-loaded="true"` |
| Toast layer | `data-testid="workflow-toast"`; must be above node/menu/panel layers |

## API Contract

| Endpoint | Contract |
|---|---|
| `GET /api/workspace/tree?path=` | Returns bounded tree rows with `path`, `name`, `type`, `hasChildren`, `size`, `mtime`, and does not load full repo recursively on initial render. |
| `GET /api/workspace/meta?path=` | Authenticated repo-relative metadata. Returns `{ ok, path, name, type, exists, size, mtime, mime, etag, previewKind }`. Traversal, symlink escape, and non-workspace paths are rejected. |
| `HEAD /api/workspace/file?path=` | Same auth/path checks as byte read. Returns `Content-Type`, `Content-Length`, `ETag`, `Last-Modified`, `Accept-Ranges: bytes`. |
| `GET /api/workspace/file?path=` | Canonical byte pipe. Supports `Range` with `206/416`. Returns `404` only for resolved missing files, not for frontend routing/proxy errors. |
| `GET /api/workspace/text?path=&offset=&limit=` | Bounded UTF-8 preview for text-like files. Server caps `limit`; returns `{ text, bytesRead, truncated, encoding }`; binary/unsupported returns `415`. |
| `POST /api/user-files` | Stores external dropped/pasted files under `Harness/user-files` and returns `source: "user-file"`, repo-relative path, MIME, size, and node-safe display name. |
| `POST /api/a2a/component-nodes` | Creates typed resource node `file|markdown|excalidraw` with canonical initial state and creation timestamp. |
| `PUT /api/a2a/component-nodes/:id` | Saves typed component node state and increments revision. |
| `DELETE /api/a2a/component-nodes/:id` | Deletes component node state and graph references. |
| `GET/PUT /api/a2a/graph-map` | Backend source of truth for persisted node positions, edges, handles, offsets, and graph revision. Writes must be debounced during gestures and committed after pointerup/drop/save. |

WebSocket is for invalidation events only in this slice: `workspace.changed`, `component-node.updated`, `file.changed`, with `path`, `nodeId`, `revision`, `mtime`, and `etag`. It must not stream file bytes.

## State Contract

- Backend graph-map is authoritative for graph topology, positions, edge handles, and bridge offsets.
- Frontend cache may speed up boot but must not overwrite newer backend graph state.
- Edge label drag state is transient until commit.
- Component node state owns user-editable Markdown/Excalidraw/File metadata.
- Agent snapshot context lists connected resources in a stable order by `createdAt`, then `nodeId`.
- Resource capabilities are explicit but permissive by default:
  - File: `meta:read`, `bytes:read`, `text:read` when supported.
  - Markdown: `state:read`, `state:update`, `markdown:append`, `markdown:replace`.
  - Diagram: `state:read`, `state:update`, `excalidraw:read`, `excalidraw:update`.
- React state setters must not run from render paths or unguarded effects. Any effect that writes Zustand/ReactFlow/backend state must compare revision or stable identity first.

## Node Runtime Architecture Amendment

The next architecture target is a unified Node Runtime. Every large node type
must be wrapped in the same backend-owned lifecycle, state, storage, connection,
and action contract. `WorkflowRoute` must stop acting as the state bus for every
node subtype; it should become a canvas shell that renders node snapshots and
dispatches typed node actions.

### Problem Re-Audit

| Finding | Current evidence | Required correction |
|---|---|---|
| Component state is only partly backend-owned | `component-node-store.mjs` owns `state.json` and revisions, but `WorkflowRoute.tsx` also keeps `componentNodeOverrides`, graph localStorage, IndexedDB, manual edges, selected state, create panels, and editor state. | Backend owns persisted node state and graph topology. Frontend owns only draft UI state and sends typed mutations. |
| Graph has multiple truth paths | `WorkflowRoute.tsx` persists graph state to localStorage, IndexedDB, React state, and `/api/a2a/graph-map`. | Keep backend graph-map as the only shared truth. Local/IndexedDB can only be read-through cache with version guard, not a writer of authority. |
| Excalidraw preview is not runtime-managed | The small node preview draws divs from `scene.elements`; if scene normalization or save is missed, the node renders blank while fullscreen editor has separate draft state. | Excalidraw node must expose `node.preview.render`, `node.state.read`, `node.state.patch`, `node.asset.snapshot`, and autosave/commit semantics through backend-backed actions. |
| Component nodes lack first-class settings | Terminal nodes use `WorkflowNodeSettingsPanel`; component nodes fall back to a minimal generic config panel. | Markdown, Excalidraw, and File need their own `node.settings.schema` and a shared settings shell. |
| Agent control is split between terminal APIs and graph APIs | `send-input`, `tail`, start/stop/restart/delete, and graph connect are separate commands with different target semantics. | Agent node should expose one `agentNode.*` capability layer that delegates to terminal/session/graph internals. |

### Canonical Node Model

Every workflow node must have a backend-owned record:

```ts
type WorkflowRuntimeNode = {
  nodeId: string;
  kind: "agent" | "markdown" | "excalidraw" | "file";
  version: number;
  lifecycle: "draft" | "ready" | "running" | "stopped" | "error" | "deleted";
  status: { state: string; reason?: string; updatedAt: string };
  graph: {
    position: { x: number; y: number };
    size?: { width: number; height: number };
    selected?: boolean;
    handles: Array<{ id: string; role: "input" | "output"; type: string; label: string }>;
    connections: Array<{ edgeId: string; peerNodeId: string; localHandle: string; peerHandle: string; direction: "in" | "out" }>;
  };
  stateRef: { path: string; revision: number };
  contentRef?: Record<string, unknown>;
  settings: { schemaId: string; values: Record<string, unknown>; revision: number };
  capabilities: string[];
  ui: {
    previewKind: string;
    settingsPanel: string;
    testId: string;
    labels: Record<string, string>;
  };
};
```

The backend returns these records through a single node snapshot API. The
frontend may keep ephemeral drafts such as text selection, unsaved editor text,
hover state, menus, and drag position, but persisted node state can only change
through typed node mutations.

### Node Type Contracts

| Node type | Required state | Required actions | Required UI |
|---|---|---|---|
| Agent | session id, runtime, model/provider, cwd, role/prompt, lifecycle, terminal IO refs, graph context refs | `agent.readOutput`, `agent.sendInput`, `agent.focusInput`, `agent.start`, `agent.stop`, `agent.restart`, `agent.delete`, `agent.readContext` | terminal preview, transcript drawer, settings panel, status/error surface |
| Markdown | markdown body, editor mode, revision, output routing compatibility | `markdown.read`, `markdown.patch`, `markdown.replace`, `markdown.append`, `markdown.save`, `markdown.openSettings`, `markdown.delete` | small preview, inline/source editor, fullscreen editor, settings panel |
| Excalidraw | canonical scene JSON, files map, rendered preview metadata, revision | `excalidraw.readScene`, `excalidraw.patchScene`, `excalidraw.saveScene`, `excalidraw.renderPreview`, `excalidraw.exportImage`, `excalidraw.openSettings`, `excalidraw.delete` | nonblank small preview, fullscreen editor, save/autosave state, settings panel |
| File | source, path, mime, size, etag, stale/missing state, preview kind | `file.readMeta`, `file.readText`, `file.readBytes`, `file.refresh`, `file.openSettings`, `file.delete` | lazy preview, stale/missing state, metadata settings panel |
| Graph edge | edge id, endpoints, handles, relation, permissions, offset | `graph.connectNodes`, `graph.disconnectNodes`, `graph.updateEdge`, `graph.readConnections` | visible edge, bridge label, edge settings panel |

### Backend Runtime Modules

The backend should be split into explicit runtime modules instead of spreading
node semantics across route code and generic stores:

```text
src/wf-ui-server/
  workflow-node-runtime.mjs        # node registry, snapshots, action dispatch
  workflow-node-types/
    agent-node.mjs                 # session/terminal backed node adapter
    markdown-node.mjs              # markdown state/settings adapter
    excalidraw-node.mjs            # scene state/render/export adapter
    file-node.mjs                  # workspace/user-file adapter
  workflow-graph-store.mjs         # graph-map topology, positions, connections
  workflow-node-settings-store.mjs # per-node settings schema + values
```

Required backend APIs:

| API | Purpose |
|---|---|
| `GET /api/workflow/nodes` | list canonical node snapshots |
| `GET /api/workflow/nodes/:nodeId` | read one canonical node snapshot |
| `POST /api/workflow/nodes` | create any node type through one entry point |
| `PATCH /api/workflow/nodes/:nodeId/state` | type-checked persisted state mutation |
| `PATCH /api/workflow/nodes/:nodeId/settings` | type-checked settings mutation |
| `POST /api/workflow/nodes/:nodeId/actions/:action` | run node action and return after snapshot |
| `POST /api/workflow/edges` | semantic connect with handle validation |
| `DELETE /api/workflow/edges/:edgeId` | semantic disconnect |
| `GET /api/workflow/context/:nodeId` | agent-readable connected context |

Existing `/api/a2a/*` routes may remain as compatibility shims, but they should
delegate to the Node Runtime rather than implementing separate behavior.

### Frontend Architecture

`WorkflowRoute.tsx` should be decomposed into a shell plus adapters:

```text
src/ui/src/components/workflow/
  WorkflowCanvasRoute.tsx          # load snapshot, render ReactFlow, route events
  nodeRuntimeClient.ts             # typed API client + optimistic guards
  nodeRegistry.tsx                 # kind -> renderer/settings/actions
  AgentNodeView.tsx
  MarkdownNodeView.tsx
  ExcalidrawNodeView.tsx
  FileNodeView.tsx
  NodeSettingsShell.tsx            # shared settings UI
  GraphEdgeView.tsx
```

Frontend rules:

- Node renderers receive `WorkflowRuntimeNode` snapshots, not mixed workflow
  route state.
- Each node renderer exposes `preview`, `inlineEditor`, `settings`, and
  `actions` through the registry.
- Small previews must be derived from canonical backend state or a backend
  render artifact. Excalidraw cannot rely on ad hoc div rendering as the only
  preview path.
- Settings panels are per node type but share one shell and common controls:
  title, lifecycle, connection list, handles, delete, duplicate, export, and
  node-specific settings.
- ReactFlow drag/selection is local until commit. Commit calls graph actions,
  then refreshes backend node snapshots.

### wf-browser Capability Layer

The first-party bridge should expose semantic node actions, not only DOM-level
`act.click`/`act.drag`:

| Capability | Example command |
|---|---|
| Agent node | `agentNode.sendInput`, `agentNode.readOutput`, `agentNode.stop`, `agentNode.restart` |
| Component node | `componentNode.readState`, `componentNode.saveState`, `componentNode.openSettings`, `componentNode.delete` |
| Markdown node | `markdownNode.append`, `markdownNode.replace`, `markdownNode.read` |
| Excalidraw node | `excalidrawNode.saveScene`, `excalidrawNode.readScene`, `excalidrawNode.renderPreview` |
| File node | `fileNode.readMeta`, `fileNode.readText`, `fileNode.refresh` |
| Graph | `graph.connectNodes`, `graph.disconnectNodes`, `graph.readConnections` |

This keeps user-visible operation possible through the virtual cursor, while the
actual state transition is semantic, typed, and verifiable.

### Migration Order

1. Add backend Node Runtime snapshots and action dispatch behind compatibility
   APIs; do not remove current `/api/a2a/*` endpoints.
2. Move graph-map code into a dedicated graph store and make backend graph-map
   the only shared writer.
3. Add node settings schemas for Agent, Markdown, Excalidraw, and File.
4. Add Excalidraw canonical preview path: save scene -> backend stores revision
   -> preview renderer reads canonical scene or generated artifact -> small node
   must show nonblank state when elements exist.
5. Refactor frontend into node registry and shared settings shell.
6. Add wf-browser semantic actions for node and graph operations.
7. Run browser acceptance: create/read/update/settings/delete/connect for each
   node type, plus Excalidraw nonblank preview and revision persistence.

## Performance Contract

- `WorkflowRoute` must be split or guarded so zoom/pointer movement does not rerender every node.
- Node components should be memoized by stable props: `id`, selected state, status, revision, connection count, and zoom bucket when needed.
- Exact viewport zoom should not be injected into every node on every `onMove`; use CSS variable or coarse bucket.
- Graph-map writes must be trailing-debounced and flushed on commit events.
- File previews load lazily only when node is selected, visible, or preview panel is open.
- Text preview must use server-side bounded read; do not download full large files.
- Excalidraw preview must not render unbounded DOM elements for large scenes.
- Heavy editor bundles remain lazy-loaded with visible loading state and smooth transition.
- Service Worker/WASM are not part of the default fix. A Worker is allowed only after CDP/profile evidence shows CPU-heavy markdown parsing, scene normalization, or metadata extraction.

## Current Verification Evidence

| Command / Evidence | Result | Meaning |
|---|---|---|
| `pnpm exec tsc --noEmit` in `src/ui` | PASS | Current TypeScript compiles after prior partial edits. |
| `node --test src/wf-ui-server/__tests__/workspace-api.test.mjs src/wf-ui-server/__tests__/component-node-store.test.mjs src/wf-ui-server/__tests__/component-node-api.test.mjs` | 21 PASS | Current backend slice passes existing focused tests, but contract is incomplete. |
| `pnpm exec playwright test e2e/wf-ui-m3-component-nodes.spec.ts -g "canvas drop creates|unified node picker" --reporter=line` | 2 PASS | Existing node picker/drop tests pass, with a dev-server port reuse warning. |
| `pnpm exec playwright test e2e/wf-ui-m1-red.spec.ts -g "Explorer is default-left|workspace file and folder drops" --reporter=line` | 1 FAIL, 1 PASS | Explorer isolation fails: canvas node drifted `26.17822265625px` during Explorer drag/click path. |
| User browser report | FAIL | React minified error #185, consistent with maximum update depth/update loop. |
| User browser report | FAIL | File preview/embedding 404 and drag embedding failures remain visible in live route. |
| User screenshot | FAIL | Toast layer z-index is below workflow chrome/top pills. |

## Subagent Dispatch

### W0 Read-Only Fan-Out

`fanoutAttempted: true`

| Agent | Runtime / Channel | Role | Read Set | Status | Findings Accepted |
|---|---|---|---|---|---|
| 019fbc4d-5551-7af3-8dfb-9eb118d818a1 | Codex native subagent / `multi_agent_v1` | codebase-explorer | Workflow UI interaction files and e2e specs | Returned, closed | Gesture ownership, overlay layering, edge persistence, Explorer/canvas drop ambiguity. |
| 019fbc4d-a3ae-7002-b9b6-7bf703fb9968 | Codex native subagent / `multi_agent_v1` | architect | Backend workspace/component APIs and tests | Returned, closed | Complete file pipe contract, content refs, metadata/read/text endpoints, WS invalidation only. |
| 019fbc4d-f053-7ec1-9c4c-a3603ab690a5 | Codex native subagent / `multi_agent_v1` | architect | Workflow performance and ReactFlow state | Returned, closed | Memoization, debounced persistence, zoom fanout removal, lazy/capped previews. |
| 019fbc4e-3df2-7d22-9d33-35db862c5e79 | Codex native subagent / `multi_agent_v1` | test-writer | Existing e2e/API tests and UI contracts | Returned, closed | AC-007..AC-012 expansion, CDP/network/long-task test plan. |

Task-scribe degradation: not spawned in this pass to avoid concurrent edits to task-state files while the CEO is rewriting the D-GATE. The CEO records the durable state update directly, which is allowed by the WF-MAX controller contract.

### W1 RED/Test Workers

These may run in parallel only because write sets are disjoint.

| Worker | Role | Objective | Write Set | Forbidden | AC IDs | Verification |
|---|---|---|---|---|---|---|
| T1 Backend Contract Tests | test-writer | Add failing backend tests for workspace meta/file/text/range and connected resource refs. | `src/wf-ui-server/__tests__/workspace-api.test.mjs`, `src/wf-ui-server/__tests__/component-node-api.test.mjs`, optional new `src/wf-ui-server/__tests__/workspace-file-pipe.test.mjs` | Production source, task docs | AC-003, AC-004, AC-005 | `node --test` targeted backend tests |
| T2 Interaction E2E Tests | test-writer | Add failing Playwright/CDP specs for Explorer, node menu, overlay stack, bridge gesture, React #185 guard. | new `src/ui/e2e/wf-ui-m4-interactions.spec.ts` | Production source, existing tests unless selector reuse requires tiny additive changes | AC-006, AC-007, AC-008, AC-011 | targeted Playwright spec |
| T3 Component/Perf E2E Tests | test-writer | Extend component-node specs for File preview, Markdown/Excalidraw fullscreen, performance smoke. | `src/ui/e2e/wf-ui-m3-component-nodes.spec.ts`, new `src/ui/e2e/wf-ui-m5-performance.spec.ts` | Production source, backend tests | AC-002, AC-009, AC-012 | targeted Playwright specs |

### W2 Implementation Workers

Implementation must be wave-gated by W1 RED tests. Parallelism is limited by `WorkflowRoute.tsx` and `index.css` being high-conflict shared files. Do not run overlapping write sets in parallel.

| Wave | Worker | Role | Objective | Write Set | Forbidden | AC IDs | Required Verification |
|---|---|---|---|---|---|---|---|
| 2A | BE File Pipe | implementer | Implement workspace meta/HEAD/Range/text contract and agent `contentRef`/capability refs. | `src/wf-ui-server/server.mjs`, `src/wf-ui-server/workspace-store.mjs`, `src/wf-ui-server/a2a-store.mjs`, `src/wf-ui-server/component-node-store.mjs`, backend tests from T1 | UI files except type contract if explicitly requested in next wave | AC-003, AC-004, AC-005 | targeted `node --test` |
| 2B | FE Explorer/File | implementer | Fix Explorer single-click, global viewport context menu, preview panel insert, file preview pipe and lazy preview policy. | `src/ui/src/components/WorkspaceExplorerPanel.tsx`, `src/ui/src/components/FileComponentNode.tsx`, `src/ui/src/terminalControl.ts`, T2/T3 relevant tests if assigned | `WorkflowRoute.tsx` except declared integration handoff; backend source | AC-002, AC-006 | targeted Playwright Explorer/file tests, typecheck |
| 2C | FE Canvas Gestures | implementer | Centralize canvas/node/edge gesture ownership, node context menu, drop routing, bridge dblclick vs drag, persistence commit guard, React #185 loop fix. | `src/ui/src/components/WorkflowRoute.tsx`, optional new hooks under `src/ui/src/components/workflow/**` | Explorer/settings/editor files, backend source | AC-001, AC-002, AC-007, AC-008, AC-012 | targeted Playwright interaction/perf tests, typecheck |
| 2D | FE Editors/Settings | implementer | Productize settings panel; improve Markdown/Excalidraw fullscreen editors/icons/brand/loading, remove useless Rect control. | `src/ui/src/components/WorkflowNodeSettingsPanel.tsx`, `src/ui/src/components/MarkdownComponentNode.tsx`, `src/ui/src/components/ExcalidrawComponentNode.tsx`, `src/ui/src/components/ComponentBrandIcon.tsx`, `src/ui/public/icons/**` | `WorkflowRoute.tsx`, Explorer, backend source | AC-009, AC-010 | targeted Playwright component/settings tests, typecheck |
| 2E | Style Integration | implementer | Normalize overlay stack, scrollbars, menu/panel styling, Excalidraw brand styles, loading animations. | `src/ui/src/index.css` only | TS/TSX/backend files | AC-009, AC-010, AC-011, AC-012 | targeted Playwright z-index/editor tests |

Wave rule: 2A and 2D may run in parallel after W1. 2B and 2C must be sequenced unless a prior split removes `WorkflowRoute.tsx` integration conflict. 2E runs after affected TSX workers declare final class/testid needs.

### W3 Review Workers

| Reviewer | Lens | Read Set | Status Gate |
|---|---|---|---|
| R1 Spec/UX | User request, PLAN, UI contract, Playwright evidence | Must pass AC-001, AC-002, AC-006, AC-007, AC-009, AC-010, AC-011. |
| R2 API/Security | Backend diff, API tests, path auth, token handling | Must pass AC-003, AC-004, file path security, MIME/range/text caps. |
| R3 Performance/React | WorkflowRoute diff, CDP traces, failed resources, long tasks | Must pass AC-008, AC-012 and specifically React #185 no longer reproduces. |

### W4 CEO CDP Verification

The CEO performs final browser evidence after Workers and reviewers return:

- Start or reuse `/workflow` dev server.
- Attach Playwright/CDP.
- Capture console errors, `Runtime.exceptionThrown`, failed network resources, and failed HTTP statuses.
- Verify Explorer single-click, file preview insert, canvas drag/drop, node right-click, node double-click, bridge drag/double-click, toast top layer, Markdown/Excalidraw fullscreen open/save.
- Run performance smoke with seeded graph: ready under 3s, no long task >250ms, no graph-map PUT before pointerup during edge drag.
- Record command output and AC matrix in `PROGRESS.md`.

## D-GATE Self-Audit

| Check | Status |
|---|---|
| AC IDs cover every user-visible complaint | PASS |
| UI/API/state/performance contracts exist before source implementation | PASS |
| Native subagent fan-out attempted and recorded | PASS |
| W0 findings integrated into plan | PASS |
| Production source editing by CEO stopped | PASS |
| Implementation write sets are disjoint per parallel wave | PASS with sequencing caveat for `WorkflowRoute.tsx` and `index.css` |
| RED tests precede W2 implementation | PASS |
| Independent review and reflector required before final acceptance | PASS |
| CDP/browser evidence required before claiming completion | PASS |

## Risks

- The worktree already contains prior partial edits. Workers must preserve user and prior work and avoid unrelated reversions.
- `WorkflowRoute.tsx` is a high-conflict file. Useful WF-MAX parallelism is limited until responsibilities are extracted.
- React #185 may be caused by a small unguarded effect or by broader store subscription identity churn. Debugger must reproduce before fixing.
- Query-token media URLs can leak through logs/referrers. Security review must inspect token handling for native previews.
- Excel preview can become scope creep. Do not add heavy parsing unless small library impact and browser performance are proven acceptable.

## Verification Commands

- `node --test src/wf-ui-server/__tests__/workspace-api.test.mjs src/wf-ui-server/__tests__/component-node-store.test.mjs src/wf-ui-server/__tests__/component-node-api.test.mjs`
- `pnpm --dir src/ui exec tsc --noEmit`
- `pnpm --dir src/ui exec playwright test e2e/wf-ui-m3-component-nodes.spec.ts --reporter=line`
- `pnpm --dir src/ui exec playwright test e2e/wf-ui-m4-interactions.spec.ts --reporter=line`
- `pnpm --dir src/ui exec playwright test e2e/wf-ui-m5-performance.spec.ts --reporter=line`
- Final CEO CDP session against `http://127.0.0.1:54494/workflow` or the active dev-server URL.
