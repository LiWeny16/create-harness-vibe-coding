# task-redesign-wf-ui-agent-workflow - PROGRESS

Compact heartbeat.

## Current

- Phase: Archived
- Next: Ship route redesign; follow-up can replace the lightweight terminal pane with full xterm if native package install is available.
- Blocker: none

## Verification

- [x] targeted server tests: `node --test src/wf-ui-server/__tests__/*.mjs`
- [x] targeted UI build/tests: `pnpm build` in `src/ui`
- [x] browser-visible route check: Playwright smoke for `/agents`, `/workflow`, `/roles`
- [x] browser/PTY smoke: temporary Codex session started with `@homebridge/node-pty-prebuilt-multiarch`, `/workflow` pan changed from `translate(0px, 0px)` to `translate(55px, 40px)`, and terminal minimized as floating window.
- [x] static cache check: `index.html` served `no-cache`; Vite asset served `public, max-age=31536000, immutable`.

## Log

| Date | Phase | Note |
|------|-------|------|
| 2026-07-30 | Intake | User confirmed Agents, Workflow, wf-subagents, Harness-local isolation, config editing, and Apple-style responsive UI direction. |
| 2026-07-30 | Implementation | Reworked backend sessions so unbound terminal agents persist under `Harness/a2a/sessions`; added workflow run and runtime config APIs. |
| 2026-07-30 | Implementation | Replaced Agents with detected-CLI plus launcher, replaced Workflow with a canvas, and moved role cards to `Roles`. |
| 2026-07-30 | Verification | Server tests, UI build, and browser route smoke passed. |
| 2026-07-30 | Verification | Verified real PTY-backed Codex session launch, draggable full-height workflow canvas, floating/minimizable terminal UI, and immutable asset caching. |
