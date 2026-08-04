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
- UI tests and Playwright fixtures must either use real backend endpoints or
  mirror this contract exactly; mocks must not invent alternate handles, paths,
  revisions, or hydration shapes.

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
- `GET /api/wf-browser/runs/:runId/windows/:windowId/launch-url` returns the local wf-ui URL with `token`, `wfRun`, `wfWindow`, optional `wfLease`, and `wfDebug` parameters.
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
