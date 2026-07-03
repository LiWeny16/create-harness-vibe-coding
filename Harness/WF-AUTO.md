# WF-AUTO — Perpetual Auto-Optimization Workflow

## Trigger

- Explicit: `/wf-auto`, `wf auto`, `auto mode`
- The user wants continuous improvement that never stops on its own.
- The user is done giving instructions and wants the system to self-direct.

## Core Principle

**NEVER STOP.** WF-AUTO is a perpetual loop. It does not stop when a task is "done" — it finds the next improvement and continues. The ONLY permitted stop is the 8-Angle Exhaustion Gate: when all 8 independent perspectives agree there is no worthwhile optimization direction left.

This fills the gap between:
- `/wf` — task-bounded, stops on completion
- `/wf-max` - task-bounded WF strict superset: complete role chain plus maximum parallelism
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

WF-AUTO does not inherit WF-MAX mandatory maximum fan-out unless `/wf-max` is
explicitly invoked or the selected change exceeds the auto cycle cap and
escalates. Auto mode stays one accepted change per cycle.

```
CEO(1) ──┬── Angle-Agent₁ (correctness)
         ├── Angle-Agent₂ (performance)
         ├── Angle-Agent₃ (security)
         ├── Angle-Agent₄ (maintainability)
         ├── Angle-Agent₅ (test-coverage)
         ├── Angle-Agent₆ (architecture)
         ├── Angle-Agent₇ (ux-dx)
         └── Angle-Agent₈ (robustness)
                │
                ▼
         CEO synthesizes → picks highest-impact direction
                │
                ▼
         Implementer → Reviewer → Debugger (if needed) → Verifier
                │
                ▼
         LOOP → W0 (re-sense)

         ─── WHEN ALL 8 EXHAUSTED ───

         CEO → Cross-Model Oracle (Codex/Claude)
                │
                ├── Oracle finds directions → feed into W1
                └── Oracle also empty → Tier 2 confirm rounds → STOP
```

CEO orchestrates the perpetual loop. CEO never writes production code — delegates all implementation. CEO synthesizes angle findings, picks direction, dispatches implement/review/verify, then loops.

When all 8 angles return exhausted, the CEO does NOT immediately enter confirmation — it first consults the other AI model (the Cross-Model Oracle) for a fresh perspective. Only when the oracle also finds nothing do confirmation rounds begin.

### State Machine

WF-AUTO operates in explicit states. Without a state machine, "auto-degrade", "switch", "return", and "stop asking" become ambiguous.

```
                    ┌──────────────────────────────┐
                    │         auto.internal         │ ←── W0-W5 loop (8-angle scan + oracle + spark)
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
| `auto.internal` | Running W0-W5 with internal 8-angle scan | Default, or return from checkpoint/spark |
| `auto.spark` | Searching external sources for candidates when internal + oracle are empty | All 8 exhausted + oracle empty, OR user requested spark mode |
| `auto.checkpoint` | Intent Checkpoint — brief user alignment check | Every N cycles (adaptive: 2→5→10) |
| `auto.exhausted` | A-GATE passed permanently | 3 consecutive all-exhausted rounds + oracle confirmed |
| `paused` | User interrupted, waiting for direction | User says "stop" or interrupts at any point |

**State transitions are CEO-owned.** The CEO decides which state to enter based on W0 results and checkpoint responses. The state machine is recorded in `Harness/tasks/auto/PROGRESS.md` at each transition.

## The 8 Angles (Exhaustion Dimensions)

These are the ONLY lenses through which optimization is justified. An angle is "exhausted" when it finds zero actionable improvements.

| # | Angle | Focus | Example Signals |
|---|-------|-------|----------------|
| 1 | **Correctness** | Bugs, logic errors, edge cases, null safety, race conditions, state inconsistency | Unhandled error paths, missing null checks, off-by-one, stale cache |
| 2 | **Performance** | Speed, memory, I/O, algorithmic complexity, bundle size, query efficiency | O(n²) where O(n log n) exists, unnecessary allocations, blocking I/O |
| 3 | **Security** | Injection, auth/authz, secret exposure, input validation, dependency CVEs | Unsanitized input, hardcoded keys, missing rate limits, outdated deps |
| 4 | **Maintainability** | Code clarity, DRY violations, coupling, naming, comment accuracy, dead code | Duplicated logic, misleading names, god functions, stale comments |
| 5 | **Test Coverage** | Missing tests, weak assertions, untested edge cases, flaky tests, test speed | Untested error branches, mock-only tests (no integration), slow suites |
| 6 | **Architecture** | Boundary violations, dependency direction, interface stability, layer discipline | Circular deps, leaky abstractions, wrong layer ownership |
| 7 | **UX / DX** | Error messages, API ergonomics, documentation, logging, CLI/API consistency | Cryptic errors, missing docs, inconsistent flags, poor discoverability |
| 8 | **Robustness** | Resilience, retry/backoff, graceful degradation, observability, recovery | Missing retries, no circuit breaker, silent failures, no health checks |

These 8 angles are comprehensive by design. If ALL 8 return empty, the codebase is genuinely optimized to the point where further changes would be cosmetic or harmful.

## Perpetual Loop

```text
┌──────────────────────────────────────────────────────────────┐
│  W0: SENSE — 8 angle agents + oracle + spark (all parallel)  │
│  ↓                                                           │
│  A-GATE: Angle Exhaustion Gate                               │
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

### W0: SENSE (Parallel Angle Scan)

CEO dispatches ALL 8 angle agents in ONE message. Each agent:

- **Role**: Read-only scanner through one angle lens
- **Read set**: The project source tree (scoped by CEO to relevant paths)
- **Return**: `{angle, findings: [{file, line, severity, description, suggestedFix}], exhausted: boolean, confidence: 0-1}`
- **Stop condition**: Returns when scan is complete — does not implement anything

Angle agents are READ-ONLY. They find, they don't fix.

Every cycle starts with a fresh W0 scan. The codebase changed since last cycle (due to W2-W5), so new findings may emerge.

### A-GATE: Angle Exhaustion Gate (THE ONLY STOP)

This is the single most important gate in WF-AUTO. It prevents both premature stopping and infinite busywork.

**Gate Protocol (three-tier):**

```
TIER 1 — All 8 angles return exhausted=true?
  ├── NO → Findings exist. Continue to W1. Reset confirmCount to 0.
  └── YES → Move to Tier 1.5 (Cross-Model Oracle).

TIER 1.5 — CROSS-MODEL ORACLE (fresh eyes before confirming exhaustion)
  ├── CEO prepares a context pack: project summary, recent cycle history,
  │   architecture overview, and the 8 angle exhaustion reports.
  ├── CEO invokes the OTHER CLI (Codex if running as Claude, Claude if
  │   running as Codex) — same detection rule as /wf-review.
  │   Command: `git diff --stat && cat Harness/tasks/auto/PROGRESS.md |
  │   codex exec "This project believes it is fully optimized. From 8
  │   angles (correctness, performance, security, maintainability, test
  │   coverage, architecture, UX/DX, robustness), find ANY optimization
  │   direction that was missed. Be adversarial — prove us wrong."`
  ├── Oracle returns: {findings: [...], empty: boolean}
  ├── Oracle finds directions? → Feed into W1 as HIGH priority findings.
  │   Reset confirmCount to 0. The oracle's fresh perspective broke the
  │   local blind spot. Continue looping.
  └── Oracle also empty? → Move to Tier 2. The external model agrees:
      this codebase is genuinely optimized.

TIER 2 — Confirmation round.
  ├── confirmCount < 2? → Increment confirmCount. Re-run W0 with
  │   DIFFERENT agent seeds/scopes to prevent false negatives.
  │   (e.g., if first scan was broad, second scan is deep-dive on
  │   recent change areas; if first used file-level, second uses
  │   function-level.)
  └── confirmCount ≥ 2? → 3 consecutive rounds with all 8 exhausted
      AND cross-model oracle confirmed empty. PERMANENT STOP.
      Record final exhaustion evidence.
```

**Oracle Rules (modeled on /wf-review):**

- [ ] CEO detects which CLI is running: `which codex` / `which claude`
- [ ] CEO invokes the OTHER CLI — never the same model
- [ ] If neither CLI is available: skip oracle, move directly to Tier 2, record "oracle unavailable" in PROGRESS.md
- [ ] Oracle is invoked at most ONCE per Tier 1 exhaustion event (not re-invoked per confirmation round — the confirmation rounds are local)
- [ ] Oracle findings are treated as severity=high by default (external model perspective gets extra weight)

**Gate Rules:**

- [ ] All 8 angles returned structured findings (not just "looks good")
- [ ] Each angle scanned ≥80% of its relevant surface area
- [ ] No angle was skipped or timed out
- [ ] Cross-Model Oracle was consulted (or unavailability recorded)
- [ ] confirmCount ≥ 2 (three consecutive all-exhausted rounds)
- [ ] CEO reviewed at least 2 angle returns that were borderline (confidence < 0.9)

**Anti-false-exhaustion measures:**
- Angle agents MUST include confidence scores. Low confidence (0.5-0.7) on "exhausted" = CEO re-dispatches that angle with a deeper scope.
- Between confirmation rounds, CEO varies the scan strategy: broad → deep, file-level → function-level, recent-changes → full-tree.
- If any angle returns confidence < 0.8 on "exhausted", that angle MUST be re-run with expanded scope before counting toward confirmCount.
- The Cross-Model Oracle is the ultimate blind-spot breaker — a different model family with different inductive biases. If it finds anything, the loop continues.

### W1: PRIORITIZE

CEO takes all angle findings, deduplicates, and ranks:

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

### W2: IMPLEMENT

Modeled on WF's build loop but scoped to ONE change:

1. CEO writes the change spec in `Harness/tasks/auto/PROGRESS.md` (cycle number, angle, finding, planned change, write set ≤3 files)
2. CEO dispatches `implementer` with the change spec
3. Implementer changes ONLY the declared write set

CEO NEVER writes production code — this rule is inherited from WF-MAX (AP1: CEO-as-Worker).

Acceptance-specific implementation rules:

- Dispatch `test-writer` when AC IDs need new or updated tests.
- Dispatch `implementer` with forbidden truth files: PRD, AC, UI/API contracts, test plan, and validation report.
- Implementer may not rewrite ACs/contracts to make the implementation pass.

### W3: REVIEW

Two-gate review (from WF/subagents.md), then reflection:

1. **Spec review**: Did the change address the finding without introducing extras?
2. **Code-quality review**: Is the change correct, maintainable, safe?
3. **Reflector gate**: Does review evidence, verifier evidence, and residual
   risk support acceptance?

At least one `reviewer` subagent. For critical/security findings, dispatch two independent reviewers.
Do not record the cycle as accepted until `reflector` returns PASS.

### W4: DEBUG (Recovery)

If review or verification fails:
1. `debugger` isolates the smallest failing path
2. Fix and re-review (max 2 attempts per cycle)
3. On 3rd failure: record the finding as "attempted, blocked" and move to next finding in W1
4. Blocked findings are revisited after 3 cycles (the codebase may have changed enough to unblock)

### W5: VERIFY

- Run project test suite (or relevant subset)
- For browser-visible changes: real browser check
- For API changes: real request/response check
- Record evidence in `Harness/tasks/auto/PROGRESS.md`
- Final acceptance still requires cross-review and reflector PASS after
  verification. A passing command alone is not acceptance.

Validation must include AC-by-AC evidence in `Harness/tasks/auto/PROGRESS.md`,
not only a generic pass/fail command result.

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
  and the 8-Angle Exhaustion Gate
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

Spark is NOT a separate optimization engine. It is a **candidate provider** plugged into W0, alongside the internal 8-angle scan and the cross-model oracle. W1 still owns prioritization across ALL sources.

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
- `source=internal` — from 8-angle scan
- `source=oracle` — from cross-model review
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

The CEO operates under the same strict tool boundary as WF-MAX:

| CEO Has | CEO MUST NOT Use (on source code) |
|---------|-----------------------------------|
| Task (spawn agents) | Edit (on source files) |
| Read (for scoping) | Write (on source files) |
| Grep/Glob (for scoping) | MultiEdit (on source files) |
| Write (to PROGRESS.md only) | Bash (except final verification) |

**Exception**: CEO MAY write to `Harness/tasks/auto/PROGRESS.md` and `Harness/tasks/auto/PLAN.md` — these are task-tracking artifacts.

## Anti-Pattern Catalog

| # | Anti-Pattern | Symptom | Fix |
|---|-------------|---------|-----|
| AP1 | **CEO-as-Worker** | CEO writes production code | Delegate ALL implementation to Workers |
| AP2 | **Premature stop** | CEO decides "good enough" before A-GATE | A-GATE is the ONLY stop. No exceptions. |
| AP3 | **Shallow angle scan** | Angle returns "exhausted" after scanning 1-2 files | Require ≥80% surface coverage per angle |
| AP4 | **Batch implementation** | Multiple unrelated changes in one cycle | ONE finding per cycle. Split if needed. |
| AP5 | **Sequential angle scan** | Angles dispatched one at a time | ALL 8 angles in ONE message, every cycle |
| AP6 | **Skip review** | Implementation → verify without review | Review gate is mandatory, every cycle |
| AP7 | **Scope creep** | A "simple fix" grows to 5+ files | Hard cap: ≤3 files per cycle. Split larger changes across cycles. |
| AP8 | **False exhaustion** | Angle returns exhausted=true with low confidence | Require confidence ≥0.8 on exhausted. Re-dispatch low-confidence angles. |
| AP9 | **Stale angle agents** | Same scan strategy every cycle → blind spots emerge | Vary scan depth and scope between cycles |
| AP10 | **Skip oracle** | All 8 exhausted → CEO goes straight to confirm rounds without consulting other CLI | Oracle is mandatory at Tier 1.5. If CLI unavailable, record it and proceed — but never skip because "it's probably fine." |
| AP11 | **Spark as escape hatch** | Using spark to avoid the discipline of internal scan | Spark activates ONLY when internal + oracle are empty. It augments W0, not replaces it. |
| AP12 | **Fake value scoring** | Inflating Value Gate scores to pass candidates through | CEO must justify each dimension score. Reviewer checks Value Gate scores as part of spec review. |
| AP13 | **Shiny object syndrome** | Implementing every spark candidate without Value Gate filtering | All spark candidates MUST pass the Value Gate (≥18/25, no dimension <3). |
| AP14 | **Inspiration theater** | Spark cycles without evidence ledger → no way to know if they worked | Evidence ledger is mandatory per cycle. Weak spark count tracked. |
| AP15 | **Interrogation checkpoint** | Asking 5+ aggressive questions → user tunes out | Exactly 2 questions: "Still aligned?" + "What should change?" |

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
- IDLE → CEO re-evaluates: are angle agents scoped too narrowly? Is the codebase actually done?
- After IDLE alarm + re-scope + 2 more empty cycles → consider A-GATE

### User Interrupt
- User can interrupt at any time with new instructions
- Interrupt pauses the loop; CEO records current cycle state
- After addressing interrupt, resume from W0 (fresh scan)

## When NOT to Use /wf-auto

- Explicit user task with defined completion criteria → use `/wf` or `/wf-max`
- Single known bug → just fix it directly
- User wants to review every change before it's made → /wf-auto is autonomous by design
- Codebase is <100 lines → angle scan overhead > benefit
- Production hotfix needed urgently → direct fix, not optimization loop

## /wf vs /wf-max vs /wf-auto

Acceptance source is PRD-derived AC IDs in `/wf` and `/wf-max`, and cycle
Mini PRD-derived AC IDs in `/wf-auto`.

| Dimension | /wf | /wf-max | /wf-auto |
|-----------|-----|---------|----------|
| Scope | Task-bounded | Task-bounded | Unbounded |
| Stop condition | Task complete | Task complete | 8-angle exhaustion + oracle + spark exhausted + 2 confirm rounds |
| Direction | User-specified | User-specified | AI-inferred + cross-model oracle + external spark |
| Organization | Flat (CEO + agents) | 3-tier (CEO→Mgr→Worker) | Flat (CEO + angle agents + oracle + spark searchers + build agents) |
| Duration | One task | One task | Perpetual |
| User interaction | At key gates | At key gates | Adaptive checkpoint (2→5→10 cycles), 2 questions only |
| Cycle count | 1 | 1 (multi-wave) | ∞ (until exhaustion) |
| Files/cycle | Per task | Per wave (many) | ≤3 per cycle |
| Exploration | 3-5 agents once | 5-10 agents once | 8 angles + oracle + 8 spark sources EVERY cycle |
| Cross-model check | No (wf-review is separate) | No (wf-review is separate) | Yes — Cross-Model Oracle built into A-GATE Tier 1.5 |
| External inspiration | No | No | Yes — Spark candidate provider when internal sources empty |
| Evidence tracking | Per task | Per task | Evidence ledger per cycle with measured impact |

## Task Capsule

WF-AUTO uses a dedicated task capsule at `Harness/tasks/auto/`:

- `Harness/tasks/auto/PROGRESS.md` — cycle log, exhaustion evidence, cumulative stats
- `Harness/tasks/auto/PLAN.md` — current cycle's change spec

Unlike normal task capsules, this one is never archived — it's the permanent home of the auto-optimization state.

## Closeout (The Only Exit)

Closeout happens exactly once, when A-GATE passes permanently:

1. CEO records final exhaustion evidence from all 8 angles (3 consecutive rounds)
2. CEO writes summary: total cycles, files changed, findings addressed, findings rejected, residual risk
3. CEO marks `Harness/tasks/auto/PROGRESS.md` as "WF-AUTO EXHAUSTED" with timestamp
4. `Harness/PROGRESS.md` is updated with the auto session outcome
5. No further automatic action is taken
