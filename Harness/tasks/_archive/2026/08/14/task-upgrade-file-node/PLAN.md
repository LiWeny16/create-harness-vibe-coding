# task-upgrade-file-node - PLAN

## Goal
File node 升级到 VSCode 级渲染与操作能力（全部后端 Node.js 轻量库），并给 agent 完整的控制接口与 skills 说明。

## 决策
- D1 ZIP：浏览+按需解压（列条目+单文件预览+解压单文件到受控目录）
- D2 实时同步：变化感知徽标（fs.watch+WS file.changed+UI 徽标+手动刷新）
- D3 Excel：只读渲染+分页
- D4 库选型：read-excel-file / unpdf / yauzl+iconv-lite（详见 research-results.md 补丁）

## 验收标准（AC，实现/测试/评审均溯源）
- AC-1 读缓存：同一文件节点连续两次 file.preview 同参数，第二次不重读磁盘（mtime+size 校验命中；文件变更后失效重读）
- AC-2 文件锁：file.acquireLock/releaseLock 动作可用（持久化、重启保留、TTL、陈旧锁回收含 pid）；file.writeText 在他人持锁时拒绝（409 file_locked）
- AC-3 变更监听：外部修改文件节点引用的文件后 ≤10s 内产生 file.changed 事件（WS 广播 + 事件落盘），UI 显示"已变更"徽标；重命名/原子写场景 stat 复核不误报
- AC-4 分页读：file.readText 支持 offset>0 与 limit，>64KB 文件可分页读完；file.preview textSnippet 仍 64KB 封顶（不变）
- AC-5 Excel：file.readXlsx 动作返回 sheet 名列表；file.readXlsxSheet(sheet, page, pageSize) 返回列头+指定页行（分页不整表解析）；错误文件返回明确错误
- AC-6 PDF：file.readPdf 返回总页数+元数据；file.readPdfPage(range) 返回页范围文本（含 isEvalSupported:false 安全基线）；损坏 PDF 明确报错
- AC-7 ZIP：file.readZipEntries 返回条目清单（名称/大小/目录标记/GBK 解码，不整包读）；file.readZipEntry 预览单文本条目；file.extractZipEntry 解压单文件到受控目录且拒绝路径穿越（Zip Slip）
- AC-8 agent 接口：全部新动作注册进 action-registry（runtime+template 镜像字节一致）+ drift 测试全绿；workflow-file-node.json 手册含新动作与锁/同步语义（双镜像）
- AC-9 前端：双击 xlsx → 表格分页渲染+sheet 切换；zip → 条目列表+预览+解压；pdf → 新增文本 tab（页数+页文本）；文件变更徽标+刷新按钮；nodeRuntimeClient 补齐封装
- AC-10 回归：相关既有套件（file-node-actions/workspace*/component-node*/registry drift/server.integration）全绿；UI tsc+build 通过

## 库依赖变更
- 新增 dependencies: read-excel-file@^9.3.10, unpdf@^1.8.1, yauzl@^2.10.0, iconv-lite@^0.6
- 安装时 pdfjs 相关不引入（unpdf 零依赖）；yauzl/iconv-lite 为 CJS——确认 ESM 导入兼容

## Subagent Dispatch（WF-Standard）
| Wave | Agent | 写集 | 依赖 |
|---|---|---|---|
| W1T | test-writer | __tests__/workflow-file-cache-lock-watch.test.mjs + workflow-file-formats.test.mjs（RED） | AC-1..AC-7 |
| W1 | implementer | workspace-cache 集成(workspace-store.mjs)、file-node.mjs(锁+分页)、component-node-store.mjs(锁放开 file)、file-watcher.mjs(新)、ws-events.mjs、server.mjs(接线) | W1T |
| W2 | implementer | file-format-adapters.mjs(新)、file-node.mjs(新动作)、action-registry.json×2、skills/workflow-file-node.json×2、package.json 依赖 | W1 |
| W3 | implementer | WorkflowFileBigView.tsx、nodeRuntimeClient.ts、文件卡片徽标(WorkflowRoute/卡片组件)、i18n | W2 |
| W4 | verifier | 全 AC 证据矩阵 + 套件回归 | W3 |
| W4R | reviewer | 安全透镜（Zip Slip/路径/锁/缓存失效）| W4 |
