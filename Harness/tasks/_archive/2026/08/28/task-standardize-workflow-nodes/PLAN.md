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
- Keep double-click node-kind specific: Agent opens terminal mode; Markdown and Diagram open enlarged editor mode; settings stay available from the node menu/actions.
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
| AC-004 | Agent-readable graph snapshot includes connected resource refs, handles, `direction: "bidirectional"`, endpoint roles, `stateRef`, `contentRef`, and capability hints for File/Markdown/Diagram nodes. | Backend component/context tests. |
| AC-005 | Markdown default output is configurable per agent, target-selectable, and falls back to oldest connected Markdown when enabled with no explicit target. | Backend config tests plus UI test. |
| AC-006 | Explorer interaction is deterministic: single-click folder toggles open/closed, file click opens preview, right-click menu uses global viewport coordinates and clamps in view, Explorer gestures do not pan/drag canvas. | Playwright with bounding-box and network assertions. |
| AC-007 | Node interaction is deterministic: Agent double-click opens terminal mode; Markdown and Diagram double-click open enlarged editor mode; right-click opens node menu only; delete/settings/open config/copy/cut/duplicate actions are available with stable selectors. | Playwright node gesture test. |
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
| Node picker search | `data-testid="workflow-create-node-search"` |
| Node picker grouped list | `data-testid="workflow-create-node-options"` |
| Node picker group | `data-testid="workflow-create-node-group"` and `data-node-category="agent|resource|event|capability|structure"` |
| Node picker option | `data-testid="workflow-create-node-option"` plus `data-node-kind`, `data-node-category`, `data-node-state="ready|planned"`, and `data-agent-semantics` |
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
| Timer expanded editor | `data-testid="workflow-timer-expanded-node"`, `workflow-timer-mode`, `workflow-timer-trigger-at`, `workflow-timer-interval-seconds`, `workflow-timer-expanded-save` |
| Goal expanded editor | `data-testid="workflow-goal-expanded-node"`, `workflow-goal-expanded-title`, `workflow-goal-next-action`, `workflow-goal-acceptance-editor`, `workflow-goal-wdt-enabled`, `workflow-goal-expanded-save` |
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
- Global workflow snapshots, graph maps, runtime node lists, and Agent contexts
  enumerate live component nodes only. If the component index still references
  missing/corrupt/revision-mismatched state, global views skip that component
  and dangling edges; direct component reads remain strict 409-style errors,
  and delete paths must still remove the stale index entry.
- Agent snapshot context lists connected resources in a stable order by `createdAt`, then `nodeId`.
- Workflow connections are bidirectional by default. Persisted `from`/`to`
  fields are endpoint-order and rendering metadata, not semantic direction.
- Runtime node snapshots, A2A resource refs, and graph context must expose
  `direction: "bidirectional"` plus endpoint-specific
  `endpointRole: "source" | "target"`.
- Resource nodes with one shared editable surface expose one semantic
  bidirectional port plus physical ReactFlow side handles. Markdown uses
  semantic port `markdown` rendered as `markdown:left` and `markdown:right`;
  Diagram/Excalidraw uses semantic port `scene` rendered as `scene:left` and
  `scene:right`. Both physical sides can start or receive connections.
- Agent-readable context, bridge labels, capability checks, and persisted
  semantic relations use resource semantic ports. Physical side handles are
  geometry/render metadata only and must be normalized at graph-map,
  `/api/workflow/edges`, A2A snapshot, runtime snapshot, and ReactFlow
  import/export boundaries.
- Markdown and Excalidraw must not be represented as `input`/`output` split
  nodes. Future explicitly directed/control-only nodes need a separate node
  contract and tests; they must not reuse the Markdown/Excalidraw resource-node
  contract.
- Edge duplicate validation is undirected; `A -> B` and `B -> A` are the same
  connection unless a future explicit permission/direction mode defines a new
  contract.
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
    handles:
      | Array<{ id: string; role: "input" | "output"; type: string; label: string }>
      | {
          inputs: string[];
          outputs: string[];
          bidirectional: string[];
          physical: string[];
          ports?: string[];
        };
    connections: Array<{
      edgeId: string;
      peerNodeId: string;
      endpointRole: "source" | "target";
      localHandle: string | null;
      peerHandle: string | null;
      sourceHandle: string | null;
      targetHandle: string | null;
      relation: string;
      direction: "bidirectional";
    }>;
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
| Graph edge | edge id, unordered endpoint pair, endpoint-order fields, handles, semantic relation, reserved permissions, offset, bidirectional direction | `graph.connectNodes`, `graph.disconnectNodes`, `graph.updateEdge`, `graph.readConnections` | visible bidirectional edge, `<->` bridge label, two-ended markers, edge settings panel |

### Future Node Type Roadmap

The next useful node types should extend the same Node Runtime instead of
becoming canvas-only widgets:

| Node type | Runtime role | Port rule | First viable scope |
|---|---|---|---|
| Timer | Event source | Directed event output plus optional bidirectional config/read port | Cron/interval/manual fire, last-run state, enable/disable, connect to Agent context/control. |
| Trigger | Event source | Directed event output plus bidirectional status/config port | Generic webhook receiver, payload schema, dedupe key, replay last event. |
| GitHub trigger | Connector-backed trigger | Directed event output; bidirectional repo/status port | GitHub App/webhook for push, PR, issue, release, workflow_run, with secret validation and replay. |
| MCP connector | Capability provider | Bidirectional capability/status port; tool invocation remains agent-mediated by default | Register local/remote MCP server, health/credential state, tool/resource list, attach selected tools to connected Agent nodes. |
| Skill | Capability pack | Bidirectional capability/read port, not a runtime executor by itself | Scan local `.agents/skills` and `~/.codex/skills`, expose skill metadata, attach selected skills to Agent nodes. |
| Skill group | Capability bundle | Group/subgraph node with explicit exposed ports | Drag a curated set of skills from a Skills Hub into the graph as one bundle that can be expanded, detached, or versioned. |
| Group/subgraph | Structural node | Exposed boundary ports map to internal nodes | Collapse related nodes, Skills groups, MCP bundles, or trigger pipelines while preserving internal graph state. |

Planning decisions:

- Agent nodes remain the execution core. MCP and Skills nodes provide
  capabilities to agents; they should not execute arbitrary code independently
  unless a later runner contract adds lifecycle, sandbox, permissions, and audit
  logs.
- Timer/trigger/GitHub nodes are the right place for one-way event semantics.
  They need an explicit directed edge mode and permission contract; that should
  not change Markdown/Excalidraw resource links.
- Skills Hub requires a scanner/indexer service before a picker UI: source path,
  manifest metadata, description, version/hash, tags, dependencies, and allowed
  runtime/provider constraints.
- Group/subgraph nodes become necessary once users drag in Skills groups or MCP
  bundles. Start with collapsed visual grouping plus boundary ports; defer nested
  scheduling and independent execution until graph contracts support it.
- The node picker should become searchable and category-based: Resources
  (File/Markdown/Diagram), Agents, Events (Timer/Trigger/GitHub), Capabilities
  (MCP/Skill/Skill group), and Structure (Group/Subgraph).

Implemented foundation:

- Node creation now uses a shared catalog in `nodeRegistry.tsx`. Both the
  top-right plus button and canvas right-click create-node path render the same
  searchable, scrollable, category-grouped list.
- Agent, File, Markdown, Diagram, and Timer are `ready` catalog items. Trigger,
  GitHub trigger, MCP connector, Skill, Skill group, and Group/subgraph are
  visible as `planned` or gated hub entries until their runtime contracts exist.
- The catalog records `agentSemantics` for each item so future Agent-attached
  capability nodes can be described without implying they are standalone
  executors.
- A planned catalog item must not be flipped to `ready` until backend runtime
  adapter, state ownership, port/direction rules, settings/actions schema, and
  browser/API regression tests are in place.

### W8 Capability Hub Baseline

Skills/MCP discovery now has a guarded baseline. W8 deliberately stopped
before attachment or runtime node creation; W9 adds the first Agent-targeted
Skill attachment path while keeping MCP and runtime node creation gated.

Implemented:

- `GET /api/workflow/skills-hub` indexes project skill metadata from allowed
  roots with default project scope, query filtering, bounded reads, stable
  schema versioning, deduped skill ids, source summaries, and grouped results.
- The Skills Hub returns metadata only: no absolute paths, no skill bodies, no
  command execution, and no secrets.
- The node picker treats Skill, Skill group, and MCP connector as `open-hub`
  actions. Agent/File/Markdown/Diagram/Timer create nodes; Trigger/GitHub
  trigger/Group remain disabled planned entries.
- The UI now has a right-side capability drawer contract:
  `workflow-capability-hub-drawer`, `workflow-capability-hub-search`,
  `workflow-capability-hub-item`, `workflow-capability-attach`, and
  `workflow-capability-create-node`.
- The MCP drawer is a placeholder only. A real MCP Hub must start as a
  no-spawn/no-secret metadata index before it can attach tools or create nodes.

### W9 Agent Skill Attachment Baseline

Implemented:

- A Skills Hub opened from a planned catalog item remains read-only until an
  Agent target exists. A Skills Hub opened from an Agent node context menu gets
  `data-origin="agent-menu"` and `data-target-agent-id`.
- Agent-targeted attach calls `PATCH /api/a2a/nodes/:agentId/config` with a
  deduped `skills` list and `skillPolicy: "manual"`, then updates the Agent
  node config snapshot in the UI.
- Attached Skill refs remain Agent-mediated capabilities, not standalone
  executors. `/api/workflow/context/:agentId` exposes `effectiveSkills`,
  `skillPolicy`, and `connectedCapabilityRefs` with relation `capability`,
  `direction: "bidirectional"`, and executor `agent`.
- The node context menu action set includes `skills-hub` for Agent nodes and
  resolves canvas id, graph node id, and session id through one target lookup.

Still gated:

- MCP attach and MCP connector node creation remain gated after metadata
  listing. They still need Agent config mutation, permission, audit, and runtime
  contracts.
- Skill groups and MCP bundles still require group/subgraph boundary-port
  serialization before they become canvas nodes.

### W10 Resource Handle Regression And MCP Metadata Baseline

User-reported regression:

- Markdown and Excalidraw again appeared to have right-side-only or split
  input/output connection behavior.
- Manual connection drag could snap to the wrong nearby resource node.
- Component settings panel was too wide/tall and could sit below the header
  z-layer.
- The next node-type discussion needed a durable rule for bidirectional
  resource/capability links versus future one-way event links.

RCA:

- ReactFlow handle type is not logically bidirectional. Rendering only
  `type="source"` handles made resource ports able to start connections but not
  reliably receive manual drops, even though the app-level graph model said
  `direction: "bidirectional"`.
- Frontend and backend handle normalizers treated bare `left`/`right` aliases as
  semantic handles after endpoint-role fallback. That could invert a user's
  chosen physical side into `markdown:right` or `scene:left`.
- The browser regression path previously used semantic intent actions, so it
  proved the backend graph API but did not prove the real pointer/hit-target
  behavior that failed in the UI.
- ReactFlow's loose connection radius made dense nearby resource nodes easier to
  mis-snap when a target hit area was missing or ambiguous.

Implemented:

- Markdown and Excalidraw physical sides render exactly one bidirectional DOM
  handle per side, using ReactFlow loose connection mode to allow start and
  receive behavior. Hidden overlapping source/target handles with the same id
  are not allowed because they make hit-testing ambiguous.
- Frontend and backend normalizers preserve bare `left`/`right` physical aliases
  before any semantic fallback.
- Connection radius was reduced for manual drag precision.
- Component settings panel was constrained to a compact bottom-right panel with
  bounded width/height/body scroll and viewport-safe narrow layout.
- Playwright coverage now uses real handle dragging for resource receive paths,
  asserting the dragged connection persists on the intended resource node and
  physical side without snapping to the nearby node.
- `GET /api/workflow/mcp-hub` is implemented as metadata-only, no-spawn,
  no-secret project discovery. It exposes redacted MCP server metadata and
  summary counts, while attach/create stay disabled.

Updated standards:

- Default resource and capability links remain bidirectional. `source`/`target`
  are endpoint ordering and rendering metadata unless a node contract explicitly
  declares directed event semantics.
- One-way edges belong first to Timer, Trigger, and GitHub trigger event nodes,
  using a future directed event edge contract. They must not change
  Markdown/Excalidraw/Skill/MCP resource/capability semantics.
- New node types require a Node Runtime adapter, port descriptors, settings and
  action schema, graph/API normalization, and browser regression tests before
  they become `ready` catalog entries.

### W11 Timer Event Node / Single-Handle Port Correction

W11 turned Timer into the first runtime event-source node and corrected the W10
resource-port implementation detail.

Implemented:

- Timer nodes are created through `/api/workflow/nodes`, stored under
  `Harness/a2a/event-nodes`, rendered by `WorkflowEventNode`, and exposed in
  snapshots as event node state rather than component state.
- Timer emits explicit directed event edges with
  `direction: "source-to-target"` and relation `event`; Agent context receives
  `eventStateRefs` and `connectedEventRefs`.
- Markdown, Excalidraw, and Timer bidirectional/status side ports render as
  single DOM handles. Tests assert the actual ReactFlow handle count, not just
  user-visible count.
- Component settings layout has a late CSS override for compact width,
  content-height layout, bounded body scrolling, and a host z-layer above the
  workflow toolbar.

Updated standards:

- Default resource and capability links are bidirectional. Directed edges are
  explicit event-node links only.
- Resource nodes must not stack hidden handles to emulate bidirectionality. Add
  an adapter abstraction or keep the node gated if the canvas library cannot
  support a single start/end handle.
- Trigger and GitHub trigger remain planned until webhook/auth/replay/dedupe
  contracts are written and tested. MCP attach and general Group/subgraph
  boundary-port runtime creation remain gated; W12 adds only the narrow Skill
  group capability-pack runtime.

### W12 Skill Group Capability Node

W12 promotes Skills Hub groups from read-only discovery into detachable,
backend-owned capability-provider nodes while keeping the Agent as executor.
This is not the general Group/subgraph implementation.

Implemented:

- `skill-group` nodes are created through `/api/workflow/nodes` from Skills Hub
  group chips and stored under `Harness/a2a/capability-nodes`.
- Runtime snapshots include `capabilityNodes` and `capabilityStateRefs`.
  `WorkflowCapabilityNode` renders the node with `workflow-capability-node` and
  `data-skill-count`.
- A Skill group node exposes one semantic bidirectional `capability` port with
  physical side handles `capability:left` and `capability:right`; both sides can
  start or receive connections.
- If the Hub is opened from an Agent node, creating a pack also creates a
  bidirectional `capability` edge to that Agent. The Agent context receives
  `connectedCapabilityNodeRefs`, merged `connectedCapabilityRefs`, and
  `effectiveSkills`.
- Capability-node state persists only bounded metadata: group id/label/kind,
  skill names, source summaries, and counts. It must not persist skill bodies,
  absolute local paths, command output, secrets, or MCP credential probes.

Updated standards:

- Capability providers use bidirectional resource/capability semantics by
  default. One-way control remains limited to explicit event-source contracts.
- Individual Skill attach mutates Agent config directly; Skill group creation
  creates a detachable capability-pack node that may also attach to the target
  Agent.
- MCP connector nodes and general Group/subgraph nodes remain gated until their
  permission, boundary-port, audit, and browser/API regression contracts exist.

Subagent synthesis:

- Agents used: W12 backend capability architect, W12 frontend Hub reviewer, and
  W12 independent reviewer.
- Findings accepted: backend-owned capability-node store, single semantic
  `capability` port with physical left/right handles, Agent-owned execution,
  no body/path/secret leakage, Hub group -> detachable node, and Agent-targeted
  auto-connect.
- Findings rejected: none. Scope was narrowed deliberately to Skill group
  capability packs, not general Group/subgraph execution.
- Verification path: backend workflow runtime/API/Hub tests, UI typecheck,
  UI build, focused AC-001 Playwright, and combined M3/M4/M5 Playwright.

### W13 MCP Connector Capability Node

W13 promotes MCP Hub server metadata into detachable, backend-owned
`mcp-connector` capability-provider nodes. This is a metadata connector only:
the Agent remains the executor, and MCP server startup, credential checks,
tool-list discovery, and tool invocation stay out of scope.

Implemented:

- `mcp-connector` nodes are created through `/api/workflow/nodes` with
  `mcpServerId`. The backend re-runs `listMcpHub(projectRoot)` and persists only
  the matching sanitized Hub record.
- State lives under `Harness/a2a/capability-nodes/<nodeId>/state.json`, is
  revisioned, and appears through `capabilityNodes`, `capabilityStateRefs`,
  `/api/workflow/nodes`, and Agent context.
- Persisted MCP metadata is bounded to server names, transport, command
  basename, arg count, redacted URL, env key names, source summaries, risk
  flags, and counts. It must not persist raw args, raw env, env values, full
  command paths, raw config, tool/resource bodies, absolute paths, or URL
  query/hash/path-token secrets.
- `mcp-connector` exposes the same semantic bidirectional `capability` port and
  physical handles `capability:left` and `capability:right` as Skill group
  capability providers.
- If the MCP Hub is opened from an Agent node, creating a connector also creates
  a bidirectional relation `capability` edge to that Agent. Agent context gets
  `connectedCapabilityNodeRefs` and merged `connectedCapabilityRefs`, but MCP
  server names are not promoted into `effectiveSkills`.
- The frontend MCP Hub still keeps direct `Attach` disabled. The create action
  sends only `mcpServerId`, not raw server config, and `WorkflowCapabilityNode`
  renders MCP server count/metadata instead of skill count/copy.

Updated standards:

- Capability-provider nodes may be ready once they have backend-owned state,
  runtime adapter actions, graph ports, Agent context refs, UI renderer, API
  tests, browser tests, and no-leak/no-spawn regression coverage.
- MCP Hub discovery and MCP connector creation are both no-spawn/no-secret.
  Any future MCP tool invocation needs a separate permission, audit, sandbox,
  lifecycle, and replay contract.

Subagent synthesis:

- Agents used: W13 backend MCP capability architect, W13 frontend Hub reviewer,
  and W13 security/test reviewer.
- Findings accepted: backend resolves by `mcpServerId` instead of trusting raw
  payloads, runtime and A2A capability branches must both be updated, MCP nodes
  reuse bidirectional capability ports, direct attach remains gated, and tests
  must assert no-spawn/no-secret/no-raw-config behavior.
- Finding refined: generic `config` strings cannot be globally banned because
  existing event-port protocols legitimately expose a `config` port; tests ban
  raw config carriers such as raw args/env/config bodies instead.
- Verification path: backend workflow runtime/API/Hub tests, UI typecheck,
  UI build, focused Hub Playwright, and combined M3/M4/M5 Playwright.

### W14 Advanced Timer, Goal Node, and Trigger Taxonomy

Direction correction: GitHub trigger is not the next product goal. It remains a
planned connector-backed trigger shell until the generic event/trigger contract,
auth model, webhook hosting, replay/dedupe, and UI/browser coverage are
complete. W14 first converges the user-requested Advanced Timer node, Goal node,
and broader trigger taxonomy.

Trigger taxonomy from OpenClaw-like systems, n8n/Zapier/Make, and Feishu/Lark:

| Taxon | Semantics | Canvas node contract |
|---|---|---|
| `manual` | Developer/user test fire | Local event node action, no listener. |
| `timer` / `schedule` | at/every/cron/interval/timezone | Event node; `event.out -> Agent event.in`. |
| `webhook` | Inbound HTTP event | Event node with method/path/schema/ack metadata; secrets by `secretRef`. |
| `polling` / watcher | Repeated external API checks | Event node with cursor, dedupe key, and last check state. |
| `connector-event` | GitHub, Feishu/Lark, Slack, Base, etc. | Connector-specialized event node over webhook or polling transport. |
| `chat/message` | Bot/channel/message arrival | Event node; later shared with Agent-Agent/channel semantics. |
| `button/form/approval` | Human business trigger | Event node distinct from developer manual fire. |
| `system-hook` | Agent/session/gateway lifecycle | Internal gated hook node, not public webhook by default. |
| `stream/file/queue` | Log/file/queue/stream event | High-trust planned node; needs backpressure and permission contract. |

Advanced Timer contract:

- Keep the existing node type `timer`; do not introduce `advanced-timer`.
- State extends additively so old Timer state remains valid:
  `schedule.mode: manual|once|interval|cron|loop|adaptive|watchdog|while|task`,
  `cadence.kind: fixed|sequence|backoff|jitter`, `heartbeat.base`,
  `heartbeat.watchdog`, `loop`, `whileGuard`, `taskBinding`, and
  `controlPolicy`.
- Agent-readable event edge remains directed:
  Timer `event.out -> Agent event.in`.
- Agent control is a separate directed control/config relationship:
  Agent `control -> Timer config` grants `timer.enable`, `timer.disable`,
  `timer.setInterval`, `timer.setMode`, `timer.ackWatchdog`, and
  `timer.resetWatchdog` within `controlPolicy`.
- Event-only edges notify/read but do not grant control.
- Watchdog is visible state, not hidden scheduler magic. Base heartbeat may be
  Agent-adjustable; WDT interval is much longer and cannot be silently disabled
  by a failed Agent. WDT shutdown requires explicit completion proposal plus
  second confirmation after the Agent is quiescent and no pending event remains.
- `while` mode uses declarative guards only. No arbitrary JS or raw expressions.
- Scheduler implementation must be fake-clock testable, persisted with
  `nextDueAt`, idempotent per event, and protected against duplicate ticks if
  multiple wf-ui servers run.

Goal Node contract:

- First slice is a synthetic active-task Goal node, not an arbitrary executor.
- Goal node is a durable objective/status anchor. Agent remains the executor.
- State includes objective, task id, status, phase/gate, acceptance checklist,
  next action, blocker/question, confirmation state, WDT binding, and refs to
  task state/plan/progress.
- Agent context exposes `connectedGoalRefs`, separate from resource/event/
  capability refs.
- User edits use the expanded Goal workbench and write the backend Goal sidecar
  through `goal.update`; task `STATE.json` remains the source reference and is
  not directly mutated by this UI path.
- `goal.update` is limited to editable metadata: title, objective, next action,
  acceptance rows, and WDT binding/state. It must ignore/reject task closeout
  authority fields such as status, phase, and gate.
- Agent-authored `goal.update` requires a bidirectional `goal` edge when
  `actorNodeId` is present; unlinked Agents receive `GOAL_EDGE_REQUIRED`.
- Agent may propose progress, blocker, acceptance updates, and completion, but
  must not directly mark the Goal complete. Completion is two-phase: Agent
  proposal with evidence, then controller/user/verifier confirmation.
- UI should be visually distinct and compact: objective header, status badge,
  progress/checklist, stale/WDT indicator, and explicit
  `Proposed complete` / `Confirm complete` / `Return to work` controls.

Trigger shell boundary:

- HTTP webhook, Feishu/Lark, and GitHub are connector-event shells for now.
- A shell may have backend-owned bounded metadata, local/manual `fire/receive`,
  directed event edges, and Agent `connectedEventRefs`.
- A shell must not register public webhooks, create tunnels, store raw tokens,
  persist raw payloads/headers, probe credentials, or start background workers.

W14 read-only subagents:

| Agent | Runtime / Channel | Role | Status | Return |
|---|---|---|---|---|
| `019fd03a-f63a-7372-991b-a6c03b3b01c0` | Codex native subagent / `multi_agent_v1` | trigger researcher | Returned, closed | Trigger taxonomy across OpenClaw-like, n8n, Zapier, Make, Feishu/Lark, and GitHub; recommended generic event node plus connector shells. |
| `019fd03b-0f48-79a2-bd05-7d43ddf3cd47` | Codex native subagent / `multi_agent_v1` | timer architect | Returned, closed | Advanced Timer state/actions/scheduler/WDT design; recommended extending `timer`, adding fake-clock tests before always-on scheduler. |
| `019fd03b-31e2-7b42-beee-084275c35908` | Codex native subagent / `multi_agent_v1` | Goal/Agent reviewer | Returned, closed | Goal node should be a task-state anchor with `connectedGoalRefs`; completion requires proposal plus confirmation. |

Next implementation order:

1. Downgrade/clean any accidental GitHub Trigger ready promotion to planned or
   local shell.
2. Add RED backend tests for Advanced Timer state, actions, WDT, and Agent
   control-edge semantics.
3. Implement Timer store/adapter/scheduler planner, then UI status/settings.
4. Add synthetic Goal node snapshot, Agent `connectedGoalRefs`, Goal UI, and
   two-phase completion tests.
5. Keep HTTP/Feishu/Lark/GitHub connector shells documented and gated until
   their auth/webhook/runtime contracts are ready.

W14 closeout: steps 1-4 are implemented and verified. GitHub remains a planned
UI shell; Advanced Timer and synthetic Goal nodes are runtime-ready with backend
and browser regression coverage. External HTTP/Feishu/Lark/GitHub triggers and
general Group/subgraph execution remain gated.

### W16 Timer/Goal Expanded Workbench

Operation language:

- Single-click selects; right-click opens lightweight menu/settings; double-click
  opens the node's primary workbench.
- Agent double-click opens terminal mode; Markdown/Excalidraw double-click open
  enlarged editors; Timer double-click opens schedule configuration; Goal
  double-click opens Goal editing.
- Expanded workbenches own local draft state and save through typed runtime
  actions. Runtime snapshots and backend sidecars remain the source of truth
  after save.

Implemented:

- Timer expanded editor supports once, loop, adaptive, and watchdog editing and
  persists through `timer.configure`.
- Timer state normalization preserves once/adaptive/watchdog modes and
  `triggerAt` instead of collapsing unsupported UI modes to `manual`.
- Timer expanded editor preserves all contract-supported modes, including
  manual, interval, cron, while, and task, instead of coercing them to loop on
  save.
- Agent-authored `timer.configure` requires the explicit Agent-to-Timer control
  edge and cannot mutate timer policy/templates/guards/task bindings.
- Goal expanded editor allows user edits to title, objective, next action,
  acceptance rows, and WDT enabled state through `goal.update`.
- Goal sidecar state can override editable Goal metadata while preserving task
  refs and keeping task closeout gated.
- Agent-authored Goal updates require an existing bidirectional `goal` edge
  when `actorNodeId` is present; connected Agents read edited Goal metadata via
  `connectedGoalRefs`.

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
4. Promote the semantic-port/physical-handle normalizer into the Node Runtime
   registry so every new node type declares ports once and tests the same
   graph-map/API/ReactFlow round trip.
5. Add Excalidraw canonical preview path: save scene -> backend stores revision
   -> preview renderer reads canonical scene or generated artifact -> small node
   must show nonblank state when elements exist.
6. Refactor frontend into node registry and shared settings shell.
7. Add wf-browser semantic actions for node and graph operations.
8. Run browser acceptance: create/read/update/settings/delete/connect for each
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

### W5 Bidirectional Connection Follow-Up

Mode: WF-Standard follow-up on the reopened task. The controller may integrate
the final patch, but subagents are read-only unless explicitly reassigned with a
disjoint write set. User instruction: continue the task; do not shut down,
commit, push, publish, or release first.

| Agent | Runtime / Channel | Role | Mode | Read Set | Write Set | Forbidden | Acceptance IDs | Return |
|---|---|---|---|---|---|---|---|---|
| W5-BE | Codex native subagent / `multi_agent_v1` | codebase-explorer | Read-only | `src/wf-ui-server/workflow-node-runtime.mjs`, `src/wf-ui-server/a2a-store.mjs`, `src/wf-ui-server/workflow-graph-store.mjs`, `src/wf-ui-server/workflow-node-types/agent-node.mjs`, backend workflow/component tests | none | writes, git, npm publish, task state | AC-004, AC-007, AC-008 | Missing backend state-contract updates, failing-test expectations, exact files/lines. |
| W5-FE | Codex native subagent / `multi_agent_v1` | codebase-explorer | Read-only | `src/ui/src/components/WorkflowRoute.tsx`, `src/ui/src/components/workflow/nodeRuntimeClient.ts`, `src/ui/e2e/wf-ui-m3-component-nodes.spec.ts`, relevant ReactFlow edge code | none | writes, git, npm publish, task state | AC-007, AC-008 | Missing UI/e2e updates for bidirectional visible edge labels, markers, persistence. |
| W5-DOC | Codex native subagent / `multi_agent_v1` | architect | Read-only | `Harness/project/architecture.md`, `templates/common/Harness/project/architecture.md`, `Harness/specs/protocols/HARNESS_BRIDGE.md`, `templates/common/Harness/specs/protocols/HARNESS_BRIDGE.md`, task PLAN/PROGRESS | none | writes, git, npm publish, source edits | AC-004, AC-008 | Norm/spec deltas needed to prevent recurrence. |

Verification after integration:

- `node --test src/wf-ui-server/__tests__/workflow-node-runtime.test.mjs src/wf-ui-server/__tests__/workflow-api-phase3.test.mjs src/wf-ui-server/__tests__/component-node-api.test.mjs`
- `pnpm --dir src/ui exec tsc --noEmit`
- `pnpm --dir src/ui exec playwright test e2e/wf-ui-m3-component-nodes.spec.ts --reporter=line`
- `npm run build --prefix src/ui`

### W16 Read-Only Review

`fanoutAttempted: true`

| Agent | Runtime / Channel | Role | Mode | Read Set | Write Set | Forbidden | Acceptance IDs | Status | Return |
|---|---|---|---|---|---|---|---|---|---|
| `019fd0ae-55d7-7c52-9ce0-c8242a153a6f` | Codex native subagent / `multi_agent_v1` | frontend reviewer | Read-only | `WorkflowRoute.tsx`, Timer/Goal expanded components, settings panels, registry, CSS, W16 Playwright, architecture/bridge docs | none | writes, git, publish, shutdown | W16-TIMER, W16-GOAL, AC-007 | Returned, blockers fixed | Required preserving non-shortcut Timer modes and adding Goal objective editing/tests. |
| `019fd0ae-8f70-7470-9476-617d66102c97` | Codex native subagent / `multi_agent_v1` | backend reviewer | Read-only | Timer store/adapter, Goal store/adapter, runtime, backend W16/API tests, architecture/bridge docs | none | writes, git, publish, shutdown | W16-TIMER, W16-GOAL | Returned, blockers fixed | Required `timer.configure` control-edge gating and narrowing `goal.update` so status/phase/gate cannot spoof closeout. |

### W17 Agent Architecture Review

`fanoutAttempted: true`

| Agent | Runtime / Channel | Role | Mode | Read Set | Write Set | Forbidden | Acceptance IDs | Status | Return |
|---|---|---|---|---|---|---|---|---|---|
| `019fd0ce-fcd3-7961-8ee1-4163864efda6` | Codex native subagent / `multi_agent_v1` | backend/API architect | Read-only | Agent runtime adapter, node runtime, graph store, server workflow routes, A2A/session/workspace config stores, backend tests | none | writes, git, publish, shutdown | ARCH-AGENT | Returned, integrated | Agent can read rich context and partially control linked Timer/Goal, but lacks first-class Agent-scoped create/connect/disconnect graph actions and has hybrid Agent state. |
| `019fd0cf-39ac-7022-8e28-2c4feb539399` | Codex native subagent / `multi_agent_v1` | orchestration architect | Read-only | Timer/Goal adapters/stores, runtime action dispatch, workflow tests, architecture docs, task plan/progress | none | writes, git, publish, shutdown | ARCH-ORCH | Returned, integrated | Timer is a state/action node, not a durable scheduler; no workflow run engine exists for dependency readiness, parallel fan-out/join, retries, cancellation, or no-idle wakeups. |
| `019fd0cf-7601-7cc2-bc54-fceb64d041e8` | Codex native subagent / `multi_agent_v1` | frontend/perf reviewer | Read-only | WorkflowRoute, node registry/client, Agent/Timer/Goal/Capability node views, e2e specs, CSS | none | writes, git, publish, shutdown | ARCH-FE | Returned, integrated | Frontend has typed runtime client and one semantic browser intent, but node creation/settings/actions remain route-private; `WorkflowRoute.tsx` is still too centralized for autonomous-team scale. |

Synthesis:

- The current Node Runtime is a strong typed graph substrate for human/server-driven workflows: canonical snapshots, resource/event/capability/goal refs, typed actions, and edge-gated Timer/Goal authority exist and are tested.
- It is not yet a complete autonomous Agent-team runtime. Missing layers are Agent-scoped graph actions, a durable Workflow Run Orchestrator, event delivery from Timer/Trigger nodes to Agent nodes, and a semantic UI/control bridge beyond DOM gestures and the single `graph.connectNodes` intent.
- Agent identity is operationally present through session config, node home, init file, and environment variables, but the canonical Agent snapshot/context should promote role, prompt, cwd, node home, config revision, and allowed graph operations as one explicit contract.
- `WorkflowRoute.tsx` remains the main frontend architectural risk because it still owns canvas state, create flows, connection semantics, settings routing, terminal mode, and node rendering. Current tests guard behavior, but this shape will resist multi-agent autonomous graph construction.

### W18 Agent Control Operation Layer

Mini PRD:

- Goal: make Agent-controlled graph changes first-class and visibly observable, so the same workflow map can be operated by humans through UI and by linked Agent nodes through typed APIs.
- Scope: Agent-scoped graph actions for create/connect/disconnect/move/delete/read, operation audit records in backend snapshots, frontend semantic intent parity, controlled-node edge glow, canvas control aura, and Agent-to-node data-flow edge animation.
- Non-scope: durable Workflow Run Orchestrator, external Trigger runtime, GitHub/webhook auth, automatic Timer wake-up loop, arbitrary MCP tool invocation, and full group/subgraph scheduling.
- User flow: a human or Agent creates/links/moves nodes through one semantic operation language; when an Agent is the actor, the canvas shows global control state, target nodes glow, and related edges animate while information is being transferred.
- State change: graph mutations are stored through existing workflow graph/node stores; every Agent graph action appends a bounded recent operation record with actor, targets, edges, timestamps, status, and expiration for UI fade-out.

Acceptance criteria:

| AC ID | Scenario | UI/API/State Contract | Verification |
|---|---|---|---|
| W18-AGENT-GRAPH | A Main Agent can read, create, connect, disconnect, move, and delete graph nodes through `agent.*` actions. | `POST /api/workflow/nodes/:id/actions/agent.createNode`, `agent.connectNodes`, `agent.disconnectNodes`, `agent.moveNode`, `agent.deleteNode`, `agent.deleteNodes`, `agent.readGraph`; non-main or unauthorized actors are rejected; graph store remains the source of truth; self-delete is rejected and bulk delete skips the actor/live Agents by default. | Backend integration tests with AC IDs and unauthorized-path assertions. |
| W18-OPS-AUDIT | Agent graph actions produce observable operation records. | Snapshot includes bounded `workflow.operations.recent[]` records shaped as `{ id, kind, actor, targetNodeIds, edgeIds, status, startedAt, completedAt, expiresAt }`; records omit secrets and large payloads. | Backend tests assert operation record shape, bounds, redaction, and snapshot exposure. |
| W18-UI-CONTROL | Agent control is visible and fades out. | When recent Agent operations are active, workflow canvas root shows `data-agent-control-active="true"`; controlled target nodes receive `data-agent-controlled="true"` and colored edge glow; state clears after expiry with CSS fade. | Playwright test using mocked/seeded operation snapshot asserts canvas aura and controlled-node state before and after expiry. |
| W18-DATA-FLOW | Agent-to-node information transfer is visible on the connecting edge. | Any rendered edge between an active Agent actor and operation target uses `data-agent-flow="true"` and an animated stroke/path treatment; existing bidirectional resource/capability edge semantics are unchanged. | Playwright test asserts the existing edge animates during active operation and remains connected after operation expiry. |
| W18-PARITY | Human UI and browser bridge intents use the same operation vocabulary. | `harness:wf-browser:intent` supports `graph.createNode`, `graph.connectNodes`, `graph.disconnectNodes`, `graph.moveNode`, `graph.deleteNode`, and `graph.deleteNodes`; action results include an operation id when a mutation succeeds. | Playwright/browser-intent regression plus no duplicate request/path regression. |

W18 contract notes:

- Resource and capability links remain bidirectional by default. Directed edges remain limited to event delivery such as Timer-to-Agent.
- Agent graph authority is intentionally Main-Agent-only for this slice unless a later permission model grants another actor graph mutation rights.
- UI animation reads operation metadata; it must not infer control from edge direction or node type alone.
- Operation records are audit and animation metadata, not durable run scheduling state.

W18 dispatch:

`fanoutAttempted: true`

| Agent | Runtime / Channel | Role | Mode | Read Set | Write Set | Forbidden | Acceptance IDs | Status | Return |
|---|---|---|---|---|---|---|---|---|---|
| `019fd0e6-3637-7702-be8c-9025ad716711` | Codex native subagent / `multi_agent_v1` | test-writer | Write tests only | task PLAN W18, backend workflow runtime/API tests, runtime stores, graph store, server route tests | `src/wf-ui-server/__tests__/workflow-agent-runtime.test.mjs`, `src/wf-ui-server/__tests__/workflow-node-runtime.test.mjs`, `src/wf-ui-server/__tests__/workflow-api-phase3.test.mjs` | production source, task state, git, publish, shutdown | W18-AGENT-GRAPH, W18-OPS-AUDIT | Returned, implemented | Added backend RED tests; final target passed 71/71 after implementation. |
| `019fd0e6-7765-7e03-9fc8-b5b8b32343a6` | Codex native subagent / `multi_agent_v1` | test-writer | Write tests only | task PLAN W18, UI e2e specs/utilities, `WorkflowRoute.tsx` selectors, node registry/client types | `src/ui/e2e/wf-ui-m4-interactions.spec.ts`, optional new `src/ui/e2e/wf-ui-m6-agent-control.spec.ts` | production source, task state, git, publish, shutdown | W18-UI-CONTROL, W18-DATA-FLOW, W18-PARITY | Returned, implemented | Added M6 RED Playwright tests; final M4+M6 passed 7/7 after UI rebuild. |
| `019fd0e6-ab52-7ed0-8745-e4fb29e3f3ef` | Codex native subagent / `multi_agent_v1` | architect | Read-only | `WorkflowRoute.tsx`, node runtime/client/types, backend stores/server, architecture/bridge docs | none | writes, git, publish, shutdown | W18-* | Returned, integrated | Implementation map accepted: operation ledger, Agent graph action dispatch, snapshot operation exposure, UI operation-derived control state, and semantic bridge parity. |

W18 implementation:

- Added backend operation ledger `workflow-operation-store.mjs`, exposed at
  `workflow.operations.recent[]`, bounded to 20 records and sanitized to exclude
  request payloads/secrets.
- Added Main-Agent-only `agent.readGraph`, `agent.createNode`,
  `agent.connectNodes`, `agent.disconnectNodes`, `agent.moveNode`,
  `agent.deleteNode`, and `agent.deleteNodes` actions.
  Graph mutations use existing node/graph stores; `agent.moveNode` uses a graph
  store semantic `moveNode` helper.
- Dynamic deletion preserves control safety: `agent.deleteNode` rejects
  self-delete, `agent.deleteNodes` can clear `all: true` while skipping the actor
  and live Agents by default, and deleted synthetic Goal nodes stay hidden from
  runtime lists without mutating the underlying task capsule.
- Direct human/browser node and edge semantic routes return `graph.*` operation
  metadata without forcing UI-only state.
- Frontend derives `data-agent-control-active`, `data-agent-controlled`, and
  `data-agent-flow` from operation records and clears them after `expiresAt`.
- `harness:wf-browser:intent` now supports `graph.createNode`,
  `graph.connectNodes`, `graph.disconnectNodes`, `graph.moveNode`,
  `graph.deleteNode`, and `graph.deleteNodes`, returning operation metadata and
  avoiding duplicate mutation paths.
- Fixed operation-expiry timing so late-arriving snapshot operations cannot keep
  canvas control visuals stuck active after `expiresAt`.
- Fixed stale component-state recovery: graph snapshots, Agent contexts, and
  runtime node lists enumerate only live component nodes and filter dangling
  edges, while direct component reads stay strict and deletion can remove
  stale index entries after their state file is already gone.
- Architecture and bridge protocol docs now require operation-derived visual
  control state and one semantic mutation request per graph intent.

W18 verification:

- `node --test src/wf-ui-server/__tests__/workflow-agent-runtime.test.mjs src/wf-ui-server/__tests__/workflow-node-runtime.test.mjs src/wf-ui-server/__tests__/workflow-api-phase3.test.mjs` PASS 71/71.
- `pnpm --dir src/ui typecheck` PASS.
- `pnpm --dir src/ui build` PASS with existing Vite chunk-size warnings.
- `pnpm --dir src/ui exec playwright test e2e/wf-ui-m4-interactions.spec.ts e2e/wf-ui-m6-agent-control.spec.ts --reporter=line` PASS 7/7.
- Stale component-state frontend crash check: backend workflow target PASS
  93/93; `node --check` PASS for touched backend modules; restarted `wf-ui` on
  `127.0.0.1:64192`; Playwright loaded `/workflow` with no console/pageerror
  events and `/api/workflow` returned 200.

### W19 Agent Node Map API Skill

Mini PRD:

- Goal: Agent nodes must control the workflow node map only through the wf-ui
  backend API, never by directly editing graph/state files.
- Scope: add a generic default `wf-ui-map` skill command surface for
  `node-map --action ...`, update Agent node init guidance, and make legacy
  CLI aliases delegate to typed `agent.*` workflow actions.
- Non-scope: replacing read-only `describe`/`snapshot` diagnostics, removing
  legacy backend routes used by older UI paths, or adding new graph permissions.
- State change: Main-Agent graph mutations go through
  `POST /api/workflow/nodes/:actor/actions/agent.*` and append operation
  records; `Harness/a2a/workflow-map.json` and node sidecars remain
  backend-owned storage.

Acceptance criteria:

| AC ID | Scenario | Contract | Verification |
|---|---|---|---|
| W19-NODE-MAP-SKILL | A Main Agent uses the default node-map skill to connect, delete, or bulk-delete graph nodes. | `wf-ui-control.mjs node-map --action readGraph/createNode/connectNodes/disconnectNodes/moveNode/deleteNode/deleteNodes`; legacy `connect` and `delete-node` are aliases for typed `agent.*` actions; direct workflow-map writes and legacy node-delete route calls are forbidden in the skill/CLI control path. | Server integration tests plus anti-drift protocol checks. |

W19 implementation:

- Added `node-map --action ...` to `Harness/scripts/wf-ui-control.mjs` and the
  template copy. All node-map mutations POST to
  `/api/workflow/nodes/:actor/actions/agent.*` with actor identity from
  `HARNESS_WORKFLOW_NODE_ID` or explicit `--actor`.
- Updated compatibility commands `connect` and `delete-node` to delegate to
  `agent.connectNodes` and `agent.deleteNode`.
- Updated dogfood/template `wf-ui-map` skill metadata and generated default
  skill object with API-only policy entries including
  `api-only-node-map-control` and `no-direct-workflow-map-writes`.
- Updated Agent node init text to say `Harness/a2a/workflow-map.json` and node
  state files are diagnostic/backend-owned storage, not control surfaces.
- Updated architecture and bridge protocol docs/templates with the same
  constraint.

W19 verification:

- RED: `node --test src/wf-ui-server/__tests__/server.integration.test.mjs`
  failed on missing `node-map`; `node --test tests/anti-drift.test.js` failed
  W19 protocol assertions before implementation.
- GREEN: `node --check Harness/scripts/wf-ui-control.mjs
  templates/common/Harness/scripts/wf-ui-control.mjs src/wf-ui-server/server.mjs
  src/wf-ui-server/a2a-store.mjs` PASS.
- GREEN: `node --test src/wf-ui-server/__tests__/workflow-node-runtime.test.mjs
  src/wf-ui-server/__tests__/workflow-api-phase3.test.mjs
  src/wf-ui-server/__tests__/server.integration.test.mjs` PASS 100/100.
- `node --test tests/anti-drift.test.js` passes the W19 protocol assertions but
  still fails one pre-existing static frontend assertion:
  `disableStdin: !live` is not present in `WorkflowRoute.tsx`.

### W20 Agent Default Workflow Skills

Mini PRD:

- Goal: give every managed Agent node a consistent default operation language
  for reading workflow context, mutating the workflow node map, and invoking
  typed node actions through backend APIs.
- Scope: standardize canonical skill names as `workflow-node-map`,
  `workflow-context`, and `workflow-node-actions`; keep `wf-ui-map` as a
  compatibility alias; add CLI wrappers for workflow context reads and typed
  node actions; update Agent node init guidance and default role graph skills.
- Non-scope: durable workflow scheduler, arbitrary MCP tool invocation,
  external webhook triggers, or broad graph permission delegation beyond the
  existing Main-Agent graph mutation gate.
- State change: Agent CLI commands call
  `GET /api/workflow/context/:node` or
  `POST /api/workflow/nodes/:node/actions/:action`; graph mutations still go
  only through typed `agent.*` actions and backend-owned storage remains
  diagnostic-only to Agents.

Acceptance criteria:

| AC ID | Scenario | Contract | Verification |
|---|---|---|---|
| W20-WORKFLOW-SKILLS | A generated Harness project advertises the canonical default skills and keeps old `wf-ui-map` compatibility. | `Harness/a2a/skills/workflow-node-map.json`, `workflow-context.json`, and `workflow-node-actions.json` exist in dogfood/template/default scaffold; default role graph uses canonical skill ids, while `wf-ui-map` is documented as a legacy alias. | A2A store tests plus anti-drift checks. |
| W20-WORKFLOW-CLI | A Main Agent can read connected workflow context and invoke typed node actions without touching state files. | `wf-ui-control.mjs workflow-context --node <id>` calls `GET /api/workflow/context/:node`; `workflow-node-action --node <id> --action <type.action>` calls `POST /api/workflow/nodes/:node/actions/:action`; `workflow-node-map` is the canonical alias for `node-map`. | Server integration test with a connected Markdown node and typed `markdown.read`. |
| W20-AGENT-PREFILL | New Agent node init files teach the same observe-plan-act-verify operation loop and canonical skill names. | `nodeInitMarkdown()` lists `workflow-node-map`, `workflow-context`, `workflow-node-actions`, and `terminal-control`; it forbids direct backend-owned file mutation for canvas control. | Anti-drift static checks plus node-home init integration coverage. |

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

### W21 Workflow Ontology

Mini PRD:

- Goal: make terminal Agent nodes understand the workflow graph as typed, actionable node relations instead of relying on prompt-only conventions.
- Scope: add a lightweight Workflow Ontology API/context payload, default Agent skill wiring, and CLI read surface for ontology discovery.
- Non-scope: full RDF/OWL reasoning, durable scheduler/orchestrator, arbitrary MCP execution, or frontend graph refactors.
- State change: `GET /api/workflow/ontology` exposes canonical node classes, relations, and action rules; `GET /api/workflow/context/:node` includes actor-specific ontology affordances derived from current graph edges.

Acceptance criteria:

| AC ID | Scenario | Contract | Verification |
|---|---|---|---|
| W21-ONTOLOGY-API | An Agent asks what the graph means before acting. | `/api/workflow/ontology` returns versioned node classes, relation semantics, and action rules for agent/resource/event/capability/goal nodes. | Server integration test and `wf-ui-control workflow-ontology`. |
| W21-ACTOR-AFFORDANCES | An Agent reads its connected nodes and knows what it may do. | `/api/workflow/context/:node` includes `ontology.affordances[]` with `canRead`, `canWrite`, `canControl`, allowed/denied actions, edge requirement, and reason strings. | Runtime context tests for Markdown/Excalidraw, Goal, Timer, and capability nodes. |
| W21-DEFAULT-AGENT-LANGUAGE | A newly started terminal Agent has ontology-first operating language. | Default role graph and skill manifests include `workflow-ontology`; init prompt says to read ontology/context and mutate graph only through backend API skills. | A2A store tests plus anti-drift. |

## W21 D-GATE Self-Audit

| Check | Status |
|---|---|
| AC IDs cover the user-visible ontology/isolation problem | PASS |
| UI/API/state contracts exist before source implementation | PASS |
| Native subagent fan-out attempted and recorded | PASS (`019fd166-c6d1-7270-bdc3-c965a0eedbf1`, `019fd166-f514-7322-ad05-7c6a7f99bdbb`) |
| Production source editing delegated to workers | PASS |
| Implementation write sets are disjoint per parallel wave | PASS |
| Browser evidence required before claiming completion | PASS (`$wf-browser` runtime smoke only, no broad Playwright sweep) |

W21 implementation:

- Added `src/wf-ui-server/workflow-ontology.mjs` as a lightweight ontology schema for Agent, resource, event, capability, goal, and graph node classes.
- Added `GET /api/workflow/ontology` as a trusted local wf-ui surface with no frontend/API token requirement.
- Added `context.ontology`, `context.affordances`, `defaultSkills`, and ontology-backed capability affordances to Agent workflow context.
- Added `workflow-ontology` CLI/default skill wiring in dogfood and template control scripts, role graph, and skill manifests.
- Updated Agent node init text to read ontology before context/action execution.
- Fixed review blocker: Agent-authored Timer/Goal writes now canonicalize actor identity, reject missing/spoofed Agent actors, require the proper control/goal edge, and preserve human UI no-actor edits.
- Updated `workflow-node-action` to send Agent actor headers and `actorType: "agent"` from Harness environment.

W21 verification:

- `node --check Harness/scripts/wf-ui-control.mjs templates/common/Harness/scripts/wf-ui-control.mjs src/wf-ui-server/workflow-node-runtime.mjs src/wf-ui-server/server.mjs` PASS.
- `node --test --test-name-pattern "W21-AUTH|W21-ONTOLOGY" src/wf-ui-server/__tests__/workflow-node-runtime.test.mjs src/wf-ui-server/__tests__/server.integration.test.mjs` PASS 3/3.
- `node --test --test-name-pattern "Agent config skills|connected skill-group|connected mcp-connector" src/wf-ui-server/__tests__/workflow-node-runtime.test.mjs src/wf-ui-server/__tests__/workflow-api-phase3.test.mjs` PASS 5/5.
- `node --test src/wf-ui-server/__tests__/a2a-store.test.mjs tests/anti-drift.test.js` PASS 33/33.
- `git diff --check` PASS for W21 touched files.
- Live restart: `wf-ui` running on `http://127.0.0.1:56670`; `/api/workflow/ontology` returned `harness.workflow.ontology` v1 with 10 node types; live Agent context returned `defaultSkills` and `effectiveSkills` containing `workflow-ontology`.
- `$wf-browser` runtime smoke PASS: run `run-msfyjgw3-c9efdc`, window `window-msfyjgwb-f8d66d`, route `/workflow`, readyState `complete`, 8 artifacts under `Harness/wf-browser/runs/run-msfyjgw3-c9efdc/windows/window-msfyjgwb-f8d66d`.

### W24 Agent Session Graph Binding

Mini PRD:

- Goal: dynamic Agent sessions created by wf-ui must be real workflow graph nodes, not snapshot-only virtual nodes.
- Scope: `/api/sessions` attaches wf-ui-created Agents to persisted `terminal-session` graph nodes by default; graph identity is assigned before node init and PTY launch; `/api/terminal/start` remains conservative for ordinary terminal starts.
- Non-scope: durable Agent-team scheduler, retry/cancel queues, result collation, or broader permission delegation beyond existing typed Agent actions.
- State change: graph-map persists the Agent node endpoint, so `/api/workflow/edges`, `/api/workflow/context/:node`, `delegate-agent`, and connected Agent refs all resolve through the backend workflow map.

Acceptance criteria:

| AC ID | Scenario | Contract | Verification |
|---|---|---|---|
| W24-GRAPH-BINDING | A wf-ui-created subagent can be connected to another node immediately after creation. | `POST /api/sessions` returns `graphNodeId`, writes a `terminal-session` graph node, and keeps status synced for deferred/blocked/running sessions. | `workflow-agent-runtime` regression plus live API smoke on `127.0.0.1:56670`. |
| W24-DELEGATION-CONTEXT | A Main Agent can see a connected Agent worker as a delegateable peer. | Agent-to-Agent edges default to relation `delegation`; context exposes `connectedAgentRefs` with `agent.sendInput`, read actions, and workspace refs. | Backend context assertion in `workflow-agent-runtime`. |
| W24-CLI-DELEGATION | Agent CLI operation language uses graph node ids end to end. | `create-agent --defer-pty-spawn true`, `workflow-context`, `delegate-agent`, and `read-agent` resolve graph ids through backend APIs and do not require direct state-file edits. | `server.integration` CLI regression. |

W24 verification:

- `node --check src/wf-ui-server/server.mjs` PASS.
- `node --check src/wf-ui-server/__tests__/workflow-agent-runtime.test.mjs` PASS.
- `node --test src/wf-ui-server/__tests__/workflow-agent-runtime.test.mjs` PASS 5/5.
- `node --test src/wf-ui-server/__tests__/workflow-api-phase3.test.mjs` PASS 22/22.
- `node --test src/wf-ui-server/__tests__/workflow-node-runtime.test.mjs` PASS 49/49.
- `node --test src/wf-ui-server/__tests__/server.integration.test.mjs` PASS 36/36.
- Live smoke: restarted `wf-ui` on `http://127.0.0.1:56670`, created a deferred subagent, connected it to transient Markdown, confirmed `connectedResourceRefs`, and removed smoke nodes with no leftovers.

### W37 External Skills Market / Skill Group Context

Mode: `$wf`
Tier: `WF-Full`
Reason: this slice crosses external marketplace trust, backend install paths,
Skill Group state, Agent context shape, and browser-visible Skills Hub UI.

Mini PRD:

- Goal: make Skills Hub operate as a capability catalog and installer, while
  Skill Group remains the Agent context unit. External packs install into a
  user-selected skills scope, defaulting to project `.agents/skills`, and can
  create/update a Skill Group node without injecting every skill description
  into Agent context.
- Scope: add a hosted market adapter for Skillstore pack metadata and
  manifest/lockfile-based installs; keep Claude/Git marketplace plugin
  catalogs discovery-only/deferred because they can include executable plugin
  surfaces; expose install targets with project default;
  add backend install APIs with path/hash validation; add `effectiveSkillGroups`
  to Agent context; redesign the Skills Hub drawer around `Installed`,
  `Market`, and `Groups`; make Skill Group double-click open a configuration
  workbench.
- Non-scope: running external CLIs such as `npx skillstore add`, installing MCP
  servers from MCP registries, executing installed skill scripts, private
  marketplace auth, payment/ratings, and full arbitrary plugin management.
- User flow: open Skills Hub, browse packs/categories first, inspect pack
  skills in the right-side detail pane, choose install target, install pack,
  then create or update a Skill Group node. Connecting that Skill Group to an
  Agent contributes group metadata and skill ids to context; detailed
  `SKILL.md` content is still loaded only by the normal skill loader when
  needed.
- State changes: installed external skill files live under the chosen skills
  root; a project lockfile records provider, pack slug, manifest URL, hashes,
  install target, installed file list, and group id; Skill Group capability
  state stores bounded metadata only.

Acceptance criteria:

| AC ID | Scenario | Contract | Verification |
|---|---|---|---|
| W37-MARKET-DISCOVERY | A user opens Skills Hub Market and searches external packs. | `GET /api/workflow/skills-market` returns hosted Skillstore pack/group metadata plus install target options, with pack-first grouping and no skill bodies or absolute paths. | Backend API tests with mocked Skillstore fetch plus UI Playwright hub tab/search assertions. |
| W37-INSTALL-PACK | A user installs an external pack to a selected scope. | `POST /api/workflow/skills-market/install` defaults to project `.agents/skills`, validates allowed targets, downloads only manifest-listed files, checks SHA-256, writes under the skill root, writes a lock entry, and never executes external commands. | Backend install tests with mocked raw file fetch and path traversal/hash-mismatch failures. |
| W37-GROUP-CONTEXT | A connected Skill Group is the Agent context unit. | Skill Group state stores group summary, category/tags, install source, skill ids/names/count and lock ref; Agent context exposes `effectiveSkillGroups[]` and avoids copying every skill description into context. | Runtime context tests for connected Skill Group and anti-drift assertion against bulk description injection. |
| W37-HUB-UI | Skills Hub UI matches the catalog/install/group mental model. | The drawer has `Installed`, `Market`, and `Groups` tabs; pack rows are first-class; install target is selectable; Skill Group nodes double-click into a bounded configuration workbench with skills, agents, policy, and context preview sections. | Playwright selectors and UI typecheck/build. |

API contract:

| Endpoint | Contract |
|---|---|
| `GET /api/workflow/skills-market?provider=&q=&limit=` | Returns `schemaVersion`, `providers`, `installTargets`, and pack-first `packs`. Default provider is `skillstore`. No command execution, no secrets, no absolute local paths, and no `SKILL.md` bodies. |
| `POST /api/workflow/skills-market/install` | Body: `{ provider, packSlug, targetScope, createGroup?, groupTitle? }`. Fetches manifest/lockfile, verifies hashes, writes files only under the selected target, writes a lock record, optionally creates a Skill Group node, and returns installed file refs plus group metadata. |
| `GET /api/workflow/skills-hub` | Keeps local installed skills as the installed tab source; may include install target options and installed lock refs. |
| `GET /api/workflow/context/:node` | Adds `effectiveSkillGroups[]` for connected Skill Group nodes and keeps `effectiveSkills[]` as skill ids/names, not full descriptions. |

Install target contract:

| Scope | Path | Default | Notes |
|---|---|---|---|
| `project-agents` | `./.agents/skills` | yes | Default external install target. |
| `project-claude` | `./.claude/skills` | no | Project-local Claude compatibility. |
| `user-agents` | `~/.agents/skills` | no | User-global agent skills. |
| `user-codex` | `~/.codex/skills` | no | Codex user-global compatibility. |
| `user-claude` | `~/.claude/skills` | no | Claude user-global compatibility. |

Safety contract:

- Skillstore installs must use manifest/lockfile file lists and SHA-256 checks.
- Do not run external package managers or CLIs during one-click install.
- Reject absolute paths, `..`, Windows drive prefixes, symlink escape, and
  files outside the selected skills root.
- Cap per-file and total download bytes in the backend.
- Persist only bounded metadata in Skill Group state and Agent context.

Subagent dispatch:

`fanoutAttempted: true`

| Agent | Runtime / Channel | Role | Mode | Read Set | Write Set | Forbidden | Acceptance IDs | Status | Return |
|---|---|---|---|---|---|---|---|---|---|
| W37-R1 | Codex native subagent / `multi_agent_v1` | docs-researcher | Read-only | Skillstore docs/pages, Claude plugin marketplace docs, existing `workflow-skills-hub.mjs` | none | writes, install commands, git, publish | W37-MARKET-DISCOVERY, W37-INSTALL-PACK | Complete | Skillstore is W37 installable; Claude/plugin marketplaces are deferred/discovery-only; manifest/lockfile file hashes and signatures are available. |
| W37-A1 | Codex native subagent / `multi_agent_v1` | architect | Read-only | `workflow-skills-hub.mjs`, `workflow-capability-node-store.mjs`, `workflow-node-runtime.mjs`, `workflow-api-phase3.test.mjs`, architecture docs | none | writes, git, publish | W37-INSTALL-PACK, W37-GROUP-CONTEXT | Complete | Recommended separate Market module, Capability store as only Skill Group writer, `effectiveSkillGroups[]`, and context parity across runtime/A2A. |
| W37-U1 | Codex native subagent / `multi_agent_v1` | reviewer | Read-only | `WorkflowRoute.tsx`, `WorkflowCapabilityNode.tsx`, `nodeRuntimeClient.ts`, `types.ts`, hub CSS, Playwright M3 specs | none | writes, git, publish | W37-HUB-UI, W37-GROUP-CONTEXT | Complete | Required Installed/Market/Groups tabs, pack rows, install target selector, double-click workbench, and compatibility selectors. |

Implementation write sets after read-only synthesis:

| Worker | Write Set | Acceptance IDs |
|---|---|---|
| W37-T/BE | `src/wf-ui-server/__tests__/workflow-skills-market.test.mjs`, relevant context tests | W37-MARKET-DISCOVERY, W37-INSTALL-PACK, W37-GROUP-CONTEXT |
| W37-BE | `src/wf-ui-server/workflow-skills-market.mjs`, `server.mjs`, `workflow-skills-hub.mjs`, `workflow-node-runtime.mjs`, capability store/state helpers | W37-MARKET-DISCOVERY, W37-INSTALL-PACK, W37-GROUP-CONTEXT |
| W37-FE | `src/ui/src/types.ts`, `src/ui/src/components/workflow/nodeRuntimeClient.ts`, `src/ui/src/components/WorkflowRoute.tsx`, `src/ui/src/components/WorkflowCapabilityNode.tsx`, `src/ui/src/index.css`, M3 Playwright specs | W37-HUB-UI, W37-GROUP-CONTEXT |
| W37-DOC | `Harness/project/architecture.md`, template architecture mirror, task docs, anti-drift tests if needed | W37-* |

Verification commands:

- `node --check src/wf-ui-server/workflow-skills-market.mjs src/wf-ui-server/workflow-skills-hub.mjs src/wf-ui-server/server.mjs src/wf-ui-server/workflow-node-runtime.mjs src/wf-ui-server/a2a-store.mjs` PASS.
- `node --test src/wf-ui-server/__tests__/workflow-skills-market.test.mjs src/wf-ui-server/__tests__/workflow-skills-hub.test.mjs src/wf-ui-server/__tests__/workflow-node-runtime.test.mjs src/wf-ui-server/__tests__/workflow-api-phase3.test.mjs` PASS 87/87.
- `pnpm --dir src/ui exec tsc --noEmit` PASS.
- `npm run build --prefix src/ui` PASS with existing Vite chunk-size warnings.
- `pnpm --dir src/ui exec playwright test e2e/wf-ui-m3-component-nodes.spec.ts -g "AC-001 creates Agent"` PASS 1/1.

### W38 Magnetic Topology + Four-Side + Big Views + API Control

Mode: `$wf-max`
Tier: `WF-Full`
Reason: this slice crosses graph state model (magnetic topology), backend
node-action API (file.* / topology), frontend graph interaction (four-side
magnetic + feel), and three large UI surfaces (File big view, Skills Hub big
config, Timer UI polish). User instruction: state model and boundaries FIRST,
then UI visuals; keep changes restrained; do not revert unrelated dirty files.

#### W0 Audit Summary (read-only, 6 codebase-explorer agents)

- Magnetic semantic split (W34) is clean: `capsuleDockLinks[]` is separate from
  `graph.edges[]`; docked edges hidden via `visibleManualEdges` filter
  (`WorkflowRoute.tsx:6796`); restore-on-detach + tombstones exist; four-side
  magnetic ALREADY works for Agent/Timer/Goal/Capability(MCP). No ghost-line bug
  found.
- Agent double-click ALREADY opens the floating TerminalDrawer for session-bearing
  nodes (`WorkflowRoute.tsx:6692-6696` → `onSelectSession`). Only the explicit
  `workflow-open-terminal` button converts to terminal-mode. W34 drag-transition
  hotfix is applied (`WorkflowRoute.tsx:8665-8668`).
- Magnetic topology groups: NOT present. No connected-component/group computation;
  Agent context (`workflow-node-runtime.mjs:1943-1969`) has zero magnetic fields.
- File node: read-only, no double-click, no edit/save. `file.readText/readMeta/
  readBytes/refresh` exist; `file.writeText/parsePdf/preview` MISSING. No PDF text
  extraction. Fullscreen shell pattern exists in MarkdownComponentNode.tsx:237-335.
- Skills Hub: 392px right-side drawer (`index.css:1230`); Skill Group double-click
  reuses the small drawer; workbench read-only; missing enable/disable,
  group/ungroup, mount-from-workbench. Agent context skill-group shape is clean
  (no SKILL.md body leak).
- Timer UI: running/stopped + loop countdown + event count present
  (`WorkflowEventNode.tsx`); missing absolute nextDueAt display, event-count
  testid, loop/while/task visual distinction. Control via API + control-edge gate
  verified.

#### Acceptance Criteria

| AC ID | Scenario | Contract | Verification |
|---|---|---|---|
| W38-TOPOLOGY | A-B-C docked transitively (A dock B, B dock C) share one magnetic group; A can reach C; UI draws no A-C line. | Backend computes connected components from `capsuleDockLinks`; Agent context exposes `directMagneticNeighbors`, `magneticReachableNodes`, `magneticGroupId`, `magneticTopology`; UI still renders only direct dock links. | New `workflow-magnetic-topology.test.mjs` + frontend assertion that no transitive edge is rendered. |
| W38-FOUR-SIDE | Markdown/File/Diagram expose 4 physical bidirectional handles (top/right/bottom/left) and can magnetically dock to any capsule node on any side. | `capsuleRoleForNode` includes resource nodes; `WorkflowComponentNode.tsx` renders exactly 4 DOM handles (W11 no-overlap preserved); File node no longer left=input/right=output; `side` stored as top\|right\|bottom\|left. | Playwright DOM handle audit + mocked any-side dock smoke. |
| W38-MAGNETIC-FEEL | No top-bar "edge selected" during dock; no drag transition trail; detach deletes magnetic link + recomputes group immediately; no ghost line after detach. | `onNodeDragStart` clears `selectedEdgeIds`; graph-map PUT debounced; W34 hotfix intact; detach path recomputes topology. | Playwright dock/undock + selection-state assertion. |
| W38-AGENT-DRAWER | Agent double-click ALWAYS opens TerminalDrawer and NEVER converts the canvas node to `workflow-node-terminal`, regardless of session state. | Double-click handler resolves/creates session and calls `onSelectSession`; explicit buttons keep terminal-mode (user-approved). | Playwright double-click → `terminal-window` present, `workflow-node-terminal` absent. |
| W38-FILE-API | Backend `file.writeText`, `file.preview`, `file.meta` run through `POST /api/workflow/nodes/:id/actions/:action` with workspace path safety; no direct state.json mutation. **Scope note (user decision): PDF text extraction is DROPPED — no bundled PDF parser (no pdfjs); users install their own. PDFs are preview-only via browser-native iframe.** | `file-node.mjs` adds writeText/preview/meta (alias readMeta); writes reuse `resolveWorkspacePath` + `assertExistingPathInsideWorkspace`; no PDF parser bundled. | New `workflow-file-node-actions.test.mjs` covering write/preview/meta + traversal denial + no-state-mutation (10 tests). |
| W38-FILE-VIEW | File node double-click opens a VSCode-like big view; text edit/save via `file.writeText`; Markdown edit/preview toggle; image zoom/fit; PDF preview (browser-native iframe, NO text extraction); audio/video native; JSON format+validate; all IO through typed file.* actions. | New `WorkflowFileBigView` (native media only, no new deps) reusing the fullscreen shell; all IO through `nodeRuntimeClient` file.* calls; no direct backend-file writes from UI. | Playwright open/edit/save round-trip + preview-kind assertions (W38-4). |
| W38-SKILLS-CONFIG | Skills Hub double-click (and Skill Group double-click) opens a big WYSIWYG config overlay; enable/disable skill, group/ungroup, mount-to-Agent affordances; Agent context stays body-free. | Promote workbench to fullscreen overlay; add per-skill enable/disable (capability store `state`), inline group edit, mount button; backend enable/disable action added. | Playwright overlay + enable/disable + mount assertions; context no-leak regression. |
| W38-TIMER-UI | Compact Timer card shows running/stopped, loop countdown, nextDueAt, event count (with stable testid); loop/while/task visually distinguished. | `WorkflowEventNode.tsx` adds nextDueAt row, `workflow-timer-event-count` testid, mode badge variant. | Focused Playwright timer card assertion. |
| W38-AGENT-CONTEXT | Agent context + `workflow-context` CLI include magnetic topology + connected control affordances; no prompt-injection (env/API only). | Context builder + CLI proxy carry the new fields; init guidance unchanged (env-first). | `workflow-context` live smoke + context test. |

#### Constraints (carry forward)

- W11 rule preserved: exactly ONE DOM handle per physical side; no hidden
  overlapping handles. Four-side = 4 DOM handles total per resource node.
- W6 rule preserved: resource nodes keep ONE semantic bidirectional port
  (`markdown`/`scene`/`file`), now reachable from 4 physical sides.
- Direct `Harness/a2a/**/state.json` and `Harness/a2a/workflow-map.json` edits
  remain forbidden as control surfaces; all control via typed backend API.
- Do not reset/checkout/revert any pre-existing dirty files outside the declared
  write sets.

#### Dispatch Table

Wave 1 (parallel — disjoint write sets):

| Worker | Role | Write Set | Forbidden | AC IDs |
|---|---|---|---|---|
| W38-BE-TOPOLOGY | implementer | `src/wf-ui-server/a2a-store.mjs`, `src/wf-ui-server/workflow-node-runtime.mjs`, NEW `src/wf-ui-server/__tests__/workflow-magnetic-topology.test.mjs` | frontend, `file-node.mjs`, `workspace-store.mjs`, other tests, task state, git | W38-TOPOLOGY, W38-AGENT-CONTEXT |
| W38-BE-FILEAPI | implementer | `src/wf-ui-server/workflow-node-types/file-node.mjs`, `src/wf-ui-server/workspace-store.mjs`, `src/wf-ui-server/package.json` (only if pdfjs-dist absent), NEW `src/wf-ui-server/__tests__/workflow-file-node-actions.test.mjs` | frontend, `workflow-node-runtime.mjs`, `a2a-store.mjs`, task state, git | W38-FILE-API |
| W38-FE-TIMER | implementer | `src/ui/src/components/WorkflowEventNode.tsx`, NEW `src/ui/e2e/wf-ui-m4-timer-ui.spec.ts` | `WorkflowRoute.tsx`, other components, backend, task state, git | W38-TIMER-UI |

Wave 2 (serial — shared `WorkflowRoute.tsx` family, sequenced):

| Worker | Role | Write Set (sequential) | AC IDs |
|---|---|---|---|
| W38-FE-MAGNETIC | implementer | `WorkflowRoute.tsx`, `WorkflowComponentNode.tsx`, `workflow/nodeRegistry.tsx`, `index.css`, NEW magnetic spec | W38-FOUR-SIDE, W38-MAGNETIC-FEEL, W38-AGENT-DRAWER |
| W38-FE-FILEVIEW | implementer | NEW `WorkflowFileBigView.tsx`, `FileComponentNode.tsx`, `WorkflowRoute.tsx`, `workflow/nodeRuntimeClient.ts`, `index.css`, NEW file-view spec | W38-FILE-VIEW |
| W38-FE-SKILLS | implementer | `WorkflowRoute.tsx`, `WorkflowCapabilityNode.tsx`, `index.css`, `workflow-capability-node-store.mjs` (enable/disable), NEW skills spec | W38-SKILLS-CONFIG |

Wave 3: read-only review (spec/code/security/perf) + verifier gates.

#### Verification Commands

- `node --check` touched backend modules.
- `node --test src/wf-ui-server/__tests__/workflow-magnetic-topology.test.mjs src/wf-ui-server/__tests__/workflow-file-node-actions.test.mjs src/wf-ui-server/__tests__/workflow-node-runtime.test.mjs src/wf-ui-server/__tests__/workflow-api-phase3.test.mjs`
- `pnpm --dir src/ui exec tsc --noEmit`
- `npm run build --prefix src/ui`
- Focused Playwright: timer-ui, magnetic four-side/dock, agent-drawer, file-view, skills-config.

### W39 Architecture & Storage Audit (read-only)

User: "后端架构审核，单文件是否太大，JSON 节点存储性能是否够用，是否要上 MongoDB". 3 read-only auditors (backend arch, storage/DB eval, frontend behemoth).

Verdicts (recorded 2026-08-11):

1. **Layering is sound below ~900 lines; three ~3k-line files each mix 3-4 concerns**: server.mjs 3081 (routes + session service + task lifecycle + process metrics + node-init prompt), a2a-store.mjs 3271 (~1100 lines of prompt constants + graph store + snapshot assembler), workflow-node-runtime.mjs 2719 (borderline; acceptable if the context domain moves out). Frontend WorkflowRoute.tsx 9223 is the single biggest liability (born big; 3 commits ever; every change lands there).
2. **Real duplication**: handlesFor/capabilitiesFor/fileSupportsText/contentRefFor + the whole connected-ref builder domain (~600 lines) duplicated between a2a-store (graphContextBySessionId) and runtime (buildAgentContext) — shapes ALREADY drifted (a2a-store copy lacks defaultSkills/ontology/affordances/magnetic topology). WS frame codec ×3 (ws-terminal/ws-events/ws-wf-browser); per-store node-kit ~150 lines ×4 stores; session derivation helpers ×2; activeTask read ×2.
3. **Legacy**: POST /api/workflow/run (zero consumers), GET /api/workflows + GET /api/a2a/skills (no UI/CLI consumers; tests only).
4. **JSON storage: sufficient now and to low thousands of nodes — MongoDB: NO.** Snapshot 200ms@10 nodes is NOT file-IO-bound: cost model = (6+2E)×N reads + O(E×N) edge re-enumeration (a2a-store.mjs:1410/1563 re-lists all 4 stores per edge) + 165 session STATE.json enumeration + 2× map loads. Uncached cliff at N≈100 (~15s est); with an in-memory revision-aware cache JSON stays fine to N≈2000. 44MB of Harness/a2a is sessions/terminal.jsonl transcripts (~85-90%), NOT node state (node state <2%).
5. **Write-path issues (independent of DB)**: no atomic writes (writeFileSync direct → crash can truncate; readJson silently falls back), revisions.jsonl unbounded (59 rows on one timer), graph-map whole-file rewrite per commit with check-then-act expectedVersion (multi-instance lost-update risk, low probability single-instance), every mutation response rebuilds the full ~200ms snapshot (server.mjs:1439/2411).
6. **MongoDB verdict**: NO — ops burden, kills git-diffability + the file-shaped statePath contract (architecture.md 3.1), zero cross-node query needs, not on the bottleneck. Alternatives ranked: (a) in-memory revision-aware cache + snapshot ETag/304 (the only worthwhile one, 200ms→<40ms), (b) bounded log rotation (terminal.jsonl cap + revisions.jsonl keep-K) — must-do, kills 44MB growth, (c) SQLite only if real cross-node queries/multi-instance consistency ever appear, (d) MongoDB only for multi-user remote.
7. **Priority refactor list (all pure moves, existing tests as safety net)**: 1) extract workflow-agent-context.mjs from runtime + make a2a-store snapshot delegate (closes the drift + most duplication), 2) workflow-defaults.mjs (pure constants), 3) node-init.mjs from server.mjs, 4) session-service.mjs from server.mjs, 5) ws-codec.mjs (3 copies), 6) node-store-utils.mjs (4 stores), 7) remove dead routes, 8) frontend: helpers→workflow/graphHelpers.ts + sub-components→own files first (zero seam), then Zustand seam → persistence/undo/dock hooks, then inline panels → components.
8. Frontend CSS 2540: 81% workflow styles; 6 dead-class candidates to verify before deleting.

Implementation of any of the above is a separate wave; the user decides which to execute.

### W39 C7+C5 Atomic JSON + Node Store Utils

User decision: C1 is complete; continue with C7+C5 as one backend storage
follow-up. This slice is storage-bound only: no MongoDB, no frontend work, no
graph semantics changes, and no direct edits to backend-owned runtime state
files as a control surface.

Acceptance criteria:

| AC ID | Scenario | Contract | Verification |
|---|---|---|---|
| W39-ATOMIC-WRITE | Node store JSON writes cannot leave truncated authoritative JSON on normal write replacement. | New shared `json-store-utils.mjs` provides atomic JSON write through temp file + rename and preserves pretty JSON formatting. | Backend store tests create/update/delete nodes and read persisted files. |
| W39-STRICT-READ | Missing files and corrupt JSON are not silently conflated. | Shared JSON reader distinguishes missing fallback from corrupt parse errors; global live-list paths may skip stale refs only through explicit stale handling, while direct reads remain strict. | Targeted tests cover corrupt state/index behavior and stale live-list tolerance where already supported. |
| W39-NODE-STORE-UTILS | Component/Event/Capability/Goal stores stop copying the same read/write/path-kit logic. | New `node-store-utils.mjs` owns common safe node id, state dir/path, JSON read/write, revision append helpers where practical; four stores import it without broad behavior changes. | `node --check` touched modules and targeted node store/runtime/API tests pass. |

Dispatch table:

| Worker | Role | Write Set | Forbidden | AC IDs |
|---|---|---|---|---|
| W39-BE-STORE-UTILS | implementer | NEW `src/wf-ui-server/json-store-utils.mjs`, NEW `src/wf-ui-server/node-store-utils.mjs`, `src/wf-ui-server/component-node-store.mjs`, `src/wf-ui-server/workflow-event-node-store.mjs`, `src/wf-ui-server/workflow-capability-node-store.mjs`, `src/wf-ui-server/workflow-goal-node-store.mjs`, focused backend tests for these stores | frontend, `WorkflowRoute.tsx`, `a2a-store.mjs` unless strictly necessary and reported first, task state, git, publish, direct Harness/a2a state mutation for control | W39-ATOMIC-WRITE, W39-STRICT-READ, W39-NODE-STORE-UTILS |

Verification commands:

- `node --check src/wf-ui-server/json-store-utils.mjs src/wf-ui-server/node-store-utils.mjs src/wf-ui-server/component-node-store.mjs src/wf-ui-server/workflow-event-node-store.mjs src/wf-ui-server/workflow-capability-node-store.mjs src/wf-ui-server/workflow-goal-node-store.mjs`
- `node --test src/wf-ui-server/__tests__/component-node-store.test.mjs src/wf-ui-server/__tests__/component-node-api.test.mjs src/wf-ui-server/__tests__/workflow-node-runtime.test.mjs src/wf-ui-server/__tests__/workflow-api-phase3.test.mjs`
- Add/run focused tests for event/capability/goal store atomic/strict behavior if existing coverage is insufficient.

### W41 Agent-to-Agent Communication Contract

Mode: `$wf`
Tier: `WF-Standard`
Reason: this is a behavior/API/prompt/skill change across Agent runtime,
wf-ui-control CLI, Agent default skills, and backend tests. It is not WF-Full:
the scope is a local Harness control-plane contract, not remote auth, scheduler,
retry queues, or arbitrary external A2A interoperability.

#### Mini PRD

Agent nodes need a product-level communication surface, not just terminal-input
plumbing. A Main Agent must be able to send a task/message to one connected
Agent node, send the same message to multiple connected Agent nodes, inspect
recorded message traffic, and use a connected Markdown or File node as durable
shared context. A receiving Agent must know from its init guidance and default
skills that replies go back through backend actions, not by editing graph/state
files or assuming chat transcript state is authoritative.

#### External Research Synthesis

- A2A protocol: model communication as capability discovery plus task/message
  exchange with synchronous, streaming, and async modes. Adopt the envelope and
  status/result framing idea; do not adopt a remote protocol server in W41.
- AutoGen Core: direct messaging is 1:1 by recipient id; broadcast is 1:N
  through topic/subscription. Adopt explicit direct vs broadcast command names.
- AutoGen Group Chat: a group can share one thread/topic and use a manager for
  turn selection. W41 supports the shared thread/topic storage; automatic
  speaker selection remains non-scope.
- LangGraph handoffs: handoff tools update persistent state and decide what
  context passes between graph nodes. Adopt "tool/API call is the transition",
  not prompt-only routing.
- Blackboard MAS: shared public memory lets agents read/write common messages.
  Adopt connected Markdown as the local blackboard node when present.

#### Acceptance Criteria

| AC ID | Scenario | Contract | Verification |
|---|---|---|---|
| W41-DIRECT | Agent A sends a message/task to one connected Agent B through a backend action/CLI; the bridge record includes sender/recipient node+session ids and the returned payload can be read by A. | Add/standardize `agent.message.send` or equivalent CLI wrapping `agent.sendInput`; reject non-connected recipients for Agent-authored sends unless explicitly forced by Main Agent policy. | Backend test covering graph A-B, action response, bridge log, and CLI payload shape. |
| W41-BROADCAST | Agent A sends one message/task to multiple connected Agent nodes in one command; backend returns per-recipient status and records one bridge message per recipient without self-send. | Add/standardize `agent.message.broadcast` or equivalent CLI; recipient selection can be explicit `--to a,b,c` or `connectedAgentRefs` broadcast. | Backend test with A-B and A-C connected, A-D unconnected rejected/skipped, and 2 bridge records. |
| W41-SHARED-CONTEXT | When a connected Markdown/File resource is marked as shared context, Agent init/default skills tell Agents to read/write it through typed node actions; context exposes enough refs for both sender and receiver to use it. | Prefer connected Markdown as local blackboard for shared notes; File remains read/share context unless writable file action is explicitly chosen. No direct `Harness/a2a/**/state.json` control. | Backend context/skill manifest tests plus Markdown action test showing both A and B can reference the same node. |
| W41-PROMPT-SKILL | Agent prompts and skill manifests include direct-message, broadcast, reply, bridge-read, and shared-context triggers in English and Chinese. | Root/template init guidance and `workflow-agent-node` / `workflow-node-actions` dogfood+template skills are byte-aligned where generated. | JSON parse/anti-drift checks and targeted string tests. |

#### Non-Scope

- No remote A2A protocol server/client.
- No durable scheduler, retry/cancel queue, automatic speaker selector, or full
  group-chat manager.
- No arbitrary MCP tool invocation as part of message delivery.
- No manual mutation of `Harness/a2a/**/state.json`, terminal logs, bridge JSONL,
  or workflow-map files as a control surface.

#### Dispatch Table

Runtime note: Codex subagent tool is not directly exposed in this surface, so
W41 uses bounded role passes under `subagent-orchestrator` fallback.

| Pass | Role | Mode | Read Set | Write Set | AC IDs | Status |
|---|---|---|---|---|---|---|
| W41-R1 | researcher | Read-only | A2A, AutoGen, LangGraph, blackboard sources | none | W41-* | Complete |
| W41-E1 | codebase-explorer | Read-only | `bridge-store.mjs`, `server.mjs`, `workflow-node-runtime.mjs`, `agent-node.mjs`, `workflow-agent-context.mjs`, skills JSON, CLI | none | W41-* | Complete |
| W41-T1 | test-writer | Write | relevant backend tests and skill manifest tests | `src/wf-ui-server/__tests__/workflow-agent-communication.test.mjs`, existing focused tests if needed | W41-* | Complete |
| W41-I1 | implementer | Write | runtime/CLI/skills/prompt files from E1 | communication backend/CLI/skill/init files only | W41-* | Complete |
| W41-V1 | verifier | Read-only | test outputs and diff | none | W41-* | Complete |
| W41-R2 | reviewer | Read-only | W41 diff, AC matrix, tests | none | W41-* | Complete |

#### Verification Commands

- `node --check` on touched backend and CLI modules.
- `node --test src/wf-ui-server/__tests__/workflow-agent-communication.test.mjs src/wf-ui-server/__tests__/workflow-agent-runtime.test.mjs src/wf-ui-server/__tests__/workflow-api-phase3.test.mjs`
- JSON parse check for dogfood/template workflow Agent skills.
- Existing anti-drift tests that cover template/dogfood skill parity.
- Optional live wf-ui smoke only if the local PTY control plane is needed after
  unit/API coverage.

#### Closeout Evidence

- Implemented `agent.sendMessage`, `agent.broadcastMessage`, and
  `agent.readMessages` with connected-peer enforcement, Main-Agent-only
  unconnected force, per-recipient broadcast status, bridge envelopes, terminal
  stdin recording, and session events.
- Added CLI wrappers `send-agent-message`, `broadcast-agent-message`, and
  `read-agent-messages`; updated Agent init guidance and dogfood/template
  workflow skills to expose direct, broadcast, reply, bridge-read, and shared
  Markdown context workflows.
- Verification passed: W41 communication tests 5/5; related runtime/API tests
  31/31; A2A/context/anti-drift tests 36/36; CLI smoke 36 pass/1 skipped;
  server integration target 39/39; syntax checks and `git diff --check` clean.
- Independent Claude read-only excerpt review returned PASS. Follow-up risk
  noted: no semantic delivery ack, no retry/retention/rate-limit layer; these
  remain outside W41's local-control-plane scope.
