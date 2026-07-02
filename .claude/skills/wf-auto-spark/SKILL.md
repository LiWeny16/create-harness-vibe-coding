---
name: wf-auto-spark
description: Use for /wf-auto-spark in Claude Code, $wf-auto-spark or /skills wf-auto-spark in Codex, or perpetual inspiration mode that never stops — external spark search, long-term roadmap with staged milestones, ≤50% deviation guard.
---

# WF-AUTO-SPARK Adapter

This skill is a thin tool adapter. The authoritative workflow lives in
`Harness/WF-AUTO-SPARK.md`; do not duplicate or override it here.

## Invocation

- Claude Code: use `/wf-auto-spark` or select the `wf-auto-spark` skill.
- Codex CLI or IDE: use `$wf-auto-spark` or `/skills` then choose `wf-auto-spark`.

## Load

1. `CLAUDE.md`
2. `Harness/MEMORY.md`
3. `Harness/README.md`
4. `Harness/WF-AUTO-SPARK.md`
5. `Harness/WF-AUTO.md`
6. `Harness/subagents.md`
7. `Harness/dispatch.md`

## Rules

WF-AUTO-SPARK is perpetual inspiration mode with roadmap anchoring:
1. **Roadmap first**: Declare North Star + staged milestones before any spark cycle.
2. **Never auto-stop**: Only user can stop. "No sparks found" → expand search.
3. **Deviation guard (≤50%)**: Every spark checked against North Star. Cumulative 10-cycle average ≥65%. Below → force Re-Anchor Gate.
4. **Milestones flexible within 50%**: Can reorder/split/merge/replace, but North Star changes need user confirmation.
5. **Value reflection every cycle**: CEO writes what was done, why it matters, deviation score, milestone progress.
6. **Re-Anchor Gate every 10 cycles**: User confirms direction or adjusts roadmap.

## Roadmap Location

Active roadmap lives at `Harness/tasks/auto/SPARK-ROADMAP.md`. Created at startup.
Per-cycle evidence at `Harness/tasks/auto/PROGRESS.md`.
