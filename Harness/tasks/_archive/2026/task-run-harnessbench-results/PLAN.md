# task-run-harnessbench-results - PLAN

Compact task record. Keep only facts needed to resume, review, and verify.

> Task ID: task-run-harnessbench-results

## Goal

- Outcome: Run an external HarnessBench proof pass and update README/README-CN so readers can see measurable Harness value versus direct runs and adjacent coding-agent frameworks.
- Non-goals: Ship benchmark fixtures inside generated Harness installs; fabricate model A/B results without raw run evidence; refactor unrelated Harness workflow files.

## Decisions

- Keep benchmark assets outside `Harness/` and `templates/`; generated user installs may include result summaries only.
- Treat deterministic local lifecycle checks as reproducible proof, and separate them from any future LLM-run A/B measurements.
- Score from raw JSON results so direct-run, Harness, and third-party-framework runs can be compared with nullable/non-applicable fields instead of hidden assumptions.

## Acceptance

- AC-001: External benchmark assets exist outside `Harness/` and `templates/`, with a documented scoring contract.
- AC-002: A local benchmark scorer can compute task success, quality, boundary stability, verification, and efficiency summaries from raw result JSON.
- AC-003: README and README-CN show clear measured value, current boundaries, and a comparison table against direct-run and adjacent frameworks.
- AC-004: Generated user installs contain no benchmark suite files.
- AC-005: Verification commands and one independent review pass complete with evidence recorded here.

## Scope

Allowed write set:
- `benchmarks/**`
- `docs/benchmarks/**`
- `scripts/harness-bench.mjs`
- `tests/harness-bench.test.js`
- `README.md`
- `README-CN.md`
- `tests/generator.test.js`
- `.harness-version` / ownership manifests only if required after source/template boundary changes
- `Harness/tasks/task-run-harnessbench-results/**`
- `Harness/PROGRESS.md`

Forbidden:
- Adding benchmark files under `Harness/benchmarks/**`
- Adding benchmark files under `templates/common/Harness/benchmarks/**`
- Broad workflow refactors unrelated to benchmark evidence
- Truth files outside this task unless a benchmark/result update requires them

## Memory Preflight

- Memory preflight: done
- Memory hints: none

## Context

- Loaded: `CLAUDE.md`, `Harness/MEMORY.md`, `Harness/README.md`, `Harness/PROGRESS.md`, WF specs from current session summary.
- Assumptions: User wants the benchmark run by this repository as external proof assets; generated Harness users should see results, not receive the benchmark suite.

## Agents

| Role | Read / Write Set | Result |
|------|------------------|--------|
| reviewer | benchmark docs, README deltas, tests | PASS; low findings fixed for README version heading and task-capsule evidence drift |

## Verification

- [x] `node scripts/harness-bench.mjs --input benchmarks/results/harnessbench-local-v0.1.json --markdown`
- [x] `node --test tests/harness-bench.test.js tests/generator.test.js tests/validate-harness.test.js`
- [x] `node --test tests/update-collision.test.js tests/ownership-manifest.test.js tests/task-state.test.js tests/harness-bench.test.js tests/generator.test.js tests/validate-harness.test.js`
- [x] `npm test`
- [x] `node Harness/scripts/task-state.mjs validate --strict --json`
- [x] `node Harness/scripts/validate-harness.mjs`
- [x] `node templates/common/Harness/scripts/validate-harness.mjs`
- [x] `node scripts/build-version.mjs --check`
- [x] Independent benchmark/readme review

## Risks

- Real model A/B success-rate claims still need raw CLI/API run logs. Current README labels the published result as deterministic lifecycle proof only.

## Expanded Contracts

### Validation Matrix

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
| AC-001 | PASS | `benchmarks/README.md`, `docs/benchmarks/HarnessBench.md` | Assets live outside `Harness/` and `templates/`. |
| AC-002 | PASS | `scripts/harness-bench.mjs`, `tests/harness-bench.test.js` | Scorer computes summaries from raw JSON. |
| AC-003 | PASS | `README.md`, `README-CN.md` | README shows lifecycle proof, cache proof, and adjacent-tool comparison with claim boundaries. |
| AC-004 | PASS | `tests/generator.test.js`; `rg --files Harness templates/common/Harness \| rg "benchmarks?"` | Generated/template benchmark suite boundary covered by tests; no benchmark suite files under template Harness paths. |
| AC-005 | PASS | Verification checklist above; reviewer PASS | Full test/validator chain passed and independent review completed. |
