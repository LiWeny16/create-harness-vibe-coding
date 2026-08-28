import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent, PointerEvent } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Clipboard, Copy, Eye, EyeOff, Maximize2, Minimize2, Square, Terminal, Trash2, Users, X } from 'lucide-react';
import { motion } from 'motion/react';
import { apiJson, wsUrl } from '../api';
import { useT } from '../i18n/index';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { ControlRequest, Session } from '../types';
import {
  announceTerminalInputOwner,
  copyTerminalSelection,
  handleTerminalDrop,
  handleTerminalPaste,
  installTerminalResponseGuards,
  loadTerminalWebglAddon,
  pasteClipboardToTerminal,
  stripTerminalResponseInput,
  terminalShouldHandleKey as terminalControlShouldHandleKey,
} from '../terminalControl';

type Props = {
  sessionId: string | null;
  onClose: () => void;
};

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type TerminalSize = { cols: number; rows: number };

// Bridge message envelope (src/wf-ui-server/bridge-store.mjs). Cooperation
// audit entries are sourced from the bridge messages API, grouped by requestId
// for structured requests; legacy entries and wakeup dispatches render as-is.
// Timed-out is DERIVED client-side from real timestamps only (spec §4.5): an
// ask entry with no reply entry whose last ask is older than the threshold.
const AUDIT_TIMEOUT_THRESHOLD_MS = 5 * 60 * 1000;
type BridgeEntry = {
  seq?: number;
  ts?: string;
  bridgeId?: string;
  messageId?: string;
  threadId?: string;
  topic?: string;
  replyTo?: string;
  requestId?: string;
  toRole?: string;
  deliveryMode?: string;
  fromSessionId?: string;
  toSessionId?: string;
  fromNodeId?: string;
  toNodeId?: string;
  source?: string;
  data?: string;
};

type AuditSessionInfo = {
  sessionId: string;
  displayName: string;
  roleTitle: string;
  runtime: string;
  agentKind: string;
};

const RUNTIME_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  cc: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
  qwen: 'Qwen Code',
  deepseek: 'DeepSeek TUI',
  pi: 'Pi',
  aider: 'Aider',
  goose: 'Goose',
  amp: 'Amp',
  crush: 'Crush',
  cline: 'Cline CLI',
  plandex: 'Plandex',
  openclaw: 'OpenClaw',
  chatgpt: 'ChatGPT CLI',
  openai: 'OpenAI CLI',
};

function stateColor(state: string, connected: boolean) {
  const status = displaySessionStatus(state);
  if (status === 'running') return 'var(--success)';
  if (status === 'stopped' || status === 'stopping') return 'var(--warn)';
  if (status === 'blocked' || status === 'exited') return 'var(--danger)';
  if (status === 'starting') return 'var(--warn)';
  if (!connected && status === 'running') return 'var(--success)';
  return 'var(--muted)';
}

function initialPosition(): Point {
  const width = Math.min(980, Math.max(680, window.innerWidth * 0.62));
  return {
    x: Math.max(16, window.innerWidth - width - 28),
    y: 82,
  };
}

function initialSize(): Size {
  return {
    width: Math.min(980, Math.max(680, window.innerWidth * 0.62)),
    height: Math.min(680, Math.max(460, window.innerHeight * 0.68)),
  };
}

// 全屏模式四周留边，避免终端完全贴死显示器边缘（仍可看到画布背景）。
const FULLSCREEN_MARGIN = 16;

function shortId(value: string | undefined | null) {
  if (!value) return '';
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function shortTime(value: string | undefined) {
  if (!value) return '';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return String(value);
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return String(value);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Session identity for audit lines: displayName + roleTitle when the session
// record carries them (role profile fields, spec §3.3), else the short id.
function identityFor(sessions: Record<string, AuditSessionInfo>, sessionId: string | undefined) {
  const info = sessionId ? sessions[sessionId] : undefined;
  if (!info) return shortId(sessionId);
  const name = info.displayName || shortId(info.sessionId);
  return info.roleTitle ? `${name} (${info.roleTitle})` : name;
}

function titleForSession(session: Session | null, sessionId: string | null, t: (key: string, ...args: string[]) => string) {
  const runtime = session?.runtime || '';
  const label = RUNTIME_LABELS[runtime] || runtime || t('Agent Terminal');
  const peer = session?.peerId || session?.sessionId || sessionId || '';
  return `${label} - ${shortId(peer)}`;
}

function isLiveState(state: string) {
  return state === 'running' || state === 'starting';
}

function displaySessionStatus(state: string | undefined) {
  if (state === 'saved') return 'stopped';
  return state || 'unknown';
}

export default function TerminalDrawer({ sessionId, onClose }: Props) {
  const t = useT();
  const [attachMode, setAttachMode] = useState(true);
  const [sessionState, setSessionState] = useState<string>('starting');
  const [sessionMeta, setSessionMeta] = useState<Session | null>(null);
  const [ptyTitle, setPtyTitle] = useState('');
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [terminalReady, setTerminalReady] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlRequest, setControlRequest] = useState<ControlRequest | null>(null);
  const [respondingControl, setRespondingControl] = useState<string | null>(null);
  const [terminalSize, setTerminalSize] = useState<TerminalSize>({ cols: 0, rows: 0 });
  const [position, setPosition] = useState<Point>(() => typeof window === 'undefined' ? { x: 40, y: 80 } : initialPosition());
  const [size, setSize] = useState<Size>(() => typeof window === 'undefined' ? { width: 760, height: 480 } : initialSize());
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [auditEntries, setAuditEntries] = useState<BridgeEntry[]>([]);
  const [auditSessions, setAuditSessions] = useState<Record<string, AuditSessionInfo>>({});
  const auditLoadedRef = useRef(false);
  const reducedMotion = useReducedMotion();
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const attachModeRef = useRef(true);
  const sessionStateRef = useRef('starting');
  const activeSessionRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pollingTimerRef = useRef<number | null>(null);
  const resizeSyncTimerRef = useRef<number | null>(null);
  const lastResizeSentRef = useRef<TerminalSize>({ cols: 0, rows: 0 });
  const lastSeqRef = useRef(0);
  const dragRef = useRef<{ mode: 'move' | 'resize'; start: Point; position: Point; size: Size } | null>(null);
  // 全屏前的位置/尺寸，用于退出全屏时精确还原。
  const fullscreenRectRef = useRef<{ position: Point; size: Size } | null>(null);

  const interactive = attachMode && isLiveState(sessionState);
  const title = titleForSession(sessionMeta, sessionId, t);

  // Cooperation audit grouping: structured requests keyed by requestId,
  // wakeup dispatches (deliveryMode 'wakeup'), and legacy messages rendered
  // as-is. Replies are the entries that echo the request's requestId with a
  // replyTo set; the first entry in a request is the "asked whom" line.
  // timedOut is derived from real timestamps only (spec §4.5): no reply entry
  // exists and the last ask is older than AUDIT_TIMEOUT_THRESHOLD_MS.
  const auditGroups = useMemo(() => {
    const requests = new Map<string, BridgeEntry[]>();
    const wakeups: BridgeEntry[] = [];
    const legacy: BridgeEntry[] = [];
    for (const entry of auditEntries) {
      if (entry.deliveryMode === 'wakeup' || entry.source === 'timer.wakeup') {
        wakeups.push(entry);
        continue;
      }
      if (entry.requestId) {
        const list = requests.get(entry.requestId) || [];
        list.push(entry);
        requests.set(entry.requestId, list);
      } else {
        legacy.push(entry);
      }
    }
    const requestGroups: Array<{ requestId: string; entries: BridgeEntry[]; timedOut: boolean }> = [];
    for (const [requestId, entries] of requests) {
      const hasReply = entries.some(entry => Boolean(entry.replyTo));
      const ask = entries.find(entry => !entry.replyTo) || entries[entries.length - 1];
      const askMs = Date.parse(String(ask?.ts || ''));
      const timedOut = !hasReply
        && Number.isFinite(askMs)
        && askMs > 0
        && Date.now() - askMs > AUDIT_TIMEOUT_THRESHOLD_MS;
      requestGroups.push({ requestId, entries, timedOut });
    }
    return { requests: requestGroups, wakeups, legacy };
  }, [auditEntries]);

  const sendMessage = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const schedulePtyResize = useCallback((next: TerminalSize, delay = 80) => {
    if (!next.cols || !next.rows) return;
    if (resizeSyncTimerRef.current) window.clearTimeout(resizeSyncTimerRef.current);
    resizeSyncTimerRef.current = window.setTimeout(() => {
      const term = terminalRef.current;
      const target = term ? { cols: term.cols, rows: term.rows } : next;
      const last = lastResizeSentRef.current;
      if (target.cols === last.cols && target.rows === last.rows) return;
      if (sendMessage({ type: 'pty:resize', cols: target.cols, rows: target.rows })) {
        lastResizeSentRef.current = target;
      }
    }, delay);
  }, [sendMessage]);

  const fitAndSync = useCallback(() => {
    const term = terminalRef.current;
    const fit = fitAddonRef.current;
    if (!term || !fit) return;
    try {
      fit.fit();
      const next = { cols: term.cols, rows: term.rows };
      setTerminalSize(next);
      schedulePtyResize(next);
    } catch {
      // The host can be temporarily hidden during route transitions.
    }
  }, [schedulePtyResize]);

  const writeInput = useCallback((data: string) => {
    const sid = activeSessionRef.current;
    if (!sid || !attachModeRef.current || !isLiveState(sessionStateRef.current) || !data) return;
    if (sendMessage({ type: 'pty:input', data })) return;
    apiJson(`/api/sessions/${encodeURIComponent(sid)}/input`, {
      method: 'POST',
      body: JSON.stringify({ data }),
    }).catch((e: any) => {
      terminalRef.current?.writeln(`\r\n[error] ${e?.message || t('input rejected')}`);
    });
  }, [sendMessage]);

  const setAttach = useCallback(async (next: boolean) => {
    if (!sessionId) return;
    setAttachMode(next);
    attachModeRef.current = next;
    if (terminalRef.current) terminalRef.current.options.disableStdin = !next || !isLiveState(sessionStateRef.current);
    sendMessage({ type: 'control:attach-mode', attachMode: next });
    try {
      await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/attach-mode`, {
        method: 'POST',
        body: JSON.stringify({ attachMode: next }),
      });
      if (next) terminalRef.current?.focus();
    } catch (e: any) {
      terminalRef.current?.writeln(`\r\n[error] ${e?.message || t('attach mode update failed')}`);
    }
  }, [sendMessage, sessionId]);

  const loadSessionMeta = useCallback(async (sid: string) => {
    try {
      const sessions = await apiJson<Session[]>('/api/sessions?all=1');
      const current = sessions.find(session => session.sessionId === sid) || null;
      if (activeSessionRef.current !== sid) return;
      setSessionMeta(current);
      setControlRequest(current?.controlRequest?.status === 'pending' ? current.controlRequest : null);
      if (current?.status) {
        const status = displaySessionStatus(current.status);
        setSessionState(status);
        sessionStateRef.current = status;
      }
    } catch {
      // Metadata is helpful, but the terminal can still render without it.
    }
  }, []);

  // Cooperation audit (UX-4 / AC-025): session identity + bridge messages for
  // this session's bridges. Loaded lazily the first time the audit panel is
  // opened; per-peer bridge reads are non-fatal so a missing bridge file never
  // blanks the whole view.
  const loadAudit = useCallback(async (sid: string) => {
    setAuditLoading(true);
    setAuditError('');
    try {
      const sessions = await apiJson<Array<Session & { displayName?: string; roleTitle?: string }>>('/api/sessions?all=1');
      const info: Record<string, AuditSessionInfo> = {};
      for (const session of sessions) {
        info[session.sessionId] = {
          sessionId: session.sessionId,
          displayName: String(session.displayName || session.role || ''),
          roleTitle: String(session.roleTitle || session.role || ''),
          runtime: String(session.runtime || ''),
          agentKind: String(session.agentKind || ''),
        };
      }
      const peers = sessions.filter(session => session.sessionId !== sid).slice(0, 8);
      const collected: BridgeEntry[] = [];
      await Promise.all(peers.map(async (peer) => {
        try {
          const body = await apiJson<{ entries?: BridgeEntry[] }>(
            `/api/a2a/bridge-messages?fromSessionId=${encodeURIComponent(sid)}&toSessionId=${encodeURIComponent(peer.sessionId)}&limit=200`,
          );
          if (Array.isArray(body?.entries)) collected.push(...body.entries);
        } catch {
          // per-peer bridge read failure is non-fatal
        }
      }));
      collected.sort((a, b) => {
        const ta = String(a.ts || '');
        const tb = String(b.ts || '');
        return ta === tb ? Number(a.seq || 0) - Number(b.seq || 0) : ta.localeCompare(tb);
      });
      setAuditEntries(collected);
      setAuditSessions(info);
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : String(error));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const toggleAudit = () => {
    const next = !auditOpen;
    setAuditOpen(next);
    if (next && sessionId && !auditLoadedRef.current) {
      auditLoadedRef.current = true;
      void loadAudit(sessionId);
    }
  };

  const loadHistory = useCallback(async (sid: string, { reset = true }: { reset?: boolean } = {}) => {
    try {
      const fromSeq = reset ? undefined : lastSeqRef.current + 1;
      const path = fromSeq
        ? `/api/terminals/${encodeURIComponent(sid)}/range?fromSeq=${fromSeq}`
        : `/api/terminals/${encodeURIComponent(sid)}/range?tail=800`;
      const range = await apiJson<{ entries: { seq?: number; stream?: string; data: string }[] }>(path);
      if (activeSessionRef.current !== sid) return;
      const term = terminalRef.current;
      if (!term) return;
      if (reset) term.reset();
      for (const entry of range.entries) {
        lastSeqRef.current = Math.max(lastSeqRef.current, Number(entry.seq || 0));
        if (entry.stream === 'stdin') continue;
        term.write(String(entry.data || ''));
      }
    } catch {
      // New sessions may not have a transcript yet.
    }
  }, []);

  const startPollingFallback = useCallback((sid: string) => {
    if (pollingTimerRef.current) window.clearInterval(pollingTimerRef.current);
    pollingTimerRef.current = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      loadHistory(sid, { reset: false });
      loadSessionMeta(sid);
    }, 1500);
  }, [loadHistory, loadSessionMeta]);

  const connectWs = useCallback((sid: string) => {
    try {
      wsRef.current?.close();
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      const ws = new WebSocket(wsUrl(`/ws/terminal/${encodeURIComponent(sid)}`));
      wsRef.current = ws;
      ws.onopen = () => {
        if (activeSessionRef.current !== sid) return;
        setConnected(true);
        ws.send(JSON.stringify({ type: 'control:attach-mode', attachMode: attachModeRef.current }));
        fitAndSync();
        terminalRef.current?.focus();
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'pty:data') {
            const seq = Number(msg.seq || 0);
            if (Number.isFinite(seq) && seq > 0) lastSeqRef.current = Math.max(lastSeqRef.current, seq);
            terminalRef.current?.write(String(msg.data || ''));
          } else if (msg.type === 'session:state') {
            const nextState = displaySessionStatus(String(msg.state || 'unknown'));
            setSessionState(nextState);
            sessionStateRef.current = nextState;
            if (typeof msg.attachMode === 'boolean') {
              setAttachMode(msg.attachMode);
              attachModeRef.current = msg.attachMode;
            }
            if (terminalRef.current) {
              terminalRef.current.options.disableStdin = !attachModeRef.current || !isLiveState(nextState);
            }
          } else if (msg.type === 'session:error') {
            terminalRef.current?.writeln(`\r\n[error] ${msg.message}`);
          } else if (msg.type === 'codex:update-prompt') {
            setControlRequest(msg as ControlRequest);
            setRespondingControl(null);
            setMinimized(false);
          } else if (msg.type === 'codex:update-prompt:resolved') {
            setControlRequest(current => current?.requestId === msg.requestId ? null : current);
            setRespondingControl(null);
          }
        } catch {
          terminalRef.current?.write(String(event.data || ''));
        }
      };
      ws.onclose = () => {
        if (activeSessionRef.current !== sid) return;
        setConnected(false);
        if (isLiveState(sessionStateRef.current)) {
          reconnectTimerRef.current = window.setTimeout(() => connectWs(sid), 1200);
        }
      };
      ws.onerror = () => setConnected(false);
    } catch {
      setConnected(false);
    }
  }, [fitAndSync]);

  const minimizeTerminal = useCallback(() => {
    terminalRef.current?.blur();
    setMinimized(true);
  }, []);

  const restoreTerminal = useCallback(() => {
    setMinimized(false);
    requestAnimationFrame(() => {
      fitAndSync();
      if (sessionId) loadHistory(sessionId, { reset: false });
      terminalRef.current?.focus();
    });
  }, [fitAndSync, loadHistory, sessionId]);

  useEffect(() => {
    attachModeRef.current = attachMode;
    const term = terminalRef.current;
    if (term) term.options.disableStdin = !attachMode || !isLiveState(sessionState);
  }, [attachMode, sessionState]);

  useEffect(() => {
    if (!sessionId) return;
    activeSessionRef.current = sessionId;
    setOpen(true);
    setMinimized(false);
    setConnected(false);
    setTerminalReady(Boolean(terminalRef.current));
    setStopping(false);
    setAttachMode(true);
    attachModeRef.current = true;
    setSessionState('starting');
    sessionStateRef.current = 'starting';
    setSessionMeta(null);
    setPtyTitle('');
    setControlRequest(null);
    setRespondingControl(null);
    setAuditOpen(false);
    auditLoadedRef.current = false;
    setAuditEntries([]);
    setAuditError('');
    lastResizeSentRef.current = { cols: 0, rows: 0 };
    lastSeqRef.current = 0;
    setPosition(initialPosition());
    setSize(initialSize());
  }, [sessionId]);

  useEffect(() => {
    if (!open || !terminalHostRef.current || terminalRef.current) return;
    const term = new XTerm({
      cursorBlink: true,
      convertEol: false,
      disableStdin: false,
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "SFMono-Regular", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 8000,
      theme: {
        background: '#0b0d10',
        foreground: '#e5e7eb',
        cursor: '#f9fafb',
        selectionBackground: '#374151',
        black: '#111827',
        red: '#f87171',
        green: '#86efac',
        yellow: '#fde68a',
        blue: '#93c5fd',
        magenta: '#d8b4fe',
        cyan: '#67e8f9',
        white: '#f9fafb',
        brightBlack: '#6b7280',
        brightRed: '#fca5a5',
        brightGreen: '#bbf7d0',
        brightYellow: '#fef3c7',
        brightBlue: '#bfdbfe',
        brightMagenta: '#e9d5ff',
        brightCyan: '#a5f3fc',
        brightWhite: '#ffffff',
      },
    });
    term.attachCustomKeyEventHandler((event) => (
      terminalControlShouldHandleKey(event, attachModeRef.current && isLiveState(sessionStateRef.current), term)
    ));
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalHostRef.current);
    const webglDisposable = loadTerminalWebglAddon(term);
    const responseGuardDisposables = installTerminalResponseGuards(term);
    const titleDisposable = term.onTitleChange(title => setPtyTitle(title));
    const dataDisposable = term.onData(data => {
      const input = stripTerminalResponseInput(data);
      if (input) writeInput(input);
    });
    const resizeDisposable = term.onResize(next => {
      setTerminalSize(next);
      schedulePtyResize(next);
    });
    terminalRef.current = term;
    fitAddonRef.current = fit;
    setTerminalReady(true);
    requestAnimationFrame(fitAndSync);

    const observer = new ResizeObserver(() => fitAndSync());
    observer.observe(terminalHostRef.current);

    return () => {
      observer.disconnect();
      titleDisposable.dispose();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      responseGuardDisposables.forEach(disposable => disposable.dispose());
      webglDisposable?.dispose();
      fit.dispose();
      if (resizeSyncTimerRef.current) window.clearTimeout(resizeSyncTimerRef.current);
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setTerminalReady(false);
    };
  }, [fitAndSync, open, schedulePtyResize, writeInput]);

  useEffect(() => {
    if (!sessionId || !terminalReady || !terminalRef.current) return;
    let cancelled = false;
    (async () => {
      await loadSessionMeta(sessionId);
      await loadHistory(sessionId);
      if (cancelled || activeSessionRef.current !== sessionId) return;
      connectWs(sessionId);
      setAttach(true);
      startPollingFallback(sessionId);
    })();
    return () => {
      cancelled = true;
      wsRef.current?.close();
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (pollingTimerRef.current) window.clearInterval(pollingTimerRef.current);
      if (resizeSyncTimerRef.current) window.clearTimeout(resizeSyncTimerRef.current);
    };
  }, [connectWs, loadHistory, loadSessionMeta, sessionId, setAttach, startPollingFallback, terminalReady]);

  const clampPosition = (next: Point, nextSize = size): Point => ({
    x: Math.min(Math.max(8, next.x), Math.max(8, window.innerWidth - Math.min(240, nextSize.width))),
    y: Math.min(Math.max(8, next.y), Math.max(8, window.innerHeight - 72)),
  });

  const clearOutput = () => {
    terminalRef.current?.clear();
  };

  const claimInputOwner = useCallback(() => {
    if (!sessionId) return;
    announceTerminalInputOwner({ sessionId, surface: 'drawer' });
    terminalRef.current?.focus();
  }, [sessionId]);

  const copySelection = useCallback(() => {
    copyTerminalSelection(terminalRef.current).catch((e: any) => {
      terminalRef.current?.writeln(`\r\n[error] ${e?.message || t('copy failed')}`);
    });
  }, [t]);

  const pasteClipboard = useCallback(() => {
    if (!sessionId) return;
    claimInputOwner();
    pasteClipboardToTerminal(writeInput).catch((e: any) => {
      terminalRef.current?.writeln(`\r\n[error] ${e?.message || t('paste failed')}`);
    });
  }, [claimInputOwner, sessionId, t, writeInput]);

  const onTerminalDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!sessionId) return;
    void handleTerminalDrop(event.nativeEvent, {
      sessionId,
      surface: 'drawer',
      writeInput,
    }).catch((e: any) => {
      terminalRef.current?.writeln(`\r\n[error] ${e?.message || t('drop failed')}`);
    });
  }, [sessionId, t, writeInput]);

  const onTerminalPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (!sessionId) return;
    void handleTerminalPaste(event.nativeEvent, {
      sessionId,
      surface: 'drawer',
      writeInput,
    }).catch((e: any) => {
      terminalRef.current?.writeln(`\r\n[error] ${e?.message || t('paste failed')}`);
    });
  }, [sessionId, t, writeInput]);

  const respondToControlRequest = async (choice: string) => {
    if (!sessionId || !controlRequest || respondingControl) return;
    setRespondingControl(choice);
    try {
      await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/codex-update-prompt`, {
        method: 'POST',
        body: JSON.stringify({ choice }),
      });
      setControlRequest(null);
    } catch (e: any) {
      setRespondingControl(null);
      terminalRef.current?.writeln(`\r\n[error] ${e?.message || t('Codex update response failed')}`);
    }
  };

  const stopSession = async () => {
    if (!sessionId || stopping) return;
    const previousState = sessionStateRef.current;
    setStopping(true);
    setSessionState('stopping');
    sessionStateRef.current = 'stopping';
    if (terminalRef.current) terminalRef.current.options.disableStdin = true;
    window.dispatchEvent(new CustomEvent('harness:sessions-changed', {
      detail: { sessionId, state: 'stopping' },
    }));
    try {
      await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' });
      setSessionState('stopped');
      sessionStateRef.current = 'stopped';
      window.dispatchEvent(new CustomEvent('harness:sessions-changed', {
        detail: { sessionId, state: 'stopped' },
      }));
      close();
    } catch (e: any) {
      setSessionState(previousState);
      sessionStateRef.current = previousState;
      if (terminalRef.current) terminalRef.current.options.disableStdin = !attachModeRef.current || !isLiveState(previousState);
      setStopping(false);
      terminalRef.current?.writeln(`\r\n[error] ${e?.message || t('stop failed')}`);
    }
  };

  const close = () => {
    setOpen(false);
    wsRef.current?.close();
    if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
    if (pollingTimerRef.current) window.clearInterval(pollingTimerRef.current);
    if (resizeSyncTimerRef.current) window.clearTimeout(resizeSyncTimerRef.current);
    onClose();
  };

  const startMove = (event: PointerEvent<HTMLDivElement>) => {
    if (fullscreen) return;
    if ((event.target as HTMLElement).closest('button')) return;
    dragRef.current = { mode: 'move', start: { x: event.clientX, y: event.clientY }, position, size };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (fullscreen) return;
    event.stopPropagation();
    dragRef.current = { mode: 'resize', start: { x: event.clientX, y: event.clientY }, position, size };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.start.x;
    const dy = event.clientY - drag.start.y;
    if (drag.mode === 'move') {
      setPosition(clampPosition({ x: drag.position.x + dx, y: drag.position.y + dy }, drag.size));
      return;
    }
    const nextSize = {
      width: Math.min(Math.max(500, drag.size.width + dx), Math.max(520, window.innerWidth - drag.position.x - 12)),
      height: Math.min(Math.max(340, drag.size.height + dy), Math.max(360, window.innerHeight - drag.position.y - 12)),
    };
    setSize(nextSize);
    requestAnimationFrame(fitAndSync);
  };

  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be released by the browser first.
    }
  };

  // 全屏切换：进入时保存当前矩形并铺满视口（留边）；退出时精确还原。
  const toggleFullscreen = useCallback(() => {
    setFullscreen(current => {
      const next = !current;
      if (next) {
        fullscreenRectRef.current = { position, size };
        setPosition({
          x: FULLSCREEN_MARGIN,
          y: FULLSCREEN_MARGIN,
        });
        setSize({
          width: Math.max(500, window.innerWidth - FULLSCREEN_MARGIN * 2),
          height: Math.max(360, window.innerHeight - FULLSCREEN_MARGIN * 2),
        });
      } else {
        const rect = fullscreenRectRef.current;
        fullscreenRectRef.current = null;
        if (rect) {
          setPosition(clampPosition(rect.position, rect.size));
          setSize(rect.size);
        }
      }
      return next;
    });
    requestAnimationFrame(() => fitAndSync());
  }, [position, size, fitAndSync]);

  // 全屏期间跟随窗口尺寸变化；Esc 退出全屏（不冒泡到画布）。
  useEffect(() => {
    if (!fullscreen) return;
    const onResize = () => {
      setSize({
        width: Math.max(500, window.innerWidth - FULLSCREEN_MARGIN * 2),
        height: Math.max(360, window.innerHeight - FULLSCREEN_MARGIN * 2),
      });
      requestAnimationFrame(() => fitAndSync());
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setFullscreen(false);
        const rect = fullscreenRectRef.current;
        fullscreenRectRef.current = null;
        if (rect) {
          setPosition(clampPosition(rect.position, rect.size));
          setSize(rect.size);
        }
        requestAnimationFrame(() => fitAndSync());
      }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [fullscreen, fitAndSync]);

  // 全屏时禁用窗口拖动与缩放手柄——全屏的"最大"语义不应被意外破坏。
  useEffect(() => {
    if (!fullscreen) return;
    dragRef.current = null;
  }, [fullscreen]);

  if (!open) return null;

  return (
    <>
    {minimized && (
      <button
        data-testid="terminal-minimized"
        onClick={restoreTerminal}
        style={{
          position: 'fixed',
          left: 16,
          bottom: 10,
          zIndex: 'var(--wf-z-panel)',
          width: 390,
          maxWidth: 'calc(100vw - 32px)',
          height: 36,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: 'rgba(255,255,255,0.96)',
          boxShadow: '0 10px 28px rgba(0,0,0,0.16)',
          color: 'var(--fg)',
          textAlign: 'left',
        }}
      >
        <Terminal size={13} />
        <span style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: stateColor(sessionState, connected) }}>{displaySessionStatus(sessionState)}</span>
      </button>
    )}

    <motion.div
      data-testid="terminal-window"
      data-fullscreen={fullscreen ? 'true' : 'false'}
      initial={reducedMotion ? undefined : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: minimized ? 0 : 1, scale: minimized ? 0.98 : 1 }}
      aria-hidden={minimized}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        zIndex: 'var(--wf-z-panel)',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'var(--bg)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.22)',
        overflow: 'hidden',
        pointerEvents: minimized ? 'none' : 'auto',
        visibility: minimized ? 'hidden' : 'visible',
      }}
    >
      <div
        onPointerDown={startMove}
        style={{
          height: 42,
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          borderBottom: '1px solid var(--border)',
          gap: 8,
          background: 'rgba(255,255,255,0.96)',
          cursor: 'move',
          flexShrink: 0,
        }}
      >
        <Terminal size={13} />
        <span data-testid="terminal-session-id" title={sessionId || ''} style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {ptyTitle && (
          <span title={ptyTitle} style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
            {ptyTitle}
          </span>
        )}
        <span style={{ fontSize: 10, color: connected ? 'var(--success)' : 'var(--warn)', flexShrink: 0 }}>
          {connected ? t('ws live') : t('http fallback')}
        </span>
        <span style={{ fontSize: 10, color: stateColor(sessionState, connected), flexShrink: 0 }}>
          pty {displaySessionStatus(sessionState)}
        </span>
        <span style={{ flex: 1 }} />
        <button
          data-testid="terminal-audit-toggle"
          title={t('Cooperation audit')}
          onClick={toggleAudit}
          style={{ fontSize: 10, color: auditOpen ? 'var(--success)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 7px', flexShrink: 0 }}
        >
          <Users size={10} />
          {t('Cooperation')}
        </button>
        <button
          data-testid="terminal-attach-toggle"
          title={attachMode ? t('Attach mode') : t('Watch mode')}
          onClick={() => setAttach(!attachMode)}
          style={{ fontSize: 10, color: attachMode ? 'var(--success)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 7px', flexShrink: 0 }}
        >
          {attachMode ? <Eye size={10} /> : <EyeOff size={10} />}
          {attachMode ? t('attach') : t('watch')}
        </button>
        <button title={t('Clear terminal')} onClick={clearOutput} style={{ color: 'var(--muted)', display: 'grid', placeItems: 'center', width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          <Trash2 size={11} />
        </button>
        <button
          data-testid="terminal-fullscreen-toggle"
          aria-pressed={fullscreen ? 'true' : 'false'}
          title={fullscreen ? t('Exit fullscreen') : t('Fullscreen')}
          onClick={toggleFullscreen}
          style={{ color: fullscreen ? 'var(--success)' : 'var(--muted)', display: 'grid', placeItems: 'center', width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
        >
          {fullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
        </button>
        <button title={t('Minimize terminal')} onClick={minimizeTerminal} style={{ color: 'var(--muted)', display: 'grid', placeItems: 'center', width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          <Minimize2 size={11} />
        </button>
        <button data-testid="terminal-stop" title={t('Stop session')} onClick={stopSession} disabled={stopping} style={{ color: 'var(--danger)', display: 'grid', placeItems: 'center', width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 'var(--radius)', opacity: stopping ? 0.45 : 1 }}>
          <Square size={11} />
        </button>
        <button title={t('Close terminal')} onClick={close} style={{ color: 'var(--muted)', display: 'grid', placeItems: 'center', width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          <X size={12} />
        </button>
      </div>

      <div
        ref={terminalHostRef}
        data-testid="terminal-output"
        tabIndex={0}
        onPointerDown={claimInputOwner}
        onClick={claimInputOwner}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={onTerminalDrop}
        onPaste={onTerminalPaste}
        style={{
          flex: 1,
          minHeight: 0,
          background: '#0b0d10',
          overflow: 'hidden',
          outline: 'none',
        }}
      />

      {controlRequest?.type === 'codex:update-prompt' && (
        <div
          data-testid="codex-update-prompt"
          role="dialog"
          aria-modal="false"
          aria-labelledby="codex-update-prompt-title"
          style={{
            position: 'absolute',
            left: 18,
            right: 18,
            bottom: 48,
            display: 'grid',
            gap: 9,
            padding: 12,
            border: '1px solid rgba(245,158,11,0.55)',
            borderRadius: 'var(--radius)',
            background: 'rgba(255,251,235,0.97)',
            boxShadow: '0 16px 46px rgba(0,0,0,0.22)',
            color: '#111827',
            zIndex: 2,
          }}
        >
          <div>
            <div id="codex-update-prompt-title" style={{ fontSize: 12, fontWeight: 800 }}>{t('Codex update prompt')}</div>
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
              {t('Codex is waiting for an update choice in this terminal. Choose how Harness should answer it.')}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <button
              data-testid="codex-update-skip-session"
              onClick={() => respondToControlRequest('skip-session')}
              disabled={Boolean(respondingControl)}
              style={{ padding: '6px 9px', borderRadius: 'var(--radius)', border: '1px solid #d97706', background: '#fff7ed', color: '#92400e', fontSize: 11, fontWeight: 700, opacity: respondingControl ? 0.62 : 1 }}
            >
              {respondingControl === 'skip-session' ? t('Sending...') : t('Skip this session')}
            </button>
            <button
              data-testid="codex-update-skip-version"
              onClick={() => respondToControlRequest('skip-until-next-version')}
              disabled={Boolean(respondingControl)}
              style={{ padding: '6px 9px', borderRadius: 'var(--radius)', border: '1px solid #111827', background: '#111827', color: '#fff', fontSize: 11, fontWeight: 700, opacity: respondingControl ? 0.62 : 1 }}
            >
              {respondingControl === 'skip-until-next-version' ? t('Sending...') : t('Skip until next version')}
            </button>
          </div>
        </div>
      )}

      {auditOpen && (
        <div
          data-testid="terminal-audit-panel"
          role="region"
          aria-label={t('Cooperation audit')}
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            top: 50,
            bottom: 40,
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: '#ffffff',
            boxShadow: '0 16px 46px rgba(0,0,0,0.2)',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 800 }}>
            <Users size={13} />
            <span>{t('Cooperation audit')}</span>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{auditEntries.length} {t('message(s)')}</span>
            <span style={{ flex: 1 }} />
            {auditLoading && <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{t('Loading...')}</span>}
          </header>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8, display: 'grid', gap: 8, fontSize: 11 }}>
            {auditError && (
              <div style={{ color: '#b91c1c', padding: 6 }}>{auditError}</div>
            )}
            {!auditError && !auditLoading && auditEntries.length === 0 && (
              <div style={{ color: 'var(--muted)', padding: 6 }}>{t('No cooperation messages yet')}</div>
            )}
            {Object.keys(auditSessions).length > 0 && (
              <section data-testid="audit-sessions" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 8, display: 'grid', gap: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: 'var(--muted)' }}>{t('Agents')}</div>
                {Object.values(auditSessions).map(session => (
                  <div key={session.sessionId} data-testid="audit-session-identity" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{session.displayName || shortId(session.sessionId)}</strong>
                    {session.roleTitle && <span style={{ color: 'var(--muted)' }}>· {session.roleTitle}</span>}
                    {session.runtime && <span style={{ color: 'var(--muted)' }}>· {RUNTIME_LABELS[session.runtime] || session.runtime}</span>}
                  </div>
                ))}
              </section>
            )}
            {auditGroups.requests.map(({ requestId, entries, timedOut }) => (
              <section key={requestId} data-testid="audit-request" data-request-id={requestId} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 8, display: 'grid', gap: 5 }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t('Request')} {shortId(requestId)}
                  {timedOut && (
                    <span data-testid="audit-timed-out" style={{ color: '#b91c1c', fontWeight: 800, textTransform: 'uppercase', fontSize: 9, letterSpacing: 0.4, border: '1px solid #fecaca', borderRadius: 999, padding: '0 6px', lineHeight: '14px' }}>
                      {t('timed-out')}
                    </span>
                  )}
                </div>
                {entries.map((entry, index) => {
                  const isReply = Boolean(entry.replyTo);
                  const peerId = isReply ? entry.fromSessionId : entry.toSessionId;
                  return (
                    <div key={`${requestId}-${index}-${entry.messageId || entry.seq}`} data-testid="audit-request-entry" data-kind={isReply ? 'reply' : 'ask'}>
                      <span>
                        {isReply
                          ? `${t('replied')} ${identityFor(auditSessions, entry.fromSessionId)}`
                          : `${t('asked')} ${identityFor(auditSessions, peerId)}`}
                      </span>
                      <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{shortTime(entry.ts)}</span>
                      {entry.toRole && !isReply && <span style={{ color: 'var(--muted)', marginLeft: 4 }}>· {entry.toRole}</span>}
                      <div style={{ color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 2 }}>
                        {String(entry.data || '').slice(0, 240)}
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
            {auditGroups.wakeups.length > 0 && (
              <section data-testid="audit-wakeups" style={{ border: '1px solid #e9d5ff', borderRadius: 'var(--radius)', padding: 8, display: 'grid', gap: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: 'var(--muted)' }}>{t('Timer wakeups')}</div>
                {auditGroups.wakeups.map((entry, index) => (
                  <div key={`wakeup-${index}-${entry.messageId || entry.seq}`} data-testid="audit-wakeup-entry">
                    <span style={{ color: '#7c3aed', fontWeight: 700 }}>{t('wakeup dispatched')}</span>
                    {entry.fromNodeId && <span style={{ marginLeft: 6 }}>{shortId(entry.fromNodeId)}</span>}
                    <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{shortTime(entry.ts)}</span>
                  </div>
                ))}
              </section>
            )}
            {auditGroups.legacy.map((entry, index) => (
              <div key={`legacy-${index}-${entry.messageId || entry.seq}`} data-testid="audit-legacy-entry" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 8 }}>
                <span>
                  {identityFor(auditSessions, entry.fromSessionId)}
                  <span style={{ color: 'var(--muted)' }}> → </span>
                  {identityFor(auditSessions, entry.toSessionId)}
                </span>
                <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{shortTime(entry.ts)}</span>
                <div style={{ color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 2 }}>{String(entry.data || '')}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ height: 34, padding: '4px 10px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6, fontSize: 10, color: 'var(--muted)', alignItems: 'center', flexShrink: 0 }}>
        <button onClick={fitAndSync} title={t('Fit terminal viewport')} style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 3, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2px 6px' }}>
          <Maximize2 size={9} /> {t('Fit')}
        </button>
        <button data-testid="terminal-copy-selection" onClick={copySelection} title={t('Copy selection')} style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 3, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2px 6px' }}>
          <Copy size={9} /> {t('Copy')}
        </button>
        <button data-testid="terminal-paste-clipboard" onClick={pasteClipboard} title={t('Paste clipboard')} style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 3, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2px 6px' }}>
          <Clipboard size={9} /> {t('Paste')}
        </button>
        <span style={{ flex: 1 }} />
        <span>{stopping ? t('stopping...') : interactive ? t('input enabled') : t('input locked')}</span>
        <span>{terminalSize.cols || '--'}x{terminalSize.rows || '--'}</span>
      </div>

      <div
        onPointerDown={startResize}
        title={t('Resize terminal')}
        data-testid="terminal-resize-handle"
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 18,
          height: 18,
          cursor: 'nwse-resize',
          display: fullscreen ? 'none' : 'block',
          background: 'linear-gradient(135deg, transparent 45%, rgba(107,114,128,0.35) 46%, rgba(107,114,128,0.35) 55%, transparent 56%)',
        }}
      />
    </motion.div>
    </>
  );
}
