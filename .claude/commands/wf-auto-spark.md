# /wf-auto-spark

Enter spark-augmented auto-optimization mode. Same perpetual loop as `/wf-auto` but with external inspiration search active from the start — W0 dispatches 8 internal angles + cross-model oracle + 8 spark sources all in parallel every cycle.

Use this when:
- Internal optimization angles are exhausted but you want external inspiration
- You don't have a clear direction and want the system to discover possibilities
- You want fully autonomous inspiration-driven improvement with rigorous Value Gate filtering

## Required

- Load `wf-auto` skill.
- Spark sources active from cycle 1 (not just when internal empty).
- All spark candidates MUST pass the Value Gate (≥18/25, no dimension <3).
- Evidence ledger mandatory per cycle.
- Full spec: [WF-AUTO.md](Harness/WF-AUTO.md).
