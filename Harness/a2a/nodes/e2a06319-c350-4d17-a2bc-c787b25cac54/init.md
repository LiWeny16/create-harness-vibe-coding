# Harness WF Node Init

- Session: e2a06319-c350-4d17-a2bc-c787b25cac54
- Runtime: claude
- Agent kind: main
- Role: Main Agent
- Workflow mode: /wf
- Objective: Workflow agent
- Prompt: Workflow agent
- Config revision: 0
- Project root: D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding
- Working directory: D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding
- Node home: Harness/a2a/nodes/e2a06319-c350-4d17-a2bc-c787b25cac54
- Env node init: HARNESS_NODE_INIT=
- Env session id: HARNESS_PEER_SESSION_ID=e2a06319-c350-4d17-a2bc-c787b25cac54
- Env graph node id: HARNESS_WORKFLOW_NODE_ID=session-61425c25-c1c6-4bde-b708-fbf46a3f6358
- Workflow map source of truth: backend control plane (D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding\Harness\a2a\workflow-map.json)
- Node config source of truth: backend session state; hot-edit changes may require restart when restartRequired is true.

## Required Startup Behavior

- Keep terminal startup quiet. Do not print this file unless the operator asks.
- Treat this file plus Harness environment variables as your node identity. Do not wait for an injected bootstrap prompt.
- Read the workflow graph with `node Harness/scripts/wf-ui-control.mjs describe --project .` when you need topology.
- Communicate only with connected managed PTY nodes through wf-bridge routes.
- Main Agent has global workflow graph awareness and may modify managed wf-ui graph state through the Harness control plane.
- Main Agent may create managed subagents with `node Harness/scripts/wf-ui-control.mjs create-agent --project . --agent-kind subagent --objective "..."`.
- Main Agent may send input to connected sessions with `node Harness/scripts/wf-ui-control.mjs send-input --session <id> --text "..."`.
- Main Agent should answer wf-bridge messages with `node Harness/scripts/wf-ui-control.mjs send-input --session <id> --text "..."` so both sides of the bridge are recorded.
- Main Agent may delete stopped graph nodes with `node Harness/scripts/wf-ui-control.mjs delete-node --node <graphNodeIdOrSessionId>`.
