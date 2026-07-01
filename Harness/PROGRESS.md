# PROGRESS.md

Global task index. Load at session start to see what is active and what was done.

## Active Task

- None

## Task Index

| ID | Goal | Phase | Closed |
|----|------|-------|--------|
| dogfood-bootstrap | Dogfood Harness scaffold into this repo | Verified | 2026-06-24 |
| wf-conflict-fix | Fix WF-mode orphaned files, add memory/context masters | Verified | 2026-06-24 |
| progress-restructure | Replace monolithic PLAN.md with PROGRESS.md + tasks/ capsules | Build | - |
| wf-update-mechanism | Fix PLAN.md refs + implement /wf update | Build | - |
| install-intake-improvements | Improve install intake, root scan, optional selections, and Codex support | Verified | 2026-07-01 |
| install-flow-log-analysis | Analyze Codex install log and add script-first JSON install guidance | Verified | 2026-07-01 |
| remove-flow-log-analysis | Analyze removal/update logs and add script-first cleanup/update guidance | Verified | 2026-07-01 |

## Cross-Task Decisions

| Date | Decision | Reason |
|------|----------|--------|
| 2026-06-24 | Dogfood root `Harness/` while keeping templates under `templates/` | Separate package source from operating harness |
| 2026-06-24 | memory-master + context-master added to commonAgents | Global memory and context management |
| 2026-07-01 | Harness template source paths live under `templates/common/Harness/` and optional `Harness/workflows/` | Do not route scaffold-owned docs through `docs/` |
| 2026-07-01 | `npx create-harness-vibe-coding` remains install/safe-merge only, not an installed-Harness updater | Existing Harness updates need agent-mediated conflict handling for root entry and user-modified files |
