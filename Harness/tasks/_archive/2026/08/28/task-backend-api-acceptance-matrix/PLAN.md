# PLAN — Backend API Control-Plane Acceptance Matrix

## Goal

Prove backend can fully control Agent nodes, observe node maps, control functional nodes, and verify Timer-Agent real interaction chains — not "each feature works alone" but a complete chain: user intent → API create/connect → Markdown share → structured request → B/C reply → Timer wakeup → Goal read/aggregate/check → done.

## Scope

41 test IDs across 4 matrices, delivered in 2 layers + 1 E2E chain:

| Matrix | IDs | Count |
|--------|-----|-------|
| Agent API (A) | A1–A8 | 8 |
| Timer-Agent (T) | T1–T8 | 8 |
| Node Control (N) | N1–N15 | 15 |
| Prompt/Manual (P) | P1–P6 | 6 |
| E2E Chain | E1 | 1 |

### Layer 1: Backend In-Process Integration
- Uses `node:test` + in-process HTTP server (same pattern as workflow-api-integration.test.mjs / workflow-team-flow.test.mjs)
- Fake PTY via registerPtyProcess/unregisterPtyProcess
- Tests all Agent, Timer, Node, and Prompt matrices at the API level
- File: `src/wf-ui-server/__tests__/control-plane-acceptance.test.mjs`

### Layer 2: CLI/API Smoke
- Uses `Harness/scripts/wf-ui-control.mjs` via `spawn(process.execPath, [...])` 
- Proves Agent can actually use these interfaces through the CLI
- File: `src/wf-ui-server/__tests__/control-plane-cli-smoke.test.mjs`

### E2E Chain
- Single integration test tying all layers together
- Included in Layer 1's final section

## Architecture Decisions

- **D1**: Share temp-root infrastructure with existing tests. Use `makeHarnessTempRoot()` from `tests/support/temp-root.js` where available, inline helper otherwise.
- **D2**: Layer 1 uses in-process backend functions directly (no HTTP server needed for most tests). Pattern: seed graph nodes → call store functions → assert state. Use HTTP server only for tests that specifically verify HTTP-level behavior (A1 create via POST, A2 readGraph).
- **D3**: Layer 2 spawns real `node Harness/scripts/wf-ui-control.mjs` subprocesses against a running in-process HTTP server. Pattern from workflow-agent-communication.test.mjs `runNode()` helper.
- **D4**: Prompt/Manual tests (P1-P6) verify the *presence* of required fields in context/manuals, not the full content (schema validation already exists in workflow-node-manual-schema.test.mjs).
- **D5**: Timer tests use real timer-wakeup-scheduler.mjs functions with short intervals (100ms-500ms) to keep tests fast.

## File Plan

| File | Purpose | Layer |
|------|---------|-------|
| `src/wf-ui-server/__tests__/control-plane-acceptance.test.mjs` | In-process integration: A1-A8, T1-T8, N1-N15, P1-P6, E1 | L1 |
| `src/wf-ui-server/__tests__/control-plane-cli-smoke.test.mjs` | CLI smoke: verify key commands via spawn | L2 |

## Subagent Dispatch (D-GATE)

### W0 — Shared Infrastructure (serial, blocks all waves)
- **Worker-Infra**: Write shared test helpers (temp root with seeded graph nodes, agent sessions, timer, goal, markdown, file, excalidraw nodes)

### W1 — Test Matrices (parallel, disjoint files)
- **Worker-Agent**: A1–A8 (Agent API matrix) — `control-plane-acceptance.test.mjs` Agent section
- **Worker-Timer**: T1–T8 (Timer-Agent matrix) — `control-plane-acceptance.test.mjs` Timer section
- **Worker-Node**: N1–N15 (Node control matrix) — `control-plane-acceptance.test.mjs` Node section
- **Worker-Prompt**: P1–P6 (Prompt/Manual matrix) — `control-plane-acceptance.test.mjs` Prompt section
- **Worker-E2E**: E1 (end-to-end chain) — `control-plane-acceptance.test.mjs` E2E section

### W2 — CLI Smoke (serial after W1, uses same server pattern)
- **Worker-CLI**: `control-plane-cli-smoke.test.mjs`

### Integrity Gate
- Each Worker writes to its own section of the test file (disjoint sections)
- W1 Workers produce separate file fragments that CEO merges
- Final merge + verification

## Acceptance Criteria

- All 41 test IDs pass with `node --test`
- E2E chain E1 completes the full user-intent → API → reply → wakeup → goal chain
- CLI smoke verifies at least: create-agent, workflow-node-map readGraph, workflow-context, send-agent-message, read-agent-messages, agent.sendInput
- No regression on existing test suite
