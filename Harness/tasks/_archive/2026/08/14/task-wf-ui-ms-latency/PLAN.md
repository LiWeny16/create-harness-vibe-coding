# task-wf-ui-ms-latency - PLAN

## Goal

工业级毫秒级延迟：画布/agents/tasks 状态更新从 5–10s 轮询压到亚秒级推送；冷/热加载毫秒级。

## Measured baseline (2026-08-14, live server 56670)

| Endpoint | Cost |
|---|---|
| `/api/a2a/snapshot` full build (320 sessions) | ~1047ms |
| `/api/a2a/snapshot?since=fp` unchanged | 13ms |
| `/api/sessions` / `?all=1` / `/api/cleanup/summary` | 96 / 71 / 144ms |
| `/api/runtimes` | 1ms |
| `/api/runtimes` while 3 snapshot builds in flight | 2807ms (event-loop blocked) |

## Root causes

1. No push path: WS `/ws/events` only watches `Harness/tasks/`; frontend never reloads on WS events (footer indicator only).
2. AgentsRoute polls every 1200ms with `/api/a2a/snapshot` ttl=1200ms → full ~1s snapshot build every poll → backend saturated.
3. `apiJsonCached` stale-return double hop: stale entries return old value + background refresh; fresh data lands next poll only (5–10s display lag).
4. Dock: `autoDockCapsuleNode` awaits backend POST before local `updateGraph` (no optimistic update).
5. `buildWorkflowSnapshot` rescans 320 session dirs every call (no memoization).

## WS contract (pinned, consumed by all packages)

Backend `/ws/events` broadcasts:

```json
{ "type": "graph.changed", "seq": 1, "ts": "ISO", "source": "a2a|tasks", "payload": { "fingerprint": "..." } }
```

- Source `a2a`: anything under `Harness/a2a/` changed (debounce 250ms, `fs.watch` recursive — same pattern as the existing tasks watcher in ws-events.mjs).
- Frontend `useServerConnection` dispatches `window.dispatchEvent(new CustomEvent('harness:graph-changed', { detail: { source } }))` on `graph.changed` and `task.updated`.
- Consumers reload with debounce (trailing 250ms): WorkflowRoute → `reload(false)`, AgentsRoute → `loadControlPlane(true)`, TaskList → `loadTasks(true)`.

## Work packages (parallel, disjoint write sets)

- **A backend-ws-push**: `src/wf-ui-server/ws-events.mjs` + `src/wf-ui-server/server.mjs` — a2a watcher + `graph.changed` broadcast.
- **B backend-snapshot-memo**: `src/wf-ui-server/a2a-store.mjs` — session-scan mtime cache + memoized `buildWorkflowSnapshot` (key = stateFingerprint, TTL 250ms, exported invalidation for watcher).
- **C frontend-sync-wiring**: `src/ui/src/api.ts`, `hooks/useServerConnection.ts`, `components/AgentsRoute.tsx`, `components/TaskList.tsx`.
- **D workflow-route-optimistic**: `src/ui/src/components/WorkflowRoute.tsx` — optimistic dock + push-reload wiring (poll stays as fallback).

## Verification (main agent)

1. `node --test src/wf-ui-server/__tests__` green.
2. `cd src/ui && npm run typecheck` green.
3. Live probes on 56670: snapshot warm <100ms; fingerprint unchanged 13ms; WS event fires within 250ms of a file touch under `Harness/a2a/`; dock POST parallel latency unaffected by concurrent snapshot builds.
4. Playwright smoke (if feasible): canvas renders, dock e2e still passes.

## Constraints

- Snapshot response shape unchanged (tests depend on it).
- Polls remain as fallback; WS is the primary path.
- No new dependencies.

## Scope

Write set:
- `src/wf-ui-server/ws-events.mjs` (A)
- `src/wf-ui-server/server.mjs` (A)
- `src/wf-ui-server/a2a-store.mjs` (B)
- `src/ui/src/api.ts` (C)
- `src/ui/src/hooks/useServerConnection.ts` (C)
- `src/ui/src/components/AgentsRoute.tsx` (C)
- `src/ui/src/components/TaskList.tsx` (C)
- `src/ui/src/components/WorkflowRoute.tsx` (D)

Forbidden:
- `Harness/a2a/**/state.json`, `Harness/a2a/workflow-map.json` (backend-owned runtime state — never hand-edit)
- Any file outside the write set
- No new npm dependencies

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| D-001 | 4 parallel haiku subagents, disjoint write sets; main agent integrates + verifies | user requested haiku subagents; disjoint sets allow parallelism | 2026-08-14 |
| D-002 | WS primary + poll fallback (not poll removal) | risk isolation; keep 5s poll as degraded-mode safety | 2026-08-14 |
| D-003 | Snapshot memo keyed by stateFingerprint, TTL 250ms, explicit invalidation on watcher events | serve ms-level warm snapshots; no staleness beyond debounce window | 2026-08-14 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | `graph.changed` WS event fires ≤250ms after any file change under `Harness/a2a/` | live WS probe | pending |
| AC-002 | Warm `/api/a2a/snapshot` <100ms (from ~1047ms) | live timing probe | pending |
| AC-003 | AgentsRoute poll no longer triggers full snapshot build per 1.2s tick | code + live server CPU observation | pending |
| AC-004 | Dock visual applies optimistically (<50ms), rollback on POST failure | code path + manual drag check | pending |
| AC-005 | Backend tests + frontend typecheck green | node --test / tsc --noEmit output | pending |
| AC-006 | No change to snapshot response shape (existing tests pass) | a2a-store tests | pending |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Haiku subagents edit a 10k-line React file imprecisely | pinned file:line anchors + typecheck gate; integrator reviews diff | open |
| Memo cache serves stale data on rapid writes | 250ms TTL + explicit invalidation from watcher; fingerprint key | open |
| fs.watch recursive flakiness on Windows | same pattern already used by tasks watcher; poll fallback remains | open |
| Optimistic dock rollback races the 5s poll | rollback only restores pre-gesture local state; backend is source of truth at next reconcile | open |
