# WF-AUTO Progress

## Status: COMPLETED — North Star reached (user stop, 2026-07-21) — WF-MAX Reliability Repair

- **Mode**: wf-auto-spark
- **Started**: 2026-07-21
- **North Star**: WF-MAX 角色链实质分离、可靠端到端执行；禁 MCP 冒充 Worker。
- **Current Milestone**: M2 — 诚实降级链 + 独立性分级写入协议
- **Completed**: M1 (cycle 1)
- **Roadmap**: [SPARK-ROADMAP.md](SPARK-ROADMAP.md)
- **Channel matrix**: [CHANNEL-MATRIX.md](CHANNEL-MATRIX.md) (historical snapshot; current checks use `wf-agents-docs` evidence packets)
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
**Change**: CHANNEL-MATRIX.md historical snapshot; later simplified by removing the ad hoc probe script and using `wf-agents-docs` evidence packets
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

### Cycle 4 — M3 (probe 预检协议化 + timeout/retry) ✅ PASS (2026-07-21)
**Milestone**: M3 — 超时/重试/CLI 预检工程化
**Spark Source**: 2+3 (graceful degradation retry+backoff；M1 probe 已覆盖 bounded 超时)
**Change**: WF-MAX.md（根 + templates）降级链增 **Step 0 capability evidence** + **Timeout & Retry** 小节（bounded command timeout + 单次重试 + 300s 教训）+ validator requireText WF-MAX.md 引用 no-scratch/evidence-packet rule（防回归）+ 补根 `.harness-version` drift
**Deviation**: ~10%
**Implementer**: native subagent（未用 mcp 冒充）+ CEO 补根 checksum drift
**AC**: AC-M3-PROBE-STEP / RETRY / REQUIRETEXT / SYNC 全 PASS（含 swap-test anti-regression 验证）
**独立 verify（CEO）**: validator strict 根+templates pass；Step 0 (:48) + Timeout&Retry (:58-60) 实存；根 .harness-version drift 实锤（根 lag cycle 2/3 值）→ 补根 checksum（根==templates：WF-MAX.md e2c17e31 / validator 19f480e1）
**Reflector**: PASS

#### Value Reflection
- Why: probe 从"可选提及"升为降级链 Step 0（派 Worker 前必跑）+ timeout/retry 协议化 + 防回归 requireText。WF-MAX 现在机械强制"基于事实降级 + 永不挂死"。
- Without: probe 仍可选，CEO 可能跳过预检凭假设派 Worker（重蹈 framework-metrics 覆辙）。
- User would notice: WF-MAX 派 Worker 前先出 probe 矩阵；卡死不再可能（bounded + retry + descent）。
- Milestone: M3 100% → M4。
- Cumulative deviation (10-cycle): ~10% (cycle 4)。

#### 待修（M4 候选根因）
根 `.harness-version` drift 的根因：`npm run build:version` 只写 templates，根要手动补 checksum。cycle 2/3 implementer 手动补，cycle 4 漏补（CEO 补救）。M4 可用 WF-MAX 跑"让 build:version 同步根 + pre-push 加根 drift 检查"——自反验证 + 修维护链。

### Cycle 5 — M4 (WF-MAX 自反验证: drift 根因) ✅ PASS (2026-07-21)
**Milestone**: M4 — 自反验证
**Mode**: WF-MAX (WF-Max-Useful) within spark cycle 5
**Change**: W1 `build-version.mjs` 同步根 checksums（防未来 drift）+ W2 `check-root-harness-version.mjs` + pre-push 第 7 项 drift 检查 + W-fix check-root 跳过 acceptedConflicts（含镜像推导）+ `tests/check-harness-version.test.js`（4 测试）
**Workers**: W1/W2/W-fix 全 native subagent（W1+W2 并行 wave 1 disjoint writeSets，W-fix wave 2）+ CEO D-GATE + verify + reviewer cross-review。**零 mcp 冒充。**
**Deviation**: ~5%（直接 M4 + North Star）
**AC**: W1-SYNC/PRESERVE/CHECK + W2-DETECT/PRE-PUSH/CLEAN/NODEPS + WFIX-SKIP/PRE-PUSH/TEST/NOREGRESS 全 PASS
**独立 verify（CEO）**: check-root PASS（123 file, 2 accepted-local skipped）+ pre-push 7/7 + npm test 102（含新 4）
**Cross-review（reviewer）**: APPROVE-WITH-NON-BLOCKING-NOTES（5 findings 全 low/none；**North Star zero-mcp PASS**；镜像规则匹配 generator；sha256 byte-identical generator）
**Reflector**: PASS

#### Value Reflection
- Why: 用 WF-MAX 真跑通一个本项目多步任务（drift 根因修复），证明 CEO/Worker 角色链端到端工作、零 mcp 冒充。**补上"旗舰模式从未跑通"的 dogfood 缺口——North Star 达成。**
- Without: WF-MAX 协议改了（M1-M3）但从未在本项目真跑过，仍是纸上。
- User would notice: drift 根因修复（build-version 同步根 + pre-push 7/7 drift 检测 + acceptedConflicts 不误报）；WF-MAX 不再是空中楼阁。
- Milestone: M4 100%。**Roadmap M1-M4 全完成，North Star 达成。**
- Cumulative deviation (10-cycle): ~8%（5 cycles）。

#### North Star 达成证据
WF-MAX 角色链本项目端到端跑通（cycle 5：CEO + 3 Worker + D-GATE + verify + cross-review + reflector）；角色分离实质（全 native subagent，零 mcp 冒充，reviewer 确认）；dogfood 缺口补上；framework-metrics:791 失败根因被多重建制消化（probe 事实 + 降级链协议 + validator 强制禁冒充 + timeout/retry 防挂死）。
