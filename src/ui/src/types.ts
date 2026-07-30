export type Session = {
  sessionId: string;
  taskId?: string | null;
  peerId?: string;
  runtime: string;
  role?: string;
  objective?: string;
  status: string;
  attachMode?: boolean;
  wsClientCount?: number;
  startedAt?: string;
  updatedAt?: string;
  blockedReason?: string | null;
  blockedHint?: string | null;
  ptyProvider?: string | null;
  agentSessionId?: string | null;
  resumeSupported?: boolean;
  resumeArgs?: string[];
  resumeCommand?: string | null;
  subagentMode?: string;
  workflowMode?: string | null;
  model?: string;
  provider?: string;
  ceoPrompt?: string;
};

export type RuntimeConfigFile = {
  scope: string;
  path: string;
  absolutePath: string;
  format: 'json' | 'toml' | string;
  fields: Record<string, string>;
  values: Record<string, string>;
  exists: boolean;
  writable: boolean;
};

export type RuntimeInfo = {
  id: string;
  label: string;
  command: string;
  path: string | null;
  version: string | null;
  status: string;
  launchable: boolean;
  adapterStatus: string;
  blockedReason?: string | null;
  capabilities: string[];
  configFiles?: RuntimeConfigFile[];
};

export type TaskOption = {
  taskId: string;
  status?: string;
  phase?: string | null;
};

export type WorkflowNode = {
  id: string;
  label: string;
  kind: string;
  level: number;
  status?: string;
  skills?: string[];
  permissions?: string[];
  sessionId?: string;
  taskId?: string | null;
  runtime?: string;
  peerId?: string;
  model?: string;
  provider?: string;
  subagentMode?: string;
  workflowMode?: string | null;
  objective?: string;
};

export type WorkflowEdge = { from: string; to: string; relation: string };

export type BuiltInWorkflow = {
  id: string;
  command: string;
  label: string;
  description?: string;
  defaultCeoPrompt?: string;
};

export type WorkflowSnapshot = {
  workflowId: string;
  taskId: string | null;
  mode: string | null;
  phase: string | null;
  gate: string | null;
  rootAgentId: string;
  availableWorkflows?: BuiltInWorkflow[];
  subagentModes?: { id: string; label: string }[];
  roles?: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
  queues: {
    acceptance?: { id?: string; text?: string; status?: string }[];
    dependsOn?: string[];
    blocks?: string[];
  } | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  sessions?: Session[];
};
