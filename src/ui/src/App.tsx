import { lazy, Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import LoadingView from './components/LoadingView';
import { useServerConnection } from './hooks/useServerConnection';
import { apiFetch, apiJson } from './api';
import { I18nProvider } from './i18n';
import { WfBrowserDebugRuntime, useWfBrowserCapabilities, type WfBrowserCapability } from './wfBrowserDebug';
import { useWfBrowserRouteCapabilities } from './wfBrowserRouteCapabilities';

// Persisted across refreshes so the terminal drawer reattaches to the same
// backend session (the backend keeps the PTY alive; only the UI state dies).
const ACTIVE_TERMINAL_SESSION_KEY = 'wf-ui.activeTerminalSession';

const TaskList = lazy(() => import('./components/TaskList'));
const WorkflowRoute = lazy(() => import('./components/WorkflowRoute'));
const AgentsRoute = lazy(() => import('./components/AgentsRoute'));
const RolesRoute = lazy(() => import('./components/RolesRoute'));
const SettingsRoute = lazy(() => import('./components/SettingsRoute'));
const TerminalDrawer = lazy(() => import('./components/TerminalDrawer'));

function useDebugReporter(connState: string, errors: string[]) {
  const location = useLocation();
  useEffect(() => {
    apiFetch('/api/debug/report', {
      method: 'POST',
      body: JSON.stringify({
        connected: connState === 'connected',
        route: location.pathname,
        url: window.location.href,
        errors,
        lastUpdate: new Date().toISOString(),
      }),
    }).catch(() => {});
  }, [location.pathname, connState, errors]);
}

function loadingLabel(pathname: string) {
  if (pathname === '/workflow') return 'Loading workflow canvas';
  if (pathname === '/agents') return 'Loading agent terminals';
  if (pathname === '/roles') return 'Loading roles';
  if (pathname === '/settings') return 'Loading settings';
  return 'Loading tasks';
}

export default function App() {
  const location = useLocation();
  const { connState, eventSeq, lastSync, lastError } = useServerConnection();
  const [activeTerminalSession, setActiveTerminalSessionState] = useState<string | null>(null);
  const setActiveTerminalSession = useCallback((value: string | null) => {
    setActiveTerminalSessionState(value);
    try {
      if (value) {
        sessionStorage.setItem(ACTIVE_TERMINAL_SESSION_KEY, value);
      } else {
        sessionStorage.removeItem(ACTIVE_TERMINAL_SESSION_KEY);
      }
    } catch {
      // Storage may be unavailable (private mode / quota); persistence is best-effort.
    }
  }, []);
  const [errors, setErrors] = useState<string[]>([]);
  const [routePulse, setRoutePulse] = useState(false);
  const fullCanvas = location.pathname === '/workflow';
  const shellCapabilities = useMemo<WfBrowserCapability[]>(() => {
    const nav = [
      { id: 'nav.tasks', testId: 'nav-tasks', label: 'Tasks Route', route: '/tasks' },
      { id: 'nav.workflow', testId: 'nav-workflow', label: 'Workflow Route', route: '/workflow' },
      { id: 'nav.agents', testId: 'nav-agents', label: 'Agents Route', route: '/agents' },
      { id: 'nav.roles', testId: 'nav-roles', label: 'Roles Route', route: '/roles' },
      { id: 'nav.settings', testId: 'nav-settings', label: 'Settings Route', route: '/settings' },
    ];
    const capabilities: WfBrowserCapability[] = [
      {
        id: 'app.shell',
        kind: 'component',
        label: 'WF-UI App Shell',
        selectors: { testId: 'app-shell' },
        keys: { pathname: location.pathname },
        state: () => ({
          pathname: location.pathname,
          connection: connState,
          eventSeq,
          fullCanvas,
          activeTerminalSession,
          errorCount: errors.length + (lastError ? 1 : 0),
        }),
        actions: {
          'observe.currentRoute': { label: 'Observe current route' },
        },
        captures: ['ui-tree', 'state', 'logs'],
      },
      {
        id: 'app.header',
        kind: 'component',
        label: 'Header',
        selectors: { testId: 'header' },
        state: () => ({ pathname: location.pathname }),
        captures: ['ui-tree', 'state'],
      },
      {
        id: 'app.themeToggle',
        kind: 'element',
        label: 'Theme Toggle',
        selectors: { testId: 'theme-toggle', role: 'button', name: 'System theme' },
        actions: { click: { label: 'Click theme toggle' } },
        captures: ['ui-tree'],
      },
      ...nav.map(item => ({
        id: item.id,
        kind: 'element',
        label: item.label,
        selectors: { testId: item.testId, role: 'link', name: item.label.replace(' Route', '') },
        keys: { route: item.route },
        state: () => ({ active: location.pathname === item.route || (item.route === '/tasks' && location.pathname === '/') }),
        actions: { click: { label: `Navigate to ${item.route}` } },
        captures: ['ui-tree', 'state'],
      } satisfies WfBrowserCapability)),
    ];
    return capabilities;
  }, [activeTerminalSession, connState, errors.length, eventSeq, fullCanvas, lastError, location.pathname]);

  useWfBrowserCapabilities(shellCapabilities);
  useWfBrowserRouteCapabilities(location.pathname, {
    activeTerminalSession,
    connection: connState,
  });

  useEffect(() => {
    const handler = (e: ErrorEvent) => setErrors(prev => [...prev, e.message].slice(-20));
    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
  }, []);

  useEffect(() => {
    // Re-open the terminal drawer after a refresh so it reconnects to the
    // same backend session. Only restores when a sessionId was persisted;
    // an explicit close clears it and stays closed.
    try {
      const stored = sessionStorage.getItem(ACTIVE_TERMINAL_SESSION_KEY);
      if (typeof stored === 'string' && stored) {
        setActiveTerminalSessionState(stored);
      }
    } catch {
      // Best-effort restore.
    }
  }, []);

  useEffect(() => {
    setRoutePulse(true);
    const timer = setTimeout(() => setRoutePulse(false), 520);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  useEffect(() => {
    let mediaQuery: MediaQueryList | null = null;

    const applyTheme = (theme: string) => {
      const resolved = theme === 'dark' ? 'dark'
        : theme === 'auto'
          ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : 'light';
      document.documentElement.dataset.theme = resolved;
    };

    const handleMediaChange = (e: MediaQueryListEvent) => {
      document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
    };

    apiJson<{ ui?: { theme?: string } }>('/api/settings')
      .then((data) => {
        const theme = data?.ui?.theme ?? 'auto';
        applyTheme(theme);
        if (theme === 'auto') {
          mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
          mediaQuery.addEventListener('change', handleMediaChange);
        }
      })
      .catch(() => {
        applyTheme('auto');
        mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', handleMediaChange);
      });

    return () => {
      if (mediaQuery) {
        mediaQuery.removeEventListener('change', handleMediaChange);
      }
    };
  }, []);

  useDebugReporter(connState, lastError ? [lastError, ...errors] : errors);

  return (
    <I18nProvider>
      <div
        data-testid="app-shell"
        data-wf-capability="app.shell"
        style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}
      >
        <Header />
        {routePulse && <div className="route-progress" aria-hidden="true" />}
        <main style={{ flex: 1, overflow: fullCanvas ? 'hidden' : 'auto', padding: fullCanvas ? 0 : '16px 20px', minHeight: 0 }}>
          <Suspense fallback={<LoadingView label={loadingLabel(location.pathname)} fullCanvas={fullCanvas} />}>
            <Routes>
              <Route path="/" element={<TaskList onSelectSession={setActiveTerminalSession} />} />
              <Route path="/tasks" element={<TaskList onSelectSession={setActiveTerminalSession} />} />
              <Route path="/workflow" element={<WorkflowRoute onSelectSession={setActiveTerminalSession} />} />
              <Route path="/agents" element={<AgentsRoute onSelectSession={setActiveTerminalSession} />} />
              <Route path="/roles" element={<RolesRoute />} />
              <Route path="/settings" element={<SettingsRoute />} />
            </Routes>
          </Suspense>
        </main>
        {activeTerminalSession && (
          <Suspense fallback={null}>
            <TerminalDrawer sessionId={activeTerminalSession} onClose={() => setActiveTerminalSession(null)} />
          </Suspense>
        )}
        {!fullCanvas && <Footer connState={connState} eventSeq={eventSeq} lastSync={lastSync} lastError={lastError} />}
        <WfBrowserDebugRuntime />
      </div>
    </I18nProvider>
  );
}
