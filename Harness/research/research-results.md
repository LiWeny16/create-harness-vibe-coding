# create-harness-vibe-coding - Research Results

> **Purpose**: Record research inputs and decisions that shaped the scaffold.
> **Principle**: Each candidate has a clear Purpose / Strength / Weakness / Decision.

---

## Research Date

2026-06-24

## Research Goal

Decide how this repository should dogfood the generated Harness scaffold after moving generated harness-owned docs to root `Harness/`.

---

## Candidate References

### 1) Local Claude Code Review Report

- **What it is**: User-provided multi-agent review output for the current repository.
- **Source Type**: local review artifact
- **Checked Date**: 2026-06-24
- **Strengths**: Identified root `CLAUDE.md` and `MEMORY.md` still pointing at stale `docs/harness/` paths.
- **Weaknesses**: Some severity labels overstated generator risks that require explicit conflict policy.
- **Decision**: ADOPT root dogfood finding; PARTIAL for overwrite and routing recommendations.
- **Link**: conversation context

### 2) Current Generator Templates

- **What it is**: `templates/common/**` and `templates/optional/**`, the package source for generated scaffold files.
- **Source Type**: repository source
- **Checked Date**: 2026-06-24
- **Strengths**: Defines root `Harness/`, `.claude/`, memory, workflow, subagent, and validator assets.
- **Weaknesses**: Template project facts require project-specific bootstrap before strict validation.
- **Decision**: ADOPT as dogfood runtime source with root conflicts skipped.
- **Link**: `templates/common/`

### 3) Local Test And Validator Suite

- **What it is**: Node test suite and generated `Harness/scripts/validate-harness.mjs`.
- **Source Type**: repository test code
- **Checked Date**: 2026-06-24
- **Strengths**: Covers conflict policies, path mapping, optional workflow registration, memory triggers, and scaffold validation.
- **Weaknesses**: Some README checks still assert exact prose and can be made more structural later.
- **Decision**: ADOPT as verification gate.
- **Link**: `tests/`

---

## Final Decision

- **Architecture Style**: Node CLI scaffold generator with a dogfooded root Harness runtime for agent operations.
- **Core References**: `src/generator.js`, `src/index.js`, `templates/common/`, `Harness/README.md`, `Harness/MEMORY.md`.
- **Key Constraints**:
  - Package source remains under `bin/`, `src/`, and `templates/`; root `Harness/` is repo operating guidance.
  - Existing root `README.md`, `.gitignore`, and package files are project facts and must not be overwritten by dogfood generation.
  - Future agent work should route through `Harness/README.md` and record durable state in `Harness/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md`.

---

## Not Adopted But Worth Watching

- Move all root dogfood files into the npm package: rejected because `package.json#files` already limits publish contents to `bin/`, `src/`, and `templates/`.
- Implement the full Agent-link intake matrix in `src/prompts.js`: not adopted now; the matrix is intentionally for agent-driven installs, while npx stays deterministic.

---

## codex-cli 0.147 TUI input & programmatic trigger (2026-08-13)

Key findings (verified against local binary 0.147.0 + openai/codex source tag rust-v0.147.0 + official docs):

1. `codex "prompt"` (argv prompt): TUI auto-submits the initial message after session config; skips the update prompt. Zero keystroke injection.
2. `codex exec --json "prompt"` is the official non-interactive path: headless, JSONL turn events, `-o/--output-last-message`, `--output-schema`, `codex exec resume --last`. `-p` does NOT exist (it's --profile).
3. TUI stdin protocol: flushes input buffer at init (early writes discarded); Enter = submit (single \r; \r\n risks double-submit); raw mode + bracketed paste + keyboard enhancement active; piped stdin fails ("stdin is not a terminal").
4. Known upstream symptom cluster: text-in-box-but-Enter-swallowed on Windows (issues #12542, #3125, #16306); community tooling recommends C-m with delays/retries.
5. Harness decision: three-layer trigger model — (a) initialPrompt argv auto-submit (Enter-free, preferred), (b) ready-gated single-\r injection for in-session tasks, (c) codex exec headless for automated dispatch.


## file-node 部分渲染库选型（2026-08-14，task-upgrade-file-node，researcher 核实）

- Excel: ADOPT read-excel-file@9.3.10 (MIT, 2.47MB unpacked, 活跃, 异步, 按 sheet 名+slice 分页)；WATCH SheetJS CE 0.20.3 (Apache-2.0, CDN tarball, sheetRows/sheets/!fullref) 应对 .xls/超大表；REJECT exceljs (INACTIVE, ~21MB)。
- PDF: ADOPT unpdf@1.8.1 (MIT, 2.04MB, 零依赖, 内置 pdf.js v5 serverless)；REJECT pdfjs-dist 6.x (34.5MB, optional @napi-rs/canvas) 与 pdf-parse (2018 停更)。文本提取免 canvas；Node 端 isEvalSupported:false 安全基线。
- ZIP: ADOPT yauzl@2.10.0 + iconv-lite (GBK: decodeStrings:false 原始 Buffer)；REJECT fflate (GBK 无 rawName) / adm-zip (全量内存+Zip Slip 史)。
- 监听: fs.watch 父目录(非递归)+rename 后 stat 复核+防抖+5-10s 轮询兜底 (Windows: 目录锁#8371、filename 不可信#4351)。
- 锁: 维持组件级内存锁+持久化 lock 记录，补 pid/时间戳陈旧锁回收；不引外部库。

## Typora-class md rendering + mermaid（2026-08-14，task-upgrade-markdown-node-rendering，researcher 核实）

- 基准：Typora = 实时 WYSIWYG、GFM 表格（对齐/拖拽）、任务列表、KaTeX 数学、mermaid、代码高亮、TOC+大纲；商用一次性 $14.99。
- 候选（全部 MIT）：@uiw/react-md-editor（活跃，4.1.0 2026-03，React19 peer 未确认）；md-editor-rt（drop-in 分支，内置 mermaid/katex/MdCatalog 大纲）；ByteMD（Snyk INACTIVE → REJECT）；Milkdown（WYSIWYG，React19 优化，Crepe 缺 mermaid）；Vditor（IR/WYSIWYG/SV 内置全，INACTIVE → REJECT）；markdown-it 14+插件（活跃，43kB gz）；react-markdown/remark；MDXEditor（无 mermaid）。
- Mermaid CDN 懒加载模式成立：jsDelivr 锁定精确版本（>=11.15.0，含 CVE-2025-54881、CVE-2026-41148/41149 修复）+ `initialize({startOnLoad:false})` + `run()`。安全基线：`securityLevel:'strict'` + `secure:['securityLevel','maxTextSize']` 锁死 `%%{init}%%` 降级（Docmost GHSA-r4hj-mc62-jmwj 教训）+ DOMPurify 输出。SRI integrity + crossorigin=anonymous 必配对；CSP script-src 白名单为可选项（本仓库现无 CSP）。全量 ~2MB min / tree-shaken 0.8-1MB；@mermaid-js/tiny 约半。
- 决策（ADOPT 方案 A）：渲染层升级——markdown-it 14 + 任务列表/警示块/KaTeX 插件 + 自定义 mermaid fence（异步后渲染）+ DOMPurify，保留现有编辑器；离线/失败降级原始代码块。ByteMD/Vditor 拒绝；Milkdown 为未来 WYSIWYG 路线；md-editor-rt 为 @uiw 停摆时的 drop-in 备胎。
