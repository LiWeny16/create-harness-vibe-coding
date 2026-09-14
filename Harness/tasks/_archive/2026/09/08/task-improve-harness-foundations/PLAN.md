# task-improve-harness-foundations - PLAN

## Goal

Make the Harness install, task, and review foundations production-grade while
preserving the behavior of existing repositories. New or empty repositories
must receive the new defaults and routing contracts.

## Scope

Write set:
- `src/index.js`, `src/prompts.js`, `README.md`, and setup guidance for the
  new/legacy install-scope policy.
- `Harness/scripts/task-state.mjs` and `task-group-index.mjs`, their template
  mirrors, task index templates, task lifecycle/archive contracts, and task
  command docs.
- Native-only bounded `wf-review` prompts, manager agents, command mirrors,
  runtime workflow metadata, and review documentation.
- Regression tests, generated task index, and release/mirror metadata.

Forbidden:
- Do not create a second wf-ui product/package or download it at runtime.
- Do not remove or rewrite user-authored task capsules, project files, or
  legacy status/group fields without an explicit migration path.
- Do not invoke another CLI from `wf-review` or add reviewer recursion.

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | New/empty CLI targets default to global scope; existing non-empty targets default to project scope unless explicitly overridden. | Gives new repositories one shared runtime while preserving compatibility for installed repositories. | 2026-09-07 |
| 2 | Keep wf-ui in the same package and lazy-load its server modules only for `wf-ui`. | Avoids a second package/download contract while keeping normal CLI startup light. | 2026-09-07 |
| 3 | Canonical live task statuses are `active`, `blocked`, and `closed`; legacy values remain readable and normalize at the boundary. | Reduces agent decision load without breaking old capsules or archive records. | 2026-09-07 |
| 4 | The root Active Task is a focus/resume pointer, not a singleton lock; multiple active/blocked tasks are valid. | Allows parallel work while retaining a cheap resume hint for older workflows. | 2026-09-07 |
| 5 | `project` is canonical, `group` is a compatibility alias, and `INDEX.json`/`INDEX.md` are generated routes from task `STATE.json`. | Gives agents deterministic project grouping, dates, keyword search, and bounded context loading. | 2026-09-07 |
| 6 | `wf-review` uses the smallest useful native reviewer fan-out with a hard deadline and explicit timeout findings. | Removes flaky external CLI coupling and prevents reviewer recursion/hangs. | 2026-09-07 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | New/empty CLI targets use global scope; existing non-empty targets preserve project scope; explicit scope wins in JSON, non-interactive, and interactive paths. | CLI smoke tests and generated dry-run plans. | passed |
| AC-002 | wf-ui stays in the main runtime, is lazy-loaded at invocation, and does not trigger a second download. | Source inspection, package smoke tests, and docs. | passed |
| AC-003 | New task records use active/blocked/closed, timestamps, project, and tags; legacy statuses and group fields remain readable. | `tests/task-state.test.js`. | passed |
| AC-004 | Multiple open tasks validate, list/open by project, rebuild INDEX routes, and query task capsules with line-level hits. | Task-state tests plus generated `Harness/tasks/INDEX.*`. | passed |
| AC-005 | wf-review has no external CLI or recursion path, selects bounded native reviewers, adjudicates results, and records timeout as non-pass. | Review skill/command/agent mirror checks and static search. | passed |
| AC-006 | Source/template mirrors, validator, version metadata, full tests, and diff checks pass. | `npm test`, mirror/version checks, validator, `git diff --check`. | passed |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Global runtime path differs by host or collides with user files. | Keep explicit `--global-dir`/`--host-global-dir`, conflict plans, and project-local state boundaries. | monitored |
| Legacy task readers expect old statuses or `group`. | Normalize at read/write boundaries and retain raw archive compatibility markers. | mitigated |
| Generated indexes become stale. | Refresh on record/reconcile/transition/archive and expose explicit `task-state index`. | mitigated |
| Reviewer agents hang or recursively spawn. | Native-only packet, no child agents/CLI, bounded fan-out, hard deadline, timeout is not pass. | mitigated |
