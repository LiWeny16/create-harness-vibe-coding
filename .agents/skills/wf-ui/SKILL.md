---
name: wf-ui
description: Codex compatibility: use $wf-ui or /skills wf-ui in Codex. In Claude Code and OpenCode, /wf-ui is a direct command that starts the local Harness browser control panel.
---

# WF-UI Adapter

This skill is a Codex compatibility shim for opening the Harness control panel.
Claude Code and OpenCode handle `/wf-ui` as a direct command. Do not route this
through WF mode.

## Invocation

- Codex CLI or IDE: use `$wf-ui` or `/skills` then choose `wf-ui`.
- Claude Code: `/wf-ui` is a direct command from `.claude/commands/wf-ui.md`.
- OpenCode: `/wf-ui` is a direct command from `.opencode/commands/wf-ui.md`.

## Load

No router preload. Read only the local command file above when this runtime
needs the exact direct command text.

## Cache Discipline

Keep the context to the command, current project root, and returned local URL.
Do not paste full API responses, accessibility trees, or terminal transcripts.

## Startup

Run from the project root:

```text
create-harness-vibe-coding wf-ui --project . --host 127.0.0.1 --port 0 --open --detach
```

If you are inside the generator source repository and the global binary is not
available, use:

```text
node bin/create-harness-vibe-coding.js wf-ui --project . --host 127.0.0.1 --port 0 --open --detach
```

Otherwise use:

```text
npx create-harness-vibe-coding@0.8.20 wf-ui --project . --host 127.0.0.1 --port 0 --open --detach
```

Rules:
- Bind only to `127.0.0.1`; never `0.0.0.0`.
- Default port `0` for an OS-assigned free port.
- Generate a random one-time token.
- Open `http://127.0.0.1:<port>/?token=<token>`.
- Detach the server so command timeouts do not stop the control panel.

## Relationship To WF-Browser

Use this skill to start and operate the local Harness control panel. When the
task involves designing, debugging, or controlling a web UI through agent-visible
browser primitives, also use `wf-browser`.

`wf-ui` provides the local server, task/session graph, terminal bridge, and the
wf-browser backend control plane. `wf-browser` defines how a frontend should
expose route/capability/UI-tree/state/log/action contracts to that control
plane.

## Architecture

```text
Agent script/skill
    |
    | Harness/scripts/wf-ui-control.mjs + HTTP JSON APIs
    v
Local Node server bound to 127.0.0.1 only
    |
    | tasks/sessions/a2a + wf-browser run/window/lease/artifact stores
    v
Project-local Harness files
    |
    | /ws/events invalidation, /ws/terminal PTY, /ws/wf-browser observe/act
    v
Browser UI (React + TypeScript + Motion for React + Lucide)
```

## Communication Protocol

- HTTP snapshots are canonical state: `/api/tasks`, `/api/settings`, `/api/project`.
- WebSocket events are invalidation hints only. The UI refreshes HTTP snapshots
  on reconnect or sequence gaps.
- Browser writes go through typed `POST` endpoints.
- `Harness/tasks/**` is the durable source of truth; UI state is derived.
- WF browser runs are stored under `Harness/wf-browser/runs/<runId>/`.
- WF browser backend primitives:
  - `GET /api/wf-browser/capabilities`
  - `POST /api/wf-browser/runs`
  - `GET /api/wf-browser/runs/:runId/windows`
  - `POST /api/wf-browser/runs/:runId/windows`
  - `POST /api/wf-browser/runs/:runId/windows/:windowId/lease`
  - `POST /api/wf-browser/runs/:runId/windows/:windowId/commands`
  - `POST /api/wf-browser/runs/:runId/windows/:windowId/artifacts`
  - `GET /api/wf-browser/connections`
  - `POST /api/wf-browser/cleanup`
- A control lease is exclusive per window. Observe leases are read-only.
- Artifacts store screenshots, UI trees, state, logs, network, AST, replay, and
  analysis files instead of pasting bulky data into task docs.
- The frontend debug runtime connects only when the page URL or sessionStorage
  has `wfRun` and `wfWindow`; add `wfDebug=1` to show the virtual cursor overlay.

## Agent Commands

After `/wf-ui` starts, agents can use the control script when
`HARNESS_WF_UI_URL` and `HARNESS_WF_UI_TOKEN` are available:

```text
node Harness/scripts/wf-ui-control.mjs browser-allocate --mode runtime --route /workflow
node Harness/scripts/wf-ui-control.mjs browser-allocate-many --mode runtime --agents agent-a,agent-b --routes /workflow,/agents
node Harness/scripts/wf-ui-control.mjs browser-run --mode runtime --route /workflow
node Harness/scripts/wf-ui-control.mjs browser-window --run <runId> --route /workflow
node Harness/scripts/wf-ui-control.mjs browser-windows --run <runId>
node Harness/scripts/wf-ui-control.mjs browser-lease --run <runId> --window <windowId> --type control
node Harness/scripts/wf-ui-control.mjs browser-url --run <runId> --window <windowId> --lease <leaseId>
node Harness/scripts/wf-ui-control.mjs browser-open --run <runId> --window <windowId> --lease <leaseId> --context isolated
node Harness/scripts/wf-ui-control.mjs browser-launches --run <runId> --window <windowId>
node Harness/scripts/wf-ui-control.mjs browser-close --run <runId> --window <windowId> --launch <launchId> --remove-profile true
node Harness/scripts/wf-ui-control.mjs browser-wait --run <runId> --window <windowId> --agent <agentId>
node Harness/scripts/wf-ui-control.mjs browser-connections
node Harness/scripts/wf-ui-control.mjs browser-cleanup --keep-latest 20 --max-age-days 7
node Harness/scripts/wf-ui-control.mjs browser-command --run <runId> --window <windowId> --lease <leaseId> --primitive observe.uiTree
node Harness/scripts/wf-ui-control.mjs browser-snapshot --run <runId> --window <windowId> --lease <leaseId>
node Harness/scripts/wf-ui-control.mjs browser-command --run <runId> --window <windowId> --lease <leaseId> --primitive act.click --testid save-button
node Harness/scripts/wf-ui-control.mjs browser-release --run <runId> --window <windowId> --lease <leaseId> --close true --remove-profile true
node Harness/scripts/wf-ui-control.mjs browser-artifacts --run <runId> --window <windowId>
```

Prefer `browser-allocate` for one subagent and `browser-allocate-many` for a
batch of subagents. They create or reuse a run, create window slots, grant
leases, and return `launchUrl` values. Use `browser-url` to regenerate a URL
later. Use `browser-open --context isolated` when an agent needs Harness to open
a visible browser window with a per-window profile instead of asking the user to
open the URL manually. `browser-open` records `browser-launches.json` under the
run/window folder; use `browser-launches` to inspect local process/profile state
and `browser-close --remove-profile true` or `browser-release --close true` for
closeout. Use `browser-wait` after opening or refreshing a launch URL when the
next step needs the frontend WebSocket bridge to be connected.
Opening or refreshing the UI with the returned URL sets these debug parameters:

```text
?wfRun=<runId>&wfWindow=<windowId>&wfAgent=<agentId>&wfLease=<leaseId>&wfDebug=1
```

The first-party bridge supports `observe.route`, `observe.capabilities`,
`observe.uiTree`, `observe.state`, `observe.logs`, `observe.network`,
`observe.replay`, `observe.diff`, plus visible `act.hover`, `act.click`,
`act.focus`, `act.type`, `act.clear`, `act.select`, `act.press`, `act.drag`,
`act.scroll`, and `act.wait`. The React shell also registers route capability
maps for tasks, workflow, agents, roles, settings, and terminal drawer surfaces
through `wfBrowserRouteCapabilities`; `observe.uiTree` annotates matching nodes
with `registeredCapabilityIds`.
Use Playwright/CDP only for unsupported browser facts such as trusted screenshots,
native downloads, permissions, or third-party pages, and normalize evidence into
the same run/window artifact layout.
Use `browser-snapshot` before subagent handoff, after a visible action sequence,
or before release. It serially captures route, capabilities, UI tree, state,
logs, network, replay, and diff observations through the connected window lease
and returns the artifact paths.

## Readiness Boundary

Current wf-ui target:

- L2 foundation: run/window/lease/artifact APIs, command API, and control script.
- L3-minimal bridge: `/ws/wf-browser` dispatches bounded `observe.*`/`act.*`
  commands to an opt-in frontend debug runtime with virtual cursor feedback.
- L3 route map: wf-ui registers first-party route/page/canvas/graph/form/list
  capabilities for the current route and exposes those ids in UI-tree nodes.
- L3 observability: frontend runtime records bounded network entries, replay
  timeline entries, and compact before/after diffs as artifact-ready outputs.
- Connected-window handoff: `browser-snapshot` captures the standard observation
  bundle for an existing window/lease and stores each observation as run/window
  artifacts.
- Isolated browser launch: `browser-open` starts a visible Chrome/Edge/Chromium
  window with a per-run/window profile, stores launch metadata as an `analysis`
  artifact, and records local lifecycle state in `browser-launches.json`;
  dry-run mode proves arguments without starting a browser.
- Browser lifecycle foundation: `browser-launches` lists per-window launches
  with process liveness, `browser-close` closes selected/all launches and safely
  removes isolated profiles, and `browser-release --close true` links lease
  release to local browser cleanup.
- Connection wait: `browser-wait` polls `/api/wf-browser/connections` until the
  requested run/window/agent frontend registers or the timeout expires.
- Window allocator foundation: `browser-allocate` returns per-agent launch URLs
  for independent visible windows without requiring manual query construction;
  `browser-allocate-many` creates a batch of independent window/lease/launchUrl
  assignments for concurrent subagents, and `browser-windows` lists the run's
  current window pool for dispatch and handoff.
- Artifact retention foundation: `browser-cleanup` previews or applies the
  default latest-20-runs / 7-day retention policy through the backend cleanup
  API.
- Do not claim full L3 until trusted screenshot/AST coverage and deeper
  route-owned component maps are implemented for every major surface.
- Full L4 multi-agent-ready still requires runtime proof that subagents operate
  isolated visible windows concurrently, plus automatic cleanup coverage on all
  closeout paths.

## Security

- Loopback-only binding (`127.0.0.1`).
- One-time token auth on HTTP and WebSocket.
- Path traversal prevention on all task capsule reads.
- Command allowlist for PTY: `claude`, `codex`, `opencode`.
- Terminal default mode: watch/read-only; attach mode is explicit.
- `node-pty` is optional; missing means the terminal session reports blocked.
