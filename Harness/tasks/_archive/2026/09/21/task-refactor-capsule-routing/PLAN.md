# task-refactor-capsule-routing - PLAN

## Goal

重构任务胶囊体系，使它成为多 Agent 协同的持久路由层：closed 任务无感归档，任何时刻可恢复进度、卡点、下一步和历史，同时默认只向 Agent 暴露最小必要上下文。

## Non-goals

- 不引入数据库、常驻 daemon 或第二套任务真相。
- 不自动关闭 active/blocked 任务，不删除历史，不覆盖用户任务。
- 不重写 wf-ui、业务代码或无关 Harness 子系统。

## Architecture

五层逻辑架构：

1. Global Route：`Harness/PROGRESS.md`，保存当前焦点和紧凑任务表。
2. Task Route：`Harness/tasks/INDEX.json`、`INDEX.md` 与 `_archive/INDEX.json`，只保存可查询的轻量路由。
3. Task Truth：`Harness/tasks/<id>/STATE.json`，保存机器可恢复状态、队列、依赖、卡点和 nextAction。
4. Task History：`PROGRESS.md`、`PLAN.md`、`PROBLEM.md`、`REFERENCES.md` 及归档胶囊。
5. Agent Projection：`task-context show/pack`，按 role/workItem/byte budget 生成最小上下文。

新增 `Harness/scripts/lib/task-route.mjs` 作为纯派生层：统一 live/archive 读取、legacy status 归一化、blocker 汇总、依赖摘要、route stub 和恢复摘要。`task-state.mjs` 负责写入/迁移/归档，`task-context.mjs` 只负责上下文投影。

## Auto Archive Contract

- 只自动归档 `closed`；`active`、`blocked`、`continuous`、`_template` 永不自动归档。
- 触发点：closed transition、SessionStart、WF closeout、显式 `maintenance --auto`。
- 归档必须幂等、原子、失败可恢复；不改变正文、不删除证据。
- 归档后保留 route stub：task id、title、status、phase、summary、blockers、dependsOn、blocks、latestEvidenceRefs、archivePath。
- 多 active 任务且没有明确焦点时返回 `focusStatus: ambiguous`，不得静默猜测。

## Minimal Context Contract

默认 pack 强制包含：task id/title、status、phase、gate、current intent、activeQuestion、blockers、dependencies、nextAction、latest verification/evidence pointers、handoff summary。

默认不包含原始日志、完整历史、无关任务、归档正文、cookies、tokens、SSH keys 或 provider secrets。超出 byte budget 时优先保留状态、卡点、依赖和下一步，省略内容写入 `omitted`。

## Implementation Waves

1. W0：补齐 active/blocked/closed/archived/legacy/multi-focus fixtures 与 RED tests。
2. W1：实现 `task-route.mjs` 和统一 blocker/route model。
3. W2：实现 safe auto-archive、archive route index、幂等和失败恢复。
4. W3：扩展 `task-context pack`，增加 state/blocker/dependency header 与最小上下文策略。
5. W4：接入 SessionStart/WF closeout/list/show/query，保持 root/template/runtime mirrors。
6. W5：更新 WF-STATE、TASK_ARCHIVE、context-loading、task template，执行独立 review 和完整验证。

## Acceptance Criteria

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | closed 可自动归档，active/blocked 永不自动归档 | tests + dry-run/apply evidence | pending |
| AC-002 | 归档幂等、原子，失败不破坏原任务 | tests | pending |
| AC-003 | live/archive route index 可定位任务和 archivePath | route fixtures/tests | pending |
| AC-004 | task id 可恢复状态、阶段、卡点、依赖、下一步和历史 | route/show/history tests | pending |
| AC-005 | 多任务无焦点时返回 ambiguous，不猜主任务 | focus tests | pending |
| AC-006 | blocker view 汇总 activeQuestion、blocked queue、dependsOn、handoff unresolved、PROBLEM | blocker tests | pending |
| AC-007 | pack 强制带 status/phase/gate/blockers/nextAction 且受 role/workItem/byte budget 约束 | pack tests | pending |
| AC-008 | pack 不泄露 raw logs、无关任务或敏感信息 | redaction tests | pending |
| AC-009 | legacy STATE/status/archive 可只读恢复并可 reconcile | migration fixtures/tests | pending |
| AC-010 | root/templates/.claude/.agents/.opencode mirrors 一致 | mirror checks | pending |
| AC-011 | 不丢失用户任务、证据和依赖关系 | preservation tests | pending |
| AC-012 | `npm test`、e2e、pack smoke、strict validators、diff check 全通过 | command outputs | pending |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| 多份 route 形成第二真相 | route 全部由 STATE/archive 派生 | open |
| 自动归档误伤未完成任务 | 仅允许 closed，active/blocked 硬拒绝 | open |
| Agent pack 过大或泄露历史 | 强制最小 header、role filter、byte budget、omitted | open |
| legacy capsule 不一致 | 先 reconcile，再 archive；保留原文件 | open |
