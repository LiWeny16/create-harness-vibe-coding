import { apiJson } from './api';

export type WfBrowserMode = 'architecture' | 'runtime' | 'mixed' | 'recovery';
export type WfBrowserRunStatus = 'active' | 'complete' | 'blocked' | 'archived';
export type WfBrowserLeaseType = 'control' | 'observe';
export type WfBrowserArtifactType =
  | 'screenshot'
  | 'ui-tree'
  | 'state'
  | 'logs'
  | 'network'
  | 'ast'
  | 'replay'
  | 'analysis';

export interface WfBrowserRun {
  schemaVersion: number;
  kind: 'wf-browser-run';
  runId: string;
  status: WfBrowserRunStatus;
  mode: WfBrowserMode;
  agentId: string;
  sessionId: string;
  taskId: string;
  route: string;
  objective: string;
  readinessBefore: string;
  readinessAfter: string;
  fixtureScope: Record<string, unknown>;
  artifactRoot: string;
  windowCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WfBrowserWindow {
  schemaVersion: number;
  kind: 'wf-browser-window';
  runId: string;
  windowId: string;
  status: 'idle' | 'leased';
  agentId: string;
  sessionId: string;
  route: string;
  viewport: Record<string, unknown>;
  fixtureScope: Record<string, unknown>;
  artifactRoot: string;
  activeLeaseId: string;
  activeLeaseType: '' | WfBrowserLeaseType;
  createdAt: string;
  updatedAt: string;
}

export interface WfBrowserLease {
  schemaVersion: number;
  kind: 'wf-browser-lease';
  runId: string;
  windowId: string;
  leaseId: string;
  type: WfBrowserLeaseType;
  status: 'active' | 'released' | 'expired';
  agentId: string;
  sessionId: string;
  reason: string;
  readonly: boolean;
  createdAt: string;
  expiresAt: string;
  releasedAt?: string;
  releaseReason?: string;
}

export interface WfBrowserArtifact {
  schemaVersion: number;
  kind: 'wf-browser-artifact';
  artifactId: string;
  runId: string;
  windowId: string;
  type: WfBrowserArtifactType;
  label: string;
  contentType: string;
  path: string;
  bytes: number;
  createdAt: string;
}

export interface WfBrowserConnection {
  connectionId: string;
  role: string;
  runId: string;
  windowId: string;
  agentId: string;
  route: string;
  capabilityCount: number;
  connectedAt: string;
  lastActivityAt: string;
}

export interface WfBrowserCommandInput {
  commandId?: string;
  primitive: string;
  agentId?: string;
  sessionId?: string;
  leaseId: string;
  timeoutMs?: number;
  payload?: Record<string, unknown>;
  target?: Record<string, unknown>;
  storeArtifact?: boolean;
}

export interface WfBrowserCommandResult {
  commandId: string;
  status: 'ok' | 'failed' | 'blocked' | 'unsupported';
  result: unknown;
  artifacts: unknown[];
  events: unknown[];
  error: unknown;
  ack: unknown;
  receivedAt: string;
}

export interface WfBrowserRunCreateInput {
  runId?: string;
  status?: WfBrowserRunStatus;
  mode?: WfBrowserMode;
  agentId?: string;
  sessionId?: string;
  taskId?: string;
  route?: string;
  objective?: string;
  readinessBefore?: string;
  readinessAfter?: string;
  fixtureScope?: Record<string, unknown>;
}

export interface WfBrowserWindowCreateInput {
  windowId?: string;
  agentId?: string;
  sessionId?: string;
  route?: string;
  viewport?: Record<string, unknown>;
  fixtureScope?: Record<string, unknown>;
}

export interface WfBrowserLeaseInput {
  leaseId?: string;
  type?: WfBrowserLeaseType;
  agentId?: string;
  sessionId?: string;
  reason?: string;
  ttlMs?: number;
}

export interface WfBrowserArtifactInput {
  artifactId?: string;
  type: WfBrowserArtifactType;
  label?: string;
  name?: string;
  contentType?: string;
  contentBase64?: string;
  json?: unknown;
  text?: string;
  lines?: unknown[];
}

export function getWfBrowserCapabilities() {
  return apiJson('/api/wf-browser/capabilities');
}

export function listWfBrowserConnections() {
  return apiJson<{ ok: true; connections: WfBrowserConnection[] }>('/api/wf-browser/connections');
}

export function listWfBrowserRuns(limit = 20) {
  return apiJson<{ ok: true; runs: WfBrowserRun[] }>(`/api/wf-browser/runs?limit=${encodeURIComponent(limit)}`);
}

export function createWfBrowserRun(input: WfBrowserRunCreateInput = {}) {
  return apiJson<{ ok: true; run: WfBrowserRun }>('/api/wf-browser/runs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getWfBrowserRun(runId: string) {
  return apiJson<{ ok: true; run: WfBrowserRun; windows: WfBrowserWindow[] }>(
    `/api/wf-browser/runs/${encodeURIComponent(runId)}`,
  );
}

export function createWfBrowserWindow(runId: string, input: WfBrowserWindowCreateInput = {}) {
  return apiJson<{ ok: true; window: WfBrowserWindow; launchUrl: string }>(
    `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function leaseWfBrowserWindow(runId: string, windowId: string, input: WfBrowserLeaseInput = {}) {
  return apiJson<{ ok: true; lease: WfBrowserLease; debugUrlParams: string; launchUrl: string }>(
    `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/lease`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function getWfBrowserLaunchUrl(
  runId: string,
  windowId: string,
  options: { leaseId?: string; agentId?: string; route?: string; debug?: boolean } = {},
) {
  const params = new URLSearchParams();
  if (options.leaseId) params.set('leaseId', options.leaseId);
  if (options.agentId) params.set('agentId', options.agentId);
  if (options.route) params.set('route', options.route);
  if (options.debug === false) params.set('debug', '0');
  const query = params.toString();
  return apiJson<{ ok: true; runId: string; windowId: string; leaseId: string; route: string; debugUrlParams: string; launchUrl: string }>(
    `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/launch-url${query ? `?${query}` : ''}`,
  );
}

export function releaseWfBrowserLease(runId: string, windowId: string, leaseId: string, reason = 'released') {
  return apiJson<{ ok: true; lease: WfBrowserLease }>(
    `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/lease/${encodeURIComponent(leaseId)}/release`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

export function listWfBrowserArtifacts(runId: string, windowId: string) {
  return apiJson<{ ok: true; artifacts: WfBrowserArtifact[] }>(
    `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/artifacts`,
  );
}

export function storeWfBrowserArtifact(runId: string, windowId: string, input: WfBrowserArtifactInput) {
  return apiJson<{ ok: true; artifact: WfBrowserArtifact }>(
    `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/artifacts`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function sendWfBrowserCommand(runId: string, windowId: string, input: WfBrowserCommandInput) {
  return apiJson<{ ok: true; command: WfBrowserCommandResult; artifact: WfBrowserArtifact | null }>(
    `/api/wf-browser/runs/${encodeURIComponent(runId)}/windows/${encodeURIComponent(windowId)}/commands`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function cleanupWfBrowserRuns(input: { apply?: boolean; keepLatest?: number; maxAgeDays?: number } = {}) {
  return apiJson('/api/wf-browser/cleanup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
