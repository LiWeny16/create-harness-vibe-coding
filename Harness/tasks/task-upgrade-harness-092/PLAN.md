# task-upgrade-harness-092 - PLAN

## Goal

把 Harness 从“命令/提示词覆盖较全、运行闭环证据不足”的 0.9.1 预备状态升级为可恢复、可审计、可跨运行时验证的 0.9.2 候选。父模型是唯一主控，负责理解需求、做架构取舍、调度和终验；实现/初验/评审由有界 Luna workers（`gpt-5.6-luna`, `xhigh`）完成。最终只推送 GitHub 候选 commit，绝不执行 `npm publish`。

## Intent and constraints

- 保留当前工作区所有用户未提交改动（当前含 0.9.1 预备改动）、`3080.md`/`3080-xianyu-cover.png`、`Harness/a2a/**` 本地状态与已有 task；不 reset、clean、checkout、覆盖或关闭无关任务。
- 当前流程为 WF-Standard，额外强制跨层独立验证与 reflector；不偷偷改为 `wf-max`，不使用固定人数代替依赖驱动调度。
- 任务状态是唯一可恢复事实；所有 dispatch 有 request id/owner/deps/readSet/writeSet/evidence，失败使用显式 `NEEDS_CONTEXT`/`BLOCKED`/升级路径，恢复必须幂等。
- 计划中的 API/文件边界若依赖 W0/W1 结果，标为 TBD；不得用文档占位冒充实现完成。

## Scope and write boundaries

本次 task-scribe 只写 `Harness/tasks/task-upgrade-harness-092/**`，并通过 canonical `task-state.mjs` 更新允许的全局 pointer/index。后续实现 workers 才能在父模型主控批准的 disjoint claims 内修改 `templates/common/`、root dogfood mirrors、runtime/CLI/UI/tests；worker 不得写任务状态、memory 或无关用户文件。父模型不直接写源码。

禁止：擅自发布 npm、读取开发仓库上下文来替代安装后测试、把估算 token/成本称为 provider 实测、无来源声称 SOTA/世界第一、修改已有任务事实或 `Harness/a2a/**` 状态文件。

## Scope checklist (preserved; not an acceptance downgrade)

The following scope remains additive to AC-01..AC-09. A checked item means it is
retained in the plan, not that implementation or acceptance has passed:

- [x] Task decomposition and economic/cost-aware routing.
- [x] Complete audit of all 17 `wf` command surfaces.
- [x] Context-pack generation, dispatch consumption, and recovery.
- [x] `wf-learn` memory scope, retrieval, counterexamples, and feedback.
- [x] Cross Codex/Claude/OpenCode/A2A dispatch plus first-class PTY.
- [x] Browser-free on-demand backend with optional UI attach to the same task.
- [x] Appropriate web lookup and official GitHub/Hugging Face reuse ledger.
- [x] Competitor/SOTA-gap analysis and differentiated selling-point direction.
- [x] Independent acceptance, baseline, and estimated-versus-provider metrics.
- [x] 0.9.2 candidate push with an explicit no-`npm publish` boundary.
- [x] Post-push fresh install, real tasks, held-out tasks, repair, and rerun.

The note “CLAUDE core philosophy routing + hard rules triggered on demand” is a
supplement only; it must not replace the comprehensive research, upgrade, or
benchmark scope above.

## Supplemental rules-policy (design candidates only)

This is an architectural candidate and a pending implementation decision, not a
claim that the product already implements it:

- Hard rules are candidates for event emission plus an explicit gate.
- Soft guidance is a candidate for scoped memory retrieval.
- `CLAUDE.md` should remain a thin router/core-philosophy file.
- No authorization is granted here to change GitHub branch protection or other
  branch-rule settings.

## Acceptance criteria

| ID | 独立验收标准 | 必要证据 | Status |
|---|---|---|---|
| AC-01 | 审计全部 17 个 wf 命令及三运行时 surface；给出卖点、SOTA 差距、能力空洞和 reuse ledger。 | 命令×surface×行为矩阵；官方/作者来源、版本/许可、adopt/adapt/reject 理由、重查触发和证据路径；不得自称第一。 | pending |
| AC-02 | 任务记录原始/当前意图及变化、约束、事实/假设、决策/否决、证据/时效、失败尝试、owner/deps、交接/下一步；旧 task 可迁移/读取。 | STATE/PLAN/PROGRESS schema 兼容测试、关闭/中断/恢复演练、legacy fixture 对比。 | pending |
| AC-03 | 按 role/task 生成有限 context pack，实际被派发和恢复消费；原始日志不全量注入。 | pack 内容/预算/证据指针、派发 request id、恢复后消费日志与重复上下文指标；超预算和缺上下文分支。 | pending |
| AC-04 | memory + `wf-learn` 记录适用范围、证据、反例、冲突/替代/停用、检索反馈并去重压缩，不把单样本变全局禁令。 | 正例/反例/冲突/过期检索与 Probe→Identify→Act→Verify 结果；工具可执行且资源路由按需加载。 | pending |
| AC-05 | 运行时/model/capability 显式选择；跨 Codex/Claude/OpenCode/A2A 派发、状态关联、失败升级、恢复幂等可运行。 | CLI/API/PTY/A2A 往返记录、request-id 幂等断言、故障升级矩阵、runtime capability probe；不依赖 undocumented config。 | pending |
| AC-06 | 后台按需启动/复用，无需先开页面；现有 UI 读取同一 canonical task/index，可随时查看与接管。 | 纯 CLI 冷启动→任务→UI 打开→状态一致的真实演练；server/UI/API 证据。 | pending |
| AC-07 | 独立行为测试与必要真实 CLI/API/浏览器验收；baseline/cost 区分估算与 provider 实测。 | verifier 与 reviewer 独立；命令、运行时、浏览器证据；成功率、耗时、恢复次数、重复 context、成本来源字段。 | pending |
| AC-08 | 0.9.2 版本与 mirrors/manifest 一致，必要 build/test/pack/回归通过；候选分支推送并核远端 SHA，npm 不发布。 | package/模板/root 版本检查、pack 文件清单、`git diff --check`、远端 `rev-parse`；明确 no-publish。 | pending |
| AC-09 | GitHub 推候选精确 commit 后，在全新测试目录安装该 commit 对应产物；父模型主控设计探测 tasks，fresh Luna 执行、其他 Luna 评分，保留 holdout，失败修复后重跑并再次推送。 | 测试目录/安装来源 SHA/包 hash；不可读取开发仓库；benchmark 记录成功率、返工、恢复、步骤/时间、provider 可得 token/cost（不可得为 unknown）；holdout 未改评分期望。 | pending |

## W0 scheduling and dispatch contract

所有 worker 默认 `gpt-5.6-luna` + `xhigh`；父模型主控只提供目标、上下文包和边界，不把整仓日志注入。`STATE.json` 的 ready queue/dispatch ledger 是持久调度事实，以下是依赖驱动而非固定人数的首波：

| ID | Role / model | 阶段与依赖 | Read set | Write set | Return / gate |
|---|---|---|---|---|---|
| W0-PLAN | task-scribe/planner；Luna xhigh | done | CLAUDE、WF/STATE、README、task-state、git baseline | 本 task capsule + canonical pointer/index | 初版 AC、风险、W0 表、证据索引 |
| W0-EXTERNAL | `external_research`；Luna xhigh | explore；ready→done（首报已回） | WF command surfaces、research router、官方/作者资料 | 报告/ledger 建议；不改源码 | 17 command coverage；reuse/adapt/reject；SOTA gap 与触发条件 |
| W0-RUNTIME | `runtime_routing`；Luna xhigh | explore；ready | `src/**`, `bin/**`, Harness scripts/runtime specs, package, git | 报告/架构建议；不改源码 | runtime/PTY/A2A/UI 启动与恢复边界、脏树基线 |
| W1-ARCH | architect；Luna xhigh | plan；依赖 W0 两报 | W0 synthesis + selected source | task plan/API contracts only | 决定 state/context/memory/runtime/UI/release ports；未决项显式 TBD；由父模型审批冻结 |

W0-EXTERNAL 首报（待父模型主控核原始链接/许可）已指出：17 个 wf 命令有 surface 覆盖；动态 ready queue、分层 memory 方向合理，但提示词合同缺运行闭环和成本证据，不能自称 SOTA。候选参考包括 Anthropic effective-agents/context-engineering/long-running-harnesses、OpenAI harness-engineering、DeepSeek-Harness（官方 MIT 开发预览）、Hugging Face smolagents（managed_agents/max_steps/final_answer_checks，借鉴接口思想而不引 Python 依赖）、HF ScreenSuite 层级评测。触发联网/检索仅为能力缺口、用户求新、公开 API/版本变化、重复失败或 benchmark 暴露不足；每次记录版本/许可/证据/适配结果，不将所有任务强制联网。

W0-RUNTIME 首报已回：现有 runtime/A2A 已有 typed `create/start/restart/sendMessage/readMessages`；A2A 有 `messageId/threadId/requestId/replyTo/contextRefs`；peer-capsule 有 `REQUEST/STATE/events/RESULT`。实现应复用并绑定这些 surface，不重建平台；缺口聚焦 dispatch 幂等、恢复、ack-result 状态。后台自动准备/复用与 UI 可选 attach 作为独立 AC-06，不能假定必须先开页面。Git 基线为 branch `agent/wf-ui-state-checkpoint-20260804`、HEAD `0212e16`、HEAD 语义为 0.8.21 而工作树已含 0.9.1 预备改动；release 默认推当前分支，绝不擅自切 main。

## Phase dependencies after W0

1. **W1 Architecture gate**：W0 两报 + 父模型主控决策；冻结最小 state/context/memory/runtime/UI/release contracts，复用现有 typed/A2A primitives，补 idempotency/recovery/ack-result，保留 alternatives/rejected reasons。
2. **W2 Contract/test gate**（可并行）：AC-linked schema/API/PTY/A2A/UI/benchmark contracts；先写 RED/behavior tests 与 post-release holdout protocol。
3. **W3 Implementation waves**：按 disjoint file claims 串行或安全并行；state/context → memory/wf-learn → runtime routing/CLI/A2A/PTY → UI bridge → docs/mirrors/version。每波 verifier，任何 schema/API 改动回 W1/W2。
4. **W4 Independent validation + review**：实现者不验证同一 AC；真实 CLI/API/浏览器按需运行，reviewer 只读评审 scope/AC/安全/回归。
5. **W5 Reflector gate**：汇总 verifier/reviewer，冲突或高风险必须 PASS；失败回 debugger→verify→review，不改验收期望掩盖失败。
6. **W6 Candidate release**：Luna release worker 在父模型终验批准后仅 bump 0.9.2、build/version/check/test/pack、GitHub 分支 push/远端 SHA 核对；npm publish 明确跳过。父模型保留最终审批权。
7. **W7 Post-release benchmark**：从该精确 GitHub commit/候选产物在全新目录安装，fresh Luna 执行父模型设计的探测 tasks，其他 Luna 评分；至少一组 holdout 未参与实现，失败则修复→重跑→再 push→再核 SHA。

## Benchmark contract (AC-09)

安装后的 Harness 必须执行且不能读开发仓库内部上下文：

- install/upgrade 不污染用户文件；
- 多步需求变更 + 中断恢复；
- Codex→Claude/OpenCode 跨 CLI 消息往返且不重复执行；
- 小型 task context pack 恢复；
- `wf-learn` 正例/反例/冲突适用检索；
- reuse-first 外部证据决策；
- 纯 CLI 启动后台，再打开 UI，观察同一 task 状态。

父模型主控预先写每个 scenario 的目标/预期结果；fresh Luna 执行，独立 Luna 评分，父模型判断并记录反例/返工。B2 fixture 固定为 records `a=1200 CNY`、`b=600 CNY`、`r=-450 CNY`，初始 sum=1350；`--exclude-refunds` 后 sum=1800，fresh recovery agent 仅凭 task context 实现新 flag 且保持无 flag 原输出，失败假设不能复活。每类 benchmark 单独报告 `n`，单次仅称 smoke，并尽量提供同模型无 Harness baseline（无法同条件时明确说明）。指标必须拆分 `estimated` 与 `providerMeasured`；provider 不可得时写 `unknown`，不得以 bytes 或 token 粗估冒充费用。结果存于新测试目录/任务 artifact，不写回开发仓库上下文，holdout 的评分阈值不可为失败后调低。

## Baseline facts and safe release advice

- 初始基线时 `package.json:3` 与 `Harness/.harness-version` 为 **0.9.1**；当前工作树已带 0.9.2 candidate/generated artifacts。HEAD 为 `0212e16`（`agent/wf-ui-state-checkpoint-20260804`），仍不是精确已推送候选。
- `git status --short` 基线报告大量用户修改；`git diff --stat` 报告 112 个 tracked paths、3,974 insertions/1,425 deletions；另有 untracked 3080 资产、A2A node 状态、task index/archive 等。数值仅是本次命令快照，不代表本 task ownership。
- 保留脏树的安全发布顺序：先记录 status/diff/hash；worker 仅按 claim 写；每波用 `git diff --check` 与 path allowlist；不 reset/clean/checkout；版本同步用既有 `npm run build:version` 机制而非手改 checksums；最终只 stage/commit/push 主控批准的 task 产物和源码，核对本地/远端 SHA。用户明确禁止 npm publish，故 README 既有 npm 发布门槛只作历史事实，不作为本 task 授权。

## Decisions and unresolved choices

| ID | Decision / question | Reason / next owner |
|---|---|---|
| D-001 | WF-Standard + 独立验证 + 风险触发 reflector，不切 wf-max。 | 用户指定；父模型主控 |
| D-002 | 所有 worker Luna xhigh；父模型主控 owns framing, dispatch, and final acceptance. | 用户指定；父模型主控 |
| D-003 | task state 是 canonical；context/memory 只按需装载，日志指针化。 | WF-STATE/context-loading 现有契约；W1 |
| D-004 | 外部方法采用 adopt/adapt/reject ledger，许可证与证据必填。 | W0-EXTERNAL 首报；W1/主控复核 |
| D-005 | 可选 `STATE.context`、`task-context.mjs` update/show/pack、UTF-8 byte budget 与 mandatory pack sections 按 `CONTRACTS.md` 冻结；legacy 只读恢复。 | W1 contract；W2 tests |
| D-006 | `POST /api/sessions` 显式 runtime/model/effort/transport，dispatch 幂等、显式 retry、PTY 句柄恢复、单调 seq/唯一 terminal 与 A2A ack-result 按 `CONTRACTS.md` 冻结。 | W0-RUNTIME + W1；W2 tests |
| D-007 | backend ensure 纯 CLI 启动/复用并加锁，UI attach 同一 canonical task/index；不要求先开浏览器。 | W0-RUNTIME + W1；AC-06 verifier |

## W1 frozen contract outputs

`CONTRACTS.md` freezes the optional `STATE.json.context` shape, deterministic
`task-context.mjs` update/show/pack CLI, mandatory pack sections and UTF-8 byte
budget, explicit session/retry/PTY/A2A/recovery rules, backend ensure/UI attach,
and memory/reuse evidence boundaries. `BENCHMARK.md` pre-registers B1-B6,
holdout isolation, same-model/no-Harness baseline handling, per-category `n`,
and `estimated` versus `providerMeasured` metrics. W1/W2 contract work is
historical; the current gate is `implementation-fix/independent-verify`.

## Current implementation-fix / independent-verify checkpoint

This checkpoint supersedes the stale `w2-red` gate while preserving the full
history and all nine pending acceptance criteria:

- Context/portability: independent context and memory checks are recorded
  green, and the self-contained portability/budget lane is 49/49 with
  `cache-diagnostics-route` at 35702/36000 bytes. The byte budget is a
  per-invocation role/task pack constraint, not a product-wide 8192 limit.
- Runtime: the latest independent chat-effort verifier is 4/4; the
  effort/server/settings matrix is 5/5; server integration is 42/42; the
  driver subset is 34/34; lifecycle plus CLI checks are 9/9; and server-version
  is 1/1 with related 43/43 green. A bounded Claude quick probe reached exact
  gpt-5.6-luna with no fallback; xhigh is requested-only and this is not a
  formal provider benchmark.
- Benchmark: B4 prep and scorer/fixture checks remain preparation evidence
  only, not the real post-release benchmark; preserve audit history and do not
  lower holdout thresholds to satisfy byte comparisons.
- Workflow/docs: generator 38/38 and intelligence policy 4/4 remain structural
  evidence; all 17 command surfaces are registered/mirrored, not 17 live
  cross-runtime E2E acceptances.
- Release: the working tree now carries candidate version 0.9.2 and generated
  artifacts; exact pushed SHA provenance, fresh install, real Luna tasks,
  same-model baseline, and holdout remain pending.
- All AC-01..AC-09 remain `pending` until the parent model performs actual
  acceptance. W6 selective staging/preflight is still running; the 0.9.2
  working-tree bump is not a GitHub push or fresh-install/real-task/holdout
  benchmark.
- Fresh-install provenance is a hard acceptance prerequisite: isolate the
  exact pushed SHA, build/pack there, and record archive hash/environment (or
  prove all installed bytes came from that SHA); a dirty-tree `npm pack` plus a
  matching remote SHA is insufficient.

## composition-api/v0.1 additive slice (preserves AC-01..AC-09)

This slice is an additive native-node composition/API-FSM contract. It does
not rename, split, weaken, or change the existing AC-01..AC-09 table above;
the original nine criteria and the `implementation-fix/independent-verify`
gate remain pending until parent-model acceptance.

### Architecture contract and reuse boundary

The authoritative contract is
`Harness/tasks/task-upgrade-harness-092/COMPOSITION-API-CONTRACT.md`.
`compositionId` reuses the snapshot `workflowId` (including
`workflow-none`); canonical state is assembled from the typed graph,
revisioned event-node state, bridge messages, and operation audit. The
contract source anchors are:

- graph/edge normalization: `src/wf-ui-server/workflow-graph-store.mjs:359-396`;
  revisioned event-node state:
  `src/wf-ui-server/workflow-event-node-store.mjs:476-525`;
  bridge persistence: `src/wf-ui-server/bridge-store.mjs:88-134`;
  operation audit: `Harness/project/architecture.md:362-371`;
- Timer ports and context/affordances:
  `src/wf-ui-server/workflow-agent-context.mjs:830-840,981-1037,1092-1151,1695-1720`;
  existing directed composition wiring:
  `src/ui/src/components/WorkflowRoute.tsx:1835-1845`;
- graph/context API surface:
  `src/wf-ui-server/server.mjs:1824-1857,1883-1888`;
  Timer action runtime: `src/wf-ui-server/workflow-node-runtime.mjs:1283-1312`;
  Agent pull: `src/wf-ui-server/workflow-node-types/agent-node.mjs:633-658`;
- wakeup and delivery: `src/wf-ui-server/timer-wakeup-scheduler.mjs:145-167`,
  `src/wf-ui-server/workflow-node-types/timer-node.mjs:353-357,385-403`, and
  `src/wf-ui-server/ws-events.mjs:234-265`;
- UI read/cache boundary:
  `src/ui/src/components/WorkflowRoute.tsx:1349-1397,3933-4007,5578-5653`;
  bounded scheduler/aggregation:
  `src/wf-ui-server/timer-wakeup-scheduler.mjs:19-25,171-225`,
  `src/wf-ui-server/a2a-store.mjs:2892-2902`.

The only new write-facing requirement is a read-only
`GET /api/workflow/compositions/:id` snapshot returning
`schemaVersion, compositionId, graphVersion, fsm, timer, agents, edges,
lastTransitions`; runtime writes continue through typed graph/node APIs.
Timer `event` is source-to-target to Agent, Agent `control` is
source-to-target to Timer with `context -> config`, and reverse control must
be rejected. FSM state is backend-owned with monotonic `stateRevision`, one
`idempotencyKey`, bridge-only `delivered`, and Agent ack/cursor for
`consumed`; UI is display/cache only.

### Incremental acceptance criteria

| ID | Scenario / required behavior | Evidence | Status |
|---|---|---|---|
| COMPOSE-AC-01 | Enforce Timer `event` output and Agent-to-Timer `control` direction/handles; reject reverse control. | API integration against `POST /api/workflow/edges`; edge relation/direction/handles plus rejection status. | pending |
| COMPOSE-AC-02 | Enforce FSM revision monotonicity and idempotency; stale expected revision is rejected and repeated key returns the original transition. | Timer action API integration with `STALE_REVISION` and one-revision duplicate assertions. | pending |
| COMPOSE-AC-03 | Route Timer fire through bridge wakeup to Agent pull/ack without PTY injection. | `timer.fire` -> `timer.dispatchWakeup` -> `agent.readMessages({wakeup:true,afterSeq})`; envelope/bridge delivery assertions. | pending |
| COMPOSE-AC-04 | Require control edge and policy for Agent Timer mutation, with explicit denial codes and audit-readable operation. | API integration for `CONTROL_EDGE_REQUIRED` and `CONTROL_DENIED`; operation metadata. | pending |
| COMPOSE-AC-05 | Rebuild Agent context and composition aggregation from canonical graph/state; UI/cache cannot become a second write source. | Context API plus read-only `GET /api/workflow/compositions/:id` schema and graphVersion assertions. | pending |

### Composition implementation and verification waves

| Wave | Role / dependency | Scope and write boundary | Gate / evidence |
|---|---|---|---|
| W2-COMPOSE-RED | test-writer; contract gate complete | `tests/node-composition-api.test.mjs` only (already present; no implementation edits) | **done**: six AC-linked API tests are RED evidence; 1 pass/5 fail recorded below. |
| W3-COMPOSE-IMPLEMENT | implementer(s); after parent confirms contract and W2 RED | serialized claims over typed edge validation, Timer revision/idempotency, wakeup envelope/ack, and read-only composition aggregation; source files only, disjoint from truth docs/tests | implementation evidence GREEN in the third-round hardening run (15/15 composition; 104/104 server/runtime/timer); independent verification and COMPOSE/AC acceptance remain pending. |
| W4-COMPOSE-VERIFY | independent verifier/reviewer; after W3 | no write set; run the composition test, targeted API checks, `git diff --check`, and AC matrix against the running server | pending; verifier must be independent of W3 and preserve the existing pending release/fresh-install gate. |

### Composition RED evidence (2026-09-10)

Command: `node --test tests/node-composition-api.test.mjs`.
Result: **6 tests, 1 pass, 5 fail**. COMPOSE-AC-04 passes its existing edge
and policy-denial checks. Failures are the expected pre-implementation gaps:
AC-01 accepts reverse control (`201` instead of rejection); AC-02 stale
revision and duplicate idempotency checks both mutate/return ordinary `200`
results; AC-03's wakeup envelope lacks `transitionId`; and AC-05 has no
`GET /api/workflow/compositions/workflow-none` route (`404`). This is test
evidence only, not acceptance or implementation completion.

## Composition hardening GREEN checkpoint (2026-09-10)

The third-round backend hardening repaired the previously recorded composition
REDs and produced **15/15 composition tests** plus **104/104 server/runtime/
timer tests**. The implementation evidence covers these targeted boundaries:

- canonical composition identity is enforced from the backend workflow
  identity; an arbitrary caller-selected composition id is not accepted as a
  second canonical state;
- wakeup delivery has durable acknowledgement/consumed semantics, so a read
  can be acknowledged and repeated reads do not silently redeliver the same
  wakeup;
- Timer event/control semantics remain separate from GitHub-trigger events;
  a GitHub trigger cannot masquerade as a Timer event or control transition.

The earlier Matrix-A/display and hardening RED entries above are retained as
historical RED evidence; the 15/15 result is the later repair run. These suite
results are implementation and regression evidence only. They do not change
the `pending` status of `COMPOSE-AC-01..05` or the original `AC-01..AC-09`;
independent verification, review/reflector, exact-SHA release, fresh install,
and post-push benchmark gates remain required.

## Frontend/backend boundary RED checkpoint (2026-09-10, historical)

Fourth-round static source-contract tests were added at
`tests/frontend-backend-boundary.test.mjs`. Command:
`node --test tests/frontend-backend-boundary.test.mjs` -> **4 tests, 0 pass,
4 fail**. The failures are intentionally preserved RED evidence, not a
frontend acceptance claim:

1. `nodeRuntimeClient.ts` does not yet expose a typed
   `WorkflowCompositionSnapshot` and `fetchWorkflowComposition()`;
2. no read-only composition snapshot cache keyed by
   `compositionId + graphVersion` is exposed;
3. `WorkflowRoute.tsx` does not read composition/context through that typed
   backend client;
4. `WorkflowRoute.tsx` still derives capsule mode/protocol-step business
   semantics locally instead of consuming backend composition fields.

Pending implementation slices, all subject to the existing source ownership
and independent-verification gate:

- add a readonly typed snapshot and GET-only `fetchWorkflowComposition` in
  `nodeRuntimeClient.ts`;
- cache only by the pair `compositionId` and `graphVersion`, with no UI write
  path for composition/FSM state;
- wire `WorkflowRoute` to backend composition/context fields and retain only
  presentation/layout geometry locally;
- remove or replace local FSM/timer/edge business aggregation, then rerun the
  four boundary tests, the UI build, and independent composition regression.

No original AC or composition AC status is changed by this RED checkpoint.

## Backend capsules projection GREEN checkpoint (2026-09-10)

The backend capsules projection is now GREEN for the composition slice: the
canonical backend composition/context projection supplies capsule business
fields, while the UI remains a read-only presentation/cache consumer. This
supersedes the local-aggregation implementation gap recorded in the
frontend-boundary RED checkpoint, but is not a claim that the complete task or
all acceptance criteria are complete.

## Frontend/backend boundary GREEN checkpoint (2026-09-10)

The fourth-round boundary repair is GREEN: `tests/frontend-backend-boundary.test.mjs`
is **4/4**, and the corresponding frontend typecheck/build checks pass. The
verified implementation slices are:

- typed readonly composition snapshot and `fetchWorkflowComposition` in
  `nodeRuntimeClient`;
- snapshot caching keyed by `compositionId + graphVersion`;
- `WorkflowRoute` as a pure backend composition projection, retaining layout
  geometry locally without recomputing FSM/timer/edge business semantics.

This is scoped frontend boundary evidence. Any original AC not covered by
these checks remains `pending`, as do any composition acceptance items not
independently verified against their contract.

## Composition HTTP benchmark checkpoint (2026-09-10)

The `node-composition-http` benchmark is **2/2 scenarios** with **16/20 HTTP
calls** observed. The scenarios and reported durations are:

1. Timer -> Agent -> Goal (approximately **2.1 s**);
2. Markdown/File/Skill/MCP -> Agent -> Display (approximately **0.65 s**).

This benchmark is supplemental HTTP evidence for these two compositions only.
It does not cover every original AC, does not replace independent review or
the release/fresh-install gates, and does not change any uncovered AC status.

## Latest verification checkpoint (2026-09-10)

The latest independent verification records the following implementation-level
results:

- composition API, composition matrix, hardening, consistency, and the HTTP
  composition benchmark: **23/23**;
- server/runtime/action regression subset: **124/124**;
- M2 UI E2E: **9/9**;
- M3 UI E2E: **29/30** in the full run, with one drag case classified as a
  flaky result; the targeted key M3 regression set is **5/5**, including the
  corrected settings contract;
- UI typecheck and production build: **pass**.

The M3 result still requires a clean full rerun and explicit flaky-test
classification before it can be treated as a release gate. The required
post-release B1-B6 benchmark is also still open: no fresh-install run from an
exact pushed SHA, real Luna execution/scoring, same-model baseline, or holdout
run has been recorded. The P0/P1 backend API completeness/state-machine audit
is unfinished. Therefore all `AC-01..AC-09` and `COMPOSE-AC-01..05` remain
`pending`; no commit, push, or `npm publish` is authorized by this task.

## Risks

| Risk | Mitigation | Status |
|---|---|---|
| 用户脏改动与 worker 改动混淆 | baseline + claims + path allowlist；不清理工作树 | open |
| 外层 task 数量超过索引 max-five 提示 | 保留旧任务、记录 warning，不能为释放 cap 擅自 archive | open |
| 只实现提示词合同而无运行证据 | AC-03/05/06/07/09 强制真实运行/安装后 benchmark | open |
| 外部材料时效、许可或 API 不确定 | primary source + 日期/版本/许可证 + recheck trigger；无证据不 adopt | open |
| provider token/cost 不可观测 | 记录 unknown，与估算分栏 | open |
