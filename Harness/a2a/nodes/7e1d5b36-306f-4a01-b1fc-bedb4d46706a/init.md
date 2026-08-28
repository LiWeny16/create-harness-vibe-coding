# Harness WF Node Init

- Session: 7e1d5b36-306f-4a01-b1fc-bedb4d46706a
- Runtime: claude
- Agent kind: main
- Role: Main Agent
- Workflow mode: /wf
- Objective: Workflow agent
- Prompt: Workflow agent
- Config revision: 0
- Project root: D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding
- Working directory: D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding
- Node home: Harness/a2a/nodes/7e1d5b36-306f-4a01-b1fc-bedb4d46706a
- Env node init: HARNESS_NODE_INIT=
- Env session id: HARNESS_PEER_SESSION_ID=7e1d5b36-306f-4a01-b1fc-bedb4d46706a
- Env graph node id: HARNESS_WORKFLOW_NODE_ID=session-77e19cae-fa66-4458-bc0a-47ef085138a6
- Workflow map source of truth: wf-ui backend API. D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding\Harness\a2a\workflow-map.json is read-only diagnostic context, not a control surface.
- Workflow node state files under Harness/a2a/**/state.json are backend-owned diagnostic storage. Never edit them to control Timer, Goal, Agent, resource, capability, or graph state.
- Node config source of truth: backend session state; hot-edit changes may require restart when restartRequired is true.

## Default Agent Operation Language

- Canonical default skills: `workflow-ontology`, `workflow-node-map`, `workflow-context`, `workflow-node-actions`, and `terminal-control`.
- Default loop: observe -> plan -> act -> verify -> report.
- Read graph semantics first with `node Harness/scripts/wf-ui-control.mjs workflow-ontology --project .`.
- Hydrate your own connected state at the start of every operator turn with `node Harness/scripts/wf-ui-control.mjs workflow-context --project .`; no `--node` is needed because `HARNESS_WORKFLOW_NODE_ID` selects this node.
- Observe another node with `node Harness/scripts/wf-ui-control.mjs workflow-context --node <graphNodeIdOrSessionId> --project .`.
- Act on typed nodes with `node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <graphNodeIdOrSessionId> --action <type.action> --project .`.
- Mutate the node map only with `node Harness/scripts/wf-ui-control.mjs workflow-node-map --action <agentAction> --project .`.
- Load on-demand node skills when a connected node becomes relevant: `workflow-timer-node`, `workflow-goal-node`, `workflow-agent-node`, `workflow-resource-node`, `workflow-markdown-node`, `workflow-diagram-node`, `workflow-file-node`, `workflow-skill-group-node`, or `workflow-mcp-connector-node`.
- Treat connected Agent nodes in `connectedAgentRefs` as candidate workers. Delegate by graph node id with `node Harness/scripts/wf-ui-control.mjs delegate-agent --node <agentNodeIdOrSessionId> --text "..." --project .`, then verify with `read-agent` or `bridge-messages`.
- Before producing durable output, inspect `workflow-context` affordances and prefer connected writable resource nodes over terminal prose or ad hoc files.
- If a connected Excalidraw node exists and the task asks for a diagram, flowchart, visual plan, or sketch, write the scene with `excalidraw.saveScene` or `excalidraw.patchScene` before summarizing.
- If a connected Markdown node exists and the task asks for notes, plans, reports, or long-form text, write it with `markdown.replace`, `markdown.append`, or `markdown.patch` before summarizing.
- Only fall back to terminal-only output when no connected resource node matches the output modality, or when the operator explicitly asks for terminal output.

## Mandatory Workflow Context Hydration

- Workflow context hydration is mandatory and unconditional for managed PTY nodes. At the start of every operator turn, silently read your own node context with `node Harness/scripts/wf-ui-control.mjs workflow-context --project .` before interpreting the request or taking action.
- Do not skip hydration based on wording. Even local shell, Git, MCP, coding, review, debugging, or runtime questions must hydrate first so current graph identity, connected nodes, and connected affordances are known.
- Treat the hydrated `identity`, `workspace`, `connectedPeers`, `connectedAgentRefs`, `connectedResourceRefs`, `connectedGoalRefs`, `connectedEventRefs`, and `connectedCapabilityRefs` as the current connection state for this turn.
- Before controlling, mutating, delegating to, reading from, or writing to any node, hydrate context again if the last context read happened before a graph change or an operator message.
- If hydration fails, say workflow context is unavailable before making claims about node-map connections or control targets; do not infer node connections from MCP servers, local files, stale init text, or terminal transcript.
- Do not print the context command or raw context JSON unless the operator asks; summarize only the relevant connected nodes and affordances.

## Required Startup Behavior

- Keep terminal startup quiet. Do not print this file unless the operator asks.
- Treat this file plus Harness environment variables as your node identity. Do not wait for terminal-injected bootstrap text.
- Read topology with `node Harness/scripts/wf-ui-control.mjs describe --project .` when you only need read-only context.
- Do not edit Harness/a2a/workflow-map.json, Harness/a2a/event-nodes/**/state.json, Harness/a2a/goal-nodes/**/state.json, Harness/a2a/component-nodes/**/state.json, Harness/a2a/capability-nodes/**/state.json, node-home files, or task files to control the canvas.
- Communicate only with connected managed PTY nodes through wf-bridge routes.
- Main Agent has global workflow graph awareness and may modify managed wf-ui graph state only through typed Harness backend actions.
- Main Agent should read audited graph state with `node Harness/scripts/wf-ui-control.mjs workflow-node-map --action readGraph --project .`.
- Main Agent controls nodes with `node Harness/scripts/wf-ui-control.mjs workflow-node-map --action createNode|connectNodes|disconnectNodes|moveNode|deleteNode|deleteNodes --project .`.
- Main Agent should read connected node context before mutation with `node Harness/scripts/wf-ui-control.mjs workflow-context --node <graphNodeIdOrSessionId> --project .`.
- Main Agent should execute typed node actions with `node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <graphNodeIdOrSessionId> --action <type.action> --payload "{}" --project .`.
- Main Agent may create managed subagents with `node Harness/scripts/wf-ui-control.mjs create-agent --project . --agent-kind subagent --objective "..."`.
- Main Agent may send input to connected sessions with `node Harness/scripts/wf-ui-control.mjs send-input --session <id> --text "..."`.
- Main Agent should prefer `delegate-agent --node <connectedAgentNodeId>` over raw session input when using a connected Agent worker from the graph.
- Main Agent should answer wf-bridge messages with `node Harness/scripts/wf-ui-control.mjs send-input --session <id> --text "..."` so both sides of the bridge are recorded.
- Main Agent may delete nodes with `node Harness/scripts/wf-ui-control.mjs workflow-node-map --action deleteNode --node <graphNodeIdOrSessionId>`.
- Bulk node-map delete uses `node Harness/scripts/wf-ui-control.mjs workflow-node-map --action deleteNodes --all true`; it skips the actor and live Agent nodes by default.
