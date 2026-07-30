import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { RotateCcw, Save, Settings } from 'lucide-react';
import { apiJson, apiJsonCached, invalidateApiCache } from '../api';
import LoadingView from './LoadingView';

type SettingsData = {
  server: { host: string; port: number };
  terminal: { enabled: boolean; attachMode: boolean; defaultRuntime: string };
  peers: { allowlist: string[] };
  ui: { theme: string; language: string; reducedMotion: boolean };
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
};

function mergeSettings(value: Partial<SettingsData>): SettingsData {
  return {
    ...DEFAULTS,
    ...value,
    server: { ...DEFAULTS.server, ...value.server },
    terminal: { ...DEFAULTS.terminal, ...value.terminal },
    peers: { ...DEFAULTS.peers, ...value.peers },
    ui: { ...DEFAULTS.ui, ...value.ui },
  };
}

export default function SettingsRoute() {
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
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

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
      setError(e?.message || 'Save failed');
    }
  };

  const field = (label: string, child: ReactNode) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      {child}
    </div>
  );

  if (loading) return <LoadingView label="Loading settings" />;

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
        <Settings size={14} /> Settings
      </h2>

      <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
        {field('Server Host', <input type="text" value={settings.server.host} onChange={e => setSettings(s => ({ ...s, server: { ...s.server, host: e.target.value } }))} style={{ width: '100%', padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />)}

        {field('Server Port', <input type="number" value={settings.server.port} onChange={e => setSettings(s => ({ ...s, server: { ...s.server, port: parseInt(e.target.value) || 0 } }))} style={{ width: 100, padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />)}

        {field('UI Theme', (
          <select value={settings.ui.theme} onChange={e => setSettings(s => ({ ...s, ui: { ...s.ui, theme: e.target.value } }))} style={{ padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
            <option value="auto">auto</option>
            <option value="light">light</option>
            <option value="dark">dark</option>
          </select>
        ))}

        {field('Language', (
          <select value={settings.ui.language} onChange={e => setSettings(s => ({ ...s, ui: { ...s.ui, language: e.target.value } }))} style={{ padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
            <option value="en">English</option>
            <option value="zh">Chinese</option>
            <option value="ja">Japanese</option>
          </select>
        ))}

        {field('Terminal', (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <input type="checkbox" checked={settings.terminal.enabled} onChange={e => setSettings(s => ({ ...s, terminal: { ...s.terminal, enabled: e.target.checked } }))} />
            Enable PTY terminal
          </label>
        ))}

        {field('Default Task Agent', (
          <select value={settings.terminal.defaultRuntime} onChange={e => setSettings(s => ({ ...s, terminal: { ...s.terminal, defaultRuntime: e.target.value } }))} style={{ padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
            {settings.peers.allowlist.map(runtime => <option key={runtime} value={runtime}>{runtime}</option>)}
          </select>
        ))}

        {field('Reduced Motion', (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <input type="checkbox" checked={settings.ui.reducedMotion} onChange={e => setSettings(s => ({ ...s, ui: { ...s.ui, reducedMotion: e.target.checked } }))} />
            Disable animations
          </label>
        ))}

        {field('Peer Runtimes', (
          <input type="text" value={settings.peers.allowlist.join(', ')}
            onChange={e => setSettings(s => ({ ...s, peers: { allowlist: e.target.value.split(',').map(x => x.trim()).filter(Boolean) } }))}
            style={{ width: '100%', padding: '4px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
        ))}
      </div>

      {error && <div style={{ marginTop: 8, fontSize: 11, color: '#991b1b', padding: '6px 8px', background: '#fef2f2', borderRadius: 'var(--radius)' }}>{error}</div>}
      {saved && <div style={{ marginTop: 8, fontSize: 11, color: '#166534', padding: '6px 8px', background: '#dcfce7', borderRadius: 'var(--radius)' }}>Settings saved.</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={save} style={{ padding: '6px 16px', fontSize: 11, fontWeight: 500, border: '1px solid #166534', borderRadius: 'var(--radius)', background: '#166534', color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Save size={12} /> Save
        </button>
        <button onClick={loadSettings} style={{ padding: '6px 16px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <RotateCcw size={12} /> Reload
        </button>
      </div>
    </div>
  );
}
