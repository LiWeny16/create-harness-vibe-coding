---
name: wf-auto
description: Perpetual auto-optimization mode. Never stops — continuously improves code until 8-angle exhaustion. Adaptive checkpoints, external spark search, evidence ledger. Use for Claude /wf-auto, Codex $wf-auto, auto mode, or when the user wants unbounded self-directed optimization.
---

# WF Auto — Perpetual Auto-Optimization

## Load (authoritative specs)

- `Harness/WF-AUTO.md` — full spec: perpetual loop, state machine, 8-angle exhaustion gate, cross-model oracle, spark candidate provider, Value Gate scoring, evidence ledger, Intent Checkpoints, anti-patterns, safety controls
- `Harness/subagents.md` — agent roster, controller role, efficiency ladder
- `Harness/dispatch.md` — handoff format, File claim, Concurrency group fields
- `Harness/agent-workflow.md` — build/review/test loop, cohesion rule, completion gate
- `.claude/skills/wf-review/SKILL.md` — cross-model invocation pattern (used by the oracle step)

## Trigger & When NOT to Use

- **Trigger**: Claude `/wf-auto`, Codex `$wf-auto`, `wf auto`, `auto mode`, or user wants continuous self-directed improvement
- **Do NOT use**: user has a specific bounded task (use `/wf`), task needs maximum parallelism (use `/wf-max`), production hotfix needed urgently, codebase <100 lines

## State Machine

```
auto.internal → auto.spark → auto.checkpoint → auto.exhausted → paused
```

CEO tracks state in `Harness/tasks/auto/PROGRESS.md`. Transitions are CEO-owned.

## Hard Constraints

1. **NEVER STOP except A-GATE.** No "task complete" early exit. The Angle Exhaustion Gate (internal + oracle + spark all empty, 3 confirm rounds) is the ONLY permitted stop.
2. **CEO never writes production code.** CEO uses Task, Read, Grep/Glob. No Edit/Write/Bash on source files. Exception: CEO MAY write to `Harness/tasks/auto/PROGRESS.md` and `Harness/tasks/auto/PLAN.md`.
3. **ALL sources in ONE message per cycle.** 8 angles + oracle + spark searchers. Batching is mandatory.
4. **ONE finding per cycle.** One change, ≤3 files, ≤50 lines diff. Big ideas (>50 lines) escalate to /wf or /wf-max then return.
5. **Two-gate review every cycle.** Spec review before code-quality review. No skipping.
6. **A-GATE has 3 tiers.** All 8 exhausted → Cross-Model Oracle → Spark search → 2 confirmation rounds → STOP.
7. **Value Gate is scored, not binary.** 5 dimensions (Impact, Evidence, Fit, Timing, Cost/Risk), 1-5 each. Pass: ≥18/25 AND no dimension <3.
8. **Intent Checkpoint is adaptive.** 2→5→10 cycles. Exactly 2 questions: "Still aligned?" + "What should change?" Early on drift signals.
9. **Evidence ledger per cycle.** Source, evidence type, expected impact, verification method, measured result, verdict. Track weak spark count.

## The 8 Angles (quick reference)

| # | Angle | Finds |
|---|-------|-------|
| 1 | Correctness | Bugs, edge cases, null safety, race conditions |
| 2 | Performance | Slow paths, memory, algorithmic complexity |
| 3 | Security | Injection, auth, secrets, dependency CVEs |
| 4 | Maintainability | Clarity, DRY, coupling, naming, dead code |
| 5 | Test Coverage | Missing tests, weak assertions, flaky tests |
| 6 | Architecture | Boundaries, dependency direction, layer discipline |
| 7 | UX / DX | Error messages, API ergonomics, documentation |
| 8 | Robustness | Resilience, retry, observability, recovery |

## Spark Sources (when internal + oracle empty)

| # | Source | Evidence Weight |
|---|--------|-----------------|
| 1 | Official Docs & Advisories | HIGH |
| 2 | Ecosystem Pulse | MEDIUM |
| 3 | GitHub Trending (same stack) | LOW-MEDIUM |
| 4 | Best Practices (latest) | MEDIUM |
| 5 | Competitor/Peer Projects | LOW |
| 6 | Real-world Issues | MEDIUM |
| 7 | Architecture Trends | LOW |
| 8 | Performance Benchmarks | MEDIUM |

Source-quality: official docs > blog posts. Trending ≠ correct. Competitor behavior is hypothesis only. Every spark MUST cite source with URL and date.

## Perpetual Loop

```
W0: SENSE (8 angles + oracle + 8 spark sources, all parallel)
A-GATE [findings? → W1 | all empty? → oracle → spark → confirm ×2 → STOP]
CHECKPOINT [every 2→5→10 cycles, 2 questions]
W1: PRIORITIZE (across internal + oracle + spark)
W2: IMPLEMENT → W3: REVIEW → W4: DEBUG → W5: VERIFY
RECORD + EVIDENCE LEDGER → LOOP W0
```

## Cycle Recording

Every cycle writes to `Harness/tasks/auto/PROGRESS.md`:
- Cycle number, timestamp, state
- Source (internal/oracle/spark-*), source citation
- Finding, change description, files changed
- Value Gate scores (if spark candidate)
- Review result, verification evidence
- Evidence Ledger: evidence type, expected impact, verification method, measured result, verdict

## Safety

- ≤3 files, ≤50 lines per cycle
- Big ideas (>50 lines) escalate to /wf or /wf-max, then return to auto
- Destructive changes flagged with rollback plan
- IDLE alarm after 5 empty cycles → re-scope → A-GATE candidate
- Spark stop: 5 failed Value Gates OR 3 weak measured impacts OR 2 repeated source families empty
- User can interrupt at any time

## Return Format

- Total cycles run
- Findings addressed per source (internal / oracle / spark)
- Evidence ledger with measured impacts
- Exhaustion evidence (3-round confirmation)
- Weak spark count
- Final codebase state
- Residual risk assessment
