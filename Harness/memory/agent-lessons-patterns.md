# Agent Lessons And Patterns

Purpose: record reusable lessons from review, debugging, validation, and handoff loops.

Write here when:
- A review/debug loop reveals a reusable prevention pattern.
- A validation failure exposes a missing regression check.
- A handoff, dispatch, or context-loading pattern should be repeated or avoided.

Entry format (compact, default no date):

```markdown
- When <scenario>: <rule>. Avoid <over-application>. Signals: <signals>.
```

Only use date/timestamp headings when:
- Entry supersedes prior conflicting guidance
- Time-sensitive context (version, deprecation)
- Conflict resolution needed

Keep entries lightweight and actionable. Avoid secrets, speculative lessons, task logs, and process summaries.
- Entry supersedes prior conflicting guidance: add date stamp.

## Lessons

- When applying programmatic position/layout changes in the wf-ui ReactFlow canvas (src/ui/src/components/WorkflowRoute.tsx): (1) visual apply is separate from persistence — you must BOTH updateGraph({positions}) (drives state + debounced PUT persistence) AND setNodes() with the same positions (the only thing ReactFlow renders; the drag/dock path at ~:4566 does this, the tidy-layout path initially missed it), keyed node.id || node.data.workflowNode.graphNodeId; (2) new client→server payloads need an HTTP test pinning the exact field names the server reads — the tidy action sizes contract was pinned {w,h} but the client shipped {width,height}, the server silently dropped sizes and fell back to 280x180 slots → overlap at real rendered sizes while unit tests (slot sizes) stayed green; (3) server-side placement paths (session/agent creation, autoPlaceNode/sessionGraphNodePosition) must be size-aware — snapshot reload clobbers the client-computed spot unless the POST carries {position} AND the server verifies clearance with real per-kind extents (NODE_KIND_SIZES: agent 560x358 vs 280x180 slot). Avoid assuming graph state alone re-renders node positions, or that any single layer (code review, unit tests) catches these — each was found only by end-to-end measurement. Signals: persisted positions (workflow-map.json version bump) but rendered rects unchanged / overlap count identical after a layout action; payload accepted but sizes ignored; large agents overlapping right after creation.

- When adding transient/optimistic nodes (e.g. loading placeholder, kind 'loading-placeholder', no data.workflowNode) to a ReactFlow controlled canvas (src/ui/src/components/WorkflowRoute.tsx, @xyflow/react 12): the nodes-merge effect MUST short-circuit setNodes for unchanged entries — any per-render-churning dep (i18n hook returning a fresh `t` each render, I18nContext.tsx:42; inline callbacks like `callbacks`) turns the insertion into React error #185 "Maximum update depth exceeded" → whole canvas unmounts (0 nodes) via setNodes→props re-adopt→re-measure→onNodesChange→setNodes loop. Fix: node-equality comparator (sameFlowNodes) must compare transient-node content (kind/label/width/height) so unchanged placeholders short-circuit; normal nodes are immune because identity is stable. Avoid merging transient nodes before the comparator covers their content. Signals: React error #185, canvas unmounts to 0 nodes, effect deps containing `callbacks`/fresh i18n `t`, setNodes loop after placeholder insertion.

- wf-ui Skills Hub ↔ skills group semantics (compose multi-select draft set in hub → drag chip → overlay hides → drop on canvas creates skill-group node; frontend-only, backend store already supports skill-group) is documented in Harness/tasks/task-fix-wf-ui-ux-issues/PLAN.md W0 Synthesis — project doc pointer, not durable memory.

- When a WF-MAX/WF Worker channel fails (timeout/missing/unavailable): do NOT fall back to a CEO-thread MCP tool call (`mcp__codex.codex_implement`, `mcp__claude.claude_implement`) and log it as "preserving the CEO no-source-edit invariant" - that is **fake compliance** (in-process tool call: no independent context, no enforced writeSet). Worker = independent agent context only (native subagent or peer-CLI process). Avoid counting any CEO-thread tool call as Worker execution. Signals: task record says "delegated to mcp__*.implement", "preserve no-source-edit invariant" + mcp tool used, high failure count + CEO wrote source. Enforced by `Harness/specs/workflows/WF-MAX.md` "Worker Channel Degradation & Independence" + validator (task-* capsules forbidding `mcp__*.implement` unless ANTI-PATTERN). Historical instance: `tasks/task-framework-metrics-and-entry-contract/PLAN.md:791`.

- When dispatching a WF-MAX Worker: prefer native subagent (Agent tool) first when it has already returned successfully in the session; otherwise use a bounded peer CLI via `wf-agents-docs` and return an evidence packet on stdout. Avoid assuming "all channels down" from stale failure logs, creating ad hoc probe scripts, or writing peer output to `%TEMP%`. Signals: framework-metrics-style failure, "channel unavailable", 300s timeout, failure count rising, CEO tempted to write source directly.

- When editing any file under `templates/common/`: the root `Harness/.harness-version` checksums are auto-synced by `npm run build:version` (write mode), and drift is caught by `scripts/check-root-harness-version.mjs` (pre-push check); `acceptedConflicts` `accept-local` files + their cross-runtime mirrors are exempt. Avoid hand-patching root checksums (error-prone - was the drift root cause through cycles 2-4). Signals: pre-push "root harness-version drift" FAIL, root checksum lagging templates, `Harness/.harness-version` stale after a templates edit.

- When framework/tests create temp dirs: put them under project-local `Harness/.temp` via `tests/support/temp-root.js` or a local subdir such as `Harness/.temp/wf-ui-launch`, and always remove them in `after()`/`afterEach()`/`finally` with `fs.rmSync(..., { recursive: true, force: true })`. Never introduce new `fs.mkdtempSync(path.join(os.tmpdir(), ...))` sandbox roots. Backstop: `scripts/check-temp-leak.mjs` snapshots known framework prefixes in system temp and recursively snapshots `Harness/.temp`; any net-new leftover in either location fails. Signals: `%Temp%/harness-*` accumulating unboundedly, `mkdtempSync(os.tmpdir()` in tests, or `Harness/.temp` not empty after guarded tests. Historical instances: `tasks/task-tempdir-cleanup/`; `src/wf-ui-server/__tests__/session-cleanup.test.mjs` leaked two inline cleanup dirs until moved to named finally-cleaned roots.

- When a user decision removes a just-added API (e.g. parsePdf/pdfjs): sync the task PLAN/AC contract text AND remove dead test-name references in the same pass as the code change, or the doc drift surfaces at closeout. Avoid leaving the removed API in PLAN ACs while shipping the code without it. Signals: reviewer "docs-sync" finding (F3 class), PLAN still promising a removed action, package.json cleaned but PLAN/test names still mention the removed API.

- When creating probe/test nodes via backend APIs for measurement (e.g. perf timers): cleanup MUST be atomic across ALL backend-owned artifacts — state dir, `Harness/a2a/*/index.json` entry, and workflow-operations.jsonl rows. Deleting only the state dir leaves a dangling index entry; the strict-read snapshot then throws STATE_MISMATCH and the whole `/api/a2a/snapshot` 409s, locking users out of the UI. Prefer the typed delete API with a real actor; if falling back to fs removal, patch the index + ops log in the same pass and verify with `GET /api/a2a/snapshot` → 200 afterward. Signals: snapshot 409 after test-node cleanup, index entries referencing missing state dirs, "进不去/loads 409". Historical instance: W38 perf probes left 3 dangling event-node index entries; fixed by filtering the index + ops log and re-verifying snapshot 200.

## 2026-08-12 — 验证"e2e 覆盖"声明前先查 spec 是否 mock 了后端

reflection 发现 verifier 声称"AC-025 后端端点经 e2e 覆盖"，但 e2e spec 对 /api/a2a/bridge-messages 等路由是 page.route mock，后端派生逻辑零测试命中。

**Why:** mock 后的 e2e 只能证明 UI 正确消费契约，不能证明后端实现正确。
**How to apply:** 对"端点已被 e2e 覆盖"的声明，grep 测试文件确认路由是否被 mock；mock 则需补独立后端单测或将 AC 记为已知缺口。评审/验证矩阵必须在 dispatch reflector 前写入 PROGRESS。

- When adding a memo/cache to a read-hot backend path (e.g. `buildWorkflowSnapshot` in src/wf-ui-server/a2a-store.mjs): (1) never place `invalidateSnapshotCache`-style invalidation inside read-path initializers like `ensureA2aDefaults` (called by loadRoleGraph → every snapshot build) — it wipes the memo on every build and the cache silently never hits; (2) the memo key must include file metadata (workflow-map mtimeMs+size) so writes that skip the version bump still invalidate; (3) mtime-keyed caches are unsafe for same-millisecond rewrites — add a fresh-file guard (re-read files modified within ~1.5s) or tests will read stale state; (4) adding a new WS event type breaks old integration tests that read frames positionally — tests must skip non-matching frames by type. Verify memos with an object-identity benchmark (cold/warm/ttl-expired), not just unit tests — the memo was provably non-functional while all 799 tests stayed green except timing-sensitive ones. Signals: warm call ≈ cold call timing, `memo? false` after first build, test asserting exact frame sequence.

- When writing wf-ui e2e fixtures: mock EVERY endpoint the app auto-calls on startup, not just the ones the feature under test uses — the workflow route auto-starts the main agent node on load (`POST /api/a2a/nodes/<id>/start`) and the e2e dev server has no session registry, so an un-mocked start returns 501 and sets a PERSISTENT error toast. Because `WorkflowRoute.tsx` renders `workflowToast = error ? persistentErrorToast : statusToast`, that persistent error toast MASKS any later success toast → save-feedback/confirmation assertions fail with a misleading "Session registry not available" message. Avoid leaving startup auto-calls un-mocked just because they are not part of the feature being tested. Signals: success-toast assertion failing with a session-registry/501 message, a persistent error toast still present after an otherwise successful action.

- When verifying a keyboard-shortcut / keypress feature in e2e: (a) the surface that activates the listener must actually be OPEN in the test — a closed surface leaves the hook inactive and the run exercises the wrong branch; (b) an assertion that a debounced/network effect "eventually happens" is a fake pass when natural timer expiry produces the same observation — use a hard deadline strictly inside the debounce window, or assert a second-gesture / signature delta, so deleting the new code makes the test fail. Avoid "poll until X appears with a generous timeout" for any effect indistinguishable from timeout expiry. Signals: test green with the feature code removed, shortcut only working once the modal/surface is pre-opened, a generous-timeout e2e that would also pass on the old code.

