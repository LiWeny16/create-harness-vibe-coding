---
name: wf-auto
description: Perpetual auto-optimization mode. Never stops until 8-angle exhaustion. Inherits WF acceptance gates and subagent orchestration per cycle. Use for Claude /wf-auto, Codex $wf-auto, auto mode, or unbounded self-directed optimization.
---

# WF Auto - Perpetual Auto-Optimization

## Load

- `Harness/WF-AUTO.md`
- `Harness/subagents.md`
- `Harness/dispatch.md`
- `Harness/agent-workflow.md`
- `.claude/skills/wf-review/SKILL.md`

## Trigger

- Claude `/wf-auto`
- Codex `$wf-auto`
- `wf auto`, `auto mode`, or a request for continuous self-directed improvement

Do not use when the user gives a bounded task, requests maximum parallelism
(`/wf-max`), needs an urgent production hotfix, or the codebase is tiny enough
that auto scanning costs more than it helps.

## Hard Rules

1. Never stop except the A-GATE: all 8 angles empty, oracle empty, spark empty,
   and 2 confirmation rounds.
2. CEO never edits production source. CEO may write only
   `Harness/tasks/auto/PLAN.md` and `Harness/tasks/auto/PROGRESS.md`.
3. Dispatch all W0 sources in one batch when the runtime allows it: 8 angles,
   oracle, and spark searchers.
4. One accepted finding per cycle: <=3 files and <=50 changed lines. Larger
   ideas escalate to `/wf` or `/wf-max`, then return to auto.
5. Every accepted cycle inherits the full WF chain:
   `Mini PRD -> AC IDs -> test/validation plan -> implementer -> verifier ->
   cross-review -> reflector PASS -> evidence ledger -> next W0`.
6. Review is mandatory: spec review, code-quality review, then reflector.
7. Value Gate is scored for spark candidates: pass is >=18/25 and no dimension
   below 3.
8. Intent Checkpoint is adaptive: 2 -> 5 -> 10 cycles, exactly two questions.
9. Record compact evidence per cycle; do not paste full logs or transcripts.

## Loop

```text
W0: SENSE (8 angles + oracle + spark sources)
A-GATE: continue, oracle, spark, confirm, or stop
W1: PRIORITIZE one finding
W2-W5: Mini PRD -> AC -> test/validation plan -> implementer -> verifier -> cross-review -> reflector PASS
RECORD: evidence ledger
LOOP: next W0
```

## Return

Report cycles run, findings addressed by source, evidence ledger, exhaustion
evidence if any, weak spark count, final state, and residual risks.
