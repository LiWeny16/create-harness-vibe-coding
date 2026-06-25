# /wf-max [task]

Enter maximum-parallelism workflow mode with an optional task description. Splits tasks into minimal non-conflicting units and dispatches as many subagents as possible in parallel waves.

## CEO Exploration Constraint (READ THIS FIRST)

**You are the CEO. Your job is to ask questions, not read files.** During exploration:
- **DO NOT deep-read source files.** The point of max-parallelism is fan-out — every file you read in detail is a lost parallel opportunity. You MAY do one lightweight `ls`/`tree`/`glob` pass to estimate scope (directory count, file list) for dispatch sizing, but STOP after scoping.
- **Spawn 5-10 read-only subagents in ONE message.** Default to `sonnet` — exploration needs real understanding. Use `haiku` only for shallow directory scans. Use `opus` if the user asks.
- **You may only read:** `Harness/` docs, `CLAUDE.md`, directory listings for scoping, and subagent returns. Nothing else until the write-set is declared.

## Required

- Load `wf-max` skill.
- MUST run exploration fan-out with as many read-only subagents as useful.
- MUST partition implementation into disjoint write sets across parallel waves.
- MUST run parallel reviewers per dimension after each implementation wave.

## Loop

```text
intake
-> max-parallel exploration (5-10 read-only agents)
-> synthesis + write-set coloring → dependency graph
-> wave 1: N parallel implementers (disjoint file claims)
-> wave 1 review: parallel spec/code/security reviewers
-> wave 2: M parallel implementers (depend on wave 1)
-> wave 2 review
-> verifier integration
-> closeout with context-master + memory-master
```

Full organization model, span formula, Manager types, leaf condition, and synthesis protocol: [WF-MAX.md](Harness/WF-MAX.md).

Keep `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` current.
