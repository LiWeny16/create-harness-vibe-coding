# task-action-registry-consolidation - PROGRESS

## Current

- Phase: Archived
- Next: commit decision (user)

## Wave Progress

- **W0 评估** ✅: 量化范围 — 6 处手写目录 ~1,430 行、72 实现动作、触面 ~25 文件
- **W1 注册表** ✅: `Harness/a2a/action-registry.json` 72 动作 + schema 校验测试 9/9 + 镜像字节一致
- **W2a Loader** ✅: `src/wf-ui-server/action-registry.mjs`（缓存读取 + 查询助手 + 校验）9/9
- **W2b ontology** ✅: 目录从注册表派生（输出 id 与旧版一致）+ 审计修正（file/node 类型、幻影/幽灵清除）
- **W2b context** ✅: availableActions 21 个（+setModel/node.delete/node.restore）+ file/skill-group 能力补齐
- **W3 CLI** ✅: help --json 合并注册表动作（62/72）+ `manuals <nodeType>` 命令 + 镜像
- **W4 手册** ✅: 9 节点手册去命令段（散文保留）+ 6 控制面手册清理 + 注入时注册表合并 + schema 测试 19/19
- **W5 init.md** ✅: 方法论版 ~40 行（5 步发现循环、零命令目录）+ CLAUDE.md/common.md 精简 + 镜像
- **W6 防漂移** ✅: 双向漂移测试 7/7（幽灵/幻影双向验证）+ anti-drift 重写 21/21 + npm test 286/0

## Verification

| Suite | Result |
|-------|--------|
| 全量回归 22 套件 | **355/355 PASS** |
| npm test | **286 pass / 0 fail** |
| 注册表 72 动作 + 镜像 | 字节一致 |
| 双向防漂移 | 7/7（含正反翻转验证） |

## 关键成果

1. **单一事实源**：6 处手写目录 → 1 个 action-registry.json（72 动作）
2. **结构性防漂移**：幽灵动作（实现了没注册）和幻影动作（注册了没实现）从结构上不可能
3. **渐进式发现**：init.md 从目录式改为方法论式（5 步发现循环）；agent 按需取 help --json / workflow-context / manuals / snapshot / ontology
4. **审计修复**：6 个幽灵动作（setModel/file.writeText/skill-group.setSkillEnabled/node.restore/github-trigger）全部进入发现面；capability:read 幻影移除
5. **手册瘦身**：15 手册 -538 命令行，注入时自动合并注册表命令段

## 明确未做（记录）

- P0 门禁落地（actor 省略即拒绝）——**用户决策：不做，不过度设计**
- resume 接线、updateEdge 接线、磁吸写接口——功能缺口另开任务
- a2a-store.mjs DEFAULT_* 技能对象还带旧命令数组（temp 种子用）——后续清理

## 用户产品决策（2026-08-13，下一批需求的方向性决定）

| # | 决策 |
|---|------|
| D-A | 后端不需要认证；CLI 通用动作口不需要身份检查——不过度设计 |
| D-B | 弱化删除 main/subagent 权限区分：所有 agent 权限完全相同，身份只是角色标签 |
| D-C | 唯一层级规则：只有顶层 main agent 能 spawn 画布级 agent 节点；subagent 不能 spawn 画布 agent；depth=1 永久（最多两层 main→subagent）；subagent 可用自己 runtime 的内置 subagent（runtime 内部事务不受限） |
| D-D | resume 必须补上（重启续聊） |
| D-E | 磁吸接口必须补上：后端语义 + UI 控制同步 |
| D-F | updateEdge 必须接线（连后灵活改） |
| D-G | 撤销设计不完备，需要重新设计 |
| D-H | 通讯可视化：点击节点可见其通讯；修复节点 zIndex 不应高于任何 node 的 bug |
| D-I | codex exec 模式不需要（terminal 已够用） |
