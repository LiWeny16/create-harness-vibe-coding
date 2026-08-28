# task-upgrade-markdown-node-rendering - REFERENCES

## Logs

| Description | File / Command | Date |
|-------------|---------------|------|
| codebase-explorer（explorer-md-map）渲染地图报告 | 本任务 PLAN/PROBLEM 综合摘要 + 原始报告见会话记录 | 2026-08-14 |
| researcher（researcher-md-ecosystem）外部生态调研报告 | `Harness/research/research-results.md`「Typora-class md rendering + mermaid」节 | 2026-08-14 |

## Evidence

| What | Pointer | Verified |
|------|---------|----------|
| 卡片 contentEditable 零渲染 | `src/ui/src/components/MarkdownComponentNode.tsx:194-222` | 是（explorer 引用） |
| 全屏 @mdxeditor 懒加载、无 mermaid/math 插件 | `MarkdownComponentNode.tsx:45-58,66-114` | 是 |
| File 大视图 @uiw/react-md-editor 全默认 | `src/ui/src/components/WorkflowFileBigView.tsx:722-730` | 是 |
| TaskList 裸 markdown-it html:false | `src/ui/src/components/TaskList.tsx:40-44,307` | 是 |
| 无 CSP（server 仅 CORS/nosniff；index.html 无 meta） | `src/wf-ui-server/server.mjs:226-252`；`src/ui/index.html` | 是 |
| mermaid@11.16.0 / katex@0.16.47 仅传递依赖 | `src/ui` lockfile 3755-3760 / 6173 | 是 |
| e2e 缺口：@uiw md 分支与设置控件无覆盖 | `src/ui/e2e/`（wf-ui-m3/m4 等 7 文件） | 是 |
| 设置面死债（持久化但不消费） | `workflow/MarkdownNodeSettings.tsx:34-55` | 是 |

## Links

| Description | URL / Path |
|-------------|------------|
| Typora 特性基准/授权 | https://typora.io/ ；one-time $14.99，商用闭源 |
| mermaid CDN 用法（jsDelivr UMD + startOnLoad:false + run()） | https://mermaid.js.org/config/usage.html |
| mermaid securityLevel / secure 锁（Docmost XSS 教训） | https://github.com/docmost/docmost/security/advisories/GHSA-r4hj-mc62-jmwj |
| mermaid CVE 时间线（CVE-2025-54881；CVE-2026-41148/41149 修复于 11.15.0） | https://deps.dev/advisory/osv/GHSA-ghcm-xqfw-q4vr |
| md-editor-rt 对比（@uiw 系 drop-in + 内置 mermaid/katex/MdCatalog） | https://imzbf.github.io/md-editor-rt/en-US/contrast/ |
| ByteMD 官方插件（gfm/math/mermaid/highlight） | https://bytemd.js.org/ |
| Milkdown（React 19 优化；Crepe 缺 mermaid：discussions 1479/1733） | https://github.com/Milkdown/milkdown |
| Vditor（WYSIWYG/IR/SV + 内置 mermaid/katex） | https://github.com/smigoo/vditor |
| SRI 实践（integrity + crossorigin 必配对；CSP 与 SRI 互补） | https://enterno.io/en/articles/subresource-integrity-sri |

## Notes

- 全部候选组件 MIT 许可，无 GPL 冲突（mermaid MIT、KaTeX MIT、highlight.js BSD-3、DOMPurify ISC）。
- markdown-it 的 `render()` 是同步的 → mermaid 必须「fence 占位符 + 异步后渲染」两步，这是方案 A 的主要实现复杂度。
- mermaid CDN 建议锁定与 lockfile 一致的 11.16.0（>=11.15.0 即含 CVE-2026-41148/41149 修复）。
- CVE-2024-47064 是 CVAT 的 XSS，与 mermaid 无关（调研纠错）。
- @uiw/react-md-editor 仍在活跃发布（4.1.0 2026-03）；React 19 peer 未获显式确认 → 实现前以项目现有运行事实为准（已跑通）。
