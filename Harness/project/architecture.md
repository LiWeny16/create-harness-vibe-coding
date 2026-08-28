# Harness Architecture - create-harness-vibe-coding

> **Responsibility**: Define the repository structure and scaffold generation boundaries.
> **Does NOT cover**: Generated target-project business architecture.

---

## 1. Layering Rules

```text
bin/
  CLI executable shim. Calls src/index.js.

src/
  CLI orchestration and scaffold generation logic.
  May read templates/ and write the chosen target directory.

templates/
  Source of generated scaffold assets.
  Must stay declarative: markdown, skill files, agent files, scripts, and optional workflow docs.

Harness/ and .claude/
  Dogfood runtime for this repository's own agent work.
  Must not be treated as package source unless intentionally copied into templates/.

tests/
  Node test suite for CLI behavior, generator behavior, package contents, and generated harness validation.
```

Hard constraints:

- `templates/common/**` and `templates/optional/**` are the source of generated output.
- Root `Harness/**` is this repository's operating harness; changing it does not change generated projects.
- Generated output paths are normalized by `harnessDest()` in `src/generator.js`.
- Existing-project safety is owned by conflict planning in `src/generator.js`, not by template prose alone.
- Package publication is constrained by `package.json#files`; root dogfood files are not package contents.

## 2. Interface Decoupling

Use interfaces and module boundaries to protect real seams in the generator, not to decorate straightforward code.

- `src/index.js` owns CLI/user interaction; `src/generator.js` owns planning and file writes.
- Template files are declarative inputs; source code should not depend on root dogfood `Harness/**`.
- Optional catalog structure is the extension contract for presets and optional skills.
- Avoid speculative abstraction: do not add plugin systems, generic runners, extra config layers, or service containers until a real second use or testability boundary exists.
- When a boundary is real, express it with a small data contract and test it through generated output behavior.

## 3. State Design

State in this repo should be explicit, serializable, and owned by one layer.

- Generator plan state is computed in memory and returned as `plan`/`summary`; file writes consume that plan instead of re-deciding conflicts.
- Filesystem state is authoritative only through existence/type checks and write results.
- Optional selection state comes from CLI flags plus `templates/optional/catalog.json`; do not duplicate it in template prose.
- Release state lives in `package.json`, npm, git tags, and GitHub; document commands in `README.md`, not `CLAUDE.md`.
- Long-running agent work records resumable status in `Harness/tasks/<task-id>/PLAN.md#Heartbeat`.

### 3.1 WF-UI Component Node State Contract

WF-UI component nodes have three distinct state shapes. Code, tests, and fixtures
must keep them separate:

- **Persistent state** lives at `Harness/a2a/component-nodes/<nodeId>/state.json`.
  It is backend-owned, revisioned, and is the source of truth for user-editable
  Markdown, Excalidraw, and File component state.
- **Agent refs** live in `stateRef`, `contentRef`, and `componentStateRefs`.
  Refs contain only enough metadata for agents to locate state: path, revision,
  type, title, and small file metadata when needed. Refs are not renderable UI
  state and must not inline `markdown`, `scene`, or editable file payloads.
- **UI hydration state** lives in `/api/a2a/snapshot#componentNodes`. The first
  paint workflow UI must receive full component state here so previews,
  fullscreen editors, save buttons, and thumbnails hydrate from the same
  revision the backend will later guard on save.

Invariants:

- `index.json`, `state.json`, `/api/workflow/nodes/:nodeId`,
  `graph.componentStateRefs`, and `snapshot.componentNodes` must agree on
  `nodeId`, `type`, `statePath`, and `revision`.
- `statePath` must use `Harness/a2a/component-nodes/<nodeId>/state.json`; the
  legacy `Harness/a2a/component-nodes/<nodeId>.json` shape is invalid for new
  code, tests, and docs.
- Defaults may seed newly created component nodes only. Existing persisted nodes
  must not silently hydrate to empty Markdown, empty Excalidraw scenes, or empty
  file metadata when their state file is missing or malformed.
- Global workflow snapshots, graph maps, runtime node lists, and Agent contexts
  enumerate live component nodes only. If `index.json` still references a
  missing, malformed, or revision-mismatched `state.json`, the global snapshot
  must skip that component and any dangling edges instead of crashing the
  backend or synthesizing empty state.
- Direct component reads remain strict: `GET /api/a2a/component-nodes/:id` and
  typed component state updates must return the state mismatch error until the
  stale index entry is deleted or repaired. Delete paths must still be able to
  remove stale index entries whose state file is already gone.
- UI tests and Playwright fixtures must either use real backend endpoints or
  mirror this contract exactly; mocks must not invent alternate handles, paths,
  revisions, or hydration shapes.

### 3.2 WF-UI Workflow Connection State Contract

WF-UI graph connections are bidirectional by default. Persisted edge endpoint
fields preserve geometry and handle ordering; they are not a semantic permission
direction.

Invariants:

- Persisted graph edges may store `from`/`to` and `source`/`target`, but these
  fields identify stable endpoint order for rendering, handles, offsets, and
  revisioned graph writes only.
- Runtime node snapshots, A2A resource refs, and agent-readable graph context
  must expose `direction: "bidirectional"` plus endpoint-specific
  `endpointRole: "source" | "target"`.
- Connection refs must include `edgeId`, `localHandle`, `peerHandle`,
  `sourceHandle`, `targetHandle`, and `relation`. UI display labels must not be
  reused as semantic `relation` values.
- Resource nodes with one shared editable surface must expose one semantic
  bidirectional resource port and separate physical side handles. Markdown uses
  semantic port `markdown`; Excalidraw uses semantic port `scene`. ReactFlow may
  render them as `markdown:left`/`markdown:right` and
  `scene:left`/`scene:right`, but those physical handles are geometry only.
- Markdown and Excalidraw must not be modeled as `input`/`output` split ports.
  Both physical sides can start or receive a connection. Agent-readable context,
  labels, and capability checks use the semantic port, not the physical side.
- A bidirectional physical side must render as exactly one user-visible and DOM
  handle for that side. Do not stack hidden source/target handles with the same
  id to simulate bidirectionality; that creates ambiguous ReactFlow hit targets
  and can snap a user drag to the wrong node. If a canvas library cannot support
  one DOM handle that can start and receive connections, add an adapter-level
  abstraction or tests before shipping that node.
- Graph readers and writers must normalize missing or legacy aliases at every
  boundary that touches persisted graph state: graph-map load/write, workflow
  edge APIs, A2A snapshots, runtime node snapshots, and ReactFlow import/export.
- Bare physical aliases such as `left` and `right` preserve their side before
  semantic fallback. Normalizers must not invert them by source/target role.
- Duplicate edge validation is undirected. `A -> B` and `B -> A` are the same
  workflow connection unless a future explicit permission/direction mode adds a
  separate contract.
- UI labels and markers must present default workflow links as bidirectional.
  Tests and fixtures must include the same connection shape as production and
  must reject reverse duplicate pairs.

### 3.3 WF-UI Node Catalog Contract

WF-UI node creation must be registry-driven. The top-right create button and the
canvas create-node path render the same searchable catalog; they must not keep
separate hardcoded button grids.

Invariants:

- `src/ui/src/components/workflow/nodeRegistry.tsx` owns create-node catalog
  metadata: `kind`, `category`, `state`, `label`, `description`,
  `agentSemantics`, `searchText`, and icon.
- Catalog `state` is either `ready` or `planned`. `ready` items may create
  runtime nodes. `planned` items are visible for discoverability. Most planned
  items are disabled, but planned capability items may open a read-only Hub
  drawer when they declare explicit hub metadata; opening a Hub is not the same
  as creating a runtime node.
- The ready direct-create set is currently Agent, File, Markdown, Diagram, and
  Timer. Skill group and MCP connector catalog entries open Hubs that may create
  backend-owned capability nodes. Single Skill remains attach-only through an
  Agent-targeted Skills Hub. Planned items still cover Trigger, GitHub trigger,
  and Group/subgraph. Goal nodes are synthetic views over active Harness tasks
  and are not direct-create catalog items.
- Search, category grouping, disabled state, and semantic copy are derived from
  catalog metadata. UI tests must assert the same selectors used by production:
  `workflow-create-node-search`, `workflow-create-node-options`,
  `workflow-create-node-group`, and `workflow-create-node-option` with
  `data-node-kind`, `data-node-category`, `data-node-state`,
  `data-node-action`, optional `data-node-hub`, and `data-agent-semantics`.
- A future node type may not become `ready` as a canvas-only widget. It must
  declare its Node Runtime adapter, storage/state ownership, graph ports,
  direction semantics, settings/action schema, and browser/API regression tests
  first.

### 3.4 WF-UI Capability Hub Contract

Skills and MCP entries are capability providers for Agent nodes. They are not
standalone executors until a later runtime contract defines lifecycle,
sandboxing, permissions, and audit logs.

Invariants:

- `GET /api/workflow/skills-hub` is a read-only metadata index. It scans only
  allowed skill roots, defaults to project scope, reads only bounded `SKILL.md`
  files, and returns `schemaVersion`, `query`, `roots`, `summary`,
  `nodeSemantics`, `skills`, and `groups`.
- Hub responses must not expose absolute local paths, skill bodies, secrets, or
  executable command output. Source locations are project-relative or `~/...`
  display paths only.
- The create-node catalog may open the Skills Hub for Skill and Skill group
  entries and may open the MCP Hub for MCP connector entries. Runtime creation
  is allowed only for node types with backend-owned state, runtime adapters,
  graph ports, Agent context refs, and browser/API regression tests.
- The Hub drawer contract is stable: `workflow-capability-hub-drawer`,
  `workflow-capability-hub-search`, `workflow-capability-hub-item`,
  `workflow-capability-attach`, and `workflow-capability-create-node`, with
  `data-hub-kind`, `data-origin`, and optional `data-target-agent-id`.
- Skill attachment is enabled only when the Hub has a target Agent node. The
  attach action updates that Agent config through `skills` and
  `skillPolicy: "manual"`; a Hub opened without an Agent target remains
  read-only with disabled attach controls.
- Agent-readable context exposes attached skills through
  `connectedCapabilityRefs`, `effectiveSkills`, and `skillPolicy`. These refs
  use relation `capability`, `direction: "bidirectional"`, and
  `executor: "agent"` because the Agent remains the executor and mediator.
- `skill-group` is the first runtime capability-provider node. Its state lives
  under `Harness/a2a/capability-nodes/<nodeId>/state.json`, is revisioned, and
  appears in snapshots through `capabilityNodes` and `capabilityStateRefs`.
- A Skill group node is created from a Skills Hub group, not as a standalone
  executor. It exposes one semantic bidirectional `capability` port rendered as
  physical handles `capability:left` and `capability:right`; both sides may start
  or receive resource/capability links.
- When connected to an Agent, a Skill group contributes
  `connectedCapabilityNodeRefs`, merged `connectedCapabilityRefs`, and
  `effectiveSkills` to that Agent context. The link uses relation `capability`,
  `direction: "bidirectional"`, and `executor: "agent"`.
- Skill group nodes may store only bounded metadata: group id/label/kind, skill
  names, source summaries, and counts. They must not persist skill bodies,
  absolute local paths, command output, secrets, or MCP credential probes.
- `GET /api/workflow/mcp-hub` is a no-spawn, no-secret, read-only metadata
  endpoint. It indexes project MCP config files only, exposes redacted server
  metadata and summary counts, and never launches servers, tests credentials, or
  leaks environment values.
- `mcp-connector` is a runtime capability-provider node created from MCP Hub
  server metadata. The frontend sends only `mcpServerId`; the backend re-reads
  the Hub and persists only the sanitized record: server names, transport,
  command basename, arg count, redacted URL, env key names, source summaries,
  risk flags, and counts. It exposes the same bidirectional `capability` port
  and `capability:left|right` physical handles as other capability providers.
- When connected to an Agent, an MCP connector contributes
  `connectedCapabilityNodeRefs` and merged `connectedCapabilityRefs`, but does
  not add server names to `effectiveSkills`. Direct MCP attach, credential
  probing, tool listing, and tool invocation remain gated until a separate
  permission/audit/runtime contract exists.

### 3.5 WF-UI Event Node Contract

Timer is the first runtime event node. Event nodes may use directed event
outputs, but that direction is explicit and local to event emission. It must not
change the default bidirectional semantics of Agent, Markdown, Excalidraw, File,
Skill, or MCP capability links.

Invariants:

- Timer state lives under `Harness/a2a/event-nodes/<nodeId>/state.json` and is
  backend-owned, revisioned, and represented in snapshots through `eventNodes`,
  `eventStateRefs`, and `connectedEventRefs`.
- Timer exposes a directed `event` output, a `config` input, and an optional
  bidirectional `status` port. The persisted Timer-to-Agent event edge uses
  `direction: "source-to-target"` and relation `event`; Agent-to-Timer mutable
  control uses a separate relation `control` edge.
- Advanced Timer state may include once, interval, cron, loop, adaptive,
  watchdog, while, and task cadence metadata plus base heartbeat, watchdog
  heartbeat, task binding, and control policy. Loop/while/task/adaptive modes
  are declarative metadata only; runtime tick logic must never evaluate
  user-authored code from Timer settings.
- Timer double-click opens the expanded Timer workbench for schedule mode,
  base heartbeat, and WDT configuration. The right-click settings panel stays a
  lightweight management surface and must not be the only way to edit schedule
  details.
- Agent Timer actions such as interval changes, WDT ack/reset, enable/disable,
  and mode changes require an explicit control edge and must be exposed through
  bounded runtime actions instead of direct state-file writes.
- A directed event edge is duplicate-checked by ordered endpoints, relation, and
  handles. This is separate from the unordered duplicate rule for default
  bidirectional workflow links.
- Event node catalog entries become `ready` only after storage, runtime adapter,
  graph-map direction persistence, agent context refs, settings/actions, and
  browser/API regression tests are green.
- Trigger and GitHub trigger remain planned until their webhook/auth/replay,
  dedupe, security, and audit contracts are written and tested.

### 3.6 WF-UI Goal Node Contract

Goal nodes are synthetic task-state nodes generated from active Harness tasks.
They let the workflow canvas show completion intent, acceptance state, progress,
and watchdog state without giving arbitrary Agents direct authority over task
closeout.

Invariants:

- Goal node ids are derived from task ids and state is read from
  `Harness/tasks/<taskId>/STATE.json` plus a backend-owned sidecar under
  `Harness/a2a/goal-nodes/<goalId>/state.json`.
- Goal nodes expose bidirectional `goal:left|right` handles for Agent
  collaboration links and appear in snapshots through `goalNodes` and
  `connectedGoalRefs`.
- Goal double-click opens the expanded Goal workbench for user-owned edits to
  title, objective, next action, acceptance rows, and WDT settings. These edits
  write the Goal sidecar and do not directly mutate task `STATE.json`.
- `goal.update` must not accept closeout authority fields such as task status,
  phase, or gate. Completion/status transitions use the dedicated two-phase
  Goal actions.
- Agent-authored mutable Goal actions, including `goal.update`, require an
  existing bidirectional `goal` edge when `actorNodeId` is present. UI/user
  edits omit `actorNodeId`; unlinked Agent writes are rejected with
  `GOAL_EDGE_REQUIRED`.
- Agent completion is two-phase: `goal.requestCompletion` writes a proposal to
  the sidecar, while direct mutation of task `STATE.json` remains gated behind a
  separate closeout authority contract.
- Goal WDT acknowledgement/feed state is separate from task completion state so
  failed or stopped Agents can be recovered without marking the task complete.

### 3.7 WF-UI Node Operation Language

Workflow node gestures must map to a stable operation model across node kinds.

Invariants:

- Single-click selects a node and never opens a heavy editor.
- Right-click opens a lightweight context menu or settings panel for node
  management actions such as settings, delete, duplicate, copy, cut, and
  open-config affordances.
- Double-click opens the node's primary workbench: Agent opens terminal mode,
  Markdown opens the enlarged editor, Excalidraw opens the enlarged scene
  editor, Timer opens the expanded schedule workbench, and Goal opens the
  expanded Goal workbench.
- Expanded workbenches own draft UI state and save through typed node runtime
  actions. Backend-owned snapshots and revisioned sidecars remain the source of
  truth after save.

### 3.8 Agent Graph Operation Control

Agent-authored graph changes are first-class operations, not inferred UI state.

Invariants:

- Main Agent graph authority is exposed through typed `agent.*` node runtime
  actions: `agent.readGraph`, `agent.createNode`, `agent.connectNodes`,
  `agent.disconnectNodes`, `agent.moveNode`, `agent.deleteNode`, and
  `agent.deleteNodes`.
- Agent node-map skills and CLI commands are API wrappers over
  `POST /api/workflow/nodes/:actor/actions/agent.*`. `Harness/a2a/workflow-map.json`
  and node state sidecars are backend-owned storage and may be read for
  diagnostics only; Agent nodes must never edit or delete those files to control
  the canvas.
- Compatibility commands such as `wf-ui-control.mjs connect` and
  `wf-ui-control.mjs delete-node` must delegate to the same typed `agent.*`
  actions instead of writing a whole graph map or calling legacy graph-node
  delete routes directly.
- Non-main Agents cannot mutate the whole graph unless a future permission model
  grants that authority explicitly. Unauthorized graph mutations must fail with a
  403-style error.
- Every successful Agent graph action appends a bounded operation record under
  `workflow.operations.recent[]` with only audit/animation metadata:
  `id`, `kind`, `actor`, `targetNodeIds`, `edgeIds`, `status`, `startedAt`,
  `completedAt`, and `expiresAt`.
- Operation records must not store prompts, transcripts, payload bodies, secrets,
  raw MCP config, or large user content.
- The frontend visualizes Agent control from operation records only. Canvas
  aura, controlled-node glow, and Agent-to-node data-flow edge animation must
  read `targetNodeIds` and `edgeIds`; they must not guess control from node type,
  handle side, or edge direction.
- Browser bridge graph intents use the same operation vocabulary as human UI:
  `graph.createNode`, `graph.connectNodes`, `graph.disconnectNodes`, and
  `graph.moveNode`, `graph.deleteNode`, and `graph.deleteNodes`. A semantic
  intent must issue one semantic mutation request and return operation metadata
  on success.
- Delete operations must protect the active controller: self-delete is rejected,
  bulk delete skips the actor and live Agents by default, and virtual Goal node
  deletion hides the canvas node without mutating the underlying task capsule.
- Operation records are observability and handoff metadata. They are not a durable
  scheduler, retry engine, authorization policy, or workflow-run state machine.

### 3.9 Agent Node Context, Workspace, Skills, and Final Debug Matrix

Agent nodes are graph actors with a bounded local workspace and a typed control
plane. They must not rely on terminal prompt text alone to understand the graph.

Current required contract:

- Identity comes from environment plus node home:
  `HARNESS_WORKFLOW_NODE_ID`, `HARNESS_PEER_SESSION_ID`,
  `HARNESS_AGENT_KIND`, `HARNESS_WF_UI_URL`, `HARNESS_NODE_HOME`, and
  `HARNESS_NODE_INIT`.
- Each Agent node owns a durable node home under
  `Harness/a2a/nodes/<sessionId>/` with `STATE.json`, `init.md`, and a startup
  `graph-snapshot.json`. This folder is the Agent's local run workspace, not the
  node-map control surface.
- Agent working directory (`cwd`) is explicit session config and remains bounded
  by the project workspace APIs. Workspace file changes go through
  `/api/workspace/*`; graph and node state changes go through `/api/workflow/*`.
- Canonical context has one shape. `GET /api/workflow/context/:node`,
  `workflow-context`, and `agent.readContext` must expose the same core Agent
  context fields: `identity`, `workspace`, `connectedResourceRefs`, `connectedAgentRefs`,
  `connectedEventRefs`, `connectedCapabilityRefs`,
  `connectedCapabilityNodeRefs`, `connectedGoalRefs`, `defaultSkills`,
  `effectiveSkills`, `skillTriggers`, `ontology`, `affordances`, and
  `outputRouting`.
- Default Agent skills are machine-readable capabilities, not only prompt text:
  `workflow-ontology`, `workflow-context`, `workflow-node-actions`,
  `workflow-node-map`, and `terminal-control`. Each workflow skill must include
  short trigger phrases for semantic selection, for example graph control,
  connected-context observation, flowchart/diagram output, Goal updates, Timer
  control, direct Agent messaging, broadcast Agent messaging, shared Markdown
  context, worker delegation, and output readback.
- Capability nodes and Skill groups attach metadata to Agent context. They do
  not execute independently. MCP connector nodes are metadata-only until a
  separate permission, tool-list, invocation, audit, and sandbox contract exists.
- Before acting, an Agent must run the loop `observe -> plan -> act -> verify ->
  report`: read ontology, read its context, choose connected affordances, perform
  typed actions, then verify by reading the mutated node or peer output.
- Durable output selection is modality-aware. Connected writable Excalidraw is
  the preferred target for diagrams, flowcharts, sketches, and visual plans.
  Connected writable Markdown is the preferred target for reports, notes, plans,
  and long-form text. Terminal prose is a summary or fallback.
- Connected Agent nodes are collaborators only when they appear in
  `connectedAgentRefs`. Any connected Agent may send a one-to-one message with
  `send-agent-message`/`agent.sendMessage` and reply through the same action.
  One-to-many communication uses `broadcast-agent-message`/
  `agent.broadcastMessage`, which records one bridge envelope per recipient.
  Main Agents may still use legacy `delegate-agent`/`agent.sendInput` for
  worker prompt submission, then verify with `read-agent`,
  `read-agent-messages`, or `bridge-messages`. Built-in subagents are a
  fallback when the graph lacks a suitable connected worker.
- A connected Markdown node with relation `shared-context` is the local
  blackboard for Agent collaboration. Agents read/write it through typed
  Markdown actions only; File nodes can be shared read context through file
  actions but are not the default writable blackboard.
- Parallelism is a graph scheduling decision, not a terminal waiting habit.
  Independent work packets may fan out to connected Agent workers; dependent
  packets must wait for verified outputs or explicit Goal/Timer state.
- Agent prompt delivery must use the canonical prompt-submit path: write prompt
  body first, then send Enter after a short delay. Tests must cover delayed
  Enter behavior and durable node-state readback.

Final debug matrix:

| Area | Probe | Pass condition |
| --- | --- | --- |
| Agent identity/workspace | Start or create Agent, read node home and `self` output | `STATE.json`, `init.md`, env ids, `cwd`, `nodeHomeRel`, and graph node id agree |
| Canonical context | Compare `workflow-context` and `agent.readContext` | Both expose ontology, effective skills, connected refs, affordances, and output routing |
| Connected resource output | Ask Agent for a flowchart or long-form note | Agent uses connected Excalidraw/Markdown node actions and verifies revision/content |
| Graph control | Ask Main Agent to create/connect/move/delete nodes | Only typed `agent.*` actions mutate graph; operation records appear in `workflow.operations.recent[]` |
| Agent direct communication | Connect A-B and ask each side to message/reply | Both sides use `agent.sendMessage`, bridge envelopes record node/session ids, and `agent.readMessages` reads the thread |
| Agent broadcast communication | Connect A to B/C and broadcast one task | A records one delivered bridge envelope per connected recipient and reports skipped/unconnected recipients |
| Shared context | Connect A/B to one Markdown `shared-context` node | Both Agents see the same Markdown ref and use typed Markdown actions as a local blackboard |
| Worker orchestration | Connect Agent workers and delegate independent tasks | Main Agent chooses connected workers first, submits prompts, reads outputs, and records bridge evidence |
| Authority edges | Try Timer/Goal writes with and without links | Timer control needs `control`; Goal writes need bidirectional `goal`; unlinked Agent writes fail |
| Readback consistency | After every mutation, read through API, context, and UI snapshot | Node ids, revisions, handles, relations, and affordances match across all paths |
| Browser evidence | Run wf-browser or Browser-plugin route checks | UI-visible graph operations and operation animations match backend operation records |

Implementation path:

1. Keep closing duplicate context surfaces first. Any Agent-readable context API
   must delegate to the canonical builder or prove field parity in tests.
2. Expand default workflow skills by semantic trigger phrases and keep generated
   templates, dogfood manifests, Agent init text, and tests synchronized.
3. Add an Agent-run orchestrator only after connected-Agent delegation, retry,
   cancel, timeout, result collation, and Goal/Timer state transitions have a
   durable state machine separate from `workflow.operations.recent[]`.
4. Add scheduler/event delivery only after Timer due events have a durable queue,
   replay/idempotency keys, watchdog recovery, and Agent wake-up semantics.
5. Treat every new node type as incomplete until it has storage, runtime actions,
   ontology entries, context refs, UI handles, settings/workbench UX, browser
   evidence, and readback tests.

## 4. Core Components

### 4.1 CLI Entry

- **Location**: `bin/create-harness-vibe-coding.js`, `src/index.js`
- **Responsibility**: Parse flags, handle interactive/non-interactive modes, print plans/results, and call the generator.
- **Does NOT handle**: Template walking, conflict classification, or file writing internals.

### 4.2 Prompt Layer

- **Location**: `src/prompts.js`
- **Responsibility**: Ask basic interactive npx questions: project name and target directory.
- **Does NOT handle**: Agent-link install intake. That matrix is read by coding agents from `README.md` and `Harness/specs/guides/SETUP.md`.

### 4.3 Generator Core

- **Location**: `src/generator.js`
- **Responsibility**: Resolve optional selections, keep Harness-owned template paths under `Harness/**`, detect conflicts, render templates, register optional workflows, and write files.
- **Critical functions**:
  - `harnessDest()` keeps root entry files at root and Harness-owned files under generated root `Harness/*`.
  - `createPlan()` and `addFileActions()` classify directories and file actions before writes.
  - `registerOptionalContent()` updates generated router/memory docs when optional workflows are selected.

### 4.4 Template Assets

- **Location**: `templates/common/**`, `templates/optional/**`
- **Responsibility**: Define generated `CLAUDE.md`, `AGENTS.md`, `README.md`, `Harness/**`, `.claude/**`, optional skills, and optional workflows.
- **Does NOT handle**: Existing-project decisions. Templates state contracts; generator and agents apply them safely.

### 4.5 Validator

- **Source template**: `templates/common/scripts/validate-harness.mjs`
- **Generated location**: `Harness/scripts/validate-harness.mjs`
- **Responsibility**: Validate required scaffold files, skill/agent registrations, router invariants, optional workflow registrations, and strict project-fact placeholders.

### 4.6 Dogfood Runtime

- **Location**: root `Harness/**`, `.claude/**`, `CLAUDE.md`, `AGENTS.md`, `MEMORY.md`
- **Responsibility**: Govern future AI-agent work in this repository.
- **Does NOT handle**: Changing package output unless edits are made to `templates/**` or source code.

### 4.7 WF-UI Agent-Operable Browser Control Plane

- **Location**: `src/wf-ui-server/wf-browser-store.mjs`, `src/wf-ui-server/ws-wf-browser.mjs`, `src/wf-ui-server/server.mjs`, `src/ui/src/wfBrowserClient.ts`, `src/ui/src/wfBrowserDebug.tsx`, `src/ui/src/wfBrowserRouteCapabilities.ts`, `Harness/scripts/wf-ui-control.mjs`
- **Template location**: `templates/common/Harness/scripts/wf-ui-control.mjs`, `templates/common/.claude/skills/wf-ui/SKILL.md`
- **Responsibility**: Provide the backend foundation, launch URL allocator, frontend debug bridge, visible action primitives, first-party route capability maps, and local browser launch/close lifecycle for `wf-browser` run/window/lease/artifact/command control without coupling it to task parsing, terminal PTY state, or the existing task invalidation WebSocket.
- **Does NOT handle yet**: Trusted screenshot capture from the browser process, browser-process network/AST capture, replay playback UI, automatic close on every closeout path, or deep route-owned capability maps for every nested wf-ui surface.

Data contract:

```text
Harness/wf-browser/
  runs/
    <runId>/
      manifest.json
      timeline.jsonl
      sessions.json
      windows/
        <windowId>/
          window.json
          leases.json
          browser-launches.json
          artifacts.jsonl
          screenshots/
          ui-tree/
          state/
          logs/
          network/
          ast/
          replay/
          analysis/
```

Control rules:

- `POST /api/wf-browser/runs` creates an isolated browser evidence run.
- `GET /api/wf-browser/runs/:runId/windows` lists a run's current window pool for multi-subagent dispatch and handoff.
- `POST /api/wf-browser/runs/:runId/windows` creates a logical browser window slot for one agent, route, viewport, and fixture scope.
- `POST /api/wf-browser/runs/:runId/windows/:windowId/lease` grants `control` or read-only `observe` access.
- A `control` lease is exclusive per window; conflicting mutating agents receive `LEASE_CONFLICT`.
- `GET /api/wf-browser/runs/:runId/windows/:windowId/launch-url` returns the local wf-ui URL with no frontend token and debug-only params: `wfRun`, `wfWindow`, optional `wfLease`, and `wfDebug`.
- `GET /api/wf-browser/connections` lists currently registered frontend debug clients; `Harness/scripts/wf-ui-control.mjs browser-wait` polls it before command dispatch when a launch URL was just opened or refreshed.
- `POST /api/wf-browser/runs/:runId/windows/:windowId/commands` validates the lease, dispatches a bounded `observe.*` or `act.*` command over `/ws/wf-browser`, records action evidence, and stores observation artifacts when applicable.
- `POST /api/wf-browser/runs/:runId/windows/:windowId/artifacts` stores bulky evidence files under the run/window folder and records compact metadata.
- `Harness/scripts/wf-ui-control.mjs browser-open` launches a visible browser for a launch URL, uses an isolated per-run/window profile when `--context isolated` is set, stores launch metadata as an `analysis` artifact, and records local lifecycle state in `browser-launches.json`.
- `Harness/scripts/wf-ui-control.mjs browser-launches` lists per-window launch state with process liveness; `browser-close` closes selected or all launches and safely removes per-window profiles under `Harness/wf-browser/tmp/browser-profiles/`.
- `Harness/scripts/wf-ui-control.mjs browser-release --close true` releases the backend lease and runs local browser cleanup as one closeout command.
- `POST /api/wf-browser/cleanup` previews or removes non-active run folders by retention policy; `Harness/scripts/wf-ui-control.mjs browser-cleanup` exposes this to agents.

Readiness boundary:

- Current implementation is an L3-minimal bridge for wf-browser: the opt-in frontend runtime registers with `/ws/wf-browser`, returns compact route/capability/UI-tree/state/log/network/replay/diff observations, and executes visible hover/click/focus/type/clear/select/press/drag/scroll/wait operations.
- `Harness/scripts/wf-ui-control.mjs browser-snapshot` captures a connected
  window handoff bundle by serially running the standard observation primitives
  through the current lease and returning artifact paths.
- `Harness/scripts/wf-ui-control.mjs browser-wait` is the connection-readiness
  guard: it waits for the requested run/window/agent frontend registration
  before `observe.*`, `act.*`, or snapshot dispatch.
- `Harness/scripts/wf-ui-control.mjs browser-open` is the isolated visible
  launch foundation: it can create a per-window browser profile under
  `Harness/wf-browser/tmp/browser-profiles/`, launch Chrome/Edge/Chromium,
  record the exact command/profile metadata as a run/window artifact, and write
  `browser-launches.json` for later closeout.
- `Harness/scripts/wf-ui-control.mjs browser-launches`, `browser-close`, and
  `browser-release --close true` provide the first local process/profile
  lifecycle layer for visible isolated agent windows.
- `Harness/scripts/wf-ui-control.mjs browser-allocate` is the window allocator foundation: it creates or reuses a run, creates a window, grants a lease, and returns a launch URL for one visible agent window. `browser-allocate-many` repeats that allocation for a batch of subagents in one run, and `browser-windows` lists allocated windows before dispatch, handoff, or cleanup.
- The React app shell registers base wf-browser capabilities for `app.shell`, header, navigation routes, theme toggle, and route-specific task/workflow/agents/roles/settings/terminal surfaces. `observe.uiTree` annotates matched DOM nodes with `registeredCapabilityIds`.
- Claim full L3 only after trusted screenshot/AST coverage and deeper route-owned component maps are implemented.
- Claim full L4 only after automatic cleanup coverage on all closeout paths and
  concurrent isolated-window subagent runtime proof are recorded.

## 5. Data Flow

```text
CLI args / prompts
-> src/index.js parse and display
-> src/generator.js resolve optional catalog
-> walk templates/common and selected templates/optional
-> harnessDest maps source paths to generated destinations
-> createPlan/addFileActions classify create/skip/backup/overwrite/conflict
-> renderTemplate substitutes projectName
-> registerOptionalContent updates generated Harness router/memory
-> write files or return dry-run/json plan
-> tests and generated validator verify behavior
```

## 6. Architectural Constraints

- Do not add generated-output behavior by editing only root `Harness/`; edit `templates/common/**` or `templates/optional/**`.
- Do not add user-facing CLI behavior without tests in `tests/cli-smoke.test.js` or `tests/generator.test.js`.
- Do not add required generated files without updating `templates/common/scripts/validate-harness.mjs` and relevant tests.
- Do not write Harness docs into generated `docs/`; `Harness/` is the generated root for harness-owned docs.
- Do not make root `CLAUDE.md` a dumping ground for build commands, architecture, or release process.

## 7. Known Follow-Up Risks

- Interactive confirmation currently happens before full conflict-plan display in interactive mode.
- Some README tests assert exact prose and can be made more structural.
- `subagent-orchestrator` routing priority should continue to be tightened in templates.

## 8. Agent Terminal Trigger Model

Agent terminals are triggered through three layers, depending on task kind:

1. **Spawn-time task**: `initialPrompt` argv → the runtime TUI auto-submits the initial message (codex/claude positional prompt; opencode `--prompt`). Enter-free, preferred path.
2. **In-session task**: ready-gated injection — wait for the prompt marker (`❯`/`›`), write the text, then a single `\r`; retry once on swallow; never send `\r\n`.
3. **Headless task**: `codex exec --json` (one process per task, JSONL result capture, exit semantics). Interface reserved; full productization later.

The PTY input sink is single: `writePtyInput` → `ptyProcess.write`. Frontend xterm WS `pty:input` and backend `send-input` share it, so a fix at the sink fixes both paths.
