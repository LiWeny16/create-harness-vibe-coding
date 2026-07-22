# PLAN.md - task-spark-protocol-hardening

## Goal

加固 `/wf-auto-spark` 协议：从"能达成目标但**不稳 + 费 token + 过程文件 CEO 写**"改进到"**稳定 + 省 token + 过程文件 delegate 小模型**"。源自本次 spark session（M1-M4 修 WF-MAX）结束后的自我评估。

## 背景（本次 session 评估实证）

wf-auto-spark 达成了 North Star（M1-M4，WF-MAX 真跑通 / 零 mcp 冒充），但三个问题：

1. **不稳**（5 处偏离/补丁）：
   - spark search 设计=read-only subagent；实际 researcher **2 次被 settings-json 过滤吞** → CEO 自搜 WebSearch
   - reflector 设计=独立裁决；实际 **CEO 自判**（未派 reflector subagent）
   - cycle 3 ANTI-PATTERN 规则靠"同行巧合含 ANTI-PATTERN 字面"放行 auto/ → 脆弱，需补丁限定 `task-*`
   - cycle 4 根 `.harness-version` drift（build-version 不同步根）→ 需 CEO 补救
   - scoped skill `templates/common:wf-auto-spark` invoke **Unknown skill** 失败

2. **费 token**：CEO (opus) 写所有过程文件（ROADMAP/PLAN/PROGRESS/CHANNEL-MATRIX）+ spark 搜索 + 独立 verify——本该 delegate small-fast。

3. **过程文件未用 task-scribe (haiku)**：`WF-AUTO-SPARK.md:92/164/263` 设计就说 "CEO writes"，`WF-MAX.md:29/88` 的 task-scribe 是可选（"may"）。**设计本身让 opus 写 markdown = 浪费**——这是设计缺陷，不只执行偏离。

## AC IDs

- **AC-STABLE**: 协议偏离点有明文 fallback（spark 搜索被滤器吞→CEO WebSearch；scoped skill 不可用→unscoped+dispatch；等），不再靠 cycle 内补丁
- **AC-TOKEN**: 过程文件（heartbeat / cycle plan / roadmap 更新）由 task-scribe (haiku) 格式化写，CEO 只给要点；token 对照验证省 opus
- **AC-DELEGATION**: `WF-AUTO-SPARK.md` "CEO writes" → "CEO 给要点 + task-scribe 写"；reflect/reflector 分层（小 cycle CEO 自判，大 cycle 派 reflector subagent）明文
- **AC-EDGE**: 边界防护预置（ANTI-PATTERN 不靠巧合；drift 根因虽已修但要文档化预防）
- **AC-SYNC**: 改动同步根 + templates/common/ + validator requireText + `.harness-version` 校验和（M2/M3 学到的）

## 改进点（优先级待新 session 定）

1. **过程文件 task-scribe 化**（最高价值——省 opus token）：WF-AUTO-SPARK.md capsule 段改"CEO 给要点 → task-scribe (haiku) 格式化写 heartbeat/plan"
2. **spark search fallback 明文**：researcher 被滤器吞 → CEO 直接 WebSearch（实际做了但协议没写）
3. **reflector 分层**：小 cycle CEO 自判，大 cycle 派 reflector subagent
4. **边界防护文档化**：ANTI-PATTERN 不靠字面巧合；drift 根因预防

## Write Set（预估，新 session 细化）

- `Harness/WF-AUTO-SPARK.md` + `templates/common/Harness/WF-AUTO-SPARK.md`
- `Harness/WF-MAX.md` + `templates/common/Harness/WF-MAX.md`（task-scribe 角色/触发明文）
- 可能 `Harness/subagents.md` / `dispatch.md` / `WF-KERNEL.md`
- validator requireText + `.harness-version` 校验和

## Risks

- 改 WF-AUTO-SPARK.md 要同步 templates + validator + 校验和（M2/M3 教训）
- task-scribe delegate 的 token 对比难精确测（需构造 CEO-only vs CEO+task-scribe 对照）
- "CEO 给要点 + task-scribe 写"要定义清楚要点格式，否则 task-scribe 写歪

## 执行模式建议

**wf-auto-spark 自反**（用 spark 改 spark）最贴切，但注意：若用 spark，本任务的过程文件本身要 task-scribe 写（吃自己狗粮——这正好验证 AC-TOKEN）。或 direct 模式更轻。**新 session 决定**。

## Subagent Dispatch

| Wave | Agent | Role | WriteSet |
|------|-------|------|----------|
| W0 | task-scribe (haiku) | 维护本任务过程文件（验证 AC-TOKEN）| task capsule |
| W1 | planner/architect | 改进点细化 + write set 设计 | none |
| W2 | implementer | 改 WF-AUTO-SPARK.md + WF-MAX.md + 同步 | docs |
| W3 | verifier/reviewer | token 对照 + 协议一致性 | none |
