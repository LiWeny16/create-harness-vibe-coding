import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { RotateCcw, Save, Settings } from 'lucide-react';
import { apiJson, apiJsonCached, invalidateApiCache } from '../api';
import { useI18n } from '../i18n/index';
import { runtimeDisplayName } from '../runtimeBrand';
import LoadingView from './LoadingView';
import RuntimePicker from './RuntimePicker';

type SettingsData = {
  server: { host: string; port: number };
  terminal: { enabled: boolean; attachMode: boolean; defaultRuntime: string };
  peers: { allowlist: string[] };
  ui: { theme: string; language: string; reducedMotion: boolean };
  cleanup: {
    enabled: boolean;
    autoPruneOnStartup: boolean;
    autoPruneIntervalHours: number;
    autoPruneStoppedSessions: boolean;
    stoppedSessionRetentionDays: number;
    keepStoppedSessions: number;
    includeTaskSessions: boolean;
    detachedLogRetentionHours: number;
  };
};

const DEFAULTS: SettingsData = {
  server: { host: '127.0.0.1', port: 0 },
  terminal: { enabled: false, attachMode: false, defaultRuntime: 'codex' },
  peers: {
    allowlist: [
      'claude',
      'cc',
      'codex',
      'opencode',
      'gemini',
      'qwen',
      'deepseek',
      'pi',
      'aider',
      'goose',
      'amp',
      'crush',
      'cline',
      'plandex',
      'openclaw',
      'chatgpt',
      'openai',
    ],
  },
  ui: { theme: 'auto', language: 'en', reducedMotion: false },
  cleanup: {
    enabled: true,
    autoPruneOnStartup: true,
    autoPruneIntervalHours: 6,
    autoPruneStoppedSessions: false,
    stoppedSessionRetentionDays: 14,
    keepStoppedSessions: 20,
    includeTaskSessions: false,
    detachedLogRetentionHours: 24,
  },
};

function mergeSettings(value: Partial<SettingsData>): SettingsData {
  return {
    ...DEFAULTS,
    ...value,
    server: { ...DEFAULTS.server, ...value.server },
    terminal: { ...DEFAULTS.terminal, ...value.terminal },
    peers: { ...DEFAULTS.peers, ...value.peers },
    ui: { ...DEFAULTS.ui, ...value.ui },
    cleanup: { ...DEFAULTS.cleanup, ...value.cleanup },
  };
}

function numberValue(value: string, fallback = 0) {
  const next = Number.parseInt(value, 10);
  return Number.isFinite(next) ? Math.max(0, next) : fallback;
}

function runtimeChoices(allowlist: string[]) {
  return allowlist.map(runtime => ({
    id: runtime,
    label: runtimeDisplayName(runtime),
    command: runtime,
  }));
}

export default function SettingsRoute() {
  const { t, setLang } = useI18n();
  const [settings, setSettings] = useState<SettingsData>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = async () => {
    try {
      const data = await apiJsonCached<Partial<SettingsData>>('/api/settings', { ttlMs: 10000 });
      setSettings(mergeSettings(data));
      setError(null);
    } catch {
      setError(t('Failed to load settings'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    const theme = settings.ui.theme;
    if (theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => {
        document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light';
      };
      apply();
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    } else {
      document.documentElement.dataset.theme = theme;
    }
  }, [settings.ui.theme]);

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await apiJson('/api/settings', {
        method: 'POST',
        body: JSON.stringify(settings),
      });
      invalidateApiCache('/api/settings');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e?.message || t('Save failed'));
    }
  };

  const field = (label: string, child: ReactNode) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      {child}
    </div>
  );

  if (loading) return <LoadingView label={t('Loading settings')} />;

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
        <Settings size={14} /> {t('Settings')}
      </h2>

      <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
        {field(t('Server Host'), <input type="text" value={settings.server.host} onChange={e => setSettings(s => ({ ...s, server: { ...s.server, host: e.target.value } }))} style={{ width: '100%', padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />)}

        {field(t('Server Port'), <input type="number" value={settings.server.port} onChange={e => setSettings(s => ({ ...s, server: { ...s.server, port: parseInt(e.target.value) || 0 } }))} style={{ width: 100, padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />)}

        {field(t('UI Theme'), (
          <select value={settings.ui.theme} onChange={e => {
            setSettings(s => ({ ...s, ui: { ...s.ui, theme: e.target.value } }));
            document.documentElement.dataset.theme = e.target.value;
          }} style={{ padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
            <option value="auto">{t('auto')}</option>
            <option value="light">{t('light')}</option>
            <option value="dark">{t('dark')}</option>
          </select>
        ))}

        {field(t('Language'), (
          <select value={settings.ui.language} onChange={e => { setSettings(s => ({ ...s, ui: { ...s.ui, language: e.target.value } })); setLang(e.target.value); }} style={{ padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
            <option value="en">{t('English')}</option>
            <option value="zh">{t('Chinese')}</option>
            <option value="ja">{t('Japanese')}</option>
          </select>
        ))}

        {field(t('Terminal'), (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <input type="checkbox" checked={settings.terminal.enabled} onChange={e => setSettings(s => ({ ...s, terminal: { ...s.terminal, enabled: e.target.checked } }))} />
            {t('Enable PTY terminal')}
          </label>
        ))}

        {field(t('Default Task Agent'), (
          <RuntimePicker
            runtimes={runtimeChoices(settings.peers.allowlist)}
            value={settings.terminal.defaultRuntime}
            onChange={runtime => setSettings(s => ({ ...s, terminal: { ...s.terminal, defaultRuntime: runtime } }))}
            testId="settings-default-runtime"
            style={{ width: 240 }}
          />
        ))}

        {field(t('Reduced Motion'), (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <input type="checkbox" checked={settings.ui.reducedMotion} onChange={e => setSettings(s => ({ ...s, ui: { ...s.ui, reducedMotion: e.target.checked } }))} />
            {t('Disable animations')}
          </label>
        ))}

        {field(t('Peer Runtimes'), (
          <input type="text" value={settings.peers.allowlist.join(', ')}
            onChange={e => setSettings(s => ({ ...s, peers: { allowlist: e.target.value.split(',').map(x => x.trim()).filter(Boolean) } }))}
            style={{ width: '100%', padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
        ))}

        {field(t('Cleanup'), (
          <div style={{ display: 'grid', gap: 9 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input type="checkbox" checked={settings.cleanup.enabled} onChange={e => setSettings(s => ({ ...s, cleanup: { ...s.cleanup, enabled: e.target.checked } }))} />
                {t('Enable cleanup')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input type="checkbox" checked={settings.cleanup.autoPruneOnStartup} onChange={e => setSettings(s => ({ ...s, cleanup: { ...s.cleanup, autoPruneOnStartup: e.target.checked } }))} />
                {t('Startup cleanup')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input type="checkbox" checked={settings.cleanup.autoPruneStoppedSessions} onChange={e => setSettings(s => ({ ...s, cleanup: { ...s.cleanup, autoPruneStoppedSessions: e.target.checked } }))} />
                {t('Auto session cleanup')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input type="checkbox" checked={settings.cleanup.includeTaskSessions} onChange={e => setSettings(s => ({ ...s, cleanup: { ...s.cleanup, includeTaskSessions: e.target.checked } }))} />
                {t('Include task sessions')}
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                {t('Session Days')}
                <input type="number" min={0} value={settings.cleanup.stoppedSessionRetentionDays}
                  onChange={e => setSettings(s => ({ ...s, cleanup: { ...s.cleanup, stoppedSessionRetentionDays: numberValue(e.target.value, s.cleanup.stoppedSessionRetentionDays) } }))}
                  style={{ padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
              </label>
              <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                {t('Keep Latest')}
                <input type="number" min={0} value={settings.cleanup.keepStoppedSessions}
                  onChange={e => setSettings(s => ({ ...s, cleanup: { ...s.cleanup, keepStoppedSessions: numberValue(e.target.value, s.cleanup.keepStoppedSessions) } }))}
                  style={{ padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
              </label>
              <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                {t('Temp Log Hours')}
                <input type="number" min={1} value={settings.cleanup.detachedLogRetentionHours}
                  onChange={e => setSettings(s => ({ ...s, cleanup: { ...s.cleanup, detachedLogRetentionHours: Math.max(1, numberValue(e.target.value, s.cleanup.detachedLogRetentionHours)) } }))}
                  style={{ padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
              </label>
              <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                {t('Interval Hours')}
                <input type="number" min={0} value={settings.cleanup.autoPruneIntervalHours}
                  onChange={e => setSettings(s => ({ ...s, cleanup: { ...s.cleanup, autoPruneIntervalHours: numberValue(e.target.value, s.cleanup.autoPruneIntervalHours) } }))}
                  style={{ padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
              </label>
            </div>
          </div>
        ))}
      </div>

      {error && <div style={{ marginTop: 8, fontSize: 11, color: '#991b1b', padding: '6px 8px', background: '#fef2f2', borderRadius: 'var(--radius)' }}>{error}</div>}
      {saved && <div style={{ marginTop: 8, fontSize: 11, color: '#166534', padding: '6px 8px', background: '#dcfce7', borderRadius: 'var(--radius)' }}>{t('Settings saved.')}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={save} style={{ padding: '6px 16px', fontSize: 11, fontWeight: 500, border: '1px solid #166534', borderRadius: 'var(--radius)', background: '#166534', color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Save size={12} /> {t('Save')}
        </button>
        <button onClick={loadSettings} style={{ padding: '6px 16px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <RotateCcw size={12} /> {t('Reload')}
        </button>
      </div>
    </div>
  );
}
