// Shared workflow toast + typed node-action error consumption.
//
// The backend rejects typed node operations with 409 bodies that carry the
// agent-team-cooperation-spec shapes:
//   goal_already_bound: { error: 'goal_already_bound', message, existingGoalNodeId, timerNodeId }   (§6.2 / AC-015 / T12)
//   goal_items_pending: { error: { code, message }, remaining: [...] }                              (§7 / AC-014)
//   markdown_conflict:  { error: { code, message }, currentRevision, expectedRevision }             (§8.3 / AC-018)
// These helpers read both `message` and the detail fields so goal/timer UI can
// surface user-visible rejection toasts and keep the full 409 shape.

import { apiFetch } from './api';
import type { WorkflowGoalNodeState } from './types';

export type WorkflowToastKind = 'status' | 'loading' | 'success' | 'error';

export type WorkflowToastInput = {
  message: string;
  kind?: WorkflowToastKind;
  durationMs?: number;
  dedupeKey?: string;
};

type AlertToastHost = (input: { message: string; kind: WorkflowToastKind; durationMs: number; dedupeKey: string }) => () => void;

// Routes through the canvas toast (window.alert_toast installed by WorkflowRoute)
// and falls back to the wf:workflow-toast CustomEvent so a toast can be raised
// from any component (goal card, expanded node, terminal drawer).
export function showWorkflowToast(input: WorkflowToastInput) {
  const message = String(input.message || '');
  if (!message) return;
  const kind = input.kind || 'status';
  const durationMs = Number(input.durationMs) || 3200;
  const dedupeKey = String(input.dedupeKey || `workflow-toast:${message}`);
  const host = (window as Window & { alert_toast?: AlertToastHost }).alert_toast;
  if (typeof host === 'function') {
    host({ message, kind, durationMs, dedupeKey });
    return;
  }
  window.dispatchEvent(new CustomEvent('wf:workflow-toast', {
    detail: { message, kind, durationMs, dedupeKey },
  }));
}

const DETAIL_FIELDS = [
  'remaining',
  'existingGoalNodeId',
  'timerNodeId',
  'currentRevision',
  'expectedRevision',
  'holder',
  'expiresAt',
] as const;

export type WorkflowActionErrorDetail = {
  code?: string;
  message?: string;
  remaining?: string[];
  existingGoalNodeId?: string;
  timerNodeId?: string;
  currentRevision?: number;
  expectedRevision?: number;
  [key: string]: unknown;
};

// Parses a non-2xx body into the typed detail shape. Handles both
// `{ error: 'code', message, ... }` (string code) and
// `{ error: { code, message }, ... }` (object code) serializations.
export function parseActionErrorBody(body: unknown): WorkflowActionErrorDetail {
  const detail: WorkflowActionErrorDetail = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return detail;
  const record = body as Record<string, unknown>;
  const errorPart = record.error;
  if (typeof errorPart === 'string') {
    detail.code = errorPart;
    if (typeof record.message === 'string') detail.message = record.message;
  } else if (errorPart && typeof errorPart === 'object') {
    const err = errorPart as Record<string, unknown>;
    if (typeof err.code === 'string') detail.code = err.code;
    if (typeof err.message === 'string') detail.message = err.message;
  }
  for (const field of DETAIL_FIELDS) {
    const value = record[field];
    if (value !== undefined) detail[field] = value as never;
  }
  return detail;
}

// Re-reads detail fields attached by apiJson / runWorkflowNodeAction onto the
// thrown Error (message stays compatible with plain Error consumers).
export function parseTypedError(error: unknown): WorkflowActionErrorDetail {
  const detail: WorkflowActionErrorDetail = {};
  if (error instanceof Error) {
    detail.message = error.message;
    const attached = (error as Error & { detail?: Record<string, unknown> }).detail;
    if (attached && typeof attached === 'object') {
      for (const field of DETAIL_FIELDS) {
        const value = attached[field];
        if (value !== undefined) detail[field] = value as never;
      }
    }
  }
  return detail;
}

// Invokes a workflow node action and returns the parsed JSON body on success.
// On failure it throws an Error whose message is the backend message and whose
// `detail` carries the typed 409 fields (remaining / existingGoalNodeId /
// timerNodeId / ...). Uses apiFetch directly so the full error body is kept.
export async function runWorkflowNodeAction(
  nodeId: string,
  action: string,
  payload?: unknown,
): Promise<Record<string, unknown>> {
  const response = await apiFetch(
    `/api/workflow/nodes/${encodeURIComponent(nodeId)}/actions/${encodeURIComponent(action)}`,
    {
      method: 'POST',
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    },
  );
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = parseActionErrorBody(body);
    const error = new Error(detail.message || `${action} failed (${response.status})`) as Error & {
      detail?: WorkflowActionErrorDetail;
      status?: number;
    };
    if (Object.keys(detail).length > 0) error.detail = detail;
    error.status = response.status;
    throw error;
  }
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : { body };
}

// Extracts the after-snapshot goal state from a node-action response envelope
// ({ state } / { result: { state } } / raw { state, revision } handler result).
export function goalStateFromActionBody(body: unknown): WorkflowGoalNodeState | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const result = record.result && typeof record.result === 'object' ? record.result as Record<string, unknown> : null;
  const candidate = record.state
    ?? (result && typeof result.state === 'object' ? result.state : null)
    ?? (result && typeof result.revision !== 'undefined' ? result : null);
  if (candidate && typeof candidate === 'object') {
    const state = candidate as Record<string, unknown>;
    if (typeof state.nodeId === 'string' || typeof state.revision !== 'undefined') {
      return candidate as WorkflowGoalNodeState;
    }
  }
  return null;
}

// Builds the user-facing error text for goal actions: backend message plus the
// typed detail fields (remaining item ids for goal_items_pending, existing
// goal / timer ids for goal_already_bound).
export function goalActionErrorText(error: unknown, fallback: string): string {
  const detail = parseTypedError(error);
  let text = String(detail.message || fallback || '');
  if (detail.code === 'goal_items_pending' && Array.isArray(detail.remaining) && detail.remaining.length > 0) {
    text = `${text} (${detail.remaining.join(', ')})`;
  } else if (detail.code === 'goal_already_bound') {
    const extra: string[] = [];
    if (detail.existingGoalNodeId) extra.push(`existing goal: ${detail.existingGoalNodeId}`);
    if (detail.timerNodeId) extra.push(`timer: ${detail.timerNodeId}`);
    if (extra.length > 0) text = `${text} (${extra.join(', ')})`;
  }
  return text;
}

export function showGoalActionErrorToast(error: unknown, fallback: string, actionKey: string) {
  showWorkflowToast({
    message: goalActionErrorText(error, fallback),
    kind: 'error',
    durationMs: 4600,
    dedupeKey: `goal-action:${actionKey}`,
  });
}
