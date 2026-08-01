# task-terminal-input-control - PROGRESS

Compact heartbeat.

## Current

- Phase: Implementation
- Next: Implement terminal helper, controlled drawer/embedded behavior, and drop-files API.
- Blocker: none

## Verification

- [ ] `node --test tests/anti-drift.test.js`
- [ ] `node --test src/wf-ui-server/__tests__/server.integration.test.mjs`
- [ ] `npm --prefix src/ui run typecheck`
- [ ] `npm --prefix src/ui run build`
- [ ] browser check on WF UI terminal copy/drop path

## Log

| Date | Phase | Note |
|------|-------|------|
| 2026-08-01 | Intake | User reported Codex control-sequence text entering the WF UI terminal input, broken copy shortcuts, missing file drag/drop, and poor terminal responsiveness. |
| 2026-08-01 | Plan | Decided to keep xterm.js as renderer and build a controlled WF UI terminal shell around input ownership, clipboard, file drop upload, and read-only embedded viewers. |
| 2026-08-01 | Test RED | `node --test tests/anti-drift.test.js` fails because `src/ui/src/terminalControl.ts` does not exist; `node --test src/wf-ui-server/__tests__/server.integration.test.mjs` fails because `/api/sessions/:id/drop-files` returns 404. |
