# 竞品机制事实补充（定点取证）

取证日：2026-09-09。范围仅为已有来源的定点复核；未复制代码、未改
runtime/STATE/version/git。本文件用于补充机制事实，不替代 AC 或 benchmark。

## Claude Code：拆工、上下文与消息

| 机制 | 官方事实 | 对本框架的可复用边界 |
|---|---|---|
| Subagent | 每个 subagent 有自己的 context window、system prompt、工具与权限；主会话按 description 决定是否委派，结果摘要回主会话。官方还明确可把探索/实现隔离出主上下文，并可把专职任务路由到更快/便宜模型。 | 复用“短 description + 运行时才载入详细 prompt”、角色化只读/写权限、摘要回传；不把自动委派或模型降价当作 Harness 已有的经济 router。 |
| Agent teams | 实验性且默认关闭；一个 lead 分派/综合，teammates 各自独立 context，可直接互发消息，并共享 task list（claim/完成）。文档警告 token/协调成本显著更高；顺序依赖任务应使用 subagent。 | 可借鉴 shared task list、直接质询与独立审阅；映射到本项目仍必须通过 canonical task/queues、owner/writeSet 和 event/gate，不能把 Claude team 状态当作本地 A2A 互操作证明。 |
| Skills | `SKILL.md` 的 body 仅在使用时加载；可用 frontmatter 控制触发/权限，并用 supporting files 或动态上下文承载长流程。 | 复用按需加载、稳定索引+动态尾部和文档指针；本地 pack 的 hash、预算、STATE freshness 仍需独立验收。 |

官方页面：

- [custom subagents](https://code.claude.com/docs/en/sub-agents#when-to-use-subagents)（独立 context、权限、摘要与模型选择；取证时官方页显示 v2.1.198 相关说明）；
- [agent teams](https://code.claude.com/docs/en/agent-teams#compare-with-subagents)（独立 context、shared task list、直接消息、实验性/成本边界）；
- [skills](https://code.claude.com/docs/en/skills#extend-claude-with-skills)（按需加载 body、frontmatter、supporting files）。

这些是 Claude 产品文档事实，不证明当前 Claude 网关存在
`gpt-5.6-luna/xhigh`，也不证明本项目的 typed dispatch 或 A2A。

## DeepSeek Harness：README 与 3 个实际源码点

官方 commit 固定为
[`5dda764ed3aa172535a7967b06ff95d9cbfe536a`](https://github.com/deepseek-ai/DeepSeek-Harness/commit/5dda764ed3aa172535a7967b06ff95d9cbfe536a)。Root README 表明：项目采用
“everything-is-a-plugin”并由 Cordis 驱动；npm 入口要求 Node.js，`npx
@deepseek-ai/dsh web` 默认启动本地 Web UI，`--no-open` 可禁用开浏览器；项目
处于 developer preview 且允许 breaking changes，许可证为 MIT。树中同时存在
顶层 `python/`（Python SDK 文档），所以准确表述是“选定调度/context 核心为
TypeScript/Node，仓库整体语言/SDK 为混合”；不能写成拒绝 Python 或 Node-only。

| commit permalink（实际文件） | 观察到的机制 | 可复用 / 不适用 |
|---|---|---|
| [`packages/workflow/workflow/src/index.ts#L141-L175`](https://github.com/deepseek-ai/DeepSeek-Harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/workflow/workflow/src/index.ts#L141-L175) | `WorkflowEngine.start(request)` 是可替换的 service seam；事件只发 identity/result snapshot，不暴露 run control；`WorkflowError` 给出可路由错误码，fatal 错误由组合器传播。 | 复用“执行引擎与模型可见接口分离”、typed lifecycle/error gate；不直接采用其 Cordis API，也不以接口声明代替本项目真实 provider/PTY 证据。 |
| [`packages/workflow/workflow-worker-thread/src/index.ts#L1-L4,L121-L188`](https://github.com/deepseek-ai/DeepSeek-Harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/workflow/workflow-worker-thread/src/index.ts#L1-L4) | 每次 workflow 在新 worker/vm 中执行，`start` 先校验 meta/body/provider，再解析并注入 `maxConcurrentAgents`、`maxTotalAgents`、item cap 和同步/处置超时；返回 holder-owned run，结束事件只带 stop reason/计数。 | 可借鉴 bounded fan-out、同步 reject 与 holder-owned disposal；不适合直接替代本项目跨 CLI session、单次 retry/new-session 合同或 canonical STATE。 |
| [`packages/context/agent-instructions/src/index.ts#L76-L205`](https://github.com/deepseek-ai/DeepSeek-Harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/context/agent-instructions/src/index.ts#L76-L205) | context 插件在 `agent/pre-step` 组合指令；有 `maxBytes` guard、project-root discovery、baseline identity/digest、read/write/edit touch 追踪，成功后按 durable step 投影新增/替换/移除，未变 digest 不重复注入。 | 可借鉴“基线 identity+digest、按实际文件触碰刷新、预算内删除/替换”；本项目仍须保留 role/task pack、STATE/handoff freshness 和 evidence pointer 语义，不能只因有 projection 就宣称流程自动维护正确。 |

来源： [DeepSeek Harness README（该 commit）](https://github.com/deepseek-ai/DeepSeek-Harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/README.md)、[LICENSE](https://github.com/deepseek-ai/DeepSeek-Harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/LICENSE)。本次只核对上述 root README 与 3 个源码文件；未将 URL 存在、仓库规模或 star 数当作性能/质量证据。

