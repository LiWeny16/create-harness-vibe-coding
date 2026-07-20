# WF-AUTO — Perpetual Auto-Optimization Workflow

## Trigger

- Explicit: `/wf-auto`, `$wf-auto`, `/skills wf-auto`
- The user must type one of these exact tokens to enter WF-AUTO.
- These phrases are NOT triggers and must NOT auto-enter WF-AUTO: "auto mode", "never stop", "self-improve", "continuous optimize", "unbounded self-directed optimization", "keep going", or any natural-language description of perpetual work. Only explicit command tokens enter.

## Core Principle

**NEVER STOP.** WF-AUTO is a perpetual loop. It does not stop when a task is "done" — it finds the next improvement and continues. The only permitted stop is the Adaptive Coverage Exhaustion Gate: when the project's dynamic risk obligations are covered, two different confirmation strategies find no worthwhile direction, and unresolved uncertainty is recorded.

This fills the gap between:
- `/wf` — task-bounded, stops on completion
- `/wf-max` - task-bounded `/wf` variant on the same WF kernel: maximum safe fan-out, WF-Max-Useful by default, WF-Max-Strict only on explicit strict request
- `/wf-auto` — **unbounded, self-directed, perpetual improvement**

## Organization Model

WF-AUTO uses the same acceptance-driven mother flow per cycle. Each selected
optimization becomes a Mini PRD with AC IDs, a test/validation plan, bounded
implementation, independent validation, review, debug if needed, and memory.
Autonomy changes who chooses the next improvement; it does not make
implementation or tests the source of truth.

## Inherited WF/WF-MAX Constraints

WF-AUTO inherits WF acceptance gates and subagent orchestration for every
accepted change. Each W2-W5 cycle must run this chain:

```text
Mini PRD -> AC IDs -> test/validation plan -> implementer -> verifier
-> cross-review -> reflector PASS -> evidence ledger -> next W0
```

WF-AUTO also inherits the WF-MAX CEO tool and write-set boundary: the CEO may
scope, plan, dispatch, synthesize, and write only the auto task capsule. The CEO
does not edit production source. Implementation happens only through dispatched
workers with explicit write sets, forbidden truth files, and verification
commands.

WF-AUTO does not inherit WF-MAX fan-out modes (Useful or Strict) unless `/wf-max` is
explicitly invoked or the selected change exceeds the auto cycle cap and
escalates. Auto mode stays one accepted change per cycle.

```
CEO(1) ──┬── Probe-Agent (selected by risk and evidence)
         ├── Probe-Agent (selected by changed surface)
         ├── Probe-Agent (selected by user goal)
         └── Probe-Agent (selected by evidence gap)
                │
                ▼
         CEO synthesizes → picks highest-impact direction
                │
                ▼
         Implementer → Reviewer → Debugger (if needed) → Verifier
                │
                ▼
         LOOP → W0 (re-sense)

         ─── WHEN ADAPTIVE COVERAGE IS EXHAUSTED ───

         CEO → Cross-Model Oracle (Codex/Claude)
                │
                ├── Oracle finds directions → feed into W1
                └── Oracle also empty → Tier 2 confirm rounds → STOP
```

CEO orchestrates the perpetual loop. CEO never writes production code — delegates all implementation. CEO synthesizes probe findings, picks direction, dispatches implement/review/verify, then loops.

When the selected probes return exhausted, the CEO does NOT immediately enter confirmation. It checks dynamic risk obligations and unresolved uncertainty, then consults the other AI model only when a fresh perspective is warranted. Confirmation rounds must use different scan strategies.

### State Machine

WF-AUTO operates in explicit states. Without a state machine, "auto-degrade", "switch", "return", and "stop asking" become ambiguous.

```
                    ┌──────────────────────────────┐
    │         auto.internal         │ ←── W0-W5 loop (adaptive probes + oracle + spark)
                    │  (active optimization cycle)  │
                    └──────────┬───────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
    [findings exist]   [all exhausted]    [cycle count % N == 0]
              │                │                 │
              ▼                ▼                 ▼
         W1 continue    auto.spark         auto.checkpoint
                        (external         (Intent Checkpoint)
                        candidate          │
                        search)            ├── user clear → back to auto.internal
              │                │           ├── user vague → propose spark
              │                ▼           ├── user "stop asking" → extend interval
              │         [spark finds       └── user "stop" → paused
              │          candidates?]
              │           │      │
              │           ▼      ▼
              │     [yes→W1] [no→confirm]
              │                │
              ▼                ▼
         auto.internal    auto.exhausted (STOP)
                              │
                          paused ←── user interrupt at any point
```

**States:**

| State | Meaning | Entry Condition |
|-------|---------|-----------------|
| `auto.internal` | Running W0-W5 with dynamically selected probes | Default, or return from checkpoint/spark |
| `auto.spark` | Searching external sources for candidates when internal + oracle are empty | Selected probes exhausted + oracle empty, OR user requested spark mode |
| `auto.checkpoint` | Intent Checkpoint — brief user alignment check | Every N cycles (adaptive: 2→5→10) |
| `auto.exhausted` | A-GATE passed permanently | Two different confirmation strategies return no actionable finding |
| `paused` | User interrupted, waiting for direction | User says "stop" or interrupts at any point |

**State transitions are CEO-owned.** The CEO decides which state to enter based on W0 results and checkpoint responses. The state machine is recorded in `Harness/tasks/auto/PROGRESS.md` at each transition.

## Adaptive coverage instead of a magic angle count

The old protocol dispatched a fixed set of eight angles every cycle. That made
the stop condition easy to explain, but it also spent context on irrelevant
surfaces and treated every repository as if it had the same risks.

The current protocol uses a dynamic probe catalog and project obligations:

1. Build a profile from the repository, recent diff, failures, task capsule,
   and user direction.
2. Score candidate probes by risk, change relevance, evidence gap, expected
   user value, novelty, and scan cost.
3. Always keep Goal / value and Correctness / safety visible; add security,
   recovery, performance, architecture, testing, UX/DX, dependency, or other
   probes only when the evidence triggers them.
4. Record selected probes, skipped probes, scan strategy, confidence, surface
   coverage, and findings in the cycle ledger.
5. Stop only after dynamic high-risk obligations are covered and two different
   confirmation strategies find no actionable improvement.

Read the complete selection algorithm, obligation matrix, scan strategies, and
ledger schema in [WF-AUTO-ANGLES.md](WF-AUTO-ANGLES.md).

## Perpetual Loop

```text
┌──────────────────────────────────────────────────────────────┐
│  W0: SENSE — adaptive probes + oracle + spark (as triggered)  │
│  ↓                                                           │
│  A-GATE: Adaptive Coverage Exhaustion Gate                          │
│  ├── Findings exist (any source) → continue to W1            │
│  └── ALL sources empty? → CROSS-MODEL ORACLE                │
│       ├── Oracle finds directions → feed into W1             │
│       └── Oracle also empty → auto.spark state              │
│            ├── Spark finds candidates → feed into W1         │
│            └── Spark also empty → CONFIRM round              │
│                 ├── confirmCount < 2 → re-scan with variation│
│                 └── confirmCount ≥ 2 → STOP (permanent)      │
│  ↓                                                           │
│  CHECKPOINT: every N cycles (adaptive: 2→5→10)              │
│  ├── "Still aligned?" + "What should change?"                │
│  └── Drift signal? → earlier checkpoint                      │
│  ↓                                                           │
│  W1: PRIORITIZE — CEO ranks across ALL sources               │
│  ↓                                                           │
│  W2: IMPLEMENT — bounded change (≤3 files per cycle)         │
│  ↓                                                           │
│  W3: REVIEW — adversarial review of the change               │
│  ↓                                                           │
│  W4: DEBUG — if review/verify fails, fix and re-review       │
│  ↓                                                           │
│  W5: VERIFY — confirm the change works                       │
│  ↓                                                           │
│  RECORD + EVIDENCE LEDGER — write to PROGRESS.md             │
│  ↓                                                           │
│  LOOP → W0                                                   │
└──────────────────────────────────────────────────────────────┘
```

### W0: SENSE (Adaptive Probe Selection)

CEO dispatches the selected probe agents in one batch when the runtime allows
it. The selection comes from [WF-AUTO-ANGLES.md](WF-AUTO-ANGLES.md), not from a
fixed count. Each probe agent:

- **Role**: Read-only scanner through one selected probe lens
- **Read set**: The project source tree (scoped by CEO to relevant paths)
- **Return**: `{probe, findings: [{file, line, severity, description, suggestedFix}], exhausted: boolean, confidence: 0-1, coverage: 0-1, skippedReason?: string}`
- **Stop condition**: Returns when scan is complete — does not implement anything

Probe agents are READ-ONLY. They find, they don't fix.

Every cycle starts with a fresh W0 scan. The codebase changed since last cycle (due to W2-W5), so new findings may emerge.

### A-GATE: Adaptive Coverage Exhaustion Gate (THE ONLY STOP)

This is the single most important gate in WF-AUTO. It prevents both premature stopping and infinite busywork.

**Gate Protocol:**

```
TIER 1 — Did selected probes cover all dynamic high-risk obligations?
  ├── NO → Select the missing obligation and continue to W0.
  └── YES → Check findings, confidence, coverage, and value threshold.

TIER 2 — Did any selected probe find an actionable direction?
  ├── YES → Feed the highest-value finding to W1. Reset confirmCount.
  └── NO → Run a confirmation pass with a different scan strategy.

TIER 3 — Is uncertainty still high or coverage borderline?
  ├── YES → Re-run only the uncertain probe, or invoke the peer-review oracle.
  └── NO → Record an empty confirmation pass.

TIER 4 — Two different confirmation strategies are empty?
  ├── NO → Continue with another strategy or newly triggered obligation.
  └── YES → Record exhaustion evidence and stop.
```

**Oracle Rules (modeled on /wf-review):**

- [ ] CEO detects available peer CLIs: `claude`, `codex`, and `opencode`
- [ ] CEO invokes a peer CLI only when unresolved high-risk uncertainty or borderline coverage justifies it
- [ ] If no peer CLI is available, dispatch the installed `reviewer` role as an independent subagent context
- [ ] If neither peer CLI nor subagent surface is available, record "oracle unavailable" in PROGRESS.md and continue with local confirmation
- [ ] Oracle is invoked at most once per adaptive exhaustion event
- [ ] Oracle findings are treated as severity=high by default (external model perspective gets extra weight)

**Gate Rules:**

- [ ] Dynamic high-risk obligations are covered
- [ ] Each selected probe returned structured findings, confidence, and surface coverage
- [ ] Skipped obligations have an evidence-based reason
- [ ] Cross-Model Oracle was consulted when uncertainty justified it, or unavailability was recorded
- [ ] Two different confirmation strategies returned no actionable finding
- [ ] CEO reviewed borderline probe returns (confidence < 0.8 or coverage < 0.8)

**Anti-false-exhaustion measures:**
- Probe agents MUST include confidence and relevant surface coverage. Low confidence or coverage on "exhausted" means the probe is re-run with a deeper scope.
- Between confirmation rounds, CEO varies the scan strategy: breadth → depth, change-first → failure-first, or contract-first.
- Re-run only the uncertain or under-covered probe instead of rescanning irrelevant surfaces.
- The Cross-Model Oracle breaks blind spots when local evidence is insufficient; if it finds anything, the loop continues.

### W1: PRIORITIZE

CEO takes all probe findings, deduplicates, and ranks:

```
priorityScore = severity × impactRadius × reversibility

severity: critical=10, high=6, medium=3, low=1
impactRadius: files touched × user paths affected
reversibility: easy-to-revert=1.2, hard-to-revert=0.5
```

CEO picks the SINGLE highest-scoring finding. One change per cycle keeps each iteration bounded and reviewable.

If multiple findings tie, prefer: correctness > security > robustness > performance > architecture > maintainability > test-coverage > ux-dx.

Before W2, CEO writes a cycle Mini PRD:

- Goal
- Scope and non-scope
- AC IDs
- UI/API/state contracts, if touched
- Verification commands and evidence expected

### W2-W5: IMPLEMENT → REVIEW → DEBUG → VERIFY

WF-AUTO inherits the standard WF-KERNEL write/review/fix/verify gates per cycle. Each accepted finding follows:

[WF-KERNEL.md](WF-KERNEL.md) write gate (implementer, one file_claim per cycle, ≤3 files, ≤50 lines net), review gate (at least one independent reviewer; two for critical/security), fix gate (debugger on failure, max 2 fix attempts per cycle), and verify gate (test suite, real browser/API check, AC-by-AC evidence).

CEO NEVER writes production code (per WF-KERNEL State Ownership). Implementer writes ONLY the declared write set. Production agents never write task state.

### RECORD

Every cycle writes one entry to `Harness/tasks/auto/PROGRESS.md`:

```text
## Cycle N (timestamp) — State: auto.internal | auto.spark | auto.checkpoint
- Source: internal (angle: correctness) | oracle | spark-github | spark-ecosystem
- Finding: unhandled null in userService.getUser()
- Source citation: <URL if external>
- Change: added null guard + error response in controller
- Files: src/controllers/user.ts, src/services/user.ts
- Value Gate scores: Impact=4, Evidence=3, Fit=5, Timing=4, Cost/Risk=4 (Total=20/25 ✓)
- Review: PASS (spec + code-quality)
- Verify: PASS (unit tests + manual API check)
- Reflector: PASS
- Evidence Ledger:
  - Evidence type: code analysis
  - Expected impact: null safety in user lookup path
  - Verification method: unit test + manual API check
  - Measured result: CONFIRMED — null case now returns 404 instead of 500
- Residual risk: none
```

### LOOP → W0

IMMEDIATELY return to W0. No pause between cycles — the only breaks are the adaptive Intent Checkpoint and the A-GATE.

### WF-AUTO Hook Exception

Runtime hooks are disabled by default across the Harness scaffold. The only
allowed exception is an explicitly enabled `/wf-auto` tick hook for long-running
auto-optimization.

The hook is not a role-enforcement mechanism, not a memory injection mechanism,
and not WF-MAX state. It is only a bounded tick trigger:

```text
wf-auto hook event
-> confirm /wf-auto is active in Harness/tasks/auto/
-> check STOP/paused/user-interrupt state
-> request exactly one W0-W5 tick or one Intent Checkpoint
-> append heartbeat/evidence to Harness/tasks/auto/PROGRESS.md
-> exit
```

Hard boundaries:

- no hook is installed or registered by default
- only `/wf-auto` may use a runtime hook
- the hook must run one bounded tick, not an unbounded process
- the hook must respect `Harness/tasks/auto/STOP`, `state=paused`, user stop,
  and the Adaptive Coverage Exhaustion Gate
- the hook must not enforce WF-MAX roles, writeSet, or agent identity
- the hook must not inject memory directly; use `MEMORY_PROTOCOL.md` scenario
  hints through controller/context-master
- the hook must not write production files outside the normal W0-W5 gated flow
- repeated hook failures must pause auto mode and record evidence, not keep
  retrying silently

Perpetual behavior comes from repeated bounded ticks with durable evidence, not
from a single runaway hook process.

### Intent Checkpoint (adaptive re-anchoring)

WF-AUTO is autonomous but not blind. Every N cycles, the CEO pauses briefly to verify alignment. This is NOT a hard stop — it's a lightweight drift check.

**Adaptive interval:**
- First checkpoint: after 2 cycles (quick alignment check)
- Then: every 5 cycles
- After user says "keep going, don't ask": every 10 cycles
- Early trigger on drift signals: destructive change, public API change, or CEO confidence in alignment drops below 0.7

**Checkpoint protocol (only 2 questions):**

CEO presents:
1. Summary of recent cycles (max 3 lines)
2. Current inferred trajectory
3. Two questions:

> **Q1**: "Still aligned with what you want?"
> **Q2**: "What should change?"

**Responses:**
- User confirms or gives direction → update trajectory in PLAN.md, continue
- User says "I don't know" / vague → CEO proposes auto.spark mode: "I can search external sources (GitHub, docs, trends) for inspiration. I'll verify every idea has real value before implementing. Switch to spark-augmented mode?"
- User says "keep going, don't ask again" → extend interval to 10 cycles, record preference
- User says "stop" → transition to `paused` state

**Why 2 questions, not 5:** Five aggressive questions train users to say "keep going" to escape the interrogation. Two questions with a concrete summary gets honest answers.

### Spark: External Candidate Provider

Spark is NOT a separate optimization engine. It is a **candidate provider** plugged into W0, alongside the adaptive probe scan and the peer-review oracle. W1 still owns prioritization across ALL sources.

**When spark activates:**
- W0 internal scan returns empty AND oracle also empty → `auto.spark` state
- User explicitly requests `/wf-auto-spark` → full perpetual inspiration mode (see `WF-AUTO-SPARK.md`)
- User says "I don't know" at an Intent Checkpoint

**`/wf-auto-spark` is a standalone perpetual mode** (spec: `Harness/WF-AUTO-SPARK.md`). Unlike vanilla spark which is a candidate provider inside `/wf-auto`, the standalone mode:
- Never auto-stops — only user can stop it
- Requires a roadmap (North Star + staged milestones) declared at startup
- Enforces ≤50% deviation guard against North Star
- Runs Re-Anchor Gate every 10 cycles for user course-correction

**Spark sources (searched in parallel, read-only):**

| # | Source | Tool | Evidence Weight |
|---|--------|------|-----------------|
| 1 | **Official Docs & Advisories** | WebSearch + Docs | HIGH — authoritative |
| 2 | **Ecosystem Pulse** | WebSearch / registry | MEDIUM — factual but may not apply |
| 3 | **GitHub Trending (same stack)** | WebSearch | LOW-MEDIUM — popular ≠ correct |
| 4 | **Best Practices (latest)** | WebSearch + Docs | MEDIUM — context-dependent |
| 5 | **Competitor/Peer Projects** | WebSearch | LOW — hypothesis only, needs verification |
| 6 | **Real-world Issues** | WebSearch / Stack Overflow | MEDIUM — evidence of real pain |
| 7 | **Architecture Trends** | WebSearch | LOW — premature adoption risk |
| 8 | **Performance Benchmarks** | WebSearch | MEDIUM — if reproducible |

**Spark source-quality rules:**
- Official docs and security advisories beat blog posts
- Trending repos are weak evidence — many stars ≠ good fit
- Competitor behavior is hypothesis only, never justification
- Every spark candidate MUST cite its source with URL and date
- Offline: if web search fails, skip spark, record "spark offline" in PROGRESS.md
- Stale sources (>1 year for fast-moving ecosystems): flag with `[STALE]` tag

**Spark candidates flow into W1 with `source=spark-<source-name>`:**

W1 prioritization now handles three source types:
- `source=internal` — from adaptive probe scan
- `source=oracle` — from peer CLI or reviewer-subagent review
- `source=spark-<name>` — from external inspiration search

Tie-breaking: internal > oracle > spark (local context beats external inspiration).

### Value Gate (scoring, not binary)

Before a spark candidate enters W1, it passes through the Value Gate. Binary yes/no invites fake confidence. Use 5-dimension scoring:

| Dimension | 1 (worst) | 3 (acceptable) | 5 (best) |
|-----------|-----------|----------------|----------|
| **Impact** | Cosmetic, no user notice | Noticeable improvement | Transformative |
| **Evidence** | "Feels right", no data | One source or benchmark | Multiple sources + reproducible |
| **Fit** | Conflicts with project direction | Neutral, doesn't hurt | Directly advances trajectory |
| **Timing** | Premature, distracts from current bet | Reasonable moment | Urgent or uniquely opportune |
| **Cost/Risk** | High risk, fragile change | Moderate, reversible | Low risk, trivial to revert |

**Pass threshold:** Total ≥ 18/25 AND no dimension below 3.

**Spark checkpoint condition (empirical, not arbitrary):**
Spark mode does not auto-stop. When ANY of these happens, trigger Re-Anchor Gate, record evidence, and ask whether to continue, change criteria, or stop:
- 5 consecutive candidates fail the Value Gate (nothing meaningful found)
- 3 implemented spark cycles with weak measured impact (evidence ledger shows no real gain)
- 2 repeated source families with zero new candidates (search exhausted)
- User interrupts (stop immediately if the user says stop)

### Evidence Ledger

Every cycle records an evidence entry. This turns spark from "inspiration theater" into an empirical optimization loop:

```text
## Cycle N - Evidence Ledger
Candidate source: internal (angle: performance) | oracle | spark-github | spark-ecosystem
Source citation: <URL and date if external>
Evidence type: benchmark | docs | user report | code analysis | hypothesis
Expected impact: <concrete metric or observable change>
Verification method: test | benchmark | manual check | browser evidence
Measured result: <actual outcome after W5 — filled AFTER verification>
Verdict: CONFIRMED (impact matched) | PARTIAL (some gain) | NEGLIGIBLE (no real change) | REVERTED (caused regression)
```

If a spark cycle's measured result is NEGLIGIBLE or REVERTED, increment `weakSparkCount`. After 3 weak spark cycles, trigger Re-Anchor Gate; do not enter `auto.exhausted` unless the user chooses to stop.

## CEO Constraints

CEO tool boundaries follow [WF-KERNEL.md](WF-KERNEL.md) State Ownership: CEO plans, dispatches, synthesizes, and writes ONLY the auto task capsule (`Harness/tasks/auto/PROGRESS.md`, `Harness/tasks/auto/PLAN.md`). CEO never writes production source code — all implementation is delegated to Workers.

## Anti-Pattern Catalog

Core anti-patterns AP1 (CEO-as-Worker), AP4 (batch implementation), AP6 (skip review), AP7 (scope creep) are covered by [WF-KERNEL.md](WF-KERNEL.md) State Ownership and Tier-Aware Acceptance Gates.

WF-AUTO-specific anti-patterns:

## Safety Controls

### File Change Cap
- Max 3 files changed per cycle
- Max 50 lines changed per cycle (total diff)
- Prevents runaway refactors

### Destructive Change Detection
Before W2, CEO checks: does this change delete functionality, change public API, or alter behavior visible to users?
- If yes → flag in PROGRESS.md, require higher confidence threshold, add rollback plan
- If the finding is "delete dead code" → only delete if genuinely unreachable (verified by grep across full tree)

### Idle Detection
- If 5 consecutive cycles produce 0-line changes (all findings rejected at review), trigger IDLE alarm
- IDLE → CEO re-evaluates: are probes scoped too narrowly? Are obligations missing? Is the codebase actually done?
- After IDLE alarm + re-scope + 2 more empty cycles → consider A-GATE

### User Interrupt
- User can interrupt at any time with new instructions
- Interrupt pauses the loop; CEO records current cycle state
- After addressing interrupt, resume from W0 (fresh scan)

## When NOT to Use /wf-auto

- Explicit user task with defined completion criteria → use `/wf` or `/wf-max`
- Single known bug → just fix it directly
- User wants to review every change before it's made → /wf-auto is autonomous by design
- Codebase is <100 lines → adaptive scan overhead > benefit
- Production hotfix needed urgently → direct fix, not optimization loop

## /wf vs /wf-max vs /wf-auto

Acceptance source is PRD-derived AC IDs in `/wf` and `/wf-max`, and cycle
Mini PRD-derived AC IDs in `/wf-auto`.

| Dimension | /wf | /wf-max | /wf-auto |
|-----------|-----|---------|----------|
| Scope | Task-bounded | Task-bounded | Unbounded |
| Stop condition | Task complete | Task complete | Dynamic obligations covered + two different empty confirmation passes |
| Direction | User-specified | User-specified | AI-inferred + peer-review oracle + external spark |
| Organization | Flat (CEO + agents) | 3-tier (CEO→Mgr→Worker) | Flat (CEO + selected probes + oracle + spark searchers + build agents) |
| Duration | One task | One task | Perpetual |
| User interaction | At key gates | At key gates | Adaptive checkpoint (2→5→10 cycles), 2 questions only |
| Cycle count | 1 | 1 (multi-wave) | ∞ (until exhaustion) |
| Files/cycle | Per task | Per wave (many) | ≤3 per cycle |
| Exploration | 3-5 agents once | 5-10 agents once | Dynamic probes + triggered spark sources per cycle |
| Peer review check | No (wf-review is separate) | No (wf-review is separate) | Yes — peer-review oracle built into A-GATE Tier 1.5 |
| External inspiration | No | No | Yes — Spark candidate provider when internal sources empty |
| Evidence tracking | Per task | Per task | Evidence ledger per cycle with measured impact |

## Task Capsule

WF-AUTO uses a dedicated task capsule at `Harness/tasks/auto/`:

- `Harness/tasks/auto/PROGRESS.md` — cycle log, exhaustion evidence, cumulative stats
- `Harness/tasks/auto/PLAN.md` — current cycle's change spec

Unlike normal task capsules, this one is never archived — it's the permanent home of the auto-optimization state.

## Closeout (The Only Exit)

Closeout happens exactly once, when A-GATE passes permanently:

1. CEO records final exhaustion evidence: dynamic obligations, selected and skipped probes, coverage, confidence, and two different confirmation strategies
2. CEO writes summary: total cycles, files changed, findings addressed, findings rejected, residual risk
3. CEO marks `Harness/tasks/auto/PROGRESS.md` as "WF-AUTO EXHAUSTED" with timestamp
4. `Harness/PROGRESS.md` is updated with the auto session outcome
5. No further automatic action is taken
