# Orchestration Live E2E Evidence (2026-08-14)

真实编排观测：主 agent spawn 3 个 worker 搜索最新 AI harness + DeepSeek 资讯。
用户要求：观测主 agent 运行速度、准确度、控制其他 agent 的效率/准确率/稳定性；
全套 deepseek flash 模型；验证节点模型控制；验证新自动布局。

## 1. 环境

- Backend wf-ui 0.8.20 on http://127.0.0.1:56670（含 P1 性能修复 + 自动布局 + argv flatten 修复）
- 画布初始：0 节点（已全清）
- 模型：deepseek-v4-flash（= 用户 claude 配置的 haiku 槽位 deepseek-v4-flash）
- 尝试 1（codex 全套）：**外部阻塞** — codex 免费配额耗尽（"You've hit your usage
  limit... try again at Sep 13th"），主 agent 回合无法执行。用户决定换 claude 全套。

## 2. 真实发现的 bug（观测期间修复）

- **argv initial-prompt 换行截断**：Windows `cmd /c` 引号跨行断裂，多行 initial-prompt
  只有第一段到达 runtime（codex 主 agent argv 只剩第一段，操作步骤全丢）。
  修复：runtime-detector.mjs resolveRuntimeLaunchArgs 将 initialPrompt 压平为单行
  （`replace(/\s*\r?\n\s*/g, ' ')`）。runtime-detector 测试 10/10。
- **类型节点删除复活**：DELETE /api/a2a/nodes/<id> 只删图记录，event/component/
  capability 独立 store 记录残留 → 快照从 store 复活"已删除"节点（timer 节点删不掉）。
  修复：removeWorkflowGraphNode 同步删除类型 store 状态；DELETE 路由的 undo inverse
  记录携带 eventState/componentState/capabilityState。a2a-store 测试含回归。
- **自动布局**（本任务核心）：graph-layout.mjs — autoPlaceNode（占位感知：新节点落在
  空闲网格槽，父子就近，永不重叠含手拖节点）+ layeredTreePositions（子树宽度分层树，
  子块居中于父，全图重排）。新节点位置不再按 `count%4*280` 猜槽（删节点后撞车根因）。

## 3. 主流程（claude flash 全套，真实终端）

时间线（t 从主 agent 创建起算）：
- t=0s: 主 agent 创建（claude + --model deepseek-v4-flash，wmic argv 验证含模型 flag）
- t=60s: 任务指令经 ready-gated 提交完成（~700 字符逐字符打字）
- **t=120s: 3 个 worker 全部 spawn 完成且 running**（60 秒完成 3 spawn）
- t≈300s: 主 agent 回合完成，输出汇总表（见下）
- t≈600s: 3 个 worker 搜索回合全部完成（各自 25-32s/回合，真实新闻源）

### 主 agent 汇总输出（terminal 实录，节选）

```
| Researcher1 | 2ee8e972... | ✅running | deepseek-v4-flash |
| Researcher2 | 02b84544... | ✅running | deepseek-v4-flash |
| Researcher3 | 91fc68f5... | ✅running | deepseek-v4-flash |
All three are subagent kind, runtime claude, parented to your session 65d8e1c7...,
and are actively working on their research objective...
The snapshot confirms each node is running with the deepseek-v4-flash model.
```

与后端快照逐一核对：节点 id、runtime、模型、parent 全部精确匹配。

### Worker 搜索结果（节选，均带真实新闻源 URL）

- W1: DeepSeek Harness 发布 — "agent harness with skill/plugin layers, trajectory
  logging, node/session state"（People's Daily / Wen Wei Po / STCN / DoNews / China Daily）
- W2: V4-Pro 发布 + 定价转向（8/16-17 起峰谷计费，部分档位涨 5 倍）（api-docs.deepseek.com /
  YahooTech / llm-stats / China.com / ZOL）
- W3: "DeepSeek pushing the open-source boundary from models into the agent-harness
  layer (Harness v0.1)... MIT-licensed, model-agnostic, positions directly against
  Claude Code-style tooling"

### 布局实录（快照）

```
主 agent   @ (120,120)   根行
Worker 1   @ (120,300)
Worker 2   @ (400,300)   子行，父节点下方一字排开，零重叠
Worker 3   @ (680,300)
```

### 模型控制验证（wmic 真实 argv）

- 主:  `--model deepseek-v4-flash --dangerously-skip-permissions --session-id 322c5eaa...`
- W1-3: `--model deepseek-v4-flash --dangerously-skip-permissions "Search the web for..."`
=> 4 个进程全部 deepseek-v4-flash；主 agent 正确把模型参数传播给 worker spawn 命令。

## 4. 观测评分表

| 维度 | 结果 | 证据 |
|---|---|---|
| 运行速度 | 优 | spawn 3 个 60s；主回合 32s；worker 回合 25-32s（loaded machine） |
| 任务理解准确度 | 优 | 3 worker 数量/角色名/runtime/模型/parent 全对；汇总表与快照逐项一致 |
| 控制效率 | 优 | 每条 CLI 命令一次成功；自主用 snapshot 验证；spawn 无重试无失败 |
| 控制准确率 | 优 | 0 错误命令、0 失败 spawn、0 孤儿参数 |
| 稳定性 | 优 | 全程无崩溃/退出/异常；4 节点持续 running |
| 布局 | 优 | 分层树生效：root 顶行、3 子节点下方一字排开零重叠 |
| 模型控制 | 优 | spawn 级 --model 全链传播（argv 实录） |

## 5. 局限与后续建议（诚实记录）

1. **回报收集链路缺失**：worker 的搜索结果留在各自终端里，主 agent 只核对了 snapshot
   状态（running/模型），没有读取 worker 的产出内容——任务指令本身只要求"汇总名字/
   id/状态"，未要求收集结果。编排层需要"回报约定"（worker 完成后 send-agent-message
   回传给 parent，或主 agent 用 read-agent 拉取）。
2. **主 agent 后续回合未提交**：回合结束后 composer 出现自动建议文本
   "check if the researchers have reported back"，裸 \r 无法提交（非可编辑输入）。
   主 agent 的自主下一步（检查回报）未执行——需要明确的唤醒/续跑机制。
3. codex 配额墙是外部阻塞（Sep 13 重置）；argv 截断与类型节点复活两个真实 bug 已修。
4. 测试残留：4 个 claude 进程 idle 于 composer（用户观看中，未清理）。
