# task-stabilize-workflow-agent-control - PROGRESS

## Current

- Phase: Verified
- Next: Ready for user review on the restarted `http://127.0.0.1:53834/workflow` server; use the latest ready-file URL because the old browser token is invalid.
- Blocker: none

## Verification

- [x] AC-linked tests
- [x] backend integration tests
- [x] browser verification on wf-ui
- [x] Edge closed-loop workflow test
- [x] independent review
- [x] reflector verdict

## Heartbeat

| Time | Phase | Note |
|------|-------|------|
| 2026-07-31T11:02:00Z | Intake | Started WF-Full stability task after user found stale graph perception, lack of managed Main->Subagent E2E proof, and unreliable stop/delete/delete affordances. |
| 2026-07-31T11:25:00Z | Verified | Backend graph state now owns lifecycle/control, saved/not-managed nodes can be deleted with transcript preserved, stale browser graph state is tombstoned, and subagents can read fresh snapshots with read-only tokens. |
| 2026-07-31T12:42:00Z | Verified | Edge closed-loop passed: two Main Agents exchanged recorded wf-bridge messages, bridge transcript panel opened from the edge, all-select delete removed saved node, live stop persisted saved state, runtime icons rendered, and connection handles measured 34x34 on screen. |
| 2026-07-31T17:06:27Z | Verified | CDP pass fixed workflow handles to constant 14px visual size, separated duplicate bidirectional bridge edges, made line click select/delete and label click open bridge panel, made bridge paths draggable by offset, and restored saved transcript replay on terminal visibility/focus. Evidence: `evidence/cdp-workflow-verification.json`, `evidence/cdp-terminal-replay-verification.json`, `evidence/cdp-after-workflow.png`, `evidence/cdp-after-edge-interactions.png`, `evidence/cdp-after-terminal-replay.png`. |
| 2026-07-31T17:58:06Z | Verified | Follow-up CDP pass on restarted port 53834: legacy `saved` is normalized out of UI/API, both Main Agent nodes are running with Stop controls, handles are four 10px constant-size dots under zoom, line body click selects without opening the panel, line drag commits/restores offset, label click opens the bridge panel, F12/Ctrl+Shift+I key events reach the page, and network failures/4xx/runtime exceptions are zero. Evidence: `evidence/cdp-workflow-node-controls-handles.json`, `evidence/cdp-workflow-node-controls-handles.png`, `evidence/wf-ui-53834-direct-ready.json`. |

## Log

| Date | Phase | Note |
|------|-------|------|
| 2026-07-31 | Intake | User reported agent graph awareness lags, no end-to-end proof that Main Agent can control a Harness-managed Subagent, and saved/not-managed nodes can be difficult or impossible to stop/delete. |
| 2026-07-31 | Implementation | Added DELETE `/api/a2a/nodes/:nodeId`, snapshot `control`/`lifecycle` fields, graph tombstones, stop-to-graph persistence, read-only graph tokens, UI delete affordances, authoritative server graph loading, and null-safe PTY resource aggregation. |
| 2026-07-31 | Verification | Passed `node --test src/wf-ui-server/__tests__/*.test.mjs`, `npm test`, `npm --prefix src/ui run typecheck`, `npm --prefix src/ui run build`, `git diff --check`, and Playwright Edge-channel page verification on a fresh wf-ui server. |
| 2026-07-31 | Implementation | Removed default injected bootstrap prompts in favor of Harness env/node init; added bridge-store + `/api/a2a/bridge-messages`; expanded `wf-ui-control.mjs` with `send-input`, `bridge-messages`, `connect`, and `delete-node`; added runtime brand icons and JSON/status visual affordances. |
| 2026-07-31 | Implementation | Fixed non-live registry deletion so saved graph nodes cannot reappear from current registry state; enlarged node connection handles and made wf-bridge edge hit paths visibly clickable. |
| 2026-07-31 | Verification | Edge evidence written to `Harness/tasks/task-stabilize-workflow-agent-control/evidence/browser-closed-loop-result.json`, `browser-closed-loop-workflow.png`, and `browser-settings-runtime-icon.png`. |
| 2026-07-31 | Verification | Passed focused backend tests, anti-drift tests, frontend typecheck/build, diff whitespace checks, and Chrome/Playwright CDP verification for status, Start/Stop controls, 4-handle node UI, edge selection/dragging, bridge label panel behavior, terminal keyboard passthrough, and live 53834 API health. |
