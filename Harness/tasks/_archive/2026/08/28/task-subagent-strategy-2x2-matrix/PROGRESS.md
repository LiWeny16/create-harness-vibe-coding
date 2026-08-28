# task-subagent-strategy-2x2-matrix - PROGRESS

## Current

- Phase: Archived
- Next: Reflector pass, then commit

## Wave Progress

- **W0 Exploration** ✅: 5 scouts mapped subagentMode. Gaps found and resolved.
- **W1 Backend** ✅: Rename + default change + init.md/context/env wiring + backward compat.
- **W2 UI** ✅: Defaults, AgentNodeSettings selector, rendering fixes (2 rounds).
- **W3 CLI** ✅: --subagent-mode flag, help system, context output.
- **W4 Docs** ✅: CLAUDE.md, ECC rules, agent manual updated with 2x2 matrix.
- **W5a Backend Tests** ✅: 25 matrix tests (Groups A-F), all pass.
- **W5b E2E Tests** ✅: M8 subagent settings 4/4 (required 3 fix rounds: rendering condition, double-panel, dual-kind fixture).
- **W5c Codex Coverage** ✅: Groups E-F added, runtime-aware init.md implemented, 25/25.

## Verification

| Suite | Tests | Status |
|-------|-------|--------|
| workflow-subagent-strategy-matrix | 25/25 | PASS |
| control-plane-acceptance | 43/43 | PASS |
| control-plane-cli-smoke | 12/12 | PASS |
| workflow-cooperation-enforcement | 11/11 | PASS |
| session-registry | 26/26 | PASS |
| a2a-store | 13/13 | PASS |
| **Backend Total** | **130/130** | **PASS** |
| wf-ui-m8-subagent-settings (E2E) | 4/4 | PASS |

## Acceptance Matrix — All 7 Groups Verified

| # | Cell | Status | Evidence |
|---|------|--------|----------|
| 1 | CC + built-in | ✅ | E2 green: init.md names Agent tool, no canvas nodes, degradation guidance |
| 2 | CC + wf-node | ✅ | 43/43 control-plane: E0-E18 full-chain with WF nodes, mailbox, aggregation |
| 3 | Codex + built-in | ✅ | E2/E5 green: init.md names codex_implement/tool-role path + degradation |
| 4 | Codex + wf-node | ✅ | E3/E4 green: init.md names "Claude Code implementer", worker creation verified |
| 5 | UI Settings | ✅ | M8 E2E 4/4: selector renders, default built-in, persist through save/reopen |
| 6 | NL Routing | ✅ | F1-F3 green: trigger phrases documented in init.md, default documented |
| 7 | Base Invariants | ✅ | 130/130 regression: Markdown/Excalidraw/Timer/Goal all preserved |

## Decisions

| # | Decision | Reason |
|---|----------|--------|
| D1 | Rename wf-subagents→wf-node-subagents; default built-in-subagents | User requirement |
| D2 | subagentMode flows into session, graph, snapshot, context, init.md, HARNESS_SUBAGENT_MODE | User requirement: field must be actionable |
| D3 | NL triggers documented in init.md; agent decides, not backend middleware | Keeps routing logic in agent context |
| D4 | backward compat: wf-subagents → wf-node-subagents at all boundaries | Safe migration |
| D5 | Runtime-aware init.md: claude/cc, codex, opencode each get tailored guidance | E2/E3/E5 required it |
| D6 | AgentNodeSettings only renders when fetchRuntimeNode resolves kind:'agent' | Registry maps agent→AgentNodeSettings |
| D7 | Double-panel fixed: terminal-session branch excludes nodes with SettingsComponent | Prevents WorkflowNodeSettingsPanel + AgentNodeSettings overlap |
