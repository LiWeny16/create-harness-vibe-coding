import { useEffect, useMemo, useState } from 'react';
import { Bot, GitBranch, RefreshCw, ShieldCheck, Terminal } from 'lucide-react';
import { apiJsonCached, invalidateApiCache } from '../api';
import { useT } from '../i18n/index';
import LoadingView from './LoadingView';

type RoleNode = {
  agentId: string;
  role: string;
  level: number;
  kind: string;
  skills?: string[];
  permissions?: string[];
};

type RoleEdge = { from: string; to: string; relation: string };
type RoleGraph = { rootAgentId: string; agents: RoleNode[]; edges: RoleEdge[] };

function kindColor(kind: string) {
  if (kind === 'controller') return '#111111';
  if (kind === 'runtime') return '#1e40af';
  if (kind === 'review' || kind === 'validation') return '#166534';
  if (kind === 'implementer') return '#7c2d12';
  return '#6b7280';
}

function NodeIcon({ kind }: { kind: string }) {
  if (kind === 'runtime') return <Terminal size={14} />;
  if (kind === 'validation' || kind === 'review') return <ShieldCheck size={14} />;
  return <Bot size={14} />;
}

export default function RolesRoute() {
  const t = useT();
  const [graph, setGraph] = useState<RoleGraph | null>(null);
  const [selectedId, setSelectedId] = useState('ceo');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRoles = async () => {
    try {
      const data = await apiJsonCached<RoleGraph>('/api/roles', { ttlMs: 30000 });
      setGraph(data);
      setSelectedId(current => current && data.agents.some(agent => agent.agentId === current) ? current : data.rootAgentId);
      setError(null);
    } catch (e: any) {
      setError(e?.message || t('Failed to load roles'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const lanes = useMemo(() => {
    const grouped = new Map<number, RoleNode[]>();
    for (const node of graph?.agents || []) {
      const lane = grouped.get(node.level) || [];
      lane.push(node);
      grouped.set(node.level, lane);
    }
    return [...grouped.entries()].sort(([a], [b]) => a - b);
  }, [graph]);

  const selected = graph?.agents.find(node => node.agentId === selectedId) || null;
  const inbound = graph?.edges.filter(edge => edge.to === selectedId) || [];
  const outbound = graph?.edges.filter(edge => edge.from === selectedId) || [];

  if (loading) return <LoadingView label={t('Loading roles')} />;
  if (!graph) return <div style={{ padding: 20, color: '#991b1b', fontSize: 11 }}>{error || t('No role graph available.')}</div>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
          <GitBranch size={14} /> {t('Roles')}
        </h2>
        <button onClick={() => { invalidateApiCache('/api/roles'); loadRoles(); }} style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px' }}>
          <RefreshCw size={11} /> {t('Refresh')}
        </button>
      </div>

      {error && <div style={{ fontSize: 11, color: '#991b1b' }}>{error}</div>}

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 320px)', gap: 12, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 10 }}>
          {lanes.map(([level, nodes]) => (
            <div key={level} style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                {level === 0 ? t('Leader') : t('Role Layer')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 6 }}>
                {nodes.map(node => {
                  const active = selectedId === node.agentId;
                  const color = kindColor(node.kind);
                  return (
                    <button
                      key={node.agentId}
                      onClick={() => setSelectedId(node.agentId)}
                      style={{
                        border: `1px solid ${active ? color : 'var(--border)'}`,
                        borderLeft: `3px solid ${color}`,
                        borderRadius: 'var(--radius)',
                        padding: 9,
                        background: active ? 'var(--surface)' : 'var(--bg)',
                        textAlign: 'left',
                        minHeight: 82,
                        display: 'grid',
                        alignContent: 'start',
                        gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <NodeIcon kind={node.kind} />
                        <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.role}</span>
                      </div>
                      <div style={{ fontSize: 10, color }}>{node.kind}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(node.skills || []).slice(0, 3).join(' / ') || node.agentId}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <aside style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, background: 'var(--bg)' }}>
          {selected ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <NodeIcon kind={selected.kind} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.role}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{selected.agentId}</div>
                </div>
              </div>

              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 5 }}>{t('Edges')}</div>
              <div style={{ display: 'grid', gap: 3, fontSize: 10, marginBottom: 10 }}>
                {[...inbound.map(edge => `${edge.from} -> ${edge.relation}`), ...outbound.map(edge => `${edge.relation} -> ${edge.to}`)].map((line, index) => (
                  <div key={`${line}-${index}`} style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line}</div>
                ))}
                {inbound.length + outbound.length === 0 && <div style={{ color: 'var(--muted)' }}>{t('no edges')}</div>}
              </div>

              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 5 }}>{t('Skills')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 10 }}>
                {(selected.skills || []).map(skill => (
                  <span key={skill} style={{ fontSize: 9, padding: '1px 5px', border: '1px solid var(--border)', borderRadius: 99, color: 'var(--muted)' }}>{skill}</span>
                ))}
              </div>

              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 5 }}>{t('Permissions')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {(selected.permissions || []).map(permission => (
                  <span key={permission} style={{ fontSize: 9, padding: '1px 5px', border: '1px solid var(--border)', borderRadius: 99, color: 'var(--muted)' }}>{permission}</span>
                ))}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 11 }}>{t('Select a role.')}</div>
          )}
        </aside>
      </section>
    </div>
  );
}
