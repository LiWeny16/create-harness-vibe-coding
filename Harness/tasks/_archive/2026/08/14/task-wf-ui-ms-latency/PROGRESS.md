# task-wf-ui-ms-latency - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived

## Heartbeat

- **2026-08-14 21:35** — 4 haiku subagents merged (ws-push / snapshot-memo / frontend-sync / dock-optimistic). Integrator fixes: (1) removed `invalidateSnapshotCache` from `ensureA2aDefaults` (read-path initializer wiped the memo on every build — memo now hits); (2) `stateFingerprint` now includes workflow-map mtimeMs+size (memo can't serve pre-write snapshots); (3) session-scan cache fresh-file guard (1.5s) kills same-ms rewrite staleness; (4) ws-events tests hardened to skip `graph.changed` frames.
- **Verification**: backend 796/799 green (3 failures pre-existing on branch: AC-005 restart, W24 create-agent, T3/AC-024 cooperation flow — fail with memo disabled too; code paths untouched by this task). Frontend `tsc --noEmit` clean. `vite build` clean (dist regenerated).
- **2026-08-14 21:45 — live probes on restarted 56670 (user-approved restart)**: cold snapshot 1200ms; **warm 43ms** (was ~1047ms every hit); `?since=` unchanged 13ms; `/api/runtimes` during 3 concurrent snapshot builds **39ms** (was 2807ms); **WS `graph.changed` 278ms** after a2a file touch (250ms debounce + delivery). Served bundle = freshly built dist (identical index.html). All ACs met.

## Closeout

- Capsule → completed + archived (per repo open-task cap convention).
- Memory lesson recorded in `Harness/memory/agent-lessons-patterns.md` (memo invalidation must not sit on read-path initializers; memo key must include file meta).
