# task-web-terminal-smoothing - PLAN

## Mini PRD

### Goal

Make the floating web terminal feel continuous when a user closes and reopens it, and keep the PTY dimensions aligned with the visible terminal viewport.

### Scope

- The floating terminal opened for an Agent session in `TerminalDrawer`.
- Keep a session-keyed xterm instance, FitAddon, renderer, and scrollback alive across drawer close/reopen.
- Reattach the terminal host to the visible drawer and append output received since the last sequence.
- Debounce container resize fitting and PTY dimension synchronization at about 50 ms; fit once after the view becomes visible.
- Release the cached terminal when its session is explicitly deleted.

### Non-scope

- Replacing xterm.js or adding dependencies. The project already uses xterm.js 6, FitAddon, WebLinksAddon, and WebGLAddon.
- Changing the backend PTY or WebSocket protocol.
- Changing the separate embedded terminal in `WorkflowRoute`.

### User flow

1. Open an Agent's floating terminal.
2. Read and interact with its output.
3. Close the drawer while the Agent session continues.
4. Reopen the same session and continue from the same visible scrollback, including output produced while closed.
5. Open another session and see only that session's terminal contents.
6. Resize, maximize, minimize, or restore the drawer and keep terminal wrapping and PTY dimensions in sync.

### UI / API contract

| Surface | Contract |
|---|---|
| Open | Double-click an Agent node in Workflow; `data-testid="terminal-window"` becomes visible. |
| Output host | `data-testid="terminal-output"` contains the xterm viewport for the selected session. |
| Close | Button title is the localized `Close terminal`; this hides the drawer and must not stop the Agent session or clear cached scrollback. |
| Resize | `data-testid="terminal-resize-handle"` changes the visible terminal dimensions. `terminal-fullscreen-toggle` and minimize/restore re-fit the viewport. |
| History | Initial attach reads `GET /api/terminals/:sessionId/range?tail=800`; reattach to the same cached session reads only entries after the last rendered sequence. Switching sessions loads that session's history independently. |
| Live output | `WS /ws/terminal/:sessionId` continues using existing `pty:data`, `pty:resize`, and `pty:input` messages. Only changed positive `cols`/`rows` are sent. |
| Delete cleanup | `harness:sessions-changed` with `{ sessionId, state: "deleted" }` releases that session's cached terminal. |

### Acceptance criteria

| ID | Given / When / Then | Evidence | Status |
|---|---|---|---|
| AC-001 | Given a live terminal session, when the user closes and reopens the same session, the existing scrollback remains visible and new output is appended; when the user opens another session, its output is isolated. | Playwright real-user test plus terminal history/sequence API assertions. | passed |
| AC-002 | Given a visible floating terminal, when its host is resized, maximized, minimized, restored, or reattached, xterm fits after a 50 ms debounced resize and the matching positive PTY dimensions are sent once. | Playwright interaction and WebSocket payload assertions; backend session dimensions checked through `GET /api/sessions?all=1`. | passed |
| AC-003 | Given an explicitly deleted session, its cached terminal is disposed and a later session with a different ID cannot inherit its contents. | Playwright regression test of the deleted-session event and session-id isolation. | passed |
| AC-004 | The terminal lifecycle is verified through the local UI test harness and `wf-ui` backend API; API control is used for runtime/session state, and BrowserOS Neo is not part of acceptance. | Focused Playwright test plus local `GET /api/workflow` and `GET /api/sessions?all=1` evidence. | passed |

### Test plan

- RED first: add an AC-linked Playwright test for same-session close/reopen, session isolation, resize debounce, positive PTY dimensions, and deletion cleanup; confirm failure before implementation.
- GREEN: run `pnpm --dir src/ui exec playwright test e2e/wf-ui-m4-interactions.spec.ts --grep task-web-terminal-smoothing` with a unique `WF_UI_E2E_PORT` to avoid server collisions.
- Build: run `pnpm --dir src/ui run build`.
- Browser acceptance: use the Playwright test harness for visible behavior; use the local `wf-ui` HTTP API for workflow/session state and control. Do not use BrowserOS Neo for acceptance.
- Record Playwright and API evidence under this task's `REFERENCES.md`.

## Decisions

| # | Decision | Reason | Date |
|---|---|---|---|
| 1 | Keep the existing xterm.js stack and add session-keyed lifecycle plus 50 ms resize coalescing in the floating terminal only. | It matches the useful OpsKat lifecycle/resize behavior while keeping the separate embedded terminal from competing for the same host. | 2026-09-28 |
| 2 | Preserve terminal history in the live xterm instance and fetch only missed sequence entries on same-session reattach. | Replaying and rebuilding the terminal on every drawer reopen discards renderer and viewport state. | 2026-09-28 |

## Risks

| Risk | Mitigation | Status |
|---|---|---|
| A cached xterm callback could send input to a previously selected session. | Bind all input and resize callbacks to the active session identity and assert WebSocket/API payloads in tests. | mitigated by AC-001/002 |
| Cached xterm instances could remain after explicit session deletion. | Dispose on the existing `harness:sessions-changed` deleted event and test cleanup. | mitigated by AC-003 |
| FitAddon may run while the drawer is hidden and calculate zero dimensions. | Ignore hidden/zero-size hosts; fit and sync after the drawer is visible. | mitigated by AC-002 |
