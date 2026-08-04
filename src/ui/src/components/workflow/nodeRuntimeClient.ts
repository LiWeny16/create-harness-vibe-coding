// Types matching backend WorkflowRuntimeNode shape
export interface WorkflowRuntimeNode {
  nodeId: string;
  kind: 'markdown' | 'excalidraw' | 'file' | 'agent';
  version: number;
  lifecycle: string;
  status: { state: string; reason?: string; updatedAt: string };
  sessionId?: string | null;
  graph: {
    position: { x: number; y: number };
    size?: { width: number; height: number };
    handles: Array<{ id: string; role: 'input' | 'output'; type: string; label: string }>;
    connections: Array<{
      edgeId: string;
      peerNodeId: string;
      endpointRole: 'source' | 'target';
      localHandle: string | null;
      peerHandle: string | null;
      sourceHandle: string | null;
      targetHandle: string | null;
      relation: string;
      direction: 'bidirectional';
    }>;
  };
  stateRef: { path: string; revision: number };
  contentRef?: Record<string, unknown>;
  settings: { schemaId: string; values: Record<string, unknown>; revision: number };
  capabilities: string[];
  ui: { previewKind: string; settingsPanel: string; testId: string; labels: Record<string, string> };
}

export interface NodeSettings {
  schemaId: string;
  values: Record<string, unknown>;
  revision: number;
}

export interface WorkflowRuntimeNodeResponse {
  ok?: boolean;
  node: WorkflowRuntimeNode;
  state?: Record<string, unknown>;
  revision?: number;
  settings?: NodeSettings;
  action?: string;
  result?: unknown;
}

// API functions using existing apiJson from '../api'
import { apiJson } from '../../api';

const BASE = '/api/workflow';

export async function fetchNodes(): Promise<WorkflowRuntimeNode[]> {
  const data = await apiJson<{ nodes: WorkflowRuntimeNode[] }>(`${BASE}/nodes`);
  return data.nodes || [];
}

export async function fetchNode(nodeId: string): Promise<WorkflowRuntimeNode> {
  const data = await apiJson<{ node: WorkflowRuntimeNode }>(`${BASE}/nodes/${encodeURIComponent(nodeId)}`);
  return data.node!;
}

export async function createNode(payload: {
  type: 'markdown' | 'excalidraw' | 'file';
  title?: string;
  position?: { x: number; y: number };
  markdown?: string;
  scene?: Record<string, unknown>;
  file?: Record<string, unknown>;
}): Promise<WorkflowRuntimeNode> {
  const data = await createNodeResponse(payload);
  return data.node!;
}

export async function createNodeResponse(payload: {
  type: 'markdown' | 'excalidraw' | 'file';
  title?: string;
  position?: { x: number; y: number };
  markdown?: string;
  scene?: Record<string, unknown>;
  file?: Record<string, unknown>;
}): Promise<WorkflowRuntimeNodeResponse> {
  return apiJson<WorkflowRuntimeNodeResponse>(`${BASE}/nodes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function patchNodeState(
  nodeId: string,
  patch: Record<string, unknown>,
): Promise<WorkflowRuntimeNode> {
  const data = await patchNodeStateResponse(nodeId, patch);
  return data.node!;
}

export async function patchNodeStateResponse(
  nodeId: string,
  patch: Record<string, unknown>,
): Promise<WorkflowRuntimeNodeResponse> {
  return apiJson<WorkflowRuntimeNodeResponse>(
    `${BASE}/nodes/${encodeURIComponent(nodeId)}/state`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

export async function patchNodeSettings(
  nodeId: string,
  patch: Record<string, unknown>,
): Promise<NodeSettings> {
  const data = await apiJson<{ settings: NodeSettings }>(
    `${BASE}/nodes/${encodeURIComponent(nodeId)}/settings`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return data.settings!;
}

export async function executeNodeAction(
  nodeId: string,
  action: string,
  payload?: unknown,
): Promise<unknown> {
  return executeNodeActionResponse(nodeId, action, payload);
}

export async function executeNodeActionResponse(
  nodeId: string,
  action: string,
  payload?: unknown,
): Promise<WorkflowRuntimeNodeResponse> {
  return apiJson<WorkflowRuntimeNodeResponse>(`${BASE}/nodes/${encodeURIComponent(nodeId)}/actions/${encodeURIComponent(action)}`, {
    method: 'POST',
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
}

export async function createEdge(
  from: string,
  to: string,
  opts?: { relation?: string; sourceHandle?: string; targetHandle?: string },
): Promise<{ edge: { id: string } }> {
  return apiJson(`${BASE}/edges`, {
    method: 'POST',
    body: JSON.stringify({ from, to, ...opts }),
  });
}

export async function deleteEdge(edgeId: string): Promise<{ ok: boolean }> {
  return apiJson(`${BASE}/edges/${encodeURIComponent(edgeId)}`, { method: 'DELETE' });
}

export async function fetchNodeContext(nodeId: string): Promise<unknown> {
  return apiJson(`${BASE}/context/${encodeURIComponent(nodeId)}`);
}
