# task-add-global-install-memory - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Verified

## Heartbeat

- Created task capsule and AC-driven PLAN for global-vs-project install scope.
- Implemented `--install-scope project|global` and `--global-dir` plumbing.
- Global mode writes shared runtime to the global directory and a project-local state bridge with `Harness/tasks/`, `Harness/PROGRESS.md`, and project memory.
- Verification passed: targeted generator/CLI/validator tests, root/template validators, context budget, build-version check, mirror check, diff whitespace check, and full `npm test`.
- Independent read-only review returned PASS with no blocking issues.
- Reopened after delayed independent review found blocking global-scope gaps.
- Fixed project-local bootstrap state boundary for `Harness/research/` and `Harness/project/`, rejected overlapping `--global-dir`, exposed global runtime plan in interactive preview, included global conflicts in JSON agent guidance, and changed cap warnings/protocol to remind `$wf-task-archive` instead of auto-archive/raw apply.
- Follow-up independent review returned PASS with no findings after the fixes.
