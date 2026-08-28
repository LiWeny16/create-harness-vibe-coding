# task-upgrade-markdown-node-rendering - PROBLEM

## Active

| ID | Problem | Root cause | Fix | Status |
|----|---------|------------|-----|--------|
| P-001 | 画布 Markdown 节点卡片是裸 contentEditable，零渲染：无表格/图片/代码高亮预览，与 Typora 体验差距大 | 卡片内联视图直接用 contentEditable 存 markdown 源码，没有任何渲染组件（`MarkdownComponentNode.tsx:194-222`） | 卡片增加渲染预览或 WYSIWYG 组件 | open |
| P-002 | 三个互不相通的渲染器：卡片 contentEditable / 全屏 @mdxeditor/editor / File 大视图 @uiw/react-md-editor，样式与能力不一致 | 历史演进：文件大视图先接入 @uiw，节点全屏后接入 mdxeditor，卡片从未接渲染 | 统一渲染内核（语法插件、主题、mermaid 支持共享） | open |
| P-003 | 无 mermaid 支持（卡片/全屏/大视图均不渲染 mermaid 代码块） | 无 mermaid 依赖、无插件；mermaid@11.16.0 仅经 @excalidraw/mermaid-to-excalidraw 传递存在 | mermaid 懒加载 CDN（首次出现 mermaid 块时注入）+ 降级显示源码 | open |
| P-004 | 全屏 MDXEditor 未接 katex/mermaid/高亮插件，富文本与 markdown 往返有限 | `MarkdownComponentNode.tsx:66-114` 插件清单仅基础 GFM 子集 | 评估可接入插件或切换到 ByteMD/Vditor 方案 | open |
| P-005 | markdown 节点设置（editorMode/autoSave/wordWrap/fontSize）持久化但 UI 从不消费——死设置面 | `MarkdownNodeSettings.tsx:34-55` 写入 settings，`MarkdownComponentNode` 不回读 | 升级时要么实现消费，要么显式移除（防止设计债扩大） | open |
| P-006 | File 大视图 md 分支无 e2e 覆盖；设置控件无 e2e 覆盖 | `wf-ui-m4-w38.spec.ts` 只覆盖 text 分支；无 spec 触达 `workflow-file-big-view-md-editor` | 升级随改补 Playwright 用例 | open |
| P-007 | 渲染失败降级仅全屏 mdxeditor 有（textarea 兜底），卡片/大视图无降级路径 | 各渲染点未做错误边界 | 新增渲染失败兜底（显示源码 + 重试） | open |
| P-008 | 无 CSP；服务器仅 CORS/nosniff —— CDN 脚本可加载但无任何来源约束 | `server.mjs:226-252` 无 Content-Security-Policy；`index.html` 无 meta CSP | 若启用 CDN，考虑加最小 CSP（script-src 放行固定版本 CDN + SRI）或本地 bundle | open |

## Resolved

| ID | Problem | Root cause | Fix | Resolved |
|----|---------|------------|-----|----------|
| P-009 | mermaid SVG 经 DOMPurify svg profile 净化后 foreignObject 内容被剥——flowchart 节点标签空白（AC-004/005 e2e 失败，影响全部共享管线消费者） | mermaid 11 默认 htmlLabels 把标签渲染为 foreignObject 内 HTML，不在 svg profile 白名单 | 顶层 `htmlLabels:false`（mermaidLoader.ts:105；第一版误用弃用键 flowchart.htmlLabels，对 flowchart-v2 无效，tw-m7-spec bundle 内实证后修正）；dist 已重建；安全面收窄（纯 SVG text 路径，无 foreignObject HTML 逃逸向量）；AC-004/005 e2e 转绿 | 2026-08-14 |
| P-010 | 全屏富文本编辑器（MDXEditor）无法加载含 ``` 代码围栏（含 mermaid）的文档——contentEditable 渲染但 hidden（AC-006 edit tab 实证失败） | MDXEditor 插件清单从未含 `codeBlockPlugin`，无法解析 code mdast 节点。预存在限制，mermaid 内容使其更易触发 | 用户选 A：加 `codeBlockPlugin` + catch-all descriptor（priority -10, match 全匹配, textarea 编辑器经 useCodeBlockEditorContext.setCode 往返）（MarkdownComponentNode.tsx）。typecheck/build 通过，AC-006 转绿，m3 markdown 6/6 回归通过 | 2026-08-14 |
