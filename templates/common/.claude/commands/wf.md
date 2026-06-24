# /wf

Enter `wf-mode`.

## Required

- Load `subagent-orchestrator` skill.
- Explicit `/wf`, `wf mode`, `workflow mode`, or `wk mode` MUST spawn at least 3 distinct subagents from `.claude/agents/` before second planning.
- Read `Harness/WF.md` and `.claude/skills/wf-mode/SKILL.md`.

## Loop

```text
intake
-> parallel read-only exploration (≥3 subagents)
-> synthesis + second plan
-> test
-> implement
-> review
-> verify
-> debugger recovery loop when needed
```

Keep `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` current.
