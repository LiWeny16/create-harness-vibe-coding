# 策略与竞品定位（092）

日期：2026-09-09。依据已核验的 [REFERENCES.md](../REFERENCES.md) 与
[原范围审计](./original-scope-audit-092.md)；本文只补充通俗方向，不替代
AC-01..09、发布门或真实 benchmark。

结论：Harness 的定位是 project-local 的“任务状态 + 多 CLI 派发 + 可恢复
证据 + 可选 UI”组合。现有证据主要是结构和局部测试；省钱、提质、世界一流
都还不是成绩。

## 表1：定位比较

| 对象 | 分工 / 上下文记忆 | CLI / UI | 可借鉴；尚未证明 |
|---|---|---|---|
| [Claude Code 子代理](https://code.claude.com/docs/en/sub-agents) / [teams](https://code.claude.com/docs/en/agent-teams) | 有范围、模型别名/allowlist；teams experimental，队友继承 lead effort；不等于持久记忆质量。 | Claude 原生协作；不证明 Codex/OpenCode/UI 兼容。 | 借鉴显式角色、来源和实验警告；未证明 Claude 有 Luna 网关。 |
| Codex + 自建调度（参考 [OpenAI harness engineering](https://openai.com/index/harness-engineering/)） | Codex 只读 model-list；本项目补 explicit runtime/model/effort、STATE/A2A、重放恢复。 | Codex/Claude/OpenCode 同项目，backend 可不启 UI，UI 可选。 | 借鉴结构化反馈；当前显式选模型，不是自动省钱 router，typed `agent.start/createNode` 仍 legacy。 |
| [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) | MIT；可参考 harness/评估结构。 | 上游形态不等于本地多 CLI/UI。 | 只适配高层思路；未复制代码，未证明 API/性能等价。 |
| [smolagents](https://huggingface.co/docs/smolagents/en/reference/agents) | Apache-2.0；`managed_agents`、`max_steps`、结果检查可作边界，API experimental。 | Python API，不是本项目 CLI/PTY 桥。 | 借鉴步数/结果门；不引入依赖，未证明跨 runtime 质量提升。 |
| 本 Harness | WF 分工/read-write set、有限 task pack、STATE/A2A/peer capsule、能力门、17 个 wf 表面；`wf-learn` 有匹配/反例/停用工具。 | project-local 跨三 runtime；CLI `--no-open` 与 UI attach 分离。 | 结构证据已在；自动经济路由、记忆质量、远程标准 A2A、fresh benchmark 尚未证明。 |

[Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)、
[long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
是原理来源，不是产品竞品；[ScreenSuite](https://huggingface.co/blog/screensuite)
是评估参考，也不是竞品。本项目不借用任何来源分数。

## 表2：优先方向与验收

| 方向 | 为什么 | 指标 / 边界 |
|---|---|---|
| 强主控 + 便宜 worker | 减少无谓 fan-out，不能静默换模型。 | 每次留 runtime/model/effort；自动 router 需风险/成本日志、baseline、回归阈值。 |
| context 新鲜度/压缩 | 工具有了，不代表 parent 状态自动更新。 | `intent.original` 不变；唯一 `nextAction`、owner/evidence；pack ≤8192 bytes；fresh recovery 复验。 |
| memory 匹配/反例淘汰 | 防止一次成功变成伪通用方法。 | scope/top-k/bytes + 证据/反例/反馈；可 supersede/disable；独立 n 场景测 precision/recall，当前未知。 |
| cross-CLI + 可选 UI | 同一任务既能无 UI 跑，也能查看。 | 17 表面镜像；backend 冷启/复用/隔离；候选安装后证明 UI 读同一 task。 |
| 条件联网复用 | 只为能力缺口、新版本/API 变化或重复失败查。 | 日期/版本或 commit、许可/条款、adopt/adapt/reject、反例、重查触发齐全。 |
| 真实 benchmark | fixture 绿不能证明因果收益。 | exact pushed SHA + clean install；B1-B6、baseline、n、holdout、独立 scorer；估算/实测分开，缺测写 `unknown`。 |
| 硬规则 event + gate | 发布/安全条件不能只靠记忆检索。 | 先由用户决定是否进 0.9.2；决定后验事件、门禁、回退和审计证据。 |

诚实边界：当前“显式主控选模型”不等于自动省钱 router；“有记忆工具”不等于
质量已实测；局部绿证据不等于世界一流。候选实现证据与 push 后真实 benchmark
必须分开报告。
