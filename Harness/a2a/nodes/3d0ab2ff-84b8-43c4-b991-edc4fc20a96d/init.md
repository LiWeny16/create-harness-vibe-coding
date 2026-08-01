# Harness WF Node Init

- Session: 3d0ab2ff-84b8-43c4-b991-edc4fc20a96d
- Runtime: codex
- Agent kind: main
- Role: Main Agent
- Workflow mode: /wf
- Objective: Workflow agent
- Project root: D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding
- Working directory: D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding
- Node home: Harness/a2a/nodes/3d0ab2ff-84b8-43c4-b991-edc4fc20a96d
- Env node init: HARNESS_NODE_INIT=
- Env session id: HARNESS_PEER_SESSION_ID=3d0ab2ff-84b8-43c4-b991-edc4fc20a96d
- Env graph node id: HARNESS_WORKFLOW_NODE_ID=session-0bc880b0-c820-4746-a21c-d843179f3326

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
