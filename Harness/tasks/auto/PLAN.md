# WF-AUTO-SPARK Cycle Plan (live)

> 历史：2026-07-13 WF-AUTO 八角度→自适应已完成。现追踪 WF-MAX 可靠性修复 M1-M4。

## Cycle 5 — M4 (WF-MAX 自反验证: 修复 .harness-version drift 根因)

**Mode**: WF-MAX (WF-Max-Useful) within spark cycle 5
**Step 0 probe**: native-subagent + claude/codex peer-CLI available（[CHANNEL-MATRIX.md](CHANNEL-MATRIX.md)）；零 mcp 冒充
**Task**: 修复根 `.harness-version` drift 根因——`build-version.mjs` 不同步根 + `pre-push-check.mjs` 不检查根 drift

### D-GATE Dispatch Table

| Worker | Role | WriteSet (disjoint) | AC | Forbidden |
|---|---|---|---|---|
| **W1** | implementer | `scripts/build-version.mjs` | 写完 templates 后同步根 `Harness/.harness-version` checksum 段（对齐 templates，保留根独有字段） | 其他文件；generator.js |
| **W2** | implementer | `scripts/check-root-harness-version.mjs` (new), `scripts/pre-push-check.mjs` | pre-push 增根 drift 检查（根 checksum vs 实际根文件 sha256） | 其他文件；build-version.mjs |
| **W3** | test-writer | `tests/*.test.js` (new) | 测试 build-version 同步根 + drift 检测 | 依赖 W1/W2（wave 2） |

**Wave 1**: W1 + W2 并行（disjoint writeSets: build-version.mjs vs check-root/pre-push）
**Wave 2**: W3（依赖 W1/W2 产物）
**Verify**: pre-push 6/6（含新 drift 检查）+ 根 drift 不再可能（制造 drift → 被 catch）
**Review**: reviewer
**Reflector**: PASS = M4 done（WF-MAX 真跑通，CEO/Worker 角色链，零 mcp 冒充，端到端证据）

### 角色链说明（WF-Max-Useful 务实）
2 个 disjoint Worker，CEO 直接派 implementer，不强上 Manager 层（响应"4 manager agent 过度工程"批判）。证明：WF-Max-Useful 在小任务上 = CEO + 并行 implementer + D-GATE + verify/review/reflector，不需要 CEO/Manager/Worker 三层强制。
