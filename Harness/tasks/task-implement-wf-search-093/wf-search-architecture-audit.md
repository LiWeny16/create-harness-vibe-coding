# wf-search 架构调研与设计修订

日期：2026-09-13。
调查模型：用户指定的 GPT-5.6 Luna，reasoning effort=xhigh；主代理另行抽查关键源码。
范围：当前工作树静态架构、命令/安装/更新/卸载/测试/发布约定。没有修改产品仓库、提交或发布，没有执行完整测试，也未验证线上渠道当前状态。

仓库根：`D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding`。下表源码路径均相对此根，行号为调查时位置。

## 已核实事实

| 事实 | 源码位置 | 对设计的影响 |
|---|---|---|
| 命令 registry 包含 classification、entersWf、taskCapsulePolicy；当前无 wf-search | templates/common/Harness/specs/runtime/command-surface.json:5；templates/common/.claude/commands/wf-command-create.md:18 | 新增命令必须覆盖声明的跨运行时入口与帮助/校验/清理 |
| direct 辅助操作与显式 WF 生命周期有区别 | CLAUDE.md:47、61、69 | wf-search 可设计为 direct，但不能降级已有 WF 任务 |
| Skill 镜像覆盖全部子文件 | src/generator.js:499、535；scripts/lib/ownership-manifest.mjs:150 | references 自动镜像，不需要另建 .agents 模板树 |
| global bridge 与共享 runtime 分离 | src/generator.js:298、378、1016；tests/validate-harness.test.js:254 | global 项目没有本地脚本也可能是正常安装；脚本根与项目数据根要分开 |
| global metadata 包含 globalDir | src/generator.js:378；Harness/scripts/wf-update-runner.mjs:110 | 可借鉴已有 runtime 发现逻辑，但 search 需检查自己的脚本 |
| 研究角色禁止写文件 | templates/common/.claude/agents/researcher.md:27；templates/common/.claude/agents/docs-researcher.md:27 | 不让它们执行写状态的 reserve/ingest；持久化归 controller |
| research-policy 是触发 gate 与引用记录器 | Harness/scripts/lib/research-policy.mjs:28、44、65 | 没有工具调度、研究状态机或通用证据数据库 |
| 搜索说明允许可选工具及 fallback | templates/common/Harness/research/README.md:42 | 使用宿主实际工具，不要求付费工具，不把 Skill 安装等同可调用 |
| preserve 没有覆盖所有 research 文件 | scripts/lib/ownership-manifest.mjs:16；templates/common/Harness/scripts/wf-update-check.mjs:146；Harness/scripts/wf-remove.mjs:50 | 新报告目录需要明确保护规则与回归测试 |
| remove 扫描 research；无 checksum 的未知文件可列为 modified | Harness/scripts/wf-remove.mjs:407、491 | 不能声称新报告天然是 USER，也不能推断一定被自动删除 |
| path-scope 检查 lexical 与 realpath 归属 | Harness/scripts/lib/path-scope.mjs:14、46、54 | 保存路径检查可复用；须测试新调用方式 |
| 测试临时目录位于 Harness/.temp | tests/support/temp-root.js:4 | 可沿用隔离临时目录，不能据此声称已有通用 run 管理器 |
| validator 检查 cwd | Harness/scripts/validate-harness.mjs:6；.github/workflows/ci.yml:20；scripts/pre-push-check.mjs:15 | 在相同 cwd 执行根/模板脚本不等于独立验证两棵树 |
| npm test 仅匹配 tests/*.test.js | package.json: scripts | .mjs 服务端测试与浏览器 E2E 需要单独覆盖 |
| UI E2E 默认以 repoRoot 作为项目 | src/ui/playwright.config.ts:5、29 | 在隔离候选运行，避免对用户原工作区造成状态变化 |
| pack smoke 检查 UI dist 与大小等约束 | tests/pack-smoke.test.js:7 | 发布前要从最终代码构建，不能只依赖本机旧 dist |
| 发布要求 npm、canonical GitHub 与 legacy mirror 配套 | README.md:265 | 代码就绪与渠道发布完成是两个状态 |

## 旧草案的修正

1. 原草案的九命令运行状态机、预算预留、锁和恢复机制是新增系统，不是已存在能力。V1 移除，保留 Skill 预算纪律与无状态检查。
2. 原草案的项目相对脚本示例只适合 full/project install。修订版统一表达 runtimeRoot/projectRoot，加入 global bridge 与 host-global 测试。
3. 原草案把“保存后应被保护”写成要求，但未清楚说明现有规则缺口。修订版明确新增 search/** 保护及 update/remove 回归。
4. 原草案强调研究角色只读，却同时要求共享协议登记文件状态。修订版把 helper 设为无状态，保存归 controller。
5. 原草案保留两个 validator 调用，但没有说明它们实际目标相同。修订版区分现有 gate 与 fresh generated project 验证，不允许换目标隐藏原失败。

## 选定设计（这是建议，不是已实现事实）

`薄命令 → Skill 来源选择和真实工具调用 → 结构化结果 → 无状态 validate/render → controller 可选保存`

四种模式：fact、verify、compare、troubleshoot。三个预算档：quick、standard、deep。预算只约束协议内记账，不能强制宿主限流；证据结构校验不能证明语义真实性。

项目独立研究报告建议放 Harness/research/search/**，任务研究报告放任务 evidence/wf-search/**；前者要显式新增保护规则。不开新 UI，不建立独立 super-research 包，不自动加载全部平台说明。

## 未验证项

- 0.9.3 实现尚未开始，没有行为/性能/安装/升级验收结果。
- 全部当前 dirty 改动的归属与完整前置依赖尚未收敛。
- 先前 UI failed 记录不证明现在仍然失败，也不证明已修复，需要隔离候选重跑。
- 线上 npm/GitHub refs、发布权限、真实搜索工具认证状态未在本架构调查中核验。
- Node 18/Linux 与各 Agent 宿主的真实行为兼容性需在实现后验证。

配套实现提示词已根据本报告修订，可交给 Claude 开始实施；最终发布仍以 Codex 对候选代码和安装包的独立验收为准。
