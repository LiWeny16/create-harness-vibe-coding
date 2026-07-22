# WF-AUTO Progress

## Status: ACTIVE — WF-MAX Reliability Repair

- **Mode**: wf-auto-spark
- **Started**: 2026-07-21
- **North Star**: WF-MAX 角色链实质分离、可靠端到端执行；禁 MCP 冒充 Worker。
- **Current Milestone**: M2 — 诚实降级链 + 独立性分级写入协议
- **Completed**: M1 (cycle 1)
- **Roadmap**: [SPARK-ROADMAP.md](SPARK-ROADMAP.md)
- **Channel matrix**: [CHANNEL-MATRIX.md](CHANNEL-MATRIX.md)
- **Root-cause evidence**: `tasks/task-framework-metrics-and-entry-contract/PLAN.md:784-791` (failure count 4)

## Protocol Update — 2026-07-13

- Replaced the fixed eight-angle assumption with adaptive probe selection.
- Added dynamic risk obligations, scan-strategy rotation, confidence and
  surface-coverage evidence, and common probe recipes.
- Updated root/template WF-AUTO docs, Skills, validators, and command routing.

## Cycle Log

### Cycle 1 — M1 ✅ PASS (2026-07-21)
**Milestone**: M1 — Worker 渠道可用性探测
**Spark Source**: 3 (CLI detection) + 6 (governance) + 4 (VMAO, Agents SDK)
**Change**: `Harness/scripts/probe-worker-channels.mjs`（~210 行，零依赖，bounded 15s）+ CHANNEL-MATRIX.md
**Deviation**: ~10%
**Implementer**: native subagent（未用 mcp 冒充）
**AC**: AC-M1-PROBE/MATRIX/TIMEOUT/INDEPENDENCE 全 PASS（CEO 独立重跑确认）
**Reflector**: PASS

#### Value Reflection
- Why: 给 WF-MAX 渠道真实可用性 + 独立性等级的事实基础；首次让 mcp 的 inprocess 本质可检测。
- Without: 修复会基于过时假设，或重蹈 mcp 冒充覆辙。
- User would notice: M2 降级链基于这份矩阵。
- Milestone: M1 100% → M2。
- Cumulative deviation (10-cycle): cycle 1, ~10%。

#### 颠覆性发现（影响 M2-M4）
失败日志"渠道全挂"叙事不成立：native subagent 当时就可用，claude/codex 今天可用（<1s）。根因 = 渠道选择错误 + 无降级链。M2 锚定"降级链 + 禁冒充"，M3 从"救火"降为"防回归"。

### Cycle 2 — M2 (协议降级链) ✅ PASS (2026-07-21)
**Milestone**: M2 — 诚实降级链 + 独立性分级写入协议
**Spark Source**: 3 (graceful degradation: Zylos/BuildMVPFast/AWS REL05-BP01) + 4 (Factory linters, Agent Behavioral Contracts DbC)
**Change**: WF-MAX.md（根 + templates/common/，byte-identical）新增「Worker Channel Degradation & Independence」章节（降级链 native-subagent→claude→codex→诚实暂停 + 独立性分级表 + 硬禁 mcp 冒充 + 引用 PLAN.md:791）+ `.harness-version` 校验和（hash `a125dddc→83374f5e`）
**Deviation**: ~10%
**Implementer**: native subagent（未用 mcp 冒充）
**AC**: AC-M2-DEGRADATION / INDEPENDENCE / SYNC 全 PASS（CEO 独立重跑 validator strict 根+templates pass + grep 确认章节实存 :32/:42/:51/:55）
**Reflector**: PASS

#### Value Reflection
- Why: 把"诚实降级 + 禁冒充"从口头原则变成协议明文，WF-MAX.md 强制 degrade-on-facts + 禁 in-process 冒充。
- Without: 协议仍默许"无渠道时用 mcp 冒充"。
- User would notice: WF-MAX 卡住时诚实暂停而非伪装。
- Milestone: M2 100%（文档 + validator 强制全 done）→ M3。
- Cumulative deviation (10-cycle): ~10% (cycle 2)。

### Cycle 3 — M2 (validator 强制 mcp 冒充检测) ✅ PASS (2026-07-21)
**Milestone**: M2 — validator 强制 + 历史标注
**Spark Source**: 4 (Factory linters forbid legacy patterns; Agent Behavioral Contracts DbC)
**Change**: validator（根 + templates）增 mcp 冒充检测规则（扫 `task-*` capsule PLAN/PROGRESS，forbid `mcp__codex.codex_implement`/`mcp__claude.claude_implement`，除非 `ANTI-PATTERN`）+ framework-metrics PLAN.md 加 ANTI-PATTERN 历史标注（保留反面教材）+ 补丁（规则限定 `task-` 前缀，排除 auto/ session 元文档，移除脆弱巧合）+ 校验和
**Deviation**: ~10%
**Implementer**: native subagent ×2（cycle 3 + 补丁，均未用 mcp 冒充）
**AC**: AC-M2-VALIDATOR / ANTI-PATTERN / ENFORCE / SCOPE-A / SCOPE-B / SYNC 全 PASS
**独立 verify（CEO）**: validator strict 根+templates pass；enforcement 复现（临时无标记 mcp_implement → fail → revert → pass）；规则实存（validator:332/334/339）；stray 文件已清；auto/PLAN restore 干净
**Reflector**: PASS

#### Value Reflection
- Why: validator 现在机械强制"禁 mcp 冒充 Worker"——未来任何 task-* capsule 记录 `mcp__*.implement` 作为执行都会被 pre-push 拦截。North Star 硬约束从口头变成 CI 门。
- Without: 协议写了禁冒充但无强制，可能再次发生 framework-metrics 式的伪装合规。
- User would notice: 提交时若 capsule 含 mcp 冒充记录，pre-push 直接 fail。
- Milestone: M2 100% → M3。
- Cumulative deviation (10-cycle): ~10% (cycle 3)。

#### 待用户决定（非 spark 范围）
`docs/index.html` 有 81+/49- 的 3D 视觉打磨改动（材质 depthWrite + 新 payload 几何），不在任何 spark Worker write set，判断为用户并行手动打磨。未碰，待用户确认保留/revert。
