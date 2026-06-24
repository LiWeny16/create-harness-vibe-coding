# create-harness-vibe-coding 中文说明

0-1 产品 Harness 脚手架，用于 AI 辅助工程：从想法、调研、PRD、架构、计划，到实现、验证和反馈闭环。

English README: [README.md](README.md)

## 一句话交给 Agent

```text
请按照 https://github.com/zingspark/create-harness-vibe-coding 的 README 为当前项目配置 create-harness-vibe-coding；编辑前先询问 Agent-link 安装前置问题；新项目走 0-1 bootstrap，老项目或老架构升级先 dry-run，保留现有文件，只合并缺失的 Harness 规范，然后遵循 Harness/SETUP.md。
```

## 两种安装方式

### 1. npx 安装

适合需要确定性写入、明确冲突策略、可重复 dry-run 的场景。

### 2. 直接把链接丢给 agent

适合老项目、老架构升级、已有复杂 `CLAUDE.md` / `AGENTS.md` / `.claude/` 的场景。agent 应该读取这个仓库 README，理解当前项目结构，执行或模拟 dry-run，然后给出最小迁移方案。

如果项目里已经有 `CLAUDE.md`，agent 必须先告诉用户：`CLAUDE.md` 是根 agent 入口合同，不能静默覆盖或乱合并。正确流程是先请求用户确认是否重构/合并 `CLAUDE.md`，再在保留原项目规则的基础上补入 Harness 的 startup、memory、router、workflow、subagents 编排约束。

Agent-link 安装前置问题，编辑前先问：

只询问会影响写入、架构、安全或工作流的选择。开始时最多问 3 个 blocking 问题，其余采用安全默认值并记录到计划里，等真正触发时再继续追问。

| 主题 | 什么时候问 | 没回答时的默认值 |
| --- | --- | --- |
| 根 agent 入口 | 已存在 `CLAUDE.md`、`AGENTS.md`、`.claude/` 或其他 agent 入口文件 | 保留现有文件；合并 Harness 入口合同前必须询问用户 |
| Harness 存放位置 | `docs/` 已经用于 GitHub Pages、产品文档或生成文档 | 默认使用根目录 `Harness/`；不要把 Harness 文档写进 `docs/` |
| README 归属 | 根 `README.md` 是公开产品页、包文档或已有大量自定义内容 | 保留现有 README，只提议追加最小 Development section |
| README 优化 | 已有 README 过时、太单薄、缺少命令表格，或用户想要架构图/更生动的文档 | 可推荐 `readme-optimizer`；默认只追加 Development notes，结构化优化或重写必须先得到用户确认 |
| 扩展能力 | ECC、Superpowers、自定义 rules 或栈相关 skills 可能有用 | 先推荐；只有用户同意后才安装 |
| Skills | 技术栈已明确，测试、前端、后端、review、浏览器证据可用 optional skills 增强 | 用户同意后只安装 1-2 个最相关 skills |
| CI/CD | 已有 CI 配置，或项目缺少测试/构建 gate | 先记录现有命令；只有用户同意后才新增或规范 CI/CD |
| 验证深度 | 涉及浏览器可见行为、API、数据库、鉴权、支付或部署 | 必须有真实命令证据；相关场景必须有浏览器/API 证据 |
| Memory/隐私 | 仓库包含敏感领域数据、客户数据、密钥或私有流程 | 只启用 memory index；禁止记录 secrets 或私有数据 |
| Branch/worktree | 存在未提交改动、风险迁移或并行实现 lane | 保护当前工作区；大改前先提议 branch/worktree |
| 包管理器/技术栈 | 存在多个包管理器、monorepo apps 或技术栈边界不清 | 写文件前先确认当前 workspace/app 范围 |

## 一条命令

```bash
npx create-harness-vibe-coding@latest my-project
```

## 现有项目渐进安装

先预览，不写文件：

```bash
npx create-harness-vibe-coding@latest my-app . -y --dry-run
```

再保留现有文件，只补缺失的 Harness 文件：

```bash
npx create-harness-vibe-coding@latest my-app . -y --on-conflict skip
```

安装后让 agent 先读 `Harness/SETUP.md`，再开始正常工作。

## 核心约束

- `CLAUDE.md` 只做薄入口和路由，不放项目架构、构建脚本、git 规范。
- 项目开发命令、构建、测试、git、发布流程放根目录 `README.md`。
- 架构说明放 `Harness/architecture.md` 或当前 feature 文档。
- Harness 文档、状态、记忆、工作流默认放根目录 `Harness/`。
- 如果已有 `AGENTS.md`，agent 必须先询问用户是否同意修改。
- 长任务、多文件、多 subagents、低置信度或重复失败时使用 `/wf`、`wf-mode` 和 `Harness/WF.md`。

## 常用生成物

| 文件 | 用途 |
| --- | --- |
| `CLAUDE.md` | Claude Code 根入口，保持短小 |
| `Harness/README.md` | Harness 路由器 |
| `Harness/SETUP.md` | 初次安装和 bootstrap 指南 |
| `Harness/MEMORY.md` | agents、skills、记忆文件索引 |
| `Harness/PLAN.md` | 当前计划、heartbeat、handoff、验证证据 |
| `Harness/WF.md` | 长链路 workflow 和恢复循环 |
| `Harness/subagents.md` | 多 subagents 编排方法论 |
| `.claude/skills/*` | Claude Code 可加载的 Harness skills |

## 验证

```bash
npm test
node Harness/scripts/validate-harness.mjs
```

生成项目后，`Harness/scripts/validate-harness.mjs` 用于检查 Harness 结构、注册关系和必要规范是否完整。
