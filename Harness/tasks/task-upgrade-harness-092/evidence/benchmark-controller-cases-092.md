# Public benchmark-controller cases supplement (design only)

日期：2026-09-09。本文是父模型给 fresh-run controller 的公开运行补充，
不是冻结的 BENCHMARK.md、manifest、scorer、阈值或实测结果。所有类别暂定
`n=1`，只能称 smoke；fresh Luna 执行者与独立 fresh Luna 评分者分离，机械
oracle 与评分判断分开。不得读取或写入 sealed holdout，不在候选 push 前运行
推理或新增业务 fixture。

## B2：严格沿用已冻结 fixture

- 只使用已冻结的 data/prompts；阶段 1 与阶段 2 使用不同的 fresh Luna 进程。
  两组都必须各自执行两阶段，不能把同一进程或单阶段结果冒充恢复。
- 在每个阶段记录实际出现的假设状态；没有失败假设就写 `none`，不编造失败
  或恢复事件。fresh worker 自主选择控制工具，不预喂源码/API 解法。
- 记录 operator 配置干预及其原因；effort 只能标为 `requested` 或
  `operator-configured`，不得称作 runtime 原生发现。

## B3：dispatch/recovery receipt

- 成功产物必须是 receipt.json，语义内容为
  `{ "route": "codex-to-claude", "status": "done" }`；key 顺序与空白不计。
  成功路径只能产生一次成功副作用。
- 另行执行独立取消 dispatch；再执行一个缺少必要输入的明确失败 dispatch。
  补齐输入后，只允许一次 retry 且必须是新 session；随后 replay 同一
  dispatch，确认新增副作用为零。取消、失败、retry、新 session、replay 都
  要保留 raw trace 与关联 id，不能把多个 attempt 压成一个事实。

## B4：规则适用性与反例

- billing CLI 场景：stdout 只能有结果 JSON，诊断必须走 stderr。
- 新增的人类 README 场景应对该规则 `skip`，不能强制 README 输出 JSON；用户
  文件保护规则仍须 eligible。
- 每个教规则记录具体反例、适用范围窄化、停用条件、恢复动作和后续检索反馈，
  保留真实 trace。规则命中或 skip 都不能用提示词描述替代运行证据。

## B5：CSV parser 与条件复用

- 读取带 header 的 CSV，字段固定为 `id,currency,amountMinor,note`；必须覆盖
  quoted comma、quoted embedded newline、escaped quote。按 currency 加总
  amountMinor，使用整数运算，输出 currency→totalMinor JSON。
- 公开 smoke 数据四行：CNY 1200（note=`tea, cake`）、CNY -450（note 含换行）、
  USD 500（note 含双引号）、USD 0；期望 `CNY=750`、`USD=500`。
- 同一个 case 记录官方/maintainer 实际 lookup、版本、license、复用判断与
  复查条件；不得把手工 `split(',')` 当 parser。两组权限模型使用一致工具；
  简单 B2 不强制联网，B5 仅在实际 lookup 触发条件满足时联网。

## B6：UI/API 同一性

沿用冻结协议：必须用真实浏览器解码 PNG，并证明浏览器所见与 API task 是同一
task；关闭 UI 后 backend 仍保持运行。截图只作可追溯观察证据，不替代 API
状态或恢复判断。

## 执行边界

这些是公开 controller 设计约束，不是已执行的 benchmark。候选 push 后才可从
隔离安装目录启动 fresh Luna；每类报告实际 `n`，区分 requested/effective、
estimated/providerMeasured，provider token/cost 不可得写 `unknown`。失败只能按
冻结合同 bounded repair→rerun，并保留原始失败与 holdout 隔离。
