# wf-max — PLAN

Task-level implementation plan and evidence.

## Goal

Create all files for `/wf max` maximum-parallelism workflow mode. This includes template files (under `templates/common/`), dogfood runtime files (under root `Harness/` and `.claude/`), and task capsule tracking files (under `Harness/tasks/wf-max/`).

## Acceptance Criteria

- [x] `templates/common/.claude/commands/wf-max.md` exists with slash command bridge content
- [x] `templates/common/.claude/skills/wf-max/SKILL.md` exists with skill loader content
- [x] `templates/common/docs/harness/WF-MAX.md` exists with full workflow documentation
- [x] `Harness/WF-MAX.md` exists with same content as template
- [x] `.claude/commands/wf-max.md` exists with same content as template
- [x] `.claude/skills/wf-max/SKILL.md` exists with same content as template
- [x] `Harness/tasks/wf-max/DESIGN.md` exists with design summary
- [x] `Harness/tasks/wf-max/PROGRESS.md` exists with task progress
- [x] `Harness/tasks/wf-max/PLAN.md` exists with this plan
- [ ] `node Harness/scripts/validate-harness.mjs` passes
- [ ] `node Harness/scripts/validate-harness.mjs --strict` passes

## Scope

Allowed write set:
- `templates/common/.claude/commands/wf-max.md`
- `templates/common/.claude/skills/wf-max/SKILL.md`
- `templates/common/docs/harness/WF-MAX.md`
- `Harness/WF-MAX.md`
- `.claude/commands/wf-max.md`
- `.claude/skills/wf-max/SKILL.md`
- `Harness/tasks/wf-max/DESIGN.md`
- `Harness/tasks/wf-max/PROGRESS.md`
- `Harness/tasks/wf-max/PLAN.md`

Forbidden:
- Do not modify existing files outside the write set
- Do not modify any other Harness/ files, templates, or .claude files

## Loaded Context

- `.claude/commands/wf.md` — reference for command file format
- `.claude/skills/wf-mode/SKILL.md` — reference for skill file format and frontmatter
- `Harness/WF.md` — reference for workflow documentation format
- `Harness/tasks/_template/PROGRESS.md` — reference for task progress format
- `Harness/tasks/_template/PLAN.md` — reference for task plan format
- `Harness/scripts/validate-harness.mjs` — validator already expects wf-max files (commonSkills includes 'wf-max', required includes 'Harness/WF-MAX.md' and '.claude/commands/wf-max.md')

## Subagent Dispatch

| Agent | Mode | Read Set | Write Set | Status |
|-------|------|----------|-----------|--------|
| main agent (implementer) | Serial Write | Harness/*.md, .claude/commands/wf.md, .claude/skills/wf-mode/SKILL.md | All 9 files listed in scope | Done |

## Subagent Synthesis

Agents used: main agent only (implementer, single serial pass)
Findings accepted: All file creation locations and content per user specification
Findings rejected: none
Conflicts: none
Decisions:
- Template and dogfood files use identical content for WF-MAX.md, SKILL.md, and wf-max.md command
- Task capsule follows _template conventions
- DESIGN.md includes all 7 key design decisions enumerated in the user request

Residual risk:
- ~~Harness validator may require additional MEMORY.md or README.md updates for wf-max registration~~ CONFIRMED: MEMORY.md and CLAUDE.md need updates outside this write set
- Strict validator may flag unresolved placeholders in other project files (not run yet)

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| All 9 files created | Pass | All 9 files created at specified paths |
| `node Harness/scripts/validate-harness.mjs` | Partial (2 failures) | WF-MAX.md content checks pass. Remaining failures: (1) MEMORY.md missing wf-max skill registration, (2) CLAUDE.md missing /wf max startup instruction — both in files outside write set |
| `node Harness/scripts/validate-harness.mjs --strict` | Not run | Blocked by non-strict failures in out-of-scope files |
