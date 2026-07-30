import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Bot, Check, ExternalLink, Plus, RefreshCw, Settings2, Square, Terminal } from 'lucide-react';
import { motion } from 'motion/react';
import { apiJson, apiJsonCached, invalidateApiCache } from '../api';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { RuntimeConfigFile, RuntimeInfo, Session } from '../types';
import LoadingView from './LoadingView';

type Props = { onSelectSession: (sessionId: string) => void };
type RuntimeConfig = { runtime: string; files: RuntimeConfigFile[] };
const SAVED_PAGE_SIZE = 5;

const PANEL: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
};

function statusColor(status: string) {
  if (status === 'running' || status === 'available') return '#166534';
  if (status === 'blocked' || status === 'missing') return '#991b1b';
  if (status === 'starting') return '#d97706';
  return '#6b7280';
}

function compactPath(value: string | null | undefined) {
  if (!value) return '';
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.length > 4 ? `.../${parts.slice(-3).join('/')}` : value;
}

export default function AgentsRoute({ onSelectSession }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [savedSessions, setSavedSessions] = useState<Session[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [savedPage, setSavedPage] = useState(0);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState('');
  const [launchModel, setLaunchModel] = useState('');
  const [creating, setCreating] = useState(false);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(() => new Set());
  const stoppingIdsRef = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configRuntimeId, setConfigRuntimeId] = useState<string | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [configScope, setConfigScope] = useState('user');
  const [configSaved, setConfigSaved] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  const selectedRuntime = useMemo(
    () => runtimes.find(runtime => runtime.id === selectedRuntimeId) || null,
    [runtimes, selectedRuntimeId],
  );

  const runningSessions = sessions;
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
      const [runtimeRows, sessionRows, allRows] = await Promise.all([
        apiJsonCached<RuntimeInfo[]>(refresh ? '/api/runtimes?refresh=1' : '/api/runtimes', { ttlMs: 12000, refresh }),
        apiJson<Session[]>('/api/sessions'),
        showSaved
          ? apiJsonCached<Session[]>('/api/sessions?all=1', { ttlMs: refresh ? 0 : 3000, refresh }).catch(() => [])
          : Promise.resolve([]),
      ]);
      const pendingStops = stoppingIdsRef.current;
      setRuntimes(runtimeRows);
      setSessions(sessionRows.filter(session => !pendingStops.has(session.sessionId)));
      setSavedSessions(allRows.filter(session => session.status !== 'running' && session.status !== 'starting'));
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
      setError(e?.message || 'Failed to load agent terminals');
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
      if (detail?.sessionId && detail.state === 'saved') {
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
      setError(e?.message || 'Failed to load runtime config');
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
      setError(e?.message || 'Failed to save runtime config');
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
          objective: 'Manual Harness agent terminal',
          subagentMode: 'wf-subagents',
        }),
      });
      invalidateApiCache('/api/sessions');
      setLauncherOpen(false);
      setLaunchModel('');
      await loadControlPlane();
      onSelectSession(session.sessionId);
    } catch (e: any) {
      setError(e?.message || 'Session launch failed');
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
      window.dispatchEvent(new CustomEvent('harness:sessions-changed'));
      await loadControlPlane();
    } catch (e: any) {
      setSessions(previous);
      setError(e?.message || 'Stop failed');
    } finally {
      updateStoppingIds(current => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
    }
  };

  if (loading) {
    return <LoadingView label="Loading agent terminals" />;
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Bot size={14} /> Agent Terminals
        </h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => { setShowSaved(value => !value); setSavedPage(0); }} title="Show saved terminal sessions" style={{ fontSize: 10, color: showSaved ? 'var(--fg)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px', background: showSaved ? 'var(--surface)' : 'var(--bg)' }}>
            Saved
          </button>
          <button onClick={() => loadControlPlane(true)} title="Scan PATH again" style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px' }}>
            <RefreshCw size={11} /> Scan
          </button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#991b1b', padding: '7px 9px', background: '#fef2f2', borderRadius: 'var(--radius)' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 8, fontSize: 10, color: '#991b1b', textDecoration: 'underline' }}>dismiss</button>
        </div>
      )}

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
          <span style={{ fontSize: 13, fontWeight: 600 }}>New Agent Terminal</span>
          <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Choose a detected terminal platform</span>
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
                <Terminal size={11} /> Start
              </button>
              <button onClick={() => openConfig(runtime.id)} title="Configure runtime" style={{ width: 28, height: 27, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--muted)' }}>
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
              No detected terminal agents. Run Scan after installing a CLI on PATH.
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 240px) minmax(120px, 220px) auto', gap: 8, alignItems: 'end' }}>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  Platform
                  <select value={selectedRuntimeId} onChange={e => setSelectedRuntimeId(e.target.value)}
                    style={{ padding: '6px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
                    {runtimes.map(runtime => <option key={runtime.id} value={runtime.id}>{runtime.label}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  Model Override
                  <input value={launchModel} onChange={e => setLaunchModel(e.target.value)} placeholder="optional"
                    style={{ padding: '6px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }} />
                </label>
                <button onClick={() => createSession()} disabled={!selectedRuntime || creating}
                  style={{ height: 31, padding: '0 14px', fontSize: 11, fontWeight: 600, borderRadius: 'var(--radius)', background: '#111', color: '#fff', opacity: !selectedRuntime || creating ? 0.5 : 1 }}>
                  Start Terminal
                </button>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                {selectedRuntime ? `${selectedRuntime.command} from ${compactPath(selectedRuntime.path)}` : 'Only detected runtimes are listed.'}
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
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Known global/project config files. Authentication files are shown read-only unless a safe model field is known.</div>
            </div>
            <button onClick={() => setConfigRuntimeId(null)} style={{ fontSize: 10, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 8px' }}>Close</button>
          </div>

          {!runtimeConfig ? (
            <LoadingView label="Loading runtime config" />
          ) : runtimeConfig.files.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>No editable config path is known for this CLI yet.</div>
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
                      {selectedConfigFile.format} / {selectedConfigFile.exists ? 'existing' : 'will create'} / {compactPath(selectedConfigFile.absolutePath)}
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
                      Save Config
                    </button>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>This config file is read-only in Harness UI.</div>
                )}
                {configSaved && <div style={{ fontSize: 10, color: '#166534', marginTop: 8 }}>{configSaved}</div>}
              </div>
            </div>
          )}
        </section>
      )}

      <section>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Running Terminals</div>
        {runningSessions.length === 0 ? (
          <div data-testid="agents-empty" style={{ padding: 28, color: 'var(--muted)', textAlign: 'center', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <Terminal size={26} style={{ marginBottom: 8, opacity: 0.35 }} />
            <p style={{ marginBottom: 3, fontWeight: 500 }}>No running agent terminal.</p>
            <p>Use the plus box to start a detected CLI.</p>
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
              Saved Sessions ({savedSessions.length})
            </div>
            {savedSessions.length > SAVED_PAGE_SIZE && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--muted)' }}>
                <button onClick={() => setSavedPage(page => Math.max(0, page - 1))} disabled={savedPage === 0}
                  style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2px 7px', opacity: savedPage === 0 ? 0.45 : 1 }}>
                  Prev
                </button>
                <span>{savedPage + 1} / {savedPageCount}</span>
                <button onClick={() => setSavedPage(page => Math.min(savedPageCount - 1, page + 1))} disabled={savedPage >= savedPageCount - 1}
                  style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2px 7px', opacity: savedPage >= savedPageCount - 1 ? 0.45 : 1 }}>
                  Next
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
  return (
    <div data-testid="agent-row" style={{ ...PANEL, padding: 9, opacity: muted ? 0.68 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(session.status), flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>{session.runtime}</span>
          <span style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.peerId || session.sessionId}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={() => onSelectSession(session.sessionId)}
            style={{ fontSize: 10, padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <ExternalLink size={9} /> Terminal
          </button>
          {!muted && (
            <button onClick={() => onStop(session.sessionId)} disabled={stopping}
              style={{ fontSize: 10, padding: '3px 8px', border: '1px solid #991b1b', borderRadius: 'var(--radius)', color: '#991b1b', background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Square size={9} /> {stopping ? 'Stopping' : 'Stop'}
            </button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
        {[stopping ? 'stopping' : session.status, session.role, session.workflowMode || null, session.ptyProvider || null, session.taskId || null, `${session.wsClientCount ?? 0} viewer(s)`].filter(Boolean).join(' / ')}
        {session.model ? ` / ${session.model}` : ''}
        {session.resumeCommand ? ` / resume: ${session.resumeCommand}` : ''}
        {session.blockedReason ? ` / ${session.blockedReason}` : ''}
        {session.blockedHint ? ` / ${session.blockedHint}` : ''}
      </div>
    </div>
  );
}
