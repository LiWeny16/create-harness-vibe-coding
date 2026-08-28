# Harness WF Node Init

## Identity
- You are: Main Agent (Main Agent); Agent kind: main
- Session: 29a050ad-7183-4282-8897-19c1f97fb3a6 | Runtime: codex | Graph node: session-29a050ad-7183-4282-8897-19c1f97fb3a6
- Subagent mode: built-in-subagents | Workflow mode: /wf
- Node home: Harness/a2a/nodes/29a050ad-7183-4282-8897-19c1f97fb3a6 | This file: Harness/a2a/nodes/29a050ad-7183-4282-8897-19c1f97fb3a6/init.md
- Objective: Resume recheck codex
- Env subagent mode: HARNESS_SUBAGENT_MODE=built-in-subagents | Env: HARNESS_NODE_INIT= | HARNESS_PEER_SESSION_ID=29a050ad-7183-4282-8897-19c1f97fb3a6 | HARNESS_WORKFLOW_NODE_ID=session-29a050ad-7183-4282-8897-19c1f97fb3a6

## Working Method — discovery first
You control the workflow canvas ONLY through typed interfaces. Never edit Harness/a2a/**/state.json or workflow-map.json directly.

Discover in this order before acting:
1. Commands:   node Harness/scripts/wf-ui-control.mjs help --json
2. Context:    node Harness/scripts/wf-ui-control.mjs workflow-context --project .   ← hydrate EVERY turn, mandatory
3. Manual:     node Harness/scripts/wf-ui-control.mjs manuals <nodeType>   ← before creating/connecting a node type
4. Canvas:     node Harness/scripts/wf-ui-control.mjs snapshot --project .
5. Vocabulary: node Harness/scripts/wf-ui-control.mjs workflow-ontology --project .

## Invariant Rules
- The Timer is the only wakeup source; the Goal node never wakes agents.

## Subagent Strategy

- subagentMode: <built-in-subagents|wf-node-subagents>

- When subagentMode is `built-in-subagents`:
- Use the Codex native subagent/tool/role path (codex_implement, codex exec, or native agent mechanism); do NOT create WF canvas Agent nodes; record fanoutAttempted, channel, roles evidence. If Codex native subagents are unavailable, record clear degradation evidence (runtime version, capability check result, error message) and inform the user; do not silently skip or pretend native subagents were used.

- Natural language: "内部助手", "内置子代理", "不要开画布节点", "native subagent", "built-in" → built-in-subagents
- "画布Agent节点", "开Claude Code节点", "WF node协作", "可视化协作", "canvas worker" → wf-node-subagents
- Default when unspecified: built-in-subagents

