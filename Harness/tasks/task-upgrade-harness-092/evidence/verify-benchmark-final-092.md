# Independent benchmark fixture verification (2026-09-09)

This is fixture/oracle verification only.  No real post-release benchmark,
fresh-install run, manual review, holdout run, version bump, push, scorer
change, schema change, product change, or canonical task-state change was
performed by this lane.

## Bounded test results

| Check | Result |
|---|---|
| `node --test tests/harness-intelligence-bench.test.js` | 7/7 pass |
| `node --test tests/harness-intelligence-bench-review.test.js` | 4/4 pass (B3/B4/B6 are deliberate RED assertions; B2 is GREEN) |
| `node scripts/harness-intelligence-bench.mjs --self-check` | pass |
| `node scripts/harness-intelligence-bench.mjs --validate-fixture --json` | pass; no holdout/answer file detected |
| isolated temp-leak run of both test files | pass; both child tests exit 0 and `newTempRoots: []` |
| `node --test tests/anti-drift.test.js` | 21/21 pass |

The original good-path fixture now uses the frozen scorer contract:

- B3 is one session with `attempt 1 cancelled -> attempt 2 failed -> attempt
  3 successful retry`; every event carries dispatch/session/request/attempt
  identity and its own `replyTo`.
- B4 keeps the effective rule projection stable, preserves the exact original
  audit prefix, and appends counterexample/restore history.
- B6 uses a complete 1x1 PNG with valid chunks, CRCs, inflated scanline, and
  canonical CLI/UI/state observations.  The signature-only PNG remains in the
  independent RED review fixture and is still rejected.

## B6 decoder boundary

The PNG path does more than a header check: it validates chunk boundaries and
CRCs, inflates IDAT bytes with `node:zlib`, and checks the decoded scanline
length/filter bytes.  The valid PNG good path passed and the signature-only
PNG RED passed.

The repository has no mature JPEG/WebP decoder dependency.  Read-only probes
confirmed that syntactically plausible but non-decodable JPEG and WebP byte
streams can pass the scorer's lightweight marker/frame checks (reported as
1x1).  Therefore those branches are structural validation, not true pixel
decoding, and must not be described as real image decoding.  The benchmark
fixture deliberately uses PNG only; a later scorer decision should either
make JPEG/WebP explicitly unsupported or adopt an existing decoder dependency.
Browser provenance and independent manual UI review remain required even for
a structurally valid PNG.

Status: fixture lane PASS for the frozen test contract, with the JPEG/WebP
decoder limitation explicitly pending owner decision.  This is not a formal
benchmark pass and no manual-review result was fabricated.
