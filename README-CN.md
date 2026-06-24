# create-harness-vibe-coding 中文说明

0-1 产品 Harness 脚手架，AI 辅助工程全流程。English: [README.md](README.md)

## 一条命令

```bash
npx create-harness-vibe-coding@latest my-project
```

---

## 一句话交给 Agent

```text
请按照 https://github.com/zingspark/create-harness-vibe-coding 的 README 为当前项目配置 create-harness-vibe-coding；编辑前先询问 Agent-link 安装前置问题；新项目走 0-1 bootstrap，老项目或老架构升级先 dry-run，保留现有文件，只合并缺失的 Harness 规范，然后遵循 Harness/SETUP.md。
```

## 两种安装方式

### npx 安装
适合确定性写入、明确冲突策略、可重复 dry-run 的场景。

### 直接把链接丢给 Agent
适合老项目升级。Agent 会读取仓库 README，理解当前项目结构，执行或模拟 dry-run，给出最小迁移方案。如果已有 `CLAUDE.md`，Agent 必须先请求用户确认再合并。

## Harness 工作流

```mermaid
graph TD
    A["/wf 进入工作流"] --> B[探索: 3+ 并行 subagent]
    B --> C[二阶段计划 → PLAN.md]
    C --> D[构建: test→implement]
    D --> E[双门禁审查]
    E --> F{通过?}
    F -->|否| G[debugger→修复→循环]
    G --> E
    F -->|是| H[收尾: context→memory]
    H --> I[/wf update 增量更新]
```

## 核心文件

| 文件 | 用途 |
|------|------|
| `CLAUDE.md` | Claude Code 根入口，保持短小 |
| `Harness/README.md` | 文档路由器——按任务关键词加载最少文档 |
| `Harness/WF.md` | 长任务工作流：摄入 → 探索 → 计划 → 构建 → 审查 → 验证 → 恢复 |
| `Harness/PROGRESS.md` | 全局任务索引 |
| `Harness/tasks/<id>/` | 每任务胶囊：PROGRESS.md（进度+心跳）+ PLAN.md（实施+证据） |
| `.claude/agents/` | 11 个通用 Agent：planner, researcher, architect, implementer, reviewer, debugger, verifier, memory-master, context-master... |
| `.claude/skills/` | wf-mode, subagent-orchestrator, wf-update, harness-router... |

## WF 模式

输入 `/wf`、`wf mode`、`workflow mode` 或 `wk mode` 进入长任务工作流。默认启动 3 个并行只读 subagent 做探索，然后二阶段计划 → 实现 → 双门禁审查 → 验证。失败时自动进入恢复循环（debugger → review → verify）。收尾时 context-master 提取知识，memory-master 写入记忆。

```bash
# 进入 WF 模式
"用 /wf 处理这个长任务迁移。"
"wf mode — 帮我重构认证层。"
```

## WF Update

从 GitHub 增量更新脚手架，校验和安全。

```bash
/wf update --check   # 只检查
/wf update           # 完整更新
```

## 已有项目安装

```bash
# 先预览
npx create-harness-vibe-coding@latest my-app . -y --dry-run

# 保留现有文件，只补缺失
npx create-harness-vibe-coding@latest my-app . -y --on-conflict skip
```

| 冲突模式 | 含义 |
|----------|------|
| `fail`（默认） | 目标文件已存在则停止 |
| `skip` | 保留现有文件，只创建缺失 |
| `backup` | 备份 → 写入新文件 |
| `overwrite` | 直接覆盖 |

## 验证

```bash
npm test
node Harness/scripts/validate-harness.mjs
```
