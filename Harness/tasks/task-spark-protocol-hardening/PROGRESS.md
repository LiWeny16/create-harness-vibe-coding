# task-spark-protocol-hardening - PROGRESS

## Status

- **Phase**: requirements（待新 session 规划）
- **next**: 新 session 评估 4 改进点优先级 + 决定执行模式（wf-auto-spark 自反 / direct）

## Origin

本次 spark session（M1-M4 修 WF-MAX，North Star 达成）结束后 `/wf-learn` + 用户要求评估 wf-auto-spark 的稳定性 / 效率 / token / flash-delegation。评估结论见 [PLAN.md](PLAN.md)：达成目标但不稳 + 费 token + 过程文件 CEO 写（设计就让 CEO 写，task-scribe 可选未用）。

## Key Context（新 session 必读）

- 本次 spark 5 cycles 实证：M1-M4 全程过程文件由 CEO (opus) Write/Edit，**0 次派 task-scribe** —— 这是 AC-TOKEN/AC-DELEGATION 要修的核心
- `WF-AUTO-SPARK.md:92/164/263` 说 "CEO writes"（设计如此）；`WF-MAX.md:29/88` task-scribe "may"（可选）
- spark search researcher 被 settings-json 过滤吞的 fallback 已实证（CEO WebSearch 可靠）
- 同步教训：改 WF-AUTO-SPARK.md → 同步 templates + validator + `.harness-version`（M2/M3 学的）

## Heartbeat

2026-07-21: 任务创建。源自 spark 自我评估。用户将新开窗口继续。
