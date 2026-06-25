# /wf-max [task]

Enter maximum-parallelism workflow mode with an optional task description. Splits tasks into minimal non-conflicting units and dispatches as many subagents as possible in parallel waves.

## Required

- Load `wf-max` skill.
- MUST run exploration fan-out with as many read-only subagents as useful.
- MUST partition implementation into disjoint write sets across parallel waves.
- MUST run parallel reviewers per dimension after each implementation wave.

## Loop

```text
intake
-> max-parallel exploration (5-14 read-only agents)
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
