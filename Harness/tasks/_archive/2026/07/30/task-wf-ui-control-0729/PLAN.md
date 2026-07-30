# task-wf-ui-control-0729 - PLAN

## Goal

Design the next Harness control plane: `$wf-ui`, a local browser-hosted panel for task capsules, workflow orchestration, peer agent sessions, reported subagent events, project/global settings, and visible terminal observability.

This planning phase must be reviewable and resumable from this capsule. Do not rely on chat transcript state.

## Current User Need

The user does not only want a terminal wrapper. They want a Harness UI control and observability layer:

- See and manage task capsules.
- See workflow graph and dependencies.
- See each agent/subagent role, status, output/result, and evidence.
- Launch/control Claude, Codex, and OpenCode through a stable visible terminal surface.
- Avoid Windows Console, PowerShell visible windows, Windows Terminal hacks, and `SendKeys`.
- Use a browser-hosted terminal and local Node server, likely WebSocket based.
- Use React + TypeScript + Vite 8/Rolldown, React Flow, Lucide icons, and a black/white Apple-like UI.

## Research Notes

Official/source-backed facts checked during planning:

- Vite 8 is stable (v8.1.5, announced Mar 12 2026) and uses Rolldown as its unified Rust bundler; Vite 8 requires Node.js 20.19+ or 22.12+. Auto-conversion layer for existing esbuild/rollupOptions config exists.
  Source: https://vite.dev/blog/announcing-vite8
- Motion for React, formerly Framer Motion, is installed as `motion` and imported from `motion/react`; use it for restrained micro-interactions, not decorative motion. AnimatePresence is available. **useReducedMotion hook existence NOT confirmed from docs page — must verify before UI implementation.**
  Source: https://motion.dev/docs/react
- React Flow v12 is the current major version. Package: `@xyflow/react`. Core `<ReactFlow />` component with viewport, edge, interaction, connection, keyboard, style props. Custom nodes via `nodeTypes` mapping. Four built-in edge types: `default` (bezier), `smoothstep`, `step`, `straight`. Handles are plain div elements, fully stylable. MIT License.
  Sources: https://reactflow.dev/api-reference/react-flow and https://reactflow.dev/learn/concepts/terms-and-definitions
- xterm.js warns that WebSocket terminal transport needs additional security (WSS transport, custom auth protocol, no CORS protection inherited). The demo/attach addon must NOT be used as a production solution. Terminal data is untrusted — never use innerHTML. For SPAs, isolate terminal in its own subpage. All terminal-provided links are untrusted.
  Source: https://xtermjs.org/docs/guides/security/
- node-pty supports Linux, macOS, and Windows through Windows ConPTY on Windows 10 1809+ (build 18309); it is useful for making programs think they are running inside a terminal. Native compilation required (Python + C++ compiler + Windows SDK on Windows). Runs at parent process permission level — no sandboxing. Explicit: "Take care particularly when using node-pty inside a server that's accessible on the internet" — recommends container isolation.
  Source: https://github.com/microsoft/node-pty
- `ws` server creation: `new WebSocketServer({ port })`, attach to HTTP via `{ server }`, or `{ noServer: true }` for deferred upgrade. Auth in upgrade handler — write 401 and destroy socket on failure. Compression (permessage-deflate) disabled by default on server; enabled by default on client. Uses ping/pong heartbeat and `terminate()` for connection management.
  Source: https://github.com/websockets/ws
- Browser WebSocket clients expose `message`, `close`, `error`, and `open` events; `readyState` constants: `0 CONNECTING`, `1 OPEN`, `2 CLOSING`, `3 CLOSED`. **No built-in reconnection** — must implement manually. **No backpressure** — buffering fills memory; alternative is WebSocketStream (newer API). Use `bufferedAmount` for flow control on server side.
  Source: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Node HTTP servers can bind to `127.0.0.1`; port `0` assigns an OS ephemeral port, retrieved via `server.address().port` in the listen callback. Use `clientError` event for malformed requests, `maxHeadersCount` (default 2000), `headersTimeout`.
  Source: https://nodejs.org/api/http.html

### Wave 0 Research Additions (2026-07-29)

**CRITICAL: Motion `useReducedMotion` gap** — The `motion/react` docs page did NOT confirm a `useReducedMotion` hook. If unavailable, custom `prefers-reduced-motion` media query fallback is needed. Must verify before UI implementation. (Risk MEDIUM — affects AC-008 Playwright reduced-motion evidence.)

**CRITICAL: WebSocket backpressure** — Browser WebSocket has NO backpressure. If PTY floods output, browser buffers in memory. Need adaptive flow controller: server-side pause when `bufferedAmount` exceeds threshold. (Risk LOW for MVP — PTY is deferred to Phase 6.)

**CONFIRMED: xterm.js attach addon banned** — Per official security guide, the demo/attach addon must never be used in production. PLAN already avoids this.

**CONFIRMED: React Flow v12 uses `@xyflow/react`** — not the older `reactflow` package. MIT license, custom node types, full TypeScript support.

**CONFIRMED: ws compression** — Disabled by default on server (good for loopback). Auth through upgrade handler with 401 on failure.

**node-pty Windows build risk** — Requires Python + C++ compiler + Windows SDK + Spectre-mitigated libraries on Windows. Optional adapter pattern is correct. Build failure is common on Windows; must be handled gracefully.

## Primary Architecture Decision To Review

Recommended default shape:

```text
Browser UI
  React + TypeScript + React Flow + Motion for React + xterm.js + Lucide
        |
        | HTTP JSON APIs + WebSocket channels
        v
Local Node server, bound to 127.0.0.1 only
  - static UI assets
  - task capsule API
  - settings API
  - event watcher
  - peer terminal/session coordinator
        |
        | fs + task-state.mjs + optional node-pty
        v
Project-local Harness files
  Harness/tasks/<task-id>/**
  Harness/settings.json
  Harness/.harness-version
  .claude / .agents / .opencode command and skill surfaces
```

The UI is not the source of truth. `Harness/tasks/**` remains the durable state. The browser reads derived state through the server. Writes go through backend commands/scripts, never direct arbitrary browser-to-filesystem mutation.

## Shipping Model Options

CC must review and choose one before implementation.

Option A - package-hosted UI runner, recommended:
- Package contains `src/wf-ui-server.mjs` and prebuilt UI assets, e.g. `dist/wf-ui/`.
- `$wf-ui` command/skill tells agents to run `create-harness-vibe-coding wf-ui --project .`, falling back to `npx create-harness-vibe-coding@latest wf-ui --project .` if no global binary exists.
- Pros: no React/Vite/ws/node-pty dependencies are injected into user projects; global installs can serve every project.
- Cons: generated projects rely on the installed/npm package for UI runtime.

Option B - project-local generated UI:
- Generate `Harness/ui/` static assets and `Harness/scripts/wf-ui.mjs`.
- Pros: works without global package after scaffold/update.
- Cons: either vendors UI/server dependencies or writes package dependencies into user projects, both high risk.

Option C - hybrid:
- Generated project has thin command/skill/shim only.
- Package/global runner serves UI and points to project root.
- Project-local task capsules remain authoritative.
- This is likely the long-term path: global runtime, project-local state.

Planning default: choose Option C unless review finds a blocker.

### Architect Review Decision (Wave 0): **Option A (package-hosted)**

Architect overrides the PLAN default. Option A selected:
- Zero dependency pollution in user projects — matches the create-harness tool model.
- Option C's shim layer adds no value — npx fallback already covers uninstalled scenarios.
- Option B (project-local generation) confirmed high risk as PLAN itself notes.

**Implementation:**
- Package source: `src/wf-ui-server/*` (server modules), `src/ui/*` (React frontend)
- Build output: `dist/wf-ui/`
- Generated project shim: `Harness/scripts/wf-ui.mjs` (thin — launches package runner)
- `$wf-ui` command calls the package binary; falls back to `npx create-harness-vibe-coding@latest wf-ui --project .`

## Command Surface Decision

`$wf-ui` should be a **workflow command** — enters WF mode, requires `Harness/MEMORY.md` load, creates/resumes task capsules. It is NOT a direct/compat command.

Reason from codebase-explorer audit:
- `wf-browser` is the closest pattern: workflow command, enters WF, loads MEMORY.md
- Direct/compat commands (wf-help, wf-update, wf-task-*) skip the router — not appropriate for a control panel that manages tasks
- Opening the control panel IS a workflow action (task management, peer orchestration, state mutation)
- `command-surface.json` classification: `"workflow"`, `entersWf: true`

### Codebase-Explorer Verified File Checklist (Wave 0)

Based on reading 42 files across command patterns, validators, tests, and templates.

**Group 1: Registry (2 files)**
- [ ] `Harness/specs/runtime/command-surface.json` — add `wf-ui` entry
- [ ] `templates/common/Harness/specs/runtime/command-surface.json` — byte-identical mirror

**Group 2: Command files (4 files)**
- [ ] `.claude/commands/wf-ui.md` — workflow command wrapper
- [ ] `.opencode/commands/wf-ui.md` — body-identical mirror
- [ ] `templates/common/.claude/commands/wf-ui.md` — template mirror
- [ ] `templates/common/.opencode/commands/wf-ui.md` — template mirror

**Group 3: Skill files (4 files)**
- [ ] `.claude/skills/wf-ui/SKILL.md` — full skill adapter
- [ ] `.agents/skills/wf-ui/SKILL.md` — byte-identical mirror
- [ ] `templates/common/.claude/skills/wf-ui/SKILL.md` — template mirror
- [ ] `templates/common/.agents/skills/wf-ui/SKILL.md` — template mirror

**Group 4: Help tables (4 files)**
- [ ] `.claude/commands/wf-help.md` — add `| /wf-ui |` row
- [ ] `.opencode/commands/wf-help.md` — add matching row
- [ ] `templates/common/.claude/commands/wf-help.md` — template mirror
- [ ] `templates/common/.opencode/commands/wf-help.md` — template mirror

**Group 5: Docs router (4 files)**
- [ ] `Harness/README.md` — add wf-ui to workflow list, Skill Commands, Load By Task table
- [ ] `templates/common/Harness/README.md` — template mirror
- [ ] `Harness/MEMORY.md` — add wf-ui to Skills section
- [ ] `templates/common/Harness/MEMORY.md` — template mirror

**Group 6: Removal script (2 files)**
- [ ] `Harness/scripts/wf-remove.mjs` — BUILT_IN_SKILL_NAMES, BUILT_IN_COMMAND_NAMES, CLEANUP_DIRS
- [ ] `templates/common/Harness/scripts/wf-remove.mjs` — byte-identical mirror

**Group 7: Tests (3 files)**
- [ ] `tests/anti-drift.test.js` — template byte-identity pairs, wf-remove registry coverage
- [ ] `tests/generator.test.js` — expected generated files lists, opencode/claude/agents skill paths
- [ ] `tests/pack-smoke.test.js` — add `'wf-ui'` to explicit command array

**Group 8: Version + build (auto-generated)**
- [ ] `Harness/.harness-version` — run `node scripts/build-version.mjs` after file creation
- [ ] `templates/common/.harness-version` — auto-built by build-version

**Validator note:** The validator dynamically reads `command-surface.json` to derive required files. Adding the entry to `command-surface.json` auto-validates command/skill existence, skill frontmatter, cache discipline, and help table rows. No validator logic changes needed — only `command-surface.json`.

**~26 files total** plus auto-generated checksums.

## Browser To Local Communication Contract

Server startup:

```text
create-harness-vibe-coding wf-ui --project <abs-project-root> --host 127.0.0.1 --port 0 --open
```

Rules:

- Bind only to `127.0.0.1`; never `0.0.0.0`.
- Use port `0` by default so the OS selects a free port.
- Generate a random one-time token.
- Open `http://127.0.0.1:<port>/?token=<token>`.
- Do not log the token unless necessary; if logged, mark as local-only.
- Reject missing/invalid token on HTTP and WebSocket.
- Reject non-loopback host/origin unless an explicit future unsafe flag exists.

Connection lifecycle:

1. CLI resolves and canonicalizes `<abs-project-root>`.
2. CLI starts the local Node server on `127.0.0.1` with port `0` by default.
3. Server creates an in-memory one-time token scoped to that server process and project root.
4. Browser opens `/?token=<token>`.
5. Browser calls `GET /api/health` and `GET /api/project` before rendering project data.
6. Browser opens `GET /ws/events?token=<token>`.
7. Browser loads initial snapshots from `/api/tasks`, `/api/settings`, and `/api/peers`.
8. Server file watcher debounces `Harness/tasks/**` changes, re-reads canonical task state, increments a monotonic `seq`, and emits events.
9. Browser treats WebSocket events as invalidation hints; after any gap or reconnect it refreshes the relevant HTTP snapshot.
10. Browser shows `connected | reconnecting | degraded | disconnected` in the footer status bar.

Mutation lifecycle:

1. UI sends a typed `POST` request with token.
2. Server validates token, project root, task id, command allowlist, and canonical output path.
3. Server mutates by calling existing Harness scripts such as `task-state.mjs` or by an explicitly reviewed atomic writer.
4. Server returns the new resource state and emits a matching `*.updated` event.
5. UI updates optimistically only for reversible UI state; task capsule state is confirmed from server response or refreshed snapshot.

Peer/PTY lifecycle:

1. UI calls `POST /api/peers` with `taskId`, runtime, role, mode, objective, readSet, writeSet, and forbidden paths.
2. Server creates `Harness/tasks/<task-id>/peers/<peer-id>/REQUEST.json` and initial `STATE.json`.
3. If PTY is enabled and available, server starts the allowlisted executable (one of `claude`, `codex`, `opencode`) through the PTY adapter and writes lifecycle events to `events.jsonl`.
4. Browser attaches to `/ws/terminal/:sessionId?token=<token>` for read-only watch mode by default.
5. `pty:input` is rejected unless the user explicitly switches the session to attach mode.
6. Peer completion is durable only when `RESULT.json` exists or `STATE.json` reaches a terminal status.
7. On PTY crash, timeout, or adapter missing, server writes a bounded failure state into the peer capsule and emits `peer.blocked` or `peer.failed`.

HTTP API draft:

```text
GET  /api/health
GET  /api/project
GET  /api/tasks
GET  /api/tasks/:taskId
GET  /api/tasks/:taskId/file?name=STATE.json|PLAN.md|PROGRESS.md|RESULT.json
GET  /api/events?after=<seq>&limit=<n>
POST /api/tasks/:taskId/transition
POST /api/tasks/:taskId/archive
GET  /api/settings
POST /api/settings/project
GET  /api/peers
POST /api/peers
POST /api/peers/:peerId/stop
POST /api/peers/:peerId/attach-mode
```

WebSocket channels:

```text
GET /ws/events?token=<token>
GET /ws/terminal/:sessionId?token=<token>
```

Event channel messages:

```json
{
  "type": "task.updated | task.archived | peer.started | peer.event | peer.result | settings.updated | server.error",
  "seq": 1,
  "ts": "iso-8601",
  "taskId": "task-id-or-null",
  "peerId": "peer-id-or-null",
  "payload": {}
}
```

Terminal channel messages:

Server to browser:

```json
{ "type": "pty:data", "sessionId": "...", "data": "raw utf8 text chunk" }
{ "type": "pty:exit", "sessionId": "...", "exitCode": 0, "signal": null }
{ "type": "session:state", "sessionId": "...", "state": "starting|running|blocked|exited" }
{ "type": "session:error", "sessionId": "...", "message": "bounded error" }
```

Browser to server:

```json
{ "type": "pty:resize", "cols": 120, "rows": 32 }
{ "type": "pty:input", "data": "..." }
{ "type": "control:stop" }
```

`pty:input` is accepted only when the session is in explicit attach mode. Default mode is watch/read-only.

## Peer Agent Capsule Protocol

Each peer session writes under the active task:

```text
Harness/tasks/<task-id>/peers/<peer-id>/
  REQUEST.json
  STATE.json
  PROGRESS.md
  events.jsonl
  RESULT.json
  transcript.raw.log   optional, capped
```

`REQUEST.json` minimum:

```json
{
  "schemaVersion": 1,
  "peerId": "claude-reviewer-001",
  "runtime": "claude|codex|opencode",
  "role": "reviewer|worker|researcher|verifier",
  "mode": "read-only|review|implementation|telemetry",
  "objective": "...",
  "readSet": [],
  "writeSet": [],
  "forbidden": [],
  "evidencePacket": {},
  "expectedResult": "RESULT.json schema name",
  "completionRule": "write RESULT.json and exit or report DONE"
}
```

`events.jsonl` minimum event types:

```json
{"type":"peer.started","peerId":"...","runtime":"claude","ts":"..."}
{"type":"subagent.started","peerId":"...","subagentId":"...","role":"reviewer","ts":"..."}
{"type":"subagent.progress","peerId":"...","subagentId":"...","summary":"...","ts":"..."}
{"type":"subagent.completed","peerId":"...","subagentId":"...","verdict":"PASS|FAIL|BLOCKED","ts":"..."}
{"type":"peer.result","peerId":"...","resultPath":"RESULT.json","ts":"..."}
{"type":"peer.blocked","peerId":"...","reason":"...","ts":"..."}
```

Important observability limit:
- Harness cannot guarantee attach into another platform's native internal subagent UI.
- Harness can require the outer peer agent to report nested subagent state through `events.jsonl`.
- UI displays capsule-level observability, not guaranteed native runtime internals.

## PTY / Terminal Rules

- Use browser-hosted xterm.js for display.
- Use Node WebSocket to stream PTY chunks.
- Use `node-pty` only through an optional adapter.
- If `node-pty` is unavailable, terminal launch returns `BLOCKED: pty-adapter-missing`; do not silently fallback to `claude -p`, `codex exec`, or `opencode run`.
- Spawn peer executables directly; do not shell-concatenate command strings.
- Command allowlist: `claude`, `codex`, `opencode`. Test fixtures may use echo/cat adapters but the product protocol only references real runtimes.
- Session env must be bounded and must not leak secrets through API responses.
- Capture raw transcript in a ring buffer with max byte cap.
- Strip or normalize ANSI only for previews/search; keep raw chunks for terminal rendering.
- Emoji, CJK, ANSI, partial lines, and very large output must be tested.
- Implement inactivity timeout, total timeout, stop, resize, and process cleanup.

## UI Product Shape

If an `apple-design` skill exists in the executing environment, CC must load it before UI design. This repo currently has no local skill by that name.

If not available, use these explicit constraints:

- Operational tool, not landing page.
- Black/white dominant theme, large white canvas, restrained gray borders.
- Lucide icons for commands and navigation.
- Use Motion for React (`motion/react`) for micro-interactions and route/drawer transitions.
- Respect reduced motion; disable nonessential animations when the user requests reduced motion.
- No decorative gradient blobs/orbs.
- No nested cards.
- Compact professional panels.
- Text must not overflow on desktop/mobile.
- First viewport is the actual tool: task list, graph, inspector, terminal drawer.
- App shell layout:
  - Header: product/project identity, project root, active task, command launcher, language selector, theme toggle, compact help/about action.
  - Routed content: Tasks route for task list, filters, active/open/archive state, dependency and parallelism metadata.
  - Routed content: Workflow route for React Flow task/agent/subagent graph.
  - Routed content: Agents route for peer sessions, REQUEST/STATE/RESULT drilldown, terminal watch/attach entry.
  - Routed content: Settings route for global/project settings precedence, runtime paths, feature flags, and security toggles.
  - Bottom terminal drawer: xterm watch/attach surface, session selector, stop/resize state, bounded transcript access.
  - Footer/status bar: server connection, project path, active task, event seq, last sync/error, peer count, archive warning count, `@bigonion`, `MIT`, footer printer/status output area.
- Motion scope:
  - Header controls: subtle hover/tap feedback only.
  - Router content: short enter/exit transitions with `AnimatePresence` or equivalent if adopted.
  - Inspector/drawer: layout transitions for open/close and selected-item changes.
  - Status bar: connection-state pulse only for transient reconnecting/degraded states.
  - Avoid animated backgrounds and constant decorative motion.

## Skills Required By Phase

Phase 1 - Planning/spec only:
- `subagent-orchestrator`: dispatch planner, docs-researcher, architect, test-writer, reviewer.
- `wf-command-create`: map future `$wf-ui` command surfaces.
- `skill-creator`: design the future `wf-ui` skill trigger and body shape.
- `wf-agents-docs`: peer agent invocation and terminal/capsule constraints.
- `tdd`: acceptance/test strategy.
- `wf-browser`: browser-visible validation plan.

Phase 2 - Command/skill surface:
- `wf-command-create` mandatory.
- `skill-creator` mandatory for `wf-ui/SKILL.md`.
- `subagent-orchestrator` for read-only surface audit and independent review.

Phase 3 - Backend skeleton:
- `tdd` for API contract tests first.
- `subagent-orchestrator` for architect + test-writer before implementer.
- `wf-agents-docs` for peer process boundary.

Phase 4 - Read-only UI:
- `tdd` and `wf-browser` mandatory.
- `apple-design` if available; otherwise explicit UI constraints above.

Phase 5 - React Flow graph:
- `tdd` and `wf-browser` mandatory.
- `subagent-orchestrator` for spec review and UX review.

Phase 6 - xterm/WebSocket/PTY:
- `wf-agents-docs`, `tdd`, and `wf-browser` mandatory.
- Independent security/architecture review before merging.

Phase 7 - Peer capsule protocol:
- `wf-agents-docs`, `subagent-orchestrator`, and `tdd` mandatory.
- Use echo/cat test adapters before real Claude/Codex/OpenCode PTY. Product protocol references real runtimes only.

Phase 7.5 — Multi-session terminal: session-registry.mjs, pty-adapter.mjs, peer-capsule.mjs, ws-terminal.mjs

Phase 8 - Validation/release:
- `wf-review` for independent review.
- `subagent-orchestrator` for verifier + reflector.
- No npm publish unless user explicitly asks.

## Test Validity Plan

Build/lint/typecheck are supporting checks only. They do not prove `$wf-ui`.

Valid tests must include:

- Unit tests:
  - task capsule parser
  - graph derivation from tasks/links/peers/events
  - path canonicalization and traversal rejection
  - token validation
  - command allowlist
  - optional PTY adapter missing path

- API integration tests:
  - start server on `127.0.0.1` port `0`
  - reject missing token
  - reject invalid token
  - reject path traversal
  - read fixture task list
  - transition/archive routes call backend command adapter or safe in-memory fake
  - server address is loopback, not `0.0.0.0`

- WebSocket tests:
  - event channel opens with token
  - event channel rejects bad token
  - task file update emits `task.updated`
  - reconnect after forced close refreshes HTTP snapshot
  - `seq` gap forces snapshot reload
  - terminal channel streams fake PTY data
  - `pty:input` ignored/rejected in watch mode
  - `pty:input` accepted and recorded in attach mode
  - resize events reach fake PTY
  - close/exit state emitted

- Fake PTY tests:
  - emits emoji + Chinese + ANSI
  - emits partial lines
  - emits output larger than transcript cap
  - writes RESULT.json
  - exits non-zero
  - hangs until total timeout
  - produces no RESULT.json
  - invalid RESULT.json

- Playwright/browser acceptance:
  - open panel URL
  - header shows project identity, language selector, theme toggle, and active task
  - routed content changes without losing footer status
  - footer/status bar shows connection state, event seq, last sync/error, `@bigonion`, and `MIT`
  - task list is visible
  - React Flow shows task nodes and dependency edges
  - click node opens inspector with STATE/PLAN/PROGRESS
  - event WebSocket update changes UI without reload
  - terminal drawer shows fake PTY output including emoji/CJK/ANSI rendering
  - attach toggle controls whether user input reaches backend
  - settings page shows project/global precedence
  - reduced-motion mode disables nonessential Motion transitions
  - screenshot/trace saved for AC matrix

No UI acceptance without real browser evidence.

## Subagent Dispatch Plan For CC

Wave 0 - read-only research and surface map, parallel:

| Agent | Skills | Read set | Output |
| --- | --- | --- | --- |
| docs-researcher | wf-agents-docs | official Vite/React Flow/xterm/node-pty/ws/Node/WebSocket docs | source-backed constraints and dependency risks |
| codebase-explorer | wf-command-create | command surfaces, validators, generator tests, templates | exact future file update checklist |
| architect | subagent-orchestrator | task capsule specs, settings, current scripts, command surface | reviewed architecture options |
| test-writer | tdd, wf-browser | acceptance/bridge/TDD docs | valid test strategy and AC mapping |
| reviewer | none/read-only | this PLAN after synthesis | architecture/spec gaps |

Wave 1 - controller synthesis:

- Update PLAN with selected architecture.
- Do not implement.
- Mark AC-001..AC-005 as passed only if the plan covers them.

Wave 2 - independent architecture review:

- Reviewer A: spec/user-need review.
- Reviewer B: architecture/security review.
- Reviewer C: test-validity review.
- Any HIGH/Critical finding blocks implementation planning.

## First Implementation Slice (Architect-Reviewed)

Do not start with terminal. Start with the smallest non-native slice:

1. `$wf-ui` command/skill surface and validation registration. **(Group 1-8, ~26 files)**
2. Package CLI subcommand skeleton in `src/wf-ui-server/`.
3. **2.5 — Auth-gated server skeleton** (architect addition): health check endpoint, project info, token validation middleware, error envelope. Must validate the security loop before expanding.
4. Read-only task API over fixture/current tasks (`/api/tasks`, `/api/tasks/:taskId`, `/api/settings`).
5. Static React/Vite UI shell with task list + placeholders for workflow/agents/settings routes.
6. Playwright proves browser opens and reads task state.

Terminal/PTY comes after the server/UI/test skeleton is stable.

### Architect Structural Decisions

- **Peer API scope**: Use `POST /api/tasks/:taskId/peers` (not `/api/peers`) — peers are task-scoped.
- **WS keepalive**: Add `ws:ping`/`ws:pong` every 15-30s. Lost pong → `disconnected` state + HTTP snapshot refresh on reconnect.
- **Standard error envelope**: `{ error: { code: string, message: string, details?: any } }` for all error responses.
- **IPv4/IPv6**: Documented decision: IPv4-only for MVP (bind `127.0.0.1`). Browser must connect via `127.0.0.1`, not `::1`. IPv6 is not a blocker.

## Risks

- Native dependency risk: `node-pty` can fail installation/build on Windows. Keep optional.
- Security risk: PTY is equivalent to local shell access. Bind loopback only, token-gate all channels, and default to watch mode.
- State drift risk: UI must not invent its own task truth.
- Package size risk: Vite/React build tooling should not be injected into generated projects unless explicitly chosen.
- Observable-subagent risk: nested peer subagents are not guaranteed attachable. Use capsule-level reporting.
- Scope risk: implementing UI, command surfaces, terminal, peer protocol, and settings at once is too large. Use staged MVP.

## Acceptance

- AC-001: ✅ PASSED — Architecture plan covers all layers (server, UI, API, PTY, settings, security). Architect review confirmed boundary clarity.
- AC-002: ✅ PASSED — MVP slice defined with 6 steps (incl. 2.5 auth skeleton), file locations (`src/wf-ui-server/`, `src/ui/`), dependency strategy (Option A package-hosted), validation commands (vitest + playwright), rollback boundaries.
- AC-003: ✅ PASSED — `$wf-ui` classified as **workflow command** (not direct/compat). Complete 26-file checklist verified by codebase-explorer across 8 groups.
- AC-004: ✅ PASSED — Filesystem-as-truth rule explicit in communication contract. UI state is derived only. Writes go through backend scripts.
- AC-005: ✅ PASSED — Cross-runtime observability limits documented: Harness cannot guarantee attach into another platform's subagent UI. Peers report nested state through `events.jsonl`.
- AC-006: ✅ PASSED — Full browser-to-local pipeline specified: startup, token auth, HTTP snapshots, WS events, mutation lifecycle, PTY lifecycle, reconnect behavior. Architect additions: WS keepalive, standard error envelope, peer API task-scoping.
- AC-007: ✅ PASSED — UI shell layout: header, routed content (Tasks/Workflow/Agents/Settings), terminal drawer, footer status bar, language selector, theme toggle, `@bigonion`, `MIT`.
- AC-008: ✅ PASSED — Test plan distinguishes 28 VALID acceptance evidence tests (API integration + WS + Playwright) from 14 SUPPORTING unit tests. Motion reduced-motion verification defined.

## A2A Control Plane Expansion

### Mini PRD

Goal: make `$wf-ui` match the Harness external framework as an observable and controllable agent control plane, not a task-card dependency mockup.

Scope:
- Persist A2A facts through a Harness-owned filesystem protocol.
- Let backend scripts/skills provide bounded terminal/session/event reads and attach-gated input forwarding.
- Auto-detect local CLI runtimes for `claude`/`cc`, `codex`, `opencode`, `openclaw`, and `pi`.
- Redesign Workflow as CEO leader -> managers/subagents/workers/reviewers/verifiers observability.
- Redesign Agents as runtime detection + multi-session terminal launch surface.
- Use the Harness H brand mark in the header and remove broken placeholder glyphs.

Non-scope:
- No free-form React Flow workflow editor.
- No unmanaged OS terminal attach in this slice.
- No full adapters for OpenClaw or pi until their CLI contracts are explicit.
- No raw secret or uncapped transcript persistence.

Assumptions from user clarification:
- A2A communication uses files as the primary durable channel.
- Skills/scripts are the agent-facing capability layer for READ/GLOB/ranged terminal access and input forwarding.
- Frontend remains a display/control surface; backend owns CLI detection, terminal IO, permissions, and protocol mutation.

### Acceptance Criteria

| ID | Requirement | Verification |
| --- | --- | --- |
| AC-012 | A2A facts persist in Harness filesystem protocol; runtime session state stays task-scoped. | File inspection plus backend unit/API tests |
| AC-013 | Backend detects `claude`/`cc`, `codex`, `opencode`, `openclaw`, and `pi`, reporting path/version/status/capabilities/blocked reason. | Runtime detector unit tests and `/api/runtimes` integration |
| AC-014 | Backend exposes bounded terminal read/glob/list/input tools, with attach-gated input. | Script tests plus session registry/WS tests |
| AC-015 | Workflow UI shows CEO -> subagents hierarchy derived from task/A2A/session data, not a free-edit dependency graph. | UI build and browser/manual route evidence |
| AC-016 | Agents UI lists detected runtimes and can launch supported runtimes into isolated Web terminals linked to workflow state. | API/UI tests or browser/manual evidence |
| AC-017 | Header uses H brand icon and broken placeholder glyphs are removed from core controls. | UI build and screenshot/manual visual check |

### Subagent Dispatch

| Wave | Role | Mode | Read Set | Write Set | Status |
| --- | --- | --- | --- | --- | --- |
| W0 | product-manager | read-only | user request, screenshots, current UI routes | none | Returned |
| W1 | architect | read-only | `src/wf-ui-server/**`, `src/ui/src/**`, task PLAN | none | Pending |
| W1 | backend-expert | read-only | `src/wf-ui-server/**`, server tests, A2A scope | none | Pending |
| W1 | frontend-expert | read-only | `src/ui/src/**`, screenshots, PM output | none | Pending |

### API / Tool Contract Draft

HTTP:
- `GET /api/runtimes`
- `GET /api/workflow`
- `GET /api/a2a/skills`
- `GET /api/terminals`
- `GET /api/terminals/:sessionId/range?fromSeq=&toSeq=&tail=`
- `GET /api/terminals/events?glob=&since=&limit=`
- `POST /api/sessions`
- `POST /api/sessions/:sessionId/attach-mode`

Script/skill wrapper:
- `node Harness/scripts/a2a-terminal.mjs list-sessions`
- `node Harness/scripts/a2a-terminal.mjs read-range --session <id> --from <seq> --to <seq>`
- `node Harness/scripts/a2a-terminal.mjs tail --session <id> --lines <n>`
- `node Harness/scripts/a2a-terminal.mjs glob-events --pattern <glob> --limit <n>`
- `node Harness/scripts/a2a-terminal.mjs send-input --session <id> --text <text>`

State layout:
- `Harness/a2a/runtime-registry.json`
- `Harness/a2a/role-graph.json`
- `Harness/a2a/skills/terminal-control.json`
- `Harness/tasks/<task-id>/sessions/<session-id>/STATE.json`
- `Harness/tasks/<task-id>/sessions/<session-id>/terminal.jsonl`
- `Harness/tasks/<task-id>/sessions/<session-id>/events.jsonl`

## Wave 0 CEO Synthesis (2026-07-29)

### Agents Used
- `w0-docs-researcher` (haiku): Official docs — Vite 8 v8.1.5, Motion `motion/react`, React Flow v12 `@xyflow/react`, xterm.js security, node-pty ConPTY, ws, Browser WebSocket, Node HTTP
- `w0-codebase-explorer` (haiku): 42 files read — command/skill/template/validator/test surface map, 26-file checklist
- `w0-architect` (haiku): Boundary review, shipping model comparison (Option A selected), security audit, API review
- `w0-test-writer` (haiku): AC-to-test matrix — 28 valid + 14 supporting tests across 4 waves

### Findings Accepted
1. **Option A shipping model** (architect override) — package-hosted, zero dep pollution
2. **MVP step 2.5** (architect) — auth-gated server skeleton before task API
3. **WS keepalive** (architect) — ws:ping/pong every 15-30s
4. **Standard error envelope** (architect) — `{ error: { code, message, details? } }`
5. **Peer API task-scoping** (architect) — `/api/tasks/:taskId/peers`
6. **Motion useReducedMotion unconfirmed** (docs-researcher) — need custom `prefers-reduced-motion` fallback
7. **React Flow v12 = @xyflow/react** (docs-researcher) — correct package, MIT license
8. **Browser WS no backpressure** (docs-researcher) — need `bufferedAmount` flow controller for PTY phase
9. **wf-ui = workflow command** (codebase-explorer) — enters WF, loads MEMORY.md, uses `wf-command-create`
10. **UI_CONTRACT.md required** (test-writer) — HARNESS_BRIDGE.md demands `data-testid` before Playwright

### Findings Rejected
- PLAN default Option C (hybrid) — rejected by architect in favor of Option A
- Direct/compat classification — codebase-explorer confirmed workflow command pattern matches `wf-browser`

### Conflicts
None. All 4 agents converged on the same architecture shape.

### Decisions
See STATE.json `decisions[]` for the full list (11 decisions, 4 additions from architect).

### Next Write Set (D-GATE prep → W2)
1. `Harness/specs/runtime/command-surface.json` — add wf-ui entry
2. `.claude/commands/wf-ui.md` + `.opencode/commands/wf-ui.md` — workflow command wrappers
3. `.claude/skills/wf-ui/SKILL.md` + `.agents/skills/wf-ui/SKILL.md` — skill adapters
4. `Harness/README.md` + `Harness/MEMORY.md` — docs router updates
5. All template mirrors (`templates/common/...`)
6. `Harness/scripts/wf-remove.mjs` — BUILT_IN registries
7. `src/wf-ui-server/` — server scaffold (token, HTTP, WS, APIs)
8. `src/ui/` — React/Vite UI shell
9. Tests: unit (14) + API integration (10) + WS (7) + Playwright (11)

### Verification Path
- `node --test src/wf-ui-server/__tests__/*.test.mjs` (unit + integration + WS)
- `pnpm --dir src/ui build`
- `npx playwright test` (E2E)
- `node Harness/scripts/validate-harness.mjs`
- `node templates/common/Harness/scripts/validate-harness.mjs`
- `npm run build:version -- --check`
- `git diff --check`

### Residual Risk
- Motion `useReducedMotion` — verify before W4 UI implementation
- Vitest/Playwright config not scaffolded — must create in W2
- Fixture data seeder missing — must implement before W2 API tests
- UI_CONTRACT.md missing — must write before W4 Playwright tests
- Token in URL query param — MVP limitation, document
