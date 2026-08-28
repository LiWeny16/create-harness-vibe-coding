# PLAN — task-add-web-agent-node

## Goal

在 wf-ui 现有 terminal PTY agent node 之外，新增一种「原生 web chat」agent node：不嵌终端，用结构化事件流（文本增量/工具卡片/审批请求）直接驱动 claude/codex 后端，参考 agentre-hub/agentre 的引擎接入模式。

## Non-Goals (initial)

- 不替换现有 PTY agent node；两种形态并存。
- 不做远端 daemon（agentred 类）。
- 不引入 Go/Wails 依赖，全部 Node.js + 现有 ws 基建。

## W0 Research Synthesis

### Agentre 引擎接入模式（来源 agentre-hub/agentre@main）

- **Claude Code**：持久子进程 `claude --output-format stream-json --input-format stream-json --verbose --include-partial-messages`（不加 `-p`，管道 stdout 自动 headless）；审批/中断/切权限走 stdin control protocol（`control_request{subtype: can_use_tool|interrupt|set_permission_mode}` + `--permission-prompt-tool stdio`）；`--resume <id>` / `--resume-session-at <uuid> --fork-session` 复用与分叉。来源：pkg/claudecode/args.go、runtimes/claudecode/session.go。
- **Codex**：`codex app-server --listen stdio://` NDJSON JSON-RPC：initialize → thread/start|resume|fork|rollback → turn/start|steer|interrupt；模型/审批策略进 thread 参数。非 `exec --json`。来源：pkg/codex/{client,rpc,types}.go。
- **统一事件层**：sealed Event 接口（TextDelta/ThinkingDelta/ToolCall/ToolResult/UserAskRequest/ToolPermissionRequest/SubagentStarted/UsageUpdate/Done/Error…），每 backend 一个 translator 把原始帧转 canonical 事件，再映射前端 `stream_*` 事件。会话状态机 idle/running/waiting/error 落库；ProviderSessionID 映射后端会话 id。
- **审批环**：request 事件 → UI 卡片 → 服务层响应 request-id → RespondToControl/RPC reply。
- **排队消息** = mid-turn steer（turn/steer 或 stdin 注入），FIFO。
- **前端**：canonical kind → React 卡片组件注册表（file-edit/file-write/user-ask/tool-permission/plan…），raw 兜底。
- **Node 可移植性**：两协议均为 stdio JSON 行协议，child_process.spawn + readline 即可；Emitter 换成现有 WS hub 即可。

### 本仓库现状（src/wf-ui-server + src/ui）

- server 入口 src/wf-ui-server/server.mjs（REST 手工分发 + typed actions `POST /api/workflow/nodes/:id/actions/:action`）；PTY spawn 在 pty-adapter.mjs（node-pty，Windows cmd 包装，HARNESS_* 身份 env :553-570）。
- 各 runtime 启动参数集中在 runtime-detector.mjs RUNTIME_DEFINITIONS（claude/codex/opencode 的 resumeArgs、capabilities）。
- 浏览器流路径：PTY onData → terminal-store ring → terminalHub.broadcastToSession(`pty:data`) → /ws/terminal/:sessionId。
- **关键缺口**：无 SessionDriver 抽象，PTY 硬编码在 server.mjs start/onData/onExit；agent-node 发消息是逐字符敲 TUI composer（agent-node.mjs:390-447）；transcript=terminal ring。
- 扩展缝清单：workflow-node-runtime.mjs ACTION_ADAPTERS(:128-139)、workflow-ontology.mjs STATIC_ONTOLOGY nodeClasses/nodeTypes(:38-149)、Harness/a2a/action-registry.json(+templates 镜像)、ui/src/components/workflow/nodeRegistry.tsx(:58-187)、nodeRuntimeClient.ts kind union(:27)、WorkflowRoute.tsx 渲染分支。

## W1 Synthesis

Agents used: docs-researcher(opencode protocol), architect×2(server seam / frontend surface).
Findings accepted: 三方一致 —— chat 是同一 agent 节点的传输替换：节点 kind 不变、ACTION_ADAPTERS.agent 复用；差异仅在进程适配器（PTY 敲字 → 结构化 stdio）与呈现组件。
关键决策：
- 服务端：`createChatDriver({runtime,...})` 工厂 + canonical 事件封套 `{seq,ts,type,payload}`（TextDelta/ThinkingDelta/ToolCallStart|End/UserAsk/PermissionRequest/SessionReady/TurnStarted|Ended/Done/Error + raw 直通）；canonical 事件镜像写入 terminal-store 使 readOutput/readTranscript 零改动复用。
- 会话 id：claude 预分配 --session-id；codex 取 thread/start 响应；opencode 取 initialize/session 创建响应。全部走 SessionReady 事件替代 fs/sqlite 轮询。
- WS：新模块 ws-chat.mjs `/ws/chat/:sessionId`（复制 attachTerminalWs hub 结构），客户端帧 chat:send|steer|interrupt|approve|setPermissionMode；另需 REST 回填端点 /api/chat/:id/range?fromSeq（刷新恢复）。
- opencode 传输：`opencode serve` HTTP+SSE（prompt_async / GET /event / permissions POST / abort）；权限 API 版本敏感，实现时以安装版 /doc OpenAPI 为准做 feature-detect。
- 前端：新目录 src/ui/src/components/chat/{ChatPanel,MessageList,DeltaText,ToolCard,ApprovalCard,AskUserCard,Composer}.tsx + hooks/useChatStream.ts；uiMode 开关放 AgentNodeSettings 内（segmented control，经既有 patchNodeSettings）；WorkflowRoute 节点体与 Drawer 分支渲染；markdown-it/dompurify 已有依赖直接用；React 实为 19。
Findings rejected: 无。
Conflicts: 无实质冲突（两架构师对「是否新建节点类型」结论一致——不新建）。

## Acceptance Criteria

- AC-1 设置面板暴露 uiMode(terminal|chat)，默认 terminal，经 patchNodeSettings 持久化并在重启后保留。
- AC-2 uiMode=chat 启动会话时不经 PTY 直接驱动对应引擎（三后端），HARNESS_* env 与终端模式逐项相同；STATE.json 记录 uiMode/providerSessionId/transport。
- AC-3 /ws/chat/:sessionId 推送 canonical 事件；提供历史回填（REST range），刷新不丢对话。
- AC-4 ChatPanel 渲染流式文本/thinking/工具卡/审批卡（允许一次|总是允许|拒绝），approve 幂等（requestId 去重）且真正解除后端等待（claude control frame / codex RPC reply / opencode permission API）。
- AC-5 图上 send-message/broadcast/Timer 唤醒送达 chat 会话（send 或 steer 语义按运行时），bridge 记录与终端模式一致。
- AC-6 重启/重开继续原会话：claude --resume <id>；codex thread/resume；opencode 对已有 ses_ 发新 prompt。
- AC-7 stop/dispose 干净终止子进程，无孤儿进程。
- AC-8 终端模式零回归：全量测试通过；action-registry 文档如涉及则同步 templates 镜像。

## Subagent Dispatch (D-GATE)

Wave 2a（并行，写集不相交）：

| # | Role | Objective | WriteSet | Forbidden | Verification |
|---|---|---|---|---|---|
| S1 | implementer | 服务端 chat 通道地基：harness-env 抽取、chat-driver 接口+工厂+store、ws-chat、server.mjs uiMode 分支、STATE.json 字段、stop dispose、agent-node sendMessage 分支、REST 回填 | src/wf-ui-server/** | src/ui/**, Harness/a2a/action-registry.json 内容变更 | node 自测新增单测通过 + 现有 suite 通过 |
| U1 | implementer | 前端 chat 形态：chat/ 组件族、useChatStream、设置开关、WorkflowRoute/Drawer 分支、类型补充 | src/ui/** | src/wf-ui-server/** | vite build/tsc 通过 + 组件级单测（若有先例） |

Wave 2b（S1 后串行/小并行）：三个 driver 实现（claude-stream-json / codex-appserver / opencode-server），各自新文件 + chat-driver.mjs 注册点由 S1 预留槽位。
Review plan：W2a 完成后 review-manager 或双 reviewer（spec/code）并行审；verifier 出 AC 矩阵。

Self-audit: 写集不相交 ✔；每 Worker 单文件域为主 ✔；S1 为 server.mjs 唯一所有者 ✔；driver 槽位预留在 S1 内避免 2b 冲突 ✔。

## Decisions (user-confirmed 2026-08-26)

1. **后端范围**：claude + codex + opencode 三者都要。
2. **形态定位**：web agent 与 terminal agent node **能力一模一样，只有 UI 不同** —— 同一 agent 节点语义、同画布协作（Timer/Goal/Markdown 连线）、同 spawn 子代理、同控制面动作；差异仅在呈现层（xterm 终端 ↔ 聊天事件流）。设计上应做成 agent node 的 surface/ui 模式（`terminal | chat`），而非语义不同的第二种节点。
3. **审批粒度**：三键卡片（允许一次 / 总是允许 / 拒绝）。

## Open Questions (blocking implementation)

- ~~原三问已由用户回答~~。剩余：opencode 结构化协议能力待 docs-researcher 确认后定其 translator 形态。

## Fanout Record

- fanoutAttempted: true
- runtime/channel: opencode native subagents (task tool)
- agents requested: codebase-explorer(haiku) ×2 → FAILED "Model not found: haiku/."（agent 配置的默认模型名非法）；degrade → explore agent 成功；researcher 成功（~20 files fetched from agentre repo）。
- 结论：native fan-out 可用但 codebase-explorer 角色模型配置损坏，需修复 .claude/agents/codebase-explorer.md 的 model 字段（另开小任务或顺手修）。

## Subagent Dispatch

| Wave | Role | Objective | ReadSet | WriteSet | Verification |
|---|---|---|---|---|---|
| W0 | researcher | agentre 引擎层深读 | github agentre repo | none | findings w/ file cites |
| W0 | explore | 本地 wf-ui 架构地图 | src/wf-ui-server, src/ui | none | file:line citations |
