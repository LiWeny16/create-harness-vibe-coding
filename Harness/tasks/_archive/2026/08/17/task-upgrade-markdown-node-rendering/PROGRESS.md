# task-upgrade-markdown-node-rendering - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived

## Heartbeat

- 2026-08-17 **收尾完成**（代理全 429 挂，controller 直接收尾）：i18n 4 键中英补全（Preview/Edit/Word wrap/Font size）；AC-006 fixture bug 修复（播种 MD_MERMAID_TABLE）；暴露预存在 P-010（MDXEditor 无 codeBlockPlugin，含 ``` 文档 edit tab 打不开）→ 用户选 A，加 codeBlockPlugin + catch-all textarea descriptor（priority -10，setCode 往返）。**m7 e2e 7/7 全绿**，m3 markdown 6/6 + m2 settings 9/9 回归全绿，typecheck+build 通过。安全 review PASS（双层净化 html:false+DOMPurify、strict+secure 锁、SRI+crossorigin、代码编辑器 textarea 无 innerHTML/eval）。全部 AC-001..008 verified。
- 2026-08-14 14:4x **AC-004/005 转绿**（tw-m7-spec 重跑，2 passed）：F2/T2 标签经 `<text>` 渲染过 sanitize、CDN 恰好 1 次请求、GFM 表格/save/dirty 回归全过。P-009 验证闭环。剩余 5 条用例（AC-001/002/003/006/007）RED 等 W45；已向 impl-w45-node 询问进度。
- 2026-08-14 14:3x 顶层 `htmlLabels:false` 修正落地（impl-w1-finish）：mermaidLoader.ts:104 + 注释更正；dist 重建（新 chunk mermaidLoader-BeG3rRyQ.js，断言含顶层键不含弃用形态）；tsc markdown/ 零错误。P-009 → resolved（PROBLEM.md 去重，Resolved 表已更正为顶层键表述）。已派 tw-m7-spec 重跑 AC-004/005 验证转绿。W45（W4+W5）仍在途。
- 2026-08-14 14:2x **P-009 反转**：tw-m7-spec 复查发现 FIX A 用了弃用键 `flowchart.htmlLabels`（mermaid@11.16.0 对 flowchart-v2 无效）→ AC-004/005 重跑仍失败；正确键=顶层 `htmlLabels:false`（隔离实证：标签 `<text>` 化、sanitize 后文本保留、sequence/攻击图均过）。一行修正+重建 dist 已派回 impl-w1-finish。W3 此前"实证通过"存疑（可能在未过 sanitize 链或非 flowchart-v2 路径上验证）。断言已改为容器级纯文本断言（零结构依赖）。
- 2026-08-14 14:1x RED spec 交付（tw-m7-spec）：m7 spec 7 用例干净失败（卡片/全屏元素缺失待 W45；AC-004/005 命中 P-009）。真 mermaid.min.js fulfill（.pnpm 路径）非 stub，AC-003 为强断言。spec 作者独立复现 foreignObject 缺陷但其 FIX B 方向被拒（FIX A 已落地）；已派回复查断言兼容 FIX A（须文本断言非 foreignObject 结构）+ AC-004/005 提前转绿重跑（不依赖 W45 在途文件）。
- 2026-08-14 14:0x W2 DONE_WITH_CONCERNS（impl-w2-bigview）：大视图 50/50 分栏（MDEditor edit + MarkdownPreview live）、typecheck/build 通过、dist 仅 mermaidLoader chunk；m4 回归 6/7，W38-6（Skills Hub skill-toggle）A/B 实证预存在失败（还原基线同样失败），非本任务引入——W6 全量跑会再遇到，勿误归因。另注：WorkflowFileBigView.tsx 本身是分支未提交新文件。
- 2026-08-14 13:5x 内核 FIX A 落地（impl-w1-finish）：`flowchart:{htmlLabels:false}`（mermaidLoader.ts:101-105）+ 注释；build 复验通过；AC-003 攻击面评估=收窄（纯 SVG text 路径，无 foreignObject HTML 逃逸向量）。P-009 → resolved。W6 需全量重跑 m7 spec（W3 只隔离跑过 AC-005）。
- 2026-08-14 13:5x W3 DONE_WITH_CONCERNS（impl-w3-tasklist）：TaskList 换管线完成、build 通过；发现 W1 内核缺陷 P-009（DOMPurify svg profile 剥 foreignObject → flowchart 标签空白，AC-005 失败）。controller 采纳 W3 实证的 FIX A（htmlLabels:false）并派回 impl-w1-finish 修复。W3 报告的 WorkflowRoute.tsx:9810/9940 类型错误经复核为 W2 编辑中途的瞬态（现 tsc 全绿；该文件 6700+ 行 diff 为分支既有 checkpoint 状态，非本任务产物）。
- 2026-08-14 13:4x W1 DONE（impl-w1-finish）：override 落地（lockfile katex@0.6.0 消失）、typecheck/build 通过、dist 无 mermaid chunk、SRI sha384-T/0lMUd…238E @ mermaid@11.16.0、API 契约（MarkdownPreview 命名导出 / renderMarkdown / renderMermaidDiagrams）返回。遗留：SRI 由 npm tarball 交叉验证得出，W6 真浏览器需复验 CDN 实际字节。
- 2026-08-14 13:4x 并行派出 W2（impl-w2-bigview：大视图 MDEditor edit 模式 + MarkdownPreview 分栏）、W3（impl-w3-tasklist：TaskList 换共享管线）、W4+W5 合并（impl-w45-node：全屏预览 Tab + 卡片预览 toggle + 设置消费/清理；同文件故单代理串行）。write set 三路不相交。
- 2026-08-14 13:3x 用户切换模型并终止两个后台代理（impl-w1-render-core / test-writer-m7）后说「继续」。评估磁盘状态：W1 五文件 + 三依赖已落盘；前任上报 katex 0.6 隔离问题（markdown-it-katex 自带 katex ^0.6.0，pnpm 严格布局下 unicode/矩阵数学失败）→ controller 批准 pnpm override（D-008）。旧代理不可恢复，重派 impl-w1-finish（收尾验证）+ tw-m7-spec（RED spec 接续）。
- 2026-08-14 13:20 用户「继续」+ 4 个决策全部确认推荐方案（D-007 记录：卡片预览 toggle / 死设置部分消费+部分移除 / mermaid CDN 懒加载+降级 / 全屏保留 MDXEditor+预览 Tab）。phase → implement。
- 2026-08-14 13:22 并行派出 W1 渲染内核 implementer（impl-w1-render-core）+ test-writer（test-writer-m7，AC 链 e2e 先行 RED）。testid 契约已定：markdown-mermaid-pending/svg/fallback/error、workflow-markdown-preview-toggle/content、workflow-markdown-fullscreen-preview-tab/content。
- 2026-08-14 12:52 WF 启动：创建任务胶囊，设为 Active Task；第一波并行派出 codebase-explorer（explorer-md-map）+ researcher（researcher-md-ecosystem）。
- 2026-08-14 12:54 explorer-md-map 返回：完整渲染地图。3 个互不相通渲染器（卡片 contentEditable / 全屏 @mdxeditor / File 大视图 @uiw/react-md-editor），无 mermaid，无 CSP（CDN 加载可行），设置面为死债（P-005）。8 项问题已录入 PROBLEM.md（P-001..P-008）。
- 2026-08-14 12:57 researcher-md-ecosystem 返回：推荐方案 A（仅渲染层升级）；ByteMD/Vditor 拒绝；Milkdown 为未来路线；mermaid CDN 懒加载模式成立（锁定版本 + strict + secure 锁 + DOMPurify + SRI）。已追加 `Harness/research/research-results.md`。
- 2026-08-14 13:05 PRD + 实施 plan 写入 PLAN.md（目标/范围/决策 D-001..D-006/AC-001..AC-008/风险 R-001..R-006/7 个 wave）；REFERENCES.md 记录来源；STATE.json 更新 tier=WF-Standard、phase=plan、acceptance 8 条、dispatchLedger 2 条。

## Next

- 用户对 4 个开放问题拍板（卡片预览 toggle / 死设置移除 / mermaid 离线策略 / 全屏编辑器路线）并批准 plan → W1 渲染内核（test-writer 先行，AC 链测试）→ W2-W5 并行接入 → W6 e2e 收口 → W7 安全 review。
