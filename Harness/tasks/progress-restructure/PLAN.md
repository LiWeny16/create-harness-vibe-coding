# progress-restructure — PLAN

## Goal

Restructure Harness task tracking from monolithic PLAN.md to PROGRESS.md + per-task capsules.

## Acceptance Criteria
- [ ] Root PROGRESS.md exists with active task pointer + task index + cross-task decisions
- [ ] tasks/_template/ exists with PROGRESS.md, PLAN.md, ARTIFACTS.md, NOTES.md
- [ ] root PLAN.md is deprecated stub with historical archive
- [ ] All reference files updated (CLAUDE.md, README.md, WF.md, subagents.md, MEMORY.md, context-loading.md, agent-workflow.md, wf-mode/SKILL.md, dispatch.md)
- [ ] Validator updated for new structure
- [ ] npm test passes (58/58)
- [ ] Strict validator passes

## Scope
Allowed:
- Harness/PROGRESS.md (new)
- Harness/tasks/** (new)
- Harness/PLAN.md (replace with stub)
- templates/common/docs/harness/PROGRESS.md (new)
- templates/common/docs/tasks/** (new)
- templates/common/docs/harness/PLAN.md (replace with stub)
- All template files referencing PLAN.md
- templates/common/scripts/validate-harness.mjs
- All dogfood runtime equivalents

Forbidden:
- src/**, tests/**, package.json, README.md (root), .gitignore
