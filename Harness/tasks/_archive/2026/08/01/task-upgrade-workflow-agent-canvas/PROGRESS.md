# task-upgrade-workflow-agent-canvas - PROGRESS

## Current

- Phase: Archived
- Next: Closed; all requested Workflow/Agents/Tasks icon, theme, STATE visualizer, resource wording, and quiet bootstrap requirements are verified.
- Blocker: none

## Verification

- [x] RED AC-linked tests
- [x] targeted tests
- [x] `npm test`
- [x] `npm run typecheck` in `src/ui`
- [x] Browser validation against running wf-ui

## Log

| Date | Phase | Note |
|------|-------|------|
| 2026-07-31 | Intake | User clarified Main Agent/Subagent model, no default Router, direct PTY attach, explicit create panel, richer config, stop feedback, undo, IndexedDB versioning, and grid background. |
| 2026-07-31 | Dispatch | Spawned codebase-explorer, architect, and test-writer with bounded read/write sets. |
| 2026-07-31 | Scope update | Added AC-007: Agents route must show Workflow-consistent live sessions plus PTY pid/provider/viewers/memory resource details. |
| 2026-07-31 | Implementation | Reworked Workflow to Main Agent/Subagent nodes, removed default Router/legacy left panel, added direct xterm attach, graph persistence, undo, node config, status feedback, cleanup/resources, and Codex update prompt handoff. |
| 2026-07-31 | Protocol | Added `wf-ui-map` and `wf-ui-control.mjs`; Main Agents receive wf-ui URL/token and can create/send to managed PTY subagents, while Subagents can read/describe but cannot create nodes. |
| 2026-07-31 | Fix | Replaced brittle startup keyboard injection for agent bootstrap with runtime CLI initial prompt arguments; kept delayed PTY sequence only for explicit initialInput workflows. |
| 2026-07-31 | Verification | `node --test tests\anti-drift.test.js src\wf-ui-server\__tests__\runtime-detector.test.mjs src\wf-ui-server\__tests__\pty-adapter.test.mjs src\wf-ui-server\__tests__\a2a-store.test.mjs src\wf-ui-server\__tests__\server.integration.test.mjs tests\generator.test.js` passed 99 tests. |
| 2026-07-31 | Verification | `npm run typecheck` and `npm run build` passed in `src/ui`. |
| 2026-07-31 | Browser | Browser validation on local wf-ui port 63252: created Main Agent `e1452dc6`, observed reply, graph summary `18 nodes/1 edge`, spawned Subagent `a386f5a6`, and `/agents` showed Workflow live=2 / Running PTYs=2 with pid/provider/memory rows. |
| 2026-07-31 | Browser | Continued-dialogue check: sent a follow-up message into Main Agent PTY; it ran `wf-ui-control.mjs describe` and replied that live nodes are Main Agent `e1452dc6` plus Subagent `a386f5a6`, connected by `can-communicate`. |
| 2026-07-31 | Verification | Full `npm test` passed: 279 pass, 1 skipped. |
| 2026-07-31 | Acceptance | Main Agent `e1452dc6` accepted PTY input, replied `ACK`, described the graph, and spawned managed Subagent `3c069b58` with PID 39220. Final state: 3 live PTYs, 20 workflow records, 3 graph edges. |
| 2026-07-31 | Intake | User requested quiet/minimal agent startup, bounded dismissible create panel, stable selected node border, distinct kind/runtime colors, full-canvas grid, aggregate resource stats, and blank terminal recovery. |
| 2026-07-31 | Product adjustment | Replaced the line grid with a dotted canvas background and restored green workflow node bodies; Claude/Codex/OpenCode now differ through the left runtime accent strip only. |
| 2026-07-31 | Correction | Restricted runtime colors to the left strip only; saved status badge and node runtime text no longer make Claude cards read orange. |
| 2026-07-31 | Verification | `node --test tests\anti-drift.test.js`, `npm run typecheck`, and `npm run build` passed after the color correction. |
| 2026-07-31 | Browser | Edge Browser validation on wf-ui port 58262: 4 persisted workflow nodes, dotted background with 0 line/path grid elements, green card body/border/saved badge, Claude amber strip, Codex sky strip, Agents resources 0 B/0.0% and saved rows CPU unavailable. |
| 2026-07-31 | Intake | User requested brand icons in runtime selectors, Workflow/Agents/Tasks rows, removal of repeated Main Agent/Subagent text in node titles, visualized STATE.json with JSON toggle, Codex black-white theme, OpenCode gray, DeepSeek/Qwen blue, and clearer explanation for 0 live PTY resource totals. |
| 2026-07-31 | Implementation | Added runtime brand picker/icons, Codex black-white and OpenCode gray identity, node title role stripping, task runtime history parsing, Task STATE visual/JSON views, and live-PTY-only Agents resource wording. |
| 2026-07-31 | Verification | `node --test tests\anti-drift.test.js`, `node --test src\wf-ui-server\__tests__\task-parser.test.mjs`, `npm run typecheck`, and `npm run build` passed. |
| 2026-07-31 | Browser | Edge Browser validation on wf-ui port 58262: workflow node icons loaded; create-agent runtime picker showed icon options for Claude/Codex/OpenCode; Agents resource summary showed unavailable/no-live-PTY instead of fake 0 B/0.0%; Task inspector rendered visual STATE and switched to raw JSON. |
| 2026-07-31 | Fix | Adjusted task parser and Task STATE visualizer so string-only acceptance entries display as `tracked` instead of fake `pending`. |
| 2026-07-31 | Verification | Closeout checks passed after final fix: `npm test` 281 pass / 1 skip, `node --test src\wf-ui-server\__tests__\*.test.mjs` 146 pass, `npm run test:e2e` 174 pass, `npm run typecheck`, `npm run build`, and `git diff --check`. |
| 2026-07-31 | Browser | Edge closeout on wf-ui port 58262: Workflow loaded 6 nodes with runtime icons and no repeated role title; picker options had icons; Agents had runtime icons plus live-PTY-only resource copy; Tasks visual STATE/JSON toggle worked and acceptance entries showed `tracked`. |
| 2026-07-31 | Acceptance | AC-001 through AC-016 are verified. AC-008 evidence includes server integration coverage plus current Codex node home `init.md` and transcript startup showing Codex TUI instead of the init wall. |
