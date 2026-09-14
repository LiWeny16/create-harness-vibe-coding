# task-implement-wf-search-093 - REFERENCES

| Material | Task-local file | Status |
|---|---|---|
| 完整 Claude 实现/独立验收/发布合同 | [实现提示词](claude-wf-search-0.9.3-implementation-prompt.md) | 已复制并补充复用当前task上下文；未执行 |
| 既有架构审计 | [审计](wf-search-architecture-audit.md) | 历史调查文档，实施前核对当前源码 |
| 计划与验收条件 | [PLAN](PLAN.md) | pending |
| 候选归属清单（baseline） | [candidate-attribution](candidate-attribution.md) | 2026-09-13 记录：HEAD 0212e16、npm latest 0.8.20、无 v0.9.x 冲突、included/excluded/unresolved 已收敛 |
| V1 设计合同（PRD/AC/CONTRACT gate） | [design-contract](design-contract.md) | 2026-09-13 定稿：schema/预算/保护规则/writeSet 拆分 |
| 相关前置任务 | ../task-upgrade-harness-092/STATE.json | 仅关联；其 5 门禁失败由本任务 verify 阶段重验 |

## Verification

本次仅用 task-state record 正式登记，通过导出 writeTaskStateAtomic 补充 CLI 未支持的 tier/workItems/acceptance/context；随后官方 record 同步视图，open 读回。产品测试/安装/渠道未执行。
