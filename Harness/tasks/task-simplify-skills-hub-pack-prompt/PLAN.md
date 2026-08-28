# task-simplify-skills-hub-pack-prompt - PLAN

Compact task record.

## Goal

- Outcome: Simplify the Skills Hub so it is a single-surface, low-friction way to (1) see every skill the machine has across all agent runtimes, (2) group/collapse them by name family, (3) select or drag skills into a **skill pack** (skill-group node) on the node map, and (4) have a connected Agent node simply *told in its prompt* that it has those skills. The hub is a **display + selection** surface, not a management/install surface.
- Non-goals: No skill bodies/absolute paths in pack state. No symlinks/copies of skill files. No two-level routing or loadStrategy logic. No Market tab. No new node types. Do not change the agent hydration channel (still `workflow-context` CLI every turn).

## Problem (why)

The hub currently has two overlapping surfaces (global overlay `WorkflowSkillsHubOverlay.tsx` mode `hub`/`group` + per-agent side panel). In hub mode the "Add"/checkbox controls are **dead** (`onSetSkillEnabled`/`onAddSkillToGroup` are undefined), the Context block renders empty JSON, and a Market tab + Install-target UI implies an install flow that doesn't match how a pack actually works. Scanning only covers 5 roots and misses opencode/pi/copilot. The user model is simpler: *hub shows everything, user picks/drags into a pack, the pack is just a prompt to the agent.*

## Scope

- Write set (disjoint claims; see Dispatch table below):
  - `src/wf-ui-server/workflow-skills-hub.mjs` — scan roots + family grouping
  - `src/wf-ui-server/workflow-capability-node-store.mjs` + `src/wf-ui-server/workflow-node-types/skill-group-node.mjs` — pack `prompt` field
  - `src/wf-ui-server/workflow-agent-context.mjs` — merge pack prompt into agent context
  - `src/ui/src/components/WorkflowSkillsHubOverlay.tsx` — single select/drag action, family collapse, rename "Add", remove empty Context block
  - `src/ui/src/components/WorkflowRoute.tsx` — wire overlay callbacks, cut Market tab, route drag to pack node
  - Market removal (D4 彻底摘线): `src/wf-ui-server/server.mjs` (routes + import), `src/ui/src/components/workflow/nodeRuntimeClient.ts` (market functions/types), and the 3 affected test files. Module file `workflow-skills-market.mjs` stays on disk but must be unreferenced.
  - Tests under `src/wf-ui-server/__tests__/` and `src/ui/e2e/`.
  - Docs sync: `Harness/project/architecture.md` §3.4/§3.9 (capability-node state gains `prompt`; agent-context surfaces derived `promptText`).
- Forbidden:
  - No edits to `Harness/a2a/**/state.json` directly (typed actions only).
  - No skill bodies, absolute filesystem paths, or secrets persisted in pack/node state.
  - No new node types or new hydration channels.
  - Do not change `DEFAULT_AGENT_WORKFLOW_SKILLS`, `ON_DEMAND_AGENT_NODE_SKILLS`, or the `workflow-context` CLI contract.

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| D1 | Scan roots = codex, claude, opencode, pi, copilot default skill dirs (user + project). Verified on-disk: `~/.codex/skills`(14), `~/.agents/skills`(4), `~/.claude/skills`(50), `~/.config/opencode/skills`(38), project `.agents/skills`(21), `.claude/skills`(19). opencode user path is `~/.config/opencode/skills` (NOT `~/.opencode/skills`). pi/copilot dirs absent on this machine — add conventional roots (`~/.pi/skills`, `~/.copilot/skills`, project `.pi/skills`/`.copilot/skills`) guarded by `existsSync`; missing roots report `exists:false`, never throw. | User asked for all 5 runtimes; paths must be real, not guessed. `listSkillFiles` already no-ops on missing dirs. | 2026-08-25 |
| D2 | Name-prefix auto-categorization: family = skill name before first `-`/`:` (e.g. `lark-*` → family `lark`). Server already emits `family:<prefix>` groups in `groupSkills` (`workflow-skills-hub.mjs:235`). Keep server grouping; UI renders families as collapsible sections. | Reuses existing server logic; UI just collapses. | 2026-08-25 |
| D3 | Injection = "agent is simply told it has these skills" (option A). The connected pack's skill names are already in `effectiveSkills` (`workflow-agent-context.mjs:1554-1559`). Add an optional human-readable `prompt` to the pack that is surfaced in the agent context so the connected Agent *must* be told (connection ⇒ told). No loadStrategy/trigger-routing. | User: "只要连线有就必须告知而且很可能任务要用到". | 2026-08-25 |
| D4 | **Cut the Market tab + fully unwire** `workflow-skills-market.mjs` from the hub surface (user chose "彻底摘线"): remove the hub Market tab (overlay `:23,:125,:151,:573-640,:1064` + route `:8499,:8511-8521,:8593-8597,:8631-8675`), server routes `server.mjs:110,:1467-1495`, `nodeRuntimeClient.ts:184,205,738-754`, and update/delete the 3 affected tests (`__tests__/workflow-skills-market.test.mjs`, `e2e/wf-ui-m4-w38.spec.ts:816`+mock, `e2e/wf-ui-skills-hub-drag.spec.ts` inert mock). Module file `workflow-skills-market.mjs` stays on disk but unreferenced. | User: "先砍了吧" + chose 彻底摘线. | 2026-08-25 |
| D6 | Name-family groups (e.g. `lark-*`) render **collapsed by default** in the hub UI; expandable on click. | User chose 默认收起. | 2026-08-25 |
| D5 | Pack (skill-group node) keeps `skillNames`/`skills`/`skillCount` and gains one optional `prompt` (string, ≤ ~600 chars, default derived from skill names). No bodies, no paths. | Smallest state change that realizes option A. | 2026-08-25 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | `listSkillsHub` scans all 5 runtimes' default roots; response `roots[]` includes codex/claude/opencode/pi/copilot entries (user+project where conventional); missing roots present with `exists:false`, no throw. | New/updated unit test in `workflow-skills-hub` + manual `node` call against a temp project. | pending |
| AC-002 | Skills whose names share a prefix (e.g. `lark-*`) are grouped by the server under `family:<prefix>`, and the hub UI renders each family as a collapsible section (collapsed by default, expandable). | UI unit/e2e asserting a `lark` family section exists and toggles; server test asserting `family:lark` group. | pending |
| AC-003 | A skill-group (pack) node supports an optional `prompt` field: set via configure, persisted in state, returned by read/list. Default is a derived "you have these skills" sentence when omitted. | Unit test on capability store + skill-group node type. | pending |
| AC-004 | For an Agent connected to a pack, the agent context surfaces the pack's prompt (and skill names) so the agent is told it has those skills; a pack with no `prompt` still yields a derived "has these skills" line. Connection ⇒ always surfaced. | Unit test in `workflow-agent-context.test.mjs` asserting the connected pack's prompt appears in the built agent context. | pending |
| AC-005 | The global hub overlay has ONE primary action (select/drag skills → create pack node on the map). "Add" is renamed to reflect "add to pack" (or removed in favor of the single action); the empty Context JSON block is removed; hub mode no longer renders dead `onSetSkillEnabled`/`onAddSkillToGroup`-dependent controls. | UI code review + e2e: clicking the primary action with a selection creates a skill-group node. | pending |
| AC-006 | The Market tab is removed from the hub UI and `workflow-skills-market.mjs` is no longer wired into the hub surface (no market routes referenced by the overlay/route). | Grep + build: no `skills-market` import/usage in the hub overlay/route path. | pending |
| AC-007 | Build + existing wf-ui-server and UI test suites pass; no regression in existing `effectiveSkills`/skill-group tests. | `npm test` (or the repo's test script) green. | pending |

## Expanded Contracts

- **Pack `prompt` default**: when `prompt` is empty, the context layer renders `You have the following skills available in this pack (<title>): <name1>, <name2>, ... Use them when the task needs them.` Names come from `skillNames`. This guarantees option A (connection ⇒ told) without requiring the user to author a prompt.
- **Roots contract**: each root is `{ id, label, scope: 'project'|'user', runtime: 'codex'|'claude'|'opencode'|'pi'|'copilot', rootPath, path, exists }`. `listSkillFiles` unchanged (matches `SKILL.md`, depth < 4, no-ops on missing dir).
- **Family contract**: server `groups[]` already includes `kind:'name-family'` entries; UI keys collapsible sections off `group.kind === 'name-family'`.

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| opencode/pi/copilot root paths wrong → empty scans or noise | Verified opencode on-disk (`~/.config/opencode/skills`); pi/copilot added as guarded conventional paths, `exists:false` when absent. AC-001 covers. | open |
| `WorkflowRoute.tsx` is ~9840 lines; edits risk regressions | Surgical edits only; AC-005/AC-006 have e2e; existing suite must pass (AC-007). | open |
| Removing Market breaks existing tests that reference market routes | Keep `workflow-skills-market.mjs` on disk; only unwire from hub surface; adjust/remove hub-market tests in the same wave. | open |
| Prompt field changes pack state shape and breaks `STATE_MISMATCH`/revision logic | Add `prompt` in `skillGroupStateFor` alongside existing fields (no schema bump needed — state is additive); bump revision via existing `updateCapabilityNode`. | open |

## Subagent Dispatch

### D-GATE

- Dispatch table below; AC IDs mapped; file claims disjoint across parallel workers; self-audit + reviewer plan present.
- `fanoutAttempted: true` will be recorded in PROGRESS after the native Agent-tool fan-out attempt.

| Wave | Agent | Role | Read set | Write set (claim) | AC | Dep | Status |
|------|-------|------|----------|-------------------|----|----|--------|
| W1 | architect | Review layer boundary for pack `prompt` + context merge | agent-context, capability store, skill-group node | none (report) | AC-003/AC-004 | - | pending |
| W2a | implementer | Extend scan roots + family grouping | workflow-skills-hub.mjs | `src/wf-ui-server/workflow-skills-hub.mjs` | AC-001/AC-002 | - | pending |
| W2b | implementer | Add pack `prompt` field | capability store, skill-group node | `src/wf-ui-server/workflow-capability-node-store.mjs`, `src/wf-ui-server/workflow-node-types/skill-group-node.mjs` | AC-003 | - | pending |
| W2c | implementer | Merge pack prompt into agent context | agent-context | `src/wf-ui-server/workflow-agent-context.mjs` | AC-004 | W2b | pending |
| W2d | implementer | Simplify overlay + cut Market | overlay, route | `src/ui/src/components/WorkflowSkillsHubOverlay.tsx`, `src/ui/src/components/WorkflowRoute.tsx` | AC-005/AC-006 | W2a | pending |
| W2e | test-writer | Tests for all ACs | all above | `src/wf-ui-server/__tests__/*`, `src/ui/e2e/*` | AC-001..AC-007 | W2a-W2d | pending |
| W3 | reviewer (spec) + reviewer (code) | Cross-review | diff, PLAN | none | all | W2e | pending |
| W3v | verifier | Run build + tests, AC matrix | all | none | AC-007 | W2e | pending |

### Self-audit

- Disjoint write claims: W2a (hub), W2b (store+node type), W2c (context), W2d (overlay+route) touch 5 distinct files — disjoint, safe to parallelize. W2e writes only tests. No two writing agents share a file.
- Deps: W2c depends on W2b (context reads the new `prompt` from `capabilityStateRefs`); W2d depends on W2a (overlay consumes new roots/family shape). Others independent.
- CEO writes no source; all source edits via implementer/test-writer.

### Reviewer plan

- reviewer(spec): AC coverage, non-goals respected, Market actually unwired.
- reviewer(code): correctness of root paths, prompt default derivation, no path/body leak into state, surgical diff.
- verifier: build + full test suite + AC-by-AC matrix.
