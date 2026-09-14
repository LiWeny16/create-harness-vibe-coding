# Benchmark scorer repair evidence (092)

Scope: scorer and benchmark contract only. No real post-release benchmark,
fresh-install run, release, publish, task-state update, or frozen-contract
mutation was performed.

## RED reproduction

Command:

```text
node --test tests/harness-intelligence-bench-review.test.js
```

Observed before the repair: 4 tests, 1 pass (B2), 3 deliberate failures
(B3/B4/B6).

## Repair

- B3 now joins every request/ACK/failure/cancellation/RESULT by one
  `dispatchId` + `sessionId` + `requestId` + integer `attempt`, requires
  contiguous attempts with exactly one ACK and terminal per attempt, and binds
  the successful RESULT to the explicit current retry.
- B4 now compares the effective target-rule projection and requires the
  restored audit to preserve the before prefix and append history. It retains
  counterexample, supersede/disable, restore, and feedback evidence without
  requiring destructive whole-document byte rollback.
- B6 now parses/decompresses PNG payloads. JPEG/WebP are explicitly rejected as
  unsupported/pending rather than accepted by structural marker checks. A valid
  PNG remains only a mechanical integrity check; browser trace/observation and
  distinct manual review remain required for UI truth.

## Verification

```text
node --test tests/harness-intelligence-bench-review.test.js  # 4 pass
node scripts/harness-intelligence-bench.mjs --validate-fixture --json       # ok
node scripts/harness-intelligence-bench.mjs --self-check                    # ok
node --check scripts/harness-intelligence-bench.mjs                        # ok
```

Additional bounded fixture checks confirmed that a three-attempt B3 trace
(cancelled attempt 1, failed attempt 2, successful retry attempt 3), a B4
version/content projection with append-only audit, and a decodable repository
PNG pass their respective mechanical checks. Existing old good-path tests that
intentionally lack the stronger evidence contract remain for the independent
test writer to update; tests were not changed here.

## B6 scope correction

The independent verifier reproduced that marker-only pseudo-JPEG and pseudo-WebP
streams were accepted by the earlier structural checks. Those checks were
removed. The scorer now emits `fail / IMAGE_FORMAT_UNSUPPORTED` for `.jpg`,
`.jpeg`, and `.webp`; only the bounded PNG CRC + zlib + scanline path can pass
mechanically. Even a valid PNG still requires independent browser
trace/observation and manual UI review.

Post-correction bounded checks:

```text
node --test tests/harness-intelligence-bench-review.test.js  # 4 pass
node scripts/harness-intelligence-bench.mjs --validate-fixture --json       # ok
node scripts/harness-intelligence-bench.mjs --self-check                    # ok
```
