# CC Prompt - `$wf-ui` Planning And Architecture Review

你在 repo:

```text
D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding
```

## 背景

`0.8.18` 已经完成 npm publish、canonical/legacy GitHub main、tag、release 同步。当前任务进入下一阶段：设计 `$wf-ui`，即 Harness 的本地 Web Control Panel。

这不是简单的终端 wrapper，也不是 `wf-review` 的小修。用户要的是 Harness Control Plane：

- 可视化 task capsules、active task、task dependency。
- React Flow 展示 workflow、agent、subagent reported events。
- 点进每个 task/agent/subagent 看状态、结果、证据、运行轨迹。
- 控制 Claude / Codex / OpenCode peer agent sessions。
- 浏览器内置 terminal，类似 VSCode terminal，不使用 Windows Console / PowerShell window / Windows Terminal / SendKeys。
- 本地 Node server + WebSocket 与浏览器通信。
- `Harness/tasks/**` 文件系统仍是唯一 durable source of truth。

## 强制限制

- 本轮只做计划、架构、review、任务胶囊记录。
- 不要实现源码。
- 不要改 package.json、src、templates、commands、skills、validators、tests。
- 不要 publish。
- 不要恢复 `stash@{1}`，它是 docs/videos。
- 如果需要恢复任务胶囊，最多使用当前 `$wf-ui` capsule；不要碰视频。
- 不要假装存在 `apple-design` skill。本 repo 当前没有本地 `apple-design` skill。如果你的环境有，必须加载；如果没有，按本提示词的 UI 约束执行。

## 先加载的本地上下文

必须先读：

```text
CLAUDE.md
Harness/PROGRESS.md
Harness/tasks/task-wf-ui-control-0729/STATE.json
Harness/tasks/task-wf-ui-control-0729/PLAN.md
Harness/tasks/task-wf-ui-control-0729/PROGRESS.md
```

然后按需读：

```text
.agents/skills/wf-command-create/SKILL.md
.claude/commands/wf-command-create.md
Harness/specs/runtime/command-surface.json
.agents/skills/wf-agents-docs/SKILL.md
.agents/skills/subagent-orchestrator/SKILL.md
.agents/skills/tdd/SKILL.md
.agents/skills/wf-browser/SKILL.md
Harness/specs/runtime/subagents.md
Harness/specs/runtime/dispatch.md
Harness/specs/runtime/context-loading.md
Harness/specs/runtime/agent-workflow.md
Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md
Harness/specs/protocols/HARNESS_BRIDGE.md
Harness/specs/protocols/AGENT_ISOLATION.md
Harness/specs/protocols/TDD-GUIDE.md
```

## 官方调研要求

派 docs-researcher 或自己查官方来源，不能凭记忆。至少确认：

- Vite 8 / Rolldown / Node version requirements: https://vite.dev/blog/announcing-vite8
- Motion for React / Framer Motion current package/import shape: https://motion.dev/docs/react
- React Flow node/edge model: https://reactflow.dev/api-reference/react-flow and https://reactflow.dev/learn/concepts/terms-and-definitions
- xterm.js WebSocket terminal security: https://xtermjs.org/docs/guides/security/
- node-pty ConPTY, optional/native/security risks: https://github.com/microsoft/node-pty
- ws server library and compression/security defaults: https://github.com/websockets/ws
- Browser WebSocket events/readyState: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Node HTTP server loopback binding/listen: https://nodejs.org/api/http.html

把 adopted/rejected decisions 写回 PLAN，不要只在聊天里说。

## 技能门禁

每个阶段必须声明使用哪些 skills，并记录在 PLAN。

Phase 1 planning/spec:
- `subagent-orchestrator`
- `wf-command-create`
- `skill-creator`
- `wf-agents-docs`
- `tdd`
- `wf-browser`

Phase 2 command/skill surface:
- `wf-command-create` mandatory
- `skill-creator` mandatory

Phase 3 backend skeleton:
- `tdd`
- `subagent-orchestrator`
- `wf-agents-docs`

Phase 4 read-only UI:
- `tdd`
- `wf-browser`
- `apple-design` if available, otherwise explicit UI constraints

Phase 5 React Flow graph:
- `tdd`
- `wf-browser`
- `subagent-orchestrator`

Phase 6 xterm/WebSocket/PTY:
- `wf-agents-docs`
- `tdd`
- `wf-browser`
- independent security/architecture review

Phase 7 peer capsule protocol:
- `wf-agents-docs`
- `subagent-orchestrator`
- `tdd`

Phase 8 validation/release:
- `wf-review`
- `subagent-orchestrator`
- verifier + reflector

## 要设计清楚的核心架构

推荐架构，但必须 review：

```text
Browser UI
  React + TypeScript + React Flow + Motion for React + xterm.js + Lucide
        |
        | HTTP JSON APIs + WebSocket
        v
Local Node server bound to 127.0.0.1 only
  - static UI assets
  - task capsule API
  - settings API
  - event watcher
  - peer terminal/session coordinator
        |
        | fs + task-state.mjs + optional node-pty
        v
Project-local Harness files
```

必须明确：

- Browser 不能直接写文件。
- Backend 写入必须通过安全 API 或现有 `task-state.mjs`。
- `Harness/tasks/**` 是状态真相。
- UI 状态是 derived state。
- Terminal 是 browser-hosted xterm，不是系统终端。
- `node-pty` 是 optional adapter；缺失时返回 BLOCKED，不得静默 fallback 到 `claude -p` / `codex exec` / `opencode run`。

## Browser 和本地 Node 通讯协议

必须写入 PLAN：

启动形态：

```text
create-harness-vibe-coding wf-ui --project <abs-project-root> --host 127.0.0.1 --port 0 --open
```

规则：

- 只监听 `127.0.0.1`。
- 默认 port `0` 自动分配。
- 生成一次性 token。
- 打开 `http://127.0.0.1:<port>/?token=<token>`。
- HTTP 和 WebSocket 都校验 token。
- 拒绝 path traversal。
- 拒绝非 loopback host/origin。

必须补充连接生命周期：

1. CLI canonicalize `<abs-project-root>`。
2. 本地 Node server 绑定 `127.0.0.1`，默认 port `0`。
3. server 生成进程内一次性 token，scope 到当前 project root。
4. browser 打开 `/?token=<token>`。
5. browser 先请求 `/api/health` 和 `/api/project`。
6. browser 建立 `/ws/events?token=<token>`。
7. browser 通过 HTTP 加载 `/api/tasks`、`/api/settings`、`/api/peers` 初始快照。
8. server watch `Harness/tasks/**`，debounce 后重新读取 canonical task state，递增 `seq`，发送事件。
9. WebSocket 事件只是 invalidation hint；如果断线、seq gap、重连，browser 必须重新拉 HTTP snapshot。
10. footer/status bar 显示 `connected | reconnecting | degraded | disconnected`。

必须补充写入生命周期：

1. UI 只能发 typed `POST`。
2. server 校验 token、project root、task id、allowlist、canonical output path。
3. server 通过 `task-state.mjs` 或 review 过的 atomic writer 修改文件。
4. server 返回新状态并发送对应 `*.updated` 事件。
5. UI 不能把本地 optimistic state 当 task capsule 真相。

必须补充 peer/PTY 生命周期：

1. UI `POST /api/peers`，传 `taskId/runtime/role/mode/objective/readSet/writeSet/forbidden`。
2. server 创建 `Harness/tasks/<task-id>/peers/<peer-id>/REQUEST.json` 和 `STATE.json`。
3. PTY 可用时，server 通过 optional adapter 启动 allowlisted executable，并写 `events.jsonl`。
4. browser 通过 `/ws/terminal/:sessionId?token=<token>` 观看，默认 read-only。
5. 只有显式 attach mode 才允许 `pty:input`。
6. peer 完成必须落到 `RESULT.json` 或 terminal `STATE.json`。
7. PTY crash/timeout/adapter missing 必须写 peer capsule 的 bounded failure state。

HTTP API 草案：

```text
GET  /api/health
GET  /api/project
GET  /api/tasks
GET  /api/tasks/:taskId
GET  /api/tasks/:taskId/file?name=STATE.json|PLAN.md|PROGRESS.md|RESULT.json
GET  /api/events?after=<seq>&limit=<n>
POST /api/tasks/:taskId/transition
POST /api/tasks/:taskId/archive
GET  /api/settings
POST /api/settings/project
GET  /api/peers
POST /api/peers
POST /api/peers/:peerId/stop
POST /api/peers/:peerId/attach-mode
```

WebSocket:

```text
/ws/events?token=<token>
/ws/terminal/:sessionId?token=<token>
```

事件 schema：

```json
{
  "type": "task.updated | task.archived | peer.started | peer.event | peer.result | settings.updated | server.error",
  "seq": 1,
  "ts": "iso-8601",
  "taskId": "task-id-or-null",
  "peerId": "peer-id-or-null",
  "payload": {}
}
```

Terminal schema：

```json
{ "type": "pty:data", "sessionId": "...", "data": "raw utf8 text chunk" }
{ "type": "pty:exit", "sessionId": "...", "exitCode": 0, "signal": null }
{ "type": "session:state", "sessionId": "...", "state": "starting|running|blocked|exited" }
{ "type": "session:error", "sessionId": "...", "message": "bounded error" }
{ "type": "pty:resize", "cols": 120, "rows": 32 }
{ "type": "pty:input", "data": "..." }
{ "type": "control:stop" }
```

默认 watch/read-only。只有显式 attach mode 才允许 `pty:input` 进入 PTY。

## Shipping model 必须 review

比较并选择：

Option A: package-hosted UI runner
- npm package 包含 server 和 prebuilt UI。
- `$wf-ui` 调用 global binary 或 npx。
- 不污染用户项目 dependencies。

Option B: project-local generated UI
- 生成 `Harness/ui` 和 server。
- 风险：依赖污染、package size、更新复杂。

Option C: hybrid 推荐
- 生成 command/skill/shim。
- package/global runner 负责 UI runtime。
- project-local `Harness/tasks/**` 保持状态真相。

默认建议 Option C，但必须由 architect + reviewer 审查后确认。

## UI 设计约束

如果有 `apple-design` skill，先用它。

如果没有：

- 黑白为主，大面积白色。
- operational dashboard，不做 landing page。
- Lucide icons。
- 使用 Motion for React：包名 `motion`，React import `motion/react`。用户说 Framer Motion 时按当前 Motion for React 官方包处理。
- 尊重 reduced motion；非必要动画必须可关闭。
- app shell 固定：
  - Header：产品/项目标识、project root、active task、command launcher、language selector、theme toggle、help/about。
  - Routed content：Tasks route，显示 task list、filter、open/active/archive、链式依赖、可并行状态。
  - Routed content：Workflow route，React Flow 展示 task/agent/subagent graph。
  - Routed content：Agents route，展示 peer sessions、REQUEST/STATE/RESULT、terminal watch/attach 入口。
  - Routed content：Settings route，展示 global/project settings precedence、runtime paths、feature flags、安全开关。
  - Bottom terminal drawer：xterm terminal watch/attach、session selector、stop/resize、bounded transcript。
  - Footer/status bar：server connection、project path、active task、event seq、last sync/error、peer count、archive warning count、`@bigonion`、`MIT`、footer printer/status output area。
- Motion 微动效范围：
  - Header controls：hover/tap 反馈。
  - Router content：短 enter/exit transition。
  - Inspector/drawer：open/close 和 selected item 切换 layout transition。
  - Footer/status bar：只在 reconnecting/degraded 时做轻微状态 pulse。
  - 禁止 animated background 和持续装饰动画。
- 无装饰渐变 blob/orb。
- 不嵌套 cards。
- 文本不能溢出。
- UI 要能被 Playwright 用 stable selectors 验证。

## 分布式 agent 编排

Wave 0 并行 read-only：

1. docs-researcher
   - skills: `wf-agents-docs`
   - objective: official docs research for Vite/React Flow/xterm/node-pty/ws/WebSocket/Node HTTP.
   - writes: none
   - return: constraints, risks, sources, adopted/rejected choices.

2. codebase-explorer
   - skills: `wf-command-create`
   - objective: map every file/test/template/validator surface needed for `$wf-ui`.
   - writes: none
   - return: exact checklist.

3. architect
   - skills: `subagent-orchestrator`
   - objective: compare shipping models, backend/frontend boundaries, task capsule API, security.
   - writes: none
   - return: recommended architecture and risks.

4. test-writer
   - skills: `tdd`, `wf-browser`
   - objective: define valid tests; distinguish real acceptance evidence from weak checks.
   - writes: none
   - return: AC-to-test matrix.

Wave 1 controller synthesis:

- Update `PLAN.md`, `PROGRESS.md`, `STATE.json`.
- No implementation.

Wave 2 independent review：

1. Reviewer A: spec/user-need review.
2. Reviewer B: architecture/security review.
3. Reviewer C: test-validity review.

Any unresolved High/Critical finding blocks implementation.

## 测试有效性要求

必须写进 PLAN，不要只列 `npm test`。

Valid future tests:

- Unit:
  - task capsule parser
  - graph derivation
  - path traversal rejection
  - token validation
  - command allowlist
  - optional PTY missing

- API integration:
  - server binds `127.0.0.1`, port `0`
  - invalid token rejected
  - task list from fixture
  - settings project/global precedence

- WebSocket:
  - `/ws/events` token auth
  - task update emits event
  - forced close reconnects and refreshes HTTP snapshot
  - `seq` gap forces snapshot reload
  - `/ws/terminal` streams fake PTY
  - watch mode rejects input
  - attach mode accepts input and records event

- Fake PTY:
  - emoji + Chinese + ANSI
  - partial lines
  - output larger than transcript cap
  - no RESULT
  - invalid RESULT
  - timeout
  - non-zero exit

- Playwright:
  - UI opens
  - header shows project identity, language selector, theme toggle, active task
  - routed content changes while footer/status bar remains stable
  - footer/status bar shows connection state, event seq, last sync/error, `@bigonion`, `MIT`
  - task list visible
  - React Flow node/edge visible
  - clicking node opens inspector
  - WebSocket update changes UI
  - terminal drawer displays fake PTY output
  - attach toggle behavior
  - reduced-motion mode disables nonessential Motion transitions
  - screenshot/trace evidence

Build/typecheck/lint are supporting checks only. They are not browser acceptance.

## 交付物

本轮只交付：

- Updated `Harness/tasks/task-wf-ui-control-0729/PLAN.md`
- Updated `Harness/tasks/task-wf-ui-control-0729/PROGRESS.md`
- Updated `Harness/tasks/task-wf-ui-control-0729/STATE.json`
- Optional concise architecture doc if needed, but prefer keeping this phase in task capsule.

不要实现代码。

## 验证

运行：

```bash
node Harness/scripts/task-state.mjs validate --json
git diff --check
```

如果因为 task cap warning 出现，不要自动 archive；只记录提醒。

## 最终输出

返回：

- Architecture decision summary
- Skill-by-phase table
- Browser-local communication contract
- Test validity matrix
- Review findings and whether they block implementation
- Exact next implementation slice
