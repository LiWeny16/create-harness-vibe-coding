# task-action-registry-consolidation - PLAN

## Goal

收敛四套手写动作清单（+手册命令段 = 实际六处）到单一 ACTION_REGISTRY，让"实现 ↔ 文档 ↔ 发现"结构上不可能漂移。渐进式发现架构：init.md 只教方法论，事实全部按需从注册表生成。

## W0 评估结论（2026-08-13，已量化）

- 手写目录总量 ~1,430 行（6 处）：CLI 注册表 638、ontology ~160、init.md ~25、context ~65、a2a-store 嵌入目录、15 手册命令段 538
- 已实现动作 ~72 个：9 适配器 59 + server 特殊 6（start/restart/stop/sendInput/setModel/layout）+ runtime 特殊 7（node.delete/restore + 图动作）
- 防漂移测试：0 个
- 审计已产出完整 72 动作清单（照单录入，非重新发明）

## Schema 设计（CEO 决策）

**位置**：`Harness/a2a/action-registry.json`（agent 可见 + 模板镜像 + 后端和 CLI 都从项目根读取）

```json
{
  "schemaVersion": 1,
  "updatedAt": "<iso>",
  "actions": [
    {
      "id": "agent.sendMessage",
      "nodeType": "agent",
      "category": "communication",
      "summary": "Send a structured message to another agent node",
      "params": [
        {"name": "to", "type": "string", "required": true, "description": "Target agent node id"},
        {"name": "requestId", "type": "string", "required": false, "description": "Correlation id for reply aggregation"},
        {"name": "text", "type": "string", "required": true, "description": "Message body"}
      ],
      "actor": {"mainOnly": false, "edgeRequired": true, "agentAuthored": true},
      "cli": {"command": "send-agent-message", "flags": [{"flag": "--to", "value": "<nodeId>"}]},
      "implementation": {"adapter": "agent", "export": "sendMessage", "special": false},
      "example": "wf-ui-control.mjs send-agent-message --to session-xxx --request-id r1 --text \"task\""
    }
  ]
}
```

**字段契约**：
- `id` 唯一；`nodeType` ∈ {agent, markdown, excalidraw, file, timer, goal, skill-group, mcp-connector, github-trigger, node, graph}
- `category` ∈ {lifecycle, terminal-io, config, communication, graph, discovery, resource, event, capability, workspace}
- `actor` 是注册表里的门定义位置（本次只定义现状，P0 门禁落地修复另开任务）
- `implementation` 是防漂移测试的锚：{adapter, export} 或 {special: true}（server 特殊动作）

**生成关系**：
- ontology 端点目录 ← registry（affordance 逻辑保留在 workflow-ontology.mjs）
- context availableActions/affordances ← registry（按 nodeType + actor 过滤）
- CLI help --json ← registry 的 cli 字段（CLI 运行时读项目根的 registry，内置副本做离线回退）
- 手册命令段 ← registry（注入时合并）；手册文件只留散文（71% 内容不变）
- init.md ← 方法论版（~30 行，5 步发现循环，零命令目录）

**防漂移测试（W6）**：
1. registry↔实现双向：每个适配器 export 必须在 registry（special 除外）；registry 每条必须有实现
2. ontology/context/help/manual 注入输出与 registry 一致性快照

## Waves & Dispatch Table (D-GATE)

| Wave | Worker | 角色 | 写集（disjoint） | AC |
|------|--------|------|------------------|----|
| W1 | A1 registry 填充 | implementer | `Harness/a2a/action-registry.json`（新）+ `templates/common/Harness/a2a/action-registry.json`（镜像）+ `src/wf-ui-server/__tests__/workflow-action-registry.test.mjs`（新：schema 校验 + 72 动作覆盖断言） | R1 注册表含全部 72 动作；R2 schema 校验通过；R3 镜像字节一致 |
| W2 | B1 ontology 改造 | implementer | `src/wf-ui-server/workflow-ontology.mjs` | R4 ontology 端点目录从 registry 生成；R5 现有 ontology 测试不回归 |
| W2 | B2 context 改造 | implementer | `src/wf-ui-server/workflow-agent-context.mjs` | R6 availableActions/affordances 从 registry；R7 context 测试不回归 |
| W3 | C1 CLI + manuals 命令 | implementer | `Harness/scripts/wf-ui-control.mjs` + 镜像 | R8 help --json 读 registry（内置回退）；R9 `manuals <nodeType>` 命令可读任意类型手册；R10 cli-surface 测试不回归 |
| W4 | D1 手册命令段移除+注入合并（9 节点手册） | implementer | `Harness/a2a/skills/workflow-*-node.json`（9 个）+ 镜像 | R11 手册只剩散文；R12 注入输出含 registry 生成的命令段 |
| W4 | D2 控制面手册 + 默认手册（5+1 个） | implementer | 其余 6 个手册 + 镜像 | R13 同上 |
| W5 | E1 init.md 方法论重写 + 基底配置精简 | implementer | `src/wf-ui-server/server.mjs`（nodeInitMarkdown）+ `CLAUDE.md`×2 + `common.md`×2 | R14 init.md ≤40 行无命令目录；R15 5 步发现循环在场；R16 anti-drift 不回归 |
| W6 | F1 防漂移测试 | test-writer | `src/wf-ui-server/__tests__/workflow-registry-drift.test.mjs`（新） | R17 双向漂移测试生效（注入一个假动作 → 失败） |
| W6 | F2 全量回归 | verifier | 只读 | R18 全部既有套件绿（176+） |

Wave order: W1 → W2(B1∥B2) → W3 → W4(D1∥D2) → W5 → W6(F1→F2)。

## 明确不做（本次范围外）

- P0 门禁落地（actor 省略即拒绝）——注册表 actor 字段只定义现状，另开任务
- resume 接线、updateEdge 接线、磁吸写接口——审计发现的功能缺口，另开任务
- exec 模式完整产品化

## Risks

| Risk | Mitigation |
|------|------------|
| 工作树大量未提交改动 | 用户已批准继续；回归基线以"当前全套测试绿"为准（W6 前先跑一次基线快照） |
| registry schema 不覆盖特殊动作语义 | W1 测试断言 72 动作全收录；schema 允许 special 标记 |
| CLI 离线场景（项目无 registry 文件） | CLI 内置 registry 副本回退 + 镜像测试 |
| 手册注入合并改变 agent 上下文形状 | R7 上下文测试不回归 + 注入输出快照测试 |
