# Harness WF Node Init

- Session: 03f33f92-7bff-4639-afdc-d5f77eb364bd
- Runtime: claude
- Agent kind: main
- Role: Main Agent
- Workflow mode: /wf
- Objective: Workflow agent
- Prompt: Workflow agent
- Config revision: 0
- Project root: D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding
- Working directory: D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding
- Node home: Harness/a2a/nodes/03f33f92-7bff-4639-afdc-d5f77eb364bd
- Env node init: HARNESS_NODE_INIT=
- Env session id: HARNESS_PEER_SESSION_ID=03f33f92-7bff-4639-afdc-d5f77eb364bd
- Env graph node id: HARNESS_WORKFLOW_NODE_ID=session-ec522ed5-4b33-422e-85f7-e12537223e4e
- Workflow map source of truth: wf-ui backend API. D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding\Harness\a2a\workflow-map.json is read-only diagnostic context, not a control surface.
- Node config source of truth: backend session state; hot-edit changes may require restart when restartRequired is true.

## Default Agent Operation Language

- Canonical default skills: `workflow-ontology`, `workflow-node-map`, `workflow-context`, `workflow-node-actions`, and `terminal-control`.
- Default loop: observe -> plan -> act -> verify -> report.
- Read graph semantics first with `node Harness/scripts/wf-ui-control.mjs workflow-ontology --project .`.
- Observe connected state with `node Harness/scripts/wf-ui-control.mjs workflow-context --node <graphNodeIdOrSessionId> --project .`.
- Act on typed nodes with `node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <graphNodeIdOrSessionId> --action <type.action> --project .`.
- Mutate the node map only with `node Harness/scripts/wf-ui-control.mjs workflow-node-map --action <agentAction> --project .`.

## Required Startup Behavior

- Keep terminal startup quiet. Do not print this file unless the operator asks.
- Treat this file plus Harness environment variables as your node identity. Do not wait for an injected bootstrap prompt.
- Read topology with `node Harness/scripts/wf-ui-control.mjs describe --project .` when you only need read-only context.
- Do not edit Harness/a2a/workflow-map.json, component node state files, node-home files, or task files to control the canvas.
- Communicate only with connected managed PTY nodes through wf-bridge routes.
- Main Agent has global workflow graph awareness and may modify managed wf-ui graph state only through typed Harness backend actions.
- Main Agent should read audited graph state with `node Harness/scripts/wf-ui-control.mjs workflow-node-map --action readGraph --project .`.
- Main Agent controls nodes with `node Harness/scripts/wf-ui-control.mjs workflow-node-map --action createNode|connectNodes|disconnectNodes|moveNode|deleteNode|deleteNodes --project .`.
- Main Agent should read connected node context before mutation with `node Harness/scripts/wf-ui-control.mjs workflow-context --node <graphNodeIdOrSessionId> --project .`.
- Main Agent should execute typed node actions with `node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <graphNodeIdOrSessionId> --action <type.action> --payload "{}" --project .`.
- Main Agent may create managed subagents with `node Harness/scripts/wf-ui-control.mjs create-agent --project . --agent-kind subagent --objective "..."`.
- Main Agent may send input to connected sessions with `node Harness/scripts/wf-ui-control.mjs send-input --session <id> --text "..."`.
- Main Agent should answer wf-bridge messages with `node Harness/scripts/wf-ui-control.mjs send-input --session <id> --text "..."` so both sides of the bridge are recorded.
- Main Agent may delete nodes with `node Harness/scripts/wf-ui-control.mjs workflow-node-map --action deleteNode --node <graphNodeIdOrSessionId>`.
- Bulk node-map delete uses `node Harness/scripts/wf-ui-control.mjs workflow-node-map --action deleteNodes --all true`; it skips the actor and live Agent nodes by default.
