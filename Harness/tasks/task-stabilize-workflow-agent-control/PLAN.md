# task-stabilize-workflow-agent-control - PLAN

## Goal

- Outcome: WF UI and backend maintain one coherent live graph/control state so agents can perceive current connections, Main Agents can spawn/control managed Subagents through Harness APIs, and stopped/deleted nodes disappear or downgrade predictably.
- Non-goals: Do not rely on built-in model subagents as proof. Do not add a second state store. Do not silently hide backend inconsistencies in the UI.

## Mini PRD

- Agents need a fresh graph snapshot after node/edge/session changes without waiting for stale cached data.
- Main Agent controlled subagents must be created through the Harness-managed PTY/session path and recorded in the workflow graph.
- Stop/delete must be a backend-owned transition that updates live registry, durable session records, graph snapshot, and UI controls consistently.
- Saved/not-managed sessions should be openable as transcripts but should not offer misleading stop controls or block node deletion.

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | After a node or edge change, `/api/a2a/snapshot` and `wf-ui-control.mjs describe` observe the same updated topology without stale cache. | `node --test src/wf-ui-server/__tests__/*.test.mjs`; `npm test` | passed |
| AC-002 | A Main Agent can create/control managed agents through Harness `wf-ui-control.mjs`/session APIs; this does not rely on built-in model subagents. | backend integration + anti-drift control protocol tests | passed |
| AC-003 | Stop on a running node transitions it out of live PTY state exactly once, updates `/api/sessions`, `/api/a2a/snapshot`, persisted session state, and disables/removes stop affordances in UI. | Edge closed-loop result records PTY kill; backend stop tests | passed |
| AC-004 | Delete/remove for saved or not-managed nodes is possible from UI/API and removes the graph node without corrupting transcript access or unrelated sessions. | Edge all-select delete; backend DELETE tests including non-live registry session | passed |
| AC-005 | Browser/E2E coverage proves the closed loop: two Main Agents exchange wf-bridge messages, bridge transcript UI opens from the edge, saved nodes delete, live nodes stop, and settings runtime icons render. | `Harness/tasks/task-stabilize-workflow-agent-control/evidence/browser-closed-loop-result.json` | passed |
| AC-006 | Runtime identity uses env/node-home init rather than injected terminal prompts, with Main Agent global graph control and Subagent restrictions in the node init file. | backend quiet bootstrap tests + `CLAUDE.md` env bootstrap instructions | passed |
| AC-007 | PTY resource UI does not present unknown values as fake `0 / 0 B`, and session listing avoids runtime detection stalls. | backend server tests + anti-drift resource assertions | passed |
| AC-008 | Runtime/brand icons render in Workflow, Agents, Settings, and task surfaces; Codex uses black/white, OpenCode gray, DeepSeek/Qwen blue accents. | build/typecheck + Edge settings icon screenshot | passed |
| AC-009 | Main nodes expose large top/right/bottom/left source/target connection handles that remain targetable after canvas zoom. | Edge result handleBox 68x68 + anti-drift CSS/inline handle tests | passed |
| AC-010 | The `wf-bridge` edge label opens a bridge transcript panel with copy/refresh/close and displays bidirectional communication history. | Edge closed-loop bridge panel screenshot + bridge-store integration test | passed |

## Scope

- Write set:
  - `src/wf-ui-server/server.mjs`
  - `src/wf-ui-server/a2a-store.mjs`
  - `src/wf-ui-server/session-registry.mjs`
  - `src/wf-ui-server/terminal-store.mjs`
  - `Harness/scripts/wf-ui-control.mjs`
  - `src/ui/src/components/WorkflowRoute.tsx`
  - `src/ui/src/components/AgentsRoute.tsx`
  - `src/ui/src/types.ts`
  - `src/wf-ui-server/__tests__/*.test.mjs`
  - `tests/anti-drift.test.js`
- Forbidden:
  - npm publish/version changes
  - replacing the PTY library
  - hiding failures with UI-only optimistic state
  - destructive git operations

## Current Assumptions

- Memory hints: none.
- Current user-reported failures are accepted as reproducible targets: stale graph perception, missing Harness-managed Main->Subagent E2E proof, and unreliable stop/delete for saved/not-managed nodes.
- This task is WF-Full because it crosses backend state, browser UI, PTY control, and acceptance evidence.

## Subagent Dispatch

| ID | Agent | Mode | Task | Read set | Write set | Status |
|----|-------|------|------|----------|-----------|--------|
| D1 | codebase-explorer | read | Trace current graph/session/snapshot/stop/delete ownership and locate stale cache risks. | `src/wf-ui-server`, `src/ui/src/components/WorkflowRoute.tsx`, `Harness/scripts/wf-ui-control.mjs`, tests | none | ready |
| D2 | architect | read | Propose one backend-owned state transition contract for live/saved/stopped/deleted graph nodes. | same as D1 plus `src/ui/src/types.ts` | none | ready |
| D3 | test-writer | write | Add failing or currently missing tests for AC-001..AC-005 before implementation. | existing tests + AC table | `tests/anti-drift.test.js`, `src/wf-ui-server/__tests__/*.test.mjs` | ready |

## Heartbeat

| Time | Phase | Note |
|------|-------|------|
| 2026-07-31T11:02:00Z | Intake | Created WF-Full stability task from user-reported stale graph perception, missing managed-agent E2E, and unreliable stop/delete. |
