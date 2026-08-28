import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Clock3 } from 'lucide-react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { executeNodeActionResponse } from './workflow/nodeRuntimeClient';
import type { WorkflowAgentControl, WorkflowEventNodeState, WorkflowNode } from '../types';

export type WorkflowEventNodeData = Record<string, unknown> & {
  workflowNode: WorkflowNode;
  eventState?: WorkflowEventNodeState;
  viewportZoom: number;
  agentControl?: WorkflowAgentControl;
};

export type WorkflowEventFlowNode = import('@xyflow/react').Node<WorkflowEventNodeData, 'workflowEventNode'>;

function scheduleLabel(state: WorkflowEventNodeState | undefined) {
  const schedule = state?.schedule || {};
  const mode = String(schedule.mode || 'manual');
  const sequence = Array.isArray(schedule.cadence?.sequenceSeconds)
    ? schedule.cadence?.sequenceSeconds.filter(value => Number.isFinite(Number(value)) && Number(value) > 0)
    : [];
  if (mode === 'once') return `once ${String(schedule.triggerAt || '').trim() || 'scheduled'}`;
  if (sequence.length > 0) return `sequence ${sequence.slice(0, 3).map(formatDuration).join(' -> ')}${sequence.length > 3 ? '...' : ''}`;
  if (mode === 'adaptive') return `adaptive ${Number(schedule.intervalSeconds || 60)}s`;
  if (mode === 'watchdog') return `check ${Number(state?.heartbeat?.watchdog?.intervalSeconds || 600)}s`;
  if (mode === 'interval' || mode === 'loop' || mode === 'while' || mode === 'task') return `${mode} ${Number(schedule.intervalSeconds || 60)}s`;
  if (mode === 'cron') return String(schedule.cron || 'cron');
  return 'manual';
}

function formatDuration(value: unknown) {
  const seconds = Math.max(1, Math.floor(Number(value) || 0));
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function timerIntervalSeconds(state: WorkflowEventNodeState | undefined) {
  return Math.max(1, Math.floor(Number(
    state?.heartbeat?.base?.intervalSeconds
    || state?.schedule?.intervalSeconds
    || 60,
  ) || 60));
}

function parseTimeMs(value: unknown) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

function timerCountdownSeconds(state: WorkflowEventNodeState | undefined, nowMs: number) {
  const interval = timerIntervalSeconds(state);
  const nextDueMs = parseTimeMs(state?.heartbeat?.base?.nextDueAt);
  if (nextDueMs > 0) {
    const remaining = Math.ceil((nextDueMs - nowMs) / 1000);
    if (remaining > 0) return remaining;
    const overdue = Math.abs(remaining);
    const modulo = overdue % interval;
    return modulo === 0 ? interval : interval - modulo;
  }
  const lastMs = parseTimeMs(state?.heartbeat?.base?.lastAt || state?.lastFiredAt);
  if (lastMs > 0) {
    const elapsed = Math.max(0, Math.floor((nowMs - lastMs) / 1000));
    const modulo = elapsed % interval;
    return modulo === 0 ? interval : interval - modulo;
  }
  return interval;
}

function formatWakeupTime(value: unknown) {
  const time = parseTimeMs(value);
  if (!time) return '—';
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return '—';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatClockSeconds(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

const TIMER_MODE_COLORS: Record<string, string> = {
  loop: '#16a34a',
  while: '#2563eb',
  task: '#7c3aed',
  interval: '#0d9488',
  cron: '#ea580c',
  once: '#4f46e5',
  manual: '#64748b',
  adaptive: '#db2777',
  watchdog: '#dc2626',
};

function formatNextDueAbsolute(value: unknown) {
  const time = parseTimeMs(value);
  if (!time) return '';
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}:${ss}`;
  const yyyy = date.getFullYear();
  const mon = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mon}-${day} ${hh}:${mm}:${ss}`;
}

export default function WorkflowEventNode({ data, selected }: NodeProps<WorkflowEventFlowNode>) {
  const node = data.workflowNode;
  const propState = data.eventState;
  const zoom = Math.max(0.05, Number(data.viewportZoom || 1));
  const handleScale = 1 / zoom;
  const handleBaseStyle = {
    width: 16,
    height: 16,
    zIndex: 30,
    pointerEvents: 'all' as const,
    transformOrigin: 'center',
  };
  // After timer.enable / timer.disable the card refreshes its own display from
  // the action response's after-snapshot so the countdown restarts immediately;
  // the prop snapshot wins again once the workflow poll catches up (prop
  // revision >= action snapshot revision).
  const [actionState, setActionState] = useState<WorkflowEventNodeState | undefined>(undefined);
  const [actionPending, setActionPending] = useState(false);
  // Optimistic preview: the toggle label flips synchronously on click so the
  // button never feels dead while the timer action round-trips. It clears when
  // the response lands (success keeps the flipped label via the after-snapshot,
  // failure reverts it to the base state). pendingRef guards double-clicks
  // synchronously — React state alone would race within the same tick.
  const pendingRef = useRef(false);
  const [optimisticAction, setOptimisticAction] = useState<'start' | 'stop' | null>(null);
  const state = actionState && (actionState.revision ?? 0) > (propState?.revision ?? 0) ? actionState : propState;
  const count = Number(state?.eventCount || 0);
  const baseHeartbeat = state?.heartbeat?.base;
  const watchdog = state?.heartbeat?.watchdog;
  const watchdogState = watchdog?.enabled ? String(watchdog.state || 'ok') : 'off';
  const timerEnabled = Boolean(state?.enabled);
  const timerRunning = Boolean(timerEnabled && baseHeartbeat?.enabled);
  const timerStatus = timerRunning ? 'running' : (timerEnabled ? 'armed' : 'stopped');
  const timerInterval = timerIntervalSeconds(state);
  const scheduleMode = String(state?.schedule?.mode || 'manual');
  const nextDueAbsolute = formatNextDueAbsolute(baseHeartbeat?.nextDueAt);
  const modeBadgeColor = TIMER_MODE_COLORS[scheduleMode] || TIMER_MODE_COLORS.manual;
  const nextDueMs = parseTimeMs(baseHeartbeat?.nextDueAt);
  // The countdown is live only while the timer is running/armed AND the
  // backend has produced a nextDueAt; otherwise the card shows the idle mark.
  const countdownLive = timerStatus !== 'stopped' && nextDueMs > 0;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!countdownLive) return undefined;
    setNowMs(Date.now());
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [countdownLive, node.graphNodeId, state?.revision]);
  const countdownSeconds = useMemo(() => (
    countdownLive ? timerCountdownSeconds(state, nowMs) : 0
  ), [countdownLive, state, nowMs]);
  const countdownProgress = countdownLive
    ? Math.max(0, Math.min(1, (timerInterval - countdownSeconds) / timerInterval))
    : 0;
  const toggleAction = timerStatus === 'stopped' ? 'start' : 'stop';
  const displayAction = optimisticAction ?? toggleAction;
  const runTimerToggle = async () => {
    if (pendingRef.current) return;
    const action = toggleAction === 'start' ? 'enable' : 'disable';
    pendingRef.current = true;
    setActionPending(true);
    // Instant visual flip (启动 <-> 终止) before the API round-trip completes;
    // reconciled with the after-snapshot on success, reverted on failure.
    setOptimisticAction(toggleAction === 'start' ? 'stop' : 'start');
    try {
      const response = await executeNodeActionResponse(node.graphNodeId || node.id, `timer.${action}`);
      const after = response?.state
        ?? (response?.result as { state?: WorkflowEventNodeState } | undefined)?.state
        ?? response?.result;
      if (after && typeof after === 'object') {
        setActionState(after as WorkflowEventNodeState);
      } else {
        console.warn(`timer.${action}: response did not include an event-node snapshot for ${node.graphNodeId || node.id}`);
      }
    } catch (error) {
      console.warn(`timer.${action} failed for ${node.graphNodeId || node.id}`, error);
    } finally {
      pendingRef.current = false;
      setActionPending(false);
      setOptimisticAction(null);
    }
  };
  const handleToggleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void runTimerToggle();
  };
  const handles = [
    { id: 'top', side: 'top', position: Position.Top, style: { left: '50%', transform: `translate(-50%, -50%) scale(${handleScale})` } },
    { id: 'event', side: 'right', position: Position.Right, style: { top: '50%', transform: `translate(50%, -50%) scale(${handleScale})` } },
    { id: 'bottom', side: 'bottom', position: Position.Bottom, style: { left: '50%', transform: `translate(-50%, 50%) scale(${handleScale})` } },
    { id: 'config', side: 'left', position: Position.Left, style: { top: '50%', transform: `translate(-50%, -50%) scale(${handleScale})` } },
  ];

  return (
    <section
      data-testid="workflow-event-node"
      data-node-id={node.graphNodeId || node.id}
      data-event-type={node.type || 'timer'}
      data-base-heartbeat={baseHeartbeat?.enabled ? 'on' : 'off'}
      data-watchdog-state={watchdogState}
      data-timer-enabled={timerEnabled ? 'true' : 'false'}
      data-timer-status={timerStatus}
      data-selected={selected ? 'true' : 'false'}
      data-agent-controlled={data.agentControl?.active ? 'true' : undefined}
      data-agent-control-operation-id={data.agentControl?.active ? data.agentControl.operationId : undefined}
      className="workflow-event-node"
      style={{
        '--agent-control-color': data.agentControl?.color || '#22c55e',
        width: 276,
        border: `1px solid ${selected ? '#2563eb' : '#bae6fd'}`,
        borderRadius: 14,
        background: '#f8fbff',
        boxShadow: selected ? '0 12px 32px rgba(37,99,235,0.16)' : '0 10px 26px rgba(15,23,42,0.08)',
        color: 'var(--fg)',
        position: 'relative',
        display: 'grid',
        gridTemplateRows: 'auto auto auto 1fr auto',
        padding: 12,
        gap: 8,
      } as CSSProperties}
    >
      {handles.map(handle => (
        <Handle
          key={handle.side}
          id={handle.id}
          type="source"
          position={handle.position}
          data-testid={handle.side === 'left' ? 'workflow-event-node-input' : (handle.side === 'right' ? 'workflow-event-node-output' : 'workflow-event-node-port')}
          data-input-id={handle.side === 'left' ? 'config' : undefined}
          data-output-id={handle.side === 'right' ? 'event' : undefined}
          data-handle-side={handle.side}
          data-handle-role="bidirectional"
          isConnectableStart
          isConnectableEnd
          className={[
            'wf-flow-handle nodrag nopan workflow-event-node-handle',
            `workflow-event-node-handle-${handle.side}`,
            handle.side === 'left' ? 'workflow-event-node-handle-config' : '',
            handle.side === 'right' ? 'workflow-event-node-handle-event' : '',
            handle.side === 'bottom' ? 'workflow-event-node-handle-status' : '',
          ].filter(Boolean).join(' ')}
          style={{
            ...handleBaseStyle,
            ...handle.style,
          }}
        />
      ))}

      <header style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', border: '1px solid #bae6fd', borderRadius: 'var(--radius)', color: '#0369a1', background: '#e0f2fe' }}>
          <Clock3 size={15} />
        </span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <div style={{ fontSize: 14, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.label || state?.title || 'Timer Node'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 800 }}>
            {watchdog?.enabled ? 'health check timer' : 'event source'}
          </div>
        </div>
        <button
          type="button"
          className="nodrag nopan nowheel workflow-timer-toggle"
          data-testid="workflow-timer-state"
          data-state={timerStatus}
          data-action={displayAction}
          data-pending={actionPending ? 'true' : undefined}
          aria-label={`Timer ${timerStatus}`}
          onClick={handleToggleClick}
          disabled={actionPending}
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 48,
            height: 22,
            padding: '0 9px',
            border: `1px solid ${timerStatus === 'stopped' ? '#93c5fd' : '#fca5a5'}`,
            borderRadius: 999,
            background: timerStatus === 'stopped' ? '#eff6ff' : '#fef2f2',
            color: timerStatus === 'stopped' ? '#1d4ed8' : '#b91c1c',
            fontSize: 11,
            fontWeight: 800,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            cursor: actionPending ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <span
            className="workflow-timer-status-sr-only"
            style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}
          >
            {timerStatus}
          </span>
          <span
            key={`${displayAction}:${actionPending ? 'pending' : 'idle'}`}
            className="workflow-timer-toggle-label"
            data-testid="workflow-timer-toggle"
            data-action={displayAction}
          >
            {actionPending ? <span className="workflow-timer-toggle-spinner" aria-hidden="true" /> : null}
            {displayAction === 'start' ? '启动' : '终止'}
          </span>
        </button>
      </header>

      <div
        className="workflow-timer-countdown"
        data-testid="workflow-timer-countdown"
        data-active={countdownLive ? 'true' : 'false'}
      >
        <div className="workflow-timer-countdown-main">
          <span>{countdownLive ? 'Next' : 'Idle'}</span>
          <strong>{countdownLive ? formatClockSeconds(countdownSeconds) : '—'}</strong>
          <small>{formatDuration(timerInterval)}</small>
        </div>
        <div className="workflow-timer-progress" aria-hidden="true">
          <span style={{ width: `${Math.round(countdownProgress * 100)}%` }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <span
            className="workflow-timer-mode-badge"
            data-testid="workflow-timer-mode-badge"
            data-mode={scheduleMode}
            style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, padding: '1px 6px', borderRadius: 999, color: '#ffffff', background: modeBadgeColor, minWidth: 44, textAlign: 'center' as const }}
          >
            {scheduleMode}
          </span>
          {countdownLive && nextDueAbsolute ? (
            <span
              data-testid="workflow-timer-next-due"
              style={{ fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}
            >
              due {nextDueAbsolute}
            </span>
          ) : null}
        </div>
      </div>

      <div
        data-testid="workflow-timer-wakeup"
        data-dispatched={count > 0 ? 'true' : 'false'}
        style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}
      >
        <span
          style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, padding: '1px 6px', borderRadius: 999, color: '#ffffff', background: count > 0 ? '#7c3aed' : '#cbd5e1', minWidth: 52, textAlign: 'center' as const, flexShrink: 0 }}
        >
          wakeup
        </span>
        <span style={{ fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {count > 0 ? (state?.lastFiredAt ? `last fired ${formatWakeupTime(state?.lastFiredAt)}` : null) : 'no wakeups yet'}
        </span>
        <span style={{ fontSize: 10, color: '#7c3aed', flexShrink: 0 }}>→ group agents</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start', minWidth: 0 }}>
        <div style={{ minWidth: 0, border: '1px solid #dbeafe', borderRadius: 'var(--radius)', background: '#ffffff', padding: '8px 9px' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>Schedule</div>
          <div style={{ fontSize: 13, fontWeight: 800, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scheduleLabel(state)}</div>
        </div>
        <div data-testid="workflow-timer-event-count" style={{ minWidth: 0, border: '1px solid #dbeafe', borderRadius: 'var(--radius)', background: '#ffffff', padding: '8px 9px' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>Events</div>
          <div style={{ fontSize: 13, fontWeight: 800, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{count}</div>
        </div>
        <div data-testid="workflow-timer-base-heartbeat" style={{ minWidth: 0, border: '1px solid #dbeafe', borderRadius: 'var(--radius)', background: '#ffffff', padding: '7px 9px' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>Base</div>
          <div style={{ fontSize: 12, fontWeight: 800, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{baseHeartbeat?.enabled ? `${Number(baseHeartbeat.intervalSeconds || state?.schedule?.intervalSeconds || 60)}s` : 'off'}</div>
        </div>
        <div data-testid="workflow-timer-watchdog" style={{ minWidth: 0, border: '1px solid #dbeafe', borderRadius: 'var(--radius)', background: '#ffffff', padding: '7px 9px' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>Check</div>
          <div style={{ fontSize: 12, fontWeight: 800, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{watchdog?.enabled ? `${Number(watchdog.intervalSeconds || 600)}s ${watchdogState}` : 'off'}</div>
        </div>
      </div>

      <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--muted)', fontSize: 11 }}>
        <span>timer event source</span>
        <span>rev {state?.revision || node.revision || 1}</span>
      </footer>
    </section>
  );
}
