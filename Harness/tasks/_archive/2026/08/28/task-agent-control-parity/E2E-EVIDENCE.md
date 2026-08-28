# E2E Evidence - task-agent-control-parity (verifier pass, 2026-08-13)

Date: 2026-08-13 (UTC timestamps). Node v24.18.0, Windows 10.
Backend: fresh `node bin/create-harness-vibe-coding.js wf-ui --project . --host 127.0.0.1 --port 56670 --detach`
(old backend PID 15632 killed first). All live calls via `Harness/scripts/wf-ui-control.mjs --url http://127.0.0.1:56670`.
Live graph on disk is the persisted Harness/a2a/workflow-map.json (workflow-task-action-registry-consolidation,
178 pre-existing stopped sessions; snapshotVersion 1788 -> 1808 during this pass).

## Part 1 - Full regression (26 suites, 395 tests: 394 pass / 1 fail)

| # | Suite | tests | pass | fail |
|---|-------|-------|------|------|
| 1 | workflow-graph-undo | 10 | 10 | 0 |
| 2 | workflow-depth-resume-dock | 22 | 22 | 0 |
| 3 | workflow-edge-update | 5 | 5 | 0 |
| 4 | workflow-layout | 7 | 7 | 0 |
| 5 | workflow-terminal-control | 14 | 14 | 0 |
| 6 | workflow-set-model | 6 | 6 | 0 |
| 7 | workflow-cli-surface | 4 | 4 | 0 |
| 8 | workflow-cli-registry-manuals | 7 | 7 | 0 |
| 9 | workflow-registry-drift | 8 | 8 | 0 |
| 10 | workflow-action-registry | 10 | 10 | 0 |
| 11 | action-registry-loader | 10 | 9 | 1 |
| 12 | workflow-node-manual-schema | 19 | 19 | 0 |
| 13 | workflow-subagent-strategy-matrix | 25 | 25 | 0 |
| 14 | control-plane-acceptance | 43 | 43 | 0 |
| 15 | control-plane-cli-smoke | 12 | 12 | 0 |
| 16 | workflow-agent-communication | 5 | 5 | 0 |
| 17 | workflow-agent-messages-structured | 6 | 6 | 0 |
| 18 | server.integration | 39 | 39 | 0 |
| 19 | workflow-agent-runtime | 8 | 8 | 0 |
| 20 | session-registry | 26 | 26 | 0 |
| 21 | a2a-store | 13 | 13 | 0 |
| 22 | workflow-agent-context | 2 | 2 | 0 |
| 23 | workflow-node-runtime | 58 | 58 | 0 |
| 24 | component-node-api | 15 | 15 | 0 |
| 25 | tests/anti-drift.test.js | 21 | 21 | 0 |
| 26 | UI tsc --noEmit + build | pass | pass | 0 (build: chunk-size warning only) |

FAILURE detail (suite 11): action-registry-loader.test.mjs:43 L1 asserts registry.actions.length === 72 but the real
Harness/a2a/action-registry.json has 74 actions. The 2 extra are graph.undo and graph.redo (added by this task P5 work).
Registry, loader, and test are all untracked working-tree files; the test expectation was not bumped when the registry grew.
Affected assertion: assert.equal(registry.actions.length, 72) at line 47. No other suite references the 72 count (anti-drift passes).

## Part 2 - Live E2E (real backend, real terminals)
### C3 DEPTH GATE - PASS
- Root: create-agent --agent-kind main --runtime codex --defer-pty-spawn true -> session 7a1a9243-0e1e-4d7f-a015-cc17b55de592, node session-7a1a9243-..., status blocked (deferred), parentAgentId null.
- Sub: create-agent --agent-kind subagent --runtime claude --defer-pty-spawn true --parent 7a1a9243-... -> session a09d551d-6962-4826-9467-ecf3a6199534, node session-a09d551d-..., parentAgentId 7a1a9243-....
- Act as sub (HARNESS_PEER_SESSION_ID=a09d551d-..., HARNESS_AGENT_KIND=main to reach the backend; CLI forwards parentAgentId from env):
  HTTP 403: {"error":{"code":"DEPTH_LIMIT","message":"Only the root agent can spawn canvas agents. Use your runtime built-in subagents instead."}}
- Also recorded: with HARNESS_AGENT_KIND=subagent the CLI rejects client-side (create-agent is only available to Main Agent nodes), so the depth-1 actor gate is enforced both client- and server-side.

### C4 UNDO - PASS
- before: positions[session-a09d551d-...] = {x:400,y:300}
- moveNode --x 700 --y 800 -> after: {x:700,y:800}
- node-map --action undo -> after: {x:400,y:300} (restored exactly)

### C5 DOCK - PASS (with design note)
- attachDock (anchor root, dragged sub, side right) -> response ok, dockLink id dock:session-7a1a9243-...::session-a09d551d-...; readGraph capsuleDockLinks shows the link with side:right, edge binding {edgeId: session-7a1a9243-...->session-a09d551d-..., retention:keep} and connection (relation delegation, kind capsule-dock-link).
- setDockSide --side left (requires anchor+dragged; dock-id alone is rejected with "setDockSide requires distinct anchor and dragged nodes") -> readGraph side:left.
- detachDock (anchor+dragged) -> {ok:true,action:agent.detachDock,removed:true,dockId:dock:...} -> readGraph capsuleDockLinks: [].
- Design note (confirmed live, not a failure): attachDock on a PAIR WITHOUT a connecting edge returns ok but the link is dropped on persist - normalizeCapsuleDockLinks (a2a-store.mjs:1712, "if (connections.length === 0) continue;" line 1772) keeps only dock links whose pair has a graph edge. The UI attaches docked capsules that are edge-connected, so CLI/UI semantics agree; a linkless attachDock silently no-ops on persist.

### C6 UPDATE-EDGE - PASS
- connectNodes root->sub relation delegation -> edge session-7a1a9243-...->session-a09d551d-... (relation delegation).
- updateEdge --edge <id> --relation workflow-link -> response relation workflow-link; readGraph edge relation now workflow-link (direction/endpoints unchanged).

### C7 RESUME (response-level) - PASS
- workflow-node-action agent.restart --resume true (payload deferPtySpawn:true) on subagent node -> response: resumeUsed: true, resumeArgs: ["--continue"], previousSessionId: a09d551d-6962-4826-9467-ecf3a6199534.
- Note: deferred-spawn session has agentSessionId null -> claude resolver falls back to --continue; a session that actually ran produces ["--resume", <id>] (unit R4/R5 covered).
### C8 REAL-TERMINAL E2E (1 real AI turn) - PASS
- Live codex main created (no defer): session 8bf53868-3868-440f-89cf-5a29e9e007ff, node session-8bf53868-..., pid 29644, codex CLI v0.147.0 (TUI booted, YOLO mode; HARNESS_WF_UI_URL + HARNESS_AGENT_KIND=main injected by pty-adapter).
- Char-by-char raw input: POST /api/sessions/8bf53868-.../input {data:<char>, raw:true} at 12ms/char - 262 chars, all HTTP 200, final CR 200.
- Instruction typed: "Run exactly this one command in the terminal and wait for it to finish before replying: node Harness/scripts/wf-ui-control.mjs create-agent --project . --agent-kind subagent --runtime claude --role implementer --role-title implementer --objective e2e-final-proof"
- Result: NEW session 367d7596-8802-4ada-9c64-3c576f9a9983 (runtime claude, agentKind subagent, role implementer, status running) with parentAgentId 8bf53868-3868-440f-89cf-5a29e9e007ff - first seen at snapshot poll ~20-25s after submit.
- CEO terminal output (ANSI-stripped): "Ran node Harness/scripts/wf-ui-control.mjs create-agent --project . --agent-kind subagent --runtime claude --role implementer --role-title implementer --objective e2e-final-proof" followed by response JSON containing sessionId 367d7596-8802-4ada-9c64-3c576f9a9983 and ptySessionId 367d7596-....
- Graph-node level: readGraph node session-367d7596-... has parentAgentId 8bf53868-..., parentNodeId session-8bf53868-..., objective e2e-final-proof.
- The spawned claude subagent was idle (no initial prompt) and was stopped after evidence capture via agent.stop.

### C9 RESUME (process-level) - PASS (args reach spawn; runtime continuation caveat)
- agent.restart resume:true on codex main node -> API response resumeUsed: true, resumeArgs: ["resume","8bf53868-3868-440f-89cf-5a29e9e007ff"], previousSessionId: 8bf53868-..., newSessionId: f205828e-4065-4e9b-be7a-9abeb556a405 (07:53:57).
- Spawned process events: session.running pid 27532 -> session.exited exitCode 1 (07:54:02).
- DIRECT wmic cmdline proof (repeat restart, launcher caught mid-flight, pid 15720):
  cmd.exe /d /c call C:\Users\onion\AppData\Local\pnpm\bin\codex.CMD --dangerously-bypass-approvals-and-sandbox resume f205828e-4065-4e9b-be7a-9abeb556a405
- Resumed codex CLI own output: ERROR: No saved session found with ID f205828e-4065-4e9b-be7a-9abeb556a405. Run codex resume without an ID to choose from existing sessions.
- Caveat (finding, not a wiring failure): the resume ARG reaches the spawn, but codex rollout store is keyed by its own internal UUID (the live session rollout ~/.codex/sessions/2026/08/13/rollout-2026-08-13T15-52-36-019ffa1b-...jsonl - 15:52 CST = 07:52 UTC - carries session_id 019ffa1b-d51c-77e2-9976-289a9585df0e), NOT the harness session id. So codex resume with the harness id exits 1. Response-level wiring (resumeUsed/resumeArgs/previousSessionId) and arg propagation are proven live; actual codex session continuation requires mapping the harness session id to the codex rollout id (open item for P2 acceptance "restart continues session history" for codex runtime).

## Residual graph state after this pass
Added nodes: session-7a1a9243 (codex main, deferred), session-a09d551d (claude sub, deferred), session-8bf53868 (codex main, stopped), session-367d7596 (claude sub, stopped), plus one edge root->sub (relation workflow-link) and graph version 1788->1808 with undo/redo history. Pre-existing 178 sessions untouched. Temp driver scripts removed after capture.
