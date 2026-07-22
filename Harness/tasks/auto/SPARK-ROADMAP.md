# Spark Roadmap: WF-MAX Execution Reliability Repair

## North Star (immutable without user consent)

让 WF-MAX 的 CEO/Manager/Worker 角色链在真实环境（含本项目）端到端**可靠执行**，且角色分离是**实质的**——禁止用 CEO 线程内的 MCP 工具调用（如 `mcp__codex.codex_implement`）冒充独立 Worker。从而补上"旗舰模式从未真正跑通"的 dogfood 缺口。

## Hard Constraint (derived from failure log)

`PLAN.md:791` 把 *"To preserve the CEO no-source-edit invariant"* 用于为 CEO 调用 `mcp__codex.codex_implement` 辩护——伪装合规。**硬约束**：Worker 执行 = 独立 agent context（native subagent 或 peer CLI 独立进程）。无可用 Worker 时诚实降级或暂停，禁止伪装合规。

## Root-Cause Evidence

- `tasks/task-framework-metrics-and-entry-contract/PLAN.md:784-791`（Worker 渠道选择错误 + mcp 冒充自述，已标 ANTI-PATTERN）
- `tasks/task-framework-metrics-and-entry-contract/PROGRESS.md`（failure count 4, blocked）
- M1 实证（[CHANNEL-MATRIX.md](CHANNEL-MATRIX.md)）：根因 = 渠道选择错误 + 无降级链（非"渠道全挂"）。

## Completed Milestones

### ✅ M1 — Worker 渠道可用性探测 (cycle 1, 2026-07-21)
- 产出：`Harness/scripts/probe-worker-channels.mjs`（零依赖，bounded 15s）+ [CHANNEL-MATRIX.md](CHANNEL-MATRIX.md)
- 5 渠道矩阵 + 独立性等级（mcp=inprocess 永不冒充）
- 颠覆性发现：失败日志前提过时；native subagent 当时可用；根因=渠道选择+无降级链
- REFLECTOR: PASS

### ✅ M2 — 诚实降级链 + 独立性分级写入协议 (cycle 2-3, 2026-07-21)
- **cycle 2**：WF-MAX.md（根 + templates，byte-identical）新增「Worker Channel Degradation & Independence」章节（降级链 native-subagent→claude→codex→诚实暂停 + 独立性分级表 + 硬禁 mcp 冒充 + 引用 PLAN.md:791）
- **cycle 3**：validator（根 + templates）增 mcp 冒充检测规则——扫 `task-*` capsule 的 PLAN/PROGRESS，forbid `mcp__codex.codex_implement`/`mcp__claude.claude_implement`，除非 `ANTI-PATTERN` 标记；framework-metrics 历史违规标 ANTI-PATTERN（保留反面教材）
- **补丁**：规则限定 `task-` 前缀，排除 `auto/` session 元文档（移除脆弱巧合）
- enforcement 双向验证：task-* 无标记引用被拦 ✓ / auto/ 不被扫 ✓ / framework-metrics ANTI-PATTERN 放行 ✓ / pre-push 6/6
- REFLECTOR: PASS

## Current Milestone: M3

**Goal**: 超时/重试/CLI 预检工程化（M1 后已降级为"防回归"——probe 脚本已覆盖 bounded 超时 + exists 预检 + 清晰 detail）。

**Success criteria**:
1. WF-MAX.md 的降级链章节增"派 Worker 前先跑 probe 预检"步骤（引用 `probe-worker-channels.mjs`），让预检成为协议一等公民而非可选。
2. 可配置超时/重试的协议说明（瞬态失败一次重试，然后降级；不靠 300s 挂死）。
3. validator 增 requireText：WF-MAX.md 必须引用 probe-worker-channels.mjs（防回归）。

**Target cycles**: 1（M1 probe + M2 降级链已覆盖大部分，M3 主要是协议整合）

## Upcoming Milestones

| # | Goal | Success Criteria | Est. Cycles | Dependencies |
|---|------|-----------------|-------------|--------------|
| M4 | 自反性验证 | 用修好的 WF-MAX（probe 预检 + native-subagent/peer-CLI 降级链）真跑通一个本项目多步任务，角色契约零绕过，端到端证据 | 2-3 | M2, M3 |

## Constraints

- Max deviation from North Star: 50% (per cycle and per milestone)
- Roadmap review: every 10 spark cycles or at milestone completion
- Milestones can be reordered / split / merged / replaced (≤50% deviation)
- North Star change requires explicit user confirmation
- 改动范围：根 `Harness/` + `templates/common/Harness/`（同步）+ validator + `.harness-version` 校验和。
