# Harness 0.9.2 Post-release Benchmark (pre-registered)

This protocol is fixed before implementation results are known. The parent
model designs the probes and approves the report. A fresh Luna executes them
from the installed candidate; independent Luna workers score them. Workers may
not read development-repository context or the sealed holdout file
`BENCHMARK-HOLDOUT.json`, whose concrete data is kept by the evaluator in a
separate file. A failed result triggers implementation repair, a new exact
push, and a rerun; it never changes the task or scoring question.

## Common setup and controls

1. Build/push a candidate, record the exact GitHub commit SHA and package hash.
2. In a completely new directory, install exactly that SHA/pack. Preserve a
   user-created sentinel file and verify install/update did not overwrite it.
3. Record command, environment/runtime/model/effort, start/end time, steps,
   retries, rework, recovery count, produced files, and failure state.
4. Report each category with its own `n`; one run is a `smoke` result only.
   Include a same-model/no-Harness baseline when it can be run under the same
   fixture and permissions. If equal conditions are impossible, say so and do
   not imply a causal comparison.
5. Split metrics into `estimated` and `providerMeasured`. Provider token or
   cost telemetry that cannot be obtained is `unknown`; bytes, time, or an
   invented cheap-model/platform telemetry cannot be presented as provider
   usage or cost. No single successful sample may be called SOTA or
   world-leading.

## Scenarios

### B1 — Exact install and sentinel preservation

From the pushed SHA, install into a fresh directory, retain the sentinel, and
record source SHA, package hash, version, files, and any user-file changes.
Expected: the installed behavior is the pushed candidate and the sentinel is
unchanged.

### B2 — Billing CLI context recovery

The fixture is frozen as:

```json
{
  "records": [
    {"id":"a","amountMinor":1200,"currency":"CNY"},
    {"id":"b","amountMinor":600,"currency":"CNY"},
    {"id":"r","amountMinor":-450,"currency":"CNY"}
  ],
  "initialSum": 1350
}
```

The initial CLI reports 1350 minor units. Mid-run, require
`--exclude-refunds`: negative amounts are refunds and the changed result is
1800 minor units. The fresh recovery agent receives only task context and must
implement the flag while preserving the original no-flag output. The context
must retain the change reason, unresolved items, and the status/evidence of any
failed assumption. A failed assumption cannot be revived merely by replaying a
prompt. The benchmark records initial run, interruption, context-only handoff,
changed run, and a same-model/no-Harness baseline where feasible.

### B3 — Real cross-runtime dispatch and side-effect safety

Use real Codex -> Claude execution (OpenCode may be an additional run) to
create one specified small result file. Verify request/ACK/RESULT correlation,
monotonic sequence, terminal cancellation state, and explicit failure/retry.
Repeat the same dispatch and prove it does not write a second side effect.
Record runtime/model/effort selections and unsupported-runtime errors without
silently substituting a model.

### B4 — Scoped learning, counterexample, and supersede

Teach a project-applicable rule, then present a new scene where that rule does
not apply; expected action is `skip`. Add a counterexample, supersede or
disable the rule, and recover the prior state. Record scope, evidence,
retrieval feedback, and the Probe -> Identify -> Act -> Verify trace. A single
example must not become a global prohibition.

### B5 — Reuse decision boundary

For a scenario that genuinely needs CSV parsing, consult an official,
author-maintained GitHub, or Hugging Face source and record version, license,
adopt/adapt/reject decision, evidence, and recheck trigger. Simple arithmetic
(including B2) must not force network access. The report separates source
lookup behavior from implementation success.

### B6 — CLI-only backend then UI observation

Start or reuse the backend from pure CLI for the same absolute project and
task, with no browser open. Then open the UI and verify it observes the same
canonical task/index and status. Record the returned URL, lock/reuse behavior,
and UI/API agreement. The UI is an observer/attach surface, not a second task
truth.

## Reporting and holdout

The report has one row per category and one section for baseline, with
`n`, pass/fail, smoke/full designation, steps, duration, rework, recovery,
duplicate side effects, estimated metrics, providerMeasured metrics, and
evidence paths. The evaluator scores the sealed holdout independently after
the report is frozen; workers never read its concrete data or expected values.
Holdout expectations and scoring thresholds are immutable throughout repair and
rerun.
