# Candidate selective-stage ownership review (2026-09-09)

本报告是只读归属审查，不是 release acceptance，也没有执行 stage、commit 或
push。读取范围限于本 task 的 PLAN/claims/evidence、候选 source/template/test
路径与 git 元数据；没有读取 A2A node 状态、workflow-map 或其它用户 task 内容。
release-prep-final-092 的候选清单是待 owner 复核的 inventory，不自动证明每个
dirty hunk 都属于本 task。

## 结论

可构建候选应采用下方 exact allowlist 加 unchanged HEAD 基线，并按 owner/hunk
选择性 stage；不能对整个 dirty framework 执行 git add .。当前有三类实质归属
风险：

1. WorkflowRoute.tsx 同时包含 WF lifecycle task 绑定 additions 与 Skills
   Market 删除；后者与本 task 无明确关联，必须拆 hunk。
2. WorkflowSkillsHubOverlay.tsx 当前 diff 主要是 Market/install-target 删除，
   不能作为本 task release source 整文件纳入。
3. Header.tsx/TaskList.tsx 以及 src/index.js 的新增分别跨 UI lifecycle、
   global bridge、update timeout 等语义；未见逐 hunk claim，须 owner 确认后按
   hunk stage。其余 runtime 文件有 AC-03/05/06 依赖，但仍须最终 snapshot 复核
   exact diff，不能因路径在 inventory 中就自动归属。

旧 HEAD 已有 4 个 tracked task capsule 与 729 个 A2A state-like paths（见
release-prep-final-092 的历史 inventory）；它们、用户资产和当前 task state 不
因候选 stage 而删除或重写。clean clone 也不应被假定为空白。

## 明确路径归属审查

| 类别 | 本 task 明确改动/依赖 | 与旧任务或基线的边界 | stage 判断 |
|---|---|---|---|
| CLI/generator | src/generator.js 的 project/runtime installMode；src/index.js 的 global bridge、默认 scope、update timeout/exit 传播；src/prompts.js 默认 scope。与 CLI、project-local/global runtime 和 AC-01/06 相符。 | src/index.js 同一文件包含多个语义簇；旧 0.9.1 installer 行为是必要基线，不能整体替换而丢兼容性。 | 候选依赖，但 src/index.js 需拆/owner 确认 global-scope 与 timeout hunk；不是无条件整文件 stage。 |
| UI lifecycle | Header.tsx/TaskList.tsx 新增 project/task lifecycle、active focus、resume、tags/date；types.ts、translations.ts 提供字段/文案；依赖 server readTaskView/task-parser。 | Header/TaskList 是旧 UI 基线且可能承载其它用户改动。 | 只 stage lifecycle additions；未知 hunk 保留未暂存。 |
| UI mixed | WorkflowRoute.tsx 新增 workflowOwnsTask/bindableTasks/active WF task 选择；同时删除 Skills Market fetch/install/tab/overlay。 | Market 删除无本 task claim，疑似旧 UI/Skills Hub 任务。 | 只 stage lifecycle/task-binding additions；Market 删除留未暂存。 |
| UI unrelated | WorkflowSkillsHubOverlay.tsx 删除 packs/install target/Market UI并改样式名。 | 未见 runtime/benchmark 依赖，疑似旧 UI 整理。 | 本轮不纳入；整文件留未暂存。 |
| Runtime envelope/capability | dispatch-contract.mjs、model-capability.mjs（new）及 server/task-parser/runtime-detector/settings/session-registry/pty-adapter/harness-env/chat-driver/peer-capsule/a2a-store 与三个 runtime driver。对应 AC-03/05/06 的 identity、catalog、effort、PTY、peer result、task view。 | security、graph/layout、spawn gate 等 unchanged HEAD 是必要依赖；未列 runtime dirty path 不应顺带 stage。server.mjs 变更大，包含 version、task view、HTTP dispatch、capability/settings、lifecycle，需逐段 owner 对应。 | exact runtime paths 是 candidate source 候选；大 diff 不能用路径清单替代 hunk review。 |
| Parser/shared interface | 实际共享 dispatch interface 是 src/wf-ui-server/dispatch-contract.mjs；没有 sharedinterfaces.mjs/shared-interfaces.mjs。task-parser.mjs 是 metadata/active pointer parser。 | 不为不存在的 sharedinterfaces 造文件；A2A 仅允许静态 action-registry source exception。 | 只 stage 已存在 exact modules。 |

具体 mixed hunk：
- WorkflowRoute.tsx 的 workflowOwnsTask、bindableTasks、active-task effect、
  task selector 是本 task 可解释 additions；fetchSkillsMarket、
  installSkillsMarketPack、market tab、pack rows/install target 删除必须拆出。
- WorkflowSkillsHubOverlay.tsx 未发现本 task 必需 dispatch/runtime hunk。
- Header/TaskList 的 metadata additions 与 task-parser 字段闭环，但旧 UI render
  可能混合修改；使用 hunk-selective stage。
- src/index.js 的 install-scope/global bridge 与 update timeout/exit 是不同语义
  簇；若 owner 不能证明均属于本 task，应拆成两组并由父模型选择。
- src/generator.js 与 src/prompts.js 是 global/install 组的配套，仍需与 CLI
  变更一起做 owner 复核。

## 最小 candidate allowlist（exact paths）

以下路径是从 task evidence、status/diff 和 package build 依赖收敛出的候选集合；
未列路径不应因 dirty 而进入 stage。

### Release metadata（6 exact paths）

package.json
CHANGELOG.md
templates/common/.harness-version
templates/common/Harness/ownership.manifest.json
Harness/.harness-version
Harness/ownership.manifest.json

### Candidate production source

src/generator.js
src/index.js
src/prompts.js
src/wf-ui-server/a2a-store.mjs
src/wf-ui-server/dispatch-contract.mjs
src/wf-ui-server/harness-env.mjs
src/wf-ui-server/model-capability.mjs
src/wf-ui-server/peer-capsule.mjs
src/wf-ui-server/pty-adapter.mjs
src/wf-ui-server/runtime-detector.mjs
src/wf-ui-server/server.mjs
src/wf-ui-server/session-registry.mjs
src/wf-ui-server/settings.mjs
src/wf-ui-server/task-parser.mjs
src/wf-ui-server/chat-driver.mjs
src/wf-ui-server/drivers/claude-stream-json.mjs
src/wf-ui-server/drivers/codex-appserver.mjs
src/wf-ui-server/drivers/opencode-server.mjs

UI source is conditional/hunk-selective:
src/ui/src/components/Header.tsx
src/ui/src/components/TaskList.tsx
src/ui/src/components/WorkflowRoute.tsx
src/ui/src/components/WorkflowSkillsHubOverlay.tsx (excluded pending owner proof)
src/ui/src/i18n/translations.ts
src/ui/src/types.ts

### Runtime/release tests

src/wf-ui-server/__tests__/action-registry-loader.test.mjs
src/wf-ui-server/__tests__/dispatch-lifecycle.test.mjs
src/wf-ui-server/__tests__/effort-compatibility-red-092.test.mjs
src/wf-ui-server/__tests__/runtime-review.test.mjs
src/wf-ui-server/__tests__/server.integration.test.mjs
src/wf-ui-server/__tests__/task-parser.test.mjs
src/wf-ui-server/__tests__/workflow-action-registry.test.mjs
tests/cli-smoke.test.js
tests/generator.test.js
tests/harness-intelligence-bench.test.js
tests/harness-intelligence-bench-review.test.js
tests/harness-intelligence-boundaries.test.js
tests/harness-intelligence-install.test.js
tests/harness-intelligence-policy.test.js
tests/memory-context.test.js
tests/pack-smoke.test.js
tests/research-policy.test.js
tests/review-chat-effort-092.test.js
tests/review-cross-contract-092.test.js
tests/review-effort-server-092.test.js
tests/review-server-version-092.test.js
tests/runtime-dispatch-cli.test.js
tests/runtime-review-backend.test.js
tests/task-context.test.js
tests/task-state.test.js
tests/verify-context-memory-092.test.js
tests/verify-runtime-release-cli-project.test.js
tests/verify-runtime-release-png-only.test.js
tests/wf-backend-ensure.test.js
tests/wf-learn-contract.test.js
tests/wf-update-runner.test.js
scripts/harness-intelligence-bench.mjs

Existing modified tests (cli-smoke, generator, pack-smoke, task-state, wf-update-runner)
contain both compatibility assertions and new candidate checks; include only reviewed
hunks. New test paths are candidate only when their fixture/source dependency is also
selected.

### Static fixture exact paths

tests/fixtures/runtime-092/codex
tests/fixtures/runtime-092/codex.cmd
tests/fixtures/runtime-092/pty-adapter.mjs
tests/fixtures/harness-092/boundary-global/Harness/memory/agent-lessons-patterns.md
tests/fixtures/harness-092/boundary-project/Harness/memory/agent-lessons-patterns.md
tests/fixtures/harness-092/boundary-project/Harness/memory/user-corrections-preferences.md
tests/fixtures/harness-092/boundary-project/Harness/tasks/boundary-task/PLAN.md
tests/fixtures/harness-092/boundary-project/Harness/tasks/boundary-task/REFERENCES.md
tests/fixtures/harness-092/boundary-project/Harness/tasks/boundary-task/STATE.json
tests/fixtures/harness-092/project/Harness/memory/agent-lessons-patterns.md
tests/fixtures/harness-092/project/Harness/memory/user-corrections-preferences.md
tests/fixtures/harness-092/project/Harness/tasks/legacy-task/PLAN.md
tests/fixtures/harness-092/project/Harness/tasks/legacy-task/PROGRESS.md
tests/fixtures/harness-092/project/Harness/tasks/legacy-task/STATE.json
tests/fixtures/harness-092/project/Harness/tasks/task-context-fixture/PLAN.md
tests/fixtures/harness-092/project/Harness/tasks/task-context-fixture/PROGRESS.md
tests/fixtures/harness-092/project/Harness/tasks/task-context-fixture/REFERENCES.md
tests/fixtures/harness-092/project/Harness/tasks/task-context-fixture/STATE.json
tests/fixtures/harness-intelligence-install/project/Harness/memory/agent-lessons-patterns.md
tests/fixtures/harness-intelligence-install/project/Harness/tasks/install-fixture/PLAN.md
tests/fixtures/harness-intelligence-install/project/Harness/tasks/install-fixture/REFERENCES.md
tests/fixtures/harness-intelligence-install/project/Harness/tasks/install-fixture/STATE.json
tests/fixtures/harness-intelligence-install/project/Harness/tasks/legacy-fixture/PLAN.md
tests/fixtures/harness-intelligence-install/project/Harness/tasks/legacy-fixture/STATE.json

### Static benchmark exact paths

benchmarks/harness-intelligence-092/README.md
benchmarks/harness-intelligence-092/manifest.json
benchmarks/harness-intelligence-092/report.schema.json
benchmarks/harness-intelligence-092/evidence-template.md
benchmarks/harness-intelligence-092/b1/sentinel.txt
benchmarks/harness-intelligence-092/b2/baseline-handoff.md
benchmarks/harness-intelligence-092/b2/data.json
benchmarks/harness-intelligence-092/b2/handoff.md
benchmarks/harness-intelligence-092/b2/stage1-user-prompt.md
benchmarks/harness-intelligence-092/b2/stage2-user-prompt.md
benchmarks/harness-intelligence-092/b3/user-prompt.md
benchmarks/harness-intelligence-092/b4/user-prompt.md
benchmarks/harness-intelligence-092/b5/user-prompt.md
benchmarks/harness-intelligence-092/b6/user-prompt.md

## Template and root dogfood parity

A SHA-256 read-only comparison of changed template/root pairs found 53
byte-equal pairs. The only exact pairs that qualify as parity candidates are:

templates/common/.claude/agents/review-manager.md -> .claude/agents/review-manager.md
templates/common/.claude/commands/wf-help.md -> .claude/commands/wf-help.md
templates/common/.claude/commands/wf-learn.md -> .claude/commands/wf-learn.md
templates/common/.claude/commands/wf-max.md -> .claude/commands/wf-max.md
templates/common/.claude/commands/wf-review.md -> .claude/commands/wf-review.md
templates/common/.claude/commands/wf-task-archive.md -> .claude/commands/wf-task-archive.md
templates/common/.claude/commands/wf-task-list.md -> .claude/commands/wf-task-list.md
templates/common/.claude/commands/wf-task-record.md -> .claude/commands/wf-task-record.md
templates/common/.claude/commands/wf-update.md -> .claude/commands/wf-update.md
templates/common/.claude/commands/wf.md -> .claude/commands/wf.md
templates/common/.claude/skills/wf-learn/SKILL.md -> .claude/skills/wf-learn/SKILL.md
templates/common/.claude/skills/wf-max/SKILL.md -> .claude/skills/wf-max/SKILL.md
templates/common/.claude/skills/wf-review/SKILL.md -> .claude/skills/wf-review/SKILL.md
templates/common/.claude/skills/wf-update/SKILL.md -> .claude/skills/wf-update/SKILL.md
templates/common/.claude/skills/wf/SKILL.md -> .claude/skills/wf/SKILL.md
templates/common/.opencode/agents/review-manager.md -> .opencode/agents/review-manager.md
templates/common/.opencode/commands/wf-help.md -> .opencode/commands/wf-help.md
templates/common/.opencode/commands/wf-learn.md -> .opencode/commands/wf-learn.md
templates/common/.opencode/commands/wf-max.md -> .opencode/commands/wf-max.md
templates/common/.opencode/commands/wf-review.md -> .opencode/commands/wf-review.md
templates/common/.opencode/commands/wf-task-archive.md -> .opencode/commands/wf-task-archive.md
templates/common/.opencode/commands/wf-task-list.md -> .opencode/commands/wf-task-list.md
templates/common/.opencode/commands/wf-task-record.md -> .opencode/commands/wf-task-record.md
templates/common/.opencode/commands/wf-update.md -> .opencode/commands/wf-update.md
templates/common/.opencode/commands/wf.md -> .opencode/commands/wf.md
templates/common/CLAUDE.md -> CLAUDE.md
templates/common/Harness/MEMORY.md -> Harness/MEMORY.md
templates/common/Harness/README.md -> Harness/README.md
templates/common/Harness/a2a/action-registry.json -> Harness/a2a/action-registry.json
templates/common/Harness/ownership.manifest.json -> Harness/ownership.manifest.json
templates/common/Harness/project/architecture.md -> Harness/project/architecture.md
templates/common/Harness/scripts/README.md -> Harness/scripts/README.md
templates/common/Harness/scripts/task-state.mjs -> Harness/scripts/task-state.mjs
templates/common/Harness/scripts/validate-harness.mjs -> Harness/scripts/validate-harness.mjs
templates/common/Harness/scripts/wf-ui-control.mjs -> Harness/scripts/wf-ui-control.mjs
templates/common/Harness/scripts/wf-update-check.mjs -> Harness/scripts/wf-update-check.mjs
templates/common/Harness/scripts/wf-update-runner.mjs -> Harness/scripts/wf-update-runner.mjs
templates/common/Harness/specs/guides/SETUP.md -> Harness/specs/guides/SETUP.md
templates/common/Harness/specs/protocols/MEMORY_PROTOCOL.md -> Harness/specs/protocols/MEMORY_PROTOCOL.md
templates/common/Harness/specs/protocols/TASK_ARCHIVE.md -> Harness/specs/protocols/TASK_ARCHIVE.md
templates/common/Harness/specs/runtime/context-loading.md -> Harness/specs/runtime/context-loading.md
templates/common/Harness/specs/runtime/dispatch.md -> Harness/specs/runtime/dispatch.md
templates/common/Harness/specs/runtime/subagents.md -> Harness/specs/runtime/subagents.md
templates/common/Harness/specs/workflows/WF-AUTO-SPARK.md -> Harness/specs/workflows/WF-AUTO-SPARK.md
templates/common/Harness/specs/workflows/WF-AUTO.md -> Harness/specs/workflows/WF-AUTO.md
templates/common/Harness/specs/workflows/WF-KERNEL.md -> Harness/specs/workflows/WF-KERNEL.md
templates/common/Harness/specs/workflows/WF-MAX.md -> Harness/specs/workflows/WF-MAX.md
templates/common/Harness/specs/workflows/WF-STATE.md -> Harness/specs/workflows/WF-STATE.md
templates/common/Harness/specs/workflows/WF.md -> Harness/specs/workflows/WF.md
templates/common/Harness/scripts/memory-context.mjs -> Harness/scripts/memory-context.mjs
templates/common/Harness/scripts/research-policy.mjs -> Harness/scripts/research-policy.mjs
templates/common/Harness/scripts/task-context.mjs -> Harness/scripts/task-context.mjs
templates/common/Harness/scripts/task-group-index.mjs -> Harness/scripts/task-group-index.mjs
templates/common/Harness/scripts/lib/memory-context.mjs -> Harness/scripts/lib/memory-context.mjs
templates/common/Harness/scripts/lib/path-scope.mjs -> Harness/scripts/lib/path-scope.mjs
templates/common/Harness/scripts/lib/research-policy.mjs -> Harness/scripts/lib/research-policy.mjs

The three non-parity pairs are:
templates/common/.harness-version -> Harness/.harness-version (generated/project scoped)
templates/common/Harness/research/README.md -> Harness/research/README.md
templates/common/README.md -> README.md
The first remains an approved generated output; the latter two are project-local/
documentation variants and must not be staged merely because the template changed.

Additional changed template exact paths that are not in the parity list:
templates/common/Harness/a2a/workflows.json (excluded)
templates/common/Harness/tasks/_template/PLAN.md
templates/common/Harness/tasks/_template/PROGRESS.md
templates/common/Harness/tasks/_template/STATE.json
templates/common/Harness/tasks/INDEX.json
templates/common/Harness/tasks/INDEX.md

These are listed for owner review only; the actual root task capsule remains excluded.

## Protected paths, warnings, and final recommendation

Keep out of selective stage: Harness/tasks/** actual task capsules/evidence/state;
root Harness/a2a/** except static action-registry exception; 3080.md;
3080-xianyu-cover.png; Harness/scripts/debug-memory-fixture2/**; Harness/wf-browser/**;
Harness/.temp/**; Harness/.runtime/**; screenshots; tmp/**; temp/**; node_modules/**;
ignored package-lock.json; ignored pnpm-lock.yaml; and benchmark runs/**, results/**,
holdout/**, private/**.

The current validator preserves known warnings rather than erasing them:
task-make-wf-lifecycle-0908 has no STATE.json, and Harness/tasks/ has six outer
capsules against displayed cap five. A clean candidate must record whether its source
checkout carries those task files; clone does not prove empty task/A2A state. Online
mirror 404/old-version results are separate availability facts, not reasons to stage
unrelated files or publish.

Recommendation: the release owner may construct a candidate from the exact metadata,
runtime, test, static benchmark, template and verified parity paths above plus unchanged
HEAD dependencies. Before staging, resolve the UI mixed hunks and src/index.js split;
if ownership cannot be proved, leave the hunk unstaged and report a reduced candidate.
No path in this review authorizes stage/commit/push, and local build/test evidence is not
a release or benchmark claim.
