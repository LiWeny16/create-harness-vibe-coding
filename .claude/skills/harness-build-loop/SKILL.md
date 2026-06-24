---
name: harness-build-loop
description: Use for implementation, review, debugging, verification, and closing a feature.
---

# Harness Build Loop

Load:

- `Harness/agent-workflow.md`
- `Harness/subagents.md` when more than one agent, reviewer, or recovery pass is useful
- `Harness/dispatch.md` when more than one agent is useful
- `Harness/PLAN.md`
- current feature doc if present

Follow:

```text
acceptance criteria -> failing test/manual check -> implementation -> verify -> review -> docs sync
```

Close only with recorded verification evidence.
