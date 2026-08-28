# task-wf-ui-terminal-explorer-ux - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived

## Heartbeat

- 2026-08-17 收尾：三块功能全部落地。**验证：m8 e2e 8/8、m4 6/6、m7 7/7（合计 21/21）、reveal 后端单测 4/4、typecheck + build 通过。**
- 回归适配（本任务引入的合法变化所必需）：m4 AC-006 的 top-center/z-order 断言从「固定 160px 菜单中心」改为「菜单 padding 角点 + 物理落视口内」（新菜单 8 项全宽按钮、高度可变）；m4/m7 fixture 增补 `/api/workspace/ops`、`/api/workspace/reveal`、`/api/a2a/nodes/**`（auto-start）拦截——New File/Rename/Delete 从 no-op 变成真实请求后，旧 fixture 若不拦截会打到真实服务端。
- **事故记录**：m4 首次回归跑时 ops 未拦截，真实服务端对仓库文件产生一次写盘（CHANGELOG.md 被写回，1 行偏差）——已 `git restore` 恢复并在 fixture 中拦截阻断。此后真实 ops 污染已杜绝。
- **预存在问题（经 stash 二分实证与本任务无关）**：m2 node-settings 面板（workflow-node-settings）在当前分支 WIP 上打不开——倒回本任务 5 个产品文件（HEAD 版）重建后 m2 AC-005 依旧失败。已记录为 known issue，不在本任务范围。
- 实现要点：终端全屏（保存/还原矩形、Esc 退出、全屏隐藏 resize 手柄禁用拖动）；Explorer 外部点击关闭（预览/右键菜单，含画布区域）、Esc 兜底；VSCode 式右键菜单（New File/New Folder 按右键条目语义落位+冲突递增+创建后重命名态、Rename 回车提交、Duplicate、Delete 走 ops、Copy Path、Open in Explorer）；真实文件拖入/粘贴→base64→ops create-file 上传；浮动模式 header 拖拽+视口钳制；后端新增 `POST /api/workspace/reveal`（路径白名单校验：workspace 根内 + 存在性检查；Windows explorer.exe /select,、macOS open -R、Linux xdg-open；不 shell；`WF_UI_REVEAL_DRY_RUN=1` 测试开关）；File 大视图头部「在资源管理器中显示」按钮。

## Goal Completed

- at: 2026-08-19T14:00:26.947Z
- goalNodeId: goal-task-wf-ui-terminal-explorer-ux
- items: 0
