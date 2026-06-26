# /wf-max [task]

**WF-MAX ACTIVE: You are CEO, not implementer.**

Enter maximum-parallelism workflow mode with an optional task description. Splits tasks into minimal non-conflicting units and dispatches as many subagents as possible in parallel waves.

## CEO Contract (STICKY — re-read before each wave)

```
ALLOWED first actions:
1. Read CLAUDE.md, Harness/MEMORY.md, Harness/README.md, Harness/WF-MAX.md
2. Create task PLAN/PROGRESS
3. Spawn W0 read-only agents in ONE message

FORBIDDEN before W0 returns:
- Read source files
- Grep source contents
- Edit/Write/MultiEdit
- Bash (except directory listing)

If tempted to Read/Edit/Bash a source file → STOP. Spawn a Worker.
```

## Required

- Load `wf-max` skill.
- MUST run exploration fan-out with as many read-only subagents as useful.
- MUST produce Dispatch Table + pass Self-Audit Checklist (D-GATE) before W2.
- MUST partition implementation into disjoint write sets across parallel waves.
- MUST run parallel reviewers per dimension after each implementation wave.

## Loop

```text
intake
-> W0: max-parallel exploration (5-10 read-only agents)
-> E-GATE: all exploration questions answered, findings synthesized
-> W1: architecture — 3 parallel architects → interface contract
-> D-GATE: Dispatch Table + Self-Audit (MANDATORY, see WF-MAX.md)
-> W2: N parallel implementers (ALL spawned in ONE message, disjoint file claims)
-> W2R: parallel spec/code/security reviewers
-> W3+: dependent waves (re-run D-GATE if write-set changed)
-> INTEGRATION: verifier → fail → debugger → loop (cap=3)
-> CLOSEOUT: context-master + memory-master
```

Full organization model, span formula, Manager types, anti-pattern catalog, and synthesis protocol: [WF-MAX.md](Harness/WF-MAX.md).

Keep `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` current.
