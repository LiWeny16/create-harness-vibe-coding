# WF-AUTO-SPARK — Perpetual Inspiration Mode

**Extension of `/wf-auto`. Never stops. Searches external sources for new ideas. Long-term roadmap with staged milestones. Goals adjustable but ≤50% deviation from North Star.**

## Trigger

- User explicitly invokes `/wf-auto-spark` or `$wf-auto-spark`
- Auto-degrade from `/wf-auto` when user can't clarify direction at Re-Anchor Gate
- Auto-activate when 8-angle scan returns empty for 3+ consecutive cycles AND oracle also empty

## Core Philosophy

**"Inspiration never runs dry, but direction must hold."**

Spark mode replaces the 8-angle internal scan with EXTERNAL inspiration search. Unlike vanilla `/wf-auto` which can stop when no internal improvements are found, spark mode NEVER stops — it always looks outward for the next idea.

But perpetual search without direction = drift. The **Roadmap** is the anchor.

## Inherited Execution Chain

WF-AUTO-SPARK inherits WF-AUTO and WF constraints. External spark search replaces discovery only; it does not replace acceptance, implementation, review, verification, reflection, or evidence.

Every accepted spark candidate must re-enter the same per-cycle chain:

```text
spark search -> Value Gate -> deviation check -> Mini PRD -> AC IDs
-> test/validation plan -> implementer -> verifier -> cross-review
-> reflector PASS -> evidence ledger -> next spark cycle
```

Spark searchers are read-only. Any implementation must use the dispatch packet
from `Harness/dispatch.md` with explicit write set, forbidden truth files, AC
IDs, and verification commands. A candidate with no verifier evidence or no
reflector PASS is not accepted, even if the idea is valuable.

## Startup: Roadmap Declaration

Before first spark cycle, CEO MUST declare a roadmap. This is written to `Harness/tasks/auto/SPARK-ROADMAP.md`.

### Roadmap Format

```markdown
# Spark Roadmap: <descriptive title>

## North Star (immutable without user consent)
<One sentence. The ultimate outcome this project is building toward.
Answers: "What does success look like in 6-12 months?">

## Current Milestone: M<N>
**Goal**: <measurable outcome>
**Success criteria**: <how we know M<N> is done>
**Target cycles**: <expected spark cycles to complete>

## Upcoming Milestones
| # | Goal | Success Criteria | Est. Cycles | Dependencies |
|---|------|-----------------|-------------|--------------|
| M2 | ... | ... | ... | M1 |
| M3 | ... | ... | ... | M2 |

## Constraints
- Max deviation from North Star: 50% (checked per cycle and per milestone)
- Roadmap review: every 10 spark cycles or at milestone completion
- Milestones can be reordered, split, merged, or replaced (≤50% deviation)
- North Star change requires explicit user confirmation
```

### Roadmap Rules

1. **North Star is near-immutable.** CEO can propose changes but MUST get user confirmation. No silent drift.
2. **Milestones are flexible within 50% deviation.** CEO can adjust order, split, merge, or replace milestones as external inspiration reveals better paths — as long as the new direction is ≥50% aligned with the North Star.
3. **Deviation is measured semantically**, not mechanically. CEO asks: "If the original North Star is X, does this milestone/change still move us toward X?" If the answer is "maybe, but mostly toward Y" → deviation exceeding 50% → REJECT.
4. **Milestone completion triggers roadmap review.** Mark milestone done in SPARK-ROADMAP.md, update PROGRESS.md, and re-evaluate upcoming milestones against current state.

## Spark Loop

```text
STARTUP: Declare roadmap (North Star + Milestones) → user confirms
  ↓
┌─────────────────────────────────────────────────────────┐
│ SPARK: 8 parallel external searches → gather sparks     │
│   ↓                                                     │
│ FILTER: Keep only sparks relevant to project stack/size  │
│   ↓                                                     │
│ VALUE GATE: 4 hard questions for each spark             │
│   1. "Would this make a real difference to users?"      │
│   2. "Is this solving a real problem, or imagined?"     │
│   3. "Is this the RIGHT time?"                          │
│   4. "Would the user nod or shrug if I explained it?"   │
│   Only sparks passing ALL 4 survive.                    │
│   ↓                                                     │
│ DEVIATION CHECK: Does this spark align ≥50% with        │
│   North Star AND current milestone?                     │
│   If no → record "spark rejected: deviation >50%"       │
│   ↓                                                     │
│ PICK: Highest value × alignment spark                   │
│   ↓                                                     │
│ IMPLEMENT: Bounded cycle (≤3 files, ≤50 lines net)      │
│   ↓                                                     │
│ VERIFY + CROSS-REVIEW + REFLECTOR PASS                  │
│   ↓                                                     │
│ VALUE REFLECTION: CEO writes in PROGRESS.md             │
│   "Driven by [source]. Matters because [reason].        │
│    Without this [consequence]. User notices [evidence]." │
│   ↓                                                     │
│ MILESTONE CHECK: Is current milestone complete?         │
│   Yes → update SPARK-ROADMAP.md, celebrate in PROGRESS  │
│   No  → continue                                       │
│   ↓                                                     │
│ RE-ANCHOR GATE (every 10 cycles):                       │
│   "Completed N cycles toward [milestone].                │
│    Recent changes: [summary].                            │
│    Deviation from North Star: [X]%.                      │
│    Continue? Adjust milestones? Pause?"                  │
│   ├── User confirms → continue                          │
│   ├── User adjusts → update roadmap (≤50% deviation)    │
│   └── User says stop → stop (only user can stop)        │
│   ↓                                                     │
└── LOOP → SPARK (never auto-stop)                        ┘
```

## Spark Sources (searched in parallel, read-only)

| # | Source | Tool | What It Finds |
|---|--------|------|---------------|
| 1 | **GitHub Trending** | WebSearch / Tavily | Popular repos in same language/stack, new patterns |
| 2 | **Ecosystem Pulse** | WebSearch / npm/PyPI | New libraries, version bumps, deprecated APIs replaced |
| 3 | **Best Practices** | WebSearch + Docs | Latest official recommendations, style guides, security advisories |
| 4 | **Competitor Analysis** | WebSearch | Similar open-source projects — what are they doing better? |
| 5 | **Real-world Issues** | GitHub Issues / Stack Overflow | Common pain points users report for similar projects |
| 6 | **Architecture Trends** | WebSearch | Emerging patterns (e.g., micro-frontends, island architecture, edge computing) |
| 7 | **Developer Experience** | WebSearch / Docs | New tooling, better CLI patterns, improved error messages |
| 8 | **Performance Benchmarks** | WebSearch | Industry benchmarks, optimization techniques, profiling tools |

## Deviation Guard (50% Rule)

### What "50% deviation" means

It's a semantic alignment check, not a mechanical metric. CEO evaluates:

1. **Direction check**: "If the North Star is X, does this change move us closer to X?"
2. **Intent check**: "Would someone who agreed with the original North Star agree with this change?"
3. **Cumulative check**: "Over the last 10 cycles, have our changes collectively stayed ≥50% aligned with the North Star?"

### Deviation scoring (CEO judgment, recorded in PROGRESS.md)

| Alignment | Score | Action |
|-----------|-------|--------|
| Directly advances North Star | 90-100% | Execute immediately |
| Supports North Star indirectly | 70-89% | Execute, note reasoning |
| Tangential but valuable | 50-69% | Execute with caution, flag in reflection |
| Mostly unrelated, minor value | 30-49% | SKIP — exceeds deviation budget |
| Contradicts North Star | 0-29% | REJECT — record in rejected-sparks log |

### Deviation budget

- Per-cycle deviation cap: individual spark must score ≥50%
- Cumulative deviation: rolling 10-cycle average must score ≥65%
- If cumulative drops below 65% → force Re-Anchor Gate immediately (don't wait for 10-cycle interval)
- If user confirms current direction → reset rolling average

### Milestone adjustment within 50%

Milestones CAN be changed without user confirmation IF:
- The new milestone still serves the North Star (≥50% alignment)
- CEO records the change and reasoning in SPARK-ROADMAP.md

Milestones CANNOT be changed without user confirmation IF:
- The new milestone changes the North Star itself
- Cumulative deviation would exceed 50%

## Value Reflection (per cycle)

After EVERY spark cycle, CEO writes:

```text
## Cycle N — Value Reflection
Spark Source: [which of the 8 sources]
Change: [what was implemented]
Deviation Score: [X]% — [brief reasoning]
Why it matters: [concrete impact]
Without this: [consequence of not doing it]
User would notice: [evidence of user-visible improvement]
Milestone progress: [M<N>: X% complete]
Cumulative deviation (10-cycle): [X]%
```

If CEO CANNOT write a convincing value reflection → spark was NOT valuable → record as rejected and move on.

## Stop Condition

**Spark mode does NOT auto-stop.** Only these events stop it:

1. User explicitly says "stop" or "exit spark mode"
2. User says "stop" at Re-Anchor Gate
3. Fatal error that prevents further operation (not just "no sparks found")

"No sparks found" → expand search: broader terms, adjacent ecosystems, deeper topics.

"No sparks pass Value Gate" → lower the bar slightly, or ask user: "I'm not finding high-value sparks. Adjust criteria or continue searching?"

## Anti-Patterns

| # | Anti-Pattern | Symptom | Prevention |
|---|-------------|---------|------------|
| SP1 | **Shiny object syndrome** | Chasing every new library without filtering | Value Gate + Deviation Check |
| SP2 | **Fake value reflection** | Vague "this is better" without evidence | Require concrete metrics or user-visible impact |
| SP3 | **Copycat without context** | "Project X does Y so we should too" | Value Gate question 1 |
| SP4 | **Silent North Star drift** | Small changes accumulate, direction shifts without noticing | Cumulative deviation check every 10 cycles |
| SP5 | **Milestone rot** | Milestones become irrelevant but aren't updated | Milestone review at Re-Anchor Gate |
| SP6 | **Spark tunnel vision** | Only looking at one type of source | Rotate through all 8 sources, don't skip any for >3 cycles |

## Integration with /wf-auto

```text
/wf-auto (autonomous optimization)
  ↓
Internal 8-angle scan per cycle
  ↓
Re-Anchor Gate (every preset interval)
  ├── User gives clear direction → refine, continue /wf-auto
  ├── User says "I don't know" / vague → propose /wf-auto-spark
  ├── User says "keep going" → extend interval, continue /wf-auto
  └── User says "stop" → stop
  ↓
/wf-auto-spark (perpetual inspiration)
  ├── Has explicit roadmap + North Star
  ├── External spark search replaces internal scan
  ├── Deviation guard active
  └── Never auto-stops
```

## Task Capsule & Recording

WF-AUTO-SPARK uses a dedicated task capsule at `Harness/tasks/auto/`. Shared with `/wf-auto` — same capsule, different operational mode.

### Capsule Structure

| File | Purpose | Updated |
|------|---------|---------|
| `Harness/tasks/auto/SPARK-ROADMAP.md` | North Star + milestones + deviation log | At startup + every milestone change |
| `Harness/tasks/auto/PLAN.md` | Current cycle's change spec (write set, acceptance criteria) | Before each implementation |
| `Harness/tasks/auto/PROGRESS.md` | Cycle log, value reflections, cumulative stats, evidence | After each cycle |
| `Harness/PROGRESS.md` | Global task index — active spark session status | At session start, milestone, and stop |

### Heartbeat Protocol (per cycle, in `PROGRESS.md`)

```markdown
## Cycle N — Spark Heartbeat
**Timestamp**: <ISO>
**Spark Source**: <1-8> — <what was searched>
**Deviation Score**: <X>% — <brief reasoning>
**Change**: <what was implemented, ≤3 files, ≤50 lines net>
**Write Set**: <files changed>

### Value Reflection
**Why it matters**: <concrete impact>
**Without this**: <consequence>
**User would notice**: <evidence>

### Milestone Progress
- Current: M<N> — <X>% complete
- Cumulative deviation (10-cycle): <X>%

### Evidence
- Build: <pass/fail>
- Tests: <N passed / M failed>
- Manual check: <what was verified>
```

### PLAN.md Format (per cycle)

Before implementing, CEO writes one cycle plan:

```markdown
# Cycle N Plan
**Date**: <ISO>
**Mode**: wf-auto-spark
**Spark Source**: <# and name>
**Finding**: <what external search found>
**Planned Change**: <concise description>
**Write Set**: <≤3 files>
**Acceptance Criteria**: <how to verify success>
**Deviation Check**: <alignment score %> — <reasoning>
```

### Global PROGRESS.md Linkage

`Harness/PROGRESS.md` is updated when:
- **Session start**: add `| auto-spark | <task-id> | active | <North Star summary> |`
- **Milestone complete**: update status with milestone result
- **Session stop**: mark status with final milestone + reason (user stop / exhausted)

### Stop / Resume Continuity

When spark mode stops (user says stop, session ends, or crash):
1. Last `PROGRESS.md` heartbeat is the checkpoint
2. `SPARK-ROADMAP.md` preserves North Star + milestone state
3. On resume: read SPARK-ROADMAP.md, read last heartbeat, continue from last milestone
4. If `Harness/PROGRESS.md` shows session is still "active", auto-resume spark mode on SessionStart
5. CEO checks: "Last session stopped at cycle N, milestone M<X> at Y%. Continue or adjust?"

This replaces the broken `/wf-auto` auto-continue. No silent drift across sessions.

## Files

| File | Purpose |
|------|---------|
| `Harness/WF-AUTO-SPARK.md` | This spec |
| `Harness/tasks/auto/SPARK-ROADMAP.md` | Active roadmap (created at startup) |
| `Harness/tasks/auto/PLAN.md` | Per-cycle change spec |
| `Harness/tasks/auto/PROGRESS.md` | Cycle log, heartbeat, evidence ledger |
| `Harness/PROGRESS.md` | Global task index linkage |
| `.claude/skills/wf-auto-spark/SKILL.md` | Claude Code skill loader |
| `.agents/skills/wf-auto-spark/SKILL.md` | Codex skill loader (mirror) |
