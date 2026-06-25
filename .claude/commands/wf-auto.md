# /wf-auto

Enter perpetual auto-optimization mode. Never stops on its own — continuously senses (internal 8-angle scan + cross-model oracle + external spark sources), prioritizes across all candidate sources, implements, reviews, and verifies improvements. Adaptive Intent Checkpoints (2→5→10 cycles) verify alignment with 2 questions only. Only stops when internal + oracle + spark sources are all exhausted across 3 confirmation rounds.

## Required

- Load `wf-auto` skill.
- MUST dispatch all 8 angle agents + oracle + spark searchers in ONE message every cycle.
- When internal scan empty: invoke Cross-Model Oracle → if also empty → activate Spark candidate search.
- MUST pass the Angle Exhaustion Gate (internal exhausted + oracle empty + spark exhausted + 2 confirmation rounds).
- CEO NEVER writes production code — delegate all implementation.
- ONE finding per cycle. ≤3 files changed per cycle.
- Evidence ledger recorded per cycle with measured impact.

## Loop

```text
W0: SENSE — 8 angles + oracle + spark sources (all parallel)
A-GATE → findings (any source)? → W1
       → all empty? → ORACLE
            → oracle finds? → W1
            → oracle empty? → SPARK
                 → spark finds? → W1 (Value Gate ≥18/25)
                 → spark empty? → 2 confirm rounds → STOP
CHECKPOINT: every 2→5→10 cycles: "Still aligned?" + "What should change?"
W1: PRIORITIZE — rank across internal + oracle + spark sources
W2: IMPLEMENT — bounded change (≤3 files)
W3: REVIEW — spec + code-quality gates
W4: DEBUG — recover if needed (max 2 attempts)
W5: VERIFY — tests + evidence
RECORD + EVIDENCE LEDGER → LOOP → W0
```

Full spec, state machine, angle definitions, gate protocol, spark rules, Value Gate scoring, evidence ledger, anti-patterns, and safety controls: [WF-AUTO.md](Harness/WF-AUTO.md).

Keep `Harness/tasks/auto/PROGRESS.md` current with every cycle.
