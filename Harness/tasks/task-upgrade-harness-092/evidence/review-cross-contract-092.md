# Cross-contract review: retry identity and effort metadata (092)

Role: independent verifier. This review is read-only against production and
benchmark source. The only new executable artifact is
`tests/review-cross-contract-092.test.js`, using `makeHarnessTempRoot` and a
test-owned PTY/probe seam. No source, benchmark contract/schema, canonical
task/version/git state, or A2A state was modified.

## 1. Retry identity contract vs B3 scorer

Frozen contract `Harness/tasks/task-upgrade-harness-092/CONTRACTS.md:96-101`
states that identical `projectRoot + taskId + dispatchId` is idempotent, an
explicit retry is only for failed/cancelled, and there may be **at most one
retry per dispatch**, incrementing `attempt` by one.

Actual server implementation `src/wf-ui-server/server.mjs:4781-4819` enforces
the same limit: a first dispatch is `attempt: 0`; one retry creates a new
runtime session with `attempt: 1`; a further retry returns
`409 DISPATCH_RETRY_EXHAUSTED`. Existing runtime behavior also asserts the
retry `sessionId` differs (`runtime-review.test.mjs:650-675`).

Independent black-box trace in `tests/review-cross-contract-092.test.js:161-260`
confirmed all of the following through the actual server:

- dispatch A was cancelled and remained one terminal cancellation;
- independent dispatch B failed on PTY exit;
- B's one explicit retry returned `attempt: 1` with a different `sessionId`;
- the retry accepted an explicit worker-authenticated `succeeded` result;
- replaying the same retry envelope returned `replayed: true` for the retry
  session, with no extra spawn;
- total fixture spawns were exactly three (cancel A, failed B, retry B).

### Minimal RED oracle observation

The same test turns that real allowed trace into the smallest B3 evidence
packet and runs the current scorer. It observes:

```text
report.categories.B3.status = fail
report.categories.B3.code   = BAD_EVENTS
message                    = B3 raw events do not prove one dispatch/session ...
```

This is an intentional green assertion of a RED/HIGH finding: the scorer's
`scripts/harness-intelligence-bench.mjs:445` condition requires
`dispatchIds.size === 1 && sessionIds.size === 1`, while the frozen-contract
trace has two independent dispatch IDs and three sessions. The scorer also
binds every attempt to one session and one request identity at lines 454-485,
which cannot describe the server's new-session retry without distorting the
trace. The test does not weaken those checks or alter benchmark files.

Conclusion: runtime obeys the frozen one-retry/new-session contract; B3's
current one-dispatch/one-session shape rejects a legitimate cancellation plus
failed->retry-success trace. This is a benchmark/scorer contract finding for
the controller, not a runtime fix authorization.

## 2. Missing effort metadata at the actual server boundary

The independent test's second case (`tests/review-cross-contract-092.test.js:262-302`)
uses the real default native probe for OpenCode and a real project operator
config for Claude, without provider inference or PTY spawn.

### OpenCode

Installed OpenCode is 1.18.4. The actual server dispatch for
`runtime=opencode`, `model=gpt-5.6-luna`, `effort=xhigh` returned:

```json
{
  "error": { "code": "UNVERIFIED", "message": "Model effort capability is not verified" },
  "capability": {
    "sourceKind": "opencode-models",
    "verificationLevel": "authoritative",
    "reason": { "code": "MODEL_EFFORT_METADATA_UNAVAILABLE" }
  }
}
```

HTTP status was 422 and the PTY recorder count stayed zero. The model catalog
was found authoritatively, but it omitted `supportedEfforts`; because the
dispatch envelope requires a non-empty effort, the server correctly refuses
to claim that `xhigh` is supported.

The pure validator seam confirms the boundary: the same complete model-level
result without `supportedEfforts` is accepted when `effort` is empty, but throws
`UNVERIFIED / MODEL_EFFORT_METADATA_UNAVAILABLE` when `effort=xhigh`. The
dispatch normalizer rejects an empty effort at
`src/wf-ui-server/dispatch-contract.mjs:64,74`, so optional metadata does not
make a mandatory-effort dispatch claim.

### Claude operator config

The test project contained only `.claude/settings.json` with
`availableModels: ["gpt-5.6-luna"]`. The actual server dispatch with
`effort=xhigh` returned the same 422 `UNVERIFIED` and
`MODEL_EFFORT_METADATA_UNAVAILABLE`, with zero PTY spawns. Therefore, under
the current mandatory-effort dispatch contract, a Claude string-only
`availableModels` entry cannot satisfy a dispatch capability check. It would
need an operator source that also publishes effort metadata (or an explicit
future contract change making effort optional); this review does neither.

Accepted dispatches preserve `requested` and `effective` as the exact model /
effort / runtime / transport selection. Rejected capability requests create no
session and therefore expose no effective route. No general PTY target was
changed and no effort was fabricated.

## Verification command

```text
node --test tests/review-cross-contract-092.test.js
```

Result: **2 passed, 0 failed**. The first test's passing assertion is the
intentional RED/HIGH scorer rejection described above; the second is the
actual-server effort metadata gate result.

## Verdict

**Runtime contract: PASS. Scorer cross-contract compatibility: FINDING / RED.**
Controller action is required for B3 evidence-contract reconciliation; no
production or benchmark source change is proposed in this verifier write set.
