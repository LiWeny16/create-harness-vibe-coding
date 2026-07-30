# task-review-fix-global-record-policy - PLAN

## Goal

Fix Harness architecture issues found in review: global host ownership tracking, /wf-task-record create-or-resume semantics, status validation, host symlink reject, command-surface policy enum validation.

## Investigation Results

### B (done): /wf-task-record create-or-resume
- record --status bogus silently degrades → use old status, exit 0
- No task-id path errors "requires <task-id>"
- Fix: add --title/--note/--context deterministic matching, reject invalid --status with non-zero exit

### C (done): validator/command-policy
- validate-harness.mjs uses statSync (follows symlinks) → need lstatSync
- command-surface.json taskCapsulePolicy not enum-validated
- consistency check with command docs not feasible at low cost (skip)

## Wave 2 Dispatch (serial)

1. Writer 1: ownership fix (src/generator.js, tests/generator.test.js, scripts/lib/ownership-manifest.mjs, wf-update-check.mjs)
2. Writer 2: task-record fix (task-state.mjs, tests, commands/skills, mirrors)
3. Writer 3: validator/policy fix (validate-harness.mjs, command-surface.json, tests)
4. Writer 4: sync mirrors/docs

## Wave 3 Review

- Review A: spec/AC review
- Review B: code architecture review

## Non-Goals
- Do not touch record.md
- Do not auto-archive tasks
- Do not use peer CLI
- Haiku subagents only