# PLAN — task-add-web-agent-node

## Goal

在 wf-ui 现有 terminal PTY agent node 之外，新增一种「原生 web chat」agent node：不嵌终端，用结构化事件流（文本增量/工具卡片/审批请求）直接驱动 Claude Code、Codex、OpenCode、Pi 后端，参考 agentre-hub/agentre 的引擎接入模式。

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

- AC-1 设置面板暴露 uiMode（`pty|chat`，界面标签 Terminal|Chat），默认 `pty`，经 patchNodeSettings 持久化并在重启后保留。
- AC-2 uiMode=chat 启动会话时不经 PTY 直接驱动对应引擎（四个 runtime），HARNESS_* env 与终端模式逐项相同；STATE.json 记录 uiMode/providerSessionId/transport。
- AC-3 /ws/chat/:sessionId 推送 canonical 事件；提供历史回填（REST range），刷新不丢对话。
- AC-4 ChatPanel 渲染流式文本/thinking/工具卡/审批请求；permission-mode switch 显示当前 runtime 支持的模式并调用后端切换协议；审批响应幂等（requestId 去重）且真正解除后端等待。
- AC-5 图上 send-message/broadcast/Timer 唤醒送达 chat 会话（send 或 steer 语义按运行时），bridge 记录与终端模式一致。
- AC-6 重启/重开继续原会话：Claude `--resume <id>`、Codex thread/resume、OpenCode 复用 ses_，以及 Pi 对应的 session resume 协议。
- AC-7 stop/dispose 干净终止子进程，无孤儿进程。
- AC-8 终端模式零回归：全量测试通过；action-registry 文档如涉及则同步 templates 镜像。

## Subagent Dispatch (D-GATE)

Wave 2a（并行，写集不相交）：

| # | Role | Objective | WriteSet | Forbidden | Verification |
|---|---|---|---|---|---|
| T1 | test-writer | AC-linked RED tests for chat entry/surface persistence, state handshake, runtime mode filtering/change/failure, correlated allow/deny approvals, and Pi RPC gate frames | `src/wf-ui-server/__tests__/chat-*.test.mjs`, `src/ui/e2e/chat-agent.spec.ts` | production source, task state/capsules | each new test fails for the missing contract, then passes after implementation |
| S1 | implementer | 服务端 chat 通道地基：harness-env 抽取、chat-driver 接口+工厂+store、ws-chat、server.mjs uiMode 分支、STATE.json 字段、stop dispose、agent-node sendMessage 分支、REST 回填 | src/wf-ui-server/** | src/ui/**, Harness/a2a/action-registry.json 内容变更 | node 自测新增单测通过 + 现有 suite 通过 |
| U1 | implementer | 前端 chat 形态：chat/ 组件族、useChatStream、设置开关、WorkflowRoute/Drawer 分支、类型补充 | src/ui/** | src/wf-ui-server/** | vite build/tsc 通过 + 组件级单测（若有先例） |

Wave 2b（S1 后串行/小并行）：四个 driver 实现（claude-stream-json / codex-appserver / opencode-server / pi-rpc），各自新文件 + chat-driver.mjs 注册点由 S1 预留槽位。
Review plan：W2a 完成后 review-manager 或双 reviewer（spec/code）并行审；verifier 出 AC 矩阵。

Self-audit: 写集不相交 ✔；每 Worker 单文件域为主 ✔；S1 为 server.mjs 唯一所有者 ✔；driver 槽位预留在 S1 内避免 2b 冲突 ✔。

## Decisions (user-confirmed 2026-08-26)

1. **后端范围**：claude + codex + opencode 三者都要。
2. **形态定位**：web agent 与 terminal agent node **能力一模一样，只有 UI 不同** —— 同一 agent 节点语义、同画布协作（Timer/Goal/Markdown 连线）、同 spawn 子代理、同控制面动作；差异仅在呈现层（xterm 终端 ↔ 聊天事件流）。设计上应做成 agent node 的 surface/ui 模式（`terminal | chat`），而非语义不同的第二种节点。
3. **原审批模型（已由 2026-09-28 用户决定取代）**：允许一次 / 总是允许 / 拒绝三键卡片。

## User Decisions (2026-09-28; supersede conflicting initial decisions)

- Runtime scope: Claude Code, Codex, OpenCode, and Pi.
- Product shape: standalone chat session; it does not join the subagent tree in this task.
- Approval control: expose a permission-mode switch in the UI. Keep mode choices runtime-specific and show only modes supported by the active driver; do not require the former three-button approval model.

## UI and Transport Contract (2026-09-28)

- Entry point: select an existing workflow agent node, open its `AgentNodeSettings`, choose the `Chat` session surface, then use the existing `agent.start` action. The chat is the same standalone agent session and keeps its existing graph identity; it does not create a subagent edge. Selecting `Terminal` stores `uiMode: "pty"`; selecting `Chat` stores `uiMode: "chat"`.
- Chat renders in the existing selected-session node body and drawer where the PTY terminal renders today. The initial scope is the main/standalone session only; do not expose subagent-tree creation as part of this UI.
- `GET /api/chat/:sessionId/range?fromSeq=<n>` returns `{ envelopes: ChatEnvelope[] }`. `GET /ws/chat/:sessionId` sends `chat:state` first, then stored envelopes in increasing `seq`, then live envelopes. Its state frame is `{ type: "chat:state", sessionId, state, uiMode: "chat", providerSessionId, runtime, supportedModes, permissionMode }`; `supportedModes` is a non-empty runtime-specific string array declared by the live driver and `permissionMode` is one of those values.
- Client mode change frame: `{ type: "chat:setPermissionMode", requestId, mode }`. The server validates `mode` against that driver’s `supportedModes`, awaits the runtime change, then broadcasts a `permission_mode_changed` envelope with `{ requestId, mode }` on success or `permission_mode_change_failed` with `{ requestId, mode, message }` on failure. The UI keeps the confirmed selection until the matching success envelope arrives; failure leaves the old selection and shows an error.
- Per-request approval frame: `{ type: "chat:approve", requestId, decision: "allow" | "deny" }`. Approval cards expose only Allow and Deny. Drivers correlate each pending request exactly once and ignore unknown, duplicate, or stale IDs.
- Initial supported mode sets are deliberately runtime-specific: Claude Code `default|acceptEdits|plan|bypassPermissions`; Codex app-server `untrusted|on-request|on-failure|never`; OpenCode `ask|allow|deny`; Pi host gate `ask|allow|deny`. If the installed runtime/server version cannot apply one of its listed modes, the driver must omit it from `supportedModes` or reject the change; never report success without runtime confirmation.
- Pi gate extension contract: bundle `extensions/pi-host-gate/index.ts`, launch `pi --mode rpc --extension <absolute-path>`, and register `/harness-permission-mode <ask|allow|deny>`. The driver sends the extension command as the Pi RPC `prompt` record `{ id, type: "prompt", message: "/harness-permission-mode <mode>" }` and waits for the matching `{ id, type: "response", command: "prompt", success: true, data: { disposition: "handled" } }`; a rejected response fails the mode change. The extension’s `tool_call` handler runs before tools: `allow` returns without blocking, `deny` returns `{ block: true, reason }`, and `ask` awaits `ctx.ui.confirm(...)`, returning `{ block: true, reason }` when declined.
- In Pi ask mode, `ctx.ui.confirm` emits the official RPC extension UI record `extension_ui_request` with `{ id, method: "confirm", title, message }`. The driver maps its `id` to one canonical `permission_request` envelope (including `requestId`, `tool`, and summarized input); an allow/deny chat frame resolves it by writing `{ type: "extension_ui_response", id, confirmed: true|false }` to Pi stdin. On Pi exit/disconnect, unresolved requests are answered as cancelled/denied where possible and never allowed through. The extension must fail closed if it runs without host UI.

## Resolved Pi Permission Decision (2026-09-28)

- User selected the bundled host-managed Pi gate extension.
- The Pi driver must load the bundled extension in RPC mode. Its `tool_call` hook blocks execution while an approval is pending and sends the request through the chat event stream.
- The UI permission-mode switch maps `ask` to host approval, and the other visible modes to the bundled extension's documented policy. The driver must reject unsupported mode values rather than silently accepting them.
- Approval responses must carry a request ID and resolve the matching blocked `tool_call` through Pi RPC. Duplicate or stale responses must not resolve a different request.
- Pi's visible modes are the modes implemented by the bundled extension and declared by the driver; the UI must not present modes that the runtime cannot enforce.
- Pi supports `--mode rpc`, JSONL command/event traffic, session ID/file operations, `tool_call` blocking, and extension UI dialogs. The contracts below use the documented `extension_ui_request` / `extension_ui_response` records. See `REFERENCES.md`.

## Permission-Mode UI Contract

- The chat panel exposes a select with `data-testid="chat-permission-mode"` and accessible name `Permission mode`.
- Its options come from the active driver's declared `supportedModes`; the current mode is selected. Changing it sends `chat:setPermissionMode` with `{ requestId, mode }`. Keep the old selection until the matching `permission_mode_changed` envelope arrives; a matching `permission_mode_change_failed` leaves the old selection and shows the failure.
- Approval cards identify `requestId` and expose only Allow and Deny. Persistent policy changes belong in the permission-mode control; do not require or show an “Always allow” button.
- Canonical permission requests are `permission_request` envelopes with payload `{ requestId, tool, input, title? }`. The UI replies with `chat:approve` `{ requestId, decision: "allow" | "deny" }`. Ignore duplicate or stale request IDs.
- Pi's bundled host extension declares `ask`, `allow`, and `deny`: `ask` blocks each `tool_call` until the matching RPC approval response; `allow` permits the call; `deny` rejects it. If the host disconnects or the response cannot be matched, fail closed. The RPC bridge maps extension UI requests to the canonical permission event and sends the correlated response back to the extension.
- Tests cover runtime-specific mode lists and changes for Claude Code, Codex, OpenCode, and Pi, plus the Pi host-gate ask/approve/deny path.

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
