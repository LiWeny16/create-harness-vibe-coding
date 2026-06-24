# PROGRESS.md

Global task index. Load at session start to see what is active and what was done.

## Active Task

- [wf-update-mechanism](tasks/wf-update-mechanism/) — Fix CRITICAL PLAN.md bugs + implement /wf update GitHub-based update

## Task Index

| ID | Goal | Phase | Closed |
|----|------|-------|--------|
| dogfood-bootstrap | Dogfood Harness scaffold into this repo | Verified | 2026-06-24 |
| wf-conflict-fix | Fix WF-mode orphaned files, add memory/context masters | Verified | 2026-06-24 |
| progress-restructure | Replace monolithic PLAN.md with PROGRESS.md + tasks/ capsules | Build | — |
| wf-update-mechanism | Fix PLAN.md refs + implement /wf update | Build | — |

## Cross-Task Decisions

| Date | Decision | Reason |
|------|----------|--------|
| 2026-06-24 | Dogfood root `Harness/` while keeping templates under `templates/` | Separate package source from operating harness |
| 2026-06-24 | memory-master + context-master added to commonAgents | Global memory and context management |
