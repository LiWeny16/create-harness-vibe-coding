import fs from 'node:fs';
import path from 'node:path';
import { parseTaskCapsule, parseTaskList } from './task-parser.mjs';
import { RUNTIME_DEFINITIONS } from './runtime-detector.mjs';
import { listTerminalSessions, getSessionIndexSummary } from './terminal-store.mjs';
import { deleteComponentNode } from './component-node-store.mjs';
import { deleteCapabilityNode } from './workflow-capability-node-store.mjs';
import { deleteEventNode } from './workflow-event-node-store.mjs';
import { normalizeNodeConfig, recommendSkills } from './node-config-store.mjs';
import { componentNodeStatesForSnapshot, componentStateRefs, listLiveComponentNodes } from './component-node-store.mjs';
import { eventNodeStates, eventStateRefs, listEventNodes } from './workflow-event-node-store.mjs';
import { capabilityNodeStates, capabilityStateRefs, listCapabilityNodes } from './workflow-capability-node-store.mjs';
import { goalNodeStates, goalStateRefs, listGoalNodes } from './workflow-goal-node-store.mjs';
import { workflowOperationsSnapshot } from './workflow-operation-store.mjs';
import { buildAgentContext } from './workflow-agent-context.mjs';
import { listRoleProfiles } from './workflow-node-types/role-profile-store.mjs';

const DEFAULT_ROLE_GRAPH = {
  schemaVersion: 1,
  rootAgentId: 'ceo',
  agents: [
    {
      agentId: 'ceo',
      role: 'CEO Leader',
      level: 0,
      kind: 'controller',
      skills: ['wf', 'subagent-orchestrator', 'terminal-control', 'workflow-node-map', 'workflow-ontology', 'workflow-context', 'workflow-node-actions'],
      permissions: ['plan', 'dispatch', 'read-terminals', 'send-terminal-input'],
    },
    {
      agentId: 'product-manager',
      role: 'Product Manager',
      level: 1,
      kind: 'planner',
      skills: ['product-shape', 'acceptance'],
      permissions: ['read-state', 'define-ac'],
    },
    {
      agentId: 'architect',
      role: 'Architect',
      level: 1,
      kind: 'architecture',
      skills: ['architecture', 'contracts'],
      permissions: ['read-code', 'define-contracts'],
    },
    {
      agentId: 'backend-expert',
      role: 'Backend Expert',
      level: 1,
      kind: 'implementer',
      skills: ['runtime-detection', 'terminal-control', 'workflow-node-map', 'workflow-ontology', 'workflow-context', 'workflow-node-actions', 'a2a-files'],
      permissions: ['read-code', 'write-backend', 'terminal-io'],
    },
    {
      agentId: 'frontend-expert',
      role: 'Frontend Expert',
      level: 1,
      kind: 'implementer',
      skills: ['ui-control-plane'],
      permissions: ['read-code', 'write-ui'],
    },
    {
      agentId: 'reviewer',
      role: 'Reviewer',
      level: 1,
      kind: 'review',
      skills: ['wf-review'],
      permissions: ['read-code', 'read-evidence'],
    },
    {
      agentId: 'verifier',
      role: 'Verifier',
      level: 1,
      kind: 'validation',
      skills: ['wf-browser', 'test-runner'],
      permissions: ['run-tests', 'read-evidence'],
    },
    {
      agentId: 'terminal-controller',
      role: 'Terminal Controller',
      level: 1,
      kind: 'runtime',
      skills: ['terminal-control', 'workflow-node-map', 'workflow-ontology', 'workflow-context', 'workflow-node-actions'],
      permissions: ['read-terminals', 'send-terminal-input'],
    },
  ],
  edges: [
    { from: 'ceo', to: 'product-manager', relation: 'defines' },
    { from: 'ceo', to: 'architect', relation: 'routes' },
    { from: 'ceo', to: 'backend-expert', relation: 'dispatches' },
    { from: 'ceo', to: 'frontend-expert', relation: 'dispatches' },
    { from: 'ceo', to: 'reviewer', relation: 'requests-review' },
    { from: 'ceo', to: 'verifier', relation: 'requests-evidence' },
    { from: 'ceo', to: 'terminal-controller', relation: 'controls' },
  ],
};

const DEFAULT_TERMINAL_CONTROL_SKILL = {
  schemaVersion: 1,
  skillId: 'terminal-control',
  name: 'Terminal Control',
  source: 'Harness/a2a/skills/terminal-control.json',
  description: 'Bounded A2A tools for listing terminal sessions, reading output ranges, globbing terminal events, and attach-gated input forwarding.',
  triggers: [
    'list sessions',
    'read terminal',
    'read transcript',
    'tail output',
    'send input',
    'send agent message',
    'broadcast agent message',
    'delegate agent',
    'agent messages',
    'read agent output',
    'bridge messages',
    'terminal events',
  ],
  tools: [
    { name: 'list-sessions', reads: ['Harness/tasks/**/sessions/**/STATE.json', 'Harness/a2a/sessions/**/STATE.json'] },
    { name: 'read-range', reads: ['Harness/tasks/**/sessions/**/terminal.jsonl', 'Harness/a2a/sessions/**/terminal.jsonl'], args: ['session', 'from', 'to', 'tail'] },
    { name: 'glob-events', reads: ['Harness/tasks/**/sessions/**/events.jsonl', 'Harness/a2a/sessions/**/events.jsonl'], args: ['pattern', 'since', 'limit'] },
    { name: 'send-input', writes: ['Harness/tasks/**/sessions/**/input-requests.jsonl', 'Harness/a2a/sessions/**/input-requests.jsonl'], args: ['session', 'text'] },
    { name: 'send-agent-message', writes: ['Harness/tasks/**/sessions/**/input-requests.jsonl', 'Harness/a2a/sessions/**/input-requests.jsonl', 'Harness/a2a/bridges/**'], args: ['to', 'text'] },
    { name: 'broadcast-agent-message', writes: ['Harness/tasks/**/sessions/**/input-requests.jsonl', 'Harness/a2a/sessions/**/input-requests.jsonl', 'Harness/a2a/bridges/**'], args: ['to', 'text', 'topic'] },
    { name: 'read-agent-messages', reads: ['Harness/a2a/bridges/**'], args: ['peer', 'tail'] },
    { name: 'delegate-agent', writes: ['Harness/tasks/**/sessions/**/input-requests.jsonl', 'Harness/a2a/sessions/**/input-requests.jsonl', 'Harness/a2a/bridges/**'], args: ['node', 'text'] },
    { name: 'read-agent', reads: ['Harness/tasks/**/sessions/**/terminal.jsonl', 'Harness/a2a/sessions/**/terminal.jsonl'], args: ['node', 'action'] },
  ],
  defaultMode: 'watch',
  inputPolicy: 'attach-mode-required',
};

const DEFAULT_WORKFLOW_SKILL_ENVIRONMENT = [
  'HARNESS_PEER_SESSION_ID',
  'HARNESS_PEER_RUNTIME',
  'HARNESS_AGENT_KIND',
  'HARNESS_WORKFLOW_MODE',
  'HARNESS_WORKFLOW_NODE_ID',
  'HARNESS_WORKFLOW_MAP',
  'HARNESS_NODE_HOME',
  'HARNESS_NODE_INIT',
  'HARNESS_WF_UI_URL',
];

const DEFAULT_WORKFLOW_NODE_MAP_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-node-map',
  name: 'Workflow Node Map',
  source: 'Harness/a2a/skills/workflow-node-map.json',
  description: 'Canonical API-only workflow node-map read and mutation commands for Main Agent nodes.',
  triggers: [
    'read graph',
    'create node',
    'connect nodes',
    'disconnect nodes',
    'move node',
    'delete node',
    'spawn agent node',
    'delegate worker',
    'control canvas',
    'arrange workflow',
    '控制画布',
    '连接节点',
    '删除节点',
    '连接状态',
    '连线',
    '谁连着',
  ],
  commands: [
    {
      name: 'workflow-node-map-read',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-map --action readGraph',
      description: 'Main Agent only. Read the graph through the typed backend Agent action and record an operation.',
    },
    {
      name: 'workflow-node-map-create',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-map --action createNode --type markdown --title "..."',
      description: 'Main Agent only. Create workflow nodes through POST /api/workflow/nodes/:actor/actions/agent.createNode.',
    },
    {
      name: 'workflow-node-map-connect',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-map --action connectNodes --from <nodeOrSession> --to <nodeOrSession>',
      description: 'Main Agent only. Connect nodes through POST /api/workflow/nodes/:actor/actions/agent.connectNodes.',
    },
    {
      name: 'workflow-node-map-disconnect',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-map --action disconnectNodes --edge <edgeId>',
      description: 'Main Agent only. Disconnect nodes through POST /api/workflow/nodes/:actor/actions/agent.disconnectNodes.',
    },
    {
      name: 'workflow-node-map-move',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-map --action moveNode --node <nodeId> --x 0 --y 0',
      description: 'Main Agent only. Move a node through POST /api/workflow/nodes/:actor/actions/agent.moveNode.',
    },
    {
      name: 'workflow-node-map-delete',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-map --action deleteNode --node <nodeIdOrSessionId>',
      description: 'Main Agent only. Delete or hide one node through POST /api/workflow/nodes/:actor/actions/agent.deleteNode.',
    },
    {
      name: 'workflow-node-map-delete-all',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-map --action deleteNodes --all true',
      description: 'Main Agent only. Delete or hide all allowed nodes through agent.deleteNodes. The actor and live Agents are skipped by default.',
    },
    {
      name: 'create-agent',
      command: 'node Harness/scripts/wf-ui-control.mjs create-agent --agent-kind subagent --runtime claude --objective "..."',
      description: 'Main Agent only. Create a managed PTY node through wf-ui.',
    },
    {
      name: 'connect-agent-worker',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-map --action connectNodes --from <mainAgentNodeId> --to <workerAgentNodeId> --relation delegation',
      description: 'Main Agent only. Connect a managed Agent worker so it appears in connectedAgentRefs and can be delegated with delegate-agent.',
    },
    {
      name: 'legacy-node-map',
      command: 'node Harness/scripts/wf-ui-control.mjs node-map --action readGraph',
      description: 'Compatibility alias. Prefer workflow-node-map for new Agent prompts and skills.',
    },
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    mainAgent: [
      'api-only-node-map-control',
      'no-direct-workflow-map-writes',
      'workflow-node-map',
      'read-workflow-map-diagnostic-only',
      'agent.readGraph',
      'agent.createNode',
      'agent.connectNodes',
      'agent.disconnectNodes',
      'agent.moveNode',
      'agent.deleteNode',
      'agent.deleteNodes',
      'create-subagent-node',
      'connect-agent-worker',
      'connect-managed-nodes',
      'delete-saved-node',
      'stop-managed-node',
    ],
    subagent: ['read-workflow-map-diagnostic-only', 'return-evidence'],
    subagentDenied: ['create-agent-node', 'create-task-node', 'workflow-node-map-control', 'node-map-control', 'workflow-map-file-mutation', 'spawn-pty-subagents'],
    denied: ['no-source-file-reads-for-graph-state'],
  },
};

const DEFAULT_WORKFLOW_CONTEXT_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-context',
  name: 'Workflow Context',
  source: 'Harness/a2a/skills/workflow-context.json',
  description: 'Canonical read-only workflow context commands for Agent nodes. Uses GET /api/workflow/context/:node for connected refs.',
  triggers: [
    'read context',
    'workflow context',
    'node map context',
    'graph context',
    'connected nodes',
    'what am I connected to',
    'what is connected',
    'nearby nodes',
    'linked nodes',
    'connected resources',
    'connected agents',
    'connected peers',
    'goal refs',
    'goal node',
    'timer refs',
    'timer node',
    'agent node',
    'node identity',
    'current node',
    'current task',
    'current goal',
    'workflow status',
    'edge refs',
    'handle refs',
    'port refs',
    'magnet dock',
    'resource node',
    'output node',
    'effective skills',
    'where am I',
    'observe before acting',
    '感知节点',
    '读取上下文',
    '连接了什么',
    '连接的节点',
    '周围节点',
    '节点身份',
    '当前节点',
    '当前任务',
    '当前目标',
    '磁吸连接',
    '连接状态',
    '是否有连接',
    '检查连接',
    '连线',
    '谁连着',
    '我连着',
    '自己连接',
    'node map 连接',
  ],
  commands: [
    {
      name: 'self',
      command: 'node Harness/scripts/wf-ui-control.mjs self',
      description: 'Print this PTY node identity and workflow environment.',
    },
    {
      name: 'describe',
      command: 'node Harness/scripts/wf-ui-control.mjs describe',
      description: 'Read-only topology summary from the wf-ui snapshot when available. Local workflow-map fallback is diagnostic only.',
    },
    {
      name: 'snapshot',
      command: 'node Harness/scripts/wf-ui-control.mjs snapshot',
      description: 'Read the complete wf-ui workflow snapshot. Do not mutate node-map files from this output.',
    },
    {
      name: 'workflow-context-self',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-context',
      description: 'Read this node context, including connected peers, connectedAgentRefs, connectedResourceRefs, connectedGoalRefs, connectedEventRefs, connectedCapabilityRefs, and effectiveSkills.',
    },
    {
      name: 'workflow-context-node',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-context --node <graphNodeIdOrSessionId>',
      description: 'Read another workflow node context through GET /api/workflow/context/:node.',
    },
    {
      name: 'bridge-messages',
      command: 'node Harness/scripts/wf-ui-control.mjs bridge-messages --from <sessionId> --to <sessionId>',
      description: 'Main Agent only. Read the recorded wf-bridge conversation between two managed sessions.',
    },
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    mainAgent: [
      'workflow-context',
      'read-connected-context',
      'read-workflow-snapshot',
      'read-workflow-map-diagnostic-only',
      'read-bridge-messages',
    ],
    subagent: [
      'workflow-context',
      'read-self-context',
      'read-workflow-map-diagnostic-only',
      'return-evidence',
    ],
    denied: [
      'no-source-file-reads-for-graph-state',
      'workflow-map-file-mutation',
      'component-state-file-mutation',
      'event-state-file-mutation',
      'goal-state-file-mutation',
      'capability-state-file-mutation',
      'direct-json-state-mutation',
      'node-home-file-mutation',
      'task-state-mutation',
    ],
  },
};

const DEFAULT_WORKFLOW_ONTOLOGY_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-ontology',
  name: 'Workflow Ontology',
  source: 'Harness/a2a/skills/workflow-ontology.json',
  description: 'Canonical read-only semantic model for Agent nodes. Uses GET /api/workflow/ontology so Agents understand node classes, relations, and action affordances before acting.',
  triggers: [
    'workflow semantics',
    'node ontology',
    'node classes',
    'relation semantics',
    'action affordances',
    'choose capability',
    'choose connected node',
    'before acting',
    '语义',
    '节点能力',
  ],
  commands: [
    {
      name: 'workflow-ontology',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-ontology',
      description: 'Read the workflow ontology: node classes, relation semantics, action rules, and Agent operation language.',
    },
    {
      name: 'workflow-context-after-ontology',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-context',
      description: 'Read this Agent context after loading the ontology. Context should be interpreted through connected refs and affordances, not raw graph shape alone.',
    },
    {
      name: 'workflow-node-action-after-ontology',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <graphNodeIdOrSessionId> --action <type.action>',
      description: 'Only run typed node actions that the ontology/context affordances allow for the acting Agent and edge relation.',
    },
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    mainAgent: [
      'workflow-ontology',
      'read-semantic-node-model',
      'read-action-affordances',
      'read-before-acting',
      'prefer-connected-resource-output',
      'prefer-typed-backend-actions',
    ],
    subagent: [
      'workflow-ontology',
      'read-semantic-node-model',
      'return-evidence',
    ],
    denied: [
      'workflow-map-file-mutation',
      'component-state-file-mutation',
      'event-state-file-mutation',
      'capability-state-file-mutation',
      'goal-state-file-mutation',
      'task-state-mutation',
      'invented-node-actions',
    ],
  },
};

const DEFAULT_WORKFLOW_NODE_ACTIONS_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-node-actions',
  name: 'Workflow Node Actions',
  source: 'Harness/a2a/skills/workflow-node-actions.json',
  description: 'Canonical typed node action command surface. Uses POST /api/workflow/nodes/:node/actions/:action.',
  triggers: [
    'node action',
    'write markdown',
    'append markdown',
    'draw diagram',
    'draw flowchart',
    'update excalidraw',
    'render preview',
    'read timer',
    'configure timer',
    'timer interval',
    'timer control',
    'start timer',
    'stop timer',
    'update goal',
    'send agent message',
    'broadcast agent message',
    'reply agent',
    'read bridge messages',
    'shared markdown context',
    'agent direct message',
    'agent group message',
    '发送消息',
    '群发消息',
    '回复 Agent',
    '共享上下文',
    '共享 Markdown',
    'delegate agent',
    'read agent output',
    '绘制流程图',
    '写入节点',
    '回读节点',
  ],
  commands: [
    {
      name: 'workflow-node-action',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <graphNodeIdOrSessionId> --action <type.action>',
      description: 'Run a typed backend node action with optional --payload JSON. The CLI includes actorNodeId from the Agent environment when available.',
    },
    {
      name: 'markdown-read',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <markdownNodeId> --action markdown.read',
      description: 'Read Markdown node content through the typed Markdown adapter.',
    },
    {
      name: 'markdown-replace',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <markdownNodeId> --action markdown.replace --payload "{\\"markdown\\":\\"...\\"}"',
      description: 'Replace connected Markdown node content. Prefer this for durable text output when a writable Markdown node is connected.',
    },
    {
      name: 'markdown-append',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <markdownNodeId> --action markdown.append --payload "{\\"markdown\\":\\"...\\"}"',
      description: 'Append to connected Markdown node content for incremental notes or reports.',
    },
    {
      name: 'excalidraw-read-scene',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <excalidrawNodeId> --action excalidraw.readScene',
      description: 'Read connected Excalidraw scene content through the typed Excalidraw adapter.',
    },
    {
      name: 'excalidraw-save-scene',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <excalidrawNodeId> --action excalidraw.saveScene --payload "{\\"scene\\":{\\"elements\\":[],\\"appState\\":{},\\"files\\":{}}}"',
      description: 'Replace connected Excalidraw scene content. Prefer this for diagrams, flowcharts, visual plans, and sketches when a writable Excalidraw node is connected.',
    },
    {
      name: 'excalidraw-patch-scene',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <excalidrawNodeId> --action excalidraw.patchScene --payload "{\\"patch\\":{\\"elements\\":[]}}"',
      description: 'Patch connected Excalidraw scene content for incremental diagram updates.',
    },
    {
      name: 'timer-configure',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <timerNodeId> --action timer.configure --payload "{\\"schedule\\":{}}"',
      description: 'Configure Timer metadata through the typed Timer adapter. Agent-authored timer.configure requires a control edge and must never edit Harness/a2a/event-nodes/**/state.json directly.',
    },
    {
      name: 'timer-read',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <timerNodeId> --action timer.read',
      description: 'Read Timer state through the typed Timer adapter.',
    },
    {
      name: 'timer-set-interval',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <timerNodeId> --action timer.setInterval --payload "{\\"intervalSeconds\\":120,\\"lane\\":\\"base\\"}"',
      description: 'Set the Timer interval through the backend Timer adapter. Requires connectedEventRefs[].allowedActions to include timer.setInterval.',
    },
    {
      name: 'timer-enable',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <timerNodeId> --action timer.enable',
      description: 'Start or resume a Timer through the backend Timer adapter. Requires a Timer control edge for Agent-authored actions.',
    },
    {
      name: 'timer-disable',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <timerNodeId> --action timer.disable',
      description: 'Stop a Timer through the backend Timer adapter. Requires a Timer control edge and controlPolicy.agentCanDisable.',
    },
    {
      name: 'goal-update',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <goalNodeId> --action goal.update --payload "{\\"nextAction\\":\\"...\\",\\"planItems\\":[{\\"id\\":\\"P-001\\",\\"text\\":\\"...\\",\\"status\\":\\"todo\\"}]}"',
      description: 'Update editable Goal metadata and Agent-authored plan items through the typed Goal adapter. Agent-authored goal.update requires a linked Goal edge.',
    },
    {
      name: 'send-input',
      command: 'node Harness/scripts/wf-ui-control.mjs send-input --session <sessionId> --text "..."',
      description: 'Main Agent only. Send terminal input to a managed PTY node and record a wf-bridge message.',
    },
    {
      name: 'send-agent-message',
      command: 'node Harness/scripts/wf-ui-control.mjs send-agent-message --to <agentNodeIdOrSessionId> --text "..."',
      description: 'Send a one-to-one message from this Agent node to a connected Agent node through agent.sendMessage and record a wf-bridge envelope.',
    },
    {
      name: 'broadcast-agent-message',
      command: 'node Harness/scripts/wf-ui-control.mjs broadcast-agent-message --text "..." --topic <topic>',
      description: 'Broadcast one message from this Agent node to connected Agent nodes, or to an explicit --to list, through agent.broadcastMessage.',
    },
    {
      name: 'read-agent-messages',
      command: 'node Harness/scripts/wf-ui-control.mjs read-agent-messages --peer <agentNodeIdOrSessionId> --tail 80',
      description: 'Read recorded wf-bridge message envelopes between this Agent node and a connected peer.',
    },
    {
      name: 'delegate-agent',
      command: 'node Harness/scripts/wf-ui-control.mjs delegate-agent --node <agentNodeIdOrSessionId> --text "..."',
      description: 'Main Agent only. Delegate work to a connected Agent node by graph node id or session id through agent.sendInput.',
    },
    {
      name: 'read-agent',
      command: 'node Harness/scripts/wf-ui-control.mjs read-agent --node <agentNodeIdOrSessionId> --action output --tail 80',
      description: 'Read a connected Agent node output, transcript, or context through typed agent.readOutput/readTranscript/readContext.',
    },
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    mainAgent: [
      'workflow-node-actions',
      'typed-backend-node-actions',
      'read-before-mutating',
      'verify-connected-context',
      'prefer-connected-resource-output',
      'prefer-connected-agent-workers',
      'prefer-agent-message-actions',
      'prefer-shared-markdown-context',
      'api-only-node-state-control',
      'timer-typed-actions',
      'send-terminal-input',
    ],
    subagent: [
      'read-actions-only-when-authorized',
      'send-message-to-connected-agent-peers',
      'reply-through-agent-message-actions',
      'return-evidence',
    ],
    denied: [
      'no-source-file-reads-for-graph-state',
      'workflow-map-file-mutation',
      'component-state-file-mutation',
      'event-state-file-mutation',
      'direct-event-node-state-file-edit',
      'event-node-state-json-mutation',
      'capability-state-file-mutation',
      'goal-state-file-mutation',
      'direct-goal-node-state-file-edit',
      'direct-json-state-mutation',
      'task-state-mutation',
      'secret-payloads',
    ],
  },
};

const DEFAULT_WORKFLOW_TIMER_NODE_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-timer-node',
  name: 'Workflow Timer Node',
  source: 'Harness/a2a/skills/workflow-timer-node.json',
  description: 'On-demand Agent guide for controlling Timer nodes through typed backend actions only.',
  nodeType: 'timer',
  triggers: [
    'timer node',
    'timer control',
    'timer interval',
    'configure timer',
    'start timer',
    'stop timer',
    'timer countdown',
    'health check timer',
    'connected timer',
  ],
  controlSurface: {
    endpoint: 'POST /api/workflow/nodes/:node/actions/:action',
    readContextFirst: 'node Harness/scripts/wf-ui-control.mjs workflow-context --project .',
    storage: 'Harness/a2a/event-nodes/**/state.json is backend-owned diagnostic storage, never an Agent control surface.',
    connectionRequirement: 'Agent-authored Timer control requires an Agent -> Timer relation=control edge. Timer -> Agent relation=event only delivers events.',
  },
  commands: [
    {
      name: 'timer-context',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-context --project .',
      description: 'Read connectedEventRefs and confirm canControl/allowedActions before controlling a Timer.',
    },
    {
      name: 'timer-read',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <timerNodeId> --action timer.read --project .',
      description: 'Read Timer state through the backend Timer adapter.',
    },
    {
      name: 'timer-set-interval',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <timerNodeId> --action timer.setInterval --payload "{\\"intervalSeconds\\":120,\\"lane\\":\\"base\\"}" --project .',
      description: 'Set base loop interval through the backend. Requires connectedEventRefs[].allowedActions to include timer.setInterval.',
    },
    {
      name: 'timer-enable',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <timerNodeId> --action timer.enable --project .',
      description: 'Start or resume Timer scheduling through the backend.',
    },
    {
      name: 'timer-disable',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <timerNodeId> --action timer.disable --project .',
      description: 'Stop Timer scheduling through the backend. Requires controlPolicy.agentCanDisable.',
    },
    {
      name: 'timer-set-mode',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <timerNodeId> --action timer.setMode --payload "{\\"mode\\":\\"loop\\"}" --project .',
      description: 'Change Timer schedule mode through the backend when policy allows.',
    },
    {
      name: 'timer-ack-watchdog',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <timerNodeId> --action timer.ackWatchdog --payload "{\\"now\\":\\"<iso>\\"}" --project .',
      description: 'Acknowledge Timer watchdog through the backend when policy allows.',
    },
    {
      name: 'timer-reset-watchdog',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <timerNodeId> --action timer.resetWatchdog --payload "{\\"now\\":\\"<iso>\\"}" --project .',
      description: 'Reset Timer watchdog state through the backend when policy allows.',
    },
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    allowed: ['timer.read', 'timer.configure', 'timer.enable', 'timer.disable', 'timer.setInterval', 'timer.setMode', 'timer.ackWatchdog', 'timer.resetWatchdog'],
    requires: ['workflow-context-before-action', 'timer-control-edge-for-agent-actions', 'typed-backend-node-actions'],
    denied: [
      'direct-event-node-state-file-edit',
      'event-node-state-json-mutation',
      'direct-json-state-mutation',
      'workflow-map-file-mutation',
      'invented-timer-actions',
    ],
  },
};

const DEFAULT_WORKFLOW_GOAL_NODE_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-goal-node',
  name: 'Workflow Goal Node',
  source: 'Harness/a2a/skills/workflow-goal-node.json',
  description: 'On-demand Agent guide for reading and updating Goal nodes through typed backend actions only.',
  nodeType: 'goal',
  triggers: [
    'goal node',
    'goal update',
    'acceptance',
    'request completion',
    'return to work',
    'goal watchdog',
    'connected goal',
  ],
  controlSurface: {
    endpoint: 'POST /api/workflow/nodes/:node/actions/:action',
    readContextFirst: 'node Harness/scripts/wf-ui-control.mjs workflow-context --project .',
    storage: 'Goal/task state sidecars are backend-owned diagnostic storage, never an Agent control surface.',
    connectionRequirement: 'Agent-authored Goal edits require a linked bidirectional goal edge.',
  },
  commands: [
    {
      name: 'goal-read',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <goalNodeId> --action goal.read --project .',
      description: 'Read Goal state through the backend Goal adapter.',
    },
    {
      name: 'goal-update',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <goalNodeId> --action goal.update --payload "{\\"nextAction\\":\\"...\\",\\"planItems\\":[{\\"id\\":\\"P-001\\",\\"text\\":\\"...\\",\\"status\\":\\"todo\\"}]}" --project .',
      description: 'Update editable Goal metadata and Agent-authored plan items through the backend.',
    },
    {
      name: 'goal-request-completion',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <goalNodeId> --action goal.requestCompletion --payload "{\\"evidenceRefs\\":[\\"...\\"],\\"note\\":\\"...\\"}" --project .',
      description: 'Request Goal completion without directly completing task state.',
    },
    {
      name: 'goal-return-to-work',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <goalNodeId> --action goal.returnToWork --payload "{\\"note\\":\\"...\\"}" --project .',
      description: 'Return a proposed-complete Goal to active work through the backend.',
    },
    {
      name: 'goal-ack-watchdog',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <goalNodeId> --action goal.ackWatchdog --payload "{\\"timerNodeId\\":\\"<timerNodeId>\\"}" --project .',
      description: 'Acknowledge Goal watchdog state through the backend.',
    },
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    allowed: ['goal.read', 'goal.update', 'goal.requestCompletion', 'goal.returnToWork', 'goal.ackWatchdog', 'goal.add', 'goal.delete', 'goal.replace', 'goal.check', 'goal.uncheck', 'goal.complete', 'goal.reopen'],
    requires: ['workflow-context-before-action', 'linked-goal-edge-for-agent-actions', 'typed-backend-node-actions'],
    denied: [
      'direct-goal-node-state-file-edit',
      'goal-node-state-json-mutation',
      'task-state-mutation',
      'direct-json-state-mutation',
      'workflow-map-file-mutation',
    ],
  },
};

const DEFAULT_WORKFLOW_AGENT_NODE_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-agent-node',
  name: 'Workflow Agent Node',
  source: 'Harness/a2a/skills/workflow-agent-node.json',
  description: 'On-demand Agent guide for delegating to and reading connected Agent nodes through backend and wf-bridge actions.',
  nodeType: 'agent',
  triggers: [
    'agent node',
    'delegate agent',
    'send agent message',
    'broadcast agent message',
    'reply agent',
    'agent direct message',
    'agent group message',
    'shared context',
    '发送消息',
    '群发消息',
    '回复 Agent',
    '共享上下文',
    '共享 Markdown',
    'read agent output',
    'read transcript',
    'start agent',
    'stop agent',
    'connected agent',
  ],
  controlSurface: {
    sendMessage: 'POST /api/workflow/nodes/:sender/actions/agent.sendMessage',
    broadcastMessage: 'POST /api/workflow/nodes/:sender/actions/agent.broadcastMessage',
    readMessages: 'POST /api/workflow/nodes/:sender/actions/agent.readMessages',
    sendInput: 'POST /api/workflow/nodes/:node/actions/agent.sendInput',
    readOutput: 'POST /api/workflow/nodes/:node/actions/agent.readOutput',
    bridge: 'wf-bridge routes record Agent-to-Agent communication.',
    storage: 'Harness/a2a/nodes/** and terminal logs are runtime records, not manual control surfaces.',
  },
  commands: [
    {
      name: 'agent-context',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-context --node <agentNodeIdOrSessionId> --project .',
      description: 'Read a connected Agent node context through the backend.',
    },
    {
      name: 'delegate-agent',
      command: 'node Harness/scripts/wf-ui-control.mjs delegate-agent --node <agentNodeIdOrSessionId> --text "..." --project .',
      description: 'Delegate work to a connected Agent node through agent.sendInput.',
    },
    {
      name: 'send-agent-message',
      command: 'node Harness/scripts/wf-ui-control.mjs send-agent-message --to <agentNodeIdOrSessionId> --text "..." --project .',
      description: 'Send a direct connected Agent-to-Agent message through agent.sendMessage. Use this for replies as well as first contact.',
    },
    {
      name: 'broadcast-agent-message',
      command: 'node Harness/scripts/wf-ui-control.mjs broadcast-agent-message --text "..." --topic <topic> --project .',
      description: 'Broadcast a message to all connected Agent peers, or pass --to a,b,c for an explicit connected group.',
    },
    {
      name: 'read-agent-messages',
      command: 'node Harness/scripts/wf-ui-control.mjs read-agent-messages --peer <agentNodeIdOrSessionId> --tail 80 --project .',
      description: 'Read recorded wf-bridge message envelopes between this Agent and a connected peer.',
    },
    {
      name: 'read-agent-output',
      command: 'node Harness/scripts/wf-ui-control.mjs read-agent --node <agentNodeIdOrSessionId> --action output --tail 80 --project .',
      description: 'Read connected Agent output through typed backend routes.',
    },
    {
      name: 'read-agent-transcript',
      command: 'node Harness/scripts/wf-ui-control.mjs read-agent --node <agentNodeIdOrSessionId> --action transcript --tail 120 --project .',
      description: 'Read connected Agent transcript through typed backend routes.',
    },
    {
      name: 'bridge-messages',
      command: 'node Harness/scripts/wf-ui-control.mjs bridge-messages --from <sessionId> --to <sessionId> --project .',
      description: 'Read recorded wf-bridge messages between managed sessions.',
    },
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    allowed: ['agent.readContext', 'agent.readOutput', 'agent.readTranscript', 'agent.sendMessage', 'agent.broadcastMessage', 'agent.readMessages', 'agent.sendInput'],
    requires: ['connected-agent-ref', 'typed-backend-agent-actions'],
    denied: [
      'node-home-file-mutation',
      'terminal-log-mutation',
      'session-state-file-mutation',
      'direct-json-state-mutation',
      'unmanaged-pty-spawn',
    ],
  },
};

const DEFAULT_WORKFLOW_RESOURCE_NODE_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-resource-node',
  name: 'Workflow Resource Node',
  source: 'Harness/a2a/skills/workflow-resource-node.json',
  description: 'On-demand Agent guide for File, Markdown, and Excalidraw resource nodes through typed backend actions only.',
  nodeType: 'resource',
  triggers: [
    'resource node',
    'markdown node',
    'file node',
    'diagram node',
    'excalidraw node',
    'connected output',
    'write notes',
    'draw diagram',
  ],
  controlSurface: {
    endpoint: 'POST /api/workflow/nodes/:node/actions/:action',
    readContextFirst: 'node Harness/scripts/wf-ui-control.mjs workflow-context --project .',
    storage: 'Harness/a2a/component-nodes/**/state.json is backend-owned diagnostic storage, never an Agent control surface.',
    outputRouting: 'Prefer connected writable resource nodes over terminal prose for durable output.',
  },
  commands: [
    {
      name: 'markdown-read',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <markdownNodeId> --action markdown.read --project .',
      description: 'Read Markdown content through the backend Markdown adapter.',
    },
    {
      name: 'markdown-replace',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <markdownNodeId> --action markdown.replace --payload "{\\"markdown\\":\\"...\\"}" --project .',
      description: 'Replace Markdown content through the backend Markdown adapter.',
    },
    {
      name: 'markdown-append',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <markdownNodeId> --action markdown.append --payload "{\\"markdown\\":\\"...\\"}" --project .',
      description: 'Append Markdown content through the backend Markdown adapter.',
    },
    {
      name: 'excalidraw-save-scene',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <excalidrawNodeId> --action excalidraw.saveScene --payload "{\\"scene\\":{\\"elements\\":[],\\"appState\\":{},\\"files\\":{}}}" --project .',
      description: 'Save an Excalidraw scene through the backend Excalidraw adapter.',
    },
    {
      name: 'file-read-text',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <fileNodeId> --action file.readText --payload "{\\"offset\\":0,\\"limit\\":8192}" --project .',
      description: 'Read bounded text from a File node through the backend File adapter.',
    },
    {
      name: 'file-read-meta',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <fileNodeId> --action file.readMeta --project .',
      description: 'Read File node metadata through the backend File adapter.',
    },
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    allowed: ['markdown.read', 'markdown.replace', 'markdown.append', 'markdown.patch', 'markdown.find', 'markdown.acquireLock', 'markdown.releaseLock', 'excalidraw.readScene', 'excalidraw.saveScene', 'excalidraw.patchScene', 'excalidraw.renderPreview', 'file.readMeta', 'file.readText', 'file.readBytes', 'file.refresh'],
    requires: ['workflow-context-before-action', 'typed-backend-node-actions'],
    denied: [
      'component-state-file-mutation',
      'direct-component-node-state-file-edit',
      'direct-json-state-mutation',
      'workflow-map-file-mutation',
      'secret-payloads',
    ],
  },
};

const DEFAULT_WORKFLOW_MARKDOWN_NODE_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-markdown-node',
  name: 'Workflow Markdown Node',
  source: 'Harness/a2a/skills/workflow-markdown-node.json',
  description: 'On-demand Agent guide for reading and writing Markdown nodes through typed backend actions only.',
  nodeType: 'markdown',
  triggers: [
    'markdown node',
    'write notes',
    'append markdown',
    'replace markdown',
    'connected markdown',
    'durable text output',
  ],
  controlSurface: {
    endpoint: 'POST /api/workflow/nodes/:node/actions/:action',
    readContextFirst: 'node Harness/scripts/wf-ui-control.mjs workflow-context --project .',
    storage: 'Harness/a2a/component-nodes/**/state.json is backend-owned diagnostic storage, never an Agent control surface.',
    outputRouting: 'Prefer connected writable Markdown nodes for durable notes, reports, task plans, and long-form text.',
  },
  commands: [
    {
      name: 'markdown-read',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <markdownNodeId> --action markdown.read --project .',
      description: 'Read Markdown content through the backend Markdown adapter.',
    },
    {
      name: 'markdown-append',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <markdownNodeId> --action markdown.append --payload "{\\"markdown\\":\\"...\\"}" --project .',
      description: 'Append Markdown content through the backend Markdown adapter.',
    },
    {
      name: 'markdown-replace',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <markdownNodeId> --action markdown.replace --payload "{\\"markdown\\":\\"...\\"}" --project .',
      description: 'Replace Markdown content through the backend Markdown adapter.',
    },
    {
      name: 'markdown-patch',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <markdownNodeId> --action markdown.patch --payload "{\\"patch\\":\\"...\\"}" --project .',
      description: 'Patch Markdown content through the backend when a patch payload is available.',
    },
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    allowed: ['markdown.read', 'markdown.append', 'markdown.replace', 'markdown.patch', 'markdown.find', 'markdown.acquireLock', 'markdown.releaseLock'],
    requires: ['workflow-context-before-action', 'connected-resource-ref', 'typed-backend-node-actions'],
    denied: [
      'component-state-file-mutation',
      'direct-component-node-state-file-edit',
      'direct-json-state-mutation',
      'workflow-map-file-mutation',
    ],
  },
};

const DEFAULT_WORKFLOW_DIAGRAM_NODE_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-diagram-node',
  name: 'Workflow Diagram Node',
  source: 'Harness/a2a/skills/workflow-diagram-node.json',
  description: 'On-demand Agent guide for reading and writing Excalidraw Diagram nodes through typed backend actions only.',
  nodeType: 'excalidraw',
  createKind: 'diagram',
  triggers: [
    'diagram node',
    'excalidraw node',
    'draw diagram',
    'draw flowchart',
    'save scene',
    'connected diagram',
    'visual output',
  ],
  controlSurface: {
    endpoint: 'POST /api/workflow/nodes/:node/actions/:action',
    readContextFirst: 'node Harness/scripts/wf-ui-control.mjs workflow-context --project .',
    storage: 'Harness/a2a/component-nodes/**/state.json is backend-owned diagnostic storage, never an Agent control surface.',
    outputRouting: 'Prefer connected writable Diagram nodes for flowcharts, sketches, architecture maps, and visual plans.',
  },
  commands: [
    {
      name: 'excalidraw-read-scene',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <diagramNodeId> --action excalidraw.readScene --project .',
      description: 'Read an Excalidraw scene through the backend Excalidraw adapter.',
    },
    {
      name: 'excalidraw-save-scene',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <diagramNodeId> --action excalidraw.saveScene --payload "{\\"scene\\":{\\"elements\\":[],\\"appState\\":{},\\"files\\":{}}}" --project .',
      description: 'Replace the Excalidraw scene through the backend Excalidraw adapter.',
    },
    {
      name: 'excalidraw-patch-scene',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <diagramNodeId> --action excalidraw.patchScene --payload "{\\"elements\\":[]}" --project .',
      description: 'Patch Excalidraw scene elements through the backend when a bounded patch is available.',
    },
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    allowed: ['excalidraw.readScene', 'excalidraw.saveScene', 'excalidraw.patchScene', 'excalidraw.renderPreview'],
    requires: ['workflow-context-before-action', 'connected-resource-ref', 'typed-backend-node-actions'],
    denied: [
      'component-state-file-mutation',
      'direct-component-node-state-file-edit',
      'direct-json-state-mutation',
      'workflow-map-file-mutation',
    ],
  },
};

const DEFAULT_WORKFLOW_FILE_NODE_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-file-node',
  name: 'Workflow File Node',
  source: 'Harness/a2a/skills/workflow-file-node.json',
  description: 'On-demand Agent guide for inspecting File nodes through typed backend actions only.',
  nodeType: 'file',
  triggers: [
    'file node',
    'read file',
    'file metadata',
    'workspace file',
    'uploaded file',
    'connected file',
  ],
  controlSurface: {
    endpoint: 'POST /api/workflow/nodes/:node/actions/:action',
    readContextFirst: 'node Harness/scripts/wf-ui-control.mjs workflow-context --project .',
    storage: 'Harness/a2a/component-nodes/**/state.json is backend-owned diagnostic storage, never an Agent control surface.',
    contentRoute: 'Use backend file/meta/text routes exposed by the File node adapter; do not infer absolute filesystem paths from state files.',
  },
  commands: [
    {
      name: 'file-read-meta',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <fileNodeId> --action file.readMeta --project .',
      description: 'Read File node metadata through the backend File adapter.',
    },
    {
      name: 'file-read-text',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <fileNodeId> --action file.readText --payload "{\\"offset\\":0,\\"limit\\":8192}" --project .',
      description: 'Read bounded text from a File node through the backend File adapter.',
    },
    {
      name: 'file-refresh',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-node-action --node <fileNodeId> --action file.refresh --project .',
      description: 'Refresh File node metadata through the backend when the underlying file may have changed.',
    },
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    allowed: ['file.readMeta', 'file.readText', 'file.readBytes', 'file.refresh'],
    requires: ['workflow-context-before-action', 'connected-resource-ref', 'typed-backend-node-actions'],
    denied: [
      'component-state-file-mutation',
      'direct-component-node-state-file-edit',
      'direct-json-state-mutation',
      'absolute-path-leakage',
      'secret-payloads',
    ],
  },
};

const DEFAULT_WORKFLOW_SKILL_GROUP_NODE_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-skill-group-node',
  name: 'Workflow Skill Group Node',
  source: 'Harness/a2a/skills/workflow-skill-group-node.json',
  description: 'On-demand Agent guide for using Skill group capability nodes as metadata capability providers.',
  nodeType: 'skill-group',
  triggers: [
    'skill group node',
    'skill bundle',
    'capability pack',
    'connected skill group',
    'attached skills',
  ],
  controlSurface: {
    endpoint: 'GET /api/workflow/context/:node',
    readContextFirst: 'node Harness/scripts/wf-ui-control.mjs workflow-context --project .',
    storage: 'Harness/a2a/capability-nodes/**/state.json is backend-owned diagnostic storage, never an Agent control surface.',
    executionModel: 'Skill group nodes advertise skills to connected Agents; they are not independent executors.',
  },
  commands: [
    {
      name: 'skill-group-context',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-context --project .',
      description: 'Read connectedCapabilityRefs and effectiveSkills contributed by connected Skill group nodes.',
    }
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    allowed: ['state:read', 'capability:read', 'skill.metadata.read'],
    requires: ['workflow-context-before-action', 'connected-capability-ref'],
    denied: [
      'capability-state-file-mutation',
      'direct-capability-node-state-file-edit',
      'direct-json-state-mutation',
      'independent-skill-execution',
      'secret-payloads',
    ],
  },
};

const DEFAULT_WORKFLOW_MCP_CONNECTOR_NODE_SKILL = {
  schemaVersion: 1,
  skillId: 'workflow-mcp-connector-node',
  name: 'Workflow MCP Connector Node',
  source: 'Harness/a2a/skills/workflow-mcp-connector-node.json',
  description: 'On-demand Agent guide for MCP connector nodes as metadata-only capability providers.',
  nodeType: 'mcp-connector',
  createKind: 'mcp',
  triggers: [
    'mcp connector node',
    'mcp node',
    'mcp tools',
    'mcp resources',
    'connected mcp',
    'capability provider',
  ],
  controlSurface: {
    endpoint: 'GET /api/workflow/context/:node',
    readContextFirst: 'node Harness/scripts/wf-ui-control.mjs workflow-context --project .',
    storage: 'Harness/a2a/capability-nodes/**/state.json is backend-owned diagnostic storage, never an Agent control surface.',
    executionModel: 'MCP connector nodes expose sanitized metadata only; direct tool invocation needs a separate permission/audit contract.',
  },
  commands: [
    {
      name: 'mcp-connector-context',
      command: 'node Harness/scripts/wf-ui-control.mjs workflow-context --project .',
      description: 'Read connectedCapabilityRefs for sanitized MCP connector metadata.',
    }
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: {
    allowed: ['state:read', 'capability:read', 'mcp.metadata.read'],
    requires: ['workflow-context-before-action', 'connected-capability-ref'],
    denied: [
      'capability-state-file-mutation',
      'direct-capability-node-state-file-edit',
      'direct-json-state-mutation',
      'mcp-tool-invocation-without-permission',
      'mcp-server-spawn',
      'secret-payloads',
    ],
  },
};

const DEFAULT_WF_UI_MAP_SKILL = {
  schemaVersion: 1,
  skillId: 'wf-ui-map',
  name: 'WF UI Map Legacy Alias',
  source: 'Harness/a2a/skills/wf-ui-map.json',
  compatibilityAliasFor: 'workflow-node-map',
  description: 'Compatibility alias for workflow-node-map. Prefer workflow-node-map in new Agent prompts; node-map remains supported for older nodes.',
  commands: [
    {
      name: 'node-map-read',
      command: 'node Harness/scripts/wf-ui-control.mjs node-map --action readGraph',
      description: 'Legacy alias for workflow-node-map --action readGraph.',
    },
    {
      name: 'node-map-connect',
      command: 'node Harness/scripts/wf-ui-control.mjs node-map --action connectNodes --from <nodeOrSession> --to <nodeOrSession>',
      description: 'Legacy alias for workflow-node-map --action connectNodes through POST /api/workflow/nodes/:actor/actions/agent.connectNodes.',
    },
    {
      name: 'node-map-delete',
      command: 'node Harness/scripts/wf-ui-control.mjs node-map --action deleteNode --node <nodeIdOrSessionId>',
      description: 'Legacy alias for workflow-node-map --action deleteNode through POST /api/workflow/nodes/:actor/actions/agent.deleteNode.',
    },
    {
      name: 'node-map-delete-all',
      command: 'node Harness/scripts/wf-ui-control.mjs node-map --action deleteNodes --all true',
      description: 'Legacy alias for workflow-node-map --action deleteNodes through agent.deleteNodes.',
    },
  ],
  environment: DEFAULT_WORKFLOW_SKILL_ENVIRONMENT,
  policy: DEFAULT_WORKFLOW_NODE_MAP_SKILL.policy,
};

const BUILT_IN_WORKFLOWS = [
  {
    id: 'wf-standard',
    command: '/wf',
    label: 'WF Standard',
    description: 'CEO-led workflow with A2A terminal orchestration and acceptance gates.',
    defaultCeoPrompt: 'Act as the Harness /wf CEO. Create a concise plan, choose terminal agents only when useful, coordinate A2A READ/WRITE/GLOB evidence, and keep task binding optional unless explicitly needed.',
  },
  {
    id: 'wf-max',
    command: '/wf-max',
    label: 'WF Max',
    description: 'Deeper CEO workflow for broader architecture and verification passes.',
    defaultCeoPrompt: 'Act as the Harness /wf-max CEO. Expand exploration only where it improves decisions, then coordinate terminal agents through Harness A2A evidence.',
  },
  {
    id: 'wf-browser',
    command: '/wf-browser',
    label: 'WF Browser',
    description: 'Browser verification workflow with terminal agents and E2E evidence.',
    defaultCeoPrompt: 'Act as the Harness /wf-browser CEO. Coordinate implementation terminals and browser verification, then report evidence.',
  },
  {
    id: 'wf-review',
    command: '/wf-review',
    label: 'WF Review',
    description: 'Independent review workflow for risks, regressions, and missing tests.',
    defaultCeoPrompt: 'Act as the Harness /wf-review CEO. Inspect the current changes, ask terminal peers for independent findings when useful, and return prioritized review evidence.',
  },
];

function a2aRoot(projectRoot) {
  return path.join(projectRoot, 'Harness', 'a2a');
}

function writeJsonIfMissing(filePath, data) {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function graphMapPath(projectRoot) {
  return path.join(a2aRoot(projectRoot), 'workflow-map.json');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function graphMapError(message, { statusCode = 400, code = 'BAD_REQUEST', details } = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

function normalizeExpectedGraphVersion(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  const match = text.match(/^(?:W\/)?"?(\d+)"?$/i);
  const version = match ? Number(match[1]) : Number(text);
  if (!Number.isInteger(version) || version < 0) {
    throw graphMapError('expectedVersion must be a non-negative integer');
  }
  return version;
}

function normalizeGraphPositions(graph) {
  if (
    graph?.positions
    && typeof graph.positions === 'object'
    && !Array.isArray(graph.positions)
    && Object.keys(graph.positions).length > 0
  ) {
    return graph.positions;
  }
  const undoStack = Array.isArray(graph?.undoStack) ? graph.undoStack : [];
  for (let index = undoStack.length - 1; index >= 0; index -= 1) {
    const positions = undoStack[index]?.positions;
    if (positions && typeof positions === 'object' && !Array.isArray(positions) && Object.keys(positions).length > 0) {
      return positions;
    }
  }
  const redoStack = Array.isArray(graph?.redoStack) ? graph.redoStack : [];
  for (let index = 0; index < redoStack.length; index += 1) {
    const positions = redoStack[index]?.positions;
    if (positions && typeof positions === 'object' && !Array.isArray(positions) && Object.keys(positions).length > 0) {
      return positions;
    }
  }
  const positions = {};
  for (const node of Array.isArray(graph?.nodes) ? graph.nodes : []) {
    const nodeId = node.nodeId || node.id;
    const position = node.position || (Number.isFinite(Number(node.x)) && Number.isFinite(Number(node.y))
      ? { x: Number(node.x), y: Number(node.y) }
      : null);
    if (nodeId && position) {
      positions[nodeId] = {
        x: Number(position.x) || 0,
        y: Number(position.y) || 0,
      };
    }
  }
  return positions;
}

function normalizeDeletedNodes(graph) {
  const rows = Array.isArray(graph?.deletedNodes) ? graph.deletedNodes : [];
  return rows
    .map((node) => ({
      ...(isPlainObject(node?.node) ? { node: node.node } : {}),
      ...(Array.isArray(node?.edges) ? { edges: node.edges } : {}),
      ...(node?.position && isPlainObject(node.position) ? { position: node.position } : {}),
      nodeId: String(node?.nodeId || node?.id || '').trim(),
      sessionId: node?.sessionId ? String(node.sessionId).trim() : null,
      deletedAt: node?.deletedAt || new Date().toISOString(),
    }))
    .filter(node => node.nodeId || node.sessionId);
}

function mergeDeletedNodes(...groups) {
  const byKey = new Map();
  for (const group of groups) {
    for (const node of normalizeDeletedNodes({ deletedNodes: group })) {
      const key = node.nodeId || `session:${node.sessionId}`;
      byKey.set(key, { ...byKey.get(key), ...node });
    }
  }
  return [...byKey.values()];
}

function deletedNodeSets(deletedNodes) {
  return {
    nodeIds: new Set(deletedNodes.map(node => node.nodeId).filter(Boolean)),
    sessionIds: new Set(deletedNodes.map(node => node.sessionId).filter(Boolean)),
  };
}

function deletedGraphNodeIdSet(graph) {
  return new Set((Array.isArray(graph?.deletedNodes) ? graph.deletedNodes : [])
    .map(node => node?.nodeId)
    .filter(Boolean));
}

function visibleGoalNodes(projectRoot, graph) {
  const deletedGraphNodeIds = deletedGraphNodeIdSet(graph);
  return listGoalNodes(projectRoot).filter(node => !deletedGraphNodeIds.has(node.nodeId));
}

function visibleGoalRefRecord(projectRoot, graph) {
  const deletedGraphNodeIds = deletedGraphNodeIdSet(graph);
  return Object.fromEntries(
    Object.entries(goalStateRefs(projectRoot))
      .filter(([nodeId, ref]) => !deletedGraphNodeIds.has(nodeId) && !deletedGraphNodeIds.has(ref?.nodeId)),
  );
}

function visibleGoalStateRecord(projectRoot, graph) {
  const deletedGraphNodeIds = deletedGraphNodeIdSet(graph);
  return Object.fromEntries(
    Object.entries(goalNodeStates(projectRoot))
      .filter(([nodeId, state]) => !deletedGraphNodeIds.has(nodeId) && !deletedGraphNodeIds.has(state?.nodeId)),
  );
}

function graphNodeMatches(node, nodeIds, sessionIds) {
  const nodeId = node?.nodeId || node?.id || '';
  const sessionId = node?.sessionId || '';
  return (
    (nodeId && nodeIds.has(nodeId))
    || (sessionId && sessionIds.has(sessionId))
    || (sessionId && nodeIds.has(`session-${sessionId}`))
  );
}

function graphNodeDedupeKey(node) {
  return node?.nodeId || node?.id || (node?.sessionId ? `session-${node.sessionId}` : '');
}

function normalizeGraphNode(node) {
  if (!node || typeof node !== 'object') return node;
  return { ...node, status: normalizeSessionStatus(node.status) };
}

function dedupeGraphNodes(nodes) {
  const seen = new Set();
  const result = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const normalized = normalizeGraphNode(node);
    const key = graphNodeDedupeKey(normalized);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(normalized);
  }
  return result;
}

function graphNodeId(node) {
  return node?.nodeId || node?.id || (node?.sessionId ? `session-${node.sessionId}` : '');
}

function mergeStatefulGraphNodes(projectRoot, nodes = [], positions = {}) {
  const componentNodes = listLiveComponentNodes(projectRoot);
  const componentIds = new Set(componentNodes.map(node => node.nodeId));
  const eventNodes = listEventNodes(projectRoot);
  const eventIds = new Set(eventNodes.map(node => node.nodeId));
  const capabilityNodes = listCapabilityNodes(projectRoot);
  const capabilityIds = new Set(capabilityNodes.map(node => node.nodeId));
  const goalNodes = listGoalNodes(projectRoot);
  const goalIds = new Set(goalNodes.map(node => node.nodeId));
  const incomingById = new Map((Array.isArray(nodes) ? nodes : [])
    .map(node => [graphNodeId(node), node])
    .filter(([id]) => id));
  const nonComponentNodes = (Array.isArray(nodes) ? nodes : [])
    .filter(node => (
      node?.kind !== 'component-node'
      && node?.kind !== 'event-node'
      && node?.kind !== 'capability-node'
      && node?.kind !== 'goal-node'
      && !componentIds.has(graphNodeId(node))
      && !eventIds.has(graphNodeId(node))
      && !capabilityIds.has(graphNodeId(node))
      && !goalIds.has(graphNodeId(node))
    ));
  const mergedComponentNodes = componentNodes.map(node => ({
    ...node,
    position: positions?.[node.nodeId]
      || incomingById.get(node.nodeId)?.position
      || node.position,
  }));
  const mergedEventNodes = eventNodes.map(node => ({
    ...node,
    position: positions?.[node.nodeId]
      || incomingById.get(node.nodeId)?.position
      || node.position,
  }));
  const mergedCapabilityNodes = capabilityNodes.map(node => ({
    ...node,
    position: positions?.[node.nodeId]
      || incomingById.get(node.nodeId)?.position
      || node.position,
  }));
  const mergedGoalNodes = goalNodes.map(node => ({
    ...node,
    position: positions?.[node.nodeId]
      || incomingById.get(node.nodeId)?.position
      || node.position,
  }));
  return dedupeGraphNodes([...nonComponentNodes, ...mergedComponentNodes, ...mergedEventNodes, ...mergedCapabilityNodes, ...mergedGoalNodes]);
}

function graphEdgeMatches(edge, nodeIds, sessionIds) {
  return (
    (edge?.from && nodeIds.has(edge.from))
    || (edge?.to && nodeIds.has(edge.to))
    || (edge?.source && nodeIds.has(edge.source))
    || (edge?.target && nodeIds.has(edge.target))
    || (edge?.fromSessionId && sessionIds.has(edge.fromSessionId))
    || (edge?.toSessionId && sessionIds.has(edge.toSessionId))
  );
}

export function workflowEdgeEndpoints(edge) {
  const from = String(edge?.from || edge?.source || '').trim();
  const to = String(edge?.to || edge?.target || '').trim();
  if (!from || !to) return null;
  return { from, to };
}

export function workflowEdgePairKey(edge) {
  const endpoints = workflowEdgeEndpoints(edge);
  if (!endpoints) return '';
  if (normalizeWorkflowEdgeDirection(edge?.direction) === 'source-to-target') {
    const relation = normalizeSemanticRelation(edge?.relation) || 'wf-bridge';
    const sourceHandle = String(edge?.sourceHandle || '').trim();
    const targetHandle = String(edge?.targetHandle || '').trim();
    return `${endpoints.from}->${endpoints.to}:${relation}:${sourceHandle}->${targetHandle}`;
  }
  return [endpoints.from, endpoints.to].sort().join('<->');
}

function workflowNodeTypeIndex(projectRoot, nodes = []) {
  const index = new Map();
  for (const node of listLiveComponentNodes(projectRoot)) {
    if (node?.nodeId && node?.type) index.set(node.nodeId, node.type);
  }
  for (const node of listEventNodes(projectRoot)) {
    if (node?.nodeId && node?.type) index.set(node.nodeId, node.type);
  }
  for (const node of listCapabilityNodes(projectRoot)) {
    if (node?.nodeId && node?.type) index.set(node.nodeId, node.type);
  }
  for (const node of listGoalNodes(projectRoot)) {
    if (node?.nodeId) index.set(node.nodeId, 'goal');
  }
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const nodeId = String(node?.nodeId || node?.id || '').trim();
    const type = String(node?.componentType || node?.type || '').trim();
    if (nodeId && ['markdown', 'excalidraw', 'file', 'timer', 'github-trigger', 'skill-group', 'mcp-connector', 'goal'].includes(type)) index.set(nodeId, type);
  }
  return index;
}

function filterEdgesForGraphNodes(edges = [], nodes = []) {
  const nodeIds = new Set(nodes.map(node => graphNodeId(node)).filter(Boolean));
  return (Array.isArray(edges) ? edges : []).filter((edge) => {
    const endpoints = workflowEdgeEndpoints(edge);
    if (!endpoints) return false;
    return nodeIds.has(endpoints.from) && nodeIds.has(endpoints.to);
  });
}

function resourcePrimaryPort(type) {
  if (type === 'markdown') return 'markdown';
  if (type === 'excalidraw') return 'scene';
  if (type === 'file') return 'file';
  return '';
}

function resourceHandleAliases(type) {
  if (type === 'markdown') return new Set(['markdown', 'plaintext', 'content', 'selection', 'input', 'output', 'top', 'right', 'bottom', 'left']);
  if (type === 'excalidraw') return new Set(['scene', 'image', 'diagram', 'excalidraw', 'content', 'selection', 'input', 'output', 'top', 'right', 'bottom', 'left']);
  if (type === 'file') return new Set(['file', 'path', 'document', 'content', 'selection', 'input', 'output', 'top', 'right', 'bottom', 'left']);
  if (type === 'skill-group') return new Set(['capability', 'skill-group', 'skills', 'skill', 'left', 'right', 'input', 'output']);
  if (type === 'mcp-connector') return new Set(['capability', 'mcp', 'mcp-connector', 'connector', 'server', 'tool', 'tools', 'resource', 'resources', 'left', 'right', 'input', 'output']);
  if (type === 'goal') return new Set(['goal', 'task', 'acceptance', 'left', 'right', 'context', 'input', 'output']);
  return new Set();
}

function normalizeComponentEdgeHandle(type, endpointRole, value) {
  const handle = String(value || '').trim();
  if (type === 'goal') {
    if (!handle) return `goal:${endpointRole === 'source' ? 'right' : 'left'}`;
    const physicalMatch = handle.match(/^([^:]+):(left|right)$/);
    if (physicalMatch && physicalMatch[1] === 'goal') return `goal:${physicalMatch[2]}`;
    const side = handle.toLowerCase();
    if (side === 'left' || side === 'right') return `goal:${side}`;
    const semantic = handle.split(':')[0].trim().toLowerCase();
    if (resourceHandleAliases(type).has(semantic)) {
      return `goal:${endpointRole === 'source' ? 'right' : 'left'}`;
    }
    return `goal:${endpointRole === 'source' ? 'right' : 'left'}`;
  }
  if (type === 'skill-group' || type === 'mcp-connector') {
    if (!handle) return `capability:${endpointRole === 'source' ? 'right' : 'left'}`;
    const physicalMatch = handle.match(/^([^:]+):(left|right)$/);
    if (physicalMatch && physicalMatch[1] === 'capability') return `capability:${physicalMatch[2]}`;
    const side = handle.toLowerCase();
    if (side === 'left' || side === 'right') return `capability:${side}`;
    const semantic = handle.split(':')[0].trim().toLowerCase();
    if (resourceHandleAliases(type).has(semantic)) {
      return `capability:${endpointRole === 'source' ? 'right' : 'left'}`;
    }
    return `capability:${endpointRole === 'source' ? 'right' : 'left'}`;
  }
  if (!['markdown', 'excalidraw', 'file'].includes(type)) return handle || null;
  const primary = resourcePrimaryPort(type);
  if (!handle) return `${primary}:${endpointRole === 'source' ? 'right' : 'left'}`;
  const physicalMatch = handle.match(/^([^:]+):(top|right|bottom|left)$/);
  if (physicalMatch) {
    const port = physicalMatch[1];
    const side = physicalMatch[2];
    if (port === primary) return `${primary}:${side}`;
  }
  const side = handle.toLowerCase();
  if (side === 'top' || side === 'right' || side === 'bottom' || side === 'left') return `${primary}:${side}`;
  const semantic = handle.split(':')[0].trim().toLowerCase();
  if (resourceHandleAliases(type).has(semantic)) {
    return `${primary}:${endpointRole === 'source' ? 'right' : 'left'}`;
  }
  return `${primary}:${endpointRole === 'source' ? 'right' : 'left'}`;
}

function normalizeAgentEdgeHandle(endpointRole, value) {
  const handle = String(value || '').trim();
  if (!handle) return null;
  if (endpointRole === 'target' && handle === 'left') return 'context';
  if (endpointRole === 'source' && handle === 'output') return 'bottom';
  return handle;
}

function normalizeWorkflowEdgeHandle(projectRoot, nodeTypes, nodeId, endpointRole, value) {
  const type = nodeTypes.get(nodeId);
  if (type === 'timer' || type === 'github-trigger') {
    const handle = String(value || '').trim();
    if (handle) return handle;
    return endpointRole === 'source' ? 'event' : 'config';
  }
  if (type) return normalizeComponentEdgeHandle(type, endpointRole, value);
  return normalizeAgentEdgeHandle(endpointRole, value);
}

function normalizeWorkflowEdgeDirection(value) {
  return String(value || '').trim() === 'source-to-target' ? 'source-to-target' : 'bidirectional';
}

function relationFromEdge(edge) {
  const relation = normalizeSemanticRelation(edge?.relation);
  if (relation) return relation;
  const label = normalizeSemanticRelation(edge?.label);
  if (label) return label;
  return 'wf-bridge';
}

function normalizeSemanticRelation(value) {
  const relation = String(value || '').trim();
  if (!relation) return '';
  if (/(?:<->|->)/.test(relation)) return '';
  return relation.replace(/\b(markdown|scene|file):(top|right|bottom|left)\b/g, '$1').trim();
}

export function assertUniqueWorkflowEdgePairs(edges = []) {
  const seen = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const key = workflowEdgePairKey(edge);
    if (!key) continue;
    const endpoints = workflowEdgeEndpoints(edge);
    if (seen.has(key)) {
      const previous = seen.get(key);
      throw graphMapError(`Duplicate workflow edge endpoints: ${endpoints.from} <-> ${endpoints.to}`, {
        statusCode: 409,
        code: 'DUPLICATE_EDGE',
        details: {
          edgeId: edge?.id || `${endpoints.from}->${endpoints.to}`,
          previousEdgeId: previous?.id || `${previous?.from}->${previous?.to}`,
          from: endpoints.from,
          to: endpoints.to,
        },
      });
    }
    seen.set(key, { ...endpoints, id: edge?.id || `${endpoints.from}->${endpoints.to}` });
  }
}

export function normalizeWorkflowGraphEdge(projectRoot, edge, nodes = []) {
  if (!edge || typeof edge !== 'object') return edge;
  const endpoints = workflowEdgeEndpoints(edge);
  if (!endpoints) return edge;
  const nodeTypes = workflowNodeTypeIndex(projectRoot, nodes);
  const id = String(edge.id || `${endpoints.from}->${endpoints.to}`).trim() || `${endpoints.from}->${endpoints.to}`;
  const direction = normalizeWorkflowEdgeDirection(edge.direction);
  const relation = relationFromEdge(edge);
  return {
    ...edge,
    id,
    kind: edge.kind || (direction === 'source-to-target' && relation === 'event' ? 'event-link' : 'workflow-link'),
    from: endpoints.from,
    to: endpoints.to,
    source: endpoints.from,
    target: endpoints.to,
    relation,
    sourceHandle: normalizeWorkflowEdgeHandle(projectRoot, nodeTypes, endpoints.from, 'source', edge.sourceHandle),
    targetHandle: normalizeWorkflowEdgeHandle(projectRoot, nodeTypes, endpoints.to, 'target', edge.targetHandle),
    direction,
  };
}

function normalizeWorkflowGraphEdges(projectRoot, edges = [], nodes = [], { rejectDuplicates = true } = {}) {
  const normalized = [];
  const seen = new Set();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const next = normalizeWorkflowGraphEdge(projectRoot, edge, nodes);
    const key = workflowEdgePairKey(next);
    if (key && seen.has(key)) {
      if (rejectDuplicates) assertUniqueWorkflowEdgePairs([...normalized, next]);
      continue;
    }
    if (key) seen.add(key);
    normalized.push(next);
  }
  if (rejectDuplicates) assertUniqueWorkflowEdgePairs(normalized);
  return normalized;
}

function normalizeCapsuleDockSide(value) {
  const side = String(value || '').trim();
  return ['left', 'right', 'top', 'bottom'].includes(side) ? side : 'right';
}

function capsuleDockPairId(left, right) {
  return [String(left || '').trim(), String(right || '').trim()].sort().join('::');
}

function capsuleDockConnectionId(connection = {}) {
  const source = String(connection.source || connection.from || '').trim();
  const target = String(connection.target || connection.to || '').trim();
  const relation = String(connection.relation || 'wf-bridge').trim();
  const direction = normalizeWorkflowEdgeDirection(connection.direction);
  const sourceHandle = String(connection.sourceHandle || '').trim();
  const targetHandle = String(connection.targetHandle || '').trim();
  return `${source}->${target}:${relation}:${direction}:${sourceHandle}->${targetHandle}`;
}

function normalizeCapsuleDockConnection(connection) {
  if (!connection || typeof connection !== 'object') return null;
  const source = String(connection.source || connection.from || '').trim();
  const target = String(connection.target || connection.to || '').trim();
  if (!source || !target || source === target) return null;
  const relation = String(connection.relation || 'wf-bridge').trim() || 'wf-bridge';
  const direction = normalizeWorkflowEdgeDirection(connection.direction);
  const sourceHandle = String(connection.sourceHandle || '').trim();
  const targetHandle = String(connection.targetHandle || '').trim();
  return {
    id: String(connection.id || capsuleDockConnectionId({ source, target, relation, direction, sourceHandle, targetHandle })).trim(),
    source,
    target,
    from: source,
    to: target,
    relation,
    direction,
    sourceHandle: sourceHandle || null,
    targetHandle: targetHandle || null,
    kind: 'capsule-dock-link',
  };
}

function normalizeCapsuleDockLinks(value, nodes = [], edges = []) {
  if (!Array.isArray(value)) return [];
  const graphNodeIds = new Set((Array.isArray(nodes) ? nodes : [])
    .map(node => graphNodeId(node))
    .filter(Boolean));
  const edgeById = new Map((Array.isArray(edges) ? edges : [])
    .map(edge => [String(edge?.id || '').trim(), edge])
    .filter(([id]) => id));
  const result = new Map();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const rawNodeIds = Array.isArray(item.nodeIds)
      ? item.nodeIds.map(nodeId => String(nodeId || '').trim()).filter(Boolean)
      : [];
    const anchorId = String(item.anchorId || rawNodeIds[0] || '').trim();
    const draggedId = String(item.draggedId || rawNodeIds[1] || '').trim();
    if (!anchorId || !draggedId || anchorId === draggedId) continue;
    if (graphNodeIds.size > 0 && (!graphNodeIds.has(anchorId) || !graphNodeIds.has(draggedId))) continue;
    const sortedNodeIds = [anchorId, draggedId].sort();
    const pairId = capsuleDockPairId(sortedNodeIds[0], sortedNodeIds[1]);
    const rawEdgeBindings = Array.isArray(item.edges)
      ? item.edges
      : (Array.isArray(item.edgeIds) ? item.edgeIds : []);
    const edgesForDisplay = rawEdgeBindings
      .map((binding) => {
        if (typeof binding === 'string') return { edgeId: binding, retention: 'keep' };
        if (!binding || typeof binding !== 'object') return null;
        const edgeId = String(binding.edgeId || binding.id || '').trim();
        if (!edgeId) return null;
        return {
          edgeId,
          retention: binding.retention === 'delete-on-detach' ? 'delete-on-detach' : 'keep',
        };
      })
      .filter(Boolean)
      .filter(binding => edgeById.has(binding.edgeId));
    const rawConnections = Array.isArray(item.connections) ? item.connections : [];
    const connections = rawConnections
      .map(normalizeCapsuleDockConnection)
      .filter(Boolean)
      .filter(connection => (
        (!graphNodeIds.size || (graphNodeIds.has(connection.source) && graphNodeIds.has(connection.target)))
          && sortedNodeIds.includes(connection.source)
          && sortedNodeIds.includes(connection.target)
      ));
    if (connections.length === 0) {
      for (const binding of edgesForDisplay) {
        const edge = edgeById.get(binding.edgeId);
        const connection = normalizeCapsuleDockConnection({
          id: `dock:${pairId}:${binding.edgeId}`,
          source: edge?.source || edge?.from,
          target: edge?.target || edge?.to,
          relation: edge?.relation,
          direction: edge?.direction,
          sourceHandle: edge?.sourceHandle,
          targetHandle: edge?.targetHandle,
        });
        if (connection) connections.push(connection);
      }
    }
    if (connections.length === 0) continue;
    const dedupedConnections = [...new Map(connections.map(connection => [connection.id, connection])).values()];
    result.set(pairId, {
      id: String(item.id || `dock:${pairId}`).trim() || `dock:${pairId}`,
      nodeIds: sortedNodeIds,
      anchorId,
      draggedId,
      side: normalizeCapsuleDockSide(item.side),
      edges: edgesForDisplay,
      connections: dedupedConnections,
    });
  }
  return [...result.values()];
}

function magneticGroupIdFor(members) {
  const key = [...members].sort().join('::');
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  }
  return `mag-${hash.toString(36)}`;
}

// Pure function: computes connected components (magnetic topology) from
// capsuleDockLinks. No IO, no Date.now/Math.random — output is deterministic
// given the input. Each dock link connects its two nodeIds as an undirected
// edge. `directMagneticNeighbors` are nodes sharing a dock link with this node;
// `magneticReachableNodes` are all OTHER nodes in the same component
// (transitive closure, includes direct neighbors).
export function computeMagneticTopology(capsuleDockLinks, opts = {}) {
  const links = Array.isArray(capsuleDockLinks) ? capsuleDockLinks : [];
  const extraNodeIds = Array.isArray(opts && opts.nodeIds) ? opts.nodeIds : [];
  const adjacency = new Map();
  const ensure = (id) => {
    if (!adjacency.has(id)) adjacency.set(id, new Set());
    return adjacency.get(id);
  };
  for (const id of extraNodeIds) {
    const nodeId = String(id || '').trim();
    if (nodeId) ensure(nodeId);
  }
  for (const link of links) {
    if (!link || !Array.isArray(link.nodeIds)) continue;
    const pair = link.nodeIds.map(id => String(id || '').trim()).filter(Boolean);
    if (pair.length < 2) {
      if (pair.length === 1) ensure(pair[0]);
      continue;
    }
    const [a, b] = pair;
    ensure(a).add(b);
    ensure(b).add(a);
  }
  if (adjacency.size === 0) {
    return { groups: [], byNode: {} };
  }
  const visited = new Set();
  const components = [];
  for (const start of [...adjacency.keys()].sort()) {
    if (visited.has(start)) continue;
    const component = [];
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const node = stack.pop();
      component.push(node);
      const neighbors = adjacency.get(node) || new Set();
      for (const next of [...neighbors].sort()) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    components.push(component.sort());
  }
  components.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const groups = components.map(members => ({
    magneticGroupId: magneticGroupIdFor(members),
    nodeIds: members,
  }));
  const byNode = {};
  for (const { magneticGroupId, nodeIds } of groups) {
    for (const node of nodeIds) {
      const direct = [...(adjacency.get(node) || new Set())].sort();
      byNode[node] = {
        magneticGroupId,
        directMagneticNeighbors: direct,
        magneticReachableNodes: nodeIds.filter(id => id !== node),
      };
    }
  }
  return { groups, byNode };
}

// ── Agent find / connect / create routing (agent-team-cooperation-spec §4) ──

const CANONICAL_ROLE_TITLES = new Set([
  'ceo',
  'manager',
  'implementer',
  'reviewer',
  'verifier',
  'planner',
  'terminal-controller',
]);

// role-graph kind → canonical roleTitle (spec §3.1)
const ROLE_GRAPH_KIND_TO_TITLE = {
  controller: 'ceo',
  planner: 'planner',
  architecture: 'architect',
  implementer: 'implementer',
  review: 'reviewer',
  validation: 'verifier',
  runtime: 'terminal-controller',
};

const GOAL_NODE_ID_RE = /^goal-[A-Za-z0-9][A-Za-z0-9_.-]*$/;

// Spec §3.2: agentKind stays a lifecycle flag; roleTitle is the role identity.
// 'Main Agent'/'main'/ceo → 'ceo'; 'Subagent'/'subagent' → legacy
// 'terminal-agent' (the no-profile default for manually spawned PTYs).
function normalizeRoleTitle(value, agentKind = '') {
  const raw = String(value || '').trim();
  if (!raw) return agentKind === 'main' ? 'ceo' : '';
  const lower = raw.toLowerCase();
  if (lower === 'main' || lower === 'main agent' || lower === 'ceo') return 'ceo';
  if (lower === 'subagent' || lower === 'sub') return 'terminal-agent';
  if (ROLE_GRAPH_KIND_TO_TITLE[lower]) return ROLE_GRAPH_KIND_TO_TITLE[lower];
  return raw;
}

function agentRefHasGraphEdge(graph, nodeId) {
  const edgeConnected = (Array.isArray(graph.edges) ? graph.edges : []).some((edge) => {
    const from = String(edge.from || edge.source || '').trim();
    const to = String(edge.to || edge.target || '').trim();
    return from === nodeId || to === nodeId;
  });
  if (edgeConnected) return true;
  // Dock-linked agents are magnetically connected even without a graph edge
  // (spec §4.1 `connected`); without this, auto-connect would add a duplicate
  // delegation edge for already-docked agents (F5).
  return (Array.isArray(graph.capsuleDockLinks) ? graph.capsuleDockLinks : []).some((link) => {
    const nodeIds = Array.isArray(link?.nodeIds) ? link.nodeIds : [];
    return nodeIds.includes(nodeId);
  });
}

function matchAgentQuery(ref, { role, runtime, provider, capability, title } = {}) {
  if (role) {
    const r = String(role).trim().toLowerCase();
    const roleTitle = String(ref.roleTitle || '').toLowerCase();
    const agentKind = String(ref.agentKind || '').toLowerCase();
    // Synonym vocabulary (spec §3.2): 'main'/'main agent' → agentKind main;
    // 'subagent'/'sub' → agentKind subagent.
    const synonym = (r === 'main' || r === 'main agent')
      ? agentKind === 'main'
      : (r === 'subagent' || r === 'sub') ? agentKind === 'subagent' : false;
    // role-graph kind → canonical roleTitle map (spec §3.1).
    const kindMapped = ROLE_GRAPH_KIND_TO_TITLE[r] ? roleTitle === ROLE_GRAPH_KIND_TO_TITLE[r] : false;
    // Tightened precedence (F5): exact match first, synonym map second,
    // substring only as the last resort for free-form roleTitles — substring
    // alone may over-match (e.g. role=re) and must never outrank an exact or
    // synonym hit.
    if (roleTitle !== r && !synonym && !kindMapped && !roleTitle.includes(r)) return false;
  }
  if (runtime && String(ref.runtime || '').trim().toLowerCase() !== String(runtime).trim().toLowerCase()) return false;
  if (provider && String(ref.provider || '').trim().toLowerCase() !== String(provider).trim().toLowerCase()) return false;
  if (capability) {
    const c = String(capability).trim().toLowerCase();
    if (!(Array.isArray(ref.capabilities) ? ref.capabilities : [])
      .some(item => String(item).toLowerCase().includes(c))) return false;
  }
  if (title) {
    const t = String(title).trim().toLowerCase();
    const haystack = [ref.displayName, ref.roleTitle, ref.nodeId].join(' ').toLowerCase();
    if (!haystack.includes(t)) return false;
  }
  return true;
}

// Spec §4.1: find existing agents by role / runtime / provider / capability /
// title. Role matches canonical roleTitle, free-form roleTitle, or agentKind
// synonym; capability and title are substring matches.
export async function findAgents(projectRoot, { role, runtime, provider, capability, title } = {}, sessionRegistry = null) {
  const graph = loadWorkflowGraphMap(projectRoot);
  const graphNodes = (Array.isArray(graph.nodes) ? graph.nodes : []).filter(node => node.sessionId);
  const bySessionId = new Map();
  for (const session of listTerminalSessions(projectRoot)) {
    bySessionId.set(session.sessionId, session);
  }
  if (sessionRegistry && typeof sessionRegistry.getAll === 'function') {
    for (const session of sessionRegistry.getAll()) {
      bySessionId.set(session.sessionId, { ...(bySessionId.get(session.sessionId) || {}), ...session });
    }
  }
  const profiles = new Map(listRoleProfiles(projectRoot).map(profile => [profile.nodeId, profile]));
  const refs = graphNodes.map((node) => {
    const nodeId = node.nodeId || node.id || '';
    const session = bySessionId.get(node.sessionId) || {};
    const profile = profiles.get(nodeId) || null;
    const roleTitle = String(
      profile?.roleTitle
      || session.roleTitle
      || normalizeRoleTitle(node.role || session.role || '', node.agentKind || session.agentKind)
      || ''
    ).trim();
    return {
      nodeId,
      displayName: String(profile?.displayName || session.displayName || node.label || node.role || nodeId || '').trim(),
      roleTitle,
      agentKind: String(session.agentKind || node.agentKind || '').trim() || 'subagent',
      runtime: String(profile?.runtime || session.runtime || node.runtime || '').trim(),
      provider: String(profile?.provider || session.provider || node.provider || '').trim(),
      capabilities: Array.isArray(profile?.capabilities)
        ? [...profile.capabilities]
        : (Array.isArray(session.capabilities) ? [...session.capabilities] : []),
      connected: agentRefHasGraphEdge(graph, nodeId),
      status: String(session.status || node.status || 'stopped').trim(),
    };
  });
  const matches = refs.filter(ref => matchAgentQuery(ref, { role, runtime, provider, capability, title }));
  const query = {};
  for (const [key, value] of Object.entries({ role, runtime, provider, capability, title })) {
    if (value) query[key] = value;
  }
  return { query, matches, count: matches.length };
}

// Spec §4.2: exactly one match + not connected → connect (bidirectional
// delegation edge) and report the decision. Idempotent: no duplicate edges.
export function autoConnectAgent(projectRoot, from, to, options = {}) {
  const fromId = String(from || '').trim();
  const toId = String(to || '').trim();
  if (!fromId || !toId || fromId === toId) {
    throw graphMapError('Auto-connect requires two distinct workflow node ids', {
      statusCode: 400,
      code: 'INVALID_ENDPOINT',
    });
  }
  const graph = loadWorkflowGraphMap(projectRoot);
  const direction = String(options.direction || '').trim() === 'source-to-target' ? 'source-to-target' : 'bidirectional';
  const relation = String(options.relation || '').trim() || 'delegation';
  const pairKey = workflowEdgePairKey({ from: fromId, to: toId, direction });
  const existing = (Array.isArray(graph.edges) ? graph.edges : [])
    .find(edge => workflowEdgePairKey(edge) === pairKey);
  if (existing) return { ok: true, connected: true, edge: existing };
  const edge = {
    id: `${fromId}->${toId}`,
    from: fromId,
    to: toId,
    relation,
    sourceHandle: null,
    targetHandle: null,
    direction,
  };
  writeWorkflowGraphMap(projectRoot, {
    ...graph,
    version: graph.version + 1,
    edges: [...(Array.isArray(graph.edges) ? graph.edges : []), edge],
  });
  return { ok: true, connected: false, edge };
}

function magneticGroupForNode(topology, nodeId) {
  const info = topology.byNode[nodeId];
  if (!info) return null;
  return (Array.isArray(topology.groups) ? topology.groups : [])
    .find(group => group.magneticGroupId === info.magneticGroupId) || null;
}

function isGoalNodeId(projectRoot, graph, id) {
  if (!GOAL_NODE_ID_RE.test(String(id || '').trim())) return false;
  const graphNode = (Array.isArray(graph.nodes) ? graph.nodes : [])
    .find(node => (node.nodeId || node.id) === id);
  // Store-merged goal nodes carry kind 'goal-node'; injected nodes without a
  // kind are still goal-shaped ids. Anything else is not a goal node.
  if (graphNode && graphNode.kind && graphNode.kind !== 'goal-node') return false;
  return true;
}

function isTimerNodeId(projectRoot, id) {
  return (listEventNodes(projectRoot) || []).some(node => (node.nodeId || node.id) === id);
}

function isAgentNodeId(graph, id) {
  return (Array.isArray(graph.nodes) ? graph.nodes : []).some(node => (
    (node.nodeId || node.id) === id
    && node.sessionId
  ));
}

// Spec §6.2 (AC-015/T12): a magnetic group that contains a Timer and an Agent
// may contain at most one Goal node. Throws the goal_already_bound shape when
// the group of `goalNodeId` already has a Goal bound to its Timer.
//
// The count is CANDIDATE-INCLUSIVE (F2): the candidate goal is added to the
// topology before counting, so a second Goal that is about to be connected or
// created into a group with an existing Goal is rejected even though it is not
// yet present in the graph's capsuleDockLinks. `opts.extraDockLinks` simulates
// links that do not exist yet (e.g. the edge being connected); a free-floating
// candidate with no links forms its own singleton group and passes, so
// connect-time enforcement catches the second Goal later.
export function assertSingleGoalPerGroup(projectRoot, goalNodeId, opts = {}) {
  const nodeId = String(goalNodeId || '').trim();
  const graph = loadWorkflowGraphMap(projectRoot);
  const extraLinks = Array.isArray(opts?.extraDockLinks) ? opts.extraDockLinks : [];
  const extraNodeIds = [...(Array.isArray(opts?.extraNodeIds) ? opts.extraNodeIds : [])];
  if (nodeId) extraNodeIds.push(nodeId);
  const topology = computeMagneticTopology(
    [...(Array.isArray(graph.capsuleDockLinks) ? graph.capsuleDockLinks : []), ...extraLinks],
    { nodeIds: extraNodeIds },
  );
  const group = magneticGroupForNode(topology, nodeId);
  if (!group) return { ok: true, magneticGroupId: null, groupNodeIds: [] };
  const goalNodeIds = group.nodeIds.filter(id => isGoalNodeId(projectRoot, graph, id));
  const timerNodeIds = group.nodeIds.filter(id => isTimerNodeId(projectRoot, id));
  const agentNodeIds = group.nodeIds.filter(id => isAgentNodeId(graph, id));
  if (timerNodeIds.length > 0 && agentNodeIds.length > 0 && goalNodeIds.length > 1) {
    const existingGoalNodeId = goalNodeIds.find(id => id !== nodeId) || goalNodeIds[0];
    const timerNodeId = timerNodeIds[0];
    const error = new Error(`This group already has a Goal (${existingGoalNodeId}) bound to its Timer (${timerNodeId}).`);
    error.code = 'goal_already_bound';
    error.statusCode = 409;
    error.existingGoalNodeId = existingGoalNodeId;
    error.timerNodeId = timerNodeId;
    throw error;
  }
  return { ok: true, magneticGroupId: group.magneticGroupId, groupNodeIds: group.nodeIds };
}

function capsuleDockDeleteOnDetachEdgeIds(dockLinks = []) {
  const edgeIds = new Set();
  for (const link of Array.isArray(dockLinks) ? dockLinks : []) {
    for (const binding of Array.isArray(link?.edges) ? link.edges : []) {
      if (binding?.retention !== 'delete-on-detach') continue;
      const edgeId = String(binding.edgeId || binding.id || '').trim();
      if (edgeId) edgeIds.add(edgeId);
    }
  }
  return edgeIds;
}

function pruneCapsuleDockLinksByEdgeIds(dockLinks = [], edgeIds = new Set()) {
  if (!edgeIds.size) return dockLinks;
  return (Array.isArray(dockLinks) ? dockLinks : [])
    .map(link => ({
      ...link,
      edges: (Array.isArray(link?.edges) ? link.edges : [])
        .filter(binding => !edgeIds.has(String(binding?.edgeId || binding?.id || '').trim())),
    }))
    .filter(link => Array.isArray(link.connections) && link.connections.length > 0);
}

function workflowGraphEdgeSemanticKey(edge = {}) {
  const from = String(edge.from || edge.source || '').trim();
  const to = String(edge.to || edge.target || '').trim();
  if (!from || !to) return '';
  const relation = String(edge.relation || 'wf-bridge').trim() || 'wf-bridge';
  const direction = normalizeWorkflowEdgeDirection(edge.direction);
  const sourceHandle = String(edge.sourceHandle || '').trim();
  const targetHandle = String(edge.targetHandle || '').trim();
  if (direction !== 'source-to-target') {
    return [
      direction,
      relation,
      ...[`${from}:${sourceHandle}`, `${to}:${targetHandle}`].sort(),
    ].join('|');
  }
  return [direction, from, sourceHandle, relation, to, targetHandle].join('|');
}

function dedupeWorkflowGraphEdgesBySemantic(edges = []) {
  const seen = new Set();
  const result = [];
  for (const edge of Array.isArray(edges) ? edges : []) {
    const key = workflowGraphEdgeSemanticKey(edge);
    const fallbackKey = String(edge?.id || '').trim();
    const dedupeKey = key || fallbackKey;
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(edge);
  }
  return result;
}

function filterPositionsForDeleted(positions, deletedNodes) {
  const next = { ...(positions || {}) };
  for (const node of deletedNodes) {
    if (node.nodeId) delete next[node.nodeId];
    if (node.sessionId) delete next[`session-${node.sessionId}`];
  }
  return next;
}

function filterHistoryForDeleted(history, deletedNodes) {
  if (!Array.isArray(history)) return [];
  const { nodeIds, sessionIds } = deletedNodeSets(deletedNodes);
  const nodeMatchesDeleted = (node) => {
    if (!node || typeof node !== 'object') return false;
    const nodeId = String(node.nodeId || node.id || '').trim();
    const sessionId = String(node.sessionId || '').trim();
    return Boolean(
      (nodeId && (nodeIds.has(nodeId) || sessionIds.has(nodeId)))
      || (sessionId && sessionIds.has(sessionId))
    );
  };
  const filterDockLinks = (links) => (Array.isArray(links) ? links : []).filter(link => (
    Array.isArray(link?.nodeIds)
      && !link.nodeIds.some(nodeId => nodeIds.has(nodeId))
      && ![link.anchorId, link.draggedId].some(nodeId => nodeIds.has(nodeId))
  ));
  const filterSlice = (slice) => {
    if (!slice || typeof slice !== 'object') return slice;
    return {
      ...slice,
      positions: filterPositionsForDeleted(slice.positions, deletedNodes),
      edges: Array.isArray(slice.edges) ? slice.edges.filter(edge => !graphEdgeMatches(edge, nodeIds, sessionIds)) : [],
      dockLinks: filterDockLinks(slice.dockLinks),
      nodes: Array.isArray(slice.nodes) ? slice.nodes.filter(node => !nodeMatchesDeleted(node)) : [],
    };
  };
  return history.map((entry) => {
    // A delete-inverse op (its inverse.nodes slice carries the deleted node)
    // must survive intact so undo can restore the node and its edges (P5).
    if (Array.isArray(entry?.inverse?.nodes) && entry.inverse.nodes.some(nodeMatchesDeleted)) return entry;
    return {
      ...entry,
      positions: filterPositionsForDeleted(entry?.positions, deletedNodes),
      edges: Array.isArray(entry?.edges)
        ? entry.edges.filter(edge => !graphEdgeMatches(edge, nodeIds, sessionIds))
        : [],
      capsuleDockLinks: filterDockLinks(entry?.capsuleDockLinks),
      inverse: filterSlice(entry?.inverse),
      forward: filterSlice(entry?.forward),
    };
  });
}

export function loadWorkflowGraphMap(projectRoot) {
  ensureA2aDefaults(projectRoot);
  const fallback = {
    schemaVersion: 1,
    version: 1,
    nodes: [],
    edges: [],
    capsuleDockLinks: [],
    positions: {},
    undoStack: [],
    redoStack: [],
    deletedNodes: [],
  };
  const graph = readJson(graphMapPath(projectRoot), fallback);
  const positions = normalizeGraphPositions(graph);
  const deletedNodes = normalizeDeletedNodes(graph);
  const { nodeIds, sessionIds } = deletedNodeSets(deletedNodes);
  const nodes = mergeStatefulGraphNodes(projectRoot, Array.isArray(graph.nodes) ? graph.nodes : [], positions)
    .filter(node => !graphNodeMatches(node, nodeIds, sessionIds));
  let edges = normalizeWorkflowGraphEdges(
    projectRoot,
    filterEdgesForGraphNodes(
      Array.isArray(graph.edges) ? graph.edges.filter(edge => !graphEdgeMatches(edge, nodeIds, sessionIds)) : [],
      nodes,
    ),
    nodes,
    { rejectDuplicates: false },
  );
  let capsuleDockLinks = normalizeCapsuleDockLinks(graph.capsuleDockLinks, nodes, edges);
  const legacyDockEdgeIds = capsuleDockDeleteOnDetachEdgeIds(capsuleDockLinks);
  if (legacyDockEdgeIds.size > 0) {
    edges = edges.filter(edge => !legacyDockEdgeIds.has(String(edge?.id || '').trim()));
    capsuleDockLinks = pruneCapsuleDockLinksByEdgeIds(capsuleDockLinks, legacyDockEdgeIds);
  }
  return {
    ...fallback,
    ...graph,
    schemaVersion: Number(graph.schemaVersion || 1),
    version: Number(graph.version || graph.graphVersion || 1),
    nodes,
    edges,
    capsuleDockLinks,
    positions: filterPositionsForDeleted(positions, deletedNodes),
    undoStack: filterHistoryForDeleted(graph.undoStack, deletedNodes),
    redoStack: filterHistoryForDeleted(graph.redoStack, deletedNodes),
    deletedNodes,
    graphContextPath: graphMapPath(projectRoot),
  };
}

export function writeWorkflowGraphMap(projectRoot, graph = {}, options = {}) {
  const current = loadWorkflowGraphMap(projectRoot);
  const graphPayload = isPlainObject(graph) ? graph : {};
  const expectedVersion = normalizeExpectedGraphVersion(
    graphPayload.expectedVersion !== undefined ? graphPayload.expectedVersion : options.expectedVersion
  );
  if (expectedVersion !== null && expectedVersion !== current.version) {
    throw graphMapError(`Stale graph-map write rejected: expected version ${expectedVersion}, current version ${current.version}`, {
      statusCode: 409,
      code: 'STALE_GRAPH_VERSION',
      details: { expectedVersion, currentVersion: current.version },
    });
  }

  const { expectedVersion: _expectedVersion, ifMatch: _ifMatch, ...graphPatch } = graphPayload;
  const deletedNodes = mergeDeletedNodes(current.deletedNodes, graphPatch.deletedNodes);
  const { nodeIds, sessionIds } = deletedNodeSets(deletedNodes);
  const rawNodes = Array.isArray(graphPatch.nodes) ? graphPatch.nodes : current.nodes;
  const rawEdges = Array.isArray(graphPatch.edges) ? graphPatch.edges : current.edges;
  const rawPositions = graphPatch.positions && typeof graphPatch.positions === 'object' && !Array.isArray(graphPatch.positions)
    ? graphPatch.positions
    : current.positions;
  const nodes = mergeStatefulGraphNodes(projectRoot, rawNodes, rawPositions)
    .filter(node => !graphNodeMatches(node, nodeIds, sessionIds));
  let edges = normalizeWorkflowGraphEdges(
    projectRoot,
    filterEdgesForGraphNodes(rawEdges.filter(edge => !graphEdgeMatches(edge, nodeIds, sessionIds)), nodes),
    nodes,
  );
  let capsuleDockLinks = normalizeCapsuleDockLinks(
    Array.isArray(graphPatch.capsuleDockLinks) ? graphPatch.capsuleDockLinks : current.capsuleDockLinks,
    nodes,
    edges,
  );
  const legacyDockEdgeIds = capsuleDockDeleteOnDetachEdgeIds(capsuleDockLinks);
  if (legacyDockEdgeIds.size > 0) {
    edges = edges.filter(edge => !legacyDockEdgeIds.has(String(edge?.id || '').trim()));
    capsuleDockLinks = pruneCapsuleDockLinksByEdgeIds(capsuleDockLinks, legacyDockEdgeIds);
  }
  // Server-side graph history is authoritative (P5 undo design): the UI PUTs
  // undoStack:[] and must not wipe recorded history. Payload stacks are used
  // only when they carry real content (non-empty legacy writes) or when the
  // caller explicitly opts in via options.overrideHistory (undo/redo apply).
  const overrideHistory = options?.overrideHistory === true;
  const payloadUndoStack = Array.isArray(graphPatch.undoStack) ? graphPatch.undoStack : null;
  const payloadRedoStack = Array.isArray(graphPatch.redoStack) ? graphPatch.redoStack : null;
  const nextUndoStack = overrideHistory
    ? (payloadUndoStack || current.undoStack)
    : (payloadUndoStack && payloadUndoStack.length > 0 ? payloadUndoStack : current.undoStack);
  const nextRedoStack = overrideHistory
    ? (payloadRedoStack || current.redoStack)
    : (payloadRedoStack && payloadRedoStack.length > 0 ? payloadRedoStack : current.redoStack);
  const next = {
    ...current,
    ...graphPatch,
    schemaVersion: 1,
    version: Number(graphPatch.version || graphPatch.graphVersion || current.version + 1),
    nodes,
    edges,
    capsuleDockLinks,
    positions: filterPositionsForDeleted(rawPositions, deletedNodes),
    undoStack: filterHistoryForDeleted(nextUndoStack, deletedNodes),
    redoStack: filterHistoryForDeleted(nextRedoStack, deletedNodes),
    deletedNodes,
    updatedAt: new Date().toISOString(),
  };
  writeJson(graphMapPath(projectRoot), next);
  invalidateSnapshotCache(projectRoot);
  return { ...next, graphContextPath: graphMapPath(projectRoot) };
}

export function updateWorkflowGraphSessionNode(projectRoot, sessionId, patch = {}) {
  const current = loadWorkflowGraphMap(projectRoot);
  let changed = false;
  const nodes = current.nodes.map((node) => {
    if (node.sessionId !== sessionId) return node;
    changed = true;
    return { ...node, ...patch, nodeId: node.nodeId || node.id };
  });
  if (!changed) return current;
  return writeWorkflowGraphMap(projectRoot, {
    ...current,
    version: current.version + 1,
    nodes,
  });
}

export function removeWorkflowGraphNode(projectRoot, nodeIdOrSessionId, options = {}) {
  const current = loadWorkflowGraphMap(projectRoot);
  const key = String(nodeIdOrSessionId || '').trim();
  const target = current.nodes.find(node => {
    const nodeId = node.nodeId || node.id || '';
    const sessionId = node.sessionId || '';
    return nodeId === key || sessionId === key || (sessionId && `session-${sessionId}` === key);
  }) || null;
  const nodeId = target?.nodeId || target?.id || key;
  const sessionId = target?.sessionId || (key.startsWith('session-') ? key.slice('session-'.length) : null);
  const deletedAt = new Date().toISOString();
  const candidateEdges = Array.isArray(options.edges) ? options.edges : current.edges;
  const affectedEdges = candidateEdges.filter(edge => graphEdgeMatches(edge, new Set([nodeId]), new Set([sessionId].filter(Boolean))));
  const recoveryNode = options.node || target || { nodeId, sessionId: sessionId || null };
  const deletedNode = {
    nodeId,
    sessionId: sessionId || null,
    deletedAt,
    node: recoveryNode,
    edges: affectedEdges,
    position: current.positions?.[nodeId] || recoveryNode.position,
  };
  const deletedNodes = mergeDeletedNodes(current.deletedNodes, [deletedNode]);
  const { nodeIds, sessionIds } = deletedNodeSets(deletedNodes);
  // P5: delete callers pass options.undoStack/redoStack (the op recorded
  // BEFORE the delete) so the fresh delete-op survives the history filter;
  // other callers keep the existing filtered-current behavior.
  const overrideHistory = Array.isArray(options.undoStack) || Array.isArray(options.redoStack);
  const graph = writeWorkflowGraphMap(projectRoot, {
    ...current,
    version: current.version + 1,
    nodes: current.nodes.filter(node => !graphNodeMatches(node, nodeIds, sessionIds)),
    edges: current.edges.filter(edge => !graphEdgeMatches(edge, nodeIds, sessionIds)),
    positions: filterPositionsForDeleted(current.positions, deletedNodes),
    undoStack: Array.isArray(options.undoStack) ? options.undoStack : current.undoStack,
    redoStack: Array.isArray(options.redoStack) ? options.redoStack : current.redoStack,
    deletedNodes,
  }, { overrideHistory });
  // Typed-node stores live OUTSIDE the graph map (event/component/capability
  // stores); remove their state too, or the snapshot resurrects a "deleted"
  // typed node from its store record. Undo restores store state from the
  // inverse slice's eventState/componentState/capabilityState fields.
  try { deleteComponentNode(projectRoot, nodeId); } catch { /* not a component node */ }
  try { deleteCapabilityNode(projectRoot, nodeId); } catch { /* not a capability node */ }
  try { deleteEventNode(projectRoot, nodeId); } catch { /* not an event node */ }
  return { ok: true, removed: deletedNode, graph };
}

export function restoreWorkflowGraphNode(projectRoot, nodeIdOrSessionId) {
  const fallback = { schemaVersion: 1, version: 1, nodes: [], edges: [], positions: {}, deletedNodes: [] };
  const raw = readJson(graphMapPath(projectRoot), fallback);
  const deletedNodes = normalizeDeletedNodes(raw);
  const key = String(nodeIdOrSessionId || '').trim();
  const recovery = deletedNodes.find(item => item.nodeId === key || item.sessionId === key || `session-${item.sessionId}` === key);
  if (!recovery) {
    throw graphMapError(`Deleted workflow node not found: ${key}`, { statusCode: 404, code: 'DELETED_NODE_NOT_FOUND' });
  }
  const restoredNode = recovery.node || { nodeId: recovery.nodeId, sessionId: recovery.sessionId };
  const restoredNodeId = restoredNode.nodeId || restoredNode.id || recovery.nodeId;
  const nodes = Array.isArray(raw.nodes) ? raw.nodes.filter(node => !graphNodeMatches(node, new Set([restoredNodeId]), new Set([recovery.sessionId].filter(Boolean)))) : [];
  nodes.push({ ...restoredNode, nodeId: restoredNode.nodeId || restoredNode.id || restoredNodeId });
  const existingEdgeIds = new Set((Array.isArray(raw.edges) ? raw.edges : []).map(edge => edge.id));
  const edges = [
    ...(Array.isArray(raw.edges) ? raw.edges : []),
    ...(recovery.edges || []).filter(edge => edge?.id && !existingEdgeIds.has(edge.id)),
  ];
  const positions = { ...(raw.positions || {}) };
  if (recovery.position) positions[restoredNodeId] = recovery.position;
  else if (restoredNode.position) positions[restoredNodeId] = restoredNode.position;
  const remainingDeletedNodes = deletedNodes.filter(item => item !== recovery);
  writeJson(graphMapPath(projectRoot), {
    ...raw,
    version: Number(raw.version || 1) + 1,
    nodes,
    edges,
    positions,
    deletedNodes: remainingDeletedNodes,
    updatedAt: new Date().toISOString(),
  });
  invalidateSnapshotCache(projectRoot);
  return { ok: true, restored: restoredNode, graph: loadWorkflowGraphMap(projectRoot) };
}

export function ensureA2aDefaults(projectRoot) {
  const root = a2aRoot(projectRoot);
  writeJsonIfMissing(path.join(root, 'role-graph.json'), DEFAULT_ROLE_GRAPH);
  writeJsonIfMissing(path.join(root, 'runtime-registry.json'), {
    schemaVersion: 1,
    source: 'backend-runtime-detector',
    runtimes: RUNTIME_DEFINITIONS.map((runtime) => runtime.id),
  });
  writeJsonIfMissing(path.join(root, 'workflows.json'), {
    schemaVersion: 1,
    workflows: BUILT_IN_WORKFLOWS,
  });
  writeJsonIfMissing(path.join(root, 'skills', 'terminal-control.json'), DEFAULT_TERMINAL_CONTROL_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-node-map.json'), DEFAULT_WORKFLOW_NODE_MAP_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-ontology.json'), DEFAULT_WORKFLOW_ONTOLOGY_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-context.json'), DEFAULT_WORKFLOW_CONTEXT_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-node-actions.json'), DEFAULT_WORKFLOW_NODE_ACTIONS_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-timer-node.json'), DEFAULT_WORKFLOW_TIMER_NODE_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-goal-node.json'), DEFAULT_WORKFLOW_GOAL_NODE_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-agent-node.json'), DEFAULT_WORKFLOW_AGENT_NODE_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-resource-node.json'), DEFAULT_WORKFLOW_RESOURCE_NODE_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-markdown-node.json'), DEFAULT_WORKFLOW_MARKDOWN_NODE_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-diagram-node.json'), DEFAULT_WORKFLOW_DIAGRAM_NODE_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-file-node.json'), DEFAULT_WORKFLOW_FILE_NODE_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-skill-group-node.json'), DEFAULT_WORKFLOW_SKILL_GROUP_NODE_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'workflow-mcp-connector-node.json'), DEFAULT_WORKFLOW_MCP_CONNECTOR_NODE_SKILL);
  writeJsonIfMissing(path.join(root, 'skills', 'wf-ui-map.json'), DEFAULT_WF_UI_MAP_SKILL);
  // No snapshot invalidation here: ensureA2aDefaults runs on READ paths
  // (loadRoleGraph → every snapshot build). Invalidating would wipe the memo
  // on every build and make it useless. Files it creates are read by the
  // same call stack right after, so no staleness window exists.
  return root;
}

export function loadRoleGraph(projectRoot) {
  ensureA2aDefaults(projectRoot);
  return readJson(path.join(a2aRoot(projectRoot), 'role-graph.json'), DEFAULT_ROLE_GRAPH);
}

export function loadA2aSkills(projectRoot) {
  ensureA2aDefaults(projectRoot);
  const skillsRoot = path.join(a2aRoot(projectRoot), 'skills');
  let entries = [];
  try {
    entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readJson(path.join(skillsRoot, entry.name), null))
    .filter(Boolean);
}

export function loadBuiltInWorkflows(projectRoot) {
  ensureA2aDefaults(projectRoot);
  const registry = readJson(path.join(a2aRoot(projectRoot), 'workflows.json'), { workflows: BUILT_IN_WORKFLOWS });
  return Array.isArray(registry.workflows) ? registry.workflows : BUILT_IN_WORKFLOWS;
}

function graphNodeIdForSession(session) {
  return session.graphNodeId || `session-${session.sessionId}`;
}

function isLiveStatus(status) {
  return status === 'running' || status === 'starting';
}

function normalizeSessionStatus(status) {
  return status === 'saved' ? 'stopped' : status;
}

function lifecycleForSession(session) {
  const status = normalizeSessionStatus(session.status);
  if (isLiveStatus(status)) return 'live';
  if (status === 'stopping') return 'stopping';
  return 'stopped';
}

function runtimeStateForSession(session) {
  if (session.blockedReason === 'not-managed-by-current-wf-ui') return 'not-managed';
  return normalizeSessionStatus(session.status) || 'unknown';
}

function nodeConfigSummary(session) {
  const config = normalizeNodeConfig(session.nodeConfig, session);
  const recommendation = recommendSkills(config, session);
  return {
    config,
    restartRequired: Boolean(session.restartRequired),
    restartRequiredFields: Array.isArray(session.restartRequiredFields) ? session.restartRequiredFields : [],
    configRevision: Number(session.configRevision || 0),
    recommendedSkills: recommendation.recommendedSkills,
    recommendationReason: recommendation.recommendationReason,
    displayName: session.displayName || '',
    roleTitle: session.roleTitle || '',
  };
}

function controlForSession(session) {
  const live = isLiveStatus(normalizeSessionStatus(session.status));
  const managed = Boolean(session.managedByCurrentServer);
  const canStop = managed && live;
  const canStart = Boolean(session.sessionId && session.runtime) && !live;
  return {
    canReadGraph: Boolean(session.sessionId),
    canModifyGraph: managed && live && session.agentKind === 'main',
    canStart,
    canStop,
    canDelete: Boolean(session.sessionId) && !live,
    canOpenTerminal: managed && live,
    canOpenTranscript: Boolean(session.sessionId),
    canSendInput: managed && live,
    canCreateAgent: canStop && session.agentKind === 'main',
  };
}

function buildSessionGraph(projectRoot, workflowId, sessions) {
  const persisted = loadWorkflowGraphMap(projectRoot);
  const persistedByNodeId = new Map((persisted.nodes || []).map(node => [node.nodeId || node.id, node]));
  const persistedBySessionId = new Map((persisted.nodes || []).filter(node => node.sessionId).map(node => [node.sessionId, node]));
  const componentNodes = listLiveComponentNodes(projectRoot).map(node => ({
    ...node,
    position: persisted.positions?.[node.nodeId]
      || persistedByNodeId.get(node.nodeId)?.position
      || node.position,
  }));
  const componentRefs = componentStateRefs(projectRoot);
  const eventNodes = listEventNodes(projectRoot).map(node => ({
    ...node,
    label: node.title,
    level: 2,
    status: 'ready',
    lifecycle: 'event-source',
    runtimeState: 'ready',
    managedByCurrentServer: true,
    control: {
      canReadGraph: true,
      canModifyGraph: true,
      canDelete: true,
      canCreateComponentNode: true,
    },
    position: persisted.positions?.[node.nodeId]
      || persistedByNodeId.get(node.nodeId)?.position
      || node.position,
  }));
  const eventRefs = eventStateRefs(projectRoot);
  const capabilityNodes = listCapabilityNodes(projectRoot).map(node => ({
    ...node,
    label: node.title,
    level: 2,
    status: 'ready',
    lifecycle: 'capability-provider',
    runtimeState: 'ready',
    managedByCurrentServer: true,
    control: {
      canReadGraph: true,
      canModifyGraph: true,
      canDelete: true,
      canCreateComponentNode: true,
    },
    position: persisted.positions?.[node.nodeId]
      || persistedByNodeId.get(node.nodeId)?.position
      || node.position,
  }));
  const capabilityRefs = capabilityStateRefs(projectRoot);
  const goalNodes = visibleGoalNodes(projectRoot, persisted).map(node => ({
    ...node,
    label: node.title,
    level: 1,
    status: node.status || 'active',
    lifecycle: 'goal-anchor',
    runtimeState: node.runtimeState || node.status || 'active',
    managedByCurrentServer: true,
    control: {
      canReadGraph: true,
      canModifyGraph: true,
      canDelete: true,
      canCreateComponentNode: false,
    },
    position: persisted.positions?.[node.nodeId]
      || persistedByNodeId.get(node.nodeId)?.position
      || node.position,
  }));
  const goalRefs = visibleGoalRefRecord(projectRoot, persisted);
  const sessionNodes = sessions.map((session) => {
    const configSummary = nodeConfigSummary(session);
    return {
      nodeId: graphNodeIdForSession(session),
      kind: 'terminal-session',
      sessionId: session.sessionId,
      peerId: session.peerId,
      agentKind: session.agentKind || (String(session.role || '').toLowerCase().includes('ceo') ? 'main' : 'subagent'),
      runtime: session.runtime,
      role: session.role,
      taskId: session.taskId || null,
      cwd: session.cwd || session.projectRoot || '',
      status: session.status,
      lifecycle: lifecycleForSession(session),
      runtimeState: runtimeStateForSession(session),
      managedByCurrentServer: Boolean(session.managedByCurrentServer),
      control: controlForSession(session),
      parentAgentId: session.parentAgentId || null,
      parentNodeId: session.parentNodeId || null,
      subagentMode: subagentModeForSnapshot(session.subagentMode),
      ...configSummary,
      position: persisted.positions?.[graphNodeIdForSession(session)]
        || persisted.positions?.[`session-${session.sessionId}`]
        || persistedByNodeId.get(graphNodeIdForSession(session))?.position
        || persistedBySessionId.get(session.sessionId)?.position
        || null,
    };
  });
  const graphNodes = [...sessionNodes, ...componentNodes, ...eventNodes, ...capabilityNodes, ...goalNodes];
  const bySessionId = new Map(sessionNodes.map(node => [node.sessionId, node]));
  const byNodeId = new Map(graphNodes.map(node => [node.nodeId, node]));
  const edgesById = new Map();
  const edgePairs = new Set();

  for (const edge of persisted.edges) {
    const edgeFrom = edge.from || edge.source;
    const edgeTo = edge.to || edge.target;
    const fromNode = byNodeId.get(edgeFrom) || bySessionId.get(edge.fromSessionId || edgeFrom);
    const toNode = byNodeId.get(edgeTo) || bySessionId.get(edge.toSessionId || edgeTo);
    if (!fromNode || !toNode) continue;
    const direction = normalizeWorkflowEdgeDirection(edge.direction);
    const relation = edge.relation || 'wf-bridge';
    const pairKey = workflowEdgePairKey({ from: fromNode.nodeId, to: toNode.nodeId, direction });
    if (pairKey && edgePairs.has(pairKey)) continue;
    if (pairKey) edgePairs.add(pairKey);
    edgesById.set(edge.id || `${fromNode.nodeId}->${toNode.nodeId}`, {
      id: edge.id || `${fromNode.nodeId}->${toNode.nodeId}`,
      kind: edge.kind || (direction === 'source-to-target' && relation === 'event'
        ? 'event-link'
        : (fromNode.sessionId && toNode.sessionId ? 'communication-permission' : 'workflow-link')),
      from: fromNode.nodeId,
      to: toNode.nodeId,
      source: fromNode.nodeId,
      target: toNode.nodeId,
      fromSessionId: fromNode.sessionId || null,
      toSessionId: toNode.sessionId || null,
      relation,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      direction,
      offset: Number.isFinite(Number(edge.offset)) ? Number(edge.offset) : undefined,
    });
  }

  for (const node of sessionNodes) {
    if (!node.parentAgentId) continue;
    const parent = bySessionId.get(node.parentAgentId);
    if (!parent) continue;
    const id = `${parent.nodeId}->${node.nodeId}`;
    const pairKey = workflowEdgePairKey({ from: parent.nodeId, to: node.nodeId });
    if (pairKey && edgePairs.has(pairKey)) continue;
    if (pairKey) edgePairs.add(pairKey);
    edgesById.set(id, {
      id,
      kind: 'communication-permission',
      from: parent.nodeId,
      to: node.nodeId,
      source: parent.nodeId,
      target: node.nodeId,
      fromSessionId: parent.sessionId,
      toSessionId: node.sessionId,
      relation: 'wf-bridge',
      sourceHandle: null,
      targetHandle: null,
      direction: 'bidirectional',
    });
  }

  const edges = [...edgesById.values()];
  const capsuleDockLinks = Array.isArray(persisted.capsuleDockLinks) ? persisted.capsuleDockLinks : [];
  const capsuleDockConnectionEdges = capsuleDockLinks.flatMap(link => (
    Array.isArray(link.connections) ? link.connections : []
  ).map((connection) => {
    const fromNode = byNodeId.get(connection.source || connection.from);
    const toNode = byNodeId.get(connection.target || connection.to);
    if (!fromNode || !toNode) return null;
    const direction = normalizeWorkflowEdgeDirection(connection.direction);
    return {
      id: connection.id || `dock:${link.id}:${fromNode.nodeId}->${toNode.nodeId}`,
      kind: 'capsule-dock-link',
      from: fromNode.nodeId,
      to: toNode.nodeId,
      source: fromNode.nodeId,
      target: toNode.nodeId,
      fromSessionId: fromNode.sessionId || null,
      toSessionId: toNode.sessionId || null,
      relation: connection.relation || 'wf-bridge',
      sourceHandle: connection.sourceHandle || null,
      targetHandle: connection.targetHandle || null,
      direction,
      dockLinkId: link.id,
    };
  }).filter(Boolean));
  const contextEdges = dedupeWorkflowGraphEdgesBySemantic([...edges, ...capsuleDockConnectionEdges]);
  const graphContextBySessionId = {};
  for (const node of sessionNodes) {
    const outbound = contextEdges.filter(edge => edge.fromSessionId === node.sessionId).map(edge => edge.toSessionId);
    const inbound = contextEdges.filter(edge => edge.toSessionId === node.sessionId).map(edge => edge.fromSessionId);
    // Per-node Agent context is built by the canonical module (identical shape
    // to /api/workflow/context/:id). Session-enumeration extras stay local.
    const agentContext = buildAgentContext(projectRoot, node, persisted).context;
    graphContextBySessionId[node.sessionId] = {
      ...agentContext,
      agentKind: node.agentKind,
      parentAgentId: node.parentAgentId || inbound[0] || null,
      connectedPeerIds: [...new Set([...outbound, ...inbound])],
      outboundPeerIds: outbound,
      inboundPeerIds: inbound,
    };
  }

  return {
    graph: {
      schemaVersion: 1,
      workflowId,
      version: persisted.version,
      nodes: graphNodes,
      edges,
      capsuleDockLinks,
      positions: persisted.positions || {},
      undoStack: persisted.undoStack,
      redoStack: persisted.redoStack,
      deletedNodes: persisted.deletedNodes || [],
      componentStateRefs: componentRefs,
      eventStateRefs: eventRefs,
      goalStateRefs: goalRefs,
      graphContextPath: graphMapPath(projectRoot),
    },
    graphContextBySessionId,
  };
}

function readActiveTaskId(projectRoot) {
  const progressPath = path.join(projectRoot, 'Harness', 'PROGRESS.md');
  try {
    const content = fs.readFileSync(progressPath, 'utf8');
    const marker = content.match(/## Active Task\s+^- ([^\r\n]+)/m);
    if (marker) return marker[1].trim();
  } catch {
    return null;
  }
  return null;
}

function activeTask(projectRoot) {
  const tasksRoot = path.join(projectRoot, 'Harness', 'tasks');
  const activeTaskId = readActiveTaskId(projectRoot);
  if (activeTaskId) {
    const capsule = parseTaskCapsule(path.join(tasksRoot, activeTaskId));
    if (capsule) return capsule;
  }
  return parseTaskList(tasksRoot)[0] || null;
}

function subagentModeForSnapshot(value) {
  const mode = String(value || 'built-in-subagents');
  // Backward compat: legacy 'wf-subagents' sessions are exposed under the
  // canonical 'wf-node-subagents' id in snapshots.
  return mode === 'wf-subagents' ? 'wf-node-subagents' : mode;
}

// ── Snapshot memo (P1a) ───────────────────────────────────────────────────────
// Full snapshots rescan every session dir (~1s). Memoize on the cheap state
// fingerprint with a short TTL; writes and the WS watcher call
// invalidateSnapshotCache() so disk changes are never served longer than TTL.
const SNAPSHOT_MEMO_TTL_MS = 250;
const SESSION_CACHE_FRESH_MS = 1500;
const snapshotMemo = new Map(); // projectRoot -> { fingerprint, builtAt, snapshot }
const sessionStateCache = new Map(); // `${projectRoot}\u0000${sessionId}` -> { mtimeMs, size, state }

// Clears the memo + session-scan cache for a project root. Safe to call at any
// time (e.g. from the WS watcher on external disk changes): never throws.
export function invalidateSnapshotCache(projectRoot) {
  try {
    snapshotMemo.delete(projectRoot);
    const prefix = `${projectRoot}\u0000`;
    for (const key of sessionStateCache.keys()) {
      if (key.startsWith(prefix)) sessionStateCache.delete(key);
    }
  } catch {
    // No-op: invalidation is best-effort.
  }
}

// Session-scan cache for the snapshot path: a session's STATE.json is re-read
// only when its dir mtime or size changed. The dir listing stays live so new /
// removed session dirs are seen immediately. Mirror of
// terminal-store.listTerminalSessions (kept local; terminal-store is untouched).
function cachedListTerminalSessions(projectRoot) {
  const tasksRoot = path.join(projectRoot, 'Harness', 'tasks');
  const dirs = [];
  let taskEntries = [];
  try {
    taskEntries = fs.readdirSync(tasksRoot, { withFileTypes: true });
  } catch {
    taskEntries = [];
  }
  for (const taskEntry of taskEntries) {
    if (!taskEntry.isDirectory() || taskEntry.name.startsWith('_')) continue;
    const sessionsRoot = path.join(tasksRoot, taskEntry.name, 'sessions');
    let sessionEntries = [];
    try {
      sessionEntries = fs.readdirSync(sessionsRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sessionEntry of sessionEntries) {
      if (sessionEntry.isDirectory()) dirs.push(path.join(sessionsRoot, sessionEntry.name));
    }
  }
  const a2aSessionsRoot = path.join(projectRoot, 'Harness', 'a2a', 'sessions');
  try {
    for (const sessionEntry of fs.readdirSync(a2aSessionsRoot, { withFileTypes: true })) {
      if (sessionEntry.isDirectory()) dirs.push(path.join(a2aSessionsRoot, sessionEntry.name));
    }
  } catch {
    // No unbound A2A sessions yet.
  }
  const sessions = [];
  for (const dir of dirs) {
    const statePath = path.join(dir, 'STATE.json');
    let stat = null;
    try {
      stat = fs.statSync(statePath);
    } catch {
      continue;
    }
    const key = `${projectRoot}\u0000${path.basename(dir)}`;
    const cached = sessionStateCache.get(key);
    // Fresh-file guard: files modified within the last 1.5s are always
    // re-read. mtimeMs has ms granularity, so two same-size rewrites inside
    // one millisecond (fast test sequences, restart flows) would otherwise
    // hit a stale cache entry forever.
    const freshlyWritten = Date.now() - stat.mtimeMs < SESSION_CACHE_FRESH_MS;
    if (cached && !freshlyWritten && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      if (cached.state !== null) sessions.push(cached.state);
      continue;
    }
    const state = readJson(statePath, null);
    sessionStateCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, state });
    if (state) sessions.push(state);
  }
  return sessions;
}

// Cheap state fingerprint for incremental snapshot polling (P1a): the graph
// version + session index summary (in-memory, no per-request dir scan).
export function stateFingerprint(projectRoot) {
  const { count, latestUpdatedAt } = getSessionIndexSummary();
  const graph = loadWorkflowGraphMap(projectRoot);
  let mapMeta = '';
  try {
    const st = fs.statSync(graphMapPath(projectRoot));
    mapMeta = `${st.mtimeMs}|${st.size}`;
  } catch {
    // Graph map missing — the version term above already reflects that.
  }
  return `${graph.version || 0}|${count}|${latestUpdatedAt || ''}|${mapMeta}`;
}

// Memoized snapshot build: same shape as always; a memo hit within the TTL
// returns the previous object (safe — the server only serializes it).
export function buildWorkflowSnapshot(projectRoot, sessionRegistry) {
  const fingerprint = stateFingerprint(projectRoot);
  const memo = snapshotMemo.get(projectRoot);
  if (memo && memo.fingerprint === fingerprint && Date.now() - memo.builtAt < SNAPSHOT_MEMO_TTL_MS) {
    return memo.snapshot;
  }
  const snapshot = buildWorkflowSnapshotInner(projectRoot, sessionRegistry);
  snapshotMemo.set(projectRoot, { fingerprint, builtAt: Date.now(), snapshot });
  return snapshot;
}

function buildWorkflowSnapshotInner(projectRoot, sessionRegistry) {
  const roleGraph = loadRoleGraph(projectRoot);
  const task = activeTask(projectRoot);
  const memorySessions = sessionRegistry && typeof sessionRegistry.getAll === 'function'
    ? sessionRegistry.getAll()
    : [];
  const diskSessions = cachedListTerminalSessions(projectRoot);
  const bySessionId = new Map();
  const currentSessionIds = new Set(memorySessions.map(session => session.sessionId));
  const liveSessionIds = new Set(memorySessions.map(session => session.sessionId));
  for (const session of diskSessions) {
    const orphanedLiveState = !liveSessionIds.has(session.sessionId) && ['running', 'starting'].includes(session.status);
    bySessionId.set(session.sessionId, orphanedLiveState
      ? { ...session, status: session.status, attachMode: false, blockedReason: session.blockedReason || 'not-managed-by-current-wf-ui' }
      : { ...session, status: normalizeSessionStatus(session.status) });
  }
  for (const session of memorySessions) {
    bySessionId.set(session.sessionId, { ...bySessionId.get(session.sessionId), ...session, status: normalizeSessionStatus(session.status) });
  }
  const sessions = [...bySessionId.values()]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const persisted = loadWorkflowGraphMap(projectRoot);
  const persistedNodeIds = new Set((persisted.nodes || []).map(node => node.nodeId || node.id).filter(Boolean));
  const persistedSessionIds = new Set((persisted.nodes || []).map(node => node.sessionId).filter(Boolean));
  const visibleSessions = sessions
    .map((session) => {
      const persistedBySession = (persisted.nodes || []).find(node => node.sessionId === session.sessionId);
      return {
        ...session,
        managedByCurrentServer: currentSessionIds.has(session.sessionId),
        graphNodeId: session.graphNodeId || persistedBySession?.nodeId || graphNodeIdForSession(session),
      };
    })
    .filter((session) => {
      if (session.graphReplacedBySessionId && !currentSessionIds.has(session.sessionId)) return false;
      return (
        currentSessionIds.has(session.sessionId)
        || persistedSessionIds.has(session.sessionId)
        || isLiveStatus(session.status)
        || persistedNodeIds.has(graphNodeIdForSession(session))
      );
    });

  const roleNodes = roleGraph.agents.map((agent) => ({
    id: agent.agentId,
    label: agent.role,
    kind: agent.kind,
    level: agent.level,
    status: agent.agentId === 'ceo' ? (task?.status || 'idle') : 'ready',
    skills: agent.skills || [],
    permissions: agent.permissions || [],
  }));

  const nodes = [];
  for (const session of visibleSessions) {
    const isWorkflowCeo = session.workflowMode === 'wf' && String(session.role || '').toLowerCase().includes('ceo');
    const graphNodeId = graphNodeIdForSession(session);
    const lifecycle = lifecycleForSession(session);
    const runtimeState = runtimeStateForSession(session);
    const control = controlForSession(session);
    const status = normalizeSessionStatus(session.status);
    const configSummary = nodeConfigSummary(session);
    nodes.push({
      id: graphNodeId,
      label: isWorkflowCeo ? `${session.runtime} WF CEO` : `${session.runtime} ${session.agentKind === 'main' ? 'main agent' : 'subagent'}`,
      kind: 'terminal-session',
      level: isWorkflowCeo ? 1 : 2,
      status,
      lifecycle,
      runtimeState,
      managedByCurrentServer: Boolean(session.managedByCurrentServer),
      control,
      blockedReason: session.blockedReason,
      sessionId: session.sessionId,
      taskId: session.taskId,
      agentKind: session.agentKind,
      role: session.role,
      displayName: session.displayName ?? '',
      roleTitle: session.roleTitle ?? '',
      peerId: session.peerId,
      runtime: session.runtime,
      model: session.model,
      provider: session.provider,
      subagentMode: subagentModeForSnapshot(session.subagentMode),
      workflowMode: session.workflowMode,
      objective: session.objective,
      cwd: session.cwd,
      graphNodeId,
      parentAgentId: session.parentAgentId || null,
      parentNodeId: session.parentNodeId || null,
      nodeHomePath: session.nodeHomePath || '',
      nodeHomeRel: session.nodeHomeRel || '',
      nodeInitPath: session.nodeInitPath || '',
      nodeInitRel: session.nodeInitRel || '',
      ...configSummary,
    });
  }
  for (const componentNode of listLiveComponentNodes(projectRoot)) {
    nodes.push({
      ...componentNode,
      label: componentNode.title,
      level: 2,
      status: 'ready',
    });
  }
  for (const eventNode of listEventNodes(projectRoot)) {
    nodes.push({
      ...eventNode,
      label: eventNode.title,
      level: 2,
      status: 'ready',
      lifecycle: 'event-source',
      runtimeState: 'ready',
    });
  }
  for (const goalNode of visibleGoalNodes(projectRoot, persisted)) {
    nodes.push({
      ...goalNode,
      label: goalNode.title,
      level: 1,
      status: goalNode.status || 'active',
      lifecycle: 'goal-anchor',
      runtimeState: goalNode.runtimeState || goalNode.status || 'active',
    });
  }

  const workflowId = task ? `workflow-${task.taskId}` : 'workflow-none';
  const { graph, graphContextBySessionId } = buildSessionGraph(projectRoot, workflowId, visibleSessions);
  const nodeIdsByGraphId = new Map(nodes
    .map(node => [node.graphNodeId || node.nodeId || node.id, node.id])
    .filter(([key]) => key));
  const edges = graph.edges
    .map(edge => ({
      id: edge.id || `${edge.from}->${edge.to}`,
      from: nodeIdsByGraphId.get(edge.from) || edge.from,
      to: nodeIdsByGraphId.get(edge.to) || edge.to,
      source: nodeIdsByGraphId.get(edge.source || edge.from) || edge.source || edge.from,
      target: nodeIdsByGraphId.get(edge.target || edge.to) || edge.target || edge.to,
      relation: edge.relation || 'wf-bridge',
      fromSessionId: edge.fromSessionId || null,
      toSessionId: edge.toSessionId || null,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      direction: normalizeWorkflowEdgeDirection(edge.direction),
      offset: Number.isFinite(Number(edge.offset)) ? Number(edge.offset) : undefined,
    }))
    .filter(edge => edge.from && edge.to);

  return {
    schemaVersion: 1,
    snapshotVersion: graph.version,
    generatedAt: new Date().toISOString(),
    workflowId,
    taskId: task?.taskId || null,
    mode: task?.mode || null,
    phase: task?.phase || null,
    gate: task?.gate || null,
    rootAgentId: roleGraph.rootAgentId,
    subagentModes: [
      { id: 'built-in-subagents', label: 'Built-in Subagents' },
      { id: 'wf-node-subagents', label: 'WF Node Subagents' },
    ],
    availableWorkflows: loadBuiltInWorkflows(projectRoot),
    roles: {
      nodes: roleNodes,
      edges: roleGraph.edges,
    },
    queues: task ? {
      dependsOn: task.dependsOn,
      blocks: task.blocks,
      acceptance: task.acceptance,
    } : null,
    workflow: {
      operations: workflowOperationsSnapshot(projectRoot),
    },
    nodes,
    edges,
    sessions,
    graph,
    componentNodes: componentNodeStatesForSnapshot(projectRoot),
    eventNodes: eventNodeStates(projectRoot),
    capabilityNodes: capabilityNodeStates(projectRoot),
    goalNodes: visibleGoalStateRecord(projectRoot, graph),
    graphContextBySessionId,
  };
}
