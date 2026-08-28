// Types matching backend WorkflowRuntimeNode shape
export type WorkflowEdgeDirection = 'bidirectional' | 'source-to-target';

export interface WorkflowOperation {
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
  error?: { code?: string; message?: string };
}

export interface WorkflowRuntimeNode {
  nodeId: string;
  kind: 'markdown' | 'excalidraw' | 'file' | 'display' | 'agent' | 'timer' | 'github-trigger' | 'skill-group' | 'mcp-connector' | 'goal';
  version: number;
  lifecycle: string;
  status: { state: string; reason?: string; updatedAt: string };
  sessionId?: string | null;
  graph: {
    position: { x: number; y: number };
    size?: { width: number; height: number };
    handles:
      | Array<{ id: string; role: 'input' | 'output' | 'bidirectional'; type: string; label: string }>
      | {
          inputs?: string[];
          outputs?: string[];
          bidirectional?: string[];
          ports?: string[];
          physical?: string[];
        };
    connections: Array<{
      edgeId: string;
      peerNodeId: string;
      endpointRole: 'source' | 'target';
      localHandle: string | null;
      peerHandle: string | null;
      sourceHandle: string | null;
      targetHandle: string | null;
      relation: string;
      direction: WorkflowEdgeDirection;
    }>;
  };
  stateRef: { path: string; revision: number };
  contentRef?: Record<string, unknown>;
  taskId?: string;
  title?: string;
  objective?: string;
  acceptance?: Array<Record<string, unknown>>;
  planItems?: Array<Record<string, unknown>>;
  progress?: Record<string, unknown>;
  nextAction?: string;
  confirmation?: Record<string, unknown> | null;
  wdt?: Record<string, unknown> | null;
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
  operation?: WorkflowOperation;
}

export interface WorkflowSkillHubSource {
  rootId: string;
  label: string;
  scope: 'project' | 'user' | string;
  runtime: string;
  relativePath: string;
  path: string;
}

export interface WorkflowSkillHubSkill {
  id: string;
  name: string;
  title: string;
  description: string;
  kind: 'skill';
  nodeSemantics: 'agent-attached-capability-provider' | string;
  attachable: boolean;
  state: 'indexed' | string;
  sources: WorkflowSkillHubSource[];
}

export interface WorkflowSkillHubGroup {
  id: string;
  label: string;
  kind: string;
  skillIds: string[];
}

export interface WorkflowSkillsHubResponse {
  ok: boolean;
  schemaVersion: number;
  kind: 'skills-hub';
  generatedAt: string;
  query: {
    scope: 'project' | 'user' | 'all' | string;
    q: string;
    limit: number;
  };
  roots: Array<{
    id: string;
    label: string;
    scope: 'project' | 'user' | string;
    runtime: string;
    exists: boolean;
    path: string;
  }>;
  summary: {
    skillCount: number;
    groupCount: number;
    sourceCount: number;
  };
  installTargets?: WorkflowSkillInstallTarget[];
  nodeSemantics: {
    role: string;
    defaultConnection: string;
    executor: string;
  };
  skills: WorkflowSkillHubSkill[];
  groups: WorkflowSkillHubGroup[];
}

export interface WorkflowSkillInstallTarget {
  id: string;
  label: string;
  scope: 'project' | 'user' | string;
  runtime: string;
  default?: boolean;
  path: string;
}

export interface WorkflowMcpHubSource {
  rootId: string;
  label: string;
  scope: 'project' | string;
  runtime: string;
  relativePath: string;
  path: string;
}

export interface WorkflowMcpHubServer {
  id: string;
  name: string;
  title: string;
  kind: 'mcp-server';
  nodeSemantics: 'agent-attached-mcp-provider' | string;
  attachable: boolean;
  creatable: boolean;
  state: 'indexed' | string;
  transport: string;
  commandName?: string;
  argCount?: number;
  url?: string;
  envKeys: string[];
  risk: {
    metadataOnly: boolean;
    commandNotExecuted: boolean;
    credentialsNotProbed: boolean;
    secretsRedacted: boolean;
  };
  sources: WorkflowMcpHubSource[];
}

export interface WorkflowMcpHubGroup {
  id: string;
  label: string;
  kind: string;
  serverIds: string[];
}

export interface WorkflowMcpHubResponse {
  ok: boolean;
  schemaVersion: number;
  kind: 'mcp-hub';
  generatedAt: string;
  query: {
    scope: 'project' | string;
    q: string;
    limit: number;
  };
  roots: Array<{
    id: string;
    label: string;
    scope: 'project' | string;
    runtime: string;
    exists: boolean;
    path: string;
  }>;
  summary: {
    serverCount: number;
    groupCount: number;
    sourceCount: number;
    envKeyCount: number;
    redactedFieldCount: number;
  };
  nodeSemantics: {
    role: string;
    defaultConnection: string;
    executor: string;
    safety: string;
  };
  servers: WorkflowMcpHubServer[];
  groups: WorkflowMcpHubGroup[];
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
  type: 'markdown' | 'excalidraw' | 'file' | 'display' | 'timer' | 'github-trigger' | 'skill-group' | 'mcp-connector' | 'goal';
  title?: string;
  position?: { x: number; y: number };
  enabled?: boolean;
  markdown?: string;
  scene?: Record<string, unknown>;
  file?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  heartbeat?: Record<string, unknown>;
  loop?: Record<string, unknown>;
  whileGuard?: Record<string, unknown>;
  taskBinding?: Record<string, unknown>;
  controlPolicy?: Record<string, unknown>;
  payloadTemplate?: Record<string, unknown>;
  repository?: Record<string, unknown>;
  eventFilters?: Record<string, unknown>;
  description?: string;
  sourceGroup?: Record<string, unknown>;
  category?: string;
  tags?: string[];
  installSource?: Record<string, unknown>;
  lockRef?: string;
  loadStrategy?: string;
  skills?: Record<string, unknown>[];
  mcpServerId?: string;
  serverId?: string;
  server?: Record<string, unknown>;
  servers?: Record<string, unknown>[];
}): Promise<WorkflowRuntimeNode> {
  const data = await createNodeResponse(payload);
  return data.node!;
}

export async function createNodeResponse(payload: {
  type: 'markdown' | 'excalidraw' | 'file' | 'display' | 'timer' | 'github-trigger' | 'skill-group' | 'mcp-connector' | 'goal';
  title?: string;
  position?: { x: number; y: number };
  enabled?: boolean;
  markdown?: string;
  scene?: Record<string, unknown>;
  file?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  heartbeat?: Record<string, unknown>;
  loop?: Record<string, unknown>;
  whileGuard?: Record<string, unknown>;
  taskBinding?: Record<string, unknown>;
  controlPolicy?: Record<string, unknown>;
  payloadTemplate?: Record<string, unknown>;
  repository?: Record<string, unknown>;
  eventFilters?: Record<string, unknown>;
  description?: string;
  sourceGroup?: Record<string, unknown>;
  category?: string;
  tags?: string[];
  installSource?: Record<string, unknown>;
  lockRef?: string;
  loadStrategy?: string;
  skills?: Record<string, unknown>[];
  mcpServerId?: string;
  serverId?: string;
  server?: Record<string, unknown>;
  servers?: Record<string, unknown>[];
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

// File node action result shapes. These mirror the backend File adapter in
// src/wf-ui-server/workflow-node-types/file-node.mjs. The action handlers'
// raw return values are placed under `result` on the WorkflowRuntimeNodeResponse
// envelope by the component-node dispatch path (see workflow-node-runtime.mjs).

export interface FileMetaFile {
  source?: string;
  path: string;
  name?: string;
  mime?: string;
  size?: number;
  exists?: boolean;
  stale?: boolean;
}

export interface FileMetaResult {
  file: FileMetaFile;
}

export interface FileReadTextOptions {
  offset?: number;
  limit?: number;
}

export interface FileReadTextResult {
  text: string;
  bytesRead?: number;
  truncated?: boolean;
}

export interface FileWriteTextResult {
  ok?: boolean;
  path?: string;
  bytes?: number;
  mtime?: string;
  revision?: number;
  opId?: string;
}

export type FilePreviewKind = 'text' | 'image' | 'video' | 'pdf' | 'missing' | 'none' | string;

export interface FilePreviewResult {
  ok?: boolean;
  path: string;
  previewKind: FilePreviewKind;
  mime?: string;
  size?: number;
  meta?: Record<string, unknown>;
  available?: boolean;
  textSnippet?: string;
  textTruncated?: boolean;
}

/**
 * file.meta — metadata for the workspace file bound to the node.
 * Backend action: `file.meta` (alias of `file.readMeta`).
 */
export async function fileMeta(nodeId: string): Promise<FileMetaResult> {
  const data = await executeNodeActionResponse(nodeId, 'file.meta');
  const result = data.result as FileMetaResult | undefined;
  return result ?? { file: { path: '' } };
}

/**
 * file.readText — bounded UTF-8 text read for text-like files.
 * Backend action: `file.readText`.
 */
export async function fileReadText(
  nodeId: string,
  opts: FileReadTextOptions = {},
): Promise<FileReadTextResult> {
  const payload: Record<string, unknown> = {};
  if (opts.offset !== undefined) payload.offset = opts.offset;
  if (opts.limit !== undefined) payload.limit = opts.limit;
  const data = await executeNodeActionResponse(nodeId, 'file.readText', payload);
  const result = data.result as FileReadTextResult | undefined;
  return result ?? { text: '' };
}

/**
 * file.writeText — full-file UTF-8 text write routed through the workspace
 * boundary (applyWorkspaceOperation({op:'write'})). Backend action: `file.writeText`.
 */
export async function fileWriteText(
  nodeId: string,
  payload: { content: string },
): Promise<FileWriteTextResult> {
  const data = await executeNodeActionResponse(nodeId, 'file.writeText', payload);
  return (data.result as FileWriteTextResult | undefined) ?? {};
}

/**
 * file.preview — single-call preview metadata for the bound file.
 * Returns previewKind (image|video|pdf|text|missing|none) plus a bounded
 * textSnippet for text-kind files. PDF is preview-only (no text extraction).
 * Backend action: `file.preview`.
 */
export async function filePreview(nodeId: string): Promise<FilePreviewResult> {
  const data = await executeNodeActionResponse(nodeId, 'file.preview');
  const result = data.result as FilePreviewResult | undefined;
  return result ?? { path: '', previewKind: 'none' };
}

// ── W3 structured readers (AC-9): xlsx / pdf-text / zip ─────────────────────
// Result shapes mirror file-format-adapters.mjs. Raw handler returns are placed
// under `result` on the WorkflowRuntimeNodeResponse envelope by the component
// dispatch path (workflow-node-runtime.mjs), so every wrapper reads data.result.

export interface FileReadXlsxResult {
  ok?: boolean;
  sheets: string[];
}

export interface FileReadXlsxSheetResult {
  sheet: string | number;
  headers: unknown[][];
  rows: unknown[][];
  page: number;
  pageSize: number;
  totalPages: number | null;
}

export interface FileReadPdfResult {
  totalPages: number;
  metadata: Record<string, unknown>;
}

export interface FileReadPdfPageResult {
  page: number;
  pageCount: number;
  text: string;
  isEvalSupported: boolean;
}

export interface FileZipEntry {
  name: string;
  size: number;
  compressedSize: number;
  directory: boolean;
  isUtf8: boolean;
}

export interface FileReadZipEntriesResult {
  ok?: boolean;
  entries: FileZipEntry[];
}

export interface FileReadZipEntryResult {
  entryName: string;
  text: string;
  truncated: boolean;
  bytes: number;
}

export interface FileExtractZipEntryResult {
  ok?: boolean;
  path: string;
  bytes: number;
  entryName: string;
}

/**
 * file.readXlsx — list sheet names in the bound workbook.
 * Backend action: `file.readXlsx`.
 */
export async function fileReadXlsx(nodeId: string): Promise<FileReadXlsxResult> {
  const data = await executeNodeActionResponse(nodeId, 'file.readXlsx');
  const result = data.result as FileReadXlsxResult | undefined;
  return result && Array.isArray(result.sheets) ? result : { sheets: [] };
}

/**
 * file.readXlsxSheet — paginated rows for one sheet. The backend splits the
 * column header (rows[0]) out of the returned page; page/pageSize default to
 * 1/100 on the server. Backend action: `file.readXlsxSheet`.
 */
export async function fileReadXlsxSheet(
  nodeId: string,
  opts: { sheet?: string | number; page?: number; pageSize?: number } = {},
): Promise<FileReadXlsxSheetResult> {
  const payload: Record<string, unknown> = {};
  if (opts.sheet !== undefined) payload.sheet = opts.sheet;
  if (opts.page !== undefined) payload.page = opts.page;
  if (opts.pageSize !== undefined) payload.pageSize = opts.pageSize;
  const data = await executeNodeActionResponse(nodeId, 'file.readXlsxSheet', payload);
  const result = data.result as FileReadXlsxSheetResult | undefined;
  return result ?? { sheet: '', headers: [], rows: [], page: 1, pageSize: 100, totalPages: null };
}

/**
 * file.readPdf — page count + document metadata for the bound PDF.
 * Backend action: `file.readPdf`.
 */
export async function fileReadPdf(nodeId: string): Promise<FileReadPdfResult> {
  const data = await executeNodeActionResponse(nodeId, 'file.readPdf');
  const result = data.result as FileReadPdfResult | undefined;
  return result ?? { totalPages: 0, metadata: {} };
}

/**
 * file.readPdfPage — extracted text for one page (pageCount=1) of the PDF.
 * Backend action: `file.readPdfPage`.
 */
export async function fileReadPdfPage(
  nodeId: string,
  opts: { page?: number; pageCount?: number } = {},
): Promise<FileReadPdfPageResult> {
  const payload: Record<string, unknown> = {};
  if (opts.page !== undefined) payload.page = opts.page;
  if (opts.pageCount !== undefined) payload.pageCount = opts.pageCount;
  const data = await executeNodeActionResponse(nodeId, 'file.readPdfPage', payload);
  const result = data.result as FileReadPdfPageResult | undefined;
  return result ?? { page: 1, pageCount: 0, text: '', isEvalSupported: false };
}

/**
 * file.readZipEntries — central-directory entry list of the bound ZIP archive.
 * Backend action: `file.readZipEntries`.
 */
export async function fileReadZipEntries(nodeId: string): Promise<FileReadZipEntriesResult> {
  const data = await executeNodeActionResponse(nodeId, 'file.readZipEntries');
  const result = data.result as FileReadZipEntriesResult | undefined;
  return result && Array.isArray(result.entries) ? result : { entries: [] };
}

/**
 * file.readZipEntry — bounded UTF-8 text preview of one zip entry (default
 * maxBytes cap is 64 KB on the server). Backend action: `file.readZipEntry`.
 */
export async function fileReadZipEntry(
  nodeId: string,
  opts: { entryName: string; maxBytes?: number },
): Promise<FileReadZipEntryResult> {
  const payload: Record<string, unknown> = { entryName: String(opts.entryName || '') };
  if (opts.maxBytes !== undefined) payload.maxBytes = opts.maxBytes;
  const data = await executeNodeActionResponse(nodeId, 'file.readZipEntry', payload);
  const result = data.result as FileReadZipEntryResult | undefined;
  return result ?? { entryName: String(opts.entryName || ''), text: '', truncated: false, bytes: 0 };
}

/**
 * file.extractZipEntry — extract one archive entry into the workspace-
 * controlled extract dir (defaults to Harness/a2a/file-extracts/<nodeId>).
 * Backend action: `file.extractZipEntry`.
 */
export async function fileExtractZipEntry(
  nodeId: string,
  opts: { entryName: string; destDir?: string },
): Promise<FileExtractZipEntryResult> {
  const payload: Record<string, unknown> = { entryName: String(opts.entryName || '') };
  if (opts.destDir !== undefined) payload.destDir = opts.destDir;
  const data = await executeNodeActionResponse(nodeId, 'file.extractZipEntry', payload);
  const result = data.result as FileExtractZipEntryResult | undefined;
  return result ?? { path: '', bytes: 0, entryName: String(opts.entryName || '') };
}

/**
 * file.refresh — re-stat the bound workspace file and persist updated metadata
 * (source/kind/path/name/mime/size) onto the node. Same result shape as
 * fileMeta, plus exists/stale/mtime/etag on the file record.
 * Backend action: `file.refresh`.
 */
export async function fileRefresh(nodeId: string): Promise<FileMetaResult> {
  const data = await executeNodeActionResponse(nodeId, 'file.refresh');
  const result = data.result as FileMetaResult | undefined;
  return result ?? { file: { path: '' } };
}

export async function createEdge(
  from: string,
  to: string,
  opts?: { relation?: string; direction?: WorkflowEdgeDirection; sourceHandle?: string; targetHandle?: string },
): Promise<{
  operation?: WorkflowOperation;
  edge: {
    id: string;
    from?: string;
    to?: string;
    source?: string;
    target?: string;
    relation?: string;
    direction?: WorkflowEdgeDirection;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  };
}> {
  return apiJson(`${BASE}/edges`, {
    method: 'POST',
    body: JSON.stringify({ from, to, ...opts }),
  });
}

export async function deleteEdge(edgeId: string): Promise<{ ok: boolean; operation?: WorkflowOperation }> {
  return apiJson(`${BASE}/edges/${encodeURIComponent(edgeId)}`, { method: 'DELETE' });
}

export async function fetchNodeContext(nodeId: string): Promise<unknown> {
  return apiJson(`${BASE}/context/${encodeURIComponent(nodeId)}`);
}

export async function fetchSkillsHub(query = ''): Promise<WorkflowSkillsHubResponse> {
  const params = new URLSearchParams();
  params.set('scope', 'project');
  if (query.trim()) params.set('q', query.trim());
  return apiJson<WorkflowSkillsHubResponse>(`${BASE}/skills-hub?${params.toString()}`);
}

export async function fetchMcpHub(query = ''): Promise<WorkflowMcpHubResponse> {
  const params = new URLSearchParams();
  params.set('scope', 'project');
  if (query.trim()) params.set('q', query.trim());
  return apiJson<WorkflowMcpHubResponse>(`${BASE}/mcp-hub?${params.toString()}`);
}
