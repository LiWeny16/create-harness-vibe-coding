# create-harness-vibe-coding

给 AI coding agent 用的 0-1 产品脚手架。核心目标：让 agent 先读路由、先确认事实、再写代码。

English README: [README.md](README.md)

## 一条命令

```bash
npx create-harness-vibe-coding@latest my-project
```

## 一句话交给 Agent

已有项目时，不要让 agent 猜。把这句话贴给它：

```text
请完整阅读并严格遵循 https://github.com/zingspark/create-harness-vibe-coding，为当前项目配置 create-harness-vibe-coding。
```

复杂规则不塞进这句话里。README 和生成后的 `Harness/SETUP.md` 才是安装、升级、合并和可选能力选择的准则。

## 你会得到什么

| 文件/能力 | 作用 |
|---|---|
| `CLAUDE.md` + `AGENTS.md` | 根目录 agent 入口 |
| `Harness/README.md` | Harness 路由器 |
| `Harness/tasks/` + `Harness/PROGRESS.md` | 跨会话任务状态 |
| `.claude/skills/` | Claude Code workflow skill 入口 |
| `.agents/skills/` | Codex repo skill 入口 |
| `.codex/` | Codex hooks/config |
| `/wf` / `$wf` | 长任务 workflow |
| `/wf-max` / `$wf-max` | 最大并行 workflow |
| `/wf-review` / `$wf-review` | 交叉审查 workflow |
| `Harness/scripts/validate-harness.mjs` | 结构校验 |

`Harness/` 承载所有 Harness 文档。不要把 Harness 文件放进 `docs/`。

Claude Code 和 Codex 共用同一套核心 Harness 文档，但发现入口不同：

- Claude Code：`.claude/skills/<name>/SKILL.md`，通常用 `/wf` 调用。
- Codex：`.agents/skills/<name>/SKILL.md`，通常用 `$wf` 或 `/skills` 调用。
- `.codex/` 只放 Codex 配置和 hooks；不要再使用根目录 `commands/*.toml` 伪装 Codex slash command。

## 安装或升级路径

写文件前，agent 必须先判断当前项目属于哪一种：

| 项目状态 | 必须怎么做 |
|---|---|
| 空项目或新项目 | 运行脚手架，然后遵循 `Harness/SETUP.md` 做 0-1 bootstrap |
| 已有项目，没有 `Harness/` | 先扫描项目事实，先 `--dry-run`，保留现有文件，只合并缺失的 Harness 指南 |
| 老项目或老架构迁移 | 现有代码和文档是事实来源，先 dry-run，再用 `Harness/SETUP.md` 从事实中补 PRD、研究、架构和任务计划 |
| 已经有 `Harness/` | 不要把 `npx` 当更新器；先问用户是运行 `/wf-update` / `$wf-update` / `node Harness/scripts/wf-update-check.mjs`，保持不动，还是批准后移除重装 |

根目录扫描必须包括：顶层文件、`CLAUDE.md`、`AGENTS.md`、`.claude/`、`.agents/`、`.codex/`、`Harness/`、package 文件、CI 文件、应用入口、测试/构建命令、已有文档、已经安装的 skills/plugins/rules。推荐可选能力前，必须先排除已经安装的能力，避免重复推荐。

## 已有项目安全合并

```bash
# 先预览，不写文件
npx create-harness-vibe-coding@latest my-app . -y --dry-run

# 只补缺失文件，不覆盖已有文件
npx create-harness-vibe-coding@latest my-app . -y --on-conflict skip
```

`npx` 是安装和安全补缺入口，不是已安装 Harness 的同步更新器。项目里已经有 `Harness/` 后，Claude Code 用 `/wf-update`，Codex 用 `$wf-update`，或者直接运行：

```bash
node Harness/scripts/wf-update-check.mjs
```

原因很直接：`CLAUDE.md`、`AGENTS.md`、`.claude/`、`.agents/`、`.codex/` 和用户改过的 Harness 文档都需要 agent 带着上下文做合并决策。

## 可选能力

```bash
npx create-harness-vibe-coding@latest my-app -y --with browser-e2e
npx create-harness-vibe-coding@latest my-app -y --preset web-app
npx create-harness-vibe-coding@latest my-app -y --recommend superpowers,codegraph
```

| 参数 | 作用 |
|---|---|
| `--with <ids>` | 安装本地 workflow |
| `--preset <name>` | 安装预设，如 `web-app`、`fullstack` |
| `--without <ids>` | 从预设中排除 workflow |
| `--recommend <ids>` | 记录外部能力建议，不自动安装 |
| `--list-options` | 查看本地 workflow 和外部建议 |

本地 workflow：`browser-e2e`、`ui-ux-review`、`ts-react-frontend`、`python-backend`、`github-pr-review`。

外部建议只写入 `Harness/SETUP.md`，不会自动安装第三方技能：

| 建议 | 用途 | 链接 |
|---|---|---|
| `superpowers` | 社区 skill registry 和 agent workflow | <https://github.com/obra/Superpowers> |
| `caveman` | 简洁低 token 的 agent 行为和记忆压缩 | <https://github.com/JuliusBrussee/caveman> |
| `agent-research` | 文献、产品、依赖和生态研究类 agent skills | <https://github.com/lingzhi227/agent-research-skills> |
| `codegraph` | 代码图谱或仓库地图工具 | <https://github.com/colbymchenry/codegraph> |

这些只是给用户 agent 自行评估的 GitHub 链接。脚手架不维护第三方安装步骤，只在确认项目尚未安装同类能力后记录用户选择。

不加 `-y` 时，CLI 会提供 checkbox/multiselect 选择。

## Agent-link 安装前置问题

Agent 必须先扫描根目录，再最多问 3 个阻塞问题。扫描要覆盖：

- `CLAUDE.md`、`AGENTS.md`
- `.claude/`、`.agents/`、`.codex/`
- `Harness/`
- `README.md`
- package 文件、CI 文件、已有文档目录、应用入口、测试/构建命令
- 已安装的 skills/plugins/rules

只在影响写入时提问：

- 已有 `CLAUDE.md` 或 `AGENTS.md`：合并缺失 Harness 指南、保持不动，还是跳过？
- 已有 `Harness/`：走 `/wf-update` / `$wf-update`、dry-run 补缺、保持不动，还是批准后移除重装？
- 排除已安装能力后，还要启用哪些本地 workflow，或只记录哪些外部 GitHub 推荐链接？

默认策略：保留已有文件，只补缺失内容。

## 验证

```bash
npm test
node Harness/scripts/validate-harness.mjs
```

## 项目结构

```text
my-project/
├── CLAUDE.md
├── AGENTS.md
├── Harness/
│   ├── README.md
│   ├── SETUP.md
│   ├── MEMORY.md
│   ├── PROGRESS.md
│   ├── WF.md
│   ├── tasks/
│   ├── research/
│   ├── workflows/
│   └── scripts/
├── .claude/
│   ├── agents/
│   ├── skills/
│   └── rules/
├── .agents/
│   └── skills/
├── .codex/
└── tests/
```

MIT - [zingspark](https://github.com/zingspark)
