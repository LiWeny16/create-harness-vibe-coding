import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import MarkdownIt from 'markdown-it';
import { Archive, ChevronRight, FileText, FolderOpen, Search, Terminal, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { apiJson, apiJsonCached, invalidateApiCache } from '../api';
import LoadingView from './LoadingView';
import { useT } from '../i18n/index';
import { RuntimeBrandMark } from '../runtimeBrand';

type ACItem = { id: string; text: string; status: string };
type Task = {
  taskId: string;
  status: string;
  phase: string | null;
  gate: string | null;
  updatedAt: string | null;
  activeQuestion: string | null;
  nextAction: string | null;
  tier: string | null;
  mode: string | null;
  acceptance: ACItem[];
  dependsOn: string[];
  blocks: string[];
  hasPlan: boolean;
  hasProgress: boolean;
  defaultRuntime?: string | null;
  runtimeHistory?: string[];
  archivedYear?: string;
  archivedPath?: string;
};

type FileContent = { filename: string; content: string } | null;
type TabName = 'active' | 'archived';
type Props = { onSelectSession?: (sessionId: string) => void };
type StateView = 'visual' | 'json';
type StateRecord = Record<string, unknown>;

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

function statusColor(status: string) {
  if (status === 'active' || status === 'in_progress') return { bg: '#dcfce7', fg: '#166534' };
  if (status === 'verified' || status === 'passed') return { bg: '#dbeafe', fg: '#1e40af' };
  if (status === 'blocked') return { bg: '#fee2e2', fg: '#991b1b' };
  return { bg: '#f3f4f6', fg: '#6b7280' };
}

function acStatusStyle(status: string) {
  return {
    color: status === 'passed' ? '#166534' : status === 'failed' ? '#991b1b' : '#6b7280',
    fontSize: 10,
  };
}

function ellipsis(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function isRecord(value: unknown): value is StateRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function uniqueRuntimes(values: (string | null | undefined)[]) {
  const seen = new Set<string>();
  const runtimes: string[] = [];
  for (const value of values) {
    const runtime = String(value || '').trim();
    if (!runtime) continue;
    const key = runtime.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    runtimes.push(runtime);
  }
  return runtimes;
}

function taskRuntimes(task: Task) {
  return uniqueRuntimes([...(task.runtimeHistory || []), task.defaultRuntime || undefined]);
}

function parseStateContent(content: string) {
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asText(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  if (Array.isArray(value)) return value.length ? value.map(item => String(item)).join(', ') : fallback;
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
}

export default function TaskList({ onSelectSession }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [archived, setArchived] = useState<Task[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [fileData, setFileData] = useState<FileContent>(null);
  const [fileTab, setFileTab] = useState<string>('STATE.json');
  const [stateView, setStateView] = useState<StateView>('visual');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabName>('active');
  const [search, setSearch] = useState('');
  const [archiving, setArchiving] = useState<string | null>(null);
  const [startingTerminal, setStartingTerminal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  const loadTasks = async (refresh = false) => {
    if (refresh) {
      invalidateApiCache('/api/tasks');
      invalidateApiCache('/api/tasks/archived');
    }
    try {
      const [activeTasks, archivedTasks] = await Promise.all([
      apiJsonCached<Task[]>('/api/tasks', { ttlMs: 5000 }).catch(() => []),
      apiJsonCached<Task[]>('/api/tasks/archived', { ttlMs: 10000 }).catch(() => []),
      ]);
      setTasks(activeTasks);
      setArchived(archivedTasks);
      setError(null);
    } catch {
      setError(t('Failed to load tasks'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const displayList = useMemo(() => {
    const list = tab === 'active' ? tasks : archived;
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(task =>
      task.taskId.toLowerCase().includes(q) ||
      task.status.toLowerCase().includes(q) ||
      (task.phase || '').toLowerCase().includes(q) ||
      (task.nextAction || '').toLowerCase().includes(q)
    );
  }, [tasks, archived, tab, search]);

  const loadTaskFile = async (task: Task, filename: string) => {
    try {
      const data = await apiJson<{ filename: string; content: string }>(
        `/api/tasks/${encodeURIComponent(task.taskId)}/file/${filename}`,
      );
      setFileData(data);
    } catch {
      setFileData({ filename, content: t('(file not found)') });
    }
  };

  const openInspector = async (task: Task) => {
    setSelected(task);
    setFileTab('STATE.json');
    setStateView('visual');
    setFileData(null);
    await loadTaskFile(task, 'STATE.json');
  };

  const switchFileTab = async (filename: string) => {
    setFileTab(filename);
    if (selected) await loadTaskFile(selected, filename);
  };

  const startTaskTerminal = async (task: Task) => {
    if (!onSelectSession) return;
    setStartingTerminal(task.taskId);
    setError(null);
    try {
      const session = await apiJson<{ sessionId: string }>(`/api/tasks/${encodeURIComponent(task.taskId)}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          runtime: task.defaultRuntime || task.runtimeHistory?.[0] || undefined,
          role: 'task-terminal',
          objective: t('Continue {taskId}', task.taskId),
          subagentMode: 'wf-subagents',
        }),
      });
      invalidateApiCache('/api/sessions');
      onSelectSession(session.sessionId);
      await loadTasks(true);
    } catch (e: any) {
      setError(e?.message || t('Failed to start task terminal'));
    } finally {
      setStartingTerminal(null);
    }
  };

  const archiveTask = async (task: Task) => {
    setArchiving(task.taskId);
    setError(null);
    try {
      await apiJson(`/api/tasks/${encodeURIComponent(task.taskId)}/archive`, { method: 'POST' });
      setSelected(null);
      setFileData(null);
      await loadTasks(true);
      setTab('archived');
    } catch (e: any) {
      setError(e?.message || t('Archive failed'));
    } finally {
      setArchiving(null);
    }
  };

  const renderFile = () => {
    if (!fileData) return <pre style={{ fontSize: 10, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{t('Loading...')}</pre>;
    if (fileData.filename === 'STATE.json' && stateView === 'visual') {
      const parsed = parseStateContent(fileData.content);
      return parsed
        ? <StateVisualizer state={parsed} task={selected} />
        : <pre style={{ fontSize: 10, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{t('STATE.json could not be parsed.')}</pre>;
    }
    if (fileData.filename.endsWith('.md')) {
      return (
        <div
          className="markdown-body"
          dangerouslySetInnerHTML={{ __html: md.render(fileData.content.slice(0, 40000)) }}
        />
      );
    }
    return (
      <pre style={{ fontSize: 10, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
        {fileData.content.slice(0, 12000)}
      </pre>
    );
  };

  if (loading) return <LoadingView label={t('Loading tasks')} />;

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <div data-testid="task-list" style={{ flex: 1, maxWidth: 420, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
          <button onClick={() => setTab('active')} style={{
            flex: 1,
            padding: '6px 0',
            fontSize: 11,
            fontWeight: tab === 'active' ? 600 : 400,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius) 0 0 var(--radius)',
            background: tab === 'active' ? 'var(--surface)' : 'var(--bg)',
          }}>
            <FolderOpen size={12} style={{ marginRight: 4, verticalAlign: -2 }} />{t('Active ({n})', String(tasks.length))}
          </button>
          <button onClick={() => setTab('archived')} style={{
            flex: 1,
            padding: '6px 0',
            fontSize: 11,
            fontWeight: tab === 'archived' ? 600 : 400,
            border: '1px solid var(--border)',
            borderLeft: 0,
            borderRadius: '0 var(--radius) var(--radius) 0',
            background: tab === 'archived' ? 'var(--surface)' : 'var(--bg)',
          }}>
            <Archive size={12} style={{ marginRight: 4, verticalAlign: -2 }} />{t('Archive ({n})', String(archived.length))}
          </button>
        </div>

        <div style={{ position: 'relative', marginBottom: 8 }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--muted)' }} />
          <input
            data-testid="task-search"
            placeholder={t('Filter tasks...')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '6px 8px 6px 26px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', outline: 'none' }}
          />
        </div>

        {error && <div style={{ fontSize: 11, color: '#991b1b', marginBottom: 8 }}>{error}</div>}

        <div style={{ flex: 1, overflow: 'auto' }}>
          {displayList.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--muted)', textAlign: 'center', fontSize: 11 }}>
              {search ? t('No matching tasks.') : t('No {tab} task capsules.', tab)}
            </div>
          ) : (
            <AnimatePresence>
              {displayList.map(task => {
                const color = statusColor(task.status);
                return (
                  <motion.div
                    key={task.taskId}
                    data-testid="task-row"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    onClick={() => openInspector(task)}
                    style={{
                      padding: '7px 10px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      marginBottom: 4,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: selected?.taskId === task.taskId ? 'var(--surface)' : 'var(--bg)',
                      borderLeft: `3px solid ${color.fg}`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {task.archivedYear && <span style={{ fontSize: 9, color: 'var(--muted)', marginRight: 4 }}>[{task.archivedYear}]</span>}
                        <TaskRuntimeMarks runtimes={taskRuntimes(task)} size={13} />
                        {task.taskId}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>
                        <span style={{ background: color.bg, color: color.fg, padding: '0 5px', borderRadius: 99, fontSize: 9, marginRight: 4 }}>{task.status}</span>
                        {task.phase && <span>{task.phase}</span>}
                        {task.updatedAt && <span> / {new Date(task.updatedAt).toLocaleDateString()}</span>}
                      </div>
                    </div>
                    <ChevronRight size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            data-testid="task-inspector"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.12 }}
            style={{
              flex: 2,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 14,
              overflow: 'auto',
              maxHeight: 'calc(100vh - var(--header-h) - var(--footer-h) - 40px)',
              background: 'var(--bg)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.taskId}</h3>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                  {selected.archivedYear && <span>[{selected.archivedPath || selected.archivedYear}] </span>}
                  <TaskRuntimeMarks runtimes={taskRuntimes(selected)} size={14} />
                  {[selected.status, selected.phase, selected.gate, selected.tier, selected.mode].filter(Boolean).join(' / ')}
                  {selected.defaultRuntime ? ` / default: ${selected.defaultRuntime}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                <button onClick={() => startTaskTerminal(selected)} disabled={startingTerminal === selected.taskId}
                  title={t('Open task terminal')}
                  style={{ color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', fontSize: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius)', opacity: startingTerminal === selected.taskId ? 0.55 : 1 }}>
                  <Terminal size={11} /> {startingTerminal === selected.taskId ? t('Opening') : t('Terminal')}
                </button>
                {tab === 'active' && !selected.archivedYear && (
                  <button onClick={() => archiveTask(selected)} disabled={archiving === selected.taskId}
                    title={t('Archive completed task')}
                    style={{ color: '#991b1b', display: 'flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', fontSize: 10, border: '1px solid #fecaca', borderRadius: 'var(--radius)', opacity: archiving === selected.taskId ? 0.55 : 1 }}>
                    <Archive size={11} /> {archiving === selected.taskId ? t('Archiving') : t('Archive')}
                  </button>
                )}
                <button onClick={() => setSelected(null)} title={t('Close inspector')} style={{ color: 'var(--muted)', display: 'grid', placeItems: 'center', width: 24, height: 24, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <X size={12} />
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' }}>{t('Acceptance ({n})', String(selected.acceptance?.length || 0))}</div>
              {selected.acceptance?.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {selected.acceptance.map((ac, i) => (
                    <div key={ac.id || i} style={{ display: 'flex', gap: 6, fontSize: 10, alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 500, flexShrink: 0, color: 'var(--muted)' }}>{ac.id || `#${i + 1}`}</span>
                      <span style={{ flex: 1 }}>{ellipsis(ac.text || '', 120)}</span>
                      <span style={acStatusStyle(ac.status)}>{ac.status}</span>
                    </div>
                  ))}
                </div>
              ) : <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('no acceptance criteria')}</div>}
            </div>

            {(selected.dependsOn?.length > 0 || selected.blocks?.length > 0) && (
              <div style={{ marginBottom: 10, fontSize: 10 }}>
                {selected.dependsOn.length > 0 && <div style={{ marginBottom: 2 }}><span style={{ color: 'var(--muted)' }}>{t('Depends on: ')}</span>{selected.dependsOn.map(id => <code key={id} style={{ background: 'var(--surface)', padding: '0 4px', borderRadius: 2, marginRight: 3, fontSize: 10 }}>{id}</code>)}</div>}
                {selected.blocks.length > 0 && <div><span style={{ color: 'var(--muted)' }}>{t('Blocks: ')}</span>{selected.blocks.map(id => <code key={id} style={{ background: 'var(--surface)', padding: '0 4px', borderRadius: 2, marginRight: 3, fontSize: 10 }}>{id}</code>)}</div>}
              </div>
            )}

            {selected.nextAction && (
              <div style={{ marginBottom: 10, fontSize: 10, padding: '6px 8px', background: '#fefce8', borderRadius: 'var(--radius)', border: '1px solid #fde68a' }}>
                <span style={{ fontWeight: 600 }}>{t('Next: ')}</span>{selected.nextAction.slice(0, 300)}
              </div>
            )}

            <div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginBottom: 0 }}>
                <div style={{ display: 'flex', gap: 0, fontSize: 10 }}>
                  {[
                    { label: t('STATE'), file: 'STATE.json', present: true },
                    { label: t('PLAN'), file: 'PLAN.md', present: selected.hasPlan },
                    { label: t('PROGRESS'), file: 'PROGRESS.md', present: selected.hasProgress },
                  ].map(tabInfo => (
                    <button key={tabInfo.label} onClick={() => switchFileTab(tabInfo.file)}
                      style={{
                        padding: '4px 12px',
                        fontWeight: fileTab === tabInfo.file ? 600 : 400,
                        border: '1px solid var(--border)',
                        borderBottom: fileTab === tabInfo.file ? '1px solid var(--bg)' : undefined,
                        borderRadius: 'var(--radius) var(--radius) 0 0',
                        marginRight: -1,
                        background: fileTab === tabInfo.file ? 'var(--bg)' : 'var(--surface)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}>
                      <FileText size={10} />{tabInfo.label}{tabInfo.present ? '' : ' (?)'}
                    </button>
                  ))}
                </div>
                {fileTab === 'STATE.json' && (
                  <div data-testid="task-state-view-toggle" style={{ display: 'flex', gap: 3, fontSize: 10, paddingBottom: 2 }}>
                    {(['visual', 'json'] as StateView[]).map(view => (
                      <button key={view} onClick={() => setStateView(view)}
                        style={{ padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: stateView === view ? '#111' : 'var(--bg)', color: stateView === view ? '#fff' : 'var(--muted)', fontWeight: 700 }}>
                        {view === 'visual' ? t('Visual') : t('JSON')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: '0 var(--radius) var(--radius) var(--radius)', padding: 10, maxHeight: 320, overflow: 'auto', background: '#fafafa' }}>
                {renderFile()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TaskRuntimeMarks({ runtimes, size = 13 }: { runtimes: string[]; size?: number }) {
  if (runtimes.length === 0) return null;
  return (
    <span data-testid="task-runtime-icons" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 5, verticalAlign: -3 }}>
      {runtimes.map(runtime => (
        <span key={runtime} title={runtime}>
          <RuntimeBrandMark runtime={runtime} size={size} />
        </span>
      ))}
    </span>
  );
}

function StateMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '7px 8px', background: 'var(--bg)', minWidth: 0 }}>
      <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function StateVisualizer({ state, task }: { state: StateRecord; task: Task | null }) {
  const t = useT();
  const links = isRecord(state.links) ? state.links : {};
  const queues = isRecord(state.queues) ? state.queues : {};
  const workItems = Array.isArray(state.workItems) ? state.workItems.filter(isRecord) : [];
  const acceptance = Array.isArray(state.acceptance) ? state.acceptance : [];
  const runtimes = task ? taskRuntimes(task) : [];

  return (
    <div data-testid="task-state-visual" style={{ display: 'grid', gap: 10, fontSize: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asText(state.taskId, task?.taskId || '-')}</div>
          <div style={{ color: 'var(--muted)', marginTop: 2 }}>{asText(state.nextAction, t('no next action'))}</div>
        </div>
        <TaskRuntimeMarks runtimes={runtimes} size={16} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: 6 }}>
        <StateMetric label={t('Status')} value={asText(state.status)} />
        <StateMetric label={t('Phase')} value={asText(state.phase)} />
        <StateMetric label={t('Gate')} value={asText(state.gate)} />
        <StateMetric label={t('Mode')} value={asText(state.mode)} />
        <StateMetric label={t('Tier')} value={asText(state.tier)} />
        <StateMetric label={t('Updated')} value={state.updatedAt ? new Date(String(state.updatedAt)).toLocaleString() : '-'} />
      </div>

      {state.activeQuestion ? (
        <div style={{ padding: '7px 8px', border: '1px solid #fde68a', borderRadius: 'var(--radius)', background: '#fefce8', color: '#854d0e' }}>
          <strong>{t('Question')}: </strong>{asText(state.activeQuestion)}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        <StateSection title={t('Queues')}>
          {Object.keys(queues).length ? Object.entries(queues).map(([name, value]) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: 'var(--muted)' }}>{name}</span>
              <span style={{ fontWeight: 700 }}>{Array.isArray(value) ? value.length : asText(value)}</span>
            </div>
          )) : <span style={{ color: 'var(--muted)' }}>{t('none')}</span>}
        </StateSection>

        <StateSection title={t('Links')}>
          {['dependsOn', 'blocks', 'related'].map(name => {
            const values = asStringArray(links[name]);
            return (
              <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: 'var(--muted)' }}>{name}</span>
                <span style={{ fontWeight: 700 }}>{values.length ? values.join(', ') : '-'}</span>
              </div>
            );
          })}
        </StateSection>
      </div>

      <StateSection title={t('Acceptance ({n})', String(acceptance.length))}>
        {acceptance.length ? acceptance.slice(0, 16).map((item, index) => {
          const ac: StateRecord = isRecord(item) ? item : { id: String(item), text: '', status: 'tracked' };
          return (
            <div key={`${asText(ac.id, String(index))}-${index}`} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--muted)', fontWeight: 700 }}>{asText(ac.id, `#${index + 1}`)}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asText(ac.text, '')}</span>
              <span style={acStatusStyle(asText(ac.status, 'tracked'))}>{asText(ac.status, 'tracked')}</span>
            </div>
          );
        }) : <span style={{ color: 'var(--muted)' }}>{t('none')}</span>}
      </StateSection>

      {workItems.length > 0 && (
        <StateSection title={t('Work items')}>
          {workItems.slice(0, 12).map((item, index) => (
            <div key={`${asText(item.id, String(index))}-${index}`} style={{ display: 'grid', gridTemplateColumns: '56px 1fr 62px', gap: 6 }}>
              <span style={{ color: 'var(--muted)' }}>{asText(item.id, `#${index + 1}`)}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asText(item.agent)}</span>
              <span style={{ fontWeight: 700 }}>{asText(item.status)}</span>
            </div>
          ))}
        </StateSection>
      )}
    </div>
  );
}

function StateSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', padding: '7px 8px', minWidth: 0 }}>
      <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 5 }}>{title}</div>
      <div style={{ display: 'grid', gap: 3 }}>{children}</div>
    </div>
  );
}
