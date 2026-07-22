# Spark Roadmap: WF-MAX Execution Reliability Repair

## North Star (immutable without user consent)

让 WF-MAX 的 CEO/Manager/Worker 角色链在真实环境（含本项目）端到端**可靠执行**，且角色分离是**实质的**——禁止用 CEO 线程内的 MCP 工具调用（如 `mcp__codex.codex_implement`）冒充独立 Worker。从而补上"旗舰模式从未真正跑通"的 dogfood 缺口。

## Hard Constraint

Worker 执行 = 独立 agent context（native subagent 或 peer CLI 独立进程）。无可用 Worker 时诚实降级或暂停，禁止伪装合规（`PLAN.md:791` 教训）。

## Completed Milestones

### ✅ M1 — Worker 渠道可用性探测 (cycle 1)
- `Harness/scripts/probe-worker-channels.mjs`（零依赖，bounded 15s）+ [CHANNEL-MATRIX.md](CHANNEL-MATRIX.md)
- 颠覆性发现：失败日志前提过时；native subagent 当时可用；根因=渠道选择+无降级链

### ✅ M2 — 诚实降级链 + 独立性分级写入协议 (cycle 2-3)
- WF-MAX.md「Worker Channel Degradation & Independence」章节（降级链 + 独立性分级 + 硬禁 mcp 冒充）
- validator 强制 mcp 冒充检测（task-* scoped，ANTI-PATTERN 例外）；framework-metrics 历史违规标 ANTI-PATTERN
- enforcement 双向验证（task-* 拦 / auto/ 不扫 / pre-push 6/6）

### ✅ M3 — 超时/重试/CLI 预检工程化 (cycle 4, 2026-07-21)
- WF-MAX.md 降级链增 **Step 0（派 Worker 前先跑 probe）** + **Timeout & Retry** 小节（bounded ≤15s + 单次重试 + 300s 教训）
- validator requireText WF-MAX.md 引用 `probe-worker-channels.mjs`（防回归，swap-test 验证）
- 补根 `.harness-version` drift（WF-MAX.md + validator checksum 同步 templates，根==templates）
- REFLECTOR: PASS

## Current Milestone: M4

**Goal**: 自反验证——用修好的 WF-MAX（probe 预检 + native-subagent/peer-CLI 降级链 + 禁 mcp 冒充）**真跑通一个本项目多步任务**，证明 CEO/Manager/Worker 角色链端到端工作、零 mcp 冒充。补上"旗舰模式从未跑通"的 dogfood 缺口。

**Success criteria**:
1. 一个真实 task capsule 用 WF-MAX 模式（CEO + Manager + Worker，D-GATE + dispatch packet）端到端完成
2. 全程 Worker = native subagent / peer-CLI 降级链，**零 `mcp__*.implement` 冒充**（validator 不报警）
3. dispatch ledger + verifier 证据 + reflector PASS 记录在案
4. pre-push 6/6

**Target cycles**: 2-3

## Constraints

- Max deviation from North Star: 50% (per cycle and per milestone)
- Roadmap review: every 10 spark cycles or at milestone completion
- 改动范围：根 `Harness/` + `templates/common/Harness/`（同步）+ validator + `.harness-version` 校验和（根 drift 根因待 M4 修复）。
