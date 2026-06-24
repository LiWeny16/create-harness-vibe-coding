---
name: harness-build-loop
description: Use for implementation, review, debugging, verification, and closing a feature.
---

# Harness Build Loop

Load:

- `Harness/agent-workflow.md`
- `Harness/subagents.md` when more than one agent, reviewer, or recovery pass is useful
- `Harness/dispatch.md` when more than one agent is useful
- `Harness/PROGRESS.md`
- `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md` when available
- current feature doc if present

Follow:

```text
acceptance criteria -> failing test/manual check -> implementation -> verify -> review -> docs sync
```

Close only with recorded verification evidence.
