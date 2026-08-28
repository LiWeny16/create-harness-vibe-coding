---
name: wf-init
description: Codex compatibility: use $wf-init or /skills wf-init in Codex. In Claude Code and OpenCode, /wf-init is a direct command that initializes this project against the globally installed Harness runtime.
---

# WF-INIT Adapter

This skill is a Codex compatibility shim for initializing a project against the
global Harness runtime. Claude Code and OpenCode handle `/wf-init` as a direct
command. Do not route this through WF mode.

## Invocation

- Codex CLI or IDE: use `$wf-init` or `/skills` then choose `wf-init`.
- Claude Code: `/wf-init` is a direct command from `.claude/commands/wf-init.md`.
- OpenCode: `/wf-init` is a direct command from `.opencode/commands/wf-init.md`.

## Load

No router preload. Read only the local command file above when this runtime
needs the exact direct command text.

## Cache Discipline

Keep the context to the command, the current project root, and the printed
global runtime path. Do not paste full generation plans or host-copy file lists.

## Policy

The global runtime installed once per machine (`npm i -g create-harness-vibe-coding`)
is the single version source of truth. `/wf-init` writes only project bridge docs
and project-local state; it never copies the framework into the project and never
overwrites user-authored files (default conflict policy `skip`).
