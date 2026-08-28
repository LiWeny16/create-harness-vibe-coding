# task-upgrade-file-node - PROGRESS

## Current
- Phase: Archived
- 波次：W1T(15 RED) → W1(缓存/锁/监听) → W2(格式+9动作+registry/manuals) → W2FIX(display 手册) → W3(前端) → W4(真机 AC) → W4F(安全修复) → W4C(计数钉+落盘日志) → W5F(R1/R2+yauzl 挂起) → W4R3(终审 PASS)

## 验证汇总
- 新测试：cache-lock-watch 7 + formats 20 + display 8 + spawn-gate 4 + state-reconcile 6
- 回归：75/75（loader+cache+formats+server.integration 组）、54/54×2 integration、55/55 control-plane
- 真机：AC-1/2/3/4/5/6/7/8 PASS（含 WS 215ms 广播、GBK 解码、ZIP_SLIP 400、file-changed.jsonl 落盘）
- UI：tsc + 生产 build 通过
- 安全评审三轮：H1/M1/M2/M3/L1 → 修复 → R1/R2 闭合 → 终审 PASS

## 遗留（不阻塞）
- AC-9 浏览器级验收待用户（硬刷新后双击 xlsx/zip/pdf 节点 + 看变更徽标）
- extract 不参与 undo（文档化限制）；file-changed.jsonl 无轮转；readZipEntries 动作层未透出 truncated/total
- 3 项既有基线失败（team-flow×2、node-config AC-005）与任务无关
