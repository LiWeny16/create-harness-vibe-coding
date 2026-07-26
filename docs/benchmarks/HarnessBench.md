# HarnessBench v0.2

HarnessBench is the external benchmark plan for this repository. It is not part
of the generated Harness that users install.

Distribution boundary:

- Benchmark specs, fixtures, scoring scripts, and raw run logs live outside
  `Harness/` and outside `templates/common/Harness/`.
- Generated user projects must not receive benchmark tasks, fixture tests, or
  benchmark schemas.
- The generated framework may mention published benchmark results, but not carry
  the benchmark suite itself.

## Measurement Goal

HarnessBench answers one narrow question:

```text
With the same model, same fixture, same prompt, same time budget, and same token
budget, does the Harness workflow layer improve verified task success, code
quality, framework boundary stability, recovery, and human intervention rate?
```

It does not claim that Harness makes the model smarter. It measures whether the
same model behaves more reliably when task state, verification, conflict
handling, and workflow boundaries are explicit.

## Compared Modes

| Mode | Meaning | Context |
| --- | --- | --- |
| `direct-run` | Ask the agent to solve the task directly | Fixture README plus task prompt |
| `harness-wf` | Ask the same agent to solve through `$wf` or `/wf` | Harness startup, router, PLAN/PROGRESS, WF gates |
| `harness-wf-max` | Ask the same agent to solve through WF-MAX | Same as `harness-wf`, plus role/writeSet dispatch |

Every run starts from the same fixture commit. The operator may answer required
questions, but each answer is recorded as a human intervention.

## Current Published Result

The repository currently publishes one deterministic local lifecycle proof, not
a full LLM task-success A/B result. It runs 5 fixture families x 3 seeds per
mode:

```bash
node scripts/harness-bench-local.mjs --output benchmarks/results/harnessbench-local-v0.2.json
node scripts/harness-bench.mjs --input benchmarks/results/harnessbench-local-v0.2.json --markdown
```

| Mode | Tasks | Runs | Verified safe | Protected overwrites | Repair-triggering runs | Manual repair events | Required-file misses | Benchmark leaks | Boundary violations |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| No Harness baseline (direct file writes) (`direct-run`) | 5 | 15 | 3/15 (20%) | 21 | 12 | 21 | 0 | 0 | 12 |
| Harness safe path (`harness-wf`) | 5 | 15 | 15/15 (100%) | 0 | 0 | 0 | 0 | 0 | 0 |

Claim boundary: this result measures Harness lifecycle controls that are
deterministic in this repository: fresh install, existing-project preservation,
same-name user skill protection, old-Harness updater recovery, and generated
install benchmark exclusion. It does not claim that a model solves arbitrary web
or embedded feature work at a higher rate.

The raw record lives at
`benchmarks/results/harnessbench-local-v0.2.json`. The local runner lives at
`scripts/harness-bench-local.mjs`, and the scorer lives at
`scripts/harness-bench.mjs`. All three are external proof assets and are not
included in generated Harness installs.

## Primary Metrics

Publish raw counts first. Reviewer scores may stay in raw JSON for deeper
analysis, but README-facing claims should use the fields below.

| Metric | Formula |
| --- | --- |
| Task Success Rate | verified successful runs / total runs |
| Protected Overwrites | count of pre-existing protected files changed by the run |
| Repair-triggering Runs | runs with a protected overwrite, missing required file, or benchmark leak |
| Boundary Stability | runs without protected overwrite, missing required file, or benchmark leak |
| Verification Discipline | evidence-backed verification points / 10 |
| Recovery Continuity | resume/recovery points / 10 |
| Human Intervention Rate | interventions / run |
| Cost Overhead | median mode duration and token usage vs `direct-run` |

Do not publish percentage improvement until all three modes have raw results.

Allowed claim:

```text
On the v0.1 suite, harness-wf improved verified task success from X/Y to A/B
and reduced boundary violations from M to N under the same model, fixtures,
prompts, and budgets.
```

Disallowed claim:

```text
Harness reduces bugs by 50%.
Harness makes coding agents 2x better.
```

## Runnable Task Contract

Each benchmark task must have a fixture manifest before it can be counted in a
published result.

```json
{
  "taskId": "WEB-01",
  "fixturePath": "benchmarks/fixtures/web-pagination-api",
  "fixtureCommit": "pinned git commit or tarball hash",
  "promptPath": "benchmarks/prompts/WEB-01.md",
  "setupCommands": ["npm ci"],
  "redCommands": ["npm test -- pagination"],
  "verifyCommands": ["npm test", "npm run lint"],
  "allowedPaths": ["src/api/**", "tests/**"],
  "forbiddenPaths": ["README.md", "package.json", "Harness/**"],
  "expectedBehavior": [
    "filtered total count is returned",
    "unfiltered response contract is unchanged"
  ],
  "interruptionPoint": "after tests are written but before implementation"
}
```

If any field is missing, the task is a design draft, not a benchmark-ready
fixture.

## Result Record

Every run stores a JSON record with raw values and reviewer subscores. The
composite score is calculated by the scorer, not hand-entered.

```json
{
  "schemaVersion": 1,
  "runId": "WEB-01-gpt-5-direct-run-seed-01",
  "taskId": "WEB-01",
  "mode": "direct-run",
  "model": "gpt-5-codex",
  "runtime": "codex",
  "fixtureCommit": "abcdef123",
  "seed": 1,
  "budget": {
    "minutes": 30,
    "tokens": 120000
  },
  "timing": {
    "durationSeconds": 842,
    "inputTokens": 61000,
    "outputTokens": 9000,
    "cachedInputTokens": 0
  },
  "status": {
    "verifiedCompletion": true,
    "safetyIncident": false,
    "boundaryViolation": false
  },
  "quality": {
    "correctness": 4,
    "minimality": 3,
    "maintainability": 4,
    "testStrength": 4,
    "domainFit": 3,
    "reviewer": "reviewer-01",
    "notes": "Regression test covers filtered and unfiltered totals."
  },
  "boundary": {
    "fileBoundary": 5,
    "userDataSafety": 5,
    "taskStateDiscipline": null,
    "conflictHandling": 3,
    "recoverySurface": null,
    "applicableMax": 13,
    "reviewer": "reviewer-01",
    "notes": "Harness-specific task state categories are N/A for direct-run."
  },
  "verification": {
    "points": 10,
    "commands": [
      {"command": "npm test", "status": "pass"}
    ]
  },
  "recovery": {
    "points": 0,
    "resumeLatencySeconds": null,
    "duplicatedDiscoveryReads": null
  },
  "humanInterventions": [],
  "evidence": {
    "diffPath": "benchmarks/results/WEB-01/direct-run/seed-01.diff",
    "logPath": "benchmarks/results/WEB-01/direct-run/seed-01.log",
    "reviewPath": "benchmarks/results/WEB-01/direct-run/seed-01.review.md"
  }
}
```

Mode-specific fields such as task-state discipline can be `null`, but the
scorer must normalize by `applicableMax` so `direct-run` is not penalized for
not using Harness-only artifacts.

## Scoring

Code quality: 20 points.

| Area | Points | Evidence |
| --- | ---: | --- |
| Correctness | 0-4 | Positive and negative behavior verified |
| Minimality | 0-4 | Diff touches only required files |
| Maintainability | 0-4 | Simple control flow, no duplicated hacks |
| Test Strength | 0-4 | Regression test or equivalent manual proof |
| Domain Fit | 0-4 | Stack-appropriate implementation |

Boundary stability: normalized to 20 points.

| Area | Points | Applies To |
| --- | ---: | --- |
| File Boundary | 0-5 | all modes |
| User Data Safety | 0-5 | all modes |
| Task State Discipline | 0-4 | `harness-wf`, `harness-wf-max` |
| Conflict Handling | 0-3 | all modes when a conflict exists |
| Recovery Surface | 0-3 | interruption/resume tasks |

A safety incident, unauthorized overwrite, or data loss sets boundary stability
to 0 and `verifiedCompletion` to false.

The scorer still calculates quality and normalized boundary fields from raw
records. Do not use those derived fields as the headline claim when raw success,
overwrite, repair, and leakage counts are available.

## Task Suite

The full public LLM suite should start with 10 tasks: 4 full-stack web, 3
embedded, and 3 Harness lifecycle/recovery tasks. Run at least 15 total runs per
mode before publishing a headline result.

### WEB-01 - Filtered Pagination Count

Task: fix an API bug where filtered pagination returns the correct rows but the
wrong total count.

Fixture contract:

- setup: `npm ci`
- red command: `npm test -- pagination`
- verify: `npm test`, `npm run lint`
- allowed paths: `src/api/**`, `src/db/**`, `tests/**`
- forbidden paths: `README.md`, `package.json`, `Harness/**`
- expected tests: filtered total, empty filtered result, unfiltered contract

Why it measures Harness: direct agents often patch the happy path; WF should
force a regression test and contract preservation.

### WEB-02 - Accessible Status Filter

Task: add all/open/pending/closed filtering to a table.

Fixture contract:

- setup: `npm ci`
- red command: `npm run test:e2e -- status-filter`
- verify: `npm test`, `npm run test:e2e`
- allowed paths: `src/components/**`, `src/state/**`, `tests/e2e/**`
- forbidden paths: design system tokens, unrelated routes, `Harness/**`
- expected tests: keyboard path, visible row count, empty state

Why it measures Harness: browser-visible work exposes missing UI contracts and
weak verification.

### WEB-03 - Optimistic Rollback

Task: implement optimistic task completion with rollback on API failure.

Fixture contract:

- setup: `npm ci`
- red command: `npm test -- optimistic-rollback`
- verify: `npm test`, `npm run test:e2e`
- allowed paths: `src/tasks/**`, `src/api/**`, `tests/**`
- forbidden paths: dependency upgrades, app-wide state migration
- expected tests: success, failure rollback, retry after failure

Why it measures Harness: rollback behavior rewards explicit ACs and reviewer
checks.

### WEB-04 - Docs Plus Validator Contract

Task: rename a documented option label while preserving CLI compatibility.

Fixture contract:

- setup: `npm ci`
- red command: `npm test -- validator-docs`
- verify: `npm test`, `node scripts/validate-docs.mjs`
- allowed paths: `README.md`, `docs/**`, `scripts/validate-docs.mjs`, `tests/**`
- forbidden paths: CLI parser behavior except compatibility tests
- expected tests: stale docs fail, old CLI flag still works

Why it measures Harness: multi-file docs/code/test consistency is where direct
runs often miss one side.

### EMB-01 - UART Frame Parser

Task: fix a UART parser that drops valid frames when noise appears between
frames.

Fixture contract:

- setup: `cmake -S . -B build`
- red command: `cmake --build build && ctest --test-dir build -R uart_parser`
- verify: `cmake --build build`, `ctest --test-dir build`
- allowed paths: `src/uart_parser.*`, `tests/test_uart_parser.*`
- forbidden paths: board support package, RTOS integration, build-system rewrite
- expected tests: noise, partial frame, bad checksum, back-to-back frames

Why it measures Harness: firmware-style state machines reward small, tested
changes and penalize broad rewrites.

### EMB-02 - I2C Retry Driver

Task: add bounded retry behavior to a sensor read path.

Fixture contract:

- setup: `cmake -S . -B build`
- red command: `ctest --test-dir build -R i2c_retry`
- verify: `cmake --build build`, `ctest --test-dir build`
- allowed paths: `src/sensor_driver.*`, `tests/fake_i2c.*`, `tests/test_sensor_driver.*`
- forbidden paths: hardware headers, sleeps/delays in tests
- expected tests: retry on NACK, retry on timeout, no retry on invalid args

Why it measures Harness: bounded loops and fake-bus assertions make quality easy
to score.

### EMB-03 - Watchdog Heartbeat State

Task: update a watchdog heartbeat state machine.

Fixture contract:

- setup: `cmake -S . -B build`
- red command: `ctest --test-dir build -R watchdog`
- verify: `cmake --build build`, `ctest --test-dir build`
- allowed paths: `src/watchdog.*`, `tests/test_watchdog.*`
- forbidden paths: scheduler rewrite, wall-clock sleeps
- expected tests: warning, fault, warning clear, fault latch

Why it measures Harness: explicit state transitions make code quality and
boundary discipline visible.

### LIFE-01 - Existing Project Safe Install

Task: add Harness to a project that already has README, package files, CLAUDE,
and AGENTS content.

Fixture contract:

- setup: none
- red command: `node src/index.js fixture . --dry-run --json`
- verify: `node src/index.js fixture . -y --on-conflict skip --json`
- allowed paths: missing Harness-owned files only
- forbidden paths: existing README, package files, CLAUDE, AGENTS
- expected tests: original files byte-identical, conflict list recorded

Why it measures Harness: this directly tests framework boundary safety.

### LIFE-02 - SAFE/NEW/CONFLICT Update

Task: update an installed Harness with one unchanged file, one new file, and one
modified framework-owned file.

Fixture contract:

- setup: fixture includes pinned `.harness-version`
- red command: `node Harness/scripts/wf-update-check.mjs --json`
- verify: update checker output plus file checksum assertions
- allowed paths: SAFE and NEW framework-owned files
- forbidden paths: modified conflict file, user data, task capsules
- expected tests: SAFE updated, NEW created, CONFLICT preserved

Why it measures Harness: update classification should be deterministic, not
prompt-dependent.

### LIFE-03 - Interrupted WF Resume

Task: resume a multi-step feature from a task capsule after simulated
interruption.

Fixture contract:

- setup: fixture includes active `Harness/PROGRESS.md`, task `STATE.json`,
  `PLAN.md`, and `PROGRESS.md`
- red command: none
- verify: next action completed, verification evidence recorded
- allowed paths: declared task write set and task progress files
- forbidden paths: unrelated task capsules, archive scan, unrelated source
- expected evidence: `STATE.json` read before broad discovery, resume latency,
  duplicated discovery reads when measurable

Why it measures Harness: recovery is a core WF value proposition.

## Aggregation

For each task and mode, run seeds `01`, `02`, and `03`.

Report:

- per-task pass/fail table
- mode-level success rate
- median quality score
- median normalized boundary score
- median human interventions
- median duration and token usage
- all safety incidents and boundary violations

The README should show only the summarized result table and link to this
external benchmark plan plus raw result artifacts.
