# Runtime review 092 (independent verifier)

结论：当前 runtime 不能宣称 GREEN。独立 dispatch 负测 14 项中 10 项通过、4 项 RED；其中两项是 HIGH（无绑定即可伪造 terminal result、worker 未获得可信 dispatchId），另有 ACK correlation 与 unknown-model capability 的可复现问题。

## 复现命令与结果

| 命令 | 结果 |
|---|---|
| `node --test src/wf-ui-server/__tests__/runtime-review.test.mjs` | 14 tests，10 PASS / 4 RED（见下） |
| `node --test src/wf-ui-server/__tests__/action-registry-loader.test.mjs src/wf-ui-server/__tests__/workflow-action-registry.test.mjs` | 20/20 PASS；固定断言 87，显式断言 `agent.dispatchProgress`、`agent.dispatchResult` |
| `node --test tests/wf-backend-ensure.test.js tests/runtime-review-backend.test.js` | 4/4 PASS；cold start、同项目并发锁、不同项目隔离、symlink alias 均通过 |
| `npm pack --dry-run --json`（静态包核验） | 7,875,685 bytes / 712 files；含 `src/wf-ui-server/server.mjs`、`pty-adapter.mjs`、`templates/common/Harness/scripts/wf-ui-control.mjs`，归档条目无绝对路径 |
| `node --check tests/runtime-review-backend.test.js; node --check src/wf-ui-server/__tests__/runtime-review.test.mjs` | PASS |

没有运行真实发布后 benchmark，也没有杀全局进程；测试创建的 fixture/backend 只按返回 PID 和已验证的 fixture 路径清理。

## Findings

### HIGH — 未绑定 caller 可以把 dispatch 伪造成 succeeded

- 复现：独立用例 `src/wf-ui-server/__tests__/runtime-review.test.mjs:445-453` 创建 PTY dispatch 后，向 `POST /api/dispatches/dispatch-review-forged-result/result` 只提交 `{taskId,status:"succeeded",result:{claimedBy:"unbound-caller"}}`，不提供 `sessionId`、worker token 或 actor header。
- 实际：HTTP 201，`status: "succeeded"`，并将该 result 写入 session/peer capsule；期望是 401/403/409。该 RED 在上面的完整命令稳定复现。
- 代码边界：route `src/wf-ui-server/server.mjs:2110-2118` 直接调用 `recordDispatchReport`；`dispatchReportSession` (`:4338-4357`) 在没有 sessionId 时选 dispatch 的候选 session；`recordDispatchReport` (`:4376`, `:4423-4459`) 接受 caller 提供的 terminal status/result，没有 worker 身份或执行证明校验。
- 影响：知道 dispatchId/taskId 的任意本地/项目内 caller 可以提前结束真实 PTY，并让状态看起来像已执行成功；这不满足“progress/result 必须来自实际执行证据”和 ACK/RESULT binding。
- 最小修复 claim：terminal report 必须带由服务注入并绑定到该 session/attempt 的一次性 worker capability（至少 sessionId + 不可伪造 token/nonce，并校验 actor）；result 需包含可核验的 worker-owned evidence（例如服务记录的执行事件/产物摘要），不能把用户提交的 `status` 单独当验收事实。无证明只能 `failed`/拒绝，不能 `succeeded`。

### HIGH — canonical dispatchId 没有传给 PTY worker

- 复现：用例 `src/wf-ui-server/__tests__/runtime-review.test.mjs:269-276` POST `dispatchId: dispatch-review-worker-identity`，检查 fixture 收到的 `spawnPty` options；实际 `options.dispatchId === undefined`，测试 RED。
- 代码：`server.mjs:4936-4957` 的 `spawnPty({...})` 参数没有 `dispatchId`；`pty-adapter.mjs:477-504` 的 `spawnPty` 签名也没有它；其环境构造 (`pty-adapter.mjs:554-567` → `harness-env.mjs:4-39`) 只注入 task/peer/session，没有 `HARNESS_DISPATCH_ID`；init identity (`server.mjs:4054-4082`) 同样没有 dispatch identity。worker 因而只能自行手填 `--dispatch-id`；CLI `Harness/scripts/wf-ui-control.mjs:976-1000` 明确把手工 flag/env 当来源。
- 影响：PTY 无参 worker 不能从可信服务注入身份报告 progress/result；dispatchId 可错配、漏报或被 caller 伪造，直接削弱 idempotency 和 terminal binding。
- 最小修复 claim：从 `createRuntimeSession` 一路传递 dispatchId 到 PTY/chat spawn，并注入 `HARNESS_DISPATCH_ID`/init identity；report endpoint 只接受与服务注入身份和当前 attempt 匹配的 capability。不要依赖用户命令行参数。

### MEDIUM — 初始 ACK 丢失 requestId/replyTo

- 复现：用例 `runtime-review.test.mjs:278-295` 提交 `requestId: request-review-1`、`replyTo: request-review-parent`，检查 task-bound peer capsule 的 `dispatch.ack`；实际两字段均为 `undefined`，测试 RED。
- 代码：`server.mjs:4489-4503` 的 `ensureDispatchCapsule` 将完整 payload 写入 REQUEST，但 ACK 事件只写 `status/requested/effective`，没有 requestId/replyTo。后续 result envelope (`:4296-4315`, `:4423-4459`) 才会读取 caller payload。
- 影响：父 caller 无法仅凭 ACK 做可靠 correlation，违背 CONTRACTS 的“requestId/replyTo preserved through ACK and RESULT”。
- 最小修复 claim：ACK 从 canonical normalized request/session 复制 requestId/replyTo（并保留 dispatchId/sessionId/attempt），不能等待 worker 再补。

### MEDIUM — 任意 unknown model 没有 capability preflight

- 复现：`runtime-review.test.mjs:184-199` 提交 `model: gpt-9-model-does-not-exist-092`；实际 HTTP 201 并启动 session，期望是明确 422 `UNSUPPORTED`。显式 sentinel `unsupported-model-092`、非法 runtime、非法 transport 则通过，说明当前逻辑只是字符串 sentinel 检查。
- 代码：`src/wf-ui-server/dispatch-contract.mjs:67-74` 仅要求非空 model，并拒绝 `/^(unsupported|unknown|invalid)/`；没有 runtime capability/model catalog 查询。
- 影响：不支持模型会先创建 PTY，失败被延迟到 provider，且“effective”仍声称该模型；不满足“unsupported model/capability 明确失败、不静默替代”。
- 最小修复 claim：按 runtime capability registry 做显式 model allowlist/handshake；未知模型在 spawn 前返回 422 `UNSUPPORTED`，并保留 requested/effective 一致性。

### LOW — 原 lifecycle smoke test 的事件断言读错目录

- `src/wf-ui-server/__tests__/dispatch-lifecycle.test.mjs:83-87` 固定读 `Harness/a2a/sessions/<id>`；task-bound dispatch 实际由 `src/wf-ui-server/terminal-store.mjs:17-27` 写入 `Harness/tasks/<taskId>/sessions/<id>`。
- 因而该文件的 `:228-235`、`:279-291` 事件比较可能在空数组上通过，不能证明 terminal event/duplicate cancel 的实际结果。独立 review test 改用 task-bound 路径并重新验证：context consumption、duplicate result/cancel、restart downgrade、PTY exit、retry 均通过。
- 最小修复 claim：把 smoke helper 按 session.taskId 解析 canonical sessionDir，且断言至少一个真实事件/terminal capsule，而不是动态迎合空目录。

## 通过项 / 剩余风险

- 同 `projectRoot + taskId + dispatchId` 并发相同 payload：一 session、一 PTY；payload 变化返回 `409 DISPATCH_CONFLICT`。
- taskId/context lexical traversal 和 context pack realpath symlink escape：spawn 前拒绝；项目内 context pack 的 sentinel 确实进入 worker `initialPrompt`。
- PTY exit code 0 仍落为 `failed` transport；restart 无 live handle 落为 `interrupted` 且 replay 不重跑；显式 retry 只产生一次新 attempt；重复 result/cancel 各只写一个 terminal capsule event。
- backend ensure：no-browser、同项目 lock/concurrency、不同项目不复用、同物理项目 symlink alias 复用均通过。
- `npm pack --dry-run` 的静态边界通过，runtime/template 可打包且无归档绝对开发路径；`rg` 仅命中 `claude-transcript-materializer.mjs:125` 的 Windows 编码注释，不是硬编码路径。未执行真实 publish/install benchmark，故仍保留真实安装环境、真实 provider 认证/能力、跨主机路径差异的风险。

本 review 的新增/调整仅限 runtime tests、registry test 的显式 87/action 断言、backend alias test 和本 evidence 文件；未修改 production、canonical task state/plan/progress、版本/git 或真实 A2A user state。
