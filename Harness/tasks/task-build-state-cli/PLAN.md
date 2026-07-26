# task-build-state-cli - PLAN

Compact task record. Keep only facts needed to resume, review, and verify.

## Goal

- Outcome: Add a deterministic task-state CLI so Harness task status, active pointer, root Task Index, and archive moves are controlled by code instead of prompt-only discipline.
- Non-goals: Change WF orchestration semantics, delete archived evidence, or introduce a background daemon/scheduler.

## Decisions

- `STATE.json` remains the canonical machine-readable task truth.
- `Harness/PROGRESS.md` is a derived human-readable index that the CLI rewrites during reconciliation/archive operations.
- `archive-tasks.mjs` stays as a compatibility entry and delegates to the new task-state archive path.
- The implementation stays zero-dependency because the state model is small and must scaffold into arbitrary projects reliably.

## Acceptance

- AC-001: `task-state.mjs` supports list, validate, reconcile, set-active, transition, and archive commands with dry-run/json support where needed.
- AC-002: Archive apply moves safe completed tasks, updates moved `STATE.json`, updates `_archive/INDEX.md`, and rewrites root `Harness/PROGRESS.md`.
- AC-003: Validator checks task-state consistency and points users at `task-state.mjs` for reconciliation/archive.
- AC-004: Template mirrors and ownership manifest include the new script.
- AC-005: Focused tests cover validation, reconciliation dry-run/apply, archive dry-run/apply safety, and archive compatibility.

## Scope

Allowed write set:
- `Harness/scripts/task-state.mjs`
- `Harness/scripts/archive-tasks.mjs`
- `Harness/scripts/validate-harness.mjs`
- `Harness/specs/workflows/WF-STATE.md`
- `Harness/specs/protocols/TASK_ARCHIVE.md`
- `Harness/ownership.manifest.json`
- template mirrors under `templates/common/**`
- task-state tests
- this task capsule and `Harness/PROGRESS.md`

Forbidden:
- Unrelated workflow semantics.
- Deleting historical task evidence.
- Reverting unrelated existing worktree changes.

## Verification

- [x] `node --test tests/task-state.test.js`
- [x] `node --test tests/generator.test.js tests/validate-harness.test.js`
- [x] `node Harness/scripts/task-state.mjs validate --strict --json`
- [x] `node Harness/scripts/task-state.mjs archive --keep 5 --dry-run --json`
- [x] `node Harness/scripts/validate-harness.mjs --strict`
- [x] `node scripts/build-version.mjs --check`
- [x] `npm test`
- [x] `node tests/e2e-wf-scripts.test.mjs`

## Results

- Existing task drift was reconciled: missing `STATE.json` created, duplicate active state removed, and legacy phase/status values normalized.
- Archive apply moved `task-cache-hit-rate-wf-skills`, `task-harden-wf-max-fanout`, and `task-spark-protocol-hardening` to `_archive/2026/`.
- Root `Harness/PROGRESS.md` now has no active task and exactly 5 non-archived outer task capsules.
