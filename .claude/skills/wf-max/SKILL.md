---
name: wf-max
description: Use for /wf max or maximum parallelism. Three-tier CEO→Manager→Worker hierarchy with recursive depth, per-domain span caps, and leaf-condition stop rules.
---

# WF Max — Maximum Parallelism

**WF-MAX ACTIVE: You are CEO, not implementer.**

```
CEO CONTRACT (enforced by hooks + D-GATE):

ALLOWED: Read (scoping), Grep/Glob (scoping), Agent (spawn), Task (tracking),
         Write (PLAN.md/PROGRESS.md only), Bash (ls/dir/tree/git only)

FORBIDDEN: Edit/Write/MultiEdit on source files, Bash (build/run/edit),
           sequential spawn (batch ALL agents in ONE message),
           Read (deep source — delegate to Workers)

If tempted to edit source → STOP. Spawn a Worker.
```

## Load (authoritative specs)

- `Harness/WF-MAX.md` — full spec: organization model, Decomposition Gate, span formula, anti-pattern catalog, wave orchestration
- `Harness/subagents.md` — agent roster, controller role, efficiency ladder
- `Harness/dispatch.md` — File claim, Concurrency group handoff fields
- `Harness/agent-workflow.md` — cohesion rule, completion gate

## Trigger & When NOT to Use

**Explicit invocation always fans out — no file-count escape.** When the user types `/wf-max`, spawning subagents is mandatory and unconditional. File count, task size, and overhead DO NOT apply to explicit invocation — they govern only AUTO-triggering. A 1-file `/wf-max` still fans out. "Degrade to /wf" changes the organization (flat vs CEO→Manager→Worker), never the fact of fan-out — `/wf` itself requires ≥3 subagents. There is NO path from an explicitly typed `/wf-max` to a solo main-thread pass.

- **Trigger**: `/wf-max [task]`, or auto when write-set ≥5 files AND clear disjoint boundaries (parallelismScore ≥2.0)
- **Auto-trigger degradation only** (never applies to explicit `/wf-max`): files <5, all changes share single interface (serial dependency), import/re-export refactor (global consistency needed), overhead >0.30
- **Leaf conditions** (stop splitting): files ≤ span×2, avgLines <50, overhead >0.30

## Hard Constraints

1. **CEO never writes production code.** CEO uses Agent, Read, Grep/Glob. No Edit/Write/MultiEdit on source files. Exception: CEO MAY write to `Harness/tasks/<id>/PLAN.md` and `Harness/tasks/<id>/PROGRESS.md` (task artifacts, not production code).
2. **E-GATE → D-GATE → W2.** Exploration Gate after W0 (all questions answered). Write Decomposition Gate after W1 architecture defines the write-set (Dispatch Table mandatory + Self-Audit Checklist).
3. **Single-message dispatch.** ALL parallel Workers for a wave MUST be spawned in ONE message. Sequential one-per-turn spawning defeats parallelism (AP6).
4. **Worker rule**: one write file per Worker (anti-bundling, Gate Rule #1). **Manager rule**: Manager count ≥ ceil(sqrt(write_files) / 3) (anti-under-decomposition, Gate Rule #2). Each Manager: 2-7 Workers (Gate Rule #3).
5. **Manager MUST spawn ≥2 Workers or dissolve.** 0-1 Workers = Phantom Manager (AP5).
6. **Overhead > 0.30 → degrade to /wf.** Record the decision in PLAN.md.

## When to Ask the User (AskUserQuestion)

CEO MUST use the `AskUserQuestion` tool when:

- Intent ambiguous after exploration (≥2 valid interpretations)
- Scope trade-off needs user decision (e.g. "full rewrite vs minimal fix")
- Architecture direction has ≥2 viable approaches with different trade-offs
- User gave vague request like "improve performance" or "clean up code"
- D-GATE reveals >7 files — ask user to narrow scope

Format: 2-4 options per question, `multiSelect: false` for exclusive choices. Each option must include a `description` explaining the trade-off. Example:

```
Q: "Auth refactor scope?"
[1] "Minimal" — fix token validation only, 1 file
[2] "Standard" — extract middleware + add tests, 3-5 files  
[3] "Full" — new auth module with pluggable providers, 8-12 files
```

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

| AP | Pattern | Fix |
|----|---------|-----|
| AP1 | CEO-as-Worker | Re-delegate to Worker |
| AP2 | Under-decomposition | Split files by concern |
| AP3 | Serialization trap | Dispatch X and Y in parallel NOW |
| AP4 | Fake parallelism | One file = one Writer |
| AP5 | Phantom Manager | Dissolve, absorb by sibling |
| AP6 | Sequential spawn | Batch ALL Task() in ONE message |
| AP7 | Silent degrade | Record justification in PLAN.md |

## Return Format

- Dispatch Table (every wave, in PLAN.md)
- Self-Audit Checklist (D-GATE, all items checked)
- Worker returns (raw, per wave)
- Manager synthesis reports
- CEO integration decisions
- Verification evidence
- Agent count used vs minimum required (Manager_min audit)
