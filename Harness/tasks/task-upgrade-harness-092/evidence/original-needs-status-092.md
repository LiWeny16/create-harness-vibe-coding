# 原始需求状态表（092）

日期：2026-09-09。本文只把 `PLAN/REFERENCES`、竞品定点取证和现有独立证据对回用户最初范围；不把设计、源码单测、真实测评混为一谈，也不改变 AC-01..09 的 pending 状态。`8192` 是本次某个 role/task pack 的观测预算，不是产品全局硬限；实际产品约束应以每次显式 role/task budget 为准。

| 原始需求 | 已有证据与真实结论 | 真正缺口/不能宣称 | 下一步与验收方法 |
|---|---|---|---|
| 分工哲学：父模型理解/拆分/验收，worker 有 owner、deps、read/write set；强主控与便宜模型的经济路由 | `[调研]` WF/STATE 与 Claude subagent/teams 资料支持显式分工、独立 context、共享任务消息。`[源码/测试]` task ledger、ready queue、writeSet、runtime 的 model/effort 字段和边界测试已存在。 | 当前是显式选择模型/角色，不是自动按风险/成本选择便宜 worker 的 router；也没有真实任务证明拆分质量、fan-out 控制或成本收益。父模型最终验收规则仍有效。 | 为每个 benchmark 类别预注册样本量并报告实际 `n`，记录每次 requested/effective runtime/model/effort、拆分决策、失败/重试和 `estimated`/`providerMeasured`；同模型无 Harness baseline 可行时一并跑，不能用一次结构测试代替经济收益。 |
| 全部 17 个 `wf` 命令与三 runtime surface | `[源码/测试]` registry 和 generator/mirror 检查证明以下 17 个表面存在：`wf-help`、`wf`、`wf-max`、`wf-auto`、`wf-auto-spark`、`wf-review`、`wf-learn`、`wf-browser`、`wf-readme`、`wf-update`、`wf-remove`、`wf-task-record`、`wf-task-list`、`wf-task-archive`、`wf-command-create`、`wf-ui`、`wf-init`；每行有 Claude/OpenCode skill/Codex/help 等注册字段，generator 38/38。 | 这是文件/注册表/策略覆盖，不是 17 命令各自跨 Codex/Claude/OpenCode 的 live E2E。部分只测 policy、镜像或 fixture；`wf-auto*` 没有连续自动周期，`wf-remove` 没有完整破坏性流程验收，`wf-ui` 尚非安装候选验证。 | 保留每命令行为矩阵，按风险优先补命令级 CLI/API smoke 和独立 reviewer；验收需区分 surface-exists、local behavior、fresh-installed behavior，不能把 38/38 写成全命令可用。 |
| task context 自动保鲜、压缩、恢复 | `[源码/测试]` `task-context.mjs` 有 update/show/pack、immutable intent、path/url/partial-scope、role/task 过滤与恢复；预算/便携性回归已绿，本次最终 verifier pack 观测 `7058/8192`，且保留原始 intent/history。 | 有 context 工具不等于流程会在每次事件后自动更新 current/nextAction/handoff/queues；当前 checkpoint 仍出现已修复事项，说明自动保鲜未证明。没有一次 clean interruption→resume 证明所有字段及时恢复，也没有重复上下文质量实测。 | 由 task-scribe 依据最新独立 evidence 做一次准确 checkpoint，最少包含 observedAt/phase、AC map、owner/deps/status/evidence、唯一 nextAction、handoff/unresolved、attempts、版本/候选 SHA/benchmark 状态；再做隔离 fresh recovery，验证原始 intent 不变、当前状态及时、pack 只加载所需内容。 |
| `wf-learn` 智能记忆：匹配、压缩、反例、冲突、淘汰/反馈 | `[源码/测试]` 已有 `query/validate/apply/feedback`、scope/evidence/counterexample/status/supersede/disable，技能要求 Probe→Identify→Act→Verify；policy/boundary tests 通过。`[调研]` context engineering 只支持有限预算与按需披露原则。 | 当前是显式 bounded top-k/bytes/filter/status 操作，不是已测好的智能质量循环；没有 independent precision/recall、反例后不再误召回、冲突替代与 stale retire 的 fresh end-to-end 结果。 | 预注册正例、反例、冲突、过期与 feedback 场景，封存 holdout；验收 scope 命中、反例淘汰、supersede/disable、重复 context 和恢复后的可追溯 evidence，而不是只验 JSON 结构。 |
| 跨 Codex/Claude/OpenCode、本地 project-local A2A、标准 A2A | `[源码/测试]` runtime 有显式 runtime/model/effort/transport、capability gate、auth-bound worker、idempotency/replay、取消及最多一次 retry/new session；B3 合法 trace 与 server/effort/identity tests 已独立通过。Codex exact `gpt-5.6-luna` 只读 model/list 成功；OpenCode 精确 `opencode/gpt-5.6-luna` 有 native xhigh metadata；Claude 仍无可信 operator capability source。 | 这些是本地/runtime-contract 证据，不是付费 provider B3。Claude 的 string-only `availableModels` 不能证明 effort；裸 OpenCode model 已要求 provider/model。`agent.start/createNode` 仍是 legacy graph/session API，不能泛称所有 typed dispatch 已支持；project-local A2A 也不是远端标准 A2A 互操作。 | 用户确认 Claude Luna/xhigh gateway/config 后，fresh benchmark 明确指定 runtime/provider/model/effort，记录 requested/effective/modelUsage 与 ACK/RESULT；否则 Claude=`UNVERIFIED`。另以标准协议 fixture/互操作对象验证字段、版本、错误语义，不能用本地 capsule 名称替代。 |
| PTY 与无 UI 后台运行、可选 UI attach | `[源码/测试]` PTY/driver 矩阵 51/51，`ensure-backend --no-open` cold/reuse/isolation 3/3，CLI 从不同 cwd 指向 `--project` 的 serverRoot/default worker cwd/context pack 2/2；浏览器检查只证明开发候选 task inspector 可读同一项目状态。 | 尚无 exact pushed candidate 的 CLI-only 安装验证、无 provider 任务、无 post-release B6；截图不是 benchmark 分数，UI attach 也不能反推 backend 自动保鲜。 | clean fresh install 后先用 CLI/no-open 启动，再 attach UI 读取同一 canonical task/index；记录 cwd/root/session/task provenance、browser optionality 和故障恢复。 |
| 条件联网与 GitHub/Hugging Face 复用 | `[调研]` `REFERENCES` 已对 Anthropic 三篇、OpenAI harness engineering、DeepSeek Harness、HF smolagents、HF ScreenSuite 做 primary-source 定点记录，含日期/commit/license、adopt/adapt/reject、反例/重查触发；未复制代码。DeepSeek 固定快照显示核心为 TypeScript/Node/Cordis plugin/workflow，另有 Python subtree/SDK 文档，不能误写成“拒绝 Python”。 | URL 存在不等于采纳或质量提升；DeepSeek/ScreenSuite 不是本地 runtime/竞品性能证明，smolagents 也不是本项目依赖。当前条件检索 ledger 是政策/证据，不是每次任务自动联网。 | 仅在能力缺口、新版本/公开 API 变化、重复失败或 benchmark 暴露时重查；每次记录 source/date/version/license/decision/counterexample/recheck。验收看可追溯引用与适配理由，不看 star/文章名或借来的分数。 |
| 竞品与真正亮点、世界一流水平 | `[调研]` Claude subagent 有独立 context/权限/摘要，teams 有 shared task list/直接消息但 experimental；DeepSeek 有 plugin/workflow seam、bounded worker/context digest；smolagents 有 managed agents/max steps/final checks。我们的候选亮点是 project-local canonical task/state + 跨 CLI + 可恢复 evidence + PTY backend + 可选 UI。 | 竞品机制不是性能对比；本项目没有公开 benchmark、同模型 baseline、holdout 或世界一流分数。因此只能称“差异化方向/候选亮点”，不能称 SOTA、世界第一、质量已领先。 | 用同一 fresh SHA、同模型 baseline、预注册 B1-B6、每类 n、独立 scorer 与 sealed holdout 取得实际结果；所有无法取得的 provider token/cost 记 `unknown`，不得由 bytes/token 估算冒充 provider measured。 |
| 精确 push SHA 后的 fresh benchmark、baseline、holdout、修复重跑 | `[计划/合同]` AC-08/09 与 BENCHMARK 已要求候选 SHA、clean install、archive hash、fresh Luna、同模型无 Harness baseline（可行时）、holdout、失败修复后 rerun；当前没有 npm publish 授权。`[现有事实]` 工作树已带 0.9.2 候选版本/生成物，但仍是 dirty tree、无候选 push SHA，现有 B1-B6 多为 fixture/prep。 | 没有 exact pushed SHA fresh install、真实 Luna B1-B6、独立 Luna scoring、holdout 或 repair/rerun；本地 PASS 不能关闭 AC-07/09，也不能用远端 404 逼迫 publish。 | parent 授权后从精确 push SHA 的隔离 checkout build/pack/install，记录 archive/installed hashes；先执行预注册 tasks 与同模型 baseline，再 sealed holdout，修复须记录失败→bounded fix→rerun，保持 holdout 标尺不降。 |
| 硬规则触发（event + gate）补充 | `[设计]` PLAN 将硬规则 event/gate、软指导 scoped memory、薄 `CLAUDE.md` 列为 supplemental candidate；现有 runtime 有部分 capability/auth/idempotency gates。 | 该补充不能挤掉上述完整调研、17 命令、context/memory、竞品、benchmark 范围；硬规则是否进入 0.9.2 仍待用户/父模型选择。也没有证明所有事件都自动发出、持久化并及时更新 task state。 | 先明确规则层选择，再以 event→gate→allow/deny→audit evidence 的负例/回滚测试验收；不以新增 gate 的单测通过改写原 AC 或把显式工具写作自动流程。 |

## 当前发布判断

本表把“调研已完成”“本地源码/测试已通过”“真实 provider/发布后测评”分开。当前仍无 exact pushed SHA、fresh install、真实 Luna benchmark、同模型 baseline 或 holdout；自动经济路由、自动 context 状态维护、记忆质量、标准 A2A 互操作也未被证明。故 AC-01..AC-09 继续 pending；发布前硬阻塞集中在独立闭环/状态新鲜度、候选版本与 SHA provenance，发布后硬阻塞集中在 fresh benchmark 与 holdout。provider token/cost 拿不到时应记录 `unknown`，本身不是额外硬门槛。

## 发布前风险 reflector

| 时间边界 | 必须满足/可正确声明的边界 |
|---|---|
| candidate push 前 | 父模型批准后，完成版本/manifest/build/test/pack 的选择性检查，确认 dirty-tree 不冒充候选 provenance，保留所有 AC pending；本轮独立 chat/effort/server/driver/lifecycle/CLI 与 portability 证据可作为 local readiness，不是 provider 成功。在线 mirrors 的旧版本/404 与本地字节一致性分开报告，不能用 npm publish 消除。 |
| 精确 push 后 | 仅在 exact pushed SHA 的 clean isolated checkout 安装/pack，记录 archive 与 installed hash，再执行逐类别预注册样本量的 fresh Luna B1-B6、同模型 baseline（可行时）、独立 scorer、sealed holdout；失败要 bounded repair→rerun→重新核 SHA，AC-09 的这些条件不能由 candidate 前单测替代。 |
| 未实现原始目标 | 自动成本/风险路由、事件驱动的自动 context 保鲜、可量化 wf-learn 匹配/反例淘汰质量、标准级远端 A2A、世界一流性能与严格 Claude Luna provider 能力仍未知/未验收；不能因本地工具或竞品机制存在而改写为已完成。 |

`task-context pack --role verifier --budget-bytes 8192` 在本次 checkpoint 的只读复测为 `6956/8192`，保留 handoff 与最新证据指针；历史 evidence/attempt 仅因 role filter 不进入该 pack，仍留在 canonical STATE 中。

## 当前调度风险 reflector（2026-09-09）

`W6-CANDIDATE-CHECKS` 的候选本地矩阵已完成，但版本对外一致性 fix/verify
仍在运行（`server.mjs:181` 仍为 `SERVER_VERSION=0.9.1`）；该登记不等于允许
stage、commit 或 push，也不等于 AC 或全部原始目标完成。精确 pushed SHA、fresh
install、真实 benchmark/baseline/holdout，以及自动路由、自动 context 保鲜、记忆
质量和标准 A2A 仍保持未完成/未验证。

本 task 之前的状态更新机制：`node Harness/scripts/task-state.mjs record
task-upgrade-harness-092 --phase verify --text "Run candidate-version and complete
pre-release checks; keep AC-01..AC-09 pending until exact-SHA/fresh benchmark gates."
--apply --json` 只更新受支持的 phase/nextAction；因公开接口没有有界 queues/workItems
写入操作，二者通过本 task `STATE.json` 的 `apply_patch` 同步，未绕过 backend node
state/A2A 禁令，也未运行 global reconcile。
