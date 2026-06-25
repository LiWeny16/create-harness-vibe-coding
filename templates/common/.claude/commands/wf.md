# /wf <task/mission>

Enter WF mode with the given task or mission description.

## CEO Exploration Constraint (READ THIS FIRST)

**You are the CEO. Your job is to ask questions, not read files.** During exploration:
- **DO NOT Read/Grep/Glob any source code.** Not even "just to check one thing." You will waste your context window and defeat parallelism — the #1 WF failure mode.
- **Spawn ≥3 read-only subagents in ONE message.** Default to `sonnet` — exploration requires real code understanding. Use `haiku` only for shallow scans (directory listing, file counts). Use `opus` if the user asks.
- **You may only read:** `Harness/` docs, `CLAUDE.md`, and subagent returns. Nothing else until the Second Plan is written.

## Required

- Load `Harness/WF.md` — the single authority for WF mode.
- Load `subagent-orchestrator` skill for subagent coordination.
- Explicit `/wf`, `wf mode`, `workflow mode`, or `wk mode` MUST spawn at least 3 distinct subagents from `.claude/agents/` before second planning.

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
