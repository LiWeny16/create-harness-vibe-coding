import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, apiJson, wsUrl } from '../api';

type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'degraded' | 'disconnected';

async function reportDebug(state: Record<string, unknown>) {
  try {
    await apiFetch('/api/debug/report', {
      method: 'POST',
      body: JSON.stringify(state),
    });
  } catch { /* debug only, ignore failures */ }
}

export function useServerConnection() {
  const [connState, setConnState] = useState<ConnState>('disconnected');
  const [eventSeq, setEventSeq] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Clean up previous connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnState('connecting');

    try {
      const ws = new WebSocket(wsUrl('/ws/events'));
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnState('connected');
        setLastSync(new Date().toLocaleTimeString());
        setLastError(null);
        reportDebug({ connected: true, events: ['ws:open'] });
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'task.updated') {
            if (data.seq !== undefined) {
              setEventSeq(data.seq);
              setLastSync(new Date().toLocaleTimeString());
            }
            window.dispatchEvent(new CustomEvent('harness:graph-changed', { detail: { source: 'tasks' } }));
          } else if (data.type === 'server.connected') {
            setEventSeq(data.seq || 0);
          } else if (data.type === 'graph.changed') {
            window.dispatchEvent(new CustomEvent('harness:graph-changed', { detail: { source: String(data.source || 'a2a') } }));
          }
        } catch { /* ignore malformed messages */ }
      };

      ws.onclose = (e) => {
        wsRef.current = null;
        if (!mountedRef.current) return;
        setConnState('reconnecting');
        reportDebug({ connected: false, events: [`ws:close(${e.code})`] });
        // Auto-reconnect after 2s
        reconnectTimerRef.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        setLastError('WS error');
        setConnState('degraded');
      };
    } catch (err: any) {
      if (!mountedRef.current) return;
      setConnState('disconnected');
      setLastError(err?.message || 'connection failed');
      reportDebug({ errors: [err?.message || 'ws connect failed'] });
      // Retry after 3s
      reconnectTimerRef.current = setTimeout(connect, 3000);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { connState, eventSeq, lastSync, lastError };
}

export async function fetchTasks() {
  return apiJson('/api/tasks');
}

export async function fetchTaskDetail(taskId: string) {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchSettings() {
  return apiJson('/api/settings');
}
