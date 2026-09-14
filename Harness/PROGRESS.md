# PROGRESS.md

Global task index. Load at session start to see what is active and what was done.

## Active Task

- None

## Task Index

Non-archived tasks only (max 5). Archived tasks are listed in `Harness/tasks/_archive/INDEX.md` (see `Harness/specs/protocols/TASK_ARCHIVE.md`).

| ID | Goal | Phase | Closed |
|----|------|-------|--------|
| task-add-web-agent-node | 新增原生 web chat agent node（非 PTY）：参考 agentre 的 claude stream-json / codex app-server 接入模式，结构化事件流+工具卡片+审批环 | Intake | - |
| task-homepage-act1-flat-layout | Redesign Act 1 opening: 5 flat staggered boxes, zero tilt, no float, no singled-out openable box | Implementation | - |
| task-make-wf-lifecycle-0908 | Implement explicit WF activation, durable cross-session resume, no direct-to-WF promotion, no WF exit/downgrade, and ensure wf-ui project/task views consume the same project/task state and indexes. Preserve compatibility and keep the architecture minimal. | Validation | - |
| task-simplify-skills-hub-pack-prompt | Attempt native subagent fan-out (W0 explore + W1 architect), then W2 implementation waves | Implementation | - |
| task-upgrade-harness-092 | 升级 Harness 协同与可恢复执行架构至 0.9.2；Luna 多代理实现与初验，主模型指挥和终验；跨 Codex/Claude/OpenCode/A2A/PTY/UI；禁止 npm publish；保留现有用户脏改动、3080.md/png 与 Harness/a2a 本地状态。 | Validation | - |

## Cross-Task Decisions

| Date | Decision | Reason |
|------|----------|--------|
| 2026-06-24 | Dogfood root `Harness/` while keeping templates under `templates/` | Separate package source from operating harness |
| 2026-06-24 | memory-master + context-master added to commonAgents | Global memory and context management |
| 2026-07-01 | Harness template source paths live under `templates/common/Harness/` and optional `Harness/workflows/` | Do not route scaffold-owned docs through `docs/` |
| 2026-07-01 | `npx create-harness-vibe-coding` remains install/safe-merge only, not an installed-Harness updater | Existing Harness updates need agent-mediated conflict handling for root entry and user-modified files |
| 2026-07-03 | Existing `Harness/` detected by install CLI must auto-switch to the installed update checker instead of continuing install writes | User decision: install/update should be one safe entry, with script switching modes by target state |
| 2026-07-13 | OpenCode added as 3rd default target (CC + Codex + OpenCode); agents as independent template files, opencode.json minimal + SAFE classification, oh-my-openagent as external recommendation | OpenCode natively reads .claude/skills + .agents/skills + CLAUDE.md, so only agents/commands/config needed new templates; separate files keep update mechanism unchanged |
