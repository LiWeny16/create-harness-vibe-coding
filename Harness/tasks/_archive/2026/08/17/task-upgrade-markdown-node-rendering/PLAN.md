# task-upgrade-markdown-node-rendering - PLAN

## Goal

将 wf-ui 的 Markdown 渲染升级为「对标 Typora 的开源组件渲染」：GFM 全量（表格/任务列表/警示块）、KaTeX 数学、mermaid 图（CDN 懒加载 + 离线降级），覆盖 4 个渲染面（节点卡片、全屏编辑器、File 大视图、TaskList），并保持本地优先（不联网时功能完整降级）。本次交付研究 → PRD → plan；**未经用户批准不写实现代码**。

## PRD 分析

### 用户需求 → 能力映射

| 用户诉求 | 现状（调研实证） | 目标能力 |
|---|---|---|
| 用开源 md 组件渲染 | 卡片 = 裸 contentEditable 零渲染；全屏 = @mdxeditor（无 mermaid/math 插件）；大视图 = @uiw/react-md-editor 全默认；TaskList = 裸 markdown-it | 共享渲染管线：markdown-it 14 + GFM/任务列表/警示块/KaTeX 插件 + DOMPurify 净化 |
| 对标 Typora | Typora 基准 = 实时渲染 + GFM 表格 + 任务列表 + KaTeX + mermaid + 代码高亮 + 大纲 | 渲染层达到 Typora 阅读/预览级质量；编辑交互维持现有编辑器（全屏 @mdxeditor 富文本 = 现有 WYSIWYG 能力） |
| mermaid 懒加载 CDN | 全链路无 mermaid 支持；mermaid@11.16.0 仅传递存在于 lockfile | 首现 mermaid 代码块时按需注入 jsDelivr 固定版本 + SRI；占位 → 渲染；解析失败/离线 → 原始代码块兜底 |
| /wf 流程 | 本任务按 WF 流程走：调研 → PRD → plan | 已按 WF 第一波并行调研完成，本节为 PRD，下方为 plan |

### 范围（Scope）

**In scope：**
- 共享渲染内核 `src/ui/src/components/markdown/`（新目录）：markdown-it 14 渲染器 + 插件 + DOMPurify + mermaid 懒加载器 + 共享 `MarkdownPreview` 组件（占位/错误/兜底三态）
- 4 个渲染面接入：File 大视图（W2）、TaskList（W3）、全屏编辑器加预览 Tab（W4）、节点卡片加预览模式（W5）
- mermaid CDN 懒加载：版本精确锁定 + SRI + `securityLevel:'strict'` + `secure:['securityLevel','maxTextSize']` 锁（防 `%%{init}%%` 降级攻击）+ DOMPurify 输出净化
- Playwright e2e：mermaid 成功/失败双路径（CDN route 拦截）、GFM 渲染、降级兜底、各面回归
- 设置面消费或清理（P-005，见决策 D-004）

**Out of scope（本任务不做）：**
- 全屏编辑器替换为 Milkdown/Vditor WYSIWYG（列为路线图 follow-up，见决策 D-003）
- 全局 CSP 头部（横切面风险大，易误伤 Vite/HMR/内联资源；列为独立 follow-up，见风险 R-003）
- 大纲面板 / TOC 侧栏（Typora 的 outline 面板；MdCatalog 类功能后续）
- 图片上传、导出 PDF/HTML

**Forbidden：**
- 不直接编辑 `Harness/a2a/**/state.json` 等后端诊断状态
- 不改保存协议（`PATCH /nodes/{id}/state` 版本冲突语义、`file.writeText` 保持不变）
- 不引入 GPL/非 MIT 依赖

### 决策（Decisions）

| # | Decision | Reason | Date |
|---|----------|--------|------|
| D-001 | 采用「仅渲染层升级」（方案 A）：保留 @uiw/react-md-editor 与 @mdxeditor 编辑器，新增共享 markdown-it 渲染管线 + 懒加载 mermaid | 调研推荐：风险最小、满足全部硬约束（React 19/本地优先/离线降级）；Typora 级体验主要来自渲染质量，不必重写编辑交互 | 2026-08-14 |
| D-002 | mermaid 走 CDN 懒加载（jsDelivr，版本精确锁定，SRI integrity + crossorigin），不打包本地 chunk；离线/失败降级为原始代码块 | 主 bundle 零成本（~2MB chunk 不进包）；本地优先约束由降级路径满足；若后续要求离线渲染，换 `import('mermaid')` 单 chunk | 2026-08-14 |
| D-003 | ByteMD / Vditor 均拒绝（Snyk INACTIVE + React 19 未验证）；Milkdown 列为未来 WYSIWYG 路线图（Crepe 缺 mermaid，须自接 plugin-diagram） | 维护风险不可接受；Milkdown 是唯一活跃且 React 19 优化的 WYSIWYG 选项 | 2026-08-14 |
| D-004 | 卡片预览模式以「预览 toggle」形式提供；`fontSize`/`wordWrap` 设置本次实现消费；`editorMode`/`autoSave` 死设置移除 | P-005：设置面持久化但从不消费；消费最小项、移除死项，防止设计债扩大 | 2026-08-14 |
| D-005 | 渲染内核不自造：markdown-it 14（已有直接依赖）+ markdown-it-task-lists / 警示块 / markdown-it-katex + dompurify 新直接依赖；mermaid fence 用自定义 fence 规则（markdown-it mermaid 插件生态普遍过时） | 调研实证：官方插件 stale，自定义 fence + 异步后渲染是社区共识模式 | 2026-08-14 |
| D-006 | WF 层：本任务 WF-Standard（多文件行为变更）；研究/PRD/plan 阶段即本交付；实现阶段 1 个独立 review 视角（安全/XSS 优先） | WF.md 分层规则 | 2026-08-14 |

### 验收标准（Acceptance，全部 pending）

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | 含 ```mermaid 代码块的 md 在联网时渲染为 SVG 图；首次出现时显示加载占位，CDN 脚本仅在此时请求一次 | m7 AC-001 绿（route 拦截断言零请求/恰好一次） | verified |
| AC-002 | CDN 加载失败/离线/mermaid parse 错误时渲染原始代码块并带错误提示，页面不崩溃 | m7 AC-002 绿（route abort → fallback + error badge + UI 可交互） | verified |
| AC-003 | mermaid 安全基线：`securityLevel:'strict'` + `secure` 数组锁定；含 `%%{init:{"securityLevel":"loose"}}%%` 的图不降级；输出经 DOMPurify | m7 AC-003 绿（真文件强断言 window.__pwned 未定义） | verified |
| AC-004 | File 大视图 md 分支：GFM 表格/mermaid 渲染，保存流程不变（fileWriteText 回归通过） | m7 AC-004 绿（表格 + mermaid F2 标签 + save round-trip） | verified |
| AC-005 | TaskList 预览切换到共享渲染管线，HTML 保持转义/净化（html:false + DOMPurify），GFM/mermaid 可用 | m7 AC-005 绿（PLAN 表格 + mermaid T2 标签） | verified |
| AC-006 | 全屏编辑器新增「预览」Tab：用共享管线渲染 markdown（含 mermaid/math），编辑 Tab 行为不变 | m7 AC-006 绿（含 codeBlockPlugin 修复后 edit tab 可加载 mermaid 文档 + save 回归） | verified |
| AC-007 | 节点卡片新增预览模式 toggle：表格/图片/代码块按 markdown 渲染；编辑模式（contentEditable/源码）行为不变 | m7 AC-007 绿（预览表格 + 切回 contentEditable 可编辑） | verified |
| AC-008 | 工程验收：typecheck + vite build 通过；主 bundle 不含 mermaid；CDN 版本+SRI 记录在代码注释并有再生成脚本；全部新用例 Playwright 通过 | typecheck/build 通过；src/ 无静态 mermaid import（仅 CDN URL 常量）；SRI+版本注释在 mermaidLoader.ts + sri-regenerate.mjs；m7 7/7 + m3 6/6 + m2 9/9 绿 | verified |

### 风险（Risks）

| Risk | Mitigation | Status |
|------|------------|--------|
| R-001 @uiw/react-md-editor 预览扩展点不足以注入自定义 mermaid fence（其预览管线内部封装） | 实现前先验证 previewOptions 扩展点；兜底方案：大视图改用 @uiw 编辑 + 共享 MarkdownPreview 分栏替换其默认预览 | open |
| R-002 CDN 依赖网络 → 演示/CI 环境无外网 | AC-002 降级路径为硬要求；e2e 用 Playwright route 拦截模拟成功/失败，不依赖真实外网；真实渲染留手动浏览器证据 | open |
| R-003 无 CSP，CDN 加载无来源约束 | 本次以 SRI + 精确版本 + DOMPurify 兜底；全局 CSP 列为独立 follow-up（须回归 Vite HMR/内联资源，风险横切） | open |
| R-004 markdown-it-katex 维护一般、KaTeX 依赖体积 | KaTeX 0.16.47 已传递存在（@uiw 链）；katex 直接依赖体积 ~1MB 但可按需 split；若体积压力大改用 CDN KaTeX（同 mermaid 模式） | open |
| R-005 mermaid `%%{init}%%` 绕过 securityLevel 的存储型 XSS 历史（Docmost GHSA） | `secure:['securityLevel','maxTextSize']` 锁 + DOMPurify 输出双层防御；AC-003 专测 | open |
| R-006 卡片预览模式与 contentEditable 编辑的切换可能丢光标/未保存草稿 | 预览 toggle 仅在非 dirty 或先落草稿时允许；实现阶段细化状态机 | open |

## 实施 Plan（待批准后执行）

### Wave 分解（W1 先行，W2-W5 文件不相交可并行，W6 收口）

| Wave | 内容 | Write set（文件） | 验证 |
|------|------|------|------|
| W1 渲染内核 | markdown-it 管线 + 插件 + DOMPurify + mermaid 懒加载器（CDN/SRI/strict/secure/降级三态）+ 共享 MarkdownPreview + 样式 + katex/dompurify 直接依赖 | `src/ui/src/components/markdown/`（新：renderMarkdown.ts、mermaidLoader.ts、MarkdownPreview.tsx、styles.css、sri-regenerate.mjs）、`src/ui/package.json` | typecheck + 内核单测（mermaid fence 占位/净化断言） |
| W2 大视图 | md 分支接入共享管线（@uiw previewOptions 扩展点或预览替换，见 R-001） | `src/ui/src/components/WorkflowFileBigView.tsx` | Playwright md 分支用例 |
| W3 TaskList | 换用共享管线（保持 html:false 净化语义） | `src/ui/src/components/TaskList.tsx` | 既有 TaskList 用例回归 + 新渲染断言 |
| W4 全屏 | @mdxeditor 加预览 Tab（共享管线渲染） | `src/ui/src/components/MarkdownComponentNode.tsx`（全屏部分） | 既有 `workflow-markdown-rich-editor` 用例不回归 + 新预览用例 |
| W5 卡片 | 预览模式 toggle + fontSize/wordWrap 消费 + editorMode/autoSave 设置移除 | `src/ui/src/components/MarkdownComponentNode.tsx`（卡片部分）、`src/ui/src/components/workflow/MarkdownNodeSettings.tsx` | 既有卡片用例不回归 + 新用例 |
| W6 e2e 收口 | 新 spec `wf-ui-m7-markdown-rendering.spec.ts`（CDN route 拦截成功/失败、AC-001..AC-007 证据）+ 全量 typecheck/build/playwright + 手动浏览器证据记录 | `src/ui/e2e/wf-ui-m7-markdown-rendering.spec.ts` | AC-001..AC-008 证据矩阵 |
| W7 review | WF-Standard 1 个独立 review 视角：安全/XSS 优先（DOMPurify、mermaid 注入面、SRI） | 只读 | review PASS 记录 |

### Subagent Dispatch（实现阶段，批准后填细节）

| Agent | 角色 | 读边界 | 写边界 | 返回 |
|-------|------|--------|--------|------|
| test-writer | AC 链测试先行 | PRD/AC + src/ui 相关组件 | `src/ui/e2e/wf-ui-m7-*.spec.ts`（W1 后） | 失败测试清单 |
| implementer ×N | 按 wave 实施（W2-W5 各一人，文件不相交） | src/ui + PLAN.md | 各自 wave write set | DONE/证据 |
| verifier | AC 矩阵 | 运行中 app + 测试命令 | 无（证据记录） | AC 结果矩阵 |
| reviewer | 安全/XSS 视角 review | diff + AC + 证据 | 无（findings） | findings |

### Open questions（需用户拍板后进入实现）

1. 卡片交互：预览模式作为 toggle 是否可接受（vs 彻底换 WYSIWYG 组件，属 Milkdown 路线）？
2. 死设置移除（editorMode/autoSave）同意否？
3. mermaid 离线策略：CDN+降级即可，还是要求完全离线渲染（+~1MB chunk）？
4. 全屏编辑器维持 @mdxeditor + 预览 Tab，还是本次直接上 Milkdown（工作量显著增加）？
