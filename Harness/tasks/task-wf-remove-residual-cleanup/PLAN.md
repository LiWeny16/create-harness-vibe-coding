# task-wf-remove-residual-cleanup - PLAN

## Goal

Fix `/wf-remove` so uninstalling Harness removes built-in discovery files under `.claude/`, `.agents/`, and `.codex/` instead of leaving old agent/skill/rule folders behind.

## Acceptance Criteria

| AC ID | Given / When / Then | Verification | Evidence |
|-------|----------------------|--------------|----------|
| AC-001 | Given legacy built-in Harness agent/skill/command files are present but missing from `.harness-version` checksums, when `wf-remove --apply --yes` runs, then those built-in files are removed. | `node tests/e2e-wf-scripts.test.mjs` | 151 passed |
| AC-002 | Given user custom skill files exist under `.claude/skills` or `.agents/skills`, when `wf-remove --apply --yes` runs, then those custom skills are preserved. | `node tests/e2e-wf-scripts.test.mjs` | 151 passed |
| AC-003 | Given a Harness script is invoked by absolute path from another Harness repo, when `--json` runs without `WF_ROOT`, then the script targets its own project root, not the caller cwd. | `node tests/e2e-wf-scripts.test.mjs` | 151 passed |
| AC-004 | Given a freshly generated project, when default safe removal runs, then `.claude`, `.agents`, and `.codex` discovery folders are removed. | temp generated project smoke check | removed all checked folders |
| AC-005 | Given users invoke `/wf-remove` rather than shell commands, when the skill loads, then it tells the agent to run the script internally and verify residual folders. | validator text gate | strict validator passed |

## Scope

Allowed write set:
- `Harness/scripts/wf-remove.mjs`
- `templates/common/scripts/wf-remove.mjs`
- `tests/e2e-wf-scripts.test.mjs`
- `.claude/skills/wf-remove/SKILL.md`
- `.agents/skills/wf-remove/SKILL.md`
- `templates/common/.claude/skills/wf-remove/SKILL.md`
- `Harness/scripts/validate-harness.mjs`
- `templates/common/scripts/validate-harness.mjs`
- `Harness/PROGRESS.md`
- `Harness/tasks/task-wf-remove-residual-cleanup/*`
- generated version metadata

Forbidden:
- Destructive removal against this repository.
- Reverting unrelated files.

## Implementation

- Added exact built-in Harness agent/skill/rule/direct-command path lists.
- Treat exact built-in framework files missing from legacy checksums as safe removal candidates while preserving custom skill names.
- Changed default root resolution to the script's project root unless `WF_ROOT` is explicitly set.
- Mirrored the runtime script into `templates/common/scripts/wf-remove.mjs`.
- Clarified the `/wf-remove` skill as the user-facing entry; shell commands are agent-internal execution steps.
- Added validator text gates for the slash-command entry contract and residual-folder verification.

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| `node tests/e2e-wf-scripts.test.mjs` | Pass | 151 passed |
| generated-project smoke removal | Pass | `.claude`, `.agents`, `.codex` removed by `--apply --yes` |
| `node Harness/scripts/validate-harness.mjs --strict` | Pass | validates `/wf-remove` skill wording |

## Acceptance Result

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
| AC-001 | PASS | e2e fixture | legacy unchecksummed built-ins removed |
| AC-002 | PASS | e2e fixture | custom user skills preserved |
| AC-003 | PASS | e2e fixture | script-root targeting fixed |
| AC-004 | PASS | temp smoke | real generated project leaves no discovery folder residuals |
| AC-005 | PASS | strict validator | slash-command entry contract |
