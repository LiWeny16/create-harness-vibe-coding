# WF-AUTO-SPARK Cycle Plan (live)

> 历史：2026-07-13 的 WF-AUTO「八角度→自适应」改进已完成（AC-001~005 落地）。本文件现追踪 WF-MAX 可靠性修复（M1-M4）的 per-cycle 计划。

## Cycle 3 — M2 (validator 强制 mcp 冒充检测)
**Spark Source**: 4 (Factory linters: forbid legacy patterns as errors; Agent Behavioral Contracts: 静态验证)

**Change**: validator（根 + templates/common）增 mcp 冒充检测规则——扫 active task capsule 的 PLAN/PROGRESS，forbid `mcp__codex.codex_implement` / `mcp__claude.claude_implement`，除非文件含 `ANTI-PATTERN` 标记。framework-metrics 的 PLAN/PROGRESS 加 ANTI-PATTERN 历史标注（保留反面教材，放行规则）。更新校验和。

**Write Set**:
- `Harness/scripts/validate-harness.mjs`
- `templates/common/Harness/scripts/validate-harness.mjs`
- `Harness/tasks/task-framework-metrics-and-entry-contract/PLAN.md` (加 ANTI-PATTERN 标注)
- `Harness/tasks/task-framework-metrics-and-entry-contract/PROGRESS.md` (加 ANTI-PATTERN 标注，若含工具名)
- `.harness-version` 校验和

**AC**:
- AC-M2-VALIDATOR: validator 含 mcp 冒充检测；framework-metrics 因 ANTI-PATTERN 放行；validator strict pass
- AC-M2-ANTIPATTERN: framework-metrics PLAN/PROGRESS 加 ANTI-PATTERN 标注，历史原文保留
- AC-M2-ENFORCE: 规则真能拦——构造无 ANTI-PATTERN 的 mcp_implement 引用 → validator fail（验证后清理）
- AC-M2-SYNC: 根 + templates validator 一致；校验和更新；pre-push 6/6

**Deviation**: ~10% — 直接 M2
