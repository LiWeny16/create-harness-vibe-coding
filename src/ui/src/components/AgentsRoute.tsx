import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Bot, Check, Database, ExternalLink, Plus, RefreshCw, Settings2, Square, Terminal, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { apiJson, apiJsonCached, invalidateApiCache } from '../api';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { CleanupSummary, RuntimeConfigFile, RuntimeInfo, Session, WorkflowSnapshot } from '../types';
import LoadingView from './LoadingView';
import RuntimePicker from './RuntimePicker';
import { useT } from '../i18n/index';
import { RuntimeBrandLabel, RuntimeBrandMark } from '../runtimeBrand';

type Props = { onSelectSession: (sessionId: string) => void };
type RuntimeConfig = { runtime: string; files: RuntimeConfigFile[] };
type AgentsConsistency = {
  workflowLiveCount: number;
  runningPtyCount: number;
  workflowNodeCount: number;
  missingInAgents: string[];
  missingOnWorkflow: string[];
};
const SAVED_PAGE_SIZE = 5;

const PANEL: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
};

function statusColor(status: string) {
  const state = displaySessionStatus(status);
  if (state === 'running' || state === 'available') return '#166534';
  if (state === 'blocked' || state === 'missing') return '#991b1b';
  if (state === 'starting') return '#d97706';
  return '#6b7280';
}

function displaySessionStatus(status: string | undefined) {
  if (status === 'saved') return 'stopped';
  return status || 'unknown';
}

function compactPath(value: string | null | undefined) {
  if (!value) return '';
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.length > 4 ? `.../${parts.slice(-3).join('/')}` : value;
}

function shortSessionId(value: string | undefined) {
  if (!value) return '-';
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'unavailable';
  const bytes = Math.max(0, Number(value));
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
}

function formatPercent(value: number | null | undefined, fallback = 'warming') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return fallback;
  return `${Math.max(0, Number(value)).toFixed(1)}%`;
}

function isKnownNumber(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function isLiveStatus(status: string | undefined) {
  return status === 'running' || status === 'starting';
}

function consistencyFromSnapshot(snapshot: WorkflowSnapshot | null, sessions: Session[]): AgentsConsistency {
  const liveSessionIds = new Set(sessions.filter(session => isLiveStatus(session.status)).map(session => session.sessionId));
  const workflowSessionNodes = (snapshot?.nodes || []).filter(node => node.sessionId);
  const workflowSessionIds = new Set(workflowSessionNodes.map(node => node.sessionId!).filter(Boolean));
  const workflowLiveIds = new Set(
    workflowSessionNodes
      .filter(node => isLiveStatus(node.status))
      .map(node => node.sessionId!)
      .filter(Boolean),
  );
  return {
    workflowLiveCount: workflowLiveIds.size,
    runningPtyCount: liveSessionIds.size,
    workflowNodeCount: snapshot?.nodes?.length || 0,
    missingInAgents: [...workflowLiveIds].filter(id => !liveSessionIds.has(id)),
    missingOnWorkflow: [...liveSessionIds].filter(id => !workflowSessionIds.has(id)),
  };
}

export default function AgentsRoute({ onSelectSession }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [savedSessions, setSavedSessions] = useState<Session[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [showSaved, setShowSaved] = useState(true);
  const [savedPage, setSavedPage] = useState(0);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState('');
  const [launchModel, setLaunchModel] = useState('');
  const [creating, setCreating] = useState(false);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(() => new Set());
  const stoppingIdsRef = useRef<Set<string>>(new Set());
  const [cleanupSummary, setCleanupSummary] = useState<CleanupSummary | null>(null);
  const [workflowConsistency, setWorkflowConsistency] = useState<AgentsConsistency | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configRuntimeId, setConfigRuntimeId] = useState<string | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [configScope, setConfigScope] = useState('user');
  const [configSaved, setConfigSaved] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const t = useT();

  const selectedRuntime = useMemo(
    () => runtimes.find(runtime => runtime.id === selectedRuntimeId) || null,
    [runtimes, selectedRuntimeId],
  );

  const runningSessions = sessions;
  const resourceTotals = useMemo(() => {
    if (runningSessions.length === 0) {
      return {
        memoryBytes: null,
        cpuPercent: null,
        viewers: 0,
        pids: 0,
      };
    }
    const memoryBytes = runningSessions.reduce((sum, session) => {
      const value = session.resourceUsage?.memoryBytes;
      return isKnownNumber(value) ? sum + Number(value) : sum;
    }, 0);
    const cpuPercent = runningSessions.reduce((sum, session) => {
      const value = session.resourceUsage?.cpuPercent;
      return isKnownNumber(value) ? sum + Number(value) : sum;
    }, 0);
    const memoryKnown = runningSessions.some(session => isKnownNumber(session.resourceUsage?.memoryBytes));
    const cpuKnown = runningSessions.some(session => isKnownNumber(session.resourceUsage?.cpuPercent));
    const viewers = runningSessions.reduce((sum, session) => sum + Number(session.resourceUsage?.wsClientCount ?? session.wsClientCount ?? 0), 0);
    const pids = runningSessions.filter(session => isKnownNumber(session.resourceUsage?.pid ?? session.pid)).length;
    return {
      memoryBytes: memoryKnown ? memoryBytes : null,
      cpuPercent: cpuKnown ? cpuPercent : null,
      viewers,
      pids,
    };
  }, [runningSessions]);
  const savedPageCount = Math.max(1, Math.ceil(savedSessions.length / SAVED_PAGE_SIZE));
  const visibleSavedSessions = savedSessions.slice(
    savedPage * SAVED_PAGE_SIZE,
    savedPage * SAVED_PAGE_SIZE + SAVED_PAGE_SIZE,
  );

  const updateStoppingIds = (updater: (current: Set<string>) => Set<string>) => {
    setStoppingIds(current => {
      const next = updater(current);
      stoppingIdsRef.current = next;
      return next;
    });
  };

  const loadControlPlane = async (refresh = false) => {
    try {
      if (refresh) invalidateApiCache('/api/runtimes');
      const [runtimeRows, sessionRows, allRows, cleanup, workflowSnapshot] = await Promise.all([
        apiJsonCached<RuntimeInfo[]>(refresh ? '/api/runtimes?refresh=1' : '/api/runtimes', { ttlMs: 12000, refresh }),
        apiJson<Session[]>('/api/sessions'),
        apiJsonCached<Session[]>('/api/sessions?all=1', { ttlMs: refresh ? 0 : 3000, refresh }).catch(() => []),
        apiJsonCached<CleanupSummary>('/api/cleanup/summary', { ttlMs: refresh ? 0 : 5000, refresh }).catch(() => null),
        apiJsonCached<WorkflowSnapshot>('/api/a2a/snapshot', { ttlMs: refresh ? 0 : 1200, refresh }).catch(() => null),
      ]);
      const pendingStops = stoppingIdsRef.current;
      setRuntimes(runtimeRows);
      setSessions(sessionRows.filter(session => !pendingStops.has(session.sessionId)));
      setSavedSessions(allRows.filter(session => session.status !== 'running' && session.status !== 'starting'));
      setCleanupSummary(cleanup);
      setWorkflowConsistency(consistencyFromSnapshot(workflowSnapshot, sessionRows));
      updateStoppingIds(current => {
        if (current.size === 0) return current;
        const liveIds = new Set(sessionRows.map(session => session.sessionId));
        return new Set([...current].filter(id => liveIds.has(id)));
      });
      setSelectedRuntimeId(current => current && runtimeRows.some(row => row.id === current)
        ? current
        : runtimeRows[0]?.id || '');
      setError(null);
    } catch (e: any) {
      setError(e?.message || t('Failed to load agent terminals'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadControlPlane();
    const interval = setInterval(() => loadControlPlane(false), 1200);
    const onSessionsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; state?: string }>).detail;
      if (detail?.sessionId && detail.state === 'stopping') {
        updateStoppingIds(current => new Set(current).add(detail.sessionId!));
        setSessions(current => current.filter(session => session.sessionId !== detail.sessionId));
        return;
      }
      if (detail?.sessionId && (detail.state === 'stopped' || detail.state === 'saved')) {
        updateStoppingIds(current => {
          const next = new Set(current);
          next.delete(detail.sessionId!);
          return next;
        });
        setSessions(current => current.filter(session => session.sessionId !== detail.sessionId));
      }
      loadControlPlane(true);
    };
    window.addEventListener('harness:sessions-changed', onSessionsChanged);
    return () => {
      clearInterval(interval);
      window.removeEventListener('harness:sessions-changed', onSessionsChanged);
    };
  }, [showSaved]);

  useEffect(() => {
    setSavedPage(page => Math.min(page, Math.max(0, savedPageCount - 1)));
  }, [savedPageCount]);

  const openConfig = async (runtimeId: string) => {
    setConfigRuntimeId(runtimeId);
    setRuntimeConfig(null);
    setConfigValues({});
    setConfigSaved(null);
    try {
      const data = await apiJson<RuntimeConfig>(`/api/runtimes/${encodeURIComponent(runtimeId)}/config`);
      setRuntimeConfig(data);
      const writable = data.files.find(file => file.writable) || data.files[0];
      setConfigScope(writable?.scope || 'user');
      setConfigValues({ ...(writable?.values || {}) });
    } catch (e: any) {
      setError(e?.message || t('Failed to load runtime config'));
    }
  };

  const selectedConfigFile = runtimeConfig?.files.find(file => file.scope === configScope && file.writable)
    || runtimeConfig?.files.find(file => file.writable)
    || null;

  const switchConfigScope = (scope: string) => {
    const nextFile = runtimeConfig?.files.find(file => file.scope === scope) || null;
    setConfigScope(scope);
    setConfigValues({ ...(nextFile?.values || {}) });
    setConfigSaved(null);
  };

  const saveConfig = async () => {
    if (!configRuntimeId || !selectedConfigFile) return;
    setConfigSaved(null);
    try {
      const result = await apiJson<{ path: string; backupPath?: string | null }>(
        `/api/runtimes/${encodeURIComponent(configRuntimeId)}/config`,
        {
          method: 'POST',
          body: JSON.stringify({ scope: selectedConfigFile.scope, values: configValues }),
        },
      );
      setConfigSaved(result.backupPath ? `Saved with backup: ${compactPath(result.backupPath)}` : `Saved: ${result.path}`);
      await openConfig(configRuntimeId);
    } catch (e: any) {
      setError(e?.message || t('Failed to save runtime config'));
    }
  };

  const createSession = async (runtimeId = selectedRuntimeId) => {
    if (!runtimeId) return;
    setCreating(true);
    setError(null);
    try {
      const session = await apiJson<Session>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          runtime: runtimeId,
          model: launchModel.trim(),
          role: 'terminal-agent',
          objective: t('Manual Harness agent terminal'),
          subagentMode: 'wf-subagents',
        }),
      });
      invalidateApiCache('/api/sessions');
      invalidateApiCache('/api/a2a/snapshot');
      setLauncherOpen(false);
      setLaunchModel('');
      await loadControlPlane();
      onSelectSession(session.sessionId);
    } catch (e: any) {
      setError(e?.message || t('Session launch failed'));
    } finally {
      setCreating(false);
    }
  };

  const stopSession = async (sessionId: string) => {
    const previous = sessions;
    updateStoppingIds(current => new Set(current).add(sessionId));
    setSessions(current => current.filter(session => session.sessionId !== sessionId));
    try {
      await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' });
      invalidateApiCache('/api/sessions');
      invalidateApiCache('/api/sessions?all=1');
      invalidateApiCache('/api/a2a/snapshot');
      window.dispatchEvent(new CustomEvent('harness:sessions-changed'));
      await loadControlPlane();
    } catch (e: any) {
      setSessions(previous);
      setError(e?.message || t('Stop failed'));
    } finally {
      updateStoppingIds(current => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
    }
  };

  const runCleanup = async () => {
    if (cleanupBusy) return;
    const eligible = cleanupSummary?.totals.eligibleCount || 0;
    if (eligible <= 0) {
      invalidateApiCache('/api/cleanup/summary');
      await loadControlPlane(true);
      return;
    }
    if (!window.confirm(`Clean ${eligible} eligible storage item(s)?`)) return;
    setCleanupBusy(true);
    setError(null);
    try {
      const result = await apiJson<CleanupSummary>('/api/cleanup/prune', {
        method: 'POST',
        body: JSON.stringify({ apply: true }),
      });
      setCleanupSummary(result);
      invalidateApiCache('/api/cleanup/summary');
      invalidateApiCache('/api/sessions');
      invalidateApiCache('/api/sessions?all=1');
      invalidateApiCache('/api/a2a/snapshot');
      window.dispatchEvent(new CustomEvent('harness:sessions-changed'));
      await loadControlPlane(true);
    } catch (e: any) {
      setError(e?.message || t('Cleanup failed'));
    } finally {
      setCleanupBusy(false);
    }
  };

  if (loading) {
    return <LoadingView label={t('Loading agent terminals')} />;
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Bot size={14} /> {t('Agent Terminals')}
        </h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => { setShowSaved(value => !value); setSavedPage(0); }} title={t('Show stopped terminal sessions')} style={{ fontSize: 10, color: showSaved ? 'var(--fg)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px', background: showSaved ? 'var(--surface)' : 'var(--bg)' }}>
            {t('Stopped')}
          </button>
          <button onClick={() => loadControlPlane(true)} title={t('Scan PATH again')} style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px' }}>
            <RefreshCw size={11} /> {t('Scan')}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#991b1b', padding: '7px 9px', background: '#fef2f2', borderRadius: 'var(--radius)' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 8, fontSize: 10, color: '#991b1b', textDecoration: 'underline' }}>{t('dismiss')}</button>
        </div>
      )}

      <section data-testid="agents-consistency-panel" style={{ ...PANEL, padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Bot size={14} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{t('Workflow Consistency')}</div>
              <div style={{ fontSize: 10, color: workflowConsistency && (workflowConsistency.missingInAgents.length || workflowConsistency.missingOnWorkflow.length) ? '#991b1b' : 'var(--muted)' }}>
                {workflowConsistency
                  ? (workflowConsistency.missingInAgents.length || workflowConsistency.missingOnWorkflow.length
                    ? t('Drift detected between canvas and live PTY sessions')
                    : t('Canvas and live PTY sessions are in sync'))
                  : t('Scanning')}
              </div>
            </div>
          </div>
          <button onClick={() => loadControlPlane(true)} title={t('Refresh workflow consistency')}
            style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px' }}>
            <RefreshCw size={11} /> {t('Refresh')}
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <Metric label={t('Workflow live')} value={workflowConsistency ? String(workflowConsistency.workflowLiveCount) : '-'} detail={t('running canvas sessions')} />
          <Metric label={t('Running PTYs')} value={workflowConsistency ? String(workflowConsistency.runningPtyCount) : '-'} detail={t('live session registry')} />
          <Metric label={t('Workflow records')} value={workflowConsistency ? String(workflowConsistency.workflowNodeCount) : '-'} detail={t('live + stopped sessions')} />
        </div>
        {workflowConsistency && (workflowConsistency.missingInAgents.length || workflowConsistency.missingOnWorkflow.length) ? (
          <div style={{ display: 'grid', gap: 3, fontSize: 10, color: '#991b1b' }}>
            {workflowConsistency.missingInAgents.length > 0 && (
              <div>{t('Missing in Agents')}: {workflowConsistency.missingInAgents.map(shortSessionId).join(', ')}</div>
            )}
            {workflowConsistency.missingOnWorkflow.length > 0 && (
              <div>{t('Missing on Workflow')}: {workflowConsistency.missingOnWorkflow.map(shortSessionId).join(', ')}</div>
            )}
          </div>
        ) : null}
      </section>

      <section data-testid="agents-resource-summary" style={{ ...PANEL, padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Database size={14} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{t('PTY Resources')}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('Current server live PTYs only; stopped sessions keep transcripts but are not resource-sampled')}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <Metric label={t('Live memory')} value={formatBytes(resourceTotals.memoryBytes)} detail={runningSessions.length ? t('current live PTY processes') : t('no current live PTY')} />
          <Metric label={t('Live CPU')} value={formatPercent(resourceTotals.cpuPercent, 'unavailable')} detail={runningSessions.length ? t('sampled process CPU') : t('no current live PTY')} />
          <Metric label={t('Live PTYs')} value={String(resourceTotals.pids)} detail={`${runningSessions.length} ${t('current running session(s)')}`} />
          <Metric label={t('Viewers')} value={String(resourceTotals.viewers)} detail={t('attached terminal views')} />
          <Metric label={t('Stopped sessions')} value={String(savedSessions.length)} detail={t('transcripts / not sampled')} />
        </div>
        {runningSessions.length === 0 && savedSessions.length > 0 && (
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            {t('Resource usage is unavailable because this wf-ui server is not currently managing a live PTY; stopped rows below are transcript records.')}
          </div>
        )}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        <button
          data-testid="agent-add-box"
          onClick={() => setLauncherOpen(value => !value)}
          style={{
            ...PANEL,
            minHeight: 132,
            borderStyle: 'dashed',
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            padding: 16,
            color: 'var(--fg)',
            background: launcherOpen ? 'var(--surface)' : 'var(--bg)',
          }}
        >
          <span style={{ width: 34, height: 34, borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', marginBottom: 8 }}>
            <Plus size={18} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t('New Agent Terminal')}</span>
          <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{t('Choose a detected terminal platform')}</span>
        </button>

        {runtimes.map(runtime => (
          <motion.div
            key={runtime.id}
            data-testid="detected-runtime-card"
            initial={reducedMotion ? undefined : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ ...PANEL, padding: 10, minHeight: 132, display: 'grid', alignContent: 'space-between', gap: 8 }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(runtime.status), flexShrink: 0 }} />
                <RuntimeBrandMark runtime={runtime.id} size={16} />
                <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{runtime.label}</span>
                <span style={{ fontSize: 9, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 99, padding: '0 5px', flexShrink: 0 }}>{runtime.command}</span>
              </div>
              <div title={runtime.path || ''} style={{ fontSize: 10, color: 'var(--muted)', marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {compactPath(runtime.path)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {runtime.version || runtime.capabilities.slice(0, 3).join(' / ')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              <button onClick={() => createSession(runtime.id)} disabled={creating}
                style={{ flex: 1, fontSize: 10, fontWeight: 600, color: '#fff', background: '#111', borderRadius: 'var(--radius)', padding: '5px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, opacity: creating ? 0.5 : 1 }}>
                <Terminal size={11} /> {t('Start')}
              </button>
              <button onClick={() => openConfig(runtime.id)} title={t('Configure runtime')} style={{ width: 28, height: 27, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--muted)' }}>
                <Settings2 size={12} />
              </button>
            </div>
          </motion.div>
        ))}
      </section>

      {launcherOpen && (
        <section style={{ ...PANEL, padding: 12, display: 'grid', gap: 10 }}>
          {runtimes.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: 16 }}>
              {t('No detected terminal agents. Run Scan after installing a CLI on PATH.')}
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 240px) minmax(120px, 220px) auto', gap: 8, alignItems: 'end' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Platform')}
                  <RuntimePicker
                    runtimes={runtimes}
                    value={selectedRuntimeId}
                    onChange={setSelectedRuntimeId}
                    testId="agents-runtime-picker"
                  />
                </div>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Model Override')}
                  <input value={launchModel} onChange={e => setLaunchModel(e.target.value)} placeholder="optional"
                    style={{ padding: '6px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }} />
                </label>
                <button onClick={() => createSession()} disabled={!selectedRuntime || creating}
                  style={{ height: 31, padding: '0 14px', fontSize: 11, fontWeight: 600, borderRadius: 'var(--radius)', background: '#111', color: '#fff', opacity: !selectedRuntime || creating ? 0.5 : 1 }}>
                  {t('Start Terminal')}
                </button>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                {selectedRuntime ? `${selectedRuntime.command} from ${compactPath(selectedRuntime.path)}` : t('Only detected runtimes are listed.')}
              </div>
            </>
          )}
        </section>
      )}

      {configRuntimeId && (
        <section style={{ ...PANEL, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{runtimes.find(r => r.id === configRuntimeId)?.label || configRuntimeId} Config</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('Known global/project config files. Authentication files are shown read-only unless a safe model field is known.')}</div>
            </div>
            <button onClick={() => setConfigRuntimeId(null)} style={{ fontSize: 10, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 8px' }}>{t('Close')}</button>
          </div>

          {!runtimeConfig ? (
            <LoadingView label={t('Loading runtime config')} />
          ) : runtimeConfig.files.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('No editable config path is known for this CLI yet.')}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 260px) minmax(0, 1fr)', gap: 12 }}>
              <div style={{ display: 'grid', gap: 5 }}>
                {runtimeConfig.files.map(file => (
                  <button key={`${file.scope}-${file.path}`} onClick={() => switchConfigScope(file.scope)}
                    style={{
                      textAlign: 'left',
                      border: `1px solid ${configScope === file.scope ? '#111' : 'var(--border)'}`,
                      borderRadius: 'var(--radius)',
                      padding: 8,
                      background: configScope === file.scope ? 'var(--surface)' : 'var(--bg)',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600 }}>
                      {file.exists && <Check size={11} color="#166534" />} {file.scope}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.path}</div>
                  </button>
                ))}
              </div>

              <div>
                {selectedConfigFile ? (
                  <>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
                      {selectedConfigFile.format} / {selectedConfigFile.exists ? t('existing') : t('will create')} / {compactPath(selectedConfigFile.absolutePath)}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                      {Object.keys(selectedConfigFile.fields).map(alias => (
                        <label key={alias} style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                          {alias}
                          <input value={configValues[alias] || ''} onChange={e => setConfigValues(values => ({ ...values, [alias]: e.target.value }))}
                            style={{ padding: '6px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }} />
                        </label>
                      ))}
                    </div>
                    <button onClick={saveConfig} style={{ marginTop: 10, fontSize: 11, fontWeight: 600, color: '#fff', background: '#111', borderRadius: 'var(--radius)', padding: '6px 12px' }}>
                      {t('Save Config')}
                    </button>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('This config file is read-only in Harness UI.')}</div>
                )}
                {configSaved && <div style={{ fontSize: 10, color: '#166534', marginTop: 8 }}>{configSaved}</div>}
              </div>
            </div>
          )}
        </section>
      )}

      <section data-testid="cleanup-panel" style={{ ...PANEL, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Database size={14} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{t('Storage Cleanup')}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                {cleanupSummary ? `${cleanupSummary.totals.eligibleCount} eligible / ${formatBytes(cleanupSummary.totals.eligibleBytes)}` : t('Scanning')}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => loadControlPlane(true)} title={t('Refresh cleanup summary')}
              style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px' }}>
              <RefreshCw size={11} /> {t('Refresh')}
            </button>
            <button data-testid="cleanup-apply" onClick={runCleanup} disabled={cleanupBusy || !cleanupSummary || cleanupSummary.totals.eligibleCount === 0}
              style={{ fontSize: 10, color: cleanupSummary?.totals.eligibleCount ? '#991b1b' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px', opacity: cleanupBusy || !cleanupSummary || cleanupSummary.totals.eligibleCount === 0 ? 0.55 : 1 }}>
              <Trash2 size={11} /> {cleanupBusy ? t('Cleaning') : t('Clean')}
            </button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <Metric label={t('Stopped sessions')} value={cleanupSummary ? String(cleanupSummary.sessions.eligibleCount) : '-'} detail={cleanupSummary ? t('{n} total', String(cleanupSummary.sessions.totalCount)) : ''} />
          <Metric label={t('Temp log dirs')} value={cleanupSummary ? String(cleanupSummary.tempLogs.eligibleCount) : '-'} detail={cleanupSummary ? t('{n} total', String(cleanupSummary.tempLogs.totalCount)) : ''} />
          <Metric label={t('Recoverable')} value={cleanupSummary ? formatBytes(cleanupSummary.totals.eligibleBytes) : '-'} detail={cleanupSummary?.applied ? t('last cleanup applied') : t('preview')} />
        </div>
        {cleanupSummary?.errors?.length ? (
          <div style={{ fontSize: 10, color: '#991b1b' }}>{cleanupSummary.errors.length} cleanup error(s)</div>
        ) : null}
      </section>

      <section>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>{t('Running Terminals')}</div>
        {runningSessions.length === 0 ? (
          <div data-testid="agents-empty" style={{ padding: 28, color: 'var(--muted)', textAlign: 'center', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <Terminal size={26} style={{ marginBottom: 8, opacity: 0.35 }} />
            <p style={{ marginBottom: 3, fontWeight: 500 }}>{t('No running agent terminal.')}</p>
            <p>{t('Use the plus box to start a detected CLI.')}</p>
          </div>
        ) : (
          <div data-testid="agents-list" style={{ display: 'grid', gap: 5 }}>
            {runningSessions.map(session => (
              <SessionRow key={session.sessionId} session={session} onSelectSession={onSelectSession} onStop={stopSession} stopping={stoppingIds.has(session.sessionId)} />
            ))}
          </div>
        )}
      </section>

      {showSaved && savedSessions.length > 0 && (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
              {t('Stopped Sessions ({n})', String(savedSessions.length))}
            </div>
            {savedSessions.length > SAVED_PAGE_SIZE && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--muted)' }}>
                <button onClick={() => setSavedPage(page => Math.max(0, page - 1))} disabled={savedPage === 0}
                  style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2px 7px', opacity: savedPage === 0 ? 0.45 : 1 }}>
                  {t('Prev')}
                </button>
                <span>{savedPage + 1} / {savedPageCount}</span>
                <button onClick={() => setSavedPage(page => Math.min(savedPageCount - 1, page + 1))} disabled={savedPage >= savedPageCount - 1}
                  style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2px 7px', opacity: savedPage >= savedPageCount - 1 ? 0.45 : 1 }}>
                  {t('Next')}
                </button>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gap: 5 }}>
            {visibleSavedSessions.map(session => (
              <SessionRow key={session.sessionId} session={session} onSelectSession={onSelectSession} onStop={stopSession} muted />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div style={{ borderLeft: '2px solid var(--border)', padding: '2px 8px', minWidth: 0 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2, marginTop: 3 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</div>
    </div>
  );
}

function SessionRow({
  session,
  onSelectSession,
  onStop,
  muted = false,
  stopping = false,
}: {
  session: Session;
  onSelectSession: (sessionId: string) => void;
  onStop: (sessionId: string) => void;
  muted?: boolean;
  stopping?: boolean;
}) {
  const t = useT();
  const resource = session.resourceUsage || {};
  const resourcePid = resource.pid ?? session.pid ?? null;
  const resourceProvider = resource.ptyProvider || session.ptyProvider || 'unknown';
  const resourceViewers = resource.wsClientCount ?? session.wsClientCount ?? 0;
  const live = isLiveStatus(session.status);
  const memoryText = live ? formatBytes(resource.memoryBytes) : 'unavailable';
  const cpuText = live ? formatPercent(resource.cpuPercent) : 'unavailable';
  return (
    <div data-testid="agent-row" style={{ ...PANEL, padding: 9, opacity: muted ? 0.68 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(session.status), flexShrink: 0 }} />
          <RuntimeBrandLabel runtime={session.runtime} size={14} style={{ fontSize: 12 }} />
          <span style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.peerId || session.sessionId}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={() => onSelectSession(session.sessionId)}
            style={{ fontSize: 10, padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <ExternalLink size={9} /> {t('Terminal')}
          </button>
          {!muted && (
            <button onClick={() => onStop(session.sessionId)} disabled={stopping}
              style={{ fontSize: 10, padding: '3px 8px', border: '1px solid #991b1b', borderRadius: 'var(--radius)', color: '#991b1b', background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Square size={9} /> {stopping ? t('Stopping') : t('Stop')}
            </button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
        {[stopping ? t('stopping') : displaySessionStatus(session.status), session.role, session.workflowMode || null, session.ptyProvider || null, session.taskId || null, t('{n} viewer(s)', String(session.wsClientCount ?? 0))].filter(Boolean).join(' / ')}
        {session.model ? ` / ${session.model}` : ''}
        {session.resumeCommand ? ` / resume: ${session.resumeCommand}` : ''}
        {session.blockedReason ? ` / ${session.blockedReason}` : ''}
        {session.blockedHint ? ` / ${session.blockedHint}` : ''}
      </div>
      <div data-testid="agent-resource-usage" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px', marginTop: 5, fontSize: 10, color: 'var(--muted)' }}>
        <span>PID {resourcePid ?? '-'}</span>
        <span>Memory {memoryText}</span>
        <span>CPU {cpuText}</span>
        <span>PTY {resourceProvider}</span>
        <span>{t('{n} viewer(s)', String(resourceViewers))}</span>
      </div>
    </div>
  );
}
