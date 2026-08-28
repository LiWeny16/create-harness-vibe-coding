# task-backend-api-acceptance-matrix - PROGRESS

## Current

- Phase: Archived
- W0 exploration: complete. API surface mapped (server.mjs ~3348 lines, 60+ routes). CLI tool analyzed (wf-ui-control.mjs 25 commands). Test patterns understood (node:test, in-process HTTP, temp roots, fake PTY).
- PLAN written with 41 test IDs across 4 matrices, 2 layers.
- Next: dispatch W1 Workers in parallel (L1 acceptance + L2 CLI smoke).

## Dispatch

| Worker | File | Status |
|--------|------|--------|
| worker-l1-acceptance | src/wf-ui-server/__tests__/control-plane-acceptance.test.mjs | **VERIFIED: 38/38 pass** (A1-A8, T1-T8, N1-N15, P1-P6, E1) |
| worker-l2-cli-smoke | src/wf-ui-server/__tests__/control-plane-cli-smoke.test.mjs | **VERIFIED: 11/11 pass** (10 commands + 1 negative) |

## W0 Exploration (complete)

- API routes: server.mjs 3348 lines, 60+ HTTP routes, WebSocket endpoints for terminal/wf-browser/events
- CLI tool: wf-ui-control.mjs 25 commands wrapping the HTTP API
- Test infrastructure: node:test + assert/strict, makeHarnessTempRoot, startServer({port:0}), registerPtyProcess stub pattern
- Architecture: graph in workflow-map.json, sessions in SessionRegistry + terminal-store, timer via bounded scheduler, messages via bridge-store

## Verification

- **L1 Control-Plane Acceptance**: `node --test src/wf-ui-server/__tests__/control-plane-acceptance.test.mjs` → **38/38 pass** (9.9s)
- **L2 CLI Smoke**: `node --test src/wf-ui-server/__tests__/control-plane-cli-smoke.test.mjs` → **11/11 pass** (3.9s)
- **syntax check**: both files pass `node --check`

### Coverage Matrix

| Matrix | IDs | L1 Tests | Status |
|--------|-----|----------|--------|
| Agent API | A1-A8 | 8 | PASS |
| Timer-Agent | T1-T8 | 8 | PASS |
| Node Control | N1-N15 | 15 | PASS |
| Prompt/Manual | P1-P6 | 6 | PASS |
| E2E Chain | E1 | 1 | PASS |
| CLI Smoke | - | 11 | PASS |
| **Total** | **41 IDs** | **49 tests** | **ALL PASS** |
