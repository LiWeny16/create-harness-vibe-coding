# PLAN - OTA Manifest Validation Hardening

## Goal

Make 0.8.19 OTA updates script-first, multi-scope, and safe:

- Project installs update project Harness files.
- If a global Harness runtime exists, update it too.
- If `/wf-update` is used from an uninstalled project through global command surfaces, update only the global runtime and host-global copies.
- Every update validates template coverage against `Harness/ownership.manifest.json`.
- Framework-owned files can be repaired by script; user-owned tasks, memory, project docs, and same-name unmarked host files are preserved.

## Root Cause

1. `wf-update-check.mjs` short-circuited on version match, so a partially written 0.8.18 install could report "up to date" while missing new files.
2. `validate-harness.mjs` only checked manifest-to-disk coverage, not disk-to-manifest or host-global staleness.
3. Global installs copy real command/skill files into Claude, Codex, and OpenCode host homes. Updating only the project/global runtime can leave those host copies stale.
4. The update command flow depended too much on agent judgment after update rather than mandatory script checks.

## Scope

Write set:

- `Harness/scripts/wf-update-check.mjs`
- `Harness/scripts/wf-update-runner.mjs`
- `Harness/scripts/sync-host-global.mjs`
- `Harness/scripts/validate-harness.mjs`
- `Harness/scripts/context-budget.mjs`
- `Harness/ownership.manifest.json`
- `.claude/.opencode/.agents` wf-update and task command surfaces
- `templates/common/**` mirrors
- tests covering update, validation, global sync, task-state, and wf-ui server

Forbidden:

- Do not overwrite `Harness/tasks/**`, `Harness/memory/**`, project research, root README, package files, or user project state.
- Do not delete user-looking host-global files; report conflicts instead.
- Do not let `--repair` downgrade from a newer local install to an older remote source.

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| D1 | Add `wf-update-runner.mjs` as the multi-scope entry | One command can update project + global, or global-only from uninstalled projects | 2026-07-30 |
| D2 | Add `sync-host-global.mjs` | Global host command/skill copies are what agents actually read | 2026-07-30 |
| D3 | `--repair` bypasses equal-version short-circuit only, not downgrade/prerelease protection | Repair must fix partial installs, not roll back templates | 2026-07-30 |
| D4 | `validate-harness --manifest-audit` is mandatory after update | Missing files and stale framework files must be machine-detected | 2026-07-30 |
| D5 | Host-global sync overwrites only missing or Harness-marked stale copies | Same-name user files without markers remain conflicts | 2026-07-30 |
| D6 | Context budget relaxed from 42KB to 43KB for router prefix | 0.8.19 adds wf-ui/update runner surface; still keeps a hard budget | 2026-07-30 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-REPAIR | Same-version partial installs can force a full diff | `wf-update-check --repair --json` covered by p0 tests | passed |
| AC-NO-DOWNGRADE | Repair refuses older remote sources unless a future explicit downgrade flag is designed | `update-check: prereleases are ignored and explicit older sources still refuse downgrade` | passed |
| AC-MULTISCOPE | Project install updates project + discovered global runtime; uninstalled project updates only global | `tests/wf-update-runner.test.js` | passed |
| AC-HOST-GLOBAL | Missing/stale host copies are detected and repaired by script; user-looking files conflict | `validate-harness.test.js` sync-host-global tests | passed |
| AC-MANIFEST | Manifest audit checks frameworkOwned coverage and extra Harness-owned files | `node Harness/scripts/validate-harness.mjs --manifest-audit` | passed |
| AC-CONTEXT | Context budget passes with 0.8.19 hot path | `node Harness/scripts/context-budget.mjs --json` | passed |
| AC-WF-UI | 0.8.19 still ships wf-ui backend/control-plane tests cleanly | `node --test src/wf-ui-server/__tests__/*.test.mjs` | passed |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| npm/GitHub mirrors are still 0.8.18 before publish | `check:mirrors` stays failing until release artifacts are pushed | open |
| Old installs without runner need fallback | wf-update docs still provide single-scope `wf-update-check` and safe `npx ... --on-conflict skip` recovery | mitigated |
| Extra user files in Harness-looking dirs could be mistaken for framework files | Marker-based ownership keeps unmarked files as warnings/conflicts | mitigated |
