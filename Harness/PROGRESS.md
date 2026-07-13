# PROGRESS.md

Global task index. Load at session start to see what is active and what was done.

## Active Task

- task-opencode-compatibility

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
| framework-metrics-and-entry-contract | Define slim CLAUDE entry contract and HarnessBench v0.1 methodology | Ready | - |
| task-acceptance-driven-workflow | Upgrade Harness to acceptance-driven agent workflow | Verified | 2026-07-02 |
| task-remove-hook-docs | Remove WF hook enforcement artifacts and stale hook docs | Verified | 2026-07-02 |
| task-add-wf-help | Add direct /wf-help command listing WF commands | Verified | 2026-07-02 |
| task-wf-remove-residual-cleanup | Remove legacy Harness discovery leftovers during wf-remove | Verified | 2026-07-02 |
| task-wf-update-finalize-cleanup | Make wf-update finalize safely and clean update residue like install/remove | Verified | 2026-07-03 |
| task-install-update-switch | Auto-route existing Harness installs to update and fix optional command consistency | Build | - |
| task-wf-full-role-chain | Make /wf use complete mandatory role chain with reflector and cross-review gate | Verified | 2026-07-03 |
| task-opencode-compatibility | Add OpenCode as 3rd install target alongside CC and Codex | Verified | 2026-07-13 |

## Cross-Task Decisions

| Date | Decision | Reason |
|------|----------|--------|
| 2026-06-24 | Dogfood root `Harness/` while keeping templates under `templates/` | Separate package source from operating harness |
| 2026-06-24 | memory-master + context-master added to commonAgents | Global memory and context management |
| 2026-07-01 | Harness template source paths live under `templates/common/Harness/` and optional `Harness/workflows/` | Do not route scaffold-owned docs through `docs/` |
| 2026-07-01 | `npx create-harness-vibe-coding` remains install/safe-merge only, not an installed-Harness updater | Existing Harness updates need agent-mediated conflict handling for root entry and user-modified files |
| 2026-07-03 | Existing `Harness/` detected by install CLI must auto-switch to the installed update checker instead of continuing install writes | User decision: install/update should be one safe entry, with script switching modes by target state |
| 2026-07-13 | OpenCode added as 3rd default target (CC + Codex + OpenCode); agents as independent template files, opencode.json minimal + SAFE classification, oh-my-openagent as external recommendation | OpenCode natively reads .claude/skills + .agents/skills + CLAUDE.md, so only agents/commands/config needed new templates; separate files keep update mechanism unchanged |
