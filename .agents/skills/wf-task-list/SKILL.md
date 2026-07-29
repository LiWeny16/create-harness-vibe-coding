---
name: wf-task-list
description: List task capsules. Use for $wf-task-list or /skills wf-task-list in Codex. Direct/compat command wrapping task-state.mjs — does not enter WF mode.
---

# WF Task List Adapter

This skill is a Codex compatibility shim. It does not start WF mode, dispatch agents, or edit files directly.

## Invocation

- Codex: `$wf-task-list` or `/skills` then choose `wf-task-list`.
- Claude Code: `/wf-task-list` direct command from `.claude/commands/wf-task-list.md`.
- OpenCode: `/wf-task-list` direct command from `.opencode/commands/wf-task-list.md`.

## Load

- `.claude/commands/wf-task-list.md`

## Rules

Execute the command instructions from `.claude/commands/wf-task-list.md` directly.
Do not load `Harness/MEMORY.md`, do not enter WF.

## Return

- Task listing result
- Note that Codex uses `$wf-task-list` or `/skills wf-task-list`
