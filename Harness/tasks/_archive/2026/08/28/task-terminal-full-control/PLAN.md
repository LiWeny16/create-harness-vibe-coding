# task-terminal-full-control - PLAN

## Goal

Agent node 全控制权：让 harness 能可靠地驱动真实 agent 终端执行任务。核心问题：send-input 文本能到 TUI 输入框，但回车提交不触发 AI 回合。

## W0 综合结论（源码级证据，2026-08-13）

| 发现 | 来源 |
|------|------|
| 前端/后端输入走同一 sink（ptyProcess.write），Enter 都是 `\r` | ws-terminal.mjs:329, TerminalDrawer.tsx:265-275 |
| 裸 send-input 完全不含回车；submit 模式延迟 800ms fire-and-forget 补 `\r` | server.mjs:2197, 2236-2241 |
| `codex "prompt"`（argv 带任务）**自动提交**，无需任何键盘注入；还会跳过更新弹窗 | codex-rs 源码 tui.rs / input_restore.rs（tag rust-v0.147.0） |
| `codex exec --json` 是官方无界面模式：跑完退出，JSONL 事件流，可 `-o` 取最后消息 | codex exec --help + learn.chatgpt.com 官方文档 |
| codex TUI 启动时 flush 输入缓冲区（早到输入被丢弃）+ 启动弹窗吞回车 + 键盘增强模式 | codex-rs tui.rs:372-404, #12542, #3125, #16306 |
| initialPrompt 后端管道已通（server.mjs:3145→spawnPty→resolveRuntimeLaunchArgs），但 CLI create-agent 没暴露 | W0d |
| resume 参数仅展示用，从未在 spawn 使用 | W0d |
| `[harness-request]` 信封注入含尾部 `\r`，无延迟无就绪门控 | agent-node.mjs:128-138, 397→252 |

## 架构决策

**D-ARCH-1 三层触发模型（全部实现，不二选一）：**

1. **初始任务（Enter-free，首选）**：create-agent / start / restart 接受 `initialPrompt` → spawn 时作为 argv 传给 codex/claude → TUI 自动提交。零键盘注入。
2. **会话中任务（修复回车路径）**：writePromptSubmitInput 就绪门控（等 ❯/› 标记）+ 文本 + 单个 `\r`（绝不发 `\r\n`）+ 验证回合输出 + 失败重试一次。
3. **headless 任务（exec 模式，本任务实现接口，验证后作为 agent 自动派的正式通道）**：`codex exec --json` 每任务一进程，JSONL 输出捕获，退出语义。

**D-ARCH-2 前端终端**：与后端同 sink，修复在 writePtyInput 层一次性解决两侧。前端交互打字路径保留（逐键 \r 本身正确），需 live probe 确认 conpty 下 Enter 语义。

**D-ARCH-3 范围**：exec 模式完整产品化（结果进信箱、canvas 可见）留作后续；本任务做：initialPrompt 全链路 + 回车修复 + exec 基础接口 + 测试。

## Write Sets（disjoint）

| Wave | Worker | Write set |
|------|--------|-----------|
| W2-I1 | implementer | `src/wf-ui-server/server.mjs`（writePromptSubmitInput 就绪门控+单\r+重试；initialPrompt 传递确认/补洞；initialInput 注入同步门控） |
| W2-I2 | implementer | `Harness/scripts/wf-ui-control.mjs`（create-agent --initial-prompt 标志；--initial-prompt 文档；help 文本） |
| W2-I3 | test-writer | `src/wf-ui-server/__tests__/workflow-terminal-control.test.mjs`（NEW：字节序列、就绪门控、initialPrompt 传递、重试语义）+ 真实终端探针测试（opt-in env，bounded） |
| W2-I4 | implementer | `Harness/research/research-results.md`（codex exec vs TUI 发现）+ `Harness/project/architecture.md`（PTY 触发模型段落） |

## Verification

- 新测试：`node --test src/wf-ui-server/__tests__/workflow-terminal-control.test.mjs`
- 回归：43 acceptance + 12 CLI smoke + 25 matrix + 26 session-registry + 13 a2a-store
- 真实终端证据（AC-CTRL-005）：live probe — codex argv-prompt 自动提交验证（真实 API 调用一次，bounded）
- E2E：`npx playwright test e2e/wf-ui-m8-subagent-settings.spec.ts`（不回归）

## Risks

| Risk | Mitigation |
|------|------------|
| conpty Enter 语义仍需 live 确认 | 探针测试用 argv 路径验证（不依赖 Enter），Enter 路径测试断言字节序列 + 真实 probe 一次 |
| 真实 AI 回合花费 API 额度且慢 | 探针测试 opt-in（env HARNESS_LIVE_TERMINAL_PROBE=1），CI 默认跳过 |
| codex TUI 就绪标记变化 | 就绪检测复用已有 ❯/› 检测器 + 超时兜底 |
