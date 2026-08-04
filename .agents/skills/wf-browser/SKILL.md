---
name: wf-browser
description: Built-in agent-operable web UI architecture and runtime-control workflow. Use for /wf-browser, $wf-browser, designing UI debug/control bridges, UI capability contracts, WebSocket control loops, browser automation, UI debugging, screenshots, logs, multi-window/subagent browser testing, Playwright/CDP fallback, and browser-visible acceptance.
---

# WF Browser

`wf-browser` is the Harness design contract for web UIs that agents can
understand, control, debug, verify, and replay. It is not primarily a
Playwright/CDP wrapper. Playwright, CDP, Browser Use, Playwright MCP, and
external browser agents are fallback drivers. The preferred path is a first-party
Agent-Operable Web Runtime:

```text
agent script/skill <-> Harness backend broker <-> WebSocket <-> frontend debug client
```

The goal is to make the web page a human-visible, agent-controllable, and
system-recorded runtime. If project source can be changed, improve the UI
control contract before writing brittle browser scripts.

## Two Jobs

Use `wf-browser` for both sides of the same system:

1. **Architecture design**: design a web app so agents can later observe,
   control, debug, verify, and replay it through stable first-party contracts.
2. **Runtime control**: operate that designed app through the Harness backend
   broker, WebSocket frontend debug client, atomic actions, and artifact
   evidence.

An invocation may be design-only, control-only, or design-then-control. If the
project source is editable and the UI is not controllable, prefer improving the
architecture contract before writing fallback Playwright/CDP scripts.

## Readiness Levels

Use these levels to classify the current web surface and choose the next move:

| Level | Name | Meaning |
| --- | --- | --- |
| L0 | Fallback-only | third-party or uneditable page; use injection, accessibility tree, Playwright/CDP, or Browser Use |
| L1 | Selector-ready | critical UI has stable `data-testid`, accessible labels/roles, durable keys, and visible states |
| L2 | Capability-ready | frontend exposes semantic capability ids, serializable state, supported actions, and captures |
| L3 | Bridge-ready | WebSocket debug client and backend broker support `observe.*`, `act.*`, artifacts, logs, network, and replay |
| L4 | Multi-agent-ready | window pool, leases, isolated fixtures, run partitioning, cleanup, and mixed-control handling exist |

Do not claim L3 without a working frontend/backend bridge. Do not claim L4
without lease enforcement that prevents two agents from mutating the same window.

## Load

- `CLAUDE.md`
- `Harness/MEMORY.md` index only per Memory Preflight
- `Harness/README.md`
- `Harness/specs/protocols/HARNESS_BRIDGE.md`
- For architecture comparison or skill-design review, load
  `references/BROWSER_CONTROL_PATTERNS.md`.
- Project run/build/test instructions
- Existing UI contracts, API contracts, component docs, and route ownership
- Fallback driver docs only when needed: Browser Use, Playwright, CDP, or MCP

## Mode Selection

Start by deciding which track applies:

- **Architecture Design Track**: use when building or refactoring a web app,
  creating UI/API contracts, adding debug infrastructure, designing an agent
  control surface, or making a feature testable.
- **Runtime Control Track**: use when a browser-visible flow must be operated,
  debugged, verified, replayed, or captured with evidence.
- **Recovery Track**: use when runtime control fails because selectors,
  capabilities, bridge messages, logs, screenshots, fixtures, or leases are
  missing; return to architecture design for the smallest contract fix.

## Cache Discipline

Follow `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`.
Keep stable protocol docs first, then append only the current run id, window id,
artifact paths, compact UI tree excerpts, failing actions, and high-signal logs.
Do not paste full screenshots, full DOM trees, videos, network dumps, or long
event streams into task state. Store them under `Harness/wf-browser/` and cite
paths.

## External Pattern Anchors

Use external browser-agent patterns as references, not as the Harness contract.
For the current comparison, tradeoffs, and skill-design notes, read
`references/BROWSER_CONTROL_PATTERNS.md`.

## Design Principle

Every agent-browser loop has two primitive families:

1. `observe.*`: gather truth from the frontend and backend.
2. `act.*`: perform visible, atomic, human-like operations.

Do not make the agent infer component intent from CSS, DOM depth, or coordinates
when the project can expose a semantic capability. Coordinates are fallback
inputs after a target has been resolved through the UI tree or visual markup.

## Architecture Design Track

When the task is design/build/refactor, produce an agent-operable architecture
before planning browser scripts.

Required design outputs:

- Route inventory: route ids, feature ownership, expected app states, and
  backend dependencies.
- Capability map: stable capability ids for route, component, form, table,
  graph, canvas, and element targets.
- UI contract: selectors, accessible labels/roles, durable keys, visible states,
  supported `act.*` operations, and `observe.*` captures.
- State contract: serializable app stores, router state, component state,
  domain ids, and state diff rules.
- Backend broker contract: run/session/window/lease identity, HTTP endpoints,
  WebSocket message types, command queue, timeouts, and artifact index.
- Fixture contract: seeded data, reset rules, per-agent isolation, and backend
  side effects.
- Evidence contract: screenshot, UI tree, state, logs, network, AST, replay,
  analysis, and retention paths under `Harness/wf-browser/`.
- Fallback contract: what remains under Playwright/CDP/Browser Use/MCP when the
  first-party bridge cannot handle a browser capability.

The design is incomplete if it answers only "how will the agent click?" It must
also answer how the agent locates targets, observes truth, waits for settlement,
detects errors, explains visible operation to the user, replays actions,
isolates concurrent agents, and cleans up artifacts.

## Runtime Control Track

When controlling an existing page, execute a closed loop:

1. Create or resume a run and acquire `agentId`, `sessionId`, `windowId`,
   `runId`, and `leaseId`.
2. Run `observe.route`, `observe.capabilities`, `observe.uiTree`, and focused
   logs/network/state observations before acting.
3. Resolve targets by capability id, durable ids, `data-testid`, and accessible
   labels/roles before falling back to text or coordinates.
4. Run one atomic `act.*` command at a time with visible virtual cursor feedback
   when the operation matters to the user.
5. Wait for settlement by route, state, network, selector, or capability event.
6. Capture after-state and `observe.diff`; store artifacts under the current
   run/window folder.
7. Decide pass/fail/blocked/unsupported from evidence, not from command success
   alone.
8. Release leases and clean up unreferenced windows/artifacts when done.

If any step cannot run because the bridge lacks a primitive, record the missing
contract and either add the first-party capability or normalize fallback driver
output into the same run layout.

## Control Reliability Rules

Use these rules when a source-editable UI is flaky under browser control:

- Do not return `ok` from `act.*` until the UI and backend have settled. Acks are
  not acceptance; wait for DOM/state/network/capability evidence after the act.
- Graph and canvas routes must expose a readiness signal after layout, fitView,
  async previews, and at least one paint. Coordinate gestures must wait for that
  signal before sampling bounds or moving the virtual cursor.
- If an app server serves built assets, rebuild before browser acceptance and
  confirm the browser is reading the current artifact. Stale `dist` makes good
  source fixes look broken.
- Every declared component port, handle, or capability must have a real
  targetable UI handle or an explicit normalization rule. Semantic graph edges
  that reference non-rendered handles are contract failures.
- Layering is part of the UI contract. Node controls must be hit-testable above
  edge labels; edge labels above paths; menus, panels, toasts, and fullscreen
  editors above canvas chrome according to declared z-index tiers.
- Visible overlays used as evidence must be hit-testable unless they are
  explicitly click-through. Modal or fullscreen close actions must immediately
  release the controlled surface, even if open animations remain.
- Prefer deterministic status hooks or capabilities for overlay/error states
  instead of manufacturing accidental failures only to make a toast appear.

## Browser Evidence Contract

Every browser-visible claim needs evidence from the control loop or a fallback
driver:

1. URL, route, viewport, browser/window id, agent id, run id, and window lease.
2. Stable selector or semantic target contract using `data-testid`, accessible
   labels/roles, component ids, route ids, and durable item keys.
3. Action evidence: command payload, ack/result, before/after observations, and
   virtual cursor or operation trace when visual behavior matters.
4. Frontend state, console logs, runtime errors, network summaries, and backend
   side effects.
5. Screenshot, UI tree, state snapshot, event timeline, replay log, or fallback
   Playwright/CDP trace path.
6. AC-by-AC validation matrix when acceptance criteria exist.

No stable target contract, no UI acceptance. No API contract, no backend
integration acceptance. Syntax-only checks cannot satisfy browser-visible ACs.

## Design-To-Control Continuity

Every architecture contract must have a runtime proof path:

| Design item | Runtime proof |
| --- | --- |
| capability id | `observe.capabilities` lists it and `act.intent` or target action can use it |
| selector/state contract | `observe.uiTree` shows target, state, bounds, role/name, and durable ids |
| broker message | WebSocket `ack` and `result` include command id, lease id, status, and artifact ids |
| fixture contract | run manifest records seed ids and backend side effects |
| visual operation | screenshot or cursor trail shows hover/click/type/drag path |
| concurrency rule | lease log proves rejected conflicting `act.*` or isolated window ownership |
| fallback path | Playwright/CDP/MCP evidence is normalized into `Harness/wf-browser/` |

Do not let design docs and runtime scripts drift. If an agent cannot control a
designed capability, update the capability contract or mark the level lower.

## Agent-Operable UI Contract

UI built for `wf-browser` must expose targetable, user-meaningful controls and
agent-readable capabilities.

| Category | Required control surface |
| --- | --- |
| Inputs | `<label>` association or `aria-label`, `data-testid`, value/invalid/disabled/loading state, deterministic placeholder only as fallback |
| Buttons | accessible name, `data-testid`, disabled/loading state, no icon-only button without `aria-label`, command outcome |
| Filters | stable test id for input/menu/chip, selected state, clear/reset action, result count or empty state |
| Rows/items | stable row/item test id, durable key such as `data-row-id`, selectable state, row actions; avoid index-only targeting |
| Complex widgets | component id, semantic role, supported `act.*` operations, serializable state, bounds, child capabilities |
| Empty state | visible empty container with `data-testid="empty-state"` or feature-specific equivalent |
| Error state | inline error/toast/banner with stable test id, accessible role when appropriate, error code/source |
| Loading state | stable spinner/skeleton/progress test id; verify duplicate submit prevention |

Required coverage targets: inputs, buttons, filters, rows, empty/error/loading states.

Selector priority:

1. Component capability id or domain id (`componentId`, `nodeId`, `routeId`)
2. `data-testid` and durable `data-*` keys
3. accessible labels/roles
4. visible text for stable user-facing copy
5. coordinates only after one of the above resolves the target

Do not use generated class names, brittle CSS chains, XPath, DOM index selectors,
or raw coordinates as the primary test contract.

## Capability Registry

First-party frontends should register capabilities with the debug client. A
capability describes what an agent can observe and do, not just how the DOM
looks.

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

Examples:

- Graph editor: `graph.moveNode`, `graph.connectNodes`, `graph.openNodeSettings`,
  `graph.snapshot`.
- Form: `form.fill`, `form.submit`, `form.reset`, `form.assertValidation`.
- Table: `table.filter`, `table.sort`, `row.open`, `row.select`, `row.action`.
- Canvas: `canvas.markup`, `canvas.dragPath`, `canvas.captureRegion`.

## Observation Primitives

Use focused observations first; expand only when the first signal is
insufficient.

| Primitive | Purpose | Output |
| --- | --- | --- |
| `observe.route` | current URL, route id, title, viewport, feature flags | compact JSON |
| `observe.capabilities` | agent-operable registry for current route/window | compact JSON |
| `observe.uiTree` | semantic UI tree: role/name/testId/dataAttrs/registeredCapabilityIds/bounds/state | JSON artifact |
| `observe.screenshot` | viewport, full page, element, component, or region image | image artifact |
| `observe.state` | selected app stores, router state, component state | JSON artifact |
| `observe.logs` | console, frontend error boundary, unhandled rejection, custom app logs | JSONL artifact |
| `observe.network` | request/response summary, payload keys, status, timings | JSONL artifact |
| `observe.replay` | bounded primitive timeline with command ids, statuses, targets, and deltas | JSON artifact |
| `observe.ast` | source/component metadata when available from dev build | JSON artifact |
| `observe.diff` | before/after UI/state/network comparison | JSON artifact |

The default UI tree is compressed. Include only visible or agent-relevant nodes
unless the task explicitly asks for a full DOM/AST dump.

## Action Primitives

Actions are atomic and return a settled result. Prefer semantic actions exposed
by the app, then target-based UI actions, then visual/coordinate actions, then
fallback drivers.

| Primitive | Purpose |
| --- | --- |
| `act.intent` | route/component semantic command such as `connectNodes` |
| `act.click` / `act.contextMenu` | virtual-cursor click or right-click on a resolved target |
| `act.focus` | focus a resolved input, editable region, listbox, or terminal surface |
| `act.type` | focus target and type text with visible cursor/focus trail |
| `act.clear` | clear a resolved text/editable target |
| `act.press` | keyboard key or shortcut |
| `act.scroll` | scroll target, viewport, or region |
| `act.hover` | move virtual cursor and show hover state |
| `act.drag` | drag target to target/point/path with visible trajectory |
| `act.select` | choose menu/listbox/combobox option |
| `act.upload` | file chooser fallback when supported |
| `act.wait` | wait for route, state, network idle, selector, or capability event |
| `act.replay` | replay a recorded action sequence against a window lease |

Every action result should include:

- `commandId`, `agentId`, `sessionId`, `windowId`, `runId`, `leaseId`
- target resolution details, including stable `data-*` attrs when available
- before/after observation ids
- event/log/network deltas
- screenshot or cursor trail path when visual behavior matters
- status: `ok`, `failed`, `blocked`, or `unsupported`

## Visible Agent Operation

The frontend debug client should draw agent activity independently of the user
mouse:

- virtual cursor per `agentId`, with label/color and current operation
- hover target outline and click pulse
- drag path, drop target, and rejected-drop marker
- typing focus ring and redacted text only if the project asks for redaction
- operation timeline panel or event feed when the debug overlay is enabled

The virtual cursor is explanatory UI. It must not steal the user's pointer. If a
real user interacts with the same window, the backend must record the collision
and either pause the agent lease or mark the run as mixed-control.

## Backend Broker

The backend owns sessions, leases, evidence, and fan-out. The frontend owns DOM,
component state, screenshots, and visible operation rendering.

Recommended channels:

- HTTP for run creation, artifact listing, cleanup, and stable snapshots.
- WebSocket for frontend registration, command dispatch, acks/results,
  heartbeats, and live events.
- Optional fallback driver channel for Playwright/CDP/Browser Use when the
  target page cannot load the first-party debug client.

Core message types:

- `hello`: frontend registers route/window/capabilities.
- `lease.request` / `lease.granted` / `lease.release`: exclusive control per
  window.
- `command`: backend asks frontend to run one `observe.*` or `act.*` primitive.
- `ack`: frontend accepted or rejected the command shape.
- `result`: frontend completed the command and attached artifact ids.
- `event`: logs, errors, network, route changes, dialogs, downloads, user
  collisions.
- `heartbeat`: liveness and buffered queue size.
- `artifact`: metadata for a stored screenshot/tree/state/log/network file.

WebSocket messages must be bounded. Browser WebSocket has no backpressure, so
large screenshots, UI trees, AST dumps, and videos are stored as files under
`Harness/wf-browser/`; messages carry metadata and paths.

## Multi-Agent Window Contract

Multiple subagents must be able to debug different features at the same time.
Concurrency is protocol-level, not an afterthought.

- Each subagent gets its own `agentId`, `sessionId`, `windowId`, `runId`, and
  `leaseId`.
- A control lease is exclusive for a window. Two agents must not send `act.*`
  commands to the same window concurrently.
- Read-only `observe.*` may share a window only when the backend labels the
  lease as read-only and the frontend can guarantee no state mutation.
- The backend should provide a window pool: create, list, assign, release, and
  cleanup windows.
- Runs are artifact-isolated:
  `Harness/wf-browser/runs/<runId>/windows/<windowId>/...`.
- Cross-agent coordination belongs in the task plan: which feature/window each
  subagent owns, which data fixtures they may mutate, and how results merge.
- If two agents need the same global app state, seed separate test data or
  separate browser contexts before dispatch.

Use `HARNESS_BRIDGE.md` for the full window-pool operation table. The minimum
runtime set is create/open, list, wait, lease, snapshot, release, close, and
cleanup.

Dispatch packets for subagents should include `agentId`, `runId`, intended
`windowId` or `window.create` requirements, allowed routes/features, fixture
scope, and whether the subagent may run `act.*` or only `observe.*`. The backend
must reject an `act.*` command whose `leaseId` is absent, expired, read-only, or
owned by another agent.

## Third-Party Pages

For third-party pages or apps whose source cannot be changed:

1. Try an injected lightweight debug client that builds a temporary semantic
   tree from accessibility roles, labels, visible text, bounds, and editable
   state.
2. Let the agent add temporary tags or aliases to targets for the current run.
3. Use Playwright MCP, Browser Use, CDP, or another browser driver as a fallback
   for navigation, native input, permissions, screenshots, downloads, and pages
   that block injection.
4. Keep the same artifact and action-result shape so first-party and third-party
   evidence remains comparable.

Third-party control will always be noisier. If the project source is available,
fix the UI contract instead of writing complex selector scripts.

## Artifact Workspace

`Harness/wf-browser/` is the browser evidence workspace. Store high-volume
runtime data there, not in chat or task summaries.

Use the stable layout
`Harness/wf-browser/runs/<runId>/windows/<windowId>/...` with subfolders for
screenshots, ui-tree, state, logs, network, ast, replay, and analysis.

Retention:

- Keep the latest 20 runs or 7 days by default.
- Keep artifacts referenced by an active task until closeout.
- Use `node Harness/scripts/wf-ui-control.mjs browser-cleanup` to preview or
  apply retention through the backend cleanup API.
- Never write unbounded screenshots, full DOM, or network bodies to task files.

Default local debugging is trusted and open. Do not redact screenshots, logs,
network payloads, or state unless the project or user asks for redaction. Do not
publish artifacts outside the workspace without explicit user approval.

## Fallback Drivers

Use fallback drivers only for capabilities the first-party bridge cannot yet
provide:

- Playwright: repeatable E2E smoke, browser contexts, real navigation, trace
  capture, and compatibility checks.
- CDP: low-level browser diagnostics, console/runtime/network details, native
  screenshot or page snapshot, permissions, downloads, and hard browser facts.
- Browser Use or Playwright MCP: exploratory control of third-party pages and
  accessibility-snapshot workflows.

Fallback output should be normalized into the same run/window artifact layout.

## Quality Gates

Before calling a `wf-browser` result complete, verify the relevant gates:

- Design gate: readiness level assigned; route/capability/UI/state/broker/
  fixture/evidence/fallback contracts exist for the requested scope.
- Control gate: real run id, window id, lease id, observations, atomic actions,
  settlement, diffs, artifacts, and release status are recorded.
- Stability gate: selectors and capability ids are durable; no generated class,
  XPath, DOM index, or raw coordinate is the primary target contract.
- Concurrency gate: subagent/window ownership is explicit; conflicting write
  actions are rejected or avoided.
- Adaptability gate: first-party, third-party, local, CI, headed, headless,
  desktop, and mobile viewport constraints are classified.
- Cleanup gate: high-volume artifacts remain in `Harness/wf-browser/`, retained
  only while useful, and task files contain paths and summaries.

## Return

When returning from `wf-browser`, include:

- mode used: architecture design, runtime control, recovery, or mixed
- readiness level before and after the work
- design outputs updated: route inventory, capability map, UI contract, broker
  contract, fixture contract, evidence contract, and fallback contract
- run id, session/window ids, and whether each window lease was released
- commands/scripts run
- capabilities used and targets controlled
- artifact paths under `Harness/wf-browser/`
- verified flows and AC matrix
- failures, unsupported primitives, and fallback driver use
- cleanup performed or artifacts intentionally retained
