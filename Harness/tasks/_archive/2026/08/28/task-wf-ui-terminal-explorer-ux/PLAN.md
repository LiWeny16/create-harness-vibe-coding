# task-wf-ui-terminal-explorer-ux - PLAN

## Goal

WF-UI 三大交互优化：
1. 悬浮终端（双击 Agent 节点的 terminal）：新增放大到全屏功能（Cooperation 按钮=协作审计面板开关、attach 开关=输入接入开关——已向用户解释，不改行为）。
2. Workspace Explorer：详情预览与右键菜单点击外部关闭；右键菜单补 VSCode 式功能（新建文件/新建文件夹按右键目标文件夹语义、重命名、删除、复制路径、在系统资源管理器中显示）；拖入真实文件/粘贴文件复制进工作区；File 节点按路径打开用户系统资源管理器（必须）。
3. Explorer 面板支持拖拽移动（浮动模式下<head>拖动）。

## Scope

**Write set:**
- `src/ui/src/components/TerminalDrawer.tsx` — 全屏 toggle（保存/恢复矩形、Escape 退出、全屏时隐藏 resize 手柄/禁用 move）
- `src/ui/src/components/WorkspaceExplorerPanel.tsx` — 外部点击关闭（预览/右键菜单）、真实 ops 菜单（新建文件/文件夹/重命名/删除/复制路径/在资源管理器中显示）、浮动拖拽、真实文件拖入/粘贴上传
- `src/ui/src/components/WorkflowFileBigView.tsx` — 头部加「在资源管理器中显示」按钮（调 /api/workspace/reveal）
- `src/wf-ui-server/server.mjs` — 新增 `POST /api/workspace/reveal`
- `src/wf-ui-server/workspace-store.mjs` — `revealWorkspacePath(projectRoot, input, spawnFn)` 纯逻辑（路径校验白名单：workspace 根 + Harness/user-files；Windows explorer.exe /select, macOS open -R、Linux xdg-open；不 shell:true）
- `src/wf-ui-server/__tests__/workspace-reveal.test.mjs` — 路径校验 + 命令构造单测（注入 mock spawn）
- `src/ui/src/i18n/translations.ts` — 新键中英
- `src/ui/e2e/wf-ui-m8-terminal-explorer-ux.spec.ts` — 新 e2e
- `src/ui/src/index.css` — 新样式（全屏态、explorer 浮动拖拽、菜单项）

**Forbidden:** 不动保存协议/session API；不动 canvas 手势隔离既有行为（data-canvas-control 体系）；不引入新依赖。

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| D-001 | 全屏=保存 position/size 到 ref 后铺满视口留 16px 边距，Esc/再点按钮恢复；全屏时禁用 header 拖动与 resize 手柄 | 简单可逆，符合"放大写代码"诉求 | 2026-08-17 |
| D-002 | 预览面板与右键菜单统一用 window pointerdown capture 关闭（排除自身/菜单/rename input 目标）；Esc 兜底 | 文件管理器惯例；ReactFlow 手势捕获系统已在 window capture 层，须先于其判断 | 2026-08-17 |
| D-003 | 新建文件/文件夹目标：右键条目是文件夹→建在其内部；是文件→建在其父目录。默认名 "file-1.txt"/"New Folder" 冲突时递增；创建后自动展开父目录+进入重命名态 | VSCode 语义 | 2026-08-17 |
| D-004 | 删除=后端 rename-to-trash+undo 日志，前端不弹确认（可撤销） | 后端已具备 undo；VSCode 默认即删 | 2026-08-17 |
| D-005 | 真实文件拖入/粘贴→前端 ArrayBuffer→base64→`/api/workspace/ops` create-file；二进制文件同样走 contentBase64；逐文件串行上传，完成后 refresh 树 | 复用现有 ops 通道，不新增上传端点 | 2026-08-17 |
| D-006 | 打开系统资源管理器=新端点 `POST /api/workspace/reveal`。路径白名单：workspace 根或 Harness/user-files（File 节点引用域）。Windows: explorer.exe /select,（文件）或直接打开（目录）；macOS open -R/open；Linux xdg-open 父目录。spawn 不 shell | 安全面：loopback 服务可 spawn 但必须路径校验 + 无 shell 注入 | 2026-08-17 |
| D-007 | Explorer 拖拽移动只作用于浮动模式：header 空白区拖动更新 floatOffset(x,y)，钳制视口内；dock 回固定 18,18 | 图标按钮区排除；不动画布手势 | 2026-08-17 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | 点击详情预览面板外部任意处关闭预览；点击预览面板自身不关闭；打开右键菜单时预览不被误关 | Playwright m8 | pending |
| AC-002 | 右键菜单点击外部关闭；Esc 关闭；菜单内点击不关 | Playwright m8 | pending |
| AC-003 | 右键文件夹→New File/New Folder 建在其内部；右键文件→建在其父目录；默认名冲突递增；创建后父目录展开+重命名态；Rename 回车生效 Esc 取消；Delete 走 ops | Playwright m8（断言 POST /api/workspace/ops payload） | pending |
| AC-004 | 右键菜单含 Copy Path、Open in Explorer；Open in Explorer 对文件/目录分别发出正确 /api/workspace/reveal 请求 | Playwright m8 + 后端单测 | pending |
| AC-005 | 真实文件拖入 Explorer→上传到悬停目标文件夹并刷新；粘贴文件同样落位 | Playwright m8（DataTransfer 文件 + 断言 create-file base64 载荷） | pending |
| AC-006 | 终端头部放大按钮→窗口变全屏（视口减边距）、resize 手柄隐藏；再点/Esc 恢复原矩形 | Playwright m8 | pending |
| AC-007 | Explorer 浮动模式拖 header 可移动、钳制在视口内；dock 模式不可拖 | Playwright m8 | pending |
| AC-008 | File 大视图「在资源管理器中显示」按钮发出 /api/workspace/reveal；失败显示错误 | Playwright m8 | pending |
| AC-009 | reveal 端点：workspace 内路径合法；../.. 路径与不存在路径被拒；spawn 参数构造正确（注入 mock 断言） | 后端 node --test | pending |
| AC-010 | typecheck + build + 既有回归（m2/m3/m4/m7 相关面）通过 | 命令回执 | pending |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| R-001 外部点击关闭与 ReactFlow 手势 capture 冲突（explorer 已有 window capture 层） | 在 explorer 自己的 capture 层之前注册新 capture listener（后注册先触发同层？—— 用独立 useEffect 注册 window pointerdown capture，顺序 follow DOM 注册序；explicit：在 explorer capture handler 里追加关闭逻辑，不新增跨组件 listener） | open |
| R-002 ops 创建后树缓存不一致 | 统一 reloadPath(path)：清 childrenByPath 条目+重新 loadPath；ops 返回 entriesChanged 依其定向刷新 | open |
| R-003 explorer.exe /select, 参数形态差异（部分 Windows 版本需引号包裹） | spawn('explorer.exe', [`/select,${path}`])，先实现常用形态，失败返回可读错误不崩溃 | open |
| R-004 大文件拖入 base64 内存翻倍 + ops body 大小 | 服务端 readJsonBody 已有上限（沿用）；前端单文件上限 20MB 提示跳过（记录） | open |