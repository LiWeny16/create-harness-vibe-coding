# Harness Bridge

Purpose: define the first-party browser debug/control bridge used by
`wf-browser`. The bridge makes a web UI agent-operable: the frontend exposes
semantic state and atomic actions, the backend brokers sessions and evidence,
and agents control the browser through scripts or skills instead of brittle DOM
or coordinate guesses.

Harness Bridge is a dev/test/debug capability. Production builds may include an
inert client only when the product explicitly supports operator diagnostics.

## Agent-Operable Web Runtime

The bridge turns the browser into an agent-operable runtime. The agent does not
drive the page primarily through raw DOM selectors, CSS paths, or coordinates.
It asks the backend broker to run small `observe.*` and `act.*` primitives, and
the frontend debug client resolves those primitives against semantic UI
capabilities, component state, and visible user-like interactions.

## Architecture

```text
agent script/skill <-> Harness backend broker <-> WebSocket <-> frontend debug client
```

The frontend is responsible for DOM/component truth, screenshots, UI tree,
visible virtual cursor rendering, and app-state serialization. The backend is
responsible for session identity, window leases, command sequencing, artifact
storage, cleanup, and compact summaries for agents.

## Modules

| Module | Purpose | Output |
| --- | --- | --- |
| UI Capability Contract | stable selectors plus semantic component/action registry | `UI_CONTRACT.md`, route capability manifest |
| API Contract | endpoint, payload, response, failure behavior, side effects | `API_CONTRACT.md` or schema reference |
| Test Data Seeder | deterministic local data and mock external services | seed script or test fixture |
| Frontend Debug Client | WebSocket client, capability registry, virtual cursor, capture primitives | browser connection and command results |
| Backend Control Broker | sessions, window pool, leases, command queue, artifact index | HTTP/WS endpoints and run manifests |
| Observation Primitives | route/UI tree/screenshot/state/log/network/AST capture | artifacts under `Harness/wf-browser/` |
| Action Primitives | atomic visible user-like operations and semantic component commands | action results and replay log |
| Network Trace Collector | frontend/backend request summary and fallback CDP/Playwright traces | JSONL artifact and assertion output |
| Artifact Workspace | screenshots, UI trees, state, logs, network, AST, replay, analysis | `Harness/wf-browser/runs/<runId>/...` |

## UI Capability Contract

Every critical interactive element needs a stable selector and, when source is
editable, a semantic capability entry before UI acceptance.

```tsx
<button
  data-testid="login-submit-button"
  aria-label="Log in"
  data-wf-capability="auth.submit"
>
  Log in
</button>
```

Contract shape:

```markdown
# UI Contract

| Element | Capability ID | data-testid | Role/Label | Actions | State | AC IDs |
| --- | --- | --- | --- | --- | --- | --- |
| Submit button | `auth.submit` | `login-submit-button` | button / Log in | `act.click`, `act.intent(auth.submit)` | disabled/loading/error | AC-004 |
```

No stable target contract, no UI acceptance. `data-testid`, accessible
labels/roles, durable `data-*` keys, and component ids are all valid selectors;
the best first-party contract is a capability id tied to product semantics.

Required coverage targets remain: inputs, buttons, filters, rows,
empty/error/loading states.

## Capability Registry

The frontend debug client should register route, component, element, canvas,
graph, and form capabilities. Each capability describes what an agent can
observe and do.

```ts
type WfBrowserCapability = {
  id: string;
  kind: "route" | "component" | "element" | "canvas" | "graph" | "form";
  label: string;
  selectors?: { testId?: string; selector?: string; role?: string; name?: string };
  keys?: Record<string, string>;
  bounds?: { x: number; y: number; width: number; height: number };
  state?: () => unknown;
  actions?: Record<string, WfBrowserActionSpec>;
  captures?: Array<"screenshot" | "ui-tree" | "state" | "logs" | "network" | "ast" | "replay" | "analysis">;
};
```

Capabilities should expose product intent when possible:

- `graph.moveNode`, `graph.connectNodes`, `graph.openNodeSettings`
- `form.fill`, `form.submit`, `form.assertValidation`
- `table.filter`, `table.sort`, `row.open`
- `canvas.captureRegion`, `canvas.dragPath`

## Observation Primitives

Observation is read-only. Use the smallest useful observation first.

| Primitive | Output |
| --- | --- |
| `observe.route` | URL, route id, viewport, title, feature flags |
| `observe.capabilities` | current route/window capability registry |
| `observe.uiTree` | compressed semantic tree: role/name/testId/dataAttrs/registeredCapabilityIds/bounds/state |
| `observe.screenshot` | viewport, full page, component, element, or region image |
| `observe.state` | selected app stores, router state, component state |
| `observe.logs` | console, error boundary, unhandled rejection, app logs |
| `observe.network` | request/response summary, status, timings, payload keys |
| `observe.replay` | bounded primitive timeline with command ids, statuses, targets, and deltas |
| `observe.ast` | source/component metadata in dev builds |
| `observe.diff` | before/after UI, state, network, or log comparison |

### State Snapshot Contract

Observation payloads must distinguish references from renderable state:

- `stateRef`, `contentRef`, and `componentStateRefs` are references. They may
  include path, revision, type, title, handles, capabilities, and compact file
  metadata, but they must not be treated as complete UI state.
- UI hydration snapshots must include full renderable component state under a
  dedicated state collection such as `componentNodes`. A route that paints
  previews or editors from a snapshot must not infer persisted content from refs.
- If a persisted component node is present but its hydration state is missing,
  malformed, or revision-mismatched, global route observations should omit that
  component and dangling edges while direct component reads expose the mismatch
  error. The backend must not crash the whole observation and must not silently
  replace persisted content with empty Markdown, empty Excalidraw scenes, or
  empty file metadata.
- Tests that mock observations must mirror the production state contract:
  `Harness/a2a/component-nodes/<nodeId>/state.json`, matching revisions across
  refs and hydration state, and type-specific handles from the backend model.
- Connection refs in observations must mirror production graph semantics:
  default workflow links use `direction: "bidirectional"` plus
  endpoint-specific `endpointRole`, while persisted `from`/`to` or
  `source`/`target` fields remain endpoint-order metadata for rendering and
  handles.
- Mocked graph snapshots must include `edgeId`, `localHandle`, `peerHandle`,
  `sourceHandle`, `targetHandle`, semantic `relation`, and reverse-duplicate
  rejection behavior. Display labels such as `markdown <-> context` are UI text
  and must not be reused as `relation`.
- Resource-node observations must distinguish semantic ports from physical
  handles. Markdown exposes semantic port `markdown`; Excalidraw exposes
  semantic port `scene`. The browser may expose side handles such as
  `markdown:left`/`markdown:right` or `scene:left`/`scene:right` for geometry,
  but observations, labels, and agent context must report the semantic resource
  port. Markdown and Excalidraw must not be mocked as separate input/output
  ports. A bidirectional physical side must appear as one DOM/UI-tree handle;
  hidden overlapping source/target handles for the same side are invalid because
  they make drag hit-testing ambiguous.
- Event-node observations may expose explicit directed event edges. Timer uses
  `direction: "source-to-target"`, relation `event`, a local `event` output, a
  `config` input, and event refs such as `eventStateRefs` and
  `connectedEventRefs`. This directed contract is limited to event emission and
  must not be inferred for resource or capability links.
- Advanced Timer observations may include base heartbeat, watchdog heartbeat,
  once/interval/cron/loop/adaptive/watchdog/while/task cadence metadata, task
  binding, and control policy. Agent-observed Timer control actions require an
  Agent-to-Timer relation `control` edge. While/loop/task/adaptive metadata is
  declarative only; UI and runtime bridges must not evaluate user-authored code
  from Timer settings.
- Double-clicking a Timer node opens `workflow-timer-expanded-node`; schedule
  saves go through typed `timer.configure` actions rather than direct state-file
  edits.
- Goal-node observations expose active Harness task state as `workflow-goal-node`
  plus `goalNodes`/`connectedGoalRefs`. Agent completion is two-phase:
  `goal.requestCompletion` writes a proposal sidecar and must not directly mark
  task `STATE.json` complete. WDT acknowledgement is tracked separately from
  task completion state.
- Double-clicking a Goal node opens `workflow-goal-expanded-node`; user edits
  go through `goal.update` without `actorNodeId`, while Agent-authored
  `goal.update` calls require a bidirectional `goal` edge and must reject
  unlinked actors with `GOAL_EDGE_REQUIRED`. `goal.update` edits title,
  objective, next action, acceptance, and WDT metadata only; task status,
  phase, gate, and completion transitions are outside this action.
- Browser tests must exercise real drag/connect behavior for resource ports.
  Intent-only graph actions are not sufficient proof that ReactFlow hit targets
  can receive a manual connection on the requested physical side.
  Tests must assert both the semantic edge payload and the actual DOM handle
  count for bidirectional resource nodes.
- Agent capability observations must expose config-attached Skills as
  `connectedCapabilityRefs`, `effectiveSkills`, and `skillPolicy`. Skill refs
  are metadata only, use relation `capability`, preserve
  `direction: "bidirectional"`, and must not include skill bodies, absolute
  local paths, command output, secrets, or MCP credential probes.
- Agent context observations must expose self `identity`, self `workspace`, and
  `skillTriggers` in addition to connected refs. `workflow-context` and
  `agent.readContext` must return the same canonical context fields so Agents
  do not reason from a reduced terminal-only view.
- Skill group capability-node observations must expose the node as
  `workflow-capability-node` with `data-skill-count`, one semantic bidirectional
  `capability` port, and physical side handles `capability:left` and
  `capability:right`. Connected Agent observations must include
  `connectedCapabilityNodeRefs`, merged `connectedCapabilityRefs`, and
  `effectiveSkills` without skill bodies, absolute local paths, command output,
  secrets, or MCP credential probes.
- Skills Hub group creation uses `workflow-capability-hub-group` plus
  `workflow-capability-create-node`. The resulting edge to an Agent, when a
  target Agent exists, is relation `capability`, direction `bidirectional`, and
  executor `agent`; group creation from a no-target Hub creates only the
  capability node.
- MCP Hub observations are metadata-only. They may expose project-scoped server
  names, transports, command names, arg counts, redacted URLs, env key names,
  source summaries, and safety flags. They must not expose secret values, spawn
  MCP servers, or probe credentials.
- MCP connector creation uses `workflow-capability-create-node` from an MCP Hub
  item and sends only `mcpServerId`. The resulting node must render as
  `workflow-capability-node` with `data-capability-type="mcp-connector"`,
  `data-server-count`, one semantic bidirectional `capability` port, and
  physical side handles `capability:left` and `capability:right`. If a target
  Agent exists, creation also writes a relation `capability`, direction
  `bidirectional` edge to that Agent.
- MCP direct attach, credential checks, tool-list discovery, and tool invocation
  remain gated and must not be enabled by the Hub create path.

The default UI tree is compressed. Full DOM, full AST, large screenshots, videos,
and network bodies must be artifact files, not chat content.

## Action Primitives

Actions mutate state or visible UI. Every action is atomic and returns a settled
result with before/after observation ids.

| Primitive | Purpose |
| --- | --- |
| `act.intent` | semantic app command, for example `graph.connectNodes` |
| `act.click` | visible virtual-cursor click on a resolved target |
| `act.contextMenu` | visible virtual-cursor right-click/contextmenu on a resolved target |
| `act.focus` | focus a resolved input, editable region, listbox, or terminal surface |
| `act.type` | focus target and type text |
| `act.clear` | clear a resolved text/editable target |
| `act.press` | key or shortcut |
| `act.scroll` | scroll viewport, element, or region |
| `act.hover` | move virtual cursor and show hover state |
| `act.drag` | drag target to target, point, or path |
| `act.doubleClick` | open the target node's primary workbench without opening lightweight settings |
| `act.select` | choose menu/listbox/combobox option |
| `act.upload` | file chooser fallback when supported |
| `act.wait` | wait for route, state, network, selector, or event |
| `act.replay` | replay a recorded action sequence |

Semantic workflow graph intents:

| Intent | Meaning |
|---|---|
| `graph.createNode` | create one workflow runtime node through the typed node API |
| `graph.connectNodes` | create one semantic workflow edge |
| `graph.disconnectNodes` | remove one semantic workflow edge |
| `graph.moveNode` | persist one node position change |
| `graph.deleteNode` | delete or hide one workflow node through the typed node API |
| `graph.deleteNodes` | delete or hide multiple workflow nodes through the typed node API |

Rules:

- A semantic graph intent performs one semantic mutation request. It must not
  combine a node/edge API mutation with a second full graph-map PUT for the same
  intent.
- Successful graph intents return operation metadata with at least
  `{ id, kind }`.
- When an Agent is the actor, the implementation should use the matching
  `agent.*` graph action and the resulting operation record should drive canvas
  aura, controlled-node glow, and edge data-flow animation.
- Agent node-map skills and CLI commands must route graph mutations through the
  typed backend Agent actions at
  `POST /api/workflow/nodes/:actor/actions/agent.*`. `Harness/a2a/workflow-map.json`,
  component state, event/capability/goal state, and node-home files are
  backend-owned storage. Agents may inspect them only as diagnostic context and
  must not edit/delete them to control the canvas.
- Compatibility commands such as `wf-ui-control.mjs connect` and
  `wf-ui-control.mjs delete-node` must delegate to `agent.connectNodes` and
  `agent.deleteNode`; they must not perform whole-map PUTs or call legacy
  graph-node delete routes directly.
- Agent delete intents use `agent.deleteNode` or `agent.deleteNodes`; they must
  not delete the actor itself, and bulk delete skips the actor and live Agents by
  default unless a future explicit permission model says otherwise.
- Visual control state must be derived from operation metadata, not from DOM
  gestures, edge direction, node type, or handle geometry.

Result shape:

```json
{
  "commandId": "cmd-001",
  "agentId": "agent-a",
  "sessionId": "session-001",
  "windowId": "window-001",
  "runId": "run-001",
  "leaseId": "lease-001",
  "status": "ok",
  "target": { "capabilityId": "auth.submit", "testId": "login-submit-button" },
  "before": "artifacts/state/before.json",
  "after": "artifacts/state/after.json",
  "events": ["artifacts/logs/action-events.jsonl"],
  "screenshot": "artifacts/screenshots/after.webp"
}
```

## Visible Agent Operation

The frontend debug client should render agent activity without using or stealing
the user's real pointer:

- one virtual cursor per `agentId`
- hover outlines, click pulses, and drag paths
- typing focus ring and operation label
- rejected target/drop markers
- optional operation feed or timeline overlay

If the real user interacts with the same window, the frontend reports a
mixed-control event. The backend then pauses or releases the agent lease.

## Backend Broker Protocol

Recommended channels:

- HTTP: create/list runs, allocate launch URLs, list artifacts, read compact
  snapshots, cleanup.
- WebSocket: frontend registration, command dispatch, acks/results, events,
  heartbeats, and lease lifecycle.
- Fallback driver: Playwright/CDP/Browser Use/MCP for pages without the
  first-party client.

Message types:

- `hello`
- `lease.request`
- `lease.granted`
- `lease.release`
- `command`
- `ack`
- `result`
- `event`
- `heartbeat`
- `artifact`

WebSocket messages must be bounded because browser WebSocket has no
backpressure. Large data goes to disk; WebSocket carries ids, paths, hashes,
sizes, and short summaries.

## Multi-Agent Window Contract

Multiple subagents must be able to debug different features concurrently.

- Each subagent owns an `agentId`, `sessionId`, `windowId`, `runId`, and
  `leaseId`.
- A control lease is exclusive per window. Two agents must not run `act.*` in
  the same window at the same time.
- Read-only `observe.*` may share a window only under a read-only lease.
- The backend should provide a window pool: create, assign, list, release, and
  cleanup.
- Each run stores artifacts separately:
  `Harness/wf-browser/runs/<runId>/windows/<windowId>/...`.
- Test data must be isolated when multiple agents mutate backend state.
- The task plan records which subagent owns which feature/window/data fixture.

Window-pool operations:

| Operation | Purpose |
| --- | --- |
| `window.create` | open a new browser window/context for an agent, route, viewport, and fixture scope |
| `window.allocateMany` | create multiple independent window/lease/launch URL assignments for concurrent subagents |
| `window.open` | launch a visible browser window using a per-run/window profile and store launch metadata |
| `window.close` | list/close selected browser launches and remove per-window profiles during release or cleanup |
| `window.assign` | bind an idle existing window to an `agentId` and `runId` |
| `window.lease` | grant `control` or `observe` access with expiry and renew policy |
| `window.launchUrl` | return a loopback UI URL with token, run/window/lease ids, agent id, and debug overlay flags |
| `window.snapshot` | capture compact route, capability, UI tree, state, log, network, replay, and diff observations before handoff |
| `window.release` | stop command intake, flush artifacts, and mark the lease released |
| `window.list` | list a run's current windows for subagent dispatch and handoff |
| `window.wait` | wait until a target frontend window registers on the WebSocket bridge before observe/act dispatch |
| `window.cleanup` | remove unreferenced artifacts and browser profiles after retention rules pass |

Subagent dispatch packets should include `agentId`, `runId`, requested
`windowId` or `window.create` requirements, allowed route/feature scope,
fixture scope, and whether the subagent may run `act.*` or only `observe.*`.
The backend rejects `act.*` commands when the `leaseId` is missing, expired,
read-only, or owned by another agent. This is the concurrency guard that allows
many subagents to test many features at once without two agents mutating the
same browser window.

## Third-Party Pages

When source cannot be changed:

1. Inject a lightweight debug client when possible.
2. Generate a temporary semantic tree from accessibility roles, labels, visible
   text, bounds, and editable state.
3. Let the agent add temporary target aliases for the current run.
4. Use Playwright, CDP, Browser Use, or Playwright MCP only for unsupported
   navigation, native input, permissions, screenshots, downloads, or hostile
   pages.

The output shape must still match the first-party artifact and action-result
schema.

## Artifact Workspace

Default layout:

```text
Harness/wf-browser/
  README.md
  runs/
    <runId>/
      manifest.json
      timeline.jsonl
      sessions.json
      windows/
        <windowId>/
          browser-launches.json
          actions.jsonl
          screenshots/
          ui-tree/
          state/
          logs/
          network/
          ast/
          replay/
          analysis/
```

Retention:

- Keep latest 20 runs or 7 days by default.
- Keep artifacts referenced by an active task until closeout.
- Cleanup should be command-driven through
  `node Harness/scripts/wf-ui-control.mjs browser-cleanup`.
- Do not store large artifacts in `Harness/tasks/` or chat.

Default local debugging is trusted and open. No automatic redaction is required
unless a project policy or user instruction asks for it. Do not publish artifacts
outside the workspace without explicit user approval.

## API Contract

API-facing ACs need method, URL, payload, success response, failure response, and
side effects.

````markdown
# API Contract

## POST /api/auth/send-code

Request:
```json
{ "phone": "13800138000" }
```

Success:
```json
{ "ok": true }
```

Failure:
```json
{ "ok": false, "message": "Invalid phone number" }
```
````

No API contract, no backend integration acceptance.

## Test Data Seeder

Concurrent browser validation must not depend on shared mutable fixtures unless
that is the behavior under test.

Example contract:

```ts
await bridge.seed({
  runId,
  windowId,
  user: {
    phone: "13800138000",
    code: "123456"
  }
});
```

Seeder requirements:

- deterministic
- resettable between tests
- scoped by run/window/agent where needed
- records seeded IDs needed for assertions

## Fallback Network Trace Collector

For frontend-backend ACs, collect network evidence from the bridge first and
fallback CDP/Playwright traces when the bridge is unavailable.

Minimum checks:

- request sent or intentionally not sent
- method and URL
- payload shape and key values
- response handling
- disabled/loading behavior prevents duplicate submission
- error state for network failure

Trace evidence belongs under `Harness/wf-browser/runs/<runId>/network/` or
Playwright `test-results/` when using fallback tests.
