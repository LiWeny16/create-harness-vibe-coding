# task-subagent-strategy-2x2-matrix - PLAN

## Goal

Implement the complete 2x2 subagent strategy matrix for WF UI Agent collaboration:
- **CC/Claude Code × built-in-subagents**: Native subagent fan-out, no canvas worker nodes
- **CC/Claude Code × wf-node-subagents**: Create/connect WF Agent nodes, mailbox communication
- **Codex × built-in-subagents**: Native subagent path or clear degradation evidence
- **Codex × wf-node-subagents**: Codex main → Claude Code implementer node, reply aggregation

This extends `task-agent-team-cooperation-layer` (55/55 suite at VERIFY2). The 55/55 tests proved the WF-node-subagents backend control plane works. What's missing: built-in subagents path, mode selection, NL routing, and execution routing that actually controls whether agents use native subagents vs WF canvas nodes.

## Architecture

### Component Map

```
┌─────────────────────────────────────────────────────┐
│                   UI (React)                         │
│  WorkflowRoute.tsx: createAgentNode                  │
│  AgentNodeSettings.tsx: subagentMode selector        │
│  types.ts: SubagentMode type                         │
└────────────┬────────────────────────────────────────┘
             │ POST /api/workflow/nodes
             ▼
┌─────────────────────────────────────────────────────┐
│              server.mjs                              │
│  createRuntimeSession: subagentMode default          │
│  nodeInitMarkdown: inject subagentMode               │
│  writeNodeHome: write init.md                        │
└────────────┬────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│         session-registry.mjs                         │
│  create(): store subagentMode on session             │
│  DEFAULT: built-in-subagents (was wf-subagents)      │
└────────────┬────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│           a2a-store.mjs                              │
│  snapshotWorkflowState: expose subagentModes[]       │
│  subagentModes: [{built-in-subagents}, {wf-node}]    │
└────────────┬────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│     workflow-agent-context.mjs                       │
│  buildAgentContext: include subagentMode              │
│  HARNESS_SUBAGENT_MODE env var                       │
└─────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│         init.md (node home)                          │
│  "## Subagent Strategy"                              │
│  "subagentMode: built-in-subagents | wf-node-..."    │
│  NL trigger phrases documented                       │
│  Execution routing rules                             │
└─────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│         CLAUDE.md / Agent Behavior                   │
│  Agent reads subagentMode from init.md               │
│  built-in → use Agent tool, no canvas nodes          │
│  wf-node → use wf-ui-control.mjs, create WF nodes    │
│  Records fanoutAttempted + channel + evidence         │
└─────────────────────────────────────────────────────┘
```

### Data Flow: subagentMode

```
UI create agent → POST payload.subagentMode
  → server.mjs: cleanString(payload.subagentMode, 'built-in-subagents')
  → session-registry.mjs: session.subagentMode
  → server.mjs: graph node serialization
  → a2a-store.mjs: snapshot (per-node + catalog)
  → pty-adapter.mjs: HARNESS_SUBAGENT_MODE env var (NEW)
  → server.mjs: nodeInitMarkdown includes subagentMode (NEW)
  → workflow-agent-context.mjs: buildAgentContext includes subagentMode (NEW)
  → init.md: "subagentMode: <value>" (NEW)
  → Agent reads init.md → decides execution path
```

### Accepted Values

| Value | Label | Behavior |
|-------|-------|----------|
| `built-in-subagents` | Built-in Subagents | Use native subagent mechanism (Agent tool for CC, codex_implement for Codex). Do NOT create WF canvas Agent nodes. Record fanoutAttempted + channel + evidence. |
| `wf-node-subagents` | WF Node Subagents | Create/connect WF Agent nodes via wf-ui-control.mjs. Use mailbox for 1:1/1:many communication. Timer/Markdown/Goal nodes collaborate. Visible Agent nodes + edges + mailbox evidence. |

Legacy `wf-subagents` is renamed to `wf-node-subagents`. Backward compat: accept `wf-subagents` as alias for `wf-node-subagents` during migration window.

### NL Trigger Detection

Built into init.md — the agent reads these rules from its init prompt:

| Trigger Phrases | → Mode |
|-----------------|--------|
| "内部助手", "内置子代理", "不要开画布节点", "native subagent", "built-in subagent", "不用WF节点" | `built-in-subagents` |
| "画布Agent节点", "开Claude Code节点", "WF node协作", "可视化协作", "canvas worker", "wf node subagent", "用画布节点" | `wf-node-subagents` |
| (unspecified) | `built-in-subagents` (default) |

### Execution Routing (in init.md / CLAUDE.md)

```
IF subagentMode == 'built-in-subagents':
  - Use runtime-native subagent mechanism
  - CC: Agent tool with .claude/agents/* roles
  - Codex: codex_implement / native tool/role path
  - Do NOT call wf-ui-control.mjs create-agent for workers
  - Do NOT create WF canvas Agent nodes
  - Record: fanoutAttempted=true, channel=<native|codex-tool>, roles=[...], evidence
  - If native subagents unavailable: record clear degradation, ask user

IF subagentMode == 'wf-node-subagents':
  - Use wf-ui-control.mjs create-agent to create/connect WF Agent nodes
  - Use sendMessage/broadcastMessage/readMessages for communication
  - Use Timer/Markdown/Goal nodes for coordination
  - All worker nodes visible on canvas
  - Record: fanoutAttempted=true, channel=wf-node, nodeIds=[...], evidence
```

## Decisions

| # | Decision | Reason |
|---|----------|--------|
| D1 | Rename `wf-subagents` → `wf-node-subagents`; new default `built-in-subagents` | User requirement: default must be built-in, wf-node name clarifies it creates canvas nodes |
| D2 | subagentMode flows into session, graph, snapshot, context, init prompt, and `HARNESS_SUBAGENT_MODE` env var | User requirement: "不能只是一个没用字段" |
| D3 | NL trigger detection in init.md/CLAUDE.md — agent decides, not backend middleware | Keeps routing logic in agent's context where it can be updated without backend changes |
| D4 | Backward compat: accept `wf-subagents` as alias → `wf-node-subagents` | Safe migration for existing sessions |
| D5 | Tests use typed wf-ui-control.mjs commands, not internal APIs | User requirement: "不能把writeWorkflowGraphMap/capsuleDockLinks算作公共API完整闭环" |
| D6 | Extends task-agent-team-cooperation-layer; dependsOn=[] (code merged) | No gate wait |

## Write Sets (Disjoint)

### W1: Backend — defaults, snapshot, context, init prompt

Files:
- `src/wf-ui-server/session-registry.mjs` — default change + backward compat
- `src/wf-ui-server/server.mjs` — default change, init prompt injection, env var
- `src/wf-ui-server/a2a-store.mjs` — snapshot subagentModes catalog
- `src/wf-ui-server/workflow-agent-context.mjs` — context injection
- `src/wf-ui-server/pty-adapter.mjs` — HARNESS_SUBAGENT_MODE env var
- `src/wf-ui-server/__tests__/session-registry.test.mjs` — update defaults
- `src/wf-ui-server/__tests__/a2a-store.test.mjs` — update snapshot test

### W2: UI — settings, types, default

Files:
- `src/ui/src/types.ts` — SubagentMode type, subagentModes array
- `src/ui/src/components/WorkflowRoute.tsx` — default change, create payload
- `src/ui/src/components/workflow/AgentNodeSettings.tsx` — mode selector UI
- `src/ui/src/components/workflow/WorkflowNodeSettingsPanel.tsx` — may need update

### W3: CLI — wf-ui-control.mjs

Files:
- `Harness/scripts/wf-ui-control.mjs` — subagent-mode flag on create-agent, context output

### W4: Docs/Templates — CLAUDE.md, prompts, manuals, mirrors

Files:
- `CLAUDE.md` — update Agent Team Cooperation section
- `.claude/rules/ecc/common.md` — update subagent section
- `Harness/a2a/skills/workflow-agent-node.json` — add subagentMode to manual
- `templates/common/CLAUDE.md` — mirror
- `templates/common/.claude/rules/ecc/common.md` — mirror
- `templates/common/Harness/a2a/skills/workflow-agent-node.json` — mirror

### W5: Tests — acceptance matrix

Files:
- `src/wf-ui-server/__tests__/workflow-subagent-strategy-matrix.test.mjs` — NEW, 2x2 matrix tests
- `src/wf-ui-server/__tests__/control-plane-acceptance.test.mjs` — update for rename
- `src/wf-ui-server/__tests__/control-plane-cli-smoke.test.mjs` — update for rename
- `src/ui/e2e/wf-ui-m8-subagent-settings.spec.ts` — NEW, UI settings test

## Fan-Out Plan

Wave order:
1. **W1 Backend** (1 implementer) — all backend files in one write set
2. **W2 UI + W3 CLI + W4 Docs** (3 implementers, parallel, disjoint write sets)
3. **W5 Tests** (1-2 test writers, depends on W1+W2+W3+W4)
4. **W2R Review** (review-manager → 3 reviewers)
5. **Verifier + Reflector**

## Verification

- Backend: `node --test src/wf-ui-server/__tests__/workflow-subagent-strategy-matrix.test.mjs`
- Regression: `node --test src/wf-ui-server/__tests__/control-plane-acceptance.test.mjs`
- CLI smoke: `node --test src/wf-ui-server/__tests__/control-plane-cli-smoke.test.mjs`
- UI typecheck: `pnpm --dir src/ui exec tsc --noEmit`
- UI build: `pnpm --dir src/ui run build`
- Anti-drift: `node Harness/scripts/validate-harness.mjs`
- E2E: `npx playwright test src/ui/e2e/wf-ui-m8-subagent-settings.spec.ts`
- Template mirrors: byte-identical check
