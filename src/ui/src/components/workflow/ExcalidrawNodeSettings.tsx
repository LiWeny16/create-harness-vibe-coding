import { useState } from 'react';
import { useT } from '../../i18n';
import type { WorkflowRuntimeNode } from './nodeRuntimeClient';
import NodeSettingsShell from './NodeSettingsShell';
import { patchNodeSettings } from './nodeRuntimeClient';

type Props = { node: WorkflowRuntimeNode; onClose: () => void; onDelete: () => void };

export default function ExcalidrawNodeSettings({ node, onClose, onDelete }: Props) {
  const t = useT();
  const s = node.settings.values;
  const [theme, setTheme] = useState(String(s.theme || 'light'));
  const [gridSize, setGridSize] = useState(Number(s.gridSize || 20));
  const [viewBackgroundColor, setViewBackgroundColor] = useState(String(s.viewBackgroundColor || '#ffffff'));
  const [exportScale, setExportScale] = useState(Number(s.exportScale || 1));
  const [autoSave, setAutoSave] = useState(Boolean(s.autoSave));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      await patchNodeSettings(node.nodeId, { theme, gridSize, viewBackgroundColor, exportScale, autoSave });
    } catch (e: any) { setError(e?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <NodeSettingsShell node={node} onClose={onClose} onDelete={onDelete}>
      <div>
        <label>{t('Theme')}</label>
        <select data-testid="workflow-excalidraw-settings-theme" value={theme}
          onChange={e => setTheme(e.target.value)}>
          <option value="light">{t('Light')}</option>
          <option value="dark">{t('Dark')}</option>
        </select>
      </div>
      <div>
        <label>{t('Grid size')}</label>
        <input data-testid="workflow-excalidraw-settings-grid-size" type="number" min={5} max={100}
          value={gridSize} onChange={e => setGridSize(Number(e.target.value))} />
      </div>
      <div>
        <label>{t('Background')}</label>
        <input data-testid="workflow-excalidraw-settings-background" type="text"
          value={viewBackgroundColor} onChange={e => setViewBackgroundColor(e.target.value)} />
      </div>
      <div>
        <label>{t('Export scale')}</label>
        <input data-testid="workflow-excalidraw-settings-export-scale" type="number" min={1} max={4} step={0.5}
          value={exportScale} onChange={e => setExportScale(Number(e.target.value))} />
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input data-testid="workflow-excalidraw-settings-auto-save" type="checkbox" checked={autoSave}
          onChange={e => setAutoSave(e.target.checked)} />
        {t('Auto save')}
      </label>
      {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
      <button data-testid="workflow-excalidraw-settings-save" onClick={save} disabled={saving}>
        {saving ? t('Saving...') : t('Save')}
      </button>
    </NodeSettingsShell>
  );
}
