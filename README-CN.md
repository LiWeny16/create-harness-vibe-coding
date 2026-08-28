<p align="center">
  <img src="https://img.shields.io/npm/v/create-harness-vibe-coding?color=blue" alt="npm version">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js >= 18">
  <img src="https://img.shields.io/npm/l/create-harness-vibe-coding" alt="MIT license">
  <img src="https://img.shields.io/github/stars/LiWeny16/create-harness-vibe-coding?style=social" alt="GitHub stars">
</p>

<p align="center">
  <img src="docs/images/harness-icon.png" alt="Harness 图标" width="112">
</p>

<h1 align="center">create-harness-vibe-coding</h1>
<p align="center">
  <b>给 AI coding agent 一个仓库内的执行契约。</b><br>
  <sub>支持 Claude Code、Codex 和 OpenCode</sub>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="https://github.com/LiWeny16/create-harness-vibe-coding">GitHub</a> |
  <a href="https://www.npmjs.com/package/create-harness-vibe-coding">npm</a>
</p>

## 这是什么？

`create-harness-vibe-coding` 是一个 Node.js CLI。它在仓库里生成 Harness：一套给 AI coding agent 使用的工作契约，覆盖目标、上下文、写入边界、验证、任务状态和长期记忆。

它不是模型、不是 prompt 集，也不会生成业务代码。它解决的是工程流程问题：agent 在长任务里容易忘记上下文、扩大改动范围、跳过验证，或者中断后重新扫描仓库。

## 当前实测

0.8.16 这版只写已经跑出来的数据：

- HarnessBench v0.2 本地生命周期 benchmark：每个模式 15 轮。直接写文件 baseline 安全完成 3/15；Harness safe path 安全完成 15/15。
- 受保护文件覆盖次数：baseline 21 次；Harness safe path 0 次。
- Claude Code L2 prompt-cache 样本：`harness-thin` warm median cache read 为 `98.7%`，比 provider-control 高 `+5.4` 个百分点；`/wf` wf-light 为 `99.1%`，高 `+5.8` 个百分点。
- 启动和更新链路：正常会话保持 thin startup，`Harness/specs/guides/SETUP.md` 只作为安装、迁移、升级参考；`/wf-update` 要汇报 `agent.releaseHighlights` 和验证结果。

完整的模型任务成功率 A/B 还没有发布。要对外说“模型解题成功率提升”，必须用同一个模型、同一个 fixture、同一个 prompt、同一个预算和同一套验证命令跑完 raw logs。

## 一句话安装

把下面这句话交给当前正在使用的 Agent：

> 请根据 https://github.com/LiWeny16/create-harness-vibe-coding/blob/main/README-CN.md 安装 Harness 框架。

## 安装说明（Agent instruction）

Agent 读取本 README 后，按项目状态选择路径：

| 项目状态 | Agent 执行 |
|---|---|
| 新项目 | `npx create-harness-vibe-coding@latest my-project -y` |
| 已有项目 | `npx create-harness-vibe-coding@latest my-project . -y --on-conflict skip --json` |
| 已有 `Harness/` 且存在 `Harness/scripts/wf-update-check.mjs` | `node Harness/scripts/wf-update-check.mjs --json`，走更新流程，不要重复安装；apply/finalize 后汇报 `agent.releaseHighlights` 和验证结果 |
| 已有 `Harness/` 但缺少 `Harness/scripts/wf-update-check.mjs` | `npx create-harness-vibe-coding@latest my-project . -y --on-conflict skip --json`。然后执行 `node Harness/scripts/wf-update-check.mjs --json` |
| 安装或更新完成 | `node Harness/scripts/validate-harness.mjs --strict` |

安装范围：推荐全局优先。每台机器先执行一次 `npm i -g create-harness-vibe-coding`，然后在每个项目里运行 `create-harness-vibe-coding init .`（或 `/wf-init` 命令）。全局 runtime 是唯一的版本基准：commands、skills、agents、scripts 和 wf-ui 服务/资源都只在全局装一份，所有项目共享同一版本更新。每个项目只保留桥接文件（CLAUDE.md、AGENTS.md）和自己的状态（`Harness/tasks/`、`Harness/PROGRESS.md`、项目 memory、项目事实和项目 settings）。上表的项目内安装仍然可用；`--install-scope global --global-dir <dir>` 可手动播种共享 runtime，并把 commands/skills/agents 以 copy 方式写入 Claude Code、Codex、OpenCode 的全局目录。

用户不需要手动执行这些命令。Agent 负责安装、冲突处理、校验和汇报。

安装后的入口按阶段区分：

- 正常会话入口是 `CLAUDE.md`。
- `Harness/specs/guides/SETUP.md` 只用于安装、bootstrap、迁移或升级决策。
- 需要 Harness 工作流路由时再读 `Harness/README.md`。

## WF 命令怎么选

不确定时，用 `/wf-help`。在 Codex 里用 `$wf-help`。它只返回命令说明，不会启动工作流。

| 命令 | 什么时候用 | 做什么 | 示例 |
|---|---|---|---|
| `/wf <任务>` | 多文件、架构、迁移、风险较高或反复失败 | 研究 -> 计划 -> 实现 -> 测试 -> 审查 -> 验证 -> 复盘 | `/wf 重构支付模块并补齐测试` |
| `/wf-max <任务>` | 任务能拆成互不冲突的部分，需要最大并行度 | 在 WF 链路上增加 CEO -> Manager -> Worker 分工和并行波次 | `/wf-max 并行升级前端、后端和文档` |
| `/wf-auto` | 希望 Agent 持续自我优化 | 连续执行优化循环，每轮保留计划、证据和反馈 | `/wf-auto 优化这个项目的稳定性` |
| `/wf-auto-spark` | 需要外部灵感、竞品方向或长期路线图 | 搜索外部 spark，绑定 North Star 和里程碑，限制偏离范围 | `/wf-auto-spark 探索产品增长方向` |
| `/wf-review [重点]` | 需要第二意见、同行审查或上线前复核 | 优先调用可用 peer CLI；没有时使用独立 reviewer 角色 | `/wf-review 重点检查安全和数据丢失` |
| `/wf-learn` | 同类错误反复出现，或一次任务结束后要沉淀经验 | 汇总上下文、记忆和项目经验 | `/wf-learn 总结这次返修原因` |
| `/wf-browser <任务>` | 浏览器冒烟、E2E、截图、表单或页面验证 | 使用真实浏览器并提供截图、trace 或状态证据 | `/wf-browser 验证登录和支付流程` |
| `/wf-readme <任务>` | README、安装文档、架构图或项目说明需要整理 | 保留事实，整理结构，补充安装和使用说明 | `/wf-readme 优化中文 README` |
| `/wf-update` | 已安装 Harness，需要检查和应用框架更新 | 比较版本，自动处理安全变更，把语义冲突留给 Agent | `/wf-update` |
| `/wf-remove` | 需要卸载 Harness | 自动清理安全文件，保留用户数据，冲突文件先确认 | `/wf-remove` |
| `/wf-init` | 已装全局 runtime，想让新项目接入 | 只写入项目桥接文件和项目状态；框架文件与版本管理以全局 runtime 为准 |

Claude Code 使用 `/wf-*`；Codex 使用对应的 `$wf-*`；OpenCode 使用已注册命令或 Agent instruction。常见任务起点见 [WF-AUTO-ANGLES.md](Harness/specs/workflows/WF-AUTO-ANGLES.md)。

## 它改变了什么？

| 问题 | 没有 Harness | 使用 Harness |
|---|---|---|
| 完成标准 | 看起来能跑就结束 | 验收条件、测试、validator 和 review 一起决定是否完成 |
| 文件边界 | 靠 agent 临场判断 | 写入前先分类 create / skip / backup / overwrite / conflict |
| 中断恢复 | 重新扫描仓库和历史决策 | `Harness/PROGRESS.md`、任务状态和 Memory 提供接力信息 |
| 人工纠偏 | 人不断补上下文、盯冲突、催验证 | 人主要处理语义冲突和关键决策，`humanInterventions` 可记录 |
| 成本 | 前期省步骤，后期返工不可见 | 初始化成本明确，duration、token 和验证证据可记录 |

## HarnessBench 本地生命周期 benchmark

2026-07-26，本仓库运行 v0.2 本地 benchmark：

```bash
node scripts/harness-bench-local.mjs --output benchmarks/results/harnessbench-local-v0.2.json
node scripts/harness-bench.mjs --input benchmarks/results/harnessbench-local-v0.2.json --markdown
```

| Mode | Tasks | Runs | Verified safe | Protected overwrites | Repair-triggering runs | Manual repair events | Required-file misses | Benchmark leaks | Boundary violations |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| No Harness baseline (direct file writes) (`direct-run`) | 5 | 15 | 3/15 (20%) | 21 | 12 | 21 | 0 | 0 | 12 |
| Harness safe path (`harness-wf`) | 5 | 15 | 15/15 (100%) | 0 | 0 | 0 | 0 | 0 | 0 |

这组数据只证明本仓库内可复现的生命周期能力：新项目安装、已有 README/agent entry 保护、用户同名 skill 保护、旧 Harness 缺 updater 的恢复、以及 benchmark 不进入生成产物。

它还不能证明任意前端、后端或嵌入式任务的模型成功率提升。完整 HarnessBench 会继续覆盖 Web/API、前端交互、嵌入式 UART/I2C/watchdog，以及生命周期恢复任务。未发布 raw logs 前，README 不写泛化成功率。

Benchmark runner、fixture、scorer 和 raw JSON 都是外部证明材料，不会打进用户安装后的 Harness。

## Prompt-cache L2 样本

2026-07-23，本 dogfood 仓库运行了一次有预算上限的 Claude Code L2 prompt-cache probe：

```bash
node Harness/scripts/l2-cache-telemetry.mjs --groups provider-control,harness-thin,wf-light --turns 11 --turn-budget-usd 0.32 --total-budget-usd 1.20 --timeout-ms 240000
```

数据来自 Claude Code JSON usage 字段，尤其是 `usage.cache_read_input_tokens` 和 `usage.cache_creation_input_tokens`。读缓存比例按 `cache_read_input_tokens / (input_tokens + cache_creation_input_tokens + cache_read_input_tokens)` 计算。原始本地报告不提交进仓库，位置是 `~/.claude/cache-telemetry/harness-l2-claim-20260723-130331.json`。

| 路由 | Turns | 成功率 | Warm median cache read | Warm 区间 | Warm median latency | 相对 provider-control |
|---|---:|---:|---:|---:|---:|---:|
| provider-control | 11 | 11/11 | 93.3% | 91.1%-95.4% | 2123.5 ms | baseline |
| harness-thin | 11 | 11/11 | 98.7% | 98.1%-99.2% | 1786.5 ms | +5.4 个百分点 |
| `/wf` wf-light | 11 | 11/11 | 99.1% | 98.7%-99.7% | 2900 ms | +5.8 个百分点 |

边界：这只说明本次 Claude Code 受控样本里有真实缓存读取，并测到了提升；不是对所有模型、仓库、任务或 provider 的承诺。

## 架构图

<p align="center">
  <a href="docs/images/harness-architecture-light.png">
    <img src="docs/images/harness-architecture-light.png" alt="Harness Light 架构图：开发者请求经过目标与约束、上下文、分解与反馈，进入执行、验证、学习、更新闭环" width="100%">
  </a>
  <br>
  <sub>
    Light 风格架构图 | <a href="docs/images/harness-architecture.drawio">可编辑 Drawio 源文件</a>
  </sub>
</p>

三个核心支柱：

1. **目标与约束**：明确要解决什么、不能改什么、怎样算完成。
2. **上下文与记忆**：通过路由、按需加载和持久记忆，把正确的信息交给正确的 agent。
3. **分解与反馈**：把长任务切成有边界的小任务，每一步都留下验证和恢复入口。

## 你会得到什么

| 目录或文件 | 作用 |
|---|---|
| `CLAUDE.md`、`AGENTS.md` | agent 会话入口契约和兼容指针 |
| `Harness/README.md`、`Harness/MEMORY.md` | Harness 工作流路由和资源索引 |
| `Harness/tasks/`、`Harness/PROGRESS.md` | 跨会话保存任务状态和接力信息 |
| `.claude/`、`.agents/skills/`、`.codex/`、`.opencode/` | 不同 coding agent 的发现入口和配置 |
| `templates/common/`、`templates/optional/` | 可生成脚手架的声明式源文件 |
| `Harness/scripts/validate-harness.mjs` | 检查脚手架结构和 bootstrap 完整度 |

生成项目不会替你选择业务技术栈，也不会生成业务代码。你可以在 bootstrap 后选择 React、FastAPI、嵌入式 C/C++ 或其他技术栈。

## 和相邻工具相比

Harness 是 repo-local operating contract，可以叠在 Claude Code、Codex、OpenCode 或其他 agent 之上，不替代模型或编辑器本身。

| 对比对象 | 主要层级 | Harness 的重点 |
|---|---|---|
| Direct agent run | 一次 prompt 加临时上下文 | 持久任务状态、显式写入边界、验证 gate、可恢复 handoff |
| [Claude Code](https://code.claude.com/docs/en/overview)、[Codex](https://developers.openai.com/codex)、[OpenCode](https://opencode.ai/docs/) | Coding agent / runtime | 跨 runtime 的同一套 repo contract、命令面、memory 形状、validator 和更新策略 |
| [Aider](https://github.com/aider-ai/aider) | Terminal pair-programming、repo map、git/test loop | 安装/更新安全、任务胶囊、外部 benchmark 证据和多 runtime 工作流路由 |
| [Superpowers](https://github.com/obra/Superpowers) | Skills-based development methodology | npm scaffold、机器可读 ownership/version manifest、安全合并/更新脚本和生成后的 repo-local state |

## 可选工作流

把需求直接交给 Agent：

> 请为当前 Harness 项目加入 `ui-ux-review` 和 `ts-react-frontend`，保留已有文件，完成后运行严格校验，并准确汇报发生了什么变化。

| 工作流 | 适合场景 |
|---|---|
| `ui-ux-review` | 响应式、无障碍和界面打磨 |
| `ts-react-frontend` | TypeScript、React、Vite 项目 |
| `python-backend` | FastAPI、pytest 项目 |
| `github-pr-review` | PR diff 审查和 CI 证据 |

外部推荐只会记录到 `Harness/specs/guides/SETUP.md`，不会自动安装：

| 推荐 | 用途 | 来源 |
|---|---|---|
| `superpowers` | 社区 agent skills 和开发工作流 | [Superpowers](https://github.com/obra/Superpowers) |
| `caveman` | 简洁、低 token 的 agent 行为 | [Caveman](https://github.com/JuliusBrussee/caveman) |
| `agent-research` | 文献、产品、依赖和生态研究 | [agent-research-skills](https://github.com/lingzhi227/agent-research-skills) |
| `codegraph` | 代码图谱和仓库地图 | [Codegraph](https://github.com/colbymchenry/codegraph) |
| `grill-me` | 实现前对计划或设计做高压追问 | [Grill Me](https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me) |

## 验证

```bash
# 当前脚手架仓库
npm test

# 生成项目安全合并后
node Harness/scripts/validate-harness.mjs

# bootstrap 完成后或发布前
node Harness/scripts/validate-harness.mjs --strict

# 发布更新版本后
npm run check:mirrors
```

## 所有权清单

`Harness/ownership.manifest.json` 是安装和更新时文件分类的机器可读事实来源，由 `node scripts/build-version.mjs` 从 `templates/common/` 和 `templates/optional/catalog.json` 生成。框架拥有的文件走安全升级；用户数据（tasks、memory、research、README、package、PROGRESS）保留；CLAUDE、AGENTS、Harness README 走合并；同名用户 agent、command、skill（无 marker）不会被覆盖。

## 发布门禁

每次 Harness 更新发版都必须同时保持两个更新通道可用：

- Canonical：npm `create-harness-vibe-coding@latest` 和 `https://github.com/LiWeny16/create-harness-vibe-coding`
- 低版本兼容镜像：`https://github.com/zingspark/create-harness-vibe-coding`

低版本用户的 updater 可能已经硬编码到旧的 `zingspark` 仓库。发布不能只更新新仓库；必须等 legacy mirror 拥有同一份 `main` 分支 commit、版本 tag、生成后的 template manifest（`templates/common/.harness-version` 与 `templates/common/Harness/ownership.manifest.json`），且该 tag 对应的 GitHub Release artifact 已在 legacy mirror 上发布，且全部与 canonical 一致，才算发版完成。新安装生成的 `Harness/.harness-version` 仍然记录 canonical `LiWeny16` source；`zingspark` 只作为旧用户兼容镜像保留。

“代码就绪”不等于“用户可更新”。已发布 npm 的用户只有在 `npm publish` 完成、GitHub release/tag 已创建、且两个镜像都已同步之后，才能拿到新版本。在三者全部完成之前，不要向现有用户宣布更新可用。

## 适配范围与体积

- 支持 Claude Code、Codex 和 OpenCode 的共享 Harness 工作流。
- Node.js >= 18。
- 运行时无额外依赖；CLI 依赖 `@clack/prompts` 和 `picocolors`。
- 生成的是工作基础设施，不是业务应用代码。

MIT © [LiWeny16](https://github.com/LiWeny16)
