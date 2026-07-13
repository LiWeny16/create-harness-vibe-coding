# WF-AUTO Design Proposal: Intent Re-anchoring + Spark Mode

## Context

The current `/wf-auto` system runs perpetual autonomous optimization cycles. Problem: after 2+ cycles, the system drifts from user intent. Also, when adaptive internal coverage returns empty, the cross-model oracle helps — but there is no mechanism to handle the case where the user themselves doesn't know the direction.

## Feature 1: Intent Re-anchoring Gate (every 2 cycles)

### Trigger
After every 2 completed optimization cycles (W0-W5 loop), BEFORE starting the next W0 scan.

### Protocol
CEO MUST stop and interact with the user. This is a HARD GATE — no code changes until the user responds.

CEO presents:
1. Summary of last 2 cycles (what was changed, why, what angle drove it)
2. Current inferred direction ("I think we're optimizing toward: X")
3. A set of aggressive anchoring questions:

**Mandatory questions (ask ALL of these):**
1. "After seeing the last 2 cycles, is this still aligned with what you want?"
2. "What should this project/system become? What's its true purpose right now?"
3. "What would 'done' or 'good enough' look like to you? Can you describe a concrete end state?"
4. "Are we optimizing the right things, or should we pivot to a different concern?"
5. "Do you have a clearer goal now than when we started? What is it?"

**If user gives clear answers:**
- CEO updates `Harness/tasks/auto/PLAN.md` with refined direction
- Resets cycle counter
- Continues to W0 with refined focus

**If user says "I don't know" / "keep going" / gives vague answers:**
- CEO proposes: "Since the direction isn't clear, I can switch to `/wf-auto-spark` — an inspiration-driven mode where I search external sources (GitHub, docs, trends, competitors) for meaningful optimization ideas. I'll constantly self-question whether each idea has real value. Do you want this, or do you have another preference?"
- If user agrees → switch to spark mode
- If user says stop → stop
- If user provides direction after the proposal → continue with refined direction

**If user explicitly says "stop asking me, just keep going autonomously":**
- Extend re-anchor interval to 5 cycles
- Record this preference in `Harness/memory/user-corrections-preferences.md`

### Why 2 cycles?
- 1 cycle is too frequent (annoying)
- 3+ cycles risks significant drift
- 2 is the minimum to show a pattern (direction) while still being early enough to correct

## Feature 2: /wf-auto-spark — Inspiration Mode

### Trigger
- User explicitly says `/wf-auto-spark` or `wf auto spark`
- Auto-degrade from `/wf-auto` when user can't clarify direction at re-anchor gate
- Auto-activate when adaptive internal coverage returns empty for 3+ consecutive cycles AND oracle also empty

### Core Philosophy
**"Inspiration never runs dry, but value must be constantly questioned."**

Spark mode replaces the adaptive internal probe scan with EXTERNAL inspiration search. It looks OUTSIDE the codebase for ideas, then filters ruthlessly for value.

### Spark Sources (searched in parallel)

| Source candidate | Tool | What It Finds |
|---|---|---|
| **GitHub Trending** | WebSearch / Tavily | Popular repos in same language/stack, new patterns |
| **Ecosystem Pulse** | WebSearch / npm/PyPI | New libraries, version bumps, deprecated APIs replaced |
| **Best Practices** | WebSearch + Docs | Latest official recommendations, style guides, security advisories |
| **Competitor Analysis** | WebSearch | Similar open-source projects — what are they doing better? |
| **Real-world Issues** | GitHub Issues / Stack Overflow | Common pain points users report for similar projects |
| **Architecture Trends** | WebSearch | Emerging patterns (e.g., micro-frontends, island architecture, edge computing) |
| **Developer Experience** | WebSearch / Docs | New tooling, better CLI patterns, improved error messages |
| **Performance Benchmarks** | WebSearch | Industry benchmarks, optimization techniques, profiling tools |

### Spark Loop

```text
SPARK: select evidence-relevant external sources → gather inspiration sparks
  ↓
FILTER: Keep only sparks relevant to THIS project's stack, size, and domain
  ↓
VALUE-GATE: For each remaining spark, CEO asks 4 hard questions:
  1. "Would this change make a real difference to someone using/reading this code?"
  2. "Is this solving a problem that actually exists, or one we're imagining?"
  3. "Is this the RIGHT time to do this, or would it be premature optimization?"
  4. "If I explained this change to the user, would they nod or shrug?"
  Only sparks passing ALL 4 questions survive.
  ↓
PICK: Highest value spark (by impact × feasibility × alignment with project trajectory)
  ↓
IMPLEMENT: Same bounded cycle as WF-AUTO (≤3 files, ≤50 lines)
  ↓
REVIEW + VERIFY: Same two-gate review
  ↓
REFLECT: CEO writes a "value reflection" note in PROGRESS.md:
  "This cycle was driven by [source]. It matters because [reason].
   Without this change, [consequence]. The user would notice because [evidence]."
  ↓
LOOP → SPARK
```

### Value Reflection (self-questioning)

After EVERY spark cycle, CEO MUST write a reflection:

```text
## Cycle N - Value Reflection
Spark Source: GitHub trending — React 19 Server Components pattern
Change: Refactored data fetching to use async Server Components
Why it matters: Eliminates client-side waterfall requests, reduces JS bundle by 30KB
Without this: Pages load 300ms slower, bundle grows with each new data dependency
User would notice: Faster page transitions, smaller initial load
Confidence: HIGH — benchmarked before/after
```

If CEO CANNOT write a convincing value reflection → the spark was NOT valuable → record as "spark rejected: insufficient value" and move to next spark.

### Spark Anti-Patterns

| # | Anti-Pattern | Symptom | Fix |
|---|-------------|---------|-----|
| SP1 | **Shiny object syndrome** | Chasing every new library/pattern without filtering | Value Gate questions 2 and 3 catch this |
| SP2 | **Fake value reflection** | Vague "this is better" without concrete evidence | Require specific metrics or user-visible impact |
| SP3 | **Copycat without context** | "Project X does Y so we should too" without understanding why | Value Gate question 1 catches this |
| SP4 | **Infinite inspiration loop** | Spark → implement → spark → implement without convergence | After 5 spark cycles, re-anchor: "Are we building toward something coherent?" |
| SP5 | **Ignore internal state** | Only looking outward, ignoring project's own issues | Alternate: every 3rd spark cycle, run adaptive internal coverage too |

### Spark Stop Condition

Spark mode is gentler about stopping — it CAN stop when:
- 5 consecutive sparks fail the Value Gate (nothing meaningful found)
- OR user interrupts
- OR project reaches a state where external inspiration consistently produces "nice to have but not valuable" results

But spark mode should be VERY reluctant to stop. The default is "keep searching broader" — expand search terms, look at adjacent ecosystems, go deeper into specific topics.

## Integration: How These Two Features Fit Together

```
User starts /wf-auto
  ↓
W0-W5 × 2 cycles (autonomous optimization)
  ↓
INTENT RE-ANCHOR GATE → ask user aggressive questions
  ├── User gives clear direction → refine, continue /wf-auto
  ├── User says "I don't know" → propose /wf-auto-spark
  ├── User says "stop asking, just go" → extend to 5-cycle interval
  └── User says "stop" → stop
  ↓
If /wf-auto-spark:
  SPARK loop (external inspiration)
  ↓
  Every 5 spark cycles → internal check: "Are we building toward coherence?"
  ↓
  Every 10 spark cycles → soft re-anchor: "This is what we've built. Still valuable?"
```

## Files to Create/Modify

### New files:
1. `Harness/WF-AUTO-SPARK.md` — spark mode spec
2. `.claude/skills/wf-auto-spark/SKILL.md` — spark skill loader
3. `.claude/commands/wf-auto-spark.md` — /wf-auto-spark command bridge

### Modified files:
4. `Harness/WF-AUTO.md` — add Intent Re-anchoring Gate section, cross-reference spark mode
5. `.claude/skills/wf-auto/SKILL.md` — add re-anchor constraint
6. `.claude/commands/wf-auto.md` — add re-anchor to loop
7. `Harness/README.md` — add spark routing
8. `CLAUDE.md` — mention spark mode

## Open Design Questions (for Codex to answer)

1. Is 2 cycles the right interval for re-anchoring? Too frequent or too rare?
2. Should the Value Gate use a simple yes/no or a scoring system (1-5)?
3. Should spark mode have its own exhaustion gate, or is the "5 failed sparks" stop condition enough?
4. Should we add a "project trajectory" document that spark mode maintains — a living document describing where the project is heading?
5. When spark mode finds an idea that requires >50 lines / >3 files, should it:
   a) Break it into multiple spark cycles
   b) Escalate to /wf or /wf-max for that specific change then return to spark
   c) Skip it and find smaller sparks
6. Is the Value Reflection visible to the user during the run, or only in PROGRESS.md?
