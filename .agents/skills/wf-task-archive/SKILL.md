---
name: wf-task-archive
description: Archive completed task capsules. Use for $wf-task-archive or /skills wf-task-archive in Codex. Direct/compat command wrapping task-state.mjs — does not enter WF mode.
---

# WF Task Archive Adapter

This skill is a Codex compatibility shim. It does not start WF mode, dispatch agents, or edit files directly.

## Invocation

- Codex: `$wf-task-archive` or `/skills` then choose `wf-task-archive`.
- Claude Code: `/wf-task-archive` direct command from `.claude/commands/wf-task-archive.md`.
- OpenCode: `/wf-task-archive` direct command from `.opencode/commands/wf-task-archive.md`.

## Load

- `.claude/commands/wf-task-archive.md`

## Rules

Execute the command instructions from `.claude/commands/wf-task-archive.md` directly.
Do not load `Harness/MEMORY.md`, do not enter WF.

## Return

- Task archive result
- Note that Codex uses `$wf-task-archive` or `/skills wf-task-archive`
