# E2E Acceptance Evidence Matrix — E0-E18

ID-to-test mapping for the Workflow Control Plane acceptance suite. Every test uses public backend APIs or `Harness/scripts/wf-ui-control.mjs` CLI only. No direct `Harness/a2a/**/state.json` mutation.

**L1 (Deterministic E2E)** — backend in-process HTTP server on port 0, fake PTYs.
**L2 (CLI E2E)** — real `node Harness/scripts/wf-ui-control.mjs` subprocesses against in-process server.

| ID | Goal | Test Name | File | Layer | API/CLI Path |
|----|------|-----------|------|-------|--------------|
| **E0** | Clear node map | `E0 - clear node map via agent.deleteNodes` | `control-plane-acceptance.test.mjs` | L1 | `POST /api/workflow/nodes/:actor/actions/agent.deleteNodes` (all=true) |
| | | `E0b - after clearing non-live nodes, snapshot baseline` | `control-plane-acceptance.test.mjs` | L1 | `GET /api/workflow`, `GET /api/a2a/snapshot` |
| | | Full-Chain CLI (clear step) | `control-plane-cli-smoke.test.mjs` | L2 | `workflow-node-map --action deleteNodes --all true` |
| **E1** | Create Main Agent | `A1 - POST /api/sessions creates Agent node with identity` | `control-plane-acceptance.test.mjs` | L1 | `POST /api/sessions` |
| | | `create-agent spawns a managed agent session` | `control-plane-cli-smoke.test.mjs` | L2 | `create-agent --agent-kind main --role "Main Agent"` |
| | | Full-Chain CLI (create step) | `control-plane-cli-smoke.test.mjs` | L2 | `create-agent` |
| **E2** | Main Agent reads graph | `A2 - snapshot exposes nodes/edges/capsuleDockLinks` | `control-plane-acceptance.test.mjs` | L1 | `GET /api/a2a/snapshot`, edge connect/delete |
| | | `workflow-context returns identity, peers, manuals, actions` | `control-plane-cli-smoke.test.mjs` | L2 | `workflow-context --node <id>` |
| | | `workflow-node-map readGraph` | `control-plane-cli-smoke.test.mjs` | L2 | `workflow-node-map --action readGraph --actor <id>` |
| **E3** | Agent creates other Agents | `A1 - creates Agent with identity` (x3 subagents in E1) | `control-plane-acceptance.test.mjs` | L1 | `POST /api/sessions` (3 calls) |
| | | `E7 - Main Agent creates 3 role-distinct subagents` | `control-plane-acceptance.test.mjs` | L1 | `POST /api/sessions` (3 calls) |
| **E4** | Agent connects Agents | `A3 - connecting exposes each side in other's context` | `control-plane-acceptance.test.mjs` | L1 | `POST /api/workflow/edges` |
| | | `connect connects two graph nodes` | `control-plane-cli-smoke.test.mjs` | L2 | `connect --actor <id> --from <id> --to <id>` |
| **E5** | 1:1 mailbox | `A6 - agent.sendMessage delivers harness-request prefix` | `control-plane-acceptance.test.mjs` | L1 | `POST /api/workflow/nodes/:id/actions/agent.sendMessage` |
| | | `A8 - replies share requestId and replyTo` | `control-plane-acceptance.test.mjs` | L1 | `agent.sendMessage` + `agent.readMessages` |
| | | `send-agent-message delivers to target PTY` | `control-plane-cli-smoke.test.mjs` | L2 | `send-agent-message --node <id> --to <id> --text "..."` |
| **E6** | 1:many mailbox | `A7 - agent.broadcastMessage delivers independent per-recipient inputs` | `control-plane-acceptance.test.mjs` | L1 | `POST /api/workflow/nodes/:id/actions/agent.broadcastMessage` |
| | | `broadcast-agent-message delivers to every target` | `control-plane-cli-smoke.test.mjs` | L2 | `broadcast-agent-message --node <id> --to <id,id,id>` |
| **E7** | $wf-max fanout | `E7 - Main Agent creates 3 role-distinct subagents, dispatches work, aggregates replies` | `control-plane-acceptance.test.mjs` | L1 | `agent.broadcastMessage` + `agent.sendMessage` (reply) + `agent.readMessages` (aggregate) |
| | | `E7b - broadcasted requestId aggregates across senders` | `control-plane-acceptance.test.mjs` | L1 | `agent.sendMessage` + `agent.readMessages` (multi-sender aggregation) |
| | | Full-Chain CLI (broadcast+aggregate step) | `control-plane-cli-smoke.test.mjs` | L2 | `broadcast-agent-message` + `send-agent-message` (reply) + `read-agent-messages` |
| **E8** | Markdown shared context | `E1 - full chain creates shared Markdown, passes nodeId in contextRefs` | `control-plane-acceptance.test.mjs` | L1 | `markdown.append` + `agent.sendMessage` (contextRefs) |
| | | Full-Chain CLI (markdown create+read+append step) | `control-plane-cli-smoke.test.mjs` | L2 | `workflow-node-map --action createNode --type markdown` + `markdown.read` + `markdown.append` |
| **E9** | Markdown lock | `N3 - acquireLock → append/patch → releaseLock grows revision` | `control-plane-acceptance.test.mjs` | L1 | `markdown.acquireLock` + `markdown.append` + `markdown.releaseLock` |
| | | `N4 - foreign writer while locked gets markdown_locked` | `control-plane-acceptance.test.mjs` | L1 | `markdown.append` (rejected 409) |
| | | `N5 - stale expectedRevision returns markdown_conflict` | `control-plane-acceptance.test.mjs` | L1 | `markdown.replace` (rejected 409 with currentRevision) |
| **E10** | Excalidraw control | `N9 - readScene returns elements/appState/files` | `control-plane-acceptance.test.mjs` | L1 | `excalidraw.readScene` |
| | | `N10 - saveScene persists scene and grows revision` | `control-plane-acceptance.test.mjs` | L1 | `excalidraw.saveScene` |
| | | `N11 - patchScene applies incremental patch, preserves old elements` | `control-plane-acceptance.test.mjs` | L1 | `excalidraw.patchScene` |
| | | `N12 - invalid scene payload returns 4xx, leaves old scene unchanged` | `control-plane-acceptance.test.mjs` | L1 | `excalidraw.saveScene` (invalid → 4xx) |
| **E11** | Timer create + connect | `T1 - Timer normal edge wakeup reaches connected Agent` | `control-plane-acceptance.test.mjs` | L1 | `POST /api/workflow/nodes` (timer) + `POST /api/workflow/edges` |
| | | `T2 - magnetic group wakeup reaches group members only` | `control-plane-acceptance.test.mjs` | L1 | capsuleDockLinks + `timer.configure` + scheduler |
| **E12** | Timer multi-Agent wakeup | `T3 - one Timer wakes all three docked Agents, no duplicates` | `control-plane-acceptance.test.mjs` | L1 | 3 Agent capsuleDockLinks to one Timer |
| | | `T2 - outer Agent receives no wakeup` | `control-plane-acceptance.test.mjs` | L1 | non-member Agent excluded from wakeup set |
| **E13** | Goal node state | `N13 - goal state machine: add/delete/replace/check/uncheck/complete/reopen` | `control-plane-acceptance.test.mjs` | L1 | `goal.add` / `goal.delete` / `goal.replace` / `goal.check` / `goal.uncheck` / `goal.complete` / `goal.reopen` / `goal.read` |
| | | Full-Chain CLI (goal add+check+complete step) | `control-plane-cli-smoke.test.mjs` | L2 | `goal.add` + `goal.check` + `goal.complete` |
| **E14** | Timer + Goal linkage | `T4 - wakeup envelope carries magnetic group Goal nodeId` | `control-plane-acceptance.test.mjs` | L1 | Timer+Goal dock → arm timer → read wakeup envelope |
| | | `E1 - full chain: wakeup reads Goal, checks items` | `control-plane-acceptance.test.mjs` | L1 | wakeup → `goal.read` → `goal.check` |
| **E15** | Magnetic docking | `T8 - second Goal into Timer+Agent group rejected (409 goal_already_bound)` | `control-plane-acceptance.test.mjs` | L1 | `POST /api/workflow/edges` (409) + `agent.connectNodes` (throws) |
| | | N/A — Workflow UI Playwright test (existing `wf-ui-m7-team-cooperation.spec.ts`) | `src/ui/e2e/` | UI | Playwright toast assertion for frontend rejection |
| **E16** | Manual injection | `P2 - workflow-context includes connectedNodeManuals` | `control-plane-acceptance.test.mjs` | L1 | `GET /api/workflow/context/:nodeId` |
| | | `P3 - Markdown node injects workflow-markdown-node manual` | `control-plane-acceptance.test.mjs` | L1 | connect markdown → read context |
| | | `P4 - Excalidraw node injects workflow-diagram-node manual` | `control-plane-acceptance.test.mjs` | L1 | connect excalidraw → read context |
| | | `P5 - Timer+Goal inject manuals; Timer wakes, Goal does not` | `control-plane-acceptance.test.mjs` | L1 | dock Timer+Goal → read context |
| **E17** | User-friendly language | `P6 - agent-facing guidance avoids A2A/broadcast/thread jargon` | `control-plane-acceptance.test.mjs` | L1 | context.teamGuidance + context.connectedNodeManuals text check |
| **E18** | Final evidence summary | `E18 - Main Agent reads mailbox, Markdown, Goal, Timer, generates summary` | `control-plane-acceptance.test.mjs` | L1 | `agent.readMessages` + `markdown.read` + `goal.read` + `timer.read` + wakeup entries |
| | | Full-Chain CLI (final aggregation step) | `control-plane-cli-smoke.test.mjs` | L2 | `read-agent-messages` + `goal.read` + `markdown.read` + `workflow-context` |

## Test File Map

| File | Layer | Tests | Description |
|------|-------|-------|-------------|
| `src/wf-ui-server/__tests__/control-plane-acceptance.test.mjs` | L1 Deterministic E2E | 43 (A1-A8, T1-T8, N1-N15, P1-P6, E0-E18, E1) | In-process HTTP backend; fake PTYs; full control plane matrix |
| `src/wf-ui-server/__tests__/control-plane-cli-smoke.test.mjs` | L2 CLI E2E | 12 (9 smoke + 1 Full-Chain E0-E18 + 2 util) | Real `node Harness/scripts/wf-ui-control.mjs` subprocesses |
| `src/ui/e2e/wf-ui-m7-team-cooperation.spec.ts` | UI Smoke | Playwright E2E | Agent card identity, second-Goal rejection toast, audit lines |

## Gaps

| ID | Gap | Resolution |
|----|-----|------------|
| E15 (frontend) | Playwright test for magnetic docking rejection UI | Existing `wf-ui-m7-team-cooperation.spec.ts` covers this; E15 backend is fully tested |
| Live Agent Smoke | Real Claude/Codex runtime smoke test | Not implemented (requires live LLM runtime); gated behind runtime availability |
| UI Smoke (full canvas) | Playwright from blank canvas verifying node appearance, roles, connections | Partially covered by existing UI E2E specs; full canvas test deferred per user scope (optional) |

## Commands

```bash
# L1 Deterministic E2E (CI-ready)
node --test src/wf-ui-server/__tests__/control-plane-acceptance.test.mjs

# L2 CLI E2E (requires wf-ui-control.mjs)
node --test src/wf-ui-server/__tests__/control-plane-cli-smoke.test.mjs

# UI Smoke (requires Playwright + running server)
npx playwright test src/ui/e2e/wf-ui-m7-team-cooperation.spec.ts
```
