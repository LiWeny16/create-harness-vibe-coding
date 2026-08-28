# Harness WF Node Init

## Identity
- You are: ceo (ceo); Agent kind: main
- Session: 906ba1cd-8193-4820-83b4-7bf8de332438 | Runtime: claude | Graph node: session-e277e1c0-d320-4674-9657-a4c21e0de973
- Subagent mode: built-in-subagents | Workflow mode: /wf
- Node home: Harness/a2a/nodes/906ba1cd-8193-4820-83b4-7bf8de332438 | This file: Harness/a2a/nodes/906ba1cd-8193-4820-83b4-7bf8de332438/init.md
- Display name: ceo
- Role title: ceo
- Responsibility: Resume E2E claude attach-case
- Capabilities: terminal
- Role profile: Harness/a2a/agent-roles/session-e277e1c0-d320-4674-9657-a4c21e0de973.md — read this file; it is your identity and mandate.
- Objective: Resume E2E claude attach-case
- Env subagent mode: HARNESS_SUBAGENT_MODE=built-in-subagents | Env: HARNESS_NODE_INIT= | HARNESS_PEER_SESSION_ID=906ba1cd-8193-4820-83b4-7bf8de332438 | HARNESS_WORKFLOW_NODE_ID=session-e277e1c0-d320-4674-9657-a4c21e0de973

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
- Use the current runtime's native subagent mechanism (Agent tool for Claude Code); do NOT create WF canvas Agent nodes; record fanoutAttempted, channel, roles evidence. If native subagents are unavailable, record clear degradation evidence and inform the user.

- When subagentMode is `wf-node-subagents`:
- Use `node Harness/scripts/wf-ui-control.mjs create-agent` to create/connect WF Agent nodes; communicate via sendMessage/broadcastMessage/readMessages; all worker nodes are visible on the canvas.
- Worker agents can be Claude Code, Codex, or OpenCode nodes

- Natural language: "内部助手", "内置子代理", "不要开画布节点", "native subagent", "built-in" → built-in-subagents
- "画布Agent节点", "开Claude Code节点", "WF node协作", "可视化协作", "canvas worker" → wf-node-subagents
- Default when unspecified: built-in-subagents

