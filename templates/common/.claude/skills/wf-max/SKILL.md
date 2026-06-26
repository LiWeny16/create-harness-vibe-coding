---
name: wf-max
description: Use for /wf max or maximum parallelism. Three-tier CEO→Manager→Worker hierarchy with recursive depth, per-domain span caps, and leaf-condition stop rules.
---

# WF Max — Maximum Parallelism

## Load (authoritative specs)

- `Harness/WF-MAX.md` — full spec: organization model, gates, span formula, anti-patterns, wave orchestration
- `Harness/subagents.md` — agent roster, controller role, efficiency ladder
- `Harness/dispatch.md` — File claim, Concurrency group handoff fields
- `Harness/agent-workflow.md` — cohesion rule, completion gate

## Trigger & When NOT to Use

**Explicit invocation always fans out — no file-count escape.** When the user types `/wf-max`, spawning subagents is mandatory and unconditional. File count, task size, and overhead DO NOT apply to explicit invocation — they govern only AUTO-triggering. A 1-file `/wf-max` still fans out. "Degrade to /wf" changes the organization (flat vs CEO→Manager→Worker), never the fact of fan-out — `/wf` itself requires ≥3 subagents. There is NO path from an explicitly typed `/wf-max` to a solo main-thread pass.

- **Trigger**: `/wf-max [task]`, or auto when write-set ≥5 files AND clear disjoint boundaries (parallelismScore ≥2.0)
- **Auto-trigger degradation only** (never applies to explicit `/wf-max`): files <5, all changes share single interface (serial dependency), import/re-export refactor (global consistency needed), overhead >0.30
- **Leaf conditions** (stop splitting): files ≤ span×2, avgLines <50, overhead >0.30

## Hard Constraints

1. **CEO never writes production code.** CEO uses Task, Read, TodoWrite, Grep/Glob. No Edit/Write/Bash on source files. Exception: CEO MAY write to `Harness/tasks/<id>/PLAN.md` and `Harness/tasks/<id>/PROGRESS.md` (task artifacts, not production code).
2. **E-GATE → D-GATE → W2.** Exploration Gate after W0 (all questions answered). Write Decomposition Gate after W1 architecture defines the write-set (Dispatch Table mandatory). Full spec in WF-MAX.md.
3. **Single-message dispatch.** ALL parallel Workers for a wave MUST be spawned in ONE message. Sequential one-per-turn spawning defeats parallelism.
4. **Worker rule**: one write file per Worker (anti-bundling). **Manager rule**: Manager count ≥ ceil(sqrt(write_files) / 3) (anti-under-decomposition at domain level). Each Manager: 2-7 Workers.
5. **Manager MUST spawn ≥2 Workers or dissolve.** 0-1 Workers = Phantom Manager (AP5).
6. **Overhead > 0.30 → degrade to /wf.** Record the decision in PLAN.md.

## Manager Synthesis (retry/escalation)

```
1. COLLECT → 2. DEDUPLICATE → 3. CONFLICT (flag, no silent resolve) → 4. SYNTHESIZE → 5. REPORT
```
Worker failure: retry 1× → on 2nd failure, Manager absorbs or escalates to CEO for replan.

## Wave Order

```
W0 (Explore) → E-GATE → W1 (Architecture) → D-GATE → W2 (Implement, single-message) → W2R (Review) → W3+ (dependent waves) → INTEGRATION → CLOSEOUT
```

## Anti-Pattern Quick Check (before every wave)

CEO-as-Worker? Under-decomposition (too few Managers)? Serial spawn? Fake parallelism? Phantom Manager? Silent degrade? → If any match, stop and re-decompose. Full catalog in WF-MAX.md.

## Return Format

- Dispatch Table (every wave)
- Worker returns (raw, per wave)
- Manager synthesis reports
- CEO integration decisions
- Verification evidence
- Agent count used vs minimum required (Manager_min audit)
