# task-web-terminal-smoothing - PROGRESS

## Status

- Phase: Closeout
- Implementation and focused acceptance test are green.
- This direct capsule remains outside active WF focus. Visible behavior was verified with Playwright; backend state was inspected through `wf-ui` HTTP APIs. No BrowserOS Neo interaction is part of current acceptance.

## Evidence

- RED command: `$env:WF_UI_E2E_PORT='43174'; pnpm --dir src/ui exec playwright test e2e/wf-ui-m4-interactions.spec.ts --grep 'task-web-terminal-smoothing'`.
- RED result: after close/reopen, old `MAIN history 1` remained but `MAIN history 3` produced while closed was missing.
- GREEN command, rerun 2026-09-28: same command; `1 passed` (AC-001/002/003).
- `pnpm --dir src/ui run typecheck`: passed.
- `pnpm --dir src/ui run build`: passed; existing large-chunk warnings only.
- Full `wf-ui-m4-interactions.spec.ts`: terminal test and five other tests passed; two unrelated interaction tests exceeded their existing 250 ms long-task threshold (259 ms and 263 ms).
- Read-only backend API at `http://127.0.0.1:43175`: `GET /api/workflow` returned graph version 2397 with four graph nodes; `GET /api/sessions?all=1` returned three temporary QA sessions, all `stopped`, with `wsClientCount: 0`. The real WebSocket verification had observed `78x22` before its temporary session was stopped and removed from the graph.
- Three temporary QA sessions were stopped and their graph nodes removed through the backend API. The remaining records are stopped-session history.
- Earlier Neo screenshots/logs were created before the user's redirect. They are historical and are excluded from the current acceptance basis.

## Closeout

- AC-001 through AC-003: passed by the focused Playwright test.
- AC-004: API and focused Playwright checks passed; no active QA sessions or temporary Agent graph nodes remain.
- No source changes are pending for this task.
