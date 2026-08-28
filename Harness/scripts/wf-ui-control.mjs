#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const args = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      args.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
    flags[key] = value;
  }
  return { command, flags, args };
}

function print(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

// ── Unified machine-readable command registry ───────────────────────────────
// Single source of truth for both plain-text `--help` and `help --json`.
// One entry per command; aliases resolve to their canonical entry. Each flag
// may carry an optional `value` placeholder used only when rendering
// plain-text help. `help --json` builds its list from BOTH the registry and
// the dispatch map, so a command added to COMMAND_DISPATCH without a registry
// entry shows up as `{ name, summary: '(undocumented)' }` instead of silently
// missing from the machine-readable surface.
const COMMAND_REGISTRY = [
  {
    name: 'help',
    aliases: [],
    summary: 'Show help for a command, or dump the machine-readable command registry with --json.',
    example: 'wf-ui-control.mjs help send-input --json',
    flags: [
      { flag: 'json', description: 'print the full registry (or one command entry) as JSON' },
      { flag: 'cmd', value: '<command>', description: 'command to show help for (or pass it positionally)' },
      { flag: 'command', value: '<command>', description: 'command to show help for (or pass it positionally)' },
    ],
  },
  {
    name: 'self',
    aliases: [],
    summary: 'Print the acting agent identity read from the Harness environment.',
    example: 'wf-ui-control.mjs self',
    flags: [],
  },
  {
    name: 'snapshot',
    aliases: [],
    summary: 'Read the full workflow snapshot (graph + sessions) from the backend, or from local files when no backend URL is set.',
    example: 'wf-ui-control.mjs snapshot --url <url>',
    flags: [
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'read-token', value: '<token>', description: 'read-only auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'describe',
    aliases: [],
    summary: 'Render a human-oriented summary of the workflow snapshot (self, counts, nodes, connected edges).',
    example: 'wf-ui-control.mjs describe',
    flags: [
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'read-token', value: '<token>', description: 'read-only auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'create-agent',
    aliases: [],
    summary: 'Create a workflow agent node (PTY session) through the wf-ui backend.',
    example: 'wf-ui-control.mjs create-agent --role implementer --initial-prompt "Implement X"',
    flags: [
      { flag: 'agent-kind', value: '<main|subagent>', description: 'agent kind (default: subagent)' },
      { flag: 'runtime', value: '<runtime>', description: 'peer runtime (default: claude)' },
      { flag: 'role', value: '<roleTitle>', description: 'agent role title' },
      { flag: 'objective', value: '<text>', description: 'agent objective' },
      { flag: 'initial-prompt', value: '<text>', description: 'Start the agent with this task as its first prompt (auto-submitted by the runtime TUI, no keystroke injection needed)' },
      { flag: 'mode', value: '<workflowMode>', description: 'workflow mode (default: wf)' },
      { flag: 'subagent-mode', value: '<built-in-subagents|wf-node-subagents>', description: 'subagent mode (default: built-in-subagents; legacy alias: wf-subagents)' },
      { flag: 'model', value: '<model>', description: 'model id' },
      { flag: 'provider', value: '<provider>', description: 'model provider' },
      { flag: 'cwd', value: '<path>', description: 'working directory (default: project root)' },
      { flag: 'parent', value: '<sessionId>', description: 'parent agent session id' },
      { flag: 'parent-node', value: '<nodeId>', description: 'parent workflow node id' },
      { flag: 'defer-pty-spawn', value: '<true|false>', description: 'defer PTY spawn' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'actor-kind', value: '<kind>', description: 'actor agent kind (create-agent requires main)' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'find-agent',
    aliases: [],
    summary: 'Find an existing agent node by role, runtime, provider, capability, or title.',
    example: 'wf-ui-control.mjs find-agent --role implementer --connect true',
    flags: [
      { flag: 'role', value: '<role>', description: 'role title to match' },
      { flag: 'runtime', value: '<runtime>', description: 'peer runtime to match' },
      { flag: 'provider', value: '<provider>', description: 'model provider to match' },
      { flag: 'capability', value: '<capability>', description: 'capability to match' },
      { flag: 'title', value: '<title>', description: 'node title to match' },
      { flag: 'from', value: '<nodeId>', description: 'query from this node (default: HARNESS_WORKFLOW_NODE_ID)' },
      { flag: 'connect', description: 'auto-connect the found agent to the actor (alias: --auto-connect)' },
      { flag: 'auto-connect', description: 'auto-connect the found agent to the actor' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'read-token', value: '<token>', description: 'read-only auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'agent-role-profile',
    aliases: [],
    summary: 'Read the role profile (json + markdown) of an agent node.',
    example: 'wf-ui-control.mjs agent-role-profile --node <agentNodeId>',
    flags: [
      { flag: 'node', value: '<agentNodeId>', description: 'agent node id (default: HARNESS_WORKFLOW_NODE_ID)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'read-token', value: '<token>', description: 'read-only auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'send-input',
    aliases: [],
    summary: 'Write terminal input to a managed session PTY (appends submit enter unless --raw or the text ends with a newline).',
    example: 'wf-ui-control.mjs send-input --session <sessionId> --text "/model"',
    flags: [
      { flag: 'session', value: '<sessionId>', description: 'target session id' },
      { flag: 'text', value: '<text>', description: 'input text (appends \\r unless --raw or already newline-terminated)' },
      { flag: 'raw', description: 'send the text exactly as given, without appending enter' },
      { flag: 'from', value: '<sessionId>', description: 'actor session id (alias: --from-session; default: HARNESS_PEER_SESSION_ID)' },
      { flag: 'from-session', value: '<sessionId>', description: 'actor session id' },
      { flag: 'from-node', value: '<nodeId>', description: 'actor workflow node id (default: HARNESS_WORKFLOW_NODE_ID)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'actor-kind', value: '<kind>', description: 'actor agent kind (send-input requires main)' },
    ],
  },
  {
    name: 'send-key',
    aliases: ['key'],
    summary: 'Send a single named keystroke as raw bytes to a managed session PTY — e.g. "send-key down" to navigate TUI pickers such as the codex /model picker after typing /model.',
    example: 'wf-ui-control.mjs send-key down --session <sessionId> --url <url>',
    flags: [
      { flag: 'key', value: '<up|down|left|right|enter|esc|tab|backspace>', description: 'key to send (or pass positionally: send-key up)' },
      { flag: 'session', value: '<sessionId>', description: 'target session id' },
      { flag: 'node', value: '<graphNodeIdOrSessionId>', description: 'resolve the target session from the workflow graph map (used when --session is omitted)' },
      { flag: 'from', value: '<sessionId>', description: 'actor session id (alias: --from-session; default: HARNESS_PEER_SESSION_ID)' },
      { flag: 'from-session', value: '<sessionId>', description: 'actor session id' },
      { flag: 'from-node', value: '<nodeId>', description: 'actor workflow node id (default: HARNESS_WORKFLOW_NODE_ID)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'actor-kind', value: '<kind>', description: 'actor agent kind (send-key requires main)' },
    ],
  },
  {
    name: 'delegate-agent',
    aliases: [],
    summary: 'Send terminal input to another agent node through the typed agent.sendInput action.',
    example: 'wf-ui-control.mjs delegate-agent --node <targetNodeId> --text "Report status"',
    flags: [
      { flag: 'node', value: '<graphNodeIdOrSessionId>', description: 'target agent node' },
      { flag: 'text', value: '<text>', description: 'input text (appends \\r unless --raw or already newline-terminated; alias: --input)' },
      { flag: 'raw', description: 'send the text exactly as given, without submit enter' },
      { flag: 'actor', value: '<nodeId>', description: 'actor node id (alias: --actor-node)' },
      { flag: 'actor-node', value: '<nodeId>', description: 'actor node id' },
      { flag: 'actor-session', value: '<sessionId>', description: 'actor session id' },
      { flag: 'actor-kind', value: '<kind>', description: 'actor agent kind' },
      { flag: 'from', value: '<sessionId>', description: 'actor session id (alias: --from-session)' },
      { flag: 'from-session', value: '<sessionId>', description: 'actor session id' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'send-agent-message',
    aliases: ['message-agent'],
    summary: 'Send a structured 1-to-1 message to another agent node through agent.sendMessage.',
    example: 'wf-ui-control.mjs send-agent-message --node <senderNodeId> --to <targetNodeId> --text "Hello" --request-id req-1',
    flags: [
      { flag: 'node', value: '<senderNodeId>', description: 'sender agent node id (default: HARNESS_WORKFLOW_NODE_ID)' },
      { flag: 'to', value: '<agentNodeIdOrSessionId>', description: 'target agent' },
      { flag: 'text', value: '<text>', description: 'message text (aliases: --message, --input, --data)' },
      { flag: 'topic', value: '<topic>', description: 'message topic' },
      { flag: 'thread', value: '<threadId>', description: 'thread id (alias: --thread-id)' },
      { flag: 'thread-id', value: '<threadId>', description: 'thread id' },
      { flag: 'reply-to', value: '<messageId>', description: 'reply to a message id' },
      { flag: 'request-id', value: '<requestId>', description: 'correlation request id' },
      { flag: 'raw', description: 'mark the message as raw (no envelope processing)' },
      { flag: 'actor', value: '<nodeId>', description: 'actor node id (alias: --actor-node)' },
      { flag: 'actor-node', value: '<nodeId>', description: 'actor node id' },
      { flag: 'actor-session', value: '<sessionId>', description: 'actor session id' },
      { flag: 'actor-kind', value: '<kind>', description: 'actor agent kind' },
      { flag: 'from', value: '<sessionId>', description: 'actor session id (alias: --from-session)' },
      { flag: 'from-session', value: '<sessionId>', description: 'actor session id' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'broadcast-agent-message',
    aliases: ['broadcast-agent'],
    summary: 'Send one structured message to many agent nodes through agent.broadcastMessage.',
    example: 'wf-ui-control.mjs broadcast-agent-message --node <senderNodeId> --to a,b,c --text "All hands"',
    flags: [
      { flag: 'node', value: '<senderNodeId>', description: 'sender agent node id (default: HARNESS_WORKFLOW_NODE_ID)' },
      { flag: 'to', value: '<agentNodeIdOrSessionId,...>', description: 'targets (comma/newline/semicolon separated)' },
      { flag: 'text', value: '<text>', description: 'message text (aliases: --message, --input, --data)' },
      { flag: 'topic', value: '<topic>', description: 'message topic' },
      { flag: 'thread', value: '<threadId>', description: 'thread id (alias: --thread-id)' },
      { flag: 'thread-id', value: '<threadId>', description: 'thread id' },
      { flag: 'request-id', value: '<requestId>', description: 'correlation request id' },
      { flag: 'raw', description: 'mark the message as raw (no envelope processing)' },
      { flag: 'actor', value: '<nodeId>', description: 'actor node id (alias: --actor-node)' },
      { flag: 'actor-node', value: '<nodeId>', description: 'actor node id' },
      { flag: 'actor-session', value: '<sessionId>', description: 'actor session id' },
      { flag: 'actor-kind', value: '<kind>', description: 'actor agent kind' },
      { flag: 'from', value: '<sessionId>', description: 'actor session id (alias: --from-session)' },
      { flag: 'from-session', value: '<sessionId>', description: 'actor session id' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'read-agent-messages',
    aliases: ['agent-messages'],
    summary: 'Read the recorded conversation between two agents through agent.readMessages.',
    example: 'wf-ui-control.mjs read-agent-messages --node <senderNodeId> --peer <peerNodeId>',
    flags: [
      { flag: 'node', value: '<senderNodeId>', description: 'sender agent node id (default: HARNESS_WORKFLOW_NODE_ID)' },
      { flag: 'peer', value: '<agentNodeIdOrSessionId>', description: 'peer agent to read the conversation with' },
      { flag: 'tail', value: '<n>', description: 'last n entries' },
      { flag: 'limit', value: '<n>', description: 'max entries to return' },
      { flag: 'actor', value: '<nodeId>', description: 'actor node id (alias: --actor-node)' },
      { flag: 'actor-node', value: '<nodeId>', description: 'actor node id' },
      { flag: 'actor-session', value: '<sessionId>', description: 'actor session id' },
      { flag: 'actor-kind', value: '<kind>', description: 'actor agent kind' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'read-agent',
    aliases: [],
    summary: 'Read agent output, transcript, or context through agent.readOutput/readTranscript/readContext.',
    example: 'wf-ui-control.mjs read-agent --node <agentNodeId> --action transcript --tail 50',
    flags: [
      { flag: 'node', value: '<graphNodeIdOrSessionId>', description: 'target agent node' },
      { flag: 'action', value: '<output|transcript|context>', description: 'what to read (default: output)' },
      { flag: 'tail', value: '<n>', description: 'last n entries' },
      { flag: 'from-seq', value: '<n>', description: 'start sequence number' },
      { flag: 'to-seq', value: '<n>', description: 'end sequence number' },
      { flag: 'payload', value: '<json>', description: 'extra payload as a JSON object' },
      { flag: 'actor', value: '<nodeId>', description: 'actor node id (alias: --actor-node)' },
      { flag: 'actor-node', value: '<nodeId>', description: 'actor node id' },
      { flag: 'actor-session', value: '<sessionId>', description: 'actor session id' },
      { flag: 'actor-kind', value: '<kind>', description: 'actor agent kind' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'bridge-messages',
    aliases: [],
    summary: 'List recorded bridge messages between two sessions.',
    example: 'wf-ui-control.mjs bridge-messages --from <sessionId> --to <sessionId>',
    flags: [
      { flag: 'from', value: '<sessionId>', description: 'sender session id (alias: --from-session)' },
      { flag: 'from-session', value: '<sessionId>', description: 'sender session id' },
      { flag: 'to', value: '<sessionId>', description: 'recipient session id (alias: --to-session, --session)' },
      { flag: 'to-session', value: '<sessionId>', description: 'recipient session id' },
      { flag: 'session', value: '<sessionId>', description: 'recipient session id' },
      { flag: 'limit', value: '<n>', description: 'max entries (alias: --tail; default: 200)' },
      { flag: 'tail', value: '<n>', description: 'max entries' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'node-map',
    aliases: ['workflow-node-map'],
    summary: 'Run a typed workflow graph action (readGraph, createNode, connectNodes, disconnectNodes, updateEdge, moveNode, deleteNode, deleteNodes, attachDock, detachDock, setDockSide, layout, undo, redo) for the acting agent node.',
    example: 'wf-ui-control.mjs node-map --action readGraph --actor <graphNodeId>',
    flags: [
      { flag: 'action', value: '<readGraph|createNode|connectNodes|disconnectNodes|updateEdge|moveNode|deleteNode|deleteNodes|attachDock|detachDock|setDockSide|layout|undo|redo>', description: 'graph action to run (aliases: --command, --do)' },
      { flag: 'scope', value: '<graph>', description: 'undo/redo: scope selector (default: graph)' },
      { flag: 'actor', value: '<graphNodeIdOrSessionId>', description: 'actor node id (aliases: --actor-node, --actorNodeId)' },
      { flag: 'payload', value: '<json>', description: 'extra payload as a JSON object (aliases: --body, --json)' },
      { flag: 'type', value: '<nodeType>', description: 'createNode: node type' },
      { flag: 'title', value: '<title>', description: 'createNode: node title' },
      { flag: 'node', value: '<nodeId>', description: 'createNode/moveNode/deleteNode: target node id' },
      { flag: 'x', value: '<number>', description: 'createNode/moveNode: x position' },
      { flag: 'y', value: '<number>', description: 'createNode/moveNode: y position' },
      { flag: 'from', value: '<nodeOrSession>', description: 'connectNodes: source (default: actor)' },
      { flag: 'to', value: '<nodeOrSession>', description: 'connectNodes: target (aliases: --target, --session, --target-node)' },
      { flag: 'relation', value: '<relation>', description: 'connectNodes/updateEdge: edge relation (connectNodes default: delegation)' },
      { flag: 'source-handle', value: '<handle>', description: 'connectNodes/updateEdge: source handle' },
      { flag: 'target-handle', value: '<handle>', description: 'connectNodes/updateEdge: target handle' },
      { flag: 'direction', value: '<direction>', description: 'connectNodes/updateEdge: edge direction' },
      { flag: 'edge', value: '<edgeId>', description: 'disconnectNodes: edge id to remove; updateEdge: edge id to update (or pass --from/--to as the edge pair)' },
      { flag: 'anchor', value: '<nodeId>', description: 'attachDock/detachDock/setDockSide: anchor node id (aliases: --anchor-id, --anchorId)' },
      { flag: 'dragged', value: '<nodeId>', description: 'attachDock/detachDock/setDockSide: dragged node id (aliases: --dragged-id, --draggedId)' },
      { flag: 'side', value: '<left|right|top|bottom>', description: 'attachDock/setDockSide: dock side (default: right)' },
      { flag: 'dock-id', value: '<dockId>', description: 'detachDock: dock link id to remove (aliases: --dock, --dockId)' },
      { flag: 'nodes', value: '<nodeId,...>', description: 'deleteNodes: target node ids' },
      { flag: 'all', description: 'deleteNodes: delete all non-actor nodes' },
      { flag: 'force', description: 'deleteNodes/deleteNode: force deletion' },
      { flag: 'allow-live-agent-delete', description: 'deleteNodes/deleteNode: allow deleting live agent nodes' },
      { flag: 'layout-mode', value: '<grid|tree>', description: 'layout: layout mode (default: tree; aliases: --mode)' },
      { flag: 'mode', value: '<grid|tree>', description: 'layout: alias for --layout-mode' },
      { flag: 'origin-x', value: '<number>', description: 'layout: origin x (default: 260)' },
      { flag: 'origin-y', value: '<number>', description: 'layout: origin y (default: 220)' },
      { flag: 'gap-x', value: '<number>', description: 'layout: horizontal gap (default: 420)' },
      { flag: 'gap-y', value: '<number>', description: 'layout: vertical gap (default: 140)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'workflow-ontology',
    aliases: [],
    summary: 'Read the workflow ontology (node types, actions, affordances) from the backend.',
    example: 'wf-ui-control.mjs workflow-ontology --url <url>',
    flags: [
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'read-token', value: '<token>', description: 'read-only auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'workflow-context',
    aliases: [],
    summary: 'Read the workflow context of a node: identity, connected peers, node manuals, available actions.',
    example: 'wf-ui-control.mjs workflow-context --node <graphNodeId>',
    flags: [
      { flag: 'node', value: '<graphNodeIdOrSessionId>', description: 'target node (default: HARNESS_WORKFLOW_NODE_ID)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'read-token', value: '<token>', description: 'read-only auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'read-node',
    aliases: ['readnode', 'read-snapshot'],
    summary: 'Read a single workflow node by id.',
    example: 'wf-ui-control.mjs read-node --node <graphNodeId>',
    flags: [
      { flag: 'node', value: '<graphNodeIdOrSessionId>', description: 'target node (default: HARNESS_WORKFLOW_NODE_ID)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'read-token', value: '<token>', description: 'read-only auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'workflow-node-action',
    aliases: ['workflow-node-actions'],
    summary: 'Run a typed node action (markdown.*, goal.*, agent.*, timer.*, ...) on any workflow node.',
    example: 'wf-ui-control.mjs workflow-node-action --node <nodeId> --action markdown.read',
    flags: [
      { flag: 'node', value: '<graphNodeIdOrSessionId>', description: 'target node' },
      { flag: 'action', value: '<type.action>', description: 'action to run (aliases: --command, --do)' },
      { flag: 'payload', value: '<json>', description: 'action payload as a JSON object (aliases: --body, --json)' },
      { flag: 'actor', value: '<nodeId>', description: 'actor node id (alias: --actor-node)' },
      { flag: 'actor-node', value: '<nodeId>', description: 'actor node id' },
      { flag: 'actor-session', value: '<sessionId>', description: 'actor session id' },
      { flag: 'actor-kind', value: '<kind>', description: 'actor agent kind' },
      { flag: 'resume', value: '<true|false>', description: 'agent.start/agent.restart: resume the previous agent session (default: restart=true; start=true when a previous session exists on the node)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'delete-node',
    aliases: [],
    summary: 'Delete a single workflow node through agent.deleteNode.',
    example: 'wf-ui-control.mjs delete-node --node <graphNodeIdOrSessionId> --actor <actorNodeId>',
    flags: [
      { flag: 'node', value: '<graphNodeIdOrSessionId>', description: 'node to delete' },
      { flag: 'actor', value: '<graphNodeIdOrSessionId>', description: 'actor node id' },
      { flag: 'force', description: 'force deletion' },
      { flag: 'allow-live-agent-delete', description: 'allow deleting live agent nodes' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'connect',
    aliases: [],
    summary: 'Connect two workflow nodes with a typed edge through agent.connectNodes.',
    example: 'wf-ui-control.mjs connect --actor <actorNodeId> --from <nodeId> --to <nodeId>',
    flags: [
      { flag: 'actor', value: '<graphNodeIdOrSessionId>', description: 'actor node id' },
      { flag: 'from', value: '<nodeOrSession>', description: 'source node (default: actor)' },
      { flag: 'to', value: '<nodeOrSession>', description: 'target node (aliases: --target, --session, --target-node)' },
      { flag: 'relation', value: '<relation>', description: 'edge relation (default: delegation)' },
      { flag: 'source-handle', value: '<handle>', description: 'source handle' },
      { flag: 'target-handle', value: '<handle>', description: 'target handle' },
      { flag: 'direction', value: '<direction>', description: 'edge direction' },
      { flag: 'payload', value: '<json>', description: 'extra payload as a JSON object' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'tail',
    aliases: [],
    summary: 'Tail the terminal transcript of a local session from terminal.jsonl.',
    example: 'wf-ui-control.mjs tail --session <sessionId> --lines 100',
    flags: [
      { flag: 'session', value: '<sessionId>', description: 'session id (default: HARNESS_PEER_SESSION_ID)' },
      { flag: 'lines', value: '<n>', description: 'lines to tail (default: 80, alias: --tail)' },
      { flag: 'tail', value: '<n>', description: 'lines to tail' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'manuals',
    aliases: ['manual'],
    summary: 'Print the workflow node manual for a node type (prose sections plus generated command lines from the shared action registry), or list available manual types with --list.',
    example: 'wf-ui-control.mjs manuals timer',
    flags: [
      { flag: 'list', description: 'list all available manual types (agent, markdown, excalidraw, file, timer, goal, skill-group, mcp-connector, github-trigger, diagram)' },
      { flag: 'type', value: '<nodeType>', description: 'node type to read the manual for (or pass it positionally: manuals timer)' },
      { flag: 'project', value: '<path>', description: 'project root (default: .)' },
    ],
  },
  {
    name: 'browser-runs',
    aliases: [],
    summary: 'List wf-browser runs.',
    example: 'wf-ui-control.mjs browser-runs --url <url>',
    flags: [
      { flag: 'limit', value: '<n>', description: 'max runs (default: 20)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-run',
    aliases: [],
    summary: 'Create a wf-browser run.',
    example: 'wf-ui-control.mjs browser-run --objective "Verify the UI"',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'mode', value: '<mode>', description: 'run mode (default: mixed)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-window',
    aliases: [],
    summary: 'Create a wf-browser window under a run.',
    example: 'wf-ui-control.mjs browser-window --run <runId>',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'window', value: '<windowId>', description: 'window id (alias: --windowId)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-windows',
    aliases: [],
    summary: 'List windows of a wf-browser run.',
    example: 'wf-ui-control.mjs browser-windows --run <runId>',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-lease',
    aliases: [],
    summary: 'Acquire a control lease for a wf-browser window.',
    example: 'wf-ui-control.mjs browser-lease --run <runId> --window <windowId>',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'window', value: '<windowId>', description: 'window id (alias: --windowId)' },
      { flag: 'lease', value: '<leaseId>', description: 'lease id (alias: --leaseId)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-url',
    aliases: [],
    summary: 'Resolve the debug launch URL for a wf-browser window.',
    example: 'wf-ui-control.mjs browser-url --run <runId> --window <windowId> --open true',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'window', value: '<windowId>', description: 'window id (alias: --windowId)' },
      { flag: 'open', description: 'also open the URL in the local browser' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-allocate',
    aliases: [],
    summary: 'Allocate a wf-browser run/window/lease and optionally open the browser window.',
    example: 'wf-ui-control.mjs browser-allocate --open true --wait true',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId; created if omitted)' },
      { flag: 'window', value: '<windowId>', description: 'window id (alias: --windowId)' },
      { flag: 'open', description: 'open the browser window after allocation' },
      { flag: 'wait', description: 'wait until the window connects to the backend' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-allocate-many',
    aliases: [],
    summary: 'Allocate multiple wf-browser windows in one batch.',
    example: 'wf-ui-control.mjs browser-allocate-many --count 3 --open true',
    flags: [
      { flag: 'count', value: '<n>', description: 'number of windows (default: 1, max: 50)' },
      { flag: 'agents', value: '<agentId,...>', description: 'agent ids per window' },
      { flag: 'routes', value: '<route,...>', description: 'routes per window' },
      { flag: 'open', description: 'open the browser windows after allocation' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-open',
    aliases: [],
    summary: 'Open a browser window at the launch URL (default or isolated context).',
    example: 'wf-ui-control.mjs browser-open --run <runId> --window <windowId> --context isolated',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'window', value: '<windowId>', description: 'window id (alias: --windowId)' },
      { flag: 'context', value: '<default|isolated>', description: 'browser context (default: isolated)' },
      { flag: 'browser-command', value: '<path>', description: 'browser executable path (alias: --browser-path)' },
      { flag: 'dry-run', description: 'prepare without launching' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-launches',
    aliases: [],
    summary: 'List recorded browser launches for a wf-browser window.',
    example: 'wf-ui-control.mjs browser-launches --run <runId> --window <windowId>',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'window', value: '<windowId>', description: 'window id (alias: --windowId)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-close',
    aliases: [],
    summary: 'Close selected browser launches and optionally remove their profiles.',
    example: 'wf-ui-control.mjs browser-close --run <runId> --window <windowId> --force true',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'window', value: '<windowId>', description: 'window id (alias: --windowId)' },
      { flag: 'lease', value: '<leaseId>', description: 'lease id (alias: --leaseId)' },
      { flag: 'force', description: 'force-kill the browser process' },
      { flag: 'remove-profile', description: 'also remove the browser profile directory' },
      { flag: 'dry-run', description: 'report without killing' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-wait',
    aliases: [],
    summary: 'Wait until a wf-browser window connects to the backend.',
    example: 'wf-ui-control.mjs browser-wait --run <runId> --window <windowId> --timeout 20000',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'window', value: '<windowId>', description: 'window id (alias: --windowId)' },
      { flag: 'timeout', value: '<ms>', description: 'wait timeout (default: 10000)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-release',
    aliases: [],
    summary: 'Release a wf-browser window lease, optionally closing the browser.',
    example: 'wf-ui-control.mjs browser-release --run <runId> --window <windowId> --lease <leaseId> --close true',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'window', value: '<windowId>', description: 'window id (alias: --windowId)' },
      { flag: 'lease', value: '<leaseId>', description: 'lease id (alias: --leaseId)' },
      { flag: 'close', description: 'also close the browser window' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-artifacts',
    aliases: [],
    summary: 'List artifacts stored for a wf-browser window.',
    example: 'wf-ui-control.mjs browser-artifacts --run <runId> --window <windowId>',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'window', value: '<windowId>', description: 'window id (alias: --windowId)' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-connections',
    aliases: [],
    summary: 'List live wf-browser window connections.',
    example: 'wf-ui-control.mjs browser-connections --url <url>',
    flags: [
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-cleanup',
    aliases: [],
    summary: 'Run wf-browser cleanup for old runs and browser profiles.',
    example: 'wf-ui-control.mjs browser-cleanup --apply true --max-age-days 7',
    flags: [
      { flag: 'apply', description: 'actually apply cleanup (default: dry run)' },
      { flag: 'keep-latest', value: '<n>', description: 'keep the n latest runs' },
      { flag: 'max-age-days', value: '<n>', description: 'remove runs older than n days' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-command',
    aliases: [],
    summary: 'Run a single observe.*/act.* browser primitive against a window.',
    example: 'wf-ui-control.mjs browser-command --run <runId> --window <windowId> --lease <leaseId> --primitive observe.uiTree',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'window', value: '<windowId>', description: 'window id (alias: --windowId)' },
      { flag: 'lease', value: '<leaseId>', description: 'lease id (alias: --leaseId)' },
      { flag: 'primitive', value: '<observe.*|act.*>', description: 'browser primitive to run' },
      { flag: 'payload', value: '<json>', description: 'primitive payload as a JSON object' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
  {
    name: 'browser-snapshot',
    aliases: [],
    summary: 'Run observe.* primitives and aggregate their artifacts into a snapshot.',
    example: 'wf-ui-control.mjs browser-snapshot --run <runId> --window <windowId> --lease <leaseId>',
    flags: [
      { flag: 'run', value: '<runId>', description: 'run id (alias: --runId)' },
      { flag: 'window', value: '<windowId>', description: 'window id (alias: --windowId)' },
      { flag: 'lease', value: '<leaseId>', description: 'lease id (alias: --leaseId)' },
      { flag: 'primitives', value: '<observe.*,...>', description: 'primitives to run (default: standard observe set)' },
      { flag: 'strict', description: 'fail the whole snapshot when one primitive fails' },
      { flag: 'url', value: '<url>', description: 'wf-ui backend URL (or HARNESS_WF_UI_URL)' },
      { flag: 'token', value: '<token>', description: 'auth token' },
    ],
  },
];

function registryEntryFor(commandName) {
  if (!commandName) return null;
  return COMMAND_REGISTRY.find(entry =>
    entry.name === commandName || (entry.aliases || []).includes(commandName)
  ) || null;
}

function helpTextFor(commandName) {
  const entry = registryEntryFor(commandName);
  if (!entry) {
    return 'Usage: wf-ui-control.mjs <command> [flags]\nPass --help after a command for command-specific flags.';
  }
  const lines = [
    `Usage: wf-ui-control.mjs ${entry.name} [flags]`,
    '',
    entry.summary,
  ];
  if (entry.aliases && entry.aliases.length) {
    lines.push('', `Aliases: ${entry.aliases.join(', ')}`);
  }
  if (entry.flags && entry.flags.length) {
    lines.push('', 'Flags:');
    for (const flag of entry.flags) {
      const rendered = `  --${flag.flag}${flag.value ? ` ${flag.value}` : ''}`;
      lines.push(rendered.length >= 44 ? `${rendered} ${flag.description}` : `${rendered.padEnd(44)}${flag.description}`);
    }
  }
  if (entry.example) {
    lines.push('', `Example: ${entry.example}`);
  }
  return lines.join('\n');
}

// `help --json` output: the full registry `{ commands: [...], actions: [...] }`
// when no command is named, or a single command entry. The command list is
// built from BOTH the registry (names + aliases) and the dispatch map, so
// every dispatchable name appears exactly once; dispatch names without a
// registry entry fall back to `{ name, summary: '(undocumented)' }`. The
// `actions` array merges the shared action registry
// (Harness/a2a/action-registry.json): every action with a cli.command is
// mapped to `{ id, command, summary, flags }`. When the shared registry file
// is missing or invalid the `actions` key is omitted and `actionsFallback:
// true` marks the absence so consumers can distinguish it from an empty list
// (COMMAND_REGISTRY remains the command surface either way).
function registryCommandsJson() {
  const entriesByKey = new Map();
  for (const entry of COMMAND_REGISTRY) {
    entriesByKey.set(entry.name, entry);
    for (const alias of entry.aliases || []) entriesByKey.set(alias, entry);
  }
  const commands = [];
  const seen = new Set();
  for (const name of ['help', ...Object.keys(COMMAND_DISPATCH)]) {
    const entry = entriesByKey.get(name);
    if (entry) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      commands.push(entry);
    } else {
      commands.push({ name, summary: '(undocumented)' });
    }
  }
  return commands;
}

// Actions from the shared action registry with a cli.command set, mapped to
// { id, command, summary, flags }. Returns null when the registry file is
// missing or invalid so callers can emit the actionsFallback marker.
function registryActionsJson(projectRoot) {
  const registry = readJson(path.join(projectRoot, 'Harness', 'a2a', 'action-registry.json'), null);
  if (!registry || !Array.isArray(registry.actions)) return null;
  return registry.actions
    .filter(action => action && action.cli && action.cli.command)
    .map(action => ({
      id: action.id,
      command: action.cli.command,
      summary: action.summary || '',
      flags: Array.isArray(action.cli.flags) ? action.cli.flags : [],
    }));
}

function helpJsonFor(commandName, projectRoot) {
  if (commandName) return registryEntryFor(commandName) || { name: commandName, summary: '(undocumented)' };
  const output = { commands: registryCommandsJson() };
  const actions = registryActionsJson(projectRoot);
  if (actions === null) output.actionsFallback = true;
  else output.actions = actions;
  return output;
}

// Dispatch map: every command (and alias) the CLI accepts. This is the
// machine-readable source of "known dispatch names" used by `help --json`.
const COMMAND_DISPATCH = {
  self: () => selfContext(),
  snapshot: (projectRoot, flags) => snapshot(projectRoot, flags),
  describe: async (projectRoot, flags) => describeSnapshot(await snapshot(projectRoot, flags)),
  'create-agent': (projectRoot, flags) => createAgent(projectRoot, flags),
  'find-agent': (_projectRoot, flags) => findAgent(flags),
  'agent-role-profile': (projectRoot, flags) => agentRoleProfile(projectRoot, flags),
  'send-input': (_projectRoot, flags) => sendInput(flags),
  'send-key': (projectRoot, flags, args) => sendKey(projectRoot, flags, args),
  key: (projectRoot, flags, args) => sendKey(projectRoot, flags, args),
  'delegate-agent': (_projectRoot, flags) => delegateAgent(flags),
  'send-agent-message': (_projectRoot, flags) => sendAgentMessage(flags),
  'message-agent': (_projectRoot, flags) => sendAgentMessage(flags),
  'broadcast-agent-message': (_projectRoot, flags) => broadcastAgentMessage(flags),
  'broadcast-agent': (_projectRoot, flags) => broadcastAgentMessage(flags),
  'read-agent-messages': (_projectRoot, flags) => readAgentMessages(flags),
  'agent-messages': (_projectRoot, flags) => readAgentMessages(flags),
  'read-agent': (_projectRoot, flags) => readAgent(flags),
  'bridge-messages': (_projectRoot, flags) => bridgeMessages(flags),
  'browser-runs': (_projectRoot, flags) => browserRuns(flags),
  'browser-run': (_projectRoot, flags) => browserRun(flags),
  'browser-window': (_projectRoot, flags) => browserWindow(flags),
  'browser-windows': (_projectRoot, flags) => browserWindows(flags),
  'browser-lease': (_projectRoot, flags) => browserLease(flags),
  'browser-url': (_projectRoot, flags) => browserUrl(flags),
  'browser-allocate': (_projectRoot, flags) => browserAllocate(flags),
  'browser-allocate-many': (_projectRoot, flags) => browserAllocateMany(flags),
  'browser-open': (projectRoot, flags) => browserOpen({ ...flags, project: projectRoot }),
  'browser-launches': (projectRoot, flags) => browserLaunches({ ...flags, project: projectRoot }),
  'browser-close': (projectRoot, flags) => browserClose({ ...flags, project: projectRoot }),
  'browser-wait': (_projectRoot, flags) => browserWait(flags),
  'browser-release': (_projectRoot, flags) => browserRelease(flags),
  'browser-artifacts': (_projectRoot, flags) => browserArtifacts(flags),
  'browser-connections': (_projectRoot, flags) => browserConnections(flags),
  'browser-cleanup': (_projectRoot, flags) => browserCleanup(flags),
  'browser-command': (_projectRoot, flags) => browserCommand(flags),
  'browser-snapshot': (_projectRoot, flags) => browserSnapshot(flags),
  'node-map': (projectRoot, flags) => nodeMap(projectRoot, flags),
  'workflow-node-map': (projectRoot, flags) => nodeMap(projectRoot, flags),
  'workflow-ontology': (_projectRoot, flags) => workflowOntology(flags),
  'workflow-context': (_projectRoot, flags) => workflowContext(flags),
  'read-node': (_projectRoot, flags) => readNode(flags),
  readnode: (_projectRoot, flags) => readNode(flags),
  'read-snapshot': (_projectRoot, flags) => readNode(flags),
  'workflow-node-action': (_projectRoot, flags) => workflowNodeAction(flags),
  'workflow-node-actions': (_projectRoot, flags) => workflowNodeAction(flags),
  'delete-node': (projectRoot, flags) => deleteNode(projectRoot, flags),
  connect: (projectRoot, flags) => connectNodes(projectRoot, flags),
  tail: (projectRoot, flags) => tail(projectRoot, flags),
  manuals: (projectRoot, flags, args) => manuals(projectRoot, flags, args),
  manual: (projectRoot, flags, args) => manuals(projectRoot, flags, args),
};

function readJson(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function readJsonl(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

function allSessionDirs(projectRoot) {
  const out = [];
  const pushSessions = (root, taskId = null) => {
    let sessions = [];
    try { sessions = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
    for (const session of sessions) {
      if (session.isDirectory()) out.push({ taskId, sessionId: session.name, dir: path.join(root, session.name) });
    }
  };
  const tasksRoot = path.join(projectRoot, 'Harness', 'tasks');
  let tasks = [];
  try { tasks = fs.readdirSync(tasksRoot, { withFileTypes: true }); } catch { tasks = []; }
  for (const task of tasks) {
    if (task.isDirectory() && !task.name.startsWith('_')) {
      pushSessions(path.join(tasksRoot, task.name, 'sessions'), task.name);
    }
  }
  pushSessions(path.join(projectRoot, 'Harness', 'a2a', 'sessions'), null);
  return out;
}

function localSnapshot(projectRoot) {
  const mapPath = process.env.HARNESS_WORKFLOW_MAP || path.join(projectRoot, 'Harness', 'a2a', 'workflow-map.json');
  const graph = readJson(mapPath, { schemaVersion: 1, version: 1, nodes: [], edges: [] });
  const sessions = allSessionDirs(projectRoot)
    .map(({ dir }) => readJson(path.join(dir, 'STATE.json')))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return {
    source: 'local-files',
    self: selfContext(),
    graph,
    nodes: graph.nodes || [],
    edges: graph.edges || [],
    sessions,
  };
}

function selfContext() {
  return {
    sessionId: process.env.HARNESS_PEER_SESSION_ID || '',
    peerRuntime: process.env.HARNESS_PEER_RUNTIME || '',
    agentKind: process.env.HARNESS_AGENT_KIND || '',
    workflowMode: process.env.HARNESS_WORKFLOW_MODE || '',
    nodeId: process.env.HARNESS_WORKFLOW_NODE_ID || '',
    mapPath: process.env.HARNESS_WORKFLOW_MAP || '',
    hasControlPlaneUrl: Boolean(process.env.HARNESS_WF_UI_URL || process.env.WF_UI_URL),
  };
}

function controlPlane(flags) {
  return {
    url: flags.url || process.env.HARNESS_WF_UI_URL || process.env.WF_UI_URL || '',
    token: flags.token || process.env.HARNESS_WF_UI_TOKEN || process.env.WF_UI_TOKEN || '',
    readToken: flags['read-token'] || process.env.HARNESS_WF_UI_READ_TOKEN || process.env.WF_UI_READ_TOKEN || '',
  };
}

function apiJson(baseUrl, token, route, {
  method = 'GET',
  body = null,
  actorSessionId = '',
  actorNodeId = '',
  actorType = '',
  actorKind = '',
} = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(actorSessionId ? { 'X-Harness-Session-Id': actorSessionId } : {}),
        ...(actorNodeId ? { 'X-Harness-Workflow-Node-Id': actorNodeId } : {}),
        ...(actorType ? { 'X-Harness-Actor-Type': actorType } : {}),
        ...(actorKind ? { 'X-Harness-Actor-Kind': actorKind } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : null; } catch {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function snapshot(projectRoot, flags) {
  const cp = controlPlane(flags);
  if (cp.url) {
    return apiJson(cp.url, cp.token || cp.readToken, '/api/a2a/snapshot', {
      actorSessionId: process.env.HARNESS_PEER_SESSION_ID || '',
    });
  }
  return localSnapshot(projectRoot);
}

function describeSnapshot(data) {
  const self = data.self || selfContext();
  const nodes = data.nodes || data.graph?.nodes || [];
  const edges = data.edges || data.graph?.edges || [];
  const sessions = data.sessions || [];
  const selfNodeIds = new Set([
    self.nodeId,
    self.sessionId ? `session-${self.sessionId}` : '',
  ].filter(Boolean));
  for (const node of nodes) {
    if (node.sessionId === self.sessionId || node.graphNodeId === self.nodeId || node.nodeId === self.nodeId) {
      selfNodeIds.add(node.id || node.nodeId || node.graphNodeId);
      if (node.graphNodeId) selfNodeIds.add(node.graphNodeId);
    }
  }
  const connectedEdges = edges.filter(edge =>
    selfNodeIds.has(edge.from) || selfNodeIds.has(edge.to) || selfNodeIds.has(edge.source) || selfNodeIds.has(edge.target)
  );
  return {
    self,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      sessions: sessions.length,
      runningSessions: sessions.filter(session => session.status === 'running' || session.status === 'starting').length,
    },
    nodes: nodes.map(node => ({
      id: node.id || node.nodeId,
      sessionId: node.sessionId,
      label: node.label,
      agentKind: node.agentKind,
      runtime: node.runtime,
      status: node.status,
      role: node.role,
    })),
    connectedEdges,
  };
}

function mainAgentKindFromIdentity(identity) {
  if (!identity || typeof identity !== 'object') return false;
  if (identity.isMainAgent === true) return true;
  const agentKind = String(identity.agentKind || '').toLowerCase();
  if (agentKind === 'main') return true;
  const role = String(identity.role || '').toLowerCase();
  return role === 'main' || role.includes('ceo');
}

async function assertMainAgent(flags, action = 'create-agent') {
  const actorKind = flags['actor-kind'] || flags.actorKind || process.env.HARNESS_AGENT_KIND || '';
  if (actorKind === 'main') return;
  if (actorKind && actorKind !== 'main') {
    throw new Error(`${action} is only available to Main Agent nodes. Subagents can read the workflow map but cannot create or control nodes.`);
  }
  // No local agent kind: resolve the actor from the backend so the gate matches
  // the backend isMainAgentGraphNode semantics (agentKind=main or role main/ceo).
  const cp = controlPlane(flags);
  if (!cp.url) {
    throw new Error(`${action} is only available to Main Agent nodes. Pass --actor-kind main, set HARNESS_AGENT_KIND=main, or set HARNESS_WF_UI_URL so the actor node can be resolved from the backend.`);
  }
  const actorId = nodeMapActorId(flags);
  let context;
  try {
    context = await apiJson(cp.url, cp.token || cp.readToken, `/api/workflow/context/${encodeURIComponent(actorId)}`);
  } catch {
    // Fail closed: an unreachable backend must not weaken the main-agent gate.
    throw new Error(`${action} is only available to Main Agent nodes. Subagents can read the workflow map but cannot create or control nodes. (failed to resolve actor ${actorId} from the backend)`);
  }
  if (!mainAgentKindFromIdentity(context?.context?.identity)) {
    throw new Error(`${action} is only available to Main Agent nodes. Subagents can read the workflow map but cannot create or control nodes.`);
  }
}

async function createAgent(projectRoot, flags) {
  assertMainAgent(flags, 'create-agent');
  const cp = controlPlane(flags);
  if (!cp.url) throw new Error('Missing HARNESS_WF_UI_URL for agent control.');
  const agentKind = flags['agent-kind'] || 'subagent';
  const runtime = flags.runtime || process.env.HARNESS_PEER_RUNTIME || 'claude';
  const rawSubagentMode = flags['subagent-mode'] || flags.subagentMode || 'built-in-subagents';
  // Backward compat: legacy 'wf-subagents' callers resolve to the canonical
  // 'wf-node-subagents' id; unspecified defaults to built-in-subagents.
  const subagentMode = rawSubagentMode === 'wf-subagents' ? 'wf-node-subagents' : rawSubagentMode;
  const body = {
    runtime,
    agentKind,
    role: flags.role || (agentKind === 'main' ? 'Main Agent' : 'Subagent'),
    objective: flags.objective || 'Spawned by Harness Workflow Main Agent',
    ...(flags['initial-prompt'] || flags.initialPrompt ? { initialPrompt: flags['initial-prompt'] || flags.initialPrompt } : {}),
    workflowMode: flags.mode || process.env.HARNESS_WORKFLOW_MODE || 'wf',
    subagentMode,
    cwd: flags.cwd || projectRoot,
    model: flags.model || '',
    provider: flags.provider || '',
    parentAgentId: flags.parent || process.env.HARNESS_PEER_SESSION_ID || null,
    parentNodeId: flags['parent-node'] || process.env.HARNESS_WORKFLOW_NODE_ID || null,
    launchPolicy: {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
    },
  };
  if (trueFlag(flags.deferPtySpawn) || trueFlag(flags['defer-pty-spawn']) || trueFlag(flags.defer)) {
    body.deferPtySpawn = true;
  }
  return apiJson(cp.url, cp.token, '/api/sessions', { method: 'POST', body });
}

async function sendInput(flags) {
  assertMainAgent(flags, 'send-input');
  const cp = controlPlane(flags);
  if (!cp.url) throw new Error('Missing HARNESS_WF_UI_URL for terminal input.');
  if (!flags.session) throw new Error('Missing --session <sessionId>.');
  const raw = flags.raw === 'true';
  const text = flags.text || '';
  const data = raw || /[\r\n]$/.test(text) ? text : `${text}\r`;
  const actorSessionId = flags.from || flags['from-session'] || process.env.HARNESS_PEER_SESSION_ID || '';
  return apiJson(cp.url, cp.token, `/api/sessions/${encodeURIComponent(flags.session)}/input`, {
    method: 'POST',
    actorSessionId,
    body: {
      data,
      fromSessionId: actorSessionId,
      fromNodeId: flags['from-node'] || process.env.HARNESS_WORKFLOW_NODE_ID || '',
      source: 'wf-ui-control.send-input',
    },
  });
}

// Named keystrokes mapped to the raw bytes a terminal emulator expects.
const SEND_KEY_BYTES = {
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  enter: '\r',
  esc: '\x1b',
  tab: '\t',
  backspace: '\x7f',
};

function sendKeyBytes(key) {
  const normalized = String(key || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(SEND_KEY_BYTES, normalized)) {
    throw new Error(`Unknown key "${String(key)}". Expected one of: ${Object.keys(SEND_KEY_BYTES).join(', ')}.`);
  }
  return SEND_KEY_BYTES[normalized];
}

// Resolve the target session for send-key: an explicit --session wins;
// otherwise resolve a --node id to its managed session through the local
// workflow graph map so node ids and session ids both work.
function sendKeyTargetSessionId(projectRoot, flags) {
  if (flags.session) return flags.session;
  const nodeId = flags.node || flags['target-node'] || process.env.HARNESS_WORKFLOW_NODE_ID || '';
  if (!nodeId) throw new Error('Missing --session <sessionId> (or --node <graphNodeIdOrSessionId>) for send-key.');
  const mapPath = process.env.HARNESS_WORKFLOW_MAP || path.join(projectRoot, 'Harness', 'a2a', 'workflow-map.json');
  const graph = readJson(mapPath, { nodes: [] });
  const node = (graph.nodes || []).find(item =>
    (item.nodeId || item.id) === nodeId || item.sessionId === nodeId
  );
  const sessionId = node?.sessionId || '';
  if (!sessionId) {
    throw new Error(`send-key: --node ${nodeId} does not resolve to a managed session in the workflow map.`);
  }
  return sessionId;
}

async function sendKey(projectRoot, flags, args = []) {
  assertMainAgent(flags, 'send-key');
  const cp = controlPlane(flags);
  if (!cp.url) throw new Error('Missing HARNESS_WF_UI_URL for terminal input.');
  const key = flags.key || args[0] || '';
  const data = sendKeyBytes(key);
  const sessionId = sendKeyTargetSessionId(projectRoot, flags);
  const actorSessionId = flags.from || flags['from-session'] || process.env.HARNESS_PEER_SESSION_ID || '';
  return apiJson(cp.url, cp.token, `/api/sessions/${encodeURIComponent(sessionId)}/input`, {
    method: 'POST',
    actorSessionId,
    body: {
      data,
      raw: true,
      fromSessionId: actorSessionId,
      fromNodeId: flags['from-node'] || process.env.HARNESS_WORKFLOW_NODE_ID || '',
      source: 'wf-ui-control.send-key',
    },
  });
}

async function bridgeMessages(flags) {
  const cp = controlPlane(flags);
  if (!cp.url) throw new Error('Missing HARNESS_WF_UI_URL for bridge messages.');
  const fromSessionId = flags.from || flags['from-session'] || process.env.HARNESS_PEER_SESSION_ID || '';
  const toSessionId = flags.to || flags.session || flags['to-session'] || '';
  if (!fromSessionId) throw new Error('Missing --from <sessionId> or HARNESS_PEER_SESSION_ID.');
  if (!toSessionId) throw new Error('Missing --to <sessionId> or --session <sessionId>.');
  const limit = flags.limit || flags.tail || 200;
  return apiJson(cp.url, cp.token, `/api/a2a/bridge-messages?fromSessionId=${encodeURIComponent(fromSessionId)}&toSessionId=${encodeURIComponent(toSessionId)}&limit=${encodeURIComponent(limit)}`);
}

function nodeMapActorId(flags) {
  const actor = flags.actor
    || flags['actor-node']
    || flags.actorNodeId
    || process.env.HARNESS_WORKFLOW_NODE_ID
    || process.env.HARNESS_PEER_SESSION_ID
    || '';
  if (!actor) throw new Error('Missing --actor <graphNodeIdOrSessionId> or HARNESS_WORKFLOW_NODE_ID for node-map control.');
  return actor;
}

async function nodeMapControlPlane(flags) {
  await assertMainAgent(flags, 'node-map');
  const cp = controlPlane(flags);
  if (!cp.url) throw new Error('Missing HARNESS_WF_UI_URL for node-map control.');
  return cp;
}

function workflowApiControlPlane(flags, action) {
  const cp = controlPlane(flags);
  if (!cp.url) throw new Error(`Missing HARNESS_WF_UI_URL for ${action}.`);
  return cp;
}

function workflowTargetNodeId(flags, action) {
  const targetNodeId = flags.node
    || flags.target
    || flags.id
    || flags.session
    || flags['target-node']
    || process.env.HARNESS_WORKFLOW_NODE_ID
    || process.env.HARNESS_PEER_SESSION_ID
    || '';
  if (!targetNodeId) throw new Error(`Missing --node <graphNodeIdOrSessionId> for ${action}.`);
  return targetNodeId;
}

function parseJsonObjectFlag(value, label) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    throw new Error(`${label} must be a JSON object.`);
  }
  throw new Error(`${label} must be a JSON object.`);
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeNodeMapAction(value) {
  const raw = String(value || '').trim().replace(/^agent\./, '');
  const compact = raw.replace(/[-_\s]+/g, '').toLowerCase();
  const aliases = {
    read: 'readGraph',
    readgraph: 'readGraph',
    describe: 'readGraph',
    snapshot: 'readGraph',
    create: 'createNode',
    createnode: 'createNode',
    add: 'createNode',
    addnode: 'createNode',
    connect: 'connectNodes',
    connectnode: 'connectNodes',
    connectnodes: 'connectNodes',
    disconnect: 'disconnectNodes',
    disconnectnode: 'disconnectNodes',
    disconnectnodes: 'disconnectNodes',
    update: 'updateEdge',
    updateedge: 'updateEdge',
    move: 'moveNode',
    movenode: 'moveNode',
    delete: 'deleteNode',
    deletenode: 'deleteNode',
    deleteone: 'deleteNode',
    deletenodes: 'deleteNodes',
    deleteall: 'deleteNodes',
    clear: 'deleteNodes',
    clearmap: 'deleteNodes',
    layout: 'layout',
    relayout: 'layout',
    arrange: 'layout',
    attach: 'attachDock',
    attachdock: 'attachDock',
    dock: 'attachDock',
    detach: 'detachDock',
    detachdock: 'detachDock',
    undock: 'detachDock',
    setside: 'setDockSide',
    setdockside: 'setDockSide',
    dockside: 'setDockSide',
    undo: 'undo',
    undograph: 'undo',
    redo: 'redo',
    redograph: 'redo',
  };
  const action = aliases[compact];
  if (!action) {
    throw new Error('Missing or unknown node-map --action. Use readGraph, createNode, connectNodes, disconnectNodes, updateEdge, moveNode, deleteNode, deleteNodes, attachDock, detachDock, setDockSide, layout, undo, or redo.');
  }
  return action;
}

function nodeMapPayloadForAction(actionName, flags, actorNodeId) {
  const payload = {
    ...parseJsonObjectFlag(flags.payload || flags.body || flags.json, '--payload'),
    actorNodeId,
  };
  if (actionName === 'createNode') {
    if (flags.type) payload.type = flags.type;
    if (flags.title) payload.title = flags.title;
    if (flags.node && !payload.nodeId) payload.nodeId = flags.node;
    const x = optionalNumber(flags.x);
    const y = optionalNumber(flags.y);
    if (x !== undefined || y !== undefined) {
      payload.position = {
        ...(payload.position && typeof payload.position === 'object' ? payload.position : {}),
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
      };
    }
  }
  if (actionName === 'connectNodes') {
    payload.from = flags.from || flags.source || flags['source-node'] || payload.from || payload.source || actorNodeId;
    payload.to = flags.to || flags.target || flags.session || flags['target-node'] || payload.to || payload.target;
    if (flags.relation) payload.relation = flags.relation;
    if (flags['source-handle']) payload.sourceHandle = flags['source-handle'];
    if (flags['target-handle']) payload.targetHandle = flags['target-handle'];
    if (flags.direction) payload.direction = flags.direction;
    if (!payload.from || !payload.to) throw new Error('node-map connectNodes requires --to <nodeOrSession>; --from defaults to the actor.');
  }
  if (actionName === 'disconnectNodes') {
    payload.edgeId = flags.edge || flags['edge-id'] || flags.id || payload.edgeId || payload.id;
    if (!payload.edgeId) throw new Error('node-map disconnectNodes requires --edge <edgeId>.');
  }
  if (actionName === 'updateEdge') {
    payload.edgeId = flags.edge || flags['edge-id'] || flags.id || payload.edgeId || payload.id;
    if (!payload.edgeId && flags.from && flags.to) {
      payload.edgeId = `${flags.from}->${flags.to}`;
    }
    if (flags.relation) payload.relation = flags.relation;
    if (flags.direction) payload.direction = flags.direction;
    if (flags['source-handle']) payload.sourceHandle = flags['source-handle'];
    if (flags['target-handle']) payload.targetHandle = flags['target-handle'];
    if (!payload.edgeId) {
      throw new Error('node-map updateEdge requires --edge <edgeId> (or --from <node> --to <node>).');
    }
    if (
      payload.relation === undefined
      && payload.direction === undefined
      && payload.sourceHandle === undefined
      && payload.targetHandle === undefined
    ) {
      throw new Error('node-map updateEdge requires at least one of --relation, --direction, --source-handle, --target-handle.');
    }
  }
  if (actionName === 'moveNode') {
    payload.targetNodeId = flags.node || flags.target || flags.id || payload.targetNodeId || payload.nodeId || payload.id;
    const x = optionalNumber(flags.x);
    const y = optionalNumber(flags.y);
    payload.position = {
      ...(payload.position && typeof payload.position === 'object' ? payload.position : {}),
      ...(x !== undefined ? { x } : {}),
      ...(y !== undefined ? { y } : {}),
    };
    if (!payload.targetNodeId) throw new Error('node-map moveNode requires --node <nodeId>.');
    if (payload.position.x === undefined || payload.position.y === undefined) throw new Error('node-map moveNode requires --x <number> and --y <number>.');
  }
  if (actionName === 'deleteNode') {
    payload.targetNodeId = flags.node || flags.target || flags.id || payload.targetNodeId || payload.nodeId || payload.id;
    if (trueFlag(flags.force)) payload.force = true;
    if (trueFlag(flags['allow-live-agent-delete'])) payload.allowLiveAgentDelete = true;
    if (!payload.targetNodeId) throw new Error('node-map deleteNode requires --node <nodeIdOrSessionId>.');
  }
  if (actionName === 'deleteNodes') {
    const targetNodeIds = [
      ...listFlag(flags.nodes || flags['node-ids'] || flags.ids),
      ...listFlag(flags.node || ''),
    ];
    if (targetNodeIds.length > 0) payload.targetNodeIds = targetNodeIds;
    if (trueFlag(flags.all) || String(flags.all || '').toLowerCase() === 'all') payload.all = true;
    if (trueFlag(flags.force)) payload.force = true;
    if (trueFlag(flags['allow-live-agent-delete'])) payload.allowLiveAgentDelete = true;
    if (!payload.all && !payload.targetNodeIds?.length && !payload.nodeIds?.length && !payload.ids?.length) {
      throw new Error('node-map deleteNodes requires --all true or --nodes <nodeId,...>.');
    }
  }
  if (actionName === 'layout') {
    const mode = flags['layout-mode'] || flags.mode || payload.mode;
    if (mode) payload.mode = mode;
    const originX = optionalNumber(flags['origin-x']);
    const originY = optionalNumber(flags['origin-y']);
    const gapX = optionalNumber(flags['gap-x']);
    const gapY = optionalNumber(flags['gap-y']);
    if (originX !== undefined) payload.originX = originX;
    if (originY !== undefined) payload.originY = originY;
    if (gapX !== undefined) payload.gapX = gapX;
    if (gapY !== undefined) payload.gapY = gapY;
  }
  if (actionName === 'attachDock' || actionName === 'detachDock' || actionName === 'setDockSide') {
    payload.anchorId = flags.anchor || flags['anchor-id'] || payload.anchorId;
    payload.draggedId = flags.dragged || flags['dragged-id'] || payload.draggedId;
    if (flags.side) payload.side = flags.side;
    const dockId = flags.dock || flags['dock-id'] || payload.dockId;
    if (dockId) payload.dockId = dockId;
    if (!payload.dockId && (!payload.anchorId || !payload.draggedId)) {
      throw new Error(`node-map ${actionName} requires --anchor <nodeId> and --dragged <nodeId> (or --dock-id <id> for detachDock).`);
    }
    if (payload.anchorId === payload.draggedId) {
      throw new Error(`node-map ${actionName} requires distinct anchor and dragged nodes.`);
    }
    if (actionName === 'setDockSide' && !payload.side) {
      throw new Error('node-map setDockSide requires --side <left|right|top|bottom>.');
    }
  }
  return payload;
}

async function agentGraphAction(flags, actionName, payload = {}) {
  const cp = await nodeMapControlPlane(flags);
  const actorNodeId = nodeMapActorId(flags);
  return apiJson(cp.url, cp.token, `/api/workflow/nodes/${encodeURIComponent(actorNodeId)}/actions/agent.${actionName}`, {
    method: 'POST',
    body: {
      actorNodeId,
      ...payload,
    },
  });
}

// P5: graph.undo / graph.redo are typed graph actions (not agent.* actions);
// the CLI posts them to the graph-actions endpoint with {actorNodeId, scope}.
async function graphHistoryAction(flags, actionName) {
  const cp = await nodeMapControlPlane(flags);
  const actorNodeId = nodeMapActorId(flags);
  return apiJson(cp.url, cp.token, `/api/workflow/nodes/${encodeURIComponent(actorNodeId)}/actions/graph.${actionName}`, {
    method: 'POST',
    body: {
      actorNodeId,
      scope: flags.scope || 'graph',
    },
  });
}

async function nodeMap(projectRoot, flags) {
  const actionName = normalizeNodeMapAction(flags.action || flags.command || flags.do);
  const actorNodeId = nodeMapActorId(flags);
  const payload = nodeMapPayloadForAction(actionName, flags, actorNodeId);
  if (actionName === 'createNode' && !payload.cwd) payload.cwd = projectRoot;
  if (actionName === 'undo' || actionName === 'redo') {
    return graphHistoryAction(flags, actionName);
  }
  return agentGraphAction(flags, actionName, payload);
}

async function workflowContext(flags) {
  const cp = controlPlane(flags);
  const token = cp.token || cp.readToken;
  if (!cp.url) throw new Error('Missing HARNESS_WF_UI_URL for workflow-context.');
  const targetNodeId = workflowTargetNodeId(flags, 'workflow-context');
  const result = await apiJson(cp.url, token, `/api/workflow/context/${encodeURIComponent(targetNodeId)}`, {
    actorSessionId: process.env.HARNESS_PEER_SESSION_ID || '',
  });
  const subagentMode = result?.context?.subagentMode
    || result?.node?.subagentMode
    || result?.node?.settings?.values?.subagentMode
    || '';
  return subagentMode ? { ...result, subagentMode } : result;
}

async function readNode(flags) {
  const cp = controlPlane(flags);
  const token = cp.token || cp.readToken;
  if (!cp.url) throw new Error('Missing HARNESS_WF_UI_URL for read-node.');
  const targetNodeId = workflowTargetNodeId(flags, 'read-node');
  return apiJson(cp.url, token, `/api/workflow/nodes/${encodeURIComponent(targetNodeId)}`, {
    actorSessionId: process.env.HARNESS_PEER_SESSION_ID || '',
  });
}

async function workflowOntology(flags) {
  const cp = controlPlane(flags);
  const token = cp.token || cp.readToken;
  if (!cp.url) throw new Error('Missing HARNESS_WF_UI_URL for workflow-ontology.');
  return apiJson(cp.url, token, '/api/workflow/ontology', {
    actorSessionId: process.env.HARNESS_PEER_SESSION_ID || '',
  });
}

async function workflowNodeAction(flags) {
  const cp = workflowApiControlPlane(flags, 'workflow-node-action');
  const targetNodeId = workflowTargetNodeId(flags, 'workflow-node-action');
  const actionName = String(flags.action || flags.command || flags.do || '').trim();
  if (!actionName) throw new Error('Missing --action <type.action> for workflow-node-action.');
  const payload = parseJsonObjectFlag(flags.payload || flags.body || flags.json, '--payload');
  const actorNodeId = flags.actor
    || flags['actor-node']
    || flags.actorNodeId
    || process.env.HARNESS_WORKFLOW_NODE_ID
    || '';
  const actorSessionId = flags['actor-session']
    || flags.actorSessionId
    || process.env.HARNESS_PEER_SESSION_ID
    || '';
  const actorKind = flags['actor-kind']
    || flags.actorKind
    || process.env.HARNESS_AGENT_KIND
    || '';
  if (actorNodeId && payload.actorNodeId === undefined) payload.actorNodeId = actorNodeId;
  if (actorSessionId && payload.actorSessionId === undefined) payload.actorSessionId = actorSessionId;
  if (actorKind && payload.actorKind === undefined) payload.actorKind = actorKind;
  if ((actorNodeId || actorSessionId || actorKind) && payload.actorType === undefined) payload.actorType = 'agent';
  if (flags.resume !== undefined && payload.resume === undefined) payload.resume = trueFlag(flags.resume);
  return apiJson(cp.url, cp.token, `/api/workflow/nodes/${encodeURIComponent(targetNodeId)}/actions/${encodeURIComponent(actionName)}`, {
    method: 'POST',
    body: payload,
    actorSessionId,
    actorNodeId,
    actorKind,
    actorType: payload.actorType || ((actorNodeId || actorSessionId || actorKind) ? 'agent' : ''),
  });
}

async function delegateAgent(flags) {
  const cp = workflowApiControlPlane(flags, 'delegate-agent');
  const targetNodeId = workflowTargetNodeId(flags, 'delegate-agent');
  const actorNodeId = flags.actor
    || flags['actor-node']
    || flags.actorNodeId
    || process.env.HARNESS_WORKFLOW_NODE_ID
    || '';
  const actorSessionId = flags['actor-session']
    || flags.actorSessionId
    || flags.from
    || flags['from-session']
    || process.env.HARNESS_PEER_SESSION_ID
    || '';
  const actorKind = flags['actor-kind']
    || flags.actorKind
    || process.env.HARNESS_AGENT_KIND
    || '';
  const raw = flags.raw === 'true';
  const text = flags.text || flags.input || '';
  if (!text) throw new Error('Missing --text "..." for delegate-agent.');
  const data = raw || /[\r\n]$/.test(text) ? text : `${text}\r`;
  return apiJson(cp.url, cp.token, `/api/workflow/nodes/${encodeURIComponent(targetNodeId)}/actions/agent.sendInput`, {
    method: 'POST',
    body: {
      data,
      submit: !raw,
      fromSessionId: actorSessionId,
      fromNodeId: actorNodeId,
      source: 'wf-ui-control.delegate-agent',
    },
    actorSessionId,
    actorNodeId,
    actorKind,
    actorType: actorNodeId || actorSessionId || actorKind ? 'agent' : '',
  });
}

async function readAgent(flags) {
  const action = String(flags.action || flags.do || 'readOutput').trim();
  const aliases = {
    output: 'agent.readOutput',
    readoutput: 'agent.readOutput',
    transcript: 'agent.readTranscript',
    readtranscript: 'agent.readTranscript',
    context: 'agent.readContext',
    readcontext: 'agent.readContext',
  };
  const normalized = aliases[action.replace(/[-_\s.]+/g, '').toLowerCase()] || action;
  const actionName = normalized.startsWith('agent.') ? normalized : `agent.${normalized}`;
  return workflowNodeAction({
    ...flags,
    action: actionName,
    payload: flags.payload || flags.body || flags.json || JSON.stringify({
      ...(flags.tail ? { tail: Number(flags.tail) } : {}),
      ...(flags.fromSeq ? { fromSeq: Number(flags.fromSeq) } : {}),
      ...(flags.toSeq ? { toSeq: Number(flags.toSeq) } : {}),
    }),
  });
}

function workflowActorFields(flags) {
  const actorNodeId = flags.actor
    || flags['actor-node']
    || flags.actorNodeId
    || process.env.HARNESS_WORKFLOW_NODE_ID
    || '';
  const actorSessionId = flags['actor-session']
    || flags.actorSessionId
    || flags.from
    || flags['from-session']
    || process.env.HARNESS_PEER_SESSION_ID
    || '';
  const actorKind = flags['actor-kind']
    || flags.actorKind
    || process.env.HARNESS_AGENT_KIND
    || '';
  return { actorNodeId, actorSessionId, actorKind };
}

function workflowSenderNodeId(flags, action) {
  const senderNodeId = flags.node
    || flags.sender
    || flags.fromNode
    || flags['from-node']
    || process.env.HARNESS_WORKFLOW_NODE_ID
    || '';
  if (!senderNodeId) throw new Error(`Missing --node <senderAgentNodeId> or HARNESS_WORKFLOW_NODE_ID for ${action}.`);
  return senderNodeId;
}

function agentMessagePayload(flags, mode) {
  const text = flags.text || flags.message || flags.input || flags.data || '';
  if (!text) throw new Error(`Missing --text "..." for ${mode}.`);
  const payload = {
    text,
    ...(flags.topic ? { topic: flags.topic } : {}),
    ...(flags.thread ? { threadId: flags.thread } : {}),
    ...(flags['thread-id'] ? { threadId: flags['thread-id'] } : {}),
    ...(flags.replyTo ? { replyTo: flags.replyTo } : {}),
    ...(flags['reply-to'] ? { replyTo: flags['reply-to'] } : {}),
    ...(flags.requestId ? { requestId: flags.requestId } : {}),
    ...(flags['request-id'] ? { requestId: flags['request-id'] } : {}),
    ...(flags.raw ? { raw: trueFlag(flags.raw) } : {}),
  };
  const targets = listFlag(flags.to || flags.target || flags.targets || flags.recipients || '');
  if (targets.length === 1) payload.to = targets[0];
  else if (targets.length > 1) payload.to = targets;
  return payload;
}

async function agentMessageAction(flags, action, mode) {
  const cp = workflowApiControlPlane(flags, mode);
  const senderNodeId = workflowSenderNodeId(flags, mode);
  const actor = workflowActorFields(flags);
  const payload = {
    ...agentMessagePayload(flags, mode),
    ...(actor.actorNodeId ? { actorNodeId: actor.actorNodeId } : {}),
    ...(actor.actorSessionId ? { actorSessionId: actor.actorSessionId } : {}),
    ...(actor.actorKind ? { actorKind: actor.actorKind } : {}),
    actorType: actor.actorNodeId || actor.actorSessionId || actor.actorKind ? 'agent' : '',
    source: `wf-ui-control.${mode}`,
  };
  return apiJson(cp.url, cp.token, `/api/workflow/nodes/${encodeURIComponent(senderNodeId)}/actions/${action}`, {
    method: 'POST',
    body: payload,
    actorSessionId: actor.actorSessionId,
    actorNodeId: actor.actorNodeId,
    actorKind: actor.actorKind,
    actorType: payload.actorType,
  });
}

async function sendAgentMessage(flags) {
  if (!(flags.to || flags.target)) throw new Error('Missing --to <agentNodeIdOrSessionId> for send-agent-message.');
  return agentMessageAction(flags, 'agent.sendMessage', 'send-agent-message');
}

async function broadcastAgentMessage(flags) {
  return agentMessageAction(flags, 'agent.broadcastMessage', 'broadcast-agent-message');
}

async function readAgentMessages(flags) {
  const cp = workflowApiControlPlane(flags, 'read-agent-messages');
  const senderNodeId = workflowSenderNodeId(flags, 'read-agent-messages');
  const peer = flags.peer || flags.to || flags.from || flags.target || '';
  if (!peer) throw new Error('Missing --peer <agentNodeIdOrSessionId> for read-agent-messages.');
  const actor = workflowActorFields(flags);
  const payload = {
    peer,
    ...(flags.tail ? { tail: Number(flags.tail) } : {}),
    ...(flags.limit ? { limit: Number(flags.limit) } : {}),
    ...(actor.actorNodeId ? { actorNodeId: actor.actorNodeId } : {}),
    ...(actor.actorSessionId ? { actorSessionId: actor.actorSessionId } : {}),
    ...(actor.actorKind ? { actorKind: actor.actorKind } : {}),
    actorType: actor.actorNodeId || actor.actorSessionId || actor.actorKind ? 'agent' : '',
  };
  return apiJson(cp.url, cp.token, `/api/workflow/nodes/${encodeURIComponent(senderNodeId)}/actions/agent.readMessages`, {
    method: 'POST',
    body: payload,
    actorSessionId: actor.actorSessionId,
    actorNodeId: actor.actorNodeId,
    actorKind: actor.actorKind,
    actorType: payload.actorType,
  });
}

function wfBrowserControlPlane(flags) {
  const cp = controlPlane(flags);
  if (!cp.url) throw new Error('Missing HARNESS_WF_UI_URL for wf-browser control.');
  return cp;
}

const DEFAULT_BROWSER_SNAPSHOT_PRIMITIVES = [
  'observe.route',
  'observe.capabilities',
  'observe.uiTree',
  'observe.state',
  'observe.logs',
  'observe.network',
  'observe.replay',
  'observe.diff',
];

function trueFlag(value) {
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

function listFlag(value) {
  return String(value || '')
    .split(/[,\n;]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function pickIndexed(values, index, fallback = '') {
  if (!values.length) return fallback;
  return values[index] || values[values.length - 1] || fallback;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(numeric, min), max);
}

function safePathSegment(value, fallback = 'item') {
  const text = String(value || fallback)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');
  return text || fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function openLocalUrl(url) {
  if (!url) return false;
  let command;
  let args;
  if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return true;
}

function existingFile(candidate) {
  try {
    return candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function browserCandidates(kind) {
  const browser = String(kind || 'chrome').toLowerCase();
  const candidates = [];
  const push = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  if (process.platform === 'win32') {
    const programFiles = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    if (browser === 'edge' || browser === 'msedge') {
      for (const root of programFiles) push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    } else if (browser === 'chromium') {
      for (const root of programFiles) push(path.join(root, 'Chromium', 'Application', 'chrome.exe'));
    } else {
      for (const root of programFiles) push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      for (const root of programFiles) push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    if (browser === 'edge' || browser === 'msedge') {
      push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    } else if (browser === 'chromium') {
      push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    } else {
      push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
      push('/Applications/Chromium.app/Contents/MacOS/Chromium');
      push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    }
  } else {
    if (browser === 'edge' || browser === 'msedge') {
      push('/usr/bin/microsoft-edge');
      push('/usr/bin/microsoft-edge-stable');
    } else if (browser === 'chromium') {
      push('/usr/bin/chromium');
      push('/usr/bin/chromium-browser');
    } else {
      push('/usr/bin/google-chrome');
      push('/usr/bin/google-chrome-stable');
      push('/usr/bin/chromium');
      push('/usr/bin/chromium-browser');
      push('/usr/bin/microsoft-edge');
      push('/usr/bin/microsoft-edge-stable');
    }
  }
  return candidates;
}

function resolveBrowserExecutable(flags) {
  const explicit = flags.browserCommand || flags['browser-command'] || flags.browserPath || flags['browser-path'] || process.env.HARNESS_WF_BROWSER_BROWSER || '';
  if (explicit) return { command: explicit, source: 'explicit', candidates: [] };
  const candidates = browserCandidates(flags.browser || 'chrome');
  const found = candidates.find(existingFile);
  return {
    command: found || '',
    source: found ? 'detected' : 'missing',
    candidates,
  };
}

function browserProfileDir(projectRoot, runId, windowId, flags) {
  const explicit = flags.profileDir || flags['profile-dir'] || '';
  if (explicit) return path.resolve(projectRoot, explicit);
  return path.join(
    projectRoot,
    'Harness',
    'wf-browser',
    'tmp',
    'browser-profiles',
    safePathSegment(runId, 'run'),
    safePathSegment(windowId, 'window')
  );
}

function browserOpenArgs({ launchUrl, profileDir, context, width, height, flags }) {
  const args = [
    '--new-window',
    '--no-first-run',
    '--disable-default-apps',
    '--disable-background-mode',
  ];
  if (context === 'isolated') args.push(`--user-data-dir=${profileDir}`);
  if (width && height) args.push(`--window-size=${width},${height}`);
  if (trueFlag(flags.app)) args.push(`--app=${launchUrl}`);
  else args.push(launchUrl);
  return args;
}

function shouldUseBrowserOpen(flags) {
  return Boolean(
    flags.context
    || flags['browser-context']
    || flags.browser
    || flags.browserCommand
    || flags['browser-command']
    || flags.browserPath
    || flags['browser-path']
    || flags.profileDir
    || flags['profile-dir']
    || trueFlag(flags.isolated)
    || trueFlag(flags.dryRun)
  );
}

function nowIso() {
  return new Date().toISOString();
}

function wfBrowserWindowRuntimeDir(projectRoot, runId, windowId) {
  return path.join(
    projectRoot,
    'Harness',
    'wf-browser',
    'runs',
    safePathSegment(runId, 'run'),
    'windows',
    safePathSegment(windowId, 'window')
  );
}

function browserLaunchesPath(projectRoot, runId, windowId) {
  return path.join(wfBrowserWindowRuntimeDir(projectRoot, runId, windowId), 'browser-launches.json');
}

function readBrowserLaunchState(projectRoot, runId, windowId) {
  const data = readJson(browserLaunchesPath(projectRoot, runId, windowId), { schemaVersion: 1, launches: [] });
  return {
    schemaVersion: 1,
    runId,
    windowId,
    updatedAt: data.updatedAt || '',
    launches: Array.isArray(data.launches) ? data.launches : [],
  };
}

function writeBrowserLaunchState(projectRoot, runId, windowId, launches) {
  const filePath = browserLaunchesPath(projectRoot, runId, windowId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const state = {
    schemaVersion: 1,
    runId,
    windowId,
    updatedAt: nowIso(),
    launches,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { state, path: path.relative(projectRoot, filePath).replace(/\\/g, '/') };
}

function upsertBrowserLaunch(projectRoot, launch) {
  const state = readBrowserLaunchState(projectRoot, launch.runId, launch.windowId);
  const launches = state.launches.filter(item => item.launchId !== launch.launchId);
  launches.push(launch);
  launches.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  return writeBrowserLaunchState(projectRoot, launch.runId, launch.windowId, launches);
}

function processAlive(pid) {
  const numericPid = Number(pid || 0);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function closeProcess(pid, { dryRun = false, force = false } = {}) {
  const numericPid = Number(pid || 0);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return { attempted: false, status: 'no-pid', pid: null, aliveBefore: false, aliveAfter: false };
  }
  const aliveBefore = processAlive(numericPid);
  if (dryRun) {
    return { attempted: false, status: 'dry-run', pid: numericPid, aliveBefore, aliveAfter: aliveBefore };
  }
  if (!aliveBefore) {
    return { attempted: false, status: 'already-exited', pid: numericPid, aliveBefore, aliveAfter: false };
  }
  try {
    process.kill(numericPid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (err) {
    return {
      attempted: true,
      status: 'failed',
      pid: numericPid,
      aliveBefore,
      aliveAfter: processAlive(numericPid),
      error: err?.message || 'process kill failed',
    };
  }
  return {
    attempted: true,
    status: 'closed',
    pid: numericPid,
    aliveBefore,
    aliveAfter: processAlive(numericPid),
  };
}

function removeBrowserProfile(projectRoot, profileDir, { dryRun = false } = {}) {
  if (!profileDir) return { attempted: false, removed: false, status: 'no-profile-dir', path: '' };
  const profilesRoot = path.resolve(projectRoot, 'Harness', 'wf-browser', 'tmp', 'browser-profiles');
  const target = path.resolve(profileDir);
  const withinProfiles = target.startsWith(`${profilesRoot}${path.sep}`);
  if (!withinProfiles) {
    return { attempted: false, removed: false, status: 'outside-profile-root', path: target };
  }
  const exists = fs.existsSync(target);
  if (dryRun) return { attempted: false, removed: false, status: 'dry-run', path: target, exists };
  if (!exists) return { attempted: false, removed: false, status: 'missing', path: target, exists: false };
  fs.rmSync(target, { recursive: true, force: true });
  return { attempted: true, removed: true, status: 'removed', path: target, exists: true };
}

function launchIdFromFlags(flags, windowId) {
  return flags.launch || flags.launchId || flags.id || `launch-${Date.now().toString(36)}-${safePathSegment(windowId, 'window')}`;
}

function shouldRemoveBrowserProfile(flags) {
  return trueFlag(flags.removeProfile)
    || trueFlag(flags['remove-profile'])
    || trueFlag(flags.cleanupProfile)
    || trueFlag(flags['cleanup-profile']);
}

function browserLaunchWithRuntime(launch) {
  return {
    ...launch,
    alive: processAlive(launch.pid),
  };
}

function selectBrowserLaunches(launches, flags) {
  const requested = flags.launch || flags.launchId || flags.id || '';
  if (requested) return launches.filter(item => item.launchId === requested);
  if (trueFlag(flags.all)) return launches;
  const reusable = launches.find(item => !new Set(['closed', 'removed']).has(String(item.status || '')));
  return reusable ? [reusable] : [];
}

async function browserRuns(flags) {
  const cp = wfBrowserControlPlane(flags);
  const limit = flags.limit || 20;
  return apiJson(cp.url, cp.token, `/api/wf-browser/runs?limit=${encodeURIComponent(limit)}`);
}

async function browserRun(flags) {
  const cp = wfBrowserControlPlane(flags);
  return apiJson(cp.url, cp.token, '/api/wf-browser/runs', {
    method: 'POST',
    body: {
      runId: flags.run || flags.runId || undefined,
      mode: flags.mode || 'mixed',
      agentId: flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown',
      sessionId: flags.session || process.env.HARNESS_PEER_SESSION_ID || '',
      taskId: flags.task || flags.taskId || '',
      route: flags.route || '',
      objective: flags.objective || '',
      readinessBefore: flags['readiness-before'] || '',
      readinessAfter: flags['readiness-after'] || '',
    },
  });
}

async function browserWindow(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  return apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows`, {
    method: 'POST',
    body: {
      windowId: flags.window || flags.windowId || undefined,
      agentId: flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown',
      sessionId: flags.session || process.env.HARNESS_PEER_SESSION_ID || '',
      route: flags.route || '',
      viewport: {
        width: flags.width ? Number(flags.width) : undefined,
        height: flags.height ? Number(flags.height) : undefined,
      },
    },
  });
}

async function browserWindows(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  return apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows`);
}

async function browserLease(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  return apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/lease`, {
    method: 'POST',
    body: {
      leaseId: flags.lease || flags.leaseId || undefined,
      type: flags.type || 'control',
      agentId: flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown',
      sessionId: flags.session || process.env.HARNESS_PEER_SESSION_ID || '',
      reason: flags.reason || '',
      ttlMs: flags.ttlMs ? Number(flags.ttlMs) : undefined,
    },
  });
}

async function browserUrl(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  const params = new URLSearchParams();
  const leaseId = flags.lease || flags.leaseId || process.env.HARNESS_WF_BROWSER_LEASE_ID || '';
  if (leaseId) params.set('leaseId', leaseId);
  if (flags.agent || flags.agentId) params.set('agentId', flags.agent || flags.agentId);
  if (flags.route) params.set('route', flags.route);
  if (flags.debug === 'false' || flags.debug === '0') params.set('debug', '0');
  const query = params.toString();
  const result = await apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/launch-url${query ? `?${query}` : ''}`);
  return {
    ...result,
    opened: trueFlag(flags.open) ? openLocalUrl(result.launchUrl) : false,
  };
}

async function browserOpen(flags, options = {}) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  const projectRoot = path.resolve(flags.project || process.cwd());
  const directCommand = options.directCommand !== false;
  const context = String(flags.context || flags['browser-context'] || (trueFlag(flags.isolated) || directCommand ? 'isolated' : 'default')).toLowerCase();
  if (!new Set(['default', 'isolated']).has(context)) {
    throw new Error('Invalid --context; expected default or isolated.');
  }
  const urlResult = flags.url
    ? { ok: true, launchUrl: flags.url, runId, windowId, leaseId: flags.lease || flags.leaseId || '' }
    : await browserUrl({ ...flags, run: runId, window: windowId, open: 'false' });
  const launchUrl = urlResult.launchUrl;
  const dryRun = trueFlag(flags.dryRun) || trueFlag(flags['dry-run']);
  const width = flags.width ? Number(flags.width) : undefined;
  const height = flags.height ? Number(flags.height) : undefined;
  const launchId = launchIdFromFlags(flags, windowId);
  const startedAt = new Date().toISOString();
  let opened = false;
  let pid = null;
  let command = '';
  let args = [];
  let profileDir = '';
  let resolver = { source: 'system-default', candidates: [] };

  if (context === 'default' || String(flags.browser || '').toLowerCase() === 'default') {
    if (!dryRun) opened = openLocalUrl(launchUrl);
  } else {
    profileDir = browserProfileDir(projectRoot, runId, windowId, flags);
    fs.mkdirSync(profileDir, { recursive: true });
    resolver = resolveBrowserExecutable(flags);
    command = resolver.command;
    if (!command) {
      throw new Error(`Unable to locate Chrome/Edge/Chromium for isolated browser context. Pass --browser-command <path>. Checked: ${resolver.candidates.join(', ')}`);
    }
    args = browserOpenArgs({ launchUrl, profileDir, context, width, height, flags });
    if (!dryRun) {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      opened = true;
      pid = child.pid || null;
    }
  }

  const launch = {
    ok: true,
    launchId,
    runId,
    windowId,
    leaseId: urlResult.leaseId || flags.lease || flags.leaseId || '',
    agentId: flags.agent || flags.agentId || '',
    context,
    isolated: context === 'isolated',
    launchUrl,
    opened,
    dryRun,
    status: dryRun ? 'prepared' : (opened ? 'open' : 'not-opened'),
    pid,
    command,
    args,
    profileDir,
    resolver,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  if (flags['no-artifact'] !== 'true') {
    const artifact = await apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/artifacts`, {
      method: 'POST',
      body: {
        type: 'analysis',
        name: `browser-launch-${Date.now().toString(36)}.json`,
        label: 'browser.open',
        json: launch,
      },
    });
    launch.artifact = artifact.artifact || null;
  }
  const launchState = upsertBrowserLaunch(projectRoot, launch);
  launch.statePath = launchState.path;
  if (trueFlag(flags.wait) && !dryRun) {
    launch.connection = (await browserWait({
      ...flags,
      run: runId,
      window: windowId,
      agent: launch.agentId,
    })).connection;
    const updatedLaunchState = upsertBrowserLaunch(projectRoot, launch);
    launch.statePath = updatedLaunchState.path;
  }
  return launch;
}

function matchingWfBrowserConnection(connections, { runId, windowId, agentId = '' } = {}) {
  return (connections || []).find(item =>
    item.runId === runId
    && item.windowId === windowId
    && (!agentId || item.agentId === agentId)
  ) || null;
}

async function browserWait(flags) {
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  const agentId = flags.agent || flags.agentId || '';
  const timeoutMs = boundedNumber(flags.timeout || flags.timeoutMs || flags['wait-timeout'] || flags.waitTimeout, 10000, 250, 120000);
  const intervalMs = boundedNumber(flags.interval || flags.intervalMs, 250, 50, 5000);
  const startedAtMs = Date.now();
  let attempts = 0;
  let lastConnections = [];
  while (Date.now() - startedAtMs <= timeoutMs) {
    attempts += 1;
    const result = await browserConnections(flags);
    lastConnections = result.connections || [];
    const connection = matchingWfBrowserConnection(lastConnections, { runId, windowId, agentId });
    if (connection) {
      return {
        ok: true,
        runId,
        windowId,
        agentId,
        connection,
        attempts,
        waitedMs: Date.now() - startedAtMs,
      };
    }
    await sleep(intervalMs);
  }
  throw new Error(`wf-browser window did not connect within ${timeoutMs}ms: ${runId}/${windowId}${agentId ? ` agent=${agentId}` : ''}`);
}

async function browserAllocate(flags) {
  const cp = wfBrowserControlPlane(flags);
  let runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  let run = null;
  if (!runId) {
    const createdRun = await browserRun(flags);
    run = createdRun.run;
    runId = run.runId;
  }
  const windowResult = await apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows`, {
    method: 'POST',
    body: {
      windowId: flags.window || flags.windowId || undefined,
      agentId: flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown',
      sessionId: flags.session || process.env.HARNESS_PEER_SESSION_ID || '',
      route: flags.route || '',
      viewport: {
        width: flags.width ? Number(flags.width) : undefined,
        height: flags.height ? Number(flags.height) : undefined,
      },
    },
  });
  const leaseResult = await apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowResult.window.windowId)}/lease`, {
    method: 'POST',
    body: {
      type: flags.type || 'control',
      agentId: flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown',
      sessionId: flags.session || process.env.HARNESS_PEER_SESSION_ID || '',
      reason: flags.reason || 'allocated by wf-ui-control',
      ttlMs: flags.ttlMs ? Number(flags.ttlMs) : undefined,
    },
  });
  const urlResult = await browserUrl({
    ...flags,
    run: runId,
    window: windowResult.window.windowId,
    lease: leaseResult.lease.leaseId,
    open: 'false',
  });
  let browserLaunch = null;
  let opened = false;
  if (trueFlag(flags.open)) {
    if (shouldUseBrowserOpen(flags)) {
      browserLaunch = await browserOpen({
        ...flags,
        run: runId,
        window: windowResult.window.windowId,
        lease: leaseResult.lease.leaseId,
        agent: leaseResult.lease.agentId,
        url: urlResult.launchUrl,
      }, { directCommand: false });
      opened = browserLaunch.opened;
    } else {
      opened = openLocalUrl(urlResult.launchUrl);
    }
  }
  return {
    ok: true,
    run: run || { runId },
    window: windowResult.window,
    lease: leaseResult.lease,
    debugUrlParams: urlResult.debugUrlParams,
    launchUrl: urlResult.launchUrl,
    opened,
    browserLaunch,
    connection: trueFlag(flags.wait) && !trueFlag(flags.dryRun) && !trueFlag(flags['dry-run']) ? (await browserWait({
      ...flags,
      run: runId,
      window: windowResult.window.windowId,
      agent: leaseResult.lease.agentId,
    })).connection : null,
  };
}

async function browserAllocateMany(flags) {
  const agents = listFlag(flags.agents || flags.agentIds);
  const routes = listFlag(flags.routes);
  const sessions = listFlag(flags.sessions || flags.sessionIds);
  const windows = listFlag(flags.windows || flags.windowIds);
  const requestedCount = Number(flags.count || Math.max(agents.length, routes.length, sessions.length, windows.length, 1));
  const count = Math.min(Math.max(Number.isFinite(requestedCount) ? requestedCount : 1, 1), 50);
  let runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  let run = null;
  if (!runId) {
    const createdRun = await browserRun({
      ...flags,
      agent: pickIndexed(agents, 0, flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown'),
      session: pickIndexed(sessions, 0, flags.session || process.env.HARNESS_PEER_SESSION_ID || ''),
      route: pickIndexed(routes, 0, flags.route || ''),
    });
    run = createdRun.run;
    runId = run.runId;
  }

  const allocations = [];
  for (let index = 0; index < count; index += 1) {
    const agentId = pickIndexed(agents, index, flags.agent || flags.agentId || `${process.env.HARNESS_PEER_SESSION_ID || 'agent'}-${index + 1}`);
    const sessionId = pickIndexed(sessions, index, flags.session || process.env.HARNESS_PEER_SESSION_ID || '');
    const route = pickIndexed(routes, index, flags.route || '');
    const windowId = pickIndexed(windows, index, '');
    const allocation = await browserAllocate({
      ...flags,
      run: runId,
      window: windowId || undefined,
      agent: agentId,
      session: sessionId,
      route,
      reason: flags.reason || `batch allocation ${index + 1}/${count}`,
    });
    allocations.push({
      index,
      agentId,
      sessionId,
      route,
      run: allocation.run,
      window: allocation.window,
      lease: allocation.lease,
      debugUrlParams: allocation.debugUrlParams,
      launchUrl: allocation.launchUrl,
      opened: allocation.opened,
      browserLaunch: allocation.browserLaunch,
      connection: allocation.connection,
    });
  }

  return {
    ok: true,
    run: run || { runId },
    count: allocations.length,
    allocations,
    windows: allocations.map(item => item.window),
    leases: allocations.map(item => item.lease),
    launchUrls: allocations.map(item => item.launchUrl),
  };
}

async function browserLaunches(flags) {
  const projectRoot = path.resolve(flags.project || process.cwd());
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  const state = readBrowserLaunchState(projectRoot, runId, windowId);
  return {
    ok: true,
    runId,
    windowId,
    updatedAt: state.updatedAt,
    path: path.relative(projectRoot, browserLaunchesPath(projectRoot, runId, windowId)).replace(/\\/g, '/'),
    count: state.launches.length,
    launches: state.launches.map(browserLaunchWithRuntime),
  };
}

async function browserClose(flags) {
  const cp = wfBrowserControlPlane(flags);
  const projectRoot = path.resolve(flags.project || process.cwd());
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  const dryRun = trueFlag(flags.dryRun) || trueFlag(flags['dry-run']);
  const closeReason = flags.reason || 'closed by wf-ui-control';
  const state = readBrowserLaunchState(projectRoot, runId, windowId);
  const selected = selectBrowserLaunches(state.launches, flags);
  if (!selected.length) {
    return {
      ok: true,
      runId,
      windowId,
      path: path.relative(projectRoot, browserLaunchesPath(projectRoot, runId, windowId)).replace(/\\/g, '/'),
      count: 0,
      selectedLaunchIds: [],
      closed: [],
      warning: 'No matching browser launch found.',
    };
  }

  const selectedLaunchIds = new Set(selected.map(item => item.launchId));
  const closed = [];
  const launches = state.launches.map((launch) => {
    if (!selectedLaunchIds.has(launch.launchId)) return launch;
    const closeResult = closeProcess(launch.pid, {
      dryRun,
      force: trueFlag(flags.force),
    });
    const profileCleanup = shouldRemoveBrowserProfile(flags)
      ? removeBrowserProfile(projectRoot, launch.profileDir, { dryRun })
      : null;
    let status = launch.status || 'unknown';
    if (dryRun) status = 'close-dry-run';
    else if (closeResult.status === 'failed') status = 'close-failed';
    else if (profileCleanup?.status === 'outside-profile-root') status = 'cleanup-blocked';
    else status = 'closed';
    const updated = {
      ...launch,
      status,
      closeReason,
      closeResult,
      profileCleanup,
      closedAt: dryRun ? '' : nowIso(),
      updatedAt: nowIso(),
    };
    closed.push(browserLaunchWithRuntime(updated));
    return updated;
  });
  const written = writeBrowserLaunchState(projectRoot, runId, windowId, launches);
  const result = {
    ok: true,
    runId,
    windowId,
    path: written.path,
    count: closed.length,
    selectedLaunchIds: Array.from(selectedLaunchIds),
    closed,
  };
  if (flags['no-artifact'] !== 'true' && cp.url) {
    const artifact = await apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/artifacts`, {
      method: 'POST',
      body: {
        type: 'analysis',
        name: `browser-close-${Date.now().toString(36)}.json`,
        label: 'browser.close',
        json: result,
      },
    });
    result.artifact = artifact.artifact || null;
  }
  return result;
}

async function browserRelease(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  const leaseId = flags.lease || flags.leaseId || process.env.HARNESS_WF_BROWSER_LEASE_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  if (!leaseId) throw new Error('Missing --lease <leaseId> or HARNESS_WF_BROWSER_LEASE_ID.');
  const released = await apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/lease/${encodeURIComponent(leaseId)}/release`, {
    method: 'POST',
    body: { reason: flags.reason || 'released' },
  });
  if (!trueFlag(flags.close)) return released;
  const browserCloseResult = await browserClose({
    ...flags,
    run: runId,
    window: windowId,
    lease: leaseId,
    reason: flags.reason || 'released',
  });
  return {
    ...released,
    browserClose: browserCloseResult,
  };
}

async function browserArtifacts(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  return apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/artifacts`);
}

async function browserConnections(flags) {
  const cp = wfBrowserControlPlane(flags);
  return apiJson(cp.url, cp.token, '/api/wf-browser/connections');
}

async function browserCleanup(flags) {
  const cp = wfBrowserControlPlane(flags);
  return apiJson(cp.url, cp.token, '/api/wf-browser/cleanup', {
    method: 'POST',
    body: {
      apply: trueFlag(flags.apply),
      keepLatest: flags.keepLatest || flags['keep-latest'] ? Number(flags.keepLatest || flags['keep-latest']) : undefined,
      maxAgeDays: flags.maxAgeDays || flags['max-age-days'] ? Number(flags.maxAgeDays || flags['max-age-days']) : undefined,
    },
  });
}

function parseJsonFlag(value, fallback = {}) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch {
    throw new Error(`Invalid JSON flag: ${value}`);
  }
}

function browserCommandPayload(flags) {
  const payload = parseJsonFlag(flags.payload || flags.json, {});
  const target = {
    ...(payload.target && typeof payload.target === 'object' ? payload.target : {}),
    ...(flags.selector ? { selector: flags.selector } : {}),
    ...(flags.testid ? { testId: flags.testid } : {}),
    ...(flags['test-id'] ? { testId: flags['test-id'] } : {}),
    ...(flags.role ? { role: flags.role } : {}),
    ...(flags.name ? { name: flags.name } : {}),
    ...(flags.textTarget ? { text: flags.textTarget } : {}),
    ...(flags['text-target'] ? { text: flags['text-target'] } : {}),
  };
  const to = {
    ...(payload.to && typeof payload.to === 'object' ? payload.to : {}),
    ...(payload.destination && typeof payload.destination === 'object' ? payload.destination : {}),
    ...(flags.toSelector ? { selector: flags.toSelector } : {}),
    ...(flags['to-selector'] ? { selector: flags['to-selector'] } : {}),
    ...(flags.toTestid ? { testId: flags.toTestid } : {}),
    ...(flags.toTestId ? { testId: flags.toTestId } : {}),
    ...(flags['to-testid'] ? { testId: flags['to-testid'] } : {}),
    ...(flags['to-test-id'] ? { testId: flags['to-test-id'] } : {}),
    ...(flags.toRole ? { role: flags.toRole } : {}),
    ...(flags['to-role'] ? { role: flags['to-role'] } : {}),
    ...(flags.toName ? { name: flags.toName } : {}),
    ...(flags['to-name'] ? { name: flags['to-name'] } : {}),
  };
  const body = {
    ...payload,
    ...(Object.keys(target).length ? { target } : {}),
    ...(Object.keys(to).length ? { to } : {}),
    ...(flags.text ? { text: flags.text } : {}),
    ...(flags.key ? { key: flags.key } : {}),
    ...(flags.dx ? { dx: Number(flags.dx) } : {}),
    ...(flags.dy ? { dy: Number(flags.dy) } : {}),
    ...(flags.toX ? { toX: Number(flags.toX) } : {}),
    ...(flags['to-x'] ? { toX: Number(flags['to-x']) } : {}),
    ...(flags.toY ? { toY: Number(flags.toY) } : {}),
    ...(flags['to-y'] ? { toY: Number(flags['to-y']) } : {}),
    ...(flags.steps ? { steps: Number(flags.steps) } : {}),
    ...(flags.timeout ? { timeoutMs: Number(flags.timeout) } : {}),
    ...(flags.timeoutMs ? { timeoutMs: Number(flags.timeoutMs) } : {}),
    ...(flags.limit ? { limit: Number(flags.limit) } : {}),
    ...(flags.maxNodes ? { maxNodes: Number(flags.maxNodes) } : {}),
    ...(flags['max-nodes'] ? { maxNodes: Number(flags['max-nodes']) } : {}),
    ...(flags.prefix ? { prefix: flags.prefix } : {}),
    ...(flags.replace === 'true' ? { replace: true } : {}),
  };
  return body;
}

async function browserCommand(flags) {
  const cp = wfBrowserControlPlane(flags);
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  const leaseId = flags.lease || flags.leaseId || process.env.HARNESS_WF_BROWSER_LEASE_ID || '';
  const primitive = flags.primitive || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  if (!leaseId) throw new Error('Missing --lease <leaseId> or HARNESS_WF_BROWSER_LEASE_ID.');
  if (!primitive) throw new Error('Missing --primitive observe.* or act.*.');
  return apiJson(cp.url, cp.token, `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/commands`, {
    method: 'POST',
    body: {
      commandId: flags.command || flags.commandId || undefined,
      primitive,
      agentId: flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown',
      sessionId: flags.session || process.env.HARNESS_PEER_SESSION_ID || '',
      leaseId,
      timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
      payload: browserCommandPayload(flags),
      storeArtifact: flags['no-artifact'] === 'true' ? false : undefined,
    },
  });
}

function browserSnapshotPrimitives(flags) {
  const values = listFlag(flags.primitives || flags.primitive);
  const primitives = values.length ? values : DEFAULT_BROWSER_SNAPSHOT_PRIMITIVES;
  const invalid = primitives.filter(primitive => !primitive.startsWith('observe.'));
  if (invalid.length) {
    throw new Error(`browser-snapshot only accepts observe.* primitives: ${invalid.join(', ')}`);
  }
  return primitives;
}

async function browserSnapshot(flags) {
  const runId = flags.run || flags.runId || process.env.HARNESS_WF_BROWSER_RUN_ID || '';
  const windowId = flags.window || flags.windowId || process.env.HARNESS_WF_BROWSER_WINDOW_ID || '';
  const leaseId = flags.lease || flags.leaseId || process.env.HARNESS_WF_BROWSER_LEASE_ID || '';
  if (!runId) throw new Error('Missing --run <runId> or HARNESS_WF_BROWSER_RUN_ID.');
  if (!windowId) throw new Error('Missing --window <windowId> or HARNESS_WF_BROWSER_WINDOW_ID.');
  if (!leaseId) throw new Error('Missing --lease <leaseId> or HARNESS_WF_BROWSER_LEASE_ID.');

  const primitives = browserSnapshotPrimitives(flags);
  const agentId = flags.agent || flags.agentId || process.env.HARNESS_PEER_SESSION_ID || 'agent-unknown';
  const startedAt = new Date().toISOString();
  let connection = null;
  try {
    const connections = await browserConnections(flags);
    connection = (connections.connections || []).find(item => item.runId === runId && item.windowId === windowId) || null;
  } catch { /* command loop reports disconnected windows */ }

  const results = [];
  const baseCommandId = flags.command || flags.commandId || '';
  for (let index = 0; index < primitives.length; index += 1) {
    const primitive = primitives[index];
    const itemStartedAt = Date.now();
    try {
      const output = await browserCommand({
        ...flags,
        primitive,
        run: runId,
        window: windowId,
        lease: leaseId,
        agent: agentId,
        command: baseCommandId ? `${baseCommandId}-${String(index + 1).padStart(2, '0')}` : undefined,
        commandId: undefined,
      });
      results.push({
        primitive,
        ok: true,
        status: output.command?.status || 'ok',
        commandId: output.command?.commandId || '',
        artifact: output.artifact || null,
        durationMs: Date.now() - itemStartedAt,
      });
    } catch (err) {
      const failed = {
        primitive,
        ok: false,
        status: 'failed',
        error: err?.message || 'Snapshot primitive failed',
        durationMs: Date.now() - itemStartedAt,
      };
      results.push(failed);
      if (trueFlag(flags.strict)) throw err;
    }
  }

  const artifacts = results.map(item => item.artifact).filter(Boolean);
  return {
    ok: results.every(item => item.ok),
    runId,
    windowId,
    leaseId,
    agentId,
    startedAt,
    completedAt: new Date().toISOString(),
    connection,
    primitives,
    results,
    artifacts,
  };
}

async function findAgent(flags) {
  const cp = workflowApiControlPlane(flags, 'find-agent');
  const params = new URLSearchParams();
  for (const key of ['role', 'runtime', 'provider', 'capability', 'title']) {
    if (flags[key]) params.set(key, String(flags[key]));
  }
  const from = flags.from || flags['from-node'] || process.env.HARNESS_WORKFLOW_NODE_ID || '';
  if (from) params.set('from', from);
  if (trueFlag(flags.connect) || trueFlag(flags['auto-connect'])) params.set('autoConnect', '1');
  const qs = params.toString();
  return apiJson(cp.url, cp.token || cp.readToken, `/api/workflow/agents/find${qs ? `?${qs}` : ''}`, {
    actorNodeId: process.env.HARNESS_WORKFLOW_NODE_ID || '',
    actorSessionId: process.env.HARNESS_PEER_SESSION_ID || '',
  });
}

async function agentRoleProfile(projectRoot, flags) {
  const nodeId = flags.node || flags.id || flags.session
    || process.env.HARNESS_WORKFLOW_NODE_ID || '';
  if (!nodeId) throw new Error('Missing --node <agentNodeId> for agent-role-profile.');
  const cp = controlPlane(flags);
  if (cp.url) {
    return apiJson(cp.url, cp.token || cp.readToken, `/api/workflow/agents/profile?nodeId=${encodeURIComponent(nodeId)}`, {
      actorNodeId: process.env.HARNESS_WORKFLOW_NODE_ID || '',
      actorSessionId: process.env.HARNESS_PEER_SESSION_ID || '',
    });
  }
  const jsonPath = path.join(projectRoot, 'Harness', 'a2a', 'agent-roles', `${nodeId}.json`);
  const mdPath = path.join(projectRoot, 'Harness', 'a2a', 'agent-roles', `${nodeId}.md`);
  const profile = readJson(jsonPath, null);
  const markdown = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
  return { ok: true, nodeId, profile, markdown };
}

async function deleteNode(projectRoot, flags) {
  return nodeMap(projectRoot, { ...flags, action: 'deleteNode' });
}

async function connectNodes(projectRoot, flags) {
  return nodeMap(projectRoot, { ...flags, action: 'connectNodes' });
}

function tail(projectRoot, flags) {
  const sessionId = flags.session || process.env.HARNESS_PEER_SESSION_ID;
  const found = allSessionDirs(projectRoot).find(session => session.sessionId === sessionId);
  if (!found) return { sessionId, entries: [] };
  const lines = Math.min(Math.max(Number(flags.lines || flags.tail || 80), 1), 1000);
  return {
    taskId: found.taskId,
    sessionId,
    entries: readJsonl(path.join(found.dir, 'terminal.jsonl')).slice(-lines),
  };
}

// ── Node manuals ─────────────────────────────────────────────────────────────
// `manuals <nodeType>` prints the node manual JSON
// (Harness/a2a/skills/workflow-<type>-node.json) verbatim plus a generated
// `commands` section derived from the shared action registry
// (actionsForNodeType), so the prose manual and the invocable action surface
// arrive together. `excalidraw` resolves to the diagram manual
// (workflow-diagram-node.json) exactly like the backend context layer's
// EXCALIDRAW_MANUAL_ALIAS; the registry stores excalidraw actions under
// nodeType 'excalidraw', so command generation works for both spellings.
const MANUAL_TYPES = [
  'agent',
  'markdown',
  'excalidraw',
  'file',
  'display',
  'timer',
  'goal',
  'skill-group',
  'mcp-connector',
  'github-trigger',
  'diagram',
];
const MANUAL_TYPE_ALIAS = { excalidraw: 'diagram' };

function resolveManualType(value) {
  const raw = String(value || '').trim();
  const type = raw.toLowerCase();
  if (!type) {
    throw new Error(`manuals requires a node type. Valid types: ${MANUAL_TYPES.join('|')}.`);
  }
  if (MANUAL_TYPE_ALIAS[type]) return MANUAL_TYPE_ALIAS[type];
  if (!MANUAL_TYPES.includes(type)) {
    throw new Error(`Unknown manual type "${raw}". Valid types: ${MANUAL_TYPES.join('|')}.`);
  }
  return type;
}

// Registry actions for a node type rendered as `id — summary` lines with the
// action example appended when present (mirrors backend actionsForNodeType).
function actionsForNodeTypeLines(registry, nodeType) {
  if (!registry || !Array.isArray(registry.actions)) return [];
  return registry.actions
    .filter(action => action && action.nodeType === nodeType)
    .map(action => {
      const summary = String(action.summary || '').trim().replace(/\.+$/, '');
      const base = `${action.id} — ${summary}`;
      return action.example ? `${base}. Example: ${action.example}` : base;
    });
}

function manuals(projectRoot, flags, args = []) {
  if (trueFlag(flags.list)) {
    return { ok: true, types: MANUAL_TYPES, alias: MANUAL_TYPE_ALIAS };
  }
  const type = resolveManualType(args[0] || flags.type || '');
  const manualPath = path.join(projectRoot, 'Harness', 'a2a', 'skills', `workflow-${type}-node.json`);
  const manual = readJson(manualPath, null);
  if (!manual) {
    throw new Error(`Manual not found for node type "${type}" at ${manualPath} (expected Harness/a2a/skills/workflow-${type}-node.json). Valid types: ${MANUAL_TYPES.join('|')}.`);
  }
  const registry = readJson(path.join(projectRoot, 'Harness', 'a2a', 'action-registry.json'), null);
  // The manual declares the node type it documents (the diagram manual
  // declares 'excalidraw'), so action generation follows the manual's own
  // nodeType — excalidraw/diagram spellings both resolve to the excalidraw
  // actions stored under that type in the registry.
  const actionType = manual.nodeType || type;
  return {
    ok: true,
    type,
    manualPath: manual.source || `Harness/a2a/skills/workflow-${type}-node.json`,
    manual,
    commands: actionsForNodeTypeLines(registry, actionType),
  };
}

async function main() {
  const { command, flags, args } = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(flags.project || process.cwd());
  if (command === 'help' || command === '--help' || trueFlag(flags.help)) {
    const helpCommand = command === 'help' || command === '--help' ? (flags.cmd || flags.command || args[0] || '') : command;
    if (trueFlag(flags.json)) {
      process.stdout.write(`${JSON.stringify(helpJsonFor(helpCommand, projectRoot), null, 2)}\n`);
      return;
    }
    process.stdout.write(`${helpTextFor(helpCommand)}\n`);
    return;
  }
  const handler = COMMAND_DISPATCH[command];
  if (handler) return print(await handler(projectRoot, flags, args));
  throw new Error('Usage: wf-ui-control.mjs self|snapshot|describe|create-agent|find-agent|agent-role-profile|send-input|send-key|key|delegate-agent|send-agent-message|broadcast-agent-message|read-agent-messages|read-agent|bridge-messages|browser-runs|browser-run|browser-window|browser-windows|browser-lease|browser-url|browser-allocate|browser-allocate-many|browser-open|browser-launches|browser-close|browser-wait|browser-release|browser-artifacts|browser-connections|browser-cleanup|browser-command|browser-snapshot|workflow-node-map|workflow-ontology|workflow-context|read-node|workflow-node-action|node-map|connect|delete-node|tail|manuals|manual [--project .]\nPass --help after a command for command-specific flags.');
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
