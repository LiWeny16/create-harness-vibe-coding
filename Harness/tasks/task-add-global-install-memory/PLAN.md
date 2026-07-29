# task-add-global-install-memory - PLAN

## Goal

Add global-vs-project install choice with project-local Harness/tasks and split project/global memory.

## Mini PRD

Users should be able to choose between:

- **Project install**: current behavior. Full Harness scaffold is written into the target project.
- **Global install**: shared Harness runtime assets can be installed once for the machine, while every target project still gets local task state and project memory.

The project-local invariant is non-negotiable: `Harness/tasks/`, `Harness/PROGRESS.md`, and project memory remain in the project. Global memory may store cross-project lessons/preferences, but it must not replace project task state.

## Scope

- Add CLI/generator install-scope plumbing for `project` vs `global`.
- Add global-install metadata and generated guidance.
- Keep `project` as the default for backward compatibility.
- Make global mode generate project-local task/memory state and a separate global runtime/memory area.
- Add tests and validation markers so future changes do not collapse project tasks into global state.

## Non-Scope

- Do not migrate existing installed projects automatically.
- Do not archive or rewrite unrelated existing task capsules.
- Do not add background daemons or runtime hooks.
- Do not store secrets or raw transcripts in global memory.

## Decisions

- WF tier: WF-Standard; behavior crosses CLI, generator, docs/templates, validation, and tests.
- Install-scope flag: `--install-scope <project|global>` with `project` default.
- Global path flag: `--global-dir <dir>` for explicit machine-level destination and tests; otherwise use a deterministic user-home default.
- Global install still creates project-local `Harness/tasks/` and `Harness/PROGRESS.md`.
- Memory split: project memory is under project `Harness/memory/`; global memory is under the selected global Harness directory and referenced by generated guidance.

## Acceptance

- AC-001: CLI help, JSON dry-run, and non-interactive parsing expose `--install-scope project|global` and `--global-dir`.
- AC-002: `installScope: project` preserves the current scaffold behavior.
- AC-003: `installScope: global` writes shared runtime assets to the global destination and still creates project-local `Harness/tasks/`, `Harness/PROGRESS.md`, and `Harness/memory/` files.
- AC-004: Generated docs/specs state the global/project boundary: tasks are always project-local; memory has project and global scopes.
- AC-005: Validator/tests fail if the project-local task invariant or global/project memory split guidance is removed.

## Subagent Dispatch

| Role | Status | ReadSet | WriteSet | Return |
| --- | --- | --- | --- | --- |
| codebase-explorer | done | `src/index.js`, `src/generator.js`, CLI tests | none | install-scope implementation map |
| codebase-explorer | done | memory templates, ownership/update/remove/validator | none | memory-scope boundary map |
| independent-review | fail-then-fixed | changed generator, CLI, docs/templates, validator, tests | none | found global project-state, overlap, preview, and JSON guidance blockers |
| independent-review | pass | focused fixes for global install and archive warnings | none | no findings |

## Verification

- `node --test tests/generator.test.js tests/cli-smoke.test.js tests/validate-harness.test.js`
- `node Harness/scripts/validate-harness.mjs`
- `node templates/common/Harness/scripts/validate-harness.mjs`
- `node Harness/scripts/context-budget.mjs --json`
- `node scripts/build-version.mjs --check`
- `node scripts/build-version.mjs`
- `npm test`
- `git diff --check`
- `npm run check:mirrors`
- `node --test tests/task-state.test.js`

## Result

- AC-001 through AC-005 satisfied.
- Global mode now writes shared runtime assets to the selected global directory while preserving project-local task state and project memory.
- Project mode remains the default compatibility path.
- Follow-up review PASS confirmed the delayed-review blockers are fixed.
