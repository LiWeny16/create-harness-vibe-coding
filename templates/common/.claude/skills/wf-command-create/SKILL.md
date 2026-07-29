---
name: wf-command-create
description: Create or modify Harness wf-* commands atomically. Use for $wf-command-create or /skills wf-command-create in Codex, and for /wf-command-create in Claude Code/OpenCode. Direct/compat maintenance command; creates or resumes a task capsule but does not enter WF mode.
---

# WF Command Create Adapter

This skill is a Codex compatibility shim for the direct `/wf-command-create`
maintenance command. It does not start WF mode or load `Harness/MEMORY.md`.

## Invocation

- Codex: `$wf-command-create` or `/skills` then choose `wf-command-create`.
- Claude Code: `/wf-command-create` direct command from `.claude/commands/wf-command-create.md`.
- OpenCode: `/wf-command-create` direct command from `.opencode/commands/wf-command-create.md`.

## Load

- `.claude/commands/wf-command-create.md`
- `Harness/specs/runtime/command-surface.json`

## Rules

Execute the command instructions from `.claude/commands/wf-command-create.md`.

- Create or resume the task capsule first.
- Update `command-surface.json` before creating command files.
- Keep `.agents/skills/<id>/SKILL.md` byte-identical to `.claude/skills/<id>/SKILL.md`.
- Keep `.opencode/commands/<id>.md` body-identical to `.claude/commands/<id>.md`.
- Run the validation list from the command file or record why a check could not complete.

## Return

- Task capsule path
- Command classification
- Changed surface checklist
- Verification results
