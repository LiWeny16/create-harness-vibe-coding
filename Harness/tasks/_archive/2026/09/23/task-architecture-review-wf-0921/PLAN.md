# task-architecture-review-wf-0921 - PLAN

## Goal

对当前 Harness/WF 全栈做一次证据化、只读、可执行的架构 review：覆盖所有 WF 命令、skills 框架、运行时脚本、agent 路由与 context、任务胶囊、hooks、归档、模板镜像、测试和发布边界，判断架构是否精简、亮点在哪里、哪些地方跑偏，并给出删除/保留/最小修复的优先级。

Review 不是重构。先产出事实、依赖和风险，再由后续独立 task 决定是否实施。

## Scope

### Review surfaces

- 命令入口：`.claude/commands/`、`.codex/`、`.opencode/`、`templates/common/` 中对应命令与兼容入口。
- Skills：`.agents/skills/`、`.claude/skills/`、`templates/common/` 下的 skills/skill mirror，以及 skill 的 `SKILL.md`、脚本、引用资源和实际调用关系。
- Harness runtime：`Harness/scripts/`、状态/路由/context/pack/归档、hooks、agent 协作和外部 runtime 适配。
- State surfaces：`STATE.json`、`PROGRESS.md`、`PLAN.md`、`INDEX.json/md`、archive、route/context 派生层和 source-of-truth 边界。
- Contracts/docs/tests：`CLAUDE.md`、Harness specs、README、package scripts、单元/e2e/smoke/validator/mirror gates。
- 全仓库与上述入口相关的调用者、重复实现、死代码、旧兼容路径、模板漂移和未覆盖分支。

### Allowed write set

- 本 task capsule：`PLAN.md`、`PROGRESS.md`、`REFERENCES.md`、`PROBLEM.md`。
- 新增 `REVIEW.md` 和可选的 `review-findings.json`，仅用于记录审查结果和证据。

### Forbidden

- 不修改业务代码、命令、skills、hooks、模板、协议文档或测试来“顺手修复”。
- 不删除文件、不做格式化重写、不执行 `git reset`、`git checkout`、`git clean`、`git push`、`npm publish`。
- 不覆盖或清理用户已有改动；不把 baseline failure 伪装成绿色。
- 不用“看起来”“应该”“可能”作为结论；无法证明的内容标记为 `unknown` 并说明下一步验证。
- 不因发现问题直接扩大 review 为实现任务；实现建议只写入报告。

## Review method

1. 先建立完整 inventory：入口、文件、命令、skill、脚本、测试和 mirror 数量，标记 canonical/mirror/legacy/unused。
2. 画真实调用图：用户入口 → command/skill → runtime script → state/context/route → agent/hook/UI/模板消费者；每条边给出文件与行号。
3. 建 ownership/source-of-truth 矩阵：谁读、谁写、谁派生、谁同步、谁只做兼容；特别检查 route/context/archive 是否重复负责。
4. 做减法审查：对每个候选项分为 `必须保留`、`可删但需迁移`、`可删且无消费者`、`暂不能删`，必须给消费者、替代物、删除风险和验证方式。
5. 审查边界质量：context 暴露/泄漏、prompt budget、状态一致性、幂等/原子性、hook 语义、跨 session resume、archive 可回溯、模板 parity 和 legacy drift。
6. 运行适合当前环境的只读 gates；记录完整命令、结果、失败归因和 baseline exception，不为通过 gate 修改代码。
7. 最后给出架构 verdict：精简度、亮点、跑偏点、发布阻断项、P0-P3 findings 和最小后续改造顺序。

## Required deliverables

在本 task capsule 写入 `REVIEW.md`，至少包含：

- Executive verdict：`green / yellow / red`，是否建议发布，以及理由。
- Architecture map：分层、入口、数据流、写入者、派生者和 mirror 边界。
- Inventory matrix：所有 WF command/skill/runtime surface 的 canonical、mirror、legacy、consumer、测试覆盖。
- Findings：每条包含 severity、事实、影响、证据 `file:line`、复现/验证命令、建议；明确区分事实和推断。
- Simplification table：必须保留、可删但需迁移、可直接删除、暂不删除；禁止只凭文件名判断。
- Highlights：当前设计中值得保留的边界、收口、测试或协同能力。
- Drift check：是否偏离“无感记录、最小 context 暴露、可回溯协同、单一写入者、模板可复制”的目标。
- Minimal target architecture：不新增抽象的前提下，下一轮最小改造路线及依赖顺序。
- Gate report：通过、失败、跳过、baseline exception 分开列出。

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | 所有 WF command family 和 skill root 已盘点，标明 canonical/mirror/legacy/unused | `REVIEW.md` inventory + file list | pending |
| AC-002 | 真实入口到 runtime/state/context/agent/hook 的调用链有文件行号证据 | `REVIEW.md` architecture map | pending |
| AC-003 | 每个主要状态/路由/归档/context surface 的唯一写入者与派生者已确认 | ownership matrix | pending |
| AC-004 | 重复实现、死代码、旧兼容层和模板漂移均有消费者与风险分析 | findings + references | pending |
| AC-005 | context 暴露、prompt budget、跨 session resume、回溯和 hook 语义已审查 | targeted evidence/tests | pending |
| AC-006 | 必须保留/可删/需迁移/暂不能删分类完整，且每项有删除前置条件 | simplification table | pending |
| AC-007 | 当前架构亮点与跑偏点均有证据，不以主观印象下结论 | verdict section | pending |
| AC-008 | 测试、validator、e2e、smoke、mirror/release gates 已执行或明确说明为何未执行 | gate report | pending |
| AC-009 | findings 按 P0-P3 排序，给出最小后续路线，不直接实施修复 | prioritized plan | pending |
| AC-010 | 本轮除 task capsule/report 外没有业务代码、命令、skill、hook、模板、文档或测试改动 | `git diff --check` + diff scope | pending |

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| D-001 | Review-only；实现拆为后续独立 task | 防止 review 过程中扩大变更面，保持证据可信 | 2026-09-21 |
| D-002 | 以 canonical/source-of-truth 和真实消费者为删除判断依据 | 文件数量本身不能证明冗余 | 2026-09-21 |
| D-003 | 所有结论必须带 `file:line` 或可复现命令；baseline exception 单独标记 | 避免把推测和预存失败误报为架构缺陷 | 2026-09-21 |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| 全仓库 surface 很大，容易漏掉隐藏入口或模板镜像 | 先 inventory，再用 `rg` 追踪消费者和反向引用；报告列出未覆盖项 | open |
| 用户已有 dirty changes 影响 diff/gate 判断 | 记录 baseline，禁止覆盖；将 pre-existing 与本 task 变化分开 | open |
| 只读 review 可能发现无法在本轮验证的运行时行为 | 标记 `unknown`，给出最小复现命令，不把未验证项写成事实 | open |
