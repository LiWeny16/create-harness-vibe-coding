# Worker Channel Matrix — M1 产出

**Probed**: 2026-07-21 (node v24.18.0, win32)
**Probe script**: [`Harness/scripts/probe-worker-channels.mjs`](../../scripts/probe-worker-channels.mjs)
**Re-run anytime**: `node Harness/scripts/probe-worker-channels.mjs [--json]`

## Matrix

| channel | type | available | timeout | independence | detail |
|---|---|---|---|---|---|
| claude | peer-cli | **available** | ~600-780ms | independent | 2.1.215 (Claude Code) |
| codex | peer-cli | **available** | ~650ms | independent | codex-cli 0.144.6 |
| opencode | peer-cli | unavailable-missing | 0ms | independent | not on PATH |
| native-subagent | native-subagent | **available** (controller-evidence) | — | independent | Agent-tool dispatch 成功（implementer Worker 本周期返回 = 活证据）|
| mcp | mcp | static-label | — | **inprocess** | CEO 线程内工具调用，**永不计为 Worker 执行** |

## 关键解读（直接影响 M2-M4）

1. **失败日志前提已过时**：2026-07-01 时 claude "not installed"、codex 超时 300s；今天 claude+codex 都装且响应 <1s，300s 挂死不复现。
2. **native subagent 当时就可用的活证据**——framework-metrics 失败时 CEO 本可用 native subagent（Agent 工具），却去试 `mcp__codex/claude` 然后冒充 Worker。**根因是「渠道选择错误 + 无降级链」，不是「渠道全挂」**。这把 M2-M3 的工作重心从"修超时"调整为"建降级链 + 禁冒充"。
3. **当前环境可用的独立 Worker 渠道**：native-subagent（首选）、claude peer-cli、codex peer-cli。opencode 缺失，降级链应跳过。
4. **mcp 永远 inprocess**——North Star 硬约束首次以可检测形式落地：任何"用 `mcp__codex.codex_implement` 当 Worker"的记录都应被 validator 拒绝（M2 落地）。
5. **超时已自愈**：`--version` 探测 bounded 15s 内（实测 <1s）。M3 的超时工程化从"救火"降级为"防回归"。

## 给 M2 的降级链草案（基于此矩阵）

```
native-subagent (Agent 工具，首选，独立 context)
  → 不可用时降级 → claude peer-cli (独立进程)
  → 不可用时降级 → codex peer-cli (独立进程)
  → 全部不可用 → 诚实暂停 + 问用户（禁止用 mcp 冒充）
```
