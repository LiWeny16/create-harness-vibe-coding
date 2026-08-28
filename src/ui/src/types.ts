// Subagent orchestration mode for agent sessions. The canonical ids match the
// snapshot's `subagentModes` catalog (a2a-store.mjs); the legacy pre-catalog
// mode id is remapped to 'wf-node-subagents' by the backend.
export type SubagentMode = 'built-in-subagents' | 'wf-node-subagents';

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
  subagentMode?: SubagentMode;
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
  subagentMode?: SubagentMode;
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

export type WorkflowEdgeDirection = 'bidirectional' | 'source-to-target';

export type WorkflowEdge = {
  id?: string;
  from: string;
  to: string;
  source?: string;
  target?: string;
  relation: string;
  direction?: WorkflowEdgeDirection;
  sourceHandle?: string;
  targetHandle?: string;
  uiSourceHandle?: string;
  uiTargetHandle?: string;
  fromSessionId?: string;
  toSessionId?: string;
  offset?: number;
};

export type WorkflowOperation = {
  id: string;
  kind: string;
  actor?: {
    type?: string;
    kind?: string;
    nodeId?: string | null;
    sessionId?: string | null;
    agentKind?: string | null;
    label?: string | null;
  };
  targetNodeIds?: string[];
  edgeIds?: string[];
  status?: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  summary?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

export type WorkflowAgentControl = {
  active: boolean;
  operationId: string;
  actorNodeId?: string;
  color?: string;
};

export type WorkflowCapsuleRole = 'goal' | 'timer' | 'agent';

export type WorkflowCapsuleMode =
  | 'standalone'
  | 'goal-timer'
  | 'goal-agent'
  | 'timer-agent'
  | 'goal-loop';

export type WorkflowCapsuleLink = {
  nodeId: string;
  title: string;
  role: WorkflowCapsuleRole;
  relation: string;
  direction: WorkflowEdgeDirection;
  status?: string;
  edgeId?: string;
  handle?: string;
};

export type WorkflowCapsuleSummary = {
  nodeId: string;
  mode: WorkflowCapsuleMode;
  goals: WorkflowCapsuleLink[];
  timers: WorkflowCapsuleLink[];
  agents: WorkflowCapsuleLink[];
  stateLabel: string;
  nextLabel: string;
  protocolSteps: string[];
  sequenceLabel?: string;
  wdtState?: string;
};

export type WorkflowComponentType = 'markdown' | 'excalidraw' | 'file' | 'display';

export type WorkflowEventNodeType = 'timer' | 'github-trigger';

export type WorkflowEventNodeState = {
  nodeId: string;
  type: WorkflowEventNodeType | string;
  title: string;
  revision: number;
  enabled?: boolean;
  schedule?: {
    mode?: 'manual' | 'once' | 'interval' | 'cron' | 'loop' | 'adaptive' | 'watchdog' | 'while' | 'task' | string;
    intervalSeconds?: number;
    triggerAt?: string;
    cron?: string;
    cadence?: {
      kind?: 'fixed' | 'sequence' | 'backoff' | string;
      sequenceSeconds?: number[];
      jitterSeconds?: number;
      backoffFactor?: number;
      maxIntervalSeconds?: number;
      afterLast?: 'stop' | 'repeat-last' | 'cycle' | 'agent-decides' | string;
    };
  };
  heartbeat?: {
    base?: {
      enabled?: boolean;
      intervalSeconds?: number;
      lastAt?: string;
      nextDueAt?: string;
      count?: number;
    };
    watchdog?: {
      enabled?: boolean;
      intervalSeconds?: number;
      timeoutSeconds?: number;
      lastPingAt?: string;
      lastAckAt?: string;
      state?: string;
      missedCount?: number;
    };
  };
  loop?: Record<string, unknown>;
  whileGuard?: Record<string, unknown>;
  taskBinding?: Record<string, unknown>;
  controlPolicy?: Record<string, unknown>;
  payloadTemplate?: Record<string, unknown>;
  repository?: {
    owner?: string;
    name?: string;
    fullName?: string;
  } | null;
  eventFilters?: {
    events?: string[];
    actions?: string[];
    branches?: string[];
    labels?: string[];
  } | null;
  dedupeKeys?: string[];
  deliveryCount?: number;
  eventCount?: number;
  lastFiredAt?: string;
  lastReceivedAt?: string;
  lastDeliveryId?: string;
  lastEvent?: Record<string, unknown> | null;
  statePath?: string;
};

export type WorkflowGoalNodeState = {
  nodeId: string;
  type?: 'goal' | string;
  title: string;
  taskId: string;
  objective?: string;
  status: string;
  phase?: string | null;
  gate?: string | null;
  revision: number;
  acceptance?: { id?: string; text?: string; status?: string }[];
  planItems?: { id?: string; text?: string; status?: string; updatedBy?: string; updatedAt?: string }[];
  progress?: { verified?: number; total?: number };
  nextAction?: string;
  confirmation?: Record<string, unknown> | null;
  wdt?: {
    enabled?: boolean;
    state?: string;
    timerNodeId?: string;
    lastAckAt?: string;
  } | null;
  statePath?: string;
};

export type WorkflowCapabilityNodeType = 'skill-group' | 'mcp-connector';

export type WorkflowCapabilityNodeState = {
  nodeId: string;
  type: WorkflowCapabilityNodeType | string;
  title: string;
  revision: number;
  description?: string;
  sourceGroup?: {
    id?: string;
    label?: string;
    kind?: string;
  } | null;
  category?: string;
  tags?: string[];
  installSource?: {
    provider?: string;
    providerLabel?: string;
    packSlug?: string;
    packName?: string;
    version?: string;
    targetScope?: string;
    targetRuntime?: string;
    installedAt?: string;
    signature?: {
      present?: boolean;
      verified?: boolean;
      algorithm?: string;
      keyId?: string;
      signedAt?: string;
    };
    lockfileSignature?: {
      present?: boolean;
      verified?: boolean;
      algorithm?: string;
      keyId?: string;
      signedAt?: string;
    };
  } | null;
  lockRef?: string;
  loadStrategy?: string;
  skills?: {
    id?: string;
    name: string;
    title?: string;
    source?: string;
    state?: string;
  }[];
  skillNames?: string[];
  skillCount?: number;
  servers?: {
    id?: string;
    name: string;
    title?: string;
    kind?: string;
    nodeSemantics?: string;
    attachable?: boolean;
    creatable?: boolean;
    state?: string;
    transport?: string;
    commandName?: string;
    argCount?: number;
    url?: string;
    envKeys?: string[];
    risk?: {
      metadataOnly?: boolean;
      commandNotExecuted?: boolean;
      credentialsNotProbed?: boolean;
      secretsRedacted?: boolean;
    };
    sources?: {
      rootId?: string;
      label?: string;
      scope?: string;
      runtime?: string;
      relativePath?: string;
      path?: string;
    }[];
  }[];
  serverNames?: string[];
  serverCount?: number;
  transports?: string[];
  envKeyNames?: string[];
  envKeyCount?: number;
  redactedFieldCount?: number;
  nodeSemantics?: {
    role?: string;
    defaultConnection?: string;
    executor?: string;
    safety?: string;
  };
  statePath?: string;
};

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
  subagentModes?: { id: SubagentMode; label: string }[];
  roles?: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
  queues: {
    acceptance?: { id?: string; text?: string; status?: string }[];
    dependsOn?: string[];
    blocks?: string[];
  } | null;
  workflow?: {
    operations?: {
      schemaVersion?: number;
      source?: string;
      recent?: WorkflowOperation[];
    };
  };
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
      direction?: WorkflowEdgeDirection;
      sourceHandle?: string;
      targetHandle?: string;
      uiSourceHandle?: string;
      uiTargetHandle?: string;
      offset?: number;
    }[];
    capsuleDockLinks?: {
      id?: string;
      nodeIds?: string[];
      anchorId?: string;
      draggedId?: string;
      side?: 'left' | 'right' | 'top' | 'bottom';
      edges?: Array<string | { edgeId?: string; id?: string; retention?: 'keep' | 'delete-on-detach' }>;
      edgeIds?: string[];
      connections?: {
        id?: string;
        from?: string;
        to?: string;
        source?: string;
        target?: string;
        relation?: string;
        direction?: WorkflowEdgeDirection;
        sourceHandle?: string;
        targetHandle?: string;
      }[];
    }[];
    positions?: Record<string, { x: number; y: number }>;
    undoStack?: unknown[];
    redoStack?: unknown[];
    graphContextPath?: string;
    componentStatePath?: string;
    sourceOfTruth?: string;
  };
  componentNodes?: Record<string, WorkflowComponentNodeState>;
  eventNodes?: Record<string, WorkflowEventNodeState>;
  capabilityNodes?: Record<string, WorkflowCapabilityNodeState>;
  goalNodes?: Record<string, WorkflowGoalNodeState>;
  graphContextBySessionId?: Record<string, unknown>;
};
