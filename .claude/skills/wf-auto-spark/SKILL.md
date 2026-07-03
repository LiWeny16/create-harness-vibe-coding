---
name: wf-auto-spark
description: Perpetual inspiration mode for /wf-auto-spark or $wf-auto-spark. Inherits WF-AUTO/WF execution gates while using external spark search, roadmap anchoring, and <=50% deviation guard.
---

# WF-AUTO-SPARK Adapter

The authoritative workflow lives in `Harness/WF-AUTO-SPARK.md`; this adapter
only routes and summarizes hard constraints.

## Invocation

- Claude Code: `/wf-auto-spark`
- Codex: `$wf-auto-spark` or `/skills` then choose `wf-auto-spark`

## Load

1. `CLAUDE.md`
2. `Harness/MEMORY.md`
3. `Harness/README.md`
4. `Harness/WF-AUTO-SPARK.md`
5. `Harness/WF-AUTO.md`
6. `Harness/subagents.md`
7. `Harness/dispatch.md`

## Rules

1. Roadmap first: declare North Star and staged milestones before spark cycles.
2. Never auto-stop: only the user can stop; "no sparks found" expands search.
3. Spark replaces discovery only. Accepted candidates still run:
   `Mini PRD -> AC IDs -> test/validation plan -> implementer -> verifier ->
   cross-review -> reflector PASS -> evidence ledger`.
4. Spark searchers are read-only. Implementation requires explicit dispatch
   packet, write set, forbidden truth files, AC IDs, and verification commands.
5. Deviation guard: each spark must align >=50% with North Star; rolling
   10-cycle average below 65% forces Re-Anchor Gate.
6. Value reflection is required every cycle: source, why it matters, deviation,
   evidence, and milestone progress.

Active roadmap: `Harness/tasks/auto/SPARK-ROADMAP.md`.
Per-cycle evidence: `Harness/tasks/auto/PROGRESS.md`.
