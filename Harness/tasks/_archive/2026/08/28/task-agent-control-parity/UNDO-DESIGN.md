# P5 — Graph Undo/Redo 设计（CEO 版）

> 原设计 worker 卡死被停；CEO 直接完成设计。实现按本文档派发。

## Goals / Non-goals

**Goals**: 图操作可撤销（agent 和人类共用同一历史）；agent-visible 类型化接口；重启后历史仍在。
**Non-goals**: 文件操作撤销（/api/workspace/undo 已有，不动）；会话/终端内容撤销；跨工作流撤销。

## 核心思路：切片快照反演（slice-snapshot inverse）

不写每类操作的逆向逻辑——**每个图变更动作在应用前，先截取受影响切片**（被移节点的 positions、被改/删/建的边记录、dock 条目、节点记录），切片本身就是逆操作。Undo = 回放 before 切片。单一机制覆盖所有动作。

## 数据模型

存储位置：**workflow-map.json 现有的 `undoStack`/`redoStack` 字段**（schema 已存在；UI 现在发送时清空——改成真实内容）。历史随图持久化，后端重启不丢。

```json
{
  "opId": "op-<ts>-<rand>",
  "ts": "<iso>",
  "actor": {"kind": "agent|human", "nodeId": "…", "sessionId": "…"},
  "action": "agent.moveNode|agent.connectNodes|agent.disconnectNodes|agent.updateEdge|agent.deleteNode|agent.createNode|agent.attachDock|agent.detachDock|agent.setDockSide|agent.layout|node.settingsPatch",
  "inverse": {
    "positions": {"<nodeId>": {"x":n,"y":n}},   // 被影响节点的旧位置
    "edges": [ {完整边记录} ],                  // 被改/删的边的旧值
    "dockLinks": [ {完整dock条目} ],            // 被改/删的 dock 旧值
    "nodes": [ {完整节点记录} ]                 // 被删节点的旧值（含 position）
  }
}
```

规则：
- 每个图变更动作在执行前调用 `recordGraphOp(root, op)`；切片只含该动作实际影响的部分
- 上限 50 条，超出修剪最旧
- 新 op 入栈时清空 redoStack（标准语义）

## API

```
POST /api/workflow/nodes/:actor/actions/graph.undo   {scope?: 'graph'} → {ok, opId, applied:{positions,edges,dockLinks,nodes}, version}
POST /api/workflow/nodes/:actor/actions/graph.redo   同形
CLI:  node-map --action undo | redo
注册表: graph.undo / graph.redo（spawnGate: null — 权限平等）
```

- Undo: 弹 undoStack 顶 → 应用 inverse 切片 → 压入 redoStack → 版本 +1
- 版本守卫：写入走既有 writeWorkflowGraphMap 版本检查；冲突返回冲突错误，调用方重读后重试
- 空栈 → `{ok:true, applied:null}`（幂等，不报错）

## 记录点（后端，每个图变更动作）

moveNode / connectNodes / disconnectNodes / updateEdge / attachDock / detachDock / setDockSide / layout / deleteNode / createNode(agent.createNode 各类) / node settings PATCH

## UI 集成（单真相）

- UI 现有 undo/redo 按钮改为调 `graph.undo`/`graph.redo` 后端动作（人类和 agent 共用同一历史）
- 迁移两阶段：P1 阶段后端记录 + 动作接口 + UI 切后端（客户端栈保留但不再使用）；P2 阶段删除客户端本地栈
- PUT /api/a2a/graph-map 不再清空 undoStack（现在清空的代码删掉）

## 边界情况

- 撤销 deleteNode：nodes 切片含完整节点 + position + 关联边 → 完整恢复
- 撤销 layout：positions 切片 = 被移动的全部节点
- dock 撤销：dockLinks 切片参与
- 重启后：undoStack 在 workflow-map.json 里，天然存活
- 并发：版本守卫拒绝过期撤销（同图写入的既有冲突路径）

## 测试计划

单元（workflow-graph-undo.test.mjs）：
- U1 moveNode 记录 op → undo 恢复旧位置 → redo 再应用
- U2 deleteNode → undo 恢复节点+边
- U3 connect/disconnect/updateEdge → undo 恢复边旧值
- U4 attachDock/detachDock → undo 恢复 dock
- U5 上限修剪（51 条 → 最旧被剪）
- U6 空栈 undo/redo 幂等
- U7 新 op 清空 redo
- U8 版本冲突 → 冲突错误
- U9 重启持久化（重新加载 workflow-map.json 后仍可 undo）
- U10 CLI node-map --action undo 载荷形状

E2E（归入最终端到端控制测试）：真 agent 移节点 → undo → 画布位置恢复。

## 开放问题（用户可后续定）

1. 是否撤销也要覆盖 node settings PATCH？（设计包含它，可裁剪）
2. 历史上限 50 是否合适？
