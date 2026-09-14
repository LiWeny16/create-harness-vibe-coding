# Runtime/auth independent verification — 2026-09-09

Bounded scope: runtime dispatch authentication and backend isolation. No
production, docs, canonical task state, version, git, realmemory, or A2A state
files were changed.

## Results

- Authenticated good paths pass: initial ACK/progress/terminal RESULT and
  authenticated terminal replay. They use the test-owned PTY fixture's actual
  spawn-injected capability in `X-Harness-Worker-Capability`, plus body
  `sessionId`/`taskId`; no capability value is persisted in this report.
- Negative auth paths pass: missing capability, wrong session identity, wrong
  capability, stale session attempt, and old capability presented to the retry
  session. Rejected reports do not write terminal capsule events.
- `runtime-review.test.mjs` focused runtime/auth selection: 16/16 pass when the
  retained unknown-model-capability case is excluded.
- Full `runtime-review.test.mjs`: 16/17 pass. The one intentional pending
  failure is `gpt-9-model-does-not-exist-092` returning HTTP 201 instead of the
  expected 422; the test remains strict and unchanged.
- `tests/runtime-review-backend.test.js`: 1/1 pass (physical project and
  symlink alias reuse one backend); its temp-leak guard passes.
- Runtime focused temp-leak guard passes (6/6); no temp roots remain from this
  run.

## Contract provenance

The legitimate worker identity was obtained from the fixture's real recorded
spawn options, not from backend-private state, response data, or disk. The
production adapter maps the same service-injected value to
`HARNESS_WORKER_CAPABILITY`; report requests send it in the dedicated header.
Session and attempt binding failures remain visible as auth/conflict outcomes;
this verifies source binding only, not complete malicious-process isolation or
business-result correctness.

