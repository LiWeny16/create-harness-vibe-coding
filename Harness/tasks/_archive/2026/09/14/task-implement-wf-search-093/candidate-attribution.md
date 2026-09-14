# 0.9.3 候选归属清单（baseline）

记录时间：2026-09-13。记录时 HEAD：`0212e161079aa554b2a3b070d0503fa6260b7fd0`，分支：`agent/wf-ui-state-checkpoint-20260804`。

## 线上状态核查（提示词第 13 节前置）

| 检查项 | 结果 | 结论 |
|---|---|---|
| npm latest | `0.8.20`（dist-tags: latest=0.8.20, experimental=0.8.19） | 0.9.3 版本号无冲突 |
| npm 全部版本 | 无 0.9.x | 0.9.2/0.9.3 均未发布 |
| origin (LiWeny16) main | `5cff3c61cdea0a8b4d01c572dece620b63b427b9` | 落后本地 HEAD（本地多 d2ce16c、0212e16 两个提交） |
| origin tags | 最高 v0.8.20 | 无 v0.9.x |
| legacy (zingspark) main | `a81699b7...` | 与 origin 不同步 |
| legacy tags | 最高 v0.8.19 | 无 v0.9.x |

## 当前工作区状态

- 已暂存（staged）：约 212 个文件，+17385/-1225 —— 0.9.2 升级任务候选主体。
- 未暂存（unstaged）：约 52 个文件，+4240/-3568 —— 后续修复与 UI 改动混合。
- 未跟踪（untracked）：用户文件（`3080.md`、`3080-xianyu-cover.png`、`evidence/`）、A2A 本地节点状态、本任务目录、composition-api 及其测试、INDEX.json/INDEX.md、`Harness/tasks/task-make-wf-lifecycle-0908/`、`Harness/tasks/task-upgrade-harness-092/` 等。
- stash：4 个历史 stash 未动。
- 本地版本文件：package.json=0.9.2、Harness/.harness-version generator=0.9.2、templates/common/.harness-version=0.9.2。
- Node v24.18.0 / npm 11.16.0（本机）；CI 声明 Node 18/Linux 未在本机验证。

## Included（0.9.3 候选包含）

| 归属 | 内容 | 证据/说明 |
|---|---|---|
| 0.9.2 升级任务已暂存主体 | 212 个 staged 文件（templates/root dogfood/scripts/tests/specs） | task-upgrade-harness-092 的 W0-W3 沉淀；its PROGRESS 记录为最新绿（composition 23/23、server 124/124、M2 9/9、boundary 4/4） |
| composition-api 实现 | `src/wf-ui-server/composition-api.mjs` + 4 个 node-composition 测试 + boundary 测试 | untracked 但为 092 任务 COMPOSE-AC 的实现产物；需纳入候选 |
| 092 任务修复残留 | unstaged 52 文件中属于 Skills Market/UI 修复、manifest、research README 更新的部分 | 逐文件复核后纳入；修复了 092 记录的 UI build 失败根因（WorkflowRoute 缺 Skills Market 导出 → 见 unstaged WorkflowRoute.tsx / nodeRuntimeClient.ts 改动） |
| 本任务 wf-search V1 | 新增 command/Skill/scripts/tests/registry/保护规则 | 本任务实现产物 |

## Excluded（不进入候选）

| 内容 | 原因 |
|---|---|
| `3080.md`、`3080-xianyu-cover.png`、`evidence/`（根目录） | 用户个人文件 |
| `Harness/a2a/nodes/*`（4 个 untracked 节点目录）、`workflow-map.json`/`component-nodes` 本地状态 | A2A 后端本地诊断状态，CLAUDE.md 明确不入产品 |
| `src/ui/test-results/*`、`src/ui/trace-unpack-m3-settings/`、`src/ui/test-results/.last-run.json` | Playwright 运行产物 |
| `Harness/scripts/debug-memory-fixture2/` | 调试产物 |
| 4 个历史 stash | 非本任务范围，不动 |
| `benchmarks/` 新增文件 | 092 任务 benchmark 基建；纳入与否取决于 092 完整 AC（本轮不依赖），默认随 staged 主体保留（已 staged，剔除反而引入新差异）——标记为"随主体验证" |

## Unresolved（阻塞级，需逐项收敛）

| 项 | 状态 | 处置 |
|---|---|---|
| unstaged 52 文件逐文件归属 | 部分属于 092 修复（WorkflowRoute.tsx 等 MM 文件），部分属于用户工作（PROGRESS.md、GROUPS.md、a2a 状态） | 实现阶段逐文件判定；无法证明归属的不动 |
| 092 记录的 5 个候选门禁失败（manifest workflows.json、2×cli-smoke INDEX、pack-smoke UI dist、wf-learn mirror） | 候选需重验 | verify 阶段在 0.9.3 候选上重跑；失败则独立修复提交 |
| 092 记录的 UI build 失败（WorkflowRoute 缺导出） | unstaged 改动疑似已修复 | verify 阶段跑 `npm --prefix src/ui run build` 重验 |
| `Harness/scripts/README.md:67` research-policy `--project .` 文档漂移 | 092 记录的残留 docs 问题 | 实现阶段顺手修正（在 write set 内） |
| 本机未跑 Node 18/Linux CI | 环境差异 | 按 CI 配置在隔离候选执行或明确标注未验证 |
| M3 UI E2E 29/30（1 flaky drag） | flaky 待分类 | verify 阶段重跑分类，不删测试不改断言 |

## 结论

- 0.9.3 版本号可用（npm/GitHub 均无 0.9.x 冲突）。
- 候选 = 已暂存 0.9.2 主体 + composition-api untracked 实现 + 已归属的 unstaged 修复 + 本任务 wf-search V1。
- 提交策略：保持现有暂存区不动；wf-search 实现独立新增文件为主；提交前逐文件复核 unstaged 归属，禁止 `git add .`。

## Final candidate addendum (2026-09-13)

The baseline above is historical. The release candidate is now the committed SHA `0b4451266ae0883f523a1786ed52ebce3523f5f5` on `agent/wf-ui-state-checkpoint-20260804`, with package version `0.9.3` and regenerated `Harness/.harness-version` (220 checksums, 239 sources). The candidate includes the attributed 0.9.2/UI baseline, composition API fixes, and the wf-search implementation; the user-owned files and runtime state listed above remain outside the commit.

The same SHA was checked in clean worktree `C:/Users/onion/Documents/Codex/2026-09-13/wf-search-clean-093c`. Both strict validators passed; wf-search/install tests passed 71/71; e2e passed 174/174; focused server tests passed 52/52; UI build and pack smoke passed; a freshly installed copy of the exact 0.9.3 tarball reported version 0.9.3 and validated the compare fixture. Exact tarball metadata is recorded in `evidence/implementation-verification-093.md`.

The only unresolved verification limits are the four pre-existing provider/PTY effort fixture failures in the full 0.9.2 regression suite and unavailable Node 18/Linux execution. Neither is a wf-search test failure. At the time of this addendum, npm latest remained 0.8.20 and neither GitHub remote had a v0.9.3 tag; publication is still pending.
