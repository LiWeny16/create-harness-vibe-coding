import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bot, Clock3, Loader2, Pause, Play, RotateCcw, Save, Square, Target, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useT } from '../i18n';
import { useSaveShortcut } from '../hooks/useSaveShortcut';
import type { WorkflowEventNodeState, WorkflowNode } from '../types';

type TimerMode = 'manual' | 'once' | 'interval' | 'cron' | 'loop' | 'adaptive' | 'watchdog' | 'while' | 'task';
type SequencePolicy = 'repeat-last' | 'cycle' | 'stop' | 'agent-decides';

type WorkbenchEdge = {
  source?: string;
  target?: string;
  from?: string;
  to?: string;
  relation?: string;
  direction?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

type Props = {
  node: WorkflowNode;
  state: WorkflowEventNodeState;
  nodes?: WorkflowNode[];
  edges?: WorkbenchEdge[];
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
};

type LinkedNode = {
  nodeId: string;
  title: string;
  relation: string;
  direction: string;
  handle: string;
};

const TIMER_MODES: TimerMode[] = ['manual', 'once', 'interval', 'cron', 'loop', 'adaptive', 'watchdog', 'while', 'task'];
const VISIBLE_TIMER_MODES: TimerMode[] = ['manual', 'once', 'interval', 'cron', 'loop', 'adaptive', 'while', 'task'];
const SEQUENCE_CAPABLE_MODES = new Set<TimerMode>(['interval', 'loop', 'adaptive', 'watchdog', 'while', 'task']);

const TIMER_MODE_LABELS: Record<TimerMode, string> = {
  manual: 'Manual',
  once: 'Once',
  interval: 'Interval',
  cron: 'Cron',
  loop: 'Loop',
  adaptive: 'Adaptive',
  watchdog: 'Health check',
  while: 'While',
  task: 'Task',
};

function graphIdFor(node: WorkflowNode | null | undefined) {
  return node?.graphNodeId || node?.id || '';
}

function isGoal(node: WorkflowNode | null | undefined) {
  return node?.kind === 'goal-node' || String(node?.type || '').toLowerCase() === 'goal';
}

function isAgent(node: WorkflowNode | null | undefined) {
  if (!node) return false;
  if (node.kind === 'terminal-session') return true;
  if (node.agentKind) return true;
  const role = String(node.role || '').toLowerCase();
  return role.includes('agent') || role.includes('main') || role.includes('subagent') || role.includes('ceo');
}

function modeFromState(state: WorkflowEventNodeState): TimerMode {
  const mode = String(state.schedule?.mode || '').toLowerCase();
  if (mode === 'watchdog') return 'loop';
  return TIMER_MODES.includes(mode as TimerMode) ? mode as TimerMode : 'manual';
}

function numberField(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}

function formatDuration(value: unknown) {
  const seconds = Math.max(1, Math.floor(Number(value) || 0));
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function wakeupTimeLabel(value: unknown) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return '—';
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return '—';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function parseDurationToken(token: string) {
  const match = token.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2] || 's';
  const multiplier = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return Math.max(1, Math.round(value * multiplier));
}

function parseSequenceText(value: string) {
  const tokens = value
    .replace(/->/g, ',')
    .split(/[,，\n]+/)
    .map(token => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];
  const seconds = tokens.map(parseDurationToken);
  if (seconds.some(item => item === null)) return [];
  return seconds as number[];
}

function sequenceTextFromState(state: WorkflowEventNodeState) {
  const sequence = state.schedule?.cadence?.sequenceSeconds;
  if (!Array.isArray(sequence) || sequence.length === 0) return '';
  return sequence.filter(value => Number.isFinite(Number(value)) && Number(value) > 0).map(formatDuration).join(', ');
}

function sequencePolicyFromState(state: WorkflowEventNodeState): SequencePolicy {
  const value = String(state.schedule?.cadence?.afterLast || 'repeat-last');
  if (value === 'cycle' || value === 'stop' || value === 'agent-decides') return value;
  return 'repeat-last';
}

function scheduleLabel(state: WorkflowEventNodeState, mode: TimerMode, intervalSeconds: number) {
  const sequence = Array.isArray(state.schedule?.cadence?.sequenceSeconds)
    ? state.schedule.cadence.sequenceSeconds.filter(value => Number.isFinite(Number(value)) && Number(value) > 0)
    : [];
  if (sequence.length > 0 && SEQUENCE_CAPABLE_MODES.has(mode)) {
    return `sequence ${sequence.slice(0, 3).map(formatDuration).join(' -> ')}${sequence.length > 3 ? '...' : ''}`;
  }
  if (mode === 'once') return `once ${String(state.schedule?.triggerAt || '').trim() || 'scheduled'}`;
  if (mode === 'adaptive') return `adaptive ${intervalSeconds}s`;
  if (mode === 'watchdog') return `check ${Number(state.heartbeat?.watchdog?.intervalSeconds || 600)}s`;
  if (mode === 'interval' || mode === 'loop' || mode === 'while' || mode === 'task') return `${mode} ${intervalSeconds}s`;
  if (mode === 'cron') return String(state.schedule?.cron || 'cron');
  return 'manual';
}

function linkedNodesForTimer(timerIds: Set<string>, nodes: WorkflowNode[], edges: WorkbenchEdge[]) {
  const byId = new Map(nodes.flatMap(item => {
    const ids = [item.id, item.graphNodeId].filter(Boolean) as string[];
    return ids.map(id => [id, item] as const);
  }));
  const drives: LinkedNode[] = [];
  const controlledBy: LinkedNode[] = [];
  for (const edge of edges) {
    const source = edge.source || edge.from || '';
    const target = edge.target || edge.to || '';
    if (timerIds.has(source) && edge.direction === 'source-to-target') {
      const peer = byId.get(target);
      drives.push({
        nodeId: graphIdFor(peer) || target,
        title: peer?.label || target,
        relation: edge.relation || 'event',
        direction: edge.direction || 'source-to-target',
        handle: edge.targetHandle || '',
      });
    }
    if (timerIds.has(target) && edge.relation === 'control') {
      const peer = byId.get(source);
      controlledBy.push({
        nodeId: graphIdFor(peer) || source,
        title: peer?.label || source,
        relation: edge.relation || 'control',
        direction: edge.direction || 'source-to-target',
        handle: edge.sourceHandle || '',
      });
    }
  }
  return {
    goals: drives.filter(item => isGoal(byId.get(item.nodeId))),
    agents: drives.filter(item => isAgent(byId.get(item.nodeId))),
    controlledBy,
  };
}

function SmallStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="workflow-node-workbench-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LinkedList({ title, icon, items }: { title: string; icon: ReactNode; items: LinkedNode[] }) {
  return (
    <section className="workflow-node-workbench-section">
      <header>
        {icon}
        <span>{title}</span>
      </header>
      <div className="workflow-node-workbench-linked-list">
        {items.length === 0 ? (
          <span className="workflow-node-workbench-empty">None</span>
        ) : items.map(item => (
          <div key={`${item.nodeId}-${item.relation}-${item.handle}`} className="workflow-node-workbench-linked-row">
            <strong>{item.title}</strong>
            <span>{item.relation} / {item.handle || item.direction}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function WorkflowTimerExpandedNode({ node, state, nodes = [], edges = [], onClose, onSave }: Props) {
  const t = useT();
  const [title, setTitle] = useState(state.title || node.label || 'Timer Node');
  const [mode, setMode] = useState<TimerMode>(() => modeFromState(state));
  const [intervalSeconds, setIntervalSeconds] = useState(numberField(state.schedule?.intervalSeconds, 60));
  const [triggerAt, setTriggerAt] = useState(String(state.schedule?.triggerAt || ''));
  const [cron, setCron] = useState(String(state.schedule?.cron || ''));
  const [baseEnabled, setBaseEnabled] = useState(Boolean(state.heartbeat?.base?.enabled));
  const [watchdogEnabled, setWatchdogEnabled] = useState(Boolean(state.heartbeat?.watchdog?.enabled));
  const [watchdogIntervalSeconds, setWatchdogIntervalSeconds] = useState(numberField(state.heartbeat?.watchdog?.intervalSeconds, 600));
  const [watchdogTimeoutSeconds, setWatchdogTimeoutSeconds] = useState(numberField(state.heartbeat?.watchdog?.timeoutSeconds, 1800));
  const [sequenceText, setSequenceText] = useState(sequenceTextFromState(state));
  const [sequencePolicy, setSequencePolicy] = useState<SequencePolicy>(() => sequencePolicyFromState(state));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTitle(state.title || node.label || 'Timer Node');
    setMode(modeFromState(state));
    setIntervalSeconds(numberField(state.schedule?.intervalSeconds, 60));
    setTriggerAt(String(state.schedule?.triggerAt || ''));
    setCron(String(state.schedule?.cron || ''));
    setBaseEnabled(Boolean(state.heartbeat?.base?.enabled));
    setWatchdogEnabled(Boolean(state.heartbeat?.watchdog?.enabled));
    setWatchdogIntervalSeconds(numberField(state.heartbeat?.watchdog?.intervalSeconds, 600));
    setWatchdogTimeoutSeconds(numberField(state.heartbeat?.watchdog?.timeoutSeconds, 1800));
    setSequenceText(sequenceTextFromState(state));
    setSequencePolicy(sequencePolicyFromState(state));
  }, [node.label, state]);

  const graphId = state.nodeId || node.graphNodeId || node.id;
  const graphIds = useMemo(() => new Set([state.nodeId, node.graphNodeId, node.id].filter(Boolean) as string[]), [node.graphNodeId, node.id, state.nodeId]);
  const linked = useMemo(() => linkedNodesForTimer(graphIds, nodes, edges), [edges, graphIds, nodes]);
  const count = Number(state.eventCount || 0);
  const watchdogState = (mode === 'watchdog' || watchdogEnabled) ? String(state.heartbeat?.watchdog?.state || 'ok') : 'off';
  const sequenceSeconds = useMemo(() => parseSequenceText(sequenceText), [sequenceText]);
  const sequenceEnabled = SEQUENCE_CAPABLE_MODES.has(mode) && sequenceText.trim().length > 0;
  const sequenceInvalid = sequenceEnabled && sequenceSeconds.length === 0;
  const sequenceLabel = sequenceSeconds.length > 0 ? sequenceSeconds.map(formatDuration).join(' -> ') : '';

  const buildPayload = (overrides: {
    mode?: TimerMode;
    enabled?: boolean;
    baseEnabled?: boolean;
    watchdogEnabled?: boolean;
    intervalSeconds?: number;
    watchdogState?: string;
    sequenceText?: string;
  } = {}) => {
    const nextMode = overrides.mode || mode;
    const nextIntervalSeconds = overrides.intervalSeconds || intervalSeconds;
    const nextBaseEnabled = overrides.baseEnabled ?? baseEnabled;
    const nextWatchdogEnabled = overrides.watchdogEnabled ?? watchdogEnabled;
    const nextSequenceText = overrides.sequenceText ?? sequenceText;
    const nextSequenceSeconds = parseSequenceText(nextSequenceText);
    const nextSequenceEnabled = SEQUENCE_CAPABLE_MODES.has(nextMode) && nextSequenceText.trim().length > 0;
    if (nextSequenceEnabled && nextSequenceSeconds.length === 0) {
      throw new Error(t('Invalid interval sequence'));
    }
    const nextCadence = nextSequenceEnabled
      ? {
          kind: 'sequence',
          sequenceSeconds: nextSequenceSeconds,
          afterLast: sequencePolicy,
        }
      : (nextMode === 'adaptive'
          ? {
              kind: 'backoff',
              backoffFactor: Number(state.schedule?.cadence?.backoffFactor || 2),
              maxIntervalSeconds: Math.max(nextIntervalSeconds, numberField(state.schedule?.cadence?.maxIntervalSeconds, nextIntervalSeconds * 10)),
            }
          : (nextMode === 'loop' && state.schedule?.cadence?.kind === 'sequence'
              ? state.schedule.cadence
              : (state.schedule?.cadence || { kind: 'fixed' })));
    const watchdogOverride = Object.prototype.hasOwnProperty.call(overrides, 'watchdogEnabled');
    const wdtEnabled = watchdogOverride ? nextWatchdogEnabled : (nextMode === 'watchdog' || nextWatchdogEnabled);
    const schedule: Record<string, unknown> = {
      ...(state.schedule || {}),
      mode: nextMode,
      intervalSeconds: nextIntervalSeconds,
      cadence: nextCadence,
    };
    if (nextMode === 'once') schedule.triggerAt = triggerAt;
    if (nextMode === 'cron') schedule.cron = cron;
    return {
      title,
      enabled: overrides.enabled ?? (nextMode !== 'manual' && (nextMode !== 'once' || Boolean(triggerAt) || nextBaseEnabled || wdtEnabled)),
      schedule,
      heartbeat: {
        ...(state.heartbeat || {}),
        base: {
          ...(state.heartbeat?.base || {}),
          enabled: nextMode === 'once' ? false : nextBaseEnabled,
          intervalSeconds: nextIntervalSeconds,
        },
        watchdog: {
          ...(state.heartbeat?.watchdog || {}),
          enabled: wdtEnabled,
          intervalSeconds: watchdogIntervalSeconds,
          timeoutSeconds: watchdogTimeoutSeconds,
          state: overrides.watchdogState || (wdtEnabled ? 'ok' : 'disabled'),
        },
      },
    };
  };

  const savePayload = async (payload: Record<string, unknown>) => {
    setSaving(true);
    setError('');
    try {
      await onSave(payload);
    } catch (e: any) {
      setError(e?.message || t('Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (sequenceInvalid) {
      setError(t('Invalid interval sequence'));
      return;
    }
    await savePayload(buildPayload());
  };

  // Component mounts only while the timer expanded view is open.
  useSaveShortcut(save, true);

  const runTimerControl = async (action: 'start' | 'pause' | 'stop' | 'reset') => {
    try {
      if (action === 'start') {
        const nextMode = mode === 'manual' ? 'loop' : mode;
        setMode(nextMode);
        setBaseEnabled(nextMode !== 'once');
        await savePayload(buildPayload({
          mode: nextMode,
          enabled: true,
          baseEnabled: nextMode !== 'once',
          watchdogEnabled: nextMode === 'watchdog' || watchdogEnabled,
          watchdogState: 'ok',
        }));
        return;
      }
      if (action === 'pause') {
        setBaseEnabled(false);
        setWatchdogEnabled(false);
        await savePayload(buildPayload({
          enabled: false,
          baseEnabled: false,
          watchdogEnabled: false,
          watchdogState: 'paused',
        }));
        return;
      }
      if (action === 'stop') {
        setBaseEnabled(false);
        setWatchdogEnabled(false);
        await savePayload(buildPayload({
          enabled: false,
          baseEnabled: false,
          watchdogEnabled: false,
          watchdogState: 'stopped',
        }));
        return;
      }
      setMode('manual');
      setBaseEnabled(false);
      setWatchdogEnabled(false);
      setSequenceText('');
      await savePayload(buildPayload({
        mode: 'manual',
        enabled: false,
        baseEnabled: false,
        watchdogEnabled: false,
        watchdogState: 'disabled',
        sequenceText: '',
      }));
    } catch (e: any) {
      setError(e?.message || t('Timer control failed'));
    }
  };

  return (
    <motion.div
      data-canvas-control="true"
      data-testid="workflow-timer-expanded-node"
      data-node-id={graphId}
      className="workflow-runtime-expanded-backdrop nodrag nopan nowheel"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <motion.section
        className="workflow-runtime-expanded-shell workflow-timer-expanded-shell workflow-node-workbench-shell"
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.99 }}
        transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
      >
        <header className="workflow-runtime-expanded-header">
          <div>
            <Clock3 size={16} />
            <input data-testid="workflow-timer-expanded-title" value={title} onChange={event => setTitle(event.target.value)} aria-label={t('Timer title')} />
          </div>
          <button type="button" data-testid="workflow-runtime-expanded-close" onClick={onClose} title={t('Close')}>
            <X size={14} />
          </button>
        </header>

        <div className="workflow-runtime-expanded-body workflow-node-workbench-body">
          <main className="workflow-node-workbench-preview">
            <section className="workflow-event-node workflow-node-workbench-preview-node workflow-timer-workbench-node">
              <span className="workflow-node-workbench-port workflow-node-workbench-port-left" />
              <span className="workflow-node-workbench-port workflow-node-workbench-port-right" />
              <span className="workflow-node-workbench-port workflow-node-workbench-port-bottom" />
              <header className="workflow-node-workbench-node-header">
                <span className="workflow-timer-workbench-icon"><Clock3 size={21} /></span>
                <div>
                  <strong>{title || 'Timer Node'}</strong>
                  <span>{watchdogEnabled ? 'health check timer' : 'event source'}</span>
                </div>
              </header>
              <div className="workflow-timer-workbench-grid">
                <SmallStat label={t('Schedule')} value={sequenceLabel ? `sequence ${sequenceLabel}` : scheduleLabel(state, mode, intervalSeconds)} />
                <SmallStat label={t('Events')} value={count} />
                <SmallStat label={t('Wakeup')} value={count > 0 ? `last ${wakeupTimeLabel(state.lastFiredAt)}` : 'none'} />
                <SmallStat label={t('Base')} value={baseEnabled ? `${intervalSeconds}s` : 'off'} />
                <SmallStat label={t('Agent check')} value={(mode === 'watchdog' || watchdogEnabled) ? `${watchdogIntervalSeconds}s ${watchdogState}` : 'off'} />
              </div>
              <span className="workflow-node-workbench-empty" style={{ display: 'block', fontSize: 10 }}>{t('Fires dispatch wakeup messages to group agents')}</span>
              <footer>
                <span>event -&gt; {linked.goals.length + linked.agents.length}</span>
                <span>rev {state.revision || node.revision || 1}</span>
              </footer>
            </section>
          </main>

          <aside className="workflow-node-workbench-config">
            <div className="workflow-runtime-mode-row" role="group" aria-label={t('Timer mode')}>
              {VISIBLE_TIMER_MODES.map(item => (
                <button key={item} type="button" data-testid="workflow-timer-mode" data-mode={item} aria-pressed={mode === item ? 'true' : 'false'} onClick={() => setMode(item)}>
                  {t(TIMER_MODE_LABELS[item])}
                </button>
              ))}
            </div>

            <div className="workflow-timer-control-row" role="group" aria-label={t('Timer controls')}>
              <button type="button" data-testid="workflow-timer-control-start" onClick={() => runTimerControl('start')} disabled={saving}>
                <Play size={14} /> {t('Start')}
              </button>
              <button type="button" data-testid="workflow-timer-control-pause" onClick={() => runTimerControl('pause')} disabled={saving}>
                <Pause size={14} /> {t('Pause')}
              </button>
              <button type="button" data-testid="workflow-timer-control-stop" onClick={() => runTimerControl('stop')} disabled={saving}>
                <Square size={14} /> {t('Stop')}
              </button>
              <button type="button" data-testid="workflow-timer-control-reset" onClick={() => runTimerControl('reset')} disabled={saving}>
                <RotateCcw size={14} /> {t('Reset')}
              </button>
            </div>

            <div className="workflow-node-workbench-field-grid">
              <label className="workflow-node-workbench-field">
                <span>{t(mode === 'once' ? 'Trigger at' : 'Interval seconds')}</span>
                {mode === 'once' ? (
                  <input data-testid="workflow-timer-trigger-at" value={triggerAt} onChange={event => setTriggerAt(event.target.value)} placeholder="2026-08-05T15:30:00.000Z" />
                ) : (
                  <input data-testid="workflow-timer-interval-seconds" type="number" min={1} max={86400} value={intervalSeconds} onChange={event => setIntervalSeconds(numberField(event.target.value, intervalSeconds))} />
                )}
              </label>
              {mode === 'cron' && (
                <label className="workflow-node-workbench-field">
                  <span>{t('Cron')}</span>
                  <input data-testid="workflow-timer-cron" value={cron} onChange={event => setCron(event.target.value)} placeholder="*/5 * * * *" />
                </label>
              )}
              {mode === 'once' && (
                <label className="workflow-node-workbench-field">
                  <span>{t('Reminder window')}</span>
                  <input data-testid="workflow-timer-interval-seconds" type="number" min={1} max={86400} value={intervalSeconds} onChange={event => setIntervalSeconds(numberField(event.target.value, intervalSeconds))} />
                </label>
              )}
            </div>

            {SEQUENCE_CAPABLE_MODES.has(mode) && (
              <section className="workflow-node-workbench-section">
                <header>
                  <Clock3 size={14} />
                  <span>{t('Interval sequence')}</span>
                </header>
                <label className="workflow-node-workbench-field workflow-node-workbench-field-wide">
                  <input
                    data-testid="workflow-timer-sequence"
                    value={sequenceText}
                    onChange={event => setSequenceText(event.target.value)}
                    placeholder="2h, 3h, 6h"
                    aria-invalid={sequenceInvalid ? 'true' : 'false'}
                  />
                </label>
                <div className="workflow-timer-sequence-row">
                  {(sequenceSeconds.length > 0 ? sequenceSeconds : [intervalSeconds]).slice(0, 6).map((seconds, index) => (
                    <span key={`${seconds}-${index}`} data-active={sequenceSeconds.length > 0 ? 'true' : 'false'}>
                      {formatDuration(seconds)}
                    </span>
                  ))}
                </div>
                <label className="workflow-node-workbench-field workflow-node-workbench-field-wide">
                  <select value={sequencePolicy} onChange={event => setSequencePolicy(event.target.value as SequencePolicy)}>
                    <option value="repeat-last">{t('Repeat last')}</option>
                    <option value="cycle">{t('Cycle')}</option>
                    <option value="stop">{t('Stop after sequence')}</option>
                    <option value="agent-decides">{t('Agent decides')}</option>
                  </select>
                </label>
              </section>
            )}

            <div className="workflow-node-workbench-field-grid">
              <label className="workflow-runtime-toggle workflow-node-workbench-toggle">
                <input data-testid="workflow-timer-base-enabled" type="checkbox" checked={baseEnabled} onChange={event => setBaseEnabled(event.target.checked)} />
                <span>{t('Base heartbeat')}</span>
              </label>
              <label className="workflow-runtime-toggle workflow-node-workbench-toggle">
                <input data-testid="workflow-timer-watchdog-enabled" type="checkbox" checked={watchdogEnabled || mode === 'watchdog'} onChange={event => setWatchdogEnabled(event.target.checked)} />
                <span>{t('Agent health check')}</span>
              </label>
              <label className="workflow-node-workbench-field">
                <span>{t('Check every')}</span>
                <input data-testid="workflow-timer-watchdog-interval" type="number" min={1} max={604800} value={watchdogIntervalSeconds} onChange={event => setWatchdogIntervalSeconds(numberField(event.target.value, watchdogIntervalSeconds))} />
              </label>
              <label className="workflow-node-workbench-field">
                <span>{t('Mark offline after')}</span>
                <input data-testid="workflow-timer-watchdog-timeout" type="number" min={1} max={604800} value={watchdogTimeoutSeconds} onChange={event => setWatchdogTimeoutSeconds(numberField(event.target.value, watchdogTimeoutSeconds))} />
              </label>
            </div>

            <LinkedList title={t('Drives goals')} icon={<Target size={14} />} items={linked.goals} />
            <LinkedList title={t('Drives agents')} icon={<Bot size={14} />} items={linked.agents} />
            <LinkedList title={t('Controlled by')} icon={<Bot size={14} />} items={linked.controlledBy} />
          </aside>
        </div>

        <footer className="workflow-runtime-expanded-footer">
          <span>{linked.goals.length} goal(s), {linked.agents.length} agent(s) - rev {state.revision || 0}</span>
          {error && <strong>{error}</strong>}
          <button type="button" data-testid="workflow-timer-expanded-save" onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {saving ? <Loader2 size={13} style={{ animation: 'loading-spin 0.8s linear infinite', flexShrink: 0 }} /> : <Save size={13} />} {saving ? t('Saving...') : t('Save')}
          </button>
        </footer>
      </motion.section>
    </motion.div>
  );
}
