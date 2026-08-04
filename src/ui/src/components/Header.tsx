import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot, CircleHelp, GitBranch, LayoutDashboard, Monitor, Settings, UsersRound } from 'lucide-react';
import { apiJsonCached } from '../api';
import { useT } from '../i18n/index';

const NAV = [
  { to: '/tasks', label: 'Tasks', icon: LayoutDashboard },
  { to: '/workflow', label: 'Workflow', icon: GitBranch },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/roles', label: 'Roles', icon: UsersRound },
  { to: '/settings', label: 'Settings', icon: Settings },
];

type ProjectInfo = { root?: string; taskCount?: number };
type WorkflowInfo = { taskId?: string | null; phase?: string | null; gate?: string | null };

function basename(value: string | undefined, t: (key: string) => string) {
  if (!value) return t('project');
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

export default function Header() {
  const t = useT();
  const location = useLocation();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      apiJsonCached<ProjectInfo>('/api/project', { ttlMs: 30000 }),
      apiJsonCached<WorkflowInfo>('/api/workflow', { ttlMs: 2000 }),
    ]).then(([projectResult, workflowResult]) => {
      if (cancelled) return;
      if (projectResult.status === 'fulfilled') setProject(projectResult.value);
      if (workflowResult.status === 'fulfilled') setWorkflow(workflowResult.value);
    });
    return () => { cancelled = true; };
  }, []);

  const activeMeta = [workflow?.taskId, workflow?.phase, workflow?.gate].filter(Boolean).join(' / ');

  return (
    <header
      data-testid="header"
      style={{
        height: 'var(--header-h)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        gap: 18,
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      <Link
        to="/"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontWeight: 600,
          fontSize: 14,
          flexShrink: 0,
        }}
        title={project?.root || 'Harness'}
      >
        <div
          data-testid="header-brand"
          aria-hidden="true"
          style={{
            width: 22,
            height: 22,
            background: 'var(--fg)',
            color: 'var(--bg)',
            borderRadius: 4,
            display: 'grid',
            placeItems: 'center',
            fontSize: 13,
            lineHeight: 1,
            fontWeight: 700,
          }}
        >
          H
        </div>
        <span>Harness</span>
        <span style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 500 }}>
          {basename(project?.root, t)}
        </span>
      </Link>

      <nav data-testid="header-nav" style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to || (to === '/tasks' && location.pathname === '/');
          return (
            <Link
              key={to}
              to={to}
              data-testid={`nav-${label.toLowerCase()}`}
              data-wf-capability={`nav.${label.toLowerCase()}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 'var(--radius)',
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--fg)' : 'var(--muted)',
                background: active ? 'var(--surface)' : 'transparent',
                transition: 'background 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              <Icon size={14} />
              {t(label)}
            </Link>
          );
        })}
      </nav>

      <div style={{ flex: 1, minWidth: 12 }} />

      <div
        data-testid="header-active-task"
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 420,
        }}
        title={activeMeta || t('No active workflow')}
      >
        {activeMeta || `${project?.taskCount ?? 0} task(s)`}
      </div>

      <button
        data-testid="theme-toggle"
        data-wf-capability="app.themeToggle"
        title={t('System theme')}
        aria-label={t('System theme')}
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          color: 'var(--muted)',
          flexShrink: 0,
        }}
      >
        <Monitor size={14} />
      </button>
      <button
        title={t('Harness help')}
        aria-label={t('Harness help')}
        style={{
          width: 28,
          height: 28,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          color: 'var(--muted)',
          flexShrink: 0,
        }}
      >
        <CircleHelp size={14} />
      </button>
    </header>
  );
}
