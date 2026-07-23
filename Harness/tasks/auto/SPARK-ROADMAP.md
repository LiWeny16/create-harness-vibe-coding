# Spark Roadmap: WF-MAX Execution Reliability Repair

## North Star (达成 ✅ 2026-07-21)

让 WF-MAX 的 CEO/Manager/Worker 角色链在真实环境（含本项目）端到端**可靠执行**，且角色分离是**实质的**——禁止用 CEO 线程内的 MCP 工具调用冒充独立 Worker。补上"旗舰模式从未真正跑通"的 dogfood 缺口。

## Hard Constraint

Worker 执行 = 独立 agent context（native subagent 或 peer CLI 独立进程）。无可用 Worker 时诚实降级或暂停，禁止伪装合规（`PLAN.md:791` 教训）。

## Completed Milestones（全部 ✅）

### ✅ M1 — Worker 渠道可用性探测 (cycle 1)
- `wf-agents-docs` evidence-packet/no-scratch peer-CLI method + [CHANNEL-MATRIX.md](CHANNEL-MATRIX.md) historical snapshot
- 颠覆性发现：失败日志前提过时；native subagent 当时可用；根因=渠道选择+无降级链

### ✅ M2 — 诚实降级链 + 独立性分级写入协议 (cycle 2-3)
- WF-MAX.md「Worker Channel Degradation & Independence」章节（降级链 + 独立性分级 + 硬禁 mcp 冒充）
- validator 强制 mcp 冒充检测（task-* scoped，ANTI-PATTERN 例外）；framework-metrics 历史违规标 ANTI-PATTERN
- enforcement 双向验证（task-* 拦 / auto/ 不扫 / pre-push pass）

### ✅ M3 — 超时/重试/CLI 预检工程化 (cycle 4)
- WF-MAX.md 降级链增 Step 0（派 Worker 前先跑 probe）+ Timeout & Retry 小节（bounded ≤15s + 单次重试 + 300s 教训）
- validator requireText WF-MAX.md 引用 probe（防回归，swap-test 验证）
- 补根 `.harness-version` drift

### ✅ M4 — 自反验证 (cycle 5, WF-MAX 真跑通)
- 用 WF-MAX（WF-Max-Useful）真跑通 drift 根因修复：CEO + 3 native subagent Worker（W1/W2 并行 wave 1，W-fix wave 2）+ D-GATE + disjoint writeSets + verify + reviewer cross-review
- W1: `build-version.mjs` 同步根 checksums（防未来 drift）
- W2: `check-root-harness-version.mjs` + pre-push 第 7 项 drift 检查（检测 drift）
- W-fix: check-root 跳过 acceptedConflicts（含镜像推导）+ `tests/check-harness-version.test.js`（4 测试）
- **全程零 `mcp__*.implement` 冒充**（reviewer North Star check PASS）
- pre-push 7/7；reviewer APPROVE-WITH-NON-BLOCKING-NOTES

## North Star 达成证据
1. WF-MAX 角色链在本项目端到端跑通（cycle 5：CEO + 3 Worker + D-GATE + verify + cross-review + reflector）✓
2. 角色分离实质（全 native subagent，零 mcp 冒充，reviewer 确认）✓
3. dogfood 缺口补上（WF-MAX 从"从未跑通"→"本周期跑通一个真实多步任务"）✓
4. 失败根因（framework-metrics:791）被多重建制消化：probe 事实 + 降级链协议 + validator 强制禁冒充 + timeout/retry 防挂死 ✓

## Constraints（历史）
- Max deviation: 50%；cumulative 实际 ~8%（5 cycles）
- 改动范围：根 `Harness/` + `templates/common/` + scripts + validator + `.harness-version`

## Session 状态
- 5 cycles，4 milestones，全程 native subagent Worker（W1-Wfix）+ read-only researcher（spark）/ reviewer（cross-review）
- 零 mcp-as-Worker 事件
- 待用户决定：提交 M4 + spark 收尾 / 开新 roadmap
