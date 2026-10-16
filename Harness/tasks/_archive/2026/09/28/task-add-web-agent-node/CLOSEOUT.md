# Closeout: task-add-web-agent-node

Date: 2026-09-28  
Status: acceptance complete; closed through `task-state transition`.

## Result

Added a standalone chat surface to existing Agent nodes for Claude Code, Codex, OpenCode, and Pi. Agent settings persist `uiMode`; chat history and live events use the canonical stream; permission-mode options come from each runtime driver. Pi uses the user-selected bundled host-gate extension over RPC, with correlated allow/deny approvals that fail closed.

## Acceptance

| AC | Result | Evidence |
|---|---|---|
| AC-1 | Pass | `src/ui/e2e/chat-agent.spec.ts`: Chat selection, settings persistence, and standalone start on the same graph node. |
| AC-2 | Pass | Driver and runtime integration coverage in `src/wf-ui-server/__tests__/chat-server-contract.test.mjs`, provider driver tests, and `workflow-unified-resume.test.mjs`; chat launch is distinct from PTY transport. |
| AC-3 | Pass | `chat-server-contract.test.mjs`: state first, ordered stored/live envelopes, and range history. |
| AC-4 | Pass | `chat-agent.spec.ts` and server contract tests: runtime-specific modes, correlated confirmation/failure, approval deduplication, and Pi host-gate request/reply. |
| AC-5 | Pass | Full `src/wf-ui-server/__tests__/*.test.mjs` passed; graph/session routes and chat wakeup integration remain covered. |
| AC-6 | Pass | Runtime resume and session-id coverage in `workflow-unified-resume.test.mjs` and provider driver suites. |
| AC-7 | Pass | Driver disposal/exit coverage in provider suites; full server suite passed. |
| AC-8 | Pass | Full UI E2E status passed (126 passed, 2 retried/flaky); `npm test` 610 passed, 1 skipped; root E2E 177/177; pack smoke 3/3. |

## Review and verification

- Focused chat UI E2E: 6/6 passed.
- Full UI E2E: status passed; two existing M3 tests required one retry after transient first-attempt timeouts. Both passed on retry and on isolated rerun.
- Full wf-ui-server suite: 894/894 passed.
- Root suite: 610 passed, 1 skipped, 0 failed.
- Root script E2E: 177/177 passed.
- `npm run pack:smoke`: 3/3 passed.
- UI production build passed.
- Pi host-gate choice is recorded in `PLAN.md` and implemented in `extensions/pi-host-gate/index.ts` and `src/wf-ui-server/drivers/pi-rpc.mjs`.

No commit, push, or package publish was performed.
