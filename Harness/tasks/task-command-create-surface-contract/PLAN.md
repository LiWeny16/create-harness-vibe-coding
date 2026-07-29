# task-command-create-surface-contract - PLAN

## Goal

Create a command-surface contract and /wf-command-create command/skill so new wf-* commands update all runtime, template, validator, ownership, remove, help, and test surfaces atomically.

## Scope

- Add a command-surface registry that makes wf-* command synchronization machine-checkable.
- Add `/wf-command-create` as a direct/compat maintenance command plus Codex skill shim.
- Update validator/tests so command additions must cover runtime files, template mirrors, help, routing, ECC exemptions, ownership metadata, and removal cleanup.
- Fix currently exposed command-surface drift where it blocks the validation chain.

## Decisions

- `/wf-command-create` is direct/compat: it does not enter WF, but it must create or resume a task capsule before changing command surfaces.
- `Harness/specs/runtime/command-surface.json` is the command registry source for validation.

## Acceptance

- AC-001: All existing user-facing wf-* commands are represented in `command-surface.json`.
- AC-002: `/wf-command-create`, `$wf-command-create`, and `/skills wf-command-create` surfaces exist and are mirrored across root/template runtime files.
- AC-003: `validate-harness.mjs` fails when command registry surfaces drift from files, help, routing, ECC exemptions, or remove cleanup.
- AC-004: Existing review findings are corrected or explicitly recorded as remaining risks.
- AC-005: `npm test`, validator, context-budget, version check, mirror check, and diff whitespace checks are run or failures are recorded.
