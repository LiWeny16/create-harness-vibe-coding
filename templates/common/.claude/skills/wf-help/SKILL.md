---
name: wf-help
description: Codex compatibility: use $wf-help or /skills wf-help in Codex to show the Harness WF command table. Claude Code and OpenCode use the direct /wf-help command.
---

# WF Help Adapter

This skill is a Codex compatibility shim. It does not start WF mode, dispatch
agents, or edit files.

## Invocation

- Codex CLI or IDE: use `$wf-help` or `/skills` then choose `wf-help`.
- Claude Code: use `/wf-help` direct command from `.claude/commands/wf-help.md`.
- OpenCode: use `/wf-help` direct command from `.opencode/commands/wf-help.md`.

## Load

- `.claude/commands/wf-help.md`

## Rules

Return the command table from `.claude/commands/wf-help.md` directly.
Do not load `Harness/MEMORY.md`, do not enter WF, and do not invoke workflow
skills while answering help.

## Return

- WF command table
- One short note that Codex uses `$wf-*` or `/skills wf-*` for skill-backed entries
