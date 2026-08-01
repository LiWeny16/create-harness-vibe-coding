import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import LoadingView from './components/LoadingView';
import { useServerConnection } from './hooks/useServerConnection';
import { apiFetch, apiJson } from './api';
import { I18nProvider } from './i18n';

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
  const [activeTerminalSession, setActiveTerminalSession] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [routePulse, setRoutePulse] = useState(false);
  const fullCanvas = location.pathname === '/workflow';

  useEffect(() => {
    const handler = (e: ErrorEvent) => setErrors(prev => [...prev, e.message].slice(-20));
    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
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
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
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
      </div>
    </I18nProvider>
  );
}
