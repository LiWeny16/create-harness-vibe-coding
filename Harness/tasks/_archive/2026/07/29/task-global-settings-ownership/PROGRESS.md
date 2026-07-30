# task-global-settings-ownership - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived

## Heartbeat

- Captured user decisions: three-host global install, copy mode, project settings override global settings.
- Implemented host-global copy plans for Claude Code, Codex, and OpenCode surfaces.
- Added project/global settings metadata and docs; project settings remain `Harness/settings.json`.
- Added ownership metadata separating project user state, project template bridge, global runtime template, and host-global templates.
- Independent reviewer returned FAIL on AC-005: global runtime root validation was incomplete, and bridge validation did not prove host-global copied files still exist.
- Fixed AC-005 gaps: validator now has a global-runtime-root path, rejects project-local state in global runtime, and checks `.harness-version` hostGlobal copy targets for Claude Code/Codex/OpenCode.
- Added regression tests for global runtime validation, global state leakage, and missing host-global copy targets.
- Re-review returned PASS with no findings.
- Verification: `npm test` PASS (243 pass, 1 skip); `node Harness/scripts/validate-harness.mjs` PASS; `node templates/common/Harness/scripts/validate-harness.mjs` PASS; `node Harness/scripts/context-budget.mjs --json` PASS; `node scripts/build-version.mjs --check` PASS; `npm run check:mirrors` PASS; `git diff --check` PASS; `node Harness/scripts/task-state.mjs validate --json` PASS with only the task-cap reminder.
- Task cap reminder remains intentional: ask the user to run `$wf-task-archive` when they want completed task capsules archived.
