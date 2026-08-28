# task-terminal-full-control - PROGRESS

## Current

- Phase: Archived
- Next: final verification → reflector closeout

## Three-Layer Control Surface (2026-08-13, live-proven)

1. **统一 help 注册表**: COMMAND_REGISTRY (41 entries) in wf-ui-control.mjs; `help --json` machine-readable; template mirror byte-identical
2. **send-key 原语**: up/down/left/right/enter/esc/tab/backspace — live-proven against real codex /model picker (down moved cursor 4→5, up moved back)
3. **agent.setModel 动作**: project-scope config write (TOML/JSON), user config never touched, restartRequired flag; 6/6 tests
4. **手册知识层**: terminal-control.json `tuiControl` section (char-by-char typing rule, send-key, model picker recipe, setModel preference, \r\n warnings) + byte-identical template mirror

## Key Live Evidence (2026-08-13)

- **CEO 自主执行**: char-by-char typed task → real codex CEO ran create-agent itself → implementer node b30ca6d6 created on canvas with edge
- **模型选择器导航**: /model opens picker (7 models), send-key down/up navigates, verified on screen
- **Root cause of Enter failure**: bulk-write + \r leaves text unsubmitted; per-char typing (12ms/char) + single \r works; frontend xterm always worked because it types per-keystroke

## Wave Progress

- **W0 Exploration** ✅: 4 scouts. Root cause: codex TUI flushes input buffer at init + Enter swallowed by popups + no ready-gating in injection code. Key discovery: `codex "prompt"` argv AUTO-SUBMITS (Enter-free) + `codex exec --json` headless mode.
- **W2-I1 server.mjs** ✅: writePromptSubmitInput reworked — ready-gated (❯/› marker, 250ms poll, 10s window), single \r, retry-once, stale-timer cancellation. initialPrompt pass-through verified.
- **W2-I2 CLI** ✅: `--initial-prompt` flag on create-agent.
- **W2-I4 Docs** ✅: research-results.md + architecture.md §8 three-layer trigger model.
- **W2-I1b agent-node.mjs** ✅: [harness-request] envelope delivery reworked to same gated split-\r semantics.
- **W2-Fix assertions** ✅: 10 old-semantics assertions → split-write pattern.
- **W2-Wire readiness** ✅: server.mjs feeds spawn/ready/exit signals into agent-node tracker (5 call sites).
- **W3 Tests** ✅: 14 deterministic tests + live probe. Live probe hardened through 3 false-positive classes (stdin echo → prompt repaint → ANSI escapes).
- **VERIFY Live** ✅: 4th probe run = REAL AI turn evidence.

## Verification

| Suite | Tests | Status |
|-------|-------|--------|
| workflow-terminal-control | 14/14 | PASS |
| control-plane-acceptance | 43/43 | PASS |
| control-plane-cli-smoke | 12/12 | PASS |
| workflow-agent-communication | 5/5 | PASS |
| workflow-agent-messages-structured | 6/6 | PASS |
| **Deterministic total** | **80/80** | **PASS** |
| Live probe L1 (argv auto-submit, stdin=0) | real turn ~17s, "• 42" | **VERIFIED** |
| Live probe L2 (single-\r submit) | real turn ~9s, "• 22" | **VERIFIED** |

## AC-CTRL-005 Evidence (2026-08-13)

`HARNESS_LIVE_TERMINAL_PROBE=1` live run (codex-cli 0.147.0, gpt-5.5 xhigh):
- L1: argv initialPrompt auto-submits, Enter-free (stdin entries = 0); TUI rendered "• 42" reply after Working (17s) counter
- L2: submit:true single-\r accepted; TUI rendered "• 22" reply after Working (9s) counter
- 2/2 pass, exit 0, transcripts: `Harness/.temp/live-terminal-probe-QHhKTy/transcripts/`
- Adversarial audit: all 3 false-positive classes ruled out (stdin echo, prompt repaint, ANSI escape digits)

## Known Gaps (recorded)

1. Two tracker Maps (server-local + agent-node) fed from same sites — documented coupling.
2. AC-CTRL-003 frontend drawer: backend sink fix covers it; no new dedicated E2E spec.
3. exec-mode full productization deferred (interface documented in architecture §8).
4. Live probe is per-run evidence, not determinism guarantee (model mis-answer fails the run).
