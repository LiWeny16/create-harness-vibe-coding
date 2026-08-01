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
  pid?: number | null;
  exitCode?: number | null;
  ptyProvider?: string | null;
  resourceUsage?: {
    pid?: number | null;
    ptyProvider?: string | null;
    wsClientCount?: number;
    memoryBytes?: number | null;
    memoryMB?: number | null;
    cpuPercent?: number | null;
  };
  agentSessionId?: string | null;
  resumeSupported?: boolean;
  resumeArgs?: string[];
  resumeCommand?: string | null;
  subagentMode?: string;
  workflowMode?: string | null;
  model?: string;
  provider?: string;
  ceoPrompt?: string;
  agentKind?: 'main' | 'subagent' | string;
  cwd?: string;
  launchPolicy?: Record<string, unknown> | null;
  graphContext?: Record<string, unknown> | null;
  graphNodeId?: string;
  graphVersion?: number;
  graphContextPath?: string;
  parentAgentId?: string | null;
  parentNodeId?: string | null;
  nodeHomePath?: string;
  nodeHomeRel?: string;
  nodeInitPath?: string;
  nodeInitRel?: string;
  controlRequest?: ControlRequest | null;
};

export type ControlRequest = {
  requestId: string;
  type: string;
  status: 'pending' | 'resolved' | string;
  title?: string;
  message?: string;
  choices?: { id: string; label: string; description?: string }[];
  detectedAt?: string;
  resolvedAt?: string;
  choice?: string;
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

export type CleanupSummary = {
  generatedAt: string;
  applied: boolean;
  policy: Record<string, unknown>;
  sessions: {
    totalCount: number;
    stoppedCount?: number;
    eligibleCount: number;
    totalBytes: number;
    eligibleBytes: number;
  };
  tempLogs: {
    totalCount: number;
    eligibleCount: number;
    totalBytes: number;
    eligibleBytes: number;
  };
  totals: {
    eligibleCount: number;
    eligibleBytes: number;
  };
  targets: {
    sessions: { sessionId: string; status?: string; runtime?: string | null; relPath: string; bytes: number; updatedAt?: string | null }[];
    tempLogs: { name: string; relPath: string; bytes: number; updatedAt?: string | null; current?: boolean }[];
  };
  deleted?: {
    sessions: { sessionId: string; relPath: string; bytes: number }[];
    tempLogs: { name: string; relPath: string; bytes: number }[];
  };
  errors?: { relPath?: string; message: string }[];
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
  componentType?: 'markdown' | 'excalidraw' | string;
  type?: 'markdown' | 'excalidraw' | string;
  level: number;
  status?: string;
  lifecycle?: 'live' | 'stopping' | 'stopped' | 'deleted' | string;
  runtimeState?: string;
  managedByCurrentServer?: boolean;
  control?: {
    canReadGraph?: boolean;
    canModifyGraph?: boolean;
    canStart?: boolean;
    canStop?: boolean;
    canDelete?: boolean;
    canOpenTerminal?: boolean;
      canOpenTranscript?: boolean;
      canSendInput?: boolean;
      canCreateAgent?: boolean;
      canCreateComponentNode?: boolean;
    };
  blockedReason?: string;
  role?: string;
  skills?: string[];
  permissions?: string[] | Record<string, unknown>;
  sessionId?: string;
  taskId?: string | null;
  agentKind?: 'main' | 'subagent' | string;
  runtime?: string;
  peerId?: string;
  model?: string;
  provider?: string;
  subagentMode?: string;
  workflowMode?: string | null;
  objective?: string;
  cwd?: string;
  graphNodeId?: string;
  parentAgentId?: string | null;
  parentNodeId?: string | null;
  nodeHomePath?: string;
  nodeHomeRel?: string;
  nodeInitPath?: string;
  nodeInitRel?: string;
  config?: Partial<WorkflowNodeConfig>;
  restartRequired?: boolean;
  restartRequiredFields?: string[];
  revision?: number;
  statePath?: string;
  observableInputs?: string[];
  observableOutputs?: string[];
};

export type WorkflowNodeSkillPolicy = 'auto' | 'manual' | 'locked';

export type WorkflowNodeConfig = {
  role: string;
  customRole: string;
  prompt: string;
  model: string;
  provider: string;
  cwd: string;
  env: Record<string, unknown>;
  permissions: Record<string, unknown>;
  launchPolicy: Record<string, unknown>;
  outputRouting: {
    markdownDefaultEnabled: boolean;
    markdownTargetNodeId?: string;
    fallback?: 'oldest-connected-markdown' | string;
  };
  skills: string[];
  skillPolicy: WorkflowNodeSkillPolicy;
  recommendedSkills: string[];
  contextSources: string[];
  capabilities: string[];
};

export type WorkflowEdge = {
  id?: string;
  from: string;
  to: string;
  source?: string;
  target?: string;
  relation: string;
  sourceHandle?: string;
  targetHandle?: string;
  fromSessionId?: string;
  toSessionId?: string;
  offset?: number;
};

export type WorkflowComponentType = 'markdown' | 'excalidraw' | 'file';

export type WorkflowComponentNodeState = {
  nodeId: string;
  type: WorkflowComponentType;
  title: string;
  revision: number;
  markdown?: string;
  scene?: Record<string, unknown>;
  file?: {
    source?: 'workspace' | 'user-file' | string;
    kind?: 'file' | 'folder' | string;
    path: string;
    name?: string;
    mime?: string;
    size?: number;
  };
  observableInputs?: string[];
  observableOutputs?: string[];
  statePath?: string;
};

export type BuiltInWorkflow = {
  id: string;
  command: string;
  label: string;
  description?: string;
  defaultCeoPrompt?: string;
};

export type WorkflowSnapshot = {
  schemaVersion?: number;
  snapshotVersion?: number;
  generatedAt?: string;
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
  graph?: {
    schemaVersion: number;
    workflowId?: string;
    version: number;
    nodes: {
      nodeId: string;
      sessionId?: string;
      kind?: string;
      componentType?: string;
      type?: string;
      agentKind?: string;
      runtime?: string;
      status?: string;
      lifecycle?: string;
      runtimeState?: string;
      managedByCurrentServer?: boolean;
      control?: WorkflowNode['control'];
      parentAgentId?: string | null;
      taskId?: string | null;
      cwd?: string;
      position?: { x: number; y: number } | null;
      config?: Partial<WorkflowNodeConfig>;
      restartRequired?: boolean;
      restartRequiredFields?: string[];
      statePath?: string;
      revision?: number;
      observableInputs?: string[];
      observableOutputs?: string[];
    }[];
    edges: {
      id: string;
      kind?: string;
      from?: string;
      to?: string;
      source?: string;
      target?: string;
      fromSessionId?: string;
      toSessionId?: string;
      relation?: string;
      sourceHandle?: string;
      targetHandle?: string;
      offset?: number;
    }[];
    positions?: Record<string, { x: number; y: number }>;
    undoStack?: unknown[];
    redoStack?: unknown[];
    graphContextPath?: string;
    componentStatePath?: string;
    sourceOfTruth?: string;
  };
  componentNodes?: Record<string, WorkflowComponentNodeState>;
  graphContextBySessionId?: Record<string, unknown>;
};
