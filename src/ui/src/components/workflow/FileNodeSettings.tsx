import { useState } from 'react';
import { useT } from '../../i18n';
import type { WorkflowRuntimeNode } from './nodeRuntimeClient';
import NodeSettingsShell from './NodeSettingsShell';
import { patchNodeSettings, executeNodeAction } from './nodeRuntimeClient';

type Props = { node: WorkflowRuntimeNode; onClose: () => void; onDelete: () => void };

export default function FileNodeSettings({ node, onClose, onDelete }: Props) {
  const t = useT();
  const s = node.settings.values;
  const contentRef = node.contentRef as Record<string, unknown> | undefined;
  const [autoRefresh, setAutoRefresh] = useState(Boolean(s.autoRefresh));
  const [maxPreviewSize, setMaxPreviewSize] = useState(Number(s.maxPreviewSize || 256));
  const [defaultView, setDefaultView] = useState(String(s.defaultView || 'preview'));
  const [watchChanges, setWatchChanges] = useState(Boolean(s.watchChanges));
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      await patchNodeSettings(node.nodeId, { autoRefresh, maxPreviewSize, defaultView, watchChanges });
    } catch (e: any) { setError(e?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const refresh = async () => {
    setRefreshing(true); setError('');
    try { await executeNodeAction(node.nodeId, 'file.refresh'); }
    catch (e: any) { setError(e?.message || 'Refresh failed'); }
    finally { setRefreshing(false); }
  };

  return (
    <NodeSettingsShell node={node} onClose={onClose} onDelete={onDelete}>
      <div>
        <label>{t('Path')}</label>
        <input data-testid="workflow-file-settings-path" value={String(contentRef?.path || '')} readOnly />
      </div>
      <div>
        <label>{t('Source')}</label>
        <input data-testid="workflow-file-settings-source" value={String(contentRef?.source || 'workspace')} readOnly />
      </div>
      <div>
        <label>{t('MIME type')}</label>
        <input data-testid="workflow-file-settings-mime" value={String(contentRef?.mime || '')} readOnly />
      </div>
      {contentRef?.size !== undefined && (
        <div>
          <label>{t('Size')}</label>
          <input data-testid="workflow-file-settings-size" value={String(contentRef.size)} readOnly />
        </div>
      )}
      <div>
        <label>{t('Default view')}</label>
        <select data-testid="workflow-file-settings-default-view" value={defaultView}
          onChange={e => setDefaultView(e.target.value)}>
          <option value="preview">{t('Preview')}</option>
          <option value="metadata">{t('Metadata')}</option>
        </select>
      </div>
      <div>
        <label>{t('Max preview (KB)')}</label>
        <input data-testid="workflow-file-settings-max-preview" type="number" min={16} max={4096}
          value={maxPreviewSize} onChange={e => setMaxPreviewSize(Number(e.target.value))} />
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input data-testid="workflow-file-settings-auto-refresh" type="checkbox" checked={autoRefresh}
          onChange={e => setAutoRefresh(e.target.checked)} />
        {t('Auto refresh')}
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input data-testid="workflow-file-settings-watch" type="checkbox" checked={watchChanges}
          onChange={e => setWatchChanges(e.target.checked)} />
        {t('Watch changes')}
      </label>
      <button data-testid="workflow-file-settings-refresh" onClick={refresh} disabled={refreshing}>
        {refreshing ? t('Refreshing...') : t('Refresh')}
      </button>
      {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
      <button data-testid="workflow-file-settings-save" onClick={save} disabled={saving}>
        {saving ? t('Saving...') : t('Save')}
      </button>
    </NodeSettingsShell>
  );
}
