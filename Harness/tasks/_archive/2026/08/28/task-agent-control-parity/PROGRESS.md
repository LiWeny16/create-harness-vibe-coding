# task-agent-control-parity - PROGRESS

## Current

- Phase: Archived
- **P6c claude resume 打通** ✅: stop 时从终端流物化 transcript（纯硬编码 0 token）→ resume 真机全链 PASS（见 RESUME-E2E-EVIDENCE.md PASS 8，12/12）。新模块 claude-transcript-materializer.mjs + stopRuntimeSession 接线（含后端重启后的磁盘记录回退物化）+ 10/10 单测。期间修复 2 个真实 bug：ring 形状假设（promptSubmit 回车不进 ring）、registry 空 stop 不物化
- **P6d spawn 风暴治理** ✅: 根因=画布加载自动启动所有非 live main agent → 12 个重型 PTY 并发 → 机器饱和。修复：spawn-gate.mjs 并发闸门（上限 2、FIFO、120s 死锁断路器，4/4 单测）+ UI 只自动恢复 stale starting 节点。画布 12 个测试节点已清（0 节点）
- **P7 多节点性能三件套** ✅（用户选 P1 全做）: P1a 快照增量（stateFingerprint=图版本|会话数|最新 updatedAt，走内存索引；?since= 未变返回 {unchanged:true}；前端 5s 轮询跳过 setWorkflow）+ P1b 启动状态降级迁移（重启时 22 个假活 running/starting 会话持久化为 stopped，wsClientCount/attachMode 清零）+ P1c 终端写入批处理（每会话缓冲 500ms/64条/64KB 单次 flush，读前 flush，stop/exit 强制 flush）。新测试 workflow-state-reconcile（S1-S5）+ AC-002b since 路由测试。真机：22 降级 + 指纹往返 ✓
- 已知既有失败（非本次引入）: team-flow ×2（未跟踪测试文件）、D1b registry drift（goal 自动关任务功能未注册 2 个 action——待补）
- **P8 Display 节点** ✅: 新 component 类型 display（report.html 落地存储、完全开放 JS 为用户决策、iframe 全屏渲染、白蓝黑+Claude黄主题模板、{{excalidraw:<id>}} 占位符展开为自包含内联 SVG、excalidraw-svg.mjs 场景渲染器）。display.write/read 注册进 registry/ontology/runtime/manuals（workflow-display-node.json 双镜像）。触发保障 4 层：init.md 注入铁律行、能力自动可见、display.read 附 usage、manuals display 说明书。8/8 单测 + 服务路由测试 + 真机 E2E（create→write→serve→ontology 全过）。期间修复：状态机分支（display 误入 file 路径）、适配器签名契约（handler(nodeId, projectRoot, payload)）、D0b 白名单 + goal.* 两个内部回调白名单
- Next: commit decision (user)

## Wave Progress

- **W1 并行** ✅: P1 数据层（spawnGate 替代 mainOnly，ontology 身份无关化）、P4 store+CLI（updateEdge + EMPTY_UPDATE 守卫）、P6 zIndex（统一 35 + 删除框 920）、loader spawnGate 校验
- **W2 server.mjs 单 owner** ✅: 深度门（POST /api/sessions 403 DEPTH_LIMIT）、resume 接线（spawn 参数验证含 pty fixture 端到端）、磁吸三动作（attachDock/detachDock/setDockSide）、updateEdge HTTP 路由。22/22 新测试
- **W3 UI** ✅: 通讯面板（点击节点看信箱流，testid workflow-comm-panel）、TerminalDrawer zIndex 88→900、磁吸 UI 走后端动作（404 优雅回退）
- **P5 撤销** ✅: CEO 设计（切片快照反演）→ 后端实现（recordGraphOp 全记录点 + graph.undo/redo + 版本守卫 + 50 上限）+ UI 按钮/Ctrl+Z 走后端。首 worker 死于 infra 故障，重试接手完成
- **P5b codex resume 修复** ✅: rollout UUID 检测器（30s 窗口）→ session 持久化 → resume 参数映射（codex resume <rolloutId>）。6/6 新测试

## 端到端控制测试（真实后端 + 真实终端，8/8 通过）

| # | 检查 | 结果 |
|---|------|------|
| C3 | 深度门：子 agent spawn → 403 DEPTH_LIMIT | ✅ 真响应体 |
| C4 | 撤销：move → undo → 位置精确恢复 | ✅ |
| C5 | 磁吸：attach/setSide/detach 全链 | ✅ |
| C6 | 边更新：delegation → workflow-link | ✅ |
| C7 | resume 响应级：resumeUsed + resumeArgs | ✅ |
| C8 | **真实终端**：逐字符打字 → 真 codex CEO 自己跑 create-agent → 新 implementer 节点 | ✅ 262 字符 12ms/字符 |
| C9 | resume 进程级：wmic 捕获 spawn 命令行含 resume 参数 | ✅（codex 内部 UUID 映射已修） |

证据：`Harness/tasks/task-agent-control-parity/E2E-EVIDENCE.md`

## Verification

| Suite 组合 | 结果 |
|-----------|------|
| 17 套件组合跑 | **304/304 PASS** |
| 全量 26 套件（E2E 验证时） | 395/395（数修复后） |
| UI tsc + build | PASS |
| npm test | 286/0（上一波） |

## 用户决策记录（本任务落地）

- D-A 无认证、无 CLI 身份检查
- D-B 所有 agent 权限平等，身份只是标签
- D-C 唯一规则：spawn 深度门（root 可建画布 agent，depth=1 被拒，runtime 内置 subagent 不受限）
- D-I 无 exec 模式

## 遗留（记录）

- 撤销 settings PATCH 未做（设计开放问题，可裁剪）
- attachDock 无边的对返回 ok 但持久化时被归一化丢弃（按设计，需先连边）
- session-registry schema 未加 codexRolloutId 字段（直接对象赋值，后续可归化）
