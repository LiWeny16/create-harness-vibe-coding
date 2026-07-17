# PLAN: Add WF Help Command

## Goal

Add `/wf-help` as a direct slash command that returns a table of available
`/wf*` commands with purpose, usage, and when to use each command. It must not
be implemented as a skill.

## Acceptance Criteria

| AC ID | Criteria | Verification |
| --- | --- | --- |
| AC-001 | `.claude/commands/wf-help.md` exists in dogfood runtime and template source. | file checks, validator |
| AC-002 | `/wf-help` content directly returns help text and does not invoke a skill or workflow. | command file inspection |
| AC-003 | Help table covers installed WF command surfaces: `/wf`, `/wf-max`, `/wf-auto`, `/wf-auto-spark`, `/wf-review`, `/wf-learn`, `/wf-browser`, `/wf-readme`, `/wf-update`, `/wf-remove`, and `/wf-help`. | content check |
| AC-004 | Router docs mention `/wf-help` as a direct command, not a skill. | README/AGENTS checks |
| AC-005 | Validator, tests, and version metadata pass. | commands recorded in PROGRESS |

## Write Set

- `.claude/commands/wf-help.md`
- `templates/common/.claude/commands/wf-help.md`
- `AGENTS.md`
- `templates/common/AGENTS.md`
- `Harness/README.md`
- `templates/common/Harness/README.md`
- `Harness/MEMORY.md`
- `templates/common/MEMORY.md`
- `Harness/scripts/validate-harness.mjs`
- `templates/common/scripts/validate-harness.mjs`
- `tests/*.test.js`
- `templates/common/.harness-version`
- `Harness/tasks/task-add-wf-help/*`

## Forbidden

- Do not add a `wf-help` skill.
- Do not reintroduce broad hooks.
- Do not change WF command behavior beyond help documentation.

## Validation Plan

1. `npm run build:version` - PASS
2. `node Harness/scripts/validate-harness.mjs` - PASS
3. `node Harness/scripts/validate-harness.mjs --strict` - PASS
4. `npm test` - PASS, 65 passed and 1 skipped
5. `node scripts/build-version.mjs --check` - PASS
