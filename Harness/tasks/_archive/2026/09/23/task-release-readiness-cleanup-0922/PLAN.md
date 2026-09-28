# task-release-readiness-cleanup-0922 - PLAN

## Goal

在不误删用户资产、不 publish、不 push 的前提下，完成 0.9.6 release readiness：先建立安全清理白名单，再清理有明确归属的 framework-generated artifacts，确认 legacy mirror policy，最后运行完整发布 gates 并给出可发布/不可发布结论。

## Scope

### Phase A — release baseline

- 记录当前 package/generator 版本、branch、dirty baseline 和已有用户改动。
- 明确 `zingspark` legacy mirror 的唯一处理决策：同步、从 gate 退役，或正式记录 release baseline exception。
- 不把 baseline exception 伪装成代码 gate 通过。

### Phase B — safe cleanup

只允许处理满足全部条件的候选项：

1. 明确是生成的调试/测试产物，不是用户内容。
2. `git ls-files`、调用方搜索和 ownership 检查均证明没有有效消费者。
3. 在报告中先列出精确路径、来源、可恢复方式和删除理由。
4. 删除或移动后运行相关测试和 `git diff --check`。

候选项包括：`Harness/scripts/tmp-wfui-out.log`、`Harness/scripts/debug-memory-fixture2/`、已确认过期的测试截图/日志/临时文件；任何不确定项都跳过并记录。

### Mandatory preserve set

- `3080.md`、`3080-xianyu-cover.png`
- `Harness/a2a/**` runtime/backend state
- 用户本地 `.claude/skills/`、`.agents/skills/` 和用户 dirty changes
- `Harness/tasks/`、`Harness/memory/`、`Harness/research/`
- `extensions/`、`benchmarks/`、`Harness/wf-browser/` 等未确认归属目录
- 任何未进入安全删除白名单的文件

### Phase C — release gates

在不修改源码的前提下运行并记录：

- `npm test`
- `npm run test:e2e`
- `npm run test:smoke`
- `npm run pack:smoke`
- `node templates/common/Harness/scripts/validate-harness.mjs --strict`
- `node scripts/build-version.mjs --check`
- `node scripts/check-script-mirrors.mjs`
- `node scripts/check-update-mirrors.mjs`
- `git diff --check`
- 必要时 `npm pack --dry-run` 检查发布包内容，禁止 `npm publish`

## Forbidden

- 不执行 `git reset`、`git checkout`、`git clean`、`git push`、`npm publish`。
- 不删除或移动 `3080.md/png`、`Harness/a2a`、用户 skill、用户 dirty files 或未确认目录。
- 不为通过 gate 修改业务代码、manifest、hooks、命令、skills、模板或测试。
- 不因 legacy mirror 失败直接删 gate；必须记录 owner decision 和 release note。
- 不宣称“可发布”，除非所有必需 gates 有结果，且 baseline exception 有明确批准/记录。

## Required deliverable

写入 `RELEASE-READINESS.md`，包含：

- cleanup allowlist、preserve list、实际删除/跳过记录
- mirror policy decision and evidence
- 每个 gate 的 PASS/FAIL/INCOMPLETE、命令、失败归因
- package version 与发布包内容检查
- final verdict：`ready / blocked / ready-with-explicit-exception`
- 若 blocked，列出唯一阻断项和下一步，不提出无关重构

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | 当前版本、dirty baseline、用户资产 preserve set 已记录 | `RELEASE-READINESS.md` | pending |
| AC-002 | 所有删除项均有来源、无消费者和可恢复证据 | cleanup allowlist | pending |
| AC-003 | 不确定文件未被删除，3080/A2A/user skills 保持不变 | diff + preserve check | pending |
| AC-004 | legacy mirror 采用明确的 sync/retire/exception 决策 | policy evidence | pending |
| AC-005 | npm test、e2e、smoke、pack smoke 已运行 | gate log | pending |
| AC-006 | strict validator、version check、local/remote mirror checks 已运行 | gate log | pending |
| AC-007 | `git diff --check` 通过，dirty baseline 与本任务变化分离 | diff evidence | pending |
| AC-008 | release verdict 有证据，未执行 publish/push | final report | pending |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| 根目录 3080 文件可能是用户资产 | mandatory preserve，除非用户另行明确授权 | open |
| legacy mirror 失败可能是历史政策而非代码缺陷 | 先做 owner decision，保留 gate 证据 | open |
| dirty tree 影响 release 判断 | 建立 baseline，不能用“全树干净”冒充本任务结果 | open |
