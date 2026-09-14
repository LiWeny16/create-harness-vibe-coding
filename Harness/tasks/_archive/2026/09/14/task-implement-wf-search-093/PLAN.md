# task-implement-wf-search-093 - PLAN

## Goal

实现 /wf-search V1，纳入 0.9.3；Claude 完成候选，Codex 独立验收后发布正式版本。当前仅登记 open task，未开始实现。

## Scope

- 详细设计、数据合同、文件树、测试矩阵、发布命令与渠道要求见 [实现提示词](claude-wf-search-0.9.3-implementation-prompt.md)。
- 调查依据见 [架构审计](wf-search-architecture-audit.md)，历史定位须重读当前源码。
- Write set：本任务文档；后续产品改动严格以提示词第 5/9/10/12/13 节范围拆分到明确文件后派发。
- Forbidden：本次实现/测试/发布；后续不得覆盖未知用户修改、操作 A2A 状态、全局 reconcile/批量归档、强推、独立验收前发布。

## Decisions

- 用户显式 $wf，mode=wf；最终跨层发布任务 tier=full。本轮登记动作不启动完整角色链。
- V1：薄命令 + Skill 协议 + 宿主真实工具 + 无状态校验/渲染 + Controller 可选保存。
- 原 task-upgrade-harness-092 只作 related，不要求其整体 closed；相关前置实现归属与失败重验由 baseline 项处理。
- 所有验收为 pending。历史测试数字不作为新候选通过证据。

## Acceptance

| ID | Criterion | Evidence | Status |
|---|---|---|---|
| AC-001 | 四模式/三预算档搜索协议、真实能力发现、来源原文/反证/不确定性处理符合任务提示词。 | 待执行记录 | pending |
| AC-002 | 无状态 validate/render 数据合同、stdin、输入限制、引用/日期/预算/URL/转义与无写入副作用通过测试。 | 待执行记录 | pending |
| AC-003 | 命令注册、三端入口、Skill references、镜像/帮助/上下文预算与 project/global/host-global 安装一致。 | 待执行记录 | pending |
| AC-004 | 可选保存路径安全、幂等、更新/卸载保护与旧研究记录/只读角色合同兼容。 | 待执行记录 | pending |
| AC-005 | 候选归属明确；全部适用发布门禁、真实 Agent 场景、UI/服务端/安装回归有最终 SHA 证据。 | 待执行记录 | pending |
| AC-006 | 独立 Codex 验收、WF-Full cross-review 与 reflector PASS；同 SHA/tgz 发布并完成 npm/GitHub/mirror 与安装后核验。 | 待执行记录 | pending |

## Subagent Dispatch

以下为后续执行角色计划，尚未实际派发；dispatchLedger 保持为空。生产代理不得写 task 状态。Controller/task-scribe 在派发前补足具体文件、AC 与检查命令，禁止并行重叠写集。

| Work item | Role | Depends on | Action |
|---|---|---|---|
| baseline | planner | - | 先记录 HEAD/branch/status，审计 included/excluded/unresolved 与前置候选归属；重验历史失败线索。 |
| design | architect | baseline | 重读当前架构证据，完成 PRD/AC/CONTRACT gate、按需只读研究与第二版计划。 |
| tests | test-writer | design | 编写 AC 关联测试与真实 Agent 验证方案，通过 TEST-GATE 后实现。 |
| implementation | implementer | tests | 按既定 V1 实现并同步源码/模板/文档。 |
| verify | verifier | implementation | 对最终候选执行完整适用验证；失败交最小修复并重验。 |
| cross-review | reviewer | verify | 独立交叉检查需求/代码/安装保护与发布证据，要求 PASS。 |
| reflect | reflector | cross-review | 核对矛盾、遗漏和 WF-Full 最终门禁，要求 PASS。 |
| codex-accept | Codex independent verifier | reflect | 独立 Codex 验收；Claude 候选执行至交接点停止，不自行发布。 |
| release | controller | codex-accept | 重新核验版本/refs，发布0.9.3并完成registry安装及mirrors验证后才关闭任务。 |

按需 researcher/docs-researcher 仅作只读研究，不写状态；test-writer 建立 RED/手动证据后 implementer 实现；verifier/reviewer/reflector 独立于实现者；最后交回 Codex 独立验收。失败按 fix → verify → review 重验，不提前闭环。

## Verification and Release

提示词第 11–15 节是完整证据合同：自动场景、至少三个真实 Agent 场景、安装/更新/卸载、适用服务端/UI、发布门禁、隔离 tgz 安装和 SHA-256。Claude 停在 READY FOR INDEPENDENT VERIFICATION 或 BLOCKED。通过独立验收后以同 SHA/tgz 发布；版本/包变化须重验；发布后 registry 安装和渠道同步证据齐全才标 RELEASED/closed。

## Memory Preflight

- Memory preflight: done（CLAUDE → MEMORY index → README → PROGRESS → WF）。
- Memory hints: none；本次仅登记已选方案，不读额外历史记忆。

## Risks

前置 dirty 改动归属、历史门禁、线上版本冲突与真实工具/环境权限未在本次验证。保留原任务，先做只读归属检查；任何阻塞写入本 task，不以假定通过取代证据。
