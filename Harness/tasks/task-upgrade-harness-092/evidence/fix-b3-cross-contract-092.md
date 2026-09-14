# B3 cross-contract scorer repair

Date: 2026-09-09
Role: bounded scorer/fixture worker

## Scope

The independent runtime trace in `evidence/review-cross-contract-092.md` is a
valid frozen-contract shape: one cancellation dispatch, a separate dispatch
that fails once and succeeds on its single retry in a new session, and a replay
that adds no spawn/write side effect. The independent review test remains
unchanged; its old `status=fail` assertion is intentionally left for the
independent reviewer to update.

## TDD evidence

RED before the scorer change:

```text
node --test --test-name-pattern="B3 accepts an independent cancellation" tests/harness-intelligence-bench.test.js
1 test failed: BAD_EVENTS (the old one-dispatch/one-session guard)
```

GREEN after the minimal change:

```text
node --test --test-name-pattern="B3" tests/harness-intelligence-bench.test.js
6 passed, 0 failed

node --test tests/harness-intelligence-bench.test.js tests/harness-intelligence-bench-review.test.js
15 passed, 0 failed

node scripts/harness-intelligence-bench.mjs --validate-fixture
ok: true
```

The unchanged cross-contract review test now fails only because it still
asserts the old scorer rejection:

```text
node --test tests/review-cross-contract-092.test.js
1 passed, 1 failed
actual 'pass' !== expected 'fail' at the old RED assertion
```

The second effort-metadata case still passes. This test was not edited.

## Changes

- `scripts/harness-intelligence-bench.mjs`: B3 now joins each event by
  dispatch/attempt and requires one request, ACK, and terminal per attempt.
  The retry dispatch preserves one request identity, uses a distinct retry
  session, is limited to one retry (`attempt === 2` in the normalized trace),
  and must be accompanied by exactly one independent cancellation dispatch.
  Effects are checked per dispatch and per attempt, with stable idempotency
  keys, one result write, and no stale request/session/task/replyTo joins.
- `tests/harness-intelligence-bench.test.js`: updated the broad scorer fixture
  to the frozen contract shape and added valid, stale-`replyTo`, second-retry,
  and reused-session cases. Temp roots continue to use `makeHarnessTempRoot`
  and are removed in `afterEach`.
- `benchmarks/harness-intelligence-092/manifest.json`, `README.md`,
  `evidence-template.md`, and `report.schema.json`: documented the independent
  cancellation dispatch, one-retry/new-session rule, replay no-side-effect
  evidence, and optional task/retry dispatch fields.

No runtime/server, `CONTRACTS.md`, canonical task, version, or git state was
modified. No package publish, stage, commit, or push was performed.
