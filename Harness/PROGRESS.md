# PROGRESS.md

Global task index. Load at session start to see what is active and what was done.

## Active Task

- None

## Task Index

Non-archived tasks only (max 5). Archived tasks are listed in `Harness/tasks/_archive/INDEX.md` (see `Harness/specs/protocols/TASK_ARCHIVE.md`).

| ID | Goal | Phase | Closed |
|----|------|-------|--------|
| task-add-web-agent-node | 新增原生 web chat agent node（非 PTY）：参考 agentre 的 claude stream-json / codex app-server 接入模式，结构化事件流+工具卡片+审批环 | Closeout | 2026-09-28 |
| task-agent-billboard-context | Add a compact Billboard presentation for shared Agent context using the existing Markdown node backend | Closeout | 2026-09-28 |
| task-finalize-capsule-archive-route-0922 | Implement merged archive writer, safe-auto policy, route commands, and tests | Closeout | 2026-09-28 |
| task-simplify-skills-hub-pack-prompt | Attempt native subagent fan-out (W0 explore + W1 architect), then W2 implementation waves | Closeout | 2026-09-28 |
| task-web-terminal-smoothing | Improve the web terminal by adopting the useful xterm lifecycle and resize behavior used by OpsKat, then verify the real GUI in BrowserOS Neo. | Closeout | 2026-09-28 |

## Cross-Task Decisions

| Date | Decision | Reason |
|------|----------|--------|
| 2026-06-24 | Dogfood root `Harness/` while keeping templates under `templates/` | Separate package source from operating harness |
| 2026-06-24 | memory-master + context-master added to commonAgents | Global memory and context management |
| 2026-07-01 | Harness template source paths live under `templates/common/Harness/` and optional `Harness/workflows/` | Do not route scaffold-owned docs through `docs/` |
| 2026-07-01 | `npx create-harness-vibe-coding` remains install/safe-merge only, not an installed-Harness updater | Existing Harness updates need agent-mediated conflict handling for root entry and user-modified files |
| 2026-07-03 | Existing `Harness/` detected by install CLI must auto-switch to the installed update checker instead of continuing install writes | User decision: install/update should be one safe entry, with script switching modes by target state |
| 2026-07-13 | OpenCode added as 3rd default target (CC + Codex + OpenCode); agents as independent template files, opencode.json minimal + SAFE classification, oh-my-openagent as external recommendation | OpenCode natively reads .claude/skills + .agents/skills + CLAUDE.md, so only agents/commands/config needed new templates; separate files keep update mechanism unchanged |
