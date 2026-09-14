# wf-search V1 设计合同（DESIGN / CONTRACT GATE）

状态：设计定稿，进入 TEST-GATE。行号引用为 2026-09-13 当前源码。

## 1. 当前源码事实复核（与提示词第 1 节对照）

| 事实 | 当前验证 | 结论 |
|---|---|---|
| command-surface.json 无 wf-search，17 个命令 registry | templates/common/Harness/specs/runtime/command-surface.json（17 条） | 需新增第 18 条 |
| Skill 镜像覆盖全部子文件 | src/generator.js:536-541 `createCodexSkillMirrors` 把 `.claude/skills/**` 全量映射到 `.agents/skills/**` | references 子目录自动镜像，无需另建 .agents 模板源 |
| global bridge 分离 runtime/project | src/generator.js:298-373 createGlobalProjectBridgeSpecs；installMetadata 378 写 globalDir | helper 需区分 runtimeRoot/projectRoot |
| researcher/docs-researcher 禁写 | templates/common/.claude/agents/researcher.md:27 等 | helper 无状态，保存归 controller |
| research-policy 是触发 gate + 引用记录 | Harness/scripts/lib/research-policy.mjs（decide/validateReference/recordReference） | 不改其合同；新 community/news 不回流旧 record |
| validator 按 cwd | Harness/scripts/validate-harness.mjs:6 | root 与模板双跑仅覆盖 dogfood |
| npm test 仅 tests/*.test.js | package.json scripts.test | 新测试必须 .test.js；.mjs 单独 node --test |
| remove 未知文件归 modified | Harness/scripts/wf-remove.mjs:512,522 `not in checksums` → modified | research/search/** 需要 USER_DATA + PURGEABLE 显式规则 |
| preserve 无 research/search | scripts/lib/ownership-manifest.mjs:16-27 PRESERVE_PATTERNS；Harness/.harness-version CHECKSUM_EXCLUDE（generator.js:10-22）；wf-update-check.mjs:147-158 | 四处都要加 `Harness/research/search/**` |

新增核实：

- 092 记录的 5 个门禁失败在当前工作树：wf-learn mirror 已同步、manifest frameworkOwned 缺失为 0、INDEX.json 断言对应 `templates/common/Harness/tasks/INDEX.json`（untracked 已存在）。UI build 失败根因已由 unstaged nodeRuntimeClient.ts:307/377/400 composition 导出修复。verify 阶段仍须全量重跑。
- `HARNESS_HOST_GLOBAL_HOME` 与 `HARNESS_GLOBAL_HOME` 是既有隔离钩子（src/generator.js:179-193、tests/cli-smoke.test.js beforeEach）。
- context-budget 四条 route 已存在（Harness/scripts/context-budget.mjs），wf-search 文档不进入这些 route，不触发预算变更。
- check-script-mirrors.mjs 只列 5 个脚本，不含新脚本；research-policy.mjs 走 anti-drift byte-identical 之外的模式（无强制镜像 gate），但 wf-search 脚本按仓库惯例保持 root/template 一致并由 anti-drift 现有 pairs 机制选择性覆盖——为避免扩大 gate 面，wf-search.mjs/lib 不加入 MIRROR_PAIRS，改由 wf-search-install.test.js 断言模板/镜像一致。

## 2. PRD（为什么做）

用户在 Harness 已有 research 协议（触发 gate + 引用记录）但缺少"执行搜索并产出可校验证据报告"的命令。V1 提供 `/wf-search`：把一次真实工具搜索组织为结构化 ledger（operations/sources/claims），由无状态 Node helper 校验记账与引用完整性，渲染为 Markdown 报告；controller 可选保存。落点 0.9.3。

非目标：不做 run 状态机、reserve/ingest 账本、锁、断点恢复、自动安装工具、专用搜索后端、新 UI、宿主工具硬限流、语义真实性证明。

## 3. 组件合同

### 3.1 命令 wrapper（templates/common/.claude/commands/wf-search.md，opencode 镜像同文件内容）

- classification=direct；正文含 `direct command`、`Do not invoke a skill`（validator 硬校验）；≤80 行。
- 职责：参数解析语义（`--mode auto|fact|verify|compare|troubleshoot`、`--depth quick|standard|deep`、`--task <task-id>`、`--save`）、指示加载 SKILL.md；不复制研究算法。
- auto 模式由 Agent 解析主模式；helper 只接受四种主模式。

### 3.2 Skill（templates/common/.claude/skills/wf-search/SKILL.md）

- frontmatter：name wf-search；description 说明 Codex 兼容入口。
- ≤180 行；加载顺序：SKILL.md → 命中模式 policy → source-routing → tool-adapters → evidence-contract（按需，不预载全部）。
- 四 policy 文件 + source-routing.md + tool-adapters.md + evidence-contract.md 放 references/。

### 3.3 Node helper（templates/common/Harness/scripts/wf-search.mjs + lib/wf-search.mjs）

CLI（lib 导出纯函数 `validateResearchResult(input)`、`renderResearchResult(validated)`、`normalizeSourceUrl(url)`；CLI 只做 IO）：

```text
node <runtimeRoot>/Harness/scripts/wf-search.mjs validate --input <abs-file>|-
node <runtimeRoot>/Harness/scripts/wf-search.mjs render --input <abs-file>|-
node <runtimeRoot>/Harness/scripts/wf-search.mjs resolve-save-target --project <abs-root> [--task <id>] --id <report-id>   # 纯路径验证，不写盘
node <runtimeRoot>/Harness/scripts/wf-search.mjs --help
```

- validate：读文件或 stdin，≤1 MiB 输入上限；输出 JSON `{ok, errors[{code,path,message}], warnings[], summary{mode,depth,operations,sources,claims,status,overBudget}}`；结构非法或超预算 exit 1，未知参数/命令 exit 1，`--input -` 从 stdin 读。
- render：先 validate，非法拒绝（exit 1）；只渲染 ledger 内事实；转义所有 source/claim 文本（HTML 实体 + 剥离 Markdown 链接语法 → 纯文本），URL 仅 http/https 才渲染为链接。
- 副作用契约：只读输入文件、只写 stdout/stderr；不建目录、不写缓存/锁/报告；无网络；无子进程。
- 依赖：仅 node:fs/path/util，零新增 npm 依赖。

### 3.4 Schema（schemaVersion=1）

按提示词第 8 节字段原样实现。关键校验规则（lib 内实现，逐条对应测试）：

1. 必填/类型/长度：question 1-500；claim.text 1-2000；excerpt ≤2000；id 格式 `^[a-z0-9][a-z0-9-]{0,63}$`；重复 id 拒绝。
2. 枚举：mode 四值、depth 三值、sourceType 六值、access 三值、claim.kind 四值、importance 两值、status 三值、confidence 三值、operation.kind 两值、operation.outcome 三值。
3. 悬空引用：claim.supportIds/contradictionIds/dependsOnClaimIds、source.operationIds 必须解析存在；claim 依赖环检测（DFS）。
4. 日期：publishedAt/retrievedAt/checkedAt 为 ISO-8601 字符串或 null；`Date.parse` NaN 拒绝；publishedAt null 合法（不编造日期）。
5. 预算：quick 2 query/3 read、standard 6/10、deep 12/20；按 operations 计数（kind=search 计 query、kind=read 计 read），outcome=failed/unavailable 也计数；超限 errors（WFR-EBT001）。用户可降预算（constraints 里可选 overrides），不可升。
6. supported 的 kind=fact/major claim 至少一条 support 来自 access≠snippet 的 source；否则 error（WFR-EVD001）。
7. major claim status insufficient/disputed → 整体 status 必须 incomplete；complete 但存在未解释重大反证 → error（WFR-STA001）。
8. inference/recommendation 的 supportIds 非空（WFR-EVD002）；community-observation 的 claim.text 不得声称超出观察范围的关键词断言（仅 warning 级提示）。
9. URL：仅 http/https；规范化仅移除已知跟踪参数（utm_*, fbclid, gclid, msclkid, ref_src）；保留其他 query 与 fragment；跨域不合并；originGroup 需显式。
10. 转义：render 阶段对 title/excerpt/question/text 做 HTML 实体转义；`[text](url)` 模式拆为纯文本；http/https 外协议 URL 不渲染为链接。

### 3.5 runtimeRoot 发现（Skill 文档 + 测试固化，不建全仓库新函数）

1. 项目有 `Harness/scripts/wf-search.mjs` → runtimeRoot = projectRoot。
2. 否则读 `Harness/.harness-version` 的 `globalDir` → 校验 `<globalDir>/Harness/scripts/wf-search.mjs` 与 manifest 存在 → runtimeRoot = globalDir。
3. 否则 `HARNESS_GLOBAL_HOME` → 同样校验 helper 本身存在（不复用 updater 的"可运行更新器"检测）。
4. 否则报明确错误，不猜测。
保存路径恒用 projectRoot；host-global Skill 用自身位置定位 references。

### 3.6 Controller 保存（主 Agent 行为，Skill 文档描述流程）

- `--save` → `<projectRoot>/Harness/research/search/<report-id>/{report.md,research.json}`。
- `--task` → `<projectRoot>/Harness/tasks/<id>/evidence/wf-search/<report-id>/` + REFERENCES.md 追加索引行；任务不存在则报错不建。
- `--task`+`--save` 同给只存任务版。report-id `^[a-z0-9][a-z0-9-]{0,63}$`；路径经 scopedPath/scopedTaskDirectory（复用 path-scope.mjs）验证；已存在异内容不覆盖，同内容幂等。
- 只读角色不执行保存；保存前 validate→render→写→读回核对。

## 4. 保护规则改动（四处 + remove）

| 文件 | 改动 |
|---|---|
| src/generator.js CHECKSUM_EXCLUDE | 加 `/^Harness\/research\/search\//` |
| scripts/lib/ownership-manifest.mjs PRESERVE_PATTERNS | 加 `Harness/research/search/**` |
| Harness/scripts/wf-update-check.mjs PRESERVE_PATTERNS（root+template 同步） | 加 `/^Harness\/research\/search\//` |
| Harness/scripts/wf-remove.mjs（root+template 同步）：USER_DATA_PATTERNS 与 PURGEABLE_HARNESS_DATA_PATTERNS | 各加 `/^Harness\/research\/search\//` |

语义：报告是用户数据——更新永不覆盖；remove 默认列为 user/never，显式 `--purge-user-data` 才清。其它 research 框架文件行为不变。

## 5. Registry 与三端同步（wf-command-create checklist）

- command-surface.json（templates + root）加 wf-search：classification=direct、entersWf=false、taskCapsulePolicy=none、aliases 三形态、surfaces 全 true。
- templates/common：`.claude/commands/wf-search.md`、`.opencode/commands/wf-search.md`、`.claude/skills/wf-search/**`（SKILL + 7 个 references）。
- root dogfood 镜像：`.claude/commands/`、`.opencode/commands/`、`.claude/skills/`、`.agents/skills/`（generator 镜像机制自动覆盖 references 子文件）。
- CLAUDE.md（templates+root）direct 别名清单追加三形态；`.claude/rules/ecc/common.md`（templates+root）exclusion 行追加三形态；两个 wf-help.md（templates+root，claude+opencode 共 4 文件）加 help row；Harness/README.md（templates+root）：第 7 行 direct 清单 + Load By Task 行 + Direct Commands 表 + Skill Commands 段落更新；Harness/MEMORY.md（templates+root）Skills 区加行。
- Harness/scripts/wf-remove.mjs（templates+root）BUILT_IN_SKILL_NAMES/BUILT_IN_COMMAND_NAMES/CLEANUP_DIRS 加 wf-search（validator 硬校验）。
- validate-harness.mjs 不需改（command-surface 驱动已自动化）；但需跑双份确认。
- tests/anti-drift.test.js 现有规则自动覆盖新命令（ECC exemption、remove registries、byte-identical pairs 无需新增——新文件对不加入 pairs）。
- 用户 README.md/README-CN.md：加 /wf-search 命令行（中文 README 同步）。
- 修复 092 残留：Harness/scripts/README.md:67 的 `research-policy ... --project .` 文档漂移（在 write set 内）。

## 6. 测试矩阵（TEST-GATE 产物清单）

新文件：

- tests/wf-search.test.js（.js，npm test 自动收集）：lib 纯函数 + CLI spawn。覆盖 AC-001/AC-002 全部规则 + 提示词第 11 节 10 场景的 fixture 回放。
- tests/wf-search-install.test.js：command/skill/references 模板存在与镜像一致、registry 条目、ECC/CLAUDE/README/help 行、remove 注册表、保护规则四处、runtimeRoot 发现规则、resolve-save-target 路径安全（穿越/junction/symlink 越界拒绝）、pack 包含命令/Skill/references/helper。
- tests/fixtures/wf-search/**：10 个场景 fixture JSON（valid 版本 + 各错误变体）。

真实 Agent 场景（verify 阶段执行，≥3 个：fact、compare/verify、工具不可用降级）记录于 evidence/。

## 7. Write Set 拆分（implementation 派发用，互不重叠）

| Worker | Write set | 内容 |
|---|---|---|
| W1 lib+CLI | templates/common/Harness/scripts/wf-search.mjs、templates/common/Harness/scripts/lib/wf-search.mjs、tests/wf-search.test.js、tests/fixtures/wf-search/** | helper 全部行为 + 单测 |
| W2 surfaces | templates/common/.claude/commands/wf-search.md、.opencode/commands/wf-search.md、.claude/skills/wf-search/**、command-surface.json（templates+root）、CLAUDE.md（templates+root）、ecc/common.md（templates+root）、4×wf-help.md、Harness/README.md（templates+root）、Harness/MEMORY.md（templates+root）、README.md、README-CN.md | 命令/Skill/registry/路由文档 |
| W3 保护+安装 | src/generator.js（仅 CHECKSUM_EXCLUDE）、scripts/lib/ownership-manifest.mjs（仅 PRESERVE_PATTERNS）、Harness/scripts/wf-update-check.mjs + templates 镜像（仅 PRESERVE_PATTERNS）、Harness/scripts/wf-remove.mjs + templates 镜像（3 个注册表+2 个 pattern 组）、Harness/scripts/README.md:67 修复、tests/wf-search-install.test.js | 保护规则与安装一致性 |
| root 同步 | controller 收尾统一执行 | 把 W1/W2 模板镜像到 root .claude/.opencode/.agents/Harness/scripts（含 .agents 经生成器规则的手工同步），生成 build-version |

W1 与 W3 均不触碰 W2 文件；三个 write set 无交集；root 同步串行收尾。

## 8. Gates 判定

- PRD-GATE：本文件第 2 节。AC-GATE：STATE.json AC-001..006 + 第 6 节映射。CONTRACT-GATE：第 3/4/5 节字段与文件清单。TEST-GATE：第 6 节测试全部先写（RED），实现后 GREEN。
- 完成定义（Claude 侧）：第 13 节验证矩阵全绿（或明确 BLOCKED 记录）+ tgz SHA-256 记录 + evidence/ 齐全 → READY FOR INDEPENDENT VERIFICATION。
