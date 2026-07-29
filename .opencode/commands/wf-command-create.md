---
description: Create or modify a Harness wf-* command surface atomically
---
# /wf-command-create

Create or modify a Harness wf-* command surface atomically. Do not invoke a skill or start WF mode.

## Classification

DIRECT command. It is a Harness maintenance command: it must create or resume a task capsule, then update every command surface declared by `Harness/specs/runtime/command-surface.json`. Never loads `Harness/MEMORY.md` as part of command routing.

## Usage

/wf-command-create <wf-command-id> [--direct|--workflow] [--task <task-id>]

- Command id must be `wf` or `wf-*` kebab-case.
- Use an existing task capsule when `--task` is supplied or when the active task clearly matches.
- Otherwise create a `task-<verb>-<noun>[-detail]` capsule with `node Harness/scripts/task-state.mjs record <task-id> --create --apply --json`.
- Record the command id, classification, and validation evidence in the task capsule.

## Required Surface Checklist

Update all applicable files before returning:

- `Harness/specs/runtime/command-surface.json`
- `.claude/commands/<id>.md`
- `.opencode/commands/<id>.md`
- `.claude/skills/<id>/SKILL.md` when Codex compatibility or workflow routing is needed
- `.agents/skills/<id>/SKILL.md` mirror when a Claude skill exists
- Matching `templates/common/...` files
- `CLAUDE.md` and `templates/common/CLAUDE.md`
- `.claude/rules/ecc/common.md` and template mirror
- `.claude/commands/wf-help.md`, `.opencode/commands/wf-help.md`, and template mirrors
- `Harness/README.md`, `Harness/MEMORY.md`, and template mirrors
- `Harness/scripts/validate-harness.mjs` and template mirror
- `Harness/scripts/wf-remove.mjs` and template mirror
- `tests/generator.test.js`, `tests/anti-drift.test.js`, and `tests/validate-harness.test.js`
- `Harness/.harness-version`, `templates/common/.harness-version`, and ownership manifests via `node scripts/build-version.mjs`

## Validation

Run, at minimum:

```bash
npm test
node Harness/scripts/validate-harness.mjs
node templates/common/Harness/scripts/validate-harness.mjs
node Harness/scripts/context-budget.mjs --json
node scripts/build-version.mjs --check
npm run check:mirrors
git diff --check
```

If a check is blocked by an existing unrelated repository issue, record the command, failure, and reason in the task capsule.

## Return

- Command id and classification.
- Task capsule path.
- Files changed by surface category.
- Verification results.
