# Tool Usage Reflections

Purpose: record repeated tool failures, better command patterns, and environment-specific fixes.

Write here when:
- The same tool/use pattern fails 3+ times in one task or across repeated tasks.
- A more reliable command pattern replaces a brittle one.
- The environment needs a durable fix, flag, path rule, shell syntax, or startup sequence.

Entry format (compact, default no date):

```markdown
- When <scenario>: <rule>. Avoid <over-application>. Signals: <signals>.
```

Only use date/timestamp headings when:
- Entry supersedes prior conflicting guidance
- Time-sensitive context (version, deprecation)
- Conflict resolution needed

Never record one-off command failures. Never store secrets, credentials, or private tokens.
- Entry supersedes prior conflicting guidance: add date stamp.

## Lessons

- When dispatching a `researcher`/`reviewer` subagent whose task involves hooks, settings, or config-shaped content: the harness instruction-shape filter may neutralize its return — output becomes `[harness: subagent output matched instruction-shaped pattern(s): settings-json]` with empty/blank body. Avoid re-dispatching the same researcher role repeatedly (it'll keep tripping the filter) — the CEO can run `WebSearch` directly for the same research and control the output shape. Signals: subagent return shows the neutralization banner + empty body, 2+ occurrences in one session (observed: an engineering-quality reviewer and a spark-search researcher both swallowed this way).

- When running wf-ui Playwright e2e: the e2e webServer (`src/ui/e2e/start-wf-ui-server.mjs` → `src/wf-ui-server/server.mjs`) serves the PREBUILT `src/ui/dist` bundle, NOT live source — any change under `src/ui/src/**` requires `npm run build` in `src/ui` BEFORE the e2e run, or the run silently tests the old bundle. Avoid reading an e2e result as reflecting current source when `src/ui/src` was edited since the last build. Signals: e2e failures that read as "feature missing" right after a `src/ui/src` edit, or a verifier round burning on 7/8 "missing feature" failures that all vanish after a rebuild.

## 2026-08-12 — 嵌套 manager 子链结果不返回（2 次：explore-manager、review-manager）

WF-MAX 中 manager 通过 Agent 工具派发子研究员/reviewer 后，父 agent 会停在"等待子结果"并返回，子结果永不回传到其上下文（3 次 resume 均无）。

**Why:** 该会话中嵌套 agent 链的父-子结果投递不可靠。
**How to apply:** 需要"收集 N 个子 agent 结果再合成"的场景，直接由 CEO 并行直派叶子 agent 并自行合成；或给 manager 一次性指令"等待全部子结果并立即返回"并做好 resume 兜底。记录 fanout 降级到任务 STATE。
