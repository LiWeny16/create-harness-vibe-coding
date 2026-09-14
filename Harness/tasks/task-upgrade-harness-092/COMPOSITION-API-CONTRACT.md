# Native node composition / API-FSM contract

状态：增量设计草案，不改变 AC-01..AC-09。角色：architect；版本：`composition-api/v0.1`。

## 1. 唯一事实与连线

`compositionId` 复用快照 `workflowId`（无任务为 `workflow-none`，`a2a-store.mjs:3053-3058`）。后端唯一事实由 typed graph（版本/边规范化：`workflow-graph-store.mjs:359-396`）、revisioned node state（`workflow-event-node-store.mjs:476-525`）、bridge 消息（`bridge-store.mjs:88-134`）和 operation audit（`architecture.md:362-371`）组装；禁止前端或第二 composition store 写 canonical state。

Timer 端口固定 `event` 输出、`config` 输入、`status` 双向（`workflow-agent-context.mjs:830-840`）。Timer→Agent 必须 `source-to-target + relation:event`；Agent→Timer 必须 `source-to-target + relation:control`，句柄 `context→config`（现有组合：`WorkflowRoute.tsx:1835-1845`）。`from/to` 只表示端点顺序，权限看 relation/direction/handle/actor。

## 2. FSM 与 envelope

```text
idle→scheduled→due→fired→queued→delivered→consumed
scheduled→paused；due|fired|queued→retrying→queued|failed
```

状态仅后端写入；`stateRevision` 单调，`idempotencyKey` 唯一。转移 envelope 至少含 `compositionId,transitionId,from,to,cause,eventId,wakeupId,timerNodeId,targetNodeId,edgeId,graphVersion,stateRevision,at,contextRefs`。`delivered` 仅代表 bridge 落盘，`consumed` 需 Agent ack/游标；UI 不得推断。Timer loop/while/task 是声明式，禁止执行用户代码（`architecture.md:270-274`）。

## 3. API、事件、场景

写面复用：`POST /api/workflow/edges`、`GET /api/workflow/context/:node`（`server.mjs:1824-1857,1883-1888`）；Timer 用 `POST /api/workflow/nodes/:timer/actions/timer.*`，需 actor、期望 revision、control edge、policy（`workflow-node-runtime.mjs:1283-1312`；`workflow-agent-context.mjs:981-1037`）；Agent 用 `agent.readMessages({wakeup:true,afterSeq})`（`agent-node.mjs:633-658`）。增量新增只读 `GET /api/workflow/compositions/:id`，即时返回 `{schemaVersion,compositionId,graphVersion,fsm,timer,agents,edges,lastTransitions}`，不得成为第二写源。

到期流程：scheduler 先 `fire` 后 `dispatchWakeup`（`timer-wakeup-scheduler.mjs:145-167`），只写 bridge、不写 PTY（`timer-node.mjs:353-357`）；Agent 下一轮 pull/ack，重复 key 返回原结果；无 control 边/策略拒绝分别为 `CONTROL_EDGE_REQUIRED`/`CONTROL_DENIED`；revision 冲突为 `STALE_REVISION`，重读 context 后重试。WS `composition.transition` 仅通知；现有 `/ws/events` 为 metadata 的 `graph.changed`（`ws-events.mjs:234-265`）。

## 4. Context、前端边界、性能

`GET context` 按当前 graph/version 重建 `connectedEventRefs` 与 affordances（含 allowed/denied/requiredEdge：`workflow-agent-context.mjs:1092-1151`），Agent context 返回 refs、ontology、affordances、graphVersion（`workflow-agent-context.mjs:1695-1720`）。UI 只读 snapshot/nodes/聚合；fingerprint 轮询可复用（`WorkflowRoute.tsx:3933-4007`）。localStorage/IndexedDB（`WorkflowRoute.tsx:1349-1397`）仅作 `compositionId+version` 缓存；runtime state、权限、FSM 不得回写。现有整图 PUT（`WorkflowRoute.tsx:5578-5653`）只能暂留布局兼容，runtime mutation 必须走 typed API。

性能沿用 bounded、`unref`、约 1s scheduler（`timer-wakeup-scheduler.mjs:19-25,171-225`）；按 Timer 扫描，不为 Agent 建计时器；WS 只传 metadata，内容落 artifact（`HARNESS_BRIDGE.md:319-345`）；聚合沿用 fingerprint/memo（`a2a-store.mjs:2892-2902`）。

## 5. AC、风险、切片

| AC | 判据 |
|---|---|
| COMPOSE-AC-01 | event/control 端口、方向、关系、句柄明确；反向控制拒绝 |
| COMPOSE-AC-02 | FSM、revision、幂等、retry/paused/failed 可恢复 |
| COMPOSE-AC-03 | Timer→bridge→Agent pull/ack；无 PTY 注入 |
| COMPOSE-AC-04 | control edge+policy+revision 生效并可审计回读 |
| COMPOSE-AC-05 | context/聚合后端生成；UI 仅展示/缓存，回读一致 |

未决：①当前 `dispatchWakeup` 将 event 与 control 边都算收件人（`timer-node.mjs:385-403`），严格语义应仅 event 唤醒；②`recordBridgeMessage` 不去重（`bridge-store.mjs:109-134`），幂等层待定；③WS 无 ack，API pull 或新增事件待定；④整图 PUT 与后端唯一 state 冲突。

文件变更：仅本文件。最小切片：聚合 GET→wakeup key/ack cursor→Timer action 统一 revision/operation→semantic context/UI cache 隔离→CLI/API/浏览器矩阵验证。下一步由父模型确认四项冲突及 `consumed` ack，再分配实现与独立 verifier。
