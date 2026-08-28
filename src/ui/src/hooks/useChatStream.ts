// useChatStream.ts — structured chat transport for agent nodes in "chat" UI
// mode (capability-identical to the PTY terminal, different presentation).
//
// Server → client: WS `/ws/chat/<sessionId>` JSON envelopes {seq, ts, type,
// payload}; client → server frames chat:send / chat:steer / chat:interrupt /
// chat:approve. History backfill + disconnect fallback reuse the REST range
// endpoint `GET /api/chat/:sessionId/range?fromSeq=` (same shape as the
// proven terminal pattern in TerminalDrawer.tsx connectWs: ~1200ms reconnect,
// 1500ms polling fallback, monotonic lastSeq dedupe).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { apiJson, wsUrl } from '../api';

export type ChatEnvelopeType =
  | 'session_ready'
  | 'turn_started'
  | 'text_delta'
  | 'thinking_delta'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'user_ask'
  | 'permission_request'
  | 'permission_resolved'
  | 'turn_ended'
  | 'done'
  | 'error'
  | 'raw'
  | 'chat:state';

export type ChatEnvelope = {
  seq?: number;
  ts?: string;
  type: ChatEnvelopeType;
  payload?: {
    text?: string;
    callId?: string;
    name?: string;
    input?: unknown;
    output?: unknown;
    isError?: boolean;
    requestId?: string;
    tool?: string;
    questions?: ChatAskQuestion[];
    result?: string;
    message?: string;
    data?: unknown;
    [key: string]: unknown;
  };
};

export type ChatAskQuestion = {
  id?: string;
  question?: string;
  options?: string[];
};

export type ChatToolStatus = 'running' | 'done' | 'error';

export type ChatTool = {
  callId: string;
  name: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  status: ChatToolStatus;
  seq: number;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  thinking: string;
  seq: number;
  /** Optimistic local echo not yet confirmed by a server turn. */
  pending?: boolean;
};

export type ChatPermissionRequest = {
  requestId: string;
  tool: string;
  input?: unknown;
  seq: number;
};

export type ChatAskRequest = {
  requestId: string;
  questions: ChatAskQuestion[];
  seq: number;
};

export type ChatPermissionResult = 'allow' | 'always' | 'deny';

export type ChatConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

type ChatState = {
  lastSeq: number;
  messages: ChatMessage[];
  tools: Record<string, ChatTool>;
  toolOrder: string[];
  pendingPermissions: Record<string, ChatPermissionRequest>;
  resolvedPermissions: Record<string, ChatPermissionResult>;
  asks: Record<string, ChatAskRequest>;
  askOrder: string[];
  turnActive: boolean;
  openMessageId: string | null;
  error: string | null;
};

type ChatAction =
  | { kind: 'reset' }
  | { kind: 'envelopes'; envelopes: ChatEnvelope[] }
  | { kind: 'localEcho'; text: string; id: string }
  | { kind: 'confirmEchoes' };

let messageIdSeed = 0;
function nextMessageId(prefix: string) {
  messageIdSeed += 1;
  return `${prefix}-${Date.now().toString(36)}-${messageIdSeed}`;
}

export const emptyChatState: ChatState = {
  lastSeq: 0,
  messages: [],
  tools: {},
  toolOrder: [],
  pendingPermissions: {},
  resolvedPermissions: {},
  asks: {},
  askOrder: [],
  turnActive: false,
  openMessageId: null,
  error: null,
};

// Local-only resolution marker: carries no seq so it never disturbs the
// monotonic watermark while still routing through the shared reducer path.
const LOCAL_PERMISSION_RESOLVED = (requestId: string): ChatEnvelope => ({
  type: 'permission_resolved',
  payload: { requestId },
});

function ensureOpenAssistant(state: ChatState, seq: number): { state: ChatState; message: ChatMessage } {
  const open = state.openMessageId ? state.messages.find(item => item.id === state.openMessageId) : undefined;
  if (open) return { state, message: open };
  const message: ChatMessage = { id: nextMessageId('asst'), role: 'assistant', text: '', thinking: '', seq };
  return { state: { ...state, messages: [...state.messages, message], openMessageId: message.id }, message };
}

function appendToMessage(state: ChatState, id: string, patch: Partial<ChatMessage>): ChatState {
  return { ...state, messages: state.messages.map(item => (item.id === id ? { ...item, ...patch } : item)) };
}

// Single-envelope reducer step. Kept pure so backfill merges and live frames
// share one mapping path (delta accumulation, tool pairing by callId,
// permission/ask lifecycle keyed by requestId).
export function applyChatEnvelope(state: ChatState, envelope: ChatEnvelope): ChatState {
  const seq = Number(envelope.seq || 0);
  // Monotonic dedupe: replays from the polling fallback or a racing WS frame
  // with seq <= lastSeq are already reflected in state.
  const sequenced = Number.isFinite(seq) && seq > 0;
  if (sequenced && seq <= state.lastSeq) return state;
  const base: ChatState = sequenced ? { ...state, lastSeq: seq } : state;

  switch (envelope.type) {
    case 'session_ready':
      return { ...base, error: null };
    case 'turn_started': {
      const message: ChatMessage = { id: nextMessageId('asst'), role: 'assistant', text: '', thinking: '', seq };
      return {
        ...base,
        // A started turn proves the server received our queued input: confirm
        // optimistic local echoes here.
        messages: [...base.messages.map(item => (item.pending ? { ...item, pending: false } : item)), message],
        turnActive: true,
        openMessageId: message.id,
      };
    }
    case 'text_delta': {
      const opened = ensureOpenAssistant(base, seq);
      return appendToMessage(opened.state, opened.message.id, { text: opened.message.text + String(envelope.payload?.text || '') });
    }
    case 'thinking_delta': {
      const opened = ensureOpenAssistant(base, seq);
      return appendToMessage(opened.state, opened.message.id, { thinking: opened.message.thinking + String(envelope.payload?.text || '') });
    }
    case 'tool_call_start': {
      const callId = String(envelope.payload?.callId || '');
      if (!callId || base.tools[callId]) return base;
      const tool: ChatTool = {
        callId,
        name: String(envelope.payload?.name || 'tool'),
        input: envelope.payload?.input,
        status: 'running',
        seq,
      };
      return {
        ...base,
        tools: { ...base.tools, [callId]: tool },
        toolOrder: [...base.toolOrder, callId],
      };
    }
    case 'tool_call_end': {
      const callId = String(envelope.payload?.callId || '');
      const existing = callId ? base.tools[callId] : undefined;
      if (!existing) return base;
      return {
        ...base,
        tools: {
          ...base.tools,
          [callId]: {
            ...existing,
            output: envelope.payload?.output ?? existing.output,
            isError: Boolean(envelope.payload?.isError),
            status: envelope.payload?.isError ? 'error' : 'done',
          },
        },
      };
    }
    case 'user_ask': {
      const requestId = String(envelope.payload?.requestId || '');
      if (!requestId || base.askOrder.includes(requestId)) return base;
      const questions = Array.isArray(envelope.payload?.questions) ? envelope.payload!.questions! : [];
      return {
        ...base,
        asks: { ...base.asks, [requestId]: { requestId, questions, seq } },
        askOrder: [...base.askOrder, requestId],
      };
    }
    case 'permission_request': {
      const requestId = String(envelope.payload?.requestId || '');
      if (!requestId || base.pendingPermissions[requestId] || base.resolvedPermissions[requestId]) return base;
      return {
        ...base,
        pendingPermissions: {
          ...base.pendingPermissions,
          [requestId]: {
            requestId,
            tool: String(envelope.payload?.tool || ''),
            input: envelope.payload?.input,
            seq,
          },
        },
      };
    }
    case 'permission_resolved': {
      const requestId = String(envelope.payload?.requestId || '');
      if (!requestId || !(requestId in base.pendingPermissions)) return base;
      const pending = { ...base.pendingPermissions };
      delete pending[requestId];
      const resolved = { ...base.resolvedPermissions, [requestId]: ((envelope.payload?.result as ChatPermissionResult) || 'allow') };
      return { ...base, pendingPermissions: pending, resolvedPermissions: resolved };
    }
    case 'turn_ended':
    case 'done':
      return { ...base, turnActive: false, openMessageId: null };
    case 'error':
      return {
        ...base,
        turnActive: false,
        openMessageId: null,
        error: String(envelope.payload?.message || 'chat stream error'),
        messages: [...base.messages, {
          id: nextMessageId('sys'),
          role: 'system',
          text: String(envelope.payload?.message || ''),
          thinking: '',
          seq,
        }],
      };
    case 'raw':
      // Raw CLI passthrough is surfaced verbatim in the open assistant block so
      // capability parity with the terminal view holds even for unstructured
      // output bursts.
      return appendOpenText(base, String((envelope.payload?.data as string) ?? ''), seq);
    case 'chat:state': {
      // Snapshot envelope (optional): replace transcript wholesale when the
      // server provides one; ignore partial shapes defensively.
      const snapshot = envelope.payload as { messages?: unknown } | undefined;
      if (!snapshot || !Array.isArray(snapshot.messages)) return base;
      const restored: ChatMessage[] = (snapshot.messages as Array<Record<string, unknown>>).map((item, index) => ({
        id: String(item.id || nextMessageId('asst')),
        role: (item.role === 'user' || item.role === 'system' ? item.role : 'assistant') as ChatMessage['role'],
        text: String(item.text || ''),
        thinking: String(item.thinking || ''),
        seq: Number(item.seq || index),
      }));
      return { ...base, messages: restored, openMessageId: null };
    }
    default:
      return base;
  }
}

function appendOpenText(state: ChatState, text: string, seq: number): ChatState {
  if (!text) return state;
  const opened = ensureOpenAssistant(state, seq);
  return appendToMessage(opened.state, opened.message.id, { text: opened.message.text + text });
}

function reduceChat(state: ChatState, action: ChatAction): ChatState {
  switch (action.kind) {
    case 'reset':
      return { ...emptyChatState };
    case 'envelopes': {
      // Backfill merge: sort by seq then fold through the same reducer used
      // for live frames, so replayed history and live deltas cannot diverge.
      const ordered = [...action.envelopes].sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
      let current = state;
      for (const envelope of ordered) current = applyChatEnvelope(current, envelope);
      return current;
    }
    case 'localEcho':
      return {
        ...state,
        messages: [...state.messages, { id: action.id, role: 'user', text: action.text, thinking: '', seq: state.lastSeq, pending: true }],
      };
    default:
      return state;
  }
}

const RECONNECT_DELAY_MS = 1200;
const POLL_INTERVAL_MS = 1500;

export function useChatStream(sessionId: string) {
  const [state, dispatch] = useReducer(reduceChat, emptyChatState);
  const [status, setStatus] = useState<ChatConnectionStatus>('connecting');
  const [newCount, setNewCount] = useState(0);
  const [scrollAnchor, setScrollAnchor] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const activeSessionRef = useRef<string>(sessionId);
  const reconnectTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const lastSeqRef = useRef(0);
  const outboxRef = useRef<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    lastSeqRef.current = state.lastSeq;
  }, [state.lastSeq]);

  const rawSend = useCallback((frame: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(frame));
      return true;
    }
    // Offline queue: flushed on the next successful WS open.
    outboxRef.current.push(frame);
    return false;
  }, []);

  const flushOutbox = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const queued = outboxRef.current;
    outboxRef.current = [];
    for (const frame of queued) ws.send(JSON.stringify(frame));
  }, []);

  const markSeen = useCallback(() => setNewCount(0), []);

  const backfill = useCallback(async (sid: string) => {
    try {
      const fromSeq = lastSeqRef.current + 1;
      const range = await apiJson<ChatEnvelope[]>(
        `/api/chat/${encodeURIComponent(sid)}/range?fromSeq=${fromSeq}`,
      );
      if (activeSessionRef.current !== sid) return;
      const envelopes = Array.isArray(range) ? range : [];
      if (envelopes.length > 0) {
        dispatch({ kind: 'envelopes', envelopes });
        setScrollAnchor(anchor => anchor + 1);
      }
    } catch {
      // Sessions without a transcript yet are not an error.
    }
  }, []);

  const connectWs = useCallback((sid: string) => {
    try {
      wsRef.current?.close();
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      setStatus('connecting');
      const ws = new WebSocket(wsUrl(`/ws/chat/${encodeURIComponent(sid)}`));
      wsRef.current = ws;
      ws.onopen = () => {
        if (activeSessionRef.current !== sid) return;
        setStatus('connected');
        flushOutbox();
        void backfill(sid);
      };
      ws.onmessage = event => {
        if (activeSessionRef.current !== sid) return;
        let envelopes: ChatEnvelope[] = [];
        try {
          const parsed = JSON.parse(event.data as string);
          envelopes = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return;
        }
        if (envelopes.length === 0) return;
        dispatch({ kind: 'envelopes', envelopes });
        setScrollAnchor(anchor => anchor + 1);
        setNewCount(count => count + envelopes.filter(e => e.type === 'text_delta').length);
      };
      ws.onclose = () => {
        if (activeSessionRef.current !== sid) return;
        setStatus('reconnecting');
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => connectWs(sid), RECONNECT_DELAY_MS);
      };
      ws.onerror = () => setStatus('reconnecting');
    } catch {
      setStatus('offline');
    }
  }, [backfill, flushOutbox]);

  // Session switch / mount: reset transcript state, backfill history, open the
  // live socket, and start the HTTP polling fallback while disconnected.
  useEffect(() => {
    activeSessionRef.current = sessionId;
    dispatch({ kind: 'reset' });
    setNewCount(0);
    outboxRef.current = [];
    lastSeqRef.current = 0;
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      await backfill(sessionId);
      if (cancelled || activeSessionRef.current !== sessionId) return;
      connectWs(sessionId);
    })();
    pollTimerRef.current = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      void backfill(sessionId);
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [backfill, connectWs, sessionId]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    dispatch({ kind: 'localEcho', text: trimmed, id: nextMessageId('user') });
    setScrollAnchor(anchor => anchor + 1);
    rawSend({ type: 'chat:send', text: trimmed });
  }, [rawSend]);

  const steer = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    dispatch({ kind: 'localEcho', text: trimmed, id: nextMessageId('user') });
    setScrollAnchor(anchor => anchor + 1);
    rawSend({ type: 'chat:steer', text: trimmed });
  }, [rawSend]);

  const interrupt = useCallback(() => {
    rawSend({ type: 'chat:interrupt' });
  }, [rawSend]);

  const approve = useCallback((requestId: string, result: ChatPermissionResult) => {
    // Optimistic local resolution keeps ApprovalCard deduped even if the
    // permission_resolved frame is delayed or dropped.
    dispatch({ kind: 'envelopes', envelopes: [{ type: 'permission_resolved', payload: { requestId, result } }] });
    rawSend({ type: 'chat:approve', requestId, result });
  }, [rawSend]);

  const pendingPermissionList = useMemo(
    () => Object.values(state.pendingPermissions).sort((a, b) => a.seq - b.seq),
    [state.pendingPermissions],
  );
  const askList = useMemo(
    () => state.askOrder.map(id => state.asks[id]).filter(Boolean),
    [state.asks, state.askOrder],
  );

  return {
    messages: state.messages,
    tools: state.tools,
    toolOrder: state.toolOrder,
    pendingPermissions: state.pendingPermissions,
    resolvedPermissions: state.resolvedPermissions,
    pendingPermissionList,
    asks: askList,
    status,
    turnActive: state.turnActive,
    error: state.error,
    send,
    steer,
    interrupt,
    approve,
    newCount,
    markSeen,
    scrollAnchor,
  };
}

// Exported for focused reducer tests once a unit-test runner exists; mirrors
// the exact mapping used by the live hook.
export const __testables = {
  applyChatEnvelope,
  emptyChatState,
  LOCAL_PERMISSION_RESOLVED,
};
