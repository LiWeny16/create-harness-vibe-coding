# task-upgrade-workflow-agent-canvas - PLAN

## Goal

- Outcome: Rework WF UI Workflow into an agent topology canvas where visible nodes are controllable PTY agents, edges declare allowed communication, and terminal interaction is reliable.
- Non-goals: Do not keep Router as a default concept. Do not make `/wf` a standalone run button. Do not use hidden or built-in subagents for workflow-created worker agents.

## Mini PRD

- Users can create Main Agent and Subagent nodes from toolbar or canvas context at the intended canvas position.
- Main Agent can create/control managed Subagents through backend workflow commands; Subagents cannot create further agents or task nodes.
- Node mode and terminal mode are distinct: card mode is the compact node, terminal mode is an embedded interactive PTY. Double-click opens configuration, not terminal.
- Edges represent permitted communication. Agents receive graph context through a workflow map/bridge prompt or skill and can discover connected peers/subagents.
- Terminal input must attach to the actual PTY rather than relying on a detached text box below the terminal.
- Workflow canvas and Agents page must use one live-session source of truth for running status.

## Scope

- Write set:
  - `src/ui/src/components/WorkflowRoute.tsx`
  - `src/ui/src/components/AgentsRoute.tsx`
  - `src/ui/src/components/TerminalDrawer.tsx`
  - `src/ui/src/index.css`
  - `src/ui/src/types.ts`
  - `src/wf-ui-server/*.mjs`
  - `src/wf-ui-server/__tests__/*.test.mjs`
  - `tests/anti-drift.test.js`
  - package/test files only when required
- Forbidden:
  - unrelated release files
  - unrelated Harness docs/templates except task state
  - npm publish/version changes
  - destructive git operations

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | Remove Router from default Workflow UX. | Ordinary users should understand edges directly as communication permission. | 2026-07-31 |
| 2 | Agent type is Main Agent or Subagent. | Main can create/control subagents; Subagent is a worker and cannot create more agents or task nodes. | 2026-07-31 |
| 3 | `/wf`, `/wf-max`, role, runtime, task, cwd are create-agent settings. | They are launch presets, not separate canvas node types. | 2026-07-31 |
| 4 | Use full-access/bypass startup defaults for workflow-created agents. | User wants no approval loop in managed workflow agents. | 2026-07-31 |
| 5 | Replace bottom "Type input for this PTY node" with direct terminal attach. | Current control model breaks normal conversation and is visually confusing. | 2026-07-31 |
| 6 | Bootstrap Main/Subagent agents through runtime-native initial prompt args instead of startup PTY keyboard injection. | Claude TUI can render injected text without submitting it; CLI prompt args reliably create the first user turn. | 2026-07-31 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | Toolbar plus and canvas right-click open a Create Agent panel at the intended canvas position; creating a node does not default silently to Claude and supports Main Agent/Subagent plus runtime/mode/task/cwd fields. | UI/static tests + Browser create-panel evidence | passed |
| AC-002 | Workflow canvas shows the same running agent count/status as Agents page because both are derived from one live session source; stale disk sessions do not render as running. | Server tests + Browser `/agents` consistency evidence | passed |
| AC-003 | Card mode and terminal mode are explicit controls: card has an understandable "Open Terminal"; terminal has a visible "Back to Node"; double-click opens a richer node configuration panel. | UI/static tests + Browser terminal-mode evidence | passed |
| AC-004 | Embedded terminal accepts direct user input through a real PTY attach path; the lower detached PTY input and Send Here/Route controls are removed from terminal mode. | Integration test + Browser terminal evidence | passed |
| AC-005 | Edges represent communication permission. Connected agents receive/read a workflow graph map and can identify peer/subagent relationships; Router is absent from default UI. | Unit/API tests + Main Agent `e1452dc6` spawned `a386f5a6` and `3c069b58` via `wf-ui-control.mjs`, then described `can-communicate` edges | passed |
| AC-006 | Stop/create actions have visible pending feedback, Ctrl+Z undo restores graph edits where safe, and graph state is versioned in IndexedDB/local durable state. | UI/static tests + Browser controls evidence | passed |
| AC-007 | Agents route displays the same live running sessions as Workflow plus PTY resource details including pid, provider, viewers, and memory/resource estimate when available. | API/static UI test + Browser `/agents` evidence | passed |
| AC-008 | Workflow-created agents start quietly: long role/graph instructions are written to per-node files, while terminal startup receives only a short bootstrap or no visible wall of text. | Server integration test + current Codex node evidence: `init.md` contains long startup/graph instructions, runtime passes a short `Do not print it` bootstrap prompt, transcript starts with Codex TUI rather than the init wall | passed |
| AC-009 | Create/config floating panels stay within the canvas viewport, use compact internal scrolling, and dismiss on outside click or canvas drag. | Edge Browser: create panel inside canvas, `overflowY:auto`, closed on blank canvas click | passed |
| AC-010 | Main Agent/Subagent keep the green workflow node body, while Claude/Codex/OpenCode have distinct visual identity only through the left accent strip; selection must not make the green border disappear. | Static tests + Edge Browser: node body/badge green; Claude/Codex left strips amber/sky; runtime text neutral | passed |
| AC-011 | Workflow uses a visible full-canvas dotted background with no line grid and styled scrollbars consistently. | Static tests + Edge Browser: React Flow background has circles and 0 line/path grid elements | passed |
| AC-012 | Agents route shows aggregate PTY resource totals and terminal mode self-recovers from blank xterm renders. | Static tests + prior terminal Browser evidence; no-live resource copy superseded by AC-016 | passed |
| AC-013 | Runtime brand icons appear in Workflow runtime picker, Workflow node header, Agents runtime/session rows, and Tasks rows/inspector; native selects are replaced where icons need to appear in options. | Static tests + Edge Browser: workflow nodes had icons, create-agent runtime picker showed Claude/Codex/OpenCode icon options, Agents saved rows showed runtime icons, Task runtime icon group rendered where runtime history exists | passed |
| AC-014 | Workflow node title strips duplicated Main Agent/Subagent wording because the role badge already carries that state. | Static tests + Edge Browser: node text showed `Claude Code MAIN AGENT` with badge only, and no `claude main agent` repeated title text | passed |
| AC-015 | Task inspector can show STATE.json as parsed visual status or raw JSON, and task rows/inspector show every runtime that has run a terminal session for that task. | Static tests + task-parser test + Edge Browser: visual STATE default rendered task status/phase/gate/acceptance; JSON toggle rendered raw STATE.json | passed |
| AC-016 | Agents resource summary no longer reports fake 0 B/0.0% as meaningful usage when the current wf-ui server has no live PTYs; it labels live-process-only resource sampling and saved-session history separately. | Static tests + Edge Browser: no live PTY state showed `unavailable`, live-PTY-only scope text, Saved sessions count, and no `0 B`/`0.0%` aggregate | passed |

## UI Contract

| Element | Selector | AC IDs |
|---------|----------|--------|
| Toolbar create button | `workflow-create-agent` | AC-001 |
| Canvas context menu | `workflow-context-menu` | AC-001 |
| Create Agent panel | `workflow-create-agent-panel` | AC-001 |
| Agent kind selector | `workflow-agent-kind` | AC-001 |
| Runtime selector | `workflow-agent-runtime` | AC-001 |
| Mode selector | `workflow-agent-mode` | AC-001 |
| Create submit | `workflow-create-agent-submit` | AC-001 |
| Node status | `workflow-node-status` | AC-002, AC-006 |
| Open terminal control | `workflow-open-terminal` | AC-003 |
| Back to node control | `workflow-back-to-node` | AC-003 |
| Node config panel | `workflow-node-config` | AC-003 |
| Terminal attach region | `workflow-terminal-attach` | AC-004 |
| Undo action | `workflow-undo` | AC-006 |
| Agents consistency panel | `agents-consistency-panel` | AC-007 |
| Agent resource usage | `agent-resource-usage` | AC-007 |
| Agents runtime picker | `agents-runtime-picker` | AC-013 |
| Task runtime icons | `task-runtime-icons` | AC-013, AC-015 |
| Task STATE view toggle | `task-state-view-toggle` | AC-015 |
| Task STATE visualizer | `task-state-visual` | AC-015 |

## API Contract

| Endpoint / contract | Expected behavior | AC IDs |
|---------------------|-------------------|--------|
| `GET /api/a2a/snapshot` | Returns workflow nodes from live sessions and durable pinned graph only; stale running disk sessions are downgraded. | AC-002 |
| `POST /api/terminal/start` | Accepts agent kind, runtime, mode, task, cwd, launch policy, and graph context settings. | AC-001, AC-005 |
| PTY attach channel | Provides direct bidirectional terminal input/output for an existing session. | AC-004 |
| Workflow graph persistence | Stores graph schema version and undoable node/edge mutations. | AC-005, AC-006 |
| `GET /api/sessions` | Returns live sessions with resource summary fields used by both Agents and Workflow status comparisons. | AC-002, AC-007 |
| Per-node init files | Each workflow node has a durable node home with `STATE.json` and `init.md`; agents receive `HARNESS_NODE_HOME` and can read it on first action. | AC-008 |

## Subagent Dispatch

| ID | Agent | Mode | Task | Read set | Write set | Status |
|----|-------|------|------|----------|-----------|--------|
| D1 | codebase-explorer | read | Map current Workflow/Agents/PTY state ownership and tests. | `src/ui/src/components`, `src/wf-ui-server`, `tests` | none | done |
| D2 | architect | read | Propose smallest backend/frontend contract for Main/Subagent, graph map, xterm attach, and running source-of-truth. | same as D1 plus package files | none | done |
| D3 | test-writer | write | Add RED AC-linked tests for create panel, no Router default, status source, mode controls, and stale sessions. | task PLAN, existing tests | tests only | done |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| xterm/WebSocket attach may require package changes. | Reused existing xterm path and direct session input API; no new package was needed. | mitigated |
| Browser drag/edge tests are flaky in CUA. | Static selectors and Browser create/spawn evidence cover core behavior; drag-specific E2E remains a lower-priority follow-up. | accepted |
| Running sessions from previous server instance can mislead UI. | Snapshot downgrades stale disk running sessions; `/agents` compares Workflow live to live registry. | mitigated |
| PTY memory estimates can be platform-limited. | Show pid/provider/viewers always; show memory when the host can resolve it. | mitigated |
| Long command text can be left pending in a Claude TUI input field until Enter is submitted again. | Keep agent bootstrap on runtime-native initial prompt args; for operator-routed PTY input, prefer direct terminal attach and short commands. | accepted |
| True lazy PTY startup is larger than this patch because current UI/API semantics treat created nodes as live PTY sessions. | Implement file-backed quiet bootstrap first; keep a future migration path for `created/idle` nodes without PTY. | accepted |
