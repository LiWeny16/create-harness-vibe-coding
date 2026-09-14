# task-harden-update-compatibility - PLAN

## Goal

Harden backward-compatible install/update flows with minimal state, bounded writes, transactional recovery, task view synchronization, native review timeouts, and wf-ui package-size guards.

## Scope

Write set:
- `src/generator.js`, `src/index.js`, and generated package metadata for the
  single runtime/scope contract.
- `Harness/scripts/wf-update-check.mjs`,
  `Harness/scripts/wf-update-runner.mjs`, and their template mirrors for the
  bounded update engine, timeout, lock, and ephemeral recovery state.
- `Harness/scripts/task-state.mjs` and its template mirror for derived task
  progress synchronization and closed-focus protection.
- Native `wf-review` runtime guidance and package/test guards for bounded
  reviewers and lazy `wf-ui` loading.
- AC-linked regression tests and this task's evidence.

Forbidden:
- A second npm package, database, daemon, global cache, persistent event log,
  broad workspace scan, or writes outside the selected project/global roots.
- Removing old commands, legacy task fields, or compatibility fallbacks.
- Invoking external CLIs from `wf-review`.

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | Collapse the upgrade into one runtime boundary, one updater engine, and one task state source. | Keeps the final architecture small and avoids parallel mechanisms. | 2026-09-08 |
| 2 | Store scope provenance in existing `.harness-version`; infer legacy installs when fields are absent. | Fixes global bridge routing without creating another state database. | 2026-09-08 |
| 3 | Keep update lock/journal/staging ephemeral under the target Harness temp area and clean successful runs. | Provides recovery without polluting the user system. | 2026-09-08 |
| 4 | Keep `STATE.json` authoritative and regenerate `INDEX.json`/`PROGRESS.md` as views. | Removes task status drift while preserving the existing file protocol. | 2026-09-08 |
| 5 | Keep review supervision bounded and in-memory; persist no review database. | Prevents hangs and recursion with minimal runtime state. | 2026-09-08 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | Global bridge metadata routes update to the global runtime and never expands into a full project scaffold on re-entry. | `tests/cli-smoke.test.js`: bridge re-entry routes to the global runner; `tests/generator.test.js`: bridge/runtime metadata split. | passed |
| AC-002 | Old project installs without manifest/runner retain safe recovery and legacy aliases without overwriting user files. | Existing CLI recovery and legacy alias suites remain green. | passed |
| AC-003 | Update commands share bounded timeout/exit-code behavior and an ephemeral lock/recovery contract. | `tests/wf-update-runner.test.js`: timeout returns `3`; global post-contract includes `scan-clean`; checker uses target-local lock/journal/staging. | passed |
| AC-004 | Update apply is staged and version metadata advances only after the commit succeeds. | `wf-update-check.mjs` validates all fetched hashes, stages writes, commits through a journal, and writes version tracking only after commit; existing hash-mismatch suite remains green. | passed |
| AC-005 | Closing a task synchronizes STATE, INDEX, and PROGRESS; closed tasks cannot become active focus. | `tests/task-state.test.js`: closeout sync and closed-focus rejection; strict task-state validation passes. | passed |
| AC-006 | `wf-review` remains native-only/bounded and ordinary CLI startup does not eagerly load wf-ui; package size stays within budget. | Native-only review contract remains in review skill/manager; `tests/pack-smoke.test.js` enforces size/artifact budget; wf-ui lazy-load suites pass. | passed |
| AC-007 | Existing command surfaces, source/template mirrors, validators, and full regression suite remain green. | `npm test`: 299 passed, 1 skipped, 0 failed; strict validator, `git diff --check`, and `build-version --check` pass. | passed |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Global bridge metadata may be absent in old projects. | Infer only from existing paths and write metadata after a successful controlled update. | mitigated |
| Transaction recovery could leave temporary files. | Use one target-local temp directory, stale-run recovery, and cleanup on success. | mitigated |
| Legacy progress rows may not contain historical close dates. | Never invent historical dates; mark migration time only when normalizing. | accepted |
