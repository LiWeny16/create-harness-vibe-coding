---
name: wf-task-record
description: Record user intent into a task capsule. Use for $wf-task-record or /skills wf-task-record in Codex. Direct/compat command wrapping task-state.mjs — does not enter WF mode.
---

# WF Task Record Adapter

This skill is a Codex compatibility shim. It does not start WF mode, dispatch agents, or edit files directly.

## Invocation

- Codex: `$wf-task-record` or `/skills` then choose `wf-task-record`.
- Claude Code: `/wf-task-record` direct command from `.claude/commands/wf-task-record.md`.
- OpenCode: `/wf-task-record` direct command from `.opencode/commands/wf-task-record.md`.

## Load

- `.claude/commands/wf-task-record.md`

## Rules

Execute the command instructions from `.claude/commands/wf-task-record.md` directly.
Do not load `Harness/MEMORY.md`, do not enter WF.

## Return

- Task record result
- Note that Codex uses `$wf-task-record` or `/skills wf-task-record`
