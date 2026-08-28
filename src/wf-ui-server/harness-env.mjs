// Shared identity env for agent spawns. Extracted from pty-adapter.mjs so the
// PTY path and chat stdio drivers inject the exact same HARNESS_* identity
// keys; only TERM differs (xterm-256color for TUIs, dumb for chat spawns).
export function buildHarnessEnvSession({
  runtime,
  agentKind = '',
  workflowMode = '',
  graphNodeId = '',
  graphContextPath = '',
  nodeHomePath = '',
  nodeInitPath = '',
  subagentMode = '',
  controlPlaneUrl = '',
  taskId = '',
  peerId = '',
  sessionId = '',
} = {}, { term = 'xterm-256color' } = {}) {
  return {
    ...process.env,
    HARNESS_PEER_RUNTIME: runtime,
    HARNESS_AGENT_KIND: agentKind || '',
    HARNESS_WORKFLOW_MODE: workflowMode || '',
    HARNESS_WORKFLOW_NODE_ID: graphNodeId || '',
    HARNESS_WORKFLOW_MAP: graphContextPath || '',
    HARNESS_NODE_HOME: nodeHomePath || '',
    HARNESS_NODE_INIT: nodeInitPath || '',
    HARNESS_SUBAGENT_MODE: subagentMode || '',
    HARNESS_WF_UI_URL: controlPlaneUrl || '',
    WF_UI_URL: controlPlaneUrl || '',
    CLAUDE_PEER_TASK_ID: taskId || '',
    HARNESS_PEER_TASK_ID: taskId || '',
    CLAUDE_PEER_ID: peerId,
    HARNESS_PEER_SESSION_ID: sessionId,
    TERM: term,
  };
}
