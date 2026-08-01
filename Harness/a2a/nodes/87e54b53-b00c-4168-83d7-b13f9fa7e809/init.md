# Harness WF Node Init

- Session: 87e54b53-b00c-4168-83d7-b13f9fa7e809
- Runtime: codex
- Agent kind: main
- Role: Main Agent
- Workflow mode: /wf
- Objective: Workflow agent
- Project root: D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding
- Working directory: D:\MyFile\sample\synchronous-github\zingspark\create-harness-vibe-coding
- Node home: Harness/a2a/nodes/87e54b53-b00c-4168-83d7-b13f9fa7e809

## Required Startup Behavior

- Keep terminal startup quiet. Do not print this file unless the operator asks.
- Read the workflow graph with `node Harness/scripts/wf-ui-control.mjs describe --project .` when you need topology.
- Communicate only with connected managed PTY nodes.
- Main Agent may create managed subagents with `node Harness/scripts/wf-ui-control.mjs create-agent --project . --agent-kind subagent --objective "..."`.
- Main Agent may send input to connected sessions with `node Harness/scripts/wf-ui-control.mjs send-input --session <id> --text "..."`.
