---
name: harness-context
description: Use before spawning subagents, splitting work, or when context is growing.
---

# Harness Context

Load:

- `Harness/subagents.md`
- `Harness/context-loading.md`
- `Harness/dispatch.md` when more than one agent is useful
- `Harness/PROGRESS.md`
- `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md` when available
- current feature doc if present

For each subagent or bounded pass, provide:

- role
- task
- mode
- read boundary
- write boundary
- dependency
- injected docs
- return format
